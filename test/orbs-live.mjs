// The three lowest hostiles, against a REAL server over a REAL socket.
//
// Not in `npm test`: it boots the game, teleports an admin into the testing ground
// and stands in front of three hostiles for two minutes each way, which is not what a
// test suite is for. It is here for the reason test/ring-live.mjs and
// test/deeps-live.mjs are — rule four says tests passing is not the same as the game
// working — and it checks the four things that only exist once a socket is involved:
//
//   * a pattern reaches a client at all, at the radius the server collides with;
//   * `v` on the wire is the orb's real speed, so a Bandit's caltrops arrive PARKED
//     and stay at the same place across ticks — the client dead-reckons at `v`, and
//     without it the hazard is drawn up to 48px from the disc that hurts you;
//   * standing still costs what the bestiary says it costs, read off the floating
//     damage numbers rather than out of the simulation;
//   * and moving beats each of the three, which is the whole feature.
//
//     node test/orbs-live.mjs
//
// It runs the server in a sandbox under the system temp directory on a port the
// kernel picks, so the world you play in is untouched and it cannot collide with
// anything else somebody has running. PORT=0 is NOT enough on its own: server.js
// reads `Number(process.env.PORT) || 3000`, so a zero falls through to 3000.
//
// What it produced, on this machine. A bare Bulwark, healed every quarter second so
// the reading is of the weapon and not of a wreck, standing at each hostile's own
// standoff for forty seconds each way with nothing else in the sector engaged:
//
//                  book    parked   weaving     orbs on the wire      the stream
//     Drifter      49.5      49.5      13.5     0.7 / 1.2 a tick        3.22 KiB/s
//     Harrier      60.0      59.9      18.7     2.8 / 5.8              7.05
//     Bandit      195.0     195.0      78.8     2.4 / 5.4, parked      6.64
//
// The parked column is the invariant, and it lands on the book to the decimal:
// threatDps, the bounties, the experience and three claim rosters all read
// `damage x fireRate` and a pilot who does not move still pays exactly it. The
// weaving column is the feature — 27%, 31% and 40% of standing still. Both are
// FLOORS rather than answers, because the weave here is a script that reverses on a
// timer and a person reads the pattern instead.
//
// The two orb columns are parked and weaving: a pilot who does not move detonates
// every caltrop as it lands, and one who does leaves them on the floor, which is why
// the field only exists for somebody who is dodging it. The KiB/s is the whole
// stream, not the orbs — the room refills between phases, so the Harrier's window had
// fourteen hostiles in radar and the Drifter's nine.

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { newBase, absorbFull, decodeDelta } from '../shared/delta.js';
import { unpackShip, unpackOrb, unpackHit } from '../shared/net.js';
import { ALIENS, standOff } from '../shared/aliens.js';
import { orbsOf, stayFor, ORB_SPEED } from '../shared/orbs.js';
// The firing line's own layout, read off the map rather than off the wire. It has to
// be: a Bandit is a stealth hull and it is not on the wire from across the room, so a
// spot chosen from what the pilot can SEE puts the pilot inside the aggro of the one
// hostile it cannot find. Every slot is known here exactly.
import { PEN_SLOTS } from '../shared/devmap.js';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

// A FREE port, asked of the operating system rather than picked, for the reason
// test/ring-live.mjs already writes down: other agents have servers up on this box.
const PORT = await new Promise(res => {
  const p = net.createServer();
  p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => res(port)); });
});
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-orbs-'));
fs.mkdirSync(path.join(SAND, 'data'));
for (const d of ['public', 'shared', 'node_modules']) fs.symlinkSync(path.join(ROOT, d), path.join(SAND, d));
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: SAND, env: { ...process.env, PORT: String(PORT), DEV_ADMIN: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
const done = () => { try { srv.kill('SIGKILL'); } catch {} fs.rmSync(SAND, { recursive: true, force: true }); };
process.on('exit', done);
await wait(1800);
console.log(`\nserver on ${PORT}`);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
const base = newBase();
let me = null, myId = null, snap = null, mapId = null, deaths = 0;
// What the socket has told us this window. Reset between phases.
let win = null;
const send = o => ws.send(JSON.stringify(o));
const say = t => send({ t: 'chat', text: t });
const ready = new Promise(r => ws.on('open', () => { send({ t: 'join', name: 'orbcheck', co: 'm' }); r(); }));

ws.on('message', raw => {
  // Bytes off the socket, so the wire numbers below are measured rather than
  // reasoned about. Framing is not in this — it is the payload — which is the same
  // basis shared/net.js quotes its per-stream costs on.
  if (win) win.bytes += (raw.length ?? Buffer.byteLength(String(raw)));
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { myId = m.id; mapId = m.map; return; }
  if (m.t === 'map') { mapId = m.map; base.map = null; base.ready = false; return; }
  // DESTROYED, and it happens: a Bandit throws 195 dps and a starter hull is 1,100
  // points. It cost this file two runs to see, because a wreck is not sent a ship row
  // — `me` simply stops moving — so the harness went on reporting a pilot standing in
  // front of a Bandit while the ship was in fact four sectors away at its own hangar,
  // and read the whole window as "the Bandit never fired". It respawns at once and
  // says how many times it had to.
  if (m.t === 'dead') { deaths++; send({ t: 'respawn' }); return; }
  if (m.t !== 's' && m.t !== 'd') return;
  snap = m.t === 's' ? (absorbFull(base, m), m) : decodeDelta(base, m);
  me = (snap.ships ?? []).map(unpackShip).find(s => s.id === myId) ?? me;
  if (!win) return;
  const balls = (snap.orbs ?? []).map(unpackOrb);
  win.ticks++;
  // Contamination, and it asks for a TARGET as well as a range. A Thresher reaches
  // 900px and a pilot 800px from one is not being shot at unless the Thresher has
  // decided to — `tgt` is on the wire, so the honest question is "is anything else
  // both in range and engaged", not "is anything else nearby".
  // HOW MANY OF EACH KIND ARE ACTUALLY IN THE ROOM, which is the question a
  // neighbour list keyed on "not the kind under test" cannot ask. A Corsair Hive
  // broods BANDITS, so a second Bandit is invisible to every contamination test that
  // filters by kind — and it read a Bandit at 1,277 dps of a book 195.
  {
    const count = new Map();
    for (const r of (snap.ships ?? []).map(unpackShip))
      if (r.id !== myId && ALIENS[r.hull]) count.set(r.hull, (count.get(r.hull) ?? 0) + 1);
    for (const [k, n] of count) win.most.set(k, Math.max(win.most.get(k) ?? 0, n));
  }
  if (me) for (const o of nearMe(win.kind))
    if (o.tgt && Math.hypot(o.x - me.x, o.y - me.y) <= (ALIENS[o.hull].attrs.weaponRange ?? 0)) { win.dirty++; break; }
  win.orbs += balls.length;
  win.peak = Math.max(win.peak, balls.length);
  for (const o of balls) {
    win.radii.add(o.r);
    win.speeds.add(o.v);
    // A parked orb, tracked by where it is: a caltrop that reaches the client with
    // v === 0 must be at the SAME place next tick, or `v` is a decoration and the
    // client is dead-reckoning a hazard away from its own hit disc.
    if (o.v === 0) {
      const key = `${o.x}:${o.y}:${o.r}`;
      win.parked.set(key, (win.parked.get(key) ?? 0) + 1);
    }
  }
  // Floating damage numbers, counted ON THEIR FIRST FRAME, which is what `p` is for.
  //
  // test/ring-live.mjs deduplicates on a key instead and warns that p === 0 matches
  // nothing — the tick steps a hit before it builds the snapshot, so the wire never
  // sees a zero. Both halves of that are true and the CONCLUSION does not survive a
  // volley: four caltrops landing on one stationary pilot make four hit records at the
  // same place carrying the same number, so they share a key, and one slot of
  // last-seen `p` oscillates between them and counts one every tick for the whole
  // 0.95s life of the numbers. It read a Bandit at 1,273 dps of a book 195.
  //
  // The first frame is exact instead: a hit is created with t === ttl and stepped once
  // before it is packed, so its first `p` on the wire is dt / 0.95 = 0.035, which
  // packHit fixes to 0.04. Nothing else is ever that low — the second frame is 0.07 —
  // and four simultaneous hits all arrive at 0.04 and are all counted, which is the
  // case the key could not express.
  for (const h of (snap.hits ?? []).map(unpackHit)) {
    if (h.p > 0.05) continue;                         // not its first frame
    if (h.mine === 1) continue;                       // nothing we caused; we never fire
    if (me && Math.hypot(h.x - me.x, h.y - me.y) < 160) win.took += h.n;
  }
});

await ready;
await wait(900);
// A BULWARK, BARE. Not for the guns — this pilot never fires — but for the pool: a
// Bandit throws 195 dps and a starter Hauler is 1,100 points, so the first run of this
// file measured a Bandit that "never fired" at a pilot that was in fact dead. 3,300
// points and a heal every quarter second is a ship that stays in front of the thing
// being measured. Nothing is installed, so its speed is the shop's 250 px/s and the
// weave below is what a hull off the forecourt can actually do.
say('/money 9999999');
say('/ship bulwark');
await wait(500);
send({ t: 'hull', key: 'bulwark' });
await wait(700);
say('/dev');
await wait(1500);
console.log(`  in ${mapId} flying a ${me?.hull ?? '?'}`);

const rowFor = kind => (snap?.ships ?? []).map(unpackShip).find(s => s.hull === kind);
// Everything else on the firing line, from the MAP. A Bandit is quiet from the front
// and is simply not on the wire from across the room, so a neighbour list built out of
// what the pilot can see leaves out the one that matters most.
const others = kind => PEN_SLOTS.filter(s => s.kind !== kind);
// And what is actually shooting at the pilot right now, which is the wire's job.
const nearMe = kind => (snap?.ships ?? []).map(unpackShip)
  .filter(s => s.id !== myId && s.hull !== kind && ALIENS[s.hull]);

// WHERE TO STAND SO ONLY ONE OF THEM COMES, and this is the whole reason the file
// picks a bearing instead of using a fixed one.
//
// The testing ground posts its hostiles PEN_GAP apart — the widest aggro radius plus
// sixty — so walking up to one pulls one. Standing OFF one at its own fighting range
// does not: the first draft of this file held station 448px out along the radial from
// the dock, which is straight at the next column, and it measured a Drifter at 485 dps
// with 60px orbs on the wire. That was a Leviathan. So the spot is chosen by scanning
// the ring and taking the bearing that leaves the most room, in units of the
// neighbour's OWN aggro rather than in pixels — a Bandit hears you from 520 and an
// Ironhusk from 460, and the margin that matters is the one that decides.
const cleanSpot = (foe, dist, kind) => {
  let best = null, bestSlack = -Infinity;
  for (let i = 0; i < 48; i++) {
    const ang = (i / 48) * Math.PI * 2;
    const x = foe.x + Math.cos(ang) * dist, y = foe.y + Math.sin(ang) * dist;
    let slack = Infinity;
    for (const o of others(kind))
      slack = Math.min(slack, Math.hypot(o.x - x, o.y - y) - (ALIENS[o.kind].aggro ?? 0));
    if (slack > bestSlack) { bestSlack = slack; best = { x, y, slack }; }
  }
  return best ?? { x: foe.x + dist, y: foe.y, slack: 0 };
};

// One window of measurement. `move` is called every 250ms and returns where to point
// the ship; null means hold still. The pilot is healed every half second, because
// every claim below is about the WEAPON and a wreck measures how long it lived.
//
// `dirty` counts the ticks another hostile was inside its OWN weapon range of the
// pilot, which is the only way a number here can be somebody else's. It is reported
// rather than assumed away.
const phase = async (kind, secs, move) => {
  const died0 = deaths;
  win = { ticks: 0, orbs: 0, peak: 0, took: 0, dirty: 0, bytes: 0, most: new Map(),
          radii: new Set(), speeds: new Set(), parked: new Map(), kind };
  const steps = Math.round(secs * 4);
  for (let i = 0; i < steps; i++) {
    const to = move(i);
    if (to) send({ t: 'intent', mode: 'pt', x: to.x, y: to.y });
    say('/heal');            // every quarter second: this measures the weapon, not a wreck
    await wait(250);
  }
  const out = win; win = null;
  return { ...out, died: deaths - died0, dps: out.took / secs,
           kibs: out.bytes / 1024 / secs, avg: out.orbs / Math.max(1, out.ticks) };
};

const SECS = 40;
const table = {};
for (const kind of ['drifter', 'harrier', 'bandit']) {
  const def = ALIENS[kind];
  const hold = standOff({ def, stats: def.attrs }) * 0.7;
  // BACK TO THE DOCK FIRST, and it is not tidiness. `/dev` out and in again clears the
  // pilot's contacts and puts them in the middle of the room, which is the only place
  // the whole firing line is inside a starter hull's radar — the room is laid out
  // around that promise. Without it the second hostile was never on the wire at all:
  // the first one had been walked 2,644px out of the pen and nothing else was in
  // sensor range to be found.
  say('/dev'); await wait(1200); say('/dev'); await wait(1400);
  // AND THE FIELD IS CLEARED BEFORE THE FLIGHT AS WELL AS AFTER IT. The route from
  // the dock to a slot on the firing line goes past other slots, and a bare Bulwark
  // that flies past a Thresher is a wreck: the pilot died on the way to the Bandit,
  // respawned at its own hangar four sectors away, and the harness went on sending
  // dev-map waypoints into the home sector and reported a Bandit that never fired.
  // Cleared first, the sector is empty for the eight seconds the crossing takes.
  say('/clear'); await wait(600);
  // THE SPOT IS CHOSEN ONCE, OFF THE POST IN devmap.js, and then held. Two reasons
  // it is not chosen off the wire: a Bandit is not on the wire from across the room,
  // and recomputing it every step walks the pair out of the pen — the hostile closes
  // on the pilot, the next best bearing is further out, and the two of them drift
  // until nothing else is in radar. Fixed, the hostile comes to its own standoff and
  // the fight stays inside the room.
  const post = PEN_SLOTS.find(s => s.kind === kind);
  const at = cleanSpot(post, hold, kind);
  let arrived = false;
  for (let k = 0; k < 80 && !arrived; k++) {
    // A death on the way puts the pilot in its own home sector, and a dev-map waypoint
    // sent from there flies it somewhere irrelevant for the rest of the run. Back in,
    // and start the crossing again.
    if (mapId !== 'dev') { say('/dev'); await wait(1400); say('/clear'); await wait(600); }
    send({ t: 'intent', mode: 'pt', x: at.x, y: at.y });
    say('/heal');
    await wait(300);
    arrived = !!me && mapId === 'dev' && Math.hypot(me.x - at.x, me.y - at.y) < 90;
  }
  check(`the pilot is standing in front of the ${ALIENS[kind].name}`, arrived,
    arrived ? `${Math.round(hold)}px off its post with ${Math.round(at.slack)}px of room to the next slot`
            : `never got there — ${mapId}, ${Math.round(me?.x)},${Math.round(me?.y)} against ${Math.round(at.x)},${Math.round(at.y)}`);
  // AND THE FIELD IS CLEARED ONCE THE PILOT IS ALREADY STANDING THERE, which is the
  // order that matters and it took three runs to see. Clearing first and then flying
  // in reads a Drifter at 124 dps of a book 49.5: the flight from the dock to the spot
  // crosses other aggro radii on the way, and everything it woke up comes with it and
  // keeps shooting from off-camera — a Bandit doing it invisibly, because a stealth
  // hull is not on the wire to be noticed. Cleared from the spot, everything comes
  // back at its own post with no target, and the only one that can reach the pilot is
  // the one whose post is `hold` away.
  say('/clear');
  // HELD AND HEALED THROUGH THE RESPAWN WAIT, not slept through. A Bandit is forty
  // seconds of respawn and a bare Bulwark parked in the firing line with nothing
  // holding its hull up does not last that long once the field comes back — the pilot
  // was found 1,594px from the post with the run already half over, and the window it
  // then measured was of an empty sector.
  for (let k = 0; k < Math.max(10, (def.respawn + 3) * 4); k++) {
    if (mapId !== 'dev') { say('/dev'); await wait(1400); }
    send({ t: 'intent', mode: 'pt', x: at.x, y: at.y });
    say('/heal');
    await wait(250);
  }
  {
    const row = rowFor(kind);
    console.log(`  ${ALIENS[kind].name}: post ${Math.round(post.x)},${Math.round(post.y)}  ` +
      `pilot ${Math.round(me?.x)},${Math.round(me?.y)}  ${Math.round(Math.hypot((me?.x ?? 0) - post.x, (me?.y ?? 0) - post.y))}px ` +
      `off its post against a ${Math.round(hold)}px standoff and ${def.aggro}px of aggro — ` +
      `${row ? `on the wire at ${Math.round(row.x)},${Math.round(row.y)}` : 'NOT on the wire'}`);
  }
  const parked = await phase(kind, SECS, () => at);
  // And the same spot, reversing across the line of fire every 0.75s. The claim
  // bench's own kite policy, and the honest floor for a pilot who is reading what is
  // coming at them. 150px, which is inside the margin cleanSpot found, so weaving
  // cannot walk the pilot into somebody else's aggro.
  const ang = Math.atan2(at.y - post.y, at.x - post.x);
  const weaving = await phase(kind, SECS, i => {
    const side = Math.floor(i / 3) % 2 ? 1 : -1;
    return { x: at.x + Math.cos(ang + Math.PI / 2) * 150 * side,
             y: at.y + Math.sin(ang + Math.PI / 2) * 150 * side };
  });
  table[kind] = { parked, weaving, hold, slack: Math.round(at.slack ?? 0) };
  say('/heal');
  await wait(600);
}

const book = k => ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate;
const fmtSet = s => `[${[...s].sort((a, b) => a - b).join(' ')}]`;

console.log('\nwhat each of them costs, off the wire');
console.log('     hostile      book   parked  weaving   orbs avg/peak (parked | weaving)   KiB/s   radii   speeds');
for (const [kind, r] of Object.entries(table))
  console.log(`     ${ALIENS[kind].name.padEnd(10)} ${book(kind).toFixed(1).padStart(6)}  ` +
    `${r.parked.dps.toFixed(1).padStart(7)} ${r.weaving.dps.toFixed(1).padStart(7)}   ` +
    `${(r.parked.avg.toFixed(1) + '/' + r.parked.peak).padStart(12)} | ` +
    `${(r.weaving.avg.toFixed(1) + '/' + r.weaving.peak).padEnd(12)} ` +
    `${r.weaving.kibs.toFixed(2).padStart(6)}   ` +
    `${fmtSet(r.weaving.radii).padEnd(7)} ${fmtSet(r.weaving.speeds).padEnd(8)}` +
    `\n        ${r.slack}px to the next slot, ${r.parked.dirty + r.weaving.dirty} of ` +
    `${r.parked.ticks + r.weaving.ticks} ticks with anything else engaged in range, ` +
    `${r.parked.died + r.weaving.died} deaths` +
    `\n        in the room: ${[...r.weaving.most].map(([k, n]) => `${n}x${k}`).join(' ')}`);

check('nothing but the hostile under test was ever in range of the pilot',
  Object.values(table).every(r => r.parked.dirty === 0 && r.weaving.dirty === 0),
  'the testing ground posts its firing line one aggro radius apart, and the spot is chosen for the ' +
  'bearing with the most room — ' +
  Object.entries(table).map(([k, r]) => `${ALIENS[k].name} ${r.slack}px of margin`).join(', '));

check('all three of them reach a client as a pattern rather than as a bolt',
  Object.entries(table).every(([k, r]) =>
    r.parked.orbs > 0 && r.parked.radii.has(orbsOf(ALIENS[k]).r)),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${r.parked.avg.toFixed(1)} on the wire at ${orbsOf(ALIENS[k]).r}px`).join(', ') +
  ' — and `r` off the wire is the radius stepOrbs collides with, which is the whole reason it is a field');

check('a pilot who does not move still pays what the threat file quotes',
  Object.entries(table).every(([k, r]) => r.parked.dps > book(k) * 0.85),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${r.parked.dps.toFixed(1)} of a book ${book(k)}`).join(', ') +
  ' — read off the floating damage numbers over a real socket, not out of the simulation');

check('and moving beats every one of them',
  Object.entries(table).every(([, r]) => r.weaving.dps < r.parked.dps * 0.6),
  Object.entries(table).map(([k, r]) =>
    `${ALIENS[k].name} ${r.weaving.dps.toFixed(1)} weaving against ${r.parked.dps.toFixed(1)} parked ` +
    `(${Math.round(100 * r.weaving.dps / Math.max(1, r.parked.dps))}%)`).join(', '));

// THE CALTROPS, and this is the half that only a socket can answer. `v` is derived
// from the velocity on the server and the client dead-reckons at it; a parked orb has
// to arrive at 0 and then still be in the same place next tick.
{
  const b = table.bandit.weaving;
  const still = [...b.parked.entries()].filter(([, n]) => n >= 3).length;
  check('a Bandit\'s caltrops arrive parked and stay where they landed',
    b.speeds.has(0) && still > 0,
    `speeds on the wire [${[...b.speeds].sort((x, y) => x - y).join(' ')}] — ${still} of ` +
    `${b.parked.size} resting places held the same x, y for three ticks or more, over ${stayFor(orbsOf(ALIENS.bandit))}s ` +
    'of standing. A moving orb never repeats a position, so this is the parking and nothing else');
  check('and a moving one is still moving at ORB_SPEED',
    [...table.drifter.parked.speeds].some(v => v === ORB_SPEED),
    `a Drifter's ball reads ${[...table.drifter.parked.speeds].join(' ')} px/s on the wire against ` +
    `ORB_SPEED ${ORB_SPEED} — the client flies it forward at exactly this and a rounding here is a ball ` +
    'drawn somewhere it is not');
}

console.log(fails.length ? `\nFAIL — ${fails.length}: ${fails.join(', ')}\n`
                         : '\nPASS — three patterns, over the wire, and moving beats all of them\n');
ws.close();
done();
process.exit(fails.length ? 1 : 0);
