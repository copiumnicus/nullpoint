// Orbs. The second kind of projectile, and the first one in this game you beat by
// not standing somewhere.
//
// A bolt is aimed at where you WILL be and then resolved once, at its destination:
// stepBolts counts `ttl` down and asks, on the tick it lands, whether the target is
// still inside `HIT_R + r` of the aim point. That is dodging by outrunning a
// prediction, and measured against the Ironhusk it is very nearly not dodging at all:
// a Hauler holding station took 99% of what it fired, and a laden Bulwark — the hull
// the claim bench flies — took 94% while weaving hard enough to reverse three times a
// second. At 500px a bolt arrives in half a second, and 50px of slack is more than
// most hulls move in half a second while under thrust.
//
// An orb is a body. It has a place every tick, it hits whatever it passes THROUGH on
// the way, and it crawls. Same hostile, same policies, same bench:
//
//                             bolt          orb
//     holding station      71.0 dps      71.0 dps      the book number, both ways
//     weaving, Hauler      40.0          2.0
//     weaving, Bulwark     68.0         12.4
//
// That is the whole feature in one table. What a pilot who does not read it takes has
// not moved by a decimal place — so threatDps, the bounty, the bestiary report and
// three claim rosters are all the numbers they already were — and what a pilot who
// does read it takes has fallen through the floor.
//
// WHY THE COLLISION IS RESOLVED CONTINUOUSLY AND NOT ON ARRIVAL, which is the
// question the shape of this file turns on. A slow orb that only checks its endpoint
// can be flown straight through, which will feel broken the first time it happens.
// So it is tested every tick — and the cheap test is already the continuous one,
// because of the speed:
//
//     ORB_SPEED / 30Hz  =  13px of travel per tick
//     smallest hit disc =  44px orb + 10px hull  =  54px
//
// An orb cannot step over a ship it would have crossed, so a point-in-disc test per
// tick IS the swept test, and the sweep buys nothing. Priced at the worst crowd the
// game produces — a deep claim, twelve Ironhusks and a Leviathan, around fifty orbs
// in the air against eight bodies — that is 18,000 hypots a second, which does not
// show up against the 30Hz tick: the whole claim bench simulates 900 seconds of it in
// 1.9s of wall clock, the same 1.8s it took before orbs existed.
//
// THE SEAM IS THE ASSERTION IN test/orbs.mjs: if ORB_SPEED ever rises past a hit
// radius per tick, the point test starts letting ships through, and the segment form
// — distance from the hull to the segment P -> P + V·dt — is what replaces it. The
// test fails first, by name.

import { applyDamage, SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';
// An answering ring turns part of what lands on a hardened plate — see stepBolts in
// combat.js, which does the same thing for the same reason. Returns 1 for everything
// without plates, which is everything but one hostile.
import { softAt } from './plates.js';

// --- how slow is slow ---------------------------------------------------------
//
// DERIVED, and it is pinned from BOTH ends, which the first draft was not.
//
// The ceiling is the dodge. A pattern is dodgeable when a pilot can cross out of it
// before it arrives, from the range the hostile actually fires at, with time to read
// the thing first:
//
//     v · (d / S − READ_TIME)  ≥  half-width(d) + orb r + hull r
//
// An Ironhusk reaches 500 and closes, so it fires from about 400; its cone is
// 0.20rad, so half-width(400) is 40px, and the disc is 44 + 12 for a Hauler:
//
//     300 · (400 / S − 0.35)  ≥  96      →     S ≤ 585 px/s
//
// The FLOOR is the one that was missed, and it cost a whole design pass. An orb
// cannot intercept anything moving faster than it is: the aim solve below diverges,
// and a hostile with a weapon that cannot reach a pilot holding a straight course is
// not a weapon, it is a light show. Measured at S = 300, which is exactly a Hauler's
// speed: an Ironhusk put 0.4 dps into an orbiting Hauler — 1% of what it threw — and
// the twelve of them in a claim went from taking 89% of the pilot's ship to 36%.
//
//     S  >  every hull that can be caught  =  250 Bulwark, 300 Hauler, 340 Vanguard
//
// 400, then. It catches everything but a Kestrel at a full 430px/s sprint, and a
// Kestrel sprinting away from something that reaches 500 has left the fight rather
// than won it. Two fifths of a bolt's 1000 and under a rocket's 520, which is what
// "slow, like in a roguelike" comes to in px/s: 1.0s in the air at an Ironhusk's
// range, 1.9s at the 750 a Leviathan throws from, and 13px of travel a tick.
//
// Read the dodge inequality the other way and it says what the pattern costs the
// people it is for. At 400px a Hauler needs 96px of lateral room and has 195px of
// it; a bare Bulwark has 162; a LADEN Bulwark at 128px/s has 83 and does not clear
// the cone at all — it only clears it out at 500, at arm's length. That is the
// Ironhusk's existing lesson, that its reach is 500 and holding your own range costs
// it everything, restated as something you can watch coming at you.
export const ORB_SPEED = 400;    // px/s
export const READ_TIME = 0.35;   // s a pilot is assumed to need before they move

// A pattern, read off the hostile's definition. Data, so the third one is a line in
// aliens.js rather than a change here.
//
//   n     slots in the fan
//   arc   how wide the fan is, radians, tip to tip
//   r     px, and it is BOTH the collision radius and the drawn radius. It goes on
//         the wire for that reason: a ball you can see and cannot be hit by is the
//         same bug as a row you can see and cannot click, and this codebase has
//         shipped that one twice.
//   burst how many clusters one trigger throws, a `beat` apart. 1 for a single
//         cluster. Each one is aimed afresh, so a burst covers where you are GOING
//         over the next second rather than a width across it.
//   beat  seconds between the clusters of a burst.
export const orbsOf = def => def?.orbs ?? null;

// How many orbs one trigger puts in the air, all clusters counted.
export const orbCount = o => Math.max(1, o.n) * Math.max(1, o.burst ?? 1);

// The slots, as angular offsets from the aim line. Exported because the test asserts
// on the geometry directly rather than on where the orbs ended up.
//
// WHY THERE IS NO HOLE IN THIS, which was the first design and is the measurement
// worth keeping. A wall with a gap you fly through is a lovely read and it is
// unaffordable, because the two halves of it pull against each other in px:
//
//   a hole is flyable when   (gap+1) x spacing - 2 x (orb r + hull r)  >  a hull
//   a volley lands when       spacing  <  orb r + hull r
//
// The first wants the slots far apart and the second wants them close, and at the
// Leviathan's 630px standoff there is no spacing that does both. Measured through the
// real AI loop against the pilot the claim bench flies — a laden Bulwark at 128px/s —
// over the whole family: a wall whose hole a Bulwark actually fits through delivers
// 23 dps of a 118 dps hostile, 19%, and one that delivers 51% has a hole 45px NARROWER
// than nothing, which is a decoration rather than a mechanic. Paying for the first
// would need the Leviathan's damage at five times what it is, and the balance model
// has 5% of headroom: shared/balance.js reads it at 0.85 of the dps its stage asks
// for against a ceiling of 0.9 that test/balance.mjs enforces.
//
// So the second pattern is a BURST instead — see the note on `burst` above. Each
// cluster is tight, so the ceiling stays reachable and threatDps stays honest.
export function orbSlots(o) {
  const out = [];
  const half = (o.n - 1) / 2;
  for (let i = 0; i < o.n; i++)
    out.push(half === 0 ? 0 : ((i - half) / half) * (o.arc / 2));
  return out;
}

// Advances this hostile's launcher and returns the orbs released this tick.
//
// It LEADS, the same way fire() does and for the same reason: a pattern aimed at
// where you are rather than at where you are going is beaten by holding any course
// at all, which is not a dodge, it is a walk. Aimed at the lead point, holding a
// course puts you in the middle of the fan and CHANGING one takes you out of it —
// which is the difference between this and a bolt stated as a rule.
//
// `a.cool` is the same clock fire() uses, deliberately: a hostile has one trigger
// and threatDps reads `damage x fireRate` off the definition whichever weapon is on
// the end of it. See the note on the ceiling below.
export function throwOrbs(a, b, dt) {
  const o = orbsOf(a.def);
  // Nothing at all for a hostile that has no pattern, and the clock is not touched
  // on the way out. Decrementing it first ran every OTHER hostile's gun at twice its
  // rate: server.js and the bench both call fire() and this in the same tick, so a
  // Drifter's 0.8 cycles a second became 1.58 and the bench read an Ironhusk's bolt
  // at 142 dps against a book of 72. Measured, not guessed — it is why this early
  // return is the first line and not the second.
  if (!o) return [];
  a.cool = Math.max(0, a.cool - dt);
  // And the muzzle glow. combat.js owns the only other copy of this line and it sits
  // BELOW the gate that sends an orb-thrower home, so a hostile whose barrel became a
  // fan held a full flash for ever — an Ironhusk and a Leviathan have been glowing
  // since the day the orbs landed, at every range, whether or not they had anybody.
  // stepLob named it and fixed its own two; this is the pair it could not reach.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  const reach = a.stats.weaponRange ?? 0;
  const live = b && b.hp > 0 && a.hp > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= reach;
  // The burst runs on its own beat inside the cycle the cadence owns, which is the
  // same two-clock shape fire() uses for a rack of emitters and it is here for the
  // same reason: the cluster has to be a cluster, and the cycle has to stay the cycle
  // threatDps reads. Mid-burst it holds fire the moment the target is gone, so a
  // hostile cannot keep walking a barrage at somebody who has jumped out.
  if (a.orbLeft > 0) {
    if (!live) { a.orbLeft = 0; return []; }
    a.orbBeat -= dt;
    if (a.orbBeat > 0) return [];
  } else {
    if (!live || a.cool > 0) return [];
    a.cool = 1 / Math.max(0.01, a.stats.fireRate ?? 1);
    a.orbLeft = Math.max(1, o.burst ?? 1);
  }
  a.orbLeft--;
  a.orbBeat = o.beat ?? 0;

  const slots = orbSlots(o);
  // THE CEILING, and it is the same claim threatDps makes for a mirror's chamber and
  // an answering ring: `damage x fireRate` is what the whole volley does if all of it
  // lands, and all of it CAN land — point blank, where the fan is narrower than a
  // hull. Split evenly across what left the barrel, so the number in the threat file
  // and the number in the bestiary report stay the ones already there and nothing
  // downstream has to be re-derived. What a pilot who reads the pattern actually
  // takes is a fraction of it, and that fraction is the hostile.
  const each = (a.stats.damage * boostOf(a.power, 'weapons', a.stats)) / orbCount(o);
  // THE INTERCEPT IS SOLVED, NOT ESTIMATED, and that is the difference between this
  // and fire(). A bolt takes `range / BOLT_SPEED` as its flight time and aims there;
  // at 1000px/s against a 300px/s hull the error that leaves is a few pixels inside
  // 50px of slack, so it has never mattered. At ORB_SPEED the target moves nearly as
  // fast as the projectile, and the error compounds: measured at 300px/s against a
  // Hauler doing the same, a pilot crossing 420px out is 420px along by the time the
  // first guess says the orb arrives, the lead point is then 594px away and takes two
  // seconds to reach, and the whole fan lands 174px behind them. Measured before it
  // was fixed — an orbiting Hauler took 0.4 dps of a 72 dps hostile, 1% of what was
  // thrown, which is not a dodge, it is a weapon that does not work.
  //
  // Three passes of `t = |target(t) - here| / ORB_SPEED` converge to well inside a
  // hull for anything slower than the orb, and CANNOT converge for anything faster —
  // which is correct rather than a limitation: a Kestrel at 430px/s outruns a 400px/s
  // orb and is entitled to. The clamp keeps a divergent solve inside the orb's own
  // life so it aims somewhere reachable instead of at the far wall.
  const reachT = Math.max(0.1, reach / ORB_SPEED);
  let travel = Math.hypot(b.x - a.x, b.y - a.y) / ORB_SPEED;
  for (let i = 0; i < 3; i++)
    travel = Math.min(reachT, Math.hypot(b.x + b.vx * travel - a.x, b.y + b.vy * travel - a.y) / ORB_SPEED);
  const lead = Math.atan2(b.y + b.vy * travel - a.y, b.x + b.vx * travel - a.x);
  a.shotFlash = SHOT_FLASH;   // one glow for the whole fan, not one per orb
  a.sinceShot = 0;

  return slots.map(off => {
    const h = lead + off;
    return {
      x: a.x, y: a.y, heading: h,
      vx: Math.cos(h) * ORB_SPEED, vy: Math.sin(h) * ORB_SPEED,
      r: o.r, dmg: each, foe: !!a.isAlien,
      // Sanctuary travels WITH the orb, by reference, exactly as a sown patch carries
      // its sower's set: a pattern is in the air for over two seconds at a Leviathan's
      // reach and the hostile that threw it may be dead by the time it arrives, but
      // who it was allowed to harm when it left is still the right answer.
      by: a.provoked,
      // Where it came FROM, kept whole rather than walked back from the impact the
      // way a rocket's is. An orb travels in a straight line and never turns, so the
      // muzzle is exactly the lever arm an Antiphon's ring wants and there is nothing
      // to reconstruct. Server-side only — packOrb names its five fields.
      ox: a.x, oy: a.y,
      // Its full reach and no further. An orb that outlived its own weapon range would
      // let a hostile hit you from somewhere it cannot shoot from, which is the one
      // thing a pilot holding range is entitled to rely on.
      t: reachT, ttl: reachT,
    };
  });
}

// Flies every orb one tick and settles whatever it went through.
//
// `bodies` is the same `[{ id, ship, haven }]` list stepAlienAI is handed, because
// the sanctuary predicate needs the id and the haven and nothing else in the game
// carries them together. `may` is that predicate, passed in rather than imported:
// shared/sim.js owns mayHarm and importing it here would be the second copy of
// "where is it safe to stand" that cost this codebase a day of a workshop dock that
// refused to sell anything.
//
// An orb is SPENT on the first thing it touches. It does not pierce — a wall that
// went through the pilot in front and killed the one behind would be splash damage
// with extra steps, and no weapon in this game has any. THE SEAM IS HERE: one line,
// drop the `break`, and the number that would justify it is a wall that reads as
// unfair because it stopped on somebody's drone.
export function stepOrbs(list, bodies, dt, may = () => true) {
  const hits = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.t -= dt;
    // Collision BEFORE expiry, not after. An orb that runs out of reach on the same
    // tick it crosses a hull was still there when it crossed it, and settling the
    // clock first would drop it — one tick in thirty-seven of an Ironhusk's flight,
    // which is exactly the shot a pilot who backed off to the very edge would notice
    // going through them and doing nothing.
    let spent = false;
    for (const c of bodies) {
      const tg = c.ship ?? c;
      if (!tg || tg.hp <= 0) continue;
      if (Math.hypot(tg.x - b.x, tg.y - b.y) > b.r + tg.r) continue;
      if (!may(b, c)) continue;
      list.splice(i, 1);
      // Which way it arrived from, taken once here and handed on — the plate that
      // turns part of the hit and the same plate hardening from it both want it. Same
      // two uses stepBolts has, and the same reason it is worked out in one place.
      const from = { a: Math.atan2(b.oy - tg.y, b.ox - tg.x), x: b.ox, y: b.oy };
      const split = applyDamage(tg, b.dmg * softAt(tg, from.a));
      // `raw` is what ARRIVED, before any plate turned it, because that is what
      // hardens the plate. See stepBolts for the measurement that cost.
      hits.push({ orb: b, target: tg, who: c.id ?? null, dead: tg.hp <= 0, split, from, raw: b.dmg });
      spent = true;
      break;
    }
    if (!spent && b.t <= 0) list.splice(i, 1);
  }
  return hits;
}
