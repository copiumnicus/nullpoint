import { sessionSeconds, bankPlaytime, fmtPlayed } from '../shared/playtime.js';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const MIN = 60_000, T0 = 1_700_000_000_000;

console.log('\ntime flown, not time connected');
{
  // The case this exists for. A pilot flies for twenty minutes, wanders off, and
  // the client signs them out half an hour later. The socket closes 50 minutes
  // after they joined, and 20 of those were flying.
  const acct = { played: 0 };
  const p = { banked: T0, acted: T0 + 20 * MIN };
  bankPlaytime(acct, p, T0 + 50 * MIN);
  check('an idle sign-out banks the flying, not the waiting',
    acct.played === 20 * 60,
    `50 minutes connected, ${acct.played / 60} banked — the 30-minute idle tail is not playtime`);
}
{
  const acct = { played: 0 };
  const p = { banked: T0, acted: T0 + 9 * MIN };
  bankPlaytime(acct, p, T0 + 9 * MIN);       // tab closed mid-fight: no tail at all
  check('closing the tab mid-fight loses nothing', acct.played === 9 * 60, `${acct.played / 60} minutes`);
}
{
  // Banking is incremental, so a crash costs the seconds since the last save
  // rather than the session. Doing it twice must not count the same time twice.
  const acct = { played: 0 }, p = { banked: T0, acted: T0 + 5 * MIN };
  bankPlaytime(acct, p);
  bankPlaytime(acct, p);
  check('banking twice over the same stretch does not count it twice', acct.played === 5 * 60);
  p.acted = T0 + 8 * MIN;
  bankPlaytime(acct, p);
  check('and the next stretch adds on to it', acct.played === 8 * 60, `${acct.played}s across three banks`);
}
{
  const acct = { played: 3600 }, p = { banked: T0, acted: T0 + MIN };
  bankPlaytime(acct, p);
  check('an existing total is added to, never replaced', acct.played === 3660);
}

console.log('\nthe edges');
check('a clock that goes backwards banks nothing rather than a negative',
  sessionSeconds(T0 + MIN, T0) === 0);
check('a session with no action yet is zero, not NaN',
  sessionSeconds(T0, T0) === 0 && sessionSeconds(undefined, T0) === 0);
check('a corrupt total on disk cannot poison the running one', (() => {
  const acct = { played: -5 }, p = { banked: T0, acted: T0 + MIN };
  bankPlaytime(acct, p);
  return acct.played === 60;
})());

console.log('\nreading it back');
check('seconds while it is still seconds', fmtPlayed(51) === '51s');
check('minutes once there are any', fmtPlayed(24 * 60) === '24m' && fmtPlayed(59) === '59s');
check('hours and minutes after that', fmtPlayed(3 * 3600 + 24 * 60) === '3h 24m');
check('a round hour still says the minutes', fmtPlayed(7200) === '2h 0m');
check('nothing flown reads as nothing', fmtPlayed(0) === '0s' && fmtPlayed(undefined) === '0s');

console.log(`\n${fails.length ? `FAIL — ${fails.length}: ${fails.join(', ')}` : 'PASS — playtime'}\n`);
process.exit(fails.length ? 1 : 0);
