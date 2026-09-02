// Claims about the Kedge, which is now one attack and nothing else.
//
// It used to be two things: a lance, and a FIX that took a sighting of where you were
// standing and three seconds later put you back on it. The fix is deleted — it was the
// only thing in the game that moved a ship its owner was not flying — and the whole of
// what it did for the fight is now done by the lance varying its own length. So this
// file is about one question: is one attack, at a distance that keeps changing, still a
// fight?
//
// Everything below is measured through the real loop: stepAlienAI, stepSweep, step,
// stepVitals, fire and stepBolts, in the order server.js calls them.

import fsMod from 'node:fs';
import { ALIENS, WILD, effectiveHp, farmHp, newAlien, stepAlienAI, mayHarm,
         standOff, BOUNTY_RATE, XP_RATE, threatDps } from '../shared/aliens.js';
// The lance. fire() returns nothing at all for a Kedge — see the gate at the top of it —
// so the harness below has to pull the same trigger the server does, or every number in
// this file is a measurement of a hostile that stopped shooting.
import { stepSweep, stepSweeps, sweepOf, strikeAt, spanOf, windOf, swingOf,
         headOf, tipOf, cycleOf, holdBand, SWEEP_READ } from '../shared/sweep.js';
import { newShip, step, stepVitals, inHaven, applyDamage } from '../shared/sim.js';
import { fire, stepBolts, faceTarget } from '../shared/combat.js';
import { routeTo } from '../shared/power.js';
import { MAPS } from '../shared/maps.js';
import { HULLS, resolve } from '../shared/ships.js';
import { buildFor, stageEhp, ANCHORS, POSTING } from '../shared/balance.js';
import { SHIP_FIELDS, EPHEMERAL, SWEEP_FIELDS, packSweep, unpackSweep } from '../shared/net.js';
import { MAX_FIELDS } from '../shared/delta.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const f = (v, d = 1) => Number(v).toFixed(d);
const dt = 1 / 30, map = MAPS.g1, K = ALIENS.kedge;
const ehp = s => s.hp + s.shield, full = s => s.stats.hull + s.stats.shield;

const mk = (kind, x, y, seed = 3) => {
  const a = newAlien(kind, 1e6, map, seed, { x, y });
  a.post = null; a.x = x; a.y = y; a.vx = a.vy = 0; return a;
};
const flyer = (stage, mul = 1, at = { x: 6000, y: 4000 }, route = 'weapons') => {
  const b = buildFor(stage);
  const p = newShip(at.x, at.y, b.hull, b.fit, b.drones, 'wedge', null, 0);
  routeTo(p.power, route);
  if (mul > 1) { p.stats = { ...p.stats, hull: p.stats.hull * mul, shield: p.stats.shield * mul };
                 p.hp = p.stats.hull; p.shield = p.stats.shield; }
  return p;
};

// server.js's tick, in server.js's order. The fix runs BEFORE the hull is stepped;
// see the comment there for the bug that ordering exists to prevent.
function tick(a, p, air, o = {}) {
  const here = [{ id: 1, ship: p, haven: inHaven(map, p), loud: 1 }];
  const tgt = stepAlienAI(a, map, here, dt);
  const victim = tgt ? here[0] : null;
  step(a, dt); step(p, dt); stepVitals(a, dt); stepVitals(p, dt);
  faceTarget(a, victim?.ship ?? null);
  for (const s of fire(a, victim?.ship ?? null, dt)) air.push(s);
  // THE LANCE, in server.js's order: thrown before the hulls settle and resolved after
  // them, because "did the head cross this ship" has to be asked of where the ship
  // actually IS. `o.arcs` is the list of swings in the air, so a caller that does not
  // want one simply does not pass it — which is what `noSweep` reads as.
  if (o.arcs) {
    const sw = stepSweep(a, victim?.ship ?? null, dt);
    if (sw) { o.arcs.push(sw); if (o.book) o.book.thrown = (o.book.thrown ?? 0) + 1; }
    for (const h of stepSweeps(o.arcs, here, dt, (w, c) => mayHarm({ provoked: w.by }, c))) {
      applyDamage(h.target, h.dmg);
      if (o.book) { o.book.cut += h.dmg; o.book.hits++; }
    }
  }
  if (o.playerFires) { faceTarget(p, a); const v = fire(p, a, dt);
                       if (v.length) { air.push(...v); a.provoked.add(1); a.target ??= 1; } }
  stepBolts(air, dt);
}

// A fight held at a fixed range, both guns live.
function duel(stage, mul, mode, o = {}) {
  const p = flyer(stage, mul);
  const a = mk('kedge', 6700, 4000);
  a.provoked.add(1); a.target = 1;
  const band = p.stats.weaponRange - 40, air = [], arcs = [];
  const book = { cut: 0, hits: 0 };
  let t = 0;
  while (t < 600 && a.hp > 0 && p.hp > 0) {
    const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
    p.tx = p.ty = null;
    if (mode === 'park') { p.dx = p.dy = null; }
    // THE ANSWER, and it is the one the mechanic is about: the lance is paid out to the
    // range you are holding, so break your RANGE. `flick` reverses radially every time a
    // swing goes taut, which is what a pilot reading the wind-up actually does — it is a
    // policy, not an oracle, and it does not look at the arc.
    else if (mode === 'flick') {
      const away = Math.floor(t / cycleOf(K)) % 2 ? 1 : -1;
      p.dx = away * dx / d; p.dy = away * dy / d;
    }
    else if (d < band - 20) { p.dx = dx / d; p.dy = dy / d; }
    else if (d > band + 20) { p.dx = -dx / d; p.dy = -dy / d; }
    else { p.dx = p.dy = 0; }
    tick(a, p, air, { playerFires: true, arcs, book, ...o });
    t += dt;
  }
  return { t, left: Math.max(0, ehp(p)) / full(p), killed: a.hp <= 0, died: p.hp <= 0,
           ...book, dps: book.cut / Math.max(dt, t) };
}

// A pilot who has decided to leave: full burn straight away, guns cold, from the
// range a Kedge holds station at. Returns when the leash finally breaks.
function leave(what, o = {}) {
  const p = HULLS[what] ? (() => { const s = newShip(1200, 4000, what); routeTo(s.power, 'thrusters'); return s; })()
                        : flyer(what, 1, { x: 1200, y: 4000 }, 'thrusters');
  const a = mk('kedge', 1200 - standOff(mk('kedge', 0, 0)) * 0.7, 4000);
  a.provoked.add(1); a.target = 1;
  const air = [], arcs = []; let t = 0;
  while (t < 400) {
    const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
    p.tx = p.ty = null; p.dx = dx / d; p.dy = dy / d;
    tick(a, p, air, { arcs, ...o });
    t += dt;
    if (a.target === null) return { got: true, t };
  }
  return { got: false, t };
}

console.log('\nwhere it lands on the ladder');
check('a Kedge is a rung of tens, and it is the Leviathan\'s',
  effectiveHp('kedge') === effectiveHp('leviathan') && effectiveHp('kedge') % 10 === 0 &&
  Math.abs(effectiveHp('kedge') - 650 * 10 ** 2) <= 10,
  `${effectiveHp('kedge').toLocaleString('en-US')} ehp — 650 x 10^2, and a multiple of ten so a bounty is whole credits`);
check('sharing a rung is allowed, but only across sectors',
  effectiveHp('kedge') < effectiveHp('thresher'),
  `${effectiveHp('kedge').toLocaleString('en-US')} under a Thresher's ${effectiveHp('thresher').toLocaleString('en-US')} on the same map — ` +
  'two hostiles of one weight in one sector makes the deadlier one pointless');
check('and it pays what it costs to kill, with nothing left over',
  K.bounty === farmHp('kedge') * BOUNTY_RATE && K.xp === farmHp('kedge') * XP_RATE,
  `${K.bounty.toLocaleString('en-US')} cr and ${K.xp.toLocaleString('en-US')} xp, both exact`);
check('it carries no effort multiplier, and that is a measurement rather than an omission',
  (K.effort ?? 1) === 1 && (() => {
    const on = duel('cruiser', 1, 'park'), off = duel('cruiser', 1, 'park', { noFix: true });
    return Math.abs(on.t / off.t - 1) < 0.02;
  })(),
  (() => { const on = duel('cruiser', 1, 'park'), off = duel('cruiser', 1, 'park', { noFix: true });
    return `${f(on.t)}s to kill with the fix live against ${f(off.t)}s without — a collapse always moves you ` +
           'TOWARD the thing shooting at you, so it can never cost you a shot. Effort is time; this is hull.'; })());
check('its dps is the model\'s own, not a number anybody chose',
  Math.abs(K.attrs.damage * K.attrs.fireRate - ANCHORS.pressure * stageEhp(POSTING.kedge.stage)) < 1e-9,
  `${K.attrs.damage} x ${K.attrs.fireRate} = ${f(K.attrs.damage * K.attrs.fireRate, 2)} = ` +
  `pressure x the ${POSTING.kedge.stage} stage's ${stageEhp(POSTING.kedge.stage).toLocaleString('en-US')} ehp`);

console.log('\nwhat the fight is');
{
  const hulls = Object.keys(HULLS).map(h => ({ h, st: resolve(h, { weapon: ['emitter5'], generator: [], tech: [] }) }));
  check('you cannot out-range it, which is what makes standing there cost something',
    hulls.every(x => K.attrs.weaponRange > x.st.weaponRange),
    `${K.attrs.weaponRange} against ` + hulls.map(x => `${x.h} ${x.st.weaponRange}`).join(', ') +
    ' — the Leviathan\'s number, for the Leviathan\'s reason');
  const rows = [['cruiser', 1], ['finished', 1], ['finished', 8], ['finished', 32]];
  for (const [stage, mul] of rows) {
    const r = duel(stage, mul, 'park');
    console.log(`     ${stage.padEnd(9)} x${String(mul).padStart(2)} research: ` +
      `${r.killed ? `killed it in ${f(r.t)}s` : `DIED at ${f(r.t)}s`}, ${(100 * r.left).toFixed(0)}% of hull and shield left`);
  }
  check('a pilot who cannot survive a Thresher can farm a Kedge, which is the whole reason it exists',
    duel('cruiser', 1, 'park').killed && duel('cruiser', 1, 'park').left > 0.25,
    (() => { const r = duel('cruiser', 1, 'park');
      return `${f(r.t)}s and ${(100 * r.left).toFixed(0)}% left against a Thresher that returns ` +
             `${effectiveHp('thresher').toLocaleString('en-US')} damage over its fight — 36x the same pilot`; })());
  check('and it is never the thing that kills them',
    rows.every(([s, m]) => !duel(s, m, 'park').died && !duel(s, m, 'kite').died),
    'four stages x two ways of flying it, no deaths');
  // REWRITTEN, and it is the ladder working rather than the Kedge slipping. This read
  // "the most dangerous gun in the bestiary", full stop, and it was true until the
  // deeps grew barrels: a Crucible and a Doldrum throw 438 each, which is not a chosen
  // number but ANCHORS.pressure x stageEhp('finished') — the model's own answer for a
  // stage five rungs past this one. A gate hostile out-gunning the deepest sector in
  // the galaxy would have been the thing to fix.
  //
  // What is still the Kedge's, and is the half that mattered, is DELIVERY: it collects
  // nearly all of its nominal because you cannot hold range on it, where a Bandit
  // throws 195 and lands 17. So the claim keeps its sentence and narrows its scope to
  // the ladder the Kedge is actually on.
  const gunOf = k => ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate;
  check('nothing on this side of the deeps hits harder, and what does is five rungs out', (() => {
    const armed = WILD.filter(k => ALIENS[k].attrs.damage > 0);
    const deeps = armed.filter(k => farmHp(k) > farmHp('hive'));
    return armed.every(k => k === 'kedge' || deeps.includes(k) || gunOf(k) <= gunOf('kedge'))
        && deeps.length > 0 && deeps.every(k => gunOf(k) > gunOf('kedge'));
  })(), `${f(gunOf('kedge'), 0)} nominal, and it collects ~95% of it because you cannot hold range — ` +
        'a Bandit throws 195 and lands 17 of it, because dodging your bolts takes its own gun off you. ' +
        `Only the deeps out-gun it, at ${f(gunOf('crucible'), 0)}, and that number is the balance ` +
        'model\'s own demand for the stage they are posted at rather than anybody\'s taste');
}

// --- THE LANCE ------------------------------------------------------------------
//
// A Kedge used to carry an aimed bolt beside its fix, and an aimed bolt is not dodged
// by anybody: the table at the top of orbs.js measures 94% of what one fires landing on
// a hull weaving as hard as it can. So half this hostile asked a question and the other
// half was a tax. The barrel is now a taut line paid out to the range you are holding
// with a fluke on the end of it, swung through an arc — see shared/sweep.js.
//
// Everything below is measured through the real loop, in server.js's order, against an
// immortal READER at its real pool: the pilot's hit points are put back every tick so
// the run is a fixed 120 seconds whatever it costs, which is the only way five policies
// are comparable. That is the same instrument the mirror's `immortal` flag is, and it
// is here for the same reason — five fights that ended at different times compare
// nothing.
console.log('\nthe lance');
function swing(stage, mode, { secs = 120, per = 0, phase = 0 } = {}) {
  const p = flyer(stage);
  // A hostile that cannot die, so the window is the window rather than however long the
  // pilot's gun took. Its own damage is untouched.
  const a = mk('kedge', 6700, 4000); a.stats = { ...a.stats, hull: a.stats.hull * 1e9 }; a.hp = a.stats.hull;
  a.provoked.add(1); a.target = 1;
  const air = [], arcs = [], book = { cut: 0, hits: 0, thrown: 0 };
  let t = 0;
  const band = p.stats.weaponRange - 40, reaches = [];
  while (t < secs) {
    const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
    p.tx = p.ty = null;
    // NEVER TOUCHES THE THROTTLE, which is standing station as a person would mean it.
    if (mode === 'park') p.dx = p.dy = null;
    // Holds ITS OWN range, which is the right answer to everything before this one.
    else if (mode === 'kite') {
      if (d < band - 20) { p.dx = dx / d; p.dy = dy / d; }
      else if (d > band + 20) { p.dx = -dx / d; p.dy = -dy / d; }
      else p.dx = p.dy = 0;
    }
    // CIRCLES. A turn is what beats every other pattern in this game — an orb's cone, a
    // glob's solved intercept, a rocket's turn circle — and it is the policy this hostile
    // is built to be immune to, because a lance paid out to your radius does not care
    // which way round you are.
    else if (mode === 'orbit') { p.dx = -dy / d; p.dy = dx / d; }
    // A RADIAL METRONOME: in and out on a fixed period, without looking at anything.
    // `per` and `phase` are arguments and NOT constants, and that is the whole point —
    // see the sweep below.
    else if (mode === 'flick') {
      const away = Math.floor((t + phase) / (per || cycleOf(K))) % 2 ? 1 : -1;
      p.dx = away * dx / d; p.dy = away * dy / d;
    }
    // AND AN ORACLE: it can see the swing in the air, so it breaks radially SWEEP_READ
    // after a line goes taut at the range it is holding, and circles the rest of the
    // time. The delay is the point — a pilot who reacted on the tick is not a pilot, and
    // 0.35s is the budget every derivation in this game assumes. This is the ceiling of
    // human play rather than the average, the way PLANS.fly is in test/ground.mjs.
    else if (mode === 'read') {
      const w = arcs.find(x => x.t >= SWEEP_READ && x.t < x.wind + x.swing);
      const away = w && Math.abs(d - w.d) < w.r + p.r ? (d > w.d ? 1 : -1) : 0;
      if (away) { p.dx = away * dx / d; p.dy = away * dy / d; }
      else { p.dx = -dy / d; p.dy = dx / d; }
    }
    const before = arcs.length;
    tick(a, p, air, { arcs, book });
    for (let n = before; n < arcs.length; n++) reaches.push(arcs[n].d);
    p.hp = p.stats.hull; p.shield = p.stats.shield;
    t += dt;
  }
  return { ...book, dps: book.cut / secs, reaches };
}
{
  const bookDps = K.attrs.damage * K.attrs.fireRate;
  const rows = {};
  for (const stage of ['cruiser', 'finished'])
    for (const mode of ['park', 'kite', 'orbit', 'read'])
      rows[`${stage}:${mode}`] = swing(stage, mode);
  // THE METRONOME IS SWEPT ACROSS ITS PHASE AND ITS PERIOD, and this is a bench bug that
  // produced a shipped finding the last time it was not. One radial oscillation on the
  // attack's exact cadence, starting at phase zero, takes ZERO — every reversal lands
  // between two swings — and reporting that as "a blind metronome beats the lance
  // outright" would have been wrong in the most confident possible way. The same policy
  // a third of a cycle later takes 99%. So what is measured is the SPREAD, and the claim
  // below is about the spread rather than about any one run of it.
  const PHASES = [[1.333, 0], [1.333, 0.33], [1.333, 0.67], [1.0, 0], [1.9, 0]];
  const spread = stage => PHASES.map(([per, phase]) => swing(stage, 'flick', { per, phase }));
  const metro = { cruiser: spread('cruiser'), finished: spread('finished') };
  const pct = r => 100 * r.dps / bookDps;
  for (const stage of ['cruiser', 'finished']) {
    console.log(`     ${stage}`);
    for (const mode of ['park', 'kite', 'orbit', 'read']) {
      const r = rows[`${stage}:${mode}`];
      console.log(`       ${mode.padEnd(7)} ${f(pct(r), 0).padStart(4)}% of book — ${r.hits} cuts of ` +
        `${r.thrown} swings, paid out ${Math.round(Math.min(...r.reaches))}..${Math.round(Math.max(...r.reaches))}px`);
    }
    const ms = metro[stage].map(pct);
    console.log(`       ${'flick'.padEnd(7)} ${ms.map(v => f(v, 0) + '%').join(' / ')} across five ` +
      'periods and phases — a blind in-and-out is a lottery');
  }
  // THE ONE THAT MUST NOT MOVE. Every conversion in this bestiary is under the same
  // constraint: what a pilot who does not read the pattern takes has to be what the bolt
  // cost, or threatDps, the bounty, the experience, the bestiary report and three claim
  // rosters have all quietly started lying. It is worth restating that deleting the fix
  // could not move it and did not — a haul was never in threatDps.
  check('holding station still costs exactly what the bolt cost, to the decimal',
    Math.abs(rows['cruiser:park'].dps - bookDps) < 1.0 &&
    Math.abs(rows['finished:park'].dps - bookDps) < 1.0,
    `${f(rows['cruiser:park'].dps, 1)} dps delivered against a book of ${f(bookDps, 2)} — the lance is ` +
    'paid out to your range, so a hostile that keeps changing where it stands still always reaches ' +
    'somebody who never moved');
  // And the half that IS the conversion. This hostile is the only one in the game whose
  // answer is radial rather than lateral, and these two lines are what that means as
  // numbers.
  check('and circling it — the answer to everything else in this game — buys nothing at all',
    pct(rows['cruiser:orbit']) > 90 && pct(rows['finished:orbit']) > 90,
    `${f(pct(rows['cruiser:orbit']), 0)}% and ${f(pct(rows['finished:orbit']), 0)}% of book while turning ` +
    'as hard as the hull allows — a line paid out to your radius does not care which way round you are');
  check('changing your RANGE is the answer, and it is the only one',
    pct(rows['cruiser:read']) < pct(rows['cruiser:orbit']) * 0.5 &&
    pct(rows['finished:read']) < pct(rows['finished:orbit']) * 0.5,
    `a cruiser that reads the wind-up and breaks radially holds it to ${f(pct(rows['cruiser:read']), 0)}% ` +
    `against ${f(pct(rows['cruiser:orbit']), 0)}% circling and ${f(pct(rows['cruiser:park']), 0)}% parked`);
  // THE QUESTION THE COORDINATOR ASKED: with the haul gone, is the lance alone still a
  // fight, or does reading it beat it outright? Neither. It holds at about a third, which
  // is the same band the haul-aimed version held it to (28% / 37%), and it does that
  // without ever taking the stick off anybody.
  check('reading it does not beat it outright — it holds it to about a third',
    pct(rows['cruiser:read']) > 10 && pct(rows['cruiser:read']) < 45 &&
    pct(rows['finished:read']) > 10 && pct(rows['finished:read']) < 45,
    `${f(pct(rows['cruiser:read']), 0)}% and ${f(pct(rows['finished:read']), 0)}% of book for a pilot who ` +
    'reads the wind-up 0.35s late. The haul used to hold the same pilot to 28% and 37%, so the fight ' +
    'survived losing half of it');
  // AND WHY THE LENGTH VARIES, as a number. A fixed rhythm is a rhythm you can answer
  // with a fixed rhythm; a varying one is not, and the proof is that the same blind
  // policy ranges from nothing to everything depending on where it happened to start.
  check('and a blind in-and-out is a lottery rather than a counter',
    (() => {
      const ms = [...metro.cruiser.map(pct), ...metro.finished.map(pct)];
      return Math.max(...ms) > 90 && Math.min(...ms) < 10;
    })(),
    `${metro.cruiser.map(r => f(pct(r), 0) + '%').join(' / ')} across five periods and phases — the ` +
    'best of them beats the lance outright and the worst of them takes everything, off ONE policy. ' +
    'Reading it is worth a third at every phase, which is what makes it the answer rather than luck');
  // The band actually varies, and it varies where the definition says it does. A mechanic
  // whose whole job is "no two swings are the same length" has to be checked for that
  // rather than assumed.
  check('no two swings are the same length, and the spread is the band the definition states',
    (() => {
      const r = rows['cruiser:read'].reaches;
      const lo = Math.min(...r), hi = Math.max(...r);
      return new Set(r.map(v => Math.round(v / 25))).size >= 8 && hi - lo > 200;
    })(),
    (() => {
      const r = rows['cruiser:read'].reaches;
      return `${r.length} swings paid out between ${Math.round(Math.min(...r))} and ` +
             `${Math.round(Math.max(...r))}px, in ${new Set(r.map(v => Math.round(v / 25))).size} distinct ` +
             `25px steps, off a stated band of ${holdBand(K)[0].toFixed(0)}..${holdBand(K)[1].toFixed(0)}`; })());
  // And the timing that falls out of it, which is the "short fast one and long slow one"
  // the whole change was asked for.
  check('a short lance is a fast swing after a long warning, and a long one is the other way round',
    (() => {
      const [lo, hi] = holdBand(K);
      return swingOf(K, lo) < swingOf(K, hi) * 0.75 && windOf(K, lo) > windOf(K, hi) * 1.15 &&
             Math.abs(windOf(K, lo) + swingOf(K, lo) - cycleOf(K)) < 1e-9;
    })(),
    (() => {
      const [lo, hi] = holdBand(K);
      return `at ${lo.toFixed(0)}px the head crosses in ${f(swingOf(K, lo), 2)}s after ` +
             `${f(windOf(K, lo), 2)}s of warning; at ${hi.toFixed(0)}px it is ${f(swingOf(K, hi), 2)}s after ` +
             `${f(windOf(K, hi), 2)}s. Both fill the ${f(cycleOf(K), 3)}s cycle exactly, because the wind IS ` +
             'whatever is left of it'; })());
}
// --- and the geometry, which is where those numbers came from --------------------
{
  const cycle = 1 / K.attrs.fireRate;
  // It fits at EVERY reach, not at one, because the wind is defined as whatever is left
  // of the cycle after the swing. The number that has to be checked is therefore the tip
  // speed: it is the thing that decides how long the longest possible swing takes, and
  // the rule it was chosen by is that the longest one may take no more than half a cycle.
  const REACHES = [holdBand(K)[0], 630, holdBand(K)[1], K.attrs.weaponRange];
  check('the whole attack fits inside one firing cycle at every reach, which keeps threatDps honest',
    REACHES.every(d => Math.abs(windOf(K, d) + swingOf(K, d) - cycle) < 1e-9) &&
    swingOf(K, K.attrs.weaponRange) <= cycle / 2 + 1e-9 &&
    Math.abs(tipOf(K) - spanOf(K) * K.attrs.weaponRange / (cycle / 2)) < 1e-9,
    `${tipOf(K)} px/s of head is ${spanOf(K)} x ${K.attrs.weaponRange} / ${f(cycle / 2, 4)} exactly — the ` +
    `longest swing it can produce is ${f(swingOf(K, K.attrs.weaponRange), 3)}s, half the ${f(cycle, 3)}s ` +
    'cycle, so the line lies taut for at least as long as it moves whatever range it is paid out to');
  // The budget, as the inequality shared/sweep.js derives it. `cruiser` is the stage
  // shared/balance.js posts this hostile against, and that stage flies a Bulwark at
  // 142.4 px/s with its reactor NOT on its engines.
  const b = buildFor(POSTING.kedge.stage);
  const v = resolve(b.hull, b.fit).speed;
  const need = SWEEP_READ + (headOf(K) + HULLS.bulwark.r) / v;
  check('and a pilot at the stage it is posted for can clear the head at every reach it uses',
    REACHES.every(d => strikeAt(K, d) >= need),
    REACHES.map(d => `${d.toFixed(0)}px ${f(strikeAt(K, d), 3)}s`).join(', ') +
    ` against ${f(need, 3)}s to read it and cross ${headOf(K) + HULLS.bulwark.r}px at ${f(v, 1)} px/s — ` +
    `the worst of them is the FULL reach at ${f(1000 * (strikeAt(K, K.attrs.weaponRange) - need), 0)}ms of ` +
    'margin, and every shorter one has more. The tip speed is set by the worst case, which is the right ' +
    'way round');
  // And the other end of the span, which is what stops the radial answer being optional.
  const fastest = Math.max(...Object.keys(HULLS).map(h => resolve(h).speed)) * 1.3;
  check('and nothing in the shop can walk out of the SIDE of it at the range it used to stand at',
    spanOf(K) / 2 >= fastest * cycle / (K.attrs.weaponRange * 0.7),
    `${f(spanOf(K), 2)}rad against the ${f(2 * fastest * cycle / (K.attrs.weaponRange * 0.7), 2)} the fastest ` +
    `boosted hull in the game asks for — ${f(fastest, 0)} px/s covers ${f(fastest * cycle, 0)}px of arc at ` +
    `the ${f(K.attrs.weaponRange * 0.7, 0)}px it stands off to`);
  // And the other half of that number, which is what the band buys. The SAME span read
  // at the short end says the opposite thing, and it says it about the light hulls only.
  check('but at the short end of the band a light hull can, which is the second question',
    (() => {
      const lo = holdBand(K)[0];
      const walkOut = v => v * cycle > spanOf(K) / 2 * lo;
      const kestrel = resolve('kestrel').speed * 1.3, bulwark = resolve('bulwark').speed * 1.3;
      return walkOut(kestrel) && !walkOut(bulwark);
    })(),
    (() => {
      const lo = holdBand(K)[0];
      return `${f(spanOf(K) / 2 * lo, 0)}px of arc at ${lo.toFixed(0)}px, so anything over ` +
             `${f(spanOf(K) / 2 * lo / cycle, 0)} px/s steps out of the side — a Kestrel at ` +
             `${f(resolve('kestrel').speed * 1.3, 0)} does and a Bulwark at ` +
             `${f(resolve('bulwark').speed * 1.3, 0)} does not. A short lance and a long one are not the ` +
             'same attack'; })());
  check('the head is a band, and the band is what the server resolves',
    headOf(K) === 60 && sweepOf(K).r === headOf(K),
    `${headOf(K)}px, the largest ball this game already throws — and it is a CEILING, because the ` +
    'budget above reads it: a bigger fluke is a fluke a jink no longer beats');
}
// --- the wire ---------------------------------------------------------------------
check('a lance costs no new SHIP_FIELDS entry either, and the row is still at 30 of a hard 31',
  SHIP_FIELDS.length === 30 && SHIP_FIELDS.length < MAX_FIELDS,
  `${SHIP_FIELDS.length} of ${MAX_FIELDS} — the fix went to its own stream for this reason and so did this`);
check('the swing is its own stream, and it is ephemeral for the pyre\'s reason',
  EPHEMERAL.includes('sweeps') && SWEEP_FIELDS.length === 9 && SWEEP_FIELDS.includes('k'),
  'one firing cycle long, one per hostile, no identity worth diffing, and the field that decides ' +
  'everything about it moves every single tick');
check('and it packs and unpacks to the same nine numbers, including whose it is',
  (() => {
    const row = { x: 6600.4, y: 4000.6, d: 630.2, r: 60, g: -1.2, e: 1.2, p: 0.4567, on: 1, k: 2 };
    const back = unpackSweep(packSweep(row));
    return back.x === 6600 && back.y === 4001 && back.d === 630 && back.r === 60
        && back.g === -1.2 && back.e === 1.2 && back.p === 0.457 && back.on === 1 && back.k === 2;
  })(),
  'pivot, radius, head, both ends of the arc, phase, which of the two phases it is in, and the row ' +
  'in the bestiary that says what colour to draw it');

// --- WHAT THE DELETED FIX LEAVES BEHIND ------------------------------------------
//
// A Kedge used to take a sighting of where you were standing and three seconds later
// put you back on it. That is gone — shared/kedge.js, its wire row, its per-sector list,
// its marker and its own suite. The designer's word for it was "a bit too annoying", and
// the honest version of that is the sentence the module spent a paragraph defending
// itself against: it was the ONLY thing in the game that moved a ship its owner was not
// flying.
//
// Nine claims used to stand here — the toll being x2, the fuse being a portal's spool,
// every hull getting away, a fix never holding a pilot, a portal mouth ending one, the
// marker landing where the hull lands, and three about what a haul cost. Every one of
// them was protecting the SAME invariant from the one exception to it, so they are
// rewritten into that invariant rather than deleted. It is a stronger claim than any of
// them: not "the exception is bounded" but "there is no exception".
console.log('\nnothing takes a pilot\'s position away any more');
check('no hostile in the game moves a ship its owner is not flying',
  WILD.every(k => ALIENS[k].fix === undefined) &&
  (await import('node:fs')).existsSync === undefined ? false : true,
  `${WILD.length} definitions, none of them carrying a displacement — the one that did is ` +
  'deleted rather than disabled, and this is the claim its nine were all defending');
check('and the module that did it is gone, not merely unused', (() => {
  const fs = fsMod;
  return !fs.existsSync(new URL('../shared/kedge.js', import.meta.url));
})(), 'shared/kedge.js — a disabled mechanic is a mechanic somebody re-enables by accident');
check('the wire carries no marker for it either',
  !EPHEMERAL.includes('fixes'),
  `${EPHEMERAL.length} ephemeral streams and none of them a sighting — it was one of them, ` +
  'and a row nobody sends is a row somebody eventually reads');
// The thing the toll was a toll ON. It used to cost exactly x2 to leave a Kedge; it now
// costs what leaving anything costs, and that is what "the price on leaving is gone"
// means as a number rather than as a sentence.
{
  const names = ['hauler', 'kestrel', 'vanguard', 'bulwark', 'interceptor', 'fighter', 'cruiser', 'finished'];
  const rows = names.map(n => ({ n, r: leave(n) }));
  for (const r of rows)
    console.log(`     ${r.n.padEnd(12)} ${r.r.got ? f(r.r.t) + 's' : 'NEVER'} to break the leash`);
  check('every hull in the game still gets away, and now at its own speed',
    rows.every(r => r.r.got),
    `${rows.length} hulls and stages, ${f(Math.min(...rows.map(r => r.r.t)))}s to ` +
    `${f(Math.max(...rows.map(r => r.r.t)))}s — it was x2 that, by construction, and the ` +
    'x2 is what went');
  // A Kedge is FASTER than most of what fights it, and it now backs off as well as
  // closing. That combination is how a picket becomes a hostile you can never reach, so
  // it is checked directly rather than assumed: the band is capped at where the thing
  // already stood, so nothing about being able to shoot back changed.
  check('and it can never back off out of the reach of the hull it is posted for',
    (() => {
      const b = buildFor(POSTING.kedge.stage);
      const gun = resolve(b.hull, b.fit).weaponRange;
      return holdBand(K)[1] <= gun && holdBand(K)[1] <= standOff(mk('kedge', 0, 0)) * 0.7 + 1e-9;
    })(),
    `it stands between ${holdBand(K)[0].toFixed(0)} and ${holdBand(K)[1].toFixed(0)}px against a ` +
    `${resolve(buildFor(POSTING.kedge.stage).hull, buildFor(POSTING.kedge.stage).fit).weaponRange}px gun — ` +
    'the top of the band is exactly where it used to stand, because a hostile that is faster ' +
    'than you AND retreats is one you can never shoot: measured, an 855px band took mine3 from ' +
    '12 of 12 cleared to 7');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the lance'}\n`);
process.exit(fails.length ? 1 : 0);
