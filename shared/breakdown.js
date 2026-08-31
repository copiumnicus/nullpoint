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

import { ATTRS, resolve } from './ships.js';
import { EQUIPMENT, emptyFit } from './gear.js';
import { escortOf } from './sim.js';
import { applyResearch } from './research.js';

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

// What is worth showing. Not every attribute — ATTRS carries the ability dials and
// the escort bookkeeping, and a stats page that lists `veilRecover` beside `hull`
// is a debug dump rather than something a pilot reads.
export const SHOWN = ['hull', 'shield', 'shieldRegen', 'damage', 'fireRate',
                      'weaponRange', 'speed', 'accel', 'radar', 'signature', 'cargo'];

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
  for (const key of SHOWN) {
    const a = ATTRS[key];
    if (!a) continue;
    const steps = [];
    let prev = L.hull[key];
    for (const layer of LAYERS.slice(1)) {
      const now = L[layer][key];
      if (Math.abs(now - prev) > 1e-9) steps.push({ layer, from: prev, to: now });
      prev = now;
    }
    rows.push({ key, label: a.label, unit: a.unit ?? '', pct: !!a.pct,
                base: L.hull[key], final: prev, steps,
                // A stat nothing touched is still worth a line: its absence would
                // read as "this ship has no cargo hold" rather than "nothing you
                // bought changed it".
                touched: steps.length > 0 });
  }
  return rows;
}

// --- the panel's own numbers --------------------------------------------------
// It rides in the station panel beside the shop, so it borrows the row height and
// only needs to say how tall one attribute is with its layers under it.
export const STAT_ROW = 34, STAT_STEP = 15;
export const rowHeight = row => STAT_ROW + row.steps.length * STAT_STEP;
