// Ships, attributes and fitting.
//
// Nothing reads a stat off a hull directly. Every stat goes through resolve(),
// which folds the hull's base values together with whatever is fitted. Adding a
// new attribute means adding one line to ATTRS; adding a new module means one
// entry in MODULES. No other file changes.

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
  slots:       { label: 'Slots',        unit: '',    dflt:    3, better: 'high', min: 0 },
};

// Every hull carries the same number of slots on purpose. Hulls are shapes, not
// tiers — a bigger ship trades speed and regen for bulk, it does not simply get
// more of everything. That is the whole point of the design.
export const HULLS = {
  // Radar deliberately runs WITH size, not against it. A big hull carries a big
  // sensor array but is impossible to shake; a small one is nearly a ghost but
  // half blind. Giving the interceptor both the best eyes and the smallest
  // signature would make it the scouting ship AND the fastest ship.
  kestrel:  { name: 'Kestrel',  cls: 'Interceptor', r: 10,
              attrs: { hull:  700, shield:  500, shieldRegen: 60, shieldDelay: 4, speed: 430, accel: 1600,
                       radar: 2000, signature: 1.5, damage: 38, fireRate: 2.2, weaponRange: 620 } },
  vanguard: { name: 'Vanguard', cls: 'Fighter',     r: 13,
              attrs: { hull: 1100, shield:  900, shieldRegen: 40, shieldDelay: 6, speed: 340, accel: 1200,
                       radar: 2600, signature: 3.0, damage: 55, fireRate: 1.4, weaponRange: 700 } },
  bulwark:  { name: 'Bulwark',  cls: 'Cruiser',     r: 17,
              attrs: { hull: 1900, shield: 1400, shieldRegen: 25, shieldDelay: 8, speed: 250, accel:  800,
                       radar: 3400, signature: 5.5, damage: 95, fireRate: 0.75, weaponRange: 820 } },
};
export const DEFAULT_HULL = 'vanguard';

// Every module costs something. A fit is a shape you choose, never power you buy —
// test/ships.mjs fails the build if a module is ever added with no downside.
export const MODULES = {
  plating:   { name: 'Composite Plating',  mods: [['hull', 'add', 450],       ['speed', 'mul', -0.08]] },
  capacitor: { name: 'Shield Capacitor',   mods: [['shield', 'add', 400],     ['shieldRegen', 'mul', -0.20]] },
  diffuser:  { name: 'Flux Diffuser',      mods: [['shieldRegen', 'mul', 0.45], ['shield', 'mul', -0.15]] },
  primer:    { name: 'Reflex Primer',      mods: [['shieldDelay', 'add', -2.5], ['hull', 'mul', -0.10]] },
  thruster:  { name: 'Overtuned Thruster', mods: [['speed', 'mul', 0.22],     ['accel', 'mul', 0.15], ['hull', 'mul', -0.12]] },
  ballast:   { name: 'Inertial Ballast',   mods: [['accel', 'mul', 0.40],     ['speed', 'mul', -0.10]] },
  array:     { name: 'Sensor Array',       mods: [['radar', 'mul', 0.45],     ['signature', 'add', 1.5]] },
  damper:    { name: 'Signal Damper',      mods: [['signature', 'mul', -0.5], ['radar', 'mul', -0.25]] },
  focuser:   { name: 'Beam Focuser',       mods: [['damage', 'mul', 0.28],    ['fireRate', 'mul', -0.14]] },
  cycler:    { name: 'Rapid Cycler',       mods: [['fireRate', 'mul', 0.34],  ['damage', 'mul', -0.20]] },
  extender:  { name: 'Range Extender',     mods: [['weaponRange', 'mul', 0.24], ['damage', 'mul', -0.12]] },
};

export const slotsOf = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).attrs.slots ?? ATTRS.slots.dflt;
export const radiusOf = hullKey => (HULLS[hullKey] ?? HULLS[DEFAULT_HULL]).r;

// base + every flat add, then multiplied once by the SUM of the percentages.
// Summing rather than compounding keeps three copies of a module worth three
// times one, instead of spiralling — the usual way stacking becomes pay-to-win.
export function resolve(hullKey, fitted = []) {
  const hull = HULLS[hullKey] ?? HULLS[DEFAULT_HULL];
  const out = {}, pct = {};
  for (const [k, a] of Object.entries(ATTRS)) out[k] = hull.attrs[k] ?? a.dflt;

  for (const key of fitted) {
    for (const [attr, op, v] of MODULES[key]?.mods ?? []) {
      if (!(attr in out)) continue;                       // unknown attribute: ignore, never crash
      if (op === 'add') out[attr] += v;
      else              pct[attr] = (pct[attr] ?? 0) + v;
    }
  }
  for (const [attr, p] of Object.entries(pct)) out[attr] *= 1 + p;
  for (const k of Object.keys(out)) out[k] = Math.max(ATTRS[k].min ?? 0, out[k]);
  return out;
}

// A fit the server will accept: known modules, no duplicates, within slot count.
export function sanitiseFit(hullKey, fit) {
  return [...new Set((Array.isArray(fit) ? fit : []).filter(k => MODULES[k]))].slice(0, slotsOf(hullKey));
}
