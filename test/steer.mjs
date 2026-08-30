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

console.log('\nthe binding itself');
check('exactly four keys steer', Object.keys(STEER_KEYS).length === 4,
  Object.keys(STEER_KEYS).join(''));
check('they are lower case, because the handler lower-cases before it looks',
  Object.keys(STEER_KEYS).every(k => k === k.toLowerCase() && k.length === 1));
check('nothing else is a steering key', !isSteerKey('h') && !isSteerKey('q') && !isSteerKey(' '));
check('unknown keys in the set are ignored, not counted', (() => {
  const p = v('w', 'h', 'Shift');
  return p && p.dy === -1 && p.dx === 0;
})());

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — steering'}\n`);
process.exit(fails.length ? 1 : 0);
