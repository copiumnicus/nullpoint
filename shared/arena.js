// The claim fight.
//
// A mining tier is a rock somebody else is already sitting on. You do not buy the
// Deep Space Mining Operation, you go and free it: the station drops you into an
// instanced sector with the rock in the middle and a field of hostiles around it,
// and you either clear them or you die. Nothing follows you in and nothing else
// is in there — two pilots claiming the same rock are in different sectors, which
// is the whole reason shared/maps.js grew arenaMap().
//
// WHY THE ROSTERS ARE THE SIZE THEY ARE, measured rather than picked.
//
// The pilot each arena assumes is derived, not written down: `assumedFor(key)`
// climbs the hull and shield ladders together, cheapest rung first, while the
// total still fits inside that mining tier's price — which is the designer's
// "the ones up to the point in the same price range" as an algorithm. It gives
//
//     mine1    500,000   nothing yet         7,050 effective hp
//     mine2  2,000,000   hull1 + shld1      14,100
//     mine3  8,000,000   hull2 + shld2      28,200
//
// against a finished ship's dps, which research never touches.
//
// And then the measurement that decided everything (test/arena.mjs runs it):
// EVERY GUN IN THE BESTIARY IS HARMLESS AT THIS STAGE. Measured on this tree, a
// Leviathan needs 59 seconds to kill a finished pilot who stands still and does
// nothing; an Ironhusk 98; the heaviest barrel in the game — a Kedge's — still
// needs 27. `damage x fireRate` is a flat number that was only ever true at the
// anchor stage, which is the thing burn.js was written to say out loud.
//
// So the arena is built on the two hostiles whose threat is a RATE:
//
//   a Censer takes 4.5% of your whole ship per second while you are in the ring —
//     ANCHORS.pressure itself — and its pyre lets go of another 13.5% of you
//     inside 900px when it dies, which is 80px past the reach of every gun in
//     the game. You cannot kill one without being in its blast; you can only be
//     leaving when it goes.
//   a Lamprey drinks 2.25% of your HULL per second, past the shield, and mends
//     itself with it. It is the clock: it makes a long fight lose itself.
//
// Both are shares, so both mean exactly the same thing at x1 and at x4 — and that
// is what makes one roster correct at all three tiers. Measured over twelve spawn
// rotations per arena, the same field leaves a competent pilot within a quarter of
// the same percentage of their ship at every tier: 38, 36 and 45. The escalation
// between the three is therefore NOT more hit points; it is a new question each
// time:
//
//   mine1   the ring          five fields, and no lane through the middle
//   mine2   + the clock       a tether eating hull your shields cannot cover
//   mine3   + no way out      a Leviathan reaches 900 past your 820, so the last
//                             third of the field cannot be declined
//
// THE CHASE, AND THE REST BUTTON — the change that actually made these hard.
//
// The complaint was "you can just kill one, run away, heal", and it was correct.
// Two things made it work and both are now off inside a claim:
//
//   nothing breaks off.  `noLeash` in shared/aliens.js, keyed on `map.arena`. Once
//     something in a claim has seen you it never loses interest, however far you
//     go. It is a property of the SECTOR, so an Ironhusk is an Ironhusk everywhere
//     and nothing in the open world changed.
//   shields do not come back.  `dry` in stepVitals. Regeneration is 3.33% of the
//     POOL per second (0.50 made it a share), which refills a finished ship in half
//     a minute — so a closed field was a fight with a rest button. This is the
//     whole of the exploit and removing it is the whole of the fix.
//
// Measured on the shipped rosters, twelve rotations, share of the ship a clean
// clear costs — which is the reading a player feels:
//
//            before      after      and the middle
//   mine1     31%   ->    88%       5 of 12 dead  ->  12 of 12
//   mine2     36%   ->    90%       0 of 12       ->  12 of 12
//   mine3     26%   ->    90%       0 of 12       ->  11 of 12
//
// x2.9, x2.5 and x3.5 against asks of x2, x3 and x5.
//
// WHY x5 IS NOT REACHABLE, and it is arithmetic rather than an excuse. Without
// regeneration a pilot has exactly one shipful of hit points, so the consumed
// reading is capped at 100% by construction: five times mine3's original 26% is
// 130%, which is not a hard claim, it is one the assumed pilot cannot clear. The
// ceiling on that reading is x3.8, and 90% consumed is a hair under it.
//
// AND WHY THE ROSTER COULD NOT MAKE UP THE DIFFERENCE. Measured, with the chase
// and dry shields in place, against `weight` = field hit points x what the field
// throws at the assumed pilot per second, normalised to the shipped roster:
//
//   x1.15 weight   7 of 8 clears      x1.9   3 of 8      x2.2   0 of 8
//
// The headroom above the shipped field is about 15%, and one promoted Leviathan
// spends 4% of it. There is no version of "twice the field" that the pilot this
// tier assumes can clear, because `weight` is proportional to pressure x length
// and surviving permanent contact with the whole field requires that same product
// to FALL. Raising it and cutting it are the same knob.
//
// WHAT WAS MEASURED AND REJECTED: full map-wide aggro — everything engaging from
// anywhere at t=0, rather than merely never letting go. The seam is still here,
// named `hunt` on the sector and read by `noHorizon`, and it is off. A finished
// pilot moves at 128 and everything in the bestiary except a Hive moves at 150 to
// 400, so nothing about it is a chase: the entire field arrives, sits on the pilot
// and never leaves, which turns the field's NOMINAL pressure into its actual one.
// At mine1 that is 31% of the ship per second — three seconds — and it measured
// 0 of 12 at every tier on the shipped rosters, with a policy that gives ground
// from the field's centre of mass rather than orbiting the nearest thing, and 0 of
// 12 again with the field posted in depth out to 4,200px instead of on one ring.
// It is not a difficulty setting, it is a wall. Posting the field deeper does not
// help for the same reason: you cannot string out a field that is faster than you.
//
// MEASURED, twelve spawn rotations per arena, each with the pilot arriving on a
// different bearing. Two policies: `allIn` flies to the rock and holds the trigger
// on whatever is nearest, and `kite` holds its own gun's range, keeps out of every
// ring and weaves across the line of fire. Neither carries a repair kit, an
// ability, power routing or a grade of ammunition above cell1, so both are a
// FLOOR — a real pilot has all four, and 1 of 12 is what the floor policy loses at
// mine3 without any of them. On this tree, with the chase and dry shields:
//
//                 hostiles     played well              all-in        fight
//   mine1   15    12 of 12,  12% of the ship left     12 of 12 dead   100s
//   mine2   16    10 of 12,  10%                      12 of 12        110s
//   mine3   17    11 of 12,  10%                      11 of 12        122s
//
// The SHARE is what is asserted, not the figure: a hull slot count is somebody
// else's to move this week, and the test states the claim as "costs a competent
// pilot most of their ship" with the spread quoted.
//
// So: expect to lose most of the ship at a claim, and expect flying into the
// middle of the first one to hurt. Research quietly buys a bad pilot somewhere to
// stand — which is what research is for. It buys forgiveness, never victory.
//
// AND THE MODEL IS NOT THE GAME. Flown over a real socket before the chase went
// in, mine1 took 159 seconds to clear against the model's 92, and the pilot
// finished at full hull where the model said 38% of the ship. The bot repositions
// ten times a second, which dodges more bolts and lands fewer of its own — so the
// simulation is the CONSERVATIVE reading of pressure and the OPTIMISTIC reading of
// length. Nothing here should be quoted as what a claim feels like; it is what a
// claim cannot be worse than.
//
// THE CLIFF, and it is the reason not to "just add more". Everything that scales
// bills by the second, so an arena's LENGTH is its difficulty and it is a cliff
// rather than a slope. Two numbers describe a field —
//
//   pressure  what the whole field takes per second if it all engages, as a share
//             of the pilot: about a third of the ship a second, so three seconds
//             of standing in the middle of it is the whole ship
//   length    seconds of unbroken fire to clear it
//
// — and they are held CONSTANT across the three, not raised. Holding pressure
// alone was tried and the third arena became unwinnable 12 times out of 12. Both
// numbers are description rather than target, though: seven Censers and three
// Ironhusks come to the same pressure and the same length as five and eight, and
// play far harder, because a ring is a place you cannot stand and a gun is only a
// number. The simulation is the authority; the arithmetic only says where to look.
//
// The roster is data so the next hostile is a line here rather than a rewrite.

import { ARENA_KEYS, MAP_W, MAP_H } from './maps.js';
import { MODULES, nextOn, addMod, tiersOf, hasMod } from './research.js';
import { farmHp, effectiveHp, threatDps, bountyFor } from './aliens.js';

// --- the fields ---------------------------------------------------------------
// Each tier is the one below it plus one thing, and the body count is 15 / 16 / 17
// — the escalation is HARDER hostiles, not more of them. A Leviathan is 65,000 hit
// points for 120 dps, the worst damage-per-hit-point in the bestiary; a Kedge is
// the same 65,000 and the same 900 reach for 331, and its fix drags you back onto
// the rock you were backing away from. Promoting one Leviathan per tier is what
// took the upper claims' middles from survivable to lethal (see THE CHASE below):
// all-in went 0 of 12 to 12 of 12 at mine2 and 0 to 11 at mine3 for a 4% change in
// the field's weight.
export const ARENAS = {
  mine1: { roster: [['censer', 5], ['leviathan', 2], ['ironhusk', 8]],
           asks: 'five fields, and nowhere in the middle to stand still' },
  mine2: { roster: [['censer', 5], ['lamprey', 1], ['leviathan', 1], ['kedge', 1], ['ironhusk', 8]],
           asks: 'a tether drinking hull the shields cannot cover, and one thing that hauls you back' },
  mine3: { roster: [['censer', 5], ['lamprey', 1], ['leviathan', 1], ['kedge', 2], ['ironhusk', 8]],
           asks: 'three things out-range you and two of them undo the ground you just made' },
};

// NOTHING IN A CLAIM MAY BE ABLE TO RUN AWAY FROM YOU, and this is the one rule
// here that came out of a live socket rather than out of the model.
//
// The first draft was Censers, Bandits and Harriers, and it cleared 12 of 12 in
// the offline sim. Flown over a real connection it stalled at 5 of 12 with the
// pilot at full hull and its shields climbing back for seventy seconds: a Harrier
// runs at 8% of its hull and moves at 380 against a laden Bulwark's 152, so the
// last of them simply left, healed at 4% a second, and there was no way to finish
// the fight and no way out of the sector to abandon it. An arena has nowhere for
// either side to go — which is exactly what makes a hostile that can break off
// into a stalemate rather than an escape. A fight neither side can end is worse
// than one the pilot loses.
//
// So `flee > 0` disqualifies anything faster than the ship the claim is calibrated
// for, which is every Drifter and every Harrier in the game. There is a test.
export const MAY_NOT_FLEE = true;

// The mining ladder and the claim list are the same list. Read off research.js
// rather than written twice, because a fourth mining tier added there with no
// entry here would be a rung nobody could ever buy and nothing would say so.
export const ARENA_MODULES = tiersOf('mine');
export const rosterOf = key => ARENAS[key]?.roster ?? [];
export const countOf   = key => rosterOf(key).reduce((n, [, c]) => n + c, 0);
export const fieldEhp  = key => rosterOf(key).reduce((n, [k, c]) => n + effectiveHp(k) * c, 0);
export const fieldFarm = key => rosterOf(key).reduce((n, [k, c]) => n + farmHp(k) * c, 0);
// What the field would have been worth if it paid. It does not — see PAYS below —
// and this exists so the test can quote the number it is refusing to pay.
export const fieldBounty = key => rosterOf(key).reduce((n, [k, c]) => n + bountyFor(k) * c, 0);
// What the whole field throws at a ship of this size, if it all engages at once.
// Read through threatDps rather than damage x fireRate, because two thirds of what
// is in here has no gun at all and would report as harmless.
export const fieldDps = (key, ehp, hull) =>
  rosterOf(key).reduce((n, [k, c]) => n + threatDps(k, ehp, hull) * c, 0);

// ONE reading of how hard a field is, so a multiplier means something.
//
// How much there is to kill, times how hard it hits back at the pilot that tier
// assumes. Both halves are things a designer can point at, it needs no simulation,
// and it is monotone in every lever — which the share-of-ship reading a player
// feels is not, because that one saturates at "dead" and cannot express a claim
// being twice as hard as one that already costs you nine tenths of the ship.
// The two are quoted side by side in test/arena.mjs for exactly that reason.
export const weightOf = (key, ehp, hull) => fieldEhp(key) * fieldDps(key, ehp, hull);

// --- WHAT A CLAIM PAYS, AND WHY IT IS NOTHING ---------------------------------
//
// No bounty, no experience, no ore, no entry in the threat file. Not a reduced
// rate — nothing, and it is the same nothing on a first claim and on a replay.
//
// The arithmetic, which is not close. mine1's field is worth `fieldBounty('mine1')`
// in bounty and clears in about a minute and a half; test/arena.mjs prints both.
// That is over two thousand credits a second against an actively-played rate of
// about fifty-five, and seven times the best mine in the game — the thing the
// fight is FOR. A claim you can re-enter after every death would therefore be the
// most profitable place in the galaxy by a factor of forty, and it would be most
// profitable to a pilot who keeps losing.
//
// A REPLAY makes that argument absolute rather than merely strong. A first claim
// can be won once; a replay can be won without limit. There is no positive number
// that survives being multiplied by "as often as you like" — a tenth of a percent
// of the bounty is still an unbounded faucet, and any rate high enough to be worth
// flying for is a rate that makes mining, hauling and hunting all pointless. So
// the number is zero, and zero is the only number that is stable.
//
// What a replay is instead: a proving ground. It is the one place in the game
// where a fit can be measured against a KNOWN, IDENTICAL field, where dying costs
// nothing at all, and where the next tier can be rehearsed — mine2's field is
// mine1's plus the Lamprey, so replaying mine1 is literally practice for mine2.
// That is worth flying to without being paid for, and it is the only reward that
// does not break the game's own anti-pay-to-win rule: research must buy
// forgiveness, never victory, and a practice range buys neither.
//
// Nothing in a claim's roster is unique to a claim, either — Censers stand in co3,
// Lampreys and Leviathans at co4, Ironhusks at co2 — so no pilot has to come here
// to fill the threat file, which is the one payment that would otherwise be
// tempting to make.
export const PAYS = Object.freeze({ bounty: false, xp: false, ore: false, file: false });

// --- where they stand ---------------------------------------------------------
//
// A ring around the rock rather than a scatter, and 1200px of it. Tight enough that
// the fields overlap and there is no lane through the middle; loose enough that
// backing off genuinely breaks contact, because a leash is measured from the
// hostile to you and the longest one in any claim is the Leviathan's 2200 (a
// Censer gives up at 1300, an Ironhusk at 1500, a Lamprey at 2000). So 2400px of
// clear space ends every engagement in here. That gap is the arena's only tactic
// and it has to actually exist — the sector is 12000 x 8000 and the ring is 1200,
// so there is room for it in every direction.
export const RING_R = 1200;
export const ARRIVE_R = 1900;      // you come in outside the ring, not on top of it

export function postsFor(key) {
  const kinds = rosterOf(key).flatMap(([k, n]) => Array(n).fill(k));
  return kinds.map((kind, i) => {
    const a = (i / kinds.length) * Math.PI * 2;
    return { kind, x: MAP_W / 2 + Math.cos(a) * RING_R, y: MAP_H / 2 + Math.sin(a) * RING_R };
  });
}

// Where the pilot drops in. Off one edge of the ring rather than in the middle of
// it, so the first thing a claim asks is which way you go in.
export const arrivalAt = () => ({ x: MAP_W / 2, y: MAP_H / 2 - ARRIVE_R });

// --- the ship the calibration assumes -----------------------------------------
//
// "the hull and shield tiers in the same price range as that mining tier", as an
// algorithm: climb both ladders together, cheapest rung first, while the running
// total still fits inside the tier's price. Derived rather than written down, so
// moving a module price moves the calibration with it and the test notices.
export function assumedFor(key) {
  const budget = MODULES[key]?.price ?? 0;
  let mask = 0, spent = 0;
  for (;;) {
    const next = ['hull', 'shld'].map(l => nextOn(mask, l)).filter(Boolean)
      .sort((a, b) => MODULES[a].price - MODULES[b].price)[0];
    if (!next || spent + MODULES[next].price > budget) return { mask, spent };
    spent += MODULES[next].price;
    mask = addMod(mask, next);
  }
}

// --- getting in ---------------------------------------------------------------
//
// One function, so the row on the station panel, its tooltip and the server all
// refuse for the same reason in the same words. The workshop dock refused to sell
// anything for a day because that was two functions.
export function whyNotClaim(key, { mask = 0, near = false, claims = [], hold = {}, inArena = false } = {}) {
  const m = MODULES[key];
  if (!m || !ARENAS[key]) return 'no claim on this';
  if (inArena) return 'you are already standing on a claim';
  if (!near) return 'fly to your station to launch a claim';
  if (claims.includes(key)) return 'this claim is already yours';
  // Same order rule the ladder itself uses: you cannot free the belt before the
  // first rig exists to work it.
  const want = tiersOf('mine').filter(k => claims.includes(k)).length + 1;
  if (m.tier > want) return 'free the claim below it first';
  // An empty hold, for one reason and it is not flavour: a wreck in a claim costs
  // you nothing (see the wreck path in server.js), so a full hold plus a
  // deliberate death would be a free flight home — which is precisely what a
  // Recall Beacon costs 3,400 credits to do.
  if (Object.values(hold).some(n => n > 0)) return 'empty the hold first — you go to a claim with nothing';
  return null;
}

// And going back. The mirror of the above, and the reason it is a second function
// rather than a flag: every clause differs. A replay needs the rock to be YOURS
// rather than not-yours, it has no ladder order to keep — the tier below is
// already freed by definition — and it is the same fight forever, so nothing about
// it can ever become unavailable again.
//
// The hold rule survives, and for a sharper reason than on a first claim: a replay
// is the cheapest death in the game, so a laden pilot could use one as a free
// courier back to their own hangar every single time.
export function whyNotReplay(key, { near = false, claims = [], hold = {}, inArena = false } = {}) {
  if (!ARENAS[key]) return 'no claim on this';
  if (inArena) return 'you are already standing on a claim';
  if (!near) return 'fly to your station to go back out';
  if (!claims.includes(key)) return 'you have not freed this rock yet';
  if (Object.values(hold).some(n => n > 0)) return 'empty the hold first — you go to a claim with nothing';
  return null;
}

// What one row on the CLAIMS page says. Three states and they are not the same
// question: a rock you cannot reach yet, a rock to go and take, and a rock to go
// back to for the practice.
export function claimState(key, { claims = [], mask = 0 } = {}) {
  const m = MODULES[key] ?? null;
  const freed = claims.includes(key);
  const want = tiersOf('mine').filter(k => claims.includes(k)).length + 1;
  return {
    key, name: m?.name ?? key, tier: m?.tier ?? 0, price: m?.price ?? 0,
    asks: ARENAS[key]?.asks ?? '', count: countOf(key), freed,
    // Built already, which is the only thing that makes a freed rock finished
    // rather than merely won. The distinction is what the page shows: a rock you
    // freed and have not paid for still has a bill attached to it.
    built: hasMod(mask, key),
    locked: !freed && (m?.tier ?? 0) > want,
    verb: freed ? 'RUN IT AGAIN' : 'CLAIM THE ROCK',
  };
}

// --- what it says on screen ---------------------------------------------------
//
// The band across the top, between the readouts on the left and the changelog
// column on the right. Both bounds are MEASURED off the client rather than derived
// from it — the HUD's own geometry is not in shared/ yet — and test/render.mjs
// asserts the bar still clears the patch icon, the safe-zone badge, the first
// receipt and the left-hand readouts at every window size it drives. A banner that
// silently grew over the RDR/SIG/GUN line is exactly the bug rule one exists for.
//
// y = 62 is the first clear line: the `say()` notice owns 22..60 and the receipts
// start at 92. There is no safe-zone badge to clear inside an arena — a claim has
// no base ring, no outpost and no portals, so havenKind() finds nothing — but the
// bar is placed as though there were, because a rule that only holds where it is
// currently used is a rule waiting to be broken somewhere else.
export const BAR_TOP = 62, BAR_LOW = 134, BAR_H = 28, BAR_PAD = 14;
// Measured off the client at the two heights the bar can sit at, because the
// HUD's own geometry is not in shared/ yet and a number nobody can check is a
// number that drifts. At y 62..90 the left column is the SH/HU line to about 390
// and the RDR/SIG/GUN line to about 460; 470 is that with a character of slack.
// HUD_RIGHT is TOAST_W + BADGE_PAD — the changelog icon, the safe-zone badge and
// the receipt stack all live inside it.
export const HUD_LEFT = 470, HUD_RIGHT = 276;
const CHAR = 7.22;               // 12px ui-monospace, the figure the receipts use

// What the bar says, longest first. `left` is how many hostiles are still
// standing; a pilot who cannot see that cannot tell whether they are winning.
//
// A replay says something different when it is won, and that is not flavour: a
// first claim ends with a rig you may now build, and a replay ends with nothing at
// all except the fact that you did it. Telling a pilot CLAIM FREED for the fourth
// time would be the panel promising a purchase that is already made.
export function missionText({ key, left = 0, total = 0, cleared = false, replay = false } = {}) {
  const what = (MODULES[key]?.name ?? 'the claim').toUpperCase();
  if (!cleared)
    return { tone: 'task', forms: [`ELIMINATE ALL HOSTILES · ${left} OF ${total} LEFT`,
                                   `${left} OF ${total} HOSTILES LEFT`, `${left} LEFT`] };
  return replay
    ? { tone: 'won', forms: [`FIELD CLEAR · ${what} · NOTHING PAID, NOTHING LOST`,
                             `FIELD CLEAR · ${what}`, 'FIELD CLEAR'] }
    : { tone: 'won', forms: [`CLAIM FREED · ${what} MAY COMMENCE`, `CLAIM FREED · ${what}`, 'CLAIM FREED'] };
}

// ONE function returns both the rectangle and the words in it, because the two
// decide each other and two functions would disagree the first time a window got
// narrow. The client draws what this returns and test/render.mjs asserts on the
// same call, so a line that is drawn is a line that was proved to fit.
//
// The bar is CENTRED ON THE SCREEN, so what constrains it is twice the distance
// from the middle to the nearer column — a box centred at 640 on a 1280 screen may
// be 300 wide before its left edge touches 470, however much room is going spare
// on the right. When the longest form will not fit up in the band it drops BELOW
// both columns; when it will not fit there either it says less. It never grows
// over the readouts and it is never clipped, which is the same call labPanel makes
// when the window is too short for its rows — a thing you can see and cannot read
// is the same bug as a row you can see and cannot click, and this codebase has
// shipped that twice.
export function mission(VIEW_W, state) {
  const { tone, forms } = missionText(state);
  const wide = t => Math.round(t.length * CHAR) + BAR_PAD * 2;
  const band = VIEW_W - 2 * HUD_LEFT;             // room up beside the readouts
  const low  = VIEW_W - 2 * HUD_RIGHT;            // room below, beside the receipts
  // Words first, then height: a full sentence lower down beats three words up in
  // the band. The loops the other way round put "17 LEFT" at the top of a 1100px
  // window while the whole line would have fitted forty pixels further down.
  for (const text of forms)
    for (const [y, room] of [[BAR_TOP, band], [BAR_LOW, low]]) {
      const w = wide(text);
      if (w <= room) return { x: Math.round((VIEW_W - w) / 2), y, w, h: BAR_H, text, tone };
    }
  const text = forms.at(-1), w = Math.min(wide(text), Math.max(80, VIEW_W - 32));
  return { x: Math.round((VIEW_W - w) / 2), y: BAR_LOW, w, h: BAR_H, text, tone };
}
export const BAR_TONE = { task: '#ff8f6b', won: '#7de08a' };

// How long you stand in a freed claim before the station pulls you back.
//
// There is nothing to fly to — a claim has no portals — so an automatic return is
// the only honest way out of a won one. Ten seconds is two lives of the `say()`
// notice, which is the announcement it is giving you time to read twice, and it is
// long enough to watch the rock come apart.
export const LINGER = 10;

// And the wall behind it. A pilot who parks in the corner of a claim and does
// nothing is not stuck — they can still die, and nothing in here heals — but the
// arena they are holding open is a live sector on a server that has no other way
// to close it. Fifteen minutes is nine times the longest clear measured.
export const LIMIT = 15 * 60;
