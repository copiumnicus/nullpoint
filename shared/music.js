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
export const LIVE_MOODS = ['all', 'ambient', 'chase', 'combat'];
export const inRotation = name => LIVE_MOODS.includes(MOOD_OF(name));
export const parkedMoods = list =>
  [...new Set(list.map(MOOD_OF).filter(m => !LIVE_MOODS.includes(m)))].sort();

// Which deck a track belongs on. Loose files and ambient/ are the score you fly
// to; combat/ is the one that comes up when something is shooting at you.
// Anything else is parked and belongs on neither.
export const CALM = 'calm', CHASE = 'chase', COMBAT = 'combat';

// Not a folder — a deliberate gap. After a fight the score does not come
// straight back; there is a stretch of nothing first, which gives another pass a
// chance to start before anything changes and keeps the soundtrack from flapping
// in and out of combat over a two minute patrol.
export const QUIET = 'quiet';
export const COOLDOWN = 30_000;      // ms of silence between a fight and the score
export function poolOf(name) {
  const m = MOOD_OF(name);
  if (m === COMBAT || m === CHASE) return m;
  return LIVE_MOODS.includes(m) ? CALM : null;
}

// What to play when the folder for a mood is empty. Being hunted with nothing to
// play for it should not sound like nothing is happening, so it borrows the
// fight; a fight with no music of its own falls back to the score.
export const FALLBACK = { [CHASE]: [CHASE, COMBAT, CALM], [COMBAT]: [COMBAT, CALM],
                          [CALM]: [CALM], [QUIET]: [QUIET] };
// Silence never falls back to anything: it is the point, not an absence.
export const resolveMood = (want, has) =>
  want === QUIET ? QUIET : ((FALLBACK[want] ?? [CALM]).find(m => has(m)) ?? CALM);

// A name is servable only if it is one we actually listed. Membership, not string
// surgery: no amount of encoding gets you a file that is not in the directory.
export const servable = (name, list) => list.includes(name) && isTrack(name.split('/').pop());

// What the fight sounds like, and — more importantly — when it is over.
//
// Three states, not two. Shooting at something is a fight. Being shot at while
// not shooting back is a chase: you are crossing a map with something on you and
// have decided not to turn and trade, which is a different feeling and deserves
// a different track. Fighting back beats being hunted, because the moment you
// return fire it stops being a chase.
//
// Arriving is instant and leaving is not. A lull between passes is not the end of a
// fight, and music that drops out and comes straight back is worse than music that
// never changed. So whichever mood was last active is held for a while after the
// last shot, and the crossfade runs on top of that: the hold is the buffer, the fade
// is the manners.
//
// It was seven seconds, and seven was measurably the wrong side of the gap it exists
// to cover. Farming is kill, fly, kill, and the flight is not short: a respawn puts
// the next hostile at least SPAWN_CLEAR — 2,400px — from anybody standing there, and
// a starter hull covers that at 300px/s. Eight seconds, before you have found it,
// turned onto it, or closed to weapons range. So the score reliably gave up about a
// second before the next fight started, dropped to silence, and came straight back:
// the exact shape this hold was written to prevent, one number too small to do it.
//
// Fourteen is that flight with room around both ends, and it is also the Drifter's
// posted respawn — the cadence of the content a pilot is actually farming when they
// notice this. Escalating is still instant; only stepping down waits.
export const COMBAT_HOLD = 14_000;    // ms of quiet before it counts as over

// Escalating is instant; stepping down waits out the hold. Switching targets
// mid-fight leaves a moment where you are not shooting at anything and something
// is still shooting at you, and without this the music dips into the chase and
// back on every retarget.
const RANK = { [CALM]: 0, [QUIET]: 0, [CHASE]: 1, [COMBAT]: 2 };

export function moodFor({ fighting = false, hunted = false } = {}, now = 0,
                        held = { mood: CALM, until: 0, calmAt: 0 }) {
  const want = fighting ? COMBAT : hunted ? CHASE : null;
  if (want) {
    const hold = now < held.until && RANK[held.mood] > RANK[want];
    return { mood: hold ? held.mood : want, until: now + COMBAT_HOLD, calmAt: 0 };
  }
  if (now < held.until) return held;                    // the fight is still warm
  // It is over. Silence for a while before the score comes back — and only on
  // the way down; a fight starting again is still instant.
  const calmAt = held.calmAt || (RANK[held.mood] > 0 ? now + COOLDOWN : 0);
  if (calmAt && now < calmAt) return { mood: QUIET, until: 0, calmAt };
  return { mood: CALM, until: 0, calmAt: 0 };
}

// Picking the next track.
//
// Not plain random: plain random plays the same piece twice in a row often
// enough to notice, and leaves one track unheard for an hour. This is a bag —
// every track goes in, they come out one at a time in a shuffled order, and the
// bag is only refilled once it is empty. So you hear all of them before you hear
// any of them twice, and a refill never lands on whatever just finished.
//
// Pure so it can be tested. The caller keeps the bag and the last pick.
export function drawNext(bag, pool, last = null, rand = Math.random) {
  if (!pool.length) return { pick: null, bag: [] };
  let next = bag.filter(k => pool.includes(k));      // the pool can change under us
  if (!next.length) {
    next = [...pool];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    // A fresh bag that opens on the track that just played is the one repeat
    // this is meant to avoid, so move it back.
    if (next.length > 1 && next[0] === last) next.push(next.shift());
  }
  return { pick: next[0], bag: next.slice(1) };
}

// Levelling.
//
// Tracks written at different times are mastered at different loudnesses, and a
// playlist that jumps 6dB between pieces is one you keep reaching for the volume
// during. There is no loudness tag to read and the files are streamed rather
// than decoded, so the level is measured off the output and corrected toward a
// target — slowly, because anything quick enough to react to a passage would
// breathe on the music.
export const TARGET_RMS = 0.09;      // about -21 dBFS, a background level
export const GAIN_MIN = 0.3, GAIN_MAX = 3.2;
export const SETTLE = 0.18;          // fraction of the way per measurement
export const FLOOR_RMS = 0.004;      // below this it is a quiet passage, not a level

// One step toward the right gain for a track, given what the meter just read.
// Returns the gain unchanged when the reading says nothing.
export function levelStep(rms, gain = 1) {
  if (!(rms > FLOOR_RMS)) return gain;
  const fit = Math.max(GAIN_MIN, Math.min(GAIN_MAX, TARGET_RMS / rms));
  return gain + (fit - gain) * SETTLE;
}
