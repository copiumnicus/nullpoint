// The authoritative simulation. Runs on the server; the client imports the same
// file so the two can never drift. Pure, deterministic, no I/O, no wall-clock.

import { MAP_W, MAP_H, PORTAL_R } from './maps.js';
import { resolve, radiusOf, DEFAULT_HULL } from './ships.js';

export const SLOW_RADIUS = 90;    // px  ease off inside this range
export const ARRIVE       = 5;    // px  close enough, stop
export const JUMP_TIME    = 3.0;  // s   portal spool-up once you commit

// Speed, thrust, hull and shield all come from the fit — never from a constant
// here — so a module can change any of them.
export function newShip(x = MAP_W / 2, y = MAP_H / 2, hull = DEFAULT_HULL, fit = []) {
  const stats = resolve(hull, fit);
  return {
    x, y, vx: 0, vy: 0, heading: 0,
    hull, fit, stats, r: radiusOf(hull),
    hp: stats.hull, shield: stats.shield, sinceHit: 1e9,
    jumpCd: 0, charge: 0, chargeTo: null,
    tx: null, ty: null,      // click-to-move destination
    dx: null, dy: null,      // hold-to-steer thrust vector (magnitude 0..1)
  };
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

  if (s.x < s.r)         { s.x = s.r;         s.vx = 0; }
  if (s.x > MAP_W - s.r) { s.x = MAP_W - s.r; s.vx = 0; }
  if (s.y < s.r)         { s.y = s.r;         s.vy = 0; }
  if (s.y > MAP_H - s.r) { s.y = MAP_H - s.r; s.vy = 0; }

  if (Math.hypot(s.vx, s.vy) > 1) s.heading = Math.atan2(s.vy, s.vx);
}

// Shields come back only after shieldDelay seconds without being hit, so taking
// any damage at all resets the clock. Hull never regenerates in the field.
export function stepVitals(s, dt) {
  s.sinceHit += dt;
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
  return { shield: onShield, hull: onHull, dead: s.hp <= 0 };
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
