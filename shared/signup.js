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

// Why this name will not do, or null if it will.
export function nameProblem(raw, taken = []) {
  const n = cleanName(raw);
  if (n.length < NAME_MIN) return `at least ${NAME_MIN} characters`;
  if (!SHAPE.test(n)) return 'letters and digits, and . _ - \' between them';
  if (taken.some(t => t.toLowerCase() === n.toLowerCase())) return 'someone already flies under that name';
  return null;
}

export const nameOk = (raw, taken = []) => nameProblem(raw, taken) === null;
