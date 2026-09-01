// Power routing and the reactor capacitor.
//
// The reactor supplies a small amount of spare output for free, forever. Anything
// above that comes out of a capacitor that only refills while you are routing
// nothing at all. So there are two honest ways to fly: sit on the free trickle
// permanently, or hold the full boost for about a capacitor's worth of seconds and
// then fall back to the trickle until you stand down and recharge.
//
// The build-up is quadratic so committing costs a couple of seconds before it
// pays — a decision made ahead of a fight rather than a button mashed during one.
//
// The Governor Bypass, further down, is the one thing that buys that away, and it
// is not for sale: it comes out of a salvage run. See BYPASS_BROWNOUT.

// The fourth is the hull's own — what it routes to depends on which ship you are
// flying, and the Hauler has nothing to route there. It lives in the same list so
// it spools, draws and browns out exactly like the other three; see ability.js.
export const SYSTEMS = ['thrusters', 'weapons', 'shields', 'special'];
export const BOOST    = 0.30;    // what a fully powered system is worth
export const SPOOL_UP = 3.0;     // s from cold to full
export const SPOOL_DN = 1.5;     // s to bleed back off

// Built from SYSTEMS rather than listed by hand. Listing them was fine for three
// and wrong the moment there were four: adding 'special' left it uninitialised,
// stepPower summed undefined into the draw, and every capacitor in the game went
// NaN on the first tick. A reactor that has to be told twice which systems exist
// will be told wrong eventually.
export const newPower = capacitor => ({
  to: null, charge: capacitor ?? 45,
  ...Object.fromEntries(SYSTEMS.map(s => [s, 0])),
});

// --- the Governor Bypass ------------------------------------------------------
//
// WHAT THE SPOOL ACTUALLY IS, measured before anything was designed, because the
// pitch was "remove the spool" and the first question is whether there is one.
//
// There is, and it is bigger than the constants read. `levelOf` SQUARES the ramp,
// so the three seconds of SPOOL_UP deliver almost nothing for the first half of
// them. On a Vanguard, switching from full shields to weapons:
//
//     t+0.5s  weapons   3%      t+2.0s  weapons  44%
//     t+1.0s  weapons  11%      t+2.5s  weapons  69%
//     t+1.5s  weapons  25%      t+3.0s  weapons 100%
//
// Integrated, the ramp delivers exactly T/3 boost-seconds over its own T seconds
// where an instant route would deliver T — so **every re-route withholds 2.000
// boost-seconds**, and it withholds them at the front of a fight, which is where
// they are worth most. That is the tax the row is sold against.
//
// SO THE BYPASS IS ONE LINE: the level snaps instead of ramping, both ways. The
// old system stops drawing on the same tick rather than bleeding for SPOOL_DN, and
// stepPower needs no change at all — it already leaves a system alone once it is
// on its target, so a snapped level simply stays snapped.
//
// AND THE BROWN-OUT, which is derived rather than picked. Draw is normalised so a
// fully powered system empties the capacitor in exactly `capacitor` seconds, which
// makes ONE POINT OF CHARGE ONE SECOND OF FULL BOOST — so the 2.000 boost-seconds
// the ramp was withholding can be billed in the same currency they are handed back
// in. You buy the spool with the tank, one for one.
//
// It fires on ARRIVING somewhere, never on standing down: routing to nothing is
// putting the reactor away, and a pilot punished for that would simply hold the
// dial where it is, which is the opposite of what this row is for. It cannot be
// dodged by standing down first and re-routing on the next keypress, because the
// second keypress is an arrival and pays.
//
// AND WHERE IT PAYS IS NOT WHERE THE PITCH SAID, which is the one thing here that
// the measurement moved. It was sold as the tax on the between-fights shield loop;
// it is not. `shieldWait` is shieldDelay/poolMult, which on a Vanguard routed to
// shields is 6.2 seconds — LONGER than the spool — so the ramp finishes before a
// single point of shield comes back and a spooled pilot and a bypassed one arrive
// at a ten second lull holding exactly the same share, to the decimal.
//
// What it buys is the same keypress from the other side: the fight starts, the
// reactor comes off your shields and goes on your guns, and today that is three
// seconds of the fight fought at a quarter power. Measured, a Vanguard with one
// emitter lands 588 damage in the first three seconds against 492 — x1.20 — and
// x1.06 over the first ten, so it is worth most exactly at the front and washes out
// over a long fight. test/power.mjs keeps both numbers.
//
// What it costs, in play: 2 of a Vanguard's 45 second tank per switch, so a tank is
// 22 of them. Once a fight it is 4%; mashed mid-fight it is 4% a keypress off a
// tank that is already draining, and a flat tank switches instantly to the free
// trickle and nothing more. That is the trade the designer asked for in as many
// words: it is fastest exactly when you can least afford it.
export const BYPASS_BROWNOUT = 2 * SPOOL_UP / 3;

// Whether this reactor re-routes instantly. A function rather than `stats.bypass`
// read at each call site, for the reason hasPocket() is a function: a rule that
// exists twice will disagree, and this one decides what your guns are worth on the
// tick you press the key. The flag itself is set in exactly one place —
// applyResearch, off hasBypass(mask) — so 'bypass1' is a string the game says once.
export const bypassed = stats => !!stats?.bypass;

export const routeTo = (p, sys, stats = null) => {
  const to = SYSTEMS.includes(sys) ? (p.to === sys ? null : sys) : null;
  p.to = to;
  if (!bypassed(stats)) return;
  for (const s of SYSTEMS) p[s] = to === s ? 1 : 0;
  if (to) p.charge = Math.max(0, (p.charge ?? 0) - BYPASS_BROWNOUT);
};

// Raw ramp per system, then the capacitor decides how much of it you actually get.
export function stepPower(p, dt, stats) {
  for (const s of SYSTEMS) {
    // Move toward the target and STOP there. Nudging by a signed step instead
    // oscillates once you arrive — at full, `target > p[s]` is 1 > 1, which is
    // false, so it steps back down, climbs again, and the readout flickers
    // between 29% and 30% forever while quietly under-drawing the capacitor.
    const target = p.to === s ? 1 : 0;
    if (p[s] < target)      p[s] = Math.min(target, p[s] + dt / SPOOL_UP);
    else if (p[s] > target) p[s] = Math.max(target, p[s] - dt / SPOOL_DN);
    if (Math.abs(p[s] - target) < 1e-9) p[s] = target;   // float dust, not a real gap
  }

  // Draw is normalised so a fully powered system empties the capacitor in exactly
  // `capacitor` seconds, whatever the free trickle happens to be.
  const free = stats.sustain;
  let above = 0;
  for (const s of SYSTEMS) above += Math.max(0, (p[s] ** 2) - free);
  const draw = free < 1 ? above / (1 - free) : 0;

  if (p.to) p.charge = Math.max(0, p.charge - draw * dt);
  else      p.charge = Math.min(stats.capacitor, p.charge + stats.recharge * dt);
}

// What a system is actually delivering: what it asked for, or the free trickle
// once the capacitor is flat.
export function levelOf(p, sys, stats) {
  const want = (p?.[sys] ?? 0) ** 2;
  if (!want) return 0;
  if ((p.charge ?? 0) > 0) return want;
  return Math.min(want, stats?.sustain ?? 0.33);
}

// The ceiling is the ship's, not a constant: generators raise it by what they
// cost you in speed. BOOST is only the floor everything starts from.
export const ceilingOf = stats => stats?.boost ?? BOOST;
export const boostOf  = (p, sys, stats) => 1 + ceilingOf(stats) * levelOf(p, sys, stats);
export const chargePct = (p, stats) => Math.max(0, Math.min(1, (p?.charge ?? 0) / (stats?.capacitor || 1)));
