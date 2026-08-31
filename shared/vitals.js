// The vitals block in the top-left corner: the shield bar, the hull bar under it,
// and the countdown to the shields coming back up.
//
// The rectangles live here rather than as literals in index.html because UI
// geometry is a rule (CLAUDE.md, rule one), and the countdown is what forced the
// issue: it has to land ON the shield bar without being written across it, so the
// bar and the chip that sits in it must be derived from the same numbers or they
// drift the first time the block moves. Five of the eight overlap bugs fixed in
// one day were exactly that shape — a literal racing something computed.
//
// It is not a hit-tested panel: nothing here is clickable. What both sides need
// is that the drawing and the rule about where the drawing may go are the same
// arithmetic.

export const PAD = 2;    // inset of the bars inside the backing box, and between them
export const BAR = 8;    // height of one bar

// x, y and w are still the caller's, because the whole HUD is laid out from the
// window's top-left corner and the run of readouts to the right of this block is
// positioned off `w`. Everything the block is made of comes from here.
export function vitalsPanel(x = 16, y = 52, w = 190) {
  const inner = w - PAD * 2;
  return {
    box:    { x, y, w, h: PAD * 3 + BAR * 2 },
    shield: { x: x + PAD, y: y + PAD, w: inner, h: BAR },
    hull:   { x: x + PAD, y: y + PAD * 2 + BAR, w: inner, h: BAR },
  };
}

export const WAIT_PX  = 9;     // font size of the readout — the mood tag's size
export const WAIT_PAD = 3;     // breathing room each side of it inside the chip
const CAP = 0.72;              // cap height in ems; the same ratio test/uibox.mjs measures with

// Where the countdown goes, and what it says — or null when there is nothing to
// draw. `secs` is what shieldWait() answered, so null passes straight through and
// so does the moment regeneration actually starts: at zero the bar is already
// climbing, and a readout frozen at "0.0" beside a moving bar is noise. Nothing
// is drawn when there is nothing to wait for.
//
// It is right-aligned inside the shield bar's own row rather than beside the
// SH/HU readout, because that run of text is already the widest line in the HUD
// and the corner has been complained about twice. The chip under it is not
// decoration: it is opaque, so the render harness reads the readout as sitting in
// its own frame rather than as a label written across the shield bar — and it is
// the only thing that makes a blue number legible on top of a blue bar. It costs
// the last ~30px of the bar, which is only ever hidden while the shields are
// below full and are not yet coming back, and it goes away the instant they are.
//
// `measure` is the caller's text measurement, not a constant here: the client
// hands over ctx.measureText so the chip is sized by the font that will actually
// draw the string.
export function shieldCountdown(secs, P, measure) {
  if (secs === null || secs === undefined || !(secs > 0)) return null;
  const text = `${secs.toFixed(1)}s`;
  const w = measure(text) + WAIT_PAD * 2;
  const box = { x: P.shield.x + P.shield.w - w, y: P.shield.y, w, h: P.shield.h };
  return { text, box, size: WAIT_PX,
           // right-aligned, with the cap box centred in the bar's own 8px so the
           // number sits in the bar rather than hanging out of the top of it
           tx: box.x + box.w - WAIT_PAD, ty: box.y + (box.h + WAIT_PX * CAP) / 2 };
}
