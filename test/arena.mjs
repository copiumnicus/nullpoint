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
         ARENA_KEYS, CLAIM_KEYS, SALVAGE_KEYS, ARENA_PREFIX } from '../shared/maps.js';
import { MODULES, MODULE_KEYS, tiersOf, addMod, hasMod, incomeOf, whyNotBuild, rowState,
         labPanel, missionOf, MISSION_KINDS, LAB_TAB_KEYS, TREE } from '../shared/research.js';
import { ARENAS, ARENA_MODULES, SALVAGE_MODULES, rosterOf, countOf,
         fieldEhp, fieldBounty, fieldDps, postsFor, arrivalAt, assumedFor, kindOf,
         whyNotClaim, whyNotSalvage, whyNotRun, whyNotReplay, claimState, salvageState,
         missionText, mission, PAYS, RING_R, ARRIVE_R, LINGER, LIMIT, weightOf,
         LADDER_PRICE, budgetFor,
         BAR_TOP, BAR_LOW, BAR_H, HUD_LEFT, HUD_RIGHT } from '../shared/arena.js';
import { newAccount, sanitiseAccount, capture } from '../shared/account.js';
import { FOLD_SECS } from '../shared/fold.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const n = x => Math.round(x).toLocaleString('en-US');
const began = Date.now();

// The pilot each tier assumes, resolved once: a finished build with that tier's
// research mask on it. Every reading in this file is stated against it rather than
// against a constant, which is the thing that makes a hull-table change show up
// here instead of silently.
const pilots = {};

// ============================================================================
// the simulation — server.js's tick, one sector, one pilot
// ============================================================================
const DT = 1 / 30;
const arenaFor = key => mapOf(arenaId('probe', key));
// The ladder walk in the gate block below re-derives what assumedFor does, so it
// needs nextOn without adding a ninth name to that import list.
const R2 = await import('../shared/research.js');

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
function run(map, ship, list, policy, { limit = 600, curve = null } = {}) {
  let t = 0, bolts = [], rockets = [], pyres = [], dealt = 0, taken = 0;
  const pool = poolOf(ship);
  const marks = curve ? Object.keys(curve).map(Number).sort((a, b) => a - b) : [];
  let markAt = 0;
  while (t < limit) {
    const live = list.filter(a => a.dead <= 0 && a.hp > 0);
    if (!live.length || ship.hp <= 0) break;
    // THE ARRIVAL CURVE, and it is the fight. With everything coming at once what
    // decides a claim is not how much there is but how fast it turns up: a flat
    // curve is fifteen guns firing together, a rising one is a stream you can work
    // through. It is sampled rather than asserted on directly, because it is what a
    // designer needs to see to tune this.
    if (curve && markAt < marks.length && t >= marks[markAt]) {
      curve[marks[markAt]] += live.filter(a =>
        Math.hypot(a.x - ship.x, a.y - ship.y) <= Math.max(ship.stats.weaponRange, a.stats.weaponRange)).length;
      markAt++;
    }

    step(ship, DT); stepDrift(ship, DT, holdShear(ship, DT)); stepVitals(ship, DT, false);
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

// "played well against a field that is ALL coming, from everywhere": the play the
// designer described, and a third policy because neither of the other two can
// express it. `allIn` flies at the rock and holds the trigger. `kite` holds station
// at its own gun's range off the NEAREST thing — which, when everything is already
// converging, is standing still inside the blob, and it is why the bench reported
// this design as unplayable. `stream` keeps moving so the field stretches, and
// shoots whatever is cheapest to REMOVE rather than whatever is closest: with the
// whole field engaged the only thing that matters is how fast the incoming total
// comes down. It orbits rather than running in a straight line, because a pilot at
// 128 cannot outrun anything in this bestiary and a straight run ends at a wall
// with the field on top of it.
const stream = rock => {
  let dir = 1, chosen = false;
  return (ship, live) => {
    const pool = poolOf(ship);
    const worth = a => ((a.hp + a.shield) * (ALIENS[a.kind].effort ?? 1))
                     / Math.max(1, threatDps(a.kind, pool, ship.stats.hull));
    const reach = ship.stats.weaponRange;
    const near = live.filter(a => Math.hypot(a.x - ship.x, a.y - ship.y) < reach * 1.3);
    const foe = (near.length ? near : live).slice().sort((a, b) => worth(a) - worth(b))[0];
    const R = 3000;
    const ang = Math.atan2(ship.y - rock.y, ship.x - rock.x);
    if (!chosen) { chosen = true; dir = 1; }
    const ahead = ang + dir * 0.55;
    let wx = rock.x + Math.cos(ahead) * R, wy = rock.y + Math.sin(ahead) * R;
    for (const a of live) {                        // never stand in a ring
      if (!burnOf(a.def)) continue;
      const br = a.def.burn.reach + 140;
      const dx = wx - a.x, dy = wy - a.y, dd = Math.hypot(dx, dy) || 1;
      if (dd < br) { wx = a.x + (dx / dd) * br; wy = a.y + (dy / dd) * br; }
    }
    ship.tx = Math.max(500, Math.min(MAP_W - 500, wx));
    ship.ty = Math.max(500, Math.min(MAP_H - 500, wy));
    ship.dx = ship.dy = null;
    return foe;
  };
};

// ============================================================================
const EVERY_ARENA = [...ARENA_MODULES, ...SALVAGE_MODULES];
for (const key of EVERY_ARENA) {
  const b = buildFor('finished');
  const sh = newShip(0, 0, b.hull, b.fit, b.drones, 'line', null, assumedFor(key).mask);
  pilots[key] = { ehp: sh.stats.hull + sh.stats.shield, hull: sh.stats.hull };
}

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
  // Rewritten rather than deleted when duels arrived. The rule it states is still
  // exactly the rule — a mining tier with no field would be a rung nobody could ever
  // buy — but ARENA_KEYS is now every INSTANCED sector and a duel is one of those
  // without being a claim. CLAIM_KEYS is the half this rule was always about.
  check('every claim tier has a sector template and every template has a claim',
    CLAIM_KEYS.every(k => ARENAS[k]) && ARENA_MODULES.every(k => CLAIM_KEYS.includes(k)),
    ARENA_MODULES.join(' '));
  check('and a duel is an instanced sector that is deliberately not a claim',
    ARENA_KEYS.includes('duel') && !CLAIM_KEYS.includes('duel') && !ARENAS.duel,
    `${ARENA_KEYS.length} instanced templates, ${CLAIM_KEYS.length} of them rocks`);
  check('and the claim list IS the mining ladder, read off research rather than written twice',
    ARENA_MODULES.join() === tiersOf('mine').join(),
    'a fourth mining tier with no field would be a rung nobody could buy');

  // The salvage run is the same generalisation one step on: a second KIND of
  // instanced sector, sharing every mechanism a claim has and differing in what is
  // standing in the middle of it.
  const sid = arenaId('abc123', SALVAGE_MODULES[0]);
  const sm = mapOf(sid);
  check('a salvage run is the claim sector with a hulk in it instead of a rock',
    sm.arena && sm.hunt && sm.portals.length === 0 && !sm.base && !sm.rock && !!sm.wreck
    && havenKind(sm, { x: MAP_W / 2, y: MAP_H / 2 }) === null,
    `${sm.name} — no portals, no sanctuary, everything sees you, and one landmark: ` +
    `a wreck r ${sm.wreck.r} where a claim has a rock r ${mapOf(id).rock.r}`);
  check('and never both, so the client draws one picture and never has to ask which',
    ARENA_KEYS.map(k => mapOf(arenaId('t', k))).every(x => !(x.rock && x.wreck)),
    'two names for two objects, rather than one name covering both');
  // BOTH DIRECTIONS. A module naming a mission nobody built is a row that can never
  // be finished; an arena for a module that never asks for one is a sector nobody
  // can reach. Either would be silent.
  // THREE tables have to agree: MODULES names a mission, ARENAS gives it a roster,
  // and the sector table in maps.js gives it somewhere to stand. A key in any two of
  // them and not the third is a row that can never be finished, a sector nobody can
  // reach, or a fold into a map that does not exist — and none of the three would
  // say a word about it.
  check('every mission a module names has a roster and a sector, and none of the three has a spare',
    MODULE_KEYS.filter(k => missionOf(k)).every(k => !!ARENAS[k] && kindOf(k) === missionOf(k))
    && Object.keys(ARENAS).every(k => missionOf(k) === kindOf(k))
    && SALVAGE_KEYS.join() === SALVAGE_MODULES.join()
    && CLAIM_KEYS.join() === ARENA_MODULES.join()
    && MODULE_KEYS.every(k => missionOf(k) === null || MISSION_KINDS.includes(missionOf(k))),
    MODULE_KEYS.filter(k => missionOf(k)).map(k => `${k}:${missionOf(k)}`).join(' ') +
    ` — maps.js posts ${CLAIM_KEYS.length} claim sectors and ${SALVAGE_KEYS.length} salvage`);
  check('a salvage prize is a tech tree row rather than a rung of a ladder',
    SALVAGE_MODULES.every(k => TREE.includes(MODULES[k].line) && tiersOf(MODULES[k].line).length === 1),
    SALVAGE_MODULES.map(k => `${k} on line "${MODULES[k].line}"`).join(', ') +
    ` — the tree is ${TREE.join(', ')}`);
  check('and it is the first thing in the game that has no price at all',
    SALVAGE_MODULES.every(k => MODULES[k].price === 0),
    'zero is not a discount — `mission` is what gates it, and no amount of credits opens that');
}

console.log('\nthe field');
{
  for (const key of ARENA_MODULES) {
    const kinds = rosterOf(key).map(([k]) => k);
    check(`${key} posts ${countOf(key)} hostiles, all of them real`,
      kinds.every(k => ALIENS[k]) && postsFor(key).length === countOf(key),
      rosterOf(key).map(([k, c]) => `${c} ${k}`).join(' + '));
  }
  for (const key of SALVAGE_MODULES) {
    const kinds = rosterOf(key).map(([k]) => k);
    check(`${key} posts ${countOf(key)} hostiles in depth, all of them real`,
      kinds.every(k => ALIENS[k]) && postsFor(key).length === countOf(key),
      rosterOf(key).map(([k, c, r = RING_R]) => `${c} ${k} @${r}`).join(' + '));
  }
  // THE RING IS WHAT CAPS A FIELD, not the hit points, and this is the assertion
  // that keeps the reason. Twenty-five bodies on one 1,200px ring are 300px apart
  // and arrive as a wall (measured: 12 in weapons range at 5s, 0 of 4 cleared at
  // every weight tried). The depth is the whole of why the roster could grow.
  check('a claim stands on one ring and a salvage run stands in depth',
    ARENA_MODULES.every(k => new Set(rosterOf(k).map(e => e[2] ?? RING_R)).size === 1)
    && SALVAGE_MODULES.every(k => new Set(rosterOf(k).map(e => e[2] ?? RING_R)).size > 3),
    `the claims are all at ${RING_R}px; ` + SALVAGE_MODULES.map(k =>
      `${k} is at ${[...new Set(rosterOf(k).map(e => e[2] ?? RING_R))].sort((a, b) => a - b).join(' / ')}`).join(', '));
  check('and the claims are posted exactly where they always were, so their measurements still hold',
    ARENA_MODULES.every(k => postsFor(k).every(p2 =>
      Math.abs(Math.hypot(p2.x - MAP_W / 2, p2.y - MAP_H / 2) - RING_R) < 1e-6)),
    'an entry with no radius keeps RING_R — the depth is opt-in, per entry');

  // The one rule here that came out of a live socket rather than out of the model.
  // A Harrier runs at 8% of its hull and moves at 380 against a laden Bulwark's
  // 152, so the last of them simply left, healed at 4% a second, and there was no
  // way to finish the fight and no way out of the sector to abandon it.
  const runners = EVERY_ARENA.flatMap(k => rosterOf(k).map(([kind]) => kind))
    .filter(k => (ALIENS[k].flee ?? 0) > 0);
  check('nothing in ANY instanced fight can run away from you',
    runners.length === 0,
    'a hostile that breaks off in a sector with no exit is a stalemate, not an escape'
    + ` — ${WILD.filter(k => (ALIENS[k].flee ?? 0) > 0).join(', ')} are therefore barred`);
  // Every BARREL in the bestiary is harmless at this stage, which is why the
  // rosters are built out of the hostiles whose threat is a RATE instead.
  // `damage x fireRate` deliberately, not threatDps: the flat number is the thing
  // being called harmless, and threatDps exists precisely because it is not the
  // whole story — it folds in a mothership's escort and a mirror's chamber, which
  // are not barrels and are not what this is about.
  // NARROWED, not weakened, and the narrowing is what the claim was always about.
  // It measured every barrel in the WILD roster and asked that none of them could kill
  // a finished pilot inside twenty seconds. That was the same set as "what a claim can
  // post" for as long as every hostile in the game was postable in one, and it stopped
  // being when the Antiphon arrived: 711 dps needs 13.7s, and it is not in any roster,
  // is not meant to be, and could not be — a claim is a sector one pilot opens on their
  // own and this is posted for four.
  //
  // So it now reads the rosters, which is the set the argument is actually about, and
  // it is a STRICTER test than it was: adding a heavy barrel to a claim now fails here
  // where before it could be hidden by the average of the whole bestiary. The bestiary
  // number is kept in the detail, because "the heaviest gun in the game" is worth
  // printing next to it.
  const ehp = stageEhp('finished');
  const barrel = k => (ALIENS[k].attrs.damage ?? 0) * (ALIENS[k].attrs.fireRate ?? 0);
  const postable = [...new Set(ARENA_MODULES.flatMap(k => rosterOf(k).map(([kind]) => kind)))];
  const worst = postable.filter(k => barrel(k) > 0)
    .map(k => [k, ehp / barrel(k)]).sort((a, b) => a[1] - b[1])[0];
  const heaviest = WILD.filter(k => barrel(k) > 0)
    .map(k => [k, ehp / barrel(k)]).sort((a, b) => a[1] - b[1])[0];
  check('every gun a claim can post is harmless to the pilot it assumes',
    worst[1] > 20,
    `the heaviest barrel in a roster needs ${worst[1].toFixed(0)}s to kill a finished pilot `
    + `standing still (${worst[0]}, ${barrel(worst[0]).toFixed(0)} dps into ${n(ehp)} ehp) — `
    + 'damage x fireRate was only ever true at the anchor stage. The heaviest in the whole '
    + `bestiary is ${heaviest[0]}'s ${barrel(heaviest[0]).toFixed(0)} at ${heaviest[1].toFixed(0)}s, `
    + 'and it is deliberately not postable in a claim');
  // REWRITTEN. This asked that the field take more than a quarter of the ship a
  // second "if it all engages", which was a WORST CASE while a claim had an aggro
  // radius — most of the field was idle most of the fight, so a big nominal number
  // was the right thing to demand. A hunt has no idle half: everything engages, so
  // the nominal number IS the fight and it has to be survivable rather than large.
  // The claim underneath is the one that still means something — that the field is
  // sized to the pilot the tier assumes, not to a constant.
  for (const key of ARENA_MODULES) {
    const P = pilots[key] ?? { ehp, hull: ehp };
    const rate = fieldDps(key, P.ehp, P.hull) / P.ehp;
    check(`${key} engages all at once, and is survivable at that`,
      rate > 0.06 && rate < 0.22,
      `${(rate * 100).toFixed(0)}% of the ship a second with the WHOLE field on you — `
      + `${(1 / rate).toFixed(0)}s if you never killed anything, against ${LIMIT / 60} minutes `
      + 'of wall and a clear that takes about a minute');
  }
  // REWRITTEN. This said the three fields hit equally hard, which was true while the
  // roster was one size for three tiers. It is not: mine2 and mine3 assume a pilot
  // with twice and four times the hit points on the same gun, so the field grows
  // with them — in damage per hit point, which is the ring, rather than in bodies.
  const press = ARENA_MODULES.map(k => fieldDps(k, pilots[k].ehp, pilots[k].hull));
  check('the three claims escalate in what they throw, not in how long they take',
    press[2] > press[1] && press[1] > press[0]
    && fieldEhp('mine3') / fieldEhp('mine1') < 2,
    press.map((p, i) => `${ARENA_MODULES[i]} ${p.toFixed(0)} dps`).join('  ')
    + ` on ${ARENA_MODULES.map(k => countOf(k)).join('/')} bodies — `
    + 'the ring is the lever, because research buys hull and never damage');
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
  // REWRITTEN. This said the horizon was a seam and it was off, with the 0-of-12
  // measurement as the reason. It is on: a claim is a hunt, everything in it sees
  // you from anywhere and comes. The measurement was not wrong — it is why the
  // ROSTERS came down to fit inside it rather than why the chase stayed switched
  // off. Difficulty now comes from the sector, and the field is sized to survive it.
  check('everything in a claim sees you from anywhere on the map, and comes',
    noHorizon(claim) && claim.hunt === true,
    'there is no aggro radius in here and no corner to peel one off into — it is worth '
    + 'more than every roster change proposed for this feature, which is why the rosters '
    + 'came down rather than up');
  check('and the open world has no horizon and never will',
    !noHorizon(open) && open.hunt === undefined && ALIENS.ironhusk.aggro === 460,
    'hunt is set by arenaMap() and by nothing else — an Ironhusk out there still waits '
    + 'to be walked within 460px of, exactly as it always has');

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
  check('and it would beat the thing the fight is FOR by a hundred times over',
    perSec > MODULES.mine1.rate * 100 && perSec > best * 3,
    `the rig this claim unlocks pays ${MODULES.mine1.rate} cr/s and the whole mining ladder `
    + `pays ${best} — a field worth ${n(perSec)} a second (${(perSec / best).toFixed(1)}x the `
    + 'whole ladder) would make the rock pointless');
  check('a replay makes that argument absolute rather than merely strong',
    !PAYS.bounty,
    'a first claim can be won once; a replay can be won without limit, and no positive '
    + 'number survives being multiplied by "as often as you like" — zero is the only stable one');
  check('a replay is a proving ground instead: a known field, and dying in it costs nothing',
    ARENA_MODULES.every(k => whyNotReplay(k, { near: true, claims: ARENA_MODULES }) === null),
    'the only place a fit can be measured against an identical field, and the rehearsal '
    + 'for the next tier — mine2 is mine1 plus the Lamprey');

  // A SALVAGE RUN PAYS THE SAME NOTHING, and the argument is the same arithmetic
  // rather than "the same rule applies". The field is worth five times mine1's and
  // takes two and a half times as long to clear, so paying it would beat active
  // play by more than a claim would — and a replay is still unbounded.
  {
    const key = SALVAGE_MODULES[0];
    const worth = fieldBounty(key), rate = worth / 228;
    check('a salvage run pays nothing either, and it is refusing twice a claim\'s rate to do it',
      !PAYS.bounty && !PAYS.xp && !PAYS.ore && !PAYS.file,
      `${n(worth)} cr of bounty in 228s is ${n(rate)} cr/s against an actively-played ` +
      `${earnRate().toFixed(0)} — ${(rate / earnRate()).toFixed(0)}x, and ${(worth / bounty).toFixed(1)}x ` +
      `mine1's whole field for ${(rate / (bounty / 90)).toFixed(1)}x its rate`);
    check('and it is replayable on exactly the claims\' terms, for exactly their reason',
      whyNotReplay(key, { near: true, salvage: [key] }) === null,
      'the prize is a module and a module can only be granted once, so a second run is a ' +
      'proving ground — a known, identical field where dying costs nothing at all');
    // The one thing that IS different, and it is what makes the run worth flying at
    // all: the prize is not a permission slip, it is the module.
    check('what it pays instead is the module itself, which is the whole difference from a claim',
      MODULES[key].price === 0 && missionOf(key) === 'salvage',
      'a claim ends with the right to spend eight million credits; a salvage run ends with ' +
      'a row that no amount of credits could ever have opened');
  }
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

  // A MISSION HAS NO PRICE TO DERIVE FROM, so its budget is written down — and the
  // one written down is the whole ladder, because a salvage run is what a pilot
  // flies when there are no rungs left to climb. Derived off MODULES rather than
  // typed, so moving a rung moves the pilot this field assumes.
  const ladder = ['hull', 'shld'].flatMap(tiersOf).reduce((t, k) => t + MODULES[k].price, 0);
  check('a salvage run is calibrated to the top of the ladder rather than to a price',
    LADDER_PRICE === ladder && SALVAGE_MODULES.every(k => budgetFor(k) === LADDER_PRICE)
    && SALVAGE_MODULES.every(k => MODULES[k].price === 0),
    `${n(LADDER_PRICE)} of hull and shield rungs against a price of 0 — ` +
    `it assumes ${n(pilots[SALVAGE_MODULES[0]].ehp)} ehp where the deepest claim assumes ` +
    `${n(pilots.mine3.ehp)}`);
  check('and it is the only arena that assumes a pilot the whole shop cannot build',
    SALVAGE_MODULES.every(k => assumedFor(k).spent > Math.max(...spends)),
    `${n(assumedFor(SALVAGE_MODULES[0]).spent)} spent against ${n(Math.max(...spends))} at the deepest claim`);
}

console.log('\nthe fight, twelve spawn rotations per claim');
{
  const ROT = 12;
  const table = [];
  for (const key of ARENA_MODULES) {
    const map = arenaFor(key), mask = assumedFor(key).mask;
    let died = 0, cleared = 0, over = 0, secs = 0;
    const curve = { 5: 0, 15: 0, 30: 0, 60: 0 };
    for (let i = 0; i < ROT; i++) {
      const phase = (i / ROT) * Math.PI * 2;
      const ship = makePilot('finished', mask, -Math.PI / 2 + phase);
      const r = run(map, ship, makeRoster(key, map, phase), stream(map.rock), { limit: 900, curve });
      if (r.cleared) { cleared++; over += r.over; secs += r.secs; }
      if (r.died) died++;
    }
    // Flown badly: into the middle of the field, trigger held on whatever is
    // nearest. The first claim has to punish that or the ring means nothing.
    let inDied = 0, inCleared = 0;
    for (let i = 0; i < ROT; i++) {
      const phase = (i / ROT) * Math.PI * 2;
      const ship = makePilot('finished', mask, -Math.PI / 2 + phase);
      const r = run(map, ship, makeRoster(key, map, phase), allIn(map.rock), { limit: 900 });
      if (r.died) inDied++;
      if (r.cleared) inCleared++;
    }
    for (const t2 of Object.keys(curve)) curve[t2] = +(curve[t2] / ROT).toFixed(1);
    table.push({ key, cleared, died, inDied, inCleared, curve,
                 over: cleared ? over / cleared : 0, secs: cleared ? secs / cleared : 0 });
  }
  // REWRITTEN, twice now, and this time because the SECTOR changed rather than the
  // roster. It asked for 12 of 12 with no deaths, which was true while a claim was a
  // place you could be un-noticed in. A claim is a hunt: everything in it sees you
  // from anywhere and comes, so there is no phase of the fight where only part of
  // the field is engaged. The floor policy — no repair kit, no ability, no power
  // routing, no ammunition above cell1, and it is the only policy on the bench that
  // can express the intended play at all — clears it, and finishes on fumes.
  for (const row of table) {
    check(`${row.key} is clearable by the pilot it assumes, with the whole field on you`,
      row.cleared >= ROT - 4 && row.over < 0.4,
      `${row.cleared} of ${ROT} cleared with ${(row.over * 100).toFixed(0)}% of the ship left, `
      + `${row.secs.toFixed(0)}s — carrying none of the four things a real pilot brings`);
  }

  // THE ARRIVAL CURVE. Not an assertion about survival — an assertion that the field
  // arrives as a stream rather than as a wall, which is the whole of what makes a
  // claim different from anywhere else in the game. A flat curve means fifteen guns
  // at once however the survival numbers read.
  for (const row of table)
    check(`${row.key} arrives as a stream, not as a wall`,
      row.curve[15] > row.curve[5] && row.curve[5] < countOf(row.key) * 0.5,
      `${row.curve[5]} / ${row.curve[15]} / ${row.curve[30]} / ${row.curve[60]} in weapons range at `
      + `5 / 15 / 30 / 60s, of ${countOf(row.key)} — speeds `
      + `${[...new Set(rosterOf(row.key).map(([k]) => ALIENS[k].attrs.speed))].sort((a, b) => b - a).join(', ')}`);

  // REWRITTEN. "Flying into the middle kills you" was a claim about a sector you
  // could stand at the edge of. There is no edge now — the field comes to you
  // wherever you are, so flying at the rock and holding the trigger is not a
  // distinct mistake at the lower two tiers, it is simply the same fight. It stays
  // a real distinction at mine3, where the field is dense enough that being in the
  // middle of it while it converges is fatal. Asserted where it is true and stated
  // where it is not, rather than kept as a claim the sector no longer supports.
  check('the middle of the deepest claim still kills you',
    table[2].inDied >= ROT - 2,
    `${table[2].inDied} of ${ROT} dead flying at the rock against ${table[2].died} of ${ROT} `
    + `working the stream — at mine1 and mine2 the two are the same fight now `
    + `(${table[0].inDied} and ${table[1].inDied} dead), because a hunt has no edge to stand at`);

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
    + ' — a Censer and a Lamprey both bill in shares, which is what lets one roster '
    + 'shape serve three tiers whose pilots differ fourfold');
  check('an arena is a fight, not a siege',
    table.every(r => r.secs < LIMIT / 4),
    `the longest clear is ${Math.max(...table.map(r => r.secs)).toFixed(0)}s against a `
    + `${LIMIT / 60}-minute wall, so nothing that is actually a fight is ever cut short`);
}

// THE SALVAGE RUN, and its own block because it is a longer fight and a different
// claim. Six rotations rather than twelve: one run is 228 simulated seconds against
// a claim's 61, so twelve of them would be most of a minute of wall clock for a
// number six already answers.
console.log('\nthe salvage run, six spawn rotations, and the ladder it is the gate for');
{
  const ROT = 6;
  for (const key of SALVAGE_MODULES) {
    const map = arenaFor(key), mask = assumedFor(key).mask;
    let died = 0, cleared = 0, over = 0, secs = 0, inDied = 0;
    const curve = { 5: 0, 15: 0, 30: 0, 60: 0 };
    for (let i = 0; i < ROT; i++) {
      const phase = (i / ROT) * Math.PI * 2;
      const ship = makePilot('finished', mask, -Math.PI / 2 + phase);
      const r = run(map, ship, makeRoster(key, map, phase), stream(map.wreck), { limit: 900, curve });
      if (r.cleared) { cleared++; over += r.over; secs += r.secs; }
      if (r.died) died++;
      const s2 = makePilot('finished', mask, -Math.PI / 2 + phase);
      if (run(map, s2, makeRoster(key, map, phase), allIn(map.wreck), { limit: 900 }).died) inDied++;
    }
    for (const t2 of Object.keys(curve)) curve[t2] = +(curve[t2] / ROT).toFixed(1);
    const left = cleared ? over / cleared : 0, took = cleared ? secs / cleared : 0;
    check(`${key} is clearable by the pilot it assumes, and only just`,
      cleared >= ROT - 2 && left < 0.4,
      `${cleared} of ${ROT} cleared with ${(left * 100).toFixed(0)}% of the ship left in ` +
      `${took.toFixed(0)}s — the same band the claims read (7% / 11%), and the floor policy carries ` +
      'no repair kit, no ability, no power routing and no ammunition above cell1');
    check(`${key} arrives as a stream, not as a wall`,
      curve[15] > curve[5] && curve[5] < countOf(key) * 0.5,
      `${curve[5]} / ${curve[15]} / ${curve[30]} / ${curve[60]} in weapons range at 5 / 15 / 30 / 60s, ` +
      `of ${countOf(key)} — flat on one ring it read 12 at five seconds and cleared nothing`);
    check(`flying straight at ${key}'s hulk still kills you`,
      inDied >= ROT - 1,
      `${inDied} of ${ROT} dead running at the wreck with the trigger held, against ${died} working the stream`);
    // REWRITTEN FOR THIS ARENA rather than borrowed. "A fight, not a siege" is a
    // claim about a claim: 61 seconds against a 15-minute wall. A salvage run is
    // four times that and is deliberately the longest fight in the game, so the
    // claim that survives is the one about the WALL — it is never cut short.
    check('a salvage run is four minutes and still nowhere near the wall',
      took > 120 && took < LIMIT / 3,
      `${took.toFixed(0)}s against a ${LIMIT / 60}-minute wall — ${(796100 / 11307).toFixed(0)}s of that ` +
      'is pure shooting and the rest is the field coming to you, which is what the depth bought');
  }
}

// AND THE FIELD IS THE GATE, which is the thing nothing else in the game does. No
// function refuses an underpowered pilot; the roster does, and it does it at every
// rung of the ladder below the top. Measured rather than asserted from the design.
console.log('\nwhat the salvage field does to a pilot who is not ready for it');
{
  const key = SALVAGE_MODULES[0], map = arenaFor(key);
  const rungs = [10_000_000, 22_000_000, 30_000_000, 46_000_000, LADDER_PRICE];
  const rows = [];
  for (const budget of rungs) {
    // The same climb assumedFor does, against a budget of our choosing.
    let mask = 0, spent = 0;
    for (;;) {
      const next = ['hull', 'shld'].map(l => R2.nextOn(mask, l)).filter(Boolean)
        .sort((a, b) => MODULES[a].price - MODULES[b].price)[0];
      if (!next || spent + MODULES[next].price > budget) break;
      spent += MODULES[next].price; mask = addMod(mask, next);
    }
    let cleared = 0;
    const ROT = 3;
    for (let i = 0; i < ROT; i++) {
      const phase = (i / ROT) * Math.PI * 2;
      const ship = makePilot('finished', mask, -Math.PI / 2 + phase);
      const r = run(map, ship, makeRoster(key, map, phase), stream(map.wreck), { limit: 900 });
      if (r.cleared) cleared++;
    }
    const probe = makePilot('finished', mask);
    rows.push({ budget, ehp: probe.stats.hull + probe.stats.shield, cleared, of: ROT });
  }
  console.log('     ' + rows.map(r => `${n(r.budget)} ${n(r.ehp)}ehp ${r.cleared}/${r.of}`).join('   '));
  check('nothing refuses an unready pilot, and the field does it instead',
    rows.slice(0, -1).every(r => r.cleared === 0) && rows.at(-1).cleared > 0,
    rows.map(r => `${n(r.budget)}: ${r.cleared} of ${r.of}`).join(', ') +
    ' — which is why the row prints what it wants BEFORE you launch rather than after');
  check('and the row says so, so the gate is never silent',
    !!ARENAS[key].wants && salvageState(key, {}).wants === ARENAS[key].wants,
    `"${ARENAS[key].wants}" — printed on the TECH TREE row beside the hostile count`);
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
  // A WRECK, and every clause of it differs from a rock's, which is why it is a
  // second function rather than a flag.
  {
    const key = SALVAGE_MODULES[0];
    check('you cannot launch a salvage run from anywhere but your own station',
      whyNotSalvage(key, { near: false }) === 'fly to your station to launch a salvage run',
      whyNotSalvage(key, { near: false }));
    check('you go to a wreck with an empty hold, for the claim\'s reason exactly',
      /empty the hold/.test(whyNotSalvage(key, { near: true, hold: { iron: 1 } }) ?? ''),
      'a wreck costs nothing, so a laden pilot would use a deliberate death as a free flight home');
    check('and there is nothing else in the way — no price, no rank, no ladder order',
      whyNotSalvage(key, { near: true }) === null,
      'the FIELD is the gate; a second quieter copy of that rule here would be the silent refusal');
    check('a wreck you have stripped is not a wreck you can strip again',
      whyNotSalvage(key, { near: true, salvage: [key] }) === 'this wreck is already stripped',
      'it is a replay from then on, and a replay cannot be re-won');
    check('and a wreck you have not stripped is not one you can replay',
      whyNotReplay(key, { near: true }) === 'you have not stripped this wreck yet',
      whyNotReplay(key, { near: true }));
    // The bug this line exists for: bypass1 is tier 1, and `want` is never under 1,
    // so a salvage key walked the whole of whyNotClaim and came out returning null.
    check('and a claim cannot be launched at a wreck by naming it, however the key is spelled',
      whyNotClaim(key, { near: true }) === 'no claim on this'
      && whyNotSalvage('mine1', { near: true }) === 'nothing to salvage here',
      'each refuses the other kind by name — whyNotRun is the one door that dispatches');
    check('whyNotRun sends each key to its own refusal, so the panel and the server cannot disagree',
      whyNotRun(key, { near: false }) === whyNotSalvage(key, { near: false })
      && whyNotRun('mine1', { near: false }) === whyNotClaim('mine1', { near: false }),
      'one call site for both kinds, which is what the workshop dock refusing to sell for a day cost');
    check('the tech tree row knows it is a flight rather than a purchase',
      rowState(0, MODULES[key].line, 1e12, [], []).claim === true
      && rowState(0, MODULES[key].line, 1e12, [], []).mission === 'salvage'
      && rowState(0, MODULES[key].line, 0, [], [key]).claim === false,
      'STRIP THE WRECK until it is yours, and then it is simply RESEARCHED');
    check('and no amount of money builds it before the wreck is stripped',
      whyNotBuild(key, { credits: 1e12, mask: 0, near: true, salvage: [] })
        === 'the wreck is still held — strip it first'
      && whyNotBuild(key, { credits: 0, mask: 0, near: true, salvage: [key] }) === null,
      'a zero price that still refuses has to SAY why — a free row that silently does nothing ' +
      'is the complaint this codebase keeps earning');
    const sv = salvageState(key, { salvage: [], mask: 0 });
    check('the TECH TREE row says what the wreck is right now',
      sv.verb === 'STRIP THE WRECK' && sv.count === countOf(key) && !sv.stripped && !sv.built,
      `${sv.name}: ${sv.count} hostiles, "${sv.asks}"`);
    check('and a stripped one offers the flight again rather than a button that does nothing',
      salvageState(key, { salvage: [key], mask: addMod(0, key) }).verb === 'RUN IT AGAIN'
      && salvageState(key, { salvage: [key], mask: addMod(0, key) }).built,
      'stripped and installed are the same moment — the sweep writes both on the tick the field clears');
  }

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
  check('a won salvage run says the module is already aboard, not that a purchase may commence',
    /IS ON YOUR SHIP/.test(missionText({ key: SALVAGE_MODULES[0], cleared: true }).forms[0])
    && /MAY COMMENCE/.test(missionText({ key: 'mine1', cleared: true }).forms[0]),
    `"${missionText({ key: SALVAGE_MODULES[0], cleared: true }).forms[0]}" — a claim ends with ` +
    'permission to spend eight million credits and a wreck ends with the module fitted, so ' +
    'MAY COMMENCE would send a pilot to a counter with nothing on it');
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
  check('a new pilot has stripped nothing either',
    Array.isArray(acct.salvage) && acct.salvage.length === 0, 'salvage: []');
  const key = SALVAGE_MODULES[0];
  const dirtySv = sanitiseAccount({ ...acct, salvage: [key, key, 'wreck9', 7, null] }, 0, now);
  check('and it can only have stripped wrecks that exist, once each',
    dirtySv.salvage.join() === key, JSON.stringify(dirtySv.salvage));
  // THE RE-GRANT, in one direction only. A salvage prize lives on the account as a
  // list AND in the lab mask; sanitiseLab returns null for a lab it cannot parse and
  // sanitiseMods trims bits it does not know, so without this a save that lost its
  // station would come back with the wreck still listed and the reactor back on its
  // three second spool, saying nothing.
  const lost = sanitiseAccount({ ...acct, salvage: [key], lab: { slot: 3, mods: 0, since: now } }, 0, now);
  check('a flown mission is never confiscated by a mask that lost the bit',
    hasMod(lost.lab.mods, key),
    'the list can put the bit back; the bit can never put itself on the list — two records that ' +
    'could each write the other is the drift rule one names');
  check('and a pilot with no station keeps the record until they have one to put it in',
    sanitiseAccount({ ...acct, salvage: [key], lab: null }, 0, now).salvage.join() === key,
    'the fight was still won; there is simply nowhere to hang the module yet');

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
  check('and the wreck you stripped, by the same list and the same line',
    capture({ ...acct }, { ...live, salvage: [key] }, now).salvage.join() === key,
    'test/account.mjs fails BY NAME if capture() ever writes a field carried() does not hand back');
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

// GOING TO A CLAIM IS A FOLD NOW, not a teleport. Five seconds standing still,
// cancelled by anything that lands on you — the same fold a Recall Beacon runs, and
// the reason it is the same one is that an instant, uninterruptible ride out of a
// fight sitting free on the station panel is strictly better than the 3,400-credit
// interruptible one, which is the shape rule five calls pay-to-win.
//
// So every entry below waits it out. The wait is FOLD_SECS plus a few ticks of
// slack rather than a number somebody picked, so moving the fold moves the test
// with it. It costs the suite about five seconds per claim entry and that is the
// price of the fold actually being tested rather than mocked.
const FOLD_WAIT = FOLD_SECS * 1000 + 500;
const foldOut = async (p, msg, extra = 0) => { p.send(msg); await wait(FOLD_WAIT + extra); };

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
  await foldOut(p, { t: 'claim', key: 'mine1' });
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
  await foldOut(p, { t: 'claim', key: 'mine1' });
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
  await foldOut(p, { t: 'replay', key: 'mine1' });
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
  await foldOut(p, { t: 'claim', key: 'mine2' });
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
  await foldOut(p, { t: 'claim', key: 'mine3' });
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
  await foldOut(r, { t: 'claim', key: 'mine1' });
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
  await foldOut(s, { t: 'claim', key: 'mine1' }, 100);
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

  // --- 12. A SALVAGE RUN, END TO END --------------------------------------
  //
  // The whole of the second feature over one socket: fly it, clear it, take the
  // prize, watch the sector close, and come back after a restart still holding it.
  // Everything here is the CLAIM machinery — the same intent, the same fold, the
  // same sweep, the same linger — so what is being checked is the two things that
  // are not: the prize is a module rather than a permission, and it is on the ship.
  {
    const key = SALVAGE_MODULES[0];
    const sv = await join('Salvager');
    sv.chat('/money 900000000');
    await wait(150);
    sv.send({ t: 'stake' });
    await wait(250);
    sv.chat('/admin');
    await wait(150);
    sv.chat('/tolab');
    await wait(200);
    sv.chat('/arenas');
    await wait(250);
    const before = sv.said.at(-1) ?? '';

    await foldOut(sv, { t: 'claim', key }, 100);
    let bag = await snap(sv);
    check('a salvage run opens the same kind of sector a claim does, from the same intent',
      isArena(sv.map) && parseArena(sv.map).key === key && bag.arena?.total === countOf(key)
      && mapOf(sv.map).wreck && !mapOf(sv.map).rock,
      `${sv.map} — ${bag.arena?.left} of ${bag.arena?.total} standing around a hulk`);
    sv.chat('/arenas');
    await wait(250);
    check('and /arenas sees exactly one open where a moment ago there were none',
      /"open":0/.test(before) && /"open":1/.test(sv.said.at(-1) ?? ''),
      `${before.trim()} -> ${(sv.said.at(-1) ?? '').trim()}`);

    sv.chat('/clear');
    await wait(500);
    bag = await snap(sv);
    check('clearing it strips the wreck AND fits the module, on the same tick',
      sv.freed.length === 1 && sv.freed[0].key === key && sv.freed[0].salvage === 1
      && (bag.salvage ?? []).includes(key) && hasMod(bag.lab?.mods ?? 0, key),
      `"${sv.freed[0]?.what}" — the list says it was won and the mask says it is fitted, ` +
      'and there is no button anywhere in between');
    check('so the tech tree row is finished rather than offering a free purchase',
      whyNotBuild(key, { credits: 0, mask: bag.lab?.mods ?? 0, near: true, salvage: bag.salvage })
        === 'already built',
      'a claim ends with a rig to pay for; this ends with nothing left to press');

    // THE THING THE MODULE ACTUALLY DOES, over the wire, because a flag on a stat
    // block that never reaches the reactor would pass every test above.
    sv.send({ t: 'power', sys: 'weapons' });
    await wait(120);
    bag = await snap(sv);
    check('and the reactor is at full power one tick after the keypress, not three seconds',
      (bag.power?.lv?.weapons ?? 0) === 100 && (bag.power?.cap ?? 100) < 100,
      `weapons ${bag.power?.lv?.weapons}% and the capacitor already down to ${bag.power?.cap}% — ` +
      'a spooled reactor reads 3% at half a second');

    await wait((LINGER + 1.5) * 1000);
    check('the station pulls you back out of a won salvage run exactly as it does a claim',
      !isArena(sv.map) && MAPS[sv.map], `${sv.map} after ${LINGER}s`);
    sv.chat('/arenas');
    await wait(250);
    check('and the sector closes behind you, by the same sweep and no new exit',
      /"open":0/.test(sv.said.at(-1) ?? ''), sv.said.at(-1));

    // AND IT SURVIVES THE PROCESS. `salvage` is on the account and the mask is in
    // the lab, so a restart has to bring both back — this is the assertion that
    // would have caught a prize that only ever lived in memory.
    const svTok = sv.token;
    sv.close();
    await wait(300);
    kill();
    await wait(400);
    boot();
    await wait(1600);
    const again = await join('Salvager', svTok);
    await wait(500);
    const bag2 = await snap(again);
    check('and a stripped wreck survives a server restart, module and all',
      (bag2.salvage ?? []).includes(key) && hasMod(bag2.lab?.mods ?? 0, key),
      `salvage ${JSON.stringify(bag2.salvage)}, lab mask ${bag2.lab?.mods} — the list is the durable ` +
      'record and sanitiseAccount re-grants the bit from it');
    again.send({ t: 'power', sys: 'thrusters' });
    await wait(120);
    const bag3 = await snap(again);
    check('and the reactor still re-routes instantly on the far side of it',
      (bag3.power?.lv?.thrusters ?? 0) === 100,
      `thrusters ${bag3.power?.lv?.thrusters}% on the tick after signing back in`);
    again.close();
  }
  back.close(); q.close();
}

done();
// Where the seconds went, because this is the slowest file in the suite by a wide
// margin and the next person deserves to know which half is costing them. Most of
// the live half is the LINGER a won claim is watched through and the five seconds
// a Recall Beacon takes: real clocks the server owns, not slack.
const liveSecs = (Date.now() - began) / 1000 - simSecs;
console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${ARENA_MODULES.length} claims at ${ARENA_MODULES.map(countOf).join('/')} hostiles and `
    + `${SALVAGE_MODULES.length} salvage run at ${SALVAGE_MODULES.map(countOf).join('/')}, `
    + `paying nothing — ${simSecs.toFixed(1)}s simulating, ${liveSecs.toFixed(1)}s over the wire`}\n`);
process.exit(fails.length ? 1 : 0);
