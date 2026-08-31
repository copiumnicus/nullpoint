// Chat, and the console hiding inside it.
//
// Anything typed is a message to the sector unless it starts with a slash. The
// commands exist so a feature can be tested in seconds instead of farmed for
// twenty minutes — which means they are exactly the thing that must never be
// reachable on a deployed game.

export const MAX_LEN = 160;
export const LOG_KEEP = 40;

export const COMMANDS = {
  help:  { admin: false, args: '',                help: 'list what you can type' },
  where: { admin: false, args: '',                help: 'name the sector you are in' },
  money: { admin: true,  args: '<amount>',        help: 'add credits' },
  xp:    { admin: true,  args: '<amount>',        help: 'add experience' },
  gear:  { admin: true,  args: '<item> [count]',  help: 'put equipment in your inventory' },
  ammo:  { admin: true,  args: '<grade> [count]', help: 'top up a magazine' },
  ship:  { admin: true,  args: '<hull>',          help: 'grant a hull' },
  form:  { admin: true,  args: '<formation>',     help: 'grant and fly a drone formation' },
  ore:   { admin: true,  args: '<metal> [count]', help: 'put ore in the company hangar' },
  tp:    { admin: true,  args: '<map>',           help: 'jump straight to a sector' },
  heal:  { admin: true,  args: '',                help: 'full hull, shields and capacitor' },
  // The other half of /heal, and it exists for the same reason: the wreck path is
  // the hardest thing in the game to reach on purpose. Respawning had been landing
  // pilots nowhere since 0.33 and nobody could reproduce it in under a minute.
  kill:  { admin: true,  args: '',                help: 'destroy your own ship, to see what happens next' },
  // Empties the sector you are standing in. The firing line on /dev had no way to
  // be cleared, and a claim cannot be WON in a test any other way.
  clear: { admin: true,  args: '',                help: 'kill every hostile in this sector' },
  // The plot is a few hundred pixels off the dock and everything on the research
  // ladder is refused unless you are standing at it.
  tolab: { admin: true,  args: '',                help: 'stand at your own research station' },
  // The only visibility a server has into its instanced sectors: they are not in
  // MAPS, not on the chart, and nobody but their one pilot can ever see one.
  arenas:{ admin: true,  args: '',                help: 'what claim sectors are open right now' },
  dev:   { admin: true,  args: '',                help: 'the testing ground, and back again' },
  // A duel. Not admin: it is the one piece of player-versus-player in the game and
  // it is entirely opt-in on both ends — you ask, they answer, and either of you
  // can simply not. `1v1` rather than `duel` because that is what the request was
  // written as and it is what people type.
  '1v1':   { admin: false, args: '<callsign>', help: 'challenge another pilot to a duel' },
  accept:  { admin: false, args: '',           help: 'take the duel somebody offered you' },
  decline: { admin: false, args: '',           help: 'refuse it' },
  reset: { admin: true,  args: '[all]',           help: 'wipe your progress — `all` also forgets who you are' },
};

export const parse = line => {
  const t = String(line ?? '').trim().slice(0, MAX_LEN);
  if (!t.startsWith('/')) return { say: t };
  const [cmd, ...args] = t.slice(1).split(/\s+/);
  return { cmd: cmd.toLowerCase(), args };
};

// A number a player typed. Never NaN, never negative, never absurd.
export const amount = (raw, cap = 1e9) =>
  Math.max(0, Math.min(cap, Math.floor(Number(raw) || 0)));
