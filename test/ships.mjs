import { ATTRS, HULLS, MODULES, DEFAULT_HULL, resolve, sanitiseFit, slotsOf } from '../shared/ships.js';
import { newShip, refit, step, stepVitals, stepDrift, applyDamage, inBase, driftDepth, driftDps, SHIELD_FLASH,
         DOCK_HULL_RATE, DOCK_INTERRUPT, DRIFT_MARGIN, DRIFT_MIN, DRIFT_MAX, WORLD } from '../shared/sim.js';
import { MAPS, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';

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
  MODULES.__probe = { name: 'probe', mods: [['nonsense', 'add', 999], ['hull', 'add', 10]] };
  const r = resolve('vanguard', ['__probe']);
  delete MODULES.__probe;
  return r.hull === HULLS.vanguard.attrs.hull + 10 && !('nonsense' in r);
})());
check('resolve does not mutate the hull table', (() => {
  const before = JSON.stringify(HULLS.vanguard);
  resolve('vanguard', ['plating', 'thruster']);
  return JSON.stringify(HULLS.vanguard) === before;
})());
check('flat adds apply before percentages', (() => {
  // plating: +450 hull, -8% speed. vanguard 1100 hull / 340 speed
  const r = resolve('vanguard', ['plating']);
  return r.hull === 1550 && Math.abs(r.speed - 340 * 0.92) < 1e-6;
})());
check('percentages sum instead of compounding', (() => {
  const r = resolve('vanguard', ['plating', 'plating']);      // -8% twice
  return Math.abs(r.speed - 340 * 0.84) < 1e-6;               // 0.84, not 0.92²=0.8464
})(), 'three copies are worth three, never more');
check('attributes are clamped to their floor', (() => {
  MODULES.__sink = { name: 'sink', mods: [['speed', 'mul', -5]] };
  const r = resolve('vanguard', ['__sink']);
  delete MODULES.__sink;
  return r.speed === ATTRS.speed.min;
})());

console.log('\nbalance invariants');
for (const [k, M] of Object.entries(MODULES))
  check(`${M.name} costs something`, M.mods.some(([a, , v]) => !better(a, v)));
const dominates = (A, B) => {
  const keys = ['hull','shield','shieldRegen','shieldDelay','speed','accel'];
  const cmp = keys.map(k => (ATTRS[k].better === 'high' ? 1 : -1) * (A.attrs[k] - B.attrs[k]));
  return cmp.every(v => v >= 0) && cmp.some(v => v > 0);
};
let dom = [];
for (const [ka, A] of Object.entries(HULLS)) for (const [kb, B] of Object.entries(HULLS))
  if (ka !== kb && dominates(A, B)) dom.push(`${ka} > ${kb}`);
check('no hull is strictly better than another', dom.length === 0, dom.join(', ') || 'all three are trade-offs');
check('every hull has the same slot count',
  new Set(Object.keys(HULLS).map(slotsOf)).size === 1, `${slotsOf(DEFAULT_HULL)} slots`);

console.log('\nfit validation');
check('unknown modules are dropped', sanitiseFit('vanguard', ['plating', 'wat']).join() === 'plating');
check('duplicates are dropped', sanitiseFit('vanguard', ['plating', 'plating']).length === 1);
check('a fit cannot exceed the slot count',
  sanitiseFit('vanguard', Object.keys(MODULES)).length === slotsOf('vanguard'));
check('garbage input yields an empty fit',
  sanitiseFit('vanguard', 'not-an-array').length === 0 && sanitiseFit('vanguard', null).length === 0);

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
const tanked = newShip(0, 0, 'vanguard', ['plating', 'capacitor']);
check('a fit raises the pools it should',
  tanked.stats.hull > stock.stats.hull && tanked.stats.shield > stock.stats.shield,
  `${stock.stats.hull}/${stock.stats.shield} -> ${tanked.stats.hull}/${tanked.stats.shield}`);
check('and pays for it elsewhere',
  tanked.stats.speed < stock.stats.speed && tanked.stats.shieldRegen < stock.stats.shieldRegen);
check('starting vitals follow the fit', tanked.hp === tanked.stats.hull && tanked.shield === tanked.stats.shield);

const fast = newShip(600, 4000, 'kestrel', ['thruster']), slow = newShip(600, 4000, 'bulwark', []);
fast.dx = slow.dx = 1; fast.dy = slow.dy = 0;
for (let i = 0; i < 30 * 8; i++) { step(fast, dt); step(slow, dt); }
check('movement reads speed off the fit, not a constant', fast.x - slow.x > 900,
  `${(fast.x - 600) | 0}px vs ${(slow.x - 600) | 0}px in 8s`);

const swapped = refit(newShip(0, 0, 'kestrel', []), 'bulwark', ['plating']);
check('refit rebuilds stats, size and vitals',
  swapped.stats.hull === resolve('bulwark', ['plating']).hull && swapped.r === HULLS.bulwark.r
  && swapped.hp === swapped.stats.hull && swapped.shield === swapped.stats.shield);

console.log('\nbase zone');
const homes = Object.entries(MAPS).filter(([, m]) => m.base).map(([k]) => k);
check('every home map has a base, and only home maps do',
  homes.length === 3 && homes.every(h => MAPS[h].home)
  && Object.values(MAPS).every(m => !m.base || m.home), homes.join(', '));
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

console.log('\nhangar layout');
{
  const { bayLayout } = await import('../shared/hangar.js');
  let outside = 0, clash = 0, overlap = 0, offscreen = 0, tightest = 1e9;
  for (const [W, H] of [[1920,1080],[1600,900],[1440,900],[1280,800],[1100,700],[1024,640]]) {
    const L = bayLayout(W, H), P = L.panel, A = L.apply;
    const rows = [...L.hulls, ...L.mods].map(o => o.r);
    if (P.x < 0 || P.y < 0 || P.x + P.w > W || P.y + P.h > H) offscreen++;
    for (const r of rows) {
      // every row must be reachable: inside the panel, or a click there is read as
      // "clicked outside" and the panel closes instead of selecting anything
      if (r.x < P.x || r.y < P.y || r.x + r.w > P.x + P.w || r.y + r.h > P.y + P.h) outside++;
      if (r.x < A.x + A.w && A.x < r.x + r.w && r.y < A.y + A.h && A.y < r.y + r.h) clash++;
      tightest = Math.min(tightest, (P.y + P.h) - (r.y + r.h));
    }
    for (const col of [L.hulls, L.mods])
      for (let i = 1; i < col.length; i++)
        if (col[i].r.y < col[i-1].r.y + col[i-1].r.h) overlap++;
  }
  check('every hull and module row stays inside the panel', outside === 0,
    `${Object.keys(MODULES).length} modules, ${tightest | 0}px of slack at the tightest`);
  check('no row sits under the APPLY button', clash === 0);
  check('rows never overlap each other', overlap === 0);
  check('the panel fits on screen at every size', offscreen === 0);
}

console.log('\nwire format');
{
  const { SHIP_FIELDS, packShip, unpackShip } = await import('../shared/net.js');
  const o = { id: 7, x: 1, y: 2, heading: .3, charge: .4, co: 'h', hull: 'kestrel', hp: 55, sh: 66, flash: 77, vis: 1 };
  const round = unpackShip(packShip(o));
  check('a packed ship survives the round trip', SHIP_FIELDS.every(f => round[f] === o[f]),
    `${SHIP_FIELDS.length} fields`);
  check('the array is exactly as long as the field list', packShip(o).length === SHIP_FIELDS.length);
  check('flash and vis do not transpose',
    packShip(o).indexOf(77) === SHIP_FIELDS.indexOf('flash')
    && unpackShip(packShip(o)).vis === 1, 'the bug this module exists to prevent');
}

console.log('\nshield impact');
const fl = newShip(0, 0, 'vanguard', []);
applyDamage(fl, 200);
check('a hit the shields catch lights the bubble', fl.shieldHit === SHIELD_FLASH);
fl.shieldHit = 0;
applyDamage(fl, 400);                                   // 700 shield left, still absorbs
check('a partial absorb still lights it', fl.shieldHit === SHIELD_FLASH, 'shields did take damage');
fl.shield = 0; fl.shieldHit = 0;
applyDamage(fl, 300);
check('with shields down there is nothing to flare', fl.shieldHit === 0 && fl.hp < fl.stats.hull,
  'the hull still takes it');
applyDamage(fl, 0);
check('a zero-damage hit lights nothing', fl.shieldHit === 0);
fl.shield = 100; fl.shieldHit = 0; applyDamage(fl, 50);
let lit = 0;
while (fl.shieldHit > 0) { stepVitals(fl, dt, false); lit += dt; }
check('the bubble decays on its own', Math.abs(lit - SHIELD_FLASH) < 0.05, `${lit.toFixed(2)}s`);
const rf = refit(newShip(0, 0, 'vanguard', []), 'kestrel', []);
check('refitting clears a lit bubble', rf.shieldHit === 0);

console.log('\nwire: bolts and blasts');
{
  const { BOLT_FIELDS, packBolt, unpackBolt, BLAST_FIELDS, packBlast, unpackBlast } = await import('../shared/net.js');
  const b = unpackBolt(packBolt({ sx: 10.4, sy: 20.6, ax: 30, ay: 40, t: 0.05, ttl: 0.2, foe: true }));
  check('a bolt round-trips with its progress', b.sx === 10 && b.sy === 21 && b.p === 0.75 && b.foe === 1,
    `${BOLT_FIELDS.length} fields, p=${b.p}`);
  const k = unpackBlast(packBlast({ x: 5, y: 6, r: 15, t: 0.2, ttl: 0.8, foe: false }));
  check('a blast round-trips with its progress', k.x === 5 && k.r === 15 && k.p === 0.75 && k.foe === 0,
    `${BLAST_FIELDS.length} fields`);
  check('progress always runs 0 to 1', unpackBolt(packBolt({ sx:0,sy:0,ax:0,ay:0,t:0.2,ttl:0.2,foe:0 })).p === 0
    && unpackBolt(packBolt({ sx:0,sy:0,ax:0,ay:0,t:0,ttl:0.2,foe:0 })).p === 1);
}

console.log('\ncharted space');
check('the charted zone is exactly what the minimap draws',
  driftDepth(0, 0) === 0 && driftDepth(MAP_W, MAP_H) === 0
  && driftDepth(-1, 4000) === 1 && driftDepth(MAP_W + 250, 4000) === 250);
check('depth takes the worst axis, not the sum',
  driftDepth(-300, -900) === 900, 'a corner is not doubly lethal');
check('shear starts the moment you cross and ramps to the limit',
  driftDps(0) === 0 && driftDps(1) >= DRIFT_MIN && driftDps(DRIFT_MARGIN) === DRIFT_MAX
  && driftDps(DRIFT_MARGIN / 2) < DRIFT_MAX / 2, 'and ramps faster than linear');
check('the hard wall sits one margin past the charted edge',
  WORLD.x0 === -DRIFT_MARGIN && WORLD.x1 === MAP_W + DRIFT_MARGIN);

const flown = (hull, fit = []) => {
  const s = newShip(300, 4000, hull, fit);
  s.dx = -1; s.dy = 0;                                    // full burn, straight out
  let t = 0;
  while (s.hp > 0 && t < 120) { step(s, dt); stepDrift(s, dt); t += dt; }
  return { t, depth: driftDepth(s.x, s.y) };
};
const gap = r => DRIFT_MARGIN - r.depth;                  // px still between the wreck and the border
const runs = [['kestrel', []], ['vanguard', []], ['bulwark', []],
              ['bulwark', ['plating', 'plating', 'plating']],   // the tankiest thing buildable
              ['kestrel', ['thruster', 'ballast']]]             // and the fastest
  .map(([h, f]) => [`${h}${f.length ? '+' + f.length : ''}`, flown(h, f)]);
runs.forEach(([h, r]) => console.log(`     ${h.padEnd(11)} dead at depth ${r.depth | 0}/${DRIFT_MARGIN}` +
  ` after ${r.t.toFixed(1)}s — stopped ${gap(r) | 0}px short of the border`));
check('flying out is always fatal, on every hull and fit', runs.every(([, r]) => r.t < 120));
check('nobody ever reaches the border', runs.every(([, r]) => gap(r) > 120),
  `closest was ${Math.min(...runs.map(([, r]) => gap(r))) | 0}px short`);
check('tougher hulls get further before they go',
  runs[0][1].depth < runs[1][1].depth && runs[1][1].depth < runs[2][1].depth);
check('you get real warning at the line, not an instant kill',
  (newShip(0, 0, 'vanguard').stats.hull + newShip(0, 0, 'vanguard').stats.shield) / DRIFT_MIN > 30,
  `${((2000) / DRIFT_MIN).toFixed(0)}s of grace right at the edge`);

const stray = newShip(-200, 4000, 'vanguard', []);
stray.shield = 0;
for (let i = 0; i < 30 * 20; i++) { stepDrift(stray, dt); stepVitals(stray, dt, false); }
check('shields cannot regenerate while shear is landing', stray.shield === 0, '20s outside');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(HULLS).length} hulls, ${Object.keys(MODULES).length} modules`}\n`);
process.exit(fails.length ? 1 : 0);
