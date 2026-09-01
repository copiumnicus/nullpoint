// Several pilots in one browser: the list, the cap, and the storage under it.
//
// The render harness drives the menu with real clicks and proves a switch costs
// the same five seconds signing out does. This is the layer under that — what a
// roster IS — and it is here rather than in the harness for the reason the
// levelling meter moved out of it: these are claims about a list, and a list
// tested through a canvas stub is a stub testing itself.

import { MAX_PILOTS, PILOT_COLS, PILOT_H, settingsLayout, berthLines } from '../shared/settings.js';
import { SIZES } from '../shared/viewport.js';
import { entry, sanitiseRoster, remember, forget, parked,
         readRoster, writeRoster, readActive, setActive } from '../shared/roster.js';
import { TOKEN_KEY, OLD_TOKEN_KEYS, ROSTER_KEY } from '../shared/brand.js';
import { nameProblem } from '../shared/signup.js';

let bad = 0;
const ok = (claim, detail) => console.log(`  ok   ${claim}  — ${detail}`);
const no = why => { bad++; console.log(`  FAIL ${why}`); };
const is = (got, want, claim, detail) =>
  (String(got) === String(want) ? ok(claim, detail) : no(`${claim}: got ${got}, want ${want}`));

// A local storage that behaves, and one that does not. Both are real browsers:
// a private window throws on the first write, and the thumbnailer throws on the
// first read.
const shelf = (start = {}) => {
  const m = new Map(Object.entries(start));
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k),
           dump: () => Object.fromEntries(m) };
};
const hostile = { getItem() { throw new Error('SecurityError'); },
                  setItem() { throw new Error('QuotaExceeded'); },
                  removeItem() { throw new Error('SecurityError'); } };

const pilot = (t, n, at) => entry(t, { name: n, co: 'm', hull: 'vanguard', level: 3 }, at);

console.log('\nthe cap is what the menu can show, not a number somebody liked');
{
  // Derived, so the assertion is the derivation and not the answer. If the panel
  // grows a section or the shipped sizes lose the small one, both move together.
  const shortest = Math.min(...SIZES.map(([, h]) => h));
  is(MAX_PILOTS, PILOT_COLS * berthLines(shortest),
     'the cap is exactly what the shortest shipped window can show',
     `${shortest}px tall leaves ${berthLines(shortest)} lines of ${PILOT_H}px at ` +
     `${PILOT_COLS} chips a line, so ${MAX_PILOTS} pilots`);

  // And the panel that number came from actually fits, at every size the game
  // ships for, with the roster full. This is the claim the number exists to make.
  const full = Array.from({ length: MAX_PILOTS - 1 }, (_, i) => pilot(`t${i}`, `Pilot ${i}`, i));
  let worst = null;
  for (const [w, h] of SIZES) {
    const L = settingsLayout(w, h, full);
    if (L.dropped || L.panel.y < 0 || L.panel.y + L.panel.h > h) worst = `${w}x${h}`;
  }
  worst ? no(`a full roster does not fit at ${worst}`)
        : ok('a full roster fits every window the game ships for',
             `${SIZES.length} sizes, ${settingsLayout(...SIZES.at(-1), full).panel.h}px of panel in ` +
             `${SIZES.at(-1)[1]}px of window at the tightest`);

  // Shorter than anything shipped, rows go rather than the panel running off the
  // top of the screen — and the heading says how many went.
  const cramped = settingsLayout(820, 524, full);
  cramped.dropped && cramped.sections.some(s => s.note) && cramped.panel.y >= 0
    ? ok('a window too short to hold the roster drops berths and says how many',
         `at 820x524 it shows ${cramped.berths.length} of ${MAX_PILOTS} and prints ` +
         `"${cramped.sections.find(s => s.note).note}"`)
    : no('a 524px window either overflowed or dropped berths in silence');

  // And shorter still, the section goes entirely rather than pushing the panel
  // off screen. Losing a feature is allowed; losing the menu is not.
  const tiny = settingsLayout(820, 460, full);
  tiny.berths.length === 0 && tiny.panel.y >= 0 && !tiny.sections.some(s => s.label === 'PILOTS')
    ? ok('a window too short even to say so drops the section, not the menu',
         `at 820x460 the panel is ${tiny.panel.h}px — exactly the menu before pilots were a list`)
    : no('a 460px window kept a roster section it had no room for');
}

console.log('\nthe empty berth is a button while there is room and a refusal when there is not');
{
  const three = Array.from({ length: MAX_PILOTS - 2 }, (_, i) => pilot(`t${i}`, `P${i}`, i));
  const room = settingsLayout(1600, 900, three);
  is(room.berths.at(-1).kind, 'new', 'room for another pilot means a way to make one',
     `${three.length + 1} of ${MAX_PILOTS} berths taken`);

  const full = Array.from({ length: MAX_PILOTS - 1 }, (_, i) => pilot(`t${i}`, `P${i}`, i));
  is(settingsLayout(1600, 900, full).berths.at(-1).kind, 'full',
     'a full roster keeps the berth and turns it into the reason',
     `${MAX_PILOTS} of ${MAX_PILOTS} taken — a button that vanished would be the silent refusal`);

  // More pilots than berths cannot happen through the client, but a hand-edited
  // roster can say anything and the panel still has to lay out.
  const over = Array.from({ length: 40 }, (_, i) => pilot(`t${i}`, `P${i}`, i));
  is(settingsLayout(1600, 900, over).berths.length, MAX_PILOTS,
     'forty pilots in a hand-edited roster still lay out as a menu', 'sliced to the cap');
}

console.log('\nwhat the list does');
{
  let r = [];
  r = remember(r, pilot('a', 'Alpha', 1));
  r = remember(r, pilot('b', 'Beta', 2));
  is(r.map(p => p.token).join(), 'b,a', 'the pilot you flew last is at the top',
     'so the menu is in the order somebody would guess');

  r = remember(r, entry('a', { name: 'Alpha', co: 'm', hull: 'bulwark', level: 9 }, 3));
  is(r.length, 2, 'signing back in updates a row instead of adding one',
     'the same token twice is one pilot with a newer hull');
  is(r[0].hull, 'bulwark', 'and the row says what they fly NOW', 'a Vanguard row for a Bulwark is a lie');

  const many = Array.from({ length: MAX_PILOTS + 3 }, (_, i) => pilot(`t${i}`, `P${i}`, i));
  is(sanitiseRoster(many).length, MAX_PILOTS, 'the list never grows past the cap',
     `${many.length} in, ${MAX_PILOTS} out`);

  is(parked([pilot('a', 'A', 1), pilot('b', 'B', 2)], 'b').map(p => p.token).join(), 'a',
     'the pilot you are flying is not one of the berths',
     'you are looking at it — a berth for it would cost the shortest window a real one');

  is(forget([pilot('a', 'A', 1), pilot('b', 'B', 2)], 'a').map(p => p.token).join(), 'b',
     'wiping one account leaves the others alone',
     '/reset all deletes one pilot, not the browser');

  // Anything off the shelf is untrusted in exactly the way a save file is.
  const junk = sanitiseRoster([null, { name: 'no token' }, pilot('a', 'A', 1), pilot('a', 'A again', 2), 7]);
  is(junk.map(p => p.token).join(), 'a', 'a hand-edited roster is cleaned rather than believed',
     'no token, no pilot; the same token twice is one row');
}

console.log('\nlocal storage can throw, and a browser that will not remember you still flies');
{
  const s = shelf();
  writeRoster(s, [pilot('a', 'Alpha', 1)]);
  is(readRoster(s).map(p => p.name).join(), 'Alpha', 'a roster written is a roster read back',
     `under ${ROSTER_KEY}`);

  s.setItem(ROSTER_KEY, '{not json');
  is(readRoster(s).length, 0, 'a corrupt roster reads as no roster', 'not as an exception on the first frame');

  is(readRoster(hostile).length, 0, 'a storage that throws on read is a browser with one pilot',
     'a private window, or site data blocked — silence, not a black screen');
  is(writeRoster(hostile, [pilot('a', 'A', 1)]), false, 'a storage that throws on write says so',
     'the client already tells the player their browser will not remember them');
  is(setActive(hostile, 'a'), false, 'and so does a switch that cannot be written',
     'rather than reloading into the pilot you were trying to leave');

  // The token being flown, and the rename that would have orphaned it.
  const old = shelf({ [OLD_TOKEN_KEYS[0]]: 'legacy' });
  is(readActive(old), 'legacy', 'a pilot stored under the old key is carried across',
     `${OLD_TOKEN_KEYS[0]} to ${TOKEN_KEY}`);
  is(old.dump()[OLD_TOKEN_KEYS[0]], undefined, 'and the old key does not stay behind', 'read once, moved once');

  // The one that matters for a switch: an old key left lying around would
  // resurrect the pilot you just put down on the very next page load.
  const both = shelf({ [TOKEN_KEY]: 'now', [OLD_TOKEN_KEYS[0]]: 'ghost' });
  setActive(both, '');
  is(readActive(both), '', 'becoming a stranger clears every key, not just the current one',
     'an old key left behind is the switch silently not happening');

  is(readActive(shelf()), '', 'a browser with nothing stored is a first visit', 'which is the join form');
}

console.log('\nnaming your second pilot after your first says so');
{
  is(nameProblem('Vex-4271', [], ['Vex-4271']), 'that is your other pilot — each one needs its own name',
     'a collision with your own pilot names them', 'the someone is you, two rows up the menu');
  is(nameProblem('vex-4271', [], ['Vex-4271']), 'that is your other pilot — each one needs its own name',
     'and case does not get you past it', 'names are unique across every account');
  is(nameProblem('Vex-4271', ['Vex-4271'], []), 'someone already flies under that name',
     'a stranger with the name still reads as a stranger', 'the server only ever knows this one');
  is(nameProblem('Vex-9999', ['Someone'], ['Vex-4271']), 'null',
     'and a free name is free', 'neither list holds it');
}

console.log(bad ? `\nFAIL — ${bad}` : '\nPASS');
process.exit(bad ? 1 : 0);
