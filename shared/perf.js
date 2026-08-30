// How the game is actually running, for the menu.
//
// Two numbers, and they answer different questions. Frame time is whether YOUR
// machine is keeping up; ping is whether the distance to the server is. A game
// that stutters tells you neither on its own, and the fix for one is not the fix
// for the other.
//
// Both are reported from a rolling window rather than instantaneously. An
// instantaneous frame time flickers too fast to read and shows you the wrong
// thing anyway: what ruins a game is not the average frame, it is the worst one
// in the last second, so the worst is reported next to the typical.

import { TICK_MS } from './sim.js';

// One server tick is the natural unit for both. The world only changes 30 times a
// second, so a client drawing faster than that is ahead of the game by
// definition, and a round trip inside one tick is a reply that arrives before
// anything it could have missed.
export { TICK_MS };

// A fixed ring, so measuring performance cannot itself allocate every frame.
export function sampler(size = 120) {
  return { buf: new Float64Array(size), n: 0, i: 0 };
}
export function push(s, v) {
  if (!Number.isFinite(v) || v < 0) return s;      // a clock that went backwards is not a sample
  s.buf[s.i] = v;
  s.i = (s.i + 1) % s.buf.length;
  s.n = Math.min(s.n + 1, s.buf.length);
  return s;
}
const live = s => Array.from({ length: s.n }, (_, k) => s.buf[k]).sort((a, b) => a - b);

// The typical frame and the worst recent one. p95 rather than the true maximum:
// one 400ms hitch while the tab was backgrounded is not a performance problem and
// should not be what the menu shows for the next two seconds.
export function stats(s) {
  if (!s.n) return null;
  const v = live(s);
  const at = q => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return { typical: at(0.5), worst: at(0.95), n: s.n };
}

// --- reading it -------------------------------------------------------------

// Sub-10ms frames do not need a decimal; a 6ms and a 6.4ms frame are the same
// news. Above that one decimal is the difference between 16.6 and 17.2, which is
// the difference between holding 60 and not.
export const fmtMs = ms =>
  !Number.isFinite(ms) ? '—' : ms >= 100 ? `${Math.round(ms)}ms`
  : ms >= 10 ? `${ms.toFixed(1)}ms` : `${ms.toFixed(1)}ms`;

export const fmtFps = ms =>
  !Number.isFinite(ms) || ms <= 0 ? '—' : `${Math.round(1000 / ms)}fps`;

// Green, amber, red — thresholds derived from the tick rather than picked. Drawing
// faster than the world changes is green; slower than the world changes is red,
// because past that you are seeing stale frames no matter how good the connection
// is. The same shape for ping, in whole ticks: inside one tick nothing can be
// missed, past four the world has moved on before you hear about it.
export const FRAME_GOOD = TICK_MS / 2;             // 16.7ms — 60fps
export const FRAME_POOR = TICK_MS;                 // 33.3ms — the tick itself
export const PING_GOOD  = TICK_MS * 2;             // 66.7ms
export const PING_POOR  = TICK_MS * 4;             // 133.3ms

export const GRADE = { good: '#7de08a', fair: '#e0a53f', poor: '#ff5c6b', none: '#66748c' };
// Half the displayed precision, so a number that READS as good grades as good.
// Without it a 16.7ms frame — which is 60fps, and prints as 60fps — came out amber
// because 16.7 is a thirtieth of a millisecond over one half-tick.
const EPS = 0.05;
const grade = (v, good, poor) =>
  !Number.isFinite(v) ? 'none' : v <= good + EPS ? 'good' : v <= poor + EPS ? 'fair' : 'poor';

export const frameGrade = ms => grade(ms, FRAME_GOOD, FRAME_POOR);
export const pingGrade  = ms => grade(ms, PING_GOOD, PING_POOR);

// What the menu prints. One line each, typical first because that is the number
// you live with, worst second because that is the number you notice.
export function frameLine(s) {
  const st = stats(s);
  if (!st) return { text: 'measuring…', grade: 'none' };
  return { text: `${fmtMs(st.typical)}  ${fmtFps(st.typical)}   worst ${fmtMs(st.worst)}`,
           grade: frameGrade(st.typical) };
}
export function pingLine(s) {
  const st = stats(s);
  if (!st) return { text: 'measuring…', grade: 'none' };
  return { text: `${fmtMs(st.typical)}   worst ${fmtMs(st.worst)}`, grade: pingGrade(st.typical) };
}
