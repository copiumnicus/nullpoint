// A POD, and it is the Corsair Hive's barrel.
//
// A mothership had two things and they had nothing to do with each other: a 110 dps
// aimed bolt, and a hatch that quietly produced a Bandit 300px off its own flank every
// five seconds. The bolt was beneath notice next to twelve raiders — aliens.js says so
// in as many words, "its own guns are almost beside the point" — and the brood
// appeared out of nowhere at a place the pilot had no say in. Two mechanics, one of
// them a tax and the other one a coin flip.
//
// THIS IS BOTH OF THEM, ONCE. The Hive throws a pod on a slow arc, it carries the
// whole of the gun's damage to where it lands, and where it lands is where a raider
// comes out. So dodging the pod is not merely dodging damage: it decides whether the
// Bandit hatches on top of you or four hundred pixels behind you, which against
// something that closes at 400 px/s is most of a fight.
//
// It is the Crucible's shape exactly, and deliberately — "the gun IS the delivery of
// the ground" becomes "the gun IS the delivery of the raider". ONE clock, one act, and
// `damage x fireRate` untouched.
//
// WHICH COST ONE EDIT IN THE BESTIARY AND IT IS WORTH NAMING. The gun used to cycle at
// 0.5/s and the brood at one every 5s, so joining them meant one of the two moving. The
// gun moved, because every reader of that table takes the PRODUCT — threatDps, the
// balance model's armed span, the bestiary report, hiveDps() — so 220 x 0.5 became
// 550 x 0.2 and not a single number downstream changed by a decimal place. That is the
// Leviathan's trick, restated one rung up: "300 x 0.4 and NOT 150 x 0.8, which is the
// same 120 dps to the decimal". `fireRate` is now `1 / broods.every` by construction and
// test/aliens.mjs pins the two equal, so a change to the brood cadence that forgot the
// gun would fail there rather than quietly halving the hostile.
//
// AND IT CANNOT PRODUCE MORE RAIDERS THAN THE HIVE IS ALLOWED. The pod is thrown on
// the clock whatever happens; whether it is LADEN is decided at the throw, against
// `broods.max` and the brood that is actually alive. A pod thrown at a full brood is
// ordnance and nothing else — which is what keeps `damage x fireRate` honest, because a
// gun that stopped firing once the escorts were out would be a hostile at a fraction of
// the dps its own definition claims. Whether it is laden is on the wire, so a pilot can
// see which pods matter.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y and hp. The
// server makes the raider, because making things is the server's job.

import { MAP_W, MAP_H } from './maps.js';
import { SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';
import { broodReady, BROOD_R } from './aliens.js';

// The whole of a launch on a definition is `def.broods`, which is where the brood's
// own numbers already lived. A second mothership is a block of data in aliens.js. THAT
// IS THE SEAM, and its name is `broods`.
export const podOf = def => def?.broods ?? null;

// HOW SLOW A POD IS, and it is pinned from both ends the way GLOB_SPEED and ORB_SPEED
// are.
//
// The ceiling is A TURN MUST BEAT IT. The throw solves the intercept along a straight
// line, so a pilot flying an arc is missed by the sagitta between the tangent it aimed
// down and the curve they actually flew — v^2 t^2 / 2d, and with t = d/S that is
// v^2 d / 2S^2. Clearing the pod's own disc plus a hull asks
//
//     S  <=  v * sqrt( d / (2 (POD_R + hull r)) )
//
// and at the numbers this fight is actually flown at — a finished Bulwark with its
// reactor on the gun at 128 px/s and a 17px hull, at the 770px a Hive stands off to —
// that is 286.
//
// The FLOOR is that it has to be able to lead anybody at all: the solve below cannot
// converge on a target moving faster than the throw, and a weapon that misses
// everything is a light show rather than a hostile — the measurement that cost orbs.js
// a whole design pass. 280 is over twice the 128 px/s a finished ship flies at and
// under a bare Hauler's 300.
//
// So 280, which is GLOB_SPEED to the pixel and arrived at independently: the two
// hostiles stand off to different ranges and throw different-sized things, and the
// derivation happens to land in the same place. It is restated here rather than
// imported for the reason ground.js restates GLOB_READ — two hostiles' worth of
// pattern should not be able to move each other's numbers by accident.
export const POD_SPEED = 280;   // px/s

// How big the thing that lands is. A pod has a Bandit folded up inside it, so it is the
// biggest ball this game throws — a Leviathan's orb — and it is a CEILING as much as a
// look: the derivation above reads it, so a bigger pod is a pod a turn no longer beats.
export const POD_R = 60;

// The flight is the warning, and it is never shorter than this however close the
// target gets. Half a portal's spool, the same floor ground.js puts under a glob, so a
// pod thrown from point blank still gives a pilot something to react to rather than
// arriving on the same tick it left.
export const POD_WARN = 1.5;   // s

// What one pod carries: the whole of the gun, boosted the same way a bolt is. The
// cadence is `broods.every`, and `fireRate` is `1 / every`, so `damage x fireRate` is
// what it delivers a second if every one of them lands — which is exactly what happens
// to a pilot who holds a course, and exactly what threatDps has always claimed.
export const podDamage = a =>
  Math.max(0, (a?.stats?.damage ?? 0) * boostOf(a?.power, 'weapons', a?.stats));

// Where a pod in the air is right now, in world coordinates. It lives here rather than
// in the snapshot builder because two things want it — the server radar-filters on it
// and the client draws from the same two endpoints and the same `p` — and an
// interpolation kept in two places is the rule kept twice that shared/ exists to
// prevent. `podFlight` and not `podAt`, because `a.podAt` is the LANDING point and the
// client already has a `podAt()` about cargo.
export const podFlight = a => {
  if (!a?.podAt || !a?.podFrom) return null;
  const p = Math.max(0, Math.min(1, a.pod ?? 0));
  return { x: a.podFrom.x + (a.podAt.x - a.podFrom.x) * p,
           y: a.podFrom.y + (a.podAt.y - a.podFrom.y) * p };
};

// Did it land on this ship? The hull's radius counts, the same as an orb and a glob:
// the circle you can see is the circle that catches you.
export const podHit = (at, s) =>
  !!at && !!s && Math.hypot(s.x - at.x, s.y - at.y) <= POD_R + (s.r ?? 0);

// Clamped to charted space, exactly where driftDepth() stops being zero, for the reason
// sowPoint() is: a raider hatched in the shear is a raider nobody
// can be asked to fight. Applied when the throw is TAKEN, so the marker everyone can
// see and the place the thing arrives are the same point — 61px apart is a bug this
// codebase has already shipped once, and it was found live.
export const podPoint = at => ({
  x: Math.max(0, Math.min(MAP_W, at.x)),
  y: Math.max(0, Math.min(MAP_H, at.y)),
});

// Whether a pod may be thrown at all, given everything the caller already knows.
// Sanctuary is passed in rather than worked out here, because who is in a haven is
// sim.js's rule and this file must not keep a second copy of it — that is how the
// workshop dock spent a day refusing to sell anything.
export const podHolds = (a, victim, haven) =>
  !!podOf(a?.def) && !!victim && victim.hp > 0 && !haven;

// Where the raider actually comes out. The pod's own landing point, pushed out to
// BROOD_R if it landed inside that — because a Bandit that hatched on top of its own
// mother is a Bandit nobody had to dodge a pod for, and BROOD_R is the number that has
// always meant "escorts launch from a hull rather than from nowhere".
//
// It is the HATCH that is pushed and never the pod, which matters: the damage lands
// where the pod lands, so a pilot who closes right up to the hull is hit exactly as
// hard as one who stands off. Flooring the pod instead would have quietly zeroed the
// gun for anyone inside 300px, and threatDps would have started lying about it.
export const hatchAt = (a, at) => {
  const dx = at.x - a.x, dy = at.y - a.y, d = Math.hypot(dx, dy);
  if (d >= BROOD_R) return podPoint(at);
  const ang = d < 1 ? (a.rand ? a.rand() * Math.PI * 2 : 0) : Math.atan2(dy, dx);
  return podPoint({ x: a.x + Math.cos(ang) * BROOD_R, y: a.y + Math.sin(ang) * BROOD_R });
};

// A LAUNCH, one tick of it. Returns null, or { at, from, dmg, laden } on the single
// tick the pod lands. The caller deals the damage and makes the raider, because hurting
// things and making things are the server's job.
//
// `room` is whether the brood has space for another, asked at the THROW. It can only
// ever get truer between the throw and the landing — nothing but a pod makes a raider,
// and raiders only die — so deciding it early is safe as well as legible.
//
// `a.cool` is left alone entirely: this hostile's clock is `a.hatch`, which broodReady
// owns, and combat.js's gate keeps fire() off the trigger. Two callers on one clock is
// what ran every orb-thrower's gun at twice its rate the first time.
//
// A POD IN THE AIR IS NOBODY'S BUSINESS BUT ITS OWN. It is not cancelled when its
// target dies, jumps, reaches a haven or breaks the leash: it was thrown, and where it
// lands is where the raider comes out. That is stepLob's rule and it is here for
// stepLob's reason — a wind-up that re-seated every time the victim changed never
// landed on anybody a party had rotated away from.
export function stepPod(a, victim, hold, room, dt) {
  const B = podOf(a?.def);
  if (!B) return null;
  // The muzzle glow, decayed here because this hostile no longer calls fire() at all.
  // combat.js owns the only other copy of this line and it sits BELOW the gate that
  // sends a launcher home, so a mothership whose barrel became a hatch would hold a
  // full flash for ever. stepLob, stepWave and stepSweep all say the same thing.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  // ITS OWN REACH: the barrel's, because this IS the barrel. A pilot who has backed off
  // past 1,100 is outside it exactly as they were outside the bolt it replaces.
  const reach = Math.max(1, a.stats?.weaponRange ?? 1);
  const live = hold && victim && Math.hypot(victim.x - a.x, victim.y - a.y) <= reach;
  // ONE CLOCK, and it is the brood's. broodReady counts down only while the thing is
  // engaged — "a hive nobody has found should not be quietly filling its sector with
  // raiders" — and `first` is still the first one and `every` still the cadence.
  //
  // IT TICKS BEFORE THE IN-FLIGHT RETURN AND NOT AFTER IT, which is the whole reason
  // this line is up here. Behind the `if (a.podAt)` below it stopped counting for the
  // whole flight, so the real cadence became `every + flight` — 7.5s against a stated 5
  // — and the hostile quietly sat 33% under the dps its own definition claims. Nothing
  // errors; threatDps just stops being true. Measured at 73.3 dps against a book of 110
  // before it was moved, which is the same bug stepLob names in shared/ground.js and the
  // same 18% it cost there.
  //
  // A tick can never be LOST to a pod already in the air, and that is arithmetic rather
  // than luck: the longest possible flight is `reach / POD_SPEED` = 1100/280 = 3.93s
  // against a 5s cadence. test/aliens.mjs pins that inequality, so a faster mothership
  // or a slower pod fails there instead of silently dropping launches.
  const due = live ? broodReady(a, dt) : false;
  if (a.podAt) {
    a.pod = Math.min(1, (a.pod ?? 0) + dt / Math.max(0.01, a.podFly || 0.01));
    if (a.pod < 1) return null;
    const at = a.podAt, from = a.podFrom, laden = !!a.podLaden;
    a.pod = 0; a.podAt = null; a.podFrom = null; a.podFly = 0; a.podLaden = false;
    return { at, from, dmg: podDamage(a), laden };
  }
  if (!due) return null;

  // THE INTERCEPT IS SOLVED, NOT ESTIMATED, and it is orbs.js's three passes for
  // orbs.js's reason: at this speed the target moves nearly as fast as the throw and a
  // single guess lands a couple of hundred pixels behind them. It CANNOT converge on
  // anything faster than the pod, which is correct rather than a limitation — and the
  // clamp keeps a divergent solve inside the throw's own reach so it aims somewhere
  // reachable instead of at the far wall.
  const reachT = Math.max(0.1, reach / POD_SPEED);
  let travel = Math.hypot(victim.x - a.x, victim.y - a.y) / POD_SPEED;
  for (let i = 0; i < 3; i++)
    travel = Math.min(reachT, Math.hypot(victim.x + (victim.vx ?? 0) * travel - a.x,
                                         victim.y + (victim.vy ?? 0) * travel - a.y) / POD_SPEED);
  // ITS FULL REACH AND NO FURTHER, which is orbs.js's rule about a projectile outliving
  // its own weapon range. The lead point sits AHEAD of the target, so a pilot running
  // outward at the edge of the throw drags it past 1,100 — and a hostile that put a
  // raider somewhere it could not have thrown at is the one thing a pilot holding range
  // is entitled to rely on not happening. Clamped along the line rather than refused, so
  // breaking range shortens the throw instead of silently cancelling it.
  let ax = victim.x + (victim.vx ?? 0) * travel, ay = victim.y + (victim.vy ?? 0) * travel;
  const out = Math.hypot(ax - a.x, ay - a.y);
  if (out > reach) { ax = a.x + (ax - a.x) / out * reach; ay = a.y + (ay - a.y) / out * reach; }
  a.podAt = podPoint({ x: ax, y: ay });
  a.podFrom = { x: a.x, y: a.y };
  // Measured to the CLAMPED point rather than to the aim point, so a throw that ran into
  // the edge of charted space still arrives when the marker says it will.
  a.podFly = Math.max(POD_WARN, Math.hypot(a.podAt.x - a.x, a.podAt.y - a.y) / POD_SPEED);
  a.pod = 0;
  a.podLaden = !!room;
  a.shotFlash = SHOT_FLASH;
  a.sinceShot = 0;                                 // and there goes the veil
  return null;
}
