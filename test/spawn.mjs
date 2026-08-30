import { respawnDelay, refillRate, CROWD_STEP, EMPTY_STEP, MIN_RESPAWN } from '../shared/spawn.js';
import { readFileSync } from 'node:fs';
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

// The complaint this whole file exists for, reproduced as numbers.
//
// "I killed two on the map, and then I couldn't find one for, like, three minutes
// flying around." Measured against a live server it was 180.9 seconds from the
// first kill to the next sighting, and it was not bad luck: two Leviathans is the
// smallest population of any farmable hostile and 90s is the second-longest
// respawn, so the sector is guaranteed empty for a minute and a half.
//
// Visibility was checked and is NOT the problem — 80.2% of a three-minute sweep of
// m3 had a Leviathan on radar, longest gap 10.3s. Once one exists it is easy to
// find. The wait is the timer.
{
  const LEV = ALIENS.leviathan.respawn;            // 90s posted
  const KILL_TWO = 62;                             // s between the two kills, measured live
  const solo = respawnDelay(LEV, { pilots: 1, alive: 0, total: 2 });
  check('a pilot who clears both Leviathans is never left with an empty sector',
    solo < KILL_TWO,
    `${solo}s to come back against the ${KILL_TWO}s it took to kill the second, ` +
    'so the first is already home before the fight ends — it was 90s, and the sector went quiet');
  check('and a second pilot cuts that again, because two ships strip a sector twice as fast',
    respawnDelay(LEV, { pilots: 2, alive: 0, total: 2 }) < solo * 0.7,
    `${respawnDelay(LEV, { pilots: 2, alive: 0, total: 2 }).toFixed(1)}s for two against ${solo}s for one`);
  check('a quiet, full sector is not sped up at all',
    respawnDelay(LEV, { pilots: 1, alive: 2, total: 2 }) === LEV,
    `${LEV}s posted, ${LEV}s delivered — nothing comes back faster for free`);
}

// A boss is an event, not a population. The Corsair Hive's respawn comment says
// "five minutes. It is the only one, and it should be an event", and its total is
// one — so a naive reading of "how much of this kind is standing" says FULLY
// STRIPPED the instant it dies, and a party of four would have it back in 54s.
// The server excludes anything that broods from the census for exactly this.
check('a boss is left out of it, or beating one would earn you three an hour',
  ALIENS.hive.broods && respawnDelay(ALIENS.hive.respawn, { pilots: 4, alive: 0, total: 1 }) < 60,
  `unexcluded, four pilots would see the Hive back in ` +
  `${respawnDelay(ALIENS.hive.respawn, { pilots: 4, alive: 0, total: 1 }).toFixed(0)}s instead of ${ALIENS.hive.respawn}s — ` +
  'which is why server.js skips a.def.broods when counting');

// And the thing that would have caught the real bug here, which no assertion about
// respawnDelay could: this module was written, tested and imported by NOTHING for
// two versions. Every claim above passed the whole time. Same idiom as the test
// that every module index.html pulls in is reachable over HTTP.
{
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  check('the respawn rate these tests describe is the one the server actually runs',
    /import\s*\{[^}]*\brespawnDelay\b[^}]*\}\s*from\s*'\.\/shared\/spawn\.js'/.test(src)
    && /a\.dead\s*-=\s*dt\s*\*\s*refill\(a\)/.test(src),
    'server.js imports respawnDelay and scales the countdown by it — it did neither for two versions');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — sectors refill to fit'}\n`);
process.exit(fails.length ? 1 : 0);
