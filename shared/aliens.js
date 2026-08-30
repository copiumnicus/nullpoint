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
    name: 'Drifter', cls: 'Husk', r: 15, colour: '#b06adf', shape: 'kite',
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

  // Ten Drifters welded into one hull, and deliberately exactly that: 6500 ehp
  // is 10 x 650, the 4550 bounty is 10 x 455 because bounty is ehp x BOUNTY_RATE,
  // and 1400 xp is 10 x 140. One number was chosen — the multiple — and the rest
  // follow from rules already written down.
  //
  // It sits one hop out from home because that is the first place you arrive
  // having outgrown Drifters, and a husk that takes real work is the cheapest
  // possible way to say so.
  //
  // The important part is that it is NOT a bigger health bar you stand in front
  // of. Measured against the build most players have at that point — one emitter,
  // one launcher, one drone, 145 dps — trading blows with it is a loss: 45s to
  // chew through it while it returns 72 dps into 1100 hull. It is meant to teach
  // the thing the Drifter never had to. Every answer is positional, and all of
  // them are available on day one:
  //
  //   speed 190  — slower than every hull in the game, the Bulwark included at
  //                250, so you can always leave and always come back
  //   range 500  — under all four hulls (620-820), so kiting costs it everything
  //   accel 420  — ponderous, so a turn buys you distance rather than a trade
  //
  // Fight it properly and it never touches you; stand still and it removes you.
  // A pilot who has moved up to two emitters and a better rack kills it in 13s,
  // which is the progression this is here to make visible.
  ironhusk: {
    name: 'Ironhusk', cls: 'Husk', r: 26, colour: '#d0563f', shape: 'hex',
    attrs: { hull: 4500, shield: 2000, shieldRegen: 130, shieldDelay: 5,
             speed: 190, accel: 420, signature: 6,
             damage: 90, fireRate: 0.8, weaponRange: 500 },
    // Aggro inside SIGHT_R like the Drifter's, so it is on screen before it
    // decides anything. Short leash: something this slow has no business
    // following you across a sector, and being able to break off is the lesson.
    aggro: 460,
    leash: 1500,
    patience: 3.0,
    flee: 0,          // armour is its whole answer; it has nowhere to run to
    respawn: 30,
    bounty: 4550,     // 6500 ehp at BOUNTY_RATE, which is 10 x the Drifter's 455
    xp: 1400,         // likewise 10 x 140
  },

  // Ten Ironhusks, by the same arithmetic that made an Ironhusk ten Drifters:
  // 65000 ehp, a 45500 bounty because bounty is ehp x BOUNTY_RATE, and 14000 xp.
  //
  // It exists because the Ironhusk stopped needing anyone's help. So this one is
  // built so that it cannot be soloed by patience, which is the loophole every
  // other alien in the game leaves open:
  //
  //   range 900   - longer than every hull (620-820). The first thing here you
  //                 cannot kite. Out-ranging it is not on the table; you either
  //                 stand in it or you leave.
  //   regen 900/s - and shields only come back after 3s untouched, so a lone
  //                 pilot who breaks off to survive hands back 20000 shield in
  //                 22 seconds. Break off enough to live and you never finish it.
  //
  // Those two together are the cooperation gate, and neither is a special case:
  // they are the ordinary shield timer and the ordinary weapon range, set where
  // one ship cannot hold both open at once. Two pilots can, by taking turns being
  // shot at while the other keeps the damage unbroken.
  //
  // What it does NOT do is trap you. It is slower than every hull including the
  // Bulwark at 250, so leaving always works — you just cannot leave and win.
  leviathan: {
    name: 'Leviathan', cls: 'Colossus', r: 40, colour: '#8fe04a', shape: 'crown',
    attrs: { hull: 45000, shield: 20000, shieldRegen: 900, shieldDelay: 3,
             speed: 230, accel: 380, signature: 8,
             damage: 150, fireRate: 0.8, weaponRange: 900 },
    aggro: 520,
    leash: 2200,
    patience: 4.0,
    flee: 0,
    respawn: 90,
    bounty: 45500,    // 65000 ehp at BOUNTY_RATE, and 10 x the Ironhusk's 4550
    xp: 14000,        // likewise 10 x 1400
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
    name: 'Bandit', cls: 'Raider', r: 13, colour: '#5fd0ff', shape: 'dart', stealth: true, evades: true,
    // Built to survive a finished ship for a quarter of a minute, and most of
    // that comes from not being hit rather than from soaking it: it breaks off
    // the firing line whenever a shot gets close. The hull behind that is real
    // but it is not the point.
    // Fast in a straight line and slow to change its mind — a wide-turning
    // interceptor. That is what makes the jink readable: it commits, and a
    // patient gunner can lead it. Give it fighter-grade acceleration and
    // lasers stop landing at all.
    attrs: { hull: 22000, shield: 8000, shieldRegen: 90, shieldDelay: 5,
             speed: 400, accel: 500, signature: 2,
             damage: 150, fireRate: 1.3, weaponRange: 640 },
    aggro: 520,       // it picks the fight, and from further out than you can see it
    leash: 2200,
    patience: 4.0,
    // It does not run. A Drifter flees because fleeing is the only thing that
    // saves it; a Bandit is already hard to hit and is faster than anything you
    // fly, so running would just mean out-pacing you, dropping the lock, healing
    // up out of reach and coming back. That is a treadmill, not a fight — the
    // first live duel went 100% to 11% and back up to 47% before it died. It
    // commits now, and what keeps it alive is the dodging.
    flee: 0,
    respawn: 40,
    // Measured: 3.81x, from 28% of shots landing against a husk's 75%. Rounded
    // down to 3.8 because the measurement is a simulation and the number should
    // not pretend to be more exact than the thing it came from.
    effort: 3.8,
    bounty: 79800,    // 30000 ehp x 3.8 effort at BOUNTY_RATE
    xp: 24554,        // and the same effective hp at XP_RATE
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
// What a kill is worth is derived from how much work it is, and hit points are
// only half of that. A Bandit has 30000 of them and pays the same rate as an
// Ironhusk per point — but measured with one ship against both, only 28% of what
// is fired at a Bandit ever lands against 75% on a husk, so it takes 39.9s to the
// husk's 2.3s. That was 526 credits a second against 1978: a quarter of the pay
// for the hardest fight in the sector, which is why nobody farmed it.
//
// `effort` is that multiplier, measured rather than guessed: what a thing's hit
// points are actually worth once dodging and camouflage are counted. 1 for
// anything that stands and trades. The rates below then apply to effective hit
// points x effort, so nothing needs a hand-set bounty and the next alien that
// hides gets paid correctly without anyone remembering to.
export const XP_RATE = 140 / 650;                  // the Drifter is the anchor: 140 xp for 650 ehp
export const farmHp = kind => effectiveHp(kind) * (ALIENS[kind].effort ?? 1);
export const BOUNTY_RATE = 0.70;
export const effectiveHp = kind => ALIENS[kind].attrs.hull + ALIENS[kind].attrs.shield;
// Effective hit points TIMES effort: what it costs to kill, not what it is made
// of. A thing you cannot hit is worth more than a thing you can, at the same
// toughness, and this is the one place that gets to decide it.
export const bountyFor = kind => Math.round(farmHp(kind) * BOUNTY_RATE);
export const xpFor     = kind => Math.round(farmHp(kind) * XP_RATE);

// Every hostile used to be the same arrowhead at a different size and colour, so
// an Ironhusk read as a big Drifter rather than as a different thing. The outline
// is per-alien now, declared here because the world view and the minimap both
// draw it and a shape that disagreed between the two would be worse than none.
export const SHAPES = {
  // The arrowhead everything used to be. Still the Drifter's: it is the baseline
  // and should stay the thing the others are read against.
  kite: R => [[R * 1.35, 0], [0, R], [-R * 0.8, 0], [0, -R]],
  // Six flats. Armour plate rather than a nose — it is not pointed at anything,
  // because it does not need to be.
  hex: R => Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return [Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08];
  }),
  // Long, narrow and nose-heavy. A Bandit is mostly pointed at you, and the
  // silhouette should be the reason that is hard to see.
  dart: R => [[R * 1.75, 0], [-R * 0.15, R * 0.55], [-R * 0.95, 0], [-R * 0.15, -R * 0.55]],
  // Sixteen alternating points. It does not fly so much as loom, and nothing else
  // in the game has spikes.
  crown: R => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2, rr = R * (i % 2 ? 0.62 : 1.2);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }),
};
export const outlineOf = (kind, R) => (SHAPES[ALIENS[kind]?.shape] ?? SHAPES.kite)(R);

export const ALIENS_PER_MAP = 7;
// What the galaxy proper is allowed to spawn. Range furniture is not in it.
export const WILD = Object.keys(ALIENS).filter(k => !ALIENS[k].dev);
const LOSE_INTEREST = 'patience';

// --- evasion ------------------------------------------------------------------
// Something that cannot be seen and cannot be missed is not a fight, it is a
// health bar behind a curtain. A Bandit breaks off the firing line when a shot
// is close, which does two things: most of the volley goes past it, and it has
// to turn to do it — and turning is what takes its nose off you, which is the
// only reason you get to see it at all.
//
// So the camouflage and the evasion are the same mechanic seen from two sides.
// It is quiet while it holds still and points at you; the moment it starts
// working to stay alive, it starts showing you its flank.

export const EVADE_LEAD = 0.9;    // s of flight time it reacts inside
export const EVADE_RUN  = 160;    // px it commits to — a jink, not a departure
export const WEAVE_MIN  = 0.5, WEAVE_MAX = 1.0;     // s between reversals

// Which way to break, given what is coming: perpendicular to the nearest
// threat's travel, on whichever side it is currently weaving.
//
// The side has to keep changing. Bolts are aimed where you will be, so a steady
// break is precisely what the aim already accounts for — holding one direction
// gets you hit as reliably as holding still. Reversing every third of a second
// puts it somewhere the last shot did not expect, which is the same reason
// weaving works for a player.
export function threatBreak(a, incoming) {
  let near = null, nearD = Infinity;
  for (const p of incoming) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < nearD) { nearD = d; near = p; }
  }
  if (!near) return null;
  const sp = Math.hypot(near.vx, near.vy) || 1;
  if (nearD > sp * EVADE_LEAD) return null;         // still far enough to ignore
  const ux = near.vx / sp, uy = near.vy / sp;       // where the shot is going
  const side = a.weaveSide ?? 1;
  return { x: -uy * side, y: ux * side };
}

// Sets a course away from whatever is closest to hitting it. Returns true while
// it is breaking, which is the caller's signal to stop pointing its nose at you.
// How far round it turns while breaking. Not all the way: it crabs, holding its
// nose part-way toward you while it translates sideways. Facing its own velocity
// showed you its full flank every time it jinked and the camouflage stopped
// meaning anything the moment a fight started — which is when it should matter
// most. Canted, it stays half-hidden while it works.
export const JINK_CANT = 0.5;

// The heading to fly while breaking, given where the thing it is fighting is.
export function jinkHeading(a, at) {
  const travel = Math.atan2(a.vy, a.vx);
  if (!at) return travel;
  const face = Math.atan2(at.y - a.y, at.x - a.x);
  let d = travel - face;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return face + d * JINK_CANT;
}

export function stepEvade(a, incoming, map, dt = 1 / 30) {
  if (!a.def.evades) return false;
  // The weave runs whether or not anything is inbound, so a break already has a
  // direction the moment it is needed.
  a.weaveSide ??= 1;
  a.weaveIn = (a.weaveIn ?? 0) - dt;
  if (a.weaveIn <= 0) {
    a.weaveSide = -a.weaveSide;
    a.weaveIn = WEAVE_MIN + (a.rand ? a.rand() : Math.random()) * (WEAVE_MAX - WEAVE_MIN);
  }
  const brk = threatBreak(a, incoming);
  if (!brk) { a.jinking = false; return false; }
  a.dx = a.dy = null;
  a.tx = Math.max(600, Math.min(MAP_W - 600, a.x + brk.x * EVADE_RUN));
  a.ty = Math.max(600, Math.min(MAP_H - 600, a.y + brk.y * EVADE_RUN));
  a.jinking = true;
  return true;
}

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
    dealt: new Map(),                 // playerId -> damage, since it last spawned
    crowd: null, crowdT: 0,           // who has been closing on it, and for how long
    threat: null, threatT: 0,         // and who has been out-damaging its target
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
  a.crowd = null; a.crowdT = 0; a.threat = null; a.threatT = 0;   // no grudges carried over
  a.way = a.post ?? roamPoint(map, a.rand);
  a.tx = a.ty = a.dx = a.dy = null;
}

// contenders: [{ id, ship, haven }]. Returns the id it intends to shoot, or null.
// Who an alien shoots, beyond "whoever hit me first".
//
// One rule meant one pilot could hold anything in the game forever while the rest
// of the party worked in peace, so a group fight was a solo fight with spectators.
// Two more rules, both on a hold so nothing flaps between targets frame to frame:
//
//   crowding — stay meaningfully nearer than its current target for CLOSER_HOLD
//              and it turns on you. Kiting becomes something a party rotates.
//   threat   — hurt it enough more than its current target and it turns on you.
//              It already keeps a damage ledger for paying out the bounty; this
//              is the same ledger read for the other obvious purpose.
export const CLOSER_HOLD = 3.0;   // s of being the nearest before it switches
export const CLOSER_EDGE = 0.85;  // and nearer by a margin, not merely tied
export const THREAT_HOLD = 2.0;   // s of out-damaging its target before it switches
export const THREAT_EDGE = 2.0;   // and by this multiple, so a graze does not pull it

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

  // Having a target is not the end of the question. Both challenges are timed, so
  // brushing past it does nothing and committing to crowding it does.
  if (t) {
    const eligible = c => alive(c) && c.id !== t.id
      && !(c.haven && !a.provoked.has(c.id)) && dist(c) <= a.def.leash;
    let near = null, nearD = Infinity;
    for (const c of contenders) {
      if (!eligible(c)) continue;
      const d = dist(c);
      if (d < nearD) { nearD = d; near = c; }
    }
    if (near && nearD < dist(t) * CLOSER_EDGE) {
      if (a.crowd !== near.id) { a.crowd = near.id; a.crowdT = 0; }
      a.crowdT += dt;
      if (a.crowdT >= CLOSER_HOLD) { a.target = near.id; t = near; a.lost = 0; a.crowd = null; a.crowdT = 0; }
    } else { a.crowd = null; a.crowdT = 0; }
  }
  if (t && a.dealt?.size) {
    const mine = a.dealt.get(t.id) ?? 0;
    let worst = null, worstD = 0;
    for (const c of contenders) {
      if (!alive(c) || c.id === t.id || dist(c) > a.def.leash) continue;
      const d = a.dealt.get(c.id) ?? 0;
      if (d > worstD) { worstD = d; worst = c; }
    }
    if (worst && worstD > Math.max(1, mine) * THREAT_EDGE) {
      if (a.threat !== worst.id) { a.threat = worst.id; a.threatT = 0; }
      a.threatT += dt;
      if (a.threatT >= THREAT_HOLD) { a.target = worst.id; t = worst; a.lost = 0; a.threat = null; a.threatT = 0; }
    } else { a.threat = null; a.threatT = 0; }
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
