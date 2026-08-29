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
          blurb: 'Welds a third of your hull back on, slowly.' },
  kit2: { name: 'Repair Drone', tier: 2, heal: 0.60, secs: 5.5, price:  4600,
          blurb: 'Most of the way home from most of a beating.' },
  kit3: { name: 'Yard Drone',   tier: 3, heal: 1.00, secs: 7.5, price: 11000,
          blurb: 'Hull as new. Takes its time about it.' },
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
  if (busy) return 'already working';
  if (!(kits[using] > 0)) return `no ${KITS[using]?.name ?? 'kit'} aboard`;
  if (docked) return 'the dock does this for free';
  if (sinceHit < KIT_QUIET) return 'not while you are being shot at';
  if (!hurt) return 'hull is already whole';
  return null;
}
