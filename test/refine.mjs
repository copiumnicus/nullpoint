import { refineStep, applyRefine, refinePeriod, holdWorth, holdRoom, LADDER, REFINE_EVERY }
  from '../shared/refine.js';
import { MATERIALS, holdVol, stow } from '../shared/cargo.js';
import { EQUIPMENT } from '../shared/gear.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

console.log('\nwhat a refinery does to a hold');
check('it walks the metals cheapest first',
  LADDER.every((m, i) => i === 0 || MATERIALS[m].tier > MATERIALS[LADDER[i - 1]].tier),
  LADDER.join(' -> '));
check('only a collector rig has one',
  refinePeriod('collect1') > 0 && refinePeriod('emitter5') === 0 && refinePeriod(null) === 0);
check('and a better rig works faster',
  refinePeriod('collect1') > refinePeriod('collect2') && refinePeriod('collect2') > refinePeriod('collect3'),
  `${refinePeriod('collect1')}s, ${refinePeriod('collect2')}s, ${refinePeriod('collect3')}s a batch`);

console.log('\nvalue is conserved, volume is not');
{
  const hold = { iron: 99 };
  const before = { worth: holdWorth(hold), vol: holdVol(hold) };
  const st = refineStep(hold, 'collect1');
  applyRefine(hold, st);
  check('three iron becomes one nickel: same credits, a third of the space',
    st.from === 'iron' && st.to === 'nickel' && holdVol(hold) < before.vol / 2,
    `${before.worth}cr in ${before.vol} units becomes ${holdWorth(hold)}cr in ${holdVol(hold)}`);
  check('and it frees real room', st.freed > 0, `${st.freed} units of hold`);
}
check('refining can never mint credits', (() => {
  for (const start of [{ iron: 1000 }, { nickel: 7 }, { cobalt: 45 }, { iron: 3, cobalt: 2 }]) {
    const hold = { ...start };
    let worth = holdWorth(hold), st;
    while ((st = refineStep(hold, 'collect3'))) {
      applyRefine(hold, st);
      const now = holdWorth(hold);
      if (now > worth + 1e-9) return false;
      worth = now;
    }
  }
  return true;
})(), 'every batch spends at least the value it produces — the rounding only ever loses');
check('and it stops at the top of the ladder',
  refineStep({ iridium: 500 }, 'collect3') === null, 'there is nothing above iridium to pack it into');
check('too little to make one of the next thing is left alone',
  refineStep({ iron: 2 }, 'collect1') === null, '2 iron is 6 credits and a nickel is 9');

console.log('\nwhich is the point: a hold climbs instead of filling');
{
  // The mechanic is not the compression, it is what you put in the space. This is
  // a pilot scooping iron into a 100-unit hold with a Scavenger Rig aboard.
  const CAP = 100;
  const hold = {};
  let scooped = 0;
  for (let t = 0; t < 60 * 6; t++) {                       // six minutes, a second a tick
    if (t % 3 === 0) scooped += stow(hold, 'iron', 4, CAP);   // a pod every three seconds
    if (t % refinePeriod('collect1') === 0) applyRefine(hold, refineStep(hold, 'collect1'));
  }
  const worth = holdWorth(hold);
  check('six minutes of scooping iron is worth far more than a hold of iron',
    worth > CAP / MATERIALS.iron.vol * MATERIALS.iron.value * 3,
    `${worth}cr held, against ${Math.floor(CAP / MATERIALS.iron.vol) * MATERIALS.iron.value}cr ` +
    `if the hold had simply filled with iron and stopped`);
  check('and the hold is not full, because it keeps making room',
    holdRoom(hold, CAP) > 0, `${holdVol(hold)}/${CAP} used after six minutes`);
  // Which rung it reaches depends on the rig and how long you have been out, so the
  // durable claim is about DENSITY: every unit of hold is carrying far more than
  // the iron that went into it.
  const perUnit = worth / Math.max(1, holdVol(hold));
  const ironPerUnit = MATERIALS.iron.value / MATERIALS.iron.vol;
  check('every unit of hold is carrying more than the iron that went in',
    perUnit > ironPerUnit * 3,
    `${perUnit.toFixed(2)}cr a unit against iron's ${ironPerUnit.toFixed(2)} — ` +
    Object.entries(hold).map(([m, n]) => `${n} ${m}`).join(', '));
  console.log(`     scooped ${scooped} iron over six minutes; holding ${worth}cr in ${holdVol(hold)} units`);
}
{
  // And the rig ladder is a real ladder: a faster refinery keeps up with a faster
  // scoop, so it climbs higher in the same six minutes.
  const CAP = 100;
  const run = rig => {
    const hold = {};
    for (let t = 0; t < 60 * 6; t++) {
      if (t % 3 === 0) stow(hold, 'iron', 4, CAP);
      if (t % refinePeriod(rig) === 0) applyRefine(hold, refineStep(hold, rig));
    }
    return holdWorth(hold);
  };
  const [a, b, c] = ['collect1', 'collect2', 'collect3'].map(run);
  console.log(`     six minutes: Scavenger ${a}cr, Harvester ${b}cr, Ore Tender ${c}cr`);
  check('a better refinery is worth more than a bigger hold', a < b && b < c,
    `${a} -> ${b} -> ${c} credits held, on the same scoop rate and the same hold`);
}

console.log('\nand that is what makes dying cost something');
{
  const plain = {}; stow(plain, 'iron', 999, 100);
  const CAP = 100, refined = {};
  for (let t = 0; t < 60 * 6; t++) {
    if (t % 3 === 0) stow(refined, 'iron', 4, CAP);
    if (t % refinePeriod('collect1') === 0) applyRefine(refined, refineStep(refined, 'collect1'));
  }
  check('a refined hold is worth many times a full one',
    holdWorth(refined) > holdWorth(plain) * 4,
    `${holdWorth(refined)}cr against ${holdWorth(plain)}cr — the same hold, one of them worth flying home`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — the hold climbs'}\n`);
process.exit(fails.length ? 1 : 0);
