import { SYSTEMS, BOOST, SPOOL_UP, SPOOL_DN, newPower, routeTo, stepPower, levelOf, boostOf, chargePct, ceilingOf }
  from '../shared/power.js';
import { newShip, step, stepVitals, applyDamage, shieldMax, shieldRate, speedOf } from '../shared/sim.js';
import { resolve, HULLS, slotsOf } from '../shared/ships.js';
import { boltWidth, fire, salvoOf, stepsOf, MAX_VOLLEY_STEPS } from '../shared/combat.js';

import { wakeSeconds, sustainedDps } from '../shared/tech.js';
import { bountyFor, farmHp } from '../shared/aliens.js';

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
  // Thickness follows the punch a single bolt carries, not how many barrels
  // threw it — a better emitter looks better, a bigger rack just fires more.
  const beam = (hull, item) => {
    const n = slotsOf(hull).weapon, f = { weapon: Array(n).fill(item), generator: [], tech: [] };
    const a = newShip(0, 0, hull, f); a.heading = 0;
    const tgt = newShip(400, 0, 'kestrel');
    for (let i = 0; i < 600; i++) { const v = fire(a, tgt, dt); if (v.length) return boltWidth(v[0].w); }
    return 0;
  };
  const tiers = ['emitter1', 'emitter2', 'emitter3'].map(e => [e, beam('hauler', e)]);
  console.log(`     hauler: ${tiers.map(([e, w]) => `${e} ${w.toFixed(1)}px`).join('  ')}`);
  check('a better emitter throws a visibly heavier bolt',
    tiers[1][1] > tiers[0][1] + 0.4 && tiers[2][1] > tiers[1][1] + 0.4);
  const wide = ['hauler', 'kestrel', 'vanguard', 'bulwark'].map(h => beam(h, 'emitter1'));
  const tierStep = tiers[2][1] - tiers[0][1], hullSpread = Math.max(...wide) - Math.min(...wide);
  console.log(`     full MK-I rack: ${wide.map(w => w.toFixed(1) + 'px').join('  ')}` +
              `   (${hullSpread.toFixed(1)}px across hulls vs ${tierStep.toFixed(1)}px across tiers)`);
  check('more barrels never thickens the bolt', wide[3] <= wide[0] + 0.01,
    'a full Bulwark rack fires four ordinary bolts, not one fat one');
  check('what you fitted matters more than how many', hullSpread < tierStep * 0.6);
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

// REGENERATING ON THE REACTOR: WORTH DOING, AND NOT MANDATORY.
//
// The design target is switching treads in Dota — optional, and the pilot who does
// it is simply better off. So there are two things to keep, and they pull opposite
// ways. It has to be WORTH the keypress, or nobody bothers and the mechanic is dead
// weight; and it has to be POSSIBLE TO SKIP, or it is a chore performed between
// every pair of fights.
//
// Nothing here is a tax. There is no ramp, no cooldown, no switching penalty, and
// deliberately so: the cost is already the reactor being one dial, so the price of
// having it on your shields is being caught with it there. These are the claims for
// both halves, with the numbers in the detail.
console.log('\nregenerating on the reactor: what it buys and what it costs');
{
  // Fly it properly: real spool, real capacitor, and stand down the moment the
  // shields are whole — which is what a pilot who understood the mechanic would do.
  const ready = routed => {
    const s = newShip(0, 0, 'vanguard');
    applyDamage(s, s.stats.shield * 3 + 1);
    if (routed) routeTo(s.power, 'shields');
    let t = 0, full = -1;
    while (t < 300) {
      hold(s, dt); t += dt;
      if (full < 0 && s.shield >= shieldMax(s) - 1e-6) { full = t; routeTo(s.power, null); }
      if (full >= 0 && s.power.charge >= s.stats.capacitor - 1e-9) break;
    }
    return { full, both: t };
  };
  const cold = ready(false), wired = ready(true);
  console.log(`     cold  shields ${cold.full.toFixed(2)}s, everything ${cold.both.toFixed(2)}s` +
              `   wired  shields ${wired.full.toFixed(2)}s, everything ${wired.both.toFixed(2)}s`);
  check('the capacitor is what it is spent out of: shields sooner, a full reactor later',
    wired.full < cold.full - 3 && wired.both > cold.both + 2,
    `shields whole ${(cold.full - wired.full).toFixed(2)}s sooner, but shields AND a full capacitor ` +
    `${(wired.both - cold.both).toFixed(2)}s later — you cannot arrive at the next fight with both`);

  // The other half of the bill, and the one a pilot feels first. Between fights the
  // reactor is not idle by default; it is on the engines.
  const travel = secs => {
    const go = to => {
      const s = newShip(0, 0, 'vanguard');
      s.dx = 1; s.dy = 0;                    // hold a heading, full throttle
      if (to) routeTo(s.power, to);
      for (let i = 0; i < Math.round(secs / dt); i++) { step(s, dt); stepVitals(s, dt); }
      return s.x;
    };
    return { slow: go('shields'), fast: go('thrusters') };
  };
  const WINDOW = 21.9;                       // the Vanguard's boosted empty-to-full, from ships.mjs
  const t = travel(WINDOW);
  check('and the reactor cannot be in two places, so the window is flown 23% slower',
    t.fast - t.slow > 1500,
    `${Math.round(t.fast - t.slow)}px given up over the ${WINDOW}s window — ` +
    `${Math.round(speedOf(newShip(0, 0, 'vanguard')))}px/s against ` +
    `${Math.round(speedOf(newShip(0, 0, 'vanguard')) * (1 + BOOST))}, roughly a seventh of a sector`);

  check('a boosted refill is still a share of the pool, so the pool it built is not free hit points',
    (() => {
      const s = newShip(0, 0, 'vanguard');
      routeTo(s.power, 'shields'); hold(s, SPOOL_UP + 0.5);
      const wired = shieldRate(s) * shieldMax(s);
      const bare = s.stats.shieldRegen * s.stats.shield;
      return Math.abs(wired / bare - (1 + BOOST) ** 2) < 0.01;
    })(),
    `${(1 + BOOST).toFixed(2)}x the pool at ${(1 + BOOST).toFixed(2)}x the share is ` +
    `x${((1 + BOOST) ** 2).toFixed(3)} the points per second — and every one of them is a point ` +
    'that vanishes again the moment you route away');

  // AND THE OTHER HALF: is it worth the keypress at all? The failure mode the
  // designer named is a mechanic nobody bothers with, so this is the payoff as a
  // number — and the number that matters is the SHARE of your own pool you turn up
  // to the next fight holding, because the swelled pool scales straight back down
  // the moment you route to your guns. Points would flatter it; the share does not.
  const arrive = (hull, lull, routed) => {
    const s = newShip(0, 0, hull);
    applyDamage(s, s.stats.shield * 5 + 1);
    if (routed) routeTo(s.power, 'shields');
    hold(s, lull);
    return s.shield / shieldMax(s);
  };
  const LULLS = [10, 15, 20, 30];
  const EDGE = ['hauler', 'vanguard', 'bulwark'];
  for (const h of EDGE)
    console.log(`     ${h.padEnd(9)} ` + LULLS.map(L =>
      `${L}s ${(100 * arrive(h, L, false)).toFixed(0)}%->${(100 * arrive(h, L, true)).toFixed(0)}%`.padEnd(16)).join(''));
  check('a short lull is where it pays: ten seconds on, and you turn up with most of a shield instead of a sliver',
    EDGE.every(h => arrive(h, 10, true) / arrive(h, 10, false) > 1.6),
    EDGE.map(h => `${h} x${(arrive(h, 10, true) / arrive(h, 10, false)).toFixed(2)}`).join(', ') +
    ` — a Vanguard at ${(100 * arrive('vanguard', 10, true)).toFixed(0)}% against ` +
    `${(100 * arrive('vanguard', 10, false)).toFixed(0)}%`);
  check('and a long one is where it does not, so skipping it costs a pilot nothing they had',
    EDGE.every(h => arrive(h, 30, false) > 0.79 && arrive(h, 30, true) / arrive(h, 30, false) < 1.3),
    EDGE.map(h => `${h} x${(arrive(h, 30, true) / arrive(h, 30, false)).toFixed(2)}`).join(', ') +
    ' at thirty seconds — both pilots are simply full, and nobody was made to press anything');

  // Where it does NOT pay, which is the one place PvP is formalised. `dry` is on in
  // an instanced sector, so a duel has no regeneration at all to speed up: routing
  // to shields in there still buys the bigger pool and nothing else.
  const duel = (() => {
    const s = newShip(0, 0, 'vanguard');
    applyDamage(s, s.stats.shield + 1);
    routeTo(s.power, 'shields');
    for (let i = 0; i < Math.round(60 / dt); i++) { step(s, dt); stepVitals(s, dt, false, true); }
    return { shield: s.shield, max: shieldMax(s) };
  })();
  check('inside a duel it buys the bigger pool and nothing else, because nothing regenerates in there',
    duel.shield === 0 && duel.max > 900,
    `60s routed to shields in an instanced sector: ${Math.round(duel.shield)} of ` +
    `${Math.round(duel.max)} — this is a between-engagements mechanic, not a duelling one`);
}

// THE GOVERNOR BYPASS, which is the only thing in the game that touches the spool.
//
// The pitch was "remove the spool", so the first claim here is that there IS one and
// what it costs — measured before anything was designed, because a delay invented in
// order to be removed is not a mechanic.
console.log('\nthe Governor Bypass: what the spool costs, and what buying it out costs');
{
  const { hasBypass, addMod, applyResearch } = await import('../shared/research.js');
  const { BYPASS_BROWNOUT, bypassed } = await import('../shared/power.js');
  const bypass = st => applyResearch(st, addMod(0, 'bypass1'));

  // The ramp is squared, so SPOOL_UP understates it badly: three seconds is the time
  // to FULL, and the halfway point of the delivered boost is at 2.1s, not 1.5.
  const cold = () => {
    const s = newShip(0, 0, 'vanguard');
    routeTo(s.power, 'weapons');
    const at = [];
    let t = 0;
    for (const m of [0.5, 1, 1.5, 2, 2.5, 3]) { hold(s, m - t); t = m; at.push([m, levelOf(s.power, 'weapons', s.stats)]); }
    return at;
  };
  const ramp = cold();
  console.log('     spooled  ' + ramp.map(([t, l]) => `${t}s ${(l * 100).toFixed(0)}%`).join('  '));
  check('the reactor really does spool, and it is worse than the constant reads',
    ramp[2][1] < 0.3 && ramp[5][1] === 1,
    `${SPOOL_UP}s to full, and the ramp is squared — ${(ramp[2][1] * 100).toFixed(0)}% of the boost ` +
    `delivered at the halfway mark, not 50%`);

  // The exact size of the tax, and the exact size of the bill, in the same unit.
  // Integrating a squared ramp over its own length gives T/3, so the spool withholds
  // 2T/3 boost-seconds every time you touch the dial.
  const withheld = (() => {
    let d = 0; const n = 4000;
    for (let i = 0; i < n; i++) d += Math.min(1, ((i + 0.5) / n)) ** 2 * SPOOL_UP / n;
    return SPOOL_UP - d;
  })();
  check('the brown-out is exactly the boost-seconds the spool was withholding',
    Math.abs(BYPASS_BROWNOUT - withheld) < 0.01,
    `the ramp delivers ${(SPOOL_UP - withheld).toFixed(3)}s of boost over its own ${SPOOL_UP}s where ` +
    `instant delivers ${SPOOL_UP} — so it withholds ${withheld.toFixed(3)}, and the bypass bills ` +
    `${BYPASS_BROWNOUT.toFixed(3)}s of tank. One point of charge is one second of full boost, so it ` +
    'is the same quantity handed back and taken away');

  const wired = newShip(0, 0, 'vanguard');
  wired.stats = bypass(wired.stats);
  check('a mask without it changes nothing about the reactor', !bypassed(newShip(0, 0, 'vanguard').stats),
    'and no bar on the ship moves either way — see test/research.mjs');
  routeTo(wired.power, 'weapons', wired.stats);
  check('with it, full power is there on the keypress rather than three seconds later',
    levelOf(wired.power, 'weapons', wired.stats) === 1 && boostOf(wired.power, 'weapons', wired.stats) === 1 + BOOST,
    `100% on the tick the key went down, against ${(ramp[0][1] * 100).toFixed(0)}% half a second in without it`);
  const afterOne = wired.power.charge;
  check('and the tank paid for it up front',
    Math.abs(wired.stats.capacitor - afterOne - BYPASS_BROWNOUT) < 1e-9,
    `${wired.stats.capacitor}s -> ${afterOne.toFixed(1)}s the instant you press it`);

  // The old system stops drawing on the same tick rather than bleeding for SPOOL_DN,
  // which is the other half of "instantly" and the half that is easy to forget.
  routeTo(wired.power, 'shields', wired.stats);
  check('the system you left stops on the same tick, rather than bleeding for a second and a half',
    levelOf(wired.power, 'weapons', wired.stats) === 0 && levelOf(wired.power, 'shields', wired.stats) === 1,
    `SPOOL_DN is ${SPOOL_DN}s and a bypassed reactor spends none of it`);

  // Standing down is FREE. A pilot billed for putting the reactor away would simply
  // leave it where it is, which is the opposite of what the row is for.
  const before = wired.power.charge;
  routeTo(wired.power, 'shields', wired.stats);          // toggles to null
  check('putting the reactor away costs nothing, so the row never punishes standing down',
    wired.power.to === null && wired.power.charge === before,
    'the brown-out is on ARRIVING somewhere, which is also why standing down first cannot dodge it');
  routeTo(wired.power, 'thrusters', wired.stats);
  check('and the next route pays again, so there is no free switch to be had',
    Math.abs(before - wired.power.charge - BYPASS_BROWNOUT) < 1e-9,
    `two keypresses, one bill of ${BYPASS_BROWNOUT.toFixed(1)}s — the same bill one keypress would have paid`);

  // WHERE IT PAYS, and the measurement moved the answer.
  //
  // The pitch was that the spool is the tax on the between-fights shield loop. It is
  // NOT, and this is the finding: `shieldWait` is shieldDelay/poolMult, which on a
  // Vanguard routed to shields is 6.2 seconds — longer than the 3 second spool — so
  // the reactor is already at full by the time a single point of shield comes back.
  // Measured over a ten second lull the spooled pilot and the bypassed one arrive at
  // exactly the same share, to the decimal.
  const arrive = (hull, lull, mode) => {
    const s = newShip(0, 0, hull);
    if (mode === 'bypass') s.stats = bypass(s.stats);
    applyDamage(s, s.stats.shield * 5 + 1);
    if (mode !== 'cold') routeTo(s.power, 'shields', s.stats);
    hold(s, lull);
    return s.shield / shieldMax(s);
  };
  check('it buys nothing at all on the way INTO a lull, because the shield delay already hid the spool',
    ['hauler', 'vanguard', 'bulwark'].every(h => Math.abs(arrive(h, 10, 'bypass') - arrive(h, 10, 'spool')) < 0.005),
    ['hauler', 'vanguard', 'bulwark'].map(h =>
      `${h} ${(100 * arrive(h, 10, 'spool')).toFixed(1)}% vs ${(100 * arrive(h, 10, 'bypass')).toFixed(1)}%`).join(', ') +
    ' after ten seconds — a Vanguard waits 6.2s before the shield moves and the spool is 3s, ' +
    'so the ramp finishes inside the delay and costs nothing');

  // It pays on the way OUT of one, which is the same keypress seen from the other
  // side: the fight starts, you take the reactor off your shields and put it on your
  // guns, and today that is three seconds of a fight fought at a quarter power.
  const opening = (secs, mode) => {
    const s = newShip(0, 0, 'vanguard', { weapon: ['emitter1'], generator: [], tech: [] });
    if (mode === 'bypass') s.stats = bypass(s.stats);
    routeTo(s.power, 'shields', s.stats);              // where a pilot is between fights
    hold(s, SPOOL_UP);
    routeTo(s.power, 'weapons', s.stats);              // and the fight starts
    const mark = newShip(400, 0, 'kestrel');
    let dmg = 0;
    for (let i = 0; i < Math.round(secs / dt); i++) {
      for (const b of fire(s, mark, dt)) dmg += b.dmg;
      step(s, dt); stepVitals(s, dt);
    }
    return dmg;
  };
  for (const secs of [3, 5, 10])
    console.log(`     first ${String(secs).padStart(2)}s of the fight: ` +
      `${Math.round(opening(secs, 'spool'))} damage spooled, ${Math.round(opening(secs, 'bypass'))} bypassed ` +
      `(x${(opening(secs, 'bypass') / opening(secs, 'spool')).toFixed(2)})`);
  check('what it buys is the OPENING of the next fight — three seconds fought at full instead of a quarter',
    opening(3, 'bypass') > opening(3, 'spool') * 1.15 && opening(10, 'bypass') < opening(10, 'spool') * 1.12,
    `x${(opening(3, 'bypass') / opening(3, 'spool')).toFixed(2)} over the first three seconds and ` +
    `x${(opening(10, 'bypass') / opening(10, 'spool')).toFixed(2)} over ten — it is worth most exactly ` +
    'where it is bought, at the front, and washes out over a long one');

  // AND IT IS NOT FREE, which is the whole of the trade. Mashed, it empties the tank
  // in a fixed number of keypresses whatever else you do with it.
  const swaps = st => Math.floor(st.capacitor / BYPASS_BROWNOUT);
  const rows = ['hauler', 'vanguard', 'bulwark'].map(h => [h, swaps(resolve(h))]);
  check('and mashing the dial is what it bills for: a tank is a fixed number of switches',
    rows.every(([, n]) => n >= 15 && n <= 30),
    rows.map(([h, n]) => `${h} ${n}`).join(', ') + ' switches to a full capacitor, before a single ' +
    'second of holding one — once a lull is nothing and once a second is the whole reactor');
  check('a flat reactor still switches, at the free trickle and nothing more', (() => {
    const s = newShip(0, 0, 'vanguard');
    s.stats = bypass(s.stats);
    s.power.charge = 0;
    routeTo(s.power, 'weapons', s.stats);
    return s.power.charge === 0 && levelOf(s.power, 'weapons', s.stats) === s.stats.sustain;
  })(), 'you cannot be billed below empty, and what you get for it is `sustain` — which is exactly ' +
        'the "fastest when you can least afford it" the row is sold on');
}

console.log('\nships and technology');
{
  const caps = Object.keys(HULLS).map(h => [h, resolve(h).capacitor]);
  caps.forEach(([h, c]) => console.log(`     ${h.padEnd(9)} ${c}s`));
  check('every hull carries a usable capacitor', caps.every(([, c]) => c >= 30 && c <= 60));
  // The measurement three technologies were deleted over: a capacitor is how long
  // ONE hold lasts, never what fraction of the time you get to hold it. The duty
  // cycle of a boost you cycle is recharge/(1+recharge), and the capacitor CANCELS
  // OUT of it — so the Reactor Flywheel, the Fast-Cycle Exciter and Cold-Running
  // Trim were three arrangements of a number that could not move.
  const duty = st => st.recharge / (1 + st.recharge);
  check('a bigger tank alone would not have bought any more uptime', (() => {
    const bare = resolve('vanguard');
    const onlyCap = { ...bare, capacitor: bare.capacitor * 2 };
    return Math.abs(duty(onlyCap) - duty(bare)) < 1e-9;
  })(), 'the capacitor cancels out of recharge/(1+recharge) — doubling it changes nothing');
  // So the reactor shelf is one entry now, and it is not an arrangement of the
  // duty cycle at all: it changes where the charge COMES FROM. This claim used to
  // read "the technologies that move uptime move the RATE instead", which was true
  // and still left three items nobody wanted. Standing still is the rate, and the
  // Wake Tap sells it.
  const tap = resolve('vanguard', { weapon: [], generator: [], tech: ['waketap'] });
  check('the one reactor technology sells you the refill itself', duty(tap) < duty(resolve('vanguard')),
    `recharge ${resolve('vanguard').recharge} -> ${tap.recharge.toFixed(2)}/s, ` +
    `duty ${(100 * duty(resolve('vanguard'))).toFixed(0)}% -> ${(100 * duty(tap)).toFixed(0)}%`);
  // And what you get back for it, which is the whole point: a kill hands back the
  // seconds the fight took. Not a chosen number — balance.js states the identity
  // it falls out of, credits per second of fight = dps x BOUNTY_RATE, so dividing
  // your share of the bounty by that rate IS the length of the fight. And draw is
  // normalised so a fully powered system empties the tank in exactly `capacitor`
  // seconds, which makes one point of charge one second of full boost.
  check('and a kill hands back exactly the seconds of reactor the fight took', (() => {
    const anchorStats = resolve('hauler', { weapon: ['emitter1'], generator: [], tech: ['waketap'] });
    const secs = wakeSeconds(bountyFor('drifter'), anchorStats);
    return Math.abs(secs - farmHp('drifter') / sustainedDps(anchorStats)) < 1e-9;
  })(), (() => {
    const a = resolve('hauler', { weapon: ['emitter1'], generator: [], tech: ['waketap'] });
    return `a Drifter is ${bountyFor('drifter')} cr, which off ${sustainedDps(a).toFixed(1)} cold dps is ` +
           `${wakeSeconds(bountyFor('drifter'), a).toFixed(2)}s — the fight it would have been with the reactor ` +
           'idle, so a pilot who spent the charge on the guns gets back more than they used';
  })());
  const gen = resolve('vanguard', { weapon: [], generator: ['cellC', 'cellC'], tech: [] });
  check('generators raise the free trickle', gen.sustain > resolve('vanguard').sustain,
    `+${Math.round(BOOST * resolve('vanguard').sustain * 100)}% -> +${Math.round(BOOST * gen.sustain * 100)}% forever`);
}

// --- what a generator gives back --------------------------------------------
// A generator is a straight trade: shields and capacitor for thrust. But the
// reactor it enlarges could only ever pay out a flat 30%, so fitting one made
// every routing decision slightly worse as well — you were slower, and routing
// to thrusters could not get you back to where you started.
console.log('\nthe reactor ceiling');
{
  const fitOf = o => ({ weapon: [], generator: [], tech: [], ...o });
  const bare = resolve('hauler', fitOf());
  const one  = resolve('hauler', fitOf({ generator: ['cellA'] }));
  const two  = resolve('hauler', fitOf({ generator: ['cellA', 'cellA'] }));

  check('a bare hull still has the plain ceiling', ceilingOf(bare) === BOOST,
    `${BOOST * 100}% with nothing fitted`);
  check('a generator raises it by exactly what it cost in speed', (() => {
    const lost = (bare.speed - one.speed) / bare.speed;
    return Math.abs((ceilingOf(one) - BOOST) - lost) < 1e-9;
  })(), `-${((bare.speed - one.speed) / bare.speed * 100).toFixed(1)}% speed, ` +
        `+${((ceilingOf(one) - BOOST) * 100).toFixed(1)}% ceiling`);
  check('so routing to thrusters gets you back to about where you started',
    Math.abs(one.speed * (1 + ceilingOf(one)) - bare.speed * (1 + BOOST)) / (bare.speed * (1 + BOOST)) < 0.02,
    `${Math.round(one.speed * (1 + ceilingOf(one)))} against ${Math.round(bare.speed * (1 + BOOST))} — within 2%`);
  check('and routing anywhere else is worth more than it was',
    ceilingOf(one) > BOOST, 'which is the reason to have paid for the reactor');
  check('two generators raise it twice, without compounding', (() => {
    return Math.abs((ceilingOf(two) - BOOST) - 2 * (ceilingOf(one) - BOOST)) < 1e-9;
  })(), 'measured against the hull\'s bare speed, so stacking is additive');

  // It is not free. The headroom only pays while capacitor is being spent, which
  // is exactly what a bigger reactor is for — and unpowered you are simply slower.
  check('unpowered, a generator is still purely a cost',
    one.speed < bare.speed, `${Math.round(one.speed)} against ${bare.speed} with the reactor idle`);
  // The ceiling is paid for in speed, so it cannot exceed the speed there was to
  // give. Past the floor a generator costs nothing further and must therefore
  // earn nothing further — it went on earning, and a floored Bulwark banked a
  // 198% ceiling for speed it had already spent.
  const { ATTRS } = await import('../shared/ships.js');
  const floored = resolve('bulwark', fitOf({ generator: ['cellE', 'cellE'] }), Array(12).fill('cellE'));
  const bareBul = resolve('bulwark', fitOf());
  check('the ceiling cannot exceed the speed there was to surrender',
    ceilingOf(floored) - BOOST <= (bareBul.speed - ATTRS.speed.min) / bareBul.speed + 1e-9,
    `${((ceilingOf(floored) - BOOST) * 100).toFixed(0)}% earned against ` +
    `${(((bareBul.speed - ATTRS.speed.min) / bareBul.speed) * 100).toFixed(0)}% surrenderable — it read 198% before`);
  check('and a ship at the speed floor stops earning more of it', (() => {
    const more = resolve('bulwark', fitOf({ generator: ['cellE', 'cellE'] }), Array(12).fill('cellE'));
    const evenMore = resolve('bulwark', fitOf({ generator: ['cellE', 'cellE', 'cellE'] }), Array(12).fill('cellE'));
    return Math.abs(ceilingOf(more) - ceilingOf(evenMore)) < 1e-9;
  })(), 'bolting on a generator you cannot pay for buys nothing');
  check('and the ceiling pays nothing without power routed',
    boostOf({ to: null, thrusters: 0, weapons: 0, shields: 0, charge: 99 }, 'thrusters', one) === 1,
    'a ceiling is a ceiling, not a bonus');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — reactor'}\n`);
process.exit(fails.length ? 1 : 0);
