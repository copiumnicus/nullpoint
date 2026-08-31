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
// already has the most of the thing it scales. A test enforces the split.
//
// A technology is also the only kind of module that can carry a CAPABILITY — a
// rule that is true for a ship with it fitted and false for one without. `does`
// says what that is in a sentence the shop draws, and shared/tech.js implements
// it. Every one still gives something up, and a test still enforces that; what
// changed is that the thing given up no longer has to be a stat. See the
// technology block below, which argues all of this at length.

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

  // --- technologies ----------------------------------------------------------
  //
  // Twelve of them, and every one is a VERB.
  //
  // The shelf was twenty-six, and every single entry was a stat swap: a third
  // more hull for nine percent of your speed, half again your reach for a quarter
  // of your legs, fifty percent more thrust for fourteen percent of your top end.
  // Read as a list that is arithmetic homework, and the honest answer to most of
  // it is that it is a wash. The rule above — every technology must give
  // something up — had been read as "every technology is a paired stat penalty",
  // and THAT reading is what made the whole shelf feel like nothing worth buying.
  //
  // So an entry has to pass two tests now.
  //
  // ONE: you must be able to say what fitting it LETS YOU DO. `does` is that
  // sentence, and it lives on the entry rather than in a comment here because the
  // tooltip draws it — what you are buying is on the row, before you click.
  //
  // TWO: it has to be a TRADE a pilot can feel, and one they should take. The
  // shape asked for is "fifteen percent more damage output at the cost of ten
  // percent of the shields — a stat swap that is slightly positive EV", and the
  // two halves of that are both rules now, enforced in test/tech.mjs:
  //
  //   FELT      the gain is at least 15% of something. Nothing on this shelf
  //             moves a number by three percent; the smallest gain here is 45%.
  //   POSITIVE  the percentages you gain come to at least 1.5x the percentages
  //             you give up — which is exactly the 15-for-10 of the example. So
  //             fitting one is the right answer, and it is never free.
  //
  // What that shape could NOT be is the literal pairing, and it is worth writing
  // the measurement down because it looks so reasonable. Damage and shields grow
  // at wildly different rates: a rack moves shield by x3.00 and DAMAGE by x68 on a
  // Bulwark. Priced against every stage of the ladder, `damage x1.15, shield
  // x0.90` scores
  //
  //   arrival -23 points   anchor -9   interceptor +107   fighter +634
  //   cruiser +1,926       finished +4,451  (= 53,415 cr of capability at tier 2)
  //
  // — a DOWNGRADE for the pilot it would be priced for, and fifty thousand credits
  // of free capability for one who has finished. Same row, same price. So the
  // trades below pair terms that scale together: hull against speed, one dps term
  // against another, a hold against the hull it is fed to. The shape is the one
  // asked for; the pairings are the ones that survive being measured at both ends.
  //
  // Giving something up still holds and is still enforced. It just no longer has
  // to be a second number on the same line: `spends` names a cost that is not an
  // attribute — the ore in your hold, the charge in your reactor, hostiles
  // noticing you sooner — and shared/tech.js implements every one of them and
  // exports SPENDS, which test/tech.mjs checks the shelf against. A cost cannot
  // be a promise on a shop row with nothing behind it.
  //
  // WHAT WAS CUT, and why, because a deleted entry is a rule somebody dropped:
  //   Hold Expander, Refinery Bulkhead   the hold is grown by collector rigs,
  //     which ADD to it. A multiplier on it was a second, worse cargo ladder.
  //   Ablative Lattice                   merged into Composite Plating, which is
  //     now the entry about surviving a hit instead of two entries about hull.
  //   Cold-Running Trim, Fast-Cycle Exciter, Reactor Flywheel   three shapes of
  //     the same duty cycle. The Wake Tap replaces all three with a rule.
  //   Snap Regulator, Deep-Bank Exchanger  when your shields come back is
  //     arithmetic on the gap between hits, and nobody was doing that arithmetic.
  //   Kinetic Braking Spars, Interdiction Trim, Gravitic Vanes   reach against
  //     legs, three times over, and every one of them a wash.
  //   Long-Baseline Array, Signal Damper  radar up or radar down. The Aspect
  //     Filter is what a sensor technology is actually for.
  //   Racked Reloads                     more, lighter seekers. A number.
  //   Wing Coupling                      a multiplier on a multiplier on a
  //     formation; Wing Repeaters is the one with a shape.
  //   Fade Governor, Keel Bracing, Predictive Array   one technology per ability
  //     instead of two, and the survivor is the one that changes what the ability
  //     IS rather than moving its dial along.
  //
  // The damage rule is unchanged and still the reason the cadence shelf can
  // exist at all. A technology may multiply an attribute UP only where a rack
  // cannot already run away with it, and may multiply anything DOWN. Measured
  // spans: a rack moves hull, speed, radar, signature, range and rate by x1.00
  // and shield by x3.00 — but it moves DAMAGE by x68 on a Bulwark and x174 on a
  // Hauler, so a `damage x1.22` technology prices at 634 cr against a new pilot
  // and hands a finished ship 85,734 cr of capability.
  //
  // THE EXCEPTION, and it is the only one: a technology may multiply damage up if
  // what it multiplies DOWN is another term of a damage-per-second product.
  //
  //   dps = damage x fireRate  +  rocketVolley x ROCKET_RATE
  //
  // Pay for the product out of the product and BOTH sides grow x68, so the trade
  // a starter Hauler is offered and the trade a finished Bulwark is offered are
  // the same trade. balance.js scores the pair as a product for the same reason.
  //
  // PRICES. Almost everything here scores zero against the cost model — it has no
  // term for a reactor duty cycle, a shear margin, an ability dial or a thing you
  // are allowed to do — and balance.js says so for every one of them. They are
  // not priced at random even so: divide any of these by base x premiumAt(tier)
  // and the answer is the same number, which IS the shelf's rung for a technology
  // the model cannot read. 6,700 / 8,000 / 9,300 by tier. The one entry that
  // charges more is Composite Plating, and it charges exactly the rung PLUS the
  // hull the model CAN read: 7,971 + 3,900 = 11,871.

  // --- hull and hold ---------------------------------------------------------
  // Half again the hull for a fifth of your speed — and the killing blow takes the
  // plating instead of you. The old entry was +35% for -9%, which is the shape the
  // whole shelf was cut over: nine percent of your top speed is a number you
  // cannot feel, so the row read as a bonus nobody could price rather than a
  // decision. A fifth of your speed is a different ship. The save is once. It is
  // re-seated at a dock, so a pilot who never goes home never gets a second one,
  // and what it leaves you on is read off the cheapest kit in the shop rather
  // than picked — see PLATE_BACK in tech.js.
  plating:  { name: 'Composite Plating', slot: 'tech', tier: 2, price: 11900,
              does: 'Lets you survive the hit that would have killed you.',
              blurb: 'Half again the hull, a fifth off your speed, one free death.',
              mods: [['hull', 'mul', 0.50], ['speed', 'mul', -0.20]] },
  // Hull never comes back in the field. That is the rule this breaks, and it
  // breaks it with the one resource a pilot out there already has: ore.
  // A full hold mends a full hull, exactly, on every ship — see hullPerVol.
  foundry:  { name: 'Ore Foundry', slot: 'tech', tier: 2, price: 8000,
              does: 'Lets you mend your hull out of the ore you carry.',
              spends: 'hold',
              blurb: 'Plate made out of your own ore. A third less hold to make it in.',
              mods: [['hull', 'mul', 0.45], ['cargo', 'mul', -0.30]] },

  // --- the reactor -----------------------------------------------------------
  // The old reactor shelf was three arrangements of one duty cycle, and power.js
  // had already proved the interesting one impossible: the capacitor CANCELS OUT
  // of recharge/(1+recharge), so a bigger tank cannot buy uptime — which is why the
  // Reactor Flywheel sold a bigger tank and did nothing.
  //
  // This is the rule that replaces all three, and it is what makes a bigger tank
  // mean something at last: nearly twice the capacitor, and a refill rate cut to
  // less than half, so standing still is no longer how you get it back. A KILL is.
  // And what a kill hands back is exactly the seconds the fight took — an identity
  // out of balance.js rather than a number anybody chose. See wakeSeconds.
  waketap:  { name: 'Wake Tap', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you fight a whole wave on one tank of reactor.',
              spends: 'standdown',
              blurb: 'Nearly twice the tank, filled by killing rather than by waiting.',
              mods: [['capacitor', 'mul', 0.90], ['recharge', 'mul', -0.60]] },

  // --- outside the chart -----------------------------------------------------
  // 1800px of uncharted sky past every edge, 45 to 2000 hull/s of shear in it,
  // and nothing in the game touched any of it. This is the key to half of it: the
  // margin becomes ground you can cross, hold and fight on — and anything that
  // follows you out there has no compensator and is dying while it does.
  //
  // The shear itself is not on the row and cannot be — the sim has no attribute for
  // it — so this is the one entry with a third term the tooltip does not draw. What
  // is on the row is the trade you can see: half again the thrust for a third of
  // your sight, which is a real fight out there where a Bandit opens at 520px. What
  // is not on it is paid in reactor, and how much margin you get is how much charge
  // you have left, so the wall closes on you as the tank runs down.
  compensator: { name: 'Shear Compensator', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you fly and fight outside the charted sky.',
              spends: 'reactor',
              blurb: 'Half again the thrust, a third off your radar, and no shear.',
              mods: [['accel', 'mul', 0.55], ['radar', 'mul', -0.35]] },

  // --- what you can see, and what can see you --------------------------------
  // The old pair was radar up or radar down, and the Damper bought a stat nothing
  // outside PvP reads. This is what a sensor technology is for: it beats the one
  // thing in the game that hides, and it does it by shouting — so everything else
  // hears you first. Every hostile's aggro radius against you goes past SIGHT_R,
  // which means fights start off-screen. See LOUD in tech.js.
  filter:   { name: 'Aspect Filter', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you see a Bandit from any angle it faces.',
              spends: 'attention',
              blurb: 'Twice the reach, and everything out there hears you coming.',
              mods: [['radar', 'mul', 0.90], ['signature', 'mul', 0.60]] },

  // --- the cadence -----------------------------------------------------------
  // x1.60 damage against x0.625 rate is 1.0000, so the dps a build throws is
  // unchanged to the last digit at every rung of the ladder. What changes is the
  // WINDOW: the first bolt off a cold gun carries x1.60 with Siege and x0.625
  // with Rapid, and the wait for the next cycle is 1.33s against 0.52s where
  // stock is 0.83s. Measured with the real fire()/stepBolts() loop against a
  // stationary target and averaged over windows of half a second to a second and
  // a half, Siege puts 7-17% more down inside one and Rapid 4-17% less, on every
  // build tried — and by thirty seconds all three are inside 5% of each other.
  //
  // NOT an ammunition trade, though it looks like one: Siege burns 37.5% fewer
  // rounds, and measured against earnings that is between 1.5% (a new pilot on
  // Standard Cells) and 0.1% (a finished ship on Fusion) of what the same seconds
  // pay in bounty. Saying so here is cheaper than someone measuring it again.
  siege:    { name: 'Siege Cadence', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you land a fight\'s worth of damage at once.',
              blurb: 'Fewer bolts. Each one lands like a dropped anvil.',
              mods: [['damage', 'mul', 0.60], ['fireRate', 'mul', -0.375]] },
  rapid:    { name: 'Rapid Cadence', slot: 'tech', tier: 2, price: 8000,
              does: 'Lets you keep fire on something that never rests.',
              blurb: 'A thinner bolt, far more often. Nothing gets a rest.',
              mods: [['fireRate', 'mul', 0.60], ['damage', 'mul', -0.375]] },
  // The cross-system version: one dps product bought out of the other. A drone
  // can never carry a launcher, so the rack is capped at three however big the
  // hull — which is what stops this being a general damage multiplier. Measured:
  // +25% on a Hauler with one Sparrow Pod, +33% on a Bulwark with three Swarm
  // Racks, -12% on the same Bulwark once twelve drones are carrying emitters, and
  // a flat -30% for anyone with no rack at all. It only pays the build that gave
  // something up to earn it.
  primacy:  { name: 'Launcher Primacy', slot: 'tech', tier: 2, price: 8000,
              does: 'Lets you fly a ship that is all racks and no guns.',
              blurb: 'The racks get the reactor. The guns get what is left.',
              mods: [['rocketVolley', 'mul', 0.55], ['damage', 'mul', -0.30]] },

  // --- the escort ------------------------------------------------------------
  // `cohesion` is how many drones a formation needs before it pays in full.
  // Cutting it is worth everything to a pilot with one drone and NOTHING to one
  // with twelve, because the ramp is already finished — the only entry on this
  // shelf that is worth less the bigger you get, which is why it survived the cut
  // and Wing Coupling did not. -0.67 lands on 0.99 and the floor of 1 catches it;
  // a formation that paid in full with no escort at all is a formation with no
  // escort in it.
  repeaters: { name: 'Wing Repeaters', slot: 'tech', tier: 1, price: 6700,
              does: 'Lets you fly a full formation off a single drone.',
              blurb: 'One drone flies the formation like three. It costs you legs.',
              mods: [['cohesion', 'mul', -0.67], ['speed', 'mul', -0.14]] },

  // --- the fourth system -----------------------------------------------------
  // One per ability, and each one is dead weight on the three hulls that do not
  // have it — which is the point. These are the entries that are about which SHIP
  // you fly rather than how much of it there is, and each survivor is the one of
  // its old pair that changes what the ability IS rather than sliding its dial.
  //
  // All three are frontier stock, deliberately: your company issues the hull with
  // its ability tuned the way the design intends, and retuning the thing that
  // makes a Kestrel a Kestrel is pirate work.

  // 0.88 -> 0.9416, which the 0.94 ceiling in ATTRS catches: detection x0.12
  // becomes x0.06. At 2600px of radar that is being found at 156px, which is
  // knife range — a Kestrel with this fitted crosses a sector nobody plots. The
  // shields pay for it, and a Kestrel has the fewest of them.
  deepen:   { name: 'Null Skin', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you cross a sector without ever being found.',
              blurb: 'Half the range they find you at. A third of your shields.',
              mods: [['veilDepth', 'mul', 0.07], ['signature', 'mul', -0.55],
                     ['shield', 'mul', -0.35]] },
  // Both halves of an Anchor come off the same dial — you never get the wall
  // without the anchor — so a technology can only move the exchange rate. Stock
  // is x4 shields at a fifth of your speed, which is a wall. This is x2.5 at
  // three fifths, which is a ship that can hold the ability through a chase.
  walk:     { name: 'Anchor Servos', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you hold an Anchor and still go somewhere.',
              blurb: 'A wall that can walk, at two thirds of the wall.',
              mods: [['anchorDrag', 'mul', -0.60], ['anchorSwell', 'mul', -0.40]] },
  // reachOf is 1 - lockReach x drive, so this moves the cost of aiming rather
  // than the aim. At a full lock it keeps 89.5% of your reach against the stock
  // 65% — but 15% comes off the reach itself, so the ship is worse whenever the
  // lock is cold. Better locked, worse idle.
  standoff: { name: 'Lock Repeater', slot: 'tech', tier: 3, price: 9300,
              does: 'Lets you hold a perfect Lock from out of reach.',
              blurb: 'The lock costs you almost no reach. The reach got shorter.',
              mods: [['lockReach', 'mul', -0.85], ['weaponRange', 'mul', -0.15]] },
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
    // How many launchers this hull may fly, which is no longer three for everyone.
    // The cap rides on the slot record (see slotsOf) because gear.js imports
    // nothing and must not learn about hulls; MAX_LAUNCHERS is the default any
    // hull gets by saying nothing, and the Vanguard is the one that speaks up.
    //
    // The old flat three existed because the Cruiser had the most hardpoints and
    // would otherwise have been tiled with racks. The Cruiser still has four and
    // the Fighter now has five, so the slot table already does most of that job
    // and the cap's remaining work is to PERMIT the Vanguard's fourth and fifth.
    if (slot === 'weapon') {
      let pods = 0, cap = slots?.launchers ?? MAX_LAUNCHERS;
      keep = keep.filter(k => EQUIPMENT[k].kind !== 'rocket' || ++pods <= cap);
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

// Every technology this ship is flying, rack and escort together. It lives here
// rather than in tech.js because it is a fact about a FIT, and gear.js is the
// only file with no imports at all — which is what lets sim.js stamp it onto a
// ship without dragging the whole capability layer in behind it.
//
// A technology on a drone counts exactly as much as one in the rack. That is the
// same rule sanitiseDrones enforces from the other side: the hull says how many
// you may fly, wherever they happen to be mounted.
export const techSet = (fit, drones = []) => new Set(
  [...(fit?.tech ?? []), ...droneItems(drones)].filter(k => EQUIPMENT[k]?.slot === 'tech'));
