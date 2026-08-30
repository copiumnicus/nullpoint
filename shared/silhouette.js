// What each hull looks like from above.
//
// Every ship was the same square. Aliens got their own outlines a few versions
// back and immediately read as different animals; the ships they were fighting
// did not, so the fleet was four rectangles at three sizes.
//
// Declared here rather than in the client because two places draw a ship — the
// world view and the hull gallery on the dev range — and a silhouette that
// disagreed between them would be worse than a square.
//
// Points are in ship-local space, nose along +x, scaled by the hull's radius.
// Every one of them has more ship in front of its centre than behind, including
// the freighter — the first draft made the Hauler symmetric fore and aft, which
// is honest for a container but left it with no readable front at all, and
// heading was only legible from where the cannons happened to be pointing.
// They run counter-clockwise and are closed by the caller. Keep them readable at
// R=10: a Kestrel is twenty pixels across on a normal screen, so detail below
// about 0.2R is a waste of a line segment.

export const SILHOUETTES = {
  // A freighter. Blunt, wide amidships, no nose to speak of — it is a container
  // with engines, and it should look like the thing you want to stop flying.
  hauler: [
    [ 1.10,  0.00], [ 0.60,  0.64], [-0.66,  0.78], [-0.95,  0.42],
    [-0.95, -0.42], [-0.66, -0.78], [ 0.60, -0.64],
  ],

  // An interceptor, near enough an F-16: long pointed nose, a narrow body you
  // could hide behind, and small sharply swept wings well aft. The whole shape
  // is about the nose, which is also the only part of it most people see.
  kestrel: [
    [ 1.75,  0.00], [ 0.60,  0.20], [ 0.10,  0.26], [-0.30,  1.00],
    [-0.68,  1.00], [-0.52,  0.26], [-0.98,  0.22], [-1.05,  0.00],
    [-0.98, -0.22], [-0.52, -0.26], [-0.68, -1.00], [-0.30, -1.00],
    [ 0.10, -0.26], [ 0.60, -0.20],
  ],

  // A fighter. The compromise shape: real wings, a real nose, and a hull thick
  // enough to carry the three racks it has.
  vanguard: [
    [ 1.40,  0.00], [ 0.35,  0.34], [-0.28,  1.05], [-0.72,  1.00],
    [-0.52,  0.32], [-1.00,  0.26], [-1.00, -0.26], [-0.52, -0.32],
    [-0.72, -1.00], [-0.28, -1.05], [ 0.35, -0.34],
  ],

  // A bomber, and specifically a flying wing: broad, shallow, and notched along
  // the trailing edge like a B-2. It has no fuselage because it is all fuselage.
  // Wide enough that the four weapon mounts have somewhere to be.
  bulwark: [
    [ 1.15,  0.00], [ 0.18,  0.60], [-0.48,  1.30], [-0.74,  1.24],
    [-0.58,  0.70], [-0.86,  0.58], [-0.68,  0.24], [-1.00,  0.14],
    [-1.00, -0.14], [-0.68, -0.24], [-0.86, -0.58], [-0.58, -0.70],
    [-0.74, -1.24], [-0.48, -1.30], [ 0.18, -0.60],
  ],
};

// The fill stays the company's colour — which side a ship is on is the thing you
// must read first, and it is read at a glance from colour. The hull's identity is
// carried by the silhouette and by one accent line, so both survive on the same
// ship without either fighting the other.
export const ACCENTS = {
  hauler:   '#9aa3ad',
  kestrel:  '#7fd4ff',
  vanguard: '#ffd479',
  bulwark:  '#e05a5a',
};

export const outlineFor = (hullKey, R = 1) =>
  (SILHOUETTES[hullKey] ?? SILHOUETTES.hauler).map(([x, y]) => [x * R, y * R]);

export const accentFor = hullKey => ACCENTS[hullKey] ?? ACCENTS.hauler;

// Where the canopy sits, as a fraction of R along the nose. Drawn as a small
// wedge so a ship has a front you can see at a glance, which matters more than
// it sounds: heading was previously only legible from the cannons.
export const canopyFor = hullKey => (hullKey === 'bulwark' ? 0.15 : 0.42);
