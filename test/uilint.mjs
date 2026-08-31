// The rules. Given one frame of recorded elements, what would a player be unable
// to read?
//
// Three of them are asserted by test/render.mjs on every frame it draws:
//
//   collisions  two labels printed through each other
//   crossings   a label written across something that is not its own frame —
//               a sentence over the minimap, a hint over a button
//   crowding    two labels with too little space between them to read either
//
// They are one idea in three shapes, and what makes all three usable is the same
// two facts: DRAW ORDER says who is on top, and CONTAINMENT says what a label
// belongs to. "Do two boxes intersect" reports thousands and is useless: text
// sits ON its button, a value sits IN its row, a panel sits OVER the world. What
// is being asked is narrower and mechanical — WOULD A PLAYER SEE TWO THINGS IN
// THE SAME PIXELS, OR TOO CLOSE TO TELL APART. So, for the first of them:
//
//   * text against text only. Text on a rect is a label; a rect on a rect is
//     layering. Two labels crossing is nobody's design.
//   * painter's algorithm decides the rest. If any near-opaque rect was drawn
//     after the lower piece of text and covers the region where they meet, the
//     lower one is not on screen there and there is nothing to report. That one
//     test dismisses every panel over the HUD, every tooltip over the world and
//     every modal over everything, without a single hand-written exception.
//   * world space never counts, and neither does anything the clip discarded.
//
// The other two say why they are shaped the way they are where they are defined.
//
// Three numbers decide what is worth a person's time, and each is stated in
// units of the thing it measures rather than picked:
//   COVER how opaque a rect has to be to hide what is under it. The client's
//         panels are painted between 0.82 and 0.98, and nothing else is.
//   WIDE  2px is a third of a character at 11px. Anything narrower is inside the
//         error of any font metric and is not something a player can see.
//   DEEP  35% of the shorter box. A descender is about 22% of an ink box, and a
//         12px line on a 10px pitch legitimately hangs its tails into the cap
//         height of the line below — that is crowding, not collision. Anything
//         sharing more than a third of its height is two labels on one line.
//
// None of them is a tuned number: over a clean tree the whole suite is silent at
// COVER anywhere in 0.50..0.82, WIDE 1..4, DEEP 0.25..0.5, ASCENT 0.70..0.75 and
// a monospace advance of 0.58..0.62 — a +/-3% error in the font metric. Above
// COVER 0.82 it stops believing the star chart's own 0.86 wash and reports what
// is underneath it, which is where the number comes from and not a coincidence.
export const COVER = +(process.env.COVER || 0.80), WIDE = +(process.env.WIDE || 2.0),
             DEEP = +(process.env.DEEP || 0.35), VEIL = 0.5;

const inter = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), t = Math.min(a.y + a.h, b.y + b.h);
  return r > x && t > y ? { x, y, w: r - x, h: t - y } : null;
};
const holds = (o, i) => o.x <= i.x + 0.5 && o.y <= i.y + 0.5 &&
                        o.x + o.w >= i.x + i.w - 0.5 && o.y + o.h >= i.y + i.h - 0.5;

// what is left of `r` once every rect in `cuts` is taken out of it
export const carve = (r, cuts) => {
  let out = [r];
  for (const c of cuts) {
    const next = [];
    for (const p of out) {
      const i = inter(p, c);
      if (!i) { next.push(p); continue; }
      if (i.y - p.y > 0.5) next.push({ x: p.x, y: p.y, w: p.w, h: i.y - p.y });
      if (p.y + p.h - (i.y + i.h) > 0.5) next.push({ x: p.x, y: i.y + i.h, w: p.w, h: p.y + p.h - i.y - i.h });
      if (i.x - p.x > 0.5) next.push({ x: p.x, y: i.y, w: i.x - p.x, h: i.h });
      if (p.x + p.w - (i.x + i.w) > 0.5) next.push({ x: i.x + i.w, y: i.y, w: p.x + p.w - i.x - i.w, h: i.h });
    }
    out = next;
    if (!out.length) break;
  }
  return out;
};

const visible = e => e.kind === 'text' && !e.world && e.a > 0.06 && e.w > 0.5 && e.h > 0.5;
// One character, in ems. The same advance uibox.mjs builds every width from, so
// a rule stated in characters and a box measured in pixels cannot disagree.
export const MONO_EM = +(process.env.MONO || 0.6);

// A wash over the WHOLE window is a scene change, whatever it is painted with:
// the station's 0.92 dim, the menu's 0.86, the death screen's red gradient. What
// was on screen before it is a different picture and is not compared with what
// comes after. Without this the death screen alone reported ten collisions with
// the station panel it had just covered up.
export const since = (els, W, H) => {
  let at = 0;
  for (const e of els)
    if (!e.world && e.a >= VEIL && e.kind !== 'text' &&
        e.w >= W * 0.95 && e.h >= H * 0.95) at = e.i;
  return at ? els.filter(e => e.i >= at) : els;
};
// A cover is judged by the PAINT, not by how far through a fade it is. The
// award banner is painted rgba(6,10,16,0.88) and fades in over 250ms; on the two
// frames where the fade has it at 0.6 it stopped hiding the status line under it
// and the rule reported three collisions with something the author plainly meant
// to be covered. Intent is in the colour.
const solid = e => e.kind === 'rect' && !e.world && (e.paint ?? 0) >= COVER && e.w > 2 && e.h > 2;

// The panel a piece of text belongs to: the smallest solid rect painted before
// it that holds it. Used only for the report — a failure that names the panel
// and both strings is one somebody can go and look at.
// The surface a piece of text sits on is the LAST solid painted under it, not
// the smallest one. Smallest picks whatever decorative chip happens to lie
// under the string — the threat file's footer was attributed to an ammunition
// box two layers below it, because the box is 64px and the panel is 620.
const panelOf = (e, solids) => {
  let best = null;
  for (const s of solids) if (s.i < e.i && holds(s, e) && (!best || s.i > best.i)) best = s;
  return best;
};
const titleOf = (p, texts) => {
  if (!p) return null;
  let best = null;
  for (const t of texts) if (t.i > p.i && holds(p, t) && (!best || t.size > best.size)) best = t;
  return best?.text ?? null;
};

// --- one: two labels printed through each other -----------------------------
export function collisions(all, W = Infinity, H = Infinity) {
  const els = since(all, W, H);
  const texts = els.filter(visible), solids = els.filter(solid);
  const out = [];
  for (let a = 0; a < texts.length; a++) {
    const A = texts[a];
    for (let b = a + 1; b < texts.length; b++) {
      const B = texts[b];
      const hit = inter(A, B);
      if (!hit) continue;
      // The same string drawn twice on the same spot is a glow or a shadow pass.
      if (A.text === B.text && hit.w * hit.h > 0.9 * Math.min(A.w * A.h, B.w * B.h)) continue;
      // Measure what is LEFT of the overlap once everything painted over the
      // lower one is taken out of it. Measuring the raw intersection reported a
      // tooltip against the row under it on the strength of the one pixel of
      // blurb that hangs below the tooltip's own frame.
      const seen = carve(hit, solids.filter(s => s.i > A.i))
                     .sort((p, q) => q.w * q.h - p.w * p.h)[0];
      if (!seen || seen.w < WIDE || seen.h < DEEP * Math.min(A.h, B.h)) continue;
      const p = panelOf(A, solids) ?? panelOf(B, solids);
      out.push({ a: A, b: B, box: seen, panel: p, title: titleOf(p, texts) });
    }
  }
  return out;
}

// --- two: a label written across something that is not its own frame --------
//
// Rule one is text against text and says so: "a label on its button, a value in
// its row, a tooltip over the world" are rects under text, and reporting those
// is thousands of findings and no signal. That is true of a label that BELONGS
// to its rect. It is not true of a sentence laid across a control that has
// nothing to do with it, which is what a designer means by "the H station, the
// R research, the M star system are all on top of the star system button, the
// minimap, and what is currently playing".
//
// What separates the two is not a list of exceptions, it is two facts the
// recorder already has:
//
//   ORDER. A control drawn AFTER a label covers it — that is a panel over the
//   HUD, a modal over everything, and it is the layering working. A label drawn
//   AFTER a control is written ON it. Only that direction is a finding, and it
//   is why this needs no exception for the station panel, the tooltips or the
//   death screen: they are all rects that come later.
//
//   CONTAINMENT. A label inside a rect belongs to it. Every legitimate case is
//   fully contained — the tab label in its tab, the row name in its row, the
//   value in its cell, the SPACE cap in its chip. Every case a designer
//   complains about crosses a boundary. One geometric test, no list.
//
// A label's own FRAME is the smallest rect drawn before it that holds it whole.
// Anything nested inside that frame is part of the same widget and is skipped —
// which is what excuses a progress fill under a centred button label, where the
// fill's right edge sweeps through the text as it fills.
//
// EDGE is how far a label has to be over the line before it counts. Below one
// character it is a label touching the corner of something, which is a designer
// nudging by a pixel and not a bug; the game is entirely monospace, so a
// character is the honest unit and it is the same 0.6em the widths are built
// from.
export const EDGE = +(process.env.EDGE || 1.0);   // in characters of the LABEL's own font

const box = e => ({ x: e.x, y: e.y, w: e.w, h: e.h });
// Does this label belong INSIDE this rect? Not `holds`, which is exact: a note
// whose descenders hang one pixel below its tooltip is still that tooltip's
// note, and calling it a stranger reported five of them. The slack is a
// character across and a descender down — the two amounts a label is allowed to
// be proud of its own box before somebody would call it outside it.
const belongs = (r, t) => {
  const s = EDGE * MONO_EM * t.size, v = 0.25 * t.size;
  return t.x >= r.x - s && t.x + t.w <= r.x + r.w + s &&
         t.y >= r.y - v && t.y + t.h <= r.y + r.h + v;
};
// A thing with an edge: something filled or outlined, in screen space, that a
// player can see. `blob` is excluded — an arc's bounding box is bigger than its
// ink, so the reactor dial would claim a square it does not occupy.
const bounded = e => (e.kind === 'rect' || e.kind === 'strokerect') &&
                     !e.world && e.a > 0.06 && e.w > 2 && e.h > 2;

// A label's own frame: the LAST box drawn before it that it sits inside — the
// surface it was painted onto, the same thing panelOf learned to look for.
// Smallest is wrong for the same reason it was wrong there: a tooltip line
// floating over a shop row is inside both the tooltip and the row, the row is the
// smaller of the two, and calling the row its frame made a tooltip and the row it
// covers members of one layout. That was four of the six tightest pairs in the
// game.
//
// Rule two asks whether a rect is that frame; rule three asks whether two labels
// share one, because crowding is a property of a LAYOUT and two layers that
// happen to land near each other are not a layout.
const frameOf = (T, rects) => {
  let frame = null;
  for (const r of rects) if (r.i < T.i && belongs(r, T) && (!frame || r.i > frame.i)) frame = r;
  return frame;
};
// Never a frame: a rect the size of the window is the page, not a widget, and it
// would own every label on screen and dismiss all of them.
const widgets = (els, W, H) =>
  els.filter(bounded).filter(e => !(e.w >= W * 0.95 && e.h >= H * 0.95));

export function crossings(all, W = Infinity, H = Infinity) {
  const els = since(all, W, H);
  const texts = els.filter(visible), solids = els.filter(solid);
  const rects = widgets(els, W, H);
  const out = [];
  for (const T of texts) {
    const under = rects.filter(r => r.i < T.i);
    const frame = frameOf(T, rects);
    const slack = EDGE * MONO_EM * T.size;
    const done = [];
    for (const r of under) {
      if (belongs(r, T)) continue;                 // its frame, or a background it sits on
      if (frame && holds(frame, r)) continue;      // part of its own widget
      const hit = inter(T, r);
      if (!hit || hit.w < slack || hit.h < DEEP * T.h) continue;
      // Is the rect still THERE? Anything opaque painted after it — the station
      // panel, a modal, the label's own frame — has taken it off the screen, and
      // a label cannot be written across something that is not being drawn. This
      // is what dismisses the ammunition bar under an open threat file: the boxes
      // are drawn first, the panel covers them, and the panel's own footer sat
      // over where a box used to be.
      const left = carve(hit, solids.filter(s => s.i > r.i))
                     .sort((p, q) => q.w * q.h - p.w * p.h)[0];
      if (!left || left.w < slack || left.h < DEEP * T.h) continue;
      // A filled box and the outline drawn straight over it are ONE widget, and
      // reporting both says the same thing twice. Same edges to within a pixel is
      // the same box.
      if (done.some(d => Math.abs(d.x - r.x) < 1.5 && Math.abs(d.y - r.y) < 1.5 &&
                         Math.abs(d.w - r.w) < 2.5 && Math.abs(d.h - r.h) < 2.5)) continue;
      done.push(box(r));
      out.push({ a: T, r, box: left, frame, panel: panelOf(T, solids) });
    }
  }
  return out;
}
export const sayCross = c =>
  `"${c.a.text}" (${at(c.a)}) is written across a ${r1(c.r.w)}x${r1(c.r.h)} ${c.r.kind} at ` +
  `${r1(c.r.x)},${r1(c.r.y)}${c.r.src ? ` from index.html:${c.r.src}` : ''}; ` +
  `${r1(c.box.w)}x${r1(c.box.h)}px of it, and the label's own frame is ` +
  (c.frame ? `${r1(c.frame.w)}x${r1(c.frame.h)} at ${r1(c.frame.x)},${r1(c.frame.y)}` : 'nothing');

// --- three: two labels with nothing between them ---------------------------
//
// "There should be detection for meaningful padding between UI items, because
// some pieces of text are really crammed in between other pieces of text."
//
// Not sharing a pixel is not the same as being readable. Two labels a pixel
// apart are one label as far as a reader is concerned, and the game is entirely
// monospace, so the honest unit is the character cell the type is already set
// on: side by side, anything closer than ONE CHARACTER of the smaller font runs
// together, because that is exactly the space a reader uses to find a word
// boundary. Stacked, the unit is the descender — 0.2em is how far a 'g' hangs,
// so two lines closer than that have the tails of one in the caps of the next.
//
// Those two are not the same number and must not be: this UI legitimately pitches
// 12px rows 14px apart, which is a 3px ink gap, and a rule that wanted a
// character of clearance vertically would condemn every list in the game.
export const APART = +(process.env.APART || 1.0);   // characters, side by side
export const STACK = +(process.env.STACK || 0.2);   // ems, one above the other

const span = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

export function crowding(all, W = Infinity, H = Infinity) {
  const els = since(all, W, H);
  const texts = els.filter(visible), solids = els.filter(solid);
  const rects = widgets(els, W, H);
  const mine = new Map(texts.map(t => [t, frameOf(t, rects)]));
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const A = texts[i];
    for (let j = i + 1; j < texts.length; j++) {
      const B = texts[j];
      // Same layout, or no layout at all. A tooltip note that floats a fifth of a
      // pixel above the shop row underneath it is not crowding, it is two layers
      // — and unfiltered that was thirteen of the sixteen tightest pairs in the
      // game. Rule two is what catches a floating thing landing on a control.
      if (mine.get(A) !== mine.get(B)) continue;
      if (inter(A, B)) continue;                   // sharing ink is rule one's job
      const dy = span(A.y, A.y + A.h, B.y, B.y + B.h);
      const dx = span(A.x, A.x + A.w, B.x, B.x + B.w);
      const small = Math.min(A.size, B.size);
      let gap, way;
      // Side by side: they share a line, and the space between them is the space
      // a reader has to find the word boundary in.
      if (dy > 0 && dx <= 0 && dy >= 0.5 * Math.min(A.h, B.h)) { gap = -dx; way = 'beside'; }
      // Stacked: they share a column, and the space between them is leading.
      else if (dx > MONO_EM * small && dy <= 0) { gap = -dy; way = 'above'; }
      else continue;
      const need = way === 'beside' ? APART * MONO_EM * small : STACK * small;
      if (gap >= need - 1e-6) continue;            // 6.6 is not less than 6.6
      // Both have to still be on screen. A label a pixel from something a panel
      // is about to cover is not crowded, it is gone.
      const room = way === 'beside'
        ? { x: Math.min(A.x + A.w, B.x + B.w), y: Math.max(A.y, B.y), w: Math.max(gap, 0.5), h: dy }
        : { x: Math.max(A.x, B.x), y: Math.min(A.y + A.h, B.y + B.h), w: dx, h: Math.max(gap, 0.5) };
      if (!carve(room, solids.filter(s => s.i > Math.max(A.i, B.i))).length) continue;
      out.push({ a: A, b: B, gap, need, way, panel: panelOf(A, solids), frame: mine.get(A) });
    }
  }
  return out;
}
export const sayTight = c =>
  `"${c.a.text}" (${at(c.a)}) and "${c.b.text}" (${at(c.b)}) are ${r1(c.gap)}px apart ` +
  `${c.way === 'beside' ? 'side by side' : 'one above the other'}, and need ${r1(c.need)}` +
  (c.frame ? `; both inside ${r1(c.frame.w)}x${r1(c.frame.h)} at ${r1(c.frame.x)},${r1(c.frame.y)}` : '; neither inside anything');

// ---------------------------------------------------------------------------
// The three below are a HAND TOOL, not an assertion. `collisions` is what
// test/render.mjs runs on every frame; these are exported for somebody reading a
// layout, and they are not asserted for a stated reason each:
//
//   holed     found exactly one thing worth fixing — the bottom hotkey strip
//             running behind the ammunition bar — and then nothing. Most of what
//             it can say is a panel over a label, which is a panel doing its job.
//   overflows is about 11% false positives: the "box" a label starts in is
//             whatever solid rect happens to be under its first pixel, and a
//             heading that deliberately spans two columns starts in the first
//             one. A rule that cries wolf one time in nine is a rule people learn
//             to skip.
//   spilled   is true but mostly says the same two things: a hint strip written
//             for a 1600px window, drawn on a 1024px one.
//
// Wire one of them up the way `collisions` is wired if it earns it. The shape to
// copy is in render.mjs: bucket by `same(text)` so an eased scroll is one finding
// and not thirty.
// ---------------------------------------------------------------------------

// --- two: a sentence with a hole punched through the middle of it -----------
// A panel drawn over the TAIL of a line is a tooltip or a modal doing its job.
// A panel drawn over the MIDDLE of one, with words surviving on both sides, is
// a sentence a player reads half of. That is the only shape worth reporting,
// and it is the difference between two findings and forty-six.
export function holed(all, W = Infinity, H = Infinity) {
  const els = since(all, W, H);
  const texts = els.filter(visible), solids = els.filter(solid);
  const out = [];
  for (const A of texts) {
    // Read along the middle of the line, not over the whole box. A panel that
    // clips the descenders off the bottom of a label has not put a hole in it,
    // and testing the box would call that one — it was forty-six findings, and
    // forty-four of them were that.
    const y = A.y + A.h / 2;
    const cuts = solids.filter(s => s.i > A.i && s.y <= y && s.y + s.h >= y &&
                                    s.x < A.x + A.w && s.x + s.w > A.x)
                       .map(s => ({ s, x0: Math.max(s.x, A.x), x1: Math.min(s.x + s.w, A.x + A.w) }))
                       .sort((p, q) => p.x0 - q.x0);
    if (!cuts.length) continue;
    let read = A.x, hole = null;                       // walk the line left to right
    for (const c of cuts) {
      if (c.x0 - read >= WIDE && A.x + A.w - c.x1 >= WIDE && c.x1 - c.x0 > (hole?.w ?? 0))
        hole = { x: c.x0, y: A.y, w: c.x1 - c.x0, h: A.h, by: c.s };
      read = Math.max(read, c.x1);
    }
    if (hole) out.push({ a: A, by: hole.by, gap: hole, panel: panelOf(A, solids) });
  }
  return out;
}

// --- three: text wider than the box it was put in --------------------------
// CLAUDE.md, rule one: "a row you can see but not click is the same bug as a row
// outside its panel, and it has happened twice". This is that, from the drawing
// side. The panel is the smallest solid rect painted before the text that the
// text STARTS inside; if the string runs out of the right of it, the box was
// sized for something shorter than what got put in it.
export function overflows(all, W = Infinity, H = Infinity) {
  const els = since(all, W, H);
  const texts = els.filter(visible), solids = els.filter(solid);
  const out = [];
  for (const A of texts) {
    const y = A.y + A.h / 2;
    let p = null;
    for (const s of solids)
      if (s.i < A.i && s.x <= A.x + 1 && s.x + s.w >= A.x + 1 && s.y <= y && s.y + s.h >= y &&
          (!p || s.i > p.i)) p = s;
    if (!p) continue;
    const over = A.x + A.w - (p.x + p.w);
    if (over > WIDE) out.push({ a: A, panel: p, over });
  }
  return out;
}

// --- four: drawn where the window is not -------------------------------------
export function spilled(els, W, H) {
  return els.filter(visible).filter(e =>
    e.x < -1 || e.y < -1 || e.x + e.w > W + 1 || e.y + e.h > H + 1);
}

// One report per pair of strings, not per frame and not per scroll position: the
// threat file drawn at twenty-six eased scroll offsets is one overlap, not
// twenty-six. x is kept because two columns of the same list are different bugs.
// Numbers are collapsed in the key: "x240" against a price and "x241" against
// the same price is one finding, not two, and an eased scroll position printed
// into a string is thirty.
export const same = t => String(t).replace(/[\d.]+/g, '#');
export const key = c => `${same(c.a.text)} ${same(c.b.text)} ${Math.round(c.a.x)}`;
const r1 = v => Math.round(v * 10) / 10;
const at = e => `${e.size}px at ${r1(e.x)},${r1(e.y)} ${r1(e.w)}x${r1(e.h)}` +
  (e.src ? `, index.html:${e.src}` : '');
const inPanel = p => p ? `, in the panel at ${r1(p.x)},${r1(p.y)} ${r1(p.w)}x${r1(p.h)}` : ', with no panel behind it';
export const say = c =>
  `"${c.a.text}" (${at(c.a)}) prints through "${c.b.text}" (${at(c.b)});` +
  ` ${r1(c.box.w)}x${r1(c.box.h)}px of shared ink at ${r1(c.box.x)},${r1(c.box.y)}` +
  inPanel(c.panel) + (c.title ? ` — "${c.title}"` : '');
export const sayHole = h =>
  `"${h.a.text}" (${at(h.a)}) has ${r1(h.gap.w)}px punched out of the middle of it at ` +
  `x ${r1(h.gap.x)}..${r1(h.gap.x + h.gap.w)} by a rect at ${r1(h.by.x)},${r1(h.by.y)} ` +
  `${r1(h.by.w)}x${r1(h.by.h)}` + (h.by.src ? ` from index.html:${h.by.src}` : '') + inPanel(h.panel);
export const sayOver = o =>
  `"${o.a.text}" (${at(o.a)}) runs ${r1(o.over)}px out of the right of the box it starts in` +
  `, which is ${r1(o.panel.w)}px wide at ${r1(o.panel.x)},${r1(o.panel.y)}` +
  (o.panel.src ? ` from index.html:${o.panel.src}` : '');
export const saySpill = (e, W, H) =>
  `"${e.text}" (${at(e)}) reaches ${r1(Math.max(0 - e.x, 0 - e.y, e.x + e.w - W, e.y + e.h - H))}px ` +
  `outside the ${W}x${H} window`;
