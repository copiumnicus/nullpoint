import { SILHOUETTES, ACCENTS, outlineFor, accentFor, canopyFor } from '../shared/silhouette.js';
import { HULLS, radiusOf } from '../shared/ships.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const span = k => {
  const p = outlineFor(k, 1);
  return { w: Math.max(...p.map(q => q[0])) - Math.min(...p.map(q => q[0])),
           h: Math.max(...p.map(q => q[1])) - Math.min(...p.map(q => q[1])) };
};

console.log('\nevery ship has a shape');
check('every hull in the game has one', Object.keys(HULLS).every(k => SILHOUETTES[k]),
  Object.keys(HULLS).join(' '));
check('and an accent to tell it apart by', Object.keys(HULLS).every(k => /^#[0-9a-f]{6}$/i.test(accentFor(k))));
check('no two hulls share an accent',
  new Set(Object.keys(HULLS).map(accentFor)).size === Object.keys(HULLS).length,
  Object.keys(HULLS).map(k => `${k} ${accentFor(k)}`).join(', '));
check('an unknown hull still draws something rather than nothing',
  outlineFor('nosuch', 10).length >= 3);

console.log('\nthey are real polygons');
for (const k of Object.keys(SILHOUETTES)) {
  const pts = outlineFor(k, 10);
  check(`the ${k} is a closed polygon of finite points`,
    pts.length >= 5 && pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
    `${pts.length} points`);
}
check('all of them point along +x, so heading is legible',
  Object.keys(SILHOUETTES).every(k => {
    const p = outlineFor(k, 1);
    const nose = Math.max(...p.map(q => q[0])), tail = Math.min(...p.map(q => q[0]));
    return nose > Math.abs(tail);          // more ship in front of centre than behind
  }), 'a silhouette with no nose reads as a rock');
check('none of them is a square',
  Object.keys(SILHOUETTES).every(k => Math.abs(span(k).w / span(k).h - 1) > 0.05),
  Object.keys(SILHOUETTES).map(k => `${k} ${(span(k).w / span(k).h).toFixed(2)}`).join(', '));

console.log('\nand they say what kind of ship it is');
// The point of the exercise: an interceptor should not read like a bomber. These
// are the two extremes, so if the shapes ever converge this is where it shows.
check('the interceptor is the longest and narrowest thing in the fleet',
  Object.keys(SILHOUETTES).every(k => k === 'kestrel' || span('kestrel').w / span('kestrel').h > span(k).w / span(k).h),
  `Kestrel ${(span('kestrel').w / span('kestrel').h).toFixed(2)} against ` +
  Object.keys(SILHOUETTES).filter(k => k !== 'kestrel').map(k => `${k} ${(span(k).w / span(k).h).toFixed(2)}`).join(', '));
check('the bomber is wider than it is long, like a flying wing',
  span('bulwark').w / span('bulwark').h < 1,
  `${(span('bulwark').w / span('bulwark').h).toFixed(2)} — it is all wing and no fuselage`);
check('the freighter is the bluntest nose of the four',
  Object.keys(SILHOUETTES).every(k => k === 'hauler' ||
    Math.max(...outlineFor('hauler', 1).map(p => p[0])) <= Math.max(...outlineFor(k, 1).map(p => p[0]))),
  'a container with engines');
check('every canopy sits ahead of the centre of the hull',
  Object.keys(SILHOUETTES).every(k => canopyFor(k) > 0));

console.log('\nthey survive being small');
for (const k of Object.keys(SILHOUETTES)) {
  const R = radiusOf(k), pts = outlineFor(k, R);
  // At R=10 a Kestrel is 20px across. Segments below ~1.5px are invisible and
  // just cost a lineTo, so a silhouette made of them is detail nobody can see.
  const seg = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  check(`the ${k} has no detail too fine to see at its real size`,
    Math.min(...seg) > 1.0,
    `radius ${R}, shortest edge ${Math.min(...seg).toFixed(1)}px`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — ${Object.keys(SILHOUETTES).length} silhouettes`}\n`);
process.exit(fails.length ? 1 : 0);
