// Ships, attributes and fitting.
//
// Nothing reads a stat off a hull directly. Every stat goes through resolve(),
// which folds the hull's base values together with whatever is fitted. Adding a
// new attribute means adding one line to ATTRS; adding a new module means one
// entry in MODULES. No other file changes.

import { EQUIPMENT, emptyFit, fitList, sanitiseFit as cleanFit } from './gear.js';

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
  fireRate:    { label: 'Rate of fire', unit: '/s',  dflt:  1.4, better: 'high', min: 0.1 },
  weaponRange: { label: 'Weapon range', unit: '',    dflt:  700, better: 'high', min: 100 },
  cargo:       { label: 'Cargo hold',   unit: '',    dflt:   60, better: 'high', min: 0 },

};

// Every hull carries the same TOTAL number of slots, distributed differently.
// A cruiser gets more hardpoints and generators; an interceptor gets more
// technology slots, which is where the interesting choices are. Nobody simply
// gets more of everything.
export const HULLS = {
  // Radar deliberately runs WITH size, not against it. A big hull carries a big
  // sensor array but is impossible to shake; a small one is nearly a ghost but
  // half blind. Giving the interceptor both the best eyes and the smallest
  // signature would make it the scouting ship AND the fastest ship.
  kestrel:  { slots: { weapon: 2, generator: 2, tech: 3 }, name: 'Kestrel',  cls: 'Interceptor', r: 10,
              attrs: { hull:  700, shield:  500, shieldRegen: 60, shieldDelay: 4, speed: 430, accel: 1600,
                       radar: 2000, signature: 1.5, damage: 38, fireRate: 2.2, weaponRange: 620,
                       cargo: 30 } },
  vanguard: { slots: { weapon: 3, generator: 2, tech: 2 }, name: 'Vanguard', cls: 'Fighter',     r: 13,
              attrs: { hull: 1100, shield:  900, shieldRegen: 40, shieldDelay: 6, speed: 340, accel: 1200,
                       radar: 2600, signature: 3.0, damage: 55, fireRate: 1.4, weaponRange: 700,
                       cargo: 60 } },
  bulwark:  { slots: { weapon: 4, generator: 2, tech: 1 }, name: 'Bulwark',  cls: 'Cruiser',     r: 17,
              attrs: { hull: 1900, shield: 1400, shieldRegen: 25, shieldDelay: 8, speed: 250, accel:  800,
                       radar: 3400, signature: 5.5, damage: 95, fireRate: 0.75, weaponRange: 820,
                       cargo: 120 } },
};
export const DEFAULT_HULL = 'vanguard';


export const slotsOf  = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).slots;
export const radiusOf = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).r;
export const sanitiseFit = (hullKey, fit) => cleanFit(slotsOf(hullKey), fit);

// base + every flat add, then multiplied once by the SUM of the percentages.
// Summing rather than compounding keeps three copies of a module worth three
// times one, instead of spiralling — the usual way stacking becomes pay-to-win.
export function resolve(hullKey, fit = emptyFit()) {
  const hull = HULLS[hullKey] ?? HULLS[DEFAULT_HULL];
  const out = {}, pct = {};
  for (const [k, a] of Object.entries(ATTRS)) out[k] = hull.attrs[k] ?? a.dflt;

  for (const key of fitList(fit)) {
    for (const [attr, op, v] of EQUIPMENT[key]?.mods ?? []) {
      if (!(attr in out)) continue;                       // unknown attribute: ignore, never crash
      if (op === 'add') out[attr] += v;
      else              pct[attr] = (pct[attr] ?? 0) + v;
    }
  }
  for (const [attr, p] of Object.entries(pct)) out[attr] *= 1 + p;
  for (const k of Object.keys(out)) out[k] = Math.max(ATTRS[k].min ?? 0, out[k]);
  return out;
}


