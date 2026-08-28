// Station panel geometry.
//
// Lives here rather than inline in the client so tests can check every row is
// reachable — a list that outgrows its panel silently becomes unclickable, which
// is how the old module rack broke.
//
// Two tabs, because they are two different jobs. HANGAR is your ship: what you
// already own, arranged how you want it. STORE is spending money, split into
// pages so a single scrolling column never has to hold ships, guns, reactors,
// technology, drones and formations at once.

import { HULLS, slotsOf } from './ships.js';
import { EQUIPMENT, SLOTS, MAX_DRONES, emptyFit } from './gear.js';
import { launcherRoom } from './rockets.js';
import { FORMATION_KEYS } from './formation.js';

export const TABS = [{ key: 'hangar', name: 'HANGAR' }, { key: 'store', name: 'STORE' }];

export const STORE_PAGES = [
  { key: 'ships',     name: 'Ships',       hint: 'hulls and their racks' },
  { key: 'weapon',    name: 'Lasers',      hint: 'emitters — a bolt you can dodge, thrown fast' },
  { key: 'rocket',    name: 'Launchers',   hint: 'rockets — slower, and they follow you' },
  { key: 'generator', name: 'Generators',  hint: 'reactor and shield capacity' },
  { key: 'tech',      name: 'Technology',  hint: 'one of each, every one a trade' },
  { key: 'drones',    name: 'Drones',      hint: 'escort, one slot apiece' },
  { key: 'forms',     name: 'Formations',  hint: 'how the escort flies' },
];

// What a store page holds. Kinds tell the client how to draw and what to send.
export function pageItems(page, { hulls = [], formations = [], drones = 0 } = {}) {
  switch (page) {
    case 'ships':  return Object.keys(HULLS).map(k => ({ kind: 'hull', k, owned: hulls.includes(k) }));
    case 'drones': return drones < MAX_DRONES ? [{ kind: 'drone', k: 'drone', owned: false }] : [];
    case 'forms':  return FORMATION_KEYS.map(k => ({ kind: 'form', k, owned: formations.includes(k) }));
    // Both weapon pages draw from the same slot, split by what the thing does.
    case 'weapon': return Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'laser')
                     .map(k => ({ kind: 'item', k, owned: false }));
    case 'rocket': return Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'rocket')
                     .map(k => ({ kind: 'item', k, owned: false }));
    default:       return Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === page)
                     .map(k => ({ kind: 'item', k, owned: false }));
  }
}

// What the locker can put in one slot, best first. "Best" is the tier you paid
// most for, because filling an empty slot with whatever happened to sort first
// meant a pilot holding MK-Vs kept getting MK-Is bolted on.
export function fitsIn(target, { gear = {}, fit = emptyFit(), drones = [] } = {}) {
  const held = k => (gear[k] ?? 0) > 0;
  const takenTech = new Set([...(fit.tech ?? []), ...drones.filter(Boolean)]
    .filter(k => EQUIPMENT[k]?.slot === 'tech'));
  return Object.keys(EQUIPMENT)
    .filter(k => held(k))
    .filter(k => (target === 'drone'
      // A drone takes anything the ship itself could carry, minus rockets.
      ? EQUIPMENT[k].kind !== 'rocket'
      : EQUIPMENT[k].slot === target))
    .filter(k => !(EQUIPMENT[k].slot === 'tech' && takenTech.has(k)))
    .filter(k => !(EQUIPMENT[k].kind === 'rocket' && launcherRoom(fit) <= 0))
    .sort((a, b) => (EQUIPMENT[b].tier ?? 0) - (EQUIPMENT[a].tier ?? 0)
                 || EQUIPMENT[b].price - EQUIPMENT[a].price);
}

// The chooser that drops out of an empty slot. Anchored to the row that opened
// it, flipped upward when it would run off the bottom of the panel.
export const PICK_ROW = 30;
export function pickerLayout(G, row, items) {
  const w = G.colW + 40, h = 8 + items.length * PICK_ROW;
  const x = Math.min(row.r.x, G.panel.x + G.panel.w - w - 8);
  const below = row.r.y + row.r.h + 4;
  const y = below + h > G.panel.y + G.panel.h - 8 ? Math.max(G.panel.y + 8, row.r.y - h - 4) : below;
  return { box: { x, y, w, h },
           rows: items.map((k, i) => ({ k, r: { x: x + 6, y: y + 4 + i * PICK_ROW, w: w - 12, h: PICK_ROW - 4 } })) };
}

export function bayLayout(VIEW_W, VIEW_H, s = {}) {
  const { tab = 'hangar', page = 'ships', hull: hullKey, drones: droneCount = 0,
          hulls = [], formations = [], gear = {} } = s;
  const w = Math.min(980, VIEW_W - 50), h = Math.min(600, VIEW_H - 50);
  const x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
  const colW = (w - 60) / 3, top = y + 96;
  const FOOTER = 46;
  const room = h - (top - y) - FOOTER;

  // Tabs sit in the header, left of the credit line.
  const tabs = TABS.map((t, i) => ({ ...t, r: { x: x + 20 + i * 104, y: y + 14, w: 96, h: 26 } }));

  const out = { panel: { x, y, w, h }, colW, top, room, tab, page, tabs,
                hulls: [], racks: [], pages: [], store: [] };

  if (tab === 'hangar') {
    // col 0: hulls you own. col 1: the ship's own racks. col 2: escort.
    const owned = Object.keys(HULLS).filter(k => hulls.includes(k) || k === hullKey);
    const hStep = Math.min(62, room / Math.max(1, owned.length));
    out.hulls = owned.map((k, i) => ({ k, r: { x: x + 20, y: top + i * hStep, w: colW, h: hStep - 8 } }));

    const counts = slotsOf(hullKey) ?? { weapon: 0, generator: 0, tech: 0 };
    const rackRows = SLOTS.reduce((n, sl) => n + (counts[sl] ?? 0), 0) + SLOTS.length;
    const bays = Math.min(MAX_DRONES, droneCount);
    const escortRows = 1 + bays + 1 + formations.length;
    // Each column is stepped to fit itself, so a six-drone Bulwark no longer
    // squeezes the weapon rack down with it.
    const push = (list, col, rows) => {
      const step = Math.min(34, room / Math.max(1, rows));
      let ry = top;
      return item => { list.push({ ...item, r: { x: x + 20 + col * (colW + 10), y: ry, w: colW, h: step - 6 } });
                       ry += step; };
    };
    const addRack = push(out.racks, 1, rackRows);
    for (const slot of SLOTS) {
      addRack({ slot, header: true });
      for (let i = 0; i < (counts[slot] ?? 0); i++) addRack({ slot, index: i });
    }
    const addEsc = push(out.racks, 2, escortRows);
    addEsc({ slot: 'drone', header: true });
    for (let i = 0; i < bays; i++) addEsc({ slot: 'drone', index: i });
    addEsc({ slot: 'form', header: true });
    for (const k of formations) addEsc({ slot: 'form', key: k });
    return out;
  }

  // store: a page list on the left, the page's items filling the rest
  const pStep = Math.min(38, room / STORE_PAGES.length);
  const catW = colW * 0.78;
  out.pages = STORE_PAGES.map((p, i) => ({ ...p, r: { x: x + 20, y: top + i * pStep, w: catW, h: pStep - 6 } }));

  const items = pageItems(page, { hulls, formations, drones: droneCount });
  const iX = x + 30 + catW, iW = w - 50 - catW;
  const iStep = Math.min(58, room / Math.max(1, items.length));
  out.store = items.map((it, i) => ({ ...it, r: { x: iX, y: top + i * iStep, w: iW, h: iStep - 8 } }));
  return out;
}
