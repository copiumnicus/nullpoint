// A LANCE ON A LINE, and it is the Kedge's barrel.
//
// A Kedge is a Surveyor: it takes a fix on where you are standing and three seconds
// later puts you back on it. Beside that it carried a plain aimed bolt for 350 a
// second, and an aimed bolt is not dodged by anybody — the table at the top of
// orbs.js measures 94% of what one fires landing on a hull weaving as hard as it can.
// So half this hostile asked a question and the other half was a tax.
//
// This is that half converted. The barrel is a taut line paid out to your range with
// a fluke on the end of it, swung through an arc: the head is the thing that cuts you
// and the line is what it is on. Same 350 dps, same cadence, and nothing downstream
// moved — `damage x fireRate` is still what threatDps reads, still what a pilot who
// holds a course takes per second, and still what the bounty and the experience come
// out of.
//
// WHY THE DODGE IS RADIAL, WHICH IS NEW IN THIS BESTIARY. Every pattern in the game
// so far is answered by moving SIDEWAYS: get off the line of an Ironhusk's cone, walk
// the lane of an Antiphon's front, turn out of a solved intercept. A lance paid out
// to your own range cannot be answered that way and the arithmetic says so before
// anybody flies it — at the 630px this hostile stands off to, walking out of the side
// of the arc asks for 795 px/s and the hull that fights one flies at 142. What DOES
// answer it is changing your RANGE, because the line is only taut at one radius. So
// the Kedge is the first thing in the game that pays you to close or to open rather
// than to strafe, and that is the whole reason it is this shape and not a wider cone.
//
// AND IT IS WHY IT COMPOSES WITH THE FIX RATHER THAN SITTING BESIDE IT. A collapse is
// a radial displacement — it puts you back on a range you have left — which is the same
// axis the lance is about. Left alone that made the fix ANSWER the sweep rather than set
// it up: measured, a pilot who reads the wind-up took 89% of the book with the fix
// switched off and 18% with it on, because being teleported is a jink. So the lance
// swings through the SIGHTING while one is up rather than through the pilot; see the
// note beside that line in stepSweep for the three-column table it was chosen off.
// test/kedge.mjs runs the whole table and prints it.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y, r and hp.
// Both sides import it: the server swings the lance, the client draws the arc, and
// this file is the reason those are the same wedge.

import { SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';

// The whole of a sweep on a definition is `def.sweep`, exactly the way `def.orbs` is
// the whole of a fan and `def.sow` the whole of sown ground. A second hostile that
// swings something is a block of data in aliens.js. THAT IS THE SEAM, and its name
// is `sweep`.
export const sweepOf = def => def?.sweep ?? null;

// A pilot is assumed to need this long to read a swing before they act on it. The
// same 0.35s orbs.js and ground.js both use, restated rather than imported for
// ground.js's reason: two hostiles' worth of pattern should not be able to move each
// other's numbers by accident.
export const SWEEP_READ = 0.35;   // s

// --- the three clocks, and every one of them is pinned ---------------------------
//
// They have to fit inside ONE firing cycle, because the cycle is what threatDps
// reads: `wind + swing <= 1 / fireRate`. A Kedge cycles at 0.75/s, so the whole
// attack has 1.333s to happen in.
//
//   wind   the line is paid out and drawn taut, at the radius it is going to swing
//          at, over the arc it is going to cover. Nothing moves. This is the read.
//   swing  the head crosses the arc.
//   span   how much of the circle the arc covers.
//
// THE BUDGET IS `wind + swing/2`, because the aim solve below puts the target in the
// MIDDLE of the arc — so the head arrives at their bearing half a swing after it
// starts moving. What they have to do inside that budget is clear the head's own disc
// plus their hull, radially:
//
//     wind + swing/2  >=  READ + (sweep r + hull r) / v
//
// The hull this is posted against is a cruiser — shared/balance.js POSTING, "the
// pilot a Thresher one-shots" — which is a Bulwark at 142.4 px/s with its reactor
// NOT on its engines, and 17px of hull against a 60px head:
//
//     0.35 + 77 / 142.4  =  0.891s
//
// So `wind` 0.70 and `swing` 0.60 give a budget of 1.00s against a requirement of
// 0.891 — 0.109s of margin, which is 15px of room at that speed — and 1.30s of a
// 1.333s cycle. The margin is deliberately thin: this is a hostile you are meant to
// have to actually move for, and the same pilot with the reactor on their thrusters
// has 226 px/s and twice the room.
//
// THE SPAN IS DERIVED FROM THE OTHER DIRECTION: no hull may walk out of the SIDE of
// it, because if one could, the radial answer above would be optional and the
// mechanic would be a cone with extra steps. The fastest thing in the game boosted is
// 559 px/s (kedge.js's own HAUL_SPAN quotes the same number for the same reason), and
// over the whole 1.30s attack that is 727px of arc at the 630px standoff:
//
//     span  >=  2 x 727 / 630  =  2.31 rad
//
// 2.4, then — 137 degrees, wide enough that nothing outruns it sideways and narrow
// enough that it is a swing rather than a ring. A party does not all stand at one
// radius, so this still divides in a way an Antiphon's front does not.

// How big the head is, and it is a CEILING as much as a look — the budget above
// reads it, so a bigger fluke is a fluke a jink no longer beats. 60px is the largest
// ball this game already throws (a Leviathan's orb), which is the right size for the
// business end of an anchor line on a 34px hull.
export const SWEEP_R = 60;

// Seconds, read off the definition so the derivation lives with the hostile that has
// to be beaten. Floored well above a tick so a bad number cannot spin the loop.
export const windOf  = def => Math.max(0.05, sweepOf(def)?.wind  ?? 0);
export const swingOf = def => Math.max(0.05, sweepOf(def)?.swing ?? 0);
export const spanOf  = def => Math.max(0.01, sweepOf(def)?.span  ?? 0);
export const headOf  = def => Math.max(1,    sweepOf(def)?.r     ?? SWEEP_R);

// When the head reaches the middle of the arc, measured from the throw. This is both
// the aim solve's flight time and the pilot's budget, and they are the same number on
// purpose: a lead that predicted a different moment from the one the head arrives at
// would miss a pilot who did everything wrong.
export const strikeAt = def => windOf(def) + swingOf(def) / 2;

// WHAT ONE SWING CARRIES: the whole of the gun, boosted the same way a bolt is. The
// cadence is `1 / fireRate`, so `damage x fireRate` is what it delivers a second if
// every swing lands — which is exactly what happens to a pilot who holds a range, and
// exactly what threatDps has always claimed for this hostile.
export const lanceDamage = a =>
  Math.max(0, (a?.stats?.damage ?? 0) * boostOf(a?.power, 'weapons', a?.stats));

// Where the head is right now, in world coordinates, and how far through the swing it
// has got. Both sides want it — the client draws the thing and the test asserts on
// the arc — so it lives here and not in either of them.
export const headAt = w => {
  if (!w) return null;
  const g = w.g + (w.e - w.g) * Math.max(0, Math.min(1, w.p ?? 0));
  return { x: w.x + Math.cos(g) * w.d, y: w.y + Math.sin(g) * w.d, g };
};

// A LANCE, one tick of it. Returns null, or a swing to release on the single tick the
// wind-up ends.
//
// `a.cool` is the same clock fire() uses and combat.js hands it over rather than
// sharing it — see the gate at the top of fire(). Decrementing it in both places ran
// every orb-thrower's gun at twice its rate the first time this was done, and the
// bench read an Ironhusk at 142 dps against a book of 72.
//
// THE PIVOT DOES NOT FOLLOW THE HULL. It is where the Kedge was standing when the
// line went out, and it stays there for the 1.3s the attack takes. That is stepWave's
// measurement restated: a hostile drifts up to 80px while its own attack is in the
// air, and an arc that re-centred on the hull would slide its radius sideways off a
// pilot who had done everything right. The line is drawn from the pivot for the same
// reason — the marker and the thing it is marking being two different points is a bug
// this codebase has shipped twice, once at 61px.
export function stepSweep(a, b, dt) {
  const def = a?.def, S = sweepOf(def);
  if (!S) return null;
  a.cool = Math.max(0, a.cool - dt);
  // The muzzle glow, and it is decayed HERE because this hostile no longer calls
  // fire() at all. combat.js owns the only other copy of this line and it sits BELOW
  // the gate that sends a swinger home, so a hostile whose barrel became something
  // else holds a full flash for ever. That was live on every orb-thrower until it was
  // found; stepLob and stepWave both say the same thing, and this is the fourth.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  const reach = Math.max(1, a.stats?.weaponRange ?? 1);
  // The same `live` test fire() uses, and the same reach: this IS the barrel, so a
  // pilot who has backed off past 900 is outside it exactly as they were outside the
  // bolt it replaces.
  const live = b && b.hp > 0 && a.hp > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= reach;
  if (!live || a.cool > 0) return null;
  a.cool = 1 / Math.max(0.01, a.stats?.fireRate ?? 1);

  // THE INTERCEPT IS SOLVED IN ONE STEP AND NOT ITERATED, and that is the difference
  // between this and an orb or a glob. Those two solve `t = |target(t) - here| / S`
  // because their flight time depends on how far the throw turns out to be; a swing's
  // does not — the head arrives at the middle of the arc at `strikeAt` whatever the
  // range, so the flight time is known before the target is. One evaluation, exact.
  const t = strikeAt(def);
  let px = b.x + (b.vx ?? 0) * t, py = b.y + (b.vy ?? 0) * t;
  // AND WHILE IT IS HOLDING A SIGHTING, IT SWINGS THROUGH THE SIGHTING INSTEAD OF
  // THROUGH YOU. This is the one line that makes the two halves of this hostile one
  // fight rather than a gun beside an ability, and it is one line because both halves
  // were already about the same thing: WHERE YOU ARE STANDING.
  //
  // A Surveyor that has decided where it is going to put you would obviously aim there.
  // So the band and the fix marker sit on top of each other for the whole of the fuse —
  // one arc, one countdown ring, the same radius — and what a pilot sees is the trap
  // being set rather than two unrelated glows.
  //
  // WHAT IT COSTS, measured through the real loop against four ways of flying it, at the
  // stage this hostile is posted for and at the one above, 120s each, in test/kedge.mjs:
  //
  //                          fix off      fix on, aiming at you    fix on, aiming at it
  //     never moves            100%              100%                     100%
  //     radial metronome        37%               35%                      57%
  //     reads the wind-up       89%               18%                      26%
  //
  // The middle column is why this line exists. Without it a collapse is itself a radial
  // jink — it moves you off the radius the lance was paid out to — so the fix ANSWERED
  // the sweep instead of setting it up, and the pair came to less than either half. With
  // it, the naive radial weave is what gets punished (35 -> 57) and the pilot who reads
  // the wind-up still holds it to a quarter. That is the fight the two mechanics were
  // supposed to make.
  //
  // And it cannot move threat, which is the constraint everything here is under: a pilot
  // who never moved IS standing on their own sighting, so the two aim points are the
  // same point and holding station still costs 100% of the book, to the decimal.
  if (a.fixAt) { px = a.fixAt.x; py = a.fixAt.y; }
  // ITS FULL REACH AND NO FURTHER — orbs.js's rule about a projectile outliving its
  // own weapon range, read at a radius instead of at a ttl. A pilot running outward
  // drags the lead point past 900, and a hostile that cut somebody from a range it
  // cannot shoot from is the one thing a pilot holding range is entitled to rely on
  // not happening. Floored off the hull as well, so the line can never be paid out to
  // less than its own fluke and swing through the Kedge's own body.
  const want = Math.hypot(px - a.x, py - a.y);
  const d = Math.max((a.r ?? 0) + headOf(def), Math.min(reach, want));
  const mid = Math.atan2(py - a.y, px - a.x);
  const half = spanOf(def) / 2;
  a.shotFlash = SHOT_FLASH;
  a.sinceShot = 0;                                 // and there goes the veil
  return {
    x: a.x, y: a.y, d, r: headOf(def),
    // ALWAYS THE SAME WAY ROUND. plates.js says it about a lane that steps one wedge
    // anticlockwise every beat — "the direction never reverses, so there is nothing to
    // guess" — and it is worth more here, because a pilot deciding which way to break
    // radially should not also be guessing which end of the arc the head starts at.
    g: mid - half, e: mid + half,
    wind: windOf(def), swing: swingOf(def),
    t: 0, p: 0, on: 0,
    dmg: lanceDamage(a),
    // Sanctuary travels WITH the swing, by reference, exactly as an orb's does and a
    // sown patch's: the attack is on the field for 1.3s and the Kedge may be dead by
    // the time the head comes round, but who it was allowed to harm when the line went
    // out is still the right answer.
    by: a.provoked,
    // Everybody it has already cut. A lance sweeps a hull ONCE — it is a swing, not a
    // field — and without this the ship it caught would be caught again on every tick
    // the head is still inside its band, which at 84px of travel a tick is one tick on
    // most hulls and two on a Bulwark. That inconsistency is worse than either answer.
    hit: new Set(),
  };
}

// Advances every swing one tick and settles whatever the head crossed. Same shape as
// stepOrbs and stepWaves and for the same reasons — `bodies` is the
// `[{ id, ship, haven }]` list the AI is handed, and `may` is the sanctuary predicate
// passed in rather than imported, because "where is it safe to stand" is sim.js's rule
// and a second copy of it cost this codebase a day of a workshop dock that refused to
// sell anything.
//
// THE COLLISION IS THE SWEPT ARC AND NOT A POINT TEST, and that is the one place this
// file differs from orbs.js on purpose. orbs.js gets to test a point per tick because
// an orb covers 13px in one and the smallest hit disc is 54 — it cannot step over a
// ship. A head at the standoff covers 84px a tick against a 60px fluke, so a point
// test would fly straight through a Bulwark about half the time. What is checked
// instead is whether the body's BEARING falls inside the wedge swept this tick and its
// RADIUS inside the band, which is the exact swept region and costs one atan2 more.
//
// THE SEAM IS THE ASSERTION IN test/kedge.mjs: if the head is ever slowed to under a
// hull's width per tick the wedge test degenerates to the point test and nothing
// breaks, but the reverse — widening the span or shortening the swing — is what this
// shape is here to survive.
export function stepSweeps(list, bodies, dt, may = () => true) {
  const hits = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    w.t += dt;
    if (w.t < w.wind) { w.p = 0; w.on = 0; continue; }   // still winding: taut, not moving
    const was = Math.max(0, Math.min(1, (w.t - dt - w.wind) / w.swing));
    w.p = Math.max(0, Math.min(1, (w.t - w.wind) / w.swing));
    w.on = 1;
    // The wedge covered since the last tick, in world bearings. `was` is clamped at 0
    // so the tick the swing STARTS sweeps from the leading edge rather than from
    // wherever the wind-up remainder happened to land — otherwise a swing that began
    // mid-tick would quietly skip its first few degrees.
    const a0 = w.g + (w.e - w.g) * was, a1 = w.g + (w.e - w.g) * w.p;
    for (const c of bodies) {
      const tg = c?.ship ?? c;
      if (!tg || tg.hp <= 0) continue;
      const id = c?.id ?? tg.id;
      if (w.hit.has(id)) continue;
      const dx = tg.x - w.x, dy = tg.y - w.y, dist = Math.hypot(dx, dy);
      // The band first, because it is the cheap half and it is the half the pilot is
      // playing against: the hull's own radius counts, the same as it does for an orb
      // and a pyre — the circle you can see is the circle that catches you.
      if (Math.abs(dist - w.d) > w.r + (tg.r ?? 0)) continue;
      // And the wedge. The hull is a disc rather than a point, so it subtends an angle
      // at the pivot and that angle is added to both ends — without it a ship sitting
      // exactly on the leading edge is missed by its own radius, which is 3 degrees at
      // this range and reads as the head passing through somebody.
      const pad = Math.atan2(w.r + (tg.r ?? 0), Math.max(1, dist));
      let off = (Math.atan2(dy, dx) - a0) % (2 * Math.PI);
      if (off > Math.PI) off -= 2 * Math.PI;
      if (off < -Math.PI) off += 2 * Math.PI;
      const span = a1 - a0;
      const lo = Math.min(0, span) - pad, hi = Math.max(0, span) + pad;
      if (off < lo || off > hi) continue;
      // Cut, and marked cut WHATEVER happens next — before sanctuary is asked. A pilot
      // the head went past in a portal mouth must not be cut a tick later when the
      // geometry has moved on; standing in sanctuary is a dodge, not a delay. Same
      // rule stepWaves states about its lane, for the same reason.
      w.hit.add(id);
      if (!may(w, c)) continue;
      hits.push({ sweep: w, target: tg, who: id, dmg: w.dmg,
                  // Which way it arrived from, for the same two uses stepBolts,
                  // stepOrbs and stepWaves all have it: a pilot may be carrying plates
                  // one day and the bearing is worked out in one place so it cannot
                  // disagree. A lance comes from the PIVOT, which is the Kedge, and
                  // not from the head — the head is the far end of a line, and the
                  // thing that swung it is at the other end.
                  from: { a: Math.atan2(w.y - tg.y, w.x - tg.x), x: w.x, y: w.y } });
    }
    if (w.t >= w.wind + w.swing) list.splice(i, 1);
  }
  return hits;
}
