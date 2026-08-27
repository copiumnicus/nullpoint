import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, refit, step, stepVitals, stepDrift, applyDamage, stepJump, beginJump, arrivalFor, inBase, inHaven, WORLD, SHIELD_FLASH, SHOT_FLASH } from './shared/sim.js';
import { fire, stepBolts, faceTarget } from './shared/combat.js';
import { newAlien, respawnAlien, stepAlienAI, ALIENS_PER_MAP } from './shared/aliens.js';
import { HULLS, MODULES, sanitiseFit, DEFAULT_HULL } from './shared/ships.js';
import { stepContacts } from './shared/radar.js';
import { packShip, packBolt } from './shared/net.js';
import { MAPS, HOMES, COMPANIES, MAP_W, MAP_H, JUMP_CD } from './shared/maps.js';

const PORT = 3000, TICK_HZ = 30;

const FILES = {
  '/':                ['public/index.html', 'text/html'],
  '/shared/sim.js':   ['shared/sim.js',     'text/javascript'],
  '/shared/maps.js':  ['shared/maps.js',    'text/javascript'],
  '/shared/chart.js': ['shared/chart.js',   'text/javascript'],
  '/shared/ships.js': ['shared/ships.js',   'text/javascript'],
  '/shared/radar.js': ['shared/radar.js',   'text/javascript'],
  '/shared/net.js':   ['shared/net.js',     'text/javascript'],
  '/shared/aliens.js':['shared/aliens.js',  'text/javascript'],
  '/shared/combat.js':['shared/combat.js',  'text/javascript'],
};
const server = http.createServer((req, res) => {
  const hit = FILES[req.url.split('?')[0]];
  if (!hit) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': hit[1] });
  res.end(fs.readFileSync(hit[0]));
});

const players = new Map();   // id -> { ws, mapId, ship }
let nextId = 1;

// Hostiles live on the home maps for now, seeded per map so a restart replays.
const aliens = new Map();
let alienId = 1_000_000;
for (const h of HOMES) aliens.set(h, Array.from({ length: ALIENS_PER_MAP },
  (_, i) => newAlien('drifter', alienId++, MAPS[h], h.charCodeAt(0) * 977 + i * 7919)));

const bolts = new Map();     // mapId -> bolts in flight
for (const id of Object.keys(MAPS)) bolts.set(id, []);

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  const id = nextId++;
  const co = HOMES[(id - 1) % HOMES.length][0];      // round-robin the three companies
  const home = co + '1';
  const hullKeys = Object.keys(HULLS);
  const hull = hullKeys[(id - 1) % hullKeys.length];  // so connected clients differ
  const b = MAPS[home].base;
  const spawn = () => { const a = Math.random() * 7, d = Math.random() * b.r * 0.6;
                        return { x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d }; };
  const ship = newShip(spawn().x, spawn().y, hull, []);
  players.set(id, { ws, mapId: home, co, ship, contacts: new Map(), targetId: null });
  ws.send(JSON.stringify({ t: 'welcome', id, map: home, co, hull, fit: [] }));
  console.log(`+ player ${id} [${COMPANIES[co].tag}] ${HULLS[hull].name} at ${MAPS[home].name} (${players.size} online)`);

  // Clients send INTENT only — never position. The server owns the truth.
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    const P = players.get(id);
    if (m.t === 'jump') return beginJump(ship, MAPS[P.mapId]);

    if (m.t === 'refit') {                        // only inside your own base ring
      const map = MAPS[P.mapId];
      if (map.owner !== P.co || !inBase(map, ship)) return;
      const hull = HULLS[m.hull] ? m.hull : ship.hull;
      refit(ship, hull, sanitiseFit(hull, m.fit));
      return ws.send(JSON.stringify({ t: 'fit', hull: ship.hull, fit: ship.fit }));
    }

    if (m.t === 'target') {                       // aliens only for now; PvP needs its own rules
      const found = (aliens.get(P.mapId) ?? []).find(a => a.id === +m.id && a.dead <= 0 && a.hp > 0);
      P.targetId = found ? found.id : null;
      return;
    }

    // temporary: lets you watch the shield timer without pointing a gun at anything.
    // self only - it can never be aimed at another player.
    if (m.t === 'dev-damage') return void applyDamage(ship, 250);

    if (m.t !== 'intent') return;
    if (m.mode === 'dir') {                       // hold-to-steer
      const dx = +m.dx || 0, dy = +m.dy || 0, d = Math.hypot(dx, dy);
      const k = d > 1 ? 1 / d : 1;                // never trust a >1 throttle
      ship.dx = d < 0.001 ? null : dx * k;
      ship.dy = d < 0.001 ? null : dy * k;
      ship.tx = ship.ty = null;
    } else if (m.mode === 'pt') {                 // click-to-move
      ship.dx = ship.dy = null;
      ship.tx = Math.max(WORLD.x0, Math.min(WORLD.x1, +m.x || 0));   // you may order a course
      ship.ty = Math.max(WORLD.y0, Math.min(WORLD.y1, +m.y || 0));   // out past the lattice

    } else {                                      // stop
      ship.dx = ship.dy = ship.tx = ship.ty = null;
    }
  });

  ws.on('close', () => { players.delete(id); console.log(`- player ${id} (${players.size} online)`); });
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  for (const [id, p] of players) {
    step(p.ship, dt);
    stepDrift(p.ship, dt);
    const map = MAPS[p.mapId];
    p.docked = map.owner === p.co && inBase(map, p.ship);
    stepVitals(p.ship, dt, p.docked);

    if (p.ship.hp <= 0) {                         // destroyed: back to your home, repaired
      const home = p.co + '1', hb = MAPS[home].base;
      const ang = Math.random() * 7, dist = Math.random() * hb.r * 0.6;
      p.mapId = home;
      p.contacts.clear();                         // a new sector is a fresh plot
      p.targetId = null;
      refit(p.ship, p.ship.hull, p.ship.fit);
      Object.assign(p.ship, { x: hb.x + Math.cos(ang) * dist, y: hb.y + Math.sin(ang) * dist,
                              vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null,
                              charge: 0, chargeTo: null, jumpCd: JUMP_CD, shieldHit: 0 });
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: home, died: true }));
      continue;
    }

    const dest = stepJump(p.ship, MAPS[p.mapId], dt);
    if (!dest) continue;
    const a = arrivalFor(p.mapId, MAPS[dest]);
    p.mapId = dest;
    p.contacts.clear();
    p.targetId = null;             // jumping out breaks the engagement
    Object.assign(p.ship, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, jumpCd: JUMP_CD, charge: 0, chargeTo: null });
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: p.mapId }));
  }

  // --- hostiles -------------------------------------------------------------
  for (const [mapId, list] of aliens) {
    const map = MAPS[mapId];
    const here = [];
    for (const [id, p] of players) if (p.mapId === mapId) here.push({ id, ship: p.ship, haven: inHaven(map, p.ship) });
    for (const a of list) {
      if (a.dead > 0) { a.dead -= dt; if (a.dead <= 0) respawnAlien(a, map); continue; }
      const tgt = stepAlienAI(a, map, here, dt);
      step(a, dt); stepDrift(a, dt); stepVitals(a, dt, false);
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      faceTarget(a, victim?.ship);
      const shot = fire(a, victim?.ship ?? null, dt);
      if (shot) bolts.get(mapId).push(shot);
      if (a.hp <= 0) { a.dead = a.def.respawn; a.target = null; a.provoked.clear(); }
    }
  }

  // --- player guns ----------------------------------------------------------
  for (const [id, p] of players) {
    const foe = p.targetId
      ? (aliens.get(p.mapId) ?? []).find(a => a.id === p.targetId && a.dead <= 0 && a.hp > 0)
      : null;
    if (!foe) { p.targetId = null; fire(p.ship, null, dt); continue; }
    faceTarget(p.ship, foe);
    const shot = fire(p.ship, foe, dt);
    if (!shot) continue;
    bolts.get(p.mapId).push(shot);
    foe.provoked.add(id);                        // pulling the trigger is the provocation,
    if (!foe.target) foe.target = id;            // whether or not the shot lands
  }

  for (const [mapId, list] of bolts) {
    stepBolts(list, dt);
    for (const a of aliens.get(mapId) ?? [])
      if (a.dead <= 0 && a.hp <= 0) { a.dead = a.def.respawn; a.target = null; a.provoked.clear(); }
  }

  // Snapshots are per player, not per map. Radar means two ships sitting in the
  // same sector legitimately see different things, and an enemy you have not
  // detected must never reach the wire at all.
  const row = new Map(), byMap = new Map();
  for (const [id, p] of players) {
    row.set(id, { id, x: Math.round(p.ship.x), y: Math.round(p.ship.y),
      heading: +p.ship.heading.toFixed(2), charge: +p.ship.charge.toFixed(2),
      co: p.co, hull: p.ship.hull,
      hp: Math.round(100 * p.ship.hp / p.ship.stats.hull),
      sh: Math.round(100 * p.ship.shield / Math.max(1, p.ship.stats.shield)),
      flash: Math.round(100 * p.ship.shieldHit / SHIELD_FLASH),
      tgt: p.targetId ?? 0, shot: Math.round(100 * p.ship.shotFlash / SHOT_FLASH) });
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId).push({ id, co: p.co, ship: p.ship });
  }
  for (const [mapId, list] of aliens) for (const a of list) {
    if (a.dead > 0) continue;
    row.set(a.id, { id: a.id, x: Math.round(a.x), y: Math.round(a.y), heading: +a.heading.toFixed(2),
      charge: 0, co: 'x', hull: a.kind,
      hp: Math.round(100 * a.hp / a.stats.hull),
      sh: Math.round(100 * a.shield / Math.max(1, a.stats.shield)),
      flash: Math.round(100 * a.shieldHit / SHIELD_FLASH),
      tgt: a.target ?? 0, shot: Math.round(100 * a.shotFlash / SHOT_FLASH) });
    if (!byMap.has(mapId)) byMap.set(mapId, []);
    byMap.get(mapId).push({ id: a.id, co: 'x', ship: a });   // 'x' == hostile to every company
  }
  for (const V of players.values()) {
    if (V.ws.readyState !== 1) continue;
    const seen = stepContacts(V, byMap.get(V.mapId) ?? [], dt);
    const ships = [];
    for (const [tid, vis] of seen) ships.push(packShip({ ...row.get(tid), vis }));
    const reach = V.ship.stats.radar;              // you see the shooting you could see
    const shown = (bolts.get(V.mapId) ?? []).filter(b =>
      Math.hypot(b.sx - V.ship.x, b.sy - V.ship.y) <= reach ||
      Math.hypot(b.ax - V.ship.x, b.ay - V.ship.y) <= reach);
    V.ws.send(JSON.stringify({ t: 's', ships, bolts: shown.map(packBolt) }));
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Aphelion — http://localhost:${PORT}`));
