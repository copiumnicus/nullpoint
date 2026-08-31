import { ABILITIES, abilityOf, driveOf, cloakOf, swellOf, dragOf, drumOf, reachOf,
         VEIL_DEPTH, VEIL_RECOVER, ANCHOR_SWELL, ANCHOR_DRAG,
         DRUMFIRE_GAIN, DRUMFIRE_REACH, SPECIAL }
  from '../shared/ability.js';
import { HULLS, FIRE_RATE, resolve, slotsOf, baysOf } from '../shared/ships.js';
import { topTier } from '../shared/gear.js';
import { newShip, stepVitals, shieldMax, speedOf, rangeOf, rateOf, veilOf } from '../shared/sim.js';
import { SYSTEMS, levelOf } from '../shared/power.js';
import { seekerOn, ROCKET_RATE, launch, stepRockets, launcherCap } from '../shared/rockets.js';
import { fire, stepBolts } from '../shared/combat.js';

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
                            ['drumfire', (s, h) => drumOf(h, s.power, s.stats) - 1]]) {
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

console.log('\nDrumfire: do not let up');
// This section used to be "Lock: do not miss" and every claim in it was about
// closing the gap between what a seeker could see and a perfect return. The
// ability is gone — a technology on the open shelf, the Aspect Filter, already
// reveals a Bandit from any angle, so the one thing Lock beat was beaten on a hull
// most people fly against the bestiary. The rules it was keeping did not go with
// it, and they are below in their new form: it climbs with the dial, it costs
// reach, and the two halves cannot come apart. What is deliberately NOT here any
// more is any claim that a pilot can sharpen a seeker; the seeker claims that are
// about STEALTH rather than about the ability moved down a line and stayed.
{
  const v = ship('vanguard');
  const bandit = { x: 400, y: 0, heading: Math.PI, def: { stealth: true } };
  const rocket = { x: 0, y: 0, age: 0.2, seed: 3 };
  check('a seeker still guesses against camouflage, and nothing a pilot fits sharpens it',
    seekerOn(rocket, bandit).wobble > 0 &&
    seekerOn(rocket, { x: 1, y: 1, def: {} }).wobble === 0,
    `${seekerOn(rocket, bandit).wobble.toFixed(0)}px of aim error against a Bandit and none against ` +
    'anything that was never hiding — the counter is the Aspect Filter, which any hull may buy');

  check('at rest a Vanguard fires exactly as fast as anything else',
    drumOf(H('vanguard'), drive(v, 0).power, v.stats) === 1 &&
    Math.abs(rateOf(drive(v, 0)) - FIRE_RATE) < 1e-9,
    `${FIRE_RATE}/s, the one cycle rate every hull has`);
  check('at a full drum everything it carries cycles two and a half times as fast',
    Math.abs(drumOf(H('vanguard'), drive(v, 1).power, v.stats) - (1 + DRUMFIRE_GAIN)) < 1e-9,
    `x${(1 + DRUMFIRE_GAIN).toFixed(4)} — guns at ${rateOf(drive(v, 1)).toFixed(2)}/s against ${FIRE_RATE}/s`);
  check('and it costs reach, so you have to close',
    Math.abs(rangeOf(drive(v, 1)) - v.stats.weaponRange * (1 - DRUMFIRE_REACH)) < 1e-9,
    `${Math.round(rangeOf(v))} of ${v.stats.weaponRange}`);

  // THE DERIVATION, measured rather than restated.
  //
  // Rewritten, not deleted. It read "reach times rate is conserved: a full drum is
  // the same damage per metre of reach", because the gain used to BE the cost read
  // back through 1/(1 - cost). That was elegant and it produced an ability nobody
  // would switch on — worth 3.8% over simply routing the same reactor to the guns,
  // which every hull can do. The design target replaced it and the claim follows:
  // A FULL DRUM THROWS TWICE WHAT AN INTERCEPTOR DOES WITH ITS REACTOR ON ITS GUNS.
  //
  // Measured through the real loop against the real shop, so DRUMFIRE_GAIN cannot
  // quietly stop meaning this the next time the emitter ladder or a slot count
  // moves — which is the whole reason it is a test and not a comment.
  const TOP = topTier('weapon'), CELL = topTier('generator');
  const full = (hull, weapon, sys, lvl) => {
    const a = newShip(0, 0, hull, { weapon, generator: Array(slotsOf(hull).generator).fill(CELL), tech: [] },
                      Array(baysOf(hull)).fill(TOP));
    a.power.to = sys; if (sys) a.power[sys] = lvl;
    a.heading = 0;
    const tgt = newShip(Math.max(60, rangeOf(a) * 0.4), 0, 'hauler', fit, []);
    tgt.stats = { ...tgt.stats, hull: 1e15, shield: 0 }; tgt.hp = 1e15; tgt.shield = 0;
    const bolts = [], rockets = [];
    let dealt = 0;
    for (let t = 0; t < 60; t += 1 / 30) {
      a.power.charge = 1e9;                     // the gun, not the tank
      for (const b of fire(a, tgt, 1 / 30)) bolts.push(b);
      for (const r of launch(a, tgt, 1 / 30)) rockets.push(r);
      for (const h of stepBolts(bolts, 1 / 30)) dealt += h.split.shield + h.split.hull;
      for (const h of stepRockets(rockets, 1 / 30)) dealt += h.split.shield + h.split.hull;
    }
    return dealt / 60;
  };
  const gunsOf2 = h => Array(slotsOf(h).weapon).fill(TOP);
  const racksOf2 = h => { const lc = Math.min(launcherCap(h), slotsOf(h).weapon);
    return [...Array(lc).fill('pod3'), ...Array(slotsOf(h).weapon - lc).fill(TOP)]; };
  const K = { guns: full('kestrel', gunsOf2('kestrel'), 'weapons', 1),
              racks: full('kestrel', racksOf2('kestrel'), 'weapons', 1) };
  const V = { guns: full('vanguard', gunsOf2('vanguard'), SPECIAL, 1),
              racks: full('vanguard', racksOf2('vanguard'), SPECIAL, 1) };
  check('a full drum throws twice what an interceptor does with its reactor on its guns', (() => {
    // A band rather than a point, and the band is the 30Hz tick: a cycle is
    // `1 / rate` counted down in whole ticks, so what a rack achieves is a
    // staircase. On the guns build x2.50 and x2.60 of the dial land on the SAME
    // step and the next one up overshoots to x2.08 — x2.50 is the closest either
    // side of twice, and the 6% between the two builds is that staircase.
    return V.guns / K.guns > 1.85 && V.guns / K.guns < 2.15
        && V.racks / K.racks > 1.85 && V.racks / K.racks < 2.15;
  })(), `guns x${(V.guns / K.guns).toFixed(2)} (${V.guns.toFixed(0)} against ${K.guns.toFixed(0)}), ` +
        `racks x${(V.racks / K.racks).toFixed(2)} (${V.racks.toFixed(0)} against ${K.racks.toFixed(0)}). ` +
        `The two builds solve for x${(2 * K.guns / (V.guns / (1 + DRUMFIRE_GAIN))).toFixed(4)} and ` +
        `x${(2 * K.racks / (V.racks / (1 + DRUMFIRE_GAIN))).toFixed(4)} of the cycle, and the shipped ` +
        `x${(1 + DRUMFIRE_GAIN).toFixed(2)} sits between them — one constant, both builds, neither averaged away`);
  check('and it is a real power gain bought with reach, not a reshaping of the same gun', (() => {
    // The claim that replaced conservation, and the reason the old number was wrong:
    // routing the same reactor to the guns is worth x1.44 to ANY hull, so an ability
    // that beat it by 3.8% was a sidegrade of a thing everybody already has.
    const cold = full('vanguard', gunsOf2('vanguard'), null, 0);
    const wep  = full('vanguard', gunsOf2('vanguard'), 'weapons', 1);
    return V.guns / wep > 1.55 && V.guns / cold > 2.3;
  })(), (() => {
    const cold = full('vanguard', gunsOf2('vanguard'), null, 0);
    const wep = full('vanguard', gunsOf2('vanguard'), 'weapons', 1);
    return `${cold.toFixed(0)} cold, ${wep.toFixed(0)} with the reactor on the guns, ${V.guns.toFixed(0)} at a ` +
           `full drum — x${(V.guns / wep).toFixed(2)} over the routing every hull already has, where the ` +
           `conserved version managed x1.04. Damage per metre of reach goes 5.22M -> ` +
           `${(V.guns * v.stats.weaponRange * (1 - DRUMFIRE_REACH) / 1e6).toFixed(2)}M, against a finished ` +
           `Bulwark's 8.88M: it buys burst, and it still does not win efficiency`;
  })());
  check('and the two halves cannot come apart, at any setting of the dial', (() => {
    for (let i = 1; i <= 100; i++) {
      const s = drive(ship('vanguard'), i / 100);
      if (!(drumOf(H('vanguard'), s.power, s.stats) > 1 && rangeOf(s) < s.stats.weaponRange)) return false;
    }
    return true;
  })(), 'you never get the cadence without the closing — both come off the same drive, the way an Anchor does');

  // Measured with the real fire()/launch() loop, because the ability has to reach
  // the CYCLE and not just the stat: combat.js read stats.fireRate in two places
  // and rockets.js has a cooldown of its own that fireRate never touched.
  const shots = (hull, weapon, lvl, secs) => {
    const a = drive(newShip(0, 0, hull, { weapon, generator: [], tech: [] }, []), lvl);
    a.heading = 0;
    const tgt = newShip(rangeOf(a) * 0.5, 0, 'hauler', fit, []);
    tgt.stats = { ...tgt.stats, hull: 1e12 }; tgt.hp = 1e12;
    let bolts = 0, rockets = 0;
    for (let t = 0; t < secs; t += 1 / 30) {
      bolts += fire(a, tgt, 1 / 30).length;
      rockets += launch(a, tgt, 1 / 30).length;
    }
    return { bolts, rockets };
  };
  const guns = [shots('vanguard', ['emitter3', 'emitter3', 'emitter3'], 0, 30),
                shots('vanguard', ['emitter3', 'emitter3', 'emitter3'], 1, 30)];
  const racks = [shots('vanguard', ['pod3', 'pod3', 'pod3', 'pod3', 'pod3'], 0, 30),
                 shots('vanguard', ['pod3', 'pod3', 'pod3', 'pod3', 'pod3'], 1, 30)];
  check('the guns really do fire faster, over a real thirty seconds',
    guns[1].bolts / guns[0].bolts > 2.2 && guns[1].bolts / guns[0].bolts < 2.6,
    `${guns[0].bolts} bolts becomes ${guns[1].bolts} — x${(guns[1].bolts / guns[0].bolts).toFixed(3)} ` +
    `against the x${(1 + DRUMFIRE_GAIN).toFixed(3)} claimed`);
  check('and so do the racks, which is the build this hull is actually for',
    racks[1].rockets / racks[0].rockets > 2.2 && racks[1].rockets / racks[0].rockets < 2.6,
    `${racks[0].rockets} rockets becomes ${racks[1].rockets} — x${(racks[1].rockets / racks[0].rockets).toFixed(3)}. ` +
    'The Vanguard is the one hull that may fill all five hardpoints with racks, so an ability that only ' +
    'moved fireRate would have handed its signature build nothing at all');
  check('a volley is still a volley: more of them, never bigger ones', (() => {
    const a = drive(newShip(0, 0, 'vanguard', { weapon: Array(5).fill('pod3'), generator: [], tech: [] }, []), 1);
    a.heading = 0;
    const tgt = newShip(200, 0, 'hauler', fit, []);
    tgt.stats = { ...tgt.stats, hull: 1e12 }; tgt.hp = 1e12;
    let biggest = 0;
    for (let t = 0; t < 10; t += 1 / 30) {
      const v2 = launch(a, tgt, 1 / 30);
      biggest = Math.max(biggest, v2.length);
    }
    return biggest === Math.round(a.stats.rockets);
  })(), 'the rate is applied to the rack\'s cooldown and nowhere else, so five rails stay five rails');

  // No other hull may be given any of this by accident, which is the same claim the
  // Veil block makes one section up and the reason these are classes at all.
  check('and no other hull cycles any faster for routing to a system it does not have',
    ['hauler', 'kestrel', 'bulwark'].every(h => {
      const s = drive(ship(h), 1);
      return drumOf(H(h), s.power, s.stats) === 1 && rateOf(s) === s.stats.fireRate;
    }), 'nothing else in the game changes');
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
