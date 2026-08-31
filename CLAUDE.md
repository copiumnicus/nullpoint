# Working on Nullpoint

A browser space MMO. Vanilla JS, Canvas 2D, one Node process, no build step, no
framework. What follows is not style preference — every rule here is written
down because breaking it cost a real bug, and the bug is named so you can judge
whether the rule still applies.

Read this before changing anything. Then run `npm test`.

---

## The shape of it

    server.js          the whole world, one 30Hz tick, authoritative
    shared/*.js        every rule both sides need. THE important directory.
    public/index.html  the client, one module script
    public/audio.js    synthesis and playback, depends on nothing
    test/*.mjs         plain node scripts, no framework
    store.js           JSON on disk

**Clients send intent, never position.** A destination, a thrust direction, a
jump, a target, a scoop. The server owns the truth and the client draws what it
is told. Anything else is a cheat waiting to be found.

**Snapshots are per player, not per map.** Radar means two ships in the same
sector legitimately see different things, and an enemy you have not detected
must never reach the wire at all — not dimmed, not filtered client-side, not
sent.

---

## Rule one: if both sides need it, it lives in `shared/`

This is the whole architecture. A rule that exists twice will disagree, and it
will disagree silently.

- The workshop dock **refused to sell anything** for a day. The server was happy
  to take the money; the client had its own copy of "may this pilot use the
  station here" that had never heard of the workshop, so it would not draw the
  counter. One `canDock()` in `shared/sim.js`, called by both, and it was gone.
- The ammunition bar's rules, the mood rules, the hangar geometry, the chart
  layout, the wire format — all in `shared/` for the same reason.

**UI geometry counts as a rule.** `shared/hangar.js`, `shared/settings.js` and
`shared/ammo.js` return the rectangles, and the client both draws and hit-tests
them. A row you can see but not click is the same bug as a row outside its
panel, and it has happened twice.

**The wire format is declared once.** `shared/net.js` holds the field order and
pack/unpack. It exists because a hand-maintained positional tuple reached eleven
fields and the last two ended up transposed — the client read visibility as an
impact flash.

`shared/delta.js` sits on top of it and is what actually goes out at 30Hz: the
server sends one keyframe (`t:'s'`, the whole snapshot, unchanged) and then
per-tick deltas (`t:'d'`). It is generic over any keyed collection listed in
`STREAMS` in `net.js`, so a new stream is a line of data there rather than an
encoder. **The baseline is per connection**, because radar means two pilots in
one sector are legitimately sent different worlds. Decoding a delta returns a
`t:'s'`, so the client has exactly one snapshot reader and the two shapes cannot
drift apart. `test/wire-live.mjs` measures the whole thing against a real server
— it can still produce the old numbers by asking for a keyframe every tick.

`public/audio.js` is the deliberate exception: it depends on **nothing** and
takes its rules as arguments (`setPicker`, `setLeveller`, `startMusic(sort)`).
It is synthesis and playback; what the moods mean lives in `shared/music.js`
with the tests. Importing `/shared/` from it also breaks the render harness.

---

## Rule two: measure first, and keep the measurement

Do not fix a balance complaint by nudging numbers until it feels better.
Reproduce it as a number, then make that number the test.

- "Bulwark does less damage than the starter" → measured 416 dps against 528,
  found rate multiplying every emitter, fixed with a uniform `FIRE_RATE`, and
  the test now asserts damage is monotonic in weapon slots.
- "Rockets miss the target" → measured 52 of 140 lost against a parked hulk,
  found a turn circle wider than the miss distance, and the test now fires 35
  rockets across seven ranges at two hull sizes and demands none are lost.

**Derive balance numbers, do not pick them.** A bounty is `effective hp ×
BOUNTY_RATE`, so anything tougher added later pays correctly without anyone
remembering. Weapon tiers shadow each other at a stated premium. Set the ceiling
from the fiction and work down.

---

## Rule three: the render harness is the point

`test/render.mjs` pulls the module body straight out of `index.html`, runs it
against a stubbed canvas, AudioContext, localStorage, WebSocket and `Audio`,
drives **real pointer and keyboard events**, and rejects any draw call
containing `undefined`, `NaN` or a malformed colour. It has caught more real
bugs than every other test combined.

What it has taught, the hard way:

- **Drive input, not just frames.** Two helper functions went missing entirely
  while every frame still rendered — `hover` starts null, so the render path
  short-circuited before ever calling them.
- **The suite runs inside a few milliseconds of wall clock.** Anything with a
  time window — double clicks, double taps, a mood hold — collapses unless you
  own `performance.now` for that block. Anchor your fake clock to the real one;
  jumping it 30 minutes trips the idle sign-out.
- **Two clocks matter.** The mood hold is measured against the timestamp the
  frame is handed; the idle timeout against `performance.now`. Advance both.
- **Never dismiss a panel with a toggle key.** `h` toggles the station and
  `Escape` opens the menu once nothing is open, so a block "closing" a panel was
  opening one. Click bare space instead.
- **A stub that only tests itself is worse than no test.** The levelling meter
  needs a real AudioContext to say anything, so the maths moved to
  `shared/music.js` and is tested there directly.

If a page-level module fails to import, the whole client is a black screen.
There is a permanent test that every module `index.html` pulls in is reachable
over HTTP, because a missing entry in the server's file map did exactly that.

---

## Rule four: verify live, over the wire

Tests passing is not the same as the game working. After every feature, connect
a real WebSocket client to the running server and check the actual behaviour:

    pkill -f "node server.js"; (npm run dev &); sleep 1.5
    node --input-type=module -e "...connect, send intents, assert on snapshots..."

`/dev` is the testing ground: every hull with a full escort, every formation,
one of each hostile posted on a firing line, an indestructible Bulkhead Target
for reading dps off, and a dock in the middle. Admin only. `/money`, `/ammo`,
`/gear`, `/ship`, `/form`, `/tp` and `/heal` exist so a scenario takes seconds
to set up.

Things that passed tests and were still wrong: rockets orbiting a stationary
target, the station panel locking to one tab, ammunition that could not be
bought where it was needed.

---

## Rule five: tests are claims about the game

Name them as sentences someone could disagree with, and put the number in the
detail:

    ok   more weapon slots always means more damage  — with an empty escort and a full one
    ok   a finished ship one-shots a new one  — every hull clears 1100 ehp with room
    ok   a parked interceptor never finishes one off  — it flees at 10% and a ship that never moved cannot follow

**When the design changes, rewrite the assertion — do not delete it.** "Rockets
buy delivery with damage" became "the best rack out-damages the best gun, slot
for slot" when that call was reversed. A deleted test is a rule nobody is
keeping.

**Anti-pay-to-win invariants are tests, not intentions.** Every technology must
give something up. No purchasable hull may strictly dominate another. Every
weapon and generator adds absolute amounts; every technology multiplies. Levels
may gate, but never scale. These are enforced, and they are the reason this game
exists.

Levels were cosmetic and are no longer: a rank may be a **gate** — a door that
opens at a rank — but must never be a **multiplier**. A veteran and a newcomer in
the same ship still fly the same ship; the veteran is simply allowed places the
newcomer is not. The distinction is the whole invariant: a gate is content you
have not reached, a multiplier is a fight you cannot lose. The first thing to use
one is the berth at a pirate outpost (`shared/berth.js`), where rank stands for
whether the pirates have heard of you.

**What the invariant is actually about is MONEY, not time.** This section used to
read as though any earned power were forbidden, and it sent an agent designing a
quest reward down a rabbit hole trying not to give one. That is the wrong reading
and it cost real work. The rule is that **you cannot buy your way past somebody**:
no purchase strictly dominates, every technology gives something up, and credits
never turn into an unanswerable ship.

Time is not money here. A player who goes and kills a hundred Corsair Hives has
done something, and it is fine — good, in fact — for that to end in a reward with
real power in it. Grinding for an unlock is the genre working as intended; the
thing being prevented is a wallet, not an afternoon. So when you are weighing a
reward, ask *"could someone skip this with a credit card?"* rather than *"does
this make a veteran stronger?"* — the second question has the answer "yes, and
that is the point".

The rank-gate paragraph above still stands, because a RANK is a side effect of
playing at all rather than a thing you set out to earn. A quest is the opposite:
it names its price in kills up front and you choose to pay it.

---

## Rule six: comments say why, and name the bug

    // Move toward the target and STOP there. Nudging by a signed step instead
    // oscillates once you arrive — at full, `target > p[s]` is 1 > 1, which is
    // false, so it steps back down, climbs again, and the readout flickers
    // between 29% and 30% forever while quietly under-drawing the capacitor.

A comment restating the code is noise. A comment holding the reason a line is
shaped oddly is the only thing standing between the next person and reverting
it. Balance numbers get their working shown.

---

## Rule seven: degrade gracefully, and leave named seams

Content arrives later than the system for it. An empty `combat/` folder means
that deck never exists and the score carries on. No music at all means silence,
no errors. A mood with no folder borrows the nearest one that has music.

Leave a seam with a name — `LIVE_MOODS`, `ACTIONS`, `FALLBACK`, `ANYWHERE` — so
the next thing is a line of data rather than a refactor. Do not build the next
thing itself until it is asked for.

---

## Rule eight: the change ships with the note

`shared/patch.js` is the changelog the game shows about itself, top right. Every
change a player can notice gets a line in it, in the same commit that makes the
change — not afterwards, not in a batch.

This is enforced. `test/patch.mjs` compares the working tree against HEAD: if
anything under `server.js`, `store.js`, `config.js`, `shared/` or `public/` has
changed and `shared/patch.js` has not, `npm test` fails and names the files. A
clean tree passes, so it is safe in CI, and it clears the moment a note is
written. It exists because two batches shipped without a line and the deployed
game claimed nothing had happened.

Add the entry at the **top** and bump `VERSION` with it — the client draws
`VERSION` beside the icon, so the two drifting apart is visible immediately, and
a test asserts they match.

Notes are for players, not for reviewers. Two or three lines a version, each one
a thing somebody would notice while flying:

    'Generators raise the reactor ceiling by what they cost you in speed'

not "refactored boostOf to read stats.boost". The reasoning belongs in the commit
message; the changelog is what changed, from the cockpit. Keep them under about
90 characters — there is a test for that too, because a note nobody finishes
reading is the same as no note.

Versions are `0.<n>` and the minor climbs once per shipped batch. The game is
early; it is not on version 7.

---

## Working habits

- **Assert the anchor before writing.** Editing with `python .replace()` fails
  silently when the anchor has drifted, which has produced commits claiming
  fixes they do not contain. Assert `count == 1` first.
- **Never `git checkout` a file to undo an experiment.** Uncommitted work has
  been lost that way.
- **`| head` on a live server kills it** with SIGPIPE mid-verification.
- **Say what actually happened.** If a test fails, show the output. If something
  could not be reproduced, say so rather than claiming a fix. If part of a task
  was skipped, name it.
- Run `npm test` before every commit. It is fast and it has never been the
  slower option.

---

## Deploying, and getting the music there

Railway, one service, one instance — the world lives in memory, so it must never
be scaled past `numReplicas: 1`. Push to `main` and it rebuilds. A volume is
mounted at `/data`.

**No environment variables for paths.** `config.js` lists candidate directories
and the first that exists wins:

    DATA_DIRS  = ['/data', 'data']
    MUSIC_DIRS = ['/data/music', 'public/music']

So the same image runs from a checkout and from a mounted volume without being
told which it is. A path is a fact about the deployment, not a knob someone has
to remember to set in a dashboard, and an unset one fails silently and late —
the music simply absent, no error anywhere.

**The Dockerfile must not declare `VOLUME`.** Railway rejects the build outright:
`docker VOLUME at Line 17 is not supported, use Railway Volumes`. Mount the
volume on the service instead.

### Uploading the tracks

The tracks are gitignored — they are not in the image, so a fresh deploy has no
music until you put some on the volume. `railway volume files` does it, and four
things about it will waste your time:

- **Register an SSH key first.** Transfers run over SSH, and without one every
  command dies with `SSH authentication failed`:

      railway ssh keys add --key ~/.ssh/id_ed25519.pub --name "<machine>"

- **`--volume` goes before the subcommand**, not after: `railway volume files
  --volume nullpoint-volume list /`. Paths are relative to the volume root, so
  `/music` there is `/data/music` in the container.
- **`upload` nests when the destination already exists.** It behaves like `mv`:
  a missing remote path is created and the contents go into it, but an existing
  one gets the local directory placed *inside* it. `upload ./public/music /music`
  onto an existing `/music` silently produces `/data/music/music/ambient/...`,
  the scan finds no tracks, and nothing says so. Upload each mood folder to its
  own path, and check the tree afterwards:

      for d in ambient boss chase combat; do
        railway volume files --volume nullpoint-volume upload "./public/music/$d" "/music/$d"
      done
      railway volume files --volume nullpoint-volume list /music

- **Agents cannot delete volume files.** The CLI refuses and prints the command
  for a human to run. Plan uploads so nothing needs deleting.

**No redeploy is needed.** `musicDir()` resolves per call and `listMusic()`
rescans per request, so tracks uploaded to a running service appear immediately.
That is the whole point of the folder being the manifest. Verify from outside:

    curl -s https://<host>/music/list | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))'

A folder that is not a live mood — `boss/` — is listed but never drawn from, the
same as it is locally. Empty is fine: silence, no errors.

## Commit messages

Say what was wrong and why the fix is shaped the way it is, in prose. The
diff shows what changed; the message is for the person wondering why. Lead with
the problem, quote the numbers that prove it, and note anything that was
deliberately not done.
