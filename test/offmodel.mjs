// What the game charges against what shared/balance.js says it should.
//
//     node test/offmodel.mjs            everything, biggest deviation first
//     node test/offmodel.mjs --order    everything, in shelf order
//
// This script changes nothing. It is here so that "is this price off?" is a
// question with an answer rather than an argument, and so the next thing added to
// the game has somewhere to check itself against before it ships.

import { report, consumableReport, bestiaryReport, alienFor, claimedFight,
         ANCHORS, ANCHOR, ANCHOR_DPS, ANCHOR_EHP, ANCHOR_FIGHT, WORTH, UNPRICED,
         STAGES, STAGE_KEYS, stageDps, stageEhp, stageCost, earnRate,
         ORE_RATE, TRIP, HOPS, CROSSING, ROUTE, DELIVERY_PREMIUM, premiumAt,
         TIERS, dpsOf, buildFor, freeMultipliers } from '../shared/balance.js';
import { KITS } from '../shared/repair.js';
import { DEVICES } from '../shared/devices.js';
import { ALIENS } from '../shared/aliens.js';
import { dronePrice, EQUIPMENT, MAX_DRONES } from '../shared/gear.js';

const byOrder = process.argv.includes('--order');
const n = (v, d = 0) => v == null ? '—' : v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
const pad = (s, w) => String(s).padEnd(w);
const rpad = (s, w) => String(s).padStart(w);
const bar = c => '\n' + c.repeat(78);

console.log(bar('='));
console.log('THE ANCHORS');
console.log(bar('='));
console.log(`  the reference pilot   a ${ANCHOR.hull} with one ${EQUIPMENT[ANCHOR.fit.weapon[0]].name}, weapons routed`);
console.log(`                        ${n(ANCHOR_DPS, 2)} dps, ${n(ANCHOR_EHP)} effective hp, ${n(900)} cr`);
console.log(`  the anchor fight      ${n(ANCHOR_FIGHT, 2)}s over a Drifter's 650 ehp  ->  ${n(455 / ANCHOR_FIGHT, 2)} cr per second of fight`);
console.log('');
for (const [name, val, dp, what, from] of [
  ['bounty',   ANCHORS.bounty,   4, 'cr per point of effective hp x effort',  'aliens.js'],
  ['xp',       ANCHORS.xp,       4, 'xp per the same',                       'aliens.js'],
  ['base',     ANCHORS.base,     2, 'cr per point of capability at tier 1',   'the A-Cell: 1200 cr for 120 shield'],
  ['trade',    ANCHORS.trade,    4, 'points of hp per point of dps',          'the MK-I against the A-Cell'],
  ['premium',  ANCHORS.premium,  4, 'more per point, per rung of any ladder', 'the ammunition ladder'],
  ['pressure', ANCHORS.pressure, 4, 'of your effective hp taken per second',  'the Drifter on the anchor'],
  ['payback',  ANCHORS.payback,  2, 'hold-fills a cargo module is priced at', 'the Scavenger Rig'],
]) console.log(`  ${pad(name, 10)}${pad(n(val, dp), 10)}${pad(what, 41)}(${from})`);
console.log('');
console.log(`  derived   ore ${n(ORE_RATE, 2)} cr per unit of hold · a hop is ${n(CROSSING)}px · ${HOPS} hops home (${ROUTE.join('>')}) = ${n(TRIP, 1)}s`);
console.log(`            a point of damage is worth ${n(WORTH.damage, 2)} points of hp; a unit of hold ${n(WORTH.cargo, 2)}`);
console.log(`            the rungs cost ${[...Array(TIERS)].map((_, i) => n(ANCHORS.base * premiumAt(i + 1), 0)).join(' > ')} cr per point`);
console.log(`            stand still and anything on model kills you in ${n(1 / ANCHORS.pressure, 1)}s`);

console.log(bar('='));
console.log('THE LADDER A PILOT CLIMBS');
console.log(bar('='));
console.log(`  ${pad('stage', 13)}${rpad('dps', 8)}${rpad('ehp', 8)}${rpad('cost', 10)}${rpad('cr/s', 9)}${rpad('needs dps', 11)}   what it is`);
for (const k of STAGE_KEYS) {
  const d = stageDps(k), e = stageEhp(k);
  console.log(`  ${pad(k, 13)}${rpad(n(d), 8)}${rpad(n(e), 8)}${rpad(n(stageCost(k)), 10)}${rpad(n(earnRate(buildFor(k))), 9)}` +
              `${rpad(n(ANCHORS.pressure * e), 11)}   ${STAGES[k].note}`);
}
{
  const a = STAGE_KEYS[0], z = STAGE_KEYS.at(-1);
  console.log(`\n  player dps spans ${n(stageDps(z) / stageDps(a))}x, effective hp ${n(stageEhp(z) / stageEhp(a), 2)}x, ` +
              `and the top grade of ammunition adds another ${n(dpsOf(buildFor(z), { ammo: 'cell3', head: 'head3' }) / stageDps(z), 2)}x.`);
  const dl = Object.values(ALIENS).filter(x => !x.dev).map(x => x.attrs.damage * x.attrs.fireRate);
  const hl = Object.values(ALIENS).filter(x => !x.dev).map(x => x.attrs.hull + x.attrs.shield);
  console.log(`  content effective hp spans ${n(Math.max(...hl) / Math.min(...hl))}x — it has kept up.`);
  console.log(`  content dps spans ${n(Math.max(...dl) / Math.min(...dl), 2)}x against a ${n(stageEhp(z) / stageEhp(a), 2)}x span in player ` +
              `effective hp — it has not.`);
}

console.log(bar('='));
console.log('WHAT THE HOSTILES SHOULD BE   (the half that decides whether a fight is a fight)');
console.log(bar('='));
console.log(`  ${pad('hostile', 15)}${pad('posted', 13)}${rpad('want', 6)}${rpad('is', 7)}` +
            `${rpad('ehp x effort', 14)}${rpad('want', 12)}${rpad('x', 7)}${rpad('dps', 6)}${rpad('want', 6)}${rpad('x', 7)}`);
for (const b of bestiaryReport().sort((x, y) => (x.hpRatio ?? 9) - (y.hpRatio ?? 9))) {
  if (b.unposted) { console.log(`  ${pad(b.name, 15)}NOT POSTED — the model has no statement of intent for it`); continue; }
  console.log(`  ${pad(b.name, 15)}${pad(b.stage, 13)}${rpad(n(b.seconds) + 's', 6)}${rpad(n(b.actualFight, 1) + 's', 7)}` +
              `${rpad(n(b.haveFarmHp), 14)}${rpad(n(b.wantFarmHp), 12)}${rpad(n(b.hpRatio, 2), 7)}` +
              `${rpad(n(b.haveDps), 6)}${rpad(n(b.wantDps), 6)}${rpad(n(b.dpsRatio, 2), 7)}`);
}
console.log('');
for (const b of bestiaryReport()) {
  if (b.unposted) continue;
  console.log(`  ${pad(b.name, 15)}${b.why}`);
}
console.log('');
console.log('  Read the two x columns as: how much of the fight it is, and how much of the danger.');
console.log('  A bounty read backwards says the same thing — what fight is this number claiming to be?');
for (const b of bestiaryReport()) {
  if (b.unposted) continue;
  console.log(`  ${pad(b.name, 15)}${rpad(n(b.haveBounty), 8)} cr claims ` +
              `${rpad(n(claimedFight(b.haveBounty, { stage: b.stage, party: b.party }), 1) + 's', 7)} against ${b.party} x ${b.stage}` +
              `, and is posted as a ${n(b.seconds)}s fight`);
}

console.log(bar('-'));
console.log('  WHAT TO DO ABOUT IT — scale the content up, not the player down');
console.log(bar('-'));
console.log('  The player curve is not the problem: becoming 256x stronger is fine so long as');
console.log('  what you point it at grows with you. Every line below raises a hostile; none of');
console.log('  them touches a ship. Effort is left where it is — a thing that is hard to hit is');
console.log('  a different lever from a thing that is hard to kill, and only the Bandit uses it.');
console.log('');
for (const b of bestiaryReport().sort((x, y) => (x.hpRatio ?? 9) - (y.hpRatio ?? 9))) {
  if (b.unposted || (Math.abs(b.hpRatio - 1) < 0.1 && Math.abs(b.dpsRatio - 1) < 0.1)) continue;
  const hull = Math.round(b.wantFarmHp / b.effort * (ALIENS[b.kind].attrs.hull / (ALIENS[b.kind].attrs.hull + ALIENS[b.kind].attrs.shield)));
  const shield = Math.round(b.wantFarmHp / b.effort) - hull;
  console.log(`  ${pad(b.name, 15)}${n(ALIENS[b.kind].attrs.hull)} hull + ${n(ALIENS[b.kind].attrs.shield)} shield -> ` +
              `${n(hull)} + ${n(shield)}   (x${n(b.wantFarmHp / b.haveFarmHp, 1)}), and ${n(b.haveDps)} dps -> ${n(b.wantDps)}  (x${n(1 / b.dpsRatio, 2)})`);
  console.log(`  ${pad('', 15)}bounty ${n(b.haveBounty)} -> ${n(b.wantBounty)}, which needs no decision: it is ` +
              `ehp x effort x ${n(ANCHORS.bounty, 2)} and moves on its own`);
}
console.log('');
console.log('  The one number here that is a judgement rather than arithmetic is the fight');
console.log('  length each hostile is posted at. Change those and every figure above moves.');
console.log('');
{
  const free = freeMultipliers();
  console.log('  The other direction — making a player smaller — is only ever right for a module');
  console.log('  that is strictly better than not having it, because there is no decision left in');
  console.log('  it to charge for. Scanning the shop for one:');
  console.log(free.length
    ? `    ${free.map(x => x.name).join(', ')} — multiplies something and surrenders nothing.`
    : '    none. Every technology in the game already gives something up, so there is');
  if (!free.length) console.log('    nothing here the model would recommend cutting.');
}

console.log(bar('='));
console.log('WHAT THE SHOP CHARGES');
console.log(bar('='));
const rows = report();
// A row the model could score nothing at all on is not a deviation, it is a hole.
// Printing it as 0 and a dash would read as "should be free", which is the one
// thing it does not mean.
const blind = r => r.model === 0 && r.unpriced?.length;
const show = list => {
  for (const r of list) {
    const flag = r.anchor ? ' (anchor)' : '';
    const un = r.unpriced?.length ? `  unpriced: ${r.unpriced.join(', ')}` : '';
    const model = blind(r) ? 'no reading' : n(r.model);
    console.log(`  ${pad(r.name, 20)}${rpad(n(r.actual), 9)}${rpad(model, 10)}${rpad(r.ratio == null ? '—' : n(r.ratio, 2), 8)}` +
                `  ${r.note || ''}${flag}${un}`);
  }
};
if (byOrder) {
  for (const g of [...new Set(rows.map(r => r.group))]) {
    console.log(`\n  ${g.toUpperCase()}   ${pad('', 14)}${rpad('charges', 4)}${rpad('model', 10)}${rpad('ratio', 8)}`);
    show(rows.filter(r => r.group === g));
  }
} else {
  console.log(`  ${pad('', 20)}${rpad('charges', 9)}${rpad('model', 10)}${rpad('ratio', 8)}`);
  const off = r => (r.ratio == null || blind(r)) ? -1 : Math.abs(Math.log(r.ratio || 1));
  show([...rows].sort((a, b) => off(b) - off(a)));
}

console.log(bar('-'));
console.log('  CONSUMABLES — priced in saved seconds, not capability');
console.log(bar('-'));
console.log(`  ${pad('', 20)}${rpad('charges', 9)}${rpad('model', 10)}${rpad('ratio', 8)}`);
show(consumableReport(KITS, DEVICES));
console.log(`\n  All four are worth what the trip they save is worth to the reference pilot,`);
console.log(`  plus 11% to 50%. They are also worth ${n(earnRate(buildFor('finished')) / earnRate(), 0)}x more to a finished ship than to`);
console.log(`  the pilot they were priced for, because credits per second of fight is dps x ${n(ANCHORS.bounty, 2)}.`);

console.log(bar('-'));
console.log('  DRONE BAYS — not priced by this model');
console.log(bar('-'));
console.log('  A bay carries no stats. It is the right to fit one more module, sold on a');
console.log('  deliberately escalating curve so an escort has a size rather than a budget.');
console.log(`  The model has no term for a slot: all four hulls carry the same seven, which is`);
console.log('  ships.js\'s stated point, so slots cannot be what separates their prices either.');
for (const i of [0, 5, MAX_DRONES - 1])
  console.log(`    bay ${rpad(i + 1, 2)}  ${rpad(n(dronePrice(i)), 7)} cr  =  ${n(dronePrice(i) / EQUIPMENT.emitter1.price, 2)}x an MK-I, ` +
              `${n(dronePrice(i) / EQUIPMENT.emitter5.price, 2)}x an MK-V`);

console.log(bar('-'));
console.log('  WHAT THE MODEL CANNOT SAY');
console.log(bar('-'));
for (const [k, why] of Object.entries(UNPRICED)) console.log(`  ${pad(k, 13)}${why.replace(/\s+/g, ' ')}`);
console.log('');
console.log('  So: every generator row above is its SHIELD priced against its price. The');
console.log('  capacitor, recharge, free trickle and reactor headroom it also buys are not in');
console.log('  the number, and the speed it costs you is not either. A generator reading 1.6');
console.log('  is not evidence that it is overpriced — it is evidence that most of what a');
console.log('  generator is cannot yet be converted into hit points.');

console.log(bar('='));
console.log('ADDING SOMETHING NEW');
console.log(bar('='));
console.log('  A hostile for a fighter-stage party of three, meant to last a minute:');
{
  const a = alienFor({ stage: 'fighter', seconds: 60, party: 3 });
  console.log(`    ${n(a.ehp)} effective hp, ${n(a.dps)} dps, ${n(a.credits)} cr, ${n(a.xp)} xp`);
  console.log(`    ${n(a.perPilot)} cr each — ${n(a.perPilot / (a.credits / a.party), 2)}x what the same fight pays a soloist, because the pot grows`);
  const e = alienFor({ stage: 'fighter', seconds: 60, party: 3, effort: 3.8 });
  console.log(`    the same fight from something that dodges like a Bandit: ${n(e.ehp)} ehp for the same pay`);
}
console.log('\n  A tier-4 emitter that adds 300 damage:');
console.log(`    ${n(300 * WORTH.damage * ANCHORS.base * premiumAt(4))} cr`);
console.log('  A tier-2 generator that adds 250 shield:');
console.log(`    ${n(250 * ANCHORS.base * premiumAt(2))} cr  (before whatever its capacitor is worth, which the model cannot say)`);
console.log('  A tier-2 launcher throwing a 400-point volley:');
console.log(`    ${n(400 * WORTH.rocketVolley * ANCHORS.base * premiumAt(2) * DELIVERY_PREMIUM)} cr  (including the x${DELIVERY_PREMIUM} the racks already charge)`);
console.log('');
