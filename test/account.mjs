import { newAccount, sanitiseAccount, capture, callsign, companyFor } from '../shared/account.js';
import { newShip, refit } from '../shared/sim.js';
import { MAPS, COMPANIES } from '../shared/maps.js';
import { HULLS, DEFAULT_HULL } from '../shared/ships.js';
import { MATERIALS } from '../shared/cargo.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

console.log('\nnew pilots');
const made = Array.from({ length: 9 }, (_, i) => newAccount('tok' + i, i, 1000));
made.slice(0, 3).forEach(a => console.log(`     seq ${a.seq}  ${a.name.padEnd(12)} ${COMPANIES[a.co].tag}  ${MAPS[a.mapId].name}`));
check('companies rotate evenly by account number',
  new Set([0, 1, 2].map(companyFor)).size === 3 && companyFor(0) === companyFor(3),
  'so the sides stay even across restarts');
check('everyone starts at their own home dock',
  made.every(a => a.mapId === a.co + '1' && MAPS[a.mapId].home));
check('callsigns are stable for a given account', callsign(7) === callsign(7) && callsign(7) !== callsign(8));
check('a new pilot owns nothing and flies the default hull',
  made.every(a => a.credits === 0 && !Object.keys(a.vault).length && a.hull === DEFAULT_HULL));

console.log('\ncoming back');
const acct = newAccount('abc', 4, 1000);
const p = {
  co: acct.co, mapId: 'g1', credits: 4820,
  hold: { iron: 6, iridium: 1 }, vault: { platinum: 12 },
  ship: refit(newShip(0, 0, 'kestrel', []), 'bulwark', ['plating', 'thruster']),
};
p.ship.x = 8123.4; p.ship.y = 2044.9;
capture(acct, p, 2000);
check('capture folds the session back into the account',
  acct.hull === 'bulwark' && acct.fit.join() === 'plating,thruster' && acct.credits === 4820
  && acct.mapId === 'g1' && acct.x === 8123 && acct.y === 2045);
check('cargo and hangar both survive',
  acct.hold.iron === 6 && acct.hold.iridium === 1 && acct.vault.platinum === 12);
check('capture copies rather than aliasing', (() => {
  p.hold.iron = 999; p.ship.fit.push('ballast');
  return acct.hold.iron === 6 && acct.fit.length === 2;
})(), 'a later change to the live ship must not rewrite history');
const back = sanitiseAccount(JSON.parse(JSON.stringify(acct)), acct.seq, 3000);
check('a round trip through JSON changes nothing that matters',
  back.hull === 'bulwark' && back.credits === 4820 && back.vault.platinum === 12
  && back.x === 8123 && back.mapId === 'g1');
check('created is kept, seen is refreshed', back.created === 1000 && back.seen === 3000);

console.log('\na file someone has edited');
const junk = sanitiseAccount({
  token: 'x', co: 'zz', hull: 'battlestar', fit: ['plating', 'wat', 'plating', 'thruster', 'ballast'],
  credits: -500, vault: { iron: 3.7, unobtanium: 99, nickel: -1, iridium: 4 },
  hold: null, mapId: 'nowhere', x: 'over there', y: NaN, name: 42,
}, 3, 9);
check('an unknown company falls back to the rotation', COMPANIES[junk.co]);
check('an unknown hull falls back to the default', junk.hull === DEFAULT_HULL);
check('an oversized fit is truncated and cleaned', junk.fit.length === 3 && !junk.fit.includes('wat'));
check('negative credits become zero', junk.credits === 0);
check('invented materials are dropped from the hangar',
  JSON.stringify(junk.vault) === JSON.stringify({ iron: 3, iridium: 4 }),
  'fractions floored, negatives and unknowns gone');
check('an unknown map puts you back at your own home', junk.mapId === junk.co + '1');
check('a nonsense position becomes the home dock',
  junk.x === MAPS[junk.co + '1'].base.x && junk.y === MAPS[junk.co + '1'].base.y);
check('a non-string name is replaced', typeof junk.name === 'string' && junk.name.includes('-'));
check('nothing thrown on a totally empty record', (() => {
  const e = sanitiseAccount({}, 0, 1);
  return !!COMPANIES[e.co] && !!HULLS[e.hull] && !!MAPS[e.mapId];
})());

console.log('\non disk');
{
  const fs = await import('node:fs');
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync('/tmp/aphelion-store-');
  process.chdir(tmp);
  const store = await import('../store.js?fresh=' + Math.random());
  check('an empty directory reads as no accounts',
    JSON.stringify(store.load()) === JSON.stringify({ accounts: {}, seq: 0 }));
  store.save({ accounts: { abc: acct }, seq: 5 });
  const read = store.load();
  check('what was written comes back', read.seq === 5 && read.accounts.abc.credits === 4820);
  fs.writeFileSync('data/accounts.json', '{ not json at all');
  check('a corrupt file does not take the server down',
    JSON.stringify(store.load()) === JSON.stringify({ accounts: {}, seq: 0 }));
  check('no half-written temp file is left behind', !fs.existsSync('data/accounts.json.tmp'));
  process.chdir(cwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — accounts'}\n`);
process.exit(fails.length ? 1 : 0);
