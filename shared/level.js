// Rank.
//
// A level is standing, not power. Every stat on a ship still comes from its hull
// and what is bolted to it, so a veteran and a newcomer in the same ship fly the
// same ship.
//
// Rank may GATE and must never SCALE. A door that opens at a rank is content you
// have not reached yet; a number that grows with rank is a fight you cannot lose,
// and that is the thing this game exists not to have. Standing decides where you
// are allowed, never how hard you hit.

export const XP_PER_TIER = 140;      // roughly one Drifter's bounty

// There is no maximum. There was — sixty — and a ceiling on standing is the one
// thing standing should not have: it is a record of what you have done, and a
// record that stops recording is just a number that used to move. A pilot at the
// old cap earned nothing legible for every kill after it, which is the opposite of
// what a rank is for. Rank still only ever GATES; nothing about removing the top
// gives anybody a bigger gun.
//
// Cost of the Nth level, climbing steadily rather than exponentially, so a late
// level is a session's work and not a month's. It keeps climbing forever, so the
// levels get further apart and never stop arriving.
export const costOf = level => Math.round(XP_PER_TIER * Math.pow(level, 1.45));

// Total experience to have REACHED a level, cached and grown on demand.
//
// levelFor runs once per player per snapshot, thirty times a second, so it cannot
// walk the ladder from one every time it is asked — it did, and that was fine only
// because the ladder had sixty rungs. The table is shared, each rung costs one
// multiply the first time anybody reaches it, and the lookup is a binary search.
const SPENT = [0, 0];                             // SPENT[1] = 0: level one is free

// A guard, not a cap. Nothing a player can do reaches it: level 10,000 is about
// 3.6e11 experience, which is two and a half million Corsair Hives. It exists so a
// hand-edited save with an absurd xp cannot ask this to allocate an array the size
// of memory before it answers.
export const LEVEL_GUARD = 10_000;

function grow(to) {
  while (SPENT.length <= Math.min(to, LEVEL_GUARD) + 1)
    SPENT.push(SPENT[SPENT.length - 1] + costOf(SPENT.length - 1));
}

export function levelFor(xp) {
  const have = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  // Double the table until it overshoots, so growing is amortised rather than one
  // rung per call, then binary search what we grew.
  let top = Math.max(2, SPENT.length - 1);
  grow(top);
  while (SPENT[top] <= have && top < LEVEL_GUARD) { top = Math.min(LEVEL_GUARD, top * 2); grow(top); }
  let lo = 1, hi = Math.min(top, SPENT.length - 1);
  while (lo < hi) {                                // the highest level we can afford
    const mid = (lo + hi + 1) >> 1;
    if (SPENT[mid] <= have) lo = mid; else hi = mid - 1;
  }
  return { level: lo, into: have - SPENT[lo], need: costOf(lo) };
}

// Always a real fraction now: there is no last level to be permanently full on.
export const progress = xp => {
  const l = levelFor(xp);
  return l.need ? Math.max(0, Math.min(1, l.into / l.need)) : 1;
};
