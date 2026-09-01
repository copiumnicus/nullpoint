// Ammunition.
//
// Guns and racks are the thing you own; ammunition is the thing you spend. A
// weapon with an empty magazine does not fire at all, which is what makes
// stopping at a dock before a long trip a decision rather than a formality.
//
// Two rules keep it from being tedious. There is no carry limit — a hold full of
// bullets you cannot use is a chore, not a mechanic — and the standard grades are
// cheap enough that nobody counts them. What you actually choose is whether to
// burn the expensive stuff, which hits harder and costs real money to feed.

// The two dials Drumfire is built out of. They are here because the long-reach
// grade's damage penalty is SOLVED off them rather than picked — see REACH_EDGE
// below — so retuning the ability retunes the round, and the two cannot end up
// charging different prices for the same metre of reach.
import { DRUMFIRE_GAIN, DRUMFIRE_REACH } from './ability.js';

// What a round costs per point of damage it delivers. This is the number that
// matters, because fire rate is fixed: a grade's multiplier IS your dps, so the
// only question a pilot has is whether the extra damage is worth the extra money.
//
// It has been wrong twice, in opposite directions.
//
// First a Charged Cell was 1.25x the damage for 8x the price per round — 6.4x the
// cost per point — so nothing above the plain grade was ever worth loading. That
// was fixed by making the grades x1/x3/x5, which overcorrected badly: a x5 round
// costs 0.2% of the bounty it earns, so nothing BELOW the top grade was ever
// worth loading either, and the shop was decoration again with the shelves
// swapped. Measured, a Corsair Hive cost 1011 credits of ammunition against a
// 455000 credit bounty.
//
// The mistake both times was treating a grade as a tier of the weapon ladder.
// Damage tiers live in the emitters, which cost real money and take a slot. A
// grade is a small, stated premium on top of whatever you have already bought:
//
//   Standard  x1.00  0.20 cr/round  0.200 per point
//   Charged   x1.25  0.30 cr/round  0.240 per point  (+20%)
//   Fusion    x1.50  0.42 cr/round  0.280 per point  (+40%)
//   Collimated x1.22 at TWICE the reach  0.78 cr/round  0.320 per point  (+60%)
//
// The crate is the same size at every grade now. It used to shrink as the grade
// climbed, which meant the better ammunition had the smaller price on the shelf —
// true per round and nonsense to read. Warheads run the same ladder at their own
// base.
//
// "Per point" means per point of what the round CARRIES, which is damage times
// reach. It was per point of damage while every round in the game reached exactly
// as far as the gun did, and those are the same number when reach is 1. They stop
// being the same number the moment a round buys distance instead of heat — and
// reading the ladder off damage alone would price the long round as though the
// distance were free, which is the mistake the whole shelf was rebuilt to avoid.
// One colour per grade, so the bar, the chooser and the round itself in flight
// cannot disagree about what is loaded. Telling grades apart by counting pips in
// the HUD was no help at all in the middle of a fight.
// What you must already own to buy a grade.
//
// Every grade was on the shelf from the first minute, so the ladder was a ladder
// you could skip: a new pilot with 840 credits bought the best cells in the game
// and the two rungs below them never existed.
//
// Rank would gate it, and rank is now allowed to — but it is the wrong gate HERE.
// Experience is earned by killing anything at all, so a rank gate on ammunition is
// cleared by grinding the easiest content in the game, which is the opposite of
// what it should ask. A grade is gated on the gun that fires it. A round is calibrated for a rack;
// the racks are the thing you actually pay for, and they are already a ladder. It
// also reads without a manual: you cannot buy Fusion Cells because you have
// nothing that could fire one.
//
// Three grades across five emitter rungs was the two ends and the middle. There
// are six rungs and four launcher rungs now, and the fourth grade is calibrated
// for the top of both: every emitter an MK-VI, or every rack a Cyclone.
//
// The gate is the SAME RULE, not a new one. whyNotLoad already asks for the worst
// gun on the ship rather than the best, so "fully specced" means what it has always
// meant — and the fourth grade simply asks it of a rung that is only sold four hops
// out, at a bay that costs ten million. Nothing here knows that; it only knows a
// tier number, which is what keeps this one rule rather than two.
export const NEEDS = { cell1: 1, cell2: 3, cell3: 5, cell4: 6,
                       head1: 1, head2: 2, head3: 3, head4: 4 };

// Purple for the fourth grade, both feeds, because a purple bolt and a purple
// rocket have to mean the same thing to somebody watching a fight from outside it.
export const GRADE_COLOUR = { 1: '#c2a24f', 2: '#e05a5a', 3: '#7de08a', 4: '#b07cff' };
export const gradeColour = tier => GRADE_COLOUR[tier] ?? GRADE_COLOUR[1];

// --- the long round, and what it gives up ------------------------------------
//
// A grade that buys DISTANCE instead of heat: twice the reach of whatever gun
// fires it, at less damage than the grade it shadows. It is the FOURTH RUNG of the
// ammunition ladder and a SIDEGRADE of the third at the same time, and both halves
// of that matter. It is a rung because it is gated on the sixth emitter and the
// fourth launcher, priced at the ladder's fourth premium, and drawn in its own
// colour; it is a sidegrade because what the rung buys is not more heat — heat
// topped out at Fusion — so both numbers below are measured against the hottest
// round rather than against the plain one.
//
// That is deliberate and it is the anti-pay-to-win rule doing its work in the one
// place a shop can be bought past: the dearest ammunition in the game, behind the
// dearest gun in the game, behind a ten-million bay, is NOT simply the strongest
// ammunition in the game. It hits softer than the crate one shelf down.
//
// THE PRICE OF REACH IS ALREADY IN THE GAME, and it is stated exactly once. The
// Drum Governor trades a Vanguard's cadence for its reach and holds the product
// constant: x2.50 of your cycle at 455px against x1.90 at 602px, which is 1137
// and 1144 of rate-times-range — the same number to 0.6%, and test/tech.mjs
// asserts it inside 2%. So the game's own exchange rate for doubling your reach
// is HALF YOUR OUTPUT, and the conserved answer here is x0.75.
//
// That answer is rejected, and the reason is written down one file away. It is
// exactly what Drumfire was before it shipped: the gain used to BE the cost, read
// back through 1/(1 - 0.35), so a full drum threw precisely the damage per metre
// a cold ship did. Measured, that was worth 3.8% more damage than routing the
// same reactor to the guns — an ability nobody would ever switch on. Conservation
// means the sidegrade is never a gain, only a reshaping, and a grade that is never
// worth loading is a grade that does not exist.
//
// So it is priced at the margin Drumfire itself was solved to, which is a number
// the game already carries rather than one picked here:
//
//     REACH_EDGE = (1 + DRUMFIRE_GAIN) x (1 - DRUMFIRE_REACH)
//                = 2.50 x 0.65 = 1.625
//
// — how far past conservation the shipped ability sits, in the one currency the
// game has for reach. A full drum's output-times-reach is 1.625 of a cold ship's;
// so is this round's, against the round it shadows. One rate for reach everywhere,
// and if the ability is ever retuned this moves with it.
//
//     mult = 1.50 x 1.625 / 2 = 1.21875
//
// Four fifths of the hottest round, at twice the distance. MEASURED, through the
// real fire()/launch()/stepAlienAI loop, a finished pilot kiting at 0.92 of reach:
//
//     hostile       Fusion             Collimated
//     Kedge         9.5s, 3269 taken   12.2s, 0 taken
//     Leviathan    21.7s, 2550 taken   27.3s, 0 taken
//     Corsair Hive 41.5s, 4620 taken   51.4s, 0 taken
//     Ironhusk     11.3s,    0 taken   14.7s, 0 taken
//     Lamprey       7.5s,    0 taken   10.1s, 0 taken
//
// which is the shape the design asked for: against the four things in the game
// that reach 900px or better it turns half your ship into a quarter more time,
// and against everything you already out-range it is a quarter more time for
// nothing at all. Load it for the frontier; do not load it to farm.

// --- what a warhead costs, and why it went up sevenfold ------------------------
//
// A warhead arms ONE ROCKET. It always did — but a rocket used to be a SEVENTH of
// what a Cyclone Rack put in the air, and it is now the whole of it. Same damage
// leaving the rails, a seventh of the rounds spent doing it, so at the old 1.500 cr
// a round the endgame ammunition bill fell by 7x the day the racks were reworked.
//
// Measured, because this shelf has been wrong in both directions before and the
// comment at the top of the file names both. Rocket ammunition as a share of the
// bounty on the thing it is fired at is scale-free — a bounty is farmHp x
// BOUNTY_RATE, so it is the same number for a Drifter and for a Crucible:
//
//     before the rework   0.631% of the bounty      a 159-fold return
//     after it, unpriced  0.090% of the bounty    a 1,110-fold return
//
// A thousandfold return is exactly the shape the x1/x3/x5 experiment was reverted
// for — "a x5 round costs 0.2% of the bounty it earns, so nothing BELOW the top
// grade was ever worth loading either".
//
// So the per-round number follows the rocket, and the factor is not chosen: the
// rung this shelf calibrates on is the Cyclone Rack — it is what the fourth grade
// is gated on, NEEDS.head4 — and that rung went from 261.4 points a rocket to
// 1,830, which is RAILS = 7 exactly. The base goes up by the same 7:
//
//     HEAD_BASE = 1.500 x 7 = 10.500 cr a warhead
//
// A Cyclone volley therefore costs 10.50 cr for 1,830 points, to the penny what it
// cost before the rework, and the four grades keep the ladder's own shape on top of
// it — x1.00 / x1.20 / x1.40 / x1.60 per point of what the round carries.
//
// WHAT THIS DOES TO THE LOWER RUNGS, because it is not nothing. A Sparrow Pod's
// rocket did not get bigger — it was always one rocket — so it now pays a Cyclone's
// warhead for a Sparrow's warhead of damage. Cost per point of damage across the
// ladder, which is the number test/ammo.mjs pins:
//
//     Sparrow 0.0875   Shrike 0.0182   Osprey 0.0100   Cyclone 0.0057 cr a point
//
// — monotonically down, the same direction it ran before (0.0125 to 0.0057) and a
// steeper slope, because the rungs' rockets themselves got steeper. Climbing the
// rack ladder still makes every point of damage cheaper to deliver, which is the
// property that matters.
//
// And in a real fight rather than in the abstract. Twelve Drifters each, through
// the actual fire()/launch()/stepAlienAI loop, ammunition as a share of the bounty:
//
//     Hauler + 1 Sparrow      1.52%  ->  8.94%     (66x back becomes 11x)
//     Kestrel + 2 Shrike      2.06%  ->  5.09%
//     Bulwark + 3 Osprey      5.03%  ->  7.01%
//     Vanguard + 5 Cyclone   11.62%  -> 11.62%     635 cr either way, to the credit
//
// The rung the shelf calibrates on does not move at all, which is what this reprice
// was for. The Vanguard is the dearest row on that table both before and after for
// a reason that has nothing to do with price: a 9,150 volley on a 650-hit-point
// husk is mostly wasted, which is the "do not load it to farm" shape the long grade
// already talks about six paragraphs up.
//
// THE ALTERNATIVE, MEASURED AND NOT BUILT. A flat per-round price cannot hold the
// cost per point level across a ladder whose rockets now span 15x, and the thing
// that would is a warhead being a UNIT OF CHARGE that a big rocket spends several
// of — 1/5/9/15 of them at 120 points each, which lands every rung within 6% of
// 0.0128 and makes the endgame bill 2.15x what it was. It is not built because it
// is a second rule about consumption sitting next to the one rule about price, and
// because the brief for this pass was to hold the endgame volley's cost where it
// already was rather than to raise it. The numbers are here so it is a decision
// rather than an oversight.
export const HEAD_BASE = 10.5;    // cr a warhead at x1.00, before the grade premium

export const REACH_MULT = 2;                                        // how much further it throws
export const REACH_EDGE = (1 + DRUMFIRE_GAIN) * (1 - DRUMFIRE_REACH);   // 1.625
const TOP_MULT   = 1.50;                                            // the hottest round on the ladder
const REACH_DMG  = TOP_MULT * REACH_EDGE / REACH_MULT;              // 1.21875

export const AMMO = {
  // For emitters. Consumed one round per bolt, so a big rack eats them fast.
  // `reach` is what the round multiplies the FIRING SHIP'S weapon range by, and it
  // is 1 for everything that is not the long grade — so rangeOf() reads it off the
  // magazine exactly the way fire() already reads `mult`, and a weapon with nothing
  // loaded reaches exactly as far as it always did.
  cell1: { name: 'Standard Cells', for: 'laser', tier: 1, mult: 1.00, reach: 1, pack: 2000, price:  400,
           colour: GRADE_COLOUR[1],
           blurb: 'The standard round. Every emitter fires it.' },
  cell2: { name: 'Charged Cells',  for: 'laser', tier: 2, mult: 1.25, reach: 1, pack: 2000, price:  600,
           colour: GRADE_COLOUR[2],
           blurb: 'Hotter cells. 20% dearer per point of damage.' },
  cell3: { name: 'Fusion Cells',   for: 'laser', tier: 3, mult: TOP_MULT, reach: 1, pack: 2000, price:  840,
           colour: GRADE_COLOUR[3],
           blurb: 'The hottest cell made. 40% dearer per point.' },
  // 0.200 cr/point x premiumAt(4) 1.60 x what it carries 2.4375 x 2000 = 1560.
  cell4: { name: 'Collimated Cells', for: 'laser', tier: 4, mult: REACH_DMG, reach: REACH_MULT,
           pack: 2000, price: 1560, colour: GRADE_COLOUR[4],
           blurb: 'Twice the reach, at four fifths of the punch.' },

  // For launchers. ONE WARHEAD PER ROCKET, and a rack throws one rocket — so a
  // warhead is a volley's worth from one rail, whatever rung the rail is.
  head1: { name: 'Standard Warheads', for: 'rocket', tier: 1, mult: 1.00, reach: 1, pack: 400, price: 4200,
           colour: GRADE_COLOUR[1],
           blurb: 'A mass-produced shaped charge. Any rack fires it.' },
  head2: { name: 'Tandem Warheads',   for: 'rocket', tier: 2, mult: 1.25, reach: 1, pack: 400, price: 6300,
           colour: GRADE_COLOUR[2],
           blurb: 'Two stages, to beat shielding. 20% dearer per point.' },
  head3: { name: 'Antimatter Heads',  for: 'rocket', tier: 3, mult: TOP_MULT, reach: 1, pack: 400, price: 8820,
           colour: GRADE_COLOUR[3],
           blurb: 'Unstable, and it lands hard. 40% dearer per point.' },
  // A sustainer is the second-stage motor that keeps a missile flying once the
  // boost is spent, and it is paid for in warhead: the charge comes out to make
  // room for it. HEAD_BASE 10.500 cr x 1.60 x 2.4375 x 400 = 16380.
  head4: { name: 'Sustainer Heads',   for: 'rocket', tier: 4, mult: REACH_DMG, reach: REACH_MULT,
           pack: 400, price: 16380, colour: GRADE_COLOUR[4],
           blurb: 'A bigger motor, a smaller charge. Twice the reach.' },
};

// How far a weapon fed this grade reaches, as a multiple of the ship's own reach.
// One lookup, because the client's OUT OF RANGE label and the server's fire()
// gate have to be the same number — a client that says out of range while the
// server is happily shooting is the workshop-dock bug with the sides swapped.
export const gradeReach = key => AMMO[key]?.reach ?? 1;

export const AMMO_KEYS = Object.keys(AMMO);
export const FEEDS = ['laser', 'rocket'];
export const forWeapon = feed => AMMO_KEYS.filter(k => AMMO[k].for === feed);

// The cheap grade of each kind, which is what a new pilot flies with and what a
// selection falls back to when a save names something that no longer exists.
export const DEFAULT_AMMO = Object.fromEntries(
  FEEDS.map(f => [f, forWeapon(f).sort((a, b) => AMMO[a].tier - AMMO[b].tier)[0]]));

// Enough to get off the home map and back without thinking about it.
export const STARTING_AMMO = { cell1: 4000, head1: 400 };

export const roundPrice = key => AMMO[key].price / AMMO[key].pack;

// A safed weapon holds its fire. Useful for saving the expensive warheads while
// you clear trash with the guns, and for not spraying rockets at something you
// only meant to scratch.
export const ARMED_ALL = Object.fromEntries(FEEDS.map(f => [f, true]));
export function sanitiseArmed(raw) {
  const out = {};
  for (const f of FEEDS) out[f] = raw?.[f] !== false;   // armed unless explicitly safed
  return out;
}

// Whatever reaches us from a client or a save file: real keys, whole numbers,
// never negative. Deliberately not capped — see the header.
export function sanitiseAmmo(raw) {
  const out = {};
  for (const k of AMMO_KEYS) {
    const n = Math.floor(Number(raw?.[k]));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

// The one funnel a selection passes through, on load and on every refit. Passing a
// fit is optional so a bare sanitise still works, but the server always passes one:
// a grade the ship may no longer fire has to drop to something it can, or a pilot
// who sells one emitter finds their guns silently dead.
export function sanitiseUsing(raw, stock = {}, ctx = null) {
  const out = {};
  for (const f of FEEDS) {
    const want = raw?.[f];
    let key = AMMO[want]?.for === f ? want : DEFAULT_AMMO[f];
    // Down to the best grade this ship may actually fire, not straight to the
    // cheapest. Dropping a Fusion pilot to Standard because one drone slipped a
    // rung would be a bigger punishment than the rule is asking for.
    if (ctx && whyNotLoad(key, ctx)) key = loadable(f, ctx)[0] ?? DEFAULT_AMMO[f];
    out[f] = key;
  }
  return out;
}

// What a weapon draws from this tick: which grade, how many rounds are left, and
// what each round is worth. Mutating `n` is how rounds get spent — the server
// writes the remainder back to the pilot's stock.
export function magazine(stock, using, feed) {
  const key = AMMO[using?.[feed]]?.for === feed ? using[feed] : DEFAULT_AMMO[feed];
  // `tier` rides along so a round in flight can be drawn in its own colour —
  // combat.js never has to know what a grade is, only what it was handed. `reach`
  // rides along for the same reason: sim.js decides how far a weapon shoots and
  // deliberately knows nothing about the shop, so the magazine hands it the
  // number the way it already hands over the damage multiplier.
  return { key, n: Math.max(0, Math.floor(stock?.[key] ?? 0)),
           mult: AMMO[key].mult, reach: AMMO[key].reach ?? 1, tier: AMMO[key].tier };
}

// The best gun of the right sort you are actually carrying, rack and escort both.
// Drones count: they are guns, they cost money, and a pilot who put their MK-Vs on
// the escort has still bought MK-Vs.
export function bestTierFor(feed, fit, drones = [], EQUIPMENT) {
  const wants = feed === 'rocket' ? 'rocket' : 'laser';
  const keys = [...(fit?.weapon ?? []), ...drones].filter(Boolean);
  let best = 0;
  for (const k of keys) {
    const e = EQUIPMENT[k];
    if (!e || e.slot !== 'weapon') continue;
    const kind = e.kind === 'rocket' ? 'rocket' : 'laser';
    if (kind === wants) best = Math.max(best, e.tier ?? 0);
  }
  return best;
}

// Spoken, not spelled: MK is "em-kay", so it is an MK-I and an Osprey Rack.
const an = w => /^[aeiou]/i.test(w) || /^(mk|f|h|l|m|n|r|s|x)[^a-z]/i.test(w) ? 'an' : 'a';

// The WEAKEST gun of the right sort you are carrying, and where it is. Buying asks
// for the best one you own; loading asks for the worst, and they are different
// questions with different answers.
//
// Empty slots do not count. A Kestrel flying two of its three racks is not carrying
// a tier 1 emitter, it is carrying nothing, and nothing cannot be underfed.
export function lowestGun(feed, fit, drones = [], EQUIPMENT) {
  const wants = feed === 'rocket' ? 'rocket' : 'laser';
  let low = null;
  const look = (keys, where) => {
    for (const k of keys) {
      const e = EQUIPMENT[k];
      if (!e || e.slot !== 'weapon') continue;
      if ((e.kind === 'rocket' ? 'rocket' : 'laser') !== wants) continue;
      if (!low || (e.tier ?? 0) < low.tier) low = { tier: e.tier ?? 0, key: k, name: e.name, where };
    }
  };
  look((fit?.weapon ?? []).filter(Boolean), 'rack');
  look((drones ?? []).filter(Boolean), 'escort');
  return low;
}

// Why this pilot cannot LOAD a grade, as opposed to buy one.
//
// Owning one tier 3 emitter was enough to fire Fusion Cells out of every gun on the
// ship, which made the top grade a single purchase rather than a decision — bolt
// one MK-V onto the escort and eight MK-Is upstairs all fire the hot rounds. The
// rounds are calibrated for the gun. Every gun that fires them has to be that gun.
//
// So: buying is gated on the best weapon you own, because owning one is proof you
// have reached that rung and the crate keeps until the rest of the ship catches up.
// Loading is gated on the worst, because the worst is what would be firing it.
//
// This does mean fitting a spare MK-I into an empty slot can cost you your ammunition,
// which reads as a punishment for adding a gun. It is the honest reading of the rule
// and there is now somewhere to put the spare — the INVENTORY tab breaks it up — so
// the fix is one click rather than a mystery.
//
// AND A PILOT WITH NO WEAPON OF THAT SORT AT ALL IS REFUSED, which is a reversal.
//
// It used to return null — "there is nothing to underfeed, nothing will fire, and
// refusing them a menu choice they cannot act on would only be a sentence they have
// to decode." That is the rule FAILING OPEN, and it was found doing it: a starter
// Hauler carrying one MK-I Emitter and no drones at all was handed `head4` over a
// real socket and the server stored it. The deepest warhead in the game, on a ship
// with no rack.
//
// It is harmless in the tick — you cannot fire a launcher you do not have — and
// that is exactly why it is worth closing. `using` is a STORED CHOICE that outlives
// the fit: it survives a refit, a hull swap and a login. Seat one Sparrow Pod
// tomorrow and the ship is loaded with a grade calibrated for a Cyclone Rack, and
// the only thing between that and firing it is regrade() happening to run. A rule
// whose safety depends on another function being called is not a rule.
//
// So the sentence is one sentence again — every weapon of that sort must be at the
// rung, and none is not "every" — and the answer to "a sentence they have to
// decode" is that the sentence is now a good one and the row it is written on is
// drawn. Buying already failed closed here (bestTierFor returns 0 with no weapon,
// and 0 >= need is false), so this only brings loading into line with it.
export function whyNotLoad(key, { fit, drones = [], EQUIPMENT } = {}) {
  const a = AMMO[key];
  if (!a) return 'no such grade';
  const need = NEEDS[key] ?? 1;
  if (need <= 1) return null;
  const what = a.for === 'rocket' ? 'launcher' : 'emitter';
  const low = lowestGun(a.for, fit, drones, EQUIPMENT);
  if (!low) return `you fly no ${what} — a grade is calibrated for the weapon that fires it`;
  if (low.tier >= need) return null;
  return `every ${what} must be tier ${need} — your ${low.where === 'escort' ? 'escort flies' : 'rack holds'} `
       + `${an(low.name)} ${low.name} (tier ${low.tier})`;
}

// Which grades this pilot may actually load, best first. The menu draws from this
// and the server sanitises against it, so the two cannot offer different lists.
export const loadable = (feed, ctx) =>
  forWeapon(feed).filter(k => !whyNotLoad(k, ctx)).sort((a, b) => AMMO[b].tier - AMMO[a].tier);

// Why this grade is not for sale to this pilot, or null if it is.
//
// A refusal that only says no is a refusal you have to go and research. This one
// names the rung you are missing, the rung you are on, and the shelf that sells
// the difference, because that is the entire next step.
export function whyNotBuy(key, { fit, drones = [], EQUIPMENT } = {}) {
  const a = AMMO[key];
  if (!a) return 'no such grade';
  const need = NEEDS[key] ?? 1;
  if (need <= 1) return null;
  const have = bestTierFor(a.for, fit, drones, EQUIPMENT);
  if (have >= need) return null;
  const rocket = a.for === 'rocket';
  return `needs a tier ${need} ${rocket ? 'launcher' : 'emitter'} — you fly `
       + `${have ? 'tier ' + have : 'none'}, so buy up on the ${rocket ? 'Launchers' : 'Lasers'} page`;
}

// True if this pilot could fire that weapon at all right now.
export const hasRounds = (stock, using, feed) => magazine(stock, using, feed).n > 0;

// The bar along the bottom of the screen: one box per weapon, not one per grade.
// Six boxes said everything at once and took a strip of screen to do it. Two say
// what is loaded, and the choosing happens in a menu that opens over the world
// and closes again the moment you have picked.
export const BAR_BOX = 64, BAR_GAP = 12, BAR_SPLIT = 26;

// Two weapons and the repair rack, in that order, always. The gap before the
// repair box says it is a different kind of thing — that one is spent, not fired.
// Two consumables ride beside the weapons: the one that fixes the ship and the
// one that takes it home.
export const BAR_SLOTS = [...FEEDS, 'repair', 'device'];

export function barLayout(VIEW_W, VIEW_H) {
  const n = BAR_SLOTS.length;
  const w = n * BAR_BOX + (n - 1) * BAR_GAP + (BAR_SPLIT - BAR_GAP);
  const x0 = Math.round((VIEW_W - w) / 2), y = Math.round(VIEW_H - BAR_BOX - 14);
  let x = x0;
  const boxes = BAR_SLOTS.map(feed => {
    const box = { feed, r: { x, y, w: BAR_BOX, h: BAR_BOX } };
    x += BAR_BOX + (feed === FEEDS.at(-1) ? BAR_SPLIT : BAR_GAP);
    return box;
  });
  return { r: { x: x0, y, w, h: BAR_BOX }, boxes };
}

// What a box's tooltip occupies when you hover one. Three boxes draw one — the two
// weapons, the repair rack and the beacon — all at the same offset, so it is one
// pair of numbers rather than the same two written four times.
export const TIP_H = 20, TIP_UP = 24;

// And where the SPACE prompt goes, which is ABOVE all of that.
//
// It used to sit 34px over the bar, which put it at VIEW_H-112..VIEW_H-88 while a
// box tooltip covers VIEW_H-102..VIEW_H-82 — fourteen pixels of overlap, on every
// window size, since the prompt was added. Hovering a weapon to read what is loaded
// printed the tooltip straight through the sentence telling you what SPACE does.
//
// Derived rather than nudged: it clears the top of the tooltip band by PROMPT_GAP.
// The ammunition MENU still covers it, and that is correct — a menu is something you
// opened on purpose and it closes on the next click.
export const PROMPT_H = 24, PROMPT_GAP = 8;
export function promptRect(VIEW_W, VIEW_H, w) {
  const L = barLayout(VIEW_W, VIEW_H);
  const tipTop = L.r.y - TIP_UP;                   // the highest a hover tooltip reaches
  return { x: Math.round((VIEW_W - w) / 2), y: tipTop - PROMPT_GAP - PROMPT_H,
           w, h: PROMPT_H };
}

// The chooser that opens above a box. Grades run bottom-up so the one nearest
// the box is the first in the list, and it never runs off the top.
export const MENU_ROW = 30, MENU_W = 190;
export function feedMenu(box, grades) {
  const h = 8 + grades.length * MENU_ROW;
  const x = box.r.x + box.r.w / 2 - MENU_W / 2;
  const y = box.r.y - h - 8;
  return {
    box: { x, y, w: MENU_W, h },
    rows: grades.map((k, i) => ({
      k, r: { x: x + 5, y: y + 4 + i * MENU_ROW, w: MENU_W - 10, h: MENU_ROW - 4 },
    })),
  };
}
