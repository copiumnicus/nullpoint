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
// TWO KINDS, ONE FILE. A Crucible lays White Heat — a pool of star-tapped plasma
// that eats whatever stands in it — and a Doldrum lays Slack Water, which barely
// burns and instead stops you dead the moment you cross into it. They are one module
// because they are one object with two numbers filled in differently: a place, a
// radius, a lifetime, a rate and a hold. A third kind later is a row in a
// definition, not a second copy of all this. That is the seam, and `hold` and `rate`
// are its names.
//
// Nothing here does I/O and nothing here knows what a ship is beyond x, y, r and a
// pool of hit points. Both sides import it: the server damages inside the patch and
// the client draws it, and `inGround` is the reason those are the same circle. A
// circle you can see and not be hurt by is the same bug as a row you can see and
// cannot click, and this codebase has shipped that twice.

import { MAP_W, MAP_H } from './maps.js';
// JUMP_TIME is sim.js's — the three seconds a portal takes to spool. Both clocks
// below are read off it rather than written down again, so moving the door moves
// the root and the test that pins it. SHOT_FLASH is the muzzle glow every other
// trigger in the game sets, and a lob is a trigger.
import { JUMP_TIME, SHOT_FLASH } from './sim.js';
// A glob carries the boosted gun, exactly as a bolt and an orb do — a hostile with
// its reactor on the weapons throws harder, and reading the raw stat instead is the
// mistake every mirror number in this repo carried until 0.63.
import { boostOf } from './power.js';

export const sowOf = def => def?.sow ?? null;

// --- the two clocks that make a root shippable --------------------------------
//
// WHAT SLACK WATER TAKES, and it is a stun. It was not: the first cut zeroed your
// acceleration for 1.5s and kept your momentum in full, so a ship carried on going
// wherever it was already pointed and what it lost was only the ability to change
// its mind. That is a better mechanic and it is not the one the game has, because
// it was flown and it did not read as being caught — a pilot at speed sailed
// straight out of the trap that had just closed on them and barely noticed. So the
// velocity goes too. You are STOPPED, dead, where you stand, for HOLD seconds.
//
// What is left to you is everything that is not the throttle: the trigger, the
// target, the rockets, a repair drone, a Recall Beacon, your heading, your shields.
// A still takes the one thing and takes all of it.
//
// HOLD is the designer's number rather than a derived one — it is the length of
// trouble they want a pilot to be in — and it has now been set twice. It was five
// seconds, flown, measured, and reported back as unbeatable at any party size; it is
// two and a half because that was the lever picked off that report. The rest of this
// file derives FROM it, which is the arrangement that matters: one argued number and
// the others following, so moving it moves the whole promise together and nothing has
// to be re-argued by hand.
//
// What deliberately did NOT follow it down are the two patch cadences in aliens.js.
// They were 10s and 15s when they read `CALM` and `HOLD + CALM`, and halving the hold
// would have halved them too — ground landing twice as often, which is the encounter
// getting HARDER off a change made to make it easier. The identities are retired
// rather than honoured; see the note on each.
export const HOLD = 2.5;

// THE DOOR, and it is now held twice over rather than once.
//
// The original hold was JUMP_TIME / 2, and the half WAS the argument: "the longest
// hold that can never deny a door you already opened", because three seconds is what
// a portal takes to spool. At five seconds that reasoning died and the promise had to
// stand on the rule alone. At two and a half it is back — 2.5 is under JUMP_TIME, so
// even a hold landing on the tick you committed cannot outlast the spool.
//
// The rule is the stronger of the two and it never went anywhere: a still is refused
// sanctuary outright, provoked or not — server.js gates the hold on inHaven() — and a
// pilot spooling a jump is inside a portal mouth by definition. PORTAL_R is 120 and
// HAVEN_R is 288, so anybody who has committed to a door is more than twice as deep
// into the peace as they need to be. The duration is the belt and the haven is the
// braces; a door you have already opened cannot be taken from you by either reading.
//
// What is still true is that a door you have NOT yet reached is further away. Stopped
// dead at 300px from a mouth you were running for, you are two and a half seconds
// later to it than you were, and under the coast this replaced you would have kept
// going. That is a real cost and it is the cost the change was asked for. Leaving
// still works — both sowers are slower than every hull in the game and their leash is
// 2,600 — it is simply dearer, which is the whole of what the deeps are for.
export const PORTAL_KEPT = 'duration and sanctuary, both';

// And CALM is what a pilot is owed back. TWICE the hold, which is not a taste: it
// is the invariant the first version stated and the only part of it worth keeping —
// a pilot always has at least twice as much control as they lose, whatever is
// standing on the field. At 1.5s held that meant 3.0s owed; at 5.0s it means 10.0.
//
// It is not decoration and it is not politeness. Two stills overlapping, or one
// still and a pilot who keeps drifting back over its rim, is a perma-root by
// arithmetic unless something refuses — and a root that can be chained is not
// shippable at any duration, least of all this one. With these two numbers the
// worst case any arrangement of stills, hostiles or pilots can produce is stated
// and bounded:
//
//   longest unbroken stop         =  HOLD                        = 2.5s
//   thrust owed after every stop  =  CALM  =  2 x HOLD           = 5.0s
//   stopped over t seconds        <= HOLD + t x HOLD/(HOLD+CALM)
//
// The first two are exact and hold whatever is standing on the field. The third is
// the first two added up and it is deliberately NOT stated as a flat third: a window
// that opens mid-stop pays for that stop as well. test/ground.mjs brute-forces the
// arrangements and asserts all three against the sweep.
//
// ONE PROPERTY WENT AND ONE CAME BACK when the hold halved, and they are worth
// separating. What went: at 5s and 10s the cycle was 15 seconds, so two stops could
// not fall inside one ten-second window at all — a pilot was stopped at most once
// per ten seconds. At 2.5 and 5 the cycle is 7.5s and two CAN. What did not change is
// how much of that window is lost, because the duty cycle is HOLD/(HOLD+CALM) either
// way and it is a third either way: the same immobility arrives as two short stops
// rather than one long one, which is strictly the better of the two for a pilot who
// needs a moment of steering between them.
export const CALM = 2 * HOLD;                      // 10.0s

// The shortest warning this game gives for anything that matters: half a portal
// spool.
//
// It used to be a definition's `wind` — a flat clock a marker stood on before the
// ground under it went live — and both sowers carried it. That is gone with the
// wind-up itself: the warning is now the glob's FLIGHT, which is 2.25s at the range
// these two stand off to and 3.93s at the full throw, so backing off buys you time
// to read it. A number that grows with distance is a better warning than a flat one
// and a flat one could never have said it.
//
// What it is still for is the FLOOR, and it is the one place the flight is not
// simply distance over speed. A glob thrown from inside 420px would be in the air
// under a second and a half, which is less warning than the game gives for a door,
// and a pilot who has closed to point blank has already agreed to be answered by the
// plate mechanics of this bestiary rather than deleted with no tell. So a throw is
// never quicker than this, and the only throws it binds on are ones from inside the
// pool's own radius.
export const WARN = JUMP_TIME / 2;                 // 1.5s

// May this ship be held right now? One predicate, because both halves of the
// guarantee above are this question and a second copy of it would disagree — which
// is how the workshop dock spent a day refusing to sell anything.
//
// Already held is refused as flatly as still owed calm. Without the first clause a
// second patch could re-arm the clock every tick a ship was inside it, and 1.5
// seconds would quietly become forever.
export const mayHold = s => !((s?.snare ?? 0) > 0) && !((s?.calm ?? 0) > 0);

// Stops the ship. The calm is set when the hold ENDS rather than here, so a pilot
// held for the full two and a half seconds and one held for a tick both get the same
// five afterwards.
//
// The velocity is not zeroed here. It is zeroed in step(), every tick the clock is
// running, and that is deliberate: killing it once would let anything that touches
// the body afterwards — a collapse, a shove, the boundary clamp — put a ship back
// into motion inside a still and quietly make the stop a coast again.
export function holdEngines(s, secs = HOLD) {
  s.snare = Math.max(0, secs);
  s.calm = 0;
}

// Both clocks, advanced wherever ships are advanced. Called after step(), so the
// tick a hold is spent is a tick the ship actually stood still for.
export function stepSnare(s, dt) {
  if ((s.snare ?? 0) > 0) {
    s.snare = Math.max(0, s.snare - dt);
    if (s.snare === 0) s.calm = CALM;              // and now you are owed a spool of control
  } else if ((s.calm ?? 0) > 0) {
    s.calm = Math.max(0, s.calm - dt);
  }
}
export const held = s => (s?.snare ?? 0) > 0;

// --- lobbing it ----------------------------------------------------------------
//
// THE GUN IS THE DELIVERY OF THE GROUND, and it used to be a second weapon beside
// it. Both sowers carried a 438 dps aimed bolt AND laid ground on a separate clock,
// which is two mechanics stapled together: the bolt was a plain hitscan-ish shot
// nobody could dodge (see the table at the top of orbs.js — 94% of what is fired
// lands on a hull weaving as hard as it can), and the ground appeared out of thin
// air on the victim's own position.
//
// So the barrel is gone and the ground ARRIVES. A crucible pours and a doldrum
// spreads; both of them now throw one slow glob on the cadence that used to be the
// sowing cadence, it carries the whole of the gun's damage where it lands, and where
// it lands is where the patch is. ONE clock, one act, and `damage x fireRate` is
// untouched — so threatDps, the bounty, the experience and every derived number in
// the bestiary report are the numbers they already were.
//
// WHAT THAT BUYS, and what it does not, because one of the two was expected and is
// not there. It was asked for as a fix to a measured inversion — "standing still
// beats circling at every radius down to 200px" — and re-measuring that claim
// honestly says the inversion was a property of the BENCH: PLANS.kite in
// test/ground.mjs does not stand still, it retreats, and it retreats 5,000px out of
// charted space until sowPoint() below clamps every pool it is owed to the map edge
// 1,783px behind it. A pilot who actually holds station took 13,050 a second from a
// Crucible against 4,812 circling on the build this replaces, and takes 12,739 against
// 5,534 on this one. Circling already won, x2.7, and it still wins, x2.3.
//
// What lobbing DOES buy is the half the bolt never had: the damage is now dodgeable.
// A glob leads, so holding any course at all is answered — and a turn is what takes
// you off it, which is the same sentence orbs.js writes about a fan.
//
// What it cannot buy is a dodgeable POOL, and the arithmetic says so up front rather
// than after somebody flies it. A 560px pool needs 577px of clearance and the ship
// that fights one covers 128px a second: 4.5 seconds, against a glob that is in the
// air for 2.25 at the range this hostile stands at. No throw speed fixes that,
// because a glob slow enough to give 4.5 seconds of flight is slower than the pilot
// and cannot lead them at all. The pool is wider than anything a heavy hull can step
// out of, on purpose — that is what `r: 560` is FOR — and the answer to it stays the
// one it always was: leave, and pay for leaving.

// HOW SLOW A GLOB IS, and it is pinned from both ends the way ORB_SPEED is.
//
// The ceiling is A TURN MUST BEAT IT. The throw solves the intercept along a
// straight line, so a pilot flying an arc is missed by the sagitta between the
// tangent it aimed down and the curve they actually flew — v^2 t^2 / 2d, and with
// t = d/S that is v^2 d / 2S^2. Clearing the glob's own disc plus a hull asks
//
//     S  <=  v * sqrt( d / (2 (GLOB_R + hull r)) )
//
// and at the numbers this fight is actually flown at — a finished Bulwark with its
// reactor on the gun at 128px/s and a 17px hull, at the 630px both sowers stand off
// to — that is 291. So 280, which misses a circling pilot by 66px against a 61px
// disc: an 8% margin, the same order as the six pixels an Antiphon's answer clears
// a turning ship by, and for the same reason. A pilot who turns is missed and a
// pilot who turns lazily is not.
//
// The FLOOR is that it has to be able to lead anybody at all. The intercept solve
// below cannot converge on a target moving faster than the glob, and a weapon that
// misses everything is a light show rather than a hostile — the measurement that
// cost orbs.js a design pass. 280 is over twice the 128px/s a finished ship flies at
// out here and nearly four times the 74 a deep-shelf one does; it is under a bare
// Hauler's 300, which is a hull that does not come to the deeps.
//
// What it costs in warning is the other half, and it went UP: the flight is 2.25s at
// the standoff and 3.93s at the full throw, against the flat 1.5s wind-up it
// replaces. Back off and you get more time to read it, which is the right shape and
// is not a thing a fixed wind-up could ever say.
export const GLOB_SPEED = 280;   // px/s

// How big the thing that lands is. 44px, which is the smallest ball this game
// already throws — an Ironhusk's orb — and it is a CEILING as much as a look: the
// derivation above reads it, so a bigger glob is a glob a turn no longer beats.
export const GLOB_R = 44;

// A pilot is assumed to need this long to read a throw before they act on it. The
// same 0.35s orbs.js uses, restated rather than imported because that file is the
// low tier's and this one is the deeps': two hostiles' worth of pattern should not
// be able to move each other's numbers by accident.
export const GLOB_READ = 0.35;   // s

// What one glob carries: the whole of the gun, boosted the same way a bolt is. The
// cadence is `1 / fireRate`, so `damage x fireRate` is what it delivers a second if
// every one of them lands — which is exactly what happens to a pilot who holds
// station, and exactly what threatDps has always claimed.
export const globDamage = a =>
  Math.max(0, (a?.stats?.damage ?? 0) * boostOf(a?.power, 'weapons', a?.stats));

// Where a glob in the air is right now, in world coordinates. Both sides want it —
// the client draws the thing and the test asserts on the flight — so it lives here
// and not in either of them.
export const globAt = a => {
  if (!a?.sowAt || !a?.sowFrom) return null;
  const p = Math.max(0, Math.min(1, a.sow ?? 0));
  return { x: a.sowFrom.x + (a.sowAt.x - a.sowFrom.x) * p,
           y: a.sowFrom.y + (a.sowAt.y - a.sowFrom.y) * p };
};

// Did it land on this ship? The hull's radius counts, the same as a patch and a
// pyre: the circle you can see is the circle that catches you.
export const globHit = (at, s) =>
  !!at && !!s && Math.hypot(s.x - at.x, s.y - at.y) <= GLOB_R + (s.r ?? 0);

// A LOB, one tick of it. Returns null, or { at, dmg, from } on the single tick the
// glob lands. The caller deals the damage and makes the patch, because hurting
// things and making things are the server's job.
//
// `a.cool` is the same clock fire() uses and combat.js hands it over rather than
// sharing it — see the gate at the top of fire(). Decrementing it in both places ran
// every sower's gun at twice its rate the first time orbs did this, and the bench
// read an Ironhusk at 142 dps against a book of 72.
//
// A GLOB IN THE AIR IS NOBODY'S BUSINESS BUT ITS OWN. It is not cancelled when its
// target dies, jumps, reaches a haven or breaks the leash: it was thrown, and where
// it lands is where the ground goes. That is the whole difference between this and
// the wind-up it replaces, which was re-seated from nothing every time the victim
// changed and therefore never landed on anybody a party had rotated away from.
export function stepLob(a, victim, hold, dt) {
  const S = sowOf(a?.def);
  if (!S) return null;
  // BOTH CLOCKS FIRST, and the cooldown before the early return rather than after it.
  // Behind the `if (a.sowAt)` below it stopped ticking for the whole flight, which
  // makes the real cadence `1 / fireRate + flight` — 12.25s on a Crucible against a
  // stated 10 — and quietly puts the hostile 18% under the dps its own definition
  // claims. Nothing errors; threatDps just stops being true.
  //
  // Decrementing here is safe precisely BECAUSE fire() no longer runs for this
  // hostile: two callers on one clock is what ran every orb-thrower's gun at twice its
  // rate the first time, and the gate at the top of fire() is what stops it now.
  a.cool = Math.max(0, a.cool - dt);
  // The muzzle glow, and it is decayed here for the same reason. combat.js owns the
  // only other copy of this line and it sits BELOW the gate that sends a sower home,
  // so a hostile that never calls fire() would hold a full flash for ever. That is a
  // live bug on the two orb-throwers today; this file at least does not add a third.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  if (a.sowAt) {
    a.sow = Math.min(1, (a.sow ?? 0) + dt / Math.max(0.01, a.sowFly || 0.01));
    if (a.sow < 1) return null;
    const at = a.sowAt, from = a.sowFrom;
    a.sow = 0; a.sowAt = null; a.sowFrom = null; a.sowFly = 0;
    return { at, from, dmg: globDamage(a) };
  }
  if (!hold || !victim || a.cool > 0) return null;
  // Its OWN reach and not the barrel's. `reach` is 200px past `weaponRange` on both
  // definitions and that layer is older than this change: weaponRange is where the
  // hostile chooses to stand (standOff reads it) and this is how far it can throw,
  // so backing off past the standoff does not stop the ground finding you.
  const reach = Math.max(1, S.reach ?? a.stats?.weaponRange ?? 1);
  if (Math.hypot(victim.x - a.x, victim.y - a.y) > reach) return null;
  a.cool = 1 / Math.max(0.01, a.stats?.fireRate ?? 1);

  // THE INTERCEPT IS SOLVED, NOT ESTIMATED, and it is orbs.js's three passes for
  // orbs.js's reason: at this speed the target moves nearly as fast as the throw and
  // a single guess lands a couple of hundred pixels behind them. It CANNOT converge
  // on anything faster than the glob, which is correct rather than a limitation —
  // and the clamp keeps a divergent solve inside the throw's own reach so it aims
  // somewhere reachable instead of at the far wall.
  const reachT = Math.max(0.1, reach / GLOB_SPEED);
  let travel = Math.hypot(victim.x - a.x, victim.y - a.y) / GLOB_SPEED;
  for (let i = 0; i < 3; i++)
    travel = Math.min(reachT, Math.hypot(victim.x + (victim.vx ?? 0) * travel - a.x,
                                         victim.y + (victim.vy ?? 0) * travel - a.y) / GLOB_SPEED);
  // ITS FULL REACH AND NO FURTHER, which is orbs.js's rule about an orb outliving its
  // own weapon range read from the other end. The lead point sits AHEAD of the target,
  // so a pilot running outward at the edge of the throw drags it past 1,100 — and a
  // hostile that lays ground somewhere it could not have thrown at is the one thing a
  // pilot holding range is entitled to rely on not happening. Clamped along the line
  // rather than refused, so breaking range still shortens the throw instead of
  // silently cancelling it.
  let ax = victim.x + (victim.vx ?? 0) * travel, ay = victim.y + (victim.vy ?? 0) * travel;
  const out = Math.hypot(ax - a.x, ay - a.y);
  if (out > reach) { ax = a.x + (ax - a.x) / out * reach; ay = a.y + (ay - a.y) / out * reach; }
  a.sowAt = sowPoint({ x: ax, y: ay });
  a.sowFrom = { x: a.x, y: a.y };
  // Measured to the CLAMPED point rather than to the aim point, so a throw that ran
  // into the edge of charted space still arrives when the marker says it will. The
  // marker and the thing it is marking being 61px apart is a bug this file already
  // shipped once, and it was found live.
  a.sowFly = Math.max(WARN, Math.hypot(a.sowAt.x - a.x, a.sowAt.y - a.y) / GLOB_SPEED);
  a.sow = 0;
  a.shotFlash = SHOT_FLASH;
  a.sinceShot = 0;                                 // and there goes the veil
  return null;
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
// right for the twenty seconds a pool outlives a Crucible somebody has killed. A
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
