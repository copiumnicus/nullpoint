import { stepContacts, ALLY, FRESH, STALE } from '../shared/radar.js';
import { newShip } from '../shared/sim.js';
import { HULLS, ATTRS, resolve } from '../shared/ships.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const mk = (id, co, hull, x, y, fit = []) => ({ id, co, ship: newShip(x, y, hull, fit), contacts: new Map() });

console.log('\nhull sensors');
const rad = Object.entries(HULLS).map(([k, h]) => [h.name, h.attrs.radar, h.attrs.signature]);
rad.forEach(([n, r, s]) => console.log(`     ${n.padEnd(9)} radar ${String(r).padStart(5)}   signature ${s}s`));
check('every hull has its own radar range', new Set(rad.map(r => r[1])).size === rad.length);
check('smaller hulls stay on the plot for less time',
  HULLS.kestrel.attrs.signature < HULLS.vanguard.attrs.signature
  && HULLS.vanguard.attrs.signature < HULLS.bulwark.attrs.signature);
check('signature counts as a drawback, not a bonus', ATTRS.signature.better === 'low');

console.log('\nwho is visible');
const me = mk(1, 'm', 'vanguard', 0, 0);                       // radar 2600
const wing = mk(2, 'm', 'kestrel', 11000, 7000);               // ally, far away
const near = mk(3, 'h', 'kestrel', 2000, 0);                   // enemy inside range
const far  = mk(4, 'h', 'kestrel', 9000, 0);                   // enemy well outside
let seen = stepContacts(me, [me, wing, near, far], dt);
check('you always see yourself', seen.get(1) === ALLY);
check('allies transmit from anywhere', seen.get(2) === ALLY, '11000px away, still plotted');
check('an enemy inside the radius is a live contact', seen.get(3) === FRESH);
check('an enemy outside it never reaches you at all', !seen.has(4));

console.log('\nholding a track');
far.ship.x = 2400; seen = stepContacts(me, [me, far], dt);      // closes to inside range
check('closing to range acquires the track', seen.get(4) === FRESH);
far.ship.x = 9000;                                             // and runs
let held = 0;
for (let i = 0; i < 30 * 12; i++) {
  seen = stepContacts(me, [me, far], dt);
  if (seen.get(4) === STALE) held += dt; else if (!seen.has(4)) break;
}
check('the track fades after exactly the target signature',
  Math.abs(held - HULLS.kestrel.attrs.signature) < 0.1, `${held.toFixed(2)}s vs ${HULLS.kestrel.attrs.signature}s`);
check('and then it is gone', !stepContacts(me, [me, far], dt).has(4));

const linger = (hull) => {
  const v = mk(1, 'm', 'vanguard', 0, 0), t = mk(9, 'h', hull, 1000, 0);
  stepContacts(v, [v, t], dt);
  t.ship.x = 99999;
  let s = 0;
  while (stepContacts(v, [v, t], dt).get(9) === STALE) s += dt;
  return s;
};
const lk = linger('kestrel'), lb = linger('bulwark');
check('a cruiser is far harder to shake than an interceptor', lb > lk * 2,
  `kestrel ${lk.toFixed(1)}s vs bulwark ${lb.toFixed(1)}s`);

console.log('\nfitting changes what you see');
const blind = mk(1, 'm', 'kestrel', 0, 0);                     // radar 2000
const scout = mk(1, 'm', 'kestrel', 0, 0, ['array']);          // +45% -> 2900
const bogey = mk(5, 'h', 'vanguard', 2500, 0);
check('a sensor array finds what a bare hull cannot',
  !stepContacts(blind, [blind, bogey], dt).has(5)
  && stepContacts(scout, [scout, bogey], dt).get(5) === FRESH, '2500px out');
check('but it makes you louder', resolve('kestrel', ['array']).signature > resolve('kestrel', []).signature);
const quiet = resolve('bulwark', ['damper']);
check('a damper halves your signature and costs you range',
  quiet.signature === HULLS.bulwark.attrs.signature / 2 && quiet.radar < HULLS.bulwark.attrs.radar,
  `${quiet.signature}s, radar ${quiet.radar}`);

console.log('\nsector isolation');
const other = mk(6, 'h', 'bulwark', 10, 10);                   // same spot, different map: not in the list
check('a ship in another sector is not even considered', !stepContacts(me, [me], dt).has(6));

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — radar'}\n`);
process.exit(fails.length ? 1 : 0);
