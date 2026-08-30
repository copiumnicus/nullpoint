import { STEER_KEYS, isSteerKey, steerVector } from '../shared/steer.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const v = (...keys) => steerVector(new Set(keys));
const len = p => Math.hypot(p.dx, p.dy);

console.log('\nwhich way the keys point');
check('W flies up the screen', v('w').dy === -1 && v('w').dx === 0);
check('S flies down it',       v('s').dy ===  1 && v('s').dx === 0);
check('A flies left',          v('a').dx === -1 && v('a').dy === 0);
check('D flies right',         v('d').dx ===  1 && v('d').dy === 0);

console.log('\nholding more than one');
check('a diagonal is still a full throttle, not a faster one',
  Math.abs(len(v('w', 'd')) - 1) < 1e-9,
  `W+D is ${len(v('w', 'd')).toFixed(3)} long, the same as W alone at ${len(v('w')).toFixed(3)}`);
check('and it points between the two', (() => {
  const p = v('w', 'd');
  return Math.abs(p.dx - Math.SQRT1_2) < 1e-9 && Math.abs(p.dy + Math.SQRT1_2) < 1e-9;
})(), `${v('w','d').dx.toFixed(3)}, ${v('w','d').dy.toFixed(3)}`);
check('all four corners come out the same length',
  [['w','a'], ['w','d'], ['s','a'], ['s','d']].every(k => Math.abs(len(v(...k)) - 1) < 1e-9));

console.log('\nkeys that cancel');
// This is the reason steerVector normalises at all. The server reads a vector
// shorter than 0.001 as a stop, so W+S would arrive as one either way — but the
// client has to know it is a stop to send it once and not a 'dir' every tick.
check('W and S together is a stop, not a drift', v('w', 's') === null);
check('so is A and D',                           v('a', 'd') === null);
check('and so is nothing at all',                v() === null);
check('three keys still resolve', (() => {
  const p = v('w', 'a', 'd');                    // A and D cancel, W survives
  return p && Math.abs(p.dx) < 1e-9 && Math.abs(p.dy + 1) < 1e-9;
})());

console.log('\nboth hands are catered for');
check('the arrows fly the same way their letters do',
  ['w:arrowup', 'a:arrowleft', 's:arrowdown', 'd:arrowright'].every(pair => {
    const [letter, arrow] = pair.split(':');
    return v(letter).dx === v(arrow).dx && v(letter).dy === v(arrow).dy;
  }));
check('holding a letter and its arrow at once is still one throttle, not two',
  Math.abs(len(v('w', 'arrowup')) - 1) < 1e-9 && v('w', 'arrowup').dy === -1,
  'the sum is normalised like any other pair, so nobody has to pick a hand');
check('and mixing hands works: W with ArrowRight is the same as W with D', (() => {
  const mixed = v('w', 'arrowright'), same = v('w', 'd');
  return Math.abs(mixed.dx - same.dx) < 1e-9 && Math.abs(mixed.dy - same.dy) < 1e-9;
})());
check('an arrow opposite its letter cancels', v('w', 'arrowdown') === null);

console.log('\nthe binding itself');
check('eight keys steer — two bindings for four directions', Object.keys(STEER_KEYS).length === 8,
  Object.keys(STEER_KEYS).join(' '));
check('they are lower case, because the handler lower-cases before it looks',
  Object.keys(STEER_KEYS).every(k => k === k.toLowerCase()));
check('every direction has exactly two keys', (() => {
  const seen = new Map();
  for (const [k, [x, y]] of Object.entries(STEER_KEYS)) {
    const d = `${x},${y}`; seen.set(d, (seen.get(d) ?? 0) + 1);
  }
  return seen.size === 4 && [...seen.values()].every(n => n === 2);
})());
check('nothing else is a steering key',
  !isSteerKey('h') && !isSteerKey('q') && !isSteerKey(' ') && !isSteerKey('tab') && !isSteerKey('arrow'));
check('unknown keys in the set are ignored, not counted', (() => {
  const p = v('w', 'h', 'Shift');
  return p && p.dy === -1 && p.dx === 0;
})());

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — steering'}\n`);
process.exit(fails.length ? 1 : 0);
