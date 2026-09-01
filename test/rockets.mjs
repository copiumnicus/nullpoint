import { EQUIPMENT, sanitiseFit, sanitiseDrones, MAX_LAUNCHERS } from '../shared/gear.js';
import { HULLS, resolve, slotsOf, gunsOf } from '../shared/ships.js';
import { newShip, refit, step, stepVitals } from '../shared/sim.js';
import { launch, stepRockets, launcherRoom, launchersIn, isLauncher,
         ROCKET_SPEED, ROCKET_TTL, ROCKET_RATE, SPREAD, ROCKET_R,
         turnRate, TURN_MIN, TURN_MAX, TERMINAL_R, TERMINAL_TURN } from '../shared/rockets.js';
import { fire, faceTarget } from '../shared/combat.js';
import { FIRE_RATE } from '../shared/ships.js';
import { BOOST, routeTo, boostOf } from '../shared/power.js';
import { ALIENS, newAlien, stepAlienAI, stepAlienRepair, stepEvade, jinkHeading } from '../shared/aliens.js';
import { MAPS } from '../shared/maps.js';
import { roundPrice } from '../shared/ammo.js';
import { bountyFor, effectiveHp } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const fit = o => ({ weapon: [], generator: [], tech: [], ...o });
const PODS = Object.keys(EQUIPMENT).filter(isLauncher).sort((a, b) => EQUIPMENT[a].tier - EQUIPMENT[b].tier);
const volleyOf  = k => EQUIPMENT[k].mods.find(([a]) => a === 'rocketVolley')[2];
// What a rack ACTUALLY puts up, asked of the game rather than read off a mod — the
// count is derived in resolve() now, which is the whole point of this file's first
// section. A rack fitted alone throws one rocket carrying its declared damage.
const railsOf   = (k, n = 1) => resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(n).fill(k) }))).rockets;
const dmgEachOf = k => { const s = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [k] })));
                         return s.rocketVolley / s.rockets; };

// A dummy that just sits there, so flight is the only thing under test.
const mark = (x, y, r = 13) => ({ x, y, vx: 0, vy: 0, r, hp: 1e9, shield: 0, sinceHit: 0,
                                  stats: { hull: 1e9, shield: 0 }, shieldHit: 0 });

console.log('\nthe rack');
console.log('     ' + PODS.map(k => `${EQUIPMENT[k].name} 1x${dmgEachOf(k)}`).join('   '));
// REWRITTEN, not deleted, and the rule it asserts is the opposite of the one it
// used to. It read "the ladder is one, three, five and seven rockets" and argued for
// odd numbers, because an odd fan keeps a rocket down the aim line. A rung buys
// DAMAGE PER ROCKET now and never count: five Cyclone Racks on a Vanguard threw 35
// rockets sharing 9,150 and now throw five carrying 1,830 each, for the same 9,150.
// Past two racks the old volley was more objects than a pilot could follow, and 35
// rows a tick on the wire to say so.
check('every rack throws exactly one rocket, whatever rung it is',
  PODS.every(k => railsOf(k) === 1),
  PODS.map(k => `${EQUIPMENT[k].name} ${railsOf(k)}x${dmgEachOf(k)}`).join('  '));
check('and five of them throw five, not thirty-five',
  railsOf(PODS.at(-1), 5) === 5 &&
  resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(5).fill(PODS.at(-1)) }))).rocketVolley === 5 * volleyOf(PODS.at(-1)),
  `a finished Vanguard: ${railsOf(PODS.at(-1), 5)} rockets, ` +
  `${5 * volleyOf(PODS.at(-1))} damage — the same volley, seven times fewer objects`);
// The old assertion here was "a better rack throws more rockets AND heavier ones".
// Half of it survives and the other half is now forbidden.
check('a better rack throws the same one rocket, harder',
  PODS.every((k, i) => i === 0 || (railsOf(k) === railsOf(PODS[i - 1])
                                && dmgEachOf(k) > dmgEachOf(PODS[i - 1]))),
  PODS.map(k => `${dmgEachOf(k)}`).join(' -> '));
check('and each rung costs more', PODS.every((k, i) => i === 0 || EQUIPMENT[k].price > EQUIPMENT[PODS[i - 1]].price));
check('two racks of a model land that rocket twice, not one twice as hard', (() => {
  const one = resolve('bulwark', fit({ weapon: [PODS[2]] }));
  const two = resolve('bulwark', fit({ weapon: [PODS[2], PODS[2]] }));
  return two.rockets === one.rockets * 2 && two.rocketVolley / two.rockets === one.rocketVolley / one.rockets;
})());

// --- and the rule is structural, not a coincidence ----------------------------
//
// The count used to be `['rockets','add',7]` on the top rack, which made "one rack,
// one rocket" a property of four numbers that anybody could retype. It is DERIVED in
// resolve() now, and these two are what say so: no rack in the shop declares a
// count, and a rack that did would be ignored.
check('no launcher in the shop declares a rocket count at all',
  PODS.every(k => !EQUIPMENT[k].mods.some(([a]) => a === 'rockets')),
  'the count is derived from how many are mounted, so a rung cannot sell quantity');
check('and a rack that tried to would be ignored', (() => {
  EQUIPMENT.__testrack = { name: 'Test Rack', slot: 'weapon', kind: 'rocket', tier: 9, price: 1,
                           blurb: 'x', mods: [['rockets', 'add', 9], ['rocketVolley', 'add', 100]] };
  try {
    const s = resolve('vanguard', fit({ weapon: ['__testrack', '__testrack'] }));
    return s.rockets === 2;
  } finally { delete EQUIPMENT.__testrack; }
})(), 'a mod claiming nine rails still gets one per rack — resolve() writes the count last');

console.log('\nas many as the hull allows, and never on a drone');
// Rewritten, not deleted: the rule was "three to a ship, however many weapon slots
// the hull has", and it existed because the Cruiser had the most hardpoints and
// would otherwise be tiled with racks. The Cruiser still has four and the Fighter
// now has five, so the slot table does most of that job and the cap's remaining
// work is to say which hull is ALLOWED a fourth and a fifth. MAX_LAUNCHERS is
// still the default every hull gets by saying nothing.
check(`a rack takes at most ${MAX_LAUNCHERS} launchers unless the hull says otherwise`,
  sanitiseFit(slotsOf('bulwark'), fit({ weapon: Array(4).fill(PODS[2]) })).weapon.length === MAX_LAUNCHERS,
  'on the Cruiser\'s four hardpoints, which have the room for a fourth');
check('and the Vanguard is the hull that says otherwise',
  sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(6).fill(PODS[2]) })).weapon.length === 5 &&
  slotsOf('vanguard').launchers === 5,
  'five hardpoints and five racks — five rockets a volley, and the one loadout no escort can imitate');
check('the fourth is dropped, not the first',
  sanitiseFit(slotsOf('bulwark'), fit({ weapon: [PODS[0], PODS[1], PODS[2], PODS[2]] }))
    .weapon.join() === [PODS[0], PODS[1], PODS[2]].join());
check('lasers alongside them are untouched',
  sanitiseFit(slotsOf('bulwark'), fit({ weapon: [PODS[2], 'emitter5', PODS[2], PODS[2]] }))
    .weapon.filter(k => !isLauncher(k)).join() === 'emitter5');
check('a drone refuses a launcher outright',
  sanitiseDrones([PODS[2], 'emitter5', PODS[0]], {}).join() === ',emitter5,',
  `six drones with ${EQUIPMENT[PODS.at(-1)].name}s would add ${(6 * volleyOf(PODS.at(-1))).toLocaleString()} ` +
  'damage a volley to a hull that already fills five hardpoints with them');
check('launcherRoom counts down and floors at zero, per hull',
  launcherRoom('bulwark', fit()) === MAX_LAUNCHERS &&
  launcherRoom('bulwark', fit({ weapon: [PODS[0]] })) === MAX_LAUNCHERS - 1 &&
  launcherRoom('bulwark', fit({ weapon: Array(9).fill(PODS[0]) })) === 0 &&
  launcherRoom('vanguard', fit()) === 5 &&
  launcherRoom('vanguard', fit({ weapon: Array(9).fill(PODS[0]) })) === 0);
check('and the hull is a required argument, so the shop and the server cannot disagree',
  launcherRoom('vanguard', fit({ weapon: Array(3).fill(PODS[0]) })) === 2 &&
  launcherRoom('bulwark',  fit({ weapon: Array(3).fill(PODS[0]) })) === 0,
  'the same rack reads "two racks left" on a Vanguard and "full" on a Bulwark — a defaulted cap ' +
  'here is the workshop-dock bug: a counter that will not sell what the server would accept');
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
  // FIVE RACKS, not one. This block used to fit a single rack and get five rockets,
  // because the third rung was called the Swarm Rack and threw five. Five rockets is
  // five racks now, and that is the change stated as a fit rather than as a number.
  const s = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(5).fill(PODS[2]) })));
  s.heading = 0;
  const tgt = mark(600, 0);        // inside a Fighter's 700px reach
  let salvo = [];
  for (let i = 0; i < 120 && !salvo.length; i++) salvo = launch(s, tgt, dt);
  check('a Vanguard with five racks puts five up at once', salvo.length === 5, 'the fan is the point');
  check('and they are five WHOLE rockets, not five shares of one',
    salvo.every(r => Math.abs(r.dmg - salvo[0].dmg) < 1e-9) &&
    Math.abs(salvo[0].dmg - volleyOf(PODS[2]) * boostOf(s.power, 'weapons', s.stats)) < 1e-6,
    `${Math.round(salvo[0].dmg)} damage each against the rung's declared ${volleyOf(PODS[2])} — ` +
    `the volley used to be this number divided by five`);
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

  // The outermost rocket of a five-fan is thrown 109 degrees off and has the
  // furthest to come back. All five have to land, or the top rack is a downgrade —
  // and that mattered more the day a rocket went from 261 damage to 1,830, because
  // the outer pair is now 40% of the volley instead of 6% of it.
  {
    const s2 = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(5).fill(PODS[2]) })));
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

  // FIVE RACKS. The claim below is still "35 rockets across seven ranges, none
  // lost" and it is still 35 rockets — it is five rails at seven ranges now instead
  // of one rack's seven-fan at five. The number that matters is unchanged and the
  // fit that produces it moved, which is exactly what the rework did.
  const parked = (dist, r) => {
    const s2 = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(5).fill(PODS[2]) })));
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
    `${shots} rockets across seven ranges, none lost — and a lost one is now 1,830 damage, not 261`);
  check('on a small hull too', (() => {
    let lost = 0;
    for (const d of [120, 250, 400, 550, 690]) { const r = parked(d, 10); lost += r.n - r.landed; }
    return lost === 0;
  })(), 'an Interceptor is r=10 and still cannot be orbited');
  check('and it does not take all day', slowest < 3.2, `${slowest.toFixed(1)}s at the worst range`);
}

// --- and none of it breaks when a warhead doubles the reach --------------------
//
// The bug this whole section exists for was a turn circle wider than the miss
// distance: 52 of 140 rockets sailed around a parked target and expired. A grade
// that fires the rack at twice the hull's reach re-opens exactly that question,
// because the fan throws a rocket 109 degrees off the aim line and it has to come
// all the way back with a fixed 4.5s of motor.
//
// Measured rather than reasoned about, and it holds with room. The furthest any
// ship in the game can be told to shoot is a Cruiser's 820 doubled — 1,640px — and
// the whole ladder captures out to 1,900. It starts losing rockets at 2,100, where
// the outer pair of a fan runs the motor out: 2,340px of flight is the budget and
// the excursion is what spends it. So the reach grade sits 28% inside the failure
// point, and the number that would have to move to break it is written down.
{
  const { REACH_MULT } = await import('../shared/ammo.js');
  const FURTHEST = Math.max(...Object.keys(HULLS).map(h => resolve(h).weaponRange)) * REACH_MULT;
  const long = (dist, r, pod) => {
    const s = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(5).fill(pod) })));
    s.stats = { ...s.stats, weaponRange: 1e6 };     // the magazine's reach, stood in for
    s.heading = 0;
    const tgt = mark(dist, 0, r);
    let air = [];
    for (let i = 0; i < 400 && !air.length; i++) air = launch(s, tgt, dt);
    const n = air.length;
    let landed = 0, t = 0, last = 0;
    while (t < ROCKET_TTL + 0.5 && air.length) {
      const h = stepRockets(air, dt); if (h.length) last = t; landed += h.length; t += dt;
    }
    return { n, landed, last };
  };
  let lost = 0, shots = 0, slowest = 0;
  const line = [];
  for (const pod of PODS) for (const d of [820, 1100, 1400, FURTHEST]) {
    const r = long(d, 26, pod);
    lost += r.n - r.landed; shots += r.n; slowest = Math.max(slowest, r.last);
    if (pod === PODS.at(-1)) line.push(`${Math.round(d)}px ${r.landed}/${r.n}`);
  }
  console.log(`     a ${EQUIPMENT[PODS.at(-1)].name} at a long warhead's reach: ` + line.join('  '));
  check('every rocket still finds a parked target at twice the longest reach in the game',
    lost === 0,
    `${shots} rockets across four ranges out to ${Math.round(FURTHEST)}px, none lost — ` +
    `slowest arrival ${slowest.toFixed(1)}s against ${ROCKET_TTL}s of motor`);
  check('and on a small hull too',
    (() => { let l = 0; for (const pod of PODS) for (const d of [1100, FURTHEST]) {
      const r = long(d, 10, pod); l += r.n - r.landed; } return l === 0; })(),
    'an Interceptor is r=10 and still cannot be orbited at 1,640px');
  // The seam, named because it is the thing that would break this. The motor is the
  // budget and the fan is what spends it; the failure point was measured at 2,100px.
  check('and the reach grade leaves the motor real headroom before that stops being true',
    FURTHEST < ROCKET_SPEED * ROCKET_TTL * 0.75,
    `${Math.round(FURTHEST)}px against ${Math.round(ROCKET_SPEED * ROCKET_TTL)}px of motor — measured, a ` +
    'five-fan starts losing its outer pair at 2,100px, so the grade sits 28% inside the failure point. ' +
    'A third doubling, a slower rocket or a shorter TTL is what would take it there');
}

// --- and none of it breaks against something that MOVES -----------------------
//
// The section above is a FLOOR, not a hit rate: nothing in this game stands still.
// It earned its place because rockets once orbited a parked hulk, and it stays for
// the same reason — but "none lost against a hulk" says nothing about the fight the
// weapon is actually used in, and the day a rocket went from 261 damage to 1,830
// that stopped being good enough. A miss costs seven times what it did.
//
// So this is the real measurement: rockets fired at hostiles driven by the actual
// stepAlienAI, in server.js's own tick order, across the speed range of the
// bestiary and in three postures — brawling inside 315px, standing off at 595px,
// and chasing one through the panic run every hostile does under its `flee` line.
//
// It is 0.15s of wall clock, which is why it lives here rather than in a script
// beside the repo that nobody re-runs.
console.log('\nwhat it does to something that is moving');
{
  const MAP = MAPS.d1, AT = { x: 3400, y: 5600 };
  const shooter = () => {
    const f = sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(5).fill(PODS.at(-1)) }));
    const s = newShip(AT.x, AT.y, 'vanguard', f, [], 'wedge', null, 0);
    routeTo(s.power, 'weapons');
    s.stats = { ...s.stats, hull: 1e12 }; s.hp = 1e12;
    return s;
  };
  // Fleeing is a RATIO — hp under def.flee x hull — so the panic run is forced with
  // an enormous hull and a hundredth of it in hit points, NOT by setting hp to 1.
  // With hp 1 the first rocket to land killed the target and stepRockets discarded
  // every other rocket in the air as "target gone", which reads as a 34% hit rate
  // that is really a 100% one. That artefact is what the first draft of this table
  // measured, and it is the reason the seeker was very nearly rebuilt.
  const foe = (kind, dist, seed, fleeing) => {
    const a = newAlien(kind, 5000, MAP, seed, null);
    a.x = AT.x + dist; a.y = AT.y;
    a.stats = { ...a.stats, hull: 1e12 };
    a.hp = fleeing ? 1e10 : 1e12;
    a.post = null; a.provoked.add(1); a.target = 1;
    return a;
  };
  const run = (kind, { dist, hold, seed, fleeing = false, secs = 30 }) => {
    const me = shooter(), a = foe(kind, dist, seed, fleeing);
    let air = [], fired = 0, landed = 0, t = 0;
    const tick = (launching) => {
      const here = [{ id: 1, ship: me, haven: false, loud: 1 }];
      const breaking = stepEvade(a, air.filter(r => r.target === a), MAP, dt);
      const tgt = stepAlienAI(a, MAP, here, dt);
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
      if (breaking && Math.hypot(a.vx, a.vy) > 20) a.heading = jinkHeading(a, victim?.ship);
      else faceTarget(a, victim?.ship);
      if (fleeing) a.hp = 1e10;
      // The pilot flies it: holds at `hold` of the rack's reach, so it closes on
      // something running and backs off something crowding. A parked shooter turns
      // "the target left" into "the rocket missed".
      const want = me.stats.weaponRange * hold, d = Math.hypot(a.x - me.x, a.y - me.y) || 1;
      me.tx = a.x - (a.x - me.x) / d * want; me.ty = a.y - (a.y - me.y) / d * want;
      me.dx = me.dy = null;
      step(me, dt); stepVitals(me, dt, false);
      faceTarget(me, a);
      if (launching) { const salvo = launch(me, a, dt); fired += salvo.length; for (const r of salvo) air.push(r); }
      landed += stepRockets(air, dt).length;
    };
    while (t < secs) { tick(true); t += dt; }
    // Let whatever is up finish or burn out, so nothing counts as lost merely for
    // being in the air when the clock stopped.
    for (let i = 0; i < Math.ceil((ROCKET_TTL + 1) / dt) && air.length; i++) tick(false);
    return { fired, landed };
  };
  const CASES = [['brawl', { dist: 400, hold: 0.45 }], ['standoff', { dist: 700, hold: 0.85 }],
                 ['fleeing', { dist: 600, hold: 0.85, fleeing: true }]];
  const KINDS = ['hive', 'kedge', 'ironhusk', 'leviathan', 'drifter', 'harrier', 'bandit'];
  const rate = {};
  console.log('     hostile         speed  evades      brawl  standoff   fleeing');
  for (const k of KINDS) {
    rate[k] = {};
    const cells = [];
    for (const [name, opt] of CASES) {
      let f = 0, l = 0;
      for (const seed of [7, 19, 31]) { const r = run(k, { ...opt, seed }); f += r.fired; l += r.landed; }
      rate[k][name] = 100 * l / f;
      cells.push(`${(100 * l / f).toFixed(0)}%`.padStart(10));
    }
    console.log(`     ${ALIENS[k].name.padEnd(15)}${String(ALIENS[k].attrs.speed).padStart(4)}` +
                `${ALIENS[k].evades ? '     yes' : '      no'}${cells.join('')}`);
  }
  const STEADY = KINDS.filter(k => !ALIENS[k].evades);
  check('a rocket lands on anything in the bestiary that is not built to dodge',
    STEADY.every(k => rate[k].brawl === 100 && rate[k].standoff === 100),
    'twelve fights from a Corsair Hive at 110 to a Harrier at 380, brawling and standing off: ' +
    'every rocket fired, every rocket landed');
  // REWRITTEN, and the game changed under it rather than the claim being wrong. This
  // asked for 85% on a fleeing Harrier and got 93 — measured when a fleeing hostile
  // with its back to the edge of the map stopped dead, because its escape point was
  // clamped onto its own position. Running works now, so a Harrier at 380 genuinely
  // outruns a 520px/s rocket with 4.5s of motor and it is 55%.
  //
  // That is the honest shape and it is a better one: the Harrier stops being a
  // faster Drifter and becomes the thing you cannot rocket down once it decides to
  // leave. What the claim keeps is the half that is about the SEEKER rather than
  // about speed — everything slower than a Harrier still loses nothing to running.
  check('and running only saves the one hostile fast enough to outrun a rocket',
    STEADY.filter(k => k !== 'harrier').every(k => rate[k].fleeing === 100) &&
    rate.harrier.fleeing > 40 && rate.harrier.fleeing < 80,
    `the Harrier is the one that gets away with any of it — ${rate.harrier.fleeing.toFixed(0)}% ` +
    `at 380 speed against a ${ROCKET_SPEED}px/s rocket with ${ROCKET_TTL}s of motor, and ` +
    'everything slower than it loses nothing. It read 93% while fleeing was broken');
  // The one hostile the seeker is NOT allowed to solve. Evasion is a Bandit's whole
  // reason to exist and camouflage is the same mechanic seen from the other side —
  // a floor as well as a ceiling, because a dodge nobody can beat is a health bar
  // behind a curtain.
  check('and a Bandit still dodges better than a third of it',
    rate.bandit.brawl > 30 && rate.bandit.brawl < 80,
    `${rate.bandit.brawl.toFixed(0)}% lands in a brawl, ${rate.bandit.fleeing.toFixed(0)}% on one running — ` +
    'a seeker that leads its target was built for this table, measured, and rejected: it ' +
    'moved nothing except this row, and it moved it the wrong way');
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
  const WEDGE = 1.12;
  console.log(`     three MK-V in the rack:  ${Math.round(gunSlots)} dps, every bolt dodgeable at range`);
  console.log(`     three Osprey Racks:      ${Math.round(podSlots)} dps, ` +
              `${Math.round(pods.rockets)} rockets a volley that follow you`);
  // A launcher costs you a slot you cannot get back — three to a ship, none on a
  // drone — so out of that slot it has to beat the gun it replaced. It did not,
  // and there was no reason to fit one.
  check('the best rack out-damages the best gun, slot for slot', share > 1,
    `${Math.round(100 * share)}% of what the same slots do as guns`);
  check('but not so far that guns stop mattering', share < 1.4,
    'the cap of three is what keeps it honest');
  check('and it costs more to fill those slots with',
    EQUIPMENT[POD].price > EQUIPMENT[TOP].price,
    `${EQUIPMENT[POD].price} against ${EQUIPMENT[TOP].price}`);

  // Every rung, not just the top one: a rack has to beat the emitter in its own
  // price band, or the middle of the ladder is a trap.
  const LASERS = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].kind === 'laser');
  const laserDps = k => EQUIPMENT[k].mods.find(([a]) => a === 'damage')[2] * WEDGE * (1 + BOOST) * FIRE_RATE;
  const podDpsOf = k => volleyOf(k) * WEDGE * (1 + BOOST) * ROCKET_RATE;
  let allBeat = true;
  for (const k of PODS) {
    // the emitter you would otherwise have spent that money on
    const rival = LASERS.reduce((best, l) =>
      Math.abs(EQUIPMENT[l].price - EQUIPMENT[k].price) < Math.abs(EQUIPMENT[best].price - EQUIPMENT[k].price) ? l : best);
    const edge = podDpsOf(k) / laserDps(rival);
    console.log(`     ${EQUIPMENT[k].name.padEnd(13)}${Math.round(podDpsOf(k)).toString().padStart(4)} dps  vs  ` +
                `${EQUIPMENT[rival].name.padEnd(15)}${Math.round(laserDps(rival)).toString().padStart(4)} dps   ` +
                `+${Math.round(100 * (edge - 1))}% for +${Math.round(100 * (EQUIPMENT[k].price / EQUIPMENT[rival].price - 1))}% cost`);
    if (edge <= 1.05 || edge > 1.4) allBeat = false;
  }
  check('every rack beats the gun in its own price band', allBeat,
    'no rung of the launcher ladder is a downgrade');

  // The Wedge used to lift bolts only, which quietly made it a lasers-only perk.
  const escort = Array(3).fill('emitter5');        // a formation pays nothing without one
  const wedged = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [POD, POD, POD] })), escort, 'wedge');
  const plain  = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [POD, POD, POD] })), escort, 'line');
  check('the Attack Wedge lifts rockets too', wedged.rocketVolley > plain.rocketVolley,
    'otherwise it reads as "fit lasers"');
  // And it lifts the DAMAGE, never the count. A percentage of a rocket is not a
  // thing, and resolve() writes the count after the multipliers so nothing can try.
  check('but it cannot conjure a sixth rocket out of five racks',
    wedged.rockets === plain.rockets && wedged.rockets === 3,
    'a formation multiplies what a rack lands, not how many rails it has');
}

// --- what it costs to feed --------------------------------------------------
//
// A warhead arms one rocket, and a rocket is now seven times the thing it was at
// the top of the ladder. If the price had stayed where it was, the endgame
// ammunition bill would have fallen sevenfold overnight — measured, from 0.631% of
// the bounty on what you shot to 0.090%, which is a 1,110-fold return on the crate.
// The shelf has been that wrong before in both directions and shared/ammo.js names
// both times.
console.log('\nwhat it costs to feed');
{
  const perPoint = k => {
    const s = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [k] })));
    return s.rockets * roundPrice('head1') / s.rocketVolley;
  };
  console.log('     ' + PODS.map(k => `${EQUIPMENT[k].name} ${perPoint(k).toFixed(4)}`).join('   ') + ' cr a point');
  check('a Cyclone volley costs exactly what it cost before the rework',
    Math.abs(railsOf(PODS.at(-1)) * roundPrice('head1') - 10.5) < 1e-9,
    `one warhead at ${roundPrice('head1').toFixed(2)} cr against seven at 1.50 — 10.50 either way, for 1,830 points`);
  check('and climbing the rack ladder still makes every point of damage cheaper',
    PODS.every((k, i) => i === 0 || perPoint(k) < perPoint(PODS[i - 1])),
    PODS.map(k => perPoint(k).toFixed(4)).join(' > '));
  // Scale-free, because a bounty is farmHp x BOUNTY_RATE: the share is the same for
  // a Drifter and for a Crucible, which is what makes it one number to argue about.
  const s = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: [PODS.at(-1)] })));
  const crPerPoint = s.rockets * roundPrice('head1') / (s.rocketVolley * (1 + s.boost));
  const share = k => 100 * effectiveHp(k) * crPerPoint / bountyFor(k);
  console.log(`     a Crucible: ${Math.round(effectiveHp('crucible') * crPerPoint).toLocaleString()} cr of warheads ` +
              `against a ${bountyFor('crucible').toLocaleString()} cr bounty`);
  check('and feeding the top rack costs the same share of a bounty it always did',
    Math.abs(share('crucible') - 0.631) < 0.01 && Math.abs(share('drifter') - share('crucible')) < 1e-9,
    `${share('crucible').toFixed(3)}% of the bounty, a ${Math.round(1 / (share('crucible') / 100)).toLocaleString()}-fold ` +
    'return — the same for every hostile in the game, because a bounty is effective hp x BOUNTY_RATE');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
                               : `PASS — ${PODS.length} launchers`}\n`);
process.exit(fails.length ? 1 : 0);
