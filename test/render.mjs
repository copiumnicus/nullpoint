// Runs the real client render path against a stub 2D context, over every map,
// with the chart open and closed. Any undefined field or bad colour throws.
import { readFileSync, writeFileSync } from 'node:fs';
import { MAPS } from '../shared/maps.js';
import { MODULES } from '../shared/ships.js';
import { packShip, packBolt, packBlast } from '../shared/net.js';
import { ALIENS } from '../shared/aliens.js';

// pull the module body straight out of index.html so the test can never drift from it
const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  .match(/<script type="module">([\s\S]*)<\/script>/)[1]
  .replaceAll("'/shared/", "'" + new URL('../shared/', import.meta.url).pathname);
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
  measureText(t)   { guard('measureText', t); return { width: String(t).length * 6 }; },
  arc(...a)        { num('arc', ...a); if (a[2] < 0) bad.push('arc negative radius'); },
  rect(...a) { num('rect', ...a); }  , roundRect(...a) { num('roundRect', ...a); },
  moveTo(...a) { num('moveTo', ...a); }, lineTo(...a) { num('lineTo', ...a); },
  translate(...a) { num('translate', ...a); }, rotate(a) { num('rotate', a); },
  setTransform(...a) { num('setTransform', ...a); },
  beginPath() {}, closePath() {}, stroke() {}, fill() {}, save() {}, restore() {}, clip() {},
  setLineDash(d) { this._dash = d; },
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
globalThis.document = { getElementById: () => canvas };
globalThis.location = { host: 'localhost:3000' };
globalThis.addEventListener = on;
globalThis.setInterval = () => 0;
let raf = null;
globalThis.requestAnimationFrame = cb => { raf = cb; };
const socks = [];
globalThis.WebSocket = class { constructor() { this.readyState = 1; socks.push(this); } send() {} close() {} };

const errs = [];
console.error = (...a) => errs.push(a.join(' '));

await import('./.client.mjs');

const ws = socks[0];
const feed = o => ws.onmessage({ data: JSON.stringify(o) });
const frame = t => { const cb = raf; raf = null; cb(t); };
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
    packShip({ id: 1, x: 6000, y: 4000, heading: .5, charge: 0,   co: 'm', hull: 'vanguard', hp: 100, sh: 100, flash: 100, tgt: 1e6, shot: 100, vis: 2 }),
    packShip({ id: 2, x: 5200, y: 3400, heading: 1.9, charge: 0,  co: 'm', hull: 'bulwark',  hp:  80, sh:  60, flash:  40, vis: 2 }),
    packShip({ id: 3, x: 3000, y: 2000, heading: 1.2, charge: 1.4, co: 'h', hull: 'kestrel', hp:  30, sh:   0, flash:   0, vis: 1 }),
    packShip({ id: 4, x: 9000, y: 6000, heading: 2, charge: 0,    co: 'k', hull: 'bulwark',  hp:   5, sh:  55, flash:  70, vis: 0 }),
    packShip({ id: 1e6, x: 6400, y: 4300, heading: .2, charge: 0,  co: 'x', hull: 'drifter',  hp:  70, sh:  30, flash:  20, tgt: 1, shot: 90, vis: 1 }),
    packShip({ id: 1e6 + 1, x: 2200, y: 6600, heading: 3, charge: 0, co: 'x', hull: 'drifter', hp: 100, sh: 100, flash: 0, tgt: 0, shot: 0, vis: 0 }),
  ], bolts: [
    packBolt({ sx: 6000, sy: 4000, ax: 6400, ay: 4300, t: 0.10, ttl: 0.21, foe: false }),
    packBolt({ sx: 6400, sy: 4300, ax: 6000, ay: 4000, t: 0.02, ttl: 0.21, foe: true }),
    packBolt({ sx: 5200, sy: 3400, ax: 2200, ay: 6600, t: 0.20, ttl: 0.21, foe: false }),
  ], blasts: [
    packBlast({ x: 6400, y: 4300, r: 15, t: 0.75, ttl: 0.8, foe: true }),    // just popped
    packBlast({ x: 5600, y: 3800, r: 13, t: 0.10, ttl: 0.8, foe: false }),   // nearly done
  ] });
  frame(t += 16); frames++;                                    // world view
  listeners.keydown.forEach(fn => fn({ key: 'm' }));           // star system chart
  frame(t += 16); frames++;
  listeners.keydown.forEach(fn => fn({ key: 'm' }));
  listeners.keydown.forEach(fn => fn({ key: 'h' }));           // hangar
  frame(t += 16); frames++;
  for (const h of ['kestrel', 'bulwark']) {                    // every hull, every module
    feed({ t: 'fit', hull: h, fit: Object.keys(MODULES).slice(0, 3) });
    frame(t += 16); frames++;
  }
  listeners.keydown.forEach(fn => fn({ key: 'h' }));

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
  for (const k of ['Tab', 'x', 'k', 'Escape']) evt('keydown', { key: k });
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
console.log(`rendered ${frames} frames across ${Object.keys(MAPS).length} maps`);
if (errs.length) console.log('caught by render guard:\n  ' + errs.join('\n  '));
if (bad.length)  console.log('bad draw args:\n  ' + [...new Set(bad)].slice(0, 12).join('\n  '));
console.log(errs.length === 0 && bad.length === 0 ? 'PASS' : 'FAIL');
