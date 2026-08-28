// Everything you can buy and bolt to a ship.
//
// Three slot kinds. Weapons and generators come in exactly one model each, on
// purpose: filling your slots is cheap and quick, so nobody buys their way to an
// advantage. Technologies are where the actual choice lives, and every one of them
// costs you something — the same rule the old modules followed, enforced by a test.

export const SLOTS = ['weapon', 'generator', 'tech'];

// Drones fly escort and carry one item each, of any kind. They are the only way
// past a hull's own rack, and they cost more the more you already have.
export const MAX_DRONES = 6;
export const dronePrice = owned => 3000 + owned * 2600;

export const EQUIPMENT = {
  // weapons — each adds its output to the hull's own, and a visibly thicker beam
  emitter1: { name: 'MK-I Emitter',  slot: 'weapon', tier: 1, price:   900,
              blurb: 'A laser.', mods: [['damage', 'add', 18]] },
  emitter2: { name: 'MK-II Emitter', slot: 'weapon', tier: 2, price:  2600,
              blurb: 'A better laser.', mods: [['damage', 'add', 30]] },
  emitter3: { name: 'MK-III Emitter', slot: 'weapon', tier: 3, price: 7200,
              blurb: 'About as much as a hardpoint will carry.', mods: [['damage', 'add', 46]] },

  // generators — reactor gear. Capacitor, recharge and the free trickle.
  cellA: { name: 'A-Cell Generator', slot: 'generator', tier: 1, price:  1200,
           blurb: 'A little more reactor, a little more shield.',
           mods: [['capacitor', 'add', 8], ['recharge', 'add', 0.4], ['shield', 'add', 120], ['speed', 'mul', -0.02]] },
  cellB: { name: 'B-Cell Generator', slot: 'generator', tier: 2, price:  3400,
           blurb: 'Holds more, and trickles harder.',
           mods: [['capacitor', 'add', 16], ['recharge', 'add', 0.8], ['sustain', 'add', 0.02],
                  ['shield', 'add', 200], ['speed', 'mul', -0.03]] },
  cellC: { name: 'C-Cell Generator', slot: 'generator', tier: 3, price:  8800,
           blurb: 'A reactor you can lean on.',
           mods: [['capacitor', 'add', 26], ['recharge', 'add', 1.3], ['sustain', 'add', 0.04],
                  ['shield', 'add', 300], ['speed', 'mul', -0.04]] },

  // technologies — one of each, and every one costs you something
  plating:  { name: 'Composite Plating', slot: 'tech', price: 2600,
              blurb: 'Hull at the cost of speed.',
              mods: [['hull', 'add', 450], ['speed', 'mul', -0.09]] },
  damper:   { name: 'Signal Damper', slot: 'tech', price: 3400,
              blurb: 'Hard to track, and half blind.',
              mods: [['signature', 'mul', -0.5], ['radar', 'mul', -0.25]] },
  expander: { name: 'Hold Expander', slot: 'tech', price: 2200,
              blurb: 'Room for more ore, and slower with it.',
              mods: [['cargo', 'mul', 0.65], ['speed', 'mul', -0.12]] },
  flywheel: { name: 'Reactor Flywheel', slot: 'tech', price: 4200,
              blurb: 'A far bigger capacitor, and slower shields.',
              mods: [['capacitor', 'mul', 0.55], ['shieldRegen', 'mul', -0.22]] },
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

// Only real items, only as many as there are drones. A drone may hold anything,
// including a second of something the ship already has — except a technology,
// which stays unique across the whole ship-and-escort.
export function sanitiseDrones(list, fit, max = MAX_DRONES) {
  const out = [];
  const techs = new Set(fit?.tech ?? []);
  for (const k of (Array.isArray(list) ? list : []).slice(0, max)) {
    if (k === null || !EQUIPMENT[k]) { out.push(null); continue; }
    if (EQUIPMENT[k].slot === 'tech' && techs.has(k)) { out.push(null); continue; }
    if (EQUIPMENT[k].slot === 'tech') techs.add(k);
    out.push(k);
  }
  return out;
}

export const droneItems = drones => (drones ?? []).filter(Boolean);
