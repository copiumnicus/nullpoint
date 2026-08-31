// The fix.
//
// A Kedge has an ordinary gun and it is a short one. Everything that makes it a
// fight is that it takes a positional FIX on you and then collapses you back onto
// it: three seconds later your ship is standing exactly where it was standing when
// the fix was taken, whatever you did in between.
//
// WHY THIS AND NOT MORE HIT POINTS. Every hostile in the game can be declined.
// aliens.js says so about nearly all of them in as many words — "a fight you can
// see coming is a fight you should be able to decline", "leaving always works, you
// just cannot leave and win", "it can kill you but it can never trap you". That is
// the right promise and this does not break it. What it does is put a PRICE on
// leaving, which nothing else in the game does, and the price is stated exactly:
//
//   a fix undoes `fuse` seconds of travel every `fuse + cool` seconds,
//   so leaving takes (fuse + cool) / cool times as long. Nothing else changes.
//
// With fuse and cool both 3, that is exactly twice as long — for every hull, at
// every stage, because the tax is a ratio of two clocks and neither of them knows
// how fast you are. See escapeTax(), and test/kedge.mjs asserts it against a real
// chase in every hull.
//
// WHY IT HOLDS STILL. A sighting needs a stable platform: the Kedge stops dead
// while the fix winds. That is not decoration, it is the entire reason the
// arithmetic above is honest. A Kedge that kept CHASING during the fuse would give
// back its own approach as well as your retreat — the collapse would cost you
// `kedge speed x fuse` of ground per cycle on top of your own travel, and measured
// against a finished Bulwark (234 px/s boosted against 190) that is 570px lost
// against 132px gained: a hostile you can never, ever leave. Holding station makes
// the loss exactly your own travel and no more, which is what turns a trap into a
// toll. It is also the counterplay: for three of every six seconds the thing is a
// parked target and every shot lands.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y and hp.
// Both sides import it: the server moves the ship, the client draws the marker, and
// this file is the reason those are the same point.

import { MAP_W, MAP_H } from './maps.js';

// s from taking the fix to the collapse. It is JUMP_TIME — the three seconds a
// portal takes to spool — and that is the whole of the derivation: the fix and the
// door cost the same three seconds, so a pilot who reaches a portal mouth before
// the fix lands is through, and one who does not is not. The gate sectors have no
// dock and no outpost; four portal mouths are the only sanctuary on them, which is
// why this belongs there and nowhere else.
export const FUSE = 3.0;
// And how long before it can take another. Equal to the fuse, so the tax is exactly
// x2 — a number the player can feel and a test can state. Anything shorter is a
// hostile you cannot leave; anything longer is a mechanic that only fires once.
export const COOL = 3.0;

export const fixOf = def => def?.fix ?? null;

// Whether a fix may exist at all, given everything the caller already knows: it has
// somebody, they are alive, and they are not standing in sanctuary. Passed in
// rather than worked out here, because who is in a haven is sim.js's rule and a
// second copy of it is how the workshop dock spent a day refusing to sell anything.
export const fixHolds = (a, victim, haven) =>
  !!fixOf(a?.def) && !!victim && victim.hp > 0 && !haven;

// Advances the fix by one tick. Returns null, or { to } on the single tick it
// collapses — the caller moves the ship, because moving a ship is the server's job.
//
// Losing the target is total, the way a Lamprey's tether is: a fix that unwound
// slowly would mean breaking contact bought you a fraction of what it cost you to
// break it. Re-seating on a new victim starts from nothing for the same reason the
// tether does — otherwise a party would be worse than a soloist, three pilots fed
// through one clock.
export function stepFix(a, victim, hold, dt) {
  const F = fixOf(a?.def);
  if (!F) return null;
  if (!hold) { a.fix = 0; a.fixOn = null; a.fixAt = null;
               a.fixCool = Math.max(0, (a.fixCool ?? 0) - dt); return null; }
  if (a.fixOn !== a.target) { a.fix = 0; a.fixOn = a.target; a.fixAt = null; }
  if ((a.fixCool ?? 0) > 0) { a.fixCool = Math.max(0, a.fixCool - dt); a.fix = 0; a.fixAt = null; return null; }
  // The sighting is of the VICTIM's place, taken on the tick the fix starts. Not
  // the Kedge's place: a fix on the Kedge would be a hook, which is a different
  // ability and one this game already has the shape of in the Lamprey's tether.
  a.fixAt ??= fixPoint({ x: victim.x, y: victim.y });
  a.fix = Math.min(1, (a.fix ?? 0) + dt / Math.max(0.01, F.fuse ?? FUSE));
  if (a.fix < 1) return null;
  const to = a.fixAt;
  a.fix = 0; a.fixAt = null; a.fixCool = F.cool ?? COOL;
  return { to };
}

// Is a sighting being taken right now? The server reads this to plant the hull, and
// the wire carries it as `abl` so the client can draw the same thing.
export const fixWinding = a => !!a?.fixAt && (a.fix ?? 0) > 0;

// What a fix costs an escape, as a multiple. Derived from the two clocks, so moving
// either moves this and the test that asserts it.
export const escapeTax = def => {
  const F = fixOf(def);
  return F ? ((F.fuse ?? FUSE) + (F.cool ?? COOL)) / Math.max(0.01, F.cool ?? COOL) : 1;
};

// Where the collapse actually puts a ship. ONE function, because the server moves
// the hull and the client draws the marker it will land on, and a marker you can
// see that is not where you end up is the same bug as a row you can see and cannot
// click — this codebase has shipped that twice.
//
// Clamped to charted space, which is exactly where driftDepth() stops being zero, so
// a collapse can never put anybody in the shear. It is applied when the SIGHTING is
// TAKEN rather than when it fires, and that is not tidiness either: clamping at the
// end would mean the marker on everyone's screen and the place the hull lands were
// two different points whenever a fight drifted near the rim. Caught live, 61px
// apart, on a chase that ran out to the edge of the sector.
export const fixPoint = to => ({
  x: Math.max(0, Math.min(MAP_W, to.x)),
  y: Math.max(0, Math.min(MAP_H, to.y)),
});

// Momentum is kept. You are not stopped, stunned, turned or slowed — the ship is
// somewhere else and still doing exactly what you told it to. Maximum time without
// control from a fix: zero seconds, and that is the whole reason this is allowed to
// exist in a game where the alternative was a stun.
export function collapseTo(s, to) {
  const at = fixPoint(to);
  s.x = at.x; s.y = at.y;
  return at;
}

// Everything a fix leaves on a hostile, cleared in one place so respawnAlien and
// the target-lost path cannot each forget a different half of it.
export function clearFix(a) { a.fix = 0; a.fixAt = null; a.fixOn = null; a.fixCool = 0; }
