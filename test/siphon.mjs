// The Lamprey's tether.
import { ALIENS, newAlien, stepAlienAI, stepAlienRepair, CLOSER_HOLD } from '../shared/aliens.js';
import { stepSiphon, tetherHolds, DRAIN_RATE, MEND_RATE, SPOOL } from '../shared/siphon.js';
import { newShip, step, stepVitals, drainHull, inHaven, havenKind, TICK_HZ, HAVEN_R } from '../shared/sim.js';
import { fire, faceTarget, stepBolts } from '../shared/combat.js';
import { buildFor, STAGE_KEYS, stageDps, stageHull, ANCHORS } from '../shared/balance.js';
import { addMod } from '../shared/research.js';
import { MAPS, PORTAL_R } from '../shared/maps.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const f = (n, d = 2) => Number(n).toFixed(d);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
const dt = 1 / TICK_HZ;
const S = ALIENS.lamprey.siphon;
const TIERS = [0, 1, 2, 3, 4, 5];
const maskFor = t => { let m = 0; for (let i = 1; i <= t; i++) m = addMod(addMod(m, 'hull' + i), 'shld' + i); return m; };
const open = { ...MAPS.m3, base: null, portals: [] };

// One pilot, one Lamprey, both standing still. Returns what happened.
function stand(stage, research, { cap = 120, map = open, at = 630 } = {}) {
  const b = buildFor(stage);
  const p = newShip(6000 + at, 4000, b.hull, b.fit, b.drones ?? [], undefined, null, research);
  p.power.to = 'weapons';
  const a = newAlien('lamprey', 1, open, 7, { x: 6000, y: 4000 });
  a.x = 6000; a.y = 4000; a.provoked.add(0); a.target = 0;
  const bolts = [];
  const shield0 = p.shield;
  let t = 0;
  while (t < cap && p.hp > 0 && a.hp > 0) {
    const here = [{ id: 0, ship: p, haven: inHaven(map, p) }];
    // Close to inside your own gun and then hold: a Lamprey stations at 630px,
    // which is a pixel outside a Kestrel's 620 reach, so a pilot who never moved
    // would be measured never firing a shot.
    p.dx = p.dy = null;
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d > p.stats.weaponRange * 0.9) { p.tx = a.x; p.ty = a.y; } else { p.tx = p.ty = null; }
    step(p, dt); stepVitals(p, dt, false); faceTarget(p, a);
    for (const s of fire(p, a, dt)) bolts.push(s);
    const tgt = stepAlienAI(a, open, here, dt);
    step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
    const v = tgt !== null ? here[0] : null;
    const bite = stepSiphon(a, v?.ship ?? null, v ? tetherHolds(a, v.ship, v.haven) : false, dt);
    if (bite) { drainHull(v.ship, bite.take); a.hp = Math.min(a.stats.hull, a.hp + bite.mend); }
    stepBolts(bolts, dt);
    t += dt;
  }
  return { t, killedIt: a.hp <= 0, died: p.hp <= 0, shieldKept: near(p.shield, shield0, 1e-6),
           hullLeft: p.hp / p.stats.hull, itsHull: a.hp / a.stats.hull };
}

console.log('\nwhat a tether takes');
check('a tether empties any ship in the game in the same forty-four seconds, whatever it is', (() => {
  const secs = [];
  for (const st of STAGE_KEYS) for (const tier of TIERS) {
    const b = buildFor(st);
    const p = newShip(0, 0, b.hull, b.fit, b.drones ?? [], undefined, null, maskFor(tier));
    const a = newAlien('lamprey', 1, open, 7, { x: 0, y: 0 });
    a.target = 0; a.drawOn = 0; a.draw = 1;                     // already at full draw
    let t = 0;
    while (p.hp > 0 && t < 200) { const bite = stepSiphon(a, p, true, dt); drainHull(p, bite.take); t += dt; }
    secs.push(t);
  }
  return secs.every(v => Math.abs(v - secs[0]) < 0.1) && Math.abs(secs[0] - 1 / DRAIN_RATE) < 0.1;
})(), `${f(1 / DRAIN_RATE, 1)}s across ${STAGE_KEYS.length} stages x ${TIERS.length} research tiers — ` +
      'a share cannot decay, which is the whole reason it is a share');
check('and that is exactly half the rate the balance model calls a hostile on model',
  near(DRAIN_RATE, ANCHORS.pressure / 2, 1e-9),
  `${f(DRAIN_RATE, 4)}/s against ANCHORS.pressure ${f(ANCHORS.pressure, 4)}/s — half, because a model hostile's ` +
  'damage lands on shields that come back and this lands on hull that does not');
check('it never touches a shield, and that is the only thing in the game that does not',
  STAGE_KEYS.every(st => stand(st, 0, { cap: 60 }).shieldKept),
  'a shield stops momentum; a tether is a gradient — so this does not go through applyDamage at all');
check('the draw takes five seconds to come up and it is lost the instant the tether breaks', (() => {
  const a = newAlien('lamprey', 1, open, 7, { x: 0, y: 0 });
  a.target = 0;
  const p = newShip(0, 0);
  let t = 0; while (t < S.spool) { stepSiphon(a, p, true, dt); t += dt; }
  const full = a.draw;
  stepSiphon(a, p, false, dt);
  return near(full, 1, 1e-6) && a.draw === 0 && near(S.spool, SPOOL);
})(), `${SPOOL}s up, and letting go is total — a tether that unwound slowly would make breaking it ` +
      'worth less than it cost you to break it');

console.log('\nand what it cannot take');
{
  const home = MAPS.m1, ring = home.base, port = home.portals[0];
  const a = newAlien('lamprey', 1, home, 7, { x: ring.x + 200, y: ring.y });
  const at = (x, y) => { const p = newShip(x, y); return p; };
  check('nobody is drained in a base ring, at an outpost or in a portal mouth', (() => {
    const spots = [[ring.x, ring.y, 'ring'], [port.x, port.y, 'portal'],
                   [MAPS.m4.outpost.x, MAPS.m4.outpost.y, 'outpost']];
    return spots.every(([x, y, kind]) => {
      const map = kind === 'outpost' ? MAPS.m4 : home;
      const p = at(x, y);
      a.x = x + 300; a.y = y;
      return havenKind(map, p) === kind && !tetherHolds(a, p, inHaven(map, p));
    });
  })(), 'havenKind in sim.js is the one predicate, and it is passed in rather than copied — ' +
        'the workshop dock refused to sell anything for a day over exactly that');
  check('and it still follows you in and holds the grudge — it simply has nothing to do there', (() => {
    const p = at(port.x, port.y);
    const a2 = newAlien('lamprey', 2, home, 9, { x: port.x + 300, y: port.y });
    a2.provoked.add(0); a2.target = 0;
    let t = 0, took = 0;
    while (t < 12) {
      const here = [{ id: 0, ship: p, haven: inHaven(home, p) }];
      const tgt = stepAlienAI(a2, home, here, dt);
      step(a2, dt);
      const bite = stepSiphon(a2, p, tgt !== null && tetherHolds(a2, p, here[0].haven), dt);
      if (bite) took += bite.take;
      t += dt;
    }
    return a2.target === 0 && took === 0 && a2.draw === 0;
  })(), '12s in a portal mouth with a provoked Lamprey sitting on top of it — target still held, 0 hull taken. ' +
        'Provocation overriding sanctuary is the older and better rule and it is untouched: it just has no gun');
  check('the tether snaps at its reach, and its reach is past every gun in the game', (() => {
    const p = at(0, 0);
    const a3 = newAlien('lamprey', 3, open, 5, { x: S.reach - 1, y: 0 });
    const in1 = tetherHolds(a3, p, false);
    a3.x = S.reach + 1;
    return in1 && !tetherHolds(a3, p, false);
  })(), `${S.reach}px against a Bulwark's 820 — you cannot out-range it while shooting it, ` +
        'you can only leave');
}

console.log('\nand what stops it being immortal');
check('what it mends is a share of ITS hull, never of what it took — or research would make it unkillable', (() => {
  const a = newAlien('lamprey', 1, open, 7, { x: 0, y: 0 });
  a.target = 0; a.drawOn = 0; a.draw = 1;
  const b = buildFor('fighter');
  const small = newShip(0, 0, b.hull, b.fit, b.drones ?? [], undefined, null, 0);
  const big   = newShip(0, 0, b.hull, b.fit, b.drones ?? [], undefined, null, maskFor(5));
  const m1 = stepSiphon(a, small, true, dt), t1 = m1.take;
  a.draw = 1; const m2 = stepSiphon(a, big, true, dt), t2 = m2.take;
  return near(m1.mend, m2.mend, 1e-9) && near(t2 / t1, 32, 1e-6);
})(), `a x32 Vanguard hands it 32x the hull and it mends the same ${Math.round(ALIENS.lamprey.attrs.hull * MEND_RATE)}/s — ` +
      'one for one is the obvious reading of a siphon and it was measured unshippable: a x32 fighter took ' +
      '268s and was still losing ground');
check('no fight with a Lamprey can go on forever, at any stage or any research tier', (() => {
  const clock = 1 / DRAIN_RATE + SPOOL / 2;
  for (const st of STAGE_KEYS) for (const tier of TIERS) {
    const r = stand(st, maskFor(tier), { cap: 200 });
    if (!(r.killedIt || r.died)) return false;
    if (r.t > clock + 1) return false;
  }
  return true;
})(), `6 stages x ${TIERS.length} tiers, standing still: every one of them ends inside ` +
      `${f(1 / DRAIN_RATE + SPOOL / 2, 1)}s, with one of the two of you dead. It is the stalemate that ` +
      'was the thing to avoid — a hostile you cannot kill AND cannot lose to is not content');
check('and there is a stage below which you cannot finish one, which is a gate and says so', (() => {
  const a = stand('interceptor', 0, { cap: 200 }), b = stand('fighter', 0, { cap: 200 });
  return a.died && !a.killedIt && b.killedIt && !b.died && a.itsHull > 0.5;
})(), (() => { const a = stand('interceptor', 0, { cap: 200 }), b = stand('fighter', 0, { cap: 200 });
  return `a full Kestrel throws ${Math.round(stageDps('interceptor'))} dps against its ` +
    `${Math.round(ALIENS.lamprey.attrs.hull * MEND_RATE)}/s of mending and dies at ${f(a.t, 1)}s with it on ` +
    `${f(a.itsHull * 100, 0)}%; a full Vanguard kills it in ${f(b.t, 1)}s for ${f(100 - b.hullLeft * 100, 0)}% of its hull. ` +
    'The bar going UP is the tell'; })());

console.log('\nwhat a friend is worth, and only if they move');
// Two pilots, and the only variable is whether they take turns walking into it.
// CLOSER_HOLD is 3s of being meaningfully nearer than its current target, which
// is aliens.js's rule and not a new one — the tether simply re-seats from nothing
// on whoever it turns to, which is what makes taking turns worth anything.
function party(stage, n, rotate, cap = 200) {
  const b = buildFor(stage);
  const ships = Array.from({ length: n }, () => {
    const p = newShip(6000, 4000, b.hull, b.fit, b.drones ?? []); p.power.to = 'weapons'; return p; });
  const a = newAlien('lamprey', 1, open, 7, { x: 6000, y: 4000 });
  a.x = 6000; a.y = 4000;
  const bolts = []; let t = 0, draw = 0, n2 = 0, switches = 0, last = null;
  while (t < cap && a.hp > 0 && ships.some(p => p.hp > 0)) {
    ships.forEach((p, i) => {
      if (p.hp <= 0) return;
      const turn = rotate ? Math.floor(t / (CLOSER_HOLD + 1)) % n === i : i === 0;
      const r = turn ? 380 : 700, ang = (i / n) * 0.6 - 0.3;
      p.tx = a.x + Math.cos(ang) * r; p.ty = a.y + Math.sin(ang) * r; p.dx = p.dy = null;
      step(p, dt); stepVitals(p, dt, false); faceTarget(p, a);
      const spat = fire(p, a, dt);
      if (spat.length) a.provoked.add(i);
      for (const s2 of spat) bolts.push(s2);
    });
    const here = ships.map((p, i) => ({ id: i, ship: p, haven: false }));
    const tgt = stepAlienAI(a, open, here, dt);
    step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
    if (a.target !== last) { switches++; last = a.target; }
    const v = tgt !== null ? here.find(c => c.id === tgt) : null;
    const bite = stepSiphon(a, v?.ship ?? null, v ? tetherHolds(a, v.ship, v.haven) : false, dt);
    if (bite) { drainHull(v.ship, bite.take); a.hp = Math.min(a.stats.hull, a.hp + bite.mend); }
    draw += a.draw ?? 0; n2++;
    stepBolts(bolts, dt); t += dt;
  }
  return { t, kill: a.hp <= 0, switches, meanDraw: draw / n2,
           worst: Math.min(...ships.map(p => p.hp / p.stats.hull)) };
}
check('a second pilot is worth nothing if they stand still, and everything if they take turns', (() => {
  const still = party('interceptor', 2, false), turns = party('interceptor', 2, true);
  const three = party('interceptor', 3, false);
  return !still.kill && !three.kill && turns.kill && turns.meanDraw < still.meanDraw * 0.75;
})(), (() => { const still = party('interceptor', 2, false), turns = party('interceptor', 2, true),
  three = party('interceptor', 3, false);
  return `two Kestrels standing still both die in ${f(still.t, 1)}s and three in ${f(three.t, 1)}s — ` +
    `numbers alone are worth nothing against a tether. Two that take turns kill it in ${f(turns.t, 1)}s ` +
    `across ${turns.switches} switches, holding the mean draw at ${f(turns.meanDraw * 100, 0)}% against ` +
    `${f(still.meanDraw * 100, 0)}%. It is the Leviathan's lesson inverted: that one asks a party to keep ` +
    'the damage unbroken, this one asks them to keep breaking off'; })());

console.log('\nwhat it costs, and what a friend is worth');
for (const st of ['interceptor', 'fighter', 'cruiser', 'finished'])
  for (const tier of [0, 5]) {
    const r = stand(st, maskFor(tier), { cap: 200 });
    console.log(`     ${st.padEnd(12)} x${(2 ** tier).toString().padEnd(3)} ${f(r.t, 1).padStart(5)}s  ` +
      `${(r.killedIt ? 'killed it' : 'DIED').padEnd(10)} hull left ${f(r.hullLeft * 100, 0).padStart(3)}%  ` +
      `its hull ${f(r.itsHull * 100, 0).padStart(3)}%`);
  }

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the tether'}\n`);
process.exit(fails.length ? 1 : 0);
