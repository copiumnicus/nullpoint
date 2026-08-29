// Low observability, borrowed from how it actually works.
//
// A stealth airframe is not uniformly invisible — it is shaped to throw energy
// away from the nose. Head-on it returns almost nothing; from the beam it
// returns a good deal more; from directly behind it is just an aircraft. So the
// thing that decides whether you can see a Bandit is the angle between where its
// nose is pointing and where you are standing.
//
// Which produces the fight this is for. A Bandit engaging you turns to face you,
// and facing you is its quietest aspect — so the way to see one is to get off
// its nose. Out-turn it, or watch it leave and be able to see it perfectly while
// it goes.
//
// It is not a constant fade either. A weak return is an intermittent one: it
// comes and goes, and the quieter the aspect the more of the time it is gone.
// Alpha alone reads as fog; alpha plus dropout reads as something you are barely
// holding on to.
//
// The floor is not zero. Head-on you can still just make one out, which matters
// for more than fairness: a missile seeker reads the same numbers, and a target
// it can never see at all is one it can never be fired at rather than one it
// tracks badly.

// Aspect, 0..1. 0 is nose-on — the Bandit is looking straight at you and you can
// barely see it. 1 is tail-on: you are behind it and it is in plain sight.
export function aspectOf(alien, viewer) {
  const toYou = Math.atan2(viewer.y - alien.y, viewer.x - alien.x);
  let off = toYou - alien.heading;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  return Math.abs(off) / Math.PI;
}

// How solid it looks at that aspect, and how much of the time it is there at all.
export const MIN_ALPHA = 0.30, MAX_ALPHA = 1;
export const MIN_DUTY  = 0.16;                 // nose-on: a glimpse every second or so
export const BLINK_HZ  = 2.7;                  // how quickly it comes and goes

// Both curves are eased so the interesting part is the beam, not the extremes:
// a Bandit that is anywhere near nose-on stays nearly gone, and only opens up
// once you are properly off to one side of it.
const ease = a => a * a * (3 - 2 * a);

export const alphaAt = aspect => MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * ease(aspect);
export const dutyAt  = aspect => MIN_DUTY + (1 - MIN_DUTY) * ease(aspect) ** 1.4;

// How much of it is there this instant, 0 to 1. Two slow waves beaten against
// each other, so it shimmers rather than strobes, and every Bandit does it out
// of step with the others. Deterministic in time and id: two clients watching
// the same Bandit see it come and go at the same moments.
//
// It crosses smoothly rather than snapping. A hard cut between drawn and not
// drawn reads as a rendering fault — a thing flickering out of existence — where
// a fade over a couple of hundred milliseconds reads as a contact you are
// losing. Same duty cycle either way; only the edges are different.
export const SOFT = 0.2;                       // width of the crossing, ~200ms of fade

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = v => v * v * (3 - 2 * v);

export function presenceAt(aspect, now, seed = 0) {
  if (aspect >= 0.999) return 1;
  const t = now / 1000, k = seed * 1.7;
  const wave = 0.5 + 0.25 * Math.sin(t * BLINK_HZ + k)
                   + 0.25 * Math.sin(t * BLINK_HZ * 0.41 + k * 2.3);
  return smooth(clamp01((dutyAt(aspect) - wave) / SOFT + 0.5));
}

// The same judgement as a yes or no, for anything that needs one — a missile
// seeker either has the target or it does not.
export const shownAt = (aspect, now, seed = 0) => presenceAt(aspect, now, seed) >= 0.5;

// Everything the client needs to draw one, in one call. The alpha already has
// the fade folded in, so a caller that just multiplies by it gets the whole
// effect without knowing there are two parts to it.
export function seenAs(alien, viewer, now, seed = 0) {
  const aspect = aspectOf(alien, viewer);
  const presence = presenceAt(aspect, now, seed);
  return { aspect, presence, alpha: alphaAt(aspect) * presence, shown: presence > 0.02 };
}
