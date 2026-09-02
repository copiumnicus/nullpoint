// Orbs: the slow spread you beat by not standing somewhere.
//
// Every number quoted here was measured before it was chosen. The bench runs the real
// stepAlienAI loop against the real hulls, so what it reports is what the server does
// — but it is a FLOOR and not the answer, because its pilots are scripted. A policy
// either dodges a pattern perfectly or not at all, and a person does neither: the
// designer solos a Doldrum this bench says kills them. What is asserted here is the
// SHAPE — that a pilot who reads the pattern beats it and one who holds a course does
// not — and the shape is what survives the difference between a script and a person.

import { ORB_SPEED, READ_TIME, orbsOf, orbCount, orbSlots, throwOrbs, stepOrbs } from '../shared/orbs.js';
import { ALIENS, WILD, newAlien, stepAlienAI, stepAlienRepair, threatDps, effectiveHp,
         bountyFor, xpFor, tintOf } from '../shared/aliens.js';
import { newShip, step, stepVitals } from '../shared/sim.js';
import { fire, stepBolts, faceTarget, BOLT_SPEED } from '../shared/combat.js';
import { ROCKET_SPEED } from '../shared/rockets.js';
import { buildFor } from '../shared/balance.js';
import { HULLS } from '../shared/ships.js';
import { MAPS } from '../shared/maps.js';
import { ORB_FIELDS, packOrb, unpackOrb, EPHEMERAL } from '../shared/net.js';

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
check('two hostiles throw patterns, and both of them used to shoot a laser',
  THROWERS.length === 2 && THROWERS.includes('ironhusk') && THROWERS.includes('leviathan'),
  THROWERS.map(k => `${ALIENS[k].name} ${orbCount(orbsOf(ALIENS[k]))} orbs a trigger`).join(', '));

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
  // Bolts fired, not damage dealt, so this is about the CLOCK and nothing else.
  const at = seed => { const a = newAlien('drifter', seed, MAP, 11, null); a.x = AT.x; a.y = AT.y; return a; };
  const a2 = at(3); let alone = 0;
  for (let i = 0; i < 30 * 30; i++) alone += fire(a2, mark, DT).length;
  const a3 = at(4); let both = 0;
  for (let i = 0; i < 30 * 30; i++) { throwOrbs(a3, mark, DT); both += fire(a3, mark, DT).length; }
  return alone === both && alone > 0;
})(), 'a Drifter fires the same number of bolts in thirty seconds whether or not the orb clock is stepped');

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
// `weave`: hold station at `hold` and reverse across the line of fire every 0.7s.
// The claim bench's own kite policy, and the honest floor for a pilot who is reading
// what is coming at them.
const run = (kind, { dist, hold, hull, bolt = false, weave = false, secs = 60 }) => {
  const me = pilot(hull), a = foe(kind, dist, bolt);
  const here = [{ id: 1, ship: me, haven: false, loud: 1 }];
  let air = [], orbs = [], dealt = 0, w = 1, wt = 0, peak = 0;
  for (let i = 0; i < secs * 30; i++) {
    const tgt = stepAlienAI(a, MAP, here, DT);
    step(a, DT); stepVitals(a, DT, false); stepAlienRepair(a, DT); faceTarget(a, me);
    if (weave) {
      wt += DT; if (wt > 0.7) { wt = 0; w = -w; }
      const ax = me.x - a.x, ay = me.y - a.y, d = Math.hypot(ax, ay) || 1;
      let wx = a.x + (ax / d) * hold, wy = a.y + (ay / d) * hold;
      const lx = wx - a.x, ly = wy - a.y, ld = Math.hypot(lx, ly) || 1;
      wx += (-ly / ld) * 150 * w; wy += (lx / ld) * 150 * w;
      me.tx = wx; me.ty = wy; me.dx = me.dy = null;
      step(me, DT); stepVitals(me, DT, false);
    }
    for (const b of fire(a, tgt ? me : null, DT)) air.push(b);
    for (const o of throwOrbs(a, tgt ? me : null, DT)) orbs.push(o);
    for (const h of stepBolts(air, DT)) dealt += h.split.shield + h.split.hull;
    for (const h of stepOrbs(orbs, here, DT)) dealt += h.split.shield + h.split.hull;
    peak = Math.max(peak, orbs.length);
  }
  return { dps: dealt / secs, peak };
};

const CASES = [
  ['ironhusk',  { dist: 420, hold: 460 }],
  ['leviathan', { dist: 780, hold: 820 }],
];
const table = {};
for (const [kind, at] of CASES) {
  table[kind] = {
    holdBolt: run(kind, { ...at, hull: 'hauler', bolt: true }).dps,
    holdOrb:  run(kind, { ...at, hull: 'hauler' }).dps,
    weaveBolt: run(kind, { ...at, hull: 'finished', bolt: true, weave: true }).dps,
    weaveOrb:  run(kind, { ...at, hull: 'finished', weave: true }).dps,
    peak: run(kind, { ...at, hull: 'finished', weave: true }).peak,
  };
}
const f = n => n.toFixed(1);
console.log('     hostile      book   holding station: bolt / orb    weaving: bolt / orb');
for (const [kind, r] of Object.entries(table))
  console.log(`     ${ALIENS[kind].name.padEnd(12)} ${String(threatDps(kind, 1e6, 1e6)).padStart(4)}   ` +
              `${f(r.holdBolt).padStart(14)} / ${f(r.holdOrb).padEnd(8)}  ${f(r.weaveBolt).padStart(9)} / ${f(r.weaveOrb)}`);

// THE WHOLE POINT, stated as two claims that pull in opposite directions.
check('a pilot who holds a course pays exactly what they always paid',
  Object.entries(table).every(([, r]) => r.holdOrb >= r.holdBolt * 0.95),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${f(r.holdOrb)} against the bolt's ${f(r.holdBolt)}`).join(', ') +
  ' — which is why threatDps, the bounty, the bestiary report and three claim rosters did not move');
check('and a pilot who reads the pattern pays a fraction of it',
  Object.entries(table).every(([, r]) => r.weaveOrb < r.weaveBolt * 0.4),
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
check('neither hostile is worth a credit more or less than it was',
  bountyFor('ironhusk') === 4550 && xpFor('ironhusk') === 1400 &&
  bountyFor('leviathan') === 45500 && xpFor('leviathan') === 14000,
  `Ironhusk ${bountyFor('ironhusk')}cr / ${xpFor('ironhusk')}xp at ${effectiveHp('ironhusk')} ehp, ` +
  `Leviathan ${bountyFor('leviathan')}cr / ${xpFor('leviathan')}xp at ${effectiveHp('leviathan')} — ` +
  'both derive from effective hit points, and no hit point moved');
check('and neither reads as a different threat than it did',
  threatDps('ironhusk', 1e6, 1e6) === 72 && threatDps('leviathan', 1e6, 1e6) === 120,
  `72 and 120, unchanged — the Leviathan is 300 x 0.4 where it was 150 x 0.8, and every ` +
  'reader of that table takes the product');

// The wire. A body needs a place, a facing, its size and WHOSE IT IS, and one field per
// orb per tick is what a spread costs thirty times a second.
//
// REWRITTEN, not deleted: this said five fields and it now says six, because the row was
// missing the only thing that says which hostile threw it. Without `k` the client drew
// every orb in the game in one colour, so an Ironhusk's #d0563f and a Leviathan's
// #8fe04a were the same orange ball — the designer found it in a minute of flying. An
// index into the bestiary rather than a colour, for the three reasons written down at
// kindIx() in shared/aliens.js.
check('an orb is six fields on the wire: a place, a facing, a radius and whose it is',
  ORB_FIELDS.length === 6 && ORB_FIELDS.includes('r') && ORB_FIELDS.includes('h') &&
  ORB_FIELDS.includes('k'),
  ORB_FIELDS.join(' ') + ' — still one fewer than a rocket plus its owner, because every orb ' +
  'travels at ORB_SPEED and one heading is one field where a velocity is two');
check('and it survives the round trip', (() => {
  const o = { x: 1234.7, y: 891.2, heading: -0.6789, r: 44, foe: true, k: 6 };
  const back = unpackOrb(packOrb(o));
  return back.x === 1235 && back.y === 891 && back.h === -0.68 && back.r === 44 && back.foe === 1
      && back.k === 6;
})(), JSON.stringify(unpackOrb(packOrb({ x: 1234.7, y: 891.2, heading: -0.6789, r: 44, foe: true, k: 6 }))));
// And the thrower actually reaches the row, which is the half a field count cannot say.
check('and an orb knows which hostile threw it, so a Leviathan\'s are green',
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
