// The tether.
//
// A Lamprey has no gun. It opens a conduit onto a hull at range and pulls the
// hull across it, and what crosses it goes into its own plating. Everything about
// the fight comes out of three properties of that conduit and nothing else:
//
//   it does not miss        — a tether is not a projectile, so dodging is not an answer
//   it does not see shields — a shield stops momentum, and this is a gradient
//   it takes a SHARE        — of your maximum hull per second, not an amount
//
// The share is the whole design. Every other hostile in the game throws a fixed
// number of points a second, so the research ladder (x32 hull and shield) makes
// each of them 32 times safer; measured, content dps spans 4.4x against 6.4x of
// player effective hp and the gap is widening. A share cannot decay. A Lamprey
// costs a brand new Hauler and a x32 Bulwark exactly the same fraction of
// themselves per second, which is why it is the one hostile whose danger is a
// constant rather than a curve.

// Of the victim's MAXIMUM hull, per second, at full draw.
//
// ANCHORS.pressure in shared/balance.js is 0.045 — the share of your effective hp
// a hostile "on model" takes per second, which kills a pilot standing still in
// 22.2s at every stage. This is half of it, and the half is not a taste:
//
//   a model hostile's damage lands on effective hp, and about half of that is
//   shield, which comes back on its own in a few seconds. This lands on hull,
//   which comes back at a dock, out of a repair drone, or out of an Ore Foundry
//   and nowhere else. Taking half as much of a pool that does not refill is
//   already the harsher of the two.
//
// So: 44.4 seconds of unbroken tether empties any ship in the game. test/aliens.mjs
// asserts the halving against ANCHORS.pressure rather than against 0.0225, so
// moving the model moves this.
export const DRAIN_RATE = 0.0225;

// And it mends its OWN hull at the same share of its own maximum, while it draws.
//
// This is the number that had to stop being "what it takes". One for one is the
// obvious reading of a siphon and it is unshippable: at x32 research a Vanguard
// carries 68,640 hull, so a one-for-one tether would mend 1,544 a second against
// that pilot's 1,763 dps and the fight would never end — unwinnable, and, because
// you can always break the tether and leave, unloseable at the same time. Measured
// before it was changed: a x32 fighter took 268s and was still losing ground.
//
// Two shares of two different bodies. What crosses the conduit is set by the ship
// it is attached to; what it can knit back together is set by how big IT is. The
// fiction is that its throat is a fixed bore, and the arithmetic is that research
// can never make it harder to kill.
export const MEND_RATE = DRAIN_RATE;

// s from touch to full draw, and the same again to let go.
//
// CLOSER_HOLD in aliens.js is 3.0s — how long a second pilot has to crowd it
// before it switches targets — so a party that takes turns walking into it never
// lets the draw past 60%. That is the co-operative answer and it costs nothing to
// build: the target-switching rules were already there.
export const SPOOL = 5.0;

// A siphon's draw, 0..1, and what it moves this tick.
//
// `hold` is the caller's answer to "may this tether exist right now" — alive, in
// reach, and not standing in a haven. It is passed in rather than worked out here
// because sanctuary is sim.js's rule and this file must not keep a second copy of
// it; that is how the workshop dock ended up refusing to sell anything.
export function stepSiphon(a, victim, hold, dt) {
  const S = a?.def?.siphon;
  if (!S) return null;
  // Snap, do not fade. A tether that unwound slowly left a line stretching across
  // the sector behind a pilot who had already broken contact, and — worse — meant
  // breaking it bought you a fraction of what it cost you to break it. Letting go
  // is total, and it is the only thing in this fight that is.
  if (!hold || !victim) { a.draw = 0; a.drawOn = null; return null; }
  // A tether that changed ends without letting go would make a party WORSE than a
  // soloist: three pilots would just be three hulls fed through one conduit at full
  // draw. It re-seats from nothing on whoever it turned to, which is what turns the
  // target-switching rules already in aliens.js into a tank rotation.
  if (a.drawOn !== a.target) { a.draw = 0; a.drawOn = a.target; }
  a.draw = Math.min(1, (a.draw ?? 0) + dt / (S.spool ?? SPOOL));
  const rate = (S.rate ?? DRAIN_RATE) * a.draw;
  return {
    draw: a.draw,
    take: (victim.stats?.hull ?? 0) * rate * dt,           // off the victim's hull, past its shields
    mend: (a.stats?.hull ?? 0) * (S.mend ?? MEND_RATE) * a.draw * dt,
  };
}

// Whether the conduit can hold, given everything the caller already knows. Reach
// is measured hull-centre to hull-centre, the same as aggro and leash.
export const tetherHolds = (a, victim, haven) =>
  !!a?.def?.siphon && !!victim && victim.hp > 0 && !haven &&
  Math.hypot(victim.x - a.x, victim.y - a.y) <= (a.def.siphon.reach ?? 0);

// How often the drain says out loud what it took. One floating number every frame
// is thirty a second and unreadable; hull leaving with no number at all is
// indistinguishable from a bug, which is the complaint the damage numbers exist
// to answer in the first place.
export const DRAIN_TELL = 0.5;   // s
