import { MATERIALS, DROPS, rollDrop, stow, unload, holdVol, holdValue, volOf,
         POD_LIFE, SCOOP_R, SCOOP_TIME, CURRENCY } from '../shared/cargo.js';
import { beginScoop, stepScoop, approachPod, load } from '../shared/cargo.js';
import { WILD, ALIENS } from '../shared/aliens.js';
import { newShip } from '../shared/sim.js';
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
caps.forEach(([h, c]) => console.log(`     ${h.padEnd(9)} ${String(c).padStart(4)}` +
  `   with a Hold Expander ${Math.round(resolve(h, { weapon: [], generator: [], tech: ['expander'] }).cargo)}`));
check('a bigger hull carries more', caps[0][1] < caps[1][1] && caps[1][1] < caps[2][1]);
check('cargo is a normal attribute, so a module can change it',
  resolve('kestrel', { weapon: [], generator: [], tech: ['expander'] }).cargo > resolve('kestrel').cargo && !!ATTRS.cargo);
check('and the expander costs speed',
  resolve('kestrel', { weapon: [], generator: [], tech: ['expander'] }).speed < resolve('kestrel').speed);

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

  const s2 = ship(), h2 = {}, p2 = near(), sc2 = beginScoop(s2, h2, p2);
  for (let i = 0; i < 10; i++) stepScoop(sc2, p2, s2, h2, dt);
  s2.x = SCOOP_R + 400;                            // drift out mid-haul
  const r2 = stepScoop(sc2, p2, s2, h2, dt);
  check('drifting out of reach cancels it', r2.cancelled && !r2.running && holdVol(h2) === 0,
    'and the cargo stays put');
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
  check('and a drone will take one', sanitiseDrones([rigs[0]], {}).join() === rigs[0]);
  check('a bay carrying one is not a gun',
    resolve('bulwark', fit(), [rigs[2]]).damage === resolve('bulwark', fit(), []).damage);
  check('two rigs carry twice but do not reach twice',
    resolve('bulwark', fit(), [rigs[0], rigs[0]]).cargo
      === resolve('bulwark', fit(), []).cargo + EQUIPMENT[rigs[0]].mods[0][2] * 2
    && collectorReach([rigs[0], rigs[0]]) === EQUIPMENT[rigs[0]].reach,
    'the best one reaches, and only the best');
  check('no rig, no reach', collectorReach(['emitter1', null]) === 0);

  // The tractor takes a reach now, so a rig can pull what an arm cannot.
  const ship = { x: 0, y: 0, hp: 100, stats: { cargo: 500 } };
  const far = { id: 1, x: 700, y: 0, mat: 'iron', n: 3 };
  check('an arm cannot reach across the field', beginScoop(ship, {}, far) === 'far');
  check('a Harvester can', typeof beginScoop(ship, {}, far, EQUIPMENT[rigs[1]].reach) === 'object');
  check('and the pull holds at that range', (() => {
    const sc = beginScoop(ship, {}, far, EQUIPMENT[rigs[1]].reach);
    return stepScoop(sc, far, ship, {}, 0.01).running === true;
  })(), 'a beam that cancels the moment it starts is no beam at all');
  check('a full hold stops it picking anything up',
    beginScoop({ ...ship, stats: { cargo: 1 } }, { iron: 99 }, { ...far, x: 100 }, 900) === 'full',
    'which is what the FULL tag over the drone is saying');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(MATERIALS).length} materials`}\n`);
process.exit(fails.length ? 1 : 0);
