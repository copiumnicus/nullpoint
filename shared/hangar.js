// Station panel geometry.
//
// Lives here rather than inline in the client so tests can check every row is
// reachable — a list that outgrows its panel silently becomes unclickable, which
// is how the old module rack broke.

import { HULLS, slotsOf } from './ships.js';
import { EQUIPMENT, SLOTS, MAX_DRONES } from './gear.js';
import { FORMATION_KEYS } from './formation.js';

export function bayLayout(VIEW_W, VIEW_H, hullKey, droneCount = 0) {
  const w = Math.min(980, VIEW_W - 50), h = Math.min(600, VIEW_H - 50);
  const x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
  const colW = (w - 60) / 3, top = y + 88;
  const FOOTER = 46;
  const room = h - (top - y) - FOOTER;

  const hKeys = Object.keys(HULLS);
  const hStep = Math.min(62, room / hKeys.length);
  const hulls = hKeys.map((k, i) => ({ k, r: { x: x + 20, y: top + i * hStep, w: colW, h: hStep - 8 } }));

  // one row per slot the hull actually has, grouped by kind
  const racks = [];
  const counts = slotsOf(hullKey) ?? { weapon: 0, generator: 0, tech: 0 };
  const drones = Math.min(MAX_DRONES, droneCount);
  const buyRow = drones < MAX_DRONES ? 1 : 0;
  const total = SLOTS.reduce((n, s) => n + (counts[s] ?? 0), 0) + SLOTS.length
              + 1 + drones + buyRow
              + 1 + FORMATION_KEYS.length;                 // + drone rows, + formation rows
  const rStep = Math.min(34, room / total);
  let ry = top;
  for (const slot of SLOTS) {
    const header = { slot, header: true, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } };
    racks.push(header);
    ry += rStep;
    for (let i = 0; i < (counts[slot] ?? 0); i++) {
      racks.push({ slot, index: i, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } });
      ry += rStep;
    }
  }

  // Drone bays sit under the ship's own racks, with a buy row while there is room.
  racks.push({ slot: 'drone', header: true, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } });
  ry += rStep;
  for (let i = 0; i < drones; i++) {
    racks.push({ slot: 'drone', index: i, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } });
    ry += rStep;
  }
  if (buyRow) { racks.push({ slot: 'drone', buy: true, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } }); ry += rStep; }

  racks.push({ slot: 'form', header: true, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } });
  ry += rStep;
  for (const k of FORMATION_KEYS) {
    racks.push({ slot: 'form', key: k, r: { x: x + 30 + colW, y: ry, w: colW, h: rStep - 6 } });
    ry += rStep;
  }

  const sKeys = Object.keys(EQUIPMENT);
  const sStep = Math.min(52, room / sKeys.length);
  const store = sKeys.map((k, i) => ({ k, r: { x: x + 40 + colW * 2, y: top + i * sStep, w: colW, h: sStep - 8 } }));

  return { panel: { x, y, w, h }, colW, top, hulls, racks, store };
}
