// How fast a sector refills.
//
// Every hostile came back on a fixed timer, which is a population that assumes one
// pilot. Two ships that move well can strip a home sector faster than it restocks
// and then spend the next minute flying across empty space looking for something —
// and the fixed timer is only half of why. The other half is the respawn clearance
// (SPAWN_CLEAR): hostiles deliberately come back away from anyone watching, so the
// more of the map is covered by pilots, the further away "away" is.
//
// So the rate follows the sector rather than the clock. Two things move it, and
// they are different questions:
//
//   HOW MANY PILOTS are working it. A sector with four ships in it is being
//   emptied four times as fast and should refill to match, or the fourth pilot is
//   just queueing behind the first three.
//
//   HOW EMPTY IT IS. A picked-clean sector should refill faster than a full one.
//   This is the part that stops a stripped map staying stripped, and it is
//   self-correcting: as the sector fills the pressure comes off on its own.
//
// Both are multiplicative on the hostile's own respawn time, so a Drifter still
// comes back sooner than a Leviathan and the bestiary keeps its shape.

// Each pilot past the first adds this much of the base rate. 0.6 rather than 1.0
// because two pilots do not kill twice as fast — they share targets, they fly to
// the same places, and the second one is often finishing what the first started.
export const CROWD_STEP = 0.6;

// And a sector with nothing left in it comes back at twice the rate of a full one.
// Anchored at 1.0 for the same reason the floor exists: this is meant to fill a
// hole, not to turn a cleared sector into a fountain.
export const EMPTY_STEP = 1.0;

// Nothing comes back faster than this, whatever the arithmetic says. A hostile
// that reappears the instant it dies is not a population, it is a spawn camp.
export const MIN_RESPAWN = 3;

// `pilots` is how many are in the sector, `alive` and `total` how much of its
// population is standing. Returns seconds.
export function respawnDelay(base, { pilots = 1, alive = 1, total = 1 } = {}) {
  const secs = Number(base) || 0;
  if (secs <= 0) return 0;
  const crowd = 1 + CROWD_STEP * Math.max(0, (pilots || 0) - 1);
  const share = total > 0 ? Math.max(0, Math.min(1, alive / total)) : 1;
  const empty = 1 + EMPTY_STEP * (1 - share);
  return Math.max(MIN_RESPAWN, secs / (crowd * empty));
}

// What the same sector looks like at a glance, for anything that wants to explain
// itself — the number of times faster than the posted rate it is currently coming
// back. 1 means the sector is quiet and full.
export const refillRate = (opts) => {
  const base = 100;                                  // any base; the ratio is what matters
  return base / respawnDelay(base, opts);
};
