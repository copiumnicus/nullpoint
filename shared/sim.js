// The authoritative simulation. Runs on the server; the client imports the same
// file so the two can never drift. Pure, deterministic, no I/O, no wall-clock.

import { MAP_W, MAP_H, PORTAL_R } from './maps.js';
import { resolve, radiusOf, gunsOf, berthed, baysOf, DEFAULT_HULL, HULLS } from './ships.js';
import { DEFAULT_FORMATION } from './formation.js';
import { emptyFit, techSet } from './gear.js';
import { newPower, stepPower, boostOf, levelOf, BOOST } from './power.js';
import { swellOf, dragOf, reachOf, cloakOf } from './ability.js';
import { applyResearch } from './research.js';

// An ability belongs to the hull, so everything that asks about one starts here.
export const hullOf = s => HULLS[s?.hull];
// Effective speed, reach and cloak: the hull's ability applied to the resolved
// stat. Anything that moves, shoots or is looked at goes through these rather
// than reading stats directly, or an ability would work in one place and not
// another — which is the drift shared/ exists to prevent.
export const speedOf = s => s.stats.speed * dragOf(hullOf(s), s.power, s.stats);
export const rangeOf = s => s.stats.weaponRange * reachOf(hullOf(s), s.power, s.stats);
export const veilOf  = s => cloakOf(hullOf(s), s.power, s.stats, s.sinceShot ?? 1e9);

// How often the world moves. Both sides need this and both had their own copy —
// server.js as a local const, the client as a bare `1000 / 30` in its flush loop —
// and the performance readout needs it too, to say whether a frame or a round trip
// is fast relative to the only clock that matters.
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

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
// `grace` is how much of the margin something aboard is nulling for you, in px.
// It is a plain argument rather than a lookup because this file deliberately
// knows nothing about the shop: shared/tech.js decides who gets any and what it
// costs them, and hands the answer in. With nothing fitted it is 0 and this is
// the same curve it has always been, which is the only way to add a mitigation
// to a wall without quietly moving the wall.
export function driftDps(depth, grace = 0) {
  const past = depth - Math.max(0, grace);
  if (past <= 0) return 0;
  const t = Math.min(1, past / DRIFT_MARGIN);
  return DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * t * t;
}

// The world distance you are guaranteed to see in every direction from your ship,
// whatever the window. The client zooms out when it has to in order to honour it,
// so a tall monitor is not an advantage — and an alien's aggro range is set just
// inside it, so nothing can pick a fight from off-screen.
export const SIGHT_R = 560;

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
    power: newPower(stats.capacitor), shieldMult: 1, guns: 1, muzzle: 0, sinceShot: 1e9,
    hp: stats.hull, shield: stats.shield, sinceHit: 1e9, shieldHit: 0,
    cool: 0, shotFlash: 0, volley: 0, volleyCool: 0,
    jumpCd: 0, charge: 0, chargeTo: null,
    tx: null, ty: null,      // click-to-move destination
    dx: null, dy: null,      // hold-to-steer thrust vector (magnitude 0..1)
  };
}

// The rig rides along for stats — its hold is real cargo — but it is not a combat
// bay and is never counted as one. Everywhere the escort is resolved, it is
// `[...drones, rig]`; everywhere bays are counted, it is `drones`.
export const escortOf = (drones = [], rig = null) => (rig ? [...drones, rig] : drones);

// `research` is the owner's station mask, carried ON the ship rather than passed to
// every call site. resolve() answers what the SHOPS sold you; the research ladder
// multiplies that afterwards, so no hull dominates another because of it and the
// shops do not have to know the ladder exists. Both sides apply the same function
// — a second copy would mean a pilot watching a hull bar that is not their hull.
export function newShip(x = MAP_W / 2, y = MAP_H / 2, hull = DEFAULT_HULL, fit = emptyFit(), drones = [], formation = DEFAULT_FORMATION, rig = null, research = 0) {
  const s = newBody(x, y, applyResearch(resolve(hull, fit, escortOf(drones, rig), formation), research), radiusOf(hull));
  s.research = research;
  s.hull = hull; s.fit = fit; s.drones = drones; s.formation = formation; s.rig = rig;
  s.bays = Math.min(baysOf(hull), (drones ?? []).length);   // berths flown, not bays owned — see refit
  s.guns = gunsOf(fit, berthed(hull, drones));      // ship rack plus whatever the escort carries
  // What this ship can DO, as opposed to what its numbers are. Resolved once here
  // and once in refit, because a capability is asked about every tick by things
  // that must not be walking a fit list to find out — see shared/tech.js.
  s.tech = techSet(fit, berthed(hull, drones));
  return s;
}

// The shield pool including whatever the reactor is currently adding to it.
export const shieldMax = s => s.stats.shield * (s.shieldMult ?? 1);

// Re-fit in place. Vitals are restored, so this must only be allowed somewhere
// safe — swapping to a tanky hull mid-fight would otherwise be free.
export function refit(s, hull, fit, drones = s.drones ?? [], formation = s.formation ?? DEFAULT_FORMATION, rig = s.rig ?? null) {
  s.hull = hull; s.fit = fit; s.drones = drones; s.formation = formation; s.rig = rig;
  s.stats = applyResearch(resolve(hull, fit, escortOf(drones, rig), formation), s.research ?? 0);
  s.r = radiusOf(hull);
  // How many of the bays this pilot owns the hull actually berths. Stamped on the
  // ship, beside `guns` and `r`, so that the escort resolve() counted, the escort
  // that is DRAWN and the escort that SHOOTS are the same escort. Without it a
  // Bulwark carrying a Kestrel's twelve bays flew ten drones' worth of statistics
  // behind twelve drawn hulls, and put its bolts out of two of them that were not
  // there. The bays themselves are untouched: ship.drones stays the full owned
  // list, so capture() still writes every bay a pilot paid for back to the account.
  s.bays = Math.min(baysOf(hull), (drones ?? []).length);
  s.guns = gunsOf(fit, berthed(hull, drones));
  s.tech = techSet(fit, berthed(hull, drones));     // a parked bay does not lend you its technology
  s.volley = 0; s.volleyCool = 0;
  s.hp = s.stats.hull;
  s.shieldMult = 1;
  s.shield = s.stats.shield;
  s.power = newPower(s.stats.capacitor);
  s.sinceHit = 1e9;
  s.shieldHit = 0;
  s.cool = 0; s.shotFlash = 0; s.rocketCool = 0; s.rocketFlash = 0;
  return s;
}

// Two distinct intents, because they are genuinely different orders:
//   tap       -> a DESTINATION. Fly there, arrive, stop.
//   hold+drag -> a DIRECTION. Thrust that way for as long as it's held.
export function step(s, dt) {
  if (s.jumpCd > 0) s.jumpCd -= dt;
  stepPower(s.power, dt, s.stats);
  const thr = boostOf(s.power, 'thrusters', s.stats);
  // Engines out. `snare` is seconds of no thrust left on the clock, put there by a
  // Doldrum's Slack Water and taken off by stepSnare in shared/ground.js.
  //
  // It zeroes the ACCELERATION and nothing else, which is the whole of what makes it
  // shippable. Zeroing MAX instead would ask the ship to brake to a stop, which is a
  // stun with extra steps; leaving both alone and clearing the destination brakes it
  // just as hard, because a body with nowhere to go is a body decelerating at full
  // thrust. With no acceleration there is nothing to change the velocity with, so the
  // ship keeps exactly the momentum it had and coasts — there is no drag anywhere in
  // this function to take it away. The pilot keeps their guns, their target, their
  // drone, their beacon and their heading; what they lose is the ability to change
  // their mind for a second and a half. See shared/ground.js for why that is the only
  // version of a root this game is allowed to have.
  const MAX = speedOf(s) * thr, ACC = (s.snare ?? 0) > 0 ? 0 : s.stats.accel * thr;

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

// Whether this pilot may use the station here — repair, refit, and the store.
// One definition, because the client and the server each keeping their own is
// exactly how the workshop ended up refusing to sell anything: the server was
// happy to take the money and the client would not draw the counter.
export const canDock = (map, co, s) => (map.owner === co || !!map.dev) && inBase(map, s);

// A pirate outpost. Anyone may trade there, whatever company they fly for.
//
// It IS a haven now, and it deliberately was not: the whole point of somewhere to
// empty your hold mid-run was that it stayed open sky. What changed is that you
// can respawn at one. A wreck comes back with every grudge cleared, so without
// peace at the door a pilot who died on the frontier respawned unprovoked in front
// of whatever killed them and died again — a loop with no way out of it but
// quitting.
//
// It is still not a dock. It does not repair, it sells nothing without a berth,
// and the peace covers only the trading zone: step outside 420px and the frontier
// is exactly as it was. Pirates keeping order at their own door is also the only
// version of this that makes sense — they are running a shop, not a charity.
export const inOutpost = (map, s) =>
  !!map.outpost && Math.hypot(map.outpost.x - s.x, map.outpost.y - s.y) < map.outpost.r;

// Base rings and portal mouths are both sanctuary. An alien will not start a fight
// with anyone standing in one — but provocation overrides it, and that check lives
// in the alien's own logic, not here.
export const HAVEN_R = PORTAL_R * 2.4;

// WHICH sanctuary, or null. inHaven is this question with the answer thrown away.
//
// One function rather than two, because the HUD has to say which kind you are in —
// a company ring mends you and a pirate outpost pointedly does not — while the
// aliens only need to know that you are in one. Two copies of "where is it safe"
// would disagree the first time either moved, and this codebase has the scar.
export function havenKind(map, s) {
  if (inBase(map, s))    return 'ring';
  if (inOutpost(map, s)) return 'outpost';
  if (map?.portals?.some(p => Math.hypot(p.x - s.x, p.y - s.y) < HAVEN_R)) return 'portal';
  return null;
}
export const inHaven = (map, s) => havenKind(map, s) !== null;

export const SHOT_FLASH = 0.16;   // s the muzzle stays lit

// Shields come back only after shieldDelay seconds without being hit, so taking
// any damage at all resets the clock. Hull never regenerates in the field — the
// only place it comes back is inside your own base ring, which is also the only
// place regen ignores the delay.
export const DOCK_SHIELD_MULT = 3;    // x the shield's own rate while docked
export const DOCK_HULL_RATE   = 0.12; // × max hull per second, so ~8s from scrap
// Long enough to cover a full weapon cycle plus a miss. At 1s a single missed
// shot opened a repair window, and the dock heals ~250/s against an alien's ~50,
// so hiding still worked. Being shot at means being in combat, not being hit
// in the last frame.
export const DOCK_INTERRUPT   = 4.0;  // s of quiet before the dock will work on you

// `dry` is a sector where shields do not come back. It is the exact and whole fix
// for "kill one, walk out, let the shields refill, walk in again": percentage-based
// regeneration (0.50) puts 3.33% of the pool back every second once nothing has
// hit you for shieldDelay, which refills a finished ship in half a minute and turns
// a closed field into a fight with a rest button. Nothing else about the fight
// changes — you still take the same damage in the same order, you simply do not
// get it back by leaving. A property of the SECTOR, passed in by the caller, so an
// Ironhusk is an Ironhusk everywhere.
export function stepVitals(s, dt, docked = false, dry = false) {
  s.sinceHit += dt;
  s.sinceShot = (s.sinceShot ?? 1e9) + dt;   // a veil rebuilds from this
  if (s.shieldHit > 0) s.shieldHit = Math.max(0, s.shieldHit - dt);
  // Repair only runs while nothing is shooting you. Otherwise a provoked alien
  // could follow you into the ring and the dock would simply out-heal it, which
  // would make running home a free escape and the chase pointless.
  // Powering shields multiplies the POOL, charge included: 100 of 800 becomes 130
  // of 1040, and losing the power scales it back down the same way.
  // Powered shields, and then whatever the hull's own ability does to the pool on
  // top — an Anchored Bulwark is four times its own shield, not four times the
  // base, so routing to shields as well still means something.
  const m = boostOf(s.power, 'shields', s.stats) * swellOf(hullOf(s), s.power, s.stats);
  if (Math.abs(m - (s.shieldMult ?? 1)) > 1e-9) {
    s.shield *= m / (s.shieldMult ?? 1);
    s.shieldMult = m;
  }
  const max = s.stats.shield * m;
  if (s.shield > max) s.shield = max;

  if (docked && s.sinceHit >= DOCK_INTERRUPT) {
    s.shield = Math.min(max, s.shield + max * s.stats.shieldRegen * DOCK_SHIELD_MULT * dt);
    s.hp     = Math.min(s.stats.hull, s.hp + s.stats.hull * DOCK_HULL_RATE * dt);
    return;
  }
  if (dry || s.sinceHit < s.stats.shieldDelay / m || s.shield >= max) return;
  // A SHARE of the pool, so the seconds to full do not change when the pool does.
  // `max` already carries the power boost and the hull ability, so a bigger shield
  // refills proportionally faster and an Anchored Bulwark is not punished for the
  // four times shield it just switched on.
  s.shield = Math.min(max, s.shield + max * s.stats.shieldRegen * dt);
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

// A siphon takes hull and nothing else — past the shields, which is the one thing
// in the game that does that. A shield stops momentum; a tether is a gradient and
// there is nothing for the bubble to catch, so applyDamage is deliberately NOT the
// path this takes. It still stamps sinceHit, because being drained is being in
// combat: the shields must not tick back up under a live tether, and neither a
// repair drone, an Ore Foundry nor a dock may work on you while one is attached.
export function drainHull(s, amount) {
  if (!(amount > 0)) return { hull: 0, dead: false };
  s.sinceHit = 0;
  const took = Math.min(s.hp, amount);
  s.hp = Math.max(0, s.hp - amount);
  return { hull: took, dead: s.hp <= 0 };
}

// Shear is ordinary damage: it eats shields first and, because applyDamage resets
// the timer every tick, they never start coming back while you are still out there.
export function stepDrift(s, dt, grace = 0) {
  const dps = driftDps(driftDepth(s.x, s.y), grace);
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
