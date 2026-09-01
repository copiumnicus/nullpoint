import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { newShip, refit, step, stepVitals, stepDrift, applyDamage, drainHull, stepJump, beginJump, arrivalFor, inBase, canDock, inHaven, inOutpost, shieldMax, shieldWait, WORLD, boundsOf, SHIELD_FLASH, SHOT_FLASH } from './shared/sim.js';
import { fire, stepBolts, faceTarget } from './shared/combat.js';
import { launch, stepRockets, launcherRoom, LAUNCH_FLASH } from './shared/rockets.js';
import { newAlien, respawnAlien, stepAlienAI, stepAlienRepair, stepEvade, jinkHeading,
         broodReady, BROOD_R, shoveFromBase,
         forgetPlayer, ALIENS, ALIENS_PER_MAP, WILD, mayHarm, effectiveHp, dialOf, roamPoint } from './shared/aliens.js';
import { DEV_ID, PROPS, PEN_SLOTS, BENCH_SLOTS, propFit } from './shared/devmap.js';
import { respawnDelay } from './shared/spawn.js';
import { sanitiseKills } from './shared/threats.js';
import { LAB_PRICE, MODULES, claimPlot, plotAt, plotsFor, incomeOf, earnedOver,
         cappedSecs, addMod, whyNotStake, whyNotBuild, nearLab, applyResearch,
         hasPocket, POCKET_EVERY } from './shared/research.js';
import { AMMO, FEEDS, magazine, sanitiseUsing, sanitiseArmed, whyNotBuy,
         whyNotLoad, loadable, buyCrates } from './shared/ammo.js';
import { isTrack, typeOf, servable } from './shared/music.js';
import { nameProblem, cleanName } from './shared/signup.js';
import { MUSIC_DIRS, pickDir } from './config.js';
import { KITS, kitPrice, sanitiseKit, whyNotRepair, KIT_QUIET } from './shared/repair.js';
import { DEVICES, devicePrice, sanitiseDevice, whyNotDevice } from './shared/devices.js';
import { HULLS, sanitiseFit, slotsOf, baysOf, berthed, resolve, hullPrice, DEFAULT_HULL } from './shared/ships.js';
import { QUESTS, bonusBays, newlyEarned, needFor } from './shared/quests.js';
import { EQUIPMENT, SLOTS, priceOf, reseat, emptyFit,
         MAX_DRONES, dronePrice, sanitiseDrones, sanitiseRig, isCollector, topTier, collectorReach,
         whyNotSold, frontierOnly } from './shared/gear.js';
import { levelFor } from './shared/level.js';
import { COMMANDS, parse, amount, MAX_LEN } from './shared/chat.js';
import { routeTo, levelOf, chargePct, SYSTEMS } from './shared/power.js';
import { SPECIAL, ABILITIES } from './shared/ability.js';
import { FORMATIONS, FORMATION_KEYS, formationPrice, DEFAULT_FORMATION } from './shared/formation.js';
import { stepContacts, ALLY } from './shared/radar.js';
import { packShip, packBolt, packRocket, packBlast, packPod, packHit, packLab, packPyre, packFix,
         packSown, groundK } from './shared/net.js';
import { stepFix, fixHolds, fixWinding, collapseTo, fixOf, haulCost } from './shared/kedge.js';
import { storeHit, stepMirror } from './shared/aliens.js';
import { stepSiphon, tetherHolds, DRAIN_TELL } from './shared/siphon.js';
import { burnOf, burnR, stepBurn, goadBurn, burnBite, pyreFor, inPyre, poolOf, inBurn } from './shared/burn.js';
import { sowOf, stepSow, sowHolds, groundFor, inGround, groundBite, stepGround,
         stepSnare, holdEngines, BITE_TELL } from './shared/ground.js';
import { newBase, needsFull, encodeFull, encodeDelta } from './shared/delta.js';
import { newAccount, sanitiseAccount, capture, carried } from './shared/account.js';
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
import { sanitiseView, viewsOf, mergeSizes, sayView } from './shared/viewport.js';
import * as store from './store.js';
import crypto from 'node:crypto';
import { MATERIALS, rollDrop, stow, unload, load, holdVol, beginScoop, stepScoop, approachPod,
         POD_LIFE, SCOOP_R, SCOOP_TIME, droneSpeed, rigAt, DWELL, mayScoop,
         pirateValue, PIRATE_RATE, pocketValue, claimLapsed, CLAIM_TIME,
         tollOn, DEATH_TOLL, BOND } from './shared/cargo.js';
import { MAPS, HOMES, GALAXY, COMPANIES, MAP_W, MAP_H, JUMP_CD,
         mapOf, arenaId, isArena } from './shared/maps.js';
import { ARENAS, countOf, postsFor, arrivalAt,
         whyNotClaim, whyNotReplay, LINGER, LIMIT } from './shared/arena.js';
import { FOLD_SECS, FOLD_PORT, FOLD_CLAIM, FOLD_DUEL, newFold, foldBroken,
         brokenText } from './shared/fold.js';
import { DUEL_KEY, startsAt, HOME_TO, COUNT as DUEL_COUNT,
         LIMIT as DUEL_LIMIT, LINGER as DUEL_LINGER, CHALLENGE_TTL, CHALLENGE_CD,
         whyNotChallenge, stakeOf, challengeText, mayAim, isDuelMap } from './shared/duel.js';

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

// The countdown to the shields coming back, as the wire carries it: tenths of a
// second, or undefined when there is nothing to wait for. The rule itself is
// shieldWait() in shared/sim.js — the same call the sim's own gate makes — so the
// number a pilot reads and the moment the shields actually move cannot disagree.
const waitField = V => {
  const w = shieldWait(V.ship, !!V.docked);
  return w === null ? undefined : Math.round(w * 10) / 10;
};

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
    list.push(newAlien(kind, alienId++, mapOf(mapId), mapId.charCodeAt(0) * 977 + i * 7919 + kind.length));
  aliens.set(mapId, list);
};

// Two hostiles that fly together, and the whole of what that takes.
//
// `def.mate` names the other kind and nothing more; the pairing itself is POSTS,
// which the game already has. A post pins an alien to a slot — it spawns there,
// returns there when idle, and respawns there — so two posts PAIR_GAP apart are two
// hostiles that arrive together, drift back together and reform together after one
// of them dies. There is no third way of saying "these two are together" and there
// did not need to be.
//
// PAIR_GAP is 260px. It is under the 540 aggro either of them has, so anything that
// wakes one is inside the other's notice too — which is what makes pulling one
// pulling both — and it is far enough that they read as two hulls rather than one
// blob at the radar ranges a pilot meets them at. Both are enormous (r 76 and 82),
// so at 260 they are plainly one object with two halves.
//
// `mate` on the live alien is the other's ID, which is what the target handover in
// the tick reads. It is deliberately NOT a reference: an alien that died and
// respawned is the same object, but holding an object here would outlive a sector
// rebuild and holding an index would not survive the `gone` sweep.
const PAIR_GAP = 260;
const pair = (mapId, a, b) => {
  const list = aliens.get(mapId) ?? [];
  const at = roamPoint(mapOf(mapId), a.rand, list.map(x => x.post).filter(Boolean));
  for (const [who, side] of [[a, -1], [b, 1]]) {
    who.post = { x: at.x + side * PAIR_GAP / 2, y: at.y };
    who.x = who.post.x; who.y = who.post.y;
    who.way = who.post;
  }
  a.mate = b.id; b.mate = a.id;
};
// The firing line, plus the bench west of the dock where the range furniture
// stands. The Bulkhead has aggro 0 and damage 0 — it is a thing you shoot AT to
// read a number off, so it belongs beside the dock rather than out with the
// animals, and taking it out of the grid is what let an eleventh hostile fit.
aliens.set(DEV_ID, [...PEN_SLOTS, ...BENCH_SLOTS].map(sl =>
  newAlien(sl.kind, sl.id, MAPS[DEV_ID], sl.id, { x: sl.x, y: sl.y })));
for (const h of HOMES) {
  seed(h, 'drifter', ALIENS_PER_MAP);
  const co = h[0];
  for (const mid of [co + '2', co + '3']) seed(mid, 'drifter', 4);
  seed(co + '2', 'ironhusk', 3);                  // one hop out: the first thing that outclasses your guns
  seed(co + '2', 'harrier', 2);
  seed(co + '3', 'censer', 3);                    // the other hop out: the same weight, the opposite question
  seed(co + '3', 'harrier', 5);
  seed(co + '3', 'ironhusk', 2);
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
// TWO of each, everywhere, and that is a rule rather than a number: nothing in the
// game is posted alone. A sector that holds one of something is a sector that goes
// empty the moment somebody kills it, and flying four hops to an empty map is the
// least interesting thing this game can ask of anybody. The second one is what makes
// the respawn a refill instead of a wait.
//
// Two Threshers on each gate — the first contested ground past your own frontier, and
// the first place three companies can arrive at once. It is the right thing to meet
// there: a mirror asks what your gun is rather than what your hull is, which is the
// question a pilot arriving from the frontier has never been asked.
//
// Nullpoint itself is still empty. Putting the only boss at the very bottom of the
// map put it where almost nobody would meet it, and the point of the thing is to
// be met.
for (const g of GALAXY.filter(id => MAPS[id].gate)) seed(g, 'thresher', 2);
// And four Kedges beside it. A gate held one Thresher and nothing else, which made
// it a corridor rather than a sector: the only thing standing there returns every
// point you deal it, so a pilot arriving from the frontier flies past rather than
// works. This is the frontier's own answer repeated one hop out — Harriers stand
// beside the Bandits for exactly this reason — and it does not move the ceiling:
// 65,000 under a Thresher's 205,550, so the mirror is still the thing you flee.
for (const g of GALAXY.filter(id => MAPS[id].gate)) seed(g, 'kedge', 4);


// And the Hive moved back one hop, onto the gates, beside the Thresher and the
// Kedges. It is not a demotion. A gate held a mirror you cannot farm and a surveyor
// you can — 205,550 against 65,000 — with nothing above them, so the sector's ceiling
// was a fight nobody has a reason to take twice. A mothership is the right ceiling
// for it, and putting it there is the move the frontier already made when Harriers
// were stood beside the Bandits: put something on the map that asks a different
// question from everything else on it.
//
// It also lands where a Hive is meant to be MET. Four hops out was the furthest map
// in the game, which is the emptiest possible place for the only boss with a five
// minute respawn; three hops is the first contested ground three companies reach, and
// a mothership is a thing you want other people to see.
for (const g of GALAXY.filter(id => MAPS[id].gate)) seed(g, 'hive', 2);

// The deeps. Two of each, per the rule above: nothing in this game is posted alone.
//
// They belong here rather than one hop in for the reason the sector exists at all —
// it is the only place past a gate, so it is the only place that can hold something a
// pilot has to get through a gate to meet. And because neither of them chases you:
// both are slower than every hull in the game, both fight by taking ground, and
// ground is only frightening on a map you have chosen to work rather than one you are
// passing through.
//
// Two Crucibles and two Doldrums on each, and the PAIRING is the fight. Either alone
// is answerable — you steer out of a pool, and a still on its own barely burns. Both
// at once is what the deeps are for: a Doldrum's Slack Water takes your steering for
// a second and a half, and a Crucible lays its ground where you were standing when the
// wind-up began. Neither of them has to know the other exists for that to happen —
// they both sow at their target's feet, so if they are both fighting YOU their ground
// lands in the same place by construction. See shared/ground.js.
//
// SEAM, and it is a design hole rather than a bug: measured, a party of four flying
// the counter clears the pair and is WIPED by all four at once, so the deeps are the
// first sector in the game that has to be pulled rather than brawled — and nothing in
// this game teaches pulling. There is no aggro tell, no leash indicator and no line in
// the threat file about it. Whoever adds one should start here, because this is the
// posting that made it matter.
//
// TWO PAIRS, not four wanderers. A Crucible and a Doldrum are posted together and
// come as one thing: pulling either is pulling both, which is what makes the combo
// the NORMAL case rather than the worst one. Neither of them knows what the other is
// DOING — they share a place and a target and nothing else, and the ground still
// lands in one spot only because both sow at their victim's feet. That property was
// the elegant part and it survives untouched.
//
// When one dies the survivor fights on. That is a design call and it is the reward
// for splitting them: a lone Crucible is ground you can walk out of and a lone
// Doldrum is 44 seconds of nuisance, so breaking the pair is what turns an encounter
// you cannot solo into two you can. The pair reforms when the dead one comes back to
// its post, five minutes later.
//
// Two pairs rather than one, per the rule above: a sector holding one of something
// goes empty the moment somebody kills it. Two pairs is also what makes pulling
// possible at all — and a party that engages both at once is wiped, measured, which
// is the pulling lesson nothing in this game teaches.
for (const d of GALAXY.filter(id => MAPS[id].deep)) {
  seed(d, 'crucible', 2); seed(d, 'doldrum', 2);
  const here = aliens.get(d);
  const cs = here.filter(a => a.kind === 'crucible'), ds = here.filter(a => a.kind === 'doldrum');
  for (let i = 0; i < Math.min(cs.length, ds.length); i++) pair(d, cs[i], ds[i]);
}

// --- claims -------------------------------------------------------------------
//
// An arena is a sector that exists while one pilot is standing in it. It is keyed
// by `arena:<token>:<tier>`, so two pilots freeing the same rock are in different
// sectors and neither can help or hinder the other.
//
// Everything the world already does per sector — hostiles, bolts, pods, pyres,
// snapshots, radar — works on an arena without knowing it is one, because all of
// it is keyed on a map id string and nothing else. The only two things that had
// to change are the ones that read the SECTOR rather than its id: `mapOf` instead
// of `MAPS[...]`, and the seven per-sector lists created together.
// A SEAT, NOT AN OWNER. `owner` was one token, because every arena had exactly one
// occupant; a duel has two, and the honest generalisation of "is the owner still
// standing in this sector" is "is ANY seat still standing in it". `seats` is the
// list of tokens allowed to be here, `back` is where each of them came from, and
// everything below — the sweep especially — reads those rather than a single name.
// A duel is an arena with a second seat; it is deliberately not a second registry.
const arenas = new Map();   // mapId -> { key, seats, back, opened, cleared, leaveIn, total, replay, duel? }
let arenaAlienId = 3_000_000;   // clear of ship ids, alien ids and lab ids alike

// Who from this arena's seats is actually standing in it right now.
const sittingIn = (aid, ar) =>
  [...players.values()].filter(q => ar.seats.includes(q.token) && q.mapId === aid);

function openArena(p, key, replay = false) {
  const id = arenaId(p.token, key);
  if (arenas.has(id)) return null;            // one at a time, per pilot
  openLists(id);
  // Its own counter. `row` in the snapshot builder is keyed by id across EVERY
  // sector at once, so two arenas handing out the same id would draw one pilot's
  // Censer at the other pilot's coordinates.
  let nid = arenaAlienId;
  aliens.set(id, postsFor(key).map(sl => {
    const a = newAlien(sl.kind, nid++, mapOf(id), nid * 7919, { x: sl.x, y: sl.y });
    // `spawned` is the hive-escort flag and it means exactly what is wanted here:
    // this one is not a fixture of the sector, so when it dies it is GONE rather
    // than counted down and put back. An arena whose field respawned would never
    // end, and "never ends" is the failure this feature has to not have.
    a.spawned = true; a.post = null;
    return a;
  }));
  arenaAlienId = nid;
  // Where they come out, decided NOW rather than when they leave. A berth can be
  // sold and a company can be changed mid-fight; the way home should not depend on
  // anything that can still move.
  const home = respawnAt(p, MAPS);
  arenas.set(id, { key, seats: [p.token], back: { [p.token]: home }, opened: Date.now(),
                   cleared: false, leaveIn: 0, total: countOf(key), replay });
  return id;
}

// The same sector, with two seats and nothing in it.
//
// It is the same function shape as openArena on purpose: the same id scheme, the
// same eight per-sector lists, the same registry, and therefore the same sweep. The
// only things that differ are the roster (there isn't one) and the countdown, which
// is a number on the record because the SERVER owns it — see the tick.
//
// The id is keyed on the challenger's token, so a pilot can hold one duel open at a
// time for exactly the reason they can hold one claim open at a time, and by the
// same line of code.
function openDuel(a, b) {
  const id = arenaId(a.token, DUEL_KEY);
  if (arenas.has(id)) return null;
  openLists(id);
  // An empty alien list rather than no entry at all. `closeArena` deletes it either
  // way, and every unguarded `aliens.get(mapId)` in the tick then has something to
  // find — the same reasoning SECTOR_LISTS is a named list for.
  aliens.set(id, []);
  arenas.set(id, { key: DUEL_KEY, duel: true,
                   seats: [a.token, b.token],
                   name: { [a.token]: a.acct.name, [b.token]: b.acct.name },
                   back: { [a.token]: respawnAt(a, MAPS), [b.token]: respawnAt(b, MAPS) },
                   opened: Date.now(),
                   // Five seconds where the server refuses every intent either of
                   // them can send. The client draws this number; it does not own it.
                   count: DUEL_COUNT,
                   // Set once, by whoever ends it: { winner, loser, draw }. Its
                   // presence is what "this duel is settled" means, so the stake can
                   // only ever be paid one time however many ways it ends at once.
                   over: null, leaveIn: 0,
                   cleared: false, total: 0, replay: false });
  return id;
}

const closeArena = id => {
  aliens.delete(id);
  closeLists(id);
  arenas.delete(id);
};

// How many are still standing. On `dead` rather than on the list length, because
// killAlien stamps `a.dead = respawn` first and the row is only swept out of the
// list a frame later — reading length would leave the counter stuck for a
// Leviathan's ninety seconds after the last kill.
const leftIn = id => (aliens.get(id) ?? []).filter(a => a.dead <= 0 && !a.gone).length;

// Put a pilot somewhere real. Used by every exit that is not a wreck — winning,
// running out of time, and the sweep below.
function leaveArena(p, why) {
  // Per SEAT, not per arena. A duel's two pilots came from two different hangars
  // and each of them goes back to their own — reading one `back` off the record
  // would have sent the loser to the winner's dock.
  const at = arenas.get(p.mapId)?.back?.[p.token] ?? respawnAt(p, MAPS);
  // Nothing follows you out, exactly as nothing follows you through a portal. It
  // never mattered for a claim — the sector closes on the same tick — but a duel
  // has a second occupant who may still have rockets in the air, and a seeker whose
  // target is now standing in another sector chases coordinates that are not in
  // this one.
  dropRocketsAt(p.mapId, p.ship);
  p.mapId = at.map;
  p.contacts.clear(); p.targetId = null; p.want = null; p.scoop = null;
  // Inside the ring, not on its rim: `r` is why homePorts carries one at all —
  // dropping it once produced `Math.random() * undefined`, a NaN position, and
  // pilots who could not move and could not die out of it.
  const a2 = Math.random() * Math.PI * 2, rr = Math.random() * (at.r ?? 0) * 0.6;
  Object.assign(p.ship, { x: at.x + Math.cos(a2) * rr, y: at.y + Math.sin(a2) * rr,
                          vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null,
                          charge: 0, chargeTo: null });
  touch(p);
  sendMap(p);
  if (why && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', from: '', text: why }));
}

// --- duels: consent, and what is at stake -------------------------------------
//
// A challenge is a message on somebody's screen with a clock on it. It stands for
// CHALLENGE_TTL and then it is gone, and you may not put another on the same pilot
// for CHALLENGE_CD after that — a challenge is an interruption, and an unlimited
// supply of them is harassment with a slash in front of it.
const challenges = new Map();   // challenged token -> { from, fromName, at }
const cooling    = new Map();   // `${from}>${to}` -> ms at which another may be sent
// Both pilots fold for five seconds and BOTH have to land. A duel with one seat
// filled is a pilot alone in an empty sector, so this holds the two folds together
// until they either both complete or one of them breaks.
const pending    = new Map();   // duel arena id -> { seats: [tokA, tokB], ready: Set, off, since }

const byToken = tok => [...players.values()].find(q => q.token === tok) ?? null;
const byName  = nm => [...players.values()].find(q =>
  !q.lobby && (q.acct?.name ?? '').toLowerCase() === String(nm ?? '').toLowerCase()) ?? null;

// What a pilot is doing right now, as the plain facts whyNotChallenge asks for.
// One shape, built once, so the refusal the challenger reads and the second check
// on accept cannot disagree about what "docked" or "in an arena" meant.
const duelStateOf = p => p ? {
  name: p.acct?.name ?? '', token: p.token, online: true, lobby: !!p.lobby,
  dead: !!p.dead, docked: !!p.docked, inArena: isArena(p.mapId) && !arenas.get(p.mapId)?.duel,
  duelling: !!arenas.get(p.mapId)?.duel || !!p.duelWith,
  folding: !!p.folding, jumping: (p.ship?.charge ?? 0) > 0,
} : null;

// The arena record if this pilot is standing in a duel, else null.
const duelIn  = p => { const ar = arenas.get(p?.mapId); return ar?.duel ? ar : null; };
// LOCKED is the countdown, and it is the whole of the server-authoritative half:
// while it is true every intent that could matter is refused down in the socket
// handler and both hulls are held at zero velocity up in the tick.
const duelLocked = p => (duelIn(p)?.count ?? 0) > 0;
// The other pilot in this duel, as a live player, or null if they have gone.
function duelFoe(p) {
  const ar = duelIn(p);
  if (!ar) return null;
  const other = ar.seats.find(t => t !== p.token);
  const q = byToken(other);
  return q && q.mapId === p.mapId && !q.dead && q.ship.hp > 0 ? q : null;
}

// A pod carrying credits rather than ore. See BOND in shared/cargo.js for why the
// purse is not a seventh metal.
const dropBond = (mapId, x, y, cr) => {
  if (!(cr > 0)) return;
  pods.get(mapId)?.push({ id: podId++, x: x + (Math.random() - .5) * 70,
                          y: y + (Math.random() - .5) * 70,
                          mat: BOND.key, n: 0, cr, own: 0, t: POD_LIFE });
};

// THE STAKE, and it is not a new number: `tollOn()` is exactly what an ordinary
// death already takes, and the hold is exactly what an ordinary death already
// spills. A duel changes where it goes, not how much it is.
//
// CHARGED AT RESOLUTION RATHER THAN HELD IN ESCROW, and the reason is that escrow
// can be lost. Debiting on arrival and holding the purse on the arena record means a
// process restart mid-duel destroys both stakes with nothing to show for it, and an
// arena is by construction the one sector that cannot survive a restart. Charging
// when it settles has no such hole, because there is nothing to spend it on in the
// meantime: a duel sector has no dock, no berth and no outpost, so atStation() is
// false everywhere in it and both the balance and the hold are frozen by the
// geometry rather than by a rule anybody had to write.
//
// It reaches the ACCOUNT when the pilot has gone. That is what closes the disconnect
// dodge: closing the tab is a forfeit, the sweep sees the empty seat on the next
// tick, and `db.accounts[token]` is still sitting there to be debited.
function takeStake(ar, aid, loserToken, at) {
  const p = byToken(loserToken);
  let cr = 0, hold = {};
  if (p) {
    cr = tollOn(p.credits); hold = { ...p.hold };
    p.credits -= cr; p.hold = {};
    touch(p);
  } else {
    const acct = db.accounts[loserToken];
    if (!acct) return { cr: 0, hold: {} };
    cr = tollOn(acct.credits ?? 0); hold = { ...(acct.hold ?? {}) };
    acct.credits = (acct.credits ?? 0) - cr; acct.hold = {};
    dirty = true;
  }
  for (const [m, n] of Object.entries(hold)) if (n > 0) drop(aid, at.x, at.y, m, n);
  dropBond(aid, at.x, at.y, cr);
  return { cr, hold };
}

// ONE place a duel ends, so the stake can be taken exactly once however many ways
// it ends at the same instant — a pilot who dies on the tick the wall expires would
// otherwise pay twice.
//
// `draw` pays nothing at all, and that is the anti-farming rule working from the
// other end: if running out the clock paid, the cheapest way to move credits
// between two accounts would be to fly to opposite corners and wait.
function settleDuel(aid, ar, { winner = null, loser = null, draw = false, why = '' } = {}) {
  if (ar.over) return ar.over;
  // Where they WERE, off the record the tick keeps, not where they are. A pilot who
  // forfeited by taking the portal is standing in their own hangar by now, and one
  // who forfeited by closing the tab is not anywhere at all.
  const at = ar.last?.[loser] ?? { x: (mapOf(aid)?.w ?? MAP_W) / 2,
                                   y: (mapOf(aid)?.h ?? MAP_H) / 2 };
  const took = draw ? { cr: 0, hold: {} } : takeStake(ar, aid, loser, at);
  ar.over = { winner, loser, draw, ...took };
  ar.leaveIn = DUEL_LINGER;
  for (const q of sittingIn(aid, ar)) {
    if (q.ws.readyState !== 1) continue;
    const mine = q.token === winner;
    q.ws.send(JSON.stringify({ t: 'duelend', draw: draw ? 1 : 0, won: mine ? 1 : 0,
                               cr: took.cr, secs: DUEL_LINGER, why }));
  }
  return ar.over;
}

// A line in the chat log, from the server, to one pilot. The socket handler has its
// own `tell` in scope; the tick does not, and everything below runs in the tick.
const note = (p, text) => {
  if (p?.ws?.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', from: '', text }));
};

// --- where a fold puts you down ------------------------------------------------
//
// Three arrivals, one per FOLD_ kind. They are functions rather than a switch
// inlined in the tick because two of them have to be reachable from the duel
// bookkeeping as well, and because the ORDER inside each of them is the part that
// is easy to get wrong — see arriveClaim.

// The beacon. The device is spent HERE, on arrival, which is shared/devices.js's
// SPENT_ON: being interrupted is already the punishment.
function arriveHome(p, to) {
  if (to.spend && p.devices[to.spend] !== undefined && --p.devices[to.spend] <= 0)
    delete p.devices[to.spend];
  const b = foldTo(p, MAPS, p.foldTo);
  p.mapId = b.map; p.contacts.clear(); p.targetId = null; p.want = null; p.scoop = null;
  Object.assign(p.ship, { x: b.x, y: b.y, vx: 0, vy: 0, tx: null, ty: null,
                          dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0 });
  touch(p);
  // The beacon is spent here, so the bar has to be told — touch() saves it but says
  // nothing, and the box went on reading the old count.
  if (p.ws.readyState !== 1) return;
  sendMap(p);
  p.ws.send(JSON.stringify({ t: 'fit', hull: p.ship.hull, fit: p.ship.fit,
    drones: p.ship.drones, rig: p.ship.rig ?? null, formation: p.ship.formation,
    formations: p.formations, ammo: p.ammo, using: p.using, armed: p.armed,
    kits: p.kits, kit: p.kit, devices: p.devices, device: p.device,
    foldTo: p.foldTo, berths: p.berths,
    gear: p.gear, hulls: p.hulls, credits: p.credits }));
}

// A claim. THE ARENA IS OPENED HERE AND NOT WHEN THE BUTTON WAS PRESSED, and that
// ordering is the whole reason this is a separate function.
//
// It used to run openArena() first and change the map on the same line. With a fold
// in front of it that would register a sector — eight per-sector lists, fifteen
// hostiles, its own alien id block — five seconds before anybody was in it, and
// leave it standing if the fold broke. The sweep would collect it on the next tick
// because nobody is sitting in it, so nothing would visibly break; it would simply
// be a sector stepped thirty times a second for no reason, and "the sweep gets it
// eventually" is not the same claim as "it was never there".
function arriveClaim(p, to) {
  const id = openArena(p, to.key, to.replay);
  if (!id) return note(p, 'that claim is already open — you are on your way');
  p.mapId = id;
  p.contacts.clear(); p.targetId = null; p.want = null; p.scoop = null;
  const a = arrivalAt();
  Object.assign(p.ship, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null,
                          dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0, jumpCd: 0 });
  // NOT touched. An arena id must never reach the account file: a pilot who was in
  // one when the process died would come back to a sector that does not exist.
  sendMap(p);
  note(p, to.replay
    ? `${MODULES[to.key].name} — the field is back. Nothing is paid for this one.`
    : `${MODULES[to.key].name} — ${countOf(to.key)} hostiles hold the rock. Clear them.`);
}

// A duel. BOTH folds have to land, so this is a rendezvous rather than an arrival:
// the first one to finish waits, and the sector is opened on the tick the second
// one gets there.
//
// If one fold breaks the duel is called off and NEITHER goes. The alternative —
// send the one who made it — is a pilot alone in an empty sector with a countdown,
// waiting for somebody who is never coming, and the only way out of it would be the
// portal. Both of them are told why.
function arriveDuel(p, to) {
  const pend = pending.get(to.id);
  if (!pend || pend.off) { p.duelWith = null; return note(p, 'the duel is off'); }
  pend.ready.add(p.token);
  if (pend.ready.size < pend.seats.length) return;    // hold for the other one
  pending.delete(to.id);
  const [a, b] = pend.seats.map(byToken);
  if (!a || !b) {
    for (const q of [a, b]) if (q) { q.duelWith = null; note(q, 'the duel is off — they are gone'); }
    return;
  }
  const id = openDuel(a, b);
  if (!id) {
    for (const q of [a, b]) { q.duelWith = null; note(q, 'the duel is off — that sector is already open'); }
    return;
  }
  pend.seats.forEach((tok, i) => {
    const q = byToken(tok);
    if (!q) return;
    q.duelWith = null;
    q.mapId = id;
    q.contacts.clear(); q.targetId = null; q.want = null; q.scoop = null;
    const at = startsAt(i);
    Object.assign(q.ship, { x: at.x, y: at.y, heading: at.heading, vx: 0, vy: 0,
                            tx: null, ty: null, dx: null, dy: null,
                            charge: 0, chargeTo: null, snare: 0, calm: 0, jumpCd: 0 });
    // Same rule a claim keeps and for the same reason: an arena id must never reach
    // the account file.
    sendMap(q);
    note(q, `the cut — ${DUEL_COUNT} seconds, then it is a fight`);
  });
}

// One duel, one tick. Called from the sweep so it runs in the same pass and under
// the same "is anybody still standing in this" rule as a claim.
//
// The ORDER matters and it is the same order the wreck path uses: settle first,
// linger second, because a duel can end two ways on the same tick — the last
// hull falls exactly as the wall expires — and `settleDuel` refusing to run twice
// is what makes the stake payable exactly once.
function stepDuel(aid, ar, seated, dt) {
  // Where each of them is, remembered every tick. The purse drops where the loser
  // WAS, and by the time a forfeit is noticed they are either at their own hangar
  // or not connected at all — reading ship.x then would have dropped a duel's whole
  // stake in the middle of somebody's home dock, or thrown.
  ar.last = ar.last ?? {};
  for (const q of seated) ar.last[q.token] = { x: q.ship.x, y: q.ship.y };

  // The countdown. THE SERVER OWNS THIS NUMBER. It is refused in the socket
  // handler, pinned in the ship step, and skipped in the guns pass; this is only
  // where it runs down.
  if (ar.count > 0) {
    ar.count = Math.max(0, ar.count - dt);
    if (ar.count === 0) for (const q of seated) note(q, 'go');
  }

  if (!ar.over) {
    const standing = seated.filter(q => !q.dead && q.ship.hp > 0);
    const fallen   = seated.find(q => q.dead || q.ship.hp <= 0);
    if (fallen && standing.length === 1)
      settleDuel(aid, ar, { winner: standing[0].token, loser: fallen.token, why: 'destroyed' });
    else if (seated.length < ar.seats.length) {
      // A FORFEIT. Leaving while the other one is still standing is conceding, and
      // it pays exactly what dying pays — that is the whole of the answer to "can
      // the loser dodge the stake by taking the portal, firing a beacon or closing
      // the tab". They cannot: all three land here, on the tick after they go, and
      // takeStake debits the ACCOUNT when the player object has gone with them.
      const gone   = ar.seats.find(t => !seated.some(q => q.token === t));
      const stayed = seated.find(q => !q.dead && q.ship.hp > 0);
      if (stayed) settleDuel(aid, ar, { winner: stayed.token, loser: gone, why: 'forfeit' });
      else { closeArena(aid); return; }   // both of them gone at once: nobody pays
    }
    // The wall. A DRAW, and it pays nothing at all — see shared/duel.js: if running
    // out the clock paid, the cheapest way to move credits between two accounts
    // would be to fly to opposite corners and wait for it.
    else if ((Date.now() - ar.opened) / 1000 > DUEL_LIMIT)
      settleDuel(aid, ar, { draw: true, why: 'time' });
  }

  if (ar.over && (ar.leaveIn -= dt) <= 0)
    for (const q of seated)
      leaveArena(q, ar.over.draw ? 'time — neither of you fell, and nothing changed hands'
                 : q.token === ar.over.winner
                   ? `you won. ${ar.over.cr.toLocaleString('en-US')} cr and their hold were on the floor`
                   : 'you lost — a tenth of your credits and your hold went with the ship');
}

// Take a pending duel down before it ever became a sector. Clears both folds so
// neither pilot arrives, and says why — a fold that stops with no explanation is
// indistinguishable from a button that did not work.
function callOffDuel(id, why) {
  const pend = pending.get(id);
  if (!pend) return;
  pending.delete(id);
  for (const tok of pend.seats) {
    const q = byToken(tok);
    if (!q) continue;
    if (q.folding?.to?.kind === FOLD_DUEL && q.folding.to.id === id) q.folding = null;
    q.duelWith = null;
    note(q, why);
  }
}

// The hull and formation galleries, resolved once at boot. They never move, take
// damage or shoot, so there is nothing to step — just rows to hand out.
const PROP_ROWS = PROPS.map(p2 => {
  const s2 = newShip(p2.x, p2.y, p2.hull, propFit(p2.hull), Array(MAX_DRONES).fill(topTier('weapon')), p2.formation);
  return { id: p2.id, x: p2.x, y: p2.y, heading: 0, charge: 0, co: p2.co, hull: p2.hull,
           hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0,
           guns: s2.guns, lvl: 0, drones: s2.bays,
           form: Math.max(0, FORMATION_KEYS.indexOf(p2.formation)),
           dmask: (1 << s2.bays) - 1, psys: 0, plvl: 0, vis: ALLY,
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
// Rebuilt from the live hostiles every tick rather than kept, because a fix has no
// life of its own: it exists exactly while a Kedge is holding one, and a stale one
// left lying about would be a marker for a collapse that is never coming.
const fixes = new Map();
const pods = new Map();      // mapId -> cargo adrift
const hits = new Map();      // mapId -> damage numbers still climbing
// Ground somebody sowed and has not yet expired. It is per SECTOR rather than per
// hostile for the reason that IS the mechanic: a pool outlives the Crucible that laid
// it, so hanging it off the alien would delete it on the tick that made it matter
// most — the one where you finally killed the thing and flew into what it left.
const sown = new Map();      // mapId -> patches of White Heat and Slack Water
let groundId = 1;

// Every per-sector list, named once.
//
// These were four separate `for (const id of Object.keys(MAPS))` loops, which was
// fine while every sector existed at boot. An instanced sector has to create and
// destroy all EIGHT together: six of them are pushed to without a `?? []`
// guard — `bolts.get(p.mapId).push(shot)` and its siblings — so a claim arena that
// got six of them would throw on the frame somebody fired, and take the tick down
// with it. `fixes` is the seventh and it arrived after this list was first
// written, which is exactly the failure the list exists to stop: it is emptied and
// refilled every tick by the sightings pass, and a sector missing from it throws
// on `here.length = 0`. `sown` is the eighth and it arrived the same way — the
// deeps' ground pass reads it per sector with no guard, and a claim arena missing
// from it would throw on the first frame anybody sowed anything in one.
const SECTOR_LISTS = [bolts, rockets, blasts, pyres, pods, hits, fixes, sown];
const openLists  = id => { for (const L of SECTOR_LISTS) L.set(id, []); };
const closeLists = id => { for (const L of SECTOR_LISTS) L.delete(id); };
for (const id of Object.keys(MAPS)) openLists(id);

let podId = 1;
const drop = (mapId, x, y, mat, n, own = 0) => {
  if (n > 0) pods.get(mapId).push({ id: podId++, x: x + (Math.random() - .5) * 70,
                                    y: y + (Math.random() - .5) * 70, mat, n, own, t: POD_LIFE });
};

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
  // A claim pays nothing: no bounty, no experience, no ore, no entry in the threat
  // file — see PAYS in shared/arena.js for the arithmetic. You are not being paid
  // to be here, you are buying a rock, and a field worth six figures that can be
  // re-entered after every death and replayed forever is a faucet no rate survives.
  const paying = !isArena(mapId);
  // A kill with an empty ledger still pays whoever finished it: shear, a dev
  // command, anything that damages an alien without a bolt of its own.
  if (!a.dealt.size && byId !== null) a.dealt.set(byId, 1);
  const cuts = paying ? splitKill(a.dealt, a.def.bounty, a.def.xp ?? a.def.bounty) : [];
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
    // Into the threat file. Everyone the ledger pays learns the thing, not only
    // whoever fired last — you were in that fight, so you know what it does, and
    // crediting only the killer would make a party's file depend on who got the
    // final bolt in rather than on who was there.
    paid.kills[a.kind] = (paid.kills[a.kind] ?? 0) + 1;
    // And whether that kill was the one that finished a quest. Checked HERE, against
    // the list the pilot was already holding, so the banner fires exactly once — on
    // the kill that did it — rather than every tick afterwards, and so a threshold
    // that moves later can never take the reward back off them. See shared/quests.js.
    for (const key of newlyEarned(paid.unlocked, paid.kills)) {
      paid.unlocked = [...paid.unlocked, key];
      // The reward is berths, and berths change the ship rather than a stat, so the
      // ship has to be told before the next tick resolves anything off it. refit()
      // reads `earnedBays` the same way it reads `research`.
      paid.ship.earnedBays = bonusBays(paid.unlocked);
      refit(paid.ship, paid.ship.hull, paid.ship.fit);
      if (paid.ws.readyState === 1) paid.ws.send(JSON.stringify(
        { t: 'unlocked', key, what: QUESTS[key].name, won: QUESTS[key].won ?? QUESTS[key].tell,
          kind: a.kind, need: needFor(a.kind) }));
    }
    touch(paid);                                  // credits, rank and the file banked immediately
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

  const loot = paying ? rollDrop(a.kind, a.rand) : null;   // seeded, so drops replay with the alien
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
  //
  // And the same door catches two more cases, which is why it is one test on
  // `MAPS` rather than a test on `.dev`: a claim arena stopped existing the moment
  // the socket that opened it closed, and a save may name a sector this build has
  // never heard of. Both would be a pilot standing in a sector with no portals,
  // no dock and — for an arena — nothing else in it at all. The coordinates go
  // home with the sector, because a position only means anything together with
  // the map it was taken in.
  if (!MAPS[acct.mapId] || (MAPS[acct.mapId].dev && !isAdmin(acct))) {
    acct.mapId = acct.co + '1';
    acct.x = MAPS[acct.mapId].base.x; acct.y = MAPS[acct.mapId].base.y;
  }

  const ship = newShip(acct.x, acct.y, acct.hull, acct.fit, acct.drones, acct.formation, acct.rig,
                       acct.lab?.mods ?? 0, bonusBays(acct.unlocked));
  players.set(id, { ws, token, acct, mapId: acct.mapId, co: acct.co, ship,
                    contacts: new Map(), targetId: null,
                    // What this connection has been told. Per connection, never per
                    // map: radar means two pilots in the same sector see different
                    // things, so there is no shared previous world to diff against.
                    base: newBase(),
                    // Everything the account carries, in one list, shared with
                    // /reset — see carried() in shared/account.js for why. `claims`
                    // rides in it like every other account field.
                    ...carried(acct),
                    fixing: null, folding: null,
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
  //
  // THE ESCORT THAT FLIES, not the bays the pilot owns. `ship.drones` is the full
  // owned list on purpose — capture() writes every bay back to the account — and
  // resolve() has always run it through berthed() before counting anything. This
  // did not, so a pilot with a Kestrel's twelve bays on a Vanguard that berths
  // eleven was refused Collimated Cells because of the twelfth, which does not
  // resolve, does not draw and does not shoot. Measured: lowestGun reported an
  // MK-V "your escort flies", of a drone the escort is not flying.
  //
  // Same funnel as sim.js's refit — one berthed(), several callers — rather than a
  // second copy of "which bays are seated".
  const feeding = () => ({ fit: ship.fit,
                           drones: berthed(ship.hull, ship.drones, bonusBays(players.get(id)?.unlocked ?? [])),
                           EQUIPMENT });
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
                `back in ${mapOf(acct.mapId).name} (${players.size} online)`);
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

    // How big the window is. Advisory, and it rides the intent path because that
    // is what it is: the client telling us something about itself that the server
    // files and never acts on. Nothing in the tick reads a viewport — see
    // shared/viewport.js — so a client lying about it buys a wrong row in /sizes
    // and nothing else, which is the only safe shape for a number only the client
    // can know.
    //
    // touch() rather than a bare assignment, because /sizes reads db.accounts and
    // a pilot who is online right now is exactly the one whose window you want to
    // see — touch is capture plus the dirty flag, so it lands on the account and
    // on disk within the second. Without it the size sat on the live player only
    // and the accounts file still said null: verified live, and it is why this
    // line is a touch and not a `=`.
    //
    // The fields are named rather than spread, so `at` is the server's clock and
    // not something the client can backdate — it is what decides which report in
    // a bucket is the freshest, and the client has no business setting it.
    if (m.t === 'view') {
      if (!P) return;
      const now = Date.now();
      const v = sanitiseView({ w: m.w, h: m.h, dpr: m.dpr }, now);
      if (!v) return;
      // Only write when the window actually changed. The client already reports
      // once per settled resize, so this is not about the client — it is that
      // touch() is a full capture(), and `view` is the one message a client can
      // send from anywhere at any rate with nothing else gating it.
      const same = P.view && P.view.w === v.w && P.view.h === v.h && P.view.dpr === v.dpr;
      P.view = v;
      if (!same) touch(P);
      return;
    }    // --- THE COUNTDOWN, AND IT IS ENFORCED HERE ------------------------------
    //
    // Five seconds where neither pilot can move, turn, shoot, launch, route power,
    // jump or fold. The client draws the number; it does not own it. Every intent
    // that could matter is refused right here, and the tick holds both hulls at
    // zero velocity on top of it — so a client that lies about the countdown, or
    // simply never runs one, gains exactly nothing.
    //
    // This is above every handler below it on purpose. A gate that sits under the
    // one message somebody forgot to think about is not a gate.
    if (duelLocked(P) && ['jump', 'intent', 'target', 'power', 'scoop', 'recall',
                          'claim', 'replay', 'repair'].includes(m.t))
      return tell('hold — the clock has not let go yet');

    if (m.t === 'jump') return beginJump(ship, mapOf(P.mapId));

    // --- station: everything below needs you sitting in your own base ring ---
    // Your own dock, or a berth you rent at a pirate outpost. The berth is the
    // same counter for everything that reads atStation() — refit, buy, sell — and
    // it closes the moment anything hits you, because a shop you can use mid-fight
    // is a shop that ends fights. It is not a haven and it does not repair.
    const atBerth = () => !whyNotBerth({
      owned: P.berths.includes(P.mapId), inside: inOutpost(mapOf(P.mapId), ship),
      sinceHit: ship.sinceHit,
    });
    const atStation = () => canDock(mapOf(P.mapId), P.co, ship) || atBerth();

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
          return tell(`${mapOf(P.mapId).name} — ${mapOf(P.mapId).owner
            ? COMPANIES[mapOf(P.mapId).owner].tag + ' space' : 'contested'}`);
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
        case 'kills': {
          if (!WILD.includes(a1)) return tell('hostiles: ' + WILD.join(' '));
          P.kills[a1] = (P.kills[a1] ?? 0) + amount(a2 ?? 1, 9999);
          // Deliberately does NOT grant the unlock. The whole point of writing kills
          // in is to walk up to a threshold and then cross it by killing something,
          // which is the path that has to work — granting here would test the grant
          // and skip the trigger.
          touch(P);
          const q = QUESTS[Object.keys(QUESTS).find(k => QUESTS[k].kind === a1)];
          return tell(`threat file: ${a1} x${P.kills[a1]}` +
            (q ? ` — ${q.name} at ${needFor(a1)}` : ''));
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
                                dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0, jumpCd: JUMP_CD });
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
                                dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0, jumpCd: JUMP_CD });
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
            // The yard is built from the accounts, so an account that no longer
            // exists still has a station standing in the ring until something else
            // happens to rebuild it — a plot claimed by nobody, drawn with a name
            // nobody answers to. Same reason on the plain reset below.
            reyard();
            for (const list of aliens.values()) forgetPlayer(list, id);
            ws.send(JSON.stringify({ t: 'reset' }));   // the client drops its token and reloads
            console.log(`~ ${acct.name} wiped their account`);
            return;
          }
          const seq = acct.seq, co = acct.co, name = acct.name, admin = acct.admin;
          // The window they play in comes across too. A reset throws away progress,
          // not hardware — the pilot is sitting at the same monitor a second later,
          // and losing the row would make /sizes quietly under-count the people who
          // use /reset most, which is the two of us.
          const view = acct.view ?? null;
          acct = newAccount(token, seq, Date.now());
          Object.assign(acct, { name, co, admin, view, mapId: co + '1' });
          const b2 = MAPS[acct.mapId].base;
          acct.x = b2.x; acct.y = b2.y;
          db.accounts[token] = acct;

          P.acct = acct; P.mapId = acct.mapId; P.co = co;
          // From the new account rather than field by field. The hand-written
          // version had drifted: it zeroed credits and gear and never touched the
          // research station, so a reset pilot flew a starter hull with a x4 hull
          // multiplier and a 500,000cr lab still standing in their ring, and
          // capture() wrote it all back a second later. carried() is one list, used
          // here and where a connection seeds a player, and it cannot drift again.
          Object.assign(P, carried(acct),
                        { targetId: null, want: null, scoop: null, fixing: null, folding: null });
          P.contacts.clear();
          // The ship carries the research multiplier too — refit reads it off the
          // account's lab, which the new account does not have.
          ship.research = 0;
          // And the quest rewards go with everything else. Set BEFORE the refit, not
          // after: refit reads it off the ship, so assigning it afterwards would
          // leave a reset pilot flying berths their new account does not own until
          // the next thing that happened to re-fit them.
          ship.earnedBays = 0;
          refit(ship, acct.hull, acct.fit, [], acct.formation, null);
          Object.assign(ship, { x: b2.x, y: b2.y, vx: 0, vy: 0, tx: null, ty: null,
                                dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0 });
          store.save(db);
          reyard();                     // the plot goes back to the ring with it
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
        // The other half of /heal. The wreck path is the hardest thing in the game
        // to reach deliberately, and it settles on the next tick exactly as a bolt
        // would settle it — this only sets the hull to zero, so nothing about how a
        // death works is duplicated here.
        case 'kill':
          ship.shield = 0; ship.hp = 0;
          return tell('scuttled');
        // Empties the sector. The bounty is settled on the ledger and this touches
        // no ledger, so nothing is paid for it anywhere — which is the same answer
        // a claim gives, and the reason this is safe to point at either.
        case 'clear': {
          const list = aliens.get(P.mapId) ?? [];
          let n2 = 0;
          for (const a of list) if (a.dead <= 0) { killAlien(P.mapId, a, null); n2++; }
          return tell(`${n2} cleared in ${mapOf(P.mapId).name}`);
        }
        // Standing at your own plot, which is where the whole research ladder and
        // every claim is refused from anywhere else.
        case 'tolab': {
          if (!P.lab) return tell('no station — stake a plot in your own ring first');
          const spot = plotAt(MAPS[P.co + '1']?.base, P.lab.slot);
          if (!spot) return tell('your plot is not in the yard any more');
          const moved = P.mapId !== P.co + '1';
          P.mapId = P.co + '1';
          Object.assign(ship, { x: spot.x, y: spot.y, vx: 0, vy: 0, tx: null, ty: null,
                                dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0 });
          touch(P);
          if (moved) sendMap(P);
          return tell('standing at your station');
        }
        // What instanced sectors are open. There is no other way to ask: an arena
        // is not in MAPS, not on the chart, and only ever visible to one pilot.
        case 'arenas':
          return tell(JSON.stringify({ open: arenas.size, list: [...arenas].map(([k, a]) =>
            ({ id: k, key: a.key, left: leftIn(k), cleared: a.cleared, replay: a.replay,
               duel: !!a.duel, seats: a.seats.length,
               here: sittingIn(k, a).length, count: +(a.count ?? 0).toFixed(1),
               lists: SECTOR_LISTS.filter(L => L.has(k)).length })) }));
        // What windows this game is actually played in, biggest constituency first.
        // The whole reason the client reports its size at all: test/render.mjs
        // sweeps window sizes hunting for panels that print through each other,
        // and until now it swept seven that somebody picked. This says which of
        // them are real and what the sweep has grown to.
        //
        // Trimmed to six rows because the client cuts an incoming chat line at
        // MAX_LEN (160), so a long list would arrive with its tail missing and
        // nothing to say it had.
        case 'sizes': {
          const rows = viewsOf(db.accounts);
          if (!rows.length) return tell('no windows reported yet — sizes land on the account as pilots connect');
          const shown = rows.slice(0, 6).map(sayView).join('  ');
          return tell(`${rows.length} window${rows.length > 1 ? 's' : ''}: ${shown}` +
                      `${rows.length > 6 ? ' …' : ''} — the harness sweeps ${mergeSizes(rows).length}`);
        }

        // --- a duel ---------------------------------------------------------
        //
        // The name is REJOINED from the args rather than read as a1, because a
        // callsign may contain spaces — shared/signup.js allows them — and
        // `/1v1 Ash Ryder` would otherwise challenge a pilot called "Ash".
        case '1v1': {
          const want = line.args.join(' ').trim();
          if (!want) return tell('who? — /1v1 <callsign>');
          const them = byName(want);
          const key = `${token}>${them?.token ?? want}`;
          const cool = Math.max(0, ((cooling.get(key) ?? 0) - Date.now()) / 1000);
          // ONE outstanding challenge per pilot, in either direction. Without it a
          // single pilot can put a line on every screen in the game at once, which
          // is the spam this cooldown exists to stop by a slower route.
          const mine = [...challenges.values()].some(c => c.from === token);
          const why = whyNotChallenge(duelStateOf(P), duelStateOf(them),
                                      { cooling: cool, pending: mine });
          if (why) return tell(why);
          const stake = stakeOf(P.credits, P.hold);
          challenges.set(them.token, { from: token, fromName: acct.name, at: Date.now() });
          // Both ends are told, and the challenged pilot is told the NUMBER. An
          // uncapped stake is only fair if nobody can accept one blind — see the
          // cap argument in shared/duel.js, which is why there is no cap.
          if (them.ws.readyState === 1) them.ws.send(JSON.stringify(
            { t: 'challenge', from: acct.name, secs: CHALLENGE_TTL, cr: stake.cr }));
          note(them, challengeText(acct.name, stake));
          return tell(`challenge sent to ${them.acct.name} — it lapses in ${CHALLENGE_TTL}s`);
        }
        case 'accept': {
          const c = challenges.get(token);
          if (!c) return tell('nobody has challenged you');
          challenges.delete(token);
          const them = byToken(c.from);
          // Re-asked rather than trusted. Everything either of them was doing can
          // have changed in the thirty seconds the offer stood — they may have
          // docked, died, jumped or started another duel — and the refusal has to
          // be the same refusal in the same words that /1v1 would have given.
          const why = whyNotChallenge(duelStateOf(P), duelStateOf(them));
          if (why) { if (them) note(them, `${acct.name} could not take it: ${why}`); return tell(why); }
          const id = arenaId(them.token, DUEL_KEY);
          if (arenas.has(id) || pending.has(id)) return tell('they already have a duel open');
          // BOTH fold. Five seconds each, cancelled by anything that lands, and
          // neither goes unless both land — see arriveDuel.
          pending.set(id, { seats: [them.token, token], ready: new Set(), off: false,
                            since: Date.now() });
          for (const q of [them, P]) {
            q.duelWith = id;
            q.folding = newFold({ kind: FOLD_DUEL, id }, q.ship.sinceHit);
          }
          note(them, `${acct.name} took it — folding out. ${FOLD_SECS.toFixed(0)}s, and one hit calls it off`);
          return tell(`folding out against ${them.acct.name} — ${FOLD_SECS.toFixed(0)}s, and one hit calls it off`);
        }
        case 'decline': {
          const c = challenges.get(token);
          if (!c) return tell('nobody has challenged you');
          challenges.delete(token);
          cooling.set(`${c.from}>${token}`, Date.now() + CHALLENGE_CD * 1000);
          const them = byToken(c.from);
          if (them) note(them, `${acct.name} declined`);
          return tell('declined');
        }
      }
      return;
    }

    if (m.t === 'buyhull') {
      if (!atStation() || !HULLS[m.key] || P.hulls.includes(m.key)) return;
      if (P.credits < hullPrice(m.key)) return;
      P.credits -= hullPrice(m.key);
      P.hulls.push(m.key);
      // The same reseat the hull-swap below does, and for the same reason. Buying
      // a ship flies it at once, and this branch handed the new hull the old rack
      // untouched: a Bulwark's four MK-Vs resolved WHOLE on a Kestrel that seats
      // two — 1,638 damage where 838 is legal — and stayed that way until the next
      // save ran the fit through sanitiseFit and deleted the surplus without a
      // word. Buying a hull and switching to one you own are the same act.
      const moved = reseat(slotsOf(m.key), ship.fit, P.gear);
      P.gear = moved.gear;
      refit(ship, m.key, moved.fit, ship.drones, ship.formation);   // bought, and flown at once
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
      // Standing in the hangar it would fold you to, not merely standing somewhere.
      const dest = foldTo(P, MAPS, P.foldTo);
      const atDest = P.mapId === dest.map
        && Math.hypot(ship.x - dest.x, ship.y - dest.y) < (dest.r ?? 0);
      const why = whyNotDevice({ devices: P.devices, using: P.device,
                                 atDest, busy: !!P.folding });
      if (why) return tell(why);
      // Nothing is spent here. Being interrupted is already the punishment, and
      // charging for the attempt would mean the only safe time to press it is a
      // time you did not need it. The device rides the DESTINATION now rather than
      // being the destination — `spend` is what arriveHome consumes.
      P.folding = newFold({ kind: FOLD_PORT, spend: P.device }, ship.sinceHit);
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
      // The clamp stays — a client must never be able to ask for a billion crates —
      // but it is now the BIGGEST BUTTON THE SHELF DRAWS rather than a number
      // somebody typed. It was 99, which is the one value that makes a x100 button
      // a liar: it took the click, charged for 99 and said nothing about the
      // hundredth. buyCrates() is the same clamp the shelf is built from.
      const want = buyCrates(m.n);
      // Fill the order as far as the purse goes rather than refusing it whole.
      // `if (P.credits < cost) return` was survivable while a click meant one
      // crate; with a x100 button a pilot three credits short clicked and the game
      // said NOTHING — a refused click and a successful one looking identical from
      // the outside is the exact bug receipt() was written for. So a short order is
      // filled and the receipt says how short, and only an EMPTY order is refused —
      // out loud, with the price and the balance in it.
      const crates = Math.min(want, Math.floor(P.credits / a.price));
      if (crates < 1)
        return tell(`${a.name}: a crate is ${a.price} credits and you hold ${Math.floor(P.credits)}`);
      const cost = a.price * crates;
      P.credits -= cost;
      P.ammo[m.key] = (P.ammo[m.key] ?? 0) + a.pack * crates;   // no cap, on purpose
      // The receipt says the usual thing normally and names the shortfall when
      // there is one. It cannot say both: the toast's note line has 31 characters
      // before it reaches the balance printed on the same baseline.
      receipt(a.name, cost, crates < want
        ? `${crates}/${want} crates · ${a.pack * crates} rounds`
        : `${a.pack * crates} rounds · ${P.ammo[m.key]} held`);
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
      // The hull's berths, not the shelf's twelve — the same number hangar.js draws
      // the counter from, because a shop that sells what the server refuses is the
      // one bug this codebase keeps one copy of every rule to avoid.
      const berths = baysOf(ship.hull, bonusBays(P.unlocked));
      if (!atStation()) return;
      // Refused OUT LOUD. A full rack returned silently, so a pilot who had filled
      // a Vanguard's eleven clicked BUY and the game did nothing at all — the
      // designer hit this and had to ask why. It is the same bug receipt() exists
      // for: a refused click and a successful one looked identical from outside.
      // The number is the answer, and so is the door out of it, because the bays
      // are a property of the HULL rather than a wallet — a Hauler and a Kestrel
      // berth twelve where a Vanguard berths eleven, and the Brood Frame adds two
      // to whatever you fly.
      if (ship.drones.length >= berths)
        return tell(`${HULLS[ship.hull].name} berths ${berths} — all ${berths} are yours. `
          + (bonusBays(P.unlocked) ? 'A bigger hull is the only way up from here.'
                                   : 'The Brood Frame adds two more, at a hundred Corsair Hives.'));
      const cost = dronePrice(ship.drones.length);
      if (P.credits < cost)
        return tell(`Bay ${ship.drones.length + 1} costs ${cost.toLocaleString('en-US')} cr `
          + `— you hold ${P.credits.toLocaleString('en-US')}`);
      P.credits -= cost;
      refit(ship, ship.hull, ship.fit, [...ship.drones, null]);
      receipt(`Drone ${ship.drones.length}`, cost, `${ship.drones.length} of ${berths} bays used`);
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
      const why = whyNotSold(m.item, { docked: canDock(mapOf(P.mapId), P.co, ship),
                                       berth: atBerth(), deep: atBerth() && !!mapOf(P.mapId).deep });
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
      if (item.kind === 'rocket' && launcherRoom(ship.hull, ship.fit) <= 0) return;   // this hull's rack limit
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
                            charge: 0, chargeTo: null, jumpCd: JUMP_CD, shieldHit: 0,
                            // A wreck comes back with its engines its own. Ground it
                            // died in is still standing where it died, and inheriting
                            // the hold would mean respawning unable to steer.
                            snare: 0, calm: 0 });
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
      const where = canDock(mapOf(P.mapId), P.co, ship) ? 'dock' : atBerth() ? 'berth' : null;
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
      const where = canDock(mapOf(P.mapId), P.co, ship) ? 'dock' : atBerth() ? 'berth' : null;
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
      const why = whyNotBuild(m.key, { credits: P.credits, mask: P.lab.mods, claims: P.claims,
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
    // Going to free a rock, or going back to one you already freed. The station
    // launches you; there is no other door into an arena, and this is the only
    // line in the file that assigns an arena id to a pilot — everything else can
    // only take one away.
    //
    // ONE handler for both, because everything after the refusal is identical and
    // two copies of "put this pilot in an instanced sector" is exactly the shape
    // rule one exists to stop. The only thing that differs is which question is
    // asked, and both questions live in shared/arena.js so the panel refuses in
    // the same words the server does.
    if (m.t === 'claim' || m.t === 'replay') {
      if (!ARENAS[m.key]) return tell('no claim on this');
      if (!P.lab) return tell('no station — stake a plot in your own ring first');
      const back = m.t === 'replay';
      const at2 = plotAt(MAPS[P.co + '1']?.base, P.lab.slot);
      const where = { mask: P.lab.mods, claims: P.claims, hold: P.hold,
                      inArena: isArena(P.mapId),
                      near: P.mapId === P.co + '1' && nearLab(at2, ship) };
      const why = back ? whyNotReplay(m.key, where) : whyNotClaim(m.key, where);
      if (why) return tell(why);
      if (P.folding) return tell('a fold is already running');
      // A FIVE SECOND FOLD, NOT A TELEPORT, and it is cancelled by anything that
      // lands on you. This used to put you in the sector on the same line it
      // checked the refusal, which made the station panel a free escape hatch out
      // of any fight in the open world — you are being shot, you press CLAIM, you
      // are gone with your ship and your hold. A Recall Beacon costs 3,400 credits
      // and five interruptible seconds to do exactly that.
      //
      // The sector itself is opened on ARRIVAL — see arriveClaim — so a fold that
      // breaks leaves nothing registered.
      P.folding = newFold({ kind: FOLD_CLAIM, key: m.key, replay: back }, ship.sinceHit);
      return tell(`folding out to ${MODULES[m.key].name} — ${FOLD_SECS.toFixed(0)}s, `
        + `and one hit stops it. ${back ? 'Nothing is paid for this one.'
                                        : `${countOf(m.key)} hostiles hold the rock.`}`);
    }
    if (m.t === 'buyberth') {
      // `mapId` is the whole of what makes this safe now that a bay is not one
      // price. The refusal and the charge read the same lookup off the same key —
      // quote the terms with one and debit with the other and a ten million credit
      // bay in the deeps goes for the frontier's 27,200, with the server happily
      // taking the money.
      const why = whyNotBuyBerth({ mapId: P.mapId, xp: P.xp, credits: P.credits,
                                   owned: P.berths.includes(P.mapId),
                                   inside: inOutpost(mapOf(P.mapId), ship) });
      if (why) return tell(why);
      const paid = berthPrice(P.mapId);
      P.credits -= paid;
      P.berths = [...P.berths, P.mapId];
      receipt('Berth · ' + mapOf(P.mapId).name, paid, 'you may refit and buy here now');
      touch(P);
      return outfit();
    }
    // Ore straight to credits, at the pirates' rate, without flying home. The
    // hold is what it empties — the company hangar is none of their business.
    if (m.t === 'fence') {
      if (!inOutpost(mapOf(P.mapId), ship)) return tell('no outpost in range — fly into the ring');
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
    // Aliens anywhere; the other pilot ONLY inside a duel.
    //
    // PvP is a property of the SECTOR and never of the ship — the same pattern
    // `noLeash` and `dry` use, and for the same reason: two pilots of one company
    // must be able to hurt each other in here and nowhere else, and a flag on the
    // ship would follow them out into the open world where a fleetmate has to stay
    // untouchable. `duelFoe` reads the arena record, so there is no way to name a
    // player as a target from a sector that is not a duel, however the id arrives.
    if (m.t === 'target') {
      const found = (aliens.get(P.mapId) ?? []).find(a => a.id === +m.id && a.dead <= 0 && a.hp > 0);
      if (found) { P.targetId = found.id; return; }
      const foe = duelFoe(P);
      // The same predicate the client asks before it offers the shot.
      P.targetId = mayAim({ co: P.co, id: +m.id },
                          { foeId: foe?.id ?? null, count: duelIn(P)?.count ?? 0 })
        ? foe.id : null;
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
      // Clamped to THIS SECTOR's bounds, which is the galaxy's rectangle plus the
      // drift margin everywhere except a duel arena — a quarter the size, with a
      // hard edge. The client's minimap asks boundsOf() too, so the rectangle it
      // draws a course into and the rectangle the server accepts one in are the
      // same rectangle. Two copies of that is exactly the drift rule one names.
      const B = boundsOf(mapOf(P.mapId));
      ship.tx = Math.max(B.x0, Math.min(B.x1, +m.x || 0));   // you may order a course
      ship.ty = Math.max(B.y0, Math.min(B.y1, +m.y || 0));   // out past the lattice

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
    const here = mapOf(p.mapId);
    // THE COUNTDOWN, HELD IN THE SIMULATION AND NOT ONLY IN THE MESSAGE HANDLER.
    // Refusing the intents is not enough on its own: a course ordered before the
    // fold, or a velocity carried in from the last sector, would coast through the
    // whole five seconds. So the hull is pinned every tick until the clock lets go.
    if (duelLocked(p))
      Object.assign(p.ship, { vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null,
                              charge: 0, chargeTo: null });
    // The sector's own bounds. A duel arena is a quarter the size with a hard edge;
    // everywhere else this is the galaxy's rectangle plus the drift margin, exactly
    // as it always was.
    step(p.ship, dt, boundsOf(here));
    // The engines-out clock and the calm that is owed after it. AFTER step(), so the
    // tick a hold is spent is a tick that actually had no thrust in it — advancing it
    // first would hand every hold one free frame of acceleration back and make the
    // guarantee in shared/ground.js a third of a tick short of true.
    stepSnare(p.ship, dt);
    // A Shear Compensator nulls the first half of the drift margin and charges the
    // reactor for it, so how far out you can hold is how much tank you have left.
    // Nothing fitted and holdShear returns 0, which is the curve sim.js always had.
    // `here` so a walled sector reports no depth: a duel is decided by guns, not by
    // shoving somebody over a line into the shear.
    stepDrift(p.ship, dt, holdShear(p.ship, dt), here);
    const map = mapOf(p.mapId);
    p.docked = canDock(map, p.co, p.ship);
    // The last hangar you actually stood in, which is where a wreck comes back.
    // Recorded from the same question the station panel asks, so you can never
    // respawn somewhere you could not have shopped.
    if (isHangar(p.mapId, map, p.co, p.ship, p.berths)) {
      if (p.lastDock !== p.mapId) { p.lastDock = p.mapId; touch(p); }
    }
    // Shields do not come back inside a DUEL — and they DO come back inside a
    // claim. Both halves of that were the designer's call. A claim is hard because
    // nothing in it ever breaks off; making it hard by taking a mechanic away was
    // never asked for and was reverted. A duel is a different argument that belongs
    // to duels: regeneration is 3.33% of the pool a second, so two evenly matched
    // pilots in a 6,000px box have an obvious dominant line, and it is to kite to
    // the wall and take the draw. Without it, the ship each of them arrives in is
    // all they get and somebody has to commit. A repair kit still works, because
    // five seconds of not being shot at is a decision rather than a rest button.
    stepVitals(p.ship, dt, p.docked, isDuelMap(mapOf(p.mapId)));
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
    // The Pocket Dimension: the hold goes to your own hangar and comes back as
    // credits, every POCKET_EVERY seconds, wherever you are.
    //
    // Date.now() and not the tick's `now`, for exactly the reason bankLab is on
    // the wall clock two lines up — the tick counts from when the process started,
    // and mixing the two is what made the mine pay nothing for a day. This does
    // not accrue offline the way the mine does, and that is the point rather than
    // an omission: a mine keeps working while you are away, a dimension sells what
    // is IN YOUR SHIP, and your ship is not out there when you are not.
    //
    // `soldAt` is seeded on the first tick a pilot owns one rather than at login,
    // so buying it does not pay out on the same frame — the first sale is a full
    // period after it starts working, which is also what stops a reconnect being
    // a way to skip the wait.
    //
    // NOT INSIDE A DUEL, and it is the same shape of rule as the shield line above:
    // a duel's stake is a tenth of your credits AND THE WHOLE HOLD, so a hold that
    // sells itself thirty seconds in is not a stake. It would let a pilot carry a
    // full hold into a fight, watch it turn into a balance that is only a tenth at
    // risk, and put nothing of it on the table. A claim needs no such line because
    // shared/arena.js already refuses to let you enter one carrying anything.
    if (p.lab && hasPocket(p.lab.mods) && !isDuelMap(here)) {
      if (p.soldAt === undefined) p.soldAt = wall;
      if (wall - p.soldAt >= POCKET_EVERY * 1000) {
        p.soldAt = wall;
        const units = Object.values(p.hold).reduce((t, n) => t + n, 0);
        // The clock runs whether or not there was anything to sell — it is the
        // dimension's cycle, not a queue — but an empty hold says nothing. A
        // message every thirty seconds forever, most of them reporting zero, is
        // the spam this readout was designed around: the client anchors its
        // countdown on the last real sale and runs its own clock between them.
        if (units > 0) {
          const paid = pocketValue(p.hold);
          p.hold = {};
          p.credits += paid;
          touch(p);
          if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'sold', cr: paid, units,
                                                               credits: p.credits }));
        }
      }
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
    // ONE FOLD, THREE DESTINATIONS. This used to be the Recall Beacon's private
    // mechanic; the beacon is now one caller of it and a claim and a duel are the
    // other two. `p.folding.to` says where it puts you down and nothing here reads
    // a device key to find out — see shared/fold.js for why that mattered: an
    // instant teleport into a claim was a free, uninterruptible version of the
    // thing the beacon charges 3,400 credits and five interruptible seconds for.
    if (p.folding) {
      if (foldBroken(p.ship.sinceHit, p.folding.mark, p.ship.hp)) {
        const to = p.folding.to;
        p.folding = null;
        // A broken duel fold takes the whole duel down, not just this pilot's half.
        // The other one is still folding, and landing them alone in an empty sector
        // is the one outcome nobody asked for.
        if (to.kind === FOLD_DUEL) callOffDuel(to.id, `${p.acct.name} was hit — the duel is off`);
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify(
          { t: 'chat', from: '', text: brokenText(to.kind) }));
      } else {
        p.folding.mark = p.ship.sinceHit;
        p.folding.left -= dt;
        if (p.folding.left <= 0) {
          const to = p.folding.to;
          p.folding = null;
          if (to.kind === FOLD_PORT) arriveHome(p, to);
          else if (to.kind === FOLD_CLAIM) arriveClaim(p, to);
          else if (to.kind === FOLD_DUEL) arriveDuel(p, to);
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
      // Dying on a claim costs nothing. You came out here with an empty hold —
      // whyNotClaim and whyNotReplay both insist on it — so there is nothing to
      // spill, and a tenth of the credits off a fight you are MEANT to lose two or
      // three times before you win it would make the whole thing something to
      // avoid rather than something to try. The claim you did not free is the
      // punishment; on a replay there is not even that, which is exactly what
      // makes a replay a practice range rather than a gamble.
      // Nothing is settled here inside ANY arena, and that covers both kinds for two
      // different reasons. A claim costs nothing by design — you arrived with an
      // empty hold and dying there is meant to be cheap. A duel costs exactly what
      // an ordinary death costs, but it is settled by settleDuel() a few lines
      // further down the same tick, where it can be paid to somebody rather than
      // burned. Leaving it true here would charge the loser twice.
      const stake = !isArena(p.mapId);
      const lost = stake ? { ...p.hold } : {};
      if (stake) {
        for (const [m, n] of Object.entries(p.hold)) drop(p.mapId, p.ship.x, p.ship.y, m, n);
        p.hold = {};
      }
      // The cargo was the only stake, so flying empty made a wreck a free ride
      // home. A tenth of the credits goes down with the ship.
      const toll = stake ? tollOn(p.credits) : 0;
      p.credits -= toll;
      p.dead = true;
      p.targetId = null; p.want = null; p.scoop = null; p.contacts.clear();
      dropRocketsAt(p.mapId, p.ship);
      for (const list of aliens.values()) forgetPlayer(list, id);   // death settles every grudge
      Object.assign(p.ship, { vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, charge: 0, chargeTo: null, snare: 0, calm: 0 });
      touch(p);                                   // a lost hold must survive a hard kill
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'dead', lost, toll, where: p.mapId }));
      continue;
    }

    const dest = stepJump(p.ship, mapOf(p.mapId), dt);
    if (!dest) continue;
    // THE WAY HOME OUT OF A DUEL. The first portal any instanced sector has ever
    // had, and its destination differs per pilot — each of them comes out at their
    // own hangar — so it names a sentinel rather than a map. `MAPS['@home']` is
    // undefined and the line below would have thrown on `.portals`, which is the
    // black screen the client's `map.portals.length` guard was written for, this
    // time on the server.
    //
    // Taking it while the other pilot is still standing is a FORFEIT: leaveArena
    // puts them at their own dock, the sweep sees the empty seat on the next tick,
    // and the stake is paid at the spot they left from. That is what stops the
    // portal being a free way out of a fight you are losing.
    if (dest === HOME_TO) {
      dropRocketsAt(p.mapId, p.ship);
      leaveArena(p, 'you took the way out');
      continue;
    }
    const a = arrivalFor(p.mapId, MAPS[dest]);
    dropRocketsAt(p.mapId, p.ship);              // nothing follows you through a portal
    p.mapId = dest;
    p.contacts.clear();
    p.targetId = null;             // jumping out breaks the engagement
    p.want = null; p.scoop = null;
    Object.assign(p.ship, { x: a.x, y: a.y, vx: 0, vy: 0, tx: null, ty: null, dx: null, dy: null, jumpCd: JUMP_CD, charge: 0, chargeTo: null, snare: 0, calm: 0 });
    touch(p);
    sendMap(p);
  }

  // --- hostiles -------------------------------------------------------------
  for (const [mapId, list] of aliens) {
    const map = mapOf(mapId);
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
    // Bosses are in this now, and that reverses a call I made when it went in.
    //
    // The argument for leaving them out was that a Hive's five minutes is a
    // statement about how often the event should happen. The argument against it is
    // what it actually produced: one Hive to a deep sector and nothing else posted
    // there at all, so killing it left the map COMPLETELY EMPTY for five minutes.
    // An event nobody can find is not an event, and a sector with nothing in it is
    // not content. Scarcity is the seeded count's job — there are two now — and the
    // respawn's job is that the place you flew to still has something in it.
    //
    // Escorts stay out: a brooded Bandit is not a fixture of the sector, it is
    // something the Hive made, and it is `gone` when it dies rather than respawned.
    const alive = new Map(), total = new Map();
    for (const a of list) {
      if (a.spawned) continue;
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
    const refill = a => a.spawned ? 1
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
      // A pair hunts one pilot. Before stepAlienAI rather than after, so the AI
      // validates the handover this tick the same way it validates any other target —
      // an inherited one is kept on LEASH (2,600) rather than on aggro (540), which is
      // exactly what makes "pull one and you have pulled both" true at the range a
      // pilot actually opens fire from.
      //
      // It hands over the target and NOT the grudge. The Hive's brood block does add
      // to `provoked`, and it is right to: an escort is launched at somebody who has
      // already found the Hive. Here the mate may never have been shot at, and
      // provocation is what overrides sanctuary — so copying it would let a Doldrum
      // follow into a portal mouth somebody its Crucible was cross with. mayHarm()
      // still holds for anyone who has not pulled the trigger.
      //
      // This is where they fly, not what they do. Neither of them can see the other's
      // ground, its wind-up or its cooldown, and the combo still works only because
      // both sow at their victim's feet.
      if (a.mate !== undefined && a.target === null) {
        const mate = list.find(x => x.id === a.mate && x.dead <= 0 && x.hp > 0);
        if (mate && mate.target !== null && mate.target !== undefined) a.target = mate.target;
      }
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
      // The fix, and it runs BEFORE the hull is stepped rather than after it. That is
      // not tidiness: planting a Kedge means clearing the course stepAlienAI has just
      // set, and a plant written after step() is a plant that never happens — the next
      // tick sets the course again before anything moves. Measured with it in the
      // wrong place, a Kedge chased at full speed through every sighting, which turns
      // the toll below into a hostile no hull in the game can leave.
      //
      // Resolved before the fix rather than after the step: the Kedge needs to know
      // who it is looking at in order to plant itself, and `const` in a temporal
      // dead zone is a runtime crash that `node --check` cannot see.
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      // It takes a sighting of where its target is standing and three seconds later
      // puts them back on it — see shared/kedge.js for why holding station through
      // the fuse is the whole of what makes that a toll on leaving rather than a
      // trap. Sanctuary is the SAME `haven` the AI was just handed rather than a
      // second lookup, for the reason the tether below says: one predicate, one
      // answer.
      if (fixOf(a.def)) {
        const held = victim ? fixHolds(a, victim.ship, victim.haven) : false;
        const snap = stepFix(a, victim?.ship ?? null, held, dt);
        if (fixWinding(a)) { a.tx = a.ty = a.dx = a.dy = null; }
        // Re-checked on the tick it fires, not only on the tick it started: three
        // seconds is exactly a portal's spool, and reaching one has to be the answer
        // rather than a delay.
        //
        // No flash is pushed for the arrival, deliberately. A blast is this game's
        // "something died here", and firing one at a pilot who is merely somewhere
        // else would play an explosion in their ears. The tell is the marker: it
        // tightens for three seconds over the exact spot, and then the hull is in it.
        if (snap && victim && victim.ship.hp > 0 && mayHarm(a, victim)) {
          const hauled = collapseTo(victim.ship, snap.to);
          // And it bills for the ground it undid. A pilot who stood still through
          // the sighting pays nothing, because there was nothing to drag them back
          // over — the cost is the distance, not the fix.
          const took = haulCost(hauled.px, poolOf(victim.ship));
          if (took > 1) {
            const split = applyDamage(victim.ship, took);
            hits.get(mapId).push({ x: victim.ship.x, y: victim.ship.y - victim.ship.r - 6,
                                   n: took, sh: split.hull === 0, by: null, t: HIT_TIME, ttl: HIT_TIME });
          }
        }
      }
      step(a, dt, boundsOf(map)); stepDrift(a, dt, 0, map); stepVitals(a, dt, false); stepAlienRepair(a, dt);
      // Breaking means turning, and turning is what takes its nose off you. The
      // camouflage and the evasion are the same mechanic from two sides.
      if (breaking && Math.hypot(a.vx, a.vy) > 20) a.heading = jinkHeading(a, victim?.ship);
      else faceTarget(a, victim?.ship);
      // A mirror's chamber. It fills with what you deal it and bleeds continuously,
      // and the payload IS its damage stat while it is charged — so fire() needs no
      // idea this exists and a heavier bolt is already drawn heavier. It is stepped
      // BEFORE fire() and never emptied by it: the chamber is a charge level, not a
      // magazine, which is what makes the meter over its head fall while a pilot
      // holds fire instead of flicking back to zero once a shot has gone.
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
      // Ground. It winds up visibly and then a patch lands where its target was
      // STANDING when the wind-up began — see shared/ground.js for why that is the
      // dodgeable end of the choice, and why the wind-up is exactly as long as a hold.
      //
      // Sanctuary is gated on the SAME `haven` the AI was just handed rather than on a
      // second lookup, the way the tether and the fix above both are: one predicate,
      // one answer. Two copies of "where is it safe to stand" is exactly how the
      // workshop dock ended up refusing to sell anything for a day.
      //
      // Placed after fire() rather than before it because sowing is what these
      // hostiles do INSTEAD of shooting, and reading it in that order is what makes
      // the ordering obvious to whoever adds the third one.
      if (sowOf(a.def)) {
        const may = victim ? sowHolds(a, victim.ship, victim.haven) : false;
        const drop = stepSow(a, victim?.ship ?? null, may, dt);
        // A definition may not have more patches alive than it says. The OLDEST goes
        // rather than the newest being refused: refusing would mean a Crucible that had
        // saturated the field stopped doing the only thing it does, and a pilot could
        // farm one from a corner it had already used up.
        if (drop) {
          const here = sown.get(mapId);
          const mine = here.filter(g => g.owner === a.id);
          if (mine.length >= (a.def.sow.max ?? 1)) {
            const oldest = mine.reduce((w, g) => (g.t < w.t ? g : w));
            here.splice(here.indexOf(oldest), 1);
          }
          here.push(Object.assign(groundFor(a, drop.at), { id: groundId++, owner: a.id }));
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
    // The countdown again, and this is the third place it is held: refusing the
    // `target` message stops a NEW target being named, but a target named before
    // the fold would otherwise keep firing through the whole five seconds.
    if (duelLocked(p)) { fire(p.ship, null, dt); launch(p.ship, null, dt); continue; }
    const other = duelFoe(p);
    // A hostile, or — only inside a duel — the other pilot. `stepBolts` and
    // `stepRockets` resolve their target by object identity against anything with
    // {x, y, r, hp}, which a player's ship has always had, so nothing in
    // shared/combat.js or shared/rockets.js had to learn what a player is.
    const foe = p.targetId
      ? ((aliens.get(p.mapId) ?? []).find(a => a.id === p.targetId && a.dead <= 0 && a.hp > 0)
         ?? (other && other.id === p.targetId ? other.ship : null))
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
    // A player's ship has no grudge to hold — `provoked` and `target` are an
    // alien's bookkeeping, and reading them off a hull would be `undefined.add`.
    if (!foe.isAlien) continue;
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
    // A bond goes onto the balance instead of into the hold — a duel's purse. It is
    // the only pod in the game that pays credits, and stepScoop hands the number
    // back rather than banking it, because shared/cargo.js does not know what an
    // account is.
    if (r.cr > 0) {
      p.credits += r.cr;
      note(p, `${r.cr.toLocaleString('en-US')} cr recovered`);
    }
    if (r.took || r.cr > 0) touch(p);
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
        if (inHaven(mapOf(mapId), p.ship) || !inPyre(py, p.ship)) continue;
        const took = py.dmg * poolOf(p.ship);
        const split = applyDamage(p.ship, took);
        hits.get(mapId).push({ x: p.ship.x, y: p.ship.y - p.ship.r - 6, n: took,
                               sh: split.hull === 0, by: null, t: HIT_TIME, ttl: HIT_TIME });
      }
    }
  }
  // Ground. In the same pass the pyres are settled in, and for the same reason: it
  // runs after every hull in the sector has moved, so "who is standing in this" is
  // asked of where everybody actually IS rather than of where they were before the
  // tick. A ship the ground kills is settled by the wreck block at the top of the
  // next tick, exactly the way a ship a bolt kills is — nothing here has to know what
  // dying costs.
  //
  // The engines-out it hands out is read by step() on the NEXT tick, 33ms later. That
  // is deliberate and it is the only order that works: applying it before the ships
  // had moved would snare a pilot for crossing a rim they had not crossed yet.
  for (const [mapId, list] of sown) {
    for (let i = list.length - 1; i >= 0; i--) if (!stepGround(list[i], dt)) list.splice(i, 1);
    if (!list.length) continue;
    const map = mapOf(mapId);
    for (const [id, p] of players) {
      if (p.mapId !== mapId || p.dead || p.lobby || p.ship.hp <= 0) continue;
      const haven = inHaven(map, p.ship);
      let worst = 0, grab = 0;
      for (const g of list) {
        // Sanctuary, and it is TWO rules on purpose because they answer two different
        // questions.
        //
        // The BURN goes through mayHarm() — the same predicate stepAlienAI targets
        // with — so a pool cannot cook somebody parked in a portal mouth who never
        // touched the thing, and it CAN reach somebody who shot it and ran there.
        // `g.by` is the sower's provoked set by reference, so that answer keeps being
        // right for the thirty seconds a pool outlives the Crucible that laid it.
        //
        // The HOLD does not. Sanctuary is refused to a still outright, provoked or
        // not, and that is shared/kedge.js's rule rather than a new one: fixHolds()
        // has broken on a haven since the day it was written, with no provocation
        // exception, because taking a pilot's position away from them inside a portal
        // mouth is taking the mouth away from them. A pool that burns you there is a
        // price you chose to stand in. A still that holds you there is a door shut.
        const inside = inGround(g, p.ship);
        const bit = groundBite(g, id, p.ship, inside && mayHarm({ provoked: g.by }, { id, haven }),
                               poolOf(p.ship), dt);
        // Patches do NOT stack. A ship standing where two pools overlap takes the
        // worse of them and not the sum — which is what stops six of a Crucible's own
        // patches being a delete button, and it is the same claim threatDps makes when
        // it counts a sower's rate once rather than `max` times.
        if (bit.burn > worst) worst = bit.burn;
        if (bit.hold > grab && !haven) grab = bit.hold;
      }
      if (worst > 0) {
        const split = applyDamage(p.ship, worst);
        p.sear = (p.sear ?? 0) + worst;
        // One floating number a second rather than thirty, the same as a Censer's
        // field: a rate that printed every tick buried the screen and said nothing
        // anybody could read.
        if ((p.searT = (p.searT ?? 0) + dt) >= BITE_TELL) {
          hits.get(mapId).push({ x: p.ship.x, y: p.ship.y - p.ship.r - 6, n: p.sear,
                                 sh: split.hull === 0, by: null, t: HIT_TIME, ttl: HIT_TIME });
          p.sear = 0; p.searT = 0;
        }
      }
      if (grab > 0) holdEngines(p.ship, grab);
    }
  }
  // Rebuild the sightings from whoever is actually holding one. Placed here, in the
  // same pass the pyres are settled in, so a fix and the hostile that owns it can
  // never be a frame apart.
  for (const [mapId, list] of aliens) {
    const here = fixes.get(mapId);
    here.length = 0;
    for (const a of list) {
      if (a.dead > 0 || !fixWinding(a)) continue;
      const who = players.get(a.target);
      if (!who || who.mapId !== mapId) continue;
      here.push({ x: a.fixAt.x, y: a.fixAt.y, r: who.ship.r, p: a.fix, who: a.target });
    }
  }
  for (const [, list] of blasts)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);
  for (const [, list] of hits)
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);

  // --- claims ---------------------------------------------------------------
  //
  // ONE SWEEP, NOT A LIST OF EXITS. Every way out of an arena — clearing it, being
  // destroyed in it, a Recall Beacon, /tp, closing the tab, being signed in from
  // another tab, the process deciding fifteen minutes is enough — is the same fact
  // from here: nobody is standing in it any more. The first draft enumerated the
  // exits instead and had already missed two of them (the beacon, and a second tab
  // taking the account over) before it was written down. An arena that outlives its
  // pilot is a sector full of hostiles nobody will ever see, stepped thirty times a
  // second, forever.
  // Challenges lapse on their own. A pilot who never answers is answering; the line
  // goes away and the challenger is told, so nobody is left waiting on a screen for
  // something that has already expired. Lapsing starts the same cooldown a refusal
  // does — ignoring somebody twice a minute is the same interruption as being
  // refused twice a minute.
  for (const [to, c] of [...challenges]) {
    if ((Date.now() - c.at) / 1000 < CHALLENGE_TTL) continue;
    challenges.delete(to);
    cooling.set(`${c.from}>${to}`, Date.now() + CHALLENGE_CD * 1000);
    note(byToken(c.from), 'your challenge lapsed — no answer');
    note(byToken(to), 'the challenge lapsed');
  }

  // A pending duel that never completed. Both folds are the same length and start on
  // the same tick, so the only way one side never arrives is that the pilot stopped
  // existing — a closed tab, a second session taking the account over. Without this
  // the survivor waits in `pending` forever with `duelWith` still set, which is a
  // pilot who can never duel again and nothing anywhere saying why. Half a second
  // past the fold is long enough that a normal rendezvous is never caught by it.
  for (const [pid, pend] of [...pending]) {
    pend.since = pend.since ?? Date.now();
    if ((Date.now() - pend.since) / 1000 < FOLD_SECS + 1.5) continue;
    callOffDuel(pid, 'the duel is off — the other pilot never arrived');
  }

  for (const [aid, ar] of [...arenas]) {
    // THE GENERALISATION, and it is one word. It was "is the OWNER still standing
    // in this sector"; it is now "is ANY of its seats". A claim has one seat and
    // reads exactly as it always did; a duel has two and closes when the second of
    // them goes, by whatever route and at whatever moment — the portal, a wreck
    // that respawned, a beacon, /tp, a closed tab, a second session taking the
    // account over, the wall. Still no list of exits, for the reason the first
    // draft learned: it enumerated them and had already missed two.
    const seated = sittingIn(aid, ar);
    if (!seated.length) { closeArena(aid); continue; }
    if (ar.duel) { stepDuel(aid, ar, seated, dt); continue; }
    const who = seated[0];

    const left = leftIn(aid);
    if (!ar.cleared && left === 0) {
      ar.cleared = true;
      ar.leaveIn = LINGER;
      // A replay writes nothing down. The rock is already theirs, and a claim that
      // could be re-won would be a claim that could be re-lost.
      if (!ar.replay && !who.claims.includes(ar.key)) {
        who.claims = [...who.claims, ar.key];
        touch(who);
      }
      if (who.ws.readyState === 1) who.ws.send(JSON.stringify(
        { t: 'freed', key: ar.key, what: MODULES[ar.key].name, secs: LINGER,
          replay: ar.replay ? 1 : 0 }));
    }
    if (ar.cleared) {
      // No portals, so there is nothing to fly to: an automatic return is the only
      // honest way out of a claim you have won. The linger is so the rock can be
      // watched coming apart rather than snatched away on the last kill.
      if ((ar.leaveIn -= dt) <= 0) leaveArena(who, ar.replay
        ? `${MODULES[ar.key].name} — cleared again. Nothing paid, nothing lost.`
        : `${MODULES[ar.key].name} is yours — build it at your station`);
      continue;
    }
    // The wall. A pilot parked in a corner of a claim is not stuck — nothing in
    // here heals and they can always die — but the sector they are holding open
    // has no other way to close. Fifteen minutes is nine times the longest clear
    // measured, so nothing that is actually a fight is ever cut short by it.
    if ((Date.now() - ar.opened) / 1000 > LIMIT)
      leaveArena(who, 'the claim held. Come back with a better ship.');
  }

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
      guns: p.ship.guns ?? 1, lvl: levelFor(p.xp).level, drones: p.ship.bays ?? p.ship.drones.length,
      form: Math.max(0, FORMATION_KEYS.indexOf(p.ship.formation)),
      dmask: p.ship.drones.slice(0, p.ship.bays ?? p.ship.drones.length)
        .reduce((m2, k, i) => m2 | (EQUIPMENT[k]?.slot === 'weapon' ? 1 << i : 0), 0),
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
      // Whichever dial this hostile has. A Lamprey rides its tether draw here, a
      // Censer its ring spin, a Kedge its fix and a Thresher its chamber; every one
      // is 0..1 and every one has to be visible, because a ring you cannot see
      // widening, a cord you cannot see tighten and a payload you cannot see
      // building are each indistinguishable from a bug — the last one read as a
      // random one-shot for as long as it existed. Everything else sends 0.
      //
      // A mirror's chamber is a SHARE of its own hit points by construction, so it
      // arrives here already 0..1 and there is no normalising constant for the
      // client to be told. That is why it is a share: `abl` is one integer, and a
      // second copy of the scale would be a rule kept twice.
      //
      // WHICH of the five it is is dialOf()'s answer, not a chain of `??` here. It
      // was `a.draw ?? a.spin ?? a.fix ?? a.load ?? 0`, reading the live fields in a
      // fixed order — which silently keeps the first a hostile happens to have, so
      // the second one's dial would never reach the client at all. Nothing throws and
      // nothing is logged; what a pilot sees is a mechanic that is running and
      // invisible, which is precisely what the Thresher's chamber was until 0.54.
      // dialOf reads the DEFINITION, which is static and can be counted, and
      // test/ground.mjs asserts off the same table that no hostile has two.
      abl: Math.round(100 * dialOf(a)), name: '' });
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
    // Your own fix always reaches you, however far you have run from it — the whole
    // point of the thing is that you can see where you are going to be put back to,
    // and it is three seconds of full burn away by definition. Everyone else's is
    // radar-filtered like anything else on the field.
    const sights = (fixes.get(V.mapId) ?? []).filter(fx =>
      fx.who === V.id || Math.hypot(fx.x - V.ship.x, fx.y - V.ship.y) <= reach);
    const extra = { bolts: shown.map(packBolt), rockets: missiles.map(packRocket),
                    blasts: flashes.map(packBlast), pyres: alight.map(packPyre),
                    fixes: sights.map(fx => packFix(fx, fx.who === V.id)),
                    hits: numbers.map(h => packHit(h, h.by === vid)) };
    // Every station in this sector, and which one is theirs. Not radar-filtered:
    // the radar rule keeps an enemy you have not DETECTED off the wire, and a lab
    // is furniture in a haven — one popping into being at 2200px would read as a
    // bug rather than as stealth.
    const yardHere = labs.get(V.mapId) ?? [];
    // Ground is drawn from OUTSIDE its own radius, exactly the way a pyre is: you have
    // to be able to see the thing you are deciding not to fly into, and a 420px still
    // that appeared once your nose was already over the rim would be the one hazard in
    // the game with no tell at all.
    const field = (sown.get(V.mapId) ?? []).map(g => ({
      id: g.id, x: g.x, y: g.y, r: g.r, k: groundK(g.kind), on: 1,
      p: Math.max(0, Math.min(1, 1 - g.t / g.ttl)),
    }));
    // And the ones being laid right now, taken off whoever is holding a wind-up. A
    // pending patch borrows its sower's id, which cannot collide because alien ids
    // start at a million and ground ids start at one — so the ghost has a stable
    // identity for the whole wind-up and vanishes on the tick the real row appears
    // with an id of its own.
    for (const a of aliens.get(V.mapId) ?? []) {
      if (a.dead > 0 || !a.sowAt || !((a.sow ?? 0) > 0)) continue;
      field.push({ id: a.id, x: a.sowAt.x, y: a.sowAt.y, r: a.def.sow.r,
                   k: groundK(a.def.sow.kind), on: 0, p: Math.max(0, Math.min(1, a.sow)) });
    }
    const streams = { ships, pods: new Map(cans.map(c => [c.id, packPod(c)])),
                      labs: new Map(yardHere.map(l => [l.id, packLab(l, l.token === V.token)])),
                      sown: new Map(field
                        .filter(g => Math.hypot(g.x - V.ship.x, g.y - V.ship.y) <= reach + g.r)
                        .map(g => [g.id, packSown(g)])) };
    const bag = { hold: V.hold, cap: V.ship.stats.cargo,
      // Seconds of engines-out left, for the pilot it is happening to. It rides the
      // bag rather than the ship row because the bag is a set difference — anything
      // that is not a stream and not ephemeral is diffed for free — and because
      // SHIP_FIELDS is at 30 of a hard 31. It is 0 for everybody who is not currently
      // coasting, so it is sent once and then never mentioned again.
      snare: +Math.max(0, V.ship.snare ?? 0).toFixed(2),
      credits: V.credits, docked: !!V.docked, vault: V.vault, gear: V.gear,
      // What the station earns per second, and what it has built. `income` moves
      // only when a module is bought, so it costs nothing per tick — and it is
      // what lets the client run the counter up smoothly between banks without
      // inventing money it has not been told about.
      lab: V.lab ? { mods: V.lab.mods, income: incomeOf(V.lab.mods) } : null,
      ammo: V.ammo, using: V.using, armed: V.armed, kits: V.kits, kit: V.kit,
      xp: V.xp, rank: levelFor(V.xp), drones: V.ship.drones,
      // The threat file: what this pilot has killed, and how many. It changes only
      // on a kill, so the bag diff sends it once and then stays quiet.
      kills: V.kills,
      // And which quests those kills have already finished. The threat file draws a
      // progress line from `kills` alone, but whether the reward is IN HAND is a fact
      // about the account rather than about the tally — see shared/quests.js on why
      // the two are allowed to disagree.
      unlocked: V.unlocked,
      // Which rocks are already theirs, so the station panel knows whether the
      // mining row's button says CLAIM or BUY without asking a second question —
      // and so the CLAIMS page knows which ones can be flown again.
      claims: V.claims,
      // The claim they are standing on, or nothing at all. A bag field rather than
      // a stream because it is one small object about the viewer: `bagKeys` is a
      // set difference over the snapshot's own keys, so it is diffed for free and
      // goes quiet between kills. `left` is here because a pilot who cannot see how
      // many are standing cannot tell whether they are winning.
      arena: arenas.get(V.mapId) && !arenas.get(V.mapId).duel
        ? { key: arenas.get(V.mapId).key, left: leftIn(V.mapId),
            total: arenas.get(V.mapId).total, cleared: arenas.get(V.mapId).cleared ? 1 : 0,
            replay: arenas.get(V.mapId).replay ? 1 : 0 }
        : undefined,
      // The duel this pilot is standing in, and it is a READOUT: the client draws
      // `count` and does not run a clock of its own, because a client that lied
      // about the countdown would gain nothing anyway — every intent it could send
      // is refused server-side while this is above zero. A bag field rather than a
      // stream for the same reason `arena` is one: it is one small object about the
      // viewer, so the set difference diffs it for free and it goes quiet between
      // changes. Absence is information — the delta reports it gone and the bar
      // comes off the screen.
      duel: duelIn(V)
        ? { count: +(duelIn(V).count ?? 0).toFixed(2),
            foe: duelIn(V).name?.[duelIn(V).seats.find(t => t !== V.token)] ?? '',
            // Who to aim at. It is on the wire rather than inferred from "the other
            // ship in the sector" because inference is a second copy of the rule,
            // and a duel where one pilot is dead has one ship in it.
            id: byToken(duelIn(V).seats.find(t => t !== V.token))?.id ?? 0,
            // Seconds left before it is called a draw, rounded to WHOLE seconds and
            // that is not cosmetic. The bag is a set difference: any field that
            // changes re-sends the object, so a float here would put this on the
            // wire thirty times a second for the whole five minutes. Rounded, it
            // moves once a second — and a clock nobody reads to two decimals has no
            // use for the other twenty-nine.
            left: Math.max(0, Math.ceil(DUEL_LIMIT - (Date.now() - duelIn(V).opened) / 1000)),
            over: duelIn(V).over ? 1 : 0,
            draw: duelIn(V).over?.draw ? 1 : 0,
            won: duelIn(V).over && duelIn(V).over.winner === V.token ? 1 : 0 }
        : undefined,
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
      // How long until they start coming back, or absent when there is nothing to
      // wait for. Rounded to a TENTH on purpose: the bag is diffed per connection,
      // so an unrounded countdown is a new value on all thirty ticks a second —
      // pure churn for a number a person reads at about ten.
      //
      // Measured over one 4s countdown on a real socket, unrounded against
      // rounded: 117 messages carried it (29.7/s, one every tick) and 3,651 bytes
      // of field text, against 40 messages (10.3/s) and 672 bytes. 927 B/s down to
      // 172 while a countdown is live, per player, and what it costs is 50ms of
      // staleness on a readout that only ever shows one decimal. Same trick and
      // same reason as the deeps' ground patches fixing their progress to two
      // decimals, which took them 4.52 KiB/s to 0.55.
      //
      // In the viewer's own bag rather than on the ship row for the reason `plate`
      // is: nobody else may know how long your shields have been down, and
      // SHIP_FIELDS is at 30 of a hard 31. It goes AWAY entirely when there is
      // nothing to wait for, and sits at a plain 0 for as long as the shields are
      // actually climbing — one change each, then silence. The HUD draws nothing
      // for either, because at zero the moving bar is the better readout.
      shieldWait: waitField(V),
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
