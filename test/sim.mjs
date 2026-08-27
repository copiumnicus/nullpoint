import { newShip, step, stepJump, beginJump, nearPortal, arrivalFor, JUMP_TIME, MAX_SPEED } from '../shared/sim.js';
import { MAPS, HOMES, COMPANIES, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';

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
const xs = ids.map(i => MAPS[i].sx), ys = ids.map(i => MAPS[i].sy);
const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
let overlaps = 0, offscreen = 0, diagonal = 0;
for (const [VW, VH] of [[1920,1080],[1600,900],[1440,900],[1280,800]]) {
  const S = Math.max(46, Math.min((VW - 130) / (x1 - x0 + 1.0), (VH - 168) / (y1 - y0 + 0.95)));
  const NW = Math.max(50, Math.min(112, S * 0.95)), NH = NW * (MAP_H / MAP_W);
  const ox = VW / 2 - ((x0 + x1) / 2) * S, oy = VH / 2 + 8 - ((y0 + y1) / 2) * S;
  const rectOf = id => ({ x: ox + MAPS[id].sx * S - NW / 2, y: oy + MAPS[id].sy * S - NH / 2, w: NW, h: NH });
  const rs = ids.map(id => { const r = rectOf(id); return { ...r, h: r.h + 30 }; });   // + label band
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > VW || a.y + a.h > VH) offscreen++;
    for (let j = i + 1; j < rs.length; j++) { const b = rs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++; }
  }
  const centerOf = id => ({ x: ox + MAPS[id].sx * S, y: oy + MAPS[id].sy * S });
  const port = (id, p, tc) => { const r = rectOf(id), vx = tc.x - (r.x + r.w / 2), vy = tc.y - (r.y + r.h / 2);
    return Math.abs(vx) >= Math.abs(vy)
      ? { x: vx > 0 ? r.x + r.w : r.x, y: r.y + (p.y / MAP_H) * r.h, dir: vx > 0 ? 'e' : 'w' }
      : { x: r.x + (p.x / MAP_W) * r.w, y: vy > 0 ? r.y + r.h : r.y, dir: vy > 0 ? 's' : 'n' }; };
  const OUT = Math.max(16, S * 0.20), horiz = d => d === 'e' || d === 'w', seen = new Set();
  for (const id of ids) for (const p of MAPS[id].portals) {
    const k = [id, p.to].sort().join('|'); if (seen.has(k)) continue; seen.add(k);
    const back = MAPS[p.to].portals.find(q => q.to === id);
    const a = port(id, p, centerOf(p.to)), b = port(p.to, back, centerOf(id));
    const ax = a.x + (a.dir === 'e' ? OUT : a.dir === 'w' ? -OUT : 0), ay = a.y + (a.dir === 's' ? OUT : a.dir === 'n' ? -OUT : 0);
    const bx = b.x + (b.dir === 'e' ? OUT : b.dir === 'w' ? -OUT : 0), by = b.y + (b.dir === 's' ? OUT : b.dir === 'n' ? -OUT : 0);
    const pts = [[a.x, a.y], [ax, ay]];
    if (horiz(a.dir) && horiz(b.dir))        { const mx = (ax + bx) / 2; pts.push([mx, ay], [mx, by]); }
    else if (!horiz(a.dir) && !horiz(b.dir)) { const my = (ay + by) / 2; pts.push([ax, my], [bx, my]); }
    else if (horiz(a.dir))                   { pts.push([bx, ay]); }
    else                                     { pts.push([ax, by]); }
    pts.push([bx, by], [b.x, b.y]);
    for (let i = 1; i < pts.length; i++)
      if (Math.abs(pts[i][0] - pts[i-1][0]) > 0.01 && Math.abs(pts[i][1] - pts[i-1][1]) > 0.01) diagonal++;
  }
}
check('no chart nodes overlap at any window size', overlaps === 0);
check('every node stays on screen', offscreen === 0);
check('every link segment is axis-aligned', diagonal === 0);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${ids.length} maps, ${links.size} links`}\n`);
process.exit(fails.length ? 1 : 0);
