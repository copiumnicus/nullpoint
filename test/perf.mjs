import { sampler, push, stats, fmtMs, fmtFps, frameLine, pingLine,
         frameGrade, pingGrade, FRAME_GOOD, FRAME_POOR, PING_GOOD, PING_POOR, TICK_MS, GRADE }
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
  stats(sampler()) === null && frameLine(sampler()).text === 'measuring…');
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
  const f = frameLine(of(16.4, 16.7, 17.1, 16.2, 33.9, 16.5, 16.8, 16.3, 16.6, 21.0));
  const p = pingLine(of(38, 41, 36, 52, 39, 44, 37, 120, 40, 42));
  check('the frame line says both numbers and a rate', /ms.+fps.+worst/.test(f.text), f.text);
  check('the ping line says both numbers', /ms.+worst/.test(p.text), p.text);
  check('they answer different questions', frameLine(of(60)).grade === 'poor' && pingLine(of(60)).grade === 'good',
    'a 60ms frame is bad and a 60ms round trip is fine — one is your machine, one is the distance');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — performance readout'}\n`);
process.exit(fails.length ? 1 : 0);
