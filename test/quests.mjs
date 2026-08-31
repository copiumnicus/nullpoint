// Quests: what a hunt is worth, and what a reward is allowed to be.
import { QUESTS, QUEST_KEYS, ANCHOR, ANCHOR_KILLS, POSTED, needFor, secsPerKill,
         progressOf, earnedBy, newlyEarned, sanitiseUnlocked, bonusBays,
         questFor, questLine, questBar, QUEST_H } from '../shared/quests.js';
import { ALIENS, WILD, farmHp, effectiveHp, MIRROR } from '../shared/aliens.js';
import { HULLS, DEFAULT_HULL, baysOf, berthed, resolve, slotsOf } from '../shared/ships.js';
import { EQUIPMENT, MAX_DRONES } from '../shared/gear.js';
import { MODULES } from '../shared/research.js';
import { rowsOf, LAYERS } from '../shared/breakdown.js';
import { sanitiseAccount, carried, capture, newAccount } from '../shared/account.js';
import { FILE_ROW, filePanel, dossierOf } from '../shared/threats.js';

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const hours = kind => needFor(kind) * secsPerKill(kind) / 3600;
const BIG = ['hive', 'crucible', 'doldrum', 'thresher'];

// ------------------------------------------------------------ what it costs you
console.log('\nthe price, in hours');
console.log('     ' + BIG.map(k =>
  `${ALIENS[k].name} x${needFor(k)} (${hours(k).toFixed(2)}h)`).join('   '));
{
  check("the designer's hundred Corsair Hives is the number everything else is derived from",
    needFor(ANCHOR) === ANCHOR_KILLS && ANCHOR === 'hive',
    `${ANCHOR_KILLS} of them, and moving that one line moves all four — in hours, not in counts`);

  // The claim the whole derivation exists to make. Every quest is the same hunt.
  const spread = Math.max(...BIG.map(hours)) / Math.min(...BIG.map(hours));
  check('every quest is the same afternoon, whichever hostile it is an afternoon of',
    spread < 1.06,
    `${Math.min(...BIG.map(hours)).toFixed(2)}h to ${Math.max(...BIG.map(hours)).toFixed(2)}h — ` +
    `${((spread - 1) * 100).toFixed(1)}% apart, which is the rounding to fives and nothing else`);

  // And the claim that says WHY it is time and not hit points. farmHp is what the
  // economy is priced in, and pricing a quest that way would ask for half as many
  // Crucibles as the honest number, because it counts the shooting and ignores the
  // three quarters of the fight that is waiting for the next one to come back.
  const byHp = kind => ANCHOR_KILLS * farmHp(ANCHOR) / farmHp(kind);
  check('counting hit points instead of minutes would ask for half the Crucibles it should',
    Math.round(byHp('crucible')) < needFor('crucible') * 0.6,
    `${Math.round(byHp('crucible'))} on hit points against ${needFor('crucible')} on the clock — ` +
    `a Crucible is ${(farmHp('crucible') / farmHp(ANCHOR)).toFixed(2)}x a Hive to shoot and ` +
    `${(secsPerKill('crucible') / secsPerKill(ANCHOR)).toFixed(2)}x a Hive to farm`);

  check('the respawn is most of what a kill costs at this end of the bestiary',
    BIG.every(k => (ALIENS[k].respawn / POSTED) / secsPerKill(k) > 0.3),
    BIG.map(k => `${k} ${Math.round(100 * (ALIENS[k].respawn / POSTED) / secsPerKill(k))}%`).join(' ') +
    ` — two of each are posted, so the wait is half the respawn`);

  check('the gun it is measured with is the sharpest one the shop sells',
    secsPerKill('hive') === farmHp('hive') / MIRROR.dps + ALIENS.hive.respawn / POSTED,
    `${MIRROR.dps} dps, which test/aliens.mjs pins to balance.js's finished build to the penny`);

  // Research must not enter it: the ladder multiplies hull and shield and never
  // damage, so a quest is exactly as long for a pilot at x1 as at x32.
  check('the research ladder does not make a quest shorter',
    !Object.values(MODULES).some(m => m.mul && !['hull', 'shld'].includes(m.line)),
    'every rung multiplies hull or shield — nothing on it touches the gun that sets this');
}

// ------------------------------------------------------- could you buy it instead
console.log('\nwhat a reward is allowed to be');
{
  // CLAUDE.md rule five, stated as a test. The invariant is about money: the question
  // to ask a reward is whether somebody could skip it with a credit card.
  const forSale = new Set([...Object.keys(EQUIPMENT), ...Object.keys(HULLS), ...Object.keys(MODULES)]);
  check('nothing a quest pays is on sale anywhere',
    QUEST_KEYS.every(k => !forSale.has(k)),
    `${forSale.size} things have a price and none of them is a quest reward — ` +
    'the anti-pay-to-win rule is about money, and a hundred Corsair Hives is not for sale');

  // And the other half: it is a straight reward, with no drawback. This is here so
  // that a later hand cannot quietly "balance" one back into a trade without saying
  // so — the design call was made out loud and this is where it is kept.
  check('and a reward is a reward — no drawback, no second price at a counter',
    QUEST_KEYS.every(k => !('price' in QUESTS[k]) && !('costs' in QUESTS[k])),
    'you went and did a hard thing; the game does not then charge you for it');

  check('every quest names a hostile that actually exists',
    QUEST_KEYS.every(k => WILD.includes(QUESTS[k].kind)),
    QUEST_KEYS.map(k => `${k} -> ${ALIENS[QUESTS[k].kind].name}`).join(', '));

  check('and it is drawn from the hardest end of the bestiary',
    QUEST_KEYS.every(k => effectiveHp(QUESTS[k].kind) >= effectiveHp('thresher')),
    QUEST_KEYS.map(k => `${ALIENS[QUESTS[k].kind].name} ${effectiveHp(QUESTS[k].kind).toLocaleString('en-US')} ehp`)
      .join(', ') + ' — an end-game unlock is paid for at the end of the game');
}

// -------------------------------------------------------------- earning it, once
console.log('\nearning it');
{
  const need = needFor('hive');
  check('one kill short of the number is not the number',
    !progressOf({ hive: need - 1 }, 'brood').done && progressOf({ hive: need }, 'brood').done,
    `${need - 1} is ${Math.round(progressOf({ hive: need - 1 }, 'brood').at * 100)}% and ${need} is done`);

  check('the reward lands on the kill that finishes it, and never again',
    newlyEarned([], { hive: need }).length === 1 && newlyEarned(['brood'], { hive: need * 9 }).length === 0,
    'the banner fires once — this is what the server checks before it grants, so a ' +
    'finished quest cannot re-announce itself every tick for the rest of the session');

  check('a quest you are still working on lands nothing',
    newlyEarned([], { hive: need - 1 }).length === 0 && earnedBy({ hive: need - 1 }).length === 0);

  // The reason it is stored rather than re-derived every time it is asked about.
  check('a reward already earned survives the threshold being raised later',
    sanitiseUnlocked(['brood']).includes('brood') && bonusBays(['brood']) === QUESTS.brood.bays,
    'the list is the authority, not the tally — raise the Hive to 150 tomorrow and ' +
    'nobody who earned it at 100 loses two bays mid-flight');

  check('and a hand-edited save cannot invent one',
    sanitiseUnlocked(['brood', 'freeStuff', 7, null]).join() === 'brood',
    'membership of a fixed list, the same rule `claims` and `berths` live under');

  check('a quest is only offered for a hostile that has one',
    questFor('hive') === 'brood' && questFor('drifter') === null
      && questLine({ drifter: 900 }, 'drifter', []) === null,
    `${QUEST_KEYS.length} of ${WILD.length} hostiles carry a quest; the rest draw no line at all`);
}

// -------------------------------------------------------------- what it does
console.log('\nwhat the Brood Frame does');
{
  const BOUGHT = Object.keys(HULLS).filter(h => HULLS[h].price > 0);
  const spare = bonusBays(['brood']);
  check('a Corsair Hive broods twelve Bandits, and the frame broods two more drones',
    spare === 2 && ALIENS.hive.broods?.kind === 'bandit',
    `${ALIENS.hive.broods.max} raiders out of a Hive, +${spare} berths out of a hundred Hives — ` +
    'the mothership’s own mechanic, pointed the other way');

  // THE ANTI-DOMINATION CLAIM, which is the one the mounts invariant is really about.
  const deltas = BOUGHT.map(h => baysOf(h, spare) - baysOf(h));
  check('every hull earns the same two berths, so no hull dominates another because of it',
    new Set(deltas).size === 1 && deltas[0] === spare,
    BOUGHT.map(h => `${h} ${baysOf(h)} -> ${baysOf(h, spare)}`).join(', ') +
    ' — the comparison in test/ships.mjs is over the hull table and the hull table has not moved');

  check('and a hull the shop sells still says what the shop sold',
    BOUGHT.every(h => baysOf(h) === HULLS[h].bays),
    'baysOf() takes the earned berths as an argument, so every caller asking about a ' +
    'HULL rather than about a PILOT keeps getting the same answer with no edit');

  // It has to actually seat them, which is a different claim from owning them.
  const full = Array(14).fill('emitter5');
  check('the two extra bays actually fly',
    berthed('bulwark', full).length === baysOf('bulwark')
      && berthed('bulwark', full, spare).length === baysOf('bulwark') + spare,
    `a Bulwark seats ${berthed('bulwark', full).length} drones and ${berthed('bulwark', full, spare).length} with the frame`);

  const bare = resolve('bulwark', { weapon: [], generator: [], tech: [] }, full, 'wedge');
  const with2 = resolve('bulwark', { weapon: [], generator: [], tech: [] }, full, 'wedge', spare);
  check('and two more guns is more damage, which is the whole point of a berth',
    with2.damage > bare.damage && with2.berths === bare.berths + spare,
    `${Math.round(bare.damage)} -> ${Math.round(with2.damage)} damage, ` +
    `${bare.berths} -> ${with2.berths} berths`);

  // The fleet cap is what you may OWN, and it has to rise with the berths or every
  // login silently deletes the drones the extra bays bought.
  const acct = sanitiseAccount({ token: 't', hull: 'kestrel', hulls: ['kestrel'],
                                 drones: Array(MAX_DRONES + spare).fill('emitter1'),
                                 unlocked: ['brood'] }, 0, Date.now());
  const poor = sanitiseAccount({ token: 't', hull: 'kestrel', hulls: ['kestrel'],
                                 drones: Array(MAX_DRONES + spare).fill('emitter1') }, 0, Date.now());
  check('a pilot keeps the drones the extra bays bought across a sign-out',
    acct.drones.length === MAX_DRONES + spare && poor.drones.length === MAX_DRONES,
    `${acct.drones.length} kept with the frame, ${poor.drones.length} without — ` +
    'sanitiseDrones slices at the fleet cap, a Kestrel berths exactly the fleet cap, ' +
    'and without this every login would have thrown two purchases away');
}

// --------------------------------------------------------- it survives a restart
console.log('\nit is kept');
{
  const a = newAccount('tok', 0, Date.now());
  check('a new pilot has finished nothing',
    Array.isArray(a.unlocked) && a.unlocked.length === 0);

  // The inverse pair. test/account.mjs fails BY NAME if capture() learns to write a
  // field carried() does not hand back; this is the same claim from the quest side.
  const p = { ...carried(a), unlocked: ['brood'], kills: { hive: 120 },
              co: a.co, xp: 0, credits: 0, mapId: a.mapId, hulls: [DEFAULT_HULL],
              gear: {}, formations: [a.formation], berths: [], claims: [],
              ship: { hull: DEFAULT_HULL, fit: { weapon: [], generator: [], tech: [] },
                      drones: [], rig: null, formation: a.formation, x: 0, y: 0 },
              acct: a, banked: Date.now(), acted: Date.now() };
  capture(a, p, Date.now());
  const back = carried(sanitiseAccount(JSON.parse(JSON.stringify(a)), 0, Date.now()));
  check('what you earned is written down, comes back off the disk, and is handed straight back',
    a.unlocked.join() === 'brood' && back.unlocked.join() === 'brood',
    'capture -> JSON -> sanitiseAccount -> carried, the round trip a sign-out actually takes');

  check('and a save from before quests existed simply has none',
    sanitiseAccount({ token: 't', kills: { hive: 900 } }, 0, Date.now()).unlocked.length === 0,
    'nine hundred Hives on an old save grants nothing at load — the next kill grants it, ' +
    'which is the server doing it rather than the loader');
}

// ------------------------------------------------------------ where you see it
console.log('\nwhere a pilot finds out');
{
  // The fifth layer. The stats page exists so no number on the ship is unexplained,
  // and two extra berths change damage, shield, cargo and the escort bonus at once.
  check('the stats page has a layer for what you earned, and it is the last one',
    LAYERS.at(-1) === 'earned' && LAYERS.length === 5,
    LAYERS.join(' -> ') + ' — applied last because it is applied last: the ladder ' +
    'still multiplies what the extra drones added');

  const opts = { hull: 'bulwark', fit: { weapon: ['emitter5'], generator: ['cellE'], tech: [] },
                 drones: Array(12).fill('emitter5'), rig: null, formation: 'wedge', mask: 0 };
  const off = rowsOf(opts), on = rowsOf({ ...opts, unlocked: ['brood'] });
  const berthRow = rows => rows.find(r => r.key === 'berths');
  check('and the berths are a row on it, so two extra bays can explain themselves',
    berthRow(on) && berthRow(on).final === berthRow(off).final + 2
      && berthRow(on).steps.some(s => s.layer === 'earned'),
    `Drone berths ${berthRow(off).final} -> ${berthRow(on).final}, credited to "what you have earned"`);

  check('a pilot who has earned nothing gets no fifth layer at all',
    off.every(r => !r.steps.some(s => s.layer === 'earned')),
    'the layer contributes no rows when it moved no numbers, so nobody reads a heading ' +
    'for something they have not done');

  const dmg = rows => rows.find(r => r.key === 'damage');
  check('the two extra drones show up as damage under that heading rather than out of nowhere',
    dmg(on).final > dmg(off).final && dmg(on).steps.some(s => s.layer === 'earned'),
    `${Math.round(dmg(off).final)} -> ${Math.round(dmg(on).final)}`);
}

console.log('\non the threat file');
{
  const need = needFor('hive');
  const part = questLine({ hive: 37 }, 'hive', []);
  const done = questLine({ hive: need * 9 }, 'hive', ['brood']);
  console.log(`     "${part.label}"`);
  console.log(`     "${done.label}"`);
  check('the file says what you are working toward and how far off you are',
    part.label.includes('37/100') && part.at === 0.37 && !part.has,
    'the tally was already there; this is the tally with something to reach');
  check('and it reads EARNED once it is yours, with the bar full',
    done.has && done.at === 1 && done.label.includes('EARNED'),
    'a veteran with 900 Hives reads "EARNED", not "900/100" — the real count is ' +
    'already drawn beside it in 15px green, and one number twice is one of them wrong');

  // The row had to grow, and this is the claim that says by how much and why.
  check('the row is tall enough that the bar is inside its own card',
    FILE_ROW === 96 + QUEST_H,
    `${FILE_ROW}px, which is the old 96 plus ${QUEST_H} for the line and the bar — ` +
    'a row you can see and a bar you cannot is the same bug as a row outside its panel');

  // And it stays inside at every window the render harness sweeps, under the longest
  // tell in the file. 6px a character is breakdown.js's own HINT_CH budget.
  const worst = Math.max(...['hive', 'crucible', 'doldrum', 'thresher']
    .map(k => dossierOf(k).tell.length));
  const bad = [];
  for (const [w, h] of [[1920, 1080], [1600, 900], [1440, 900], [1280, 800], [1100, 700], [1024, 640], [820, 560]]) {
    const L = filePanel(w, h, 0, 4);
    if (!L.rows.length) continue;
    const r = L.rows[0].r, q = questBar(r);
    const wide = r.w - 78 - 96;                        // the client's own wrap width
    const lines = Math.ceil((worst * 6) / Math.max(1, wide));
    const tellBottom = 56 + (lines - 1) * 12;          // last tell baseline, from the row top
    if (q.track.y + q.track.h > r.y + r.h) bad.push(`${w}x${h} bar out of the card`);
    if (q.text.y - 7 < r.y + tellBottom) bad.push(`${w}x${h} bar through a ${lines}-line tell`);
  }
  check('at every window the harness sweeps, the bar clears the longest tell in the file',
    bad.length === 0,
    bad.join(', ') || `${worst} characters of Crucible, wrapping to three lines at 1024 ` +
    'and still clear of the bar under it');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — ${QUEST_KEYS.length} quest, ${needFor(ANCHOR)} Corsair Hives, ${hours(ANCHOR).toFixed(1)} hours`}\n`);
process.exit(fails.length ? 1 : 0);
