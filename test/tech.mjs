// Claims about the technology shelf.
//
// The shelf was twenty-six entries and every one of them was a stat swap. Read as
// a list that is arithmetic homework, and the honest answer to most of it is that
// it is a wash — so it was cut to twelve, and the test every survivor had to pass
// is that you can say what it LETS YOU DO. gear.js carries that sentence on the
// entry as `does`; shared/tech.js is the machinery behind the ones whose answer is
// not an attribute; and the last section of this file is those capabilities,
// measured.
//
// The claims that were about a deleted entry have been rewritten rather than
// removed. A deleted test is a rule nobody is keeping, and the rules did not go
// away with the items: a hold is still grown by rigs and shrunk by technology, a
// bigger capacitor still cannot buy uptime, and the escort shelf still must not be
// able to sell you damage. Those sentences now live where the surviving item is.
//
// The damage section is the one that needed a rule before it could exist at all.
// gear.js states it: a technology may multiply damage UP only against another term
// of a dps product, because those are the only costs that grow x68 alongside it.
// These assertions are that rule, measured.

import { ATTRS, HULLS, resolve, slotsOf, baysOf, FIRE_RATE } from '../shared/ships.js';
import { EQUIPMENT, MAX_DRONES, topTier } from '../shared/gear.js';
import { FORMATIONS, FORMATION_KEYS, BONUS_AT, bonusScale, escortScale } from '../shared/formation.js';
import { newShip, speedOf, rangeOf, rateOf, veilOf } from '../shared/sim.js';
import { fire, stepBolts } from '../shared/combat.js';
import { SPECIAL, drumOf, reachOf, swellOf, VEIL_DEPTH, VEIL_RECOVER,
         ANCHOR_SWELL, ANCHOR_DRAG, DRUMFIRE_GAIN, DRUMFIRE_REACH } from '../shared/ability.js';
import { ROCKET_RATE, launcherCap, isLauncher } from '../shared/rockets.js';
import { AMMO, roundPrice } from '../shared/ammo.js';
import { priceFor, techRung, TECH_POINTS, DELIVERY_PREMIUM, ANCHORS, premiumAt,
         buildFor, dpsOf, stageDps, addOf, freeMultipliers } from '../shared/balance.js';
import { ALIENS, WILD, BOUNTY_RATE, farmHp, effectiveHp, bountyFor, newAlien, stepAlienAI } from '../shared/aliens.js';
import { MAPS } from '../shared/maps.js';
import { driftDps, driftDepth, stepDrift, DRIFT_MARGIN, DRIFT_MIN, SIGHT_R } from '../shared/sim.js';
import { seenAs, aspectOf } from '../shared/stealth.js';
import { KITS } from '../shared/repair.js';
import { MATERIALS, volOf, stow } from '../shared/cargo.js';
import { chargePct } from '../shared/power.js';
import { SPENDS, PLATE_BACK, platingArmed, platingBack, FOUNDRY_RATE, FOUNDRY_QUIET,
         hullPerVol, foundryBurn, wakeSeconds, wakeTap, sustainedDps,
         SHEAR_GRACE, SHEAR_DRAW, shearGrace, holdShear, LOUD, loudOf, seesClear,
         techSet, has } from '../shared/tech.js';
import { TIP_COLS } from '../shared/tooltip.js';

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
// The claim the whole rebuild turns on. It used to read "the shelf covers every
// system a ship has", checked by walking the attributes the mods touched — which
// is exactly the reading that produced twenty-six stat swaps: cover every dial,
// one entry per dial, each one paid for out of the dial next to it. Coverage of
// the ATTRS table was never the thing worth having. A sentence is.
check('every technology says what it lets you DO, in a sentence',
  TECHS.every(k => typeof EQUIPMENT[k].does === 'string' && EQUIPMENT[k].does.length > 10),
  TECHS.filter(k => !EQUIPMENT[k].does).join(' ') ||
  `${TECHS.length} of them, down from 26, and every one is a verb`);
check('and the sentence fits the box the shop draws it in',
  TECHS.every(k => EQUIPMENT[k].does.length <= TIP_COLS),
  `longest is ${Math.max(...TECHS.map(k => EQUIPMENT[k].does.length))} of ${TIP_COLS} columns`);
check('every one of them still gives something up', (() => {
  return TECHS.every(k => {
    const e = EQUIPMENT[k];
    return e.mods.some(([a, , v]) => (ATTRS[a].better === 'high') !== (v > 0)) || !!e.spends;
  });
})(), 'the rule the original four obeyed, across all ' + TECHS.length + ' — but a cost may now be a ' +
      'resource the ship needs elsewhere rather than a second number on the same row');
check('and a cost that is not a stat is one shared/tech.js actually takes',
  TECHS.every(k => !EQUIPMENT[k].spends || EQUIPMENT[k].spends in SPENDS),
  Object.keys(SPENDS).map(s2 => `${s2}: ${TECHS.filter(k => EQUIPMENT[k].spends === s2).length}`).join(', ') +
  ' — a promise on a shop row with nothing behind it is the thing this stops');
check('and every one is a multiplier, never a flat add',
  TECHS.every(k => EQUIPMENT[k].mods.every(([, op]) => op === 'mul')),
  'racks fill a hull out, technology changes its shape');

// --- the trade has to be one you can feel, and one you should take -----------
//
// The shape asked for: "fifteen percent more damage output at the cost of ten
// percent of the shields — a stat swap that is slightly positive EV." Both halves
// of that sentence are rules here. The old shelf failed both: -9% of your top
// speed is a number nobody can feel, and paired against +35% hull it read as a
// wash rather than a decision.
const helps = ([a, , v]) => (ATTRS[a].better === 'high') === (v > 0);
const gainOf = k => EQUIPMENT[k].mods.filter(helps).reduce((n, [, , v]) => n + Math.abs(v), 0);
const lossOf = k => EQUIPMENT[k].mods.filter(m => !helps(m)).reduce((n, [, , v]) => n + Math.abs(v), 0);
const MIN_GAIN = 0.15, MIN_EDGE = 1.5;             // the reference example, read as a floor
check('every trade is one a pilot can actually feel', (() => {
  return TECHS.every(k => gainOf(k) >= MIN_GAIN);
})(), `the smallest gain on the shelf is ${Math.round(100 * Math.min(...TECHS.map(gainOf)))}% against a floor of ` +
      `${Math.round(100 * MIN_GAIN)}% — nothing here moves a number by three percent`);
check('and every trade is slightly positive: you get back more than you give up', (() => {
  return TECHS.every(k => gainOf(k) >= MIN_EDGE * lossOf(k) - 1e-9);
})(), TECHS.filter(k => gainOf(k) < MIN_EDGE * lossOf(k) - 1e-9).join(' ') ||
      `worst edge on the shelf is x${f(Math.min(...TECHS.map(k => gainOf(k) / lossOf(k))))} against the ` +
      `x${f(MIN_EDGE)} of "15% of damage for 10% of shields" — so fitting one is always the right answer, ` +
      'and never a free one');
check('and it is still never free, so nothing here is an upgrade nobody would decline',
  TECHS.every(k => lossOf(k) > 0) && freeMultipliers().length === 0,
  `every one of the ${TECHS.length} surrenders something, ` +
  `the largest give-up being ${Math.round(100 * Math.max(...TECHS.map(lossOf)))}%`);

// The one pairing that cannot be on this shelf, measured rather than asserted —
// and it is the one the shape was described with, which is why it is here in full
// rather than in a comment. Damage grows x68 with a rack and shields grow x3, so
// the same row is a DOWNGRADE for the pilot it would be priced for and fifty
// thousand credits of free capability for one who has finished.
check('and the reference trade itself, damage for shields, is the one shape that cannot be sold', (() => {
  const at = st => { const b = buildFor(st); return resolve(b.hull, b.fit, b.drones); };
  const pts = st => priceFor([['damage', 'mul', 0.15], ['shield', 'mul', -0.10]], 2, { base: at(st) }).points;
  // A RATIO, not a level. `> 4000` was a reading of one particular finished ship
  // and moved the moment the last hull's rack changed (4,451 -> 3,697). What the
  // shelf actually forbids is the SIGN FLIP: the identical row is a loss to the
  // pilot it would be priced for and a fortune to the pilot who has finished
  // whatever the top hull happens to be, by orders of magnitude.
  return pts('anchor') < 0 && pts('finished') / -pts('anchor') > 300;
})(), (() => {
  const at = st => { const b = buildFor(st); return resolve(b.hull, b.fit, b.drones); };
  const p = st => priceFor([['damage', 'mul', 0.15], ['shield', 'mul', -0.10]], 2, { base: at(st) });
  return `x1.15 damage for x0.90 shield scores ${Math.round(p('anchor').points)} points against the reference ` +
         `pilot and ${Math.round(p('finished').points)} against a finished ship, a ` +
         `${Math.round(p('finished').points / -p('anchor').points)}x sign flip — ` +
         `${Math.round(p('finished').price).toLocaleString('en-GB')} cr of capability, on the same row, at the same price`;
})());

check('one entry sells a rule with almost no numbers on it, and that is allowed',
  EQUIPMENT.compensator.spends === 'reactor' &&
  !TECHS.some(k => EQUIPMENT[k].mods.some(([a2]) => a2 === 'hull') &&
                   EQUIPMENT[k].mods.some(([a2]) => a2 === 'shield')),
  'a Shear Compensator is paid for in capacitor as well as in radar — the old form of the ' +
  '"costs something" check could only see attributes, and passed twenty-six things nobody wanted');

// The price of anything the model cannot read is the shelf's own rung, and the
// rung is read back off the shelf rather than picked. See balance.js TECH_POINTS.
{
  const dark = TECHS.filter(k => priceFor(EQUIPMENT[k].mods, EQUIPMENT[k].tier ?? 1).points <= 0);
  const off = dark.filter(k => Math.abs(EQUIPMENT[k].price / techRung(EQUIPMENT[k].tier ?? 1) - 1) > 0.01);
  check('a technology the model cannot price sits on the shelf\'s own rung', off.length === 0,
    off.join(' ') || `${dark.length} of ${TECHS.length} at ${f(TECH_POINTS, 0)} points — ` +
    [1, 2, 3].map(t => `${Math.round(techRung(t))}`).join(' / ') + ' cr by tier');
  // This used to be Racked Reloads charging DELIVERY_PREMIUM on top of the rung.
  // The rule it was stating survives the item: an entry that charges more than the
  // rung has to say what the extra is for. Composite Plating is the only one now,
  // and the extra is not a premium at all — it is the half of it the model CAN
  // read, added to the rung for the half it cannot.
  const model = priceFor(EQUIPMENT.plating.mods, 2).price;
  check('and the one that charges more than the rung says exactly what the extra is',
    Math.abs(EQUIPMENT.plating.price / (techRung(2) + model) - 1) < 0.01,
    `Composite Plating is ${EQUIPMENT.plating.price} — a rung of ${Math.round(techRung(2))} for the save, ` +
    `plus ${Math.round(model)} for the +50% of hull, which is the only part of it the model can see`);
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

// ---------------------------------------------- every legal fit, brute-forced
//
// The check that would have caught the Cadence pair, and will catch the next one.
//
// Siege Cadence and Rapid Cadence are opposite trades of damage against rate, and
// while percentages SUMMED the two annihilated: +0.60 and -0.375 added to +0.225 on
// BOTH halves of the dps product, so the pair was a free x1.50 and neither gave
// anything up. Every claim above passed anyway, because every one of them reads ONE
// technology against the ship that would have flown without it, and the defect was
// in the arithmetic that puts two of them together. So this sweeps the whole space
// instead of a hand-picked build, and states the rule the pair broke.
//
// It is a real brute force over the ship's own slots — every legal multiset of
// weapons against every legal SET of technologies (a technology is unique across the
// whole ship: sanitiseFit dedupes the rack, sanitiseDrones refuses a second copy on
// the escort) — with two prunings that are provable rather than convenient, because
// dpsOf reads a generator and a drone through exactly one number each:
//
//   drones      contribute flat `damage` adds and flat `speed` costs and nothing
//               else, and dps is monotone increasing in both, so the best escort at
//               any split is the top emitter and the top generator. Every SPLIT is
//               still swept, because the split is a real trade: four E-Cells on a
//               Vanguard's bays beat four more emitters, and that is the fit that
//               wins the whole sweep.
//   generators  reach dps only through the reactor headroom their speed cost buys
//               (see resolve), so the top one is the answer for every slot.
//
// Confirmed against the unpruned sweep, 11.3M fits: same maxima, every hull.
{
  const sweepT0 = Date.now();
  const WEAPONS = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'weapon');
  const GENS = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'generator');
  const GUNS = WEAPONS.filter(k => !isLauncher(k));
  const TOPGUN = GUNS.reduce((a, b) => (addOf(b, 'damage') > addOf(a, 'damage') ? b : a));
  const TOPGEN = GENS.reduce((a, b) => (addOf(b, 'speed') < addOf(a, 'speed') ? b : a));
  const multisets = (list, n2) => { const out = []; const rec = (st, acc) => {
    if (acc.length === n2) { out.push(acc.slice()); return; }
    for (let i = st; i < list.length; i++) { acc.push(list[i]); rec(i, acc); acc.pop(); }
  }; rec(0, []); return out; };
  const subsets = (list, n2) => { const out = [[]]; const rec = (st, acc) => {
    for (let i = st; i < list.length; i++) {
      acc.push(list[i]); if (acc.length <= n2) { out.push(acc.slice()); rec(i + 1, acc); } acc.pop();
    }
  }; rec(0, []); return out; };

  let fits = 0, best = { d: -1 }, worst = { ratio: 0 };
  for (const hull of Object.keys(HULLS)) {
    const sl = slotsOf(hull), bays = baysOf(hull), lcap = launcherCap(hull);
    const wsets = multisets(WEAPONS, sl.weapon).filter(w => w.filter(isLauncher).length <= lcap);
    const gen = Array(sl.generator).fill(TOPGEN);
    const tsets = subsets(Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'tech'), sl.tech);
    const escorts = [];
    for (let k = 0; k <= bays; k++)
      escorts.push([...Array(k).fill(TOPGEN), ...Array(bays - k).fill(TOPGUN)]);
    for (const w of wsets) for (const d of escorts) {
      // The same rack, every legal technology set on it, against the best that one
      // technology alone can do to it.
      let any = -1, one = -1, anyT = null, oneT = null;
      for (const t of tsets) {
        fits++;
        const v = dpsOf({ hull, fit: { weapon: w, generator: gen, tech: t }, drones: d });
        if (v > any) { any = v; anyT = t; }
        if (t.length <= 1 && v > one) { one = v; oneT = t; }
      }
      if (any > best.d) best = { d: any, hull, w, t: anyT, gd: d.filter(x => x === TOPGEN).length };
      if (any / one > worst.ratio) worst = { ratio: any / one, hull, w, anyT, oneT, any, one };
    }
  }
  // The top of the SHOP, which since the deep outposts landed is `deep` rather than
  // `finished`. `finished` is the top of the ordinary climb and the Thresher's mirror
  // is pinned to it on purpose (see SHOP_DPS in aliens.js — a gate must not scale with
  // the reward for passing it); what this claim is about is the widest gap any legal
  // fit can open over the shelf, so it reads the shelf.
  const ceiling = stageDps('deep');
  // THE claim. A second technology may SHAPE a build; it may never multiply it a
  // second time, and two of them may never hand each other their costs back.
  check('no combination of technologies out-damages the best single one, on any legal fit', (() => {
    return worst.ratio <= 1 + 1e-9;
  })(), `the worst any set does against the best single one on its own rack is ` +
        `x${f(worst.ratio, 6)}, over ${fits.toLocaleString()} fits in ${((Date.now() - sweepT0) / 1000).toFixed(1)}s. ` +
        'Summed, this same sweep found 16,967 dps on a Bulwark carrying Siege Cadence AND Rapid Cadence — ' +
        'x1.225 on damage and x1.225 on rate at once, which is x1.50 of damage output and neither of them ' +
        'giving anything up');
  // The same rule one level down, and on every attribute rather than on dps alone:
  // the Cadences cancelled on `damage` and `fireRate`, but the next pair might do it
  // on hull and cargo, or radar and signature, where no dps sweep would ever see it.
  // "Every technology gives something up" is checked one row at a time above; this is
  // that sentence lifted to the SET, which is where it actually failed.
  check('and no legal set of technologies is a pure gain, on any attribute of any hull', (() => {
    const bad = [];
    for (const hull of Object.keys(HULLS)) {
      const bare = resolve(hull);
      const tsets = subsets(TECHS, slotsOf(hull).tech).filter(t => t.length > 0);
      for (const t of tsets) {
        const got = resolve(hull, fit({ tech: t }));
        let up = false, down = false;
        for (const k of Object.keys(ATTRS)) {
          const d2 = (got[k] - bare[k]) * (ATTRS[k].better === 'high' ? 1 : -1);
          if (d2 > 1e-9 * Math.max(1, Math.abs(bare[k]))) up = true;
          if (d2 < -1e-9 * Math.max(1, Math.abs(bare[k]))) down = true;
        }
        if (up && !down) bad.push(`${hull} [${t}]`);
      }
    }
    return bad.length === 0;
  })(), 'checked over every legal combination on all four hulls — a set that moved a number the right way ' +
        'and nothing the wrong way is two technologies handing each other their costs back, which is ' +
        'exactly what Siege and Rapid Cadence did while percentages summed');

  // And what that ceiling actually is. It used to matter because the Thresher's
  // mirror was anchored to it; the mirror is pinned to the climb now, and this claim
  // stands on its own feet — a fit the shop allows that is half again as sharp as the
  // shop's own top build means the ladder is not the ladder.
  check('and the sharpest legal fit in the game is a hull advantage, not a technology', (() => {
    return best.d / ceiling < 1.2 && best.hull === 'vanguard';
  })(), `${best.d.toFixed(2)} dps — a ${HULLS[best.hull].name} with ${best.w.length} racks and ` +
        `${EQUIPMENT[best.t[0]]?.name ?? 'nothing'}, ${best.gd} of its bays flying generators — against ` +
        `${ceiling.toFixed(2)} at the top of the ladder, which is x${f(best.d / ceiling, 3)}. The gap is the ` +
        'fifth hardpoint and the permission to fill all five with racks, which is capability no other hull ' +
        'can buy at any price. The Cadence pair was x1.501 of the same number, and that one was not a hull');
}

check('Launcher Primacy pays a rocket boat at both ends of the ladder, and taxes everyone else', (() => {
  const gain = (b) => dpsOfStats(statsOf(b, 'primacy')) / dpsOfStats(statsOf(b)) - 1;
  return gain(B.pod) > 0.20 && gain(B.rocketeer) > 0.30      // committed, bottom and top
      && gain(B.starter) < -0.29 && gain(B.finished) < -0.29 // no rack at all: it is just a tax
      && gain({ ...B.rocketeer, drones: Array(12).fill('emitter5') }) < 0;
})(), `+${f(100 * (dpsOfStats(statsOf(B.pod, 'primacy')) / dpsOfStats(statsOf(B.pod)) - 1), 0)}% on a Hauler with one Sparrow Pod, ` +
      `+${f(100 * (dpsOfStats(statsOf(B.rocketeer, 'primacy')) / dpsOfStats(statsOf(B.rocketeer)) - 1), 0)}% on a Bulwark with three Osprey Racks, ` +
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
  check('and it is worth nothing at all once you have bought the bays',
    [3, 6, 12].every(n => at(n, 'repeaters') === at(n, null)),
    'a formation full at one drone and a formation full at three are the same formation from three onward — ' +
    'the shape no other entry on the shelf has, and the reason this one survived the cut');
}
// This used to be a pair of crossover claims about Wing Coupling, which raised
// `escort` — how hard the formation pays once the ramp is finished — and paid for
// it with 7.5% of your fire rate, sized against the Attack Wedge's 12% damage
// specifically. It is gone, and the RULE it was there to keep is not: the escort
// shelf may shorten the ramp and must never raise the payout, because the Wedge
// multiplies DAMAGE and an `escort` dial with a Wedge flying it is a damage
// multiplier wearing a hat. Stated as a prohibition now rather than as a price,
// which is the version that cannot be got wrong by resizing a formation.
check('nothing on the shelf can raise what a formation pays, whichever formation is flying it', (() => {
  if (TECHS.some(k => EQUIPMENT[k].mods.some(([a2, , v]) => a2 === 'escort' && v > 0))) return false;
  for (const k of FORMATION_KEYS) for (const t of TECHS) {
    const a = statsOf(B.finished, null, k), b = statsOf(B.finished, t, k);
    if (b.escort > a.escort + 1e-9) return false;
  }
  return true;
})(), 'no technology moves `escort` upward, so no technology can sell you damage through the ' +
      `Attack Wedge — checked across all ${FORMATION_KEYS.length} formations and all ${TECHS.length} technologies`);

// ------------------------------------------------------- the fourth system
console.log('\nthe fourth system is fittable now');
const drive = (s, l) => { s.power.to = SPECIAL; s.power.special = l; return s; };
const flown = (h, t) => newShip(0, 0, h, fit({ tech: t ? [t] : [] }), []);
check('every dial of every ability is a row in ATTRS, with the shipped setting as its default',
  ATTRS.veilDepth.dflt === VEIL_DEPTH && ATTRS.veilRecover.dflt === VEIL_RECOVER &&
  ATTRS.anchorSwell.dflt === ANCHOR_SWELL && ATTRS.anchorDrag.dflt === ANCHOR_DRAG &&
  ATTRS.drumfireGain.dflt === DRUMFIRE_GAIN && ATTRS.drumfireReach.dflt === DRUMFIRE_REACH,
  'ships.js imports them from ability.js rather than restating them, so the two cannot drift');
check('and every one of them has a ceiling, because some of these want one',
  [ATTRS.veilDepth, ATTRS.anchorSwell, ATTRS.anchorDrag, ATTRS.drumfireGain, ATTRS.drumfireReach]
    .every(a => Number.isFinite(a.max)),
  `a veil stops at x${f(1 - ATTRS.veilDepth.max)} detection and an anchor keeps ` +
  `${Math.round((1 - ATTRS.anchorDrag.max) * 100)}% of its speed — ability.js argues both`);
check('a technology cannot push a dial past its ceiling',
  resolve('kestrel', fit({ tech: ['deepen'] })).veilDepth === ATTRS.veilDepth.max &&
  resolve('kestrel', fit({ tech: ['repeaters'] })).cohesion === ATTRS.cohesion.min,
  'Null Skin asks for 0.9416 and gets 0.94; Wing Repeaters asks for 0.99 drones and gets 1');

{
  const veil = (t, since) => { const k = drive(flown('kestrel', t), 1); k.sinceShot = since; return veilOf(k); };
  check('a Null Skin halves the range a Kestrel is found at',
    Math.abs(veil('deepen', 1e9) - 0.06) < 1e-9,
    `detection x${f(veil(null, 1e9))} becomes x${f(veil('deepen', 1e9))} — not zero, ever`);
  // The Fade Governor was the other half of this pair — a thinner veil that rebuilt
  // faster after a shot — and the two crossed at one shot every 2.68s. It went
  // because "which of these two numbers suits your trigger discipline" is exactly
  // the kind of arithmetic the shelf was cut to get rid of. What the Skin sells is
  // not a better number, it is a distance: at a Kestrel's own radar you are found
  // at 156px, which is inside knife range, so a sector can be crossed unplotted.
  const skin = resolve('kestrel', fit({ tech: ['deepen'] }));
  check('and what that buys is a crossing: you are found inside knife range or not at all',
    skin.radar * (1 - skin.veilDepth) < 200,
    `found at ${Math.round(skin.radar * (1 - skin.veilDepth))}px against ` +
    `${Math.round(resolve('kestrel').radar * (1 - resolve('kestrel').veilDepth))}px stock — ` +
    'and the shields are what pays: a Kestrel has the fewest of them');
}
{
  const anchor = t => { const b = drive(flown('bulwark', t), 1);
    return { swell: swellOf({ ability: 'anchor' }, b.power, b.stats), speed: speedOf(b) / b.stats.speed }; };
  const s = anchor(null), w = anchor('walk');
  // Keel Bracing was the other half — x5.5 shields at 5% of your speed — and it
  // went for the same reason the Fade Governor did: it slid the dial further along
  // the line the ability already sat on. Anchor Servos change what the ability IS.
  // A stock Anchor is a wall, and a wall cannot leave; this one can, which is a
  // Bulwark that holds the ability through a chase instead of choosing between
  // them. Both halves still come off the same dial, so it can only move the rate.
  check('Anchor Servos buy a wall that can walk, and pay for it in wall',
    w.speed > s.speed && w.swell < s.swell,
    `stock x${f(s.swell, 1)} shield at ${Math.round(s.speed * 100)}% speed, ` +
    `Servos x${f(w.swell, 1)} at ${Math.round(w.speed * 100)}% — the same dial, a different exchange rate`);
  check('and it never lets a Bulwark stop dead',
    w.speed > 0 && s.speed > 0, 'a ship at zero is repositioned only by whatever is shooting it');
}
{
  // Rewritten twice now, and the rule underneath has survived both. It was the Lock
  // Repeater; then it was "half your reach for twice the rate", checked as
  // reach x rate = 1.0000 either way, because Drumfire's two dials were ONE number
  // twice. The gain is solved from a design target now — a full drum throws twice
  // what an interceptor does — so the dials are independent and there is no curve
  // to sit on. What is left is the claim that always mattered: AN ABILITY
  // TECHNOLOGY MAY CHANGE THE EXCHANGE RATE AND NEVER THE SIZE. A row that raised
  // the gain would just be a bigger ability, which is the ceiling's job, not the
  // shelf's; this one lowers it and buys reach back, exactly as Anchor Servos
  // lowers the swell and buys speed back, with the same -0.60 and -0.40.
  const V = { ability: 'drumfire' };
  const v = t => flown('vanguard', t);
  const at = (t, lvl) => { const s = drive(v(t), lvl);
    return { rate: drumOf(V, s.power, s.stats), reach: reachOf(V, s.power, s.stats), range: rangeOf(s) }; };
  const stock = at(null, 1), gov = at('governor', 1);
  check('a Drum Governor buys most of your reach back, and pays for it in drum',
    gov.range > stock.range && gov.rate < stock.rate && gov.rate > 1,
    `stock x${f(stock.rate)} of your cycle at ${Math.round(stock.range)}px becomes x${f(gov.rate)} at ` +
    `${Math.round(gov.range)}px — a drum you can hold at a range you can fight from, ` +
    'which is the Anchor Servos trade one ability along');
  check('and it changes the exchange rate without changing the size of the ability',
    Math.abs(gov.rate * gov.range / (stock.rate * stock.range) - 1) < 0.02 &&
    gov.rate < stock.rate,
    `damage per metre of reach is ${f(stock.rate * stock.range / 1000, 2)} stock and ` +
    `${f(gov.rate * gov.range / 1000, 2)} with the Governor, inside ` +
    `${f(100 * Math.abs(gov.rate * gov.range / (stock.rate * stock.range) - 1), 1)}% — an ability ` +
    'technology that made the ability BIGGER would be a damage multiplier wearing a hat, and the ' +
    'ceiling that stops one is in ATTRS rather than on this shelf');
  check('and the ceiling that does stop one is the design target doubled',
    resolve('vanguard', fit({ tech: ['governor'] })).drumfireGain <= ATTRS.drumfireGain.max &&
    resolve('vanguard', fit({ tech: ['governor'] })).drumfireReach <= ATTRS.drumfireReach.max &&
    1 + ATTRS.drumfireGain.max >= 2 * (1 + DRUMFIRE_GAIN) - 0.05,
    `a full drum is x${f(1 + DRUMFIRE_GAIN)} of your cycle, which is twice an interceptor with its ` +
    `reactor on its guns; the dial stops at x${f(1 + ATTRS.drumfireGain.max)}, which is four times one, ` +
    `and the reach floor of ${Math.round((1 - ATTRS.drumfireReach.max) * 100)}% is 140px — inside the ` +
    'slack around an aim point, so a reach you cannot miss from is not a reach');
}
check('an ability technology does nothing at all on a hull without that ability, and still costs',
  (() => { const b = drive(flown('bulwark', 'deepen'), 1);
    return veilOf(b) === 1 &&
      resolve('bulwark', fit({ tech: ['deepen'] })).shield < resolve('bulwark').shield; })(),
  'a Null Skin on a Bulwark is a third of your shields for nothing — which is what makes these class technologies');

// ------------------------------------------------- what they let you do
// The half of the shelf that is not a percentage. Every one of these is a rule
// that is true for a ship with the thing fitted and false for one without, and
// every one of them is a hook in shared/tech.js rather than a number in ATTRS.
console.log('\nthe half that is not a percentage');

const flying = (h, t, o = {}) => Object.assign(newShip(0, 0, h, fit({ tech: t ? [t] : [] }), []), o);

// --- Composite Plating -------------------------------------------------------
{
  const armoured = flying('vanguard', 'plating'), bare = flying('vanguard', null);
  check('Composite Plating catches the killing blow, once, and then it is spent',
    platingArmed(armoured, true) && !platingArmed(armoured, false) && !platingArmed(bare, true),
    `it leaves you on ${Math.round(PLATE_BACK * 100)}% of hull — ${Math.round(platingBack(armoured))} of ` +
    `${Math.round(armoured.stats.hull)} — and is re-seated at a dock, so a pilot who never goes home never gets a second`);
  check('and what it puts back is the cheapest kit in the shop, not a number somebody picked',
    PLATE_BACK === KITS.kit1.heal,
    `a ${KITS.kit1.name} is ${Math.round(KITS.kit1.heal * 100)}% of hull for ${KITS.kit1.price} cr — the free ` +
    'save is never better than the cheapest thing you could have bought for the job, it is just always there');
}

// --- Ore Foundry -------------------------------------------------------------
{
  // The design statement, checked on every hull and on fits that move both
  // numbers: a full hold mends a full hull. It falls out of hull/cargo, so it is
  // right without anyone tuning it — including on the Foundry's own -30% of hold,
  // which makes each unit of ore worth proportionally more.
  const runFull = hull => {
    const sh = flying(hull, 'foundry');
    const hold = {};
    stow(hold, 'iron', 9999, sh.stats.cargo);           // fill it to the brim with the cheapest thing there is
    const vol = 3 * hold.iron;                          // iron is 3 to the unit
    sh.hp = 1; sh.sinceHit = 1e9;
    let t = 0;
    while (t < 120 && sh.hp < sh.stats.hull && (hold.iron ?? 0) > 0) { foundryBurn(sh, hold, dt); t += dt; }
    return { got: sh.hp / sh.stats.hull, secs: t, vol, healed: sh.hp - 1,
             cap: sh.stats.cargo, per: hullPerVol(sh.stats), max: sh.stats.hull };
  };
  const rows = Object.keys(HULLS).map(h => [h, runFull(h)]);
  check('an Ore Foundry turns a full hold into a full hull, on every ship there is',
    rows.every(([, r]) => r.got > 0.94),
    rows.map(([h, r]) => `${h} ${Math.round(r.got * 100)}%`).join('  ') +
    ' — hull over hold, so it needs no tuning and cannot be wrong on a hull added later');
  check('and the exchange is the volume you burned times hull-over-hold, which is what makes that true',
    // `max - 1` because the run starts on one hull point, and a hold that would
    // more than fill the ship is clamped by the ship rather than by the ore.
    rows.every(([, r]) => Math.abs(r.healed - Math.min(r.vol * r.per, r.max - 1)) < 1e-6 &&
                          Math.abs(r.vol / r.cap - 1) < 0.06),
    rows.map(([h, r]) => `${h} ${r.vol} of ${Math.round(r.cap)} hold x ${f(r.per, 1)} = ${Math.round(r.healed)} hull`).join('  ') +
    ' — the shortfall is the granularity of the ore, not the rule: iron comes in threes and a hold is not ' +
    'always a multiple of three');
  check('and it takes about as long as the cheapest repair drone would',
    rows.every(([, r]) => r.secs > KITS.kit1.secs && r.secs < 20),
    `${f(Math.min(...rows.map(([, r]) => r.secs)), 1)}s to ${f(Math.max(...rows.map(([, r]) => r.secs)), 1)}s for ` +
    `a full rebuild, at a ${KITS.kit1.name}'s rate of ${Math.round(FOUNDRY_RATE * 100)}% of hull a second — the ` +
    'difference is that it never stops the ship and is never used up');
  check('it will not work while something is shooting at you', (() => {
    const sh = flying('vanguard', 'foundry');
    const hold = { iron: 60 };
    sh.hp = 1; sh.sinceHit = FOUNDRY_QUIET * 0.9;
    return foundryBurn(sh, hold, dt) === null && hold.iron === 60;
  })(), `${FOUNDRY_QUIET}s of quiet, which is half what a repair kit asks — a kit is one lump and this is a trickle`);
  check('and it is the iron that burns, never the iridium', (() => {
    const sh = flying('bulwark', 'foundry');
    const hold = { iron: 20, iridium: 20 };
    sh.hp = 1; sh.sinceHit = 1e9;
    for (let t = 0; t < 2; t += dt) foundryBurn(sh, hold, dt);
    return (hold.iron ?? 0) < 20 && hold.iridium === 20;
  })(), 'the same ladder the refinery walks, from the bottom — which is why this is priced by VOLUME and not ' +
        'by value: you feed it the bulk and carry the good stuff home');
  check('a ship without one never burns anything', (() => {
    const sh = flying('vanguard', null); const hold = { iron: 40 };
    sh.hp = 1; sh.sinceHit = 1e9;
    return foundryBurn(sh, hold, dt) === null && hold.iron === 40;
  })());
  // What pricing it by VOLUME actually does once the drop tables have a shape.
  // A hostile drops the part of the metal ladder it is worth killing for, so a
  // frontier hold is rhodium and up and a home hold is iron — same volume, forty
  // five times the value. So the furnace is pocket change in your own ring and a
  // real bill out where you need it, which is the right way round and needed no
  // second rule to arrange.
  {
    const cost = (hull, mat) => {
      const s2 = resolve(hull, fit({ tech: ['foundry'] }));
      const units = s2.hull / (volOf(mat) * hullPerVol(s2));
      return units * MATERIALS[mat].value;
    };
    check('and what a full hull costs you climbs with the sector you are mending in',
      cost('bulwark', 'rhodium') > cost('bulwark', 'iron') * 30 &&
      cost('bulwark', 'rhodium') < KITS.kit3.price,
      `a Bulwark hull is ${Math.round(cost('bulwark', 'iron'))} cr of iron at home and ` +
      `${Math.round(cost('bulwark', 'rhodium'))} cr of rhodium at the frontier, where a Bandit's ` +
      `drop table now starts — still under a ${KITS.kit3.name}'s ${KITS.kit3.price}, so it stays the ` +
      'thrifty way to mend, and it stops being free the further out you take it');
  }
}

// --- Wake Tap ----------------------------------------------------------------
{
  const tapped = flying('vanguard', 'waketap');
  tapped.power.charge = 0;
  const back = wakeTap(tapped, bountyFor('drifter'));
  check('a kill hands the reactor back the seconds the fight took', back > 0 &&
    Math.abs(back - wakeSeconds(bountyFor('drifter'), tapped.stats)) < 1e-9,
    `a Drifter is ${bountyFor('drifter')} cr, which off this ship's ${f(sustainedDps(tapped.stats), 1)} dps is ` +
    `${f(back)}s of a ${Math.round(tapped.stats.capacitor)}s tank — power.js normalises draw so one point of ` +
    'charge is one second of full boost, which is what makes the two halves meet');
  check('and it is the identity from balance.js, not a number anybody chose', (() => {
    // credits per second of fight = dps x BOUNTY_RATE, exactly, for every hostile.
    for (const kind of WILD) {
      const want = farmHp(kind) / sustainedDps(tapped.stats);
      // A fifth of a percent, not exact, and the slack is one specific thing: a
      // bounty is written into the bestiary rounded to the credit, so a hostile
      // whose effective hp x 0.70 is not a whole number is off by half a credit.
      if (Math.abs(wakeSeconds(bountyFor(kind), tapped.stats) / want - 1) > 0.002) return false;
    }
    return true;
  })(), `all ${WILD.length} hostiles, before the tank caps it: ` + WILD.map(k =>
    `${ALIENS[k].name} ${f(wakeSeconds(bountyFor(k), tapped.stats), 1)}s`).join(', ') +
    ' — a bigger kill IS a longer fight, so it gives back more, up to one tankful');
  check('it can never bank more than the tank holds', (() => {
    const t2 = flying('vanguard', 'waketap'); t2.power.charge = 0;
    wakeTap(t2, ALIENS.hive.bounty);
    return Math.abs(t2.power.charge - t2.stats.capacitor) < 1e-9;
  })(), 'a Corsair Hive is 455,000 cr and still only fills it');
  check('and a ship without one gets nothing', (() => {
    const t3 = flying('vanguard', null); t3.power.charge = 5;
    return wakeTap(t3, 99999) === 0 && t3.power.charge === 5;
  })());
  check('what it costs is the way a reactor used to refill', (() => {
    const bare = resolve('vanguard'), tap = resolve('vanguard', fit({ tech: ['waketap'] }));
    return tap.recharge < bare.recharge * 0.5 && tap.capacitor > bare.capacitor * 1.5;
  })(), `recharge ${resolve('vanguard').recharge}/s -> ${f(resolve('vanguard', fit({ tech: ['waketap'] })).recharge)}/s, ` +
        `tank ${resolve('vanguard').capacitor}s -> ${Math.round(resolve('vanguard', fit({ tech: ['waketap'] })).capacitor)}s — ` +
        'a bigger tank was worth nothing on its own, and is worth everything to something that fills it by killing');
}

// --- Shear Compensator -------------------------------------------------------
{
  check('the shear wall has not moved for anyone without a compensator',
    [0, 1, 450, 900, 1350, DRIFT_MARGIN].every(d =>
      driftDps(d) === (d <= 0 ? 0 : DRIFT_MIN + (2000 - DRIFT_MIN) * (Math.min(1, d / DRIFT_MARGIN) ** 2))),
    `still ${DRIFT_MIN}/s the instant you cross and 2000/s at the limit — a mitigation that quietly moved ` +
    'the wall would be a different game, not a technology');
  const out = (t, charge) => {
    const sh = flying('vanguard', t, { x: -1, y: 0 });
    sh.power.charge = charge * sh.stats.capacitor;
    return sh;
  };
  check('a full tank holds off half the margin, and an empty one holds off none',
    shearGrace(out('compensator', 1)) === SHEAR_GRACE && shearGrace(out('compensator', 0)) === 0 &&
    Math.abs(shearGrace(out('compensator', 0.5)) - SHEAR_GRACE / 2) < 1e-9 &&
    shearGrace(out(null, 1)) === 0,
    `${SHEAR_GRACE}px of the ${DRIFT_MARGIN}px margin at a full tank, sliding to nothing — proportional rather ` +
    'than a switch, because a hard cut-off oscillates as the tank refills a tick later and reads as a bug');
  check('so the margin becomes ground: no shear at all where there was 141/s', (() => {
    const sh = out('compensator', 1); sh.x = -400;
    return driftDps(400, shearGrace(sh)) === 0 && driftDps(400) > 100;
  })(), `400px outside the chart is ${Math.round(driftDps(400))} hull/s bare and 0 with a full tank — ` +
        'which is what makes it somewhere you can cross, hold and fight rather than a wall');
  check('and anything that follows you out there has no compensator and is dying',
    driftDps(SHEAR_GRACE) > 500,
    `at ${SHEAR_GRACE}px a hostile takes ${Math.round(driftDps(SHEAR_GRACE))} hull/s, which is a Drifter's whole ` +
    `${farmHp('drifter')} effective hp in ${f(farmHp('drifter') / driftDps(SHEAR_GRACE), 1)}s`);
  // And the boundary, which is the honest half of the same claim: the margin is a
  // weapon against the things that chase you and not against the things that kill
  // you. A Harrier is the interesting case — new at the frontier, faster than every
  // hull but a Kestrel, so it is the one hostile you genuinely cannot walk away
  // from — and it does not survive the trip. A Bandit does.
  check('but the margin kills what chases you, not what beats you', (() => {
    const secs = k => effectiveHp(k) / driftDps(SHEAR_GRACE);
    return secs('harrier') < 5 && secs('bandit') > 30;
  })(), WILD.map(k => `${ALIENS[k].name} ${f(effectiveHp(k) / driftDps(SHEAR_GRACE), 1)}s`).join(', ') +
    ` at ${Math.round(driftDps(SHEAR_GRACE))} hull/s — a Harrier you cannot outrun dies out there in four ` +
    'seconds, and a Bandit follows you out and finishes the job');
  check('holding it costs the reactor, and costs more the further out you are', (() => {
    const shallow = out('compensator', 1); shallow.x = -400;
    const deep = out('compensator', 1); deep.x = -1600;
    const a = shallow.power.charge, b = deep.power.charge;
    holdShear(shallow, 1); holdShear(deep, 1);
    return a - shallow.power.charge > 0 && (b - deep.power.charge) > (a - shallow.power.charge) * 3;
  })(), (() => {
    const rows = [400, 900, 1350, 1800].map(d => {
      const sh = out('compensator', 1); sh.x = -d;
      const was = sh.power.charge; holdShear(sh, 1);
      return `${d}px ${f(was - sh.power.charge, 2)}/s`;
    });
    return rows.join('  ') + ` against a recharge of ${resolve('vanguard').recharge}/s — so the shallow margin is ` +
      'free to live on and the deep end is a countdown';
  })());
  check('inside the chart it does nothing and costs nothing', (() => {
    const sh = flying('vanguard', 'compensator', { x: 500, y: 500 });
    const was = sh.power.charge;
    return holdShear(sh, 1) > 0 && sh.power.charge === was && driftDepth(500, 500) === 0;
  })(), 'the entry is dead weight everywhere a pilot normally flies, which is the half of its price ' +
        'that is not a number');
  check('and a ship without one is charged nothing and given nothing', (() => {
    const sh = flying('vanguard', null, { x: -900, y: 0 });
    const was = sh.power.charge;
    return holdShear(sh, 1) === 0 && sh.power.charge === was;
  })());
}

// --- Aspect Filter -----------------------------------------------------------
{
  const bandit = { x: 0, y: 0, heading: 0 };
  const infront = { x: 400, y: 0 };                    // dead nose-on: its quietest aspect
  check('an Aspect Filter sees a Bandit from the front, where nothing else can', (() => {
    let worst = 1;
    for (let ms = 0; ms < 4000; ms += 40) {
      const seen = seenAs(bandit, infront, ms, 3, true);
      worst = Math.min(worst, seen.alpha);
      if (!seen.shown) return false;
    }
    return worst === 1;
  })(), `nose-on aspect is ${f(aspectOf(bandit, infront))}, where stealth.js draws it at ` +
        `alpha ${f(seenAs(bandit, infront, 1000, 3).alpha)} and hides it entirely most of the time — ` +
        'with the filter it is an ordinary ship at every angle');
  check('and the same rule answers the client and the seeker, so they cannot disagree',
    seenAs(bandit, infront, 1234, 3, true).shown === true &&
    seenAs(bandit, infront, 1234, 3, false).aspect < 0.01,
    'one flag on one function in stealth.js — a Bandit you can see and a Bandit your rockets can see ' +
    'being different things is the bug this shape prevents');
  check('what it costs is every hostile opening on you from off-screen', (() => {
    return loudOf(flying('vanguard', 'filter')) === LOUD && loudOf(flying('vanguard', null)) === 1 &&
      WILD.every(k => !ALIENS[k].aggro || ALIENS[k].aggro * LOUD > SIGHT_R);
  })(), `x${LOUD} on every aggro radius there is, which puts all of them past the ${SIGHT_R}px you are ` +
        'guaranteed to see: ' + WILD.filter(k => ALIENS[k].aggro).map(k =>
          `${ALIENS[k].name} ${ALIENS[k].aggro}->${Math.round(ALIENS[k].aggro * LOUD)}`).join(', '));
  // Which hostile this is actually a price against, and the answer is a short list.
  // Hearing you early only matters if the thing that heard you can arrive: four of
  // the six LOSE ground to a Bulwark and would never close the gap. The Harrier is
  // the one that makes the cost real at the frontier, and it is new — it was not in
  // the bestiary when this technology was designed.
  check('and it is a real price only against something quick enough to arrive', (() => {
    // 50px/s of closing speed, which is 768px in fifteen seconds — the difference
    // between a chase and a rounding error. A Drifter's +10 on a Bulwark would take
    // it seventy-seven seconds to cross the extra range this buys it.
    const gain = k => ALIENS[k].attrs.speed - HULLS.bulwark.attrs.speed;
    const quick = WILD.filter(k => gain(k) > 50);
    return quick.includes('harrier') && quick.includes('bandit') && quick.length === 2;
  })(), WILD.filter(k => ALIENS[k].aggro).map(k => {
    const gain = ALIENS[k].attrs.speed - HULLS.bulwark.attrs.speed;
    return `${ALIENS[k].name} ${gain > 0 ? '+' : ''}${gain}`;
  }).join(', ') + ' px/s on a Bulwark — only the Harrier and the Bandit close at any speed, and a Harrier ' +
     `opening at ${Math.round(ALIENS.harrier.aggro * LOUD)}px is on you in ` +
     `${f(ALIENS.harrier.aggro * LOUD / (ALIENS.harrier.attrs.speed - HULLS.bulwark.attrs.speed), 1)}s`);
  check('and it is the alien AI that reads it, not a number on your ship', (() => {
    // Parked exactly between a Drifter's aggro and its aggro with a filter running.
    const map = MAPS.m1;
    const between = (ALIENS.drifter.aggro + ALIENS.drifter.aggro * LOUD) / 2;
    const run = loud => {
      const a = newAlien('drifter', 1, map, 7, { x: 0, y: 0 });
      const me = flying('vanguard', loud ? 'filter' : null, { x: between, y: 0 });
      stepAlienAI(a, map, [{ id: 9, ship: me, haven: false, loud: loudOf(me) }], dt);
      return a.target;
    };
    return run(false) === null && run(true) === 9;
  })(), `parked ${Math.round((ALIENS.drifter.aggro + ALIENS.drifter.aggro * LOUD) / 2)}px from a Drifter, which ` +
        `ignores you at ${ALIENS.drifter.aggro} and picks the fight at ${Math.round(ALIENS.drifter.aggro * LOUD)}`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${TECHS.length} technologies, ${new Set(TECHS.map(k => EQUIPMENT[k].tier)).size} rungs`}\n`);
process.exit(fails.length ? 1 : 0);
