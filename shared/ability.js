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
//   Veil   — don't be seen     (Kestrel, the interceptor)
//   Anchor — don't be hurt     (Bulwark, the bomber)
//   Lock   — don't miss        (Vanguard, the fighter)
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
  lock: {
    name: 'Lock', hull: 'vanguard', colour: '#ffd479',
    blurb: 'The seekers stop guessing. Camouflage stops being an answer to you.',
  },
};

// --- the dials, each derived from what the ability is for ---------------------
//
// These six are the SHIPPED SETTING of each ability, and nothing more. They are
// the defaults of six rows in ATTRS (ships.js imports them from here, so there is
// one copy), which means every one of them is fittable: a technology can deepen a
// veil, loosen an anchor or sharpen a lock exactly the way one already raises
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

// Lock closes the gap between what a seeker CAN see and a perfect return. At full
// there is no wobble and no dropout; at half, half of each. It cannot help you
// with dodging — a Bandit that breaks the firing line still breaks it — only with
// aiming, which is the half stealth was winning.
export const LOCK_TIGHTEN = 1;
// What it costs: reach. Locked on, you have to close.
export const LOCK_REACH = 0.35;          // weapon range down to 65% at full

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

// 0 = seekers as they are, 1 = a perfect return. Everything between is between.
//
// Clamped at 1, and the clamp is the whole point of letting `lockTighten` go above
// it: a bite of 1.8 does not buy a better-than-perfect return, it reaches a
// perfect one at 56% of the dial and leaves the rest of the reactor for the guns.
// Unclamped it also put `lk` over 100 on the wire, and the client colours a bolt
// from that.
export const lockOf = (hull, power, stats) =>
  isKind('lock', hull)
    ? Math.min(1, dial(stats, 'lockTighten', LOCK_TIGHTEN) * driveOf(power, stats)) : 0;
export const reachOf = (hull, power, stats) =>
  isKind('lock', hull) ? 1 - dial(stats, 'lockReach', LOCK_REACH) * driveOf(power, stats) : 1;
