// A collector rig that refines what it collects.
//
// The problem it solves: a hold fills in about ninety seconds of scooping and then
// stops mattering. On the second sector a full hold is worth a few hundred credits
// against kill rewards in the tens of thousands, so cargo is a rounding error and
// dying with a full one costs nothing worth the word.
//
// A rig with a refinery aboard packs the hold down while you fly. It takes the
// cheapest thing you are carrying and compresses it into the next metal up, and
// the point is what that does to the SPACE: value is conserved, volume is not.
// Three iron is nine credits in nine units of hold; one nickel is nine credits in
// three. The rig then fills the six units it just freed, and does it again.
//
// So a hold does not fill — it climbs. What it is worth follows how long you have
// been out and how well you have been killing, not how big your hold is. That is
// the whole point: it puts something real at stake, and makes the flight home to
// bank it a decision rather than a formality.
//
// Refining conserves value and never creates it. The batch is the whole stack
// rather than a unit at a time, which is also what keeps the rounding honest: a
// hundred iron refines at about 1% lost, where three at a time would lose a fifth.

import { MATERIALS, holdVol } from './cargo.js';
import { EQUIPMENT, isCollector } from './gear.js';

// The metals in the order a refinery walks them.
export const LADDER = Object.keys(MATERIALS).sort((a, b) => MATERIALS[a].tier - MATERIALS[b].tier);

// How often a rig runs a batch, by its tier. A better rig reaches further, holds
// more and now also works faster — the same ladder, one more rung on it.
export const REFINE_EVERY = { 1: 22, 2: 13, 3: 7 };
export const refinePeriod = rig =>
  isCollector(rig) ? (REFINE_EVERY[EQUIPMENT[rig].tier] ?? REFINE_EVERY[1]) : 0;

// One batch: the cheapest metal you carry, packed into the next one up.
// Returns what moved, or null when there is nothing worth doing.
export function refineStep(hold, rig) {
  if (!refinePeriod(rig)) return null;
  for (let i = 0; i < LADDER.length - 1; i++) {
    const from = LADDER[i], to = LADDER[i + 1];
    const have = Math.floor(hold?.[from] ?? 0);
    if (have <= 0) continue;
    const vFrom = MATERIALS[from].value, vTo = MATERIALS[to].value;
    const made = Math.floor((have * vFrom) / vTo);
    if (made < 1) continue;                        // not enough of it to be worth one
    // Spend the fewest whole units whose value covers what comes out, so refining
    // can lose a little to rounding and can never mint credits out of nothing.
    const spent = Math.min(have, Math.ceil((made * vTo) / vFrom));
    if (spent <= 0) continue;
    return { from, to, spent, made,
             worth: spent * vFrom, made_worth: made * vTo,
             freed: spent * MATERIALS[from].vol - made * MATERIALS[to].vol };
  }
  return null;                                     // all of it is already iridium
}

// Apply a batch in place. Separate from deciding it so the decision can be tested
// and shown without moving anything.
export function applyRefine(hold, step) {
  if (!step) return hold;
  hold[step.from] -= step.spent;
  if (hold[step.from] <= 0) delete hold[step.from];
  hold[step.to] = (hold[step.to] ?? 0) + step.made;
  return hold;
}

// What a hold is worth and what it is taking up, for the readout that has to
// explain why a full hold just became a half-empty one.
export const holdWorth = hold =>
  Object.entries(hold ?? {}).reduce((s, [m, n]) => s + n * (MATERIALS[m]?.value ?? 0), 0);
export const holdRoom = (hold, cap) => Math.max(0, cap - holdVol(hold ?? {}));
