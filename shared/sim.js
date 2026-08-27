// The authoritative simulation. Runs on the server; the client imports the same
// file so the two can never drift. Pure, deterministic, no I/O, no wall-clock.

import { MAP_W, MAP_H, PORTAL_R } from './maps.js';
import { resolve, radiusOf, DEFAULT_HULL } from './ships.js';

// The charted zone is 0..MAP_W / 0..MAP_H — exactly what the minimap draws. Space
// keeps going past it, but only the lattice of navigation beacons inside that
// rectangle gives a ship the positional reference its compensators need. Outside,
// nothing nulls the gravitational shear between the sector's mass concentrations
// and the hull wears it directly, harder the further out you push.
export const DRIFT_MARGIN = 1800;   // px  how far past the edge you can physically get
export const DRIFT_MIN    = 45;     // hull/s the instant you cross the line
export const DRIFT_MAX    = 2000;   // hull/s out at the hard limit — steep enough that no
                                    // hull, on any fit, survives to actually touch the border
export const WORLD = { x0: -DRIFT_MARGIN, y0: -DRIFT_MARGIN,
                       x1: MAP_W + DRIFT_MARGIN, y1: MAP_H + DRIFT_MARGIN };

export const driftDepth = (x, y) => Math.max(0, -x, x - MAP_W, -y, y - MAP_H);
export function driftDps(depth) {
  if (depth <= 0) return 0;
  const t = Math.min(1, depth / DRIFT_MARGIN);
  return DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * t * t;
}

export const SLOW_RADIUS = 90;    // px  ease off inside this range
export const ARRIVE       = 5;    // px  close enough, stop
export const JUMP_TIME    = 3.0;  // s   portal spool-up once you commit
export const SHIELD_FLASH = 0.45; // s   how long an impact bubble stays lit

// Speed, thrust, hull and shield all come from the fit — never from a constant
// here — so a module can change any of them.
// Anything that moves and can be shot. Players and aliens share it, so they share
// step(), stepVitals(), applyDamage() and stepDrift() with no special cases.
export function newBody(x, y, stats, r) {
  return {
    x, y, vx: 0, vy: 0, heading: 0, stats, r,
    hp: stats.hull, shield: stats.shield, sinceHit: 1e9, shieldHit: 0,
    cool: 0, shotFlash: 0,
    jumpCd: 0, charge: 0, chargeTo: null,
    tx: null, ty: null,      // click-to-move destination
    dx: null, dy: null,      // hold-to-steer thrust vector (magnitude 0..1)
  };
}

export function newShip(x = MAP_W / 2, y = MAP_H / 2, hull = DEFAULT_HULL, fit = []) {
  const s = newBody(x, y, resolve(hull, fit), radiusOf(hull));
  s.hull = hull; s.fit = fit;
  return s;
}

// Re-fit in place. Vitals are restored, so this must only be allowed somewhere
// safe — swapping to a tanky hull mid-fight would otherwise be free.
export function refit(s, hull, fit) {
  s.hull = hull; s.fit = fit;
  s.stats = resolve(hull, fit);
  s.r = radiusOf(hull);
  s.hp = s.stats.hull;
  s.shield = s.stats.shield;
  s.sinceHit = 1e9;
  s.shieldHit = 0;
  s.cool = 0; s.shotFlash = 0;
  return s;
}

// Two distinct intents, because they are genuinely different orders:
//   tap       -> a DESTINATION. Fly there, arrive, stop.
//   hold+drag -> a DIRECTION. Thrust that way for as long as it's held.
export function step(s, dt) {
  if (s.jumpCd > 0) s.jumpCd -= dt;
  const { speed: MAX, accel: ACC } = s.stats;

  let wantVx = 0, wantVy = 0;
  if (s.dx !== null) {
    wantVx = s.dx * MAX;                // magnitude carries throttle, so pointing
    wantVy = s.dy * MAX;                // close to the ship gives fine control
  } else if (s.tx !== null) {
    const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
    if (d < ARRIVE) {
      s.tx = s.ty = null;
    } else {
      const v = MAX * Math.min(1, d / SLOW_RADIUS);
      wantVx = (dx / d) * v;
      wantVy = (dy / d) * v;
    }
  }

  const ex = wantVx - s.vx, ey = wantVy - s.vy;
  const em = Math.hypot(ex, ey), budget = ACC * dt;
  if (em > 0.001) { const k = Math.min(1, budget / em); s.vx += ex * k; s.vy += ey * k; }

  s.x += s.vx * dt;
  s.y += s.vy * dt;

  if (s.x < WORLD.x0 + s.r) { s.x = WORLD.x0 + s.r; s.vx = 0; }
  if (s.x > WORLD.x1 - s.r) { s.x = WORLD.x1 - s.r; s.vx = 0; }
  if (s.y < WORLD.y0 + s.r) { s.y = WORLD.y0 + s.r; s.vy = 0; }
  if (s.y > WORLD.y1 - s.r) { s.y = WORLD.y1 - s.r; s.vy = 0; }

  if (Math.hypot(s.vx, s.vy) > 1) s.heading = Math.atan2(s.vy, s.vx);
}

// Is this ship inside the map's docking zone? Ownership is the caller's problem —
// an enemy can sit in your base ring, they just get nothing from it.
export function inBase(map, s) {
  return !!map.base && Math.hypot(map.base.x - s.x, map.base.y - s.y) < map.base.r;
}

// Base rings and portal mouths are both sanctuary. An alien will not start a fight
// with anyone standing in one — but provocation overrides it, and that check lives
// in the alien's own logic, not here.
export const HAVEN_R = PORTAL_R * 2.4;
export function inHaven(map, s) {
  return inBase(map, s) || map.portals.some(p => Math.hypot(p.x - s.x, p.y - s.y) < HAVEN_R);
}

export const SHOT_FLASH = 0.16;   // s the muzzle stays lit

// Shields come back only after shieldDelay seconds without being hit, so taking
// any damage at all resets the clock. Hull never regenerates in the field — the
// only place it comes back is inside your own base ring, which is also the only
// place regen ignores the delay.
export const DOCK_SHIELD_MULT = 3;    // × shieldRegen while docked
export const DOCK_HULL_RATE   = 0.12; // × max hull per second, so ~8s from scrap
// Long enough to cover a full weapon cycle plus a miss. At 1s a single missed
// shot opened a repair window, and the dock heals ~250/s against an alien's ~50,
// so hiding still worked. Being shot at means being in combat, not being hit
// in the last frame.
export const DOCK_INTERRUPT   = 4.0;  // s of quiet before the dock will work on you

export function stepVitals(s, dt, docked = false) {
  s.sinceHit += dt;
  if (s.shieldHit > 0) s.shieldHit = Math.max(0, s.shieldHit - dt);
  // Repair only runs while nothing is shooting you. Otherwise a provoked alien
  // could follow you into the ring and the dock would simply out-heal it, which
  // would make running home a free escape and the chase pointless.
  if (docked && s.sinceHit >= DOCK_INTERRUPT) {
    s.shield = Math.min(s.stats.shield, s.shield + s.stats.shieldRegen * DOCK_SHIELD_MULT * dt);
    s.hp     = Math.min(s.stats.hull,   s.hp     + s.stats.hull * DOCK_HULL_RATE * dt);
    return;
  }
  if (s.sinceHit < s.stats.shieldDelay || s.shield >= s.stats.shield) return;
  s.shield = Math.min(s.stats.shield, s.shield + s.stats.shieldRegen * dt);
}

export function applyDamage(s, amount) {
  if (amount <= 0) return { shield: 0, hull: 0, dead: false };
  s.sinceHit = 0;
  const onShield = Math.min(s.shield, amount);
  s.shield -= onShield;
  const onHull = amount - onShield;
  s.hp = Math.max(0, s.hp - onHull);
  // Only a hit the shields actually caught lights the bubble. Once they're down,
  // damage lands on bare hull and there is nothing left to flare.
  if (onShield > 0) s.shieldHit = SHIELD_FLASH;
  return { shield: onShield, hull: onHull, dead: s.hp <= 0 };
}

// Shear is ordinary damage: it eats shields first and, because applyDamage resets
// the timer every tick, they never start coming back while you are still out there.
export function stepDrift(s, dt) {
  const dps = driftDps(driftDepth(s.x, s.y));
  return dps > 0 ? applyDamage(s, dps * dt) : null;
}

export function nearPortal(map, s) {
  if (s.jumpCd > 0) return null;
  return map.portals.find(p => Math.hypot(p.x - s.x, p.y - s.y) < PORTAL_R) ?? null;
}

// Entering a portal does nothing on its own — you have to commit. Calling this
// while already spooling cancels it, so the button is a toggle.
export function beginJump(s, map) {
  if (s.charge > 0) { s.charge = 0; s.chargeTo = null; return; }
  const p = nearPortal(map, s);
  if (p) { s.charge = JUMP_TIME; s.chargeTo = p.to; }
}

// Advances the spool-up. Returns the destination map id on the tick it fires.
// Drifting out of the portal ring cancels — the ship has to hold station.
export function stepJump(s, map, dt) {
  if (s.charge <= 0) return null;
  const p = nearPortal(map, s);
  if (!p || p.to !== s.chargeTo) { s.charge = 0; s.chargeTo = null; return null; }
  s.charge -= dt;
  if (s.charge > 0) return null;
  const to = s.chargeTo;
  s.charge = 0; s.chargeTo = null;
  return to;
}

// Arrive beside the destination map's portal that leads back here, nudged toward
// map centre so you don't immediately re-trigger it.
export function arrivalFor(fromMapId, destMap) {
  const back = destMap.portals.find(p => p.to === fromMapId);
  if (!back) return { x: MAP_W / 2, y: MAP_H / 2 };
  let dx = MAP_W / 2 - back.x, dy = MAP_H / 2 - back.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) { dx = 0; dy = 1; }              // portal sits dead centre — drop out south of it
  else       { dx /= d; dy /= d; }
  return { x: back.x + dx * (PORTAL_R + 220), y: back.y + dy * (PORTAL_R + 220) };
}
