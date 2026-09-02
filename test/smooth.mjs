// How evenly a ship moves on screen, measured rather than felt.
//
// The complaint was intermittent lag with four pilots on a London-to-Netherlands
// link. The server and the wire were profiled and cleared: 0.66ms mean tick
// against a 33.3ms budget with no overruns in 1,207 ticks, and p99 arrival gaps
// under 37ms with nothing over 66ms. What was left was the client, which smoothed
// ship positions with a fixed fraction of the gap PER RENDERED FRAME —
//
//     s.rx += (s.x - s.rx) * 0.35;
//
// — so the filter was five times stiffer on a 144Hz monitor than on a 30Hz one,
// and the camera follows the local ship's drawn position. The better the monitor,
// the worse it looked.
//
// This is that measurement, kept. A ship flies dead straight at a constant
// 300px/s while the server ticks at 30Hz; the client draws at 30, 60, 120 and
// 144fps; and every rendered step is compared with the one distance it should be,
// which is speed times the length of the frame. A perfect result is every step
// identical. The old line and the new one are both run, because a number with
// nothing beside it is not evidence.

import { chase, reckon, EASE, AHEAD_MS, SNAP_PX } from '../shared/smooth.js';
import { TICK_MS } from '../shared/sim.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const RATES = [30, 60, 144, 120].sort((a, b) => a - b);
const V = 300;                                       // px/s, a Vanguard at full burn

// The line that shipped, so the before column is the real thing and not a memory.
const OLD = (s, dt, since) => { s.rx += (s.x - s.rx) * 0.35; s.ry += (s.y - s.ry) * 0.35; };

// Deterministic jitter, so a run is reproducible and a failure is a bug rather
// than a seed.
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// One pilot's session: a server ticking at 30Hz, a link that may hold packets
// back, and a client drawing at `fps`. Returns every rendered step and how far
// behind the truth the drawn hull sat.
function fly({ fps, filter, seconds = 30, jitter = 0, lat = 0, seed = 7, speed = V }) {
  const h = 1000 / fps, rand = rng(seed);
  const arrive = [];
  let last = -1e9;
  for (let j = 0; j < Math.ceil(seconds * 1000 / TICK_MS) + 8; j++) {
    // In order, because a WebSocket delivers in order however late it is.
    last = Math.max(last, j * TICK_MS + lat + (jitter ? rand() * jitter : 0));
    arrive.push(last);
  }
  const s = { x: 0, y: 0, px: 0, py: 0, rx: 0, ry: 0 };
  let j = 0, snapAt = 0, prev = 0, was = 0;
  const steps = [], lags = [];
  const N = Math.floor(seconds * fps);
  for (let k = 0; k < N; k++) {
    const now = k * h;
    while (j < arrive.length && arrive[j] <= now) {
      s.px = s.x; s.py = s.y;
      s.x = speed * (j * TICK_MS) / 1000;
      snapAt = arrive[j]; j++;
    }
    const dt = was ? (now - was) / 1000 : 1 / fps; was = now;
    filter(s, dt, now - snapAt);
    if (k > fps * 5) { steps.push(s.rx - prev); lags.push(speed * now / 1000 - s.rx); }
    prev = s.rx;
  }
  const lo = Math.min(...steps), hi = Math.max(...steps);
  return { lo, hi, want: speed / fps, spread: hi / lo,
           lag: lags.reduce((a, b) => a + b, 0) / lags.length };
}

const table = (label, filter, opt) => {
  console.log(`\n  ${label}`);
  console.log('     fps   slowest   fastest   should be    spread      lag');
  const rows = {};
  for (const fps of RATES) {
    const r = rows[fps] = fly({ fps, filter, ...opt });
    console.log(`  ${String(fps).padStart(6)}  ${r.lo.toFixed(2).padStart(7)}px ${r.hi.toFixed(2).padStart(8)}px ` +
                `${r.want.toFixed(2).padStart(9)}px  ${r.spread.toFixed(2).padStart(7)}x ${r.lag.toFixed(1).padStart(7)}px`);
  }
  return rows;
};

console.log('\na ship at a constant 300px/s, on a perfect link');
const before = table('the fixed 0.35 per frame that shipped', OLD, {});
const after  = table('easing over elapsed time, aimed where the ship has flown to', chase, {});

check('the old smoothing got worse the better your monitor was',
  before[30].spread < 1.01 && before[60].spread > 1.5 && before[120].spread > 3 && before[144].spread > 5,
  `steps spread ${before[30].spread.toFixed(2)}x at 30fps and ${before[144].spread.toFixed(2)}x at 144 — ` +
  `${before[144].lo.toFixed(2)}px next to ${before[144].hi.toFixed(2)}px where every one should be 2.08`);

check('a ship at a constant speed now moves the same distance every frame',
  RATES.every(f => after[f].spread < 1.02),
  RATES.map(f => `${f}fps ${after[f].spread.toFixed(2)}x`).join(', '));

check('and it draws the distance it actually travelled, not some fraction of it',
  RATES.every(f => Math.abs(after[f].hi - after[f].want) < 0.05 * after[f].want),
  RATES.map(f => `${f}fps ${after[f].hi.toFixed(2)}px against ${after[f].want.toFixed(2)}`).join(', '));

check('nothing was bought with lag — the hull sits no further behind than it did',
  RATES.every(f => after[f].lag <= before[f].lag + 3),
  RATES.map(f => `${f}fps ${after[f].lag.toFixed(0)}px against ${before[f].lag.toFixed(0)}`).join(', '));

console.log('\nand on the link this was actually reported from — 40ms out, 20ms of jitter');
const jit = { jitter: 20, lat: 40 };
const jBefore = table('the fixed 0.35 per frame that shipped', OLD, jit);
const jAfter  = table('easing over elapsed time, aimed where the ship has flown to', chase, jit);

check('a late packet used to stop the ship dead and then fling it',
  jBefore[120].spread > 10 && jBefore[144].spread > 10,
  `${jBefore[144].lo.toFixed(2)}px next to ${jBefore[144].hi.toFixed(2)}px at 144fps — a spread of ${jBefore[144].spread.toFixed(0)}x`);

check('now it coasts through one, at every frame rate',
  RATES.every(f => jAfter[f].spread < 2.5),
  RATES.map(f => `${f}fps ${jAfter[f].spread.toFixed(2)}x`).join(', '));

check('and it is no longer the good monitors that suffer',
  jAfter[144].spread < jAfter[60].spread * 1.3 && after[144].spread < after[60].spread * 1.3,
  `144fps spreads ${jAfter[144].spread.toFixed(2)}x against 60fps at ${jAfter[60].spread.toFixed(2)}x, ` +
  `where the old line went ${jBefore[60].spread.toFixed(1)}x to ${jBefore[144].spread.toFixed(0)}x`);

console.log('\nthe filter itself');
{
  // The claim the whole change rests on: the same wall-clock time closes the same
  // fraction of the gap however many frames it was cut into. `since` is held at
  // zero so this measures the easing alone, with nothing flown forward.
  // Exactly a tenth of a second either way — a loop of `fps / 10` frames runs 14
  // of them at 144fps, which is 97ms, and 3ms is bigger than what is being measured.
  const tenth = (fps, filter) => {
    const n = Math.round(fps / 10), s = { x: 100, y: 0, px: 100, py: 0, rx: 0, ry: 0 };
    for (let k = 0; k < n; k++) filter(s, 0.1 / n, 0);
    return 100 - s.rx;                                            // what is LEFT of the gap
  };
  const left = RATES.map(f => tenth(f, chase));
  check('the same tenth of a second closes the same gap at 30fps and at 144',
    Math.max(...left) - Math.min(...left) < 0.2,
    left.map((v, i) => `${RATES[i]}fps leaves ${v.toFixed(2)}px of 100`).join(', '));
  const was = RATES.map(f => tenth(f, OLD));
  check('where the old one left a hundredth of the gap at 144fps and a quarter of it at 30',
    was[0] / was[was.length - 1] > 50,
    was.map((v, i) => `${RATES[i]}fps leaves ${v.toFixed(2)}px of 100`).join(', ') +
    ' — the same filter name, two orders of magnitude apart');
}

console.log('\nflying the last snapshot forward');
{
  const s = { x: 1000, y: 500, px: 1000 - V * TICK_MS / 1000, py: 500, rx: 1000, ry: 500 };
  check('a ship is drawn where it has got to, not where the last packet found it',
    reckon(s, TICK_MS).x > s.x + 9,
    `one tick after the snapshot it is ${(reckon(s, TICK_MS).x - s.x).toFixed(1)}px on, at 300px/s`);
  check('and never further ahead than the worst late packet on the measured link',
    Math.abs(reckon(s, 5000).x - reckon(s, AHEAD_MS).x) < 1e-9 && AHEAD_MS === 2 * TICK_MS,
    `capped at ${AHEAD_MS.toFixed(0)}ms — the link this was reported from had no arrival gap over 66ms`);
  check('a clock that reads backwards flies nothing backwards',
    reckon(s, -900).x === s.x,
    'the render harness hands frames a timestamp near zero against a real snapAt');
}

console.log('\nwhat is not smoothing');
{
  const jump = { x: 9000, y: 9000, px: 1000, py: 1000, rx: 1000, ry: 1000 };
  chase(jump, 1 / 60, TICK_MS);
  check('a jump, a fold or a respawn is arrived at, not flown to',
    jump.rx === 9000 && jump.ry === 9000,
    `a ${SNAP_PX}px step is more than fourteen ticks of the fastest hull in the game, so it was not travel`);
  const fresh = { x: 4000, y: 4000, px: 4000, py: 4000, rx: NaN, ry: NaN };
  chase(fresh, 1 / 60, 0);
  check('a ship seen for the first time is simply there',
    fresh.rx === 4000 && fresh.ry === 4000, 'no streak in from wherever the last one was');
  const still = { x: 500, y: 500, px: 500, py: 500, rx: 480, ry: 500 };
  chase(still, 0, 0);
  check('a frame of no length moves nothing', still.rx === 480, 'and does not divide by it either');
  const nan = { x: 500, y: 500, px: 500, py: 500, rx: 480, ry: 500 };
  chase(nan, NaN, NaN);
  check('and neither does a frame that has lost its clock',
    Number.isFinite(nan.rx) && Number.isFinite(nan.ry), 'test/render.mjs rejects a NaN reaching the canvas');
}

console.log('\nthe constant, shown working');
check('the easing is the old filter written down as a rate, not a new feel',
  Math.abs(Math.pow(EASE, 1 / 60) - 0.65) < 1e-12,
  '65% of the gap left after a sixtieth of a second — which is what 0.35 a frame meant on the 60Hz screen it was tuned on');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — ship smoothing'}\n`);
process.exit(fails.length ? 1 : 0);
