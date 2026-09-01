// Guns.
//
// A shot is not hitscan. It is aimed at where the target will be if it keeps doing
// what it is doing, then travels — so holding a straight line gets you hit, and
// changing course mid-flight is a real dodge rather than a stat check.

import { applyDamage, SHOT_FLASH, rangeOf, rateOf } from './sim.js';
import { boostOf } from './power.js';
import { droneAt } from './formation.js';
import { EQUIPMENT } from './gear.js';
// An answering ring turns part of what lands on a hardened plate. It is applied here
// rather than inside applyDamage() because THE BEARING IS THE THING, and this is the
// one place that knows where a bolt came from. softAt() returns 1 for everything
// without plates, which is everything but one hostile.
import { softAt } from './plates.js';

// Bolt speed is a balance dial, not a cosmetic one. A shot has to be slow enough
// that a ship can accelerate clear of where it was aimed: displacement goes with
// t², so at 1900px/s a hard weave moved only ~30px inside a 54px window and
// nothing could dodge anything. At 1000 the same weave clears it comfortably, and
// long shots are easier to dodge than point-blank ones, which is the right shape.
export const BOLT_SPEED = 1000;   // px/s
export const HIT_R      = 38;     // px of slack around the aim point, plus the hull's own radius

// How fat a bolt is drawn, from the damage it carries. Quality thickens the
// projectile; quantity adds more of them. A rack of four MK-Is throws four
// ordinary bolts, four MK-IIIs four heavy ones — which is the difference you
// actually paid for, and it reads without staring at the barrels.
// Square-rooted, because the ladder spans roughly 40 to 400 damage a bolt and a
// linear scale would peg everything above MK-II at the same fat line.
export const boltWidth = dmg => Math.max(1.5, Math.min(7.5, 1.2 + Math.sqrt(Math.max(0, dmg ?? 45)) * 0.28));

// Every emitter is its own gun and fires its own bolt, one after another rather
// than merged into a single fat shot. A cycle's damage is split across them, so
// more emitters means a longer, heavier stream and not a bigger blob.
//
// Past four they double up, because eight bolts strung across one cycle would
// arrive slower than one gun does — the cadence has to stay a cadence.
export const MAX_VOLLEY_STEPS = 4;
export const salvoOf = guns => Math.ceil(Math.max(1, guns) / MAX_VOLLEY_STEPS);
export const stepsOf = guns => Math.ceil(Math.max(1, guns) / salvoOf(guns));

// Cooldown runs whether or not there is anything to shoot at. Returns a bolt, or null.
// Every place a bolt can leave from: the two hull cannons, plus any drone that is
// actually carrying an emitter. A drone with a generator on it is not a gun.
export function hardpoints(a) {
  if (a.isAlien) return [{ x: a.x, y: a.y }];
  const c = Math.cos(a.heading), sn = Math.sin(a.heading);
  const mount = lat => ({ x: a.x + c * a.r * 1.55 - sn * lat, y: a.y + sn * a.r * 1.55 + c * lat });
  const out = [mount(-a.r * 0.95), mount(a.r * 0.95)];
  // Only the bays this hull berths. A ship carrying more than it can fly still
  // owns them (see berthed() in ships.js), but a bolt must not leave a drone the
  // pilot cannot see.
  (a.drones ?? []).slice(0, a.bays ?? Infinity).forEach((item, i) => {
    if (EQUIPMENT[item]?.slot === 'weapon') out.push(droneAt(a, i));
  });
  return out;
}

// Advances this ship's guns. Returns the bolts released this tick — none, one,
// or a pair once the rack is big enough to double up.
// `mag` is the magazine feeding this rack, or null for anything that does not
// carry ammunition — aliens shoot forever, which is their whole advantage.
export function fire(a, b, dt, mag = null) {
  a.cool = Math.max(0, a.cool - dt);
  a.shotFlash = Math.max(0, a.shotFlash - dt);

  const guns = Math.max(1, a.guns ?? 1);
  const dry = mag ? mag.n <= 0 : false;
  // The magazine decides how far this gun reaches, not just how hard it hits: a
  // grade that buys distance is loaded per weapon, so the guns and the racks can
  // be holding two different reaches at once. Passing `mag` here and nowhere else
  // is what keeps them separate.
  const live = !dry && b && b.hp > 0 && a.hp > 0 &&
               Math.hypot(b.x - a.x, b.y - a.y) <= rangeOf(a, mag);

  // The hull's own rate, not the resolved stat: a Vanguard running Drumfire cycles
  // faster than its fireRate says. Read ONCE and used for both clocks below — the
  // cycle and the step between barrels are the same cadence, and speeding one up
  // without the other would stretch a volley past the cycle that owns it.
  const rate = rateOf(a);

  if (a.volley > 0) {                              // mid-stream
    if (!live) { a.volley = 0; return []; }        // target gone or out of reach: hold fire
    a.volleyCool -= dt;
    if (a.volleyCool > 0) return [];
  } else {
    if (!live || a.cool > 0) return [];
    a.cool = 1 / rate;                             // a fresh cycle
    a.volley = guns;
  }

  // A rack fires as many barrels as it has rounds for, and stops mid-stream when
  // the last one goes — you do not get a free half-volley out of an empty bay.
  const salvo = Math.min(a.volley, salvoOf(guns), mag ? mag.n : Infinity);
  if (!salvo) { a.volley = 0; return []; }
  a.volley -= salvo;
  if (mag) mag.n -= salvo;
  a.volleyCool = (1 / rate) / stepsOf(guns);
  a.shotFlash = SHOT_FLASH;
  a.sinceShot = 0;                                 // and there goes the veil

  const each = (a.stats.damage * boostOf(a.power, 'weapons', a.stats) * (mag?.mult ?? 1)) / guns;
  const mounts = hardpoints(a);
  const out = [];
  for (let i = 0; i < salvo; i++) {
    // Work around the mounts in turn, so a volley visibly comes from the whole
    // formation rather than always from the same barrel.
    const m = mounts[(a.muzzle ?? 0) % mounts.length];
    a.muzzle = ((a.muzzle ?? 0) + 1) % mounts.length;
    const travel = Math.hypot(b.x - m.x, b.y - m.y) / BOLT_SPEED;
    out.push({
      sx: m.x, sy: m.y,
      // Where the SHIP was, as well as where the barrel was. They are not the same
      // point and an Antiphon's ring needs the first: `sx,sy` is a muzzle, and a
      // muzzle is a drone up to 200px off your flank. Measured on the bench, aiming
      // the ring's answer at the muzzle sent 53% of them at empty space beside a
      // pilot who had never moved — a whole plate's width of error at the range this
      // fight is fought from, and it made standing still LOOK like the counter.
      // Server-side only: packBolt names its eight fields, so this costs no wire.
      ox: a.x, oy: a.y,
      ax: b.x + b.vx * travel, ay: b.y + b.vy * travel,   // lead, don't chase
      dmg: each, target: b, foe: !!a.isAlien, w: Math.round(each), gr: mag?.tier ?? 0,
      t: travel, ttl: Math.max(0.001, travel),
    });
  }
  return out;
}

// Advances every bolt and settles the ones that land this tick. Returns the hits,
// each carrying its bolt — so the caller can see who fired the killing shot.
export function stepBolts(list, dt) {
  const hits = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.t -= dt;
    if (b.t > 0) continue;
    list.splice(i, 1);
    const tg = b.target;
    if (!tg || tg.hp <= 0) continue;
    // `slack` is per bolt, defaulting to HIT_R. HIT_R is the slack on an AIMED shot,
    // where the aim point already led the target; an Antiphon's discharge is not
    // aimed at anybody — it goes down the bearing its plate was struck from — so how
    // far off that line you have got by the time it arrives is the entire mechanic,
    // and the width of the answer is the unit a pilot has to beat. Nothing else in
    // the game sets it, so nothing else changes.
    if (Math.hypot(tg.x - b.ax, tg.y - b.ay) > (b.slack ?? HIT_R) + tg.r) continue;
    // Which way it arrived from, taken once here and handed on. Two different things
    // want it — the plate that turns part of the hit, and the same plate hardening
    // from it — and working it out twice in two files is exactly the rule kept in two
    // places that shared/ exists to prevent.
    //
    // The BEARING picks the plate; the PLACE is what that plate answers back down, and
    // it has to be both, because the hostile moves in the second between being hit and
    // answering. See newRing() in shared/plates.js for the measurement that cost.
    const fx = b.ox ?? b.sx, fy = b.oy ?? b.sy;
    const from = { a: Math.atan2(fy - tg.y, fx - tg.x), x: fx, y: fy };
    const split = applyDamage(tg, b.dmg * softAt(tg, from.a));   // shields vs hull, after the plate
    // `raw` is what ARRIVED, before the plate turned any of it, because that is what
    // hardens the plate. Charging off what got through instead would make a hot plate
    // stop heating — a self-limiting armour that rewards the one pilot the ring
    // exists to punish. It equals the split for everything without plates, since
    // applyDamage splits an amount rather than clamping it.
    hits.push({ bolt: b, target: tg, dead: tg.hp <= 0, split, from, raw: b.dmg });
  }
  return hits;
}

// A ship under orders to shoot something looks at it, however it happens to be
// moving — strafing, backing off or running past.
export function faceTarget(a, b) {
  if (b) a.heading = Math.atan2(b.y - a.y, b.x - a.x);
}
