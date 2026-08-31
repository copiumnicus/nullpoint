// Folding: five seconds of standing still, and anything that lands on you ends it.
//
// This was the Recall Beacon's private mechanic and nothing else's. It is now the
// ONE way a ship changes sector without flying to a portal — the beacon, launching
// a claim, and being dropped into a duel are the same five seconds with three
// different destinations.
//
// WHY IT IS GENERAL RATHER THAN COPIED. A claim used to teleport you the instant
// you pressed the button, and that is an escape hatch out of any fight in the open
// world: something is shooting at you, you press CLAIM, and you are gone with your
// ship and your hold intact. The beacon costs 3,400 credits to do exactly that and
// can still be interrupted. A free, uninterruptible version of it sitting on the
// station panel is strictly better than the thing it undercuts, which is the shape
// rule five calls pay-to-win even when nothing is being paid.
//
// So: one number, one cancel rule, one shape for "where this puts you down". The
// destination travels WITH the fold rather than being looked up from a device key,
// because the beacon is now one caller of this and not the only one.

// The number. `DEVICES.recall.secs` reads it from here so there is exactly one.
//
// Five seconds is long enough that a hostile which has already opened on you will
// land something, and short enough that a pilot who broke contact is not standing
// in space wondering whether the button worked. It was the beacon's figure from the
// day the beacon shipped and nothing measured since has argued with it.
export const FOLD_SECS = 5.0;

// A fold is BROKEN by any hit at all, or by dying.
//
// `sinceHit` only ever counts UP unless something lands, so a DROP in it is a hit
// and needs no separate signal — which matters because the alternative is every
// damage source in the game remembering to cancel folds, and the pyre, the ground
// pools and the Kedge's haul would each have been a separate thing to forget.
export const foldBroken = (sinceHit, mark, hp) => sinceHit < mark || hp <= 0;

// Where a fold puts you down. A tagged shape rather than a device key, because
// three callers want three different things and only one of them owns a device.
//
//   port   a hangar you own — the beacon. `spend` names the device to consume.
//   claim  an instanced claim arena, opened on ARRIVAL. `key` is the mining tier.
//   duel   an instanced duel arena, opened on arrival. `id` is the sector, already
//          agreed by both pilots when the challenge was accepted.
//
// A fold that completes hands this back and the server does the one thing it says.
// Nothing here knows how to perform any of them — this file has no imports and is
// meant to keep it that way, so a fold can be reasoned about without a server.
export const FOLD_PORT  = 'port';
export const FOLD_CLAIM = 'claim';
export const FOLD_DUEL  = 'duel';
export const FOLD_KINDS = [FOLD_PORT, FOLD_CLAIM, FOLD_DUEL];

// `to` is one of the shapes above. `mark` is the ship's sinceHit at the moment it
// started, which is what foldBroken compares against on the next tick.
export const newFold = (to, sinceHit, secs = FOLD_SECS) =>
  ({ to, left: secs, secs, mark: sinceHit });

// How far through, 0..1. The wire carries this as a whole percent on `wrp`, so
// other pilots watch a fold happen rather than watching a ship vanish.
export const foldPct = f => f ? Math.max(0, Math.min(1, 1 - f.left / f.secs)) : 0;

// What to say when one breaks. The reason is worth naming: a fold that stops with
// no explanation is indistinguishable from a button that did not work, and all
// three destinations now share the one message.
export const BROKEN = {
  [FOLD_PORT]:  'recall broken off — the beacon is still yours',
  [FOLD_CLAIM]: 'the fold broke — you are still here, and so is the claim',
  [FOLD_DUEL]:  'the fold broke — the duel is off',
};
export const brokenText = kind => BROKEN[kind] ?? 'the fold broke';
