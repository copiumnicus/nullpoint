// Selling equipment back.
//
// The shop was one-way: every emitter, generator and technology you ever
// outgrew sat in the inventory forever, and upgrading meant the old thing became
// litter. You can break it for parts now.
//
// The rate is deliberately poor. Two things fix it from opposite sides:
//
//   It must be well under 100%, or buy-and-sell becomes a way to move money
//   around — and worse, it makes the top rung the only sensible first purchase,
//   since you could always refund the difference. At 40% every round trip loses
//   60%, so there is no price at which churning gear is a plan.
//
//   And it must be well above nothing, or upgrading is punished and pilots sit on
//   kit they have outgrown rather than climbing. The ladder is supposed to be
//   climbed.
//
// 40% also sits below what a pirate pays for ORE (75%, see PIRATE_RATE), which is
// the right way round: ore is a commodity anyone can use, and a used emitter is a
// specific thing that a specific buyer might want.

import { EQUIPMENT } from './gear.js';
import { HULLS, DEFAULT_HULL } from './ships.js';

export const SCRAP_RATE = 0.40;

// What breaking it up pays. Always a whole number, and never more than it cost.
export const scrapValue = price =>
  Math.max(0, Math.floor((Number(price) || 0) * SCRAP_RATE));

export const scrapOfItem = key => scrapValue(EQUIPMENT[key]?.price ?? 0);
export const scrapOfHull = key => scrapValue(HULLS[key]?.price ?? 0);

// Why this cannot be broken up, or null if it can.
//
// `held` is how many are sitting loose in the inventory — fitted gear is not
// sellable, because selling the thing you are flying with is a different and much
// more confusing operation than taking it off first and then selling it.
export function whyNotScrap(key, { held = 0, where = null } = {}) {
  if (!EQUIPMENT[key]) return 'no such thing';
  if (!(held > 0)) return 'none loose in your inventory — take one off the ship first';
  if (!where) return 'nowhere to break it up — dock, or rent a bay at an outpost';
  return null;
}

// Hulls are their own question: you may sell one you own, but never the one you
// are flying and never your last, because a pilot with no ship has no game.
export function whyNotScrapHull(key, { owned = [], flying = null, where = null } = {}) {
  if (!HULLS[key]) return 'no such hull';
  if (!owned.includes(key)) return 'you do not own one';
  if (key === flying) return 'you are flying it';
  if (key === DEFAULT_HULL) return 'the starter hull is not yours to sell';
  if (owned.filter(h => h !== DEFAULT_HULL).length <= 0) return 'it is the only ship you have';
  if (!where) return 'nowhere to break it up — dock, or rent a bay at an outpost';
  return null;
}
