// Rockets.
//
// The other half of a weapon slot. A laser is aimed where you will be and then
// travels in a straight line, so at range it can be dodged by simply not being
// there. A rocket does not care: it is thrown wide, comes around, and keeps
// coming. What you buy with a launcher is damage that lands.
//
// The price is cadence and delivery. A rack cycles at roughly half the rate of
// guns and the flight takes real seconds, so rockets are the punch you commit to
// early in a fight rather than the pressure you hold someone under.
//
// A launcher occupies a weapon slot, as many to a ship as the hull allows, and
// never rides a drone — a drone is a gun platform, and six of them carrying swarm
// racks would put thirty rockets in the air off one trigger.

import { applyDamage, rangeOf, hullOf } from './sim.js';
import { drumOf } from './ability.js';
import { boostOf } from './power.js';
import { EQUIPMENT, MAX_LAUNCHERS } from './gear.js';
import { slotsOf } from './ships.js';
import { hardpoints } from './combat.js';
import { aspectOf, alphaAt, dutyAt, shownAt } from './stealth.js';

export { MAX_LAUNCHERS };

export const ROCKET_SPEED = 520;    // px/s — half a bolt, so you see them coming
export const ROCKET_TTL   = 4.5;    // s of motor, about 2300px of flight
export const ROCKET_RATE  = 0.55;   // volleys/s
export const LAUNCH_FLASH = 0.35;   // s the rails glow after a volley, and how the client hears it
export const SPREAD       = 1.9;    // rad off the aim line for the outermost rocket — a hard fan

// Steering, and the whole shape of the weapon.
//
// Authority spools up: a rocket leaves the rail with almost none, so it keeps
// going the way it was thrown and sweeps a long way off the firing line, then
// hardens up and comes back in. That sweep IS the weapon — a rocket that
// corrects immediately is just a slow bolt.
//
// The terminal rule is not cosmetic. A pursuer whose turn circle is wider than
// its miss distance cannot close on something sitting inside that circle: it
// orbits until the motor dies. With a flat 1.6 rad/s the circle was 325px and
// better than a third of every volley sailed around a stationary target and
// expired. Inside TERMINAL_R the fins get everything they have, which puts the
// circle at 37px — comfortably under the fuse, so capture is arithmetic.
export const TURN_MIN     = 0.35;   // rad/s at the rail
export const TURN_MAX     = 2.6;    // rad/s once the motor is up
export const ARC_TIME     = 0.8;    // s to spool between them
export const TERMINAL_R   = 400;    // px inside which it stops holding back
export const TERMINAL_TURN = 14;    // rad/s there: 520/14 = 37px of turn circle
export const ROCKET_R     = 40;     // proximity fuse, on top of the hull's radius

// --- the seeker ---------------------------------------------------------------
// A missile has a worse look at a stealth airframe than the pilot who fired it.
// It is small, it is close in, and it is looking from wherever it happens to be
// — which against something shaped to be quiet from the front is usually the
// worst angle there is.
//
// So it holds the target intermittently. While it has it, it steers, sloppily,
// with an error that grows as the return weakens. While it has lost it, it
// coasts on the last bearing it believed — which is how a missile misses
// something that was never really there.
export const SEEK_WOBBLE = 190;    // px of aim error at the faintest return

// A seeker gets exactly what its own seat can see, and nothing sharpens it.
//
// It took a third argument — the firing ship's Lock, 0..1, which closed the gap
// between what the seeker could see and a perfect return. Lock is gone, and the
// parameter went with it rather than staying as a hook nothing can move: the one
// thing it beat is already beaten by the Aspect Filter, which is a technology any
// hull may buy, so the counter to camouflage is on the shelf where everyone can
// reach it instead of welded to one chassis. Nothing about an UNLOCKED seeker
// moved, and that is arithmetic rather than a measurement: every caller but a
// driven Vanguard passed k = 0, and `k >= 1 || shownAt(...) || Math.random() < 0`
// is exactly `shownAt(...)`. The 28% of what is fired at a Bandit that lands is
// the same 28%.
export function seekerOn(rocket, target) {
  if (!target?.def?.stealth) return { locked: true, wobble: 0, aspect: 1 };
  const aspect = aspectOf(target, rocket);        // from the seeker's own seat
  return {
    aspect,
    locked: shownAt(aspect, (rocket.age ?? 0) * 1000, rocket.seed ?? 0),
    wobble: (1 - alphaAt(aspect)) * SEEK_WOBBLE,
  };
}

export const turnRate = (age, dist) => {
  const spool = Math.min(1, (age ?? 0) / ARC_TIME);
  const w = TURN_MIN + (TURN_MAX - TURN_MIN) * spool;
  return dist < TERMINAL_R ? Math.max(w, TERMINAL_TURN) : w;
};

export const isLauncher = key => EQUIPMENT[key]?.kind === 'rocket';

// Launchers in the rack. Drones are excluded on purpose (see the header), and the
// cap is applied here so every caller — resolve, the client, the server — agrees
// on which racks are actually live.
//
// The hull is a required argument, not a defaulted one. A default of three would
// have the Vanguard's shop counter read "full" on the fourth rack while the server
// seated a fifth, which is the one-rule-in-two-places bug this codebase is built
// to avoid; an unknown key still falls back through slotsOf rather than throwing.
export const launcherCap = hullKey => slotsOf(hullKey).launchers ?? MAX_LAUNCHERS;
export const launchersIn = (hullKey, fit) =>
  (fit?.weapon ?? []).filter(isLauncher).slice(0, launcherCap(hullKey));

export const launcherRoom = (hullKey, fit) => launcherCap(hullKey) - launchersIn(hullKey, fit).length;

// Advances the rack and returns the rockets released this tick. A volley leaves
// all at once — the fan is the whole point, and dribbling it out one at a time
// would just look like bad lasers.
// `mag` is the warhead stock, or null for anything that does not carry any —
// aliens shoot forever, which is their whole advantage.
export function launch(a, b, dt, mag = null) {
  a.rocketCool = Math.max(0, (a.rocketCool ?? 0) - dt);
  a.rocketFlash = Math.max(0, (a.rocketFlash ?? 0) - dt);
  const rated = Math.round(a.stats?.rockets ?? 0);
  if (!rated) return [];
  const live = b && b.hp > 0 && a.hp > 0 &&
               Math.hypot(b.x - a.x, b.y - a.y) <= rangeOf(a);
  if (!live || a.rocketCool > 0) return [];
  // Short of warheads it throws what it has. Each one still hits for its full
  // share: you are firing fewer rockets, not weaker ones.
  const n = mag ? Math.min(rated, mag.n) : rated;
  if (!n) return [];
  // Drumfire is the rack's cadence too, not just the guns'.
  //
  // It has to be. The Vanguard is the one hull that may fill all five hardpoints
  // with launchers, so a rocket Vanguard is the signature build of the hull the
  // ability belongs to — and an ability that only touched `fireRate` would hand
  // that build nothing at all, which is the same complaint Lock died of one hull
  // along. The rate is applied to the RACK'S COOLDOWN and nowhere else: the volley
  // is still `rockets` rails at `rocketVolley` shared between them, so this is
  // volleys arriving sooner and never a bigger volley.
  a.rocketCool = 1 / (ROCKET_RATE * drumOf(hullOf(a), a.power, a.stats));
  a.rocketFlash = LAUNCH_FLASH;          // one per volley, not one per rocket
  if (mag) mag.n -= n;

  const each = (a.stats.rocketVolley * boostOf(a.power, 'weapons', a.stats) * (mag?.mult ?? 1)) / rated;
  const mounts = hardpoints(a);
  const aim = Math.atan2(b.y - a.y, b.x - a.x);
  const half = (n - 1) / 2;
  // A lone rocket would otherwise fly dead straight, which reads as a slow bolt.
  // Alternating the side it swings out on keeps a single-pod rack looking like a
  // rocket and gives two of them a pleasing scissor.
  a.rocketSide = -(a.rocketSide ?? 1);

  const out = [];
  for (let i = 0; i < n; i++) {
    const off = half === 0 ? a.rocketSide * 0.6 : (i - half) / half;
    const h = aim + off * SPREAD;
    const m = mounts[i % mounts.length];
    out.push({
      x: m.x, y: m.y, heading: h,
      vx: Math.cos(h) * ROCKET_SPEED, vy: Math.sin(h) * ROCKET_SPEED,
      dmg: each, target: b, foe: !!a.isAlien, t: ROCKET_TTL, age: 0, w: Math.round(each), gr: mag?.tier ?? 0,
      seed: (a.rocketSeed = ((a.rocketSeed ?? 0) + 1) % 97) + i,   // each seeker blinks its own way
    });
  }
  return out;
}

// Flies every rocket one tick and settles the ones that connect. A rocket that
// overshoots comes around for another pass; one that runs out of motor is gone.
export function stepRockets(list, dt) {
  const hits = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    r.t -= dt;
    const tg = r.target;
    if (r.t <= 0 || !tg || tg.hp <= 0) { list.splice(i, 1); continue; }

    // Steer toward the target with whatever authority it has right now — and
    // only while the seeker can actually see it.
    r.age = (r.age ?? 0) + dt;
    const range = Math.hypot(tg.x - r.x, tg.y - r.y);
    const eye = seekerOn(r, tg);
    if (!eye.locked) {                              // lost it: fly the last bearing
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      continue;
    }
    // Where it thinks the target is. A weak return is an imprecise one, so the
    // aim point wanders — a rocket can be locked on and still go past.
    const drift = eye.wobble
      ? { x: Math.cos(r.age * 2.3 + r.seed) * eye.wobble, y: Math.sin(r.age * 1.9 + r.seed) * eye.wobble }
      : { x: 0, y: 0 };
    const w = turnRate(r.age, range) * dt;
    const want = Math.atan2(tg.y + drift.y - r.y, tg.x + drift.x - r.x);
    let d = want - r.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r.heading += Math.max(-w, Math.min(w, d));
    r.vx = Math.cos(r.heading) * ROCKET_SPEED;
    r.vy = Math.sin(r.heading) * ROCKET_SPEED;
    r.x += r.vx * dt;
    r.y += r.vy * dt;

    if (Math.hypot(tg.x - r.x, tg.y - r.y) <= ROCKET_R + tg.r) {
      list.splice(i, 1);
      const split = applyDamage(tg, r.dmg);
      hits.push({ rocket: r, target: tg, dead: tg.hp <= 0, split });
    }
  }
  return hits;
}
