// What window the game is actually being played in.
//
// This is ADVISORY and has to stay that way. The client is the only possible
// source of its own window size, so a client that lies gets a wrong row in
// /sizes and nothing else: nothing in the simulation may ever read a viewport.
// It is not position, it is not intent, and it decides nothing — which is why it
// can ride the intent path at all. If anything here ever starts feeding a
// hitbox, a range or a draw distance, it becomes a cheat, and the rule above is
// the reason it is written down here rather than assumed.
//
// It exists for one loop. test/render.mjs sweeps window sizes looking for panels
// that print through each other, and the sizes it swept were seven somebody
// picked out of the air. These are the ones the two people who actually play
// this game have in front of them, merged into that list.

// The shipped sweep — the seam. A fresh checkout and CI have no observed sizes
// and get exactly this, silently. The awkward ones at both ends are deliberate
// and are never merged away: 820x560 catches a panel running off the bottom that
// 1920x1080 has never once caught, and 2560x1440 catches things laid out from
// the centre drifting apart.
export const SIZES = [[2560, 1440], [1920, 1080], [1600, 900], [1366, 768],
                      [1280, 720], [1024, 640], [820, 560]];

// Clamped rather than dropped. A hand-edited save or a client saying 0x0 would
// otherwise lose the pilot from the distribution entirely, and the point of the
// distribution is who is playing on what. The bounds are the smallest window
// anybody drags a browser down to and the largest display that exists.
export const MIN_W = 320, MIN_H = 240, MAX_W = 7680, MAX_H = 4320;

// How much bigger the sweep may get, and how far apart two windows have to be
// before sweeping both is worth it.
//
// Every size in the sweep is another 28 frames through every panel, so twenty
// pilots must not become twenty times the work — hence the cap. NEAR is about
// cost and not about correctness: a window 40px taller does not move a label to
// a different row, it makes the same layout 40px taller, so re-checking it buys
// nothing. Two sizes count as one when BOTH axes are within it, so 1512x945 and
// 1600x900 are still two windows — the width differs by 88.
export const MAX_SIZES = 12, NEAR = 48;

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// A viewport off the wire or off disk. Both are untrusted for the same reason:
// one was JSON a moment ago.
export function sanitiseView(v, now = Date.now()) {
  if (!v || typeof v !== 'object') return null;
  const w = +v.w, h = +v.h;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const at = Number.isFinite(+v.at) ? Math.floor(+v.at) : now;
  // A device pixel ratio is free — the client already has it to size the canvas —
  // and it is the difference between "1280x720" meaning a small laptop and it
  // meaning a phone. Rounded to two places because 1.7647058823529411 is a
  // Windows scaling factor and nobody needs the tail of it.
  const dpr = Number.isFinite(+v.dpr) ? Math.round(clamp(+v.dpr, 1, 4) * 100) / 100 : 1;
  return { w: Math.round(clamp(w, MIN_W, MAX_W)), h: Math.round(clamp(h, MIN_H, MAX_H)),
           dpr, at: Math.min(now, at) };
}

// The distribution, out of the accounts file. One row per distinct window with a
// count, not a time series — "what sizes do people play at" is answered by the
// last size each pilot was seen at, and a log of every resize answers a question
// nobody asked and grows forever.
//
// Ordered by how many pilots, then SMALLEST first, so it is the same list on
// every machine and the cap below drops the least useful sizes rather than an
// arbitrary tail. Smallest first because that is the direction findings come
// from: panels are laid out from the viewport, so everything the sweep looks for
// — two labels sharing a pixel, a label written across the minimap, a pair
// crammed together — gets worse as the window shrinks and essentially never
// appears only at 7440x4025. When two windows have the same number of pilots
// behind them, the cramped one is the one worth the 28 frames.
export function viewsOf(accounts) {
  const by = new Map();
  for (const a of Object.values(accounts ?? {})) {
    const v = sanitiseView(a?.view);
    if (!v) continue;
    const k = `${v.w}x${v.h}`;
    const row = by.get(k) ?? { w: v.w, h: v.h, dpr: v.dpr, n: 0, at: 0 };
    row.n++;
    if (v.at > row.at) { row.at = v.at; row.dpr = v.dpr; }   // the freshest dpr wins
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.w - b.w || a.h - b.h);
}

const near = (a, b) => Math.abs(a[0] - b[0]) <= NEAR && Math.abs(a[1] - b[1]) <= NEAR;

// Observed sizes are MERGED into the shipped sweep, never substituted for it.
// A size somebody plays at is worth checking; that does not make 820x560 stop
// being worth checking, and dropping the extremes the moment two people with
// 1440p monitors sign in is how the sweep would quietly stop finding anything.
export function mergeSizes(observed = [], shipped = SIZES, cap = MAX_SIZES) {
  const out = shipped.map(([w, h]) => [w, h]);
  // The smallest shipped size is the floor, derived rather than picked: that list
  // IS the statement of what window this game claims to fit in, and sweeping
  // below it asserts a claim nobody has made.
  //
  // Found by fabricating forty accounts and running the sweep: sanitiseView
  // CLAMPS a nonsense report to 320x240 rather than dropping it, so that the
  // pilot keeps a row in /sizes — and without this line that clamped value went
  // straight into the sweep, which promptly went red at 420x320 over panels that
  // overlap in a window nobody has ever had. A client saying something stupid
  // must not be able to redden the suite. Supporting a smaller window is a
  // decision that lowers this list, with a patch note.
  const floorW = Math.min(...out.map(s => s[0])), floorH = Math.min(...out.map(s => s[1]));
  for (const o of observed) {
    if (out.length >= cap) break;
    const pair = Array.isArray(o) ? [Math.round(o[0]), Math.round(o[1])] : [Math.round(o.w), Math.round(o.h)];
    if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) continue;
    if (pair[0] < floorW || pair[1] < floorH) continue;
    if (out.some(s => near(s, pair))) continue;
    out.push(pair);
  }
  return out;
}

// "1512x945@2x x2". Short on purpose: /sizes goes down the chat line, and the
// client truncates an incoming line at MAX_LEN.
export const sayView = v => `${v.w}x${v.h}${v.dpr > 1 ? `@${v.dpr}x` : ''}${v.n > 1 ? ` x${v.n}` : ''}`;
