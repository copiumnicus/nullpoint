// Ships, attributes and fitting.
//
// Nothing reads a stat off a hull directly. Every stat goes through resolve(),
// which folds the hull's base values together with whatever is fitted. Adding a
// new attribute means adding one line to ATTRS; adding a new module means one
// entry in MODULES. No other file changes.

import { EQUIPMENT, emptyFit, fitList, droneItems, sanitiseFit as cleanFit,
         isCollector, MAX_LAUNCHERS, MAX_DRONES } from './gear.js';
import { FORMATIONS, DEFAULT_FORMATION, BONUS_AT, escortScale } from './formation.js';
import { BOOST } from './power.js';
// The shipped setting of each ability, imported rather than restated: these are
// the DEFAULTS of six ATTRS rows, so a technology can retune an ability the same
// way one retunes a shield clock. ability.js argues every one of the numbers and
// every one of the ceilings below; see its comments before moving one.
import { VEIL_DEPTH, VEIL_RECOVER, ANCHOR_SWELL, ANCHOR_DRAG, DRUMFIRE_GAIN, DRUMFIRE_REACH }
  from './ability.js';

// One cycle rate for every hull, on purpose. Emitters add FLAT damage to a bolt
// and the rate multiplies the lot, so a hull that fired faster multiplied every
// emitter harder — a fully specced Bulwark ended up behind the free starter, and
// weapon slots stopped meaning anything. Hulls differ by base damage, reach and
// how many hardpoints they carry; not by how fast the trigger works.
export const FIRE_RATE = 1.2;

// A hull's own guns are worth one MK-I Emitter per hardpoint, and that is where
// every purchasable hull's base damage comes from: 19 x weapon slots. Read off the
// Kestrel, which already carried 38 across two mounts, and one point over the
// MK-I's 18 so the integral guns are worth having.
//
// It stops base damage pretending to differentiate. Measured on the shipped game,
// a finished ship's damage is 0.9%-2.1% its chassis and 98%+ its rack, while its
// hull is 70.4% chassis all the way up — because nothing in the shop ADDS hull,
// it only multiplies it. So a hull that carried more base damage than its
// hardpoints justify was quietly claiming an advantage its first emitter erased,
// and the bare spread it claimed it with (3.17x) collapsed to 1.45x once fitted.
// Derived, "more hardpoints means more damage" is arithmetic instead of luck.
//
// The Hauler is the exception and has to be: balance.js's ANCHOR is a Hauler with
// one MK-I, its 74.88 dps is the zero point of every bounty, ammunition price and
// hostile in the game, and moving it re-prices the economy. Its single hardpoint
// stays worth 30.
export const DAMAGE_PER_HARDPOINT = 19;

export const ATTRS = {
  hull:        { label: 'Hull',         unit: '',    dflt: 1000, better: 'high', min: 1 },
  shield:      { label: 'Shield',       unit: '',    dflt:  800, better: 'high', min: 0 },
  // A SHARE of the shield pool per second, not an amount.
  //
  // It was an amount, and an amount cannot survive a game where the pool grows. A
  // finished Bulwark carries 4,200 shield and refilled it in 168 seconds; with the
  // research ladder's x32 it carries 134,400 and took 5,376 — ninety minutes, which
  // is not a slow regeneration, it is no regeneration with extra steps.
  //
  // Every hull's fraction is its old number over its own bare shield, so a hull
  // refills in exactly the seconds it always did and now keeps that number however
  // large the pool gets. The hull beside it already worked this way — DOCK_HULL_RATE
  // is a share — so this is the shield catching up with it.
  shieldRegen: { label: 'Shield regen', unit: '%/s', dflt: 0.05, better: 'high', min: 0, pct: true },
  shieldDelay: { label: 'Regen delay',  unit: 's',   dflt:    6, better: 'low',  min: 0.5 },
  speed:       { label: 'Speed',        unit: '',    dflt:  340, better: 'high', min: 40 },
  accel:       { label: 'Thrust',       unit: '',    dflt: 1200, better: 'high', min: 100 },
  radar:       { label: 'Radar range',  unit: '',    dflt: 2600, better: 'high', min: 300 },
  signature:   { label: 'Signature',    unit: 's',   dflt:    3, better: 'low',  min: 0.4 },
  damage:      { label: 'Damage',       unit: '',    dflt:   55, better: 'high', min: 1 },
  fireRate:    { label: 'Rate of fire', unit: '/s',  dflt: FIRE_RATE, better: 'high', min: 0.1 },
  weaponRange: { label: 'Weapon range', unit: '',    dflt:  700, better: 'high', min: 100 },
  cargo:       { label: 'Cargo hold',   unit: '',    dflt:   60, better: 'high', min: 0 },
  capacitor:   { label: 'Capacitor',    unit: 's',   dflt:   45, better: 'high', min: 1 },
  recharge:    { label: 'Recharge',     unit: '/s',  dflt:  1.8, better: 'high', min: 0.1 },
  sustain:     { label: 'Free output',  unit: '',    dflt: 0.33, better: 'high', min: 0, max: 0.9 },
  // ONE ROCKET PER RACK, and it is derived rather than fitted — see resolve(),
  // which sets it from how many launchers are actually mounted and lets no mod
  // near it. A rack's TIER buys damage per rocket; it never buys count. Five
  // Cyclone Racks on a Vanguard are five rockets, not thirty-five.
  //
  // It stays in ATTRS because the stat page, the breakdown and the shop tip all
  // read it like any other row. Nothing may FIT it, which is why resolve() writes
  // it beside `boost` and `berths` rather than in the mod loop.
  rockets:     { label: 'Rockets',      unit: '',    dflt:    0, better: 'high', min: 0 },
  // Declared per RACK, and a rack throws one rocket — so this is what one rocket
  // carries, and the ship-wide number is what the whole volley lands. Two racks of
  // the same model land that rocket twice rather than one twice as hard, which is
  // the same sentence it has always been; what changed is that the second rocket
  // is a second RAIL rather than a seventh of a fan.
  rocketVolley:{ label: 'Rocket volley', unit: '',   dflt:    0, better: 'high', min: 0 },

  // --- the escort ------------------------------------------------------------
  // How many drones the formation needs before it pays in full, and how hard it
  // pays once it does. formation.js argues the split; BONUS_AT is the default of
  // the first and 1 is the default of the second, so a ship with nothing fitted
  // flies exactly the escort it always did.
  //
  // `escort` is capped, and the cap is not decoration: the Attack Wedge multiplies
  // DAMAGE, so an uncapped escort dial is an uncapped damage dial wearing a hat.
  cohesion:    { label: 'Formation at', unit: ' drones', dflt: BONUS_AT, better: 'low', min: 1 },
  escort:      { label: 'Escort bonus', unit: 'x',   dflt: 1, better: 'high', min: 0, max: 2 },

  // --- the fourth system -----------------------------------------------------
  // The hull's own ability, one row per dial. Only the hull that HAS the ability
  // reads them — a Veil depth on a Bulwark is a number nothing looks at — which
  // is what makes these the shelf's first class-specific technologies.
  //
  // Every ceiling is ability.js's argument, not a round number. 0.94 leaves a
  // Kestrel findable at 6% of your radar instead of 12%, and a veil deeper than
  // that is not stealth, it is an exit from the game.
  veilDepth:   { label: 'Veil depth',   unit: '',    dflt: VEIL_DEPTH,   better: 'high', min: 0,   max: 0.94 },
  veilRecover: { label: 'Veil rebuild', unit: 's',   dflt: VEIL_RECOVER, better: 'low',  min: 0.4 },
  anchorSwell: { label: 'Anchor swell', unit: 'x',   dflt: ANCHOR_SWELL, better: 'high', min: 0,   max: 5 },
  anchorDrag:  { label: 'Anchor drag',  unit: '',    dflt: ANCHOR_DRAG,  better: 'low',  min: 0.1, max: 0.95 },
  // The gain's ceiling is the design target doubled. ability.js solves the shipped
  // setting from "a full drum throws twice what an interceptor does with its
  // reactor on its guns" — x2.50 — so the exit from the game is the drum that
  // throws FOUR times an interceptor: 2 x 2.5066 = x5.01 of the cycle, and the dial
  // is that minus one. Past there the reactor is worth more than the rest of the
  // ship and the fighter stops being a class.
  //
  // The two rows were one number twice while the gain was 1/(1 - cost) - 1; they
  // are independent now, and the reach floor carries its own argument: 20% of a
  // Vanguard's 700 is 140px, which is inside the hull radius and the 38px of slack
  // around an aim point for most of the bestiary — a reach you cannot miss from is
  // not a reach.
  drumfireGain: { label: 'Drumfire gain', unit: 'x', dflt: DRUMFIRE_GAIN,  better: 'high', min: 0,
                  max: 4 },
  drumfireReach:{ label: 'Drumfire cost', unit: '',  dflt: DRUMFIRE_REACH, better: 'low',  min: 0,
                  max: 0.8 },
};

// Every hull carries the same total number of MOUNTS — its own slots plus its
// drone bays — and the bigger the hull, the more of them are welded in place.
//
// The old rule was "the same total SLOTS, distributed differently", and it was
// counting the wrong thing. A drone bay takes any weapon or any generator, so
// twelve free-form bays sat alongside seven fixed slots and the escort simply
// re-balanced around whatever the hull's rack happened to be. Measured, at the top
// of both ladders with the escort optimised for each hull: W5G1T1 scores 5.09,
// W3G2T2 4.42 and W1G4T2 5.14 — the slot SPLIT is worth about 2%. What the hull
// actually owns is how many mounts exist at all, and the two kinds of mount a
// drone can never stand in for: a launcher (sanitiseDrones refuses one) and a
// technology (capped ship-wide at slots.tech).
//
// So: nineteen mounts each, set by the Kestrel — the seven slots and twelve bays
// it already had. Each step up the price ladder welds one more bay into the
// hull, and a hull spends what it welds in, plus its spare technology bays, on
// the one thing it is for. Bays are still bought and still owned; a hull with
// fewer berths flies fewer of them, and the rest wait in the hangar.
export const HULLS = {
  // The one you start with. Visibly worse at everything that wins a fight, but
  // nimble, quiet and roomy enough to earn the price of a real ship.
  hauler:   { slots: { weapon: 1, generator: 1, tech: 1 }, bays: 12, price: 0,
              name: 'Hauler', cls: 'Tender', r: 12,
              blurb: 'The starter. The biggest hold, the weakest guns.',
              attrs: { hull: 650, shield: 450, shieldRegen: 0.0667, shieldDelay: 6, speed: 300, accel: 1000,
                       radar: 2200, signature: 3.5, damage: 30, fireRate: FIRE_RATE, weaponRange: 640,
                       cargo: 90, capacitor: 30, recharge: 1.5, sustain: 0.30 } },

  // Radar deliberately runs WITH size: a big hull carries a big sensor array but
  // cannot shake anyone, a small one is a ghost that is half blind.
  kestrel:  { ability: 'veil', slots: { weapon: 2, generator: 2, tech: 3 }, bays: 12, price: 18000,
              name: 'Kestrel', cls: 'Interceptor', r: 10,
              blurb: 'Fastest and quietest. It cannot take a beating.',
              attrs: { hull: 700, shield: 500, shieldRegen: 0.12, shieldDelay: 4, speed: 430, accel: 1600,
                       radar: 2000, signature: 1.5, damage: 38, fireRate: FIRE_RATE, weaponRange: 620,
                       cargo: 30, capacitor: 45, recharge: 2.2, sustain: 0.33 } },
  // The gun platform, and the only hull that can fill every hardpoint with a
  // rack. Five is not a round number: it is the Kestrel's two plus the two
  // technology bays it gives up plus the one bay it welds in, and it is the whole
  // reason the slots matter — a launcher is the one module a drone may never
  // carry, so five hardpoints of rockets is capability nothing else can buy.
  vanguard: { ability: 'drumfire', slots: { weapon: 5, generator: 2, tech: 1 }, bays: 11, launchers: 5, price: 26000,
              name: 'Vanguard', cls: 'Fighter', r: 13,
              blurb: 'Five hardpoints, and it may fill all five with racks.',
              attrs: { hull: 1100, shield: 900, shieldRegen: 0.0444, shieldDelay: 6, speed: 340, accel: 1200,
                       radar: 2600, signature: 3.0, damage: 95, fireRate: FIRE_RATE, weaponRange: 700,
                       cargo: 60, capacitor: 45, recharge: 1.8, sustain: 0.33 } },
  // The wall: half again the generators of anything else, two technology bays, and
  // the only shield in the game that comes back inside a patrol.
  //
  // THREE generators, not four or five, and the ceiling is the game's own. A
  // finished Bulwark must survive between 60% and 100% of what parking in a full
  // Corsair brood costs — test/research.mjs, "so you still have to fly". Measured
  // at every base shield from 1400 down to 700: G2 is 75%, G3 is 92%, and G4 is
  // 109% at 1400 and still 101% at 700. Four generator bays is a ship that can
  // hold the trigger in the hardest content in the game and walk away, which is
  // the one thing the research ladder was explicitly built not to sell.
  //
  // Its regeneration was 0.0179/s: 56 seconds to refill, against 8, 15 and 22 on
  // the other three. Three hulls sit on a straight ladder seven seconds apart and
  // the fourth is two and a half times off the end of it — so the ship named for
  // absorbing damage was the one that could never get any of it back. 30s is where
  // that ladder actually goes. It costs nothing in a duel: the clock only runs
  // after shieldDelay untouched, so this is hit points per patrol, not per fight.
  bulwark:  { ability: 'anchor', slots: { weapon: 4, generator: 3, tech: 2 }, bays: 10, price: 40000,
              name: 'Bulwark', cls: 'Cruiser', r: 17,
              blurb: 'Twice the generators, and shields that come back.',
              attrs: { hull: 1900, shield: 1400, shieldRegen: 0.0333, shieldDelay: 6, speed: 250, accel: 800,
                       radar: 3400, signature: 5.5, damage: 76, fireRate: FIRE_RATE, weaponRange: 820,
                       cargo: 120, capacitor: 60, recharge: 1.5, sustain: 0.36 } },
};
export const DEFAULT_HULL = 'hauler';


// The rack a hull carries, and the launcher cap travels WITH it.
//
// It has to. sanitiseFit is in gear.js, which imports nothing at all on purpose,
// so it cannot ask HULLS how many launchers this hull may fly — and a defaulted
// cap would be the workshop-dock bug again: the shop counter saying "full at
// three" while the server happily seats a fourth. Hanging `launchers` on the slot
// record means every existing `sanitiseFit(slotsOf(h), fit)` and
// `reseat(slotsOf(h), ...)` call site gets the right answer with no edit, and
// SLOTS is what everything else iterates, so the extra key is inert.
export const slotsOf  = hullKey => {
  const h = HULLS[hullKey] ?? HULLS[DEFAULT_HULL];
  return { ...h.slots, launchers: h.launchers ?? MAX_LAUNCHERS };
};
// Berths, not bays owned. A pilot keeps every bay they paid for; the hull says how
// many of them fly. Switching to a smaller hull parks the surplus in the hangar
// instead of deleting a purchase, and switching back brings them out again.
//
// `extra` is what a pilot has EARNED on top — the Brood Frame is two more berths for
// a hundred Corsair Hives, see shared/quests.js. It defaults to zero, and the default
// is load-bearing rather than lazy: every caller that is asking about a HULL rather
// than about a pilot (the shop tooltip, the hull comparison, the mounts invariant in
// test/ships.mjs) keeps asking the same question and getting the same answer. Only
// the callers that hold a specific pilot's `unlocked` list pass the second argument,
// which is exactly the set of places a bonus berth is real.
export const baysOf = (hullKey, extra = 0) =>
  ((HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).bays ?? MAX_DRONES) + Math.max(0, Math.floor(extra) || 0);

// The escort this hull actually flies, out of the bays a pilot owns.
//
// Applied inside resolve() rather than at each caller because resolve is the one
// funnel both sides run, and a pilot whose Bulwark berths ten reading a
// twelve-drone stat panel is the same class of bug as a client with its own copy
// of canDock(). Nothing a pilot paid for is destroyed: the bays stay bought and
// the surplus waits in the hangar until they fly something with room for it.
//
// A rig is exempt, and that is not a nicety. sim.js's escortOf() appends the
// collector AFTER the escort, so a plain slice(0, bays) would eat the rig of any
// pilot whose bays are full — a Bulwark with ten drones and a Scavenger silently
// losing 40 of hold, with the panel and the server agreeing about it. A rig has
// its own bay (sanitiseDrones refuses one in the rack), so it does not spend a
// berth. Empty bays still count: an empty berth is a berth.
export const berthed = (hullKey, drones = [], extra = 0) => {
  const n = baysOf(hullKey, extra);
  let seated = 0;
  return (drones ?? []).filter(k => isCollector(k) || ++seated <= n);
};
export const radiusOf = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).r;
export const hullPrice = hullKey => HULLS[hullKey]?.price ?? Infinity;

// Every emitter is a gun in its own right, wherever it is mounted.
// Lasers only. A launcher sits in a weapon slot but is not a barrel, and counting
// it as one would split the rack's bolt damage across guns that never fire a bolt.
const isLaser = k => EQUIPMENT[k]?.slot === 'weapon' && EQUIPMENT[k]?.kind !== 'rocket';
export const gunsOf = (fit, drones = []) =>
  Math.max(1, (fit?.weapon ?? []).filter(isLaser).length +
              droneItems(drones).filter(isLaser).length);
export const sanitiseFit = (hullKey, fit) => cleanFit(slotsOf(hullKey), fit);

// base + every flat add, then multiplied by the PRODUCT of the percentages.
//
// It summed them, and two technologies whose trades were opposites annihilated
// each other. Siege Cadence is +60% damage for -37.5% rate and Rapid Cadence is
// the same trade backwards; summed, both land as 1 + (0.60 - 0.375) = x1.225 on
// BOTH numbers, so the pair was a free x1.50 on damage output with nothing given
// up at all. Measured by sweeping every legal fit in the game: 16,967 dps on a
// Bulwark carrying the two, against 11,306.59 for the top of the ladder — 50%
// more than the sharpest gun the shop is supposed to sell, which is also what the
// Thresher's mirror quotes as its ceiling. x1.60 against x0.625 is 1.0000, and
// that is what these two lines now say.
//
// Summing was there to stop three copies of a module being worth more than three
// times one. That reason no longer applies to anything that MULTIPLIES: `mul` is
// technology-only by rule, and a technology is unique across the whole ship —
// sanitiseFit dedupes the rack and sanitiseDrones refuses a second copy on the
// escort. Weapons and generators, the two kinds you can stack, are `add`-only and
// never touch this path. So the only things composing here are distinct
// technologies and the one formation being flown, and compounding is simply what
// "+60%" and "-37.5%" mean.
export function resolve(hullKey, fit = emptyFit(), drones = [], formation = DEFAULT_FORMATION, extra = 0) {
  const hull = HULLS[hullKey] ?? HULLS[DEFAULT_HULL];
  drones = berthed(hullKey, drones, extra);
  const out = {}, pct = {};
  for (const [k, a] of Object.entries(ATTRS)) out[k] = hull.attrs[k] ?? a.dflt;

  // How many launchers are actually mounted, counted in the same pass that reads
  // their mods so the two can never be looking at different fits. See `out.rockets`
  // at the bottom: the COUNT is this number and nothing else may touch it.
  let racks = 0;
  for (const key of [...fitList(fit), ...droneItems(drones)]) {
    if (EQUIPMENT[key]?.kind === 'rocket') racks++;
    for (const [attr, op, v] of EQUIPMENT[key]?.mods ?? []) {
      if (!(attr in out)) continue;                       // unknown attribute: ignore, never crash
      if (op === 'add') out[attr] += v;
      else              pct[attr] = (pct[attr] ?? 1) * (1 + v);
    }
  }
  // A formation only pays out once there is an escort to fly it, and pays in full
  // at `cohesion` drones — three, unless something fitted says otherwise.
  //
  // The escort dials have to be SETTLED before the formation is folded in. They
  // are multipliers on the bonus, and the bonus arrives as entries in `pct` that
  // are not multiplied by anything until the loop below — so reading them off
  // `out` after that loop would apply the technology to a number that had already
  // been spent, and reading them before it would ignore the technology entirely.
  // Resolved here, removed from `pct`, and clamped once: the same two steps the
  // final loop does, taken early because this pair is an input to it.
  for (const k of ['cohesion', 'escort']) {
    if (k in pct) { out[k] *= pct[k]; delete pct[k]; }
    out[k] = Math.min(ATTRS[k].max ?? Infinity, Math.max(ATTRS[k].min ?? 0, out[k]));
  }
  const scale = escortScale((drones ?? []).length, out);
  if (scale > 0) for (const [attr, op, v] of FORMATIONS[formation]?.mods ?? []) {
    if (!(attr in out)) continue;
    if (op === 'add') out[attr] += v * scale;
    else              pct[attr] = (pct[attr] ?? 1) * (1 + v * scale);
  }

  for (const [attr, p] of Object.entries(pct)) out[attr] *= p;
  for (const k of Object.keys(out))
    out[k] = Math.min(ATTRS[k].max ?? Infinity, Math.max(ATTRS[k].min ?? 0, out[k]));

  // What a generator takes in speed, it gives back as reactor headroom.
  //
  // A generator is a straight trade: shields and capacitor for thrust. But the
  // reactor it enlarges could only ever pay out BOOST, a flat 30%, so fitting one
  // made every routing decision a little worse as well — you were slower, and
  // routing to thrusters could not get you back to where you started.
  //
  // The ceiling now rises by the same fraction of your hull's speed that the
  // generators cost you. Fit 3% of your speed away and the ceiling is 33%, so
  // routing to thrusters is roughly break-even and routing to weapons or shields
  // is worth 3% more than it was. It is not free: the headroom only pays while
  // you are spending capacitor, which is exactly what a bigger reactor is for.
  //
  // Measured against the hull's bare speed rather than the resolved one, so
  // stacking generators cannot compound — two cells that each cost 3% raise the
  // ceiling by 6%, not by 6.09%.
  let lost = 0;
  for (const key of [...fitList(fit), ...droneItems(drones)]) {
    if (EQUIPMENT[key]?.slot !== 'generator') continue;
    for (const [attr, op, v] of EQUIPMENT[key].mods ?? [])
      if (attr === 'speed' && op === 'add' && v < 0) lost -= v;
  }
  const bare = hull.attrs.speed ?? ATTRS.speed.dflt;
  // You cannot give up more speed than you have. Speed is clamped at ATTRS.speed.min
  // on the way out, so past that floor a generator costs you nothing further —
  // but `lost` went on summing, and the ceiling went on rising for it. A Bulwark
  // with two fitted E-Cells and twelve more on drones sat at the 40px/s floor
  // banking a 198% ceiling: a 2.98x reactor bought with speed it had already
  // spent. Clamped to what was actually surrendered, the same build reads 114%.
  const givable = Math.max(0, bare - (ATTRS.speed.min ?? 0));
  out.boost = BOOST + (bare > 0 ? Math.min(lost, givable) / bare : 0);
  // How many berths this ship actually has, earned ones included. Set here beside
  // `boost` and for the same reason: both are OUTCOMES rather than dials, so neither
  // is in ATTRS — and both have to be set AFTER the clamp loop above, which looks
  // every key of `out` up in ATTRS and throws on one that is not there.
  //
  // It is on the stat block because it is the only place a pilot can be shown where
  // two extra bays came from. shared/breakdown.js draws it as the fifth layer.
  out.berths = baysOf(hullKey, extra);
  // ONE ROCKET PER RACK. Written here, last, and deliberately not as a mod.
  //
  // It used to be `['rockets','add',7]` on the Cyclone Rack and 1/3/5 on the three
  // below it, which made "a better launcher throws more of them" a property of four
  // numbers rather than a rule: five Cyclones on a Vanguard came out at 35 rockets a
  // volley, sharing 9,150 damage 261 at a time, and past two racks nobody could
  // count what was in the air. Fitting a fifth rack now adds a fifth ROCKET, and the
  // rung you bought decides how hard that one rocket lands.
  //
  // Derived rather than added so a rack CANNOT break it by carrying the wrong mod —
  // that is the whole reason it moved. It is written after the `pct` loop as well,
  // so no technology and no formation can multiply a count: the fan is the number of
  // things you bolted on, and a percentage of a rocket is not a thing.
  //
  // Aliens are untouched: they never go through resolve(), they declare `rockets`
  // on their own stat block, and a hostile fan is a fact about that hostile.
  out.rockets = racks;
  return out;
}


