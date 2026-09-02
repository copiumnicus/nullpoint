// WHAT A MIRROR THROWS BACK, and it used to be one fat bolt.
//
// The chamber is the whole of a Thresher: it fills with what you deal it, it bleeds
// on a half-life, and its next shot carries `payloadOf(def, load)` — a number that
// spans 80 at an empty chamber and 11,387 at a full one, entirely because of what the
// pilot in front of it chose to buy. That mechanic is not in question and nothing here
// touches its arithmetic. What was in question is the SHAPE it arrived in.
//
// One bolt is not a shape. It is a bigger number, and a bigger number is only legible
// after it has landed on you — which is exactly the complaint that put a meter over
// the hostile's head in the first place. And it is not dodged by anybody: the table at
// the top of orbs.js measures 94% of what an aimed bolt fires landing on a hull
// weaving as hard as it can, so the one answer this fight has ever had was working in
// spite of the projectile rather than because of it.
//
// SO THE CHAMBER COMES BACK AS A WALL, AND HOW MUCH WALL IS HOW FULL IT IS. An empty
// chamber throws one splinter. A full one throws seven, fanned across 76px of sky at
// the range this thing fights from. The count and the width are the same number the
// meter is showing, made physical and arriving at you — so "stop shooting for a
// second" stops being advice in a threat file and becomes a thing you can watch get
// smaller.
//
// THE IDENTITY SURVIVES, AND IT IS THE WHOLE POINT OF SPLITTING RATHER THAN ADDING.
// A volley carries `payloadOf(def, load)` in total, split evenly across whatever left
// the barrel — the same sentence orbs.js writes about a fan and combat.js writes about
// a rack. So the total a whole fight returns is still
//
//      MIRROR.dps / (MIRROR.soak x ln2 / MIRROR.half)  =  181,244 points
//
// whatever you fly, threatDps still reads 11,387, and the bounty, the experience, the
// bestiary report and the balance model are every one of them the numbers they already
// were. Nothing downstream had to be re-derived, which is what a conversion is
// supposed to cost.
//
// WHAT IT COSTS A PILOT WHO MOVES, which is the half that is not free. The fan is
// aimed so that all of it lands on somebody who never moved — see FAN below, the width
// is one slack radius and not a pixel more — so holding station costs exactly what the
// single bolt cost, to the decimal. What changes is that clearing the whole wall now
// asks for twice the displacement clearing one bolt did, and a weave that only half
// clears it now half lands instead of missing outright. The chamber therefore does
// something it never did: it makes the DODGE harder as it fills, rather than only the
// hit bigger. test/aliens.mjs measures every line of play again with the wall in.

import { boostOf } from './power.js';
import { SHOT_FLASH } from './sim.js';

// The whole of a spread on a definition is `def.shards`, exactly the way `def.orbs` is
// the whole of a fan and `def.sweep` the whole of a swing. A second hostile that
// splinters is a block of data in aliens.js. THAT IS THE SEAM, and its name is
// `shards`.
export const shardsOf = def => def?.shards ?? null;

// A pattern, read off the hostile's definition. Data, so the second hostile that
// splinters is a line in aliens.js rather than a change here — the same arrangement
// orbsOf() has, and the same reason.
//
//   n     splinters at a FULL chamber. One at an empty one, always, whatever this says.
//   fan   half-width of the wall at a full chamber, in radians. Both derivations are on
//         the definition in aliens.js, beside the numbers they produced.
export const shardsN   = def => Math.max(1, shardsOf(def)?.n ?? 1);
export const shardsFan = def => Math.max(0, shardsOf(def)?.fan ?? 0);

// How many a chamber at this charge throws, and how wide it throws them. Both run from
// one splinter at nothing to the full wall at a full chamber, LINEARLY, because the
// meter over its head is linear and a tell that accelerated away from the bar it is
// drawn beside would be two different readings of one number.
export const shardCount = (def, load) =>
  1 + Math.round(Math.max(0, Math.min(1, load || 0)) * (shardsN(def) - 1));
export const shardFan = (def, load) =>
  Math.max(0, Math.min(1, load || 0)) * shardsFan(def);

// The slots, as angular offsets from the aim line. Exported because the test asserts on
// the geometry directly rather than on where the splinters ended up — the same shape
// orbSlots() has in orbs.js, and the same reason.
export function shardSlots(def, load) {
  const n = shardCount(def, load), spread = shardFan(def, load);
  const out = [];
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) out.push(half === 0 ? 0 : ((i - half) / half) * spread);
  return out;
}

// Advances this hostile's chamber-gun and returns the splinters released this tick.
//
// `a.cool` is the same clock fire() uses and combat.js hands it over rather than
// sharing it — see the gate at the top of fire(). Decrementing it in both places ran
// every orb-thrower's gun at twice its rate the first time this was done, and the
// bench read an Ironhusk at 142 dps against a book of 72.
//
// `boltSpeed` is passed in rather than imported, exactly as plates.js takes it for a
// ring's answer and for the same reason: combat.js owns BOLT_SPEED and combat.js
// imports this file, so reaching back for it is a cycle.
//
// THE PAYLOAD IS READ OFF THE LIVE DAMAGE STAT, which is what stepMirror has already
// written `payloadOf(def, load)` into. That indirection is not laziness — it is what
// lets the wire, the meter over its head and the floating damage number all keep
// agreeing without any of them knowing this file exists. `load` is read back off the
// hostile only to shape the fan, never to price it.
export function throwShards(a, b, dt, boltSpeed = 1000) {
  const S = shardsOf(a?.def);
  if (!S) return [];
  a.cool = Math.max(0, a.cool - dt);
  // The muzzle glow, decayed here because this hostile no longer calls fire() at all.
  // combat.js owns the only other copy of this line and it sits BELOW the gate that
  // sends a splinterer home, so a hostile whose barrel became something else holds a
  // full flash for ever — a live bug on every orb-thrower until it was found. stepLob,
  // stepWave and stepSweep all say the same thing.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  const reach = a.stats?.weaponRange ?? 0;
  const live = b && b.hp > 0 && a.hp > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= reach;
  if (!live || a.cool > 0) return [];
  a.cool = 1 / Math.max(0.01, a.stats?.fireRate ?? 1);

  const load = Math.max(0, Math.min(1, a.load ?? 0));
  const slots = shardSlots(a.def, load);
  // Split evenly across what left the barrel, so the volley total is the payload and
  // the identity above is untouched. `a.stats.damage` is already the payload; the boost
  // is applied here exactly as fire() applies it, so a hostile with its reactor on its
  // guns one day gets the same treatment as everything else.
  const each = (a.stats.damage * boostOf(a.power, 'weapons', a.stats)) / slots.length;
  // ONE PASS, not three, and that is fire()'s solve rather than orbs.js's. A splinter
  // travels at BOLT_SPEED — 1,000 px/s against a hull that flies at 128 — so the error
  // a single guess leaves is a few pixels inside 38 of slack. orbs.js iterates because
  // an orb moves at very nearly the speed of the thing it is chasing; this does not.
  const travel = Math.hypot(b.x - a.x, b.y - a.y) / boltSpeed;
  const lx = b.x + b.vx * travel - a.x, ly = b.y + b.vy * travel - a.y;
  a.shotFlash = SHOT_FLASH;                        // one glow for the whole wall
  a.sinceShot = 0;                                 // and there goes the veil

  return slots.map(off => {
    // The aim point is the LEAD point rotated about the muzzle, not a point on a chord
    // — so every splinter in the wall flies exactly as far as every other one and the
    // whole volley arrives together. A fan built by offsetting the endpoints sideways
    // would put the outer pair further away and land them a frame late, which reads as
    // the wall arriving crooked.
    const c = Math.cos(off), s = Math.sin(off);
    return {
      sx: a.x, sy: a.y,
      // Where the SHIP was, as well as where the barrel was — combat.js's ox/oy, for an
      // answering ring's lever arm. On an alien they are the same point, and it is set
      // anyway so a splinter is the same shape of object as every other bolt in the
      // list. Server-side only: packBolt names its eight fields.
      ox: a.x, oy: a.y,
      ax: a.x + lx * c - ly * s, ay: a.y + lx * s + ly * c,
      dmg: each, target: b, foe: !!a.isAlien, w: Math.round(each), gr: 0,
      t: travel, ttl: Math.max(0.001, travel),
    };
  });
}
