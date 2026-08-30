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
                            'rig', 'rgx', 'rgy', 'rgp', 'rgf',
                            // how far through a recall, so a fold is something
                            // other people watch happen rather than a vanishing
                            'wrp',
                            // How hard the hull's own ability is running, 0..100.
                            // One field for all three, because all three are the
                            // same dial and every one of them has to be visible:
                            // a Veil you cannot see fade is indistinguishable from
                            // a bug, and an Anchor nobody can see is just a ship
                            // that stopped.
                            'abl'];

// A bolt in flight: where it started, where it is aimed, how far along it is,
// whether a hostile fired it, and how much damage it carries — which is what the
// client draws its thickness from.
// `gr` is the ammunition grade the shot was fired with, so a round is drawn in
// the colour of what loaded it. Nothing on the wire says which pilot fired it,
// and it does not need to: the grade is the thing you can see.
// `lk` is the firing ship's Lock, 0..100. A locked bolt burns its own colour
// whatever is loaded, because what is guiding it stopped being the ammunition.
export const BOLT_FIELDS = ['sx', 'sy', 'ax', 'ay', 'p', 'foe', 'w', 'gr', 'lk'];
export const packBolt   = o   => [Math.round(o.sx), Math.round(o.sy), Math.round(o.ax), Math.round(o.ay),
                                  +(1 - o.t / o.ttl).toFixed(3), o.foe ? 1 : 0, o.w ?? 1, o.gr ?? 0, o.lk ?? 0];
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

// Which collections the delta codec carries, and what identifies a row in them.
//
// This is the seam: a stream listed here gets add / update / remove encoding for
// free, keyed on the named field, with the field order still declared exactly
// once above. Adding one is a line of data, not another encoder — and it is here
// rather than in delta.js so that the order and the diffing can never be
// declared in two places and disagree, which is the whole reason this file
// exists.
//
// `wire` is the one-letter key the delta message uses. `key` is the INDEX of the
// identifying field, resolved from the name so it cannot drift if the order is
// ever rearranged.
const streamOf = (wire, fields, keyName) => ({ wire, fields, key: fields.indexOf(keyName) });
export const STREAMS = {
  ships: streamOf('s', SHIP_FIELDS, 'id'),
  pods:  streamOf('p', POD_FIELDS,  'id'),
};

// Deliberately NOT deltaed, and this is the measurement that says so rather than
// an assumption: with twenty pilots fighting in one sector, bolts, hits, blasts
// and rockets together came to 3.5 KiB/s of a 69.1 KiB/s stream — 5%. They have
// no identity to key on, they live between 0.2s and 0.95s, and the one field
// that changes on them (how far through their life they are) changes every
// single tick, so a keyed diff would be paying an id and a mask to save a
// handful of numbers that were already stale. They go whole, and are simply
// omitted when empty, which is 44 bytes a tick back for nothing.
export const EPHEMERAL = ['bolts', 'rockets', 'blasts', 'hits'];

// Everything else in a snapshot is the viewer's own state — credits, loadout,
// power, rank. Named keys, so this is a set difference rather than a list anyone
// has to maintain: add a field to the snapshot and it is diffed automatically.
const NOT_BAG = new Set(['t', ...Object.keys(STREAMS), ...EPHEMERAL]);
export const bagKeys = msg => Object.keys(msg).filter(k => !NOT_BAG.has(k));

export const packShip   = o   => SHIP_FIELDS.map(f => o[f]);
export const unpackShip = arr => { const o = {}; for (let i = 0; i < SHIP_FIELDS.length; i++) o[SHIP_FIELDS[i]] = arr[i]; return o; };
