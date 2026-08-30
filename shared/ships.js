// Ships, attributes and fitting.
//
// Nothing reads a stat off a hull directly. Every stat goes through resolve(),
// which folds the hull's base values together with whatever is fitted. Adding a
// new attribute means adding one line to ATTRS; adding a new module means one
// entry in MODULES. No other file changes.

import { EQUIPMENT, emptyFit, fitList, droneItems, sanitiseFit as cleanFit } from './gear.js';
import { FORMATIONS, DEFAULT_FORMATION, BONUS_AT, escortScale } from './formation.js';
import { BOOST } from './power.js';
// The shipped setting of each ability, imported rather than restated: these are
// the DEFAULTS of six ATTRS rows, so a technology can retune an ability the same
// way one retunes a shield clock. ability.js argues every one of the numbers and
// every one of the ceilings below; see its comments before moving one.
import { VEIL_DEPTH, VEIL_RECOVER, ANCHOR_SWELL, ANCHOR_DRAG, LOCK_TIGHTEN, LOCK_REACH }
  from './ability.js';

// One cycle rate for every hull, on purpose. Emitters add FLAT damage to a bolt
// and the rate multiplies the lot, so a hull that fired faster multiplied every
// emitter harder — a fully specced Bulwark ended up behind the free starter, and
// weapon slots stopped meaning anything. Hulls differ by base damage, reach and
// how many hardpoints they carry; not by how fast the trigger works.
export const FIRE_RATE = 1.2;

export const ATTRS = {
  hull:        { label: 'Hull',         unit: '',    dflt: 1000, better: 'high', min: 1 },
  shield:      { label: 'Shield',       unit: '',    dflt:  800, better: 'high', min: 0 },
  shieldRegen: { label: 'Shield regen', unit: '/s',  dflt:   40, better: 'high', min: 0 },
  shieldDelay: { label: 'Regen delay',  unit: 's',   dflt:    6, better: 'low',  min: 0.5 },
  speed:       { label: 'Speed',        unit: '',    dflt:  340, better: 'high', min: 40 },
  accel:       { label: 'Thrust',       unit: '',    dflt: 1200, better: 'high', min: 100 },
  radar:       { label: 'Radar range',  unit: '',    dflt: 2600, better: 'high', min: 300 },
  signature:   { label: 'Signature',    unit: 's',   dflt:    3, better: 'low',  min: 0.4 },
  damage:      { label: 'Damage',       unit: '',    dflt:   55, better: 'high', min: 1 },
  fireRate:    { label: 'Rate of fire', unit: '/s',  dflt: FIRE_RATE, better: 'high', min: 0.1 },
  weaponRange: { label: 'Weapon range', unit: '',    dflt:  700, better: 'high', min: 100 },
  cargo:       { label: 'Cargo hold',   unit: '',    dflt:   60, better: 'high', min: 0 },
  capacitor:   { label: 'Capacitor',    unit: 's',   dflt:   45, better: 'high', min: 1 },
  recharge:    { label: 'Recharge',     unit: '/s',  dflt:  1.8, better: 'high', min: 0.1 },
  sustain:     { label: 'Free output',  unit: '',    dflt: 0.33, better: 'high', min: 0, max: 0.9 },
  // Rockets are counted and paid for as a volley, not per launcher: adding a
  // rack adds both its rockets and its share of the damage, so two racks of the
  // same model land the same rocket twice rather than one twice as hard.
  rockets:     { label: 'Rockets',      unit: '',    dflt:    0, better: 'high', min: 0 },
  rocketVolley:{ label: 'Rocket volley', unit: '',   dflt:    0, better: 'high', min: 0 },

  // --- the escort ------------------------------------------------------------
  // How many drones the formation needs before it pays in full, and how hard it
  // pays once it does. formation.js argues the split; BONUS_AT is the default of
  // the first and 1 is the default of the second, so a ship with nothing fitted
  // flies exactly the escort it always did.
  //
  // `escort` is capped, and the cap is not decoration: the Attack Wedge multiplies
  // DAMAGE, so an uncapped escort dial is an uncapped damage dial wearing a hat.
  cohesion:    { label: 'Formation at', unit: ' drones', dflt: BONUS_AT, better: 'low', min: 1 },
  escort:      { label: 'Escort bonus', unit: 'x',   dflt: 1, better: 'high', min: 0, max: 2 },

  // --- the fourth system -----------------------------------------------------
  // The hull's own ability, one row per dial. Only the hull that HAS the ability
  // reads them — a Veil depth on a Bulwark is a number nothing looks at — which
  // is what makes these the shelf's first class-specific technologies.
  //
  // Every ceiling is ability.js's argument, not a round number. 0.94 leaves a
  // Kestrel findable at 6% of your radar instead of 12%, and a veil deeper than
  // that is not stealth, it is an exit from the game.
  veilDepth:   { label: 'Veil depth',   unit: '',    dflt: VEIL_DEPTH,   better: 'high', min: 0,   max: 0.94 },
  veilRecover: { label: 'Veil rebuild', unit: 's',   dflt: VEIL_RECOVER, better: 'low',  min: 0.4 },
  anchorSwell: { label: 'Anchor swell', unit: 'x',   dflt: ANCHOR_SWELL, better: 'high', min: 0,   max: 5 },
  anchorDrag:  { label: 'Anchor drag',  unit: '',    dflt: ANCHOR_DRAG,  better: 'low',  min: 0.1, max: 0.95 },
  lockTighten: { label: 'Lock bite',    unit: 'x',   dflt: LOCK_TIGHTEN, better: 'high', min: 0,   max: 2 },
  lockReach:   { label: 'Lock cost',    unit: '',    dflt: LOCK_REACH,   better: 'low',  min: 0,   max: 0.8 },
};

// Every hull carries the same TOTAL number of slots, distributed differently.
// A cruiser gets more hardpoints and generators; an interceptor gets more
// technology slots, which is where the interesting choices are. Nobody simply
// gets more of everything.
export const HULLS = {
  // The one you start with. Visibly worse at everything that wins a fight, but
  // nimble, quiet and roomy enough to earn the price of a real ship.
  hauler:   { slots: { weapon: 1, generator: 1, tech: 1 }, price: 0,
              name: 'Hauler', cls: 'Tender', r: 12,
              blurb: 'The starter. The biggest hold, the weakest guns.',
              attrs: { hull: 650, shield: 450, shieldRegen: 30, shieldDelay: 6, speed: 300, accel: 1000,
                       radar: 2200, signature: 3.5, damage: 30, fireRate: FIRE_RATE, weaponRange: 640,
                       cargo: 90, capacitor: 30, recharge: 1.5, sustain: 0.30 } },

  // Radar deliberately runs WITH size: a big hull carries a big sensor array but
  // cannot shake anyone, a small one is a ghost that is half blind.
  kestrel:  { ability: 'veil', slots: { weapon: 2, generator: 2, tech: 3 }, price: 18000,
              name: 'Kestrel', cls: 'Interceptor', r: 10,
              blurb: 'Fastest and quietest. It cannot take a beating.',
              attrs: { hull: 700, shield: 500, shieldRegen: 60, shieldDelay: 4, speed: 430, accel: 1600,
                       radar: 2000, signature: 1.5, damage: 38, fireRate: FIRE_RATE, weaponRange: 620,
                       cargo: 30, capacitor: 45, recharge: 2.2, sustain: 0.33 } },
  vanguard: { ability: 'lock', slots: { weapon: 3, generator: 2, tech: 2 }, price: 26000,
              name: 'Vanguard', cls: 'Fighter', r: 13,
              blurb: 'The all-rounder. Good at everything, best at none.',
              attrs: { hull: 1100, shield: 900, shieldRegen: 40, shieldDelay: 6, speed: 340, accel: 1200,
                       radar: 2600, signature: 3.0, damage: 55, fireRate: FIRE_RATE, weaponRange: 700,
                       cargo: 60, capacitor: 45, recharge: 1.8, sustain: 0.33 } },
  bulwark:  { ability: 'anchor', slots: { weapon: 4, generator: 2, tech: 1 }, price: 40000,
              name: 'Bulwark', cls: 'Cruiser', r: 17,
              blurb: 'The most hull and the most guns, and the slowest.',
              attrs: { hull: 1900, shield: 1400, shieldRegen: 25, shieldDelay: 8, speed: 250, accel: 800,
                       radar: 3400, signature: 5.5, damage: 95, fireRate: FIRE_RATE, weaponRange: 820,
                       cargo: 120, capacitor: 60, recharge: 1.5, sustain: 0.36 } },
};
export const DEFAULT_HULL = 'hauler';


export const slotsOf  = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).slots;
export const radiusOf = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).r;
export const hullPrice = hullKey => HULLS[hullKey]?.price ?? Infinity;

// Every emitter is a gun in its own right, wherever it is mounted.
// Lasers only. A launcher sits in a weapon slot but is not a barrel, and counting
// it as one would split the rack's bolt damage across guns that never fire a bolt.
const isLaser = k => EQUIPMENT[k]?.slot === 'weapon' && EQUIPMENT[k]?.kind !== 'rocket';
export const gunsOf = (fit, drones = []) =>
  Math.max(1, (fit?.weapon ?? []).filter(isLaser).length +
              droneItems(drones).filter(isLaser).length);
export const sanitiseFit = (hullKey, fit) => cleanFit(slotsOf(hullKey), fit);

// base + every flat add, then multiplied once by the SUM of the percentages.
// Summing rather than compounding keeps three copies of a module worth three
// times one, instead of spiralling — the usual way stacking becomes pay-to-win.
export function resolve(hullKey, fit = emptyFit(), drones = [], formation = DEFAULT_FORMATION) {
  const hull = HULLS[hullKey] ?? HULLS[DEFAULT_HULL];
  const out = {}, pct = {};
  for (const [k, a] of Object.entries(ATTRS)) out[k] = hull.attrs[k] ?? a.dflt;

  for (const key of [...fitList(fit), ...droneItems(drones)]) {
    for (const [attr, op, v] of EQUIPMENT[key]?.mods ?? []) {
      if (!(attr in out)) continue;                       // unknown attribute: ignore, never crash
      if (op === 'add') out[attr] += v;
      else              pct[attr] = (pct[attr] ?? 0) + v;
    }
  }
  // A formation only pays out once there is an escort to fly it, and pays in full
  // at `cohesion` drones — three, unless something fitted says otherwise.
  //
  // The escort dials have to be SETTLED before the formation is folded in. They
  // are multipliers on the bonus, and the bonus arrives as entries in `pct` that
  // are not multiplied by anything until the loop below — so reading them off
  // `out` after that loop would apply the technology to a number that had already
  // been spent, and reading them before it would ignore the technology entirely.
  // Resolved here, removed from `pct`, and clamped once: the same two steps the
  // final loop does, taken early because this pair is an input to it.
  for (const k of ['cohesion', 'escort']) {
    if (k in pct) { out[k] *= 1 + pct[k]; delete pct[k]; }
    out[k] = Math.min(ATTRS[k].max ?? Infinity, Math.max(ATTRS[k].min ?? 0, out[k]));
  }
  const scale = escortScale((drones ?? []).length, out);
  if (scale > 0) for (const [attr, op, v] of FORMATIONS[formation]?.mods ?? []) {
    if (!(attr in out)) continue;
    if (op === 'add') out[attr] += v * scale;
    else              pct[attr] = (pct[attr] ?? 0) + v * scale;
  }

  for (const [attr, p] of Object.entries(pct)) out[attr] *= 1 + p;
  for (const k of Object.keys(out))
    out[k] = Math.min(ATTRS[k].max ?? Infinity, Math.max(ATTRS[k].min ?? 0, out[k]));

  // What a generator takes in speed, it gives back as reactor headroom.
  //
  // A generator is a straight trade: shields and capacitor for thrust. But the
  // reactor it enlarges could only ever pay out BOOST, a flat 30%, so fitting one
  // made every routing decision a little worse as well — you were slower, and
  // routing to thrusters could not get you back to where you started.
  //
  // The ceiling now rises by the same fraction of your hull's speed that the
  // generators cost you. Fit 3% of your speed away and the ceiling is 33%, so
  // routing to thrusters is roughly break-even and routing to weapons or shields
  // is worth 3% more than it was. It is not free: the headroom only pays while
  // you are spending capacitor, which is exactly what a bigger reactor is for.
  //
  // Measured against the hull's bare speed rather than the resolved one, so
  // stacking generators cannot compound — two cells that each cost 3% raise the
  // ceiling by 6%, not by 6.09%.
  let lost = 0;
  for (const key of [...fitList(fit), ...droneItems(drones)]) {
    if (EQUIPMENT[key]?.slot !== 'generator') continue;
    for (const [attr, op, v] of EQUIPMENT[key].mods ?? [])
      if (attr === 'speed' && op === 'add' && v < 0) lost -= v;
  }
  const bare = hull.attrs.speed ?? ATTRS.speed.dflt;
  // You cannot give up more speed than you have. Speed is clamped at ATTRS.speed.min
  // on the way out, so past that floor a generator costs you nothing further —
  // but `lost` went on summing, and the ceiling went on rising for it. A Bulwark
  // with two fitted E-Cells and twelve more on drones sat at the 40px/s floor
  // banking a 198% ceiling: a 2.98x reactor bought with speed it had already
  // spent. Clamped to what was actually surrendered, the same build reads 114%.
  const givable = Math.max(0, bare - (ATTRS.speed.min ?? 0));
  out.boost = BOOST + (bare > 0 ? Math.min(lost, givable) / bare : 0);
  return out;
}


