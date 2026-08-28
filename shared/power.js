// Power routing. One system at a time gets the reactor's spare output.
//
// The build-up is quadratic rather than linear on purpose: committing costs you a
// couple of seconds before it pays, so routing is a decision made ahead of a
// fight rather than a button mashed during one. Cutting back is quicker than
// building up, which is what makes the commitment real.

export const SYSTEMS = ['thrusters', 'weapons', 'shields'];
export const BOOST     = 0.30;   // what full power is worth to the chosen system
export const SPOOL_UP  = 3.0;    // s from cold to full
export const SPOOL_DN  = 1.5;    // s to bleed back off

export const newPower = () => ({ to: null, thrusters: 0, weapons: 0, shields: 0 });

export const routeTo = (p, sys) => { p.to = SYSTEMS.includes(sys) ? (p.to === sys ? null : sys) : null; };

// Levels are stored as a 0..1 charge; the useful output is its square.
export function stepPower(p, dt) {
  for (const s of SYSTEMS) {
    const target = p.to === s ? 1 : 0;
    const rate = target > p[s] ? dt / SPOOL_UP : -dt / SPOOL_DN;
    p[s] = Math.max(0, Math.min(1, p[s] + rate));
  }
}

export const levelOf = (p, sys) => (p?.[sys] ?? 0) ** 2;          // quadratic
export const boostOf = (p, sys) => 1 + BOOST * levelOf(p, sys);
