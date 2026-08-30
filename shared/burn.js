// A field that hurts to stand in, and the one number that describes it.
//
// Every hostile before this one delivers its damage as a bolt: a flat number, per
// shot, at a range. That model has an end, and the research ladder found it — a
// finished ship at x32 is 195,200 effective hit points and a Drifter's 49.5 dps
// needs 4,558 seconds to get through it. A flat number cannot be made to matter at
// both ends of a 32x span in hull without being lethal at one of them.
//
// So a Censer's field is a RATE: a share of whatever is standing in it, per second.
// The share is `rate`, and it is not a new number — it is ANCHORS.pressure, the
// balance model's own definition of what a hostile on model does to you ("4.5% of
// you a second, so it kills a pilot who stands still in 22 seconds, whatever they
// fly"). Every other hostile approximates that rate with a flat number that is only
// true at one stage. This one is the rate.
//
// Nothing here knows what a ship is beyond `hull + shield`, and nothing here does
// I/O. Both sides import it: the server decides who is being burned, the client
// draws the circle, and burnR() is the reason those are the same circle.

const clamp01 = v => (v > 1 ? 1 : v > 0 ? v : 0);

export const burnOf = def => def?.burn ?? null;

// How wide the ring is right now.
//
// ONE definition, because the client draws this circle and the server damages
// inside it. A ring you can see and not be hurt by is the same bug as a row you
// can see and cannot click, and this codebase has shipped that twice.
export function burnR(def, spin) {
  const b = burnOf(def);
  if (!b) return 0;
  return b.idle + (b.reach - b.idle) * clamp01(spin);
}

// Spin, 0..1, and the whole fight is in this function.
//
// Three rates, and each is a sentence:
//
//   hunting somebody winds it up          +dt/up
//   somebody standing in it, twice as     +dt/up again
//   having nobody at all settles it       -dt/down
//
// So it takes `up` seconds to wind all the way up while you keep out of the ring,
// half that if you let it have you, and `down` to go cold once it has lost you.
//
// It has to climb on a CLOCK and not only on damage. A field driven by damage alone
// inverts the difficulty — the weaker your gun the slower it winds up, so the pilot
// least able to kill it is the one it never touches, and a starter Hauler out-farms
// a finished Bulwark. And it has to climb on damage too, because a x32 rack kills it
// in under four seconds and a clock cannot bill anybody in four seconds. One term
// each, and between them the fight is the same shape at both ends of the ladder.
//
// What it does NOT do is settle while it still has you. Backing out of the ring buys
// you the difference between the two rates and nothing more: it keeps coming. The
// answers are to finish it, to eat the field, or to break the engagement outright —
// which is the Leviathan's shape, and it is deliberate that a hostile with no gun
// asks the same question a hostile you cannot out-range does.
//
// `engaged` is whether it has anybody at all; `occupied` is whether anybody it may
// harm is inside the ring. Both are the caller's to work out, because who is in
// sanctuary is the caller's business and this file has no opinion about havens.
export function stepBurn(a, engaged, occupied, dt) {
  const b = burnOf(a?.def);
  if (!b) return 0;
  const up = Math.max(0.01, b.up), down = Math.max(0.01, b.down);
  const per = engaged ? dt / up + (occupied ? dt / up : 0) : -dt / down;
  a.spin = clamp01((a.spin ?? 0) + per);
  return a.spin;
}

// How long it takes to wind all the way up with somebody standing in it, against the
// `up` it takes while they keep clear. Derived, so moving `up` moves both.
export const dwellSecs = def => (burnOf(def)?.up ?? 0) / 2;

// And the other half: your own gun winds it up.
//
// `goad` is full spin per its own effective hit points taken off it, so an
// undivided kill arrives at exactly full spin however hard you hit — the fraction
// is of the reactor, not of your damage, so a x32 rack and a starter rack wind it
// up by the same amount for the same share of the fight. That is what makes the
// ring a health bar you are standing inside.
//
// Called from wherever an alien's damage ledger is written, alongside storeHit —
// the two are the same idea, one stored and one spent immediately.
export function goadBurn(a, amount, ehp) {
  const b = burnOf(a?.def);
  if (!b || !(amount > 0) || !(ehp > 0)) return;
  a.spin = clamp01((a.spin ?? 0) + (amount / ehp) * b.goad);
}

// What it takes off a ship of `ehp` effective hit points this tick, if that ship is
// inside the ring. A share per second, times how wound up it is.
export function burnBite(def, spin, ehp, dt) {
  const b = burnOf(def);
  if (!b) return 0;
  return b.rate * clamp01(spin) * Math.max(0, ehp) * Math.max(0, dt);
}

// And what it lets go of when it dies.
//
// Not a chosen number: it is the field's remaining fuel. Left alone, the ring would
// have spent `down` seconds decaying linearly to nothing, and the integral of that
// is rate x spin x ehp x down / 2. It releases exactly what it was still holding —
// so a reactor you cooled first goes off small, and one you never stopped shooting
// goes off at full yield, inside its full reach, on top of whoever finished it.
export const burstSecs = def => (burnOf(def)?.down ?? 0) / 2;
export function burnBurst(def, spin, ehp) {
  const b = burnOf(def);
  if (!b) return 0;
  return b.rate * clamp01(spin) * Math.max(0, ehp) * burstSecs(def);
}

// The pyre a dying Censer leaves standing for `fuse` seconds before it goes.
//
// The fuse is the whole reason this is a fight rather than a toll. Without it the
// burst is a flat tax on the kill: it lands at the ring's radius, and the ring at
// full spin is wider than every hull's reach, so nobody can be anywhere else and
// the number is the same for a pilot who flew well and one who did not. Measured
// with no fuse, holding at 95% of your reach against 50% of it changed the fight by
// six percentage points — which is to say position had stopped meaning anything,
// and a threat you cannot answer is the definition of annoying.
//
// With one, the ring you have been backing away from all fight is the distance you
// have to cover in `fuse` seconds, from wherever your gun made you stand. That is
// what turns range discipline from a preference into the answer.
export const pyreFor = (a, ehp) => ({
  x: a.x, y: a.y, r: burnR(a.def, a.spin ?? 0) * (burnOf(a.def)?.blast ?? 1), spin: clamp01(a.spin ?? 0),
  dmg: burnBurst(a.def, a.spin ?? 0, ehp),
  t: burnOf(a.def)?.fuse ?? 0, ttl: Math.max(0.001, burnOf(a.def)?.fuse ?? 0.001),
});
export const inPyre = (p, s) => Math.hypot(s.x - p.x, s.y - p.y) <= p.r + (s.r ?? 0);

// The effective hit points of whatever is standing in it. Aliens and ships both
// carry `stats`, so this reads either — and it is the BASE pool rather than the
// boosted one, so routing power to shields still buys you something against a
// field that takes a share.
export const poolOf = s => (s?.stats?.hull ?? 0) + (s?.stats?.shield ?? 0);

// Is this ship inside the ring?
export const inBurn = (a, s) =>
  !!burnOf(a?.def) && Math.hypot(s.x - a.x, s.y - a.y) <= burnR(a.def, a.spin ?? 0) + (s.r ?? 0);
