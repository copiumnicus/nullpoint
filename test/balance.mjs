// Claims about the cost and difficulty model.
//
// These are not claims about whether the game is balanced — test/offmodel.mjs
// prints that and takes no view. These are claims about the model itself: that it
// is derived rather than picked, that it stays monotonic where climbing is meant
// to be a decision, that moving an anchor moves everything downstream of it, and
// that it says out loud what it cannot say.
//
// A model that quietly scored an attribute at zero would report half the shop as
// overpriced and look certain about it, so "the model names everything it cannot
// price" is in here as an assertion and not a comment.

import { ANCHORS, ANCHOR, ANCHOR_DPS, ANCHOR_EHP, ANCHOR_FIGHT, WORTH, UNPRICED,
         worthTable, premiumAt, priceFor, hullPriceFor, capabilityOf, ammoPriceFor, feedBase,
         payFor, alienFor, claimedFight, earnRate, pressureOf,
         STAGES, STAGE_KEYS, stageDps, stageEhp, stageCost, buildFor, dpsOf, ehpOf, costOf,
         report, consumableReport, bestiaryReport, POSTING, DELIVERY_PREMIUM,
         ORE_RATE, TRIP, HOPS, TIERS, rung, addOf, kitWorth, deviceWorth, consumablePrice,
         freeMultipliers }
  from '../shared/balance.js';
import { EQUIPMENT, MAX_DRONES } from '../shared/gear.js';
import { HULLS, ATTRS, FIRE_RATE, resolve } from '../shared/ships.js';
import { AMMO } from '../shared/ammo.js';
import { ALIENS, WILD, bountyFor, xpFor, farmHp, effectiveHp, BOUNTY_RATE, XP_RATE } from '../shared/aliens.js';
import { KITS } from '../shared/repair.js';
import { DEVICES } from '../shared/devices.js';
import { GROUP_STEP } from '../shared/reward.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const f = (v, d = 2) => Number(v).toFixed(d);

console.log('\nthe anchors are read off the game, not chosen');
check('the reference pilot is the one the Drifter was written for',
  near(ANCHOR_FIGHT, 8.68, 1e-3) && ANCHOR.fit.weapon.length === 1 && ANCHOR.drones.length === 0,
  `a starter Hauler with one ${EQUIPMENT[ANCHOR.fit.weapon[0]].name} throws ${f(ANCHOR_DPS)} dps and takes ` +
  `${f(ANCHOR_FIGHT)}s over 650 ehp — aliens.js claims "~9s of unbroken fire"`);
check('every anchor recomputes from a price already on a shelf', (() => {
  return near(ANCHORS.base, EQUIPMENT.cellA.price / 120)
    && near(ANCHORS.trade, (EQUIPMENT.emitter1.price / 18) / (EQUIPMENT.cellA.price / 120) / FIRE_RATE)
    && near(ANCHORS.premium, 0.20, 1e-12)
    && near(ANCHORS.pressure, ALIENS.drifter.attrs.damage * ALIENS.drifter.attrs.fireRate / ANCHOR_EHP)
    && near(ANCHORS.payback, EQUIPMENT.collect1.price / (40 * ORE_RATE))
    && ANCHORS.bounty === BOUNTY_RATE && ANCHORS.xp === XP_RATE;
})(), `base ${f(ANCHORS.base)} cr/point, trade ${f(ANCHORS.trade, 4)} points per dps, ` +
      `premium +${f(ANCHORS.premium * 100, 0)}%/rung, pressure ${f(ANCHORS.pressure, 4)}/s, ` +
      `payback ${f(ANCHORS.payback, 1)} fills`);
check('the exchange rate between a gun and a shield is a duration, and it is about four seconds',
  ANCHORS.trade > 3 && ANCHORS.trade < 6,
  `the shop prices 1 dps at ${f(ANCHORS.trade)} points of hp — one exchange, which is why the two compare at all`);
check('the trip a consumable saves is measured from where the portals actually are',
  HOPS === 2 && TRIP > 40 && TRIP < 70,
  `${HOPS} hops from home to the frontier, ${f(TRIP, 1)}s one way at the reference pilot's speed`);

console.log('\ncredits per second of fight is your gun and nothing else');
// The identity the whole economy rests on: a bounty is farmHp x BOUNTY_RATE and a
// fight is farmHp / dps, so the alien cancels out entirely. It is why
// bounty-per-hit-point is a misleading anchor and why a consumable's fixed price
// stops meaning anything once your rack is large.
check('every hostile pays the same rate per second of fight, at every stage', (() => {
  for (const kind of WILD) for (const st of STAGE_KEYS) {
    const secs = farmHp(kind) / stageDps(st);
    if (!near(bountyFor(kind) / secs, stageDps(st) * ANCHORS.bounty, 1e-6)) return false;
  }
  return true;
})(), `5 hostiles x ${STAGE_KEYS.length} stages, all exactly dps x ${f(ANCHORS.bounty)} — ` +
      `${f(ANCHOR_DPS * ANCHORS.bounty)} cr/s at the anchor, ${Math.round(stageDps('finished') * ANCHORS.bounty)} at the ceiling`);
check('so a bounty and the fight it claims are one statement read two ways', (() => {
  for (const st of STAGE_KEYS) for (const party of [1, 2, 5]) for (const secs of [3, 15, 180]) {
    const a = alienFor({ stage: st, seconds: secs, party });
    if (!near(claimedFight(a.credits, { stage: st, party }), secs, 1e-9)) return false;
  }
  return true;
})(), 'round-tripped over every stage, three party sizes and three lengths');
check('a Corsair Hive is not the fight its bounty says it is',
  claimedFight(ALIENS.hive.bounty, { stage: 'finished', party: 4 }) < 20,
  `455,000 cr claims ${f(claimedFight(ALIENS.hive.bounty, { stage: 'finished', party: 4 }), 1)}s against four finished ships, ` +
  'and it has a five-minute respawn');

console.log('\nthe ladder climbs, and climbing is a decision');
check('a rung always costs more per point than the rung below', (() => {
  for (let t = 2; t <= TIERS; t++) if (premiumAt(t) <= premiumAt(t - 1)) return false;
  return true;
})(), [...Array(TIERS)].map((_, i) => Math.round(ANCHORS.base * premiumAt(i + 1))).join(' > ') + ' cr per point');
check('and the top rung costs a stated amount more, not an accidental one',
  near(premiumAt(TIERS), 1 + ANCHORS.premium * (TIERS - 1)),
  `x${f(premiumAt(TIERS))} across ${TIERS} rungs, which is the ammunition ladder's +${f(ANCHORS.premium * 100, 0)}% a grade`);
check('two modules of equal capability at the same tier cost exactly the same', (() => {
  for (let t = 1; t <= TIERS; t++) {
    const gun = priceFor([['damage', 'add', 400]], t).price;
    const cell = priceFor([['shield', 'add', 400 * WORTH.damage]], t).price;
    if (!near(gun, cell)) return false;
  }
  return true;
})(), `400 damage and ${400 * WORTH.damage} shield both price at ${Math.round(priceFor([['damage', 'add', 400]], TIERS).price)} cr at tier ${TIERS}`);
check('more of anything never costs less', (() => {
  for (const attr of Object.keys(WORTH)) {
    let last = -1;
    for (const v of [0, 1, 10, 100, 1000]) {
      const p = priceFor([[attr, 'add', v]], 3).price;
      if (p < last) return false;
      last = p;
    }
  }
  return true;
})(), `monotonic in all ${Object.keys(WORTH).length} priced attributes`);
check('and the same capability never gets cheaper further up the ladder', (() => {
  for (let t = 2; t <= TIERS; t++)
    if (priceFor([['damage', 'add', 50]], t).price <= priceFor([['damage', 'add', 50]], t - 1).price) return false;
  return true;
})());
check('a derived price is never negative, whatever it is handed', (() => {
  const attrs = Object.keys(ATTRS);
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 4000; i++) {
    const mods = [[attrs[Math.floor(rand() * attrs.length)], rand() < 0.5 ? 'add' : 'mul',
                   (rand() - 0.5) * 4000]];
    const p = priceFor(mods, 1 + Math.floor(rand() * TIERS)).price;
    if (!(p >= 0) || !Number.isFinite(p)) return false;
  }
  return true;
})(), '4000 random mod lists including negative values and unknown-to-the-model attributes');
check('a technology is worth what it multiplies, so it prices higher on a bigger hull',
  priceFor(EQUIPMENT.plating.mods, 1, { base: resolve('bulwark') }).price >
  priceFor(EQUIPMENT.plating.mods, 1, { base: resolve('hauler') }).price,
  `Composite Plating scores ${Math.round(priceFor(EQUIPMENT.plating.mods, 1, { base: resolve('hauler') }).price)} cr ` +
  `on a Hauler and ${Math.round(priceFor(EQUIPMENT.plating.mods, 1, { base: resolve('bulwark') }).price)} on a Bulwark — ` +
  'which is why the model states it prices against the reference pilot');

console.log('\nmoving an anchor moves everything downstream of it');
// A hold is the one thing priced in credits rather than in hit points: a unit of
// it carries ORE_RATE credits of ore, `payback` times over. Converting that into
// points means dividing by the base rate, so raising the base rate cannot make a
// Scavenger Rig dearer — it only changes how many points those credits buy. That
// is correct and it is worth having a test say so, because it looks like a bug.
// This used to split modules into "has cargo" and "does not" and demand each be
// exactly unchanged or exactly doubled. That held while nothing mixed the two, and
// the Refinery Bulkhead mixes them — cargo up, hull down — so its price is part
// credits and part hit points and lands honestly between. The claim was never
// really about cargo: it is that raising what a hit point costs raises the
// hit-point half of every price and touches nothing else.
// This used to split modules into "has cargo" and "does not" and demand each be
// exactly unchanged or exactly doubled, which held only while nothing mixed the
// two. The Refinery Bulkhead does — cargo up, hull DOWN — and its price falls when
// hit points get dearer, because the hit-point half of it is a subtraction. Both
// earlier attempts at this rule were wrong about that. Stated exactly: the ore
// half is fixed in credits and the hit-point half scales, whichever sign it has.
check('double the base rate and only the hit-point half of a price moves', (() => {
  const A = { ...ANCHORS, base: ANCHORS.base * 2 };
  for (const [, e] of Object.entries(EQUIPMENT)) {
    const a = priceFor(e.mods, e.tier ?? 1).price, b = priceFor(e.mods, e.tier ?? 1, { A }).price;
    if (!(a > 0)) continue;
    const ore = e.mods.filter(([at]) => at === 'cargo');
    const orePart = ore.length ? priceFor(ore, e.tier ?? 1).price : 0;
    if (!near(b, 2 * a - orePart, 1e-6)) return false;
  }
  return true;
})(), `all ${Object.keys(EQUIPMENT).length} modules — the collector rigs are pure ore and do not ` +
      'move, and a Refinery Bulkhead gets CHEAPER, because the hull it tears out costs more too');
check('flatten the premium and the ladder stops climbing, without anything going negative', (() => {
  const A = { ...ANCHORS, premium: 0 };
  const at = t => priceFor([['damage', 'add', 100]], t, { A }).price;
  for (let t = 2; t <= TIERS; t++) if (!near(at(t), at(1)) || at(t) < 0) return false;
  return true;
})(), 'premium 0 makes every rung the same price per point, which is the thing the premium exists to prevent');
check('halve the pressure and every hostile the model asks for is half as dangerous', (() => {
  const A = { ...ANCHORS, pressure: ANCHORS.pressure / 2 };
  for (const st of STAGE_KEYS) {
    const a = alienFor({ stage: st }), b = alienFor({ stage: st, A });
    if (!near(b.dps, a.dps / 2) || !near(b.farmHp, a.farmHp)) return false;
  }
  return true;
})(), 'and no tougher — the two halves of difficulty move independently, which is the point of having both');
check('move the bounty rate and the pay moves while the fight does not', (() => {
  const A = { ...ANCHORS, bounty: ANCHORS.bounty * 3 };
  const a = alienFor({ stage: 'fighter', seconds: 30 }), b = alienFor({ stage: 'fighter', seconds: 30, A });
  return near(b.credits, a.credits * 3) && near(b.farmHp, a.farmHp) && near(b.dps, a.dps);
})(), 'what a fight is and what it pays are separate decisions');

console.log('\nwhat a fight has to be');
check('a later stage always demands a tougher hostile', (() => {
  let last = -1;
  for (const st of STAGE_KEYS) { const v = alienFor({ stage: st, seconds: 20 }).farmHp; if (v < last) return false; last = v; }
  return true;
})(), STAGE_KEYS.map(s => Math.round(alienFor({ stage: s, seconds: 20 }).farmHp).toLocaleString('en-GB')).join(' > ') +
      ' effective hp x effort, for the same twenty seconds');
check('and a more dangerous one', (() => {
  let last = -1;
  for (const st of STAGE_KEYS) { const v = alienFor({ stage: st }).dps; if (v < last) return false; last = v; }
  return true;
})(), STAGE_KEYS.map(s => Math.round(alienFor({ stage: s }).dps)).join(' > ') + ' dps');
check('the first 900 credits buy damage and nothing else',
  stageDps('anchor') > stageDps('arrival') && stageEhp('anchor') === stageEhp('arrival'),
  `dps ${Math.round(stageDps('arrival'))} -> ${Math.round(stageDps('anchor'))}, effective hp unchanged at ${stageEhp('anchor')}`);
check('a hostile on model kills a pilot who stands still, and takes the same time to do it at every stage', (() => {
  for (const st of STAGE_KEYS) {
    const a = alienFor({ stage: st });
    if (!near(stageEhp(st) / a.dps, 1 / ANCHORS.pressure, 1e-9)) return false;
  }
  return true;
})(), `${f(1 / ANCHORS.pressure, 1)}s of doing nothing, whatever you fly — because pressure is a rate and not a share of the fight`);
check('the demand is never zero, negative or infinite', (() => {
  for (const st of STAGE_KEYS) for (const party of [1, 2, 10]) for (const secs of [0.5, 9, 600])
    for (const effort of [1, 3.8]) {
      const a = alienFor({ stage: st, seconds: secs, party, effort });
      for (const v of [a.farmHp, a.ehp, a.dps, a.credits, a.xp, a.perPilot])
        if (!(v > 0) || !Number.isFinite(v)) return false;
    }
  return true;
})(), '6 stages x 3 parties x 3 lengths x 2 efforts');
check('a longer fight is worth proportionally more, and not more than that',
  near(alienFor({ stage: 'fighter', seconds: 60 }).credits, alienFor({ stage: 'fighter', seconds: 20 }).credits * 3),
  'three times the seconds, three times the pay — a fight has no length bonus');
check('something you cannot hit is worth more than something you can, at the same hit points', (() => {
  const easy = alienFor({ stage: 'finished', seconds: 15, effort: 1 });
  const hard = alienFor({ stage: 'finished', seconds: 15, effort: 3.8 });
  return near(easy.credits, hard.credits) && hard.ehp < easy.ehp && near(easy.ehp / hard.ehp, 3.8);
})(), 'a Bandit needs 3.8x fewer hit points to be the same fight, and is paid for the fight');
check('company pays: four pilots each earn more per second of fight than a soloist does', (() => {
  const solo = alienFor({ stage: 'fighter', seconds: 30, party: 1 });
  const four = alienFor({ stage: 'fighter', seconds: 30, party: 4 });
  return near(four.perPilot / solo.credits, 1 + GROUP_STEP * 3);
})(), `x${f(1 + GROUP_STEP * 3)} each for the same thirty seconds of shooting — reward.js grows the pot rather than dividing it`);
check('and a hostile is no more dangerous for being fought by a party',
  near(alienFor({ stage: 'fighter', party: 1 }).dps, alienFor({ stage: 'fighter', party: 6 }).dps),
  'it shoots one pilot at a time, so what it must throw is set by that pilot — grouping is meant to be safer AND richer');

console.log('\nthe model against the game it was read from');
check('every hostile in the game already pays exactly what the model says',
  WILD.every(k => Math.round(payFor(farmHp(k)).credits) === bountyFor(k)),
  'because aliens.js already derives bounty from effective hp x effort — the model restates that rule, ' +
  'it does not add one: ' + WILD.map(k => `${ALIENS[k].name} ${bountyFor(k)}`).join(', '));
check('and exactly what it says in experience too',
  WILD.every(k => Math.round(payFor(farmHp(k)).xp) === xpFor(k)),
  WILD.map(k => `${ALIENS[k].name} ${xpFor(k)}`).join(', '));
check('the ammunition ladder comes back to the credit', (() => {
  for (const [k, a] of Object.entries(AMMO))
    if (!near(ammoPriceFor(a.mult, a.tier, { pack: a.pack, perPoint: feedBase(a.for) }).pack, a.price, 1e-9)) return false;
  return true;
})(), 'which proves nothing on its own: ANCHORS.premium was read off this ladder, so it had to');
check('but the emitter ladder was NOT read off, and lands inside a tenth anyway', (() => {
  const es = Object.values(EQUIPMENT).filter(e => e.slot === 'weapon' && e.kind === 'laser');
  return es.every(e => Math.abs(e.price / priceFor(e.mods, e.tier).price - 1) < 0.10);
})(), Object.values(EQUIPMENT).filter(e => e.slot === 'weapon' && e.kind === 'laser')
        .map(e => f(e.price / priceFor(e.mods, e.tier).price)).join(', ') +
      ' — five rungs of a ladder nobody derived, already on the ammunition ladder\'s premium');
check('and so does the launcher shelf, once the premium gear.js states is applied', (() => {
  const ps = Object.values(EQUIPMENT).filter(e => e.kind === 'rocket');
  return ps.every(e => Math.abs(e.price / priceFor(e.mods, e.tier, { premium: DELIVERY_PREMIUM }).price - 1) < 0.05);
})(), `x${DELIVERY_PREMIUM} for damage that lands: ` +
      Object.values(EQUIPMENT).filter(e => e.kind === 'rocket')
        .map(e => f(e.price / priceFor(e.mods, e.tier, { premium: DELIVERY_PREMIUM }).price)).join(', '));
check('a repair kit costs about what the trip it saves is worth to the pilot it was priced for', (() => {
  return Object.values(KITS).every(v => {
    const r = v.price / consumablePrice(kitWorth(v.heal, v.secs), v.tier);
    return r > 0.9 && r < 1.6;
  });
})(), Object.values(KITS).map(v => `${v.name} ${f(v.price / consumablePrice(kitWorth(v.heal, v.secs), v.tier))}`).join(', ') +
      ` — against ${f(TRIP, 0)}s home at ${f(earnRate())} cr/s`);
check('the same kit is worth two orders of magnitude more to a finished ship',
  earnRate(buildFor('finished')) / earnRate() > 100,
  `x${Math.round(earnRate(buildFor('finished')) / earnRate())}, because credits per second of fight is dps x ${f(ANCHORS.bounty)} — ` +
  'a fixed consumable price cannot stay a decision across a 256x span in dps');

console.log('\nthe model says out loud what it cannot say');
check('every attribute a ship has is either priced or named as unpriceable', (() => {
  const known = new Set([...Object.keys(WORTH), ...Object.keys(UNPRICED)]);
  return Object.keys(ATTRS).every(k => known.has(k));
})(), `${Object.keys(WORTH).length} priced, ${Object.keys(UNPRICED).length} named as gaps, ${Object.keys(ATTRS).length} attributes in all`);
check('and every gap says why, not just that', Object.values(UNPRICED).every(v => v.length > 40),
  Object.keys(UNPRICED).join(', '));
// The count used to be hard-coded at two, which was the Signal Damper's mod count
// on the day it was written. What matters is that a module the model cannot read
// says so and names every attribute it could not read, however many that is —
// silence scored as zero is the failure this guards against.
check('a module the model can read nothing on reports that, rather than reporting zero', (() => {
  const c = capabilityOf(EQUIPMENT.damper.mods);
  const attrs = EQUIPMENT.damper.mods.map(([a]) => a);
  return c.points === 0 && c.unpriced.length === attrs.length
      && attrs.every(a => c.unpriced.includes(a));
})(), `Signal Damper scores nothing and names all ${EQUIPMENT.damper.mods.length} of ` +
      `${EQUIPMENT.damper.mods.map(([a]) => a).join(', ')} as the reason`);
check('nothing that has a price is missing from the report', (() => {
  const seen = new Set([...report(), ...consumableReport(KITS, DEVICES)].map(r => r.key));
  return [...Object.keys(HULLS), ...Object.keys(EQUIPMENT), ...Object.keys(AMMO),
          ...Object.keys(KITS), ...Object.keys(DEVICES)].every(k => seen.has(k));
})(), `${report().length + consumableReport(KITS, DEVICES).length} rows covering every hull, module, grade, kit and device`);
check('and a hostile with no statement of intent is reported as unposted, not skipped', (() => {
  const rows = bestiaryReport();
  return rows.length === WILD.length && rows.every(r => r.unposted || POSTING[r.kind]);
})(), `${Object.keys(POSTING).length} of ${WILD.length} hostiles posted — ` +
      'server.js holds the real seeding and the two can drift, which is why an unposted one is loud');

check('and no module is a free multiplier, so the model never recommends cutting one',
  freeMultipliers().length === 0,
  'every technology in the game surrenders something — an upgrade nobody would decline has no ' +
  'decision left in it to charge a premium for, which is the one case where making the player ' +
  'smaller beats making the enemy bigger');
check('the anchors read their divisors off the shop entry, not off a number typed here',
  addOf('cellA', 'shield') === 120 && addOf('emitter1', 'damage') === 18 && addOf('collect1', 'cargo') === 40,
  'an A-Cell\'s 120 shield, an MK-I\'s 18 damage and a Scavenger Rig\'s 40 of hold — ' +
  'retype any of them into this file and the anchor silently stops tracking the game');

console.log('\nwhat the model currently says about the game (it reports, it does not correct)');
{
  const b = Object.fromEntries(bestiaryReport().map(r => [r.kind, r]));
  check('content effective hp has kept up with the player\'s gun',
    b.hive.haveFarmHp / b.drifter.haveFarmHp > 100,
    `content spans ${Math.round(effectiveHp('hive') / effectiveHp('drifter'))}x against a ` +
    `${Math.round(stageDps('finished') / stageDps('arrival'))}x span in player dps`);
  const dl = WILD.map(k => ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate);
  check('content dps has not kept up with the player\'s hull',
    Math.max(...dl) / Math.min(...dl) < stageEhp('finished') / stageEhp('arrival'),
    `${f(Math.max(...dl) / Math.min(...dl))}x of content dps against ${f(stageEhp('finished') / stageEhp('arrival'))}x of player ` +
    'effective hp — a fight has been getting safer for the whole game');
  check('the Bandit is the only hostile whose danger is within reach of its posting',
    b.bandit.dpsRatio > 0.6 && b.hive.dpsRatio < 0.5,
    `Bandit ${f(b.bandit.dpsRatio)}, Ironhusk ${f(b.ironhusk.dpsRatio)}, Leviathan ${f(b.leviathan.dpsRatio)}, ` +
    `Hive ${f(b.hive.dpsRatio)} of the dps its stage asks for`);
  check('and the Corsair Hive is the furthest thing in the game from what it claims to be',
    b.hive.hpRatio < 0.15,
    `${f(b.hive.actualFight, 1)}s against four finished ships, posted as ${b.hive.seconds}s — ` +
    `it needs x${f(1 / b.hive.hpRatio, 1)} the hit points and x${f(1 / b.hive.dpsRatio, 1)} the dps`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${Object.keys(ANCHORS).length} anchors, ${report().length + consumableReport(KITS, DEVICES).length} priced things, ${WILD.length} hostiles`}\n`);
process.exit(fails.length ? 1 : 0);
