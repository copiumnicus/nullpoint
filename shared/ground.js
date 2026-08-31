// Sown ground.
//
// Everything in the bestiary until now happens where the hostile is. A bolt leaves
// its barrel, a ring is centred on the reactor, a tether is a line back to a mouth,
// a fix is undone the moment you kill the thing holding it. All of it dies with the
// animal. The deeps are where that stops being true: two hostiles out there fight
// by taking PLACES away from you, and the places stay after the thing that made
// them has moved on or died.
//
// WHY THIS IS NOT THE CENSER AGAIN. A Censer's ring is a property of the Censer —
// it is centred on the hull, it follows the hull, it is one circle, and its radius
// is that hull's health bar drawn at the scale you are standing in. Read the two
// side by side:
//
//                       Censer's ring            sown ground
//   where               on the hostile           where it was put
//   how many            exactly one              up to `max`, at once
//   what it says        how dead it is           where you may not stand
//   when it ends        when the fight does      `life` seconds later, regardless
//   the answer          hold your own range      keep moving, and pick your line
//
// A ring is a fight you hold at arm's length. Ground is a fight where the arm's
// length keeps getting taken away from you, one patch at a time.
//
// TWO KINDS, ONE FILE. A Vitriol lays Aqua Regia — a pool that eats whatever stands
// in it — and a Doldrum lays Slack Water, which barely burns at all and instead
// cuts your engines the moment you cross into it. They are one module because they
// are one object with two numbers filled in differently: a place, a radius, a
// lifetime, a rate and a hold. A third kind later is a row in a definition, not a
// second copy of all this. That is the seam, and `hold` and `rate` are its names.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y, r and a
// pool of hit points. Both sides import it: the server damages inside the patch and
// the client draws it, and `inGround` is the reason those are the same circle. A
// circle you can see and not be hurt by is the same bug as a row you can see and
// cannot click, and this codebase has shipped that twice.

import { MAP_W, MAP_H } from './maps.js';
// JUMP_TIME is sim.js's — the three seconds a portal takes to spool. Both clocks
// below are read off it rather than written down again, so moving the door moves
// the root and the test that pins it.
import { JUMP_TIME } from './sim.js';

export const sowOf = def => def?.sow ?? null;

// --- the two clocks that make a root shippable --------------------------------
//
// This game has never taken movement away from a player and it is not about to
// start. shared/kedge.js says the quiet part out loud — "Maximum time without
// control from a fix: zero seconds, and that is the whole reason this is allowed to
// exist in a game where the alternative was a stun" — and a stun is still the wrong
// answer. What Slack Water takes is narrower and it is stated exactly:
//
//   YOUR ENGINES, NOT YOUR SHIP. Thrust is refused for HOLD seconds. Momentum is
//   kept in full — no drag, no braking, no turn — so a ship that was going
//   somewhere carries on going there at exactly the speed it had. You still shoot,
//   still pick targets, still launch, still run a repair drone, still hold a portal
//   mouth, still finish a Recall Beacon. What you cannot do is CHANGE YOUR MIND.
//
// Which is what makes it a combo rather than a nuisance: the answer to a pool of
// Aqua Regia is to steer out of it, and this is the one thing in the game that
// takes steering away. It is also why the counter is legible from the cockpit and
// costs nothing to learn — before you cross a still, be pointed somewhere you would
// be happy to be in a second and a half.
//
// HOLD is half of JUMP_TIME, and the half is the argument. Three seconds is this
// game's unit of a decision you have already committed to: a portal's spool, a
// Kedge's fuse. A hold as long as one of those could deny a pilot a door they had
// already opened, and sanctuary is the one promise this game keeps. Half of it is
// the longest hold that always leaves time to finish what you started.
export const HOLD = JUMP_TIME / 2;                 // 1.5s

// And CALM is the whole of it: after every hold, a pilot is owed one full portal
// spool of guaranteed thrust before any patch may touch them again.
//
// It is not decoration and it is not politeness. Two stills overlapping, or one
// still and a pilot who keeps drifting back over its rim, is a perma-root by
// arithmetic unless something refuses — and a root that can be chained is not
// shippable at any duration. With these two numbers the worst case any arrangement
// of stills, hostiles or pilots can produce is stated and bounded:
//
//   longest unbroken engines-out  =  HOLD                        = 1.5s
//   thrust owed after every hold  =  CALM                        = 3.0s
//   engines out over t seconds    <= HOLD + t x HOLD/(HOLD+CALM)
//
// The first two are exact and hold whatever is standing on the field. The third is
// the first two added up and it is deliberately NOT stated as a flat third: a
// window that opens mid-hold pays for that hold as well, so the worst ten seconds
// a pilot can be handed is 4.0s of coasting and not 3.3s. Measured, not assumed.
// test/ground.mjs brute-forces the arrangements and asserts all three.
export const CALM = JUMP_TIME;                     // 3.0s

// May this ship be held right now? One predicate, because both halves of the
// guarantee above are this question and a second copy of it would disagree — which
// is how the workshop dock spent a day refusing to sell anything.
//
// Already held is refused as flatly as still owed calm. Without the first clause a
// second patch could re-arm the clock every tick a ship was inside it, and 1.5
// seconds would quietly become forever.
export const mayHold = s => !((s?.snare ?? 0) > 0) && !((s?.calm ?? 0) > 0);

// Puts the engines out. The calm is set when the hold ENDS rather than here, so a
// pilot who is held for the full 1.5s and one who is held for a tick both get the
// same three seconds afterwards.
export function holdEngines(s, secs = HOLD) {
  s.snare = Math.max(0, secs);
  s.calm = 0;
}

// Both clocks, advanced wherever ships are advanced. Called after step(), so the
// tick a hold is spent is a tick with no thrust in it.
export function stepSnare(s, dt) {
  if ((s.snare ?? 0) > 0) {
    s.snare = Math.max(0, s.snare - dt);
    if (s.snare === 0) s.calm = CALM;              // and now you are owed a spool of control
  } else if ((s.calm ?? 0) > 0) {
    s.calm = Math.max(0, s.calm - dt);
  }
}
export const held = s => (s?.snare ?? 0) > 0;

// --- laying it -----------------------------------------------------------------

// The wind-up, 0..1, and where the patch will land.
//
// `wind` on a definition is HOLD — the same 1.5 seconds — and that equality IS the
// combo, written as one number rather than as a special case. A pilot who is not
// held has exactly enough warning to be somewhere else. A pilot who is held has
// exactly none, because the two clocks are the same clock.
//
// The place is taken when the wind-up STARTS, on the victim's position, exactly
// the way a Kedge's sighting is: laying it where the target will be at the end
// would be undodgeable, and laying it on the hostile would be a ring, which this
// bestiary already has one of.
//
// Returns null, or { at } on the single tick the patch drops. The caller makes the
// patch, because making things is the server's job.
export function stepSow(a, victim, hold, dt) {
  const S = sowOf(a?.def);
  if (!S) return null;
  if (!hold || !victim) { a.sow = 0; a.sowOn = null; a.sowAt = null; return null; }
  // Re-seating on a new victim starts from nothing, the way a tether and a fix
  // both do. Otherwise a party would be worse than a soloist: three pilots fed
  // through one wind-up, and a patch landing on somebody who never saw it start.
  if (a.sowOn !== a.target) { a.sow = 0; a.sowOn = a.target; a.sowAt = null; }
  if ((a.sowCool ?? 0) > 0) { a.sowCool = Math.max(0, a.sowCool - dt); a.sow = 0; a.sowAt = null; return null; }
  a.sowAt ??= sowPoint({ x: victim.x, y: victim.y });
  a.sow = Math.min(1, (a.sow ?? 0) + dt / Math.max(0.01, S.wind ?? HOLD));
  if (a.sow < 1) return null;
  const at = a.sowAt;
  a.sow = 0; a.sowAt = null;
  // `every` is the cadence and it is life / max rather than a number anybody
  // picked, so a definition cannot ask for more patches than it is allowed to
  // have — see the note on `max` in aliens.js. The cooldown runs from the DROP,
  // and the wind-up is inside it, so a Vitriol's real cadence is `every` and not
  // `every + wind`.
  a.sowCool = Math.max(0, (S.every ?? 0) - (S.wind ?? HOLD));
  return { at };
}

// Clamped to charted space, exactly where driftDepth() stops being zero, for the
// same reason a fix is: ground sown in the shear is ground nobody can be asked to
// leave. Applied when the sighting is TAKEN, so the marker everyone can see and
// the circle that burns are the same point — 61px apart is the bug this shape of
// function was written to end, and it was found live.
export const sowPoint = at => ({
  x: Math.max(0, Math.min(MAP_W, at.x)),
  y: Math.max(0, Math.min(MAP_H, at.y)),
});

// Whether ground may be laid at all, given everything the caller already knows.
// Sanctuary is passed in rather than worked out here, because who is in a haven is
// sim.js's rule and this file must not keep a second copy of it.
export const sowHolds = (a, victim, haven) =>
  !!sowOf(a?.def) && !!victim && victim.hp > 0 && !haven;

// A patch, from the definition that sowed it and the point it was sown on.
//
// `by` is the sower's provoked set, carried by REFERENCE rather than copied. That
// is the whole of how sanctuary survives the thing that made the patch: mayHarm()
// asks whether this pilot provoked the owner, and the answer has to keep being
// right for the twenty seconds a pool outlives a Vitriol somebody has killed. A
// copy would freeze the answer at the moment of sowing; an owner id would be a
// second lookup and a dangling reference the moment the sector repopulates.
export const groundFor = (a, at) => {
  const S = sowOf(a.def);
  return {
    x: at.x, y: at.y, r: S.r, kind: S.kind,
    rate: S.rate ?? 0, hold: S.hold ?? 0,
    t: S.life, ttl: Math.max(0.001, S.life),
    by: a.provoked,
    in: new Set(),        // who is standing in it right now — see touch()
  };
};

// Is this ship inside it? Hull radius counts, the same as a ring and a pyre: the
// circle you can see is the circle that catches you.
export const inGround = (g, s) =>
  Math.hypot(s.x - g.x, s.y - g.y) <= g.r + (s.r ?? 0);

// Everything one patch does to one ship on one tick, and the only place the entry
// ledger is written. Named for burnBite, which is the same idea one rung in.
//
// `id` names the ship to this patch; `inside` and `ehp` are the caller's, because
// sanctuary is sim.js's rule and how big a ship is is the caller's arithmetic.
//
//   burn — a SHARE of the ship per second, never an amount. Every flat number in
//          this game is only true at one stage: research spans x32 in hull and
//          shield, so 4.5% of a pilot is 4.5% of a pilot at the bottom of the
//          ladder and at the top, and a bolt for 150 is neither. This is the
//          Censer's rule and the Lamprey's, one rung further out.
//
//   hold — non-zero on exactly the tick a ship crosses the rim INWARD, and only
//          then. Parking inside a still is snared once, not thirty times a second;
//          crossing it twice is snared twice. That per-patch latch and the CALM
//          clock are two different guarantees and both are needed: the latch stops
//          one patch holding you forever, the calm stops two patches taking turns.
export function groundBite(g, id, s, inside, ehp, dt) {
  if (!inside) { g.in.delete(id); return { burn: 0, hold: 0 }; }
  const burn = (g.rate ?? 0) * Math.max(0, ehp) * Math.max(0, dt);
  if (g.in.has(id)) return { burn, hold: 0 };
  g.in.add(id);
  if (!(g.hold > 0) || !mayHold(s)) return { burn, hold: 0 };
  return { burn, hold: g.hold };
}

// Ages one patch. Returns false on the tick it should be dropped.
export const stepGround = (g, dt) => (g.t -= dt) > 0;

// The effective hit points of whatever is standing in it. Aliens and ships both
// carry `stats`, so this reads either — and it is the BASE pool rather than the
// boosted one, so routing power to shields still buys you something against a rate
// that takes a share. Identical to burn.js's poolOf and deliberately so; it is
// re-exported rather than restated.
export { poolOf } from './burn.js';

// How often ground says out loud what it took. One floating number a frame is
// thirty a second and unreadable; hull leaving with no number at all is
// indistinguishable from a bug, which is the complaint the damage numbers exist to
// answer. The Censer's field flushes once a second and so does this.
export const BITE_TELL = 1.0;   // s
