// The settings panel: what is playing, how loud, and what is muted.
//
// Sound and music are separate rows on purpose. Writing music for a game means
// wanting the game running and the game silent at the same time, and a single
// mute cannot do that.
//
// Geometry lives here so the client draws and hit-tests the same rectangles —
// a slider you can see but not grab is the same bug as a row outside its panel.

export const ROWS = [
  { key: 'master', label: 'MASTER',    kind: 'toggle', hint: 'V' },
  { key: 'sfx',    label: 'SOUND',     kind: 'slider', hint: 'guns, thrusters, hits' },
  { key: 'music',  label: 'MUSIC',     kind: 'slider', hint: '[ and ] · N skips' },
];

export const PANEL_W = 420, ROW_H = 46, HEAD = 54, FOOT = 62;

export function settingsLayout(VIEW_W, VIEW_H) {
  const h = HEAD + ROWS.length * ROW_H + FOOT;
  const w = Math.min(PANEL_W, VIEW_W - 40);
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
  const panel = { x, y, w, h };

  const rows = ROWS.map((r, i) => {
    const top = y + HEAD + i * ROW_H;
    const row = { ...r, r: { x, y: top, w, h: ROW_H } };
    // The switch sits hard right on every row, so muting is always the same
    // gesture whichever bus you are muting.
    row.toggle = { x: x + w - 74, y: top + 12, w: 52, h: 22 };
    if (r.kind === 'slider') {
      row.track = { x: x + 108, y: top + 20, w: w - 108 - 96, h: 6 };
      row.hit = { x: row.track.x - 8, y: top + 6, w: row.track.w + 16, h: ROW_H - 12 };
    }
    return row;
  });

  return {
    panel, rows,
    // Bottom strip: what is playing and a way past it.
    now: { x: x + 18, y: y + h - FOOT + 12, w: w - 120, h: 22 },
    skip: { x: x + w - 92, y: y + h - FOOT + 10, w: 74, h: 26 },
  };
}

// Where along a slider a click landed, 0..1.
export const valueAt = (track, px) =>
  Math.max(0, Math.min(1, (px - track.x) / Math.max(1, track.w)));
