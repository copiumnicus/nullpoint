import { ABILITIES, abilityOf, driveOf, cloakOf, swellOf, dragOf, lockOf, reachOf,
         VEIL_DEPTH, VEIL_RECOVER, ANCHOR_SWELL, ANCHOR_DRAG, LOCK_REACH, SPECIAL }
  from '../shared/ability.js';
import { HULLS } from '../shared/ships.js';
import { newShip, stepVitals, shieldMax, speedOf, rangeOf, veilOf } from '../shared/sim.js';
import { SYSTEMS, levelOf } from '../shared/power.js';
import { seekerOn } from '../shared/rockets.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const fit = { weapon: [], generator: [], tech: [] };
const ship = h => newShip(0, 0, h, fit, []);
const drive = (s, lvl) => { s.power.to = SPECIAL; s.power.special = lvl; return s; };
const H = h => HULLS[h];

console.log('\nthe fourth system');
check('it routes like the other three', SYSTEMS.includes(SPECIAL) && SYSTEMS.length === 4,
  SYSTEMS.join(' '));
check('every purchasable hull has one, and the starter does not',
  Object.keys(HULLS).every(k => (k === 'hauler') === !H(k).ability),
  Object.keys(HULLS).map(k => `${k} ${H(k).ability ?? 'none'}`).join(', '));
check('no two hulls share an ability',
  new Set(Object.values(HULLS).map(h => h.ability).filter(Boolean)).size === 3);
check('every ability names the hull it belongs to, and they agree',
  Object.entries(ABILITIES).every(([k, a]) => H(a.hull)?.ability === k));

console.log('\nnone of them is a switch');
// A binary ability is either the obvious choice or never worth it. The interesting
// question — how much of my reactor is this worth right now — needs a dial.
for (const [kind, read] of [['veil', (s, h) => 1 - cloakOf(h, s.power, s.stats, 1e9)],
                            ['anchor', (s, h) => swellOf(h, s.power, s.stats) - 1],
                            ['lock', (s, h) => lockOf(h, s.power, s.stats)]]) {
  const hull = H(ABILITIES[kind].hull), s = ship(ABILITIES[kind].hull);
  const at = l => read(drive(s, l), hull);
  check(`${ABILITIES[kind].name} climbs with the power routed to it`,
    at(0) === 0 && at(0.5) > 0 && at(1) > at(0.5) && at(0.5) < at(1),
    `0 -> ${at(0.5).toFixed(2)} -> ${at(1).toFixed(2)} as the dial goes round`);
}

console.log('\nVeil: do not be seen');
{
  const k = ship('kestrel');
  check('at rest a Kestrel is as findable as anything else', veilOf(drive(k, 0)) === 1);
  check('at full it is found only well inside knife range',
    Math.abs(veilOf(drive(k, 1)) - (1 - VEIL_DEPTH)) < 1e-9,
    `detection range x${veilOf(k).toFixed(2)} — not zero, because a ship nothing can ever see is an exit from the game`);
  // The rule the Bandit already lives by: working is what exposes camouflage.
  drive(k, 1); k.sinceShot = 0;
  check('firing gives it away completely', veilOf(k) === 1, 'the shot is the tell');
  k.sinceShot = VEIL_RECOVER / 2;
  check('and the veil rebuilds from nothing rather than snapping back',
    veilOf(k) > 1 - VEIL_DEPTH && veilOf(k) < 1,
    `half way back it is x${veilOf(k).toFixed(2)}`);
  k.sinceShot = VEIL_RECOVER;
  check('whole again after the stated time', Math.abs(veilOf(k) - (1 - VEIL_DEPTH)) < 1e-9,
    `${VEIL_RECOVER}s`);
  check('and no other hull is hidden by any of this',
    ['hauler', 'vanguard', 'bulwark'].every(h => veilOf(drive(ship(h), 1)) === 1),
    'nothing else in the game changes');
}

console.log('\nAnchor: do not be hurt');
{
  const b = drive(ship('bulwark'), 1);
  stepVitals(b, 1 / 30, false);
  check('shields swell fourfold at full',
    Math.abs(swellOf(H('bulwark'), b.power, b.stats) - (1 + ANCHOR_SWELL)) < 1e-9,
    `x${1 + ANCHOR_SWELL}`);
  check('and the pool really grows, charge and all',
    shieldMax(b) > b.stats.shield * 3.5,
    `${Math.round(shieldMax(b))} against a base ${b.stats.shield}`);
  check('but a wall cannot leave',
    Math.abs(speedOf(b) - b.stats.speed * (1 - ANCHOR_DRAG)) < 1e-9,
    `${Math.round(speedOf(b))} of ${b.stats.speed} — down to a fifth`);
  check('and it is never actually nailed to the floor', speedOf(b) > 0,
    'a ship that cannot move at all is repositioned only by whatever is shooting it');
  check('the two halves cannot come apart', (() => {
    const half = drive(ship('bulwark'), 0.5);
    return swellOf(H('bulwark'), half.power, half.stats) > 1 && speedOf(half) < half.stats.speed;
  })(), 'you never get the wall without the anchor');
}

console.log('\nLock: do not miss');
{
  const v = ship('vanguard');
  const bandit = { x: 400, y: 0, heading: Math.PI, def: { stealth: true } };
  const rocket = { x: 0, y: 0, age: 0.2, seed: 3 };
  const wob = l => seekerOn(rocket, bandit, l).wobble;
  check('an unlocked seeker still guesses against camouflage', wob(0) > 0,
    `${wob(0).toFixed(0)}px of aim error`);
  check('and the guessing shrinks in proportion, not in one step',
    Math.abs(wob(0.5) - wob(0) / 2) < 1e-9 && wob(1) === 0,
    `${wob(0).toFixed(0)} -> ${wob(0.5).toFixed(0)} -> ${wob(1).toFixed(0)}px`);
  check('a full lock never loses the target',
    Array.from({ length: 50 }, () => seekerOn(rocket, bandit, 1).locked).every(Boolean));
  check('it does nothing at all against something that was never hiding',
    seekerOn(rocket, { x: 1, y: 1, def: {} }, 0).wobble === 0,
    'Lock buys aim, and only aim');
  check('but it costs reach, so you have to close',
    Math.abs(rangeOf(drive(v, 1)) - v.stats.weaponRange * (1 - LOCK_REACH)) < 1e-9,
    `${Math.round(rangeOf(v))} of ${v.stats.weaponRange}`);
  check('and it cannot help with dodging, only with aiming',
    lockOf(H('vanguard'), drive(v, 1).power, v.stats) === 1 &&
    seekerOn(rocket, bandit, 1).wobble === 0,
    'a Bandit that breaks the firing line still breaks it');
}

console.log('\nnobody gets a free lunch');
check('every ability is paid for out of the same capacitor as the guns',
  Object.values(ABILITIES).every(a => {
    const s = drive(ship(a.hull), 1);
    return levelOf(s.power, 'weapons', s.stats) === 0;   // routed to special, so not to guns
  }), 'capacitor spent being invisible is capacitor not spent shooting');
check('and the Hauler is not quietly given one by accident',
  abilityOf(H('hauler')) === null && cloakOf(H('hauler'), { to: SPECIAL, special: 1 }, {}, 1e9) === 1);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — 3 abilities'}\n`);
process.exit(fails.length ? 1 : 0);
