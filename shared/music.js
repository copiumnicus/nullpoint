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
export const LIVE_MOODS = ['all', 'ambient'];
export const inRotation = name => LIVE_MOODS.includes(MOOD_OF(name));
export const parkedMoods = list =>
  [...new Set(list.map(MOOD_OF).filter(m => !LIVE_MOODS.includes(m)))].sort();

// A name is servable only if it is one we actually listed. Membership, not string
// surgery: no amount of encoding gets you a file that is not in the directory.
export const servable = (name, list) => list.includes(name) && isTrack(name.split('/').pop());
