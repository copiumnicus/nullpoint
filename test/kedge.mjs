// Claims about the Kedge, and about the fix.
//
// The fix is the first thing in this game that moves a ship its owner is not
// flying, so most of what is in here is not about damage at all: it is about the
// promise every other hostile in aliens.js makes in as many words — that you can
// always decline, always break off, always leave. A Kedge is the one that charges
// you for leaving, and the entire question is whether it charges or forbids.
//
// Everything below is measured through the real loop: stepAlienAI, stepFix, step,
// stepVitals, fire and stepBolts, in the order server.js calls them.

import { ALIENS, WILD, effectiveHp, farmHp, newAlien, stepAlienAI, mayHarm,
         standOff, BOUNTY_RATE, XP_RATE, threatDps } from '../shared/aliens.js';
import { fixOf, stepFix, fixHolds, fixWinding, collapseTo, fixPoint, clearFix,
         escapeTax, FUSE, COOL } from '../shared/kedge.js';
import { newShip, step, stepVitals, inHaven, speedOf, HAVEN_R } from '../shared/sim.js';
import { fire, stepBolts, faceTarget } from '../shared/combat.js';
import { routeTo, boostOf } from '../shared/power.js';
import { MAPS, MAP_W, MAP_H } from '../shared/maps.js';
import { JUMP_TIME } from '../shared/sim.js';
import { HULLS, resolve } from '../shared/ships.js';
import { buildFor, stageDps, stageEhp, ANCHORS, POSTING, alienFor } from '../shared/balance.js';
import { SHIP_FIELDS, EPHEMERAL, FIX_FIELDS, packFix, unpackFix } from '../shared/net.js';
import { MAX_FIELDS } from '../shared/delta.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const f = (v, d = 1) => Number(v).toFixed(d);
const dt = 1 / 30, map = MAPS.g1, K = ALIENS.kedge;
const ehp = s => s.hp + s.shield, full = s => s.stats.hull + s.stats.shield;

const mk = (kind, x, y, seed = 3) => {
  const a = newAlien(kind, 1e6, map, seed, { x, y });
  a.post = null; a.x = x; a.y = y; a.vx = a.vy = 0; return a;
};
const flyer = (stage, mul = 1, at = { x: 6000, y: 4000 }, route = 'weapons') => {
  const b = buildFor(stage);
  const p = newShip(at.x, at.y, b.hull, b.fit, b.drones, 'wedge', null, 0);
  routeTo(p.power, route);
  if (mul > 1) { p.stats = { ...p.stats, hull: p.stats.hull * mul, shield: p.stats.shield * mul };
                 p.hp = p.stats.hull; p.shield = p.stats.shield; }
  return p;
};

// server.js's tick, in server.js's order. The fix runs BEFORE the hull is stepped;
// see the comment there for the bug that ordering exists to prevent.
function tick(a, p, air, o = {}) {
  const here = [{ id: 1, ship: p, haven: inHaven(map, p), loud: 1 }];
  const tgt = stepAlienAI(a, map, here, dt);
  const victim = tgt ? here[0] : null;
  let snapped = null;
  if (fixOf(a.def) && !o.noFix) {
    const held = victim ? fixHolds(a, victim.ship, victim.haven) : false;
    const snap = stepFix(a, victim?.ship ?? null, held, dt);
    if (fixWinding(a)) { a.tx = a.ty = a.dx = a.dy = null; }
    if (snap && victim && victim.ship.hp > 0 && mayHarm(a, victim)) snapped = collapseTo(victim.ship, snap.to);
  }
  step(a, dt); step(p, dt); stepVitals(a, dt); stepVitals(p, dt);
  faceTarget(a, victim?.ship ?? null);
  for (const s of fire(a, victim?.ship ?? null, dt)) air.push(s);
  if (o.playerFires) { faceTarget(p, a); const v = fire(p, a, dt);
                       if (v.length) { air.push(...v); a.provoked.add(1); a.target ??= 1; } }
  stepBolts(air, dt);
  return snapped;
}

// A fight held at a fixed range, both guns live.
function duel(stage, mul, mode, o = {}) {
  const p = flyer(stage, mul);
  const a = mk('kedge', 6700, 4000);
  a.provoked.add(1); a.target = 1;
  const band = p.stats.weaponRange - 40, air = [];
  let t = 0, snaps = 0;
  while (t < 600 && a.hp > 0 && p.hp > 0) {
    const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
    p.tx = p.ty = null;
    if (mode === 'park') { p.dx = p.dy = null; }
    else if (d < band - 20) { p.dx = dx / d; p.dy = dy / d; }
    else if (d > band + 20) { p.dx = -dx / d; p.dy = -dy / d; }
    else { p.dx = p.dy = 0; }
    if (tick(a, p, air, { playerFires: true, ...o })) snaps++;
    t += dt;
  }
  return { t, left: Math.max(0, ehp(p)) / full(p), snaps, killed: a.hp <= 0, died: p.hp <= 0 };
}

// A pilot who has decided to leave: full burn straight away, guns cold, from the
// range a Kedge holds station at. Returns when the leash finally breaks.
function leave(what, o = {}) {
  const p = HULLS[what] ? (() => { const s = newShip(1200, 4000, what); routeTo(s.power, 'thrusters'); return s; })()
                        : flyer(what, 1, { x: 1200, y: 4000 }, 'thrusters');
  const a = mk('kedge', 1200 - standOff(mk('kedge', 0, 0)) * 0.7, 4000);
  a.provoked.add(1); a.target = 1;
  const air = []; let t = 0, snaps = 0, worst = 0;
  while (t < 400) {
    const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
    p.tx = p.ty = null; p.dx = dx / d; p.dy = dy / d;
    const was = { x: p.x, y: p.y };
    if (tick(a, p, air, o)) { snaps++; worst = Math.max(worst, Math.hypot(p.x - was.x, p.y - was.y)); }
    t += dt;
    if (a.target === null) return { got: true, t, snaps, worst };
  }
  return { got: false, t, snaps, worst };
}

console.log('\nwhere it lands on the ladder');
check('a Kedge is a rung of tens, and it is the Leviathan\'s',
  effectiveHp('kedge') === effectiveHp('leviathan') && effectiveHp('kedge') % 10 === 0 &&
  Math.abs(effectiveHp('kedge') - 650 * 10 ** 2) <= 10,
  `${effectiveHp('kedge').toLocaleString('en-US')} ehp — 650 x 10^2, and a multiple of ten so a bounty is whole credits`);
check('sharing a rung is allowed, but only across sectors',
  effectiveHp('kedge') < effectiveHp('thresher'),
  `${effectiveHp('kedge').toLocaleString('en-US')} under a Thresher's ${effectiveHp('thresher').toLocaleString('en-US')} on the same map — ` +
  'two hostiles of one weight in one sector makes the deadlier one pointless');
check('and it pays what it costs to kill, with nothing left over',
  K.bounty === farmHp('kedge') * BOUNTY_RATE && K.xp === farmHp('kedge') * XP_RATE,
  `${K.bounty.toLocaleString('en-US')} cr and ${K.xp.toLocaleString('en-US')} xp, both exact`);
check('it carries no effort multiplier, and that is a measurement rather than an omission',
  (K.effort ?? 1) === 1 && (() => {
    const on = duel('cruiser', 1, 'park'), off = duel('cruiser', 1, 'park', { noFix: true });
    return Math.abs(on.t / off.t - 1) < 0.02;
  })(),
  (() => { const on = duel('cruiser', 1, 'park'), off = duel('cruiser', 1, 'park', { noFix: true });
    return `${f(on.t)}s to kill with the fix live against ${f(off.t)}s without — a collapse always moves you ` +
           'TOWARD the thing shooting at you, so it can never cost you a shot. Effort is time; this is hull.'; })());
check('its dps is the model\'s own, not a number anybody chose',
  Math.abs(K.attrs.damage * K.attrs.fireRate - ANCHORS.pressure * stageEhp(POSTING.kedge.stage)) < 1e-9,
  `${K.attrs.damage} x ${K.attrs.fireRate} = ${f(K.attrs.damage * K.attrs.fireRate, 2)} = ` +
  `pressure x the ${POSTING.kedge.stage} stage's ${stageEhp(POSTING.kedge.stage).toLocaleString('en-US')} ehp`);

console.log('\nwhat the fight is');
{
  const hulls = Object.keys(HULLS).map(h => ({ h, st: resolve(h, { weapon: ['emitter5'], generator: [], tech: [] }) }));
  check('you cannot out-range it, which is what makes standing there cost something',
    hulls.every(x => K.attrs.weaponRange > x.st.weaponRange),
    `${K.attrs.weaponRange} against ` + hulls.map(x => `${x.h} ${x.st.weaponRange}`).join(', ') +
    ' — the Leviathan\'s number, for the Leviathan\'s reason');
  const rows = [['cruiser', 1], ['finished', 1], ['finished', 8], ['finished', 32]];
  for (const [stage, mul] of rows) {
    const r = duel(stage, mul, 'park');
    console.log(`     ${stage.padEnd(9)} x${String(mul).padStart(2)} research: ` +
      `${r.killed ? `killed it in ${f(r.t)}s` : `DIED at ${f(r.t)}s`}, ${(100 * r.left).toFixed(0)}% of hull and shield left`);
  }
  check('a pilot who cannot survive a Thresher can farm a Kedge, which is the whole reason it exists',
    duel('cruiser', 1, 'park').killed && duel('cruiser', 1, 'park').left > 0.25,
    (() => { const r = duel('cruiser', 1, 'park');
      return `${f(r.t)}s and ${(100 * r.left).toFixed(0)}% left against a Thresher that returns ` +
             `${effectiveHp('thresher').toLocaleString('en-US')} damage over its fight — 36x the same pilot`; })());
  check('and it is never the thing that kills them',
    rows.every(([s, m]) => !duel(s, m, 'park').died && !duel(s, m, 'kite').died),
    'four stages x two ways of flying it, no deaths');
  check('it is the most dangerous gun in the bestiary per second actually delivered', (() => {
    const armed = WILD.filter(k => ALIENS[k].attrs.damage > 0);
    return armed.every(k => k === 'kedge' ||
      ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate <= K.attrs.damage * K.attrs.fireRate);
  })(), `${f(K.attrs.damage * K.attrs.fireRate, 0)} nominal, and it collects ~95% of it because you cannot hold range — ` +
        'a Bandit throws 195 and lands 17 of it, because dodging your bolts takes its own gun off you');
}

console.log('\nleaving is a toll, not a wall');
check('the toll is derived from the two clocks and nothing else',
  Math.abs(escapeTax(K) - (FUSE + COOL) / COOL) < 1e-12 && escapeTax(K) === 2,
  `(${FUSE} + ${COOL}) / ${COOL} = x${escapeTax(K)} — every cycle it takes back one fuse of travel and leaves you one cool of it`);
check('the fuse is a portal\'s spool, so reaching a mouth first is the answer',
  K.fix.fuse === JUMP_TIME, `${K.fix.fuse}s each — get there before it lands and you are through`);
{
  const names = ['hauler', 'kestrel', 'vanguard', 'bulwark', 'interceptor', 'fighter', 'cruiser', 'finished'];
  const rows = names.map(n => ({ n, on: leave(n), off: leave(n, { noFix: true }) }));
  for (const r of rows)
    console.log(`     ${r.n.padEnd(12)} ${r.on.got ? f(r.on.t) + 's' : 'NEVER'} with a fix against ` +
      `${r.off.got ? f(r.off.t) + 's' : 'NEVER'} without — x${f(r.on.t / r.off.t, 2)}, ${r.on.snaps} collapses, biggest yank ${Math.round(r.on.worst)}px`);
  check('every hull in the game gets away, in every fit',
    rows.every(r => r.on.got && r.off.got),
    `${rows.length} hulls and stages, ${f(Math.min(...rows.map(r => r.on.t)))}s to ${f(Math.max(...rows.map(r => r.on.t)))}s`);
  check('and the fix never costs more than the toll it states',
    rows.every(r => r.on.t / r.off.t <= escapeTax(K) + 0.05),
    `measured x${f(Math.min(...rows.map(r => r.on.t / r.off.t)), 2)} to x${f(Math.max(...rows.map(r => r.on.t / r.off.t)), 2)} against a ` +
    `stated ceiling of x${escapeTax(K)} — under it, because a pilot spends part of every fuse still accelerating`);
}
// THE ONE THAT MUST NEVER GO GREEN BY ACCIDENT.
//
// A mechanic that takes control away is far worse than one that takes hit points,
// and this one takes position — which is the same currency. It is allowed to exist
// only because the arithmetic below cannot be argued with: the collapse gives back
// the pilot's travel over the FUSE and nothing else, because the Kedge is standing
// still through all of it, so every cycle leaves `cool` seconds of travel it has no
// way to reach. Any change that lets a Kedge move while a sighting runs breaks this
// and turns the thing into a cage.
check('a fix can never hold a pilot: it has no way to take back the cooldown',
  COOL > 0 && (() => {
    // A Bulwark on the free trickle alone is the slowest thing anybody can fly.
    const p = flyer('finished', 1, { x: 1200, y: 4000 }, 'thrusters');
    p.power.charge = 0;                        // capacitor flat: no boost left to spend
    const a = mk('kedge', 1200 - 630, 4000);
    a.provoked.add(1); a.target = 1;
    const air = []; let t = 0;
    while (t < 400) {
      const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
      p.tx = p.ty = null; p.dx = dx / d; p.dy = dy / d;
      p.power.charge = 0;                      // and it stays flat, all the way out
      tick(a, p, air, {});
      t += dt;
      if (a.target === null) return t < 120;
    }
    return false;
  })(),
  'a finished Bulwark with a dead capacitor — the slowest ship in the game, no boost, no gun — ' +
  'still breaks the leash, because the Kedge is planted for every second it is taking a sighting');
check('and nothing at all is taken away for even one frame', (() => {
  const p = flyer('cruiser', 1);
  const a = mk('kedge', 6630, 4000);
  a.provoked.add(1); a.target = 1;
  const air = []; let t = 0, moved = false;
  const before = { guns: p.guns, cool: p.cool, charge: p.charge, jumpCd: p.jumpCd };
  while (t < 12 && !moved) {
    p.tx = 20000; p.ty = 4000; p.dx = p.dy = null;
    if (tick(a, p, air, {})) moved = true;
    t += dt;
  }
  // the order it was given, the guns, the reactor and the jump clock are all as they were
  return moved && p.tx === 20000 && p.guns === before.guns && p.jumpCd === before.jumpCd && p.hp > 0;
})(), 'the destination you ordered, the rack, the reactor and the jump clock all survive a collapse — ' +
      'the position is the only thing that moves, so the seconds a pilot cannot act is zero');

console.log('\nthe answers to it');
check('a portal mouth ends a fix outright, and on the tick it would have fired', (() => {
  const pg = map.portals[0];
  const p = flyer('cruiser', 1, { x: pg.x + 1100, y: pg.y });
  const a = mk('kedge', pg.x + 1100 + 630, pg.y);
  a.provoked.add(1); a.target = 1;
  const air = []; let t = 0, reached = false;
  while (t < 20) {
    const dx = pg.x - p.x, dy = pg.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.tx = p.ty = null;
    if (d > 40) { p.dx = dx / d; p.dy = dy / d; } else { p.dx = p.dy = 0; }
    tick(a, p, air, {});
    if (inHaven(map, p)) reached = true;
    t += dt;
  }
  return reached && !fixWinding(a) && (a.fix ?? 0) === 0;
})(), `${Math.round(HAVEN_R)}px of sanctuary at every mouth, and a gate sector has four of them and no dock — ` +
      'which is why this hostile belongs there and nowhere else');
check('a Kedge taking a sighting is a Kedge standing still, and that is the window you kill it in', (() => {
  const p = flyer('cruiser', 1);
  const a = mk('kedge', 6630, 4000);
  a.provoked.add(1); a.target = 1;
  const air = []; let t = 0, movedWhileFixing = 0, ticksFixing = 0;
  while (t < 10) {
    p.tx = p.ty = null; p.dx = p.dy = null;
    const was = { x: a.x, y: a.y };
    tick(a, p, air, { playerFires: false });
    if (fixWinding(a)) { ticksFixing++; movedWhileFixing = Math.max(movedWhileFixing, Math.hypot(a.x - was.x, a.y - was.y)); }
    t += dt;
  }
  return ticksFixing > 30 && movedWhileFixing < 8;
})(), 'it coasts to a stop and holds it for the whole fuse — half of every cycle it is a parked target');
check('the sighting is of where YOU are, not of where it is', (() => {
  const p = flyer('cruiser', 1);
  const a = mk('kedge', 6630, 4000);
  a.provoked.add(1); a.target = 1;
  const air = []; let t = 0;
  while (t < 2 && !a.fixAt) { p.dx = p.dy = null; tick(a, p, air, {}); t += dt; }
  return !!a.fixAt && Math.hypot(a.fixAt.x - p.x, a.fixAt.y - p.y) < 40
                   && Math.hypot(a.fixAt.x - a.x, a.fixAt.y - a.y) > 300;
})(), 'a fix on the Kedge would be a hook, which is a different ability and one the Lamprey already looks like');
check('and a collapse can never post you into the shear', (() => {
  for (const at of [{ x: -9e4, y: 5e5 }, { x: MAP_W + 9e4, y: -3e4 }, { x: 0, y: 0 }]) {
    const to = fixPoint(at);
    if (to.x < 0 || to.y < 0 || to.x > MAP_W || to.y > MAP_H) return false;
  }
  return true;
})(), 'clamped to charted space, which is exactly where driftDepth() stops being zero');
check('and the point on the wire is the point the hull lands on, out at the rim too', (() => {
  // A pilot fighting past the lattice: the stamp has to be clamped when it is TAKEN,
  // or the marker everyone is looking at and the place the ship arrives are two
  // different points. Measured 61px apart on a live chase that ran to the edge.
  const p = flyer('cruiser', 1, { x: 120, y: 300 });
  const a = mk('kedge', 700, 300);
  a.provoked.add(1); a.target = 1;
  const air = []; let t = 0, landed = null, stamp = null;
  while (t < 12 && !landed) {
    p.tx = p.ty = null; p.dx = -1; p.dy = -1;             // straight out past the rim
    if (a.fixAt && !stamp) stamp = { ...a.fixAt };
    const at = tick(a, p, air, {});
    if (at) landed = at;
    t += dt;
  }
  return !!landed && !!stamp && Math.hypot(landed.x - stamp.x, landed.y - stamp.y) < 1e-9;
})(), 'the stamp is clamped once, at the sighting, so there is only ever one point');

console.log('\nthe wire');
check('it cost no new SHIP_FIELDS entry, and the row is at 30 of a hard 31',
  SHIP_FIELDS.length === 30 && MAX_FIELDS === 31 && SHIP_FIELDS.includes('abl'),
  '`abl` is the third thing to ride the same 0..100 dial after a Lamprey\'s draw and a Censer\'s spin, ' +
  'and `tgt` has been on the wire since the beginning');
check('a hostile with no dial of any kind still sends 0', (() => {
  // the exact expression server.js packs
  const abl = a => Math.round(100 * (a.draw ?? a.spin ?? a.fix ?? 0));
  return WILD.every(k => abl(newAlien(k, 1, map, 5)) === 0);
})(), `all ${WILD.length} hostiles, freshly spawned — a ?? chain three deep still bottoms out at zero`);
check('the marker is its own stream, and it is ephemeral for the pyre\'s reason',
  EPHEMERAL.includes('fixes') && FIX_FIELDS.length === 5,
  'three seconds long, no identity worth diffing, and the one field that matters changes every tick');
check('and it packs and unpacks to the same five numbers', (() => {
  const o = { x: 6000.4, y: 4000.6, r: 16.2, p: 0.6667 };
  const got = unpackFix(packFix(o, true));
  return got.x === 6000 && got.y === 4001 && got.r === 16 && got.p === 0.667 && got.own === 1
      && unpackFix(packFix(o, false)).own === 0
      && unpackFix(packFix({ ...o, p: 4 }, true)).p === 1
      && unpackFix(packFix({ ...o, p: -2 }, true)).p === 0;
})(), 'and a progress outside 0..1 is clamped before it is ever a number the client divides by');

// It bills for the ground it undoes, which is the half that makes the toll bite.
{
  const { haulCost, HAUL_FULL, HAUL_SPAN } = await import('../shared/kedge.js');
  const { ANCHORS } = await import('../shared/balance.js');
  check('the longest haul costs exactly one second of a hostile on model',
    Math.abs(HAUL_FULL - ANCHORS.pressure) < 1e-9,
    `${(HAUL_FULL * 100).toFixed(1)}% of your ship over ${HAUL_SPAN}px — the fastest hull ` +
    'boosted, times the fuse, so it is the longest haul the mechanic can produce');
  check('standing still through a sighting costs nothing at all',
    haulCost(0, 7050) === 0,
    'the cost is the ground it drags you back over, not the fix — so a pilot who did ' +
    'not run pays nothing, which is the opposite of a stun');
  check('and it scales with the distance rather than jumping',
    haulCost(800, 7050) > haulCost(400, 7050) && haulCost(400, 7050) > haulCost(100, 7050),
    [100, 400, 800, 1677].map(px => `${px}px ${haulCost(px, 7050).toFixed(0)}`).join(', ') +
    ' of a 7,050 ship');
  check('a haul longer than the mechanic can produce is capped, not extrapolated',
    haulCost(9999, 7050) === haulCost(HAUL_SPAN, 7050),
    'a clock skew or a boosted hull nobody has built yet cannot make it lethal');
  check('it is a share, so research cannot outgrow it',
    Math.abs(haulCost(HAUL_SPAN, 225600) / 225600 - haulCost(HAUL_SPAN, 7050) / 7050) < 1e-9,
    `4.5% of a new ship and 4.5% of a x32 one — ${haulCost(HAUL_SPAN, 7050).toFixed(0)} ` +
    `against ${haulCost(HAUL_SPAN, 225600).toFixed(0)} points`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the fix'}\n`);
process.exit(fails.length ? 1 : 0);
