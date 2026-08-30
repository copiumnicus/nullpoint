// What a technology lets you DO.
//
// The shelf was twenty-six entries and every single one of them was a stat swap:
// a third more hull for nine percent of your speed, half again your reach for a
// quarter of your legs, fifty percent more thrust for fourteen percent of your
// top end. Reading that list is arithmetic homework, and the honest answer to
// most of it is that it is a wash. "Every technology must give something up" had
// been read as "every technology is a paired stat penalty", and THAT reading is
// what made the whole shelf feel like nothing worth buying.
//
// So an entry now has to pass a different test: you have to be able to say what
// fitting it LETS YOU DO. gear.js carries that sentence on the entry itself
// (`does`, which the tooltip draws) and names what the thing takes (`spends`).
// This file is the machinery behind the ones whose answer is not an attribute.
//
// Giving something up still holds, and it is still enforced — it just no longer
// has to be a number on the same row. A cost can be a resource the ship needs
// somewhere else (a hold, a reactor), or being no use at all in half your
// fights. SPENDS is the list of costs that are actually implemented here, and
// test/tech.mjs checks every `spends` on the shelf against it, so a cost cannot
// be a promise on a shop row with nothing behind it.
//
// Nothing in here reads an attribute. These are capabilities: a rule that is true
// for a ship with the thing fitted and false for one without. They are looked up
// off `ship.tech` — a Set that sim.js builds once at newShip/refit, so a
// technology carried by a drone counts exactly as much as one in the rack, which
// is the rule sanitiseDrones already enforces from the other side.

import { techSet } from './gear.js';
import { MATERIALS, volOf } from './cargo.js';
import { LADDER } from './refine.js';
import { KITS, KIT_QUIET } from './repair.js';
import { chargePct } from './power.js';
import { ROCKET_RATE } from './rockets.js';
import { BOUNTY_RATE } from './aliens.js';
import { driftDepth, DRIFT_MARGIN } from './sim.js';

export { techSet };

const EMPTY = new Set();
// Takes a ship (which carries its own resolved set) or a bare Set, because the
// client asks these questions about a fit it is only previewing and has no ship
// for. One function either way, or the shop and the simulation would answer
// differently about the same loadout — which is the drift shared/ exists to stop.
const setOf = s => (s instanceof Set ? s : (s?.tech ?? EMPTY));
export const has = (s, key) => setOf(s).has(key);

// Every cost this file actually implements. gear.js `spends` is checked against
// it, so "it costs you your hold" cannot appear on a shop row unless something
// here takes the hold.
// Worded so that "Costs you ___." reads as a sentence, because that is exactly
// what the tooltip does with it.
export const SPENDS = Object.freeze({
  hold:      'the ore you are carrying',
  reactor:   'capacitor, continuously, while it is working',
  standdown: 'the tank you used to fill by standing still',
  attention: 'being noticed sooner by everything out there',
});

// --- Composite Plating: one killing blow ------------------------------------
//
// The plating takes the hit that would have killed you and is gone until you are
// next at a dock. What it puts back is a Patch Drone's worth, read off the
// cheapest kit in the shop rather than picked: the free save is never better than
// the cheapest thing you could have bought for the job, it is just always there.
export const PLATE_BACK = KITS.kit1.heal;              // 0.30 of your hull

// Whether this ship's plating catches this death, and what it leaves you on.
// `armed` is the server's flag — the plating is spent once and re-seated at a
// dock, so a pilot who never goes home never gets a second one.
export const platingArmed = (ship, armed) => !!armed && has(ship, 'plating');
export const platingBack = ship => Math.max(1, (ship.stats?.hull ?? 1) * PLATE_BACK);

// --- Ore Foundry: your hold is your hull -------------------------------------
//
// It mends at the Patch Drone's rate — 30% of a hull in 4 seconds is 0.075 of it
// a second — and it does that forever, so long as there is something in the hold
// to feed it. A kit is one lump and is spent; this is a trickle that costs cargo.
export const FOUNDRY_RATE  = KITS.kit1.heal / KITS.kit1.secs;   // 0.075 of max hull / s
// A kit is a decision to stand still for five seconds and it asks for six of
// quiet to earn that. A foundry is not a lump and never stops the ship, so it
// asks half — enough that it can never be a mid-fight heal between passes.
export const FOUNDRY_QUIET = KIT_QUIET / 2;                     // 3.0s

// The exchange rate, and it is a design statement rather than a number: A FULL
// HOLD MENDS A FULL HULL. That falls straight out of the ship, so it is right for
// every hull and every fit without anyone tuning it — and it means the Foundry's
// own -30% of hold makes each unit of ore worth proportionally MORE, so what a
// full hold is worth stays exactly one hull.
//
// Priced by VOLUME rather than by value, deliberately. Value was tried first and
// is useless at both ends of the game: a starter's whole hold of iron is 90
// credits, which at the shop's ten credits a hit point mends nine of them, and a
// refined hold is worth so much that the furnace becomes free. Volume makes iron
// the fuel and leaves the platinum worth carrying home, which is the decision the
// thing is for.
export const hullPerVol = stats => (stats?.hull ?? 0) / Math.max(1, stats?.cargo ?? 1);

// Ore comes in whole units and a unit of iron is worth more hull than one tick's
// allowance, so the furnace banks its allowance until it can afford one. Capped
// at the dearest single unit there is, or a ship that flew for a minute with an
// empty hold would swallow a whole stack the instant it scooped one.
const MAX_VOL = Math.max(...Object.values(MATERIALS).map(m => m.vol));

// Burns what it must and mends what that is worth, in place. Returns what moved,
// or null when there was nothing to do — same shape as refineStep, and separate
// from the tick for the same reason: it can be tested without a socket.
export function foundryBurn(ship, hold, dt) {
  if (!has(ship, 'foundry')) return null;
  if ((ship.sinceHit ?? 1e9) < FOUNDRY_QUIET) return null;
  const max = ship.stats?.hull ?? 0;
  if (!(max > 0) || ship.hp >= max) return null;
  const per = hullPerVol(ship.stats);
  if (!(per > 0)) return null;

  // The cap is on what is CARRIED, not on the total. Capping the total instead put
  // the ceiling at exactly the cost of one unit of iron on several hulls, so
  // `budget >= worth` came down to a float comparison of two numbers that were
  // meant to be equal — and the furnace stalled one unit short of a full hull,
  // forever, on a Vanguard and a Bulwark both.
  const cap = MAX_VOL * per;
  let budget = Math.min(ship.forge ?? 0, cap) + max * FOUNDRY_RATE * dt;
  let healed = 0, units = 0, mat = null;
  // Cheapest metal first, the same ladder the refinery walks: you feed it the
  // iron and keep the iridium, which is the whole reason this is priced by volume.
  for (const m of LADDER) {
    if (!((hold[m] ?? 0) > 0)) continue;             // none of this metal: try the next one up
    const worth = volOf(m) * per;
    while ((hold[m] ?? 0) > 0 && budget >= worth && ship.hp + healed < max) {
      hold[m] -= 1;
      if (hold[m] <= 0) delete hold[m];
      healed += Math.min(worth, max - ship.hp - healed);
      budget -= worth;
      units += 1; mat = m;
    }
    // Whether or not the budget stretched to one, THIS is the metal being fed in.
    // Falling through to the next rung meant the leftover budget got spent on
    // iridium — which takes a third of the room, so it costs a third of the
    // allowance — the moment it could no longer afford another iron. The furnace
    // waits for the iron; it does not go looking for something cheaper to burn.
    break;
  }
  ship.forge = Math.min(budget, cap);
  if (!units) return null;
  ship.hp = Math.min(max, ship.hp + healed);
  return { mat, units, healed };
}

// --- Wake Tap: the fight pays for itself -------------------------------------
//
// A kill hands back exactly the seconds of reactor the fight took. That is not a
// figure anybody picked — balance.js states the identity it comes out of:
//
//     credits per second of fight = your dps x BOUNTY_RATE
//
// exactly, for every hostile at every stage, because a bounty is farmHp x
// BOUNTY_RATE and a fight is farmHp / dps and the alien cancels. So your share of
// the bounty, divided by that rate, IS the number of seconds you spent on it. And
// power.js normalises draw so a fully powered system empties the capacitor in
// exactly `capacitor` seconds — one point of charge is one second of full boost.
// The two halves meet with nothing in between: a fight of n seconds gives back n
// seconds of boost, capped by the tank you actually have.
export const sustainedDps = stats => (stats?.damage ?? 0) * (stats?.fireRate ?? 0)
                                   + (stats?.rocketVolley ?? 0) * ROCKET_RATE;

export function wakeSeconds(credits, stats) {
  const dps = sustainedDps(stats);
  return dps > 0 ? Math.max(0, credits) / (BOUNTY_RATE * dps) : 0;
}

// Applies it. Returns the charge actually banked, so a caller can say so.
export function wakeTap(ship, credits) {
  if (!has(ship, 'waketap') || !ship.power) return 0;
  const cap = ship.stats?.capacitor ?? 0;
  const was = ship.power.charge ?? 0;
  ship.power.charge = Math.min(cap, was + Math.min(wakeSeconds(credits, ship.stats), cap));
  return ship.power.charge - was;
}

// --- Shear Compensator: the margin becomes ground ----------------------------
//
// sim.js opens 1800px of uncharted sky past every edge of the map and puts 45 to
// 2000 hull/s of gravitational shear in it, and until now NOTHING in the game
// mitigated any of it — the largest unused axis there was.
//
// The compensator nulls the shear for the first half of that margin, and what
// decides how much of the half you actually get is how much reactor you have
// left. Proportional rather than a switch, on purpose: a hard cut-off at an empty
// tank oscillates — the shear bites, the tank refills a tick later, the grace
// comes back — and reads as a bug. Sliding, it reads as exactly what it is,
// which is a margin closing on you as the reactor runs down.
export const SHEAR_GRACE = DRIFT_MARGIN / 2;    // px of shear it can hold off at a full tank
// And what holding it costs, in charge a second, at the hard limit — scaled by
// how far out you are, because that is what it is nulling. Measured against a
// stock Vanguard (45s of capacitor, 1.8/s of recharge):
//
//   400px out   1.33/s against 1.8/s of recharge — free, and a shelf you can live on
//   900px out   3.00/s, net -1.2/s: about 25s before the grace has shrunk under you
//   1800px out  6.00/s, net -4.2/s: ten seconds, and 534 hull/s waiting at the end
//
// Route anything at all and every one of those gets shorter, because the routed
// system is drawing from the same tank and the recharge stops entirely.
export const SHEAR_DRAW = 6;

export const shearGrace = ship =>
  has(ship, 'compensator') ? SHEAR_GRACE * chargePct(ship.power, ship.stats) : 0;

// The grace this ship has right now, having paid for it. Call it once a tick and
// hand the answer to stepDrift — sim.js deliberately knows nothing about the
// shelf, so the margin rule stays one function and the fitting rule stays here.
export function holdShear(ship, dt) {
  const grace = shearGrace(ship);
  if (grace <= 0) return 0;
  const depth = driftDepth(ship.x, ship.y);
  if (depth <= 0) return grace;                 // inside the chart it does nothing and costs nothing
  ship.power.charge = Math.max(0, (ship.power.charge ?? 0) - SHEAR_DRAW * (depth / DRIFT_MARGIN) * dt);
  return grace;
}

// --- Aspect Filter: camouflage stops working on you --------------------------
//
// stealth.js shapes a Bandit to be quiet from the front: nose-on it returns
// almost nothing and is drawn perhaps a sixth of the time, and the way to see one
// has been to get off its nose. The filter is an active illuminator — it stops
// asking what comes back and starts shouting — so aspect stops mattering and a
// Bandit is an ordinary ship from every angle.
//
// And it shouts at everything else too. Every hostile's aggro radius against you
// is multiplied, which puts all five of them past SIGHT_R: the sim's own note
// says aggro sits just inside the sight radius "so nothing can pick a fight from
// off-screen", and with this fitted everything does. That is the price, it is not
// a number on your ship, and it is exactly the thing the filter is doing.
export const LOUD = 1.6;
export const seesClear = s => has(s, 'filter');
export const loudOf = s => (has(s, 'filter') ? LOUD : 1);
