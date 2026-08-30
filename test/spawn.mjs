import { respawnDelay, refillRate, CROWD_STEP, EMPTY_STEP, MIN_RESPAWN } from '../shared/spawn.js';
import { ALIENS, SPAWN_CLEAR } from '../shared/aliens.js';
import { resolve, DEFAULT_HULL } from '../shared/ships.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const D = ALIENS.drifter.respawn;
const at = (pilots, share) => respawnDelay(D, { pilots, alive: share * 7, total: 7 });

console.log('\na sector alone is the sector as posted');
check('one pilot on a full sector gets exactly the posted rate', at(1, 1) === D,
  `${D}s, the number written in aliens.js`);
check('and every hostile keeps its own shape',
  respawnDelay(ALIENS.hive.respawn, { pilots: 1 }) > respawnDelay(ALIENS.drifter.respawn, { pilots: 1 }),
  'a Hive still comes back long after a Drifter — the rate scales, the bestiary does not flatten');

console.log('\nmore pilots, more hostiles');
// Two ships that move well strip a home sector faster than a fixed timer restocks
// it, and then spend the next minute crossing empty space.
check('a second pilot speeds it up, but not by double', (() => {
  const r = at(1, 1) / at(2, 1);
  return r > 1.3 && r < 2;
})(), `${(at(1, 1) / at(2, 1)).toFixed(2)}x — two pilots do not kill twice as fast, they share targets`);
check('it keeps climbing with the fourth and the sixth',
  at(2, 1) > at(3, 1) && at(3, 1) > at(4, 1),
  `${at(2, 1).toFixed(1)}s, ${at(3, 1).toFixed(1)}s, ${at(4, 1).toFixed(1)}s`);
check('so the fourth pilot is not queueing behind the first three',
  at(4, 1) < at(1, 1) / 2);

console.log('\nand an empty sector refills faster than a full one');
check('a picked-clean sector comes back quicker than a standing one',
  at(1, 0) < at(1, 1), `${at(1, 0).toFixed(1)}s against ${at(1, 1).toFixed(1)}s`);
check('and the pressure comes off on its own as it fills',
  at(1, 0) < at(1, 0.5) && at(1, 0.5) < at(1, 1),
  'self-correcting — nothing has to decide when to stop');
check('the two stack, because they are different questions',
  at(2, 0) < at(2, 1) && at(2, 0) < at(1, 0),
  `two pilots on a stripped sector: ${at(2, 0).toFixed(1)}s against a posted ${D}s`);

console.log('\nbut never a fountain');
check('nothing comes back faster than the floor',
  [1, 4, 12, 99].every(p => respawnDelay(D, { pilots: p, alive: 0, total: 7 }) >= MIN_RESPAWN),
  `${MIN_RESPAWN}s — a hostile that reappears as it dies is a spawn camp, not a population`);
check('a hostile with no respawn at all still has none', respawnDelay(0, { pilots: 9 }) === 0);
check('and nonsense in gives a number out, not NaN',
  Number.isFinite(respawnDelay(D, { pilots: 0, alive: -3, total: 0 })));

console.log('\nwhy this was needed at all');
// The other half of the problem is that hostiles deliberately respawn away from
// anyone watching, so the more of a sector is covered, the further "away" is.
const walk = resolve(DEFAULT_HULL).speed;
check('the respawn clearance alone is a long flight on a quiet map',
  SPAWN_CLEAR / walk > 5,
  `${SPAWN_CLEAR}px is ${(SPAWN_CLEAR / walk).toFixed(0)}s of flying in a starter hull — ` +
  'which is why the rate had to follow the sector, not the clock');
check('the readout says how much faster than posted a sector is running',
  Math.abs(refillRate({ pilots: 1, alive: 1, total: 1 }) - 1) < 1e-9
  && refillRate({ pilots: 4, alive: 0, total: 7 }) > 2,
  `quiet and full reads 1.00x, four pilots on a stripped sector reads ` +
  `${refillRate({ pilots: 4, alive: 0, total: 7 }).toFixed(2)}x`);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — sectors refill to fit'}\n`);
process.exit(fails.length ? 1 : 0);
