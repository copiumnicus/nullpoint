// Guns.
//
// A shot is not hitscan. It is aimed at where the target will be if it keeps doing
// what it is doing, then travels — so holding a straight line gets you hit, and
// changing course mid-flight is a real dodge rather than a stat check.

import { applyDamage, SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';
import { droneAt } from './formation.js';
import { EQUIPMENT } from './gear.js';

// Bolt speed is a balance dial, not a cosmetic one. A shot has to be slow enough
// that a ship can accelerate clear of where it was aimed: displacement goes with
// t², so at 1900px/s a hard weave moved only ~30px inside a 54px window and
// nothing could dodge anything. At 1000 the same weave clears it comfortably, and
// long shots are easier to dodge than point-blank ones, which is the right shape.
export const BOLT_SPEED = 1000;   // px/s
export const HIT_R      = 38;     // px of slack around the aim point, plus the hull's own radius

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
  (a.drones ?? []).forEach((item, i) => {
    if (EQUIPMENT[item]?.slot === 'weapon') out.push(droneAt(a, i));
  });
  return out;
}

// Advances this ship's guns. Returns the bolts released this tick — none, one,
// or a pair once the rack is big enough to double up.
export function fire(a, b, dt) {
  a.cool = Math.max(0, a.cool - dt);
  a.shotFlash = Math.max(0, a.shotFlash - dt);

  const guns = Math.max(1, a.guns ?? 1);
  const live = b && b.hp > 0 && a.hp > 0 &&
               Math.hypot(b.x - a.x, b.y - a.y) <= a.stats.weaponRange;

  if (a.volley > 0) {                              // mid-stream
    if (!live) { a.volley = 0; return []; }        // target gone or out of reach: hold fire
    a.volleyCool -= dt;
    if (a.volleyCool > 0) return [];
  } else {
    if (!live || a.cool > 0) return [];
    a.cool = 1 / a.stats.fireRate;                 // a fresh cycle
    a.volley = guns;
  }

  const salvo = Math.min(a.volley, salvoOf(guns));
  a.volley -= salvo;
  a.volleyCool = (1 / a.stats.fireRate) / stepsOf(guns);
  a.shotFlash = SHOT_FLASH;

  const each = (a.stats.damage * boostOf(a.power, 'weapons', a.stats)) / guns;
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
      ax: b.x + b.vx * travel, ay: b.y + b.vy * travel,   // lead, don't chase
      dmg: each, target: b, foe: !!a.isAlien, w: Math.min(4, guns),
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
    if (Math.hypot(tg.x - b.ax, tg.y - b.ay) > HIT_R + tg.r) continue;
    const split = applyDamage(tg, b.dmg);        // how much the shields caught vs the hull
    hits.push({ bolt: b, target: tg, dead: tg.hp <= 0, split });
  }
  return hits;
}

// A ship under orders to shoot something looks at it, however it happens to be
// moving — strafing, backing off or running past.
export function faceTarget(a, b) {
  if (b) a.heading = Math.atan2(b.y - a.y, b.x - a.x);
}
