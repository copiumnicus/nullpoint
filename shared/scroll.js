// Scrolling, once.
//
// There were four scrolling lists in this game and four scrolls. The threat file
// moved by pixels, eased toward where the wheel asked, and clipped its rows at the
// window edge. The shop, the locker and the stats page snapped to whole rows — so a
// notch jumped a 58px card in one frame, which is not scrolling, it is two different
// lists shown in succession. The changelog had a third arrangement.
//
// Worse, they shared a wheel handler that added "2" to whichever was open: two ROWS
// on the shop and two PIXELS on the stats page. The stats page could not be scrolled
// at all, and nobody noticed until a whole column of attributes turned out to be
// unreachable.
//
// So: one module. A list gives it how tall its content is and how tall its window
// is, and gets back where to draw and what the bar looks like. Everything that
// scrolls in this game scrolls the same way, and improving it improves all of them.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// How much of the remaining distance is closed per second — the same fraction
// whatever the frame rate, so it settles in about a fifth of a second at 30fps and
// at 144. Small numbers ease harder.
export const EASE = 0.0001;

// One wheel notch. 62 rather than a row height, because rows are different heights
// on the stats page and a notch should feel the same everywhere.
export const NOTCH = 62;

// A list's scroll position. `want` is where the wheel has asked to be; `at` is where
// it is drawn, chasing. The difference between them is the entire reason it feels
// like anything.
export const scroller = () => ({ want: 0, at: 0, tick: 0 });

// The distance there is to scroll. Zero when the content fits, which is what every
// caller wants to know before it draws a bar.
export const spanOf = (content, room) => Math.max(0, content - room);

// A notch. Clamped at BOTH ends — clamped only at zero, scrolling past the bottom
// keeps counting and coming back does nothing until every phantom step is undone,
// which reads exactly like a list that does not scroll. That shipped once already.
export function wheel(s, deltaY, max, notch = NOTCH) {
  s.want = clamp(s.want + Math.sign(deltaY) * notch, 0, Math.max(0, max));
  return s.want;
}

// Ease toward it, off the timestamp the FRAME was handed rather than the wall clock.
// The render harness drives frames inside a few milliseconds of real time, so an
// easing measured against performance.now() never advances and the list looks frozen
// to the only thing that could have tested it. CLAUDE.md names this exact trap.
export function ease(s, now, max) {
  const top = Math.max(0, max);
  s.want = clamp(s.want, 0, top);
  const dt = clamp((now - (s.tick || now)) / 1000, 0, 0.05) || 0.016;
  s.tick = now;
  s.at += (s.want - s.at) * (1 - Math.pow(EASE, dt));
  if (Math.abs(s.want - s.at) < 0.5) s.at = s.want;
  s.at = clamp(s.at, 0, top);
  return s.at;
}

// Which fixed-height rows overlap the window, with their real positions. Rows at the
// edges are handed back overhanging on purpose — the caller clips, which is what
// makes a row leaving the top get CUT rather than drawn across the header.
export function rowsIn({ x, top, room, w, n, rowH, at, gap = 0 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = top + i * rowH - at;
    if (y + rowH < top || y > top + room) continue;
    out.push({ i, r: { x, y, w, h: rowH - gap } });
  }
  return out;
}

// And rows of DIFFERENT heights, which is the stats page. Same contract: positions
// are real, the edges overhang, the caller clips.
export function stackIn({ x, top, room, w, heights, at, gap = 0 }) {
  const out = [];
  let y = top - at;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (y + h > top && y < top + room) out.push({ i, r: { x, y, w, h: h - gap } });
    y += h;
  }
  return out;
}

export const heightOf = heights => heights.reduce((n, h) => n + h, 0);

// The thumb. Null when there is nothing to scroll, so a caller cannot draw a bar
// that does not mean anything.
export function barIn({ x, top, room, content, at, w = 3, min = 24 }) {
  const max = spanOf(content, room);
  if (max <= 0) return null;
  const h = Math.max(min, room * (room / content));
  return { x, y: top + (room - h) * (clamp(at, 0, max) / max), w, h,
           track: { x, y: top, w, h: room } };
}
