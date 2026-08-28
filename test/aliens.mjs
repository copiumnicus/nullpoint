import { ALIENS, ALIENS_PER_MAP, newAlien, respawnAlien, stepAlienAI, forgetPlayer, roamPoint, rng } from '../shared/aliens.js';
import { newShip, step, stepVitals, stepDrift, applyDamage, inBase, inHaven, HAVEN_R, SIGHT_R } from '../shared/sim.js';
import { fire, stepBolts, faceTarget, BOLT_SPEED, HIT_R } from '../shared/combat.js';
import { MAPS, MAP_W, MAP_H, PORTAL_R } from '../shared/maps.js';
import { HULLS, resolve } from '../shared/ships.js';

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
    const s1 = fire(a, tgt ? p : null, dt); if (s1) { air.push(s1); fired++; }
    if (playerFires) {
      faceTarget(p, a);
      const s2 = fire(p, a, dt);
      if (s2) { air.push(s2); a.provoked.add(1); a.target ??= 1; }
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
for (const h of ['kestrel', 'vanguard', 'bulwark']) {
  const p = newShip(map.base.x + 4000, map.base.y, h);
  const a = foe(p.x + 900, p.y, 3);
  const res = fight(a, p, 200, { playerFires: true });
  console.log(`     ${h.padEnd(9)} ${a.hp <= 0 ? 'killed it' : 'DIED'} in ${res.t.toFixed(0)}s` +
              `  — left with ${Math.max(0, p.hp) | 0}/${p.stats.hull} hull`);
}
const vg = newShip(map.base.x + 4000, map.base.y, 'vanguard');
const vgFoe = foe(vg.x + 900, vg.y, 3);
const vgRes = fight(vgFoe, vg, 200, { playerFires: true });
check('a starter hull can win, but it costs', vgFoe.hp <= 0 && vg.hp < vg.stats.hull * 0.75,
  `${vgRes.t.toFixed(0)}s, down to ${(100 * vg.hp / vg.stats.hull) | 0}% hull`);
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
fight(kStandFoe, kStand, 200, { playerFires: true });
check('an interceptor dies if it stands and trades', kStand.hp <= 0);
check('but wins by holding range', kFoe.hp <= 0 && kite.hp > 0,
  'speed and reach are the answer, not hull');

console.log('\ndodging');
{
  const shotAt = (setup) => {                       // one bolt, resolved honestly
    const a = foe(6000, 4000, 2); a.vx = a.vy = 0;
    const p = newShip(6400, 4000, 'kestrel');
    setup.aim(p);
    const bolt = fire(a, p, dt);
    const air = [bolt];
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
    while (t < secs) { move(p, t); const s = fire(a, p, dt); if (s) air.push(s); stepBolts(air, dt); t += dt; }
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
check('hostiles are only on home maps for now', ALIENS_PER_MAP > 0 && Object.keys(ALIENS).length === 1);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(ALIENS).length} hostile, ${ALIENS_PER_MAP}/map`}\n`);
process.exit(fails.length ? 1 : 0);
