// Choosing who you are.
//
// A pilot picks a callsign and a company once, and then that is who they are —
// the name is on your hull for everyone else in the sector, so it is worth a
// moment's validation rather than accepting whatever arrives on the wire.
//
// The rules live here because the join form and the server both have to agree
// about them, and a form that accepts what the server refuses is worse than one
// that refuses too much.

export const NAME_MIN = 3, NAME_MAX = 16;

// Letters, digits, and the punctuation that turns up in real callsigns. No
// leading punctuation, nothing that could be mistaken for a system message, and
// nothing invisible.
const SHAPE = /^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/;

// Trim, collapse runs of spaces, and cut to length. Applied on both sides, so
// what you typed and what gets stored are the same string.
export const cleanName = raw =>
  String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

const has = (list, n) => list.some(t => String(t).toLowerCase() === n.toLowerCase());

// Why this name will not do, or null if it will.
//
// `mine` is the other pilots in THIS browser, which only the client knows — the
// server has no idea two accounts belong to one person and must not. It is a
// separate argument rather than more entries in `taken` because the refusal has
// to be different: "someone already flies under that name" is true and useless
// when the someone is you, two rows up the menu you just came from, and a pilot
// naming their second character after their first is the collision they are most
// likely to hit. Checked BEFORE `taken` for that reason — your own pilot is in
// both lists, and the message that names them is the one worth printing.
export function nameProblem(raw, taken = [], mine = []) {
  const n = cleanName(raw);
  if (n.length < NAME_MIN) return `at least ${NAME_MIN} characters`;
  if (!SHAPE.test(n)) return 'letters and digits, and . _ - \' between them';
  if (has(mine, n)) return 'that is your other pilot — each one needs its own name';
  if (has(taken, n)) return 'someone already flies under that name';
  return null;
}

export const nameOk = (raw, taken = [], mine = []) => nameProblem(raw, taken, mine) === null;
