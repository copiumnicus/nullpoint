// Guns.
//
// A shot is not hitscan. It is aimed at where the target will be if it keeps doing
// what it is doing, then travels — so holding a straight line gets you hit, and
// changing course mid-flight is a real dodge rather than a stat check.

import { applyDamage, SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';

// Bolt speed is a balance dial, not a cosmetic one. A shot has to be slow enough
// that a ship can accelerate clear of where it was aimed: displacement goes with
// t², so at 1900px/s a hard weave moved only ~30px inside a 54px window and
// nothing could dodge anything. At 1000 the same weave clears it comfortably, and
// long shots are easier to dodge than point-blank ones, which is the right shape.
export const BOLT_SPEED = 1000;   // px/s
export const HIT_R      = 38;     // px of slack around the aim point, plus the hull's own radius

// Cooldown runs whether or not there is anything to shoot at. Returns a bolt, or null.
export function fire(a, b, dt) {
  a.cool = Math.max(0, a.cool - dt);
  a.shotFlash = Math.max(0, a.shotFlash - dt);
  if (!b || b.hp <= 0 || a.hp <= 0) return null;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d > a.stats.weaponRange || a.cool > 0) return null;
  a.cool = 1 / a.stats.fireRate;
  a.shotFlash = SHOT_FLASH;

  // Ships carry a cannon on each side and alternate between them, so fire comes
  // from a hardpoint rather than from the middle of the hull. Aliens have no
  // visible mounts, so they shoot from centre.
  const side = a.muzzle ? 1 : -1;
  a.muzzle = a.muzzle ? 0 : 1;
  const ch = Math.cos(a.heading), sh = Math.sin(a.heading);
  const fwd = a.isAlien ? 0 : a.r * 1.55, lat = a.isAlien ? 0 : a.r * 0.95 * side;

  const travel = d / BOLT_SPEED;
  return {
    sx: a.x + ch * fwd - sh * lat, sy: a.y + sh * fwd + ch * lat,
    ax: b.x + b.vx * travel, ay: b.y + b.vy * travel,   // lead, don't chase
    dmg: a.stats.damage * boostOf(a.power, 'weapons', a.stats), target: b, foe: !!a.isAlien,
    w: a.guns ?? 1,                                   // a thicker beam for more emitters
    t: travel, ttl: Math.max(0.001, travel),
  };
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
