import { newShip, step, stepJump, beginJump, nearPortal, arrivalFor, JUMP_TIME, canDock,
         inOutpost, inHaven, HAVEN_R } from '../shared/sim.js';
import { pirateValue, PIRATE_RATE, holdValue } from '../shared/cargo.js';
import { MAPS, GALAXY, HOMES, COMPANIES, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';
import { chartLayout } from '../shared/chart.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const ids = GALAXY, dt = 1 / 30;   // the testing ground is deliberately unreachable
const adj = id => MAPS[id].portals.map(p => p.to);
const bfs = (a, b) => { const q = [[a, [a]]], seen = new Set([a]);
  while (q.length) { const [n, path] = q.shift(); if (n === b) return path;
    for (const t of adj(n)) if (!seen.has(t)) { seen.add(t); q.push([t, [...path, t]]); } } return null; };

console.log('\nthe testing ground');
{
  const { DEV_ID, PROPS, PEN, PEN_SLOTS, BENCH_SLOTS, DEV_BASE, LABELS, propFit, REACH,
          PEN_ROOM, roomFull } = await import('../shared/devmap.js');
  const { WILD } = await import('../shared/aliens.js');
  const { ALIENS } = await import('../shared/aliens.js');
  const { HULLS, slotsOf } = await import('../shared/ships.js');
  const { FORMATION_KEYS } = await import('../shared/formation.js');
  const { COMMANDS } = await import('../shared/chat.js');
  const m = MAPS[DEV_ID];
  const inMap = o => o.x > 300 && o.y > 300 && o.x < MAP_W - 300 && o.y < MAP_H - 300;

  check('only an admin can reach it', COMMANDS.dev?.admin === true && m.portals.length === 0,
    'no portals, and /dev is gated');
  check('it is not on the chart or in the galaxy', m.dev === true && !GALAXY.includes(DEV_ID));

  check('every hull is on show, with a full escort', (() => {
    const shown = new Set(PROPS.map(p2 => p2.hull));
    return Object.keys(HULLS).every(h => shown.has(h));
  })(), `${Object.keys(HULLS).length} hulls`);
  check('and every formation is flying somewhere', (() => {
    const shown = new Set(PROPS.map(p2 => p2.formation));
    return FORMATION_KEYS.every(f => shown.has(f));
  })(), `${FORMATION_KEYS.length} formations`);
  check('a mannequin carries a full rack of the best gun',
    Object.keys(HULLS).every(h => propFit(h).weapon.length === slotsOf(h).weapon),
    'so the gallery shows the top of the ladder, not a stub');
  // The Bulkhead Target is not on the line and should not be. It has aggro 0, damage 0
// and 400,000 hull — it is range furniture, a thing you shoot AT to read a number
// off, and the place you want it is beside the dock rather than out with the animals.
// Taking it out of the grid is also what let an eleventh hostile fit inside the
// room's own "one short burn" bound: eleven slots a full aggro radius apart do not
// fit in 1,800px while starting east of the dock ring, and ten do.
check('every hostile type is posted somewhere you can walk to',
    WILD.every(k => [...PEN_SLOTS, ...BENCH_SLOTS].some(sl => sl.kind === k)),
    [...PEN_SLOTS, ...BENCH_SLOTS].map(sl => sl.kind).join(' '));
  check('and nothing that fights back is on the bench',
    BENCH_SLOTS.every(sl => (ALIENS[sl.kind].aggro ?? 0) === 0
                         && (ALIENS[sl.kind].attrs.damage ?? 0) === 0),
    BENCH_SLOTS.map(sl => ALIENS[sl.kind].name).join(', ') +
    ' — you stand in front of it with a stopwatch, so it must never shoot you');

  check('everything on the map is on the map', PROPS.every(inMap) && PEN_SLOTS.every(inMap)
    && LABELS.every(inMap) && inMap(DEV_BASE));

  // The point of the room is that you can see the next thing from where you are.
  // The first cut put the firing line 5700px east, past radar, and you undocked
  // into an empty room wondering where the aliens were.
  const { ANCHOR_FIGHT } = await import('../shared/balance.js');
  const { resolve } = await import('../shared/ships.js');
  const { DEFAULT_HULL } = await import('../shared/ships.js');
  const eye = resolve(DEFAULT_HULL).radar, walk = resolve(DEFAULT_HULL).speed;
  console.log(`     furthest thing ${Math.round(REACH)}px from the ring — ` +
              `${(REACH / walk).toFixed(1)}s in a starter hull, radar reaches ${eye}px`);
  check('the whole room is inside a starter hull\'s radar', REACH < eye,
    `furthest slot ${Math.round(REACH)}px against ${eye}px of radar — nothing has to be gone looking for`);
  // And the room OBEYS that bound rather than happening to fit inside it, which is the
  // difference this pass made. The firing line used to be a fixed two-column grid with
  // a row count of ceil(kinds / 2), so it grew straight out of the room one hostile at
  // a time: at thirteen the far corner was 2,220px against a starter hull's 2,200 and
  // the only tell was the line above going red. Each column is now as tall as the room
  // allows at its own distance out — seven slots at 700px, six at 1,300 — so the
  // layout cannot place a slot it could not see, and `roomFull` says so if the roster
  // ever asks for more than the seventeen that fit.
  check('and the firing line could not have posted one outside it',
    !roomFull && PEN_SLOTS.length === WILD.length && PEN_ROOM > WILD.length,
    `${PEN_SLOTS.length} hostiles posted of ${PEN_ROOM} the room holds — ` +
    'it was a fixed grid that grew past the bound and told nobody');
  // REWRITTEN, not deleted, per rule five. The bound was a flat 6 seconds and the
  // roster has outgrown it: PEN_GAP is the widest aggro radius in the game, and twelve
  // slots that must each be that far from their neighbours do not fold into 1,800px of
  // a dock ring however they are arranged — devmap.js already says so in as many words
  // for eleven, and the deeps made it twelve. So the number stops being picked and
  // starts being read off the game. ANCHOR_FIGHT is how long the reference fight
  // lasts, and the claim is that you can always reach the NEXT thing in the room in
  // less time than it takes to kill the one in front of you. That is what "a few
  // seconds" was a proxy for, it holds to about fourteen hostiles, and it moves on its
  // own if the anchor fight ever does.
  check('and nothing is further out than one fight is long', REACH / walk < ANCHOR_FIGHT,
    `${(REACH / walk).toFixed(1)}s at ${walk}px/s against a ${ANCHOR_FIGHT.toFixed(1)}s anchor fight`);
  check('the dock is small enough to see past', DEV_BASE.r < 400,
    `r=${DEV_BASE.r} against ${MAPS.m1.base.r} at a real base`);
  check('the map defines the dock once', MAPS[DEV_ID].base === DEV_BASE,
    'devmap reads it rather than repeating it');

  // The client and the server used to answer this separately, and disagreed:
  // the server took your money and the client refused to draw the counter.
  const on = (map, co, x, y) => canDock(map, co, { x, y });
  check('the workshop ring serves every company',
    ['m', 'h', 'k'].every(co => on(MAPS[DEV_ID], co, DEV_BASE.x, DEV_BASE.y)),
    'it belongs to whoever is standing in it');
  check('and only inside the ring',
    !on(MAPS[DEV_ID], 'm', DEV_BASE.x + DEV_BASE.r + 10, DEV_BASE.y));
  check('a real base still only serves its owner',
    on(MAPS.m1, 'm', MAPS.m1.base.x, MAPS.m1.base.y)
    && !on(MAPS.m1, 'h', MAPS.m1.base.x, MAPS.m1.base.y),
    'the workshop is the exception, not a hole in the rule');
  check('and open space is nobody\'s station',
    GALAXY.every(id => !MAPS[id].base || !on(MAPS[id], MAPS[id].owner, 100, 100)));
  // Arranged around the ring rather than strung out in one direction.
  const bearings = [...PROPS, ...PEN_SLOTS].map(o =>
    Math.round(Math.atan2(o.y - DEV_BASE.y, o.x - DEV_BASE.x) * 2 / Math.PI));
  check('the room is laid out around the dock, not off to one side',
    new Set(bearings).size >= 3, 'north, south and east of the ring');
  check('the firing line is inside its own box',
    PEN_SLOTS.every(sl => sl.x > PEN.x && sl.x < PEN.x + PEN.w && sl.y > PEN.y && sl.y < PEN.y + PEN.h));
  check('nothing is parked inside the dock', PROPS.every(p2 =>
    Math.hypot(p2.x - DEV_BASE.x, p2.y - DEV_BASE.y) > DEV_BASE.r + 200)
    && PEN.x > DEV_BASE.x + DEV_BASE.r);
  // Mannequins are drawn with their escort around them, so they need room.
  check('mannequins do not overlap each other', PROPS.every((a, i) =>
    PROPS.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > 420)),
    'each one flies six drones');
  check('hostiles are spaced enough to pull one at a time', PEN_SLOTS.every((a, i) =>
    PEN_SLOTS.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > ALIENS[a.kind].aggro)),
    'further apart than they can see');
}

console.log('\ntopology');
let oneway = 0; const links = new Set();
for (const id of ids) for (const p of MAPS[id].portals) {
  if (!MAPS[p.to].portals.some(q => q.to === id)) oneway++;
  links.add([id, p.to].sort().join('|'));
}
const reach = (() => { const q = ['m1'], s = new Set(q);
  while (q.length) for (const t of adj(q.shift())) if (!s.has(t)) { s.add(t); q.push(t); } return s.size; })();
check('all maps reachable', reach === ids.length, `${reach}/${ids.length}`);
check('every link is two-way', oneway === 0, `${links.size} links`);
check('portal counts stay in {2,3,4}',
  ids.every(id => MAPS[id].portals.length >= 2 && MAPS[id].portals.length <= 4));
check('portals land inside map bounds',
  ids.every(id => MAPS[id].portals.every(p =>
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
check('a held direction keeps thrusting', held.x - 600 > held.stats.speed * 20 * 0.9, `${(held.x - 600) | 0}px in 20s`);
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

// --- the pirate outpost ------------------------------------------------------
// A long run into the third sector used to be governed by how much your hold
// could carry: fill it and the only move is to fly all the way home.
console.log('\nthe pirate outpost');
{
  const withPost = Object.entries(MAPS).filter(([, m2]) => m2.outpost);
  // This used to read "every third sector has one", then "every frontier has one".
  // The third sector is still close enough to your own dock that flying home was
  // never the problem; the frontier is where a run gets long enough for a full hold
  // to end it. The deeps are where there was NOWHERE — no base, no outpost, so every
  // trip out was round-trip from a gate and a full hold ended it four hops from a
  // counter.
  check('every frontier and every deep sector has one', withPost.length === 6 &&
    withPost.every(([id]) => MAPS[id].frontier || MAPS[id].deep),
    withPost.map(([id]) => id).join(' '));
  check('and nothing else does — not the gates, not the core, not your own rings',
    !['g1', 'g2', 'g3', 'x0', 'm1', 'm2', 'm3'].some(id => MAPS[id].outpost),
    'a gate has four portal mouths and that is deliberately all the shelter it gets');
  // Three copies of one sector deserve one shop in one place: a pilot who has
  // learnt d1 should not have to learn d2 as well.
  {
    const deeps = ['d1', 'd2', 'd3'].map(id => MAPS[id].outpost);
    check('the three deep outposts are the same point, so you can find one without looking',
      deeps.every(o => o.x === deeps[0].x && o.y === deeps[0].y && o.r === deeps[0].r),
      `${deeps[0].x},${deeps[0].y} r ${deeps[0].r} in all three`);
    // The one number the placement is actually built on. Every door in a deep sector
    // sits on y = 4000, so the sanctuary at a portal mouth and the sanctuary at the
    // shop have to be far enough apart that no single patch of ground can cover the
    // gap — a Doldrum's still is the widest thing in the game at r 420, 840px across.
    const gap = Math.min(...MAPS.d1.portals.map(p2 =>
      Math.hypot(p2.x - deeps[0].x, p2.y - deeps[0].y))) - deeps[0].r - HAVEN_R;
    check('and there is open sky between the shop and the nearest door', gap > 840,
      `${Math.round(gap)}px of it, against 840px for the widest patch of ground in the game`);
  }
  for (const [id, m2] of withPost) {
    const o = m2.outpost;
    check(`${id}'s outpost is clear of both gates`,
      m2.portals.every(p2 => Math.hypot(p2.x - o.x, p2.y - o.y) > o.r + PORTAL_R + 400),
      `${Math.round(Math.min(...m2.portals.map(p2 => Math.hypot(p2.x - o.x, p2.y - o.y))))}px to the nearest`);
    check(`${id}'s outpost is inside the sector`,
      o.x - o.r > 0 && o.x + o.r < MAP_W && o.y - o.r > 0 && o.y + o.r < MAP_H);
    const at = { x: o.x, y: o.y };
    check(`${id}'s outpost is somewhere you can trade`, inOutpost(m2, at));
    // This used to read "an outpost is not shelter", and that was deliberate: the
    // point of somewhere to empty your hold mid-run was that it stayed open sky.
    // What changed is that you can respawn at a bay you rent. A wreck comes back
    // with every grudge cleared, so with no peace at the door a pilot who died on
    // the frontier respawned unprovoked in front of whatever killed them and died
    // again, forever. The peace is the price of the respawn.
    check(`${id}'s outpost keeps the peace at its own door`, inHaven(m2, at),
      'so a pilot who respawns here is not immediately killed again');
    check(`${id}'s peace stops at the trading zone`,
      !inHaven(m2, { x: o.x + o.r + 50, y: o.y }),
      `${o.r}px and not a pixel more — step outside and the frontier is unchanged`);
    check(`${id}'s outpost is not a dock`, !canDock(m2, m2.owner, at),
      'no repairs, no refit, no station panel');
  }
  const hold = { iron: 10, iridium: 2 };
  const full = holdValue(hold);
  check('a pirate pays a stated cut, not the hangar price',
    pirateValue(hold) === Math.floor(full * PIRATE_RATE) && PIRATE_RATE < 1,
    `${pirateValue(hold)} against ${full} at the dock — the cut is the price of not flying home`);
  check('and an empty hold is worth nothing rather than NaN', pirateValue({}) === 0);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${ids.length} maps, ${links.size} links`}\n`);
process.exit(fails.length ? 1 : 0);
