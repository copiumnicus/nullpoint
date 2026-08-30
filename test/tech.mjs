// Claims about the technology shelf.
//
// The shelf is where a ship stops being "how much" and starts being "what kind",
// so almost every claim here is a CROSSOVER: two technologies that answer the same
// question differently, and the number where the answer changes. A technology
// nothing ever beats is not a choice, it is a tax on the slot.
//
// The damage section is the one that needed a rule before it could exist at all.
// gear.js states it: a technology may multiply damage UP only against another term
// of a dps product, because those are the only costs that grow x68 alongside it.
// These assertions are that rule, measured.

import { ATTRS, resolve, slotsOf, FIRE_RATE } from '../shared/ships.js';
import { EQUIPMENT, MAX_DRONES, topTier } from '../shared/gear.js';
import { FORMATIONS, FORMATION_KEYS, BONUS_AT, bonusScale, escortScale } from '../shared/formation.js';
import { newShip, speedOf, rangeOf, veilOf } from '../shared/sim.js';
import { fire, stepBolts } from '../shared/combat.js';
import { SPECIAL, lockOf, swellOf, VEIL_DEPTH, VEIL_RECOVER,
         ANCHOR_SWELL, ANCHOR_DRAG, LOCK_TIGHTEN, LOCK_REACH } from '../shared/ability.js';
import { ROCKET_RATE } from '../shared/rockets.js';
import { AMMO, roundPrice } from '../shared/ammo.js';
import { priceFor, techRung, TECH_POINTS, DELIVERY_PREMIUM, ANCHORS, premiumAt,
         buildFor, dpsOf } from '../shared/balance.js';
import { BOUNTY_RATE } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const f = (v, d = 2) => Number(v).toFixed(d);
const fit = o => ({ weapon: [], generator: [], tech: [], ...o });
const TECHS = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'tech');
const dt = 1 / 30;

// A build, and the same build with one technology bolted on. Everything below is
// a comparison between these two, which is the only honest way to read a
// multiplier: against the ship that would have flown without it.
const B = {
  starter:  { hull: 'hauler',  weapon: ['emitter1'], drones: [] },
  midgame:  { hull: 'kestrel', weapon: ['emitter3', 'emitter3'], drones: Array(4).fill('emitter3') },
  finished: { hull: 'bulwark', weapon: Array(4).fill('emitter5'), drones: Array(12).fill('emitter5') },
  rocketeer:{ hull: 'bulwark', weapon: ['pod3', 'pod3', 'pod3', 'emitter5'], drones: [] },
  pod:      { hull: 'hauler',  weapon: ['pod1'], drones: [] },
};
const statsOf = (b, tech, form = 'line') =>
  resolve(b.hull, fit({ weapon: b.weapon, tech: tech ? [tech] : [] }), b.drones, form);
const dpsOfStats = s => s.damage * s.fireRate + s.rocketVolley * ROCKET_RATE;

// ---------------------------------------------------------------- the shelf
console.log('\nthe shelf');
check('the technology shelf covers every system a ship has', (() => {
  const touched = new Set(TECHS.flatMap(k => EQUIPMENT[k].mods.map(([a]) => a)));
  const systems = {
    'hull and hold':  ['hull', 'cargo'],
    'the reactor':    ['capacitor', 'recharge', 'sustain'],
    'the shield clock': ['shieldRegen', 'shieldDelay'],
    'reach and legs': ['speed', 'accel', 'weaponRange'],
    'what sees you':  ['radar', 'signature'],
    'damage output':  ['damage', 'fireRate', 'rocketVolley'],
    'the escort':     ['cohesion', 'escort'],
    'the ability':    ['veilDepth', 'veilRecover', 'anchorSwell', 'anchorDrag', 'lockTighten', 'lockReach'],
  };
  return Object.values(systems).every(as => as.some(a => touched.has(a)));
})(), `${TECHS.length} technologies across eight systems — damage output, the escort and the ` +
      'hull ability were the three with nothing on the shelf at all');
check('every one of them still gives something up',
  TECHS.every(k => EQUIPMENT[k].mods.some(([a, , v]) => (ATTRS[a].better === 'high') !== (v > 0))),
  'the same rule the original four obeyed, now across all ' + TECHS.length);
check('and every one is a multiplier, never a flat add',
  TECHS.every(k => EQUIPMENT[k].mods.every(([, op]) => op === 'mul')),
  'racks fill a hull out, technology changes its shape');

// The price of anything the model cannot read is the shelf's own rung, and the
// rung is read back off the shelf rather than picked. See balance.js TECH_POINTS.
{
  const dark = TECHS.filter(k => priceFor(EQUIPMENT[k].mods, EQUIPMENT[k].tier ?? 1).points <= 0);
  const off = dark.filter(k => k !== 'reloads')
    .filter(k => Math.abs(EQUIPMENT[k].price / techRung(EQUIPMENT[k].tier ?? 1) - 1) > 0.01);
  check('a technology the model cannot price sits on the shelf\'s own rung', off.length === 0,
    off.join(' ') || `${dark.length} of them at ${f(TECH_POINTS, 0)} points — ` +
    [1, 2, 3].map(t => `${Math.round(techRung(t))}`).join(' / ') + ' cr by tier');
  check('and the one that charges more says what the premium buys',
    Math.abs(EQUIPMENT.reloads.price / (techRung(3) * DELIVERY_PREMIUM) - 1) < 0.02,
    `Racked Reloads is ${EQUIPMENT.reloads.price} against a rung of ${Math.round(techRung(3))} — ` +
    `x${f(EQUIPMENT.reloads.price / techRung(3))}, which is DELIVERY_PREMIUM and nothing else`);
}

// ------------------------------------------------- damage: pay for the product
console.log('\ndamage output, paid for out of the same product');
// The rule the shelf could not have a damage technology without. A naked damage
// multiplier's benefit grows with the rack; its price does not.
check('a naked damage multiplier is worth 135x more at the top than at the bottom', (() => {
  const at = st => priceFor([['damage', 'mul', 0.22]], 2,
    { base: resolve(buildFor(st).hull, buildFor(st).fit, buildFor(st).drones) }).price;
  return at('finished') / at('anchor') > 100;
})(), `${Math.round(priceFor([['damage', 'mul', 0.22]], 2, { base: resolve('hauler', fit({ weapon: ['emitter1'] })) }).price)} cr ` +
      'against a new pilot — which is why every damage technology on this shelf pays for itself in damage');

check('the two cadences change when your damage arrives and never how much of it there is', (() => {
  for (const key of ['starter', 'midgame', 'finished', 'rocketeer']) {
    const base = dpsOfStats(statsOf(B[key]));
    for (const t of ['siege', 'rapid'])
      if (Math.abs(dpsOfStats(statsOf(B[key], t)) / base - 1) > 1e-9) return false;
  }
  return true;
})(), 'x1.60 damage against x0.625 rate is 1.0000: ' +
      ['starter', 'finished'].map(k => `${k} ${f(dpsOfStats(statsOf(B[k])), 1)} dps unchanged`).join(', '));

check('and the cost model agrees, now that it scores rate and damage as one product',
  priceFor(EQUIPMENT.siege.mods, 3).points === 0 && priceFor(EQUIPMENT.rapid.mods, 2).points === 0,
  'read apart, x1.60 damage and x0.625 rate add up to +22.5% and the off-model report ' +
  'put Siege Cadence at 7.4x over model — which was the model\'s mistake, not the shelf\'s');

// What actually moves. Measured with the real fire()/stepBolts() loop against a
// target that stands still, so the only variable is the cadence.
const window = (b, tech, secs) => {
  const a = newShip(0, 0, b.hull, fit({ weapon: b.weapon, tech: tech ? [tech] : [] }), b.drones);
  a.power.to = null; a.heading = 0;                       // the gun, not the reactor
  const tgt = newShip(a.stats.weaponRange * 0.6, 0, 'hauler', fit(), []);
  tgt.stats = { ...tgt.stats, hull: 1e12, shield: 0 }; tgt.hp = 1e12; tgt.shield = 0;
  const bolts = []; let t = 0, dealt = 0;
  while (t < secs + 1e-9) {
    for (const s of fire(a, tgt, dt)) bolts.push(s);
    for (const h of stepBolts(bolts, dt)) dealt += h.split.shield + h.split.hull;
    t += dt;
  }
  return dealt;
};
// Averaged across window lengths, because a single length is measuring one bolt's
// rounding as much as the cadence: at 1.0s exactly, a six-gun Kestrel reads 698 /
// 745 / 582 and at 1.1s it reads 698 / 894 / 728. The mean over half a second to a
// second and a half is the cadence and nothing else.
const shortWindow = (b, tech) => {
  let sum = 0, n = 0;
  for (let w = 0.5; w <= 1.5 + 1e-9; w += 0.1) { sum += window(b, tech, w); n++; }
  return sum / n;
};
{
  const rows = ['starter', 'midgame', 'finished'].map(k =>
    ({ k, v: [null, 'siege', 'rapid'].map(t => shortWindow(B[k], t)) }));
  check('Siege Cadence front-loads a short window and Rapid Cadence spends one thinner',
    rows.every(r => r.v[1] > r.v[0] && r.v[0] > r.v[2]),
    rows.map(r => `${r.k} +${f(100 * (r.v[1] / r.v[0] - 1), 0)}%/${f(100 * (r.v[2] / r.v[0] - 1), 0)}%`).join('  ') +
    ' inside half a second to a second and a half');
  const thirty = [null, 'siege', 'rapid'].map(t => window(B.midgame, t, 30));
  check('and over a long fight the three are the same gun',
    thirty.every(v => Math.abs(v / thirty[0] - 1) < 0.05),
    `thirty seconds on a Kestrel: ${thirty.map(v => Math.round(v)).join(' / ')} — inside ` +
    `${f(100 * Math.max(...thirty.map(v => Math.abs(v / thirty[0] - 1))), 1)}%`);
}
check('the cadences are not an ammunition trade, whatever it looks like', (() => {
  // Siege fires 37.5% fewer rounds. Measured against what the same seconds pay in
  // bounty, at every stage, that saving never reaches 2% of earnings — so nobody
  // should ever balance one of these on the ammunition bill again.
  let worst = 0;
  for (const st of ['anchor', 'interceptor', 'fighter', 'cruiser', 'finished']) {
    const b = buildFor(st), s = resolve(b.hull, b.fit, b.drones);
    const guns = Math.max(1, (b.fit.weapon ?? []).filter(k => EQUIPMENT[k]?.kind === 'laser').length +
                             (b.drones ?? []).filter(k => EQUIPMENT[k]?.kind === 'laser').length);
    worst = Math.max(worst, (guns * s.fireRate * roundPrice('cell3')) / (dpsOf(b) * BOUNTY_RATE));
  }
  return worst < 0.02;
})(), 'the whole ammunition bill on the dearest grade is between 1.0% and 0.1% of what the same ' +
      'seconds earn — a 37.5% saving on it is not a balance lever');

check('Launcher Primacy pays a rocket boat at both ends of the ladder, and taxes everyone else', (() => {
  const gain = (b) => dpsOfStats(statsOf(b, 'primacy')) / dpsOfStats(statsOf(b)) - 1;
  return gain(B.pod) > 0.20 && gain(B.rocketeer) > 0.30      // committed, bottom and top
      && gain(B.starter) < -0.29 && gain(B.finished) < -0.29 // no rack at all: it is just a tax
      && gain({ ...B.rocketeer, drones: Array(12).fill('emitter5') }) < 0;
})(), `+${f(100 * (dpsOfStats(statsOf(B.pod, 'primacy')) / dpsOfStats(statsOf(B.pod)) - 1), 0)}% on a Hauler with one Sparrow Pod, ` +
      `+${f(100 * (dpsOfStats(statsOf(B.rocketeer, 'primacy')) / dpsOfStats(statsOf(B.rocketeer)) - 1), 0)}% on a Bulwark with three Swarm Racks, ` +
      `${f(100 * (dpsOfStats(statsOf({ ...B.rocketeer, drones: Array(12).fill('emitter5') }, 'primacy')) / dpsOfStats(statsOf({ ...B.rocketeer, drones: Array(12).fill('emitter5') })) - 1), 0)}% ` +
      'once twelve drones are carrying emitters, and -30% for anyone with no rack');
check('so the trade a new pilot is offered and the trade a finished ship is offered are the same trade', (() => {
  // The failure the rule exists to prevent is a gain that scales x68 against a cost
  // that does not. Here both sides are dps, so the RATIO holds across the ladder.
  const a = dpsOfStats(statsOf(B.pod, 'primacy')) / dpsOfStats(statsOf(B.pod));
  const b = dpsOfStats(statsOf(B.rocketeer, 'primacy')) / dpsOfStats(statsOf(B.rocketeer));
  return Math.abs(a - b) < 0.15 && a > 1 && b > 1;
})(), `x${f(dpsOfStats(statsOf(B.pod, 'primacy')) / dpsOfStats(statsOf(B.pod)))} at the bottom against ` +
      `x${f(dpsOfStats(statsOf(B.rocketeer, 'primacy')) / dpsOfStats(statsOf(B.rocketeer)))} at the top`);

// ---------------------------------------------------------------- the escort
console.log('\nthe escort, and the ramp it flies on');
check('a ship with nothing fitted flies exactly the escort it always did',
  [0, 1, 2, 3, 6, 12].every(n => Math.abs(escortScale(n, resolve('bulwark')) - bonusScale(n)) < 1e-9),
  `full at ${BONUS_AT} drones, at x1, which is what BONUS_AT has always meant`);
{
  const at = (n, t) => escortScale(n, resolve('bulwark', fit({ tech: t ? [t] : [] }), Array(n).fill(null), 'wedge'));
  check('Wing Repeaters is everything at one drone and nothing at three',
    at(1, 'repeaters') === 1 && at(2, 'repeaters') === 1 && at(3, 'repeaters') === at(3, null),
    `one drone flies at ${f(at(1, 'repeaters'))} of the formation against ${f(at(1, null))} without it, ` +
    'and by three the ramp is finished either way — the first technology on the shelf worth LESS as you grow');
  check('Wing Coupling is the other end: worse until four drones, half again at six',
    at(3, 'coupling') < at(3, null) && at(4, 'coupling') > at(4, null) && Math.abs(at(6, 'coupling') - 1.7) < 1e-9,
    [1, 3, 4, 6, 12].map(n => `${n}: ${f(at(n, 'coupling'))}`).join('  ') + ' against a flat 1.00');
  check('so the two cross at four drones, which is the whole decision',
    at(3, 'repeaters') >= at(3, 'coupling') && at(4, 'coupling') > at(4, 'repeaters'),
    'under four bays Repeaters, over four Coupling, and at exactly three neither beats flying nothing');
}
check('and Wing Coupling can never sell you damage, whichever formation is flying it', (() => {
  for (const k of FORMATION_KEYS) {
    const a = statsOf(B.finished, null, k), b = statsOf(B.finished, 'coupling', k);
    if (b.damage * b.fireRate > a.damage * a.fireRate + 1e-9) return false;
  }
  return true;
})(), 'the Attack Wedge multiplies DAMAGE, so an escort dial is a damage dial in disguise: ' +
      FORMATION_KEYS.map(k => { const a = statsOf(B.finished, null, k), b = statsOf(B.finished, 'coupling', k);
        return `${k} x${f(b.damage * b.fireRate / (a.damage * a.fireRate), 3)}`; }).join(' '));

// ------------------------------------------------------- the fourth system
console.log('\nthe fourth system is fittable now');
const drive = (s, l) => { s.power.to = SPECIAL; s.power.special = l; return s; };
const flown = (h, t) => newShip(0, 0, h, fit({ tech: t ? [t] : [] }), []);
check('every dial of every ability is a row in ATTRS, with the shipped setting as its default',
  ATTRS.veilDepth.dflt === VEIL_DEPTH && ATTRS.veilRecover.dflt === VEIL_RECOVER &&
  ATTRS.anchorSwell.dflt === ANCHOR_SWELL && ATTRS.anchorDrag.dflt === ANCHOR_DRAG &&
  ATTRS.lockTighten.dflt === LOCK_TIGHTEN && ATTRS.lockReach.dflt === LOCK_REACH,
  'ships.js imports them from ability.js rather than restating them, so the two cannot drift');
check('and every one of them has a ceiling, because some of these want one',
  [ATTRS.veilDepth, ATTRS.anchorSwell, ATTRS.anchorDrag, ATTRS.lockTighten, ATTRS.lockReach]
    .every(a => Number.isFinite(a.max)),
  `a veil stops at x${f(1 - ATTRS.veilDepth.max)} detection and an anchor keeps ` +
  `${Math.round((1 - ATTRS.anchorDrag.max) * 100)}% of its speed — ability.js argues both`);
check('a technology cannot push a dial past its ceiling',
  resolve('kestrel', fit({ tech: ['deepen'] })).veilDepth === ATTRS.veilDepth.max &&
  resolve('bulwark', fit({ tech: ['deepset'] })).anchorDrag === ATTRS.anchorDrag.max &&
  resolve('kestrel', fit({ tech: ['repeaters'] })).cohesion === ATTRS.cohesion.min,
  'Null Skin asks for 0.9416 and gets 0.94; Wing Repeaters asks for 0.99 drones and gets 1');

{
  const veil = (t, since) => { const k = drive(flown('kestrel', t), 1); k.sinceShot = since; return veilOf(k); };
  check('a Null Skin halves the range a Kestrel is found at',
    Math.abs(veil('deepen', 1e9) - 0.06) < 1e-9,
    `detection x${f(veil(null, 1e9))} becomes x${f(veil('deepen', 1e9))} — not zero, ever`);
  // Mean detection over a firing period T is 1 - depth x (1 - rebuild/2T) once you
  // shoot less often than the rebuild takes. Two lines, one crossing.
  const mean = (depth, rec, T) => 1 - depth * (T < rec ? T / (2 * rec) : 1 - rec / (2 * T));
  const gov = resolve('kestrel', fit({ tech: ['quicken'] })), skin = resolve('kestrel', fit({ tech: ['deepen'] }));
  const cross = (skin.veilDepth * skin.veilRecover / 2 - gov.veilDepth * gov.veilRecover / 2)
              / (skin.veilDepth - gov.veilDepth);
  check('and the Fade Governor beats it only while you are actually shooting',
    mean(gov.veilDepth, gov.veilRecover, 1) < mean(skin.veilDepth, skin.veilRecover, 1) &&
    mean(gov.veilDepth, gov.veilRecover, 5) > mean(skin.veilDepth, skin.veilRecover, 5) &&
    cross > 2.5 && cross < 2.9,
    `they cross at one shot every ${f(cross)}s — faster than that the Governor hides you better, ` +
    `slower and the Skin does, and holding fire the Skin is x${f(1 - skin.veilDepth)} against x${f(1 - gov.veilDepth)}`);
}
{
  const anchor = t => { const b = drive(flown('bulwark', t), 1);
    return { swell: swellOf({ ability: 'anchor' }, b.power, b.stats), speed: speedOf(b) / b.stats.speed }; };
  const s = anchor(null), w = anchor('walk'), d = anchor('deepset');
  check('Anchor Servos buy a wall that can walk, and Keel Bracing buys one that cannot',
    w.speed > s.speed && w.swell < s.swell && d.swell > s.swell && d.speed < s.speed,
    `stock x${f(s.swell, 1)} shield at ${Math.round(s.speed * 100)}% speed, ` +
    `Servos x${f(w.swell, 1)} at ${Math.round(w.speed * 100)}%, Bracing x${f(d.swell, 1)} at ${Math.round(d.speed * 100)}%`);
  check('and neither of them lets a Bulwark stop dead',
    w.speed > 0 && d.speed > 0, 'a ship at zero is repositioned only by whatever is shooting it');
}
{
  const v = t => flown('vanguard', t);
  const at = (s, lvl) => { drive(s, lvl); return { lock: lockOf({ ability: 'lock' }, s.power, s.stats), range: rangeOf(s) }; };
  const stockFull = at(v(null), 1), standFull = at(v('standoff'), 1);
  check('a Lock Repeater holds a full lock from further out, and is a worse ship cold',
    standFull.lock === 1 && standFull.range > stockFull.range &&
    rangeOf(v('standoff')) < rangeOf(v(null)),
    `${Math.round(stockFull.range)}px locked becomes ${Math.round(standFull.range)}px, ` +
    `while the unlocked reach drops from ${Math.round(rangeOf(v(null)))} to ${Math.round(rangeOf(v('standoff')))}`);
  const half = 0.556, biteHalf = at(v('bite'), Math.sqrt(half));
  check('a Predictive Array reaches a perfect lock on half the reactor, at the reach the old one cost',
    Math.abs(biteHalf.lock - 1) < 1e-9 && Math.abs(biteHalf.range - stockFull.range) < 2,
    `full lock at ${Math.round(half * 100)}% of the ability, still at ${Math.round(biteHalf.range)}px — ` +
    `push it to full and it is ${Math.round(at(v('bite'), 1).range)}px, which is knife work`);
  check('and a lock never becomes better than perfect, however hard it is driven',
    at(v('bite'), 1).lock === 1 && ATTRS.lockTighten.max <= 2,
    'lockOf clamps at 1 — unclamped it also put `lk` past 100 on the wire, and the client colours a bolt from it');
}
check('an ability technology does nothing at all on a hull without that ability, and still costs',
  (() => { const b = drive(flown('bulwark', 'deepen'), 1);
    return veilOf(b) === 1 &&
      resolve('bulwark', fit({ tech: ['deepen'] })).shield < resolve('bulwark').shield; })(),
  'a Null Skin on a Bulwark is a third of your shields for nothing — which is what makes these class technologies');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${TECHS.length} technologies, ${new Set(TECHS.map(k => EQUIPMENT[k].tier)).size} rungs`}\n`);
process.exit(fails.length ? 1 : 0);
