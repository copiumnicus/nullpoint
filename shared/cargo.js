// Ore, drops and holds.
//
// Real metals, and the ones actually worth chasing off-world: an M-type asteroid
// is iron and nickel by mass, with the platinum-group metals as the prize. The
// iridium anomaly at the K-Pg boundary is asteroid-delivered, which is the whole
// argument for going.
//
// A hold measures VOLUME and a unit is a billet of fixed mass, so denser metals
// take less room — iridium is nearly three times the density of iron, so the same
// mass of it occupies a third of the space. That is why a full hold is a decision
// rather than a wall: you stop being able to lift cheap bulk once the good stuff
// is aboard. `density` is the real figure in g/cm³ and a test keeps `vol` ranked
// consistently with it.

export const MATERIALS = {
  iron:     { name: 'Iron',      sym: 'Fe', tier: 1, density:  7.87, vol: 3, value:   3, colour: '#8d7f6e' },
  nickel:   { name: 'Nickel',    sym: 'Ni', tier: 2, density:  8.91, vol: 3, value:   9, colour: '#a8b4a0' },
  cobalt:   { name: 'Cobalt',    sym: 'Co', tier: 3, density:  8.90, vol: 3, value:  22, colour: '#4a7fd4' },
  rhodium:  { name: 'Rhodium',   sym: 'Rh', tier: 4, density: 12.41, vol: 2, value:  90, colour: '#ffd9e8' },
  platinum: { name: 'Platinum',  sym: 'Pt', tier: 5, density: 21.45, vol: 1, value: 260, colour: '#cfd8e3' },
  iridium:  { name: 'Iridium',   sym: 'Ir', tier: 6, density: 22.56, vol: 1, value: 600, colour: '#7fd4c8' },
};

// Weights must sum to 1. A test enforces that, and that rarer never beats commoner.
export const DROPS = {
  drifter: [
    { mat: 'iron',     p: 0.44, min: 1, max: 4 },
    { mat: 'nickel',   p: 0.26, min: 1, max: 3 },
    { mat: 'cobalt',   p: 0.16, min: 1, max: 2 },
    { mat: 'rhodium',  p: 0.09, min: 1, max: 2 },
    { mat: 'platinum', p: 0.04, min: 1, max: 1 },
    { mat: 'iridium',  p: 0.01, min: 1, max: 1 },
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

// Clicking cargo is an ORDER, not a request. If it is out of reach the ship flies
// to it and hauls it in on arrival — refusing with "too far" and doing nothing was
// the wrong answer to a click that plainly meant "go get that".
export function approachPod(ship, hold, pod) {
  if (!pod) return { done: true, why: 'gone' };
  if (Math.hypot(pod.x - ship.x, pod.y - ship.y) > SCOOP_R * 0.8)
    return { fly: { x: pod.x, y: pod.y } };            // come well inside, not to the edge
  const started = beginScoop(ship, hold, pod);
  return typeof started === 'string' ? { done: true, why: started } : { scoop: started };
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

// The other direction: hangar back onto the ship, as much of the stack as fits.
export function load(vault, hold, mat, n, cap) {
  const took = stow(hold, mat, Math.min(vault[mat] ?? 0, n), cap);
  if (took > 0) {
    vault[mat] -= took;
    if (vault[mat] <= 0) delete vault[mat];
  }
  return took;
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
