import { aspectOf, alphaAt, dutyAt, shownAt, seenAs,
         MIN_ALPHA, MAX_ALPHA, MIN_DUTY } from '../shared/stealth.js';
import { ALIENS, WILD, effectiveHp } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

// A Bandit sitting at the origin with its nose along +x. `at` puts you that many
// degrees around it: 0 is straight in front of its nose, 180 is behind it.
const bandit = { x: 0, y: 0, heading: 0 };
const at = deg => ({ x: Math.cos(deg * Math.PI / 180) * 500,
                     y: Math.sin(deg * Math.PI / 180) * 500 });
const seenFor = (deg, samples = 4000) => {
  const a = aspectOf(bandit, at(deg));
  let on = 0;
  for (let i = 0; i < samples; i++) if (shownAt(a, i * 16, 3)) on++;
  return { aspect: a, alpha: alphaAt(a), seen: on / samples };
};

console.log('\naspect');
check('its nose is its quietest angle', aspectOf(bandit, at(0)) === 0);
check('and its tail its loudest', Math.abs(aspectOf(bandit, at(180)) - 1) < 1e-9);
check('the beam sits halfway', Math.abs(aspectOf(bandit, at(90)) - 0.5) < 1e-9);
check('and it does not care which side you are on',
  Math.abs(aspectOf(bandit, at(90)) - aspectOf(bandit, at(-90))) < 1e-9);
check('a Bandit facing away from you is fully exposed', (() => {
  const running = { x: 0, y: 0, heading: Math.PI };   // nose pointing at -x, you are at +x
  return Math.abs(aspectOf(running, at(0)) - 1) < 1e-9;
})(), 'which is why breaking off is when you can finally see one');

console.log('\nwhat you can see');
const table = [0, 30, 60, 90, 120, 150, 180].map(d => [d, seenFor(d)]);
for (const [d, r] of table)
  console.log(`     ${String(d).padStart(3)}°  aspect ${r.aspect.toFixed(2)}  ` +
              `alpha ${r.alpha.toFixed(2)}  drawn ${(r.seen * 100).toFixed(0)}% of the time`);

check('it gets more solid the further round you get',
  table.every(([, r], i) => i === 0 || r.alpha > table[i - 1][1].alpha));
check('and it is there more of the time too',
  table.every(([, r], i) => i === 0 || r.seen >= table[i - 1][1].seen - 0.02));
check('nose-on it is very nearly gone',
  seenFor(0).seen < 0.1 && seenFor(0).alpha <= MIN_ALPHA + 1e-9,
  `${(seenFor(0).seen * 100).toFixed(0)}% of the time, at ${MIN_ALPHA} alpha`);
check('on the beam it comes and goes rather than fading',
  seenFor(90).seen > 0.15 && seenFor(90).seen < 0.7,
  'the half-visible case is the interesting one, and it flickers');
check('tail-on it is simply a ship', seenFor(180).seen === 1 && alphaAt(1) === MAX_ALPHA);

console.log('\nthe flicker itself');
{
  // It has to shimmer, not strobe: a value that flips every frame is a headache
  // rather than an effect.
  const a = aspectOf(bandit, at(90));
  let flips = 0, was = shownAt(a, 0, 3);
  for (let i = 1; i < 600; i++) {                 // ten seconds at 60fps
    const now = shownAt(a, i * 16.7, 3);
    if (now !== was) flips++;
    was = now;
  }
  console.log(`     on the beam it changes state ${flips} times in ten seconds`);
  check('it shimmers rather than strobes', flips > 2 && flips < 90,
    'a few times a second at most');
  check('two Bandits do not blink together', (() => {
    let same = 0;
    for (let i = 0; i < 400; i++)
      if (shownAt(a, i * 16, 1) === shownAt(a, i * 16, 7)) same++;
    return same < 380;                            // not lockstep
  })(), 'the seed is the ship id, so a pair of them shimmer out of phase');
  check('the same Bandit looks the same to everybody at the same moment',
    shownAt(a, 12345, 9) === shownAt(a, 12345, 9),
    'deterministic in time and id, so two clients agree');
  check('duty never drops to nothing', dutyAt(0) >= MIN_DUTY,
    'you get a glimpse eventually, even nose-on');
}

console.log('\nthe Bandit');
{
  const b = ALIENS.bandit;
  check('it is in the wild and it hides', WILD.includes('bandit') && b.stealth === true);
  check('it is harder than the thing you meet first',
    effectiveHp('bandit') > effectiveHp('drifter') && b.attrs.damage > ALIENS.drifter.attrs.damage,
    `${effectiveHp('bandit')} ehp and ${b.attrs.damage} a shot`);
  check('and quicker, so you cannot simply get behind it',
    b.attrs.speed > ALIENS.drifter.attrs.speed,
    'the counterplay is out-turning it, not out-running it');
  check('it picks the fight from beyond where you could see it anyway',
    b.aggro > 0, `engages at ${b.aggro}`);
  check('it breaks off early, and is plain to see while it runs',
    b.flee > ALIENS.drifter.flee,
    'a fleeing Bandit shows you its back, which is its worst angle');

  // seenAs is what the client actually calls.
  const v = seenAs({ x: 0, y: 0, heading: 0 }, { x: 500, y: 0 }, 1000, 2);
  check('seenAs hands back everything the client needs',
    typeof v.aspect === 'number' && typeof v.alpha === 'number' && typeof v.shown === 'boolean'
    && Number.isFinite(v.aspect) && Number.isFinite(v.alpha));
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the Bandit'}\n`);
process.exit(fails.length ? 1 : 0);
