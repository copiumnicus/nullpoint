import { newAccount, sanitiseAccount, capture, carried, SHIP_FIELDS,
         callsign, companyFor } from '../shared/account.js';
import { newShip, refit } from '../shared/sim.js';
import { MAPS, COMPANIES } from '../shared/maps.js';
import { HULLS, DEFAULT_HULL } from '../shared/ships.js';
import { EQUIPMENT, fitCount, MAX_DRONES } from '../shared/gear.js';
import { levelFor, costOf } from '../shared/level.js';
const fit = (o = {}) => ({ weapon: [], generator: [], tech: [], ...o });
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
check('but is not sent out unarmed', made.every(a => a.fit.weapon.length === 1),
  'one emitter in the rack');

console.log('\ncoming back');
const acct = newAccount('abc', 4, 1000);
const p = {
  co: acct.co, mapId: 'g1', credits: 4820,
  hold: { iron: 6, iridium: 1 }, vault: { platinum: 12 },
  gear: { emitter1: 3, plating: 1 }, hulls: ['hauler', 'bulwark'], xp: 8400,
  formations: ['line', 'wedge'],
  ship: refit(newShip(0, 0, 'kestrel'), 'bulwark',
              fit({ weapon: ['emitter1', 'emitter1'], tech: ['plating'] }), ['emitter1', null], 'wedge'),
};
p.ship.x = 8123.4; p.ship.y = 2044.9;
capture(acct, p, 2000);
check('capture folds the session back into the account',
  acct.hull === 'bulwark' && acct.fit.weapon.length === 2 && acct.fit.tech.join() === 'plating'
  && acct.gear.emitter1 === 3 && acct.credits === 4820
  && acct.mapId === 'g1' && acct.x === 8123 && acct.y === 2045
  && acct.formation === 'wedge' && acct.formations.join() === 'line,wedge');
check('rank and escort come back too', acct.xp === 8400 && acct.drones.length === 2,
  `level ${levelFor(acct.xp).level}`);
check('cargo and hangar both survive',
  acct.hold.iron === 6 && acct.hold.iridium === 1 && acct.vault.platinum === 12);
check('capture copies rather than aliasing', (() => {
  p.hold.iron = 999; p.ship.fit.weapon.push('emitter1'); p.gear.emitter1 = 99;
  return acct.hold.iron === 6 && acct.fit.weapon.length === 2 && acct.gear.emitter1 === 3;
})(), 'a later change to the live ship must not rewrite history');
const back = sanitiseAccount(JSON.parse(JSON.stringify(acct)), acct.seq, 3000);
check('a round trip through JSON changes nothing that matters',
  back.hull === 'bulwark' && back.credits === 4820 && back.vault.platinum === 12
  && back.x === 8123 && back.mapId === 'g1');
check('created is kept, seen is refreshed', back.created === 1000 && back.seen === 3000);

console.log('\na file someone has edited');
const junk = sanitiseAccount({
  token: 'x', co: 'zz', hull: 'battlestar',
  fit: { weapon: ['emitter1', 'wat', 'emitter1', 'emitter1', 'emitter1'], tech: ['plating', 'plating'], generator: ['emitter1'] },
  gear: { emitter1: 2.9, unobtanium: 4, cellA: -2 }, hulls: ['vanguard', 'nonesuch'],
  credits: -500, vault: { iron: 3.7, unobtanium: 99, nickel: -1, iridium: 4 },
  hold: null, mapId: 'nowhere', x: 'over there', y: NaN, name: 42,
}, 3, 9);
check('an unknown company falls back to the rotation', COMPANIES[junk.co]);
check('an unknown hull falls back to the default', junk.hull === DEFAULT_HULL);
check('you cannot fly a ship you do not own',
  sanitiseAccount({ token: 'x', hull: 'bulwark', hulls: ['hauler'] }, 0, 1).hull === DEFAULT_HULL);
check('the starter ship is always owned, invented ones never are',
  junk.hulls.includes(DEFAULT_HULL) && junk.hulls.includes('vanguard') && !junk.hulls.includes('nonesuch'));
check('an oversized rack is truncated to the hull actually being flown',
  junk.fit.weapon.length === 1 && !junk.fit.weapon.includes('wat')
  && junk.fit.tech.length === 1 && junk.fit.generator.length === 0,
  'fell back to a Hauler (W1 G1 T1); duplicate tech collapsed, wrong-slot item dropped');
// Rewritten, not deleted: the locker is still cleaned the same way, and what
// changed is that the rack no longer DELETES what it cannot seat. sanitiseFit
// dropped the surplus on the floor and every login reads a save through this
// function, so the day a hull's slot table moved, everyone flying that hull lost
// the difference in silence. reseat returns it instead, and the cleaning happens
// after the return, so an invented item is still refused rather than minted.
check('the locker is cleaned the same way, and takes back whatever the rack could not seat',
  JSON.stringify(junk.gear) === JSON.stringify({ emitter1: 6, plating: 1 }),
  'two owned emitters plus the four the Hauler had no hardpoint for, and the duplicate plating — ' +
  'while the invented "wat" it was fitted with is dropped, not credited');
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

console.log('\nrank and escort');
{
  check('everyone starts at level one with nothing flown yet',
    made.every(a => a.xp === 0 && levelFor(a.xp).level === 1 && a.drones.length === 0));
  const climb = [0, 140, 500, 5000, 50000].map(x => [x, levelFor(x).level]);
  console.log('     ' + climb.map(([x, l]) => `${x}xp=L${l}`).join('  '));
  check('rank climbs with kills and never goes backwards',
    climb.every(([, l], i) => i === 0 || l >= climb[i - 1][1]) && levelFor(140).level === 2);
  // There is no top. There was one at sixty, and sixty was only about nine Corsair
  // Hives — so a pilot reached it and every kill after it stopped meaning anything,
  // which is the opposite of what a record is for.
  {
    const { progress, LEVEL_GUARD } = await import('../shared/level.js');
    const at60 = (() => { let x = 0; for (let i = 1; i < 60; i++) x += costOf(i); return x; })();
    check('rank does not stop at the old ceiling',
      levelFor(at60 * 4).level > 60 && levelFor(at60 * 100).level > levelFor(at60 * 4).level,
      `${at60.toLocaleString('en-US')} xp was the cap and is level ${levelFor(at60).level}; ` +
      `four times that is ${levelFor(at60 * 4).level} and a hundred times is ${levelFor(at60 * 100).level}`);
    check('and every level still costs more than the one before it',
      [1, 10, 60, 200, 900].every((l, i, a) => !i || costOf(l) > costOf(a[i - 1])),
      [1, 10, 60, 200, 900].map(l => `L${l} ${costOf(l).toLocaleString('en-US')}`).join(' < '));
    check('the bar is always a real fraction, never permanently full',
      [0, 140, at60, at60 * 50].every(x => progress(x) >= 0 && progress(x) < 1),
      'at the old cap it read 1.000 forever, which is a bar that has stopped being one');
    // The lookup is a binary search over a cached table now, because it runs once
    // per player per snapshot and used to walk the ladder from level one.
    check('it agrees with walking the ladder one rung at a time',
      [0, 1, 139, 140, 9999, 250_000, 5_000_000].every(x => {
        let lvl = 1, spent = 0;
        while (x >= spent + costOf(lvl)) { spent += costOf(lvl); lvl++; }
        const got = levelFor(x);
        return got.level === lvl && got.into === x - spent;
      }), 'the fast answer and the slow one are the same answer');
    check('and a hand-edited save cannot ask it to count to infinity',
      levelFor(Infinity).level >= 1 && levelFor(NaN).level === 1 && levelFor(-5).level === 1,
      `guarded at ${LEVEL_GUARD.toLocaleString('en-US')}, which is about 3.6e11 xp — ` +
      'two and a half million Hives, so it is a guard and not a cap');
  }

  check('a level is standing, not power', (() => {
    const veteran = sanitiseAccount({ token: 'x', xp: 999999 }, 0, 1);
    const rookie = sanitiseAccount({ token: 'y', xp: 0 }, 1, 1);
    return JSON.stringify(veteran.fit) === JSON.stringify(rookie.fit) && veteran.hull === rookie.hull;
  })(), 'the same ship flies the same for both');

  const withEscort = sanitiseAccount({
    token: 'z', hull: 'vanguard', hulls: ['hauler', 'vanguard'],
    fit: { weapon: ['emitter1'], generator: [], tech: ['plating'] },
    // more than the bay limit, so the cap is actually under test
    drones: [...Array(MAX_DRONES + 4)].map((_, i) =>
      ['emitter1', 'plating', 'nonsense', null, 'cellA', 'foundry', 'emitter2', 'emitter3'][i % 8]),
    xp: -20,
  }, 2, 1);
  check('negative experience becomes zero', withEscort.xp === 0);
  check('an escort is capped at the fleet limit', withEscort.drones.length === MAX_DRONES,
    `${MAX_DRONES} drones`);
  check('a drone cannot mount a technology the ship already has',
    withEscort.drones[1] === null, 'plating is fitted on the hull');
  check('but it can mount a second of anything else',
    withEscort.drones[0] === 'emitter1' && withEscort.drones[4] === 'cellA');
  check('an invented item leaves the bay empty rather than being kept',
    withEscort.drones[2] === null);
}

console.log('\non disk');
{
  const fs = await import('node:fs');
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync('/tmp/nullpoint-store-');
  process.chdir(tmp);
  const store = await import('../store.js?fresh=' + Math.random());
  check('an empty directory reads as no accounts',
    JSON.stringify(store.load()) === JSON.stringify({ accounts: {}, seq: 0 }));
  store.save({ accounts: { abc: acct }, seq: 5 });
  const read = store.load();
  check('what was written comes back',
    read.seq === 5 && read.accounts.abc.credits === 4820 && read.accounts.abc.gear.emitter1 === 3);
  fs.writeFileSync('data/accounts.json', '{ not json at all');
  check('a corrupt file does not take the server down',
    JSON.stringify(store.load()) === JSON.stringify({ accounts: {}, seq: 0 }));
  check('no half-written temp file is left behind', !fs.existsSync('data/accounts.json.tmp'));
  process.chdir(cwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nwhat a reset actually resets');
{
  // /reset used to zero the live player field by field, in a list written out a
  // second time, and that list had fallen behind capture(): it never touched the
  // research station, so a pilot who reset kept a 500,000cr lab and a x4 hull
  // multiplier with no credits to their name, and capture() wrote it back onto the
  // fresh account a second later.
  //
  // carried() is now the one list, taken by the login path and by /reset. This is
  // the guard: everything capture() writes must either come back out of carried()
  // or be one of the fields restored from the ship instead.
  const RESTORED_ELSEWHERE = [...SHIP_FIELDS, 'co', 'mapId', 'x', 'y', 'seen', 'played'];
  const rich = newAccount('rich', 3, 1000);
  Object.assign(rich, { credits: 412_000, xp: 90_000, lab: { slot: 2, mods: 7, since: 1000 },
                        kills: { drifter: 412 }, berths: ['hxi4'], devices: { recall: 1 },
                        gear: { emitter5: 4 }, hold: { iron: 30 }, vault: { void: 2 } });
  const ship = newShip(0, 0, rich.hull, rich.fit, [], rich.formation, null, rich.lab.mods);
  const live = { ship, ...carried(rich), co: rich.co, mapId: rich.mapId,
                 acted: 2000, banked: 1000 };
  const wrote = capture({}, live, 2000);
  const missing = Object.keys(wrote).filter(k => !RESTORED_ELSEWHERE.includes(k)
                                             && !(k in carried(rich)));
  check('everything an account carries is handed back when a pilot is re-seeded',
    missing.length === 0,
    missing.length ? `capture() writes ${missing.join(', ')} and carried() does not` :
      `${Object.keys(wrote).length} fields written, ${Object.keys(carried(rich)).length} carried, ` +
      `${RESTORED_ELSEWHERE.length} restored from the ship — none unaccounted for`);

  const fresh = newAccount('rich', 3, 3000);
  const after = { ...live };
  Object.assign(after, carried(fresh));
  check('a reset pilot has no research station and no ladder on their hull',
    after.lab === null && after.credits === 0 && after.xp === 0,
    'it said "a starter hull, no credits, and your own dock again" and left a x4 hull standing');
  check('and nothing else of the old pilot survives it either',
    Object.keys(after.kills).length === 0 && after.berths.length === 0
    && Object.keys(after.gear).length === 0 && Object.keys(after.hold).length === 0,
    'the threat file, the berths, the locker and the hold all go with it');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — accounts'}\n`);
process.exit(fails.length ? 1 : 0);
