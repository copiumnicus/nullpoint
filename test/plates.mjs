// Claims about the Antiphon, and about answering armour.
//
// One hostile in the game fights by storing what you deal it PER BEARING and giving
// it back ALONG one. Everything else that hits you either shoots at where you are
// going (a gun) or burns where you are standing (ground), and both of those are
// answered by the same verb — keep moving. This one is answered by a different verb,
// and the whole file exists to show that the different verb is really there:
//
//     DO NOT STAND STILL RELATIVE TO WHAT YOU ARE SHOOTING.
//
// Two properties have to survive or the hostile has no reason to exist, and they are
// the two the deeps do not have. They are measured here rather than asserted:
//
//   1. MORE PILOTS MUST GENUINELY HELP. balance.js's POSTING says in as many words
//      that the deep pair is not completable at any party size, because ground does
//      not divide: a pool burns everybody standing in it, so time-to-die is flat in
//      party size while time-to-clear falls as 1/n. A ring has ONE voice and answers
//      one bearing a cycle, so it has to be the other way round.
//
//   2. IT MUST REPAIR "KEEP MOVING". The deeps inverted that — test/ground.mjs
//      asserts, in as many words, that standing still now outlives circling, because
//      the plasma lands at your feet and moving buys nothing. Circling has to win
//      here, measured, or the design has failed.
//
// Everything below runs through the real loop — stepAlienAI, stepRing, answer, step,
// stepVitals, fire and stepBolts, in the order server.js calls them — so what is
// measured is the fight rather than the arithmetic that was hoped for.
//
// A WARNING ABOUT THIS INSTRUMENT, and it is the same one test/ground.mjs earns:
// these policies are scripted approximations. `hold` stands at its own gun range and
// `orbit` circles at it; a person reads a fight far better than either, breaks off,
// picks a lane and comes back. Every survival number here is a FLOOR rather than a
// verdict. What the file is for is the SHAPE — circling beats standing, four beat one
// — and the shape is what the assertions are written about.

import { ALIENS, WILD, effectiveHp, farmHp, newAlien, stepAlienAI, stepAlienRepair,
         storeHit, mayHarm, CORE_HP, BOUNTY_RATE, XP_RATE, threatDps, bountyFor, xpFor,
         MIRROR, soakOf, payloadOf, outlineOf, dialsOn } from '../shared/aliens.js';
import { platesOf, plateAt, plateMid, arcOf, plateArc, plateCount, plateFill, plateHalf,
         newRing, stepRing, storeBearing, softAt, hottest, dischargeOf, deflectOf,
         spreadOf, answer, PLATE_MAX, ANSWER_FLOOR,
         crackOf, holeOf, broke, brokenCount, openAt } from '../shared/plates.js';
import { newShip, step, stepVitals, applyDamage, inHaven } from '../shared/sim.js';
import { fire, stepBolts, faceTarget, BOLT_SPEED, HIT_R } from '../shared/combat.js';
import { MAPS } from '../shared/maps.js';
import { ANCHORS, POSTING, buildFor, stageDps, stageEhp } from '../shared/balance.js';
import { PLATE_FIELDS, PLATE_STEPS, PLATE_COLS, STREAMS, packPlates, unpackPlates } from '../shared/net.js';
import { diffRows, applyRows } from '../shared/delta.js';
import { MODULE_KEYS } from '../shared/research.js';
import { routeTo } from '../shared/power.js';
import { DROPS } from '../shared/cargo.js';
import { readFileSync } from 'node:fs';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const X32 = MODULE_KEYS.reduce((m, _, i) => m | (1 << i), 0);
const A = ALIENS.antiphon;
const n = v => Math.round(v).toLocaleString('en-US');

// The reactor is ON and on the weapons, for test/ground.mjs's reason: balance.js
// quotes the BOOSTED gun, and a bench pilot who never routed power anywhere delivered
// 6,450 of a finished Bulwark's 11,307. Every mirror number in this repo was that
// mistake until 0.63, and every ring number would have been the same mistake.
const pilot = (stage = 'deep', research = 0, route = 'weapons') => {
  const b = buildFor(stage);
  const s = newShip(6000, 4000, b.hull, b.fit, b.drones, 'wedge', null, research);
  routeTo(s.power, route);
  return s;
};

// --- the ring, as arithmetic ----------------------------------------------------
console.log('\nthe ring');
{
  check('one hostile has a ring, and it is the thing in Nullpoint',
    WILD.filter(k => platesOf(ALIENS[k])).length === 1 && !!platesOf(A),
    `${A.name}, ${n(effectiveHp('antiphon'))} effective hit points — the bestiary's ladder of tens ` +
    'one full decade past a Corsair Hive');
  check('a plate fills with one percent of the hostile it is bolted to',
    Math.abs(plateFill(A) - 0.01 * effectiveHp('antiphon')) < 1e-6 && plateFill(A) === 65000,
    `${n(plateFill(A))} points into one bearing. A SHARE and not an amount, so the wire needs no ` +
    'normalising constant and the number moves with the rung instead of being retyped');
  // Not a second number: MIRROR.half's own rule, restated. "The clock of this fight is
  // its trigger, so the natural unit of break off for a moment is one shot it did not
  // get to reload from." The party arithmetic below depends on the ratio of the two
  // being exactly one, so it is derived rather than written down twice.
  check('and it halves in one of the ring\'s own answering cycles',
    Math.abs(plateHalf(A) * A.attrs.fireRate - 1) < 1e-9 && plateHalf(A) === MIRROR.half,
    `${plateHalf(A)}s at a cadence of ${A.attrs.fireRate}/s — the same identity the Thresher's ` +
    `chamber uses, and the same ${MIRROR.half}s it lands on`);
  // The ceiling, and it is MIRROR's constant rather than a copy of it. A full plate
  // returns exactly what the sharpest gun on the climb delivers in one cycle.
  const full = dischargeOf(A, 1);
  check('a ring can never throw anything the shop does not already sell',
    Math.abs(full - MIRROR.dps / A.attrs.fireRate) < 1e-6 && full <= stageEhp('deep'),
    `a full plate carries ${n(full)} — one second of stageDps('finished'), which is ` +
    `${(100 * full / stageEhp('deep')).toFixed(0)}% of the deep-shelf ship it is posted against and ` +
    `${(100 * full / stageEhp('finished')).toFixed(0)}% of a finished one. The Thresher's history is the ` +
    'argument: uncapped and one-for-one it put 9,011 into a 7,050 ship');
  // The rule that stops armour becoming a wall. berth.js already wrote what this
  // codebase thinks of those: "a gate you can only pass by already being through it".
  check('a plate may never turn more than it lets through',
    deflectOf(A) <= 0.5 && deflectOf({ ...A, plates: { ...A.plates, deflect: 0.95 } }) === 0.5,
    `${(100 * deflectOf(A)).toFixed(0)}% at full charge, and a definition asking for 95% is clamped ` +
    'to the same half — past it the armour is doing more work than the core and the plate has ' +
    'stopped being armour');
  // The wire and the ring are ONE number, read off the field list rather than typed
  // twice. A definition asking for a ninth plate would silently drop it off the
  // snapshot, and the client would draw a cold wedge that was about to fire.
  //
  // REWRITTEN when the stream grew a second column a plate: it was
  // `PLATE_FIELDS.length - 1` when every column was a charge, and the row now carries
  // a charge AND a strain for each, so the count is the half. Read off net.js either
  // way — the point of the claim is that nobody can type the two apart, and that is
  // still exactly what it checks.
  check('the ring can never be wider than the snapshot that carries it',
    PLATE_MAX === PLATE_COLS && PLATE_FIELDS.length === 1 + 2 * PLATE_COLS &&
    plateCount(A) <= PLATE_MAX &&
    plateCount({ ...A, plates: { ...A.plates, n: 40 } }) === PLATE_MAX,
    `${plateCount(A)} plates against ${PLATE_COLS} columns of charge and ${PLATE_COLS} of strain — ` +
    'plates.js reads PLATE_MAX off net.js, so the two cannot be changed apart');
  // A hostile shows exactly one dial on `abl`, and this one shows none: its ring rides
  // its own stream. dialsOn reads the DEFINITION, which is what stops a second
  // mechanic's dial silently never reaching the client.
  check('and it does not also try to ride the one free dial',
    dialsOn(A).length === 0 && WILD.every(k => dialsOn(ALIENS[k]).length <= 1),
    'eight charges do not fit in one 0..100 integer, so the ring has a stream and `abl` stays 0 — ' +
    'the alternative was five dials deep behind a chain of ?? and a mechanic running invisibly');
}

// --- which plate, and where the answer goes -------------------------------------
console.log('\nthe geometry, which the server and the client share');
{
  const N = plateCount(A);
  // Every bearing lands on exactly one plate, and the wedges tile the circle with no
  // gap and no overlap. Brute-forced rather than reasoned, because an off-by-one in a
  // modulus is invisible until a bolt from due west charges the eastern plate.
  let bad = 0, seen = new Set();
  for (let d = 0; d < 3600; d++) {
    const ang = (d / 3600) * Math.PI * 2 - Math.PI;
    const i = plateAt(A, ang);
    if (!(i >= 0 && i < N)) bad++;
    seen.add(i);
    // and the wedge it names actually contains the bearing
    const { from, to } = arcOf(A, i);
    let rel = ang - (from + to) / 2;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    if (Math.abs(rel) > plateArc(A) / 2 + 1e-9) bad++;
  }
  check('every bearing round the circle lands on exactly one plate, and inside its own wedge',
    bad === 0 && seen.size === N,
    `3,600 bearings, ${N} plates, no bearing outside the wedge that claimed it — arcOf() is the ` +
    'same function the client draws with, which is what stops the glow and the hit test being ' +
    'different wedges');
  check('and a bearing that is not a number draws a plate rather than taking the frame down',
    plateAt(A, NaN) === 0 && plateAt(A, undefined) === 0 && plateAt(A, Infinity) === 0,
    'clamped at the source, the way dialOf() is');

  // The soak, read through the same call combat.js makes. `from` is where it came
  // from: the bearing picks the plate, the PLACE is what the answer goes back down.
  const a = newAlien('antiphon', 1, MAPS.x0, 7, { x: 6000, y: 4000 });
  storeBearing(a, plateFill(A), { a: 0, x: 6800, y: 4000 });
  check('damage into a bearing hardens the plate on that bearing, and only that one',
    Math.abs(a.plates[0] - 1) < 1e-9 && a.plates.slice(1).every(c => c === 0),
    `${n(plateFill(A))} points due east put the eastern plate at full and left the other seven cold`);
  check('and the core is only vulnerable where the plates are soft',
    Math.abs(softAt(a, 0) - 0.5) < 1e-9 && softAt(a, Math.PI) === 1,
    `a full plate turns ${(100 * (1 - softAt(a, 0))).toFixed(0)}% of what hits it and a cold one turns ` +
    'nothing — so walking round to a cold bearing is worth damage as well as safety');
  // The answer, and where it goes. This is the mechanic in one assertion: it leaves
  // along the bearing the plate was struck from, and it does NOT lead.
  const at = (x, y) => ({ id: 1, ship: { x, y, hp: 1, r: 17, vx: 0, vy: 0 } });
  const standing = answer(a, 1, [at(6800, 4000)], BOLT_SPEED);
  check('the answer leaves along the bearing the plate was struck from',
    !!standing && Math.abs(standing.ay - 4000) < 1e-6 && standing.ax > 6000,
    `aimed at ${n(standing.ax)},${n(standing.ay)} from ${n(6000)},${n(4000)} — due east, which is ` +
    'where the bolt came from. Nothing about where the pilot is going enters it');
  check('and the plate goes dark as the bolt leaves',
    a.plates[0] === 0,
    'which is the tell: the wedge you heated stops glowing at the moment the answer is on its way');
  // THE BUG THIS FILE EXISTS TO KEEP CAUGHT. A plate stores the PLACE it was struck
  // from, not the bearing, because the hostile moves between being hit and answering:
  // a bearing taken from where it was standing a second ago slides off a pilot who
  // never moved. Measured on the bench with the pilot holding perfectly still, 47% of
  // answers landed — a stationary pilot was dodging half of them by standing there,
  // and it made circling read as WORSE than holding.
  const drifted = newAlien('antiphon', 3, MAPS.x0, 7, { x: 6000, y: 4000 });
  storeBearing(drifted, plateFill(A), { a: 0, x: 6800, y: 4000 });
  drifted.y += 80;                                     // one second of its own 80 px/s, sideways
  const still = answer(drifted, 1, [at(6800, 4000)], BOLT_SPEED);
  check('and the hostile moving does not take the answer off a pilot who has not',
    !!still && Math.abs(still.ay - 4000) < 2 && Math.abs(still.ax - 6800) < 40,
    `the ring drifted 80px sideways and still aimed at ${n(still.ax)},${n(still.ay)} — the place it ` +
    'was struck from. Storing the bearing instead aimed 80px past a pilot who had not moved, which ' +
    'is the mechanic exactly backwards');
  // And it aims at the RANGE the victim is at now, so only the angle is stale. That is
  // the verb spelled out: closing in or backing off along the same line is not a dodge.
  const b = newAlien('antiphon', 2, MAPS.x0, 7, { x: 6000, y: 4000 });
  storeBearing(b, plateFill(A), { a: 0, x: 6800, y: 4000 });
  const closed = answer(b, 1, [at(6400, 4000)], BOLT_SPEED);
  check('it tracks the range but not the angle, so backing off along the line is not a dodge',
    !!closed && Math.abs(Math.hypot(closed.ax - 6000, closed.ay - 4000) - 400) < 1e-6,
    `a pilot who closed from 800px to 400px is aimed at 400 — the ONLY thing that is stale is the ` +
    'bearing, which is exactly what "do not stand still relative to what you are shooting" means');
}

// --- a real fight ----------------------------------------------------------------
//
// stepAlienAI, stepRing, answer, step, stepVitals, fire and stepBolts, in the order
// server.js calls them. What it measures is DAMAGE TAKEN PER PILOT PER SECOND at a
// steady state, which is the quantity both design properties are about — and it
// measures it with the pilots held alive rather than by watching them die, for one
// reason: a pilot who dies at 5 seconds stops producing measurement, so a harness
// that lets them die reports the party curve of whoever survived longest. Time-to-die
// is then this number divided into the ship, which is arithmetic and honest.
//
// The hostile is real and is NOT held alive: at 6,500,000 effective hit points four
// deep-shelf guns take 79 seconds, so nothing here is measuring a corpse.
const MAP = MAPS.x0;
// Not (6000, 4000): that is dead centre and Nullpoint has no portal there, but the
// three it does have are havens and a sower's-worth of caution is cheap. This is
// clear of all three.
const AT = { x: 4200, y: 5200 };

const PLANS = {
  // Stands at its own gun range and holds it. The right answer to almost everything
  // in this game and the wrong answer to this: your bearing never changes, so the
  // plate in front of you never cools and the answer arrives exactly where you are.
  hold: (t, me, f, want) => {
    const d = Math.hypot(f.x - me.x, f.y - me.y);
    if (d < want - 60) { me.tx = me.x + (me.x - f.x) / d * 400; me.ty = me.y + (me.y - f.y) / d * 400; }
    else if (d > want + 60) { me.tx = f.x; me.ty = f.y; }
    else { me.tx = me.ty = null; }
  },
  // Holds an ASSIGNED bearing rather than merely a range: it follows the hostile
  // around to stay on the same side of it. That is what a party actually does — one
  // pilot to a plate — and it is the only way to measure the division cleanly, because
  // `hold` collapses at three pilots and up: the hostile flies at whoever it is
  // shooting, and two pilots on the far side of it end up on ONE bearing without
  // either of them moving. Measured, that alone put three pilots at 2,218 points a
  // second against two at 1,688 — worse for bringing a friend, and not because
  // anything about the ring had changed.
  //
  // It is also still "standing still relative to what you are shooting", which is the
  // point: it moves a lot and never changes bearing, so it eats every answer aimed at
  // it. That is what makes the curve below a measurement of the SHARING and of nothing
  // else.
  station: (t, me, f, want, bear) => {
    me.tx = f.x + Math.cos(bear) * want; me.ty = f.y + Math.sin(bear) * want;
  },
  // Holds the same range and CIRCLES. This is the counter and the whole claim: it
  // changes nothing about how much fire the pilot delivers, only the bearing they
  // deliver it from.
  orbit: (t, me, f, want) => {
    const dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1;
    const a0 = Math.atan2(dy, dx) + 0.55;
    const r = d + Math.max(-140, Math.min(140, want - d));
    me.tx = f.x + Math.cos(a0) * r; me.ty = f.y + Math.sin(a0) * r;
  },
  // In and out along the SAME bearing, which is the plausible mistake: it is moving,
  // it feels like dodging, and it is not — the answer tracks the range and not the
  // angle, so this is standing still by the only measure that counts.
  weave: (t, me, f, want) => {
    const dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1;
    const r = want * (0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 1.4)));
    me.tx = f.x + dx / d * r; me.ty = f.y + dy / d * r;
  },
};

function expose({ crew = 1, plan = 'orbit', secs = 90, warm = 12, research = 0,
                  stage = 'deep', reachMul = 0.92, seed = 7 } = {}) {
  const foe = newAlien('antiphon', 5000, MAP, seed, { x: AT.x, y: AT.y });
  foe.x = foe.post.x; foe.y = foe.post.y;
  const want0 = pilot(stage, research).stats.weaponRange * reachMul;
  const team = Array.from({ length: crew }, (_, i) => {
    const s = pilot(stage, research);
    const a0 = (i / crew) * Math.PI * 2;
    s.x = AT.x + Math.cos(a0) * want0; s.y = AT.y + Math.sin(a0) * want0;
    return { id: i + 1, ship: s, bear: a0, took: 0, dealt: 0, fired: 0, hp0: s.hp, sh0: s.shield,
             ehp0: s.stats.hull + s.stats.shield };
  });
  let bolts = [], t = 0, answers = 0, thrown = 0, hits = 0, heat = 0, samples = 0;
  let dealtAll = 0, firstBreak = null, into = 0;          // when the ring first gave, and what it cost to get there
  while (t < secs && foe.hp > 0) {
    const here = team.map(c => ({ id: c.id, ship: c.ship, haven: inHaven(MAP, c.ship), loud: 1 }));
    // the hostile, exactly as server.js orders it
    const tgt = stepAlienAI(foe, MAP, here, dt);
    const victim = tgt ? here.find(c => c.id === tgt) : null;
    step(foe, dt); stepVitals(foe, dt, false); stepAlienRepair(foe, dt);
    faceTarget(foe, victim?.ship ?? null);
    for (const b of fire(foe, victim?.ship ?? null, dt)) bolts.push(b);
    stepRing(foe, dt);
    const reply = answer(foe, dt, here.filter(c => mayHarm(foe, c)), BOLT_SPEED);
    if (reply) { bolts.push(reply); if (t >= warm) { answers++; thrown++; } }
    if (t >= warm) { heat += Math.max(0, ...foe.plates); samples++; }
    // the pilots
    for (const c of team) {
      const me = c.ship;
      PLANS[plan](t, me, foe, want0, c.bear);
      step(me, dt); stepVitals(me, dt, false);
      faceTarget(me, foe);
      for (const b of fire(me, foe, dt)) { b.owner = c.id; bolts.push(b); if (t >= warm) c.fired += b.dmg; }
      foe.provoked.add(c.id); if (foe.target === null) foe.target = c.id;
    }
    for (const h of stepBolts(bolts, dt)) {
      const landed = h.split.shield + h.split.hull;
      if (h.target === foe) {
        // exactly what server.js does with a hit on a hostile: the RAW amount and the
        // bearing it came from, routed on the definition
        storeHit(foe, h.raw ?? landed, h.from);
        dealtAll += landed;
        const who = team.find(c => c.id === h.bolt.owner);
        if (who && t >= warm) who.dealt += landed;
      } else {
        const who = team.find(c => c.ship === h.target);
        if (who && t >= warm) { who.took += landed; if (h.bolt.plate !== undefined) hits++; }
      }
    }
    if (firstBreak === null && brokenCount(foe) > 0) { firstBreak = t; into = dealtAll; }
    // Held alive, and the shield put back with them: a measurement of pressure has to
    // outlast the pilot or it is a measurement of how long the first one lived.
    for (const c of team) { c.ship.hp = c.hp0; c.ship.shield = c.sh0; }
    t += dt;
  }
  const span = Math.max(1e-9, Math.min(t, secs) - warm);
  const took = team.reduce((v, c) => v + c.took, 0) / team.length / span;
  // What share of the answers actually found somebody. This is the dodge, as a number:
  // a pilot who never changes bearing eats all of them and one who circles eats none.
  // Clamped, because an answer thrown just before the warm-up ended can land just
  // after it — one bolt of slop on a ninety-second window, and a share over 1.0 in a
  // printed table reads as a bug rather than as rounding.
  return { t, crew: crew, took, answers: answers / span, landed: thrown ? Math.min(1, hits / thrown) : 0,
           broke: brokenCount(foe), firstBreak, into, dealt: dealtAll,
           strain: Math.max(0, ...(foe.strain ?? [0])),
           dps: dealtAll / Math.max(1e-9, t) / crew,
           left: Math.max(0, foe.hp + foe.shield) / (foe.stats.hull + foe.stats.shield),
           heat: samples ? heat / samples : 0,
           through: team.reduce((v, c) => v + c.dealt, 0) / Math.max(1e-9, team.reduce((v, c) => v + c.fired, 0)),
           ehp0: team[0].ehp0 };
}

// --- THE DECISION: circle and stay safe, or commit and break through --------------
//
// This block used to be called "does circling beat standing still", and it asserted
// that it did — 3,376 points a second holding a bearing against 684 circling. That was
// true, it was the approved design, and flown it turned out to be the whole fight:
// with nothing to aim AT, the only correct play was to circle forever, and the ring
// was a damage tax rather than a decision. The designer's words were "all of them are
// hard from every side — we deal too much damage from every side, so they should
// break", and shared/aliens.js had already conceded the arithmetic in advance.
//
// So the claim is REWRITTEN rather than deleted, and it is a harder claim than it was:
// circling still has to be the safe play, committing has to be the fast one, and
// NEITHER may dominate. A hostile with one correct answer is an instruction; a hostile
// with two is a fight.
//
// WHAT THE PILOT IS BUYING EITHER WAY. Circling: the answer goes to the place your
// last bolt left from, so the miss is your own tangential speed times the round trip,
// which at the 630px this thing stands at is 1.4 seconds and about 108px against an
// answer 71px wide plus a hull. Committing: you hold the bearing, eat every answer,
// and the wedge in front of you takes strain equal to the damage it TURNS — one
// plateful of that and it is gone, and a hole lets through double what a plate lets
// through at all.
//
// AND THE INSTRUMENT'S OWN OPTIMISM, stated rather than buried: `orbit` flies a
// PERFECT circle at full throttle for the whole fight, which no person does. It is the
// ceiling of that counter, not the average of it — a pilot at 60% of that tangential
// speed is inside the answer again, and every survival number here is a floor.
console.log('\nthe two ways to fly it, at the deep shelf');
const still = {};
{
  for (const plan of ['hold', 'weave', 'orbit'])
    for (const [label, reachMul] of [['reach', 0.92], ['close', 0.32]]) {
      const r = expose({ plan, reachMul, crew: 1, secs: 120 });
      still[`${plan}/${label}`] = r;
      console.log(`     ${plan.padEnd(6)} at ${label.padEnd(6)} ${n(r.took).padStart(7)} points a second   ` +
        `${(100 * r.landed).toFixed(0).padStart(3)}% of answers land   ${r.broke} broken   ` +
        `${(100 * r.through).toFixed(0)}% of fire through the armour   ` +
        `dead in ${(r.ehp0 / r.took).toFixed(1)}s`);
    }
  const hold = still['hold/reach'], orbit = still['orbit/reach'];
  // HALF THE OLD CLAIM SURVIVES INTACT: circling is still the safe way to fly it, and
  // the answer still cannot find a pilot who keeps turning. That was the property the
  // deeps destroyed and it is the one that must not be given back.
  check('circling is still the safe way to fly it, and the answer still cannot find you',
    orbit.took < hold.took * 0.6 && orbit.landed < 0.1 && hold.landed > 0.9,
    `${n(orbit.took)} points a second circling against ${n(hold.took)} committed — ` +
    `${(100 * orbit.landed).toFixed(0)}% of answers find a pilot who keeps turning and ` +
    `${(100 * hold.landed).toFixed(0)}% find one who does not. test/ground.mjs asserts the OPPOSITE ` +
    'about a Crucible — "moving is now worse than standing still, which is the mechanic inverted" — ' +
    'because a pool lands at your FEET. An answer lands on your BEARING, and that is the difference');
  // AND THE OTHER HALF IS NEW, and it is the reason the change exists: circling is safe
  // and it opens NOTHING. A pilot who never commits is never answered and never gets
  // through the armour either, which is what turns a rate into a decision.
  check('but circling opens nothing, which is what makes it a decision instead of an instruction',
    orbit.broke === 0 && hold.broke > 0 && hold.through > 1.2 && orbit.through < 1,
    `committing broke ${hold.broke} wedge${hold.broke === 1 ? '' : 's'} and put ` +
    `${(100 * hold.through).toFixed(0)}% of its fire into the core; circling broke ${orbit.broke} and ` +
    `put ${(100 * orbit.through).toFixed(0)}%. A hole is worth x${holeOf(A)} and a hard plate x` +
    `${(1 - deflectOf(A)).toFixed(1)}, so the span between the worst place to stand and the best is ` +
    `x${(holeOf(A) / (1 - deflectOf(A))).toFixed(0)} — and strain is the damage a plate TURNS, so a ` +
    'wedge you never heated can never be broken');
  // The plausible mistake, and it still has to lose: in-and-out is movement and it is
  // not a change of bearing, and the answer tracks the range on purpose.
  check('and moving in and out along the same line is still not moving at all',
    still['weave/reach'].landed > 0.6,
    `${(100 * still['weave/reach'].landed).toFixed(0)}% of answers still land on a pilot weaving in ` +
    `and out, against ${(100 * orbit.landed).toFixed(0)}% circling. The answer tracks the RANGE and ` +
    'not the angle on purpose, so this is standing still by the only measure the ring keeps — the ' +
    'difference between "keep moving" and "do not stand still relative to what you are shooting". ' +
    'It does break wedges, which is right: it is a commitment, just a badly flown one');
  check('the dodge is bought with range, and closing in spends it',
    still['orbit/close'].landed > 0.8 && still['orbit/close'].took > orbit.took * 3,
    `circling at 262px still eats ${(100 * still['orbit/close'].landed).toFixed(0)}% of the answers — ` +
    `${n(still['orbit/close'].took)} a second against ${n(orbit.took)} out at 630. The round trip is ` +
    '0.5s in close and 1.4s at reach, so the same speed buys a third of the miss. Brawling is where ' +
    'this bites, and a pilot pinned in cannot turn their way out of it');
}

// --- and which one actually wins ---------------------------------------------------
//
// The block above says the two ways FEEL different. This one runs both to the kill,
// because "circling is safer" and "committing is faster" are only a decision if
// neither of them is also the other. If one policy clears sooner AND cheaper there is
// no decision, there is a right answer with a wrong answer beside it.
console.log('\nboth of them, run to the kill');
{
  const race = {};
  for (const plan of ['orbit', 'hold']) {
    const r = expose({ plan, crew: 1, secs: 600, warm: 8 });
    race[plan] = r;
    console.log(`     ${plan.padEnd(6)} cleared in ${r.t.toFixed(0).padStart(4)}s   ` +
      `${n(r.took * (r.t - 8)).padStart(9)} points taken   ${r.broke} wedges broken   ` +
      `${(100 * r.through).toFixed(0)}% of fire through the armour`);
  }
  const cost = p => race[p].took * (race[p].t - 8);
  check('committing is faster and circling is cheaper, and neither is both',
    race.hold.t < race.orbit.t * 0.85 && cost('hold') > cost('orbit'),
    `${race.hold.t.toFixed(0)}s and ${n(cost('hold'))} points committed against ` +
    `${race.orbit.t.toFixed(0)}s and ${n(cost('orbit'))} circling — ` +
    `${(100 * (1 - race.hold.t / race.orbit.t)).toFixed(0)}% off the clock for ` +
    `${(100 * cost('hold') / cost('orbit') - 100).toFixed(0)}% more hull. THAT is the fight this ` +
    'change was asked for: it used to be one number, 684 against 3,376, with circling strictly ' +
    'better and nothing at all to aim at');
  // And the honest floor. Both columns have to fit inside a ship somebody can actually
  // be flying five hops out, or neither is a policy — it is two ways of dying.
  //
  // The bench pilot above carries NO research, which is 15,462 effective hit points
  // and is not the pilot this is posted for: nothing in the deeps is survivable at x1
  // and balance.js does not pretend otherwise. The hull to hold this against is the
  // researched one, and it is read off the same builder rather than typed.
  const rich = pilot('deep', X32);
  const ehp = rich.stats.hull + rich.stats.shield;
  check('and a fully researched deep-shelf pilot survives either one, solo',
    cost('hold') < ehp && cost('orbit') < ehp && cost('hold') > ehp * 0.4,
    `${n(cost('hold'))} committed and ${n(cost('orbit'))} circling against ${n(ehp)} of researched ` +
    `ship — ${(100 * cost('hold') / ehp).toFixed(0)}% and ${(100 * cost('orbit') / ehp).toFixed(0)}% ` +
    'of it, before a shield mends anything or a repair drone runs. That is the bracket `crack` was ' +
    'set inside: at three platefuls the committed column is 514,639 and does not fit, so committing ' +
    'would stop being available at all. Read as a floor and not a verdict — `orbit` flies a perfect ' +
    'circle at full throttle for five minutes and `hold` never once breaks off, and a person does ' +
    'neither');
}

// --- what a wedge costs, and what it is worth --------------------------------------
//
// The change asked for one number to be derived: what breaking a plate costs to
// achieve. It is not a number in the definition — `crack` is one plateful of damage
// TURNED — so what it costs in damage DEALT depends entirely on how hard the wedge is
// being held, which is the whole point. This block reads it off the real loop.
console.log('\nwhat it costs to break one');
{
  const solo = still['hold/reach'];
  console.log(`     one pilot, committed   first wedge at ${solo.firstBreak?.toFixed(0) ?? '-'}s, ` +
    `${n(solo.into)} points into it, ${n(solo.took * (solo.firstBreak ?? 0))} points taken getting there`);
  check('a wedge is broken by the damage it TURNS, so a cold one can never be broken',
    solo.broke > 0 && solo.firstBreak > 8,
    `${n(crackOf(A))} points turned — ${A.plates.crack} platefuls of the same plateful soak itself ` +
    `defines, and the count is measured rather than chosen: see the sweep in aliens.js. At full ` +
    `hardness that is ${n(crackOf(A) / deflectOf(A))} points into the bearing; at the ${(100 * solo.heat).toFixed(0)}% a ` +
    'lone deep-shelf gun actually holds a wedge at, it is several times that. Nothing new is ' +
    'measured to get it: the strain IS what softAt() already turns away');
  // PERMANENT for the life of the fight, and that is a decision rather than an
  // omission. A wedge paid for in answers and then handed back is a fight with no
  // progress in it.
  const a2 = newAlien('antiphon', 11, MAPS.x0, 3, { x: 6000, y: 4000 });
  a2.plates[0] = 1; a2.strain[0] = 1;
  for (let k = 0; k < 60 * 30; k++) stepRing(a2, dt);          // a minute of nothing at all
  check('and a broken wedge stays broken for the whole fight',
    broke(a2, 0) && a2.plates[0] === 0,
    'a minute of bleeding does not mend it, and it is held at zero charge so `hottest` can never ' +
    'offer it again. It comes back with the rest of the ring on the five-minute respawn, out of ' +
    'newRing() — a wedge you paid for and then lost again is a fight with no progress in it');
  // A hole is not merely un-armoured, it is open, and the two ends of the span are one
  // dial read both ways.
  const a3 = newAlien('antiphon', 12, MAPS.x0, 3, { x: 6000, y: 4000 });
  a3.plates[0] = 1;
  const hard = softAt(a3, 0);
  a3.strain[0] = 1;
  check('and what you get for it is the exact opposite of what the plate was doing',
    Math.abs(hard - (1 - deflectOf(A))) < 1e-9 && Math.abs(softAt(a3, 0) - holeOf(A)) < 1e-9 &&
    Math.abs(holeOf(A) * hard - 1) < 1e-9,
    `x${hard.toFixed(1)} through a plate at full against x${holeOf(A).toFixed(1)} through the hole it ` +
    'leaves — one dial, `deflect`, read from both ends, so the two can never be argued apart and ' +
    'moving one moves the other');
  // And what all eight means. The ring has one voice; take every mouth off it and it
  // has nothing left to say.
  const a4 = newAlien('antiphon', 13, MAPS.x0, 3, { x: 6000, y: 4000 });
  for (let i = 0; i < plateCount(A); i++) { a4.strain[i] = 1; a4.plates[i] = 0; }
  const silent = answer(a4, 10, [{ id: 1, ship: { x: 6800, y: 4000, hp: 1, r: 17 } }], BOLT_SPEED);
  check('all eight broken is the end of the fight rather than a stage of it',
    silent === null && hottest(a4) === -1 && brokenCount(a4) === plateCount(A) &&
    softAt(a4, 0) === holeOf(A),
    'nothing left to charge, nothing left to answer with, and every bearing open at ' +
    `x${holeOf(A)}. What is left is its 711 barrel against a bare core taking double, so stripping ` +
    `the ring is the kill in all but name. Getting there costs ${n(plateCount(A) * crackOf(A))} points ` +
    `TURNED — ${(100 * plateCount(A) * crackOf(A) / effectiveHp('antiphon')).toFixed(0)}% of its own hit ` +
    'points if it were turning everything, and several times that in damage dealt at the hardness a ' +
    'real gun holds a wedge at. It is a party\'s job, not one pilot\'s');
}

// --- property one: does party size STILL divide the answer? ------------------------
//
// The headline, and the reason the hostile exists at all. balance.js's POSTING says
// the deep pair is not completable at ANY party size because ground does not divide:
// "a gun shoots one pilot at a time, so four pilots each take a quarter of the
// barrels; a pool burns everybody standing in it, so four pilots each take all of it."
//
// It measured 1.00 / 0.50 / 0.33 / 0.17 before plates could break, and the whole point
// of re-measuring is that breaking could have destroyed it: a party opens holes, holes
// stop answering, and a curve that only falls because the ring has been dismantled is
// not the same claim. It is measured with everybody holding an ASSIGNED bearing, which
// is the pitch's own scenario — "four pilots on four bearings" — and it is now also the
// scenario where four wedges are being broken at once, which is the natural play.
console.log('\nthe party curve, four pilots on four bearings');
{
  const at = [1, 2, 3, 4].map(crew => [crew, expose({ crew, plan: 'station', secs: 120 })]);
  const solo = at[0][1];
  for (const [crew, r] of at)
    console.log(`     ${crew} pilot${crew > 1 ? 's ' : '  '} ${n(r.took).padStart(7)} points a second each   ` +
      `x${(r.took / solo.took).toFixed(2)} of solo   ${r.broke} wedges broken   ` +
      `${(100 * r.heat).toFixed(0)}% hottest plate   time to die x${(solo.took / r.took).toFixed(2)}`);
  const took = k => at.find(([c]) => c === k)[1].took;
  const brk = k => at.find(([c]) => c === k)[1].broke;
  check('every pilot you bring still makes the fight lighter for all of them',
    took(2) < took(1) && took(3) < took(2) && took(4) < took(3),
    [1, 2, 3, 4].map(c => `${c}p ${n(took(c))}/s`).join('  ') +
    ' — a ring answers ONE bearing a cycle, so the answers are shared out, and the plate a pilot is ' +
    'not standing on cools while it waits its turn');
  check('and time-to-die still RISES with party size, which the deeps do not manage',
    took(4) < took(1) * 0.6,
    `each of four takes ${(100 * took(4) / took(1)).toFixed(0)}% of what one takes, so a pilot lives ` +
    `x${(took(1) / took(4)).toFixed(2)} longer for bringing three friends while the fight gets 4x ` +
    'shorter. It was 1.00 / 0.50 / 0.33 / 0.17 before wedges could break and it is ' +
    [1, 2, 3, 4].map(c => (took(c) / took(1)).toFixed(2)).join(' / ') + ' now, so breaking did not ' +
    'cost the property this hostile exists for — which it easily could have, since a party opens ' +
    'holes and a hole stops answering');
  // AND THE NEW HALF: a party does not merely survive better, it opens the ring
  // faster, and that needed no arranging. Strain goes with CHARGE and charge goes up
  // with party size, because a wedge waits longer for its turn to be answered.
  check('and a party breaks the ring faster than one pilot can, without being given anything',
    brk(4) > brk(1),
    `${[1, 2, 3, 4].map(c => `${c}p broke ${brk(c)}`).join(', ')} in the same two minutes. Nothing ` +
    'here is a party bonus: strain is the damage a wedge TURNS, a wedge turns `deflect x charge`, ' +
    'and charge climbs with party size because a plate waits longer for its turn. Four pilots run ' +
    'their wedges about twice as hot as one does, so four bearings come apart while one is still ' +
    'working on its first');
  const clear = c => effectiveHp('antiphon') / (c * stageDps('deep'));
  check('so what a whole fight costs each pilot falls faster than one over party size',
    took(4) * clear(4) < took(1) * clear(1) / 6,
    [1, 2, 3, 4].map(c => `${c}p ${n(took(c) * clear(c))} points over ${clear(c).toFixed(0)}s`).join(', ') +
    ` — ${(100 * took(4) * clear(4) / (took(1) * clear(1))).toFixed(0)}% of what a solo pilot pays, ` +
    'because the per-second falls and the fight shortens at the same time');
}

// --- the plate count, against how fast anybody can actually turn -----------------
//
// Eight is the pitch's number and it is checked here rather than taken on trust,
// because two different things depend on it and they pull opposite ways.
console.log('\nwhy eight plates');
{
  const N = plateCount(A);
  const dwell = (r, v) => 2 * Math.PI * r / (N * v);          // seconds to cross one wedge
  const roundTrip = r => 2 * r / BOLT_SPEED;                   // your bolt out, the answer back
  const rows = [];
  for (const [what, v] of [['deep shelf, reactor on the gun', 74.4],
                           ['deep shelf, reactor on thrusters', 127],
                           ['finished Bulwark', 128],
                           ['Kestrel', 430]])
    for (const [where, r] of [['in close', 260], ['at reach', 630], ['Collimated', 1640]]) {
      const miss = v * roundTrip(r), wide = spreadOf(A) + 17;
      rows.push({ what, where, r, v, dwell: dwell(r, v), miss, hit: miss < wide });
      console.log(`     ${what.padEnd(32)} ${where.padEnd(11)} one wedge in ${dwell(r, v).toFixed(1).padStart(5)}s   ` +
        `miss ${miss.toFixed(0).padStart(4)}px against ${wide.toFixed(0)}   ${miss < wide ? 'ANSWERED' : 'past you'}`);
    }
  // The cooling half, and it is the WEAK half — said out loud rather than claimed,
  // because the pitch reads as though walking the ring keeps it cold and at real
  // speeds nothing does.
  // Measured over the builds this is POSTED for, which is the deep shelf and the top
  // of the climb. A Kestrel is in the table above and it is not in this claim, and the
  // reason is the finding rather than an exemption — see the next line.
  const heavy = rows.filter(x => !x.what.startsWith('Kestrel'));
  const worst = Math.min(...heavy.map(x => x.dwell));
  check('walking the ring cannot cool it, at any speed the pilots it is posted for can fly',
    worst > plateHalf(A),
    `the fastest a Bulwark crosses one wedge is ${worst.toFixed(1)}s and a plate halves in ` +
    `${plateHalf(A)}s, so the plate it is standing on is already at 90% of its resting level before ` +
    'it leaves. Sixteen plates would halve the dwell and still not fix it. So the count is NOT ' +
    'chosen for the cooling — nothing a heavy hull can fly is — and the pitch\'s "walk your damage ' +
    'around the ring" is true for the DODGE and not for the heat');
  // And the reason the Kestrel is not in that claim, which is the nicest thing the
  // table says: the one ship that CAN walk the ring cold is the one whose gun cannot
  // heat it in the first place.
  const quick = rows.find(x => x.what.startsWith('Kestrel') && x.where === 'in close');
  check('and the only hull that can walk it cold is one that cannot heat it anyway',
    quick.dwell < plateHalf(A) && stageDps('interceptor') * plateHalf(A) < plateFill(A) * 0.02,
    `a Kestrel crosses a wedge in ${quick.dwell.toFixed(1)}s, inside the ${plateHalf(A)}s half-life — ` +
    `and it throws ${n(stageDps('interceptor'))} dps, which holds a plate at ` +
    `${(100 * stageDps('interceptor') * plateHalf(A) / (plateFill(A) * Math.LN2)).toFixed(1)}% and is ` +
    `${n(effectiveHp('antiphon') / stageDps('interceptor') / 3600)} hours of shooting away from ` +
    'killing it. The ring is a share of ITS hit points, so a small gun is answered small — the ' +
    'same spread the Thresher has, where a Kestrel gets a 476 back and a finished Bulwark a 9,706');
  // The dodge half, which is what eight is actually for: one wedge per pilot at the
  // party size it is posted for, and an answer one plate-face wide.
  check('but the answer is one plate wide, so the count is what the dodge is measured in',
    Math.abs(spreadOf(A) - 2 * Math.PI * A.r / N) < 1e-9 && N >= POSTING.antiphon.party,
    `${spreadOf(A).toFixed(0)}px of answer — one face of the ring, 2 x pi x ${A.r} over ${N}. So the ` +
    'plate count sets how demanding the dodge is as well as how finely you can spread your fire, ' +
    `and that is the second reason it is a measurement. Eight wedges is two per pilot at the party ` +
    `of ${POSTING.antiphon.party} it is posted for, and it is the widest the wire carries`);
  // And the trade the table above is really about: reach buys the dodge and closing
  // in spends it, and it is the same expression both times.
  check('and reach buys the dodge while closing in spends it',
    rows.some(x => x.where === 'in close' && x.hit) && rows.some(x => x.where === 'at reach' && !x.hit),
    'the miss is your tangential speed times the round trip, and the round trip is twice the range ' +
    'over bolt speed — so at 260px every build in the game is answered and at 630 most are not. A ' +
    'pilot pinned in close cannot turn their way out, which is why the hostile closes');
}

// --- what it throws, as the balance model sees it --------------------------------
console.log('\nwhat the model makes of it');
{
  const ehp = stageEhp('deep');
  const bare = A.attrs.damage * A.attrs.fireRate;
  check('the barrel is on model to the decimal, and the ring is what sits above it',
    Math.abs(bare - ANCHORS.pressure * ehp) / bare < 0.001,
    `${n(bare)} dps against ANCHORS.pressure x stageEhp('deep') = ${n(ANCHORS.pressure * ehp)} — the ` +
    'model\'s own answer to "what must a hostile at that stage throw", which is exactly what the ' +
    'deeps\' guns are at theirs. Without one, a pilot who never pulled the trigger could not be ' +
    'touched: a lovely sentence and a hostile the model would file as harmless');
  // threatDps has to count the discharge or every derived number understates it. The
  // Thresher's chamber is already a term for the same reason and by the same shape.
  const with_ = threatDps('antiphon', ehp, ehp);
  check('and threatDps counts the ring, or the bestiary report calls the hardest thing harmless',
    Math.abs(with_ - (bare + A.plates.dps)) < 1e-6 && with_ > bare * 16,
    `${n(with_)} against a barrel of ${n(bare)} — x${(with_ / bare).toFixed(1)}. It is the WORST the ` +
    'ring can be, a full plate every cycle, deliberately rather than the typical: report(), ' +
    'pressureOf() and bestiaryReport() ask "how bad can this get". A Thresher is off model on this ' +
    'axis by design for the same reason, and this is the second');
  // The pay, which is not typed anywhere: it falls out of the rung.
  check('what it pays falls out of the rung and nothing else',
    A.bounty === bountyFor('antiphon') && A.xp === xpFor('antiphon') &&
    Math.abs(A.bounty - effectiveHp('antiphon') * BOUNTY_RATE) < 1e-6 &&
    effectiveHp('antiphon') % 10 === 0,
    `${n(A.bounty)} cr and ${n(A.xp)} xp off ${n(CORE_HP)} effective hit points at ${BOUNTY_RATE} and ` +
    `${(XP_RATE).toFixed(4)} — a multiple of ten, so the bounty is whole credits. Change CORE_HP and ` +
    'the hull split, the shield, the pay, the ore rung, the posting and what fills a plate all move');
  // And the ore, which is the one place the ladder has genuinely run out. Said plainly
  // rather than papered over: shared/cargo.js carries the same paragraph.
  const podValue = 47680;                     // one full hold of platinum, as test/cargo.mjs prints it
  check('the ore ladder has run out, and the reward is in the bounty where a party splits it',
    DROPS.antiphon === DROPS.hive || DROPS.antiphon.length === DROPS.hive.length,
    `0.14 cr per point of ${n(CORE_HP)} is ${n(0.14 * CORE_HP)} of platinum — about nineteen Ore ` +
    `Tenders. It drops ONE, the same as a Corsair Hive, worth about ${n(podValue)}: ` +
    `${(100 * podValue / A.bounty).toFixed(1)}% of the bounty against 3.3% for a Crucible and 10.5% ` +
    'for a Hive. Six metals and one hold is the whole ladder, so past the Hive the only axis a ' +
    'reward can still grow on is credits — which is the right one for a hostile posted for four, ' +
    'because credits split and a pod does not');
}

// --- the wire ---------------------------------------------------------------------
console.log('\nthe wire, and the shape that was priced against it');
{
  check('the ring is a keyed stream, and a row is a hostile',
    !!STREAMS.plates && STREAMS.plates.key === PLATE_FIELDS.indexOf('id'),
    `${PLATE_FIELDS.length} columns keyed on id — the row and the ship row are the same thing seen ` +
    'twice, so nothing has to be matched up by position');
  const a2 = newAlien('antiphon', 9, MAPS.x0, 3, { x: 6000, y: 4000 });
  a2.plates = [0, 0.5, 1, 0.03, 0.99, 0, 0, 0];
  const back = unpackPlates(packPlates(a2));
  check('a charge survives the round trip to within one step of the wire',
    a2.plates.every((c, i) => Math.abs(back[`p${i}`] / PLATE_STEPS - c) <= 0.5 / PLATE_STEPS) &&
    back.p2 === PLATE_STEPS && back.p0 === 0,
    `sixteen steps: ${a2.plates.map((c, i) => `${c}->${back[`p${i}`]}`).join(' ')} — and the TOP step ` +
    'is exact, which is the only one a pilot has to read precisely');
  check('and a charge that is not a number packs a nought rather than a hole in the snapshot',
    packPlates({ id: 1, plates: [NaN, undefined, -3, 99, 0.5] }).slice(1).every(v => Number.isInteger(v) && v >= 0 && v <= PLATE_STEPS),
    'clamped and floored at the packer, so a bad charge draws a cold wedge instead of taking the ' +
    'frame down — the same guard SOWN_FIELDS puts on its progress');
  // The measurement the shape was chosen from, re-run rather than quoted: the real
  // codec, two rings, a pilot walking their fire around each.
  const spec = STREAMS.plates, HZ = 30, SECS = 30;
  const price = (steps, whole) => {
    const base = new Map(), rings = [0, 3].map(seed => {
      const c = new Array(8).fill(0);
      let t = 0;
      return () => {
        t += dt;
        const at2 = Math.floor(t / 1.8 + seed) % 8;
        for (let i = 0; i < 8; i++) c[i] = Math.max(0, c[i] * Math.pow(2, -dt / plateHalf(A)));
        c[at2] = Math.min(1, c[at2] + stageDps('deep') * dt / plateFill(A));
        return c;
      };
    });
    let bytes = 0;
    for (let k = 0; k < SECS * HZ; k++) {
      const next = new Map(rings.map((r, i) => {
        const c = r();
        return [1000 + i, [1000 + i, ...c.map(v => Math.max(0, Math.min(steps, Math.round(v * steps))))]];
      }));
      if (whole) { bytes += Buffer.byteLength(JSON.stringify([...next.values()])); continue; }
      const d2 = diffRows(spec, base, next);
      applyRows(spec, base, d2);
      if (d2) bytes += Buffer.byteLength(JSON.stringify(d2));
    }
    return bytes / SECS / 1024;
  };
  const keyed = price(PLATE_STEPS, false), whole = price(PLATE_STEPS, true), fine = price(100, false);
  console.log(`     two rings, a pilot walking their fire around each, 30Hz for ${SECS}s:`);
  console.log(`       sent whole every tick        ${whole.toFixed(3)} KiB/s`);
  console.log(`       keyed, at 0..100             ${fine.toFixed(3)} KiB/s`);
  console.log(`       keyed, at 0..${PLATE_STEPS} (shipped)     ${keyed.toFixed(3)} KiB/s`);
  check('keying it is worth an order of magnitude, and the resolution is worth another five',
    keyed < whole / 5 && keyed < fine / 3,
    `${whole.toFixed(2)} KiB/s whole, ${fine.toFixed(2)} keyed at a hundred steps, ` +
    `${keyed.toFixed(3)} keyed at ${PLATE_STEPS + 1}. Same argument SOWN_FIELDS makes about its two ` +
    'decimal places, and the same measurement: what a stream costs is decided by how often its one ' +
    'moving column changes a value. One step is 6% of a discharge, which is under the resolution ' +
    'of a glow.\n' +
    '       The shape that is CHEAPER still and did not ship: one packed 24-bit integer on the ship ' +
    'row, at 0.036 KiB/s, because a boss\'s row is already moving every tick. It spends the LAST ' +
    'field in SHIP_FIELDS — 30 of a hard 31 — on one hostile in one sector, and puts a column on ' +
    'every Drifter and pod-hauler in the galaxy for it. FIX_FIELDS and SOWN_FIELDS both went this ' +
    'way for the same reason');
}

// --- where it lives ----------------------------------------------------------------
console.log('\nthe posting');
{
  const p = POSTING.antiphon;
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  check('two of them, in Nullpoint, and nothing else in the sector',
    /seed\(x, 'antiphon', 2\)/.test(src) && /MAPS\[id\]\.core/.test(src),
    'nothing in this game is posted alone: a sector holding one of something goes empty the moment ' +
    'somebody kills it, and flying five hops to an empty map is the least interesting thing this ' +
    'game can ask of anybody');
  check('and it is posted for the shelf sold one hop before it, not the one sold past it',
    p.stage === 'deep' && p.party === 4 &&
    Math.abs(p.seconds - effectiveHp('antiphon') / (p.party * stageDps(p.stage))) < 1,
    `${p.seconds}s for ${p.party} pilots at ${n(stageDps('deep'))} dps each. The deep counter is at a ` +
    'deep-sector outpost, which is the LAST hop before Nullpoint, so a pilot standing here has ' +
    'already walked past it. That is the opposite of the Thresher\'s case — MIRROR is pinned to ' +
    '`finished` precisely because the deep shelf is four hops PAST the gate it stands on');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the Antiphon: 8 plates, 65,000 a plate, 11,307 a full answer'}\n`);
process.exit(fails.length ? 1 : 0);
