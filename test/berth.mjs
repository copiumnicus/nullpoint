import { berthPrice, berthRank, berthTerms, BERTH_TRIPS, BERTH_RANK, BERTH_QUIET,
         DEEP_BERTH, DEEP_BERTH_RANK,
         whyNotBerth, whyNotBuyBerth, berthPanel } from '../shared/berth.js';
import { devicePrice } from '../shared/devices.js';
import { levelFor } from '../shared/level.js';
import { MAPS, GALAXY } from '../shared/maps.js';
import { canDock } from '../shared/sim.js';
import { sanitiseAccount } from '../shared/account.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const xpFor = lvl => { let xp = 0; while (levelFor(xp).level < lvl) xp += 250; return xp; };

console.log('\nwhat a berth costs on the frontier');
check('its price is the trip it saves you, times the trips',
  berthPrice('m4') === devicePrice('recall') * BERTH_TRIPS,
  `${berthPrice('m4')} = ${devicePrice('recall')} x ${BERTH_TRIPS} — below that a handful of beacons was cheaper`);
// This used to read "more than ten beacons", which was right while a berth was a
// convenience and wrong the moment it became the door to the upper ladder: a toll
// you cannot pay when you first want to climb is a wall, not a toll.
check('it is a real decision, not pocket change', berthPrice('m4') > devicePrice('recall') * 4,
  `${berthPrice('m4')} — several trips' worth, so a couple of beacons is genuinely the cheaper answer`);
check('and it is payable by a pilot who has just outgrown the home ring',
  berthPrice('m4') < devicePrice('recall') * 12,
  'a gate you reach before you can afford it stops being a gate and becomes a wall');
// The deeps arrived and the frontier's number had to not move with them. A price
// that drifts because somewhere else got one is how a balance pass becomes a bug.
check('and the frontier price did not move when the deeps got one',
  berthPrice('m4') === 27200 && ['m4', 'h4', 'k4'].every(id => berthPrice(id) === berthPrice('m4')),
  `${berthPrice('m4')} cr at every frontier, unchanged`);

console.log('\nand what one costs in the deeps');
{
  const { ALIENS } = await import('../shared/aliens.js');
  const { DROPS, MATERIALS, PIRATE_RATE } = await import('../shared/cargo.js');
  // What the sector pays, re-derived here rather than copied out of the comment, so
  // the price and the thing it is priced in cannot drift apart silently.
  const ore = DROPS.crucible.reduce((t, d) => t + d.p * ((d.min + d.max) / 2) * MATERIALS[d.mat].value, 0);
  const kill = ALIENS.crucible.bounty + ore * PIRATE_RATE;
  const kills = DEEP_BERTH / kill;

  check('a deep bay is ten million, and the deep sectors are the only place that is true',
    ['d1', 'd2', 'd3'].every(id => berthPrice(id) === 10_000_000) && DEEP_BERTH === 10_000_000,
    `${DEEP_BERTH.toLocaleString('en-US')} cr, against ${berthPrice('m4').toLocaleString('en-US')} on the frontier`);

  // The arithmetic that does NOT support it, named rather than quietly dropped. A
  // beacon costs the same 3,400 four hops out as it does at home, so the frontier's
  // own derivation prices a deep bay at pocket change.
  check('the trips argument cannot reach ten million and this is by how much it misses',
    devicePrice('recall') * BERTH_TRIPS < kill * 0.03,
    `eight beacons is ${(devicePrice('recall') * BERTH_TRIPS / kill * 100).toFixed(2)}% of ONE kill out here — ` +
    'a price nobody notices is not a decision');

  // And the one that does. Keep the measurement, per rule two: if the deeps' payout
  // moves far enough that ten million stops being six-to-eight kills, this says so.
  check('it is priced in what the sector pays: six to eight kills of what lives there',
    kills >= 6 && kills <= 8,
    `${kills.toFixed(2)} kills at ${Math.round(kill).toLocaleString('en-US')} cr each ` +
    `(${ALIENS.crucible.bounty.toLocaleString('en-US')} bounty + ${Math.round(ore * PIRATE_RATE).toLocaleString('en-US')} of ore at the counter)`);
  check('which is a little under two clears of the sector it stands in',
    kills / 4 > 1.4 && kills / 4 < 2.1,
    `${(kills / 4).toFixed(2)} clears — a deep sector is posted with four sowers`);
  // It is not priced against the shop, and that is the point: by four hops out the
  // shop has stopped being anybody's constraint.
  {
    const { EQUIPMENT, deepOnly } = await import('../shared/gear.js');
    const { HULLS } = await import('../shared/ships.js');
    const sum = pick => Object.entries(EQUIPMENT).filter(([k]) => pick(k))
      .reduce((t, [, e]) => t + (e.price ?? 0), 0);
    const climb = sum(k => !deepOnly(k)) + Object.values(HULLS).reduce((t, h) => t + (h.price ?? 0), 0);
    const deep = sum(deepOnly);
    // Rewritten, and the rewrite is the point rather than a threshold moving. The
    // claim was "one of everything in the game is not a fifth of this", and it stayed
    // true right up until the shop grew a shelf that is priced the same way this is.
    // So it is stated against the ORDINARY shop, which is what it always meant: the
    // ladder you climb on the way out here costs 430,200 and this bay is 23 of it.
    // The deep shelf is the exception and it is one on purpose — the gun and the door
    // are both denominated in what the sector pays, so they land within a factor of
    // two of each other, which is exactly the shape a price in kills produces.
    check('one of everything on the ordinary shop is still not a fifth of it',
      DEEP_BERTH > climb * 5,
      `${DEEP_BERTH.toLocaleString('en-US')} against ${climb.toLocaleString('en-US')} for one of every hull ` +
      `and fitting a pilot buys on the way here — x${(DEEP_BERTH / climb).toFixed(0)}`);
    check('and the deep shelf is the one thing priced in the same currency as the bay',
      deep > climb * 5 && deep > DEEP_BERTH * 0.3 && deep < DEEP_BERTH * 3,
      `${deep.toLocaleString('en-US')} for the three deep rungs against ${DEEP_BERTH.toLocaleString('en-US')} ` +
      'for the bay you must rent to be allowed to buy them — both in deep-sector kills, so both land ' +
      'within a factor of two rather than the twenty-three the rest of the shop sits at');
  }
}

console.log('\nwho they will rent to');
const askAt = (mapId, o) => whyNotBuyBerth({ mapId, inside: true, ...o });
check('not to someone who has never left home',
  /rank/.test(askAt('m4', { credits: 1e9, xp: 0 })), askAt('m4', { credits: 1e9, xp: 0 }));
check('and not to someone who cannot pay',
  /costs/.test(askAt('m4', { credits: 0, xp: xpFor(BERTH_RANK) })));
check('but yes to a pilot with both',
  askAt('m4', { credits: berthPrice('m4'), xp: xpFor(BERTH_RANK) }) === null);
check('you cannot buy one you already have',
  /already/.test(askAt('m4', { owned: true, credits: 1e9, xp: xpFor(60) })));
check('and not from across the sector', /range/.test(whyNotBuyBerth({ inside: false })));
// Rank gates, it does not scale. Standing decides where you are allowed, never
// how hard you hit — this is the whole of what levels are now allowed to do.
check('rank is a door, not a discount',
  askAt('m4', { credits: berthPrice('m4'), xp: xpFor(BERTH_RANK) }) ===
  askAt('m4', { credits: berthPrice('m4'), xp: xpFor(60) }),
  'a rank 60 pilot pays exactly what a rank 20 pilot pays');

console.log('\nand who they will rent to in the deeps');
{
  const { ALIENS } = await import('../shared/aliens.js');
  check('the deeps ask a higher rank than the frontier does',
    DEEP_BERTH_RANK > BERTH_RANK && berthRank('d1') === DEEP_BERTH_RANK && berthRank('m4') === BERTH_RANK,
    `rank ${DEEP_BERTH_RANK} out here against rank ${BERTH_RANK} on the frontier`);
  // What the number stands for, and it is a sentence somebody could disagree with:
  // one of the things that lives in a deep sector is the whole entry fee.
  check('and the rank IS one kill of what lives there',
    levelFor(ALIENS.crucible.xp).level >= DEEP_BERTH_RANK,
    `a Crucible pays ${ALIENS.crucible.xp.toLocaleString('en-US')} xp, which is rank ${levelFor(ALIENS.crucible.xp).level}`);
  // The bug this one exists to stop: a gate you can only pass by already being
  // through it is a wall. The door has to open from the gate side.
  check('the door opens from outside, so you arrive already able to rent',
    levelFor(4 * ALIENS.hive.xp).level >= DEEP_BERTH_RANK,
    `four Corsair Hives on the gates is rank ${levelFor(4 * ALIENS.hive.xp).level} — you never have to enter a deep to qualify`);
  check('a rank 39 pilot is refused at ten million minus one credit',
    /costs/.test(askAt('d1', { credits: DEEP_BERTH - 1, xp: xpFor(DEEP_BERTH_RANK) })),
    askAt('d1', { credits: DEEP_BERTH - 1, xp: xpFor(DEEP_BERTH_RANK) }));
  check('and a rank 38 pilot with ten million is refused too',
    /rank/.test(askAt('d1', { credits: 1e9, xp: xpFor(DEEP_BERTH_RANK - 1) })),
    askAt('d1', { credits: 1e9, xp: xpFor(DEEP_BERTH_RANK - 1) }));
  check('both together and they rent',
    askAt('d1', { credits: DEEP_BERTH, xp: xpFor(DEEP_BERTH_RANK) }) === null);
  // The invariant, out here too: standing decides where you are allowed, never what
  // anything costs you.
  check('rank is still a door and still not a discount',
    askAt('d1', { credits: DEEP_BERTH, xp: xpFor(DEEP_BERTH_RANK) }) ===
    askAt('d1', { credits: DEEP_BERTH, xp: xpFor(300) }),
    'a rank 300 pilot pays the same ten million');
  // The bug the whole per-outpost lookup exists to stop. A frontier pilot's money
  // must not buy a deep bay, and the refusal has to name the deep price — the panel
  // draws this string, and a panel quoting 27,200 for a ten million credit bay is
  // the workshop dock again.
  check('and a frontier bankroll does not quietly buy a deep bay',
    askAt('d1', { credits: berthPrice('m4'), xp: xpFor(300) }) !== null &&
    /10,000,000/.test(askAt('d1', { credits: berthPrice('m4'), xp: xpFor(300) })),
    askAt('d1', { credits: berthPrice('m4'), xp: xpFor(300) }));
  check('the terms come from one lookup, so the price and the rank cannot disagree',
    berthTerms('d1').price === berthPrice('d1') && berthTerms('d1').rank === berthRank('d1') &&
    berthTerms('d1').deep === true && berthTerms('m4').deep === false);
}

console.log('\nwhat it is not');
check('it is not shelter — being shot at closes it',
  whyNotBerth({ owned: true, inside: true, sinceHit: 1 }) !== null &&
  whyNotBerth({ owned: true, inside: true, sinceHit: BERTH_QUIET + 1 }) === null,
  `${BERTH_QUIET}s clear before the bay opens`);
check('it is not a dock: no outpost is one, berth or no berth',
  GALAXY.filter(id => MAPS[id].outpost).every(id => {
    const o = MAPS[id].outpost;
    return !canDock(MAPS[id], MAPS[id].owner, { x: o.x, y: o.y });
  }), 'a berth is a counter, not a ring — it never repairs and never hides you');
check('and having one somewhere is not having one everywhere',
  whyNotBerth({ owned: false, inside: true }) !== null,
  'bought per outpost, so a pilot on one frontier does not pay for three');

// --- and what the peace in a deep sector is, exactly ---------------------------
//
// The worry that shaped this whole placement: the deeps hold the two hardest things
// in the game, and a ring you cannot be touched in is a free way out of the hardest
// fight there is. Two facts settle it and both are asserted rather than asserted at.
//
// One: the ring HAS to keep the peace, because a bay is somewhere a wreck comes
// back to and ground outlives its sower by 36 seconds. Respawning with no peace at
// the door, into a pool that is still burning where you died, is a death loop with
// a fuse on it — which is the exact bug the frontier's peace was added to end.
//
// Two: the peace has never covered a pilot who shot first. mayHarm() is the rule and
// it is one line — anything you provoked follows you in and keeps firing — and a
// patch of ground carries its sower's grudge BY REFERENCE so that survives the
// sower's death. So the free escape is available to everyone except the people in
// the fight.
console.log('\nwhat the peace in the deeps covers');
{
  const { inHaven, inOutpost, canDock } = await import('../shared/sim.js');
  const { mayHarm } = await import('../shared/aliens.js');
  const o = MAPS.d1.outpost, mid = { x: o.x, y: o.y };
  const outside = { x: o.x + o.r + 1, y: o.y };

  check('a deep outpost keeps the peace at its own door, because you respawn there',
    inHaven(MAPS.d1, mid) && inOutpost(MAPS.d1, mid),
    'ground outlives the thing that sowed it by 36s — a respawn into a live pool is a loop with no way out');
  check('and the peace stops dead at the trading zone',
    !inHaven(MAPS.d1, outside), `${o.r}px and not a pixel past it`);
  check('it never mends you: a deep outpost is not a dock',
    !canDock(MAPS.d1, MAPS.d1.owner, mid) && !canDock(MAPS.d1, 'm', mid),
    'no repairs out here, whoever you fly for');

  // The claim the whole worry reduces to, and it is the one somebody could
  // disagree with: an outpost is not a way out of a fight you started.
  const me = 7;
  check('but it is NO refuge from a fight you started',
    mayHarm({ provoked: new Set([me]) }, { id: me, ship: {}, haven: true }) === true,
    'you shot it, so it follows you into the ring and keeps shooting — sanctuary stops a fight starting, not one already on you');
  check('while a pilot who never touched it is left alone inside',
    mayHarm({ provoked: new Set() }, { id: me, ship: {}, haven: true }) === false,
    'which is what makes a respawn survivable');
  check('and outside the ring nothing is protected from anything',
    mayHarm({ provoked: new Set() }, { id: me, ship: {}, haven: false }) === true);

  // Ground reads the same rule, through the same function, off the sower's own
  // provoked set carried by reference — see groundFor() in shared/ground.js. This is
  // the assertion that the pool you were already fighting in does not stop burning
  // because you crossed a line.
  const { groundFor } = await import('../shared/ground.js');
  const sower = { def: { sow: { kind: 'regia', r: 165, rate: 0.1423, hold: 0, life: 36 } },
                  provoked: new Set([me]) };
  const patch = groundFor(sower, { x: o.x, y: o.y });
  check('and ground you provoked still burns you inside the ring',
    mayHarm({ provoked: patch.by }, { id: me, haven: true }) === true,
    'the patch holds its sower\'s grudge by reference, so it outlives the sower without forgetting');

  // And the other half: it cannot be made a fortress either. Ground is laid where
  // its victim was STANDING and nobody may be sown on inside a haven, so the closest
  // any patch can ever be centred is the rim — which bounds how much of the trading
  // zone a hostile can take away, at every radius the bestiary has.
  const { ALIENS } = await import('../shared/aliens.js');
  const lens = (r1, r2, d) => d >= r1 + r2 ? 0 : d <= Math.abs(r1 - r2) ? Math.PI * Math.min(r1, r2) ** 2
    : r1*r1*Math.acos((d*d + r1*r1 - r2*r2)/(2*d*r1)) + r2*r2*Math.acos((d*d + r2*r2 - r1*r1)/(2*d*r2))
      - 0.5*Math.sqrt((-d + r1 + r2)*(d + r1 - r2)*(d - r1 + r2)*(d + r1 + r2));
  const sowers = Object.entries(ALIENS).filter(([, a]) => a.sow);
  const worst = Math.max(...sowers.map(([, a]) => lens(o.r, a.sow.r, o.r) / (Math.PI * o.r * o.r)));
  check('and no patch of ground can ever cover the trading zone',
    worst < 0.5,
    `the worst any sower can take is ${(worst * 100).toFixed(0)}% of the ring — ` +
    sowers.map(([k, a]) => `${k} r${a.sow.r} -> ${(lens(o.r, a.sow.r, o.r) / (Math.PI * o.r * o.r) * 100).toFixed(0)}%`).join(', ') +
    ' — because it is laid where you were standing, and nobody is sown on inside a haven');
}

console.log('\nkeeping it');
check('a berth survives a save and a load', (() => {
  const a = sanitiseAccount({ token: 't', co: 'm', berths: ['m4'] }, 1, Date.now());
  return a.berths.length === 1 && a.berths[0] === 'm4';
})());
check('and a hand-edited save cannot invent one where no outpost is', (() => {
  const a = sanitiseAccount({ token: 't', co: 'm', berths: ['m1', 'nonsense', 'm4', 'm4'] }, 1, Date.now());
  return a.berths.length === 1 && a.berths[0] === 'm4';
})(), 'm1 has no outpost, junk dropped, duplicates merged');

console.log('\nwhat the frontier stocks');
{
  const { EQUIPMENT, frontierOnly, whyNotSold, FRONTIER } = await import('../shared/gear.js');
  const laser = k => EQUIPMENT[k].slot === 'weapon' && EQUIPMENT[k].kind !== 'rocket';
  check('your own company stops selling emitters at the third rung',
    !frontierOnly('emitter2') && frontierOnly('emitter3') && frontierOnly('emitter5'),
    `emitters go frontier at tier ${FRONTIER.laser}`);
  check('and launchers at the second',
    !frontierOnly('pod1') && frontierOnly('pod2') && frontierOnly('pod3'));
  check('the bottom of every ladder is still sold at home',
    ['emitter1', 'pod1', 'cellA', 'plating'].every(k => !frontierOnly(k)),
    'you are issued a starter kit, not abandoned');
  check('frontier stock is refused at your own ring, however docked you are',
    /frontier/.test(whyNotSold('emitter5', { docked: true })),
    whyNotSold('emitter5', { docked: true }));
  check('and sold at a bay you rent', whyNotSold('emitter5', { berth: true }) === null);
  check('ordinary stock is sold at either', whyNotSold('emitter1', { docked: true }) === null &&
    whyNotSold('emitter1', { berth: true }) === null);
  check('and nowhere at all in open space',
    whyNotSold('emitter1', {}) !== null && whyNotSold('emitter5', {}) !== null);
  // The berth stopped being a convenience the moment it gated the ladder, so its
  // price had to stop being a convenience price.
  check('the toll is payable when you first want to climb',
    berthPrice('m4') < EQUIPMENT.emitter3.price * 4,
    `${berthPrice('m4')} against an MK-III at ${EQUIPMENT.emitter3.price} — the first thing it unlocks`);
  check('every technology is on a rung now',
    Object.values(EQUIPMENT).filter(e => e.slot === 'tech').every(e => e.tier > 0),
    'four things at one rung was a shelf with nothing to climb');
}

// --- and what the DEEPS stock, which is the same rule one level further out ----
//
// A ladder leaves the company ring at one rung and leaves the frontier at another.
// Both sentences are "this is stocked further out than you are standing", so a
// ladder is a list of cut points rather than a special case, and a third kind of
// outpost would be a third number in a row. STOCKED is that list.
{
  const { STOCKED, SHELVES, shelfOf, deepOnly, whyNotSold, EQUIPMENT } = await import('../shared/gear.js');
  const { MAPS } = await import('../shared/maps.js');
  check('the shelves are a list of cut points, so a ladder that never reaches the deeps just has fewer',
    SHELVES.join() === 'station,frontier,deep' &&
    STOCKED.laser.length === 2 && STOCKED.rocket.length === 2 && STOCKED.tech.length === 1,
    Object.entries(STOCKED).map(([k, v]) => `${k} ${v.join('/')}`).join(', ') +
    ' — technology has no deep rung, and that is a missing number rather than a missing branch');
  check('the sixth emitter and the fourth launcher are deep stock, and nothing below them is',
    deepOnly('emitter6') && deepOnly('pod4') && deepOnly('cellF') &&
    !deepOnly('emitter5') && !deepOnly('pod3') && !deepOnly('cellE'),
    Object.keys(EQUIPMENT).filter(deepOnly).map(k => EQUIPMENT[k].name).join(', '));
  check('deep stock is refused at a frontier bay, and the refusal says which bay it wants',
    /deep-sector/.test(whyNotSold('emitter6', { berth: true })) &&
    whyNotSold('emitter6', { berth: true, deep: true }) === null,
    whyNotSold('emitter6', { berth: true }));
  check('and refused at your own ring too, however docked you are',
    whyNotSold('emitter6', { docked: true }) !== null && whyNotSold('emitter6', {}) !== null,
    'the whole ladder above the frontier cut comes off a hulk, and the top of it off a deep one');
  // The gate, and it is a gate rather than a multiplier: the price and the rank are
  // the door, and a pilot who is through it flies the same ship as anybody else who
  // is. berthTerms already holds both, so this only has to check the door exists.
  const deepMaps = Object.keys(MAPS).filter(m => MAPS[m].deep);
  check('and there is somewhere to buy it: every deep sector has an outpost with a bay for sale',
    deepMaps.length > 0 && deepMaps.every(m => MAPS[m].outpost && berthPrice(m) === DEEP_BERTH),
    `${deepMaps.length} deep sectors at ${DEEP_BERTH.toLocaleString('en-US')} cr and rank ` +
    `${berthRank(deepMaps[0])} — the gun and the door cost about the same, and both are priced in ` +
    'deep-sector kills rather than against the shop');
}

console.log('\nwhere a wreck comes back');
{
  const { respawnAt, isHangar } = await import('../shared/berth.js');
  const { MAPS } = await import('../shared/maps.js');
  const where = a => respawnAt(a, MAPS);
  check('a pilot who has docked nowhere comes back to their own ring',
    where({ co: 'm' }).map === 'm1');
  check('and one who last used a bay they rent comes back to the bay',
    where({ co: 'm', lastDock: 'm4', berths: ['m4'] }).map === 'm4',
    'four sectors of flying home, every death, was the least interesting minute in the game');
  check('including a bay four hops out in the deeps',
    where({ co: 'm', lastDock: 'd1', berths: ['d1'] }).map === 'd1' &&
    where({ co: 'm', lastDock: 'd1', berths: ['d1'] }).kind === 'bay',
    'the deeps had nowhere at all to come back to, so every death was a flight from your home ring');
  // Everything about the last hangar is re-checked rather than trusted: a berth
  // can be sold, a save can be hand-edited, a sector can stop having an outpost.
  check('a bay you have since sold does not hold your respawn',
    where({ co: 'm', lastDock: 'm4', berths: [] }).map === 'm1');
  check('nor does a rival company ring',
    where({ co: 'm', lastDock: 'h1' }).map === 'm1');
  check('nor a sector with no hangar in it at all',
    where({ co: 'm', lastDock: 'g1' }).map === 'm1');
  check('and hand-edited nonsense falls back rather than throwing',
    where({ co: 'm', lastDock: 'nowhere', berths: ['nowhere'] }).map === 'm1');

  // The recorded hangar and the shop counter answer the same question, so you can
  // never respawn somewhere you could not have shopped.
  const at = (mapId, x, y, berths) =>
    isHangar(mapId, MAPS[mapId], 'm', { x, y }, berths);
  const b = MAPS.m1.base, o = MAPS.m4.outpost;
  check('standing in your own ring counts as a hangar', at('m1', b.x, b.y, []));
  check('standing in a bay you rent counts too', at('m4', o.x, o.y, ['m4']));
  check('standing in an outpost you have no bay at does not',
    !at('m4', o.x, o.y, []), 'you could not have shopped there, so you cannot come back there');
  check('and neither does open space', !at('m1', 100, 100, []));
}

console.log('\nthe panel that sells it');
{
  const L = berthPanel(1600, 900);
  check('it sits on screen with its button inside it',
    L.panel.x > 0 && L.panel.y > 0 && L.panel.y + L.panel.h < 900 &&
    L.buy.y > L.panel.y && L.buy.y + L.buy.h <= L.panel.y + L.panel.h);
  const S = berthPanel(420, 320);
  check('and gives ground on a small window rather than running off it',
    S.panel.x >= 0 && S.panel.x + S.panel.w <= 420);
}

// --- where a beacon puts you down --------------------------------------------
//
// It always went to your company ring, which was right while the ring was the only
// place you could dock and useless the moment it was not: a pilot working a
// frontier they rent a bay on was paying 3400 credits to be sent four sectors from
// where they wanted to be.
{
  const { homePorts, foldTo, respawnAt } = await import('../shared/berth.js');
  const { MAPS } = await import('../shared/maps.js');
  const bare  = { co: 'm' };
  const renting = { co: 'm', berths: ['m4'] };

  check('a pilot who rents nothing has exactly their own ring to fold to',
    homePorts(bare, MAPS).length === 1 && homePorts(bare, MAPS)[0].map === 'm1',
    homePorts(bare, MAPS).map(h => h.name).join(', '));
  check('and a rented bay is a second one, named and placed',
    homePorts(renting, MAPS).some(h => h.map === 'm4' && h.kind === 'bay' && h.x > 0 && h.name),
    homePorts(renting, MAPS).map(h => `${h.name} (${h.kind})`).join(' | '));
  check('a company dock and a rented bay are not the same offer',
    homePorts(renting, MAPS).find(h => h.map === 'm1').kind === 'dock' &&
    homePorts(renting, MAPS).find(h => h.map === 'm4').kind === 'bay',
    'the bay does not repair you, and the menu says so');
  check('folding goes where you asked', foldTo(renting, MAPS, 'm4').map === 'm4');
  check('and to a sector you do not rent, it goes home instead',
    foldTo(renting, MAPS, 'm3').map === 'm1' && foldTo(bare, MAPS, 'm4').map === 'm1',
    'a berth can be sold and a save can be edited, so it is re-checked at the moment of use');
  check('a pilot who never chose still folds somewhere real',
    foldTo(bare, MAPS, null).map === 'm1' && foldTo(bare, MAPS, undefined).x > 0);
  check('every company gets the same deal, not just the first one',
    ['m', 'v', 'x'].filter(co => MAPS[co + '1']).every(co => foldTo({ co }, MAPS, null).map === co + '1'),
    'the fallback is derived from your company, not hardcoded to one ring');
  // The bug this whole block exists for, and it was live for six versions.
  //
  // A pilot who died at a rented bay came back in the top-left corner of the map,
  // unable to move, and dying again put them straight back there. The respawn
  // scatters you inside the ring — `Math.random() * at.r * 0.6` — and when this
  // became one shared list the radius was dropped from it. `Math.random() *
  // undefined` is NaN; a NaN position never moves, never renders anywhere real,
  // and cannot be escaped from inside the game.
  //
  // Every assertion here checked `.map` and not one of them checked where in it, so
  // the whole suite was green while respawning was broken for everybody — the home
  // dock too, not just a berth.
  for (const acct of [{ co: 'h', berths: ['h4'], lastDock: 'h4' },
                      // The deeps are the newest port record and therefore the most
                      // likely to be missing an `r` — this is the exact shape of the
                      // bug that stranded people, so it is checked the same way.
                      { co: 'm', berths: ['d1'], lastDock: 'd1' },
                      { co: 'k', berths: ['d3'], lastDock: 'd3' },
                      { co: 'h' }, { co: 'm', lastDock: 'm1' }, { co: 'k', lastDock: 'nonsense' }]) {
    const at = respawnAt(acct, MAPS);
    const ang = 1.1, dist = 0.9 * at.r * 0.6;          // what server.js does
    const x = at.x + Math.cos(ang) * dist, y = at.y + Math.sin(ang) * dist;
    check(`a pilot coming back at ${at.map} lands somewhere real`,
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(at.r) && at.r > 0,
      `${at.kind} r=${at.r} -> ${Math.round(x)},${Math.round(y)}`);
    check('and inside the ring they came back to, not beside it',
      Math.hypot(x - at.x, y - at.y) <= at.r,
      `${Math.round(Math.hypot(x - at.x, y - at.y))}px of ${at.r}`);
  }

  // Respawn is the same question, so it is now literally the same function.
  check('and a wreck comes back through the very same list',
    respawnAt({ ...renting, lastDock: 'm4' }, MAPS).map === 'm4' &&
    respawnAt({ ...renting, lastDock: 'm3' }, MAPS).map === 'm1',
    'two copies of "which hangars are mine" disagreed once already');
}

// Folding from one hangar to another.
//
// The beacon refused while you were "at a dock", which was right for exactly as
// long as it had one destination — it always went home, so being home meant there
// was nothing to do. Once it asks WHICH hangar, that rule tells a pilot standing at
// their own ring that they cannot reach the bay they rent four sectors out, and the
// workaround was to fly out of your own ring in order to be allowed to leave it.
{
  const { whyNotDevice } = await import('../shared/devices.js');
  const kit = { devices: { recall: 2 }, using: 'recall' };
  check('you may fold out of a hangar, so long as it is not the one you are going to',
    whyNotDevice({ ...kit, atDest: false }) === null,
    'standing at your ring, folding to a rented bay — this used to be refused');
  check('and folding to where you already stand is still refused',
    /already standing there/.test(whyNotDevice({ ...kit, atDest: true }) ?? ''),
    whyNotDevice({ ...kit, atDest: true }));
  check('a fold already running still blocks a second one',
    /already running/.test(whyNotDevice({ ...kit, busy: true }) ?? ''));
  check('and no beacon aboard is still no beacon aboard',
    /no Recall Beacon aboard/.test(whyNotDevice({ devices: {}, using: 'recall' }) ?? ''));
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — a berth is ${berthPrice('m4').toLocaleString('en-US')} cr on the frontier, `
  + `${berthPrice('d1').toLocaleString('en-US')} cr in the deeps`}\n`);
process.exit(fails.length ? 1 : 0);
