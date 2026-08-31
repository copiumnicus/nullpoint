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
         STAGES, STAGE_KEYS, stageDps, stageEhp, stageHull, stageCost, buildFor, dpsOf, ehpOf, costOf,
         report, consumableReport, bestiaryReport, POSTING, DELIVERY_PREMIUM,
         ORE_RATE, TRIP, HOPS, TIERS, rung, addOf, kitWorth, deviceWorth, consumablePrice,
         freeMultipliers }
  from '../shared/balance.js';
import { EQUIPMENT, MAX_DRONES, deepOnly } from '../shared/gear.js';
import { HULLS, ATTRS, FIRE_RATE, resolve } from '../shared/ships.js';
import { AMMO } from '../shared/ammo.js';
import { threatDps } from '../shared/aliens.js';
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
    if (!near(ammoPriceFor(a.mult, a.tier,
      { pack: a.pack, perPoint: feedBase(a.for), reach: a.reach ?? 1 }).pack, a.price, 1e-9)) return false;
  return true;
})(), 'which proves nothing on its own: ANCHORS.premium was read off this ladder, so it had to. What it ' +
      'does prove is that the fourth grade is on the SAME ladder: it is priced per point of what the round ' +
      'carries, which is damage x reach, and that is the same number as damage for every grade before it');
// The shelf splits in two here, and the split is the finding rather than a
// tolerance somebody widened.
//
// Five rungs of the emitter ladder were priced against capability and land within a
// tenth of this model without anyone having derived them. The sixth does not, and it
// is 21 times it. That is not a mistake in either direction: it is the second price
// in the game denominated in what a pilot EARNS instead of in what things cost, and
// the first one — the deep berth's ten million — already wrote down why. By the deeps
// the shop has stopped being the constraint on anything: one of every hull, gun,
// generator and rig in the game comes to about 350,000, and a single Crucible banked
// at the counter it stands next to pays 1,474,596.
//
// So the claim is stated as the split, with both halves named. A future rung that
// quietly landed between the two would fail this, which is the point.
const DEEP_SHELF = k => deepOnly(k);
check('the shop\'s ladders are priced against capability, right up until the deeps', (() => {
  const es = Object.entries(EQUIPMENT).filter(([, e]) => e.slot === 'weapon' && e.kind === 'laser');
  return es.filter(([k]) => !DEEP_SHELF(k))
           .every(([, e]) => Math.abs(e.price / priceFor(e.mods, e.tier).price - 1) < 0.10);
})(), Object.entries(EQUIPMENT).filter(([, e]) => e.slot === 'weapon' && e.kind === 'laser')
        .map(([k, e]) => `${f(e.price / priceFor(e.mods, e.tier).price)}${DEEP_SHELF(k) ? '*' : ''}`).join(', ') +
      ' — five rungs of a ladder nobody derived, already on the ammunition ladder\'s premium. ' +
      '* is the deep rung, and it is not on this model at all');
check('and the deep rung is priced in deep-sector kills instead, which is a different currency and says so', (() => {
  const deep = Object.entries(EQUIPMENT).filter(([k, e]) => DEEP_SHELF(k) && e.slot === 'weapon');
  return deep.length > 0 && deep.every(([, e]) => e.price / priceFor(e.mods, e.tier).price > 10);
})(), Object.entries(EQUIPMENT).filter(([k]) => DEEP_SHELF(k))
        .map(([k, e]) => `${e.name} ${e.price.toLocaleString('en-US')} against a model ` +
                         `${Math.round(priceFor(e.mods, e.tier).price).toLocaleString('en-US')}, x${f(e.price / priceFor(e.mods, e.tier).price, 1)}`).join('; ') +
      ' — the deep berth broke the same way first and said so: by the deeps the shop has stopped being ' +
      'the constraint on anything');
check('and the launcher shelf still charges the premium gear.js states, over the emitter it shadows', (() => {
  const ps = Object.entries(EQUIPMENT).filter(([k, e]) => e.kind === 'rocket' && !DEEP_SHELF(k));
  return ps.every(([, e]) => Math.abs(e.price / priceFor(e.mods, e.tier, { premium: DELIVERY_PREMIUM }).price - 1) < 0.05);
})(), `x${DELIVERY_PREMIUM} for damage that lands: ` +
      Object.entries(EQUIPMENT).filter(([, e]) => e.kind === 'rocket')
        .map(([k, e]) => `${f(e.price / priceFor(e.mods, e.tier, { premium: DELIVERY_PREMIUM }).price)}${DEEP_SHELF(k) ? '*' : ''}`).join(', ') +
      ' — and the deep rack charges it over the deep GUN rather than over this model, ' +
      `${f(EQUIPMENT.pod4.price / EQUIPMENT.emitter6.price)} of it`);
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
  const c = capabilityOf(EQUIPMENT.walk.mods);
  const attrs = EQUIPMENT.walk.mods.map(([a]) => a);
  return c.points === 0 && c.unpriced.length === attrs.length
      && attrs.every(a => c.unpriced.includes(a));
})(), `Anchor Servos scores nothing and names all ${EQUIPMENT.walk.mods.length} of ` +
      `${EQUIPMENT.walk.mods.map(([a]) => a).join(', ')} as the reason`);
// The other half of the same rule, and the one the rebuilt shelf leans on hardest:
// a module the model can read ONE SIDE of has to say which side it missed, or a
// row that is half a gain and half an invisible cost reports as a bargain. Every
// technology on the shelf is now a trade with a felt cost, and for several of them
// the cost is exactly the kind of thing UNPRICED lists.
check('and a module the model can read only half of names the half it could not', (() => {
  const c = capabilityOf(EQUIPMENT.plating.mods);
  return c.points > 0 && c.unpriced.length === 1 && c.unpriced[0] === 'speed';
})(), `Composite Plating scores ${Math.round(capabilityOf(EQUIPMENT.plating.mods).points)} points of hull and ` +
      'reports `speed` as the part it cannot see — so the report says "this row is incomplete" rather than ' +
      '"this row is cheap"');
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
  // Rewritten rather than deleted, per rule five: the claim is the same claim and
  // still fails the moment content guns fall behind. What changed under it is that
  // the game now holds a hostile with NO gun, and dividing by its zero sent this
  // ratio to Infinity — failing a claim about a trend it is deliberately not part
  // of. A Lamprey takes a share instead of an amount, which is an answer to this
  // complaint rather than another instance of it, so it is measured by the claim
  // underneath.
  const armed = WILD.filter(k => ALIENS[k].attrs.damage > 0);
  const dl = armed.map(k => ALIENS[k].attrs.damage * ALIENS[k].attrs.fireRate);
  // REWRITTEN, and it is the good kind: this claim was "content dps has NOT kept up
  // with the player's hull", and it is no longer true. It had been true for the whole
  // life of the game — armed hostiles spanned 5.2x against 6.4x of player effective
  // hit points, so every fight got quietly safer the further out you went, and the
  // two hostiles with no gun at all existed to say so.
  //
  // The deeps closed it. A Crucible and a Doldrum both throw 438 dps, which is not a
  // chosen number: it is ANCHORS.pressure x stageEhp('finished'), the model's own
  // answer to "what must a hostile at that stage throw". Putting the model's number
  // on the two hostiles at the top of the ladder is exactly what the gap was asking
  // for, and the span closed to the hull span to two decimal places.
  //
  // So the claim inverts rather than being deleted, and it is now a claim that can
  // fail in the other direction — if content guns ever run AHEAD of the hulls they
  // are shot at, a fight starts getting harder for the whole game instead, which is
  // the same bug with the sign flipped.
  check('content dps has caught up with the player\'s hull, and does not lead it',
    Math.max(...dl) / Math.min(...dl) <= stageEhp('finished') / stageEhp('arrival') * 1.02,
    `${f(Math.max(...dl) / Math.min(...dl))}x across the ${armed.length} armed hostiles against ` +
    `${f(stageEhp('finished') / stageEhp('arrival'))}x of player effective hp — it was 5.2 against 6.4, ` +
    'and the two hostiles in the deeps are what closed it: their guns ARE the model\'s own number');
  // Two hostiles have no gun now, and they are the answer to the line above rather
  // than exceptions to it: a Lamprey drinks a share of your hull and a Censer burns
  // a share of everything you have, so the seconds each needs are FLAT across the
  // whole ladder while an armed hostile's are a curve. That is the entire reason
  // they exist, and it is why threatDps had to stop being damage x fireRate.
  check('the hostiles without guns are the ones whose danger cannot decay', (() => {
    const gunless = WILD.filter(k => ALIENS[k].attrs.damage === 0);
    if (gunless.length < 1) return false;
    // Flat: the seconds it needs are the same at the bottom of the ladder and the
    // top, because both the threat and the pool it eats are shares of the pilot.
    // Each measured against the pool it actually eats. A Censer burns everything
    // standing in it, shields included; a Lamprey goes straight past the shield to
    // the hull. Measuring a tether against effective hit points would read 74-110s
    // and call it a curve, when what varies is the shield it never touches.
    const pool = (k, st) => ALIENS[k].siphon ? stageHull(st) : stageEhp(st);
    const flat = gunless.every(k => {
      const secs = STAGE_KEYS.map(st => pool(k, st) / threatDps(k, stageEhp(st), stageHull(st)));
      return Math.max(...secs) / Math.min(...secs) < 1.05;
    });
    // Against a Drifter, whose flat number is only ever true at one stage.
    const gun = STAGE_KEYS.map(st => stageEhp(st) / (ALIENS.drifter.attrs.damage * ALIENS.drifter.attrs.fireRate));
    return flat && Math.max(...gun) / Math.min(...gun) > 4;
  })(), (() => {
    const gunless = WILD.filter(k => ALIENS[k].attrs.damage === 0);
    const pool = (k, st) => ALIENS[k].siphon ? stageHull(st) : stageEhp(st);
    const span = k => {
      const secs = STAGE_KEYS.map(st => pool(k, st) / threatDps(k, stageEhp(st), stageHull(st)));
      return `${ALIENS[k].name} ${Math.min(...secs).toFixed(1)}-${Math.max(...secs).toFixed(1)}s`;
    };
    const gun = STAGE_KEYS.map(st => stageEhp(st) / (ALIENS.drifter.attrs.damage * ALIENS.drifter.attrs.fireRate));
    return `${gunless.map(span).join(', ')} across every stage, against a Drifter's ` +
           `${Math.min(...gun).toFixed(0)}-${Math.max(...gun).toFixed(0)}s`;
  })());

  // It used to be the Bandit alone, and it is now second. A Censer's rate IS
  // ANCHORS.pressure rather than an approximation of it, so its ratio is 1.000 at
  // every stage by construction — the only thing in the bestiary that is on model
  // on both halves at once.
  //
  // The Hive's row moved from 0.04 to 7.72 and NOTHING ABOUT THE HIVE CHANGED.
  // threatDps used to read damage x fireRate and stop, so a mothership was a 110
  // dps hostile in this model while twelve Bandits sat around it throwing 2,340 —
  // the top of the ladder reported as the safest thing in the bestiary. It now
  // counts the brood, and a mirror's chamber, for the same reason: what a hostile
  // does to you is what it does to you, whatever shape it arrives in.
  //
  // Rewritten, not re-thresholded. `bandit > 0.6` was a reading of the shipped
  // Bulwark taken at 0.615 — a point and a half of margin — and the hull rework
  // moved it by making the last hull tougher: a third generator bay and a second
  // technology bay take stageEhp('finished') from 7,050 to 9,305, so the model asks
  // everything posted there for a third more dps and not one of their guns moved.
  // The claim underneath was always the one worth keeping, so it is the one stated
  // now: a dps DERIVED from this model tracks it for free and a dps somebody typed
  // goes stale the moment the ladder under it moves. A Censer's rate IS
  // ANCHORS.pressure and a Kedge's is pressure x its own stage, so both read 1.00 by
  // construction and both followed the rework without being touched; the Bandit's
  // 150 x 1.3 is a written number and fell from 0.61 to 0.47 on the same change.
  //
  // AND THE SIXTH RUNG SENT THE BILL AGAIN, harder than the hull rework did. The
  // shop's ceiling went from 11,306 dps to 19,673 in one commit, so the model asks
  // everything posted at `finished` for x1.74 the dps it asked for yesterday — and
  // not one gun in the bestiary moved. The two DERIVED guns still read 1.00, because
  // they are expressions rather than numbers; every typed one fell again. Measured
  // across the three changes the Bandit has now read 0.61, then 0.47, then 0.27.
  //
  // The Hive's threshold moves with it rather than the claim being dropped: "still
  // throws several stages' worth" is the sentence, and several is 3 now where it was
  // 5, because the stage it is measured against grew and the mothership did not.
  const DERIVED = ['censer', 'kedge'], TYPED = ['ironhusk', 'leviathan', 'bandit'];
  check('a derived gun follows the ladder for free, a typed one goes stale, and a mothership still throws several stages\' worth',
    DERIVED.every(k => b[k].dpsRatio > 0.99 && b[k].dpsRatio < 1.01) &&
    TYPED.every(k => b[k].dpsRatio < 0.9) && b.hive.dpsRatio > 3,
    `Censer ${f(b.censer.dpsRatio)}, Kedge ${f(b.kedge.dpsRatio)}, Ironhusk ${f(b.ironhusk.dpsRatio)}, ` +
    `Leviathan ${f(b.leviathan.dpsRatio)}, Bandit ${f(b.bandit.dpsRatio)}, Hive ${f(b.hive.dpsRatio)} ` +
    'of the dps its stage asks for — the Bandit read 0.61 before the last hull gained a generator ' +
    'and a technology bay, 0.47 after it, and 0.27 once the shop grew a sixth emitter: three reworks, ' +
    'three bills, and the two derived guns paid none of them');
  check('and the Corsair Hive is the furthest thing in the game from what it claims to be',
    b.hive.hpRatio < 0.15 && b.hive.dpsRatio > 3,
    `${f(b.hive.actualFight, 1)}s against four finished ships, posted as ${b.hive.seconds}s — ` +
    `it needs x${f(1 / b.hive.hpRatio, 1)} the hit points it has, and throws x${f(b.hive.dpsRatio, 1)} ` +
    'the dps: a fight that is over far too quickly and hurts far too much while it lasts. The gap ' +
    'widened on the hit points and narrowed on the dps when the shop grew a sixth rung, which is one ' +
    'change moving a row in two directions at once and is exactly what this report is for reading');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${Object.keys(ANCHORS).length} anchors, ${report().length + consumableReport(KITS, DEVICES).length} priced things, ${WILD.length} hostiles`}\n`);
process.exit(fails.length ? 1 : 0);
