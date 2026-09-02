// Orbs: the slow spread you beat by not standing somewhere.
//
// Every number quoted here was measured before it was chosen. The bench runs the real
// stepAlienAI loop against the real hulls, so what it reports is what the server does
// — but it is a FLOOR and not the answer, because its pilots are scripted. A policy
// either dodges a pattern perfectly or not at all, and a person does neither: the
// designer solos a Doldrum this bench says kills them. What is asserted here is the
// SHAPE — that a pilot who reads the pattern beats it and one who holds a course does
// not — and the shape is what survives the difference between a script and a person.

import { ORB_SPEED, READ_TIME, STAND, orbsOf, orbCount, orbSlots, stayFor,
         SHAPES, shapeOf, throwOrbs, stepOrbs } from '../shared/orbs.js';
import { ALIENS, WILD, newAlien, stepAlienAI, stepAlienRepair, threatDps, effectiveHp,
         bountyFor, xpFor, tintOf } from '../shared/aliens.js';
import { newShip, step, stepVitals } from '../shared/sim.js';
import { fire, stepBolts, faceTarget, BOLT_SPEED } from '../shared/combat.js';
import { ROCKET_SPEED } from '../shared/rockets.js';
import { buildFor } from '../shared/balance.js';
import { HULLS } from '../shared/ships.js';
import { MAPS } from '../shared/maps.js';
import { ORB_FIELDS, packOrb, unpackOrb, EPHEMERAL } from '../shared/net.js';
// The trigger a Kedge owns instead of a barrel, for the clock claim below: nothing in
// the bestiary fires a bolt any more, so the thing that must not be disturbed by the
// orb clock is somebody else's cadence rather than fire()'s.
import { stepSweep } from '../shared/sweep.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const DT = 1 / 30;
const MAP = MAPS.m1;
const AT = { x: 6000, y: 4000 };
const THROWERS = WILD.filter(k => orbsOf(ALIENS[k]));

// ============================================================================
console.log('\nwhat throws them');
// ============================================================================
// REWRITTEN, and the number in it is the job rather than a count that drifted. It read
// "two hostiles throw patterns" when the Ironhusk and the Leviathan were converted; the
// three lowest rungs of the ladder followed, and the claim is now that the bottom of
// the bestiary — the part a pilot actually learns to fly against — has no lasers left
// in it at all.
check('the whole tutorial ladder throws a pattern, and every one of them used to shoot a laser',
  ['drifter', 'harrier', 'ironhusk', 'leviathan', 'bandit'].every(k => THROWERS.includes(k)),
  THROWERS.map(k => `${ALIENS[k].name} ${orbCount(orbsOf(ALIENS[k]))} orbs a trigger`).join(', '));

// And each of them has to be a DIFFERENT thing, or this is one weapon painted five
// ways. The shape, whether it stays and how many it throws is the whole of a pattern's
// identity, so no two may agree on all three.
check('and no two of them throw the same pattern', (() => {
  const sig = k => { const o = orbsOf(ALIENS[k]);
    return `${o.shape ?? 'fan'}/${orbCount(o)}/${stayFor(o) > 0 ? 'stays' : 'spent'}`; };
  return new Set(THROWERS.map(sig)).size === THROWERS.length;
})(), THROWERS.map(k => { const o = orbsOf(ALIENS[k]);
  return `${ALIENS[k].name}: ${o.shape ?? 'fan'} of ${orbCount(o)}${stayFor(o) > 0 ? `, stays ${stayFor(o)}s` : ''}`;
}).join(' | '));

// A hostile with a pattern must not ALSO have a barrel. The gate is inside fire()
// rather than at its call sites because there are two of them — server.js and the
// claim bench — and one that fired both would be at twice its book dps in one place
// and not the other.
check('a hostile that throws a pattern does not also fire bolts', (() => {
  const a = newAlien('ironhusk', 1, MAP, 7, null);
  const mark = { x: a.x + 300, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                 stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  let bolts = 0, orbs = 0;
  for (let i = 0; i < 300; i++) { bolts += fire(a, mark, DT).length; orbs += throwOrbs(a, mark, DT).length; }
  return bolts === 0 && orbs > 0;
})(), 'ten seconds in front of one: 0 bolts, and the fan instead');

// And the trigger has to stay the trigger, or threatDps is quoting a cadence nothing
// runs at. This is the bug the first draft shipped: throwOrbs decremented `a.cool`
// before checking whether the hostile HAD a pattern, so every Drifter in the galaxy
// ran its gun at 1.58 cycles a second instead of 0.8, and the bench read an
// Ironhusk's bolt at 142 dps against a book of 72.
check('and a hostile with no pattern is not touched by the one that throws them', (() => {
  const mark = { x: AT.x + 200, y: AT.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                 stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  // TRIGGERS PULLED, not damage dealt, so this is about the CLOCK and nothing else.
  //
  // It has been rewritten twice for the same reason and the second time is the
  // interesting one. It was flown against a Drifter, which throws a ball now. Then
  // against a Kedge, "the plainest barrel left standing" — and there is no barrel left
  // standing: every hostile in the game has been converted and fire() returns nothing
  // for all thirteen. So the trigger counted here is the Kedge's LANCE, which is what
  // `a.cool` means for that hostile, and the claim is exactly the one it always was:
  // stepping the orb clock on something that does not throw orbs must not move it.
  const at = seed => { const a = newAlien('kedge', seed, MAP, 11, null); a.x = AT.x; a.y = AT.y; return a; };
  const a2 = at(3); let alone = 0;
  for (let i = 0; i < 30 * 30; i++) if (stepSweep(a2, mark, DT)) alone++;
  const a3 = at(4); let both = 0;
  for (let i = 0; i < 30 * 30; i++) { throwOrbs(a3, mark, DT); if (stepSweep(a3, mark, DT)) both++; }
  return alone === both && alone > 0;
})(), 'a Kedge swings the same number of lances in thirty seconds whether or not the orb clock is stepped');

// ============================================================================
console.log('\nhow slow is slow, and what dodgeable comes to in px/s');
// ============================================================================
check('an orb is slower than every other thing in the air',
  ORB_SPEED < ROCKET_SPEED && ORB_SPEED < BOLT_SPEED,
  `${ORB_SPEED} px/s against a rocket's ${ROCKET_SPEED} and a bolt's ${BOLT_SPEED}`);

// THE FLOOR. An orb cannot intercept anything moving faster than it is — the aim
// solve simply diverges — so a pattern slower than the hulls is a light show. This
// was measured the hard way at ORB_SPEED 300, which is exactly a Hauler's speed: an
// Ironhusk put 1% of what it threw into an orbiting Hauler.
const bare = k => newShip(0, 0, k, { weapon: [], generator: [], tech: [] }, [], 'line', null, 0).stats.speed;
const CATCHABLE = Object.keys(HULLS).filter(k => bare(k) < ORB_SPEED);
check('it is still fast enough to catch a pilot who holds a course',
  CATCHABLE.length >= Object.keys(HULLS).length - 1,
  `${CATCHABLE.length} of ${Object.keys(HULLS).length} hulls are slower than ${ORB_SPEED} px/s — ` +
  Object.keys(HULLS).map(k => `${HULLS[k].name} ${Math.round(bare(k))}`).join(', ') +
  '. The one it cannot catch at a full sprint has already left a fight it could only win by staying in');

// THE CEILING. v x (d/S - READ_TIME) is how far sideways a pilot gets before it
// arrives; it has to beat the half-width of the fan plus both radii.
const clears = (v, d, o, hullR) =>
  v * Math.max(0, d / ORB_SPEED - READ_TIME) >= d * (o.arc / 2) + o.r + hullR;
{
  const o = orbsOf(ALIENS.ironhusk);
  const room = (v, d) => Math.round(v * Math.max(0, d / ORB_SPEED - READ_TIME));
  const need = d => Math.round(d * (o.arc / 2) + o.r + 12);
  check('a starter hull clears an Ironhusk\'s cone with room to spare',
    clears(bare('hauler'), 400, o, 12),
    `${room(bare('hauler'), 400)}px of lateral room against ${need(400)}px of cone at the 400 it fights from, ` +
    `after ${READ_TIME}s of reading it`);
  // The slowest thing that flies, and it is the pilot the claim bench uses. It does
  // NOT clear the cone up close, and that is the Ironhusk's own lesson rather than an
  // oversight: its reach is 500 and holding your range costs it everything.
  const b = buildFor('finished');
  const laden = newShip(0, 0, b.hull, b.fit, b.drones, 'line', null, 0);
  check('and the heaviest laden hull only clears it at arm\'s length',
    !clears(laden.stats.speed, 300, o, laden.r) && clears(laden.stats.speed, 500, o, laden.r),
    `a laden ${HULLS[b.hull].name} at ${Math.round(laden.stats.speed)} px/s: ` +
    `${room(laden.stats.speed, 300)}px of room against ${need(300)} at 300px, ` +
    `${room(laden.stats.speed, 500)} against ${need(500)} at its full reach`);
}

// The reason a point test per tick IS the swept test. If this ever fails, an orb can
// step over a hull it should have crossed and the segment form is what replaces it:
// distance from the hull to the segment P -> P + V x dt.
check('an orb cannot step over a ship inside one tick, so the cheap test is the continuous one',
  THROWERS.every(k => ORB_SPEED * DT < orbsOf(ALIENS[k]).r),
  THROWERS.map(k => `${ALIENS[k].name}: ${Math.round(ORB_SPEED * DT)}px a tick against a ${orbsOf(ALIENS[k]).r}px orb`).join(', '));

// ============================================================================
console.log('\nthe pattern');
// ============================================================================
check('a fan is centred on the aim line and symmetric about it', (() => {
  const s = orbSlots({ n: 5, arc: 0.4 });
  return s.length === 5 && Math.abs(s[0] + s[4]) < 1e-9 && Math.abs(s[2]) < 1e-9
      && Math.abs(s[0] + 0.2) < 1e-9;
})(), 'five slots over 0.4rad: -0.2, -0.1, 0, +0.1, +0.2');
check('and a single slot is one orb straight down the line',
  orbSlots({ n: 1, arc: 0.4 }).length === 1 && orbSlots({ n: 1, arc: 0.4 })[0] === 0,
  'rule seven: a pattern of one degrades to a bolt-shaped thing rather than dividing by zero');

// A burst is clusters in TIME, and the ceiling is split across all of them: three
// clusters of three carry a ninth of the volley each, not a third.
check('a burst splits the volley across every cluster, not across one of them', (() => {
  const o = orbsOf(ALIENS.leviathan);
  return orbCount(o) === o.n * o.burst;
})(), (() => { const o = orbsOf(ALIENS.leviathan);
  return `${o.burst} clusters of ${o.n} is ${orbCount(o)} orbs carrying ` +
         `${Math.round(ALIENS.leviathan.attrs.damage / orbCount(o))} each`; })());

// ============================================================================
console.log('\nthe vocabulary');
// ============================================================================
// A shape is geometry and nothing else — it never re-solves an aim, so two of them
// cannot disagree about where the target is going. `aim` is worked out once in
// throwOrbs and handed in.
const AIM = { ax: 0, ay: 0, lead: 0, travel: 1, markD: ORB_SPEED,
              bx: ORB_SPEED, by: 0, bvx: 0, bvy: 0 };
check('a fan spreads its slots in ANGLE and throws them all the same distance', (() => {
  const s = SHAPES.fan({ n: 5, arc: 0.4 }, AIM);
  return s.length === 5 && s.every(x => Math.abs(x.d - AIM.markD) < 1e-9)
      && Math.abs(s[0].h + s[4].h) < 1e-9;
})(), 'five bearings over 0.4rad at one range — which is what makes a fan a wall you get off the line of');

check('a rake spreads its marks in TIME, along the target\'s own course', (() => {
  const moving = { ...AIM, bvx: 0, bvy: 300 };
  const s = SHAPES.rake({ n: 3, span: 0.28 }, moving);
  // Three distinct bearings, and each mark 0.28s of the target's travel further on.
  const at = i => ({ x: moving.bx + moving.bvx * (moving.travel + i * 0.28),
                     y: moving.by + moving.bvy * (moving.travel + i * 0.28) });
  return s.length === 3 && s.every((x, i) =>
    Math.abs(x.d - Math.hypot(at(i).x, at(i).y)) < 1e-6 &&
    Math.abs(x.h - Math.atan2(at(i).y, at(i).x)) < 1e-9);
})(), 'a target at 300px/s gets its marks 84px apart along the line it is flying');

// THE PROPERTY THAT KEEPS threatDps HONEST for a rake, stated as geometry rather than
// as a dps. If this ever stops being true the Harrier's book number stops being
// reachable and its bounty, its experience and its bestiary row are all quoting a
// hostile that does not exist.
check('and it collapses to a single mark when the target is not moving', (() => {
  const s = SHAPES.rake({ n: 3, span: 0.28 }, AIM);   // bvx = bvy = 0
  return s.every(x => Math.abs(x.d - s[0].d) < 1e-9 && Math.abs(x.h - s[0].h) < 1e-9);
})(), 'a pilot holding station has one mark, so the whole volley arrives on them — which is what ' +
      'makes the book number reachable, the same claim a fan makes point-blank');

// The no-hole rule, in a rake's units. orbSlots argues it for a fan's width; the same
// arithmetic here is span x (the fastest hull) <= 2 x (orb r + hull r).
check('a rake has no hole in it at any speed the shop sells', (() => {
  const o = orbsOf(ALIENS.harrier);
  return Object.keys(HULLS).every(k => {
    const s = newShip(0, 0, k, { weapon: [], generator: [], tech: [] }, [], 'line', null, 0);
    return o.span * s.stats.speed <= 2 * (o.r + s.r);
  });
})(), Object.keys(HULLS).map(k => {
  const s = newShip(0, 0, k, { weapon: [], generator: [], tech: [] }, [], 'line', null, 0);
  const o = orbsOf(ALIENS.harrier);
  return `${HULLS[k].name} ${Math.round(o.span * s.stats.speed)}px apart inside ${2 * (o.r + s.r)}px`;
}).join(', ') + ' — the fastest hull in the game is the one that decides `span`');

check('an unknown shape falls back to a fan rather than stopping the sector',
  shapeOf({ shape: 'nonesuch' }) === SHAPES.fan && shapeOf(undefined) === SHAPES.fan,
  'rule seven: a definition with a typo in it is a hostile that shoots oddly, not a tick that throws');

// --- what STAY does ------------------------------------------------------------
const STAYERS = THROWERS.filter(k => stayFor(orbsOf(ALIENS[k])) > 0);
check('a laid pattern stands for one of its own cycles, and that is derived',
  STAYERS.length > 0 && STAYERS.every(k =>
    Math.abs(stayFor(orbsOf(ALIENS[k])) - STAND / ALIENS[k].attrs.fireRate) < 0.02),
  STAYERS.map(k => `${ALIENS[k].name} ${stayFor(orbsOf(ALIENS[k]))}s at ${ALIENS[k].attrs.fireRate}/s`).join(', ') +
  ` — STAND is ${STAND}, so the field is never more than the throw that has just landed plus the ` +
  'one arriving. shared/aliens.js argues the ceiling on the Crucible: a hostile that holds more ' +
  'than a third of the ground its own fight is on has stopped shaping the space and started being it');

check('a caltrop comes to rest ON its mark and then does not move', (() => {
  const a = newAlien('bandit', 21, MAP, 5, null);
  const mark = { x: a.x + 420, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                 stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  let orbs = [];
  for (let i = 0; i < 200 && !orbs.length; i++) for (const o of throwOrbs(a, mark, DT)) orbs.push(o);
  if (!orbs.length) return false;
  const one = orbs[0], want = { x: mark.x, y: mark.y };
  // Nobody to hit — the mark is not in the body list — so it flies, lands and lies there.
  let stopped = -1, at = null;
  for (let i = 0; i < 200; i++) {
    stepOrbs(orbs, [], DT);
    if (stopped < 0 && one.vx === 0 && one.vy === 0) { stopped = i * DT; at = { x: one.x, y: one.y }; }
  }
  const miss = at ? Math.hypot(at.x - want.x, at.y - want.y) : 1e9;
  const lived = orbs.length === 0;      // and it does expire in the end
  // It stopped inside a hull of the place it was aimed at, and it stayed there for
  // `stay` seconds afterwards rather than carrying on.
  return stopped > 0 && miss < 30 && lived
      && Math.abs(one.x - at.x) < 1e-9 && Math.abs(one.y - at.y) < 1e-9;
})(), 'it stops within a hull of the point it was thrown at, and the step is clamped to the flight ' +
      'so it lands ON the mark rather than a quarter of a hit disc past it');

check('and a pattern that does not stay is not touched by any of this', (() => {
  const a = newAlien('ironhusk', 22, MAP, 5, null);
  const mark = { x: a.x + 300, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                 stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  let orbs = [];
  for (let i = 0; i < 200 && !orbs.length; i++) for (const o of throwOrbs(a, mark, DT)) orbs.push(o);
  const one = orbs[0];
  const reachT = ALIENS.ironhusk.attrs.weaponRange / ORB_SPEED;
  if (!one || one.fly !== Infinity || Math.abs(one.ttl - reachT) > 1e-9) return false;
  // Full ORB_SPEED every tick until it expires, and never parked.
  for (let i = 0; i < 20; i++) stepOrbs(orbs, [], DT);
  return Math.abs(Math.hypot(one.vx, one.vy) - ORB_SPEED) < 1e-9;
})(), 'fly is Infinity, so min(dt, fly) is dt and every orb the game had before `stay` existed moves ' +
      'exactly as it did — the Ironhusk and the Leviathan rows in the table above are the proof');

check('and it arrives as a barrage rather than all at once', (() => {
  const a = newAlien('leviathan', 5, MAP, 3, null);
  const mark = { x: a.x + 600, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                 stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  const at = [];
  for (let i = 0; i < 30 * 6; i++) { if (throwOrbs(a, mark, DT).length) at.push(i * DT); }
  const o = orbsOf(ALIENS.leviathan);
  if (at.length < o.burst) return false;
  const beat = at[1] - at[0];
  return Math.abs(beat - o.beat) < DT * 1.5;
})(), (() => { const o = orbsOf(ALIENS.leviathan);
  return `${o.burst} clusters ${o.beat}s apart inside a ${(1 / ALIENS.leviathan.attrs.fireRate).toFixed(1)}s cycle`; })());

// ============================================================================
console.log('\nwhat it costs the pilot, against the weapon it replaced');
// ============================================================================
//
// The harness: one hostile, one pilot, the real AI. `bolt` strips the pattern off a
// COPY of the definition so fire()'s gate opens, which is how the two weapons are
// measured in the same loop rather than against a number quoted from memory.
const pilot = hull => {
  const b = hull === 'finished' ? buildFor('finished') : { hull, fit: { weapon: [], generator: [], tech: [] }, drones: [] };
  const s = newShip(AT.x, AT.y, b.hull, b.fit, b.drones ?? [], 'line', null, 0);
  s.stats = { ...s.stats, hull: 1e12, shield: 0 };
  s.hp = 1e12; s.shield = 0;
  return s;
};
const foe = (kind, dist, bolt) => {
  const a = newAlien(kind, 5000, MAP, 7, null);
  a.x = AT.x + dist; a.y = AT.y;
  a.stats = { ...a.stats, hull: 1e12 };
  a.hp = 1e12; a.post = null; a.provoked.add(1); a.target = 1;
  if (bolt) { a.def = { ...a.def }; delete a.def.orbs; }
  return a;
};
// Three policies, and the middle one is what tells a rake apart from a fan.
//   park     never moves. This is where the book number has to land.
//   line     one heading, held for ever. A straight course is NOT a dodge, and every
//            pattern in the game is entitled to collect on one.
//   weave    hold station at `hold` and reverse across the line of fire every 0.7s.
//            The claim bench's own kite policy, and the honest floor for a pilot who
//            is reading what is coming at them.
const run = (kind, { dist, hold, hull, bolt = false, policy = 'park', secs = 60 }) => {
  const me = pilot(hull), a = foe(kind, dist, bolt);
  const here = [{ id: 1, ship: me, haven: false, loud: 1 }];
  let air = [], orbs = [], dealt = 0, w = 1, wt = 0, peak = 0, sum = 0, n = 0;
  for (let i = 0; i < secs * 30; i++) {
    const tgt = stepAlienAI(a, MAP, here, DT);
    step(a, DT); stepVitals(a, DT, false); stepAlienRepair(a, DT); faceTarget(a, me);
    if (policy === 'weave') {
      wt += DT; if (wt > 0.7) { wt = 0; w = -w; }
      const ax = me.x - a.x, ay = me.y - a.y, d = Math.hypot(ax, ay) || 1;
      let wx = a.x + (ax / d) * hold, wy = a.y + (ay / d) * hold;
      const lx = wx - a.x, ly = wy - a.y, ld = Math.hypot(lx, ly) || 1;
      wx += (-ly / ld) * 150 * w; wy += (lx / ld) * 150 * w;
      me.tx = wx; me.ty = wy; me.dx = me.dy = null;
      step(me, DT); stepVitals(me, DT, false);
    } else if (policy === 'line') {
      // Full thrust across the line of fire and never a change of mind. The hostile is
      // carried alongside so the RANGE is the same as the parked run and the only
      // difference being measured is the heading.
      me.dx = 0; me.dy = 1; me.tx = me.ty = null;
      step(me, DT); stepVitals(me, DT, false);
      a.x = me.x + dist; a.y = me.y; a.vx = me.vx; a.vy = me.vy;
    }
    for (const b of fire(a, tgt ? me : null, DT)) air.push(b);
    for (const o of throwOrbs(a, tgt ? me : null, DT)) orbs.push(o);
    for (const h of stepBolts(air, DT)) dealt += h.split.shield + h.split.hull;
    for (const h of stepOrbs(orbs, here, DT)) dealt += h.split.shield + h.split.hull;
    peak = Math.max(peak, orbs.length); sum += orbs.length; n++;
  }
  return { dps: dealt / secs, peak, air: sum / n };
};

// Every hostile that throws a pattern, at the range it actually fights from.
const CASES = [
  ['drifter',   { dist: 364, hold: 400 }],
  ['harrier',   { dist: 392, hold: 430 }],
  ['bandit',    { dist: 448, hold: 480 }],
  ['ironhusk',  { dist: 420, hold: 460 }],
  ['leviathan', { dist: 780, hold: 820 }],
];
const table = {};
for (const [kind, at] of CASES) {
  const weave = run(kind, { ...at, hull: 'finished', policy: 'weave' });
  table[kind] = {
    holdBolt: run(kind, { ...at, hull: 'hauler', bolt: true }).dps,
    holdOrb:  run(kind, { ...at, hull: 'hauler' }).dps,
    lineOrb:  run(kind, { ...at, hull: 'hauler', policy: 'line' }).dps,
    weaveBolt: run(kind, { ...at, hull: 'finished', bolt: true, policy: 'weave' }).dps,
    weaveOrb:  weave.dps, peak: weave.peak, air: weave.air,
  };
}
const f = n => n.toFixed(1);
console.log('     hostile      book   parked: bolt / pattern   straight   weaving: bolt / pattern   in the air');
for (const [kind, r] of Object.entries(table))
  console.log(`     ${ALIENS[kind].name.padEnd(12)} ${String(threatDps(kind, 1e6, 1e6).toFixed(1)).padStart(5)}   ` +
              `${f(r.holdBolt).padStart(11)} / ${f(r.holdOrb).padEnd(7)} ${f(r.lineOrb).padStart(7)}   ` +
              `${f(r.weaveBolt).padStart(12)} / ${f(r.weaveOrb).padEnd(7)} ${r.air.toFixed(1)} avg, ${r.peak} peak`);

// THE WHOLE POINT, stated as three claims that pull in different directions.
check('a pilot who holds a course pays exactly what they always paid',
  Object.entries(table).every(([, r]) => r.holdOrb >= r.holdBolt * 0.95),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${f(r.holdOrb)} against the bolt's ${f(r.holdBolt)}`).join(', ') +
  ' — which is why threatDps, the bounty, the bestiary report and three claim rosters did not move');
// AND NEITHER IS HOLDING A HEADING, which is the claim that stops a dodgeable pattern
// being a free one. It is the rule orbSlots argues for a fan's width — no pattern in
// this game may have a hole a straight-flying pilot fits through — restated as a dps:
// full thrust in one direction for a minute costs at least two thirds of standing
// still, and over three times what CHANGING that direction costs. The dodge in this
// game is a change of mind, not a speed.
check('and holding one heading is not a dodge either',
  Object.entries(table).every(([, r]) => r.lineOrb >= r.holdOrb * 0.6 && r.lineOrb > r.weaveOrb * 2.5),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${f(r.lineOrb)} holding one heading — ${Math.round(100 * r.lineOrb / r.holdOrb)}% of ` +
    `standing still and x${(r.lineOrb / Math.max(0.1, r.weaveOrb)).toFixed(1)} what weaving costs`).join(', ') +
  ' — and a rake lays its marks ALONG the line you picked, so for a Harrier it is the worst of both');
check('and a pilot who reads the pattern pays a fraction of it',
  Object.entries(table).every(([, r]) => r.weaveOrb < r.weaveBolt * 0.5),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${f(r.weaveOrb)} weaving against ${f(r.weaveBolt)} for the bolt it replaced`).join(', ') +
  ' — the same weave, the same range, the same hull');

// The ceiling has to be REACHABLE or threatDps is a fiction. It is what the whole
// volley does when the whole volley lands, and holding station is where that happens.
check('the book number is what the whole pattern does when the whole pattern lands',
  Object.entries(table).every(([k, r]) => r.holdOrb <= threatDps(k, 1e6, 1e6) * 1.02
                                       && r.holdOrb >= threatDps(k, 1e6, 1e6) * 0.9),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} lands ${f(r.holdOrb)} of a book ${threatDps(k, 1e6, 1e6)}`).join(', ') +
  ' — the same claim threatDps already makes for a mirror\'s chamber and a ring\'s discharge');

// ============================================================================
console.log('\nwhat it costs everything else');
// ============================================================================
// REWRITTEN to cover the whole family rather than the two it was written for, because
// three more hostiles have since had their weapon replaced and the claim is the same
// one: a conversion may change what MOVING is worth and nothing else.
const PAY = { drifter: [455, 140], harrier: [1442, 444], bandit: [79800, 24554],
              ironhusk: [4550, 1400], leviathan: [45500, 14000] };
check('not one of them is worth a credit more or less than it was',
  Object.entries(PAY).every(([k, [cr, xp]]) => bountyFor(k) === cr && xpFor(k) === xp),
  Object.entries(PAY).map(([k]) =>
    `${ALIENS[k].name} ${bountyFor(k)}cr / ${xpFor(k)}xp`).join(', ') +
  ' — every one of them derives from effective hit points times effort, and no hit point moved');
// The Bandit is the one that had to have its stat block rewritten to keep this true:
// 300 x 0.65 where it was 150 x 1.3, for the reason the Leviathan is 300 x 0.4 — half
// as many bodies in the air for the same product. A reader that took `damage` alone
// would be wrong about both, and there is not one.
const BOOK = { drifter: 49.5, harrier: 60, bandit: 195, ironhusk: 72, leviathan: 120 };
check('and none of them reads as a different threat than it did',
  Object.entries(BOOK).every(([k, dps]) => Math.abs(threatDps(k, 1e6, 1e6) - dps) < 1e-9),
  Object.entries(BOOK).map(([k, dps]) =>
    `${ALIENS[k].name} ${dps} (${ALIENS[k].attrs.damage} x ${ALIENS[k].attrs.fireRate})`).join(', ') +
  ' — every reader of that table takes the PRODUCT, which is what lets a cadence be ' +
  'chosen for how many orbs it puts in the air');
// AND THE MOTHERSHIP READS THE SAME, which is the one place a Bandit's cadence could
// have leaked: a Hive's own gun is 110 dps and its threat is twelve raiders.
check('so a Corsair Hive is exactly as dangerous as it was',
  threatDps('hive', 1e6, 1e6) === 220 * 0.5 + 12 * 195,
  `${threatDps('hive', 1e6, 1e6)} — its own barrel plus ${ALIENS.hive.broods.max} Bandits at 195, ` +
  'and hiveDps derives from the same term');

// The wire. A body needs a place, a facing, its size, how fast it is going and WHOSE IT
// IS, and one field per orb per tick is what a spread costs thirty times a second.
//
// REWRITTEN TWICE IN A WEEK, and both rewrites are the claim following the game rather
// than the test being wrong. It read "an orb is five fields on the wire", which was true
// while every orb travelled at ORB_SPEED and nothing on the row said who threw it.
//
//   `v` broke the first half. A pattern that STAYS is doing 0 px/s, and the client
//       dead-reckons between snapshots — without the speed it flew a parked caltrop 48px
//       away from the disc the server collides with, which is the "drawn at one radius,
//       hit at another" bug in a different axis.
//   `k` broke the second. There was no owner on the row at all, so the client drew every
//       orb in the game in one colour and an Ironhusk's #d0563f and a Leviathan's
//       #8fe04a were the same orange ball. An index into the bestiary rather than a
//       colour, for the three reasons written down at kindIx() in shared/aliens.js.
check('an orb is seven fields: a place, a facing, a radius, a speed and whose it is',
  ORB_FIELDS.length === 7 && ORB_FIELDS.includes('r') && ORB_FIELDS.includes('v') &&
  ORB_FIELDS.includes('k'),
  ORB_FIELDS.join(' ') + ' — one more than a rocket. `v` arrived with the caltrops and is DERIVED ' +
  'from the velocity rather than stored beside it, so the two cannot disagree; `k` arrived with ' +
  'the colours and is a row in the bestiary rather than a colour, so it cannot go stale');
check('and it survives the round trip', (() => {
  const o = { x: 1234.7, y: 891.2, heading: -0.6789, r: 44, foe: true, vx: 240, vy: -320, k: 6 };
  const back = unpackOrb(packOrb(o));
  return back.x === 1235 && back.y === 891 && back.h === -0.68 && back.r === 44
      && back.foe === 1 && back.v === 400 && back.k === 6;
})(), JSON.stringify(unpackOrb(packOrb({ x: 1234.7, y: 891.2, heading: -0.6789, r: 44, foe: true,
                                        vx: 240, vy: -320, k: 6 }))));
check('and a parked one reaches the client parked', (() => {
  const back = unpackOrb(packOrb({ x: 10, y: 20, heading: 1.1, r: 50, foe: true, vx: 0, vy: 0 }));
  return back.v === 0;
})(), 'v is 0 for a caltrop that has reached its mark, so the client stops flying it forward — ' +
      'at ORB_SPEED it drew the hazard up to 48px off the thing it is sitting on');
// And the thrower actually reaches the row, which is the half a field count cannot say.
check("and an orb knows which hostile threw it, so a Leviathan's are green",
  (() => {
    const husk = newAlien('ironhusk', 1, MAPS.m2, 5, { x: 0, y: 0 });
    const levi = newAlien('leviathan', 2, MAPS.m2, 5, { x: 0, y: 0 });
    const foe = { x: 300, y: 0, vx: 0, vy: 0, hp: 100, r: 17 };
    const a = throwOrbs(husk, foe, 1 / 30), b = throwOrbs(levi, foe, 1 / 30);
    return a.length && b.length && a[0].k !== b[0].k &&
           tintOf(a[0].k) === ALIENS.ironhusk.colour && tintOf(b[0].k) === ALIENS.leviathan.colour;
  })(),
  `${ALIENS.ironhusk.colour} against ${ALIENS.leviathan.colour} — the colour comes off the same ` +
  'ALIENS entry that draws the hull, so the two cannot drift apart');
check('the radius the client draws IS the radius the server collides with',
  THROWERS.every(k => {
    const a = newAlien(k, 9, MAP, 5, null);
    const mark = { x: a.x + 300, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                   stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
    let one = null;
    for (let i = 0; i < 300 && !one; i++) one = throwOrbs(a, mark, DT)[0] ?? null;
    return one && unpackOrb(packOrb(one)).r === orbsOf(ALIENS[k]).r;
  }),
  'a ball you can see and cannot be hit by is the "row you can see and cannot click" bug ' +
  'moved out of a panel and into a fight');
check('orbs go whole every tick like every other projectile',
  EPHEMERAL.includes('orbs'),
  'no identity worth diffing, a life under three seconds, and the two fields that matter ' +
  'change every tick — the same measurement bolts and rockets are ephemeral for');

// ============================================================================
console.log('\nwhat an orb hits');
// ============================================================================
// It has no target. That is the difference from a bolt stated as a rule: a bolt
// resolves against the one ship it was aimed at, and an orb hits whatever it goes
// through, which is what makes it a hazard rather than an aimed shot.
check('an orb hits whatever it passes through, not the ship it was aimed at', (() => {
  const a = newAlien('ironhusk', 12, MAP, 5, null);
  const aimed = { x: a.x + 400, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                  stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  // A bystander standing between the two, who was never fired at.
  const between = { x: a.x + 200, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                    stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  let orbs = [], onBystander = 0;
  for (let i = 0; i < 300; i++) {
    for (const o of throwOrbs(a, aimed, DT)) orbs.push(o);
    for (const h of stepOrbs(orbs, [{ id: 2, ship: between }], DT)) onBystander++;
  }
  return onBystander > 0;
})(), 'a pilot standing in front of the one being shot at takes the volley, which no bolt in this game does');

check('and sanctuary travels with it, so a wall outlives the hostile that threw it', (() => {
  const a = newAlien('ironhusk', 13, MAP, 5, null);
  const mark = { x: a.x + 300, y: a.y, vx: 0, vy: 0, r: 12, hp: 1e9, shield: 0,
                 stats: { hull: 1e9, shield: 0 }, sinceHit: 0, shieldHit: 0 };
  let orbs = [];
  for (let i = 0; i < 120 && !orbs.length; i++) for (const o of throwOrbs(a, mark, DT)) orbs.push(o);
  if (!orbs.length) return false;
  const carries = orbs.every(o => o.by === a.provoked);
  // The predicate is the caller's, and refusing it costs the orb nothing: it flies
  // straight on. Twenty ticks and not ninety, because an orb only lives its weapon's
  // reach — 500px at 400px/s is 37 ticks — and "they all expired" would pass this for
  // the wrong reason.
  const before = orbs.length;
  for (let i = 0; i < 20; i++) stepOrbs(orbs, [{ id: 1, ship: mark }], DT, () => false);
  const spared = orbs.length === before;
  // And the same twenty ticks with the predicate open take them.
  for (let i = 0; i < 20; i++) stepOrbs(orbs, [{ id: 1, ship: mark }], DT);
  return carries && spared && orbs.length < before;
})(), 'the provoked set by reference, the way a sown patch carries its sower\'s — and a pilot it ' +
      'may not harm is flown straight through rather than shielded');

console.log(fails.length ? `\nFAIL — ${fails.length}: ${fails.join(', ')}`
                         : `\nPASS — a spread that costs a straight-line pilot everything and a moving one almost nothing`);
process.exit(fails.length ? 1 : 0);
