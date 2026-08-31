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

// Weights must sum to 1 and rarer must never beat commoner. Both are tested.
//
// One shape, six rungs. The husk is what an M-type asteroid is made of, commonest
// first, and a hostile drops the part of that ladder it is worth killing for.
const HUSK = [
  { mat: 'iron',     p: 0.44, min: 3, max: 9 },
  { mat: 'nickel',   p: 0.26, min: 2, max: 7 },
  { mat: 'cobalt',   p: 0.16, min: 2, max: 5 },
  { mat: 'rhodium',  p: 0.09, min: 1, max: 4 },
  { mat: 'platinum', p: 0.04, min: 1, max: 3 },
  { mat: 'iridium',  p: 0.01, min: 1, max: 2 },
];

// Where a hostile's table STARTS on that ladder. This is the thing that was wrong.
//
// Every alien used to drop the same six metals and the big ones simply dropped
// more of them, so a Bandit — the hardest thing outside a boss fight — paid out
// in iron. Seventy-two units of it, 216 volume, worth 216 credits and filling most
// of an Ore Tender with the cheapest metal in the game. You flew to the frontier,
// beat the thing that lives there, and hauled home scrap.
//
// So the rung is derived from how hard the thing is to kill, and it is not a table
// anybody picked. The bestiary is a ladder of tens — 650, 6500, 65000, 650000 —
// and the metals are a ladder of roughly threes by value (3, 9, 22, 90, 260, 600).
// Two metal rungs per hostile rung is 3² ≈ 10, so the two ladders are the same
// ladder at different resolutions:
//
//   rung = 1 + round(2 · log10(ehp / 650))
//
// Anything new lands on it without anyone choosing, which is the point.
//
// Clamped at platinum rather than iridium. A table with one row left is not a
// table, it is a fixed drop, and the top of the metal ladder should stay something
// you get lucky on rather than something you are paid.
export const BASE_HP = 650;                       // the Drifter: rung 1 by definition
export const TOP_RUNG = 5;
export const oreRung = ehp =>
  Math.min(TOP_RUNG, Math.max(1, 1 + Math.round(2 * Math.log10((ehp || BASE_HP) / BASE_HP))));

// And how MUCH, which is two rules pulling against each other.
//
// Ore should be worth about a fifth of what the kill pays, so it is a real part of
// the reward and never the whole of it — 0.14 credits per point of effective hit
// points, which is a fifth of the Drifter's 455 bounty and therefore not a new
// number so much as the old one restated.
//
// And a pod has to FIT. Ore that will not go in the hold is not a reward, it is a
// second trip, so the worst pod a hostile can drop is capped at the hold of a pilot
// equipped to be in that sector. The value target binds at the bottom of the ladder
// and the ceiling binds at the top: a Corsair Hive would owe 47 Ore Tenders of
// platinum on value alone and drops exactly one. The rest of what a boss is worth
// stays in the bounty, which is where it can grow without asking anyone to make
// four trips — and where a group splits it without anyone having to ferry.
export const ORE_RATE = 0.14;

// Renormalised, so a hostile that drops no iron is not silently dropping nothing
// 44% of the time. rollDrop walks the weights and falls off the end otherwise.
export const husk = (rung, k) => {
  const rows = HUSK.slice(rung - 1);
  const tot = rows.reduce((s, r) => s + r.p, 0);
  return rows.map(r => ({ mat: r.mat, p: r.p / tot, min: r.min * k, max: r.max * k }));
};

//              rung  metal floor  k    worst pod        ore per kill
//   drifter      1   Iron          1    27 of a 60      ~81 cr
//   harrier      2   Nickel        2    42 of a 60      ~260 cr
//   ironhusk     3   Cobalt        4    60 of a 100     ~832 cr
//   censer       3   Cobalt        4    60 of a 100     ~832 cr
//   lamprey      4   Rhodium       8    64 of a 100     ~2860 cr
//   bandit       4   Rhodium      12    96 of a 240     ~4290 cr
//   kedge        5   Platinum     15    45 of a 240     ~8940 cr
//   thresher     5   Platinum     48   144 of a 240     ~28600 cr
//   leviathan    5   Platinum     15    45 of a 240     ~8940 cr
//   hive         5   Platinum     80   240 of a 240     ~47680 cr   (capped)
//   vitriol      5   Platinum     80   240 of a 240     ~47680 cr   (capped)
//   doldrum      5   Platinum     80   240 of a 240     ~47680 cr   (capped)
//
// The k column is min(value target, hold ceiling), rounded. test/cargo.mjs
// re-derives every one of these from shared/aliens.js and fails if a number here
// stops matching the rule that produced it.
export const DROPS = {
  drifter:   husk(1, 1),
  harrier:   husk(2, 2),
  ironhusk:  husk(3, 4),
  censer:    husk(3, 4),
  lamprey:   husk(4, 8),
  bandit:    husk(4, 12),
  kedge:     husk(5, 15),
  thresher:  husk(5, 48),
  leviathan: husk(5, 15),
  hive:      husk(5, 80),
  // The deeps, and they are the same k as the Hive because the same thing binds:
  // the value target asks for 0.14 credits per point of 2,055,480, which is 287,767
  // and about six Ore Tenders of platinum, and six trips is not a reward. Both drop
  // exactly one full hold and keep the rest in the bounty, where a party splits it
  // without anybody ferrying. The ceiling binds on three hostiles now rather than
  // one, which is the rule working rather than a coincidence.
  vitriol:   husk(5, 80),
  doldrum:   husk(5, 80),
};

// A pod dropped by a shared kill belongs to one of the pilots who earned it, so
// two collector rigs on the same wreck field are not in a race. An unclaimed pod
// — anything already lying around, or a kill with no ledger — is anyone's.
export const mayScoop = (pod, id) => !pod || !pod.own || pod.own === id;

// --- a pod that is not ore ------------------------------------------------------
//
// A duel's stake is a tenth of the loser's CREDITS as well as their hold, and the
// designer's line was "for the other player that they can pick up". Credits are not
// a metal: they have no volume, no density, no refinery rung and no sale price, so
// putting them in MATERIALS would give every one of those a meaningless answer and
// the refinery a seventh rung it must never compress.
//
// So a bond is a pod with `cr` on it and a `mat` that is deliberately NOT a
// material. Everything that asks a pod what it is goes through these three, which
// is what stops `MATERIALS[pod.mat]` being undefined in six places — it was, and
// the client drew a pod labelled `undefined` in the colour `#888` before this
// existed. It never touches the hold, so a full hold can still pick one up: cargo
// space is a reason to leave ore behind, and it would be a strange one to lose a
// fight's whole purse to.
export const BOND = { key: 'bond', name: 'Credit Bond', colour: '#e8c46a' };
export const isBond    = pod => pod?.mat === BOND.key;
export const podName   = pod => isBond(pod) ? BOND.name   : (MATERIALS[pod?.mat]?.name   ?? 'salvage');
export const podColour = pod => isBond(pod) ? BOND.colour : (MATERIALS[pod?.mat]?.colour ?? '#8d7f6e');

export const POD_LIFE   = 120;  // s before a pod disperses

// How long a share stays reserved. A claim that held for the pod's whole life
// meant a pilot who took a hit and left, or simply did not want the iron, left
// something on the field that everyone else could see and nobody could touch.
// After this it is ordinary salvage — still theirs to come back for first, but no
// longer nailed down. Kept well under POD_LIFE so the reservation lapses long
// before the pod does, and ore is released rather than wasted.
export const CLAIM_TIME = 40;
export const claimLapsed = pod => (pod?.t ?? 0) <= POD_LIFE - CLAIM_TIME;
export const SCOOP_R    = 260;  // px you must be inside to start hauling one in
export const SCOOP_TIME = 0.9;  // s the tractor takes — you are stationary prey while it runs

// How fast a hauling drone moves: always a bit quicker than the ship it belongs
// to. A flat 420 was faster than some hulls and slower than others, so on a
// Kestrel the drone could never catch up and on a Bulwark it shot off like it had
// been fired. Tying it to the ship means there is no hull it reads wrong on, and
// no number to retune when a new hull is added — it is faster than you, always,
// and that is the only property it actually needs.
export const DRONE_SPEED_MULT = 1.3;
export const droneSpeed = ship => Math.max(60, (ship?.stats?.speed ?? 300) * DRONE_SPEED_MULT);

// A rig has to hold station over what it is lifting. It used to be one number —
// travel plus a flat tractor time — which meant the ore simply vanished at the
// end of a flight, and nothing about it read as work being done.
export const DWELL = 1.4;   // s the drone sits over the pod, lifting

// How long a pull takes. `speed` of 0 is your own arm, which does not travel and
// does not hover: out, hold station, back.
export const pullTime = (dist, speed = 0) =>
  speed > 0 ? (2 * dist) / speed + DWELL : SCOOP_TIME;

// Where the drone is and what it is doing, derived from the scoop state alone so
// that the server and every watching client agree without another message. The
// legs are measured against the ship's position now rather than where it was when
// the order went out, because the ship keeps flying and a drone tethered to a
// stale point looked like it was falling behind.
export function rigAt(scoop, ship) {
  if (!scoop || !(scoop.out > 0)) return null;             // your own arm has no drone
  const elapsed = scoop.secs - scoop.t, out = scoop.out;
  const phase = elapsed < out ? 'out' : elapsed < out + DWELL ? 'work' : 'back';
  const along = phase === 'out'  ? elapsed / out
              : phase === 'work' ? 1
              : Math.max(0, 1 - (elapsed - out - DWELL) / out);
  // Against the pod's remembered place, not the live pod: the pod is spliced out
  // of the world the moment the lift completes, and the drone still has to fly
  // home from somewhere. Pods do not move, so remembering it costs nothing.
  return { phase, along,
           x: ship.x + (scoop.px - ship.x) * along,
           y: ship.y + (scoop.py - ship.y) * along,
           work: phase === 'work' ? Math.min(1, (elapsed - out) / DWELL) : 0 };
}

// What a pirate pays for ore, against what your own company's hangar pays. They
// take a quarter, and that quarter is the price of not flying home: a full hold
// that would otherwise stop the run cold is worth more emptied at 75% than
// carried at 100%. Selling at your own dock is still the thrifty way to do it.
export const PIRATE_RATE = 0.75;
export const pirateValue = hold =>
  Math.floor(Object.entries(hold).reduce((s, [m, n]) => s + n * (MATERIALS[m]?.value ?? 0), 0) * PIRATE_RATE);

// What dying costs beyond the hold.
//
// Losing the cargo alone meant a pilot flying empty had nothing at stake: the
// cheapest way through a hard fight was to dump the hold and treat the wreck as a
// free ride home. A tenth of what you are carrying in credits goes with the ship.
//
// A tenth rather than a flat sum, so it scales with what you actually have — a
// new pilot loses pocket change and a rich one loses a real number — and it can
// never take the last of it, which is the difference between a setback and being
// unable to buy your way back into the game.
export const DEATH_TOLL = 0.10;
export const tollOn = credits => Math.floor(Math.max(0, credits) * DEATH_TOLL);

export const CURRENCY = { name: 'credits', short: 'cr' };

// Credits, at a size a person can read.
//
// A seven-figure balance printed in full is a number you have to count digits on:
// 4120000 and 41200000 look identical at a glance and differ by an order of
// magnitude. The rule is about three or four significant figures and a suffix,
// which is how anybody says these out loud anyway — "four point one two million".
//
// Small numbers stay exact, because a price of 3400 is a price you compare
// against another price, and 3.40k is strictly worse for that.
export function fmtCredits(n) {
  const v = Math.round(Number(n) || 0);
  const a = Math.abs(v), sign = v < 0 ? '-' : '';
  // Two decimals, then trailing zeros dropped: 4.12M keeps both because both say
  // something, 4.00M is just "4M" with noise on the end. Past three figures the
  // decimals stop carrying information at all, so 412k rather than 412.00k.
  const trim = t => t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const cut = (d, unit) => sign + trim((a / d).toFixed(a / d >= 100 ? 0 : 2)) + unit;
  if (a >= 1e9) return cut(1e9, 'B');
  if (a >= 1e6) return cut(1e6, 'M');
  if (a >= 1e4) return cut(1e3, 'k');
  return String(v);
}

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
// How many units of this would actually fit. Volume differs by metal, so "full"
// is a question about a particular ore rather than about the hold — there can be
// room for an iridium and none for an iron.
export const roomFor = (hold, mat, cap) =>
  Math.max(0, Math.floor((cap - holdVol(hold)) / volOf(mat)));
export const holdFullFor = (hold, mat, cap) => roomFor(hold, mat, cap) <= 0;

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
export function beginScoop(ship, hold, pod, reach = SCOOP_R, speed = 0) {
  if (!pod) return 'gone';
  const away = Math.hypot(pod.x - ship.x, pod.y - ship.y);
  if (away > reach) return 'far';
  // A bond has no volume, so a full hold is not a reason to refuse one.
  if (!isBond(pod) && stow({ ...hold }, pod.mat, 1, ship.stats.cargo) === 0) return 'full';
  const t = pullTime(away, speed);
  // `out` is the outbound leg, and it is what tells rigAt whether there is a drone
  // in this pull at all. Your own tractor beam has none.
  return { id: pod.id, t, secs: t, reach, out: speed > 0 ? away / speed : 0,
           px: pod.x, py: pod.y, done: false };
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
// The lift lands at the end of the dwell, and the flight home afterwards is only
// a flight home. Two things used to go wrong here, both because the pull was one
// undivided timer that cancelled on distance:
//
//   - flying off mid-pull abandoned the ore on the floor, which punished you for
//     doing the exact thing a FETCHING drone exists to let you do
//   - and it cancelled against `reach`, so a rig could never work at its own
//     stated range while the ship was moving away at all
//
// Once a pull has started it is committed. The drone finishes it and then comes
// to wherever you now are — rigAt measures the legs against the ship's current
// position, so it chases rather than returning to a stale point.
export function stepScoop(scoop, pod, ship, hold, dt) {
  if (!scoop) return { running: false, took: 0 };
  if (ship.hp <= 0) return { running: false, took: 0, cancelled: true };
  // Before the lift the pod has to still be there; after it, the pod is gone by
  // definition and there is nothing left to check.
  if (!pod && !scoop.done) return { running: false, took: 0, cancelled: true };
  scoop.t -= dt;
  const elapsed = scoop.secs - scoop.t;
  const liftAt = scoop.out > 0 ? scoop.out + DWELL : scoop.secs;
  if (!scoop.done && elapsed >= liftAt) {
    scoop.done = true;
    // A bond goes onto the balance rather than into the hold, and it always goes
    // whole — there is no partial lift of a number. `cr` is handed back for the
    // caller to bank, because this file does not know what an account is.
    if (isBond(pod)) return { running: scoop.out > 0, took: 0, cr: pod.cr ?? 0, emptied: true };
    const took = stow(hold, pod.mat, pod.n, ship.stats.cargo);
    pod.n -= took;
    // An arm has no drone to fly home, so for it the lift IS the end.
    return { running: scoop.out > 0, took, emptied: pod.n <= 0 };
  }
  return { running: scoop.t > 0, took: 0 };
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
