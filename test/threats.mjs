// The threat file: what a pilot knows, and what they had to do to know it.
import { sanitiseKills, filedIn, totalKills, dossierOf, filePanel, fileProgress,
         FILE_ROW, FILE_HEAD, FILE_PAD } from '../shared/threats.js';
import { ALIENS, WILD, effectiveHp, outlineOf } from '../shared/aliens.js';
import { sanitiseAccount } from '../shared/account.js';

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nwhat is in it');
{
  const some = { drifter: 412, thresher: 2 };
  check('a hostile is in the file once you have killed one, and not before',
    filedIn(some).length === 2 && !filedIn(some).includes('bandit'),
    `${filedIn(some).join(', ')} of ${WILD.length} — the rest are absent, not greyed out`);
  check('and it reads as a climb rather than an index',
    filedIn({ thresher: 1, drifter: 1, harrier: 1 }).join() === 'drifter,harrier,thresher',
    'weakest first, which is the order a pilot met them in');
  check('the file admits it is incomplete without saying what is missing',
    fileProgress(some).known === 2 && fileProgress(some).all === WILD.length,
    `"${fileProgress(some).known} of ${fileProgress(some).all} recorded" — a list of locked rows ` +
    'would be the manual this exists instead of');
  check('the tally is the diary',
    totalKills(some) === 414, `${totalKills(some)} confirmed kills`);
}

console.log('\nevery hostile can be filed');
{
  check('every hostile in the wild explains itself in one line',
    WILD.every(k => typeof ALIENS[k].tell === 'string' && ALIENS[k].tell.length > 20),
    `${WILD.length} of them — the game has five mechanics a bolt does not do and none ` +
    'of them were written down anywhere a player could read');
  check('and every line is short enough to read',
    WILD.every(k => ALIENS[k].tell.length < 190),
    `longest is ${Math.max(...WILD.map(k => ALIENS[k].tell.length))} characters`);
  check('every entry has real numbers behind it, and an outline to draw',
    WILD.every(k => {
      const d = dossierOf(k, { [k]: 1 });
      return d && d.ehp === effectiveHp(k) && d.killed === 1
        && /^#[0-9a-f]{6}$/i.test(d.colour) && outlineOf(k, 20).length >= 3;
    }));
  check('the two hostiles with no gun say so rather than reporting zero damage',
    WILD.filter(k => !dossierOf(k, {}).armed)
        .every(k => dossierOf(k, {}).dps === 0 && /No gun/.test(ALIENS[k].tell)),
    WILD.filter(k => !dossierOf(k, {}).armed).map(k => ALIENS[k].name).join(', ') +
    ' — a dps of 0 on the row would read as harmless');
}

console.log('\nwhat comes off the disk');
{
  const dirty = { drifter: 5, nosuchthing: 99, bandit: -3, hive: 'lots' };
  check('a hand-edited file cannot invent a hostile or a negative tally',
    JSON.stringify(sanitiseKills(dirty)) === JSON.stringify({ drifter: 5 }),
    JSON.stringify(sanitiseKills(dirty)));
  check('and an account with no file at all is simply empty',
    JSON.stringify(sanitiseKills(undefined)) === '{}' &&
    JSON.stringify(sanitiseAccount({ token: 't' }, 1, Date.now()).kills) === '{}');
  check('a real tally survives the round trip',
    sanitiseAccount({ token: 't', kills: { drifter: 7 } }, 1, Date.now()).kills.drifter === 7);
}

console.log('\nthe panel');
{
  for (const [w, h] of [[1600, 900], [1280, 720], [900, 600], [480, 420]]) {
    const n = WILD.length;
    const L = filePanel(w, h, 0, n);
    check(`at ${w}x${h} the window the rows move behind is inside the panel`,
      L.panel.x >= 0 && L.panel.y >= 0 && L.panel.x + L.panel.w <= w
      && L.panel.y + L.panel.h <= h
      && L.body.x >= L.panel.x && L.body.y >= L.panel.y
      && L.body.x + L.body.w <= L.panel.x + L.panel.w
      && L.body.y + L.body.h <= L.panel.y + L.panel.h,
      `body ${L.body.w}x${L.body.h}, ${L.fit} of ${n} whole rows fit, ${L.maxScroll}px to scroll`);
    check('and every row it hands out is horizontally inside that window',
      L.rows.every(row => row.r.x >= L.body.x && row.r.x + row.r.w <= L.body.x + L.body.w),
      'vertically they overhang on purpose — the client clips, which is what makes ' +
      'a row leaving the top get cut instead of drawn over the header');
  }
  // Pixels, not rows. A wheel tick used to move a whole 96px entry in one frame,
  // which is not scrolling, it is two different lists shown in succession.
  const L = filePanel(1600, 900, 0, WILD.length);
  const nudged = filePanel(1600, 900, 20, WILD.length);
  check('it scrolls by pixels rather than jumping a whole entry at a time',
    nudged.at === 20 && nudged.rows[0].r.y === L.rows[0].r.y - 20,
    `20px of scroll moves the list 20px, not ${FILE_ROW}`);
  check('a file too long for the panel scrolls rather than spilling',
    L.maxScroll > 0 && L.maxScroll === WILD.length * FILE_ROW - L.body.h,
    `${WILD.length} entries of ${FILE_ROW}px in a ${L.body.h}px window is ${L.maxScroll}px to scroll`);
  const far = filePanel(1600, 900, 99999, WILD.length);
  check('and it cannot be scrolled past its own end',
    far.at === far.maxScroll && far.rows.every(r => r.i < WILD.length)
    && far.rows.at(-1).r.y + FILE_ROW <= far.body.y + far.body.h + 1,
    `asked for 99999, landed on ${far.at} with the last entry flush to the bottom`);
  check('an empty file still lays out a panel to say so in',
    filePanel(1600, 900, 0, 0).panel.h > FILE_HEAD,
    'a pilot who has killed nothing still opens something');
}

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}`
                               : `PASS — ${WILD.length} hostiles, all filable`}\n`);
process.exit(fails.length ? 1 : 0);
