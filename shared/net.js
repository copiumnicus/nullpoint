// Wire format for a ship in a snapshot.
//
// This is a positional array to keep snapshots small, which means server and
// client must agree on the order exactly. They agreed by hand until the tuple
// reached eleven fields and the last two ended up transposed — the client read
// visibility as an impact flash. The order is declared once, here, and both sides
// go through pack/unpack, so drifting apart is no longer possible.

// rig/rgx/rgy/rgp/rgf carry the collector: whether there is one, where its drone
// is, how far through a lift it is, and which leg it is on — rgf is -1 for no
// pull, 0 outbound, 1 lifting, 2 coming home. The phase is on the wire rather
// than inferred because the client used to guess it from a variable the escort
// pass had not filled in yet, and flashed a tractor beam across the screen on
// the first frame of every pull. They are on the ship record rather than in the
// viewer's own payload because the whole point is that OTHER people can see it —
// before this, a pod being hauled away just vanished off everyone else's screen.
export const SHIP_FIELDS = ['id', 'x', 'y', 'heading', 'charge', 'co', 'hull', 'hp', 'sh', 'flash',
                            'tgt', 'shot', 'rk', 'fix', 'guns', 'psys', 'plvl', 'lvl', 'drones', 'form', 'dmask', 'vis',
                            'rig', 'rgx', 'rgy', 'rgp', 'rgf'];

// A bolt in flight: where it started, where it is aimed, how far along it is,
// whether a hostile fired it, and how much damage it carries — which is what the
// client draws its thickness from.
// `gr` is the ammunition grade the shot was fired with, so a round is drawn in
// the colour of what loaded it. Nothing on the wire says which pilot fired it,
// and it does not need to: the grade is the thing you can see.
export const BOLT_FIELDS = ['sx', 'sy', 'ax', 'ay', 'p', 'foe', 'w', 'gr'];
export const packBolt   = o   => [Math.round(o.sx), Math.round(o.sy), Math.round(o.ax), Math.round(o.ay),
                                  +(1 - o.t / o.ttl).toFixed(3), o.foe ? 1 : 0, o.w ?? 1, o.gr ?? 0];
export const unpackBolt = arr => { const o = {}; for (let i = 0; i < BOLT_FIELDS.length; i++) o[BOLT_FIELDS[i]] = arr[i]; return o; };

// A rocket in flight. Unlike a bolt this is a body, not a line: it has a place
// and a facing that both change every tick, so the client draws where it is now
// rather than interpolating a segment.
export const ROCKET_FIELDS = ['x', 'y', 'h', 'foe', 'w', 'gr'];
export const packRocket   = o   => [Math.round(o.x), Math.round(o.y), +o.heading.toFixed(2),
                                    o.foe ? 1 : 0, o.w ?? 100, o.gr ?? 0];
export const unpackRocket = arr => { const o = {}; for (let i = 0; i < ROCKET_FIELDS.length; i++) o[ROCKET_FIELDS[i]] = arr[i]; return o; };

// A kill flash: where it happened, how big the thing was, how far along the
// animation is, and whether it was a hostile that died.
export const BLAST_FIELDS = ['x', 'y', 'r', 'p', 'foe'];
export const packBlast   = o   => [Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                   +(1 - o.t / o.ttl).toFixed(3), o.foe ? 1 : 0];
export const unpackBlast = arr => { const o = {}; for (let i = 0; i < BLAST_FIELDS.length; i++) o[BLAST_FIELDS[i]] = arr[i]; return o; };

// A cargo pod adrift in space.
// `own` is the pilot a shared kill reserved this pod for, or 0 for anyone's.
export const POD_FIELDS = ['id', 'x', 'y', 'mat', 'n', 'own'];
export const packPod   = o   => [o.id, Math.round(o.x), Math.round(o.y), o.mat, o.n, o.own ?? 0];
export const unpackPod = arr => { const o = {}; for (let i = 0; i < POD_FIELDS.length; i++) o[POD_FIELDS[i]] = arr[i]; return o; };

// A damage number, floating up from where it landed. `sh` marks a hit the shields
// swallowed whole; `mine` is filled in per viewer, since the same hit reads
// differently depending on which end of it you were on.
export const HIT_FIELDS = ['x', 'y', 'n', 'sh', 'mine', 'p'];
export const packHit   = (o, mine) => [Math.round(o.x), Math.round(o.y), Math.round(o.n),
                                       o.sh ? 1 : 0, mine ? 1 : 0, +(1 - o.t / o.ttl).toFixed(2)];
export const unpackHit = arr => { const o = {}; for (let i = 0; i < HIT_FIELDS.length; i++) o[HIT_FIELDS[i]] = arr[i]; return o; };

export const packShip   = o   => SHIP_FIELDS.map(f => o[f]);
export const unpackShip = arr => { const o = {}; for (let i = 0; i < SHIP_FIELDS.length; i++) o[SHIP_FIELDS[i]] = arr[i]; return o; };
