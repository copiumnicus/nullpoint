// The name, in one place. Everything that shows it to a person reads it from here.
export const GAME = 'Nullpoint';

// Storage keys are namespaced by the name, so renaming the game would orphan an
// existing pilot's token. OLD_KEYS is the migration path: read them once, write
// the current one, and nobody loses their ship to a rebrand.
export const TOKEN_KEY = 'nullpoint.token';
export const OLD_TOKEN_KEYS = ['aphelion.token'];

// And the roster beside it: the OTHER pilots this browser holds. TOKEN_KEY is
// still the whole identity — the one being flown — and this is only the list you
// can switch between, so a browser whose roster is missing or unreadable is a
// browser with exactly one pilot, which is what every browser was until now.
export const ROSTER_KEY = 'nullpoint.pilots';
