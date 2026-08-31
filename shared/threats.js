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

import { ALIENS, WILD, effectiveHp } from './aliens.js';

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
  const gun = (a.attrs.damage ?? 0) * (a.attrs.fireRate ?? 0);
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
  const room = h - FILE_HEAD - FILE_PAD;
  const fit = Math.max(1, Math.floor(room / FILE_ROW));
  const maxScroll = Math.max(0, n - fit);
  const at = Math.max(0, Math.min(maxScroll, Math.round(scroll)));
  const rows = [];
  for (let i = 0; i < Math.min(fit, n); i++)
    rows.push({ i: at + i,
                r: { x: x + FILE_PAD, y: y + FILE_HEAD + i * FILE_ROW,
                     w: w - FILE_PAD * 2, h: FILE_ROW - 6 } });
  return { panel: { x, y, w, h }, rows, at, maxScroll, fit,
           close: { x: x + w - 30, y: y + 10, w: 20, h: 20 } };
}

// How complete it is. Says there is more without saying what — a file that
// announced the things you have not met would be the manual this replaces.
export const fileProgress = kills =>
  ({ known: filedIn(kills).length, all: WILD.length });
