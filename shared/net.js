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
                            'abl',
                            // Who is flying it. A name never changes, so the delta
                            // mask never sets its bit and it costs nothing per tick —
                            // it rides the keyframe and then goes quiet. It is in the
                            // row rather than in a roster message for one reason that
                            // matters more than the bytes: the row set IS the radar
                            // set, so a pilot you have not detected cannot be named
                            // by accident. A roster would be a second copy of "who
                            // may this pilot see", and a rule kept twice disagrees.
                            'name'];

// A bolt in flight: where it started, where it is aimed, how far along it is,
// whether a hostile fired it, and how much damage it carries — which is what the
// client draws its thickness from.
// `gr` is the ammunition grade the shot was fired with, so a round is drawn in
// the colour of what loaded it. Nothing on the wire says which pilot fired it,
// and it does not need to: the grade is the thing you can see.
// It carried a tenth field, `lk` — the firing ship's Lock, 0..100 — and the client
// drew a locked bolt orange whatever grade fired it. Lock is gone, replaced by
// Drumfire, and a rate of fire needs nothing on the bolt to be legible: the tell
// is that there are more of them, arriving sooner. A field that is always 0 is a
// field the next person has to work out is dead.
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

// An orb in flight: a slow ball of light that hits whatever it passes through. Like
// a rocket this is a body rather than a line, so the client draws where it IS.
//
// `r` is on the wire and it is the SAME number stepOrbs collides with. It has to be:
// the whole mechanic is reading a pattern off the screen and flying between it, and a
// ball drawn at one radius and hit at another is the "a row you can see and cannot
// click" bug moved out of the panel and into the world, where it decides fights.
//
// `h` and not `vx, vy`, because a heading is one field where a velocity is two. The
// client flies it forward from the last snapshot exactly as it does a rocket — at
// 400px/s a tick is 13px, which is under half a hull and visibly steppy without it.
//
// `v` IS THE SIXTH FIELD AND IT ARRIVED WITH THE CALTROPS. Orbs used to be five and
// the note here said "one fewer than a rocket, because every orb travels at
// ORB_SPEED"; that stopped being true the moment a pattern could `stay` — an orb that
// has reached its mark sits on it at 0 px/s, and the client dead-reckons between
// snapshots. Without this it flew a parked caltrop forward 13px a tick and drew the
// hazard 48px off the place the server collides with, which is the "a ball you can see
// and cannot be hit by" bug the `r` field two lines up exists to stop.
//
// It is DERIVED from the velocity rather than stored beside it, so the two can never
// disagree: there is one answer to how fast an orb is going and stepOrbs owns it.
//
// WHAT IT COSTS, off a real socket. test/orbs-live.mjs measures a pilot weaving in
// front of one Bandit at 5.4 orbs on the wire per tick, peaking at 8, inside a 6.64
// KiB/s stream. Orbs are EPHEMERAL, so every row goes whole every tick, and the sixth
// field is four bytes of it: 5.4 x 30 x 4 is 0.63 KiB/s, a tenth of that stream. It is
// the dearest field on the row and it is the one that cannot be inferred — the client
// has the heading and the radius and no way at all to know the thing has stopped.
//
// AND WHAT IT COSTS WHERE IT MATTERS, which is a different question and was measured
// rather than argued. Three of the bestiary were converted off a bolt onto a pattern
// in the same change that added this field, so the honest test is the whole of it
// against none of it: test/wire-live.mjs's twenty-pilot fight reads 11.37 KiB/s a
// player either way, and 9.09 against 9.07 compressed. The sixth field and three new
// weapons together are inside the noise of that measurement, because what a delta
// costs there is twenty ships moving and not the ordnance.
export const ORB_FIELDS = ['x', 'y', 'h', 'r', 'foe', 'v'];
export const packOrb   = o   => [Math.round(o.x), Math.round(o.y), +o.heading.toFixed(2),
                                 Math.round(o.r), o.foe ? 1 : 0,
                                 Math.round(Math.hypot(o.vx ?? 0, o.vy ?? 0))];
export const unpackOrb = arr => { const o = {}; for (let i = 0; i < ORB_FIELDS.length; i++) o[ORB_FIELDS[i]] = arr[i]; return o; };

// A pressure front leaving an answering ring: where it left from, how wide it has
// grown, and the one wedge of it that is silent.
//
// `r` is the radius the SERVER is sweeping with, for ORB_FIELDS' reason and it is
// the more important case of it: the whole mechanic is being on the right side of a
// line, and a ring drawn one radius and resolved at another would be a fight decided
// by a rendering choice.
//
// `g` and `h` are the lane, in world bearings, because the plates are: shared/
// plates.js says out loud that "the ring is a compass, not a nose", so a wedge is the
// same wedge whichever way the hull is pointing. Sending them makes the row
// self-describing — the client does not have to find the hostile that threw it, look
// up its definition and work out a plate arc, which is three chances to draw a lane
// that is not the lane you can fly through.
//
// It is EPHEMERAL rather than keyed, and it is the profile that list describes
// exactly: it lives a second and a half, there is at most one of them in the galaxy
// at a time, it has no identity worth diffing, and the one field that matters changes
// on every single tick.
export const WAVE_FIELDS = ['x', 'y', 'r', 'g', 'h'];
export const packWave   = o   => [Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                  +(o.g ?? 0).toFixed(2), +(o.h ?? 0).toFixed(2)];
export const unpackWave = arr => { const o = {}; for (let i = 0; i < WAVE_FIELDS.length; i++) o[WAVE_FIELDS[i]] = arr[i]; return o; };

// A kill flash: where it happened, how big the thing was, how far along the
// animation is, and whether it was a hostile that died.
export const BLAST_FIELDS = ['x', 'y', 'r', 'p', 'foe'];
export const packBlast   = o   => [Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                   +(1 - o.t / o.ttl).toFixed(3), o.foe ? 1 : 0];
export const unpackBlast = arr => { const o = {}; for (let i = 0; i < BLAST_FIELDS.length; i++) o[BLAST_FIELDS[i]] = arr[i]; return o; };

// A cargo pod adrift in space.
// `own` is the pilot a shared kill reserved this pod for, or 0 for anyone's.
// `cr` is credits rather than ore — a duel's purse, dropped where the loser fell.
// It is 0 on every pod the galaxy has ever produced, so it costs one zero per pod
// on the keyframe and nothing at all per tick once the delta mask has seen it.
export const POD_FIELDS = ['id', 'x', 'y', 'mat', 'n', 'own', 'cr'];
export const packPod   = o   => [o.id, Math.round(o.x), Math.round(o.y), o.mat, o.n, o.own ?? 0, o.cr ?? 0];
export const unpackPod = arr => { const o = {}; for (let i = 0; i < POD_FIELDS.length; i++) o[POD_FIELDS[i]] = arr[i]; return o; };

// A damage number, floating up from where it landed. `sh` marks a hit the shields
// swallowed whole; `mine` is filled in per viewer, since the same hit reads
// differently depending on which end of it you were on.
//
// `p` runs 0 -> 1 over the number's life, because a hit is created with t == ttl
// and this sends 1 - t/ttl. Worth saying out loud: a hit is EPHEMERAL, so it rides
// every snapshot until it expires, and anything counting hits off the wire has to
// take the frame at 0 and skip the rest. Reading it the other way round counts each
// hit once at the very end and misses every one the socket stopped before — which
// is exactly what a live check of the Thresher's payload did, reporting a 913-point
// mirror bolt for one that was actually 5,028.
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
// A research station standing in a company ring. Nothing on it ever moves, so it
// rides the keyframe and then goes silent — 50 of them cost 1,570 bytes once and
// nothing at all per tick. `own` is filled in per viewer, the way HIT_FIELDS does
// `mine`, so the client never has to match names to know whose it is.
//
// Not radar-filtered, deliberately. The radar rule keeps an enemy you have not
// DETECTED off the wire; a lab is furniture in a haven, and one that popped into
// existence at 2200px would read as a bug rather than as stealth.
export const LAB_FIELDS = ['id', 'x', 'y', 'mods', 'own', 'name'];
export const packLab   = (o, own) => [o.id, Math.round(o.x), Math.round(o.y),
                                      o.mods | 0, own ? 1 : 0, o.name ?? ''];
export const unpackLab = arr => { const o = {}; for (let i = 0; i < LAB_FIELDS.length; i++) o[LAB_FIELDS[i]] = arr[i]; return o; };

// A reactor that has died and not yet let go. Same five numbers as a blast — where,
// how wide, how far through, and whose side — because it IS a blast with a fuse on
// the front of it: the ring stands at its last radius while `p` runs 0 to 1, and
// then everything still inside takes it. It is a stream of its own rather than a
// blast with a long life because the two mean opposite things to a pilot: a blast
// has already happened and a pyre has not yet.
export const PYRE_FIELDS = ['x', 'y', 'r', 'p', 'foe'];
export const packPyre   = o   => [Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                  +(1 - o.t / o.ttl).toFixed(3), 1];
export const unpackPyre = arr => { const o = {}; for (let i = 0; i < PYRE_FIELDS.length; i++) o[PYRE_FIELDS[i]] = arr[i]; return o; };

// A fix standing over the place a pilot is about to be put back to. Five numbers,
// the same shape a pyre has and for the same reason: it is a thing at a place with a
// countdown on it, and the countdown is the only part that matters. `own` is filled
// in per viewer the way HIT_FIELDS does `mine`, because your own fix and somebody
// else's are the same object and completely different news.
//
// It is a stream of its own rather than a field on the Kedge's row for the reason
// SHIP_FIELDS is at 30 of a hard 31: a point in space is two more numbers and there
// is one slot left in the whole wire format. It is ephemeral rather than keyed
// because it lives three seconds, has no identity worth diffing, and the one field
// on it that matters changes every single tick — which is exactly the measurement
// EPHEMERAL below already states.
export const FIX_FIELDS = ['x', 'y', 'r', 'p', 'own'];
export const packFix   = (o, own) => [Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                      +Math.max(0, Math.min(1, o.p)).toFixed(3), own ? 1 : 0];
export const unpackFix = arr => { const o = {}; for (let i = 0; i < FIX_FIELDS.length; i++) o[FIX_FIELDS[i]] = arr[i]; return o; };

// A patch of sown ground. Where, how big, how far through its life, and which of
// the two kinds it is — so the client picks a palette from one integer rather than
// from a colour on the wire.
//
// It is a keyed STREAM and not an EPHEMERAL, and that is a measurement rather than
// a preference. Read the note on EPHEMERAL below: those go whole every tick because
// they have no identity, live under a second, and the one field on them that
// matters changes every tick. A patch is the exact opposite of all three — it lives
// twelve to thirty-six seconds, it has an id, and SIX of its seven fields never change
// once it is laid. Measured, at the steady state of a deep sector — two Crucibles at
// six pools each and two Doldrums at two stills, sixteen patches at 30Hz:
//
//     sent whole every tick   12.76 KiB/s     more than every bolt, rocket, blast
//     keyed and diffed         0.61 KiB/s     and hit in a twenty-pilot brawl, which
//                                             net.js already measures at 3.5
//
// Being able to say that in one line of data here is the whole point of STREAMS.
// `on` is whether the ground is LIVE or still being laid, and it is the reason a
// sower has a tell at all. A patch that only appeared once it was already burning
// would be the one hazard in the game you find out about by being in it — so the
// place it is going to land is on the wire for the whole wind-up, at the radius it
// will have, tightening. That is shared/kedge.js's rule for a fix marker restated:
// a marker you can see that is not where you end up is the same bug as a row you
// can see and cannot click, and this codebase has shipped that twice.
//
// `p` therefore means "how far through whatever this row is currently doing" — the
// wind-up while `on` is 0, and the patch's own life once it is 1. One field, two
// phases, and the phase is the field next to it rather than something the client
// has to infer from a radius that has not changed.
export const SOWN_FIELDS = ['id', 'x', 'y', 'r', 'p', 'k', 'on'];
// `p` is fixed to TWO places, not the three every other phase on this wire uses,
// and that is a measurement rather than sloppiness. It is the only field on a patch
// that ever changes, so it alone decides what the stream costs: at three places a
// thirty-six-second pool ticks a new value every frame and sixteen patches cost 4.90
// KiB/s; at two it changes only every eleventh frame and they cost 0.61. One percent
// of a thirty-six-second life is 0.36s of a countdown arc, which is under the resolution of
// the thing it is drawing.
export const packSown   = o   => [o.id, Math.round(o.x), Math.round(o.y), Math.round(o.r),
                                  +Math.max(0, Math.min(1, o.p)).toFixed(2), o.k | 0, o.on ? 1 : 0];
export const unpackSown = arr => { const o = {}; for (let i = 0; i < SOWN_FIELDS.length; i++) o[SOWN_FIELDS[i]] = arr[i]; return o; };

// Which kind of ground, as an integer. Declared here rather than as a string on the
// row because the client draws from it and the server writes it, and a spelling
// kept in two places is the drift this file exists to prevent.
export const GROUND_KINDS = ['white', 'slack'];
export const groundK = kind => Math.max(0, GROUND_KINDS.indexOf(kind));

// An answering ring: one row per hostile that has one, and one column per plate.
// `id` is the hostile's own id, so the row and the ship row are the same thing seen
// twice and nothing has to be matched up by position.
//
// WHY IT IS A STREAM AND NOT A FIELD ON THE SHIP ROW, which is the question this
// codebase makes you answer with numbers. SHIP_FIELDS is at 30 of a hard 31 —
// the mask is a signed 32-bit integer — and eight charges do not fit in `abl`,
// which is one 0..100 dial. So there were two honest shapes, and both were priced
// through the real delta codec over thirty seconds of two Antiphons with a pilot
// walking their fire around each ring:
//
//   one packed 24-bit field on the ship row      +0.036 KiB/s   and the last slot gone
//   its own stream, eight columns at 0..100       0.721
//   its own stream, eight columns at 0..15        0.150
//   its own stream, one packed 24-bit column      0.100
//   sent whole every tick, eight columns          1.38
//
// The packed field on the ship row is the cheapest and it is not what shipped. It
// costs almost nothing because a boss's row is already moving every tick, so the
// extra integer rides a message that was going anyway — but it spends the LAST
// field in the wire format on one hostile in one sector, and puts a column on every
// pilot, pod-hauler and Drifter in the galaxy for it. FIX_FIELDS and SOWN_FIELDS
// both went the other way for exactly this reason, and both say so above.
//
// EIGHT COLUMNS AT 0..15, then, at 0.150 KiB/s — a quarter of what sixteen ground
// patches cost, which this file already accepts. The resolution is the measurement
// and not a preference, the same way SOWN_FIELDS' two decimal places are: at 0..100
// every plate ticks a new value every frame and the ring costs 0.721 KiB/s; at
// sixteen steps it changes every fourth frame and costs 0.150. One step is 6% of a
// discharge, which is under the resolution of a glow — and the top step is exact,
// which is the only one a pilot has to read precisely.
//
// The column count is FIXED here and shared/plates.js clamps `n` to it, because a
// definition asking for a ninth plate would otherwise drop it silently off the
// snapshot and draw a cold wedge that was about to fire.
//
// TWO COLUMNS A PLATE, and the second one was free. `p` is how hard the plate is
// RIGHT NOW — it bleeds on a half-life, so it changes every few frames and it is what
// this stream costs. `s` is how far through failing it is, which is the opposite kind
// of number: it only ever climbs, it never bleeds, and it moves one step every few
// SECONDS. Measured through the same codec and the same two rings, sixty seconds of a
// pilot committed to one bearing:
//
//     charge only, 8 columns          0.086 KiB/s
//     charge and strain, 16 columns   0.094
//
// Eight pennies. A monotonic column is nearly free under a delta mask, which is the
// same fact SOWN_FIELDS states from the other end when it says its ONE moving column
// is what decides the price.
//
// AND `s` AT THE TOP STEP MEANS BROKEN, which is not an overloaded field: strain
// saturates at exactly 1 and a plate is broken at exactly 1, so they are the same
// number and the top step is where they both land. `floor` below rather than `round`
// so a plate at 0.97 cannot read as gone one step early — the one place in this
// packer where rounding would be a lie rather than a resolution.
export const PLATE_FIELDS = ['id', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7',
                             's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const PLATE_STEPS  = 15;
const step = c => Math.max(0, Math.min(PLATE_STEPS, Math.round((c || 0) * PLATE_STEPS))) | 0;
// A plate is broken at strain 1 and nowhere below it, so the top step is reserved for
// exactly that and everything short of it floors into 0..14.
const wear = v => (v >= 1 ? PLATE_STEPS
                          : Math.max(0, Math.min(PLATE_STEPS - 1, Math.floor((v || 0) * PLATE_STEPS))) | 0);
export const PLATE_COLS   = (PLATE_FIELDS.length - 1) / 2;
export const packPlates   = o   => [o.id,
                                    ...Array.from({ length: PLATE_COLS }, (_, i) => step(o.plates?.[i])),
                                    ...Array.from({ length: PLATE_COLS }, (_, i) => wear(o.strain?.[i]))];
export const unpackPlates = arr => { const o = {}; for (let i = 0; i < PLATE_FIELDS.length; i++) o[PLATE_FIELDS[i]] = arr[i]; return o; };

// A ping: one pilot pointing at a place on the chart, with their callsign nailed
// to it. Where, how far through its eight seconds, and who dropped it.
//
// THE NAME IS ON THE ROW AND NOT LOOKED UP FROM THE SHIP, and that is the whole
// reason this is a stream of its own rather than two numbers hung off a pilot's
// row. `name` on SHIP_FIELDS reaches you only for a ship your radar has, which
// is correct for a ship and wrong for a ping: a ping is a deliberate broadcast
// and crosses radar by design (see shared/ping.js), so a pilot 4,000px away in
// the dark can drop one and it has to arrive with a name on it. A client
// matching a ping to a ship row it does not have would draw an anonymous ring,
// which is the same bug as no ping at all. SHIP_FIELDS is at 30 of a hard 31
// besides, and a point in space plus a name is three fields.
//
// WHY IT IS KEYED AND NOT EPHEMERAL, priced through the real delta codec over
// thirty seconds — four pilots each pinging the instant their cooldown clears,
// which holds 3.2 live on average:
//
//   sent whole every tick        3.820 KiB/s   of which 1.502 is the callsign
//   keyed, p at 3 decimals       1.261
//   keyed, p at 2 decimals       0.567
//   keyed, p at 1 decimal        0.087
//
// The EPHEMERAL note below says those go whole because they have no identity,
// live under a second, and the one field that matters changes every tick. A ping
// is the opposite of the first two: it lives eight seconds and it has an id. And
// the third is what the split above is really measuring — 40% of the cost of
// sending it whole is re-transmitting a sixteen-character callsign thirty times
// a second, and a name is the one field on a ping that can never change. Keyed,
// it rides the add and then goes quiet, exactly the way `name` does on a ship
// row.
//
// TWO DECIMAL PLACES on `p`, and unlike SOWN_FIELDS that is where the resolution
// stops rather than being taken further down. A tenth is 6.6x cheaper again and
// it is not honest here: `p` drives an OPACITY over the last third of the life,
// so a tenth of an eight-second ping is 0.8s of a 2.6s fade — four visible steps,
// which reads as a label blinking out rather than fading. A patch of ground could
// take that cut because one percent of a thirty-six-second countdown arc is under
// the resolution of the thing it draws; a four-frame fade is not.
export const PING_FIELDS = ['id', 'x', 'y', 'p', 'name'];
export const packPing   = o   => [o.id, Math.round(o.x), Math.round(o.y),
                                  +Math.max(0, Math.min(1, o.p)).toFixed(2), o.name ?? ''];
export const unpackPing = arr => { const o = {}; for (let i = 0; i < PING_FIELDS.length; i++) o[PING_FIELDS[i]] = arr[i]; return o; };

export const STREAMS = {
  ships:  streamOf('s', SHIP_FIELDS,  'id'),
  pods:   streamOf('p', POD_FIELDS,   'id'),
  labs:   streamOf('l', LAB_FIELDS,   'id'),
  sown:   streamOf('g', SOWN_FIELDS,  'id'),
  plates: streamOf('a', PLATE_FIELDS, 'id'),
  pings:  streamOf('n', PING_FIELDS,  'id'),
};

// Deliberately NOT deltaed, and this is the measurement that says so rather than
// an assumption: with twenty pilots fighting in one sector, bolts, hits, blasts
// and rockets together came to 3.5 KiB/s of a 69.1 KiB/s stream — 5%. They have
// no identity to key on, they live between 0.2s and 0.95s, and the one field
// that changes on them (how far through their life they are) changes every
// single tick, so a keyed diff would be paying an id and a mask to save a
// handful of numbers that were already stale. They go whole, and are simply
// omitted when empty, which is 44 bytes a tick back for nothing.
export const EPHEMERAL = ['bolts', 'rockets', 'orbs', 'blasts', 'hits', 'pyres', 'fixes', 'waves'];

// Everything else in a snapshot is the viewer's own state — credits, loadout,
// power, rank. Named keys, so this is a set difference rather than a list anyone
// has to maintain: add a field to the snapshot and it is diffed automatically.
const NOT_BAG = new Set(['t', ...Object.keys(STREAMS), ...EPHEMERAL]);
export const bagKeys = msg => Object.keys(msg).filter(k => !NOT_BAG.has(k));

export const packShip   = o   => SHIP_FIELDS.map(f => o[f]);
export const unpackShip = arr => { const o = {}; for (let i = 0; i < SHIP_FIELDS.length; i++) o[SHIP_FIELDS[i]] = arr[i]; return o; };
