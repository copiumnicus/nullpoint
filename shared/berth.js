// A berth at a pirate outpost.
//
// The outpost buys ore and nothing else, which is the right default — but it
// means a long run ends the moment you want to change anything about the ship.
// A berth is the pirates renting you a bay: you can refit and buy there, and that
// is all it buys you.
//
// What it deliberately does NOT buy you:
//   - protection. An outpost is not a haven and a berth does not make it one.
//   - repair. The dock at home mends you for free; these people do not.
//   - safety while you use it. Take a hit and the bay closes until you are clear,
//     because a shop you can use mid-fight is a shop that ends fights.
//
// It is bought per outpost, not once for all of them. Each frontier is its own
// decision, and a pilot who lives on one frontier should not be paying for three.

import { devicePrice } from './devices.js';
import { levelFor } from './level.js';

// What a berth is worth, derived rather than picked: a Recall Beacon buys exactly
// one trip home and costs 3400. A berth saves that trip every time you would have
// wanted to change something out here, forever.
//
// It was thirty trips, priced as a convenience. It is not one any more: the upper
// half of every equipment ladder is frontier stock now (see FRONTIER in gear.js),
// so a bay is the door to the second half of the game rather than a way to skip a
// flight. A toll on the ladder has to be payable at the moment you first want to
// climb it — around an MK-III, which is 7200 — so it is eight trips, not thirty.
// Past eight refits out here it has paid for itself, and below that a handful of
// beacons really was the cheaper answer.
export const BERTH_TRIPS = 8;
export const berthPrice = () => devicePrice('recall') * BERTH_TRIPS;

// Money is not the only thing pirates want. A berth is the first thing in the game
// gated on rank, and rank is the right gate for exactly this: they are not selling
// you a capability, they are deciding whether they have heard of you. A pilot who
// has never left home has not.
//
// And the rank moves with it, for the same reason. Rank 20 was standing on a
// frontier you had already worked; gating the whole upper equipment ladder behind
// that would have meant clearing the frontier with home-ring guns, which is the
// wrong way round. Rank 8 is 8,000 experience — about 57 Drifters, or six
// Ironhusks — which is a pilot who has finished with the home ring and has
// nowhere left to go but out. That is exactly who this is for.
//
// Read against today's experience table, which is itself un-rebalanced: a single
// Corsair Hive pays 140,000 and would carry you past this on its own. That is a
// problem with the Hive's number rather than with this one, and when the bestiary
// is brought onto the balance model this gate should be re-derived, not nudged.
export const BERTH_RANK = 8;

// Long enough that it cannot be used as cover mid-fight, short enough that it is
// not a punishment for having been shot at once on the way in. The same window
// the repair kits use, for the same reason.
export const BERTH_QUIET = 6;

// Why this pilot cannot trade at this outpost right now, or null if they can. One
// function, so the panel, the prompt and the server all give the same answer.
export function whyNotBerth({ owned = false, inside = false, sinceHit = 1e9 } = {}) {
  if (!inside) return 'no outpost in range';
  if (!owned) return 'you have no berth here';
  if (sinceHit < BERTH_QUIET) return 'not while you are being shot at';
  return null;
}

// And why they will not sell you one yet.
export function whyNotBuyBerth({ xp = 0, credits = 0, owned = false, inside = false } = {}) {
  if (!inside) return 'no outpost in range';
  if (owned) return 'you already keep a berth here';
  const lvl = levelFor(xp).level;
  if (lvl < BERTH_RANK) return `they rent to pilots they have heard of — rank ${BERTH_RANK}, you are ${lvl}`;
  if (credits < berthPrice()) return `a berth here costs ${berthPrice()}`;
  return null;
}

// --- the panel that sells you one ---------------------------------------------
// Small, because it has exactly one thing to say and one button.
export const PANEL_W = 380, PANEL_H = 188;

export function berthPanel(VIEW_W, VIEW_H) {
  const w = Math.min(PANEL_W, VIEW_W - 40), h = PANEL_H;
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
  return {
    panel: { x, y, w, h },
    buy: { x: x + 20, y: y + h - 56, w: w - 40, h: 36 },
  };
}
