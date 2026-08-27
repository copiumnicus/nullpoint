// Hangar panel geometry.
//
// Lives here rather than inline in the client so the tests can check it. The
// module list grew from six entries to twelve and silently outgrew the panel:
// the last rows drew outside it, and a click there fell through to "clicked
// outside, close the panel" — so the newest modules could not be selected at all
// and the hangar just shut. Rows are sized from the space available now.

import { HULLS, MODULES } from './ships.js';

export function bayLayout(VIEW_W, VIEW_H) {
  const w = Math.min(920, VIEW_W - 50), h = Math.min(580, VIEW_H - 50);
  const x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
  const colW = (w - 60) / 3, top = y + 76;
  const FOOTER = 66;                       // APPLY button and the hint line
  const room = h - (top - y) - FOOTER;

  const hKeys = Object.keys(HULLS), mKeys = Object.keys(MODULES);
  const hStep = Math.min(58, room / hKeys.length);
  const mStep = Math.min(44, room / mKeys.length);

  return {
    panel: { x, y, w, h }, colW, top, mStep,
    hulls: hKeys.map((k, i) => ({ k, r: { x: x + 20, y: top + i * hStep, w: colW, h: hStep - 8 } })),
    mods:  mKeys.map((k, i) => ({ k, r: { x: x + 30 + colW, y: top + i * mStep, w: colW, h: mStep - 6 } })),
    stats: { x: x + 40 + colW * 2 },
    apply: { x: x + w - 190, y: y + h - 52, w: 170, h: 34 },
  };
}
