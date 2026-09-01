import { aspectOf, alphaAt, dutyAt, shownAt, seenAs,
         MIN_ALPHA, MAX_ALPHA, MIN_DUTY } from '../shared/stealth.js';
import { ALIENS, WILD, effectiveHp } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

// A Bandit sitting at the origin with its nose along +x. `at` puts you that many
// degrees around it: 0 is straight in front of its nose, 180 is behind it.
const bandit = { x: 0, y: 0, heading: 0 };
const at = deg => ({ x: Math.cos(deg * Math.PI / 180) * 500,
                     y: Math.sin(deg * Math.PI / 180) * 500 });
const seenFor = (deg, samples = 4000) => {
  const a = aspectOf(bandit, at(deg));
  let on = 0;
  for (let i = 0; i < samples; i++) if (shownAt(a, i * 16, 3)) on++;
  return { aspect: a, alpha: alphaAt(a), seen: on / samples };
};

console.log('\naspect');
check('its nose is its quietest angle', aspectOf(bandit, at(0)) === 0);
check('and its tail its loudest', Math.abs(aspectOf(bandit, at(180)) - 1) < 1e-9);
check('the beam sits halfway', Math.abs(aspectOf(bandit, at(90)) - 0.5) < 1e-9);
check('and it does not care which side you are on',
  Math.abs(aspectOf(bandit, at(90)) - aspectOf(bandit, at(-90))) < 1e-9);
check('a Bandit facing away from you is fully exposed', (() => {
  const running = { x: 0, y: 0, heading: Math.PI };   // nose pointing at -x, you are at +x
  return Math.abs(aspectOf(running, at(0)) - 1) < 1e-9;
})(), 'which is why breaking off is when you can finally see one');

console.log('\nwhat you can see');
const table = [0, 30, 60, 90, 120, 150, 180].map(d => [d, seenFor(d)]);
for (const [d, r] of table)
  console.log(`     ${String(d).padStart(3)}°  aspect ${r.aspect.toFixed(2)}  ` +
              `alpha ${r.alpha.toFixed(2)}  drawn ${(r.seen * 100).toFixed(0)}% of the time`);

check('it gets more solid the further round you get',
  table.every(([, r], i) => i === 0 || r.alpha > table[i - 1][1].alpha));
check('and it is there more of the time too',
  table.every(([, r], i) => i === 0 || r.seen >= table[i - 1][1].seen - 0.02));
// Not zero. A seeker reads these same numbers, and a target it can never see at
// all is one it can never be fired at rather than one it tracks badly.
check('nose-on it is a glimpse rather than nothing',
  seenFor(0).seen > 0.05 && seenFor(0).seen < 0.25
  && Math.abs(seenFor(0).alpha - MIN_ALPHA) < 1e-9,
  `${(seenFor(0).seen * 100).toFixed(0)}% of the time, at ${MIN_ALPHA} alpha`);
check('on the beam it comes and goes rather than fading',
  seenFor(90).seen > 0.15 && seenFor(90).seen < 0.7,
  'the half-visible case is the interesting one, and it flickers');
check('tail-on it is simply a ship', seenFor(180).seen === 1 && alphaAt(1) === MAX_ALPHA);

console.log('\nit fades rather than snapping');
{
  const { presenceAt, SOFT } = await import('../shared/stealth.js');
  // A hard cut between drawn and not drawn reads as a rendering fault. A fade
  // over a couple of hundred milliseconds reads as a contact you are losing.
  const asp = aspectOf(bandit, at(90));
  let prev = presenceAt(asp, 0, 3), worst = 0, sawMid = 0, n = 0;
  for (let i = 1; i <= 900; i++) {                 // fifteen seconds at 60fps
    const v = presenceAt(asp, i * 16.7, 3);
    worst = Math.max(worst, Math.abs(v - prev));
    if (v > 0.15 && v < 0.85) sawMid++;
    prev = v; n++;
  }
  console.log(`     biggest step in one frame ${worst.toFixed(3)}, part-way between ` +
              `${Math.round(100 * sawMid / n)}% of the time`);
  check('presence never jumps', worst < 0.25, 'a hard cut would be 1.0');
  check('and it spends real time part-way there', sawMid / n > 0.03,
    'which is the fade you can actually see');
  check('it still reaches both ends', (() => {
    let lo = 1, hi = 0;
    for (let i = 0; i < 900; i++) { const v = presenceAt(asp, i * 16.7, 3); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return lo < 0.05 && hi > 0.95;
  })(), 'a fade that never finishes is just fog');
  check('a plain target is simply there, with no shimmer at all',
    presenceAt(1, 0, 3) === 1 && presenceAt(1, 999, 7) === 1);
  check('the crossing is a real width', SOFT > 0 && SOFT < 1);
}

console.log('\nthe flicker itself');
{
  // It has to shimmer, not strobe: a value that flips every frame is a headache
  // rather than an effect.
  const a = aspectOf(bandit, at(90));
  let flips = 0, was = shownAt(a, 0, 3);
  for (let i = 1; i < 600; i++) {                 // ten seconds at 60fps
    const now = shownAt(a, i * 16.7, 3);
    if (now !== was) flips++;
    was = now;
  }
  console.log(`     on the beam it changes state ${flips} times in ten seconds`);
  check('it shimmers rather than strobes', flips > 2 && flips < 90,
    'a few times a second at most');
  check('two Bandits do not blink together', (() => {
    let same = 0;
    for (let i = 0; i < 400; i++)
      if (shownAt(a, i * 16, 1) === shownAt(a, i * 16, 7)) same++;
    return same < 380;                            // not lockstep
  })(), 'the seed is the ship id, so a pair of them shimmer out of phase');
  check('the same Bandit looks the same to everybody at the same moment',
    shownAt(a, 12345, 9) === shownAt(a, 12345, 9),
    'deterministic in time and id, so two clients agree');
  check('duty never drops to nothing', dutyAt(0) >= MIN_DUTY,
    'you get a glimpse eventually, even nose-on');
}

console.log('\nthe Bandit');
{
  const b = ALIENS.bandit;
  check('it is in the wild and it hides', WILD.includes('bandit') && b.stealth === true);
  check('it is harder than the thing you meet first',
    effectiveHp('bandit') > effectiveHp('drifter') && b.attrs.damage > ALIENS.drifter.attrs.damage,
    `${effectiveHp('bandit')} ehp and ${b.attrs.damage} a shot`);
  check('and quicker, so you cannot simply get behind it',
    b.attrs.speed > ALIENS.drifter.attrs.speed,
    'the counterplay is out-turning it, not out-running it');
  check('it picks the fight from beyond where you could see it anyway',
    b.aggro > 0, `engages at ${b.aggro}`);
  check('it does not run', b.flee === 0,
    'it is already hard to hit and faster than you — running would just mean ' +
    'dropping the lock, healing out of reach and coming back');
  check('unlike a Drifter, which does', ALIENS.drifter.flee > 0);

  // seenAs is what the client actually calls.
  const v = seenAs({ x: 0, y: 0, heading: 0 }, { x: 500, y: 0 }, 1000, 2);
  check('seenAs hands back everything the client needs',
    typeof v.aspect === 'number' && typeof v.alpha === 'number' && typeof v.shown === 'boolean'
    && Number.isFinite(v.aspect) && Number.isFinite(v.alpha));
}

console.log('\nbreaking without giving the game away');
{
  const { jinkHeading, JINK_CANT } = await import('../shared/aliens.js');
  // Breaking is what shows you a Bandit — but facing its own velocity turned it
  // fully broadside every time it jinked, and the camouflage stopped meaning
  // anything the moment a fight started, which is when it should matter most.
  const you = { x: 0, y: 0 };
  const a = { x: 400, y: 0, vx: 0, vy: 300 };          // sitting east, sliding north
  const face = Math.atan2(you.y - a.y, you.x - a.x);   // straight at you
  const travel = Math.atan2(a.vy, a.vx);
  const h = jinkHeading(a, you);
  const off = (x, y) => { let d = x - y; while (d > Math.PI) d -= Math.PI * 2;
                          while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
  console.log(`     travelling ${Math.round(off(travel, face) * 180 / Math.PI)}° off you, ` +
              `it points ${Math.round(off(h, face) * 180 / Math.PI)}° off`);
  check('it crabs rather than turning broadside',
    off(h, face) > 0.05 && off(h, face) < off(travel, face) - 0.05,
    'part-way round, so it stays half-hidden while it works');
  check('the cant is a real fraction of the turn', JINK_CANT > 0 && JINK_CANT < 1);
  check('with nothing to face it just flies where it is going',
    Math.abs(jinkHeading(a, null) - travel) < 1e-9);
  check('and the aspect it presents stays in the interesting middle', (() => {
    const asp = aspectOf({ x: a.x, y: a.y, heading: h }, you);
    return asp > 0.1 && asp < 0.85;                    // neither gone nor plain
  })(), 'visible some of the time, which is the whole idea');
}

console.log('\nwhat the missile can see');
{
  // A seeker has a worse look than the pilot who fired it: small, close in, and
  // looking from whatever angle it happens to be at. It holds the target
  // intermittently, steers sloppily while it has it, and coasts when it does not.
  const { seekerOn, SEEK_WOBBLE } = await import('../shared/rockets.js');
  const target = { x: 0, y: 0, heading: 0, def: { stealth: true } };
  const at = (deg, age = 0, seed = 3) => {
    const r = deg * Math.PI / 180;
    return seekerOn({ x: Math.cos(r) * 400, y: Math.sin(r) * 400, age, seed }, target);
  };
  console.log('     ' + [0, 90, 180].map(d =>
    `${d}° wobble ${Math.round(at(d).wobble)}px`).join('   '));
  check('a plain target is tracked perfectly',
    seekerOn({ x: 100, y: 0, age: 0, seed: 1 }, { x: 0, y: 0, heading: 0 }).locked === true
    && seekerOn({ x: 100, y: 0, age: 0, seed: 1 }, { x: 0, y: 0, heading: 0 }).wobble === 0,
    'nothing here touches an ordinary alien');
  check('the aim wanders more the fainter the return',
    at(0).wobble > at(90).wobble && at(90).wobble > at(180).wobble);
  check('and tail-on it does not wander at all', at(180).wobble === 0);
  check('a seeker loses it and finds it again as it flies', (() => {
    let held = 0, n = 0;
    for (let a = 0; a < 3; a += 0.02) { if (at(20, a, 5).locked) held++; n++; }
    return held > 0 && held < n;                   // neither blind nor perfect
  })(), 'intermittently, which is what makes a rocket go past something quiet');
  check('the wobble never exceeds what was declared',
    [0, 45, 90, 135, 180].every(d => at(d).wobble <= SEEK_WOBBLE + 1e-9));
}

console.log('\nthe fight');
{
  // A real duel: alien AI, evasion, both weapon systems, bolts and rockets
  // actually in flight. The whole point of this alien is the shape of this
  // table, so the table is the test.
  const { newShip, step, stepVitals, inHaven } = await import('../shared/sim.js');
  const { fire, stepBolts, faceTarget } = await import('../shared/combat.js');
  const { launch, stepRockets } = await import('../shared/rockets.js');
  const { sanitiseFit } = await import('../shared/gear.js');
  const { slotsOf } = await import('../shared/ships.js');
  const { MAPS } = await import('../shared/maps.js');
  const { routeTo, stepPower } = await import('../shared/power.js');
  const { newAlien, stepAlienAI, stepEvade } = await import('../shared/aliens.js');
  const dt = 1 / 30, map = MAPS.m1;
  const fit = o => ({ weapon: [], generator: [], tech: [], ...o });

  const duel = (kind, weapon, evade = true) => {
    const f = sanitiseFit(slotsOf('vanguard'), fit({ weapon }));
    const me = newShip(6000, 4000, 'vanguard', f, Array(6).fill('emitter5'), 'wedge');
    routeTo(me.power, 'weapons');
    for (let i = 0; i < 120; i++) stepPower(me.power, me.stats, dt);
    const a = newAlien(kind, 1e6, map, 5, { x: 6500, y: 4000 });
    if (!evade) a.def = { ...a.def, evades: false };
    a.target = 1;
    const mag = { key: 'c', n: 1e9, mult: 1 }, wh = { key: 'h', n: 1e9, mult: 1 };
    const bolts = [], rocks = [], here = [{ id: 1, ship: me, haven: inHaven(map, me) }];
    let t = 0, fired = 0, landed = 0, seen = 0, n = 0;
    while (t < 90 && a.hp > 0) {
      stepAlienAI(a, map, here, dt);
      const incoming = [...rocks.filter(r => r.target === a),
        ...bolts.filter(b => b.target === a).map(b => ({
          x: b.sx + (b.ax - b.sx) * (1 - b.t / b.ttl), y: b.sy + (b.ay - b.sy) * (1 - b.t / b.ttl),
          vx: (b.ax - b.sx) / b.ttl, vy: (b.ay - b.sy) / b.ttl }))];
      const breaking = stepEvade(a, incoming, map, dt);
      step(a, dt); stepVitals(a, dt, false);
      if (breaking && Math.hypot(a.vx, a.vy) > 20) a.heading = Math.atan2(a.vy, a.vx);
      else faceTarget(a, me);
      faceTarget(me, a);
      stepPower(me.power, me.stats, dt);
      for (const s2 of fire(me, a, dt, mag)) { bolts.push(s2); fired++; }
      for (const r of launch(me, a, dt, wh)) { rocks.push(r); fired++; }
      landed += stepBolts(bolts, dt).length + stepRockets(rocks, dt).length;
      seen += dutyAt(aspectOf(a, me)); n++;
      t += dt;
    }
    return { secs: t, killed: a.hp <= 0, hit: fired ? landed / fired : 0, seen: seen / n };
  };

  const TOP = Array(3).fill('emitter5'), PODS = Array(3).fill('pod3');
  const guns = duel('bandit', TOP), pods = duel('bandit', PODS);
  const still = duel('bandit', TOP, false), soft = duel('drifter', TOP);
  const row = (l, r) => `     ${l.padEnd(22)}${(r.killed ? r.secs.toFixed(1) + 's' : '90s+').padStart(6)}   ` +
    `${String(Math.round(r.hit * 100)).padStart(3)}% land   visible ${Math.round(r.seen * 100)}%`;
  console.log(row('MK-V lasers', guns));
  console.log(row('Osprey Racks', pods));
  console.log(row('if it never dodged', still));
  console.log(row('a Drifter, for scale', soft));

  check('a finished ship cannot delete it', guns.killed && guns.secs > 10 && guns.secs < 30,
    `${guns.secs.toFixed(0)}s with the best guns in the game`);
  check('and it is not unkillable either', guns.killed && pods.killed);
  check('most of that is missing, not soaking', guns.hit < 0.55,
    `${Math.round(guns.hit * 100)}% of bolts land against ${Math.round(still.hit * 100)}% on something holding still`);
  check('rockets are the answer to a thing that dodges', pods.secs < guns.secs * 0.8 && pods.hit > guns.hit,
    `${pods.secs.toFixed(0)}s against ${guns.secs.toFixed(0)}s — they follow it round the corner`);
  check('dodging is what exposes it', guns.seen > still.seen * 3,
    `visible ${Math.round(guns.seen * 100)}% of the time while it works, ${Math.round(still.seen * 100)}% when it does not`);
  check('a Drifter is still a speed bump next to it', soft.secs < 2,
    `${soft.secs.toFixed(1)}s — the Bandit is a different order of thing`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the Bandit'}\n`);
process.exit(fails.length ? 1 : 0);
