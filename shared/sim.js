// The authoritative simulation. Runs on the server; the client imports the same
// file so the two can never drift. Pure, deterministic, no I/O, no wall-clock.

import { MAP_W, MAP_H, PORTAL_R } from './maps.js';
import { resolve, radiusOf, gunsOf, berthed, baysOf, DEFAULT_HULL, HULLS } from './ships.js';
import { DEFAULT_FORMATION } from './formation.js';
import { emptyFit, techSet } from './gear.js';
import { newPower, stepPower, boostOf, levelOf, BOOST } from './power.js';
import { swellOf, dragOf, reachOf, cloakOf, drumOf } from './ability.js';
import { applyResearch } from './research.js';

// An ability belongs to the hull, so everything that asks about one starts here.
export const hullOf = s => HULLS[s?.hull];
// Effective speed, reach, rate and cloak: the hull's ability applied to the
// resolved stat. Anything that moves, shoots or is looked at goes through these
// rather than reading stats directly, or an ability would work in one place and
// not another — which is the drift shared/ exists to prevent. `rateOf` is the one
// that was missing when Drumfire arrived: combat.js was reading `stats.fireRate`
// straight off the ship in two places, and an ability that only reached one of
// them would have sped the volley up and left the cycle where it was.
export const speedOf = s => s.stats.speed * dragOf(hullOf(s), s.power, s.stats);
export const rangeOf = s => s.stats.weaponRange * reachOf(hullOf(s), s.power, s.stats);
export const rateOf  = s => s.stats.fireRate * drumOf(hullOf(s), s.power, s.stats);
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

// --- THE SIZE TRAVELS WITH THE MAP ---------------------------------------------
//
// MAP_W and MAP_H were a global fact about every sector, and they still are for
// every sector in the galaxy. A duel arena is a quarter of that by area, and it is
// the first sector that is not the standard size — so "how big is this place" has
// to become a question you ask a sector rather than a constant you import.
//
// Both of these DEFAULT to the globals, which is what makes this a small change
// rather than a rewrite of nine files: every existing caller that has no sector in
// hand keeps the answer it always had, and only the places that genuinely know
// which sector they are talking about pass one. The client's minimap and the
// server's course clamp are the two that matter, and they now ask the same
// function — a client drawing at one scale while the server clamps at another is
// exactly the class of bug rule one exists to prevent.
//
// `sizeOf` is the CHARTED rectangle: what the minimap draws, 0..w by 0..h.
export const sizeOf = map => ({ w: map?.w ?? MAP_W, h: map?.h ?? MAP_H });

// `boundsOf` is where a hull can physically be, which is not the same rectangle.
//
// In the galaxy it is the charted zone plus the drift margin: space keeps going and
// the shear bills you for it. In a `wall` sector it is the charted zone exactly,
// and the edge is hard — you stop and you take nothing. A duel wants the wall,
// because a boundary made of damage is a way to shove somebody to death rather
// than shoot them, and that turns a gunfight into a wrestling match.
export const boundsOf = map => map?.wall
  ? { x0: 0, y0: 0, x1: map.w ?? MAP_W, y1: map.h ?? MAP_H }
  : WORLD;

// Drift is measured against the CHARTED zone of whatever sector you are in. A
// walled sector has none by construction — its bounds and its charted zone are the
// same rectangle, so there is nowhere inside it that is outside — and passing no
// map keeps the galaxy's answer, which is every existing caller.
export const driftDepth = (x, y, map = null) => {
  if (map?.wall) return 0;
  const { w, h } = sizeOf(map);
  return Math.max(0, -x, x - w, -y, y - h);
};
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
// `earnedBays` rides on the ship for exactly the same reason `research` does: it is
// a fact about the OWNER rather than about the hull, and threading it through every
// call site that only wants to know what a Bulwark is would be the workshop-dock bug
// waiting to happen. shared/quests.js turns the account's `unlocked` list into the
// number; a ship that was never handed one flies its hull's own bays, which is every
// ship in the game until somebody kills a hundred Corsair Hives.
export function newShip(x = MAP_W / 2, y = MAP_H / 2, hull = DEFAULT_HULL, fit = emptyFit(), drones = [], formation = DEFAULT_FORMATION, rig = null, research = 0, earnedBays = 0) {
  const s = newBody(x, y, applyResearch(resolve(hull, fit, escortOf(drones, rig), formation, earnedBays), research), radiusOf(hull));
  s.research = research; s.earnedBays = earnedBays;
  s.hull = hull; s.fit = fit; s.drones = drones; s.formation = formation; s.rig = rig;
  s.bays = Math.min(baysOf(hull, earnedBays), (drones ?? []).length);   // berths flown, not bays owned — see refit
  s.guns = gunsOf(fit, berthed(hull, drones, earnedBays));  // ship rack plus whatever the escort carries
  // What this ship can DO, as opposed to what its numbers are. Resolved once here
  // and once in refit, because a capability is asked about every tick by things
  // that must not be walking a fit list to find out — see shared/tech.js.
  s.tech = techSet(fit, berthed(hull, drones, earnedBays));
  return s;
}

// The shield pool including whatever the reactor is currently adding to it.
export const shieldMax = s => s.stats.shield * (s.shieldMult ?? 1);

// Re-fit in place. Vitals are restored, so this must only be allowed somewhere
// safe — swapping to a tanky hull mid-fight would otherwise be free.
export function refit(s, hull, fit, drones = s.drones ?? [], formation = s.formation ?? DEFAULT_FORMATION, rig = s.rig ?? null) {
  s.hull = hull; s.fit = fit; s.drones = drones; s.formation = formation; s.rig = rig;
  const bonus = s.earnedBays ?? 0;
  s.stats = applyResearch(resolve(hull, fit, escortOf(drones, rig), formation, bonus), s.research ?? 0);
  s.r = radiusOf(hull);
  // How many of the bays this pilot owns the hull actually berths. Stamped on the
  // ship, beside `guns` and `r`, so that the escort resolve() counted, the escort
  // that is DRAWN and the escort that SHOOTS are the same escort. Without it a
  // Bulwark carrying a Kestrel's twelve bays flew ten drones' worth of statistics
  // behind twelve drawn hulls, and put its bolts out of two of them that were not
  // there. The bays themselves are untouched: ship.drones stays the full owned
  // list, so capture() still writes every bay a pilot paid for back to the account.
  s.bays = Math.min(baysOf(hull, bonus), (drones ?? []).length);
  s.guns = gunsOf(fit, berthed(hull, drones, bonus));
  s.tech = techSet(fit, berthed(hull, drones, bonus));   // a parked bay does not lend you its technology
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
//
// `bounds` is where the hull may physically be — boundsOf(map) — and it DEFAULTS to
// the galaxy's, so every caller that has no sector in hand is unchanged. A duel
// arena is a quarter the size and hands its own, which is the only way the edge a
// pilot is stopped at and the edge their minimap draws can be the same edge.
export function step(s, dt, bounds = WORLD) {
  if (s.jumpCd > 0) s.jumpCd -= dt;
  stepPower(s.power, dt, s.stats);
  const thr = boostOf(s.power, 'thrusters', s.stats);
  // STOPPED. `snare` is seconds of it left on the clock, put there by a Doldrum's
  // Slack Water and taken off by stepSnare in shared/ground.js.
  //
  // The first cut of this zeroed the ACCELERATION and left the momentum alone, so a
  // ship carried on going wherever it was already pointed and lost only the ability
  // to change its mind. That is a nicer mechanic and it is not the one the game has:
  // flown, a pilot at speed sailed straight out of the trap that had just shut on
  // them and barely noticed it. So the velocity goes too, and it is zeroed EVERY
  // TICK the clock is running rather than once on the way in — zeroing it once would
  // let anything that touches the body afterwards put a ship back into motion inside
  // a still and quietly turn the stop back into a coast.
  //
  // Everything that is not the throttle is untouched. The pilot keeps their guns,
  // their target, their rockets, their drone, their beacon, their heading and their
  // shields; they simply cannot be anywhere else for five seconds. See
  // shared/ground.js for the two clocks that stop that being a perma-root, and for
  // why a portal mouth is still a portal mouth.
  const stopped = (s.snare ?? 0) > 0;
  const MAX = speedOf(s) * thr, ACC = stopped ? 0 : s.stats.accel * thr;

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

  // And the way on goes with it. After the error correction rather than before, so
  // there is nothing left for this tick's acceleration budget to have added.
  if (stopped) { s.vx = 0; s.vy = 0; }

  s.x += s.vx * dt;
  s.y += s.vy * dt;

  if (s.x < bounds.x0 + s.r) { s.x = bounds.x0 + s.r; s.vx = 0; }
  if (s.x > bounds.x1 - s.r) { s.x = bounds.x1 - s.r; s.vx = 0; }
  if (s.y < bounds.y0 + s.r) { s.y = bounds.y0 + s.r; s.vy = 0; }
  if (s.y > bounds.y1 - s.r) { s.y = bounds.y1 - s.r; s.vy = 0; }

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

// The shield pool's own multiplier: whatever the reactor is adding, times whatever
// the hull's ability does to the pool. It is a factor on BOTH the size of the pool
// and the delay, which is why it is one function rather than two expressions.
const poolMult = s => boostOf(s.power, 'shields', s.stats) * swellOf(hullOf(s), s.power, s.stats);

// How long until these shields start coming back, in seconds — 0 when they are
// coming back right now, and null when there is nothing to wait for at all
// (already full, a hull with no regeneration, or a sector where shields do not
// return). Null is not zero on purpose: zero is a countdown that has just run
// out, null is a countdown that should never have been on screen.
//
// ONE rule, two callers: stepVitals gates on it below and the HUD counts down
// with it. A second copy would disagree the moment anything touched the delay,
// and the delay is NOT `stats.shieldDelay` — the sim divides it by the pool
// multiplier, so a reactor routed to shields brings them back sooner as well as
// bigger. A readout built on the raw stat would have run a third long on any
// pilot with power in shields, which is most of them in a fight, and it would
// have looked like the sim was cheating rather than like the readout was wrong.
//
// Docked is a different clock and says so. The dock works on you after
// DOCK_INTERRUPT of quiet — 4s, shorter than any hull's delay — so a docked pilot
// told to wait shieldDelay would be reading a number that was already wrong by
// two seconds. Whichever arrives first is the honest answer, and it is the same
// one stepVitals acts on.
// `dry` is a sector where shields do not come back at all. It was briefly true of
// asteroid claims and should not have been — a claim is meant to be hard because
// nothing in it ever breaks off, not because a mechanic was taken away, and the
// designer said so. It is true of a DUEL, for a reason that belongs to duels:
// regeneration is 3.33% of the pool a second, which refills a finished ship in
// half a minute, so two evenly matched pilots in a 6,000px box with that running
// have an obvious dominant line and it is to kite until the wall and take the
// draw. Without it, the ship each of them arrives in is all they get and somebody
// has to commit. A repair kit still works, because five seconds of not being shot
// at is a decision rather than a rest button.
export function shieldWait(s, docked = false, dry = false, m = poolMult(s)) {
  if (!(s.stats.shieldRegen > 0)) return null;      // nothing to come back at all
  if (s.shield >= s.stats.shield * m) return null;  // already full: nothing pending
  const field = dry ? Infinity : s.stats.shieldDelay / m;
  const at = docked ? Math.min(DOCK_INTERRUPT, field) : field;
  return Number.isFinite(at) ? Math.max(0, at - (s.sinceHit ?? 1e9)) : null;
}

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
  const m = poolMult(s);
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
  // The gate and the HUD's countdown are the same rule, asked the same way: a
  // wait of anything but exactly zero means the shields are not coming back yet.
  if (shieldWait(s, docked, dry, m) !== 0) return;
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
// `map` defaults to null, which means the galaxy's charted zone — every existing
// caller. A walled sector reports no depth anywhere inside itself, so a duel takes
// no shear at all and cannot be won by pushing somebody over a line.
export function stepDrift(s, dt, grace = 0, map = null) {
  const dps = driftDps(driftDepth(s.x, s.y, map), grace);
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
