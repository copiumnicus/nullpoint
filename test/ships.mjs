import { ATTRS, HULLS, MODULES, DEFAULT_HULL, resolve, sanitiseFit, slotsOf } from '../shared/ships.js';
import { newShip, refit, step, stepVitals, applyDamage, inBase, DOCK_HULL_RATE } from '../shared/sim.js';
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
  Math.abs(secs - 0.8 / DOCK_HULL_RATE) < 0.5, `${(DOCK_HULL_RATE * 100).toFixed(0)}%/s`);
const nodelay = wreck();
stepVitals(nodelay, dt, true);
check('docking ignores the shield delay', nodelay.shield > 0, 'no waiting at your own dock');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(HULLS).length} hulls, ${Object.keys(MODULES).length} modules`}\n`);
process.exit(fails.length ? 1 : 0);
