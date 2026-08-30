// The badge that says you are safe.
//
// Sanctuary has been in the game since the beginning and has never once said so.
// `havenKind` in sim.js is the rule — a base ring, a pirate outpost, or within
// HAVEN_R of a portal mouth — and an alien will not open on anyone standing in
// one. A player learns two of those three by noticing nothing happens to them.
//
// The portal mouth they do not learn at all. Nothing in the world or on the
// minimap draws that 288px circle, so the single most useful piece of safety in
// the game — the thing you run for when a Bandit finds you — is invisible. This
// badge is the first time the game admits it exists.
//
// The geometry lives here rather than in the client for the reason UI geometry
// always does: the render harness asserts it does not land on the changelog icon
// or the first receipt, and it can only assert that against one source.

import { ICON } from './patch.js';

// Right edge on VIEW_W - PAD with the changelog icon and the receipts, so the
// top-right reads as one column rather than three things that happen to be near
// each other. Top on 48 — 14 + ICON + 8 — which is the line the changelog panel
// opens on, so an open changelog covers the badge rather than clipping it. 260
// wide is TOAST_W, so the badge and the first receipt share an outline.
export const BADGE_H = 26, BADGE_W = 260, BADGE_PAD = 16;
export const BADGE_TOP = 14 + ICON + 8;

export const havenBadge = (VIEW_W) => {
  const w = Math.min(BADGE_W, Math.max(120, VIEW_W - BADGE_PAD * 2));
  return { x: Math.max(BADGE_PAD, VIEW_W - w - BADGE_PAD), y: BADGE_TOP, w, h: BADGE_H };
};

// What each kind of sanctuary is worth, in the pilot's words.
//
// The distinction that has to survive: peace is not repair. Only your own ring
// mends you — stepVitals is handed `docked`, which is canDock, not inHaven — so a
// badge reading SAFE at a pirate outpost while your hull sits at 8% would be a
// lie of exactly the kind this codebase keeps writing rules against.
//
// `foreign` exists because inBase does not check ownership. You can stand in a
// rival company's ring and the aliens there will leave you alone, and you cannot
// buy so much as a magazine. That is a real state a pilot can reach by flying
// four sectors, and it should not read the same as being home.
//
// A named seam, per rule seven: another kind of sanctuary is a line of data here.
export const HAVEN_COPY = {
  ring:    { text: 'SAFE · YOUR RING',                 tone: 'calm' },
  foreign: { text: 'SAFE · FOREIGN RING · NO DOCK', tone: 'calm' },
  outpost: { text: 'SAFE · OUTPOST · NO REPAIRS',   tone: 'calm' },
  portal:  { text: 'SAFE · PORTAL MOUTH · NO REPAIRS', tone: 'calm' },
};

// And the state that makes the badge honest rather than decorative. Sanctuary
// stops an alien STARTING a fight; one that is already on you follows you in and
// keeps shooting. A badge that still read SAFE while a provoked Leviathan emptied
// its guns into you would be worse than no badge, because a player would learn to
// trust it and then die inside it.
export const HAVEN_BROKEN = { text: 'SAFE · BUT ONE IS ALREADY ON YOU', tone: 'warn' };

// Which line to draw, given the answer sim.js gave and whether this is your ring.
// One function so the badge and its test cannot disagree about the foreign case.
export function havenLine(kind, { mine = true, hunted = false } = {}) {
  if (!kind) return null;
  if (hunted) return HAVEN_BROKEN;
  if (kind === 'ring' && !mine) return HAVEN_COPY.foreign;
  return HAVEN_COPY[kind] ?? null;
}

export const TONE = { calm: '#7de08a', warn: '#ffd479' };
