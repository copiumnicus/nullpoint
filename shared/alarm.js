// The one warning slot in the middle of the screen, and who is allowed to have it.
//
// Two things want to shout at the pilot from the same place: the hull shear that
// eats you outside charted space, and the hull itself running out. They were
// never going to be able to share those pixels — a centred bold 30px banner over
// another centred bold 30px banner is exactly the collision test/render.mjs
// exists to catch — so the choice is made here, once, and the client draws
// whatever comes back. Both cannot draw at the same time because there is only
// ever one answer.
//
// UI geometry is a rule (CLAUDE.md, rule one): the slot's three baselines come
// out of `slot()` and the client both places the banner and is measured against
// it there. The numbers in it are the shear warning's own, unchanged, so the
// block a pilot already knows does not move by a pixel.

import { ANCHORS } from './balance.js';
import { FIRE_RATE } from './ships.js';

// --- how close is close to death ----------------------------------------------
//
// NOT a share of the hull. A flat percentage is a claim that a Bulwark at 10% and
// a Kestrel at 40% are in the same trouble, and measured against this game's own
// numbers that claim is false in both directions:
//
//   bare hulls           Hauler 650 hull   Kestrel 700   Vanguard 1100   Bulwark 1900
//   finished hulls       19,136            20,608        32,384          55,936
//   what shoots at you   Drifter 50 dps ... Bandit 195 ... Antiphon 711
//
// so a finished Bulwark's hull is 78 seconds of the worst gun in the game and a
// new Hauler's is 13 seconds of the weakest. There is no percentage that is the
// same moment for both.
//
// Nor is it MODELLED incoming fire, and that was the first thing tried. Both of
// the models this codebase already has blow up at the top of the climb:
//
//   ANCHORS.pressure x ehp   the on-model hostile. A finished Bulwark's 429,056
//                            effective hp says 19,307 dps is coming, which eats a
//                            full hull in 2.9s — the alarm would be on from the
//                            moment you undocked. balance.js says why in as many
//                            words: content dps has not kept up, so the model and
//                            the bestiary are a factor of 27 apart.
//   your own gun             the mirror match. Same shape, worse: a finished
//                            Kestrel's hull is 1.56s of its own guns, so one
//                            exchange is 267% of the hull it is meant to measure.
//
// So it is MEASURED instead (rule two). The client already gets its own hull at
// 30Hz; how fast that number is falling is the honest incoming dps, whatever is
// doing it — a hostile, another pilot, shear, a burning ring — and it needs no
// model of the thing at the other end.
//
// The horizon is ANCHORS.trade, 4.1667 seconds, and it is not picked either: it
// is the duration the shop prices offence and defence as equal over, which
// balance.js calls "roughly one exchange". The alarm therefore says one thing —
// AT THIS RATE YOU HAVE LESS THAN ONE EXCHANGE OF HULL LEFT — and it says it at
// the same moment in every ship in the game.
//
// Sanity, at the anchor: a Hauler's 650 hull against the Drifter's 50 dps fires
// at 208 points, 32% of the hull. The pressure model says 31.7% for the same
// pilot. Two derivations that disagree everywhere else agree at the anchor, which
// is what an anchor is for.
export const HORIZON = ANCHORS.trade;        // 4.1667s — one exchange, looking forward
export const WINDOW  = ANCHORS.trade;        // and the same exchange, looking back
export const SHOT    = 1 / FIRE_RATE;        // 0.8333s — one shot interval

// --- hull only, deliberately ---------------------------------------------------
//
// Shields come back and hull does not, and a warning that fires every time your
// shields drop is a warning nobody reads — on a finished ship the shields are 85%
// of the pool, so a pool-wide alarm would be a shield alarm wearing a hat.
// applyDamage() puts everything on the shields first, so hull falling already
// means the shields are gone: the trigger does not have to check for it.

// The state the client hands back in every frame. `max` is the hull the ship has
// when whole, and it is watched: a refit, a hull swap, a respawn or a repair kit
// all move it, and without this the jump reads as one enormous instant of damage.
export const newTrack = () => ({ hull: null, max: 0, lost: 0, quiet: 1e9, on: false, since: 0 });

// One frame of hull history. An exponentially weighted average with a time
// constant of WINDOW: fed a steady r points a second it settles at exactly r, and
// it empties on its own once nothing is shooting. A ring of samples would say the
// same thing with a buffer to keep.
//
// The alternative — dividing by the time since the first hit — reads a single
// heavy shot as an infinite rate and screams at one hit. Averaging over one
// exchange costs a little lag at the very start of a burst (against fire that
// kills you from full in 3.3s it fires 1.3s out rather than 4.2s) and buys back
// the flicker of a rate that rises and falls between shots at FIRE_RATE.
export function trackHull(T, hull, max, dt) {
  if (!(max > 0)) return Object.assign(T, newTrack());
  if (Math.abs(max - T.max) > 1e-6 || T.hull === null) {
    // A different ship, or the first frame of this one. Nothing is known yet.
    T.max = max; T.hull = hull; T.lost = 0; T.quiet = 1e9;
    return T;
  }
  const step = Math.max(0, Math.min(1, dt));   // a tab in the background is not a fight
  const drop = Math.max(0, T.hull - hull);
  T.lost = T.lost * Math.exp(-step / WINDOW) + drop;
  T.quiet = drop > 0 ? 0 : T.quiet + step;     // seconds since the hull last moved down
  T.hull = hull;
  return T;
}

// Points of hull a second, as measured. Zero when nothing has hit you lately,
// which is the whole reason a pilot coasting home on 4% hull is not shouted at:
// they are damaged, not dying, and the hull bar already goes red under a third.
//
// The floor is the WIRE's own resolution, not a tuned number: the server packs
// hull as `Math.round(100 * hp / hull)`, so a change smaller than one point in a
// hundred does not exist as far as the client is concerned and an average built
// out of one cannot either. Without it the exponential tail keeps a whisper of a
// rate alive for minutes, and a ship sitting on its last few points of hull would
// re-light the alarm long after the fight it lost. It empties ~14s after the last
// hit at the anchor instead.
//
// And a rate is a forecast, so it expires. An exponential average with a 4.17s
// time constant is still reading a third of the fight's rate ten seconds after
// the fight — measured live: a Hauler shot down to 15% of its hull was still
// being told it had 0.4 seconds left six seconds after the last shot landed,
// with nothing on screen shooting at it. WINDOW since the hull last moved is the
// honest cut-off: one exchange with no hit at all is not a fight any more, and it
// makes the warning clear in a fixed 4.17s rather than a vague twenty.
export const FLOOR = 0.01;                   // one wire step of the hull
export const hullRate = T =>
  (T.lost > T.max * FLOOR && T.quiet < WINDOW ? T.lost / WINDOW : 0);

// How long the hull lasts at that rate. Infinity when nothing is happening.
export const hullSeconds = (T, hull) => {
  const r = hullRate(T);
  return r > 0 ? Math.max(0, hull) / r : Infinity;
};

// Is the alarm up? `now` is the frame timestamp in ms, not performance.now() —
// the render harness drives frames off a clock it owns and a warning timed
// against the wall clock would never advance under test (CLAUDE.md, rule three).
//
// Once lit it holds for SHOT, one shot interval. A warning shorter than the gap
// between the shots it is warning about is a flicker, and the rate legitimately
// dips between hits.
//
// `hull >= 0`, not `> 0`. The wire rounds hull to whole percent, so the last
// fraction of a Bulwark's 1,900 points arrives as a flat 0 while the ship is
// still alive and still being shot — guarding on `> 0` switched the warning OFF
// for the final tenth of a second before the wreck, which is the one moment it
// has any business being on. Zero points with a measured rate is zero seconds
// left; zero points with no rate at all is simply no data, and hullSeconds
// answers Infinity for that on its own.
export function critical(T, { hull, max, now, dead = false }) {
  if (dead || !(max > 0) || !(hull >= 0)) { T.on = false; return null; }
  const secs = hullSeconds(T, hull);
  if (secs < HORIZON) { if (!T.on) { T.on = true; T.since = now; } }
  else if (!(T.on && now - T.since < SHOT * 1000)) { T.on = false; return null; }
  const held = Math.min(secs, HORIZON);
  return {
    secs: held,
    frac: hull / max,
    // 0 the instant it lights, 1 at the moment of death. Everything the client
    // draws is scaled by this, which is what stops it becoming wallpaper: to be
    // loud it has to be nearly over, and a long fight spends most of its time at
    // the quiet end and rising.
    urgency: Math.max(0, Math.min(1, 1 - held / HORIZON)),
    // A short flare on arrival so the change is noticed, over one shot interval
    // — long enough to see, too short to sit there.
    onset: Math.max(0, Math.min(1, 1 - (now - T.since) / (SHOT * 1000))),
  };
}

// --- the slot ------------------------------------------------------------------
//
// The shear warning's own geometry, lifted whole: a bold 30px head at 22% of the
// window height, a 15px line 28px under it and a 13px line 24px under that. It is
// here rather than in index.html because the render harness measures a centred
// banner against every other centred string in the game — the notice, the mission
// bar, the SPACE prompt — and it can only measure one source.
export const HEAD_PX = 30, SUB_PX = 15, FOOT_PX = 13, TOP = 0.22;
export const slot = (W, H) => ({
  cx: W / 2,
  head: { y: H * TOP,      size: HEAD_PX },
  sub:  { y: H * TOP + 28, size: SUB_PX },
  foot: { y: H * TOP + 52, size: FOOT_PX },
});

// --- who gets it ---------------------------------------------------------------
//
// The hull wins. Both warnings are about the same red bar going down, but shear
// is a CAUSE and a critical hull is a STATE: one of them is telling you what is
// happening to you and the other is telling you how long you have, and how long
// you have is the one that decides whether you finish the fight or leave now.
//
// Nothing is lost when they are both true. The shear line moves up into the
// critical block's foot, so a pilot dying in the margin still reads COME ABOUT —
// which is both the cause and the cure — and the distance is still on screen.
// Below that, the shear block is exactly the three strings it has always been.
export function banner({ crit = null, shear = null } = {}) {
  if (crit) return {
    kind: 'hull',
    head: '⚠  CRITICAL DAMAGE  ⚠',
    sub:  `HULL ${Math.max(1, Math.round(crit.frac * 100))}% — ${crit.secs.toFixed(1)}s AT THIS RATE`,
    foot: shear ? `${shear.depth | 0}m OUTSIDE CHARTED SPACE — COME ABOUT`
                : 'BREAK OFF OR DOCK',
    urgency: crit.urgency, onset: crit.onset,
  };
  if (shear) return {
    kind: 'shear',
    head: '⚠  BEACON LATTICE LOST  ⚠',
    sub:  `UNCOMPENSATED HULL SHEAR — ${shear.dps | 0}/s`,
    foot: `${shear.depth | 0}m OUTSIDE CHARTED SPACE — COME ABOUT`,
    urgency: Math.max(0, Math.min(1, shear.t ?? 0)), onset: 0,
  };
  return null;
}

// --- the wash ------------------------------------------------------------------
//
// Both are a radial gradient from transparent at the middle to the same
// rgba(150,12,24) at the edge, because that is the colour this game already
// means "you are dying" in. What tells them apart is the SHAPE and what it does:
//
//   shear     a steady mid-screen ring, 28%..78% of the window height. It does
//             not move; the strobe is in the text.
//   hull      an iris at the very edge of the screen that closes as you run out
//             of time, and the whole thing beats rather than just the words.
//             At the moment it lights it is a rim you notice; by the last second
//             it has swallowed the screen.
//
// A pilot who is both dying and outside charted space sees the iris, which is the
// louder of the two and the one that is about the next four seconds.
export function wash(kind, urgency = 0, beat = 1) {
  const u = Math.max(0, Math.min(1, urgency)), b = Math.max(0, Math.min(1, beat));
  if (kind === 'shear') return { inner: 0.28, outer: 0.78, alpha: 0.20 + u * 0.5 };
  // 0.62 down to about 0.14 of the window height: a thin rim at the horizon, most
  // of the screen at the end. The beat moves the hole as well as the colour, which
  // is the part shear does not do.
  return { inner: (0.62 - u * 0.46) * (1 - 0.10 * b * u),
           outer: 0.98,
           alpha: (0.10 + u * 0.42) * (0.55 + 0.45 * b) };
}

// The beat, in the frame's own clock — `now` is the timestamp the frame is handed
// and never performance.now(), or it never advances under the render harness.
//
// Shear's is untouched: the strobe it has always had, tightening from 942ms to
// 440ms as you go further out. The hull's is slow and SHALLOW at the horizon and
// fast and hard at the end, because the pulse is the countdown rather than
// decoration — it cannot sit at full strobe for thirty seconds without you having
// been one second from dead for thirty seconds.
export function beatAt(now, urgency = 0, kind = 'hull') {
  const u = Math.max(0, Math.min(1, urgency));
  if (kind === 'shear') return 0.5 + 0.5 * Math.abs(Math.sin(now / (150 - u * 80)));
  const amp = 0.22 + 0.68 * u;                 // how much of the swing is used
  const ms  = 900 - 620 * u;                   // 900ms at the horizon, 280ms at the end
  return Math.max(0, Math.min(1, 1 - amp + amp * (0.5 + 0.5 * Math.sin(now / (ms / (2 * Math.PI))))));
}
