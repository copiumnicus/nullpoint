// The join form: a callsign, a side, and — once a browser holds more than one
// pilot — a way back to the one you left.
//
// The geometry was a hand-maintained copy in test/render.mjs and another in the
// client, on the argument that the lobby is drawn before there is any session so
// it could not be shared. It could: everything under shared/ is served to the
// page by pattern already, and the copies drifted the first time the panel's
// height changed — the harness clicked where LAUNCH used to be, the click landed
// on nothing, and the failure read "a valid callsign and a side still would not
// launch". One layout, drawn and hit-tested and asserted from the same numbers.

export const CARD_GAP = 12, PAD = 20;

// `back` is the pilot the BACK button returns to, or null when this browser has
// nobody to go back to — a first visit, which is every visit the game had until
// pilots became a list. The panel grows by the button rather than squeezing it
// in, so a first visit gets exactly the form it always had.
export function joinLayout(VIEW_W, VIEW_H, cards = [], back = null) {
  const w = Math.min(560, VIEW_W - 2 * PAD), h = 380 + (back ? 44 : 0);
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
  const n = Math.max(1, cards.length);
  const cw = (w - 2 * PAD - (n - 1) * CARD_GAP) / n;
  return {
    panel: { x, y, w, h },
    field: { x: x + PAD, y: y + 74, w: w - 2 * PAD, h: 42 },
    cards: cards.map((c, i) => ({ ...c, r: { x: x + PAD + i * (cw + CARD_GAP), y: y + 168,
                                             w: cw, h: 104 } })),
    go: { x: x + PAD, y: y + h - (back ? 110 : 66), w: w - 2 * PAD, h: 44 },
    back: back ? { pilot: back, r: { x: x + PAD, y: y + h - 56, w: w - 2 * PAD, h: 34 } } : null,
  };
}
