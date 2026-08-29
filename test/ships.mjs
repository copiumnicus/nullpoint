import { ATTRS, HULLS, DEFAULT_HULL, resolve, sanitiseFit, slotsOf, FIRE_RATE } from '../shared/ships.js';
import { EQUIPMENT, SLOTS, emptyFit, fitCount, reseat, topTier } from '../shared/gear.js';
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
  // cellA adds a flat 120 shield; plating then multiplies hull by 1.35.
  // vanguard is 1100 hull / 900 shield / 340 speed.
  const r = resolve('vanguard', fit({ generator: ['cellA'], tech: ['plating'] }));
  return r.shield === 1020 && Math.abs(r.hull - 1100 * 1.35) < 1e-6
      && Math.abs(r.speed - (340 - 8) * 0.91) < 1e-6;
})());
check('percentages sum instead of compounding', (() => {
  // expander -12% speed and plating -9%: 0.79, not 0.88 x 0.91 = 0.8008
  const r = resolve('vanguard', fit({ tech: ['expander', 'plating'] }));
  return Math.abs(r.speed - 340 * 0.79) < 1e-6;
})(), 'two technologies are worth two, never less');
check('attributes are clamped to their floor', (() => {
  EQUIPMENT.__sink = { name: 'sink', slot: 'tech', price: 1, mods: [['speed', 'mul', -5]] };
  const r = resolve('vanguard', fit({ tech: ['__sink'] }));
  delete EQUIPMENT.__sink;
  return r.speed === ATTRS.speed.min;
})());

console.log('\nbalance invariants');
for (const [k, M] of Object.entries(EQUIPMENT))
  if (M.slot === 'tech')
    check(`${M.name} costs something`, M.mods.some(([a, , v]) => !better(a, v)),
      'technologies are trade-offs, not upgrades');
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
const totals = BOUGHT.map(([h]) => SLOTS.reduce((n, s2) => n + slotsOf(h)[s2], 0));
check('every purchasable hull has the same TOTAL slots, distributed differently',
  new Set(totals).size === 1 && new Set(BOUGHT.map(([h]) => JSON.stringify(slotsOf(h)))).size === BOUGHT.length,
  `${totals[0]} slots each: ` + BOUGHT.map(([h]) => {
    const s2 = slotsOf(h); return `${h} W${s2.weapon}G${s2.generator}T${s2.tech}`; }).join(', '));
check('the starter has fewer slots than any of them',
  SLOTS.reduce((n, s2) => n + slotsOf(DEFAULT_HULL)[s2], 0) < totals[0]);

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
check('shields come back at the stated rate',
  Math.abs(s.shield - s.stats.shieldRegen * 1.8) < s.stats.shieldRegen * 0.15, `${s.shield.toFixed(0)} after ~1.8s`);
for (let i = 0; i < 30 * 60; i++) stepVitals(s, dt);
check('regen stops at the maximum', s.shield === s.stats.shield);
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
  for (const drones of [0, 3, 6])
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
          // Nothing to click is a dead page — the drone page legitimately empties
          // once every bay is full, and nothing else may.
          if (!rows.length && !(tab === 'store' && page === 'drones' && st.drones === 6)) empty++;
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
  check('no tab or store page is empty', empty === 0);

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
  check('every tooltip states at least one real number', tips.every(([, , t]) => t.lines.length > 0),
        'a blurb alone does not say how much');
  check('no tooltip line is NaN or undefined',
        tips.every(([, , t]) => t.lines.every(l => Number.isFinite(l.from) && Number.isFinite(l.to)
                                               && (l.pct === null || Number.isFinite(l.pct)))));
  check('a tooltip agrees with the ship it describes',
        tipFor('item', 'plating', ctx).lines.some(l => l.key === 'hull' && l.pct === 35),
        'Composite Plating is a third more hull, and says so');
  const damp = tipFor('item', 'damper', ctx);
  console.log(`     ${damp.title}: ` + damp.lines.map(l => `${l.label} ${l.from}→${l.to}${l.unit} (${l.pct}%)`).join(', '));
  check('a downside reads as a downside', damp.lines.find(l => l.key === 'radar').good === false
                                       && damp.lines.find(l => l.key === 'signature').good === true,
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
  const wrongTech = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'tech' && byOp(k).join() !== 'mul');
  check('every technology is a multiplier', wrongTech.length === 0,
        wrongTech.length ? `${wrongTech.join(' ')} adds a flat amount` : 'nothing in the tech rack is a flat add');

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
