import { EQUIPMENT, sanitiseFit, sanitiseDrones, MAX_LAUNCHERS } from '../shared/gear.js';
import { HULLS, resolve, slotsOf, gunsOf } from '../shared/ships.js';
import { newShip, refit } from '../shared/sim.js';
import { launch, stepRockets, launcherRoom, launchersIn, isLauncher,
         ROCKET_SPEED, ROCKET_TTL, ROCKET_RATE, SPREAD, ROCKET_R,
         turnRate, TURN_MIN, TURN_MAX, TERMINAL_R, TERMINAL_TURN } from '../shared/rockets.js';
import { fire } from '../shared/combat.js';
import { BOOST } from '../shared/power.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const fit = o => ({ weapon: [], generator: [], tech: [], ...o });
const PODS = Object.keys(EQUIPMENT).filter(isLauncher).sort((a, b) => EQUIPMENT[a].tier - EQUIPMENT[b].tier);
const rocketsOf = k => EQUIPMENT[k].mods.find(([a]) => a === 'rockets')[2];
const volleyOf  = k => EQUIPMENT[k].mods.find(([a]) => a === 'rocketVolley')[2];

// A dummy that just sits there, so flight is the only thing under test.
const mark = (x, y, r = 13) => ({ x, y, vx: 0, vy: 0, r, hp: 1e9, shield: 0, sinceHit: 0,
                                  stats: { hull: 1e9, shield: 0 }, shieldHit: 0 });

console.log('\nthe rack');
console.log('     ' + PODS.map(k => `${EQUIPMENT[k].name} ${rocketsOf(k)}x${volleyOf(k) / rocketsOf(k)}`).join('   '));
check('the ladder is one, three and five rockets',
  PODS.map(rocketsOf).join() === '1,3,5', 'a better launcher throws more, not harder');
check('every rocket in the ladder hits for the same',
  new Set(PODS.map(k => volleyOf(k) / rocketsOf(k))).size === 1,
  `${volleyOf(PODS[0])} each, whatever throws it`);
check('and each rung costs more', PODS.every((k, i) => i === 0 || EQUIPMENT[k].price > EQUIPMENT[PODS[i - 1]].price));
check('two racks of a model land that rocket twice, not one twice as hard', (() => {
  const one = resolve('bulwark', fit({ weapon: [PODS[2]] }));
  const two = resolve('bulwark', fit({ weapon: [PODS[2], PODS[2]] }));
  return two.rockets === one.rockets * 2 && two.rocketVolley / two.rockets === one.rocketVolley / one.rockets;
})());

console.log('\nthree to a ship, and never on a drone');
check(`a rack takes at most ${MAX_LAUNCHERS} launchers`,
  sanitiseFit(slotsOf('bulwark'), fit({ weapon: Array(4).fill(PODS[2]) })).weapon.length === MAX_LAUNCHERS,
  'on a W4 hull, which has the room for a fourth');
check('the fourth is dropped, not the first',
  sanitiseFit(slotsOf('bulwark'), fit({ weapon: [PODS[0], PODS[1], PODS[2], PODS[2]] }))
    .weapon.join() === [PODS[0], PODS[1], PODS[2]].join());
check('lasers alongside them are untouched',
  sanitiseFit(slotsOf('bulwark'), fit({ weapon: [PODS[2], 'emitter5', PODS[2], PODS[2]] }))
    .weapon.filter(k => !isLauncher(k)).join() === 'emitter5');
check('a drone refuses a launcher outright',
  sanitiseDrones([PODS[2], 'emitter5', PODS[0]], {}).join() === ',emitter5,',
  'six drones with swarm racks would put thirty rockets up on one trigger');
check('launcherRoom counts down and floors at zero',
  launcherRoom(fit()) === MAX_LAUNCHERS &&
  launcherRoom(fit({ weapon: [PODS[0]] })) === MAX_LAUNCHERS - 1 &&
  launcherRoom(fit({ weapon: Array(9).fill(PODS[0]) })) === 0);
check('a launcher is not a barrel', (() => {
  const f = fit({ weapon: [PODS[2], PODS[2], 'emitter5'] });
  return gunsOf(f) === 1;                          // the one emitter, not three "guns"
})(), 'or the rack would split its bolt damage across guns that never fire a bolt');
check('a rocket build still fires the hull cannons', (() => {
  const s = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(3).fill(PODS[2]) })));
  s.heading = 0;
  for (let i = 0; i < 90; i++) { const v = fire(s, mark(400, 0), dt); if (v.length) return true; }
  return false;
})(), 'the hull has its own guns whatever you bolt on');

console.log('\nthe fan');
{
  const s = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS[2]] })));
  s.heading = 0;
  const tgt = mark(600, 0);        // inside a Fighter's 700px reach
  let salvo = [];
  for (let i = 0; i < 120 && !salvo.length; i++) salvo = launch(s, tgt, dt);
  check('a Swarm Rack puts five up at once', salvo.length === 5, 'the fan is the point');
  const angs = salvo.map(r => r.heading).sort((a, b) => a - b);
  console.log('     launch headings: ' + angs.map(a => (a * 180 / Math.PI).toFixed(0) + '°').join('  '));
  check('they leave spread across the aim line, not down it',
    Math.abs(angs[0] + SPREAD) < 1e-6 && Math.abs(angs.at(-1) - SPREAD) < 1e-6,
    `${(SPREAD * 180 / Math.PI).toFixed(0)}° either side`);
  check('none of them is aimed at the target to begin with',
    angs.filter(a => Math.abs(a) < 1e-9).length <= 1, 'the middle one is, the rest arc in');

  const solo = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS[0]] })));
  solo.heading = 0;
  const sides = [];
  for (let i = 0; i < 400 && sides.length < 4; i++) for (const r of launch(solo, tgt, dt)) sides.push(Math.sign(r.heading));
  check('a single rocket still swings out, alternating sides',
    sides.length === 4 && sides.every(v => v !== 0) && sides[0] !== sides[1] && sides[1] !== sides[2],
    `${sides.join(' ')} — otherwise a lone pod reads as a slow bolt`);
}

console.log('\nthe chase');
{
  // The arc is a sideways excursion off the firing line, so that is what gets
  // measured — total path length barely moves and would pass a straight shot.
  const flight = (tgt, secs = ROCKET_TTL) => {
    const s = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS[0]] })));
    s.heading = 0;
    let air = [];
    for (let i = 0; i < 200 && !air.length; i++) air = launch(s, tgt, dt);
    const ox = air[0].x, oy = air[0].y;
    const len = Math.hypot(tgt.x - ox, tgt.y - oy);
    const ux = (tgt.x - ox) / len, uy = (tgt.y - oy) / len;   // unit vector down the firing line
    let t = 0, hit = null, swing = 0;
    while (t < secs && air.length) {
      if (air.length) {
        const dx = air[0].x - ox, dy = air[0].y - oy;
        swing = Math.max(swing, Math.abs(dx * uy - dy * ux));  // perpendicular distance off it
      }
      if (stepRockets(air, dt).length) { hit = t; break; }
      t += dt;
    }
    return { hit, t, swing, len };
  };
  const r1 = flight(mark(600, 0));
  console.log(`     600px dead ahead: hit at ${r1.hit?.toFixed(2)}s, swinging ${r1.swing | 0}px wide of the firing line`);
  check('a rocket thrown wide still comes around and connects', r1.hit !== null);
  check('and it arcs hard to get there', r1.swing > 200,
    `${r1.swing | 0}px off the line at its widest`);
  check('it is slower to arrive than a bolt would be', r1.hit > r1.len / 1000,
    `${r1.hit.toFixed(2)}s against ${(r1.len / 1000).toFixed(2)}s for a bolt`);

  // The outermost rocket of a five-fan is thrown 66 degrees off and has the
  // furthest to come back. All five have to land, or the top rack is a downgrade.
  {
    const s2 = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS[2]] })));
    s2.heading = 0;
    const tgt2 = mark(600, 0);
    let air2 = [];
    for (let i = 0; i < 200 && !air2.length; i++) air2 = launch(s2, tgt2, dt);
    const n0 = air2.length;
    let landed = 0, t2 = 0, widest = 0;
    while (t2 < ROCKET_TTL && air2.length) {
      for (const r of air2) widest = Math.max(widest, Math.abs(r.y));
      landed += stepRockets(air2, dt).length;
      t2 += dt;
    }
    console.log(`     a five-fan: ${landed}/${n0} landed, widest swing ${widest | 0}px off the line`);
    check('every rocket in a fan comes back and lands', landed === n0);
    check('and the fan opens properly on the way', widest > 400,
      `thrown ${Math.round(SPREAD * 180 / Math.PI)} degrees off, so the outer pair take the long way round`);
  }

  const r2 = flight(mark(-600, 0));
  check('it will turn all the way round for a target behind you', r2.hit !== null,
    `${r2.hit?.toFixed(2)}s to come about and land`);

  // A target that keeps moving drags it out; one that runs far enough outlives the motor.
  const runner = mark(550, 0);
  const s = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS[0]] })));
  s.heading = 0;
  let air = [];
  for (let i = 0; i < 200 && !air.length; i++) air = launch(s, runner, dt);
  let t = 0, hit = false;
  while (t < ROCKET_TTL + 1 && air.length) {
    runner.x += ROCKET_SPEED * 1.15 * dt;          // faster than the rocket, running flat out
    if (stepRockets(air, dt).length) { hit = true; break; }
    t += dt;
  }
  check('outrunning a rocket outright works', !hit && air.length === 0,
    `the motor burns out after ${ROCKET_TTL}s`);
}

console.log('\nnothing sitting still gets away');
{
  // A pursuer whose turn circle is wider than its miss distance cannot close on
  // something inside that circle — it orbits until the motor dies. A flat turn
  // rate meant better than a third of every volley sailed past a parked target.
  check('terminal authority beats the fuse', ROCKET_SPEED / TERMINAL_TURN < ROCKET_R + 10,
    `${Math.round(ROCKET_SPEED / TERMINAL_TURN)}px of turn circle against a ${ROCKET_R}px fuse`);
  check('and it only applies once the rocket is close', turnRate(0, 1e9) === TURN_MIN
    && turnRate(9, 1e9) === TURN_MAX && turnRate(0, TERMINAL_R - 1) === TERMINAL_TURN,
    'far out it holds back, which is what makes the arc');

  const parked = (dist, r) => {
    const s2 = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS[2]] })));
    s2.heading = 0;
    const tgt = mark(dist, 0, r);
    let air = [];
    for (let i = 0; i < 300 && !air.length; i++) air = launch(s2, tgt, dt);
    const n = air.length;
    let landed = 0, t = 0;
    while (t < ROCKET_TTL + 0.5 && air.length) { landed += stepRockets(air, dt).length; t += dt; }
    return { n, landed, t };
  };
  let missed = 0, shots = 0, slowest = 0;
  const line = [];
  for (const d of [120, 200, 300, 400, 500, 600, 690]) {
    const r = parked(d, 26);
    missed += r.n - r.landed; shots += r.n; slowest = Math.max(slowest, r.t);
    line.push(`${d}px ${r.landed}/${r.n}`);
  }
  console.log('     a parked bulkhead: ' + line.join('  '));
  check('every rocket lands on something that is not moving', missed === 0,
    `${shots} rockets across seven ranges, none lost`);
  check('on a small hull too', (() => {
    let lost = 0;
    for (const d of [120, 250, 400, 550, 690]) { const r = parked(d, 10); lost += r.n - r.landed; }
    return lost === 0;
  })(), 'an Interceptor is r=10 and still cannot be orbited');
  check('and it does not take all day', slowest < 3.2, `${slowest.toFixed(1)}s at the worst range`);
}

console.log('\nwhat a rack is worth');
{
  const TOP = 'emitter5', POD = PODS[2];
  const build = weapon => resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon })),
                                  Array(6).fill(TOP), 'wedge');
  // Compare what the three rack slots themselves deliver. Whole-ship dps is
  // diluted by six laser drones either way and hides the actual trade.
  const bare = build([]), guns = build(Array(3).fill(TOP)), pods = build(Array(3).fill(POD));
  const gunSlots = (guns.damage - bare.damage) * (1 + BOOST) * guns.fireRate;
  const podSlots = pods.rocketVolley * (1 + BOOST) * ROCKET_RATE;
  const share = podSlots / gunSlots;
  console.log(`     three MK-V in the rack:  ${Math.round(gunSlots)} dps, every bolt dodgeable at range`);
  console.log(`     three Swarm Racks:       ${Math.round(podSlots)} dps, ` +
              `${Math.round(pods.rockets)} rockets a volley that follow you`);
  check('rockets buy delivery with damage', share < 0.85,
    `${Math.round(100 * share)}% of what the same slots do as guns`);
  check('but not so much that they are a trap', share > 0.6, 'worth the slots it costs');
  check('and they cost less to fill those slots with',
    EQUIPMENT[POD].price < EQUIPMENT[TOP].price,
    `${EQUIPMENT[POD].price} against ${EQUIPMENT[TOP].price} — the cheap way to make damage land`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
                               : `PASS — ${PODS.length} launchers`}\n`);
process.exit(fails.length ? 1 : 0);
