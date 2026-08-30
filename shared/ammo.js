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
// It used to be answered "no". A Charged Cell was 1.25x the damage for 8x the
// price per round — 6.4x the cost per point — so nothing above the plain grade
// was ever worth loading, and two thirds of the ammunition in the shop was
// decoration. The ladder is now a stated premium instead of a trap:
//
//   Standard  x1  0.20 cr/round  0.200 per point
//   Charged   x3  0.72 cr/round  0.240 per point  (+20%)
//   Fusion    x5  1.40 cr/round  0.280 per point  (+40%)
//
// So better rounds still cost more per point — they have to, or the plain grade
// would be pointless — but the premium buys real dps rather than punishing you
// for wanting it. Warheads run the same ladder at their own base.
// One colour per grade, so the bar, the chooser and the round itself in flight
// cannot disagree about what is loaded. Telling grades apart by counting pips in
// the HUD was no help at all in the middle of a fight.
export const GRADE_COLOUR = { 1: '#c2a24f', 2: '#e05a5a', 3: '#7de08a' };
export const gradeColour = tier => GRADE_COLOUR[tier] ?? GRADE_COLOUR[1];

export const AMMO = {
  // For emitters. Consumed one round per bolt, so a big rack eats them fast.
  cell1: { name: 'Standard Cells', for: 'laser', tier: 1, mult: 1.00, pack: 2000, price:  400,
           colour: GRADE_COLOUR[1],
           blurb: 'What the racks are calibrated for.' },
  cell2: { name: 'Charged Cells',  for: 'laser', tier: 2, mult: 3.00, pack: 1000, price:  720,
           colour: GRADE_COLOUR[2],
           blurb: 'Three times the bolt, for a fifth more per point of damage.' },
  cell3: { name: 'Fusion Cells',   for: 'laser', tier: 3, mult: 5.00, pack:  500, price:  700,
           colour: GRADE_COLOUR[3],
           blurb: 'Five times the bolt. The most damage a rack can throw at once.' },

  // For launchers. One warhead per rocket, so a Swarm Rack is fifteen a volley.
  head1: { name: 'Standard Warheads', for: 'rocket', tier: 1, mult: 1.00, pack: 400, price:  600,
           colour: GRADE_COLOUR[1],
           blurb: 'Shaped charge, mass produced.' },
  head2: { name: 'Tandem Warheads',   for: 'rocket', tier: 2, mult: 3.00, pack: 200, price: 1100,
           colour: GRADE_COLOUR[2],
           blurb: 'Two stages. Three times through shielding that shrugs off one.' },
  head3: { name: 'Antimatter Heads',  for: 'rocket', tier: 3, mult: 5.00, pack: 100, price: 1050,
           colour: GRADE_COLOUR[3],
           blurb: 'Rare, unstable, and worth every credit when it lands.' },
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
