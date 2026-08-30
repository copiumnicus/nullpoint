import { VERSION, PATCHES, patchIcon, patchPanel, patchLines, wrapNote,
         ROW_H, CHAR_W } from '../shared/patch.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

console.log('\nthe changelog itself');
check('it says which version the game is on', /^0\.\d+$/.test(VERSION),
  `v${VERSION} — the game is not on version 7, whatever the first draft said`);
check('the newest entry is the version the game reports',
  PATCHES[0].v === VERSION, `${PATCHES[0].v} at the top`);
check('every entry has a version and at least one note',
  PATCHES.every(p => p.v && p.notes.length), `${PATCHES.length} entries`);
check('they run newest first', (() => {
  const num = PATCHES.filter(p => /^0\./.test(p.v)).map(p => +p.v.slice(2));
  return num.every((n, i) => i === 0 || n < num[i - 1]);
})(), PATCHES.map(p => p.v).join(' > '));
check('notes are kept short enough to read at a glance',
  PATCHES.every(p => p.notes.every(n => n.length <= 96)),
  `longest is ${Math.max(...PATCHES.flatMap(p => p.notes.map(n => n.length)))} characters`);

console.log('\nwrapping, because half a sentence is worse than none');
check('a long note becomes whole lines, not a cut-off one', (() => {
  const out = wrapNote('the quick brown fox jumps over the lazy dog and keeps going for a while', 20);
  return out.length > 1 && out.every(l => l.length <= 20);
})(), wrapNote('the quick brown fox jumps over the lazy dog', 20).join(' / '));
check('and no word is ever chopped in half', (() => {
  const src = 'reservations lapse after forty seconds of a hundred and twenty second life';
  const out = wrapNote(src, 24);
  return out.join(' ') === src;
})(), 'joining the lines back up gives the sentence exactly');
check('nothing is dropped off the end', (() => {
  for (const p of PATCHES) for (const n of p.notes)
    if (wrapNote(n, 30).join(' ') !== n.replace(/\s+/g, ' ')) return false;
  return true;
})(), 'every real note survives a narrow wrap intact');
check('an empty note does not vanish into nothing', wrapNote('', 20).length === 1);

console.log('\nscrolling');
{
  const L = patchPanel(1600, 900);
  check('the panel is wide enough to read a note on one line',
    L.cols >= 80, `${L.cols} columns at ${L.panel.w}px, longest note is ` +
    `${Math.max(...PATCHES.flatMap(p => p.notes.map(n => n.length)))}`);
  check('a normal window shows the whole log without scrolling at all',
    L.maxScroll === 0 && L.per >= L.total,
    `${L.total} lines in ${L.panel.h}px — the bar is for small windows, not for everybody`);
  check('a scrollbar appears exactly when something is below the fold',
    [[1600, 900], [1400, 600], [1200, 420], [900, 340]]
      .every(([w, h]) => { const q = patchPanel(w, h); return (q.maxScroll > 0) === !!q.bar; }),
    'and never when there is nothing to scroll to');

  const small = [1200, 420];
  const top = patchPanel(...small, 0), mid = patchPanel(...small, 5);
  check('scrolling moves the window, it does not resize it',
    top.lines.length === mid.lines.length &&
    top.lines[0].y === mid.lines[0].y,
    `${top.lines.length} rows either way, first row at the same height`);
  check('and it shows the lines it had skipped past', (() => {
    const same = (a, b) => a.kind === b.kind && a.text === b.text && a.v === b.v;
    return same(mid.lines[0], top.lines[5]) && !same(mid.lines[0], top.lines[0]);
  })(), 'line 6 becomes line 1 after scrolling five');
  const S2 = patchPanel(1200, 420);
  check('scrolling past the end stops at the end',
    patchPanel(1200, 420, 9999).at === S2.maxScroll, `clamped to ${S2.maxScroll}`);
  check('and scrolling above the top stops at the top',
    patchPanel(1200, 420, -50).at === 0);
  check('every line lands inside its own panel', (() => {
    const P = L.panel;
    return L.lines.every(l => l.y > P.y && l.y < P.y + P.h && l.x >= P.x && l.x < P.x + P.w);
  })());
  check('the last scroll position still shows the last line',
    S2.maxScroll + S2.per >= S2.total, 'you can actually reach the bottom');
}
{
  // A window small enough that the panel has to give ground rather than run off.
  const S = patchPanel(560, 380);
  check('a small window still gets a readable panel',
    S.panel.x >= 0 && S.panel.w <= 560 - 20 && S.panel.y + S.panel.h <= 380,
    `${S.panel.w}x${S.panel.h} at ${S.cols} columns`);
  check('and it wraps harder rather than cutting anything', S.cols >= 24);
}
check('the icon sits clear of the top-right corner', (() => {
  const b = patchIcon(1600);
  return b.x + b.w < 1600 && b.y > 0;
})());

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — changelog v${VERSION}`}\n`);
process.exit(fails.length ? 1 : 0);
