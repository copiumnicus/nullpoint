// Ore, drops and holds.
//
// Rarity is expressed twice on purpose: rarer metals appear less often AND take
// less room, so a full hold is a decision rather than a wall. You dump nothing —
// you simply stop being able to pick up the cheap bulk once the good stuff is in.

export const MATERIALS = {
  ferrocite: { name: 'Ferrocite', tier: 1, vol: 2, value:   4, colour: '#9aa3ad' },
  cryolite:  { name: 'Cryolite',  tier: 2, vol: 2, value:  12, colour: '#7fd4ff' },
  vantium:   { name: 'Vantium',   tier: 3, vol: 1, value:  40, colour: '#b06adf' },
  solarite:  { name: 'Solarite',  tier: 4, vol: 1, value: 130, colour: '#ffb43f' },
  nullstone: { name: 'Nullstone', tier: 5, vol: 1, value: 500, colour: '#ff5c8a' },
};

// Weights must sum to 1. A test enforces that, and that rarer never beats commoner.
export const DROPS = {
  drifter: [
    { mat: 'ferrocite', p: 0.55, min: 1, max: 3 },
    { mat: 'cryolite',  p: 0.28, min: 1, max: 2 },
    { mat: 'vantium',   p: 0.12, min: 1, max: 1 },
    { mat: 'solarite',  p: 0.04, min: 1, max: 1 },
    { mat: 'nullstone', p: 0.01, min: 1, max: 1 },
  ],
};

export const POD_LIFE   = 120;  // s before a pod disperses
export const SCOOP_R    = 260;  // px you must be inside to start hauling one in
export const SCOOP_TIME = 0.9;  // s the tractor takes — you are stationary prey while it runs

export const CURRENCY = { name: 'credits', short: 'cr' };

// rand must be the caller's seeded generator, so drops stay reproducible.
export function rollDrop(kind, rand) {
  const table = DROPS[kind];
  if (!table) return null;
  let r = rand();
  for (const row of table) {
    if ((r -= row.p) <= 0) return { mat: row.mat, n: row.min + Math.floor(rand() * (row.max - row.min + 1)) };
  }
  const last = table[table.length - 1];
  return { mat: last.mat, n: last.min };
}

export const volOf  = mat => MATERIALS[mat]?.vol ?? 1;
export const holdVol = hold => Object.entries(hold).reduce((s, [m, n]) => s + n * volOf(m), 0);
export const holdValue = hold => Object.entries(hold).reduce((s, [m, n]) => s + n * (MATERIALS[m]?.value ?? 0), 0);

// Stows what fits and reports how much that was. Never overfills, never throws on
// an unknown material — it just refuses it.
export function stow(hold, mat, n, cap) {
  if (!MATERIALS[mat] || n <= 0) return 0;
  const room = Math.max(0, cap - holdVol(hold));
  const take = Math.min(n, Math.floor(room / volOf(mat)));
  if (take > 0) hold[mat] = (hold[mat] ?? 0) + take;
  return take;
}

// --- tractor beam -----------------------------------------------------------
// Kept here rather than inline in the server so it can be tested without a socket.
// Returns a scoop state, or a string saying why not.
export function beginScoop(ship, hold, pod) {
  if (!pod) return 'gone';
  if (Math.hypot(pod.x - ship.x, pod.y - ship.y) > SCOOP_R) return 'far';
  if (stow({ ...hold }, pod.mat, 1, ship.stats.cargo) === 0) return 'full';
  return { id: pod.id, t: SCOOP_TIME };
}

// Advances a beam. Drifting out of reach or dying cancels it and the cargo stays put.
export function stepScoop(scoop, pod, ship, hold, dt) {
  if (!scoop) return { running: false, took: 0 };
  if (!pod || ship.hp <= 0 || Math.hypot(pod.x - ship.x, pod.y - ship.y) > SCOOP_R)
    return { running: false, took: 0, cancelled: true };
  scoop.t -= dt;
  if (scoop.t > 0) return { running: true, took: 0 };
  const took = stow(hold, pod.mat, pod.n, ship.stats.cargo);
  pod.n -= took;
  return { running: false, took, emptied: pod.n <= 0 };
}

// Moves up to `vol` worth of cargo from hold into vault, rarest first so a player
// who undocks early keeps the least valuable half.
//
// Returns the VOLUME spent, not the item count. A caller metering this over time
// has to know how much of its budget was actually consumed: hand it back an item
// count and a two-volume ore can never move on a one-volume budget, so the budget
// gets burned every tick and nothing is ever unloaded.
export function unload(hold, vault, vol) {
  let left = vol;
  const order = Object.keys(hold).sort((a, b) => (MATERIALS[b]?.tier ?? 0) - (MATERIALS[a]?.tier ?? 0));
  for (const m of order) {
    while (hold[m] > 0 && left >= volOf(m)) {
      hold[m]--; left -= volOf(m);
      vault[m] = (vault[m] ?? 0) + 1;
      if (hold[m] === 0) delete hold[m];
    }
  }
  return vol - left;
}
