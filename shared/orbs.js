// Orbs. The second kind of projectile, and the first one in this game you beat by
// not standing somewhere.
//
// IT IS A VOCABULARY NOW RATHER THAN A WEAPON, and that is the shape of the file: the
// bestiary wants nine attacks that are all different from each other, and the choice
// is nine bespoke mechanics or a handful of layouts they compose out of. SHAPES below
// is the handful and it is the seam — a new pattern is a row there and a line in
// aliens.js, not another module. Five hostiles ride it today and each one teaches a
// different verb:
//
//     Drifter     one slow ball                    MOVE
//     Harrier     a rake across the road ahead     TURN
//     Ironhusk    a cone                           GET OFF THE LINE
//     Leviathan   three cones, re-led              KEEP CHANGING YOUR MIND
//     Bandit      caltrops that stay where they    DO NOT GO BACK
//                 land
//
// Measured through the real AI loop against a starter Hauler holding station and a
// laden Bulwark weaving — what the pattern costs, against the bolt each one replaced:
//
//                    parked: bolt / pattern      weaving: bolt / pattern
//     Drifter              48.0 / 48.0                  48.0 / 14.3
//     Harrier              57.5 / 57.5                  52.5 / 15.0
//     Bandit              195.0 / 190.0                145.0 / 57.5
//     Ironhusk             72.0 / 70.5                  72.0 / 14.1
//     Leviathan           120.0 / 120.0                 75.0 / 21.7
//
// The left column is the whole invariant: a pilot who does not move pays what they
// always paid, so threatDps, the bounties, the experience, the bestiary report and
// three claim rosters are every one of them the numbers they already were. The right
// column is the feature.
//
// A bolt is aimed at where you WILL be and then resolved once, at its destination:
// stepBolts counts `ttl` down and asks, on the tick it lands, whether the target is
// still inside `HIT_R + r` of the aim point. That is dodging by outrunning a
// prediction, and measured against the Ironhusk it is very nearly not dodging at all:
// a Hauler holding station took 99% of what it fired, and a laden Bulwark — the hull
// the claim bench flies — took 94% while weaving hard enough to reverse three times a
// second. At 500px a bolt arrives in half a second, and 50px of slack is more than
// most hulls move in half a second while under thrust.
//
// An orb is a body. It has a place every tick, it hits whatever it passes THROUGH on
// the way, and it crawls — which is the difference the table above is made of. That
// table used to hold one hostile and both of its weapons; it holds five now, and the
// claim it makes is the one it always made: what a pilot who does not read the pattern
// takes has not moved by a decimal place, and what a pilot who does read it takes has
// fallen through the floor.
//
// WHY THE COLLISION IS RESOLVED CONTINUOUSLY AND NOT ON ARRIVAL, which is the
// question the shape of this file turns on. A slow orb that only checks its endpoint
// can be flown straight through, which will feel broken the first time it happens.
// So it is tested every tick — and the cheap test is already the continuous one,
// because of the speed:
//
//     ORB_SPEED / 30Hz  =  13px of travel per tick
//     smallest hit disc =  44px orb + 10px hull  =  54px
//
// An orb cannot step over a ship it would have crossed, so a point-in-disc test per
// tick IS the swept test, and the sweep buys nothing. Priced at the worst crowd the
// game produces — a deep claim, twelve Ironhusks and a Leviathan, around fifty orbs
// in the air against eight bodies — that is 18,000 hypots a second, which does not
// show up against the 30Hz tick: the whole claim bench simulates 900 seconds of it in
// 1.9s of wall clock, the same 1.8s it took before orbs existed.
//
// THE SEAM IS THE ASSERTION IN test/orbs.mjs: if ORB_SPEED ever rises past a hit
// radius per tick, the point test starts letting ships through, and the segment form
// — distance from the hull to the segment P -> P + V·dt — is what replaces it. The
// test fails first, by name.

import { applyDamage, SHOT_FLASH } from './sim.js';
import { boostOf } from './power.js';
// An answering ring turns part of what lands on a hardened plate — see stepBolts in
// combat.js, which does the same thing for the same reason. Returns 1 for everything
// without plates, which is everything but one hostile.
import { softAt } from './plates.js';

// --- how slow is slow ---------------------------------------------------------
//
// DERIVED, and it is pinned from BOTH ends, which the first draft was not.
//
// The ceiling is the dodge. A pattern is dodgeable when a pilot can cross out of it
// before it arrives, from the range the hostile actually fires at, with time to read
// the thing first:
//
//     v · (d / S − READ_TIME)  ≥  half-width(d) + orb r + hull r
//
// An Ironhusk reaches 500 and closes, so it fires from about 400; its cone is
// 0.20rad, so half-width(400) is 40px, and the disc is 44 + 12 for a Hauler:
//
//     300 · (400 / S − 0.35)  ≥  96      →     S ≤ 585 px/s
//
// The FLOOR is the one that was missed, and it cost a whole design pass. An orb
// cannot intercept anything moving faster than it is: the aim solve below diverges,
// and a hostile with a weapon that cannot reach a pilot holding a straight course is
// not a weapon, it is a light show. Measured at S = 300, which is exactly a Hauler's
// speed: an Ironhusk put 0.4 dps into an orbiting Hauler — 1% of what it threw — and
// the twelve of them in a claim went from taking 89% of the pilot's ship to 36%.
//
//     S  >  every hull that can be caught  =  250 Bulwark, 300 Hauler, 340 Vanguard
//
// 400, then. It catches everything but a Kestrel at a full 430px/s sprint, and a
// Kestrel sprinting away from something that reaches 500 has left the fight rather
// than won it. Two fifths of a bolt's 1000 and under a rocket's 520, which is what
// "slow, like in a roguelike" comes to in px/s: 1.0s in the air at an Ironhusk's
// range, 1.9s at the 750 a Leviathan throws from, and 13px of travel a tick.
//
// Read the dodge inequality the other way and it says what the pattern costs the
// people it is for. At 400px a Hauler needs 96px of lateral room and has 195px of
// it; a bare Bulwark has 162; a LADEN Bulwark at 128px/s has 83 and does not clear
// the cone at all — it only clears it out at 500, at arm's length. That is the
// Ironhusk's existing lesson, that its reach is 500 and holding your own range costs
// it everything, restated as something you can watch coming at you.
export const ORB_SPEED = 400;    // px/s
export const READ_TIME = 0.35;   // s a pilot is assumed to need before they move

// --- THE VOCABULARY -------------------------------------------------------------
//
// A pattern, read off the hostile's definition. Data, so the next one is a line in
// aliens.js rather than a change here.
//
// It answers four questions and they are independent of each other, which is the
// whole reason this is a vocabulary rather than a list of nine bespoke weapons:
//
//   WHEN        `fireRate` owns the cycle; `burst` and `beat` split it into clusters
//   WHICH WAY   `shape` picks the layout, `n` and `arc` or `span` size it
//   HOW BIG     `r`
//   WHAT THEN   `stay` — whether an orb is spent on arrival or sits on its mark
//
//   n     slots in the pattern
//   arc   how wide a FAN is, radians, tip to tip. A rake ignores it.
//   span  seconds of the TARGET's own travel between the marks of a RAKE. A fan
//         ignores it.
//   r     px, and it is BOTH the collision radius and the drawn radius. It goes on
//         the wire for that reason: a ball you can see and cannot be hit by is the
//         same bug as a row you can see and cannot click, and this codebase has
//         shipped that one twice.
//   burst how many clusters one trigger throws, a `beat` apart. 1 for a single
//         cluster. Each one is aimed afresh, so a burst covers where you are GOING
//         over the next second rather than a width across it.
//   beat  seconds between the clusters of a burst.
//   shape which layout — a key of SHAPES below. Defaults to 'fan', which is what
//         every pattern was before there was a second one.
//   stay  seconds an orb sits still ON its mark once it gets there. 0, the default,
//         is the original behaviour: it flies its weapon's full reach and expires.
//         See stayFor() for what the number has to be and why.
export const orbsOf = def => def?.orbs ?? null;

// How long a laid orb stands, and it is DERIVED rather than picked.
//
// A pattern that leaves things behind is area denial, and shared/aliens.js already
// argued the ceiling for that on the Crucible: "a hostile that holds more than a
// third of the ground its own fight is on has stopped shaping the space and started
// being the space". The same argument in a raider's units is a count of THROWS: the
// field may never be more than the one that has just landed plus the one arriving.
//
//     throws alive  =  (flight + stay) / cycle
//
// At the range these hostiles fight from the flight is about one cycle already — a
// Bandit's mark is 448px out, which is 1.12s at ORB_SPEED against a 1.54s cycle — so
// one cycle of `stay` puts that at 1.7 and one and a half puts it at 2.2. One cycle,
// then, and the bestiary writes the seconds out with the arithmetic shown, the way
// shared/ground.js writes a pool's `life`. test/orbs.mjs re-derives it rather than
// trusting the line.
export const STAND = 1.0;                    // cycles of its own cadence
export const stayFor = o => Math.max(0, o?.stay ?? 0);

// How many orbs one trigger puts in the air, all clusters counted.
export const orbCount = o => Math.max(1, o.n) * Math.max(1, o.burst ?? 1);

// The slots, as angular offsets from the aim line. Exported because the test asserts
// on the geometry directly rather than on where the orbs ended up.
//
// WHY THERE IS NO HOLE IN THIS, which was the first design and is the measurement
// worth keeping. A wall with a gap you fly through is a lovely read and it is
// unaffordable, because the two halves of it pull against each other in px:
//
//   a hole is flyable when   (gap+1) x spacing - 2 x (orb r + hull r)  >  a hull
//   a volley lands when       spacing  <  orb r + hull r
//
// The first wants the slots far apart and the second wants them close, and at the
// Leviathan's 630px standoff there is no spacing that does both. Measured through the
// real AI loop against the pilot the claim bench flies — a laden Bulwark at 128px/s —
// over the whole family: a wall whose hole a Bulwark actually fits through delivers
// 23 dps of a 118 dps hostile, 19%, and one that delivers 51% has a hole 45px NARROWER
// than nothing, which is a decoration rather than a mechanic. Paying for the first
// would need the Leviathan's damage at five times what it is, and the balance model
// has 5% of headroom: shared/balance.js reads it at 0.85 of the dps its stage asks
// for against a ceiling of 0.9 that test/balance.mjs enforces.
//
// So the second pattern is a BURST instead — see the note on `burst` above. Each
// cluster is tight, so the ceiling stays reachable and threatDps stays honest.
export function orbSlots(o) {
  const out = [];
  const half = (o.n - 1) / 2;
  for (let i = 0; i < o.n; i++)
    out.push(half === 0 ? 0 : ((i - half) / half) * (o.arc / 2));
  return out;
}

// --- SHAPES, AND THIS TABLE IS THE SEAM -------------------------------------------
//
// Nine hostiles each wanting an attack of their own is either nine bespoke mechanics
// or a handful of layouts they compose out of. This is the handful. A shape is handed
// the pattern and one `aim` — everything already worked out about where the muzzle is,
// where the target is and where it is going — and returns one SLOT per orb: a bearing
// to leave on, and how far away that orb's MARK is.
//
// What happens AT the mark is deliberately not the shape's business. `stay` decides
// that, once, for every shape — which is why "a fan you fly through" and "a fan that
// lies there afterwards" are one row of data apart rather than two mechanics.
//
//   aim.ax, aim.ay      where the muzzle is
//   aim.lead            the solved intercept bearing
//   aim.markD           px from the muzzle to the intercept point
//   aim.bx, aim.by      where the target is
//   aim.bvx, aim.bvy    and how it is moving
//   aim.travel          seconds to the intercept
//
// THE ROWS THE REST OF THE BESTIARY WILL WANT, named here so the next pass is a row
// rather than a refactor. Every one of them is a different answer to "which way", and
// all of them get `stay`, `burst` and `r` for free:
//
//   sweep    a fan whose aim TURNS between the clusters of a burst — a line walked
//            across the sky. One `spin` field, radians per cluster.
//   charge   a fan whose `arc` is read off a live dial instead of the definition, so
//            a hostile that has been winding up throws a wider one.
//   ring     `arc` of 2*PI. orbSlots already produces it; nothing else has to change.
//   wake     laid at the muzzle along the hostile's OWN course rather than at a mark.
//            NOTE BEFORE BUILDING IT: a trail spreads a volley over the length it is
//            laid across and a point target intercepts a fixed 2 x (orb r + hull r)
//            of it, which is the same arithmetic orbSlots argues above for a fan's
//            width. At a Harrier's 380px/s a 2.5s strafing run lays 950px of trail
//            and a hull collects 112px of it — 12% — so a wake cannot carry a
//            hostile's book dps and must sit on top of something that does.
//   land     what an orb becomes where it stops. THE DEEPS ALREADY DID THIS AND DID
//            NOT COME THROUGH HERE, deliberately: a Crucible's glob is one throw a
//            cycle carrying the hostile's whole damage inside it, so it is a wind-up
//            on the hostile rather than a body in a list, and shared/ground.js owns
//            it end to end. What is still unbuilt is a PATTERN of them — several orbs
//            that each leave something — and the seam for that is one call on the
//            branch below that already exists for an orb whose flight is over.
//
// AND ONE ROW THAT WILL NOT BE WANTED. A rake with `stay` of 0 is a line of orbs
// strung along your course that all fly past you; it is a fan you have paid extra
// for. The layout and `stay` are independent, but that does not make every pair of
// them a hostile.
export const SHAPES = {
  // A FAN. n bearings spread over `arc` about the aim line, every one of them thrown
  // the same distance. The Ironhusk's cone, the Leviathan's clusters, and a Drifter's
  // single ball, which is this with n of 1.
  fan: (o, aim) => orbSlots(o).map(off => ({ h: aim.lead + off, d: aim.markD })),

  // A RAKE. n marks strung out along the TARGET'S OWN COURSE, `span` seconds of its
  // travel apart, starting at the intercept. Every orb flies to its own mark and — if
  // the pattern stays — sits on it, so what lands is a fence across the road ahead.
  //
  // IT COLLAPSES TO A FAN OF ONE WHEN YOU ARE NOT MOVING, and that is the point rather
  // than a degenerate case: a pilot holding station has one mark, so the whole volley
  // arrives on them and the book number stays reachable, which is what threatDps
  // promises. Hold a straight course and the marks string out along it and you drive
  // through every one — a straight line is not a dodge, the same rule the fan states.
  // Turn, and the fence is behind you.
  //
  // The fence is therefore about `span` x (n-1) seconds of your own road, whatever you
  // fly: fast hulls get a long one, slow hulls a short one, and both get the same
  // second or so of warning. `span` is capped from above by the no-hole rule orbSlots
  // argues — span x (the fastest hull) must stay under 2 x (orb r + hull r), or the
  // quickest ships fly between the marks.
  rake: (o, aim) => {
    const out = [];
    for (let i = 0; i < Math.max(1, o.n); i++) {
      const t = aim.travel + i * (o.span ?? 0);
      const dx = aim.bx + aim.bvx * t - aim.ax, dy = aim.by + aim.bvy * t - aim.ay;
      out.push({ h: Math.atan2(dy, dx), d: Math.hypot(dx, dy) });
    }
    return out;
  },
};
// Unknown shapes fall back to the fan rather than throwing, for rule seven's reason:
// a definition with a typo in it should be a hostile that shoots oddly, not a sector
// that stops ticking.
export const shapeOf = o => SHAPES[o?.shape ?? 'fan'] ?? SHAPES.fan;

// Advances this hostile's launcher and returns the orbs released this tick.
//
// It LEADS, the same way fire() does and for the same reason: a pattern aimed at
// where you are rather than at where you are going is beaten by holding any course
// at all, which is not a dodge, it is a walk. Aimed at the lead point, holding a
// course puts you in the middle of the fan and CHANGING one takes you out of it —
// which is the difference between this and a bolt stated as a rule.
//
// `a.cool` is the same clock fire() uses, deliberately: a hostile has one trigger
// and threatDps reads `damage x fireRate` off the definition whichever weapon is on
// the end of it. See the note on the ceiling below.
export function throwOrbs(a, b, dt) {
  const o = orbsOf(a.def);
  // Nothing at all for a hostile that has no pattern, and the clock is not touched
  // on the way out. Decrementing it first ran every OTHER hostile's gun at twice its
  // rate: server.js and the bench both call fire() and this in the same tick, so a
  // bolt-thrower's 0.8 cycles a second became 1.58 and the bench read an Ironhusk's
  // bolt at 142 dps against a book of 72. Measured, not guessed — it is why this early
  // return is the first line and not the second. (The hostile that found it was a
  // Drifter, which throws a pattern of its own now; a Kedge is what test/orbs.mjs
  // holds the clock against today.)
  if (!o) return [];
  a.cool = Math.max(0, a.cool - dt);
  // THE MUZZLE GLOW, and it is decayed here because nothing else will. combat.js owns
  // the only other copy of this line and it sits BELOW the gate at the top of fire()
  // that sends a pattern-thrower straight home — so every hostile converted off its
  // barrel held a full flash for ever, from its first shot to its death, at every
  // range, whether or not it had anybody. It was live on the Ironhusk and the
  // Leviathan from the day orbs landed; shared/ground.js named it and fixed its own
  // two when the deeps were converted, and this pass and the mid-tier one arrived at
  // the same line independently, which is what an unowned bug looks like.
  a.shotFlash = Math.max(0, (a.shotFlash ?? 0) - dt);
  const reach = a.stats.weaponRange ?? 0;
  const live = b && b.hp > 0 && a.hp > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= reach;
  // The burst runs on its own beat inside the cycle the cadence owns, which is the
  // same two-clock shape fire() uses for a rack of emitters and it is here for the
  // same reason: the cluster has to be a cluster, and the cycle has to stay the cycle
  // threatDps reads. Mid-burst it holds fire the moment the target is gone, so a
  // hostile cannot keep walking a barrage at somebody who has jumped out.
  if (a.orbLeft > 0) {
    if (!live) { a.orbLeft = 0; return []; }
    a.orbBeat -= dt;
    if (a.orbBeat > 0) return [];
  } else {
    if (!live || a.cool > 0) return [];
    a.cool = 1 / Math.max(0.01, a.stats.fireRate ?? 1);
    a.orbLeft = Math.max(1, o.burst ?? 1);
  }
  a.orbLeft--;
  a.orbBeat = o.beat ?? 0;

  // THE CEILING, and it is the same claim threatDps makes for a mirror's chamber and
  // an answering ring: `damage x fireRate` is what the whole volley does if all of it
  // lands, and all of it CAN land — point blank, where the fan is narrower than a
  // hull. Split evenly across what left the barrel, so the number in the threat file
  // and the number in the bestiary report stay the ones already there and nothing
  // downstream has to be re-derived. What a pilot who reads the pattern actually
  // takes is a fraction of it, and that fraction is the hostile.
  const each = (a.stats.damage * boostOf(a.power, 'weapons', a.stats)) / orbCount(o);
  // THE INTERCEPT IS SOLVED, NOT ESTIMATED, and that is the difference between this
  // and fire(). A bolt takes `range / BOLT_SPEED` as its flight time and aims there;
  // at 1000px/s against a 300px/s hull the error that leaves is a few pixels inside
  // 50px of slack, so it has never mattered. At ORB_SPEED the target moves nearly as
  // fast as the projectile, and the error compounds: measured at 300px/s against a
  // Hauler doing the same, a pilot crossing 420px out is 420px along by the time the
  // first guess says the orb arrives, the lead point is then 594px away and takes two
  // seconds to reach, and the whole fan lands 174px behind them. Measured before it
  // was fixed — an orbiting Hauler took 0.4 dps of a 72 dps hostile, 1% of what was
  // thrown, which is not a dodge, it is a weapon that does not work.
  //
  // Three passes of `t = |target(t) - here| / ORB_SPEED` converge to well inside a
  // hull for anything slower than the orb, and CANNOT converge for anything faster —
  // which is correct rather than a limitation: a Kestrel at 430px/s outruns a 400px/s
  // orb and is entitled to. The clamp keeps a divergent solve inside the orb's own
  // life so it aims somewhere reachable instead of at the far wall.
  const reachT = Math.max(0.1, reach / ORB_SPEED);
  let travel = Math.hypot(b.x - a.x, b.y - a.y) / ORB_SPEED;
  for (let i = 0; i < 3; i++)
    travel = Math.min(reachT, Math.hypot(b.x + b.vx * travel - a.x, b.y + b.vy * travel - a.y) / ORB_SPEED);
  const lead = Math.atan2(b.y + b.vy * travel - a.y, b.x + b.vx * travel - a.x);
  a.shotFlash = SHOT_FLASH;   // one glow for the whole fan, not one per orb
  a.sinceShot = 0;

  // The layout, off the table above. The intercept is solved ONCE and handed to it,
  // so a shape is geometry and nothing else — no shape re-solves an aim, which is
  // what stops two of them disagreeing about where the target is going.
  const slots = shapeOf(o)(o, { ax: a.x, ay: a.y, lead, travel, markD: travel * ORB_SPEED,
                                bx: b.x, by: b.y, bvx: b.vx, bvy: b.vy });
  const stay = stayFor(o);
  return slots.map(s => {
    const h = s.h;
    // HOW LONG IT FLIES, and the two answers are the whole of what `stay` changes.
    //
    // A pattern that does not stay flies until its clock runs out, and Infinity here
    // is that stated rather than a special case in stepOrbs: `min(dt, Infinity)` is
    // dt, so every orb the game had before this line existed moves exactly as it did.
    //
    // One that stays flies to its MARK and stops on it. The mark is clamped to the
    // weapon's reach for the same reason the life is: an orb that came to rest past
    // where its hostile can shoot would let it deny ground it cannot reach.
    const fly = stay > 0 ? Math.max(0, Math.min(s.d, reach)) / ORB_SPEED : Infinity;
    return {
      x: a.x, y: a.y, heading: h,
      vx: Math.cos(h) * ORB_SPEED, vy: Math.sin(h) * ORB_SPEED,
      // Seconds of powered flight left. Server-side only — packOrb sends the SPEED,
      // worked out from the velocity so a parked orb cannot be drawn moving.
      fly,
      r: o.r, dmg: each, foe: !!a.isAlien,
      // WHOSE IT IS, as a row in the bestiary. There was nothing here, so the client drew
      // an Ironhusk's orbs and a Leviathan's in the same colour and the Leviathan's own
      // green never left aliens.js. An index rather than a colour, because a colour on the
      // wire is `ALIENS[kind].colour` kept in two places — see kindIx() in aliens.js for
      // the rest of the argument and ORB_FIELDS for what it costs.
      k: a.kx ?? 0,
      // Sanctuary travels WITH the orb, by reference, exactly as a sown patch carries
      // its sower's set: a pattern is in the air for over two seconds at a Leviathan's
      // reach and the hostile that threw it may be dead by the time it arrives, but
      // who it was allowed to harm when it left is still the right answer.
      by: a.provoked,
      // Where it came FROM, kept whole rather than walked back from the impact the
      // way a rocket's is. An orb travels in a straight line and never turns, so the
      // muzzle is exactly the lever arm an Antiphon's ring wants and there is nothing
      // to reconstruct. Server-side only — packOrb names the six fields that go out.
      ox: a.x, oy: a.y,
      // Its full reach and no further, plus however long it is entitled to lie there.
      // An orb that outlived its own weapon range would let a hostile hit you from
      // somewhere it cannot shoot from, which is the one thing a pilot holding range
      // is entitled to rely on — so a pattern that STAYS spends its life getting to a
      // mark inside that reach and then standing on it, and never travels further.
      t: (stay > 0 ? fly : reachT) + stay, ttl: (stay > 0 ? fly : reachT) + stay,
    };
  });
}

// Flies every orb one tick and settles whatever it went through.
//
// `bodies` is the same `[{ id, ship, haven }]` list stepAlienAI is handed, because
// the sanctuary predicate needs the id and the haven and nothing else in the game
// carries them together. `may` is that predicate, passed in rather than imported:
// shared/sim.js owns mayHarm and importing it here would be the second copy of
// "where is it safe to stand" that cost this codebase a day of a workshop dock that
// refused to sell anything.
//
// An orb is SPENT on the first thing it touches. It does not pierce — a wall that
// went through the pilot in front and killed the one behind would be splash damage
// with extra steps, and no weapon in this game has any. THE SEAM IS HERE: one line,
// drop the `break`, and the number that would justify it is a wall that reads as
// unfair because it stopped on somebody's drone.
export function stepOrbs(list, bodies, dt, may = () => true) {
  const hits = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    // The step is CLAMPED to what is left of the flight, which matters only for a
    // pattern that stays: a full tick is 13px and an orb that overshot its mark by
    // that much would come to rest a quarter of a hit disc off the place the pilot
    // was actually going to be. `fly` is Infinity for everything that does not stay,
    // so min(dt, fly) is dt and nothing the game had before this moves differently.
    const go = Math.min(dt, b.fly ?? Infinity);
    if (go > 0) { b.x += b.vx * go; b.y += b.vy * go; }
    if (b.fly !== undefined) {
      b.fly -= dt;
      // Parked. The velocity is zeroed rather than remembered, because packOrb reads
      // the SPEED off it — a caltrop the client flew forward at ORB_SPEED would drift
      // off the thing it is actually sitting on, which is the "drawn at one radius,
      // hit at another" bug in a different axis.
      if (b.fly <= 0) { b.vx = 0; b.vy = 0; }
    }
    b.t -= dt;
    // Collision BEFORE expiry, not after. An orb that runs out of reach on the same
    // tick it crosses a hull was still there when it crossed it, and settling the
    // clock first would drop it — one tick in thirty-seven of an Ironhusk's flight,
    // which is exactly the shot a pilot who backed off to the very edge would notice
    // going through them and doing nothing.
    let spent = false;
    for (const c of bodies) {
      const tg = c.ship ?? c;
      if (!tg || tg.hp <= 0) continue;
      if (Math.hypot(tg.x - b.x, tg.y - b.y) > b.r + tg.r) continue;
      if (!may(b, c)) continue;
      list.splice(i, 1);
      // Which way it arrived from, taken once here and handed on — the plate that
      // turns part of the hit and the same plate hardening from it both want it. Same
      // two uses stepBolts has, and the same reason it is worked out in one place.
      const from = { a: Math.atan2(b.oy - tg.y, b.ox - tg.x), x: b.ox, y: b.oy };
      const split = applyDamage(tg, b.dmg * softAt(tg, from.a));
      // `raw` is what ARRIVED, before any plate turned it, because that is what
      // hardens the plate. See stepBolts for the measurement that cost.
      hits.push({ orb: b, target: tg, who: c.id ?? null, dead: tg.hp <= 0, split, from, raw: b.dmg });
      spent = true;
      break;
    }
    if (!spent && b.t <= 0) list.splice(i, 1);
  }
  return hits;
}
