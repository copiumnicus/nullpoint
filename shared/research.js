// Research stations, and the ladder that comes after the shops.
//
// The equipment ladder has an end. A pilot reaches it in about ninety minutes,
// finishes with 300,000 credits and nothing left to want, and the honest answer to
// that is NOT a sixth rung of emitters at double the price — an MK-VI is the same
// decision as an MK-V with a bigger number on it, and the game has five of those.
//
// So you stake a plot in your own company's ring. Everyone can see it, it has your
// name on it, and what you build on it is yours. The first thing pays you while
// you are away; everything after it is the reason a Corsair Hive stops being a
// four-ship problem.
//
// The word is "lab", not "station", throughout. `shared/hangar.js` already calls
// the dock "the station panel" and two meanings of one word in one codebase is
// exactly the drift rule one exists to prevent.

import { MAPS } from './maps.js';
import { POCKET_RATE, PIRATE_RATE, pocketValue, holdValue, fmtCredits } from './cargo.js';

// --- staking a plot -----------------------------------------------------------
//
// 500,000 against a price ladder whose dearest single item is 40,000 and whose
// complete endgame ship is about 250,000. Two finished ships: a thing you fly
// toward for a couple of hours, not a thing you buy on the way past. It is
// visibly yours in the ring from the moment you place it, in front of everyone
// who has not, and that is most of what the first 500,000 buys.
export const LAB_PRICE = 500_000;

// --- the yard -----------------------------------------------------------------
//
// A home ring is r = 900 with the dock hexagon (62px) at the centre, which is also
// where every respawn and every recall beacon puts you.
//
//   LAB_R   26   half the dock hexagon: a structure at a glance, never the dock
//   LAB_GAP 120  the corridor between two labs takes a Bulwark (34 across) with a
//                Bulwark's width of clear sky either side: 68 + 2*26 = 120
//   YARD_IN 300  238px clear of the dock, and clear of the arrival scrum
//
// Plots are a lattice of concentric rings LAB_GAP apart, each ring offset from the
// last by the golden angle so they interleave instead of forming spokes. That is
// 138 plots to a company ring, 414 in the galaxy — more pilots than one company is
// likely to hold, which is the point: full should be a rule that exists rather
// than a rule anyone hits.
//
// The named seam is that the lattice is DERIVED from base.r. Widening the ring in
// maps.js adds outer rings and moves nothing already standing.
export const LAB_R = 26, LAB_GAP = 120, YARD_IN = 300;
export const YARD_EDGE = LAB_R + 34;               // a Bulwark's width inside the rim

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function plotsFor(base) {
  const out = [];
  if (!base?.r) return out;
  const outer = base.r - YARD_EDGE;
  for (let r = YARD_IN, ring = 0; r <= outer; r += LAB_GAP, ring++) {
    const n = Math.floor((2 * Math.PI * r) / LAB_GAP);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * GOLDEN;
      out.push({ x: Math.round(base.x + Math.cos(a) * r), y: Math.round(base.y + Math.sin(a) * r) });
    }
  }
  return out;
}

// Which plot a token WANTS, and then the first free one from there.
//
// Probing is order-dependent — placing 120 accounts forwards and backwards puts 92
// of them on different plots — so the plot is written down on the account when it
// is bought and never re-derived. Recomputing at boot would move somebody's lab
// out from under them the first time a neighbour bought one.
const hash = (str, salt) => {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

export function claimPlot(token, base, taken = []) {
  const plots = plotsFor(base);
  if (!plots.length) return null;
  const used = new Set(taken);
  const start = hash(String(token), 1) % plots.length;
  for (let i = 0; i < plots.length; i++) {
    const slot = (start + i) % plots.length;
    if (!used.has(slot)) return slot;
  }
  return null;                                     // the yard is full — see whyNotStake
}

export const plotAt = (base, slot) => plotsFor(base)[slot] ?? null;

// How many plots a home ring holds. Every company ring is the same size, so this
// is one number rather than a per-map lookup — but it is DERIVED from maps.js
// rather than written down, so widening a ring moves it. sanitiseAccount uses it
// to reject a slot off the end of the lattice; the server re-checks against the
// pilot's actual map on the way in, which is the authority.
export const HOME_PLOTS = plotsFor(MAPS[Object.keys(MAPS).find(k => MAPS[k].home)]?.base ?? {}).length;

// --- what you build on it -----------------------------------------------------
//
// Three ladders. Mining pays for the other two, and the other two are what let one
// ship do what four used to.
//
// ORDER IS THE WIRE FORMAT. A lab's whole state travels as one integer, one bit
// per module, and the bit is this table's index. Reordering these entries renames
// every module every player has ever bought. New ones go at the END; a retired one
// leaves a dead entry rather than shifting the rest.
//
// Thirty-one is the ceiling, for exactly the reason SHIP_FIELDS stops at 31:
// JavaScript's bitwise operators are signed 32-bit, so `1 << 31` is negative.
export const MAX_MODULES = 31;

// Why the mining rate is what it is.
//
// The designer measured their own play at 300,000 credits in an hour and a half —
// 55 credits a second of wall clock, travel and hunting included. The first tier is
// set so the plot AND its first module pay for themselves in exactly one day:
//
//   (500,000 + 500,000) / 86,400 s = 11.6 cr/s, called 12
//
// which is 21% of active play. Worth having while you fly, plainly not a
// replacement for flying. It is written as arithmetic rather than as a number so
// it moves if either price does.
//
// Each tier after it costs x4 and pays x5 — 24, 30 and 37.5 credits a second per
// million spent — so every rung is strictly better value than the one below it and
// the thing you are saving for is always the next one. There is a test for that,
// because the first draft priced tiers one and two at exactly the same value and
// the ladder had a rung with no reason to climb it. That is the loop: the mine funds the armour, the armour opens the content,
// the content funds the mine.
export const ACTIVE_RATE = 55;
export const MINE_RATE = Math.round((LAB_PRICE + 500_000) / 86_400);

// Hull and shield each climb five tiers of x2, which is x32 on both.
//
// The arithmetic that sets the TOP of the ladder:
//
//   a finished Bulwark          6,100 ehp and 5,874 dps
//   a Hive                    650,000 ehp -> 111 seconds of shooting
//   its brood, twelve Bandits   2,450 dps once it is full
//
// 111 seconds of that is about 210,000 damage, and x32 is 195,200 — so the top of
// the ladder is the EDGE of soloing a Hive by standing in it: never breaking off,
// never kiting, letting the brood fill to twelve, and closing the last of the gap
// with shield regen and a repair drone.
//
// That is the worst case on purpose, and it is not the threshold. A Hive moves at
// 110 and a Bulwark at 250; its brood is fast but out-ranged, and a pilot who
// kites, thins the escorts and breaks off to let shields come back takes a small
// fraction of that 210,000. Soloing one is comfortably possible several tiers
// below the top.
//
// The gap between "kite it at tier 2" and "tank it at tier 5" is deliberate: it is
// where flying well shows up as something other than a smaller repair bill. A
// ladder whose top rung is exactly the hardest fight leaves nothing for skill to
// buy — this one leaves three tiers of it.
export const TIER_MUL = 2;

// --- the tech tree ------------------------------------------------------------
//
// How often a Pocket Dimension empties the hold. Thirty seconds is the designer's
// number and it is the right one for a reason worth stating: it has to be short
// enough that the cargo cap stops binding — a Bulwark with an Ore Tender holds 300
// volume and a single deep kill drops 152 of it, so anything much longer and the
// hold fills between sales and you are back to stopping — and long enough that a
// sale is an EVENT you notice rather than a number quietly ticking. Twelve of them
// a minute would be indistinguishable from the mine.
//
// It is also what caps a death. Losing the hold is what dying costs; with a
// dimension aboard you can never lose more than thirty seconds of scooping.
export const POCKET_EVERY = 30;

// The price, derived the way berth.js derives the other ten million in this game:
// against what the thing it is for actually pays.
//
// Ore per hour, measured off the real DROPS tables and a finished ship's real
// 11,307 dps — expected drop value over farm hit points over dps, at 1.5x wall
// clock for travel and shield regen. At POCKET_RATE, ten million comes back in
//
//   4.7 hours of Threshers at best, 17.4 hours of Bandits at worst
//
// and the middle of that band is where the mining ladder already sits: the
// Cometary Harvest Array is 8,000,000 for 300 cr/s, which is 7.4 hours. A tree
// upgrade at ten million paying back in most of a working day of FLYING, against a
// mining rig at eight million paying back in most of a day of WALL CLOCK, is the
// right way round — the tree asks you to be there.
//
// The deeps are the outlier, and they were the outlier before this existed: a
// Crucible's ore is 3.3% of what killing it pays, because the drop is capped at
// one hold while the bounty is not. That takes the payback out there to 28 hours.
// It is a fact about the bestiary rather than about this price — see the ceiling
// note in cargo.js — and it is exactly the complaint this module was asked to
// answer, not one a sale price can fix.
//
// test/cargo.mjs keeps the measurement and re-derives every number in this
// paragraph. If ore per hour moves far enough that ten million stops being most of
// a working day, it says so, and this wants re-deriving rather than nudging.
export const POCKET_PRICE = 10_000_000;

export const MODULES = {
  // --- the mine, which pays for the rest ---
  mine1: { line: 'mine', tier: 1, name: 'Deep Space Mining Operation', price:    500_000, rate: MINE_RATE,
           blurb: 'Ore shipped from nowhere you have to fly to.',
           does: 'pays while you are away, logged in or not' },
  mine2: { line: 'mine', tier: 2, name: 'Asteroid Belt Claim',         price:  2_000_000, rate: MINE_RATE * 5,
           blurb: 'A whole belt with your name on the paperwork.',
           does: 'five times the first rig, for four times the money' },
  mine3: { line: 'mine', tier: 3, name: 'Cometary Harvest Array',      price:  8_000_000, rate: MINE_RATE * 25,
           blurb: 'Volatiles cracked out of ice on the long orbits.',
           does: 'five times the belt again — the last rig you will need' },

  // --- hull, out of materials science ---
  hull1: { line: 'hull', tier: 1, name: 'Bulk Metallic Glass',         price:  1_000_000, mul: 2,
           blurb: 'An alloy frozen before its atoms could line up.',
           does: 'twice the hull, on every ship you will ever fly' },
  hull2: { line: 'hull', tier: 2, name: 'Nanotwinned Carbide',         price:  2_000_000, mul: 4,
           blurb: 'Boundaries too fine for a crack to find a way through.',
           does: 'four times the hull you started with' },
  hull3: { line: 'hull', tier: 3, name: 'Carbyne Weave',               price:  4_000_000, mul: 8,
           blurb: 'Carbon in single chains — the stiffest thing there is.',
           does: 'eight times the hull you started with' },
  hull4: { line: 'hull', tier: 4, name: 'Metallic Hydrogen Shell',     price:  8_000_000, mul: 16,
           blurb: 'Hydrogen crushed until it agrees to be a metal.',
           does: 'sixteen times the hull you started with' },
  hull5: { line: 'hull', tier: 5, name: 'Degenerate Matter Plating',   price: 16_000_000, mul: 32,
           blurb: 'Matter held up by the exclusion principle alone.',
           does: 'thirty-two times the hull — a Hive can be fought alone' },

  // --- shields, out of generator work ---
  shld1: { line: 'shld', tier: 1, name: 'Superconducting Flux Loop',   price:  1_000_000, mul: 2,
           blurb: 'A current that never once loses its place.',
           does: 'twice the shield, on every ship you will ever fly' },
  shld2: { line: 'shld', tier: 2, name: 'Magnetohydrodynamic Bottle',  price:  2_000_000, mul: 4,
           blurb: 'The plasma is held by the field it is making.',
           does: 'four times the shield you started with' },
  shld3: { line: 'shld', tier: 3, name: 'Casimir Vacuum Array',        price:  4_000_000, mul: 8,
           blurb: 'Two plates close enough to lean on empty space.',
           does: 'eight times the shield you started with' },
  shld4: { line: 'shld', tier: 4, name: 'Zero-Point Tap',              price:  8_000_000, mul: 16,
           blurb: 'Drawing on the floor the vacuum cannot go below.',
           does: 'sixteen times the shield you started with' },
  shld5: { line: 'shld', tier: 5, name: 'Degenerate Plasma Envelope',  price: 16_000_000, mul: 32,
           blurb: 'A shell of collapsed plasma that will not compress.',
           does: 'thirty-two times the shield — a Hive can be fought alone' },

  // --- the tech tree, which is not a ladder ---
  //
  // Everything above is a rung: five tiers of one idea, each superseding the one
  // below it. The tree is the other shape — permanent things that are not more of
  // anything, bought once, in any order. It shares the mask and every function
  // that reads it, and differs only in which lines the panel lists on which page.
  // TREE, below, is the whole seam.
  //
  // Each tree entry is its OWN `line` with one tier on it, and that is not
  // ceremony. whyNotBuild refuses anything more than one tier above what you own,
  // so two unrelated upgrades sharing a line would make the second say "you are
  // already past this one" the moment you bought the first. A line per upgrade
  // costs one string and leaves room for any of them to grow a second tier later
  // without touching a single function.
  pocket1: { line: 'pocket', tier: 1, name: 'Pocket Dimension', price: POCKET_PRICE,
             blurb: 'A hold with the far end somewhere else entirely.',
             does: `sells your ore every ${POCKET_EVERY}s, wherever you are` },
};

// The bit order, frozen. Anything new is appended.
export const MODULE_KEYS = Object.keys(MODULES);
export const LINES = ['mine', 'hull', 'shld'];

// THE SEAM. The tech tree's lines, in page order — a second permanent upgrade is
// this array growing by one string, MODULES growing by one entry with its own
// line, LINE_NAME growing by one and LOOKS growing by one. No function changes,
// because the tree is the ladder machinery pointed at different lines.
export const TREE = ['pocket'];

export const LINE_NAME = { mine: 'Mining', hull: 'Hull', shld: 'Shields',
                           pocket: 'Pocket Dimension' };
export const modulePrice = key => MODULES[key]?.price ?? Infinity;
export const tiersOf = line => MODULE_KEYS.filter(k => MODULES[k].line === line);

// --- the mask -----------------------------------------------------------------
export const bitOf    = key => MODULE_KEYS.indexOf(key);
export const hasMod   = (mask, key) => bitOf(key) >= 0 && ((mask | 0) & (1 << bitOf(key))) !== 0;
export const addMod   = (mask, key) => bitOf(key) < 0 ? (mask | 0) : (((mask | 0) | (1 << bitOf(key))) >>> 0);
export const modsOf   = mask => MODULE_KEYS.filter((k, i) => (mask | 0) & (1 << i));
// Bits nobody defines are dropped, so a hand-edited save cannot smuggle in a
// module that does not exist and an old save naming a retired one loses it
// cleanly rather than drawing a part that is no longer there.
export const sanitiseMods = mask =>
  ((Number.isFinite(+mask) ? Math.floor(+mask) : 0) & ((1 << MODULE_KEYS.length) - 1)) >>> 0;

// Whether this pilot's station has a Pocket Dimension. A function rather than the
// string 'pocket1' written into the server tick and the client HUD, because a rule
// that exists twice will disagree — and this one decides whether ore becomes money.
export const hasPocket = mask => hasMod(mask, 'pocket1');

// The highest tier built on a line, and the next one you could buy.
export const tierOn = (mask, line) =>
  tiersOf(line).reduce((n, k) => hasMod(mask, k) ? Math.max(n, MODULES[k].tier) : n, 0);
export const nextOn = (mask, line) =>
  tiersOf(line).find(k => MODULES[k].tier === tierOn(mask, line) + 1) ?? null;

// --- what it earns ------------------------------------------------------------
//
// The highest mining tier, NOT the sum. A tier supersedes the one below it rather
// than stacking with it — otherwise the ladder is an exponent and buying the
// bottom rung twice as often beats climbing.
export function incomeOf(mask) {
  let best = 0;
  for (const k of tiersOf('mine')) if (hasMod(mask, k)) best = Math.max(best, MODULES[k].rate ?? 0);
  return best;
}

// The one place time turns into money. Both the tick and the login path call it,
// rather than each doing its own arithmetic and drifting.
export const earnedOver = (mask, secs) =>
  Math.max(0, Math.floor(incomeOf(mask) * Math.max(0, secs)));

// Nobody banks more than this in one go. A clock that jumps, a hand-edited
// timestamp or a save restored from a backup are all credit printers otherwise,
// and a cap is a cheaper defence than trusting a number off the disk.
export const OFFLINE_CAP_H = 72;
export const cappedSecs = secs => Math.min(Math.max(0, secs), OFFLINE_CAP_H * 3600);

// --- what it makes you --------------------------------------------------------
//
// Highest tier wins, same as mining, and for the same reason.
export const mulOn = (mask, line) => {
  let best = 1;
  for (const k of tiersOf(line)) if (hasMod(mask, k)) best = Math.max(best, MODULES[k].mul ?? 1);
  return best;
};

// Applied to a resolved stat block, by BOTH sides. The client draws the bars from
// it and the server decides what kills you, so a second copy of this arithmetic
// would mean a pilot watching a hull bar that is not the hull they have.
//
// It multiplies rather than adds, which is the one place this codebase allows it:
// the ladder is bought with credits every pilot can earn, not granted by a rank,
// so it is a gate on time rather than a fight a newcomer cannot win. It is also
// applied AFTER resolve(), so it scales what the shops sold you instead of
// changing what they sell — no hull dominates another because of it.
export function applyResearch(stats, mask) {
  if (!mask || !stats) return stats;
  const h = mulOn(mask, 'hull'), s = mulOn(mask, 'shld');
  if (h === 1 && s === 1) return stats;
  return { ...stats, hull: stats.hull * h, shield: stats.shield * s };
}

// --- why you cannot -----------------------------------------------------------
// One function each, so the button, the tooltip and the server give one answer.
export function whyNotStake({ credits = 0, docked = false, has = false, room = true, plots = 0 } = {}) {
  if (has)     return 'you already have a research station';
  if (!docked) return 'stake it at your own dock';
  if (!room)   return `the yard is full — ${plots} plots, all taken`;
  if (credits < LAB_PRICE) return `costs ${LAB_PRICE} cr — you cannot pay yet`;
  return null;
}

// A mining tier is a rock somebody is already sitting on: you have to free it
// before you can build the rig that works it. `claims` is which ones this pilot
// has freed — see shared/arena.js — and it is checked BEFORE the price on purpose.
// A row that only offers the claim once you can already afford the module would
// hide the whole fight from every pilot who has not saved up yet, and the fight is
// the thing you are meant to go and do while you save.
export const needsClaim = key => MODULES[key]?.line === 'mine';

export function whyNotBuild(key, { credits = 0, mask = 0, near = false, claims = [] } = {}) {
  const m = MODULES[key];
  if (!m) return 'no such module';
  if (!near) return 'fly to your station to build on it';
  if (hasMod(mask, key)) return 'already built';
  const want = tierOn(mask, m.line) + 1;
  if (m.tier > want) return `build the tier below it first`;
  if (m.tier < want) return 'you are already past this one';
  if (needsClaim(key) && !claims.includes(key)) return 'the claim is contested — free the rock first';
  if (credits < m.price) return `costs ${m.price} cr — you cannot pay yet`;
  return null;
}

// How close you have to be to work on it. Generous: a lab is 26px across and
// hunting for it in your own base ring is not gameplay.
export const REACH = 220;
export const nearLab = (lab, ship) =>
  !!lab && Math.hypot(lab.x - ship.x, lab.y - ship.y) < REACH;

// --- what it looks like -------------------------------------------------------
//
// Derived from the mask alone, so every viewer draws the same lab with nothing
// extra on the wire and a new module changes the picture by existing. A module
// with no entry here draws nothing rather than throwing — rule seven's seam.
export const LOOKS = {
  mine1: { part: 'boom',  at: 0.00 },
  mine2: { part: 'boom',  at: 0.33 },
  mine3: { part: 'boom',  at: 0.66 },
  hull1: { part: 'plate', at: 0.15 },
  hull2: { part: 'plate', at: 0.35 },
  hull3: { part: 'plate', at: 0.55 },
  hull4: { part: 'plate', at: 0.75 },
  hull5: { part: 'plate', at: 0.95 },
  shld1: { part: 'ring',  at: 0.20 },
  shld2: { part: 'ring',  at: 0.40 },
  shld3: { part: 'ring',  at: 0.60 },
  shld4: { part: 'ring',  at: 0.80 },
  shld5: { part: 'ring',  at: 1.00 },
  // The tree gets its own part rather than a fourth boom or a sixth plate: the
  // whole first 500,000 buys a thing other people can see is yours, and a ten
  // million credit module that changed nothing about the picture would be the one
  // purchase in the yard nobody can tell you made.
  pocket1: { part: 'rift', at: 0.50 },
};
export const partsOf = mask => modsOf(mask).map(k => LOOKS[k]).filter(Boolean);

// --- the panel ----------------------------------------------------------------
//
// Its own geometry rather than the station panel's, because it is a different kind
// of list: three ladders you climb one rung at a time, not shelves you browse. It
// borrows the row height so the two read as the same game.
//
// UI geometry is a shared rule (see CLAUDE.md rule one) — the client both draws
// and hit-tests from this, because a row you can see and cannot click is the same
// bug as a row outside its panel, and that has happened twice.
// 78 rather than 62: a row carries four lines now. What the rung is called, what it
// does to YOUR ship, what that is worth, and — only if you cannot pay — how far off
// you are. The price used to REPLACE the gain when you could not afford it, which
// is precisely backwards: the moment a pilot most needs to know what they are
// saving toward is the moment they cannot buy it yet.
// 124 rather than 96: the header carries a tab strip now. A cleared claim is
// replayable, and a replay is not a rung — it buys nothing, so it cannot be a
// button on the ladder without lying about what the ladder is. It is its own page.
export const LAB_ROW = 78, LAB_HEAD = 124, LAB_W = 560, LAB_PAD = 18;
export const TAB_H = 26, TAB_TOP = 82;
// The three pages of the research station, as data rather than as three functions:
// what you are building, what you have to fight for the right to build, and what
// is not a ladder at all.
export const LAB_TABS = [
  { key: 'ladder', name: 'RESEARCH' },
  { key: 'claims', name: 'CLAIMS' },
  { key: 'tree',   name: 'TECH TREE' },
];
export const LAB_TAB_KEYS = LAB_TABS.map(t => t.key);

// The panel is ONE SIZE whatever page is on it, so a tab switch never moves the
// rows under the cursor. It is sized for the longest page — three ladders, three
// mining tiers, and however many upgrades the tree has grown — so adding the
// second tree entry widens nothing and adding the fourth makes the panel taller
// on every page at once, which is the behaviour that keeps the tabs interchangeable.
export function labPanel(VIEW_W, VIEW_H, tab = 'ladder') {
  const page = LAB_TAB_KEYS.includes(tab) ? tab : 'ladder';
  const keys = page === 'claims' ? tiersOf('mine') : page === 'tree' ? TREE : LINES;
  const n = Math.max(LINES.length, tiersOf('mine').length, TREE.length);
  const w = Math.min(LAB_W, VIEW_W - 40);
  const want = LAB_HEAD + n * (LAB_ROW + 10) + LAB_PAD;
  const h = Math.min(VIEW_H - 80, want);
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
  // On a window too short for the full list the rows CLOSE UP rather than running
  // out of the bottom of the panel. Three rows drawn where they cannot be clicked
  // is the same bug as a row outside its panel, and this codebase has shipped that
  // twice — so the spacing is derived from the height that actually exists.
  const room = h - LAB_HEAD - LAB_PAD;
  const step = Math.min(LAB_ROW + 10, Math.floor(room / n));
  const rowH = Math.max(28, step - 10);
  const rows = keys.map((k, i) => ({
    line: page === 'claims' ? 'mine' : k, key: page === 'claims' ? k : null,
    r: { x: x + LAB_PAD, y: y + LAB_HEAD + i * step, w: w - LAB_PAD * 2, h: rowH },
  }));
  // The strip, laid out in the header rather than over the first row. A tab you can
  // see and cannot click is the same bug as a row outside its panel; both come from
  // the caller drawing one rectangle and hit-testing another, so there is one.
  const tw = Math.floor((w - LAB_PAD * 2) / LAB_TABS.length);
  const tabs = LAB_TABS.map((t, i) => ({
    ...t, on: t.key === page,
    r: { x: x + LAB_PAD + i * tw, y: y + TAB_TOP, w: tw, h: TAB_H },
  }));
  return { tab: page, panel: { x, y, w, h }, rows, tabs,
           close: { x: x + w - 30, y: y + 10, w: 20, h: 20 } };
}

// What the next rung would actually DO to the ship you are flying, in the numbers
// on your own hull bar.
//
// "twice the hull" is a fact about the module. "1,900 -> 3,800" is a fact about
// YOU, and it is the one that decides whether 1,000,000 credits is worth it — a
// pilot cannot tell whether "stronger" means one percent or one hundred, and being
// told the multiple is not the same as being shown the number you will have.
//
// `stats` is the ship as resolve() gives it, BEFORE research is applied, because
// applyResearch multiplies that. The panel passes myStats() and the server never
// needs this — it is the one thing in here that exists purely to be read.
export function rungGain(mask, line, stats) {
  const next = nextOn(mask, line);
  if (!next) return null;
  const m = MODULES[next];
  if (line === 'mine') {
    const now = incomeOf(mask), then = m.rate ?? 0;
    return { kind: 'mine', now, then,
             label: `${now} -> ${then} ${'cr'}/s`,
             sub: `${Math.round(then * 86400 / 1000)}k a day, flying or not` };
  }
  // Anything that is not one of the three ladders has no rung to quote here — the
  // tree's rows are priced in what they PAY rather than in what they make your
  // ship, and treeGain does that. Named rather than implied: this line used to
  // read `line === 'hull' ? 'hull' : 'shield'`, which silently quoted a Pocket
  // Dimension as a shield upgrade the first time the tree page drew.
  if (line !== 'hull' && line !== 'shld') return null;
  const key = line === 'hull' ? 'hull' : 'shield';
  const base = stats?.[key];
  if (!Number.isFinite(base)) return null;
  // The base is what the shops sold you, so divide the multiplier back out: what
  // you are looking at on the bar already has the tier you own folded into it.
  const bare = base / mulOn(mask, line);
  const now = Math.round(bare * mulOn(mask, line)), then = Math.round(bare * (m.mul ?? 1));
  return { kind: key, now, then,
           label: `your ${key} ${now.toLocaleString('en-US')} -> ${then.toLocaleString('en-US')}`,
           sub: `x${(then / Math.max(1, now)).toFixed(2)} what you have now, on every ship you fly` };
}

// What one row says, so the panel and its test cannot disagree about it.
// How far off you are, in words short enough to sit beside the gain rather than
// instead of it. whyNotBuild's sentence is for a refusal; this is for a goal.
export function shortOf(mask, line, credits) {
  const next = nextOn(mask, line);
  if (!next) return null;
  const gap = MODULES[next].price - credits;
  return gap > 0 ? gap : 0;
}

// What a tree row is worth, in the hold the pilot is carrying RIGHT NOW.
//
// Same argument as rungGain's: "sells your ore automatically" is a fact about the
// module, and "the 12,840 credits under you become 7,222" is a fact about you, and
// only the second one decides whether ten million is worth it. A pilot cannot tell
// whether "your ore" means a rounding error or a second income, and the answer
// depends entirely on what they have been scooping.
//
// It reads the LIVE hold rather than a hypothetical one on purpose — a pilot who
// opens this page with an empty hold is told what the module does instead of being
// quoted a zero, because the zero would be a fact about this second rather than
// about the purchase. A key with no entry gets null and the row falls back to
// `does`, which is rule seven's seam: a second tree upgrade draws correctly
// before anybody writes it a gain line.
export function treeGain(key, hold = {}) {
  if (key !== 'pocket1') return null;
  const worth = holdValue(hold ?? {}), paid = pocketValue(hold ?? {});
  return {
    kind: 'pocket', worth, paid,
    label: worth > 0
      ? `your hold now: ${fmtCredits(worth)} -> ${fmtCredits(paid)} every ${POCKET_EVERY}s`
      : `nothing aboard right now — this sells what you scoop, as you scoop it`,
    // Short on purpose. A row is 524px wide at 9px type, which is about ninety
    // characters, and the first draft ran to a hundred and eighteen — the render
    // harness reported it as a sentence written across the panel it belongs to.
    // The ladder is the only thing that has to fit: the rest is on the row above.
    sub: `${Math.round(POCKET_RATE * 100)}% of dock value — the dock pays 100%, ` +
         `a pirate counter ${Math.round(PIRATE_RATE * 100)}%`,
  };
}

export function rowState(mask, line, credits, claims = []) {
  const at = tierOn(mask, line), next = nextOn(mask, line);
  const m = next ? MODULES[next] : null;
  return {
    line, name: LINE_NAME[line], tier: at, max: tiersOf(line).length,
    built: at ? MODULES[tiersOf(line).find(k => MODULES[k].tier === at)].name : null,
    next, nextName: m?.name ?? null, price: m?.price ?? 0, does: m?.does ?? null,
    afford: !!m && credits >= m.price,
    // What the row's one button does. A mining rung whose rock is still held is a
    // CLAIM before it is a purchase, and the panel needs to know which without
    // working it out a second time.
    claim: !!m && needsClaim(next) && !claims.includes(next),
    done: !m,
  };
}
