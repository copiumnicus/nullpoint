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

export function frontierOnly(key) {
  const e = EQUIPMENT[key];
  if (!e) return false;
  const ladder = e.slot === 'tech' ? 'tech' : e.kind === 'rocket' ? 'rocket' : 'laser';
  const cut = FRONTIER[ladder];
  return cut !== undefined && (e.tier ?? 0) >= cut;
}

// Why this pilot cannot buy this here, or null. `berth` is whether they are stood
// at an outpost bay they rent; `docked` is their own company ring.
export function whyNotSold(key, { docked = false, berth = false } = {}) {
  if (!EQUIPMENT[key]) return 'no such thing';
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
  // DAMAGE by x68. A benefit that grows sixty-eight times with your guns cannot
  // keep a fixed price: a `damage x1.22` technology prices at 462 cr against a new
  // pilot and hands a finished ship 71,445 cr of capability. That is why there is
  // no damage technology and no rocketVolley technology on this shelf, and why the
  // rocket entry below buys DELIVERY instead. All four of the originals already
  // obeyed this; nobody had written it down.

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
