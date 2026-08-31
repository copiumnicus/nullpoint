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
import { AMMO_KEYS } from './ammo.js';
import { KIT_KEYS } from './repair.js';
import { DEVICE_KEYS } from './devices.js';

import { rowsOf as statRows, rowHeight } from './breakdown.js';

export const TABS = [{ key: 'hangar', name: 'HANGAR' },
                     { key: 'store', name: 'STORE' },
                     { key: 'inventory', name: 'INVENTORY' },
                     { key: 'stats', name: 'STATS' }];

// Everything you own and are not currently flying, newest ladder first. There was
// no way to look at this at all: gear you bought and took off the ship existed
// only as a number on a store row, and hulls you owned only as an "owned" tag on
// the one page that sold them. You could not see what you had, let alone sell it.
export function inventoryItems({ gear = {}, hulls = [], hull = null } = {}) {
  const kit = Object.keys(gear)
    .filter(k => EQUIPMENT[k] && gear[k] > 0)
    .sort((a, b) => (EQUIPMENT[b].tier ?? 0) - (EQUIPMENT[a].tier ?? 0)
                 || EQUIPMENT[b].price - EQUIPMENT[a].price)
    .map(k => ({ kind: 'own', k, n: gear[k] }));
  // A hull you own but are not flying is inventory too, and it is the most
  // valuable thing most pilots have sitting idle.
  const ships = hulls
    .filter(h => h !== hull && HULLS[h] && (HULLS[h].price ?? 0) > 0)
    .sort((a, b) => HULLS[b].price - HULLS[a].price)
    .map(h => ({ kind: 'ownhull', k: h, n: 1 }));
  return [...ships, ...kit];
}

// Ammunition is sold anywhere; everything else needs the ring. Declared here so
// the client dims exactly what the server will refuse.
export const ANYWHERE = ['ammo'];
export const sellsAt = (page, docked) => docked || ANYWHERE.includes(page);

// A hint says what the page sells and, where it is not obvious, where you have to
// be standing to buy it. They used to be fragments with the verb taken out — "the
// frontier rungs, a pirate hulk stocks these" — which read as atmosphere and
// answered neither question.
export const STORE_PAGES = [
  { key: 'ships',     name: 'Ships',       hint: 'Hulls. Each one carries a different mix of slots.' },
  { key: 'weapon',    name: 'Lasers',      hint: 'Emitters. Each adds flat damage to every bolt you fire.' },
  { key: 'rocket',    name: 'Launchers',   hint: 'Rockets that chase. Three racks per ship, never on a drone.' },
  { key: 'generator', name: 'Generators',  hint: 'Shields and capacitor, paid for in speed.' },
  { key: 'tech',      name: 'Technology',  hint: 'One of each per ship. Each one lets you do something.' },
  { key: 'techx',     name: 'Deep Tech',   hint: 'The top rungs. Sold only at an outpost bay you rent.' },
  { key: 'ammo',      name: 'Ammunition',  hint: 'Cells and warheads by the crate. The one thing sold anywhere.' },
  { key: 'utility',   name: 'Utilities',   hint: 'One use each. Repair drones mend hull; beacons fold you home.' },
  { key: 'drones',    name: 'Drones',      hint: 'Escort bays, and the rigs that gather ore instead of firing.' },
  { key: 'forms',     name: 'Formations',  hint: 'Where the escort flies, and what that is worth to you.' },
];

// What a store page holds. Kinds tell the client how to draw and what to send.
export function pageItems(page, { hulls = [], formations = [], drones = 0 } = {}) {
  switch (page) {
    case 'ships':  return Object.keys(HULLS).map(k => ({ kind: 'hull', k, owned: hulls.includes(k) }));
    case 'drones': return [
      ...(drones < MAX_DRONES ? [{ kind: 'drone', k: 'drone', owned: false }] : []),
      ...Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'collector')
        .map(k => ({ kind: 'item', k, owned: false })),
    ];
    case 'forms':  return FORMATION_KEYS.map(k => ({ kind: 'form', k, owned: formations.includes(k) }));
    // Both weapon pages draw from the same slot, split by what the thing does.
    case 'weapon': return Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'laser')
                     .map(k => ({ kind: 'item', k, owned: false }));
    case 'rocket': return Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'rocket')
                     .map(k => ({ kind: 'item', k, owned: false }));
    case 'ammo':   return AMMO_KEYS.map(k => ({ kind: 'ammo', k, owned: false }));
    // Both consumables share a shelf. They are the same kind of purchase — one use,
    // bought at a counter, carried until you need it — and two pages of three rows
    // was two thirds of a screen each to say so.
    case 'utility': return [...KIT_KEYS.map(k => ({ kind: 'kit', k, owned: false })),
                            ...DEVICE_KEYS.map(k => ({ kind: 'device', k, owned: false }))];
    // The technology shelf outgrew one page: fifteen rows on a 30.5px step drew a
    // 22.5px row and the blurb underneath it clipped. Split at the frontier rung,
    // which is the line the shelf already has.
    case 'tech':    return Object.keys(EQUIPMENT)
                      .filter(k => EQUIPMENT[k].slot === 'tech' && (EQUIPMENT[k].tier ?? 1) < 3)
                      .map(k => ({ kind: 'item', k, owned: false }));
    case 'techx':   return Object.keys(EQUIPMENT)
                      .filter(k => EQUIPMENT[k].slot === 'tech' && (EQUIPMENT[k].tier ?? 1) >= 3)
                      .map(k => ({ kind: 'item', k, owned: false }));
    default:       return Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === page)
                     .map(k => ({ kind: 'item', k, owned: false }));
  }
}

// What your inventory can put in one slot, best first. "Best" is the tier you paid
// most for, because filling an empty slot with whatever happened to sort first
// meant a pilot holding MK-Vs kept getting MK-Is bolted on.
export function fitsIn(target, { gear = {}, fit = emptyFit(), drones = [] } = {}) {
  const held = k => (gear[k] ?? 0) > 0;
  const takenTech = new Set([...(fit.tech ?? []), ...drones.filter(Boolean)]
    .filter(k => EQUIPMENT[k]?.slot === 'tech'));
  return Object.keys(EQUIPMENT)
    .filter(k => held(k))
    .filter(k => (target === 'rig'
      // The rig bay takes collectors and nothing else.
      ? EQUIPMENT[k].kind === 'collector'
      : target === 'drone'
      // A drone takes anything the ship itself could carry, minus rockets and
      // the collectors, which have a bay of their own.
      ? EQUIPMENT[k].kind !== 'rocket' && EQUIPMENT[k].kind !== 'collector'
      : EQUIPMENT[k].slot === target))
    .filter(k => !(EQUIPMENT[k].slot === 'tech' && takenTech.has(k)))
    .filter(k => !(EQUIPMENT[k].kind === 'rocket' && launcherRoom(fit) <= 0))
    .sort((a, b) => (EQUIPMENT[b].tier ?? 0) - (EQUIPMENT[a].tier ?? 0)
                 || EQUIPMENT[b].price - EQUIPMENT[a].price);
}

// The chooser that drops out of an empty slot. Anchored to the row that opened
// it, flipped upward when it would run off the bottom of the panel.
// A store row is this tall, always. See the note in bayLayout about what happens
// when rows share out the room instead.
export const STORE_ROW = 58;

export const PICK_ROW = 30;
export function pickerLayout(G, row, items) {
  const w = G.colW + 40;
  const x = Math.min(row.r.x, G.panel.x + G.panel.w - w - 8);
  // The chooser used to be as tall as its list, which was fine at four
  // technologies and ran clean off the panel at fifteen. It takes as many as fit
  // and no more — `fitsIn` already hands them over best first, so what is cut is
  // the bottom of the list rather than the part you wanted.
  const room = G.panel.h - 16;
  const most = Math.max(1, Math.floor((room - 8) / PICK_ROW));
  const shown = items.slice(0, most);
  const h = 8 + shown.length * PICK_ROW;
  const below = row.r.y + row.r.h + 4;
  const y = below + h > G.panel.y + G.panel.h - 8
    ? Math.max(G.panel.y + 8, Math.min(row.r.y - h - 4, G.panel.y + G.panel.h - h - 8))
    : below;
  return { box: { x, y, w, h }, cut: items.length - shown.length,
           rows: shown.map((k, i) => ({ k, r: { x: x + 6, y: y + 4 + i * PICK_ROW, w: w - 12, h: PICK_ROW - 4 } })) };
}

export function bayLayout(VIEW_W, VIEW_H, s = {}) {
  const { tab = 'hangar', page = 'ships', hull: hullKey, drones: droneCount = 0,
          hulls = [], formations = [], gear = {}, scroll = 0 } = s;
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
    const escortRows = 1 + bays + 2 + 1 + formations.length;   // + the rig header and its one bay
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
    addEsc({ slot: 'rig', header: true });
    addEsc({ slot: 'rig', index: 0 });
    addEsc({ slot: 'form', header: true });
    for (const k of formations) addEsc({ slot: 'form', key: k });
    return out;
  }

  // Where your numbers came from: the ship, then what you bolted to it, then the
  // technologies, then the research ladder. Rows are different heights because a
  // stat nothing touched needs one line and a stat three layers moved needs four,
  // so this scrolls by PIXELS — a row-snapped scroll over uneven rows jumps by a
  // different amount every notch, which the threat file already taught us.
  if (tab === 'stats') {
    // `s.drones` is a COUNT in this state object; the escort itself comes in as
    // `s.escort`. Two different things with almost the same name, which is exactly
    // how the first wiring of this threw.
    const rows = statRows({ ...s, drones: Array.isArray(s.escort) ? s.escort : [] });
    const sX = x + 20, sW = w - 40;
    let span = 0;
    for (const r of rows) span += rowHeight(r);
    const max = Math.max(0, span - room);
    const at = Math.max(0, Math.min(max, scroll));
    const placed = [];
    let cy = top - at;
    for (const r of rows) {
      const rh = rowHeight(r);
      if (cy + rh > top && cy < top + room) placed.push({ ...r, r: { x: sX, y: cy, w: sW, h: rh } });
      cy += rh;
    }
    out.stats = placed;
    out.body = { x: sX, y: top, w: sW, h: room };
    out.scroll = { at, max, span };
    out.bar = max > 0 ? {
      x: sX + sW + 6, y: top + (at / span) * room,
      w: 3, h: Math.max(20, (room / span) * room),
      track: { x: sX + sW + 6, y: top, w: 3, h: room },
    } : null;
    return out;
  }

  if (tab === 'inventory') {
    // One column, the full width, scrolling on the same fixed row height the store
    // uses — it is the same kind of list and should not read as a different screen.
    const items = inventoryItems(s);
    const iX = x + 20, iW = w - 40, iStep = STORE_ROW;
    const per = Math.max(1, Math.floor(room / iStep));
    const max = Math.max(0, items.length - per);
    const at = Math.max(0, Math.min(max, Math.round(scroll)));
    out.store = items.slice(at, at + per)
      .map((it, i) => ({ ...it, r: { x: iX, y: top + i * iStep, w: iW, h: iStep - 8 } }));
    out.scroll = { at, per, total: items.length, max };
    out.bar = max > 0 ? {
      x: iX + iW + 6, y: top + (at / items.length) * room,
      w: 3, h: Math.max(20, (per / items.length) * room),
      track: { x: iX + iW + 6, y: top, w: 3, h: room },
    } : null;
    return out;
  }

  // store: a page list on the left, the page's items filling the rest
  const pStep = Math.min(38, room / STORE_PAGES.length);
  const catW = colW * 0.78;
  out.pages = STORE_PAGES.map((p, i) => ({ ...p, r: { x: x + 20, y: top + i * pStep, w: catW, h: pStep - 6 } }));

  // Rows are a fixed height and the list scrolls. They used to divide the room
  // between however many items there were, so every new thing on a shelf made
  // every row on it shorter — the technology page went from four rows at 58px to
  // fifteen at 22.5px, and the client draws each blurb at y+35, so it clipped.
  // A shelf should not get harder to read every time something is added to it.
  const items = pageItems(page, { hulls, formations, drones: droneCount });
  const iX = x + 30 + catW, iW = w - 50 - catW;
  const iStep = STORE_ROW;
  const per = Math.max(1, Math.floor(room / iStep));
  const max = Math.max(0, items.length - per);
  const at = Math.max(0, Math.min(max, Math.round(scroll)));
  out.store = items.slice(at, at + per)
    .map((it, i) => ({ ...it, r: { x: iX, y: top + i * iStep, w: iW, h: iStep - 8 } }));
  // Only when there is something below the fold, so a short shelf grows no
  // control it does not need.
  out.scroll = { at, per, total: items.length, max };
  out.bar = max > 0 ? {
    x: iX + iW + 6, y: top + (at / items.length) * room,
    w: 3, h: Math.max(20, (per / items.length) * room),
    track: { x: iX + iW + 6, y: top, w: 3, h: room },
  } : null;
  return out;
}
