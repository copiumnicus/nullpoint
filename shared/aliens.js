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
    attrs: { hull: 450, shield: 200, shieldRegen: 45, shieldDelay: 4,
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
    attrs: { hull: 5500, shield: 1000, shieldRegen: 120, shieldDelay: 4,
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
  // A mirror. It returns what you put into it, and that is the whole design.
  //
  // Every other hostile is a wall of hit points, and the research ladder is about to
  // make walls of hit points irrelevant: a finished ship at x32 takes 4,558 seconds
  // to die to a Drifter and deletes anything under 100,000 effective hit points in
  // under two seconds. Content whose only tool is damage is finished.
  //
  // So the difficulty of this fight is set by YOUR gun rather than by its hull, and
  // it cannot be bought past. `returns: 1` is the fiction rather than a dial — a
  // mirror returns what it is given — and it produces an identity nothing else in
  // the game has:
  //
  //   total damage returned over the fight = returns x effective hp = 205,550,
  //   exactly, whatever you fly.
  //
  // You have to deal its hit points to kill it, and it hands them back.
  //
  // 205,550 is 650 x 10^2.5 to the nearest ten — half a rung under the Corsair Hive,
  // the same relation the Harrier has to the Ironhusk. Measured against a finished
  // Bulwark it dies at x16 research and is survivable at x32, which reproduces the
  // research ladder's own argument for x32 from an independent derivation with
  // nothing tuned to fit.
  //
  // And the answer to it is a behaviour, not a purchase. Standing still costs 88% of
  // a x32 ship over the fight; sidestepping 80px across the line of fire costs 35%.
  // It is the first hostile that makes "hold range and hold the trigger" wrong.
  //
  // Speed 200 is under every hull, like a Leviathan: it can kill you but it can
  // never trap you. Reach 900 is over every hull, also like a Leviathan, so you
  // cannot simply out-range the problem.
  thresher: {
    name: 'Thresher', cls: 'Revenant', r: 46, colour: '#e4e4e4', shape: 'facet',
    returns: 1,
    attrs: { hull: 175550, shield: 30000, shieldRegen: 400, shieldDelay: 6,
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
    tell: 'A mirror. Everything you put into it comes back out, so it is as dangerous as your own gun. Do not stand still.',
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
    attrs: { hull: 1420, shield: 640, shieldRegen: 55, shieldDelay: 4,
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
    attrs: { hull: 4500, shield: 2000, shieldRegen: 130, shieldDelay: 5,
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
    attrs: { hull: 45000, shield: 20000, shieldRegen: 900, shieldDelay: 3,
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
    attrs: { hull: 450000, shield: 200000, shieldRegen: 1200, shieldDelay: 4,
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
    attrs: { hull: 22000, shield: 8000, shieldRegen: 90, shieldDelay: 5,
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
    attrs: { hull: 14550, shield: 6000, shieldRegen: 200, shieldDelay: 5,
             speed: 200, accel: 300, signature: 7,
             damage: 0, fireRate: 0.5, weaponRange: 0 },
    aggro: 500, leash: 2000, patience: 4.0, flee: 0, respawn: 45,
    bounty: 14385,
    xp: 4426,
    // One line for the pilot's threat file, which is the only place a hostile
    // explains itself. Data, so the next one is a line here rather than a UI change.
    tell: 'No gun. A tether onto your hull that drinks past your shields and mends it. Fly out of range and the cord snaps.',
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
export const XP_RATE = 140 / 650;                  // the Drifter is the anchor: 140 xp for 650 ehp
export const farmHp = kind => effectiveHp(kind) * (ALIENS[kind].effort ?? 1);
export const BOUNTY_RATE = 0.70;
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
       + (a.siphon?.rate ?? 0) * hull;
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
  // A knobbly disc: twelve shallow lobes, no nose and no spikes. It reads as a
  // structure rather than a ship, which is what it is.
  hive: R => Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2, rr = R * (i % 2 ? 0.86 : 1.05);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }),
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
// What has been fed into it and not yet given back. Three seconds, so a pilot who
// breaks off still eats what they already dealt, but a fight abandoned two sectors
// ago is not still in the chamber waiting.
//
// The payload IS the alien's damage stat while it is loaded, which is why none of
// combat.js, net.js or the client needs to know this exists: boltWidth() already
// fattens a bolt from its damage and the floating damage number already says how
// hard it landed, so the tell is free three times over.
export const LOAD_HOLD = 3;

export function storeHit(a, amount) {
  if (!a?.def?.returns || !(amount > 0)) return;
  a.load = (a.load ?? 0) + amount * a.def.returns;
  a.loadT = LOAD_HOLD;
}

// Called before it fires. Returns the payload, so the caller can decide whether
// anything was worth spending.
export function stepMirror(a, dt) {
  if (!a?.def?.returns) return 0;
  if (a.loadT > 0) { a.loadT -= dt; if (a.loadT <= 0) { a.load = 0; a.loadT = 0; } }
  // The base damage is read off the definition rather than off the live stats,
  // because the live stats are what this function is writing to. Reading them back
  // would compound the payload every tick into an unbounded number.
  a.stats.damage = (a.def.attrs.damage ?? 0) + (a.load ?? 0);
  return a.load ?? 0;
}

export const spendMirror = a => { if (a) { a.load = 0; a.loadT = 0; } };

export function respawnAlien(a, map, away = []) {
  // A posted alien belongs to its slot on the firing range and goes back to it
  // whoever is standing there; everything in the wild comes back out of the way.
  const at = a.post ?? roamPoint(map, a.rand, away);
  a.x = at.x; a.y = at.y; a.vx = a.vy = 0;
  a.hp = a.stats.hull; a.shield = a.stats.shield;
  a.sinceHit = 1e9; a.shieldHit = 0; a.cool = 0; a.shotFlash = 0;
  a.target = null; a.provoked.clear(); a.lost = 0; a.dead = 0;
  a.crowd = null; a.crowdT = 0; a.threat = null; a.threatT = 0;   // no grudges carried over
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
export const standOff = a =>
  a.def?.siphon?.reach ??
  (a.def?.burn ? Math.max(a.def.burn.idle, burnR(a.def, a.spin ?? 0) * 0.7) : a.stats.weaponRange);

// Sanctuary, and the one exception to it: an alien will not start on somebody
// standing in a base ring, an outpost or a portal mouth — unless they shot it
// first, and then nothing saves them.
//
// It is a function rather than the expression it used to be, because a passive
// field asks the same question and a second copy of it would be a Censer quietly
// burning down a pilot parked at their own dock. `c` is a contender row:
// { id, ship, haven }.
export const mayHarm = (a, c) => !(c.haven && !a.provoked.has(c.id));

export function stepAlienAI(a, map, contenders, dt) {
  const at = id => contenders.find(c => c.id === id);
  const alive = c => c && c.ship.hp > 0;
  const dist = c => Math.hypot(c.ship.x - a.x, c.ship.y - a.y);

  let t = alive(at(a.target)) ? at(a.target) : null;
  if (t) {
    const angry = a.provoked.has(t.id);
    // Sanctuary only holds for someone who has not shot at it. Once provoked it
    // will follow you into a base ring or a portal mouth and keep firing.
    if (!mayHarm(a, t)) t = null;
    else if (dist(t) > a.def.leash) {
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
      if (angry ? d > a.def.leash : (c.haven || d > a.def.aggro * (c.loud ?? 1))) continue;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { a.target = best.id; t = best; a.lost = 0; }
  }

  // Having a target is not the end of the question. Both challenges are timed, so
  // brushing past it does nothing and committing to crowding it does.
  if (t) {
    const eligible = c => alive(c) && c.id !== t.id
      && mayHarm(a, c) && dist(c) <= a.def.leash;
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
