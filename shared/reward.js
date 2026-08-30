// Who gets paid for a kill.
//
// The last shot has no special claim on the bounty. What counts is damage: put a
// tenth of the work into something and you are on the ledger. Nobody has to party
// up first — shooting the same alien IS the arrangement, which is the whole point.
// A stranger who helps you bring something big down cannot be robbed by whoever
// happens to land the finishing hit, and you cannot be robbed by them either.

export const SHARE_FLOOR = 0.10;   // a tenth of the damage buys a share
export const GROUP_STEP  = 0.25;   // and each extra claimant grows the pot by this

// The pot grows with the number of claimants. A reward merely divided makes
// company a cost — you would earn strictly less per kill for having help — and
// then nobody fights together, which is the opposite of what this is for.
//
// It cannot run away, and the ceiling is derived rather than picked: the floor
// admits at most ten claimants, because eleven shares of a tenth do not fit in
// one alien. So the most any kill can ever pay is 1 + 0.25 * 9 = 3.25 bounties,
// however many ships were on it. Move SHARE_FLOOR and the ceiling moves with it;
// there is no second number to remember.
export const MAX_CLAIMS = Math.floor(1 / SHARE_FLOOR);
export const MAX_POT    = 1 + GROUP_STEP * (MAX_CLAIMS - 1);
export const potFor = (amount, n) => amount * (1 + GROUP_STEP * Math.max(0, n - 1));

// ledger: Map(playerId -> damage dealt to this alien since it last spawned).
// Returns the claimants, most damage first, each with the credits and experience
// they are owed. The cuts sum to exactly the pot — no credit is created or lost
// to rounding, and the remainder goes to whoever did the most work.
export function splitKill(ledger, bounty, xp = bounty) {
  const rows = [...ledger].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return [];
  const total = rows.reduce((s, [, d]) => s + d, 0);

  // Eleven ships each doing 9% clear nobody's floor, and the strict reading of the
  // rule then pays one of them the lot while ten people who were all visibly
  // shooting the thing get nothing — a cliff straight off the back of the ten-way
  // split that pays 6825 each. When the fight is so crowded that the floor admits
  // no one, the top MAX_CLAIMS are the claimants instead. That is the same ten the
  // floor would have allowed at best, so it caps the payout at exactly the same
  // 3.25 bounties and cannot be farmed by adding more ships.
  //
  // The floor still bites in the ordinary case: if anybody clears it, only those
  // who cleared it are paid, and a 5% last-hitter gets nothing.
  let claim = rows.filter(([, d]) => d / total >= SHARE_FLOOR);
  if (!claim.length) claim = rows.slice(0, MAX_CLAIMS);

  // Shares are re-normalised across the claimants, so damage that went to pilots
  // under the floor is not quietly deducted from the people who did qualify. Kill
  // something alone and you take the whole bounty whoever else was plinking at it.
  const pool = claim.reduce((s, [, d]) => s + d, 0);
  const share = d => d / pool;
  const share_ = claim.map(([id, d]) => ({ id, damage: d, share: share(d) }));

  for (const [key, amount] of [['credits', bounty], ['xp', xp]]) {
    const pot = Math.round(potFor(amount, claim.length));
    let paid = 0;
    for (const r of share_) { r[key] = Math.floor(pot * r.share); paid += r[key]; }
    share_[0][key] += pot - paid;                  // the remainder, to the top contributor
  }
  return share_;
}
