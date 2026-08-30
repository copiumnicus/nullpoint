// What anything new should cost, pay, and be able to do.
//
// This module decides no balance number on its own. It says what the numbers
// already in the game IMPLY, so that the next alien, hull, weapon, generator,
// consumable or ammunition grade has one obvious answer instead of a hand-picked
// one. Nothing here is wired into the running game; `test/offmodel.mjs` prints
// what it says against what the shop and the bestiary actually charge, and
// `test/balance.mjs` holds the claims.
//
// The rule it exists to serve is already written down: derive balance numbers,
// do not pick them. A bounty is effective hp x effort x BOUNTY_RATE, so anything
// tougher added later pays correctly without anyone remembering. This is the
// same move applied to everything else that has a price.
//
// Read ANCHORS first. Seven numbers, five of them read straight off the cheapest
// thing on each shelf, and every other number in this file falls out of them.
// Move one and everything downstream moves with it — that is the test.

import { HULLS, resolve, FIRE_RATE, ATTRS, DEFAULT_HULL } from './ships.js';
import { EQUIPMENT, dronePrice, MAX_DRONES } from './gear.js';
import { AMMO } from './ammo.js';
import { ROCKET_RATE } from './rockets.js';
import { BOOST } from './power.js';
import { ALIENS, WILD, effectiveHp, farmHp, BOUNTY_RATE, XP_RATE } from './aliens.js';
import { MATERIALS, DROPS } from './cargo.js';
import { MAPS, HOMES, JUMP_CD } from './maps.js';
import { potFor } from './reward.js';

export { BOUNTY_RATE, XP_RATE };

// --- the ladder rungs ---------------------------------------------------------
// The shop's own tier numbers, not a copy of them. Adding a sixth emitter moves
// TIERS and every ladder that depends on it, the same way topTier() already works.
export const rung  = (slot, tier) => Object.keys(EQUIPMENT).find(k =>
  EQUIPMENT[k].slot === slot && EQUIPMENT[k].tier === tier && EQUIPMENT[k].kind !== 'rocket');
// What a module actually adds of one attribute, read off its own entry rather
// than copied into a comment here. Three of the seven anchors below divide a
// price by one of these, and a number retyped is a number that drifts: the
// A-Cell's 120 shield stopped being 120 the moment anyone touched gear.js.
export const addOf = (key, attr) =>
  (EQUIPMENT[key]?.mods ?? []).reduce((s2, [a2, op, v]) => a2 === attr && op === 'add' ? s2 + v : s2, 0);
export const TIERS = Math.max(...Object.values(EQUIPMENT).map(e => e.tier ?? 1));

// --- the reference pilot ------------------------------------------------------
// One build, and everything about time and money is measured from it: a brand new
// account that has bought the single cheapest gun in the shop and is routing power
// to weapons. 900 credits, which is what the starting balance affords.
//
// It is the anchor because the Drifter's own comment already anchors on it — "a
// starter Hauler still needs ~9s of unbroken fire". Resolved, that build throws
// 74.88 dps and takes 8.68s over the Drifter's 650 effective hp, which is where
// the ~9s comes from. Nothing here re-picks it; it is read back out of the game.
export const ANCHOR = Object.freeze({
  hull: DEFAULT_HULL,
  fit: { weapon: [rung('weapon', 1)], generator: [], tech: [] },
  drones: [],
});

// Sustained damage a build actually delivers: guns plus rack, at a grade, with
// power routed. Boost is on by default because the anchor fight is quoted with it
// — flying with the reactor idle is a choice, not the baseline.
export function dpsOf(build, { boost = 1, ammo = 'cell1', head = 'head1' } = {}) {
  const s = resolve(build.hull, build.fit, build.drones);
  const mult = 1 + (s.boost ?? BOOST) * boost;
  return s.damage * s.fireRate * (AMMO[ammo]?.mult ?? 1) * mult
       + s.rocketVolley * ROCKET_RATE * (AMMO[head]?.mult ?? 1) * mult;
}
// Shields eat the first hits and hull the rest, so what a ship can absorb is the
// sum. Same definition aliens.js uses for a hostile — deliberately, because the
// two are compared against each other constantly below.
export function ehpOf(build) {
  const s = resolve(build.hull, build.fit, build.drones);
  return s.hull + s.shield;
}
export function costOf(build) {
  let c = HULLS[build.hull]?.price ?? 0;
  for (const s of ['weapon', 'generator', 'tech'])
    for (const k of build.fit?.[s] ?? []) c += EQUIPMENT[k]?.price ?? 0;
  (build.drones ?? []).forEach((k, i) => { c += dronePrice(i) + (EQUIPMENT[k]?.price ?? 0); });
  return c;
}

export const ANCHOR_DPS   = dpsOf(ANCHOR);                       // 74.88
export const ANCHOR_EHP   = ehpOf(ANCHOR);                       // 1100
// How long the anchor pilot needs on the anchor hostile. Not chosen: it is the
// Drifter's effective hp over the anchor's dps, and it lands on the ~9s the
// Drifter's own comment claims.
export const ANCHOR_FIGHT = effectiveHp('drifter') / ANCHOR_DPS; // 8.68s

// --- ore, because a hold is paid for in ore -----------------------------------
// A hold measures volume; ore has a value and a volume per unit. What a point of
// hold is worth therefore depends on what goes in it, and there is exactly one
// drop table in the game — every alien uses the same shape at a different scale,
// which cargo.js says in as many words — so this is a property of the game rather
// than of any one hostile.
export const ORE_RATE = (() => {
  let value = 0, volume = 0;
  for (const row of DROPS.drifter) {
    const n = (row.min + row.max) / 2, m = MATERIALS[row.mat];
    value  += row.p * n * m.value;
    volume += row.p * n * m.vol;
  }
  return value / volume;                                          // 5.92 cr per unit of hold
})();

// --- the trip, because a consumable is paid for in trips ----------------------
// Distance is not a balance number anyone picked either: it is where the portals
// are. A hop is the mean distance between two portal mouths on the maps a pilot
// actually crosses getting from a home sector to the frontier, plus the jump
// cooldown at the far end.
const routeToFrontier = () => {
  const prev = { [HOMES[0]]: null }, q = [HOMES[0]];
  while (q.length) {
    const at = q.shift();
    if (MAPS[at].frontier) { const r = []; for (let m = at; m; m = prev[m]) r.unshift(m); return r; }
    for (const p of MAPS[at].portals) if (!(p.to in prev)) { prev[p.to] = at; q.push(p.to); }
  }
  return [HOMES[0]];
};
export const ROUTE = routeToFrontier();                            // m1 -> m2 -> m4
export const HOPS  = ROUTE.length - 1;                             // 2
export const CROSSING = (() => {                                   // 7554px
  let sum = 0, n = 0;
  for (const id of ROUTE) {
    const ps = MAPS[id].portals;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      sum += Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y); n++;
    }
  }
  return n ? sum / n : 0;
})();
// One-way, at the reference pilot's speed. 53.6s from the frontier to your own
// dock, which is the thing a recall beacon deletes and a repair drone halves.
export const TRIP = HOPS * (CROSSING / (HULLS[ANCHOR.hull].attrs.speed ?? ATTRS.speed.dflt) + JUMP_CD);

// --- ANCHORS ------------------------------------------------------------------
// Seven numbers. Two were already in the game; five are read off the cheapest
// rung of a shelf, because the bottom rung is what a pilot with no money buys and
// therefore the only price in the shop that is not measured against another price.
export const ANCHORS = Object.freeze({
  // What a kill pays and what it teaches, per point of work. Already derived in
  // aliens.js and re-exported rather than restated — one copy, per rule one.
  bounty: BOUNTY_RATE,                       // 0.70 cr per point of effective hp x effort
  xp:     XP_RATE,                           // 140/650, the Drifter again

  // Credits per point of capability at the bottom rung. An A-Cell is 1200 credits
  // for 120 shield, so a point of effective hp costs 10 credits at tier 1. Every
  // other price in the shop is that number times a capability times a premium.
  base: EQUIPMENT.cellA.price / addOf('cellA', 'shield'),          // 1200/120 = 10

  // How many points of effective hp one point of sustained dps is worth. NOT
  // picked: it is the rate that makes the other tier-1 rung agree with the first.
  // An MK-I Emitter is 900 credits for 18 damage, so 50 cr per point of damage
  // against the A-Cell's 10 cr per point of hp; at FIRE_RATE that is
  //   (900/18) / (1200/120) / 1.2 = 4.1667
  // points of hp per point of dps. Read as a duration it says the shop prices
  // offence and defence as equal over about four seconds — which is roughly one
  // exchange, and is the only reason a gun and a shield can be compared at all.
  trade: (EQUIPMENT.emitter1.price / addOf('emitter1', 'damage'))
       / (EQUIPMENT.cellA.price / addOf('cellA', 'shield')) / FIRE_RATE,

  // What a rung of a ladder costs you, per point, over the rung below. The
  // ammunition ladder is the one place in the game that already states its
  // premium out loud — 0.200, 0.240, 0.280 credits per point of damage, +20% of
  // the base per grade — and it is stated there precisely because getting it
  // wrong twice made two thirds of the shop decoration. Same premium everywhere,
  // so climbing is always the same kind of decision.
  premium: (AMMO.cell2.price / AMMO.cell2.pack / AMMO.cell2.mult)
         / (AMMO.cell1.price / AMMO.cell1.pack / AMMO.cell1.mult) - 1,   // 0.20

  // What fraction of your effective hit points a hostile takes off you per second
  // if you stand there and let it. The Drifter does 49.5 dps into the anchor
  // pilot's 1100, which is 4.5% a second: stand still and you are dead in 22.2
  // seconds. That is the number content DPS has to keep up with, and the one it
  // has not — see below.
  //
  // It is a RATE, not a share of the fight. A share would mean a sixty-second
  // fight was allowed to be gentler per second than a nine-second one, and the
  // whole complaint about the late game is that it already is.
  pressure: (ALIENS.drifter.attrs.damage * ALIENS.drifter.attrs.fireRate) / ANCHOR_EHP,  // 0.045/s

  // How many hold-fills a cargo module is priced at. A Scavenger Rig is 5200
  // credits for 40 units of hold, and a unit of hold carries ORE_RATE credits of
  // ore, so it pays for itself in 5200 / (40 x 5.92) = 22 full loads. That is the
  // bottom rung of the collector shelf doing the same job cellA and emitter1 do.
  payback: EQUIPMENT.collect1.price / (addOf('collect1', 'cargo') * ORE_RATE),   // 21.96 fills
});

// What a rung costs, per point, relative to the bottom one. Additive rather than
// compounding, because that is how the ammunition ladder it came from is stated:
// +20% of the base per grade, not +20% of the rung below.
export const premiumAt = (tier, A = ANCHORS) => 1 + A.premium * (Math.max(1, tier) - 1);

// --- what capability is worth -------------------------------------------------
// One point = one point of effective hit points. Everything convertible is
// converted into that, because it is the unit the game already pays bounties in.
//
// What is NOT in here matters as much as what is. See UNPRICED.
export function worthTable(A = ANCHORS) {
  return {
    hull:         1,                        // definitional: effectiveHp is hull + shield
    shield:       1,
    // A point of damage is FIRE_RATE points of dps, and a point of dps trades for
    // `trade` points of hp. 1 x 1.2 x 4.1667 = 5 points per point of damage.
    damage:       FIRE_RATE * A.trade,
    // Rockets are declared per volley and a rack cycles at ROCKET_RATE, so the
    // same conversion with the rack's own cadence. 0.55 x 4.1667 = 2.29.
    rocketVolley: ROCKET_RATE * A.trade,
    // A unit of hold carries ORE_RATE credits of ore and is bought to be filled
    // `payback` times, so it is worth ORE_RATE x payback credits — divided by the
    // base rate to land back in points. 13.0 points per unit of hold.
    cargo:        ORE_RATE * A.payback / A.base,
  };
}
export const WORTH = worthTable();

// Attributes the model deliberately refuses to price, and why. A model that
// quietly scored these at zero would report every generator as overpriced and
// look confident about it; naming them means the report can say which rows are
// incomplete and which are actually off.
export const UNPRICED = Object.freeze({
  capacitor:   'seconds of reactor. Worth boost x dps per second — but every hull ' +
               'already carries 30-60s against fights of 9-20s, so the marginal ' +
               'second buys nothing inside a fight, and the model has no term for ' +
               'what it is worth outside one.',
  recharge:    'how fast the capacitor refills. Same gap as capacitor.',
  sustain:     'the free trickle, which is the share of a system you get for nothing. ' +
               'Worth a fraction of your dps forever, so it wants the same hourly ' +
               'term capacitor does and has the same hole where it should be.',
  speed:       'buys shorter trips, which is credits per hour. The model prices ' +
               'fights and purchases, not an hourly rate, so a generator\'s speed ' +
               'cost is invisible to it.',
  accel:       'turn and close. Real, and nothing in the game states a rate for it.',
  radar:       'what you can see. Not convertible to hit points without a model of ' +
               'what being seen first is worth.',
  signature:   'how easily you are seen. The mirror of radar, same gap.',
  shieldRegen: 'hit points back between fights, so its worth depends on how often ' +
               'you get to break off — which is the same hourly-rate term speed needs.',
  shieldDelay: 'how long untouched before the shield comes back. As shieldRegen: ' +
               'it is hit points per hour of flying, not per fight, and the model ' +
               'has no hour in it.',
  weaponRange: 'reach. Kiting turns it into effective hp, at a rate nothing states.',
  fireRate:    'fixed at FIRE_RATE for every hull on purpose, so there is nothing ' +
               'to price.',
  rockets:     'the count. The damage is carried by rocketVolley; the count is a ' +
               'delivery property, and delivery is what DELIVERY_PREMIUM covers.',
});

// What a launcher charges over what its damage is worth. gear.js states the
// premium in words — "about a fifth more damage out of the same slot, for about a
// sixth more money" — and pays for three real costs the model cannot see: three
// racks to a ship however many slots the hull has, no drone may ever carry one,
// and a second or two in the air before any of it lands. Measured against this
// model the three racks charge 1.16, 1.20 and 1.19, so one number covers them.
//
// This is the seam for anything else that is deliberately dearer than its stats:
// pass it as `premium` to priceFor and say in a comment what it buys.
export const DELIVERY_PREMIUM = 1.18;

// --- pricing a module ---------------------------------------------------------
// `mods` is gear.js's own [attr, op, value] format, so a new module is scored by
// handing over the same array the shop entry already carries.
//
// A multiplier has to multiply something, and what it multiplies is the reference
// pilot's ship — stated, because a technology is worth most to whoever already
// has the most of what it scales, and pricing Composite Plating against a
// finished Bulwark instead of a starter Hauler triples it.
export function capabilityOf(mods = [], { base = resolve(ANCHOR.hull), A = ANCHORS } = {}) {
  const worth = worthTable(A);
  let points = 0;
  const missing = [];
  for (const [attr, op, v] of mods) {
    if (!(attr in worth)) { if (attr in UNPRICED) missing.push(attr); continue; }
    points += worth[attr] * (op === 'mul' ? (base[attr] ?? 0) * v : v);
  }
  return { points, unpriced: [...new Set(missing)] };
}

// The whole shop in one line: what it does, times what that is worth, times what
// the rung costs. Everything else in this file is either an input to this or a
// different currency for the same idea.
export function priceFor(mods, tier = 1, { premium = 1, base, A = ANCHORS } = {}) {
  const cap = capabilityOf(mods, { base, A });
  return { ...cap, price: Math.max(0, cap.points) * A.base * premiumAt(tier, A) * premium };
}

// A hull is scored the same way, off its bare attributes rather than a mod list —
// what the chassis is before anything is bolted to it. Slots are not scored:
// every purchasable hull carries the same seven, which ships.js says is the point,
// so they cannot be what separates the prices.
export function hullPriceFor(attrs, tier = 1, opts = {}) {
  // Every attribute, not just the priceable ones, so the row comes back saying
  // which parts of the hull the model could not read.
  const mods = Object.keys(attrs).map(k => [k, 'add', attrs[k]]);
  return priceFor(mods, tier, opts);
}

// --- pricing ammunition -------------------------------------------------------
// A grade is not a rung of the weapon ladder — ammo.js says so, having had it
// wrong in both directions. It is a small stated premium on damage you have
// already bought, so the price per POINT climbs by the ladder premium and the
// price per round is that times the multiplier.
export function ammoPriceFor(mult, tier, { pack, perPoint, A = ANCHORS } = {}) {
  const round = perPoint * premiumAt(tier, A) * mult;
  return { perRound: round, pack: round * pack };
}
// The base rate of a feed, read off its own cheapest grade: 0.200 cr per point
// for cells, 1.500 for warheads. A warhead costs more per point than a cell
// because a rocket lands and a bolt can be dodged — the same thing
// DELIVERY_PREMIUM says about the racks, in the other currency.
export const feedBase = feed => {
  const cheap = Object.keys(AMMO).filter(k => AMMO[k].for === feed)
    .sort((a, b) => AMMO[a].tier - AMMO[b].tier)[0];
  return AMMO[cheap].price / AMMO[cheap].pack / AMMO[cheap].mult;
};

// --- pricing a consumable -----------------------------------------------------
// A consumable is not capability; it is time you do not have to spend. So it is
// priced in the only currency time has: what the reference pilot would have
// earned fighting instead of flying.
//
// Which is `earnRate` — and that is worth staring at, because it is the whole
// economy in one identity. A bounty is farmHp x BOUNTY_RATE and a fight is
// farmHp / dps, so
//
//     credits per second of fight = dps x BOUNTY_RATE
//
// exactly, for every hostile, at every stage. Nothing about the alien survives
// the division. That is why bounty-per-hit-point is a misleading anchor and
// credits-per-second is the honest one — and why a consumable's fixed price is
// worth 256x less to a finished ship than to the pilot it was priced for.
export const earnRate = (build = ANCHOR, A = ANCHORS) => dpsOf(build) * A.bounty;

// A repair drone saves the flight home AND the flight back out, less the seconds
// it stands still to do it, times however much of the hull it actually puts back.
export const kitWorth = (heal, secs = 0, { build = ANCHOR, A = ANCHORS } = {}) =>
  Math.max(0, heal * (2 * TRIP - secs)) * earnRate(build, A);
// A recall beacon saves the flight home and nothing else — you were going anyway.
export const deviceWorth = (secs = 0, { build = ANCHOR, A = ANCHORS } = {}) =>
  Math.max(0, TRIP - secs) * earnRate(build, A);
export const consumablePrice = (worth, tier, A = ANCHORS) => worth * premiumAt(tier, A);

// --- build stages -------------------------------------------------------------
// The ladder a pilot actually climbs, described rather than invented: the game's
// own four hulls in price order against the equipment rungs in tier order, with
// an escort that fills at the same rate the rack climbs — MAX_DRONES spread
// evenly over the rungs above the first, so the top of the ladder is a full
// twelve and nothing in between is a number anybody picked.
//
// This is the one table here that is a reading of the game rather than an
// arithmetic consequence of it, so it is small and it is all in one place.
// Everything downstream — every dps, every effective hp, every cost — is
// resolve() and the shop, not a figure written down twice.
//
// `arrival` is a brand new account with nothing fitted; `anchor` is that account
// after its first 900 credits; `finished` is the ceiling, and costs 874,200
// credits before a collector rig.
const droneStep = t => Math.round(MAX_DRONES * (t - 1) / (TIERS - 1));
export const STAGES = Object.freeze({
  arrival:     { hull: 'hauler',   tier: 0, drones: 0,            note: 'a new account, nothing fitted' },
  anchor:      { hull: 'hauler',   tier: 1, drones: 0, anchor: true, note: 'the reference pilot: one MK-I Emitter' },
  interceptor: { hull: 'kestrel',  tier: 2, drones: droneStep(2), note: 'the first hull you buy' },
  fighter:     { hull: 'vanguard', tier: 3, drones: droneStep(3), note: 'the middle of the game' },
  cruiser:     { hull: 'bulwark',  tier: 4, drones: droneStep(4), note: 'the last hull' },
  finished:    { hull: 'bulwark',  tier: 5, drones: MAX_DRONES,   note: 'the ceiling' },
});
export const STAGE_KEYS = Object.keys(STAGES);

export function buildFor(stage) {
  const s = STAGES[stage] ?? STAGES.anchor;
  if (s.anchor) return ANCHOR;
  const h = HULLS[s.hull], fit = { weapon: [], generator: [], tech: [] };
  if (s.tier > 0) {
    for (let i = 0; i < h.slots.weapon; i++)    fit.weapon.push(rung('weapon', s.tier));
    for (let i = 0; i < h.slots.generator; i++) fit.generator.push(rung('generator', s.tier));
    const techs = Object.keys(EQUIPMENT).filter(k => EQUIPMENT[k].slot === 'tech');
    for (let i = 0; i < h.slots.tech; i++)      fit.tech.push(techs[i]);
  }
  return { hull: s.hull, fit,
           drones: Array.from({ length: s.tier > 0 ? s.drones : 0 }, () => rung('weapon', s.tier)) };
}
export const stageDps  = stage => dpsOf(buildFor(stage));
export const stageEhp  = stage => ehpOf(buildFor(stage));
export const stageCost = stage => costOf(buildFor(stage));

// --- what an alien has to be ---------------------------------------------------
// The half that stops the next hostile being trivial on arrival, and the one the
// game has actually been neglecting. Two requirements, and they are independent:
//
//   HOW LONG it lasts is its effective hp times its effort against your DPS.
//     Content has kept up here — content ehp spans 1000x against a player dps
//     span of 256x.
//
//   HOW DANGEROUS it is is its dps against your EFFECTIVE HP. Content has not
//     kept up here at all: every hostile in the game does between 50 and 195 dps
//     while player effective hp spans 6.15x, so a fight has been getting steadily
//     safer for the whole game while getting no shorter.
//
// Party size deliberately does not change the dps requirement. A hostile shoots
// one pilot at a time, so what it must throw is set by the pilot it is shooting;
// what a party changes is that the fight is n times bigger and pays n times more
// often, which is reward.js's growing pot and is meant to be a straight gain.
export function alienFor({ stage = 'anchor', seconds = ANCHOR_FIGHT, party = 1,
                           effort = 1, A = ANCHORS } = {}) {
  const dps = stageDps(stage), ehp = stageEhp(stage);
  const farm = party * dps * seconds;          // what it has to cost you to kill
  const pay  = payFor(farm, party, A);
  return {
    stage, seconds, party, effort,
    farmHp:  farm,                             // effective hp x effort
    ehp:     farm / Math.max(1e-9, effort),    // the hit points it actually needs
    dps:     A.pressure * ehp,                 // what it must throw back
    // How long YOU last standing still in front of it. Constant at every stage,
    // because pressure is a rate against your own hit points and not a share of
    // the fight — which is exactly what makes a long fight losable.
    lethal:  1 / A.pressure,
    ...pay,
  };
}

// What a kill is worth, from what it cost to kill. This is aliens.js's rule, not
// a second one — bountyFor and xpFor already do exactly this — restated here only
// so a hostile that does not exist yet can be priced before it has a key.
export function payFor(farm, party = 1, A = ANCHORS) {
  const credits = farm * A.bounty, xp = farm * A.xp;
  const pot = potFor(credits, party);
  return { credits, xp, pot, perPilot: pot / Math.max(1, party),
           xpPerPilot: potFor(xp, party) / Math.max(1, party) };
}

// The inverse, and the question to ask of any bounty already in the game: what
// fight is this number claiming to be? Falls straight out of the identity above —
// credits per second of fight is dps x BOUNTY_RATE, so seconds is the bounty over
// that. A Corsair Hive's 455,000 claims 13.5 seconds against a finished ship,
// which is not what a mothership with a five-minute respawn is meant to be.
export const claimedFight = (bounty, { stage = 'anchor', party = 1, A = ANCHORS } = {}) =>
  bounty / (A.bounty * stageDps(stage) * Math.max(1, party));

// What a hostile actually does to you at a stage, as a share of yourself per
// second. Compare against ANCHORS.pressure: below 1 and it cannot threaten you.
export const pressureOf = (kind, stage) =>
  (ALIENS[kind].attrs.damage * ALIENS[kind].attrs.fireRate) / stageEhp(stage);

// Where each hostile is met, how long the fight is meant to run, and how many
// pilots it is meant to take. This is the designer's statement of intent — it is
// not derivable, and it is the only table here that is not read off another
// number — so each row cites the thing in the game that already says it.
//
// SEAM: server.js holds the actual seeding, and the two can drift. That is a real
// risk and it is named rather than fixed, because the seeding lives in a file
// this model must not edit. A hostile with no row here is reported as unposted
// rather than skipped, so adding one cannot go quiet.
export const POSTING = Object.freeze({
  // The anchor itself. server.js: Drifters hold the home maps.
  drifter:   { stage: 'anchor',      seconds: ANCHOR_FIGHT, party: 1,
               why: 'the anchor: ~9s for a starter Hauler, as aliens.js states' },
  // server.js: "one hop out: the first thing that outclasses you".
  ironhusk:  { stage: 'interceptor', seconds: 13, party: 1,
               why: 'aliens.js: "a pilot who has moved up ... kills it in 13s"' },
  // server.js: "the other hop out: the first that needs a friend".
  leviathan: { stage: 'fighter',     seconds: 60, party: 2,
               why: 'aliens.js: a lone pilot who breaks off to survive never finishes it' },
  // server.js: "the frontier, and the first real fight".
  bandit:    { stage: 'finished',    seconds: 15, party: 1,
               why: 'aliens.js: "built to survive a finished ship for a quarter of a minute"' },
  // server.js: one on each gate sector, respawn 300s.
  hive:      { stage: 'finished',    seconds: 180, party: 4,
               why: 'a five-minute respawn and a brood of twelve: an event, not a kill' },
});

// --- the conformance report ---------------------------------------------------
// Every priced thing in the game against what this model says it should be. It
// reports; it never corrects. A ratio of 1.00 means on model, above means the
// game charges more than the model can justify, below means less.
//
// `anchor: true` marks a row the model was READ OFF, so its 1.00 is definitional
// and is not evidence of anything.
const row = (group, key, name, what, actual, model, extra = {}) => ({
  group, key, name, what, actual, model,
  ratio: model > 0 ? actual / model : null, ...extra,
});

export function report() {
  const out = [];
  const base = resolve(ANCHOR.hull);

  for (const [k, h] of Object.entries(HULLS)) {
    const m = hullPriceFor(h.attrs);
    out.push(row('hulls', k, h.name, `${h.attrs.hull}+${h.attrs.shield} ehp, ${h.attrs.damage} dmg, ${h.attrs.cargo} hold`,
      h.price, m.price, { unpriced: m.unpriced,
        note: h.price === 0 ? 'free: the hull they give you, so the ratio is meaningless' : '' }));
  }

  for (const [k, e] of Object.entries(EQUIPMENT)) {
    const launcher = e.kind === 'rocket';
    const m = priceFor(e.mods, e.tier ?? 1, { premium: launcher ? DELIVERY_PREMIUM : 1, base });
    out.push(row(e.slot === 'drone' ? 'collectors' : e.slot + 's', k, e.name,
      e.mods.map(([a, o, v]) => `${a}${o === 'mul' ? ' x' : ' '}${v}`).join(', '),
      e.price, m.price, { unpriced: m.unpriced, tier: e.tier,
        anchor: k === 'emitter1' || k === 'cellA' || k === 'collect1',
        note: launcher ? `includes DELIVERY_PREMIUM x${DELIVERY_PREMIUM}` : '' }));
  }

  for (const [k, a] of Object.entries(AMMO)) {
    const m = ammoPriceFor(a.mult, a.tier, { pack: a.pack, perPoint: feedBase(a.for) });
    out.push(row('ammunition', k, a.name, `x${a.mult}, ${a.pack} rounds`, a.price, m.pack,
      { tier: a.tier, anchor: a.tier === 1,
        note: 'the ladder ANCHORS.premium was read off, so conformance here is definitional' }));
  }

  return out;
}

// The one direction the model would ever recommend making a PLAYER smaller: a
// module that is strictly better than not having it, with nothing surrendered.
// A free multiplier is the one thing no premium can price, because there is no
// decision left to charge for — everyone fits it and it becomes part of the hull.
//
// gear.js already enforces that every technology costs something, so this should
// always come back empty. It is here so that if one ever slips in, the report
// names it rather than the model quietly pricing it like an ordinary purchase.
export const freeMultipliers = () => Object.entries(EQUIPMENT)
  .filter(([, e]) => e.mods.some(([, op]) => op === 'mul') && e.mods.every(([, , v]) => v >= 0))
  .map(([k, e]) => ({ key: k, name: e.name }));

// Kits and devices are reported separately only because they are priced in a
// different currency — saved seconds rather than capability. Same shape of row.
export function consumableReport(KITS, DEVICES) {
  const out = [];
  for (const [k, v] of Object.entries(KITS ?? {}))
    out.push(row('repair kits', k, v.name, `${Math.round(v.heal * 100)}% of hull in ${v.secs}s`,
      v.price, consumablePrice(kitWorth(v.heal, v.secs), v.tier), { tier: v.tier }));
  for (const [k, v] of Object.entries(DEVICES ?? {}))
    out.push(row('devices', k, v.name, `home in ${v.secs}s`,
      v.price, consumablePrice(deviceWorth(v.secs), v.tier), { tier: v.tier }));
  return out;
}

// The difficulty half of the report: for each posted hostile, the fight it is
// meant to be against the fight it is.
export function bestiaryReport() {
  return WILD.map(kind => {
    const p = POSTING[kind];
    if (!p) return { kind, name: ALIENS[kind].name, unposted: true };
    const want = alienFor({ ...p, effort: ALIENS[kind].effort ?? 1 });
    const have = farmHp(kind), dps = ALIENS[kind].attrs.damage * ALIENS[kind].attrs.fireRate;
    return {
      kind, name: ALIENS[kind].name, ...p,
      wantFarmHp: want.farmHp, haveFarmHp: have, hpRatio: have / want.farmHp,
      wantDps: want.dps, haveDps: dps, dpsRatio: dps / want.dps,
      actualFight: have / (p.party * stageDps(p.stage)),
      wantBounty: Math.round(want.credits), haveBounty: ALIENS[kind].bounty,
      effort: ALIENS[kind].effort ?? 1,
      // What it takes off you per second at its posting, against the 4.5% the
      // Drifter takes off a starter. Under 1 and it cannot threaten the pilot it
      // was put there for, however many hit points it has.
      pressure: pressureOf(kind, p.stage) / ANCHORS.pressure,
    };
  });
}
