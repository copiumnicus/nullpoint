// WHAT A MIRROR THROWS BACK, and it is your own hull coming apart at you.
//
// The chamber is the whole of a Thresher: it fills with what you deal it, it bleeds on
// a half-life, and its next volley carries `payloadOf(def, load)` — a number that spans
// 80 at an empty chamber and 11,387 at a full one, entirely because of what the pilot
// in front of it chose to buy. That mechanic is not in question and nothing here touches
// its arithmetic.
//
// WHAT WAS IN QUESTION IS WHAT IT ARRIVES AS. It was one fat bolt, then it was seven
// bolts, and seven bolts is not a conversion — it is more lasers. Both drafts resolved
// at a point they had been aimed at, which is the thing this whole rework exists to get
// rid of: the table at the top of orbs.js measures 94% of what an aimed bolt fires
// landing on a hull weaving as hard as it can, so a wall of them is a wall you eat
// rather than a wall you read.
//
// SO A SHARD IS A BODY. It has a place every tick, it hits whatever it passes through on
// the way, and it crawls — orbs.js's three sentences, because they are the right three.
// And it is DEBRIS rather than fire, which is the fiction doing the work: what a mirror
// returns is the damage you just dealt it, so what comes back is the stuff that came off
// it. It tumbles, it is dull grey-white rather than lit, and at 584 px/s you can watch a
// full wall of seven for a whole second and pick which gap you are going through.
//
// THE IDENTITY SURVIVES, AND IT IS THE WHOLE POINT OF SPLITTING RATHER THAN ADDING. A
// volley carries `payloadOf(def, load)` in total, split evenly across whatever left the
// hull — the same sentence orbs.js writes about a fan and combat.js writes about a rack.
// So the total a whole fight returns is still
//
//      MIRROR.dps / (MIRROR.soak x ln2 / MIRROR.half)  =  181,244 points
//
// whatever you fly, threatDps still reads 11,387, and the bounty, the experience, the
// bestiary report and the balance model are every one of them the numbers they already
// were. Measured through the real loop against an indestructible reader across a 151x
// span of player gun, the five totals are the same five they were as bolts.

import { boostOf } from './power.js';
import { SHOT_FLASH } from './sim.js';

// The whole of a spread on a definition is `def.shards`, exactly the way `def.orbs` is
// the whole of a fan and `def.sweep` the whole of a swing. A second hostile that
// splinters is a block of data in aliens.js. THAT IS THE SEAM, and its name is `shards`.
export const shardsOf = def => def?.shards ?? null;

// --- how slow is slow, and how big ------------------------------------------------
//
// HOW BIG IS THE ONE THAT IS CHOSEN, and it is chosen against the two things it has to
// be at once. 30px is under an Ironhusk's 44 and half a Leviathan's 60, because this is
// a splinter rather than a ball and a wall of seven 60s at the range this hostile fights
// from would be a solid bar with nothing to read; and it is over a hull's own radius, so
// a shard is a thing you can see coming rather than a speck. Everything below reads it.
export const SHARD_R = 30;

// HOW FAST, and it is DERIVED — the same derivation WAVE_SPEED uses, restated for a
// different hostile: the wall crosses from the hull to the range this thing stands off
// to in exactly ONE of its own firing cycles.
//
//     (standOff - r) / (1 / fireRate)  =  (0.7 x 900 - 46) / 1.0  =  584 px/s
//
// That is the readable end — a full second of wall in the air between the flash and the
// arrival — and it is also what keeps the volleys apart: one cycle of flight against a
// one-cycle cadence means the wall that is arriving is the wall that left last time, and
// there are never two overlapping.
//
// THE CEILING IS THE DODGE and it is the number that had to be checked rather than
// assumed. Clearing the whole wall means getting `fan x d + SHARD_R + hull r` off the
// middle of it — 40 + 30 + 17 = 87px for the hull this fight is for — and that hull
// flies at 128 px/s with 0.35s of it spent reading:
//
//     87 / 128 + 0.35  =  1.03s   against a 1.00s flight
//
// So a finished Bulwark cannot QUITE clear the whole wall in one flight, and can clear
// the middle of it — 47px, 0.72s — with a quarter of the flight to spare. That is
// exactly the shape this was for: you can always get off the centre, and getting off all
// of it costs you the whole second and a committed line.
//
// THE FLOOR is orbs.js's, and it is the measurement that cost that file a design pass: a
// projectile cannot intercept anything moving faster than it is, and a weapon that
// cannot reach a pilot holding a straight course is a light show. 584 is over every
// fitted hull in the game boosted (212 to 440) with 144 px/s to spare.
export const SHARD_SPEED = 584;   // px/s

// A pilot is assumed to need this long to read a wall before they move. The same 0.35s
// orbs.js, ground.js and sweep.js all use, restated rather than imported for ground.js's
// reason: two hostiles' worth of pattern should not be able to move each other's numbers
// by accident.
export const SHARD_READ = 0.35;   // s

// A pattern, read off the hostile's definition. Data, so the second hostile that
// splinters is a line in aliens.js rather than a change here — the same arrangement
// orbsOf() has, and the same reason.
//
//   n     shards at a FULL chamber. One at an empty one, always, whatever this says.
//   fan   half-width of the wall at a full chamber, in radians. Both derivations are on
//         the definition in aliens.js, beside the numbers they produced.
export const shardsN   = def => Math.max(1, shardsOf(def)?.n ?? 1);
export const shardsFan = def => Math.max(0, shardsOf(def)?.fan ?? 0);

// How many a chamber at this charge throws, and how wide it throws them. Both run from
// one shard at nothing to the full wall at a full chamber, LINEARLY, because the meter
// over its head is linear and a tell that accelerated away from the bar it is drawn
// beside would be two different readings of one number.
export const shardCount = (def, load) =>
  1 + Math.round(Math.max(0, Math.min(1, load || 0)) * (shardsN(def) - 1));
export const shardFan = (def, load) =>
  Math.max(0, Math.min(1, load || 0)) * shardsFan(def);

// The slots, as angular offsets from the aim line. Exported because the test asserts on
// the geometry directly rather than on where the shards ended up — the same shape
// orbSlots() has in orbs.js, and the same reason.
export function shardSlots(def, load) {
  const n = shardCount(def, load), spread = shardFan(def, load);
  const out = [];
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) out.push(half === 0 ? 0 : ((i - half) / half) * spread);
  return out;
}

// Advances this hostile's chamber and returns the shards it lets go this tick.
//
// `a.cool` is the same clock fire() uses and combat.js hands it over rather than sharing
// it — see the gate at the top of fire(). Decrementing it in both places ran every
// orb-thrower's gun at twice its rate the first time this was done, and the bench read
// an Ironhusk at 142 dps against a book of 72.
//
// THE PAYLOAD IS READ OFF THE LIVE DAMAGE STAT, which is what stepMirror has already
// written `payloadOf(def, load)` into. That indirection is not laziness — it is what
// lets the wire, the meter over its head and the floating damage number all keep
// agreeing without any of them knowing this file exists. `load` is read back off the
// hostile only to shape the wall, never to price it.
export function throwShards(a, b, dt) {
  const S = shardsOf(a?.def);
  if (!S) return [];
  a.cool = Math.max(0, a.cool - dt);
  // The muzzle glow, decayed here because this hostile no longer calls fire() at all.
  // combat.js owns the only other copy of this line and it sits BELOW the gate that
  // sends a splinterer home, so a hostile whose barrel became something else holds a
  // full flash for ever — a live bug on every orb-thrower until it was found. stepLob,
  // stepWave, stepSweep and stepPod all say the same thing.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  const reach = a.stats?.weaponRange ?? 0;
  const live = b && b.hp > 0 && a.hp > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= reach;
  if (!live || a.cool > 0) return [];
  a.cool = 1 / Math.max(0.01, a.stats?.fireRate ?? 1);

  const load = Math.max(0, Math.min(1, a.load ?? 0));
  const slots = shardSlots(a.def, load);
  // Split evenly across what left the hull, so the volley total is the payload and the
  // identity above is untouched. `a.stats.damage` is already the payload; the boost is
  // applied here exactly as fire() applies it, so a hostile with its reactor on its guns
  // one day gets the same treatment as everything else.
  const each = (a.stats.damage * boostOf(a.power, 'weapons', a.stats)) / slots.length;
  // THE INTERCEPT IS SOLVED, NOT ESTIMATED, and that is orbs.js's three passes for
  // orbs.js's reason: at this speed the target moves at up to three quarters of the
  // shard's own speed and a single guess lands a long way behind them. It CANNOT
  // converge on anything faster than the wall, which is correct rather than a limitation
  // — and the clamp keeps a divergent solve inside the shard's own life so it aims
  // somewhere reachable instead of at the far wall.
  const reachT = Math.max(0.1, reach / SHARD_SPEED);
  let travel = Math.hypot(b.x - a.x, b.y - a.y) / SHARD_SPEED;
  for (let i = 0; i < 3; i++)
    travel = Math.min(reachT, Math.hypot(b.x + b.vx * travel - a.x, b.y + b.vy * travel - a.y) / SHARD_SPEED);
  const lead = Math.atan2(b.y + b.vy * travel - a.y, b.x + b.vx * travel - a.x);
  a.shotFlash = SHOT_FLASH;                        // one glow for the whole wall
  a.sinceShot = 0;                                 // and there goes the veil

  return slots.map(off => {
    const h = lead + off;
    return {
      x: a.x, y: a.y, heading: h,
      vx: Math.cos(h) * SHARD_SPEED, vy: Math.sin(h) * SHARD_SPEED,
      r: SHARD_R, dmg: each, foe: !!a.isAlien,
      // Whose it is, so the client draws it in the colour of the thing that came apart.
      // Every projectile in this game carries one now; see kindIx() in shared/aliens.js.
      k: a.kx ?? 0,
      // Sanctuary travels WITH the shard, by reference, exactly as an orb's does: a wall
      // is in the air for a second and the mirror that threw it may be dead by the time
      // it arrives, but who it was allowed to harm when it left is still the right
      // answer.
      by: a.provoked,
      // Where it came FROM, kept whole rather than walked back from the impact — a shard
      // travels in a straight line and never turns, so the muzzle is exactly the lever
      // arm an answering ring wants and there is nothing to reconstruct. Server-side
      // only: packShard names its four fields.
      ox: a.x, oy: a.y,
      // Its full reach and no further, which is orbs.js's rule: a projectile that
      // outlived its own weapon range would let a hostile hit you from somewhere it
      // cannot shoot from.
      t: reachT, ttl: reachT,
    };
  });
}
