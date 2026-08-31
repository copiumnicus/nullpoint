// Scrolling, and the fact that there is only one of it.
import { scroller, wheel, ease, rowsIn, stackIn, barIn, spanOf, heightOf,
         NOTCH, EASE } from '../shared/scroll.js';
import { bayLayout, STORE_ROW } from '../shared/hangar.js';
import { filePanel } from '../shared/threats.js';
import { WILD } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nthe wheel');
{
  const s = scroller();
  wheel(s, 1, 500);
  check('a notch moves the same distance whatever is being scrolled',
    s.want === NOTCH,
    `${NOTCH}px — it used to be "2", which is two ROWS on a shop and two PIXELS on the ` +
    'stats page, and a stats page that does not move');
  for (let i = 0; i < 40; i++) wheel(s, 1, 500);
  check('and it stops at the end rather than counting past it',
    s.want === 500, `asked for ${41 * NOTCH}px of a 500px list, sitting on 500`);
  wheel(s, -1, 500);
  check('so one notch back is one notch back, not the first of forty',
    s.want === 500 - NOTCH,
    'unbounded above, coming back did nothing until every phantom step was undone — ' +
    'which reads exactly like a list that does not scroll');
  const t = scroller();
  wheel(t, -1, 500);
  check('and it stops at the top too', t.want === 0);
}

console.log('\nthe easing');
{
  const s = scroller();
  wheel(s, 1, 400);
  let now = 0, at = 0;
  for (let i = 0; i < 30; i++) { now += 33; at = ease(s, now, 400); }
  check('it arrives, and inside a fifth of a second at 30fps',
    at === s.want, `${(now / 1000).toFixed(2)}s of frames to travel ${NOTCH}px`);
  // Frame-rate independence is the property that makes it feel the same everywhere.
  const a = scroller(), b = scroller();
  wheel(a, 1, 400); wheel(b, 1, 400);
  let ta = 0, tb = 0;
  for (let i = 0; i < 6; i++) { ta += 33; ease(a, ta, 400); }      // 30fps
  for (let i = 0; i < 29; i++) { tb += 6.9; ease(b, tb, 400); }    // 144fps, same wall clock
  // Within a few percent of the travel, not to the pixel: integrating an exponential
  // in discrete steps cannot be exact, and the claim worth making is that nobody can
  // see the difference — not that two different frame rates agree bit for bit.
  check('and a fast client and a slow one are in the same place at the same moment',
    Math.abs(a.at - b.at) < NOTCH * 0.06,
    `${a.at.toFixed(1)} at 30fps against ${b.at.toFixed(1)} at 144fps after ` +
    `${(ta / 1000).toFixed(2)}s — ${Math.abs(a.at - b.at).toFixed(1)}px apart of a ${NOTCH}px notch`);
  // It must run off the FRAME clock: the harness drives frames in milliseconds of
  // real time, so an easing on performance.now() never advances and the panel is
  // frozen to the only thing that could have tested it.
  const c = scroller();
  wheel(c, 1, 400);
  let tc = 0;
  for (let i = 0; i < 20; i++) { tc += 16; ease(c, tc, 400); }
  check('and it moves on the timestamp it is handed, not on the wall clock',
    c.at > 0, 'a suite that runs in three milliseconds still sees it travel');
}

console.log('\nwhat is on screen');
{
  const rows = rowsIn({ x: 0, top: 100, room: 200, w: 500, n: 20, rowH: 58, at: 0 });
  check('a list hands back only what the window can hold',
    rows.length < 20 && rows.length >= 3, `${rows.length} of 20 rows of 58px in 200px`);
  check('and the rows it hands back overhang on purpose',
    rowsIn({ x: 0, top: 100, room: 200, w: 500, n: 20, rowH: 58, at: 30 })[0].r.y < 100,
    'the caller clips, which is what makes a row leaving the top get cut rather than ' +
    'drawn across the header');
  const hs = [34, 49, 34, 64, 34];
  const un = stackIn({ x: 0, top: 0, room: 100, w: 500, heights: hs, at: 0 });
  check('rows of different heights stack without a gap or an overlap',
    un.every((r, i) => i === 0 || r.r.y === un[i - 1].r.y + hs[un[i - 1].i]),
    hs.join('/') + ' — the stats page, where one attribute is a line and another is four');
  check('a list that fits gets no scrollbar',
    barIn({ x: 0, top: 0, room: 500, content: 100, at: 0 }) === null &&
    spanOf(100, 500) === 0, 'a short shelf grows no control it does not need');
  const bar = barIn({ x: 0, top: 100, room: 200, content: 800, at: 600 });
  check('and one that does not gets a thumb that reaches the bottom',
    Math.abs(bar.y + bar.h - (100 + 200)) < 1,
    `at the very end the thumb is flush: ${(bar.y + bar.h).toFixed(0)} of ${100 + 200}`);
}

console.log('\nand every list in the game uses it');
{
  const state = { hull: 'vanguard', gear: { emitter3: 9, plating: 4 }, hulls: ['vanguard'],
                  formations: ['line'], drones: 3, escort: [], fit: { weapon: [], generator: [], tech: [] },
                  formation: 'line', mask: 0 };
  const panels = [
    ['the shop', bayLayout(1600, 900, { ...state, tab: 'store', page: 'tech', scroll: 0 })],
    ['the locker', bayLayout(1600, 900, { ...state, tab: 'inventory', scroll: 0 })],
    ['the stats page', bayLayout(1600, 900, { ...state, tab: 'stats', scroll: 0 })],
  ];
  check('every scrolling panel reports its span in pixels and a window to clip to',
    panels.every(([, G]) => G.body && Number.isFinite(G.scroll?.span) && Number.isFinite(G.scroll?.max)),
    panels.map(([n, G]) => `${n} ${G.scroll.span}px in ${Math.round(G.body.h)}`).join(', '));
  check('and the threat file, which is where the good one came from',
    Number.isFinite(filePanel(1600, 900, 0, WILD.length).maxScroll),
    `${filePanel(1600, 900, 0, WILD.length).maxScroll}px to scroll`);
  // The bug that started this: scrolling a page by a row index while it lays out by
  // pixels moves it by almost nothing.
  // A window short enough that the shelf actually overflows it — at 1600x900 the
  // technology page fits and there is nothing to scroll, which is correct and
  // useless for testing scrolling.
  const a = bayLayout(1000, 460, { ...state, tab: 'store', page: 'tech', scroll: 0 });
  const b = bayLayout(1000, 460, { ...state, tab: 'store', page: 'tech', scroll: 60 });
  const moved = a.store[0].r.y - b.store.find(r => r.i === a.store[0].i).r.y;
  check('asking a shelf for sixty pixels moves it sixty, or to the end, and nothing else',
    Math.abs(moved - Math.min(60, a.scroll.max)) < 1,
    `asked 60, ${a.scroll.max}px of travel exists, moved ${Math.round(moved)} — ` +
    'not one row, and not the two pixels a shared "+2" used to give it');

  // And the footer that counts them. The store says "3-9 of 14", which is a count
  // of ROWS, while the thing it was reading became PIXELS the moment everything
  // moved onto shared/scroll.js — so it printed a pixel offset as a row number and
  // a five-item shelf claimed to be showing item 418.
  const foot = sc => { const q = bayLayout(900, 380, { ...state, tab: 'store', page: 'ammo', scroll: sc }).scroll;
                       return `${q.first + 1}-${Math.min(q.total, q.first + q.per)} of ${q.total}`; };
  check('the shelf footer counts rows, not the pixels it scrolled',
    foot(0) === '1-3 of 6' && foot(99999) === '4-6 of 6',
    `top reads "${foot(0)}", bottom reads "${foot(99999)}" — it read "${
      Math.round(bayLayout(900, 380, { ...state, tab: 'store', page: 'ammo', scroll: 99999 }).scroll.at)
    }-… of 6" while at was pixels`);
  check('and the bottom of the list is the bottom of the count',
    foot(99999).startsWith('4-6'),
    'the last row is numbered last — off-by-one at the end reads as a row you cannot reach');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — one scroll'}\n`);
process.exit(fails.length ? 1 : 0);
