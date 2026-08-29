// Sound, synthesised on the spot. No files to fetch — the timbres are numbers in
// this file, tunable like any other balance value.
//
// The palette is industrial dark ambient: detuned saturated bass, metallic
// transients, everything low-passed and pushed into a long dark reverb. Nothing
// bright, nothing melodic, nothing that reads as an arcade zap. Guns are felt low
// down rather than heard up top, so they sit under a score instead of fighting it.
//
// Every entry point is a no-op until a real AudioContext exists, so the render
// harness and any browser that blocks audio run the same path harmlessly.

let ctx = null, master = null, verb = null, drive = null;
let thrGain = null, thrFilter = null;
// Three levels, three switches. `on` is the master — one key, everything quiet.
// Under it the effects and the score are independent, because working on music
// for a game means wanting the game running and the game silent at the same time.
let on = true, sfxOn = true, musicOn = true;
let sfxVol = 0.5;
const firing = [];                 // when each live gun voice ends, oldest first

// Drop files into public/sfx and they replace the synthesis. rate below 1 plays
// slower and so deeper, which is what a stock laser effect usually needs to sit
// under a dark score. Missing files simply fall through to the synth.
export const SFX = {
  laser: { url: '/sfx/laser.mp3',       rate: 0.75, gain: 1.0 },
  enemy: { url: '/sfx/laser-enemy.mp3', rate: 0.60, gain: 0.9 },
  boom:  { url: '/sfx/explosion.mp3',   rate: 0.85, gain: 1.0 },
  pod:   { url: '/sfx/rocket.mp3',      rate: 0.90, gain: 1.0 },
};
const clip = {};
export const usingSamples = () => Object.keys(clip);

function loadSfx() {
  if (typeof fetch !== 'function' || typeof ctx.decodeAudioData !== 'function') return;
  for (const [k, s] of Object.entries(SFX))
    fetch(s.url)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => ab && ctx.decodeAudioData(ab))
      .then(b => { if (b) clip[k] = b; })
      .catch(() => {});                            // no file, no problem
}

function playClip(buffer, cfg, peak, t, verbSend) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = cfg.rate * (0.97 + Math.random() * 0.06);   // never twice the same
  const g = ctx.createGain();
  g.gain.value = peak * cfg.gain;
  src.connect(g); g.connect(master);
  send(g, verbSend, t);
  src.start(t);
}

export const LASER_GAIN = 0.15;   // half what it was: they were shouting
export const LASER_VERB = 0;      // dry. Any tail at this fire rate turns into mush

const saturation = () => {         // soft clip: grit without a fizz
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n / 2) - 1; c[i] = Math.tanh(x * 2.6); }
  return c;
};

export function audioReady() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = sfxLevel();
  drive = ctx.createWaveShaper();
  drive.curve = saturation();
  master.connect(drive);
  drive.connect(ctx.destination);

  // A dark tail: noise decaying over ~3s, rolled off hard so the reverb is felt
  // as space rather than heard as a wash.
  const sr = ctx.sampleRate, len = Math.floor(sr * 3.1);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let run = 0;
    for (let i = 0; i < len; i++) {
      run = (run + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      d[i] = run * 5 * Math.pow(1 - i / len, 2.6);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const vlp = ctx.createBiquadFilter();
  vlp.type = 'lowpass'; vlp.frequency.value = 900;
  verb = ctx.createGain(); verb.gain.value = 1;
  verb.connect(conv); conv.connect(vlp); vlp.connect(master);

  // Thruster: brown noise, so it rumbles instead of hissing.
  const blen = Math.floor(sr * 2);
  const buf = ctx.createBuffer(1, blen, sr);
  const d = buf.getChannelData(0);
  let run = 0;
  for (let i = 0; i < blen; i++) { run = (run + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = run * 3.2; }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  thrFilter = ctx.createBiquadFilter();
  thrFilter.type = 'lowpass'; thrFilter.frequency.value = 300; thrFilter.Q.value = 0.7;
  thrGain = ctx.createGain(); thrGain.gain.value = 0;
  src.connect(thrFilter); thrFilter.connect(thrGain); thrGain.connect(master);
  src.start();

  loadSfx();
}

// v is 0..1 of top speed. The filter opens with the gain, so hard burn is
// brighter rather than only louder.
export function setThrust(v) {
  if (!ctx || !thrGain) return;
  const k = on ? Math.max(0, Math.min(1, v)) : 0;
  thrGain.gain.setTargetAtTime(k * 0.32, ctx.currentTime, 0.09);
  thrFilter.frequency.setTargetAtTime(240 + k * 620, ctx.currentTime, 0.12);
}

const send = (node, amount, t, dur) => {           // into the reverb bus
  const s = ctx.createGain();
  s.gain.setValueAtTime(amount, t);
  node.connect(s); s.connect(verb);
  return s;
};

// A shot is a swept tone: a triangle falling fast, an octave-down sine under it
// for weight, through a resonant lowpass that tracks the sweep. The fall is what
// reads as a laser, and the resonance is what stops it reading as a bleep.
//
// Completely dry — no delay, no reverb send. A tail on a single shot sounds like
// a film effect; on a gun cycling twice a second it just smears into the next
// one, and three of those at once is mud. Explosions keep the reverb because
// they happen rarely and want the space.
//
// Pitched well below a typical film-effect laser on purpose, so it sits under a
// dark ambient score instead of cutting across it. Yours starts higher than
// theirs, which is the only thing separating them.
export function laser(mine, dist) {
  if (!ctx || !on) return;
  const near = 1 - Math.min(1, dist / 1500);
  if (near < 0.05) return;
  const t = ctx.currentTime;
  while (firing.length && firing[0] <= t) firing.shift();
  if (firing.length >= 6) return;                  // a brawl should not become a buzz
  firing.push(t + 0.3);

  // Guns fire constantly, so they sit well under the explosions and the score.
  const peak = LASER_GAIN * near * near * (mine ? 1 : 0.82);

  const sample = mine ? clip.laser : (clip.enemy ?? clip.laser);
  if (sample) return playClip(sample, mine ? SFX.laser : SFX.enemy, peak, t, LASER_VERB);

  const f0 = mine ? 920 : 620, f1 = mine ? 76 : 50;
  const dur = mine ? 0.26 : 0.32;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  const lp = ctx.createBiquadFilter();             // resonance riding the sweep
  lp.type = 'lowpass'; lp.Q.value = 9;
  lp.frequency.setValueAtTime(f0 * 2.4, t);
  lp.frequency.exponentialRampToValueAtTime(f1 * 3, t + dur * 0.85);

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(f0, t);
  body.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);

  const sub = ctx.createOscillator();              // an octave down, for the depth
  sub.type = 'sine';
  sub.frequency.setValueAtTime(f0 / 2, t);
  sub.frequency.exponentialRampToValueAtTime(f1 / 2, t + dur * 0.8);
  const subG = ctx.createGain(); subG.gain.value = 0.55;

  body.connect(lp);
  sub.connect(subG); subG.connect(lp);
  lp.connect(amp); amp.connect(master);
  if (LASER_VERB > 0) send(amp, LASER_VERB, t);

  body.start(t); body.stop(t + dur + 0.04);
  sub.start(t);  sub.stop(t + dur + 0.04);
}

// A rocket leaving the rail. Guns are a short bright zap; this has to be the
// opposite or a fan of five just sounds like a stuck trigger — a noise whoosh
// that opens up rather than decays, with a low thump under the ignition. One
// call per volley, however many rockets are in it.
export function rocket(mine, dist) {
  if (!ctx || !on) return;
  const near = 1 - Math.min(1, dist / 1800);
  if (near < 0.05) return;
  const t = ctx.currentTime;
  const peak = 0.34 * near * near * (mine ? 1 : 0.85);

  if (clip.pod) return playClip(clip.pod, SFX.pod, peak, t, 0.22);

  const dur = 0.55;
  const n = Math.floor(ctx.sampleRate * dur);
  const nb = ctx.createBuffer(1, n, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  let run = 0;
  for (let i = 0; i < n; i++) {                    // brown noise: motor, not static
    run = (run + 0.06 * (Math.random() * 2 - 1)) / 1.06;
    nd[i] = run * 4;
  }
  const src = ctx.createBufferSource(); src.buffer = nb;

  const bp = ctx.createBiquadFilter();             // the whoosh: a band opening upward
  bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(240, t);
  bp.frequency.exponentialRampToValueAtTime(mine ? 2100 : 1500, t + dur * 0.8);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.05);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  const thump = ctx.createOscillator();            // ignition, an octave under it all
  thump.type = 'sine';
  thump.frequency.setValueAtTime(mine ? 150 : 120, t);
  thump.frequency.exponentialRampToValueAtTime(48, t + 0.22);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(Math.max(0.0002, peak * 0.8), t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);

  src.connect(bp); bp.connect(amp); amp.connect(master);
  thump.connect(tg); tg.connect(master);
  send(amp, 0.18, t);

  src.start(t); src.stop(t + dur + 0.05);
  thump.start(t); thump.stop(t + 0.3);
}

// A kill: a long filtered noise collapse with a sub dropping under it, thrown
// deep into the reverb. Loud, slow, and nothing like the guns.
export function explosion(dist, foe) {
  if (!ctx || !on) return;
  const near = 1 - Math.min(1, dist / 2600);
  if (near < 0.04) return;
  const t = ctx.currentTime;
  const peak = 0.6 * near * near;

  if (clip.boom) return playClip(clip.boom, SFX.boom, peak, t, 0.5);

  const n = Math.floor(ctx.sampleRate * 1.8);
  const nb = ctx.createBuffer(1, n, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  let run = 0;
  for (let i = 0; i < n; i++) {
    run = (run + 0.05 * (Math.random() * 2 - 1)) / 1.05;
    nd[i] = run * 4 * Math.pow(1 - i / n, 1.7);
  }
  const src = ctx.createBufferSource(); src.buffer = nb;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 2;
  lp.frequency.setValueAtTime(foe ? 1100 : 800, t);
  lp.frequency.exponentialRampToValueAtTime(60, t + 1.4);
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(peak, t);
  g1.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
  src.connect(lp); lp.connect(g1); g1.connect(master);
  send(g1, 0.75, t);
  src.start(t);

  const sub = ctx.createOscillator();              // the floor dropping out
  sub.type = 'sine';
  sub.frequency.setValueAtTime(foe ? 120 : 96, t);
  sub.frequency.exponentialRampToValueAtTime(26, t + 0.9);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.9), t + 0.03);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  sub.connect(g2); g2.connect(master);
  send(g2, 0.4, t);
  sub.start(t); sub.stop(t + 1.25);
}

// --- music --------------------------------------------------------------------
// Two decks running side by side, one per mood, crossfaded between. Whatever is
// sitting in public/music is sorted onto them once at startup: loose files and
// ambient/ are what you fly to, combat/ is what comes up when something is
// shooting at you. Anything else is parked and plays on neither.
//
// Nothing cuts. The deck coming up ramps in over a couple of seconds while the
// other ramps out, and the caller decides when a fight is over — a short lull is
// not the end of one, so that judgement lives with whoever can see the fight.
//
// With no combat tracks on disk the combat deck simply never exists and the
// score carries on, which is the right behaviour for a folder you have not filled.

export const CALM = 'calm';                       // the deck everything falls back to
export const FADE_S = 2.2;                       // seconds any deck takes to arrive or leave

// A deck per mood, created as the sorter turns one up. This module does not know
// what the moods are or what they mean — that is shared/music.js — it only knows
// how to run one deck at a time and fade between them.
const pools = { [CALM]: [] };
const decks = {};                                // mood -> { el, gain, bag, last, level }
let musicVol = 0.55, musicWanted = false, onTrack = null, parked = [];
let mood = CALM, fader = null;

export const MUSIC_VOL_STEP = 0.1;
export const musicVolume = () => musicVol;
export const musicMood = () => mood;
export const musicList = () => Object.values(pools).flat();
export const musicParked = () => [...parked];
export const hasMood = m => pools[m]?.length > 0;
export const musicTrack = () => decks[mood]?.last ?? null;

// Called whenever the audible track changes, so the HUD can name it.
export const onMusicChange = fn => { onTrack = fn; };

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// `pick` chooses the next track for a deck from its bag, returning { pick, bag }.
// Passed in with `sort` because this module depends on nothing: the rules about
// moods and about not repeating yourself live in shared/music.js, next to the
// tests that hold them.
let choose = (bag, pool) => ({ pick: pool[0] ?? null, bag: [] });
export const setPicker = fn => { choose = fn; };

// `sort` says which deck a filename belongs on, or null to leave it parked. It is
// passed in rather than imported because this module depends on nothing.
export async function startMusic(sort = () => CALM) {
  musicWanted = true;
  if (musicList().length || typeof fetch !== 'function' || typeof Audio !== 'function') return;
  let all = [];
  try {
    const r = await fetch('/music/list');
    if (!r.ok) return;
    all = await r.json();
  } catch { return; }                              // no server, no music, no noise about it
  for (const name of all) {
    const p = sort(name);
    if (!p) { parked.push(name); continue; }
    (pools[p] ??= []).push(name);
  }
  for (const p of Object.values(pools)) shuffle(p);
  console.info('music: ' + Object.entries(pools).map(([m, l]) => `${l.length} ${m}`).join(', ') +
               (parked.length ? `, ${parked.length} parked` : ''));
  if (pools[CALM].length) { deckFor(CALM); play(CALM); }
}

function deckFor(m) {
  if (decks[m] || typeof Audio !== 'function') return decks[m];
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.addEventListener('ended', () => play(m));
  // A track that will not decode should not stall the deck behind it.
  el.addEventListener('error', () => { if (pools[m].length > 1) play(m); });
  decks[m] = { el, gain: null, bag: [], last: null, level: m === mood ? 1 : 0 };
  return decks[m];
}

function play(m) {
  const d = deckFor(m);
  if (!d || !pools[m].length) return;
  const { pick, bag } = choose(d.bag, pools[m], d.last);
  if (!pick) return;
  d.bag = bag; d.last = pick;
  d.el.src = '/music/' + encodeURIComponent(pick).replace(/%2F/gi, '/');
  wire(d);
  const go = d.el.play();
  if (go?.catch) go.catch(() => {});              // autoplay refused: the next gesture retries
  if (m === mood && onTrack) onTrack(pick);
}

// Skip whatever is audible right now.
export function nextTrack() { play(mood); }

// Move to a mood. Nothing happens if there is no music for it, so an empty
// combat/ folder leaves the score alone rather than dropping to silence.
//
// Every switch draws a fresh track rather than resuming where that deck was
// paused. Coming back to the same combat piece from thirty seconds in, every
// fight, is the thing that makes a soundtrack feel small.
export function setMood(m) {
  if (m === mood || !pools[m]?.length) return mood;
  mood = m;
  play(m);
  ramp();
  return mood;
}

// Where each deck should sit: the audible one at the set level, the others out.
const target = m => (m === mood ? musicLevel() : 0);

function ramp() {
  if (fader || typeof setInterval !== 'function') { applyMusicGain(); return; }
  const stepEvery = 50, per = stepEvery / (FADE_S * 1000);
  fader = setInterval(() => {
    let moving = false;
    for (const m of Object.keys(decks)) {
      const d = decks[m], want = target(m);
      if (Math.abs(d.level - want) < 1e-3) { d.level = want; }
      else { d.level += Math.sign(want - d.level) * Math.min(per, Math.abs(want - d.level)); moving = true; }
      setGain(d);
      // A deck that has faded all the way out stops, so it is not burning
      // bandwidth playing to nobody.
      if (!moving && d.level === 0 && m !== mood && !d.el.paused) d.el.pause();
    }
    if (!moving) { clearInterval(fader); fader = null; }
  }, stepEvery);
}

const musicLevel = () => (on && musicOn && musicWanted ? musicVol : 0);

// The graph is only available once a context exists, and a context only exists
// after a gesture. Until then the element's own volume carries the setting.
function wire(d) {
  if (d.gain || !ctx || typeof ctx.createMediaElementSource !== 'function') return;
  try {
    d.gain = ctx.createGain();
    ctx.createMediaElementSource(d.el).connect(d.gain);
    d.gain.connect(ctx.destination);               // past the saturation, on purpose
    d.el.volume = 1;
  } catch { d.gain = null; }                       // some browsers refuse; fall back to el.volume
}

function setGain(d) {
  wire(d);
  if (d.gain) d.gain.gain.value = d.level;
  else d.el.volume = Math.max(0, Math.min(1, d.level));
}

function applyMusicGain() {
  for (const m of Object.keys(decks)) {
    const d = decks[m];
    d.level = target(m);
    setGain(d);
  }
}

export function setMusicVolume(v) {
  musicVol = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
  applyMusicGain();
  return musicVol;
}
const sfxLevel   = () => (on && sfxOn ? sfxVol : 0);

function applyAll() {
  if (master) master.gain.value = sfxLevel();
  if (!sfxLevel()) setThrust(0);                   // the thruster is a held tone, not a one-shot
  applyMusicGain();
}

export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
  applyAll();
  return sfxVol;
}
export const sfxVolume = () => sfxVol;

export function toggleAudio() { on = !on; applyAll(); return on; }
export function toggleSfx()   { sfxOn = !sfxOn; applyAll(); return sfxOn; }
export function toggleMusic() { musicOn = !musicOn; applyAll(); return musicOn; }
export const audioOn = () => on;
export const sfxOnly = () => sfxOn;
export const musicOnly = () => musicOn;
