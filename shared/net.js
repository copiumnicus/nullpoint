// Wire format for a ship in a snapshot.
//
// This is a positional array to keep snapshots small, which means server and
// client must agree on the order exactly. They agreed by hand until the tuple
// reached eleven fields and the last two ended up transposed — the client read
// visibility as an impact flash. The order is declared once, here, and both sides
// go through pack/unpack, so drifting apart is no longer possible.

export const SHIP_FIELDS = ['id', 'x', 'y', 'heading', 'charge', 'co', 'hull', 'hp', 'sh', 'flash',
                            'tgt', 'shot', 'guns', 'psys', 'plvl', 'lvl', 'drones', 'vis'];

// A bolt in flight: where it started, where it is aimed, how far along it is, and
// whether a hostile fired it.
export const BOLT_FIELDS = ['sx', 'sy', 'ax', 'ay', 'p', 'foe', 'w'];
export const packBolt   = o   => [Math.round(o.sx), Math.round(o.sy), Math.round(o.ax), Math.round(o.ay),
                                  +(1 - o.t / o.ttl).toFixed(3), o.foe ? 1 : 0, o.w ?? 1];
export const unpackBolt = arr => { const o = {}; for (let i = 0; i < BOLT_FIELDS.length; i++) o[BOLT_FIELDS[i]] = arr[i]; return o; };

// A kill flash: where it happened, how big the thing was, how far along the
// animation is, and whether it was a hostile that died.
export const BLAST_FIELDS = ['x', 'y', 'r', 'p', 'foe'];
export const packBlast   = o   => [Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                   +(1 - o.t / o.ttl).toFixed(3), o.foe ? 1 : 0];
export const unpackBlast = arr => { const o = {}; for (let i = 0; i < BLAST_FIELDS.length; i++) o[BLAST_FIELDS[i]] = arr[i]; return o; };

// A cargo pod adrift in space.
export const POD_FIELDS = ['id', 'x', 'y', 'mat', 'n'];
export const packPod   = o   => [o.id, Math.round(o.x), Math.round(o.y), o.mat, o.n];
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
