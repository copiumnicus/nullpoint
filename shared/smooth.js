// How a ship gets from where the server last said it was to where it is drawn.
//
// The server ticks 30 times a second and the client draws as fast as the monitor
// will let it, so the position on the wire is a staircase and the position on
// screen must not be. This module owns the two halves of turning one into the
// other, and it lives here rather than in the client because it is a rule with a
// number in it and rules with numbers get tested.
//
// The bug it was written for: the client used to run
//
//     s.rx += (s.x - s.rx) * 0.35;
//
// once per RENDERED FRAME. A fixed fraction per frame is a different filter at
// every frame rate — 35% of the gap in 33ms on a 30Hz screen is 35% of the gap in
// 7ms on a 144Hz one, which is five times as stiff — so the better the monitor,
// the more unevenly the ship moved. Simulated at a constant 300px/s on a PERFECT
// network, the slowest and fastest step of one second of frames came out:
//
//     30fps   10.00px .. 10.00px   (should be 10.00)   1.00x
//     60fps    3.94   ..  6.06     (should be  5.00)   1.54x
//    120fps    1.17   ..  4.26     (should be  2.50)   3.64x
//    144fps    0.71   ..  4.21     (should be  2.08)   5.95x
//
// and with 20ms of arrival jitter on top — the London-to-Netherlands link this was
// reported from — 144fps spread 0.22px to 5.17px, a ratio of 23. The camera follows
// the local ship's drawn position, so that is the whole screen moving unevenly.
//
// Two things fix it, and both are needed:
//
//   1. Ease over ELAPSED TIME, not per frame. Same shape as `ease()` in
//      shared/scroll.js, and the same trap: it must run off the timestamp the
//      frame was handed, never the wall clock, because the render harness drives
//      frames inside a few milliseconds of real time and an easing measured
//      against performance.now() never advances. CLAUDE.md names this.
//
//   2. Aim at where the ship IS, not where it was last seen. Easing at a
//      staircase is uneven however carefully it is scaled — the step is large
//      just after a snapshot lands and small just before the next one, and the
//      ratio between them is e^(tick/timeConstant) no matter what the frame rate
//      is. Flying the last snapshot forward turns the staircase into a ramp, and
//      a ramp eases to a constant step. Rockets and orbs have done this off
//      `snapAt` since they were written; ships never got it.
//
// Together they take the table above to a flat 1.00x at every frame rate, at LESS
// lag than the old line had at 30 and 60fps. test/smooth.mjs is that measurement.

import { TICK_MS } from './sim.js';

// How much of the gap is still there one second later. Derived rather than
// picked: the old line left 65% of the gap after every frame and was tuned on a
// 60Hz screen, so this is exactly that filter written down as a rate — a 144Hz
// pilot now gets the smoothing a 60Hz pilot always had instead of one five times
// stiffer. Softening it further would smooth the residual jitter and cost latency
// in a game whose complaint was latency, so it stops here.
//
// Its time constant is 39ms, and that is where the lag lives. At 300px/s the
// drawn hull sits 7 / 9 / 10 / 11px behind the wire at 30 / 60 / 120 / 144fps,
// against 19 / 12 / 8 / 9px for the old line — better at the rates most people
// have, two pixels worse on a 144Hz screen, and worth it for a spread that goes
// from 5.95x to 1.00x.
export const EASE = Math.pow(0.65, 60);          // 5.9e-12

// How far past the last snapshot a ship may be flown. Two ticks, because the
// measured link this was reported from had p99 arrival gaps under 37ms and no
// gap over 66ms — so two ticks is "keep coasting through the worst packet that
// actually arrives late" and not a second more. Past it the ship coasts to a
// stop and waits, which is the right failure: a hull that stops is wrong by a
// bounded amount, one that keeps predicting is wrong without limit.
export const AHEAD_MS = TICK_MS * 2;

// A step no ship could have flown in one tick, so it was a jump, a fold or a
// respawn rather than travel. The fastest hull in the game does 430px/s and every
// technology BUYS things with speed, so nothing exceeds 14px a tick; 200px is
// fourteen times that and cannot be reached by flying. It matters because
// extrapolating a teleport would fling the drawn hull a second sector's width
// past the arrival, and because easing across one draws the ship streaking over
// the map for a third of a second when it should simply be there.
export const SNAP_PX = 200;

// Where the server's ship is RIGHT NOW, as opposed to where it was when the
// snapshot left. `px`/`py` are the previous snapshot's position and the tick is a
// known 33.3ms, so the difference IS the velocity — the wire has never carried
// one and does not need to. `since` is milliseconds since that snapshot landed,
// the same `now - snapAt` the rockets fly forward on.
export function reckon(s, since) {
  const dx = s.x - (Number.isFinite(s.px) ? s.px : s.x);
  const dy = s.y - (Number.isFinite(s.py) ? s.py : s.y);
  if (Math.abs(dx) > SNAP_PX || Math.abs(dy) > SNAP_PX) return { x: s.x, y: s.y, jumped: true };
  // Clamped at zero as well as at the ceiling, and written as `since > 0` rather
  // than Math.max so that a `since` which is not a number lands on zero instead
  // of on NaN — a stationary ship has dx of 0, and 0 * NaN is NaN, which reaches
  // the canvas and is exactly what test/render.mjs rejects. It goes NEGATIVE for
  // real in the render harness, where the frame timestamp starts near zero and
  // `snapAt` is a real performance.now(), and a negative would fly ships backwards.
  const ahead = (since > 0 ? Math.min(AHEAD_MS, since) : 0) / TICK_MS;
  return { x: s.x + dx * ahead, y: s.y + dy * ahead, jumped: false };
}

// Move the drawn position toward it. `dt` is SECONDS since the last drawn frame,
// `since` is milliseconds since the last snapshot; both are already computed by
// the render loop, and neither is the wall clock.
export function chase(s, dt, since) {
  const to = reckon(s, since);
  // A ship being drawn for the first time, and one that teleported, are the same
  // case: there is nowhere to ease from.
  if (to.jumped || !Number.isFinite(s.rx) || !Number.isFinite(s.ry)) {
    s.rx = s.x; s.ry = s.y;
    return s;
  }
  // A frame of no length moves nothing, and a dt that is somehow not a number is
  // a frame of no length. Ceiling at 0.1s so a tab that was hidden for a minute
  // catches up rather than dividing by a clock nobody was watching.
  const step = Math.min(0.1, dt > 0 ? dt : 0);
  const f = 1 - Math.pow(EASE, step);
  s.rx += (to.x - s.rx) * f;
  s.ry += (to.y - s.ry) * f;
  return s;
}
