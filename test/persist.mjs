// Saving the accounts must not stop the world.
//
// This file exists because of a lag report: four pilots, London to a Netherlands
// host, intermittent stutter. The tick turned out to be fine — 0.7ms of a 33.3ms
// budget with four pilots fighting — and so did the wire, at 3.0 KiB/s per player
// with the largest single message 666 bytes. What was not fine was that the
// accounts file was written with `writeFileSync` straight off the once-a-second
// timer in server.js, on the same thread as the tick.
//
// It fires far more often than "once a second when something happens" suggests.
// `bankLab` pays a mine out once a second and calls `touch()`, so a single online
// pilot who owns one sets `dirty` on every second there is. Measured against a
// real server, four pilots fighting on the frontier with 214 accounts loaded:
// 37 saves in 40 seconds.
//
// What one costs is the whole question, and it is not a property of the code —
// it is a property of the disk. Measured against a real server with the write
// forced to 30ms, which is unremarkable for the network-backed volume this game
// is deployed on:
//
//                                   fast local disk      a 30ms volume
//     event loop delay, max              3.7ms               33.7ms
//     worst gap between snapshots       36.2ms               63.0ms
//     wall clock spent blocked        38ms / 40s        1,161ms / 40s
//
// So the claim being kept here is: however long the disk takes, the caller does
// not wait for it, and nothing is lost by not waiting.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// A sandbox, because store.js resolves `data/` against the working directory and
// nobody's real accounts file should grow a benchmark.
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-persist-'));
const cwd = process.cwd();
process.chdir(SAND);
fs.mkdirSync(path.join(SAND, 'data'), { recursive: true });
const FILE = path.join(SAND, 'data', 'accounts.json');
const store = await import(path.join(ROOT, 'store.js') + '?fresh=' + Math.random());

const dbOf = (n, mark = 'x') => ({
  seq: n,
  accounts: Object.fromEntries(Array.from({ length: n }, (_, i) => [`tok${i}`, {
    token: `tok${i}`, seq: i, co: 'm', name: `Pilot${i}`, mark,
    hull: 'scout', credits: 4820 + i, xp: 1200, mapId: 'm1', x: 6000, y: 4000,
    gear: { emitter1: 3, cellA: 2 }, hold: { iron: 40 }, vault: { iron: 900 },
    kills: { drifter: 12, harrier: 3 }, hulls: ['scout'], formations: ['line'],
    fit: ['emitter1', null, null], drones: [null, null, null],
  }])),
});

console.log('\nwhat comes back');
{
  check('an empty directory reads as no accounts',
    JSON.stringify(store.load()) === JSON.stringify({ accounts: {}, seq: 0 }));
  store.save(dbOf(3, 'first'));
  const read = store.load();
  check('what was written comes back, straight away',
    read.seq === 3 && read.accounts.tok1.credits === 4821 && read.accounts.tok1.mark === 'first',
    'load() settles anything still owed before it reads, so the module cannot lie to its own caller');
}

console.log('\nthe disk is not on the caller\'s clock');
{
  // The assertion that matters, and it is deterministic rather than a timing
  // race: fs.mkdir's callback cannot run before the current stack unwinds, so a
  // deferred write CANNOT have landed by the time save() returns. If this ever
  // reads 'second' the write went back on the game loop.
  store.save(dbOf(3, 'first'));
  store.load();                                    // settle, so the file says 'first'
  store.save(dbOf(3, 'second'));
  const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  check('save() returns before the bytes are on the disk',
    onDisk.accounts.tok0.mark === 'first',
    'the tick carries the JSON.stringify and hands the write away — a slow volume stalls neither');
  await wait(120);
  const later = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  check('and the bytes land on their own shortly after',
    later.accounts.tok0.mark === 'second');
}

console.log('\na burst of saves leaves the newest on disk');
{
  // The file going BACKWARDS is the failure mode an asynchronous write invites:
  // an older write finishing last and renaming itself over a newer one. Every
  // write carries a stamp and refuses to publish under a newer one that already
  // landed.
  for (let i = 0; i < 40; i++) store.save(dbOf(3, `mark${i}`));
  await wait(300);
  const read = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  check('forty saves in one tick leave the last one on disk, not a middle one',
    read.accounts.tok0.mark === 'mark39', `file says ${read.accounts.tok0.mark}`);
  check('and no half-written temp file is left behind',
    fs.readdirSync(path.join(SAND, 'data')).filter(f => f.endsWith('.tmp')).length === 0,
    fs.readdirSync(path.join(SAND, 'data')).join(' '));
}

console.log('\nnothing is lost on the way out');
{
  // An asynchronous save called from a shutdown path is a save that never
  // happened unless something flushes it. server.js's signal handler calls
  // persistAll() and then process.exit(0) on the very next line, so this is not a
  // theoretical case — it is the one that would have silently eaten a session.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-exit-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const src = `
    const store = await import(${JSON.stringify(path.join(ROOT, 'store.js'))});
    store.save({ seq: 7, accounts: { tok0: { name: 'Lastword', credits: 999 } } });
    process.exit(0);                       // exactly what the signal handler does
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', src], { cwd: dir });
  const read = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'accounts.json'), 'utf8'));
  check('a save followed immediately by process.exit still reaches the disk',
    read.seq === 7 && read.accounts.tok0.name === 'Lastword',
    'the exit hook writes where it stands');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\na corrupt file still does not take the server down');
{
  fs.writeFileSync(FILE, '{ not json at all');
  check('and it reads as no accounts rather than throwing',
    JSON.stringify(store.load()) === JSON.stringify({ accounts: {}, seq: 0 }));
}

console.log('\nwhat is left on the tick, and how it grows');
{
  // The half that did NOT move: `state` is the live database and keeps moving, so
  // the text has to be built on the caller's clock or the file would hold
  // whatever the world looked like once the disk got round to it. This is
  // therefore the floor, and it is worth knowing where it goes.
  const ms = n => {
    const db = dbOf(n);
    for (let i = 0; i < 3; i++) JSON.stringify(db, null, 2);
    const t = [];
    for (let i = 0; i < 15; i++) { const s = performance.now(); JSON.stringify(db, null, 2); t.push(performance.now() - s); }
    return t.sort((a, b) => a - b)[7];
  };
  const at214 = ms(214), at1000 = ms(1000), at2000 = ms(2000);
  console.log(`       214 accounts ${at214.toFixed(2)}ms   1,000 ${at1000.toFixed(2)}ms   ` +
              `2,000 ${at2000.toFixed(2)}ms   (the tick's budget is 33.3ms)`);
  // Generous, because this runs on whatever CI is and the point is the shape
  // rather than the constant: the game is nowhere near the budget on the part
  // that is still synchronous, and the part that had no ceiling is gone.
  check('building the text is a small fraction of one tick at the size this game is',
    at214 < 8, `${at214.toFixed(2)}ms at 214 accounts against a 33.3ms tick`);
  check('and it grows with the accounts rather than with anything a player does',
    at2000 < at214 * 40, `${at2000.toFixed(2)}ms at 2,000 against ${at214.toFixed(2)}ms at 214`);
}

process.chdir(cwd);
fs.rmSync(SAND, { recursive: true, force: true });
console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — persistence stays off the game loop'}\n`);
process.exit(fails.length ? 1 : 0);
