// PvE hostiles.
//
// An alien reuses the ship body wholesale — same step(), same vitals, same damage
// and the same shear outside charted space. Only the intent differs, and that is
// all this file decides.

import { ATTRS } from './ships.js';
import { MAP_W, MAP_H } from './maps.js';
import { newBody, inHaven, sizeOf } from './sim.js';
import { burnOf, burnR, stepBurn, goadBurn, burnBite, burnBurst,
         pyreFor, inPyre, poolOf, inBurn } from './burn.js';
import { fixOf } from './kedge.js';
import { sowOf, HOLD } from './ground.js';
import { platesOf, newRing, stepRing, storeBearing, softAt, hottest, dischargeOf,
         plateFill, plateHalf, plateCount, answer as ringAnswer } from './plates.js';

// What a kill pays, per point of work. Hoisted above the bestiary because the deeps
// derive their bounty from their rung inside the table below, and a const cannot be
// read before it is initialised — the argument for both numbers is where bountyFor
// is, which is where they used to sit.
export const XP_RATE = 140 / 650;                  // the Drifter is the anchor: 140 xp for 650 ehp
export const BOUNTY_RATE = 0.70;

// The sharpest gun the CLIMB sells, in points per second: stageDps('finished'),
// written down rather than imported because balance.js imports THIS file. Two things
// are anchored to it and neither may ever throw what the game does not sell — a
// Thresher's chamber and an Antiphon's ring — and test/aliens.mjs pins it equal to
// balance.js's own number to the penny.
//
// It is hoisted here, above the bestiary, for XP_RATE's reason and not for tidiness:
// the ring reads its ceiling from this constant INSIDE the table below, and a const
// cannot be read before it is initialised. The whole derivation — why this number,
// why `finished` rather than the deep shelf, what it costs to move it and what the
// brute-force sweep found above it — is on MIRROR, which is where it was argued.
const SHOP_DPS = 11306.59;

// --- the one number in this file that was argued rather than derived ------------
//
// Everything else in the bestiary falls out of something already written down: an
// Ironhusk is ten Drifters, a Harrier is half a rung, a Thresher is half a rung under
// a Hive. The deeps are the one place a person had to choose, because the brief asked
// for "five times stronger than the Hive" and five times is 3,250,000, which is not a
// rung of this ladder at all. The rungs either side of it are 2,055,480 — this, which
// is 650 x 10^3.5 to the nearest ten, the same arithmetic that produced the Harrier's
// 2,060 and the Thresher's 205,550 — and 6,500,000, a full decade up.
//
// This one is nearer on both readings. Linearly it is 1.19M from the ask against
// 3.25M; in the logarithm the ladder is actually built in, it is 0.199 of a rung away
// against 0.301. And it is the right FIGHT, which is what settles it: measured
// against the real AI, a pair of these kills a finished Bulwark flown well and wants
// a party of four, while the rung above is nine minutes of unbroken solo fire against
// pressure nobody survives for nine minutes. test/ground.mjs runs both and prints it.
//
// SO IT IS ONE EDIT. Change this line and the hull split, the shield, the bounty, the
// experience, the ore rung and the posting all move with it — none of them is typed
// anywhere. That is deliberate rather than tidy: this is the number somebody may want
// back, and a deviation you cannot reverse cheaply is a deviation nobody can argue
// with. `6_500_000` is the other rung, if it is wanted.
export const DEEP_HP = 2_055_480;
// A hostile's hit points have to be a multiple of ten or `bounty = ehp x 0.70` stops
// being whole credits — test/balance.mjs asserts that identity to 1e-6 across every
// hostile, and it is what caught the Harrier at 2,055. So the split rounds the shield
// to a ten and gives the hull the remainder, which keeps the sum exact whatever share
// is asked for.
const deepSplit = shieldShare => {
  const shield = Math.round(DEEP_HP * shieldShare / 10) * 10;
  return { hull: DEEP_HP - shield, shield };
};
const deepPay = { bounty: Math.round(DEEP_HP * BOUNTY_RATE), xp: Math.round(DEEP_HP * XP_RATE) };

// --- and the rung above, which is the one DEEP_HP declined -----------------------
//
// The note above names 6_500_000 as "the other rung, if it is wanted". It is wanted,
// and this is it: a full decade over a Corsair Hive's 650,000 and x3.16 the deep
// pair, which is the next whole step on a ladder that has only ever gone 650, 6500,
// 65000, 650000. Nothing was chosen here — the ladder was already built and this is
// the next rung of it.
//
// It is a multiple of ten, so `bounty = ehp x 0.70` is whole credits (4,550,000) and
// so is the experience (1,400,000) — the identity test/balance.mjs asserts to 1e-6
// across every hostile, and the one that caught the Harrier at 2,055.
//
// Same one-edit arrangement as DEEP_HP: change this line and the hull split, the
// shield, the bounty, the experience, the ore rung, the posting AND what fills a
// plate all move with it, because the plate's fill is a share of this number rather
// than an amount. That is the whole reason it is a share.
export const CORE_HP = 6_500_000;
// 85/15, the Thresher's split and the Crucible's: a thing that is mostly armour is
// mostly hull. Rounded to a ten on the shield with the hull taking the remainder, so
// the sum stays exact whatever share is asked for — deepSplit's rule, restated at the
// rung above rather than shared, because deepSplit closes over DEEP_HP.
const coreSplit = shieldShare => {
  const shield = Math.round(CORE_HP * shieldShare / 10) * 10;
  return { hull: CORE_HP - shield, shield };
};
const corePay = { bounty: Math.round(CORE_HP * BOUNTY_RATE), xp: Math.round(CORE_HP * XP_RATE) };

export const ALIENS = {
  drifter: {
    name: 'Drifter', cls: 'Husk', r: 15, colour: '#b06adf', shape: 'kite',
    // The first thing you meet, and it is meant to end up beneath you. 650
    // effective hp is set from the top down: a fully outfitted Fighter throws 683
    // in one volley, so once you have actually finished a ship these die in a
    // single trigger pull. A starter Hauler still needs ~9s of unbroken fire and
    // gives up a third of its hull doing it, so the same husk is a real fight on
    // day one and a speed bump by the time you leave the home map.
    //
    // Its weapon reaches 520 against your 620-820, so speed and range are a real
    // answer — kiting works, standing still does not. Speed sits just above the
    // heaviest hull so a Cruiser cannot simply walk away, and no higher: a faster
    // one was miserable to click on.
    attrs: { hull: 450, shield: 200, shieldRegen: 0.225, shieldDelay: 4,
             speed: 260, accel: 900, signature: 4,
             damage: 45, fireRate: 1.1, weaponRange: 520 },
    // Deliberately just inside SIGHT_R, so it is on your screen before it decides
    // to engage and you have room to turn away. Leash is short to match: a fight
    // you can see coming is a fight you should be able to decline.
    aggro: 420,       // picks a fight inside this
    leash: 1600,      // beyond this it starts losing interest
    patience: 3.0,    // s outside leash before it gives up and forgets you
    flee: 0.10,       // turns and runs at this fraction of hull
    respawn: 14,      // s
    // 455 — see BOUNTY_RATE. At 140 a Kestrel was 129 kills away and a finished
    // ship 2664, which is the grind this game exists not to have.
    bounty: 455,      // credits your company pays for the kill
    xp: 140,          // and what the kill is worth toward your rank
    // ONE SLOW BALL, and it is deliberately the simplest thing in the game.
    //
    // This is the first shot anybody is ever shot at with, so it has one job: teach
    // that moving works. The bolt it replaces could not, because it is aimed where you
    // WILL be and resolved once — measured against this hostile, a Hauler holding
    // station took 48.0 dps of a book 49.5 and a laden Bulwark weaving hard enough to
    // reverse three times a second took 48.0 as well. The identical number is the
    // whole complaint: there was no dodging here to be good at, so nothing later in
    // the bestiary had a foundation to build on.
    //
    // 60px, and it is the Leviathan's orb rather than a third size. The bestiary
    // already had two — an Ironhusk's 44, one of five, and a Leviathan's 60, one of
    // nine — and the thing that throws ONE should throw the big one: the heaviest ball
    // in the sky is also the easiest to read, and there is only ever one of it in the
    // air at a time. Reusing the number rather than inventing one is the point.
    //
    // IT CLEARS EASILY AND THAT IS CORRECT. The dodge inequality in shared/orbs.js is
    // v x (d/ORB_SPEED - READ_TIME) >= orb r + hull r; at the 364px this holds station
    // at, a starter Hauler has 168px of lateral room against the 72px it needs, so a
    // new pilot who moves at all is clear with 2.3x to spare. Charge it to point blank
    // and that room goes to nothing — which is the Ironhusk's lesson arriving early,
    // and the only other thing a Drifter has to say.
    orbs: { n: 1, arc: 0, r: 60 },
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Lobs one slow ball at a time. Move, and it goes past. That is the whole lesson.',
  },

  // A reactor with nothing left holding it in, and no gun at all.
  //
  // Everything about it is one circle. The circle is what hurts you, the circle is
  // how much of it you have killed, and the circle is what happens when you finish
  // it. There is nothing else to read and nothing else to learn.
  //
  // WHY IT IS A RATE. A Drifter throws 49.5 damage a second. Against the starter it
  // was written for that is 4.5% of the pilot a second; against a finished ship at
  // x32 research it is 0.025%, which is 4,558 seconds to kill anybody. Every hostile
  // in this file that carries a gun is a flat number that was only ever true at one
  // stage, and the research ladder is what made that visible. So this one takes a
  // SHARE — 0.045 of whatever is standing in it, per second, which is
  // ANCHORS.pressure itself rather than a new number. Its pressure is exactly 1.00
  // at every stage in the model, which nothing else in the bestiary manages.
  //
  // WHY THE RING GROWS. `goad` is full spin per its own effective hit points taken
  // off it, so damaging it destabilises it in exact proportion to how much of it is
  // gone: the radius IS the health bar, drawn at the scale it matters at, and you
  // are standing inside it. It climbs on a clock as well, because a field driven by
  // damage alone inverts the difficulty — the weaker your gun the slower it winds
  // up, and a starter Hauler would out-farm a finished Bulwark.
  //
  // 720 is the reach at full spin, and it is set BETWEEN the Vanguard's 700 and the
  // Bulwark's 820. So exactly one hull in the shop can hold the trigger from outside
  // the ring, and it is the slowest and dearest one — which makes this the first
  // thing in the game that argues for weapon range rather than for hit points, one
  // hop out, at the moment a pilot is choosing what to buy. It is deliberately not
  // the Lamprey's 900: a tether has to out-reach everybody to hold on, a fire only
  // has to reach as far as the thing shooting it.
  //
  // WHAT IT ASKS YOU TO DO. Fight at your own range, and be somewhere else when it
  // dies. The pyre goes off at `blast` times the ring — 900px, past every gun in the
  // game — 1.8 seconds after the kill, and it is the only 1.8 seconds that matter.
  // Simulated at every stage: hold 85% of your reach or better and you clear it;
  // let it inside 70% and nothing you do afterwards helps. A finished ship at x32
  // pays 0.1% of its hull for the first and 14.2% for the second, and those two
  // numbers are the same at x1, x2, x4, x8, x16 and x32 — because both are
  // fractions, and research multiplies the pool it takes its fraction of.
  //
  // 6,500 is the Ironhusk's rung exactly, and so are the 4,550 bounty and the 1,400
  // experience. That is the point rather than a coincidence: co2 and co3 are the
  // same distance from home and the seeding rule says they must be the same weight
  // of fight, so the way to make them different is to make the SAME weight ask a
  // different question. An Ironhusk is armour with a short gun — 500 reach against
  // your 620-820, so kiting costs it everything. A Censer is the inverse in every
  // term: no gun at all, and a reach that comes to you and grows while you win.
  //
  // 5,500 hull to 1,000 shield rather than the husks' 69/31, because the shield IS
  // the containment and there is not much of it left.
  //
  // Speed 190 is the Ironhusk's, and it is measured rather than inherited: "slower
  // than every hull" is a claim about BARE hulls and the game does not contain any —
  // generators cost speed, so a finished Bulwark idles at 152 and tops out at 234
  // with the reactor on its thrusters. 190 is under that with 44px/s to spare, which
  // is what "leaving always works" actually costs to promise.
  censer: {
    name: 'Censer', cls: 'Runaway', r: 28, colour: '#f0b429', shape: 'rotor',
    attrs: { hull: 5500, shield: 1000, shieldRegen: 0.12, shieldDelay: 4,
             speed: 190, accel: 520, signature: 8,
             // No gun, and this is the whole brief. weaponRange 0 makes fire()
             // refuse every tick without a special case — the Bulkhead Target has
             // done exactly this since it was added. fireRate is the ATTRS floor
             // rather than 0 because 1 / fireRate is a real division.
             damage: 0, fireRate: 0.1, weaponRange: 0 },
    burn: {
      idle:  110,     // px  cold. Inside every hull's reach with 500px to spare, so an
                      //     idle one drifting past you is scenery and not a hazard
      reach: 720,     // px  at full spin — between the Vanguard's 700 and the Bulwark's
                      //     820, so exactly one hull can hold the trigger from outside it
      rate:  0.045,   // of your effective hit points per second: ANCHORS.pressure, exactly
      up:    15,      // s   hunting you, cold to full, and half that with you inside it.
                      //     Not picked: 6500 / 429 dps is the 15.2s fight its hit points
                      //     buy the pilot it is posted for, so the ring arrives exactly as
                      //     the fight ends for them, early for anyone slower and late for
                      //     anyone faster
      down:  6,       // s   to settle once it has lost you
      goad:  1,       // full spin per its own effective hit points taken off it
      blast: 1.25,    // the pyre reaches 1.25x the ring — 900px at full spin, past every
                      //     gun in the game, so distance alone never saves you
      fuse:  1.8,     // s   the ring stands after it dies, and then lets go. Measured: it
                      //     is long enough for the slowest ship in the game to clear the
                      //     pyre from 85% of its own reach, and not from 70%
    },
    aggro: 460,       // the Ironhusk's, and inside SIGHT_R like every other
    // Nothing settles the reactor except losing you, so how far you have to go to be
    // lost IS the price of the patient way through. It has to be comfortably outside
    // the pyre or it would forget you while it was still about to kill you: 1300
    // against a 900px blast leaves 400px of margin.
    leash: 1300,
    patience: 3.0,
    flee: 0,          // a runaway reaction has nowhere to be
    respawn: 30,      // the Ironhusk's — same rung, same sector distance, same cadence
    bounty: 4550,     // 6500 ehp at BOUNTY_RATE, which is the Ironhusk's to the credit
    xp: 1400,         // and likewise
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'No gun. The ring burns whatever stands in it and widens as you kill it, then stands after it dies and lets go of the rest.',
  },
  // The one thing on a gate you are meant to be able to finish.
  //
  // A gate sector held one Thresher and nothing else. That made it a corridor: the
  // only thing standing on it deals back every point you put into it — 205,550 over
  // the fight, whatever you fly — and a pilot arriving from the frontier in a
  // finished hull with no research carries 9,305. One mirrored volley is 5,595 at
  // the stage that gets there. You do not fight it; you fly past it. The frontier
  // solved exactly this problem by standing Harriers beside the Bandits, and this is
  // that move again one hop out: something workable to hunt on the map you are
  // running away from something on.
  //
  // WHERE IT LANDS. 65,000, which is a rung of tens and the Leviathan's. It is a
  // shared rung on purpose, and it is NOT the Censer's reason for sharing one — co2
  // and co3 are equidistant and must weigh the same, so they differ by question. A
  // Leviathan is a frontier fixture and this is a gate fixture, so the sharing is
  // the ordinary rule instead: every sector keeps something well under its ceiling
  // or it is somewhere you fly through. The frontier's ceiling is 114,000 and it
  // keeps 2,060 Harriers, a factor of 55. A gate's ceiling is 205,550 and it keeps
  // this, a factor of 3.2 — much the tighter of the two.
  //
  // The rung above is the Thresher's own 205,550 and taking it was the other real
  // option. It is refused: two hostiles of identical weight on ONE map, one of which
  // cannot kill you, makes the other one pointless — you would never fight the
  // mirror again. Sharing a rung has to happen across sectors, not inside one.
  //
  // 45,500 credits and 14,000 experience follow, and they are the Leviathan's to the
  // credit because bounty is farm hit points x BOUNTY_RATE and nothing else. There
  // is no effort multiplier and there deliberately cannot be one: effort is what a
  // thing's hit points are worth once you count the shots that never land, and a fix
  // never costs you a shot. It always moves you TOWARD the thing shooting at you,
  // because the point it returns you to is one you occupied while it was chasing —
  // so what it takes is hull, and hull is `pressure`, not `effort`. Paying a bounty
  // for danger rather than for time is the mistake bountyFor exists to prevent.
  //
  // WHAT IT ASKS. Every other hostile in this file is answered by position. Kite the
  // husks, hold 85% of your reach off a Censer, out-range a Harrier, break a
  // Lamprey's tether, sidestep a Thresher. This is the one that takes position back:
  // a fix undoes the last three seconds of wherever you were going, every six. You
  // can still leave — see escapeTax in shared/kedge.js, it costs exactly twice as
  // long and never more — but you cannot leave for free, and that is the animal.
  //
  // 350.2125 dps is not a chosen number either: it is ANCHORS.pressure x the
  // effective hit points of the stage it is posted for, which is the model's own
  // definition of a hostile that is exactly on model. What is new is that for this
  // one the number is a FLOOR rather than a ceiling: every other armed hostile's dps
  // is what it would do if you let it, and this one collects because you cannot hold
  // range on it.
  //
  // It has now moved twice, both times because the stage under it moved, and both
  // times without anybody deciding anything about a Kedge. 258.75 — 345 x 0.75 — was
  // the shipped number; the hull rework gave the Bulwark a third generator bay and a
  // second technology bay and took it to 330.975; and percentages compounding
  // instead of summing (see resolve() in ships.js, and the Cadence pair it was
  // written for) took the cruiser stage from 7,355 to 7,782.5 effective hit points,
  // because Composite Plating and an Ore Foundry now land as 1.50 x 1.45 rather than
  // 1 + 0.95. A gun defined as a share of that pilot has to follow or it is no longer
  // the thing the comment above says it is. That is the whole point of deriving it:
  // test/kedge.mjs asserts the equality to 1e-9, so a change anywhere upstream cannot
  // leave this quietly reading 0.95 of the fight it claims to be. The rate is
  // unchanged, so 466.95 x 0.75 is the pair — 350.2125 has no factorisation with a
  // whole-number bolt at any rate worth firing, and a hundredth of a point on the
  // bolt is the smaller lie.
  //
  // Reach 900 is the Leviathan's and the Thresher's, and it is the same number for
  // the same reason: past every hull in the game (620-820), so you cannot out-range
  // the problem. It was 560 for one draft, on the theory that kiting should be the
  // obvious answer and the fix should be what takes it away. Measured, that draft
  // was a pushover — a finished pilot holding 780px killed it in 8.5s and gave up
  // 10% of a hull, because a Kedge that plants itself to take a sighting stops
  // closing, so the kiter stops retreating, so the collapse has nothing of theirs to
  // undo. A fix cannot punish standing still and should not try: it punishes
  // LEAVING, and the gun has to be what makes you want to.
  //
  // Speed 150, and it is NOT the Ironhusk's 190. That number carries an argument —
  // "under a finished Bulwark's 234 with the reactor on its thrusters" — which is
  // true and incomplete, because a chase outlasts a capacitor. Routing to thrusters
  // costs charge, and once the charge is gone a system falls back to the free
  // trickle: the slowest thing any pilot can hold indefinitely is a finished Bulwark
  // at 152 x (1 + 0.54 x 0.52) = 195 px/s. A 190 Kedge is 5px/s under that, which
  // measured as a hostile a finished Bulwark could not leave at all — 300 seconds of
  // full burn and the leash never broke. 150 is a quarter under the floor rather
  // than a hair under the ceiling, and every hull breaks off in under 33 seconds.
  //
  // Shield regen 0.012 rebuilds its shell in 83 seconds — deliberately not the
  // Leviathan's 0.045, because a rung-mate that ALSO punished breaking off would be
  // a second cooperation gate and this one is meant to be soloed.
  // A Surveyor, and the only thing in the game that charges you for LEAVING.
  //
  // Its fix takes a sighting of where you are standing and three seconds later puts you
  // back on it — see shared/kedge.js for why that is a toll rather than a trap, and why
  // it has to hold station to do it. What sat underneath was a plain aimed bolt for 350
  // a second, and an aimed bolt is not dodged by anybody: the table at the top of
  // orbs.js measures 94% of what one fires landing on a hull weaving as hard as it can.
  //
  // A LANCE ON A LINE, then, and it is the same 350 dps in a shape you can be somewhere
  // else for. The line is paid out to YOUR range with a fluke on the end of it and swung
  // through an arc; the head is what cuts you, and it arrives at your bearing half a
  // swing after it starts moving. See shared/sweep.js — the numbers below are pinned
  // there from both ends and this is what they came out as.
  //
  //   span 2.4   rad. 137 degrees, and it is a FLOOR rather than a look: the fastest
  //              thing in the game boosted covers 727px of arc at this hostile's 630px
  //              standoff over the 1.30s the attack takes, which is 1.15rad a side. So
  //              nothing in the shop can walk out of the side of it, and the answer has
  //              to be the other one.
  //   wind 0.70  s of the line taut and still, at the radius and over the arc it is
  //              about to sweep. This is the read, and it is most of the budget.
  //   swing 0.60 s to cross the arc. 0.70 + 0.60/2 = 1.00s from the throw to the head
  //              arriving, against the 0.891 a cruiser needs to clear 77px at 142 px/s
  //              with 0.35 of that spent reading it. 15px of margin, deliberately thin.
  //   r 60       px of fluke, the largest ball this game throws. It is the CEILING in
  //              the budget above: a bigger head is a head a jink no longer beats.
  //
  // AND THE DODGE IS RADIAL, WHICH IS NEW HERE. Every other pattern in the bestiary is
  // answered by moving sideways; a lance paid out to your own range is answered by
  // changing your RANGE. That is what makes the two halves of this hostile one fight
  // instead of a gun beside an ability: a collapse is a radial displacement — it puts
  // you back on a range you have left — so the sweep bills you for holding a range and
  // the fix undoes a change of one. Measured together and separately in test/kedge.mjs,
  // because "hauled back into a sweep you already dodged" is either the best thing in
  // this bestiary or unplayable and only the bench can say which. It is neither: the
  // haul lands inside a swing 22% of the time and the pair costs a pilot who answers
  // both 20.9% of a hostile that reads 350 dps, against 100% for one who answers
  // neither.
  kedge: {
    name: 'Kedge', cls: 'Surveyor', r: 34, colour: '#7c8824', shape: 'fluke',
    tell: 'Swings a lance on a line at the range you are holding — change your range, not your bearing. Its fix then hauls you back to the range you just left.',
    sweep: { span: 2.4, wind: 0.70, swing: 0.60, r: 60 },
    fix: {
      fuse: 3.0,      // s from the sighting to the collapse. JUMP_TIME exactly: the fix
                      //   and the door cost the same three seconds, so reaching a portal
                      //   mouth first is the answer and reaching it second is not
      cool: 3.0,      // s before it may take another. Equal to the fuse, so leaving costs
                      //   exactly x2 — see escapeTax
    },
    attrs: { hull: 40000, shield: 25000, shieldRegen: 0.012, shieldDelay: 5,
             speed: 150, accel: 300, signature: 8,
             damage: 466.95, fireRate: 0.75, weaponRange: 900 },
    aggro: 540,       // the Thresher's, still inside SIGHT_R, so it is on screen first
    leash: 1800,      // a picket has no business chasing you across a sector
    patience: 4.0,
    flee: 0,          // it has nowhere to be; it IS the place
    respawn: 90,      // the Leviathan's — same rung, same weight of fight, same cadence
    bounty: 45500,    // 65000 ehp at BOUNTY_RATE, exactly
    xp: 14000,
  },
  // A mirror. It returns what you put into it, and that is the whole design.
  //
  // Every other hostile is a wall of hit points, and the research ladder makes walls
  // of hit points irrelevant: a finished ship at x32 takes 4,558 seconds to die to a
  // Drifter and deletes anything under 100,000 effective hit points in under two
  // seconds. Content whose only tool is damage is finished.
  //
  // So the difficulty of this fight is set by YOUR gun rather than by its hull.
  // `returns: 1` is the fiction rather than a dial — a mirror returns what it is
  // given — and the chamber it returns it out of is MIRROR, below.
  //
  // 205,550 is 650 x 10^2.5 to the nearest ten — half a rung under the Corsair Hive,
  // the same relation the Harrier has to the Ironhusk. That is the HP axis and it
  // has not moved. The damage axis has: a full chamber is what the shop's sharpest
  // gun does, so at the top of the ladder this is the hardest thing in the game to
  // stand in front of, and it is hardest precisely for the pilot who has bought the
  // most gun:
  //
  //                         full chamber      lived, standing still, finished ship
  //   Thresher             11,387 dps         3.7s
  //   Corsair Hive          2,450 dps         2.9s
  //   on model, balance.js    317 dps        22.2s
  //
  // The chamber only reads full when you fill it, though, and that is the whole
  // fight. A Thresher's own barrel is 80. Everything above that came out of you.
  //
  // What it gave back USED to be one for one and uncapped, which is a one-shot by
  // arithmetic rather than by intent: your damage spans 256x across the shop and
  // your hit points span 6.4x, so at the top of the ladder one returned bolt was
  // 9,011 into a 7,050 ship, and buying a bigger gun bought a proportionally harder
  // fight. Then the chamber capped it at 855, which is 9% of the 9,305 a finished
  // ship carries today — the thing at the gates stopped being a fight at all, and a
  // pilot who weaved beat it with 39% left and no research. Both of those are wrong in the same way: the ceiling
  // was picked off the bestiary instead of off the shop.
  //
  // The answer is still a behaviour rather than a purchase. Measured, finished
  // Bulwark, reactor on weapons, NO research: it dies to all four lines of play —
  // 3.7s standing, 3.4s kiting, 5.8s weaving, 3.7s holding fire a second in three.
  // Weaving is the one that scales: it wins from x8 hull and shields with 8% of the
  // ship left, keeps 54% at x16 and 77% at x32; standing still wins from x16 and
  // breaking off from x32. Holding fire buys the least of the four, and that falls
  // out of the identity rather than being a surprise — the total returned over a
  // whole fight does not depend on your dps, so a longer fight is the same damage
  // spread thinner. Weaving is different because a bolt that misses is damage that
  // never arrives at all.
  //
  // And the fight is easiest for the pilot with the least gun, which is the mechanic
  // working: a Kestrel with no research, weaving, kills one in 569.8s without ever
  // dropping below 70% of its ship, taking 476 a bolt where the finished Bulwark
  // beside it takes 9,706. The chamber it is being shot with is drawn over its head
  // the whole time, so which of those you are doing is something you can see rather
  // than something you read in a threat file.
  //
  // Speed 200 is under every bare hull, like a Leviathan: it can kill you but it
  // can never trap you. Reach 900 is over every hull, also like a Leviathan, so you
  // cannot simply out-range the problem. NOTE, because it is measured and it is not
  // what the old test claimed: a FITTED ship is slower than a bare one — generators
  // are bought with speed — and a finished Bulwark flies at 152 against this thing's
  // 200. You cannot open range on a Thresher in the hull that fights it, so backing
  // off is worth nothing measurable and the disengage is the trigger and the
  // stick, not the throttle. test/aliens.mjs now says that out loud.
  thresher: {
    name: 'Thresher', cls: 'Revenant', r: 46, colour: '#e4e4e4', shape: 'facet',
    returns: 1,
    // AND WHAT IT COMES BACK AS. One fat bolt was a bigger number, and a bigger number
    // is only legible after it has landed on you. The chamber returns a WALL now, and
    // how much wall is how full it is: one splinter at nothing, seven at a full one,
    // fanned across 76px at the range this thing fights from. The volley carries
    // `payloadOf(def, load)` in TOTAL and is split evenly, so the identity above is
    // untouched to the decimal — see shared/shards.js.
    //
    //   fan 0.06032  rad of half-width at a full chamber, and it is DERIVED from the one
    //                thing that must not move: a pilot who never moved has to take all of
    //                it. A bolt lands on anything within HIT_R + hull r of its aim point,
    //                so the outermost splinter may sit at most one slack radius off the
    //                middle — 38 / (900 x 0.7) = 38/630. At the standoff every hull in
    //                the game is inside all seven discs at once and holding station costs
    //                exactly what the single bolt cost. test/aliens.mjs pins this equal to
    //                HIT_R / (weaponRange x 0.7) to eleven places.
    //   n 7          splinters at a full chamber, and this one was ARGUED. Above: the
    //                count IS the meter, and a meter you have to count is not a meter.
    //                Below: a splinter has to be a number worth reading — the 10,053 a
    //                finished pilot actually holds it at is 1,436 each at seven, 15% of
    //                their ship; at twelve it is 838 and the wall is a light show.
    //
    // What it costs the pilot is the half that is not free: clearing the whole wall asks
    // for twice the displacement clearing one bolt did, and a weave that half clears it
    // now half lands instead of missing outright. So the chamber makes the DODGE harder
    // as it fills rather than only the hit bigger, which is the thing a meter alone
    // could never say.
    shards: { n: 7, fan: 0.06031746031746032 },   // = 38 / 630, exactly
    attrs: { hull: 175550, shield: 30000, shieldRegen: 0.0133, shieldDelay: 6,
             speed: 200, accel: 320, signature: 9,
             damage: 80, fireRate: 1.0, weaponRange: 900 },
    aggro: 540,       // inside SIGHT_R, so it is on screen before it decides
    leash: 2600,
    patience: 5.0,
    flee: 0,          // it does not run. It has nowhere to be.
    respawn: 120,
    bounty: 143885,   // 205550 ehp at BOUNTY_RATE, exactly
    xp: 44272,
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'A mirror. It throws your own fire back as a wall of splinters, and how wide the wall is is how full its chamber is. Stop shooting to empty it, and do not stand still.',
  },

  // The rung between a Drifter and an Ironhusk, and the reason the frontier is
  // worth visiting before you can fight what lives there.
  //
  // The bestiary is a ladder of tens — 650, 6500, 65000, 650000 — so the step in
  // between is not a number anyone had to choose: it is one half rung, x sqrt(10),
  // which puts it at 2055 effective hit points. Bounty and experience follow from
  // that the way every other hostile's do.
  //
  // 2060 rather than 2055.5, and the rounding is not a slip. A bounty is
  // whole credits and BOUNTY_RATE is 0.70, so effective hit points have to be a
  // multiple of ten or `bounty = ehp x rate` stops being exactly true — 2055 pays
  // 1438.5, which cannot be a bounty. So it is the nearest ten to x sqrt(10), which
  // is 2060. Every hostile before this one happened to be
  // a round multiple of 650 and nobody had to notice. test/balance.mjs asserts the
  // identity to 1e-6 across every hostile and every stage, and it caught this.
  //
  // What it is FOR is the dynamic at the frontier. Bandits hold those sectors and
  // will kill anyone who arrives able to afford the trip, which made the whole
  // frontier a wall rather than a place. Harriers give a pilot something to farm
  // out there while a Bandit is somewhere else — and because a Bandit is faster
  // than anything but a Kestrel, noticing one and getting out is the game being
  // played in between the kills.
  //
  // So it is fast, and that is the whole character: 380, quicker than every hull
  // but a Kestrel's 430. You cannot outrun a Harrier, you have to fight it — while
  // watching for the thing you CAN'T fight. It is not tough: 2055 next to a
  // Bandit's 30000, and its 560 range is under every hull's, so it dies to the
  // same kiting a Drifter does once you have committed to it.
  harrier: {
    name: 'Harrier', cls: 'Skirmisher', r: 14, colour: '#8fa8ff', shape: 'blade',
    attrs: { hull: 1420, shield: 640, shieldRegen: 0.0859, shieldDelay: 4,
             speed: 380, accel: 1400, signature: 3,
             damage: 50, fireRate: 1.2, weaponRange: 560 },
    aggro: 480,       // inside SIGHT_R, so it is on screen before it decides
    leash: 1900,
    patience: 3.0,
    flee: 0.08,       // it commits; something this quick running would never die
    respawn: 20,      // between a Drifter's 14 and an Ironhusk's 30, like the rest of it
    bounty: 1442,     // 2060 ehp at BOUNTY_RATE, exactly
    xp: 444,          // and the same at XP_RATE, to the nearest point
    // A FENCE ACROSS THE ROAD IN FRONT OF YOU, and it is the only pattern in the game
    // aimed at where you are GOING rather than at where you will be when it arrives.
    //
    // A rake — see SHAPES in shared/orbs.js. Three orbs, thrown at three marks strung
    // along your own course a fifth of a second of your own travel apart, each one
    // flying to its mark and then sitting on it for a cycle. What lands is a hedge
    // laid across the line you were flying, about a second of road long.
    //
    // WHAT IT ASKS FOR IS A TURN, and nothing else in the bestiary asks for one. An
    // Ironhusk wants you off its line once; a Leviathan wants you to keep changing your
    // mind; this wants you to stop committing to a heading. Hold station and the three
    // marks collapse onto one point and the whole volley lands on you — which is what
    // keeps 60 dps reachable and therefore what keeps the bounty, the experience and
    // every claim roster the numbers they already were. Hold a straight course and you
    // drive through all three, because a straight line is not a dodge. Turn and it is
    // behind you.
    //
    // A STRAFING RUN LAYING A WAKE WAS THE FIRST DESIGN AND THE ARITHMETIC KILLED IT,
    // which is worth writing down because it is the same arithmetic orbSlots uses for
    // a fan's width. A trail spreads a volley across the distance it is laid over and
    // a point target intercepts a fixed 2 x (orb r + hull r) of it: at 380px/s a 2.5s
    // pass lays 950px of wake and a hull collects 112px, 12%. A wake cannot carry a
    // hostile's book dps, so it can only ever sit on top of a weapon that does — and
    // this hostile has one weapon. The seam is named `wake` in SHAPES for the day
    // something is given two.
    //
    // 0.28s BETWEEN THE MARKS, and it is a ceiling rather than a taste. orbSlots
    // argues at length that a pattern may not have a hole in it; the same rule in a
    // rake's units is span x (the fastest hull) <= 2 x (orb r + hull r), and a Kestrel
    // at 430px/s against a 52px orb and a 10px hull gives 0.288. So at the top speed
    // the shop sells the fence is still solid, and at a Hauler's 300 the marks are
    // 84px apart inside 128px of disc.
    orbs: { shape: 'rake', n: 3, span: 0.28, r: 52,
            stay: 0.83 },   // STAND cycles at fireRate 1.2 — see stayFor in orbs.js
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Lays a fence across the course you are holding. Turn — running straight through it is not a dodge.',
  },

  // Ten Drifters welded into one hull, and deliberately exactly that: 6500 ehp
  // is 10 x 650, the 4550 bounty is 10 x 455 because bounty is ehp x BOUNTY_RATE,
  // and 1400 xp is 10 x 140. One number was chosen — the multiple — and the rest
  // follow from rules already written down.
  //
  // It sits one hop out from home because that is the first place you arrive
  // having outgrown Drifters, and a husk that takes real work is the cheapest
  // possible way to say so.
  //
  // The important part is that it is NOT a bigger health bar you stand in front
  // of. Measured against the build most players have at that point — one emitter,
  // one launcher, one drone, 145 dps — trading blows with it is a loss: 45s to
  // chew through it while it returns 72 dps into 1100 hull. It is meant to teach
  // the thing the Drifter never had to. Every answer is positional, and all of
  // them are available on day one:
  //
  //   speed 190  — slower than every hull in the game, the Bulwark included at
  //                250, so you can always leave and always come back
  //   range 500  — under all four hulls (620-820), so kiting costs it everything
  //   accel 420  — ponderous, so a turn buys you distance rather than a trade
  //
  // Fight it properly and it never touches you; stand still and it removes you.
  // A pilot who has moved up to two emitters and a better rack kills it in 13s,
  // which is the progression this is here to make visible.
  ironhusk: {
    name: 'Ironhusk', cls: 'Husk', r: 26, colour: '#d0563f', shape: 'hex',
    attrs: { hull: 4500, shield: 2000, shieldRegen: 0.065, shieldDelay: 5,
             speed: 190, accel: 420, signature: 6,
             damage: 90, fireRate: 0.8, weaponRange: 500 },
    // Aggro inside SIGHT_R like the Drifter's, so it is on screen before it
    // decides anything. Short leash: something this slow has no business
    // following you across a sector, and being able to break off is the lesson.
    aggro: 460,
    leash: 1500,
    patience: 3.0,
    flee: 0,          // armour is its whole answer; it has nowhere to run to
    respawn: 30,
    bounty: 4550,     // 6500 ehp at BOUNTY_RATE, which is 10 x the Drifter's 455
    xp: 1400,         // likewise 10 x 140
    // A SHOTGUN OF SLOW ORBS, instead of a laser, and it is the FIRST thing in this
    // game you beat by not standing somewhere. The bolt it replaces landed 99% of what
    // it fired on a pilot holding station and 94% on a laden Bulwark weaving hard
    // enough to reverse three times a second — a lead plus 50px of slack cannot be
    // beaten in the half second a bolt takes to cross 500px, so there was no dodging
    // here to be good at.
    //
    // Five orbs of 44px over 0.20rad. The width is a MEASUREMENT and not a look: at the
    // 350px it fights from the fan is 70px of centres inside 88px balls, so it is one
    // overlapping wall you have to be off the line of rather than five things to slip
    // between — and it opens with distance, so at its full 500 the outer pair is past
    // the hull and only the middle of it lands. That gradient is the Ironhusk's
    // existing lesson (its reach is 500; hold your own range) drawn on the screen.
    //
    // A WIDER FAN WAS TRIED AND COSTS THE HOSTILE ITS GUN, which is the arithmetic
    // this number came out of: a point target intercepts a fixed 2 x (orb r + hull r)
    // of whatever is thrown at it, so the share of a volley that lands is that width
    // over the fan's, and nothing else. At 0.32rad the same five orbs put 59% of the
    // volley on a pilot who never moved and the claim arenas went from costing 89% of
    // the ship to 36%. At 0.20 they put 99% on them and the claims read 17% / 14% / 6%
    // of the ship left against 11% / 11% / 0% before any of this.
    //
    // So the volley is `damage` split five ways and the cadence is untouched, and
    // threatDps still reads 72 and still means what it says: what the whole fan does
    // if the whole fan lands, which is what happens to anybody who holds a course.
    // Bounty, experience, the bestiary report and three claim rosters are all the
    // numbers they already were.
    orbs: { n: 5, arc: 0.20, r: 44 },
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Throws a shotgun of slow orbs. Get off the line and it costs you nothing; hold it and it costs you everything.',
  },

  // Ten Ironhusks, by the same arithmetic that made an Ironhusk ten Drifters:
  // 65000 ehp, a 45500 bounty because bounty is ehp x BOUNTY_RATE, and 14000 xp.
  //
  // It exists because the Ironhusk stopped needing anyone's help. So this one is
  // built so that it cannot be soloed by patience, which is the loophole every
  // other alien in the game leaves open:
  //
  //   range 900   - longer than every hull (620-820). The first thing here you
  //                 cannot kite. Out-ranging it is not on the table; you either
  //                 stand in it or you leave.
  //   regen 900/s - and shields only come back after 3s untouched, so a lone
  //                 pilot who breaks off to survive hands back 20000 shield in
  //                 22 seconds. Break off enough to live and you never finish it.
  //
  // Those two together are the cooperation gate, and neither is a special case:
  // they are the ordinary shield timer and the ordinary weapon range, set where
  // one ship cannot hold both open at once. Two pilots can, by taking turns being
  // shot at while the other keeps the damage unbroken.
  //
  // What it does NOT do is trap you. It is slower than every hull including the
  // Bulwark at 250, so leaving always works — you just cannot leave and win.
  leviathan: {
    name: 'Leviathan', cls: 'Colossus', r: 40, colour: '#8fe04a', shape: 'crown',
    // 300 x 0.4 and NOT 150 x 0.8, which is the same 120 dps to the decimal — every
    // reader of this table takes the PRODUCT (threatDps, the balance model's armed
    // span, the bestiary report, the claim rosters), so nothing downstream moves. What
    // it buys is the cadence the barrage below needs: one salvo of nine every two and
    // a half seconds instead of a dribble, and half as many orbs in the air for it.
    // That second half is a wire measurement rather than a preference — at 0.8 it
    // would hold eighteen up at once, against a rocket rework that cut 35 projectiles
    // to 5 this morning and took the stream from 17.70 KiB/s to 4.73 for exactly this
    // reason. Measured live, the nine cost 2.9 KiB/s of an 11 KiB/s stream.
    attrs: { hull: 45000, shield: 20000, shieldRegen: 0.045, shieldDelay: 3,
             speed: 230, accel: 380, signature: 8,
             damage: 300, fireRate: 0.4, weaponRange: 900 },
    aggro: 520,
    leash: 2200,
    patience: 4.0,
    flee: 0,
    respawn: 90,
    bounty: 45500,    // 65000 ehp at BOUNTY_RATE, and 10 x the Ironhusk's 4550
    xp: 14000,        // likewise 10 x 1400
    // A ROLLING BARRAGE, and it is deliberately the opposite read from the Ironhusk's
    // cone. One trigger throws three clusters of three 60px orbs, four tenths of a
    // second apart, each one aimed afresh at where you will be when it gets there. A
    // cone is answered by being off the line ONCE. This covers where you are going for
    // the next second and a half, so breaking once puts you under the second cluster
    // and the answer is to keep changing your mind — which is exactly the lesson a
    // 900-reach sponge you cannot out-range should be teaching.
    //
    // IT WAS GOING TO BE A WALL WITH A HOLE IN IT and the measurement said no. See
    // orbSlots() in shared/orbs.js for the arithmetic: a hole a Bulwark actually fits
    // through needs the slots further apart than a hit disc, and a volley that LANDS
    // needs them closer, and at this hostile's 630px standoff there is no spacing that
    // is both. Measured across the whole family against the pilot the claim bench
    // flies, the best wall with a flyable hole delivered 23 dps of a 118 dps hostile —
    // 19% — and paying that back would need five times the damage against a balance
    // model with 5% of headroom (shared/balance.js reads it at 0.85 of the dps its
    // stage asks for; test/balance.mjs caps it at 0.9). The burst delivers 99%.
    //
    // 300 x 0.4 rather than 150 x 0.8 — the same 120 dps to the decimal, because every
    // reader of this table takes the product — buys the cadence the pattern needs: one
    // heavy salvo every two and a half seconds instead of a dribble, and half as many
    // orbs in the air. That second half is a wire measurement rather than a
    // preference; see the attrs above.
    orbs: { n: 3, arc: 0.12, r: 60, burst: 3, beat: 0.40 },
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Walks three volleys of slow orbs across your course from outside your reach. Breaking once is not enough.',
  },

  // Ten Leviathans, and the reason there is anything at Nullpoint.
  //
  // The core sector sat empty: three companies' worth of contested space with
  // nothing in it to contest. This is what is there. 650000 ehp by the same chain
  // that made every other number in this file — ten times the thing one rung
  // down — which puts the bounty at 455000 and the experience at 140000.
  //
  // On its own it would only be a very long Leviathan. What makes it a fight is
  // that it launches Bandits: it is their mothership, and the raiders you have
  // been hunting at the frontier come from here. They arrive four at a time,
  // every eighteen seconds, and only once it has noticed you — a hive nobody has
  // found does not quietly fill the sector with raiders. So the fight is never
  // about the hull in front of you: it is about whether your party can keep
  // killing escorts and still put damage into something with 650000 hit points.
  //
  // Its own guns are almost beside the point. 110 dps and it can barely move,
  // which is deliberate: everything dangerous about it is something else.
  hive: {
    name: 'Corsair Hive', cls: 'Mothership', r: 70, colour: '#e04fa0', shape: 'hive',
    // 550 x 0.2 AND NOT 220 x 0.5, which is the same 110 dps to the decimal — every
    // reader of this table takes the PRODUCT (threatDps, hiveDps, the balance model's
    // armed span, the bestiary report, the claim rosters), so nothing downstream moved.
    // What it buys is the whole conversion: the cadence is now `1 / broods.every`, which
    // means the gun and the hatch are ONE clock and one act. The barrel is a pod that
    // arcs out slowly, carries the whole of the gun's damage to where it lands, and
    // cracks open there — so dodging it decides where the raider comes out rather than
    // only whether you were hit. See shared/brood.js.
    //
    // It is the Leviathan's trick one rung up ("300 x 0.4 and NOT 150 x 0.8") and the
    // Crucible's shape exactly ("the gun IS the delivery of the ground"). test/aliens.mjs
    // pins fireRate equal to 1 / broods.every, so a change to the cadence that forgot the
    // gun fails there instead of quietly halving the hostile.
    attrs: { hull: 450000, shield: 200000, shieldRegen: 0.006, shieldDelay: 4,
             speed: 110, accel: 180, signature: 10,
             damage: 550, fireRate: 0.2, weaponRange: 1100 },
    // Escorts are the fight, so there have to be enough of them for that to be
    // true. Four every eighteen seconds was a trickle you could ignore between
    // volleys. One every five now, up to twelve alive — which means a hive left
    // alone for a minute has a dozen raiders around it, and the pressure comes
    // from what you did not clean up rather than from any single one of them.
    //
    // `max` is absolute and the pod cannot get round it: the pod is thrown on the clock
    // whatever happens, and whether it is LADEN is decided at the throw against the brood
    // that is actually alive. A pod thrown at a full brood is ordnance and nothing else,
    // which is what keeps `damage x fireRate` honest — a gun that stopped once the
    // escorts were out would be a hostile at a fraction of the dps this table claims.
    broods: { kind: 'bandit', every: 5, first: 2, max: 12 },
    aggro: 540,       // still inside SIGHT_R, so you see it before it decides
    leash: 2600,
    patience: 5.0,
    flee: 0,
    respawn: 300,     // five minutes. It is the only one, and it should be an event
    bounty: 455000,   // 650000 ehp at BOUNTY_RATE, and 10 x the Leviathan's 45500
    xp: 140000,
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'A mothership. Its gun is the launch: a slow pod that cracks open where it lands and lets a Bandit out. Dodge it and the raider hatches somewhere else.',
  },

  // A raider that you mostly cannot see. Its signature is shaped rather than
  // sized: nose-on it returns almost nothing, from the beam it comes and goes,
  // and from behind it is just a ship. The catch is that a Bandit engaging you
  // turns to face you, and facing you is its quietest aspect — so the way to see
  // one is to get off its nose, which means out-turning something faster than
  // you. See shared/stealth.js.
  //
  // Tougher and quicker than a Drifter and hits harder, but it will not stand and
  // trade: it breaks off early, and while it runs you can see it perfectly.
  bandit: {
    name: 'Bandit', cls: 'Raider', r: 13, colour: '#5fd0ff', shape: 'dart', stealth: true, evades: true,
    // Built to survive a finished ship for a quarter of a minute, and most of
    // that comes from not being hit rather than from soaking it: it breaks off
    // the firing line whenever a shot gets close. The hull behind that is real
    // but it is not the point.
    // Fast in a straight line and slow to change its mind — a wide-turning
    // interceptor. That is what makes the jink readable: it commits, and a
    // patient gunner can lead it. Give it fighter-grade acceleration and
    // lasers stop landing at all.
    //
    // 300 x 0.65 and NOT 150 x 1.3, which is the same 195 dps to the decimal — every
    // reader of this table takes the PRODUCT (threatDps, hiveDps, the balance model,
    // the bestiary report, test/kedge.mjs's ladder) so nothing downstream moves. What
    // it buys is HALF AS MANY CALTROPS IN THE AIR, and that is a wire measurement
    // rather than a preference: a scatter that stays is the first thing in this game
    // that accumulates, a Corsair Hive keeps twelve of these alive at once, and at the
    // old cadence twelve raiders held a hundred and seven parked orbs between them. It
    // is the Leviathan's 300 x 0.4 argument, made for the same reason one rung down.
    attrs: { hull: 22000, shield: 8000, shieldRegen: 0.0112, shieldDelay: 5,
             speed: 400, accel: 500, signature: 2,
             damage: 300, fireRate: 0.65, weaponRange: 640 },
    aggro: 520,       // it picks the fight, and from further out than you can see it
    leash: 2200,
    patience: 4.0,
    // It does not run. A Drifter flees because fleeing is the only thing that
    // saves it; a Bandit is already hard to hit and is faster than anything you
    // fly, so running would just mean out-pacing you, dropping the lock, healing
    // up out of reach and coming back. That is a treadmill, not a fight — the
    // first live duel went 100% to 11% and back up to 47% before it died. It
    // commits now, and what keeps it alive is the dodging.
    flee: 0,
    respawn: 40,
    // Measured: 3.81x, from 28% of shots landing against a husk's 75%. Rounded
    // down to 3.8 because the measurement is a simulation and the number should
    // not pretend to be more exact than the thing it came from.
    effort: 3.8,
    bounty: 79800,    // 30000 ehp x 3.8 effort at BOUNTY_RATE
    xp: 24554,        // and the same effective hp at XP_RATE
    // CALTROPS. A tight scatter thrown at your feet that comes to rest and lies there,
    // and it is the first thing in this game that leaves anything behind that is not
    // a Crucible's ground.
    //
    // Four orbs over 0.14rad, every one of them flown to the intercept and parked on
    // it for a cycle and a half — `stay`, see stayFor in shared/orbs.js. The arc is
    // narrow for the Ironhusk's reason and by the same arithmetic: at the 448px this
    // holds station from the four centres are 21px apart inside 124px discs, so a
    // pilot who never moved is covered by all four and takes the full 195 the threat
    // file quotes. Move, and they land where you were about to be and STAY there.
    //
    // WHAT IT ASKS FOR IS NOT COMING BACK, which is a verb no other hostile has. A
    // Drifter teaches move, a Harrier teaches turn, an Ironhusk teaches get off the
    // line, a Leviathan teaches keep changing your mind. This one fills the space the
    // fight is happening in with its own leavings, one throw and a half deep at any
    // moment, and the ground you have already used is the ground you may not use again.
    // The evasion and the attack finally point the same way: it jinks, so the clumps
    // come in from a new bearing every time, and the field it builds is shaped by
    // where it has been.
    //
    // "IT DROPS THEM BEHIND ITSELF" WAS THE ASK AND THE MEASUREMENT REFUSED IT, which
    // is worth the paragraph. A hostile that lays its gun on ground it is standing on
    // cannot deliver its book number, because it does not stand where you stand: this
    // one holds station at 448px and jinks 160px at a time, so a pilot who never moved
    // would take 0 of 195 and threatDps, the bounty, the experience and three claim
    // rosters would every one of them be quoting a hostile that no longer exists.
    // Thrown at your feet instead, the fiction survives with the subject changed — the
    // field is still where the FIGHT has been, and chasing something faster than you
    // through it is still what hurts.
    orbs: { n: 4, arc: 0.14, r: 50,
            stay: 1.54 },   // STAND cycles at fireRate 0.65 — see stayFor in orbs.js
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Scatters caltrops that stay where they land. Keep moving, and never back over your own ground.',
  },

  // A parasite. It has no gun at all.
  lamprey: {
    name: 'Lamprey', cls: 'Parasite', r: 30, colour: '#3fd19b', shape: 'maw',
    siphon: { reach: 900, spool: 5.0, rate: 0.0225, mend: 0.0225 },
    attrs: { hull: 14550, shield: 6000, shieldRegen: 0.0333, shieldDelay: 5,
             speed: 200, accel: 300, signature: 7,
             damage: 0, fireRate: 0.5, weaponRange: 0 },
    aggro: 500, leash: 2000, patience: 4.0, flee: 0, respawn: 45,
    bounty: 14385,
    xp: 4426,
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'No gun. A tether onto your hull that drinks past your shields and mends it. Fly out of range and the cord snaps.',
  },

  // --- the deeps ----------------------------------------------------------------
  //
  // The Corsair Hive stood here and now stands at the gates. It was never a deep
  // hostile; it was the biggest thing in the game parked at the furthest map,
  // which is a different statement, and the gates wanted it — a mirror you cannot
  // farm and a Kedge you can, with nothing in between that a party would cross a
  // sector for. What the deeps wanted was something that is not a bigger Hive.
  //
  // These two are that. Neither of them shoots at you. Both of them take GROUND
  // away from you and leave it taken, which is the one thing this bestiary has
  // never done: every hazard in it until now is a property of a hull and dies with
  // it. See shared/ground.js.
  //
  // WHERE THEY LAND. 2,055,480 effective hit points each — 650 x 10^3.5 to the
  // nearest ten, which is the same arithmetic that produced the Harrier's 2,060 and
  // the Thresher's 205,550 and is therefore not a new rule. It is half a rung above
  // the Hive, x sqrt(10).
  //
  // The brief asked for five times the Hive, which is 3,250,000 and is not on the
  // ladder at all. The two rungs either side of it are this and 6,500,000, and this
  // is the nearer on both readings: 5x is x1.58 above this rung and x0.5 below the
  // next, and in the logarithm the ladder is actually built in it is 0.199 of a rung
  // away against 0.301. Measured, the other rung is also the wrong FIGHT — see the
  // note on respawn below.
  //
  // WHY THE GROUND TAKES A SHARE AND THE GUN DOES NOT. The balance model's own
  // complaint, in test/balance.mjs: "content dps has not kept up with the player's
  // hull". Every armed hostile throws a flat number of points, player effective hit
  // points span x6.4 across the shop and another x32 across the research ladder, and
  // the deeps are precisely where the pilots at the top of both live. A bolt for 220
  // is not a threat to 220,736 effective hit points and no honest number of them is.
  // So the GROUND takes a share, the way a Censer's ring and a Lamprey's tether do,
  // and the share is what makes it the same fight at x1 and at x32.
  //
  // The gun is the other half and it is a flat number on purpose: it is the model's
  // own on-model figure, 438 dps at ANCHORS.pressure x stageEhp('finished'), so the
  // model has something to read. Neither of them SHOOTS it any more — the gun is what
  // throws the ground, one slow glob on the cadence the sowing was already on, and
  // where it lands is where the pool or the still is. One clock, one act, and the
  // product `damage x fireRate` untouched, so nothing derived from it moved.
  crucible: {
    name: 'Crucible', cls: 'Sower', r: 76, colour: '#f2ff1f', shape: 'crucible',
    // WHITE HEAT. It was White Heat, and the acid was chosen for a good reason: royal
    // water is the one thing that dissolves the noble metals, which is exactly what
    // the deeps pay out in. Flown, the reason stopped being true — chemistry is what
    // the FRONTIER reaches for, and a hull four hops out is built to shrug it off.
    //
    // The reason carries across intact, because there are only two ways at platinum
    // and iridium and the other one is heat. Platinum melts at 1,768 degrees and
    // iridium at 2,466, which is why anyone who wants them cheaply uses acid instead;
    // a Crucible does not want them cheaply. It carries a tap of a star's own surface
    // and pours it on the floor, and the floor is where you were standing.
    //
    // 0.045 of your effective hit points a second, and it is not a new number: it is
    // ANCHORS.pressure, the balance model's own definition of a hostile on model —
    // "4.5% of you a second, so it kills a pilot who stands still in 22.2 seconds,
    // whatever they fly". The designer asked for three times the old rate and the
    // ladder's own half-rung step is x3.16, so the ask and the rung land within 5% of
    // each other and this takes the rung. Standing in one kills you in 22.2s at every
    // stage of the game and every rung of research.
    //
    // r 560 is SIGHT_R — the world distance a pilot is guaranteed to see in every
    // direction, whatever their window. It is the LARGEST circle anybody can see the
    // whole of from inside it, and one pixel wider would be ground whose edge you
    // cannot find, which is a surprise rather than a decision.
    //
    // It replaces a derivation that was exactly backwards: 165px came from "the
    // slowest fitted ship covers 184px from rest inside the warning", so every hull
    // could refuse a pool from a standing start. Flown, that meant the pools never
    // hit anything — a Bulwark stepped aside without touching its thrusters. The
    // requirement is now the opposite one and it is met by geometry rather than by
    // timing: the fastest hull in the game covers 463px from rest inside the same
    // warning, so NOTHING steps out of 577px of pool. What leaving costs is measured
    // instead: 4.6 seconds for a finished Bulwark to cross out from the middle, 3.1
    // of them after the ground has gone live.
    //
    // ONE of them, not six, and ten seconds rather than thirty-six. Four of these
    // hostiles put THIRTY-TWO live patches on one screen and every one was animated;
    // area denial that covers everything denies nothing, because there is no clean
    // ground left to steer toward. The count is derived rather than taste: a fight is
    // fought on a circle 4,740px around — your own gun range at the speed the hull
    // that fights one flies — and a patch centred on it blocks a chord of 2r, so one
    // 560px pool takes 24% of it and two would take 47%. A third is the line; a
    // hostile that holds more than a third of the ground its own fight is on has
    // stopped shaping the space and started being the space.
    //
    // THE CADENCE IS THE TRIGGER NOW, and that is the whole of this conversion. It
    // used to be `every: 10`, a separate clock beside a 0.75/s barrel, and the two of
    // them together were two mechanics stapled to one hostile. There is one: the gun
    // throws the ground. So the interval is `1 / fireRate` below and it is not
    // written here at all, and the invariant `every` carried — a definition can never
    // ask for more ground than it is allowed to hold — is now an identity between the
    // two halves of the definition:
    //
    //     fireRate  =  max / life
    //
    // test/ground.mjs asserts it on both sowers, so a definition still cannot ask for
    // ground it is not allowed to keep, and now it cannot ask for a gun that disagrees
    // with its own ground either.
    //
    // The ten seconds itself stands where it stood: it is over twice the time the
    // slowest hull that fights one needs to CROSS OUT of a 560px pool from a dead
    // stop. Measured through step(), that is 4.60s, so a pilot who leaves the moment
    // they can is in the plasma for under half the interval — x2.17, and
    // test/ground.mjs re-measures it rather than trusting this line.
    sow: { kind: 'white',
           reach: 1100,            // how far it can THROW, and 200px past the `weaponRange`
                                   //   below: back off past the barrel's old reach and the
                                   //   ground still finds you, which is the layer this
                                   //   hostile already had and now has only one clock for
           r: 560,                 // SIGHT_R — the widest circle you can see all of
           life: 10, max: 1,       // and x2.17 the 4.60s it takes the slowest hull to
                                   //   cross out of one. life / max IS the fireRate below
           rate: 0.045,            // ANCHORS.pressure, exactly
           hold: 0 },              // it takes ground, not the ship
    // 85/15 hull to shield, the Censer's split and the Thresher's: a vessel is mostly
    // what it is carrying. Derived from DEEP_HP so the rung is one edit, not five.
    //
    // AND THE GUN IS THE POUR. It had no gun at all, then a plain aimed bolt for
    // 584 x 0.75; both were wrong in the same way and in opposite directions. With no
    // gun these two were the first hostiles where balance.js's `pressure x ehp` was
    // actively wrong rather than merely incomplete — the model wants a number of
    // points a second and they threw none. With a bolt they threw an undodgeable one:
    // 94% of what an aimed shot fires lands on a hull weaving as hard as it can (the
    // table at the top of orbs.js), so the damage was a tax and the ground was the
    // fight, which is two hostiles wearing one hull.
    //
    // 4380 x 0.1 is the same 438 dps to the decimal — ANCHORS.pressure x
    // stageEhp('finished'), the model's own answer to "what must a hostile at that
    // stage throw" — so threatDps, the bounty, the experience, the bestiary report
    // and every claim roster are the numbers they already were. What moved is where
    // it arrives: one slow glob every ten seconds, the same ten seconds the ground
    // was already on, and where it lands is where the plasma is. See stepLob in
    // shared/ground.js for what the throw is pinned by.
    //
    // A pilot who holds station takes every one of them and is therefore taking
    // exactly what the bolt cost. A pilot who turns takes none, and that is the only
    // thing about this hostile that changed.
    //
    // Reach 900 is the Leviathan's, the Thresher's and the Kedge's — past every hull
    // in the shop (620-820) — and it is now purely where this thing STANDS: standOff
    // reads it, and nothing else does. The throw is `sow.reach` at 1100, so the 200px
    // band where the ground reaches and the gun does not is still there and is now
    // the same statement twice rather than two mechanics. test/ground.mjs asserts the
    // two reaches stay in that order.
    attrs: { ...deepSplit(0.15), shieldRegen: 0.005, shieldDelay: 6,
             // 120, between the Hive's 110 and the Kedge's 150. Leaving always works:
             // the slowest thing a fitted pilot can hold indefinitely is a finished
             // Bulwark at 195 px/s, and this is 75 under it.
             speed: 120, accel: 200, signature: 10,
             // 0.1 is `max / life` from the sow block above — one clock, and the
             // identity is asserted rather than commented. 4380 is 438 / 0.1, so the
             // product is untouched and nothing downstream had to be re-derived.
             damage: 4380, fireRate: 0.1, weaponRange: 900 },
    mate: 'doldrum',  // it does not fly alone — see the seeding, and pairPost()
    aggro: 540,       // the Hive's, still inside SIGHT_R, so it is on screen first
    leash: 2600,
    patience: 5.0,
    flee: 0,          // it has nowhere to be; it is making the place
    respawn: 300,
    ...deepPay,       // DEEP_HP at BOUNTY_RATE and XP_RATE — nothing typed
    tell: 'Lobs White Heat where you are heading, and it stays. Turn and the glob lands behind you; hold your course and it lands on you.',
  },

  // The other half of the pair, and the dangerous one.
  //
  // SLACK WATER is the moment between tides when there is no current at all, and a
  // doldrum is the belt of dead air that used to hold sailing ships for weeks. Both
  // are the same idea and it is the only idea here: a place where nothing you do to
  // your engines makes any difference.
  //
  // WHAT "ROOTED" MEANS, EXACTLY, because this game had never taken movement from a
  // player and shared/kedge.js spends a paragraph on why a fix was allowed to exist
  // where a stun was not. It is a stun now, and it did not start as one: the first
  // cut zeroed your acceleration for a second and a half and kept your momentum, so
  // the ship carried on going wherever it was pointed and what you lost was the
  // ability to change your mind. That is the better mechanic and it is not the one
  // that was wanted — flown, a pilot at speed sailed straight out of the trap and
  // barely noticed it had shut. So crossing into a still now STOPS you, dead, where
  // you stand, for two and a half seconds.
  //
  // You keep the trigger, the target, the rockets, a repair drone, a Recall Beacon,
  // your heading and your shields. You cannot be anywhere else. It cannot be chained
  // — HOLD is 2.5s, CALM is 5s of guaranteed thrust after every one, and one patch may
  // hold one ship once per entry — and a still is refused sanctuary outright, so a
  // door you have already opened still cannot be taken from you. shared/ground.js
  // argues all of that and test/ground.mjs brute-forces it.
  //
  // 0.0225 a second, which is the designer's five times the old rate and is also
  // DRAIN_RATE from shared/siphon.js: a Lamprey's tether, half of on model, with its
  // own paragraph already written about why half is the honest share for something
  // you cannot dodge. A still is exactly half a Crucible's pool, and that ratio is
  // the design in one number — the ground that holds you is not the ground that kills
  // you, and a Doldrum standing on its own is 44 seconds of nuisance.
  //
  // r 720 is a Censer's ring at full spin, the widest field this game already had,
  // and it is WIDER than the plasma on purpose. Being caught at its rim costs you
  // two and a half seconds and nothing else; being caught in the middle costs you the
  // same two and a half
  // inside the plasma its mate just poured there. The trap has a near miss in it,
  // which is what makes it a fight rather than a coin.
  doldrum: {
    name: 'Doldrum', cls: 'Deadfall', r: 82, colour: '#6b3cff', shape: 'anvil',
    sow: { kind: 'slack',
           reach: 1100,
           r: 720,                 // a Censer's ring at full spin, and wider than a pool
           life: 15, max: 1,       // and x2.57 the 5.83s it takes the slowest hull to
                                   //   cross out of one. life / max IS the fireRate below,
                                   //   which is the Crucible's identity restated: the
                                   //   trigger and the sowing are one clock, so a
                                   //   definition cannot ask for more ground than it may
                                   //   hold and cannot ask for a gun that disagrees with
                                   //   its own ground either
           rate: 0.0225,           // DRAIN_RATE — half of on model, half of a pool
           hold: HOLD },           // stopped dead, once per entry. Two and a half seconds
    // 70/30, the Hive's split: more of it is field than plating, and the field is what
    // the stills come out of. Derived from DEEP_HP, like its mate's.
    //
    // The same 438 dps as a Crucible and a slower, heavier throw to deliver it. Same
    // rung, same gun, and what differs between them is the ground — which is the whole
    // point of posting them together, and is now visible in the air as well as on the
    // floor: a Crucible's glob comes every ten seconds and a Doldrum's every fifteen,
    // so the one that is about to stop you dead is the rarer and the bigger of the
    // two, and telling them apart is worth doing before either lands.
    attrs: { ...deepSplit(0.30), shieldRegen: 0.005, shieldDelay: 8,
             // 90 — the slowest thing in the game, under the Hive's 110. It does not
             // need to catch you. It needs you to come to it, and the ground is how it
             // arranges that.
             speed: 90, accel: 150, signature: 10,
             // 1/15 is `max / life` from the sow block above, and 6570 is 438 x 15, so
             // the product is 438 to the decimal exactly as the Crucible's is.
             damage: 6570, fireRate: 1 / 15, weaponRange: 900 },
    mate: 'crucible',
    aggro: 540,
    leash: 2600,
    patience: 5.0,
    flee: 0,
    respawn: 300,
    ...deepPay,       // the same rung, so the same pay, from the same line
    tell: 'Lobs a still where you are heading. Cross into one and you stop dead for two and a half seconds, guns and all.',
  },

  // --- THE ANTIPHON, and it lives in Nullpoint ------------------------------------
  //
  // An antiphon is a call and a response sung back at each other, one voice at a
  // time. That is the whole hostile and it is also the whole answer to it.
  //
  // WHAT IT IS FOR. Every fight in this game so far is answered by one of six verbs:
  // do not be seen (a Bandit), do not be hurt (a Kedge), shoot faster (Drumfire),
  // stop shooting (a Thresher), pick your line (a Doldrum), do not stand in it (a
  // Crucible, a Censer). This one asks for a seventh and nothing else in the game
  // asks it: DO NOT STAND STILL RELATIVE TO WHAT YOU ARE SHOOTING. Not "keep
  // moving" — backing off and closing in along the same line will not save you —
  // but keep changing your BEARING, because the bearing is what the ring stores and
  // the bearing is what it answers along.
  //
  // HOW. Eight armour plates around an exposed core. Damage into one bearing hardens
  // the plate on it; a hard plate turns some of what hits it, and the ring answers
  // its hottest plate once a cycle with a bolt back down the exact line that plate
  // was struck from. The plate goes dark as the bolt leaves. Stand still and the
  // answer arrives where you are; walk your fire around the ring and it goes past
  // you, into the dark, which is the best tell in the fight.
  //
  // AND WHY IT IS BUILT THIS WAY RATHER THAN AS MORE GROUND. shared/balance.js's
  // POSTING says out loud that the deeps are not completable at any party size, and
  // names the reason: ground does not divide. A pool burns everybody standing in it,
  // so time-to-die is FLAT in party size while time-to-clear only falls as 1/n, and
  // no amount of friends closes that. A ring is the exact inverse — one voice,
  // answering one bearing per cycle — so the answers are shared out and the plates
  // COOL while they wait their turn. Measured through the real loop, four pilots each
  // holding a bearing at the deep shelf — damage taken per second by each of them, and
  // how long each of them lasts under it:
  //
  //      1 pilot   3,372 a second   1.00      time-to-die   1.00
  //      2         1,686            0.50                    2.00
  //      3         1,124            0.33                    3.00
  //      4           560            0.17                    6.02
  //
  // Time-to-die RISES with party size, which is the property the deeps do not have
  // and the reason this exists. test/plates.mjs re-measures all four rather than
  // trusting this table.
  antiphon: {
    name: 'Antiphon', cls: 'Respondent', r: 90, colour: '#b8a06a', shape: 'slab',
    // 85/15, the Thresher's split and the Crucible's — a thing that is mostly armour
    // is mostly hull. Derived from CORE_HP so the rung is one edit, not five.
    //
    // AND IT HAS AN ORDINARY GUN, on model to the decimal: 711 x 1.0 is
    // ANCHORS.pressure x stageEhp('deep'), which is balance.js's own definition of a
    // hostile that can threaten the pilot it is posted for. That closes the damage
    // axis the way the deeps' guns did, and the ring is what sits above it. Without
    // one, a pilot who never pulled the trigger could not be touched — which is a
    // lovely sentence and a hostile the balance model would file as harmless.
    //
    // Reach 900 is the Leviathan's, the Thresher's and the deeps' — past every hull
    // in the shop, so out-ranging the barrel is not on the table. The RING reaches
    // 1,800, which is the other half of that decision: Collimated Cells double a
    // Bulwark's 820 to 1,640, so a pilot at the longest reach money can buy is still
    // inside the answer. A boss you can shoot from somewhere it cannot answer is a
    // boss with no mechanic.
    attrs: { ...coreSplit(0.15), shieldRegen: 0.005, shieldDelay: 8,
             // 80 — under a Doldrum's 90, so it takes the title of the slowest thing
             // in the game. It does not chase; it is a slab, and the fight is one you
             // choose to have. Leaving always works.
             speed: 80, accel: 130, signature: 10,
             damage: 711, fireRate: 1.0, weaponRange: 900 },
    // --- THE RING ------------------------------------------------------------------
    //
    // shared/plates.js holds the machinery and argues the shape. These are the five
    // numbers, and every one of them is derived from something already written down.
    plates: {
      // EIGHT, and the count is a measurement rather than the pitch's number taken on
      // trust. What it has to survive is a pilot walking their fire around the ring at
      // real speeds and real reaches, and there are two effects pulling opposite ways:
      //
      //   the dodge     the answer goes back to the PLACE you last hit it from, so
      //                 what you buy by turning is your own tangential speed times the
      //                 round trip — your bolt out and the answer back. Measured at the
      //                 630px the hostile chooses to stand at, that is 1.26s: a deep
      //                 shelf hull with its reactor on the gun is 94px off the line by
      //                 then against an 88px answer, and past it. In close it is not —
      //                 at 260px the round trip is 0.5s and the same pilot is 39px off,
      //                 so brawling is where this bites and a pilot pinned in cannot
      //                 turn their way out of it.
      //   the cooling   a plate you have left cools on its half-life. Measured, this
      //                 is the WEAK half and it is stated rather than claimed: a
      //                 Bulwark orbiting at 820px covers one eighth of the ring in
      //                 3.3s, which is three half-lives, so the plate it is standing
      //                 on reaches 90% of what standing still would give. Sixteen
      //                 plates would halve the dwell and still not fix it; you would
      //                 need about ninety to make the ring cool by walking it.
      //
      // So eight is not chosen for the cooling — nothing reachable is — it is chosen
      // for the DODGE and for the party, and both want a plate wide enough that one
      // pilot owns one bearing. Eight wedges of 45 degrees is two per pilot at the
      // party size this is posted for, and it is the widest the wire carries:
      // shared/net.js prices eight columns at 0.094 KiB/s and says why.
      //
      // AND THAT SECOND ROW IS WHY `crack` EXISTS, which is worth saying here rather
      // than only where the number is. The cooling being unreachable was written down
      // as a limitation and it shipped as one, and what it produced in the cockpit was
      // exactly what the arithmetic predicted: every wedge warm all the time, no soft
      // spot anywhere, and a mechanic that read as a flat damage tax. A ring that can
      // only harden has no second state, so there is nothing for a pilot to aim AT.
      // Breaking is the second state, and the count feeds it too — a plate is one
      // eighth of the ring's total armour, so eight of them is what "strip it" costs.
      n: 8,
      // ONE PERCENT OF ITSELF, dealt into one bearing inside the decay window, fills
      // that plate — 65,000 points. A SHARE and not an amount, which is MIRROR's own
      // second reason: the wire sends an integer per plate, so a charge measured in
      // points would need the client to be told a normalising constant, and a rule
      // kept in two places is the thing this codebase has learned always disagrees.
      //
      // The one percent is derived from the fight it has to make, the way MIRROR.soak
      // was: a pilot who stands still must be visibly punished inside a handful of
      // seconds, and a pilot who turns must not. The chain, all of it off numbers
      // already in this file:
      //
      //   a plate halves in one answering cycle          h  = 1/fireRate = 1.0s
      //   its resting level under fire D                 D h / (fill x ln2)
      //   what it holds when its turn comes round        half of that, at one pilot
      //   what that answers with                         charge x SHOP_DPS
      //
      // At the deep shelf's 20,526 dps and a fill of 65,000 that is a plate sitting
      // at 0.228 when its turn comes round, answering about 2,600 a second on top of
      // the 711 the barrel throws. Measured through the real loop rather than left as
      // arithmetic: 3,376 a second into a deep-shelf hull, dead in 4.6 seconds if you
      // never change bearing — the number this was set from, and the same order as the
      // Thresher's 3.7 one rung down. The same pilot circling at the same range takes
      // 684, which is the barrel and nothing else. test/plates.mjs prints both.
      soak: 0.01,
      // WHAT A FULL PLATE THROWS, per second of its own cadence — and it is MIRROR's
      // constant, not a copy of it. THE RING CAN NEVER THROW ANYTHING THE GAME DOES
      // NOT ALREADY SELL: at fireRate 1.0 a full plate carries 11,307, which is one
      // second of the sharpest gun the climb sells and 72% of the deep-shelf ship it
      // is posted against. Dangerous, and not a one-shot.
      //
      // The Thresher's history is the whole argument for having a ceiling at all —
      // uncapped and one-for-one it put 9,011 into a 7,050 ship — and the argument
      // for THIS ceiling rather than the deep shelf's 20,526 is on MIRROR: past the
      // point where the slope reaches 1.0, every build that does not saturate is
      // punished for firing and the punishment lands hardest on the smallest gun.
      dps: SHOP_DPS,
      // A PLATE MAY NEVER TURN MORE THAN IT LETS THROUGH. Past a half the armour is
      // doing more work than the core and the plate has stopped being armour and
      // started being immunity — a wall rather than a fight, and berth.js already
      // wrote what this codebase thinks of walls. plates.js clamps to it as well as
      // reading it, so a definition cannot quietly ask for one.
      //
      // It is deliberately the smaller half of the mechanic, and measured it is smaller
      // than it looks: a plate under a deep-shelf gun sits around 14%, so 94% of what
      // a pilot fires reaches the core either way and the half is a ceiling nobody
      // meets alone. What it buys is a TELL in the place a pilot is already looking —
      // your own floating damage numbers shrink on a plate you have been leaning on,
      // before the answer arrives — and a real cost on a party that all shoots one
      // bearing, which is the thing the ring exists to punish.
      deflect: 0.5,
      // WHAT IT TAKES TO BREAK ONE, in platefuls of damage TURNED. Two, and it is
      // MEASURED rather than chosen.
      //
      // Why there is a break at all is the designer's, after flying it: "his shield
      // should be breaking when we shoot it from one side long enough — right now all
      // of them are hard from every side." The note on `n` above conceded the
      // arithmetic in advance: a wedge cannot be walked cold at any speed a heavy hull
      // can fly, so under a real gun every plate sits warm, there is no soft spot
      // anywhere, and a ring that can only harden is a rate rather than a decision.
      //
      // WHAT THE NUMBER IS SET BY is not the size of it. It is that COMMITTING MUST BUY
      // TIME WITH HULL rather than getting both — a hostile with one correct answer is
      // an instruction, and it does not matter which answer. Run to the kill through
      // the real loop, one deep-shelf pilot, circling against committed:
      //
      //     crack   breaks at   clears in   costs      against circling
      //      1         47s        172s      240,385    47% off the clock for   6% more hull
      //      1.5       69s        184s      307,405    44%                    36%
      //      2         91s        196s      374,485    40%                    66%
      //      3        136s        220s      514,639    33%                   128%
      //      4        180s        248s      654,586    24%                   190%
      //
      // Circling is 328s and 226,098 at every one of them, because it never opens
      // anything at all.
      //
      // ONE is where this change started and it is unshippable: six percent more hull
      // for half the clock is not a decision, it is the ring's old failure pointing the
      // other way — one correct play, and the other one strictly worse. THREE is
      // unshippable from the far end, and for a harder reason: 514,639 is more than the
      // 494,781 a fully researched deep-shelf hull HAS, so committing stops being
      // available to a lone pilot at all and the ring is back to one answer. TWO is the
      // last step that leaves both doors open, and it is the one that reads as a trade
      // from the cockpit — a third off the fight for two thirds more of your ship.
      //
      // WHAT IT COSTS IN DAMAGE DEALT is not a number that can be written here, and
      // that is the mechanic rather than a gap: strain is the damage a plate TURNS and
      // a plate turns `deflect x charge`, so the bill depends entirely on how hard the
      // wedge is being held when you pay it.
      //
      //      at full hardness            130,000 / 0.5           =   260,000 points
      //      one deep-shelf pilot        130,000 / (0.5 x 0.14)  = 1,857,000
      //      four of them, one bearing   130,000 / (0.5 x 0.43)  =   605,000
      //
      // So a party opens the ring far faster than one pilot can, and nothing had to be
      // arranged for it: a plate waits longer for its turn to be answered when there
      // are more bearings, so it runs hotter, so it strains quicker. Measured, four
      // pilots break three wedges in the time one breaks its first.
      //
      // AND IT IS PERMANENT for the life of the fight. A wedge you paid for in answers
      // and then had to pay for again is a fight with no progress in it — the whole
      // point is that shooting one side LONG ENOUGH gets you something you keep. It
      // comes back with the rest of the ring on the five-minute respawn, because
      // respawnAlien rebuilds it from newRing().
      crack: 2,
      // How far the answer carries. 1,800, which is past the longest reach money can
      // buy: Collimated Cells double a Bulwark's 820 to 1,640. See the note on
      // weaponRange above — a boss you can shoot from outside its answer is a boss
      // with no mechanic, and the ring rather than the barrel is what closes that.
      reach: 1800,
      // --- AND THE CALL, which is what the barrel became ---------------------------
      //
      // The 711 dps under the answers used to be a plain aimed bolt, and an aimed bolt
      // is not dodged by anybody: 94% of one lands on a hull weaving as hard as it
      // can. It is a pressure front now — it leaves the hull, grows outward, and is
      // silent over exactly one wedge, and that wedge steps one place round the ring
      // on every beat. shared/plates.js holds the machinery; this is the one number.
      //
      // FOUR SECONDS, and it is the walk rather than the look. The lane is one wedge,
      // so staying in it means covering one wedge of arc between beats, and the budget
      // has to be set by the slowest ship that actually fights this thing at the range
      // it fights from:
      //
      //     2 x pi x standOff / n   =  2 x pi x 630 / 8  =  495px of arc
      //     at a finished Bulwark's 128px/s               =  3.87s
      //
      // So 4.0, which is that with a tick of room, and test/plates.mjs re-measures the
      // walk rather than trusting this line. Read the arithmetic the other way and it
      // says what the fight is: a wedge is a SHORTER walk the closer in you are — 204px
      // at 260px of range, 1.6 seconds — so the call is cheapest exactly where the
      // answers are deadliest, and dearest out at the range that dodges them. That
      // tension is the whole reason it is a ring with a lane and not a bigger bolt.
      //
      // What one front carries is `damage x fireRate x beat`, so `damage x fireRate`
      // is untouched and threatDps, the bounty, the experience and the bestiary report
      // are the numbers they already were. A pilot who never walks the lane takes 711
      // a second, which is exactly what the bolt cost; a pilot who walks it takes
      // none. Nothing else about this hostile moved.
      //
      // WHAT IT COSTS THE PARTY CURVE is stated rather than hidden, because it is the
      // one property this boss exists for. A front does not divide: it reaches every
      // pilot inside its reach at once. Measured through the real loop, the answers'
      // curve is 1.00 / 0.50 / 0.31 / 0.14 and the call flattens what a party of four
      // pays per head — the numbers are in test/plates.mjs, which prints both columns
      // and fails if time-to-die ever stops rising with party size.
      wave: { beat: 4.0 },
    },
    aggro: 540,       // the Hive's, inside SIGHT_R, so it is on screen before it decides
    leash: 2600,
    patience: 5.0,
    flee: 0,          // it does not run. It is the middle of the map
    respawn: 300,     // a boss's five minutes, the Hive's and the deeps'
    ...corePay,       // CORE_HP at BOUNTY_RATE and XP_RATE — nothing typed
    tell: 'Eight plates that answer down the line you shot from, over a ring that pulses. One wedge of the pulse is silent, and it steps.',
  },

  // Range furniture, not a hostile. It has no weapon, does not chase and does not
  // flee, and carries enough hull that a finished ship cannot delete it before you
  // have read a number off it. Never seeded outside the testing ground.
  bulkhead: {
    name: 'Bulkhead Target', cls: 'Hulk', r: 26, colour: '#7f8ea3', dev: true,
    attrs: { hull: 400000, shield: 40000, shieldRegen: 0, shieldDelay: 9e9,
             speed: 40, accel: 100, signature: 6,
             damage: 0, fireRate: 0.1, weaponRange: 0 },
    aggro: 0, leash: 0, patience: 1, flee: 0, respawn: 3, bounty: 0, xp: 0,
  },
};

// What a kill pays, as a fraction of what it took to kill. Deriving it means a
// tougher thing further out pays proportionally more without anyone remembering
// to tune it, and it keeps the one number that matters honest: the credits a
// fight returns against the ammunition it burns.
// What a kill is worth is derived from how much work it is, and hit points are
// only half of that. A Bandit has 30000 of them and pays the same rate as an
// Ironhusk per point — but measured with one ship against both, only 28% of what
// is fired at a Bandit ever lands against 75% on a husk, so it takes 39.9s to the
// husk's 2.3s. That was 526 credits a second against 1978: a quarter of the pay
// for the hardest fight in the sector, which is why nobody farmed it.
//
// `effort` is that multiplier, measured rather than guessed: what a thing's hit
// points are actually worth once dodging and camouflage are counted. 1 for
// anything that stands and trades. The rates below then apply to effective hit
// points x effort, so nothing needs a hand-set bounty and the next alien that
// hides gets paid correctly without anyone remembering to.
// XP_RATE and BOUNTY_RATE are declared ABOVE the bestiary rather than here, because
// the deeps derive their pay from their rung inside the table itself and a const
// cannot be read before it is initialised. The argument for both rates is the
// paragraph above; only the two lines moved.
export const farmHp = kind => effectiveHp(kind) * (ALIENS[kind].effort ?? 1);
export const effectiveHp = kind => ALIENS[kind].attrs.hull + ALIENS[kind].attrs.shield;

// What a hostile actually does to you per second, whatever shape it arrives in.
//
// `damage x fireRate` was the whole answer while every hostile had a barrel, and
// the balance model, the bestiary report and pressureOf all read it directly. Two
// hostiles now have no gun at all and reading it on them returns zero, which would
// have both reported as harmless — a Lamprey drinking 2.25% of your hull a second
// and a Censer burning 4.5% of everything you have.
//
// The two shares are taken against different pools, and that difference is the
// design rather than a detail: a field burns whatever is standing in it, shields
// included, and a tether goes straight past the shield to the hull. So the caller
// passes both, and anything with a barrel ignores them and reads as it always did.
export const threatDps = (kind, ehp, hull = ehp) => {
  const a = ALIENS[kind];
  if (!a) return 0;
  return (a.attrs.damage ?? 0) * (a.attrs.fireRate ?? 0)
       + (a.burn?.rate ?? 0) * ehp
       + (a.siphon?.rate ?? 0) * hull
       // And ground. A Crucible's barrel reads 0 x 0.1 and it is not a harmless
       // hostile: a pool of White Heat takes a share of whatever is standing in it
       // every second, for as long as it is standing there. It is counted ONCE
       // rather than `max` times because patches deliberately do not stack — a ship
       // where two pools overlap takes the worse of them and not the sum, which is
       // what stops six of a Crucible's own patches being a delete button and what
       // keeps this term honest. Same pool as a burn, and for the same reason:
       // ground eats a shield as readily as a hull.
       + (a.sow?.rate ?? 0) * ehp
       // A mirror's barrel reads 80 x 1.0 and it is not an 80 dps hostile: the
       // chamber is the gun. This is the worst it can ever be — a full chamber, so
       // 12,083 — and it is deliberately the worst rather than the typical, because
       // pressureOf(), report() and bestiaryReport() are asked "how bad can this
       // get", not "how bad is this usually". It had a Thresher at 80 dps, and
       // reading it that way is what let the hardest thing at the gates be filed as
       // harmless. Note what it therefore means: a Thresher is off model on the
       // damage axis BY DESIGN and by a wide margin, and it is the only hostile in
       // the game whose off-model number is a number the pilot chose.
       + (a.returns ?? 0) * MIRROR.dps
       // And a ring's answer is not its barrel either, for the same reason and by a
       // wider margin. An Antiphon's gun reads 711 x 1.0 and the thing that kills you
       // is the discharge: a full plate throws `plates.dps / fireRate` and it may go
       // once a cycle, so the worst the ring can ever be is `plates.dps` flat — 11,307,
       // sixteen times the barrel. Deliberately the worst rather than the typical,
       // exactly as the mirror's term is: report(), pressureOf() and bestiaryReport()
       // ask "how bad can this get". What a pilot who keeps turning actually takes is
       // a fifth of it, and that difference is the hostile.
       + (a.plates ? (a.plates.dps ?? 0) : 0)
       // And a mothership's gun is not its fight either. A Hive read as 110 dps
       // here while twelve Bandits sat around it throwing 2,340, which made the
       // top of the ladder the SAFEST thing in the bestiary report. One term, and
       // it is what MIRROR.dps is derived from, so the two can never disagree.
       + (a.broods ? a.broods.max * threatDps(a.broods.kind, ehp, hull) : 0);
};
// Effective hit points TIMES effort: what it costs to kill, not what it is made
// of. A thing you cannot hit is worth more than a thing you can, at the same
// toughness, and this is the one place that gets to decide it.
export const bountyFor = kind => Math.round(farmHp(kind) * BOUNTY_RATE);
export const xpFor     = kind => Math.round(farmHp(kind) * XP_RATE);

// Every hostile used to be the same arrowhead at a different size and colour, so
// an Ironhusk read as a big Drifter rather than as a different thing. The outline
// is per-alien now, declared here because the world view and the minimap both
// draw it and a shape that disagreed between the two would be worse than none.
export const SHAPES = {
  // The arrowhead everything used to be. Still the Drifter's: it is the baseline
  // and should stay the thing the others are read against.
  kite: R => [[R * 1.35, 0], [0, R], [-R * 0.8, 0], [0, -R]],
  // NO FRONT AT ALL, which is the one thing this outline has to get right.
  // Everything else in the bestiary is pointed at something; an Antiphon's plates are
  // a COMPASS rather than a nose — fixed in world bearings, because a ring bolted to
  // the hull would turn with it and the plate in front of you would be the same plate
  // however you flew. So the body underneath has to have no orientation either, or it
  // would visibly slide under its own ring every time it turned to face somebody.
  // Twenty-four points of very nearly a disc: a slab seen from above, and the eight
  // wedges the client draws around it are the part with a direction.
  slab: R => Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * Math.PI * 2;
    return [Math.cos(a) * R, Math.sin(a) * R];
  }),
  // Six flats. Armour plate rather than a nose — it is not pointed at anything,
  // because it does not need to be.
  hex: R => Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return [Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08];
  }),
  // Long, narrow and nose-heavy. A Bandit is mostly pointed at you, and the
  // silhouette should be the reason that is hard to see.
  dart: R => [[R * 1.75, 0], [-R * 0.15, R * 0.55], [-R * 0.95, 0], [-R * 0.15, -R * 0.55]],
  // Sixteen alternating points. It does not fly so much as loom, and nothing else
  // in the game has spikes.
  crown: R => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2, rr = R * (i % 2 ? 0.62 : 1.2);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }),
  // Swept hard back from a fine nose, with nothing in the middle. It should read as
  // speed at a glance, because speed is the only thing about it that matters.
  blade: R => [
    [1.55, 0], [0.10, 0.30], [-0.85, 0.95], [-0.55, 0.16],
    [-1.00, 0], [-0.55, -0.16], [-0.85, -0.95], [0.10, -0.30],
  ].map(([x, y]) => [x * R, y * R]),
  // Pointed the wrong way round. Everything else in the bestiary has a nose; this
  // has a plate, and the broad flat face is what it aims at you. You are looking at
  // a mirror, which is the only warning you get.
  facet: R => [
    [0.95, 1.15], [1.10, 0.38], [1.10, -0.38], [0.95, -1.15],
    [-0.45, -0.85], [-1.30, 0], [-0.45, 0.85],
  ].map(([x, y]) => [x * R, y * R]),
  // A ring with the front bitten out of it. Everything else in the bestiary either
  // has a nose or is radial; this has a mouth, and the gap in it is the side the
  // tether leaves from. Two arcs joined at the jaw tips, so it is one closed
  // outline like every other shape here.
  maw: R => {
    const N = 12, span = Math.PI * 1.42, out = [], inn = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - span / 2 + (i / N) * span;   // centred on the tail: the gap faces +x
      out.push([Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15]);
      inn.push([Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55]);
    }
    return [...out, ...inn.reverse()];
  },
  // Three lobes at 120 degrees, and it is the only three-fold thing in the
  // bestiary. Everything else has a nose, a plate or a spike; this has none,
  // because it does not have to face you to hurt you — and three-fold is what a
  // thing that spins looks like when you freeze it.
  rotor: R => Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2, rr = R * (0.86 + 0.48 * Math.cos(3 * a));
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }),
  // A kedge anchor: a shank with a stock across it and two flukes at the crown. It
  // is the only thing in the bestiary with a crossbar, and the only one that is
  // plainly a tool rather than an animal or a hull — which is the read, because what
  // it does to you is a piece of navigation equipment being used on you. Built from
  // one half and mirrored, so it is exactly symmetrical and stays one closed outline
  // like every other shape here.
  fluke: R => {
    const half = [[1.45, 0], [1.05, 0.18], [0.72, 0.20], [0.68, 0.78], [0.48, 0.80],
                  [0.52, 0.20], [-0.35, 0.24], [-0.55, 0.72], [-1.00, 1.05],
                  [-0.92, 0.62], [-1.25, 0.30], [-1.30, 0]];
    return [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y])]
      .map(([x, y]) => [x * R, y * R]);
  },
  // A knobbly disc: twelve shallow lobes, no nose and no spikes. It reads as a
  // structure rather than a ship, which is what it is.
  hive: R => Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2, rr = R * (i % 2 ? 0.86 : 1.05);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }),
  // A crucible: a heavy bulb with a narrow pour-neck off one side and three drips
  // hanging off the trailing edge. It is the only thing in the bestiary with a NECK,
  // which is the read — everything else is a hull, a plate, a spike or a tool, and
  // this is a container being emptied onto something. Built from one half and
  // mirrored about the neck's axis so it stays one closed outline like the rest.
  crucible: R => {
    const half = [[1.05, 0], [0.98, 0.30], [0.62, 0.34], [0.55, 0.62],
                  [-0.10, 0.86], [-0.62, 1.08], [-0.52, 0.72], [-0.88, 0.80],
                  [-0.80, 0.46], [-1.18, 0.44], [-1.05, 0.16], [-1.30, 0]];
    return [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y])]
      .map(([x, y]) => [x * R, y * R]);
  },
  // An anvil: a broad flat face, a heavy waisted body and a horn out to one side.
  // Nothing else here is asymmetric about the long axis and nothing else reads as
  // MASS — a crown looms, a hive is a structure, and this is a thing that is
  // simply not going to move. Which is the ability, drawn.
  anvil: R => [
    [1.30, -0.18], [1.02, -0.30], [0.42, -0.42], [-0.52, -0.46],
    [-1.18, -0.66], [-1.30, -0.26], [-0.96, -0.10], [-1.02, 0.28],
    [-1.24, 0.52], [-0.58, 0.62], [0.30, 0.52], [0.86, 0.30], [1.02, 0.02],
  ].map(([x, y]) => [x * R, y * R]),
};
export const outlineOf = (kind, R) => (SHAPES[ALIENS[kind]?.shape] ?? SHAPES.kite)(R);

export const ALIENS_PER_MAP = 7;
// What the galaxy proper is allowed to spawn. Range furniture is not in it.
export const WILD = Object.keys(ALIENS).filter(k => !ALIENS[k].dev);
const LOSE_INTEREST = 'patience';

// --- evasion ------------------------------------------------------------------
// Something that cannot be seen and cannot be missed is not a fight, it is a
// health bar behind a curtain. A Bandit breaks off the firing line when a shot
// is close, which does two things: most of the volley goes past it, and it has
// to turn to do it — and turning is what takes its nose off you, which is the
// only reason you get to see it at all.
//
// So the camouflage and the evasion are the same mechanic seen from two sides.
// It is quiet while it holds still and points at you; the moment it starts
// working to stay alive, it starts showing you its flank.

export const EVADE_LEAD = 0.9;    // s of flight time it reacts inside
// Fleeing. FLEE_RUN is how far it commits to in one decision; FLEE_EDGE is how
// close to the rim of charted space it is willing to be put, so a runner does not
// park itself on the shear. FLEE_TURNS is tried in order and is what stops a
// hostile pressing into a wall — straight away first, then wider, alternating
// sides so it slides along whichever edge it happens to be on.
export const FLEE_RUN   = 2200;
export const FLEE_EDGE  = 500;
export const FLEE_TURNS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.6, -2.6];

export const EVADE_RUN  = 160;    // px it commits to — a jink, not a departure
export const WEAVE_MIN  = 0.5, WEAVE_MAX = 1.0;     // s between reversals

// Which way to break, given what is coming: perpendicular to the nearest
// threat's travel, on whichever side it is currently weaving.
//
// The side has to keep changing. Bolts are aimed where you will be, so a steady
// break is precisely what the aim already accounts for — holding one direction
// gets you hit as reliably as holding still. Reversing every third of a second
// puts it somewhere the last shot did not expect, which is the same reason
// weaving works for a player.
export function threatBreak(a, incoming) {
  let near = null, nearD = Infinity;
  for (const p of incoming) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < nearD) { nearD = d; near = p; }
  }
  if (!near) return null;
  const sp = Math.hypot(near.vx, near.vy) || 1;
  if (nearD > sp * EVADE_LEAD) return null;         // still far enough to ignore
  const ux = near.vx / sp, uy = near.vy / sp;       // where the shot is going
  const side = a.weaveSide ?? 1;
  return { x: -uy * side, y: ux * side };
}

// Sets a course away from whatever is closest to hitting it. Returns true while
// it is breaking, which is the caller's signal to stop pointing its nose at you.
// How far round it turns while breaking. Not all the way: it crabs, holding its
// nose part-way toward you while it translates sideways. Facing its own velocity
// showed you its full flank every time it jinked and the camouflage stopped
// meaning anything the moment a fight started — which is when it should matter
// most. Canted, it stays half-hidden while it works.
export const JINK_CANT = 0.5;

// The heading to fly while breaking, given where the thing it is fighting is.
export function jinkHeading(a, at) {
  const travel = Math.atan2(a.vy, a.vx);
  if (!at) return travel;
  const face = Math.atan2(at.y - a.y, at.x - a.x);
  let d = travel - face;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return face + d * JINK_CANT;
}

export function stepEvade(a, incoming, map, dt = 1 / 30) {
  if (!a.def.evades) return false;
  // The weave runs whether or not anything is inbound, so a break already has a
  // direction the moment it is needed.
  a.weaveSide ??= 1;
  a.weaveIn = (a.weaveIn ?? 0) - dt;
  if (a.weaveIn <= 0) {
    a.weaveSide = -a.weaveSide;
    a.weaveIn = WEAVE_MIN + (a.rand ? a.rand() : Math.random()) * (WEAVE_MAX - WEAVE_MIN);
  }
  const brk = threatBreak(a, incoming);
  if (!brk) { a.jinking = false; return false; }
  a.dx = a.dy = null;
  a.tx = Math.max(600, Math.min(MAP_W - 600, a.x + brk.x * EVADE_RUN));
  a.ty = Math.max(600, Math.min(MAP_H - 600, a.y + brk.y * EVADE_RUN));
  a.jinking = true;
  return true;
}

// Seeded so a server restart replays identically and tests can assert on roaming.
export const rng = seed => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

export function alienStats(kind) {
  const out = {};
  for (const [k, a] of Object.entries(ATTRS)) out[k] = ALIENS[kind].attrs[k] ?? a.dflt;
  return out;
}

// Somewhere to drift to: inside charted space, and never through a base ring.
// How far a respawn keeps away from anybody already out there. A hostile that
// materialises inside your radar — or worse, inside its own aggro radius of you —
// reads as the game cheating rather than as a sector repopulating. Set from the
// starter hull's radar, so nothing ever appears out of nothing on your screen.
export const SPAWN_CLEAR = 2400;

// Escorts launch from a hull rather than from nowhere, so they arrive as
// something the mothership did rather than as something that appeared.
export const BROOD_R = 300;

// A company's docking ring is restricted space, and a husk drifting straight
// through it looked like nothing was minding the door. Anything not currently
// engaged is turned back out at the edge. Anything that IS engaged is not: a
// provoked alien has always been allowed to follow you into the ring and keep
// firing, and that rule is older and better than this one.
export const BASE_KEEPOUT = 320;
export function shoveFromBase(a, map) {
  const b = map.base;
  if (!b) return false;
  const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
  const keep = b.r + BASE_KEEPOUT;
  if (d >= keep) return false;
  a.tx = b.x + (dx / d) * (keep + 240);           // out, the short way
  a.ty = b.y + (dy / d) * (keep + 240);
  a.dx = a.dy = null;
  return true;
}

// Counts down only while the thing is actually engaged: a hive nobody has found
// should not be quietly filling its sector with raiders.
export function broodReady(a, dt) {
  const b = a.def.broods;
  if (!b) return false;
  a.hatch = (a.hatch ?? b.first ?? b.every) - dt;
  if (a.hatch > 0) return false;
  a.hatch = b.every;
  return true;
}

// `away` is the ships to keep clear of. Tried first with the clearance and then,
// if the sector is too crowded to honour it, without — a hostile that refuses to
// come back at all would be worse than one that comes back nearer than ideal.
// A pair does not hold station forever. `pair()` gives both halves a POST, and the
// idle branch of stepAlienAI says what a post means: walk back to it and hold
// there. That is right for a firing line and wrong for two things that are meant
// to be prowling a sector together — welded 260px apart on one spot for the life
// of the server, which is what the designer saw and called stupid.
//
// The fix is to move the post rather than to take it away. Everything a pair needs
// already falls out of that: they travel at their own speeds, keep their spacing
// because each is walking to its own post, reform after a fight because a post is
// still where you go when nothing is happening, and respawn where they belong.
//
// This is only the CLOCK and the arrival test, because picking the point needs the
// sector's other posts and those live on the server. Both halves must be home
// before either moves — otherwise the one that arrives first drags the anchor away
// from the one still walking, and they never travel as a pair at all.
export const PAIR_DRIFT = 14;     // seconds of holding station before somewhere new
export const PAIR_HOME  = 140;    // how near its own post counts as arrived

export function driftReady(a, mate, dt) {
  if (!a || !mate || a.target !== null || mate.target !== null) return false;
  const home = who => who.post && Math.hypot(who.post.x - who.x, who.post.y - who.y) < PAIR_HOME;
  if (!home(a) || !home(mate)) { a.driftIn = PAIR_DRIFT; return false; }
  a.driftIn = (a.driftIn ?? PAIR_DRIFT) - dt;
  if (a.driftIn > 0) return false;
  a.driftIn = PAIR_DRIFT;
  return true;
}

export function roamPoint(map, rand, away = []) {
  for (const clear of [SPAWN_CLEAR, 0]) {
    for (let i = 0; i < 40; i++) {
      const x = 700 + rand() * (MAP_W - 1400), y = 700 + rand() * (MAP_H - 1400);
      if (map.base && Math.hypot(map.base.x - x, map.base.y - y) < map.base.r + 800) continue;
      if (clear && away.some(s => Math.hypot(s.x - x, s.y - y) < clear)) continue;
      return { x, y };
    }
  }
  return { x: 1200, y: 1200 };
}

// A post pins an alien to a slot: it spawns there, returns there when idle, and
// respawns there. That is what turns a scatter of hostiles into a firing line.
export function newAlien(kind, id, map, seed, post = null) {
  const def = ALIENS[kind];
  const rand = rng(seed);
  const at = post ?? roamPoint(map, rand);
  const a = newBody(at.x, at.y, alienStats(kind), def.r);
  return Object.assign(a, {
    id, kind, def, rand, isAlien: true, post,
    target: null, provoked: new Set(), lost: 0, dead: 0, way: post ?? roamPoint(map, rand),
    // An answering ring, if this one has plates. Seeded here rather than lazily on the
    // first hit so that every reader — the packer, the client, the AI — sees an array
    // of the right length from the first tick, and a boss that has never been shot
    // still has a ring to draw.
    ...(platesOf(def) ? newRing(def) : {}),
    dealt: new Map(),                 // playerId -> damage, since it last spawned
    crowd: null, crowdT: 0,           // who has been closing on it, and for how long
    threat: null, threatT: 0,         // and who has been out-damaging its target
  });
}

// Dying settles every grudge. Without this an alien that killed you is still
// provoked when you come back, and provocation overrides sanctuary — so it would
// follow you into your own base ring the moment you respawned.
export function forgetPlayer(list, id) {
  for (const a of list) {
    a.provoked.delete(id);
    if (a.target === id) { a.target = null; a.lost = 0; }
  }
}

// A hostile that got away and has been left alone long enough patches itself up.
// Without this a wreck that escaped once wanders at a tenth of its hull forever,
// free salvage for whoever finds it next.
export const REPAIR_RATE = 0.04;    // of max hull per second
export const REPAIR_QUIET = 8;      // s of not being shot at before it starts

export function stepAlienRepair(a, dt) {
  if (a.target !== null || a.sinceHit < REPAIR_QUIET || a.hp >= a.stats.hull) return;
  a.hp = Math.min(a.stats.hull, a.hp + a.stats.hull * REPAIR_RATE * dt);
}

// --- a mirror's chamber ---------------------------------------------------------
//
// What it is holding, 0..1, and the whole of what makes it dangerous.
//
// It used to be an absolute pile: everything you dealt it inside three seconds
// came back out of the next bolt one for one, and firing emptied it. That reads
// beautifully and is unplayable. Your damage spans 256x across the shop and your
// hit points span 6.4x, so "as dangerous as your own gun" is a one-shot the
// moment your gun outgrows your hull. Measured against the real AI, real bolts
// and real movement, before this:
//
//   finished Bulwark, no research   biggest bolt 9,011 into a 7,050 ship — 128%
//   stand / kite / weave / break    died in 2.7s / 2.8s / 3.8s / 2.7s
//   every stage and every tier under x32 finished: DIED, in all four
//
// Buying a bigger gun bought a proportionally harder fight, which is the
// anti-pay-to-win invariant running backwards, and nothing on the screen said any
// of it was happening. Three things change, and only one of them is a dial.
//
// 1. THE CHAMBER IS A CHARGE, NOT A MAGAZINE. Firing no longer empties it and
//    nothing zeroes it on a timer; it bleeds continuously instead. That is what
//    makes it playable AND what makes it legible, and they are the same change:
//    the meter over its head rises while you are hurting it and falls the moment
//    you stop, so the answer is visible from the cockpit rather than written down
//    in a threat file. LOAD_HOLD was a flat three-second timer that dropped the
//    whole load at once — nothing to watch, and nothing to play around.
//
// 2. THE CHAMBER IS DIMENSIONLESS. `load` is the share of the mirror's OWN hit
//    points you have taken off it lately, so it is 0..1 by construction. That is
//    not tidiness: `abl` is the free per-alien dial on the wire and it is a 0..100
//    integer, so a chamber measured in points would need the client to know a
//    normalising constant — a rule kept in two places, which is the one thing this
//    codebase has learned always disagrees. There is nothing to normalise against
//    because the number already is a share.
//
// 3. THE PAYLOAD HAS A CEILING, AND THE CEILING IS THE SHOP. See MIRROR.dps.
//
// What comes out of all three is one identity, and it is stronger than the one it
// replaces. Under sustained fire the chamber settles at (your dps / SOAK x its hp)
// / lambda, the fight lasts (its hp / your dps), and the product drops both: a
// pilot who stands still and never stops shooting takes
//
//      MIRROR.dps x its hp / (MIRROR.soak x its hp x ln2 / MIRROR.half)
//        =  MIRROR.dps / (0.09 x ln2)  =  181,244 points
//
// whatever they fly and however long it takes them. Measured with the same
// harness, an indestructible reader that never stops shooting: 173,260 points
// returned with the anchor's 75 dps against 156,279 with a finished Bulwark's
// 11,307 — 1.11x across a 151x span of player gun. A bigger gun does not cost you
// more; it makes the fight shorter and louder, and the bolts arrive bigger.

// What the top of the BESTIARY throws: the Hive's own gun plus a full brood of
// twelve Bandits. Read off the definitions rather than written down, so a Bandit
// rebalance carries into this without anyone remembering.
//
// MIRROR.dps used to be this over sqrt(10). It is not any more — a mirror is
// measured against the shop rather than against the bestiary, for the reason set
// out there — but this stays, because it is still the sentence "the Hive is the
// hardest gun in the game" written as code, and test/aliens.mjs compares the two.
export const hiveDps = () => {
  const H = ALIENS.hive, B = ALIENS[H.broods?.kind];
  return (H.attrs.damage ?? 0) * (H.attrs.fireRate ?? 0)
       + (H.broods?.max ?? 0) * (B?.attrs.damage ?? 0) * (B?.attrs.fireRate ?? 0);
};

// The sharpest gun the shop sells ON THIS SIDE OF THE GATE, in points per second —
// the ordinary ladder bought out, with nothing researched.
//
// It is `stageDps('finished')` from balance.js, and it is written down here rather
// than imported because balance.js imports THIS file (ANCHOR_FIGHT reads
// effectiveHp at module scope), so importing it back is a cycle that would blow up
// in the TDZ on whichever of the two happened to load first. test/aliens.mjs
// imports both and pins them equal to the penny, which is the same arrangement
// every hand-written bounty in this file already lives under.
//
// Measured, not chosen — a Bulwark with four MK-V Emitters, three E-Cells,
// Plating, Foundry and its ten MK-V drones:
//
//      stageDps('finished')  =  11,306.59
//
// It was 12,002.76 when it was first measured, on the hull table before slots
// replaced base attributes — a Bulwark then carried four hardpoints and 95 base
// damage, and now carries four and 76. So this number MOVES when the shop moves,
// which is the point of anchoring to the shop rather than to a constant, and
// test/aliens.mjs pins the two equal to the penny so a hull change fails here
// loudly rather than leaving the mirror quoting a gun nobody can buy any more.
//
// --- AND WHY IT IS `finished` RATHER THAN THE TOP OF THE SHOP -------------------
//
// The shop grew a sixth emitter, a fourth launcher and a sixth generator, sold only
// at a deep-sector outpost. Bought out, that build throws stageDps('deep') =
// 20,526.28, so "the sharpest gun the shop sells" is no longer this number and the
// first line of this comment says so on purpose.
//
// Anchoring the chamber to the deep shelf was tried first, and measured, and it is
// unshippable. The payload a pilot gets back is this constant times how full they
// filled the chamber, and how full they fill it is their own dps over
// soakOf x ln2 — so the SLOPE of what comes back against what you deal is
//
//      SHOP_DPS / (soakOf(thresher) x ln2)     0.88 at 11,306
//                                              1.60 at 20,526
//
// and 1.0 is where a mirror stops returning less than it was given and starts
// returning more. Past it every build that does not saturate the chamber is
// punished for firing, and the punishment lands hardest on the smallest gun,
// which is the exact opposite of the mechanic. Measured through the real fight
// loop: a weaving Kestrel with nothing researched used to finish one in 693s
// with 40% of its ship left, and at 20,526 it DIES at 113s.
//
// A Thresher stands on the gate sectors. The deep shelf is sold four hops past it,
// at a bay costing ten million, to pilots who have already come through. Scaling
// the gate with the reward for passing it is the thing berth.js already refused in
// as many words — "a gate you can only pass by already being through it is a wall,
// and this codebase has shipped one of those" — so the mirror is pinned to the
// climb rather than to the ceiling, and a deep pilot simply out-throws it. They
// earned that four hops ago.
//
// If the mirror is ever wanted at the deep ceiling, the thing to move is MIRROR.soak
// with it: the slope above is the whole constraint, and holding it under 1.0 at
// 20,526 asks for a soak of 0.145 rather than 0.09.
//
// A brute-force sweep of every legal fit finds one number above it: 16,967 on a
// Bulwark carrying Siege Cadence AND Rapid Cadence, whose drawbacks cancel into a
// free x1.50 (each is a trade of damage against rate, and `pct` entries SUM, so
// +0.60/-0.375 and -0.375/+0.60 land as x1.225 on both). That is a defect in that
// pair of technologies — every technology is supposed to give something up, and
// those two give each other's back — not a statement about what the shop is for,
// and anchoring the bestiary to it would bake it in. Named here so the next person
// measuring this does not think the sweep and the anchor disagree by accident.
// SHOP_DPS is declared above the bestiary — see the note there, and the reason is
// XP_RATE's: the Antiphon's ring takes its ceiling from this number INSIDE the table,
// and a const cannot be read before it is initialised. Only the line moved; every
// word of the argument for it is above.

export const MIRROR = Object.freeze({
  // How much of itself, dealt inside the decay window, fills the chamber.
  //
  // It was a tenth, justified as "one rung of the bestiary's own ladder of tens".
  // That was a tidy number rather than a reason, and it is retired: this one is
  // MEASURED, and what it is measured against is a position on the research ladder
  // rather than a fraction.
  //
  // The constraint is not the size of the bolt. It is that WEAVING STILL WINS AT
  // x8 — the tier the answer to this fight has always been available at, and the
  // one thing in the whole table that is stable across seeds. Everything else
  // follows from it. Measured over three alien seeds, a finished Bulwark weaving at
  // x8 hull and shields finishes with:
  //
  //      soak 0.10   17% of the ship left, and the bolt reads  8,743
  //      soak 0.09    8%                                       9,706
  //      soak 0.085   3%                                      10,272
  //      soak 0.08   dead, at every seed                      10,827
  //
  // So 0.09 is the last step down that leaves a margin rather than a coin flip,
  // and the bolt a pilot actually sees lands within 3% of the 10,000 that was
  // asked for. Below it the number on the screen gets bigger and the fight stops
  // having an answer short of the last rung of the ladder.
  //
  // Nothing here is free, and it is the same knob twice: the chamber's resting
  // level and the total a whole fight costs are both MIRROR.dps / (soak x ln2), so
  // a bigger bolt IS a dearer fight, by exactly the same factor. 0.10 -> 0.09 buys
  // 11% more bolt for 11% more damage over the fight, 163,120 -> 181,244. There is
  // no setting that makes the bolt bigger and the fight cheaper, and `half` is not
  // a way round it either — it enters both expressions identically.
  soak: 0.09,

  // And it halves in one of its own firing cycles, 1 / fireRate. Not picked: the
  // clock of this fight is its trigger, so the natural unit of "break off for a
  // moment" is one shot it did not get to reload from. Stop shooting for one
  // second and the next bolt is half as hard — which is the answer the fight was
  // missing, it is available to every hull at every stage, and it costs nothing
  // but the fight taking longer. Proportional rather than a flat bleed, because
  // the pool this drains is the player's own gun: a flat amount would be the
  // whole chamber at the bottom of the shop and a rounding error at the top.
  half: 1.0,

  // WHAT A FULL CHAMBER THROWS, per second.
  //
  // A FULL CHAMBER RETURNS THE SHARPEST GUN THE SHOP SELLS. That is the derivation,
  // and it replaces "half a rung under the Hive by the same sqrt(10) as its hull".
  // The sqrt(10) relation on the HP axis stays exactly as it was — 205,550 against
  // the Hive's 650,000 — because that one is a statement about how much ship this
  // is. This is a statement about the gun, and the gun is not the bestiary's.
  //
  // The reason is the identity it buys: THE MIRROR CAN NEVER THROW ANYTHING THE
  // GAME DOES NOT ALREADY SELL. It is a ceiling rather than an escalation. There is
  // no fit, party, ammunition grade or research rung that puts a bolt on the screen
  // bigger than the biggest thing money can buy, and there never will be, because
  // the ceiling IS the shop and it moves when the shop does.
  //
  // At 775 the ceiling was set so low that nobody ever met it. The chamber is a
  // share of your own gun, so taking the cap from the bestiary — a rung under a
  // Hive's gun, matching the rung under a Hive's hull — made the hardest bolt at the
  // top of the shop 855, which is 9% of a finished Bulwark. This is the thing at
  // the gates. It should not be 9% of anybody.
  //
  //      full chamber   80 + 11,306.59           =  11,387 a bolt
  //      what a finished pilot actually holds it at, 0.882:
  //                     80 + 0.882 x 11,306.59   =  10,053 a bolt
  //
  // What lands is a little under that, and the reason is worth writing down because
  // it was got wrong once already. It is NOT that a Thresher dodges: measured over
  // a whole fight, 97% of a finished pilot's fire reaches it. It is the REACTOR.
  // stageDps quotes the boosted gun, and a pilot has to hold the routing on
  // weapons to deliver it — 10,175 of the 11,307 on paper, the rest lost to the
  // capacitor browning out. That is the whole gap, and a bench pilot who never
  // routed power read the chamber at 49% where a real one reads 91%.
  //
  // Measured against the real AI, real bolts and real movement, with the reactor on
  // weapons, finished Bulwark: the biggest bolt that ACTUALLY lands is 9,706, and
  // 9,850 for anyone who survives long enough to see the chamber top out. Standing
  // still, no research, it dies in 3.7s; kiting 3.4s; weaving 5.8s; holding fire two
  // seconds in three 3.7s. Weaving is the one that scales: it wins from x8 (8% of
  // the ship left), x16 leaves 54% and x32 leaves 77%. Standing still scrapes x16
  // — 19 hit points of 148,880, and it dies outright at another seed — so call it
  // x32, and breaking off is x32 too.
  //
  // Verified over a real socket against a real server, same build, same room. The
  // same pilot standing in the same place, reactor idle then routed to weapons:
  // 5,126 a bolt at a 56% chamber, then 7,494 at 85%. Weaving at x8 killed it in
  // 18.0s, never went below 45% of the ship, and the biggest number the wire
  // carried was 10,472 off a chamber that peaked at 96%. The dial fell 46% -> 38%
  // -> 19% -> 10% over the three seconds after the trigger came off.
  //
  // And the fight it makes is the one the mechanic promised, which is the test that
  // matters more than any of those: a KESTREL with no research at all, weaving,
  // kills one in 569.8s and never drops below 70% of its ship, because 429 dps
  // holds the chamber at 4% and the bolt it gets back is 476. The same pilot in the
  // best ship money can buy is deleted in 3.7 seconds by a 9,706. The danger is
  // your own gun, and that spread IS the mechanic.
  dps: SHOP_DPS,
});

// The share of its own hit points that fills the chamber, in points.
export const soakOf = def => MIRROR.soak * ((def?.attrs?.hull ?? 0) + (def?.attrs?.shield ?? 0));

// What the next bolt carries, in points, at a given charge. Exported because the
// client draws this number over its head and the server puts it in the bolt, and a
// tell that disagreed with the hit would be worse than no tell — see the workshop
// dock, which refused to sell anything for a day over exactly this.
export const payloadOf = (def, load = 0) =>
  (def?.attrs?.damage ?? 0)
  + Math.max(0, Math.min(1, load || 0)) * (def?.returns ?? 0) * MIRROR.dps / (def?.attrs?.fireRate || 1);

// What a hostile does with a hit it has just taken, which is one call because the
// caller has exactly one fact: this much landed, from over there. WHICH of the two
// chambers in the game it goes into is the definition's business and not the tick's
// — a chamber that fills over time, or a ring that fills per bearing.
//
// It is routed off the DEFINITION rather than off which live field happens to exist,
// and that is the same lesson dialOf() was rewritten for: reading live fields in a
// fixed order silently keeps the first one a hostile happens to have, so the second
// mechanic never runs and nothing throws. Here it would be worse than a missing
// dial — the ring simply would not charge, and the hostile would be a slab with a
// gun on it.
//
// `from` is a world bearing FROM the hostile TOWARD whatever hit it. A mirror does
// not care and ignores it; a ring is nothing but that number.
export function storeHit(a, amount, from) {
  if (!(amount > 0)) return;
  if (platesOf(a?.def)) return storeBearing(a, amount, from);
  if (!a?.def?.returns) return;
  const soak = soakOf(a.def);
  if (!(soak > 0)) return;
  a.load = Math.min(1, (a.load ?? 0) + amount / soak);
}

// Called before it fires. Bleeds the chamber, writes the payload onto the live
// damage stat, and returns the charge 0..1 — which is what goes on the wire.
//
// The payload IS the alien's damage stat, which is why none of combat.js, net.js
// or the client's bolt code needs to know this exists: boltWidth() already fattens
// a bolt from its damage and the floating damage number already says how hard it
// landed, so the tell is free three times over on top of the meter.
export function stepMirror(a, dt) {
  if (!a?.def?.returns) return 0;
  a.load = (a.load ?? 0) * Math.pow(2, -dt / MIRROR.half);
  // Otherwise it asymptotes and the meter never reads empty — a bar stuck at one
  // pixel says "still loaded" to a pilot who has done everything right.
  if (!(a.load > 1e-4)) a.load = 0;
  // The base damage is read off the definition rather than off the live stats,
  // because the live stats are what this function is writing to. Reading them back
  // would compound the payload every tick into an unbounded number.
  a.stats.damage = payloadOf(a.def, a.load);
  return a.load;
}

export function respawnAlien(a, map, away = []) {
  // A posted alien belongs to its slot on the firing range and goes back to it
  // whoever is standing there; everything in the wild comes back out of the way.
  const at = a.post ?? roamPoint(map, a.rand, away);
  a.x = at.x; a.y = at.y; a.vx = a.vy = 0;
  a.hp = a.stats.hull; a.shield = a.stats.shield;
  // A fresh ring, cold. It would bleed to nothing in a second anyway, but a boss that
  // came back five minutes later still holding the bearing that killed its last
  // attacker would answer whoever was standing there on the tick it arrived — an
  // answer to a call nobody made.
  if (platesOf(a.def)) Object.assign(a, newRing(a.def));
  a.sinceHit = 1e9; a.shieldHit = 0; a.cool = 0; a.shotFlash = 0;
  a.target = null; a.provoked.clear(); a.lost = 0; a.dead = 0;
  a.crowd = null; a.crowdT = 0; a.threat = null; a.threatT = 0;   // no grudges carried over
  a.sow = 0; a.sowAt = null; a.sowFrom = null; a.sowFly = 0;      // nor a glob in the air. Ground it
                                                                  // has already laid stays laid,
                                                                  // which is the whole mechanic; the
                                                                  // THROW does not survive the thrower
  a.crest = 0; a.gap = 0;                                         // and a ring comes back with its
                                                                  // wave silent and its gap at due
                                                                  // east, so a boss that respawned
                                                                  // mid-lap does not pulse on arrival
  a.load = 0;                                                     // nor a chamber: a mirror that
                                                                  // respawned loaded would open the
                                                                  // next fight with your last one
  // Nor a pod. It is cleared field by field here rather than through a clearPod() in
  // shared/brood.js, and that is not an oversight: brood.js imports THIS file for
  // broodReady and BROOD_R, so importing it back would be a cycle that blows up in the
  // TDZ on whichever of the two loaded first. Same arrangement SHOP_DPS lives under.
  a.pod = 0; a.podAt = null; a.podFrom = null;                    // a mothership that came
  a.podFly = 0; a.podLaden = false; a.hatch = undefined;          // back five minutes later would drop
                                                                  // a raider on whoever was standing
                                                                  // where the last fight ended, and the
                                                                  // hatch clock starts from `first`
                                                                  // again so the ramp is the ramp
  a.way = a.post ?? roamPoint(map, a.rand, away);
  a.tx = a.ty = a.dx = a.dy = null;
}

// contenders: [{ id, ship, haven }]. Returns the id it intends to shoot, or null.
// Who an alien shoots, beyond "whoever hit me first".
//
// One rule meant one pilot could hold anything in the game forever while the rest
// of the party worked in peace, so a group fight was a solo fight with spectators.
// Two more rules, both on a hold so nothing flaps between targets frame to frame:
//
//   crowding — stay meaningfully nearer than its current target for CLOSER_HOLD
//              and it turns on you. Kiting becomes something a party rotates.
//   threat   — hurt it enough more than its current target and it turns on you.
//              It already keeps a damage ledger for paying out the bounty; this
//              is the same ledger read for the other obvious purpose.
export const CLOSER_HOLD = 3.0;   // s of being the nearest before it switches
export const CLOSER_EDGE = 0.85;  // and nearer by a margin, not merely tied
export const THREAT_HOLD = 2.0;   // s of out-damaging its target before it switches
export const THREAT_EDGE = 2.0;   // and by this multiple, so a graze does not pull it

// How far out a hostile likes to stand. A gun's range for anything with a gun,
// and a tether's reach for the one thing that has none: reading weaponRange alone
// parked a Lamprey inside your hull, because 0 x 0.7 is 0, and a tether with no
// length is not a tether.
// How far out a hostile holds station. A gun's range for anything that has one —
// but a Lamprey's gun range is 0 and a Censer's is 0, and stepAlienAI multiplying
// that by 0.7 parks them both inside your hull with their own mechanic having no
// room to work. Each answers with its own reach instead.
//
// A Censer's is live rather than fixed: cold it presses right up at 110, and once
// it has spun up it stops closing at 630, because by then the ring has come to you.
// A sower's is its sowing reach, for exactly the reason a tether's is: reading
// weaponRange alone is 0 x 0.7 = 0, which parks a hostile inside your hull with its
// only mechanic having no room to work. It is a FIXED reach rather than a live one
// like a Censer's — a Censer's ring comes to you, so how close it stands depends on
// how wound up it is, and ground does not come to you at all.
// A sower with a gun holds station at the GUN, not at its sowing reach, and the
// difference is a layer of the fight rather than a detail. Sow reach is 1,100 and the
// barrel is 900, so it closes to 630 and works both; a pilot who backs off past 900
// is in the 200px band where the ground still lands and the gun has stopped. Reading
// the sowing reach here instead would park it at 770 and rain from outside its own
// barrel, which is a different and worse hostile.
//
// The `sow.reach` fallback stays for a sower with no gun — `weaponRange` 0 is falsy,
// so `||` finds it — because that is what these two were until they were given
// barrels, and 0 x 0.7 parks a hostile inside your hull with its only mechanic
// having no room to work.
export const standOff = a =>
  a.def?.siphon?.reach ??
  (a.def?.burn ? Math.max(a.def.burn.idle, burnR(a.def, a.spin ?? 0) * 0.7)
               : (a.stats.weaponRange || a.def?.sow?.reach || 0));

// Sanctuary, and the one exception to it: an alien will not start on somebody
// standing in a base ring, an outpost or a portal mouth — unless they shot it
// first, and then nothing saves them.
//
// It is a function rather than the expression it used to be, because a passive
// field asks the same question and a second copy of it would be a Censer quietly
// burning down a pilot parked at their own dock. `c` is a contender row:
// { id, ship, haven }.
export const mayHarm = (a, c) => !(c.haven && !a.provoked.has(c.id));

// A sector where distance does not decide anything.
//
// It is a property of the MAP, not of the hostile, and that is the whole point: an
// Ironhusk is an Ironhusk everywhere, and nothing in the open world starts chasing
// from across a sector because claims exist. `arena` is set by arenaMap() in
// shared/maps.js and by nothing else.
//
// Why a claim wants it: aggro and leash together make the only correct way to
// fight a closed field "kill one, walk out to 2,400px, let percentage-based shield
// regeneration put the ship back, walk in again". At 3.33% of the pool a second
// that loop refills a finished ship in half a minute, so a claim was not a fight
// with a budget, it was a fight with a rest button. Removing the two distance
// gates removes the rest button, and it removes nothing else: the hostiles still
// have to reach you, still respect sanctuary, and still pick their target by the
// same crowding and threat rules.
// Two gates, and they are worth separating because they are two different
// promises. `noLeash` is "nothing in here ever loses interest in you"; `noHorizon`
// is "everything in here knows where you are from the moment you arrive".
export const noLeash   = map => !!map?.arena;
export const noHorizon = map => !!map?.arena && !!map?.hunt;

// --- the one dial a hostile shows about itself ---------------------------------
//
// `abl` on the wire is a single 0..100 integer, and five different mechanics now
// ride it: a Lamprey's draw, a Censer's spin, a Kedge's sighting, a Thresher's
// chamber and a sower's glob in the air. There is exactly one slot left in
// SHIP_FIELDS — 30 of a hard 31 — so one field for all five is the right trade and it is not
// changing. What was wrong was HOW the one was chosen.
//
// It was `a.draw ?? a.spin ?? a.fix ?? a.load ?? a.sow ?? 0`, reading the LIVE
// fields in a fixed order. That is a silent wrong answer waiting to happen: the
// moment a hostile carries two mechanics, the second one's dial simply never
// reaches the client — nothing throws, nothing is logged, and what a pilot sees is
// a mechanic that is running and invisible. That is precisely the Thresher's
// chamber before 0.54, which read as a random one-shot for as long as it existed.
//
// So the dial is chosen off the DEFINITION, which is static, declared in one place,
// and can be asked a question a live field cannot: how many has this hostile got?
// `dialsOn` answers that, test/ground.mjs asserts it is never more than one, and
// the packer and the test now read the same table — so they cannot drift apart the
// way the workshop dock's two copies of "may this pilot buy here" did.
export const DIALS = [
  ['siphon',  a => a.draw],    // a Lamprey's draw, 0..1
  ['burn',    a => a.spin],    // a Censer's ring, cold to full
  ['fix',     a => a.fix],     // a Kedge's sighting, from taken to collapsed
  ['returns', a => a.load],    // a Thresher's chamber, empty to full
  ['sow',     a => a.sow],     // a sower's glob, from the throw to where it lands
];
export const dialsOn = def => DIALS.filter(([k]) => def?.[k] !== undefined).map(([k]) => k);
// Clamped here rather than at the call site, so a NaN out of any of the five draws
// a nought instead of taking the frame down. The client already reads `abl` through
// ALIENS[hull] for each mechanic, so this is the server half of a decision the two
// sides were already making the same way.
export const dialOf = a => {
  const d = DIALS.find(([k]) => a?.def?.[k] !== undefined);
  const v = d ? d[1](a) : 0;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
};


export function stepAlienAI(a, map, contenders, dt) {
  const at = id => contenders.find(c => c.id === id);
  const alive = c => c && c.ship.hp > 0;
  const dist = c => Math.hypot(c.ship.x - a.x, c.ship.y - a.y);
  const noEdge = noLeash(map), noFog = noHorizon(map);

  let t = alive(at(a.target)) ? at(a.target) : null;
  if (t) {
    const angry = a.provoked.has(t.id);
    // Sanctuary only holds for someone who has not shot at it. Once provoked it
    // will follow you into a base ring or a portal mouth and keep firing.
    if (!mayHarm(a, t)) t = null;
    else if (!noEdge && dist(t) > a.def.leash) {
      a.lost += dt;
      // Outrunning it is a real escape: it forgets the grudge along with the target.
      if (a.lost > a.def[LOSE_INTEREST]) { a.provoked.delete(t.id); t = null; }
    } else a.lost = 0;
  }
  if (!t) { a.target = null; a.lost = 0; }

  if (!a.target) {
    let best = null, bestD = Infinity;
    for (const c of contenders) {
      if (!alive(c)) continue;
      const angry = a.provoked.has(c.id), d = dist(c);
      // `loud` is what the candidate is doing to be noticed — 1 for everyone
      // except a ship running an Aspect Filter, which is an active illuminator
      // and is therefore heard from further off than it can be seen from. The
      // caller supplies it, so this file needs no opinion about the shop.
      // Sanctuary still holds — that is a rule about where a pilot is standing, not
      // about how far away they are, and a claim has no sanctuary in it anyway.
      if (c.haven && !angry) continue;
      if (angry ? (!noEdge && d > a.def.leash) : (!noFog && d > a.def.aggro * (c.loud ?? 1))) continue;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { a.target = best.id; t = best; a.lost = 0; }
  }

  // Having a target is not the end of the question. Both challenges are timed, so
  // brushing past it does nothing and committing to crowding it does.
  if (t) {
    const eligible = c => alive(c) && c.id !== t.id
      && mayHarm(a, c) && (noEdge || dist(c) <= a.def.leash);
    let near = null, nearD = Infinity;
    for (const c of contenders) {
      if (!eligible(c)) continue;
      const d = dist(c);
      if (d < nearD) { nearD = d; near = c; }
    }
    if (near && nearD < dist(t) * CLOSER_EDGE) {
      if (a.crowd !== near.id) { a.crowd = near.id; a.crowdT = 0; }
      a.crowdT += dt;
      if (a.crowdT >= CLOSER_HOLD) { a.target = near.id; t = near; a.lost = 0; a.crowd = null; a.crowdT = 0; }
    } else { a.crowd = null; a.crowdT = 0; }
  }
  if (t && a.dealt?.size) {
    const mine = a.dealt.get(t.id) ?? 0;
    let worst = null, worstD = 0;
    for (const c of contenders) {
      if (!alive(c) || c.id === t.id || dist(c) > a.def.leash) continue;
      const d = a.dealt.get(c.id) ?? 0;
      if (d > worstD) { worstD = d; worst = c; }
    }
    if (worst && worstD > Math.max(1, mine) * THREAT_EDGE) {
      if (a.threat !== worst.id) { a.threat = worst.id; a.threatT = 0; }
      a.threatT += dt;
      if (a.threatT >= THREAT_HOLD) { a.target = worst.id; t = worst; a.lost = 0; a.threat = null; a.threatT = 0; }
    } else { a.threat = null; a.threatT = 0; }
  }

  if (t) {
    // Badly hurt, it stops fighting and runs — still tracked, still shootable,
    // but it will not trade any more. Running is clamped inside charted space so
    // it does not simply kill itself on the shear.
    if (a.hp <= a.stats.hull * a.def.flee) {
      a.dx = a.dy = null;
      // Straight away from you, UNLESS that runs into the edge of charted space —
      // in which case turn until it does not. Clamping the destination instead is
      // what shipped, and with its back to a wall the clamp collapsed the target
      // onto the hostile's own position: it "arrived" on the spot and stood there.
      // Measured on a Drifter at m2's east edge, 15px of flight against 1,267 in
      // open space, and cornered it was 24. The designer reported it twice as
      // "when they are fleeing, they just stand still", and they were right both
      // times — it runs into the wall rather than along it.
      //
      // The turn is tried both ways so it slides along whichever edge it is on
      // rather than always the same way round, and the sector's OWN size is what
      // bounds it, because a map has had its own dimensions since duels landed.
      const { w, h } = sizeOf(map);
      const away = Math.atan2(a.y - t.ship.y, a.x - t.ship.x);
      for (const turn of FLEE_TURNS) {
        const ang = away + turn;
        const tx = Math.max(FLEE_EDGE, Math.min(w - FLEE_EDGE, a.x + Math.cos(ang) * FLEE_RUN));
        const ty = Math.max(FLEE_EDGE, Math.min(h - FLEE_EDGE, a.y + Math.sin(ang) * FLEE_RUN));
        // Far enough to be a departure rather than a shuffle. Without this it takes
        // the first turn that moves it at all, which against a corner is a metre.
        if (Math.hypot(tx - a.x, ty - a.y) > FLEE_RUN * 0.35) { a.tx = tx; a.ty = ty; break; }
      }
      return null;                                           // fleeing, not firing
    }
    const d = dist(t), hold = standOff(a) * 0.7;
    a.dx = a.dy = null;
    if (d > hold) { a.tx = t.ship.x; a.ty = t.ship.y; }     // close
    else           { a.tx = a.ty = null; }                   // hold station and shoot
    return t.id;
  }

  // Idle. One with a post walks back to it and holds there, so a firing line
  // stays a firing line. Everything else drifts between waypoints — and picking
  // waypoints outside the base is not enough, since the straight line between two
  // of them will cut through the ring, so the course itself is steered around.
  if (a.post) {
    a.dx = a.dy = null;
    const off = Math.hypot(a.post.x - a.x, a.post.y - a.y);
    a.tx = off < 40 ? null : a.post.x;
    a.ty = off < 40 ? null : a.post.y;
    return null;
  }
  if (Math.hypot(a.way.x - a.x, a.way.y - a.y) < 220) a.way = roamPoint(map, a.rand);
  a.dx = a.dy = null;
  const aim = skirtBase(a, a.way, map);
  a.tx = aim.x; a.ty = aim.y;
  return null;
}

// Keeps an idle alien outside the base ring: shoves it straight out if it has
// somehow got inside, and otherwise aims past the ring's flank when the direct
// course to its waypoint would clip it.
export const BASE_STANDOFF = 380;
export function skirtBase(a, want, map) {
  const b = map.base;
  if (!b) return want;
  const keep = b.r + BASE_STANDOFF;

  const cx = b.x - a.x, cy = b.y - a.y, dc = Math.hypot(cx, cy);
  if (dc < keep) {                                   // inside the standoff: leave, directly
    const ux = dc < 1 ? 1 : -cx / dc, uy = dc < 1 ? 0 : -cy / dc;
    return { x: b.x - ux * (keep + 500) * -1, y: b.y - uy * (keep + 500) * -1 };
  }

  const wx = want.x - a.x, wy = want.y - a.y, dw = Math.hypot(wx, wy);
  if (dw < 1) return want;
  const hx = wx / dw, hy = wy / dw;
  const along = hx * cx + hy * cy;                    // is the ring ahead of us at all?
  if (along <= 0 || along > dw + keep) return want;
  const side = hx * cy - hy * cx;                     // signed clearance of the course
  if (Math.abs(side) > keep) return want;

  const sgn = side >= 0 ? -1 : 1;                     // pass on the near side
  return { x: b.x + -hy * sgn * keep * 1.25, y: b.y + hx * sgn * keep * 1.25 };
}
