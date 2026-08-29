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

export const AMMO = {
  // For emitters. Consumed one round per bolt, so a big rack eats them fast.
  cell1: { name: 'Standard Cells', for: 'laser', tier: 1, mult: 1.00, pack: 2000, price:  400,
           blurb: 'What the racks are calibrated for.' },
  cell2: { name: 'Charged Cells',  for: 'laser', tier: 2, mult: 1.25, pack: 1000, price: 1600,
           blurb: 'A quarter more out of every bolt, at four times the price.' },
  cell3: { name: 'Fusion Cells',   for: 'laser', tier: 3, mult: 1.55, pack:  500, price: 3400,
           blurb: 'For fights you have decided to win.' },

  // For launchers. One warhead per rocket, so a Swarm Rack is fifteen a volley.
  head1: { name: 'Standard Warheads', for: 'rocket', tier: 1, mult: 1.00, pack: 400, price:  600,
           blurb: 'Shaped charge, mass produced.' },
  head2: { name: 'Tandem Warheads',   for: 'rocket', tier: 2, mult: 1.30, pack: 200, price: 1800,
           blurb: 'Two stages. Goes through shielding that shrugs off the first.' },
  head3: { name: 'Antimatter Heads',  for: 'rocket', tier: 3, mult: 1.65, pack: 100, price: 3600,
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
  return { key, n: Math.max(0, Math.floor(stock?.[key] ?? 0)), mult: AMMO[key].mult };
}

// True if this pilot could fire that weapon at all right now.
export const hasRounds = (stock, using, feed) => magazine(stock, using, feed).n > 0;

// The bar along the bottom of the screen. One box per grade, lasers then rockets,
// in the order they are declared — fixed, so a box is always the same thing and
// muscle memory works. The two in use are the ones the weapons draw from.
export const BAR_BOX = 54, BAR_GAP = 6, BAR_SPLIT = 18;

export function barLayout(VIEW_W, VIEW_H) {
  const feeds = FEEDS.map(f => forWeapon(f));
  const n = feeds.reduce((t, g) => t + g.length, 0);
  const w = n * BAR_BOX + (n - feeds.length) * BAR_GAP + (feeds.length - 1) * BAR_SPLIT;
  const x0 = Math.round((VIEW_W - w) / 2), y = VIEW_H - BAR_BOX - 14;
  const boxes = [];
  let x = x0;
  feeds.forEach((grades, fi) => {
    grades.forEach((k, i) => {
      boxes.push({ k, feed: FEEDS[fi], r: { x, y, w: BAR_BOX, h: BAR_BOX } });
      x += BAR_BOX + (i === grades.length - 1 ? 0 : BAR_GAP);
    });
    x += BAR_SPLIT;
  });
  return { boxes, r: { x: x0, y, w, h: BAR_BOX } };
}
