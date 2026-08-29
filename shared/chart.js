// Star-system chart geometry. Imported by the client to draw and by the tests to
// verify, so the two can never disagree about where a line goes.

import { MAPS, MAP_W, MAP_H, COMPANIES } from './maps.js';

const LANE_STEP = 9, LANE_TRIES = 11;      // sideways nudges tried per link, in order
const horiz = d => d === 'e' || d === 'w';
const owner = (a, b) => MAPS[a].owner && MAPS[a].owner === MAPS[b].owner ? MAPS[a].owner : null;

export function chartLayout(VIEW_W, VIEW_H) {
  const ids = Object.keys(MAPS).filter(id => !MAPS[id].dev);   // the workshop is not on the map
  const xs = ids.map(i => MAPS[i].sx), ys = ids.map(i => MAPS[i].sy);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const S = Math.max(46, Math.min((VIEW_W - 130) / (x1 - x0 + 1.0), (VIEW_H - 168) / (y1 - y0 + 0.95)));
  const NW = Math.max(50, Math.min(112, S * 0.95)), NH = NW * (MAP_H / MAP_W);
  const ox = VIEW_W / 2 - ((x0 + x1) / 2) * S, oy = VIEW_H / 2 + 8 - ((y0 + y1) / 2) * S;

  const rects = new Map(ids.map(id => [id, {
    x: ox + MAPS[id].sx * S - NW / 2, y: oy + MAPS[id].sy * S - NH / 2, w: NW, h: NH }]));
  const centerOf = id => { const r = rects.get(id); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

  // Anchor on the portal marker; leave by the edge on the dominant axis of travel,
  // keeping the portal's other coordinate so the stub stays one straight segment.
  const port = (id, p) => {
    const r = rects.get(id), t = centerOf(p.to);
    const px = r.x + (p.x / MAP_W) * r.w, py = r.y + (p.y / MAP_H) * r.h;
    const vx = t.x - (r.x + r.w / 2), vy = t.y - (r.y + r.h / 2);
    const dir = Math.abs(vx) >= Math.abs(vy) ? (vx > 0 ? 'e' : 'w') : (vy > 0 ? 's' : 'n');
    const edge = dir === 'e' ? { x: r.x + r.w, y: py } : dir === 'w' ? { x: r.x, y: py }
               : dir === 's' ? { x: px, y: r.y + r.h } : { x: px, y: r.y };
    return { anchor: { x: px, y: py }, edge, dir };
  };

  const OUT = Math.max(16, S * 0.20);
  // An exit stub must never overshoot the gap it has to cross, or the route doubles
  // back and leaves a spur sticking out past the corner.
  const outFor = (self, other, shared) => {
    const span = horiz(self.dir) ? Math.abs(other.edge.x - self.edge.x)
                                 : Math.abs(other.edge.y - self.edge.y);
    return Math.max(4, Math.min(OUT, shared ? span / 2 : span));
  };

  const build = (a, b, lane) => {
    const shared = horiz(a.dir) === horiz(b.dir);
    const oa = outFor(a, b, shared), ob = outFor(b, a, shared);
    const ax = a.edge.x + (a.dir === 'e' ? oa : a.dir === 'w' ? -oa : 0);
    const ay = a.edge.y + (a.dir === 's' ? oa : a.dir === 'n' ? -oa : 0);
    const bx = b.edge.x + (b.dir === 'e' ? ob : b.dir === 'w' ? -ob : 0);
    const by = b.edge.y + (b.dir === 's' ? ob : b.dir === 'n' ? -ob : 0);
    const pts = [[a.edge.x, a.edge.y], [ax, ay]];
    if (shared && horiz(a.dir))       { const lx = (ax + bx) / 2 + lane; pts.push([lx, ay], [lx, by]); }
    else if (shared)                  { const ly = (ay + by) / 2 + lane; pts.push([ax, ly], [bx, ly]); }
    else if (horiz(a.dir))            { const ly = ay + lane;            pts.push([ax, ly], [bx, ly]); }
    else                              { const lx = ax + lane;            pts.push([lx, ay], [lx, by]); }
    pts.push([bx, by], [b.edge.x, b.edge.y]);
    return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i-1][0], p[1] - pts[i-1][1]) > 0.01);
  };

  const buriedUnderNode = (p, q) => ids.some(o => {          // nodes paint over links
    const r = rects.get(o);
    return Math.min(p[0], q[0]) < r.x + r.w - 3 && Math.max(p[0], q[0]) > r.x + 3
        && Math.min(p[1], q[1]) < r.y + r.h - 3 && Math.max(p[1], q[1]) > r.y + 3;
  });
  const laid = [];
  const runsAlong = (p, q) => laid.some(([u, v]) => {
    const ph = Math.abs(p[1] - q[1]) < .01, uh = Math.abs(u[1] - v[1]) < .01;
    const pv = Math.abs(p[0] - q[0]) < .01, uv = Math.abs(u[0] - v[0]) < .01;
    if (ph && uh && Math.abs(p[1] - u[1]) < 2.5)
      return Math.min(Math.max(p[0],q[0]), Math.max(u[0],v[0])) - Math.max(Math.min(p[0],q[0]), Math.min(u[0],v[0])) > 3;
    if (pv && uv && Math.abs(p[0] - u[0]) < 2.5)
      return Math.min(Math.max(p[1],q[1]), Math.max(u[1],v[1])) - Math.max(Math.min(p[1],q[1]), Math.min(u[1],v[1])) > 3;
    return false;
  });

  const pairs = [], seen = new Set();
  for (const id of ids) for (const p of MAPS[id].portals) {
    const k = [id, p.to].sort().join('|');
    if (!seen.has(k)) { seen.add(k); pairs.push([k, id, p.to]); }
  }
  pairs.sort((u, v) => u[0] < v[0] ? -1 : 1);              // deterministic routing order

  const links = [], stubs = [];
  for (const [k, ia, ib] of pairs) {
    const pa = MAPS[ia].portals.find(p => p.to === ib), pb = MAPS[ib].portals.find(p => p.to === ia);
    const a = port(ia, pa), b = port(ib, pb);
    let pts = null;
    for (let i = 0; i < LANE_TRIES && !pts; i++) {          // 0, +1, -1, +2, -2 ... lanes
      const lane = (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2)) * LANE_STEP;
      const cand = build(a, b, lane);
      const clean = cand.slice(1).every((q, j) => !buriedUnderNode(cand[j], q) && !runsAlong(cand[j], q));
      if (clean) pts = cand;
    }
    pts ??= build(a, b, 0);
    for (let i = 1; i < pts.length; i++) laid.push([pts[i-1], pts[i]]);
    links.push({ key: k, a: ia, b: ib, own: owner(ia, ib), pts,
                 full: [[a.anchor.x, a.anchor.y], ...pts, [b.anchor.x, b.anchor.y]] });
    stubs.push({ map: ia, to: ib, own: owner(ia, ib), from: a.anchor, to_: a.edge },
               { map: ib, to: ia, own: owner(ia, ib), from: b.anchor, to_: b.edge });
  }
  return { S, NW, NH, rects, links, stubs, COMPANIES };
}
