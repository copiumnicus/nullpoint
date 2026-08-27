import { newShip, step, stepJump, beginJump, nearPortal, arrivalFor, JUMP_TIME, MAX_SPEED } from '../shared/sim.js';
import { MAPS, HOMES, COMPANIES, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';
import { chartLayout } from '../shared/chart.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const ids = Object.keys(MAPS), dt = 1 / 30;
const adj = id => MAPS[id].portals.map(p => p.to);
const bfs = (a, b) => { const q = [[a, [a]]], seen = new Set([a]);
  while (q.length) { const [n, path] = q.shift(); if (n === b) return path;
    for (const t of adj(n)) if (!seen.has(t)) { seen.add(t); q.push([t, [...path, t]]); } } return null; };

console.log('\ntopology');
let oneway = 0; const links = new Set();
for (const [id, m] of Object.entries(MAPS)) for (const p of m.portals) {
  if (!MAPS[p.to].portals.some(q => q.to === id)) oneway++;
  links.add([id, p.to].sort().join('|'));
}
const reach = (() => { const q = ['m1'], s = new Set(q);
  while (q.length) for (const t of adj(q.shift())) if (!s.has(t)) { s.add(t); q.push(t); } return s.size; })();
check('all maps reachable', reach === ids.length, `${reach}/${ids.length}`);
check('every link is two-way', oneway === 0, `${links.size} links`);
check('portal counts stay in {2,3,4}',
  Object.values(MAPS).every(m => m.portals.length >= 2 && m.portals.length <= 4));
check('portals land inside map bounds',
  Object.values(MAPS).every(m => m.portals.every(p =>
    p.x > PORTAL_R && p.x < MAP_W - PORTAL_R && p.y > PORTAL_R && p.y < MAP_H - PORTAL_R)));

console.log('\nsymmetry');
const homeHops = [['m1','h1'],['h1','k1'],['k1','m1']].map(([a, b]) => bfs(a, b).length - 1);
check('homes are equidistant', new Set(homeHops).size === 1, homeHops.join(' / '));
const shape = co => [1,2,3,4].map(n => MAPS[co + n].portals.length).join(',');
check('every company branch is identical', new Set(Object.keys(COMPANIES).map(shape)).size === 1, shape('m'));
check('arrival never lands inside the return portal', ids.every(id => MAPS[id].portals.every(p => {
  const a = arrivalFor(id, MAPS[p.to]), back = MAPS[p.to].portals.find(q => q.to === id);
  return Math.hypot(back.x - a.x, back.y - a.y) > PORTAL_R;
})));

console.log('\nflank routes');
const gatesOf = co => adj(co + '4').filter(t => MAPS[t].gate);
check('each frontier has two ways into contested space',
  Object.keys(COMPANIES).every(co => gatesOf(co).length === 2), gatesOf('m').join(' + '));
const routes = (a, b, max) => { const out = []; (function go(n, seen, path) {
    if (path.length > max + 1) return; if (n === b) { out.push([...path]); return; }
    for (const t of adj(n)) if (!seen.has(t)) { seen.add(t); path.push(t); go(t, seen, path); path.pop(); seen.delete(t); }
  })(a, new Set([a]), [a]); return out; };
const toCore = routes('m4', 'x0', 3);
check('multiple shortest approaches to the core', toCore.length >= 4, `${toCore.length} routes`);

console.log('\nthemes');
const hex = /^#[0-9a-f]{6}$/;
check('all theme + nebula colours are valid hex',
  ids.every(id => hex.test(MAPS[id].tint) && MAPS[id].neb.every(n => hex.test(n[3]))));
check('no company region reuses a theme colour',
  Object.keys(COMPANIES).every(co => new Set([1,2,3,4].map(n => MAPS[co + n].tint)).size === 4));
check('owned maps name a real company',
  ids.every(id => !MAPS[id].owner || COMPANIES[MAPS[id].owner]));
check('contested maps have no owner', ids.filter(i => MAPS[i].contested).every(i => !MAPS[i].owner));

console.log('\nmovement');
const held = newShip(600, 4000); held.dx = 1; held.dy = 0;
for (let i = 0; i < 30 * 20; i++) step(held, dt);
check('a held direction keeps thrusting', held.x - 600 > MAX_SPEED * 20 * 0.9, `${(held.x - 600) | 0}px in 20s`);
const dest = newShip(600, 4000); dest.tx = 4000; dest.ty = 4000;
for (let i = 0; i < 30 * 40; i++) step(dest, dt);
check('a destination is reached and held', Math.abs(dest.x - 4000) < 12 && Math.hypot(dest.vx, dest.vy) < 5,
  `x=${dest.x | 0} v=${Math.hypot(dest.vx, dest.vy).toFixed(1)}`);

console.log('\njump');
const sit = newShip(MAPS.m4.portals[0].x, MAPS.m4.portals[0].y);
let passive = false;
for (let i = 0; i < 30 * 10; i++) if (stepJump(sit, MAPS.m4, dt)) passive = true;
check('sitting in a portal never jumps on its own', !passive);
const spool = newShip(MAPS.m4.portals[0].x, MAPS.m4.portals[0].y);
beginJump(spool, MAPS.m4);
let fired = null;
for (let i = 0; i < 30 * 5 && !fired; i++) fired = stepJump(spool, MAPS.m4, dt);
check('committing fires after the spool', fired === MAPS.m4.portals[0].to);
const bail = newShip(MAPS.m4.portals[0].x, MAPS.m4.portals[0].y);
beginJump(bail, MAPS.m4);
for (let i = 0; i < 20; i++) stepJump(bail, MAPS.m4, dt);
bail.x += PORTAL_R * 3;                                   // drift out of the ring
stepJump(bail, MAPS.m4, dt);
check('drifting out of the ring cancels the spool', bail.charge === 0);

console.log('\nnavigation (home to the core, through the real sim)');
const path = bfs('m1', 'x0');
let cur = 'm1', s = newShip(), ticks = 0, hops = 0;
for (const next of path.slice(1)) {
  const gate = MAPS[cur].portals.find(p => p.to === next);
  s.tx = gate.x; s.ty = gate.y; s.dx = s.dy = null;
  let done = false;
  for (let i = 0; i < 30 * 400 && !done; i++, ticks++) {
    step(s, dt);
    if (s.charge === 0 && nearPortal(MAPS[cur], s)?.to === next) beginJump(s, MAPS[cur]);
    if (stepJump(s, MAPS[cur], dt) === next) {
      const a = arrivalFor(cur, MAPS[next]);
      Object.assign(s, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, jumpCd: 1.6 });
      cur = next; hops++; done = true;
    }
  }
  if (!done) break;
}
check(`flew ${path.join(' → ')}`, cur === 'x0' && hops === path.length - 1,
  `${hops}/${path.length - 1} hops in ${(ticks / 30 / 60).toFixed(1)} min of sim time`);

console.log('\nchart layout');
let overlaps = 0, offscreen = 0, diagonal = 0, stranded = 0, buried = 0, spurs = 0, sideBySide = 0, worstGap = 0;
for (const [VW, VH] of [[1920,1080],[1600,900],[1440,900],[1280,800],[1100,700]]) {
  const { rects, links } = chartLayout(VW, VH);

  const rs = [...rects.values()].map(r => ({ ...r, h: r.h + 30 }));       // + label band
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > VW || a.y + a.h > VH) offscreen++;
    for (let j = i + 1; j < rs.length; j++) { const b = rs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++; }
  }

  const segs = [];
  for (const L of links) {
    const pts = L.full;
    // the connector must terminate on the marker the node pass draws
    for (const [end, mid, mid_id] of [[pts[0], MAPS[L.a].portals.find(p => p.to === L.b), L.a],
                                      [pts[pts.length-1], MAPS[L.b].portals.find(p => p.to === L.a), L.b]]) {
      const r = rects.get(mid_id);
      const gap = Math.hypot(end[0] - (r.x + (mid.x / MAP_W) * r.w), end[1] - (r.y + (mid.y / MAP_H) * r.h));
      worstGap = Math.max(worstGap, gap);
      if (gap > 0.01) stranded++;
    }
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i-1], q = pts[i];
      if (Math.abs(p[0] - q[0]) > 0.01 && Math.abs(p[1] - q[1]) > 0.01) diagonal++;
      segs.push({ k: L.key, p, q, stub: i === 1 || i === pts.length - 1 });
      if (i >= 2) {                                          // a segment that doubles back on the last
        const d1 = [p[0] - pts[i-2][0], p[1] - pts[i-2][1]], d2 = [q[0] - p[0], q[1] - p[1]];
        if (d1[0]*d2[0] + d1[1]*d2[1] < -0.01 && Math.abs(d1[0]*d2[1] - d1[1]*d2[0]) < 0.01) spurs++;
      }
      if (i === 1 || i === pts.length - 1) continue;          // stubs live inside their own node
      for (const r of rects.values())                         // nodes paint over links
        if (Math.min(p[0],q[0]) < r.x + r.w - 3 && Math.max(p[0],q[0]) > r.x + 3 &&
            Math.min(p[1],q[1]) < r.y + r.h - 3 && Math.max(p[1],q[1]) > r.y + 3) buried++;
    }
  }

  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j]; if (A.k === B.k) continue;
    const Ah = Math.abs(A.p[1]-A.q[1]) < .01, Bh = Math.abs(B.p[1]-B.q[1]) < .01;
    const Av = Math.abs(A.p[0]-A.q[0]) < .01, Bv = Math.abs(B.p[0]-B.q[0]) < .01;
    let run = 0;
    if (Ah && Bh && Math.abs(A.p[1]-B.p[1]) < 2.5)
      run = Math.min(Math.max(A.p[0],A.q[0]), Math.max(B.p[0],B.q[0])) - Math.max(Math.min(A.p[0],A.q[0]), Math.min(B.p[0],B.q[0]));
    else if (Av && Bv && Math.abs(A.p[0]-B.p[0]) < 2.5)
      run = Math.min(Math.max(A.p[1],A.q[1]), Math.max(B.p[1],B.q[1])) - Math.max(Math.min(A.p[1],A.q[1]), Math.min(B.p[1],B.q[1]));
    if (run > 3) sideBySide++;
  }
}
check('no chart nodes overlap at any window size', overlaps === 0);
check('every node stays on screen', offscreen === 0);
check('every link segment is axis-aligned', diagonal === 0);
check('every connector ends on its portal marker', stranded === 0, `worst gap ${worstGap.toFixed(3)}px`);
check('no routed segment is buried under a node', buried === 0);
check('no connector doubles back past a corner', spurs === 0);
check('no two connectors run along the same line', sideBySide === 0);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${ids.length} maps, ${links.size} links`}\n`);
process.exit(fails.length ? 1 : 0);
