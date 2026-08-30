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
check('and it is a real decision, not pocket change', berthPrice() > devicePrice('recall') * 10);

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
