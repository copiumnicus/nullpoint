// The testing ground.
//
// One map that exists so a change can be looked at instead of imagined: every
// hull parked with a full escort, every formation flying beside it, one of each
// hostile posted on a firing line, an indestructible hulk to measure output
// against, and a dock in the middle of it all so nothing has to be survived.
//
// It is not part of the galaxy. It has no portals, it is not on the star chart,
// nobody spawns there, and only an admin can reach it — `/dev`.

import { MAP_W, MAP_H } from './maps.js';
import { HULLS } from './ships.js';
import { FORMATION_KEYS, FORMATIONS } from './formation.js';
import { ALIENS } from './aliens.js';
import { MAX_DRONES, topTier } from './gear.js';

export const DEV_ID = 'dev';

// Ids for the mannequins, well clear of players (from 1) and hostiles (from 1e6).
export const PROP_BASE = 3e6;

const COS = ['m', 'h', 'k'];
const ROW_X = 3000, STEP = 620;

// One of each hull, full rack, full escort, all flying Line Astern — the row is
// about the hulls, so the one variable that changes along it is the hull.
export const HULL_ROW = Object.keys(HULLS).map((hull, i) => ({
  id: PROP_BASE + i, hull, formation: 'line',
  co: COS[i % COS.length],
  x: ROW_X + i * STEP, y: 2500,
  label: HULLS[hull].name,
}));

// ...and the same hull in every formation, so the row is about the formation.
const SHOWCASE = 'vanguard';
export const FORM_ROW = FORMATION_KEYS.map((formation, i) => ({
  id: PROP_BASE + 100 + i, hull: SHOWCASE, formation,
  co: COS[i % COS.length],
  x: ROW_X + i * STEP, y: 4200,
  label: FORMATIONS[formation].name,
}));

export const PROPS = [...HULL_ROW, ...FORM_ROW];

// The firing line: one of each hostile, posted, inside a box you can see.
export const PEN = { x: 7200, y: 2000, w: 3400, h: 4200 };
export const PEN_SLOTS = Object.keys(ALIENS).map((kind, i, all) => ({
  kind, id: 2e6 + i,
  x: PEN.x + PEN.w / 2,
  y: PEN.y + PEN.h * (i + 1) / (all.length + 1),
}));

export const DEV_BASE = { x: 1500, y: 4000, r: 700 };

export const LABELS = [
  { x: DEV_BASE.x, y: DEV_BASE.y - DEV_BASE.r - 60, text: 'DOCK', sub: 'repair, refit, and the whole store' },
  { x: ROW_X - 120, y: HULL_ROW[0].y - 320, text: 'HULLS', sub: `every ship, full rack, ${MAX_DRONES} drones` },
  { x: ROW_X - 120, y: FORM_ROW[0].y - 320, text: 'FORMATIONS', sub: `${HULLS[SHOWCASE].name}, one of each` },
  { x: PEN.x + 20, y: PEN.y - 40, text: 'FIRING LINE', sub: 'one of each hostile, posted, quick respawn' },
];

// What the mannequins are carrying. Resolved rather than stored so the gallery
// shows whatever the top of the ladder happens to be today.
export const propFit = hull => {
  const top = topTier('weapon');
  return { weapon: Array(HULLS[hull].slots?.weapon ?? 0).fill(top), generator: [], tech: [] };
};

export const isDevMap = id => id === DEV_ID;
