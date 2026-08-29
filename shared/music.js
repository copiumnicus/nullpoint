// The playlist, such as it is: whatever audio is sitting in public/music.
//
// The directory is the manifest — adding a track is copying a file in, and there
// is nothing to keep in sync. That means a filename coming back from a client is
// the only thing standing between the music route and the rest of the disk, so
// the rules about what counts as a track live here, on their own, where a test
// can hold them.

export const AUDIO_TYPE = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4' };

// Ordinary filenames only. No slashes, no dots leading a segment, nothing that
// could climb out of the directory it was found in.
export const SAFE_NAME = /^[\w][\w .()'\-]*\.[a-z0-9]+$/i;

export const typeOf = name => AUDIO_TYPE[String(name).split('.').pop().toLowerCase()];
export const isTrack = name => SAFE_NAME.test(name) && !!typeOf(name);

// One level of subfolder is the mood. A track sitting loose in the directory has
// no mood and plays as general score.
export const MOOD_OF = name => (String(name).includes('/') ? name.split('/')[0] : 'all');

// The moods there is currently a system to play. Everything else is parked: it
// is listed, it is servable, it stays where you put it, and it does not come up
// in the shuffle. That is what a folder is for here — boss/ can sit there fully
// loaded until there is a boss to play it at, without being deleted or renamed
// or remembered about.
export const LIVE_MOODS = ['all', 'ambient', 'combat'];
export const inRotation = name => LIVE_MOODS.includes(MOOD_OF(name));
export const parkedMoods = list =>
  [...new Set(list.map(MOOD_OF).filter(m => !LIVE_MOODS.includes(m)))].sort();

// Which deck a track belongs on. Loose files and ambient/ are the score you fly
// to; combat/ is the one that comes up when something is shooting at you.
// Anything else is parked and belongs on neither.
export const CALM = 'calm', COMBAT = 'combat';
export function poolOf(name) {
  const m = MOOD_OF(name);
  if (m === 'combat') return COMBAT;
  return LIVE_MOODS.includes(m) ? CALM : null;
}

// A name is servable only if it is one we actually listed. Membership, not string
// surgery: no amount of encoding gets you a file that is not in the directory.
export const servable = (name, list) => list.includes(name) && isTrack(name.split('/').pop());

// When the fight is on, and — more importantly — when it is over.
//
// Arriving is instant and leaving is not. A two second lull between passes is
// not the end of a fight, and music that drops out and comes straight back is
// worse than music that never changed. So the combat deck is held for a while
// after the last shot, and the crossfade runs on top of that: the hold is the
// buffer, the fade is the manners.
export const COMBAT_HOLD = 7000;      // ms of quiet before it counts as over

export function moodFor(fighting, now, heldUntil = 0) {
  const until = fighting ? now + COMBAT_HOLD : heldUntil;
  return { mood: now < until ? COMBAT : CALM, until };
}
