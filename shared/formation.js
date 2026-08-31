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
    blurb: 'Pushed out ahead of you, guns first.',
    // Both weapon systems, or the Wedge quietly reads as "fit lasers".
    mods: [['damage', 'mul', 0.12], ['rocketVolley', 'mul', 0.12], ['hull', 'mul', -0.08]],
  },
  shell: {
    name: 'Defensive Shell', price: 9000,
    blurb: 'A ring around the ship, taking hits for it.',
    mods: [['shield', 'mul', 0.16], ['speed', 'mul', -0.07]],
  },
  slipstream: {
    name: 'Slipstream', price: 9000,
    blurb: 'Tucked into your wake, pushing you along.',
    mods: [['speed', 'mul', 0.10], ['accel', 'mul', 0.16], ['shield', 'mul', -0.10]],
  },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATION = 'line';
export const formationPrice = k => FORMATIONS[k]?.price ?? Infinity;

// How much of the bonus an escort this size actually delivers, before anything
// fitted has a say. Kept as its own function because the client draws the
// brochure figure with it.
export const bonusScale = drones => Math.min(1, (drones ?? 0) / BONUS_AT);

// What the escort ACTUALLY delivers, which is the number resolve() folds in.
//
// Two attributes, and they are two different questions the shelf had no way to
// ask before. `cohesion` is how many drones the wing needs before the formation
// pays in full — BONUS_AT is only its default. `escort` is how hard it pays once
// it does.
//
// Splitting them is what makes the escort technologies opposites rather than two
// sizes of the same thing. Cutting cohesion is worth everything to a pilot with
// one drone and NOTHING to one with twelve, because the ramp is already finished;
// raising `escort` is worth nothing until the ramp is finished and everything
// afterwards. They cross where min(1, n/cohesion) x escort passes 1, which is the
// only interesting number either of them has.
export const escortScale = (drones, stats) =>
  Math.min(1, (drones ?? 0) / Math.max(1, stats?.cohesion ?? BONUS_AT)) * (stats?.escort ?? 1);

// How big a drone is drawn, and how far the hull really reaches — both in ship
// radii. The hull polygon stops at 1.35R but the cannons stick out past it, so
// a slot placed off the nominal circle still ends up sitting on the guns. Every
// layout below keeps its drones clear of BOTH numbers; the test checks it.
export const DRONE_R = 0.52;
export const HULL_R  = 1.75;

// Where each drone sits, in multiples of the ship's radius, relative to heading.
// fwd is along the nose, lat is to starboard.
export function slots(kind, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    switch (kind) {
      case 'wedge': {                             // an arrowhead, opening forward
        // Odd counts get a point; the rest pair off down two arms. An arm holds
        // three, then a second arrowhead forms behind the first — a single arm
        // long enough for twelve would put the outermost pair off the screen.
        const odd = n % 2, j = i - odd;
        if (odd && i === 0) { out.push({ fwd: 3.8, lat: 0 }); break; }
        const pair = Math.floor(j / 2), side = j % 2 ? 1 : -1;
        const arm = pair % 3, layer = Math.floor(pair / 3);
        out.push({ fwd: 1.9 - arm * 1.6 - layer * 2.6, lat: side * (3.2 + arm * 2.3) });
        break;
      }
      case 'shell': {                             // an even ring, well off the hull
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        out.push({ fwd: Math.cos(a) * 5.2, lat: Math.sin(a) * 5.2 });
        break;
      }
      case 'slipstream': {                        // columns in the wake
        // Two columns up to four drones, four beyond that. Twelve in two columns
        // is a six-deep tail, and the back of it is a long way from the fight.
        const cols = n > 4 ? 4 : 2;
        const col = i % cols, row = Math.floor(i / cols);
        out.push({ fwd: -3.6 - row * 2.4, lat: (col - (cols - 1) / 2) * 2.2 });
        break;
      }
      default: {                                  // line astern, spread wide
        // Ranks of four. One rank of twelve is fifteen radii of wingtip.
        const cols = Math.min(4, n);
        const col = i % cols, row = Math.floor(i / cols);
        out.push({ fwd: -3.6 - row * 2.4 - Math.abs(col - (cols - 1) / 2) * 0.5,
                   lat: (col - (cols - 1) / 2) * 2.8 });
      }
    }
  }
  return out;
}

// World position of a drone, given the ship it escorts.
export function droneAt(ship, i) {
  // `bays` is what the hull berths, which is not always what the pilot owns — see
  // berthed() in ships.js. Laying the formation out over the owned count would put
  // the escort in different places on the server and on the client, because the
  // wire carries the berthed count.
  const list = slots(ship.formation ?? DEFAULT_FORMATION, ship.bays ?? (ship.drones ?? []).length);
  const s = list[i];
  if (!s) return { x: ship.x, y: ship.y };
  const c = Math.cos(ship.heading), sn = Math.sin(ship.heading), R = ship.r;
  return { x: ship.x + (c * s.fwd - sn * s.lat) * R,
           y: ship.y + (sn * s.fwd + c * s.lat) * R };
}
