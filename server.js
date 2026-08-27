import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, refit, step, stepVitals, applyDamage, stepJump, beginJump, arrivalFor, inBase } from './shared/sim.js';
import { HULLS, MODULES, sanitiseFit, DEFAULT_HULL } from './shared/ships.js';
import { stepContacts } from './shared/radar.js';
import { MAPS, HOMES, COMPANIES, MAP_W, MAP_H, JUMP_CD } from './shared/maps.js';

const PORT = 3000, TICK_HZ = 30;

const FILES = {
  '/':                ['public/index.html', 'text/html'],
  '/shared/sim.js':   ['shared/sim.js',     'text/javascript'],
  '/shared/maps.js':  ['shared/maps.js',    'text/javascript'],
  '/shared/chart.js': ['shared/chart.js',   'text/javascript'],
  '/shared/ships.js': ['shared/ships.js',   'text/javascript'],
  '/shared/radar.js': ['shared/radar.js',   'text/javascript'],
};
const server = http.createServer((req, res) => {
  const hit = FILES[req.url.split('?')[0]];
  if (!hit) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': hit[1] });
  res.end(fs.readFileSync(hit[0]));
});

const players = new Map();   // id -> { ws, mapId, ship }
let nextId = 1;

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
  players.set(id, { ws, mapId: home, co, ship, contacts: new Map() });
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

    // temporary: lets you watch the shield timer without weapons existing yet.
    // self only - it can never be pointed at another player.
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
      ship.tx = Math.max(0, Math.min(MAP_W, +m.x || 0));
      ship.ty = Math.max(0, Math.min(MAP_H, +m.y || 0));
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
    const map = MAPS[p.mapId];
    p.docked = map.owner === p.co && inBase(map, p.ship);
    stepVitals(p.ship, dt, p.docked);

    if (p.ship.hp <= 0) {                         // destroyed: back to your home, repaired
      const home = p.co + '1', hb = MAPS[home].base;
      const ang = Math.random() * 7, dist = Math.random() * hb.r * 0.6;
      p.mapId = home;
      p.contacts.clear();                         // a new sector is a fresh plot
      refit(p.ship, p.ship.hull, p.ship.fit);
      Object.assign(p.ship, { x: hb.x + Math.cos(ang) * dist, y: hb.y + Math.sin(ang) * dist,
                              vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null,
                              charge: 0, chargeTo: null, jumpCd: JUMP_CD });
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: home, died: true }));
      continue;
    }

    const dest = stepJump(p.ship, MAPS[p.mapId], dt);
    if (!dest) continue;
    const a = arrivalFor(p.mapId, MAPS[dest]);
    p.mapId = dest;
    p.contacts.clear();
    Object.assign(p.ship, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, jumpCd: JUMP_CD, charge: 0, chargeTo: null });
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: p.mapId }));
  }

  // Snapshots are per player, not per map. Radar means two ships sitting in the
  // same sector legitimately see different things, and an enemy you have not
  // detected must never reach the wire at all.
  const row = new Map(), byMap = new Map();
  for (const [id, p] of players) {
    row.set(id, [id, Math.round(p.ship.x), Math.round(p.ship.y), +p.ship.heading.toFixed(2),
      +p.ship.charge.toFixed(2), p.co, p.ship.hull,
      Math.round(100 * p.ship.hp / p.ship.stats.hull),
      Math.round(100 * p.ship.shield / Math.max(1, p.ship.stats.shield))]);
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId).push({ id, co: p.co, ship: p.ship });
  }
  for (const V of players.values()) {
    if (V.ws.readyState !== 1) continue;
    const seen = stepContacts(V, byMap.get(V.mapId) ?? [], dt);
    const ships = [];
    for (const [tid, vis] of seen) ships.push([...row.get(tid), vis]);
    V.ws.send(JSON.stringify({ t: 's', ships }));
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Aphelion — http://localhost:${PORT}`));
