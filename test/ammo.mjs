import { AMMO, AMMO_KEYS, FEEDS, forWeapon, DEFAULT_AMMO, STARTING_AMMO,
         sanitiseAmmo, sanitiseUsing, magazine, hasRounds, roundPrice,
         barLayout, feedMenu } from '../shared/ammo.js';
import { newShip } from '../shared/sim.js';
import { fire } from '../shared/combat.js';
import { launch, ROCKET_RATE } from '../shared/rockets.js';
import { sanitiseFit } from '../shared/gear.js';
import { slotsOf, resolve, gunsOf, FIRE_RATE } from '../shared/ships.js';
import { newAccount, sanitiseAccount, capture } from '../shared/account.js';
import { ALIENS, WILD, effectiveHp, bountyFor, BOUNTY_RATE } from '../shared/aliens.js';
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
  check(`a better ${f} round hits harder and costs more`,
    g.every((k, i) => i === 0 || (AMMO[k].mult > AMMO[g[i - 1]].mult
                               && roundPrice(k) > roundPrice(g[i - 1]))),
    'no grade is a straight upgrade at the same price');
  check(`the default ${f} grade is the plain one`, AMMO[DEFAULT_AMMO[f]].mult === 1);
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
  check('a better round puts more on the target',
    dmgs.every((d, i) => i === 0 || d > dmgs[i - 1]));
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
  check('the best grade costs enough to be a decision',
    perMin(grades.at(-1)) > perMin(grades[0]) * 10,
    `${perMin(grades.at(-1)).toFixed(0)} cr a minute — you load it for a fight, not for the commute`);
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
      pays === bountyFor(kind), `${ehp} ehp at ${BOUNTY_RATE} = ${pays} cr`);
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
  check('the best warheads do not pay on trash', lux > ALIENS.drifter.bounty,
    'which is the point — you load them for something that deserves it');

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

console.log('\nthe bar');
{
  let off = 0, overlap = 0, menuOff = 0;
  for (const [W, H] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 640], [900, 600]]) {
    const L = barLayout(W, H);
    if (L.boxes.length !== FEEDS.length) off++;
    if (L.r.x < 0 || L.r.x + L.r.w > W || L.r.y < 0 || L.r.y + L.r.h > H) off++;
    for (let i = 1; i < L.boxes.length; i++)
      if (L.boxes[i].r.x < L.boxes[i - 1].r.x + L.boxes[i - 1].r.w) overlap++;
    // The chooser opens upward over the world, and must stay on screen with every
    // grade in the game listed at once.
    for (const b of L.boxes) {
      const M = feedMenu(b, forWeapon(b.feed));
      if (M.box.x < 0 || M.box.y < 0 || M.box.x + M.box.w > W || M.box.y + M.box.h > H) menuOff++;
      for (const r of M.rows)
        if (r.r.x < M.box.x || r.r.y < M.box.y
         || r.r.x + r.r.w > M.box.x + M.box.w || r.r.y + r.r.h > M.box.y + M.box.h) menuOff++;
    }
  }
  check('one box per weapon, centred, fitting every window', off === 0 && overlap === 0,
    `${FEEDS.length} boxes instead of ${AMMO_KEYS.length}`);
  check('and the chooser opens over the world without leaving it', menuOff === 0,
    'every grade listed, on the smallest window');
  const L = barLayout(1280, 720);
  check('lasers sit left of warheads, always in the same place',
    L.boxes[0].feed === 'laser' && L.boxes[1].feed === 'rocket',
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
  check('and enough quiet does', step({}, 1200) === CALM);
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

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
                               : `PASS — ${AMMO_KEYS.length} grades`}\n`);
process.exit(fails.length ? 1 : 0);
