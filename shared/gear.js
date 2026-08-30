// Everything you can buy and bolt to a ship.
//
// Three slot kinds, and the split between them is a rule, not a habit:
//
//   weapons and generators add ABSOLUTE amounts — so much damage, so much shield,
//     so many seconds of capacitor. They fill out a hull.
//   technologies MULTIPLY — a third more hull, half the signature, two thirds
//     more cargo. They change the shape of a hull.
//
// That keeps the two kinds of choice separate: racks are how much ship you have,
// technology is what kind of ship it is, and a multiplier is worth most to whoever
// already has the most of the thing it scales. A test enforces the split, and
// another enforces that every technology still costs you something.

export const SLOTS = ['weapon', 'generator', 'tech'];

// Drones fly escort and carry one item each, of any kind. They are the only way
// past a hull's own rack, and they cost more the more you already have.
export const MAX_DRONES = 12;
export const MAX_LAUNCHERS = 3;
export const dronePrice = owned => 3000 + owned * 2600;

// What your own company will not sell you.
//
// The upper half of every ladder is stocked on the frontier and nowhere else. Your
// company sells the kit it issues; the good stuff comes off a pirate hulk, which
// is where it should come from and gives the outposts a reason to exist beyond a
// place to dump ore. It also puts a real shape on progress: the home ring takes
// you as far as it takes you, and then you have to go somewhere.
//
// The rungs are where each ladder stops being starter kit. Emitters have five, so
// the top three are frontier; launchers and technologies have three, so the top
// two and the top one are.
export const FRONTIER = { laser: 3, rocket: 2, tech: 3 };

// Which hull ability a technology tunes, or null if it is for every ship.
//
// Derived from the attributes it touches rather than declared, so a new ability
// technology cannot be added without this knowing about it. The dials are named
// after their abilities — veilDepth, anchorSwell, lockReach — which is what makes
// this readable rather than a table someone has to remember to update.
//
// It matters because these were sold to anyone. A Null Skin fitted to a Bulwark
// moves a number nothing on that hull reads, the tooltip's figures move anyway
// because they are computed from the stat, and it looks for all the world like it
// works. A thing that does nothing should not be purchasable in silence.
export function tunesAbility(key) {
  for (const [attr] of EQUIPMENT[key]?.mods ?? []) {
    if (attr.startsWith('veil')) return 'veil';
    if (attr.startsWith('anchor')) return 'anchor';
    if (attr.startsWith('lock')) return 'lock';
  }
  return null;
}

export function frontierOnly(key) {
  const e = EQUIPMENT[key];
  if (!e) return false;
  const ladder = e.slot === 'tech' ? 'tech' : e.kind === 'rocket' ? 'rocket' : 'laser';
  const cut = FRONTIER[ladder];
  return cut !== undefined && (e.tier ?? 0) >= cut;
}

// Why this pilot cannot buy this here, or null. `berth` is whether they are stood
// at an outpost bay they rent; `docked` is their own company ring.
export function whyNotSold(key, { docked = false, berth = false, hull = null } = {}) {
  if (!EQUIPMENT[key]) return 'no such thing';
  // An ability technology is only a technology on the hull that has the ability.
  const tunes = tunesAbility(key);
  if (tunes && hull && hull.ability !== tunes) {
    const owner = { veil: 'Kestrel', anchor: 'Bulwark', lock: 'Vanguard' }[tunes];
    return `tunes the ${tunes} — only the ${owner} has one, and you fly a ${hull.name}`;
  }
  if (frontierOnly(key)) {
    return berth ? null : 'frontier stock — sold at a pirate outpost, to pilots with a bay there';
  }
  return docked || berth ? null : 'fly into your base ring';
}

export const EQUIPMENT = {
  // Weapons — each adds its output to the hull's own, and throws a visibly
  // heavier bolt for it. The ladder is steep on purpose: a finished ship deletes
  // a home-map husk in one trigger pull, and the things waiting further out will
  // do the same to anyone who wandered there in a starter hull. Five rungs so
  // that climb has steps rather than one cliff.
  emitter1: { name: 'MK-I Emitter',  slot: 'weapon', kind: 'laser', tier: 1, price:    900,
              blurb: 'A laser.', mods: [['damage', 'add', 18]] },
  emitter2: { name: 'MK-II Emitter', slot: 'weapon', kind: 'laser', tier: 2, price:   2600,
              blurb: 'A better laser.', mods: [['damage', 'add', 45]] },
  emitter3: { name: 'MK-III Emitter', slot: 'weapon', kind: 'laser', tier: 3, price:  7200,
              blurb: 'The last one you can afford by accident.', mods: [['damage', 'add', 110]] },
  emitter4: { name: 'MK-IV Emitter', slot: 'weapon', kind: 'laser', tier: 4, price:  16000,
              blurb: 'Fleet issue. Nothing on the home map survives a full rack.',
              mods: [['damage', 'add', 220]] },
  emitter5: { name: 'MK-V Emitter',  slot: 'weapon', kind: 'laser', tier: 5, price:  34000,
              blurb: 'About as much as a hardpoint will carry.', mods: [['damage', 'add', 400]] },

  // Launchers — the other thing a weapon slot will take. Three to a ship, never on
  // a drone. Each rack shadows a rung of the emitter ladder and beats it: about a
  // fifth more damage out of the same slot, for about a sixth more money. That
  // premium is what pays for the three real costs — the cap of three however many
  // slots the hull has, no drone ever carrying one, and a second or two in the air
  // before any of it lands. Without it there was no reason to fit one at all.
  // Damage is declared for the whole volley, so two racks of the same model land
  // the same rocket twice rather than one twice as hard.
  pod1: { name: 'Sparrow Pod', slot: 'weapon', kind: 'rocket', tier: 1, price:  3200,
          blurb: 'One rocket. It will find you.',
          mods: [['rockets', 'add', 1], ['rocketVolley', 'add', 120]] },
  pod2: { name: 'Triad Rack',  slot: 'weapon', kind: 'rocket', tier: 2, price: 19000,
          blurb: 'Three, thrown wide and closing.',
          mods: [['rockets', 'add', 3], ['rocketVolley', 'add', 576]] },
  pod3: { name: 'Swarm Rack',  slot: 'weapon', kind: 'rocket', tier: 3, price: 40000,
          blurb: 'Five. Turning away only buys you a second.',
          mods: [['rockets', 'add', 5], ['rocketVolley', 'add', 1050]] },

  // generators — reactor gear. Capacitor, recharge and the free trickle.
  cellA: { name: 'A-Cell Generator', slot: 'generator', tier: 1, price:  1200,
           blurb: 'A little more reactor, a little more shield.',
           mods: [['capacitor', 'add', 8], ['recharge', 'add', 0.4], ['shield', 'add', 120], ['speed', 'add', -8]] },
  cellB: { name: 'B-Cell Generator', slot: 'generator', tier: 2, price:  3400,
           blurb: 'Holds more, and trickles harder.',
           mods: [['capacitor', 'add', 16], ['recharge', 'add', 0.8], ['sustain', 'add', 0.02],
                  ['shield', 'add', 200], ['speed', 'add', -13]] },
  cellC: { name: 'C-Cell Generator', slot: 'generator', tier: 3, price:  8800,
           blurb: 'A reactor you can lean on.',
           mods: [['capacitor', 'add', 26], ['recharge', 'add', 1.3], ['sustain', 'add', 0.04],
                  ['shield', 'add', 300], ['speed', 'add', -18]] },
  // The shield ladder climbs with the weapon ladder, or the top of the game is
  // two finished ships deleting each other on sight. Capacitor and trickle climb
  // gently — those are seconds and fractions, and they do not need to go 8x.
  cellD: { name: 'D-Cell Generator', slot: 'generator', tier: 4, price: 19000,
           blurb: 'Fleet issue. A wall of shield, and heavy with it.',
           mods: [['capacitor', 'add', 34], ['recharge', 'add', 1.9], ['sustain', 'add', 0.06],
                  ['shield', 'add', 750], ['speed', 'add', -24]] },
  cellE: { name: 'E-Cell Generator', slot: 'generator', tier: 5, price: 40000,
           blurb: 'More shield than most hulls have hull.',
           mods: [['capacitor', 'add', 42], ['recharge', 'add', 2.5], ['sustain', 'add', 0.08],
                  ['shield', 'add', 1400], ['speed', 'add', -30]] },

  // Collector rigs — the only modules that go on a drone and nowhere else. A bay
  // carrying one stops being a gun and starts being a hold: the drone reaches out
  // and pulls in anything worth having, by itself, while you keep flying.
  //
  // They are why you would ever put something other than an emitter on a drone.
  collect1: { name: 'Scavenger Rig', slot: 'drone', kind: 'collector', tier: 1, price:  5200, reach: 520,
              blurb: 'Pulls in what it can reach, without being asked.',
              mods: [['cargo', 'add', 40]] },
  collect2: { name: 'Harvester Rig', slot: 'drone', kind: 'collector', tier: 2, price: 12000, reach: 780,
              blurb: 'Further out, and room for what it brings back.',
              mods: [['cargo', 'add', 90]] },
  collect3: { name: 'Ore Tender',    slot: 'drone', kind: 'collector', tier: 3, price: 26000, reach: 1100,
              blurb: 'Clears a wreck field on its own.',
              mods: [['cargo', 'add', 180]] },

  // technologies — one of each, and every one costs you something.
  //
  // Tiered like every other shelf, because "which technology" was the only choice
  // in the shop with no ladder behind it: four things at one rung, and nothing to
  // climb toward. Tier 3 and up is frontier stock — see FRONTIER below.
  // A technology may multiply UP only an attribute a rack cannot already run away
  // with, and may multiply DOWN anything. Measured spans: a rack moves hull, speed,
  // radar, signature, range and rate by x1.00 and shield by x3.00 — but it moves
  // DAMAGE by x68 on a Bulwark and x174 on a Hauler. A benefit that grows
  // sixty-eight times with your guns cannot keep a fixed price: a `damage x1.22`
  // technology prices at 634 cr against a new pilot and hands a finished ship
  // 85,734 cr of capability.
  //
  // THE EXCEPTION, and it is the only one: a technology may multiply damage up if
  // what it multiplies DOWN is another term of a damage-per-second product.
  //
  //   dps = damage x fireRate  +  rocketVolley x ROCKET_RATE
  //
  // Everything else on this shelf is paid for in an attribute a rack cannot move,
  // which is exactly why a naked damage multiplier cannot be: the gain grows x68
  // and the price stays put. Pay for the product out of the product and BOTH sides
  // grow x68, so the trade a starter Hauler is offered and the trade a finished
  // Bulwark is offered are the same trade. Measured, on the three below:
  //
  //   Siege / Rapid Cadence  x1.60 against x0.625 — dps identical to the last
  //     digit at both ends: 57.6 on a starter Hauler, 7794.0 on a finished
  //     Bulwark, with and without. What moves is WHEN it arrives.
  //   Launcher Primacy  +25% dps on a Hauler with one Sparrow Pod, +33% on a
  //     Bulwark with three Swarm Racks, -12% on the same Bulwark once twelve
  //     drones are carrying emitters, and a flat -30% for anyone with no rack at
  //     all. It only pays for the build that gave something up to earn it.
  //
  // balance.js scores the pair as a product rather than as two rows now, so the
  // model can see this for itself: capabilityOf reads Siege Cadence as exactly zero
  // points of capability. Added up as separate rows it read +22.5%, and the
  // off-model report put the entry at 7.4x over model — which was the model being
  // linear about a product, not the shelf getting away with something.
  //
  // The rocket entry still buys DELIVERY, and that has not changed either.

  // --- hull and hold ---------------------------------------------------------
  plating:  { name: 'Composite Plating', slot: 'tech', tier: 1, price: 6700,
              blurb: 'A third more hull, and slower with it.',
              mods: [['hull', 'mul', 0.35], ['speed', 'mul', -0.09]] },
  expander: { name: 'Hold Expander', slot: 'tech', tier: 1, price: 10100,
              blurb: 'Room for more ore, and slower with it.',
              mods: [['cargo', 'mul', 0.65], ['speed', 'mul', -0.12]] },
  bulkhead: { name: 'Refinery Bulkhead', slot: 'tech', tier: 2, price: 11100,
              blurb: 'Room made by taking out the frames that were holding you together.',
              mods: [['cargo', 'mul', 0.90], ['hull', 'mul', -0.25]] },
  lattice:  { name: 'Ablative Lattice', slot: 'tech', tier: 3, price: 14600,
              blurb: 'Half again as much ship, and it does not heal.',
              mods: [['hull', 'mul', 0.55], ['shieldRegen', 'mul', -0.60]] },

  // --- the reactor -----------------------------------------------------------
  // power.js normalises draw, so the duty cycle of a boost you cycle is
  // recharge/(1+recharge) — the CAPACITOR CANCELS OUT of it. The old Flywheel sold
  // a bigger tank as though that were more power; measured, a 55% larger capacitor
  // moved every hull's duty cycle by about one point. These three are the only
  // honest reactor trades there are: the floor, the period, and one long hold.
  trim:     { name: 'Cold-Running Trim', slot: 'tech', tier: 2, price: 8000,
              blurb: 'The reactor never quite lets go. It never quite fills, either.',
              mods: [['sustain', 'mul', 0.55], ['capacitor', 'mul', -0.40]] },
  exciter:  { name: 'Fast-Cycle Exciter', slot: 'tech', tier: 2, price: 8000,
              blurb: 'Half the tank, filled twice as often.',
              mods: [['recharge', 'mul', 0.60], ['capacitor', 'mul', -0.45]] },
  flywheel: { name: 'Reactor Flywheel', slot: 'tech', tier: 2, price: 8000,
              blurb: 'One very long hold, and a very long wait for the next.',
              mods: [['capacitor', 'mul', 0.90], ['recharge', 'mul', -0.40]] },

  // --- the shield clock ------------------------------------------------------
  // Not more shield: WHEN. Which of these two is right is arithmetic on the gap
  // between hits — regen x (gap - delay) — so they cross over, and where they cross
  // depends on the hull. Snap wins under about 6.7s of quiet on a Kestrel and
  // 13.4s on a Bulwark; the Exchanger wins above 9.2s and 18.4s.
  snap:      { name: 'Snap Regulator', slot: 'tech', tier: 2, price: 8000,
               blurb: 'It starts again the moment they look away. It just never hurries.',
               mods: [['shieldDelay', 'mul', -0.55], ['shieldRegen', 'mul', -0.45]] },
  exchanger: { name: 'Deep-Bank Exchanger', slot: 'tech', tier: 3, price: 9300,
               blurb: 'Twice the flow, once it has decided to start.',
               mods: [['shieldRegen', 'mul', 0.85], ['shieldDelay', 'mul', 0.60]] },

  // --- reach against legs ----------------------------------------------------
  // The two poles of kiting, and each is the other's price.
  spars:     { name: 'Kinetic Braking Spars', slot: 'tech', tier: 3, price: 9300,
               blurb: 'You reach further because you have stopped going anywhere.',
               mods: [['weaponRange', 'mul', 0.35], ['speed', 'mul', -0.28]] },
  interdict: { name: 'Interdiction Trim', slot: 'tech', tier: 3, price: 9300,
               blurb: 'You will get there first. You will have to.',
               mods: [['speed', 'mul', 0.22], ['weaponRange', 'mul', -0.35]] },
  // A bolt is LED, and displacement goes with the square of time — so acceleration
  // is the stat that dodges one and top speed is the stat that runs from it.
  vanes:     { name: 'Gravitic Vanes', slot: 'tech', tier: 2, price: 8000,
               blurb: 'You will not outrun it. You will not be where the bolt was, either.',
               mods: [['accel', 'mul', 0.50], ['speed', 'mul', -0.14]] },

  // --- rockets ---------------------------------------------------------------
  // launch() divides the volley across the count, so multiplying the COUNT alone
  // conserves total damage and splits it into more, lighter seekers. More of them
  // survive a Bandit's dropout; each one hurts less; and you burn half again as
  // many warheads. Delivery, not damage — which is the only rocket lever a fixed
  // price can hold.
  reloads:   { name: 'Racked Reloads', slot: 'tech', tier: 3, price: 11000,
               blurb: 'More of them, thrown from closer.',
               mods: [['rockets', 'mul', 0.50], ['weaponRange', 'mul', -0.20]] },

  // --- what you can see, and what can see you --------------------------------
  array:     { name: 'Long-Baseline Array', slot: 'tech', tier: 2, price: 8000,
               blurb: 'You will see them a long way off. They will still be a long way off.',
               mods: [['radar', 'mul', 0.55], ['weaponRange', 'mul', -0.25],
                      ['signature', 'mul', 0.60]] },
  // The old Damper bought a stat nothing in the game reads outside PvP and charged
  // a quarter of your radar for it — which also costs you salvage, since the server
  // filters pods by radar reach. It keeps the quiet and now also buys the thing a
  // quiet ship is actually doing: breaking contact and coming back whole.
  damper:    { name: 'Signal Damper', slot: 'tech', tier: 2, price: 8000,
               blurb: 'Hard to hold, quick to mend, and half blind.',
               mods: [['signature', 'mul', -0.55], ['shieldDelay', 'mul', -0.35],
                      ['radar', 'mul', -0.40]] },

  // --- the cadence -----------------------------------------------------------
  // The laser system finally gets what the rocket system already had. Racked
  // Reloads splits a volley into more, lighter seekers and conserves the damage
  // exactly, because launch() divides the volley across the count; these two do the
  // same thing to a bolt, because fire() divides a cycle's damage across the guns
  // and cycles at `fireRate`. x1.60 against x0.625 is 1.0000, so the dps a build
  // throws is unchanged to the last digit, at every rung of the ladder.
  //
  // What changes is the WINDOW. Two numbers are exact by construction: the first
  // bolt off a cold gun carries x1.60 with Siege and x0.625 with Rapid, and the wait
  // for the next cycle is 1.33s against 0.52s where stock is 0.83s. Measured with the
  // real fire()/stepBolts() loop against a stationary target, averaged over windows
  // of half a second to a second and a half so one bolt's rounding is not the answer,
  // Siege puts 7-17% more down inside one and Rapid 4-17% less, on every build tried
  // — and by thirty seconds all three are inside 5% of each other.
  //
  // So Siege is what you fit when the thing you are shooting is not going to stand
  // there, and Rapid is what you fit when you want the next bolt sooner.
  //
  // NOT an ammunition trade, though it looks like one: rounds are spent per bolt,
  // so Siege burns 37.5% fewer of them. Measured against earnings that is worth
  // between 1.5% (a new pilot on Standard Cells) and 0.1% (a finished ship on
  // Fusion) of what the same seconds pay in bounty. Ammunition is not a currency
  // anything can be balanced in, and saying so here is cheaper than someone
  // measuring it again.
  siege:     { name: 'Siege Cadence', slot: 'tech', tier: 3, price: 9300,
               blurb: 'Fewer bolts. Each one lands like a dropped anvil.',
               mods: [['damage', 'mul', 0.60], ['fireRate', 'mul', -0.375]] },
  rapid:     { name: 'Rapid Cadence', slot: 'tech', tier: 2, price: 8000,
               blurb: 'A thinner bolt, far more often. Nothing gets a rest.',
               mods: [['fireRate', 'mul', 0.60], ['damage', 'mul', -0.375]] },
  // The cross-system version: one dps product bought out of the other. A drone can
  // never carry a launcher, so the rack is capped at three however big the hull —
  // which is what stops this being a general damage multiplier. The more you have
  // spent on emitters, the more it costs you: 0.55 x ROCKET_RATE against 0.30 x
  // FIRE_RATE means it only pays once rocketVolley is worth more than about 1.2x
  // your bolt damage, and below that it is a straight loss. A pilot with no
  // launcher at all is simply buying -30% damage and nothing back.
  primacy:   { name: 'Launcher Primacy', slot: 'tech', tier: 2, price: 8000,
               blurb: 'The racks get the reactor. The guns get what is left.',
               mods: [['rocketVolley', 'mul', 0.55], ['damage', 'mul', -0.30]] },

  // --- the escort ------------------------------------------------------------
  // Nothing could touch the wing before this: FORMATIONS carried its own mods and
  // resolve() folded them in against a ramp nothing was allowed an opinion about.
  // Two attributes now carry it — `cohesion`, how many drones the formation needs
  // to pay in full, and `escort`, how hard it pays once it does — and these are the
  // two ends of it.
  //
  // They cross, and where they cross is the whole decision. Repeaters finish the
  // ramp early and add nothing once it is finished; Coupling lengthens the ramp and
  // pays 1.7x at the end of it. min(1, n/1) against min(1, n/6) x 1.7 means
  // Repeaters wins outright at one and two drones, both are exactly the stock
  // formation at three, and Coupling passes it at four.
  //
  // Coupling's price is in the guns and it has to be: the Attack Wedge multiplies
  // DAMAGE, so `escort` is a damage dial in disguise the moment a Wedge is flying
  // one. The offset is sized against the MARGINAL gain, not the whole bonus — the
  // Wedge already gives x1.12 and Coupling takes it to x1.204, which is x1.075 —
  // so x0.925 on the rate lands on 0.9944 and the escort shelf cannot sell you dps
  // whatever it does to the formation. Sized against the Wedge's 12% specifically:
  // a formation with a bigger damage mod would need it resized, and test/tech.mjs
  // checks every formation rather than trusting this comment.
  repeaters: { name: 'Wing Repeaters', slot: 'tech', tier: 1, price: 6700,
               blurb: 'One drone flies the formation like three. Three fly like three.',
               // -0.67 lands on 0.99 and the floor of 1 catches it; a formation that
               // paid in full with no escort at all is a formation with no escort in it.
               mods: [['cohesion', 'mul', -0.67], ['speed', 'mul', -0.14]] },
  coupling:  { name: 'Wing Coupling', slot: 'tech', tier: 3, price: 9300,
               blurb: 'A real wing flies half again as hard, and your guns pay the bill.',
               mods: [['escort', 'mul', 0.70], ['cohesion', 'mul', 1.00],
                      ['fireRate', 'mul', -0.075]] },

  // --- the fourth system -----------------------------------------------------
  // One pair per ability, and every one of them is dead weight on the three hulls
  // that do not have it — which is the point. These are the first technologies on
  // the shelf that are about which SHIP you fly rather than how much of it there is.
  //
  // All six are frontier stock, and deliberately: your company issues the hull with
  // its ability tuned the way the design intends, and retuning the thing that makes
  // a Kestrel a Kestrel is pirate work. Three of them push right up against ceilings
  // ability.js argues for out loud, and the ATTRS clamps are what stop them going
  // past.

  // Veil. Depth against rebuild, and the two cross at a stated cadence: mean
  // detection over a firing period is 1 - depth x (1 - rebuild/2T) once you shoot
  // less often than the rebuild, so 0.616/1.0s and 0.94/2.5s cross at
  //   T = (0.94x1.25 - 0.616x0.5) / (0.94 - 0.616) = 2.68s
  // between shots. Firing faster than one shot per 2.68s, the Governor hides you
  // better; slower, the Null Skin does. Holding fire entirely, the Skin is x0.06
  // against the Governor's x0.384 — six times harder to find.
  quicken:   { name: 'Fade Governor', slot: 'tech', tier: 3, price: 9300,
               blurb: 'A thinner veil that forgives you for shooting.',
               mods: [['veilRecover', 'mul', -0.60], ['veilDepth', 'mul', -0.30]] },
  // 0.88 -> 0.9416, which the 0.94 ceiling in ATTRS catches: detection x0.12 becomes
  // x0.06, so a Kestrel is found at half the range. The shields are what pays, and
  // a Kestrel has the fewest of them — that is the trade, not an accident.
  deepen:    { name: 'Null Skin', slot: 'tech', tier: 3, price: 9300,
               blurb: 'Twice as hard to find. Very little left to find.',
               mods: [['veilDepth', 'mul', 0.07], ['shield', 'mul', -0.35]] },

  // Anchor. Both halves come off the same dial in ability.js — you never get the
  // wall without the anchor — so a technology can only move the exchange rate.
  walk:      { name: 'Anchor Servos', slot: 'tech', tier: 3, price: 9300,
               blurb: 'A wall that can walk. Half a wall.',
               mods: [['anchorDrag', 'mul', -0.50], ['anchorSwell', 'mul', -0.50]] },
  // 3 -> 4.5, so shields swell x5.5 rather than x4, and drag 0.8 -> 0.95 leaves you
  // 5% of your speed. That is the ATTRS ceiling on drag, and it is there because a
  // ship at zero is repositioned only by whatever is shooting it.
  deepset:   { name: 'Keel Bracing', slot: 'tech', tier: 3, price: 9300,
               blurb: 'Five and a half times the shield. You are not going anywhere.',
               mods: [['anchorSwell', 'mul', 0.50], ['anchorDrag', 'mul', 0.1875]] },

  // Lock. reachOf is 1 - lockReach x drive, so these two move the cost of aiming
  // rather than the aim. At a full lock the Repeater keeps 89.5% of your reach
  // against the stock 65% — but 15% comes off the reach itself, so the ship is
  // worse whenever the lock is cold. Better locked, worse idle.
  standoff:  { name: 'Lock Repeater', slot: 'tech', tier: 3, price: 9300,
               blurb: 'Hold the lock from out here. Everything else got shorter.',
               mods: [['lockReach', 'mul', -0.70], ['weaponRange', 'mul', -0.15]] },
  // A bite of 1.8 reaches a perfect return at 56% of what the ability can deliver —
  // lockOf clamps at 1, so the rest of the reactor is free for the guns — and at
  // 0.556 the reach cost is 1 - 0.63x0.556 = 0.65, exactly what the stock lock costs
  // at FULL. Push it to full anyway and you are at 37% of your range, which is knife
  // work: the same lock for less reactor, or a much shorter one for the same.
  bite:      { name: 'Predictive Array', slot: 'tech', tier: 3, price: 9300,
               blurb: 'The lock bites at half the dial. Push it and you are inside their guns.',
               mods: [['lockTighten', 'mul', 0.80], ['lockReach', 'mul', 0.80]] },
};

// A collector lives in its own bay, not in a combat one. It used to sit in the
// drone rack, which meant buying a Scavenger Rig cost you a gun even with ten
// empty bays left — and since the reach below is a max rather than a sum, a
// second collector was never worth anything anyway. One rig, its own bay.
//
// It cannot simply be a free drone bay either: dronePrice(2) is 8200 and a
// Scavenger Rig is 5200, so a bay that came with a rig would be the cheap way to
// buy bays. This one only ever holds a collector.
export const isCollector = k => EQUIPMENT[k]?.kind === 'collector';
export const sanitiseRig = k => (isCollector(k) ? k : null);
export const collectorReach = rig => (isCollector(rig) ? EQUIPMENT[rig].reach : 0);

export const priceOf = key => EQUIPMENT[key]?.price ?? Infinity;

// The best thing money can currently buy for a slot. Everything that means "the
// top of the ladder" goes through this, so adding a rung moves every one of them
// at once instead of leaving a hardcoded MK-III behind.
export const topTier = slot => Object.keys(EQUIPMENT)
  .filter(k => EQUIPMENT[k].slot === slot)
  .sort((a, b) => (EQUIPMENT[a].tier ?? 0) - (EQUIPMENT[b].tier ?? 0) || EQUIPMENT[a].price - EQUIPMENT[b].price)
  .at(-1);
export const forSlot = slot => Object.entries(EQUIPMENT).filter(([, e]) => e.slot === slot);

// An empty rack, shaped by a hull's slot counts.
export const emptyFit = () => ({ weapon: [], generator: [], tech: [] });

// Anything reaching us from a client or a save file: keep only real items, in the
// right kind of slot, up to the number of slots the hull actually has.
export function sanitiseFit(slots, fit) {
  const out = emptyFit();
  for (const slot of SLOTS) {
    const want = Array.isArray(fit?.[slot]) ? fit[slot] : [];
    let keep = want.filter(k => EQUIPMENT[k]?.slot === slot);
    // Weapons and generators stack; a technology is either fitted or it is not.
    // Without that, an interceptor with three plating slots out-tanks a cruiser.
    if (slot === 'tech') keep = [...new Set(keep)];
    // Three launchers to a ship, however many weapon slots the hull has. They are
    // a commitment, not a thing you tile a Cruiser with.
    if (slot === 'weapon') {
      let pods = 0;
      keep = keep.filter(k => EQUIPMENT[k].kind !== 'rocket' || ++pods <= MAX_LAUNCHERS);
    }
    out[slot] = keep.slice(0, slots?.[slot] ?? 0);
  }
  return out;
}

export const UNIQUE_SLOTS = ['tech'];

export const fitCount = fit => SLOTS.reduce((n, s) => n + (fit?.[s]?.length ?? 0), 0);

// Changing hull can leave you with more fitted than the new rack holds. Whatever
// does not fit goes back into your locker rather than evaporating.
export function reseat(slots, fit, gear) {
  const kept = sanitiseFit(slots, fit), back = { ...gear };
  const before = fitList(fit), after = fitList(kept);
  for (const k of before) {
    const i = after.indexOf(k);
    if (i >= 0) after.splice(i, 1);
    else back[k] = (back[k] ?? 0) + 1;
  }
  return { fit: kept, gear: back };
}
export const fitList = fit => SLOTS.flatMap(s => fit?.[s] ?? []);

// Only real items, only as many as there are drones. A drone may hold anything,
// including a second of something the ship already has — except a technology,
// which stays unique across the whole ship-and-escort.
// `techCap` is how many technologies the SHIP may run in total, hull and escort
// together — normally slotsOf(hull).tech.
//
// It used to be uncapped, and only duplicates were refused. That made the escort a
// second technology rack: a Bulwark the shop says has one tech slot flew all four
// at once, and a twelve-drone Kestrel could have flown sixteen. Tech slots are
// meant to be the thing that makes an interceptor an interceptor, and they
// differentiated nothing at all. It is the same bug sanitiseFit already names one
// level down — "an interceptor with three plating slots out-tanks a cruiser" —
// and the answer is the same: the hull says how many, wherever they are mounted.
export function sanitiseDrones(list, fit, max = MAX_DRONES, techCap = Infinity) {
  const out = [];
  const techs = new Set(fit?.tech ?? []);
  for (const k of (Array.isArray(list) ? list : []).slice(0, max)) {
    if (k === null || !EQUIPMENT[k]) { out.push(null); continue; }
    if (EQUIPMENT[k].kind === 'rocket') { out.push(null); continue; }   // no rockets on a drone
    if (isCollector(k)) { out.push(null); continue; }                  // a rig has its own bay
    if (EQUIPMENT[k].slot === 'tech') {
      if (techs.has(k) || techs.size >= techCap) { out.push(null); continue; }
      techs.add(k);
    }
    out.push(k);
  }
  return out;
}

export const droneItems = drones => (drones ?? []).filter(Boolean);
