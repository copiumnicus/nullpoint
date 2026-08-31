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
// Hostiles only. The Bulkhead Target used to stand in the line and it never
// belonged there: it has aggro 0, damage 0 and 400,000 hull, it is range furniture
// rather than an animal, and it is the one thing in the room you want NEAR the dock
// because reading a dps number off it means standing in front of it with a stopwatch.
//
// Taking it out of the grid is also what makes an eleventh hostile fit. The comment
// below already said the two-column grid "stays inside the bound to ten hostiles",
// and the Kedge was the eleventh: six rows 600px apart is 1,500px of y before the
// 1,300px of x is counted, which put the furthest slot 1,985px from the ring — 6.6s
// in a starter hull against a stated 6. No rectangle rescues that. Eleven slots that
// must each be PEN_GAP from their neighbours do not fit inside 1,800px of radius
// while also starting east of the dock ring; the arithmetic is in the commit
// message. Ten do, exactly as before, and the room is better for the change.
const KINDS = Object.keys(ALIENS).filter(k => !ALIENS[k].dev);
const BENCH = Object.keys(ALIENS).filter(k => ALIENS[k].dev);
// Wider than the widest aggro radius, so you still pull one at a time — derived
// from the roster rather than picked, because the number that matters is "no
// hostile can hear its neighbour" and that changes every time one is added.
// The range is also closer to the dock than it was: the line grows with the
// roster, and it has to stay somewhere you can walk to in a starter hull.
const PEN_GAP = Math.max(...Object.values(ALIENS).map(a => a.aggro ?? 0)) + 60;
const PEN_X    = 700;
// Two columns, not one. A single line grew by a full aggro radius with every
// hostile added, and walked itself out past the "one short burn" the whole room
// is supposed to fit inside — the Leviathan pushed it to 6.4s and the Hive would
// have pushed it further. A grid grows at half the rate in the direction that
// costs, and stays inside the bound to ten hostiles.
const PEN_COLS = 2;
const PEN_ROWS = Math.ceil(KINDS.length / PEN_COLS);
export const PEN_SLOTS = KINDS.map((kind, i) => {
  const col = i % PEN_COLS, row2 = Math.floor(i / PEN_COLS);
  return {
    kind, id: 2e6 + i,
    x: CX + PEN_X + col * PEN_GAP,
    y: CY + (row2 - (PEN_ROWS - 1) / 2) * PEN_GAP,  // strung symmetrically about the dock
  };
});

// Range furniture, west of the dock and well clear of both galleries: 700px out,
// 900px off the nearest mannequin, and 1,400px from the nearest posted hostile so
// that standing at it is not standing inside somebody's aggro radius.
export const BENCH_SLOTS = BENCH.map((kind, i) => ({
  kind, id: 2e6 + 500 + i, x: CX - 700 - i * PEN_GAP, y: CY,
}));

const PEN_PAD = 260;
export const PEN = {
  x: Math.min(...PEN_SLOTS.map(s => s.x)) - PEN_PAD,
  y: Math.min(...PEN_SLOTS.map(s => s.y)) - PEN_PAD,
  w: (PEN_COLS - 1) * PEN_GAP + PEN_PAD * 2,
  h: (PEN_ROWS - 1) * PEN_GAP + PEN_PAD * 2,
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
  ...PEN_SLOTS.map(s => Math.hypot(s.x - CX, s.y - CY)),
  ...BENCH_SLOTS.map(s => Math.hypot(s.x - CX, s.y - CY)));

export const isDevMap = id => id === DEV_ID;
