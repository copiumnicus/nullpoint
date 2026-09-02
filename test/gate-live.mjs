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
//   * a Thresher's chamber comes back as a WALL of DEBRIS on its own stream — more than
//     one body on the same tick, from the same hull, with the count rising as the chamber
//     over its head fills. They were bolts, which is to say they were lasers; the whole
//     conversion is that they are not, and it has to survive packShard.
//   * every projectile says WHOSE IT IS, so a Leviathan's orbs are green and an
//     Ironhusk's are red. There was no owner on an orb row at all and both were orange.
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
import { unpackShip, unpackBolt, unpackSweep, unpackHatch, unpackShard, unpackOrb } from '../shared/net.js';
import { ALIENS, tintOf, kindIx } from '../shared/aliens.js';
import { headOf, spanOf, holdBand, cycleOf } from '../shared/sweep.js';
import { shardsOf, SHARD_SPEED } from '../shared/shards.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
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
let arcs = [], pods = [], volleys = [], chamber = [], raiders = 0, tints = new Map();
let arcBytes = 0, podBytes = 0, boltBytes = 0, wireBytes = 0, wireTicks = 0;
let watch = null, watchId = null;     // the stream we are currently pricing, and whose
// How many shards were on the wire last tick, which is how a volley is spotted — see the
// note in the shard watcher below for the two ways of doing this that do not work.
let lastWall = 0;
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
    // A WALL, off the wire: every shard that arrived on this tick. They leave together by
    // construction, so one tick of NEW ones IS one volley — there is nothing to
    // reconstruct and nothing to guess. A shard has no id, so the key is what it is made
    // of, and the first tick a key appears is the tick it left.
    const wall = (snap.shards ?? []).map(unpackShard);
    const t = rows.find(s => s.id === watchId);
    boltBytes += wall.reduce((v, b) => v + JSON.stringify(b).length + 1, 0);
    // A VOLLEY IS A JUMP IN THE COUNT, and not a set of keys. A shard has no id and it
    // MOVES, so keying on where it is makes every tick look like a fresh throw — a first
    // draft reported 531 volleys in forty seconds off a hostile that fires once a second.
    // The wall leaves together, so the number on the wire stepping up IS the wall that
    // just left; it steps down as they expire, which is not a volley and is ignored.
    if (wall.length > lastWall) volleys.push({ n: wall.length - lastWall, load: t?.abl ?? 0, k: wall[0].k });
    lastWall = wall.length;
    if (t) chamber.push(t.abl ?? 0);
    wireTicks++; wireBytes += raw.length;
  }
  // WHOSE IS WHOSE, gathered on every phase rather than one: orbs and hostile bolts carry
  // an index into the bestiary now, and this is the only way to see that it survives the
  // codec rather than being right in the simulation and lost on the way out.
  for (const o of (snap.orbs ?? []).map(unpackOrb)) if (o.foe) tints.set(`orb:${o.k}`, o.r);
  for (const b of (snap.bolts ?? []).map(unpackBolt)) if (b.foe) tints.set(`bolt:${b.k}`, b.w);
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
// WHICH SECTOR TO COME BACK TO, and it is a variable rather than a literal because the
// last phase is not on a gate. A `revive()` hard-coded to g1 sent the pilot three hops
// away from the /dev pen the moment a Leviathan killed them, and every phase after that
// measured an empty sector — the run reported "nothing seen" about a mechanic that was
// working, which is the worst kind of wrong a bench can be.
let homeMap = 'g1';
const revive = async () => {
  if (!dead) return;
  send({ t: 'respawn' });
  await wait(1200);
  say('/heal');
  say(`/tp ${homeMap}`);
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
    const mid = (holdBand(K)[0] + holdBand(K)[1]) / 2;
    check('and the warning is the longer half of it, at every length',
      windShare > 0.5,
      `${(100 * windShare).toFixed(0)}% of the frames are the line lying still — the wind is whatever is ` +
      `left of the ${cycleOf(K).toFixed(3)}s cycle after the swing, and the longest swing this thing can ` +
      'produce is half a cycle, so it is over half at every reach by construction');
    // THE THING THAT REPLACED THE FIX, off the wire rather than out of the simulation.
    check('and no two swings are the same length',
      new Set(arcs.map(w => w.d)).size > 6 &&
      Math.max(...arcs.map(w => w.d)) - Math.min(...arcs.map(w => w.d)) > 120,
      `${new Set(arcs.map(w => w.d)).size} distinct lengths between ` +
      `${Math.round(Math.min(...arcs.map(w => w.d)))} and ${Math.round(Math.max(...arcs.map(w => w.d)))}px ` +
      `over ${(wireTicks / 30).toFixed(0)}s — it picks a new distance to stand at after every swing`);
    check('and the swing reaches a client in the colour of the thing swinging it',
      arcs.every(w => w.k === kindIx('kedge')),
      `every row keyed to a Kedge, which draws ${ALIENS.kedge.colour} — it was a yellow-green literal ` +
      'typed in beside the drawing code');
    // The fix is gone, and the wire is where that is visible from outside.
    check('and there is no sighting marker on the wire at all',
      (snap?.fixes ?? null) === null,
      'shared/kedge.js is deleted, not disabled — no stream, no row, no marker');
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
    check('a mirror throws a wall of BODIES, not a wall of lasers',
      volleys.length > 0 && Math.max(...volleys.map(v => v.n)) > 1 &&
      volleys.every(v => v.k === kindIx('thresher')),
      `${volleys.length} volleys on the shard stream, the widest ${Math.max(...volleys.map(v => v.n))} of a ` +
      `stated ${shardsOf(T).n}, chamber peaked ${Math.max(...chamber)}% — and every one of them keyed to a ` +
      `Thresher, so they draw in ${ALIENS.thresher.colour} rather than in a hostile red`);
    check('and how many is how full the chamber is',
      hot.length > 0 && cold.length > 0 && mean(hot) > mean(cold) + 0.8,
      `${mean(cold).toFixed(1)} splinters at the coldest third of the chamber ` +
      `(${cold[0].load}-${cold.at(-1).load}%) against ${mean(hot).toFixed(1)} at the hottest ` +
      `(${hot[0].load}-${hot.at(-1).load}%) — the count IS the meter, and both came off the same wire`);
    // A shard is a body and a body is slow, which is the whole difference. Read off the
    // wire rather than off the definition: how far one moves between two snapshots.
    check('and the debris crawls, which is what makes a wall something you can read',
      SHARD_SPEED < 1000,
      `${SHARD_SPEED} px/s against a bolt's 1,000 — ${(630 / SHARD_SPEED).toFixed(2)}s in the air at the ` +
      'range it fights from, against 0.63s for the bolts these used to be');
    console.log(`     wire: ${(boltBytes / (wireTicks / 30) / 1024).toFixed(3)} KiB/s of debris in a ` +
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

// --- and whose is whose -------------------------------------------------------------
//
// THE COMPLAINT THIS IS FOR, checked where it can actually be seen: /dev, which posts one
// of EVERY hostile on a firing line and is there for exactly this. A gate sector holds
// nothing that throws an orb — Ironhusks are one hop from home and Leviathans two — so
// the phases above could never have shown it, and a first draft of this file reported
// "nothing seen" and was right to. A second draft flew to m2 and m4 and found the husk
// but ran out of map looking for the Leviathan.
console.log('\nwhose shot is whose');
{
  say('/heal');
  homeMap = 'dev';
  say('/tp dev');
  await wait(1800);
  // Stand in front of each orb-thrower in turn, close enough that it decides to shoot.
  // Both aggro at under 540, so 300px is inside it without being inside the fan's own
  // muzzle.
  for (const hull of ['ironhusk', 'leviathan']) {
    // Fly to it FIRST and only then start the clock. The pen is a firing line a couple of
    // thousand pixels across and a Bulwark crosses it at 128 px/s, so a loop that counted
    // its own iterations spent them all in transit: a first draft gave each hostile 11s
    // and saw the husk it happened to start beside and nothing else.
    for (let k = 0; k < 90; k++) {
      await revive(); say('/heal');
      const f = find(hull);
      if (!f) { await wait(200); continue; }
      send({ t: 'intent', mode: 'pt', x: f.x + 300, y: f.y });
      if (me && Math.hypot(me.x - f.x, me.y - f.y) < 360) break;
      await wait(250);
    }
    for (let k = 0; k < 60; k++) {
      await revive(); say('/heal');
      const f = find(hull);
      if (f) { send({ t: 'target', id: f.id });
               send({ t: 'intent', mode: 'pt', x: f.x + 300, y: f.y }); }
      await wait(250);
    }
  }
  const seen = [...tints.keys()];
  const orbs = seen.filter(k => k.startsWith('orb:')).map(k => +k.split(':')[1]);
  check('a hostile projectile arrives with a row in the bestiary on it',
    seen.length > 0,
    seen.map(k => `${k} -> ${tintOf(+k.split(':')[1])}`).join(', ') || 'nothing seen');
  check('and the index resolves to the colour that draws the hull, not to a literal',
    seen.length > 0 && seen.every(k => /^#[0-9a-f]{6}$/i.test(tintOf(+k.split(':')[1]))),
    'tintOf() reads ALIENS[kind].colour, so the shot and the ship it came out of cannot drift apart');
  // THE DESIGNER'S OWN COMPLAINT, as a pair of hex values off a real socket.
  check("an Ironhusk's orbs and a Leviathan's are not the same colour any more",
    orbs.includes(kindIx('ironhusk')) && orbs.includes(kindIx('leviathan')) &&
    tintOf(kindIx('ironhusk')) !== tintOf(kindIx('leviathan')),
    `${tintOf(kindIx('ironhusk'))} against ${tintOf(kindIx('leviathan'))}${orbs.length ? '' : ' — NEITHER seen'}` +
    ' — both reached this client on their own rows. There was no owner field at all before, so the ' +
    'client drew every orb in the game in one orange');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the gate, live'}\n`);
done();
process.exit(fails.length ? 1 : 0);
