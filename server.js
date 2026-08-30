import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, refit, step, stepVitals, stepDrift, applyDamage, drainHull, stepJump, beginJump, arrivalFor, inBase, canDock, inHaven, inOutpost, shieldMax, WORLD, SHIELD_FLASH, SHOT_FLASH } from './shared/sim.js';
import { fire, stepBolts, faceTarget } from './shared/combat.js';
import { launch, stepRockets, launcherRoom, LAUNCH_FLASH } from './shared/rockets.js';
import { newAlien, respawnAlien, stepAlienAI, stepAlienRepair, stepEvade, jinkHeading,
         broodReady, BROOD_R, shoveFromBase,
         forgetPlayer, ALIENS, ALIENS_PER_MAP, WILD, mayHarm, effectiveHp } from './shared/aliens.js';
import { DEV_ID, PROPS, PEN_SLOTS, propFit } from './shared/devmap.js';
import { respawnDelay } from './shared/spawn.js';
import { LAB_PRICE, MODULES, claimPlot, plotAt, plotsFor, incomeOf, earnedOver,
         cappedSecs, addMod, whyNotStake, whyNotBuild, nearLab, applyResearch } from './shared/research.js';
import { AMMO, FEEDS, magazine, sanitiseUsing, sanitiseArmed, whyNotBuy,
         whyNotLoad, loadable } from './shared/ammo.js';
import { isTrack, typeOf, servable } from './shared/music.js';
import { nameProblem, cleanName } from './shared/signup.js';
import { MUSIC_DIRS, pickDir } from './config.js';
import { KITS, kitPrice, sanitiseKit, whyNotRepair, KIT_QUIET } from './shared/repair.js';
import { DEVICES, devicePrice, sanitiseDevice, whyNotDevice } from './shared/devices.js';
import { HULLS, sanitiseFit, slotsOf, resolve, hullPrice, DEFAULT_HULL } from './shared/ships.js';
import { EQUIPMENT, SLOTS, priceOf, reseat, emptyFit,
         MAX_DRONES, dronePrice, sanitiseDrones, sanitiseRig, isCollector, topTier, collectorReach,
         whyNotSold, frontierOnly } from './shared/gear.js';
import { levelFor } from './shared/level.js';
import { COMMANDS, parse, amount, MAX_LEN } from './shared/chat.js';
import { routeTo, levelOf, chargePct, SYSTEMS } from './shared/power.js';
import { SPECIAL, ABILITIES } from './shared/ability.js';
import { FORMATIONS, FORMATION_KEYS, formationPrice, DEFAULT_FORMATION } from './shared/formation.js';
import { stepContacts, ALLY } from './shared/radar.js';
import { packShip, packBolt, packRocket, packBlast, packPod, packHit, packLab, packPyre } from './shared/net.js';
import { storeHit, stepMirror, spendMirror } from './shared/aliens.js';
import { stepSiphon, tetherHolds, DRAIN_TELL } from './shared/siphon.js';
import { burnOf, burnR, stepBurn, goadBurn, burnBite, pyreFor, inPyre, poolOf, inBurn } from './shared/burn.js';
import { newBase, needsFull, encodeFull, encodeDelta } from './shared/delta.js';
import { newAccount, sanitiseAccount, capture } from './shared/account.js';
import { GAME } from './shared/brand.js';
import { whyNotBerth, whyNotBuyBerth, berthPrice, BERTH_RANK,
         respawnAt, isHangar, homePorts, foldTo } from './shared/berth.js';
import { splitKill, shareOut } from './shared/reward.js';
// What the fitted technologies actually DO. gear.js says it in a sentence and
// this says it in numbers; nothing about a capability is decided here.
import { holdShear, foundryBurn, wakeTap, platingArmed, platingBack, loudOf,
         PLATE_BACK, FOUNDRY_QUIET } from './shared/tech.js';
import { whyNotScrap, whyNotScrapHull, scrapOfItem, scrapOfHull, SCRAP_RATE } from './shared/scrap.js';
import { refineStep, applyRefine, refinePeriod } from './shared/refine.js';
import { sessionSeconds, fmtPlayed } from './shared/playtime.js';
import * as store from './store.js';
import crypto from 'node:crypto';
import { MATERIALS, rollDrop, stow, unload, load, holdVol, beginScoop, stepScoop, approachPod,
         POD_LIFE, SCOOP_R, SCOOP_TIME, droneSpeed, rigAt, DWELL, mayScoop,
         pirateValue, PIRATE_RATE, claimLapsed, CLAIM_TIME, tollOn, DEATH_TOLL } from './shared/cargo.js';
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
// The tracks are deliberately not in the repo, so in production they live on the
// mounted volume beside the save file. Resolved per call rather than at boot, so
// uploading music to a running service works without a redeploy.
const musicDir = () => pickDir(MUSIC_DIRS, d => fs.existsSync(d));
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
  scan(musicDir(), '');
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
    const type = typeOf(name), file = `${musicDir()}/${name}`;
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

// Telling a client it is somewhere else voids everything it has been told about
// where it was, so the baseline goes with the message. Doing it here rather than
// leaving it to the sector having changed covers the two cases where it has not:
// dying in your own home sector, and /tp to the sector you are already in. Both
// left the client refusing deltas for two ticks until it could ask for a
// keyframe — a self-healing blank, but a blank.
const sendMap = (p, extra = {}) => {
  p.base = newBase();
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'map', map: p.mapId, ...extra }));
};
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
// A hostile's own size, for anything reasoning in shares of it — a Censer's ring
// winds up by what has been taken OFF it, so it needs to know what it started with.
const alienEhp = a => (a?.isAlien ? effectiveHp(a.kind) : 0);
const touch = p => { capture(p.acct, p, Date.now()); dirty = true; };

// --- the yard -----------------------------------------------------------------
//
// Every research station standing in every company ring, keyed by the sector it is
// in. Rebuilt from the accounts rather than stored separately, because an account
// IS the record — a second list would be a second truth to keep in step.
//
// The map is derived from the owner's company, so a pilot who changes sides takes
// their station with them rather than leaving an orphan behind.
const labId = a => 2_000_000 + (a.seq ?? 0);       // clear of ship ids and of alien ids
const labMap = a => (a.co ?? 'm') + '1';

function yard() {
  const out = new Map();
  for (const [tok, a] of Object.entries(db.accounts)) {
    if (!a.lab || a.lab.slot === null) continue;
    const mid = labMap(a), base = MAPS[mid]?.base;
    const at = base && plotAt(base, a.lab.slot);
    if (!at) continue;
    if (!out.has(mid)) out.set(mid, []);
    out.get(mid).push({ id: labId(a), x: at.x, y: at.y, mods: a.lab.mods | 0,
                        name: a.name ?? '', token: tok });
  }
  return out;
}
let labs = new Map();
const reyard = () => { labs = yard(); };

// Turning elapsed wall clock into credits, in ONE place.
//
// The mine runs whether or not anyone is logged in — a mining operation does not
// stop because you closed the tab — so this is called on the way in (paying for
// the time you were away), once a second while you fly, and before any upgrade
// that would change the rate.
//
// Once a SECOND, not once a tick. `credits` is a bag field the delta codec
// compares as text, so paying out at 30Hz would put the balance on the wire
// thirty times a second for a number that moves by twelve.
//
// Whole credits only, and the remainder is left in `since` rather than dropped:
// at 12 cr/s a per-tick floor would round away most of the income and the mine
// would quietly pay a fraction of what it promised.
function bankLab(p, now = Date.now()) {
  const lab = p?.lab;
  if (!lab) return 0;
  const rate = incomeOf(lab.mods);
  if (rate <= 0) { lab.since = now; return 0; }
  const secs = cappedSecs((now - (lab.since ?? now)) / 1000);
  const paid = earnedOver(lab.mods, secs);
  if (paid <= 0) return 0;
  p.credits += paid;
  // Advance by exactly what was paid for, so the fraction of a credit that did
  // not round survives into the next second instead of being thrown away.
  lab.since = (lab.since ?? now) + Math.round((paid / rate) * 1000);
  return paid;
}

// A station bought before the lattice existed, one whose plot did not survive
// sanitising, or a duplicate out of a hand-edited save. Placed once at boot; a
// plot that is already good is never touched, because re-deriving would move a
// pilot's station the first time a neighbour bought one.
{
  const held = new Map();
  for (const a of Object.values(db.accounts).sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0))) {
    if (!a.lab) continue;
    const mid = labMap(a), base = MAPS[mid]?.base;
    if (!base) { a.lab = null; continue; }
    if (!held.has(mid)) held.set(mid, []);
    const taken = held.get(mid);
    const ok = a.lab.slot !== null && a.lab.slot < plotsFor(base).length && !taken.includes(a.lab.slot);
    if (!ok) a.lab.slot = claimPlot(a.token ?? a.name ?? String(a.seq), base, taken);
    if (a.lab.slot !== null) taken.push(a.lab.slot);
  }
  reyard();
  const standing = [...labs.values()].reduce((n, l) => n + l.length, 0);
  const perRing = plotsFor(MAPS[HOMES[0]].base).length;
  if (standing) console.log(`research stations: ${standing} standing, ${perRing} plots to a ring`);
}
setInterval(() => { if (dirty) { store.save(db); dirty = false; } }, 1000);
setInterval(persistAll, 15000);   // positions drift without changing anything
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => { persistAll(); console.log('accounts saved'); process.exit(0); });

// Where each hostile lives.
//
// ONE RULE, and it was broken in two places before it was written down: the further
// a sector is from your home ring, the harder the hardest thing in it. Measured in
// hops over the real portal graph, and in farm hit points, which is what the game
// actually pays for:
//
//   0 hops  home ring   Drifter                              650
//   1 hop   co2, co3    Harrier / Ironhusk                 6,500
//   2 hops  frontier    Bandit, Leviathan                114,000
//   3 hops  the gates   Thresher                         205,550
//   4 hops  the deeps   Corsair Hive                     650,000
//
// What was wrong. co2 and co3 are the same distance out and held a 10x spread —
// an Ironhusk at 6,500 against a Leviathan at 65,000 — so which sibling you
// happened to fly into decided whether the game had a difficulty curve. And the
// deeps were EASIER than the gates you pass through to reach them, 205,550 behind
// 650,000, which is the curve running backwards at the one place a pilot has
// earned the right to expect it not to.
//
// The Leviathan moved out to the frontier and the Hive moved out to the deeps. The
// gates keep a boss and the deeps get the bigger one; both are contested ground, so
// nothing about three companies meeting is lost.
//
// The ceiling is what climbs. Every map also keeps something a rung or two below
// its ceiling, because a sector with nothing workable in it is a sector you fly
// through rather than a sector you use — that is why Harriers stand at the frontier
// beside the Bandits, and why the siblings still differ: co2 asks whether your guns
// are good enough and co3 asks whether you can catch anything.
//
// Seeded per map so a restart replays the same field.
const aliens = new Map();
let alienId = 1_000_000;
const seed = (mapId, kind, n) => {
  const list = aliens.get(mapId) ?? [];
  for (let i = 0; i < n; i++)
    list.push(newAlien(kind, alienId++, MAPS[mapId], mapId.charCodeAt(0) * 977 + i * 7919 + kind.length));
  aliens.set(mapId, list);
};
aliens.set(DEV_ID, PEN_SLOTS.map(sl => newAlien(sl.kind, sl.id, MAPS[DEV_ID], sl.id, { x: sl.x, y: sl.y })));
for (const h of HOMES) {
  seed(h, 'drifter', ALIENS_PER_MAP);
  const co = h[0];
  for (const mid of [co + '2', co + '3']) seed(mid, 'drifter', 4);
  seed(co + '2', 'ironhusk', 3);                  // one hop out: the first thing that outclasses your guns
  seed(co + '2', 'harrier', 2);
  seed(co + '3', 'censer', 3);                    // the other hop out: the same weight, the opposite question
  seed(co + '3', 'harrier', 5);
  seed(co + '3', 'ironhusk', 1);
  seed(co + '4', 'bandit', 3);                    // the frontier, and the first real fight
  seed(co + '4', 'leviathan', 2);                 // and the first thing you cannot beat alone
  // The rung between the Harriers and the Leviathan, and the only thing out here
  // that a single fighter-stage pilot is meant to be able to finish. It does not
  // move the sector's ceiling — a Bandit is still the hardest thing on the
  // frontier — it fills the 31x hole underneath it. It belongs at a frontier
  // rather than one hop in for two reasons that are both about the answer to it:
  // this is where a full hold makes breaking off expensive, and this is the only
  // sector with an outpost, which is somewhere to break off TO.
  seed(co + '4', 'lamprey', 3);
  // Harriers, not Drifters. The frontier was a wall: Bandits hold it, and a pilot
  // who could afford the trip could not survive the welcome, so the only reason to
  // go was the shop. Something farmable out here means you can work the sector at
  // the edge of your ability and leave when a Bandit notices — which is the fight
  // worth having, and the Drifters that used to stand here were not it.
  seed(co + '4', 'harrier', 4);
}
// A Thresher on each gate — the first contested ground past your own frontier, and
// the first place three companies can arrive at once. It is the right thing to meet
// there: a mirror asks what your gun is rather than what your hull is, which is the
// question a pilot arriving from the frontier has never been asked.
//
// Nullpoint itself is still empty. Putting the only boss at the very bottom of the
// map put it where almost nobody would meet it, and the point of the thing is to
// be met.
for (const g of GALAXY.filter(id => MAPS[id].gate)) seed(g, 'thresher', 1);

// The deeps were seeded with nothing at all — three sectors past the gates, which a
// pilot can only reach by getting through one, and there was nothing there when
// they arrived. They hold the Hive now: it is the biggest thing in the game and it
// belongs at the furthest thing from home, not one map short of it. They are
// contested ground too, so three companies can still arrive at once.
for (const d of GALAXY.filter(id => MAPS[id].deep)) seed(d, 'hive', 1);

// The hull and formation galleries, resolved once at boot. They never move, take
// damage or shoot, so there is nothing to step — just rows to hand out.
const PROP_ROWS = PROPS.map(p2 => {
  const s2 = newShip(p2.x, p2.y, p2.hull, propFit(p2.hull), Array(MAX_DRONES).fill(topTier('weapon')), p2.formation);
  return { id: p2.id, x: p2.x, y: p2.y, heading: 0, charge: 0, co: p2.co, hull: p2.hull,
           hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0,
           guns: s2.guns, lvl: 0, drones: s2.drones.length,
           form: Math.max(0, FORMATION_KEYS.indexOf(p2.formation)),
           dmask: (1 << MAX_DRONES) - 1, psys: 0, plvl: 0, vis: ALLY,
           rig: 0, rgx: 0, rgy: 0, rgp: -1, rgf: -1, wrp: 0, abl: 0, name: '' };
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
const pyres = new Map();     // mapId -> reactors that have died and not yet let go
for (const id of Object.keys(MAPS)) { bolts.set(id, []); rockets.set(id, []); blasts.set(id, []); pyres.set(id, []); }

const pods = new Map();      // mapId -> cargo adrift
for (const id of Object.keys(MAPS)) pods.set(id, []);
let podId = 1;
const drop = (mapId, x, y, mat, n, own = 0) => {
  if (n > 0) pods.get(mapId).push({ id: podId++, x: x + (Math.random() - .5) * 70,
                                    y: y + (Math.random() - .5) * 70, mat, n, own, t: POD_LIFE });
};

const hits = new Map();      // mapId -> damage numbers still climbing
for (const id of Object.keys(MAPS)) hits.set(id, []);
const HIT_TIME = 0.95;

const BLAST_TIME = 0.8;
const boom = (mapId, e, foe, who) =>
  blasts.get(mapId).push({ x: e.x, y: e.y, r: e.r, foe, who, t: BLAST_TIME, ttl: BLAST_TIME });

// Every point a player lands on an alien is remembered, because the bounty is
// settled on the ledger and not on whoever fires last.
const tally = (target, by, amount) => {
  if (by === null || amount <= 0) return;
  if (!target.isAlien || !players.has(by)) return;
  target.dealt.set(by, (target.dealt.get(by) ?? 0) + amount);
};

// One place that kills an alien, so the flash can never be forgotten at a call site.
const killAlien = (mapId, a, byId = null) => {
  if (a.dead > 0) return;
  // A kill with an empty ledger still pays whoever finished it: shear, a dev
  // command, anything that damages an alien without a bolt of its own.
  if (!a.dealt.size && byId !== null) a.dealt.set(byId, 1);
  const cuts = splitKill(a.dealt, a.def.bounty, a.def.xp ?? a.def.bounty);
  for (const cut of cuts) {                       // your company pays out on confirmation
    const paid = players.get(cut.id);
    if (!paid) continue;                          // signed off between the last hit and the kill
    const was = levelFor(paid.xp).level;
    paid.credits += cut.credits;
    paid.xp += cut.xp;
    const now2 = levelFor(paid.xp);
    // A Wake Tap hands back the seconds of reactor the fight took. Your share of
    // the bounty IS those seconds — see wakeSeconds, which does the division that
    // balance.js's identity makes exact — so it is settled here, on the same
    // ledger that pays the credits, rather than by whoever fired last.
    wakeTap(paid.ship, cut.credits);
    touch(paid);                                  // credits and rank banked immediately
    if (paid.ws.readyState === 1) paid.ws.send(JSON.stringify(
      { t: 'award', amount: cut.credits, xp: cut.xp, what: a.def.name,
        total: paid.credits, level: now2.level, promoted: now2.level > was,
        with: cuts.length - 1, share: cut.share }));
  }
  boom(mapId, a, true, a.id);
  // The ore is shared on the same terms as the bounty. One pod that whoever got
  // there first took meant two rigs racing over a haul both pilots had earned,
  // and the faster ship won cargo the slower one had paid for in hull.
  // A reactor does not simply stop. The ring stands where it died for `fuse` seconds
  // and then lets go of everything it was still holding — which is why range
  // discipline through the whole fight is the answer to a Censer and nothing else is.
  if (burnOf(a.def) && (a.spin ?? 0) > 0) pyres.get(mapId).push(pyreFor(a, 1));

  const loot = rollDrop(a.kind, a.rand);          // seeded, so drops replay with the alien
  if (loot && cuts.length) {
    const shares = shareOut(cuts, loot.n);
    cuts.forEach((c, i) => drop(mapId, a.x, a.y, loot.mat, shares[i], c.id));
  } else if (loot) {
    drop(mapId, a.x, a.y, loot.mat, loot.n);       // nobody on the ledger: anyone's
  }
  a.dead = a.def.respawn; a.target = null; a.provoked.clear(); a.dealt.clear();
  a.crowd = a.threat = null; a.crowdT = a.threatT = 0;
};

// Snapshots compress extraordinarily well, and for one specific reason: two
// consecutive ones are nearly the same text, and permessage-deflate keeps its
// dictionary between messages. Context takeover is therefore left ON — turning
// it off, which is the usual advice, throws away the whole effect.
//
// Measured with twenty pilots fighting in one sector, bytes counted off the
// client's socket (test/wire-live.mjs):
//
//     delta, uncompressed   11.87 KiB/s per player    75.7 ms CPU/s
//     delta + this           4.95 KiB/s per player   113.2 ms CPU/s
//     delta + ws's defaults  4.61 KiB/s per player   169.6 ms CPU/s
//
// So the defaults buy 0.34 KiB/s more for half as much CPU again, and 32KB of
// dictionary per connection per direction on top. A 4KB window at level 3 is
// where the curve stops being worth it.
//
// How much it gets is not a constant, and this is worth knowing before trusting
// a single run: across five runs of the same fight it took between 24% and 55%
// of what the delta had left. Two snapshots being alike is what it trades on,
// and a busier fight carries more bolts and damage numbers, which are all
// different from each other and compress like noise.
//
// It does not come out of the tick. zlib runs on the libuv threadpool, and the
// median gap between snapshots was 34.0ms with it and 34.2ms without — the tick
// either way. What it does cost is a little tail latency: the 95th percentile
// gap went from 42.9ms to 50.2ms, measured over a loopback where the bytes it
// saves were free to send in the first place.
//
// threshold 0 because a delta is usually a few hundred bytes and ws's default of
// 1024 would leave nearly every one of them uncompressed — which is to say, off.
// 0, 64 and 256 were all measured and came out the same to within noise (4.74,
// 4.65 and 4.72 KiB/s in that fight), so it is set to the one that needs no
// explaining.
const wss = new WebSocketServer({ server, perMessageDeflate: {
  threshold: 0,
  serverMaxWindowBits: 12, clientMaxWindowBits: 12,
  zlibDeflateOptions: { level: 3, memLevel: 6 },
} });
wss.on('connection', (ws, req) => {
  const id = nextId++;
  const now = Date.now();

  let token = '';
  try { token = new URL(req.url, 'http://x').searchParams.get('t') || ''; } catch {}
  let acct = db.accounts[token];
  const returning = !!acct;
  // A first visit gets a pilot that exists but is not written down: no token
  // saved, no row in the accounts file, and no presence in anyone's sector until
  // they have chosen a name and a company. Wander off before then and nothing of
  // you was ever kept.
  let lobby = !acct;
  if (!acct) {
    token = crypto.randomBytes(16).toString('hex');
    acct = newAccount(token, db.seq++, now);
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

  const ship = newShip(acct.x, acct.y, acct.hull, acct.fit, acct.drones, acct.formation, acct.rig,
                       acct.lab?.mods ?? 0);
  players.set(id, { ws, token, acct, mapId: acct.mapId, co: acct.co, ship,
                    contacts: new Map(), targetId: null,
                    // What this connection has been told. Per connection, never per
                    // map: radar means two pilots in the same sector see different
                    // things, so there is no shared previous world to diff against.
                    base: newBase(),
                    hold: { ...acct.hold }, vault: { ...acct.vault }, credits: acct.credits,
                    gear: { ...acct.gear }, hulls: [...acct.hulls], xp: acct.xp,
                    formations: [...acct.formations],
                    ammo: { ...acct.ammo }, using: { ...acct.using }, armed: { ...acct.armed },
                    kits: { ...acct.kits }, kit: acct.kit, fixing: null,
                    devices: { ...acct.devices }, device: acct.device, folding: null,
                    foldTo: acct.foldTo ?? null, lab: acct.lab ?? null,
                    berths: [...(acct.berths ?? [])], lastDock: acct.lastDock ?? null,
                    scoop: null, want: null, dead: false, lobby,
                    // Composite Plating starts seated. You sign in at a dock or a
                    // hangar either way, and the tick would re-seat it a frame
                    // later — starting it false would only mean one frame where
                    // the readout lied about it.
                    plate: true,
                    acted: Date.now(), banked: Date.now() });
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
  // What a grade is allowed to be loaded into, right now. Rebuilt on every refit
  // rather than remembered, because the answer changes when the ship does.
  const feeding = () => ({ fit: ship.fit, drones: ship.drones, EQUIPMENT });
  // Every refit funnels through outfit(), so this is where an illegal load is
  // caught: sell the one emitter that was holding your Fusion Cells legal and the
  // guns must drop to something they can fire, not go quietly silent.
  const regrade = P => {
    const was = { ...P.using };
    P.using = sanitiseUsing(P.using, P.ammo, feeding());
    for (const f of FEEDS) if (was[f] !== P.using[f])
      tell(`${AMMO[was[f]].name} unloaded — ${whyNotLoad(was[f], feeding())}`);
  };
  const outfit = () => (regrade(players.get(id)), touch(players.get(id)), ws.send(JSON.stringify({ t: 'fit', hull: ship.hull, fit: ship.fit,
                                                drones: ship.drones, rig: ship.rig ?? null, formation: ship.formation,
                                                formations: players.get(id).formations,
                                                ammo: players.get(id).ammo, using: players.get(id).using,
                                                armed: players.get(id).armed,
                                                kits: players.get(id).kits, kit: players.get(id).kit,
                                                devices: players.get(id).devices, device: players.get(id).device,
                                                foldTo: players.get(id).foldTo,
                                                berths: players.get(id).berths,
                                                gear: players.get(id).gear, hulls: players.get(id).hulls,
                                                credits: players.get(id).credits })));
  const sendWelcome = () => ws.send(JSON.stringify({ t: 'welcome', id, token, name: acct.name,
                           map: acct.mapId, co: acct.co, hull: acct.hull, fit: acct.fit,
                           gear: acct.gear, hulls: acct.hulls, credits: acct.credits,
                           drones: acct.drones, xp: acct.xp, admin: isAdmin(acct),
                           formation: acct.formation, formations: acct.formations,
                           ammo: acct.ammo, using: acct.using, armed: acct.armed,
                           kits: acct.kits, kit: acct.kit,
                           devices: acct.devices, device: acct.device, berths: acct.berths ?? [],
                           foldTo: acct.foldTo ?? null,
                           rig: acct.rig ?? null, played: acct.played ?? 0 }));

  // Who the sides are and how full each is, so somebody choosing can see whether
  // they would be evening things up.
  const sides = () => ({ companies: Object.entries(COMPANIES).map(([key, c]) => ({
    key, tag: c.tag, name: c.name, color: c.color,
    pilots: Object.values(db.accounts).filter(a => a.co === key).length })) });

  if (lobby) ws.send(JSON.stringify({ t: 'signup', ...sides() }));
  else {
    sendWelcome();
    console.log(`+ ${acct.name} [${COMPANIES[acct.co].tag}] ${HULLS[acct.hull].name} ` +
                `back in ${MAPS[acct.mapId].name} (${players.size} online)`);
  }

  // Clients send INTENT only — never position. The server owns the truth.
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    const P = players.get(id);
    // Playtime is measured to the last thing a pilot actually did. Anything they
    // send counts, including a keypress that changes nothing — it is presence
    // that is being measured, not productivity.
    if (P) P.acted = Date.now();

    if (lobby) {                                  // nothing works until you exist
      if (m.t !== 'join') return;
      const why = nameProblem(m.name, Object.values(db.accounts).map(a => a.name));
      if (why) return ws.send(JSON.stringify({ t: 'signup', problem: why, ...sides() }));
      if (!COMPANIES[m.co]) return ws.send(JSON.stringify({ t: 'signup', problem: 'pick a side', ...sides() }));
      acct.name = cleanName(m.name);
      acct.co = m.co;
      acct.mapId = m.co + '1';
      const b = MAPS[acct.mapId].base;
      acct.x = b.x; acct.y = b.y;
      Object.assign(ship, { x: b.x, y: b.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null });
      P.co = acct.co; P.mapId = acct.mapId;
      db.accounts[token] = acct;
      store.save(db);                             // on disk before they fly anywhere
      lobby = false; P.lobby = false;
      sendWelcome();
      console.log(`+ ${acct.name} [${COMPANIES[acct.co].tag}] joined (${players.size} online)`);
      return;
    }

    // The client's half of the keyframe contract: it asks when it is holding a
    // delta with nothing to apply it to. Dropping the baseline makes the very
    // next tick a full snapshot, so there is no partial state to repair and
    // nothing to negotiate — and no way to abuse it either, since the worst a
    // client can do by asking every tick is receive the full snapshot this game
    // sent every tick until now.
    if (m.t === 'need') { if (P) P.base = newBase(); return; }

    if (m.t === 'jump') return beginJump(ship, MAPS[P.mapId]);

    // --- station: everything below needs you sitting in your own base ring ---
    // Your own dock, or a berth you rent at a pirate outpost. The berth is the
    // same counter for everything that reads atStation() — refit, buy, sell — and
    // it closes the moment anything hits you, because a shop you can use mid-fight
    // is a shop that ends fights. It is not a haven and it does not repair.
    const atBerth = () => !whyNotBerth({
      owned: P.berths.includes(P.mapId), inside: inOutpost(MAPS[P.mapId], ship),
      sinceHit: ship.sinceHit,
    });
    const atStation = () => canDock(MAPS[P.mapId], P.co, ship) || atBerth();

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
          return tell(`inventory: ${a1} x${P.gear[a1]}`);
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
          return tell(`${HULLS[a1].name} is yours — fly it from the HANGAR tab at a dock`);
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
          sendMap(P);
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
          sendMap(P);
          return tell(`jumped to ${MAPS[a1].name}`);
        }
        // Back to nothing, so a finished pilot can go and find out what the
        // first ten minutes actually feel like. Plain `/reset` keeps who you
        // are and takes everything else; `/reset all` forgets the account, so
        // the next thing you see is the join form.
        case 'reset': {
          const wipe = (a1 ?? '').toLowerCase() === 'all';
          if (wipe) {
            delete db.accounts[token];
            store.save(db);
            players.delete(id);
            for (const list of aliens.values()) forgetPlayer(list, id);
            ws.send(JSON.stringify({ t: 'reset' }));   // the client drops its token and reloads
            console.log(`~ ${acct.name} wiped their account`);
            return;
          }
          const seq = acct.seq, co = acct.co, name = acct.name, admin = acct.admin;
          acct = newAccount(token, seq, Date.now());
          Object.assign(acct, { name, co, admin, mapId: co + '1' });
          const b2 = MAPS[acct.mapId].base;
          acct.x = b2.x; acct.y = b2.y;
          db.accounts[token] = acct;

          P.acct = acct; P.mapId = acct.mapId; P.co = co;
          P.credits = 0; P.xp = 0;
          P.gear = {}; P.hulls = [...acct.hulls]; P.formations = [...acct.formations];
          P.ammo = { ...acct.ammo }; P.using = { ...acct.using }; P.armed = { ...acct.armed };
          P.kits = {}; P.kit = acct.kit;
          P.hold = {}; P.vault = {};
          P.targetId = null; P.want = null; P.scoop = null; P.fixing = null;
          P.contacts.clear();
          refit(ship, acct.hull, acct.fit, [], acct.formation, null);
          Object.assign(ship, { x: b2.x, y: b2.y, vx: 0, vy: 0, tx: null, ty: null,
                                dx: null, dy: null, charge: 0, chargeTo: null });
          store.save(db);
          sendWelcome();
          sendMap(P);
          console.log(`~ ${acct.name} reset to a new pilot`);
          return tell('reset — a starter hull, no credits, and your own dock again');
        }
        case 'heal':
          ship.hp = ship.stats.hull;
          ship.shield = ship.stats.shield * (ship.shieldMult ?? 1);
          ship.power.charge = ship.stats.capacitor;
          ship.sinceHit = 1e9;
          return tell('hull, shields and capacitor back to full');
      }
      return;
    }

    if (m.t === 'buyhull') {
      if (!atStation() || !HULLS[m.key] || P.hulls.includes(m.key)) return;
      if (P.credits < hullPrice(m.key)) return;
      P.credits -= hullPrice(m.key);
      P.hulls.push(m.key);
      refit(ship, m.key, ship.fit, ship.drones, ship.formation);   // bought, and flown at once
      receipt(HULLS[m.key].name, hullPrice(m.key), 'bought, and you are flying it');
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
      // Buying a tier you are not carrying loads it. Otherwise the rack keeps
      // reading zero because it is still pointed at a kit you own none of.
      if (!(P.kits[P.kit] > 0)) P.kit = m.key;
      receipt(k.name, kitPrice(m.key), `${P.kits[m.key]} aboard`);
      return outfit();
    }
    if (m.t === 'kit') {                          // which one the button uses
      if (!KITS[m.key]) return;
      P.kit = sanitiseKit(m.key);
      touch(P);
      return outfit();
    }
    if (m.t === 'buydevice') {                    // beacons are a dock purchase, like kits
      const d = DEVICES[m.key];
      if (!atStation() || !d || P.credits < devicePrice(m.key)) return;
      P.credits -= devicePrice(m.key);
      P.devices[m.key] = (P.devices[m.key] ?? 0) + 1;
      if (!(P.devices[P.device] > 0)) P.device = m.key;
      receipt(d.name, devicePrice(m.key), `${P.devices[m.key]} aboard`);
      touch(P);
      return outfit();
    }
    if (m.t === 'device') {                       // choose which one is loaded
      if (!DEVICES[m.key]) return;
      P.device = sanitiseDevice(m.key);
      touch(P);
      return outfit();
    }
    if (m.t === 'foldto') {                       // and where it puts you down
      if (typeof m.map !== 'string') return;
      // Stored as asked, not as resolved. If they rent a bay, sell it and buy it
      // back, the beacon should still be pointed at it — resolving here would have
      // quietly moved them home in between and never moved them back.
      if (!homePorts(P, MAPS).some(h => h.map === m.map)) return tell('no hangar of yours there');
      P.foldTo = m.map;
      touch(P);
      return outfit();
    }
    if (m.t === 'recall') {
      const why = whyNotDevice({ devices: P.devices, using: P.device,
                                 docked: !!P.docked, busy: !!P.folding });
      if (why) return tell(why);
      const d = DEVICES[P.device];
      // Nothing is spent here. Being interrupted is already the punishment, and
      // charging for the attempt would mean the only safe time to press it is a
      // time you did not need it.
      P.folding = { key: P.device, left: d.secs, secs: d.secs, mark: ship.sinceHit };
      return;
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
      // Refused out loud, not silently downgraded. sanitiseUsing would have
      // quietly handed back the grade they were already on, and a menu that
      // does nothing when clicked is worse than one that says why.
      const why = AMMO[m.key] && whyNotLoad(m.key, feeding());
      if (why) return tell(why);
      const want = sanitiseUsing({ ...P.using, ...(AMMO[m.key] ? { [AMMO[m.key].for]: m.key } : {}) },
                                 P.ammo, feeding());
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
      // A grade is calibrated for a rack. You cannot buy rounds for a gun you have
      // not bought — which is what stops the ladder being one you skip on minute
      // one. Using rounds you already hold is never blocked: selling a gun should
      // not strand the ammunition in your hold.
      const why = whyNotBuy(m.key, { fit: ship.fit, drones: ship.drones, EQUIPMENT });
      if (why) return tell(why);
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
      receipt(FORMATIONS[m.key].name, formationPrice(m.key), 'your escort is flying it');
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
      receipt(`Drone ${ship.drones.length}`, cost, `${ship.drones.length} of ${MAX_DRONES} bays used`);
      return outfit();
    }
    if (m.t === 'dronefit') {
      const item = EQUIPMENT[m.item], i = +m.index;
      if (!atStation() || !item || !(P.gear[m.item] > 0)) return;
      if (!(i >= 0 && i < ship.drones.length) || ship.drones[i]) return;
      const next = [...ship.drones]; next[i] = m.item;
      const clean = sanitiseDrones(next, ship.fit, undefined, slotsOf(ship.hull).tech);
      if (clean[i] !== m.item) return;              // refused, e.g. a duplicate technology
      if (--P.gear[m.item] <= 0) delete P.gear[m.item];
      refit(ship, ship.hull, ship.fit, clean);
      return outfit();
    }
    // The rig bay. Its own handlers rather than an index into the drone rack,
    // because it is not a drone bay and must never be spendable as one.
    if (m.t === 'rigfit') {
      const item = EQUIPMENT[m.item];
      if (!atStation() || !item || !isCollector(m.item) || !(P.gear[m.item] > 0)) return;
      if (ship.rig) return;                         // strip the one you have first
      if (--P.gear[m.item] <= 0) delete P.gear[m.item];
      refit(ship, ship.hull, ship.fit, ship.drones, ship.formation, sanitiseRig(m.item));
      return outfit();
    }
    if (m.t === 'rigstrip') {
      if (!atStation() || !ship.rig) return;
      P.gear[ship.rig] = (P.gear[ship.rig] ?? 0) + 1;
      refit(ship, ship.hull, ship.fit, ship.drones, ship.formation, null);
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
      if (!item) return;
      // Your company stocks what it issues. The upper half of every ladder comes
      // off a pirate hulk, and only to a pilot who rents a bay there.
      const why = whyNotSold(m.item, { docked: canDock(MAPS[P.mapId], P.co, ship), berth: atBerth() });
      if (why) return tell(why);
      if (P.credits < item.price) return;
      P.credits -= item.price;
      P.gear[m.item] = (P.gear[m.item] ?? 0) + 1;
      receipt(item.name, item.price, 'in your inventory');
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
      receipt(MATERIALS[m.mat].name, -n * MATERIALS[m.mat].value, `${n} sold from the hangar`);
      return outfit();
    }

    if (m.t === 'respawn') {                      // you choose when to go back out
      if (!P.dead) return;
      // Back at the last hangar you used, which may be a bay you rent four sectors
      // out. Flying home from the frontier every time you died was the least
      // interesting minute in the game, and a pilot who paid for a bay has already
      // said where they want to be.
      const at = respawnAt(P, MAPS);
      // Belt and braces on a bug that stranded people. A hangar without a radius
      // scatters you by NaN, and a NaN position is unrecoverable from inside the
      // game: you cannot fly out of it and dying again puts you back in it. If the
      // ring has no size, come back on the exact spot rather than nowhere.
      const spread = Number.isFinite(at.r) ? at.r * 0.6 : 0;
      const ang = Math.random() * 7, dist = Math.random() * spread;
      P.mapId = at.map; P.dead = false; P.contacts.clear();
      refit(ship, ship.hull, ship.fit);           // rebuilt and repaired at your own dock
      Object.assign(ship, { x: at.x + Math.cos(ang) * dist, y: at.y + Math.sin(ang) * dist,
                            vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null,
                            charge: 0, chargeTo: null, jumpCd: JUMP_CD, shieldHit: 0 });
      touch(P);
      return sendMap(P, { respawned: true });
    }
    if (P.dead) return;                           // nothing else reaches a wreck

    // A round trip, for the performance readout. Echoed with whatever the client
    // stamped on it, so the client alone owns the clock — the two machines never
    // have to agree on what time it is, only on how long the trip took.
    if (m.t === 'ping') return void (ws.readyState === 1 &&
      ws.send(JSON.stringify({ t: 'pong', at: m.at })));
    if (m.t === 'scoop') {                        // an order: go get that, however far it is
      const target = (pods.get(P.mapId) ?? []).find(c => c.id === +m.id);
      if (target && !mayScoop(target, id))
        return tell('that pod is another pilot\'s share of the kill');
      P.want = target ? +m.id : null;
      if (process.env.DEBUG_SCOOP) console.log(`scoop order id=${m.id} accepted=${P.want !== null}`);
      return;
    }
    // Renting a bay. Rank and money both, and neither is refundable — see berth.js
    // for why standing is the gate rather than only the fee.
    // Breaking something up. The counter that buys is the counter that sells, so
    // this is allowed exactly where a purchase is — your own ring, or a bay you
    // rent — and never in open space.
    if (m.t === 'scrap') {
      const where = canDock(MAPS[P.mapId], P.co, ship) ? 'dock' : atBerth() ? 'berth' : null;
      const why = whyNotScrap(m.item, { held: P.gear[m.item] ?? 0, where });
      if (why) return tell(why);
      const paid = scrapOfItem(m.item);
      if (--P.gear[m.item] <= 0) delete P.gear[m.item];
      P.credits += paid;
      receipt(EQUIPMENT[m.item].name, -paid, `broken up for ${Math.round(SCRAP_RATE * 100)}%`);
      touch(P);
      return outfit();
    }
    if (m.t === 'scraphull') {
      const where = canDock(MAPS[P.mapId], P.co, ship) ? 'dock' : atBerth() ? 'berth' : null;
      const why = whyNotScrapHull(m.key, { owned: P.hulls, flying: ship.hull, where });
      if (why) return tell(why);
      const paid = scrapOfHull(m.key);
      P.hulls = P.hulls.filter(h => h !== m.key);
      P.credits += paid;
      receipt(HULLS[m.key].name, -paid, `broken up for ${Math.round(SCRAP_RATE * 100)}%`);
      touch(P);
      return outfit();
    }
    // Staking a plot. The yard is rebuilt from the accounts, so buying one is a
    // matter of writing it on your own and telling the world to look again.
    if (m.t === 'stake') {
      const mid = P.co + '1', base = MAPS[mid]?.base;
      const taken = Object.values(db.accounts)
        .filter(a2 => a2.lab && a2.lab.slot !== null && (a2.co ?? 'm') + '1' === mid)
        .map(a2 => a2.lab.slot);
      const slot = P.lab ? null : claimPlot(token, base, taken);
      const why = whyNotStake({ credits: P.credits, docked: !!P.docked, has: !!P.lab,
                                room: slot !== null, plots: plotsFor(base).length });
      if (why) return tell(why);
      P.credits -= LAB_PRICE;
      P.lab = { slot, mods: 0, since: Date.now() };
      touch(P); reyard();
      receipt('Research Station', LAB_PRICE, 'your plot in the yard');
      return outfit();
    }
    if (m.t === 'build') {
      const mod = MODULES[m.key];
      if (!mod || !P.lab) return tell('no station — stake a plot in your own ring first');
      const at = plotAt(MAPS[P.co + '1']?.base, P.lab.slot);
      const why = whyNotBuild(m.key, { credits: P.credits, mask: P.lab.mods,
                                       near: P.mapId === P.co + '1' && nearLab(at, ship) });
      if (why) return tell(why);
      P.credits -= mod.price;
      // Bank what the OLD rate earned before the new one starts, or an upgrade
      // quietly pays the new rate for hours the old one actually worked.
      bankLab(P);
      P.lab = { ...P.lab, mods: addMod(P.lab.mods, m.key) };
      // Hull and shield multipliers ride on the ship, so it has to be told.
      ship.research = P.lab.mods;
      refit(ship, ship.hull, ship.fit, ship.drones, ship.formation, ship.rig);
      touch(P); reyard();
      receipt(mod.name, mod.price, mod.does);
      return outfit();
    }
    if (m.t === 'buyberth') {
      const why = whyNotBuyBerth({ xp: P.xp, credits: P.credits,
                                   owned: P.berths.includes(P.mapId),
                                   inside: inOutpost(MAPS[P.mapId], ship) });
      if (why) return tell(why);
      P.credits -= berthPrice();
      P.berths = [...P.berths, P.mapId];
      receipt('Berth · ' + MAPS[P.mapId].name, berthPrice(), 'you may refit and buy here now');
      touch(P);
      return outfit();
    }
    // Ore straight to credits, at the pirates' rate, without flying home. The
    // hold is what it empties — the company hangar is none of their business.
    if (m.t === 'fence') {
      if (!inOutpost(MAPS[P.mapId], ship)) return tell('no outpost in range — fly into the ring');
      const paid = pirateValue(P.hold);
      const units = Object.values(P.hold).reduce((t, n) => t + n, 0);
      if (!units) return tell('nothing in the hold to sell them');
      P.hold = {};
      P.credits += paid;
      receipt('Pirate outpost', -paid, `${units} of ore, at ${Math.round(PIRATE_RATE * 100)}% of value`);
      return outfit();
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
    // capture banks the playtime, and it banks up to the last action rather than
    // to now — which is the whole point when the tab has been idle for half an
    // hour before the socket finally goes.
    if (p && !p.lobby) { capture(p.acct, p, Date.now()); store.save(db); }   // last word on where you were
    for (const list of aliens.values()) forgetPlayer(list, id);
    players.delete(id);
    if (!lobby) console.log(`- ${acct.name} (${players.size} online)`);
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
    if (p.lobby) continue;                        // still choosing a name
    step(p.ship, dt);
    // A Shear Compensator nulls the first half of the drift margin and charges the
    // reactor for it, so how far out you can hold is how much tank you have left.
    // Nothing fitted and holdShear returns 0, which is the curve sim.js always had.
    stepDrift(p.ship, dt, holdShear(p.ship, dt));
    const map = MAPS[p.mapId];
    p.docked = canDock(map, p.co, p.ship);
    // The last hangar you actually stood in, which is where a wreck comes back.
    // Recorded from the same question the station panel asks, so you can never
    // respawn somewhere you could not have shopped.
    if (isHangar(p.mapId, map, p.co, p.ship, p.berths)) {
      if (p.lastDock !== p.mapId) { p.lastDock = p.mapId; touch(p); }
    }
    stepVitals(p.ship, dt, p.docked);
    // The mine, paid out once a second rather than once a tick — see bankLab.
    //
    // Date.now(), NOT the tick's `now`. The tick runs on performance.now(), which
    // counts from when the process started; `lab.since` is wall clock, because the
    // mine has to keep running while nobody is connected. Subtracting one from the
    // other gives a large negative, cappedSecs clamps it to zero, and the mine
    // silently pays nothing forever — which is exactly what it did, and only a live
    // socket caught it. CLAUDE.md says two clocks matter; this is the third time.
    const wall = Date.now();
    if (p.lab && incomeOf(p.lab.mods) > 0 && wall - (p.paidAt ?? 0) >= 1000) {
      p.paidAt = wall;
      if (bankLab(p, wall)) touch(p);
    }
    // Composite Plating is re-seated whenever you are standing at a dock, which is
    // what makes the save once per OUTING rather than once per life: a pilot who
    // never goes home never gets a second one.
    if (p.docked) p.plate = true;

    // An Ore Foundry mends hull out of the hold while you fly. It is the only
    // thing in the game that puts hull back in the field without a kit, and it
    // charges for it in the one currency a pilot out here already has.
    const forged = foundryBurn(p.ship, p.hold, dt);
    if (forged) {
      touch(p);
      // Said out loud for the same reason the refinery says its batches: a hold
      // quietly emptying itself is indistinguishable from a bug.
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', from: '',
        text: `foundry burned ${forged.units} ${MATERIALS[forged.mat]?.name ?? forged.mat} ` +
              `into ${Math.round(forged.healed)} of hull` }));
    }

    // A repair drone works while nothing is shooting at you. Take a hit and it
    // stops, and the kit is gone — standing still for five seconds in open
    // space is the whole cost of not flying home.
    // Folding home. Any hit at all ends it — sinceHit only ever counts UP unless
    // something lands, so a drop in it is a hit and needs no separate signal.
    if (p.folding) {
      if (p.ship.sinceHit < p.folding.mark || p.ship.hp <= 0) {
        p.folding = null;
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify(
          { t: 'chat', from: '', text: 'recall broken off — the beacon is still yours' }));
      } else {
        p.folding.mark = p.ship.sinceHit;
        p.folding.left -= dt;
        if (p.folding.left <= 0) {
          const key = p.folding.key;
          p.folding = null;
          if (--p.devices[key] <= 0) delete p.devices[key];
          const b = foldTo(p, MAPS, p.foldTo), home = b.map;
          p.mapId = home; p.contacts.clear(); p.targetId = null; p.want = null; p.scoop = null;
          Object.assign(p.ship, { x: b.x, y: b.y, vx: 0, vy: 0, tx: null, ty: null,
                                  dx: null, dy: null, charge: 0, chargeTo: null });
          touch(p);
          // The beacon is spent here, so the bar has to be told — touch() saves it
          // but says nothing, and the box went on reading the old count.
          if (p.ws.readyState === 1) {
            sendMap(p);
            p.ws.send(JSON.stringify({ t: 'fit', hull: p.ship.hull, fit: p.ship.fit,
              drones: p.ship.drones, rig: p.ship.rig ?? null, formation: p.ship.formation,
              formations: p.formations, ammo: p.ammo, using: p.using, armed: p.armed,
              kits: p.kits, kit: p.kit, devices: p.devices, device: p.device,
              foldTo: p.foldTo, berths: p.berths,
              gear: p.gear, hulls: p.hulls, credits: p.credits }));
          }
        }
      }
    }
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

    // Composite Plating takes the killing blow instead of you, once, and is gone
    // until you next stand at a dock. It has to be tested BEFORE the wreck below,
    // because everything down there is irreversible — the hold is on the floor and
    // the toll is off your balance by the time anyone could ask.
    if (p.ship.hp <= 0 && platingArmed(p.ship, p.plate)) {
      p.plate = false;
      p.ship.hp = platingBack(p.ship);
      p.ship.sinceHit = 0;                        // it took the hit; the shields stay down
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', from: '',
        text: `the plating took it — ${Math.round(PLATE_BACK * 100)}% of your hull left, and no more plating until you dock` }));
      touch(p);
    }

    if (p.ship.hp <= 0) {                         // destroyed: the hold goes with it
      boom(p.mapId, p.ship, false, id);
      const lost = { ...p.hold };
      for (const [m, n] of Object.entries(p.hold)) drop(p.mapId, p.ship.x, p.ship.y, m, n);
      p.hold = {};
      // The cargo was the only stake, so flying empty made a wreck a free ride
      // home. A tenth of the credits goes down with the ship.
      const toll = tollOn(p.credits);
      p.credits -= toll;
      p.dead = true;
      p.targetId = null; p.want = null; p.scoop = null; p.contacts.clear();
      dropRocketsAt(p.mapId, p.ship);
      for (const list of aliens.values()) forgetPlayer(list, id);   // death settles every grudge
      Object.assign(p.ship, { vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, charge: 0, chargeTo: null });
      touch(p);                                   // a lost hold must survive a hard kill
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'dead', lost, toll, where: p.mapId }));
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
    sendMap(p);
  }

  // --- hostiles -------------------------------------------------------------
  for (const [mapId, list] of aliens) {
    const map = MAPS[mapId];
    const here = [];
    const born = [];                              // escorts launched this tick
    for (const [id, p] of players)
      // `loud` is what this pilot is doing to be noticed. It is 1 for everybody
      // except a ship running an Aspect Filter, which is an active illuminator and
      // is heard from further off than it can see — the price of seeing a Bandit
      // from the front, paid in every hostile opening on you sooner.
      if (p.mapId === mapId && !p.dead)
        here.push({ id, ship: p.ship, haven: inHaven(map, p.ship), loud: loudOf(p.ship) });
    // How stripped this sector is, per kind. Measured per kind rather than across
    // the whole sector because the sector-wide answer is useless: m3 holds four
    // Drifters beside its two Leviathans, so clearing both Leviathans reads as
    // four of six standing and the timer barely moves.
    //
    // A boss is deliberately not in this. Its respawn is not a population rate, it
    // is a statement about how often the event should happen — the Corsair Hive's
    // five minutes says "it should be an event" in as many words — and a party
    // that beats it should not thereby be allowed to beat it three times an hour.
    const alive = new Map(), total = new Map();
    for (const a of list) {
      if (a.spawned || a.def.broods) continue;
      total.set(a.kind, (total.get(a.kind) ?? 0) + 1);
      if (a.dead <= 0 && !a.gone) alive.set(a.kind, (alive.get(a.kind) ?? 0) + 1);
    }
    // The COUNTDOWN is scaled, not the delay stamped at death, and that is the
    // whole point: pressure comes off mid-countdown as the sector refills, so a
    // pilot who leaves does not leave a queue of instant respawns behind them.
    // Under constant conditions the total still comes to exactly respawnDelay(),
    // which is what keeps MIN_RESPAWN honest.
    //
    // Read as posted/actual rather than by calling refillRate(): that normalises
    // to a base of 100 and would let a Drifter through the 3s floor at 0.4s.
    const refill = a => (a.spawned || a.def.broods) ? 1
      : a.def.respawn / respawnDelay(a.def.respawn, {
          pilots: here.length,
          alive: alive.get(a.kind) ?? 0,
          total: total.get(a.kind) ?? 1,
        });
    for (const a of list) {
      if (a.dead > 0) { a.dead -= dt * refill(a);
        // An escort is not a fixture of the sector: when one dies it is gone, and
        // the hive makes another. Everything else comes back somewhere nobody is
        // looking, rather than on top of whoever killed it.
        if (a.dead <= 0) { if (a.spawned) a.gone = true; else respawnAlien(a, map, here.map(c => c.ship)); }
        continue; }
      const tgt = stepAlienAI(a, map, here, dt);

      // A mothership launches escorts, but only once it has noticed somebody — a
      // hive nobody has found should not quietly fill its sector with raiders.
      if (a.def.broods && a.target !== null) {
        a.brood = (a.brood ?? []).filter(kid => list.some(x => x.id === kid && !x.gone && x.dead <= 0));
        if (a.brood.length < a.def.broods.max && broodReady(a, dt)) {
          const ang = Math.random() * Math.PI * 2;
          const kid = newAlien(a.def.broods.kind, alienId++, map, alienId,
                               { x: a.x + Math.cos(ang) * BROOD_R, y: a.y + Math.sin(ang) * BROOD_R });
          kid.spawned = true;                     // launched, not posted: it fights and it stays dead
          kid.post = null;
          kid.target = a.target;
          kid.provoked.add(a.target);
          born.push(kid);
          if (process.env.DEBUG_BROOD)
            console.log(`brood: hive ${a.id} launched ${kid.id}, now ${a.brood.length + 1}/${a.def.broods.max}`);
          a.brood.push(kid.id);
        }
      }
      // Anything in the air with this one's name on it. Rockets first: they are
      // the shots that will not simply go past on their own.
      const incoming = [
        ...(rockets.get(mapId) ?? []).filter(r => r.target === a),
        ...(bolts.get(mapId) ?? []).filter(b => b.target === a)
          .map(b => ({ x: b.sx + (b.ax - b.sx) * (1 - b.t / b.ttl),
                       y: b.sy + (b.ay - b.sy) * (1 - b.t / b.ttl),
                       vx: (b.ax - b.sx) / b.ttl, vy: (b.ay - b.sy) / b.ttl })),
      ];
      const breaking = stepEvade(a, incoming, map, dt);
      step(a, dt); stepDrift(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      // Breaking means turning, and turning is what takes its nose off you. The
      // camouflage and the evasion are the same mechanic from two sides.
      if (breaking && Math.hypot(a.vx, a.vy) > 20) a.heading = jinkHeading(a, victim?.ship);
      else faceTarget(a, victim?.ship);
      // A mirror loads what it was hit with and gives it back on its next shot. The
      // payload IS its damage stat while it is loaded, so fire() needs no idea this
      // exists — and it is spent on firing rather than on time, so breaking off does
      // not empty the chamber, it only stops you filling it.
      stepMirror(a, dt);
      // A Lamprey has no gun at all — the tether is instead of firing, not as well
      // as it, and fire() produces nothing for one anyway because its weaponRange is
      // 0. Sanctuary is gated on the SAME `haven` the AI was just handed rather than
      // on a second lookup: one predicate, one answer. Two copies of "where is it
      // safe to stand" is exactly how the workshop dock ended up refusing to sell
      // anything for a day.
      const grip = victim ? tetherHolds(a, victim.ship, victim.haven) : false;
      const bite = stepSiphon(a, victim?.ship ?? null, grip, dt);
      if (bite) {
        const got = drainHull(victim.ship, bite.take);
        a.hp = Math.min(a.stats.hull, a.hp + bite.mend);
        // Hull leaving with no number over it is indistinguishable from a bug, and
        // one number a frame is thirty a second. Accumulated and flushed twice a
        // second, marked as hull rather than shield because that is what it is —
        // a tether never touches a shield.
        a.bit = (a.bit ?? 0) + got.hull;
        a.bitT = (a.bitT ?? 0) + dt;
        if (a.bitT >= DRAIN_TELL && a.bit >= 1) {
          hits.get(mapId).push({ x: victim.ship.x, y: victim.ship.y - victim.ship.r - 6,
                                 n: a.bit, sh: false, by: null, t: HIT_TIME, ttl: HIT_TIME });
          a.bit = 0; a.bitT = 0;
        }
      }
      const spat = fire(a, victim?.ship ?? null, dt);
      for (const shot of spat) bolts.get(mapId).push(shot);
      if (spat.length) spendMirror(a);
      for (const rk of launch(a, victim?.ship ?? null, dt)) rockets.get(mapId).push(rk);
      // The ring. It winds up while it has somebody and settles when it does not, and
      // it burns whoever is standing in it — everyone, not just its target, because a
      // field does not aim. Sanctuary is checked with mayHarm(), the same predicate
      // stepAlienAI targets with, so a Censer drifting past your own dock cannot
      // quietly cook somebody parked in the ring.
      if (burnOf(a.def)) {
        const scorched = here.filter(c => c.ship.hp > 0 && mayHarm(a, c) && inBurn(a, c.ship));
        stepBurn(a, a.target !== null, scorched.length > 0, dt);
        for (const c of scorched) {
          const bite = burnBite(a.def, a.spin, poolOf(c.ship), dt);
          const split = applyDamage(c.ship, bite);
          // One floating number a second rather than thirty. A field that printed a
          // number every tick buried the screen and said nothing you could read.
          a.sear = (a.sear ?? 0) + bite;
          // A ship the field kills is settled by the wreck block at the top of the
          // next tick, exactly the way a ship a bolt kills is. Nothing here has to
          // know what dying costs.
          if ((a.searT = (a.searT ?? 0) + dt) >= 1) {
            hits.get(mapId).push({ x: c.ship.x, y: c.ship.y - c.ship.r - 6, n: a.sear,
                                   sh: split.hull === 0, by: null, t: HIT_TIME, ttl: HIT_TIME });
            a.sear = 0; a.searT = 0;
          }
        }
      }
      // Not while it is chasing somebody: a provoked alien follows you in.
      if (a.target === null) shoveFromBase(a, map);
      if (a.hp <= 0) killAlien(mapId, a);
    }
    // Escorts launched this tick join the sector, and anything the hive lost
    // leaves it — an escort is not a fixture the way a seeded hostile is.
    if (born.length) list.push(...born);
    if (list.some(a => a.gone)) aliens.set(mapId, list.filter(a => !a.gone));
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
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if ((c.t -= dt) <= 0) { list.splice(i, 1); continue; }
      // A share stops being reserved long before the pod disperses, so ore nobody
      // came back for goes to whoever is still out there instead of sitting on the
      // field visible and untouchable until it evaporates.
      if (c.own && claimLapsed(c)) c.own = 0;
    }

  for (const [, p] of players) {                  // outstanding fetch orders
    if (p.want === null || p.scoop) continue;
    const pod = (pods.get(p.mapId) ?? []).find(c => c.id === p.want);
    const step2 = approachPod(p.ship, p.hold, pod);
    if (step2.fly) { p.ship.tx = step2.fly.x; p.ship.ty = step2.fly.y; p.ship.dx = p.ship.dy = null; }
    else if (step2.scoop) { p.scoop = step2.scoop; p.want = null; p.ship.tx = p.ship.ty = null; }
    else {
      // Flying all the way there and then stopping without a word is the worst
      // of the three outcomes. Say which one it was.
      if (step2.why === 'full' && p.ws.readyState === 1)
        p.ws.send(JSON.stringify({ t: 'chat', from: '', text: 'hold is full — dock and stow it' }));
      p.want = null;
    }
  }

  // Collector rigs pull anything in reach without being asked. Your own order
  // still wins — a rig is not allowed to hijack a beam you started.
  for (const [pid, p] of players) {
    if (p.dead || p.scoop || p.want !== null) continue;
    const reach = collectorReach(p.ship.rig);
    if (!reach) continue;
    // Nearest first, but keep going down the list — it fills to the brim rather
    // than stopping at the closest pod. Metals differ in volume, so three units
    // of room takes an iridium and refuses an iron sitting right beside it, and
    // giving up on the first refusal left cargo on the ground with space to spare.
    const near = (pods.get(p.mapId) ?? [])
      .map(c => ({ c, d: Math.hypot(c.x - p.ship.x, c.y - p.ship.y) }))
      .filter(o => o.d <= reach && mayScoop(o.c, pid))   // never someone else's share
      .sort((a, b) => a.d - b.d);
    for (const { c } of near) {
      const s2 = beginScoop(p.ship, p.hold, c, reach, droneSpeed(p.ship));
      if (typeof s2 === 'object') { p.scoop = s2; break; }   // anything else: try the next one
    }
  }

  // A rig with a refinery aboard packs the hold down while you fly: the cheapest
  // metal you carry, compressed into the next one up. Value is conserved and
  // VOLUME is not, so the rig then fills the room it just made and does it again —
  // which is what turns a hold that fills in ninety seconds into one that climbs
  // for as long as you stay out, and what makes flying home to bank it a decision.
  for (const [, p] of players) {
    if (p.dead) continue;
    const every = refinePeriod(p.ship.rig);
    if (!every) { p.refineIn = null; continue; }
    p.refineIn = (p.refineIn ?? every) - dt;
    if (p.refineIn > 0) continue;
    p.refineIn = every;
    const step = refineStep(p.hold, p.ship.rig);
    if (!step) continue;
    applyRefine(p.hold, step);
    touch(p);
    // Said out loud, because a hold quietly rearranging itself is indistinguishable
    // from a bug — and this is the mechanic that puts something at stake.
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', from: '',
      text: `refined ${step.spent} ${MATERIALS[step.from]?.name ?? step.from} into ` +
            `${step.made} ${MATERIALS[step.to]?.name ?? step.to} — ${step.freed} of hold freed` }));
  }

  for (const [, p] of players) {                  // tractor beams
    if (!p.scoop) continue;
    const list = pods.get(p.mapId) ?? [];
    const pod = list.find(c => c.id === p.scoop.id);
    const r = stepScoop(p.scoop, pod, p.ship, p.hold, dt);
    // The pod goes the moment the lift lands, which is now before the drone is
    // home — so this cannot wait on the pull being finished the way it used to.
    if (r.emptied && pod) list.splice(list.indexOf(pod), 1);
    if (r.took) touch(p);
    if (!r.running) p.scoop = null;
  }

  for (const [mapId, list] of rockets) {
    for (const h of stepRockets(list, dt)) {      // same bookkeeping, different flight
      hits.get(mapId).push({ x: h.target.x, y: h.target.y - h.target.r - 6,
                             n: h.split.shield + h.split.hull, sh: h.split.hull === 0,
                             by: h.rocket.owner ?? null, t: HIT_TIME, ttl: HIT_TIME });
      tally(h.target, h.rocket.owner ?? null, h.split.shield + h.split.hull);
      storeHit(h.target, h.split.shield + h.split.hull);
      goadBurn(h.target, h.split.shield + h.split.hull, alienEhp(h.target));
      if (h.dead && h.target.isAlien) killAlien(mapId, h.target, h.rocket.owner ?? null);
    }
  }
  for (const [mapId, list] of bolts) {
    for (const h of stepBolts(list, dt)) {        // the bolt remembers who fired it
      hits.get(mapId).push({ x: h.target.x, y: h.target.y - h.target.r - 6,
                             n: h.split.shield + h.split.hull, sh: h.split.hull === 0,
                             by: h.bolt.owner ?? null, t: HIT_TIME, ttl: HIT_TIME });
      tally(h.target, h.bolt.owner ?? null, h.split.shield + h.split.hull);
      storeHit(h.target, h.split.shield + h.split.hull);
      goadBurn(h.target, h.split.shield + h.split.hull, alienEhp(h.target));
      if (h.dead && h.target.isAlien) killAlien(mapId, h.target, h.bolt.owner ?? null);
    }
    for (const a of aliens.get(mapId) ?? []) if (a.hp <= 0) killAlien(mapId, a);
  }
  // And the fuse. `dmg` on the pyre is a FRACTION of whoever is standing in it when
  // it goes, not a number of points — the same rule the field itself uses, so a
  // pilot at x32 and a pilot at x1 lose the same share of their ship.
  for (const [mapId, list] of pyres) {
    for (let i = list.length - 1; i >= 0; i--) {
      const py = list[i];
      if ((py.t -= dt) > 0) continue;
      list.splice(i, 1);
      boom(mapId, { x: py.x, y: py.y, r: py.r }, true, null);
      for (const [id, p] of players) {
        if (p.mapId !== mapId || p.dead || p.lobby || p.ship.hp <= 0) continue;
        if (inHaven(MAPS[mapId], p.ship) || !inPyre(py, p.ship)) continue;
        const took = py.dmg * poolOf(p.ship);
        const split = applyDamage(p.ship, took);
        hits.get(mapId).push({ x: p.ship.x, y: p.ship.y - p.ship.r - 6, n: took,
                               sh: split.hull === 0, by: null, t: HIT_TIME, ttl: HIT_TIME });
      }
    }
  }
  for (const [, list] of blasts)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);
  for (const [, list] of hits)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);

  // Where a player's collector drone is this tick, in absolute coordinates, so any
  // client that can see the ship can draw the lift — the pod itself may be out of
  // the watcher's radar range and the drone still has to be somewhere.
  const rigRow = p => {
    const tier = EQUIPMENT[p.ship.rig]?.tier ?? 0;
    if (!tier) return { rig: 0, rgx: 0, rgy: 0, rgp: -1, rgf: -1 };
    const at = rigAt(p.scoop, p.ship);
    if (!at) return { rig: tier, rgx: 0, rgy: 0, rgp: -1, rgf: -1 };
    return { rig: tier, rgx: Math.round(at.x), rgy: Math.round(at.y),
             rgp: Math.round(100 * at.work),
             rgf: at.phase === 'out' ? 0 : at.phase === 'work' ? 1 : 2 };
  };

  // Snapshots are per player, not per map. Radar means two ships sitting in the
  // same sector legitimately see different things, and an enemy you have not
  // detected must never reach the wire at all.
  const row = new Map(), byMap = new Map();
  for (const [id, p] of players) {
    row.set(id, { id, x: Math.round(p.ship.x), y: Math.round(p.ship.y),
      heading: +p.ship.heading.toFixed(2), charge: +p.ship.charge.toFixed(2),
      co: p.co, hull: p.ship.hull,
      // `?? ''` because this row is built before the lobby players are skipped a
      // few lines down, and acct.name does not exist until someone has joined.
      // The row never reaches anyone, but undefined in a tuple JSONs to null.
      name: p.acct?.name ?? '',
      hp: Math.round(100 * p.ship.hp / p.ship.stats.hull),
      sh: Math.round(100 * p.ship.shield / Math.max(1, shieldMax(p.ship))),
      flash: Math.round(100 * p.ship.shieldHit / SHIELD_FLASH),
      tgt: p.targetId ?? 0, shot: Math.round(100 * p.ship.shotFlash / SHOT_FLASH),
      fix: p.fixing ? Math.round(100 * (1 - p.fixing.left / p.fixing.secs)) : 0,
      wrp: p.folding ? Math.round(100 * (1 - p.folding.left / p.folding.secs)) : 0,
      abl: Math.round(100 * levelOf(p.ship.power, SPECIAL, p.ship.stats)),
      rk: Math.round(100 * (p.ship.rocketFlash ?? 0) / LAUNCH_FLASH),
      guns: p.ship.guns ?? 1, lvl: levelFor(p.xp).level, drones: p.ship.drones.length,
      form: Math.max(0, FORMATION_KEYS.indexOf(p.ship.formation)),
      dmask: p.ship.drones.reduce((m2, k, i) => m2 | (EQUIPMENT[k]?.slot === 'weapon' ? 1 << i : 0), 0),
      psys: p.ship.power.to ? SYSTEMS.indexOf(p.ship.power.to) + 1 : 0,
      plvl: p.ship.power.to ? Math.round(100 * levelOf(p.ship.power, p.ship.power.to, p.ship.stats)) : 0,
      // The collector, for everyone rather than just its owner. rgp is -1 when the
      // drone is flying with the escort and 0..100 while it is holding station over
      // a pod, which is the only part anybody else could previously not see.
      ...rigRow(p) });
    if (p.dead || p.lobby) continue;
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
      guns: 1, psys: 0, plvl: 0, lvl: 0, drones: 0, form: 0, dmask: 0, rk: 0, fix: 0,
      // `abl` is free on a hostile row: every alien has always sent 0 and the client
      // only reads abl through HULLS[s.hull]?.ability, which is undefined for
      // anything flying co 'x'. A Lamprey's tether draw rides it, so the tether
      // needed no new SHIP_FIELDS entry — the row is at 30 of a hard 31 — and `tgt`,
      // on the wire since the beginning, is already the victim's id.
      rig: 0, rgx: 0, rgy: 0, rgp: -1, rgf: -1, wrp: 0,
      // Whichever dial this hostile has. A Lamprey rides its tether draw here and a
      // Censer its ring spin; both are 0..1 and both have to be visible, because a
      // ring you cannot see widening and a cord you cannot see tighten are both
      // indistinguishable from a bug. Everything else sends 0, as it always has.
      abl: Math.round(100 * (a.draw ?? a.spin ?? 0)), name: '' });
    if (!byMap.has(mapId)) byMap.set(mapId, []);
    byMap.get(mapId).push({ id: a.id, co: 'x', ship: a });   // 'x' == hostile to every company
  }
  for (const [vid, V] of players) {
    if (V.ws.readyState !== 1 || V.lobby) continue;
    V.id = vid;
    const seen = stepContacts(V, byMap.get(V.mapId) ?? [], dt);
    const ships = new Map();
    for (const [tid, vis] of seen) ships.set(tid, packShip({ ...row.get(tid), vis }));
    // The gallery. Static, unshootable, and only rendered for whoever is actually
    // in the workshop — they are scenery, not simulation.
    if (V.mapId === DEV_ID) for (const row2 of PROP_ROWS) ships.set(row2.id, packShip(row2));
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
    // A pyre is drawn from outside its own radius, so it reaches further than a
    // bolt does: you have to be able to see the thing you are running out of.
    const alight = (pyres.get(V.mapId) ?? []).filter(py =>
      Math.hypot(py.x - V.ship.x, py.y - V.ship.y) <= reach + py.r);
    const extra = { bolts: shown.map(packBolt), rockets: missiles.map(packRocket),
                    blasts: flashes.map(packBlast), pyres: alight.map(packPyre),
                    hits: numbers.map(h => packHit(h, h.by === vid)) };
    // Every station in this sector, and which one is theirs. Not radar-filtered:
    // the radar rule keeps an enemy you have not DETECTED off the wire, and a lab
    // is furniture in a haven — one popping into being at 2200px would read as a
    // bug rather than as stealth.
    const yardHere = labs.get(V.mapId) ?? [];
    const streams = { ships, pods: new Map(cans.map(c => [c.id, packPod(c)])),
                      labs: new Map(yardHere.map(l => [l.id, packLab(l, l.token === V.token)])) };
    const bag = { hold: V.hold, cap: V.ship.stats.cargo,
      credits: V.credits, docked: !!V.docked, vault: V.vault, gear: V.gear,
      // What the station earns per second, and what it has built. `income` moves
      // only when a module is bought, so it costs nothing per tick — and it is
      // what lets the client run the counter up smoothly between banks without
      // inventing money it has not been told about.
      lab: V.lab ? { mods: V.lab.mods, income: incomeOf(V.lab.mods) } : null,
      ammo: V.ammo, using: V.using, armed: V.armed, kits: V.kits, kit: V.kit,
      xp: V.xp, rank: levelFor(V.xp), drones: V.ship.drones,
      played: (V.acct.played ?? 0) + sessionSeconds(V.banked ?? V.acted, V.acted),
      // Who else is out there. A world with nobody in it should say so rather
      // than leave you wondering whether the game is empty or just quiet.
      online: [...players.values()].filter(q => !q.lobby).length,
      // effective levels as whole percent, so the readout cannot jitter between
      // 29 and 30 from a float that is a hair under one
      power: { to: V.ship.power.to, cap: Math.round(100 * chargePct(V.ship.power, V.ship.stats)),
               lv: Object.fromEntries(SYSTEMS.map(sy =>
                 [sy, Math.round(100 * levelOf(V.ship.power, sy, V.ship.stats))])) },
      shieldNow: Math.round(V.ship.shield), shieldMax: Math.round(shieldMax(V.ship)),
      // Whether the plating is still there to catch a death. Nobody else can see
      // it, so it rides in the viewer's own bag rather than on the ship row —
      // and it has to be visible at all, or you find out you already spent it by
      // dying.
      plate: V.plate ? 1 : 0,
      scoop: V.scoop ? { id: V.scoop.id, p: +(1 - V.scoop.t / (V.scoop.secs ?? SCOOP_TIME)).toFixed(2) } : undefined,
      want: V.want ?? undefined };
    // A keyframe when this connection has no baseline, or has one built for a
    // sector it has since left. sendMap already drops the baseline at all six
    // places a pilot changes sector, so the map check here is the net underneath
    // that: a seventh place added later gets a keyframe rather than a client
    // quietly interpolating against ships in a sector it is no longer in.
    // Everything else is a delta against what this connection was last told.
    const msg = needsFull(V.base, V.mapId)
      ? encodeFull(V.base, V.mapId, streams, bag, extra)
      : encodeDelta(V.base, streams, bag, extra);
    V.ws.send(JSON.stringify(msg));
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`${GAME} — http://localhost:${PORT}`));
