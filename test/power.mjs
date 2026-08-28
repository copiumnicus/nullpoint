import { SYSTEMS, BOOST, SPOOL_UP, SPOOL_DN, newPower, routeTo, stepPower, levelOf, boostOf, chargePct }
  from '../shared/power.js';
import { newShip, step, stepVitals, applyDamage, shieldMax } from '../shared/sim.js';
import { resolve, HULLS } from '../shared/ships.js';
import { fire, salvoOf, stepsOf, MAX_VOLLEY_STEPS } from '../shared/combat.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const hold = (s, secs) => { for (let i = 0; i < Math.round(secs / dt); i++) { step(s, dt); stepVitals(s, dt); } };

console.log('\nspooling up');
{
  const s = newShip(0, 0, 'vanguard');
  routeTo(s.power, 'thrusters');
  const trace = [];
  for (const at of [0.5, 1, 1.5, 2, 2.5, 3]) { hold(s, at - (trace.at(-1)?.[0] ?? 0)); trace.push([at, levelOf(s.power, 'thrusters', s.stats)]); }
  console.log('     ' + trace.map(([t, l]) => `${t}s ${(l * 100).toFixed(0)}%`).join('  '));
  check('the ramp is quadratic, not linear',
    trace[1][1] < 0.25 && trace[3][1] > 0.4 && trace[3][1] < 0.6,
    'slow to commit, then it arrives');
  check('full is exactly full, with nothing left to jitter',
    levelOf(s.power, 'thrusters', s.stats) === 1 && boostOf(s.power, 'thrusters', s.stats) === 1 + BOOST,
    `+${Math.round(BOOST * 100)}% on the nose`);
  routeTo(s.power, null);
  hold(s, SPOOL_DN + 0.2);
  check('and it bleeds off faster than it built up', levelOf(s.power, 'thrusters', s.stats) === 0,
    `${SPOOL_UP}s up, ${SPOOL_DN}s down`);
}

console.log('\nthe capacitor');
{
  const s = newShip(0, 0, 'vanguard');
  const cap = s.stats.capacitor;
  routeTo(s.power, 'weapons');
  hold(s, SPOOL_UP);
  const atFull = s.power.charge;
  hold(s, 10);
  const drained = atFull - s.power.charge;
  check('a fully powered system draws one second of capacitor per second',
    Math.abs(drained - 10) < 0.3, `${drained.toFixed(1)}s spent in 10s`);
  hold(s, cap);
  check('it runs flat after about its rated seconds', s.power.charge === 0, `${cap}s rated`);
  check('and then falls back to the free trickle, not to nothing',
    Math.abs(levelOf(s.power, 'weapons', s.stats) - s.stats.sustain) < 1e-9
    && levelOf(s.power, 'weapons', s.stats) > 0.2,
    `+${Math.round(BOOST * s.stats.sustain * 100)}% for as long as you like`);
  hold(s, 20);
  check('holding the route does not recharge it', s.power.charge === 0, 'you have to stand down');
  routeTo(s.power, null);
  hold(s, 10);
  check('standing down refills it', s.power.charge > 10 && s.power.charge < cap,
    `${s.power.charge.toFixed(0)}/${cap}s after 10s idle`);
  hold(s, cap / s.stats.recharge);
  check('and it stops at full', Math.abs(s.power.charge - cap) < 0.01 && chargePct(s.power, s.stats) === 1);
}

console.log('\nwhat the boost is worth');
{
  const s = newShip(0, 0, 'vanguard');
  const base = resolve('vanguard');
  routeTo(s.power, 'thrusters'); hold(s, SPOOL_UP);
  s.dx = 1; s.dy = 0;
  const before = s.x; hold(s, 4);
  check('thrusters actually move you faster',
    (s.x - before) / 4 > base.speed * 1.2, `${Math.round((s.x - before) / 4)} vs ${base.speed} px/s`);

  const g = newShip(0, 0, 'vanguard', { weapon: ['emitter1'], generator: [], tech: [] });
  routeTo(g.power, 'weapons'); hold(g, SPOOL_UP);
  const mark0 = newShip(400, 0, 'kestrel');
  let shot = null;
  for (let i = 0; i < 200 && !shot; i++) shot = fire(g, mark0, dt)[0] ?? null;
  check('weapons hit harder', Math.abs(shot.dmg - g.stats.damage * (1 + BOOST)) < 0.01,
    `${Math.round(g.stats.damage)} -> ${Math.round(shot.dmg)}`);
}

console.log('\ncannons');
{
  const s = newShip(0, 0, 'vanguard', { weapon: ['emitter1', 'emitter1'], generator: [], tech: [] });
  s.heading = 0;                                   // nose along +x, so the mounts are +/- y
  const mark = newShip(500, 0, 'kestrel');
  const shots = [];
  for (let i = 0; i < 600 && shots.length < 4; i++) for (const b of fire(s, mark, dt)) shots.push(b);
  const sides = shots.map(b => Math.sign(+(b.sy - s.y).toFixed(6)));
  console.log(`     muzzle offsets: ${shots.map(b => (b.sy - s.y).toFixed(1)).join(', ')}`);
  check('shots leave a hardpoint, not the middle of the hull',
    shots.every(b => Math.abs(b.sy - s.y) > 1 && b.sx > s.x));
  check('and alternate between the two cannons',
    sides.join() === '-1,1,-1,1' || sides.join() === '1,-1,1,-1');
  check('the beam is as thick as the rack', shots[0].w === 2, '2 emitters fitted');
  const a = newShip(0, 0, 'vanguard'); a.isAlien = true; a.heading = 0;
  let ab = null;
  for (let i = 0; i < 200 && !ab; i++) ab = fire(a, mark, dt)[0] ?? null;
  check('a hostile with no visible mounts still fires from centre',
    ab.sx === a.x && ab.sy === a.y);
}

console.log('\none bolt per emitter');
{
  const rig = guns => {
    const w = Array(Math.min(4, guns)).fill('emitter1');
    const d = Array(Math.max(0, guns - 4)).fill('emitter1');
    const s = newShip(0, 0, 'bulwark', { weapon: w, generator: [], tech: [] }, d);
    s.heading = 0; return s;
  };
  const cycleOf = (guns) => {
    const s = rig(guns), mark = newShip(400, 0, 'kestrel');
    let bolts = 0, dmg = 0, t = 0;
    while (t < 1 / s.stats.fireRate - 1e-9) { for (const b of fire(s, mark, dt)) { bolts++; dmg += b.dmg; } t += dt; }
    return { bolts, dmg, guns: s.guns, total: s.stats.damage };
  };
  for (const n of [1, 2, 4, 8]) {
    const c = cycleOf(n);
    console.log(`     ${String(n).padStart(2)} emitters -> ${String(c.bolts).padStart(2)} bolts a cycle, ` +
                `${Math.round(c.dmg / c.bolts)} each, ${Math.round(c.dmg)} total`);
  }
  check('every emitter fires its own bolt', [1, 2, 4, 8].every(n => cycleOf(n).bolts === n));
  check("a cycle still delivers exactly the ship's damage",
    [1, 2, 4, 8].every(n => { const c = cycleOf(n); return Math.abs(c.dmg - c.total) < 0.01; }),
    'split across the stream rather than merged into one fat shot');
  check('more emitters means more total damage, as they always did',
    cycleOf(8).dmg > cycleOf(4).dmg && cycleOf(4).dmg > cycleOf(1).dmg);
  check('past four they double up instead of stringing out',
    salvoOf(4) === 1 && salvoOf(8) === 2 && stepsOf(8) === MAX_VOLLEY_STEPS,
    'eight bolts strung across one cycle would arrive slower than one gun does');
  check('a volley stops if the target dies partway through', (() => {
    const s = rig(4), mark = newShip(400, 0, 'kestrel');
    let got = 0;
    for (const b of fire(s, mark, dt)) got++;      // opens the volley
    mark.hp = 0;
    for (let i = 0; i < 200; i++) got += fire(s, mark, dt).length;
    return got === 1 && s.volley === 0;
  })(), 'no firing into a wreck');
}

console.log('\nshields scale the pool, charge included');
{
  const s = newShip(0, 0, 'vanguard');
  applyDamage(s, 700);
  const low = s.shield, lowMax = shieldMax(s);
  routeTo(s.power, 'shields'); hold(s, SPOOL_UP);
  const up = s.shield, upMax = shieldMax(s);
  console.log(`     ${Math.round(low)}/${Math.round(lowMax)}  ->  ${Math.round(up)}/${Math.round(upMax)}`);
  check('the maximum goes up by the boost', Math.abs(upMax / lowMax - (1 + BOOST)) < 1e-6);
  check('and so does what you are actually holding', Math.abs(up / low - (1 + BOOST)) < 0.02,
    'a partly drained shield gains too, like strength in Dota');
  routeTo(s.power, null); hold(s, SPOOL_DN + 0.5);
  check('standing down scales both back down', Math.abs(shieldMax(s) - lowMax) < 1e-6 && s.shield < up);
  check('it never leaves you over the cap', s.shield <= shieldMax(s) + 1e-9);
}

console.log('\nships and technology');
{
  const caps = Object.keys(HULLS).map(h => [h, resolve(h).capacitor]);
  caps.forEach(([h, c]) => console.log(`     ${h.padEnd(9)} ${c}s`));
  check('every hull carries a usable capacitor', caps.every(([, c]) => c >= 30 && c <= 60));
  const wheel = resolve('vanguard', { weapon: [], generator: [], tech: ['flywheel'] });
  check('a technology can change it', wheel.capacitor > resolve('vanguard').capacitor,
    `${resolve('vanguard').capacitor}s -> ${Math.round(wheel.capacitor)}s`);
  check('and it costs you something', wheel.shieldRegen < resolve('vanguard').shieldRegen);
  const gen = resolve('vanguard', { weapon: [], generator: ['cellC', 'cellC'], tech: [] });
  check('generators raise the free trickle', gen.sustain > resolve('vanguard').sustain,
    `+${Math.round(BOOST * resolve('vanguard').sustain * 100)}% -> +${Math.round(BOOST * gen.sustain * 100)}% forever`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — reactor'}\n`);
process.exit(fails.length ? 1 : 0);
