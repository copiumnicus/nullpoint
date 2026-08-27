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

let ctx = null, master = null, verb = null, drive = null, zap = null;
let thrGain = null, thrFilter = null;
let on = true;
const firing = [];                 // when each live gun voice ends, oldest first

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
  master.gain.value = 0.5;
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

  // A short feedback delay. The repeating tail is most of what makes a swept tone
  // read as a laser rather than as a falling bleep.
  const dl = ctx.createDelay(0.5);
  dl.delayTime.value = 0.085;
  const fb = ctx.createGain(); fb.gain.value = 0.3;
  const dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass'; dlp.frequency.value = 1800;
  zap = ctx.createGain(); zap.gain.value = 1;
  zap.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(master);

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
// for weight, through a resonant lowpass that tracks the sweep, into a short
// feedback delay. That fall is what reads as a laser; the resonance and the
// repeating tail are what stop it reading as a bleep.
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

  const peak = 0.3 * near * near * (mine ? 1 : 0.82);
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
  amp.connect(zap);                                // the tail
  send(amp, 0.22, t);

  body.start(t); body.stop(t + dur + 0.04);
  sub.start(t);  sub.stop(t + dur + 0.04);
}

// A kill: a long filtered noise collapse with a sub dropping under it, thrown
// deep into the reverb. Loud, slow, and nothing like the guns.
export function explosion(dist, foe) {
  if (!ctx || !on) return;
  const near = 1 - Math.min(1, dist / 2600);
  if (near < 0.04) return;
  const t = ctx.currentTime;
  const peak = 0.6 * near * near;

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

export function toggleAudio() { on = !on; if (!on) setThrust(0); return on; }
export const audioOn = () => on;
