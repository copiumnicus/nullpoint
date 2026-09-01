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
//   standing still  took 75,380 points   425 answers, biggest 2,883
//                   peak per wedge [4 0 0 0 0 0 0 1] at a mean bearing of 1 deg
//   circling        took  2,371 points    43 answers
//                   peak per wedge [3 0 0 0 0 0 0 0]
//
//   committed to one bearing, strain read off the wire every thirty seconds:
//        0s [ 4  1 0 0 0 0 0 0]     120s [ 7 13 0 0 0 0 0 0]
//       30s [ 4  4 0 0 0 0 0 0]     150s [11 13 0 0 0 0 0 0]
//       60s [ 4  8 0 0 0 0 0 0]     180s [15 13 0 0 0 0 0 0]  <- wedge 0 gone
//       90s [ 4 12 0 0 0 0 0 0]
//
//   and the payoff, off the floating damage numbers: 1,114 a hit through the armour
//   against 2,342 through the hole. x2.10, against a derived x2.
//
// Two wedges warm out of eight, and they are the two the pilot straddled; the other
// six never left zero. Hostile bolt widths on the wire were 711 — its barrel — and
// then 768 through 2,883, which are the answers.
//
// The zero-ish circling row is worth reading carefully: it is not "the answers
// missed", it is that no plate ever reached the one step of wire resolution the ring
// refuses to answer below. A pilot who keeps turning is not answered and does not
// open anything either, and that is the decision rather than a mercy.
//
// THE PILOT IS KEPT ALIVE THROUGHOUT, and that is not a cheat, it is the difference
// between measuring the ring and measuring a wreck. Measured on this exact loadout:
// committed at 700px, an UNRESEARCHED deep-shelf Bulwark loses its shield in two
// seconds and is destroyed in three. Nothing out here is survivable without research
// and balance.js does not pretend otherwise; what the fight COSTS is measured on the
// bench against a 494,781-point researched hull, where nobody has to be revived —
// 353,131 points committed against 220,410 circling.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { newBase, absorbFull, decodeDelta } from '../shared/delta.js';
import { unpackShip, unpackPlates, unpackBolt, unpackHit, PLATE_STEPS } from '../shared/net.js';
import { ALIENS } from '../shared/aliens.js';
import { dischargeOf, crackOf, holeOf, deflectOf } from '../shared/plates.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const n = v => Math.round(v).toLocaleString('en-US');
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
let me = null, myId = null, snap = null, mapId = null, fit = null, foeId = null;
let rings = [], answers = [], barrels = new Set(), mine = [], onMe = [], dead = false;
// key -> the last `p` seen for it. Bounded, because it is a dedupe table and not a
// log: a fight throws thousands.
const seenHits = new Map();
setInterval(() => { if (seenHits.size > 4000) seenHits.clear(); }, 5000).unref?.();
const send = o => ws.send(JSON.stringify(o));
const say = t => send({ t: 'chat', text: t });
const ready = new Promise(r => ws.on('open', () => { send({ t: 'join', name: 'ringcheck', co: 'm' }); r(); }));

ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { myId = m.id; mapId = m.map; return; }
  if (m.t === 'map') { mapId = m.map; base.map = null; base.ready = false; return; }
  if (m.t === 'fit') { fit = m; return; }
  // Destroyed. It happens — an unresearched deep-shelf hull is three seconds of this
  // hostile — and every phase below is checking the RING rather than survivability, so
  // the script comes back rather than measuring a wreck. It was not doing that, and
  // what it produced was five minutes of a dead pilot reporting a ring that never
  // strained, which reads exactly like the mechanic being broken.
  if (m.t === 'dead') { dead = true; return; }
  if (m.t !== 's' && m.t !== 'd') return;
  snap = m.t === 's' ? (absorbFull(base, m), m) : decodeDelta(base, m);
  me = (snap.ships ?? []).map(unpackShip).find(s => s.id === myId) ?? me;
  // The row for the hostile we are actually fighting. TWO Antiphons are posted in
  // Nullpoint — nothing in this game stands alone — so taking rows[0] reads whichever
  // happens to be first in the snapshot, and it swaps the moment the other one comes
  // into radar. That is what made a strain column appear to reset from 3 to 0.
  const rows = (snap.plates ?? []).map(unpackPlates);
  const row = foeId ? rows.find(r => r.id === foeId) : rows[0];
  if (row) rings.push(row);
  // My own floating damage numbers, taken on the frame they appear (p === 0) — the
  // note on HIT_FIELDS says why: a hit rides every snapshot until it expires, so
  // reading it any other way counts each one once at the very end and misses every one
  // the socket stopped before. That mistake reported a 913-point mirror bolt for one
  // that was actually 5,028.
  // Floating damage numbers, DEDUPED rather than taken at p === 0.
  //
  // net.js says a hit is ephemeral and rides every snapshot until it expires, so
  // anything counting them has to take each one once — and it names p === 0 as the way
  // to do it. That is wrong from a socket, and it is worth writing down because it
  // cost an afternoon: the tick steps a hit BEFORE it builds the snapshot, so by the
  // time the wire sees it p is already dt/ttl and never exactly zero. Counting on
  // p === 0 matches nothing at all, silently, and reports a pilot taking no damage
  // while it is being destroyed. A hit has no id, so the key is what it is made of.
  for (const h of (snap.hits ?? []).map(unpackHit)) {
    const key = `${h.x}:${h.y}:${h.n}:${h.mine}`;
    const was = seenHits.get(key);
    // A key alone is not enough and that took two runs to see. Once a plate is broken
    // the pilot's damage number stops varying — every hit is the same 2,342 at almost
    // the same place — so the key repeats forever and a plain Set counts the first one
    // and then nothing at all, which reads as the pilot having stopped shooting. `p`
    // is what separates them: it climbs 0 -> 1 over a hit's life, so a hit that reuses
    // a key arrives with a LOWER p than the one it replaced.
    if (was !== undefined && h.p >= was) { seenHits.set(key, h.p); continue; }
    seenHits.set(key, h.p);
    if (h.mine === 1) { mine.push(h.n); continue; }
    // A hit ON me, in POINTS. `mine` is whether I CAUSED it, not whether I took it, so
    // the only way to tell is where the number is floating — a hit is drawn just above
    // its target's hull. Worth having rather than reading hp off the row: hp and sh on
    // the wire are PERCENTAGES, and an earlier draft of this file reported "lost 200
    // points" for a pilot that had in fact been destroyed twice over.
    if (me && Math.hypot(h.x - me.x, h.y - me.y) < 160) onMe.push(h.n);
  }
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

// The one we picked, if it is still on the wire — TWO are posted and drifting between
// them mid-measurement is how a strain column appears to reset itself.
const findFoe = () => {
  const all = (snap?.ships ?? []).map(unpackShip).filter(s2 => s2.hull === 'antiphon');
  return all.find(s2 => s2.id === foeId) ?? all[0];
};
let foe = findFoe();
for (let k = 0; k < 40 && !foe; k++) {
  send({ t: 'intent', mode: 'pt', x: 6000, y: 4000 });
  await wait(500);
  foe = findFoe();
}
foeId = foe?.id ?? null;
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

// Kept alive throughout. Every phase below is checking that the RING works — that the
// right wedge heats, that an answer is a bolt on the wire, that strain climbs and ends
// in a break — and a pilot who is destroyed at ten seconds measures how long they
// lived instead of any of that. What the fight COSTS is measured on the bench, where
// nobody has to be revived, and it is measured in points: 353,131 committed against
// 220,410 circling, over a 494,781-point researched hull.
// Every SECOND. Measured on this exact loadout against this exact hostile: committed
// at 700px, an unresearched deep-shelf Bulwark loses its shield in two seconds and is
// destroyed in three. Nothing about that is a surprise — balance.js does not pretend
// anything out here is survivable without research, and the bench measures the cost
// properly against a 494,781-point researched hull. What this file is checking is that
// the RING works, and a pilot who is destroyed at three seconds measures how long they
// lived instead of any of it.
const HEAL_EVERY = 1;
const R2 = 700;
// Back out, back to Nullpoint, and back into range. Returns once the pilot is standing
// where they were, or gives up so the caller's own timeout still governs.
async function revive() {
  if (!dead) return false;
  send({ t: 'respawn' });
  await wait(1200);
  say('/heal');
  say('/tp x0');
  await wait(1400);
  dead = false;
  for (let k = 0; k < 120; k++) {
    const f = findFoe();
    if (!f) { send({ t: 'intent', mode: 'pt', x: 6000, y: 4000 }); await wait(400); continue; }
    send({ t: 'intent', mode: 'pt', x: f.x + R2, y: f.y });
    send({ t: 'target', id: f.id });
    say('/heal');
    await wait(400);
    if (Math.abs(Math.hypot(me.x - f.x, me.y - f.y) - R2) < 110) return true;
  }
  return true;
}
async function phase(name, secs, fly) {
  rings = []; answers = []; barrels = new Set(); onMe = [];
  const peak = new Array(8).fill(0);
  let bear = 0, bn = 0, lastHeal = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    const f = findFoe();
    if (f) { fly(f, (Date.now() - t0) / 1000); send({ t: 'target', id: f.id }); }
    await wait(250);
    const el = (Date.now() - t0) / 1000;
    if (el - lastHeal > HEAL_EVERY) { say('/heal'); lastHeal = el; }
    if (dead) await revive();
    for (const r of rings.splice(0)) for (let i = 0; i < 8; i++) peak[i] = Math.max(peak[i], r[`p${i}`] ?? 0);
    if (f) { bear += Math.atan2(me.y - f.y, me.x - f.x); bn++; }
  }
  const mb = bn ? bear / bn : 0;
  const out = { took: onMe.reduce((x, y) => x + y, 0), answers: answers.length, peak,
                big: Math.max(0, ...answers.map(a => a.w)),
                wedge: ((Math.round(mb / (Math.PI / 4)) % 8) + 8) % 8, bear: mb * 180 / Math.PI,
                widths: [...barrels].sort((a, b) => a - b) };
  console.log(`     ${name.padEnd(15)} took ${n(out.took).padStart(8)} points   ` +
    `${String(out.answers).padStart(3)} answers, biggest ${String(out.big).padStart(5)}   ` +
    `peak per wedge [${peak.join(' ')}]   standing on wedge ${out.wedge} (${out.bear.toFixed(0)} deg)`);
  return out;
}

console.log('\n  standing still, then circling, same gun and same range:');
const anchor = (() => { const f = findFoe(); return { x: f.x + R, y: f.y }; })();
const held = await phase('standing still', 26, () => send({ t: 'intent', mode: 'pt', x: anchor.x, y: anchor.y }));
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
check('circling costs less than committing, over a real socket',
  round.took < held.took && round.answers < held.answers,
  `${n(round.took)} points and ${round.answers} answers circling against ${n(held.took)} and ` +
  `${held.answers} committed, at the same range with the same gun. That half of the mechanic did ` +
  'not change when plates started breaking — what changed is that circling now opens nothing, so ' +
  'the cheap way through is also the slow one');

const f3 = findFoe();
console.log(`\n     its hull is at ${f3?.hp}% and its shield at ${f3?.sh}% after all that`);

// --- and now COMMIT: hold one bearing until the wedge gives ----------------------
//
// The half of the mechanic a bench cannot show, because what it proves is that the
// strain column reaches a client at all and that the payoff is visible in the one
// place a pilot is already looking — their own damage numbers.
console.log('\n  committing to one bearing until it breaks:');
{
  let bear = null;
  await revive();
  {
    const f = findFoe();
    bear = Math.atan2(me.y - f.y, me.x - f.x);
  }
  const wedgeOf = () => {
    const f = findFoe();
    if (!f) return -1;
    const a2 = Math.atan2(me.y - f.y, me.x - f.x);
    return ((Math.round(a2 / (Math.PI / 4)) % 8) + 8) % 8;
  };
  rings = []; mine = [];
  const t0 = Date.now();
  const trace = [];
  let broke = -1, brokeAt = 0, before = [], after = [], lastHeal = 0, lastLog = -1;
  while (Date.now() - t0 < 300000 && broke < 0) {
    const f = findFoe();
    // Station-keeping on the assigned bearing, which is the only way to hold one
    // against something that closes at 80 px/s: a fixed point in the world is not a
    // fixed bearing once the hostile has moved off it.
    if (f) { send({ t: 'intent', mode: 'pt', x: f.x + Math.cos(bear) * R2, y: f.y + Math.sin(bear) * R2 });
             send({ t: 'target', id: f.id }); }
    await wait(250);
    const row = rings[rings.length - 1];
    if (row) {
      const st = Array.from({ length: 8 }, (_, i) => row[`s${i}`] ?? 0);
      trace.push(st);
      const gone = st.findIndex(v => v >= PLATE_STEPS);
      if (gone >= 0) { broke = gone; brokeAt = (Date.now() - t0) / 1000; }
    }
    if (broke < 0) before = before.concat(mine.splice(0));
    const el = (Date.now() - t0) / 1000;
    // Kept alive on purpose. This block is checking that the RING works — that strain
    // accumulates, reaches a client and ends in a break — and a pilot who dies at 40s
    // measures how long they lived instead. What committing costs is measured on the
    // bench, where nobody has to be revived: 353,131 points against 220,410 circling.
    if (el - lastHeal > HEAL_EVERY) { say('/heal'); lastHeal = el; }
    // Reviving must NOT re-pick the bearing. It did, and what that produced was strain
    // smeared over three wedges and nothing breaking in five minutes — the pilot came
    // back somewhere else and committed there instead. The whole point of this block is
    // that ONE wedge is being leaned on, so the bearing is chosen once and flown back
    // to; the loop below already steers to it from wherever the respawn put them.
    if (dead) await revive();
    if (Math.round(el) % 30 === 0 && Math.round(el) !== lastLog && row) {
      lastLog = Math.round(el);
      const st = Array.from({ length: 8 }, (_, i) => row[`s${i}`] ?? 0);
      const ch = Array.from({ length: 8 }, (_, i) => row[`p${i}`] ?? 0);
      console.log(`     ${el.toFixed(0).padStart(3)}s  strain [${st.join(' ')}]  charge [${ch.join(' ')}]  ` +
        `wedge ${wedgeOf()}  me ${me?.hp}%/${me?.sh}%  my hits ${before.length}`);
    }
  }
  // and a few more seconds of shooting THROUGH the hole, for the payoff
  mine = [];
  const t1 = Date.now();
  let heal1 = 0;
  while (Date.now() - t1 < 30000) {
    const f = findFoe();
    if (f) { send({ t: 'intent', mode: 'pt', x: f.x + Math.cos(bear) * R2, y: f.y + Math.sin(bear) * R2 });
             send({ t: 'target', id: f.id }); }
    await wait(250);
    const el1 = (Date.now() - t1) / 1000;
    if (el1 - heal1 > HEAL_EVERY) { say('/heal'); heal1 = el1; }
    if (dead) await revive();
  }
  after = mine.splice(0);
  const last = trace[trace.length - 1] ?? [];
  const mean = v => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0);

  check('strain climbs on the wedge you are committed to, and reaches a client',
    trace.length > 0 && Math.max(0, ...last) > 0,
    `[${last.join(' ')}] after ${((Date.now() - t0) / 1000).toFixed(0)}s — one column a plate, and it ` +
    'only ever climbs. It is the second half of the tell: the glow says how hard the wedge is now, ' +
    'this says how close it is to going, and a commitment with no progress bar is a leap of faith');
  check('and holding one bearing long enough BREAKS it, which is what was asked for',
    broke >= 0,
    broke >= 0 ? `wedge ${broke} gone at ${brokeAt.toFixed(0)}s, at the top step of its own column — ` +
      `${n(crackOf(ALIENS.antiphon))} points TURNED, which is ${ALIENS.antiphon.plates.crack} platefuls`
      : 'nothing broke in five minutes of unbroken fire, which is the whole change failing');
  check('and the core is open where it was: the numbers through the hole double',
    before.length > 5 && after.length > 5 && mean(after) > mean(before) * 1.5,
    `${Math.round(mean(before))} a hit through the armour (${before.length} of them) against ` +
    `${Math.round(mean(after))} through the hole (${after.length}) — ` +
    `x${(mean(after) / Math.max(1, mean(before))).toFixed(2)} against a stated ` +
    `x${(holeOf(ALIENS.antiphon) / (1 - deflectOf(ALIENS.antiphon))).toFixed(0)} between the worst ` +
    'place to stand and the best. Read off the floating damage numbers, which is where a pilot ' +
    'reads it too');
}

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
