// The changelog the game shows about itself.
//
// Newest first, and deliberately terse: this is a list a player reads in fifteen
// seconds to see that the game is moving, not a commit log. The reasoning behind
// any of it lives in the commit that made the change.
//
// The version is <major>.<minor> and the minor climbs once per shipped batch.
// Add the new entry at the TOP and bump VERSION with it — the client shows
// VERSION beside the icon, so the two drifting apart is immediately visible.

export const VERSION = '0.29';

export const PATCHES = [
  { v: '0.29', notes: [
    'Collector rigs refine as you fly: the cheapest metal you carry packs into the next one up',
    'Value is kept and space is freed, so the rig refills the room and your hold climbs',
    'A better rig refines faster — the Ore Tender is worth roughly twice the Scavenger',
  ] },
  { v: '0.28', notes: [
    'You come back at the last hangar you used, including a pirate bay you rent',
    'Pirate outposts keep the peace inside the trading zone, so a respawn is not a death loop',
    'The peace stops at the zone edge — step outside and the frontier is unchanged',
  ] },
  { v: '0.27', notes: [
    'Eleven more technologies — your guns, your escort and your hull ability all have one now',
    'Siege and Rapid Cadence trade bolt weight against cadence for exactly the same damage',
    'Launcher Primacy pays your guns into your racks, and is a loss if you fly no racks',
    'Wing Repeaters fly a formation at full strength off one drone; Wing Coupling off six, harder',
    'Your hull ability is fittable now: deepen a Veil, loosen an Anchor, hold a Lock at range',
    'A Null Skin halves the range a Kestrel is found at, and costs a third of its shields',
    'Keel Bracing swells a Bulwark to five and a half times its shield, and parks it there',
  ] },
  { v: '0.26', notes: [
    'Every store row and tooltip says what the thing does and where it is sold',
    'Tooltips cover ammunition, repair drones and beacons too, priced against your ship',
    'A refusal names the fix now: which page to buy on, or how many seconds to wait',
    'Your unfitted gear is your inventory; the ore panel on I is CARGO',
  ] },
  { v: '0.25', notes: [
    'Anything you cannot buy yet now looks locked and says why, instead of just refusing',
  ] },
  { v: '0.24', notes: [
    'Store shelves scroll instead of squeezing every row shorter as they grow',
  ] },
  { v: '0.23', notes: [
    'Eleven new technologies, and the shelf is tiered — Deep Tech is its own page',
    'The Reactor Flywheel did nothing: a bigger tank cannot buy you more uptime',
    'So the reactor shelf is three real trades now — the floor, the rate, or one long hold',
    'Shield technologies buy WHEN, not how much: Snap starts sooner, Deep-Bank pours harder',
    'The Signal Damper mends you sooner too — signature alone was worth nothing to aliens',
    'Your hull decides how many technologies you fly. Drones were a second tech rack',
    'Composite Plating and Hold Expander cost what they are worth now',
  ] },
  { v: '0.22', notes: [
    'MK-III emitters and up, and Tandem launchers and up, are frontier stock now',
    'Your company issues the starter kit — the rest comes off a pirate hulk',
    'Technologies are tiered, and the top rung will be frontier stock too',
    'A berth is 27200 at rank 8: it is the door to the second half of the ladder now',
    'Outposts say what they are for, instead of expecting you to guess',
    'A Fighter running Lock glows, so you can see it between volleys',
  ] },
  { v: '0.21', notes: [
    'Abilities are visible now: a Veil fades you and your drones, a Lock burns orange',
    'And an Anchor braces plates around the hull instead of the usual shield bubble',
    'Ammunition grades need a gun that can fire them — no more buying the best cells on day one',
    'Rent a berth at a pirate outpost and refit there, if the pirates have heard of you',
    'A berth is 102000, rank 20, and shuts the moment anything shoots at you',
    'SPACE at an outpost sells to it instead of hauling in whatever is lying beside it',
  ] },
  { v: '0.20', notes: [
    'Each hull has an ability on 4: Veil on the Kestrel, Lock on the Vanguard, Anchor on the Bulwark',
    'All three scale with the power you route to them, and cost the same capacitor your guns want',
    'Every ship has its own silhouette — an interceptor no longer looks like a smaller bomber',
    'Frame time and ping in the ESC menu, so you can tell your machine from your connection',
    'Credits read as 4.12M instead of 4120000',
  ] },
  { v: '0.19', notes: [
    'The sector arrives as what changed, not all of it again — a twentieth of the traffic',
    'Snapshots are compressed too, so a crowded fight costs a fifteenth of what it did',
  ] },
  { v: '0.18', notes: [
    'Ammunition grades are x1 / x1.25 / x1.5 — a premium on your guns, not a second gun ladder',
    'Crates are one size at every grade, so the better ammunition no longer has the smaller price',
  ] },
  { v: '0.17', notes: [
    'Fixed a reactor exploit: generators past your speed floor were still raising the boost ceiling',
  ] },
  { v: '0.16', notes: [
    'Dying now costs 10% of your credits as well as your cargo — flying empty is no longer free',
  ] },
  { v: '0.15', notes: [
    'Corsair Hives launch a raider every 5s and hold twelve — ignore them and they pile up',
    'The number of pilots online is shown beside the patch notes',
  ] },
  { v: '0.14', notes: [
    'Pirate outposts moved to the frontier sectors, where a full hold actually ends a run',
    'Corsair Hives now hold the three gate sectors instead of Nullpoint, so they get met',
    'A recall folding home draws collapsing rings, and everyone nearby can see it',
  ] },
  { v: '0.13', notes: [
    'Recall Beacons: a single-use device that folds you home over five seconds',
    'One hit breaks the fold — and the beacon is not spent, so you can try again',
  ] },
  { v: '0.12', notes: [
    'Generators raise the reactor ceiling by what they cost you in speed',
    'The Corsair Hive at Nullpoint: ten Leviathans, and it launches the Bandits',
    'Aliens keep out of your docking ring unless they are already chasing you',
    'Pirate outposts are marked on the star chart, not just the sector plot',
  ] },
  { v: '0.11', notes: [
    'Patch notes wrap and scroll instead of cutting every line off halfway',
  ] },
  { v: '0.10', notes: [
    'Pirate outposts in every third sector: sell ore mid-run at 75%, no repairs and no shelter',
    'SPACE at a gate now jumps instead of hauling in whatever is under you',
    'Hostiles respawn clear of anybody already in the sector, not on top of them',
  ] },
  { v: '0.9', notes: [
    'Ore from a shared kill is split like the credits — one pod each, no race',
    'The Leviathan holds the third sector: it cannot be kited, and it cannot be soloed',
    'Aliens switch target if you crowd them for 3s, or out-damage whoever they are on',
    'Every hostile has its own silhouette instead of one arrowhead at four sizes',
    'Ammunition is x1 / x3 / x5 and priced to be worth loading — it was a trap before',
    'Bandits pay 79800: they take 17x as long to kill as an Ironhusk and paid 4.6x',
  ] },
  { v: '0.8', notes: [
    'A collector finishes its pull if you fly off, and comes to you instead of aborting',
    'Drone speed is 1.3x your ship, so it neither teleports nor gets left behind',
    'Fixed the tractor beam flashing for one frame at the start of every pull',
  ] },
  { v: '0.7', notes: [
    'Collector rigs have their own bay and no longer cost you a gun',
    'A pull holds station over the pod for 1.4s, and everyone can see it happen',
    'Every alien drops loot — the Ironhusk and the Bandit had no drop table at all',
  ] },
  { v: '0.6', notes: [
    'Time flown is tracked, in the ESC menu — idle time before an auto sign-out is not counted',
  ] },
  { v: '0.5', notes: [
    'Bounties are shared by damage: a tenth of the work pays, and the pot grows with the party',
    'Arrow keys steer as well as WASD',
    'Friendly ships are blue on the plot instead of your company colour',
  ] },
  { v: '0.4', notes: [
    'WASD flies the ship, so farming does not need the mouse',
  ] },
  { v: '0.3', notes: [
    'Plotted courses land under the cursor — they were short by a fifth on most window sizes',
  ] },
  { v: '0.2', notes: [
    'The game is deployed, and the music streams from the server',
  ] },
  { v: 'earlier', notes: [
    'Everything before the log existed: hulls, drones, formations, rockets, ammunition,',
    'the station, the star chart, radar, the Bandit, repair drones and the soundtrack',
  ] },
];

// --- geometry, so drawing and hit-testing can never disagree ------------------
export const ICON = 26;

// Top right, above where receipts stack. It has to sit clear of them: a button
// that spends half its life underneath a purchase notification is not a button.
export const patchIcon = VIEW_W => ({ x: VIEW_W - ICON - 16, y: 14, w: ICON, h: ICON });

export const ROW_H = 15, HEAD_H = 32, PAD = 14, FOOT = 10;

// The notes are set in 10px ui-monospace, so a character is a known width and the
// wrap can be computed here rather than measured in the client. That matters:
// this file decides both what is drawn and what is scrolled through, and a wrap
// that disagreed between the two would scroll past lines nobody ever saw.
export const CHAR_W = 6;

// Anybody who opens a changelog wants to read it. Cutting each line off at the
// panel edge with an ellipsis was the worst of both — it took the space and gave
// back half a sentence.
export function wrapNote(text, cols) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if (line.length + 1 + w.length <= cols) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

// Every line the changelog has, wrapped. One flat list, so scrolling is an index
// into it rather than a second layout pass that could disagree with the first.
export function patchLines(cols) {
  const out = [];
  for (const p of PATCHES) {
    out.push({ kind: 'ver', v: p.v });
    for (const n of p.notes) for (const seg of wrapNote(n, cols)) out.push({ kind: 'note', text: seg });
    out.push({ kind: 'gap' });
  }
  return out;
}

export function patchPanel(VIEW_W, VIEW_H, scroll = 0) {
  // Wide enough to read a sentence on one line where it fits, and happy to take
  // most of the screen for it — the notes are short, the reading is the point.
  const w = Math.max(280, Math.min(820, VIEW_W - 40));
  // Tall enough that the whole log fits on an ordinary screen and the scrollbar
  // is for small windows rather than for everybody.
  const h = Math.max(140, Math.min(VIEW_H - 90, 780));
  const x = VIEW_W - w - 16, y = 14 + ICON + 8;
  const cols = Math.max(24, Math.floor((w - PAD * 2 - 14) / CHAR_W));

  const all = patchLines(cols);
  const per = Math.max(1, Math.floor((h - HEAD_H - FOOT) / ROW_H));
  const maxScroll = Math.max(0, all.length - per);
  const at = Math.max(0, Math.min(maxScroll, Math.round(scroll)));
  const lines = all.slice(at, at + per).map((l, i) => ({
    ...l, x: x + PAD + (l.kind === 'note' ? 12 : 0), y: y + HEAD_H + i * ROW_H + 11,
  }));

  // The bar is only drawn when there is something below the fold, so a changelog
  // short enough to fit does not grow a control that does nothing.
  const bar = maxScroll > 0 ? {
    x: x + w - 7, y: y + HEAD_H + (at / all.length) * (h - HEAD_H - FOOT),
    w: 3, h: Math.max(18, (per / all.length) * (h - HEAD_H - FOOT)),
  } : null;
  return { panel: { x, y, w, h }, lines, bar, at, per, cols, total: all.length, maxScroll };
}
