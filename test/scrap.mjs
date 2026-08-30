import { SCRAP_RATE, scrapValue, scrapOfItem, scrapOfHull,
         whyNotScrap, whyNotScrapHull } from '../shared/scrap.js';
import { EQUIPMENT } from '../shared/gear.js';
import { HULLS, DEFAULT_HULL } from '../shared/ships.js';
import { PIRATE_RATE } from '../shared/cargo.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

console.log('\nwhat breaking something up pays');
check('a fixed fraction of what it cost', scrapValue(1000) === 400 && SCRAP_RATE === 0.40,
  `${SCRAP_RATE * 100}% — 40% of 1000 is ${scrapValue(1000)}`);
check('always a whole number of credits',
  [1, 7, 899, 7200, 34001].every(p => Number.isInteger(scrapValue(p))));
check('and never more than the thing cost',
  Object.keys(EQUIPMENT).every(k => scrapOfItem(k) < EQUIPMENT[k].price || EQUIPMENT[k].price === 0));

console.log('\nit cannot be a way to move money');
// If a round trip ever paid, the top rung would be the only sensible first
// purchase — you could buy it, refund the difference, and climb for free.
check('every round trip loses, at every price',
  Object.keys(EQUIPMENT).every(k => scrapOfItem(k) < EQUIPMENT[k].price),
  `you get ${SCRAP_RATE * 100}% back, so buying and selling costs you ${100 - SCRAP_RATE * 100}% every time`);
check('and no ladder rung can be funded by scrapping the one below it', (() => {
  const rungs = Object.keys(EQUIPMENT)
    .filter(k => EQUIPMENT[k].slot === 'weapon' && EQUIPMENT[k].kind !== 'rocket')
    .sort((a, b) => EQUIPMENT[a].tier - EQUIPMENT[b].tier);
  return rungs.every((k, i) => i === 0 || scrapOfItem(rungs[i - 1]) < EQUIPMENT[k].price);
})(), 'trading up always costs real money');
check('it pays less than a pirate pays for ore', SCRAP_RATE < PIRATE_RATE,
  `${SCRAP_RATE * 100}% against ${PIRATE_RATE * 100}% — ore is a commodity, a used emitter is not`);

console.log('\nbut it still has to be worth doing');
check('upgrading is not punished', (() => {
  const net = EQUIPMENT.emitter2.price - scrapOfItem('emitter1');
  return net < EQUIPMENT.emitter2.price && net > 0;
})(), `MK-I to MK-II is ${EQUIPMENT.emitter2.price - scrapOfItem('emitter1')} net rather than ${EQUIPMENT.emitter2.price}`);
check('and the good stuff is worth real money broken up',
  scrapOfItem('emitter5') > EQUIPMENT.emitter1.price * 10,
  `an MK-V breaks for ${scrapOfItem('emitter5')}`);

console.log('\nwhen you may do it');
check('not with nothing loose in the inventory',
  /inventory/.test(whyNotScrap('emitter1', { held: 0, where: 'dock' })),
  whyNotScrap('emitter1', { held: 0, where: 'dock' }));
check('not in open space', /dock|bay/.test(whyNotScrap('emitter1', { held: 2, where: null })));
check('yes at a dock or a bay you rent', whyNotScrap('emitter1', { held: 1, where: 'dock' }) === null
  && whyNotScrap('emitter1', { held: 1, where: 'berth' }) === null);
check('and never something that does not exist', whyNotScrap('nonsense', { held: 9, where: 'dock' }) !== null);

console.log('\nhulls are their own question');
const owned = [DEFAULT_HULL, 'kestrel', 'bulwark'];
check('you may break up a hull you own and are not flying',
  whyNotScrapHull('kestrel', { owned, flying: 'bulwark', where: 'dock' }) === null);
check('but never the one you are flying',
  /flying/.test(whyNotScrapHull('bulwark', { owned, flying: 'bulwark', where: 'dock' })));
check('never one you do not own',
  /own/.test(whyNotScrapHull('vanguard', { owned, flying: 'bulwark', where: 'dock' })));
check('and never the starter, which was never yours to sell',
  whyNotScrapHull(DEFAULT_HULL, { owned, flying: 'kestrel', where: 'dock' }) !== null,
  'a pilot with no ship has no game');
check('a hull is worth breaking up',
  scrapOfHull('bulwark') === scrapValue(HULLS.bulwark.price),
  `a Bulwark breaks for ${scrapOfHull('bulwark')} of ${HULLS.bulwark.price}`);
check('and the free starter is worth nothing, which is correct',
  scrapOfHull(DEFAULT_HULL) === 0);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — scrap at ${SCRAP_RATE * 100}%`}\n`);
process.exit(fails.length ? 1 : 0);
