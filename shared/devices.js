// Single-use technologies.
//
// The taskbar's second consumable slot. Repair drones are the first — they buy
// you hull without flying home — and these buy you the flying home itself.
//
// The table is the seam: everything here is keyed, tiered and priced the same
// way, so a second device is a row of data rather than another slot.

export const DEVICES = {
  recall: {
    name: 'Recall Beacon', tier: 1, secs: 5.0, price: 3400,
    blurb: 'Folds you to any hangar you own. One hit cancels it.',
  },
};

export const DEVICE_KEYS = Object.keys(DEVICES);
export const DEFAULT_DEVICE = DEVICE_KEYS[0];
export const devicePrice = key => DEVICES[key]?.price ?? Infinity;

export function sanitiseDevices(raw) {
  const out = {};
  for (const k of DEVICE_KEYS) {
    const n = Math.floor(Number(raw?.[k]));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}
export const sanitiseDevice = want => (DEVICES[want] ? want : DEFAULT_DEVICE);

// Why this pilot cannot use one right now, or null if they can. One function so
// the button, the tooltip and the server all give the same answer.
//
// Note what is NOT in here: being under fire. A recall you cannot start while
// something is shooting at you is a recall that is no use on the only occasion
// you want one. You may always begin it. Whether you get to finish it is the
// question, and that is decided by whether anything lands on you in the next
// five seconds — see the tick, not this.
// `atDest` is "you are standing in the hangar this would take you to", NOT "you are
// standing at a dock". It was the second one, and that was right for exactly as long
// as a beacon had one destination: it always went home, so being home meant there
// was nothing to do. Now that it asks WHICH hangar, a pilot at their own ring wanting
// to reach the bay they rent four sectors out was told "you are standing at a dock
// already" and had to fly out of their own ring to be allowed to leave it.
//
// Refusing to send you where you already are is still right. Refusing to send you
// anywhere because you happen to be somewhere was never the rule, only the shape it
// had while there was one place to go.
export function whyNotDevice({ devices = {}, using = DEFAULT_DEVICE,
                               atDest = false, busy = false } = {}) {
  if (busy) return 'a fold is already running';
  if (!(devices[using] > 0)) return `no ${DEVICES[using]?.name ?? 'beacon'} aboard — buy one at a dock`;
  if (atDest) return 'you are already standing there';
  return null;
}

// A device is spent on arrival, not on the attempt. Being interrupted is already
// the punishment; charging for the interruption as well would mean the only safe
// time to press it is a time you did not need it.
export const SPENT_ON = 'arrival';
