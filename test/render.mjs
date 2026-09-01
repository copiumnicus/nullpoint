// Runs the real client render path against a stub 2D context, over every map,
// with the chart open and closed. Any undefined field or bad colour throws.
import { readFileSync, writeFileSync } from 'node:fs';
import { MAPS } from '../shared/maps.js';
import { EQUIPMENT, SLOTS, MAX_DRONES } from '../shared/gear.js';
import { HULLS, slotsOf, resolve } from '../shared/ships.js';
import { applyResearch } from '../shared/research.js';
import { FORMATION_KEYS } from '../shared/formation.js';
import { KIT_KEYS } from '../shared/repair.js';
import { DEVICE_KEYS } from '../shared/devices.js';
import { bayLayout, STORE_PAGES, fitsIn, pickerLayout, STAT_KEYS } from '../shared/hangar.js';
import { DEV_ID, DEV_BASE } from '../shared/devmap.js';
import { AMMO_KEYS, FEEDS, BAR_SLOTS, barLayout, feedMenu, forWeapon,
         promptRect, TIP_H, TIP_UP, buyRow, BUY_STEPS, MAX_BUY } from '../shared/ammo.js';
import { settingsLayout } from '../shared/settings.js';
import { audioOn, sfxOnly, musicOnly, sfxVolume, musicVolume,
         musicList, musicParked, musicMood, hasMood, setMusicVolume } from '../public/audio.js';
import { packShip, packBolt, packRocket, packBlast, packPod, packHit, packSown } from '../shared/net.js';
import { newBase, encodeFull, encodeDelta } from '../shared/delta.js';
import { MATERIALS } from '../shared/cargo.js';
import { ALIENS, WILD } from '../shared/aliens.js';
import { SIGHT_R } from '../shared/sim.js';
import { VERSION, PATCHES, patchIcon, patchPanel } from '../shared/patch.js';
import { NAME_MAX } from '../shared/signup.js';
import { havenBadge, HAVEN_COPY, HAVEN_BROKEN } from '../shared/haven.js';
import { filePanel, filedIn, dossierOf } from '../shared/threats.js';
import { QUESTS, QUEST_KEYS, needFor, questLine } from '../shared/quests.js';
import { labPanel, LAB_PRICE, MODULES } from '../shared/research.js';
import { arenaId, mapOf } from '../shared/maps.js';
import { countOf, mission, bar as missionBar, ARENA_MODULES } from '../shared/arena.js';
import { DUEL_KEY, startsAt, duelText } from '../shared/duel.js';
import { packLab } from '../shared/net.js';
import { havenKind, HAVEN_R } from '../shared/sim.js';
import { Tracker, textWidth, alphaOf } from './uibox.mjs';
import { collisions, crossings, crowding, say, sayCross, sayTight, key, same } from './uilint.mjs';
import { mergeSizes, viewsOf, SIZES as SHIPPED } from '../shared/viewport.js';
import { load } from '../store.js';

// pull the module body straight out of index.html so the test can never drift from it
const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  .match(/<script type="module">([\s\S]*)<\/script>/)[1]
  .replaceAll("'/shared/", "'" + new URL('../shared/', import.meta.url).pathname)
  .replaceAll("'/audio.js", "'" + new URL('../public/audio.js', import.meta.url).pathname);
writeFileSync(new URL('./.client.mjs', import.meta.url), src);

const bad = [];
const guard = (what, v) => {
  const s = String(v);
  if (v === undefined || v === null || s.includes('undefined') || s.includes('NaN')) bad.push(`${what} = ${s}`);
  return v;
};
const num = (what, ...vs) => { for (const v of vs) if (typeof v === 'number' && !isFinite(v)) bad.push(`${what} got ${v}`); };

// Every CSS colour form the app actually uses. Numeric components only, so
// anything that stringified an undefined or a NaN still fails.
const COLOUR = /^(#[0-9a-f]{6}([0-9a-f]{2})?|transparent|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i;

// Optional call recording. Off by default and costs nothing when off. It exists
// because "the frame did not crash" is not the same claim as "the frame drew the
// same thing": the client is fed deltas now, and the only way to say a sector
// rebuilt from a keyframe plus deltas is the sector the server meant is to draw
// both and compare call for call. Coordinates are rounded because the ships lerp
// toward their true position and the last few digits are float noise, not a
// difference anyone could see.
let trace = null;
// A panel says it was drawn by drawing its own title. The sweep below sets this
// to the string it is expecting, and a coverage assertion fails if a panel it
// asked for never printed one — a sweep that silently stopped opening a panel
// would otherwise pass every rule in this file for the same reason an empty
// panel cannot overlap itself.
let WATCH = null;
const r2 = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const rec = (...a) => { if (trace) trace.push(a.map(r2).join(' ')); };

// The stub keeps the geometry of every draw as well as guarding its arguments,
// so the frame can be asked whether a player could read all of it. See uibox.mjs
// for why a monospace advance is enough and why world space is excluded.
const T = new Tracker(1);   // dpr fixed up once the globals exist
// A gradient that remembers its stops, so the recorder can ask how much of what
// is under it survives. Same colour check as before.
const grad = () => ({ __stops: [], addColorStop(o, c) {
  if (!COLOUR.test(String(c))) bad.push(`addColorStop bad colour ${c}`);
  this.__stops.push(alphaOf(c) ?? 1);
} });
const CTX = {
  _stroke: '#000', _dash: [], _lw: 1, _join: 'miter',
  set fillStyle(v)   { guard('fillStyle', v); rec('fillStyle', v); T.fill = v; },   get fillStyle()   { return T.fill; },
  set strokeStyle(v) { guard('strokeStyle', v); rec('strokeStyle', v); this._stroke = v; }, get strokeStyle() { return this._stroke; },
  // font, fill, alpha, align and the clip live in the tracker so that
  // save()/restore() restores them the way a real context does. As no-ops they
  // leaked: a font set inside a save() stayed set after the restore, so
  // measureText answered for the wrong size and every box recorded after it was
  // the wrong height.
  set font(v)        { guard('font', v); T.font = v; },        get font()        { return T.font; },
  set globalAlpha(v) { num('globalAlpha', v); rec('alpha', v); T.alpha = v; },  get globalAlpha() { return T.alpha; },
  set lineWidth(v)   { num('lineWidth', v); rec('lineWidth', v); this._lw = v; },       get lineWidth()   { return this._lw; },
  set lineJoin(v)    { this._join = v; },                          get lineJoin()    { return this._join; },
  set textAlign(v)   { T.align = v; },                             get textAlign()   { return T.align; },
  set textBaseline(v){ T.base = v; },                              get textBaseline(){ return T.base; },
  fillRect(...a)   { num('fillRect', ...a); rec('fillRect', ...a); T.rect(...a); },
  strokeRect(...a) { num('strokeRect', ...a); rec('strokeRect', ...a); T.rect(a[0], a[1], a[2], a[3], 'strokerect'); },
  fillText(t, x, y){ guard('fillText', t); num('fillText', x, y); rec('fillText', t, x, y); T.text(t, x, y);
                     if (WATCH && String(t).includes(WATCH.want)) WATCH.hit(); },
  // Every strokeText in the client is the legibility halo drawn immediately
  // before an identical fillText — never a separate label. Recording it would
  // report every haloed name as printing through itself.
  strokeText(t, x, y){ guard('strokeText', t); num('strokeText', x, y); rec('strokeText', t, x, y); },
  // length x 6 regardless of size is right at 10px and wrong everywhere else, and
  // the client measures at 9, 10, 11, 12, 13 and 15px. A receipt reading "MTC
  // awards you 140 cr and 140 XP for a Drifter" is 414px at 15px and this handed
  // back 276 — a third short — so every string the client centres, right-aligns
  // or fits to a room from a measureText was placed here somewhere the browser
  // would not have put it, and the harness agreed with itself about a layout no
  // player ever saw. Every font in the client is ui-monospace, so 0.6em per
  // character is the honest answer and the same function checks the overlaps.
  measureText(t)   { guard('measureText', t); return { width: textWidth(t, T.font) }; },
  arc(...a)        { num('arc', ...a); rec('arc', ...a); if (a[2] < 0) bad.push('arc negative radius');
                     T.curve(a[0] - a[2], a[1] - a[2], a[2] * 2, a[2] * 2); },
  rect(...a) { num('rect', ...a); rec('rect', ...a); T.path(...a); },
  roundRect(...a) { num('roundRect', ...a); rec('roundRect', ...a); T.path(a[0], a[1], a[2], a[3]); },
  moveTo(...a) { num('moveTo', ...a); rec('moveTo', ...a); T.curve(a[0], a[1], 0, 0); },
  lineTo(...a) { num('lineTo', ...a); rec('lineTo', ...a); T.curve(a[0], a[1], 0, 0); },
  translate(...a) { num('translate', ...a); rec('translate', ...a); T.translate(...a); },
  rotate(a) { num('rotate', a); rec('rotate', a); T.rotate(a); },
  scale(...a) { num('scale', ...a); if (a.some(v => v === 0)) bad.push('scale by zero'); T.scale(...a); },
  setTransform(...a) { num('setTransform', ...a); T.setTransform(...a); },
  beginPath() { T.begin(); }, closePath() {}, stroke() { rec('stroke'); }, fill() { rec('fill'); T.fill_(); },
  save() { T.save(); }, restore() { T.restore(); }, clip() { T.clipHere(); },
  setLineDash(d) { this._dash = d; },
  createLinearGradient(...a) { num('createLinearGradient', ...a); return grad(); },
  createRadialGradient(...a) {
    num('createRadialGradient', ...a);
    if (a[2] < 0 || a[5] < 0) bad.push('gradient negative radius');
    return grad();
  },
};

const listeners = {};
const on = (k, fn) => (listeners[k] ??= []).push(fn);
const canvas = {
  width: 0, height: 0, getContext: () => CTX, addEventListener: on,
  setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: innerWidth, height: innerHeight }),
};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 2;
T.dpr = Math.min(2, devicePixelRatio); T.reset();   // what the client's resize() leaves in the matrix
globalThis.location = { host: 'localhost:3000', protocol: 'http:', reload() {} };
// seeded under the OLD key, to prove the rename migration runs
const store = new Map([['aphelion.token', 'legacy-token']]);
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.document = { getElementById: () => canvas, title: '' };
globalThis.addEventListener = on;
// The client's one setInterval is the flush that turns a held mouse or a held
// key into a 'dir' intent. Throwing the callback away meant hold-to-steer was
// never exercised at all — by mouse or by key — so keep it and drive it by hand.
const timers = [];
globalThis.setInterval = fn => { timers.push(fn); return 0; };
const flush = () => timers.forEach(fn => fn());
let raf = null;
globalThis.requestAnimationFrame = cb => { raf = cb; };
const socks = [];
const sent = [];
globalThis.WebSocket = class { constructor() { this.readyState = 1; socks.push(this); } send(d) { sent.push(JSON.parse(d)); } close() { this.readyState = 3; } };

// A recording AudioContext. setTargetAtTime is used only by the thruster and
// oscillators only by the guns, so counting them tells us exactly what fired.
const audio = { osc: 0, thrust: [], now: 0 };
const param = kind => ({
  value: 0,
  setValueAtTime() {}, exponentialRampToValueAtTime() {},
  setTargetAtTime(v) { if (kind === 'gain') audio.thrust.push(v); },
});
const anode = () => ({ gain: param('gain'), frequency: param('freq'), Q: param('q'), playbackRate: param('rate'),
                       type: '', connect() {}, start() {}, stop() {} });
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.destination = {}; }
  get currentTime() { return audio.now; }      // a real context's clock runs; so must this one
  resume() {}
  createGain() { return anode(); }
  createBiquadFilter() { return anode(); }
  createBufferSource() { return anode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createOscillator() { audio.osc++; return anode(); }
  createConvolver() { return anode(); }
  createDynamicsCompressor() { return { threshold: param('t'), knee: param('k'), ratio: param('r'),
                                        attack: param('a'), release: param('rl'), connect() {} }; }
  createAnalyser() {
    return { fftSize: 2048, connect() {},
      // a steady tone at a known level, so the levelling has something to converge on
      getFloatTimeDomainData(buf) { for (let i = 0; i < buf.length; i++) buf[i] = 0.03 * Math.sin(i / 9); } };
  }
  createMediaElementSource() { return { connect() {} }; }
  createDelay() { return { delayTime: param('delay'), connect() {} }; }
  createWaveShaper() { return { curve: null, connect() {} }; }
};

// Music was a third of a file with nothing driving it. These are enough of the
// browser for the whole path to run: sorting onto decks, drawing from the bag,
// switching mood, fading, and the levelling that measures its way to a gain.
const TRACKS = ['Silent Orbit.mp3', 'ambient/long-dark.mp3', 'ambient/drift.mp3',
                'combat/hard-burn.mp3', 'combat/cold-pulse.mp3',
                'chase/long-way-home.mp3', 'boss/iron-pulse.mp3'];
const played = [];
globalThis.Audio = class {
  constructor() { this.paused = true; this._src = ''; this.volume = 1; this.crossOrigin = ''; }
  set src(v) { this._src = v; played.push(decodeURIComponent(v.replace('/music/', ''))); }
  get src() { return this._src; }
  addEventListener(type, fn) { (this._on ??= {})[type] = fn; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
};
globalThis.fetch = url => Promise.resolve({
  ok: String(url).endsWith('/music/list'),
  json: async () => TRACKS,
  arrayBuffer: async () => new ArrayBuffer(0),
});

const errs = [];
console.error = (...a) => errs.push(a.join(' '));

// The join form's geometry, kept in step with the client by hand — it is drawn
// before there is any session, so it cannot come from a shared layout the way
// the station's does without shipping the lobby to everyone.
const joinLayoutFor = (W, H, n) => {
  const w = Math.min(560, W - 40), h = 380;
  const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  const cw = (w - 40 - (n - 1) * 12) / n;
  return { cards: Array.from({ length: n }, (_, i) => ({ x: x + 20 + i * (cw + 12), y: y + 168, w: cw, h: 104 })),
           go: { x: x + 20, y: y + h - 66, w: w - 40, h: 44 } };
};

await import('./.client.mjs');

const ws = socks[0];
const feed = o => ws.onmessage({ data: JSON.stringify(o) });
const FOUND = new Map(), CROSS = new Map(), TIGHT = new Map();
// Every window a player might actually have. Panels are laid out from the
// viewport, so a line that clears its neighbour at 1600x900 can sit on top of
// it at 1366x768, and the harness has only ever run at one size.
//
// The seven shipped in shared/viewport.js were sizes somebody picked. The client
// now reports its window and the server files it on the account, so the ones the
// people who actually play this game sit in front of get merged in on top —
// which is the point: the suite stops asserting about hypothetical windows and
// starts asserting about the two real ones as well.
//
// Merged, never substituted. The awkward extremes stay, because 820x560 catches
// a panel running off the bottom that 1920x1080 has never once caught, and the
// merge is capped so twenty pilots cannot become twenty times the frames.
//
// And it degrades to silence. store.load() returns no accounts when there is no
// save file — a fresh checkout, CI, or a deploy on its first boot — so this is
// exactly the shipped seven with nothing said about it, and the suite behaves
// today the way it did yesterday.
const SIZES = mergeSizes(viewsOf(load().accounts));
if (SIZES.length > SHIPPED.length)
  console.log(`windows: ${SIZES.length} sizes — the ${SHIPPED.length} shipped plus ` +
    SIZES.slice(SHIPPED.length).map(([w, h]) => `${w}x${h}`).join(' ') + ' that people actually play at');
let SEEN = 0, SIZE = '1600x900';
// One report per pair of strings, not per frame: the threat file drawn at
// twenty-six eased scroll offsets is one overlap, not twenty-six. Numbers are
// collapsed in the key, so "x240" against a price and "x241" against the same
// price is one finding.
const keep = (m, k, v) => {
  if (!m.has(k)) m.set(k, { v, n: 0, sizes: new Set() });
  const f = m.get(k); f.n++; f.sizes.add(SIZE);
};
const analyse = () => {
  SEEN++;
  const els = T.els;
  for (const c of collisions(els, innerWidth, innerHeight)) keep(FOUND, key(c), c);
  for (const c of crossings(els, innerWidth, innerHeight))
    keep(CROSS, `${same(c.a.text)}|${Math.round(c.r.w)}x${Math.round(c.r.h)}`, c);
  for (const c of crowding(els, innerWidth, innerHeight))
    keep(TIGHT, `${same(c.a.text)}|${same(c.b.text)}|${c.way}`, c);
};
const frame = t => { audio.now = t / 1000; const cb = raf; raf = null;
                     T.reset(); cb(t); analyse(); };
// Input handlers are code too. Not driving them is how two helper functions went
// missing entirely while every frame still rendered: hover starts null, so the
// render path short-circuited before ever calling them.
const evt = (type, props = {}) => (listeners[type] ?? []).forEach(fn =>
  fn({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0, key: 'Unidentified', ...props }));

feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard', fit: [] });
let t = 0, frames = 0;
for (const id of Object.keys(MAPS)) {
  feed({ t: 'map', map: id });
  feed({ t: 's', ships: [
    packShip({ id: 1, x: 6000, y: 4000, heading: .5, charge: 0,   co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 100, tgt: 1e6, shot: 100, guns: 3, psys: 1, plvl: 70, lvl: 14, drones: 3, form: 1, dmask: 0b101, vis: 2 }),
    packShip({ id: 2, x: 5200, y: 3400, heading: 1.9, charge: 0,  co: 'm', hull: 'bulwark',  hp: 80, sh: 60, flash: 40, guns: 4, psys: 3, plvl: 40, lvl: 31, drones: 6, form: 2, dmask: 0b111111, vis: 2 }),
    packShip({ id: 3, x: 3000, y: 2000, heading: 1.2, charge: 1.4, co: 'h', hull: 'kestrel', hp: 30, sh: 0, flash: 0, guns: 1, lvl: 0, drones: 4, form: 3, dmask: 0, vis: 1 }),
    packShip({ id: 4, x: 9000, y: 6000, heading: 2, charge: 0,    co: 'k', hull: 'bulwark',  hp: 5, sh: 55, flash: 70, guns: 1, lvl: 0, drones: 2, form: 0, dmask: 0b10, vis: 0 }),
    packShip({ id: 1e6, x: 6400, y: 4300, heading: .2, charge: 0,  co: 'x', hull: 'drifter',  hp:  70, sh:  30, flash:  20, tgt: 1, shot: 90, vis: 1 }),
    packShip({ id: 1e6 + 1, x: 2200, y: 6600, heading: 3, charge: 0, co: 'x', hull: 'drifter', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, vis: 0 }),
  ],
  rockets: [
    packRocket({ x: 6200, y: 4100, heading: 0.4,  foe: 0, w: 150 }),
    packRocket({ x: 6350, y: 3900, heading: -2.1, foe: 0, w: 750 }),
    packRocket({ x: 5900, y: 4300, heading: 3.1,  foe: 1, w: 150 }),
    packRocket({ x: 6100, y: 4250, heading: 1.7,  foe: 1, w: 0 }),
  ], bolts: [
    packBolt({ sx: 6000, sy: 4000, ax: 6400, ay: 4300, t: 0.10, ttl: 0.21, foe: false }),
    packBolt({ sx: 6400, sy: 4300, ax: 6000, ay: 4000, t: 0.02, ttl: 0.21, foe: true }),
    packBolt({ sx: 5200, sy: 3400, ax: 2200, ay: 6600, t: 0.20, ttl: 0.21, foe: false }),
  ], hits: [
    packHit({ x: 6400, y: 4280, n: 95, sh: true,  t: 0.90, ttl: 0.95 }, true),   // mine, on its shields
    packHit({ x: 6400, y: 4280, n: 47, sh: false, t: 0.30, ttl: 0.95 }, true),   // mine, into the hull
    packHit({ x: 6000, y: 3980, n: 45, sh: false, t: 0.60, ttl: 0.95 }, false),  // taken
  ], blasts: [
    packBlast({ x: 6400, y: 4300, r: 15, t: 0.75, ttl: 0.8, foe: true }),    // just popped
    packBlast({ x: 5600, y: 3800, r: 13, t: 0.10, ttl: 0.8, foe: false }),   // nearly done
  ], pods: Object.keys(MATERIALS).map((mat, i) =>
    packPod({ id: i + 1, x: 5800 + i * 120, y: 4400, mat, n: i + 1 })),
    hold: { iron: 6, platinum: 3, iridium: 1 }, cap: 60, credits: 4820, docked: true,
    gear: { emitter1: 2, cellA: 1 }, hulls: ['hauler','vanguard'],
    drones: ['emitter1', null, 'cellA'], formation: 'wedge', formations: ['line', 'wedge'],
  xp: 5200, rank: { level: 14, into: 300, need: 900 },
    power: { to: 'weapons', cap: 62, lv: { thrusters: 0, weapons: 90, shields: 0 } },
    shieldNow: 640, shieldMax: 1170, shieldWait: 4.2,   // the countdown on the shield bar
    vault: { iron: 240, nickel: 88, rhodium: 4 },
    scoop: { id: 1, p: 0.4 } });
  feed({ t: 'award', amount: 140, xp: 140, what: 'Drifter', total: 4960, level: 14, promoted: false });
  frame(t += 16); frames++;
  feed({ t: 'award', amount: 140, what: 'Drifter', total: 5100 });   // an award with no xp field
  frame(t += 16); frames++;                                    // world view
  listeners.keydown.forEach(fn => fn({ key: 'm' }));           // star system chart
  frame(t += 16); frames++;
  listeners.keydown.forEach(fn => fn({ key: 'm' }));
  listeners.keydown.forEach(fn => fn({ key: 'h' }));           // hangar
  frame(t += 16); frames++;
  for (const h of ['kestrel', 'bulwark']) {                    // every hull, every module
    feed({ t: 'fit', hull: h, fit: { weapon: ['emitter1'], generator: ['cellA'], tech: ['plating'] },
           gear: { emitter1: 2, damper: 1 }, hulls: ['hauler','vanguard'], credits: 90000,
           drones: ['emitter1', null] });
    frame(t += 16); frames++;
  }
  listeners.keydown.forEach(fn => fn({ key: 'h' }));
  listeners.keydown.forEach(fn => fn({ key: 'i' }));          // inventory, docked
  frame(t += 16); frames++;
  evt('pointerdown', { clientX: 300, clientY: 300 });          // stash a stack
  frame(t += 16); frames++;
  listeners.keydown.forEach(fn => fn({ key: 'i' }));

  // pointer and keys, over empty space and over a hostile
  for (const [px, py] of [[40, 40], [1200, 750], [innerWidth - 60, innerHeight - 40]]) {
    evt('pointermove', { clientX: px, clientY: py });
    frame(t += 16); frames++;                                 // hover preview path
    evt('pointerdown', { clientX: px, clientY: py });
    evt('pointermove', { clientX: px + 30, clientY: py + 10 });
    evt('pointerup',   { clientX: px + 30, clientY: py + 10 });
    evt('pointerdown', { clientX: px, clientY: py });          // second click: double-click path
    evt('pointerup',   { clientX: px, clientY: py });
    frame(t += 16); frames++;
  }
  evt('pointerleave');
  for (const k of ['Tab', 'x', 'k', 'v', 'v', 'Escape']) evt('keydown', { key: k });
  frame(t += 16); frames++;

  // outside charted space: shear vignette, flashing warning, clamped minimap plot
  for (const [x, y] of [[-40, 4000], [-1700, -1700], [13700, 9700]]) {
    feed({ t: 's', ships: [
      packShip({ id: 1, x, y, heading: .5, charge: 0, co: 'm', hull: 'vanguard', hp: 40, sh: 0, flash: 0, vis: 2 }),
      packShip({ id: 3, x: 3000, y: 2000, heading: 1.2, charge: 0, co: 'h', hull: 'kestrel', hp: 30, sh: 0, flash: 55, vis: 1 }),
    ] });
    frame(t += 16); frames++;
  }
}
// Every module the page imports must be reachable, or the whole graph fails to
// evaluate and the player gets a black screen with nothing in the console to
// explain it. This is what shipping shared/level.js without serving it did.
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = new URL('../', import.meta.url).pathname;
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const body = html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
  const grab = t => [...t.matchAll(/from '([^']+)'/g)].map(m => m[1]);
  const seen = new Set(), queue = grab(body), missing = [], unserved = [];
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    const local = url === '/audio.js' ? 'public/audio.js' : url.replace(/^\//, '');
    const abs = path.join(root, local);
    if (!fs.existsSync(abs)) { missing.push(url); continue; }
    // credit the pattern route only if the server actually has one
    const byPattern = server.includes('SHARED_JS.test(url)') && /^\/shared\/[a-z]+\.js$/.test(url);
    if (!byPattern && !server.includes(`'${url}'`)) unserved.push(url);
    for (const imp of grab(fs.readFileSync(abs, 'utf8')))
      queue.push(imp.startsWith('.') ? '/shared/' + path.basename(imp) : imp);
  }
  if (missing.length) errs.push(`client imports files that do not exist: ${missing.join(', ')}`);
  else if (unserved.length) errs.push(`client imports files the server will not serve: ${unserved.join(', ')}`);
  else console.log(`imports: all ${seen.size} modules the page pulls in are reachable`);
}

// A rename must not orphan an existing pilot: the old key is read once, moved to
// the new one, and the account survives.
{
  const { TOKEN_KEY, OLD_TOKEN_KEYS } = await import('../shared/brand.js');
  const seen = store.get(TOKEN_KEY);
  if (seen !== 'legacy-token') errs.push(`a token under ${OLD_TOKEN_KEYS[0]} was not migrated (got ${seen})`);
  else if (store.get(OLD_TOKEN_KEYS[0]) !== undefined) errs.push('the old key was left behind');
  else console.log(`identity: a pilot stored under ${OLD_TOKEN_KEYS[0]} carried over to ${TOKEN_KEY}`);
}

// Handles, over the bars. Two Vanguards in the same company are the same shape in
// the same colour, so before this the only thing telling two pilots apart was the
// gap between them. cleanName caps a handle at NAME_MAX server-side, so the widest
// one is a known width and nothing on this side has to truncate.
//
// The ship with vis 0 is the load-bearing half. A contact the radar has lost keeps
// its silence — the vitals block already stops at `if (lost) continue`, and the
// handle sits under that same rule rather than announcing who is out there in the
// dark. Asserting only that text appears would pass with the radar rule broken.
{
  feed({ t: 'welcome', id: 1, token: 'test-token', name: 'Vy', co: 'm', map: 'm1',
         hull: 'vanguard', fit: { weapon: [], generator: [], tech: [] } });
  feed({ t: 'map', map: 'm1' });
  const longest = 'A'.repeat(NAME_MAX);
  const crowd = () => feed({ t: 's', ships: [
    packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
               hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, lvl: 14, name: 'Vy' }),
    packShip({ id: 2, x: 6120, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
               hp: 60, sh: 40, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, lvl: 3, name: longest }),
    packShip({ id: 3, x: 5880, y: 4000, heading: 0, charge: 0, co: 'h', hull: 'kestrel',
               hp: 80, sh: 0, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 0, lvl: 9, name: 'Ghost' }),
    packShip({ id: 1e6, x: 6000, y: 4200, heading: 0, charge: 0, co: 'x', hull: 'drifter',
               hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 1, name: '' }),
  ] });
  crowd(); frame(t += 16); frames++;               // one frame to let rx/ry settle
  crowd(); trace = [];
  frame(t += 16); frames++;
  const out = trace; trace = null;
  const drew = n => out.some(c => c.startsWith(`fillText ${n} `));
  if (!drew('Vy') || !drew(longest))
    errs.push('a pilot in the sector was drawn with no handle over their bars');
  else if (drew('Ghost'))
    errs.push('a contact the radar has lost was still labelled with the pilot flying it');
  else console.log(`handles: every pilot on the plot is named over their bars, up to ${NAME_MAX} characters, and a stale contact is not`);
}

// A first visit chooses a name and a side, and can do nothing else until it has.
{
  const welcomeAgain = () => feed({ t: 'welcome', id: 1, token: 'test-token', name: 'Tester',
    map: 'm1', co: 'm', hull: 'vanguard', fit: { weapon: ['emitter1'], generator: [], tech: [] },
    gear: {}, hulls: ['hauler', 'vanguard'], credits: 90000, drones: [], xp: 0, admin: true,
    formation: 'line', formations: ['line'], ammo: { cell1: 4000, head1: 400 },
    using: { laser: 'cell1', rocket: 'head1' }, armed: { laser: true, rocket: true },
    kits: {}, kit: 'kit1' });

  feed({ t: 'signup', companies: [
    { key: 'm', tag: 'MTC', name: 'Meridian Trade Consortium', color: '#4a9fe0', pilots: 3 },
    { key: 'h', tag: 'HXI', name: 'Helion Extractive Industries', color: '#e0a53f', pilots: 1 },
    { key: 'k', tag: 'KVR', name: 'Kuiper Void Reclamation', color: '#8f6fe0', pilots: 2 }] });
  frame(t += 16); frames++;

  sent.length = 0;
  evt('pointerdown', { clientX: 400, clientY: 300 });
  evt('keydown', { key: 'h' });                     // a hotkey elsewhere; here it is a letter
  evt('keydown', { key: 'Tab' });                   // and Tab walks the sides
  frame(t += 16); frames++;
  if (sent.some(m => m.t === 'intent' || m.t === 'target'))
    errs.push('the join form let a click fly a ship that does not exist yet');

  // A name too short will not launch; a good one plus a side will. Clear first —
  // the 'h' above went into the field, which is the point of the check.
  for (let i = 0; i < 4; i++) evt('keydown', { key: 'Backspace' });
  for (const ch of 'Vy') evt('keydown', { key: ch });
  frame(t += 16); frames++;
  const L = joinLayoutFor(innerWidth, innerHeight, 3);
  sent.length = 0;
  evt('pointerdown', { clientX: L.go.x + L.go.w / 2, clientY: L.go.y + L.go.h / 2 });
  frame(t += 16); frames++;
  if (sent.some(m => m.t === 'join')) errs.push('the form launched on a callsign that is too short');

  for (const ch of 'per') evt('keydown', { key: ch });
  evt('pointerdown', { clientX: L.cards[2].x + 20, clientY: L.cards[2].y + 40 });   // pick a side
  frame(t += 16); frames++;
  sent.length = 0;
  evt('pointerdown', { clientX: L.go.x + L.go.w / 2, clientY: L.go.y + L.go.h / 2 });
  frame(t += 16); frames++;
  const join = sent.find(m => m.t === 'join');
  if (!join) errs.push('a valid callsign and a side still would not launch');
  else if (join.name !== 'Vyper' || !join.co) errs.push(`the form sent ${JSON.stringify(join)}`);
  else console.log(`join: a first visit picks a callsign and a side, and flies nothing until it has`);

  welcomeAgain();                                  // and the rest of the file is a pilot again
  frame(t += 16); frames++;
}

// The client tells the server what window it is in, and does it once per window
// rather than once per event. Nothing in the game reads a viewport — it is filed
// on the account so /sizes can say what people play at and so the sweep above can
// be the real sizes — but the report is client code, and client code that is
// never driven is how two helper functions went missing while every frame still
// rendered.
{
  // Read before the clear, deliberately: the block above signs a pilot in with a
  // welcome as its last act, and reporting the window on welcome rather than on
  // open is the whole reason a first-time pilot is ever counted — the lobby
  // refuses everything but `join`, so a report sent on open is dropped.
  const onWelcome = sent.find(m => m.t === 'view');
  sent.length = 0;
  globalThis.innerWidth = 1512; globalThis.innerHeight = 945;
  evt('resize');
  const early = sent.some(m => m.t === 'view');
  // Own the debounce for this block, the same way the mood hold owns its clock.
  // The whole suite runs inside a few milliseconds of wall clock, so a 400ms
  // timer never fires on its own here: waiting for it really would be waiting,
  // and not waiting at all would assert nothing.
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = fn => (fn(), 0);
  evt('resize');
  const v = sent.find(m => m.t === 'view');
  globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
  evt('resize');                                   // back to the harness's own window
  globalThis.setTimeout = realTimeout;             // and no timer left running behind us
  frame(t += 16); frames++;
  if (!onWelcome)
    errs.push('a pilot signed in and never told the server what window they were in');
  else if (early)
    errs.push('the window size went out on the first resize event — a drag across a screen is three hundred of those');
  else if (!v) errs.push('the client never told the server what window it is in');
  else if (v.w !== 1512 || v.h !== 945)
    errs.push(`the client reported ${v.w}x${v.h} for a 1512x945 window`);
  else console.log(`viewport: ${onWelcome.w}x${onWelcome.h} on signing in, then 1512x945@${v.dpr}x ` +
                   'once the window settles — not once per resize event');
}

const click = r => evt('pointerdown', { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 });
const hoverAt = r => evt('pointermove', { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 });
// Every key that closes a panel also opens something — 'h' toggles the station,
// Escape opens the menu once there is nothing left to close. A click on bare
// space is the only unconditional dismiss, so that is what the blocks use.
const dismiss = () => {
  evt('pointerdown', { clientX: 4, clientY: 4 });
  evt('pointerup', {});
};

// Does a course actually go where you pointed? The move order read `v.x + cam.x`
// where every other conversion reads `v.x / zoom + cam.x`. Those agree only at
// zoom 1, and zoom is min(1, min(W, H) / (2 * SIGHT_R)) — below 1 on any window
// shorter than 1120px, which is most of them. Courses came out short by a factor
// of zoom measured from the top-left of the view, so the ship stopped further
// from the cursor the further out you clicked, and no frame ever drew anything
// malformed. Asserted as a difference between two clicks, so it needs to know
// nothing about where the camera happens to be.
{
  feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard', fit: [] });
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: .5, charge: 0, co: 'm',
          hull: 'vanguard', hp: 100, sh: 100, flash: 0, guns: 3, lvl: 14, drones: 0, form: 0,
          dmask: 0, vis: 2 })],
    rockets: [], bolts: [], hits: [], blasts: [], pods: [],
    hold: {}, cap: 60, credits: 4820, docked: false,
    gear: {}, hulls: ['vanguard'], drones: [], formation: 'wedge', formations: ['wedge'],
    xp: 5200, rank: { level: 14, into: 300, need: 900 },
    power: { to: 'weapons', cap: 62, lv: { thrusters: 0, weapons: 90, shields: 0 } },
    shieldNow: 640, shieldMax: 1170, vault: {} });
  frame(t += 16); frames++;
  dismiss();
  frame(t += 16); frames++;

  sent.length = 0;
  const A = { x: 300, y: 200 }, B = { x: 600, y: 400 };      // empty space, clear of every panel
  for (const q of [A, B]) {
    evt('pointerdown', { clientX: q.x, clientY: q.y });
    evt('pointerup', {});
  }
  const pts = sent.filter(m => m.t === 'intent' && m.mode === 'pt');
  const z = Math.min(1, Math.min(innerWidth, innerHeight) / (2 * SIGHT_R));
  if (pts.length !== 2) errs.push(`two clicks on empty space plotted ${pts.length} courses, not 2`);
  else {
    const gotX = pts[1].x - pts[0].x, gotY = pts[1].y - pts[0].y;
    const wantX = (B.x - A.x) / z,    wantY = (B.y - A.y) / z;
    if (Math.abs(gotX - wantX) > 0.5 || Math.abs(gotY - wantY) > 0.5)
      errs.push(`a course misses the cursor: clicks ${B.x - A.x}x${B.y - A.y} screen px apart `
        + `at zoom ${z.toFixed(3)} plotted ${gotX.toFixed(1)}x${gotY.toFixed(1)} world units apart, `
        + `want ${wantX.toFixed(1)}x${wantY.toFixed(1)}`);
    else console.log(`a plotted course lands under the cursor: at ${innerWidth}x${innerHeight} the `
      + `view zooms to ${z.toFixed(3)}, so clicks ${B.x - A.x}px apart plot ${wantX.toFixed(1)} apart`);
  }
}

// The changelog. An icon that does nothing when clicked is worse than no icon,
// and the panel is drawn over every other panel so it has to be hit-tested first.
{
  const b = patchIcon(innerWidth);
  const hitPatch = () => evt('pointerdown', { clientX: b.x + b.w / 2, clientY: b.y + b.h / 2 });
  dismiss();
  frame(t += 16); frames++;
  hitPatch();
  frame(t += 16); frames++;
  const L = patchPanel(innerWidth, innerHeight);
  if (!L.lines.length) errs.push('the changelog panel laid out no lines at all');
  if (!L.lines.some(l => l.kind === 'ver')) errs.push('the changelog showed notes with no version over them');
  if (!L.lines.some(l => l.kind === 'note')) errs.push('the changelog showed versions with nothing under them');
  if (L.lines.every(l => l.y < L.panel.y || l.y > L.panel.y + L.panel.h))
    errs.push('changelog lines fell outside their own panel');
  // Every note is drawn whole. Cutting them off at the panel edge was the point
  // of the complaint, so the drawn text must match the note it came from.
  const drawn = L.lines.filter(l => l.kind === 'note').map(l => l.text);
  if (drawn.some(x => x.includes('\u2026'))) errs.push('a changelog line was drawn with an ellipsis');

  // The wheel scrolls it, and only while it is open.
  evt('wheel', { deltaY: 240 });
  frame(t += 16); frames++;
  evt('wheel', { deltaY: -240 });
  frame(t += 16); frames++;

  evt('pointerdown', { clientX: L.panel.x + 20, clientY: L.panel.y + 60 });   // inside: reading
  frame(t += 16); frames++;
  evt('pointerdown', { clientX: 60, clientY: 500 });      // outside: closes
  frame(t += 16); frames++;
  hitPatch(); evt('keydown', { key: 'Escape' });          // and so does Escape
  frame(t += 16); frames++;
  evt('wheel', { deltaY: 240 });                          // closed: the wheel is not ours
  frame(t += 16); frames++;
  console.log(`changelog: v${VERSION}, ${PATCHES.length} entries, ${L.lines.length} lines whole, ` +
    `${L.maxScroll} to scroll; wheel, click-away and Escape all drive it`);
}

// Every hostile in the bestiary, drawn. The harness has only ever fed `drifter` and
// `bandit` rows, so a new outline could ship having never once reached a canvas —
// and an outline is exactly the kind of thing that produces a NaN from a bad point
// list. One of each, spread across the field, put through the real draw path.
{
  dismiss();
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: WILD.map((kind, i) => packShip({
    id: 1_000_000 + i, x: 4200 + (i % 4) * 700, y: 3400 + Math.floor(i / 4) * 700,
    heading: i * 0.7, charge: 0, co: 'x', hull: kind,
    hp: 100 - i * 6, sh: 90 - i * 5, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 1, name: '',
  })) });
  frame(t += 16); frames++;
  frame(t += 16); frames++;
  console.log(`bestiary: all ${WILD.length} hostile outlines drawn — ${WILD.join(' ')}`);
}

// A Lamprey's tether, through the real draw path, including the two cases that
// would produce a NaN or a radar leak: a victim this viewer was never sent (the
// tether must simply not be drawn) and a victim standing on top of the drainer.
{
  dismiss();
  feed({ t: 'map', map: 'm1' });
  const leech = (extra) => packShip({ id: 1_000_500, x: 6600, y: 4000, heading: 3.1, charge: 0,
    co: 'x', hull: 'lamprey', hp: 100, sh: 100, flash: 0, shot: 0, rk: 0, vis: 1, name: '', ...extra });
  const me2 = (x, y) => packShip({ id: 1, x, y, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
    hp: 60, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, guns: 3, lvl: 4, drones: 0, form: 0,
    dmask: 0, psys: 0, plvl: 0, vis: 2, name: 'you' });
  for (const d of [0, 1, 17, 50, 99, 100]) {                 // every draw, spooling up
    feed({ t: 's', ships: [me2(6000, 4000), leech({ tgt: 1, abl: d })] });
    frame(t += 16); frames++;
  }
  // A victim the radar never handed this client. tgt names an id that is not in
  // the ship map at all, which is exactly what happens when a Lamprey is draining
  // somebody you have not detected.
  feed({ t: 's', ships: [me2(6000, 4000), leech({ tgt: 987654, abl: 100 })] });
  frame(t += 16); frames++;
  // tgt 0: it has nobody.
  feed({ t: 's', ships: [me2(6000, 4000), leech({ tgt: 0, abl: 100 })] });
  frame(t += 16); frames++;
  // Zero length: the victim is standing exactly on it.
  feed({ t: 's', ships: [me2(6600, 4000), leech({ tgt: 1, abl: 100 })] });
  frame(t += 16); frames++;
  frame(t += 16); frames++;
  console.log('siphon: tether drawn at six draws, plus an undetected victim, no victim and zero length');
}

// A Thresher's chamber, through the real draw path. It draws NOTHING until `abl`
// is above zero, which is exactly how two helper functions once went missing while
// every frame still rendered — so the charge is driven across its whole range here
// rather than left at the 0 every other hostile sends.
//
// The last two rows are the guard: `abl` absent, and `abl` NaN. Both must draw the
// hull and no meter, because `held > 0` is false for NaN and the harness rejects
// any draw call carrying one. A meter that drew a NaN rect would take the whole
// frame down, and the mechanic it is drawing is the one that used to read as a
// random one-shot.
{
  dismiss();
  feed({ t: 'map', map: 'm1' });
  const mirror = (extra) => packShip({ id: 1_000_700, x: 6600, y: 4000, heading: 3.1, charge: 0,
    co: 'x', hull: 'thresher', hp: 100, sh: 100, flash: 0, tgt: 1, shot: 0, rk: 0, vis: 1, name: '', ...extra });
  const me3 = packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'bulwark',
    hp: 80, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, guns: 4, lvl: 6, drones: 0, form: 0,
    dmask: 0, psys: 0, plvl: 0, vis: 2, name: 'you' });
  let drew = 0;
  for (const d of [0, 1, 12, 40, 57, 84, 99, 100]) {
    feed({ t: 's', ships: [me3, mirror({ abl: d })] });
    frame(t += 16); frames++; drew++;
    frame(t += 140); frames++; drew++;          // and again, so the shimmer and the beat move
  }
  feed({ t: 's', ships: [me3, mirror({ abl: undefined })] });
  frame(t += 16); frames++;
  feed({ t: 's', ships: [me3, mirror({ abl: NaN })] });
  frame(t += 16); frames++;
  console.log(`mirror: the chamber drawn over ${drew} frames from empty to full, plus a missing dial and a NaN`);
}

// Sown ground, through the real draw path — both kinds, the wind-up ghost and the
// live patch, over frames far enough apart that every animated part actually moves.
//
// This exists because ground is the first thing in this game drawn from a stream
// that is EMPTY on every map but three. A draw path nothing ever enters is a draw
// path nobody has run, which is exactly how two helper functions went missing while
// every frame still rendered — `hover` starts null, and the render short-circuited
// before ever reaching them.
//
// The last rows are the guards, and each is a real wire state: a kind the client has
// never heard of (an older client, a newer server), a radius of zero, `p` absent and
// `p` NaN. Every one must draw something or nothing and never a NaN, because the
// harness rejects any draw call carrying one.
{
  dismiss();
  feed({ t: 'map', map: 'd1' });
  const mine = (extra = {}) => packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
    hull: 'bulwark', hp: 70, sh: 90, flash: 0, tgt: 0, shot: 0, rk: 0, guns: 4, lvl: 9, drones: 0,
    form: 0, dmask: 0, psys: 0, plvl: 0, vis: 2, name: 'you', ...extra });
  const me4 = mine();
  const sower = (hull, extra) => packShip({ id: 1_000_900 + (hull === 'doldrum' ? 1 : 0),
    x: 6700, y: 4000, heading: 3.1, charge: 0, co: 'x', hull, hp: 100, sh: 100, flash: 0,
    tgt: 1, shot: 0, rk: 0, vis: 1, name: '', ...extra });
  const patch = (id, k, on, p, extra = {}) =>
    packSown({ id, x: 6100, y: 4100, r: k ? 420 : 195, p, k, on, ...extra });
  let drew = 0;
  // both kinds, from the moment the marker appears to the moment the ground goes out
  for (const k of [0, 1])
    for (const [on, p] of [[0, 0.02], [0, 0.4], [0, 0.99], [1, 0], [1, 0.3], [1, 0.7], [1, 0.99]]) {
      feed({ t: 's', ships: [me4, sower(k ? 'doldrum' : 'crucible', { abl: on ? 0 : Math.round(p * 100) })],
             sown: [patch(50 + k, k, on, p)] });
      frame(t += 16); frames++; drew++;
      frame(t += 40); frames++; drew++;           // and again, so the blisters and the ripple move
    }
  // the combo, on one screen: a pool inside a still, both sowers winding
  feed({ t: 's', ships: [me4, sower('crucible', { abl: 60 }), sower('doldrum', { abl: 30 })],
         sown: [patch(60, 1, 1, 0.5), packSown({ id: 61, x: 6100, y: 4100, r: 195, p: 0.2, k: 0, on: 1 }),
                packSown({ id: 62, x: 6000, y: 4000, r: 195, p: 0.6, k: 0, on: 0 })] });
  frame(t += 16); frames++;
  // and the pilot's own engines-out, which is drawn off the bag rather than a row —
  // with a previous frame behind it so the velocity vector has something to read
  feed({ t: 's', ships: [me4, sower('doldrum', { abl: 0 })], sown: [patch(70, 1, 1, 0.4)], snare: 1.5 });
  frame(t += 16); frames++;
  feed({ t: 's', ships: [mine({ x: 6040, y: 4020 }), sower('doldrum', { abl: 0 })],
         sown: [patch(70, 1, 1, 0.5)], snare: 0.9 });
  frame(t += 16); frames++;
  feed({ t: 's', ships: [me4], sown: [], snare: 0 });
  frame(t += 16); frames++;
  // the guards
  feed({ t: 's', ships: [me4], sown: [packSown({ id: 80, x: 6100, y: 4100, r: 195, p: 0.5, k: 7, on: 1 })] });
  frame(t += 16); frames++;
  feed({ t: 's', ships: [me4], sown: [[81, 6100, 4100, 0, 0.5, 0, 1]] });
  frame(t += 16); frames++;
  feed({ t: 's', ships: [me4], sown: [[82, 6100, 4100, 195, undefined, 0, 1]] });
  frame(t += 16); frames++;
  feed({ t: 's', ships: [me4], sown: [[83, 6100, 4100, 195, NaN, 1, 1], [84, 6100, 4100, NaN, 0.5, 0, 0]] });
  frame(t += 16); frames++;
  // and put the client back where it found it. This block is the only one that flies
  // to a deep sector, and leaving it there hands whatever runs next a different world.
  feed({ t: 'map', map: 'm1' });
  frame(t += 16); frames++;
  console.log(`ground: both kinds drawn over ${drew} frames from marker to expiry, plus the combo, ` +
              'the engines-out vector, an unknown kind, a zero radius, a missing phase and a NaN');
}

// The SPACE prompt, and the strip of screen it has been fighting over since it was
// added. It sat 34px above the bar; a box tooltip covers r.y-24 to r.y-4, so hovering
// a weapon to read what is loaded printed the tooltip straight through the sentence
// saying what SPACE would do. Fourteen pixels, on every window size, for the entire
// life of the game.
//
// Pure geometry, which is the reason the rectangle moved into shared/ammo.js: this
// cannot be checked by looking at a frame, only by asking one source where the two
// things are.
{
  const over = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const [w, h] of [[1600, 900], [1280, 720], [1024, 640], [820, 560]]) {
    const L = barLayout(w, h), P = promptRect(w, h, 300);
    // The tallest a hover tooltip reaches, on any of the four boxes.
    const tips = L.boxes.map(b => ({ x: b.r.x - 60, y: b.r.y - TIP_UP, w: b.r.w + 120, h: TIP_H }));
    if (tips.some(t => over(P, t)))
      errs.push(`at ${w}x${h} the SPACE prompt lands on a box tooltip`);
    else if (over(P, L.r))
      errs.push(`at ${w}x${h} the SPACE prompt lands on the ammunition bar`);
    else if (P.y < 0 || P.x < 0 || P.x + P.w > w)
      errs.push(`at ${w}x${h} the SPACE prompt is off the screen`);
  }
  // Every chooser that opens out of a box crosses this strip — measured, all of
  // them, at every height from two rows to five. So the prompt is not drawn at all
  // while one is open, and that is checked by driving the real menu rather than by
  // comparing rectangles: what matters is that nothing reaches the canvas.
  {
    const B = barLayout(innerWidth, innerHeight);
    dismiss();
    feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard',
           fit: { weapon: [], generator: [], tech: [] } });
    feed({ t: 'map', map: 'm1' });
    feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
             hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, name: 'Vy' })],
           hold: { iron: 6 }, docked: true,
           ammo: { cell1: 4000, cell3: 250, head1: 400 }, using: { laser: 'cell1', rocket: 'head1' } });
    trace = []; frame(t += 16); frames++;
    const shut = trace; trace = null;
    if (!shut.some(c => /^fillText SPACE /.test(c)))
      errs.push('the SPACE prompt was missing with nothing open and ore to stow');
    // Via another box first: two clicks on the SAME box inside 320ms is the
    // safe-this-weapon gesture, and the whole suite runs inside that window. This
    // is the third time that has caught me, so it is now written down twice.
    click(B.boxes.find(b => b.feed === 'repair').r);
    frame(t += 16); frames++;
    click(B.boxes.find(b => b.feed === 'laser').r);          // open the grade chooser
    trace = []; frame(t += 16); frames++;
    const open = trace; trace = null;
    if (open.some(c => /^fillText SPACE /.test(c)))
      errs.push('the SPACE prompt was drawn underneath an open ammunition menu');
    click({ x: 4, y: 4, w: 1, h: 1 });                       // shut it again
    frame(t += 16); frames++;
    // And leave the double-tap latch on a box nobody downstream uses, or the
    // ammunition block's own first click on the laser box becomes a double and
    // safes the weapon instead of opening the chooser. State leaks between blocks.
    click(B.boxes.find(b => b.feed === 'repair').r);
    frame(t += 16); frames++;
    dismiss();
  }
  const L0 = barLayout(innerWidth, innerHeight), P0 = promptRect(innerWidth, innerHeight, 300);
  console.log(`prompt: SPACE sits at ${P0.y}..${P0.y + P0.h}, clear of the tooltips at ` +
              `${L0.r.y - TIP_UP}..${L0.r.y - TIP_UP + TIP_H} and the bar at ${L0.r.y}, ` +
              'and not drawn at all while a chooser is open');
}

// The beacon's hangar menu, with two hangars in it — the case that was broken.
//
// The draw listed sectors and the click listed device keys, so the row you clicked
// was the string 'recall' and the server answered "no hangar of yours there", while
// the second hangar could not be clicked at all because on the click side the menu
// only ever had one row. Driving the real menu is the only way to catch that: both
// halves rendered fine on their own.
{
  dismiss();
  const B = barLayout(innerWidth, innerHeight);
  feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard',
         fit: { weapon: [], generator: [], tech: [] }, berths: ['m4'], foldTo: 'm1',
         devices: { recall: 3 }, device: 'recall' });
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
           hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, name: 'Vy' })],
         devices: { recall: 3 }, device: 'recall', berths: ['m4'], foldTo: 'm1' });
  frame(t += 16); frames++;

  const dev = B.boxes.find(b => b.feed === 'device');
  // The strip along the top opens it, and it only opens when there is a choice.
  click({ x: dev.r.x, y: dev.r.y, w: dev.r.w, h: 8 });
  frame(t += 16); frames++;
  const M = feedMenu(dev, ['m1', 'm4']);
  trace = []; frame(t += 16); frames++;
  const drew = trace; trace = null;
  if (!drew.some(c => /Ironbelt|MTC-4/.test(c)))
    errs.push('a pilot who rents a bay was not offered it in the beacon menu');
  sent.length = 0;
  click(M.rows[1].r);                              // the SECOND hangar: the unclickable one
  frame(t += 16); frames++;
  const pick = sent.find(m => m.t === 'foldto');
  if (!pick) errs.push('clicking the second hangar in the beacon menu did nothing at all');
  else if (pick.map !== 'm4')
    errs.push(`the beacon menu sent ${JSON.stringify(pick.map)} instead of a sector`);
  else console.log(`beacon: two hangars listed, and the second one sends ${pick.map} — it sent "recall"`);
  dismiss();
}

// The STATS tab: where every number on the ship came from. A new tab is exactly
// where the INVENTORY one threw — it read G.pages[0].r on a tab that has no page
// list and took the whole station down — so this drives the real tab click and
// then reads the real rows.
{
  dismiss();
  feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard',
         fit: { weapon: ['emitter3'], generator: ['cellA'], tech: ['plating'] },
         drones: [], formation: 'line', formations: ['line'], hulls: ['vanguard'],
         gear: {}, credits: 50_000 });
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [packShip({ id: 1, x: MAPS.m1.base.x, y: MAPS.m1.base.y, heading: 0,
           charge: 0, co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0,
           rk: 0, vis: 2, name: 'Vy' })], docked: true, lab: { mods: 1 << 3, income: 0 } });
  evt('keydown', { key: 'h' });                    // the station
  frame(t += 16); frames++;
  const G0 = bayLayout(innerWidth, innerHeight, { tab: 'hangar', hull: 'vanguard' });
  const statsTab = G0.tabs.find(x => x.key === 'stats');
  if (!statsTab) errs.push('the station has no STATS tab');
  else {
    click(statsTab.r); frame(t += 16); frames++;
    trace = []; frame(t += 16); frames++;
    const out = trace; trace = null;
    // The layers, named, in the order they are applied.
    const named = n => out.some(c => c.includes(n));
    if (!out.some(c => /^fillText Hull /.test(c)))
      errs.push('the STATS tab did not list the ship\'s attributes');
    else if (!named('the ship itself') && !named('guns, generators'))
      errs.push('the STATS tab showed final numbers without saying where they came from');
    else if (!named('research station'))
      errs.push('the STATS tab left the research ladder out of the breakdown');
    else console.log('stats: the breakdown names every layer — ship, gear, technologies, research');

    // Twenty-five attributes under eight headings is now twelve hundred pixels of
    // page in a four-hundred pixel window, so the whole of it only exists if the
    // WHEEL reaches it. Turned rather than assumed: this is exactly the bug that
    // shipped last week, where the notch moved two pixels and a column of
    // attributes below the fold could not be reached at all.
    //
    // Forty notches rather than the dozen it takes, because shared/scroll.js eases
    // toward its target and a list that chases needs frames as well as notches.
    const whole = [...out];
    for (let i = 0; i < 40; i++) {
      evt('wheel', { deltaY: 240 });
      trace = []; frame(t += 16); frames++; whole.push(...trace); trace = null;
    }
    const drew = n => whole.some(c => c.includes(n));
    if (!drew('HULL AND SHIELDS') || !drew('REACTOR') || !drew('ESCORT'))
      errs.push('the STATS tab drew its attributes in one unbroken column, or the wheel never reached the bottom of it');
    // A Vanguard has a Drumfire and neither of the other two systems, which is the
    // same rule the shop uses when it refuses a Null Skin to anyone but a Kestrel.
    // It read 'Lock bite' until the Vanguard's ability became rate of fire; the row
    // is 'Drumfire gain' now, and the claim underneath is the one that matters —
    // this page must show the dials of THIS hull's system and of no other.
    else if (!drew('Drumfire gain') || drew('Veil depth') || drew('Anchor swell'))
      errs.push('the STATS tab got the ability section wrong — a Vanguard has a Drumfire and neither of the others');
    // Every number goes through one formatter now. Before it, Math.round() drew a
    // 1.2/s rate of fire as "1", a 33% free output as "0" and a shield share as "0.0%".
    else if (!whole.some(c => /^fillText [\d.]+%\/s /.test(c)) || !whole.some(c => /^fillText 1\.2\/s /.test(c))
          || !whole.some(c => /^fillText x1\.00 /.test(c)))
      errs.push('the STATS tab rounded its fractions away — a share drew as 0%, a rate of fire as 1, an escort bonus as 1x');
    // And where the number alone says nothing, a line beside it that does.
    else if (!drew('to refill the pool') || !drew('after leaving their radar'))
      errs.push('the STATS tab printed the unobvious stats without saying what any of them mean');
    else console.log('stats: 8 headings reached by the wheel, the Vanguard\'s own Drumfire, and a line saying what each number means');

    // The HUD's own hull number, which is a different code path from the STATS tab
    // and was a bare resolve() — it printed the hull the SHOPS sold you while the
    // server flew the researched one, and dropped the escort and the formation with
    // it. That is the readout a pilot watches while swapping hulls, which is why
    // research looked like it broke on a hull swap.
    click(G0.tabs.find(x => x.key === 'hangar').r);
    frame(t += 16); frames++;
    dismiss();
    feed({ t: 's', ships: [packShip({ id: 1, x: MAPS.m1.base.x, y: MAPS.m1.base.y, heading: 0,
             charge: 0, co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0,
             rk: 0, vis: 2, name: 'Vy' })], docked: true,
           lab: { mods: (1 << 3) | (1 << 4), income: 0 } });    // hull x4
    trace = []; frame(t += 16); frames++;
    const hud = trace; trace = null;
    const hu = hud.find(c => /^fillText .*HU \d/.test(c));
    const shown = hu && Number((hu.match(/HU (\d+)/) ?? [])[1]);
    if (!hu) errs.push('the HUD drew no hull readout at all');
    else if (shown === 1100)
      errs.push(`the HUD printed the hull the shops sold (${shown}) while research made it 4400`);
    else console.log(`stats: the HUD prints the hull the server is flying — ${shown}, not the shop's 1,100`);
    // Put the station back on HANGAR before leaving. bayTab is module state and the
    // station walk two hundred lines below starts by clicking hangar rows without
    // selecting the tab first — so leaving it on STATS made every one of those
    // clicks land on a stats row and produce nothing. Second time this session a
    // block of mine has leaked input state into a later one.
    click(G0.tabs.find(x => x.key === 'hangar').r);
    frame(t += 16); frames++;
  }
  dismiss();
}

// The threat file. A hostile is in it the first time you kill one and NOT BEFORE —
// absent, not greyed out — and the count comes with it. That absence is the whole
// design, so the assertion that matters is the negative one.
{
  dismiss();
  feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard',
         fit: { weapon: [], generator: [], tech: [] } });
  feed({ t: 'map', map: 'm1' });
  // Nothing killed yet: the file opens and says so rather than showing a void.
  feed({ t: 's', ships: [], kills: {} });
  evt('keydown', { key: 'l' });
  trace = []; frame(t += 16); frames++;
  let out = trace; trace = null;
  if (!out.some(c => /^fillText THREAT FILE/.test(c)))
    errs.push('L did not open the threat file');
  if (!out.some(c => /Nothing recorded yet/.test(c)))
    errs.push('an empty threat file showed a void instead of saying it was empty');

  // Two kinds killed. Both are in it with their counts; the seven others are not.
  feed({ t: 's', ships: [], kills: { drifter: 412, thresher: 2 } });
  trace = []; frame(t += 16); frames++;
  out = trace; trace = null;
  const named = n => out.some(c => c.startsWith(`fillText ${n} `));
  if (!named('Drifter') || !named('Thresher'))
    errs.push('a hostile this pilot has killed was missing from the threat file');
  else if (named('Corsair Hive') || named('Bandit') || named('Lamprey'))
    errs.push('the threat file listed a hostile this pilot has never killed');
  else if (!out.some(c => /^fillText 412 /.test(c)))
    errs.push('the threat file recorded a hostile without saying how many');
  // Derived from WILD, not written out: adding a hostile must not fail a test about
  // a different line. It did — the Kedge made it "2 of 10" and this said 9.
  else if (!out.some(c => new RegExp(`^fillText 2 of ${WILD.length} recorded`).test(c)))
    errs.push('the threat file did not say how much of it is still unwritten');
  else if (!out.some(c => /mirror|comes back out/.test(c)))
    errs.push('a recorded hostile did not explain what it does');
  else console.log('threats: killed hostiles are filed with their count, unkilled ones are absent — ' +
    `${filedIn({ drifter: 1, thresher: 1 }).join(', ')} of 9`);
  // The quest line, which is the file's second job. A hostile with a quest gets a
  // goal and a bar under its entry; one without gets nothing at all, because a row
  // of empty furniture on the eight that have none is worse than no line.
  {
    const q = QUESTS[QUEST_KEYS[0]], need = needFor(q.kind);
    feed({ t: 's', ships: [], kills: { [q.kind]: need - 1 }, unlocked: [] });
    trace = []; frame(t += 16); frames++;
    let out2 = trace; trace = null;
    const shortOf = questLine({ [q.kind]: need - 1 }, q.kind, []).label;
    if (!out2.some(c => c.includes(shortOf)))
      errs.push(`the threat file did not say how far off "${q.name}" is`);
    else if (out2.some(c => c.includes('EARNED')))
      errs.push('the threat file said a quest was earned one kill short of it');
    else {
      // And the same entry once it is in hand. `unlocked` is what the server says,
      // not what the tally implies — see shared/quests.js on why the two are allowed
      // to disagree — so this drives the field rather than the count.
      feed({ t: 's', ships: [], kills: { [q.kind]: need }, unlocked: [QUEST_KEYS[0]] });
      trace = []; frame(t += 16); frames++;
      out2 = trace; trace = null;
      if (!out2.some(c => c.includes(`${q.name.toUpperCase()}  EARNED`)))
        errs.push('a quest this pilot has finished did not read as earned');
      else console.log(`threats: "${q.name}" reads ${need - 1}/${need} and then EARNED`);
    }
    // The banner. A five hour hunt landing has to say so on screen rather than
    // arriving as a silently larger escort column.
    //
    // TWO CLOCKS, and this block owns one of them. say() stamps the notice with
    // performance.now() and the draw measures its age against the timestamp the
    // FRAME was handed — which in here is a counter that has been running since the
    // first scene, thousands of milliseconds ahead of the real clock. The notice was
    // four seconds stale before it was written, so it cleared itself on the frame
    // that should have drawn it. Anchored to the frame clock for the two frames this
    // needs, and put back afterwards, exactly as the idle-timeout block does.
    const realNow = performance.now;
    performance.now = () => t;
    try {
      feed({ t: 'unlocked', key: QUEST_KEYS[0], what: q.name, won: q.won ?? q.tell,
             kind: q.kind, need });
      trace = []; frame(t += 16); frames++;
      out2 = trace; trace = null;
    } finally { performance.now = realNow; }
    if (!out2.some(c => c.includes(`${q.name.toUpperCase()} EARNED`)))
      errs.push('finishing a quest drew no banner');
    else console.log('threats: finishing one says so across the top of the screen');
  }

  // It scrolls, and it comes back. The wheel was clamped at zero and not at the
  // end, so scrolling past the last entry kept counting and coming back up did
  // nothing until every phantom step had been undone — indistinguishable from a
  // panel that does not scroll.
  feed({ t: 's', ships: [],
         kills: Object.fromEntries(WILD.map((k, i) => [k, i + 1])) });   // all of them
  frame(t += 16); frames++;
  const F = filePanel(innerWidth, innerHeight, 0, WILD.length);
  if (F.maxScroll <= 0) errs.push('the threat file fits every hostile, so scrolling cannot be tested');
  else {
    const topRow = () => {
      for (let i = 0; i < 14; i++) { frame(t += 16); frames++; }   // let the easing settle
      trace = []; frame(t += 16); frames++;
      const out2 = trace; trace = null;
      const first = filedIn(Object.fromEntries(WILD.map((k, i) => [k, i + 1])));
      return first.find(k => out2.some(c => c.startsWith(`fillText ${ALIENS[k].name} `)));
    };
    const before = topRow();
    for (let i = 0; i < 3; i++) { evt('wheel', { deltaY: 240 }); frame(t += 16); frames++; }
    const scrolled = topRow();
    if (scrolled === before) errs.push('the threat file did not scroll when the wheel was turned');
    // Far past the end, then all the way back: it must return, not owe steps.
    //
    // SYMMETRIC, rather than forty notches down and four up. Four happened to clear a
    // ten-hostile file, and stopped clearing it at twelve — so the claim had quietly
    // become "the list is short", and it started failing on a roster change and on
    // anything that ran enough frames before it, rather than on the bug it was
    // written for. The same count both ways cannot: what this is looking for is
    // phantom steps counted past the end, and if any are owed the file does not come
    // back however long the list is or whatever has happened before it.
    const NOTCHES = 40;
    for (let i = 0; i < NOTCHES; i++) { evt('wheel', { deltaY: 240 }); frame(t += 16); frames++; }
    for (let i = 0; i < NOTCHES; i++) { evt('wheel', { deltaY: -240 }); frame(t += 16); frames++; }
    const back = topRow();
    if (back !== before)
      errs.push(`scrolling to the end and back left the threat file on ${back} instead of ${before}`);
    else console.log(`threats: the file scrolls (${F.fit} of ${WILD.length} at a time) and comes back`);
  }
  // The X, and clicking away. Neither was ever driven, and both were broken for a
  // whole version: the smooth-scroll rework renamed the scroll state and fileClick
  // was left reading the old name, so every click in the panel threw and the panel
  // could only be closed with the key that opened it.
  const F2 = filePanel(innerWidth, innerHeight, 0, WILD.length);
  click(F2.close); frame(t += 16); frames++;
  trace = []; frame(t += 16); frames++;
  if (trace.some(c => /^fillText THREAT FILE/.test(c)))
    errs.push('the close button on the threat file did nothing');
  trace = null;
  evt('keydown', { key: 'l' }); frame(t += 16); frames++;   // open it again
  click({ x: 4, y: 4, w: 1, h: 1 });                        // and away closes it too
  frame(t += 16); frames++;
  trace = []; frame(t += 16); frames++;
  if (trace.some(c => /^fillText THREAT FILE/.test(c)))
    errs.push('clicking away from the threat file did not close it');
  trace = null;
  console.log('threats: the X closes it, and so does clicking away');
}

// The safe-zone badge. Sanctuary has been in the game since the beginning and had
// never once said so — you learned the base ring by noticing nothing shot you, and
// the portal mouth you never learned at all, because nothing draws that 288px
// circle anywhere. Half the value of this badge is that it is the only place the
// game admits the portal haven exists.
{
  dismiss();
  const B = havenBadge(innerWidth);
  const me = (x, y, extra = {}) => packShip({ id: 1, x, y, heading: 0, charge: 0, co: 'm',
    hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2,
    name: 'Vy', ...extra });
  const show = (map, ships) => { feed({ t: 'map', map }); feed({ t: 's', ships }); };
  const badge = () => {                              // what the badge says this frame
    trace = []; frame(t += 16); frames++;
    const out = trace; trace = null;
    // Must say SAFE: the docked readout top-left opens with the same diamond, and
    // matching on the glyph alone quietly tested that instead.
    const hit = out.find(c => /^fillText [\u25c6\u25b2]\s+SAFE/.test(c));
    return hit ? hit.split(/\s+/).slice(2, -2).join(' ') : null;
  };

  const ring = MAPS.m1.base, mouth = MAPS.m1.portals[0], post = MAPS.m4.outpost;
  show('m1', [me(ring.x, ring.y)]);
  hoverAt(B);                                        // drive the pointer over it, not just frames
  const inRing = badge();
  show('m1', [me(ring.x + ring.r + 40, ring.y)]);
  const outside = badge();
  if (!inRing || !inRing.includes('SAFE'))
    errs.push(`a ship in its own ring was not told it was safe (badge said ${JSON.stringify(inRing)})`);
  else if (outside)
    errs.push(`a ship outside the ring was still told it was safe (${JSON.stringify(outside)})`);
  else console.log(`safe zone: told inside the ${ring.r}px ring and silent ${40}px outside it — ` +
                   `"${inRing}"`);

  // The portal mouth, which is the one nothing else in the game mentions.
  show('m1', [me(mouth.x, mouth.y)]);
  const atMouth = badge();
  if (!atMouth || !atMouth.includes('PORTAL'))
    errs.push(`a portal mouth is sanctuary and the badge did not say so (${JSON.stringify(atMouth)})`);
  else console.log(`safe zone: a portal mouth says so too — ${HAVEN_R}px, and nothing else in the game draws it`);

  // A pirate outpost keeps the peace and pointedly does not mend you. If the two
  // read the same, the badge is telling a pilot at 8% hull that they are fine.
  show('m4', [me(post.x, post.y)]);
  const atPost = badge();
  if (!atPost || atPost === inRing)
    errs.push('a pirate outpost read exactly like your own ring, which mends you and it does not');
  else console.log(`safe zone: an outpost does not read like a ring — "${atPost}"`);

  // And peace already broken is not peace. Sanctuary stops an alien STARTING;
  // one that is already on you follows you in. A badge a pilot learns to trust
  // and then dies inside is worse than no badge at all.
  show('m1', [me(ring.x, ring.y), packShip({ id: 1e6, x: ring.x + 200, y: ring.y, heading: 0,
    charge: 0, co: 'x', hull: 'drifter', hp: 100, sh: 100, flash: 0, tgt: 1, shot: 0, rk: 0,
    vis: 1, name: '' })]);
  const hunted = badge();
  if (hunted !== HAVEN_BROKEN.text)
    errs.push(`a hostile already firing on me in a haven still read as calm (${JSON.stringify(hunted)})`);
  else console.log(`safe zone: with one already on you it warns instead of reassuring — "${hunted}"`);

  // Pure geometry, and the reason the rectangle lives in shared/ rather than in
  // the client: it has to be provable that the badge does not land on the
  // changelog icon or on the first receipt.
  const icon = patchIcon(innerWidth);
  const toast = { x: innerWidth - 260 - 16, y: 92, w: 260, h: 46 };
  const clash = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  if (clash(B, icon) || clash(B, toast))
    errs.push(`the safe-zone badge lands on ${clash(B, icon) ? 'the changelog icon' : 'the first receipt'}`);
  else console.log(`safe zone: the badge at ${B.x},${B.y},${B.w},${B.h} clears the icon and the receipts`);
  show('m1', [me(6000, 4000)]);
  frame(t += 16); frames++;
}

// The research panel. R opens it from anywhere; what it offers depends on whether
// you have a station yet, and buying anything on it needs you standing at the one
// you own. The panel is the only place a plot is sold, so a pilot who presses R
// with nothing built has to find the thing to buy rather than an empty box.
{
  dismiss();
  const L = labPanel(innerWidth, innerHeight);
  const ring = MAPS.m1.base;
  const me = (x, y) => packShip({ id: 1, x, y, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
    hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, name: 'Vy' });

  // No station, standing at the dock, plenty of money: it must offer the plot.
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [me(ring.x, ring.y)], credits: 9_000_000, docked: true, labs: [], lab: null });
  // Before opening anything: a pilot who has never heard of a research station has
  // to find out it exists. The HUD says so once it is a goal rather than a nag.
  trace = []; frame(t += 16); frames++;
  const hud = trace; trace = null;
  if (!hud.some(c => /^fillText R — research station/.test(c)))
    errs.push('a pilot with the money for a research station was never told one existed');
  evt('keydown', { key: 'r' });
  trace = []; frame(t += 16); frames++;
  let out = trace; trace = null;
  if (!out.some(c => /^fillText Stake a plot/.test(c)))
    errs.push('pressing R with no research station offered no way to get one');
  // Staking is permanent and costs 500,000, so one click is not the transaction.
  sent.length = 0;
  click(L.rows[0].r); frame(t += 16); frames++;
  if (sent.some(m => m.t === 'stake'))
    errs.push('one click spent 500,000 credits on a permanent thing with no confirmation');
  trace = []; frame(t += 16); frames++;
  const asked = trace; trace = null;
  if (!asked.some(c => /permanent/i.test(c)))
    errs.push('the research panel asked for confirmation without saying it was permanent');
  if (!asked.some(c => /research/i.test(c)))
    errs.push('the confirmation never said what a research station is for');
  // Clicking away takes the offer back off the table rather than leaving it armed.
  click({ x: 4, y: 4, w: 1, h: 1 }); frame(t += 16); frames++;
  evt('keydown', { key: 'r' }); frame(t += 16); frames++;          // reopen
  sent.length = 0;
  click(L.rows[0].r); frame(t += 16); frames++;
  if (sent.some(m => m.t === 'stake'))
    errs.push('a confirmation survived the panel being closed, so a stray click bought a plot');
  // Twice, deliberately, is the transaction.
  click(L.rows[0].r); frame(t += 16); frames++;
  if (!sent.some(m => m.t === 'stake'))
    errs.push('confirming the plot twice still did not stake it');
  else console.log(`research: the plot costs ${LAB_PRICE} and takes two deliberate clicks to place`);

  // With a station, the panel is three ladders — and it will not sell you a rung
  // while you are sitting at the dock rather than at the station itself.
  //
  // `claims: ['mine1']` is not decoration. A mining rung is a rock somebody is
  // sitting on now, so the Mining row is a CLAIM until that rock is freed and this
  // block is about buying, not fighting — the claim gate has its own block below.
  // Without it every assertion here fails for the wrong reason, which is exactly
  // what happened the first time.
  const at = { x: ring.x + 400, y: ring.y };
  const labRow = packLab({ id: 2_000_001, x: at.x, y: at.y, mods: 0, name: 'Vy' }, true);
  feed({ t: 's', ships: [me(ring.x, ring.y)], credits: 9_000_000, docked: true,
         labs: [labRow], lab: { mods: 0, income: 0 }, claims: ['mine1'] });
  frame(t += 16); frames++;
  sent.length = 0;
  click(L.rows[0].r); frame(t += 16); frames++;
  if (sent.some(m => m.t === 'build'))
    errs.push('bought a module from across the sector rather than at the station');

  // Fly to it and the same click works.
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 9_000_000, docked: false,
         labs: [labRow], lab: { mods: 0, income: 0 }, claims: ['mine1'] });
  frame(t += 16); frames++;
  sent.length = 0;
  click(L.rows[0].r); frame(t += 16); frames++;
  const bought = sent.find(m => m.t === 'build');
  // Checked here rather than at the dock: this is the frame where the panel's
  // state is known good from both sides, because the click just came out of it.
  trace = []; frame(t += 16); frames++;
  const shown = trace; trace = null;
  if (bought?.key !== 'mine1')
    errs.push(`standing at my own station, buying sent ${JSON.stringify(bought)}`);
  else if (!shown.some(c => c.includes(MODULES.mine1.name)))
    errs.push('the research panel sold a rung it never named on screen');
  else console.log(`research: a rung is sold at the station and refused from the dock — ` +
                   `"${MODULES.mine1.name}"`);

  // Standing at your own station, the world says what to press — R appears on no
  // other prompt and nothing else in the game mentions it. And the panel says what
  // a rung would do to the ship you are actually flying, in your own numbers: a
  // pilot cannot tell whether "stronger" means one percent or one hundred.
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 9_000_000, docked: false,
         labs: [labRow], lab: { mods: 0, income: 0 }, claims: ['mine1'] });
  trace = []; frame(t += 16); frames++;
  const world = trace; trace = null;
  if (!world.some(c => /^fillText PRESS R /.test(c)))
    errs.push('standing at my own research station, nothing told me which key opens it');
  else console.log('research: standing at your own station, the world says PRESS R');

  // No keypress here: the panel is already open from the click above, and pressing
  // R would TOGGLE it shut. That is the second time this block has caught me.
  trace = []; frame(t += 16); frames++;
  const rows = trace; trace = null;
  // "your hull 1,100 -> 2,200", drawn off myStats(), not a multiplier in prose.
  if (!rows.some(c => /^fillText your hull [\d,]+ -> [\d,]+/.test(c)))
    errs.push('the research panel described a hull upgrade without saying what it would make my hull');
  else console.log('research: a rung says what it does to YOUR ship — ' +
    rows.find(c => /^fillText your hull/.test(c)).replace(/^fillText /, '').replace(/ [\d.]+ [\d.]+$/, ''));

  // The SECOND rung, which is where it went wrong. A pilot with one shield tier is
  // flying twice what the shops sold them, and the panel quoted the shop number:
  // "your shield 3,700 -> 7,400" for a rung that actually takes 7,400 to 14,800.
  // The client's idea of the ship has to be the server's, or every line that reads
  // off it is one tier behind.
  const num = t2 => Number(String(t2).replace(/,/g, ''));
  const quoted = (out2, what) => {
    const hit = out2.find(c => new RegExp(`^fillText your ${what} `).test(c));
    const m2 = hit && hit.match(/([\d,]+) -> ([\d,]+)/);
    return m2 ? { now: num(m2[1]), then: num(m2[2]) } : null;
  };
  const first = quoted(rows, 'shield');
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 90_000_000, docked: false,
         labs: [packLab({ id: 2_000_001, x: at.x, y: at.y, mods: 1 << 8, name: 'Vy' }, true)],
         lab: { mods: 1 << 8, income: 0 }, claims: ['mine1'] });   // one shield tier built
  trace = []; frame(t += 16); frames++;
  const after = trace; trace = null;
  const second = quoted(after, 'shield');
  if (!first || !second)
    errs.push('the research panel stopped quoting a shield number');
  else if (second.now !== first.then)
    errs.push(`after buying a shield tier the panel starts from ${second.now} ` +
              `instead of the ${first.then} it just gave me`);
  else if (second.then !== second.now * 2)
    errs.push(`the second shield rung quoted ${second.now} -> ${second.then}, not double`);
  else console.log(`research: the second rung starts where the first one left off — ` +
    `${first.now} -> ${first.then} -> ${second.then}`);

  // BROKE most of the time and hardest to notice: the gain was an else-branch of
  // the refusal, so a pilot who could not afford a rung was shown "costs 2,000,000
  // cr, you cannot pay yet" INSTEAD of what it would do for them. The one moment
  // somebody most needs to know what they are saving toward was the one moment the
  // panel refused to say it.
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 1_000, docked: false,
         labs: [packLab({ id: 2_000_001, x: at.x, y: at.y, mods: 0, name: 'Vy' }, true)],
         lab: { mods: 0, income: 0 }, claims: ['mine1'] });
  trace = []; frame(t += 16); frames++;
  const broke = trace; trace = null;
  const quotes = broke.some(c => /^fillText your hull [\d,]+ -> [\d,]+/.test(c));
  const distance = broke.some(c => /to go/.test(c));
  if (!quotes)
    errs.push('a pilot who cannot afford a rung was not told what it would do for them');
  else if (!distance)
    errs.push('a pilot who cannot afford a rung was not told how far off it is');
  else console.log('research: with 1,000 credits it still quotes the gain, and says how far off it is');

  // And hovering a rung says what the rest of the ladder is worth.
  hoverAt(L.rows[1].r);
  trace = []; frame(t += 16); frames++;
  const tip = trace; trace = null;
  if (!tip.some(c => /rungs left on this ladder/.test(c)))
    errs.push('hovering a research rung said nothing about the rest of the ladder');
  else console.log('research: hovering a rung prices the whole ladder above it');
  hoverAt({ x: 4, y: 4, w: 1, h: 1 });

  // A station that has been built on looks built on, to everyone, and a mine
  // running makes the credits counter move between server banks.
  const others = packLab({ id: 2_000_002, x: ring.x - 400, y: ring.y, mods: 7, name: 'Someone' }, false);
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 1_000_000, claims: ['mine1'],
         labs: [labRow, others], lab: { mods: 1, income: MODULES.mine1.rate } });
  evt('keydown', { key: 'r' });                    // shut it, so the world is visible
  frame(t += 16); frames++;
  trace = []; frame(t += 16); frames++;
  out = trace; trace = null;
  if (!out.some(c => /^fillText Someone /.test(c)))
    errs.push("another pilot's research station was drawn without their name on it");
  else console.log('research: every station in the ring is drawn and named, yours and theirs');
}

// A claim arena, which is a sector that is not in MAPS.
//
// This is the highest-risk block in the file and it is worth saying why. drawFrame
// wraps itself in a try/catch that sets a flag suppressing every later error, so
// ONE bare `MAPS[mapId]` left in the client is not an exception anybody sees: it is
// a permanently black canvas with the socket still running and nothing in the
// console. Every draw path is walked here with the world set to an instanced
// sector — the rock, the minimap, the jump prompt, the safe-zone badge, the SPACE
// prompt and the mission bar — because the only way to catch that is to draw it.
{
  dismiss();
  const arena1 = arenaId('rendertoken', 'mine1');
  const rock = mapOf(arena1).rock;
  const me = (x, y) => packShip({ id: 1, x, y, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
    hp: 60, sh: 40, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, name: 'Vy' });
  const foe = (i, x, y) => packShip({ id: 1e6 + i, x, y, heading: 1, charge: 0, co: 'x',
    hull: i % 2 ? 'censer' : 'ironhusk', hp: 90, sh: 50, flash: 0, tgt: 1, shot: 60, abl: 70, vis: 1 });

  feed({ t: 'map', map: arena1 });
  const field = { key: 'mine1', left: 9, total: countOf('mine1'), cleared: 0, replay: 0 };
  feed({ t: 's', ships: [me(rock.x, rock.y - 1900), foe(1, rock.x + 900, rock.y), foe(2, rock.x, rock.y + 800)],
         credits: 250_000, docked: false, labs: [], lab: { mods: 0, income: 0 },
         claims: [], arena: field });
  trace = []; frame(t += 16); frames++;
  let a = trace; trace = null;
  const bar = mission(innerWidth, field);
  if (!a.some(c => c.startsWith(`fillText ${bar.text} `)))
    errs.push(`inside a claim the mission bar never said "${bar.text}"`);
  else if (!a.some(c => /^fillText CONTESTED CLAIM /.test(c)))
    errs.push('the rock the whole fight is about was never drawn');
  else console.log(`claim: the sector, the rock and the bar — "${bar.text}" at ${bar.x},${bar.y}`);

  // Everything a pilot can press while standing in a sector with no portals, no
  // dock and no haven. Any of these reaching for map.portals[0] is a black screen.
  for (const k of ['m', 'm', 'h', 'h', 'i', 'i', 'r', 'r', 'l', 'l', 'Tab', 'x', ' ']) {
    evt('keydown', { key: k }); frame(t += 16); frames++;
  }
  dismiss();
  for (const [px, py] of [[40, 40], [innerWidth / 2, innerHeight / 2], [innerWidth - 60, innerHeight - 40]]) {
    evt('pointermove', { clientX: px, clientY: py });
    evt('pointerdown', { clientX: px, clientY: py });
    evt('pointerup', { clientX: px, clientY: py });
    frame(t += 16); frames++;
  }
  evt('pointerleave');

  // Cleared, and cleared on a REPLAY, which says something different on purpose.
  for (const state of [{ ...field, left: 0, cleared: 1 }, { ...field, left: 0, cleared: 1, replay: 1 }]) {
    feed({ t: 's', ships: [me(rock.x, rock.y - 600)], credits: 250_000, docked: false,
           labs: [], lab: { mods: 0, income: 0 }, claims: ['mine1'], arena: state });
    trace = []; frame(t += 16); frames++;
    a = trace; trace = null;
    const b2 = mission(innerWidth, state);
    if (!a.some(c => c.startsWith(`fillText ${b2.text} `)))
      errs.push(`a cleared claim never said "${b2.text}"`);
  }
  console.log('claim: won and won-again both say what they were for, and the rock cracks open');

  // And back out. The bar has to GO, and it goes by the field being absent from
  // the bag rather than by anything telling the client to stop drawing it.
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [me(MAPS.m1.base.x, MAPS.m1.base.y)], credits: 250_000, docked: true,
         labs: [], lab: { mods: 0, income: 0 }, claims: ['mine1'] });
  trace = []; frame(t += 16); frames++;
  a = trace; trace = null;
  if (a.some(c => /HOSTILES LEFT|CLAIM FREED|FIELD CLEAR/.test(c)))
    errs.push('the mission bar stayed on screen after the station pulled the pilot home');
  else console.log('claim: the bar goes away with the sector — absence is information');
}

// A DUEL, which is the first instanced sector that has a portal in it.
//
// The claim block above exists because `map.portals[0]` is undefined in an arena and
// `MAPS[undefined].tint` is a black screen. A duel makes that guard load-bearing in
// the other direction: it HAS a portal, and that portal names no destination map at
// all — each of the two pilots comes out at their own hangar — so every place that
// reads `MAPS[p.to]` is the same black screen unless it reads the portal's own tint
// first. There are four of them: the world ring, its label, the jump button and the
// dot on the plot. The only way to catch that is to draw it and press the button.
//
// The countdown and the bar are drawn here too, because both are READOUTS of numbers
// the server sent — a client that invented either would be lying to the person
// holding it, and a client that drew `undefined` for either would look identical.
{
  dismiss();
  const duelId = arenaId('rendertoken', DUEL_KEY);
  const dm = mapOf(duelId), port = dm.portals[0];
  const A = startsAt(0), B = startsAt(1);
  const seat = (id, at, name) => packShip({ id, x: at.x, y: at.y, heading: at.heading, charge: 0,
    co: 'm', hull: id === 1 ? 'vanguard' : 'hauler', hp: 70, sh: 55, flash: 0, tgt: 0, shot: 0,
    rk: 0, vis: 2, name });
  feed({ t: 'map', map: duelId });

  // The countdown, every whole second of it, plus the fight and all three endings.
  const states = [
    { count: 5, foe: 'Bly', id: 2, left: 300 }, { count: 3.4, foe: 'Bly', id: 2, left: 298 },
    { count: 0.2, foe: 'Bly', id: 2, left: 295 }, { count: 0, foe: 'Bly', id: 2, left: 244 },
    { count: 0, foe: 'Bly', id: 2, left: 9, over: 1, won: 1 },
    { count: 0, foe: 'Bly', id: 2, left: 9, over: 1, won: 0 },
    { count: 0, foe: 'Bly', id: 2, left: 0, over: 1, draw: 1 },
  ];
  for (const d of states) {
    feed({ t: 's', ships: [seat(1, A, 'Vy'), seat(2, B, 'Bly')],
           credits: 250_000, docked: false, labs: [], lab: null, claims: [],
           // A bond and an ore pod on the floor, which is what a duel leaves behind.
           pods: [packPod({ id: 1, x: A.x + 60, y: A.y, mat: 'bond', n: 0, own: 0, cr: 50_000 }),
                  packPod({ id: 2, x: A.x + 90, y: A.y + 40, mat: 'iron', n: 12, own: 0 })],
           duel: d });
    trace = []; frame(t += 16); frames++;
    const a2 = trace; trace = null;
    const want = missionBar(innerWidth, duelText({ count: d.count, foe: d.foe, over: !!d.over,
                                                  won: !!d.won, draw: !!d.draw, left: d.left }));
    if (!a2.some(c => c.startsWith(`fillText ${want.text} `)))
      errs.push(`the duel bar never said "${want.text}"`);
    // The countdown is drawn from the server's own number, so 5.0 and 3.4 both read
    // as whole seconds counting down and 0 draws nothing at all.
    const shown = a2.some(c => c.startsWith(`fillText ${Math.ceil(d.count)} `));
    if (d.count > 0 && !shown) errs.push(`the countdown never drew ${Math.ceil(d.count)}`);
    if (d.count === 0 && a2.some(c => /^fillText ENGINES AND GUNS ARE HELD /.test(c)))
      errs.push('the countdown was still on screen after the clock let go');
  }
  console.log(`duel: ${states.length} states — the countdown, the fight and all three endings`);

  // The purse. A bond is not a metal, so every place that reads MATERIALS[pod.mat]
  // has to have an answer for it — the label, the symbol, the colour and the plot.
  feed({ t: 's', ships: [seat(1, { ...A, x: A.x + 40 }, 'Vy')], credits: 250_000, docked: false,
         labs: [], lab: null, claims: [],
         pods: [packPod({ id: 1, x: A.x + 60, y: A.y, mat: 'bond', n: 0, own: 0, cr: 50_000 })],
         duel: { count: 0, foe: 'Bly', id: 2, left: 9, over: 1, won: 1 } });
  // Swept rather than aimed: the camera clamps inside a quarter-size sector, so
  // "the middle of the screen" is not the middle of the map and computing the one
  // pixel the pod is under would be a second copy of the projection.
  const pa = [];
  for (let px = 40; px < innerWidth - 40; px += 60)
    for (let py = 40; py < innerHeight - 40; py += 60) {
      evt('pointermove', { clientX: px, clientY: py });
      trace = []; frame(t += 16); frames++;
      pa.push(...trace); trace = null;
    }
  if (!pa.some(c => /^fillText Credit Bond /.test(c)))
    errs.push('hovering a credit bond never named it — six places read MATERIALS[pod.mat]');
  else if (!pa.some(c => /^fillText 50k /.test(c)))
    errs.push('a credit bond never said what it was worth, which is all there is to know about one');
  else console.log('duel: the purse reads as credits rather than as an undefined metal');

  // THE PORTAL. Standing in its mouth, which is what makes the jump button appear —
  // and the button, its ring, its label and its dot on the plot all reach for the
  // destination map, which for this one does not exist.
  feed({ t: 's', ships: [seat(1, { x: port.x, y: port.y, heading: 0 }, 'Vy'), seat(2, B, 'Bly')],
         credits: 250_000, docked: false, labs: [], lab: null, claims: [],
         duel: { count: 0, foe: 'Bly', id: 2, left: 120 } });
  trace = []; frame(t += 16); frames++;
  const qa = trace; trace = null;
  if (!qa.some(c => /^fillText JUMP {2}→ {2}YOUR HANGAR /.test(c)))
    errs.push('the way home out of a duel drew no jump button');
  else if (!qa.some(c => /^fillText THE WAY OUT /.test(c)))
    errs.push('the portal in the middle of a duel was never labelled');
  else console.log('duel: the way home draws, and it names no sector because it goes to yours');
  // And press it, then press everything else a pilot can press in here. The
  // rectangle is the client's own `btn()`, which is not in shared/ yet.
  click({ x: innerWidth / 2 - 115, y: innerHeight - 104, w: 230, h: 48 });
  for (const k of ['m', 'm', 'h', 'h', 'i', 'i', 'l', 'l', 'Tab', 'x', ' ']) {
    evt('keydown', { key: k }); frame(t += 16); frames++;
  }
  dismiss();
  for (const [px, py] of [[40, 40], [innerWidth / 2, innerHeight / 2], [innerWidth - 60, innerHeight - 40]]) {
    evt('pointermove', { clientX: px, clientY: py });
    evt('pointerdown', { clientX: px, clientY: py });
    evt('pointerup', { clientX: px, clientY: py });
    frame(t += 16); frames++;
  }
  evt('pointerleave');

  // And out. The bar and the countdown both go by the duel being ABSENT from the
  // bag, exactly the way the claim bar does — the delta reports it gone and
  // decodeDelta hands back the whole bag, so absence is information.
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [seat(1, { x: MAPS.m1.base.x, y: MAPS.m1.base.y, heading: 0 }, 'Vy')],
         credits: 250_000, docked: true, labs: [], lab: null, claims: [] });
  trace = []; frame(t += 16); frames++;
  const za = trace; trace = null;
  if (za.some(c => /ENGINES AND GUNS ARE HELD|BEFORE IT IS CALLED A DRAW|IS DOWN/.test(c)))
    errs.push('the duel bar stayed on screen after the duel ended');
  else console.log('duel: the bar and the countdown go away with the sector');
}

// The CLAIMS page. A replay is not a rung — it costs nothing and buys nothing —
// so it is its own page rather than a fourth button on the ladder.
{
  dismiss();
  const ring = MAPS.m1.base, at = { x: ring.x + 400, y: ring.y };
  const me = (x, y) => packShip({ id: 1, x, y, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
    hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2, name: 'Vy' });
  const labRow = packLab({ id: 2_000_001, x: at.x, y: at.y, mods: 0, name: 'Vy' }, true);
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 9_000_000, docked: false,
         labs: [labRow], lab: { mods: 0, income: 0 }, claims: ['mine1'] });
  evt('keydown', { key: 'r' });
  frame(t += 16); frames++;

  const L = labPanel(innerWidth, innerHeight, 'ladder');
  const C = labPanel(innerWidth, innerHeight, 'claims');
  click(L.tabs.find(tb => tb.key === 'claims').r);
  trace = []; frame(t += 16); frames++;
  let a = trace; trace = null;
  if (!a.some(c => c.includes(MODULES.mine2.name)))
    errs.push('the CLAIMS tab opened on a page that did not list the claims');
  else if (!a.some(c => /RUN IT AGAIN/.test(c)))
    errs.push('a rock already freed did not offer the flight again');
  else console.log(`claim: the CLAIMS tab lists ${ARENA_MODULES.length} rocks, freed ones offering the run again`);

  // Hovering every row, because hover starts null and a row nobody hovers is a
  // path nobody walks — two helper functions once went missing exactly this way.
  for (const row of C.rows) { hoverAt(row.r); frame(t += 16); frames++; }
  evt('pointerleave');

  // The freed rock sends a replay; the contested one below it sends a claim.
  sent.length = 0;
  click(C.rows[0].r); frame(t += 16); frames++;
  const again = sent.find(m => m.t === 'replay');
  if (again?.key !== 'mine1')
    errs.push(`clicking a freed rock sent ${JSON.stringify(again ?? sent.at(-1))}, not a replay`);
  else console.log('claim: a freed rock is flown again from its own page, and pays nothing');

  // Launching a claim CLOSES the panel — you are leaving, and a station panel that
  // followed you into the fight would be a panel over a fight. So every block
  // below reopens deliberately with a bare-space dismiss first: pressing R to
  // "make sure it is open" is pressing a TOGGLE, and this file has been caught by
  // that before.
  const reopen = () => { dismiss(); evt('keydown', { key: 'r' }); frame(t += 16); frames++; };

  reopen();
  sent.length = 0;
  click(C.rows[1].r); frame(t += 16); frames++;
  if (sent.find(m => m.t === 'claim')?.key !== 'mine2')
    errs.push(`clicking a contested rock sent ${JSON.stringify(sent.at(-1))}, not a claim`);

  // A rock two tiers up cannot be reached, and the row has to refuse rather than
  // offer — the panel must never send something the server will decline.
  reopen();
  sent.length = 0;
  click(C.rows[2].r); frame(t += 16); frames++;
  if (sent.some(m => m.t === 'claim' || m.t === 'replay'))
    errs.push('the CLAIMS page offered a rock the ladder has not reached yet');
  else console.log('claim: a rock two tiers up refuses in the same words the server would use');

  // Back to the ladder, where the mining row is a fight until the rock is free.
  click(L.tabs.find(tb => tb.key === 'ladder').r);
  feed({ t: 's', ships: [me(at.x, at.y)], credits: 9_000_000, docked: false,
         labs: [labRow], lab: { mods: 0, income: 0 }, claims: [] });
  trace = []; frame(t += 16); frames++;
  a = trace; trace = null;
  if (!a.some(c => /CLAIM THE ROCK/.test(c)))
    errs.push('the mining rung never said the rock had to be fought for');
  sent.length = 0;
  click(L.rows[0].r); frame(t += 16); frames++;
  if (sent.find(m => m.t === 'claim')?.key !== 'mine1')
    errs.push(`the mining rung sent ${JSON.stringify(sent.at(-1))} instead of launching the claim`);
  else console.log('claim: the mining rung on the ladder launches the fight, not a purchase');
  dismiss();
}

// Flying without the mouse, driven through the real key handlers and the real
// flush. Farming wants a hand free, so WASD feeds the same 'dir' intent the mouse
// hold does rather than inventing a second way to move a ship.
{
  const dirs  = () => sent.filter(m => m.t === 'intent' && m.mode === 'dir');
  const stops = () => sent.filter(m => m.t === 'intent' && m.mode === 'stop');
  const only  = () => { const d = dirs(); return d.length === 1 ? d[0] : null; };

  sent.length = 0;
  evt('keydown', { key: 'd' }); flush();
  const east = only();
  if (!east) errs.push(`holding D sent ${dirs().length} course intents, not 1`);
  else if (east.dx !== 1 || east.dy !== 0) errs.push(`D steered ${east.dx},${east.dy}, not 1,0`);

  sent.length = 0;
  evt('keydown', { key: 'w' }); flush();               // W and D together
  const ne = only();
  if (!ne) errs.push('holding W and D together stopped sending a course');
  else if (Math.abs(Math.hypot(ne.dx, ne.dy) - 1) > 1e-9)
    errs.push(`a diagonal asked for ${Math.hypot(ne.dx, ne.dy).toFixed(3)} throttle, not 1`);

  sent.length = 0;                                     // drop D, then hold W's opposite
  evt('keyup',   { key: 'd' });
  evt('keydown', { key: 's' }); flush();
  if (dirs().length) errs.push('W and S at once still steered somewhere');
  if (stops().length !== 1) errs.push(`cancelling keys sent ${stops().length} stops, not 1`);

  sent.length = 0;                                     // let go of everything
  for (const k of ['w', 'a', 's', 'd']) evt('keyup', { key: k });
  flush(); flush();
  if (dirs().length) errs.push('the ship kept steering after every key came up');
  if (stops().length > 1) errs.push(`releasing sent ${stops().length} stops, and it should settle`);

  // Typing must never fly the ship. h/i/q/x are already letters in the chat and
  // WASD has to be too — otherwise saying "was" to someone launches you.
  sent.length = 0;
  evt('keydown', { key: 'Enter' });                    // opens the chat
  for (const k of ['w', 'a', 's', 'd']) evt('keydown', { key: k });
  flush();
  if (dirs().length || stops().length) errs.push('typing in the chat steered the ship');

  // A key held as the window loses focus is the one that never comes up on its
  // own: alt-tab mid-burn and the ship would fly until something else stopped it.
  for (const k of ['Escape']) evt('keydown', { key: k });   // close the chat
  sent.length = 0;
  evt('keydown', { key: 'ArrowUp' }); flush();      // the other hand's binding
  const up = only();
  if (!up) errs.push('ArrowUp did not steer the ship');
  else if (up.dx !== 0 || up.dy !== -1) errs.push(`ArrowUp steered ${up.dx},${up.dy}, not 0,-1`);
  evt('keyup', { key: 'ArrowUp' });

  sent.length = 0;
  evt('keydown', { key: 'w' }); flush();
  if (!dirs().length) errs.push('W did not steer once the chat was closed again');
  sent.length = 0;
  evt('blur'); flush(); flush();
  if (dirs().length) errs.push('a key held when the window lost focus kept flying the ship');
  console.log('steering: WASD and the arrows fly, diagonals hold one throttle, '
    + 'opposites stop, typing and blur release');
}

// The hangar's APPLY button: does clicking it actually ask the server for a refit?
{
  feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                                    hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, vis: 2 })] });
  feed({ t: 'map', map: 'm1' });
  feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                                    hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, vis: 2 })] });
  // pin hull and escort so the computed rows are the rows the client draws
  feed({ t: 'fit', hull: 'vanguard',
         fit: { weapon: ['emitter1'], generator: ['cellA'], tech: ['plating'] },
         drones: ['emitter1', null], gear: { emitter1: 2, damper: 1 },
         formation: 'line', formations: ['line', 'wedge'],
         hulls: ['hauler', 'vanguard'], credits: 90000 });
  sent.length = 0;
  const state = { hull: 'vanguard', drones: 2, hulls: ['hauler', 'vanguard'],
                  formations: ['line', 'wedge'], gear: { emitter1: 2, damper: 1 } };
  evt('keydown', { key: 'h' });                                  // open the station
  frame(t += 16); frames++;

  // HANGAR: hover every row (which draws its tooltip) then click it
  let rows = 0;
  const H = bayLayout(innerWidth, innerHeight, { ...state, tab: 'hangar' });
  for (const o of [...H.hulls, ...H.racks.filter(r => !r.header)]) {
    hoverAt(o.r); frame(t += 16); frames++; rows++;
    click(o.r);
  }
  frame(t += 16); frames++;

  // STORE: every page, every row on it. A page whose rows are never drawn or
  // never clickable is how the old rack quietly stopped working.
  let storeRows = 0;
  // Shelves scroll now, so walking only the first screenful would quietly stop
  // covering the shop the moment a page outgrew the panel — which the technology
  // shelf did the day it went from four entries to fifteen. Every page is scrolled
  // to the bottom and every row on it is hovered and clicked.
  for (const page of STORE_PAGES.map(p2 => p2.key)) {
    const first = bayLayout(innerWidth, innerHeight, { ...state, tab: 'store', page });
    click(first.tabs.find(x => x.key === 'store').r);
    click(first.pages.find(x => x.key === page).r);
    frame(t += 16); frames++;
    const seen = new Set();
    for (let at = 0; at <= (first.scroll?.max ?? 0); at++) {
      const S = bayLayout(innerWidth, innerHeight, { ...state, tab: 'store', page, scroll: at });
      for (const it of S.store) {
        if (seen.has(it.k)) continue;
        seen.add(it.k);
        hoverAt(it.r); frame(t += 16); frames++; storeRows++;
        click(it.r);
      }
      if (at < (first.scroll?.max ?? 0)) { evt('wheel', { deltaY: 120 }); frame(t += 16); frames++; }
    }
    const want = first.scroll?.total ?? first.store.length;
    if (seen.size !== want)
      errs.push(`the ${page} shelf has ${want} rows and only ${seen.size} were reachable`);
    frame(t += 16); frames++;
  }
  // The inventory tab: everything you own that is not bolted on, and the only place
  // you can sell any of it. It had no UI at all until this, so it gets walked the
  // same way the shop does.
  {
    const inv = { ...state, tab: 'inventory' };
    const I = bayLayout(innerWidth, innerHeight, inv);
    click(I.tabs.find(x => x.key === 'inventory').r);
    frame(t += 16); frames++;
    const seen = new Set();
    for (let at = 0; at <= (I.scroll?.max ?? 0); at++) {
      const S = bayLayout(innerWidth, innerHeight, { ...inv, scroll: at });
      for (const it of S.store) {
        if (seen.has(it.k)) continue;
        seen.add(it.k);
        hoverAt(it.r); frame(t += 16); frames++;
        click(it.r);
      }
      if (at < (I.scroll?.max ?? 0)) { evt('wheel', { deltaY: 120 }); frame(t += 16); frames++; }
    }
    if (!seen.size) errs.push('the inventory tab laid out nothing to sell for a pilot who owns gear');
    const sold = new Set(sent.filter(m => m.t === 'scrap' || m.t === 'scraphull').map(m => m.t));
    if (!sold.has('scrap')) errs.push('clicking spare equipment in the inventory never offered to sell it');
    console.log(`inventory: ${seen.size} owned things listed and clicked; sent ${[...sold].join(', ') || 'nothing'}`);
  }

  const kinds = new Set(sent.map(m => m.t));
  for (const want of ['install', 'buy', 'buydrone', 'dronestrip', 'buyformation', 'buyhull', 'hull', 'formation'])
    if (!kinds.has(want)) errs.push(`clicking every station row never produced a "${want}"`);
  if (kinds.size) console.log(`station: ${rows} hangar rows + ${storeRows} store rows across ` +
    `${STORE_PAGES.length} pages, all hovered and clicked; sent ${[...kinds].join(', ')}`);

  // The x1 x10 x100 buttons on an ammunition row.
  //
  // The server has taken a crate count on `buyammo` since ammunition was crated
  // and nothing ever sent anything but 1, so a pilot topping up before a long trip
  // clicked the same row twenty times. Three buttons where there was one is a
  // GEOMETRY change: this clicks the rectangles shared/ammo.js hands out, at every
  // window size, and reads back what actually went on the wire — a button drawn
  // somewhere the hit test does not look is the bug that directory exists for.
  {
    feed({ t: 's', docked: true, credits: 9_999_999,
           ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                              hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0,
                              rk: 0, vis: 2 })] });
    frame(t += 16); frames++;
    let answered = 0;
    for (const [w, h] of SIZES) {
      globalThis.innerWidth = w; globalThis.innerHeight = h;
      evt('resize'); SIZE = `${w}x${h}`;
      const S = bayLayout(w, h, { ...state, tab: 'store', page: 'ammo' });
      // Clicking a page resets the shelf's scroll to zero, so these rows are
      // where the client has them and not six pixels off.
      click(S.tabs.find(x => x.key === 'store').r);
      click(S.pages.find(x => x.key === 'ammo').r);
      frame(t += 16); frames++;
      // cell1 is the grade nobody is gated out of — NEEDS says tier 1 — so a
      // refusal here is the buttons and never the ladder.
      const row = S.store.find(it => it.k === 'cell1');
      // The strip is right-aligned, so the k-th button from the RIGHT sits in the
      // same place whether the row is showing three of them or one, and asking
      // with no labels reserved gives every one of them its true rectangle.
      for (const b of buyRow(row.r)) {
        sent.length = 0;
        hoverAt(b.r); frame(t += 16); frames++;        // the hover state is code too
        click(b.r); frame(t += 16); frames++;
        const msg = sent.find(m => m.t === 'buyammo');
        if (!msg) errs.push(`the x${b.n} button on the ammunition shelf sent nothing at ${w}x${h}`);
        else if (msg.n !== b.n) errs.push(`the x${b.n} button asked for ${msg.n} crates at ${w}x${h}`);
        else answered++;
      }
      // ...and the rest of the row still buys one crate, which is what it has
      // always done and what the footer along the bottom still promises.
      sent.length = 0;
      click({ x: row.r.x, y: row.r.y, w: 60, h: row.r.h });
      frame(t += 16); frames++;
      const one = sent.find(m => m.t === 'buyammo');
      if (one?.n !== 1)
        errs.push(`clicking the bare ammunition row at ${w}x${h} sent ${JSON.stringify(one)}`);
    }
    const want = SIZES.length * BUY_STEPS.length;
    if (answered !== want)
      errs.push(`only ${answered} of ${want} ammunition buy buttons answered a click`);
    else console.log(`ammo: ${BUY_STEPS.map(n => 'x' + n).join(' ')} each buy that many crates at ` +
      `${SIZES.length} window sizes, and the rest of the row still buys one`);
    globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
    evt('resize'); SIZE = '1600x900';
    frame(t += 16); frames++;
  }

  // Away from the ring, looking is free and spending is not. It used to refuse
  // every click, which also meant the panel stuck on whichever tab you were on
  // when you left — you could not even walk over to Ammunition to see the price.
  {
    feed({ t: 's', docked: false, ships: [packShip({ id: 1, x: 200, y: 200, heading: 0, charge: 0,
      co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });
    frame(t += 16); frames++;
    const S = bayLayout(innerWidth, innerHeight, { ...state, tab: 'store', page: 'ammo' });
    click(S.tabs.find(x => x.key === 'store').r);
    click(S.pages.find(x => x.key === 'ammo').r);
    frame(t += 16); frames++;
    sent.length = 0;
    for (const it of S.store) click(it.r);
    frame(t += 16); frames++;
    // Ammunition is the exception: running dry halfway across a sector is a walk
    // home, not an interesting problem.
    if (!sent.some(m => m.t === 'buyammo'))
      errs.push('a ship in open space could not resupply ammunition');

    // ...and nothing else sells out here.
    const G2 = bayLayout(innerWidth, innerHeight, { ...state, tab: 'store', page: 'weapon' });
    click(G2.pages.find(x => x.key === 'weapon').r);
    frame(t += 16); frames++;
    sent.length = 0;
    for (const it of G2.store) click(it.r);
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'buy')) errs.push('the store sold an emitter to a ship in open space');
    click(S.pages.find(x => x.key === 'ammo').r);
    frame(t += 16); frames++;

    // ...and having walked to Ammunition undocked, the tabs still move.
    sent.length = 0;
    click(S.tabs.find(x => x.key === 'hangar').r);
    frame(t += 16); frames++;
    const H = bayLayout(innerWidth, innerHeight, { ...state, tab: 'hangar' });
    click(H.hulls.find(h => h.k === 'hauler').r);
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'hull')) errs.push('a ship in open space swapped hulls');
    click(H.tabs.find(x => x.key === 'store').r);
    click(S.pages.find(x => x.key === 'weapon').r);
    frame(t += 16); frames++;
    // proof the navigation actually took: the page we just walked to now sells
    feed({ t: 's', docked: true, ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0,
      co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });
    frame(t += 16); frames++;
    sent.length = 0;
    const W = bayLayout(innerWidth, innerHeight, { ...state, tab: 'store', page: 'weapon' });
    click(W.store[0].r);
    frame(t += 16); frames++;
    if (!sent.some(m => m.t === 'buy'))
      errs.push('the panel was still stuck on the tab it had when it left the ring');
    else console.log('station: tabs move anywhere, ammunition sells anywhere, the rest needs the ring');
  }

  // The chooser. A locker holding MK-Is and MK-Vs must not decide for you — it
  // used to fit whichever sorted first, which was always the MK-I.
  {
    feed({ t: 'fit', hull: 'vanguard',
           fit: { weapon: [], generator: [], tech: [] },
           drones: [null, null], gear: { emitter1: 3, emitter3: 1, emitter5: 2, pod3: 1 },
           formation: 'line', formations: ['line'],
           hulls: ['hauler', 'vanguard'], credits: 90000 });
    const L = bayLayout(innerWidth, innerHeight, { hull: 'vanguard', drones: 2, tab: 'hangar',
                                                   hulls: ['hauler', 'vanguard'], formations: ['line'] });
    click(L.tabs.find(x => x.key === 'hangar').r);      // the store block left it on STORE
    frame(t += 16); frames++;
    const slot = L.racks.find(r => !r.header && r.slot === 'weapon' && r.index === 0);
    sent.length = 0;
    click(slot.r); frame(t += 16); frames++;
    if (sent.length) errs.push(`clicking an empty slot fitted ${JSON.stringify(sent[0])} instead of asking`);

    const order = fitsIn('weapon', { gear: { emitter1: 3, emitter3: 1, emitter5: 2, pod3: 1 },
                                     fit: { weapon: [], generator: [], tech: [] }, drones: [] });
    if (order[0] !== 'emitter5') errs.push(`the chooser offered ${order[0]} first, not the best thing owned`);
    const pick = pickerLayout(L, slot, order);
    const box = pick.box, P = L.panel;
    if (box.x < P.x || box.y < P.y || box.x + box.w > P.x + P.w || box.y + box.h > P.y + P.h)
      errs.push('the chooser opened outside the panel');

    // hover every row so each one draws its tooltip, then take the MK-V
    for (const r of pick.rows) { hoverAt(r.r); frame(t += 16); frames++; }
    click(pick.rows.find(r => r.k === 'emitter5').r);
    frame(t += 16); frames++;
    const put = sent.find(m => m.t === 'install');
    if (!put) errs.push('choosing from the chooser never asked the server to install anything');
    else if (put.item !== 'emitter5') errs.push(`chose MK-V, sent ${put.item}`);
    else console.log(`hangar: an empty slot offers all ${pick.rows.length} that fit, best first, and fits the one picked`);

    // Escape backs out of the chooser without closing the station under it. The
    // only way to ask from here is to click something that answers when it is open.
    click(slot.r); frame(t += 16); frames++;
    evt('keydown', { key: 'Escape' });
    frame(t += 16); frames++;
    sent.length = 0;
    click(L.hulls.find(h => h.k === 'hauler').r);
    frame(t += 16); frames++;
    if (!sent.some(m => m.t === 'hull')) errs.push('Escape closed the whole station instead of just the chooser');
  }

  // Standing on the workshop ring, the store has to actually sell. The client
  // used to decide for itself whether you were docked, using a rule that had no
  // idea the workshop existed, so every click bounced off "fly into your base
  // ring" while the server would happily have taken the money.
  {
    const at = (x, y) => feed({ t: 's', docked: true, ships: [packShip({
      id: 1, x, y, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
      hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });
    feed({ t: 'map', map: DEV_ID });
    at(DEV_BASE.x, DEV_BASE.y);
    feed({ t: 'fit', hull: 'vanguard', fit: { weapon: [], generator: [], tech: [] },
           drones: [], gear: {}, formation: 'line', formations: ['line'],
           hulls: ['vanguard'], credits: 900000 });
    frame(t += 16); frames++;
    const L = bayLayout(innerWidth, innerHeight, { hull: 'vanguard', drones: 0, tab: 'store',
                                                   page: 'weapon', hulls: ['vanguard'], formations: ['line'] });
    click(L.tabs.find(x => x.key === 'store').r); frame(t += 16); frames++;
    click(L.pages.find(x => x.key === 'weapon').r); frame(t += 16); frames++;
    sent.length = 0;
    for (const it of L.store) click(it.r);
    frame(t += 16); frames++;
    const bought = sent.filter(m => m.t === 'buy');
    if (!bought.length) errs.push('the workshop dock would not sell anything');
    else console.log(`workshop: the store sells on the dev ring — ${bought.length} buys sent`);

    // ...and standing outside the ring it still refuses, wherever you are
    at(DEV_BASE.x + DEV_BASE.r + 400, DEV_BASE.y);
    frame(t += 16); frames++;
    sent.length = 0;
    for (const it of L.store) click(it.r);
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'buy')) errs.push('the store sold to someone drifting outside the ring');
    feed({ t: 'map', map: 'm1' });
    at(6000, 4000); frame(t += 16); frames++;
  }

  // Settings. Two faders and three switches, because writing music for the game
  // means wanting the game running and the game silent at the same time.
  {
    const L = settingsLayout(innerWidth, innerHeight);
    evt('keydown', { key: 'o' });
    frame(t += 16); frames++;

    const mid = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    // Drag the music fader to the far left and the sound fader to the far right.
    const music = L.rows.find(r => r.key === 'music');
    evt('pointerdown', { clientX: music.track.x + 1, clientY: mid(music.track).y });
    evt('pointerup', {});
    frame(t += 16); frames++;
    if (musicVolume() > 0.05) errs.push(`dragging the music fader to zero left it at ${musicVolume()}`);

    const sfx = L.rows.find(r => r.key === 'sfx');
    evt('pointerdown', { clientX: sfx.track.x + sfx.track.w - 1, clientY: mid(sfx.track).y });
    evt('pointerup', {});
    frame(t += 16); frames++;
    if (sfxVolume() < 0.95) errs.push(`dragging the sound fader to full left it at ${sfxVolume()}`);

    // Each switch mutes its own bus and nothing else.
    const wasSfx = sfxOnly(), wasMusic = musicOnly();
    evt('pointerdown', { clientX: mid(sfx.toggle).x, clientY: mid(sfx.toggle).y });
    evt('pointerup', {});
    frame(t += 16); frames++;
    if (sfxOnly() === wasSfx) errs.push('the SOUND switch did nothing');
    if (musicOnly() !== wasMusic) errs.push('muting sound also muted the music');
    evt('pointerdown', { clientX: mid(sfx.toggle).x, clientY: mid(sfx.toggle).y });
    evt('pointerup', {}); frame(t += 16); frames++;

    // The master takes everything down without losing either level.
    const keepM = musicVolume(), keepS = sfxVolume();
    const master = L.rows.find(r => r.key === 'master');
    evt('pointerdown', { clientX: mid(master.toggle).x, clientY: mid(master.toggle).y });
    evt('pointerup', {}); frame(t += 16); frames++;
    if (audioOn()) errs.push('the MASTER switch did nothing');
    if (musicVolume() !== keepM || sfxVolume() !== keepS)
      errs.push('muting threw the levels away instead of remembering them');
    evt('pointerdown', { clientX: mid(master.toggle).x, clientY: mid(master.toggle).y });
    evt('pointerup', {}); frame(t += 16); frames++;
    if (!audioOn()) errs.push('the MASTER switch would not come back on');

    for (const r of L.rows) { hoverAt(r.toggle); frame(t += 16); frames++; }

    // The menu is where anything that is not flying the ship lives, so it has a
    // section for actions and at least one in it.
    if (!L.actions.length) errs.push('the menu has nowhere to put an action');
    for (const a of L.actions) { hoverAt(a.r); frame(t += 16); frames++; }

    evt('keydown', { key: 'Escape' });
    frame(t += 16); frames++;
    console.log(`settings: ${L.rows.length} buses + ${L.actions.length} action, ` +
                'faders drag, each switch mutes only its own');

    // Escape closes what is open, and opens the menu once nothing is.
    evt('keydown', { key: 'Escape' });
    frame(t += 16); frames++;
    sent.length = 0;
    click(L.rows.find(r => r.key === 'master').toggle);
    evt('pointerup', {}); frame(t += 16); frames++;
    if (sent.some(m => m.t === 'intent'))
      errs.push('Escape on an empty screen did not open the menu');
    if (audioOn()) errs.push('the menu opened by Escape does not take clicks');
    click(L.rows.find(r => r.key === 'master').toggle);
    evt('pointerup', {}); frame(t += 16); frames++;
    dismiss();

    // ...and closed again, a click goes back to flying the ship
    sent.length = 0;
    evt('pointerdown', { clientX: mid(master.toggle).x, clientY: mid(master.toggle).y });
    evt('pointerup', {}); frame(t += 16); frames++;
    if (!sent.some(m => m.t === 'intent')) errs.push('Escape left the settings panel swallowing clicks');
  }

  // TAB engages, TAB TAB breaks off — the same thought on the same key.
  {
    feed({ t: 's', ships: [
      packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
                 hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 }),
      packShip({ id: 1e6, x: 6200, y: 4100, heading: 0, charge: 0, co: 'x', hull: 'drifter',
                 hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 1 })] });
    frame(t += 16); frames++;
    // The harness runs start to finish inside a few milliseconds of real time, so
    // anything with a window in it needs the clock driven by hand — otherwise
    // every gesture in the file reads as a double.
    const perf = performance.now;
    let clock = 1e6;
    performance.now = () => clock;
    const tab = () => { evt('keydown', { key: 'Tab' }); frame(t += 16); frames++; };
    try {
      sent.length = 0;
      clock += 5000; tab();
      const first = sent.filter(m => m.t === 'target').at(-1);
      if (first?.id !== 1e6) errs.push(`TAB engaged ${JSON.stringify(first)} instead of the hostile`);
      clock += 120; tab();                                 // straight away: break off
      const second = sent.filter(m => m.t === 'target').at(-1);
      if (second?.id !== 0) errs.push(`TAB TAB sent ${JSON.stringify(second)} instead of breaking off`);

      sent.length = 0;
      clock += 5000; tab();
      clock += 5000; tab();                                // slowly: two engagements
      if (sent.filter(m => m.t === 'target').some(m => m.id === 0))
        errs.push('two slow TABs were read as a double tap');
      else console.log('target: TAB engages, TAB TAB breaks off, slow taps re-engage');
    } finally { performance.now = perf; }
  }

  // Signing out is a stand-down, not a switch: FOLD_SECS, cancelled by a fight
  // or by changing your mind. Putting your ship on the floor of a sector with a
  // drifter on it should take more than one misclick.
  {
    dismiss();
    const realNow3 = performance.now;
    let c3 = realNow3.call(performance);
    performance.now = () => c3;
    const tick = ms => { c3 += ms; frame(t += ms); frames++; };
    const alone = () => feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0,
      charge: 0, co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });
    const hunted = () => feed({ t: 's', ships: [
      packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
                 hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 }),
      packShip({ id: 1e6, x: 6200, y: 4100, heading: 0, charge: 0, co: 'x', hull: 'drifter',
                 hp: 100, sh: 100, flash: 0, tgt: 1, shot: 0, rk: 0, vis: 1 })] });
    const S = () => settingsLayout(innerWidth, innerHeight);
    const hitSignOut = () => {
      evt('keydown', { key: 'Escape' }); tick(20);           // nothing open: opens the menu
      const a = S().actions.find(x => x.key === 'signout');
      click(a.r); evt('pointerup', {}); tick(20);
    };
    try {
      // Under fire it refuses outright.
      hunted(); tick(20);
      hitSignOut();
      tick(11_000);
      if (socks[0].readyState !== 1) errs.push('signing out under fire put the ship down anyway');

      // Alone it counts down, and a click changes your mind.
      alone(); tick(20_000);                                  // let the mood hold lapse
      hitSignOut();
      tick(3000);
      dismiss();                                              // click: staying
      tick(12_000);
      if (socks[0].readyState !== 1) errs.push('a click during the countdown did not cancel it');

      // The countdown actually completing is signOut() itself, which the idle
      // block at the end of this file already covers — running it here would
      // put the client down and every test after it with it.
      console.log('signout: refused under fire, counts down otherwise, cancelled by a click');
    } finally {
      // A countdown left running swallows every click for the rest of the file.
      dismiss(); frame(t += 16); frames++;
      dismiss(); frame(t += 16); frames++;
      performance.now = realNow3;
    }
  }

  // A Bandit at every aspect. The veil multiplies alphas and skips draws, and
  // the guard rejects any NaN that falls out of the arithmetic — which is the
  // failure mode when a hull is not where you thought it was.
  {
    dismiss();
    let drew = 0;
    for (const deg of [0, 45, 90, 135, 180]) {
      const r = deg * Math.PI / 180;
      feed({ t: 's', ships: [
        packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
                   hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, fix: 0, vis: 2 }),
        // sitting 400px away, nose swung round so we see it from `deg` off
        packShip({ id: 1e6 + 5, x: 6400, y: 4000, heading: r, charge: 0, co: 'x', hull: 'bandit',
                   hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, fix: 0, vis: 1 })] });
      for (let i = 0; i < 8; i++) { frame(t += 16); frames++; drew++; }
    }
    console.log(`bandit: drawn across five aspects over ${drew} frames, veil and all`);
  }

  // A rig out fetching: it leaves formation, flies to the pod and comes back,
  // and the beam leaves the drone rather than the hull. The guard rejects any
  // NaN that falls out of the easing, which is the failure mode here.
  {
    dismiss();
    feed({ t: 'fit', hull: 'vanguard', fit: { weapon: ['emitter1'], generator: [], tech: [] },
           drones: ['emitter5', 'collect3', null], gear: {}, formation: 'wedge',
           formations: ['line', 'wedge'], hulls: ['vanguard'], credits: 9000,
           ammo: { cell1: 900 }, using: { laser: 'cell1', rocket: 'head1' },
           armed: { laser: true, rocket: true }, kits: {}, kit: 'kit1' });
    let drawn = 0;
    for (const p2 of [0, 0.3, 0.6, 0.85, 1]) {
      feed({ t: 's', docked: false, hold: { iron: 2 }, cap: 240,
             scoop: { id: 77, p: p2 },
             pods: [packPod({ id: 77, x: 6600, y: 4400, mat: 'iron', n: 3, t: 60, ttl: 120 })],
             ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0.4, charge: 0, co: 'm',
               hull: 'vanguard', hp: 90, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, fix: 0,
               drones: 3, form: 1, dmask: 0b001, vis: 2 })] });
      frame(t += 16); frames++; drawn++;
    }
    // ...and with the hold full it stops and says so, which is a different path
    feed({ t: 's', docked: false, hold: { iron: 999 }, cap: 10, pods: [],
           ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0.4, charge: 0, co: 'm',
             hull: 'vanguard', hp: 90, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, fix: 0,
             drones: 3, form: 1, dmask: 0b001, vis: 2 })] });
    frame(t += 16); frames++;
    console.log(`rig: drawn fetching across ${drawn} points of the pull, and again with the hold full`);
  }

  // A receipt for every purchase. A refused click and a successful one looked
  // identical from the outside, which is what made buying feel broken.
  {
    feed({ t: 'bought', what: 'MK-V Emitter', cost: 34000, note: 'in your inventory', credits: 66000 });
    // The two longest notes a crate purchase can produce, both drawn, because the
    // note shares its baseline with the balance printed on the right of the toast:
    // there are 31 characters between them at 10px on a 260px card, and a x100 buy
    // spends 28 of them.
    feed({ t: 'bought', what: 'Standard Cells', cost: 40000,
           note: '200000 rounds · 999999 held', credits: 65600 });
    feed({ t: 'bought', what: 'Standard Cells', cost: 20000,
           note: '50/100 crates · 100000 rounds', credits: 65600 });
    feed({ t: 'bought', what: 'Iridium', cost: -1800, note: '3 sold', credits: 67400 });
    for (let i = 0; i < 6; i++) { frame(t += 16); frames++; }
    // The guard rejects undefined/NaN in any draw call, so a malformed receipt
    // fails here rather than on someone's screen.
    console.log('receipts: spending and earning both draw, newest at the top');
  }

  // The whole music path, end to end: sorted onto decks, drawn from the bag,
  // switched by what the fight is doing, and levelled toward a target.
  {
    dismiss();
    setMusicVolume(0.6);                                     // the fader test left it at zero
    await new Promise(r => setTimeout(r, 30));               // startMusic awaits its fetch
    // The mood is held for seconds of real time and the harness runs in
    // milliseconds of it, so the clock is driven by hand here too.
    const realNow = performance.now;
    let clk = realNow.call(performance);          // anchored to the real clock: jumping the
    performance.now = () => clk;                  // idle limit signs the pilot out mid-test
    // Two clocks matter here: the mood hold is measured against the rAF timestamp
    // the frame is handed, the idle timeout against performance.now. Advance both.
    const beat = ms => { clk += ms; frame(t += ms); frames++; };
    beat(20_000);                                            // long past any earlier fight
    const list = musicList();
    if (list.length !== TRACKS.length - 1)
      errs.push(`sorted ${list.length} of ${TRACKS.length} tracks onto decks, boss/ aside`);
    if (musicParked().length !== 1) errs.push('boss/ did not stay parked');
    for (const m of ['calm', 'chase', 'combat'])
      if (!hasMood(m)) errs.push(`no ${m} deck was built`);

    // Nothing shooting: the score.
    const quiet = () => feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0,
      charge: 0, co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });
    quiet(); beat(20_000);
    if (musicMood() !== 'calm') errs.push(`an empty sector is playing ${musicMood()}`);

    // Something locks on and you do not fire back: a chase.
    feed({ t: 's', ships: [
      packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
                 hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 }),
      packShip({ id: 1e6, x: 6200, y: 4100, heading: 0, charge: 0, co: 'x', hull: 'drifter',
                 hp: 100, sh: 100, flash: 0, tgt: 1, shot: 0, rk: 0, vis: 1 })] });
    beat(100);
    if (musicMood() !== 'chase') errs.push(`being hunted is playing ${musicMood()}`);

    // You fire back: a fight.
    feed({ t: 's', ships: [
      packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
                 hp: 100, sh: 100, flash: 0, tgt: 1e6, shot: 90, rk: 0, vis: 2 }),
      packShip({ id: 1e6, x: 6200, y: 4100, heading: 0, charge: 0, co: 'x', hull: 'drifter',
                 hp: 100, sh: 100, flash: 0, tgt: 1, shot: 0, rk: 0, vis: 1 })] });
    beat(100);
    if (musicMood() !== 'combat') errs.push(`shooting back is playing ${musicMood()}`);

    // Each deck drew from its own folder, and never the same track twice running.
    const bad = played.filter((n, i) => i && n === played[i - 1]);
    if (bad.length) errs.push(`the bag handed out ${bad[0]} twice in a row`);
    if (played.some(n => n.startsWith('boss/'))) errs.push('a parked track was played');

    // Levelling itself is levelStep() in shared/music.js with its own tests — the
    // measuring rig around it needs a real AudioContext to say anything, and a
    // stub that always reads the same tone would only be testing the stub.
    console.log('music: 3 decks, bag draws, mood follows the fight');
    quiet(); beat(20_000);
    performance.now = realNow;
  }

  // The ammunition bar. Every box is clickable, the two loaded grades are the
  // ones the weapons draw from, and a rack with nothing behind it does not fire.
  {
    dismiss();                                                     // shut whatever is open
    feed({ t: 's', ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                                      hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0,
                                      rk: 0, vis: 2 })],
           ammo: { cell1: 4000, cell3: 250, head1: 400 }, using: { laser: 'cell1', rocket: 'head1' } });
    frame(t += 16); frames++;
    const B = barLayout(innerWidth, innerHeight);
    if (B.boxes.length !== BAR_SLOTS.length)
      errs.push(`the bar has ${B.boxes.length} boxes for ${BAR_SLOTS.join('/')}`);
    if (B.r.x < 0 || B.r.x + B.r.w > innerWidth || B.r.y + B.r.h > innerHeight)
      errs.push('the ammunition bar runs off the screen');

    // The chooser lists the SHELF, not the two grades this pilot happens to hold.
    // It listed stock until a designer with eleven MK-VI drones found the purple
    // row simply absent and read that as the game refusing them; the row is drawn
    // with a 0 now. This geometry has to be built from the same function the client
    // builds it from, or the harness clicks a rectangle that is not where the row
    // is — which is how it caught the change rather than the change catching it.
    const laserBox = B.boxes.find(b => b.feed === 'laser');
    sent.length = 0;
    click(laserBox.r);                                             // opens the menu, sends nothing yet
    frame(t += 16); frames++;
    if (sent.length) errs.push(`clicking the box loaded ${JSON.stringify(sent[0])} instead of offering a choice`);

    const M = feedMenu(laserBox, forWeapon('laser'));
    if (M.box.y < 0) errs.push('the ammunition menu opened off the top of the screen');
    for (const row of M.rows) { hoverAt(row.r); frame(t += 16); frames++; }

    // Fusion Cells need EVERY emitter at tier 5, and this ship flies one MK-I. The
    // row is still drawn — you own the rounds — and clicking it has to say why
    // rather than quietly doing nothing, which is what an unhandled click looks
    // like from the outside.
    sent.length = 0;
    click(M.rows.find(r => r.k === 'cell3').r);
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'ammo'))
      errs.push('loaded Fusion Cells into an MK-I emitter');

    // Refit the whole ship, escort included, and the same click loads them.
    feed({ t: 'fit', hull: 'vanguard',
           fit: { weapon: ['emitter5', 'emitter5'], generator: ['cellA'], tech: [] },
           drones: ['emitter5', 'emitter5'], formation: 'arrow', formations: ['arrow'],
           ammo: { cell1: 4000, cell3: 250, head1: 400 }, using: { laser: 'cell1', rocket: 'head1' },
           armed: { laser: true, rocket: true }, kits: {}, devices: {}, credits: 0 });
    frame(t += 16); frames++;
    // Via the rocket box, because two clicks on the SAME box inside 320ms is the
    // safe-this-weapon gesture and the suite runs inside a millisecond of it.
    sent.length = 0;
    click(B.boxes.find(b => b.feed === 'rocket').r); frame(t += 16); frames++;
    click(laserBox.r); frame(t += 16); frames++;                   // menu again
    click(M.rows.find(r => r.k === 'cell3').r);
    frame(t += 16); frames++;
    const pick = sent.find(m => m.t === 'ammo');
    if (pick?.key !== 'cell3') errs.push(`choosing from the menu sent ${JSON.stringify(pick)}`);

    // ...and the menu is gone, so the same click now falls through to the world
    sent.length = 0;
    click(M.rows[0].r); frame(t += 16); frames++;
    if (sent.some(m => m.t === 'ammo')) errs.push('the ammunition menu stayed open after a choice');

    // Only one grade of warheads held: no menu, it just loads.
    sent.length = 0;
    click(B.boxes.find(b => b.feed === 'rocket').r);
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'intent')) errs.push('a click on the bar flew the ship');

    // Twice on a box safes that weapon; the server is what actually holds fire,
    // so the click has to reach it.
    sent.length = 0;
    const realNow2 = performance.now;
    let c2 = realNow2.call(performance);
    performance.now = () => c2;
    try {
      const box = B.boxes.find(b => b.feed === 'rocket');
      c2 += 5000; click(box.r); evt('pointerup', {}); frame(t += 16); frames++;
      c2 += 100;  click(box.r); evt('pointerup', {}); frame(t += 16); frames++;
      const arm = sent.find(m => m.t === 'arm');
      if (arm?.feed !== 'rocket' || arm.on !== false)
        errs.push(`double-clicking the rocket box sent ${JSON.stringify(arm)}`);
      // and the client believes it once the server says so
      feed({ t: 'fit', hull: 'vanguard', fit: { weapon: [], generator: [], tech: [] },
             drones: [], gear: {}, formation: 'line', formations: ['line'], hulls: ['vanguard'],
             credits: 90000, ammo: { cell1: 4000, cell3: 250, head1: 400 },
             using: { laser: 'cell1', rocket: 'head1' }, armed: { laser: true, rocket: false } });
      frame(t += 16); frames++;
      sent.length = 0;
      c2 += 5000; click(box.r); evt('pointerup', {}); frame(t += 16); frames++;
      c2 += 100;  click(box.r); evt('pointerup', {}); frame(t += 16); frames++;
      const back = sent.find(m => m.t === 'arm');
      if (back?.on !== true) errs.push(`safed, a second double-click sent ${JSON.stringify(back)}`);
      else console.log('ammo: double-click safes a weapon and double-click brings it back');
    } finally { performance.now = realNow2; }

    // Q steps the laser feed — between the grades this ship can actually FIRE.
    //
    // The ship above was left with an empty rack to test the safe gesture, and a
    // ship with no emitter at all may now only load Standard Cells: whyNotLoad
    // stopped waving through a feed the ship has no weapon for, so there is nothing
    // to step to. That is the rule, not a broken key, so the key is tested on a ship
    // that has guns — and the rackless case is asserted underneath it.
    sent.length = 0;
    evt('keydown', { key: 'q' });
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'ammo'))
      errs.push('Q cycled the cells of a ship with no emitter to fire them out of');

    feed({ t: 'fit', hull: 'vanguard',
           fit: { weapon: ['emitter5', 'emitter5'], generator: ['cellA'], tech: [] },
           drones: ['emitter5', 'emitter5'], formation: 'arrow', formations: ['arrow'],
           ammo: { cell1: 4000, cell3: 250, head1: 400 }, using: { laser: 'cell1', rocket: 'head1' },
           armed: { laser: true, rocket: true }, kits: {}, devices: {}, credits: 0 });
    frame(t += 16); frames++;
    sent.length = 0;
    evt('keydown', { key: 'q' });                                  // cycle the laser feed
    frame(t += 16); frames++;
    if (!sent.some(m => m.t === 'ammo')) errs.push('Q did not step the laser feed');
    sent.length = 0;
    evt('keydown', { key: 'e' });                                  // only one warhead grade held
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'ammo')) errs.push('E switched warheads with nothing else to switch to');
    console.log('ammo: one box a weapon, a menu above it to choose, gone once you have');
  }

  // A rocket volley is heard once, on the frame the rails light, and never again
  // while the flash decays — the same rule the guns follow.
  {
    // No guns firing and no kills in this scene, so every oscillator raised here
    // is a rocket motor igniting — one per volley.
    const ship = rk => packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                                  hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0,
                                  rk, vis: 2 });
    feed({ t: 's', ships: [ship(0)] }); frame(t += 16); frames++;
    audio.osc = 0;
    for (const rk of [100, 80, 60, 20, 0, 100, 90]) { feed({ t: 's', ships: [ship(rk)] }); frame(t += 16); frames++; }
    if (audio.osc !== 2) errs.push(`a rack that emptied twice was heard ${audio.osc} times`);
    else console.log('rockets: a volley is heard once as it leaves, not once a frame while it fades');
  }

  // Docked with ore aboard, SPACE empties the ship — no panel, no I first. The
  // prompt above the bar is drawn from the same function the key runs, so it can
  // never offer something the key refuses.
  {
    dismiss();                                                   // shut whatever is open
    const at = (docked, hold) => feed({ t: 's', docked, hold, vault: {}, credits: 90000,
      ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                         hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });

    at(true, { iron: 12, iridium: 3, platinum: 1 });
    frame(t += 16); frames++;
    sent.length = 0;
    evt('keydown', { key: ' ' });
    frame(t += 16); frames++;
    const stashed = sent.filter(m => m.t === 'stash').map(m => m.mat).sort();
    if (stashed.join() !== 'iridium,iron,platinum')
      errs.push(`SPACE at the dock stowed [${stashed}], not every stack`);
    else console.log(`cargo: SPACE at the dock stowed all ${stashed.length} stacks without opening anything`);
    if (sent.some(m => m.t === 'scoop' || m.t === 'jump'))
      errs.push('SPACE at the dock also fired the haul/jump action');

    // an empty hold at the dock has nothing to offer, and must not send anything
    at(true, {});
    frame(t += 16); frames++;
    sent.length = 0;
    evt('keydown', { key: ' ' });
    frame(t += 16); frames++;
    if (sent.length) errs.push(`SPACE with an empty hold sent ${JSON.stringify(sent[0])}`);

    // ...and away from the dock a full hold is not stowable either
    at(false, { iron: 5 });
    frame(t += 16); frames++;
    sent.length = 0;
    evt('keydown', { key: ' ' });
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'stash')) errs.push('SPACE stowed cargo without being docked');

    // the inventory panel still works the same way
    at(true, { iron: 4 });
    evt('keydown', { key: 'i' }); frame(t += 16); frames++;
    sent.length = 0;
    evt('keydown', { key: ' ' }); frame(t += 16); frames++;
    if (!sent.some(m => m.t === 'stash')) errs.push('SPACE stopped working with the hold open');
    evt('keydown', { key: 'i' }); frame(t += 16); frames++;

    // A company-hangar row is two buttons: the left of it loads a stack back onto
    // the ship, the right of it sells the lot. That edge used to be the bare
    // number 0.62 written once in the hit test and again in the draw, with the
    // label's centre a third copy at 0.81 — and the row's own count was
    // right-aligned at the row's edge, on top of "SELL 720 cr". It is one
    // rectangle now, so this drives both halves through the real handler.
    feed({ t: 's', docked: true, hold: {}, vault: { iron: 240, nickel: 88 }, credits: 90000,
           ships: [packShip({ id: 1, x: 6000, y: 4000, heading: 0, charge: 0, co: 'm',
                              hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, vis: 2 })] });
    evt('keydown', { key: 'i' }); frame(t += 16); frames++;
    const bankRow = { x: (innerWidth - 820) / 2 + 40 + (820 - 60) / 2, y: (innerHeight - 440) / 2 + 92,
                      w: (820 - 60) / 2, h: 34 };
    const half = f => { sent.length = 0;
                        evt('pointerdown', { clientX: bankRow.x + bankRow.w * f, clientY: bankRow.y + 17 });
                        frame(t += 16); frames++;
                        return sent.find(m => m.t === 'sell' || m.t === 'load') ?? null; };
    const left = half(0.30), right = half(0.85);
    if (left?.t !== 'load' || left.mat !== 'iron')
      errs.push(`the left of a company-hangar row sent ${JSON.stringify(left)}, not a load`);
    else if (right?.t !== 'sell' || right.n !== 240)
      errs.push(`the right of a company-hangar row sent ${JSON.stringify(right)}, not a sell of all 240`);
    else console.log('cargo: a hangar row loads on the left and sells all 240 on the right');
    evt('keydown', { key: 'i' }); frame(t += 16); frames++;
    dismiss();
  }

  // power routing is a key, and must reach the server
  sent.length = 0;
  for (const k of ['1', '2', '3']) evt('keydown', { key: k });
  frame(t += 16); frames++;
  const routes = sent.filter(m => m.t === 'power').map(m => m.sys);
  if (routes.join() !== 'thrusters,weapons,shields') errs.push(`1/2/3 routed ${routes.join()}`);
  else console.log('power: 1/2/3 route to thrusters, weapons, shields');
  evt('keydown', { key: 'h' });
}

// --- audio: does a gun going off actually make one sound, and only one? ---
{
  const ship = (shot, x = 6000) => packShip({ id: 1, x, y: 4000, heading: 0, charge: 0, co: 'm',
    hull: 'vanguard', hp: 100, sh: 100, flash: 0, tgt: 0, shot, vis: 2 });
  evt('keydown', { key: 'q' });                       // any key opens the audio context
  const tick = shot => { feed({ t: 's', ships: [ship(shot)] }); frame(t += 33); frames++; };
  tick(0);
  const base = audio.osc;
  tick(100);                                          // muzzle flash rises: one shot
  tick(70);                                           // still lit: must not retrigger
  tick(30);
  tick(0);
  const once = audio.osc - base;
  tick(100);                                          // fires again
  const twice = audio.osc - base;
  // a shot is a detuned pair, so count relatively rather than assuming one node
  if (once < 2) errs.push(`a single shot made ${once} oscillators — it should be a detuned pair`);
  else if (twice !== once * 2) errs.push(`the second shot produced ${twice - once}, not ${once}`);
  else console.log(`audio: one shot = ${once} detuned voices; the decaying flash does not retrigger`);

  audio.thrust.length = 0;                            // now the thruster
  for (let i = 0; i < 14; i++) { feed({ t: 's', ships: [ship(0, 6000 + i * 260)] }); frame(t += 33); frames++; }
  const moving = Math.max(...audio.thrust);
  audio.thrust.length = 0;
  for (let i = 0; i < 20; i++) { feed({ t: 's', ships: [ship(0, 9000)] }); frame(t += 33); frames++; }
  const stopped = Math.min(...audio.thrust);
  if (!(moving > 0.05)) errs.push(`thruster stayed silent while moving (peak ${moving})`);
  else if (!(stopped < moving / 4)) errs.push(`thruster did not fall off when stopped (${stopped} vs ${moving})`);
  else console.log(`audio: thrust ${moving.toFixed(2)} under way, ${stopped.toFixed(2)} at rest`);

  evt('keydown', { key: 'v' });                       // mute
  audio.thrust.length = 0; audio.osc = 0;
  for (let i = 0; i < 8; i++) { feed({ t: 's', ships: [ship(0, 9000 + i * 300)] }); frame(t += 33); frames++; }
  feed({ t: 's', ships: [ship(100, 9000)] });
  if (audio.thrust.some(v => v > 0) || audio.osc > 0) errs.push('muting did not silence everything');
  else console.log('audio: V mutes both the thruster and the guns');
  evt('keydown', { key: 'v' });

  // a kill should be heard once, and only when it is new.
  // Bring the ship back alongside first — the previous block left it 3km away,
  // where the distance falloff correctly silences everything.
  feed({ t: 's', ships: [ship(0, 6000)] }); frame(t += 33); frames++;
  audio.osc = 0;
  const boom = p => { feed({ t: 's', ships: [ship(0)],
    blasts: [packBlast({ x: 6100, y: 4100, r: 15, t: 0.8 * (1 - p), ttl: 0.8, foe: true })] });
    frame(t += 33); frames++; };
  boom(0.05); const first = audio.osc;              // sub oscillator = one explosion
  const farKey = audio.osc;
  boom(0.25); boom(0.55); boom(0.9);
  if (first !== 1) errs.push(`a kill made ${first} explosions`);
  else if (audio.osc !== 1) errs.push(`the same kill was heard ${audio.osc} times as it faded`);
  else console.log('audio: a kill explodes once, not on every frame of its flash');

  audio.osc = 0;                                    // and a kill across the map is not heard at all
  feed({ t: 's', ships: [ship(0, 200)] }); frame(t += 33); frames++;
  feed({ t: 's', ships: [ship(0, 200)],
         blasts: [packBlast({ x: 11000, y: 7000, r: 15, t: 0.78, ttl: 0.8, foe: true })] });
  frame(t += 33); frames++;
  if (audio.osc) errs.push('a kill 12km away was still audible');
  else console.log('audio: a kill across the sector is silent');

  // the wreck overlay and its one control
  feed({ t: 'dead', lost: { iron: 4, iridium: 1 }, where: 'm1' });
  frame(t += 33); frames++;
  sent.length = 0;
  evt('pointerdown', { clientX: 200, clientY: 200 });          // anything else must be inert
  if (sent.length) errs.push(`a wreck accepted ${sent.map(m => m.t)} instead of only respawn`);
  evt('pointerdown', { clientX: innerWidth / 2, clientY: innerHeight * 0.6 + 26 });
  if (!sent.some(m => m.t === 'respawn')) errs.push('the RESPAWN button sent nothing');
  else console.log('wreck: only control is RESPAWN, and it fires');
  feed({ t: 'map', map: 'm1', respawned: true });
  frame(t += 33); frames++;
}

// Signing out is terminal until the page reloads, so this runs last — anything
// after it would find every click swallowed by the reconnect prompt.
  // Chat owns the keyboard while it is open, or typing would fire game hotkeys.
  {
    feed({ t: 'welcome', id: 1, token: 't', name: 'Vex-1', map: 'm1', co: 'm', hull: 'vanguard',
           fit: { weapon: ['emitter1'], generator: [], tech: [] }, gear: {}, hulls: ['hauler', 'vanguard'],
           credits: 0, drones: [], xp: 0, admin: true });
    sent.length = 0;
    evt('keydown', { key: 'Enter' });
    for (const ch of '/money 100') evt('keydown', { key: ch });
    frame(t += 16); frames++;
    if (sent.length) errs.push(`typing sent ${sent.map(m => m.t)} instead of staying in the line`);
    evt('keydown', { key: 'Enter' });
    const said = sent.find(m => m.t === 'chat');
    if (said?.text !== '/money 100') errs.push(`chat sent ${JSON.stringify(said?.text)}`);
    else console.log('chat: ENTER opens it, typing stays in the line, ENTER sends');

    // 'h' and 'i' must not have opened panels while typing
    sent.length = 0;
    evt('keydown', { key: 'Enter' });
    for (const ch of 'hiqe123x') evt('keydown', { key: ch });
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'power' || m.t === 'target' || m.t === 'ammo'))
      errs.push('game hotkeys fired while the chat line had focus');
    else console.log('chat: h i q e 1 2 3 x are letters while typing, not hotkeys');
    evt('keydown', { key: 'Escape' });
    feed({ t: 'chat', from: 'Harrow-2', co: 'h', text: 'hello' });
    feed({ t: 'chat', from: '', text: 'credits: 100' });
    frame(t += 16); frames++;                      // lingering, closed
    const perf = performance.now;
    performance.now = () => perf.call(performance) + 6000;
    frame(t += 16); frames++;                      // long gone
    evt('keydown', { key: 'Enter' });
    frame(t += 16); frames++;                      // reopened: history is back
    evt('keydown', { key: 'Escape' });
    performance.now = perf;
    console.log('chat: lingers briefly when closed, full history when reopened');
  }

  // --- the wire, driven end to end ------------------------------------------
  // The client is no longer handed a whole snapshot every tick. It is handed one
  // keyframe and then deltas, and rebuilds the snapshot itself. So the claim
  // worth making here is not that the frames render — it is that a sector
  // rebuilt from deltas draws EXACTLY what the same sector sent whole would have
  // drawn, call for call. A mask bit off by one would still render perfectly; it
  // would just render the wrong ship.
  {
    const perf = performance.now;
    // Anchored to the real clock and advanced by hand. The suite runs inside a
    // few milliseconds of wall clock, and both passes have to be handed the same
    // clock AND the same frame timestamps or every time-driven pixel — the
    // rotating plot ring, the notice fade — disagrees for reasons that have
    // nothing to do with the wire.
    const base = perf.call(performance);
    let fakeNow = base;
    performance.now = () => fakeNow;
    const T = t + 5000;

    const bag = { hold: { iron: 2 }, cap: 240, credits: 5000, docked: false, vault: {}, gear: {},
                  ammo: { cell1: 900, head1: 40 }, using: { laser: 'cell1', rocket: 'head1' },
                  armed: { laser: 1, rocket: 1 }, kits: { kit1: 1 }, kit: 'kit1',
                  xp: 4200, rank: { level: 14, into: 0.4, need: 300 },
                  drones: [], played: 600, online: 3,
                  power: { to: 'weapons', cap: 70, lv: { thrusters: 33, weapons: 70, shields: 33 } },
                  shieldNow: 240, shieldMax: 240 };
    const row = o => packShip({ id: 0, x: 0, y: 0, heading: 0, charge: 0, co: 'm', hull: 'vanguard',
                               hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0, fix: 0, guns: 3,
                               psys: 2, plvl: 70, lvl: 14, drones: 0, form: 0, dmask: 0, vis: 2,
                               rig: 0, rgx: 0, rgy: 0, rgp: -1, rgf: -1, wrp: 0, ...o });
    // Seven ticks of a sector, and every case the codec has to express: the pilot
    // flies (update), an ally holds station (no change at all, so nothing on the
    // wire), a hostile closes and then breaks contact (add, update, remove), and
    // a pod drifts.
    const at = n => ({
      ships: new Map([
        [1, row({ id: 1, x: 6000 + n * 40, y: 4000 + n * 12, heading: 0.3 })],
        [2, row({ id: 2, x: 5200, y: 3400, hull: 'bulwark', guns: 4 })],
        ...(n >= 2 && n <= 5
            ? [[1e6, row({ id: 1e6, x: 6600 - n * 55, y: 4400, co: 'x', hull: 'drifter', hp: 70, sh: 30, vis: 1 })]]
            : []),
      ]),
      pods: new Map([[9001, packPod({ id: 9001, x: 6100 + n * 3, y: 4100, mat: 'iron', n: 3, own: 0 })]]),
    });
    const play = deltas => {
      fakeNow = base;                              // both passes see the same clock
      feed({ t: 'map', map: 'm1' });
      const b = newBase();
      for (let n = 0; n <= 6; n++) {
        feed(deltas && n > 0 ? encodeDelta(b, at(n), bag, {}) : encodeFull(b, 'm1', at(n), bag, {}));
        fakeNow += 33; frame(T + n * 33); frames++;
      }
      trace = [];                                  // one settled frame, recorded
      fakeNow += 33; frame(T + 7 * 33); frames++;
      const out = trace; trace = null;
      return out;
    };
    const whole = play(false), rebuilt = play(true);
    const differs = whole.length !== rebuilt.length
      ? `${whole.length} calls whole vs ${rebuilt.length} from deltas`
      : (() => { const i = whole.findIndex((c, k) => c !== rebuilt[k]);
                 return i < 0 ? null : `call ${i}: "${whole[i]}" vs "${rebuilt[i]}"`; })();
    if (!whole.length) errs.push('the wire comparison recorded no draw calls at all');
    else if (differs) errs.push(`a sector rebuilt from deltas drew differently — ${differs}`);
    else console.log(`wire: a keyframe and 6 deltas draw the same ${whole.length} calls as 7 whole snapshots`);

    // Add and remove, read back through the client's own targeting rather than
    // anything internal: TAB engages the nearest thing on the plot, so what it
    // sends is exactly what the client believes is out there.
    {
      const tab = () => { sent.length = 0; fakeNow += 500;   // clear of the double-tap window
                          evt('keydown', { key: 'Tab' });
                          return sent.find(m => m.t === 'target') ?? null; };
      const b = newBase();
      fakeNow = base;
      feed({ t: 'map', map: 'm1' });
      feed(encodeFull(b, 'm1', at(0), bag, {}));
      fakeNow += 33; frame(t += 33); frames++;
      // One throwaway press first. An earlier block in this file drives TAB on a
      // fake clock a quarter of an hour ahead of this one, so the very next press
      // reads as the second half of a double tap however long you wait. After one
      // press lastTab is either zeroed or set to this clock, and either way the
      // press after it is an honest single.
      tab();
      const before = tab();
      for (let k = 0; k <= 3; k++) { feed(encodeDelta(b, at(Math.min(3, k + 1)), bag, {}));
                                     fakeNow += 33; frame(t += 33); frames++; }
      const during = tab();
      for (let k = 0; k < 4; k++) { feed(encodeDelta(b, at(6), bag, {}));
                                    fakeNow += 33; frame(t += 33); frames++; }
      const after = tab();
      if (before) errs.push(`a hostile that had not arrived yet was already targetable (${JSON.stringify(before)})`);
      else if (during?.id !== 1e6) errs.push(`a hostile added by a delta could not be targeted (got ${JSON.stringify(during)})`);
      else if (after) errs.push(`a hostile removed by a delta was still targetable (got ${JSON.stringify(after)})`);
      else console.log('wire: a delta adds a hostile you can engage and removes one you cannot');
    }

    // A delta with nothing to apply it to must ask for a keyframe rather than
    // draw against nothing. Over TCP this is a reconnect landing mid-tick.
    {
      feed({ t: 'map', map: 'm1' });               // the client drops its baseline
      sent.length = 0;
      const b = newBase();
      encodeFull(b, 'm1', at(0), bag, {});         // the server's copy moves on without it
      feed(encodeDelta(b, at(1), bag, {}));
      fakeNow += 33; frame(t += 33); frames++;
      if (!sent.some(m => m.t === 'need'))
        errs.push('a delta with no keyframe behind it was applied instead of refused');
      else console.log('wire: a delta with no keyframe behind it asks for one instead of guessing');
      feed(encodeFull(newBase(), 'm1', at(0), bag, {}));
      fakeNow += 33; frame(t += 33); frames++;
    }
    performance.now = perf;
  }

  // Every panel, in every state it can be in, at every window size. This
  // re-enters the client's own resize handler rather than re-running the file,
  // and it must stay AHEAD of the idle sign-out below, because that block signs
  // the client out and every frame after it is a blank screen with nothing on it
  // to collide.
  //
  // SIZES was the whole sweep for a while and it was half the job. A panel is
  // laid out from the viewport AND from what is in it, and the pilot this drove
  // had a thin fit and small numbers, so the station's stat strip was three
  // characters wide on every frame the harness ever rendered. The literal it
  // overflowed — a 44px column against a six-digit value — had been wrong the
  // whole time and nothing here could see it.
  {
    dismiss(); frame(t += 16); frames++;

    // The widest a number on this ship can be is not a guess and not a fixture:
    // it is the best thing in every slot the hull has, every drone bay filled,
    // and every rung of the ladder bought. Derived, so a new hull, a new tier or
    // a new rung widens the test along with the game — which is the whole reason
    // the old fixture went stale without anybody noticing.
    const tiered = slot => Object.keys(EQUIPMENT)
      .filter(k => EQUIPMENT[k].slot === slot)
      .sort((a, b) => (EQUIPMENT[b].tier ?? 0) - (EQUIPMENT[a].tier ?? 0)
                   || EQUIPMENT[b].price - EQUIPMENT[a].price);
    const fitFor = h => { const n = slotsOf(h);
      return { weapon: Array(n.weapon).fill(tiered('weapon')[0]),
               generator: Array(n.generator).fill(tiered('generator')[0]),
               tech: tiered('tech').slice(0, n.tech) }; };
    const ALL_MODS = (1 << Object.keys(MODULES).length) - 1;
    const ESCORT = Array(MAX_DRONES).fill(tiered('weapon')[0]);
    const digits = h => Math.max(...STAT_KEYS.map(k => String(Math.round(
      applyResearch(resolve(h, fitFor(h), ESCORT, 'wedge'), ALL_MODS)[k])).length));
    // Whichever hull prints the longest number is the one worth sweeping in.
    const RICH = Object.keys(HULLS).sort((a, b) => digits(b) - digits(a))[0];
    const LONG_NAME = 'W'.repeat(NAME_MAX);        // the longest handle the form allows
    const ALL_GEAR = Object.fromEntries(Object.keys(EQUIPMENT).map(k => [k, 99]));

    const ship = (hull, name, extra = {}) => packShip({ id: 1, x: MAPS.m1.base.x, y: MAPS.m1.base.y,
      heading: 0, charge: 0, co: 'm', hull, hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, rk: 0,
      fix: 0, guns: 3, psys: 2, plvl: 70, lvl: 14, drones: 0, form: 0, dmask: 0, vis: 2,
      rig: 0, rgx: 0, rgy: 0, rgp: -1, rgf: -1, wrp: 0, name, ...extra });

    // Two ends of the game and nothing in between, because the middle cannot
    // overflow anything the ends do not. Thin proves an empty panel still draws;
    // rich proves a full one still fits.
    const STATES = [
      { name: 'thin', open: () => {
        feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'hauler',
               fit: { weapon: [], generator: [], tech: [] }, gear: {}, hulls: ['hauler'],
               drones: [], formation: 'line', formations: ['line'], credits: 0,
               ammo: {}, using: {}, armed: {} });
        feed({ t: 'map', map: 'm1' });
        feed({ t: 's', ships: [ship('hauler', 'Ay')], hold: {}, cap: 10, credits: 0,
               docked: true, vault: {}, xp: 0, rank: { level: 1, into: 0, need: 100 },
               kills: {}, gear: {}, played: 0, online: 1, labs: [], claims: [],
               power: { to: null, cap: 0, lv: {} }, shieldNow: 0, shieldMax: 1 });
      } },
      { name: 'rich', open: () => {
        feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: RICH, fit: fitFor(RICH),
               gear: ALL_GEAR, hulls: Object.keys(HULLS), drones: ESCORT,
               formation: 'wedge', formations: FORMATION_KEYS, credits: 9_999_999,
               ammo: Object.fromEntries(AMMO_KEYS.map(k => [k, 999_999])),
               kits: Object.fromEntries(KIT_KEYS.map(k => [k, 99])),
               devices: Object.fromEntries(DEVICE_KEYS.map(k => [k, 99])),
               using: { laser: AMMO_KEYS[0], rocket: AMMO_KEYS.at(-1) },
               armed: { laser: true, rocket: true } });
        feed({ t: 'map', map: 'm1' });
        feed({ t: 's', ships: [ship(RICH, LONG_NAME)],
               hold: Object.fromEntries(Object.keys(MATERIALS).map(k => [k, 9999])),
               cap: 99_999, credits: 9_999_999, docked: true,
               vault: Object.fromEntries(Object.keys(MATERIALS).map(k => [k, 999_999])),
               xp: 9_999_999, rank: { level: 99, into: 9999, need: 10_000 },
               kills: Object.fromEntries(WILD.map(k => [k, 999_999])),
               // A pilot with every kill in the game has every quest reward that
               // comes with them, and the sweep should draw the ship they actually
               // fly — two more berths in the escort column and a fifth layer on the
               // stats page. Without this the finished pilot was the only one in the
               // suite whose file said EARNED nowhere.
               unlocked: QUEST_KEYS,
               gear: ALL_GEAR, kits: Object.fromEntries(KIT_KEYS.map(k => [k, 99])),
               devices: Object.fromEntries(DEVICE_KEYS.map(k => [k, 99])),
               played: 999_999, online: 99,
               labs: [packLab({ id: 2_000_001, x: MAPS.m1.base.x + 400, y: MAPS.m1.base.y,
                                mods: ALL_MODS, name: LONG_NAME }, true)],
               lab: { mods: ALL_MODS, income: 999_999 }, claims: ARENA_MODULES,
               power: { to: 'shields', cap: 100, lv: { thrusters: 100, weapons: 100, shields: 100 } },
               shieldNow: 999_999, shieldMax: 999_999 });
      } },
    ];

    // Which panel was actually on screen, read off what it printed rather than
    // off what was asked for. A sweep that silently stopped opening the research
    // station would still have passed every rule in this file.
    const PANELS = [
      { keys: [],    saw: 'TAB engage' },
      { keys: ['h'], saw: 'HANGAR' },
      { keys: ['i'], saw: 'COMPANY HANGAR' },
      { keys: ['m'], saw: 'KNOWN SPACE · STAR SYSTEM' },
      { keys: ['l'], saw: 'THREAT FILE' },
      { keys: ['o'], saw: 'MENU' },
      { keys: ['r'], saw: 'RESEARCH STATION' },
    ];
    const SEEN_PANEL = new Set();
    const shots = n => { for (let i = 0; i < n; i++) { frame(t += 16); frames++; } };

    for (const st of STATES) {
      st.open();
      for (const [w, h] of SIZES) {
        globalThis.innerWidth = w; globalThis.innerHeight = h;
        evt('resize');
        SIZE = `${w}x${h}`;
        for (const P of PANELS) {
          for (const k of P.keys) evt('keydown', { key: k });
          WATCH = { want: P.saw, hit: () => SEEN_PANEL.add(`${st.name}/${P.saw}`) };
          shots(3);
          // The station is four tabs, not one, and only the first was ever drawn
          // in this sweep — the stat strip that overflowed is on all four.
          if (P.keys[0] === 'h') {
            for (const tab of bayLayout(w, h, {}).tabs) { click(tab.r); shots(2); }
            // ...and then the ammunition shelf, which is the one store page
            // carrying controls of its own. Three buy buttons on a row that
            // already holds a name, a price, a blurb and a rounds-held count is
            // exactly the arrangement that fits at 1600x900 and does not at
            // 820x560, and the shop walk above runs at one size. The rich pilot
            // is the one that matters here: 999,999 rounds held is the longest
            // that line ever gets.
            const A = bayLayout(w, h, { tab: 'store', page: 'ammo' });
            click(A.tabs.find(x => x.key === 'store').r);
            click(A.pages.find(x => x.key === 'ammo').r);
            for (const it of A.store) { hoverAt(it.r); shots(1); }
            shots(2);
          }
          WATCH = null;
          for (const k of P.keys) evt('keydown', { key: k });   // the same key closes it
          frame(t += 16); frames++;
          dismiss();
        }
      }
    }
    const missing = [];
    for (const st of STATES) for (const P of PANELS)
      if (!SEEN_PANEL.has(`${st.name}/${P.saw}`)) missing.push(`${st.name}: ${P.saw}`);
    if (missing.length) errs.push(`the sweep never drew ${missing.length} panel(s): ${missing.join(', ')}`);
    else console.log(`  ok   every panel is swept in every state  — ${PANELS.length} panels x ` +
                     `${STATES.length} states x ${SIZES.length} window sizes, each one seen drawing itself`);

    globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
    evt('resize'); SIZE = '1600x900';
    frame(t += 16); frames++;
  }

  // idle sign-out: the clock only advances with no input, and a click brings you back
  {
    const perf = performance.now;
    let reloaded = false;
    globalThis.location.reload = () => { reloaded = true; };
    sent.length = 0;
    performance.now = () => perf.call(performance) + 31 * 60 * 1000;   // half an hour later
    frame(t += 16); frames++;
    evt('pointerdown', { clientX: 400, clientY: 400 });
    performance.now = perf;
    if (!reloaded) errs.push('a click after signing out did not bring the player back');
    else if (sent.length) errs.push(`a signed-out client still sent ${sent.map(m => m.t)}`);
    else console.log('idle: signs itself out after 30 minutes, and a click reconnects');
    evt('keydown', { key: 'q' });                 // any input resets the clock
    frame(t += 16); frames++;
  }

// Nothing is printed through anything else.
//
// The guard says a frame drew nothing malformed. This says a player could read
// all of it: no two pieces of text share pixels that are both still on screen
// when the frame ends. Every overlap fixed before this existed — the SPACE
// prompt under the weapon tooltips, the SPACE prompt under the ammunition menu,
// the safe-zone badge on the changelog icon — was found by somebody tripping
// over it and fixed with a bespoke rectangle comparison. This is the same claim
// made once, for every panel, from the draw calls themselves.
//
// It is text against text and nothing else on purpose. A label on its button, a
// value in its row, a tooltip over the world and a modal over everything are all
// rects under text, and reporting those is thousands of findings and no signal.
// Two labels crossing is nobody's design. What decides the rest is the painter's
// algorithm: if anything opaque was drawn over the lower one before the frame
// ended, it is not on screen there and there is nothing to report — which
// dismisses every panel, tooltip and modal without one hand-written exception.
//
// LAYOUT=1 prints every finding rather than the first eight; SRC=1 puts an
// index.html line number on each of them, which costs about eight seconds and is
// why it is off here.
{
  const report = (m, tell, claim, detail) => {
    const R = [...m.values()].sort((a, b) => b.n - a.n);
    if (process.env.LAYOUT)
      for (const f of R) console.log(`  [${String(f.n).padStart(4)} frames] {${[...f.sizes].join(' | ')}}\n      ${tell(f.v)}`);
    if (R.length) errs.push(`${R.length} ${claim}:\n    ` + R.slice(0, 8).map(f => tell(f.v)).join('\n    '));
    else console.log(`  ok   ${detail}`);
  };
  const where = `${SEEN.toLocaleString('en-US')} frames, ${SIZES.length} window sizes`;
  report(FOUND, say, 'places print two labels through each other',
    `nothing is printed through anything else  — ${where}, no two labels share a pixel`);
  report(CROSS, sayCross, 'labels are written across something that is not their own frame',
    `nothing is written across a control it has nothing to do with  — ${where}, the minimap, ` +
    'the STAR SYSTEM button and the now-playing tag included');
  report(TIGHT, sayTight, 'pairs of labels are crammed together',
    `every two labels have room to be read apart  — ${where}, a character between them side by side ` +
    'and a descender stacked');
}
console.log(`rendered ${frames} frames across ${Object.keys(MAPS).length} maps`);
if (errs.length) console.log('caught by render guard:\n  ' + errs.join('\n  '));
if (bad.length)  console.log('bad draw args:\n  ' + [...new Set(bad)].slice(0, 12).join('\n  '));
const green = errs.length === 0 && bad.length === 0;
console.log(green ? 'PASS' : 'FAIL');
// And EXIT on it. This printed FAIL and returned 0 for its whole life, and it is
// the last link in the `&&` chain npm test is built out of — so every render
// failure there has ever been reported a green suite. Found while renaming the
// Vanguard's ability: the STATS tab was looking for a row called 'Lock bite' that
// no longer exists, said so, and `npm test` exited 0 anyway.
process.exit(green ? 0 : 1);
