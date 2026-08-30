// Galaxy definition.
//
// STRUCTURE is symmetric — three companies at 120°, identical branches, and a
// three-stage contested middle. THEME is deliberately not: colour describes what a
// region of space looks like, not who holds it. Ownership is drawn as an outline.
//
//   home ─┬─ mid ─┬─ FRONTIER ═╤═ GATE ═╤═ DEEP ═╤═ NULLPOINT
//         └─ mid ─┘            └ 2 gates per frontier, 2 deeps per gate:
//                                every approach to the core has a flank.

export const MAP_W = 12000, MAP_H = 8000;
export const PORTAL_R = 120;
export const JUMP_CD  = 1.6;

const shade = (hex, k) => '#' + [1, 3, 5].map(i =>
  Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('');

// portal anchors — corners, edge-centres, dead centre
const NW = { x: 1500, y: 1300 }, NE = { x: 10500, y: 1300 };
const SW = { x: 1500, y: 6700 }, SE = { x: 10500, y: 6700 };
const W  = { x: 1000, y: 4000 }, E  = { x: 11000, y: 4000 };
const N  = { x: 6000, y: 1100 };
const S  = { x: 6000, y: 6900 }, C  = { x: 6000,  y: 4000 };

export const COMPANIES = {
  m: { tag: 'MTC', name: 'Meridian Trade Consortium',    color: '#4a9fe0', ang: -90 },
  h: { tag: 'HXI', name: 'Helion Extractive Industries', color: '#e0a53f', ang:  30 },
  k: { tag: 'KVR', name: 'Kuiper Void Reclamation',      color: '#8f6fe0', ang: 150 },
};

// Region themes. Each company's four maps deliberately span the same *kind* of
// range — one signature hue, one cold, one warm, one washed out — so no side of
// the galaxy looks blander than another, without any of them looking owned.
const THEME = {
  m1: ['Bastion',      '#4a9fe0'], m2: ['Cryofield',    '#79d2cf'],
  m3: ['Ochre Drift',  '#c2884f'], m4: ['Ironbelt',     '#93a3b5'],
  h1: ['Kiln',         '#e0a53f'], h2: ['Verdigris',    '#59bf8c'],
  h3: ['Scarlet Rift', '#d1524f'], h4: ['Slagreach',    '#b07a55'],
  k1: ['Hollow',       '#8f6fe0'], k2: ['Palewater',    '#74b6c9'],
  k3: ['Emberfall',    '#e07a5f'], k4: ['Nightmarch',   '#5b62ab'],
  g1: ['Vantage',      '#d9564f'], g2: ['Auralis',      '#d9a94f'],
  g3: ['Thornwake',    '#7d9bd9'],
  d1: ['Sablemarch',   '#6f5f96'], d2: ['Glasswaste',   '#8fc4c9'],
  d3: ['Umbral Shoal', '#4f8a72'],
  x0: ['Nullpoint',    '#ff5c8a'],
};

const NEB_SETS = [
  [[3000, 2200, 2600], [8600, 6000, 3000], [6000, 4000, 4200]],
  [[4200, 5800, 3000], [9000, 2000, 2400], [6000, 4000, 4400]],
  [[3400, 5200, 3200], [9200, 2600, 2800], [6000, 4000, 4400]],
  [[5000, 2400, 3400], [8400, 6200, 2600], [6000, 4000, 4600]],
];
const nebFor = (tint, i) => NEB_SETS[i % 4].map(([x, y, r], j) => [x, y, r, shade(tint, [0.44, 0.34, 0.24][j])]);

// chart geometry: radius per stage, and a horizontal stretch so a triangular
// layout fills a landscape screen instead of running off the top and bottom
const RAD = { home: 5.85, mid: 4.75, frontier: 3.60, gate: 2.55, deep: 1.55 };
const MID_OFF = 0.92, XSTRETCH = 1.28;
const place = (angDeg, r, o = 0) => {
  const a = angDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
  return { sx: (ux * r - uy * o) * XSTRETCH, sy: uy * r + ux * o };
};

// Gates sit BETWEEN two companies; deeps sit in front of each one. Both tables are
// explicit rather than angle-matched, so the topology is readable and testable.
const GATES = [
  { id: 'g1', ang: -30, cos: ['m', 'h'], deeps: ['d1', 'd2'] },
  { id: 'g2', ang:  90, cos: ['h', 'k'], deeps: ['d2', 'd3'] },
  { id: 'g3', ang: 210, cos: ['k', 'm'], deeps: ['d3', 'd1'] },
];
const DEEPS = [
  { id: 'd1', ang: -90, gates: ['g3', 'g1'] },
  { id: 'd2', ang:  30, gates: ['g1', 'g2'] },
  { id: 'd3', ang: 150, gates: ['g2', 'g3'] },
];

export const MAPS = {};
const mk = (id, pos, tag, nebI, portals, extra = {}) => {
  const [theme, tint] = THEME[id];
  MAPS[id] = { ...pos, name: `${tag} · ${theme}`, theme, tint, neb: nebFor(tint, nebI), portals, ...extra };
};

Object.entries(COMPANIES).forEach(([co, f]) => {
  const a = f.ang, own = { owner: co };
  const myGates = GATES.filter(g => g.cos.includes(co)).map(g => g.id);
  mk(co + '1', place(a, RAD.home),              `${f.tag}-1`, 0,
     [{ ...SW, to: co + '2' }, { ...SE, to: co + '3' }],
     { ...own, home: true, base: { x: 6000, y: 4000, r: 900 } });   // the docking zone itself
  mk(co + '2', place(a, RAD.mid, -MID_OFF),     `${f.tag}-2`, 1,
     [{ ...NE, to: co + '1' }, { ...S,  to: co + '4' }],                       own);
  mk(co + '3', place(a, RAD.mid,  MID_OFF),     `${f.tag}-3`, 2,
     [{ ...NW, to: co + '1' }, { ...S,  to: co + '4' }],                       own);
  // The pirate outpost sits on the frontier, not one hop in. That is where a run
  // actually gets long enough for a full hold to end it — the third sector is
  // still close enough to your own dock that flying home was never the problem.
  // It buys ore and nothing else: no repair, no refit, and emphatically no
  // sanctuary, which matters more here than it did a sector back.
  mk(co + '4', place(a, RAD.frontier),          `${f.tag}-4`, 3,
     [{ ...NW, to: co + '2' }, { ...NE, to: co + '3' },
      { ...W,  to: myGates[0] }, { ...E, to: myGates[1] }],
     { ...own, frontier: true, outpost: { x: 9200, y: 5200, r: 420 } });
});

// Four destinations on a ring, at angles chosen so no two anchors share an x or a y.
// Corners and edge-centres both put two anchors on one coordinate, and two links
// leaving the same edge at the same offset sit on top of each other no matter how
// the router nudges them — the one overlap a lane search cannot undo.
const ring = (n, ...angles) => angles.map((a, i) => {
  const r = a * Math.PI / 180;
  return { x: 6000 + 4200 * Math.cos(r), y: 4000 + 2600 * Math.sin(r), to: n[i] };
});
for (const [i, g] of GATES.entries())
  mk(g.id, place(g.ang, RAD.gate), `G-${i + 1}`, i,
     ring([g.cos[0] + '4', g.cos[1] + '4', g.deeps[0], g.deeps[1]], 20, 110, 200, 290),
     { contested: true, gate: true });

for (const [i, d] of DEEPS.entries())                                   // stage 2: edges plus dead centre
  mk(d.id, place(d.ang, RAD.deep), `D-${i + 1}`, i + 1,
     [{ ...W, to: d.gates[0] }, { ...E, to: d.gates[1] }, { ...C, to: 'x0' }], { contested: true, deep: true });

mk('x0', { sx: 0, sy: 0 }, 'X', 2,                                      // stage 3: a 120° ring
   DEEPS.map(d => {
     const a = d.ang * Math.PI / 180;
     return { x: 6000 + 4200 * Math.cos(a), y: 4000 + 2600 * Math.sin(a), to: d.id };
   }), { contested: true, core: true });

// Portal anchors are declared by role (corners, edge-centres, dead centre) and then
// MATCHED to destinations by geometry: the slot sitting east of map centre takes the
// destination that lies east on the chart. Assigning corners by list order only
// happens to be right for un-rotated branches — g2's NW slot pointed at a map to its
// east, so its two stubs crossed the node on top of each other.
const perms = a => a.length <= 1 ? [a]
  : a.flatMap((v, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(rest => [v, ...rest]));
const angGap = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

for (const m of Object.values(MAPS)) {
  const slots = m.portals.map(p => ({ x: p.x, y: p.y }));
  const dests = m.portals.map(p => p.to);
  // a node preview keeps the map's aspect, so map-space and chart-space angles compare directly
  const slotAng = slots.map(s => Math.hypot(s.x - MAP_W / 2, s.y - MAP_H / 2) < 1
    ? null : Math.atan2(s.y - MAP_H / 2, s.x - MAP_W / 2));          // dead centre: any destination fits
  const destAng = dests.map(t => Math.atan2(MAPS[t].sy - m.sy, MAPS[t].sx - m.sx));

  let best = null, bestCost = Infinity;
  for (const perm of perms(dests.map((_, i) => i))) {
    let cost = 0;
    perm.forEach((d, i) => { if (slotAng[i] !== null) cost += angGap(slotAng[i], destAng[d]); });
    if (cost < bestCost) { bestCost = cost; best = perm; }
  }
  m.portals = best.map((d, i) => ({ ...slots[i], to: dests[d] }));
}

// The testing ground. Declared after the portal matcher because it has no
// portals to match, and flagged so the chart, the seeder and the star map all
// skip it — it is a workshop, not a place in the galaxy.
// A small dock, dead centre, with everything arranged around it — you should be
// able to see the next thing from wherever you are standing.
MAPS.dev = {
  sx: 0, sy: 0, name: 'DEV · God Room', theme: 'God Room', tint: '#7de08a',
  neb: nebFor('#7de08a', 0), portals: [], dev: true,
  base: { x: MAP_W / 2, y: MAP_H / 2, r: 320 },
};

export const HOMES = Object.keys(COMPANIES).map(co => co + '1');
// Everywhere a pilot can actually fly to on their own.
export const GALAXY = Object.keys(MAPS).filter(id => !MAPS[id].dev);
