// Several pilots in one browser, against a REAL server over real sockets.
//
//     node test/pilots-live.mjs
//
// Not in `npm test`: it boots the game twice and restarts it in the middle, which
// takes about twenty seconds and is not what a suite of plain node scripts is
// for. It is here because "tests pass" is not "the game works", and because the
// half of this feature that matters is the half that survives a process dying —
// two accounts, two ships, two holds, one browser.
//
// It runs the server in a sandbox under the system temp directory, so the world
// you actually play in is untouched, and it takes a kernel-assigned port because
// `PORT=0` reads back as 3000: server.js does `Number(process.env.PORT) || 3000`.
//
// What it does NOT cover, and cannot: the five-second stand-down a switch pays.
// That lives in the browser and never reaches the socket — what reaches the
// socket is the close, which is what a switch does when the clock runs out. The
// stand-down is driven with real pointer events in test/render.mjs; the last
// check below is the fact it refuses on, seen coming off a real wire.

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackShip } from '../shared/net.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');

const fails = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// A kernel-assigned port, asked for and handed back. PORT=0 would be read as
// falsy by the server and land on 3000, which is very likely already in use by
// the game you are actually playing.
const freePort = () => new Promise(r => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

// A sandbox, so nobody's accounts file grows two test pilots. server.js resolves
// public/, shared/ and data/ against the working directory, so the working
// directory is the only thing that has to move — and `data/` survives the
// restart in the middle, which is the whole point of the second half.
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-pilots-'));
fs.mkdirSync(path.join(SAND, 'data'));
for (const d of ['public', 'shared', 'node_modules'])
  fs.symlinkSync(path.join(ROOT, d), path.join(SAND, d));

const PORT = await freePort();
let srv = null;
const stop = () => new Promise(r => { if (!srv) return r(); srv.once('exit', r); srv.kill('SIGINT'); });
const boot = async () => {
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: SAND, env: { ...process.env, PORT: String(PORT), DEV_ADMIN: '1' },
    stdio: ['ignore', 'ignore', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 100; i++) {
    await wait(100);
    const up = await new Promise(r => {
      const s = net.connect(PORT, '127.0.0.1');
      s.on('connect', () => { s.destroy(); r(true); });
      s.on('error', () => r(false));
    });
    if (up) return;
  }
  throw new Error('the server never came up');
};
process.on('exit', () => { try { srv?.kill('SIGKILL'); } catch {}
                           fs.rmSync(SAND, { recursive: true, force: true }); });

// One connection with a mailbox. `fresh()` matters: the server sends ONE
// keyframe and then deltas, so the first `s` is the only whole snapshot that
// ever lands — asking for another is the client's own recovery path.
const dial = (token = '') => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?t=${encodeURIComponent(token)}`);
  const box = [], waiters = [];
  ws.on('error', rej);
  ws.on('message', b => {
    const m = JSON.parse(b);
    box.push(m);
    for (let i = waiters.length - 1; i >= 0; i--)
      if (waiters[i].ok(m)) { waiters[i].done(m); waiters.splice(i, 1); }
  });
  ws.on('open', () => res({
    send: o => ws.send(JSON.stringify(o)),
    chat: text => ws.send(JSON.stringify({ t: 'chat', text })),
    seen: ok => box.filter(ok),
    wait: (ok, ms = 6000) => new Promise((done, no) => {
      const hit = box.find(ok);
      if (hit) return done(hit);
      const t = setTimeout(() => no(new Error('timed out on the wire')), ms);
      waiters.push({ ok, done: m => { clearTimeout(t); done(m); } });
    }),
    fresh: async () => {
      const had = box.filter(m => m.t === 's').length;
      ws.send(JSON.stringify({ t: 'need' }));
      for (let i = 0; i < 120; i++) {
        await wait(50);
        const all = box.filter(m => m.t === 's');
        if (all.length > had) return all.at(-1);
      }
      throw new Error('no keyframe came back');
    },
    close: () => new Promise(r => { ws.on('close', r); ws.close(); }),
  }));
});

await boot();
console.log(`\nserver on ${PORT}, empty accounts file\n`);

// --- one browser, first pilot -------------------------------------------------
let A = await dial();
await A.wait(m => m.t === 'signup');
A.send({ t: 'join', name: 'Vela-One', co: 'm' });
const wA = await A.wait(m => m.t === 'welcome');
console.log(`  pilot A joined: ${wA.name} [${wA.co}] ${wA.hull}`);

// Something worth keeping, and a ship that is not the one everybody starts in.
A.chat('/money 250000'); A.chat('/ship bulwark'); A.chat('/ammo'); A.chat('/ore iron 500');
await wait(600);
A.send({ t: 'hull', key: 'bulwark' });
await wait(600);
A.send({ t: 'intent', mode: 'pt', x: 6600, y: 4400 });
await wait(1200);
const fitA = A.seen(m => m.t === 'fit').at(-1);
const snapA = await A.fresh();
const A_CR = fitA.credits, A_HULL = fitA.hull;
const A_AMMO = JSON.stringify(fitA.ammo), A_VAULT = JSON.stringify(snapA.vault ?? {});
console.log(`  pilot A now: ${A_HULL}, ${A_CR} cr, vault ${A_VAULT}`);

// Somebody else in the same sector, to see whether a parked ship stays on the board.
const EYE = await dial();
await EYE.wait(m => m.t === 'signup');
EYE.send({ t: 'join', name: 'Watcher', co: 'm' });
await EYE.wait(m => m.t === 'welcome');
await wait(700);
const before = await EYE.fresh();

// --- the switch: park A, become a NEW pilot -----------------------------------
await A.close();
await wait(900);
const after = await EYE.fresh();
check(after.ships.length === before.ships.length - 1,
  `a parked pilot is gone from the sector, not a hulk left in it — ${before.ships.length} ships ` +
  `on the watcher's plot before, ${after.ships.length} after`);

// NEW PILOT leaves the browser with an empty token, which is what a stranger is.
const B = await dial('');
check(!!await B.wait(m => m.t === 'signup'),
  'an empty token gets the join form rather than somebody else\'s ship');

B.send({ t: 'join', name: 'Vela-One', co: 'h' });
const no = await B.wait(m => m.t === 'signup' && m.problem);
check(/already flies/.test(no.problem), `a name in use is refused out loud — "${no.problem}"`);

B.send({ t: 'join', name: 'Vela-Two', co: 'h' });
const wB = await B.wait(m => m.t === 'welcome' && m.name === 'Vela-Two');
check(wB.token !== wA.token, 'the new pilot has a token, an account and a side of their own');
check(wB.credits === 0 && wB.hull === 'hauler',
  `and starts from nothing — ${wB.credits} cr in a ${wB.hull}, with A parked on ${A_CR} in a ${A_HULL}`);

B.chat('/money 999');
B.send({ t: 'intent', mode: 'pt', x: 5400, y: 3600 });
await wait(900);
console.log(`  pilot B flew and banked ${B.seen(m => m.t === 'fit').at(-1)?.credits ?? 0} cr`);

// --- switch back --------------------------------------------------------------
await B.close();
await wait(400);
A = await dial(wA.token);
const backA = await A.wait(m => m.t === 'welcome');
check(backA.name === 'Vela-One', `switching back lands on ${backA.name}, not the pilot just flown`);
check(backA.credits === A_CR && backA.hull === A_HULL,
  `with the same ship and money — ${backA.credits} cr in a ${backA.hull}`);
check(JSON.stringify(backA.ammo) === A_AMMO, 'and the same ammunition in the racks');
check(JSON.stringify((await A.fresh()).vault ?? {}) === A_VAULT, `and the same cargo — ${A_VAULT}`);

// --- and both survive the process ---------------------------------------------
await A.close(); await EYE.close();
await wait(400);
await stop();
console.log('\n  server restarted\n');
await boot();

const A2 = await dial(wA.token);
const rA = await A2.wait(m => m.t === 'welcome');
check(rA.name === 'Vela-One' && rA.credits === A_CR && rA.hull === A_HULL,
  `A survived the restart — ${rA.name}, ${rA.credits} cr, ${rA.hull}`);
const B2 = await dial(wB.token);
const rB = await B2.wait(m => m.t === 'welcome');
check(rB.name === 'Vela-Two' && rB.co === 'h',
  `and so did B — ${rB.name} [${rB.co}], ${rB.credits} cr, ${rB.hull}`);

// --- /reset all takes one account, not the browser ----------------------------
B2.chat('/reset all');
await B2.wait(m => m.t === 'reset');
await B2.close();
await wait(400);
const A3 = await dial(wA.token);
const rA3 = await A3.wait(m => m.t === 'welcome');
check(rA3.name === 'Vela-One' && rA3.credits === A_CR,
  'wiping B leaves A exactly as they were — /reset all takes one pilot, not the browser');
const B3 = await dial(wB.token);
check(!!await B3.wait(m => m.t === 'signup'), 'while B\'s own token is a stranger again, which is the join form');

// --- the fact a switch is refused on --------------------------------------------
// The stand-down never reaches the wire. What does is `tgt`: a hostile pointed at
// your own id, which is the whole of the client's `hunted`.
A3.chat('/dev');
await wait(1000);
const range = await A3.fresh();
const foe = range.ships.map(unpackShip).find(s => s.co === 'x');
if (foe) { A3.send({ t: 'intent', mode: 'pt', x: foe.x, y: foe.y }); A3.send({ t: 'target', id: foe.id }); }
let hunted = null;
for (let i = 0; i < 40 && !hunted; i++) {
  await wait(250);
  A3.send({ t: 'target', id: foe?.id ?? 0 });
  hunted = (await A3.fresh()).ships.map(unpackShip).find(s => s.co === 'x' && s.tgt === rA3.id);
}
check(!!hunted, hunted
  ? `the wire says when something is shooting at you — a ${hunted.hull} carrying tgt=${hunted.tgt}, ` +
    'which is the fact the menu refuses a switch on'
  : 'nothing on the dev range ever shot back, so the under-fire fact was not seen live');

await A3.close(); await B3.close();
await stop();
console.log(fails.length ? `\nFAIL — ${fails.length}` : '\nPASS');
process.exit(fails.length ? 1 : 0);
