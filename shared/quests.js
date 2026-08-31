// Quests, and what a quest pays.
//
// shared/threats.js has been counting kills per hostile since the threat file
// shipped: `kills` is a tally on the account, sanitised on the way in, carried on
// the way out and already on the wire. A quest is a PREDICATE OVER THAT TALLY and
// nothing else — a number to beat, a name for beating it, and something permanent
// on the far side. Nothing here counts anything; the counting was already done.
//
// WHAT A QUEST IS ALLOWED TO PAY, which is the whole design argument.
//
// CLAUDE.md rule five: the anti-pay-to-win invariant is about MONEY, not time. What
// is forbidden is buying your way past somebody — no purchase strictly dominates,
// every technology gives something up, credits never turn into an unanswerable
// ship. No amount of credits will ever kill a hundred Corsair Hives. So an unlock
// here is a straight REWARD: no drawback, no second price at a counter, no "it only
// takes one kind of drone". You went and did a hard thing and now your ship is
// different, which is the genre working rather than the rule bending.
//
// The nineteen-mount invariant is untouched by that and test/ships.mjs now says so
// out loud: it is a claim about what the SHOP sells, and an unlock is not
// purchasable. Two extra berths that every hull earns equally do not change which
// hull dominates which — the anti-domination comparison is over the hull table and
// the hull table has not moved.
//
// WHY AN UNLOCK IS WRITTEN DOWN RATHER THAN RE-DERIVED FROM `kills`.
//
// It would be one line — `(kills.hive ?? 0) >= 100` — and it is not, for the two
// reasons `claims` is a list rather than a query:
//
//   - A THRESHOLD THAT MOVES MUST NEVER CONFISCATE. Raise the Hive to 150 and every
//     pilot who earned it at 100 loses two bays mid-flight, with their escort
//     silently parked and nothing on screen to say why.
//   - sanitiseKills DROPS kinds nobody defines any more, so retiring a hostile would
//     take the reward for it with it. A trophy outlives the animal.
//
// Earned once, kept. `unlocked` is a list on the account beside `claims` and
// `berths` and goes through carried()/capture() with them.

import { ALIENS, MIRROR, farmHp } from './aliens.js';

// --- how many ------------------------------------------------------------------
//
// One number is chosen and the rest are derived. The chosen one is the designer's:
// A HUNDRED CORSAIR HIVES.
//
// Everything else is that same amount of TIME, and time rather than hit points is
// not a detail. `farmHp` is what the whole economy is priced in and it would say a
// Crucible (2,055,480) is worth 3.16 Hives (650,000) — but you do not spend a
// fight's worth of hit points, you spend a fight's worth of MINUTES, and most of a
// minute out there is spent waiting for the next one to come back:
//
//     one kill  =  farmHp / your gun  +  respawn / how many are posted
//
// server.js posts two of everything ("nothing in this game is posted alone"), so
// the wait is half the respawn — 150 seconds for a Hive against 57.5 of shooting.
// The respawn IS the fight, at this end of the bestiary, and counting hit points
// would have asked 32 Crucibles where the honest ask is 65.
//
//   hive       57.5s shooting + 150s wait = 207.5s  x 100  =  5.76 hours
//   crucible  181.8s          + 150s      = 331.8s  x  65  =  5.99
//   doldrum   181.8s          + 150s      = 331.8s  x  65  =  5.99
//   thresher   18.2s          +  60s      =  78.2s  x 265  =  5.76
//
// The gun is MIRROR.dps — "the sharpest gun the shop sells", 11,306.59, which
// test/aliens.mjs pins equal to balance.js's stageDps('finished') to the penny. It
// is taken from aliens.js rather than from balance.js on purpose: balance.js does a
// great deal of work at module scope and nothing on the client imports it, and this
// file is read by the threat file on every frame it is open.
//
// Research does not enter it. The ladder multiplies hull and shield and never
// damage, so a finished pilot at x1 and at x32 both shoot a Hive down in 57.5
// seconds. What the ladder buys is surviving the reply.
//
// SO IT IS ONE EDIT: move ANCHOR_KILLS and all four move together, in hours rather
// than in counts. Rounded to the nearest five, because a five-hour estimate is worth
// two significant figures — 265 is a number a pilot can hold in their head while
// flying and 265.4 is a lie about how precise any of this is.
export const ANCHOR = 'hive';
export const ANCHOR_KILLS = 100;
export const POSTED = 2;                 // two of each, everywhere — see server.js's seeding

export const secsPerKill = kind =>
  farmHp(kind) / MIRROR.dps + (ALIENS[kind]?.respawn ?? 0) / POSTED;

export const needFor = kind => {
  if (!ALIENS[kind]) return Infinity;
  const n = ANCHOR_KILLS * secsPerKill(ANCHOR) / secsPerKill(kind);
  return Math.max(5, Math.round(n / 5) * 5);
};

// --- the table -----------------------------------------------------------------
//
// THE SEAM. A quest is a row here and nothing else: the hostile it is about, what
// the reward is called, and what the reward DOES. A fifth is a fifth row.
//
// What a row may pay today is `bays`: extra drone berths, on every hull you fly. A
// row without one pays nothing and breaks nothing — rule seven — so a quest can be
// posted before the mechanic behind it exists.
//
// There is deliberately NO generic `mods: [[attr, op, v]]` fold here, and the reason
// is a cycle rather than taste. A stat unlock would have to be applied inside
// shared/sim.js beside applyResearch, and sim.js cannot import this file: quests ->
// aliens -> sim is already the chain, and importing back is exactly the TDZ blow-up
// aliens.js spends a paragraph warning about over MIRROR.dps. So the ship is handed
// a NUMBER of berths, not a list, and a future stat reward is a small piece of work
// in sim.js rather than a row of data. That is the honest shape of the seam.
//
// ONE ROW TODAY, and the other three are proposals rather than omissions. The
// Thresher's chamber, the Crucible's White Heat and the Doldrum's Slack Water are
// each a live per-ship mechanic with its own wire field and its own meter, not a
// number on a stat block, and two of the three live in shared/ground.js. They are
// written up with their thresholds in the report that came with this commit; the
// thresholds themselves already work — needFor('thresher') answers 265 today.
//
// The tell is the reward's own line in the threat file, the way ALIENS[k].tell is
// the hostile's. It is data for the same reason: the next one is a line here rather
// than a change to the client.
export const QUESTS = {
  brood: {
    kind: 'hive',
    name: 'Brood Frame',
    // A Corsair Hive is a mothership: everything dangerous about it is the twelve
    // Bandits it broods, and its own gun and engines are "almost beside the point"
    // (shared/aliens.js). Kill a hundred of them and you take the frame. The reward
    // is the hostile's own mechanic pointed the other way — you brood now.
    // Kept under about 45 characters: the threat file draws it after the name and the
    // count on ONE 10px monospace line, and the whole line has ~496px at a 1024
    // window. "BROOD FRAME  37/100 · <tell>" is 66 characters at 44, which is 396px.
    tell: 'Two more drone berths, on every hull you fly.',
    // The sentence the banner says when it lands, which is a different job: nobody is
    // reading it off a row, they have just finished a five hour hunt.
    won: 'You brood now.',
    bays: 2,
  },
};

export const QUEST_KEYS = Object.keys(QUESTS);
export const questFor = kind => QUEST_KEYS.find(k => QUESTS[k].kind === kind) ?? null;

// --- what you have earned ------------------------------------------------------
//
// Membership of a fixed list, the same shape as `claims`: a hand-edited save cannot
// name a reward that does not exist, and a retired quest drops out cleanly rather
// than leaving a ship flying berths nothing can explain.
export const sanitiseUnlocked = raw =>
  [...new Set((Array.isArray(raw) ? raw : []).filter(k => QUESTS[k]))];

export const progressOf = (kills, key) => {
  const q = QUESTS[key];
  if (!q) return null;
  const need = needFor(q.kind);
  const have = Math.max(0, Math.floor(kills?.[q.kind] ?? 0));
  return { key, kind: q.kind, name: q.name, tell: q.tell ?? '',
           have, need, at: Math.min(1, need > 0 ? have / need : 0), done: have >= need };
};

// Which quests this tally has finished. Used to GRANT, never to decide what a pilot
// currently has — that is `unlocked`, for the confiscation reason at the top.
export const earnedBy = kills =>
  QUEST_KEYS.filter(k => progressOf(kills, k).done);

// What just landed. The server calls this after a kill with the list it held before
// and the tally it holds now, so the banner fires exactly once, on the kill that did
// it, rather than every tick afterwards.
export const newlyEarned = (had, kills) => {
  const have = new Set(sanitiseUnlocked(had));
  return earnedBy(kills).filter(k => !have.has(k));
};

// --- what it does to the ship --------------------------------------------------
//
// Berths first, because they are not a stat: baysOf() decides how many drones are
// SEATED before resolve() has looked at anything, so this has to be a number handed
// in rather than a multiplier applied afterwards the way the research ladder is.
export const bonusBays = unlocked =>
  sanitiseUnlocked(unlocked).reduce((n, k) => n + (QUESTS[k].bays ?? 0), 0);

// --- the line under a threat file entry ----------------------------------------
//
// The quest lives on the threat file rather than in a panel of its own, because the
// file is already the page that says what you have killed and how many of it. A
// quest is that same number with something to reach, so it belongs on the same row
// — and a pilot who has never met a Hive should not be shown a Hive quest, which
// falls out for free: an entry only exists once you have killed one.
//
// UI geometry is a shared rule (CLAUDE.md rule one) and this is why the row grew:
// FILE_ROW is 96 + QUEST_H, because a row that already carries three wrapped lines
// of tell cannot also carry a bar without one of them being drawn outside its own
// card. Measured from the BOTTOM of the row rather than the top, so a tell that
// wraps to two lines on a wide window and three on a narrow one cannot walk into it.
export const QUEST_H = 20;               // a 10px line, a 3px bar and the air around them
export const BAR_H = 3;
export const TEXT_X = 78;                // the file's own text column, past the silhouette

// The bar goes UNDER the line rather than beside it. Beside it was the first cut and
// it does not survive a narrow window: the label is up to 66 characters of 10px
// monospace — about 400px — and the body of the panel is 588px at 1024 and 528px at
// 600, so a bar parked on the right hand end printed straight through the sentence
// on every window under about 1100. Stacked, the two cannot collide at any width,
// which is the only arrangement that is true rather than true today.
export function questBar(r) {
  return {
    text: { x: r.x + TEXT_X, y: r.y + r.h - 12 },
    track: { x: r.x + TEXT_X, y: r.y + r.h - 7, w: Math.max(20, r.w - TEXT_X - 14), h: BAR_H },
  };
}

// What the line SAYS, here rather than in the client, so the panel and its test
// cannot disagree about it. Two sentences and never three: what you are working
// toward and how far off you are, or — once — that it is yours.
export const questLine = (kills, kind, unlocked = []) => {
  const key = questFor(kind);
  if (!key) return null;
  const p = progressOf(kills, key);
  const has = sanitiseUnlocked(unlocked).includes(key);
  return {
    ...p, has,
    // The count on this line is CLAMPED to the goal, and the pilot's real tally is
    // already drawn beside it in 15px green — a Hive veteran reading "999999/100"
    // beside "999,999 killed" is one number twice, one of them nonsense. A progress
    // meter that is full says so; the diary keeps the diary.
    label: `${p.name.toUpperCase()}  ${has ? 'EARNED' : `${Math.min(p.have, p.need)}/${p.need}`} · ${p.tell}`,
    // A quest you have finished but not been granted cannot happen in the running
    // game (the server grants on the kill that finishes it), but it can happen to a
    // save restored from before this shipped. It reads as done and the next kill
    // grants it, which is a better failure than a bar stuck at full.
    at: has ? 1 : p.at,
  };
};
