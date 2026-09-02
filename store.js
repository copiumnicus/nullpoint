// Account persistence. A JSON file, written by rename so a crash mid-write cannot
// leave a half file behind. Deliberately not a database yet — this is small
// enough to read with an editor, and swapping it for Postgres later means
// replacing two functions.
//
// THE WRITE DOES NOT HAPPEN ON THE GAME LOOP, and that is the whole reason this
// file is more than four lines long.
//
// `save()` used to be `writeFileSync` + `renameSync` called straight from the
// once-a-second timer in server.js. Node is one thread, so every one of those
// stalled the 30Hz tick for as long as the disk took. Measured, four pilots
// fighting on the frontier against 214 accounts (261 KiB of pretty-printed JSON):
// the save fires 37 times in 40 seconds — because `bankLab` pays a mine out once
// a second and calls `touch()`, so any online pilot who owns one sets `dirty`
// every single second, forever.
//
// On a laptop SSD each of those cost about 1ms and nothing was visible. The
// deployment is a Railway volume, which is network-backed, and its latency is not
// a laptop's. Re-measured with the write forced to 30ms, an unremarkable number
// for network storage:
//
//                                   fast local disk      a 30ms volume
//     event loop delay, max              3.7ms               33.7ms
//     worst gap between snapshots       36.2ms               63.0ms
//     wall clock spent blocked        38ms / 40s        1,161ms / 40s
//
// A snapshot that should have arrived 33ms after the last one arriving 63ms
// later, about once a second, is exactly what intermittent lag feels like — and
// it does it whether there are four players or one, because it is not about
// players at all.
//
// So the string is built now and the bytes go out off the loop. What that costs
// is that the file can be a few milliseconds behind the last `save()`. Nobody
// outside this module may notice that, which is what the two flushes are for.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIRS, pickDir } from './config.js';

// A mounted volume at /data wins; without one the file is
// wiped on every deploy and everybody loses their ship.
const DIR = pickDir(DATA_DIRS, d => fs.existsSync(d));
const FILE = path.join(DIR, 'accounts.json');

// The newest text not yet known to be ON DISK, and whether a write is already in
// the air. Only the NEWEST is kept: two saves a millisecond apart are two
// versions of the same file, and writing the older one is work whose result is
// overwritten before anyone could read it. This is also what stops a slow volume
// growing a queue — however far behind the disk falls there is one write out and
// one string waiting, never a backlog.
//
// `pending` is deliberately NOT cleared when a write starts, only when one
// lands. Clearing it at the start is the obvious version and it is wrong: it
// leaves `flush()` with nothing to write while the bytes are still in the air, so
// a `load()` or a `process.exit()` in that window reads or keeps the state before
// the save. Both of those windows are real — test/persist.mjs holds them open.
let pending = null;
let writing = false;

// Which version of the file each write is carrying, and the newest that has
// actually landed. Both paths below can be live at once — `load()` and the exit
// hook write where they stand while an asynchronous write is still going — so an
// older write must not be allowed to rename itself over a newer one that got
// there first. Without this the in-flight save wins by finishing last and the
// file goes BACKWARDS, which is worse than the stall this file removes.
let stamped = 0;
let landed = 0;

// A tmp per write for the same reason. A single shared `.tmp` would have the
// synchronous flush and the asynchronous write appending to one path at once,
// and the rename would then publish whatever that interleaving produced.
const tmpFor = n => `${FILE}.${n}.tmp`;

const drop = f => { try { fs.unlinkSync(f); } catch {} };

// Cleared only if nothing newer arrived while this text was being written.
const settled = text => { if (pending === text) pending = null; };

function drain() {
  if (writing || pending === null) return;
  const text = pending;
  const n = ++stamped;
  writing = true;
  const tmp = tmpFor(n);
  // mkdir asynchronously too: on a cold volume the directory may not exist yet,
  // and doing it synchronously here would put back a slice of the stall this
  // whole file exists to remove.
  fs.mkdir(DIR, { recursive: true }, () => {
    // A failure leaves `pending` alone so the text is not lost, and does NOT go
    // round again from here: the next `save()` picks it up, which paces the retry
    // at the once-a-second timer rather than at the speed of the event loop. A
    // full or unmounted volume would otherwise spin as fast as it could fail and
    // print a line every time.
    const failed = why => { console.error('could not save accounts:', why); drop(tmp); writing = false; };
    const done = () => { writing = false; drain(); };
    fs.writeFile(tmp, text, err => {
      if (err) return failed(err.message);
      // Somebody newer already landed while we were writing. Publishing now would
      // undo them, so this one is simply dropped — its content is that file's own
      // past and nothing is lost by never writing it.
      if (n < landed) { drop(tmp); settled(text); return done(); }
      fs.rename(tmp, FILE, err2 => {
        if (err2) return failed(err2.message);
        landed = Math.max(landed, n);
        settled(text);
        done();                                    // whatever arrived while we were out
      });
    });
  });
}

// Everything owed to the disk, written where the caller stands. The slow path on
// purpose, and only two callers have a reason to want it.
function flush() {
  if (pending === null) return false;
  const text = pending;
  const n = ++stamped;
  const tmp = tmpFor(n);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, FILE);                      // atomic on the same filesystem
    landed = Math.max(landed, n);
    settled(text);
    return true;
  } catch (e) {
    console.error('could not save accounts:', e.message);
    drop(tmp);
    return false;
  }
}

// THE EXIT FLUSH, and it is not belt and braces — it is what makes an
// asynchronous save safe to call from a shutdown path. server.js's SIGINT and
// SIGTERM handler calls persistAll() and then process.exit(0) on the next line,
// so an unflushed write would be a save that never happened. 'exit' handlers run
// synchronously and are the last place a file can still be written.
//
// It does nothing about SIGKILL, and neither did the synchronous version: Railway
// gives a process zero seconds between the two signals, which is exactly why
// server.js saves on change rather than on the way out.
process.on('exit', flush);

export function load() {
  // Anything still owed to the disk goes down first, so a `load()` after a
  // `save()` can never read the state before it. Without this the module would be
  // lying to the only other thing that reads it back — test/account.mjs writes an
  // account and reads it straight out again, and so would anyone debugging by
  // hand.
  flush();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { accounts: raw.accounts ?? {}, seq: raw.seq ?? Object.keys(raw.accounts ?? {}).length };
  } catch {
    return { accounts: {}, seq: 0 };               // first run, or an unreadable file
  }
}

export function save(state) {
  try {
    // Stringified HERE rather than inside the callback, because `state` is the
    // live database and it keeps moving. Deferring it would write whatever the
    // world looked like once the disk got round to it — a different file from the
    // one the caller asked for, torn across however many ticks went by.
    //
    // This half is still on the loop and it is the half with a ceiling: 0.55ms at
    // 214 accounts, 2.4ms at 1,000, 5.2ms at 2,000, measured in test/persist.mjs.
    // It is the disk that has no ceiling, and the disk is what moved.
    pending = JSON.stringify(state, null, 2);
    drain();
    return true;
  } catch (e) {
    console.error('could not save accounts:', e.message);
    return false;
  }
}
