// Claims about pinging the chart.
//
// A ping is the first thing in this game one pilot does AT another. Everything
// else on the wire is the world happening — a bolt, a pod, a patch of ground —
// and a client either can see it or cannot. This is a message, and that makes
// three things true at once that nothing else here has to hold together:
//
//   1. IT CROSSES RADAR ON PURPOSE. "An enemy you have not detected must never
//      reach the wire" is the rule the whole snapshot is built around, and this
//      is the one deliberate exception. So the callsign has to ride the PING and
//      not be looked up from a ship row, or a ping from someone you cannot see
//      arrives anonymous — which is the same as no ping.
//
//   2. THE COOLDOWN IS THE SERVER'S AND THE WAIT IS THE CLIENT'S. One sentence,
//      one number, one module, or the chip counts down to a moment the server
//      refuses.
//
//   3. UP TO SIX NAMES HAVE TO FIT ON A PLOT 180 PIXELS WIDE. Two callsigns
//      printed on one line is the single outcome a reader cannot recover from,
//      and it is what happens by default when three people point at one fight.
//
// The geometry is asserted at every window size the render sweep covers, because
// the frame rules can only catch what a sweep happens to draw and this is a claim
// about all of them.

import { PING_COOLDOWN, PING_LIFE, PING_FADE, PING_MAX, PING_ROW, PING_TINT, PING_FONT,
         pingAlpha, pingChip, chipLine, whyNotPing, onChip, pingLayout } from '../shared/ping.js';
import { PING_FIELDS, packPing, unpackPing, STREAMS, EPHEMERAL, bagKeys } from '../shared/net.js';
import { MAX_FIELDS } from '../shared/delta.js';
import { SIZES } from '../shared/viewport.js';
import { NAME_MAX } from '../shared/signup.js';
import { sizeOf } from '../shared/sim.js';
import { MAPS } from '../shared/maps.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const n1 = v => Math.round(v * 10) / 10;
// The plot the client draws, from the same three lines resize() uses. A copy is
// what UI geometry in shared/ exists to avoid, but the minimap's own rectangle is
// the client's — what shared/ping.js owns is what goes IN it, and this is the
// harness handing it the same four numbers index.html does.
const plotAt = (w, h) => {
  const mw = Math.min(260, w * 0.22), mh = mw * (8000 / 12000);
  return { x: w - mw - 16, y: h - mh - 16, w: mw, h: mh };
};
const NAME = 'W'.repeat(NAME_MAX);
const SECTOR = sizeOf(MAPS.m1);

// --- the wire ---------------------------------------------------------------
console.log('\nthe wire');
{
  const row = packPing({ id: 7, x: 6000.4, y: 4000.6, p: 0.4567, name: NAME });
  const back = unpackPing(row);
  check('a ping carries its own callsign, so one from outside your radar still has a name on it',
    PING_FIELDS.includes('name') && back.name === NAME,
    `${PING_FIELDS.length} fields: ${PING_FIELDS.join(' ')} — the name is on the ping and not ` +
    'looked up from a ship row, because the pilot who dropped it may be a sector-width away in the dark');
  check('it is a keyed stream, so the callsign rides the add and then goes quiet',
    !!STREAMS.pings && !EPHEMERAL.includes('pings') && PING_FIELDS.length <= MAX_FIELDS,
    `wire key '${STREAMS.pings.wire}', keyed on field ${STREAMS.pings.key}. Measured through the real ` +
    'delta codec at four pilots each pinging on cooldown: 3.820 KiB/s sent whole every tick against ' +
    '0.567 keyed, and 1.502 of that 3.820 is the callsign re-sent thirty times a second');
  const used = Object.values(STREAMS).map(s => s.wire);
  check('and its wire key collides with nothing else in a delta message',
    new Set(used).size === used.length && !used.includes('b') && !used.includes('x') && !used.includes('t'),
    `stream keys ${used.join(' ')}, against 't' for the shape, 'b' for the bag and 'x' for what left it`);
  check('the snapshot key is a stream and never falls into the per-viewer bag',
    !bagKeys({ t: 's', pings: [], credits: 4 }).includes('pings'),
    'bagKeys is a set difference over STREAMS and EPHEMERAL, so a stream added to one is diffed as a ' +
    'stream — a ping list landing in the bag would be JSON.stringify-compared every tick');
  check('a life is rounded to two places on the wire, and that is where the resolution stops',
    back.p === 0.46,
    `p 0.4567 -> ${back.p}. A tenth is 6.6x cheaper again and is not honest: p drives the OPACITY over ` +
    `the last ${Math.round(PING_FADE * 100)}% of a ${PING_LIFE}s life, so a tenth is ` +
    `${n1(PING_LIFE / 10)}s of a ${n1(PING_LIFE * PING_FADE)}s fade — four visible steps, which is a ` +
    'label blinking out rather than fading');
  const junk = unpackPing(packPing({ id: 1, x: 9e9, y: -9e9, p: 42, name: undefined }));
  check('and nothing a client could send survives as an unclamped number',
    junk.p === 1 && junk.name === '' && Number.isFinite(junk.x) && Number.isFinite(junk.y),
    `p 42 -> ${junk.p}, a missing name -> "". The server clamps the place into the sector's own ` +
    'rectangle before it ever reaches here');
}

// --- the cooldown -----------------------------------------------------------
console.log('\nten seconds, and a refusal that says so');
{
  check(`a pilot may ping once every ${PING_COOLDOWN} seconds`,
    PING_COOLDOWN === 10, 'the designer\'s number, enforced in server.js against the wall clock');
  check('a ping is gone before the same pilot can drop another',
    PING_LIFE < PING_COOLDOWN,
    `${PING_LIFE}s of life against a ${PING_COOLDOWN}s wait, so there is a ${PING_COOLDOWN - PING_LIFE}s ` +
    'window where the chart is clean — otherwise a sector fills with one pilot\'s own history');
  check('nothing refuses a ping in silence',
    whyNotPing({ cool: 7 }) === 'Ping is recharging — 7s' && whyNotPing({ cool: 0 }) === null,
    `"${whyNotPing({ cool: 7 })}" — the server sends this sentence and the client says the same one ` +
    'off the countdown the server put in its bag. One string, so the two cannot disagree');
  check('a refusal never rounds down to "0s left" while it is still refusing',
    whyNotPing({ cool: 0.05 }).includes('1s'),
    `0.05s left says "${whyNotPing({ cool: 0.05 })}". Ceiling, so the wait it prints is always a wait ` +
    'somebody can act on');
  check('the button says which of the three things it is doing',
    chipLine({}) === 'PING' && chipLine({ armed: true }) === 'PICK A SPOT' &&
    chipLine({ cool: 7 }) === 'PING 7s',
    `"${chipLine({})}" / "${chipLine({ armed: true })}" / "${chipLine({ cool: 7 })}" — and the third is ` +
    'the whole reason it is a button rather than a bare modifier: a refusal has to be visible on the ' +
    'control that will refuse, before the click');
  check('a cooling chip is never also armed in the copy',
    chipLine({ cool: 3, armed: true }) === 'PING 3s',
    'the wait outranks the mode, because the wait is the thing that will stop the next click');
}

// --- how it lives and dies --------------------------------------------------
console.log('\neight seconds, and a fade rather than a blink');
{
  check('a ping is at full strength for most of its life and then fades out',
    pingAlpha(0) === 1 && pingAlpha(1 - PING_FADE) === 1 && pingAlpha(1) === 0 &&
    pingAlpha(1 - PING_FADE / 2) > 0.4 && pingAlpha(1 - PING_FADE / 2) < 0.6,
    `full for ${n1(PING_LIFE * (1 - PING_FADE))}s, then ${n1(PING_LIFE * PING_FADE)}s of fade. ` +
    'Long enough to be seen by somebody looking elsewhere, short enough that a sector is not a wall of names');
  check('and no number off the wire can turn the fade into a bad frame',
    [NaN, undefined, -3, 9e9, 'x'].every(v => { const a = pingAlpha(v); return a >= 0 && a <= 1; }),
    'the render harness rejects any draw call containing NaN, and globalAlpha is where a life off a ' +
    'socket would land');
}

// --- three pilots pointing at one fight --------------------------------------
console.log('\nwhere the names go');
{
  // The case a player actually produces: something happens, and everyone points at
  // it. Six is PING_MAX, and they are inside a hundred pixels of each other, which
  // on a 180px plot is under two pixels apart.
  const pile = Array.from({ length: PING_MAX }, (_, i) =>
    ({ id: i, x: 6000 + i * 18, y: 4000 + i * 14, p: i * 0.1, name: NAME }));
  let tightest = Infinity, tightAt = '', shortest = Infinity, shortAt = '';
  let spilled = 0, onButton = 0, sameLine = 0;
  const ink = r => ({ top: r.ty - 0.72 * PING_FONT, bot: r.ty + 0.2 * PING_FONT });
  for (const [w, h] of SIZES) {
    const mm = plotAt(w, h), chip = pingChip(mm);
    const rows = pingLayout(pile, mm, SECTOR);
    if (rows.length < shortest) { shortest = rows.length; shortAt = `${w}x${h}`; }
    for (const r of rows) {
      if (r.x < mm.x - 0.01 || r.x + r.w > mm.x + mm.w + 0.01 ||
          r.y < mm.y - 0.01 || r.y + r.h > mm.y + mm.h + 0.01) spilled++;
      if (r.y + r.h > chip.y + 0.01) onButton++;
    }
    for (let i = 1; i < rows.length; i++) {
      const gap = ink(rows[i]).top - ink(rows[i - 1]).bot;
      if (gap < 0) sameLine++;
      if (gap < tightest) { tightest = gap; tightAt = `${w}x${h}`; }
    }
  }
  check('three pilots pointing at one fight get three lines, never two names on one',
    sameLine === 0 && tightest >= 0.2 * PING_FONT,
    `${PING_MAX} pings within 90px of each other, at ${SIZES.length} window sizes: ` +
    `${n1(tightest)}px of clear ink at the tightest (${tightAt}), against the ` +
    `${n1(0.2 * PING_FONT)}px a ${PING_FONT}px descender needs. Every label gets a row of its own and ` +
    'the block slides as a block, because pulling one label up into the gap above it is exactly how ' +
    'two names end up sharing a line');
  check('and no callsign is written outside the plot it belongs to',
    spilled === 0,
    `${SIZES.length} window sizes from ${SIZES.at(-1).join('x')} up. A label half off the chart is ` +
    'clipped to nothing by the frame and reads as a bug — and the harness asserts nothing is written ' +
    'across the minimap, which a label can only satisfy by being part of its layout');
  check('and none of them lands on the PING button',
    onButton === 0,
    'the band the names stand in stops above the chip, so a name and the cooldown never share the corner');
  check('a short plot draws fewer names rather than printing them through each other',
    shortest >= 3 && shortest <= PING_MAX,
    `${shortest} rows at ${shortAt}, capped at ${PING_MAX} everywhere else. The plot is ` +
    `${Math.round(plotAt(...SIZES.at(-1)).h)}px tall at the smallest window and a row is ${PING_ROW}px`);
}

// --- clamping and the freshest news ------------------------------------------
console.log('\nthe corners, and who gets dropped');
{
  const mm = plotAt(1600, 900);
  const corners = [{ id: 1, x: 0, y: 0 }, { id: 2, x: SECTOR.w, y: 0 },
                   { id: 3, x: 0, y: SECTOR.h }, { id: 4, x: SECTOR.w, y: SECTOR.h }]
    .map((c, i) => ({ ...c, p: i * 0.2, name: NAME }));
  const rows = pingLayout(corners, mm, SECTOR);
  check('a ping in a corner of the sector puts its dot in the corner of the plot',
    rows.length === 4 &&
    rows.every(r => r.mx >= mm.x - 0.01 && r.mx <= mm.x + mm.w + 0.01 &&
                    r.my >= mm.y - 0.01 && r.my <= mm.y + mm.h + 0.01),
    `all four corners of a ${SECTOR.w}x${SECTOR.h} sector land on a ${Math.round(mm.w)}px plot`);
  check('and its name flips to the other side of the dot rather than running off the edge',
    rows.every(r => r.x + r.w <= mm.x + mm.w + 0.01),
    `a ${NAME_MAX}-character handle is ${Math.round(NAME_MAX * 0.6 * PING_FONT)}px wide on a ` +
    `${Math.round(mm.w)}px chart`);

  // Against a DUEL arena, which is a quarter of the galaxy's rectangle. The plot is
  // drawn against sizeOf(map) and so is this, which is the same reason the course
  // order is: reading the galaxy's size while the plot is drawn at a quarter of it
  // put every duel order four times too far away, into the wall.
  const duel = Object.values(MAPS).find(m => m.w && m.w < SECTOR.w) ?? { w: 6000, h: 4000 };
  const small = pingLayout([{ id: 1, x: duel.w, y: duel.h, p: 0, name: NAME }], mm, sizeOf(duel));
  check('and a duel arena is plotted at its own size, not the galaxy\'s',
    Math.abs(small[0].mx - (mm.x + mm.w)) < 0.01,
    `the far corner of a ${duel.w}x${duel.h} arena is the far corner of the plot, not a quarter of the ` +
    'way across it');

  const many = Array.from({ length: PING_MAX + 4 }, (_, i) =>
    ({ id: i, x: 1000 + i * 400, y: 1000, p: 1 - i * 0.05, name: NAME }));
  const kept = pingLayout(many, mm, SECTOR);
  check('and when more arrive than there is room for, the freshest are the ones drawn',
    kept.length <= PING_MAX && Math.max(...kept.map(r => r.p)) < Math.max(...many.map(m => m.p)) + 1e-9 &&
    kept.every(r => r.p <= many.map(m => m.p).sort((a, b) => a - b)[kept.length - 1] + 1e-9),
    `${many.length} offered, ${kept.length} drawn, sorted by how far through their life they are — ` +
    'the news you have not read yet is the news that survives. The server caps the sector at ' +
    `${PING_MAX} from the same end for the same reason`);
}

// --- the button is a control, and a control has to be hittable ---------------
console.log('\nthe button');
{
  let missed = 0, over = 0;
  for (const [w, h] of SIZES) {
    const mm = plotAt(w, h), c = pingChip(mm);
    if (!onChip({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, mm)) missed++;
    if (c.x < mm.x || c.y < mm.y || c.x + c.w > mm.x + mm.w + 0.01 || c.y + c.h > mm.y + mm.h + 0.01) over++;
    const words = chipLine({ armed: true }).length * 0.6 * PING_FONT;
    if (words > c.w) over++;
  }
  check('the PING button can be clicked where it is drawn, at every window size',
    missed === 0 && over === 0,
    `${SIZES.length} sizes: the chip sits inside the plot and holds "${chipLine({ armed: true })}" ` +
    'at every one of them. A row you can see and cannot click is the bug shared/ geometry exists to prevent');
  check('and a click anywhere else on the chart is not a click on the button',
    !onChip({ x: plotAt(1600, 900).x + 200, y: plotAt(1600, 900).y + 20 }, plotAt(1600, 900)),
    'or arming would eat the course order, which is how people fly');
  check('one colour for every ping, never the pinger\'s company colour',
    PING_TINT === '#ffd479',
    '"that is a ping" has to read in the quarter-second somebody glances at the plot, and the plot ' +
    'already spends red on hostiles, the company colours on rings and blue on your own course. The ' +
    'name says whose it is; the colour says what it is');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
  : `PASS — a ping: ${PING_COOLDOWN}s apart, ${PING_LIFE}s of life, ${PING_MAX} to a sector, ` +
    'everyone in it sees the name'}\n`);
process.exit(fails.length ? 1 : 0);
