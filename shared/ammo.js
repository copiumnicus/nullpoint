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
//
// The crate is the same size at every grade now. It used to shrink as the grade
// climbed, which meant the better ammunition had the smaller price on the shelf —
// true per round and nonsense to read. Warheads run the same ladder at their own
// base.
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
// Three grades across five emitter rungs is the two ends and the middle. Three
// grades across three launcher rungs is one each.
export const NEEDS = { cell1: 1, cell2: 3, cell3: 5, head1: 1, head2: 2, head3: 3 };

export const GRADE_COLOUR = { 1: '#c2a24f', 2: '#e05a5a', 3: '#7de08a' };
export const gradeColour = tier => GRADE_COLOUR[tier] ?? GRADE_COLOUR[1];

export const AMMO = {
  // For emitters. Consumed one round per bolt, so a big rack eats them fast.
  cell1: { name: 'Standard Cells', for: 'laser', tier: 1, mult: 1.00, pack: 2000, price:  400,
           colour: GRADE_COLOUR[1],
           blurb: 'The standard round. Every emitter fires it.' },
  cell2: { name: 'Charged Cells',  for: 'laser', tier: 2, mult: 1.25, pack: 2000, price:  600,
           colour: GRADE_COLOUR[2],
           blurb: 'Hotter cells. 20% dearer per point of damage.' },
  cell3: { name: 'Fusion Cells',   for: 'laser', tier: 3, mult: 1.50, pack: 2000, price:  840,
           colour: GRADE_COLOUR[3],
           blurb: 'The hottest cell made. 40% dearer per point.' },

  // For launchers. One warhead per rocket, so a Swarm Rack is fifteen a volley.
  head1: { name: 'Standard Warheads', for: 'rocket', tier: 1, mult: 1.00, pack: 400, price:  600,
           colour: GRADE_COLOUR[1],
           blurb: 'A mass-produced shaped charge. Any rack fires it.' },
  head2: { name: 'Tandem Warheads',   for: 'rocket', tier: 2, mult: 1.25, pack: 400, price:  900,
           colour: GRADE_COLOUR[2],
           blurb: 'Two stages, to beat shielding. 20% dearer per point.' },
  head3: { name: 'Antimatter Heads',  for: 'rocket', tier: 3, mult: 1.50, pack: 400, price: 1260,
           colour: GRADE_COLOUR[3],
           blurb: 'Unstable, and it lands hard. 40% dearer per point.' },
};

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

export function sanitiseUsing(raw, stock = {}) {
  const out = {};
  for (const f of FEEDS) {
    const want = raw?.[f];
    out[f] = AMMO[want]?.for === f ? want : DEFAULT_AMMO[f];
  }
  return out;
}

// What a weapon draws from this tick: which grade, how many rounds are left, and
// what each round is worth. Mutating `n` is how rounds get spent — the server
// writes the remainder back to the pilot's stock.
export function magazine(stock, using, feed) {
  const key = AMMO[using?.[feed]]?.for === feed ? using[feed] : DEFAULT_AMMO[feed];
  // `tier` rides along so a round in flight can be drawn in its own colour —
  // combat.js never has to know what a grade is, only what it was handed.
  return { key, n: Math.max(0, Math.floor(stock?.[key] ?? 0)), mult: AMMO[key].mult, tier: AMMO[key].tier };
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
