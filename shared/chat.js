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
  dev:   { admin: true,  args: '',                help: 'the testing ground, and back again' },
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
