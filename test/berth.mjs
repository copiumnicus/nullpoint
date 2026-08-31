import { berthPrice, BERTH_TRIPS, BERTH_RANK, BERTH_QUIET,
         whyNotBerth, whyNotBuyBerth, berthPanel } from '../shared/berth.js';
import { devicePrice } from '../shared/devices.js';
import { levelFor } from '../shared/level.js';
import { MAPS, GALAXY } from '../shared/maps.js';
import { canDock } from '../shared/sim.js';
import { sanitiseAccount } from '../shared/account.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const xpFor = lvl => { let xp = 0; while (levelFor(xp).level < lvl) xp += 250; return xp; };

console.log('\nwhat a berth costs');
check('its price is the trip it saves you, times the trips',
  berthPrice() === devicePrice('recall') * BERTH_TRIPS,
  `${berthPrice()} = ${devicePrice('recall')} x ${BERTH_TRIPS} — below that a handful of beacons was cheaper`);
// This used to read "more than ten beacons", which was right while a berth was a
// convenience and wrong the moment it became the door to the upper ladder: a toll
// you cannot pay when you first want to climb is a wall, not a toll.
check('it is a real decision, not pocket change', berthPrice() > devicePrice('recall') * 4,
  `${berthPrice()} — several trips' worth, so a couple of beacons is genuinely the cheaper answer`);
check('and it is payable by a pilot who has just outgrown the home ring',
  berthPrice() < devicePrice('recall') * 12,
  'a gate you reach before you can afford it stops being a gate and becomes a wall');

console.log('\nwho they will rent to');
check('not to someone who has never left home',
  /rank/.test(whyNotBuyBerth({ inside: true, credits: 1e9, xp: 0 })),
  whyNotBuyBerth({ inside: true, credits: 1e9, xp: 0 }));
check('and not to someone who cannot pay',
  /costs/.test(whyNotBuyBerth({ inside: true, credits: 0, xp: xpFor(BERTH_RANK) })));
check('but yes to a pilot with both', whyNotBuyBerth({
  inside: true, credits: berthPrice(), xp: xpFor(BERTH_RANK) }) === null);
check('you cannot buy one you already have',
  /already/.test(whyNotBuyBerth({ inside: true, owned: true, credits: 1e9, xp: xpFor(60) })));
check('and not from across the sector', /range/.test(whyNotBuyBerth({ inside: false })));
// Rank gates, it does not scale. Standing decides where you are allowed, never
// how hard you hit — this is the whole of what levels are now allowed to do.
check('rank is a door, not a discount',
  whyNotBuyBerth({ inside: true, credits: berthPrice(), xp: xpFor(BERTH_RANK) }) ===
  whyNotBuyBerth({ inside: true, credits: berthPrice(), xp: xpFor(60) }),
  'a rank 60 pilot pays exactly what a rank 20 pilot pays');

console.log('\nwhat it is not');
check('it is not shelter — being shot at closes it',
  whyNotBerth({ owned: true, inside: true, sinceHit: 1 }) !== null &&
  whyNotBerth({ owned: true, inside: true, sinceHit: BERTH_QUIET + 1 }) === null,
  `${BERTH_QUIET}s clear before the bay opens`);
check('it is not a dock: no outpost is one, berth or no berth',
  GALAXY.filter(id => MAPS[id].outpost).every(id => {
    const o = MAPS[id].outpost;
    return !canDock(MAPS[id], MAPS[id].owner, { x: o.x, y: o.y });
  }), 'a berth is a counter, not a ring — it never repairs and never hides you');
check('and having one somewhere is not having one everywhere',
  whyNotBerth({ owned: false, inside: true }) !== null,
  'bought per outpost, so a pilot on one frontier does not pay for three');

console.log('\nkeeping it');
check('a berth survives a save and a load', (() => {
  const a = sanitiseAccount({ token: 't', co: 'm', berths: ['m4'] }, 1, Date.now());
  return a.berths.length === 1 && a.berths[0] === 'm4';
})());
check('and a hand-edited save cannot invent one where no outpost is', (() => {
  const a = sanitiseAccount({ token: 't', co: 'm', berths: ['m1', 'nonsense', 'm4', 'm4'] }, 1, Date.now());
  return a.berths.length === 1 && a.berths[0] === 'm4';
})(), 'm1 has no outpost, junk dropped, duplicates merged');

console.log('\nwhat the frontier stocks');
{
  const { EQUIPMENT, frontierOnly, whyNotSold, FRONTIER } = await import('../shared/gear.js');
  const laser = k => EQUIPMENT[k].slot === 'weapon' && EQUIPMENT[k].kind !== 'rocket';
  check('your own company stops selling emitters at the third rung',
    !frontierOnly('emitter2') && frontierOnly('emitter3') && frontierOnly('emitter5'),
    `emitters go frontier at tier ${FRONTIER.laser}`);
  check('and launchers at the second',
    !frontierOnly('pod1') && frontierOnly('pod2') && frontierOnly('pod3'));
  check('the bottom of every ladder is still sold at home',
    ['emitter1', 'pod1', 'cellA', 'plating'].every(k => !frontierOnly(k)),
    'you are issued a starter kit, not abandoned');
  check('frontier stock is refused at your own ring, however docked you are',
    /frontier/.test(whyNotSold('emitter5', { docked: true })),
    whyNotSold('emitter5', { docked: true }));
  check('and sold at a bay you rent', whyNotSold('emitter5', { berth: true }) === null);
  check('ordinary stock is sold at either', whyNotSold('emitter1', { docked: true }) === null &&
    whyNotSold('emitter1', { berth: true }) === null);
  check('and nowhere at all in open space',
    whyNotSold('emitter1', {}) !== null && whyNotSold('emitter5', {}) !== null);
  // The berth stopped being a convenience the moment it gated the ladder, so its
  // price had to stop being a convenience price.
  check('the toll is payable when you first want to climb',
    berthPrice() < EQUIPMENT.emitter3.price * 4,
    `${berthPrice()} against an MK-III at ${EQUIPMENT.emitter3.price} — the first thing it unlocks`);
  check('every technology is on a rung now',
    Object.values(EQUIPMENT).filter(e => e.slot === 'tech').every(e => e.tier > 0),
    'four things at one rung was a shelf with nothing to climb');
}

console.log('\nwhere a wreck comes back');
{
  const { respawnAt, isHangar } = await import('../shared/berth.js');
  const { MAPS } = await import('../shared/maps.js');
  const where = a => respawnAt(a, MAPS);
  check('a pilot who has docked nowhere comes back to their own ring',
    where({ co: 'm' }).map === 'm1');
  check('and one who last used a bay they rent comes back to the bay',
    where({ co: 'm', lastDock: 'm4', berths: ['m4'] }).map === 'm4',
    'four sectors of flying home, every death, was the least interesting minute in the game');
  // Everything about the last hangar is re-checked rather than trusted: a berth
  // can be sold, a save can be hand-edited, a sector can stop having an outpost.
  check('a bay you have since sold does not hold your respawn',
    where({ co: 'm', lastDock: 'm4', berths: [] }).map === 'm1');
  check('nor does a rival company ring',
    where({ co: 'm', lastDock: 'h1' }).map === 'm1');
  check('nor a sector with no hangar in it at all',
    where({ co: 'm', lastDock: 'g1' }).map === 'm1');
  check('and hand-edited nonsense falls back rather than throwing',
    where({ co: 'm', lastDock: 'nowhere', berths: ['nowhere'] }).map === 'm1');

  // The recorded hangar and the shop counter answer the same question, so you can
  // never respawn somewhere you could not have shopped.
  const at = (mapId, x, y, berths) =>
    isHangar(mapId, MAPS[mapId], 'm', { x, y }, berths);
  const b = MAPS.m1.base, o = MAPS.m4.outpost;
  check('standing in your own ring counts as a hangar', at('m1', b.x, b.y, []));
  check('standing in a bay you rent counts too', at('m4', o.x, o.y, ['m4']));
  check('standing in an outpost you have no bay at does not',
    !at('m4', o.x, o.y, []), 'you could not have shopped there, so you cannot come back there');
  check('and neither does open space', !at('m1', 100, 100, []));
}

console.log('\nthe panel that sells it');
{
  const L = berthPanel(1600, 900);
  check('it sits on screen with its button inside it',
    L.panel.x > 0 && L.panel.y > 0 && L.panel.y + L.panel.h < 900 &&
    L.buy.y > L.panel.y && L.buy.y + L.buy.h <= L.panel.y + L.panel.h);
  const S = berthPanel(420, 320);
  check('and gives ground on a small window rather than running off it',
    S.panel.x >= 0 && S.panel.x + S.panel.w <= 420);
}

// --- where a beacon puts you down --------------------------------------------
//
// It always went to your company ring, which was right while the ring was the only
// place you could dock and useless the moment it was not: a pilot working a
// frontier they rent a bay on was paying 3400 credits to be sent four sectors from
// where they wanted to be.
{
  const { homePorts, foldTo, respawnAt } = await import('../shared/berth.js');
  const { MAPS } = await import('../shared/maps.js');
  const bare  = { co: 'm' };
  const renting = { co: 'm', berths: ['m4'] };

  check('a pilot who rents nothing has exactly their own ring to fold to',
    homePorts(bare, MAPS).length === 1 && homePorts(bare, MAPS)[0].map === 'm1',
    homePorts(bare, MAPS).map(h => h.name).join(', '));
  check('and a rented bay is a second one, named and placed',
    homePorts(renting, MAPS).some(h => h.map === 'm4' && h.kind === 'bay' && h.x > 0 && h.name),
    homePorts(renting, MAPS).map(h => `${h.name} (${h.kind})`).join(' | '));
  check('a company dock and a rented bay are not the same offer',
    homePorts(renting, MAPS).find(h => h.map === 'm1').kind === 'dock' &&
    homePorts(renting, MAPS).find(h => h.map === 'm4').kind === 'bay',
    'the bay does not repair you, and the menu says so');
  check('folding goes where you asked', foldTo(renting, MAPS, 'm4').map === 'm4');
  check('and to a sector you do not rent, it goes home instead',
    foldTo(renting, MAPS, 'm3').map === 'm1' && foldTo(bare, MAPS, 'm4').map === 'm1',
    'a berth can be sold and a save can be edited, so it is re-checked at the moment of use');
  check('a pilot who never chose still folds somewhere real',
    foldTo(bare, MAPS, null).map === 'm1' && foldTo(bare, MAPS, undefined).x > 0);
  check('every company gets the same deal, not just the first one',
    ['m', 'v', 'x'].filter(co => MAPS[co + '1']).every(co => foldTo({ co }, MAPS, null).map === co + '1'),
    'the fallback is derived from your company, not hardcoded to one ring');
  // The bug this whole block exists for, and it was live for six versions.
  //
  // A pilot who died at a rented bay came back in the top-left corner of the map,
  // unable to move, and dying again put them straight back there. The respawn
  // scatters you inside the ring — `Math.random() * at.r * 0.6` — and when this
  // became one shared list the radius was dropped from it. `Math.random() *
  // undefined` is NaN; a NaN position never moves, never renders anywhere real,
  // and cannot be escaped from inside the game.
  //
  // Every assertion here checked `.map` and not one of them checked where in it, so
  // the whole suite was green while respawning was broken for everybody — the home
  // dock too, not just a berth.
  for (const acct of [{ co: 'h', berths: ['h4'], lastDock: 'h4' },
                      { co: 'h' }, { co: 'm', lastDock: 'm1' }, { co: 'k', lastDock: 'nonsense' }]) {
    const at = respawnAt(acct, MAPS);
    const ang = 1.1, dist = 0.9 * at.r * 0.6;          // what server.js does
    const x = at.x + Math.cos(ang) * dist, y = at.y + Math.sin(ang) * dist;
    check(`a pilot coming back at ${at.map} lands somewhere real`,
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(at.r) && at.r > 0,
      `${at.kind} r=${at.r} -> ${Math.round(x)},${Math.round(y)}`);
    check('and inside the ring they came back to, not beside it',
      Math.hypot(x - at.x, y - at.y) <= at.r,
      `${Math.round(Math.hypot(x - at.x, y - at.y))}px of ${at.r}`);
  }

  // Respawn is the same question, so it is now literally the same function.
  check('and a wreck comes back through the very same list',
    respawnAt({ ...renting, lastDock: 'm4' }, MAPS).map === 'm4' &&
    respawnAt({ ...renting, lastDock: 'm3' }, MAPS).map === 'm1',
    'two copies of "which hangars are mine" disagreed once already');
}

// Folding from one hangar to another.
//
// The beacon refused while you were "at a dock", which was right for exactly as
// long as it had one destination — it always went home, so being home meant there
// was nothing to do. Once it asks WHICH hangar, that rule tells a pilot standing at
// their own ring that they cannot reach the bay they rent four sectors out, and the
// workaround was to fly out of your own ring in order to be allowed to leave it.
{
  const { whyNotDevice } = await import('../shared/devices.js');
  const kit = { devices: { recall: 2 }, using: 'recall' };
  check('you may fold out of a hangar, so long as it is not the one you are going to',
    whyNotDevice({ ...kit, atDest: false }) === null,
    'standing at your ring, folding to a rented bay — this used to be refused');
  check('and folding to where you already stand is still refused',
    /already standing there/.test(whyNotDevice({ ...kit, atDest: true }) ?? ''),
    whyNotDevice({ ...kit, atDest: true }));
  check('a fold already running still blocks a second one',
    /already running/.test(whyNotDevice({ ...kit, busy: true }) ?? ''));
  check('and no beacon aboard is still no beacon aboard',
    /no Recall Beacon aboard/.test(whyNotDevice({ devices: {}, using: 'recall' }) ?? ''));
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — a berth is ${berthPrice()} cr`}\n`);
process.exit(fails.length ? 1 : 0);
