import { MATERIALS, DROPS, rollDrop, stow, unload, holdVol, holdValue, volOf,
         POD_LIFE, SCOOP_R, SCOOP_TIME, CURRENCY,
         oreRung, husk, ORE_RATE, BASE_HP, TOP_RUNG } from '../shared/cargo.js';
import { beginScoop, stepScoop, approachPod, load, rigAt, DWELL, pullTime,
         droneSpeed, DRONE_SPEED_MULT } from '../shared/cargo.js';
import { EQUIPMENT, sanitiseDrones, sanitiseRig, collectorReach, isCollector } from '../shared/gear.js';
import { WILD, ALIENS, effectiveHp } from '../shared/aliens.js';
import { newShip, escortOf } from '../shared/sim.js';
import { HULLS, ATTRS, resolve } from '../shared/ships.js';
import { rng } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

console.log('\nmaterials');
const tiers = Object.values(MATERIALS).map(m => m.tier);
check('tiers are 1..n with no gaps or repeats',
  JSON.stringify([...tiers].sort()) === JSON.stringify(tiers.map((_, i) => i + 1)));
const byTier = Object.values(MATERIALS).sort((a, b) => a.tier - b.tier);
check('value climbs with rarity', byTier.every((m, i) => i === 0 || m.value > byTier[i - 1].value),
  byTier.map(m => m.value).join(' < '));
check('value per unit of hold climbs with rarity — the real reason to haul it',
  byTier.every((m, i) => i === 0 || m.value / m.vol > byTier[i - 1].value / byTier[i - 1].vol),
  byTier.map(m => (m.value / m.vol).toFixed(0)).join(' < ') + ' cr per volume');
check('volume tracks real density: denser metal, less room for the same mass',
  (() => {                                        // rank by density, check vol ranks inversely
    const byDen = Object.values(MATERIALS).slice().sort((a, b) => a.density - b.density);
    return byDen.every((m, i) => i === 0 || m.vol <= byDen[i - 1].vol);
  })(), `Fe ${MATERIALS.iron.density} -> ${volOf('iron')} vol, Ir ${MATERIALS.iridium.density} -> ${volOf('iridium')} vol`);
check('every metal is a real element with a symbol',
  Object.values(MATERIALS).every(m => /^[A-Z][a-z]?$/.test(m.sym) && m.density > 0));
check('every material carries a colour', Object.values(MATERIALS).every(m => /^#[0-9a-f]{6}$/i.test(m.colour)));

console.log('\ndrop tables');
for (const [kind, table] of Object.entries(DROPS)) {
  const sum = table.reduce((s, r) => s + r.p, 0);
  check(`${kind} weights sum to 1`, Math.abs(sum - 1) < 1e-9, sum.toFixed(4));
  check(`${kind} lists only real materials`, table.every(r => MATERIALS[r.mat]));
  const t = table.map(r => MATERIALS[r.mat].tier);
  check(`${kind} gets rarer as the tier climbs`,
    table.every((r, i) => i === 0 || r.p < table[i - 1].p) && t.every((v, i) => i === 0 || v > t[i - 1]));
}
// The Ironhusk shipped with no table and paid nothing but its bounty. rollDrop
// reads a missing kind as "drops nothing", so this fails loudly rather than
// quietly the next time an alien is added.
check('every alien in the wild drops something', WILD.every(k => DROPS[k]),
  WILD.map(k => `${k} ${DROPS[k] ? 'from ' + DROPS[k][0].mat : 'NOTHING'}`).join(', '));

// This used to read "a bigger husk drops more of the same, not rarer", and it was
// the bug: a Bandit paid out in 72 units of iron, 216 volume of the cheapest metal
// in the game, for the hardest fight outside a boss. The composition DOES change
// with the payroll now, and it changes by a stated rule rather than by taste.
{
  const worstPod = t => Math.max(...t.map(r => r.max * MATERIALS[r.mat].vol));
  const oreOf    = t => t.reduce((s, r) => s + r.p * ((r.min + r.max) / 2) * MATERIALS[r.mat].value, 0);
  // The hold of a pilot who has any business being in that sector.
  const HOLD = { drifter: 60, harrier: 60, ironhusk: 100, lamprey: 100, bandit: 240, leviathan: 240,
                 thresher: 240, hive: 240, lamprey: 100, censer: 100, kedge: 240,
                 // The deeps. A pilot with any business four hops out is flying the
                 // same Ore Tender they took to a gate, so the ceiling is the same 240
                 // — which is the point of this row: it is the hold of the PILOT, not a
                 // property of the hostile, and it stops climbing once the hold does.
                 crucible: 240, doldrum: 240 };

  for (const k of WILD) {
    const ehp = effectiveHp(k), rung = oreRung(ehp), t = DROPS[k];
    console.log(`     ${k.padEnd(10)} ${String(ehp).padStart(6)} ehp  rung ${rung} ` +
      `${t[0].mat.padEnd(9)} worst pod ${String(worstPod(t)).padStart(3)} of ${HOLD[k]}  ` +
      `ore ${oreOf(t).toFixed(0).padStart(5)} cr`);
  }
  check('what a hostile drops starts where its toughness says it does',
    WILD.every(k => MATERIALS[DROPS[k][0].mat].tier === oreRung(effectiveHp(k))),
    'rung = 1 + round(2 x log10(ehp / 650)) — two metal rungs per hostile rung');
  check('nothing at the frontier pays out in iron',
    !DROPS.bandit.some(r => r.mat === 'iron') && !DROPS.leviathan.some(r => r.mat === 'iron'),
    `a Bandit drops ${DROPS.bandit[0].mat} and up, worst pod ${worstPod(DROPS.bandit)} volume — it was 216 of iron`);
  check('a pod always fits the hold of a pilot equipped to be there',
    WILD.every(k => worstPod(DROPS[k]) <= HOLD[k]),
    WILD.map(k => `${k} ${worstPod(DROPS[k])}/${HOLD[k]}`).join('  '));
  // Which hostiles the VALUE target binds on and which the HOLD binds on is read off
  // the two rules now rather than listed by hand. The list had to be edited every time
  // a hostile was added, which is a test quietly ceasing to cover the thing it was
  // written for — it named nine of ten, and would have named nine of twelve.
  const capped = k => worstPod(DROPS[k]) >= HOLD[k];
  check('ore is about a fifth of the kill, until the hold stops it',
    WILD.filter(k => !capped(k))
      .every(k => oreOf(DROPS[k]) > ORE_RATE * effectiveHp(k) * 0.75
               && oreOf(DROPS[k]) < ORE_RATE * effectiveHp(k) * 1.25),
    `at ${ORE_RATE} cr per ehp across ${WILD.filter(k => !capped(k)).length} hostiles — ` +
    `${WILD.filter(capped).join(', ')} are exempt because six Ore Tenders of platinum is not a reward`);
  // REWRITTEN, not deleted. It named the Hive because the Hive was the only thing the
  // ceiling bound on; three hostiles are past that line now and the claim is the same
  // one — above a certain rung the value target stops being a reward and starts being
  // a second trip, so everything up there pays one full hold and keeps the rest in the
  // bounty, where a party splits it without anybody ferrying.
  check('past a certain rung the hold binds instead, and the rest stays in the bounty',
    WILD.filter(capped).length >= 3 &&
    WILD.filter(capped).every(k => worstPod(DROPS[k]) === HOLD[k]
                                && oreOf(DROPS[k]) < ORE_RATE * effectiveHp(k)) &&
    // and it binds from the TOP down: nothing capped may be easier than anything not
    WILD.filter(capped).every(k => WILD.filter(j => !capped(j))
      .every(j => effectiveHp(k) > effectiveHp(j))),
    WILD.filter(capped).map(k =>
      `${k} keeps ${Math.round(ORE_RATE * effectiveHp(k) - oreOf(DROPS[k])).toLocaleString()} cr in the bounty`)
      .join(', '));
  check('the rung never runs off the end of the metals',
    oreRung(1e12) === TOP_RUNG && oreRung(1) === 1 && oreRung(BASE_HP) === 1,
    'clamped at platinum — a table with one row left is a fixed drop, not a table');
  check('a table that starts higher up still sums to 1',
    [1, 2, 3, 4, 5].every(r => Math.abs(husk(r, 1).reduce((s, x) => s + x.p, 0) - 1) < 1e-9),
    'renormalised — rollDrop walks the weights and falls off the end otherwise');
}

{
  const rand = rng(9), tally = {};
  for (let i = 0; i < 40000; i++) { const d = rollDrop('drifter', rand); tally[d.mat] = (tally[d.mat] ?? 0) + 1; }
  const rows = DROPS.drifter.map(r => [r.mat, r.p, (tally[r.mat] ?? 0) / 40000]);
  rows.forEach(([m, want, got]) => console.log(`     ${m.padEnd(10)} wanted ${(want * 100).toFixed(0)}%  got ${(got * 100).toFixed(1)}%`));
  check('40k rolls match the table', rows.every(([, want, got]) => Math.abs(got - want) < 0.012));
  check('a roll always yields something valid', rows.every(([, , got]) => got > 0));
  check('drops are reproducible from a seed',
    JSON.stringify(rollDrop('drifter', rng(4))) === JSON.stringify(rollDrop('drifter', rng(4))));
  check('an unknown kind drops nothing rather than throwing', rollDrop('nosuch', rng(1)) === null);
}

console.log('\nholds');
const caps = Object.keys(HULLS).filter(h => HULLS[h].price > 0).map(h => [h, resolve(h).cargo]);
const bareFit = { weapon: [], generator: [], tech: [] };
caps.forEach(([h, c]) => console.log(`     ${h.padEnd(9)} ${String(c).padStart(4)}` +
  `   with an Ore Tender ${Math.round(resolve(h, bareFit, ['collect3']).cargo)}` +
  `   with an Ore Foundry ${Math.round(resolve(h, { ...bareFit, tech: ['foundry'] }).cargo)}`));
check('a bigger hull carries more', caps[0][1] < caps[1][1] && caps[1][1] < caps[2][1]);
// A hold is GROWN by collector rigs, which add to it, and only ever SHRUNK by the
// technology shelf. That is the same split every other slot obeys — racks fill a
// hull out, technology changes its shape — and it is why the Hold Expander and
// the Refinery Bulkhead are gone: "+65% of your hold for 12% of your speed" was a
// second, worse cargo ladder wearing the costume of a decision.
check('cargo is a normal attribute, and a rig is how a hold gets bigger',
  resolve('kestrel', bareFit, ['collect3']).cargo > resolve('kestrel').cargo && !!ATTRS.cargo,
  `kestrel ${resolve('kestrel').cargo} -> ${resolve('kestrel', bareFit, ['collect3']).cargo} with an Ore Tender`);
check('and the one technology that touches a hold takes room out of it',
  resolve('kestrel', { ...bareFit, tech: ['foundry'] }).cargo < resolve('kestrel').cargo,
  'an Ore Foundry is a furnace, and a furnace has to stand somewhere');

const h = {};
check('stow reports what it actually took', stow(h, 'iron', 4, 30) === 4 && holdVol(h) === 12, 'iron is 3 per unit');
check('stow refuses to overfill', stow(h, 'iron', 100, 30) === 6 && holdVol(h) === 30, 'cap 30, 10 iron');
check('a full hold takes nothing more', stow(h, 'platinum', 5, 30) === 0);
check('but a denser metal fits where bulk would not', (() => {
  const g = {}; stow(g, 'iron', 14, 29);              // 27 of 29 used, 2 spare
  return stow(g, 'iridium', 1, 29) === 1 && stow(g, 'iron', 1, 29) === 0;
})(), 'iridium at 1 fits the gap, iron at 3 does not');
check('unknown materials are refused, not stored', stow({}, 'unobtanium', 5, 100) === 0);
check('value sums correctly',
  holdValue({ iron: 2, iridium: 1 }) === MATERIALS.iron.value * 2 + MATERIALS.iridium.value);

console.log('\ntractor beam');
{
  const dt = 1 / 30;
  const near = () => ({ id: 1, x: 100, y: 0, mat: 'platinum', n: 3 });   // vol 1 each
  const ship = () => newShip(0, 0, 'vanguard');

  check('nothing to grab', beginScoop(ship(), {}, null) === 'gone');
  check('out of reach', beginScoop(ship(), {}, { ...near(), x: SCOOP_R + 50 }) === 'far');
  check('no room in the hold', beginScoop(ship(), { iron: 20 }, near()) === 'full', 'cap 60, 60 used');
  const started = beginScoop(ship(), {}, near());
  check('in reach with room starts a beam', started.id === 1 && started.t === SCOOP_TIME);

  const s1 = ship(), h1 = {}, p1 = near(), sc1 = beginScoop(s1, h1, p1);
  let t = 0, r;
  do { r = stepScoop(sc1, p1, s1, h1, dt); t += dt; } while (r.running);
  check('it takes the stated time', Math.abs(t - SCOOP_TIME) < 0.05, `${t.toFixed(2)}s`);
  check('and the whole pod comes aboard', h1.platinum === 3 && p1.n === 0 && r.emptied);

  // This used to read "drifting out of reach cancels it", and it did — which
  // meant a fetching drone lost its cargo the moment you did the thing a fetching
  // drone is for. A pull is committed once it starts.
  const s2 = ship(), h2 = {}, p2 = near(), sc2 = beginScoop(s2, h2, p2);
  for (let i = 0; i < 10; i++) stepScoop(sc2, p2, s2, h2, dt);
  s2.x = SCOOP_R + 400;                            // drift out mid-haul
  let r2; do { r2 = stepScoop(sc2, p2, s2, h2, dt); } while (r2.running);
  check('drifting out of reach no longer throws the cargo away',
    !r2.cancelled && holdVol(h2) > 0,
    'the pull is committed — it finishes and the drone comes to you');
  const s3 = ship(), h3 = {}, p3 = near(), sc3 = beginScoop(s3, h3, p3);
  for (let i = 0; i < 10; i++) stepScoop(sc3, p3, s3, h3, dt);
  s3.hp = 0;
  check('dying cancels it', stepScoop(sc3, p3, s3, h3, dt).cancelled && holdVol(h3) === 0);

  // clicking distant cargo is an order to go and get it
  const far = { id: 2, x: 4000, y: 0, mat: 'platinum', n: 2 };
  const a1 = approachPod(ship(), {}, far);
  check('cargo out of reach becomes a course, not a refusal',
    a1.fly && a1.fly.x === far.x && a1.fly.y === far.y, `${far.x}px away`);
  const closer = { ...far, x: SCOOP_R * 0.5 };
  const a2 = approachPod(ship(), {}, closer);
  check('once inside, the same order starts the beam', !!a2.scoop && !a2.fly);
  check('it closes past the boundary rather than hovering on it',
    !!approachPod({ ...ship(), x: SCOOP_R * 0.9 }, {}, { ...far, x: 0 }).fly,
    'still flying at 0.9 of reach, so the beam is not started at the very edge');
  check('a pod that vanished ends the order', approachPod(ship(), {}, null).done === true);
  check('a full hold ends it too, rather than flying there forever',
    approachPod(ship(), { iron: 20 }, closer).why === 'full');

  const s4 = ship(), h4 = { iron: 19, platinum: 1 }, p4 = near(), sc4 = beginScoop(s4, h4, p4);  // 58/60
  let g4; do { g4 = stepScoop(sc4, p4, s4, h4, dt); } while (g4.running);
  check('a nearly full hold takes what fits and leaves the rest',
    g4.took === 2 && p4.n === 1 && !g4.emptied, '2 of 3 platinum, pod keeps the remainder');
}

console.log('\noffloading');
{
  const hold = { iron: 5, rhodium: 1, iridium: 2 }, vault = {};
  const before = holdVol(hold);
  const moved = unload(hold, vault, 4);            // budget is VOLUME, not items
  check('unload reports VOLUME spent, not items moved',
    before - holdVol(hold) === 4 && moved === 4,
    '2 iridium at vol 1 + 1 rhodium at vol 2 = 3 items, 4 volume');
  check('a budget smaller than the next item spends nothing, and says so', (() => {
    const h2 = { iron: 3 }, v3 = {};               // iron is 3 per unit, budget is 1
    return unload(h2, v3, 1) === 0 && holdVol(h2) === 9;
  })(), 'so a metered caller can carry the remainder forward');
  check('it takes the rarest first', (vault.iridium ?? 0) === 2,
    'leave early and you keep the cheap half, not the good half');
  let guard = 0;
  while (holdVol(hold) > 0 && guard++ < 500) unload(hold, vault, 9);
  check('the vault is bottomless', holdVol(hold) === 0 && vault.iron === 5 && vault.rhodium === 1);
  check('an emptied material is removed rather than left at zero', !('iron' in hold));
  const full = { iron: 60 }, v2 = { iron: 1000 };
  unload(full, v2, 9999);
  check('offload has no ceiling', v2.iron === 1060 && holdVol(full) === 0);
}
check('scooping takes real time and real proximity',
  SCOOP_TIME > 0.2 && SCOOP_R > 100 && POD_LIFE > 30,
  `${SCOOP_TIME}s beam, ${SCOOP_R}px reach, ${POD_LIFE}s pod life`);
check('cargo moves back out of the hangar too', (() => {
  const bank = { iridium: 40 }, hold2 = {};
  const took = load(bank, hold2, 'iridium', 40, 30);     // kestrel-sized hold
  return took === 30 && hold2.iridium === 30 && bank.iridium === 10;
})(), 'takes what fits, leaves the rest in the hangar');
check('loading a stack the ship cannot fit at all changes nothing', (() => {
  const bank = { iron: 5 }, hold2 = { iron: 10 };        // 30 of 30 used
  return load(bank, hold2, 'iron', 5, 30) === 0 && bank.iron === 5;
})());
check('an emptied hangar stack disappears', (() => {
  const bank = { platinum: 3 }, hold2 = {};
  load(bank, hold2, 'platinum', 3, 60);
  return !('platinum' in bank) && hold2.platinum === 3;
})());
check('a stack transfer moves the whole stack', (() => {
  const h3 = { iron: 7, platinum: 2 }, v4 = {};
  unload(h3, v4, 7 * 99);                          // how the server bills a 'stash'
  return v4.iron === 7 && v4.platinum === 2 && holdVol(h3) === 0;
})());
check('every alien in the galaxy pays a bounty', WILD.every(k => ALIENS[k].bounty > 0),
  `${WILD.length} of them, Drifter ${ALIENS.drifter.bounty} ${CURRENCY.short}`);
check('range furniture pays nothing, and is not in the galaxy',
  Object.keys(ALIENS).filter(k => ALIENS[k].dev).every(k => !WILD.includes(k) && !ALIENS[k].bounty),
  'shooting a practice target is not a living');
check('a kill is worth more than its own drop, but not by much', (() => {
  const avg = DROPS.drifter.reduce((s, r) => s + r.p * ((r.min + r.max) / 2) * MATERIALS[r.mat].value, 0);
  return ALIENS.drifter.bounty > avg && ALIENS.drifter.bounty < avg * 6;
})(), 'so cargo is worth hauling, and killing is worth doing');
check('and that holds all the way up the ladder, not just at the bottom',
  WILD.every(k => {
    const avg = DROPS[k].reduce((s, r) => s + r.p * ((r.min + r.max) / 2) * MATERIALS[r.mat].value, 0);
    return ALIENS[k].bounty > avg;
  }),
  'a hostile that paid better in salvage than in bounty would make the scoop the weapon');

console.log('\nwhen the hold is full');
{
  const { roomFor, holdFullFor } = await import('../shared/cargo.js');
  // Volume differs by metal, so "full" is a question about a particular ore.
  // A hold with three units of room takes three iridium or no iron at all.
  const nearly = { iron: 19 };                     // 57 of a 60 hold
  console.log('     57/60 used: ' + ['iron', 'iridium'].map(m =>
    `${MATERIALS[m].name} ${MATERIALS[m].vol}vol -> room for ${roomFor(nearly, m, 60)}`).join(', '));
  check('room is counted in the ore you are looking at',
    roomFor(nearly, 'iron', 60) === 1 && roomFor(nearly, 'iridium', 60) === 3);
  const brimming = { iron: 20 };                   // 60 of 60
  check('a hold with nothing left is full for everything',
    ['iron', 'iridium', 'platinum'].every(m => holdFullFor(brimming, m, 60)));
  check('and one with a sliver left is not full for the small stuff',
    holdFullFor({ iron: 19, iridium: 2 }, 'iron', 60)
    && !holdFullFor({ iron: 19, iridium: 2 }, 'iridium', 60),
    'no room for another iron, room for one more iridium');
  check('room never goes negative', roomFor({ iron: 99 }, 'iron', 60) === 0);

  // A rig works down the pods by distance rather than giving up on the closest.
  // With two units left the nearest iron will not fit and the iridium behind it
  // will, and stopping at the first refusal left cargo on the ground.
  const ship2 = { x: 0, y: 0, hp: 100, stats: { cargo: 60 } };
  const tight = { iron: 19, iridium: 1 };          // 58 of 60
  const field = [{ id: 1, x: 120, y: 0, mat: 'iron', n: 9 },
                 { id: 2, x: 300, y: 0, mat: 'iridium', n: 2 }];
  const firstThatFits = (hold2) => {
    for (const { c } of field.map(c => ({ c, d: Math.hypot(c.x, c.y) })).sort((a, b) => a.d - b.d))
      if (typeof beginScoop(ship2, hold2, c, 900, 420) === 'object') return c.mat;
    return null;
  };
  check('a rig works past a pod it cannot fit', firstThatFits(tight) === 'iridium',
    'the nearest is iron, and two units of room will not take one');
  check('it still fills up on the nearest when that one fits',
    firstThatFits({ iron: 10 }) === 'iron');
  check('and stops entirely when nothing fits', firstThatFits({ iron: 20 }) === null);
}

console.log('\ncollector rigs');
{
  const { EQUIPMENT, isCollector, collectorReach } = await import('../shared/gear.js');
  const { resolve, slotsOf } = await import('../shared/ships.js');
  const { beginScoop, stepScoop, SCOOP_R } = await import('../shared/cargo.js');
  const { sanitiseFit, sanitiseDrones } = await import('../shared/gear.js');
  const fit = o => ({ weapon: [], generator: [], tech: [], ...o });
  const rigs = Object.keys(EQUIPMENT).filter(isCollector);

  console.log('     ' + rigs.map(k => `${EQUIPMENT[k].name} ${EQUIPMENT[k].reach}px +${EQUIPMENT[k].mods[0][2]}`).join('   '));
  check('a better rig reaches further and carries more',
    rigs.every((k, i) => i === 0 || (EQUIPMENT[k].reach > EQUIPMENT[rigs[i - 1]].reach
      && EQUIPMENT[k].mods[0][2] > EQUIPMENT[rigs[i - 1]].mods[0][2]
      && EQUIPMENT[k].price > EQUIPMENT[rigs[i - 1]].price)));
  check('every rig out-reaches your own arm',
    rigs.every(k => EQUIPMENT[k].reach > SCOOP_R), `an arm is ${SCOOP_R}px`);

  check('a rig only goes on a drone', rigs.every(k =>
    sanitiseFit(slotsOf('bulwark'), fit({ weapon: [k], generator: [k], tech: [k] }))
      .weapon.length === 0));
  // This used to read "and a drone will take one". It did, and that was the bug:
  // fitting a rig cost you a gun even with ten empty bays left. The rack refuses
  // them now and the rig has a bay of its own.
  check('but a combat bay will not take one', sanitiseDrones([rigs[0]], {})[0] === null,
    'a rig in a gun bay was a gun you paid for and did not get');
  check('a rig carrying is still not a gun',
    resolve('bulwark', fit(), [rigs[2]]).damage === resolve('bulwark', fit(), []).damage);
  // And this used to say "two rigs carry twice but do not reach twice". Carrying
  // twice was the only reason to fit a second, and reach — the thing a rig is
  // actually for — never stacked at all. There is one bay because there was only
  // ever one rig worth having.
  check('a rig still adds its hold to the ship',
    resolve('bulwark', fit(), escortOf([], rigs[0])).cargo
      === resolve('bulwark', fit(), []).cargo + EQUIPMENT[rigs[0]].mods[0][2]);
  check('and reach is the rig you carry, never a sum',
    collectorReach(rigs[0]) === EQUIPMENT[rigs[0]].reach
    && collectorReach(rigs[2]) === EQUIPMENT[rigs[2]].reach,
    'which is why one bay is the right number of bays');
  check('no rig, no reach', collectorReach(null) === 0 && collectorReach('emitter1') === 0);

  // The tractor takes a reach now, so a rig can pull what an arm cannot.
  const ship = { x: 0, y: 0, hp: 100, stats: { cargo: 500 } };
  const far = { id: 1, x: 700, y: 0, mat: 'iron', n: 3 };
  check('an arm cannot reach across the field', beginScoop(ship, {}, far) === 'far');
  check('a Harvester can', typeof beginScoop(ship, {}, far, EQUIPMENT[rigs[1]].reach) === 'object');
  check('and the pull holds at that range', (() => {
    const sc = beginScoop(ship, {}, far, EQUIPMENT[rigs[1]].reach);
    return stepScoop(sc, far, ship, {}, 0.01).running === true;
  })(), 'a beam that cancels the moment it starts is no beam at all');
  // A drone has to fly out and back. A flat pull time whatever the distance had
  // the Ore Tender crossing 2000px/s — five times the fastest hull.
  const { pullTime, SCOOP_TIME } = await import('../shared/cargo.js');
  const { HULLS } = await import('../shared/ships.js');
  const hulls = Object.keys(HULLS).map(h => ({ h, st: resolve(h, { weapon: [], generator: [], tech: [] }) }));
  // This used to read "a hauling drone is slower than the fastest hull", against
  // a flat 420px/s. That was the wrong property to hold: it made the drone slower
  // than a Kestrel, which could fly away from its own rig, and much faster than a
  // Bulwark, which is what read as teleporting. Speed is the ship's now.
  console.log('     ' + hulls.map(x => `${x.h} ${x.st.speed} -> drone ${Math.round(droneSpeed({ stats: x.st }))}`).join('   '));
  check('a drone is always faster than the ship it belongs to',
    hulls.every(x => droneSpeed({ stats: x.st }) > x.st.speed),
    `every hull, by ${DRONE_SPEED_MULT}x — so it can always catch up, whatever you fly`);
  check('and there is no hull it reads wrong on',
    hulls.every(x => droneSpeed({ stats: x.st }) / x.st.speed === DRONE_SPEED_MULT),
    'one ratio rather than one number, so a new hull needs no retuning');
  check('a longer reach still takes longer to use',
    rigs.every((k, i) => i === 0 ||
      pullTime(EQUIPMENT[k].reach, 400) > pullTime(EQUIPMENT[rigs[i - 1]].reach, 400)),
    'reach is a trade, not free');
  check('your own arm still takes no time to fly anywhere',
    pullTime(260) === SCOOP_TIME, 'it does not travel — it just pulls');
  check('and the pull carries how long it was given',
    beginScoop(ship, {}, far, 900, 400).secs > SCOOP_TIME,
    'so the progress the client draws is against the right clock');

  check('a full hold stops it picking anything up',
    beginScoop({ ...ship, stats: { cargo: 1 } }, { iron: 99 }, { ...far, x: 100 }, 900) === 'full',
    'which is what the FULL tag over the drone is saying');
}

// --- the collector rig -------------------------------------------------------
// It used to sit in a combat bay, so buying one cost you a gun even with ten
// empty bays left, and since reach is a max rather than a sum a second one was
// never worth anything. It has its own bay now.
console.log('\nthe collector rig');
check('a collector cannot be put in a combat bay',
  sanitiseDrones(['collect1', 'emitter1'], { tech: [] })[0] === null,
  'the rack refuses it, so an old save cannot keep one there');
check('and the rig bay takes nothing else',
  sanitiseRig('emitter1') === null && sanitiseRig('collect2') === 'collect2');
check('reach comes from the rig, not from the rack',
  collectorReach('collect3') === EQUIPMENT.collect3.reach && collectorReach('emitter1') === 0);
check('a second collector was always worthless anyway',
  Math.max(collectorReach('collect1'), collectorReach('collect1')) === collectorReach('collect1'),
  'reach is a max — which is why one bay is the right number of bays');
console.log('\nholding station over a pod');
{
  const ship = { x: 0, y: 0, hp: 100, stats: { cargo: 600, speed: 300 } };
  const pod = { id: 1, x: 420, y: 0, mat: 'iron', n: 5 };
  const SPD = droneSpeed(ship);
  const sc = beginScoop(ship, {}, pod, 520, SPD);
  const out = 420 / SPD;
  check('a pull is out, hold station, and back',
    Math.abs(sc.secs - (2 * out + DWELL)) < 1e-9,
    `${out.toFixed(2)}s each way around ${DWELL}s of work`);
  check('your own arm has no drone and no dwell',
    rigAt(beginScoop(ship, {}, pod, 520, 0), ship) === null &&
    pullTime(420, 0) === 0.9);
  const at = t => { const c = { ...sc, t: sc.secs - t }; return rigAt(c, ship); };
  check('it sets out from the ship', at(0).x === 0 && at(0).phase === 'out');
  check('and arrives over the pod', Math.abs(at(out + 1e-6).x - pod.x) < 1e-6 && at(out + 1e-6).phase === 'work');
  check('then it holds still while it lifts', (() => {
    const a = at(out + 0.1), b = at(out + DWELL - 0.1);
    return a.phase === 'work' && b.phase === 'work' && a.x === b.x && a.y === b.y;
  })(), `${DWELL}s in one place — the ore no longer just vanishes`);
  check('and the lift reads 0 to 1 across that hold',
    at(out + 0.01).work < 0.05 && at(out + DWELL - 0.01).work > 0.95);
  check('then it comes home', Math.abs(at(sc.secs).x) < 1e-6 && at(sc.secs).phase === 'back');
}
// --- a pull, once started, is committed ---------------------------------------
// It used to cancel the moment the ship left the rig's reach, which abandoned the
// ore on the floor and punished you for doing the one thing a FETCHING drone
// exists to let you do.
console.log('\nflying off mid-pull');
{
  const ship = { x: 0, y: 0, hp: 100, stats: { cargo: 600, speed: 300 } };
  const pod = { id: 1, x: 400, y: 0, mat: 'iron', n: 5 };
  const hold = {};
  const sc = beginScoop(ship, hold, pod, 520, droneSpeed(ship));
  let alive = true, took = 0, emptied = false;
  for (let i = 0; i < 400 && alive; i++) {
    ship.x -= 40;                                  // fly away, hard, the whole time
    const r = stepScoop(sc, emptied ? null : pod, ship, hold, 1 / 30);
    took += r.took ?? 0; emptied = emptied || !!r.emptied;
    alive = r.running;
    if (r.cancelled) break;
  }
  check('flying away does not abandon the ore', took === 5 && emptied,
    `${took} iron lifted while the ship ran ${Math.abs(ship.x)}px in the other direction`);
  check('and the hold really has it', hold.iron === 5);
  check('the pull ends on its own once the drone is home', !alive);
}
{
  // The drone chases: the legs are measured against where the ship is NOW, so a
  // ship that keeps moving is still where the drone is heading.
  const ship = { x: 0, y: 0, hp: 100, stats: { cargo: 600, speed: 300 } };
  const pod = { id: 2, x: 300, y: 0, mat: 'iron', n: 2 };
  const sc = beginScoop(ship, {}, pod, 520, droneSpeed(ship));
  const home = rigAt({ ...sc, t: 0 }, ship);       // fully returned, ship at origin
  ship.x = 900;
  const chased = rigAt({ ...sc, t: 0 }, ship);     // same instant, ship elsewhere
  check('a returning drone comes to where you are, not where you were',
    Math.abs(home.x - 0) < 1e-6 && Math.abs(chased.x - 900) < 1e-6);
  check('and it no longer needs the pod to exist to fly home',
    rigAt({ ...sc, t: sc.secs * 0.1 }, ship) !== null,
    'the pod is spliced out the moment the lift lands');
}

// --- what dying costs --------------------------------------------------------
// The hold was the only stake, so a pilot flying empty had none: the cheapest way
// through a hard fight was to dump the cargo and treat the wreck as a ride home.
console.log('\nthe salvage bill');
{
  const { DEATH_TOLL, tollOn } = await import('../shared/cargo.js');
  check('a tenth of the account goes down with the ship',
    tollOn(10000) === 1000 && DEATH_TOLL === 0.10, `${tollOn(10000)} of 10000`);
  check('it scales, so it stings the same at every stage',
    tollOn(500) === 50 && tollOn(1_000_000) === 100_000,
    'a new pilot loses pocket change, a rich one loses a real number');
  check('and it can never take the last of it',
    tollOn(9) === 0 && tollOn(0) === 0 && tollOn(-5) === 0,
    'a setback, not being unable to buy your way back in');
  check('it is always a whole number of credits',
    [1, 7, 33, 12345, 99999].every(c => Number.isInteger(tollOn(c))));
  check('and you always keep the larger part',
    [100, 5000, 999999].every(c => c - tollOn(c) > c * 0.85),
    'dying is expensive, not ruinous');
}

// --- credits at a size a person can read --------------------------------------
// 4120000 and 41200000 look identical at a glance and differ by ten times.
console.log('\nreading a balance');
{
  const { fmtCredits } = await import('../shared/cargo.js');
  check('millions read as millions, to two decimals',
    fmtCredits(4120000) === '4.12M', `4120000 -> ${fmtCredits(4120000)}`);
  check('and billions as billions', fmtCredits(1234567890) === '1.23B');
  check('trailing zeros are dropped, because 4.00M is 4M with noise on it',
    fmtCredits(4000000) === '4M' && fmtCredits(41200000) === '41.2M',
    `${fmtCredits(4000000)}, ${fmtCredits(41200000)}`);
  check('past three figures the decimals stop saying anything',
    fmtCredits(412000) === '412k' && fmtCredits(901200) === '901k',
    'a decimal on a six-figure number is a digit nobody reads');
  // A price is a thing you compare against another price, and 3.40k is strictly
  // worse for that than 3400.
  check('small numbers stay exact, because prices get compared',
    fmtCredits(3400) === '3400' && fmtCredits(455) === '455' && fmtCredits(9999) === '9999');
  check('it never returns NaN, undefined or an empty string',
    [null, undefined, NaN, 'x', {}, 0].every(v => /^[-0-9]/.test(fmtCredits(v))),
    `garbage in gives ${fmtCredits(undefined)}`);
  check('and it survives a negative balance', fmtCredits(-25000) === '-25k');
  check('it never loses more than 1% of the number it is showing',
    [455, 3400, 41200, 412000, 4120000, 6385899, 1234567890].every(n => {
      const t = fmtCredits(n);
      const back = parseFloat(t) * ({ k: 1e3, M: 1e6, B: 1e9 }[t.at(-1)] ?? 1);
      return Math.abs(back - n) / n < 0.01;
    }), 'a readable number that is wrong is not readable');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(MATERIALS).length} materials`}\n`);
process.exit(fails.length ? 1 : 0);
