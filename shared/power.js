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

export const SYSTEMS = ['thrusters', 'weapons', 'shields'];
export const BOOST    = 0.30;    // what a fully powered system is worth
export const SPOOL_UP = 3.0;     // s from cold to full
export const SPOOL_DN = 1.5;     // s to bleed back off

export const newPower = capacitor => ({
  to: null, thrusters: 0, weapons: 0, shields: 0, charge: capacitor ?? 45,
});

export const routeTo = (p, sys) => {
  p.to = SYSTEMS.includes(sys) ? (p.to === sys ? null : sys) : null;
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
