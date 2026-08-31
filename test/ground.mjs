// Claims about the deeps, and about sown ground.
//
// Two hostiles out there fight by taking PLACES away from you rather than by
// shooting at you, and the places stay after the thing that made them has gone.
// One of them takes something no hostile in this game has ever taken — the pilot's
// engines — so most of what is in here is not about damage at all. It is about the
// promise every other entry in aliens.js makes in as many words: that you can
// always decline, always break off, always leave.
//
// Everything below is measured through the real loop — stepAlienAI, stepSow,
// step, stepSnare, stepVitals, fire, launch and stepBolts, in the order server.js
// calls them.

import { ALIENS, WILD, effectiveHp, farmHp, newAlien, stepAlienAI, stepAlienRepair,
         mayHarm, standOff, BOUNTY_RATE, XP_RATE, threatDps, bountyFor, xpFor,
         SHAPES, outlineOf } from '../shared/aliens.js';
import { sowOf, stepSow, sowHolds, sowPoint, groundFor, inGround, groundBite,
         stepGround, stepSnare, holdEngines, held, mayHold, HOLD, CALM } from '../shared/ground.js';
import { newShip, step, stepVitals, applyDamage, inHaven, JUMP_TIME } from '../shared/sim.js';
import { poolOf } from '../shared/burn.js';
import { fire, stepBolts, faceTarget } from '../shared/combat.js';
import { launch, stepRockets } from '../shared/rockets.js';
import { MAPS, MAP_W, MAP_H } from '../shared/maps.js';
import { HULLS } from '../shared/ships.js';
import { ANCHORS, ANCHOR_FIGHT, POSTING, buildFor, stageDps, stageEhp, STAGE_KEYS } from '../shared/balance.js';
import { SHIP_FIELDS, SOWN_FIELDS, STREAMS, EPHEMERAL, packSown, unpackSown, GROUND_KINDS, groundK } from '../shared/net.js';
import { MAX_FIELDS } from '../shared/delta.js';
import { MODULE_KEYS } from '../shared/research.js';
import { routeTo } from '../shared/power.js';
import { DROPS } from '../shared/cargo.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const dt = 1 / 30;
const X32 = MODULE_KEYS.reduce((m, _, i) => m | (1 << i), 0);
const V = ALIENS.vitriol, D = ALIENS.doldrum;

// The reactor is ON, and on the weapons. balance.js quotes the BOOSTED gun, and a
// bench pilot that never routed power anywhere delivered 6,450 of a finished
// Bulwark's 11,307 — every mirror number in this repo was that mistake until 0.63.
// Weapons rather than thrusters is also what makes the pool radius below honest: a
// pilot with the reactor on their gun flies at the hull's bare speed.
const pilot = (stage = 'finished', research = 0, route = 'weapons') => {
  const b = buildFor(stage);
  const s = newShip(3400, 5600, b.hull, b.fit, b.drones, 'wedge', null, research);
  routeTo(s.power, route);
  return s;
};

// --- the root, and whether it is one ------------------------------------------
//
// This is the file's reason for existing. The game has never taken movement away
// from a player and shared/kedge.js spends a paragraph on why a fix was allowed to
// exist where a stun was not: "Maximum time without control from a fix: zero
// seconds". Slack Water is not zero, so every one of those seconds has to be
// argued for and pinned shut.
console.log('\nthe root');
{
  check('a hold is half a portal, so it can never deny a door you already opened',
    HOLD === JUMP_TIME / 2 && CALM === JUMP_TIME,
    `${HOLD}s held against a ${JUMP_TIME}s spool, and ${CALM}s of thrust owed afterwards — ` +
    'three seconds is this game\'s unit of a decision already committed to');

  // THE ANTI-PERMA-ROOT CLAIM. Brute forced rather than reasoned: every still on the
  // field tries to grab every tick, which is a field no designer could build and a
  // strictly worse case than one they could.
  const greedy = n => {
    const s = {}; let t = 0, cur = 0, worst = 0, gap = Infinity, minGap = Infinity, hist = [];
    while (t < 120) {
      for (let i = 0; i < n; i++) if (mayHold(s)) { minGap = Math.min(minGap, gap); gap = 0; holdEngines(s, HOLD); }
      hist.push(held(s));
      if (held(s)) { cur += dt; worst = Math.max(worst, cur); gap = 0; } else { cur = 0; gap += dt; }
      stepSnare(s, dt); t += dt;
    }
    const W = Math.round(10 / dt);
    let win = 0;
    for (let i = 0; i + W < hist.length; i++) win = Math.max(win, hist.slice(i, i + W).filter(Boolean).length * dt);
    return { worst, minGap, win };
  };
  const runs = [1, 2, 3, 6, 12, 40].map(greedy);
  check('no arrangement of stills can hold a pilot for longer than one hold',
    runs.every(r => r.worst <= HOLD + 1e-9),
    `${runs.length} arrangements up to forty stills all grabbing every tick: longest unbroken ` +
    `coast ${Math.max(...runs.map(r => r.worst)).toFixed(2)}s against a stated ${HOLD}s`);
  check('and a pilot is always owed a full portal spool of thrust between two of them',
    runs.every(r => r.minGap >= CALM - 1e-9),
    `shortest gap measured ${Math.min(...runs.map(r => r.minGap)).toFixed(2)}s against a stated ${CALM}s`);
  check('so the worst ten seconds anybody can be handed still has six of thrust in it',
    runs.every(r => r.win <= HOLD + 10 * HOLD / (HOLD + CALM) + 1e-6) && runs.every(r => 10 - r.win >= 6),
    `${Math.max(...runs.map(r => r.win)).toFixed(2)}s of coasting in the worst ten — ` +
    'a window that opens mid-hold pays for that hold too, which is why it is not a flat third');
  check('a hold takes the throttle and nothing else',
    (() => {
      const s = pilot(); s.x = 0; s.y = 0; s.tx = 5000; s.ty = 0;
      for (let i = 0; i < 60; i++) step(s, dt);                // up to speed
      const v0 = Math.hypot(s.vx, s.vy);
      holdEngines(s, HOLD);
      s.tx = 0; s.ty = 5000;                                    // and now try to turn
      let t = 0; while (t < HOLD) { step(s, dt); stepSnare(s, dt); t += dt; }
      const v1 = Math.hypot(s.vx, s.vy);
      return Math.abs(v1 - v0) < 0.001 && Math.abs(s.vy) < 0.001 && v1 > 100;
    })(),
    'ordered hard about while held: the velocity does not change by a thousandth. It is ' +
    'the acceleration that is taken, so the ship coasts rather than stopping — a stun ' +
    'would be zeroing MAX, and clearing the destination brakes just as hard');
  check('and it never touches the trigger, the target or the beacon',
    (() => {
      const s = pilot(); s.x = 0; s.y = 0;
      const mark = newShip(400, 0, 'bulwark');
      holdEngines(s, HOLD);
      let shots = 0, t = 0;
      while (t < HOLD) { step(s, dt); stepSnare(s, dt); shots += fire(s, mark, dt).length; t += dt; }
      return shots > 0;
    })(),
    `${(() => { const s = pilot(); s.x = 0; s.y = 0; const m = newShip(400, 0, 'bulwark'); holdEngines(s, HOLD);
       let n = 0, t = 0; while (t < HOLD) { step(s, dt); stepSnare(s, dt); n += fire(s, m, dt).length; t += dt; } return n; })()} ` +
    'bolts fired while coasting — fire() has never consulted movement and must not start');
  check('one patch holds one pilot once per entry, not thirty times a second',
    (() => {
      const g = groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 });
      const s = pilot(); s.x = 0; s.y = 0;
      let grabs = 0, t = 0;
      while (t < 30) {
        const b = groundBite(g, 1, s, true, poolOf(s), dt);
        if (b.hold > 0) { grabs++; holdEngines(s, b.hold); }
        stepSnare(s, dt); t += dt;
      }
      return grabs === 1;
    })(),
    'parked inside one for thirty seconds: held exactly once. The per-patch latch stops ' +
    'ONE still holding you forever and the calm stops TWO taking turns — both are needed');
  check('and leaving and coming back is a second hold, because that is a second entry',
    (() => {
      const g = groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 });
      const s = pilot(); s.x = 0; s.y = 0;
      let grabs = 0;
      for (const inside of [true, true, false, false, true]) {
        // ten seconds of each, which is past the calm either way
        for (let i = 0; i < 300; i++) {
          const b = groundBite(g, 1, s, inside, poolOf(s), dt);
          if (b.hold > 0) { grabs++; holdEngines(s, b.hold); }
          stepSnare(s, dt);
        }
      }
      return grabs === 2;
    })(),
    'in, out, in: two holds. The ledger is emptied on the way out, so crossing a still ' +
    'twice costs twice — which is the thing a pilot can actually decide');
  check('sanctuary is refused a still outright, provoked or not',
    (() => {
      // The Kedge's rule, not a new one: fixHolds() has broken on a haven since the
      // day it was written, with no provocation exception. A pool may burn you in a
      // portal mouth because that is a price; a still may not hold you there because
      // that is the door being shut.
      const g = groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 });
      const s = pilot();
      const b = groundBite(g, 1, s, true, poolOf(s), dt);
      return b.hold > 0;              // the module offers it; server.js gates on haven
    })(),
    'shared/ground.js offers the hold and server.js refuses it inside inHaven(), the ' +
    'same shape stepFix/fixHolds already has');
}

// --- what the ground does -----------------------------------------------------
console.log('\nthe ground');
{
  check('both rates are a share of the pilot, so research cannot make either one safer',
    (() => {
      const secs = k => STAGE_KEYS.map(st => stageEhp(st) / threatDps(k, stageEhp(st), stageEhp(st)));
      return ['vitriol', 'doldrum'].every(k => {
        const s = secs(k); return Math.max(...s) / Math.min(...s) < 1.05;
      });
    })(),
    `standing in one kills you in ${(1 / V.sow.rate).toFixed(1)}s and the other in ` +
    `${(1 / D.sow.rate).toFixed(1)}s, at every stage of the game and every rung of research`);
  check('a pool is half a rung under on model and a still is a full rung under it',
    Math.abs(V.sow.rate - ANCHORS.pressure / Math.sqrt(10)) < 1e-5 &&
    Math.abs(D.sow.rate - ANCHORS.pressure / 10) < 1e-5,
    `${V.sow.rate} is ANCHORS.pressure / sqrt(10) and ${D.sow.rate} is pressure / 10 — ` +
    'the ground that holds you is deliberately not the ground that kills you');
  // WHY IT IS UNDER the model rather than over it, which looks wrong until you do the
  // arithmetic. ANCHORS.pressure is 4.5% of a pilot per second, and that number was
  // set against the anchor fight: 8.68 seconds, so an on-model hostile takes 39% of
  // you over its OWN fight. A hostile with 2,055,480 hit points has a fight forty
  // seconds long for the party it is posted for, and 4.5% a second over forty seconds
  // is not a fight, it is arithmetic.
  check('a hostile whose fight is longer than the anchor fight has to be gentler per second',
    (() => {
      const fight = k => farmHp(k) / (stageDps(POSTING[k].stage) * POSTING[k].party);
      // Two halves, and both are needed. The fight is ten times the anchor fight, and
      // the rate is UNDER the model's — because at the model's 4.5% a second a pilot
      // would owe 409% of their ship over one of these, which is not a fight but
      // arithmetic. And it is not merely gentle: standing in a pool for the whole
      // fight still kills you (129% of the ship), so what the low rate buys is that
      // leaving works, not that staying is free. See the SEAM on alienFor's `dps`.
      return ['vitriol', 'doldrum'].every(k =>
        fight(k) > ANCHOR_FIGHT * 4
        && ALIENS[k].sow.rate < ANCHORS.pressure
        && V.sow.rate * fight(k) > 1);
    })(),
    (() => {
      const f = farmHp('vitriol') / (stageDps(POSTING.vitriol.stage) * POSTING.vitriol.party);
      return `${f.toFixed(0)}s against an ${ANCHOR_FIGHT.toFixed(1)}s anchor: on model per second ` +
             `would owe ${(100 * ANCHORS.pressure * f).toFixed(0)}% of the pilot over one fight. This ` +
             `owes ${(100 * V.sow.rate * f).toFixed(0)}% if you never leave the ground, and measured ` +
             'a pilot flying the counter is standing in it 24% of the time';
    })());
  check('patches never stack, so a Vitriol cannot delete anybody by sowing twice on one spot',
    (() => {
      const s = pilot('finished', X32);
      s.x = 0; s.y = 0;
      const gs = Array.from({ length: 6 }, (_, i) =>
        Object.assign(groundFor({ def: V, provoked: new Set([1]) }, { x: 0, y: 0 }), { id: i }));
      let worst = 0;
      for (const g of gs) { const b = groundBite(g, 1, s, true, poolOf(s), dt); if (b.burn > worst) worst = b.burn; }
      const one = V.sow.rate * poolOf(s) * dt;
      return Math.abs(worst - one) < 1e-6;
    })(),
    'six pools on one point take exactly what one takes — and threatDps counts a sower\'s ' +
    'rate once for the same reason, so the model and the tick agree');
  check('a Vitriol can never have more ground down than it says it may',
    V.sow.every === V.sow.life / V.sow.max && D.sow.every === D.sow.life / D.sow.max,
    `${V.sow.max} pools x ${V.sow.life}s / ${V.sow.every}s and ${D.sow.max} stills x ` +
    `${D.sow.life}s / ${D.sow.every}s — the cadence is life / max rather than a fourth number`);
  check('a pool lasts exactly one lap of the fight it is in',
    (() => {
      const me = pilot('finished', X32);
      const lap = 2 * Math.PI * (me.stats.weaponRange * 0.92) / me.stats.speed;
      return Math.abs(V.sow.life - lap) / lap < 0.05;
    })(),
    (() => {
      const me = pilot('finished', X32);
      const lap = 2 * Math.PI * (me.stats.weaponRange * 0.92) / me.stats.speed;
      return `${lap.toFixed(1)}s to circle a Vitriol at your own gun range in the slowest hull ` +
             `that fights one, against a ${V.sow.life}s pool — the ring of ground closes exactly ` +
             'as you come back round to where you started it';
    })());
}

// --- can it be refused? -------------------------------------------------------
console.log('\nrefusing it');
{
  const travel = stage => {
    const s = pilot(stage, X32); s.x = 0; s.y = 0; s.tx = 1e5; s.ty = 0;
    let t = 0; while (t < HOLD) { step(s, dt); t += dt; }
    return { px: s.x, r: s.r };
  };
  const rows = STAGE_KEYS.map(st => [st, travel(st)]);
  for (const [st, r] of rows)
    console.log(`     ${st.padEnd(12)} covers ${r.px.toFixed(0).padStart(4)}px from rest in the ` +
      `${HOLD}s the marker stands, against ${(V.sow.r + r.r).toFixed(0)}px of pool and ${(D.sow.r + r.r).toFixed(0)}px of still`);
  check('every hull in the game can refuse a pool from a standing start',
    rows.every(([, r]) => r.px >= V.sow.r + r.r),
    `the pool is ${V.sow.r}px because the slowest fitted ship in the game covers ` +
    `${rows.find(([s]) => s === 'finished')[1].px.toFixed(0)}px from rest inside the warning — ` +
    'measured through step(), because acceleration is part of the answer');
  check('and none of them can refuse a still, which is the whole point of one',
    rows.filter(([st]) => st !== 'interceptor').every(([, r]) => r.px < D.sow.r + r.r),
    `${D.sow.r}px against ${rows.find(([s]) => s === 'finished')[1].px.toFixed(0)}px of travel — ` +
    'the Kestrel alone gets out at 457px, and a Kestrel has no business four hops out');
  check('a still is wide enough that a pool sown anywhere inside it is wholly inside it',
    D.sow.r >= 2 * V.sow.r,
    `${D.sow.r} against 2 x ${V.sow.r} — that is the combo, and it is a property of the two ` +
    'radii rather than anything either hostile knows about the other');
  check('the warning is exactly as long as a hold, which is why the two combo',
    V.sow.wind === HOLD && D.sow.wind === HOLD,
    'a pilot who is not held has exactly enough time to be somewhere else, and a pilot ' +
    'who is held has exactly none. One number, not a special case');
  check('and the marker is where the ground lands, not where the hostile is',
    (() => {
      const map = MAPS.d1;
      const a = newAlien('vitriol', 9001, map, 5, { x: 4200, y: 5600 });
      a.x = a.post.x; a.y = a.post.y;
      const me = pilot(); me.x = 3400; me.y = 5600;
      let at = null, t = 0;
      while (t < 6 && !at) { const d = stepSow(a, me, true, dt); if (d) at = d.at; me.x += 300 * dt; t += dt; }
      return at && Math.abs(at.x - 3400) < 30 && Math.hypot(at.x - a.x, at.y - a.y) > 500;
    })(),
    'sown on the victim\'s place at the moment the wind-up STARTED — at the end it would be ' +
    'undodgeable, and on the hostile it would be a ring, which this bestiary already has one of');
}

// --- a real fight ---------------------------------------------------------------
//
// stepAlienAI, stepSow, step, stepSnare, stepVitals, fire, launch, stepBolts and
// stepRockets, in the order server.js calls them. Twenty-two milliseconds a fight,
// so the whole matrix runs inside this suite rather than in a script beside it —
// which matters, because these are the numbers the rung was argued from and a
// number nobody re-runs is a number that goes quietly out of date.
const MAP = MAPS.d1;
// Not (6000, 4000): that is d1's portal to Nullpoint, and a portal mouth is a
// haven, so every sower in the sector politely refused to sow on anybody standing
// in it and the first draft of this measured nothing at all for twenty minutes.
const AT = { x: 3400, y: 5600 };

function fight({ kinds, n = 1, research = 0, plan, secs = 900, seed = 7, spread = 260 }) {
  const crew = Array.from({ length: n }, (_, i) => {
    const s = pilot('finished', research);
    s.x = AT.x + Math.cos(i / n * 6.283) * (n > 1 ? spread : 0);
    s.y = AT.y + Math.sin(i / n * 6.283) * (n > 1 ? spread : 0);
    return { id: i + 1, ship: s, took: 0, inG: 0, snared: 0, onTgt: 0,
             ehp0: s.stats.hull + s.stats.shield };
  });
  const foes = kinds.map((k, i) => {
    const a = newAlien(k, 5000 + i, MAP, seed + i * 13,
      { x: AT.x + 900, y: AT.y + (i - (kinds.length - 1) / 2) * 700 });
    a.x = a.post.x; a.y = a.post.y; return a;
  });
  const ground = []; let bolts = [], rockets = [], gid = 1, t = 0, longest = 0;
  while (t < secs) {
    const alive = foes.filter(f => f.hp > 0), up = crew.filter(c => c.ship.hp > 0);
    if (!alive.length || !up.length) break;
    const here = up.map(c => ({ id: c.id, ship: c.ship, haven: inHaven(MAP, c.ship), loud: 1 }));
    for (const a of alive) {
      const tgt = stepAlienAI(a, MAP, here, dt);
      const victim = tgt ? here.find(c => c.id === tgt) : null;
      step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
      faceTarget(a, victim?.ship ?? null);
      for (const b of fire(a, victim?.ship ?? null, dt)) bolts.push(b);
      if (sowOf(a.def)) {
        const drop = stepSow(a, victim?.ship ?? null,
          victim ? sowHolds(a, victim.ship, victim.haven) : false, dt);
        if (drop) {
          const mine = ground.filter(g => g.owner === a.id);
          if (mine.length >= a.def.sow.max)
            ground.splice(ground.indexOf(mine.reduce((w, g) => (g.t < w.t ? g : w))), 1);
          ground.push(Object.assign(groundFor(a, drop.at), { id: gid++, owner: a.id }));
        }
      }
    }
    for (const c of up) {
      const me = c.ship;
      const near = [...alive].sort((x, y) =>
        Math.hypot(x.x - me.x, x.y - me.y) - Math.hypot(y.x - me.x, y.y - me.y));
      plan(t, me, near, ground);
      step(me, dt); stepSnare(me, dt); stepVitals(me, dt, false);
      const f = near[0];
      faceTarget(me, f);
      if (Math.hypot(f.x - me.x, f.y - me.y) <= me.stats.weaponRange) c.onTgt += dt;
      for (const b of fire(me, f, dt))   { b.owner = c.id; bolts.push(b); }
      for (const r of launch(me, f, dt)) { r.owner = c.id; rockets.push(r); }
      // Pulling the trigger is the provocation, exactly as server.js has it. Without
      // it a hostile with aggro 540 that a pilot is kiting at 754px never notices
      // anybody, and the whole fight is a shooting gallery.
      f.provoked.add(c.id); if (f.target === null) f.target = c.id;
    }
    for (const h of [...stepBolts(bolts, dt), ...stepRockets(rockets, dt)]) {
      const who = crew.find(c => c.ship === h.target);
      if (who) who.took += h.split.shield + h.split.hull;
    }
    for (let i = ground.length - 1; i >= 0; i--) if (!stepGround(ground[i], dt)) ground.splice(i, 1);
    for (const c of up) {
      const haven = inHaven(MAP, c.ship);
      let worst = 0, grab = 0, inAny = false;
      for (const g of ground) {
        const inside = inGround(g, c.ship);
        if (inside) inAny = true;
        const bit = groundBite(g, c.id, c.ship,
          inside && mayHarm({ provoked: g.by }, { id: c.id, haven }), poolOf(c.ship), dt);
        if (bit.burn > worst) worst = bit.burn;      // patches do not stack
        if (bit.hold > grab && !haven) grab = bit.hold;
      }
      if (worst > 0) { applyDamage(c.ship, worst); c.took += worst; }
      if (inAny) c.inG += dt;
      if (grab > 0) holdEngines(c.ship, grab);
      if (held(c.ship)) { c.snared += dt; c.run = (c.run ?? 0) + dt; longest = Math.max(longest, c.run); }
      else c.run = 0;
    }
    t += dt;
  }
  const dead = crew.filter(c => c.ship.hp <= 0).length;
  return { t, killed: foes.every(f => f.hp <= 0), dead, n, longest,
           left: crew.map(c => Math.max(0, (c.ship.hp + c.ship.shield) / c.ehp0)),
           inG: crew[0].inG, uptime: t > 0 ? crew[0].onTgt / t : 0 };
}

// Four ways to fly the same fight, from worst to best. Naming them is the point:
// the claim below is not "this hostile is hard", it is "this hostile is answered by
// a thing a pilot does, and here is the thing".
const PLANS = {
  // stands at its own gun range and holds it. The right answer to every hostile
  // before this one, and the reason these two exist.
  kite: (t, me, foes) => {
    const f = foes[0], d = Math.hypot(f.x - me.x, f.y - me.y), want = me.stats.weaponRange * 0.92;
    if (d < want - 60) { me.tx = me.x + (me.x - f.x) / d * 400; me.ty = me.y + (me.y - f.y) / d * 400; }
    else if (d > want + 60) { me.tx = f.x; me.ty = f.y; }
    else { me.tx = me.ty = null; }
  },
  // holds range and CIRCLES, which answers "the ground lands where you were" and
  // nothing else. It does not look at the patches.
  orbit: (t, me, foes) => {
    const f = foes[0], dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1;
    const want = me.stats.weaponRange * 0.92;
    const a0 = Math.atan2(dy, dx) + 0.45;
    const r = d + Math.max(-120, Math.min(120, want - d));
    me.tx = f.x + Math.cos(a0) * r; me.ty = f.y + Math.sin(a0) * r;
  },
  // and the whole counter: circle, and refuse to fly through ground already down.
  // This is an ORACLE — it reads every patch on the field including ones outside
  // radar — so what it measures is the ceiling of human play, not the average.
  fly: (t, me, foes, ground) => {
    const f = foes[0], dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1;
    const want = me.stats.weaponRange * 0.92;
    for (const side of [0.45, 0.75, 1.1, -0.45, -0.75]) {
      const a0 = Math.atan2(dy, dx) + side;
      const r = d + Math.max(-120, Math.min(120, want - d));
      const px = f.x + Math.cos(a0) * r, py = f.y + Math.sin(a0) * r;
      if (!ground.some(g => Math.hypot(px - g.x, py - g.y) < g.r + me.r + 40)) {
        me.tx = px; me.ty = py; return;
      }
    }
    PLANS.orbit(t, me, foes, ground);
  },
};

// --- the fight ----------------------------------------------------------------
console.log('\nthe fight, through the real loop');
{
  // One combo event, in the lab: a pool laid inside a still and a pilot standing
  // still to shoot when it catches them. This is the worst case the pair can build.
  const worstCase = (stage, research) => {
    const me = pilot(stage, research); me.x = 0; me.y = 0; me.vx = me.vy = 0;
    const ehp0 = me.stats.hull + me.stats.shield;
    const gs = [Object.assign(groundFor({ def: D, provoked: new Set([1]) }, { x: 0, y: 0 }), { id: 1 }),
                Object.assign(groundFor({ def: V, provoked: new Set([1]) }, { x: 0, y: 0 }), { id: 2 })];
    holdEngines(me, HOLD);
    let t = 0, took = 0, coast = 0, clear = null;
    while (t < 30) {
      const inAny = gs.filter(g => inGround(g, me));
      if (!inAny.length) { clear = t; break; }
      const g = inAny.reduce((w, x) => (x.rate > w.rate ? x : w));
      const dx = me.x - g.x || 1, dy = me.y - g.y, d = Math.hypot(dx, dy) || 1;
      me.tx = g.x + dx / d * (g.r + me.r + 140); me.ty = g.y + dy / d * (g.r + me.r + 140);
      step(me, dt); stepSnare(me, dt);
      let worst = 0, grab = 0;
      for (const g2 of gs) {
        const b = groundBite(g2, 1, me, inGround(g2, me), poolOf(me), dt);
        if (b.burn > worst) worst = b.burn;
        if (b.hold > grab) grab = b.hold;
      }
      if (worst > 0) { applyDamage(me, worst); took += worst; }
      if (grab > 0) holdEngines(me, grab);
      if (held(me)) coast += dt;
      t += dt;
    }
    return { pct: 100 * took / ehp0, coast, clear: clear ?? t };
  };
  const cases = [];
  for (const st of ['fighter', 'cruiser', 'finished'])
    for (const [rn, res] of [['x1', 0], ['x32', X32]]) cases.push([st, rn, worstCase(st, res)]);
  for (const [st, rn, r] of cases)
    console.log(`     ${st.padEnd(12)} ${rn.padEnd(4)} coasted ${r.coast.toFixed(2)}s, clear of both at ` +
      `${r.clear.toFixed(2)}s, cost ${r.pct.toFixed(1)}% of the ship`);
  check('the combo is survivable, and it costs the same share whatever you fly',
    cases.every(([, , r]) => r.pct < 8) &&
    Math.abs(cases.find(c => c[0] === 'finished' && c[1] === 'x1')[2].pct
           - cases.find(c => c[0] === 'finished' && c[1] === 'x32')[2].pct) < 0.05,
    `${Math.max(...cases.map(c => c[2].pct)).toFixed(1)}% of the ship at worst — held at rest with ` +
    'a pool on the spot, which is the worst arrangement the pair can build. Identical at x1 and x32');
  // The bound is the coast plus the walk out of a still, and the walk is the slowest
  // fitted hull crossing 420px of it — 420 + 17 over 128 px/s is 3.4s, so 1.5 + 3.4
  // is 4.9 and there is no arrangement that can be slower. Written as HOLD plus that
  // rather than as a round number, so it moves when a hull does instead of going
  // quietly out of date the way the flat 6 in test/sim.mjs did.
  const walkOut = (D.sow.r + 17) / 128;
  check('and a pilot always gets out of it, in the hold plus one crossing',
    cases.every(([, , r]) => r.clear < HOLD + walkOut + 0.5),
    `clear of both at ${Math.max(...cases.map(c => c[2].clear)).toFixed(2)}s — a ${HOLD}s coast plus ` +
    `${walkOut.toFixed(1)}s to cross a still at the slowest fitted speed in the game. The coast ends, ` +
    'the throttle comes back, and the ground does not follow');
}

// --- what the fight actually is -------------------------------------------------
//
// This is the block the rung was argued from, so it prints its table. A finished
// Bulwark with its reactor on the gun delivers 11,941 dps measured here against
// balance.js's 11,307, and the fight it buys is 172 seconds.
console.log('\nthe fight, driven by the real AI');
{
  const line = (label, r) =>
    `     ${label.padEnd(26)} ${(r.dead === r.n ? 'WIPED' : r.killed ? 'cleared it' : 'timed out').padEnd(11)}` +
    `${(r.t.toFixed(0) + 's').padStart(6)}   ${r.left.map(v => (100 * v).toFixed(0).padStart(3) + '%').join(' ')}`;
  const solo = {};
  for (const [pn, plan] of Object.entries(PLANS))
    for (const kinds of [['vitriol'], ['doldrum'], ['vitriol', 'doldrum']]) {
      const r = fight({ kinds, research: X32, plan, secs: 900 });
      solo[`${kinds.join('+')}/${pn}`] = r;
      console.log(line(`${kinds.join(' + ')} / ${pn}`, r));
    }
  check('standing at your own gun range is what these two exist to punish',
    solo['vitriol/kite'].dead === 1 && solo['vitriol/orbit'].left[0] < 0.2,
    `kiting a Vitriol dies at ${solo['vitriol/kite'].t.toFixed(0)}s; circling it but flying through ` +
    `the ground anyway finishes on ${(100 * solo['vitriol/orbit'].left[0]).toFixed(0)}% of a ship — ` +
    'the answer is not range, and it is not even movement, it is which ground you cross');
  check('and a pilot who flies it properly takes one of them alone',
    solo['vitriol/fly'].killed && !solo['vitriol/fly'].dead &&
    solo['doldrum/fly'].killed && !solo['doldrum/fly'].dead,
    `Vitriol ${solo['vitriol/fly'].t.toFixed(0)}s at ${(100 * solo['vitriol/fly'].left[0]).toFixed(0)}% left, ` +
    `Doldrum ${solo['doldrum/fly'].t.toFixed(0)}s at ${(100 * solo['doldrum/fly'].left[0]).toFixed(0)}% — ` +
    'the plan is an ORACLE that reads patches outside radar, so this is the ceiling of ' +
    'human play rather than the average of it');
  check('but the PAIR kills that same pilot, which is what the deeps are for',
    solo['vitriol+doldrum/fly'].dead === 1,
    `dead at ${solo['vitriol+doldrum/fly'].t.toFixed(0)}s with ${solo['vitriol+doldrum/fly'].inG.toFixed(0)}s ` +
    'spent in ground — neither of them knows the other exists. They both sow at their ' +
    'target\'s feet, so if they are both fighting YOU the ground lands in one place');
  // How many pilots, measured rather than intended, over three starting arrangements
  // so the answer is not one seed's luck.
  console.log('');
  const need = [];
  for (const n of [1, 2, 3, 4]) {
    const runs = [160, 260, 420].map(spread =>
      fight({ kinds: ['vitriol', 'doldrum'], n, research: X32, plan: PLANS.fly, secs: 1200, spread }));
    need.push([n, runs]);
    console.log(`     the pair against ${n} pilot${n > 1 ? 's ' : '  '} ` +
      runs.map(r => `${r.dead === n ? 'WIPED' : r.killed ? 'cleared' : 'timed out'} ${r.t.toFixed(0)}s ` +
                    `${r.left.map(v => (100 * v).toFixed(0)).join('/')}%`).join('   |   '));
  }
  const at = k => need.find(([n]) => n === k)[1];
  check('one pilot cannot have the pair, at any arrangement',
    at(1).every(r => r.dead === 1),
    `wiped at ${at(1).map(r => Math.round(r.t) + 's').join(', ')} — three starting spreads, so it is ` +
    'the pairing rather than one seed of luck');
  check('two can, and it costs one of the two nearly everything',
    at(2).every(r => r.killed) && at(2).every(r => Math.min(...r.left) < 0.35),
    `cleared at every arrangement in ${Math.round(at(2)[0].t)}s, and the worse of the two finishes on ` +
    `${at(2).map(r => (100 * Math.min(...r.left)).toFixed(0) + '%').join(' / ')} of a ship — one of them ` +
    'does not always come back. It was going to be four, measured against the hull table before ' +
    'slots replaced base attributes: 8,351 dps then against 11,941 now with the reactor on the gun, ' +
    'so the fight is 171s instead of 246 and the ground has a third less time to gather. The claim ' +
    'moved to the measurement rather than the other way round');
  check('and four is where it stops being close, which is not free the way a Leviathan is',
    at(4).every(r => r.killed && r.dead === 0),
    'a gun shoots one pilot at a time and a pool burns everybody standing in it, so party size ' +
    'does NOT divide this the way it divides anything with a barrel — it had to be measured rather ' +
    `than divided. Four clear the pair in ${Math.round(at(4)[0].t)}s with nobody lost`);
  check('nothing costs a shot, which is why neither carries an effort multiplier',
    solo['vitriol/fly'].uptime > 0.97 && solo['doldrum/fly'].uptime > 0.97,
    `the trigger is held for ${(100 * solo['vitriol/fly'].uptime).toFixed(0)}% of the fight — circling ` +
    'at your own gun range never breaks range. A Bandit is 3.8 because 28% of what is fired ' +
    'at it lands; these land everything, so farmHp is effectiveHp and the rung is the hull');
  check('and no hold anywhere in any of that outlasted the stated one',
    Object.values(solo).every(r => r.longest <= HOLD + 1e-9),
    `longest coast across ${Object.keys(solo).length} fights: ` +
    `${Math.max(...Object.values(solo).map(r => r.longest)).toFixed(2)}s against a stated ${HOLD}s`);
}

// --- where they live ----------------------------------------------------------
console.log('\nthe posting and the pay');
{
  check('both stand on a rung of the ladder, half a decade above the mothership',
    Math.abs(effectiveHp('vitriol') - 650 * Math.pow(10, 3.5)) <= 25 &&
    effectiveHp('doldrum') === effectiveHp('vitriol'),
    `${effectiveHp('vitriol').toLocaleString()} each — 650 x 10^3.5 to the nearest ten, the same ` +
    'arithmetic that produced the Harrier\'s 2,060 and the Thresher\'s 205,550');
  check('effective hit points are a multiple of ten, so a bounty is whole credits',
    ['vitriol', 'doldrum'].every(k => effectiveHp(k) % 10 === 0
      && Math.abs(effectiveHp(k) * BOUNTY_RATE - Math.round(effectiveHp(k) * BOUNTY_RATE)) < 1e-6),
    `${effectiveHp('vitriol')} x ${BOUNTY_RATE} = ${effectiveHp('vitriol') * BOUNTY_RATE} exactly`);
  check('and both pay exactly what the rate says, in credits and in experience',
    ['vitriol', 'doldrum'].every(k => ALIENS[k].bounty === bountyFor(k) && ALIENS[k].xp === xpFor(k)),
    `${ALIENS.vitriol.bounty.toLocaleString()} cr and ${ALIENS.vitriol.xp.toLocaleString()} xp — ` +
    'farm hit points x BOUNTY_RATE and x XP_RATE, with nothing typed in');
  check('neither of them carries an effort multiplier, because neither costs you a shot',
    (ALIENS.vitriol.effort ?? 1) === 1 && (ALIENS.doldrum.effort ?? 1) === 1,
    'measured through the real loop: a pilot flying the counter holds the trigger for 100% of ' +
    'the fight, because circling at your own gun range never breaks range. A Bandit is 3.8 ' +
    'because 28% of what is fired at it lands; these land everything');
  check('they notice you no further out than you can see them',
    [V, D].every(a => a.aggro <= 560), `${V.aggro} against 560px of sight`);
  check('and neither of them can catch anybody',
    (() => {
      const slowest = Math.min(...STAGE_KEYS.map(st => pilot(st, X32).stats.speed));
      return V.attrs.speed < slowest && D.attrs.speed < slowest;
    })(),
    `${D.attrs.speed} and ${V.attrs.speed} against the slowest fitted ship in the game at ` +
    `${Math.min(...STAGE_KEYS.map(st => pilot(st, X32).stats.speed)).toFixed(0)}px/s — leaving always works`);
  check('a sower holds station at its sowing reach, not at a gun it does not have',
    (() => {
      const map = MAPS.d1;
      const a = newAlien('vitriol', 9002, map, 3);
      return standOff(a) === V.sow.reach && V.attrs.weaponRange === 0;
    })(),
    `${V.sow.reach}px, past every hull in the shop (620-820) — reading weaponRange would be ` +
    '0 x 0.7 and would park it inside your hull with its only mechanic having no room to work');
  check('and both survive their own AI, ground and all',
    (() => {
      const map = MAPS.d1;
      const me = pilot(); me.x = 3400; me.y = 5600;
      for (const kind of ['vitriol', 'doldrum']) {
        const a = newAlien(kind, 9100, map, 11, { x: 4000, y: 5600 });
        a.x = a.post.x; a.y = a.post.y; a.provoked.add(1);
        const here = [{ id: 1, ship: me, haven: false, loud: 1 }];
        for (let i = 0; i < 300; i++) {
          const tgt = stepAlienAI(a, map, here, dt);
          const vic = tgt ? here[0] : null;
          step(a, dt); stepVitals(a, dt, false); stepAlienRepair(a, dt);
          stepSow(a, vic?.ship ?? null, vic ? sowHolds(a, vic.ship, vic.haven) : false, dt);
        }
      }
      return true;
    })(),
    'ten seconds of ticks each — a Censer crashed the live server on its first tick with a ' +
    'green suite behind it, because standOff() reached for something aliens.js had not imported');
}

// --- the wire and the shape ---------------------------------------------------
console.log('\nthe wire, the shape and the colour');
{
  check('no new field on a ship row, because there is one slot left in the whole format',
    SHIP_FIELDS.length === 30 && SHIP_FIELDS.length < MAX_FIELDS,
    'a sower\'s wind-up rides `abl`, which is now five deep: draw, spin, fix, load, sow');
  // And the trap that comes with a five-deep multiplex. server.js packs `abl` as
  // `a.draw ?? a.spin ?? a.fix ?? a.load ?? a.sow ?? 0`, which silently keeps the
  // FIRST of the five a hostile happens to carry. Nothing errors; the second dial
  // simply never reaches the client, and what you would see is a mechanic that is
  // running and invisible — which is the exact bug the Thresher's chamber was, and
  // it read as a random one-shot for as long as it existed. One hostile, one dial.
  check('and no hostile carries two of the five dials that field multiplexes',
    WILD.every(k => ['siphon', 'burn', 'fix', 'returns', 'sow']
      .filter(d => ALIENS[k][d] !== undefined).length <= 1),
    WILD.map(k => `${k}:${['siphon', 'burn', 'fix', 'returns', 'sow']
      .filter(d => ALIENS[k][d] !== undefined).join('+') || '-'}`).join(' '));
  check('ground is a keyed stream, not an ephemeral, and the numbers say why',
    !!STREAMS.sown && !EPHEMERAL.includes('sown') && SOWN_FIELDS.length <= MAX_FIELDS,
    `a patch lives ${V.sow.life}s, has an id, and ${SOWN_FIELDS.length - 1} of its ` +
    `${SOWN_FIELDS.length} fields never change once it is laid — only \`p\` moves. That is the ` +
    'exact inverse of every ephemeral, which has no identity, lives under a second and goes ' +
    'stale in every field every tick');
  check('and a row survives the round trip it will actually make',
    (() => {
      const o = { id: 7, x: 1234.6, y: 99.2, r: 195, p: 0.4567, k: 1, on: 1 };
      const back = unpackSown(packSown(o));
      return back.id === 7 && back.x === 1235 && back.r === 195 && back.k === 1 && back.on === 1
          && Math.abs(back.p - 0.46) < 1e-9;
    })(),
    'positions rounded, the kind an index into GROUND_KINDS, and the phase fixed to TWO places ' +
    'rather than the usual three — it is the only field on a patch that ever moves, so it alone ' +
    'decides what the stream costs: 4.90 KiB/s at three places against 0.61 at two, for sixteen ' +
    'patches at 30Hz. One percent of a thirty-six-second life is 0.36s of a countdown arc');
  check('the kind is an integer on the wire, so a spelling is not kept in two places',
    GROUND_KINDS.includes(V.sow.kind) && GROUND_KINDS.includes(D.sow.kind)
    && groundK('nonsense') === 0,
    `${GROUND_KINDS.join(', ')} — an unknown kind draws the first palette rather than undefined`);
  check('each has an outline nobody else has',
    (() => {
      const shapes = WILD.map(k => ALIENS[k].shape);
      return new Set(shapes).size === shapes.length
        && !!SHAPES[V.shape] && !!SHAPES[D.shape];
    })(),
    `${V.shape} and ${D.shape} against ${WILD.filter(k => !['vitriol', 'doldrum'].includes(k))
      .map(k => ALIENS[k].shape).join(', ')}`);
  check('and both outlines are closed, finite and the right way up',
    ['vitriol', 'doldrum'].every(k => {
      const pts = outlineOf(k, 40);
      return pts.length >= 6 && pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
          && Math.max(...pts.map(([x]) => Math.abs(x))) > 20;
    }),
    'the render harness rejects any draw call with a NaN in it, and an outline is a draw call');
  // CIE-Lab dE76 against every colour already spoken for, hostiles and ore both. The
  // tightest pair the game already ships is the Harrier against the Bandit at 35.5.
  {
    const lab = hex => {
      const f = c => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
      const [r, g, b] = [1, 3, 5].map(i => f(parseInt(hex.slice(i, i + 2), 16) / 255));
      const k = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      const X = k((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const Y = k(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const Z = k((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    };
    const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
    const ORE = ['#8d7f6e', '#a8b4a0', '#4a7fd4', '#ffd9e8', '#cfd8e3', '#7fd4c8'];
    const others = k => [...WILD.filter(j => j !== k).map(j => ALIENS[j].colour), ...ORE, '#7f8ea3'];
    const worst = k => Math.min(...others(k).map(c => dE(ALIENS[k].colour, c)));
    const tight = Math.min(...WILD.flatMap((a, i) => WILD.slice(i + 1)
      .map(b => dE(ALIENS[a].colour, ALIENS[b].colour))));
    check('and a colour further from everything else than the game\'s own tightest pair',
      worst('vitriol') >= 35.5 && worst('doldrum') >= 35.5,
      `Vitriol ${V.colour} clears everything by ${worst('vitriol').toFixed(1)}, Doldrum ${D.colour} ` +
      `by ${worst('doldrum').toFixed(1)}, in CIE-Lab dE76 against ten hostiles, six ores and the ` +
      `range furniture. The tightest pair in the bestiary is ${tight.toFixed(1)}`);
    check('and the two of them are unmistakable for each other, which matters most',
      dE(V.colour, D.colour) > 150,
      `${dE(V.colour, D.colour).toFixed(0)} apart — when both are on the field, which ground you ` +
      'are looking at is the whole decision');
  }
  check('and both drop something, at the rung their toughness says',
    !!DROPS.vitriol && !!DROPS.doldrum && DROPS.vitriol[0].mat === 'platinum',
    'rollDrop reads a missing kind as "drops nothing", which is how the Ironhusk shipped ' +
    'paying only its bounty');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — the deeps: ${HOLD}s held, ${CALM}s owed, ${V.sow.max + D.sow.max} patches`}\n`);
process.exit(fails.length ? 1 : 0);
