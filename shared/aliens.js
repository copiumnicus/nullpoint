// PvE hostiles.
//
// An alien reuses the ship body wholesale — same step(), same vitals, same damage
// and the same shear outside charted space. Only the intent differs, and that is
// all this file decides.

import { ATTRS } from './ships.js';
import { MAP_W, MAP_H } from './maps.js';
import { newBody, inHaven } from './sim.js';

export const ALIENS = {
  drifter: {
    name: 'Drifter', cls: 'Husk', r: 15, colour: '#b06adf',
    // The first thing you meet, and it is meant to end up beneath you. 650
    // effective hp is set from the top down: a fully outfitted Fighter throws 683
    // in one volley, so once you have actually finished a ship these die in a
    // single trigger pull. A starter Hauler still needs ~9s of unbroken fire and
    // gives up a third of its hull doing it, so the same husk is a real fight on
    // day one and a speed bump by the time you leave the home map.
    //
    // Its weapon reaches 520 against your 620-820, so speed and range are a real
    // answer — kiting works, standing still does not. Speed sits just above the
    // heaviest hull so a Cruiser cannot simply walk away, and no higher: a faster
    // one was miserable to click on.
    attrs: { hull: 450, shield: 200, shieldRegen: 45, shieldDelay: 4,
             speed: 260, accel: 900, signature: 4,
             damage: 45, fireRate: 1.1, weaponRange: 520 },
    // Deliberately just inside SIGHT_R, so it is on your screen before it decides
    // to engage and you have room to turn away. Leash is short to match: a fight
    // you can see coming is a fight you should be able to decline.
    aggro: 420,       // picks a fight inside this
    leash: 1600,      // beyond this it starts losing interest
    patience: 3.0,    // s outside leash before it gives up and forgets you
    flee: 0.10,       // turns and runs at this fraction of hull
    respawn: 14,      // s
    // 455 — see BOUNTY_RATE. At 140 a Kestrel was 129 kills away and a finished
    // ship 2664, which is the grind this game exists not to have.
    bounty: 455,      // credits your company pays for the kill
    xp: 140,          // and what the kill is worth toward your rank
  },

  // A raider that you mostly cannot see. Its signature is shaped rather than
  // sized: nose-on it returns almost nothing, from the beam it comes and goes,
  // and from behind it is just a ship. The catch is that a Bandit engaging you
  // turns to face you, and facing you is its quietest aspect — so the way to see
  // one is to get off its nose, which means out-turning something faster than
  // you. See shared/stealth.js.
  //
  // Tougher and quicker than a Drifter and hits harder, but it will not stand and
  // trade: it breaks off early, and while it runs you can see it perfectly.
  bandit: {
    name: 'Bandit', cls: 'Raider', r: 13, colour: '#5fd0ff', stealth: true,
    attrs: { hull: 800, shield: 400, shieldRegen: 55, shieldDelay: 5,
             speed: 330, accel: 1500, signature: 2,
             damage: 95, fireRate: 1.3, weaponRange: 600 },
    aggro: 520,       // it picks the fight, and from further out than you can see it
    leash: 1900,
    patience: 4.0,
    flee: 0.25,       // runs early, and is plainly visible doing it
    respawn: 22,
    bounty: 840,      // 1200 ehp at BOUNTY_RATE
    xp: 300,
  },

  // Range furniture, not a hostile. It has no weapon, does not chase and does not
  // flee, and carries enough hull that a finished ship cannot delete it before you
  // have read a number off it. Never seeded outside the testing ground.
  bulkhead: {
    name: 'Bulkhead Target', cls: 'Hulk', r: 26, colour: '#7f8ea3', dev: true,
    attrs: { hull: 400000, shield: 40000, shieldRegen: 0, shieldDelay: 9e9,
             speed: 40, accel: 100, signature: 6,
             damage: 0, fireRate: 0.1, weaponRange: 0 },
    aggro: 0, leash: 0, patience: 1, flee: 0, respawn: 3, bounty: 0, xp: 0,
  },
};

// What a kill pays, as a fraction of what it took to kill. Deriving it means a
// tougher thing further out pays proportionally more without anyone remembering
// to tune it, and it keeps the one number that matters honest: the credits a
// fight returns against the ammunition it burns.
export const BOUNTY_RATE = 0.70;
export const effectiveHp = kind => ALIENS[kind].attrs.hull + ALIENS[kind].attrs.shield;
export const bountyFor = kind => Math.round(effectiveHp(kind) * BOUNTY_RATE);

export const ALIENS_PER_MAP = 7;
// What the galaxy proper is allowed to spawn. Range furniture is not in it.
export const WILD = Object.keys(ALIENS).filter(k => !ALIENS[k].dev);
const LOSE_INTEREST = 'patience';

// Seeded so a server restart replays identically and tests can assert on roaming.
export const rng = seed => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

export function alienStats(kind) {
  const out = {};
  for (const [k, a] of Object.entries(ATTRS)) out[k] = ALIENS[kind].attrs[k] ?? a.dflt;
  return out;
}

// Somewhere to drift to: inside charted space, and never through a base ring.
export function roamPoint(map, rand) {
  for (let i = 0; i < 40; i++) {
    const x = 700 + rand() * (MAP_W - 1400), y = 700 + rand() * (MAP_H - 1400);
    if (map.base && Math.hypot(map.base.x - x, map.base.y - y) < map.base.r + 800) continue;
    return { x, y };
  }
  return { x: 1200, y: 1200 };
}

// A post pins an alien to a slot: it spawns there, returns there when idle, and
// respawns there. That is what turns a scatter of hostiles into a firing line.
export function newAlien(kind, id, map, seed, post = null) {
  const def = ALIENS[kind];
  const rand = rng(seed);
  const at = post ?? roamPoint(map, rand);
  const a = newBody(at.x, at.y, alienStats(kind), def.r);
  return Object.assign(a, {
    id, kind, def, rand, isAlien: true, post,
    target: null, provoked: new Set(), lost: 0, dead: 0, way: post ?? roamPoint(map, rand),
  });
}

// Dying settles every grudge. Without this an alien that killed you is still
// provoked when you come back, and provocation overrides sanctuary — so it would
// follow you into your own base ring the moment you respawned.
export function forgetPlayer(list, id) {
  for (const a of list) {
    a.provoked.delete(id);
    if (a.target === id) { a.target = null; a.lost = 0; }
  }
}

// A hostile that got away and has been left alone long enough patches itself up.
// Without this a wreck that escaped once wanders at a tenth of its hull forever,
// free salvage for whoever finds it next.
export const REPAIR_RATE = 0.04;    // of max hull per second
export const REPAIR_QUIET = 8;      // s of not being shot at before it starts

export function stepAlienRepair(a, dt) {
  if (a.target !== null || a.sinceHit < REPAIR_QUIET || a.hp >= a.stats.hull) return;
  a.hp = Math.min(a.stats.hull, a.hp + a.stats.hull * REPAIR_RATE * dt);
}

export function respawnAlien(a, map) {
  const at = a.post ?? roamPoint(map, a.rand);
  a.x = at.x; a.y = at.y; a.vx = a.vy = 0;
  a.hp = a.stats.hull; a.shield = a.stats.shield;
  a.sinceHit = 1e9; a.shieldHit = 0; a.cool = 0; a.shotFlash = 0;
  a.target = null; a.provoked.clear(); a.lost = 0; a.dead = 0;
  a.way = a.post ?? roamPoint(map, a.rand);
  a.tx = a.ty = a.dx = a.dy = null;
}

// contenders: [{ id, ship, haven }]. Returns the id it intends to shoot, or null.
export function stepAlienAI(a, map, contenders, dt) {
  const at = id => contenders.find(c => c.id === id);
  const alive = c => c && c.ship.hp > 0;
  const dist = c => Math.hypot(c.ship.x - a.x, c.ship.y - a.y);

  let t = alive(at(a.target)) ? at(a.target) : null;
  if (t) {
    const angry = a.provoked.has(t.id);
    // Sanctuary only holds for someone who has not shot at it. Once provoked it
    // will follow you into a base ring or a portal mouth and keep firing.
    if (t.haven && !angry) t = null;
    else if (dist(t) > a.def.leash) {
      a.lost += dt;
      // Outrunning it is a real escape: it forgets the grudge along with the target.
      if (a.lost > a.def[LOSE_INTEREST]) { a.provoked.delete(t.id); t = null; }
    } else a.lost = 0;
  }
  if (!t) { a.target = null; a.lost = 0; }

  if (!a.target) {
    let best = null, bestD = Infinity;
    for (const c of contenders) {
      if (!alive(c)) continue;
      const angry = a.provoked.has(c.id), d = dist(c);
      if (angry ? d > a.def.leash : (c.haven || d > a.def.aggro)) continue;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { a.target = best.id; t = best; a.lost = 0; }
  }

  if (t) {
    // Badly hurt, it stops fighting and runs — still tracked, still shootable,
    // but it will not trade any more. Running is clamped inside charted space so
    // it does not simply kill itself on the shear.
    if (a.hp <= a.stats.hull * a.def.flee) {
      const dx = a.x - t.ship.x, dy = a.y - t.ship.y, m = Math.hypot(dx, dy) || 1;
      a.dx = a.dy = null;
      a.tx = Math.max(500, Math.min(MAP_W - 500, a.x + (dx / m) * 2200));
      a.ty = Math.max(500, Math.min(MAP_H - 500, a.y + (dy / m) * 2200));
      return null;                                           // fleeing, not firing
    }
    const d = dist(t), hold = a.stats.weaponRange * 0.7;
    a.dx = a.dy = null;
    if (d > hold) { a.tx = t.ship.x; a.ty = t.ship.y; }     // close
    else           { a.tx = a.ty = null; }                   // hold station and shoot
    return t.id;
  }

  // Idle. One with a post walks back to it and holds there, so a firing line
  // stays a firing line. Everything else drifts between waypoints — and picking
  // waypoints outside the base is not enough, since the straight line between two
  // of them will cut through the ring, so the course itself is steered around.
  if (a.post) {
    a.dx = a.dy = null;
    const off = Math.hypot(a.post.x - a.x, a.post.y - a.y);
    a.tx = off < 40 ? null : a.post.x;
    a.ty = off < 40 ? null : a.post.y;
    return null;
  }
  if (Math.hypot(a.way.x - a.x, a.way.y - a.y) < 220) a.way = roamPoint(map, a.rand);
  a.dx = a.dy = null;
  const aim = skirtBase(a, a.way, map);
  a.tx = aim.x; a.ty = aim.y;
  return null;
}

// Keeps an idle alien outside the base ring: shoves it straight out if it has
// somehow got inside, and otherwise aims past the ring's flank when the direct
// course to its waypoint would clip it.
export const BASE_STANDOFF = 380;
export function skirtBase(a, want, map) {
  const b = map.base;
  if (!b) return want;
  const keep = b.r + BASE_STANDOFF;

  const cx = b.x - a.x, cy = b.y - a.y, dc = Math.hypot(cx, cy);
  if (dc < keep) {                                   // inside the standoff: leave, directly
    const ux = dc < 1 ? 1 : -cx / dc, uy = dc < 1 ? 0 : -cy / dc;
    return { x: b.x - ux * (keep + 500) * -1, y: b.y - uy * (keep + 500) * -1 };
  }

  const wx = want.x - a.x, wy = want.y - a.y, dw = Math.hypot(wx, wy);
  if (dw < 1) return want;
  const hx = wx / dw, hy = wy / dw;
  const along = hx * cx + hy * cy;                    // is the ring ahead of us at all?
  if (along <= 0 || along > dw + keep) return want;
  const side = hx * cy - hy * cx;                     // signed clearance of the course
  if (Math.abs(side) > keep) return want;

  const sgn = side >= 0 ? -1 : 1;                     // pass on the near side
  return { x: b.x + -hy * sgn * keep * 1.25, y: b.y + hx * sgn * keep * 1.25 };
}
