// PvE hostiles.
//
// An alien reuses the ship body wholesale — same step(), same vitals, same damage
// and the same shear outside charted space. Only the intent differs, and that is
// all this file decides.

import { ATTRS } from './ships.js';
import { MAP_W, MAP_H } from './maps.js';
import { newBody, inHaven } from './sim.js';
import { burnOf, burnR, stepBurn, goadBurn, burnBite, burnBurst,
         pyreFor, inPyre, poolOf, inBurn } from './burn.js';
import { fixOf } from './kedge.js';
import { sowOf, HOLD, WARN } from './ground.js';

// What a kill pays, per point of work. Hoisted above the bestiary because the deeps
// derive their bounty from their rung inside the table below, and a const cannot be
// read before it is initialised — the argument for both numbers is where bountyFor
// is, which is where they used to sit.
export const XP_RATE = 140 / 650;                  // the Drifter is the anchor: 140 xp for 650 ehp
export const BOUNTY_RATE = 0.70;

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
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Drifts a patrol and shoots whatever comes close. Nothing else.',
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
  kedge: {
    name: 'Kedge', cls: 'Surveyor', r: 34, colour: '#7c8824', shape: 'fluke',
    tell: 'Takes a fix on where you are and three seconds later puts you back on it. It has to stand dead still to do it, which is when you kill it. A portal mouth breaks the fix.',
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
    tell: 'A mirror. It throws back what you have just dealt it — watch the chamber over its head, and stop shooting to empty it. Do not stand still.',
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
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Faster than every hull but a Kestrel. You do not disengage from one, you finish it.',
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
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Armour and a short gun. It only reaches 500, so holding your own range costs it everything.',
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
    attrs: { hull: 45000, shield: 20000, shieldRegen: 0.045, shieldDelay: 3,
             speed: 230, accel: 380, signature: 8,
             damage: 150, fireRate: 0.8, weaponRange: 900 },
    aggro: 520,
    leash: 2200,
    patience: 4.0,
    flee: 0,
    respawn: 90,
    bounty: 45500,    // 65000 ehp at BOUNTY_RATE, and 10 x the Ironhusk's 4550
    xp: 14000,        // likewise 10 x 1400
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Out-ranges you and out-lasts you. The first thing you cannot beat alone.',
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
    attrs: { hull: 450000, shield: 200000, shieldRegen: 0.006, shieldDelay: 4,
             speed: 110, accel: 180, signature: 10,
             damage: 220, fireRate: 0.5, weaponRange: 1100 },
    // Escorts are the fight, so there have to be enough of them for that to be
    // true. Four every eighteen seconds was a trickle you could ignore between
    // volleys. One every five now, up to twelve alive — which means a hive left
    // alone for a minute has a dozen raiders around it, and the pressure comes
    // from what you did not clean up rather than from any single one of them.
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
    tell: 'A mothership. It broods Bandits once it has noticed somebody, and keeps brooding until it is dead.',
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
    attrs: { hull: 22000, shield: 8000, shieldRegen: 0.0112, shieldDelay: 5,
             speed: 400, accel: 500, signature: 2,
             damage: 150, fireRate: 1.3, weaponRange: 640 },
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
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'Dodges, and nose-on it is barely there. Hard to hit and harder to see coming.',
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
  // WHY THERE IS NO GUN ON EITHER. The balance model's own complaint, in
  // test/balance.mjs: "content dps has not kept up with the player's hull". Every
  // armed hostile throws a flat number of points, player effective hit points span
  // x6.4 across the shop and another x32 across the research ladder, and the deeps
  // are precisely where the pilots at the top of both live. A bolt for 220 is not a
  // threat to 220,736 effective hit points and no honest number of them is. So both
  // of these take a SHARE, the way a Censer's ring and a Lamprey's tether do, and
  // the share is what makes them the same fight at x1 and at x32.
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
    // `every` is life / max as it always was, so a definition can never ask for more
    // ground than it is allowed to hold — and 10 seconds is CALM, the thrust a pilot
    // is owed back after a stop. A Crucible lays exactly one pool per calm, so
    // somebody who has just been freed has one fresh pool to deal with and never two.
    sow: { kind: 'white',
           reach: 1100,            // the Hive's gun, and 200px past its OWN gun below:
                                   //   back off and the barrel stops, the ground does not
           r: 560,                 // SIGHT_R — the widest circle you can see all of
           life: 10, max: 1, every: 10,       // every === CALM === life / max
           wind: WARN,             // 1.5s of marker before it goes live
           rate: 0.045,            // ANCHORS.pressure, exactly
           hold: 0 },              // it takes ground, not the ship
    // 85/15 hull to shield, the Censer's split and the Thresher's: a vessel is mostly
    // what it is carrying. Derived from DEEP_HP so the rung is one edit, not five.
    //
    // AND IT HAS A GUN NOW. It had none, and that made these two the first hostiles
    // where balance.js's `pressure x ehp` was actively wrong rather than merely
    // incomplete — the model wants a number of points a second and they threw none.
    // 584 x 0.75 is 438 dps, which is ANCHORS.pressure x stageEhp('finished') to the
    // decimal: the gun IS the model's own answer, so the gun is the on-model part and
    // the ground is what sits above it. That closes the gap on the DAMAGE axis and
    // narrows rather than closes the one named on alienFor's `dps` line, which is
    // about fight LENGTH and is still there.
    //
    // Reach 900 is the Leviathan's, the Thresher's and the Kedge's — past every hull
    // in the shop (620-820), so out-ranging the barrel is not on the table. What IS
    // on the table is backing off past 900 into the 200px band where the ground still
    // reaches and the gun does not, which is the layer this hostile grew when it grew
    // a barrel. test/ground.mjs asserts the two reaches stay in that order.
    attrs: { ...deepSplit(0.15), shieldRegen: 0.005, shieldDelay: 6,
             // 120, between the Hive's 110 and the Kedge's 150. Leaving always works:
             // the slowest thing a fitted pilot can hold indefinitely is a finished
             // Bulwark at 195 px/s, and this is 75 under it.
             speed: 120, accel: 200, signature: 10,
             damage: 584, fireRate: 0.75, weaponRange: 900 },
    mate: 'doldrum',  // it does not fly alone — see the seeding, and pairPost()
    aggro: 540,       // the Hive's, still inside SIGHT_R, so it is on screen first
    leash: 2600,
    patience: 5.0,
    flee: 0,          // it has nowhere to be; it is making the place
    respawn: 300,
    ...deepPay,       // DEEP_HP at BOUNTY_RATE and XP_RATE — nothing typed
    tell: 'Pours White Heat where you were standing, and it stays. Never flies alone — a Doldrum comes with it, and the still is what holds you in the plasma.',
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
  // you stand, for five seconds.
  //
  // You keep the trigger, the target, the rockets, a repair drone, a Recall Beacon,
  // your heading and your shields. You cannot be anywhere else. It cannot be chained
  // — HOLD is 5s, CALM is 10s of guaranteed thrust after every one, and one patch may
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
  // five seconds and nothing else; being caught in the middle costs you five seconds
  // inside the plasma its mate just poured there. The trap has a near miss in it,
  // which is what makes it a fight rather than a coin.
  doldrum: {
    name: 'Doldrum', cls: 'Deadfall', r: 82, colour: '#6b3cff', shape: 'anvil',
    sow: { kind: 'slack',
           reach: 1100,
           r: 720,                 // a Censer's ring at full spin, and wider than a pool
           life: 15, max: 1, every: 15,       // every === HOLD + CALM === life / max:
                                   //   exactly one still per cycle of its own promise,
                                   //   so it can never build a second to catch you
                                   //   inside the calm it owes you
           wind: WARN,
           rate: 0.0225,           // DRAIN_RATE — half of on model, half of a pool
           hold: HOLD },           // five seconds, stopped, once per entry
    // 70/30, the Hive's split: more of it is field than plating, and the field is what
    // the stills come out of. Derived from DEEP_HP, like its mate's.
    //
    // The same 438 dps as a Crucible and a slower trigger to deliver it — 876 x 0.5,
    // the Hive's cadence. Same rung, same gun, and what differs between them is the
    // ground, which is the whole point of posting them together.
    attrs: { ...deepSplit(0.30), shieldRegen: 0.005, shieldDelay: 8,
             // 90 — the slowest thing in the game, under the Hive's 110. It does not
             // need to catch you. It needs you to come to it, and the ground is how it
             // arranges that.
             speed: 90, accel: 150, signature: 10,
             damage: 876, fireRate: 0.5, weaponRange: 900 },
    mate: 'crucible',
    aggro: 540,
    leash: 2600,
    patience: 5.0,
    flee: 0,
    respawn: 300,
    ...deepPay,       // the same rung, so the same pay, from the same line
    tell: 'Its stills stop you dead for five seconds — you keep your guns, you just cannot be anywhere else. Its Crucible pours into the same spot.',
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

// The sharpest gun the shop sells, in points per second — the whole ladder bought
// out, with nothing researched.
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
// A brute-force sweep of every legal fit finds one number above it: 16,967 on a
// Bulwark carrying Siege Cadence AND Rapid Cadence, whose drawbacks cancel into a
// free x1.50 (each is a trade of damage against rate, and `pct` entries SUM, so
// +0.60/-0.375 and -0.375/+0.60 land as x1.225 on both). That is a defect in that
// pair of technologies — every technology is supposed to give something up, and
// those two give each other's back — not a statement about what the shop is for,
// and anchoring the bestiary to it would bake it in. Named here so the next person
// measuring this does not think the sweep and the anchor disagree by accident.
const SHOP_DPS = 11306.59;

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

export function storeHit(a, amount) {
  if (!a?.def?.returns || !(amount > 0)) return;
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
  a.sinceHit = 1e9; a.shieldHit = 0; a.cool = 0; a.shotFlash = 0;
  a.target = null; a.provoked.clear(); a.lost = 0; a.dead = 0;
  a.crowd = null; a.crowdT = 0; a.threat = null; a.threatT = 0;   // no grudges carried over
  a.sow = 0; a.sowAt = null; a.sowOn = null; a.sowCool = 0;       // nor a wind-up. Ground it has
                                                                  // already laid stays laid, which
                                                                  // is the whole mechanic; the CAST
                                                                  // does not survive the caster
  a.load = 0;                                                     // nor a chamber: a mirror that
                                                                  // respawned loaded would open the
                                                                  // next fight with your last one
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
// chamber and a sower's wind-up. There is exactly one slot left in SHIP_FIELDS —
// 30 of a hard 31 — so one field for all five is the right trade and it is not
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
  ['sow',     a => a.sow],     // a sower's wind-up, before the ground lands
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
      const dx = a.x - t.ship.x, dy = a.y - t.ship.y, m = Math.hypot(dx, dy) || 1;
      a.dx = a.dy = null;
      a.tx = Math.max(500, Math.min(MAP_W - 500, a.x + (dx / m) * 2200));
      a.ty = Math.max(500, Math.min(MAP_H - 500, a.y + (dy / m) * 2200));
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
