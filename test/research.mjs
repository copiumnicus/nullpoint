// Research stations: the yard, the ladders, and what they do to a ship.
import * as R from '../shared/research.js';
import { MAPS, HOMES } from '../shared/maps.js';
import { resolve, slotsOf, HULLS } from '../shared/ships.js';
import { EQUIPMENT, deepOnly } from '../shared/gear.js';
import { ALIENS, effectiveHp } from '../shared/aliens.js';
import { sanitiseLab } from '../shared/account.js';
import { STREAMS, LAB_FIELDS, packLab, unpackLab } from '../shared/net.js';
import { MAX_FIELDS } from '../shared/delta.js';

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const f = (n, d = 2) => Number(n).toFixed(d);

console.log('\nthe yard');
{
  const base = MAPS[HOMES[0]].base;
  const plots = R.plotsFor(base);
  let closest = Infinity;
  for (let i = 0; i < plots.length; i++)
    for (let j = i + 1; j < plots.length; j++)
      closest = Math.min(closest, Math.hypot(plots[i].x - plots[j].x, plots[i].y - plots[j].y));
  const away = plots.map(p => Math.hypot(p.x - base.x, p.y - base.y));

  check('a company ring holds enough plots that nobody is turned away in practice',
    plots.length > 100, `${plots.length} to a ring, ${plots.length * HOMES.length} in the galaxy`);
  check('no two stations are close enough to fly into each other',
    closest >= R.LAB_GAP - 1,
    `${f(closest, 1)}px apart, which is ${f(closest - 2 * R.LAB_R, 0)}px of clear sky between hulls — ` +
    'a Bulwark is 34 across');
  check('none of them is parked on the dock, where everyone spawns',
    Math.min(...away) >= R.YARD_IN - 1, `nearest is ${Math.round(Math.min(...away))}px out`);
  check('and none of them is outside the ring it is supposed to be in',
    Math.max(...away) <= base.r - R.LAB_R, `furthest is ${Math.round(Math.max(...away))}px of a ${base.r} ring`);
  // The yard is derived from base.r, so widening a ring adds outer rings and moves
  // nothing already standing. That is the seam rule seven asks for.
  const wider = R.plotsFor({ ...base, r: base.r + 240 });
  check('widening the ring adds plots without moving the ones already there',
    wider.length > plots.length &&
    plots.every((p, i) => wider[i].x === p.x && wider[i].y === p.y),
    `${plots.length} -> ${wider.length} plots, and the first ${plots.length} are unmoved`);
}

console.log('\nwhere yours goes');
{
  const base = MAPS[HOMES[0]].base;
  const pack = n => {
    const taken = []; let placed = 0;
    for (let i = 0; i < n; i++) {
      const slot = R.claimPlot('token-' + i, base, taken);
      if (slot !== null) { taken.push(slot); placed++; }
    }
    return { placed, taken };
  };
  const fifty = pack(50), full = pack(500);
  check('fifty pilots all get a plot, and no two get the same one',
    fifty.placed === 50 && new Set(fifty.taken).size === 50);
  check('and the yard fills rather than overflowing',
    full.placed === R.plotsFor(base).length,
    `500 asked, ${full.placed} placed, ${500 - full.placed} refused — the rest are told the number`);
  check('a refusal says how full it is rather than just no',
    /138 plots|plots, all taken/.test(R.whyNotStake({ credits: 1e9, docked: true, room: false, plots: 138 }) ?? ''),
    R.whyNotStake({ credits: 1e9, docked: true, room: false, plots: 138 }));
  // The plot is written down at purchase precisely BECAUSE this is order-dependent.
  // Re-deriving at boot would move a pilot's station the first time a neighbour
  // bought one, which is the bug this assertion exists to remember.
  const fwd = [], bwd = [];
  for (let i = 0; i < 60; i++) { const s = R.claimPlot('t' + i, base, fwd); if (s !== null) fwd.push(s); }
  for (let i = 59; i >= 0; i--) { const s = R.claimPlot('t' + i, base, bwd); if (s !== null) bwd.push(s); }
  const moved = fwd.filter((s, i) => s !== bwd[59 - i]).length;
  check('probing is order-dependent, which is why the plot is stored and not re-derived',
    moved > 0, `${moved} of 60 land elsewhere when the same pilots arrive in the other order`);
  check('the same pilot always wants the same plot in an empty yard',
    R.claimPlot('steady', base, []) === R.claimPlot('steady', base, []));
}

console.log('\nwhat it earns');
{
  const one = R.addMod(0, 'mine1');
  const two = R.addMod(one, 'mine2');
  check('the first rig pays for the whole station in a day',
    Math.abs(R.incomeOf(one) * 86400 - (R.LAB_PRICE + R.MODULES.mine1.price)) < 100_000,
    `${R.incomeOf(one)} cr/s x 86,400 = ${(R.incomeOf(one) * 86400).toLocaleString('en-US')} against ` +
    `${(R.LAB_PRICE + R.MODULES.mine1.price).toLocaleString('en-US')} spent`);
  check('and it is a supplement rather than a replacement for flying',
    R.incomeOf(one) < R.ACTIVE_RATE * 0.35,
    `${R.incomeOf(one)} cr/s against ${R.ACTIVE_RATE} of active play — ${f(100 * R.incomeOf(one) / R.ACTIVE_RATE, 0)}%`);
  // Highest tier wins. Summing would make the ladder an exponent and buying the
  // bottom rung repeatedly beat climbing it.
  check('a better rig supersedes the one below it rather than stacking with it',
    R.incomeOf(two) === R.MODULES.mine2.rate,
    `${R.incomeOf(two)} cr/s, not ${R.MODULES.mine1.rate + R.MODULES.mine2.rate}`);
  check('every rung of the mine is better value per credit than the rung below',
    R.tiersOf('mine').every((k, i, all) => !i ||
      R.MODULES[k].rate / R.MODULES[k].price > R.MODULES[all[i - 1]].rate / R.MODULES[all[i - 1]].price),
    R.tiersOf('mine').map(k => `${k} ${f(R.MODULES[k].rate / R.MODULES[k].price * 1e6, 1)}`).join(' < ') +
    ' cr/s per million — so the thing you are saving for is always the next one');
  check('nothing is paid for time that has not passed',
    R.earnedOver(one, 0) === 0 && R.earnedOver(one, -5000) === 0 && R.earnedOver(0, 1e6) === 0);
  check('and one login cannot bank an unbounded amount',
    R.cappedSecs(1e12) === R.OFFLINE_CAP_H * 3600,
    `capped at ${R.OFFLINE_CAP_H}h — a skewed clock or an edited save is a credit printer otherwise`);
}

console.log('\nwhat it makes you');
{
  // The top of the CLIMB, not the top of the shop. The research ladder's height was
  // chosen against a Corsair Hive flown by a finished ship, and "finished" is the
  // ship a pilot arrives at the Hive in — the Hive stands on the gate sectors, and
  // the sixth rungs are sold at deep outposts four hops PAST it. Reading the shelf's
  // very top here compares the wrong pilot: measured, a x32 deep build parks in a
  // full brood at 290% of what standing still costs, where the climb's top build
  // reads 68% and has to fly the fight.
  //
  // That the deep build CAN park in one is true, and it is the same sentence the
  // bestiary report has been making about the Hive for three revisions — it needs
  // x22.7 the hit points it has. The answer to that is the Hive's numbers, not this
  // ladder's height, so this claim stays where it was pointed.
  const best = s => Object.entries(EQUIPMENT).filter(([k, e]) => e.slot === s && !deepOnly(k))
    .sort(([, a2], [, b2]) => (b2.tier ?? 0) - (a2.tier ?? 0))[0][0];
  const w = best('weapon'), g = best('generator');
  const finished = h => {
    const sl = slotsOf(h);
    return resolve(h, { weapon: Array(sl.weapon).fill(w), generator: Array(sl.generator).fill(g), tech: [] },
                   Array(8).fill(w), 'arrow');
  };
  let full = 0;
  for (const k of R.MODULE_KEYS) full = R.addMod(full, k);

  const st = finished('bulwark'), big = R.applyResearch(st, full);
  check('the whole ladder is thirty-two times the hull and thirty-two times the shield',
    big.hull === st.hull * 32 && big.shield === st.shield * 32,
    `${Math.round(st.hull + st.shield)} ehp becomes ${Math.round(big.hull + big.shield)}`);
  check('it multiplies what the shops sold you rather than changing what they sell',
    R.applyResearch(st, 0) === st && big.damage === st.damage && big.speed === st.speed,
    'hull and shield only — a station does not make your guns bigger');
  // The anti-pay-to-win invariant this has to satisfy: it is bought with credits
  // every pilot earns the same way, and it scales every hull by the same factor,
  // so no hull dominates another because of it.
  const hulls = Object.keys(HULLS).filter(h => HULLS[h].price > 0);
  check('no hull is favoured by it — every one scales by exactly the same factor',
    hulls.every(h => {
      const a = finished(h), b2 = R.applyResearch(a, full);
      return b2.hull === a.hull * 32 && b2.shield === a.shield * 32;
    }), hulls.join(', '));
  check('a rank cannot buy it and money can, which is the way round this game allows',
    !JSON.stringify(R.MODULES).includes('"rank"') && !JSON.stringify(R.MODULES).includes('"level"'),
    'levels may gate but never scale — this is a gate on time, open to everyone');

  // The claim the ladder's height was chosen from.
  const dps = st.damage * st.fireRate * (st.guns ?? 1);
  const secs = effectiveHp('hive') / dps;
  const brood = ALIENS.hive.broods.max * ALIENS.bandit.attrs.damage * ALIENS.bandit.attrs.fireRate;
  // Deliberately SHORT of standing still in one. Even at the top of the ladder you
  // have to fly the fight — thin the escorts, break off, let shields come back.
  // A ladder whose last rung lets you park in the hardest content and hold the
  // trigger has taken the fight out of the fight.
  const tank = secs * brood;
  check('even the top of the ladder cannot just stand still in a Corsair Hive',
    (big.hull + big.shield) > tank * 0.6 && (big.hull + big.shield) < tank,
    `parking in a full brood costs ${Math.round(tank).toLocaleString('en-US')} damage and x32 is ` +
    `${Math.round(big.hull + big.shield).toLocaleString('en-US')} — ` +
    `${Math.round(100 * (big.hull + big.shield) / tank)}% of it, so you still have to fly`);
  // And the reason the ladder is taller than the goal: flying well is worth tiers.
  const kite = 300;
  const solo = [1, 2, 3, 4, 5].find(t => {
    let m = 0; for (let i = 1; i <= t; i++) m = R.addMod(R.addMod(m, 'hull' + i), 'shld' + i);
    const s2 = R.applyResearch(st, m); return (s2.hull + s2.shield) > secs * kite;
  });
  check('but a pilot who kites well gets there several tiers earlier',
    solo && solo < 5,
    `staying out of the escorts' reach solos it at tier ${solo} of 5 — the gap is what flying well buys`);
}

console.log('\nclimbing it');
{
  const one = R.addMod(0, 'hull1');
  check('you cannot skip a rung',
    /tier below/.test(R.whyNotBuild('hull3', { credits: 1e12, mask: one, near: true }) ?? ''),
    R.whyNotBuild('hull3', { credits: 1e12, mask: one, near: true }));
  check('you cannot buy one twice',
    R.whyNotBuild('hull1', { credits: 1e12, mask: one, near: true }) === 'already built');
  check('and you cannot build from across the sector',
    /fly to your station/.test(R.whyNotBuild('hull2', { credits: 1e12, mask: one, near: false }) ?? ''));
  check('the next rung is buyable when you are there with the money',
    R.whyNotBuild('hull2', { credits: R.MODULES.hull2.price, mask: one, near: true }) === null);
  check('a price you cannot meet says so with the number in it',
    /costs 2000000/.test(R.whyNotBuild('hull2', { credits: 0, mask: one, near: true }) ?? ''),
    R.whyNotBuild('hull2', { credits: 0, mask: one, near: true }));
  check('staking one refuses a second',
    R.whyNotStake({ credits: 1e12, docked: true, has: true }) === 'you already have a research station');
}

console.log('\nthe mask, which is the wire format');
{
  check('every module has its own bit and the order is the format',
    new Set(R.MODULE_KEYS.map(R.bitOf)).size === R.MODULE_KEYS.length &&
    R.MODULE_KEYS.every((k, i) => R.bitOf(k) === i),
    `${R.MODULE_KEYS.length} modules of a possible ${R.MAX_MODULES} — reordering them renames every one already bought`);
  check('the mask cannot run past what a signed 32-bit shift can hold',
    R.MODULE_KEYS.length <= R.MAX_MODULES && R.MAX_MODULES === MAX_FIELDS,
    `1 << 31 is negative, which is the same reason SHIP_FIELDS stops at ${MAX_FIELDS}`);
  check('a hand-edited mask cannot name a module that does not exist',
    R.sanitiseMods(0x7fffffff) === (1 << R.MODULE_KEYS.length) - 1 &&
    R.sanitiseMods('nonsense') === 0 && R.sanitiseMods(-5) >= 0,
    `0x7fffffff comes back as ${R.sanitiseMods(0x7fffffff)}, which is every module that actually exists`);
  const now = Date.now();
  check('a plot off the end of the lattice is dropped, not clamped to zero',
    sanitiseLab({ slot: 99999, mods: 1, since: now }, now).slot === null,
    'clamping would stack every broken save on plot zero');
  check('and a timestamp from the future cannot print credits',
    sanitiseLab({ slot: 1, mods: 1, since: now + 1e9 }, now).since <= now);
}

console.log('\non the wire');
{
  check('a station is its own stream rather than a ship',
    !!STREAMS.labs && LAB_FIELDS.length < MAX_FIELDS,
    `${LAB_FIELDS.length} fields — SHIP_FIELDS is at 30 of ${MAX_FIELDS} and had no room`);
  const row = packLab({ id: 2_000_001, x: 6689.4, y: 4367.6, mods: 5, name: 'Ana' }, true);
  const back = unpackLab(row);
  check('it round-trips, and whose it is comes down per viewer',
    back.id === 2_000_001 && back.x === 6689 && back.mods === 5 && back.name === 'Ana' && back.own === 1 &&
    unpackLab(packLab({ id: 1, x: 0, y: 0, mods: 0, name: 'Ben' }, false)).own === 0,
    'the same station is own:1 to its owner and own:0 to everybody else');
  check('nothing on a station ever changes, so it costs nothing per tick',
    LAB_FIELDS.every(k => ['id', 'x', 'y', 'mods', 'own', 'name'].includes(k)),
    'it rides the keyframe and then goes quiet — 50 of them are 1,570 bytes once');
}

console.log('\nwhat a rung is worth, in your own numbers');
{
  const best = s2 => Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === s2)
    .sort((a, b) => (EQUIPMENT[b].tier ?? 0) - (EQUIPMENT[a].tier ?? 0))[0];
  const sl = slotsOf('vanguard');
  const st = resolve('vanguard', { weapon: Array(sl.weapon).fill(best('weapon')),
                                   generator: Array(sl.generator).fill(best('generator')), tech: [] },
                     Array(6).fill(best('weapon')), 'arrow');
  const g0 = R.rungGain(0, 'hull', st);
  check('a rung says what it makes YOUR hull, not that it makes it bigger',
    g0 && /\d/.test(g0.label) && g0.then === g0.now * 2,
    `${g0.label} — a pilot cannot tell whether "stronger" means one percent or one hundred`);
  // The base already has the tier you own folded into it, so the multiplier has to
  // be divided back out or the second rung would quote the first one's numbers.
  let m = R.addMod(0, 'hull1');
  const st2 = R.applyResearch(st, m);
  const g1 = R.rungGain(m, 'hull', st2);
  check('and it reads off the hull you have now, not the one the shops sold you',
    g1.now === Math.round(st.hull * 2) && g1.then === Math.round(st.hull * 4),
    `${g1.label} after one tier — the bar already shows the tier you bought`);
  const gm = R.rungGain(0, 'mine', st);
  check('the mine says the rate and the day, because a day is what you feel',
    /cr\/s/.test(gm.label) && /a day/.test(gm.sub),
    `${gm.label} · ${gm.sub}`);
  let top = 0; for (const k of R.tiersOf('hull')) top = R.addMod(top, k);
  check('a finished ladder has nothing left to quote',
    R.rungGain(top, 'hull', st) === null, 'the row says it is the top instead');
}

console.log('\nthe tech tree');
{
  const { holdValue, pocketValue } = await import('../shared/cargo.js');
  const bought = R.addMod(0, 'pocket1');
  check('the tree is a second family on the SAME mask, not a second mask',
    R.TREE.every(line => R.tiersOf(line).length > 0) &&
    R.hasPocket(bought) && !R.hasPocket(0) && R.sanitiseMods(bought) === bought,
    `${R.MODULE_KEYS.length} modules of ${R.MAX_MODULES} — ${R.MAX_MODULES - R.MODULE_KEYS.length} bits ` +
    'of headroom left, so a tree upgrade costs nothing on the account and nothing on the wire');
  // A tree entry is its own line with one tier on it, which is what lets every
  // ladder function work on it unchanged. Two upgrades sharing a line would make
  // the second say "you are already past this one" the moment you bought the first.
  check('a tree upgrade is a ladder line with one rung, so it climbs like everything else',
    R.TREE.every(line => R.tiersOf(line).length === 1) &&
    R.rowState(0, 'pocket', 1e12).next === 'pocket1' && R.rowState(bought, 'pocket', 0).done,
    R.TREE.map(l => `${l}: ${R.tiersOf(l).join(', ')}`).join(' · ') + ' — one line per upgrade');
  check('it refuses in the same words the ladder does, from the same function',
    R.whyNotBuild('pocket1', { credits: 0, mask: 0, near: true }) === `costs ${R.POCKET_PRICE} cr — you cannot pay yet` &&
    R.whyNotBuild('pocket1', { credits: 1e12, mask: 0, near: false }) === 'fly to your station to build on it' &&
    R.whyNotBuild('pocket1', { credits: 1e12, mask: bought, near: true }) === 'already built',
    'one whyNotBuild, so the panel can never offer something the server then declines');
  // The whole anti-pay-to-win argument for putting it on the research station: it
  // is bought with credits and it does not touch a single number on the ship, so
  // no pilot is harder to kill for owning one and the stats page owes it nothing.
  const st = { hull: 1900, shield: 3700, damage: 500, speed: 300, cargo: 120 };
  check('the tree buys income and not power — nothing on the ship moves',
    JSON.stringify(R.applyResearch(st, bought)) === JSON.stringify(st) &&
    R.incomeOf(bought) === 0,
    'a Pocket Dimension is worth credits per hour and zero hit points, so a pilot who owns one ' +
    'is exactly as easy to kill as a pilot who does not');
  check('and it is priced in the hold you are actually carrying, not in prose',
    (() => {
      const g2 = R.treeGain('pocket1', { platinum: 180, iridium: 24 });
      return g2 && g2.worth === holdValue({ platinum: 180, iridium: 24 })
                && g2.paid === pocketValue({ platinum: 180, iridium: 24 }) && /\d/.test(g2.label);
    })(),
    R.treeGain('pocket1', { platinum: 180, iridium: 24 }).label +
    ' — "sells your ore" is a fact about the module, a number is a fact about you');
  check('an empty hold is told what the module does rather than quoted a zero',
    !/0/.test(R.treeGain('pocket1', {}).label) && R.treeGain('pocket1', {}).worth === 0,
    R.treeGain('pocket1', {}).label);
  // Named because it was a real bug for one draft: rungGain read
  // `line === 'hull' ? 'hull' : 'shield'`, so the tree page quoted a Pocket
  // Dimension as a shield upgrade the first time it drew.
  check('a tree line has no rung to quote on the ladder page, and says so rather than guessing',
    R.rungGain(0, 'pocket', { hull: 1900, shield: 3700 }) === null,
    'it is priced in what it pays, not in what it makes your ship');
  check('an upgrade nobody has written a gain line for still draws, from `does`',
    R.treeGain('nothing-yet', {}) === null,
    'rule seven: the second tree entry is a row of data, and it works before anybody prices it');
}

console.log('\nthe panel');
{
  for (const [w, h] of [[1600, 900], [1024, 700], [420, 380]]) {
    // Every PAGE, not just the first. The strip is drawn from the same rectangles
    // the click handler tests, and a tab you can see and cannot press is the same
    // bug as a row outside its panel — which this codebase has shipped twice.
    for (const tab of R.LAB_TAB_KEYS) {
      const L = R.labPanel(w, h, tab);
      const inside = r => r.x >= L.panel.x && r.y >= L.panel.y
                       && r.x + r.w <= L.panel.x + L.panel.w && r.y + r.h <= L.panel.y + L.panel.h;
      // `L.rows.every(inside)` passes every() the INDEX as the second argument, which
      // is harmless here but was not when `inside` took the row rather than its rect.
      check(`at ${w}x${h} the ${tab} page keeps every row and every tab inside the panel`,
        L.panel.x >= 0 && L.panel.y >= 0 && L.panel.x + L.panel.w <= w
        && L.rows.every(row => inside(row.r)) && L.tabs.every(t2 => inside(t2.r)),
        `${L.rows.length} rows, ${L.tabs.length} tabs, panel ${L.panel.w}x${L.panel.h}`);
    }
    // One size on every page, so switching tabs never moves a row under the cursor
    // — a click landing on the row you were not looking at is the same bug as a
    // row you cannot click at all.
    const boxes = R.LAB_TAB_KEYS.map(k => JSON.stringify(R.labPanel(w, h, k).panel));
    check(`at ${w}x${h} the panel is one size whichever page is on it`,
      new Set(boxes).size === 1, `${R.LAB_TAB_KEYS.length} pages, ${boxes[0]}`);
  }
  check('every page has somewhere to go, and the tab strip names all of them',
    R.LAB_TABS.length === R.LAB_TAB_KEYS.length &&
    R.LAB_TABS.every(t2 => t2.name && R.labPanel(1600, 900, t2.key).rows.length > 0) &&
    R.labPanel(1600, 900, 'nonsense').tab === 'ladder',
    R.LAB_TABS.map(t2 => t2.name).join(' · ') + ' — and an unknown page falls back rather than drawing an empty box');
  const st = R.rowState(0, 'hull', 1e12);
  check('a fresh ladder offers its first rung by name and price',
    st.tier === 0 && st.next === 'hull1' && st.price === R.MODULES.hull1.price && !st.done,
    `${st.nextName} for ${st.price.toLocaleString('en-US')}`);
  let top = 0; for (const k of R.tiersOf('hull')) top = R.addMod(top, k);
  check('and a finished one says so rather than offering nothing',
    R.rowState(top, 'hull', 0).done && R.rowState(top, 'hull', 0).built === R.MODULES.hull5.name);
  check('every module a row can offer has a look, so a built station shows it',
    R.MODULE_KEYS.every(k => R.LOOKS[k]),
    `${R.MODULE_KEYS.length} modules, ${R.partsOf((1 << R.MODULE_KEYS.length) - 1).length} parts on a finished one`);
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
                               : `PASS — ${R.MODULE_KEYS.length} modules, ${R.plotsFor(MAPS[HOMES[0]].base).length} plots to a ring`}\n`);
process.exit(fails.length ? 1 : 0);
