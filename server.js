import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, refit, step, stepVitals, stepDrift, applyDamage, stepJump, beginJump, arrivalFor, inBase, canDock, inHaven, shieldMax, WORLD, SHIELD_FLASH, SHOT_FLASH } from './shared/sim.js';
import { fire, stepBolts, faceTarget } from './shared/combat.js';
import { launch, stepRockets, launcherRoom, LAUNCH_FLASH } from './shared/rockets.js';
import { newAlien, respawnAlien, stepAlienAI, stepAlienRepair, forgetPlayer, ALIENS, ALIENS_PER_MAP, WILD } from './shared/aliens.js';
import { DEV_ID, PROPS, PEN_SLOTS, propFit } from './shared/devmap.js';
import { AMMO, FEEDS, magazine, sanitiseUsing, sanitiseArmed } from './shared/ammo.js';
import { isTrack, typeOf, servable } from './shared/music.js';
import { KITS, kitPrice, sanitiseKit, whyNotRepair, KIT_QUIET } from './shared/repair.js';
import { HULLS, sanitiseFit, slotsOf, resolve, hullPrice, DEFAULT_HULL } from './shared/ships.js';
import { EQUIPMENT, SLOTS, priceOf, reseat, emptyFit,
         MAX_DRONES, dronePrice, sanitiseDrones, topTier } from './shared/gear.js';
import { levelFor } from './shared/level.js';
import { COMMANDS, parse, amount, MAX_LEN } from './shared/chat.js';
import { routeTo, levelOf, chargePct, SYSTEMS } from './shared/power.js';
import { FORMATIONS, FORMATION_KEYS, formationPrice, DEFAULT_FORMATION } from './shared/formation.js';
import { stepContacts, ALLY } from './shared/radar.js';
import { packShip, packBolt, packRocket, packBlast, packPod, packHit } from './shared/net.js';
import { newAccount, sanitiseAccount, capture } from './shared/account.js';
import { GAME } from './shared/brand.js';
import * as store from './store.js';
import crypto from 'node:crypto';
import { MATERIALS, rollDrop, stow, unload, load, holdVol, beginScoop, stepScoop, approachPod,
         POD_LIFE, SCOOP_R, SCOOP_TIME } from './shared/cargo.js';
import { MAPS, HOMES, GALAXY, COMPANIES, MAP_W, MAP_H, JUMP_CD } from './shared/maps.js';

const PORT = Number(process.env.PORT) || 3000, TICK_HZ = 30;

// Only two hand-listed entries. Everything under shared/ is served by pattern —
// the list used to be maintained by hand, and adding shared/level.js without
// adding it here 404'd one module. A missing module fails the whole import graph,
// so the page executes nothing at all and the player gets a black screen.
const FILES = {
  '/':          ['public/index.html', 'text/html'],
  '/audio.js':  ['public/audio.js',   'text/javascript'],
};
const SHARED_JS = /^\/shared\/[a-z]+\.js$/;   // no traversal, no other directory
const SFX_TYPE = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4' };

// Whatever is sitting in public/music right now, one subfolder deep. Read fresh
// each time so a track dropped in during a session shows up on the next reload
// without restarting the server. What counts as a track is in shared/music.js.
// Configurable so the tracks can live on the same mounted volume as the save
// file in production — they are deliberately not in the repo.
const MUSIC_DIR = process.env.MUSIC_DIR || 'public/music';
function listMusic() {
  const out = [];
  const scan = (dir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && !prefix && SAFE_DIR.test(e.name)) scan(`${dir}/${e.name}`, `${e.name}/`);
      else if (e.isFile() && isTrack(e.name)) out.push(prefix + e.name);
    }
  };
  scan(MUSIC_DIR, '');
  return out.sort();
}
const SAFE_DIR = /^[\w][\w -]*$/;
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/sfx/')) {                  // drop-in sound files, if there are any
    const name = url.slice(5);
    const ext = name.split('.').pop();
    const file = `public/sfx/${name}`;
    if (!/^[\w-]+\.[a-z0-9]+$/.test(name) || !SFX_TYPE[ext] || !fs.existsSync(file))
      return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': SFX_TYPE[ext] });
    return res.end(fs.readFileSync(file));
  }
  // Music. Drop files into public/music and they become the playlist — the
  // directory is the manifest, so there is nothing to edit when you add a track.
  // Subfolders are kept in the name so a mood can be read off them later.
  if (url === '/music/list') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(listMusic()));
  }
  if (url.startsWith('/music/')) {
    const name = decodeURIComponent(url.slice(7));
    // It has to be one we actually listed. Membership, not string surgery.
    if (!servable(name, listMusic())) return res.writeHead(404).end();
    const type = typeOf(name), file = `${MUSIC_DIR}/${name}`;
    const size = fs.statSync(file).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {                                  // browsers seek in audio; let them
      const from = range[1] ? +range[1] : 0;
      const to = range[2] ? Math.min(+range[2], size - 1) : size - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes',
                           'content-range': `bytes ${from}-${to}/${size}`,
                           'content-length': to - from + 1 });
      return fs.createReadStream(file, { start: from, end: to }).pipe(res);
    }
    // Track names are effectively immutable here — a new mix gets a new name —
    // so a week of caching keeps a reload from re-pulling five megabytes.
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes',
                         'content-length': size,
                         'cache-control': 'public, max-age=604800, immutable' });
    return fs.createReadStream(file).pipe(res);
  }
  if (url === '/healthz') {                       // most hosts want something to poll
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, game: GAME, online: players.size,
                                    accounts: Object.keys(db.accounts).length,
                                    uptime: Math.round(process.uptime()) }));
  }
  if (SHARED_JS.test(url) && fs.existsSync(url.slice(1))) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(fs.readFileSync(url.slice(1)));
  }
  const hit = FILES[url];
  if (!hit) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': hit[1] });
  res.end(fs.readFileSync(hit[0]));
});

// Cheats are opt-in and off by default. `npm run dev` sets DEV_ADMIN=1; `npm start`,
// which is what a host runs, does not — so the deployed game has no console unless
// a specific token is named in ADMIN_TOKENS.
const DEV_ADMIN = process.env.DEV_ADMIN === '1';
const ADMIN_TOKENS = new Set((process.env.ADMIN_TOKENS ?? '').split(',').map(t => t.trim()).filter(Boolean));
const isAdmin = acct => DEV_ADMIN || acct.admin === true || ADMIN_TOKENS.has(acct.token);

const players = new Map();   // id -> live session
let nextId = 1;

// Accounts outlive sockets. The token in a player's browser is the whole identity;
// lose it and you are a new pilot, which is the right trade for a game that has no
// passwords in it yet.
const db = store.load();
for (const [tok, a] of Object.entries(db.accounts))
  db.accounts[tok] = sanitiseAccount({ ...a, token: tok }, a.seq ?? 0, Date.now());
console.log(`accounts loaded: ${Object.keys(db.accounts).length}`);

const persistAll = () => {
  const now = Date.now();
  for (const p of players.values()) capture(p.acct, p, now);
  store.save(db);
  dirty = false;
};

// Accounts are written when they CHANGE, not on the way out. Some hosts give a
// process zero seconds between SIGTERM and SIGKILL — Railway's default is exactly
// that — so a shutdown hook is not somewhere state can safely live. The exit hook
// below is belt and braces; this is the thing that actually protects a player's
// ship, and it bounds any loss to about a second.
let dirty = false;
const touch = p => { capture(p.acct, p, Date.now()); dirty = true; };
setInterval(() => { if (dirty) { store.save(db); dirty = false; } }, 1000);
setInterval(persistAll, 15000);   // positions drift without changing anything
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => { persistAll(); console.log('accounts saved'); process.exit(0); });

// Hostiles live on the home maps for now, seeded per map so a restart replays.
const aliens = new Map();
let alienId = 1_000_000;
aliens.set(DEV_ID, PEN_SLOTS.map(sl => newAlien(sl.kind, sl.id, MAPS[DEV_ID], sl.id, { x: sl.x, y: sl.y })));
for (const h of HOMES) aliens.set(h, Array.from({ length: ALIENS_PER_MAP },
  (_, i) => newAlien('drifter', alienId++, MAPS[h], h.charCodeAt(0) * 977 + i * 7919)));

// The hull and formation galleries, resolved once at boot. They never move, take
// damage or shoot, so there is nothing to step — just rows to hand out.
const PROP_ROWS = PROPS.map(p2 => {
  const s2 = newShip(p2.x, p2.y, p2.hull, propFit(p2.hull), Array(MAX_DRONES).fill(topTier('weapon')), p2.formation);
  return { id: p2.id, x: p2.x, y: p2.y, heading: 0, charge: 0, co: p2.co, hull: p2.hull,
           hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0,
           guns: s2.guns, lvl: 0, drones: s2.drones.length,
           form: Math.max(0, FORMATION_KEYS.indexOf(p2.formation)),
           dmask: (1 << MAX_DRONES) - 1, psys: 0, plvl: 0, vis: ALLY };
});

const bolts  = new Map();    // mapId -> bolts in flight
const rockets = new Map();   // mapId -> rockets in flight

// A rocket flies for four and a half seconds, which is long enough for its
// target to jump out or die under it. Bolts land inside a third of a second and
// never had this problem; rockets would happily follow someone into the next
// sector and detonate on them there.
const dropRocketsAt = (mapId, ship) => {
  const list = rockets.get(mapId);
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].target === ship) list.splice(i, 1);
};
const blasts = new Map();    // mapId -> kill flashes still playing
for (const id of Object.keys(MAPS)) { bolts.set(id, []); rockets.set(id, []); blasts.set(id, []); }

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
    const was = levelFor(killer.xp).level;
    killer.credits += a.def.bounty;
    killer.xp += a.def.xp ?? a.def.bounty;
    const now2 = levelFor(killer.xp);
    touch(killer);                                // credits and rank banked immediately
    if (killer.ws.readyState === 1) killer.ws.send(JSON.stringify(
      { t: 'award', amount: a.def.bounty, xp: a.def.xp ?? a.def.bounty, what: a.def.name,
        total: killer.credits, level: now2.level, promoted: now2.level > was }));
  }
  boom(mapId, a, true, a.id);
  const loot = rollDrop(a.kind, a.rand);          // seeded, so drops replay with the alien
  if (loot) drop(mapId, a.x, a.y, loot.mat, loot.n);
  a.dead = a.def.respawn; a.target = null; a.provoked.clear();
};

const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const id = nextId++;
  const now = Date.now();

  let token = '';
  try { token = new URL(req.url, 'http://x').searchParams.get('t') || ''; } catch {}
  let acct = db.accounts[token];
  const returning = !!acct;
  if (!acct) {                                       // first visit, or a lost token
    token = crypto.randomBytes(16).toString('hex');
    acct = newAccount(token, db.seq++, now);
    db.accounts[token] = acct;
    store.save(db);
  }

  // One session per account. A second tab takes over rather than running a second
  // copy of the same pilot with diverging state.
  for (const [pid, p] of players) if (p.token === token) {
    try { p.ws.send(JSON.stringify({ t: 'bumped' })); p.ws.close(4001, 'signed in elsewhere'); } catch {}
    capture(p.acct, p, now);
    players.delete(pid);
  }

  // The workshop has no portals, so anyone who ends up there without the rights
  // to type /dev would be stuck in it. Log them in at their own dock instead.
  if (MAPS[acct.mapId]?.dev && !isAdmin(acct)) {
    acct.mapId = acct.co + '1';
    acct.x = MAPS[acct.mapId].base.x; acct.y = MAPS[acct.mapId].base.y;
  }

  const ship = newShip(acct.x, acct.y, acct.hull, acct.fit, acct.drones, acct.formation);
  players.set(id, { ws, token, acct, mapId: acct.mapId, co: acct.co, ship,
                    contacts: new Map(), targetId: null,
                    hold: { ...acct.hold }, vault: { ...acct.vault }, credits: acct.credits,
                    gear: { ...acct.gear }, hulls: [...acct.hulls], xp: acct.xp,
                    formations: [...acct.formations],
                    ammo: { ...acct.ammo }, using: { ...acct.using }, armed: { ...acct.armed },
                    kits: { ...acct.kits }, kit: acct.kit, fixing: null,
                    scoop: null, want: null, dead: false });
  // A line back to this pilot only. Lives out here rather than inside the chat
  // handler because anything that refuses a request owes an explanation, and the
  // repair rack was the first thing outside chat that needed one.
  const tell = text => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'chat', from: '', text }));

  // Every purchase says so. Watching a number tick down is not a receipt, and a
  // refused click and a successful one looked identical from the outside.
  const receipt = (what, cost, note = '') => {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'bought', what, cost, note, credits: players.get(id).credits }));
  };
  const outfit = () => (touch(players.get(id)), ws.send(JSON.stringify({ t: 'fit', hull: ship.hull, fit: ship.fit,
                                                drones: ship.drones, formation: ship.formation,
                                                formations: players.get(id).formations,
                                                ammo: players.get(id).ammo, using: players.get(id).using,
                                                armed: players.get(id).armed,
                                                kits: players.get(id).kits, kit: players.get(id).kit,
                                                gear: players.get(id).gear, hulls: players.get(id).hulls,
                                                credits: players.get(id).credits })));
  ws.send(JSON.stringify({ t: 'welcome', id, token, name: acct.name,
                           map: acct.mapId, co: acct.co, hull: acct.hull, fit: acct.fit,
                           gear: acct.gear, hulls: acct.hulls, credits: acct.credits,
                           drones: acct.drones, xp: acct.xp, admin: isAdmin(acct),
                           formation: acct.formation, formations: acct.formations,
                           ammo: acct.ammo, using: acct.using, armed: acct.armed,
                           kits: acct.kits, kit: acct.kit }));
  console.log(`+ ${acct.name} [${COMPANIES[acct.co].tag}] ${HULLS[acct.hull].name} ` +
              `${returning ? 'back in' : 'new, at'} ${MAPS[acct.mapId].name} (${players.size} online)`);

  // Clients send INTENT only — never position. The server owns the truth.
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    const P = players.get(id);
    if (m.t === 'jump') return beginJump(ship, MAPS[P.mapId]);

    // --- station: everything below needs you sitting in your own base ring ---
    const atStation = () => canDock(MAPS[P.mapId], P.co, ship);

    if (m.t === 'power') { routeTo(ship.power, m.sys); return; }   // anywhere, any time

    if (m.t === 'chat') {
      const line = parse(m.text);

      if (line.say !== undefined) {                 // ordinary talk, to your sector
        if (!line.say) return;
        const out = JSON.stringify({ t: 'chat', from: acct.name, co: P.co, text: line.say.slice(0, MAX_LEN) });
        for (const q of players.values()) if (q.mapId === P.mapId && q.ws.readyState === 1) q.ws.send(out);
        return;
      }

      const spec = COMMANDS[line.cmd];
      if (!spec) return tell(`no such command: /${line.cmd} — try /help`);
      if (spec.admin && !isAdmin(acct)) return tell(`/${line.cmd} is not available here`);
      const [a1, a2] = line.args;

      switch (line.cmd) {
        case 'help':
          return tell('commands: ' + Object.entries(COMMANDS)
            .filter(([, c]) => !c.admin || isAdmin(acct))
            .map(([k, c]) => '/' + k + (c.args ? ' ' + c.args : '')).join('   '));
        case 'where':
          return tell(`${MAPS[P.mapId].name} — ${MAPS[P.mapId].owner
            ? COMPANIES[MAPS[P.mapId].owner].tag + ' space' : 'contested'}`);
        case 'money':
          P.credits += amount(a1); touch(P); outfit();
          return tell(`credits: ${P.credits}`);
        case 'xp': {
          const before = levelFor(P.xp).level;
          P.xp += amount(a1); touch(P);
          const after = levelFor(P.xp).level;
          return tell(`experience: ${P.xp} — level ${after}${after > before ? ' (up)' : ''}`);
        }
        case 'ammo': {
          if (!AMMO[a1]) return tell('ammunition: ' + Object.keys(AMMO).join(' '));
          const n = amount(a2, 1e7) || AMMO[a1].pack * 10;
          P.ammo[a1] = (P.ammo[a1] ?? 0) + n;
          touch(P); outfit();
          return tell(`${n} ${AMMO[a1].name}`);
        }
        case 'gear': {
          if (!EQUIPMENT[a1]) return tell('items: ' + Object.keys(EQUIPMENT).join(' '));
          P.gear[a1] = (P.gear[a1] ?? 0) + amount(a2 ?? 1, 99);
          touch(P); outfit();
          return tell(`locker: ${a1} x${P.gear[a1]}`);
        }
        case 'form': {
          if (!FORMATIONS[a1]) return tell('formations: ' + FORMATION_KEYS.join(' '));
          if (!P.formations.includes(a1)) P.formations.push(a1);
          refit(ship, ship.hull, ship.fit, ship.drones, a1);
          touch(P); outfit();
          return tell(`flying ${FORMATIONS[a1].name}`);
        }
        case 'ship': {
          if (!HULLS[a1]) return tell('hulls: ' + Object.keys(HULLS).join(' '));
          if (!P.hulls.includes(a1)) P.hulls.push(a1);
          touch(P); outfit();
          return tell(`${HULLS[a1].name} is yours — switch to it at the dock`);
        }
        case 'ore': {
          if (!MATERIALS[a1]) return tell('metals: ' + Object.keys(MATERIALS).join(' '));
          P.vault[a1] = (P.vault[a1] ?? 0) + amount(a2 ?? 100, 99999);
          touch(P);
          return tell(`hangar: ${MATERIALS[a1].name} x${P.vault[a1]}`);
        }
        // Straight to the workshop, and straight back to wherever you were. Two
        // presses of the same key, because that is how it gets used.
        case 'dev': {
          const to = P.mapId === DEV_ID ? (P.devReturn ?? P.co + '1') : DEV_ID;
          if (P.mapId !== DEV_ID) P.devReturn = P.mapId;
          const b = MAPS[to].base;
          P.mapId = to; P.contacts.clear(); P.targetId = null; P.want = null; P.scoop = null;
          const at = b ? { x: b.x, y: b.y } : arrivalFor(P.mapId, MAPS[to]);
          Object.assign(ship, { x: at.x, y: at.y, vx: 0, vy: 0, tx: null, ty: null,
                                dx: null, dy: null, charge: 0, chargeTo: null, jumpCd: JUMP_CD });
          touch(P);
          ws.send(JSON.stringify({ t: 'map', map: to }));
          return tell(to === DEV_ID ? 'testing ground — /dev again to go back'
                                    : `back in ${MAPS[to].name}`);
        }
        case 'tp': {
          if (!MAPS[a1]) return tell('sectors: ' + GALAXY.join(' ') + ' (and dev)');
          const at = arrivalFor(P.mapId, MAPS[a1]);
          P.mapId = a1; P.contacts.clear(); P.targetId = null; P.want = null; P.scoop = null;
          Object.assign(ship, { x: at.x, y: at.y, vx: 0, vy: 0, tx: null, ty: null,
                                dx: null, dy: null, charge: 0, chargeTo: null, jumpCd: JUMP_CD });
          touch(P);
          ws.send(JSON.stringify({ t: 'map', map: a1 }));
          return tell(`jumped to ${MAPS[a1].name}`);
        }
        case 'heal':
          ship.hp = ship.stats.hull;
          ship.shield = ship.stats.shield * (ship.shieldMult ?? 1);
          ship.power.charge = ship.stats.capacitor;
          ship.sinceHit = 1e9;
          return tell('patched up');
      }
      return;
    }

    if (m.t === 'buyhull') {
      if (!atStation() || !HULLS[m.key] || P.hulls.includes(m.key)) return;
      if (P.credits < hullPrice(m.key)) return;
      P.credits -= hullPrice(m.key);
      P.hulls.push(m.key);
      refit(ship, m.key, ship.fit, ship.drones, ship.formation);   // bought, and flown at once
      receipt(HULLS[m.key].name, hullPrice(m.key), 'now flying it');
      return outfit();
    }
    if (m.t === 'hull') {
      if (!atStation() || !HULLS[m.key] || !P.hulls.includes(m.key)) return;
      const moved = reseat(slotsOf(m.key), ship.fit, P.gear);      // whatever will not fit comes off
      P.gear = moved.gear;
      refit(ship, m.key, moved.fit, ship.drones);                  // the escort follows you across
      return outfit();
    }
    if (m.t === 'buykit') {                       // repair drones are a dock purchase
      const k = KITS[m.key];
      if (!atStation() || !k || P.credits < kitPrice(m.key)) return;
      P.credits -= kitPrice(m.key);
      P.kits[m.key] = (P.kits[m.key] ?? 0) + 1;
      receipt(k.name, kitPrice(m.key), `${P.kits[m.key]} aboard`);
      return outfit();
    }
    if (m.t === 'kit') {                          // which one the button uses
      if (!KITS[m.key]) return;
      P.kit = sanitiseKit(m.key);
      touch(P);
      return outfit();
    }
    if (m.t === 'repair') {
      const why = whyNotRepair({ kits: P.kits, using: P.kit, docked: !!P.docked,
                                 sinceHit: ship.sinceHit, hurt: ship.hp < ship.stats.hull,
                                 busy: !!P.fixing });
      if (why) return tell(why);
      const k = KITS[P.kit];
      if (--P.kits[P.kit] <= 0) delete P.kits[P.kit];
      P.fixing = { key: P.kit, left: k.secs, secs: k.secs,
                   rate: (k.heal * ship.stats.hull) / k.secs };
      touch(P);
      return outfit();
    }
    if (m.t === 'arm') {                          // safe a weapon, or bring it back
      if (!FEEDS.includes(m.feed)) return;
      P.armed = sanitiseArmed({ ...P.armed, [m.feed]: !!m.on });
      touch(P);
      return outfit();
    }
    if (m.t === 'ammo') {                         // which grade feeds which weapon
      const want = sanitiseUsing({ ...P.using, ...(AMMO[m.key] ? { [AMMO[m.key].for]: m.key } : {}) });
      P.using = want;
      touch(P);
      return outfit();
    }
    if (m.t === 'buyammo') {
      // The one thing you can buy anywhere. Running dry halfway across a sector
      // with a hold full of ore and no way to shoot back is not an interesting
      // problem, it is just a walk home.
      const a = AMMO[m.key];
      if (!a) return;
      const crates = Math.max(1, Math.min(99, Math.floor(+m.n) || 1));
      const cost = a.price * crates;
      if (P.credits < cost) return;
      P.credits -= cost;
      P.ammo[m.key] = (P.ammo[m.key] ?? 0) + a.pack * crates;   // no cap, on purpose
      receipt(a.name, cost, `${a.pack * crates} rounds · ${P.ammo[m.key]} held`);
      return outfit();
    }
    if (m.t === 'buyformation') {
      if (!atStation() || !FORMATIONS[m.key] || P.formations.includes(m.key)) return;
      if (P.credits < formationPrice(m.key)) return;
      P.credits -= formationPrice(m.key);
      P.formations.push(m.key);
      receipt(FORMATIONS[m.key].name, formationPrice(m.key), 'flying it now');
      refit(ship, ship.hull, ship.fit, ship.drones, m.key);      // bought, and flown at once
      return outfit();
    }
    if (m.t === 'formation') {
      if (!atStation() || !FORMATIONS[m.key] || !P.formations.includes(m.key)) return;
      refit(ship, ship.hull, ship.fit, ship.drones, m.key);
      return outfit();
    }
    if (m.t === 'buydrone') {
      if (!atStation() || ship.drones.length >= MAX_DRONES) return;
      const cost = dronePrice(ship.drones.length);
      if (P.credits < cost) return;
      P.credits -= cost;
      refit(ship, ship.hull, ship.fit, [...ship.drones, null]);
      receipt(`Drone ${ship.drones.length}`, cost, `${ship.drones.length}/${MAX_DRONES} bays`);
      return outfit();
    }
    if (m.t === 'dronefit') {
      const item = EQUIPMENT[m.item], i = +m.index;
      if (!atStation() || !item || !(P.gear[m.item] > 0)) return;
      if (!(i >= 0 && i < ship.drones.length) || ship.drones[i]) return;
      const next = [...ship.drones]; next[i] = m.item;
      const clean = sanitiseDrones(next, ship.fit);
      if (clean[i] !== m.item) return;              // refused, e.g. a duplicate technology
      if (--P.gear[m.item] <= 0) delete P.gear[m.item];
      refit(ship, ship.hull, ship.fit, clean);
      return outfit();
    }
    if (m.t === 'dronestrip') {
      const i = +m.index;
      if (!atStation() || !(i >= 0 && i < ship.drones.length) || !ship.drones[i]) return;
      const item = ship.drones[i];
      P.gear[item] = (P.gear[item] ?? 0) + 1;
      const next = [...ship.drones]; next[i] = null;
      refit(ship, ship.hull, ship.fit, next);
      return outfit();
    }
    if (m.t === 'buy') {
      const item = EQUIPMENT[m.item];
      if (!atStation() || !item || P.credits < item.price) return;
      P.credits -= item.price;
      P.gear[m.item] = (P.gear[m.item] ?? 0) + 1;
      receipt(item.name, item.price, 'in your locker');
      return outfit();
    }
    if (m.t === 'install') {
      const item = EQUIPMENT[m.item];
      if (!atStation() || !item || !(P.gear[m.item] > 0)) return;
      const rack = ship.fit[item.slot], room = slotsOf(ship.hull)[item.slot] ?? 0;
      if (rack.length >= room) return;
      if (item.slot === 'tech' && rack.includes(m.item)) return;   // technologies are unique
      if (item.kind === 'rocket' && launcherRoom(ship.fit) <= 0) return;   // three to a ship
      rack.push(m.item);
      if (--P.gear[m.item] <= 0) delete P.gear[m.item];
      refit(ship, ship.hull, ship.fit, ship.drones, ship.formation);
      return outfit();
    }
    if (m.t === 'uninstall') {
      if (!atStation() || !SLOTS.includes(m.slot)) return;
      const rack = ship.fit[m.slot], i = +m.index;
      if (!(i >= 0 && i < rack.length)) return;
      const [item] = rack.splice(i, 1);
      P.gear[item] = (P.gear[item] ?? 0) + 1;
      refit(ship, ship.hull, ship.fit, ship.drones);
      return outfit();
    }
    if (m.t === 'sell') {
      if (!atStation() || !MATERIALS[m.mat]) return;
      const have = P.vault[m.mat] ?? 0;
      const n = Math.min(have, Math.max(1, Math.floor(+m.n || 0)));
      if (n <= 0) return;
      P.vault[m.mat] -= n;
      if (P.vault[m.mat] <= 0) delete P.vault[m.mat];
      P.credits += n * MATERIALS[m.mat].value;
      receipt(MATERIALS[m.mat].name, -n * MATERIALS[m.mat].value, `${n} sold`);
      return outfit();
    }

    if (m.t === 'respawn') {                      // you choose when to go back out
      if (!P.dead) return;
      const home = P.co + '1', hb = MAPS[home].base;
      const ang = Math.random() * 7, dist = Math.random() * hb.r * 0.6;
      P.mapId = home; P.dead = false; P.contacts.clear();
      refit(ship, ship.hull, ship.fit);           // rebuilt and repaired at your own dock
      Object.assign(ship, { x: hb.x + Math.cos(ang) * dist, y: hb.y + Math.sin(ang) * dist,
                            vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null,
                            charge: 0, chargeTo: null, jumpCd: JUMP_CD, shieldHit: 0 });
      touch(P);
      return ws.send(JSON.stringify({ t: 'map', map: home, respawned: true }));
    }
    if (P.dead) return;                           // nothing else reaches a wreck

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

  ws.on('close', () => {
    const p = players.get(id);
    if (p) { capture(p.acct, p, Date.now()); store.save(db); }   // last word on where you were
    for (const list of aliens.values()) forgetPlayer(list, id);
    players.delete(id);
    console.log(`- ${acct.name} (${players.size} online)`);
  });
});

let last = performance.now();
let idling = false;
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // With nobody connected there is nothing to simulate and nobody to see it.
  // Aliens hold position, bolts stay put, and a metered host stops billing for a
  // process that is only talking to itself.
  if (players.size === 0) {
    if (!idling) { persistAll(); idling = true; console.log('no players — world paused'); }
    return;
  }
  if (idling) { idling = false; console.log('world resumed'); }

  for (const [id, p] of players) {
    step(p.ship, dt);
    stepDrift(p.ship, dt);
    const map = MAPS[p.mapId];
    p.docked = canDock(map, p.co, p.ship);
    stepVitals(p.ship, dt, p.docked);

    // A repair drone works while nothing is shooting at you. Take a hit and it
    // stops, and the kit is gone — standing still for five seconds in open
    // space is the whole cost of not flying home.
    if (p.fixing) {
      if (p.ship.sinceHit < KIT_QUIET * 0.25 || p.ship.hp <= 0) {
        p.fixing = null;
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', from: '', text: 'repair interrupted' }));
      } else {
        p.ship.hp = Math.min(p.ship.stats.hull, p.ship.hp + p.fixing.rate * dt);
        p.fixing.left -= dt;
        if (p.fixing.left <= 0 || p.ship.hp >= p.ship.stats.hull) { p.fixing = null; touch(p); }
      }
    }



    if (p.dead) continue;                         // a wreck does not fly, shoot or scoop

    if (p.ship.hp <= 0) {                         // destroyed: the hold goes with it
      boom(p.mapId, p.ship, false, id);
      const lost = { ...p.hold };
      for (const [m, n] of Object.entries(p.hold)) drop(p.mapId, p.ship.x, p.ship.y, m, n);
      p.hold = {};
      p.dead = true;
      p.targetId = null; p.want = null; p.scoop = null; p.contacts.clear();
      dropRocketsAt(p.mapId, p.ship);
      for (const list of aliens.values()) forgetPlayer(list, id);   // death settles every grudge
      Object.assign(p.ship, { vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, charge: 0, chargeTo: null });
      touch(p);                                   // a lost hold must survive a hard kill
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'dead', lost, where: p.mapId }));
      continue;
    }

    const dest = stepJump(p.ship, MAPS[p.mapId], dt);
    if (!dest) continue;
    const a = arrivalFor(p.mapId, MAPS[dest]);
    dropRocketsAt(p.mapId, p.ship);              // nothing follows you through a portal
    p.mapId = dest;
    p.contacts.clear();
    p.targetId = null;             // jumping out breaks the engagement
    p.want = null; p.scoop = null;
    Object.assign(p.ship, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, jumpCd: JUMP_CD, charge: 0, chargeTo: null });
    touch(p);
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: p.mapId }));
  }

  // --- hostiles -------------------------------------------------------------
  for (const [mapId, list] of aliens) {
    const map = MAPS[mapId];
    const here = [];
    for (const [id, p] of players)
      if (p.mapId === mapId && !p.dead) here.push({ id, ship: p.ship, haven: inHaven(map, p.ship) });
    for (const a of list) {
      if (a.dead > 0) { a.dead -= dt; if (a.dead <= 0) respawnAlien(a, map); continue; }
      const tgt = stepAlienAI(a, map, here, dt);
      step(a, dt); stepDrift(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      faceTarget(a, victim?.ship);
      for (const shot of fire(a, victim?.ship ?? null, dt)) bolts.get(mapId).push(shot);
      for (const rk of launch(a, victim?.ship ?? null, dt)) rockets.get(mapId).push(rk);
      if (a.hp <= 0) killAlien(mapId, a);
    }
  }

  // --- player guns ----------------------------------------------------------
  for (const [id, p] of players) {
    const foe = p.targetId
      ? (aliens.get(p.mapId) ?? []).find(a => a.id === p.targetId && a.dead <= 0 && a.hp > 0)
      : null;
    if (!foe) { p.targetId = null; fire(p.ship, null, dt); launch(p.ship, null, dt); continue; }
    faceTarget(p.ship, foe);
    // Magazines are read fresh each tick and written straight back, so a pilot
    // cannot outrun their own ammunition by holding the trigger.
    const bolts0 = magazine(p.ammo, p.using, 'laser');
    const heads0 = magazine(p.ammo, p.using, 'rocket');
    // A safed weapon still runs its cooldown against no target, so bringing it
    // back does not hand you a free instant volley.
    const volley = p.armed.laser  ? fire(p.ship, foe, dt, bolts0)   : (fire(p.ship, null, dt, bolts0), []);
    const salvo  = p.armed.rocket ? launch(p.ship, foe, dt, heads0) : (launch(p.ship, null, dt, heads0), []);
    for (const m0 of [bolts0, heads0]) {
      if (m0.n === (p.ammo[m0.key] ?? 0)) continue;
      if (m0.n > 0) p.ammo[m0.key] = m0.n; else delete p.ammo[m0.key];
      touch(p);
    }
    for (const shot of volley) { shot.owner = id; bolts.get(p.mapId).push(shot); }
    for (const rk of salvo)    { rk.owner = id;   rockets.get(p.mapId).push(rk); }
    if (!volley.length && !salvo.length) continue;
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

  for (const [mapId, list] of rockets) {
    for (const h of stepRockets(list, dt)) {      // same bookkeeping, different flight
      hits.get(mapId).push({ x: h.target.x, y: h.target.y - h.target.r - 6,
                             n: h.split.shield + h.split.hull, sh: h.split.hull === 0,
                             by: h.rocket.owner ?? null, t: HIT_TIME, ttl: HIT_TIME });
      if (h.dead && h.target.isAlien) killAlien(mapId, h.target, h.rocket.owner ?? null);
    }
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
      sh: Math.round(100 * p.ship.shield / Math.max(1, shieldMax(p.ship))),
      flash: Math.round(100 * p.ship.shieldHit / SHIELD_FLASH),
      tgt: p.targetId ?? 0, shot: Math.round(100 * p.ship.shotFlash / SHOT_FLASH),
      fix: p.fixing ? Math.round(100 * (1 - p.fixing.left / p.fixing.secs)) : 0,
      rk: Math.round(100 * (p.ship.rocketFlash ?? 0) / LAUNCH_FLASH),
      guns: p.ship.guns ?? 1, lvl: levelFor(p.xp).level, drones: p.ship.drones.length,
      form: Math.max(0, FORMATION_KEYS.indexOf(p.ship.formation)),
      dmask: p.ship.drones.reduce((m2, k, i) => m2 | (EQUIPMENT[k]?.slot === 'weapon' ? 1 << i : 0), 0),
      psys: p.ship.power.to ? SYSTEMS.indexOf(p.ship.power.to) + 1 : 0,
      plvl: p.ship.power.to ? Math.round(100 * levelOf(p.ship.power, p.ship.power.to, p.ship.stats)) : 0 });
    if (p.dead) continue;
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId).push({ id, co: p.co, ship: p.ship });
  }
  for (const [mapId, list] of aliens) for (const a of list) {
    if (a.dead > 0) continue;
    row.set(a.id, { id: a.id, x: Math.round(a.x), y: Math.round(a.y), heading: +a.heading.toFixed(2),
      charge: 0, co: 'x', hull: a.kind,
      hp: Math.round(100 * a.hp / a.stats.hull),
      sh: Math.round(100 * a.shield / Math.max(1, shieldMax(a))),
      flash: Math.round(100 * a.shieldHit / SHIELD_FLASH),
      tgt: a.target ?? 0, shot: Math.round(100 * a.shotFlash / SHOT_FLASH),
      guns: 1, psys: 0, plvl: 0, lvl: 0, drones: 0, form: 0, dmask: 0, rk: 0, fix: 0 });
    if (!byMap.has(mapId)) byMap.set(mapId, []);
    byMap.get(mapId).push({ id: a.id, co: 'x', ship: a });   // 'x' == hostile to every company
  }
  for (const [vid, V] of players) {
    if (V.ws.readyState !== 1) continue;
    V.id = vid;
    const seen = stepContacts(V, byMap.get(V.mapId) ?? [], dt);
    const ships = [];
    for (const [tid, vis] of seen) ships.push(packShip({ ...row.get(tid), vis }));
    // The gallery. Static, unshootable, and only rendered for whoever is actually
    // in the workshop — they are scenery, not simulation.
    if (V.mapId === DEV_ID) for (const row2 of PROP_ROWS) ships.push(packShip(row2));
    const reach = V.ship.stats.radar;              // you see the shooting you could see
    const shown = (bolts.get(V.mapId) ?? []).filter(b =>
      Math.hypot(b.sx - V.ship.x, b.sy - V.ship.y) <= reach ||
      Math.hypot(b.ax - V.ship.x, b.ay - V.ship.y) <= reach);
    const missiles = (rockets.get(V.mapId) ?? []).filter(r =>
      Math.hypot(r.x - V.ship.x, r.y - V.ship.y) <= reach);
    // You see a kill you could have seen — and always your own, even though you
    // are already back at your home base by the time it plays.
    const flashes = (blasts.get(V.mapId) ?? []).filter(b =>
      b.who === V.id || Math.hypot(b.x - V.ship.x, b.y - V.ship.y) <= reach);
    const numbers = (hits.get(V.mapId) ?? []).filter(h =>
      h.by === vid || Math.hypot(h.x - V.ship.x, h.y - V.ship.y) <= reach);
    const cans = (pods.get(V.mapId) ?? []).filter(p =>
      Math.hypot(p.x - V.ship.x, p.y - V.ship.y) <= reach);
    V.ws.send(JSON.stringify({ t: 's', ships, bolts: shown.map(packBolt), rockets: missiles.map(packRocket),
      blasts: flashes.map(packBlast),
      hits: numbers.map(h => packHit(h, h.by === vid)),
      pods: cans.map(packPod), hold: V.hold, cap: V.ship.stats.cargo,
      credits: V.credits, docked: !!V.docked, vault: V.vault, gear: V.gear,
      ammo: V.ammo, using: V.using, armed: V.armed, kits: V.kits, kit: V.kit,
      xp: V.xp, rank: levelFor(V.xp), drones: V.ship.drones,
      // effective levels as whole percent, so the readout cannot jitter between
      // 29 and 30 from a float that is a hair under one
      power: { to: V.ship.power.to, cap: Math.round(100 * chargePct(V.ship.power, V.ship.stats)),
               lv: Object.fromEntries(SYSTEMS.map(sy =>
                 [sy, Math.round(100 * levelOf(V.ship.power, sy, V.ship.stats))])) },
      shieldNow: Math.round(V.ship.shield), shieldMax: Math.round(shieldMax(V.ship)),
      scoop: V.scoop ? { id: V.scoop.id, p: +(1 - V.scoop.t / SCOOP_TIME).toFixed(2) } : undefined,
      want: V.want ?? undefined }));
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`${GAME} — http://localhost:${PORT}`));
