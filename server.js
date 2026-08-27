import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, refit, step, stepVitals, stepDrift, applyDamage, stepJump, beginJump, arrivalFor, inBase, inHaven, WORLD, SHIELD_FLASH, SHOT_FLASH } from './shared/sim.js';
import { fire, stepBolts, faceTarget } from './shared/combat.js';
import { newAlien, respawnAlien, stepAlienAI, ALIENS, ALIENS_PER_MAP } from './shared/aliens.js';
import { HULLS, MODULES, sanitiseFit, DEFAULT_HULL } from './shared/ships.js';
import { stepContacts } from './shared/radar.js';
import { packShip, packBolt, packBlast, packPod, packHit } from './shared/net.js';
import { rollDrop, stow, unload, load, holdVol, beginScoop, stepScoop, approachPod,
         POD_LIFE, SCOOP_R, SCOOP_TIME } from './shared/cargo.js';
import { MAPS, HOMES, COMPANIES, MAP_W, MAP_H, JUMP_CD } from './shared/maps.js';

const PORT = 3000, TICK_HZ = 30;

const FILES = {
  '/':                ['public/index.html', 'text/html'],
  '/shared/sim.js':   ['shared/sim.js',     'text/javascript'],
  '/shared/maps.js':  ['shared/maps.js',    'text/javascript'],
  '/shared/chart.js': ['shared/chart.js',   'text/javascript'],
  '/shared/hangar.js':['shared/hangar.js',  'text/javascript'],
  '/shared/ships.js': ['shared/ships.js',   'text/javascript'],
  '/shared/radar.js': ['shared/radar.js',   'text/javascript'],
  '/shared/net.js':   ['shared/net.js',     'text/javascript'],
  '/shared/aliens.js':['shared/aliens.js',  'text/javascript'],
  '/shared/combat.js':['shared/combat.js',  'text/javascript'],
  '/shared/cargo.js': ['shared/cargo.js',   'text/javascript'],
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

const bolts  = new Map();    // mapId -> bolts in flight
const blasts = new Map();    // mapId -> kill flashes still playing
for (const id of Object.keys(MAPS)) { bolts.set(id, []); blasts.set(id, []); }

const pods = new Map();      // mapId -> cargo adrift
for (const id of Object.keys(MAPS)) pods.set(id, []);
let podId = 1;
const drop = (mapId, x, y, mat, n) => {
  if (n > 0) pods.get(mapId).push({ id: podId++, x: x + (Math.random() - .5) * 70,
                                    y: y + (Math.random() - .5) * 70, mat, n, t: POD_LIFE });
};

const hits = new Map();      // mapId -> damage numbers still climbing
for (const id of Object.keys(MAPS)) hits.set(id, []);
const HIT_TIME = 0.95;

const BLAST_TIME = 0.8;
const boom = (mapId, e, foe, who) =>
  blasts.get(mapId).push({ x: e.x, y: e.y, r: e.r, foe, who, t: BLAST_TIME, ttl: BLAST_TIME });

// One place that kills an alien, so the flash can never be forgotten at a call site.
const killAlien = (mapId, a, byId = null) => {
  if (a.dead > 0) return;
  const killer = byId !== null ? players.get(byId) : null;
  if (killer) {                                   // your company pays out on confirmation
    killer.credits += a.def.bounty;
    if (killer.ws.readyState === 1) killer.ws.send(JSON.stringify(
      { t: 'award', amount: a.def.bounty, what: a.def.name, total: killer.credits }));
  }
  boom(mapId, a, true, a.id);
  const loot = rollDrop(a.kind, a.rand);          // seeded, so drops replay with the alien
  if (loot) drop(mapId, a.x, a.y, loot.mat, loot.n);
  a.dead = a.def.respawn; a.target = null; a.provoked.clear();
};

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
  players.set(id, { ws, mapId: home, co, ship, contacts: new Map(), targetId: null,
                    hold: {}, vault: {}, credits: 0, scoop: null, want: null });
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

    if (m.t === 'scoop') {                        // an order: go get that, however far it is
      P.want = (pods.get(P.mapId) ?? []).some(c => c.id === +m.id) ? +m.id : null;
      if (process.env.DEBUG_SCOOP) console.log(`scoop order id=${m.id} accepted=${P.want !== null}`);
      return;
    }
    if (m.t === 'stash') {                        // ship -> company hangar, at the dock only
      if (!P.docked) return;
      const n = P.hold[m.mat] ?? 0;
      if (n > 0) unload(P.hold, P.vault, n * 99);
      return;
    }
    if (m.t === 'load') {                         // hangar -> ship, as much as the hold will take
      if (!P.docked) return;
      load(P.vault, P.hold, m.mat, P.vault[m.mat] ?? 0, ship.stats.cargo);
      return;
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
    P.want = null;                                // steering yourself overrides a fetch order
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
      boom(p.mapId, p.ship, false, id);
      for (const [m, n] of Object.entries(p.hold)) drop(p.mapId, p.ship.x, p.ship.y, m, n);
      p.hold = {};                                // a full hold is a real thing to lose
      const home = p.co + '1', hb = MAPS[home].base;
      const ang = Math.random() * 7, dist = Math.random() * hb.r * 0.6;
      p.mapId = home;
      p.contacts.clear();                         // a new sector is a fresh plot
      p.targetId = null; p.want = null; p.scoop = null;
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
    p.want = null; p.scoop = null;
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
      if (a.hp <= 0) killAlien(mapId, a);
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
    shot.owner = id;
    bolts.get(p.mapId).push(shot);
    foe.provoked.add(id);                        // pulling the trigger is the provocation,
    if (!foe.target) foe.target = id;            // whether or not the shot lands
  }

  // --- cargo ----------------------------------------------------------------
  for (const [, list] of pods)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);

  for (const [, p] of players) {                  // outstanding fetch orders
    if (p.want === null || p.scoop) continue;
    const pod = (pods.get(p.mapId) ?? []).find(c => c.id === p.want);
    const step2 = approachPod(p.ship, p.hold, pod);
    if (step2.fly) { p.ship.tx = step2.fly.x; p.ship.ty = step2.fly.y; p.ship.dx = p.ship.dy = null; }
    else if (step2.scoop) { p.scoop = step2.scoop; p.want = null; p.ship.tx = p.ship.ty = null; }
    else p.want = null;
  }

  for (const [, p] of players) {                  // tractor beams
    if (!p.scoop) continue;
    const list = pods.get(p.mapId) ?? [];
    const pod = list.find(c => c.id === p.scoop.id);
    const r = stepScoop(p.scoop, pod, p.ship, p.hold, dt);
    if (r.running) continue;
    if (r.emptied) list.splice(list.indexOf(pod), 1);
    p.scoop = null;
  }

  for (const [mapId, list] of bolts) {
    for (const h of stepBolts(list, dt)) {        // the bolt remembers who fired it
      hits.get(mapId).push({ x: h.target.x, y: h.target.y - h.target.r - 6,
                             n: h.split.shield + h.split.hull, sh: h.split.hull === 0,
                             by: h.bolt.owner ?? null, t: HIT_TIME, ttl: HIT_TIME });
      if (h.dead && h.target.isAlien) killAlien(mapId, h.target, h.bolt.owner ?? null);
    }
    for (const a of aliens.get(mapId) ?? []) if (a.hp <= 0) killAlien(mapId, a);
  }
  for (const [, list] of blasts)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);
  for (const [, list] of hits)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);

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
  for (const [vid, V] of players) {
    if (V.ws.readyState !== 1) continue;
    V.id = vid;
    const seen = stepContacts(V, byMap.get(V.mapId) ?? [], dt);
    const ships = [];
    for (const [tid, vis] of seen) ships.push(packShip({ ...row.get(tid), vis }));
    const reach = V.ship.stats.radar;              // you see the shooting you could see
    const shown = (bolts.get(V.mapId) ?? []).filter(b =>
      Math.hypot(b.sx - V.ship.x, b.sy - V.ship.y) <= reach ||
      Math.hypot(b.ax - V.ship.x, b.ay - V.ship.y) <= reach);
    // You see a kill you could have seen — and always your own, even though you
    // are already back at your home base by the time it plays.
    const flashes = (blasts.get(V.mapId) ?? []).filter(b =>
      b.who === V.id || Math.hypot(b.x - V.ship.x, b.y - V.ship.y) <= reach);
    const numbers = (hits.get(V.mapId) ?? []).filter(h =>
      h.by === vid || Math.hypot(h.x - V.ship.x, h.y - V.ship.y) <= reach);
    const cans = (pods.get(V.mapId) ?? []).filter(p =>
      Math.hypot(p.x - V.ship.x, p.y - V.ship.y) <= reach);
    V.ws.send(JSON.stringify({ t: 's', ships, bolts: shown.map(packBolt), blasts: flashes.map(packBlast),
      hits: numbers.map(h => packHit(h, h.by === vid)),
      pods: cans.map(packPod), hold: V.hold, cap: V.ship.stats.cargo,
      credits: V.credits, docked: !!V.docked, vault: V.vault,
      scoop: V.scoop ? { id: V.scoop.id, p: +(1 - V.scoop.t / SCOOP_TIME).toFixed(2) } : undefined,
      want: V.want ?? undefined }));
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Aphelion — http://localhost:${PORT}`));
