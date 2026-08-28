// Everything you can buy and bolt to a ship.
//
// Three slot kinds. Weapons and generators come in exactly one model each, on
// purpose: filling your slots is cheap and quick, so nobody buys their way to an
// advantage. Technologies are where the actual choice lives, and every one of them
// costs you something — the same rule the old modules followed, enforced by a test.

export const SLOTS = ['weapon', 'generator', 'tech'];

export const EQUIPMENT = {
  emitter: {
    name: 'MK-I Emitter', slot: 'weapon', price: 900,
    blurb: 'A laser. Adds its output to the hull\'s own.',
    mods: [['damage', 'add', 18]],
  },
  cell: {
    name: 'A-Cell Generator', slot: 'generator', price: 1200,
    blurb: 'Shield capacity and recovery, at the cost of mass.',
    mods: [['shield', 'add', 240], ['shieldRegen', 'add', 9], ['speed', 'mul', -0.03]],
  },

  plating: {
    name: 'Composite Plating', slot: 'tech', price: 2600,
    blurb: 'Hull at the cost of speed.',
    mods: [['hull', 'add', 450], ['speed', 'mul', -0.09]],
  },
  damper: {
    name: 'Signal Damper', slot: 'tech', price: 3400,
    blurb: 'Hard to track, and half blind.',
    mods: [['signature', 'mul', -0.5], ['radar', 'mul', -0.25]],
  },
  expander: {
    name: 'Hold Expander', slot: 'tech', price: 2200,
    blurb: 'Room for more ore, and slower with it.',
    mods: [['cargo', 'mul', 0.65], ['speed', 'mul', -0.12]],
  },
};

export const priceOf = key => EQUIPMENT[key]?.price ?? Infinity;
export const forSlot = slot => Object.entries(EQUIPMENT).filter(([, e]) => e.slot === slot);

// An empty rack, shaped by a hull's slot counts.
export const emptyFit = () => ({ weapon: [], generator: [], tech: [] });

// Anything reaching us from a client or a save file: keep only real items, in the
// right kind of slot, up to the number of slots the hull actually has.
export function sanitiseFit(slots, fit) {
  const out = emptyFit();
  for (const slot of SLOTS) {
    const want = Array.isArray(fit?.[slot]) ? fit[slot] : [];
    let keep = want.filter(k => EQUIPMENT[k]?.slot === slot);
    // Weapons and generators stack; a technology is either fitted or it is not.
    // Without that, an interceptor with three plating slots out-tanks a cruiser.
    if (slot === 'tech') keep = [...new Set(keep)];
    out[slot] = keep.slice(0, slots?.[slot] ?? 0);
  }
  return out;
}

export const UNIQUE_SLOTS = ['tech'];

export const fitCount = fit => SLOTS.reduce((n, s) => n + (fit?.[s]?.length ?? 0), 0);

// Changing hull can leave you with more fitted than the new rack holds. Whatever
// does not fit goes back into your locker rather than evaporating.
export function reseat(slots, fit, gear) {
  const kept = sanitiseFit(slots, fit), back = { ...gear };
  const before = fitList(fit), after = fitList(kept);
  for (const k of before) {
    const i = after.indexOf(k);
    if (i >= 0) after.splice(i, 1);
    else back[k] = (back[k] ?? 0) + 1;
  }
  return { fit: kept, gear: back };
}
export const fitList = fit => SLOTS.flatMap(s => fit?.[s] ?? []);
