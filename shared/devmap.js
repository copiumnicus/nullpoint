// The testing ground.
//
// One map that exists so a change can be looked at instead of imagined: every
// hull parked with a full escort, every formation flying beside it, one of each
// hostile posted on a firing line, and a dock in the middle of it all.
//
// Everything is laid out around that dock and kept tight. The first version put
// the firing line 5700px east, which is past radar — you undocked into an empty
// room and had to go looking for the aliens. Nothing is further out than one
// short burn now, and the whole room fits inside your own radar bubble.
//
// It is not part of the galaxy. It has no portals, it is not on the star chart,
// nobody spawns there, and only an admin can reach it — `/dev`.

import { MAPS, MAP_W, MAP_H } from './maps.js';
import { HULLS } from './ships.js';
import { FORMATION_KEYS, FORMATIONS } from './formation.js';
import { ALIENS } from './aliens.js';
import { MAX_DRONES, topTier } from './gear.js';

export const DEV_ID = 'dev';
export const DEV_BASE = MAPS[DEV_ID].base;          // one definition, in the map itself

// Ids for the mannequins, well clear of players (from 1) and hostiles (from 1e6).
export const PROP_BASE = 3e6;

const CX = DEV_BASE.x, CY = DEV_BASE.y;
const STEP = 470;                                   // room for six drones between neighbours
const NORTH = CY - 900, SOUTH = CY + 900;           // one short burn off the ring
const row = (n, i) => CX + (i - (n - 1) / 2) * STEP;

const COS = ['m', 'h', 'k'];

// North of the dock: one of each hull, full rack, full escort, all flying Line
// Astern — the row is about the hulls, so the hull is the only thing that varies.
const HULL_KEYS = Object.keys(HULLS);
export const HULL_ROW = HULL_KEYS.map((hull, i) => ({
  id: PROP_BASE + i, hull, formation: 'line', co: COS[i % COS.length],
  x: row(HULL_KEYS.length, i), y: NORTH,
  label: HULLS[hull].name,
}));

// South of it: the same hull in every formation, so the formation is the variable.
const SHOWCASE = 'vanguard';
export const FORM_ROW = FORMATION_KEYS.map((formation, i) => ({
  id: PROP_BASE + 100 + i, hull: SHOWCASE, formation, co: COS[i % COS.length],
  x: row(FORMATION_KEYS.length, i), y: SOUTH,
  label: FORMATIONS[formation].name,
}));

export const PROPS = [...HULL_ROW, ...FORM_ROW];

// East: the firing line. Close enough to see from the ring and to reach in a
// couple of seconds, far enough that nothing wanders over while you are looking
// at the gallery — a Drifter only picks a fight inside 420px.
const KINDS = Object.keys(ALIENS);
const PEN_GAP = 620;                                // > any aggro radius, so you pull one at a time
export const PEN_SLOTS = KINDS.map((kind, i) => ({
  kind, id: 2e6 + i,
  x: CX + 1450,
  y: CY + (i - (KINDS.length - 1) / 2) * PEN_GAP,   // strung symmetrically about the dock
}));
const PEN_PAD = 260;
export const PEN = {
  x: CX + 1450 - 550, y: Math.min(...PEN_SLOTS.map(s => s.y)) - PEN_PAD,
  w: 1100,            h: (KINDS.length - 1) * PEN_GAP + PEN_PAD * 2,
};

// The dock labels itself, so it is not in here.
export const LABELS = [
  { x: row(HULL_KEYS.length, 0) - 240, y: NORTH - 260, text: 'HULLS',
    sub: `every ship, full rack, ${MAX_DRONES} drones` },
  { x: row(FORMATION_KEYS.length, 0) - 240, y: SOUTH + 300, text: 'FORMATIONS',
    sub: `${HULLS[SHOWCASE].name}, one of each` },
  { x: PEN.x + 20, y: PEN.y - 30, text: 'FIRING LINE', sub: 'one of each, posted, quick respawn' },
];

// What the mannequins are carrying. Resolved rather than stored so the gallery
// shows whatever the top of the ladder happens to be today.
export const propFit = hull => ({
  weapon: Array(HULLS[hull].slots?.weapon ?? 0).fill(topTier('weapon')),
  generator: [], tech: [],
});

// How far the furthest thing sits from the ring — what a test can hold the line on.
export const REACH = Math.max(
  ...PROPS.map(p => Math.hypot(p.x - CX, p.y - CY)),
  ...PEN_SLOTS.map(s => Math.hypot(s.x - CX, s.y - CY)));

export const isDevMap = id => id === DEV_ID;
