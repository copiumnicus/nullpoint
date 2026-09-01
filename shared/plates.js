// An answering ring: armour plates that harden where you hit them and throw it
// back down the line you hit them from.
//
// WHAT THIS IS A GENERALISATION OF, because it is one and pretending otherwise
// would be a second copy of a mechanic this codebase already argued through.
// shared/aliens.js has MIRROR: a Thresher stores what you deal it in one chamber,
// bleeds it on a half-life, and its next bolt carries what the chamber holds. Every
// property that made that shippable is kept here word for word:
//
//   dimensionless    a plate's charge is a SHARE of the hostile's own hit points,
//                    so it is 0..1 by construction and the wire needs no
//                    normalising constant. MIRROR's second numbered reason.
//   a half-life      it bleeds continuously rather than dropping in one step, so
//                    easing off the trigger is visibly worth something.
//   the shop is the  what a full plate throws is MIRROR.dps — the same constant,
//   ceiling          not a copy of it. The ring can never throw anything the game
//                    does not already sell, which is MIRROR's third reason and the
//                    identity the Thresher's history says you must not break.
//
// And exactly one thing differs, which is the whole hostile: A MIRROR STORES OVER
// TIME AND ANSWERS AT YOU; A RING STORES PER BEARING AND ANSWERS ALONG ONE.
//
//                        Thresher's chamber          Antiphon's ring
//   how many             one                         `n`, one per bearing
//   filled by            anything that lands         what lands on THAT bearing
//   spent on             its ordinary bolt, aimed    a bolt down the bearing, not aimed
//   the answer to it     stop shooting               stop standing on one bearing
//   what a party does    nothing: it answers one     it answers one bearing per cycle,
//                        pilot's chamber either way  so four pilots split the answers
//
// The last row is why this exists. shared/balance.js's POSTING says in as many
// words that the deeps are not completable at any party size because GROUND DOES
// NOT DIVIDE — a pool burns everybody standing in it, so time-to-die is flat in
// party size while time-to-clear only falls as 1/n. A ring is the opposite by
// construction: it has one voice and answers one bearing at a time, so bringing a
// friend halves how often the answer is yours.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y and r.
// Both sides use it: the server charges the plates and fires the discharge, the
// client draws the ring — and `arcOf` is the reason the glowing wedge and the wedge
// that actually took your bolt are the same wedge. A plate you can see hot and
// cannot heat is the same bug as a row you can see and cannot click, and this
// codebase has shipped that twice.
//
// The one import is the WIRE, and it is deliberately this way round: how many plates
// there can be and how finely a charge is sent are facts about the snapshot, so
// net.js owns both and this file reads them. Declaring them here as well would be
// the same number in two places, which is the thing the whole of shared/ exists to
// prevent — and it would fail in the worst possible way, with the ring running one
// plate wider than the snapshot can carry.
import { PLATE_FIELDS, PLATE_STEPS } from './net.js';

// --- the ring on a definition ---------------------------------------------------
//
// Everything a hostile needs to have one is `def.plates`, exactly the way `def.sow`
// is the whole of sown ground and `def.returns` the whole of a mirror. A second
// hostile with a ring is a block of data in aliens.js rather than anything here.
// THAT IS THE SEAM, and its name is `plates`.
export const platesOf = def => def?.plates ?? null;

// How many, clamped to what the wire can carry. A definition asking for more plates
// than PLATE_FIELDS has columns would silently drop the last ones off the snapshot,
// and the client would draw a cold wedge that was about to fire — which is the one
// failure this whole file exists to prevent. Read off the field list rather than
// written down, so the two cannot be changed apart.
export const PLATE_MAX = PLATE_FIELDS.length - 1;
export const plateCount = def => Math.max(1, Math.min(PLATE_MAX, platesOf(def)?.n ?? 0));

// A PLATE HALVES IN ONE OF THE RING'S OWN ANSWERING CYCLES, and that is MIRROR.half
// restated rather than a second number: "the clock of this fight is its trigger, so
// the natural unit of break off for a moment is one answer it did not get to give."
// Derived from the hostile's own fireRate so the two cannot drift — moving the
// cadence moves the bleed with it, and the party arithmetic below depends on the
// ratio of the two being exactly 1.
export const plateHalf = def => 1 / Math.max(0.01, def?.attrs?.fireRate || 1);

// The points of damage into one bearing that fill one plate. A SHARE of the
// hostile's own hit points, for MIRROR's reason and not for tidiness: `plates` on
// the wire is an integer per plate, so a charge measured in points would need the
// client to be told a normalising constant, and a rule kept in two places is the
// one thing this codebase has learned always disagrees.
export const plateFill = def =>
  (platesOf(def)?.soak ?? 0) * ((def?.attrs?.hull ?? 0) + (def?.attrs?.shield ?? 0));

// --- geometry, which is a rule and not decoration -------------------------------
//
// Plate 0 is centred on due east and they run anticlockwise from there, in WORLD
// bearings rather than in the hull's own frame. That is deliberate and it is the
// only arrangement that works: a ring bolted to the hull would turn with it, and
// this hostile faces whatever it is fighting, so the plate in front of you would be
// the same plate however you flew. The ring is a compass, not a nose.
export const plateArc = def => 2 * Math.PI / plateCount(def);

// Which plate a bearing lands on. `ang` is a world bearing FROM the hostile TOWARD
// whatever is doing the hitting, which is the direction the answer goes back out.
export function plateAt(def, ang) {
  const n = plateCount(def), step = 2 * Math.PI / n;
  if (!Number.isFinite(ang)) return 0;
  return ((Math.round(ang / step) % n) + n) % n;
}
// And the middle of a plate, which is where it is drawn and what it aims down when
// nothing has hit it yet.
export const plateMid = (def, i) => i * 2 * Math.PI / plateCount(def);
// The wedge a plate occupies, for drawing. Same numbers the hit test uses, from the
// same two lines, so the glow and the plate cannot be different wedges.
export const arcOf = (def, i) => {
  const half = plateArc(def) / 2, mid = plateMid(def, i);
  return { from: mid - half, to: mid + half, mid };
};

// --- the live ring --------------------------------------------------------------
//
// `a.plates` is the charge on each plate, 0..1. `a.plateFrom` is the PLACE each one
// was last struck from — a point in the world, not an angle.
//
// A POINT AND NOT AN ANGLE, and this is the one thing in the file that was got wrong
// first and measured wrong on the bench. Storing the bearing looks equivalent and is
// not, because THE HOSTILE MOVES: a bearing is taken from where it was standing when
// the bolt landed, and by the time it answers a second later it has drifted up to
// 80px sideways, which slides the whole ray off a pilot who never moved at all.
// Measured, at a pilot's own gun range with the bench holding perfectly still: 47% of
// answers landed. A stationary pilot was dodging half of them by standing there,
// which is the mechanic exactly backwards — and it made circling WORSE than holding,
// because an orbiting pilot happened to drift the same way the hostile did.
//
// Anchoring the place instead makes "the line you were shooting from" a line in the
// world with your own last muzzle flash on the end of it, which is what a pilot
// actually sees. The hostile's own movement swings the ray to keep pointing at that
// spot, and the only thing that takes you off it is YOU.
//
// It stays on the server: the wedge is the tell and the bolt itself is the rest of
// it, so there is nothing here the wire has to carry twice.
export function newRing(def) {
  const n = plateCount(def);
  return { plates: new Array(n).fill(0), plateFrom: new Array(n).fill(null) };
}

// Bleed. Called once a tick, before anything reads the ring.
export function stepRing(a, dt) {
  const def = a?.def;
  if (!platesOf(def) || !a.plates) return;
  const k = Math.pow(2, -dt / plateHalf(def));
  for (let i = 0; i < a.plates.length; i++) {
    a.plates[i] *= k;
    // Otherwise it asymptotes and a wedge never draws cold — one pixel of glow says
    // "still loaded" to a pilot who has done everything right. Same guard, same
    // reason, as stepMirror's.
    if (!(a.plates[i] > 1e-4)) a.plates[i] = 0;
  }
}

// What a plate turns, at a given charge. THE RULE IS THAT A PLATE MAY NEVER TURN
// MORE THAN IT LETS THROUGH: past a half the armour is doing more work than the
// core and the plate has stopped being armour and started being immunity, which is
// a wall rather than a fight. `deflect` is therefore capped at 0.5 here as well as
// set to it in the bestiary, so a definition cannot quietly ask for a wall.
//
// This is the "the core is only vulnerable where the plates are soft" half of the
// pitch, and it is deliberately the SMALLER half — measured, a pilot walking their
// fire around the ring holds their plates near a fifth and loses about a tenth of
// their damage, against a half at the ceiling. The tell it buys is worth more than
// the throughput: your own floating damage numbers shrink on a plate you have been
// leaning on, which is the mechanic saying so in the one place a pilot is already
// looking.
export const deflectOf = def => Math.max(0, Math.min(0.5, platesOf(def)?.deflect ?? 0));
export const softAt = (a, ang) => {
  const def = a?.def;
  if (!platesOf(def) || !a.plates) return 1;
  const c = a.plates[plateAt(def, ang)] ?? 0;
  return Math.max(0, Math.min(1, 1 - deflectOf(def) * (Number.isFinite(c) ? c : 0)));
};

// Damage into a bearing hardens the plate on it, and the plate remembers the
// bearing. The amount is what ARRIVED, before the plate turned any of it: the pitch
// is "damage into one bearing raises that plate's soak", and charging off what got
// through instead would make a hot plate stop heating — a self-limiting armour that
// rewards exactly the pilot the ring exists to punish.
// `from` is where it came from: { a } the world bearing, and { x, y } the place. The
// bearing picks the plate and the place is what the answer is aimed back down.
export function storeBearing(a, amount, from) {
  const def = a?.def;
  const ang = from?.a;
  if (!platesOf(def) || !a.plates || !(amount > 0) || !Number.isFinite(ang)) return;
  const fill = plateFill(def);
  if (!(fill > 0)) return;
  const i = plateAt(def, ang);
  a.plates[i] = Math.min(1, (a.plates[i] ?? 0) + amount / fill);
  if (Number.isFinite(from.x) && Number.isFinite(from.y)) a.plateFrom[i] = { x: from.x, y: from.y };
}

// The hottest plate, which is the one that gets answered. Nothing decides this but
// the ring itself, and that is the party mechanic in one line: the loudest voice is
// the one answered, so a pilot doing the most damage takes the reply and the rest
// of the party does not.
export function hottest(a) {
  if (!a?.plates?.length) return -1;
  let best = -1, hot = 0;
  for (let i = 0; i < a.plates.length; i++) if (a.plates[i] > hot) { hot = a.plates[i]; best = i; }
  return best;
}

// What a discharge carries, in points, at a given charge. Exported because the
// client draws this number beside the ring and the server puts it in the bolt —
// payloadOf()'s arrangement, and for payloadOf()'s reason: a tell that disagreed
// with the hit would be worse than no tell.
//
// `dps / fireRate` is one answering cycle of the ceiling, so a FULL plate returns
// exactly what the sharpest gun in the shop delivers in the time it took to fill,
// and nothing the ring throws was ever unavailable to the pilot it threw it at.
export const dischargeOf = (def, charge = 0) =>
  Math.max(0, Math.min(1, charge || 0)) * (platesOf(def)?.dps ?? 0)
  / Math.max(0.01, def?.attrs?.fireRate || 1);

// HOW WIDE THE ANSWER IS, and it is one plate wide: the discharge leaves through the
// plate that threw it, so the width of that plate's face is the width of the bolt.
// `2 x pi x r / n` — 71px on a 90px hull with eight of them — which also means the
// plate count sets how demanding the dodge is, and not only how finely you can spread
// your fire. That is a second reason the count is a measurement.
//
// What it asks of a pilot, stated in the unit they fly in: the miss you buy is your
// own tangential speed times the round trip of your bolt out and the answer back.
// Measured at the 630px the Antiphon chooses to stand at, that round trip is 1.26s and
// a deep-shelf hull with its reactor on the gun is 94px off the line by then — clear
// of 71 plus a hull, and clear by six pixels, which is the right kind of margin: a
// pilot circling at two thirds of that speed is answered anyway. Up close the round
// trip collapses and so does the miss: at 260px it is 0.5s and 39px, which clears
// nothing. So reach buys the dodge and closing in spends it.
//
// It is a bolt field rather than a constant in combat.js because HIT_R is the slack
// on an AIMED shot and this is not aimed. Nothing else in the game sets `slack`, so
// nothing else changes.
export const spreadOf = def => Math.max(1, 2 * Math.PI * (def?.r ?? 1) / plateCount(def));

// Whether a plate is worth answering. One step of the wire's own resolution: below
// it the client draws nothing, so a discharge from a colder plate would be an answer
// with no tell in front of it — which is precisely what the Thresher's chamber was
// before it had a meter, and it read as a random one-shot for as long as it existed.
export const ANSWER_FLOOR = 1 / PLATE_STEPS;

// The whole of a tick's answering, so the server holds none of this rule itself.
// Returns the bolt to release, or null.
//
// WHERE IT GOES. Down the bearing the plate was struck from, at the range the
// victim is at NOW — so only the ANGLE is stale and the distance is not. That is
// the verb, exactly: standing still RELATIVE TO WHAT YOU ARE SHOOTING means holding
// a bearing, and backing off or closing in along the same line does not save you.
// The miss distance a pilot buys is their own tangential speed times how long the
// round trip took, which is why a hostile with this ring is a fight about turning
// rather than about range.
//
// It fires at whoever is nearest that line rather than at whoever heated it. Not a
// nicety — it is what makes a party's positioning matter: stand in a friend's lane
// and their answer is yours.
export function answer(a, dt, contenders = [], boltSpeed = 1000) {
  const def = a?.def, ring = platesOf(def);
  if (!ring || !a.plates) return null;
  a.pulse = Math.max(0, (a.pulse ?? 0) - dt);
  if (a.pulse > 0) return null;
  const i = hottest(a);
  if (i < 0 || !(a.plates[i] >= ANSWER_FLOOR)) return null;
  a.pulse = 1 / Math.max(0.01, def.attrs?.fireRate || 1);

  // The line, taken from where the plate was struck from and re-aimed from where the
  // hostile is standing NOW — see newRing for the measurement that says why it is a
  // place and not an angle. A plate that has never been struck answers down the middle
  // of its own wedge, which is the only bearing it has.
  const src = a.plateFrom?.[i];
  let bear = plateMid(def, i);
  if (src) {
    const dx = src.x - a.x, dy = src.y - a.y;
    if (Math.hypot(dx, dy) > 1) bear = Math.atan2(dy, dx);
  }
  const ux = Math.cos(bear), uy = Math.sin(bear);
  const reach = Math.max(1, ring.reach ?? 1);
  // Nearest the line, in front of it, inside the reach. Deliberately NOT filtered to
  // the plate's own wedge: the hostile has moved since the plate was struck, so the
  // line has swung with it and the place it points at is no longer guaranteed to be in
  // the wedge that stored it. Filtering on the wedge would drop exactly the answers
  // that were still correct.
  //
  // Nearest the LINE rather than whoever heated it, which is what makes a party's
  // positioning matter: stand in a friend's lane and their answer is yours.
  let best = null, bestOff = Infinity, bestD = reach;
  for (const c of contenders) {
    const s = c?.ship ?? c;
    if (!s || s.hp <= 0) continue;
    const dx = s.x - a.x, dy = s.y - a.y, d = Math.hypot(dx, dy);
    if (d > reach || d < 1) continue;
    if (dx * ux + dy * uy <= 0) continue;             // behind the ring: a different plate's business
    const off = Math.abs(dx * uy - dy * ux);          // perpendicular distance to the line
    if (off < bestOff) { bestOff = off; best = s; bestD = d; }
  }
  const charge = a.plates[i];
  const dmg = dischargeOf(def, charge);
  const at = best ? bestD : reach;
  // The plate goes dark whether or not anybody was standing there. A bolt into the
  // empty is the best tell the fight has: it is the ring saying out loud that you
  // were somewhere else when it answered.
  a.plates[i] = 0;
  // combat.js owns BOLT_SPEED and this file imports nothing, so the speed is handed
  // in rather than restated — the same arrangement public/audio.js is under, and for
  // the same reason. A discharge travels at the speed every other bolt does, which is
  // what makes "it is coming down that line" something a pilot can read off the screen.
  const travel = at / Math.max(1, boltSpeed);
  return { sx: a.x, sy: a.y, ax: a.x + ux * at, ay: a.y + uy * at,
           dmg, target: best, foe: true, w: Math.round(dmg), gr: 0,
           slack: spreadOf(def), plate: i,
           t: Math.max(0.001, travel), ttl: Math.max(0.001, travel) };
}
