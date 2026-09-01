// One thing each hull can do that the others cannot.
//
// Racks and modules are how much ship you have; an ability is what KIND of ship
// it is, and until now that was carried entirely by base stats — which modules
// drown, measurably: a finished ship's hull contributes under 2% of its damage.
//
// An ability is a fourth power system. It routes like 1/2/3, draws the same
// capacitor, spools up and down on the same curve, and shows in the same readout.
// That is the whole reason to build it this way rather than as a cooldown button:
// the trade is enforced by machinery that already exists. Capacitor spent being
// invisible is capacitor not spent on guns, and the reactor cannot feed both.
//
// Every one of them SCALES with the routed level. None is a switch. A binary
// ability is either the obvious choice or never worth it, and the interesting
// part — how much of your reactor is this worth right now — only exists if the
// answer is a dial.
//
// The three are deliberately three different answers to the same question:
//
//   Veil     — don't be seen     (Kestrel, the interceptor)
//   Anchor   — don't be hurt     (Bulwark, the bomber)
//   Drumfire — don't let up      (Vanguard, the fighter)
//
// Each is useless in the others' situation. That is what makes them classes
// rather than three flavours of "more damage" — and it matters, because content
// damage only spans 3.9x across the whole game, so a flat power increase would
// make the scaling problem worse rather than better.
//
// The Hauler has none, on purpose. It is the starter, and "the ship without one"
// is a real thing for it to be. If a Tender ability is ever wanted it is a row in
// this table and a case in the three functions below.

import { levelOf } from './power.js';

export const SPECIAL = 'special';        // the fourth system, alongside SYSTEMS

export const ABILITIES = {
  veil: {
    name: 'Veil', hull: 'kestrel', colour: '#7fd4ff',
    blurb: 'Your return fades. At full nothing plots you, until you shoot.',
  },
  anchor: {
    name: 'Anchor', hull: 'bulwark', colour: '#e05a5a',
    blurb: 'Shields swell fourfold and the engines all but stop. A wall cannot leave.',
  },
  // Named for the artillery term, and deliberately NOT Cadence: the shop already
  // sells Siege Cadence and Rapid Cadence, and a third thing called Cadence on the
  // one hull those two are about would be unreadable on every row that mentions it.
  drumfire: {
    name: 'Drumfire', hull: 'vanguard', colour: '#ffd479',
    blurb: 'Every gun and every rack cycles faster. Your reach is what pays.',
  },
};

// --- the dials, each derived from what the ability is for ---------------------
//
// These six are the SHIPPED SETTING of each ability, and nothing more. They are
// the defaults of six rows in ATTRS (ships.js imports them from here, so there is
// one copy), which means every one of them is fittable: a technology can deepen a
// veil, loosen an anchor or beat a drum harder exactly the way one already raises
// hull or cuts signature.
//
// They were module constants until the technology shelf was asked to cover "the
// 4th ability like all the stats there are" and could not, because `mods` reaches
// ATTRS and nothing else. An ability that no module can touch is the one system
// on the ship that fitting has no opinion about.
//
// Every one of them has a CEILING in ATTRS as well as a default, and the ceilings
// are the arguments below, not round numbers: a veil deeper than 0.94 is an exit
// from the game whoever sells it.

// Detection range multiplier at full veil. Not zero: a ship nothing can ever see
// is not stealth, it is an exit from the game. At 0.12 a Kestrel is found only
// well inside knife range, which is where an interceptor wanted to be anyway.
export const VEIL_DEPTH = 0.88;

// Firing gives you away, and the veil has to build again from nothing. This is
// the same rule the Bandit lives by — working is what exposes camouflage — and it
// is what stops Veil being a sniping tool rather than an approach.
export const VEIL_RECOVER = 2.5;         // s after a shot before the veil is whole

// Fourfold shields, which is the number the design asked for, expressed as what
// is ADDED so the arithmetic reads: 1 + 3 = 4.
export const ANCHOR_SWELL = 3;
// And what it costs. Down to a fifth of your speed — not zero, because a ship
// that cannot move at all cannot be repositioned by its own pilot, only by
// whatever is shooting it.
export const ANCHOR_DRAG = 0.8;

// What Drumfire costs: reach. To fire this fast you have to close.
//
// This was Lock's cost and it has never moved, through two completely different
// gains, because it is a statement about how a fighter FIGHTS rather than a term
// in any arithmetic. It replaced Lock — the seekers stop guessing, camouflage
// stops being an answer to you — which had collapsed into a PvP-only ability the
// moment the Aspect Filter went on the shelf: a technology already reveals a
// Bandit from any angle, so the one thing Lock beat was already beaten, on a hull
// most people fly against the bestiary.
//
// It stayed at 0.35 when the gain went from x1.54 to x2.50, which was a decision
// and not an oversight. 455px is already the shortest reach in the game by 165px —
// under the Hauler's 640, the Kestrel's 620 and the Bulwark's 820 — and it is
// inside the envelope of every hostile worth the name: a Kedge, a Leviathan, a
// Thresher and a Corsair Hive all reach 900. Priced on the shape, 35% already
// leaves a full drum at 8.04M of damage-per-metre against a finished Bulwark's
// 8.88M, so the ability does not win that axis; 45% would take it to 6.80M and
// 50% to 6.18M, which is most of the way back to the wash this replaced.
export const DRUMFIRE_REACH = 0.35;      // weapon range down to 65% at full

// And what it buys: rate of fire, on the guns AND the racks.
//
// A FULL DRUM THROWS TWICE WHAT AN INTERCEPTOR DOES WITH ITS REACTOR ON ITS GUNS.
// That sentence is the whole derivation, and the number is solved from it against
// the shipped game rather than chosen. Measured through the real fire()/launch()
// loop, 60s against a parked hulk, both hulls at the top of the shop with a full
// escort of MK-V Emitters:
//
//      a Kestrel routed to weapons     9,353 dps   (x1.440 over its own idle)
//      a Vanguard cold                 7,462 dps
//      so the drum has to be     2 x 9,353 / 7,462  =  x2.5066
//
// and the same solve on the rocket build — five Osprey Racks against the Kestrel's
// two — asks for x2.4020. x2.50 sits between them, so ONE constant satisfies both
// builds and neither is averaged away. DRUMFIRE_GAIN is that minus the 1 the cycle
// starts at.
//
// What it actually DELIVERS through the loop is x1.89 of an interceptor with guns
// and x2.01 with racks, and the 6% between them is the 30Hz TICK rather than the
// constant. A cycle is `1 / rate` seconds counted down in whole ticks, so the rate
// a rack really achieves is a staircase: on the guns build x2.50 and x2.60 land on
// the same step, x1.89, and the next step up is x2.08 — overshooting twice by more
// than x2.50 undershoots it. x2.50 is the closest either side AND the one the
// algebra asked for, so the tick decides nothing here; it only explains the 6%.
//
// REACH TIMES RATE IS NO LONGER CONSERVED, and that is the point of this number.
// It was: the gain used to BE the cost, read back through 1/(1 - 0.35) = x1.5385,
// so a full drum threw exactly the damage per metre of reach that a cold ship did.
// That is elegant and it produced an ability nobody would switch on. Measured, it
// was worth 3.8% more damage than simply routing the same reactor to the guns —
// which every hull can already do, for x1.440 — in exchange for 35% of your reach.
// A sidegrade of a thing everybody has is not a class identity. So the trade is a
// REAL POWER GAIN BOUGHT WITH REACH now, not a reshaping, and the honest way to say
// so is that the fighter's damage per metre of reach goes UP: 5.22M cold, 8.04M at
// a full drum, against a finished Bulwark's 8.88M. It buys burst, not efficiency —
// it is still, just, the second-most efficient gun in the game, and by a long way
// the most dangerous one inside 455px.
export const DRUMFIRE_GAIN = 1.5;        // rate x2.50 at full

// Reading a dial off the ship rather than off the constant. `stats` is a resolved
// attribute set — or `{}` from anything that has no fit at all, which is why the
// fallback is here and not at the call sites.
const dial = (stats, key, dflt) => {
  const v = stats?.[key];
  return Number.isFinite(v) ? v : dflt;
};

export const abilityOf = hull => ABILITIES[hull?.ability]  ? hull.ability : null;

// Which ability an ATTRIBUTE belongs to, or null for one every hull reads.
//
// Derived from the attribute's NAME against the ability keys — veilDepth is a
// Veil dial because it starts with "veil" — and derived from `ABILITIES` rather
// than a list of three, so a fourth ability with `wardDepth`/`wardRecover` dials
// is picked up by the shop, the tooltip and the stats page the moment its row
// exists. That is the same seam ships.js leans on when it names these rows.
//
// It lives here because it was already written down twice: `tunesAbility` in
// gear.js refuses to sell a Null Skin to a Bulwark with it, and `abilityOfAttr`
// in tooltip.js says "Nothing on this hull" with it. A third copy on the stats
// page would be the drift rule one exists to prevent — the page would happily
// list a Veil depth on a Bulwark that the shop two tabs away refuses to sell.
export const attrAbility = attr =>
  Object.keys(ABILITIES).find(k => String(attr ?? '').startsWith(k)) ?? null;

// How hard the fourth system is being driven, 0..1. Same shape as any other
// system, so an ability browns out with the capacitor exactly like guns do.
export const driveOf = (power, stats) => levelOf(power, SPECIAL, stats);

const isKind = (kind, hull) => hull?.ability === kind;

// Detection range multiplier applied to whoever is LOOKING at this ship. 1 for
// anything without a veil, so nothing else in the game changes.
export function cloakOf(hull, power, stats, sinceShot = 1e9) {
  if (!isKind('veil', hull)) return 1;
  // Rebuilt from nothing after every shot, so the veil is an approach and a
  // withdrawal, never a firing position.
  const recover = Math.max(0.01, dial(stats, 'veilRecover', VEIL_RECOVER));
  const rebuilt = Math.max(0, Math.min(1, sinceShot / recover));
  return 1 - dial(stats, 'veilDepth', VEIL_DEPTH) * driveOf(power, stats) * rebuilt;
}

// Shield multiplier and speed multiplier, both from the same dial so they cannot
// come apart: you never get the wall without the anchor.
export const swellOf = (hull, power, stats) =>
  isKind('anchor', hull) ? 1 + dial(stats, 'anchorSwell', ANCHOR_SWELL) * driveOf(power, stats) : 1;
export const dragOf = (hull, power, stats) =>
  isKind('anchor', hull) ? 1 - dial(stats, 'anchorDrag', ANCHOR_DRAG) * driveOf(power, stats) : 1;

// Rate-of-fire multiplier and reach multiplier, both off the same drive, so you
// never get the cadence without the closing — the same arrangement swellOf and
// dragOf have, and for the same reason.
//
// `drumOf` is applied to the CYCLE, not to a volley: combat.js divides both the
// cycle cooldown and the between-barrel step by it, and rockets.js divides the
// rack's own cooldown by it, so a rack of five stays a rack of five arriving
// sooner rather than five racks. Multiplying anywhere else would multiply twice.
export const drumOf = (hull, power, stats) =>
  isKind('drumfire', hull) ? 1 + dial(stats, 'drumfireGain', DRUMFIRE_GAIN) * driveOf(power, stats) : 1;
export const reachOf = (hull, power, stats) =>
  isKind('drumfire', hull) ? 1 - dial(stats, 'drumfireReach', DRUMFIRE_REACH) * driveOf(power, stats) : 1;
