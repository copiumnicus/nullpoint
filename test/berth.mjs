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

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — a berth is ${berthPrice()} cr`}\n`);
process.exit(fails.length ? 1 : 0);
