// The deeps, against a REAL server over a REAL socket.
//
// Not in `npm test`: it boots the game, sweeps two sectors looking for hostiles and
// stands in their ground for a minute and a half, which is not what a test suite is
// for. It is here for the same reason test/wire-live.mjs is — rule four says tests
// passing is not the same as the game working, and the things it checks are the ones
// that only exist once a socket is involved: that a patch reaches a client at all,
// that the wind-up arrives before the ground does, that the engines-out clock survives
// the bag diff, and that no hold outlasts 1.5 seconds on a real clock rather than a
// simulated one.
//
//     node test/deeps-live.mjs
//
// It runs the server in a sandbox under the system temp directory on a port the
// kernel picks, so the world you play in is untouched and it cannot collide with
// anything else somebody has running.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { newBase, absorbFull, decodeDelta } from '../shared/delta.js';
import { unpackShip, unpackSown } from '../shared/net.js';
import { ALIENS } from '../shared/aliens.js';
import { HOLD } from '../shared/ground.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
// A FREE port, asked of the operating system rather than picked. Other agents have
// servers up on this box and a collision turned fourteen assertions red for the wrong
// reason once already — bind to 0, read what the kernel gave you, let it go, and hand
// that to the child. The window between close and listen is a race in theory and has
// never lost in practice; a fixed number loses reliably.
const PORT = await new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const fails = [];
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${d ? `  — ${d}` : ''}`); if (!ok) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-deeps-'));
fs.mkdirSync(path.join(SAND, 'data'));
for (const d of ['public', 'shared', 'node_modules']) fs.symlinkSync(path.join(ROOT, d), path.join(SAND, d));
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')],
  { cwd: SAND, env: { ...process.env, PORT: String(PORT), DEV_ADMIN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} fs.rmSync(SAND, { recursive: true, force: true }); });

// Wait for the listen line rather than guessing at a sleep — a socket opened before
// the server is up is an ECONNREFUSED with no diagnosis in it.
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('server never listened')), 15000);
  srv.stdout.on('data', b => { if (String(b).includes('http://localhost')) { clearTimeout(to); res(); } });
});

const P = { wire: newBase(), last: null, snaps: [] };
P.ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
const send = o => P.ws.readyState === 1 && P.ws.send(JSON.stringify(o));
const chat = t => send({ t: 'chat', text: t });
const ready = new Promise(r => { P._ready = r; });
P.ws.on('open', () => send({ t: 'join', name: 'Deeps' + Date.now() % 9999, co: 'm' }));
P.ws.on('message', raw => {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.t === 'welcome') { P.id = m.id; P._ready(); return; }
  if (m.t === 'map') { P.wire.ready = false; P.mapId = m.map; return; }
  if (m.t === 'd') { if (!P.wire.ready) return send({ t: 'need' }); m = decodeDelta(P.wire, m); }
  else if (m.t === 's') absorbFull(P.wire, m);
  else return;
  P.last = m; P.snaps.push(m);
});

const me = () => (P.last?.ships ?? []).map(unpackShip).find(s => s.id === P.id);
const foes = () => (P.last?.ships ?? []).map(unpackShip).filter(s => s.co === 'x');
const ground = () => (P.last?.sown ?? []).map(unpackSown);

await ready;
console.log('\nA REAL SERVER, A REAL SOCKET — the deeps at four hops, on port ' + PORT + '\n');

chat('/money 50000000'); await wait(250);
chat('/ship bulwark');   await wait(250);
chat('/gear');           await wait(250);

// --- who lives where, found by flying rather than assumed --------------------
// A deep sector is 12,000 x 8,000 and a Bulwark's radar is a fraction of that, so
// "the sector is populated" has to be answered by sweeping it the way a pilot would.
// Where the sweep last saw each kind, so a later leg can fly straight there instead
// of hunting for something that kills it on the way.
const seenAt = new Map();
const sweep = async (map, secs = 60) => {
  chat('/tp ' + map); await wait(1200);
  const seen = new Map();
  const stops = [[1500, 1500], [4000, 1500], [8000, 1500], [10500, 1500], [10500, 4000], [10500, 6500],
                 [8000, 6500], [4000, 6500], [1500, 6500], [1500, 4000], [6000, 4000], [6000, 2500], [6000, 5500]];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < secs * 1000) {
    send({ t: 'intent', mode: 'pt', x: stops[i % stops.length][0], y: stops[i % stops.length][1] });
    i++;
    for (let k = 0; k < 26; k++) {
      await wait(140);
      for (const f of foes()) { seen.set(f.id, f.hull); seenAt.set(f.hull, { x: f.x, y: f.y }); }
    }
  }
  return seen;
};
const deep = await sweep('d1');
check('the deeps hold two Crucibles and two Doldrums, and nothing else',
  [...deep.values()].filter(v => v === 'crucible').length >= 2 &&
  [...deep.values()].filter(v => v === 'doldrum').length >= 2 &&
  [...new Set(deep.values())].every(v => ['crucible', 'doldrum'].includes(v)),
  `d1: ${[...deep.values()].sort().join(', ')}`);
const gate = await sweep('g1');
check('and the Corsair Hive has moved to the gates, beside the Thresher and the Kedges',
  [...gate.values()].filter(v => v === 'hive').length >= 2 &&
  [...new Set(gate.values())].includes('thresher') && [...new Set(gate.values())].includes('kedge'),
  `g1: ${[...new Set(gate.values())].sort().join(', ')} — ` +
  `${[...gate.values()].filter(v => v === 'hive').length} Hives, nothing posted alone`);

// --- the mechanics, in the real sector ---------------------------------------
//
// d1 rather than /dev. The firing line has all twelve hostiles inside 600px of each
// other, so flying up to a Crucible there puts you inside a Thresher, a Hive and a
// Leviathan as well — measured, a bare Bulwark went from 100% to 31% of hull in four
// seconds and it was almost none of it the ground. The deeps hold four things and
// none of them shoot.
// A bare Bulwark that flew a sweep of a gate sector met two Threshers, four Kedges
// and two Hives with no gun and no research, and is a wreck. You choose when to go
// back out, so somebody has to choose.
if (!me()) { send({ t: 'respawn' }); await wait(1500); }
chat('/tp d1'); await wait(2000);
chat('/heal');  await wait(600);
if (!me()) { send({ t: 'respawn' }); await wait(1500); chat('/tp d1'); await wait(1800); }
console.log(`     back in ${P.mapId}, ship row ${me() ? 'present' : 'MISSING'}, ` +
            `${foes().length} hostiles in radar`);
const at = id => (P.last?.ships ?? []).map(unpackShip).find(s => s.id === id);
const anyOf = hull => (P.last?.ships ?? []).map(unpackShip).find(s => s.co === 'x' && s.hull === hull);

// Close to inside its aggro (540) rather than shooting it. `/ship bulwark` grants a
// hull and nothing to hang on it, so this pilot has no gun to provoke anybody with —
// being NOTICED has to be what starts the fight, which is also the honest test of
// stepAlienAI on a hostile whose weaponRange is zero.
const closeTo = async (hull, secs, goTo = null) => {
  const seen = { ghost: false, live: false, abl: 0, kinds: new Set(), hp0: null, hpLow: null,
                 snare: 0, holds: 0, longest: 0, gaps: [] };
  let target = anyOf(hull);
  if (!target && goTo) {                          // fly to where the sweep last saw one
    send({ t: 'intent', mode: 'pt', x: goTo.x, y: goTo.y });
    for (let k = 0; k < 260 && !target; k++) {
      await wait(120); target = anyOf(hull);
      if (k % 10 === 0) { chat('/heal'); send({ t: 'intent', mode: 'pt', x: goTo.x, y: goTo.y }); }
      if (!me()) { send({ t: 'respawn' }); await wait(1200); chat('/tp d1'); await wait(1400);
                   send({ t: 'intent', mode: 'pt', x: goTo.x, y: goTo.y }); }
    }
  }
  if (!target) {                                  // go and find one
    for (const [x, y] of [[2000, 2000], [10000, 2000], [10000, 6000], [2000, 6000], [6000, 4000]]) {
      send({ t: 'intent', mode: 'pt', x, y });
      for (let k = 0; k < 60 && !target; k++) { await wait(200); target = anyOf(hull); }
      if (target) break;
    }
  }
  if (!target) return seen;
  const t0 = Date.now(); let wasHeld = false, from = 0, lastEnd = null, healAt = 0;
  while (Date.now() - t0 < secs * 1000) {
    await wait(60);
    // `/ship bulwark` grants a hull and nothing to hang on it, and these two now throw
    // 438 dps each on top of the ground. A pilot with no gun and no research does not
    // live long enough to watch a full cadence, so the observer is kept alive rather
    // than the hostiles made gentler — what is being checked here is the WIRE, not the
    // fight, and the fight is measured in test/ground.mjs against a real build.
    // Healed hard rather than occasionally. On the firing line a bare Bulwark stands
    // inside twelve hostiles at once and 438 dps of these two on top; four seconds
    // between heals was not enough and the observer kept dying mid-wind-up, which
    // reads as "the mechanic never fired" when what happened is the pilot left.
    if (Date.now() - healAt > 1200) { chat('/heal'); healAt = Date.now(); }
    const live = at(target.id) ?? target;
    const m2 = me();
    // hull AND shield. A pool burns whatever is standing in it, shields included —
    // the Censer's rule — so watching `hp` alone reads 100% while the bubble is being
    // eaten, which is the thing that actually happens first.
    if (m2) { const pool2 = m2.hp + m2.sh;
              seen.hp0 ??= pool2; seen.hpLow = Math.min(seen.hpLow ?? pool2, pool2); }
    // Close to inside its aggro (540) until it has noticed, then BACK OFF to 1,000px
    // and sit there. That band is the layer these two grew when they grew barrels: the
    // gun reaches 900 and the sowing reaches 1,100, so at 1,000 the ground still lands
    // on you and the barrel has stopped. It is also the only way an unarmed, unresearched
    // observer lives long enough to watch a five-second stop happen — measured, closer
    // in it died inside the wind-up and the dial never got past 52 of 100.
    const noticed = (live.tgt ?? 0) !== 0;
    const want = noticed ? 1000 : 380;
    const dx = m2 ? m2.x - live.x : -1, dy = m2 ? m2.y - live.y : 0;
    const dd = Math.hypot(dx, dy) || 1;
    send({ t: 'intent', mode: 'pt', x: live.x + (dx / dd) * want, y: live.y + (dy / dd) * want });
    if ((live.abl ?? 0) > seen.abl) seen.abl = live.abl;
    for (const p of ground()) { seen.kinds.add(p.k); if (p.on === 0) seen.ghost = true; else seen.live = true; }
    const sn = P.last?.snare ?? 0;
    if (sn > 0) {
      seen.snare = Math.max(seen.snare, sn);
      if (!wasHeld) { seen.holds++; from = Date.now(); if (lastEnd) seen.gaps.push((Date.now() - lastEnd) / 1000); }
      seen.longest = Math.max(seen.longest, (Date.now() - from) / 1000);
      wasHeld = true;
    } else if (wasHeld) { wasHeld = false; lastEnd = Date.now(); }
  }
  return seen;
};

const V = await closeTo('crucible', 40);
check('a Crucible lays ground over the wire, and the marker comes before the patch',
  V.ghost && V.live, `both phases seen on a real socket; ${ground().length} patches standing at the end`);
check('the wind-up rides `abl` on the hostile row, with no new ship field',
  V.abl > 0 && V.abl <= 100, `abl peaked at ${V.abl} of 100 — draw, spin, fix, load, sow, all one integer`);
check('and standing in White Heat costs the ship, shields first, as a share',
  V.hpLow < V.hp0, `hull + shield went ${V.hp0} -> ${V.hpLow} (of 200) parked in it — a field ` +
  'burns whatever is standing in it, which is the Censer\'s rule one rung out');

chat('/heal'); await wait(400);
// The still leg flies to a REMEMBERED position rather than searching for one, and the
// reason is the change itself. A deep sector is 12,000 x 8,000 and a bare Bulwark with
// no gun now dies to 438 dps and a pool taking 4.5% of it a second, so a pilot that
// has to go looking dies several times on the way and every death puts it in a company
// ring. The sweep above already saw where everything was standing; this uses that.
//
// The firing line was the other option and it is worse: /dev posts twelve hostiles
// inside 600px of each other, so an observer there is being shot by all of them and
// dies mid-wind-up — measured, the Doldrum's dial never got past 36 of 100 because
// its victim kept ceasing to exist.
chat('/tp d1'); await wait(1600);
if (!me()) { send({ t: 'respawn' }); await wait(1300); chat('/tp d1'); await wait(1600); }
chat('/heal'); await wait(400);
const D = await closeTo('doldrum', 80, seenAt.get('doldrum'));
console.log(`     the still leg: ${D.holds} stops, abl peaked ${D.abl}`);
check('crossing Slack Water takes the engines, and the wire says so',
  D.snare > 0 && D.snare <= HOLD + 0.05,
  `the bag carried snare=${D.snare.toFixed(2)}s against a ceiling of ${HOLD}s, ${D.holds} times`);
check('and no hold outlasts the stated one, live, on a real clock',
  D.holds === 0 || D.longest <= HOLD + 0.3,
  D.holds ? `longest measured ${D.longest.toFixed(2)}s` : 'never crossed one');
check('and a pilot always gets a full portal spool of thrust back between two of them',
  D.gaps.length === 0 || Math.min(...D.gaps) >= 2.7,
  D.gaps.length ? `${D.gaps.length} gaps, shortest ${Math.min(...D.gaps).toFixed(2)}s against a stated 3s`
                : 'only one hold in the window');
check('both kinds of ground reached the client',
  new Set([...V.kinds, ...D.kinds]).size === 2,
  `kinds seen: ${[...new Set([...V.kinds, ...D.kinds])].map(k => ['white', 'slack'][k] ?? k).join(', ')}`);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — live over the wire'}\n`);
P.ws.close();
process.exit(fails.length ? 1 : 0);
