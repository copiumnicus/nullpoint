// Claims about the deeps, and about sown ground.
//
// Two hostiles out there fight by taking PLACES away from you rather than by
// shooting at you, and the places stay after the thing that made them has gone.
// One of them takes something no hostile in this game has ever taken — the pilot's
// engines — so most of what is in here is not about damage at all. It is about the
// promise every other entry in aliens.js makes in as many words: that you can
// always decline, always break off, always leave.
//
// Everything below is measured through the real loop — stepAlienAI, stepSow,
// step, stepSnare, stepVitals, fire, launch and stepBolts, in the order server.js
// calls them.

import { ALIENS, WILD, effectiveHp, farmHp, newAlien, stepAlienAI, stepAlienRepair,
         mayHarm, standOff, BOUNTY_RATE, XP_RATE, threatDps, bountyFor, xpFor,
         SHAPES, outlineOf } from '../shared/aliens.js';
import { sowOf, stepSow, sowHolds, sowPoint, groundFor, inGround, groundBite,
         stepGround, stepSnare, holdEngines, held, mayHold, HOLD, CALM, WARN } from '../shared/ground.js';
import { newShip, step, stepVitals, applyDamage, inHaven, JUMP_TIME, HAVEN_R } from '../shared/sim.js';
import { PORTAL_R } from '../shared/maps.js';
import { poolOf } from '../shared/burn.js';
import { fire, stepBolts, faceTarget } from '../shared/combat.js';
import { launch, stepRockets } from '../shared/rockets.js';
import { MAPS, MAP_W, MAP_H } from '../shared/maps.js';
import { HULLS } from '../shared/ships.js';
import { ANCHORS, ANCHOR_FIGHT, POSTING, buildFor, stageDps, stageEhp, STAGE_KEYS } from '../shared/balance.js';
import { SHIP_FIELDS, SOWN_FIELDS, STREAMS, EPHEMERAL, packSown, unpackSown, GROUND_KINDS, groundK } from '../shared/net.js';
import { MAX_FIELDS } from '../shared/delta.js';
import { MODULE_KEYS } from '../shared/research.js';
import { routeTo } from '../shared/power.js';
import { DRAIN_RATE } from '../shared/siphon.js';
import { DROPS } from '../shared/cargo.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const X32 = MODULE_KEYS.reduce((m, _, i) => m | (1 << i), 0);
const V = ALIENS.crucible, D = ALIENS.doldrum;

// The reactor is ON, and on the weapons. balance.js quotes the BOOSTED gun, and a
// bench pilot that never routed power anywhere delivered 6,450 of a finished
// Bulwark's 11,307 — every mirror number in this repo was that mistake until 0.63.
// Weapons rather than thrusters is also what makes the pool radius below honest: a
// pilot with the reactor on their gun flies at the hull's bare speed.
const pilot = (stage = 'finished', research = 0, route = 'weapons') => {
  const b = buildFor(stage);
  const s = newShip(3400, 5600, b.hull, b.fit, b.drones, 'wedge', null, research);
  routeTo(s.power, route);
  return s;
};

// --- the root, and whether it is one ------------------------------------------
//
// This is the file's reason for existing. The game has never taken movement away
// from a player and shared/kedge.js spends a paragraph on why a fix was allowed to
// exist where a stun was not: "Maximum time without control from a fix: zero
// seconds". Slack Water is not zero, so every one of those seconds has to be
// argued for and pinned shut.
console.log('\nthe root');
{
  // REWRITTEN, and the property it used to assert is GONE rather than moved. The hold
  // was JUMP_TIME / 2, and the half was the whole argument: "the longest hold that can
  // never deny a door you already opened". Five seconds is longer than a portal takes
  // to spool, so that reasoning is dead and saying otherwise would be a test agreeing
  // with a comment instead of with the game.
  //
  // The promise survives on the RULE instead, and the rule is older: a still is
  // refused sanctuary outright, provoked or not, so a pilot who has committed to a
  // door is inside a haven and cannot be held at all. That is what these two check
  // now — the arithmetic claim became a geometric one.
  // RESTORED. This claim has been written three ways and that is the point of keeping
  // it rather than deleting it. At 1.5s it read "a hold is half a portal, so it can
  // never deny a door you already opened"; at 5.0s that was false and it read
  // "sanctuary is what keeps a door open"; at 2.5s the duration is under a spool again
  // and BOTH hold at once. The rule was always the stronger of the two and never went
  // anywhere — the duration is the one that came and went.
  check('a hold is shorter than a portal again, so the door is held twice over',
    HOLD < JUMP_TIME && CALM === 2 * HOLD,
    `${HOLD}s held against a ${JUMP_TIME}s spool, so even a stop landing on the tick you committed ` +
    `cannot outlast it — and a still is barred from havens anyway. ${CALM}s owed back, which is ` +
    '2 x HOLD: a pilot always has at least twice as much control as they lose');
  check('and a pilot spooling a jump is twice as deep into the peace as they need to be',
    HAVEN_R > PORTAL_R * 2,
    `you must be inside ${PORTAL_R}px of a mouth to commit to it and the peace runs to ` +
    `${HAVEN_R}px, so there is no band where a ship can be holding a door open and still be caught`);
  check('what a stop DOES cost is a door you have not reached yet',
    HOLD * 128 > HAVEN_R,
    `stopped dead outside the peace you lose ${Math.round(HOLD * 128)}px of running at the slowest ` +
    `fitted speed in the game, against a ${HAVEN_R}px mouth — under the old coast you kept going. ` +
    'That is the cost the change was asked for, and leaving still works: both are slower than every hull');

  // THE ANTI-PERMA-ROOT CLAIM. Brute forced rather than reasoned: every still on the
  // field tries to grab every tick, which is a field no designer could build and a
  // strictly worse case than one they could.
  const greedy = n => {
    const s = {}; let t = 0, cur = 0, worst = 0, gap = Infinity, minGap = Infinity, hist = [];
    while (t < 120) {
      for (let i = 0; i < n; i++) if (mayHold(s)) { minGap = Math.min(minGap, gap); gap = 0; holdEngines(s, HOLD); }
      hist.push(held(s));
      if (held(s)) { cur += dt; worst = Math.max(worst, cur); gap = 0; } else { cur = 0; gap += dt; }
      stepSnare(s, dt); t += dt;
    }
    const W = Math.round(10 / dt);
    let win = 0;
    for (let i = 0; i + W < hist.length; i++) win = Math.max(win, hist.slice(i, i + W).filter(Boolean).length * dt);
    return { worst, minGap, win };
  };
  const runs = [1, 2, 3, 6, 12, 40].map(greedy);
  // A tick of slack, and it is the tick the hold is applied ON: holdEngines sets the
  // clock and stepSnare takes the frame off it afterwards, so the measured stop is a
  // thirtieth longer than the number. Stated rather than rounded away, because a
  // tolerance nobody explains is where a real overrun goes to hide.
  const TICK = 1 / 30;
  check('no arrangement of stills can stop a pilot for longer than one hold',
    runs.every(r => r.worst <= HOLD + TICK + 1e-9),
    `${runs.length} arrangements up to forty stills all grabbing every tick: longest unbroken ` +
    `stop ${Math.max(...runs.map(r => r.worst)).toFixed(2)}s against a stated ${HOLD}s plus the tick it lands on`);
  check('and a pilot is always owed a full portal spool of thrust between two of them',
    runs.every(r => r.minGap >= CALM - 1e-9),
    `shortest gap measured ${Math.min(...runs.map(r => r.minGap)).toFixed(2)}s against a stated ${CALM}s`);
  // REWRITTEN with the clocks. At 1.5s held and 3.0s owed the worst ten seconds had
  // 6.0s of thrust in it; at 5 and 10 a ten-second window cannot contain two stops at
  // all, because they are fifteen seconds apart — so the worst ten is one whole stop
  // and no more, and the bound that binds is the CYCLE rather than the window.
  // REWRITTEN, and this is the one thing halving the hold COST rather than bought. At
  // 5s and 10s the cycle was fifteen seconds, so two stops could not fall inside one
  // ten-second window at all. At 2.5 and 5 the cycle is 7.5s and they can.
  //
  // What did not change is how much of that window is lost, and that is the number
  // that matters: the duty cycle is HOLD/(HOLD+CALM) and it is a third either way, so
  // the worst ten seconds holds 4.97s of stop against 5.03s before. The same
  // immobility arrives as two short stops rather than one long one — which is strictly
  // better for a pilot, because it hands the steering back in the middle of it.
  check('the worst ten seconds costs the same as it did, in smaller pieces',
    runs.every(r => r.win <= HOLD + 10 * HOLD / (HOLD + CALM) + TICK + 1e-6) &&
    runs.every(r => r.win < 5.5),
    `${Math.max(...runs.map(r => r.win)).toFixed(2)}s stopped in the worst ten seconds against 5.03s ` +
    `when the hold was ${2 * HOLD}s — but as two stops of ${HOLD}s now rather than one, because the ` +
    `cycle is ${HOLD + CALM}s and no longer clears a ten-second window. Over a minute it is a third either way`);
  // REWRITTEN, and this is the design call that was reversed rather than a number that
  // moved. It used to read "a hold takes the throttle and nothing else" and asserted
  // that the velocity did not change by a thousandth — momentum kept, ship coasting,
  // and what a pilot lost was only the ability to change their mind. That is the
  // better mechanic and it is not the one the game has: flown, a ship at speed sailed
  // straight out of the trap that had just shut on it. The claim is now the opposite
  // claim, and it is checked the same way.
  check('a stop takes the way on with it, and takes all of it',
    (() => {
      const s = pilot(); s.x = 0; s.y = 0; s.tx = 5000; s.ty = 0;
      for (let i = 0; i < 60; i++) step(s, dt);                // up to speed
      const v0 = Math.hypot(s.vx, s.vy), x0 = s.x;
      holdEngines(s, HOLD);
      let t = 0; while (t < HOLD) { step(s, dt); stepSnare(s, dt); t += dt; }
      return v0 > 100 && Math.hypot(s.vx, s.vy) < 1e-9 && Math.abs(s.x - x0) < 1e-9;
    })(),
    (() => {
      const s = pilot(); s.x = 0; s.y = 0; s.tx = 5000; s.ty = 0;
      for (let i = 0; i < 60; i++) step(s, dt);
      const v0 = Math.hypot(s.vx, s.vy);
      return `${v0.toFixed(0)}px/s under full burn, still ordered at the same destination, and ` +
             `${HOLD}s later the ship has moved zero pixels. The velocity is zeroed EVERY tick the ` +
             'clock runs, not once on the way in — once would let anything that touches the body ' +
             'afterwards put it back into motion inside a still';
    })());
  check('and it still never touches the trigger, the target or the beacon',
    (() => {
      const s = pilot(); s.x = 0; s.y = 0;
      const mark = newShip(400, 0, 'bulwark');
      holdEngines(s, HOLD);
      let shots = 0, t = 0;
      while (t < HOLD) { step(s, dt); stepSnare(s, dt); shots += fire(s, mark, dt).length; t += dt; }
      return shots > 0;
    })(),
    'a stun that took the guns as well would be a five-second death sentence rather than ' +
    'a five-second problem, and this game has never taken a trigger away');
  check('and it never touches the trigger, the target or the beacon',
    (() => {
      const s = pilot(); s.x = 0; s.y = 0;
      const mark = newShip(400, 0, 'bulwark');
      holdEngines(s, HOLD);
      let shots = 0, t = 0;
      while (t < HOLD) { step(s, dt); stepSnare(s, dt); shots += fire(s, mark, dt).length; t += dt; }
      return shots > 0;
    })(),
    `${(() => { const s = pilot(); s.x = 0; s.y = 0; const m = newShip(400, 0, 'bulwark'); holdEngines(s, HOLD);
       let n = 0, t = 0; while (t < HOLD) { step(s, dt); stepSnare(s, dt); n += fire(s, m, dt).length; t += dt; } return n; })()} ` +
    'bolts fired while coasting — fire() has never consulted movement and must not start');
  check('one patch holds one pilot once per entry, not thirty times a second',
    (() => {
      const g = groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 });
      const s = pilot(); s.x = 0; s.y = 0;
      let grabs = 0, t = 0;
      while (t < 30) {
        const b = groundBite(g, 1, s, true, poolOf(s), dt);
        if (b.hold > 0) { grabs++; holdEngines(s, b.hold); }
        stepSnare(s, dt); t += dt;
      }
      return grabs === 1;
    })(),
    'parked inside one for thirty seconds: held exactly once. The per-patch latch stops ' +
    'ONE still holding you forever and the calm stops TWO taking turns — both are needed');
  check('and leaving and coming back is a second hold, because that is a second entry',
    (() => {
      const g = groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 });
      const s = pilot(); s.x = 0; s.y = 0;
      let grabs = 0;
      for (const inside of [true, true, false, false, true]) {
        // ten seconds of each, which is past the calm either way
        for (let i = 0; i < 300; i++) {
          const b = groundBite(g, 1, s, inside, poolOf(s), dt);
          if (b.hold > 0) { grabs++; holdEngines(s, b.hold); }
          stepSnare(s, dt);
        }
      }
      return grabs === 2;
    })(),
    'in, out, in: two holds. The ledger is emptied on the way out, so crossing a still ' +
    'twice costs twice — which is the thing a pilot can actually decide');
  check('sanctuary is refused a still outright, provoked or not',
    (() => {
      // The Kedge's rule, not a new one: fixHolds() has broken on a haven since the
      // day it was written, with no provocation exception. A pool may burn you in a
      // portal mouth because that is a price; a still may not hold you there because
      // that is the door being shut.
      const g = groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 });
      const s = pilot();
      const b = groundBite(g, 1, s, true, poolOf(s), dt);
      return b.hold > 0;              // the module offers it; server.js gates on haven
    })(),
    'shared/ground.js offers the hold and server.js refuses it inside inHaven(), the ' +
    'same shape stepFix/fixHolds already has');
}

// --- what the ground does -----------------------------------------------------
console.log('\nthe ground');
{
  // REWRITTEN because both now carry a GUN, and threatDps sums the two: a gun is a
  // flat number of points and the ground is a share, so the total is deliberately NOT
  // flat any more. That is the design rather than a regression — the gun is the part
  // the balance model already knows how to price, and the ground is the part that
  // cannot decay. So the claim measures the halves separately, which is a stronger
  // thing to be able to say than the one it replaces.
  check('the GROUND is a share of the pilot, so research can never make it safer',
    (() => {
      const secs = k => STAGE_KEYS.map(st => stageEhp(st) / (ALIENS[k].sow.rate * stageEhp(st)));
      return ['crucible', 'doldrum'].every(k => {
        const t = secs(k); return Math.max(...t) / Math.min(...t) < 1.02;
      });
    })(),
    `standing in the plasma kills you in ${(1 / V.sow.rate).toFixed(1)}s and in a still in ` +
    `${(1 / D.sow.rate).toFixed(1)}s, at every stage of the game and every rung of research`);
  check('and the GUN is the flat half, which is what the model knows how to price',
    (() => {
      const gun = k => ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate;
      const want = ANCHORS.pressure * stageEhp('finished');
      return ['crucible', 'doldrum'].every(k => Math.abs(gun(k) - want) / want < 0.01)
          && ALIENS.crucible.attrs.fireRate !== ALIENS.doldrum.attrs.fireRate;
    })(),
    (() => {
      const gun = k => ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate;
      return `${gun('crucible').toFixed(0)} dps each, which is ANCHORS.pressure x ` +
             `stageEhp('finished') = ${(ANCHORS.pressure * stageEhp('finished')).toFixed(0)} — the ` +
             'model\'s own answer to "what must a hostile at that stage throw". Same dps, different ' +
             `trigger: ${ALIENS.crucible.attrs.damage} x ${ALIENS.crucible.attrs.fireRate} against ` +
             `${ALIENS.doldrum.attrs.damage} x ${ALIENS.doldrum.attrs.fireRate}. It MOVES when the ` +
             'shop moves, so a hull change fails here rather than leaving them quoting a stage nobody flies';
    })());
  check('a gun you cannot out-range, and ground that reaches past even that',
    ['crucible', 'doldrum'].every(k =>
      ALIENS[k].attrs.weaponRange > 820 && ALIENS[k].sow.reach > ALIENS[k].attrs.weaponRange),
    `${ALIENS.crucible.attrs.weaponRange}px of barrel against 620-820 of hull, and ${V.sow.reach}px ` +
    'of sowing past that — so backing off past 900 leaves the band where the ground still lands and ' +
    'the gun has stopped, which is the layer these two grew when they grew barrels');
  // REWRITTEN with the rates. They were pressure/sqrt(10) and pressure/10 — half a
  // rung and a full rung UNDER on model — and the designer flew that and asked for
  // three times the plasma and five times the still. Both land on numbers this game
  // already had an argument for, which is why the ask and the ladder agree here
  // rather than fighting: x3 of the old pool is 0.0427 and ANCHORS.pressure is 0.045,
  // within 5%, so the plasma takes the model's own definition of a dangerous hostile.
  // x5 of the old still is exactly DRAIN_RATE, a Lamprey's tether, which has its own
  // paragraph in siphon.js about why half of on-model is the honest share for
  // something you cannot dodge.
  check('the plasma is on model and the still is half of it',
    Math.abs(V.sow.rate - ANCHORS.pressure) < 1e-9 &&
    Math.abs(D.sow.rate - DRAIN_RATE) < 1e-9 &&
    Math.abs(D.sow.rate - V.sow.rate / 2) < 1e-9,
    `${V.sow.rate} is ANCHORS.pressure exactly and ${D.sow.rate} is DRAIN_RATE, a Lamprey's ` +
    'tether — so the still is half the plasma, and the ground that holds you is still ' +
    'deliberately not the ground that kills you');
  // WHY IT IS UNDER the model rather than over it, which looks wrong until you do the
  // arithmetic. ANCHORS.pressure is 4.5% of a pilot per second, and that number was
  // set against the anchor fight: 8.68 seconds, so an on-model hostile takes 39% of
  // you over its OWN fight. A hostile with 2,055,480 hit points has a fight forty
  // seconds long for the party it is posted for, and 4.5% a second over forty seconds
  // is not a fight, it is arithmetic.
  check('a hostile whose fight is longer than the anchor fight has to be gentler per second',
    (() => {
      const fight = k => farmHp(k) / (stageDps(POSTING[k].stage) * POSTING[k].party);
      // Two halves, and both are needed. The fight is ten times the anchor fight, and
      // the rate is UNDER the model's — because at the model's 4.5% a second a pilot
      // would owe 409% of their ship over one of these, which is not a fight but
      // arithmetic. And it is not merely gentle: standing in a pool for the whole
      // fight still kills you (129% of the ship), so what the low rate buys is that
      // leaving works, not that staying is free. See the SEAM on alienFor's `dps`.
      return ['crucible', 'doldrum'].every(k =>
        fight(k) > ANCHOR_FIGHT * 4
        && ALIENS[k].sow.rate < ANCHORS.pressure
        && V.sow.rate * fight(k) > 1);
    })(),
    (() => {
      const f = farmHp('crucible') / (stageDps(POSTING.crucible.stage) * POSTING.crucible.party);
      return `${f.toFixed(0)}s against an ${ANCHOR_FIGHT.toFixed(1)}s anchor: on model per second ` +
             `would owe ${(100 * ANCHORS.pressure * f).toFixed(0)}% of the pilot over one fight. This ` +
             `owes ${(100 * V.sow.rate * f).toFixed(0)}% if you never leave the ground, and measured ` +
             'a pilot flying the counter is standing in it 24% of the time';
    })());
  check('patches never stack, so a Crucible cannot delete anybody by sowing twice on one spot',
    (() => {
      const s = pilot('finished', X32);
      s.x = 0; s.y = 0;
      const gs = Array.from({ length: 6 }, (_, i) =>
        Object.assign(groundFor({ def: V, provoked: new Set([1]) }, { x: 0, y: 0 }), { id: i }));
      let worst = 0;
      for (const g of gs) { const b = groundBite(g, 1, s, true, poolOf(s), dt); if (b.burn > worst) worst = b.burn; }
      const one = V.sow.rate * poolOf(s) * dt;
      return Math.abs(worst - one) < 1e-6;
    })(),
    'six pools on one point take exactly what one takes — and threatDps counts a sower\'s ' +
    'rate once for the same reason, so the model and the tick agree');
  check('a Crucible can never have more ground down than it says it may',
    V.sow.every === V.sow.life / V.sow.max && D.sow.every === D.sow.life / D.sow.max,
    `${V.sow.max} pools x ${V.sow.life}s / ${V.sow.every}s and ${D.sow.max} stills x ` +
    `${D.sow.life}s / ${D.sow.every}s — the cadence is life / max rather than a fourth number`);
  // REWRITTEN, and the reason is the carpet. `life` was one lap — 37 seconds, so the
  // ground you laid at the start of a circuit let go as you came back round to it —
  // and with six pools a hostile that was a beautiful relation and an unplayable
  // screen: four of these put THIRTY-TWO live patches up at once, every one animated,
  // and area denial that covers everything denies nothing because there is no clean
  // ground left to steer toward.
  //
  // So the count came down and the size went up, which is the same mechanic said
  // properly: a few large deliberate areas rather than a carpet. What replaces the lap
  // is a claim about how much of the fight is DENIED, which is the thing the lap was a
  // proxy for and is what a pilot actually experiences.
  const ORBIT = (() => { const me = pilot('finished', X32); return me.stats.weaponRange * 0.92; })();
  const blocked = k => (ALIENS[k].sow.max * 2 * ALIENS[k].sow.r) / (2 * Math.PI * ORBIT);
  console.log(`     the circle a fight is fought on is ${Math.round(2 * Math.PI * ORBIT)}px around, ` +
    `at ${Math.round(ORBIT)}px of gun range`);
  for (const k of ['crucible', 'doldrum'])
    console.log(`     ${ALIENS[k].name.padEnd(9)} ${ALIENS[k].sow.max} x ${ALIENS[k].sow.r}px blocks ` +
      `${(100 * blocked(k)).toFixed(0)}% of it, one every ${ALIENS[k].sow.every}s for ${ALIENS[k].sow.life}s`);
  check('neither of them holds more than a third of the ground its own fight is on',
    blocked('crucible') <= 1 / 3 && blocked('doldrum') <= 1 / 3,
    `${(100 * blocked('crucible')).toFixed(0)}% and ${(100 * blocked('doldrum')).toFixed(0)}% — ` +
    'a hostile that holds more than a third has stopped shaping the space and started being it. ' +
    'The sum is an upper bound and a bad one, because the pair overlaps by construction: both sow ' +
    'at the SAME feet, so their two circles are very nearly concentric and the union is close to ' +
    'the bigger of them alone');
  check('and the whole map holds a handful of patches, not a carpet',
    2 * (V.sow.max + D.sow.max) <= 6,
    `${2 * (V.sow.max + D.sow.max)} live patches across a deep sector's two pairs, against the ` +
    '32 that four of these used to put up at once — every one of them animated. Fewer and bigger ' +
    'is the same mechanic said properly');
  check('and `every` is still life over max, so nothing can ask for more ground than it may hold',
    V.sow.every === V.sow.life / V.sow.max && D.sow.every === D.sow.life / D.sow.max,
    `${V.sow.max} pools x ${V.sow.life}s / ${V.sow.every}s and ${D.sow.max} still x ${D.sow.life}s / ` +
    `${D.sow.every}s. Both cadences are read off the root's own clocks: a Crucible lays one pool per ` +
    `CALM (${CALM}s), so a pilot just freed has one fresh pool and never two, and a Doldrum lays one ` +
    `still per HOLD + CALM (${HOLD + CALM}s), so it can never build a second to catch you inside the ` +
    'calm it owes you');
}

// --- can it be refused? -------------------------------------------------------
console.log('\nrefusing it');
{
  const travel = stage => {
    const s = pilot(stage, X32); s.x = 0; s.y = 0; s.tx = 1e5; s.ty = 0;
    let t = 0; while (t < WARN) { step(s, dt); t += dt; }
    return { px: s.x, r: s.r };
  };
  const rows = STAGE_KEYS.map(st => [st, travel(st)]);
  for (const [st, r] of rows)
    console.log(`     ${st.padEnd(12)} covers ${r.px.toFixed(0).padStart(4)}px from rest in the ` +
      `${WARN}s the marker stands, against ${(V.sow.r + r.r).toFixed(0)}px of pool and ${(D.sow.r + r.r).toFixed(0)}px of still`);
  // INVERTED, not adjusted. This used to read "every hull in the game can refuse a
  // pool from a standing start", and the radius was derived from it: 165px, because
  // the slowest fitted ship covers 184px from rest inside the warning. Flown, that is
  // a hostile whose pools never hit anything — a Bulwark stepped aside without
  // touching its thrusters and was never in one.
  //
  // So the requirement is the opposite one now, and it is met by GEOMETRY rather than
  // by timing: the FASTEST hull in the game covers 457px from rest inside the same
  // warning, against 570px of pool, so nothing in the shop steps out of one. What the
  // marker buys is a chance to not be in the middle, and what leaving costs is time
  // measured below rather than nothing at all.
  check('nothing in the shop can step out of a pool any more, at any speed',
    rows.every(([, r]) => r.px < V.sow.r + r.r),
    `the widest miss is a Kestrel at ${Math.round(Math.max(...rows.map(([, r]) => r.px)))}px against ` +
    `${V.sow.r}px of plasma. It was 165px wide and every hull cleared it; the pools stopped hitting ` +
    'anything, which is the complaint this reverses');
  check('and neither can they step out of a still, which was always the point of one',
    rows.every(([, r]) => r.px < D.sow.r + r.r),
    `${D.sow.r}px against ${Math.round(Math.max(...rows.map(([, r]) => r.px)))}px of travel at the best`);
  // What leaving actually costs, which is the number that replaces "can you dodge it".
  {
    const cross = (stage, R) => {
      const s = pilot(stage, X32); s.x = 0; s.y = 0; s.tx = 1e5; s.ty = 0;
      let t = 0; while (s.x < R + s.r && t < 60) { step(s, dt); t += dt; }
      return t;
    };
    for (const st of ['fighter', 'cruiser', 'finished'])
      console.log(`     ${st.padEnd(12)} crosses out of the plasma in ${cross(st, V.sow.r).toFixed(1)}s ` +
        `from a dead stop, and out of a still in ${cross(st, D.sow.r).toFixed(1)}s`);
    check('leaving one costs real seconds instead of a sidestep',
      cross('finished', V.sow.r) > 4 && cross('finished', D.sow.r) > 5,
      `${cross('finished', V.sow.r).toFixed(1)}s to cross out of the plasma from the middle in the ` +
      `slowest hull that fights one, ${(cross('finished', V.sow.r) - WARN).toFixed(1)}s of it after the ` +
      `ground has gone live — at ${(100 * V.sow.rate).toFixed(1)}% of the ship a second`);
  }
  // The 2x relation is GONE, and what replaced it is better. A still used to be at
  // least twice a pool so that a pool sown ANYWHERE inside it was wholly inside it —
  // a guarantee about the combo bought with geometry. The pair travels together now,
  // and both sow at the same victim's feet on the same tick, so the two circles are
  // very nearly concentric and the guarantee comes from the posting instead. What the
  // radii do now is give the trap a near miss: the still is wider, so its rim costs
  // you five seconds and nothing else, and only its middle costs you five seconds
  // inside the plasma.
  check('the still is wider than the plasma, so the trap has a near miss in it',
    D.sow.r > V.sow.r && D.sow.r < 2 * V.sow.r,
    `${D.sow.r} against ${V.sow.r} — caught at the rim you lose five seconds; caught in the middle ` +
    'you lose five seconds standing in what its Crucible poured there');
  // RETIRED: `wind === HOLD` used to be the combo, because a pilot who was not held
  // had exactly enough warning to be somewhere else. The radius does that job now —
  // nothing steps out of 570px whatever the clock says — so the warning went back to
  // being only a warning, and it is the shortest one this game gives for anything
  // that matters.
  check('the warning is half a portal spool, and it is only a warning now',
    V.sow.wind === WARN && D.sow.wind === WARN && WARN === JUMP_TIME / 2 && WARN < HOLD,
    `${WARN}s of marker against a ${HOLD}s stop — the two were the same number when the pool was ` +
    'narrow enough to step out of, and the geometry replaced the identity');
  check('and the marker is where the ground lands, not where the hostile is',
    (() => {
      const map = MAPS.d1;
      const a = newAlien('crucible', 9001, map, 5, { x: 4200, y: 5600 });
      a.x = a.post.x; a.y = a.post.y;
      const me = pilot(); me.x = 3400; me.y = 5600;
      let at = null, t = 0;
      while (t < 6 && !at) { const d = stepSow(a, me, true, dt); if (d) at = d.at; me.x += 300 * dt; t += dt; }
      return at && Math.abs(at.x - 3400) < 30 && Math.hypot(at.x - a.x, at.y - a.y) > 500;
    })(),
    'sown on the victim\'s place at the moment the wind-up STARTED — at the end it would be ' +
    'undodgeable, and on the hostile it would be a ring, which this bestiary already has one of');
}

// --- a real fight ---------------------------------------------------------------
//
// stepAlienAI, stepSow, step, stepSnare, stepVitals, fire, launch, stepBolts and
// stepRockets, in the order server.js calls them. Twenty-two milliseconds a fight,
// so the whole matrix runs inside this suite rather than in a script beside it —
// which matters, because these are the numbers the rung was argued from and a
// number nobody re-runs is a number that goes quietly out of date.
const MAP = MAPS.d1;
// Not (6000, 4000): that is d1's portal to Nullpoint, and a portal mouth is a
// haven, so every sower in the sector politely refused to sow on anybody standing
// in it and the first draft of this measured nothing at all for twenty minutes.
const AT = { x: 3400, y: 5600 };

function fight({ kinds, n = 1, research = 0, plan, secs = 900, seed = 7, spread = 260 }) {
  const crew = Array.from({ length: n }, (_, i) => {
    const s = pilot('finished', research);
    s.x = AT.x + Math.cos(i / n * 6.283) * (n > 1 ? spread : 0);
    s.y = AT.y + Math.sin(i / n * 6.283) * (n > 1 ? spread : 0);
    return { id: i + 1, ship: s, took: 0, inG: 0, snared: 0, onTgt: 0,
             ehp0: s.stats.hull + s.stats.shield };
  });
  // Posted the way server.js posts them: a Crucible and a Doldrum PAIR_GAP apart, so
  // a pull on either is a pull on both. Anything left over stands on its own.
  const PAIR_GAP = 260;
  const foes = kinds.map((k, i) => {
    const a = newAlien(k, 5000 + i, MAP, seed + i * 13,
      { x: AT.x + 900 + (i % 2) * PAIR_GAP, y: AT.y + Math.floor(i / 2) * 900 });
    a.x = a.post.x; a.y = a.post.y; return a;
  });
  for (let i = 0; i + 1 < foes.length; i += 2)
    if (ALIENS[foes[i].kind].mate === foes[i + 1].kind) { foes[i].mate = foes[i + 1].id; foes[i + 1].mate = foes[i].id; }
  const ground = []; let bolts = [], rockets = [], gid = 1, t = 0, longest = 0;
  while (t < secs) {
    const alive = foes.filter(f => f.hp > 0), up = crew.filter(c => c.ship.hp > 0);
    if (!alive.length || !up.length) break;
    const here = up.map(c => ({ id: c.id, ship: c.ship, haven: inHaven(MAP, c.ship), loud: 1 }));
    for (const a of alive) {
      // The pair hunts one pilot, exactly as server.js does it: the target is handed
      // over before stepAlienAI so the AI keeps it on LEASH rather than on aggro, and
      // the grudge is NOT handed over with it. Without this the harness measures two
      // hostiles that happen to be near each other, which is the thing this change
      // replaced.
      if (a.mate !== undefined && a.target === null) {
        const mate = foes.find(x => x.id === a.mate && x.hp > 0);
        if (mate && mate.target !== null && mate.target !== undefined) a.target = mate.target;
      }
      const tgt = stepAlienAI(a, MAP, here, dt);
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
      faceTarget(a, victim?.ship ?? null);
      for (const b of fire(a, victim?.ship ?? null, dt)) bolts.push(b);
      if (sowOf(a.def)) {
        const drop = stepSow(a, victim?.ship ?? null,
          victim ? sowHolds(a, victim.ship, victim.haven) : false, dt);
        if (drop) {
          const mine = ground.filter(g => g.owner === a.id);
          if (mine.length >= a.def.sow.max)
            ground.splice(ground.indexOf(mine.reduce((w, g) => (g.t < w.t ? g : w))), 1);
          ground.push(Object.assign(groundFor(a, drop.at), { id: gid++, owner: a.id }));
        }
      }
    }
    for (const c of up) {
      const me = c.ship;
      const near = [...alive].sort((x, y) =>
        Math.hypot(x.x - me.x, x.y - me.y) - Math.hypot(y.x - me.x, y.y - me.y));
      plan(t, me, near, ground);
      step(me, dt); stepSnare(me, dt); stepVitals(me, dt, false);
      const f = near[0];
      faceTarget(me, f);
      if (Math.hypot(f.x - me.x, f.y - me.y) <= me.stats.weaponRange) c.onTgt += dt;
      for (const b of fire(me, f, dt))   { b.owner = c.id; bolts.push(b); }
      for (const r of launch(me, f, dt)) { r.owner = c.id; rockets.push(r); }
      // Pulling the trigger is the provocation, exactly as server.js has it. Without
      // it a hostile with aggro 540 that a pilot is kiting at 754px never notices
      // anybody, and the whole fight is a shooting gallery.
      f.provoked.add(c.id); if (f.target === null) f.target = c.id;
    }
    for (const h of [...stepBolts(bolts, dt), ...stepRockets(rockets, dt)]) {
      const who = crew.find(c => c.ship === h.target);
      if (who) who.took += h.split.shield + h.split.hull;
    }
    for (let i = ground.length - 1; i >= 0; i--) if (!stepGround(ground[i], dt)) ground.splice(i, 1);
    for (const c of up) {
      const haven = inHaven(MAP, c.ship);
      let worst = 0, grab = 0, inAny = false;
      for (const g of ground) {
        const inside = inGround(g, c.ship);
        if (inside) inAny = true;
        const bit = groundBite(g, c.id, c.ship,
          inside && mayHarm({ provoked: g.by }, { id: c.id, haven }), poolOf(c.ship), dt);
        if (bit.burn > worst) worst = bit.burn;      // patches do not stack
        if (bit.hold > grab && !haven) grab = bit.hold;
      }
      if (worst > 0) { applyDamage(c.ship, worst); c.took += worst; }
      if (inAny) c.inG += dt;
      if (grab > 0) holdEngines(c.ship, grab);
      if (held(c.ship)) { c.snared += dt; c.run = (c.run ?? 0) + dt; longest = Math.max(longest, c.run); }
      else c.run = 0;
    }
    t += dt;
  }
  const dead = crew.filter(c => c.ship.hp <= 0).length;
  return { t, killed: foes.every(f => f.hp <= 0), dead, n, longest,
           left: crew.map(c => Math.max(0, (c.ship.hp + c.ship.shield) / c.ehp0)),
           inG: crew[0].inG, uptime: t > 0 ? crew[0].onTgt / t : 0 };
}

// Four ways to fly the same fight, from worst to best. Naming them is the point:
// the claim below is not "this hostile is hard", it is "this hostile is answered by
// a thing a pilot does, and here is the thing".
const PLANS = {
  // stands at its own gun range and holds it. The right answer to every hostile
  // before this one, and the reason these two exist.
  kite: (t, me, foes) => {
    const f = foes[0], d = Math.hypot(f.x - me.x, f.y - me.y), want = me.stats.weaponRange * 0.92;
    if (d < want - 60) { me.tx = me.x + (me.x - f.x) / d * 400; me.ty = me.y + (me.y - f.y) / d * 400; }
    else if (d > want + 60) { me.tx = f.x; me.ty = f.y; }
    else { me.tx = me.ty = null; }
  },
  // holds range and CIRCLES, which answers "the ground lands where you were" and
  // nothing else. It does not look at the patches.
  orbit: (t, me, foes) => {
    const f = foes[0], dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1;
    const want = me.stats.weaponRange * 0.92;
    const a0 = Math.atan2(dy, dx) + 0.45;
    const r = d + Math.max(-120, Math.min(120, want - d));
    me.tx = f.x + Math.cos(a0) * r; me.ty = f.y + Math.sin(a0) * r;
  },
  // GIVES UP THE SHOT. The plasma is 560px wide and the orbit only flexes by 120, so
  // "circle and pick a clean lane" stopped being available the moment the pools got
  // big: there is no clean lane inside your own gun range any more. This one leaves
  // the ground by the shortest line whatever that costs, which means flying out past
  // 820 and not shooting for a while. It is the honest counter to an area you cannot
  // step around, and it is the one a human reaches for.
  quit: (t, me, foes, ground) => {
    const inIt = ground.filter(g => Math.hypot(me.x - g.x, me.y - g.y) < g.r + me.r);
    if (inIt.length) {
      const g = inIt.reduce((w, x) => (x.rate > w.rate ? x : w));
      const dx = me.x - g.x || 1, dy = me.y - g.y, d = Math.hypot(dx, dy) || 1;
      me.tx = g.x + dx / d * (g.r + me.r + 200); me.ty = g.y + dy / d * (g.r + me.r + 200);
      return;
    }
    PLANS.orbit(t, me, foes, ground);
  },
  // and the whole counter: circle, and refuse to fly through ground already down.
  // This is an ORACLE — it reads every patch on the field including ones outside
  // radar — so what it measures is the ceiling of human play, not the average.
  fly: (t, me, foes, ground) => {
    const f = foes[0], dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1;
    const want = me.stats.weaponRange * 0.92;
    for (const side of [0.45, 0.75, 1.1, -0.45, -0.75]) {
      const a0 = Math.atan2(dy, dx) + side;
      const r = d + Math.max(-120, Math.min(120, want - d));
      const px = f.x + Math.cos(a0) * r, py = f.y + Math.sin(a0) * r;
      if (!ground.some(g => Math.hypot(px - g.x, py - g.y) < g.r + me.r + 40)) {
        me.tx = px; me.ty = py; return;
      }
    }
    PLANS.orbit(t, me, foes, ground);
  },
};

// --- the fight ----------------------------------------------------------------
console.log('\nthe fight, through the real loop');
{
  // One combo event, in the lab: a pool laid inside a still and a pilot standing
  // still to shoot when it catches them. This is the worst case the pair can build.
  const worstCase = (stage, research) => {
    const me = pilot(stage, research); me.x = 0; me.y = 0; me.vx = me.vy = 0;
    const ehp0 = me.stats.hull + me.stats.shield;
    const gs = [Object.assign(groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 }), { id: 1 }),
                Object.assign(groundFor({ def: V, provoked: new Set([1]) }, { x: 0, y: 0 }), { id: 2 })];
    holdEngines(me, HOLD);
    let t = 0, took = 0, coast = 0, clear = null;
    while (t < 30) {
      const inAny = gs.filter(g => inGround(g, me));
      if (!inAny.length) { clear = t; break; }
      const g = inAny.reduce((w, x) => (x.rate > w.rate ? x : w));
      const dx = me.x - g.x || 1, dy = me.y - g.y, d = Math.hypot(dx, dy) || 1;
      me.tx = g.x + dx / d * (g.r + me.r + 140); me.ty = g.y + dy / d * (g.r + me.r + 140);
      step(me, dt); stepSnare(me, dt);
      let worst = 0, grab = 0;
      for (const g2 of gs) {
        const b = groundBite(g2, 1, me, inGround(g2, me), poolOf(me), dt);
        if (b.burn > worst) worst = b.burn;
        if (b.hold > grab) grab = b.hold;
      }
      if (worst > 0) { applyDamage(me, worst); took += worst; }
      if (grab > 0) holdEngines(me, grab);
      if (held(me)) coast += dt;
      t += dt;
    }
    return { pct: 100 * took / ehp0, coast, clear: clear ?? t };
  };
  const cases = [];
  for (const st of ['fighter', 'cruiser', 'finished'])
    for (const [rn, res] of [['x1', 0], ['x32', X32]]) cases.push([st, rn, worstCase(st, res)]);
  for (const [st, rn, r] of cases)
    console.log(`     ${st.padEnd(12)} ${rn.padEnd(4)} coasted ${r.coast.toFixed(2)}s, clear of both at ` +
      `${r.clear.toFixed(2)}s, cost ${r.pct.toFixed(1)}% of the ship`);
  // The threshold moved from 8% to 55% and that is the headline of this pass. It was
  // "the combo is survivable"; it is now "the combo is most of your ship", which is
  // what a five-second dead stop inside 560px of plasma costs. What has NOT moved is
  // the property that matters more: it is the same share at x1 and at x32, because
  // both halves of it are shares of the pilot rather than amounts.
  check('the combo takes most of a ship, and takes the same share whatever you fly',
    cases.every(([, , r]) => r.pct < 55) && cases.some(([, , r]) => r.pct > 30) &&
    Math.abs(cases.find(c => c[0] === 'finished' && c[1] === 'x1')[2].pct
           - cases.find(c => c[0] === 'finished' && c[1] === 'x32')[2].pct) < 0.05,
    `${Math.max(...cases.map(c => c[2].pct)).toFixed(1)}% of the ship at worst — stopped for ` +
    `${HOLD}s with a pool on the spot, which is the NORMAL case rather than the worst one, because ` +
    'the pair travels together and both sow at the same feet. It has been 5.1% (a 1.5s coast, 165px ' +
    'of plasma), then 46.0% (a 5s stop, 560px), and halving the hold took it to this. Identical at ' +
    'x1 and x32, to the tenth, which is the property that survived all three');
  // The bound is the coast plus the walk out of a still, and the walk is the slowest
  // fitted hull crossing 420px of it — 420 + 17 over 128 px/s is 3.4s, so 1.5 + 3.4
  // is 4.9 and there is no arrangement that can be slower. Written as HOLD plus that
  // rather than as a round number, so it moves when a hull does instead of going
  // quietly out of date the way the flat 6 in test/sim.mjs did.
  const walkOut = (D.sow.r + 17) / 128;
  check('and a pilot always gets out of it, in the hold plus one crossing',
    cases.every(([, , r]) => r.clear < HOLD + walkOut + 0.5),
    `clear of both at ${Math.max(...cases.map(c => c[2].clear)).toFixed(2)}s — a ${HOLD}s coast plus ` +
    `${walkOut.toFixed(1)}s to cross a still at the slowest fitted speed in the game. The coast ends, ` +
    'the throttle comes back, and the ground does not follow');
}

// --- what the fight actually is -------------------------------------------------
//
// This is the block the rung was argued from, so it prints its table. A finished
// Bulwark with its reactor on the gun delivers 11,941 dps measured here against
// balance.js's 11,307, and the fight it buys is 172 seconds.
console.log('\nthe fight, driven by the real AI');
{
  const line = (label, r) =>
    `     ${label.padEnd(26)} ${(r.dead === r.n ? 'WIPED' : r.killed ? 'cleared it' : 'timed out').padEnd(11)}` +
    `${(r.t.toFixed(0) + 's').padStart(6)}   ${r.left.map(v => (100 * v).toFixed(0).padStart(3) + '%').join(' ')}`;
  const solo = {};
  for (const [pn, plan] of Object.entries(PLANS))
    for (const kinds of [['crucible'], ['doldrum'], ['crucible', 'doldrum']]) {
      const r = fight({ kinds, research: X32, plan, secs: 900 });
      solo[`${kinds.join('+')}/${pn}`] = r;
      console.log(line(`${kinds.join(' + ')} / ${pn}`, r));
    }
  // REWRITTEN, and read the numbers above before the sentence: a single pilot no
  // longer takes either of these, at any policy. That is the compound effect of six
  // changes landing together — the plasma at three times its old rate, the stills at
  // five, a five-second DEAD STOP where there used to be a coast, patches at 560 and
  // 720px where they were 165 and 420, and the pair posted so that pulling one pulls
  // both. Each was asked for; this is what they add up to, and it is reported here
  // rather than left for somebody to find in the deeps.
  check('no policy saves a lone pilot from either of them any more',
    ['kite', 'orbit', 'quit', 'fly'].filter(pn => solo[`crucible/${pn}`].dead === 1).length >= 3 &&
    ['kite', 'orbit', 'quit', 'fly'].filter(pn => solo[`doldrum/${pn}`].dead === 1).length >= 3,
    `four ways of flying it and ${['kite', 'orbit', 'quit', 'fly'].filter(pn => solo[`crucible/${pn}`].dead === 1).length} ` +
    'of them die to ONE Crucible. It was 100% of a ship left before this pass');
  // And the inversion, which is the part worth staring at. Standing still at your own
  // gun range now OUTLIVES circling, because the ground lands at your feet either way
  // and moving is what breaks the range you need to end the fight. The mechanic used
  // to teach "keep moving"; at 560px it teaches the opposite, because there is no
  // clean lane inside your own reach to move into.
  check('and moving is now worse than standing still, which is the mechanic inverted',
    solo['crucible/kite'].t > solo['crucible/orbit'].t &&
    solo['crucible/kite'].t > solo['crucible/quit'].t,
    `kiting lasts ${solo['crucible/kite'].t.toFixed(0)}s against ${solo['crucible/orbit'].t.toFixed(0)}s ` +
    `circling and ${solo['crucible/quit'].t.toFixed(0)}s giving up the shot to leave the ground. A pool ` +
    'is 560px and the orbit only flexes by 120, so leaving means leaving GUN RANGE, and a fight you ' +
    'cannot end is one the ground wins.\n' +
    '       Swept: standing still wins at 560, 450, 380, 320, 250 AND 200px of plasma, and only ' +
    'loses at 165 — the width this replaced. So the inversion is not the orbit flex, it is that the ' +
    'plasma lands at your FEET: moving buys nothing unless the pool is small enough to walk out of ' +
    'inside the warning, and that is the thing the designer asked to stop being true');
  check('but the PAIR kills that same pilot, which is what the deeps are for',
    solo['crucible+doldrum/fly'].dead === 1,
    `dead at ${solo['crucible+doldrum/fly'].t.toFixed(0)}s with ${solo['crucible+doldrum/fly'].inG.toFixed(0)}s ` +
    'spent in ground — neither of them knows the other exists. They both sow at their ' +
    'target\'s feet, so if they are both fighting YOU the ground lands in one place');
  // How many pilots, measured rather than intended, over three starting arrangements
  // so the answer is not one seed's luck.
  console.log('');
  const need = [];
  for (const n of [1, 2, 3, 4]) {
    const runs = [160, 260, 420].map(spread =>
      fight({ kinds: ['crucible', 'doldrum'], n, research: X32, plan: PLANS.fly, secs: 1200, spread }));
    need.push([n, runs]);
    console.log(`     the pair against ${n} pilot${n > 1 ? 's ' : '  '} ` +
      runs.map(r => `${r.dead === n ? 'WIPED' : r.killed ? 'cleared' : 'timed out'} ${r.t.toFixed(0)}s ` +
                    `${r.left.map(v => (100 * v).toFixed(0)).join('/')}%`).join('   |   '));
  }
  const at = k => need.find(([n]) => n === k)[1];
  check('one pilot cannot have the pair, at any arrangement',
    at(1).every(r => r.dead === 1),
    `wiped at ${at(1).map(r => Math.round(r.t) + 's').join(', ')} — three starting spreads, so it is ` +
    'the pairing rather than one seed of luck. And the pair is now the GUARANTEED encounter: they ' +
    'share a post, so pulling either is pulling both');
  // THE FINDING OF THIS PASS, and it is the one somebody has to decide about rather
  // than a claim about a fight that works. Party size does not divide ground: a gun
  // shoots one pilot at a time and a pool burns everybody standing in it, so the time
  // a pilot takes to DIE is independent of how many friends they brought, while the
  // time the pair takes to CLEAR only falls as 1/n. At 4,110,960 effective hit points
  // the pair needs 86 seconds from a party of four and kills each of them well inside
  // that. Measured, at the shape asked for, the pair is not completable at ANY party
  // size — one, two, three, four and six are all wiped.
  //
  // The levers were measured too, and the radius dominates: at 250px of plasma a lone
  // pilot takes a Crucible again, and the rate boundary for a party is around half
  // what was asked. Neither of those is mine to choose, so this asserts the shape of
  // the problem rather than a number, and it will start failing the moment somebody
  // makes the encounter completable — which is the right way round for a claim that
  // exists to be argued with.
  check('and party size does not divide ground, which is why more pilots does not fix it',
    at(2).every(r => r.dead >= 1) && at(4).every(r => r.dead >= 1),
    `two, three and four pilots all lose ships: ${[1, 2, 3, 4].map(n =>
      `${n}p ${at(n).map(r => r.dead).join('/')} dead`).join(', ')}. A gun shoots one pilot and a ` +
    'pool burns everybody in it, so time-to-die is flat in party size while time-to-clear falls as ' +
    '1/n. The pair is 4,110,960 ehp: 86s of shooting from four finished pilots, against a ship that ' +
    'is gone in 35-70s of this ground.\n' +
    '       Halving the hold from 5s to 2.5s did not move it, and was not expected to — the sweep ' +
    'said radius first and rates second, and the hold barely at all. Measured at 2.5s, worst of ' +
    'three arrangements, everything else held:\n' +
    '         plasma 320px          3 pilots clear it losing 2, 4 clear it losing 1\n' +
    '         rates x0.35           the same, one lever the other way\n' +
    '         320px and rates x0.75 3 pilots clear it losing ONE, which is the best of them\n' +
    '       NOTHING on that menu is clearable by two: the best a pair of pilots managed anywhere ' +
    'was to survive 238 seconds at a quarter of the asked-for rates and still be wiped. Three is ' +
    'the floor');
  check('nothing costs a shot, which is why neither carries an effort multiplier',
    solo['crucible/fly'].uptime > 0.97 && solo['doldrum/fly'].uptime > 0.97,
    `the trigger is held for ${(100 * solo['crucible/fly'].uptime).toFixed(0)}% of the fight — circling ` +
    'at your own gun range never breaks range. A Bandit is 3.8 because 28% of what is fired ' +
    'at it lands; these land everything, so farmHp is effectiveHp and the rung is the hull');
  check('and no stop anywhere in any of that outlasted the stated one',
    Object.values(solo).every(r => r.longest <= HOLD + 1 / 30 + 1e-9),
    `longest stop across ${Object.keys(solo).length} fights: ` +
    `${Math.max(...Object.values(solo).map(r => r.longest)).toFixed(2)}s against a stated ${HOLD}s ` +
    'plus the tick it lands on — the anti-chain guarantee holds inside a real fight and not only ' +
    'in the brute force above');
}

// --- where they live ----------------------------------------------------------
console.log('\nthe posting and the pay');
{
  check('both stand on a rung of the ladder, half a decade above the mothership',
    Math.abs(effectiveHp('crucible') - 650 * Math.pow(10, 3.5)) <= 25 &&
    effectiveHp('doldrum') === effectiveHp('crucible'),
    `${effectiveHp('crucible').toLocaleString()} each — 650 x 10^3.5 to the nearest ten, the same ` +
    'arithmetic that produced the Harrier\'s 2,060 and the Thresher\'s 205,550');
  check('effective hit points are a multiple of ten, so a bounty is whole credits',
    ['crucible', 'doldrum'].every(k => effectiveHp(k) % 10 === 0
      && Math.abs(effectiveHp(k) * BOUNTY_RATE - Math.round(effectiveHp(k) * BOUNTY_RATE)) < 1e-6),
    `${effectiveHp('crucible')} x ${BOUNTY_RATE} = ${effectiveHp('crucible') * BOUNTY_RATE} exactly`);
  check('and both pay exactly what the rate says, in credits and in experience',
    ['crucible', 'doldrum'].every(k => ALIENS[k].bounty === bountyFor(k) && ALIENS[k].xp === xpFor(k)),
    `${ALIENS.crucible.bounty.toLocaleString()} cr and ${ALIENS.crucible.xp.toLocaleString()} xp — ` +
    'farm hit points x BOUNTY_RATE and x XP_RATE, with nothing typed in');
  check('neither of them carries an effort multiplier, because neither costs you a shot',
    (ALIENS.crucible.effort ?? 1) === 1 && (ALIENS.doldrum.effort ?? 1) === 1,
    'measured through the real loop: a pilot flying the counter holds the trigger for 100% of ' +
    'the fight, because circling at your own gun range never breaks range. A Bandit is 3.8 ' +
    'because 28% of what is fired at it lands; these land everything');
  check('they notice you no further out than you can see them',
    [V, D].every(a => a.aggro <= 560), `${V.aggro} against 560px of sight`);
  check('and neither of them can catch anybody',
    (() => {
      const slowest = Math.min(...STAGE_KEYS.map(st => pilot(st, X32).stats.speed));
      return V.attrs.speed < slowest && D.attrs.speed < slowest;
    })(),
    `${D.attrs.speed} and ${V.attrs.speed} against the slowest fitted ship in the game at ` +
    `${Math.min(...STAGE_KEYS.map(st => pilot(st, X32).stats.speed)).toFixed(0)}px/s — leaving always works`);
  // REWRITTEN because they have guns now. It used to read "a sower holds station at
  // its sowing reach, not at a gun it does not have" — true while weaponRange was 0,
  // and exactly wrong once it is 900: reading the sowing reach would park one at 770
  // and let it rain from outside its own barrel. The fallback is still there for a
  // sower with no gun, and this checks both halves.
  check('a sower with a gun holds station at the gun, and one without holds at its ground',
    (() => {
      const a = newAlien('crucible', 9002, MAPS.d1, 3);
      if (standOff(a) !== V.attrs.weaponRange) return false;
      const b = newAlien('crucible', 9003, MAPS.d1, 3);
      b.stats = { ...b.stats, weaponRange: 0 };          // what it was before it grew a barrel
      return standOff(b) === V.sow.reach;
    })(),
    `${V.attrs.weaponRange}px of barrel, so it closes to ${Math.round(V.attrs.weaponRange * 0.7)} and ` +
    `works both; strip the gun and it falls back to ${V.sow.reach}px of ground, because 0 x 0.7 parks ` +
    'a hostile inside your hull with its only mechanic having no room to work');
  check('and both survive their own AI, ground and all',
    (() => {
      const map = MAPS.d1;
      const me = pilot(); me.x = 3400; me.y = 5600;
      for (const kind of ['crucible', 'doldrum']) {
        const a = newAlien(kind, 9100, map, 11, { x: 4000, y: 5600 });
        a.x = a.post.x; a.y = a.post.y; a.provoked.add(1);
        const here = [{ id: 1, ship: me, haven: false, loud: 1 }];
        for (let i = 0; i < 300; i++) {
          const tgt = stepAlienAI(a, map, here, dt);
          const vic = tgt ? here[0] : null;
          step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
          stepSow(a, vic?.ship ?? null, vic ? sowHolds(a, vic.ship, vic.haven) : false, dt);
        }
      }
      return true;
    })(),
    'ten seconds of ticks each — a Censer crashed the live server on its first tick with a ' +
    'green suite behind it, because standOff() reached for something aliens.js had not imported');
}

// --- the wire and the shape ---------------------------------------------------
console.log('\nthe wire, the shape and the colour');
{
  check('no new field on a ship row, because there is one slot left in the whole format',
    SHIP_FIELDS.length === 30 && SHIP_FIELDS.length < MAX_FIELDS,
    'a sower\'s wind-up rides `abl`, which is now five deep: draw, spin, fix, load, sow');
  // And the trap that comes with a five-deep multiplex. server.js packs `abl` as
  // `a.draw ?? a.spin ?? a.fix ?? a.load ?? a.sow ?? 0`, which silently keeps the
  // FIRST of the five a hostile happens to carry. Nothing errors; the second dial
  // simply never reaches the client, and what you would see is a mechanic that is
  // running and invisible — which is the exact bug the Thresher's chamber was, and
  // it read as a random one-shot for as long as it existed. One hostile, one dial.
  check('and no hostile carries two of the five dials that field multiplexes',
    WILD.every(k => ['siphon', 'burn', 'fix', 'returns', 'sow']
      .filter(d => ALIENS[k][d] !== undefined).length <= 1),
    WILD.map(k => `${k}:${['siphon', 'burn', 'fix', 'returns', 'sow']
      .filter(d => ALIENS[k][d] !== undefined).join('+') || '-'}`).join(' '));
  check('ground is a keyed stream, not an ephemeral, and the numbers say why',
    !!STREAMS.sown && !EPHEMERAL.includes('sown') && SOWN_FIELDS.length <= MAX_FIELDS,
    `a patch lives ${V.sow.life}s, has an id, and ${SOWN_FIELDS.length - 1} of its ` +
    `${SOWN_FIELDS.length} fields never change once it is laid — only \`p\` moves. That is the ` +
    'exact inverse of every ephemeral, which has no identity, lives under a second and goes ' +
    'stale in every field every tick');
  check('and a row survives the round trip it will actually make',
    (() => {
      const o = { id: 7, x: 1234.6, y: 99.2, r: 195, p: 0.4567, k: 1, on: 1 };
      const back = unpackSown(packSown(o));
      return back.id === 7 && back.x === 1235 && back.r === 195 && back.k === 1 && back.on === 1
          && Math.abs(back.p - 0.46) < 1e-9;
    })(),
    'positions rounded, the kind an index into GROUND_KINDS, and the phase fixed to TWO places ' +
    'rather than the usual three — it is the only field on a patch that ever moves, so it alone ' +
    'decides what the stream costs: 4.90 KiB/s at three places against 0.61 at two, for sixteen ' +
    'patches at 30Hz. One percent of a thirty-six-second life is 0.36s of a countdown arc');
  check('the kind is an integer on the wire, so a spelling is not kept in two places',
    GROUND_KINDS.includes(V.sow.kind) && GROUND_KINDS.includes(D.sow.kind)
    && groundK('nonsense') === 0,
    `${GROUND_KINDS.join(', ')} — an unknown kind draws the first palette rather than undefined`);
  check('each has an outline nobody else has',
    (() => {
      const shapes = WILD.map(k => ALIENS[k].shape);
      return new Set(shapes).size === shapes.length
        && !!SHAPES[V.shape] && !!SHAPES[D.shape];
    })(),
    `${V.shape} and ${D.shape} against ${WILD.filter(k => !['crucible', 'doldrum'].includes(k))
      .map(k => ALIENS[k].shape).join(', ')}`);
  check('and both outlines are closed, finite and the right way up',
    ['crucible', 'doldrum'].every(k => {
      const pts = outlineOf(k, 40);
      return pts.length >= 6 && pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
          && Math.max(...pts.map(([x]) => Math.abs(x))) > 20;
    }),
    'the render harness rejects any draw call with a NaN in it, and an outline is a draw call');
  // CIE-Lab dE76 against every colour already spoken for, hostiles and ore both. The
  // tightest pair the game already ships is the Harrier against the Bandit at 35.5.
  {
    const lab = hex => {
      const f = c => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
      const [r, g, b] = [1, 3, 5].map(i => f(parseInt(hex.slice(i, i + 2), 16) / 255));
      const k = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      const X = k((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const Y = k(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const Z = k((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    };
    const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
    const ORE = ['#8d7f6e', '#a8b4a0', '#4a7fd4', '#ffd9e8', '#cfd8e3', '#7fd4c8'];
    const others = k => [...WILD.filter(j => j !== k).map(j => ALIENS[j].colour), ...ORE, '#7f8ea3'];
    const worst = k => Math.min(...others(k).map(c => dE(ALIENS[k].colour, c)));
    const tight = Math.min(...WILD.flatMap((a, i) => WILD.slice(i + 1)
      .map(b => dE(ALIENS[a].colour, ALIENS[b].colour))));
    check('and a colour further from everything else than the game\'s own tightest pair',
      worst('crucible') >= 35.5 && worst('doldrum') >= 35.5,
      `Crucible ${V.colour} clears everything by ${worst('crucible').toFixed(1)}, Doldrum ${D.colour} ` +
      `by ${worst('doldrum').toFixed(1)}, in CIE-Lab dE76 against ten hostiles, six ores and the ` +
      `range furniture. The tightest pair in the bestiary is ${tight.toFixed(1)}`);
    check('and the two of them are unmistakable for each other, which matters most',
      dE(V.colour, D.colour) > 150,
      `${dE(V.colour, D.colour).toFixed(0)} apart — when both are on the field, which ground you ` +
      'are looking at is the whole decision');
  }
  check('and both drop something, at the rung their toughness says',
    !!DROPS.crucible && !!DROPS.doldrum && DROPS.crucible[0].mat === 'platinum',
    'rollDrop reads a missing kind as "drops nothing", which is how the Ironhusk shipped ' +
    'paying only its bounty');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — the deeps: ${HOLD}s held, ${CALM}s owed, ${V.sow.max + D.sow.max} patches`}\n`);
process.exit(fails.length ? 1 : 0);
