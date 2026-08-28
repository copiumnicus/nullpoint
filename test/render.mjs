// Runs the real client render path against a stub 2D context, over every map,
// with the chart open and closed. Any undefined field or bad colour throws.
import { readFileSync, writeFileSync } from 'node:fs';
import { MAPS } from '../shared/maps.js';
import { EQUIPMENT, SLOTS } from '../shared/gear.js';
import { bayLayout } from '../shared/hangar.js';
import { packShip, packBolt, packBlast, packPod, packHit } from '../shared/net.js';
import { MATERIALS } from '../shared/cargo.js';
import { ALIENS } from '../shared/aliens.js';

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

const CTX = {
  _fill: '#000', _stroke: '#000', _font: '', _alpha: 1, _dash: [], _align: 'left', _lw: 1, _join: 'miter',
  set fillStyle(v)   { guard('fillStyle', v); this._fill = v; },   get fillStyle()   { return this._fill; },
  set strokeStyle(v) { guard('strokeStyle', v); this._stroke = v; }, get strokeStyle() { return this._stroke; },
  set font(v)        { guard('font', v); this._font = v; },        get font()        { return this._font; },
  set globalAlpha(v) { num('globalAlpha', v); this._alpha = v; },  get globalAlpha() { return this._alpha; },
  set lineWidth(v)   { num('lineWidth', v); this._lw = v; },       get lineWidth()   { return this._lw; },
  set lineJoin(v)    { this._join = v; },                          get lineJoin()    { return this._join; },
  set textAlign(v)   { this._align = v; },                         get textAlign()   { return this._align; },
  fillRect(...a)   { num('fillRect', ...a); },
  strokeRect(...a) { num('strokeRect', ...a); },
  fillText(t, x, y){ guard('fillText', t); num('fillText', x, y); },
  strokeText(t, x, y){ guard('strokeText', t); num('strokeText', x, y); },
  measureText(t)   { guard('measureText', t); return { width: String(t).length * 6 }; },
  arc(...a)        { num('arc', ...a); if (a[2] < 0) bad.push('arc negative radius'); },
  rect(...a) { num('rect', ...a); }  , roundRect(...a) { num('roundRect', ...a); },
  moveTo(...a) { num('moveTo', ...a); }, lineTo(...a) { num('lineTo', ...a); },
  translate(...a) { num('translate', ...a); }, rotate(a) { num('rotate', a); },
  scale(...a) { num('scale', ...a); if (a.some(v => v === 0)) bad.push('scale by zero'); },
  setTransform(...a) { num('setTransform', ...a); },
  beginPath() {}, closePath() {}, stroke() {}, fill() {}, save() {}, restore() {}, clip() {},
  setLineDash(d) { this._dash = d; },
  createLinearGradient(...a) {
    num('createLinearGradient', ...a);
    return { addColorStop(o, c) { if (!COLOUR.test(String(c))) bad.push(`addColorStop bad colour ${c}`); } };
  },
  createRadialGradient(...a) {
    num('createRadialGradient', ...a);
    if (a[2] < 0 || a[5] < 0) bad.push('gradient negative radius');
    return { addColorStop(o, c) { if (!COLOUR.test(String(c))) bad.push(`addColorStop bad colour ${c}`); } };
  },
};

const listeners = {};
const on = (k, fn) => (listeners[k] ??= []).push(fn);
const canvas = {
  width: 0, height: 0, getContext: () => CTX, addEventListener: on,
  setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: innerWidth, height: innerHeight }),
};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 2;
globalThis.location = { host: 'localhost:3000', protocol: 'http:' };
// seeded under the OLD key, to prove the rename migration runs
const store = new Map([['aphelion.token', 'legacy-token']]);
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.document = { getElementById: () => canvas, title: '' };
globalThis.addEventListener = on;
globalThis.setInterval = () => 0;
let raf = null;
globalThis.requestAnimationFrame = cb => { raf = cb; };
const socks = [];
const sent = [];
globalThis.WebSocket = class { constructor() { this.readyState = 1; socks.push(this); } send(d) { sent.push(JSON.parse(d)); } close() {} };

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
  createDelay() { return { delayTime: param('delay'), connect() {} }; }
  createWaveShaper() { return { curve: null, connect() {} }; }
};

const errs = [];
console.error = (...a) => errs.push(a.join(' '));

await import('./.client.mjs');

const ws = socks[0];
const feed = o => ws.onmessage({ data: JSON.stringify(o) });
const frame = t => { audio.now = t / 1000; const cb = raf; raf = null; cb(t); };
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
    packShip({ id: 1, x: 6000, y: 4000, heading: .5, charge: 0,   co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 100, tgt: 1e6, shot: 100, guns: 3, psys: 1, plvl: 70, lvl: 14, drones: 3, vis: 2 }),
    packShip({ id: 2, x: 5200, y: 3400, heading: 1.9, charge: 0,  co: 'm', hull: 'bulwark',  hp: 80, sh: 60, flash: 40, guns: 4, psys: 3, plvl: 40, lvl: 31, drones: 6, vis: 2 }),
    packShip({ id: 3, x: 3000, y: 2000, heading: 1.2, charge: 1.4, co: 'h', hull: 'kestrel', hp: 30, sh: 0, flash: 0, guns: 1, lvl: 0, drones: 0, vis: 1 }),
    packShip({ id: 4, x: 9000, y: 6000, heading: 2, charge: 0,    co: 'k', hull: 'bulwark',  hp: 5, sh: 55, flash: 70, guns: 1, lvl: 0, drones: 0, vis: 0 }),
    packShip({ id: 1e6, x: 6400, y: 4300, heading: .2, charge: 0,  co: 'x', hull: 'drifter',  hp:  70, sh:  30, flash:  20, tgt: 1, shot: 90, vis: 1 }),
    packShip({ id: 1e6 + 1, x: 2200, y: 6600, heading: 3, charge: 0, co: 'x', hull: 'drifter', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, vis: 0 }),
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
    drones: ['emitter1', null, 'cellA'], xp: 5200, rank: { level: 14, into: 300, need: 900 },
    power: { to: 'weapons', cap: 62, lv: { thrusters: 0, weapons: 90, shields: 0 } },
    shieldNow: 640, shieldMax: 1170,
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
         hulls: ['hauler', 'vanguard'], credits: 90000 });
  sent.length = 0;
  const L = bayLayout(innerWidth, innerHeight, 'vanguard', 2);
  evt('keydown', { key: 'h' });                                  // open the hangar
  frame(t += 16); frames++;
  for (const { r } of L.hulls) evt('pointerdown', { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 });
  for (const row of L.racks) if (!row.header)
    evt('pointerdown', { clientX: row.r.x + row.r.w / 2, clientY: row.r.y + row.r.h / 2 });
  for (const { r } of L.store) evt('pointerdown', { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 });
  frame(t += 16); frames++;
  const kinds = new Set(sent.map(m => m.t));
  for (const want of ['install', 'buy', 'buydrone', 'dronestrip'])
    if (!kinds.has(want)) errs.push(`clicking every station row never produced a "${want}"`);
  if (kinds.size) console.log(`station: ${L.hulls.length} hulls + ${L.racks.filter(r => !r.header).length} slots + ` +
    `${L.store.length} store rows all reachable, sent ${[...kinds].join(', ')}`);

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
    for (const ch of 'hi123x') evt('keydown', { key: ch });
    frame(t += 16); frames++;
    if (sent.some(m => m.t === 'power' || m.t === 'target'))
      errs.push('game hotkeys fired while the chat line had focus');
    else console.log('chat: h i 1 2 3 x are letters while typing, not hotkeys');
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

console.log(`rendered ${frames} frames across ${Object.keys(MAPS).length} maps`);
if (errs.length) console.log('caught by render guard:\n  ' + errs.join('\n  '));
if (bad.length)  console.log('bad draw args:\n  ' + [...new Set(bad)].slice(0, 12).join('\n  '));
console.log(errs.length === 0 && bad.length === 0 ? 'PASS' : 'FAIL');
