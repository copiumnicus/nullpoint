// Where things live on disk.
//
// No environment variables for any of this. A path is a fact about the
// deployment, not a knob someone should have to remember to set in a dashboard —
// and a missing one fails silently and late, with the music simply absent and no
// error anywhere.
//
// Both lists are tried in order and the first that exists wins, so the same
// build runs from a checkout and from a mounted volume without being told which
// it is. Mount a Railway volume at /data and it is found; do not, and the repo's
// own folders are used.

export const DATA_DIRS  = ['/data', 'data'];
export const MUSIC_DIRS = ['/data/music', 'public/music'];

// First of the candidates that is really there, or the last as a fallback so
// callers always get a path to try rather than undefined.
export const pickDir = (candidates, exists) =>
  candidates.find(d => exists(d)) ?? candidates[candidates.length - 1];
