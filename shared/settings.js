// The settings panel: what is playing, how loud, what is muted, and who you are
// flying as.
//
// Sound and music are separate rows on purpose. Writing music for a game means
// wanting the game running and the game silent at the same time, and a single
// mute cannot do that.
//
// Geometry lives here so the client draws and hit-tests the same rectangles —
// a slider you can see but not grab is the same bug as a row outside its panel.

import { SIZES } from './viewport.js';

export const ROWS = [
  { key: 'master', label: 'MASTER',    kind: 'toggle', hint: 'V' },
  { key: 'sfx',    label: 'SOUND',     kind: 'slider', hint: 'guns, thrusters, hits' },
  { key: 'music',  label: 'MUSIC',     kind: 'slider', hint: '[ and ] · N skips' },
];

// Everything that is not flying the ship ends up in here. Actions are a list so
// the next one is a line of data rather than a layout change.
export const ACTIONS = [
  { key: 'signout', label: 'SIGN OUT',
    hint: 'ends this session — your pilot, ship and cargo are kept' },
];

// Two lines of numbers, added to the panel's height like everything else in it.
export const PERF_H = 34;
export const PANEL_W = 440, ROW_H = 46, HEAD = 54, NOW_H = 42, SECT_H = 26,
             ACT_H = 34, FOOT = 22;
// The margin the panel keeps from the top and bottom of the window. The same 20
// the width already keeps from each side, so a panel that fits horizontally and
// one that fits vertically are saying it with the same number.
export const EDGE = 20;

// A berth is one pilot in the roster: a chip, not a row. TWO TO A LINE, because
// a roster is a handful of short things and a full-width row for `Vex-4271 MTC
// L14 Vanguard` spends 400px of panel on 120px of text — and height is the
// scarce direction here, not width. Two to a line is what makes the list fit at
// the shortest window the game ships for; one to a line does not.
export const PILOT_H = 28, PILOT_COLS = 2, PILOT_GAP = 10;

// Everything in the panel that is not the roster. Fixed, so the roster's share
// of a window is arithmetic rather than a guess.
const FIXED = HEAD + SECT_H + ROWS.length * ROW_H + NOW_H + SECT_H + 2 * PERF_H
            + SECT_H + ACTIONS.length * ACT_H + FOOT;

// How many lines of berths a window this tall has room for, once the panel's own
// furniture and its margins are paid for. Can be zero, and on a short enough
// window is: see settingsLayout for what the panel says when it is.
export const berthLines = VIEW_H =>
  Math.max(0, Math.floor((VIEW_H - 2 * EDGE - FIXED - SECT_H) / PILOT_H));

// THE ROSTER CAP IS A GEOMETRIC FACT, not a preference.
//
// It is exactly how many berths this menu can show at the shortest window the
// game ships for — 820x560 in shared/viewport.js. At 560 the panel's furniture
// leaves 58px above the margins, which is two lines of 28, which is four chips.
// So four pilots, and the number moves on its own if the panel or the shipped
// sizes ever do.
//
// Derived rather than picked because the alternative is a menu that is honest at
// one window size and a wall of clipped rows at another. It is NOT a limit on
// how many accounts a person may have — local storage has always been theirs to
// clear, and clearing it has always made a new pilot. It is a limit on how long
// a list stays a list somebody can use.
export const MAX_PILOTS = Math.max(2, PILOT_COLS * berthLines(Math.min(...SIZES.map(([, h]) => h))));

// `parked` is the pilots in the roster you are NOT flying, most recent first.
// The one you are flying is not a row: you are looking at it, its name is on
// your hull, and spending a berth on it would cost the shortest window a real
// one.
export function settingsLayout(VIEW_W, VIEW_H, parked = []) {
  const others = (Array.isArray(parked) ? parked : []).slice(0, MAX_PILOTS - 1);
  // One chip per parked pilot, plus one for the empty berth — which offers a new
  // pilot while there is room for one and SAYS SO when there is not. A full
  // roster whose button had simply vanished would be the silent refusal this
  // menu exists not to make.
  const berths = [...others.map(p => ({ ...p, kind: 'pilot' })),
                  { kind: others.length + 1 < MAX_PILOTS ? 'new' : 'full' }];

  const w = Math.min(PANEL_W, VIEW_W - 2 * EDGE);
  // What is left for the roster after the furniture. A window too short to hold
  // even the section heading drops the section entirely rather than pushing the
  // panel off the top of the screen — at which point the menu is exactly the
  // panel it was before any of this, which is the honest way to lose a feature.
  const room = VIEW_H - 2 * EDGE - FIXED;
  const lines = Math.max(0, Math.min(Math.ceil(berths.length / PILOT_COLS),
                                     Math.floor((room - SECT_H) / PILOT_H)));
  const secH = room >= SECT_H ? SECT_H : 0;
  const shown = secH ? Math.min(berths.length, lines * PILOT_COLS) : 0;
  const dropped = berths.length - shown;

  const h = FIXED + secH + lines * PILOT_H;
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

  // The roster, immediately above SESSION and not by accident: switching pilots
  // and signing out are the same act — the ship goes down and the sector is
  // released — and they share the stand-down that makes leaving cost five
  // seconds. Two names for one door belong next to each other.
  let seats = [];
  if (secH) {
    // What could not be shown, said in the heading rather than by rows quietly
    // going missing. The hotkey strip drops hints it cannot fit; this says how
    // many it dropped, because a pilot you cannot see is a pilot you cannot get
    // back to.
    sections.push({ label: 'PILOTS', y: cy + 16,
                    note: dropped ? `+${dropped} MORE — WINDOW TOO SHORT` : null });
    cy += SECT_H;
    const cw = (w - 2 * EDGE - (PILOT_COLS - 1) * PILOT_GAP) / PILOT_COLS;
    seats = berths.slice(0, shown).map((b, i) => {
      const col = i % PILOT_COLS, row = Math.floor(i / PILOT_COLS);
      return { ...b, r: { x: x + EDGE + col * (cw + PILOT_GAP), y: cy + row * PILOT_H,
                          w: cw, h: PILOT_H - 2 } };
    });
    cy += lines * PILOT_H;
  }

  sections.push({ label: 'SESSION', y: cy + 16 });
  cy += SECT_H;
  const actions = ACTIONS.map(a => {
    const r = { ...a, r: { x: x + 20, y: cy + 2, w: w - 40, h: ACT_H - 8 } };
    cy += ACT_H;
    return r;
  });

  return { panel, rows, now, skip, sections, perf, berths: seats, dropped, actions };
}

// Where along a slider a click landed, 0..1.
export const valueAt = (track, px) =>
  Math.max(0, Math.min(1, (px - track.x) / Math.max(1, track.w)));
