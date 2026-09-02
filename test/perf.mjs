import { sampler, push, stats, fmtMs, fmtFps, frameLine, pingLine,
         frameGrade, pingGrade, FRAME_GOOD, FRAME_POOR, PING_GOOD, PING_POOR, TICK_MS, GRADE,
         drawEvery, FPS_CAP }
  from '../shared/perf.js';
import { TICK_HZ } from '../shared/sim.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const of = (...v) => { const s = sampler(); v.forEach(x => push(s, x)); return s; };

console.log('\nmeasuring');
check('nothing measured yet says so rather than lying',
  stats(sampler()) === null && frameLine(sampler(), sampler()).text === 'measuring…');
check('it reports the typical frame and the worst recent one', (() => {
  const st = stats(of(16, 16, 16, 16, 16, 16, 16, 16, 16, 40));
  return st.typical === 16 && st.worst === 40;
})(), 'the average frame is what you live with, the worst is what you notice');
check('one backgrounded-tab hitch does not become the headline', (() => {
  // p95, not the true maximum: a single 400ms stall while the tab was hidden is
  // not a performance problem and should not be the number for two seconds.
  const st = stats(of(...Array(99).fill(16), 400));
  return st.worst < 400;
})(), 'p95, so a lone stall is not what the menu shows');
check('a clock that runs backwards is refused, not averaged in',
  stats(of(16, -5, NaN, 16)).n === 2, 'two good samples of four offered');
check('the window is fixed, so measuring cannot itself allocate per frame', (() => {
  const s = sampler(8);
  for (let i = 0; i < 500; i++) push(s, i);
  return s.n === 8 && stats(s).typical >= 492;
})(), 'a ring of 8 holds the last 8');

console.log('\nreading it');
check('milliseconds get one decimal where it matters',
  fmtMs(16.66) === '16.7ms' && fmtMs(6.4) === '6.4ms',
  '16.6 against 17.2 is the difference between holding 60 and not');
check('and drop it once the number is big enough not to care',
  fmtMs(133.4) === '133ms');
check('frames also read as frames, because that is how people think about them',
  fmtFps(16.7) === '60fps' && fmtFps(33.3) === '30fps');
check('nothing measured prints a dash rather than NaN',
  fmtMs(NaN) === '—' && fmtFps(0) === '—' && fmtMs(undefined) === '—');

console.log('\nwhat counts as good, derived from the tick');
check('the thresholds come from the tick rate, not from taste',
  FRAME_GOOD === TICK_MS / 2 && FRAME_POOR === TICK_MS &&
  PING_GOOD === TICK_MS * 2 && PING_POOR === TICK_MS * 4,
  `one tick is ${TICK_MS.toFixed(1)}ms at ${TICK_HZ}Hz`);
check('drawing faster than the world changes is good',
  frameGrade(16.7) === 'good' && frameGrade(8) === 'good',
  '60fps reads as good, and is not tripped by its own rounding');
check('and drawing slower than the world changes is bad',
  frameGrade(50) === 'poor', 'past the tick you are looking at stale frames whatever your connection');
check('a round trip inside a tick or two is good',
  pingGrade(40) === 'good' && pingGrade(66) === 'good');
check('and past four ticks the world has moved on before you hear',
  pingGrade(200) === 'poor');
check('every grade has a colour', Object.keys(GRADE).every(k => /^#|^#/.test(GRADE[k])));

console.log('\nthe two lines the menu prints');
{
  const cost = of(3.9, 4.2, 3.7, 4.4, 11.8, 4.0, 4.1, 3.8, 4.3, 6.2);
  const rate = of(16.4, 16.7, 17.1, 16.2, 33.9, 16.5, 16.8, 16.3, 16.6, 21.0);
  const f = frameLine(cost, rate);
  const p = pingLine(of(38, 41, 36, 52, 39, 44, 37, 120, 40, 42));
  check('the frame line says what a draw cost, how often one happens, and the worst',
    /ms draw.+fps.+worst/.test(f.text), f.text);
  check('the ping line says both numbers', /ms.+worst/.test(p.text), p.text);
  check('they answer different questions',
    frameLine(of(60), rate).grade === 'poor' && pingLine(of(60)).grade === 'good',
    'a 60ms frame is bad and a 60ms round trip is fine — one is your machine, one is the distance');
  // The bug this readout had: it sampled the GAP between requestAnimationFrame
  // callbacks, so a machine holding vsync printed a contented 16.7ms whether the
  // draw inside it took 1ms or 15. It is now graded on the draw, and the rate is
  // beside it because a capped rate is not news.
  const at30 = ms => frameLine(of(...Array(20).fill(ms)), of(...Array(20).fill(33.3)));
  check('thirty frames a second that cost three milliseconds each is a throttled tab, and reads green',
    at30(3).grade === 'good', at30(3).text);
  check('thirty frames a second that cost thirty milliseconds each is a machine at its limit, and does not',
    at30(30).grade === 'fair', at30(30).text + ' — the old readout printed 33.3ms for both of these');
}

console.log('\nthe frame cap');
check('the cap is a stated number, not a literal in the render loop', FPS_CAP === 60);
check('a display that cannot beat the cap draws every frame it is given',
  drawEvery(1000 / 60) === 1 && drawEvery(1000 / 50) === 1 && drawEvery(1000 / 30) === 1,
  'a machine already short of 60 must never be made slower by a cap meant to save work');
check('a 120Hz panel draws every other frame, and a 240Hz one every fourth',
  drawEvery(1000 / 120) === 2 && drawEvery(1000 / 240) === 4, 'both land on exactly 60');
check('a 144Hz panel halves rather than dropping to 48',
  drawEvery(1000 / 144) === 2,
  '144 does not divide by 60, and a whole division held for the same time each is the point — ' +
  'a stopwatch cap shows 2, 2 then 3 refreshes in turn, which is judder');
check('a rate that reads a percent low does not lose the cap',
  drawEvery(1000 / 119) === 2 && drawEvery(1000 / 118) === 2,
  'a measured refresh wobbles; a 120Hz panel reading 119 must not fall back to drawing all 120');
check('nothing measured yet draws everything', drawEvery(undefined) === 1 && drawEvery(0) === 1 &&
  drawEvery(NaN) === 1 && drawEvery(-4) === 1, 'and a zero-length frame is not an infinite refresh rate');
check('the render harness is untouched by it', drawEvery(16) === 1,
  'test/render.mjs steps frames 16ms apart — 62.5fps, which does not divide by 60');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — performance readout'}\n`);
process.exit(fails.length ? 1 : 0);
