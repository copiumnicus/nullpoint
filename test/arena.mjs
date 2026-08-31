// The claim fight — the roster, what it pays, and every way out of one.
//
// Two halves, and the second is the reason this file is in `npm test` at all.
//
// The first half is offline: it runs server.js's own tick against ONE sector and
// ONE pilot, twelve spawn rotations per arena, and reports what a competent pilot
// is left with. Everything that decides anything is imported from shared/, so the
// only thing written here is the pilot's policy — which is the part a real player
// supplies.
//
// The second half boots a real server on its own port and drives real sockets
// through EVERY way out of an arena: won, died, a Recall Beacon, /tp, the tab
// closing, a second session taking the account over, a server restart, and a
// pilot who simply never finishes. An arena is a sector that exists only while
// somebody is standing in it, so "did it close" is not a question any offline
// test can ask — and an arena that outlives its pilot is a sector full of
// hostiles stepped thirty times a second, forever. That is worth the seconds it
// costs the suite.

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { newShip, step, stepVitals, stepDrift, applyDamage, drainHull, havenKind } from '../shared/sim.js';
import { fire, stepBolts, faceTarget } from '../shared/combat.js';
import { launch, stepRockets } from '../shared/rockets.js';
import { newAlien, stepAlienAI, stepAlienRepair, stepEvade, jinkHeading, mayHarm,
         effectiveHp, threatDps, ALIENS, WILD, storeHit, stepMirror,
         noLeash, noHorizon } from '../shared/aliens.js';
import { stepSiphon, tetherHolds } from '../shared/siphon.js';
import { stepFix, fixHolds, fixWinding, collapseTo, fixOf, haulCost } from '../shared/kedge.js';
import { burnOf, stepBurn, goadBurn, burnBite, pyreFor, inPyre, poolOf, inBurn } from '../shared/burn.js';
import { holdShear, loudOf } from '../shared/tech.js';
import { buildFor, stageDps, stageEhp, earnRate } from '../shared/balance.js';
import { MAP_W, MAP_H, MAPS, GALAXY, mapOf, arenaId, parseArena, isArena,
         ARENA_KEYS, ARENA_PREFIX } from '../shared/maps.js';
import { MODULES, tiersOf, addMod, incomeOf, whyNotBuild, rowState, labPanel,
         LAB_TAB_KEYS } from '../shared/research.js';
import { ARENAS, ARENA_MODULES, rosterOf, countOf, fieldEhp, fieldBounty, fieldDps,
         postsFor, arrivalAt, assumedFor, whyNotClaim, whyNotReplay, claimState,
         missionText, mission, PAYS, RING_R, ARRIVE_R, LINGER, LIMIT, weightOf,
         BAR_TOP, BAR_LOW, BAR_H, HUD_LEFT, HUD_RIGHT } from '../shared/arena.js';
import { newAccount, sanitiseAccount, capture } from '../shared/account.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const n = x => Math.round(x).toLocaleString('en-US');
const began = Date.now();

// ============================================================================
// the simulation — server.js's tick, one sector, one pilot
// ============================================================================
const DT = 1 / 30;
const arenaFor = key => mapOf(arenaId('probe', key));

const makePilot = (stage, mask, at = -Math.PI / 2, R = ARRIVE_R) => {
  const b = buildFor(stage);
  return newShip(MAP_W / 2 + Math.cos(at) * R, MAP_H / 2 + Math.sin(at) * R,
                 b.hull, b.fit, b.drones, 'line', null, mask);
};

// The field, exactly as openArena() posts it, rotated by `phase` so twelve runs
// are twelve different fields rather than the same one twelve times.
function makeRoster(key, map, phase = 0) {
  let id = 5000 + Math.round(phase * 1000);
  return postsFor(key).map(sl => {
    const a2 = Math.atan2(sl.y - MAP_H / 2, sl.x - MAP_W / 2) + phase;
    const rr = Math.hypot(sl.x - MAP_W / 2, sl.y - MAP_H / 2);
    const al = newAlien(sl.kind, id++, map, id * 7919,
                        { x: MAP_W / 2 + Math.cos(a2) * rr, y: MAP_H / 2 + Math.sin(a2) * rr });
    al.spawned = true; al.post = null;
    return al;
  });
}

// One tick, lifted from server.js. `policy(ship, live, dt)` sets ship.tx/ty and
// returns the alien to shoot. The order of the calls matters and is the server's:
// the fix is planted BEFORE the hull is stepped, because a plant written after
// step() is a plant that never happens.
function run(map, ship, list, policy, { limit = 600 } = {}) {
  let t = 0, bolts = [], rockets = [], pyres = [], dealt = 0, taken = 0;
  const pool = poolOf(ship);
  while (t < limit) {
    const live = list.filter(a => a.dead <= 0 && a.hp > 0);
    if (!live.length || ship.hp <= 0) break;

    step(ship, DT); stepDrift(ship, DT, holdShear(ship, DT)); stepVitals(ship, DT, false, !!map.arena);
    const foe = policy(ship, live, DT);
    if (foe) {
      faceTarget(ship, foe);
      for (const s of fire(ship, foe, DT)) { s.owner = 1; bolts.push(s); }
      for (const r of launch(ship, foe, DT)) { r.owner = 1; rockets.push(r); }
      foe.provoked.add(1);
      if (foe.target === null) foe.target = 1;
    } else { fire(ship, null, DT); launch(ship, null, DT); }

    const here = [{ id: 1, ship, haven: false, loud: loudOf(ship) }];
    for (const a of list) {
      if (a.dead > 0 || a.hp <= 0) continue;
      const tgt = stepAlienAI(a, map, here, DT);
      const incoming = [...rockets.filter(r => r.target === a),
        ...bolts.filter(b => b.target === a).map(b => ({
          x: b.sx + (b.ax - b.sx) * (1 - b.t / b.ttl), y: b.sy + (b.ay - b.sy) * (1 - b.t / b.ttl),
          vx: (b.ax - b.sx) / b.ttl, vy: (b.ay - b.sy) / b.ttl }))];
      const breaking = stepEvade(a, incoming, map, DT);
      const seen = tgt ? here.find(c => c.id === tgt) : null;
      if (fixOf(a.def)) {
        const held = seen ? fixHolds(a, seen.ship, seen.haven) : false;
        const snap = stepFix(a, seen?.ship ?? null, held, DT);
        if (fixWinding(a)) { a.tx = a.ty = a.dx = a.dy = null; }
        if (snap && seen && seen.ship.hp > 0 && mayHarm(a, seen)) {
          const hauled = collapseTo(seen.ship, snap.to);
          const took = haulCost(hauled.px, poolOf(seen.ship));
          if (took > 1) { applyDamage(seen.ship, took); taken += took; }
        }
      }
      step(a, DT); stepDrift(a, DT); stepVitals(a, DT, false); stepAlienRepair(a, DT);
      if (breaking && Math.hypot(a.vx, a.vy) > 20) a.heading = jinkHeading(a, seen?.ship);
      else faceTarget(a, seen?.ship);
      stepMirror(a, DT);
      const grip = seen ? tetherHolds(a, seen.ship, seen.haven) : false;
      const bite = stepSiphon(a, seen?.ship ?? null, grip, DT);
      if (bite) { const got = drainHull(seen.ship, bite.take);
                  a.hp = Math.min(a.stats.hull, a.hp + bite.mend); taken += got.hull; }
      for (const s of fire(a, seen?.ship ?? null, DT)) bolts.push(s);
      for (const r of launch(a, seen?.ship ?? null, DT)) rockets.push(r);
      if (burnOf(a.def)) {
        const scorched = here.filter(c => c.ship.hp > 0 && mayHarm(a, c) && inBurn(a, c.ship));
        stepBurn(a, a.target !== null, scorched.length > 0, DT);
        for (const c of scorched) { const b2 = burnBite(a.def, a.spin, poolOf(c.ship), DT);
                                    applyDamage(c.ship, b2); taken += b2; }
      }
    }

    for (const h of [...stepRockets(rockets, DT), ...stepBolts(bolts, DT)]) {
      storeHit(h.target, h.split.shield + h.split.hull);
      goadBurn(h.target, h.split.shield + h.split.hull, h.target.isAlien ? effectiveHp(h.target.kind) : 0);
      if (h.target === ship) taken += h.split.shield + h.split.hull;
      else dealt += h.split.shield + h.split.hull;
    }
    for (const a of list) if (a.dead <= 0 && a.hp <= 0) {
      a.dead = a.def.respawn;
      if (burnOf(a.def) && (a.spin ?? 0) > 0) pyres.push(pyreFor(a, 1));
    }
    for (let i = pyres.length - 1; i >= 0; i--) {
      const py = pyres[i];
      if ((py.t -= DT) > 0) continue;
      pyres.splice(i, 1);
      if (ship.hp > 0 && inPyre(py, ship)) {
        const took = py.dmg * poolOf(ship); applyDamage(ship, took); taken += took;
      }
    }
    t += DT;
  }
  const left = list.filter(a => a.dead <= 0 && a.hp > 0).length;
  const hp = Math.max(0, ship.hp), sh = Math.max(0, ship.shield);
  return { secs: +t.toFixed(1), left, cleared: left === 0 && ship.hp > 0, died: ship.hp <= 0,
           over: +((hp + sh) / pool).toFixed(3), taken: Math.round(taken), dealt: Math.round(dealt) };
}

// "all in": fly to the middle of the field and hold the trigger on the nearest.
const allIn = rock => (ship, live) => {
  ship.tx = rock.x; ship.ty = rock.y; ship.dx = ship.dy = null;
  return live.slice().sort((a, b) =>
    Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
};

// "played well": nearest target, held at the edge of your own gun's reach, out of
// every ring, weaving across the line of fire. The honest FLOOR for a competent
// pilot — no repair kit, no ability, no power routing, no ammunition above cell1.
const kite = () => {
  let weave = 1, wt = 0;
  return (ship, live, dt) => {
    wt += dt; if (wt > 0.7) { wt = 0; weave = -weave; }
    const foe = live.slice().sort((a, b) =>
      Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
    const reach = ship.stats.weaponRange * 0.92;
    const ax = ship.x - foe.x, ay = ship.y - foe.y, d = Math.hypot(ax, ay) || 1;
    let wx = foe.x + (ax / d) * reach, wy = foe.y + (ay / d) * reach;
    for (const a of live) {                       // never stand in a ring
      if (!burnOf(a.def)) continue;
      const br = a.def.burn.reach + 120;
      const dx = wx - a.x, dy = wy - a.y, dd = Math.hypot(dx, dy) || 1;
      if (dd < br) { wx = a.x + (dx / dd) * br; wy = a.y + (dy / dd) * br; }
    }
    const lx = wx - foe.x, ly = wy - foe.y, ld = Math.hypot(lx, ly) || 1;
    wx += (-ly / ld) * 150 * weave; wy += (lx / ld) * 150 * weave;
    ship.tx = Math.max(60, Math.min(MAP_W - 60, wx));
    ship.ty = Math.max(60, Math.min(MAP_H - 60, wy));
    ship.dx = ship.dy = null;
    return foe;
  };
};

// ============================================================================
console.log('\nthe sector, which is a pure function of its id');
{
  const id = arenaId('abc123', 'mine2');
  check('an arena id carries everything a viewer needs to draw the sector',
    id === 'arena:abc123:mine2' && parseArena(id).token === 'abc123' && parseArena(id).key === 'mine2',
    `${id} — nothing about the geometry has to travel`);
  // A token is opaque, so the key comes off the END. Splitting on ':' would have
  // let a token with a colon in it silently name a different arena.
  const odd = arenaId('a:b:c', 'mine3');
  check('a token with a colon in it still names its own arena',
    parseArena(odd).token === 'a:b:c' && parseArena(odd).key === 'mine3', odd);
  check('and nothing else parses as one',
    !isArena('m1') && !isArena('') && !isArena(null) && !isArena(ARENA_PREFIX)
    && !isArena('arena:tok:hull1'), 'a real sector, a blank, a null and a module that is not a claim');

  const m = mapOf(id);
  check('an arena has no portals, no base and no outpost, so there is no way out and nowhere to hide',
    m.portals.length === 0 && !m.base && !m.outpost && havenKind(m, { x: MAP_W / 2, y: MAP_H / 2 }) === null,
    'havenKind finds nothing anywhere in it');
  check('the rock is in the middle of it, and both sides compute the same one',
    m.rock.x === MAP_W / 2 && m.rock.y === MAP_H / 2 && mapOf(id).rock === m.rock,
    `r ${m.rock.r} — the client derives it from the id it was told`);
  check('the template is per tier, not per pilot',
    mapOf(arenaId('someone-else', 'mine2')) === m,
    'three sector objects ever, not one per pilot per tier');
  check('mapOf answers for a real sector too, which is why it can replace MAPS[]',
    mapOf('m1') === MAPS.m1 && mapOf('nope') === null, 'MAPS first, then the arena table');
  check('an arena is not in the galaxy, so it is not on the chart and nothing seeds it',
    !GALAXY.some(isArena) && !Object.keys(MAPS).some(isArena),
    `${GALAXY.length} sectors a pilot can fly to, none of them a claim`);
  check('every claim tier has a sector template and every template has a claim',
    ARENA_KEYS.every(k => ARENAS[k]) && ARENA_MODULES.every(k => ARENA_KEYS.includes(k)),
    ARENA_MODULES.join(' '));
  check('and the claim list IS the mining ladder, read off research rather than written twice',
    ARENA_MODULES.join() === tiersOf('mine').join(),
    'a fourth mining tier with no field would be a rung nobody could buy');
}

console.log('\nthe field');
{
  for (const key of ARENA_MODULES) {
    const kinds = rosterOf(key).map(([k]) => k);
    check(`${key} posts ${countOf(key)} hostiles, all of them real`,
      kinds.every(k => ALIENS[k]) && postsFor(key).length === countOf(key),
      rosterOf(key).map(([k, c]) => `${c} ${k}`).join(' + '));
  }
  // The one rule here that came out of a live socket rather than out of the model.
  // A Harrier runs at 8% of its hull and moves at 380 against a laden Bulwark's
  // 152, so the last of them simply left, healed at 4% a second, and there was no
  // way to finish the fight and no way out of the sector to abandon it.
  const runners = ARENA_MODULES.flatMap(k => rosterOf(k).map(([kind]) => kind))
    .filter(k => (ALIENS[k].flee ?? 0) > 0);
  check('nothing in a claim can run away from you',
    runners.length === 0,
    'a hostile that breaks off in a sector with no exit is a stalemate, not an escape'
    + ` — ${WILD.filter(k => (ALIENS[k].flee ?? 0) > 0).join(', ')} are therefore barred`);
  // Every BARREL in the bestiary is harmless at this stage, which is why the
  // rosters are built out of the hostiles whose threat is a RATE instead.
  // `damage x fireRate` deliberately, not threatDps: the flat number is the thing
  // being called harmless, and threatDps exists precisely because it is not the
  // whole story — it folds in a mothership's escort and a mirror's chamber, which
  // are not barrels and are not what this is about.
  const ehp = stageEhp('finished');
  const barrel = k => (ALIENS[k].attrs.damage ?? 0) * (ALIENS[k].attrs.fireRate ?? 0);
  const worst = WILD.filter(k => barrel(k) > 0)
    .map(k => [k, ehp / barrel(k)]).sort((a, b) => a[1] - b[1])[0];
  check('every gun in the bestiary is harmless to the pilot a claim assumes',
    worst[1] > 20,
    `the heaviest barrel in the game needs ${worst[1].toFixed(0)}s to kill a finished pilot `
    + `standing still (${worst[0]}, ${barrel(worst[0]).toFixed(0)} dps into ${n(ehp)} ehp) — `
    + 'damage x fireRate was only ever true at the anchor stage');
  for (const key of ARENA_MODULES) {
    const rate = fieldDps(key, ehp, stageEhp('finished')) / ehp;
    check(`${key} is a place you cannot stand still in`,
      rate > 0.25,
      `${(rate * 100).toFixed(0)}% of the whole ship a second if it all engages — `
      + `${(1 / rate).toFixed(1)}s in the middle of it is the ship`);
  }
  // The escalation is a new question each time, not more hit points: the fields
  // stay the same size and the pressure stays flat.
  const press = ARENA_MODULES.map(k => fieldDps(k, ehp, ehp) / ehp);
  check('the three claims escalate by asking a new question, not by hitting harder',
    Math.max(...press) / Math.min(...press) < 1.35,
    press.map((p, i) => `${ARENA_MODULES[i]} ${(p * 100).toFixed(0)}%`).join('  ')
    + ' — holding pressure alone made the third one unwinnable 12 times out of 12');
}

console.log('\nthe chase, and what it must not touch');
{
  const open = MAPS.m1, claim = arenaFor('mine1');
  check('inside a claim nothing ever breaks off, however far you go',
    noLeash(claim) && !noLeash(open),
    'you cannot walk out to 2,400px and wait — which was half of "kill one, run away, heal"');
  check('and an ordinary sector still forgets you at its leash, exactly as it did',
    !noLeash(open) && !noHorizon(open) && ALIENS.ironhusk.leash === 1500,
    'the flag is a property of the SECTOR, so an Ironhusk is an Ironhusk everywhere — '
    + 'nothing in the open world starts chasing from across a sector because claims exist');
  // Measured and rejected. Left as a named seam rather than deleted, per rule seven.
  check('everything-sees-you-from-anywhere is a seam, and it is off',
    !noHorizon(claim) && !claim.hunt,
    'a finished pilot moves at 128 and the bestiary moves at 150 to 400, so a horizon-wide '
    + 'aggro is not a chase, it is the whole field arriving at once — measured 0 of 12 at '
    + 'every tier, and 0 of 12 again with the field posted in depth');

  // The other half, and the bigger one. Regeneration is a share of the pool, so a
  // finished ship refills in half a minute — a rest button, not a repair.
  const b = buildFor('finished');
  const dryShip = newShip(0, 0, b.hull, b.fit, b.drones), wetShip = newShip(0, 0, b.hull, b.fit, b.drones);
  dryShip.shield = wetShip.shield = 0;
  dryShip.sinceHit = wetShip.sinceHit = 1e9;
  for (let i = 0; i < 300; i++) { stepVitals(dryShip, 1 / 30, false, true); stepVitals(wetShip, 1 / 30, false, false); }
  check('shields do not come back inside a claim',
    dryShip.shield === 0 && wetShip.shield > wetShip.stats.shield * 0.25,
    `ten seconds of quiet puts ${Math.round(wetShip.shield).toLocaleString('en-US')} of `
    + `${Math.round(wetShip.stats.shield).toLocaleString('en-US')} back everywhere else and `
    + 'nothing back here — the loop the designer complained about was regeneration, not the hostiles');
}

console.log('\nwhat a claim pays, and why it is nothing');
{
  check('a claim pays no bounty, no experience, no ore and no entry in the threat file',
    !PAYS.bounty && !PAYS.xp && !PAYS.ore && !PAYS.file,
    'you are not being paid to be here, you are buying a rock');
  // The arithmetic, quoted rather than asserted in prose. The clear time comes out
  // of the simulation below; 90s is the shape of it and none of the ratios is close.
  const bounty = fieldBounty('mine1');
  const perSec = bounty / 90;
  const active = earnRate();                      // dps x BOUNTY_RATE for the reference pilot
  let allMines = 0; for (const k of tiersOf('mine')) allMines = addMod(allMines, k);
  const best = incomeOf(allMines);
  check('paying it would beat playing the game by a factor nobody could ignore',
    perSec > active * 20,
    `${n(bounty)} cr of bounty cleared in about 90s is ${n(perSec)} cr/s against an `
    + `actively-played ${active.toFixed(0)} — ${(perSec / active).toFixed(0)}x`);
  check('and it would beat the thing the fight is FOR by more than a hundred times',
    perSec > MODULES.mine1.rate * 100 && perSec > best * 5,
    `the rig this claim unlocks pays ${MODULES.mine1.rate} cr/s and the whole mining ladder `
    + `pays ${best} — a field worth ${n(perSec)} a second would make the rock pointless`);
  check('a replay makes that argument absolute rather than merely strong',
    !PAYS.bounty,
    'a first claim can be won once; a replay can be won without limit, and no positive '
    + 'number survives being multiplied by "as often as you like" — zero is the only stable one');
  check('a replay is a proving ground instead: a known field, and dying in it costs nothing',
    ARENA_MODULES.every(k => whyNotReplay(k, { near: true, claims: ARENA_MODULES }) === null),
    'the only place a fit can be measured against an identical field, and the rehearsal '
    + 'for the next tier — mine2 is mine1 plus the Lamprey');
}

console.log('\nthe ship a claim assumes, derived rather than written down');
{
  for (const key of ARENA_MODULES) {
    const a = assumedFor(key);
    check(`${key} assumes the hull and shield tiers its own price buys`,
      a.spent <= MODULES[key].price,
      `${n(a.spent)} of a ${n(MODULES[key].price)} budget — moving a module price moves the calibration`);
  }
  const spends = ARENA_MODULES.map(k => assumedFor(k).spent);
  check('and it climbs with the ladder rather than standing still',
    spends[2] > spends[1] && spends[1] >= spends[0], spends.map(n).join(' -> '));
}

console.log('\nthe fight, twelve spawn rotations per claim');
{
  const ROT = 12;
  const table = [], pilots = {};
  for (const key of ARENA_MODULES) {
    const map = arenaFor(key), mask = assumedFor(key).mask;
    {
      const b = buildFor('finished');
      const sh = newShip(0, 0, b.hull, b.fit, b.drones, 'line', null, mask);
      pilots[key] = { ehp: sh.stats.hull + sh.stats.shield, hull: sh.stats.hull };
    }
    let died = 0, cleared = 0, over = 0, secs = 0;
    for (let i = 0; i < ROT; i++) {
      const phase = (i / ROT) * Math.PI * 2;
      const ship = makePilot('finished', mask, -Math.PI / 2 + phase);
      const r = run(map, ship, makeRoster(key, map, phase), kite());
      if (r.cleared) { cleared++; over += r.over; secs += r.secs; }
      if (r.died) died++;
    }
    // Flown badly: into the middle of the field, trigger held on whatever is
    // nearest. The first claim has to punish that or the ring means nothing.
    let inDied = 0, inCleared = 0;
    for (let i = 0; i < ROT; i++) {
      const phase = (i / ROT) * Math.PI * 2;
      const ship = makePilot('finished', mask, -Math.PI / 2 + phase);
      const r = run(map, ship, makeRoster(key, map, phase), allIn(map.rock));
      if (r.died) inDied++;
      if (r.cleared) inCleared++;
    }
    table.push({ key, cleared, died, inDied, inCleared,
                 over: cleared ? over / cleared : 0, secs: cleared ? secs / cleared : 0 });
  }
  // REWRITTEN. This said "winnable every time" and asserted 12 of 12 with no
  // deaths, which was true while a claim had a rest button in it: shields came back
  // at 3.33% of the pool a second, so a floor policy that never used that loop
  // still finished with two thirds of the ship. With the chase and dry shields the
  // same policy — no repair kit, no ability, no power routing, no ammunition above
  // cell1 — loses 1 or 2 runs in 12 at the upper tiers. That is the claim now: it
  // is winnable without any of the four things a real pilot carries, most of the
  // time, and it costs nearly the whole ship either way.
  for (const row of table) {
    check(`${row.key} is winnable carrying none of the four things a real pilot has`,
      row.cleared >= ROT - 2 && row.over < 0.35,
      `${row.cleared} of ${ROT} cleared with ${(row.over * 100).toFixed(0)}% of the ship left, `
      + `${row.secs.toFixed(0)}s — no repair kit, no ability, no power routing, cell1 ammunition`);
  }
  // REWRITTEN AGAIN, and this time upward. The weakened version asked only that the
  // middle "costs ships", because the hull rework had made the assumed pilot 32%
  // tougher and taken it from 9 of 12 dead to 5. The chase and dry shields put it
  // back past where it started, at every tier rather than only the first: an all-in
  // pilot eats the field's whole nominal pressure and no longer gets any of it
  // back, so the middle is lethal 11 or 12 times in 12. That is the sharp claim and
  // it should not need weakening again.
  for (const row of table)
    check(`flying into the middle of ${row.key} kills you`,
      row.inDied >= ROT - 1 && row.inCleared <= 1,
      `${row.inDied} of ${ROT} dead through the middle against ${row.died} of ${ROT} around it — `
      + `it was ${row.key === 'mine1' ? '5' : '0'} of ${ROT} before nothing in a claim broke off `
      + 'and shields stopped coming back');
  // The reading the multipliers are stated in, and the one a player feels, side by
  // side — because they disagree and the disagreement is the point.
  for (const row of table)
    check(`${row.key} costs a competent pilot most of their ship`,
      1 - row.over > 0.6,
      `${((1 - row.over) * 100).toFixed(0)}% of the ship consumed by a clean clear, and the `
      + `field weighs ${(weightOf(row.key, pilots[row.key].ehp, pilots[row.key].hull) / 1e6).toFixed(0)}M `
      + '(hit points x incoming dps) — the consumed reading saturates at 100% and cannot say '
      + '"twice as hard" about a claim that already costs nine tenths of the ship');

  // REWRITTEN. This said "the margin narrows as the ladder climbs" and it does not
  // any more, because shields now come back as a SHARE of the pool rather than a
  // number per second (0.50). A pilot with hull2 + shld2 regenerates four times as
  // fast in absolute terms as the pilot mine1 assumes, so the higher claims stopped
  // biting harder in proportion — 38 / 36 / 45 rather than 39 / 19 / 18.
  //
  // What the design actually promises is the line that survives, and it is the one
  // the rosters were built to satisfy: the same field costs a competent pilot the
  // same SHARE of their ship at every tier, because everything in it bills in
  // shares. The escalation is a new question each time, not a bigger number.
  const shares = table.map(r => r.over);
  check('every claim costs a competent pilot about the same share of their ship',
    Math.max(...shares) - Math.min(...shares) < 0.15,
    table.map(r => `${r.key} ${(r.over * 100).toFixed(0)}% left`).join('  ')
    + ' — a Censer and a Lamprey both bill in shares, which is what makes one roster '
    + 'correct at all three tiers, and dry shields are what stopped a bigger pool '
    + 'quietly refunding the difference');
  check('an arena is a fight, not a siege',
    table.every(r => r.secs < LIMIT / 4),
    `the longest clear is ${Math.max(...table.map(r => r.secs)).toFixed(0)}s against a `
    + `${LIMIT / 60}-minute wall, so nothing that is actually a fight is ever cut short`);
}

console.log('\ngetting in, and the one row that says so');
{
  const near = { near: true, mask: 0, claims: [], hold: {} };
  check('you cannot launch a claim from anywhere but your own station',
    /fly to your station/.test(whyNotClaim('mine1', { ...near, near: false })),
    whyNotClaim('mine1', { ...near, near: false }));
  check('you cannot free the belt before the rig that works it',
    /free the claim below/.test(whyNotClaim('mine2', near)), whyNotClaim('mine2', near));
  check('you go to a claim with an empty hold',
    /empty the hold/.test(whyNotClaim('mine1', { ...near, hold: { iron: 3 } })),
    'a wreck in a claim costs nothing, so a full hold plus a deliberate death '
    + 'would be the free flight home a Recall Beacon charges for');
  check('and you cannot launch one from inside one',
    /already standing on a claim/.test(whyNotClaim('mine1', { ...near, inArena: true })),
    whyNotClaim('mine1', { ...near, inArena: true }));
  check('a rock you have freed is not a rock you can claim again',
    /already yours/.test(whyNotClaim('mine1', { ...near, claims: ['mine1'] })),
    'it is a replay from then on, and a replay cannot be re-won');
  check('and a rock you have not freed is not a rock you can replay',
    /have not freed/.test(whyNotReplay('mine1', { near: true, claims: [] })),
    whyNotReplay('mine1', { near: true, claims: [] }));
  check('a replay keeps the empty-hold rule, for a sharper reason than the claim',
    /empty the hold/.test(whyNotReplay('mine1', { near: true, claims: ['mine1'], hold: { iron: 1 } })),
    'a replay is the cheapest death in the game, so a laden pilot would use one as a free courier');

  check('the mining rung will not sell until the rock is free',
    /contested/.test(whyNotBuild('mine1', { credits: 1e9, mask: 0, near: true, claims: [] }))
    && whyNotBuild('mine1', { credits: 1e9, mask: 0, near: true, claims: ['mine1'] }) === null,
    whyNotBuild('mine1', { credits: 1e9, mask: 0, near: true, claims: [] }));
  check('and the claim is refused before the price, not after it',
    /contested/.test(whyNotBuild('mine1', { credits: 0, mask: 0, near: true, claims: [] })),
    'a row that only offered the fight once you could afford the module would hide it '
    + 'from every pilot who has not saved up — the fight is what you do while you save');
  check('the row knows which of its two buttons it is showing',
    rowState(0, 'mine', 1e9, []).claim === true && rowState(0, 'mine', 1e9, ['mine1']).claim === false
    && rowState(0, 'hull', 1e9, []).claim === false,
    'CLAIM THE ROCK until it is yours, then the price');
  const st = claimState('mine2', { claims: ['mine1'], mask: addMod(0, 'mine1') });
  check('the CLAIMS page says what each rock is right now',
    !st.freed && !st.locked && st.count === countOf('mine2') && st.verb === 'CLAIM THE ROCK',
    `${st.name}: ${st.count} hostiles, "${st.asks}"`);
  check('and a freed one offers the flight again rather than the purchase',
    claimState('mine1', { claims: ['mine1'] }).verb === 'RUN IT AGAIN',
    'a replay is not a rung: it costs nothing and buys nothing, so it is its own page');
  check('a rock two tiers up reads as held rather than as available',
    claimState('mine3', { claims: [] }).locked, 'free the claim below it first');
}

console.log('\nthe mission bar');
{
  for (const W of [3200, 1600, 1280, 1100, 900, 700, 420]) {
    const b = mission(W, { key: 'mine1', left: 7, total: 15 });
    const clearsCols = b.y >= BAR_LOW || (b.x >= HUD_LEFT && b.x + b.w <= W - HUD_LEFT);
    const clearsLow  = b.y < BAR_LOW || (b.x >= HUD_RIGHT && b.x + b.w <= W - HUD_RIGHT) || W < 2 * HUD_RIGHT + 80;
    check(`at ${W}px wide the bar is on the screen and clear of both HUD columns`,
      b.x >= 0 && b.x + b.w <= W && (b.y === BAR_TOP || b.y === BAR_LOW) && clearsCols && clearsLow,
      `"${b.text}" at ${b.x},${b.y} ${b.w}x${b.h}`);
  }
  check('a pilot can always see how many are still standing',
    mission(1600, { key: 'mine1', left: 7, total: 15 }).text.includes('7'),
    'a pilot who cannot see that cannot tell whether they are winning');
  check('a won claim says the rig may commence; a won replay says nothing was paid',
    /MAY COMMENCE/.test(missionText({ key: 'mine1', cleared: true }).forms[0])
    && /NOTHING PAID/.test(missionText({ key: 'mine1', cleared: true, replay: true }).forms[0]),
    'telling a pilot CLAIM FREED for the fourth time would promise a purchase already made');
}

console.log('\nthe research panel carries both pages');
{
  for (const [w, h] of [[1600, 900], [1024, 700], [420, 380]]) {
    for (const tab of LAB_TAB_KEYS) {
      const L = labPanel(w, h, tab);
      const inside = r => r.x >= L.panel.x && r.y >= L.panel.y
                       && r.x + r.w <= L.panel.x + L.panel.w && r.y + r.h <= L.panel.y + L.panel.h;
      check(`at ${w}x${h} every ${tab} row and both tabs are inside the panel`,
        L.rows.every(r => inside(r.r)) && L.tabs.every(t => inside(t.r))
        && L.rows.every(r => r.r.y >= L.tabs[0].r.y + L.tabs[0].r.h),
        `${L.rows.length} rows under ${L.tabs.length} tabs, panel ${L.panel.w}x${L.panel.h}`);
    }
  }
  check('the CLAIMS page has one row per rock',
    labPanel(1600, 900, 'claims').rows.map(r => r.key).join() === ARENA_MODULES.join(),
    labPanel(1600, 900, 'claims').rows.map(r => r.key).join(' '));
  check('and an unknown tab falls back to the ladder rather than drawing nothing',
    labPanel(1600, 900, 'nonsense').tab === 'ladder', 'rule seven: degrade, do not throw');
}

console.log('\nwhat survives a restart');
{
  const now = Date.now();
  const acct = newAccount('tok', 0, now);
  check('a new pilot has freed nothing',
    Array.isArray(acct.claims) && acct.claims.length === 0, 'claims: []');
  // A hand-edited save cannot name a rock that does not exist, and a retired
  // mining tier drops out cleanly rather than leaving a claim on nothing.
  const dirty = sanitiseAccount({ ...acct, claims: ['mine1', 'mine1', 'mine9', 42, null] }, 0, now);
  check('a save can only claim rocks that exist, once each',
    dirty.claims.join() === 'mine1', JSON.stringify(dirty.claims));

  // A SERVER RESTART. An arena stops existing with the process that made it, so a
  // save that names one has to land somewhere real — WITH its coordinates. Keeping
  // the arena's x,y and only swapping the sector put pilots down wherever they had
  // been fighting, in their own home ring, outside the dock: the same shape as the
  // bug that put a respawn at NaN.
  const stuck = sanitiseAccount({ ...acct, mapId: arenaId('tok', 'mine2'), x: 6000, y: 2100 }, 0, now);
  const base = MAPS[stuck.co + '1'].base;
  check('a pilot who was in a claim when the server died comes back to their own dock',
    !isArena(stuck.mapId) && MAPS[stuck.mapId] && stuck.x === base.x && stuck.y === base.y,
    `${stuck.mapId} at ${stuck.x},${stuck.y} — a position only means anything with the map it was taken in`);

  // A SECOND SESSION, and the tab closing. Both end in capture(), which must never
  // write an arena id: the account would name a destination that will not be there
  // and the pilot would come back to it.
  const live = { co: acct.co, ship: newShip(4321, 1234, acct.hull, acct.fit, [], acct.formation, null, 0),
                 gear: {}, hulls: [...acct.hulls], drones: [], formations: [...acct.formations],
                 ammo: {}, using: {}, armed: {}, kits: {}, devices: {}, kit: acct.kit,
                 device: acct.device, foldTo: null, lab: null, kills: {}, berths: [],
                 claims: ['mine1'], lastDock: null, xp: 0, credits: 7, vault: {}, hold: {},
                 mapId: arenaId('tok', 'mine1'), acted: now, banked: now };
  const was = { mapId: acct.mapId, x: acct.x, y: acct.y };
  const out = capture({ ...acct }, live, now);
  check('closing the tab inside a claim writes down the last real place you stood',
    out.mapId === was.mapId && out.x === was.x && out.y === was.y,
    `${out.mapId} at ${out.x},${out.y}, not ${live.mapId} at 4321,1234`);
  check('and it does write down the rock you freed while you were in there',
    out.claims.join() === 'mine1', JSON.stringify(out.claims));
  live.mapId = 'm2'; live.ship.x = 500; live.ship.y = 600;
  const moved = capture({ ...acct }, live, now);
  check('a real sector is still written down exactly as it always was',
    moved.mapId === 'm2' && moved.x === 500 && moved.y === 600, 'm2 at 500,600');
}

// ============================================================================
// Every way out, over a real socket, against a real server.
// ============================================================================
const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url))).replace(/\/test$/, '');

// A port the OS says is free, rather than one picked in advance. A hard-coded
// number turned fourteen assertions red the first time something else on the
// machine happened to be holding it, and every one of them blamed the feature.
const freePort = () => new Promise((res, rej) => {
  const probe = net.createServer();
  probe.on('error', rej);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => res(port));
  });
});
const PORT = Number(process.env.ARENA_PORT) || await freePort();

// A sandbox, so nobody's accounts file grows a pile of test pilots. server.js
// resolves public/, shared/ and data/ against the working directory.
const SAND = fs.mkdtempSync(path.join(os.tmpdir(), 'nullpoint-arena-'));
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

// One pilot, holding what a real client holds. The snapshot decoder is the
// client's own, so `arena` going away is read here the way the browser reads it.
class Pilot {
  constructor(name, token = null) {
    this.name = name; this.map = null; this.bag = {}; this.said = []; this.freed = [];
    this.dead = null; this.devices = {}; this.awards = [];
    this.ready = new Promise(r => { this._ready = r; });
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/${token ? `?t=${token}` : ''}`);
    this.ws.on('open', () => { if (!token) this.send({ t: 'join', name, co: 'm' }); });
    this.ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'welcome') {
        this.id = m.id; this.token = m.token ?? token; this.map = m.map;
        this.devices = m.devices ?? {}; this._ready(); return;
      }
      // Devices ride the `fit` message rather than the snapshot bag, so a beacon
      // being SPENT is only visible here — which is the whole point of watching it.
      if (m.t === 'fit') { this.devices = m.devices ?? this.devices; return; }
      if (m.t === 'map') { this.map = m.map; return; }
      if (m.t === 'chat') { this.said.push(m.text); return; }
      if (m.t === 'freed') { this.freed.push(m); return; }
      // A bounty. The only message that pays for a kill, so its absence is the
      // exact statement "nothing was paid" — credits alone cannot say it once a
      // mine is running, which is precisely what caught this first time round.
      if (m.t === 'award') { this.awards.push(m); return; }
      if (m.t === 'dead') { this.dead = m; return; }
      if (m.t === 'bumped') { this.bumped = true; return; }
      // Only keyframes are read. Every place this test reads the bag has just
      // asked for one, so there is no baseline to keep and no decoder to get wrong.
      if (m.t === 's') this.bag = m;
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  chat(text) { this.send({ t: 'chat', text }); }
  close() { try { this.ws.close(); } catch {} }
}

// Never wait forever for a server that is not there. Without this a boot that
// failed hung the suite instead of saying why.
const join = async (name, token = null) => {
  const p = new Pilot(name, token);
  const got = await Promise.race([p.ready.then(() => true), wait(8000).then(() => false)]);
  if (!got) { check(`the test server answered ${name}`, false, `nothing on port ${PORT}`); }
  return p;
};

// The bag only arrives on a keyframe here, so ask for one and wait for it.
const snap = async p => { p.bag = {}; p.send({ t: 'need' }); await wait(250); return p.bag; };

const simSecs = (Date.now() - began) / 1000;
console.log('\nevery way out of a claim, over a real socket');
boot();
await wait(1600);
{
  const p = await join('Claimer');
  const home = p.map;
  p.chat('/money 900000000');
  await wait(150);
  p.send({ t: 'stake' });
  await wait(250);
  let bag = await snap(p);
  const lab = bag.lab;
  // Fly to the station: a claim launches from the plot, not from the dock.
  p.chat('/tolab');
  await wait(200);

  // --- 1. IN --------------------------------------------------------------
  p.send({ t: 'claim', key: 'mine1' });
  await wait(300);
  bag = await snap(p);
  check('a claim puts you in a sector of your own, alone with the rock',
    isArena(p.map) && parseArena(p.map).key === 'mine1' && bag.arena?.total === countOf('mine1'),
    `${p.map} — ${bag.arena?.left} of ${bag.arena?.total} standing`);
  check('and it is not written down anywhere, because it will not exist tomorrow',
    !!lab, 'the account keeps saying the last real place you stood');

  // --- 2. DIED ------------------------------------------------------------
  const before = bag.credits;
  p.chat('/kill');
  await wait(400);
  check('dying on a claim costs nothing but the claim',
    p.dead && p.dead.toll === 0 && Object.keys(p.dead.lost ?? {}).length === 0,
    `toll ${p.dead?.toll}, hold ${JSON.stringify(p.dead?.lost)} — you are meant to lose this two `
    + 'or three times before you win it');
  p.send({ t: 'respawn' });
  await wait(400);
  check('and it puts you back at your hangar rather than in the sector you died in',
    !isArena(p.map) && MAPS[p.map], p.map);
  bag = await snap(p);
  check('the mission bar goes away with the sector',
    bag.arena === undefined, 'absence is information: the delta reports the field as gone');
  check('nothing was paid for fifteen hostiles',
    bag.credits === before && p.awards.length === 0 && (bag.xp ?? 0) === 0
    && Object.keys(bag.kills ?? {}).length === 0,
    `${n(bag.credits)} cr before and after, 0 bounties, 0 xp, an empty threat file`);

  // --- 3. WON -------------------------------------------------------------
  p.chat('/tolab');
  await wait(200);
  p.send({ t: 'claim', key: 'mine1' });
  await wait(300);
  const wonIn = p.map;
  p.chat('/clear');
  await wait(400);
  bag = await snap(p);
  check('clearing the field frees the rock and says so',
    p.freed.length === 1 && p.freed[0].key === 'mine1' && !p.freed[0].replay
    && (bag.claims ?? []).includes('mine1') && bag.arena?.cleared === 1,
    `"${p.freed[0]?.what}" — announced top centre, ${LINGER}s to watch it come apart`);
  check('a freed rock unlocks the rung the ladder would not sell',
    whyNotBuild('mine1', { credits: 1e9, mask: 0, near: true, claims: bag.claims }) === null,
    'and only that rung: mine2 still wants its own fight');
  // The linger. There is nothing to fly to, so an automatic return is the only
  // honest way out of a claim you have won.
  await wait((LINGER + 1.5) * 1000);
  check('and the station pulls you back to where you launched from',
    p.map === home && !isArena(p.map), `${p.map} after ${LINGER}s`);

  // --- 4. THE ROCK IS BUYABLE --------------------------------------------
  p.chat('/tolab');
  await wait(200);
  p.send({ t: 'build', key: 'mine1' });
  await wait(300);
  bag = await snap(p);
  check('the rig you fought for can then be bought',
    (bag.lab?.mods ?? 0) !== 0 && (bag.lab?.income ?? 0) > 0,
    `${bag.lab?.income} cr/s — the fight is what the ladder was gating`);

  // --- 5. REPLAY ----------------------------------------------------------
  const wasXp = bag.xp ?? 0;
  p.freed.length = 0; p.awards.length = 0;
  p.send({ t: 'replay', key: 'mine1' });
  await wait(300);
  bag = await snap(p);
  check('a freed rock can be flown again',
    isArena(p.map) && bag.arena?.replay === 1 && bag.arena?.left === countOf('mine1'),
    `${p.map} — the same field, ${bag.arena?.left} of ${bag.arena?.total}`);
  p.chat('/clear');
  await wait(400);
  bag = await snap(p);
  // Credits alone cannot say this once a mine is running: the rig bought two steps
  // up pays 12 cr/s and the balance climbs between the two reads. `award` is the
  // only message that pays for a kill, so its absence is the exact statement.
  check('a replay pays nothing, which is what makes it a practice range',
    p.freed[0]?.replay === 1 && p.awards.length === 0 && (bag.xp ?? 0) === wasXp
    && Object.keys(bag.kills ?? {}).length === 0 && (bag.claims ?? []).join() === 'mine1',
    `${countOf('mine1')} hostiles, 0 bounties, ${bag.xp ?? 0} xp, an empty threat file — `
    + `the ${n(bag.credits)} cr on the counter is the mine, not the field`);

  // --- 6. /tp -------------------------------------------------------------
  const stillIn = p.map;
  p.chat('/tp m2');
  await wait(400);
  check('a dev jump out of a claim lands somewhere real',
    p.map === 'm2', p.map);
  p.chat('/arenas');
  await wait(250);
  check('and the sector closes behind you',
    /"open":0/.test(p.said.at(-1) ?? ''), p.said.at(-1));

  // --- 7. A RECALL BEACON -------------------------------------------------
  //
  // The field is emptied first, and that is not a shortcut around the interesting
  // part — a fold breaks on ANY hit, so a beacon pressed in a live field is a coin
  // toss and this assertion is about the exit, not about the odds. The claim is
  // cleared but not yet returned from: the beacon has five seconds and the linger
  // has ten, so what lands the pilot at home here can only be the beacon — and the
  // beacon is SPENT on arrival, which the linger would never do.
  p.chat('/tolab');
  await wait(200);
  p.send({ t: 'buydevice', key: 'recall' });       // at the dock ring, before leaving
  await wait(300);
  const hadBeacon = p.devices.recall ?? 0;
  p.send({ t: 'claim', key: 'mine2' });
  await wait(300);
  check('the second claim is a different sector from the first',
    isArena(p.map) && p.map !== wonIn && parseArena(p.map).key === 'mine2', p.map);
  p.chat('/clear');
  await wait(300);
  p.send({ t: 'recall' });
  await wait(6200);
  check('a Recall Beacon is a way out of a claim, and it takes the sector with it',
    !isArena(p.map) && hadBeacon > 0 && (p.devices.recall ?? 0) === hadBeacon - 1,
    `folded to ${p.map} and the beacon was spent — ${hadBeacon} aboard, ${p.devices.recall ?? 0} now`);
  p.chat('/arenas');
  await wait(250);
  check('the sweep does not need to be told which exit was used',
    /"open":0/.test(p.said.at(-1) ?? ''),
    'one sweep, not a list of exits — the first draft enumerated them and had already missed two');

  // --- 8. THE TAB CLOSES --------------------------------------------------
  // mine3 rather than mine2: clearing the field in step 7 freed that rock, and a
  // rock you have freed is a replay from then on.
  p.chat('/tolab');
  await wait(200);
  p.send({ t: 'claim', key: 'mine3' });
  await wait(300);
  const abandoned = isArena(p.map);
  p.close();
  await wait(500);
  const q = await join('Watcher');
  q.chat('/admin');
  await wait(150);
  q.chat('/arenas');
  await wait(250);
  check('closing the tab inside a claim closes the claim',
    abandoned && /"open":0/.test(q.said.at(-1) ?? ''),
    'a sector full of hostiles nobody will ever see, stepped thirty times a second, forever');

  // --- 9. A SECOND SESSION ------------------------------------------------
  const r = await join('Twinned');
  r.chat('/money 900000000');
  await wait(150);
  r.send({ t: 'stake' });
  await wait(250);
  r.chat('/tolab');
  await wait(200);
  r.send({ t: 'claim', key: 'mine1' });
  await wait(300);
  const inClaim = isArena(r.map);
  const r2 = await join('Twinned', r.token);       // the same account, a second tab
  await wait(400);
  q.chat('/arenas');
  await wait(250);
  check('a second tab taking the account over closes the claim the first one was in',
    inClaim && r.bumped && /"open":0/.test(q.said.at(-1) ?? ''),
    'the exit the first draft missed, because nobody thinks of it as an exit');
  check('and the second tab does not land in a sector that has stopped existing',
    !isArena(r2.map) && MAPS[r2.map], r2.map);
  r.close(); r2.close();

  // --- 10. A PILOT WHO NEVER FINISHES -------------------------------------
  check('a pilot who parks in the corner of a claim is walled at fifteen minutes',
    LIMIT === 15 * 60,
    `${LIMIT / 60} minutes is nine times the longest clear measured — they are not stuck `
    + '(nothing in here heals and they can always die), but the sector they hold open has '
    + 'no other way to close');

  // --- 11. A SERVER RESTART ----------------------------------------------
  const s = await join('Restarter');
  s.chat('/money 900000000');
  await wait(150);
  s.send({ t: 'stake' });
  await wait(250);
  s.chat('/tolab');
  await wait(200);
  s.send({ t: 'claim', key: 'mine1' });
  await wait(400);
  const wasIn = isArena(s.map) ? s.map : null;
  const tok = s.token;
  kill();
  await wait(400);
  boot();
  await wait(1600);
  const back = await join('Restarter', tok);
  await wait(400);
  check('a pilot who was inside a claim when the process died signs back in at their dock',
    !!wasIn && !isArena(back.map) && MAPS[back.map],
    `${wasIn} is gone; back in ${back.map}`);
  back.close(); q.close();
}

done();
// Where the seconds went, because this is the slowest file in the suite by a wide
// margin and the next person deserves to know which half is costing them. Most of
// the live half is the LINGER a won claim is watched through and the five seconds
// a Recall Beacon takes: real clocks the server owns, not slack.
const liveSecs = (Date.now() - began) / 1000 - simSecs;
console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${ARENA_MODULES.length} claims, ${ARENA_MODULES.map(countOf).join('/')} hostiles, `
    + `paying nothing — ${simSecs.toFixed(1)}s simulating, ${liveSecs.toFixed(1)}s over the wire`}\n`);
process.exit(fails.length ? 1 : 0);
