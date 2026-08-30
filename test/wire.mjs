// What the wire costs, and that shrinking it did not change what arrives.
//
// The full snapshot was measured first, against a real server with real sockets:
// 18.1 KiB/s for one pilot alone, 75.0 KiB/s EACH for twenty in one sector. The
// claims below are the durable half of that measurement — a scripted sector the
// codec can be run over deterministically, so a change that quietly puts the
// bytes back has something to fail against.
//
// Adding the pilot's handle to the row cost one byte a tick, 217 to 218, because a
// name never changes and so never sets its bit in the delta mask. It rides the
// keyframe and then goes quiet. That is the argument for putting it in the row
// rather than in a roster message, and this is where the argument is checked.

import { SHIP_FIELDS, POD_FIELDS, STREAMS, EPHEMERAL, bagKeys, packShip, packPod, unpackShip }
  from '../shared/net.js';
import { newBase, needsFull, encodeFull, encodeDelta, absorbFull, decodeDelta,
         diffRows, applyRows, diffBag, MAX_FIELDS } from '../shared/delta.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const bytes = o => JSON.stringify(o).length;
const same  = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- a sector to run the codec over -----------------------------------------
// Deliberately not random-per-run: a benchmark that moves under you is not a
// benchmark. Twelve pilots, of whom four are parked at the dock doing nothing at
// all (which is what most of a sector is doing most of the time), and eight
// hostiles that wander every tick.
const SEED = 20250830;
let rng = SEED;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function scene(pilots, foes) {
  rng = SEED;
  const mk = (id, co, hull, moving) => ({
    id, co, hull, moving, x: 2000 + rand() * 8000, y: 1500 + rand() * 5000,
    heading: rand() * 6.28, hp: 100, sh: 100, vx: (rand() - .5) * 90, vy: (rand() - .5) * 90,
  });
  const ships = [];
  for (let i = 0; i < pilots; i++) ships.push(mk(i + 1, 'm', 'vanguard', i >= 4));
  for (let i = 0; i < foes; i++) ships.push(mk(1_000_000 + i, 'x', 'drifter', true));
  const pods = [{ id: 5001, x: 6000, y: 4000, mat: 'iron', n: 3, own: 0 }];
  const bag = {
    hold: { iron: 2 }, cap: 240, credits: 12000, docked: false, vault: {}, gear: { plating: 1 },
    ammo: { standard: 1800, hollow: 400 }, using: { laser: 'standard' }, armed: { laser: 1, rocket: 1 },
    kits: { patch: 2 }, kit: 'patch', xp: 4200, rank: { level: 14, into: 0.4, need: 300 },
    drones: ['emitter2', 'emitter2'], played: 3600, online: pilots,
    power: { to: 'weapons', cap: 71, lv: { thrusters: 33, weapons: 71, shields: 33 } },
    shieldNow: 240, shieldMax: 240,
  };
  return { ships, pods, bag };
}

// One tick of that sector, packed the way the server packs it.
function tick(S, n) {
  for (const s of S.ships) {
    if (!s.moving) continue;
    s.x += s.vx / 30; s.y += s.vy / 30;
    if (s.x < 1000 || s.x > 11000) s.vx = -s.vx;
    if (s.y < 800  || s.y > 7200)  s.vy = -s.vy;
    s.heading = Math.atan2(s.vy, s.vx);
  }
  S.bag.played = 3600 + Math.floor(n / 30);        // one field that really does tick
  const rows = new Map();
  for (const s of S.ships) rows.set(s.id, packShip({
    id: s.id, x: Math.round(s.x), y: Math.round(s.y), heading: +s.heading.toFixed(2),
    charge: 0, co: s.co, hull: s.hull, hp: s.hp, sh: s.sh, flash: 0, tgt: 0, shot: 0,
    rk: 0, fix: 0, guns: 3, psys: 2, plvl: 71, lvl: 14, drones: 2, form: 0, dmask: 3,
    // A real handle, not a blank. A name never changes so it never sets its mask
    // bit, but leaving it null here would have the benchmark measure a row that
    // nobody is ever sent and quietly stop being the number in the header.
    name: s.name ?? `Pilot-${s.id}`,
    vis: s.co === 'm' ? 2 : 1, rig: 0, rgx: 0, rgy: 0, rgp: -1, rgf: -1, wrp: 0 }));
  return { ships: rows, pods: new Map(S.pods.map(p => [p.id, packPod(p)])) };
}

console.log('\nthe codec says the same thing the full snapshot did');
{
  // The claim that matters: a keyframe plus 300 deltas reconstruct, tick by tick,
  // exactly the message the old server would have sent. Not approximately.
  const S = scene(12, 8);
  const srv = newBase(), cli = newBase();
  let drift = null, fullB = 0, deltaB = 0, keyframes = 0;
  for (let n = 0; n < 300; n++) {
    const rows = tick(S, n);
    const extra = { bolts: [], rockets: [], blasts: [], hits: [] };
    // What the game used to send, built the same way encodeFull builds it.
    const truth = encodeFull(newBase(), 'm1', rows, S.bag, extra);
    const msg = needsFull(srv, 'm1')
      ? (keyframes++, encodeFull(srv, 'm1', rows, S.bag, extra))
      : encodeDelta(srv, rows, S.bag, extra);
    fullB += bytes(truth); deltaB += bytes(msg);
    const got = msg.t === 's' ? absorbFull(cli, msg) : decodeDelta(cli, msg);
    // Field-for-field through unpackShip, because two lists in a different order
    // are the same snapshot and the client keys by id anyway.
    const norm = m => ({
      bag: Object.fromEntries(bagKeys(m).filter(k => !STREAMS[k]).map(k => [k, m[k]])),
      ships: [...m.ships].map(unpackShip).sort((a, b) => a.id - b.id),
      pods: [...(m.pods ?? [])].sort((a, b) => a[0] - b[0]),
    });
    if (!drift && !same(norm(truth), norm(got))) drift = n;
  }
  check('a keyframe and the deltas after it rebuild the snapshot exactly',
    drift === null, drift === null ? '300 ticks of a twelve-pilot sector, field for field'
                                   : `drifted at tick ${drift}`);
  check('and it takes one keyframe to do it', keyframes === 1, `${keyframes} full snapshot in 300 ticks`);
  const cut = 1 - deltaB / fullB;
  check('the delta stream is a fraction of the full one on the same scene',
    cut > 0.60, `${(fullB / 300).toFixed(0)} bytes a tick became ${(deltaB / 300).toFixed(0)} — ` +
                `${(cut * 100).toFixed(0)}% off, ${(fullB * 30 / 300 / 1024).toFixed(1)} KiB/s down to ` +
                `${(deltaB * 30 / 300 / 1024).toFixed(1)} KiB/s`);
}

console.log('\na tick where nothing moved');
{
  // Four of the twelve are parked, and the whole point is that they cost nothing.
  const S = scene(4, 0);                          // all four parked, no wanderers
  const srv = newBase();
  const rows = tick(S, 0), extra = {};
  encodeFull(srv, 'm1', rows, S.bag, extra);
  const quiet = encodeDelta(srv, tick(S, 0), S.bag, extra);
  check('a sector where nothing changed costs almost nothing',
    bytes(quiet) <= 12, `${bytes(quiet)} bytes: ${JSON.stringify(quiet)}`);
  check('and the client still gets every ship out of it',
    (() => { const cli = newBase();
             absorbFull(cli, encodeFull(newBase(), 'm1', rows, S.bag, extra));
             return decodeDelta(cli, quiet).ships.length === 4; })(),
    'four parked pilots, zero bytes of ship on the wire, four ships on the screen');
}

console.log('\nthings arriving and leaving');
{
  const spec = STREAMS.ships;
  const mk = (id, x) => packShip({ ...Object.fromEntries(SHIP_FIELDS.map(f => [f, 0])), id, x, co: 'm', hull: 'vanguard' });
  const prev = new Map([[1, mk(1, 100)], [2, mk(2, 200)]]);
  const next = new Map([[1, mk(1, 101)], [3, mk(3, 300)]]);
  const d = diffRows(spec, prev, next);
  check('a ship that comes into range arrives whole, not as a patch of nothing',
    d[0].length === 1 && d[0][0][0] === 3 && d[0][0].length === SHIP_FIELDS.length,
    'the newcomer is one full row, so there is no half-drawn ship on the first frame');
  check('a ship that goes out of range is named as gone, not just left out',
    d[2].length === 1 && d[2][0] === 2,
    'silence would be indistinguishable from "nothing about it changed"');
  const out = applyRows(spec, new Map([...prev].map(([k, v]) => [k, v.slice()])), d);
  check('and applying it leaves exactly what the server can see',
    same([...out.keys()].sort(), [1, 3]), `${[...out.keys()].sort().join(',')}`);
  check('the one that stayed kept every field it was not told about',
    out.get(1)[SHIP_FIELDS.indexOf('hull')] === 'vanguard' &&
    out.get(1)[SHIP_FIELDS.indexOf('x')] === 101,
    'x moved, hull did not, and only x was sent');
}
{
  // An id leaving and another arriving in the same tick is not a rename. This is
  // the shape a respawn takes, and a codec that paired them off by position would
  // give the newcomer the dead pilot's hull.
  const spec = STREAMS.ships;
  const mk = (id, hull) => packShip({ ...Object.fromEntries(SHIP_FIELDS.map(f => [f, 0])), id, hull, co: 'm' });
  const d = diffRows(spec, new Map([[7, mk(7, 'bulwark')]]), new Map([[8, mk(8, 'kestrel')]]));
  const out = applyRows(spec, new Map([[7, mk(7, 'bulwark')]]), d);
  check('one leaving and one arriving in the same tick is two ships, not a rename',
    out.size === 1 && out.has(8) && out.get(8)[SHIP_FIELDS.indexOf('hull')] === 'kestrel',
    'the newcomer does not inherit the dead pilot\'s hull');
}

console.log('\nonly what moved');
{
  const spec = STREAMS.ships;
  const base = Object.fromEntries(SHIP_FIELDS.map(f => [f, 0]));
  const a = packShip({ ...base, id: 1, x: 100, y: 200, hp: 100 });
  const b = packShip({ ...base, id: 1, x: 100, y: 201, hp: 100 });
  const d = diffRows(spec, new Map([[1, a]]), new Map([[1, b]]));
  check('one field moving puts one field on the wire',
    d[1].length === 3 && d[1][2] === 201,
    `[id, mask, y] — ${JSON.stringify(d)}`);
  check('the mask bit and the field index are the same number',
    d[1][1] === (1 << SHIP_FIELDS.indexOf('y')),
    `mask ${d[1][1]} for field ${SHIP_FIELDS.indexOf('y')} — an off-by-one here reads hp out of the sh slot`);
  check('a row that did not move is not mentioned at all',
    diffRows(spec, new Map([[1, a]]), new Map([[1, a.slice()]])) === null,
    'null, not an empty update — six bytes a tick per stream, thirty times a second');
}
{
  // Bitwise operators in JavaScript are 32-bit and signed. A 32nd field would make
  // `1 << 31` negative and `1 << 32` wrap to 1, corrupting every update in a way
  // no test of the first 31 fields would notice.
  const over = Object.values(STREAMS).filter(s => s.fields.length > MAX_FIELDS);
  check('no stream has more fields than a mask can hold',
    !over.length, `ships is at ${SHIP_FIELDS.length} of ${MAX_FIELDS}; ` +
                  `a 32nd would make 1<<31 negative and shred every update`);
}
{
  // The diff compares fields with !==, which is identity. An object-valued field
  // would therefore look different every single tick and quietly cost more than
  // sending it whole. Every field of a deltaable stream has to be a scalar, and
  // the fastest way to notice one that is not is to look at a real packed row.
  const S = scene(3, 2), rows = tick(S, 0);
  const loose = [];
  for (const [name, spec] of Object.entries(STREAMS))
    for (const row of (rows[name] ?? new Map()).values())
      row.forEach((v, i) => { if (v !== null && typeof v === 'object') loose.push(`${name}.${spec.fields[i]}`); });
  check('every field a delta carries is a scalar it can compare',
    !loose.length, loose.length ? loose.join(', ')
      : `${SHIP_FIELDS.length} ship fields and ${POD_FIELDS.length} pod fields, ` +
        'all numbers or strings — an object would differ from itself every tick');
}

console.log('\nthe pilot\'s own state, which is most of the traffic when you are alone');
{
  const seen = new Map();
  const bag = { credits: 100, hold: { iron: 1 }, scoop: { id: 5, p: 0.2 }, want: undefined };
  const first = diffBag(seen, bag);
  check('the first look at a pilot sends everything about them',
    same(Object.keys(first.set).sort(), ['credits', 'hold', 'scoop']),
    'and never a key whose value was undefined');
  check('a second identical look sends nothing',
    diffBag(seen, { ...bag }) === null, 'the loadout does not change thirty times a second');
  bag.hold.iron = 2;                              // the server mutates this object in place
  const moved = diffBag(seen, bag);
  check('a cargo bay filled in place is still noticed',
    same(moved.set, { hold: { iron: 2 } }),
    'the server hands over the same object every tick — comparing by identity would never fire');
  const gone = diffBag(seen, { credits: 100, hold: { iron: 2 } });
  check('a field that goes away is said to have gone, not left to rot',
    same(gone.gone, ['scoop']), 'a finished tractor pull has to actually stop being drawn');
  check('and a field whose real value is null is not mistaken for one that vanished',
    (() => { const s2 = new Map(); diffBag(s2, { power: { to: null } });
             const d2 = diffBag(s2, { power: { to: 'weapons' } });
             return d2 && !d2.gone.length && d2.set.power.to === 'weapons'; })(),
    'removals travel in their own list, so null is just a value');
}

console.log('\nkeyframes, and a client with nothing to apply a delta to');
{
  check('a connection the server has never sent anything to is owed a keyframe',
    needsFull(newBase(), 'm1') && needsFull(null, 'm1'));
  const b = newBase();
  encodeFull(b, 'm1', { ships: new Map(), pods: new Map() }, {}, {});
  check('and once it has one, it is not owed another', !needsFull(b, 'm1'));
  check('jumping sectors is owed one, every time', needsFull(b, 'm2'),
    'the visible set changes wholesale, so a delta would be against the wrong sector');
}
{
  // A client that is handed a delta with no baseline must not half-apply it. The
  // server's answer to `need` is to drop the baseline, which makes the next tick a
  // keyframe — there is no partial state to repair.
  const cli = newBase();
  check('a client that has never seen a keyframe knows it cannot use a delta',
    cli.ready === false, 'so it asks for one rather than drawing against nothing');
  const srv = newBase();
  const S = scene(3, 2), rows = tick(S, 0);
  absorbFull(cli, encodeFull(srv, 'm1', rows, S.bag, {}));
  check('and the moment it has one, it can', cli.ready === true);
  const stale = newBase();                        // the server forgot this connection
  const after = encodeFull(stale, 'm1', tick(S, 1), S.bag, {});
  check('a server that forgot a baseline sends the whole world, not a broken diff',
    after.t === 's' && after.ships.length === 5,
    'the only state a keyframe needs is the truth it is built from');
}

console.log('\nthe message shape');
{
  const S = scene(6, 4);
  const srv = newBase();
  const full = encodeFull(srv, 'm1', tick(S, 0), S.bag, { bolts: [[1, 2, 3, 4, .5, 0, 1, 0]] });
  check('a keyframe is the message this game always sent',
    full.t === 's' && Array.isArray(full.ships) && full.credits === 12000 && full.bolts.length === 1,
    'so every existing reader of a snapshot still works, and there is only one of them');
  const d = encodeDelta(srv, tick(S, 1), S.bag, {});
  check('a delta names its own keys, and none of them are a snapshot field',
    !bagKeys({ t: 's', ...S.bag }).some(k => ['b', 'x', ...Object.values(STREAMS).map(s => s.wire)].includes(k)),
    'a bag field called `s` would silently eat the ship stream');
  check('an empty ephemeral stream is not sent at all',
    !('bolts' in d) && !('hits' in d),
    `bolts, rockets, blasts and hits omitted when empty — 44 bytes a tick back`);
  check('and the client fills them back in as empty rather than leaving them stale',
    (() => { const cli = newBase(); absorbFull(cli, full);
             const out = decodeDelta(cli, d);
             return EPHEMERAL.every(k => Array.isArray(out[k]) && out[k].length === 0); })(),
    'a bolt that stopped being sent has to stop being drawn');
}

{
  // Decoding hands back the baseline's own rows unless it copies them, and the
  // live benchmark found out the expensive way: it stored seventy-two ticks and
  // every one of them read as the last, because the next tick wrote straight
  // through the reference it had handed out.
  const S = scene(4, 2);
  const srv = newBase(), cli = newBase();
  absorbFull(cli, encodeFull(srv, 'm1', tick(S, 0), S.bag, {}));
  const held = decodeDelta(cli, encodeDelta(srv, tick(S, 1), S.bag, {}));
  const wasX = held.ships.map(r => r[1]);
  for (let n = 2; n < 12; n++) decodeDelta(cli, encodeDelta(srv, tick(S, n), S.bag, {}));
  check('a snapshot you keep is still the snapshot you kept ten ticks later',
    same(held.ships.map(r => r[1]), wasX),
    'the decoder hands back copies, not a window onto its own baseline');
}

console.log('\nwhat is deliberately not deltaed');
{
  // Measured, not assumed: with twenty pilots fighting in one sector the four
  // ephemeral streams were 3.5 KiB/s of 69.1 KiB/s. They have no id to key on and
  // the one field that changes on them changes every tick, so a keyed diff would
  // pay an id and a mask to save nothing.
  // Pyres joined them, and they are the argument's edge case rather than an
  // exception to it: a pyre lives 1.8 seconds and its fuse moves every single tick,
  // so a keyed diff would pay an id and a mask to re-send the one field that
  // changed. There is at most one per dead Censer.
  check('bolts, rockets, blasts, hits and pyres go whole, and the list says so',
    same(EPHEMERAL, ['bolts', 'rockets', 'blasts', 'hits', 'pyres']),
    '5% of a busy sector, no identity, and every field stale within a third of a second');
  // Research stations joined them, and they are the extreme case of the argument
  // rather than an exception to it: nothing on one ever moves, so 50 of them cost
  // 1,570 bytes once on the keyframe and exactly nothing per tick.
  check('ships, pods and research stations are the ones that are worth diffing',
    same(Object.keys(STREAMS), ['ships', 'pods', 'labs']),
    'long-lived, keyed, and 82% of the traffic in a crowded sector');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the wire'}\n`);
process.exit(fails.length ? 1 : 0);
