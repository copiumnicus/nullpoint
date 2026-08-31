// The duel — consent, the fold, the countdown, the stake, and every way out.
//
// Two halves, and the second is why this is in `npm test` rather than in a notebook.
//
// The first half is offline and instant: the sector's shape, the refusals, the
// stake arithmetic and the one predicate that decides whether a pilot may be shot
// at. All of it is imported from shared/, so nothing here is a second copy of a
// rule the game plays by.
//
// The second half boots a real server on a port the OS says is free and drives TWO
// real sockets through the whole thing: the challenge, the refusal, the fold, a
// fold BROKEN by a hit, both pilots landing in one instanced sector, a countdown
// that refuses every intent, a kill by actual gunfire, the pods, the scoop, the
// portal home, a forfeit, and — last and most important — the sector closing.
//
// An arena is a sector that exists only while somebody is standing in it, so "did
// it close" is not a question any offline test can ask, and a duel that outlived
// its two pilots would be a sector stepped thirty times a second forever. That is
// worth the seconds it costs the suite.

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAPS, MAP_W, MAP_H, mapOf, arenaId, parseArena, isArena,
         ARENA_KEYS, CLAIM_KEYS } from '../shared/maps.js';
import { boundsOf, sizeOf, driftDepth, WORLD, JUMP_TIME } from '../shared/sim.js';
import { HULLS } from '../shared/ships.js';
import { tollOn, DEATH_TOLL, isBond, BOND, podName, podColour, MATERIALS } from '../shared/cargo.js';
import { FOLD_SECS, foldBroken, newFold, foldPct, brokenText,
         FOLD_PORT, FOLD_CLAIM, FOLD_DUEL } from '../shared/fold.js';
import { DEVICES } from '../shared/devices.js';
import { DUEL_KEY, DUEL_W, DUEL_H, START_SEP, startsAt, homePortal, HOME_TO,
         COUNT, counting, mayAim, LIMIT, LINGER, CHALLENGE_TTL, CHALLENGE_CD,
         whyNotChallenge, stakeCredits, stakeOf, STAKE_RATE, PAYS,
         duelText, challengeText, isDuelMap } from '../shared/duel.js';
import { bar, BAR_TOP, BAR_LOW, BAR_H, HUD_LEFT, HUD_RIGHT } from '../shared/arena.js';
import { COMMANDS } from '../shared/chat.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const n = x => Math.round(x).toLocaleString('en-US');
const began = Date.now();

// ============================================================================
// the shape of the place
// ============================================================================
console.log('\nthe sector, and it is a quarter of a real one');
{
  const id = arenaId('anybody', DUEL_KEY);
  const m = mapOf(id);
  check('a duel is an instanced sector, so it is not in MAPS and not on the chart',
    isArena(id) && parseArena(id).key === DUEL_KEY && !MAPS[id] && !!m,
    'two pairs of pilots duelling are in different sectors, and neither can see the other');
  check('and it is a quarter of the galaxy’s sector BY AREA, which is what the designer asked for',
    m.w * m.h === (MAP_W * MAP_H) / 4 && m.w === MAP_W / 2 && m.h === MAP_H / 2,
    `${n(m.w)} x ${n(m.h)} against ${n(MAP_W)} x ${n(MAP_H)} — half of each side, a quarter of the area`);
  check('the same aspect, so the minimap needs no second shape',
    Math.abs((m.w / m.h) - (MAP_W / MAP_H)) < 1e-9, '3:2 either way');

  // THE SIZE TRAVELS WITH THE MAP. This is the assertion that matters: the server
  // clamps a course with boundsOf() and the client draws its minimap from sizeOf(),
  // so a sector reporting one size to one of them is the bug rule one exists for.
  const B = boundsOf(m);
  check('the size travels with the sector rather than being a global',
    B.x1 === m.w && B.y1 === m.h && B.x0 === 0 && B.y0 === 0
    && sizeOf(m).w === m.w && sizeOf(m).h === m.h,
    `bounds ${JSON.stringify(B)} — the same rectangle the client draws and the server clamps`);
  check('and every other sector still answers with the galaxy’s, unchanged',
    boundsOf(MAPS.m1) === WORLD && sizeOf(MAPS.m1).w === MAP_W
    && boundsOf(mapOf(arenaId('x', 'mine1'))) === WORLD,
    `a claim is still ${n(MAP_W)} x ${n(MAP_H)}: its ring and its roster were measured in one`);

  // The wall, and why it is a wall rather than the shear.
  check('its edge is a hard wall, not the drift lattice — a duel is decided by guns',
    m.wall === true && driftDepth(m.w + 5000, m.h + 5000, m) === 0
    && driftDepth(MAP_W + 500, 0) > 0,
    'shoving somebody over a line into 2,000 hull/s is not a gunfight, it is a shove');

  const a = startsAt(0), b = startsAt(1);
  const gap = Math.hypot(a.x - b.x, a.y - b.y);
  const radars = Object.values(HULLS).map(h => h.attrs?.radar ?? h.radar).filter(Boolean);
  const guns = Object.values(HULLS).map(h => h.attrs?.weaponRange ?? h.weaponRange).filter(Boolean);
  check('they start facing each other, inside every radar and outside every gun',
    gap === START_SEP && Math.min(...radars) > gap * 0.9 && gap > Math.max(...guns),
    `${n(gap)}px apart — the shortest radar is ${n(Math.min(...radars))}, the longest gun ${n(Math.max(...guns))}`);
  check('and both of them start on the middle line, so neither has the better corner',
    a.y === b.y && a.y === DUEL_H / 2 && Math.abs(a.x - DUEL_W / 2) === Math.abs(b.x - DUEL_W / 2),
    'symmetry is the only fair opening a fixed sector can offer');

  const p = homePortal();
  check('the way home is dead centre, equidistant from both starts',
    m.portals.length === 1 && p.x === DUEL_W / 2 && p.y === DUEL_H / 2
    && Math.hypot(p.x - a.x, p.y - a.y) === Math.hypot(p.x - b.x, p.y - b.y),
    'running for it means running past the other one');
  check('and it names a sentinel rather than a map, because it sends each of them somewhere different',
    m.portals[0].to === HOME_TO && !MAPS[HOME_TO] && !!m.portals[0].tint && m.portals[0].home === true,
    'a portal with its own tint, because MAPS[undefined].tint is the black screen');
  check('a claim still has no portals at all, which is what the client’s guard was written for',
    mapOf(arenaId('x', 'mine1')).portals.length === 0,
    'you cannot walk out of a claim, and that has not changed');
  check('a duel is an instanced sector that is deliberately not a claim',
    ARENA_KEYS.includes(DUEL_KEY) && !CLAIM_KEYS.includes(DUEL_KEY),
    `${ARENA_KEYS.length} instanced templates, ${CLAIM_KEYS.length} of them rocks`);
}

// ============================================================================
// the fold, which is now one mechanic with three destinations
// ============================================================================
console.log('\nfolding, and the one number behind all three of them');
{
  check('there is exactly one fold time, and the Recall Beacon reads it',
    DEVICES.recall.secs === FOLD_SECS && FOLD_SECS === 5,
    `${FOLD_SECS}s — the beacon is one caller of the general fold now, not the owner of it`);
  check('a fold carries a DESTINATION rather than a device key',
    [FOLD_PORT, FOLD_CLAIM, FOLD_DUEL].every(k => typeof brokenText(k) === 'string')
    && newFold({ kind: FOLD_CLAIM, key: 'mine1' }, 9).to.key === 'mine1',
    'a hangar, a claim and a duel are three destinations for one mechanic');
  // The beacon's own claims, rewritten rather than deleted: they still hold,
  // because the beacon still runs exactly this fold.
  check('a fold is broken by any hit at all',
    foldBroken(0.01, 4.0, 500) === true && foldBroken(4.1, 4.0, 500) === false,
    'sinceHit only ever counts UP unless something lands, so a drop in it IS a hit');
  check('and by dying',
    foldBroken(9, 4, 0) === true && foldBroken(9, 4, -1) === true,
    'no separate signal needed from any of the six things that can kill you');
  check('it reports how far through it is, so other pilots watch it happen',
    foldPct(newFold({ kind: FOLD_PORT }, 0)) === 0
    && foldPct({ left: 1, secs: 5 }) === 0.8 && foldPct(null) === 0,
    'the wire carries this as `wrp`, which is why a fold is not a vanishing');
}

// ============================================================================
// consent
// ============================================================================
console.log('\nconsent, and every reason it is refused');
{
  const ok = { token: 'a', name: 'Ash', online: true };
  const them = { token: 'b', name: 'Bly', online: true };
  check('two pilots minding their own business may fight',
    whyNotChallenge(ok, them) === null, '/1v1 Bly');
  check('you cannot duel yourself',
    !!whyNotChallenge(ok, { ...ok }), whyNotChallenge(ok, { ...ok }));
  check('you cannot duel somebody who is not there',
    !!whyNotChallenge(ok, null), whyNotChallenge(ok, null));
  // Each of these is a different thing a pilot must not be pulled out of.
  for (const [k, why] of [['dead', 'a wreck chooses when to go back out'],
                          ['inArena', 'a claim is a fight already being paid for'],
                          ['duelling', 'somebody else already consented to that one'],
                          ['folding', 'two destinations is a bug, not a duel'],
                          ['jumping', 'a portal is a 1.6s commitment'],
                          ['lobby', 'there is no ship to fight with yet']]) {
    const bad = { ...them, [k]: true };
    check(`nobody can be pulled out of ${k}`, !!whyNotChallenge(ok, bad), why);
    check(`and you cannot start one from ${k} either`,
      !!whyNotChallenge({ ...ok, [k]: true }, them), 'the clause is symmetric');
  }
  // REWRITTEN. This was "nobody can be pulled out of docked", on the argument that a
  // dock is a haven so the fold could never be cancelled. That has the fold's
  // purpose backwards: cancel-on-damage exists so a teleport cannot be an ESCAPE
  // from a fight you are losing. A duel is the opposite journey — you are leaving
  // somewhere safe on purpose to go and be shot at by somebody who agreed — so an
  // uncancellable fold out of a dock costs nobody anything. It was a rule
  // protecting a mechanic rather than protecting a pilot.
  check('you may arrange a duel from your own dock, and fold straight out of it',
    whyNotChallenge({ ...ok, docked: true }, { ...them, docked: true }) === null,
    'both sitting in their own rings — there is nothing to escape and nobody to escape');

  check('a challenge is refusable, and refusing it buys you a minute of quiet',
    CHALLENGE_TTL === 30 && CHALLENGE_CD === 60 && CHALLENGE_CD > CHALLENGE_TTL,
    `it lapses in ${CHALLENGE_TTL}s and cannot be repeated for ${CHALLENGE_CD}s`);
  check('and it is refused while a cooldown is running',
    !!whyNotChallenge(ok, them, { cooling: 12 }), whyNotChallenge(ok, them, { cooling: 12 }));
  check('one outstanding challenge at a time, so nobody can line every screen in the game',
    !!whyNotChallenge(ok, them, { pending: true }), whyNotChallenge(ok, them, { pending: true }));
  check('the commands are open to everyone — PvP is not an admin toy',
    COMMANDS['1v1'].admin === false && COMMANDS.accept.admin === false
    && COMMANDS.decline.admin === false,
    'consent on both ends is the gate, not a permission');
}

// ============================================================================
// who may be shot, and where
// ============================================================================
console.log('\nPvP is a property of the sector and never of the ship');
{
  const foe = { co: 'm', id: 7 };
  check('a hostile may be shot anywhere, as it always could',
    mayAim({ co: 'x', id: 3 }, {}) === true, 'nothing about the open world changed');
  check('another pilot may NOT be shot outside a duel, whatever id arrives on the wire',
    mayAim(foe, {}) === false && mayAim(foe, { foeId: null }) === false,
    'two pilots of one company must stay untouchable everywhere else');
  check('and only THAT pilot inside one — a third id is refused',
    mayAim(foe, { foeId: 7 }) === true && mayAim({ co: 'm', id: 8 }, { foeId: 7 }) === false,
    'the seat is the permission, not the sector alone');
  check('nobody may be shot while the countdown is running',
    mayAim(foe, { foeId: 7, count: 0.01 }) === false && mayAim(foe, { foeId: 7, count: 0 }) === true,
    `${COUNT}s where the guns do not answer`);
  check('the countdown is five seconds, and `counting` is one reading of it',
    COUNT === 5 && counting({ count: 0.5 }) && !counting({ count: 0 }) && !counting(null),
    'the client draws this number; the server owns it');
  check('a duel sector says so about itself, and no other sector does',
    isDuelMap(mapOf(arenaId('x', DUEL_KEY))) && !isDuelMap(mapOf(arenaId('x', 'mine1')))
    && !isDuelMap(MAPS.m1) && !isDuelMap(null),
    'the same shape noLeash uses, so an Ironhusk is still an Ironhusk');
}

// ============================================================================
// the stake
// ============================================================================
console.log('\nthe stake, which is not a new number');
{
  check('it is exactly what dying already costs, read off the same function',
    stakeCredits(1_000_000) === tollOn(1_000_000) && STAKE_RATE === DEATH_TOLL,
    `a tenth — ${n(tollOn(1_000_000))} cr of a million, and the hold on top`);
  check('and the hold goes with it, which is the other half of an ordinary death',
    JSON.stringify(stakeOf(500, { iron: 4, gold: 0 })) === JSON.stringify({ cr: 50, hold: { iron: 4 } }),
    'empty stacks are dropped rather than dropped as empty pods');
  // The number the brief asked for, out loud.
  const rich = 20_000_000;
  check('at a realistic bankroll it is a large number, and it is NOT capped',
    stakeCredits(rich) === 2_000_000
    && stakeCredits(rich * 10) === stakeCredits(rich) * 10,
    `${n(stakeCredits(rich))} cr at ${n(rich)} — about ten hours at 55 cr/s, and the same tenth `
    + 'they already carry into every hostile sector. A cap would make duelling safer than flying');
  check('it can never take the last of it, so a duel is a setback and not an ejection',
    stakeCredits(9) === 0 && stakeCredits(0) === 0 && stakeCredits(-5) === 0,
    'the floor is tollOn’s, not a second rule');
  check('a duel pays no bounty, no experience, no ore and nothing to the threat file',
    PAYS.bounty === false && PAYS.xp === false && PAYS.ore === false && PAYS.file === false,
    'two accounts levelling each other was the obvious exploit, and it is simply not implemented');
  check('what it pays is a TRANSFER, which is why there is nothing to farm',
    PAYS.stake === true,
    'the loser’s tenth arrives in the winner’s hold. Nothing is minted, so a thousand '
    + 'duels between two accounts move money that already existed');
  check('the challenge says the number before anybody answers',
    challengeText('Ash', stakeOf(rich)).includes(n(stakeCredits(rich))),
    'an uncapped stake is only fair if nobody can accept one blind');
}

// ============================================================================
// a pod that is not ore
// ============================================================================
console.log('\nthe purse, and why it is not a seventh metal');
{
  const bond = { id: 1, x: 0, y: 0, mat: BOND.key, n: 0, cr: 50_000 };
  const iron = { id: 2, x: 0, y: 0, mat: 'iron', n: 4, cr: 0 };
  check('a bond is a pod, so the winner picks it up rather than being handed it',
    isBond(bond) && !isBond(iron) && !isBond(null), 'the designer asked for something to collect');
  check('and it is not in MATERIALS, because credits have no volume, density or refinery rung',
    !MATERIALS[BOND.key] && podName(bond) === BOND.name && podColour(bond) === BOND.colour,
    'a seventh metal would give all four of those a meaningless answer');
  check('everything that asks a pod what it is still gets an answer for both kinds',
    podName(iron) === 'Iron' && podColour(iron) === MATERIALS.iron.colour
    && podName({ mat: 'nonsense' }) === 'salvage',
    'six places read MATERIALS[pod.mat] and would have drawn `undefined` in #888');
}

// ============================================================================
// what it says on screen
// ============================================================================
console.log('\nthe bar, which is the claim bar with different words in it');
{
  for (const W of [900, 1100, 1280, 1600, 1920, 2560]) {
    const states = [
      { count: 4, foe: 'Bly' }, { count: 0, foe: 'Bly', left: 287 },
      { over: true, won: true, foe: 'Bly' }, { over: true, won: false, foe: 'Bly' },
      { over: true, draw: true, foe: 'Bly' },
    ];
    const bad = states.map(st => bar(W, duelText(st)))
      .filter(b => !(b.h === BAR_H && (b.y === BAR_TOP || b.y === BAR_LOW)
                     && b.x >= 0 && b.x + b.w <= W && b.text && !/undefined|NaN/.test(b.text)
                     // never grows over either HUD column at the height it chose
                     && (b.y === BAR_LOW ? b.x >= HUD_RIGHT - 1 : b.x >= HUD_LEFT - 1
                         || b.w >= W - 32)));
    check(`every duel line fits its own box at ${W}px`, bad.length === 0,
      bad.length ? JSON.stringify(bad[0]) : `${states.length} states, the longest is `
        + `"${bar(W, duelText(states[0])).text}"`);
  }
  check('a duel that is over says who won, and a draw says nothing changed hands',
    duelText({ over: true, won: true, foe: 'B' }).tone === 'won'
    && duelText({ over: true, draw: true }).forms[0].includes('NOTHING CHANGES HANDS')
    && duelText({ over: true, won: false, foe: 'B' }).forms[0].includes('LOST'),
    'three different endings, and a pilot can tell which one happened');
  check('shields do not come back in here, so somebody has to commit',
    // Asserted through the same argument the server passes: `dry` is "you are in an
    // instanced sector", and a duel is one. Two pilots who could both heal in a
    // 6,000px box have a dominant line, and it is to kite until the wall.
    isArena(arenaId('x', DUEL_KEY)),
    'regeneration is 3.33% of the pool a second — half a minute to refill a finished '
    + 'ship, and five minutes of box to do it in');
  check('the wall is five minutes and the linger is long enough to scoop what fell out',
    LIMIT === 300 && LINGER === 12 && LINGER > 2,
    `${LIMIT / 60} minutes before it is a draw, ${LINGER}s afterwards — a pod’s tractor is 0.9s`);
}

const simSecs = (Date.now() - began) / 1000;

// ============================================================================
// two real sockets, one real server
// ============================================================================
const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');

// A port the OS says is free rather than one picked in advance. A hard-coded number
// turned fourteen assertions red the first time something else on the machine
// happened to be holding it, and every one of them blamed the feature.
const freePort = () => new Promise((res, rej) => {
  const probe = net.createServer();
  probe.on('error', rej);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => res(port)); });
});
const PORT = Number(process.env.DUEL_PORT) || await freePort();

const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-duel-'));
fs.mkdirSync(path.join(SAND, 'data'));
for (const d of ['public', 'shared', 'node_modules'])
  fs.symlinkSync(path.join(ROOT, d), path.join(SAND, d));

let srv = null;
const boot = () => {
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: SAND, env: { ...process.env, PORT: String(PORT), DEV_ADMIN: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
};
const kill = () => { try { srv?.kill('SIGKILL'); } catch {} };
const done = () => { kill(); fs.rmSync(SAND, { recursive: true, force: true }); };
process.on('exit', done);

class Pilot {
  constructor(name, token = null) {
    this.name = name; this.map = null; this.bag = {}; this.said = []; this.notes = [];
    this.dead = null; this.ended = []; this.challenged = [];
    this.ready = new Promise(r => { this._ready = r; });
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/${token ? `?t=${token}` : ''}`);
    this.ws.on('open', () => { if (!token) this.send({ t: 'join', name, co: 'm' }); });
    this.ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'welcome') { this.id = m.id; this.token = m.token ?? token; this.map = m.map; this._ready(); return; }
      if (m.t === 'map') { this.map = m.map; return; }
      if (m.t === 'chat') { this.said.push(m.text); return; }
      if (m.t === 'challenge') { this.challenged.push(m); return; }
      if (m.t === 'duelend') { this.ended.push(m); return; }
      if (m.t === 'dead') { this.dead = m; return; }
      // Only keyframes are read: every place this test reads the bag has just asked
      // for one, so there is no baseline to keep and no decoder to get wrong.
      if (m.t === 's') this.bag = m;
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  chat(text) { this.send({ t: 'chat', text }); }
  close() { try { this.ws.close(); } catch {} }
}
const join = async (name, token = null) => {
  const p = new Pilot(name, token);
  const got = await Promise.race([p.ready.then(() => true), wait(8000).then(() => false)]);
  if (!got) check(`the test server answered ${name}`, false, `nothing on port ${PORT}`);
  return p;
};
const snap = async p => { p.bag = {}; p.send({ t: 'need' }); await wait(250); return p.bag; };
const rowOf = (bag, id) => (bag.ships ?? []).find(r => r[0] === id);
// Folding is FOLD_SECS plus a few ticks of slack, read off the constant so moving
// the fold moves the test with it rather than leaving a magic number behind.
const FOLD_WAIT = FOLD_SECS * 1000 + 600;
// Ask what instanced sectors are open. It is the only visibility there is: a duel
// is not in MAPS, not on the chart, and only its two pilots can ever see one.
const arenas = async p => {
  p.said.length = 0; p.chat('/arenas'); await wait(300);
  try { return JSON.parse(p.said.at(-1)); } catch { return { open: -1, list: [] }; }
};

console.log('\ntwo pilots, one server, and every way a duel ends');
boot();
await wait(1600);

{
  const A = await join('Ash'), B = await join('Bly');
  await wait(200);

  // Kit them out at the dock, where a shop is a shop. A finished rack so the fight
  // is seconds rather than half a minute — a starter hauler needs 24 seconds to
  // kill another one, measured, and the suite should not spend that six times.
  A.chat('/money 1000000'); B.chat('/money 500000');
  A.chat('/ship vanguard'); await wait(200);
  A.send({ t: 'hull', key: 'vanguard' }); await wait(200);
  A.chat('/gear emitter5 5'); await wait(200);
  for (let i = 0; i < 5; i++) { A.send({ t: 'install', item: 'emitter5' }); await wait(80); }
  A.chat('/ammo cell5 4000');
  B.chat('/ore iron 40'); await wait(250);
  B.send({ t: 'load', mat: 'iron', n: 40 }); await wait(250);
  A.send({ t: 'ammo', feed: 'laser', key: 'cell5' });
  const heldB = { ...(await snap(B)).hold };

  // --- 0. A CLAIM FOLD THAT BREAKS LEAVES NO ARENA EITHER ------------------
  //
  // Done first because it is the only part that needs a pilot standing in their own
  // ring: a plot is staked at your own dock, and a claim launches from the plot.
  // Everything after this happens out in open space.
  A.send({ t: 'stake' }); await wait(300);
  A.chat('/tolab'); await wait(300);
  A.said.length = 0;
  A.send({ t: 'claim', key: 'mine1' }); await wait(400);
  check('going to a claim is a fold now, not a teleport',
    /folding out/.test(A.said.at(-1) ?? '') && !isArena(A.map),
    `"${A.said.at(-1)}" — an instant, free, uninterruptible ride out of any fight, `
    + 'sitting on the station panel beside a 3,400cr beacon that can be broken');
  A.send({ t: 'dev-damage' }); await wait(FOLD_WAIT);
  check('a claim fold broken by a hit leaves you where you were',
    !isArena(A.map), A.map);
  check('and leaves NO arena open — not one the sweep collects later, none at all',
    (await arenas(A)).open === 0,
    'openArena runs on arrival; a sector standing empty for five seconds is 150 ticks of nothing');

  // --- 1. FROM A HAVEN, WHICH IS ALLOWED ----------------------------------
  // REWRITTEN. This asserted the refusal, on the argument that a fold out of a
  // haven can never be cancelled. That reads the fold backwards: cancel-on-damage
  // stops a teleport being an ESCAPE, and a duel is the opposite journey. Both
  // pilots are leaving somewhere safe on purpose, to be shot at by somebody who
  // agreed. So it is allowed, and the challenge goes out from inside the ring.
  B.said.length = 0; A.challenged.length = 0;
  B.chat('/1v1 Ash'); await wait(350);
  check('a duel can be arranged from inside your own ring',
    A.challenged.length === 1, B.said.at(-1) ?? '(nothing said)');
  check('and still nothing is opened until somebody accepts',
    (await arenas(A)).open === 0, 'a challenge is a line you answer, not a sector');
  // Declined rather than flown, and BLY asks so the 60s cooldown lands on Bly>Ash.
  // The key is directional, so Ash>Bly is still free for the duel below.
  A.chat('/decline'); await wait(250);

  A.chat('/tp m2'); B.chat('/tp m2'); await wait(400);

  // --- 2. THE CHALLENGE ----------------------------------------------------
  A.said.length = 0; B.said.length = 0; B.challenged.length = 0;
  A.chat('/1v1 nobody at all'); await wait(300);
  check('challenging a name nobody flies under says so',
    /nobody is flying/.test(A.said.at(-1) ?? ''), A.said.at(-1));
  const crA0 = (await snap(A)).credits;
  A.chat('/1v1 Bly'); await wait(350);
  check('a challenge reaches the other pilot',
    B.challenged.length === 1 && B.challenged[0].from === 'Ash',
    `${JSON.stringify(B.challenged[0] ?? null)}`);
  check('and it names the stake in credits before they answer',
    B.challenged[0]?.cr === tollOn(crA0)
    && (B.said.find(t => t.includes('challenges you')) ?? '').includes(n(tollOn(crA0))),
    `${n(B.challenged[0]?.cr ?? 0)} cr of Ash’s ${n(crA0)} — nobody accepts blind`);

  // --- 3. A BROKEN FOLD CALLS THE WHOLE THING OFF --------------------------
  B.said.length = 0; A.said.length = 0;
  B.chat('/accept'); await wait(400);
  check('accepting folds BOTH of them, not one',
    /folding out/.test(A.said.at(-1) ?? '') && /folding out/.test(B.said.at(-1) ?? ''),
    `${FOLD_SECS}s each, and one hit calls it off`);
  B.send({ t: 'dev-damage' });                    // something lands on Bly mid-fold
  await wait(FOLD_WAIT);
  check('a fold broken by a hit calls the duel off and NEITHER of them goes',
    !isArena(A.map) && !isArena(B.map),
    'a duel with one seat filled is a pilot alone in an empty sector with no way out');
  check('and both are told why, rather than left wondering if the button worked',
    A.said.some(t => /duel is off|was hit/.test(t)) && B.said.some(t => /fold broke|duel is off/.test(t)),
    `Ash: "${A.said.filter(t => /duel|fold/.test(t)).at(-1)}"`);
  check('a cancelled duel leaves no sector standing',
    (await arenas(A)).open === 0, 'the sector is opened on arrival, so there was never one to leak');

  // --- 5. A REAL DUEL ------------------------------------------------------
  B.challenged.length = 0; A.said.length = 0; B.said.length = 0;
  // Read at the moment it starts, not at setup: staking a plot costs 500,000 and the
  // stake is a share of what you are carrying NOW.
  const crB0 = (await snap(B)).credits, crA1 = (await snap(A)).credits;
  A.chat('/1v1 Bly'); await wait(400);
  B.chat('/accept'); await wait(FOLD_WAIT);
  check('both of them land in ONE instanced sector, and it is the duel sector',
    isArena(A.map) && A.map === B.map && parseArena(A.map).key === DUEL_KEY,
    `${A.map} / ${B.map} — "${A.said.at(-1)}"`);
  const duelId = A.map;
  let open = await arenas(A);
  check('the server reports it as one sector with two seats, both occupied',
    open.open === 1 && open.list[0].duel === true && open.list[0].seats === 2
    && open.list[0].here === 2 && open.list[0].lists === 8,
    JSON.stringify(open.list[0]));

  let bagA = await snap(A);
  check('the countdown is on the wire as a number the server owns',
    bagA.duel && bagA.duel.count > 0 && bagA.duel.count <= COUNT && bagA.duel.foe === 'Bly'
    && bagA.duel.id === B.id,
    `${bagA.duel?.count}s left of ${COUNT} — the client draws this, it does not run a clock`);
  const startA = rowOf(bagA, A.id), startB = rowOf(bagA, B.id);
  check('and they are stood where the geometry says, facing each other',
    Math.abs(Math.hypot(startA[1] - startB[1], startA[2] - startB[2]) - START_SEP) < 3,
    `${n(Math.hypot(startA[1] - startB[1], startA[2] - startB[2]))}px apart`);

  // --- 6. THE COUNTDOWN REFUSES EVERYTHING ---------------------------------
  A.said.length = 0;
  A.send({ t: 'intent', mode: 'pt', x: 200, y: 200 });
  A.send({ t: 'intent', mode: 'dir', dx: -1, dy: -1 });
  A.send({ t: 'target', id: B.id });
  A.send({ t: 'jump' });
  A.send({ t: 'recall' });
  A.send({ t: 'power', sys: 'weapons' });
  await wait(900);
  bagA = await snap(A);
  const nowA = rowOf(bagA, A.id);
  check('the server refuses every intent while the clock is running',
    A.said.filter(t => /clock has not let go/.test(t)).length >= 5,
    `${A.said.filter(t => /clock has not let go/.test(t)).length} refusals: course, thrust, target, jump, recall, power`);
  check('and the hull does not move a pixel, whatever the client sent',
    nowA[1] === startA[1] && nowA[2] === startA[2] && nowA[10] === 0,
    `still at ${nowA[1]},${nowA[2]} — a course set before the fold cannot coast through it either`);

  await wait(COUNT * 1000);
  bagA = await snap(A);
  check('and then it lets go',
    (bagA.duel?.count ?? 1) === 0, `${bagA.duel?.count} — ${COUNT}s exactly, from the server`);

  // --- 7. A KILL, BY ACTUAL GUNFIRE ----------------------------------------
  const t0 = Date.now();
  let over = null;
  for (let i = 0; i < 90 && !over; i++) {
    const bb = await snap(A);
    const rb = rowOf(bb, B.id);
    if (rb) A.send({ t: 'intent', mode: 'pt', x: rb[1], y: rb[2] });
    A.send({ t: 'target', id: B.id });
    if (bb.duel?.over) over = bb.duel;
    else await wait(300);
  }
  const took = (Date.now() - t0) / 1000;
  check('one pilot can destroy another in here — with guns, over a real socket',
    !!over && over.won === 1,
    `${took.toFixed(1)}s of a finished rack against a starter hauler`);
  check('and the loser is a wreck, told they lost',
    B.dead?.where === duelId && B.ended.at(-1)?.won === 0 && B.ended.at(-1)?.draw === 0,
    JSON.stringify(B.ended.at(-1) ?? null));

  // --- 8. THE STAKE --------------------------------------------------------
  const crB1 = (await snap(B)).credits;
  const paid = crB0 - crB1;
  check('the loser pays exactly what dying already costs — a tenth, not a new number',
    paid === tollOn(crB0),
    `${n(paid)} cr of ${n(crB0)}, which is tollOn() and nothing else`);
  check('and their whole hold went with the ship',
    Object.keys((await snap(B)).hold ?? {}).length === 0 && Object.keys(heldB).length > 0,
    `${JSON.stringify(heldB)} is on the floor`);
  bagA = await snap(A);
  const cans = bagA.pods ?? [];
  const bond = cans.find(c => c[3] === BOND.key), ore = cans.find(c => c[3] !== BOND.key);
  check('both fell as pods the winner can pick up, which is what a bounty means here',
    !!bond && bond[6] === paid && !!ore,
    `a ${n(bond?.[6] ?? 0)} cr bond and ${ore?.[4]} ${ore?.[3]}`);

  // --- 9. THE SCOOP --------------------------------------------------------
  for (const c of cans) { A.send({ t: 'scoop', id: c[0] }); await wait(2400); }
  bagA = await snap(A);
  const gotOre = bagA.hold?.[ore[3]] ?? 0;
  check('the bond goes onto the balance whole, because credits have no volume',
    bagA.credits === crA1 + paid,
    `${n(crA1)} -> ${n(bagA.credits)} cr — a full hold is a reason to leave ore, and it `
    + 'would be a strange one to lose a fight’s whole purse to');
  check('and the ore goes into the hold, as far as the hold goes',
    gotOre > 0 && gotOre <= ore[4],
    `${gotOre} of ${ore[4]} ${ore[3]} — the winner’s hold is ${bagA.cap}, and cargo `
    + 'capacity is the one thing a duel does not suspend');
  check('so a duel is a TRANSFER and mints nothing — which is the whole anti-farming answer',
    (bagA.credits - crA1) === (crB0 - crB1),
    `+${n(bagA.credits - crA1)} to the winner, -${n(crB0 - crB1)} from the loser. A thousand `
    + 'duels between two accounts move money that already existed');
  check('and it paid no bounty, no experience and nothing to the threat file',
    (bagA.xp ?? 0) === 0 && Object.keys(bagA.kills ?? {}).length === 0,
    'two accounts levelling each other was the exploit, and there is nothing to level');

  // --- 10. THE LINGER ------------------------------------------------------
  //
  // Which rule took the winner home MATTERS, and getting it wrong is easy: the
  // scoop above costs 4.8s and a flight to the middle plus a 3s spool is another 8,
  // so a check that only asked "are they out of the arena" would pass on the linger
  // while claiming to have tested the portal. So this one waits the linger out on
  // purpose and does not touch the portal at all — the portal gets its own test at
  // step 12, in a duel that is not over, where the linger cannot be the answer.
  A.said.length = 0;
  await wait(LINGER * 1000 + 1200);
  check('when the linger runs out the winner is put back at their own hangar',
    !isArena(A.map) && !!MAPS[A.map] && MAPS[A.map].base
    && A.said.some(t => /you won/.test(t)),
    `${A.map} after ${LINGER}s — long enough to scoop what fell out and watch the wreck`);

  // --- 11. AND THE SECTOR CLOSES ------------------------------------------
  B.send({ t: 'respawn' }); await wait(600);
  open = await arenas(A);
  check('the sector closes once NEITHER seat is standing in it',
    open.open === 0 && open.list.length === 0,
    'not a list of exits: the sweep asks whether anybody is here, so the portal, a '
    + 'wreck that respawned, a beacon, /tp and a closed tab are all the same fact');

  // --- 12. A FORFEIT ------------------------------------------------------
  A.chat('/heal'); B.chat('/heal'); await wait(200);
  A.chat('/tp m2'); B.chat('/tp m2'); await wait(400);
  B.challenged.length = 0; A.ended.length = 0; B.ended.length = 0;
  const crB2 = (await snap(B)).credits, crA2 = (await snap(A)).credits;
  A.chat('/1v1 Bly'); await wait(400);
  B.chat('/accept'); await wait(FOLD_WAIT + COUNT * 1000 + 400);
  check('a second duel opens a second sector, and the first one is long gone',
    isArena(A.map) && A.map === B.map && (await arenas(A)).open === 1, A.map);
  // Bly runs for the way out — the portal, on foot, in a duel that is still live.
  // Nothing else can be what takes them home here: the duel is not over, so there is
  // no linger, and they have sent no beacon and no /tp.
  B.said.length = 0;
  B.send({ t: 'intent', mode: 'pt', x: DUEL_W / 2, y: DUEL_H / 2 });
  await wait(5000);
  B.send({ t: 'jump' });
  await wait(JUMP_TIME * 1000 + 900);
  check('the portal in the middle takes you back to your own hangar',
    !isArena(B.map) && !!MAPS[B.map] && MAPS[B.map].base,
    `${B.map} — the first portal any instanced sector has ever had, and it names no `
    + 'sector because it goes to a different one for each of them');
  await wait(600);
  check('leaving while the other one is still standing is a forfeit, and it pays the same',
    A.ended.at(-1)?.won === 1 && A.ended.at(-1)?.cr === tollOn(crB2)
    && (await snap(B)).credits === crB2 - tollOn(crB2),
    `${n(A.ended.at(-1)?.cr ?? 0)} cr — the portal, a beacon and a closed tab are the same exit`);
  bagA = await snap(A);
  check('and the purse drops where they LEFT from, not where they are now',
    (bagA.pods ?? []).some(c => c[3] === BOND.key && c[6] === tollOn(crB2)),
    'reading their position after the forfeit would drop a duel’s stake in their home dock');

  // --- 13. A CLOSED TAB IS THE SAME EXIT ----------------------------------
  A.close(); await wait(900);
  open = await arenas(B);
  check('and the sector goes when the last of them does, however they go',
    open.open === 0,
    'a duel that outlived its pilots is a sector stepped thirty times a second, forever');

  // --- 14. AND THE DODGE THAT HAD TO BE CLOSED -----------------------------
  //
  // Losing, and pulling the plug. This is the one exit where the player object is
  // gone by the time anybody notices, so the stake has to reach the ACCOUNT — which
  // is the reason it is charged at resolution rather than held in escrow.
  const C = await join('Cyd');
  await wait(200);
  C.chat('/money 800000'); await wait(200);
  C.chat('/tp m2'); B.chat('/tp m2'); B.chat('/heal'); await wait(400);
  const crC0 = (await snap(C)).credits;
  const tokC = C.token;
  B.challenged.length = 0; B.ended.length = 0;
  B.chat(`/1v1 Cyd`); await wait(400);
  C.chat('/accept'); await wait(FOLD_WAIT + COUNT * 1000 + 400);
  check('a third pilot can duel too — a duel is per pair, not a global',
    isArena(C.map) && C.map === B.map, `${C.map} / ${B.map}`);
  C.close();                                    // Cyd pulls the plug rather than pay
  await wait(1200);
  check('closing the tab mid-duel is a forfeit, and the stake still comes off the account',
    B.ended.at(-1)?.won === 1 && B.ended.at(-1)?.cr === tollOn(crC0),
    `${n(B.ended.at(-1)?.cr ?? 0)} cr of ${n(crC0)} — the player object is gone by the tick `
    + 'after, so it is charged where it can still be found');
  const back = await join('Cyd', tokC);
  await wait(400);
  check('and the pilot who pulled it finds the money gone when they come back',
    (await snap(back)).credits === crC0 - tollOn(crC0),
    `${n((await snap(back)).credits)} cr — there is nothing to spend it on inside a duel `
    + 'either: no dock, no berth, no shop, so both the balance and the hold are frozen');
  back.close();
  B.close();
}

kill();
const liveSecs = (Date.now() - began) / 1000 - simSecs;
console.log(fails.length
  ? `\nFAIL — ${fails.length}: ${fails.join(', ')}`
  : `\nPASS — the duel: ${DUEL_W}x${DUEL_H}, ${COUNT}s held, a tenth on the table`
    + ` — ${simSecs.toFixed(1)}s offline, ${liveSecs.toFixed(1)}s over the wire`);
process.exit(fails.length ? 1 : 0);
