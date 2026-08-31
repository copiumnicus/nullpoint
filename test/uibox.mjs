// A geometry recorder for the render harness. The guard in render.mjs answers
// "did this frame draw anything malformed"; this answers "can a player read all
// of it at once". It sits under the same stub context, watches the same calls,
// and keeps for every one of them the rectangle it lands on, in CSS pixels.
//
// Three things make that possible at all:
//
//   1. The client draws its whole world inside one `g.scale(zoom, zoom)`. That
//      is the only scale() in the file, so a saved `world` flag set by scale()
//      and cleared by the matching restore() separates world space from HUD
//      space exactly — two ships overlapping on screen is the game working, and
//      those draws must never reach the rule. Comparing the matrix instead
//      would fail on any window where zoom happens to land on exactly 1.
//   2. Every font in the client is ui-monospace — 232 assignments, no
//      exceptions — so a width is length x 0.6em and nothing needs a metrics
//      table. 0.6 is SF Mono's advance exactly; Menlo and DejaVu Sans Mono are
//      0.602. The SAME function is handed to the client as measureText, so the
//      client and the checker cannot disagree about how wide a string is.
//   3. textBaseline is 'alphabetic' everywhere, so y is the baseline and the
//      box runs from baseline-ASCENT to baseline+DESCENT. Ink, not the em box:
//      rows are pitched 12px apart at a 12px font, and an em box would make
//      every list in the game a wall of overlaps.

export const MONO    = +(process.env.MONO || 0.6);   // advance width of ui-monospace, in ems
export const ASCENT  = +(process.env.ASC || 0.72);   // cap height, short of the ascender on purpose:
export const DESCENT = 0.20;   // a box that is too generous invents overlaps
const DESC = /[gjpqy,;()[\]{}\/\\|@_$]/;

export const fontPx = f => { const m = /(\d+(?:\.\d+)?)px/.exec(String(f)); return m ? +m[1] : 10; };
export const textWidth = (s, font) => String(s).length * MONO * fontPx(font);

// alpha of a fill, or null when it cannot be known — a gradient object, which
// is never treated as covering anything
export const alphaOf = v => {
  // A gradient knows its own stops — the stub hands them over — so the weakest
  // one is what it is guaranteed to hide. Without this the death screen's veil
  // counts as transparent and every label on it collides with the station panel
  // still drawn underneath: ten findings, one wash.
  if (v && typeof v === 'object' && v.__stops) return v.__stops.length ? Math.min(...v.__stops) : null;
  if (typeof v !== 'string') return null;
  if (v === 'transparent') return 0;
  if (/^#[0-9a-f]{8}$/i.test(v)) return parseInt(v.slice(7), 16) / 255;
  if (/^#[0-9a-f]{6}$/i.test(v) || /^#[0-9a-f]{3}$/i.test(v)) return 1;
  const m = /^rgba?\([^)]*?,[^,]*,[^,]*(?:,\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return m[1] === undefined ? 1 : +m[1];
  return null;
};

const EMPTY = { x: 0, y: 0, w: 0, h: 0 };
const inter = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), t = Math.min(a.y + a.h, b.y + b.h);
  return r > x && t > y ? { x, y, w: r - x, h: t - y } : null;
};

// Where a draw came from. The client module is pulled out of index.html at a
// known offset, so one frame of the stack is a line number somebody can open.
// Off unless asked for: a stack per draw call turns a 0.7s run into an 8s one,
// which is worth it when you are reading a report and not worth it in the suite.
export let LINE_OFFSET = 8;
export const setOffset = n => { LINE_OFFSET = n; };
const SRC = /\.client[-a-z]*\.mjs:(\d+):/;
const TRACE = !!process.env.SRC;
if (TRACE) Error.stackTraceLimit = 8;
const where = () => {
  if (!TRACE) return 0;
  const m = SRC.exec(new Error().stack);
  return m ? +m[1] + LINE_OFFSET : 0;
};

export class Tracker {
  constructor(dpr = 1) { this.dpr = dpr; this.els = []; this.reset(); }
  reset() {
    this.M = [this.dpr, 0, 0, this.dpr, 0, 0];   // what resize() leaves behind
    this.clip = null; this.world = false; this.alpha = 1; this.fill = '#000';
    this.font = '10px ui-monospace'; this.align = 'left'; this.base = 'alphabetic';
    this.stack = []; this._p = null; this._curvy = false; this.els = [];
  }
  // --- state, saved and restored for real. The stub used to make save() and
  // restore() no-ops, so an alpha set inside a save() leaked out of it and
  // every element after it was recorded at the wrong opacity.
  save() { this.stack.push([this.M.slice(), this.clip, this.world, this.alpha, this.fill,
                            this.font, this.align, this.base]); }
  restore() {
    const s = this.stack.pop(); if (!s) return;
    [this.M, this.clip, this.world, this.alpha, this.fill, this.font, this.align, this.base] = s;
  }
  mul(n) {                              // CTM = CTM * n, the order canvas uses
    const [a, b, c, d, e, f] = this.M, [A, B, C, D, E, F] = n;
    this.M = [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D,
              a * E + c * F + e, b * E + d * F + f];
  }
  setTransform(a, b, c, d, e, f) { this.M = [a, b, c, d, e, f]; }
  translate(x, y) { this.mul([1, 0, 0, 1, x, y]); }
  scale(x, y) { this.world = true; this.mul([x, 0, 0, y, 0, 0]); }   // the world pass, and only it
  rotate(r) { const s = Math.sin(r), c = Math.cos(r); this.mul([c, s, -s, c, 0, 0]); }
  pt(x, y) { const [a, b, c, d, e, f] = this.M;
             return [(a * x + c * y + e) / this.dpr, (b * x + d * y + f) / this.dpr]; }
  boxOf(x, y, w, h) {                   // screen-space bounds of a local rect
    const p = [this.pt(x, y), this.pt(x + w, y), this.pt(x, y + h), this.pt(x + w, y + h)];
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    return { x: Math.min(...xs), y: Math.min(...ys),
             w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  // --- paths, accumulated in screen space so fill() and clip() need no maths
  begin() { this._p = null; this._curvy = false; }
  grow(b) {
    if (!this._p) { this._p = { ...b }; return; }
    const x = Math.min(this._p.x, b.x), y = Math.min(this._p.y, b.y);
    const r = Math.max(this._p.x + this._p.w, b.x + b.w);
    const t = Math.max(this._p.y + this._p.h, b.y + b.h);
    this._p = { x, y, w: r - x, h: t - y };
  }
  path(x, y, w, h) { this.grow(this.boxOf(x, y, w, h)); }
  curve(x, y, w, h) { this._curvy = true; this.grow(this.boxOf(x, y, w, h)); }
  // A path that is only rects and roundRects fills the box it bounds, so it can
  // hide what is under it. One with an arc or a line in it does not — its box is
  // bigger than its ink — so it is recorded under a kind the cover test ignores.
  fill_() { if (this._p) this.push(this._curvy ? 'blob' : 'rect', this._p); }
  clipHere() { if (this._p) this.clip = this.clip ? (inter(this.clip, this._p) ?? EMPTY) : this._p; }
  // --- recording
  push(kind, box, extra = {}) {
    let b = box;
    if (this.clip) { b = inter(b, this.clip); if (!b) return; }    // clipped away: not drawn
    const ca = alphaOf(this.fill);
    const src = where();
    this.els.push({ i: this.els.length, kind, x: b.x, y: b.y, w: b.w, h: b.h, world: this.world,
                    a: this.alpha * (ca === null ? 1 : ca), gradient: ca === null,
                    paint: ca,          // opacity of the colour alone, fades not counted
                    fill: typeof this.fill === 'string' ? this.fill : 'gradient',
                    font: this.font, size: fontPx(this.font), src, ...extra });
  }
  rect(x, y, w, h, kind = 'rect') {
    if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
    this.push(kind, this.boxOf(x, y, w, h));
  }
  text(s, x, y) {
    const str = String(s); if (!str.trim()) return;
    const size = fontPx(this.font), w = textWidth(str, this.font);
    const x0 = this.align === 'center' ? x - w / 2 : this.align === 'right' ? x - w : x;
    const asc = ASCENT * size, desc = DESC.test(str) ? DESCENT * size : 0.02 * size;
    this.push('text', this.boxOf(x0, y - asc, w, asc + desc), { text: str });
  }
}
