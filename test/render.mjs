// Runs the real client render path against a stub 2D context, over every map,
// with the chart open and closed. Any undefined field or bad colour throws.
import { readFileSync, writeFileSync } from 'node:fs';
import { MAPS } from '../shared/maps.js';
import { MODULES } from '../shared/ships.js';

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
    // #rrggbb and #rrggbbaa are both valid CSS Color 4, which canvas accepts
    return { addColorStop(o, c) { if (c !== 'transparent' && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) bad.push(`addColorStop bad colour ${c}`); } };
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

feed({ t: 'welcome', id: 1, co: 'm', map: 'm1', hull: 'vanguard', fit: [] });
let t = 0, frames = 0;
for (const id of Object.keys(MAPS)) {
  feed({ t: 'map', map: id });
  feed({ t: 's', ships: [[1, 6000, 4000, 0.5, 0, 'm', 'vanguard', 100, 100, 2],   // self
                         [2, 5200, 3400, 1.9, 0, 'm', 'bulwark',  80,  60, 2],   // ally
                         [3, 3000, 2000, 1.2, 1.4, 'h', 'kestrel', 30, 0, 1],    // live contact
                         [4, 9000, 6000, 2, 0, 'k', 'bulwark', 5, 55, 0]] });    // fading track
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
}
console.log(`rendered ${frames} frames across ${Object.keys(MAPS).length} maps`);
if (errs.length) console.log('caught by render guard:\n  ' + errs.join('\n  '));
if (bad.length)  console.log('bad draw args:\n  ' + [...new Set(bad)].slice(0, 12).join('\n  '));
console.log(errs.length === 0 && bad.length === 0 ? 'PASS' : 'FAIL');
