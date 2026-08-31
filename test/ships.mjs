import { ATTRS, HULLS, DEFAULT_HULL, resolve, sanitiseFit, slotsOf, baysOf,
         DAMAGE_PER_HARDPOINT, FIRE_RATE } from '../shared/ships.js';
import { EQUIPMENT, SLOTS, emptyFit, fitCount, reseat, topTier, MAX_DRONES } from '../shared/gear.js';
import { SPENDS } from '../shared/tech.js';
const fit = (o = {}) => ({ weapon: [], generator: [], tech: [], ...o });

import { newShip, refit, step, stepVitals, stepDrift, applyDamage, inBase, driftDepth, driftDps, SHIELD_FLASH,
         DOCK_HULL_RATE, DOCK_INTERRUPT, DRIFT_MARGIN, DRIFT_MIN, DRIFT_MAX, WORLD } from '../shared/sim.js';
import { MAPS, GALAXY, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';
import { BOOST } from '../shared/power.js';
import { FORMATIONS, FORMATION_KEYS, DEFAULT_FORMATION, slots as formSlots, droneAt,
         DRONE_R, HULL_R } from '../shared/formation.js';
import { hardpoints } from '../shared/combat.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const better = (k, delta) => (ATTRS[k].better === 'high') === (delta > 0);

console.log('\nattributes');
check('every hull declares every combat attribute',
  Object.values(HULLS).every(h => ['hull','shield','shieldRegen','shieldDelay','speed','accel']
    .every(k => typeof h.attrs[k] === 'number')));
check('a module naming an unknown attribute is ignored, not fatal', (() => {
  EQUIPMENT.__probe = { name: 'probe', slot: 'tech', price: 1, mods: [['nonsense', 'add', 999], ['hull', 'add', 10]] };
  const r = resolve('vanguard', fit({ tech: ['__probe'] }));
  delete EQUIPMENT.__probe;
  return r.hull === HULLS.vanguard.attrs.hull + 10 && !('nonsense' in r);
})());
check('resolve does not mutate the hull table', (() => {
  const before = JSON.stringify(HULLS.vanguard);
  resolve('vanguard', fit({ tech: ['plating'] }));
  return JSON.stringify(HULLS.vanguard) === before;
})());
check('flat adds apply before percentages', (() => {
  // cellA adds a flat 120 shield; plating then multiplies hull by 1.50.
  // vanguard is 1100 hull / 900 shield / 340 speed.
  const r = resolve('vanguard', fit({ generator: ['cellA'], tech: ['plating'] }));
  return r.shield === 1020 && Math.abs(r.hull - 1100 * 1.50) < 1e-6
      && Math.abs(r.speed - (340 - 8) * 0.80) < 1e-6;
})());
// Rewritten, not deleted. It read "percentages sum instead of compounding — two
// technologies are worth two, never less", and summing is what let Siege Cadence
// and Rapid Cadence annihilate: each trades damage against rate, +0.60 and -0.375
// summed to +0.225 on BOTH halves of the dps product, so the pair was a free x1.50
// with nothing given up. The reason for summing was that three copies of a module
// must not be worth more than three times one — and nothing that multiplies can be
// stacked, because `mul` is technology-only and a technology is unique across the
// whole ship. So the rule is now what the percentages actually say.
check('percentages compound, so a trade and its opposite cancel exactly', (() => {
  const b = HULLS.bulwark.attrs;
  // Wing Repeaters -14% speed and Composite Plating -20%: 0.86 x 0.80 = 0.688,
  // where summing gave 1 - 0.34 = 0.66.
  const r = resolve('bulwark', fit({ tech: ['repeaters', 'plating'] }));
  // And the pair this was rewritten for: x1.60 damage x x0.625 damage is exactly 1,
  // and so is the rate, so the two cadences together are the gun you started with.
  const c = resolve('bulwark', fit({ tech: ['siege', 'rapid'] }));
  return Math.abs(r.speed - b.speed * 0.86 * 0.80) < 1e-6
      && Math.abs(c.damage - b.damage) < 1e-9
      && Math.abs(c.fireRate - FIRE_RATE) < 1e-9;
})(), 'Siege and Rapid Cadence fitted together are x1.00 damage and x1.00 rate — summed they were ' +
      'x1.225 on each, which is a free x1.50 of damage output for nothing');
check('attributes are clamped to their floor', (() => {
  EQUIPMENT.__sink = { name: 'sink', slot: 'tech', price: 1, mods: [['speed', 'mul', -5]] };
  const r = resolve('vanguard', fit({ tech: ['__sink'] }));
  delete EQUIPMENT.__sink;
  return r.speed === ATTRS.speed.min;
})());

console.log('\nbalance invariants');
// Every technology still gives something up. What changed is that it no longer
// has to be a stat: an entry may surrender an attribute, or it may name a cost
// shared/tech.js actually implements — the ore in your hold, the charge in your
// reactor, being noticed sooner. The Shear Compensator has no attribute on it at
// all and is paid for entirely in capacitor, and the old form of this check would
// have refused it while happily passing twenty-six things nobody wanted to buy.
for (const [k, M] of Object.entries(EQUIPMENT))
  if (M.slot === 'tech')
    check(`${M.name} costs something`,
      M.mods.some(([a, , v]) => !better(a, v)) || (M.spends && M.spends in SPENDS),
      M.mods.some(([a, , v]) => !better(a, v)) ? 'an attribute it surrenders'
                                              : `paid in ${SPENDS[M.spends]}`);
const dominates = (A, B) => {
  const keys = ['hull','shield','shieldRegen','shieldDelay','speed','accel'];
  const cmp = keys.map(k => (ATTRS[k].better === 'high' ? 1 : -1) * (A.attrs[k] - B.attrs[k]));
  return cmp.every(v => v >= 0) && cmp.some(v => v > 0);
};
const BOUGHT = Object.entries(HULLS).filter(([, h]) => h.price > 0);
let dom = [];
for (const [ka, A] of BOUGHT) for (const [kb, B] of BOUGHT)
  if (ka !== kb && dominates(A, B)) dom.push(`${ka} > ${kb}`);
check('no purchasable hull is strictly better than another', dom.length === 0,
  dom.join(', ') || `${BOUGHT.length} ships, all trade-offs`);
check('the starter is free and visibly outclassed, but not helpless', (() => {
  const st = HULLS[DEFAULT_HULL];
  return st.price === 0 && BOUGHT.every(([, h]) => dominates(h, st) || h.attrs.hull > st.attrs.hull)
    && st.attrs.speed > 260 && st.attrs.cargo >= 90;
})(), 'slower and softer than everything, but fast enough to kite and roomy enough to earn');
check('prices climb with the ship', (() => {
  const p2 = BOUGHT.map(([, h]) => h.price);
  return p2.every((v, i) => i === 0 || v > p2[i - 1]);
})(), BOUGHT.map(([, h]) => h.price).join(' < '));
const fixed  = h => SLOTS.reduce((n, s2) => n + slotsOf(h)[s2], 0);
const mounts = h => fixed(h) + baysOf(h);
const totals = BOUGHT.map(([h]) => mounts(h));
// Rewritten, not deleted. The claim was "the same total SLOTS, distributed
// differently", and it was counting the wrong thing: a drone bay takes any weapon
// and any generator, so twelve free-form bays sat beside seven fixed slots and
// went uncounted. Measured at the top of both ladders with each hull's escort
// optimised for it, three completely different racks — W5G1T1, W3G2T2, W1G4T2 —
// score 5.09, 4.42 and 5.14: the split is worth about 2% and the COUNT is worth
// everything. So the invariant is the same invariant, over the right total.
check('every purchasable hull carries the same total MOUNTS, ship and escort together',
  new Set(totals).size === 1 && new Set(BOUGHT.map(([h]) => JSON.stringify(slotsOf(h)))).size === BOUGHT.length,
  `${totals[0]} mounts each: ` + BOUGHT.map(([h]) => {
    const s2 = slotsOf(h); return `${h} W${s2.weapon}G${s2.generator}T${s2.tech}+${baysOf(h)} bays`; }).join(', '));
check('and the bigger the hull, the more of them are welded in place',
  BOUGHT.every(([h], i) => i === 0 || fixed(h) > fixed(BOUGHT[i - 1][0])),
  BOUGHT.map(([h]) => `${h} ${fixed(h)} fixed / ${baysOf(h)} free`).join(', ') +
  ' — a bay you can re-purpose is worth more than a slot you cannot, so the ship that ' +
  'welds more in has to be better at the thing it welded them into');
check('the starter has fewer mounts than any of them',
  mounts(DEFAULT_HULL) < totals[0], `${mounts(DEFAULT_HULL)} against ${totals[0]}`);
// The anti-domination rule extended to the thing that now differs. Base attributes
// alone stopped being the whole story the moment the racks did — and the two checks
// together are exactly the check over the union, because a hull that were better at
// everything would have to carry its one strict advantage in one list or the other.
{
  const cmp = (a, b) => [slotsOf(a).weapon - slotsOf(b).weapon, slotsOf(a).generator - slotsOf(b).generator,
                         slotsOf(a).tech - slotsOf(b).tech, baysOf(a) - baysOf(b)];
  const bad = [];
  for (const [ka] of BOUGHT) for (const [kb] of BOUGHT) if (ka !== kb) {
    const c = cmp(ka, kb);
    if (c.every(v => v >= 0) && c.some(v => v > 0)) bad.push(`${ka} > ${kb}`);
  }
  check('and no purchasable hull has more of every kind of mount than another',
    bad.length === 0, bad.join(', ') ||
    'each of the three is best at exactly one kind and gives up another for it');
}
// The measurement the rework was argued from, kept as the test. Nothing in the
// shop ADDS hull, so a chassis keeps its hull spread forever; every generator adds
// flat shield and every emitter adds flat damage, so those two are diluted to
// nothing. A hull that tried to differentiate itself on base damage was claiming
// an advantage its first emitter erased.
check('base damage is decoration and base hull is not, which is why the slots do the work', (() => {
  const TOP = topTier('weapon'), CELL = topTier('generator');
  const full = h => { const sl = slotsOf(h);
    return resolve(h, fit({ weapon: Array(sl.weapon).fill(TOP), generator: Array(sl.generator).fill(CELL),
                            tech: sl.tech ? ['plating'] : [] }), Array(6).fill(TOP), 'wedge'); };
  const share = (k, h) => HULLS[h].attrs[k] / full(h)[k];
  const dmg = Object.keys(HULLS).map(h => share('damage', h));
  const hl  = Object.keys(HULLS).map(h => share('hull', h));
  return Math.max(...dmg) < 0.03 && Math.min(...hl) > 0.6;
})(), (() => {
  const TOP = topTier('weapon'), CELL = topTier('generator');
  const full = h => { const sl = slotsOf(h);
    return resolve(h, fit({ weapon: Array(sl.weapon).fill(TOP), generator: Array(sl.generator).fill(CELL),
                            tech: sl.tech ? ['plating'] : [] }), Array(6).fill(TOP), 'wedge'); };
  return Object.keys(HULLS).map(h =>
    `${h} ${(100 * HULLS[h].attrs.damage / full(h).damage).toFixed(1)}% of its damage`).join(', ') +
    ' — against 60-100% of its hull, because no module in the game adds hull, only multiplies it';
})());
// Which is also the rule that makes the monotonicity check below arithmetic
// rather than luck: every purchasable hull's guns are its hardpoints.
check('a hull\'s own guns are worth one emitter per hardpoint, and the starter is the exception',
  BOUGHT.every(([h, H]) => H.attrs.damage === DAMAGE_PER_HARDPOINT * slotsOf(h).weapon) &&
  HULLS[DEFAULT_HULL].attrs.damage === 30,
  `${DAMAGE_PER_HARDPOINT} a hardpoint — ` + BOUGHT.map(([h, H]) => `${h} ${H.attrs.damage}`).join(', ') +
  '; the Hauler keeps 30 because balance.js\'s ANCHOR is a Hauler with one MK-I and its 74.88 dps ' +
  'is the zero point of every bounty in the game');

console.log('\nfit validation');
check('unknown items are dropped',
  sanitiseFit('vanguard', fit({ weapon: ['emitter1', 'wat'] })).weapon.join() === 'emitter1');
check('an item in the wrong kind of slot is dropped',
  sanitiseFit('vanguard', fit({ weapon: ['plating'], tech: ['emitter1'] })).weapon.length === 0);
check('weapons and generators stack, technologies do not',
  sanitiseFit('bulwark', fit({ weapon: ['emitter1', 'emitter1'] })).weapon.length === 2
  && sanitiseFit('kestrel', fit({ tech: ['plating', 'plating'] })).tech.length === 1,
  'or an interceptor with three tech slots out-tanks a cruiser');
check('a rack cannot exceed the hull\'s slot count',
  sanitiseFit('vanguard', fit({ weapon: Array(9).fill('emitter1') })).weapon.length === slotsOf('vanguard').weapon);
check('the launcher cap is the hull\'s, not the shelf\'s', (() => {
  const racks = h => sanitiseFit(h, fit({ weapon: Array(9).fill('pod3') })).weapon.length;
  // A Vanguard is the only hull with more than four hardpoints and the only one
  // allowed more than three racks, so the cap now PERMITS rather than restricts.
  return racks('vanguard') === 5 && racks('bulwark') === 3 && racks('kestrel') === 2 && racks('hauler') === 1;
})(), 'vanguard 5, bulwark 3 (of 4 hardpoints), kestrel 2, hauler 1');
check('a Vanguard is the only hull that can put five racks in the air',
  Object.entries(HULLS).filter(([h]) => slotsOf(h).launchers > 3).map(([h]) => h).join() === 'vanguard',
  'a launcher is the one module sanitiseDrones will never let a drone carry, which is what makes ' +
  'a hardpoint worth having over a bay');
check('garbage input yields an empty rack',
  fitCount(sanitiseFit('vanguard', 'not-an-array')) === 0 && fitCount(sanitiseFit('vanguard', null)) === 0);
check('changing hull returns whatever no longer fits to the locker', (() => {
  const from = fit({ weapon: ['emitter1', 'emitter1', 'emitter1', 'emitter1'], tech: ['plating'] });
  const { fit: kept, gear } = reseat(slotsOf('kestrel'), from, {});
  return kept.weapon.length === 2 && gear.emitter1 === 2 && kept.tech.length === 1;
})(), 'nothing evaporates');

console.log('\nvitals');
const s = newShip(6000, 4000, 'vanguard', []);
check('a new ship starts full', s.hp === s.stats.hull && s.shield === s.stats.shield);
const d1 = applyDamage(s, 300);
check('shields take the hit first', d1.shield === 300 && d1.hull === 0 && s.hp === s.stats.hull);
const d2 = applyDamage(s, 1000);
check('overflow spills into the hull', d2.shield === 600 && d2.hull === 400 && s.shield === 0);
check('taking damage resets the regen clock', s.sinceHit === 0);
for (let i = 0; i < Math.round(30 * (s.stats.shieldDelay - 0.2)); i++) stepVitals(s, dt);
check('no regen before the delay elapses', s.shield === 0, `${s.stats.shieldDelay}s delay`);
for (let i = 0; i < 30 * 2; i++) stepVitals(s, dt);
// A SHARE of the pool per second, not an amount — so the seconds to full are a
// property of the hull and stay that way however big the shield gets. As an amount
// it was 168s on a finished Bulwark and 5,376s once the research ladder multiplied
// the pool by 32, which is not slow regeneration, it is none.
check('shields come back at a share of the pool, so the seconds to full never change',
  Math.abs(s.shield - s.stats.shield * s.stats.shieldRegen * 1.8) < s.stats.shield * s.stats.shieldRegen * 0.15,
  `${s.shield.toFixed(0)} after ~1.8s of a ${Math.round(s.stats.shield)} pool — ` +
  `${(1 / s.stats.shieldRegen).toFixed(0)}s to full, whatever the pool is`);
for (let i = 0; i < 30 * 60; i++) stepVitals(s, dt);
check('regen stops at the maximum', s.shield === s.stats.shield);
// The claim the whole change exists for: the seconds to full are a property of the
// hull and stay that way however large the pool gets. As an amount it was 56s bare,
// 168s finished and 5,376s at x32 research — ninety minutes, which is not slow
// regeneration, it is none with extra steps.
{
  const { applyResearch, addMod, MODULE_KEYS } = await import('../shared/research.js');
  let full = 0; for (const k of MODULE_KEYS) full = addMod(full, k);
  const secs = st => 1 / st.shieldRegen;
  const rows = Object.keys(HULLS).filter(h => HULLS[h].price >= 0).map(h => {
    const bare = resolve(h);
    return [h, secs(bare), secs(applyResearch(bare, full)), bare.shield,
            applyResearch(bare, full).shield];
  });
  check('a shield takes the same time to come back however big it has grown',
    rows.every(([, a, b]) => Math.abs(a - b) < 0.001),
    rows.map(([h, a, , sh, big]) => `${h} ${a.toFixed(0)}s at ${Math.round(sh)} and at ${Math.round(big)}`).join(', '));
  check('and the hulls still differ from each other, which is the part worth keeping',
    Math.max(...rows.map(r => r[1])) / Math.min(...rows.map(r => r[1])) > 3,
    rows.map(([h, a]) => `${h} ${a.toFixed(0)}s`).join(', ') + ' — the tank is still the slow one');
}
check('the hull never regenerates in the field', s.hp === s.stats.hull - 400);
const hit = applyDamage(s, 5000);
check('a ship dies when the hull is gone', hit.dead && s.hp === 0);

console.log('\nmodules change the ship');
const stock = newShip(0, 0, 'vanguard', []);
const tanked = newShip(0, 0, 'vanguard', fit({ tech: ['plating'], generator: ['cellA', 'cellA'] }));
check('a fit raises the pools it should',
  tanked.stats.hull > stock.stats.hull && tanked.stats.shield > stock.stats.shield,
  `${stock.stats.hull}/${stock.stats.shield} -> ${tanked.stats.hull}/${tanked.stats.shield}`);
check('and pays for it in speed', tanked.stats.speed < stock.stats.speed,
  `${Math.round(stock.stats.speed)} -> ${Math.round(tanked.stats.speed)}`);
check('starting vitals follow the fit', tanked.hp === tanked.stats.hull && tanked.shield === tanked.stats.shield);

const fast = newShip(600, 4000, 'kestrel', ['thruster']), slow = newShip(600, 4000, 'bulwark', []);
fast.dx = slow.dx = 1; fast.dy = slow.dy = 0;
for (let i = 0; i < 30 * 8; i++) { step(fast, dt); step(slow, dt); }
check('movement reads speed off the fit, not a constant', fast.x - slow.x > 900,
  `${(fast.x - 600) | 0}px vs ${(slow.x - 600) | 0}px in 8s`);

const swapped = refit(newShip(0, 0, 'kestrel'), 'bulwark', fit({ tech: ['plating'] }));
check('refit rebuilds stats, size and vitals',
  swapped.stats.hull === resolve('bulwark', fit({ tech: ['plating'] })).hull && swapped.r === HULLS.bulwark.r
  && swapped.hp === swapped.stats.hull && swapped.shield === swapped.stats.shield);

console.log('\nbase zone');
const homes = GALAXY.filter(id => MAPS[id].base);
check('every home map has a base, and only home maps do',
  homes.length === 3 && homes.every(h => MAPS[h].home)
  && GALAXY.every(id => !MAPS[id].base || MAPS[id].home), homes.join(', '));
check('the testing ground is not in the galaxy at all',
  !GALAXY.includes('dev') && MAPS.dev.dev && MAPS.dev.portals.length === 0 && !MAPS.dev.owner,
  'no portals lead to it, it owns nothing, and nothing spawns there');
check('the zone sits inside the map and clear of portals', homes.every(h => {
  const b = MAPS[h].base;
  return b.x - b.r > 0 && b.y - b.r > 0 && b.x + b.r < MAP_W && b.y + b.r < MAP_H
      && MAPS[h].portals.every(p => Math.hypot(p.x - b.x, p.y - b.y) > b.r + PORTAL_R);
}));
check('inBase is a real boundary',
  inBase(MAPS.m1, { x: 6000, y: 4000 }) && !inBase(MAPS.m1, { x: 6000 + MAPS.m1.base.r + 5, y: 4000 })
  && !inBase(MAPS.g1, { x: 6000, y: 4000 }), 'and non-home maps have none');

const wreck = () => { const w = newShip(0, 0, 'vanguard', []); applyDamage(w, w.stats.hull * 0.8 + w.stats.shield); return w; };
const adrift = wreck();
for (let i = 0; i < 30 * 30; i++) stepVitals(adrift, dt, false);
check('adrift, the hull stays broken', adrift.hp === Math.round(adrift.stats.hull * 0.2 * 1e6) / 1e6 || Math.abs(adrift.hp - adrift.stats.hull * 0.2) < 1,
  `${adrift.hp.toFixed(0)}/${adrift.stats.hull} after 30s`);
check('adrift, shields still come back', adrift.shield === adrift.stats.shield);
const berthed = wreck();
let secs = 0;
while (berthed.hp < berthed.stats.hull && secs < 60) { stepVitals(berthed, dt, true); secs += dt; }
check('docked, the hull repairs', berthed.hp === berthed.stats.hull, `full in ${secs.toFixed(1)}s`);
check('docked repair matches the declared rate',
  Math.abs(secs - (DOCK_INTERRUPT + 0.8 / DOCK_HULL_RATE)) < 0.5,
  `${(DOCK_HULL_RATE * 100).toFixed(0)}%/s after a ${DOCK_INTERRUPT}s pause`);
const nodelay = wreck();
for (let i = 0; i < Math.round(30 * DOCK_INTERRUPT) + 2; i++) stepVitals(nodelay, dt, true);
check('docking ignores the shield delay', nodelay.shield > 0, 'no waiting at your own dock');
const underFire = wreck();
for (let i = 0; i < 30 * 10; i++) { applyDamage(underFire, 1); stepVitals(underFire, dt, true); }
check('the dock will not repair you while you are being shot',
  underFire.hp < underFire.stats.hull * 0.25 && underFire.shield === 0,
  'so running home is not a free escape');

console.log('\nstation layout');
{
  const { bayLayout, STORE_PAGES, TABS } = await import('../shared/hangar.js');
  let outside = 0, overlap = 0, offscreen = 0, tightest = 1e9, empty = 0, checked = 0;
  const ALL_HULLS = Object.keys(HULLS), ALL_FORMS = FORMATION_KEYS;
  const sizes = [[1920,1080],[1600,900],[1440,900],[1280,800],[1100,700],[1024,640]];
  const states = [];
  for (const drones of [0, 3, 6, MAX_DRONES])            // a full bay is the tightest panel
    for (const hull of ALL_HULLS)
      states.push({ hull, drones, hulls: ALL_HULLS, formations: ALL_FORMS });
  states.push({ hull: DEFAULT_HULL, drones: 0, hulls: [], formations: ['line'] });  // a brand new pilot

  for (const [W, H] of sizes)
    for (const st of states)
      for (const tab of TABS.map(t => t.key))
        for (const page of (tab === 'store' ? STORE_PAGES.map(p2 => p2.key) : ['ships'])) {
          const L = bayLayout(W, H, { ...st, tab, page }), P = L.panel;
          checked++;
          if (P.x < 0 || P.y < 0 || P.x + P.w > W || P.y + P.h > H) offscreen++;
          const rows = [...L.hulls, ...L.racks.filter(r => !r.header), ...L.pages, ...L.store];
          // Nothing to click is a dead page — with two honest exceptions. The drone
          // page empties once every bay is full, and the INVENTORY is empty
          // whenever a pilot has nothing spare, which for most pilots most of the
          // time is the normal state of it rather than a fault. A shop shelf with
          // nothing on it is still a bug.
          // STATS has no clickable rows at all, by design — it is a readout of where
          // your numbers came from, not a shelf. It is checked separately below,
          // because "has nothing to click" and "is broken" must not look the same.
          const mayBeEmpty = (tab === 'store' && page === 'drones' && st.drones === 6)
                          || tab === 'inventory' || tab === 'stats';
          if (!rows.length && !mayBeEmpty) empty++;
          for (const { r } of rows) {
            // a row outside the panel is read as a click on the backdrop, which
            // closes the station instead of selecting anything
            if (r.x < P.x || r.y < P.y || r.x + r.w > P.x + P.w || r.y + r.h > P.y + P.h) outside++;
            tightest = Math.min(tightest, (P.y + P.h) - (r.y + r.h));
          }
          // Columns are independent now, so overlap is only meaningful within one.
          const cols = new Map();
          for (const o of [...L.hulls, ...L.racks, ...L.pages, ...L.store])
            (cols.get(Math.round(o.r.x)) ?? cols.set(Math.round(o.r.x), []).get(Math.round(o.r.x))).push(o.r);
          for (const col of cols.values()) {
            col.sort((a, b) => a.y - b.y);
            for (let i = 1; i < col.length; i++) if (col[i].y < col[i-1].y + col[i-1].h - 0.01) overlap++;
          }
        }
  // A chooser that opens off the panel is a chooser you cannot click, which is
  // exactly how the module rack broke the first time. Every slot, every size.
  {
    const { pickerLayout, fitsIn } = await import('../shared/hangar.js');
    const locker = Object.fromEntries(Object.keys(EQUIPMENT).map(k => [k, 2]));
    let off = 0, checkedPickers = 0, biggest = 0;
    for (const [W, H] of sizes)
      for (const st of states) {
        const L = bayLayout(W, H, { ...st, tab: 'hangar' }), P = L.panel;
        for (const row of L.racks.filter(r => !r.header)) {
          const items = fitsIn(row.slot, { gear: locker, fit: emptyFit(), drones: [] });
          if (!items.length) continue;
          const { box, rows } = pickerLayout(L, row, items);
          checkedPickers++;
          biggest = Math.max(biggest, rows.length);
          if (box.x < P.x || box.y < P.y || box.x + box.w > P.x + P.w || box.y + box.h > P.y + P.h) off++;
          for (const r of rows)
            if (r.r.x < P.x || r.r.y < P.y || r.r.x + r.r.w > P.x + P.w || r.r.y + r.r.h > P.y + P.h) off++;
        }
      }
    check('a slot chooser always opens inside the panel', off === 0,
          `${checkedPickers} of them, up to ${biggest} rows, flipped up near the bottom`);
  }

  check('every row stays inside the panel', outside === 0,
        `${checked} layouts, ${tightest | 0}px of slack at the tightest`);
  check('rows never overlap each other, column by column', overlap === 0);
  check('the panel itself always fits the window', offscreen === 0);
  // And the readout is not allowed to be empty either — it just has its rows
  // somewhere else. Without this, "stats may be empty" would hide a stats tab that
  // had quietly stopped laying anything out.
  {
    const B = await import('../shared/breakdown.js');
    const { GROUPS, DERIVED, rowsOf, fmt, hintOf, improves, HINT_COLS, hintRoom } = B;
    const FIT = { weapon: ['emitter3'], generator: ['cellA'], tech: [] };
    const page = hull => rowsOf({ hull, fit: FIT, drones: [], rig: null,
                                  formation: 'line', mask: 0 });
    const keysOn = hull => page(hull).filter(r => !r.header).map(r => r.key);

    // THE GUARD. Every attribute a ship has must reach the page on some hull, and
    // no attribute may be listed under two headings. Without this the page is a
    // hand-written list beside a table of facts, which is exactly how it came to
    // be missing fourteen of twenty-five with nothing failing.
    const want = [...Object.keys(ATTRS), ...Object.keys(DERIVED)];
    const reach = new Set(Object.keys(HULLS).flatMap(keysOn));
    const orphan = want.filter(k => !reach.has(k));
    const twice = want.filter(k => GROUPS.filter(g => g.of.includes(k)).length > 1);
    check('every attribute a ship has reaches the stats page',
      orphan.length === 0 && twice.length === 0,
      orphan.length ? `never shown anywhere: ${orphan.join(' ')}`
      : twice.length ? `listed under two headings: ${twice.join(' ')}`
      : `${Object.keys(ATTRS).length} in ATTRS plus the derived reactor ceiling, ` +
        `all ${want.length} on a page, none twice — add a row to ATTRS without a group and this fails by name`);

    // An ability dial is a fact about ONE hull. The shop already refuses to sell a
    // Null Skin to a Bulwark and the tooltip already says "Nothing on this hull";
    // a stats page that lists veilRecover on a Bulwark contradicts both of them
    // one tab away, and a page that hides anchorDrag from a Bulwark is the
    // incompleteness being complained about, one row further on.
    const bul = keysOn('bulwark'), kes = keysOn('kestrel'), hau = page('hauler');
    check('an ability dial is only on the page of the hull that has that ability',
      bul.includes('anchorSwell') && !bul.some(k => k.startsWith('veil'))
      && kes.includes('veilDepth') && !kes.some(k => k.startsWith('anchor')),
      'a Bulwark reads Anchor swell and Anchor drag and no Veil at all; a Kestrel the other way round');
    check('and the hull with no ability says so rather than showing nothing',
      hau.some(r => r.header && /FOURTH SYSTEM/.test(r.label) && /No system of its own/.test(r.note ?? '')),
      'an absent heading reads as a page that broke; the Hauler is a ship without one, which is different');

    // Formatting. Every one of these printed wrong before the fourteen arrived, and
    // eleven whole numbers is why nobody noticed.
    check('a share reads as a share and not as 0.0179',
      fmt('shieldRegen', 0.0179) === '1.79%/s' && fmt('sustain', 0.33) === '33%'
      && /^56s to refill/.test(hintOf('shieldRegen', 0.0179) ?? ''),
      `shield regen ${fmt('shieldRegen', 0.0179)} — "${hintOf('shieldRegen', 0.0179)}" — ` +
      'the page printed "0.0%" and the seconds are the number a pilot actually wants');
    check('a multiple reads as a multiple',
      fmt('escort', 1) === 'x1.00' && fmt('anchorSwell', 3) === 'x3.00',
      `escort bonus ${fmt('escort', 1)}, anchor swell ${fmt('anchorSwell', 3)} — the unit ` +
      'was appended after a rounded number, so they read "1x" and "3x"');
    check('nothing on the page is rounded into a different number',
      fmt('fireRate', 1.2) === '1.2/s' && fmt('signature', 5.5) === '5.5s'
      && fmt('cohesion', 3) === '3 drones' && fmt('hull', 10792.4) === '10,792',
      `${fmt('fireRate', 1.2)}  ${fmt('signature', 5.5)}  ${fmt('cohesion', 3)}  ${fmt('hull', 10792.4)} — ` +
      'Math.round() made those 1, 6, 3 and 10,792');
    // The sweep, so a new attribute cannot arrive with a shape nothing formats.
    const vanished = want.filter(k => {
      const v = ATTRS[k]?.dflt ?? DERIVED[k]?.dflt ?? 0;
      return v !== 0 && /^[0x]*(\.0+)?%?$/.test(fmt(k, v).replace(/[,\/a-z ]/g, ''));
    });
    check('no attribute at its shipped setting prints as zero', vanished.length === 0,
      vanished.length ? vanished.map(k => `${k} -> ${fmt(k, ATTRS[k]?.dflt)}`).join(', ')
                      : `all ${want.length} of them print as themselves`);

    check('a stat that is better low reads as an improvement when it falls',
      improves('signature', 5.5, 2.2) === true && improves('anchorDrag', 0.8, 0.32) === true
      && improves('hull', 1900, 950) === false && improves('hull', 1900, 1900) === null,
      'the page coloured by direction, so a Null Skin halving your signature drew in the colour it uses for a penalty');

    const longest = Math.max(...Object.keys(HULLS).flatMap(h => page(h)).map(r => (r.hint ?? '').length));
    check('every sentence saying what a number means fits beside its label',
      longest <= HINT_COLS,
      `longest is ${longest} of ${HINT_COLS} columns — the same budget rule as TIP_COLS, ` +
      'and for the same reason: a line that runs out of the frame is no line');

    // Twice as many rows plus eight headings, so the scroll has to still reach the
    // bottom of it. Measured at every window size the panel is laid out for.
    let short = [], loose = [];
    for (const [W, H] of sizes) {
      const L = bayLayout(W, H, { tab: 'stats', hull: 'bulwark', fit: FIT, escort: [],
                                  formation: 'line', mask: 0, scroll: 1e6 });
      const last = L.stats.at(-1), floor = L.body.y + L.body.h;
      if (!last || last.key !== 'anchorDrag' || last.r.y + last.r.h > floor + 0.5) short.push(`${W}x${H}`);
      if (L.bar && Math.abs((L.bar.y + L.bar.h) - floor) > 0.5) loose.push(`${W}x${H}`);
    }
    check('the stats page still scrolls all the way to its last row', short.length === 0 && loose.length === 0,
      short.length ? `never reaches the bottom at ${short.join(' ')}`
      : loose.length ? `the bar does not bottom out at ${loose.join(' ')}`
      : (() => { const L = bayLayout(1600, 900, { tab: 'stats', hull: 'bulwark', fit: FIT,
                   escort: [], formation: 'line', mask: 0, scroll: 0 });
                 return `${L.scroll.span}px of page in ${Math.round(L.room)}px of window, ` +
                        `${Math.round(L.scroll.max)}px of scroll, and the bar bottoms out flush`; })());

    const L = bayLayout(1600, 900, { tab: 'stats', hull: 'vanguard', fit: FIT,
      escort: [], formation: 'line', mask: 0, scroll: 0 });
    const heads = page('vanguard').filter(r => r.header).length;
    check('the stats page lists every attribute, not only the ones something changed',
      (L.stats ?? []).length > 0 && page('vanguard').length === keysOn('vanguard').length + heads,
      `${keysOn('vanguard').length} attributes under ${heads} headings, ${L.stats.length} on screen at once, ` +
      `${Math.round(L.scroll.max)}px to scroll — a stat nothing touched still gets a line, ` +
      'or its absence reads as "this ship has no cargo hold"');
    check('and every one of its rows is inside the window it scrolls behind',
      L.stats.every(r => r.r.x >= L.body.x && r.r.x + r.r.w <= L.body.x + L.body.w),
      'vertically they overhang and the client clips, the same as the threat file');
    check('and the sentences drop out before they run under the numbers',
      hintRoom(bayLayout(1600, 900, { tab: 'stats' }).body.w)
      && !hintRoom(bayLayout(760, 540, { tab: 'stats' }).body.w),
      'a 940px page carries them; a 670px one is every number it was, without the prose');
  }

  check('no shelf that sells anything is ever empty', empty === 0,
        'the drone page once every bay is full, and the inventory when you own nothing spare, ' +
        'are the only two that may be — and the inventory says so in words rather than showing a void');

  // Everything buyable must appear on exactly one page, or it is unreachable.
  const { pageItems } = await import('../shared/hangar.js');
  const listed = new Set();
  for (const p2 of STORE_PAGES)
    for (const it of pageItems(p2.key, { hulls: [], formations: [], drones: 0 })) {
      check(`${it.k} is listed once`, !listed.has(it.k), '');
      listed.add(it.k);
    }
  const want = [...Object.keys(EQUIPMENT), ...Object.keys(HULLS), ...FORMATION_KEYS, 'drone'];
  check('every purchasable thing has a page', want.every(k => listed.has(k)),
        want.filter(k => !listed.has(k)).join(' ') || `${listed.size} rows across ${STORE_PAGES.length} pages`);
}

// ------------------------------------------------------------------ tooltips
console.log('\ntooltips');
{
  const { tipFor, diffLines } = await import('../shared/tooltip.js');
  const ctx = { hull: 'vanguard', fit: fit({ weapon: ['emitter1'] }), drones: ['emitter1'],
                formation: 'line', gear: { plating: 1 }, hulls: ['hauler', 'vanguard'], formations: ['line'] };
  const every = [
    ...Object.keys(EQUIPMENT).map(k => ['item', k]),
    ...Object.keys(HULLS).filter(k => k !== 'vanguard').map(k => ['hull', k]),
    ...FORMATION_KEYS.filter(k => k !== 'line').map(k => ['form', k]),
    ['drone', 'drone'],
  ];
  const tips = every.map(([kind, k]) => [kind, k, tipFor(kind, k, ctx)]);
  check('everything on sale has a tooltip', tips.every(([, , t]) => t),
        tips.filter(([, , t]) => !t).map(([, k]) => k).join(' '));
  // Everything except the one entry that HAS no numbers. A Shear Compensator moves
  // no attribute — it sells a rule — so it says what it lets you do and what that
  // costs, and demanding a percentage of it would be demanding the shelf go back
  // to being percentages.
  check('every tooltip with numbers in it states them',
        tips.every(([, k, t]) => t.lines.length > 0 || (EQUIPMENT[k]?.mods?.length === 0 && t.does)),
        'a blurb alone does not say how much');
  check('no tooltip line is NaN or undefined',
        tips.every(([, , t]) => t.lines.every(l => Number.isFinite(l.from) && Number.isFinite(l.to)
                                               && (l.pct === null || Number.isFinite(l.pct)))));
  check('a tooltip agrees with the ship it describes',
        tipFor('item', 'plating', ctx).lines.some(l => l.key === 'hull' && l.pct === 50),
        'Composite Plating is half again the hull, and says so');
  const damp = tipFor('item', 'filter', ctx);
  console.log(`     ${damp.title}: ` + damp.lines.map(l => `${l.label} ${l.from}→${l.to}${l.unit} (${l.pct}%)`).join(', '));
  check('a downside reads as a downside', damp.lines.find(l => l.key === 'signature').good === false
                                       && tipFor('item', 'plating', ctx).lines.find(l => l.key === 'hull').good === true,
        'lower radar is bad, lower signature is good');
  check('the drone tip prices the next bay, not the first',
        tipFor('drone', 'drone', ctx).price === tipFor('drone', 'drone', { ...ctx, drones: [] }).price + 2600);
  check('a formation with no drones still explains itself',
        (tipFor('form', 'wedge', { ...ctx, drones: [] })?.sub ?? '').includes('no effect'));
  check('an unknown key returns nothing rather than throwing',
        tipFor('item', 'nonesuch', ctx) === null && tipFor('hull', 'nonesuch', ctx) === null);
}

// ------------------------------------------------------------- the power curve
// How far a finished ship is meant to sit above a new one. The ceiling is set
// from the fiction: the things waiting on the far maps one-shot anyone who
// wandered out there in a starter hull, so a finished ship has to hit that hard.
console.log('\nthe power curve');
{
  const TOP = topTier('weapon'), CELL = topTier('generator');
  const specced = h => {
    const sl = slotsOf(h);
    return resolve(h, fit({ weapon: Array(sl.weapon).fill(TOP),
                            generator: Array(sl.generator).fill(CELL),
                            tech: sl.tech ? ['plating'] : [] }), Array(6).fill(TOP), 'wedge');
  };
  const volley = st => st.damage * (1 + BOOST);
  const weak = resolve(DEFAULT_HULL, fit({ weapon: ['emitter1'] }));
  const weakEhp = weak.hull + weak.shield;

  for (const h of Object.keys(HULLS)) {
    const st = specced(h);
    console.log(`     ${HULLS[h].cls.padEnd(12)} volley ${String(Math.round(volley(st))).padStart(5)}` +
                `   ehp ${String(Math.round(st.hull + st.shield)).padStart(5)}   speed ${Math.round(st.speed)}`);
  }
  console.log(`     a new pilot flies ${Math.round(weakEhp)} effective hp and throws ` +
              `${Math.round(volley(weak))} a volley`);

  check('a finished ship one-shots a new one',
    Object.keys(HULLS).every(h => volley(specced(h)) > weakEhp),
    `every hull clears ${Math.round(weakEhp)} ehp with room`);
  check('and it is not close', volley(specced('kestrel')) > weakEhp * 3,
    `${(volley(specced('kestrel')) / weakEhp).toFixed(1)}x over`);
  // The other end of the same rule: two finished ships must not delete each
  // other on sight, or the top of the game has no fight left in it.
  check('but a finished Cruiser survives a finished volley',
    (() => { const c = specced('bulwark'); return c.hull + c.shield > volley(specced('bulwark')); })(),
    'shields climb with the guns');

  const ladder = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'laser')
    .sort((a, b) => EQUIPMENT[a].tier - EQUIPMENT[b].tier);
  const dmgOf = k => EQUIPMENT[k].mods.find(([a]) => a === 'damage')[2];
  console.log('     emitters: ' + ladder.map(k => `${EQUIPMENT[k].name.split(' ')[0]} ${dmgOf(k)}`).join('  '));
  check('every rung of the weapon ladder is a real step up',
    ladder.every((k, i) => i === 0 || dmgOf(k) >= dmgOf(ladder[i - 1]) * 1.7),
    'no rung is a rounding error on the one below');
  check('and costs more than the rung below',
    ladder.every((k, i) => i === 0 || EQUIPMENT[k].price > EQUIPMENT[ladder[i - 1]].price));
  const cells = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'generator')
    .sort((a, b) => EQUIPMENT[a].tier - EQUIPMENT[b].tier);
  const shOf = k => EQUIPMENT[k].mods.find(([a]) => a === 'shield')[2];
  check('the shield ladder climbs with the weapon ladder',
    shOf(cells.at(-1)) / shOf(cells[0]) > dmgOf(ladder.at(-1)) / dmgOf(ladder[0]) * 0.4,
    `shields ${(shOf(cells.at(-1)) / shOf(cells[0])).toFixed(0)}x across the ladder, ` +
    `guns ${(dmgOf(ladder.at(-1)) / dmgOf(ladder[0])).toFixed(0)}x`);
}

// ------------------------------------------------------------ what mods may do
// Racks fill a hull out, technology changes its shape. Keeping the two kinds of
// mod apart is what stops "buy one more emitter" and "buy a technology" from
// being the same decision.
console.log('\nabsolute racks, multiplying technology');
{
  const byOp = k => [...new Set(EQUIPMENT[k].mods.map(([, op]) => op))].sort();
  for (const slot of ['weapon', 'generator']) {
    const wrong = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === slot && byOp(k).join() !== 'add');
    check(`every ${slot} adds an absolute amount`, wrong.length === 0,
          wrong.length ? `${wrong.join(' ')} multiplies` : Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === slot).join(' '));
  }
  // Stated as "never a flat add" rather than "always a multiplier", because the
  // Shear Compensator moves no attribute at all — what it sells is a rule, and an
  // empty mod list is the honest way to say a thing has no stats. The claim the
  // split actually needs is the negative one: nothing in the tech rack fills a
  // hull out the way a rack does.
  const wrongTech = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'tech' &&
    EQUIPMENT[k].mods.some(([, op]) => op !== 'mul'));
  check('no technology adds a flat amount', wrongTech.length === 0,
        wrongTech.length ? `${wrongTech.join(' ')} adds a flat amount`
          : `${Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'tech').length} technologies, ` +
            'every stat on them a multiplier');

  // The point of the split, stated as behaviour: the same emitter is worth the
  // same everywhere, and the same technology is worth more on a bigger hull.
  const dmg = h => resolve(h, fit({ weapon: ['emitter3'] })).damage - resolve(h, fit()).damage;
  const adds = Object.keys(HULLS).map(dmg);
  check('an emitter is worth the same on every hull', new Set(adds).size === 1, `+${adds[0]} damage anywhere`);
  const hullGain = h => resolve(h, fit({ tech: ['plating'] })).hull - resolve(h, fit()).hull;
  const gains = Object.keys(HULLS).map(h => [h, hullGain(h)]);
  console.log('     plating on each hull: ' + gains.map(([h, v]) => `${h} +${Math.round(v)}`).join('  '));
  check('a technology is worth more on the hull that has more of it',
        gains.every(([, v], i) => i === 0 || v >= gains[i - 1][1]) && gains.at(-1)[1] > gains[0][1] * 1.5,
        'which is the reason it multiplies');
}

// ---------------------------------------------------------------- formations
console.log('\nformations');
const K = FORMATION_KEYS;
check('every formation but the default costs something',
  K.every(k => k === DEFAULT_FORMATION ? FORMATIONS[k].price === 0 : FORMATIONS[k].price > 0));
check('no formation is a free upgrade',                    // anti-p2w: every bonus is paid for
  K.filter(k => FORMATIONS[k].mods.length)
   .every(k => FORMATIONS[k].mods.some(([a, , v]) => !better(a, v))),
  'each one gives something up');

const sixed = k => resolve('bulwark', fit({ weapon: ['emitter1'] }), Array(6).fill('emitter1'), k);
for (const k of K) {
  const base = sixed(DEFAULT_FORMATION), got = sixed(k);
  const diff = Object.keys(ATTRS).filter(a => Math.abs(got[a] - base[a]) > 1e-6)
    .map(a => `${a} ${got[a] > base[a] ? '+' : ''}${(100 * (got[a] / base[a] - 1)).toFixed(0)}%`);
  console.log(`     ${FORMATIONS[k].name.padEnd(17)}${String(FORMATIONS[k].price).padStart(6)}cr  ` +
              (diff.join('  ') || 'baseline'));
}
check('a formation with no drones changes nothing at all',
  Object.keys(ATTRS).every(a =>
    resolve('bulwark', fit(), [], 'wedge')[a] === resolve('bulwark', fit(), [], 'line')[a]),
  'the escort is the thing that flies it');
const half = resolve('bulwark', fit(), Array(1).fill(null), 'shell'),
      full = resolve('bulwark', fit(), Array(3).fill(null), 'shell'),
      over = resolve('bulwark', fit(), Array(6).fill(null), 'shell'),
      none = resolve('bulwark', fit(), [], 'shell');
check('the bonus scales in with the escort and caps at three',
  half.shield > none.shield && full.shield > half.shield && over.shield === full.shield,
  `${none.shield | 0} → ${half.shield | 0} → ${full.shield | 0} → ${over.shield | 0} shield`);
check('an unknown formation falls back to the default, it does not throw',
  resolve('bulwark', fit(), ['emitter1'], 'nonesuch').shield === resolve('bulwark', fit(), ['emitter1']).shield);

// Clearance is measured edge to edge with the sizes the client actually draws
// at. Centre-to-centre spacing looked fine while a six-drone Bulwark was flying
// with its escort sitting on top of its own cannons.
const CLEAR = 0.9;                                    // drone-widths of daylight, minimum
for (const k of K) {
  const seen = new Set();
  let worstPair = 99, worstHull = 99, reach = 0;
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const pts = formSlots(k, n);
    check(`${k} seats exactly ${n} drone${n === 1 ? '' : 's'}`, pts.length === n);
    pts.forEach((pt, i) => {
      const d = Math.hypot(pt.fwd, pt.lat);
      worstHull = Math.min(worstHull, d - DRONE_R - HULL_R);
      reach = Math.max(reach, d + DRONE_R);
      if (d - DRONE_R - HULL_R < CLEAR) seen.add(`${k}@${n} sits on the hull`);
      pts.forEach((q, j) => {
        if (j <= i) return;
        const gap = Math.hypot(pt.fwd - q.fwd, pt.lat - q.lat) - 2 * DRONE_R;
        worstPair = Math.min(worstPair, gap);
        if (gap < CLEAR) seen.add(`${k}@${n} drones overlap`);
      });
    });
  }
  check(`${k} keeps its escort clear of the hull and of itself`, seen.size === 0,
        [...seen][0] ?? `${worstPair.toFixed(1)}R between drones, ${worstHull.toFixed(1)}R off the hull`);
  check(`${k} keeps the escort on screen`, reach < 11, `reaches ${reach.toFixed(1)}R`);
}
const spread = k => Math.max(...formSlots(k, 6).map(p2 => Math.hypot(p2.fwd, p2.lat)));
check('no two formations look the same',
  new Set(K.map(k => formSlots(k, 4).map(p2 => `${p2.fwd.toFixed(1)},${p2.lat.toFixed(1)}`).join('|'))).size === K.length,
  K.map(k => `${k} ${spread(k).toFixed(1)}R`).join('  '));

// --------------------------------------------------------------- hardpoints
console.log('\nhardpoints');
const gunship = newShip(0, 0, 'bulwark', fit({ weapon: ['emitter1', 'emitter1'] }),
                        ['emitter1', 'cellA', 'emitter1'], 'wedge');
gunship.heading = 0;
const hp = hardpoints(gunship);
check('bolts leave the rack and every armed drone, and nothing else',
  hp.length === 4, `2 cannons + 2 of 3 drones (the generator bay is not a gun)`);
check('a drone hardpoint sits where that drone is drawn',
  hp.slice(2).every((h, i) => {
    const d = droneAt(gunship, [0, 2][i]);
    return Math.hypot(h.x - d.x, h.y - d.y) < 1e-6;
  }));
check('an alien fires from itself, drones or not',
  hardpoints({ isAlien: true, x: 5, y: 7 }).length === 1);
const empty = newShip(0, 0, 'hauler', fit({ weapon: ['emitter1'] }), [null, null], 'shell');
check('drones with nothing mounted never shoot', hardpoints(empty).length === 2);

// ------------------------------------------------------------- fire rate
console.log('\nrate of fire');
const dps = (hull, drones = []) => {
  const rack = Array(slotsOf(hull).weapon).fill('emitter1');
  const st = resolve(hull, fit({ weapon: rack }), drones);
  return st.damage * st.fireRate;
};
const order = Object.keys(HULLS).map(h => ({ h, w: slotsOf(h).weapon, d: dps(h), f: dps(h, Array(6).fill('emitter1')) }))
  .sort((a, b) => a.w - b.w);
order.forEach(o => console.log(`     ${o.h.padEnd(9)} W${o.w}  rack ${o.d.toFixed(0).padStart(4)} dps` +
                               `   +6 drones ${o.f.toFixed(0).padStart(4)} dps`));
check('every hull cycles its guns at the same rate',
  new Set(Object.keys(HULLS).map(h => resolve(h, fit()).fireRate)).size === 1,
  `${FIRE_RATE}/s everywhere — otherwise rate multiplies every emitter and weapon slots stop mattering`);
check('more weapon slots always means more damage',
  order.every((o, i) => i === 0 || o.d > order[i - 1].d) &&
  order.every((o, i) => i === 0 || o.f > order[i - 1].f),
  'with an empty escort and a full one');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(HULLS).length} hulls, ${Object.keys(EQUIPMENT).length} store items`}\n`);
process.exit(fails.length ? 1 : 0);
