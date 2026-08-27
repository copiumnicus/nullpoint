// The authoritative simulation. Runs on the server today; the client imports the
// same file so it can predict its own ship later without the two drifting apart.

import { MAP_W, MAP_H, PORTAL_R } from './maps.js';

export const MAX_SPEED   = 340;   // px/s  top speed
export const ACCEL       = 1200;  // px/s² steering authority — lower = floatier
export const SLOW_RADIUS = 90;    // px    ease off inside this range
export const ARRIVE      = 5;     // px    close enough, stop
export const SHIP_R      = 13;    // px    half-size of the ship square
export const JUMP_TIME   = 3.0;   // s     portal spool-up once you commit

export function newShip(x = MAP_W / 2, y = MAP_H / 2) {
  return { x, y, vx: 0, vy: 0, heading: 0, jumpCd: 0, charge: 0, chargeTo: null,
           tx: null, ty: null,      // click-to-move destination
           dx: null, dy: null };    // hold-to-steer thrust vector (magnitude 0..1)
}

// Two distinct intents, because they are genuinely different orders:
//   tap       -> a DESTINATION. Fly there, arrive, stop.
//   hold+drag -> a DIRECTION. Thrust that way for as long as it's held.
// Collapsing these into one "chase a point" rule looks elegant and plays wrong:
// a held cursor is a fixed world point, so the ship reaches it and parks.
export function step(s, dt) {
  if (s.jumpCd > 0) s.jumpCd -= dt;

  let wantVx = 0, wantVy = 0;
  if (s.dx !== null) {
    wantVx = s.dx * MAX_SPEED;          // magnitude carries throttle, so pointing
    wantVy = s.dy * MAX_SPEED;          // close to the ship gives fine control
  } else if (s.tx !== null) {
    const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
    if (d < ARRIVE) {
      s.tx = s.ty = null;
    } else {
      const speed = MAX_SPEED * Math.min(1, d / SLOW_RADIUS);
      wantVx = (dx / d) * speed;
      wantVy = (dy / d) * speed;
    }
  }

  const ex = wantVx - s.vx, ey = wantVy - s.vy;
  const em = Math.hypot(ex, ey), budget = ACCEL * dt;
  if (em > 0.001) { const k = Math.min(1, budget / em); s.vx += ex * k; s.vy += ey * k; }

  s.x += s.vx * dt;
  s.y += s.vy * dt;

  if (s.x < SHIP_R)         { s.x = SHIP_R;         s.vx = 0; }
  if (s.x > MAP_W - SHIP_R) { s.x = MAP_W - SHIP_R; s.vx = 0; }
  if (s.y < SHIP_R)         { s.y = SHIP_R;         s.vy = 0; }
  if (s.y > MAP_H - SHIP_R) { s.y = MAP_H - SHIP_R; s.vy = 0; }

  if (Math.hypot(s.vx, s.vy) > 1) s.heading = Math.atan2(s.vy, s.vx);
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

// Arrive beside the destination map's portal that leads back here, nudged
// toward map centre so you don't immediately re-trigger it.
export function arrivalFor(fromMapId, destMap) {
  const back = destMap.portals.find(p => p.to === fromMapId);
  if (!back) return { x: MAP_W / 2, y: MAP_H / 2 };
  let dx = MAP_W / 2 - back.x, dy = MAP_H / 2 - back.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) { dx = 0; dy = 1; }              // portal sits dead centre — drop out south of it
  else       { dx /= d; dy /= d; }
  return { x: back.x + dx * (PORTAL_R + 220), y: back.y + dy * (PORTAL_R + 220) };
}
