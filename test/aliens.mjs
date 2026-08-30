import { outlineOf, CLOSER_HOLD, CLOSER_EDGE, THREAT_HOLD, THREAT_EDGE,
         farmHp, XP_RATE, BOUNTY_RATE, SPAWN_CLEAR,
         broodReady, shoveFromBase, BASE_KEEPOUT } from '../shared/aliens.js';
import { WILD, ALIENS, ALIENS_PER_MAP, effectiveHp, newAlien, respawnAlien, stepAlienAI, stepAlienRepair,
         forgetPlayer, roamPoint, rng, REPAIR_QUIET } from '../shared/aliens.js';
import { newShip, step, stepVitals, stepDrift, applyDamage, inBase, inHaven, HAVEN_R, SIGHT_R } from '../shared/sim.js';
import { fire, stepBolts, faceTarget, BOLT_SPEED, HIT_R } from '../shared/combat.js';
import { MAPS, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';
import { HULLS, resolve, DEFAULT_HULL } from '../shared/ships.js';
import { BOOST } from '../shared/power.js';
import { topTier } from '../shared/gear.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30, map = MAPS.m1, D = ALIENS.drifter;
const foe = (x, y, seed = 1) => { const a = newAlien('drifter', 1e6, map, seed); a.x = x; a.y = y; a.vx = a.vy = 0; return a; };
const con = (ship, id = 1) => [{ id, ship, haven: inHaven(map, ship) }];
const ehp = s => s.hp + s.shield;              // shields eat the first hits, so hull alone lies
const full = s => s.stats.hull + s.stats.shield;

// A real engagement: alien AI, movement, both guns, and bolts actually in flight.
function fight(a, p, secs, { playerFires = false, drive = null } = {}) {
  let t = 0, everTargeted = false, air = [], fired = 0;
  while (t < secs && a.hp > 0 && p.hp > 0) {
    if (drive) drive(p, t);
    const tgt = stepAlienAI(a, map, con(p), dt);
    if (tgt) everTargeted = true;
    step(a, dt); step(p, dt); stepVitals(a, dt); stepVitals(p, dt);
    faceTarget(a, tgt ? p : null);
    for (const s1 of fire(a, tgt ? p : null, dt)) { air.push(s1); fired++; }
    if (playerFires) {
      faceTarget(p, a);
      const volley = fire(p, a, dt);
      if (volley.length) { air.push(...volley); a.provoked.add(1); a.target ??= 1; }
    }
    stepBolts(air, dt);
    t += dt;
  }
  return { t, everTargeted, fired };
}

console.log('\nsanctuary');
const inRing = newShip(map.base.x + 200, map.base.y, 'vanguard');
check('the base ring is sanctuary', inHaven(map, inRing) && inBase(map, inRing));
const pg = map.portals[0];
check('so is a portal mouth', inHaven(map, { x: pg.x + HAVEN_R * 0.5, y: pg.y }), `${HAVEN_R | 0}px around it`);
check('open space is not', !inHaven(map, { x: map.base.x + 3000, y: map.base.y }));

const parked = newShip(map.base.x + 300, map.base.y, 'vanguard');
let r = fight(foe(map.base.x + 700, map.base.y), parked, 12);
check('an unprovoked alien will not start on someone docked', !r.everTargeted && ehp(parked) === full(parked),
  '12s sat next to it, untouched');
const atGate = newShip(pg.x + 60, pg.y, 'vanguard');
r = fight(foe(pg.x + 700, pg.y), atGate, 12);
check('nor on someone sitting in a portal', !r.everTargeted && ehp(atGate) === full(atGate));

console.log('\nengagement range');
check('an alien decides to fight from inside your sight, never outside it',
  D.aggro < SIGHT_R, `aggro ${D.aggro} vs guaranteed sight ${SIGHT_R}`);
check('the margin is worth something at the alien\'s own speed',
  (SIGHT_R - D.aggro) / D.attrs.speed > 0.4,
  `${SIGHT_R - D.aggro}px = ${((SIGHT_R - D.aggro) / D.attrs.speed).toFixed(2)}s to react before it commits`);
check('every window sees at least that far', (() => {
  return [[2560,1440],[1920,1080],[1600,900],[1440,900],[1280,800],[1100,700],[1024,640]].every(([W, H]) => {
    const z = Math.min(1, Math.min(W, H) / (2 * SIGHT_R));   // mirrors the client's resize()
    return Math.min(W, H) / 2 / z >= SIGHT_R - 0.01;
  });
})(), 'the client zooms out rather than letting a short window see less');
check('it gives up sooner than it used to, since it engages closer',
  D.leash > D.aggro * 2 && D.leash < 2400, `leash ${D.leash}`);

console.log('\naggression');
const open = newShip(map.base.x + 4000, map.base.y, 'vanguard');
r = fight(foe(map.base.x + 4000 + D.aggro - 200, map.base.y), open, 14);
check('in the open, inside aggro range, it engages', r.everTargeted && ehp(open) < full(open),
  `aggro ${D.aggro}px, took ${(full(open) - ehp(open)) | 0} damage`);
const distant = newShip(map.base.x + 4000, map.base.y, 'vanguard');
const far = foe(map.base.x + 4000 + D.leash + 900, map.base.y);
far.way = { x: far.x, y: far.y };                       // pin it so roaming can't wander into range
let seen = false;
for (let i = 0; i < 30 * 8; i++) if (stepAlienAI(far, map, con(distant), dt)) seen = true;
check('outside aggro range it ignores you', !seen);

console.log('\nprovocation overrides sanctuary');
const hider = newShip(map.base.x + 300, map.base.y, 'vanguard');
const angry = foe(map.base.x + 900, map.base.y);
angry.provoked.add(1);                                   // as if you had shot it
r = fight(angry, hider, 14);
check('once you shoot it, the base ring will not save you',
  r.everTargeted && ehp(hider) < full(hider), `${(full(hider) - ehp(hider)) | 0} damage taken while docked`);
check('and it follows you in', inBase(map, angry), 'the alien entered the ring');
const gateHider = newShip(pg.x + 40, pg.y, 'vanguard');
const angry2 = foe(pg.x + 800, pg.y); angry2.provoked.add(1);
r = fight(angry2, gateHider, 14);
check('a portal mouth will not save you either', r.everTargeted && ehp(gateHider) < full(gateHider));

console.log('\nbreaking off');
// y=1500 keeps the whole chase clear of the base ring, so nothing else interferes
const runner = newShip(10000, 1500, 'kestrel');
const chaser = foe(10600, 1500); chaser.provoked.add(1); chaser.target = 1;
fight(chaser, runner, 34, { drive: p => { p.dx = -1; p.dy = 0; } });   // full burn AWAY from it
check('outrunning it drops the lock', chaser.target === null,
  `kestrel ${resolve('kestrel').speed} vs drifter ${D.attrs.speed}`);
check('and it forgets the grudge', !chaser.provoked.has(1), 'so sanctuary works again');
const plodder = newShip(10000, 1500, 'bulwark');
const chaser2 = foe(10600, 1500); chaser2.provoked.add(1); chaser2.target = 1;
fight(chaser2, plodder, 20, { drive: p => { p.dx = -1; p.dy = 0; } });
const speeds = Object.keys(HULLS).map(h => resolve(h).speed).sort((a, b) => a - b);
check('alien speed sits just above the heaviest hull, and no higher',
  D.attrs.speed > speeds[0] && D.attrs.speed < speeds[1],
  `${speeds[0]} < ${D.attrs.speed} < ${speeds[1]} — heavies cannot walk away, and it stays clickable`);
check('a slower hull cannot simply run', chaser2.target === 1,
  `bulwark ${resolve('bulwark').speed} cannot break ${D.leash}px`);

console.log('\ndying settles it');
{
  const victim = newShip(map.base.x + 4000, map.base.y, 'vanguard');
  const killer = foe(victim.x + 500, victim.y);
  killer.provoked.add(1); killer.target = 1;
  fight(killer, victim, 4);
  check('it holds the grudge while you are alive', killer.provoked.has(1) && killer.target === 1);

  forgetPlayer([killer], 1);
  check('death clears the lock and the grudge', killer.target === null && !killer.provoked.has(1));

  // and now sanctuary works again, which is the point
  const reborn = newShip(map.base.x + 300, map.base.y, 'vanguard');
  killer.x = map.base.x + 900; killer.y = map.base.y;
  const r2 = fight(killer, reborn, 12);
  check('so it will not follow you into your own base afterwards',
    !r2.everTargeted && ehp(reborn) === full(reborn), '12s docked, untouched');
  check('it forgets nobody else', (() => {
    const a2 = foe(0, 0); a2.provoked.add(7); a2.provoked.add(9); a2.target = 7;
    forgetPlayer([a2], 9);
    return a2.provoked.has(7) && !a2.provoked.has(9) && a2.target === 7;
  })());
}

console.log('\nthe fight itself');
// Bare hulls, parked, trading shots. Three outcomes are possible and the log
// has to tell them apart: you kill it, it kills you, or it breaks off at 10%
// and strolls away from a ship that never moved to follow.
const outcome = (a, p, res) => a.hp <= 0 ? `killed it in ${res.t.toFixed(0)}s`
                             : p.hp <= 0 ? `DIED after ${res.t.toFixed(0)}s`
                                         : 'let it break off and escape';
for (const h of ['kestrel', 'vanguard', 'bulwark']) {
  const p = newShip(map.base.x + 4000, map.base.y, h);
  const a = foe(p.x + 900, p.y, 3);
  const res = fight(a, p, 200, { playerFires: true });
  console.log(`     ${h.padEnd(9)} ${outcome(a, p, res).padEnd(22)}` +
              ` — left with ${Math.max(0, ehp(p)) | 0}/${full(p)} effective`);
}
// The headline: once a ship is actually finished, the first thing you ever met
// dies in one trigger pull. This is the top of the curve the drifter is set from.
const TOP = topTier('weapon');
const decked = resolve('vanguard', { weapon: Array(3).fill(TOP), generator: [], tech: [] },
                       Array(6).fill(TOP), 'wedge');
const volley = decked.damage * (1 + BOOST);
const husk = D.attrs.hull + D.attrs.shield;
check('a fully outfitted Fighter kills one in a single volley', volley >= husk,
  `${Math.round(volley)} damage against ${husk} effective hp`);
check('and a bare one does not', resolve('vanguard').damage * (1 + BOOST) < husk,
  'the ship has to be finished first, not just bought');

// The bottom of the same curve: on day one, in the hull you are given, it is a
// real fight you can lose by standing still.
const st = newShip(map.base.x + 4000, map.base.y, 'hauler', { weapon: ['emitter1'], generator: [], tech: [] });
const stFoe = foe(st.x + 900, st.y, 3);
const stRes = fight(stFoe, st, 200, { playerFires: true });
console.log(`     starter hauler: ${stFoe.hp <= 0 ? 'killed it' : 'DIED'} in ${stRes.t.toFixed(0)}s` +
            ` — left with ${Math.max(0, ehp(st)) | 0}/${full(st)} effective`);
check('a starter hull can still win, but it costs', stFoe.hp <= 0 && ehp(st) < full(st) * 0.75,
  `${stRes.t.toFixed(0)}s, down to ${(100 * ehp(st) / full(st)) | 0}% of hull+shield`);
check('and it takes real time on day one', stRes.t > 5, `${stRes.t.toFixed(0)}s of unbroken fire`);
check('every hull out-ranges the alien',
  Object.keys(HULLS).every(h => resolve(h).weaponRange > D.attrs.weaponRange),
  `alien reaches only ${D.attrs.weaponRange}`);

// The interceptor loses a straight trade — it has to use the range it paid for.
const kite = newShip(3000, 1500, 'kestrel');
const kFoe = foe(2400, 1500, 3);
const band = resolve('kestrel').weaponRange - 30;
const kRes = fight(kFoe, kite, 200, { playerFires: true, drive: p => {
  const dx = p.x - kFoe.x, dy = p.y - kFoe.y, d = Math.hypot(dx, dy) || 1;
  if (d < band - 20)      { p.dx = dx / d;  p.dy = dy / d; }     // back off
  else if (d > band + 20) { p.dx = -dx / d; p.dy = -dy / d; }    // close up
  else                    { p.dx = 0; p.dy = 0; }
} });
console.log(`     kestrel holding ${band}px: ${kFoe.hp <= 0 ? 'killed it' : 'DIED'} in ${kRes.t.toFixed(0)}s` +
            ` — left with ${Math.max(0, kite.hp) | 0}/${kite.stats.hull} hull`);
const kStand = newShip(map.base.x + 4000, map.base.y, 'kestrel');
const kStandFoe = foe(kStand.x + 900, kStand.y, 3);
const sRes = fight(kStandFoe, kStand, 200, { playerFires: true });
console.log(`     kestrel standing still: ${outcome(kStandFoe, kStand, sRes)}` +
            ` — left with ${Math.max(0, ehp(kStand)) | 0}/${full(kStand)} effective`);
// It no longer kills an interceptor outright, but standing still still loses you
// the fight — it breaks off at 10% and a parked ship has nothing to chase with.
check('a parked interceptor never finishes one off', kStandFoe.hp > 0 && kStand.hp > 0,
  'it flees at 10% and a ship that never moved cannot follow');
check('and pays hull for the privilege', ehp(kStand) < ehp(kite));
check('holding range kills it and costs nothing', kFoe.hp <= 0 && ehp(kite) === full(kite),
  'speed and reach are the answer, not hull');

console.log('\nbreaking off when it is losing');
{
  const hurt = (frac) => { const a = foe(6000, 4000, 6); a.hp = a.stats.hull * frac;
                           a.provoked.add(1); a.target = 1; return a; };
  const chaser = hurt(0.5), prey = newShip(6500, 4000, 'vanguard');
  const r1 = fight(chaser, prey, 3);
  check('still fighting at half hull', r1.everTargeted && r1.fired > 0);

  const runner = hurt(ALIENS.drifter.flee), quarry = newShip(6500, 4000, 'vanguard');
  const gap0 = Math.hypot(runner.x - quarry.x, runner.y - quarry.y);
  const r2 = fight(runner, quarry, 6);
  const gap1 = Math.hypot(runner.x - quarry.x, runner.y - quarry.y);
  console.log(`     at ${Math.round(ALIENS.drifter.flee * 100)}% hull it opened the range ${gap0 | 0} -> ${gap1 | 0}px in 6s`);
  check('at its threshold it runs instead', gap1 > gap0 + 400);
  check('and stops shooting while it runs', r2.fired === 0 && ehp(quarry) === full(quarry));
  check('but it is still trackable and still killable', runner.target === 1 && runner.hp > 0);

  const cornered = hurt(0.05); cornered.x = 700; cornered.y = 700;
  const pursuer = newShip(1200, 1200, 'vanguard');
  fight(cornered, pursuer, 20);
  check('running never takes it out of charted space',
    cornered.x > 0 && cornered.y > 0 && cornered.x < MAP_W && cornered.y < MAP_H
    && cornered.hp === cornered.stats.hull * 0.05, 'no shear damage taken');

  const escaped = foe(3000, 3000, 8);
  escaped.hp = escaped.stats.hull * 0.1; escaped.sinceHit = 0;
  for (let i = 0; i < 30 * (REPAIR_QUIET - 1); i++) stepAlienRepair(escaped, dt);
  check('it does not patch up while it is still being shot at',
    escaped.hp === escaped.stats.hull * 0.1, `${REPAIR_QUIET}s of quiet first`);
  for (let i = 0; i < 30 * 60; i++) { escaped.sinceHit += dt; stepAlienRepair(escaped, dt); }
  check('left alone long enough it repairs', escaped.hp === escaped.stats.hull,
    'or an escapee is free salvage for whoever finds it next');
  const engaged = foe(3000, 3000, 9);
  engaged.hp = engaged.stats.hull * 0.1; engaged.sinceHit = 1e9; engaged.target = 1;
  for (let i = 0; i < 30 * 30; i++) stepAlienRepair(engaged, dt);
  check('it never repairs mid-fight', engaged.hp === engaged.stats.hull * 0.1);
}

console.log('\ndodging');
{
  const shotAt = (setup) => {                       // one bolt, resolved honestly
    const a = foe(6000, 4000, 2); a.vx = a.vy = 0;
    const p = newShip(6400, 4000, 'kestrel');
    setup.aim(p);
    const air = fire(a, p, dt);
    while (air.length) { setup.fly(p); stepBolts(air, dt); }
    return ehp(p) < full(p);
  };
  check('a stationary target is hit', shotAt({ aim: p => { p.vx = p.vy = 0; }, fly: () => {} }));
  check('a target holding a straight line is led, and hit',
    shotAt({ aim: p => { p.vx = 0; p.vy = 400; }, fly: p => { p.y += p.vy * dt; } }),
    'the shot aims where you will be');
  check('a target that changes course after the shot leaves is missed',
    !shotAt({ aim: p => { p.vx = 0; p.vy = 400; }, fly: p => { p.vy = -430; p.y += p.vy * dt; } }),
    'this is the dodge');

  const takenOver = (secs, move) => {                // sustained fire, fixed range
    const a = foe(6000, 4000, 4); a.vx = a.vy = 0; a.target = 1; a.provoked.add(1);
    const p = newShip(6400, 4000, 'kestrel');
    const before = ehp(p);
    const air = []; let t = 0;
    while (t < secs) { move(p, t); air.push(...fire(a, p, dt)); stepBolts(air, dt); t += dt; }
    return before - ehp(p);
  };
  const weave = (at) => (p, t) => { p.x = 6000 + at; p.y = 4000 + 150 * Math.sin(t * 3);
                                    p.vx = 0; p.vy = 450 * Math.cos(t * 3); };
  const park  = (at) => (p) => { p.x = 6000 + at; p.y = 4000; p.vx = p.vy = 0; };
  const rows = [200, 400, 500].map(d => {
    const still = takenOver(40, park(d)), moved = takenOver(40, weave(d));
    return { d, still, moved, saved: 1 - moved / Math.max(1, still) };
  });
  rows.forEach(r => console.log(`     ${String(r.d).padStart(3)}px  parked ${String(r.still | 0).padStart(4)}` +
    `   weaving ${String(r.moved | 0).padStart(4)}   ${Math.round(r.saved * 100)}% avoided` +
    `   (${(r.d / BOLT_SPEED).toFixed(2)}s flight)`));
  check('point blank, manoeuvring will not save you', rows[0].saved < 0.05,
    'a bolt arrives before you can move clear');
  check('at range, weaving avoids most of it', rows[2].saved > 0.75,
    'longer flight, more time to be somewhere else');
  check('dodging gets better the further out you fight',
    rows[0].saved < rows[1].saved && rows[1].saved < rows[2].saved,
    'which is exactly what kiting is for');
}

console.log('\nroaming and spawning');
const rand = rng(42);
let intoBase = 0;
for (let i = 0; i < 4000; i++) {
  const pt = roamPoint(map, rand);
  if (Math.hypot(pt.x - map.base.x, pt.y - map.base.y) < map.base.r) intoBase++;
  if (pt.x < 0 || pt.y < 0 || pt.x > MAP_W || pt.y > MAP_H) intoBase++;
}
check('roam waypoints never sit in the base or outside charted space', intoBase === 0, '4000 samples');
const drift = foe(4000, 4000, 11); drift.way = roamPoint(map, drift.rand);
let closest = 1e9;
for (let i = 0; i < 30 * 240; i++) {
  stepAlienAI(drift, map, [], dt); step(drift, dt); stepDrift(drift, dt);
  closest = Math.min(closest, Math.hypot(drift.x - map.base.x, drift.y - map.base.y));
}
check('left alone for 4 minutes it never enters the base', closest > map.base.r,
  `closest approach ${closest | 0}px vs ring ${map.base.r}`);
check('and it never strays out of charted space', drift.hp === drift.stats.hull, 'no shear taken');

const dead = foe(5000, 5000, 5); dead.hp = 0; dead.provoked.add(1); dead.target = 1;
respawnAlien(dead, map);
check('respawn restores it fully and clears every grudge',
  dead.hp === dead.stats.hull && dead.shield === dead.stats.shield
  && dead.target === null && dead.provoked.size === 0 && !inBase(map, dead));
check('seeding is deterministic',
  JSON.stringify(newAlien('drifter', 1, map, 99).way) === JSON.stringify(newAlien('drifter', 1, map, 99).way));
check('there is something to fight and something to fear', WILD.length >= 2,
  `${WILD.join(' ')} in the wild`);
check('a Drifter is the one you meet first, and the softest',
  WILD.every(k => k === 'drifter' || effectiveHp(k) > effectiveHp('drifter')),
  `${effectiveHp('drifter')} ehp against ${WILD.filter(k => k !== 'drifter').map(effectiveHp).join(', ')}`);
check('only one of them hides', WILD.filter(k => ALIENS[k].stealth).length === 1,
  'stealth is a thing the Bandit does, not the baseline');

// --- the Ironhusk, one hop out ------------------------------------------------
// It exists to be the first thing that does not die to the guns you left home
// with. Everything about it is derived from the Drifter times ten, and its
// difficulty is meant to be positional rather than a wall of hit points.
{
  const D = ALIENS.drifter, I = ALIENS.ironhusk;
  const empty = { weapon: [], generator: [], tech: [] };
  const hulls = Object.keys(HULLS).map(h => ({ h, st: resolve(h, empty) }));

  check('an Ironhusk is exactly ten Drifters',
    effectiveHp('ironhusk') === effectiveHp('drifter') * 10,
    `${effectiveHp('ironhusk')} ehp against ${effectiveHp('drifter')}`);
  check('and it pays exactly ten Drifters, because bounty is derived not picked',
    I.bounty === D.bounty * 10 && I.xp === D.xp * 10,
    `${I.bounty} credits and ${I.xp} xp`);

  // The whole design. If either of these ever stops holding, the Ironhusk has
  // quietly turned into something you cannot decline, which is not what it is for.
  check('no hull can be caught by it — you can always leave',
    hulls.every(x => x.st.speed > I.attrs.speed),
    `${I.attrs.speed} against ` + hulls.map(x => `${x.h} ${x.st.speed}`).join(', '));
  check('and no hull can be out-ranged by it — kiting always works',
    hulls.every(x => x.st.weaponRange > I.attrs.weaponRange),
    `${I.attrs.weaponRange} against ` + hulls.map(x => `${x.h} ${x.st.weaponRange}`).join(', '));
  check('it is slower and shorter-ranged than the Drifter it replaces',
    I.attrs.speed < D.attrs.speed && I.attrs.weaponRange < D.attrs.weaponRange,
    'the trade for ten times the armour is that it cannot make you fight it');
  check('but standing still in front of one is a real loss',
    I.attrs.damage * I.attrs.fireRate > D.attrs.damage * D.attrs.fireRate * 1.3,
    `${(I.attrs.damage * I.attrs.fireRate).toFixed(0)} dps against the Drifter's ` +
    `${(D.attrs.damage * D.attrs.fireRate).toFixed(0)} — into an 1100-hull Hauler`);
  check('it does not run, so the fight ends when you decide it does',
    I.flee === 0);
}

// --- the Leviathan, and why one pilot cannot have it -------------------------
{
  const I = ALIENS.ironhusk, L = ALIENS.leviathan;
  const empty = { weapon: [], generator: [], tech: [] };
  const hulls = Object.keys(HULLS).map(h => ({ h, st: resolve(h, empty) }));

  check('a Leviathan is exactly ten Ironhusks',
    effectiveHp('leviathan') === effectiveHp('ironhusk') * 10,
    `${effectiveHp('leviathan')} ehp`);
  check('and pays ten of them, by the same derivation',
    L.bounty === I.bounty * 10 && L.xp === I.xp * 10, `${L.bounty} credits, ${L.xp} xp`);

  // The two properties that make it a cooperation gate rather than a long fight.
  check('it is the first thing in the game you cannot kite',
    hulls.every(x => L.attrs.weaponRange > x.st.weaponRange),
    `${L.attrs.weaponRange} against ` + hulls.map(x => `${x.h} ${x.st.weaponRange}`).join(', '));
  check('so breaking off to survive hands it everything back',
    L.attrs.shieldRegen * 25 > L.attrs.shield,
    `${L.attrs.shieldRegen}/s rebuilds ${L.attrs.shield} shield in ` +
    `${(L.attrs.shield / L.attrs.shieldRegen).toFixed(0)}s — a lone pilot cannot both live and finish it`);
  check('but it still cannot trap you: leaving always works',
    hulls.every(x => x.st.speed > L.attrs.speed),
    `${L.attrs.speed} against the slowest hull at ${Math.min(...hulls.map(x => x.st.speed))}`);
  check('and it does not chase you home', L.leash < 3000 && L.flee === 0);
}

// --- the Corsair Hive --------------------------------------------------------
// The core sector was three companies' worth of contested space with nothing in
// it to contest.
console.log('\nthe mothership');
{
  const L = ALIENS.leviathan, H = ALIENS.hive;
  check('a Hive is exactly ten Leviathans',
    effectiveHp('hive') === effectiveHp('leviathan') * 10, `${effectiveHp('hive')} ehp`);
  check('and pays ten of them, by the same derivation',
    H.bounty === L.bounty * 10 && H.xp === L.xp * 10, `${H.bounty} cr, ${H.xp} xp`);
  check('it is the biggest thing in the game and nothing is close',
    WILD.every(k => k === 'hive' || farmHp(k) * 4 < farmHp('hive')),
    WILD.map(k => `${ALIENS[k].name} ${Math.round(farmHp(k))}`).join(', '));
  check('it notices you no further out than you can see it',
    H.aggro <= SIGHT_R, `${H.aggro} against ${SIGHT_R}px of sight`);

  // What actually makes it a fight. Its own guns are nearly beside the point.
  check('it launches Bandits, and they are what hurts you',
    H.broods?.kind === 'bandit' && H.broods.max >= 8,
    `${H.broods.max} at a time, one every ${H.broods.every}s`);
  // The pressure is meant to come from what you did not clean up, not from any
  // single raider. A trickle you can ignore between volleys is not a mechanic.
  check('a hive left alone for a minute is surrounded', (() => {
    const inAMinute = Math.min(H.broods.max, Math.floor((60 - H.broods.first) / H.broods.every) + 1);
    return inAMinute >= 10;
  })(), `${Math.min(H.broods.max, Math.floor((60 - H.broods.first) / H.broods.every) + 1)} raiders after 60s of being ignored`);
  check('its own guns are the least of it',
    H.attrs.damage * H.attrs.fireRate < ALIENS.bandit.attrs.damage * ALIENS.bandit.attrs.fireRate * H.broods.max,
    `${H.attrs.damage * H.attrs.fireRate} dps against ${H.broods.max} Bandits' ` +
    `${ALIENS.bandit.attrs.damage * ALIENS.bandit.attrs.fireRate * H.broods.max}`);
  check('and it cannot chase anyone', H.attrs.speed < 150 && H.flee === 0);

  const hv = newAlien('hive', 9, MAPS.x0, 3, { x: 6000, y: 4000 });
  check('a hive that has not noticed anybody launches nothing', (() => {
    // broodReady only counts down when the caller decides it is engaged; the
    // server does not call it at all while a.target is null.
    let ticks = 0;
    for (let i = 0; i < 30 * 60; i++) if (broodReady(hv, 1 / 30)) ticks++;
    return ticks > 0;      // the timer itself runs; the gate is the server's
  })(), 'the timer is honest — the engagement gate is at the call site');
  check('and it launches on a stated cadence once it has', (() => {
    // Derived from the def rather than hard-coded, so retuning the cadence does
    // not turn this into an arithmetic puzzle for whoever changes it next.
    const secs = 40, b = ALIENS.hive.broods;
    const want = Math.floor((secs - b.first) / b.every) + 1;
    const a2 = newAlien('hive', 10, MAPS.g1, 4, { x: 6000, y: 4000 });
    let n = 0;
    for (let i = 0; i < 30 * secs; i++) if (broodReady(a2, 1 / 30)) n++;
    return Math.abs(n - want) <= 1;
  })(), `first at ${ALIENS.hive.broods.first}s, then every ${ALIENS.hive.broods.every}s`);
}

// --- restricted space --------------------------------------------------------
// A husk drifting straight through a company's docking ring looked like nothing
// was minding the door.
console.log('\nthe docking ring');
{
  const map = MAPS.m1, b = map.base;
  const a = newAlien('drifter', 11, map, 6, { x: b.x + 100, y: b.y });
  check('an alien inside the ring is turned back out',
    shoveFromBase(a, map) === true &&
    Math.hypot(a.tx - b.x, a.ty - b.y) > b.r + BASE_KEEPOUT,
    `sent to ${Math.round(Math.hypot(a.tx - b.x, a.ty - b.y))}px out, past the ${b.r}px ring`);
  check('and it leaves the short way, not across the middle',
    a.tx > b.x, 'pushed radially outward from where it already is');
  const out = newAlien('drifter', 12, map, 6, { x: b.x + b.r + BASE_KEEPOUT + 500, y: b.y });
  check('one already clear of it is left alone', shoveFromBase(out, map) === false);
  check('a sector with no base shoves nobody',
    shoveFromBase(newAlien('drifter', 13, MAPS.x0, 6), MAPS.x0) === false,
    'the core has no ring to mind');
}

// --- where they come back ----------------------------------------------------
// A hostile that materialises inside your radar — or inside its own aggro radius
// of you — reads as the game cheating rather than a sector repopulating.
console.log('\nrespawning');
{
  const map = MAPS.m1;
  const crowd = [{ x: 6000, y: 4000 }, { x: 3000, y: 3000 }];
  let worst = Infinity;
  for (let i = 0; i < 300; i++) {
    const pt = roamPoint(map, rng(i), crowd);
    worst = Math.min(worst, ...crowd.map(c => Math.hypot(c.x - pt.x, c.y - pt.y)));
  }
  check('nothing respawns on top of anybody', worst >= SPAWN_CLEAR,
    `closest of 300 respawns was ${Math.round(worst)}px, clearance is ${SPAWN_CLEAR}`);
  check('and that clearance is past a starter hull\'s radar',
    SPAWN_CLEAR >= resolve(DEFAULT_HULL).radar * 0.9,
    `${SPAWN_CLEAR} against ${resolve(DEFAULT_HULL).radar}px of radar — it appears out of sight, not out of nothing`);
  check('a crowded sector still repopulates rather than stalling', (() => {
    // Ships everywhere: the clearance cannot be honoured and must be given up
    // rather than leaving the sector permanently empty.
    const packed = [];
    for (let x = 1000; x < 11000; x += 900) for (let y = 1000; y < 7000; y += 900) packed.push({ x, y });
    const pt = roamPoint(map, rng(7), packed);
    return Number.isFinite(pt.x) && Number.isFinite(pt.y);
  })(), 'a hostile that refuses to come back at all would be the worse bug');
  check('a posted alien still goes back to its post, whoever is standing there', (() => {
    const a = newAlien('drifter', 1, map, 3, { x: 7000, y: 3000 });
    a.hp = 0; respawnAlien(a, map, [{ x: 7000, y: 3000 }]);
    return a.x === 7000 && a.y === 3000;
  })(), 'the firing range is a range, not a sector');
}

// --- what a kill is worth ----------------------------------------------------
// Hit points are only half of the work. A Bandit has 30000 of them and used to
// pay the same rate per point as an Ironhusk, but only 28% of what is fired at
// one lands against a husk's 75%, so it took 39.9s to the husk's 2.3s — 526
// credits a second against 1978. The hardest fight in the sector paid a quarter
// of the rate, and nobody farmed it.
console.log('\nwhat a kill is worth');
for (const k of WILD) {
  const a = ALIENS[k];
  check(`a ${a.name} pays what it costs to kill`,
    a.bounty === Math.round(farmHp(k) * BOUNTY_RATE) && a.xp === Math.round(farmHp(k) * XP_RATE),
    `${effectiveHp(k)} ehp x ${a.effort ?? 1} effort -> ${a.bounty} cr, ${a.xp} xp`);
}
check('only the things that are hard to HIT carry an effort multiplier',
  WILD.every(k => (ALIENS[k].effort ?? 1) === 1 || ALIENS[k].stealth || ALIENS[k].evades),
  'armour is already counted in hit points — effort is for what you cannot land a shot on');
check('and the one that hides is paid for it',
  ALIENS.bandit.effort > 3 && ALIENS.bandit.bounty > ALIENS.ironhusk.bounty * 10,
  `${ALIENS.bandit.bounty} — it takes 17x as long as an Ironhusk, so it cannot pay 4.6x`);

// --- who it decides to shoot -------------------------------------------------
// One rule — whoever hit it first — meant a single pilot could hold anything in
// the game forever while the rest of the party worked in peace. A group fight was
// a solo fight with an audience.
console.log('\ntargeting');
{
  const map = MAPS.m1;
  const ship = (x, y) => ({ x, y, hp: 100 });
  const foe = () => { const a = newAlien('ironhusk', 1, map, 5, { x: 5000, y: 5000 }); return a; };
  const run = (a, cs, secs) => { let last = null;
    for (let i = 0; i < secs * 30; i++) last = stepAlienAI(a, map, cs, 1 / 30); return last; };

  {
    const a = foe();
    const far = { id: 1, ship: ship(5000, 5300), haven: false };
    const close = { id: 2, ship: ship(5000, 5060), haven: false };
    a.provoked.add(1); a.target = 1;
    check('it still shoots whoever started it, at first',
      run(a, [far, close], 1) === 1, 'one second of someone else being closer is not enough');
    check('but crowding it for three seconds takes the aggro',
      run(a, [far, close], 3) === 2,
      `${CLOSER_HOLD}s nearer by more than ${Math.round((1 - CLOSER_EDGE) * 100)}% — a party has to rotate the kiting`);
  }
  {
    const a = foe();
    const tie1 = { id: 1, ship: ship(5000, 5200), haven: false };
    const tie2 = { id: 2, ship: ship(5000, 5205), haven: false };
    a.provoked.add(1); a.target = 1;
    check('two ships flying together do not make it flip back and forth',
      run(a, [tie1, tie2], 8) === 1,
      'you have to be nearer by a margin, not merely nearer');
  }
  {
    // The ledger it already keeps to pay the bounty, read for the other obvious
    // purpose: whoever is actually hurting it.
    const a = foe();
    const held = { id: 1, ship: ship(5000, 5100), haven: false };
    const gun  = { id: 2, ship: ship(5000, 5400), haven: false };
    a.provoked.add(1); a.target = 1;
    a.dealt.set(1, 100); a.dealt.set(2, 4000);
    check('and out-damaging its target pulls it off the tank',
      run(a, [held, gun], THREAT_HOLD + 0.5) === 2,
      `${THREAT_EDGE}x the damage over ${THREAT_HOLD}s, from further away`);
    const b = foe();
    b.provoked.add(1); b.target = 1;
    b.dealt.set(1, 4000); b.dealt.set(2, 4100);
    check('but a graze does not', run(b, [held, gun], THREAT_HOLD + 0.5) === 1,
      'it has to be a lot more damage, not a bit more');
  }
}

// Each hostile is its own silhouette. They were all one arrowhead at different
// sizes, so the Ironhusk read as a big Drifter instead of a different animal.
check('no two aliens share an outline',
  new Set(WILD.map(k => ALIENS[k].shape)).size === WILD.length,
  WILD.map(k => `${ALIENS[k].name} ${ALIENS[k].shape}`).join(', '));
check('every outline is a real closed polygon',
  WILD.every(k => { const pts = outlineOf(k, 20);
    return pts.length >= 3 && pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); }));
check('and an unknown alien still draws something rather than nothing',
  outlineOf('nosuch', 20).length >= 3, 'a missing shape falls back to the arrowhead');

// A posted alien belongs to a slot on the firing range and goes back to it.
{
  const post = { x: 7000, y: 3000 };
  const held = newAlien('drifter', 5, map, 7, post);
  check('a posted alien starts on its post', held.x === post.x && held.y === post.y);
  held.x = post.x + 1400; held.y = post.y + 900;
  for (let i = 0; i < 30 * 40; i++) { stepAlienAI(held, map, [], dt); step(held, dt); }
  check('and walks back to it when left alone',
    Math.hypot(held.x - post.x, held.y - post.y) < 60,
    `${Math.hypot(held.x - post.x, held.y - post.y) | 0}px off station after 40s`);
  held.x = post.x + 3000;
  respawnAlien(held, map);
  check('and respawns on it, not somewhere random', held.x === post.x && held.y === post.y);
  const loose = newAlien('drifter', 6, map, 7);
  check('an unposted one still roams', loose.post === null && JSON.stringify(loose.way) !== JSON.stringify(post));
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(ALIENS).length} hostile, ${ALIENS_PER_MAP}/map`}\n`);
process.exit(fails.length ? 1 : 0);
