// The name, in one place. Everything that shows it to a person reads it from here.
export const GAME = 'Nullpoint';

// Storage keys are namespaced by the name, so renaming the game would orphan an
// existing pilot's token. OLD_KEYS is the migration path: read them once, write
// the current one, and nobody loses their ship to a rebrand.
export const TOKEN_KEY = 'nullpoint.token';
export const OLD_TOKEN_KEYS = ['aphelion.token'];
