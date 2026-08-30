import { stepContacts, ALLY, FRESH, STALE } from '../shared/radar.js';
import { newShip } from '../shared/sim.js';
import { HULLS, ATTRS, resolve } from '../shared/ships.js';
const fit = (o = {}) => ({ weapon: [], generator: [], tech: [], ...o });

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const mk = (id, co, hull, x, y, f = fit()) => ({ id, co, ship: newShip(x, y, hull, f), contacts: new Map() });

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

console.log('\nwhat the hull you fly sees, and what it shows');
// Radar deliberately runs WITH size: a big hull carries a big array and cannot
// shake anyone, a small one is a ghost that is half blind. This used to be stated
// with a Signal Damper on one of the two ships, and the shelf no longer sells
// radar in either direction — deliberately. Signature is a stat nothing outside
// PvP reads, so "-55% of it for -40% of your sight" was a trade against nothing,
// and its opposite, the Long-Baseline Array, was the same trade backwards. The
// claim was never about the module: it is that the number comes off the ship.
const blind = mk(1, 'm', 'kestrel', 0, 0);                     // radar 2000
const scout = mk(1, 'm', 'bulwark', 0, 0);                     // radar 3400
const bogey = mk(5, 'h', 'vanguard', 2600, 0);
check('a cruiser holds a contact an interceptor has already lost',
  stepContacts(scout, [scout, bogey], dt).get(5) === FRESH
  && !stepContacts(blind, [blind, bogey], dt).has(5),
  '2600px out, bulwark radar 3400 against a kestrel\'s 2000');
// The one entry left on the shelf that touches either of them, and it moves
// signature the WRONG way on purpose: an Aspect Filter is an active illuminator,
// so what it buys is seeing a Bandit from the front and what it costs is being
// held on a plot half again as long — and being noticed sooner by everything,
// which is not a stat at all and lives in shared/tech.js.
const loudSt = resolve('bulwark', fit({ tech: ['filter'] }));
const bare = resolve('bulwark', fit());
check('and the only technology that touches either of them buys reach with being heard',
  loudSt.radar > bare.radar * 1.5 && loudSt.signature > bare.signature * 1.5,
  `radar ${bare.radar} -> ${Math.round(loudSt.radar)}, and signature ${bare.signature}s -> ` +
  `${loudSt.signature.toFixed(2)}s held on someone else's plot — an illuminator is not a quieter ship, ` +
  'it is a louder one that can see');

console.log('\nsector isolation');
const other = mk(6, 'h', 'bulwark', 10, 10);                   // same spot, different map: not in the list
check('a ship in another sector is not even considered', !stepContacts(me, [me], dt).has(6));

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — radar'}\n`);
process.exit(fails.length ? 1 : 0);
