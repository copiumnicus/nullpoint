// Where your numbers came from.
//
// A finished ship is a hull, plus everything bolted to it, plus the technologies in
// its tech slots, plus a research ladder that multiplies two of the results — and
// the only thing the game ever showed was the answer. A pilot looking at 91,200
// hull had no way to find out that 1,900 of it was the ship and the rest was four
// purchases and a multiplier, and no way to tell which of those was worth more.
//
// This does not re-derive anything. It calls the SAME resolve() the game runs, four
// times, with progressively more of the fit — so a layer is exactly the difference
// the game itself would compute, and a second copy of the arithmetic cannot drift
// from the first. That is the whole design: the breakdown is a series of stops
// along the real pipeline rather than a model of it.

import { ATTRS, HULLS, resolve } from './ships.js';
import { EQUIPMENT, emptyFit } from './gear.js';
import { escortOf } from './sim.js';
import { applyResearch } from './research.js';
import { ABILITIES, attrAbility } from './ability.js';
import { BOOST } from './power.js';

// The order they are applied in, which is the order they are shown in. Equipment
// before technologies because a technology multiplies what the equipment added —
// showing them the other way round would make a technology look smaller than it is.
export const LAYERS = ['hull', 'gear', 'tech', 'research'];
export const LAYER_NAME = {
  hull:     'the ship itself',
  gear:     'guns, generators and the escort',
  tech:     'technologies',
  research: 'research station',
};

// --- what a number IS ---------------------------------------------------------
//
// Three shapes, and every one of them is READ OFF ATTRS rather than listed again
// here. A fourth hand-written list is exactly what this file is being fixed for.
//
//   share     a fraction of something. `pct` says so outright, and so does a
//             ceiling of at most 1 — you cannot cap an amount at 0.9, so a `max`
//             that low is a fraction by construction. Picks out shieldRegen,
//             sustain, veilDepth, anchorDrag and drumfireReach, which is all of
//             them.
//   multiple  measured in 'x'. Picks out escort, anchorSwell and drumfireGain,
//             which is all of them.
//   amount    everything else: hull, seconds, pixels, rounds.
//
// It matters because the page printed `Math.round(v)` for everything. Shield regen
// read "0.0%" where the truth is "1.8%/s, 56s to refill"; a rate of fire of 1.2
// read "1"; a sustain of 0.33 read "0"; an escort bonus of 1 read "1x". Eleven
// attributes could survive that. Twenty-five cannot.
export const SHAPES = ['amount', 'share', 'multiple'];

// A row of `boost` that ATTRS has no entry for, because resolve() DERIVES it —
// the reactor ceiling is what your generators handed back for the speed they cost
// you, and there is nowhere else in the game it is written down. It is the one
// number on this page that is not an attribute, and it is here rather than in
// ATTRS because nothing may fit it: it is an outcome, not a dial.
export const DERIVED = {
  boost: { label: 'Reactor ceiling', unit: '', better: 'high', pct: true, dflt: BOOST },
};

const meta = key => ATTRS[key] ?? DERIVED[key] ?? null;

export function shapeOf(key) {
  const a = meta(key);
  if (!a) return 'amount';
  if (a.pct || (a.max !== undefined && a.max <= 1)) return 'share';
  if (a.unit === 'x') return 'multiple';
  return 'amount';
}

// Significant digits rather than whole numbers: 10,792 does not want decimals and
// 1.2 is destroyed by losing them. The same ladder tooltip.js uses on a shop row,
// because a pilot reading "Rate of fire 1.2/s" in a tip and "1" on the stats page
// is two answers to one question.
const round = v => Math.abs(v) >= 100 ? Math.round(v)
                 : Math.abs(v) >= 10  ? Math.round(v * 10) / 10
                                      : Math.round(v * 100) / 100;

// The one place a stat is turned into text. The client draws this and the tests
// read it, so a readout cannot disagree with the claim made about it.
export function fmt(key, v) {
  if (!Number.isFinite(v)) return '—';
  const unit = meta(key)?.unit ?? '';
  switch (shapeOf(key)) {
    // '%/s' is a unit that already contains its own per-cent sign, so the share
    // supplies the number and the unit supplies the rest of it.
    case 'share':    return `${round(v * 100)}%${unit === '%/s' ? '/s' : ''}`;
    case 'multiple': return `x${v.toFixed(2)}`;
    default:         return round(v).toLocaleString('en-US') + unit;
  }
}

// --- what a number MEANS ------------------------------------------------------
//
// A hint is one line, drawn beside the label, and it exists for the stats that a
// number alone does not explain. Note which ones have none: hull, shield, damage,
// speed, thrust. The rows that were already on this page are the self-evident
// ones, and the fourteen that were missing are almost exactly the fourteen that
// needed a sentence — which is most of why they were left off.
//
// Several are a SECOND READING of the same number rather than prose: a shield
// share of 1.8%/s is 56 seconds to refill, and 56 seconds is the number a pilot
// actually wants. Computed from the value in hand, so it cannot quote a stale one.
const HINT = {
  shieldRegen:  v => `${(1 / Math.max(1e-9, v)).toFixed(0)}s to refill the pool, whatever size it grows to`,
  shieldDelay:  () => 'after the last hit before it starts coming back',
  fireRate:     v => `a bolt every ${(1 / Math.max(1e-9, v)).toFixed(2)}s, from every gun you fly`,
  weaponRange:  () => 'how far a bolt reaches before it gives out',
  rockets:      () => 'how many leave the rails in one volley',
  rocketVolley: () => 'damage the whole volley lands, shared out between them',
  radar:        () => 'how far off you find something that is not hiding',
  signature:    () => 'how long you stay on their plot after leaving their radar',
  capacitor:    () => 'seconds of full boost before the reactor runs dry',
  recharge:     () => 'seconds of capacitor back per second, once you stand down',
  sustain:      () => 'the reactor gives away this much output free, forever',
  boost:        () => 'what a fully routed system is worth — generators raise it',
  cohesion:     () => 'drones a formation needs before it pays in full',
  escort:       () => 'and how hard it pays once it does',
  veilDepth:    v => `at full veil they find you at ${Math.round((1 - v) * 100)}% of their radar`,
  veilRecover:  () => 'after a shot before the veil is whole again',
  anchorSwell:  v => `shields x${round(1 + v)} at a full anchor`,
  anchorDrag:   v => `and speed x${round(1 - v)} for it — a wall cannot leave`,
  drumfireGain: v => `every gun and every rack cycles x${round(1 + v)} at a full drum`,
  drumfireReach:v => `and your reach drops to ${Math.round((1 - v) * 100)}% for it — close in`,
};
export const hintOf = (key, v) => HINT[key]?.(v) ?? null;

// A hint is drawn between the label and the value column, so it is the first thing
// a narrow panel has to give up. 58 columns fits down to a 900px window; past that
// the client drops the hint rather than running it under the numbers, and the page
// is still every number it was. Same budget rule as TIP_COLS, same reason.
// Where the value column starts, as a share of the row's width. It was written
// into the client twice — once for the starting value and once for the multiple —
// and the hint has to know it too, so it is one number, here.
export const VALUE_AT = 0.62;
export const HINT_COLS = 58, LABEL_COLS = 22, HINT_CH = 6;
export const LABEL_PX = LABEL_COLS * HINT_CH;
export const hintRoom = w => w * VALUE_AT - (LABEL_COLS + HINT_COLS) * HINT_CH >= 0;

// Whether a move was a GOOD one, which is not the same as whether it went up.
//
// The page coloured every rise green and every fall amber. That survived eleven
// attributes because ten of them are better-high; it does not survive twenty-five,
// six of which are better-low. A Null Skin cutting your signature by 55% is the
// best thing on the shelf and drew in the colour this page uses for a penalty, and
// an Anchor drag falling from 80% to 32% — the entire point of Anchor Servos —
// drew as damage done to your ship.
export const improves = (key, from, to) =>
  to === from ? null : (meta(key)?.better !== 'low') === (to > from);

// --- the groups ---------------------------------------------------------------
//
// Twenty-five rows in one column is a wall, and the wall is why nobody noticed
// fourteen of them were not there. So the page is sectioned — and the sections are
// a fact about the attribute, which means they belong beside `label` and `unit` on
// the ATTRS row itself. They are not there yet only because ships.js is being
// reworked in another pair of hands this week; `groupOf` reads `ATTRS[k].group`
// first and falls back to the table below, so moving one is a line of data rather
// than a change here. THE SEAM IS THE `??`.
//
// The order is the order a pilot asks the questions in: what keeps me alive, what
// do I shoot with, how do I move, what can I see, what can I carry, what feeds all
// of it, what flies with me — and then the one thing this ship can do that the
// others cannot.
export const GROUPS = [
  { key: 'vitals',  name: 'HULL AND SHIELDS', of: ['hull', 'shield', 'shieldRegen', 'shieldDelay'] },
  { key: 'guns',    name: 'WEAPONS',          of: ['damage', 'fireRate', 'weaponRange', 'rockets', 'rocketVolley'] },
  { key: 'move',    name: 'ENGINES',          of: ['speed', 'accel'] },
  { key: 'sight',   name: 'SENSORS',          of: ['radar', 'signature'] },
  { key: 'hold',    name: 'HOLD',             of: ['cargo'] },
  { key: 'reactor', name: 'REACTOR',          of: ['capacitor', 'recharge', 'sustain', 'boost'] },
  { key: 'escort',  name: 'ESCORT',           of: ['cohesion', 'escort'] },
];

export const groupOf = key =>
  ATTRS[key]?.group ?? GROUPS.find(g => g.of.includes(key))?.key ?? (attrAbility(key) ? 'ability' : null);

// The ability group is DERIVED, not declared, and it is the only one that is.
//
// `attrAbility` reads the ability off the attribute's own name, which is the same
// test the shop uses to refuse to sell a Null Skin to a Bulwark and the same one
// the tooltip uses to say "Nothing on this hull". A Veil depth is not a fact about
// a Bulwark — the game already says so in two other places — so listing one here
// would be a debug dump that contradicts the counter two tabs away. And the hull
// that HAS the ability is the only place a pilot can ever see what Anchor Servos
// did to their Anchor, so hiding it everywhere is the incompleteness being
// complained about, one row further along.
//
// Ordered by ATTRS' own declaration order, so a dial and its cost stay adjacent
// (depth then rebuild, swell then drag, bite then cost) without a second list
// saying so.
export const abilityAttrs = ability =>
  ability ? Object.keys(ATTRS).filter(k => attrAbility(k) === ability) : [];

export function groupsFor(hullKey) {
  const ability = HULLS[hullKey]?.ability ?? null;
  const ab = ABILITIES[ability];
  return [...GROUPS, ab
    ? { key: 'ability', name: ab.name.toUpperCase(), of: abilityAttrs(ability),
        note: ab.blurb, colour: ab.colour }
    // A Hauler is not missing a section, it is a ship without one, and an absent
    // heading says the first thing rather than the second.
    : { key: 'ability', name: 'FOURTH SYSTEM', of: [],
        note: 'No system of its own — the other three hulls each have one.' }];
}

// Every attribute the page can show, in page order, ability dials last. The guard
// test compares this against ATTRS: an attribute added there and never given a
// group fails the suite by name rather than quietly never appearing.
export const SHOWN = [...GROUPS.flatMap(g => g.of),
                      ...Object.keys(ATTRS).filter(k => attrAbility(k))];

const only = (fit, keep) => {
  const out = emptyFit();
  for (const slot of Object.keys(out)) out[slot] = keep.includes(slot) ? [...(fit?.[slot] ?? [])] : [];
  return out;
};

// The four stops, each one the real resolve() with more of the ship in it.
//
// `gear` deliberately includes the escort and the formation: a drone is a gun you
// paid for and the formation is what arranges them, so they belong with the things
// you bought rather than in a category of their own. Technologies sit in their own
// slot and are the only thing separated out, because they are the layer whose
// contribution is impossible to guess.
export function layersOf({ hull, fit, drones = [], rig = null, formation, mask = 0 } = {}) {
  // `drones` is an ARRAY of equipment keys here. bayLayout's own state carries a
  // drone COUNT under the same name, and feeding that in throws inside resolve —
  // which took the whole station panel down the first time this was wired. Guarded
  // rather than trusted: a stats page is a readout, and a readout that can crash
  // the screen it is drawn on is worse than no readout.
  const escort = escortOf(Array.isArray(drones) ? drones : [], rig);
  const base = resolve(hull, emptyFit(), [], formation);
  const gear = resolve(hull, only(fit, ['weapon', 'generator']), escort, formation);
  const tech = resolve(hull, fit, escort, formation);
  const all  = applyResearch(tech, mask);
  return { hull: base, gear, tech, research: all };
}

// One row per attribute: where it started, what each layer did to it, and where it
// ended. `from`/`to` per layer rather than a single delta, because "+2,300" says
// nothing next to "1,900 -> 4,200" and a multiplier says nothing at all without
// the number it multiplied.
export function rowsOf(opts) {
  const L = layersOf(opts);
  const rows = [];
  for (const g of groupsFor(opts?.hull)) {
    // A heading is a row like any other so the scroller only has one kind of thing
    // to measure. `steps: []` keeps rowHeight and every reader of `.steps` honest.
    rows.push({ header: true, key: g.key, label: g.name, note: g.note ?? null,
                colour: g.colour ?? null, steps: [] });
    for (const key of g.of) {
      if (!meta(key)) continue;                       // an unknown row is skipped, never drawn as NaN
      const steps = [];
      let prev = L.hull[key];
      for (const layer of LAYERS.slice(1)) {
        const now = L[layer][key];
        if (Math.abs(now - prev) > 1e-9) steps.push({ layer, from: prev, to: now });
        prev = now;
      }
      rows.push({ key, group: g.key, label: meta(key).label, shape: shapeOf(key),
                  base: L.hull[key], final: prev, steps,
                  hint: hintOf(key, prev),
                  // A stat nothing touched is still worth a line: its absence would
                  // read as "this ship has no cargo hold" rather than "nothing you
                  // bought changed it".
                  touched: steps.length > 0 });
    }
  }
  return rows;
}

// --- the panel's own numbers --------------------------------------------------
// It rides in the station panel beside the shop, so it borrows the row height and
// only needs to say how tall one attribute is with its layers under it.
export const STAT_ROW = 34, STAT_STEP = 15, HEAD_ROW = 30;
export const rowHeight = row => row.header ? HEAD_ROW : STAT_ROW + row.steps.length * STAT_STEP;
