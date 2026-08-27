// Sound, synthesised on the spot. No files to fetch and no assets to manage — the
// timbres are numbers in this file, tunable like any other balance value.
//
// Everything is a no-op until a real AudioContext exists, so the render harness
// (and any browser that blocks audio) runs the same code path harmlessly.

let ctx = null, master = null, thrGain = null, thrFilter = null;
let on = true;
const firing = [];                // when each live shot voice ends, oldest first

export function audioReady() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return;                                  // node, or a browser without it
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);

  // Brown noise, integrated from white, for a thruster that rumbles instead of hisses.
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let run = 0;
  for (let i = 0; i < len; i++) { run = (run + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = run * 3.2; }

  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  thrFilter = ctx.createBiquadFilter();
  thrFilter.type = 'lowpass'; thrFilter.frequency.value = 300; thrFilter.Q.value = 0.7;
  thrGain = ctx.createGain(); thrGain.gain.value = 0;
  src.connect(thrFilter); thrFilter.connect(thrGain); thrGain.connect(master);
  src.start();
}

// v is 0..1 of top speed. The filter opens as well as the gain, so hard burn is
// brighter rather than just louder.
export function setThrust(v) {
  if (!ctx || !thrGain) return;
  const k = on ? Math.max(0, Math.min(1, v)) : 0;
  thrGain.gain.setTargetAtTime(k * 0.32, ctx.currentTime, 0.09);
  thrFilter.frequency.setTargetAtTime(240 + k * 620, ctx.currentTime, 0.12);
}

// A shot. Yours is a bright square dropping fast; theirs is a lower, dirtier saw,
// so you can tell who is shooting without looking away from what you are doing.
export function laser(mine, dist) {
  if (!ctx || !on) return;
  const near = 1 - Math.min(1, dist / 1500);
  if (near < 0.05) return;
  const t = ctx.currentTime;
  while (firing.length && firing[0] <= t) firing.shift();
  if (firing.length >= 6) return;                   // never let a brawl turn into a buzz
  firing.push(t + 0.25);

  const o = ctx.createOscillator(), amp = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = mine ? 'square' : 'sawtooth';
  o.frequency.setValueAtTime(mine ? 900 : 420, t);
  o.frequency.exponentialRampToValueAtTime(mine ? 220 : 120, t + 0.15);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(mine ? 2800 : 1500, t);
  f.frequency.exponentialRampToValueAtTime(520, t + 0.16);
  const peak = 0.3 * near * near * (mine ? 1 : 0.75);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  o.connect(f); f.connect(amp); amp.connect(master);
  o.start(t); o.stop(t + 0.21);
}

export function toggleAudio() { on = !on; if (!on) setThrust(0); return on; }
export const audioOn = () => on;
