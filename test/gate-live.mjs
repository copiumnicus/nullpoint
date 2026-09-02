// The three hostiles that hold a gate sector, against a REAL server over a REAL socket.
//
// Not in `npm test`: it boots the game, kits a pilot out at a dock, flies three hops
// and stands in front of a Kedge, a Thresher and a Corsair Hive in turn, which is not
// what a test suite is for. It is here for the reason test/deeps-live.mjs,
// test/ring-live.mjs and test/wire-live.mjs are — rule four says tests passing is not
// the same as the game working — and what it checks are the things that only exist
// once a socket is involved:
//
//   * a Kedge's LANCE reaches a client at all, as its own ephemeral row, with the band
//     radius and the head's own radius on it rather than looked up from the hostile;
//     that the wind-up arrives before the swing does; and that the arc actually turns.
//   * a Thresher's chamber comes back as a WALL — more than one foe bolt on the same
//     tick, from the same muzzle, with the count rising as the chamber over its head
//     fills. That is the whole conversion and it has to survive packBolt.
//   * a Hive's POD reaches a client as a keyed row that says where it is going and
//     whether there is a raider inside it, and a Bandit actually appears where a laden
//     one lands rather than beside the mothership.
//   * and what all three cost the wire, measured against the whole stream rather than
//     estimated.
//
//     node test/gate-live.mjs
//
// It runs the server in a sandbox under the system temp directory on a port the kernel
// picks, so the world you play in is untouched and it cannot collide with anything else
// somebody has running. PORT=0 is NOT enough on its own: server.js reads
// `Number(process.env.PORT) || 3000`, so a zero falls through to 3000.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { newBase, absorbFull, decodeDelta } from '../shared/delta.js';
import { unpackShip, unpackBolt, unpackSweep, unpackHatch } from '../shared/net.js';
import { ALIENS } from '../shared/aliens.js';
import { headOf, windOf, swingOf, spanOf } from '../shared/sweep.js';
import { shardsOf } from '../shared/shards.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const n = v => Math.round(v).toLocaleString('en-US');
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const PORT = await new Promise(res => {
  const p = net.createServer();
  p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); });
});
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-gate-'));
fs.mkdirSync(path.join(SAND, 'data'));
for (const d of ['public', 'shared', 'node_modules']) fs.symlinkSync(path.join(ROOT, d), path.join(SAND, d));
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: SAND, env: { ...process.env, PORT: String(PORT), DEV_ADMIN: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
const done = () => { try { srv.kill('SIGKILL'); } catch {} fs.rmSync(SAND, { recursive: true, force: true }); };
process.on('exit', done);
await wait(1800);
console.log(`\nserver on ${PORT}`);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
const base = newBase();
let me = null, myId = null, snap = null, mapId = null, fit = null, dead = false;
// What the three streams put on the wire, and what the whole stream cost while they did.
let arcs = [], pods = [], volleys = [], chamber = [], raiders = 0;
let arcBytes = 0, podBytes = 0, boltBytes = 0, wireBytes = 0, wireTicks = 0;
let watch = null, watchId = null;     // the stream we are currently pricing, and whose
// Every foe bolt we have already counted. A bolt has no id — it is an ephemeral and
// net.js says why — so the key is what it is made of, and the first tick a key appears
// is the tick it left. Counting on `p` instead does not work and it is worth writing
// down: `p` steps by dt/ttl, which is 0.069 at 480px, so a "p < 0.06 is fresh" test
// matches NOTHING at close range and reported four volleys where there were forty.
const seenBolt = new Set();
const send = o => ws.send(JSON.stringify(o));
const say = t => send({ t: 'chat', text: t });
const ready = new Promise(r => ws.on('open', () => { send({ t: 'join', name: 'gatecheck', co: 'm' }); r(); }));

ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { myId = m.id; mapId = m.map; return; }
  if (m.t === 'map') { mapId = m.map; base.map = null; base.ready = false; return; }
  if (m.t === 'fit') { fit = m; return; }
  // Destroyed. It happens — a Thresher's chamber is most of an unresearched ship and a
  // Hive comes with twelve raiders — and every phase below is checking that a MECHANIC
  // reaches the wire rather than that anybody survives it, so the script comes back
  // instead of measuring a wreck.
  if (m.t === 'dead') { dead = true; return; }
  if (m.t !== 's' && m.t !== 'd') return;
  snap = m.t === 's' ? (absorbFull(base, m), m) : decodeDelta(base, m);
  me = (snap.ships ?? []).map(unpackShip).find(s => s.id === myId) ?? me;
  const rows = (snap.ships ?? []).map(unpackShip);
  if (watch === 'sweep') {
    for (const w of (snap.sweeps ?? []).map(unpackSweep)) { arcs.push(w); arcBytes += JSON.stringify(w).length + 1; }
    wireTicks++; wireBytes += raw.length;
  }
  if (watch === 'pod') {
    // ONE mothership's rows. TWO Hives are posted on every gate sector — nothing in this
    // game stands alone — so taking every row reads both of them interleaved, and the
    // "a p that went down is a new throw" reconstruction below then counts a hundred and
    // twenty throws where there were twelve.
    for (const h of (snap.hatch ?? []).map(unpackHatch)) {
      podBytes += JSON.stringify(h).length + 1;
      if (h.id === watchId) pods.push(h);
    }
    // How many raiders are ALIVE right now, which is what `broods.max` is a cap on. A
    // cumulative set counts every Bandit that ever existed, respawns included, and
    // reported 23 against a ceiling of 12 for two motherships doing exactly what they
    // are allowed to.
    raiders = Math.max(raiders, rows.filter(s => s.hull === 'bandit').length);
    wireTicks++; wireBytes += raw.length;
  }
  if (watch === 'shard') {
    // A WALL, off the wire: every foe bolt that arrived on this tick from the same
    // muzzle. They leave together by construction, so one tick IS one volley — there is
    // nothing to reconstruct and nothing to guess.
    const foe = (snap.bolts ?? []).map(unpackBolt).filter(b => b.foe);
    const t = rows.find(s => s.id === watchId);
    if (foe.length) {
      boltBytes += foe.reduce((v, b) => v + JSON.stringify(b).length + 1, 0);
      const fresh = foe.filter(b => !seenBolt.has(`${b.sx}:${b.sy}:${b.ax}:${b.ay}:${b.w}`));
      for (const b of fresh) seenBolt.add(`${b.sx}:${b.sy}:${b.ax}:${b.ay}:${b.w}`);
      if (fresh.length) volleys.push({ n: fresh.length, w: fresh.reduce((v, b) => v + b.w, 0),
                                       load: t?.abl ?? 0 });
    }
    if (t) chamber.push(t.abl ?? 0);
    wireTicks++; wireBytes += raw.length;
  }
});

await ready;
await wait(900);

// Kitted out at the home dock, then three hops in one command.
say('/money 99999999');
say('/ship bulwark');
await wait(300);
send({ t: 'hull', key: 'bulwark' });
await wait(300);
say('/gear emitter5 24');
say('/gear cellD 6');
await wait(500);
send({ t: 'uninstall', slot: 'weapon', index: 0 });
await wait(300);
for (let i = 0; i < 4; i++) send({ t: 'install', item: 'emitter5' });
for (let i = 0; i < 3; i++) send({ t: 'install', item: 'cellD' });
for (let i = 0; i < 10; i++) send({ t: 'buydrone' });
await wait(700);
for (let i = 0; i < 10; i++) send({ t: 'dronefit', index: i, item: 'emitter5' });
await wait(700);
send({ t: 'power', sys: 'weapons' });
say('/tp g1');
await wait(1500);
console.log(`  in ${mapId} with ${fit?.fit?.weapon?.length} guns and ` +
            `${(fit?.drones ?? []).filter(Boolean).length} armed drones`);

const find = hull => (snap?.ships ?? []).map(unpackShip).filter(s => s.hull === hull)[0] ?? null;
const revive = async () => {
  if (!dead) return;
  send({ t: 'respawn' });
  await wait(1200);
  say('/heal');
  say('/tp g1');
  await wait(1400);
  dead = false;
};

// Walk to a hostile and stop `R` away from it, staying alive on the way. A gate sector
// is 12,000px across and the three of them are scattered, so this is a real flight.
//
// R IS INSIDE ITS AGGRO, and that is not a detail. All three of these decide at 540 and
// none of them engages a pilot parked outside it who has not shot first — a first draft
// stood at 640 and 800 and reported a Corsair Hive that threw no pods at all, which
// reads exactly like the mechanic being broken and was a hostile that had not noticed
// anybody.
const goTo = async (hull, R, secs = 90) => {
  for (let k = 0; k < secs * 2; k++) {
    await revive();
    say('/heal');
    const f = find(hull);
    if (!f) { send({ t: 'intent', mode: 'pt', x: 2000 + (k % 6) * 1600, y: 2000 + ((k / 6) | 0) * 1600 }); await wait(500); continue; }
    const d = Math.hypot(me.x - f.x, me.y - f.y);
    if (Math.abs(d - R) < 120) return f;
    const ux = (me.x - f.x) / (d || 1), uy = (me.y - f.y) / (d || 1);
    send({ t: 'intent', mode: 'pt', x: f.x + ux * R, y: f.y + uy * R });
    await wait(500);
  }
  return find(hull);
};

// Hold station in front of one for `secs`, staying alive and staying in range. It is
// the same loop three times, so it is one function: a phase that let the pilot drift
// out of aggro measured a hostile that had stopped fighting.
const hold = async (hull, R, secs) => {
  for (let k = 0; k < secs * 4; k++) {
    await revive();
    say('/heal');
    const f = find(hull);
    if (f) {
      send({ t: 'target', id: f.id });
      const d = Math.hypot(me.x - f.x, me.y - f.y);
      if (Math.abs(d - R) > 150) {
        const ux = (me.x - f.x) / (d || 1), uy = (me.y - f.y) / (d || 1);
        send({ t: 'intent', mode: 'pt', x: f.x + ux * R, y: f.y + uy * R });
      }
    }
    await wait(250);
  }
};

// --- the Kedge's lance ------------------------------------------------------------
console.log('\nthe lance');
{
  const foe = await goTo('kedge', 500);
  check('a Kedge is posted on a gate sector and reaches a client', !!foe,
    foe ? `id ${foe.id} at ${Math.round(foe.x)},${Math.round(foe.y)}` : 'none on the wire');
  if (foe) {
    watch = 'sweep'; watchId = foe.id; arcs = []; arcBytes = 0; wireBytes = 0; wireTicks = 0;
    await hold('kedge', 500, 30);
    watch = null;
    const K = ALIENS.kedge;
    const winding = arcs.filter(w => w.on === 0), swinging = arcs.filter(w => w.on === 1);
    const spans = arcs.map(w => Math.abs(w.e - w.g));
    check('the swing reaches a client as its own row, in both phases',
      winding.length > 0 && swinging.length > 0,
      `${winding.length} frames of a taut line and ${swinging.length} of a head moving, ` +
      `${arcs.length} rows over ${(wireTicks / 30).toFixed(0)}s`);
    check('and the band it draws is the band the server resolves',
      arcs.every(w => w.r === headOf(K)) && arcs.every(w => w.d > 0 && w.d <= K.attrs.weaponRange),
      `head ${headOf(K)}px on every row, paid out between ${Math.round(Math.min(...arcs.map(w => w.d)))} and ` +
      `${Math.round(Math.max(...arcs.map(w => w.d)))}px against a ${K.attrs.weaponRange} reach`);
    check('the arc is the arc the definition states, to two decimal places',
      spans.every(v => Math.abs(v - spanOf(K)) < 0.02),
      `${spanOf(K)}rad on every one of ${arcs.length} rows — the wire carries both ends rather than a span, ` +
      'so which way round it goes is something a pilot can see');
    check('and the head actually crosses it',
      Math.min(...swinging.map(w => w.p)) < 0.15 && Math.max(...swinging.map(w => w.p)) > 0.85,
      `phase ran ${Math.min(...swinging.map(w => w.p)).toFixed(2)} to ${Math.max(...swinging.map(w => w.p)).toFixed(2)}`);
    // The wind-up is most of the attack and it is what the pilot is being shown.
    const windShare = winding.length / arcs.length;
    check('and the warning is the longer half of it',
      Math.abs(windShare - windOf(K) / (windOf(K) + swingOf(K))) < 0.12,
      `${(100 * windShare).toFixed(0)}% of the frames are the line lying still, against the ` +
      `${(100 * windOf(K) / (windOf(K) + swingOf(K))).toFixed(0)}% ${windOf(K)}s of ${(windOf(K) + swingOf(K)).toFixed(2)}s predicts`);
    console.log(`     wire: ${(arcBytes / (wireTicks / 30) / 1024).toFixed(3)} KiB/s of lance in a ` +
                `${(wireBytes / (wireTicks / 30) / 1024).toFixed(2)} KiB/s stream — ` +
                `${(100 * arcBytes / wireBytes).toFixed(1)}%`);
  }
}

// --- the Thresher's wall ----------------------------------------------------------
console.log('\nthe wall');
{
  const foe = await goTo('thresher', 480);
  check('a Thresher is posted on a gate sector and reaches a client', !!foe,
    foe ? `id ${foe.id} at ${Math.round(foe.x)},${Math.round(foe.y)}` : 'none on the wire');
  if (foe) {
    watch = 'shard'; watchId = foe.id; volleys = []; chamber = []; boltBytes = 0; wireBytes = 0; wireTicks = 0;
    await hold('thresher', 480, 40);
    watch = null;
    const T = ALIENS.thresher;
    // Split at the OBSERVED spread rather than at fixed thresholds. How full the chamber
    // gets in a live fight depends on how long the pilot survives, so a "load > 60" test
    // is a coin flip on whether they lasted long enough — it read 5.0 splinters on one
    // run and matched nothing at all on the next, off a chamber that peaked at exactly
    // 60. Thirds of whatever actually happened is the same claim and does not flap.
    const byLoad = [...volleys].sort((a, b) => a.load - b.load);
    const third = Math.max(1, Math.floor(byLoad.length / 3));
    const cold = byLoad.slice(0, third), hot = byLoad.slice(-third);
    const mean = a => a.reduce((v, x) => v + x.n, 0) / Math.max(1, a.length);
    check('a mirror throws more than one thing at a time now',
      Math.max(...volleys.map(v => v.n)) > 1,
      `${volleys.length} volleys, the widest ${Math.max(...volleys.map(v => v.n))} splinters of a stated ` +
      `${shardsOf(T).n}, chamber peaked ${Math.max(...chamber)}%`);
    check('and how many is how full the chamber is',
      hot.length > 0 && cold.length > 0 && mean(hot) > mean(cold) + 0.8,
      `${mean(cold).toFixed(1)} splinters at the coldest third of the chamber ` +
      `(${cold[0].load}-${cold.at(-1).load}%) against ${mean(hot).toFixed(1)} at the hottest ` +
      `(${hot[0].load}-${hot.at(-1).load}%) — the count IS the meter, and both came off the same wire`);
    check('and the volley is still one payload split, not a payload each',
      (() => { const w = volleys.filter(v => v.n > 1);
               return w.length > 0 && w.every(v => v.w / v.n < v.w * 0.9); })(),
      `widest volley carried ${n(Math.max(...volleys.map(v => v.w)))} across its splinters — ` +
      'the drawn width comes off the damage, so a full chamber is a wall of fat bolts rather than one');
    console.log(`     wire: ${(boltBytes / (wireTicks / 30) / 1024).toFixed(3)} KiB/s of hostile bolts in a ` +
                `${(wireBytes / (wireTicks / 30) / 1024).toFixed(2)} KiB/s stream — ` +
                `${(100 * boltBytes / wireBytes).toFixed(1)}%`);
  }
}

// --- the Hive's pod ---------------------------------------------------------------
console.log('\nthe pod');
{
  const foe = await goTo('hive', 500);
  check('a Corsair Hive is posted on a gate sector and reaches a client', !!foe,
    foe ? `id ${foe.id} at ${Math.round(foe.x)},${Math.round(foe.y)}` : 'none on the wire');
  if (foe) {
    watch = 'pod'; watchId = foe.id; pods = []; podBytes = 0; wireBytes = 0; wireTicks = 0;
    await hold('hive', 500, 60);
    watch = null;
    const H = ALIENS.hive;
    // One row per pod, reconstructed the only way a keyed ephemeral-ish stream allows:
    // a `p` that went DOWN is a new throw. Safe here because the flight is 2.75s at the
    // range it stands off to against a 5s cadence, which test/aliens.mjs pins.
    const thrown = [];
    for (const r of pods) {
      const last = thrown.at(-1);
      if (!last || r.p < last.at(-1).p) thrown.push([r]); else last.push(r);
    }
    const laden = thrown.filter(t => t.at(-1).k === 1);
    check('a pod reaches a client, keyed on the mothership that threw it',
      thrown.length > 0 && thrown.every(t => t[0].id === foe.id),
      `${thrown.length} throws over ${(wireTicks / 30).toFixed(0)}s, all keyed ${foe.id}`);
    check('and it says where it is going for the whole flight',
      thrown.every(t => t.every(r => r.tx === t[0].tx && r.ty === t[0].ty)) &&
      thrown.some(t => t.at(-1).p > 0.9),
      `the landing point never moves once it is thrown — ${thrown.filter(t => t.at(-1).p > 0.9).length} of ` +
      `${thrown.length} rode all the way to 1.0 on the wire`);
    check('and whether there is a raider inside it',
      laden.length > 0,
      `${laden.length} of ${thrown.length} throws were laden — an empty one is ordnance and nothing else, ` +
      `which is what keeps a Hive's ${H.attrs.damage} x ${H.attrs.fireRate} honest once the brood is full`);
    check('and a Bandit actually comes out where one lands',
      raiders > 0, `${raiders} raiders alive at the high-water mark`);
    // TWO motherships are posted on every gate sector, so the ceiling a client can see
    // is two broods. It is the per-hive cap the mechanic promises and the bench in
    // test/aliens.mjs pins that one directly; this is the socket's version of it.
    check('and never more of them than the motherships between them are allowed',
      raiders <= H.broods.max * 2,
      `${raiders} alive against ${H.broods.max} x 2 posted motherships`);
    console.log(`     wire: ${(podBytes / (wireTicks / 30) / 1024).toFixed(3)} KiB/s of pod in a ` +
                `${(wireBytes / (wireTicks / 30) / 1024).toFixed(2)} KiB/s stream — ` +
                `${(100 * podBytes / wireBytes).toFixed(1)}%`);
  }
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the gate, live'}\n`);
done();
process.exit(fails.length ? 1 : 0);
