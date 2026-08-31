import { SIZES, MAX_SIZES, NEAR, MIN_W, MIN_H, MAX_W, MAX_H,
         sanitiseView, viewsOf, mergeSizes, sayView } from '../shared/viewport.js';
import { newAccount, sanitiseAccount, carried, capture } from '../shared/account.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

console.log('\nwhat a client is allowed to say about its window');
{
  const v = sanitiseView({ w: 1512, h: 945, dpr: 2 }, 5000);
  check('a real window comes through unchanged', v.w === 1512 && v.h === 945 && v.dpr === 2,
    'a 14-inch MacBook Pro at its default scaling');
  check('a report with no timestamp is stamped on arrival', v.at === 5000,
    'the client owns its size, the server owns the clock');
  check('nothing at all is nothing, not a zero-size window',
    sanitiseView(null) === null && sanitiseView('1600x900') === null && sanitiseView({ w: 'wide' }) === null);
  // Clamped, not dropped: the point of the record is who plays on what, and a
  // pilot whose browser reported garbage once should not vanish from the count.
  const tiny = sanitiseView({ w: 0, h: -40, dpr: 0 }, 1);
  const huge = sanitiseView({ w: 1e9, h: 1e9, dpr: 99 }, 1);
  check('an impossible window is clamped rather than thrown away',
    tiny.w === MIN_W && tiny.h === MIN_H && huge.w === MAX_W && huge.h === MAX_H,
    `${MIN_W}x${MIN_H} to ${MAX_W}x${MAX_H}`);
  check('and so is a pixel ratio', tiny.dpr === 1 && huge.dpr === 4);
  check('a long scaling factor is rounded to something readable',
    sanitiseView({ w: 1, h: 1, dpr: 1.7647058823529411 }, 1).dpr === 1.76,
    'a Windows 150% display reports fifteen decimal places of it');
  check('a timestamp from the future is pulled back to now',
    sanitiseView({ w: 800, h: 600, at: 9e12 }, 1000).at === 1000,
    'a clock skew or an edit, and it decides the freshest row in the distribution');
  check('fractional pixels are rounded, because a sweep cannot be run at half a pixel',
    sanitiseView({ w: 1512.6, h: 944.4 }, 1).w === 1513);
}

console.log('\nthe distribution, not a log');
{
  const acc = {
    a: { view: { w: 1512, h: 945, dpr: 2, at: 10 } },
    b: { view: { w: 1512, h: 945, dpr: 1, at: 90 } },
    c: { view: { w: 2560, h: 1440, dpr: 1, at: 50 } },
    d: { view: null },
    e: {},
    f: { view: { w: 'nonsense', h: 5 } },
  };
  const rows = viewsOf(acc);
  console.log('     ' + rows.map(sayView).join('  '));
  check('one row per window, with how many pilots are in it',
    rows.length === 2 && rows[0].n === 2 && rows[1].n === 1,
    'two pilots on 1512x945, one on 2560x1440 — six accounts, two windows');
  check('the busiest window is named first', rows[0].w === 1512 && rows[1].w === 2560);
  check('the freshest report owns the pixel ratio', rows[0].dpr === 1,
    'b reported at t=90, a at t=10; a dpr is a fact about the display right now');
  check('a pilot who has never been seen is not counted', viewsOf({ z: {} }).length === 0);
  check('nothing thrown on no accounts at all',
    viewsOf(undefined).length === 0 && viewsOf({}).length === 0);
  check('the same accounts give the same list every time, on every machine',
    JSON.stringify(viewsOf(acc)) === JSON.stringify(viewsOf({ ...acc })),
    'the sweep is built out of this, and a test that shuffles is a test nobody trusts');
}

console.log('\nmerging real windows into the sweep');
{
  check('no observed sizes is the shipped list, exactly, and silently',
    JSON.stringify(mergeSizes([])) === JSON.stringify(SIZES)
    && JSON.stringify(mergeSizes()) === JSON.stringify(SIZES),
    `${SIZES.length} sizes on a fresh checkout, on CI, and on a deploy's first boot`);
  const merged = mergeSizes([{ w: 1512, h: 945 }, { w: 3440, h: 1440 }]);
  check('a size somebody plays at is added', merged.length === SIZES.length + 2
    && merged.some(([w, h]) => w === 1512 && h === 945),
    '1512x945 and 3440x1440 join the seven');
  check('and the awkward extremes stay', merged.some(([w, h]) => w === 820 && h === 560)
    && merged.some(([w, h]) => w === 2560 && h === 1440),
    '820x560 catches a panel off the bottom that 1920x1080 has never once caught');
  // Rewriting this is a design decision, not a bug fix: if the sweep ever wants to
  // follow the players rather than add to them, change the claim, do not delete it.
  check('observed sizes never replace the shipped ones',
    SIZES.every(([w, h]) => merged.some(([mw, mh]) => mw === w && mh === h)));
  check('a window within a hair of one already swept is not swept twice',
    mergeSizes([{ w: 1920 - NEAR, h: 1080 - NEAR }]).length === SIZES.length,
    `both axes within ${NEAR}px is the same layout ${NEAR}px bigger, and 28 more frames to say so`);
  check('but a hair further out is its own window',
    mergeSizes([{ w: 1920 - NEAR - 1, h: 1080 - NEAR - 1 }]).length === SIZES.length + 1);
  check('two observed windows near each other only get swept once',
    mergeSizes([{ w: 1512, h: 945 }, { w: 1512, h: 940 }]).length === SIZES.length + 1);
  // Found by fabricating forty accounts and running the sweep for real: a client
  // reporting nonsense is CLAMPED to 320x240 rather than dropped, so it keeps its
  // row in /sizes — and that clamped value went into the sweep and turned
  // test/render.mjs red at 420x320, over panels that overlap in a window nobody
  // has ever had. The floor is derived from the shipped list rather than picked,
  // because that list is the statement of what the game claims to fit in.
  const floor = SIZES.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])]);
  check('nothing smaller than the smallest window the game claims to fit in is swept',
    mergeSizes([{ w: 420, h: 320 }, { w: floor[0], h: floor[1] - 1 }]).length === SIZES.length,
    `${floor[0]}x${floor[1]} is the floor, and a client saying something stupid must not redden the suite`);
  const flood = Array.from({ length: 40 }, (_, i) => ({ w: 400 + i * 200, h: 300 + i * 130 }));
  check('twenty pilots do not become twenty times the frames',
    mergeSizes(flood).length === MAX_SIZES,
    `40 distinct windows, capped at ${MAX_SIZES} — each one costs 28 more frames through every panel`);
  // Smallest first on a tie, and it is a claim about where findings come from:
  // panels are laid out from the viewport, so a collision that exists at 1200x800
  // almost always exists at 3440x1440 too, and never the other way round.
  check('when the cap has to choose between equally-played windows it sweeps the cramped one',
    mergeSizes(viewsOf({ a: { view: { w: 3440, h: 1440 } }, b: { view: { w: 1200, h: 800 } } }),
               SIZES, SIZES.length + 1).some(([w]) => w === 1200),
    'one slot free, one 3440x1440 and one 1200x800 — the tight window is where the overlaps are');
  check('the cap takes the most-played windows, because viewsOf hands them over first',
    mergeSizes(viewsOf({
      a: { view: { w: 1512, h: 945 } }, b: { view: { w: 1512, h: 945 } },
      c: { view: { w: 3440, h: 1440 } },
    }), SIZES, SIZES.length + 1).some(([w]) => w === 1512),
    'one slot free and two candidates: the one two pilots use wins');
  check('a hand-edited size that is not a number is skipped rather than swept',
    mergeSizes([{ w: NaN, h: 900 }, ['wide', 'tall']]).length === SIZES.length);
}

console.log('\non the account');
{
  const fresh = newAccount('tok', 0, 1000);
  check('a new pilot has no window yet', fresh.view === null,
    'nobody has told us anything, and no default is a lie');
  const p = { view: { w: 1512, h: 945, dpr: 2, at: 1500 }, ship: { hull: 'hauler', fit: { weapon: [], generator: [], tech: [] }, drones: [], rig: null, formation: 'line', x: 0, y: 0 },
              gear: {}, hulls: ['hauler'], formations: ['line'], ammo: {}, using: {}, armed: {},
              kits: {}, devices: {}, kit: 'kit1', device: null, kills: {}, berths: [], claims: [],
              vault: {}, hold: {}, credits: 0, xp: 0, co: fresh.co, mapId: fresh.mapId,
              acted: 1500, banked: 1000 };
  capture(fresh, p, 2000);
  check('capture writes the window down so a restart does not forget it',
    fresh.view.w === 1512 && fresh.view.h === 945);
  check('and carried hands it straight back — the pair stays inverse',
    carried(fresh).view.w === 1512,
    'test/account.mjs fails by name if capture writes a field carried does not return');
  const disk = sanitiseAccount(JSON.parse(JSON.stringify(fresh)), 0, 9000);
  check('a round trip through JSON keeps it', disk.view.w === 1512 && disk.view.at === 1500);
  check('and a save file with junk in the field is cleaned, not trusted',
    sanitiseAccount({ token: 'x', view: { w: -1, h: 1e12 } }, 0, 1).view.w === MIN_W);
  check('a save file from before any of this existed is simply blank',
    sanitiseAccount({ token: 'x' }, 0, 1).view === null,
    'no default window, so nobody is counted at a size they never had');
  // The design call, written down so changing it means arguing with this line:
  // a reset throws away progress. A monitor is not progress.
  check('a window outlives a /reset, because a reset pilot has the same monitor',
    (() => {
      const seq = fresh.seq, co = fresh.co, name = fresh.name, admin = fresh.admin, view = fresh.view;
      const after = Object.assign(newAccount('tok', seq, 3000), { name, co, admin, view });
      return after.view.w === 1512 && after.credits === 0;
    })(), 'the same three lines in server.js that carry the callsign and the side across');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — viewport'}\n`);
process.exit(fails.length ? 1 : 0);
