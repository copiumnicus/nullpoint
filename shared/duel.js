// The one-versus-one arena.
//
// `/1v1 <callsign>` puts a challenge on somebody's screen. If they take it, both
// ships fold for five seconds, both come down in a sector that exists for exactly
// this fight, and for five more seconds neither of them can move, turn, shoot or
// leave. Then the clock lets go and one of them flies home poorer.
//
// A DUEL IS AN ARENA WITH TWO SEATS. It is not a second system beside claims: the
// same `arena:<token>:<key>` instancing, the same per-sector lists, the same sweep.
// Everything the world already does per sector works on it for the same reason a
// claim does — all of it is keyed on a map id string and nothing else. What a duel
// adds is a second occupant, and the honest generalisation of that is the sweep
// asking "is EITHER seat still standing here" instead of "is the owner".
//
// --- WHY THE SECTOR IS SMALL, AND WHY THAT SIZE ------------------------------
//
// 6,000 x 4,000 against the galaxy's 12,000 x 8,000: half of each side, a QUARTER
// of the area, and the same 3:2 aspect so the minimap needs no second shape. The
// designer asked for "about one fourth", and area is the reading that matters —
// what a pilot feels is how long it takes to cross the thing, and the diagonal
// goes from 14,422 to 7,211.
//
// It has to be small because there is nothing else in here. A claim is a fight you
// can lose by standing still; a duel with a whole galaxy sector to hide in is two
// pilots burning fuel until the wall runs out. At this size a finished ship crosses
// it in under a minute and there is no corner that is not two guns from somewhere.
//
// THE SIZE TRAVELS WITH THE MAP. `w` and `h` are on the sector object and
// `boundsOf()` in shared/sim.js reads them, so the server clamps courses and the
// client draws the minimap against the SAME rectangle. A client drawing at one
// scale while the server clamps at another is precisely what rule one exists to
// stop, and it is the bug this feature was most likely to ship.
//
// --- WHY THE EDGE IS A WALL RATHER THAN THE DRIFT LATTICE --------------------
//
// Everywhere else, space keeps going past the charted rectangle and the hull wears
// the shear — 45 hull/s the instant you cross, 2,000 at the margin. That is a wall
// made of damage, and it works because the pilot chose to go out there.
//
// In here it would be a weapon. A duel is decided by whoever can push the other
// one over the line, which is not a fight, it is a shove; and the loser dies to
// geometry rather than to a gun. So a duel sector is `wall: true` and the edge is
// hard: you stop, you take nothing, and there is nowhere either of you can be that
// is not inside the fight.

import { tollOn, DEATH_TOLL } from './cargo.js';

// --- the sector ---------------------------------------------------------------

export const DUEL_KEY = 'duel';
export const DUEL_W = 6000, DUEL_H = 4000;   // a quarter of 12,000 x 8,000 by area

// Whether this sector is a duel. A property of the SECTOR, never of the ship —
// the same pattern `noLeash` and `dry` use, and for the same reason they use it:
// two pilots of one company may hurt each other IN HERE and nowhere else, and a
// flag on the pilot would follow them out into the open world where an Ironhusk
// must still be an Ironhusk and a fleetmate must still be untouchable.
export const isDuelMap = map => !!map?.duel;

// --- where the two of them stand ----------------------------------------------
//
// Facing each other across the middle, 1,800px apart. Both numbers are picked
// against figures in shared/ships.js rather than by eye:
//
//   every hull's base radar is 2,000 or better, so both pilots can SEE the other
//     one for the whole countdown. A stare-down you cannot see is a loading screen.
//   the longest gun in the game reaches 820, so nobody is in range when the clock
//     lets go — closing is a decision somebody has to make.
//
// The gap between those two figures is the whole of the opening: about a second and
// a half of burn before the first shot is possible, which is long enough to pick a
// side and short enough that neither pilot is bored.
export const START_SEP = 1800;
export const startsAt = i => ({
  x: DUEL_W / 2 + (i === 0 ? -START_SEP / 2 : START_SEP / 2),
  y: DUEL_H / 2,
  heading: i === 0 ? 0 : Math.PI,          // pointed at each other
});

// The way home, dead centre, equidistant from both starts.
//
// Claim arenas have no portals at all, and the client needed a `map.portals.length`
// guard because `MAPS[undefined].tint` is the black-screen bug. This is the first
// portal any instanced sector has ever had, so the guard now has something to
// guard: the portal carries its own `tint` and `home: true` rather than naming a
// destination, because where it goes is different for each of the two pilots.
// `to` is a SENTINEL rather than null, and that is not decoration. stepJump() ends
// with `return s.chargeTo`, and the server's jump path reads a falsy return as "no
// jump happened this tick" — so a portal that led to null would spool for its full
// 2.4 seconds, fire, and do nothing at all, forever, with nothing logged. The
// sentinel is a string that can never be a map id, so every existing comparison
// keeps working and only the one place that acts on the destination has to know.
export const HOME_TO = '@home';
export const PORTAL_TINT = '#7de08a';
export const homePortal = () => ({ x: DUEL_W / 2, y: DUEL_H / 2, to: HOME_TO,
                                   home: true, tint: PORTAL_TINT });

// --- the countdown ------------------------------------------------------------
//
// Five seconds where neither ship can move, turn, fire, launch, route power, jump
// or fold. THE SERVER ENFORCES IT; the client only reads the number off the wire.
// A client that lies about the countdown gains nothing, because every one of those
// is refused server-side and the ships' velocities are zeroed every tick until it
// runs out — a stale course set before the fold cannot coast either.
export const COUNT = 5.0;
export const counting = d => (d?.count ?? 0) > 0;

// May this ship be aimed at from here? ONE predicate, asked by the client when you
// click and by the server when the intent arrives, so the client can never offer a
// shot the server would refuse — the workshop dock refused to sell anything for a
// day because that question was answered in two places.
//
// A hostile, always, everywhere. The other pilot, only inside a duel and only once
// the clock has let go. There is no third case: PvP is a property of the SECTOR and
// nothing about a ship makes it shootable anywhere else.
export const mayAim = ({ co, id } = {}, { foeId = null, count = 0 } = {}) =>
  co === 'x' || (id != null && foeId != null && id === foeId && !(count > 0));

// --- how long a duel may last -------------------------------------------------
//
// Claims have a fifteen-minute wall because a pilot parked in a corner is holding a
// live sector open with no other way to close it. A duel has the same problem and a
// shorter honest answer: there is nothing in here to grind down, so two pilots who
// have not settled it in five minutes are not going to. A finished hull moves at
// 128 to 300, so the 7,211px diagonal is 24 to 56 seconds and five minutes is five
// to twelve crossings of the whole sector — nothing that is actually a fight is cut
// short by it, and a pilot who spends it running has spent it running in front of
// somebody who could see them the entire time.
//
// AND WHY SHIELDS DO NOT COME BACK IN HERE. `dry` in stepVitals is keyed on being
// in an instanced sector, so a duel inherits it from claims — but it earns its keep
// for a different reason. Regeneration is 3.33% of the pool a second, which refills
// a finished ship in half a minute; two evenly matched pilots in a 6,000px box with
// that running have an obvious dominant line, and it is to kite until the wall and
// take the draw. Without it the ship each of them arrives in is all they get, so
// somebody has to commit. A repair kit still works — it costs five seconds of not
// being shot at, which is a decision rather than a rest button.
//
// Running out the wall is a DRAW and it pays nothing. That is deliberate and it is
// the anti-farming rule doing its work from the other end: if the wall paid, the
// cheapest way to move credits between two accounts would be to fly to opposite
// corners and wait.
export const LIMIT = 5 * 60;

// And how long the winner stands in it afterwards. Long enough to scoop what fell
// out of the other ship — the pods are the entire reward and a linger too short to
// collect them would be a stake that evaporates — and long enough to watch the
// wreck, which is the same reason claims have one. Claims use ten; this is twelve
// because there is scooping to do and a pod's tractor takes 0.9s each.
export const LINGER = 12;

// --- consent ------------------------------------------------------------------
//
// A challenge stands for half a minute and then it is gone. Long enough to notice
// a line arriving on a screen you are flying with, short enough that saying yes
// always means yes to the fight you were just offered rather than to one from four
// sectors ago.
export const CHALLENGE_TTL = 30;
// And you may not put another one on the same pilot for this long after the last
// one lapsed or was refused. A challenge is an interruption; an unlimited supply of
// them is harassment with a slash in front of it.
export const CHALLENGE_CD = 60;

// Why these two cannot fight, or null if they can. ONE function, so the command,
// the refusal the challenger reads and the second check on accept all give the same
// answer in the same words — the workshop dock refused to sell anything for a day
// because that was two functions.
//
// `who` and `them` are the same shape: what a pilot is doing right now, as plain
// facts rather than as a player object, so this can be tested without a server.
//
//   { name, token, online, lobby, dead, docked, inArena, folding, jumping, duelling }
//
// WHAT EACH CLAUSE IS FOR, because "a pilot cannot be yanked out of X" is the whole
// safety argument and each X is a different X:
//
//   docked    is NOT here, and it used to be. The argument was that a dock is a
//             haven, so a fold arranged from one can never be cancelled, which
//             removes the mechanic where it would be used most. That gets the
//             fold's purpose backwards. Cancel-on-damage exists so a teleport
//             cannot be an ESCAPE from a fight you are losing — you are being
//             shot, you press a button, you are gone. A duel is the opposite
//             journey: you are leaving somewhere safe, on purpose, to go and be
//             shot at by somebody who agreed to it. There is nothing to escape
//             from and nobody to escape, so an uncancellable fold out of a dock
//             costs no one anything. It was a rule protecting a mechanic rather
//             than protecting a pilot.
//   inArena   a claim is a fight they are already losing money on, and a duel is a
//             fight somebody else has already consented to. Neither is interruptible.
//   dead      a wreck chooses when to go back out. It is not a state you answer from.
//   jumping   mid-spool: a portal is a commitment and it is 1.6s long. Answering
//             from inside one would land them in a sector and then take them out of
//             it before the map message arrived.
//   folding   already going somewhere. Two destinations is a bug, not a duel.
//   lobby     has not joined. There is no ship to fight with.
//
// Note what is NOT here, and it is the same omission whyNotDevice makes on purpose:
// being under fire. You may always ASK, and you may always ACCEPT — what you may
// not do is complete the fold with something landing on you. That is the fold's
// rule, not this one, and putting it here would mean the only time you could
// arrange a duel is a time nobody wanted one.
export function whyNotChallenge(who = {}, them = null, { cooling = 0, pending = false } = {}) {
  if (pending) return 'you already have a challenge out — let it lapse first';
  if (!them) return 'nobody is flying under that name';
  if (them.token && who.token && them.token === who.token) return 'you cannot duel yourself';
  if (cooling > 0) return `wait ${Math.ceil(cooling)}s before challenging them again`;
  for (const [p, mine] of [[who, true], [them, false]]) {
    const say = (a, b) => (mine ? a : b);
    if (p.lobby || !p.online) return say('you are not out there yet', 'they are not flying right now');
    if (p.dead)      return say('you are a wreck — go back out first', 'they are a wreck right now');
    if (p.duelling)  return say('you are already in a duel', 'they are already in a duel');
    if (p.inArena)   return say('you are standing on a claim', 'they are standing on a claim');
    if (p.folding)   return say('you are already folding somewhere', 'they are already folding somewhere');
    if (p.jumping)   return say('you are in a portal', 'they are in a portal');
  }
  return null;
}

// --- the stake ----------------------------------------------------------------
//
// "The ten percent that you lose from your credits and your cargo, for the other
// player that they can pick up."
//
// So it is not a new number. It is EXACTLY what dying already costs — `tollOn()` in
// shared/cargo.js, a tenth of the balance, plus the whole hold on the floor — and
// the only thing a duel changes is where it goes. An ordinary death burns the toll;
// a duel hands it to the pilot who won, as pods, at the wreck.
//
// Mirroring rather than inventing is the point. A duel that cost less than dying
// would be the safest fight in the game and everybody would take one instead of
// flying; a duel that cost more would need its own justification and its own
// balance pass, and there is no reading of the brief that asks for one.
//
// IS IT CAPPED? No, and the arithmetic is why. At an actively-played rate of about
// 55 credits a second — the figure shared/arena.js quotes — a pilot who has bought
// the 8,000,000 credit mine3 claim is plausibly carrying 20,000,000, and a tenth of
// that is 2,000,000: about ten hours of play, in one fight. That is a brutal number
// and it is the RIGHT one, because it is the number they already carry into every
// hostile sector. Capping it would make duelling strictly safer than flying, which
// inverts the risk the rest of the game is built on, and it would do it in the one
// place where both parties consented in advance.
//
// What is owed instead of a cap is DISCLOSURE: the challenge says the number out
// loud, in credits, before anybody says yes. See `challengeText`.
export const stakeCredits = credits => tollOn(credits);
export const STAKE_RATE = DEATH_TOLL;

// What the loser leaves behind, as a plain object the server can drop.
export const stakeOf = (credits, hold = {}) => ({
  cr: stakeCredits(credits),
  hold: Object.fromEntries(Object.entries(hold).filter(([, n]) => n > 0)),
});

// --- ANTI-FARMING, and why there is nothing to farm ---------------------------
//
// Two accounts duelling each other on purpose, forever. Ask what it produces.
//
// A duel is a pure TRANSFER and it creates nothing. The loser's tenth leaves their
// balance and the same tenth arrives in the winner's hold; no credits are minted,
// no ore is spawned, no bounty is paid and no experience changes hands. Running it
// a thousand times between two accounts moves money that already existed from one
// pile to another, which the pair could do by simply agreeing to — there is no
// mechanism here that a second account did not already have.
//
// That is the whole answer, and it is why the stake is a transfer rather than a
// reward. Contrast what a REWARD would have been: any positive number attached to
// winning is multiplied by "as often as you like", and shared/arena.js has already
// written down what happens to a faucet like that. It is the same argument the
// claim rosters lost, in the same words: there is no positive number that survives
// being multiplied by unlimited repetition.
//
// Three specific holes, closed:
//
//   the losing side removes a SINK. An ordinary death burns the toll; a duel hands
//     it over. So credits that would have left the economy stay in it. This is real
//     and it is small: a duel is a VOLUNTARY extra death that replaces no ordinary
//     one, so the sink it removes is a sink that never existed. Nobody dies less
//     often because duels exist.
//   levels and the threat file. A duel pays neither — see PAYS below. Two accounts
//     levelling each other was the obvious exploit and it is simply not implemented.
//   the loser dodging. They cannot: there is no dock, no berth and no shop in a duel
//     sector, so credits and hold are both frozen from the moment they arrive, and
//     every exit — the portal, a beacon, /tp, the tab closing, a second session
//     taking the account over — is a FORFEIT that pays. See the sweep in server.js.
//
// What a duel pays, stated the way claims state it, so the next person can see that
// the answer is the same answer:
export const PAYS = Object.freeze({ bounty: false, xp: false, ore: false, file: false,
                                    // the stake, and it is a transfer rather than a payment
                                    stake: true });

// --- what it says on screen ---------------------------------------------------
//
// The bar geometry is shared/arena.js's `bar()` — the same rectangle, the same
// fitting rules and the same render-harness assertions that it clears the HUD
// columns. This only supplies the words and the tone, longest form first.
export function duelText({ count = 0, foe = '', over = false, won = false,
                           draw = false, left = 0 } = {}) {
  const who = (foe || 'YOUR OPPONENT').toUpperCase();
  if (over) {
    if (draw) return { tone: 'task', forms: [`TIME · NEITHER OF YOU FELL · NOTHING CHANGES HANDS`,
                                             'TIME · A DRAW', 'A DRAW'] };
    return won
      ? { tone: 'won',  forms: [`${who} IS DOWN · SCOOP WHAT IS LEFT OF THEM`,
                                `${who} IS DOWN`, 'YOU WON'] }
      : { tone: 'task', forms: [`YOU LOST TO ${who} · YOUR STAKE IS ON THE FLOOR`,
                                `YOU LOST TO ${who}`, 'YOU LOST'] };
  }
  if (count > 0) {
    const s = Math.ceil(count);
    return { tone: 'task', forms: [`HOLD · ${s} · GUNS AND ENGINES COME BACK AT ZERO`,
                                   `HOLD · ${s}`, `${s}`] };
  }
  const secs = Math.max(0, Math.ceil(left));
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
  return { tone: 'task', forms: [`DUEL · ${who} · ${mm}:${ss} BEFORE IT IS CALLED A DRAW`,
                                 `DUEL · ${who} · ${mm}:${ss}`, `DUEL · ${mm}:${ss}`] };
}

// The line the challenged pilot reads, and the one thing that makes an uncapped
// stake fair: they are told the number before they answer.
export const challengeText = (from, stake) =>
  `${from} challenges you to a duel — /accept or /decline. ` +
  `It stakes a tenth of your credits and everything in your hold; ` +
  `theirs on the table is ${stake.cr.toLocaleString('en-US')} cr.`;
