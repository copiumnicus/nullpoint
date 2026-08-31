import { AMMO, AMMO_KEYS, FEEDS, forWeapon, DEFAULT_AMMO, STARTING_AMMO,
         sanitiseAmmo, sanitiseUsing, magazine, hasRounds, roundPrice,
         barLayout, feedMenu, BAR_SLOTS } from '../shared/ammo.js';
import { newShip } from '../shared/sim.js';
import { fire } from '../shared/combat.js';
import { launch, ROCKET_RATE } from '../shared/rockets.js';
import { sanitiseFit, EQUIPMENT } from '../shared/gear.js';
import { slotsOf, resolve, gunsOf, FIRE_RATE } from '../shared/ships.js';
import { newAccount, sanitiseAccount, capture } from '../shared/account.js';
import { KITS, KIT_KEYS, whyNotRepair, KIT_QUIET, sanitiseKits } from '../shared/repair.js';
import { ALIENS, WILD, effectiveHp, bountyFor, BOUNTY_RATE } from '../shared/aliens.js';
import { premiumAt, ANCHORS, dpsOf } from '../shared/balance.js';
import { BOOST } from '../shared/power.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const fit = o => ({ weapon: [], generator: [], tech: [], ...o });
const mark = (x, y) => ({ x, y, vx: 0, vy: 0, r: 20, hp: 1e9, shield: 1e9, sinceHit: 0,
                          shieldHit: 0, stats: { hull: 1e9, shield: 1e9 } });

console.log('\nthe grades');
for (const f of FEEDS) {
  const g = forWeapon(f);
  console.log(`     ${f.padEnd(7)}` + g.map(k =>
    `${AMMO[k].name} x${AMMO[k].mult.toFixed(2)} @${roundPrice(k).toFixed(2)}cr`).join('   '));
  check(`${f}s have grades, cheapest first by tier`,
    g.length >= 2 && g.every((k, i) => i === 0 || AMMO[k].tier > AMMO[g[i - 1]].tier));
  // REWRITTEN, because the ladder grew a rung that does not buy damage. It read
  // "a better round hits harder and costs more", which was the whole truth while
  // heat was the only thing a round could be spent on. The long grade buys
  // DISTANCE instead, and hits softer for it — so the rule is not "harder" but
  // "more of something, and never for free". What a round carries is damage times
  // reach, and that is what has to climb.
  const carries = k => AMMO[k].mult * (AMMO[k].reach ?? 1);
  check(`no ${f} grade is a straight upgrade on the one below it`,
    g.every((k, i) => i === 0 || (carries(k) > carries(g[i - 1])
                               && roundPrice(k) > roundPrice(g[i - 1]))),
    g.map(k => `${AMMO[k].name} carries x${carries(k).toFixed(4)} at ${roundPrice(k).toFixed(2)}cr`).join('   '));
  check(`the default ${f} grade is the plain one`, AMMO[DEFAULT_AMMO[f]].mult === 1);

  // The number that decides whether anyone ever loads the good stuff. Fire rate
  // is fixed, so a grade's multiplier IS its dps — the only question is what the
  // extra damage costs. A Charged Cell used to be 1.25x the damage at 6.4x the
  // cost per point, which made two thirds of the shop decoration.
  // Per point of what the round CARRIES, not per point of damage. See `carries`
  // above: the two are the same number for every grade that reaches exactly as far
  // as the gun does, and they part at the long one — which would read as 3.20x a
  // punishment on damage alone while actually being the ladder's own next rung.
  const perPoint = k => roundPrice(k) / carries(k);
  console.log(`     ${f.padEnd(7)}` + g.map(k =>
    `${AMMO[k].name} ${perPoint(k).toFixed(3)}cr/pt`).join('   '));
  check(`a better ${f} round is a premium, not a punishment`,
    g.every((k, i) => i === 0 || perPoint(k) <= perPoint(g[0]) * premiumAt(AMMO[g.at(-1)].tier) + 1e-9),
    `worst grade costs ${(perPoint(g.at(-1)) / perPoint(g[0])).toFixed(2)}x per point of what it carries, ` +
    'not the 6.4x that made it pointless');
  // Stronger than "climbs": it climbs by exactly the ladder's stated premium, which
  // is what makes a fourth rung a rung rather than a number somebody typed.
  check(`the ${f} premium climbs with the grade, so the plain one still has a job`,
    g.every((k, i) => i === 0 || perPoint(k) > perPoint(g[i - 1])) &&
    g.every(k => Math.abs(perPoint(k) / perPoint(g[0]) - premiumAt(AMMO[k].tier)) < 1e-9),
    g.map(k => perPoint(k).toFixed(3)).join(' > ') +
    ` cr per point — +${Math.round(ANCHORS.premium * 100)}% of the base a rung, on all ${g.length} of them`);
  // The invariant that would have caught this ladder being wrong in BOTH
  // directions. Damage tiers live in the emitters, which cost real money and take
  // a slot; a grade is a premium on whatever you already bought. So the entire
  // ammunition ladder must be worth less than a single rung of the weapon ladder.
  // At x1/x3/x5 it was worth more than the whole weapon ladder, which is how it
  // became a free x5 nobody would ever decline.
  const rungs = Object.keys(EQUIPMENT)
    .filter(k => EQUIPMENT[k].slot === 'weapon' && EQUIPMENT[k].kind !== 'rocket')
    .sort((a, b) => (EQUIPMENT[a].tier ?? 0) - (EQUIPMENT[b].tier ?? 0));
  const smallestRung = Math.min(...rungs.slice(1).map((k, i) =>
    (EQUIPMENT[k].mods?.find(m => m[0] === 'damage')?.[2] ?? 1) /
    (EQUIPMENT[rungs[i]].mods?.find(m => m[0] === 'damage')?.[2] ?? 1)));
  // On DAMAGE, deliberately, and not on what the round carries. The rule is that a
  // grade must never out-scale buying a better gun, and reach is not something the
  // gun ladder sells at any price — so folding it in here would be comparing the
  // ammunition shelf against a rung that does not exist. The best round in the game
  // is still x1.50 of the plain one, and the cheapest step between two emitters is
  // more than that.
  const ladder = Math.max(...g.map(k => AMMO[k].mult)) / Math.min(...g.map(k => AMMO[k].mult));
  check(`the whole ${f} ammunition ladder is worth less than one rung of the gun ladder`,
    ladder < smallestRung,
    `ammunition spans x${ladder.toFixed(2)} of damage against x${smallestRung.toFixed(2)} for the ` +
    `cheapest step between emitters — a grade is a premium, not a tier`);
  check(`every ${f} grade is telling them apart by colour`,
    g.every(k => /^#[0-9a-f]{6}$/i.test(AMMO[k].colour ?? '')) &&
    new Set(g.map(k => AMMO[k].colour)).size === g.length,
    g.map(k => `${AMMO[k].name} ${AMMO[k].colour}`).join(', '));
}
check('every grade feeds exactly one weapon',
  AMMO_KEYS.every(k => FEEDS.includes(AMMO[k].for)));
check('a new pilot is not sent out with an empty magazine',
  FEEDS.every(f => (STARTING_AMMO[DEFAULT_AMMO[f]] ?? 0) > 0),
  Object.entries(STARTING_AMMO).map(([k, n]) => `${n} ${k}`).join(', '));

console.log('\nspending it');
{
  const rack = newShip(0, 0, 'bulwark', fit({ weapon: Array(4).fill('emitter5') }));
  rack.heading = 0;
  const mag = { key: 'cell1', n: 10, mult: 1 };
  let fired = 0;
  for (let i = 0; i < 600; i++) fired += fire(rack, mark(400, 0), dt, mag).length;
  check('a bolt costs a round', fired === 10 && mag.n === 0, '10 rounds, 10 bolts, then nothing');

  const dry = { key: 'cell1', n: 0, mult: 1 };
  let none = 0;
  for (let i = 0; i < 300; i++) none += fire(rack, mark(400, 0), dt, dry).length;
  check('an empty magazine is a dead weapon', none === 0);

  // Aliens carry nothing and are meant to shoot forever.
  const alien = newShip(0, 0, 'vanguard', fit({ weapon: ['emitter1'] }));
  alien.heading = 0; alien.isAlien = true;
  let free = 0;
  for (let i = 0; i < 300; i++) free += fire(alien, mark(400, 0), dt).length;
  check('anything with no magazine shoots forever', free > 5, `${free} bolts with no supply passed`);

  const pods = newShip(0, 0, 'vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(3).fill('pod3') })));
  pods.heading = 0;
  const heads = { key: 'head1', n: 7, mult: 1 };
  let up = 0;
  for (let i = 0; i < 600; i++) up += launch(pods, mark(400, 0), dt, heads).length;
  check('a rack short of warheads throws what it has', up === 7 && heads.n === 0,
    '15 rockets rated, 7 in stock');
  const full = { key: 'head1', n: 999, mult: 1 };
  const one = launch(pods, mark(400, 0), dt, full);
  const short = { key: 'head1', n: 3, mult: 1 };
  pods.rocketCool = 0;
  const few = launch(pods, mark(400, 0), dt, short);
  check('and each of them still hits full weight',
    Math.abs(one[0].dmg - few[0].dmg) < 1e-6,
    'fewer rockets, not weaker ones');
}

console.log('\nwhat a grade is worth');
{
  const gun = newShip(0, 0, 'hauler', fit({ weapon: ['emitter5'] }));
  gun.heading = 0;
  const dmgWith = k => {
    const s = newShip(0, 0, 'hauler', fit({ weapon: ['emitter5'] }));
    s.heading = 0;
    for (let i = 0; i < 90; i++) {
      const v = fire(s, mark(300, 0), dt, { key: k, n: 999, mult: AMMO[k].mult });
      if (v.length) return v[0].dmg;
    }
    return 0;
  };
  const grades = forWeapon('laser');
  const dmgs = grades.map(dmgWith);
  console.log('     ' + grades.map((k, i) => `${AMMO[k].name} ${Math.round(dmgs[i])}`).join('   '));
  // REWRITTEN. It read "a better round puts more on the target", which was the
  // whole of it while heat was the only thing a round could buy. The fourth grade
  // buys distance and lands LESS than the third — that is the trade, and stating it
  // as a rule is the point: the dearest ammunition in the game, sold behind the
  // dearest gun in the game, is not the hardest-hitting ammunition in the game.
  const hot = grades.filter(k => (AMMO[k].reach ?? 1) === 1);
  check('a hotter round puts more on the target',
    hot.map(dmgWith).every((d, i, a2) => i === 0 || d > a2[i - 1]),
    hot.map(k => `${AMMO[k].name} ${Math.round(dmgWith(k))}`).join('  '));
  check('and the long round lands less than the hottest one, which is what it is buying reach with',
    dmgWith(grades.at(-1)) < dmgWith(hot.at(-1)),
    `${Math.round(dmgWith(grades.at(-1)))} against ${Math.round(dmgWith(hot.at(-1)))} — ` +
    `${Math.round(100 * (1 - AMMO[grades.at(-1)].mult / AMMO[hot.at(-1)].mult))}% off the top grade, ` +
    'and nobody pays 1,560 credits a crate for that unless the distance is worth it');
  check('and exactly as much more as it claims',
    grades.every((k, i) => Math.abs(dmgs[i] / dmgs[0] - AMMO[k].mult) < 1e-6));

  // What feeding the good stuff actually costs, so the choice is a real one.
  const heavy = fit({ weapon: Array(4).fill('emitter5') });
  const rounds = gunsOf(heavy, Array(6).fill('emitter5')) * FIRE_RATE;
  const perMin = k => rounds * roundPrice(k) * 60;
  console.log(`     a fully racked Cruiser burns ${rounds.toFixed(0)} rounds a second, held down:`);
  for (const k of grades)
    console.log(`       ${AMMO[k].name.padEnd(16)}${perMin(k).toFixed(0)} cr a minute`);
  check('the plain grade is cheap enough not to count', perMin(grades[0]) < 250,
    `${perMin(grades[0]).toFixed(0)} cr a minute, and nobody holds the trigger for a minute`);
  // This used to demand the best grade cost more than ten times the plain one to
  // hold down, so it would be "a decision". At 1.25x the damage for 34x the cost
  // a minute it was not a decision, it was a wrong answer, and nobody ever loaded
  // it. The premium has to be real — or the plain grade has no job — but it has
  // to stay under what the extra damage is worth.
  // REWRITTEN as an identity rather than a ceiling, because the ceiling had a
  // number in it — x1.5 of the damage multiplier — and the grade that buys reach
  // instead of damage read 3.9x against a 1.83x bar and failed a rule it was not
  // breaking. What the bar was really asking is that the cost per point of what the
  // round carries is the LADDER'S premium and nothing else, which is a stronger
  // claim and has no slack in it to be wrong about.
  const top = grades.at(-1), carried = k => AMMO[k].mult * (AMMO[k].reach ?? 1);
  check('the best grade costs more to hold down, by exactly the ladder\'s premium and no more',
    perMin(top) > perMin(grades[0]) &&
    Math.abs(perMin(top) / perMin(grades[0]) / carried(top) - premiumAt(AMMO[top].tier)) < 1e-9,
    `${(perMin(top) / perMin(grades[0])).toFixed(1)}x a minute for ${carried(top).toFixed(2)}x of what a ` +
    `round carries, which is the ladder's x${premiumAt(AMMO[top].tier).toFixed(2)} at rung ${AMMO[top].tier} ` +
    '— it was 34x for 1.25x, which is why the shop\'s top two shelves went untouched');
}

// --- the round that buys distance ---------------------------------------------
//
// The fourth rung of both ladders, and the first grade in the game that spends its
// premium on something other than heat. Everything below is measured through the
// real fire()/launch() loop rather than read off the table, because "twice the
// reach" is a claim about what the gun does and not about what the row says.
console.log('\nthe round that buys distance');
{
  const { REACH_EDGE, REACH_MULT } = await import('../shared/ammo.js');
  const { rangeOf } = await import('../shared/sim.js');
  const { DRUMFIRE_GAIN, DRUMFIRE_REACH } = await import('../shared/ability.js');
  const { launcherCap } = await import('../shared/rockets.js');

  const LONG = { laser: 'cell4', rocket: 'head4' }, HOT = { laser: 'cell3', rocket: 'head3' };
  const mag = k => ({ key: k, n: 1e9, mult: AMMO[k].mult, reach: AMMO[k].reach ?? 1, tier: AMMO[k].tier });

  // A gun rack and a launcher rack, both on the hull with the longest reach.
  const guns = () => { const s = newShip(0, 0, 'bulwark',
      sanitiseFit(slotsOf('bulwark'), fit({ weapon: Array(4).fill('emitter6') }))); s.heading = 0; return s; };
  const racks = () => { const s = newShip(0, 0, 'bulwark',
      sanitiseFit(slotsOf('bulwark'), fit({ weapon: Array(launcherCap('bulwark')).fill('pod4') }))); s.heading = 0; return s; };
  const shoots = (make, at, k, go) => {
    const s = make();
    for (let i = 0; i < 300; i++) if (go(s, mark(at, 0), dt, mag(k)).length) return true;
    return false;
  };
  const REACH = guns().stats.weaponRange;

  check('the long round doubles the reach of the gun that fires it, and the hot one does not',
    shoots(guns, REACH * 1.8, LONG.laser, fire) && !shoots(guns, REACH * 1.8, HOT.laser, fire) &&
    shoots(guns, REACH * 0.9, HOT.laser, fire),
    `${Math.round(REACH)}px of hull becomes ${Math.round(REACH * REACH_MULT)}px loaded — a Cruiser ` +
    `shooting something at ${Math.round(REACH * 1.8)}px, which nothing in the game could reach before`);
  check('and a rack fed the long warhead reaches exactly as far',
    shoots(racks, REACH * 1.8, LONG.rocket, launch) && !shoots(racks, REACH * 1.8, HOT.rocket, launch),
    'one rule for both feeds — rangeOf takes the magazine, so a bolt and a rocket read the same number');

  // The bug this shape exists to avoid: a ship carries TWO magazines, and a grade
  // loaded into one of them must not lengthen the other.
  check('guns and racks reach independently, because the reach rides the magazine',
    Math.abs(rangeOf(guns(), mag(LONG.laser)) - REACH * REACH_MULT) < 1e-9 &&
    Math.abs(rangeOf(guns(), mag(HOT.laser)) - REACH) < 1e-9 &&
    Math.abs(rangeOf(guns()) - REACH) < 1e-9,
    'long cells in the guns and plain warheads in the racks is a legal fit, and it is two different reaches');

  // --- the price of a metre, and why it is not conserved -----------------------
  //
  // The game already charges for reach, once, and states the rate: a Drum Governor
  // trades a Vanguard's cadence for its reach and holds rate x range constant to
  // within 0.6% (test/tech.mjs asserts it inside 2%). At that rate doubling your
  // reach costs half your output, and Fusion's x1.50 would become x0.75.
  //
  // That answer is rejected, and the reason is written down in ability.js: it is
  // exactly what Drumfire was before it shipped, and conservation produced an
  // ability nobody would ever switch on. So the grade is priced at the margin the
  // shipped ability itself sits at, which is a number the game already carries.
  const carriedOf = k => AMMO[k].mult * (AMMO[k].reach ?? 1);
  check('the conserved answer would have been x0.75, and this is deliberately not it',
    Math.abs(AMMO.cell4.mult - AMMO.cell3.mult / REACH_MULT * REACH_EDGE) < 1e-9 &&
    AMMO.cell4.mult > AMMO.cell3.mult / REACH_MULT,
    `conservation says x${(AMMO.cell3.mult / REACH_MULT).toFixed(4)} and the grade is ` +
    `x${AMMO.cell4.mult.toFixed(5)} — a real gain rather than a reshaping, because a sidegrade ` +
    'that is never worth loading is a grade that does not exist');
  check('and the margin it beats conservation by is the one a full Drumfire beats it by',
    Math.abs(REACH_EDGE - (1 + DRUMFIRE_GAIN) * (1 - DRUMFIRE_REACH)) < 1e-12 &&
    Math.abs(carriedOf('cell4') / carriedOf('cell3') - REACH_EDGE) < 1e-9,
    `a full drum is x${(1 + DRUMFIRE_GAIN).toFixed(2)} of your cycle at ` +
    `${Math.round((1 - DRUMFIRE_REACH) * 100)}% of your reach, which is x${REACH_EDGE.toFixed(3)} of ` +
    'damage-times-reach against a cold ship — and so is this round against the round it shadows. ' +
    'One rate for a metre of reach everywhere in the game, and it moves if the ability is retuned');

  // --- and the invariant, which is the reason any of this is allowed -----------
  //
  // The dearest ammunition in the game is not the strongest ammunition in the game.
  // There is a range at which each of the two top grades wins, the crossover is the
  // ship's own reach, and neither is ever the answer everywhere.
  const dpsAt = (k, d) => (d <= REACH * (AMMO[k].reach ?? 1) ? AMMO[k].mult : 0);
  const ranges = [200, 400, 600, REACH - 1, REACH + 1, 1000, 1400, REACH * 2 - 1, REACH * 2 + 1];
  check('neither top grade wins at every range, which is what stops the dear one being an auto-include',
    ranges.some(d => dpsAt(HOT.laser, d) > dpsAt(LONG.laser, d)) &&
    ranges.some(d => dpsAt(LONG.laser, d) > dpsAt(HOT.laser, d)) &&
    ranges.every(d => dpsAt(HOT.laser, d) === 0 || dpsAt(HOT.laser, d) > dpsAt(LONG.laser, d)),
    `Fusion wins everywhere inside ${Math.round(REACH)}px and fires nowhere outside it; the long round ` +
    `is ${Math.round(100 * (1 - AMMO.cell4.mult / AMMO.cell3.mult))}% weaker at every range they share. ` +
    'Load it for something that outranges you; do not load it to farm');

  // The full-spec rule, unchanged and asked of the new top rung. You may BUY a
  // grade with one qualifying gun and you may not FIRE it until every gun qualifies.
  const { whyNotLoad, whyNotBuy, NEEDS } = await import('../shared/ammo.js');
  const ctx = (weapon, drones = []) => ({ fit: { weapon }, drones, EQUIPMENT });
  check('the long round asks for the whole ship at the top rung, escort included',
    NEEDS.cell4 === EQUIPMENT.emitter6.tier && NEEDS.head4 === EQUIPMENT.pod4.tier &&
    !whyNotLoad('cell4', ctx(['emitter6', 'emitter6'], ['emitter6'])) &&
    !!whyNotLoad('cell4', ctx(['emitter6', 'emitter6'], ['emitter5'])) &&
    !whyNotBuy('cell4', ctx(['emitter6', 'emitter5'])),
    whyNotLoad('cell4', ctx(['emitter6', 'emitter6'], ['emitter5'])) +
    ' — and one MK-VI is enough to BUY the crate, which is the rule the third grade already lives by');

  // --- what it costs to feed, against what the sector it is sold in pays -------
  //
  // The failure mode worth measuring: a grade that burns more per fight than the
  // thing it is fired at drops is unusable in the only place it can be bought.
  {
    const rack = sanitiseFit(slotsOf('bulwark'), fit({ weapon: Array(4).fill('emitter6') }));
    const escort = Array(10).fill('emitter6');
    const perSec = gunsOf(rack, escort) * FIRE_RATE;
    const st = resolve('bulwark', rack, escort);
    const dps = st.damage * st.fireRate * (1 + BOOST) * AMMO.cell4.mult;
    const secs = effectiveHp('crucible') / dps;
    const bill = secs * perSec * roundPrice('cell4');
    console.log(`     a full deep rack burns ${perSec.toFixed(1)} rounds a second — ` +
      `${(perSec * roundPrice('cell4') * 60).toFixed(0)} cr a minute of ${AMMO.cell4.name}`);
    console.log(`     one Crucible is ${secs.toFixed(0)}s of that, ${bill.toFixed(0)} cr, ` +
      `against a ${ALIENS.crucible.bounty.toLocaleString('en-US')} cr bounty`);
    check('the dearest round in the game still turns a profit where it is sold',
      bill < ALIENS.crucible.bounty / 20,
      `${bill.toFixed(0)} cr of cells against ${ALIENS.crucible.bounty.toLocaleString('en-US')} — ` +
      `${(ALIENS.crucible.bounty / bill).toFixed(0)}x back. It is a rounding error on the bounty and it ` +
      'cannot honestly be anything else: bounties span a thousandfold across the game and a round ' +
      'spans 3.9, because the ammunition ladder is a premium on a gun you already bought and pricing ' +
      'it any other way made two thirds of the shop decoration, twice');
  }

  // Why the technology sweep in test/tech.mjs does not sweep ammunition, stated
  // rather than assumed. A grade is a scalar on a dps product, so loading one on
  // both feeds cannot change which of two fits out-damages the other.
  {
    const builds = [
      { hull: 'bulwark',  fit: fit({ weapon: Array(4).fill('emitter6') }), drones: Array(10).fill('emitter6') },
      { hull: 'vanguard', fit: fit({ weapon: Array(5).fill('pod4') }),     drones: [] },
      { hull: 'kestrel',  fit: fit({ weapon: ['emitter3', 'pod2'] }),      drones: Array(4).fill('emitter3') },
    ];
    const order = k => builds.map(b => dpsOf(b, { ammo: k, head: k.replace('cell', 'head') }));
    const base = order('cell1');
    check('no ammunition grade can change which fit out-damages which, which is why the sweep need not see one',
      forWeapon('laser').every(k => {
        const got = order(k);
        return got.every((v, i) => Math.abs(v / base[i] - got[0] / base[0]) < 1e-9);
      }),
      'a grade multiplies both terms of damage x rate + volley x rate by the same number, so it cancels ' +
      'out of every ratio the sweep compares. Reach does NOT appear in dpsOf at all, and the crossover ' +
      'claim above is what covers it instead');
  }
}

// A grade you can only tell apart in the HUD is a grade you cannot tell apart in
// a fight. The round itself carries what loaded it, all the way to the wire.
// --- single-use devices ------------------------------------------------------
// The taskbar's second consumable slot. Repair drones buy you hull without flying
// home; this buys you the flying home.
console.log('\nthe way home');
{
  const { DEVICES, DEVICE_KEYS, DEFAULT_DEVICE, whyNotDevice, devicePrice } =
    await import('../shared/devices.js');
  const { BAR_SLOTS } = await import('../shared/ammo.js');

  check('there is a slot for it beside the repair rack',
    BAR_SLOTS.includes('device') && BAR_SLOTS.length === 4, BAR_SLOTS.join(' '));
  check('every device has a name, a price and a window',
    DEVICE_KEYS.every(k => DEVICES[k].name && DEVICES[k].price > 0 && DEVICES[k].secs > 0),
    DEVICE_KEYS.map(k => `${DEVICES[k].name} ${DEVICES[k].secs}s ${DEVICES[k].price}cr`).join(', '));
  check('the default is one you can actually name', !!DEVICES[DEFAULT_DEVICE]);

  const have = { recall: 1 };
  check('with one aboard and clear of a dock, it goes',
    whyNotDevice({ devices: have, using: 'recall' }) === null);
  check('with none aboard it says so',
    /no /.test(whyNotDevice({ devices: {}, using: 'recall' })));
  // This used to be "at a dock it is pointless", which was true while a beacon had
  // one destination and stopped being true the moment it asked which hangar. Being
  // AT a dock is not the question; being at the dock you are folding TO is.
  check('folding to where you already stand is pointless and says that instead',
    /already standing there/.test(whyNotDevice({ devices: have, using: 'recall', atDest: true })),
    whyNotDevice({ devices: have, using: 'recall', atDest: true }));
  check('but standing in one hangar is no reason not to fold to another',
    whyNotDevice({ devices: have, using: 'recall', atDest: false }) === null,
    'you had to fly out of your own ring to be allowed to leave it');
  check('and it will not stack on itself',
    /already/.test(whyNotDevice({ devices: have, using: 'recall', busy: true })));

  // The one that matters. A recall you cannot START under fire is a recall that
  // is no use on the only occasion you want one — being interrupted is the cost,
  // not being forbidden.
  check('being shot at does not stop you trying',
    whyNotDevice({ devices: have, using: 'recall' }) === null,
    'there is no under-fire clause here on purpose — the tick decides, not the button');
  check('and the fold is worth more than a repair drone, because it is a whole trip',
    devicePrice('recall') > 0 && DEVICES.recall.secs >= 4,
    `${devicePrice('recall')} cr for ${DEVICES.recall.secs}s of holding still`);
}

console.log('\nseeing what is loaded');
{
  const { packBolt, unpackBolt, packRocket, unpackRocket } = await import('../shared/net.js');
  const { gradeColour, GRADE_COLOUR, magazine } = await import('../shared/ammo.js');
  check('a magazine says which grade it is, not just how strong',
    magazine({ cell3: 10 }, { laser: 'cell3' }, 'laser').tier === AMMO.cell3.tier);
  const tiers = new Set(AMMO_KEYS.map(k => AMMO[k].tier));
  check('every grade has a colour and no two share one',
    Object.keys(GRADE_COLOUR).length === tiers.size &&
    new Set(Object.values(GRADE_COLOUR)).size === tiers.size, Object.values(GRADE_COLOUR).join(' '));
  // One colour for the fourth rung of BOTH feeds, because a purple bolt and a
  // purple rocket have to mean the same thing to somebody watching from outside.
  check('and the top grade is the same purple whichever weapon throws it',
    AMMO.cell4.colour === AMMO.head4.colour && AMMO.cell4.colour === GRADE_COLOUR[4],
    `${AMMO.cell4.name} and ${AMMO.head4.name} both ${AMMO.cell4.colour}`);
  check('the bar and the round in flight read the same table',
    forWeapon('laser').every(k => AMMO[k].colour === gradeColour(AMMO[k].tier)),
    'one table, so the HUD and the sky cannot disagree about what is loaded');
  const b = unpackBolt(packBolt({ sx: 0, sy: 0, ax: 10, ay: 0, t: 0.1, ttl: 0.2, foe: false, w: 40, gr: 3 }));
  check('a bolt carries its grade over the wire', b.gr === 3);
  const r = unpackRocket(packRocket({ x: 0, y: 0, heading: 0, foe: false, w: 90, gr: 2 }));
  check('and so does a rocket', r.gr === 2);
  check('a shot fired with no magazine is still drawable',
    unpackBolt(packBolt({ sx: 0, sy: 0, ax: 1, ay: 0, t: 0, ttl: 1, foe: true, w: 1 })).gr === 0,
    'aliens have no ammunition and must not come out undefined');
}

console.log('\npaying for itself');
{
  // The rule the whole economy hangs on: a fight has to return more than it
  // burns, by enough that the leftovers buy the next thing. At 140 a kill it
  // did — but a finished ship was 2664 kills away, which is the grind this
  // game exists not to have.
  const builds = [
    ['starter Hauler',   'hauler',   ['emitter1'], []],
    ['mid Vanguard',     'vanguard', Array(3).fill('emitter3'), Array(3).fill('emitter3')],
    ['finished Vanguard','vanguard', Array(3).fill('emitter5'), Array(6).fill('emitter5')],
  ];
  const plain = DEFAULT_AMMO.laser;
  for (const kind of WILD) {
    const ehp = effectiveHp(kind), pays = ALIENS[kind].bounty;
    check(`${ALIENS[kind].name} pays what its toughness says it should`,
      pays === bountyFor(kind), `${ehp} ehp x ${ALIENS[kind].effort ?? 1} effort at ${BOUNTY_RATE} = ${pays} cr`);
    for (const [label, hull, weapon, drones] of builds) {
      const f = sanitiseFit(slotsOf(hull), fit({ weapon }));
      const st = resolve(hull, f, drones);
      const perBolt = st.damage * (1 + BOOST) / gunsOf(f, drones);
      const spent = Math.ceil(ehp / perBolt) * roundPrice(plain);
      check(`${label} clears its own ammunition on a ${ALIENS[kind].name}`,
        pays > spent * 20,
        `${spent.toFixed(1)} cr of cells against ${pays} cr — ${Math.round(pays / spent)}x`);
    }
    // A full rocket rack is the worst case: fifteen warheads at once, most of
    // them wasted on something this soft. Standard grade still has to profit.
    const volley = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(3).fill('pod3') })), []).rockets;
    const heads = volley * roundPrice(DEFAULT_AMMO.rocket);
    check(`even a full rocket volley profits on a ${ALIENS[kind].name}`, pays > heads * 4,
      `${volley} standard warheads is ${heads.toFixed(0)} cr against ${pays} cr`);
  }

  // Premium grades are a decision, not a default — they are meant to stop making
  // sense against something this cheap, and to be worth it against something hard.
  const top = forWeapon('rocket').at(-1);
  const vol = resolve('vanguard', sanitiseFit(slotsOf('vanguard'), fit({ weapon: Array(3).fill('pod3') })), []).rockets;
  const lux = vol * roundPrice(top);
  console.log(`     a ${AMMO[top].name} volley costs ${lux.toFixed(0)} cr against a ${ALIENS.drifter.bounty} cr husk`);
  // And this used to read "the best warheads do not pay on trash", which they did
  // not — a single Antimatter volley cost more than the husk it killed. That was
  // deliberate and it was the wrong call: ammunition you cannot afford to fire is
  // ammunition nobody buys. The premium now shows up as thinner margin, not as a
  // loss, so loading the good stuff is a choice about pace rather than a mistake.
  check('even the best warheads still turn a profit on a husk',
    lux < ALIENS.drifter.bounty,
    `${lux.toFixed(0)} cr of warheads against a ${ALIENS.drifter.bounty} cr husk — ` +
    `${(ALIENS.drifter.bounty / lux).toFixed(1)}x back, against 0.8x before`);
  check('but the plain grade is still the thrifty way to farm',
    vol * roundPrice(DEFAULT_AMMO.rocket) < lux,
    'the premium buys speed, not free money');

  // And the pacing that all of it is for.
  const ORE = 81;
  const perKill = ALIENS.drifter.bounty + ORE;
  const kills = c => Math.round(c / perKill);
  console.log(`     at ${perKill} cr a Drifter: a Kestrel in ${kills(18000)} kills, ` +
              `a Swarm Rack in ${kills(40000)}, a finished Vanguard in ${kills(373000)}`);
  check('a first upgrade is an evening, not a campaign', kills(18000) < 60);
  check('and the top of the ladder is still something to work toward', kills(373000) > 300);
}

console.log('\nkeeping it');
{
  const raw = { cell1: 3.7, cell2: -5, nonsense: 900, head1: '250' };
  const clean = sanitiseAmmo(raw);
  check('stock is whole rounds of things that exist',
    clean.cell1 === 3 && clean.head1 === 250 && !('cell2' in clean) && !('nonsense' in clean),
    JSON.stringify(clean));
  check('there is no cap on it', sanitiseAmmo({ cell1: 9e8 }).cell1 === 9e8,
    'a hold you have to manage is a chore, not a mechanic');
  check('a selection that no longer exists falls back to the plain grade',
    sanitiseUsing({ laser: 'nonsense', rocket: 'cell1' }).laser === DEFAULT_AMMO.laser
    && sanitiseUsing({ rocket: 'cell1' }).rocket === DEFAULT_AMMO.rocket,
    'and a laser grade cannot be loaded into a launcher');
  check('a magazine reads the loaded grade',
    magazine({ cell3: 40 }, { laser: 'cell3' }, 'laser').n === 40
    && magazine({ cell3: 40 }, { laser: 'cell3' }, 'laser').mult === AMMO.cell3.mult);
  check('and reads zero for a grade you do not hold',
    magazine({}, { laser: 'cell3' }, 'laser').n === 0 && !hasRounds({}, {}, 'laser'));

  const acct = newAccount('t', 1, 1000);
  check('a new account is issued rounds', (acct.ammo[DEFAULT_AMMO.laser] ?? 0) > 0);
  const p = { co: acct.co, mapId: 'm1', credits: 0, hold: {}, vault: {}, gear: {}, hulls: [], xp: 0,
              formations: ['line'], ammo: { cell3: 120, head2: 40 }, using: { laser: 'cell3', rocket: 'head2' },
              ship: newShip(0, 0, 'hauler', fit({ weapon: ['emitter1'] })) };
  capture(acct, p, 2000);
  const back = sanitiseAccount(acct, 1, 3000);
  check('ammunition and both selections survive a round trip',
    back.ammo.cell3 === 120 && back.ammo.head2 === 40
    && back.using.laser === 'cell3' && back.using.rocket === 'head2');
}

console.log('\nwhere it is sold');
{
  const { sellsAt, ANYWHERE, STORE_PAGES } = await import('../shared/hangar.js');
  check('ammunition sells anywhere', sellsAt('ammo', false) && sellsAt('ammo', true),
    'a rack with nothing behind it is a walk home, not a puzzle');
  check('and nothing else does',
    STORE_PAGES.filter(p => !ANYWHERE.includes(p.key)).every(p => !sellsAt(p.key, false)),
    STORE_PAGES.filter(p => !ANYWHERE.includes(p.key)).map(p => p.name).join(', '));
  check('at the ring everything does', STORE_PAGES.every(p => sellsAt(p.key, true)));
}

console.log('\nrepair drones');
{
  const tiers = KIT_KEYS.map(k => KITS[k]);
  console.log('     ' + tiers.map(k => `${k.name} +${Math.round(k.heal * 100)}%/${k.secs}s ${k.price}cr`).join('   '));
  check('a better kit heals more, takes longer and costs more',
    tiers.every((k, i) => i === 0 || (k.heal > tiers[i - 1].heal && k.secs > tiers[i - 1].secs
                                   && k.price > tiers[i - 1].price)),
    'no tier is a straight upgrade');
  check('the best one is a full hull, and none goes past it',
    tiers.at(-1).heal === 1 && tiers.every(k => k.heal <= 1));

  // One function answers for the button, its tooltip and the server, so the
  // screen never offers a repair the server will refuse.
  const can = o => whyNotRepair({ kits: { kit1: 2 }, using: 'kit1', hurt: true, sinceHit: 99, ...o });
  check('hurt, quiet and in open space, it goes', can({}) === null);
  check('not at a dock', can({ docked: true }) !== null, 'the station does it free and faster');
  check('not while being shot at', can({ sinceHit: KIT_QUIET - 0.1 }) !== null,
    `${KIT_QUIET}s of quiet first, so it cannot be a mid-fight heal`);
  check('not on an undamaged hull', can({ hurt: false }) !== null);
  check('not with an empty rack', can({ kits: {} }) !== null);
  check('and not twice at once', can({ busy: true }) !== null);
  check('every refusal says why in words',
    [{ docked: true }, { sinceHit: 0 }, { hurt: false }, { kits: {} }, { busy: true }]
      .every(o => typeof can(o) === 'string' && can(o).length > 6),
    can({ sinceHit: 0 }));

  check('a bought kit survives a round trip', (() => {
    const acct = newAccount('r', 3, 1000);
    const p2 = { co: acct.co, mapId: 'm1', credits: 0, hold: {}, vault: {}, gear: {}, hulls: [], xp: 0,
                 formations: ['line'], ammo: {}, using: {}, armed: {}, kits: { kit3: 2 }, kit: 'kit3',
                 ship: newShip(0, 0, 'hauler', fit({ weapon: ['emitter1'] })) };
    capture(acct, p2, 2000);
    const back = sanitiseAccount(acct, 3, 3000);
    return back.kits.kit3 === 2 && back.kit === 'kit3';
  })());
  check('a nonsense kit selection falls back to the cheap one',
    sanitiseKits({ kit1: 1.7, nope: 9, kit2: -3 }).kit1 === 1
    && !('nope' in sanitiseKits({ nope: 9 })));
}

console.log('\nthe bar');
{
  let off = 0, overlap = 0, menuOff = 0;
  for (const [W, H] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 640], [900, 600]]) {
    const L = barLayout(W, H);
    if (L.boxes.length !== BAR_SLOTS.length) off++;
    if (L.r.x < 0 || L.r.x + L.r.w > W || L.r.y < 0 || L.r.y + L.r.h > H) off++;
    for (let i = 1; i < L.boxes.length; i++)
      if (L.boxes[i].r.x < L.boxes[i - 1].r.x + L.boxes[i - 1].r.w) overlap++;
    // The chooser opens upward over the world, and must stay on screen with every
    // grade in the game listed at once.
    for (const b of L.boxes) {
      const M = feedMenu(b, b.feed === 'repair' ? KIT_KEYS : forWeapon(b.feed));
      if (M.box.x < 0 || M.box.y < 0 || M.box.x + M.box.w > W || M.box.y + M.box.h > H) menuOff++;
      for (const r of M.rows)
        if (r.r.x < M.box.x || r.r.y < M.box.y
         || r.r.x + r.r.w > M.box.x + M.box.w || r.r.y + r.r.h > M.box.y + M.box.h) menuOff++;
    }
  }
  check('one box per weapon plus the repair rack, fitting every window', off === 0 && overlap === 0,
    BAR_SLOTS.join(' '));
  check('and the chooser opens over the world without leaving it', menuOff === 0,
    'every grade listed, on the smallest window');
  const L = barLayout(1280, 720);
  check('lasers, then warheads, then repair — always in the same place',
    L.boxes.map(b => b.feed).join() === BAR_SLOTS.join(),
    'so a box means the same thing every time you look at it');
}

console.log('\nthe mixing desk');
{
  const { settingsLayout, valueAt, ROWS } = await import('../shared/settings.js');
  let off = 0, overlap = 0;
  for (const [W, H] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 640], [900, 600], [760, 520]]) {
    const L = settingsLayout(W, H), P = L.panel;
    if (P.x < 0 || P.y < 0 || P.x + P.w > W || P.y + P.h > H) off++;
    const hits = [...L.rows.map(r => r.toggle), ...L.rows.filter(r => r.hit).map(r => r.hit), L.skip];
    for (const r of hits)
      if (r.x < P.x || r.y < P.y || r.x + r.w > P.x + P.w || r.y + r.h > P.y + P.h) off++;
    for (let i = 1; i < L.rows.length; i++)
      if (L.rows[i].r.y < L.rows[i - 1].r.y + L.rows[i - 1].r.h - 0.01) overlap++;
    // A fader whose grab area overlaps its own mute switch is a fader that mutes
    // when you meant to turn it down.
    for (const row of L.rows)
      if (row.hit && row.hit.x + row.hit.w > row.toggle.x) overlap++;
  }
  check('every control sits inside the panel, at every size', off === 0,
    `${ROWS.length} rows across six windows`);
  check('rows do not overlap, and no fader reaches its own mute', overlap === 0);

  const L = settingsLayout(1280, 720);
  const t = L.rows.find(r => r.key === 'music').track;
  check('a click maps to the value under it',
    valueAt(t, t.x) === 0 && valueAt(t, t.x + t.w) === 1
    && Math.abs(valueAt(t, t.x + t.w / 2) - 0.5) < 1e-9);
  check('and a drag past either end clamps instead of wrapping',
    valueAt(t, t.x - 500) === 0 && valueAt(t, t.x + t.w + 500) === 1);
  check('sound and music are separate rows',
    L.rows.some(r => r.key === 'sfx') && L.rows.some(r => r.key === 'music')
    && L.rows.some(r => r.key === 'master'),
    'one mute cannot silence the game and leave the score playing');
  check('every row has a mute, in the same place on each',
    L.rows.every(r => r.toggle) && new Set(L.rows.map(r => r.toggle.x)).size === 1,
    'so muting is the same gesture whichever bus it is');
}

console.log('\nthe playlist');
{
  const { isTrack, typeOf, servable, MOOD_OF, AUDIO_TYPE } = await import('../shared/music.js');
  const good = ['track.mp3', 'Drifting Home.mp3', "O'Neill (reprise).ogg", 'a-b_c.wav', 'x.m4a'];
  const bad  = ['../server.js', '..%2Fserver.js', '.hidden.mp3', 'no-extension',
                'notes.txt', 'a/b.mp3', 'x.mp3.exe', '', 'con/../../etc/passwd'];
  check('ordinary filenames are tracks', good.every(isTrack), good.join('  '));
  check('nothing else is', bad.every(n => !isTrack(n)),
    bad.filter(isTrack).join(' ') || 'traversal, dotfiles and non-audio all refused');
  check('every accepted extension has a content type',
    good.every(n => AUDIO_TYPE[n.split('.').pop().toLowerCase()] === typeOf(n)));

  // The route serves by membership of the list it just built, so no amount of
  // encoding gets at a file that is not in the directory.
  const listed = ['one.mp3', 'ambient/two.mp3'];
  check('a listed track is servable', listed.every(n => servable(n, listed)));
  check('an unlisted one is not, however it is spelled',
    ['../server.js', 'one.mp3/../../server.js', 'ONE.mp3', 'ambient/three.mp3']
      .every(n => !servable(n, listed)));
  check('a subfolder is the track\'s mood',
    MOOD_OF('combat/hard.mp3') === 'combat' && MOOD_OF('loose.mp3') === 'all');

  // A folder is how you park something. Boss music can sit there fully loaded
  // until there is a boss to play it at, without being renamed or deleted or
  // turning up between two ambient tracks in the meantime.
  const { inRotation, parkedMoods, LIVE_MOODS, poolOf, CALM, COMBAT } = await import('../shared/music.js');
  const folder = ['Silent Orbit.mp3', 'ambient/long-dark.mp3',
                  'boss/Iron Pulse.mp3', 'combat/hard-burn.mp3'];
  check('loose files and ambient are the score you fly to',
    poolOf('Silent Orbit.mp3') === CALM && poolOf('ambient/long-dark.mp3') === CALM);
  check('combat/ is its own deck',
    poolOf('combat/hard-burn.mp3') === COMBAT && inRotation('combat/hard-burn.mp3'));
  check('a mood with no system to play it stays parked',
    poolOf('boss/Iron Pulse.mp3') === null && !inRotation('boss/Iron Pulse.mp3'),
    `parked: ${parkedMoods(folder).join(', ') || 'nothing'}`);
  check('parked is not hidden — the file still lists and still serves',
    servable('boss/Iron Pulse.mp3', folder),
    'it is out of the shuffle, not out of the directory');
  // Arriving is instant, leaving is not. A lull between passes is not the end of
  // a fight, and music that drops out and comes straight back is worse than music
  // that never changed.
  const { moodFor, resolveMood, CHASE, COMBAT_HOLD } = await import('../shared/music.js');
  let hold = { mood: CALM, until: 0 }, clock = 0;
  const step = (st, ms) => { clock += ms; hold = moodFor(st, clock, hold); return hold.mood; };
  check('quiet is quiet', step({}, 100) === CALM);
  check('being shot at while not shooting back is a chase',
    step({ hunted: true }, 100) === CHASE,
    'crossing a map with something on you is not the same as a fight');
  check('and it holds while you run', step({}, 3000) === CHASE);
  check('turning to fight makes it a fight at once',
    step({ fighting: true, hunted: true }, 100) === COMBAT,
    'returning fire is the moment it stops being a chase');
  check('a lull between passes does not end it', step({}, 2000) === COMBAT
    && step({ fighting: true }, 100) === COMBAT && step({}, COMBAT_HOLD - 1000) === COMBAT,
    `${COMBAT_HOLD / 1000}s of quiet is what ends it`);
  // The number, and why it is that number. A respawn puts the next hostile at least
  // SPAWN_CLEAR away and a starter hull flies 300px/s, so the trip between two kills
  // is about eight seconds before you have even turned onto the thing. At seven the
  // score gave up a second before the next fight began, every single time.
  {
    const { SPAWN_CLEAR } = await import('../shared/aliens.js');
    const { resolve, DEFAULT_HULL } = await import('../shared/ships.js');
    const flight = SPAWN_CLEAR / resolve(DEFAULT_HULL).speed * 1000;
    check('the hold outlasts the flight from one kill to the next',
      COMBAT_HOLD > flight * 1.5,
      `${COMBAT_HOLD / 1000}s against ${(flight / 1000).toFixed(1)}s of flying ` +
      `${SPAWN_CLEAR}px in a starter hull — it was 7s, which is the wrong side of that`);
  }
  // Enough quiet ends the fight, but the score does not come straight back —
  // there is a stretch of silence first, and only on the way down.
  const { QUIET, COOLDOWN } = await import('../shared/music.js');
  check('and enough quiet ends it', step({}, 1200) === QUIET);
  check('but the score does not come straight back', step({}, COOLDOWN - 2000) === QUIET,
    `${COOLDOWN / 1000}s of silence gives another pass a chance to start`);
  check('and after the silence it does', step({}, 3000) === CALM);
  check('a fight during the silence is still instant',
    (() => { let h2 = { mood: QUIET, until: 0, calmAt: 9e9 };
             return moodFor({ fighting: true }, 1000, h2).mood === COMBAT; })(),
    'the wait is only on the cooldown path');

  // Switching targets mid-brawl leaves a moment where you are not shooting at
  // anything and something is still shooting at you. Without the rank rule the
  // music dipped into the chase and back on every retarget.
  hold = { mood: CALM, until: 0 }; clock = 0;
  check('a retarget mid-fight does not dip into the chase',
    step({ fighting: true }, 100) === COMBAT
    && step({ fighting: true, hunted: true }, 500) === COMBAT
    && step({ hunted: true }, 120) === COMBAT
    && step({ fighting: true, hunted: true }, 200) === COMBAT,
    'escalating is instant, stepping down waits out the hold');
  check('but it still steps down once the fight is actually over',
    step({}, COMBAT_HOLD + 500) === QUIET, 'into the silence, then the score');
  check('and being hunted from silence is still a chase',
    step({ hunted: true }, 100) === CHASE, 'the rule holds one way, not both');
  check('the hold is long enough to cover a reload, short enough to notice',
    COMBAT_HOLD >= 4000 && COMBAT_HOLD <= 15000, `${COMBAT_HOLD / 1000}s`);
  check('a fight starting again re-arms the hold from now',
    moodFor({ fighting: true }, 50_000).until === 50_000 + COMBAT_HOLD);

  // A mood with no folder behind it borrows the nearest one that has music,
  // so an empty chase/ sounds like a fight rather than like nothing happening.
  const has = set => m => set.includes(m);
  check('a chase with no chase music borrows the fight',
    resolveMood(CHASE, has([CALM, COMBAT])) === COMBAT);
  check('and with no fight music either, it is just the score',
    resolveMood(CHASE, has([CALM])) === CALM);
  check('with the folder filled it plays its own',
    resolveMood(CHASE, has([CALM, CHASE, COMBAT])) === CHASE);

  // Which track comes next. Plain random plays the same piece twice in a row
  // often enough to notice and leaves one unheard for an hour; a bag hands out
  // every track before it hands out any of them twice.
  const { drawNext } = await import('../shared/music.js');
  const pool = ['a', 'b', 'c', 'd', 'e'];
  let bag = [], last = null;
  const out = [];
  for (let i = 0; i < 30; i++) { const r = drawNext(bag, pool, last); bag = r.bag; last = r.pick; out.push(r.pick); }
  console.log(`     thirty draws from five: ${out.join(' ')}`);
  check('every pass hands out the whole pool before repeating any of it',
    [0, 5, 10, 15, 20, 25].every(i => new Set(out.slice(i, i + 5)).size === pool.length));
  check('and never the same track twice in a row, even across a refill',
    out.every((k, i) => i === 0 || k !== out[i - 1]));
  check('a pool of one still plays', drawNext([], ['solo'], 'solo').pick === 'solo');
  check('an empty pool draws nothing rather than throwing',
    drawNext([], [], null).pick === null && drawNext(['gone'], [], null).bag.length === 0);
  check('a bag holding tracks that are no longer there refills',
    drawNext(['deleted'], pool, null).pick !== 'deleted',
    'the folder can change under it');
  // Every switch draws afresh, which is the point: the alternative is hearing
  // the same combat piece from thirty seconds in for every fight of the session.
  const fights = [];
  let cbag = [], clast = null;
  for (let i = 0; i < 8; i++) { const r = drawNext(cbag, ['x', 'y', 'z'], clast); cbag = r.bag; clast = r.pick; fights.push(r.pick); }
  check('eight fights do not open on the same track twice running',
    fights.every((k, i) => i === 0 || k !== fights[i - 1]), fights.join(' '));

  // Levelling. Nothing to read a loudness tag from and nothing decoded, so the
  // level is measured off the output and walked toward a target.
  const { levelStep, TARGET_RMS, GAIN_MIN, GAIN_MAX, FLOOR_RMS } = await import('../shared/music.js');
  const settle = rms => { let g = 1; for (let i = 0; i < 60; i++) g = levelStep(rms, g); return g; };
  const quietTrack = settle(TARGET_RMS / 2), loudTrack = settle(TARGET_RMS * 2);
  console.log(`     a track half the target level settles at x${quietTrack.toFixed(2)}, ` +
              `one at twice it x${loudTrack.toFixed(2)}`);
  check('a quiet track is brought up and a loud one down',
    quietTrack > 1.5 && loudTrack < 0.7);
  check('and one already at the target is left alone',
    Math.abs(settle(TARGET_RMS) - 1) < 0.01);
  check('it moves slowly rather than jumping', Math.abs(levelStep(TARGET_RMS / 3, 1) - 1) < 0.5,
    'a correction fast enough to follow a passage would breathe on the music');
  check('nothing is rescued or crushed past its limits',
    settle(1e-3) <= GAIN_MAX + 1e-9 && settle(10) >= GAIN_MIN - 1e-9,
    `${GAIN_MIN} to ${GAIN_MAX}`);
  check('a silent passage says nothing about the track',
    levelStep(FLOOR_RMS / 2, 1.7) === 1.7 && levelStep(0, 1.7) === 1.7);

  check('every live mood lands on a deck',
    LIVE_MOODS.every(m => [CALM, CHASE, COMBAT].includes(poolOf(m === 'all' ? 'loose.mp3' : `${m}/x.mp3`))),
    LIVE_MOODS.join(' '));
}

// --- who may LOAD a grade, as opposed to buy one -----------------------------
//
// Owning one tier 3 emitter used to be enough to fire Fusion Cells out of every
// gun on the ship, so the top grade was a single purchase rather than a decision:
// bolt one MK-V onto the escort and eight MK-Is upstairs all fired the hot rounds.
{
  const { whyNotLoad, whyNotBuy, lowestGun, loadable, NEEDS } = await import('../shared/ammo.js');
  const { EQUIPMENT } = await import('../shared/gear.js');
  const gun = t => Object.keys(EQUIPMENT).find(k =>
    EQUIPMENT[k].slot === 'weapon' && EQUIPMENT[k].kind !== 'rocket' && EQUIPMENT[k].tier === t);
  const lo = gun(1), hi = gun(NEEDS.cell3), mid = gun(NEEDS.cell2);
  const ctx = (weapon, drones = []) => ({ fit: { weapon }, drones, EQUIPMENT });

  check('buying asks for the best gun you own, and loading asks for the worst',
    !whyNotBuy('cell3', ctx([hi, lo])) && !!whyNotLoad('cell3', ctx([hi, lo])),
    whyNotLoad('cell3', ctx([hi, lo])));
  check('the escort counts, because a drone is a gun',
    !!whyNotLoad('cell3', ctx([hi, hi], [lo])),
    whyNotLoad('cell3', ctx([hi, hi], [lo])));
  check('a ship specced all the way through may load the top grade',
    !whyNotLoad('cell3', ctx([hi, hi], [hi, hi])),
    `every emitter at tier ${NEEDS.cell3}`);
  check('and the refusal names the gun that is holding you back',
    /MK-I/.test(whyNotLoad('cell3', ctx([hi, hi], [lo]))) &&
    /escort/.test(whyNotLoad('cell3', ctx([hi, hi], [lo]))),
    'a pilot should not have to audit their own fit to find it');
  check('an empty slot is not a tier 1 gun',
    !whyNotLoad('cell3', ctx([hi, null, undefined], [hi])),
    'a Kestrel flying two of three racks is carrying nothing, and nothing cannot be underfed');
  check('the standard grade is never gated, whatever you fly',
    !whyNotLoad('cell1', ctx([])) && !whyNotLoad('cell1', ctx([lo], [lo])) && !whyNotLoad('head1', ctx([])),
    'running dry with no way back is a walk home, not a mechanic');
  check('a pilot with no gun of that sort at all is not blocked',
    !whyNotLoad('head3', ctx([hi], [hi])),
    'there is nothing to underfeed and nothing will fire');
  check('lowestGun finds the weakest of the right kind and says where it is',
    lowestGun('laser', { weapon: [hi, mid] }, [lo], EQUIPMENT).where === 'escort' &&
    lowestGun('laser', { weapon: [hi, mid] }, [], EQUIPMENT).where === 'rack' &&
    lowestGun('laser', { weapon: [] }, [], EQUIPMENT) === null);

  // A refit that breaks the rule must drop you to the best grade you CAN fire,
  // not to the cheapest — losing a rung because one drone slipped one is a
  // bigger punishment than the rule is asking for.
  check('selling one emitter drops you a rung, not to the bottom',
    sanitiseUsing({ laser: 'cell3' }, {}, ctx([hi, mid], [mid])).laser === 'cell2',
    `an all-MK-III ship falls from Fusion to ${AMMO[sanitiseUsing({ laser: 'cell3' }, {}, ctx([mid], [mid])).laser].name}`);
  check('and a ship that can fire what it loaded keeps it',
    sanitiseUsing({ laser: 'cell3' }, {}, ctx([hi], [hi])).laser === 'cell3');
  check('loadable lists the best first, and never lies to the menu',
    loadable('laser', ctx([mid], [mid]))[0] === 'cell2' &&
    loadable('laser', ctx([mid], [mid])).every(k => !whyNotLoad(k, ctx([mid], [mid]))),
    loadable('laser', ctx([mid], [mid])).join(' > '));
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
                               : `PASS — ${AMMO_KEYS.length} grades`}\n`);
process.exit(fails.length ? 1 : 0);
