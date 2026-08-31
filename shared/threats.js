// The threat file.
//
// What a pilot knows about the things that live out here, and it is knowledge they
// earned rather than a manual that shipped with the ship. A hostile appears in your
// file the first time you kill one, with its numbers, its outline and one line on
// what it actually does. Until then it is not in there at all — not greyed out, not
// listed as unknown, absent.
//
// That absence is the point. The game has nine hostiles and five of them do
// something a bolt does not — a mirror, a tether, a burning ring, a mothership, a
// thing that dodges — and none of that was written down anywhere a player could
// read it. They found out by dying. The file is where the game finally explains
// itself, and it is paid for one kill at a time.
//
// The count comes with it, because a tally is a diary. "Drifter x412" says more
// about a pilot's week than anything else on the screen.

import { ALIENS, WILD, effectiveHp, MIRROR } from './aliens.js';

// --- what you have met --------------------------------------------------------
//
// A tally, not a list: presence is what unlocks the entry and the number is what
// makes it worth looking at. Kinds nobody defines are dropped rather than kept, so
// a hand-edited save cannot invent a hostile and a retired one leaves cleanly.
export function sanitiseKills(raw) {
  const out = {};
  for (const k of WILD) {
    const n = Math.floor(Number(raw?.[k]));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

// Recorded hostiles, weakest first — the ladder, in the order a pilot met it. Not
// alphabetical: the file should read as a climb.
export const filedIn = kills =>
  WILD.filter(k => (kills?.[k] ?? 0) > 0).sort((a, b) => effectiveHp(a) - effectiveHp(b));

export const totalKills = kills =>
  WILD.reduce((n, k) => n + (kills?.[k] ?? 0), 0);

// --- one entry ----------------------------------------------------------------
//
// Read off the definition rather than written out again, so a hostile that is
// retuned is retuned here too. `dps` is the gun; the ones with no gun say so and
// their line explains what they have instead — a rate against your ship cannot be
// quoted as a number without knowing whose ship, and the file is read in the field.
export function dossierOf(kind, kills = {}) {
  const a = ALIENS[kind];
  if (!a) return null;
  // A mirror's barrel is 80 and its chamber is the gun. Quoting the barrel put
  // "80 dps at 900" on the page for the thing that was one-shotting finished ships,
  // which is a threat file actively misleading the pilot reading it. The number here
  // is the worst it can be — a full chamber — because that is what a threat file is
  // for, and it is MIRROR.dps rather than a second copy of it.
  //
  // It reads 12,083 now, which is five digits where every other entry has three. It
  // is meant to: it is the largest number in the file by a factor of five and the
  // Thresher's row should be the one a pilot stops on. The row lays out as one 10px
  // monospace line inside a 588px card with ~510px of usable width, so the whole
  // stats line is 58 characters against about 85 that fit — two more digits than
  // before cost 12px and nothing wraps.
  const gun = (a.attrs.damage ?? 0) * (a.attrs.fireRate ?? 0)
            + (a.returns ?? 0) * MIRROR.dps;
  return {
    kind, name: a.name, cls: a.cls, colour: a.colour, shape: a.shape,
    killed: kills?.[kind] ?? 0,
    ehp: effectiveHp(kind),
    hull: a.attrs.hull, shield: a.attrs.shield,
    speed: a.attrs.speed, reach: a.attrs.weaponRange ?? 0,
    dps: Math.round(gun),
    bounty: a.bounty, xp: a.xp,
    // The interesting half, and the reason the file exists at all.
    tell: a.tell ?? '',
    armed: gun > 0,
  };
}

// --- the panel ----------------------------------------------------------------
//
// Its own geometry rather than the station's, because this is a reference document
// rather than a shop: one tall column of entries you scroll, no tabs, no buying.
// UI geometry is a shared rule — the client draws and hit-tests from this, and a
// row you can see and cannot reach is a bug this codebase has shipped twice.
export const FILE_W = 620, FILE_ROW = 96, FILE_HEAD = 64, FILE_PAD = 16;

export function filePanel(VIEW_W, VIEW_H, scroll = 0, n = 0) {
  const w = Math.min(FILE_W, VIEW_W - 40);
  const h = Math.min(VIEW_H - 60, FILE_HEAD + Math.max(1, n) * FILE_ROW + FILE_PAD);
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);

  // The body is the window the rows move behind, and it is what the client clips
  // to. Rows are placed at a PIXEL offset rather than snapped to a row index: a
  // wheel tick used to advance a whole 96px entry, so the list jumped a full card
  // at a time and read as two frames of two different lists rather than as
  // scrolling. Pixels here, easing in the client, clipping at the edges.
  const body = { x: x + FILE_PAD, y: y + FILE_HEAD, w: w - FILE_PAD * 2,
                 h: h - FILE_HEAD - FILE_PAD };
  const span = n * FILE_ROW;
  const maxScroll = Math.max(0, span - body.h);
  const at = Math.max(0, Math.min(maxScroll, scroll));

  const rows = [];
  for (let i = 0; i < n; i++) {
    const ry = body.y + i * FILE_ROW - at;
    if (ry + FILE_ROW < body.y || ry > body.y + body.h) continue;   // off the window
    rows.push({ i, r: { x: body.x, y: ry, w: body.w, h: FILE_ROW - 6 } });
  }
  // How many fit whole, for the "1-7 of 9" line. Not what `rows` holds — that
  // includes the two half-rows at the edges, which is the point of clipping.
  const fit = Math.max(1, Math.floor(body.h / FILE_ROW));
  // Which row is at the top, for the "1-7 of 9" line under the panel. `at` is
  // PIXELS and has been since this scrolled smoothly, and the footer printed it
  // straight: mid-scroll it read "25.321947656276528-10 of 10". The same
  // conversion hangar.js does for the shop, and here for the same reason — the
  // client draws what it is handed and does no arithmetic of its own.
  //
  // Ceiling, not rounding, because `fit` counts rows that fit WHOLE: the pair has
  // to name the same set or the line is off by one at the bottom of the list,
  // where it would have said "3-9 of 10" with the tenth entry fully on screen.
  const first = Math.ceil(at / FILE_ROW);
  return { panel: { x, y, w, h }, body, rows, at, first, maxScroll, fit,
           close: { x: x + w - 30, y: y + 10, w: 20, h: 20 } };
}

// How complete it is. Says there is more without saying what — a file that
// announced the things you have not met would be the manual this replaces.
export const fileProgress = kills =>
  ({ known: filedIn(kills).length, all: WILD.length });
