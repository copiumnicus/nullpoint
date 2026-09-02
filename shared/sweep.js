// A LANCE ON A LINE, and it is the whole of the Kedge.
//
// A Kedge is a Surveyor. It used to have two things: a plain aimed bolt for 350 a
// second, and a fix that took a sighting of where you were standing and three seconds
// later put you back on it. Both are gone. The bolt went first, because an aimed bolt
// is not dodged by anybody — the table at the top of orbs.js measures 94% of what one
// fires landing on a hull weaving as hard as it can — and the fix went second, because
// it was the only mechanic in the game that moved a ship its owner was not flying.
//
// What is left is one attack: a taut line paid out to YOUR range with a fluke on the
// end of it, swung through an arc. The head is the thing that cuts you and the line is
// what it is on. Same 350 dps, same cadence, and nothing downstream moved —
// `damage x fireRate` is still what threatDps reads, still what a pilot who holds a
// range takes per second, and still what the bounty and the experience come out of.
//
// WHY THE DODGE IS RADIAL, WHICH IS THE ONE OF ITS KIND IN THIS BESTIARY. Every
// pattern in the game is answered by moving SIDEWAYS: get off the line of an Ironhusk's
// cone, walk the lane of an Antiphon's front, turn out of a solved intercept. A lance
// paid out to your own range cannot be answered that way and the arithmetic says so
// before anybody flies it — at 630px, walking out of the side of the arc asks for 795
// px/s and the hull that fights one flies at 142. What DOES answer it is changing your
// RANGE, because the line is only taut at one radius.
//
// AND WHY THE LENGTH VARIES. One fixed stand-off means one fixed rhythm, and a pilot
// learns a rhythm in about a minute. So the Kedge picks a new distance to stand at
// after every swing, from a band on its definition — and because the head travels at a
// fixed speed, the length decides everything else about the attack:
//
//     swing = span x reach / tip           a short lance crosses its arc quickly
//     wind  = 1/fireRate - swing           and lies taut for whatever is left
//
// So a SHORT one is a long warning and a fast swing, and a LONG one is a short warning
// and a slow swing. Measured at the two ends of the band, 405px and 630px: the head
// takes 0.30s to cross at the short end after 1.03s of warning, and 0.47s after 0.87s
// at the long end. Same hostile, two different questions, and which one you are about
// to be asked is on the screen for the whole wind-up.
//
// IT IS THE HOSTILE THAT MOVES AND NOT THE PAY-OUT, and that distinction is the whole
// reason this shape and not the obvious one. A lance that chose its own length
// independently of the pilot would simply MISS somebody who never moved — and "what a
// pilot who does not read the pattern takes is what the bolt cost" is the constraint
// every conversion in this bestiary is under. So the line still reaches you, always,
// and what wanders is where the Kedge decided to stand. It is 150 px/s against a
// cruiser's 142.4, so it gets there; see holdOf() and BACK_OFF in shared/aliens.js.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y, r and hp.
// Both sides import it: the server swings the lance, the client draws the arc, and this
// file is the reason those are the same wedge.

import { SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';

// The whole of a sweep on a definition is `def.sweep`, exactly the way `def.orbs` is
// the whole of a fan and `def.sow` the whole of sown ground. A second hostile that
// swings something is a block of data in aliens.js. THAT IS THE SEAM, and its name is
// `sweep`.
export const sweepOf = def => def?.sweep ?? null;

// A pilot is assumed to need this long to read a swing before they act on it. The same
// 0.35s orbs.js and ground.js both use, restated rather than imported for ground.js's
// reason: two hostiles' worth of pattern should not be able to move each other's
// numbers by accident.
export const SWEEP_READ = 0.35;   // s

// How big the head is, and it is a CEILING as much as a look — the budget below reads
// it, so a bigger fluke is a fluke a jink no longer beats. 60px is the largest ball
// this game already throws (a Leviathan's orb), which is the right size for the
// business end of an anchor line on a 34px hull.
export const SWEEP_R = 60;

export const spanOf = def => Math.max(0.01, sweepOf(def)?.span ?? 0);
export const headOf = def => Math.max(1,    sweepOf(def)?.r    ?? SWEEP_R);
// How fast the HEAD travels, in px/s. Everything about the timing falls out of it.
export const tipOf  = def => Math.max(1,    sweepOf(def)?.tip  ?? 1);
// The cycle the whole attack has to fit inside, which is the cadence threatDps reads.
export const cycleOf = def => 1 / Math.max(0.01, def?.attrs?.fireRate ?? 1);

// --- the three numbers, and every one of them is pinned ---------------------------
//
// THE TIP SPEED IS THE ONLY ONE THAT IS CHOSEN, and it is chosen by one rule: the
// longest swing this hostile can produce may take no more than HALF its firing cycle.
// The line therefore lies taut for at least as long as it moves, at every reach, so the
// warning is never shorter than the thing it is warning about.
//
//     tip  >=  span x weaponRange / (cycle / 2)  =  2.4 x 900 / 0.6667  =  3240 px/s
//
// THE BUDGET falls out of it. The aim solve below puts the target in the MIDDLE of the
// arc, so the head arrives at their bearing half a swing after it starts moving, and
// what they have to do inside that is clear the head's own disc plus their hull,
// radially:
//
//     wind + swing/2  =  cycle - swing/2  >=  READ + (sweep r + hull r) / v
//
// The hull this is posted against is a cruiser — shared/balance.js POSTING, "the pilot
// a Thresher one-shots" — which is a Bulwark at 142.4 px/s with its reactor NOT on its
// engines, and 17px of hull against a 60px head:
//
//     0.35 + 77 / 142.4  =  0.891s
//
// At the FULL reach that budget is exactly 1.000s, because `cycle - swing/2` with a
// half-cycle swing is three quarters of a cycle — 109ms of margin, which is 16px at
// that speed. Every shorter reach has more: 1.183s at the short end of the band. So the
// tip speed is set by the worst case and every other case is a gift, which is the right
// way round.
//
// THE SPAN IS DERIVED FROM THE OTHER DIRECTION: nothing may walk out of the SIDE of it
// at the range this hostile used to stand at, because if something could, the radial
// answer would be optional and the mechanic would be a cone with extra steps. The
// fastest thing in the game boosted is 559 px/s and the whole attack is one cycle, so
// that is 745px of arc at 630px:
//
//     span  >=  2 x 745 / 630  =  2.37 rad
//
// 2.4, then. Read it at the SHORT end of the band and it says the other half of what
// this rework is for: at 405px the same arc is 486px of ground, so anything over 365
// px/s does walk out of the side of it — a Kestrel, a Vanguard, a fitted interceptor,
// and nothing heavier. A short lance is side-stepped by a light hull and a long one is
// not, which is two different questions out of one number.

// Seconds the head takes to cross the arc, at the reach it is paid out to.
export const swingOf = (def, d) => Math.max(0.01, spanOf(def) * Math.max(0, d) / tipOf(def));
// And seconds the line lies taut first: whatever is left of the cycle. Floored above a
// tick so a reach past anything the definition can produce cannot make it negative.
export const windOf = (def, d) => Math.max(0.05, cycleOf(def) - swingOf(def, d));
// When the head reaches the middle of the arc, measured from the throw. This is both
// the aim solve's flight time and the pilot's budget, and they are the same number on
// purpose: a lead that predicted a different moment from the one the head arrives at
// would miss a pilot who did everything wrong.
export const strikeAt = (def, d) => windOf(def, d) + swingOf(def, d) / 2;

// The band it picks a new stand-off from after every swing, in px. Read off the
// definition as a share of the reach, so moving the reach moves the band with it.
//
//   the top    0.70, which is EXACTLY where this hostile used to stand — standOff's own
//              70% — and it is the one number here that was measured rather than
//              argued. It was 0.95 for one draft, on the theory that a wider band is
//              more variety, and it is unshippable: a Kedge flies at 150 px/s against
//              the 142.4 of the hull it is posted for, so a hostile that backs off to
//              855 wins that race for ever and sits outside every gun in the shop
//              (620-820) lancing a pilot who cannot reach it. Measured through the real
//              claim bench, that draft took mine3 from 12 of 12 cleared with 8% of the
//              ship left to SEVEN of twelve with 1%, and the reason was not damage — it
//              was that the thing had walked out of the fight and kept shooting.
//              Capping the band at where it already stood means nothing about "can I
//              shoot it back" changed, and all the variety is on the near side.
//   the bottom 0.45. It is not constrained by the dodge — a short lance has MORE
//              budget, not less — so it is set by the fight: 405px is inside every gun
//              in the shop with 215px to spare, so at its closest this thing is a
//              target anybody can answer, and it is under the 621px at which a Kestrel
//              stops being able to walk out of the side of the arc, which is what makes
//              a short lance a different question from a long one.
export const holdBand = def => {
  const b = sweepOf(def)?.hold ?? [0.7, 0.7];
  const reach = Math.max(1, def?.attrs?.weaponRange ?? 1);
  return [Math.min(b[0], b[1]) * reach, Math.max(b[0], b[1]) * reach];
};

// Picks the next one. `rand` is the hostile's OWN seeded generator, which is what makes
// this reproducible in a test and unreadable from a cockpit: a pilot cannot count the
// pattern, they have to look at the line. Math.random() would have been the same thing
// from the cockpit and untestable from here.
export const pickHold = a => {
  const [lo, hi] = holdBand(a?.def);
  return lo + (a?.rand ? a.rand() : 0.5) * (hi - lo);
};

// WHAT ONE SWING CARRIES: the whole of the gun, boosted the same way a bolt is. The
// cadence is `1 / fireRate`, so `damage x fireRate` is what it delivers a second if
// every swing lands — which is exactly what happens to a pilot who holds a range, and
// exactly what threatDps has always claimed for this hostile.
export const lanceDamage = a =>
  Math.max(0, (a?.stats?.damage ?? 0) * boostOf(a?.power, 'weapons', a?.stats));

// Where the head is right now, in world coordinates, and how far through the swing it
// has got. Both sides want it — the client draws the thing and the test asserts on the
// arc — so it lives here and not in either of them.
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
// every orb-thrower's gun at twice its rate the first time this was done, and the bench
// read an Ironhusk at 142 dps against a book of 72.
//
// THE PIVOT DOES NOT FOLLOW THE HULL. It is where the Kedge was standing when the line
// went out, and it stays there for the whole attack. That is stepWave's measurement
// restated: a hostile drifts up to 80px while its own attack is in the air, and an arc
// that re-centred on the hull would slide its radius sideways off a pilot who had done
// everything right. The line is drawn from the pivot for the same reason — the marker
// and the thing it is marking being two different points is a bug this codebase has
// shipped twice, once at 61px.
export function stepSweep(a, b, dt) {
  const def = a?.def, S = sweepOf(def);
  if (!S) return null;
  a.cool = Math.max(0, a.cool - dt);
  // The muzzle glow, and it is decayed HERE because this hostile no longer calls fire()
  // at all. combat.js owns the only other copy of this line and it sits BELOW the gate
  // that sends a swinger home, so a hostile whose barrel became something else holds a
  // full flash for ever. That was live on every orb-thrower until it was found; stepLob,
  // stepWave, throwShards and stepPod all say the same thing.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  // And it takes up a distance the moment it has somebody, so the FIRST swing of a fight
  // is already at a range it chose rather than at the 70% every other hostile uses.
  if (b && a.hold === undefined) a.hold = pickHold(a);
  const reach = Math.max(1, a.stats?.weaponRange ?? 1);
  // The same `live` test fire() uses, and the same reach: this IS the barrel, so a pilot
  // who has backed off past 900 is outside it exactly as they were outside the bolt it
  // replaces.
  const live = b && b.hp > 0 && a.hp > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= reach;
  if (!live || a.cool > 0) return null;
  a.cool = cycleOf(def);

  // THE INTERCEPT IS SOLVED IN TWO PASSES, and that is the difference between this and
  // a bolt, an orb or a glob. Those solve for a flight time that depends on how far the
  // throw turns out to be; a swing's depends on the REACH it is paid out to, which
  // depends on where the target will be, which depends on the flight time. So the first
  // pass guesses from where the target is now and the second corrects with the reach the
  // first pass produced. It converges immediately because `strikeAt` moves by at most
  // half a swing over the whole band — 0.16s across 450px of reach — and a third pass
  // moves the aim point by under a pixel.
  let t = strikeAt(def, Math.hypot(b.x - a.x, b.y - a.y));
  let px = b.x + (b.vx ?? 0) * t, py = b.y + (b.vy ?? 0) * t;
  t = strikeAt(def, Math.hypot(px - a.x, py - a.y));
  px = b.x + (b.vx ?? 0) * t; py = b.y + (b.vy ?? 0) * t;
  // ITS FULL REACH AND NO FURTHER — orbs.js's rule about a projectile outliving its own
  // weapon range, read at a radius instead of at a ttl. A pilot running outward drags
  // the lead point past 900, and a hostile that cut somebody from a range it cannot
  // shoot from is the one thing a pilot holding range is entitled to rely on not
  // happening. Floored off the hull as well, so the line can never be paid out to less
  // than its own fluke and swing through the Kedge's own body.
  const want = Math.hypot(px - a.x, py - a.y);
  const d = Math.max((a.r ?? 0) + headOf(def), Math.min(reach, want));
  const mid = Math.atan2(py - a.y, px - a.x);
  const half = spanOf(def) / 2;
  a.shotFlash = SHOT_FLASH;
  a.sinceShot = 0;                                 // and there goes the veil
  // AND IT PICKS SOMEWHERE NEW TO STAND, for the next one. After the throw rather than
  // before it, so the swing that is about to happen is the one the pilot has been
  // watching the Kedge set up rather than one aimed from a distance it took a
  // millisecond ago.
  a.hold = pickHold(a);
  return {
    x: a.x, y: a.y, d, r: headOf(def),
    // ALWAYS THE SAME WAY ROUND. plates.js says it about a lane that steps one wedge
    // anticlockwise every beat — "the direction never reverses, so there is nothing to
    // guess" — and it is worth more here, because a pilot deciding which way to break
    // radially should not also be guessing which end of the arc the head starts at.
    g: mid - half, e: mid + half,
    wind: windOf(def, d), swing: swingOf(def, d),
    t: 0, p: 0, on: 0,
    dmg: lanceDamage(a),
    // WHOSE IT IS, as an index into the bestiary, so the client can draw it in the
    // colour of the thing that swung it. Every projectile in this game carries one now;
    // see kindIx() in shared/aliens.js for why an index rather than a colour.
    k: a.kx ?? 0,
    // Sanctuary travels WITH the swing, by reference, exactly as an orb's does and a
    // sown patch's: the attack is on the field for over a second and the Kedge may be
    // dead by the time the head comes round, but who it was allowed to harm when the
    // line went out is still the right answer.
    by: a.provoked,
    // Everybody it has already cut. A lance sweeps a hull ONCE — it is a swing, not a
    // field — and without this the ship it caught would be caught again on every tick
    // the head is still inside its band, which at 108px of travel a tick is one tick on
    // every hull in the game. That inconsistency is worse than either answer.
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
// ship. A head at 3,240 px/s covers 108px a tick against a 60px fluke, so a point test
// would fly straight through a Bulwark most of the time. What is checked instead is
// whether the body's BEARING falls inside the wedge swept this tick and its RADIUS
// inside the band, which is the exact swept region and costs one atan2 more.
export function stepSweeps(list, bodies, dt, may = () => true) {
  const hits = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    w.t += dt;
    if (w.t < w.wind) { w.p = 0; w.on = 0; continue; }   // still winding: taut, not moving
    const was = Math.max(0, Math.min(1, (w.t - dt - w.wind) / w.swing));
    w.p = Math.max(0, Math.min(1, (w.t - w.wind) / w.swing));
    w.on = 1;
    // The wedge covered since the last tick, in world bearings. `was` is clamped at 0 so
    // the tick the swing STARTS sweeps from the leading edge rather than from wherever
    // the wind-up remainder happened to land — otherwise a swing that began mid-tick
    // would quietly skip its first few degrees.
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
      // geometry has moved on; standing in sanctuary is a dodge, not a delay. Same rule
      // stepWaves states about its lane, for the same reason.
      w.hit.add(id);
      if (!may(w, c)) continue;
      hits.push({ sweep: w, target: tg, who: id, dmg: w.dmg,
                  // Which way it arrived from, for the same two uses stepBolts, stepOrbs
                  // and stepWaves all have it: a pilot may be carrying plates one day and
                  // the bearing is worked out in one place so it cannot disagree. A lance
                  // comes from the PIVOT, which is the Kedge, and not from the head — the
                  // head is the far end of a line, and the thing that swung it is at the
                  // other end.
                  from: { a: Math.atan2(w.y - tg.y, w.x - tg.x), x: w.x, y: w.y } });
    }
    if (w.t >= w.wind + w.swing) list.splice(i, 1);
  }
  return hits;
}
