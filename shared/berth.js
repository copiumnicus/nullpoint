// A berth at a pirate outpost.
//
// The outpost buys ore and nothing else, which is the right default — but it
// means a long run ends the moment you want to change anything about the ship.
// A berth is the pirates renting you a bay: you can refit and buy there, and that
// is all it buys you.
//
// What it deliberately does NOT buy you:
//   - repair. The dock at home mends you for free; these people do not. The badge
//     top right says so in as many words when you are standing in one, because an
//     outpost IS a haven now — the pirates keep order inside their own ring, so a
//     respawn there is not a death loop — and "safe" reads as "mended" unless the
//     game says otherwise. This line used to claim an outpost was not a haven at
//     all, which stopped being true when the protection zone went in and stayed
//     on the page for two versions.
//   - safety while you use it. Take a hit and the bay closes until you are clear,
//     because a shop you can use mid-fight is a shop that ends fights.
//
// It is bought per outpost, not once for all of them. Each frontier is its own
// decision, and a pilot who lives on one frontier should not be paying for three.
// The deep sectors have one too, and it is not the same offer: ten million and rank
// 39 against the frontier's 27,200 and rank 8. berthTerms() is where that lives.

import { devicePrice } from './devices.js';
import { levelFor } from './level.js';
import { MAPS } from './maps.js';

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
export const frontierBerthPrice = () => devicePrice('recall') * BERTH_TRIPS;

// --- and what one costs in the deeps ------------------------------------------
//
// Ten million, which the trips argument above does not support and cannot be made
// to. A Recall Beacon is 3,400 wherever you buy it, so `devicePrice('recall') x
// BERTH_TRIPS` prices a bay four hops out at the same 27,200 it prices one on the
// frontier — and 27,200 out here is 1.84% of a SINGLE kill. Priced in beacons a
// deep bay is free, and a price you do not notice is not a decision. That
// arithmetic is named rather than quietly dropped because it is the frontier's and
// it is still right there.
//
// What does scale with the sector is what the sector pays, so that is the currency:
//
//   one Vitriol or Doldrum   2,055,480 effective hit points
//     bounty                 1,438,836   ehp x BOUNTY_RATE
//     one full hold of ore      47,680   at the dock
//                            + 35,760   at the counter it is standing next to, x PIRATE_RATE
//     ------------------------------------------------------------------------
//     a kill, banked here     1,474,596
//
//   a deep sector is posted with four of them, so ONE CLEAR is 5,898,384.
//
// Ten million is 6.78 kills, or 1.70 clears: a bay costs a little under two clears
// of the sector it stands in. Seven kills is 10,322,172 and six is 8,847,576, so
// the round number the designer asked for sits inside the band and is the one a
// player can hold in their head — which is worth more on a price tag than three
// significant figures of a number that moves whenever a hostile is rebalanced.
//
// It is deliberately not priced against the shop. One of every hull, gun, generator
// and rig in the game comes to about 350,000; ten million is thirty of those. By
// the deeps the shop has stopped being the constraint on anything, and this is the
// first price in the game denominated in what a pilot EARNS rather than in what
// things cost. test/berth.mjs keeps the measurement: if the deeps' payout moves far
// enough that ten million stops being six-to-eight kills, it says so and this wants
// re-deriving rather than nudging.
export const DEEP_BERTH = 10_000_000;

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

// And the deeps ask for rank 39, which is one kill.
//
// Not "one kill" as a figure of speech: a Vitriol or a Doldrum pays 442,719
// experience and rank 39 costs 437,817, so a single one of the things that lives in
// a deep sector carries a pilot from nothing to the door. That is the rank standing
// for the only thing it can honestly stand for out here — the frontier's gate says
// the pirates have heard of you, and this one says you have killed something that
// lives past a gate.
//
// The important part is that the door OPENS FROM OUTSIDE. Rank 39 is also 3.1
// Corsair Hives or 9.9 Threshers, both of which stand on the gates you cross to get
// here, so a pilot arrives in the deeps already able to rent. A gate you can only
// pass by already being through it is a wall, and this codebase has shipped one of
// those.
//
// It is a gate and not a multiplier: a rank 39 pilot and a rank 300 pilot pay the
// same ten million and fly the same ship afterwards. There is a test.
//
// Same caveat as the one above it, and for the same reason: the experience table is
// un-rebalanced, so this is derived from a number that is itself owed a pass. When
// the bestiary comes onto the balance model, re-derive both gates rather than
// nudging either.
export const DEEP_BERTH_RANK = 39;

// --- one function, both counters ----------------------------------------------
//
// The terms at THIS outpost. It was a global, which was true while there was one
// kind of outpost and silently wrong the moment there were two: a caller that
// forgot to say where it was standing would quote the frontier's 27,200 for a bay
// worth ten million, and the server would take the money and hand it over. So the
// price and the rank come out of the same lookup, from the same key, and the panel,
// the prompt and the server all read it.
//
// `deep` is the seam, per rule seven: a third kind of outpost is a row here, not a
// second copy of whyNotBuyBerth.
export const berthTerms = (mapId) => MAPS[mapId]?.deep
  ? { price: DEEP_BERTH,            rank: DEEP_BERTH_RANK, deep: true }
  : { price: frontierBerthPrice(),  rank: BERTH_RANK,      deep: false };

export const berthPrice = (mapId) => berthTerms(mapId).price;
export const berthRank  = (mapId) => berthTerms(mapId).rank;

// Long enough that it cannot be used as cover mid-fight, short enough that it is
// not a punishment for having been shot at once on the way in. The same window
// the repair kits use, for the same reason.
export const BERTH_QUIET = 6;

// Why this pilot cannot trade at this outpost right now, or null if they can. One
// function, so the panel, the prompt and the server all give the same answer.
export function whyNotBerth({ owned = false, inside = false, sinceHit = 1e9 } = {}) {
  if (!inside) return 'no outpost in range — fly into the ring';
  if (!owned) return 'no bay here yet — press H to rent one';
  if (sinceHit < BERTH_QUIET) return `wait ${BERTH_QUIET}s clear of fire — the bay is shut`;
  return null;
}

// And why they will not sell you one yet.
//
// `mapId` is which outpost, and it is not optional in spirit even though it has a
// default: leave it out and this quotes the frontier's terms for whatever you are
// standing in. Every caller passes it, and test/berth.mjs asserts a deep sector
// quotes ten million through this function and not just through berthPrice().
export function whyNotBuyBerth({ mapId = null, xp = 0, credits = 0,
                                 owned = false, inside = false } = {}) {
  // These are drawn on the panel's one button, in capitals, so they have to fit
  // in about forty characters. The reasoning — why pirates care about rank at all
  // — is printed above the button; this line is only ever the missing piece.
  if (!inside) return 'no outpost in range — fly closer';
  if (owned) return 'you already rent a bay here';
  const { price, rank } = berthTerms(mapId);
  const lvl = levelFor(xp).level;
  if (lvl < rank) return `they want rank ${rank} — you are ${lvl}`;
  // Grouped, because ten million as a bare run of digits is a number nobody reads.
  if (credits < price) return `costs ${price.toLocaleString('en-US')} cr — you cannot pay yet`;
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

// --- every hangar this pilot has ----------------------------------------------
//
// Your company's rings, plus a bay you rent on any frontier. Two things read this
// and they used to disagree about it: where a wreck comes back, and where a recall
// beacon folds you. One list, so they cannot.
export function homePorts(acct, MAPS) {
  const co = acct?.co ?? 'm', berths = acct?.berths ?? [], out = [];
  for (const [id, m] of Object.entries(MAPS)) {
    // `r` rides along because a hangar is a RING, not a point, and the respawn
    // scatters you inside it. It was dropped when this became one list and nothing
    // noticed: `Math.random() * undefined` is NaN, a NaN position never moves and
    // never renders anywhere real, and pilots came back stuck in the corner of the
    // map with no way out — including by dying again. Anything reading a hangar
    // needs its size as much as its middle.
    if (m.base && m.owner === co) out.push({ map: id, x: m.base.x, y: m.base.y, r: m.base.r,
                                             name: m.name ?? id, kind: 'dock' });
    else if (m.outpost && berths.includes(id)) out.push({ map: id, x: m.outpost.x, y: m.outpost.y,
                                                         r: m.outpost.r,
                                                         name: m.name ?? id, kind: 'bay' });
  }
  return out;
}

// Which of them a beacon takes you to. Folding always went to your company ring,
// which was right while the ring was the only place you could dock and useless the
// moment it was not: a pilot working a frontier they rent a bay on was paying 3400
// to be sent four sectors from where they wanted to be. The beacon is worth having
// again once it can go to the bay.
//
// Re-checked against the same list rather than trusted, because a berth can be
// sold and a save can be edited. Anything that no longer holds folds you home,
// which every pilot always has.
export function foldTo(acct, MAPS, want) {
  const ports = homePorts(acct, MAPS);
  return ports.find(p => p.map === want) ?? ports.find(p => p.map === (acct?.co ?? 'm') + '1')
      ?? { map: (acct?.co ?? 'm') + '1', ...MAPS[(acct?.co ?? 'm') + '1'].base };
}

export function respawnAt(acct, MAPS) {
  return foldTo(acct, MAPS, acct?.lastDock);
}

// And whether standing here counts as "the last hangar you used", which is the
// same question as whether the station panel would open — one rule, so the place
// you respawn can never be somewhere you could not have shopped.
// Takes the sector's id explicitly: a MAPS entry does not carry its own key, so
// reading `map.id` here quietly matched nothing and every respawn fell back home.
export const isHangar = (mapId, map, co, ship, berths = []) =>
  !!((map?.base && map.owner === co
      && Math.hypot(map.base.x - ship.x, map.base.y - ship.y) < map.base.r)
  || (map?.outpost && berths.includes(mapId)
      && Math.hypot(map.outpost.x - ship.x, map.outpost.y - ship.y) < map.outpost.r));
