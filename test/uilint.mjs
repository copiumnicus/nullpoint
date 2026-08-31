// The rules. Given one frame of recorded elements, which pairs of things would a
// player see printed through each other?
//
// "Do two boxes intersect" reports thousands and is useless: text sits ON its
// button, a value sits IN its row, a panel sits OVER the world. What is being
// asked is narrower and mechanical — WOULD A PLAYER SEE TWO THINGS IN THE SAME
// PIXELS. So:
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
