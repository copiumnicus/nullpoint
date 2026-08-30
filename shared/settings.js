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

// Everything that is not flying the ship ends up in here. Actions are a list so
// the next one is a line of data rather than a layout change.
export const ACTIONS = [
  { key: 'signout', label: 'SIGN OUT',
    hint: 'releases the sector — your pilot and everything on it stay yours' },
];

// Two lines of numbers, added to the panel's height like everything else in it.
export const PERF_H = 34;
export const PANEL_W = 440, ROW_H = 46, HEAD = 54, NOW_H = 42, SECT_H = 26,
             ACT_H = 34, FOOT = 22;

export function settingsLayout(VIEW_W, VIEW_H) {
  const h = HEAD + SECT_H + ROWS.length * ROW_H + NOW_H + SECT_H + 2 * PERF_H
        + SECT_H + ACTIONS.length * ACT_H + FOOT;
  const w = Math.min(PANEL_W, VIEW_W - 40);
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
  const panel = { x, y, w, h };

  let cy = y + HEAD;
  const sections = [{ label: 'AUDIO', y: cy + 16 }];
  cy += SECT_H;

  const rows = ROWS.map(r => {
    const top = cy;
    const row = { ...r, r: { x, y: top, w, h: ROW_H } };
    // The switch sits hard right on every row, so muting is always the same
    // gesture whichever bus you are muting.
    row.toggle = { x: x + w - 74, y: top + 12, w: 52, h: 22 };
    if (r.kind === 'slider') {
      row.track = { x: x + 108, y: top + 20, w: w - 108 - 96, h: 6 };
      row.hit = { x: row.track.x - 8, y: top + 6, w: row.track.w + 16, h: ROW_H - 12 };
    }
    cy += ROW_H;
    return row;
  });

  // What is playing, and a way past it.
  const now = { x: x + 20, y: cy + 6, w: w - 130, h: 24 };
  const skip = { x: x + w - 96, y: cy + 4, w: 76, h: 26 };
  cy += NOW_H;

  // How it is running, before what you can do about it. Frame time is whether your
  // machine is keeping up; ping is whether the distance is. Different questions,
  // different fixes, so they get a line each rather than one "performance" number.
  sections.push({ label: 'PERFORMANCE', y: cy + 16 });
  cy += SECT_H;
  const perf = [
    { key: 'frame', label: 'Frame', r: { x, y: cy, w, h: PERF_H } },
    { key: 'ping',  label: 'Ping',  r: { x, y: cy + PERF_H, w, h: PERF_H } },
  ];
  cy += 2 * PERF_H;

  sections.push({ label: 'SESSION', y: cy + 16 });
  cy += SECT_H;
  const actions = ACTIONS.map(a => {
    const r = { ...a, r: { x: x + 20, y: cy + 2, w: w - 40, h: ACT_H - 8 } };
    cy += ACT_H;
    return r;
  });

  return { panel, rows, now, skip, sections, perf, actions };
}

// Where along a slider a click landed, 0..1.
export const valueAt = (track, px) =>
  Math.max(0, Math.min(1, (px - track.x) / Math.max(1, track.w)));
