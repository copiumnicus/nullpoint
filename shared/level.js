// Rank.
//
// Deliberately cosmetic: a level is standing, not power. Every stat on a ship
// still comes from its hull and what is bolted to it, so a veteran and a newcomer
// in the same ship fly the same ship. Progress buys you nothing you could not
// also buy with credits — which is the whole reason the fitting rules exist.

export const XP_PER_TIER = 140;      // roughly one Drifter's bounty
export const MAX_LEVEL   = 60;

// Cost of the Nth level, climbing steadily rather than exponentially, so a late
// level is a session's work and not a month's.
export const costOf = level => Math.round(XP_PER_TIER * Math.pow(level, 1.45));

export function levelFor(xp) {
  let lvl = 1, spent = 0;
  while (lvl < MAX_LEVEL && xp >= spent + costOf(lvl)) { spent += costOf(lvl); lvl++; }
  return { level: lvl, into: xp - spent, need: lvl >= MAX_LEVEL ? 0 : costOf(lvl) };
}

export const progress = xp => {
  const l = levelFor(xp);
  return l.need ? Math.max(0, Math.min(1, l.into / l.need)) : 1;
};
