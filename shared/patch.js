// The changelog the game shows about itself.
//
// Newest first, and deliberately terse: this is a list a player reads in fifteen
// seconds to see that the game is moving, not a commit log. The reasoning behind
// any of it lives in the commit that made the change.
//
// The version is <major>.<minor> and the minor climbs once per shipped batch.
// Add the new entry at the TOP and bump VERSION with it — the client shows
// VERSION beside the icon, so the two drifting apart is immediately visible.

export const VERSION = '7.24';

export const PATCHES = [
  { v: '7.24', notes: [
    'Pirate outposts in every third sector: sell ore mid-run at 75%, no repairs and no shelter',
    'SPACE at a gate now jumps instead of hauling in whatever is under you',
    'Hostiles respawn clear of anybody already in the sector, not on top of them',
  ] },
  { v: '7.23', notes: [
    'Ore from a shared kill is split like the credits — one pod each, no race',
    'The Leviathan holds the third sector: it cannot be kited, and it cannot be soloed',
    'Aliens switch target if you crowd them for 3s, or out-damage whoever they are on',
    'Every hostile has its own silhouette instead of one arrowhead at four sizes',
    'Ammunition is x1 / x3 / x5 and priced to be worth loading — it was a trap before',
    'Bandits pay 79800: they take 17x as long to kill as an Ironhusk and paid 4.6x',
  ] },
  { v: '7.22', notes: [
    'A collector finishes its pull if you fly off, and comes to you instead of aborting',
    'Drone speed is 1.3x your ship, so it neither teleports nor gets left behind',
    'Fixed the tractor beam flashing for one frame at the start of every pull',
  ] },
  { v: '7.21', notes: [
    'Collector rigs have their own bay and no longer cost you a gun',
    'A pull holds station over the pod for 1.4s, and everyone can see it happen',
    'Every alien drops loot — the Ironhusk and the Bandit had no drop table at all',
  ] },
  { v: '7.20', notes: [
    'Time flown is tracked, in the ESC menu — idle time before an auto sign-out is not counted',
  ] },
  { v: '7.19', notes: [
    'Bounties are shared by damage: a tenth of the work pays, and the pot grows with the party',
    'Arrow keys steer as well as WASD',
    'Friendly ships are blue on the plot instead of your company colour',
  ] },
  { v: '7.18', notes: [
    'WASD flies the ship, so farming does not need the mouse',
  ] },
  { v: '7.17', notes: [
    'Plotted courses land under the cursor — they were short by a fifth on most window sizes',
  ] },
  { v: '7.16', notes: [
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

export const ROW_H = 15, HEAD_H = 30, VER_H = 22, PAD = 14;

export function patchPanel(VIEW_W, VIEW_H) {
  const w = Math.min(430, VIEW_W - 40);
  const rows = PATCHES.reduce((n, p) => n + 1 + p.notes.length, 0);
  const h = Math.min(VIEW_H - 80, HEAD_H + PAD + rows * ROW_H + PATCHES.length * (VER_H - ROW_H) + PAD);
  const x = VIEW_W - w - 16, y = 14 + ICON + 8;
  const panel = { x, y, w, h };

  // Laid out until it runs out of room rather than clipped mid-line: a version
  // header with nothing under it reads as a bug, so a version is only placed if
  // at least its first note fits too.
  const lines = [];
  let cy = y + HEAD_H;
  for (const p of PATCHES) {
    if (cy + VER_H + ROW_H > y + h - PAD) break;
    lines.push({ kind: 'ver', v: p.v, x: x + PAD, y: cy + 14 });
    cy += VER_H;
    for (const n of p.notes) {
      if (cy + ROW_H > y + h - PAD) break;
      lines.push({ kind: 'note', text: n, x: x + PAD + 10, y: cy + 11 });
      cy += ROW_H;
    }
  }
  return { panel, lines };
}
