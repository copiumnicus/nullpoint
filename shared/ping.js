// A ping: one pilot pointing at a place, and everyone in the sector seeing it.
//
// "Come here", "it is over there", "do not fly into that" are the three things
// four pilots in one sector need to say to each other, and until now the only
// way to say any of them was to type it and hope somebody was reading the chat
// log. A ping is those three sentences as one click on the chart.
//
// WHO SEES IT: everybody in the sector, whatever company they fly for, and
// deliberately ACROSS RADAR. That is a real decision and not an oversight of the
// rule that keeps an undetected enemy off the wire. The rule exists because a
// contact you have not earned must not leak; a ping is not a leak, it is a
// BROADCAST — the pilot chose to make it, their callsign is nailed to it, and it
// tells the sector roughly where they are as well as where they are pointing.
// That is the price of the mechanic and it is the reason it is worth having: a
// coordination tool only your own company can hear is free, and a free signal is
// not a decision. Company-only would also be a second copy of "who may see
// this", which is the rule this codebase writes rules against.
//
// THE COOLDOWN IS THE SERVER'S. Ten seconds, enforced in server.js against the
// clock, and this module holds the number and the sentence so the wait the chip
// draws and the refusal the server sends cannot drift apart — the same shape
// shared/ammo.js uses for whyNotBuySays.
//
// THE GEOMETRY IS HERE for the reason UI geometry always is: the minimap is 180px
// wide at 820x560 and the render harness asserts that nothing is written across
// it, so the labels have to be PART of the plot's layout rather than strings
// thrown over it. One source for where a name lands, and the client both draws
// and hit-tests from it.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// Ten seconds is the designer's number. Eight seconds of life is derived from
// it: a ping has to still be standing when the person it was meant for looks
// back at the chart, and it has to be GONE before the same pilot can drop
// another one, or a sector fills with a pilot's own history instead of what is
// happening now. Eight leaves a two-second gap where the chart is clean.
export const PING_COOLDOWN = 10;
export const PING_LIFE = 8;
// The last third of the life is the fade, so a ping that is about to lapse says
// so rather than blinking out. 2.7s of fade is long enough to read as a fade at
// 30Hz and short enough that the label is legible for the 5.3s before it.
export const PING_FADE = 0.33;
// The most a sector holds at once. Six pilots each pinging on cooldown is six
// live pings, which is the real ceiling with the party sizes this game has; past
// that the OLDEST is dropped, so a wall of names cannot be built by one pilot
// spamming (they cannot anyway — see the cooldown) or by a crowd (the freshest
// news wins, which is the news anybody wants). The plot's own height caps it
// again in pingLayout: a 120px plot has no room for six rows of type and says so
// by drawing fewer, rather than by printing them through each other.
export const PING_MAX = 6;

// One colour for every ping, never the pinger's company colour. "That is a ping"
// has to be readable in the quarter-second somebody glances at the plot, and the
// plot already spends red on hostiles, the company colours on rings and blue on
// your own course. The name says whose it is; the colour says what it is.
export const PING_TINT = '#ffd479';

// Type metrics. 0.6em is the ui-monospace advance the whole client is measured
// with — the same number test/uibox.mjs builds every box from, so a rule stated
// in characters here and a box measured in pixels there cannot disagree.
export const PING_FONT = 9;
const CH = 0.6 * PING_FONT;
// A chip 14px tall on a 16px pitch. The pitch is what keeps two names apart: the
// ink of a 9px line is 0.92em = 8.3px, so 16px of pitch leaves 7.7px of clear
// space between two labels, against the 1.8px the harness asks for.
const CHIP_H = 14, GAP = 2, PAD_X = 3, INSET = 3;
export const PING_ROW = CHIP_H + GAP;

// How far through its life, as an opacity. Clamped at both ends because `p` came
// off a wire a moment ago and a globalAlpha of NaN is a frame the render guard
// fails on.
export const pingAlpha = p => clamp((1 - clamp(fin(p), 0, 1)) / PING_FADE, 0, 1);

// The button, in the plot's own bottom-left corner.
//
// INSIDE the minimap on purpose, and that is the opposite of what was done to the
// hotkey strip — which was moved OFF the plot because a sentence about the H key
// has nothing to do with the chart it was lying across. This does: it is the
// chart's own control, it is where the cooldown for a chart gesture belongs, and
// putting it anywhere else would be a button in one corner for a click in
// another. The harness's rule is not "no text near the minimap", it is "no text
// across a control it has nothing to do with", and containment is what tells the
// two apart — so the chip is a frame of its own, painted opaque, with its label
// inside it.
export const pingChip = mm => {
  const w = Math.min(Math.max(0, fin(mm.w) - INSET * 2), 'PICK A SPOT'.length * CH + PAD_X * 2);
  return { x: fin(mm.x) + INSET, y: fin(mm.y) + fin(mm.h) - INSET - CHIP_H,
           w: Math.max(0, w), h: CHIP_H };
};

// What the button says. Three states and no fourth: ready, armed, and waiting —
// and the waiting one is the whole reason the button exists, because a gesture
// that does nothing and says nothing has been this designer's complaint four
// times over.
export const chipLine = ({ cool = 0, armed = false } = {}) =>
  fin(cool) > 0 ? `PING ${Math.ceil(fin(cool))}s` : armed ? 'PICK A SPOT' : 'PING';

// Why this pilot may not ping right now, in the pilot's own words, or null.
//
// Called by the SERVER when a mark arrives and by the CLIENT before it sends one,
// off the countdown the server put in the bag — so the client is reading the
// server's clock rather than running one of its own, and the two can only ever
// say the same sentence. A client that ignores this and sends anyway gets the
// same refusal back and nothing else: the cooldown is enforced against the wall
// clock in server.js and this function decides nothing.
export const whyNotPing = ({ cool = 0 } = {}) =>
  fin(cool) > 0 ? `Ping is recharging — ${Math.ceil(fin(cool))}s` : null;

const fit = (s, max) => (max < 2 ? '' : s.length <= max ? s : s.slice(0, max - 1) + '…');
const inRect = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export const onChip = (v, mm) => inRect(v, pingChip(mm));

// Where every live ping lands on the plot, and where its callsign is written.
//
// `list` is the wire's rows, `mm` the plot rectangle, `sector` the CHARTED size
// of this sector — the same sizeOf() the plot itself is drawn against, because a
// duel arena is a quarter of the galaxy's rectangle and a ping drawn at the
// galaxy's scale would sit in the top-left corner of the plot it was clicked in.
//
// WHAT HAPPENS WHEN THREE LAND ON TOP OF EACH OTHER, which is the question this
// function exists to answer. Every label gets a ROW OF ITS OWN. They are sorted
// down the plot, laid out top to bottom, and each one takes the first row at or
// below the one it wanted; a stack that runs off the bottom slides up as a
// block, which preserves every gap rather than crushing the last pair. So three
// pings in one corner are three names in three lines with the dots still where
// they were clicked — never two strings on one line, which is the only outcome a
// reader cannot recover from. The freshest win the rows when there are not
// enough: `p` ascending, so the news you have not read yet is the news that
// survives.
export function pingLayout(list, mm, sector, chip = pingChip(mm)) {
  const W = fin(mm.w), H = fin(mm.h), X = fin(mm.x), Y = fin(mm.y);
  if (!Array.isArray(list) || !list.length || W <= 0 || H <= 0) return [];
  const sw = Math.max(1, fin(sector?.w, 1)), sh = Math.max(1, fin(sector?.h, 1));
  const sx = W / sw, sy = H / sh;
  // The band the labels stand in: inside the frame, and clear of the button, so a
  // name and the cooldown never share the bottom-left corner.
  const top = Y + INSET;
  const bot = (chip ? chip.y - GAP : Y + H - INSET) - CHIP_H;
  const rows = bot < top ? 0 : Math.floor((bot - top) / PING_ROW) + 1;
  const maxCh = Math.floor((W - INSET * 2 - PAD_X * 2) / CH);

  const placed = list
    .filter(k => k && Number.isFinite(+k.x) && Number.isFinite(+k.y))
    .sort((a, b) => fin(a.p) - fin(b.p))
    .slice(0, Math.max(0, Math.min(PING_MAX, rows)))
    .map(k => {
      const name = fit(String(k.name ?? '').trim(), maxCh);
      return { mx: X + clamp(fin(k.x), 0, sw) * sx, my: Y + clamp(fin(k.y), 0, sh) * sy,
               name, alpha: pingAlpha(k.p), p: clamp(fin(k.p), 0, 1),
               w: name ? name.length * CH + PAD_X * 2 : 0, h: CHIP_H };
    })
    .sort((a, b) => a.my - b.my);

  // Lay the column out and let it run PAST the bottom if it has to, then slide the
  // whole thing up as a block. Clamping each row to the bottom as it is placed is
  // the obvious thing and it is wrong: with six pings inside a hundred pixels of
  // each other, rows five and six both clamp to the last legal row and print
  // through each other — measured at -8.3px of clear ink at 2560x1440, which is two
  // callsigns on one line, the single outcome this whole layout exists to prevent.
  // Sliding the block preserves every gap; nothing is ever pulled up into the gap
  // above it.
  let cursor = top;
  for (const r of placed) {
    r.y = Math.max(cursor, Math.max(top, r.my - CHIP_H / 2));
    cursor = r.y + PING_ROW;
  }
  // `rows` above already guaranteed the block fits between top and bot, so the room
  // over the first label is always at least as big as the overhang under the last.
  const over = cursor - GAP - (bot + CHIP_H);
  if (over > 0) {
    const room = Math.min(over, placed[0].y - top);
    for (const r of placed) r.y -= room;
  }
  for (const r of placed) {
    // Beside the dot, flipped to its left when the name would run out of the
    // right-hand edge — then clamped, because a label half off the plot is
    // clipped to nothing by the frame and reads as a bug.
    const right = r.mx + 5;
    r.x = clamp(right + r.w <= X + W - INSET ? right : r.mx - 5 - r.w,
                X + INSET, Math.max(X + INSET, X + W - INSET - r.w));
    r.tx = r.x + PAD_X;
    r.ty = r.y + CHIP_H - 4.5;                   // baseline, so the ink sits inside the chip
  }
  return placed;
}
