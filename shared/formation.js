// Drone formations.
//
// A formation is bought once and then flown: it changes where the escort sits,
// what it looks like, and what it does for the ship. Like everything else that
// can be bolted on, each one costs something — a wedge that only added damage
// would make the others pointless.
//
// The bonus needs drones to fly it. With none it does nothing at all; it comes in
// proportionally and is whole at three.

export const BONUS_AT = 3;

export const FORMATIONS = {
  line: {
    name: 'Line Astern', price: 0,
    blurb: 'The default. Strung out behind you, out of the way.',
    mods: [],
  },
  wedge: {
    name: 'Attack Wedge', price: 9000,
    blurb: 'Pushed forward and out. Guns further from the hull, and less of it.',
    mods: [['damage', 'mul', 0.12], ['hull', 'mul', -0.08]],
  },
  shell: {
    name: 'Defensive Shell', price: 9000,
    blurb: 'A ring around the ship. Heavier shields, slower with it.',
    mods: [['shield', 'mul', 0.16], ['speed', 'mul', -0.07]],
  },
  slipstream: {
    name: 'Slipstream', price: 9000,
    blurb: 'Tucked into your wake. Quicker off the mark, thinner shields.',
    mods: [['speed', 'mul', 0.10], ['accel', 'mul', 0.16], ['shield', 'mul', -0.10]],
  },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATION = 'line';
export const formationPrice = k => FORMATIONS[k]?.price ?? Infinity;

// How much of the bonus an escort this size actually delivers.
export const bonusScale = drones => Math.min(1, (drones ?? 0) / BONUS_AT);

// Where each drone sits, in multiples of the ship's radius, relative to heading.
// fwd is along the nose, lat is to starboard.
export function slots(kind, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const half = (n - 1) / 2, off = i - half;
    switch (kind) {
      case 'wedge':                                 // ahead and outboard, guns first
        out.push({ fwd: 2.2 - Math.abs(off) * 1.5, lat: off * 2.6 });
        break;
      case 'shell': {                               // an even ring
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        out.push({ fwd: Math.cos(a) * 4.4, lat: Math.sin(a) * 4.4 });
        break;
      }
      case 'slipstream':                            // two tight columns in the wake
        // Paired rather than strung out single file: a six-drone tail would put
        // the last one 13R astern, firing from somewhere off the back of the screen.
        out.push({ fwd: -3.2 - Math.floor(i / 2) * 1.8, lat: (i % 2 ? 1.3 : -1.3) });
        break;
      default:                                      // line astern, spread wide
        out.push({ fwd: -3.4 - Math.abs(off) * 0.8, lat: off * 2.4 });
    }
  }
  return out;
}

// World position of a drone, given the ship it escorts.
export function droneAt(ship, i) {
  const list = slots(ship.formation ?? DEFAULT_FORMATION, (ship.drones ?? []).length);
  const s = list[i];
  if (!s) return { x: ship.x, y: ship.y };
  const c = Math.cos(ship.heading), sn = Math.sin(ship.heading), R = ship.r;
  return { x: ship.x + (c * s.fwd - sn * s.lat) * R,
           y: ship.y + (sn * s.fwd + c * s.lat) * R };
}
