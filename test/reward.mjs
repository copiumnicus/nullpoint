import { splitKill, shareOut, potFor, SHARE_FLOOR, GROUP_STEP, MAX_CLAIMS, MAX_POT } from '../shared/reward.js';
import { mayScoop, claimLapsed, CLAIM_TIME, POD_LIFE } from '../shared/cargo.js';
import { ALIENS, WILD, effectiveHp, BOUNTY_RATE } from '../shared/aliens.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const ledger = pairs => new Map(pairs);
const evenly = n => ledger(Array.from({ length: n }, (_, i) => [i + 1, 100]));
// A fixed number, not an alien's bounty. This was the Bandit's when the split was
// designed, and the arithmetic of dividing a pot must not start failing because
// somebody rebalanced a hostile.
const B = 21000;

console.log('\nwhat a kill pays');
check('killing it alone still pays the whole bounty',
  splitKill(ledger([[1, 1000]]), B)[0].credits === B, `${B}`);
check('two pilots at half the damage each take more than half',
  splitKill(evenly(2), B).every(r => r.credits === 13125),
  `${B} becomes a pot of ${Math.round(potFor(B, 2))}, so 13125 each rather than 10500`);
check('three split a pot half again as big',
  splitKill(evenly(3), B).every(r => r.credits === 10500),
  `pot ${Math.round(potFor(B, 3))}`);

console.log('\nthe floor');
check('a tenth of the damage is enough to be paid',
  splitKill(ledger([[1, 90], [2, 10]]), B).length === 2);
check('a hair under a tenth is not',
  splitKill(ledger([[1, 91], [2, 9]]), B).length === 1);
check('and the last shot buys nothing on its own', (() => {
  const cuts = splitKill(ledger([[1, 95], [2, 5]]), B);      // 2 lands the kill, does 5%
  return cuts.length === 1 && cuts[0].id === 1 && cuts[0].credits === B;
})(), 'a 5% kill-steal pays the stealer nothing and costs the other pilot nothing');
check('one pilot over the floor takes it from eleven who are under', (() => {
  const cuts = splitKill(ledger(Array.from({ length: 12 }, (_, i) => [i + 1, i === 0 ? 30 : 8])), B);
  return cuts.length === 1 && cuts[0].id === 1 && cuts[0].credits === B;
})(), 'the floor still bites whenever anybody actually clears it');

console.log('\nnobody can print money with this');
check('at most ten can claim, because eleven tenths do not fit in one alien',
  MAX_CLAIMS === 10 && splitKill(evenly(10), B).length === 10);
check('a full ten-way split is the most a kill can ever pay', (() => {
  const paid = splitKill(evenly(10), B).reduce((s, r) => s + r.credits, 0);
  return paid === Math.round(B * MAX_POT);
})(), `${splitKill(evenly(10), B).reduce((s, r) => s + r.credits, 0)} = ${MAX_POT} x ${B}, and each of the ten takes ${splitKill(evenly(10), B)[0].credits}`);
check('an eleven-way fight still pays ten of them, not one', (() => {
  // 9% each clears nobody's floor. Paying the single biggest would drop a
  // ten-way split of 6825 each to one pilot taking 21000 and ten taking nothing.
  const cuts = splitKill(evenly(11), B);
  return cuts.length === 10 && cuts.every(r => r.credits === 6825);
})(), 'the same ten the floor would have allowed at best, so the pot does not grow');
check('and crowding it further still cannot make it worth more', (() => {
  const cuts = splitKill(evenly(40), B);
  return cuts.length === 10 && cuts.reduce((s, r) => s + r.credits, 0) === Math.round(B * MAX_POT);
})(), '40 pilots pay the same 68250 as 10');
check(`no headcount at all pays more than ${MAX_POT} bounties`, (() => {
  for (let n = 1; n <= 40; n++) {
    for (const skew of [0, 1, 9]) {
      const l = ledger(Array.from({ length: n }, (_, i) => [i + 1, 100 + i * skew]));
      const paid = splitKill(l, B).reduce((s, r) => s + r.credits, 0);
      if (paid > B * MAX_POT + 1) return false;
    }
  }
  return true;
})(), 'swept 1..40 pilots at three skews');
check('bringing another ship never pays you more per kill than soloing did', (() => {
  let prev = Infinity;
  for (let n = 1; n <= 10; n++) {
    const each = splitKill(evenly(n), B)[0].credits;
    if (each >= prev) return false;                // strictly worse per kill, better per hour
    prev = each;
  }
  return true;
})(), 'per-kill share falls monotonically 21000 → 13125 → 10500 → …, so alts are not an income');
check('and it is the floor that sets the ceiling, not a second number',
  Math.abs(MAX_POT - (1 + GROUP_STEP * (Math.floor(1 / SHARE_FLOOR) - 1))) < 1e-9);

console.log('\nthe arithmetic itself');
check('the cuts always add up to the pot exactly', (() => {
  for (let n = 1; n <= 10; n++) {
    for (const skew of [1, 3, 17]) {
      const l = ledger(Array.from({ length: n }, (_, i) => [i + 1, 100 + i * skew]));
      const cuts = splitKill(l, B);
      const pot = Math.round(potFor(B, cuts.length));
      if (cuts.reduce((s, r) => s + r.credits, 0) !== pot) return false;
    }
  }
  return true;
})(), 'no credit is created or lost to rounding, at any share or any headcount');
check('experience is split the same way as credits', (() => {
  const cuts = splitKill(evenly(2), B, 2400);
  return cuts.every(r => r.credits === 13125) && cuts.reduce((s, r) => s + r.xp, 0) === Math.round(potFor(2400, 2));
})());
check('the pilot who did the most is listed first',
  splitKill(ledger([[7, 10], [8, 80], [9, 40]]), B)[0].id === 8);
check('an empty ledger pays nobody rather than throwing', splitKill(new Map(), B).length === 0);

console.log('\nevery wild alien still pays what its hull is worth');
for (const k of WILD.slice(0, 4)) {
  const a = ALIENS[k];
  check(`a lone kill on a ${a.name} is untouched by any of this`,
    splitKill(ledger([[1, 1]]), a.bounty)[0].credits === a.bounty,
    `${a.bounty} = ${Math.round(effectiveHp(k))} ehp x ${BOUNTY_RATE}`);
}

console.log('\nthe ore is shared on the same terms');
// One pod that whoever got there first took meant two rigs racing over a haul
// both pilots had paid for in hull, and the faster ship won it every time.
{
  const cuts = splitKill(evenly(2), B);
  const ore = shareOut(cuts, 20);
  check('a shared kill splits its cargo too', ore.length === 2 && ore[0] + ore[1] === 25,
    `20 iron becomes ${ore.join(' + ')} — the same 1.25x pot the credits use`);
  check('and one pod each means no race', ore.every(n => n > 0));
  check('a solo kill still drops the whole thing',
    shareOut(splitKill(ledger([[1, 1]]), B), 20)[0] === 20);
  check('the ore pot grows exactly as the credit pot does', (() => {
    const three = shareOut(splitKill(evenly(3), B), 20);
    return three.reduce((a, b) => a + b, 0) === Math.round(20 * 1.5);
  })(), '20 iron across three pilots pays out 30 — grouping is worth it in ore too, not just credits');
  check('and a single unit simply cannot go three ways', (() => {
    const one = shareOut(splitKill(evenly(3), B), 1);       // one iridium, three pilots
    // The pot rounds to 2 and the two biggest shares take it; the third gets 0,
    // and drop() never makes a pod out of nothing.
    return one.reduce((a, b) => a + b, 0) === 2 && one.filter(n => n > 0).length <= 2;
  })(), 'the smallest share goes home empty rather than with a phantom fraction');
  check('nobody on the ledger, nothing to share out', shareOut([], 20).length === 0);
}
check('a pod belongs to the pilot it was dropped for',
  mayScoop({ own: 7 }, 7) && !mayScoop({ own: 7 }, 8));
check('and an unclaimed pod is anyone\'s',
  mayScoop({ own: 0 }, 8) && mayScoop({}, 8) && mayScoop(null, 8),
  'ore already lying around, or a kill with no ledger behind it');
// A claim that held for the pod's whole life left ore on the field that everyone
// could see and nobody could touch.
check('a share stops being reserved well before the pod disperses',
  !claimLapsed({ t: POD_LIFE }) && !claimLapsed({ t: POD_LIFE - CLAIM_TIME + 1 })
  && claimLapsed({ t: POD_LIFE - CLAIM_TIME }),
  `reserved for ${CLAIM_TIME}s of a ${POD_LIFE}s life, then it is ordinary salvage`);
check('and the reservation always lapses with time to spare',
  CLAIM_TIME < POD_LIFE / 2,
  `${POD_LIFE - CLAIM_TIME}s left to pick it up after it opens to everyone`);

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — shared rewards'}\n`);
process.exit(fails.length ? 1 : 0);
