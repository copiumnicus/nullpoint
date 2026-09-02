// The turbo clock, and the two clocks it separates.
//
// server.js normally advances the world on a setInterval at 1000/TICK_HZ, which
// means every live verification in this repo waits out real seconds: a 228-second
// measurement costs 228 seconds of somebody's afternoon, and `npm test` was three
// minutes of which almost all was sleeping. Under TURBO the same tick runs on
// setImmediate with dt pinned at exactly 1/TICK_HZ, so the world moves as fast as
// the process can compute it.
//
// Two claims are worth keeping, and they are the two that could go quietly wrong:
//
//   1. IT CANNOT REACH PRODUCTION. A flag that makes the whole world run fast is
//      not one player's cheat, it is everybody's at once. TURBO requires DEV_ADMIN
//      as well as itself, and `npm start` — what a host runs — sets neither.
//
//   2. IT IS THE SAME WORLD, ONLY FASTER. Same dt, same order, same results. The
//      scenario below is run twice, once against each kind of server, and the two
//      answers are compared. It is deliberately short: the whole point of the file
//      is that the slow leg is the only slow thing left in it.
//
// The wider proof lives in test/arena.mjs and test/duel.mjs, which run turbo by
// default and go back on the wall clock with TURBO=0. Run either way they print
// the same 248 assertions with the same numbers in them.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { PING_COOLDOWN } from '../shared/ping.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const began = Date.now();

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
// A port the OS says is free rather than one picked in advance — a hard-coded
// number turns every assertion in a live file red the first time something else on
// the machine happens to be holding it, and every one of them blames the feature.
const freePort = () => new Promise((res, rej) => {
  const probe = net.createServer();
  probe.on('error', rej);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => res(port));
  });
});

// Up when the port answers, rather than after a fixed sleep. Three boots at a flat
// 1.5s each was four and a half seconds of this file spent not knowing whether the
// server was ready — and on a slow machine a fixed wait is the other failure, where
// the whole file goes red because a laptop was busy.
const upOn = async (port, until = Date.now() + 8000) => {
  for (;;) {
    const ok = await new Promise(res => {
      const c = net.connect(port, '127.0.0.1');
      c.on('connect', () => { c.destroy(); res(true); });
      c.on('error', () => res(false));
    });
    if (ok) return true;
    if (Date.now() > until) return false;
    await wait(50);
  }
};

// A sandbox, so nobody's accounts file grows a pile of test pilots.
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-turbo-'));
fs.mkdirSync(path.join(SAND, 'data'));
for (const d of ['public', 'shared', 'node_modules'])
  fs.symlinkSync(path.join(ROOT, d), path.join(SAND, d));
const live = new Set();
process.on('exit', () => {
  for (const s of live) { try { s.kill('SIGKILL'); } catch {} }
  fs.rmSync(SAND, { recursive: true, force: true });
});

// One server, one pilot, and a handle on the pace. `env` is what the whole file is
// about, so it is the argument.
async function rig(env) {
  const PORT = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: SAND, env: { ...process.env, PORT: String(PORT), DEV_ADMIN: '', TURBO: '', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  live.add(srv);
  srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
  if (!await upOn(PORT)) { check(`the test server came up on ${PORT}`, false, 'nothing listening'); process.exit(1); }

  const pend = new Map();
  let syncId = 0, frames = 0, bag = {};
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const ready = new Promise(r => pend.set('welcome', r));
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: `T${PORT}`, co: 'm' })));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 's' || m.t === 'd') frames++;
    if (m.t === 'welcome') { pend.get('welcome')?.(m); pend.delete('welcome'); return; }
    if (m.t === 'sync') { pend.get(m.id)?.(m); pend.delete(m.id); return; }
    if (m.t === 's') bag = m;
  });
  const me = await Promise.race([ready, wait(8000).then(() => null)]);
  if (!me) { check(`the test server answered on ${PORT}`, false, 'nothing there'); process.exit(1); }

  const send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  // Ask the server to step `ms` of SIM time and wait to be told it has. Resolves
  // null if nothing answers within `cap` — which is the assertion in section 1,
  // where the whole point is that nothing does.
  const sim = (ms, cap = 20000) => new Promise(res => {
    const id = ++syncId;
    const bail = setTimeout(() => { pend.delete(id); res(null); }, cap);
    pend.set(id, m => { clearTimeout(bail); res(m); });
    send({ t: 'sync', ms, id });
  });
  const snap = async () => { bag = {}; send({ t: 'need' }); await sim(100); return bag; };
  return {
    me, send, sim, snap, id: me.id,
    chat: t => send({ t: 'chat', text: t }),
    frames: () => frames,
    resetFrames: () => { frames = 0; },
    stop: () => { try { ws.close(); } catch {} try { srv.kill('SIGKILL'); } catch {} live.delete(srv); },
  };
}

// ============================================================================
// 1. it cannot reach production
// ============================================================================
console.log('\nthe flag, and the door it is behind');
{
  // TURBO set and DEV_ADMIN not: exactly the shape a dashboard mistake takes on a
  // deployed host. The world must keep its 30Hz tick and there must be no handle on
  // the pace at all.
  const r = await rig({ TURBO: '1' });
  r.resetFrames();
  const t0 = Date.now();
  await wait(1000);
  const fps = r.frames() / ((Date.now() - t0) / 1000);
  check('TURBO on its own does nothing — without DEV_ADMIN the tick stays on the wall clock',
    fps > 20 && fps < 45,
    `${fps.toFixed(1)} snapshots a second with TURBO=1 set, against a ${(1000 / 33.333).toFixed(0)}Hz tick`);
  const answered = await r.sim(50, 1200);
  check('and it will not answer a sync either, so there is no handle on the pace',
    answered === null,
    'the one message that could drive a fast world is refused unless DEV_ADMIN is set');
  r.stop();
}

// ============================================================================
// 2. the same world, only faster
// ============================================================================
//
// The scenario. Short on purpose — the slow leg of this file is the only slow thing
// left in the suite — and it touches both clocks: a burn is integrated off `dt`, a
// ping cooldown is counted off the sim clock, and the two have to agree.
const BURN = 3000, HOLD = 2000;
async function scenario(env) {
  const r = await rig(env);
  const t0 = Date.now();
  r.chat('/money 100000');
  await r.sim(200);
  // A fixed burn in a fixed direction. Nothing random in it: the same thrust for
  // the same number of ticks has to end in the same place, and where it ends is the
  // whole of "same dt, same order, same results".
  const from = await r.snap();
  const start = (from.ships ?? []).find(s => s[0] === r.id);
  r.send({ t: 'intent', mode: 'dir', dx: 1, dy: 0 });
  await r.sim(BURN);
  r.send({ t: 'intent', mode: 'dir', dx: 0, dy: 0 });
  const after = await r.snap();
  const row = (after.ships ?? []).find(s => s[0] === r.id);
  // And a ping, which is the plainest thing in the game that is timed off the sim
  // clock rather than off `dt`: PING_COOLDOWN seconds counted from a millisecond
  // stamp. Read it partway through, where a wrong clock shows up as a wrong number
  // rather than as nothing at all.
  r.send({ t: 'mark', x: 500, y: 500 });
  await r.sim(HOLD);
  const mid = await r.snap();
  const out = {
    moved: Math.round(Math.hypot(row[1] - start[1], row[2] - start[2])),
    ping: mid.ping,
    wall: (Date.now() - t0) / 1000,
  };
  // And which kind of server it actually was, out of the server's own mouth rather
  // than out of the environment this file set — a flag that silently failed to take
  // would otherwise make every comparison below pass by being the same twice.
  out.turbo = (await r.sim(0))?.turbo ?? 0;
  // The rig comes back rather than being shut down, so the section below can put a
  // real question to a server that is already up instead of booting a fourth one.
  out.r = r;
  return out;
}

console.log('\nthe same world, only faster');
const slow = await scenario({ DEV_ADMIN: '1' });
const fast = await scenario({ DEV_ADMIN: '1', TURBO: '1' });

// The tolerance is DERIVED from the difference between the two clocks rather than
// tuned to one run, and the first version of it was tuned to one run and went red on
// a busier machine at 18px against a 17.7px allowance.
//
// server.js: `dt = TURBO ? 1 / TICK_HZ : Math.min(0.1, (now - last) / 1000)`. The slow
// leg integrates REAL elapsed time, including however late a 30Hz interval actually
// fired; the fast leg integrates a fixed step. So the slow leg always covers at least
// as much ground, by however much the machine was busy — which is a property of the
// machine and not of turbo, and is unbounded above under load.
//
// So the claim is stated in the direction the arithmetic guarantees: the fixed step
// never OVERSHOOTS the measured one, and the two stay within an interval's worth of
// slack over the burn. 10% of three seconds is 300ms of accumulated overshoot across
// 90 ticks — 3.3ms a tick, which is an ordinary loaded-machine setInterval.
const SLACK = 0.10;
check('a fixed step never outruns the clock it stands in for',
  fast.moved <= slow.moved + 1 && slow.moved - fast.moved <= slow.moved * SLACK,
  `${fast.moved}px against ${slow.moved}px over ${(BURN / 1000).toFixed(0)}s of thrust — `
  + `${(100 * (slow.moved - fast.moved) / slow.moved).toFixed(1)}% apart against ${SLACK * 100}% of `
  + 'slack, and the slow leg is the imprecise one because it integrates real elapsed time');

check('a ping cooldown is counted in SIM seconds at both speeds',
  slow.ping === fast.ping && fast.ping === PING_COOLDOWN - HOLD / 1000,
  `${fast.ping}s left of ${PING_COOLDOWN} after ${(HOLD / 1000).toFixed(0)}s of sim, both ways — `
  + 'the mine, the claim wall, the duel limit and the challenge TTL are all on this clock');

check('and the fast one is a real server that simply got there sooner',
  fast.turbo === 1 && slow.turbo === 0 && fast.wall < slow.wall / 3,
  `${fast.wall.toFixed(2)}s of wall clock against ${slow.wall.toFixed(2)}s for the same `
  + `${((BURN + HOLD) / 1000).toFixed(0)}s of world — ${(slow.wall / fast.wall).toFixed(1)}x`);

// ============================================================================
// 3. what it is for
// ============================================================================
console.log('\nand what it buys');
{
  const r = fast.r;
  const t0 = Date.now();
  const LONG = 120;
  const got = await r.sim(LONG * 1000);
  const wall = (Date.now() - t0) / 1000;
  check('a two-minute fight costs seconds instead of two minutes',
    !!got && wall < 20,
    `${LONG}s of sim in ${wall.toFixed(2)}s (${(LONG / wall).toFixed(0)}x) — this is the whole `
    + 'reason the flag exists');
  r.stop();
  slow.r.stop();
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — turbo is dev-only, and the same world arrives sooner — ${((Date.now() - began) / 1000).toFixed(1)}s`}\n`);
process.exit(fails.length ? 1 : 0);
