// The Antiphon, against a REAL server over a REAL socket.
//
// Not in `npm test`: it boots the game, kits a pilot out at a dock, flies five hops
// to Nullpoint and stands in front of a boss for a minute, which is not what a test
// suite is for. It is here for the same reason test/deeps-live.mjs and
// test/wire-live.mjs are — rule four says tests passing is not the same as the game
// working — and the four things it checks are the ones that only exist once a socket
// is involved:
//
//   * the ring reaches a client at all, as its own keyed stream, keyed on the
//     hostile's own id;
//   * the wedge that heats is the wedge you are standing on, read off the wire
//     rather than out of the simulation;
//   * a discharge is a bolt on the wire, visibly heavier than the barrel that fired
//     it — the tell has to survive packBolt or there is no tell;
//   * and leaving the sector stops the rows, because the radar rule is enforced on
//     the same `seen` set the ship rows come from and not by a second copy of it.
//
//     node test/ring-live.mjs
//
// It runs the server in a sandbox under the system temp directory on a port the
// kernel picks, so the world you play in is untouched and it cannot collide with
// anything else somebody has running. PORT=0 is NOT enough on its own: server.js
// reads `Number(process.env.PORT) || 3000`, so a zero falls through to 3000.
//
// What it produced, on this machine. A Bulwark with four MK-VI Emitters, three
// E-Cells and ten MK-VI drones, reactor on the guns, at 700px:
//
//   standing still  lost 200 points   101 answers, biggest 2,709
//                   peak per wedge [4 0 0 0 0 0 0 1] at a mean bearing of -25 deg
//   circling        lost   0 points     0 answers
//                   peak per wedge [0 0 0 0 0 0 0 0]
//
// Two wedges warm out of eight, and they are the two the pilot straddled; the other
// six never left zero. Hostile bolt widths on the wire were 711 — its barrel — and
// then 767 through 2,709, which are the answers. One run caught an answer leaving due
// east while the pilot had drifted to -42 degrees, and it went past them.
//
// The zero in the circling row is worth reading carefully: it is not "the answers
// missed", it is that no plate ever reached the one step of wire resolution the ring
// refuses to answer below. A pilot who keeps turning does not get answered at all,
// and that is the mechanic rather than a mercy.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { newBase, absorbFull, decodeDelta } from '../shared/delta.js';
import { unpackShip, unpackPlates, unpackBolt } from '../shared/net.js';
import { ALIENS } from '../shared/aliens.js';
import { dischargeOf } from '../shared/plates.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

// A FREE port, asked of the operating system rather than picked, for the reason
// test/deeps-live.mjs already writes down: other agents have servers up on this box.
const PORT = await new Promise(res => {
  const p = net.createServer();
  p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); });
});
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-ring-'));
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
let me = null, myId = null, snap = null, mapId = null, fit = null;
let rings = [], answers = [], barrels = new Set();
const send = o => ws.send(JSON.stringify(o));
const say = t => send({ t: 'chat', text: t });
const ready = new Promise(r => ws.on('open', () => { send({ t: 'join', name: 'ringcheck', co: 'm' }); r(); }));

ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { myId = m.id; mapId = m.map; return; }
  if (m.t === 'map') { mapId = m.map; base.map = null; base.ready = false; return; }
  if (m.t === 'fit') { fit = m; return; }
  if (m.t !== 's' && m.t !== 'd') return;
  snap = m.t === 's' ? (absorbFull(base, m), m) : decodeDelta(base, m);
  me = (snap.ships ?? []).map(unpackShip).find(s => s.id === myId) ?? me;
  const rows = (snap.plates ?? []).map(unpackPlates);
  if (rows.length) rings.push(rows[0]);
  for (const b of (snap.bolts ?? []).map(unpackBolt)) {
    if (!b.foe) continue;
    barrels.add(b.w);
    if (b.w > ALIENS.antiphon.attrs.damage * 1.5) answers.push(b);
  }
});

await ready;
await wait(900);

// Kitted out at the home dock, then five hops in one command.
say('/money 99999999');
say('/ship bulwark');
await wait(300);
send({ t: 'hull', key: 'bulwark' });
await wait(300);
say('/gear emitter6 24');
say('/gear cellE 6');
await wait(500);
send({ t: 'uninstall', slot: 'weapon', index: 0 });      // the starter MK-I comes out first
await wait(300);
for (let i = 0; i < 6; i++) send({ t: 'install', item: 'emitter6' });
for (let i = 0; i < 6; i++) send({ t: 'install', item: 'cellE' });
for (let i = 0; i < 12; i++) send({ t: 'buydrone' });
await wait(700);
for (let i = 0; i < 12; i++) send({ t: 'dronefit', index: i, item: 'emitter6' });
await wait(700);
send({ t: 'power', sys: 'weapons' });
say('/tp x0');
await wait(1400);
console.log(`  in ${mapId} with ${fit?.fit?.weapon?.length} guns and ` +
            `${(fit?.drones ?? []).filter(Boolean).length} armed drones`);

const findFoe = () => ((snap?.ships ?? []).map(unpackShip)).find(s => s.hull === 'antiphon');
let foe = findFoe();
for (let k = 0; k < 40 && !foe; k++) {
  send({ t: 'intent', mode: 'pt', x: 6000, y: 4000 });
  await wait(500);
  foe = findFoe();
}
check('an Antiphon is posted in Nullpoint and reaches a client',
  !!foe && foe.hp === 100,
  foe ? `id ${foe.id} at ${foe.x},${foe.y}, ${ALIENS.antiphon.attrs.hull + ALIENS.antiphon.attrs.shield} ` +
        'effective hit points — so one percent of its hull bar is 65,000 points' : 'none on the wire');
if (!foe) { console.log('\nFAIL — nothing to fight\n'); done(); process.exit(1); }

const R = 700;
for (let k = 0; k < 120; k++) {
  const f = findFoe();
  if (!f) { await wait(400); continue; }
  send({ t: 'intent', mode: 'pt', x: f.x + R, y: f.y });
  send({ t: 'target', id: f.id });
  await wait(400);
  if (Math.abs(Math.hypot(me.x - f.x, me.y - f.y) - R) < 90) break;
}

const pool = () => (me ? me.hp + me.sh : 0);
async function phase(name, secs, fly) {
  rings = []; answers = []; barrels = new Set();
  const p0 = pool(), peak = new Array(8).fill(0);
  let bear = 0, bn = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    const f = findFoe();
    if (f) { fly(f, (Date.now() - t0) / 1000); send({ t: 'target', id: f.id }); }
    await wait(250);
    for (const r of rings.splice(0)) for (let i = 0; i < 8; i++) peak[i] = Math.max(peak[i], r[`p${i}`] ?? 0);
    if (f) { bear += Math.atan2(me.y - f.y, me.x - f.x); bn++; }
  }
  const mb = bn ? bear / bn : 0;
  const out = { lost: Math.max(0, p0 - pool()), answers: answers.length, peak,
                big: Math.max(0, ...answers.map(a => a.w)),
                wedge: ((Math.round(mb / (Math.PI / 4)) % 8) + 8) % 8, bear: mb * 180 / Math.PI,
                widths: [...barrels].sort((a, b) => a - b) };
  console.log(`     ${name.padEnd(15)} lost ${String(out.lost).padStart(3)} points   ` +
    `${String(out.answers).padStart(3)} answers, biggest ${String(out.big).padStart(5)}   ` +
    `peak per wedge [${peak.join(' ')}]   standing on wedge ${out.wedge} (${out.bear.toFixed(0)} deg)`);
  return out;
}

console.log('\n  standing still, then circling, same gun and same range:');
const anchor = (() => { const f = findFoe(); return { x: f.x + R, y: f.y }; })();
const held = await phase('standing still', 26, () => send({ t: 'intent', mode: 'pt', x: anchor.x, y: anchor.y }));
say('/heal');
await wait(1200);
const round = await phase('circling', 26, (f, t) => {
  const a = t * 0.55;
  send({ t: 'intent', mode: 'pt', x: f.x + Math.cos(a) * R, y: f.y + Math.sin(a) * R });
});

check('the wedge that heats is the wedge you are standing on',
  held.peak[held.wedge] > 0 && held.peak.filter(v => v > 0).length <= 3,
  `[${held.peak.join(' ')}] at a mean bearing of ${held.bear.toFixed(0)} degrees — the two the pilot ` +
  'straddled, and six that never left zero. Read off the wire rather than out of the simulation');
check('a discharge is a bolt on the wire, and visibly heavier than the barrel that fired it',
  held.answers > 0 && held.big > ALIENS.antiphon.attrs.damage * 2,
  `widths on the wire: ${held.widths.join(', ')} — ${ALIENS.antiphon.attrs.damage} is its barrel and ` +
  `everything above is an answer. Biggest ${held.big}, which is a plate at ` +
  `${(100 * held.big / dischargeOf(ALIENS.antiphon, 1)).toFixed(0)}%. boltWidth() draws it fatter for ` +
  'free, so the tell survives packBolt without a field of its own');
check('circling costs less than standing still, over a real socket',
  round.lost < held.lost && round.answers < held.answers,
  `${round.lost} points and ${round.answers} answers circling against ${held.lost} and ${held.answers} ` +
  'standing at the same range with the same gun. The bench says the same thing at the deep shelf: ' +
  '3,376 points a second holding a bearing against 684 circling');

const f3 = findFoe();
console.log(`\n     its hull is at ${f3?.hp}% and its shield at ${f3?.sh}% after all that`);

say('/tp d1');
await wait(1600);
rings = [];
await wait(2000);
check('and leaving Nullpoint stops the ring rows, because the radar rule is one rule',
  rings.length === 0,
  'the stream is filtered on `ships.has(a.id)` — the same detection set the ship rows came from, not ' +
  'a second copy of "may this pilot see that". Two copies is the workshop dock');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the ring, live'}\n`);
done();
process.exit(fails.length ? 1 : 0);
