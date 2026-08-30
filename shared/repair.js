// Repair drones.
//
// A single-use kit that patches hull in the field. Nothing here heals shields —
// those come back on their own — and nothing here works at a dock, where the
// station does it for free and faster. What you are buying is the ability to not
// fly home.
//
// You cannot use one while anything is shooting at you, and taking a hit while
// one is working ends it and wastes it. That is the whole tension: a kit is a
// decision to stand still for five seconds in open space.

export const KITS = {
  kit1: { name: 'Patch Drone',  tier: 1, heal: 0.30, secs: 4.0, price:  1800,
          blurb: 'A field patch. Cheap, and it does not fix much.' },
  kit2: { name: 'Repair Drone', tier: 2, heal: 0.60, secs: 5.5, price:  4600,
          blurb: 'The workhorse. Enough hull left to finish a trip.' },
  kit3: { name: 'Yard Drone',   tier: 3, heal: 1.00, secs: 7.5, price: 11000,
          blurb: 'A full rebuild in the field, if you can stand still.' },
};

export const KIT_KEYS = Object.keys(KITS);
export const DEFAULT_KIT = KIT_KEYS[0];
export const kitPrice = key => KITS[key]?.price ?? Infinity;

// Long enough that it cannot be used as a mid-fight heal between passes.
export const KIT_QUIET = 6;          // seconds since the last hit before one will start

export function sanitiseKits(raw) {
  const out = {};
  for (const k of KIT_KEYS) {
    const n = Math.floor(Number(raw?.[k]));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}
export const sanitiseKit = want => (KITS[want] ? want : DEFAULT_KIT);

// Why this pilot cannot start a repair right now, or null if they can. One
// function so the button, the tooltip and the server all give the same answer.
export function whyNotRepair({ kits = {}, using = DEFAULT_KIT, docked = false,
                               sinceHit = 1e9, hurt = false, busy = false } = {}) {
  if (busy) return 'a repair drone is already working';
  if (!(kits[using] > 0)) return `no ${KITS[using]?.name ?? 'repair drone'} aboard — buy one at a dock`;
  if (docked) return 'the dock is already mending you, free and faster';
  if (sinceHit < KIT_QUIET) return `wait ${KIT_QUIET}s clear of fire, then it will start`;
  if (!hurt) return 'your hull is undamaged — save it for later';
  return null;
}
