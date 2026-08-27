import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, step, stepJump, beginJump, arrivalFor } from './shared/sim.js';
import { MAPS, HOMES, COMPANIES, MAP_W, MAP_H, JUMP_CD } from './shared/maps.js';

const PORT = 3000, TICK_HZ = 30;

const FILES = {
  '/':                ['public/index.html', 'text/html'],
  '/shared/sim.js':   ['shared/sim.js',     'text/javascript'],
  '/shared/maps.js':  ['shared/maps.js',    'text/javascript'],
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
  const ship = newShip(MAP_W / 2 + (Math.random() - 0.5) * 1600,
                       MAP_H / 2 + (Math.random() - 0.5) * 1200);
  players.set(id, { ws, mapId: home, co, ship });
  ws.send(JSON.stringify({ t: 'welcome', id, map: home, co }));
  console.log(`+ player ${id} [${COMPANIES[co].tag}] at ${MAPS[home].name} (${players.size} online)`);

  // Clients send INTENT only — never position. The server owns the truth.
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'jump') return beginJump(ship, MAPS[players.get(id).mapId]);
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

  for (const p of players.values()) {
    step(p.ship, dt);
    const dest = stepJump(p.ship, MAPS[p.mapId], dt);
    if (!dest) continue;
    const a = arrivalFor(p.mapId, MAPS[dest]);
    p.mapId = dest;
    Object.assign(p.ship, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, jumpCd: JUMP_CD, charge: 0, chargeTo: null });
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: p.mapId }));
  }

  // one snapshot per populated map — you only see who shares your map
  const byMap = new Map();
  for (const [id, p] of players) {
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId).push([id, Math.round(p.ship.x), Math.round(p.ship.y), +p.ship.heading.toFixed(2), +p.ship.charge.toFixed(2), p.co]);
  }
  for (const [mapId, ships] of byMap) {
    const snapshot = JSON.stringify({ t: 's', ships });
    for (const p of players.values()) if (p.mapId === mapId && p.ws.readyState === 1) p.ws.send(snapshot);
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Aphelion — http://localhost:${PORT}`));
