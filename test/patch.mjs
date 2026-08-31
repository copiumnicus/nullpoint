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
  // This used to demand the whole log fit without scrolling, which held exactly
  // as long as the log was short. A changelog only grows, so the durable claim is
  // that the RECENT end of it is readable on arrival and the rest is reachable.
  check('the newest few versions are readable without scrolling', (() => {
    const vers = L.lines.filter(l => l.kind === 'ver').map(l => l.v);
    return vers.length >= 3 && vers[0] === PATCHES[0].v && vers[1] === PATCHES[1].v;
  })(), `${L.lines.filter(l => l.kind === 'ver').length} versions visible on opening, newest first`);
  check('and every note of the newest version is on screen with it', (() => {
    const first = L.lines.findIndex(l => l.kind === 'ver');
    const notes = [];
    for (let i = first + 1; i < L.lines.length && L.lines[i].kind === 'note'; i++) notes.push(L.lines[i].text);
    return notes.length >= PATCHES[0].notes.length;
  })(), 'the thing that just changed is never the thing you have to scroll for');
  check('a scrollbar appears exactly when something is below the fold',
    [[1600, 900], [1400, 600], [1200, 420], [900, 340]]
      .every(([w, h]) => { const q = patchPanel(w, h); return (q.maxScroll > 0) === !!q.bar; }),
    'and never when there is nothing to scroll to');

  // It scrolls in PIXELS now, through shared/scroll.js, like every other list in the
  // game — it used to be the fifth arrangement, a line index moved three at a time.
  // So "five" is five pixels, not five lines, and the window shows a row more or
  // less as the edges come into it. Both claims are the same claims; the unit under
  // them changed.
  const small = [1200, 420];
  const top = patchPanel(...small, 0), mid = patchPanel(...small, ROW_H * 5);
  check('scrolling moves the window, it does not resize it', (() => {
    // The SAME line, before and after: it must be exactly five rows higher up. The
    // window keeps its size (a row more or less, as the edges come into it) — it is
    // the content that moved, which is the difference between scrolling and
    // re-laying-out.
    const same = (a, b) => a.kind === b.kind && a.text === b.text && a.v === b.v;
    // A line with WORDS on it: the blank spacers between versions are all identical
    // to each other, so matching one of those finds the wrong gap and the line
    // appears to have moved a hundred pixels it never moved.
    const mark = top.lines.filter(l => l.text).slice(-1)[0];
    const moved = mid.lines.find(l => same(l, mark));
    return moved && Math.abs((mark.y - moved.y) - ROW_H * 5) < 1
        && Math.abs(mid.lines.length - top.lines.length) <= 1;
  })(), `${top.lines.length} rows either way, and a given line sits ${ROW_H * 5}px higher`);
  check('and it shows the lines it had skipped past', (() => {
    const same = (a, b) => a.kind === b.kind && a.text === b.text && a.v === b.v;
    // The row that was sixth is now the first one fully inside the window: at a
    // whole number of rows of scroll the top line is either row 5 clipped or row 5
    // flush, depending on the fold, so both are accepted and neither is row 0.
    return !same(mid.lines[0], top.lines[0])
        && (same(mid.lines[0], top.lines[5]) || same(mid.lines[1], top.lines[5]));
  })(), 'five rows of scroll later, line six is what you are reading');
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

// --- the rule that keeps this file honest ------------------------------------
// A change nobody can read about may as well not have shipped. Two batches went
// out without a line here, which is exactly the failure this catches: if the
// working tree touches anything a player can see and does not touch the
// changelog, the suite fails before the commit does.
//
// It compares against HEAD rather than against the index, so it fires while the
// work is still in progress and clears itself the moment a note is written. A
// clean tree passes, which is what makes it safe to run in CI.
{
  const { execSync } = await import('node:child_process');
  let changed = null;
  try {
    changed = execSync('git diff HEAD --name-only', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(x => x.trim()).filter(Boolean);
  } catch { /* no git, no repo, a tarball: not something to fail a build over */ }

  if (changed === null) {
    console.log('  --   no git here, so the changelog rule cannot be checked');
  } else {
    const SEEN = /^(server\.js|store\.js|config\.js|shared\/|public\/)/;
    const touched = changed.filter(f => SEEN.test(f) && f !== 'shared/patch.js');
    const noted = changed.includes('shared/patch.js');
    check('anything a player can see comes with a line in the changelog',
      !touched.length || noted,
      touched.length
        ? (noted ? `${touched.length} file(s) changed, and the changelog with them`
                 : `changed without a note: ${touched.slice(0, 4).join(', ')}` +
                   (touched.length > 4 ? ` and ${touched.length - 4} more` : ''))
        : 'nothing player-visible has changed');
  }
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : `PASS — changelog v${VERSION}`}\n`);
process.exit(fails.length ? 1 : 0);
