# Music

Drop audio files in here and they become the playlist. Nothing else to edit —
the directory is the manifest, read fresh on every page load.

    public/music/Silent Orbit.mp3
    public/music/Deep Space Drift.mp3

`.mp3`, `.ogg`, `.wav` and `.m4a` all work.

## Parking a track

One level of subfolder is the track's *mood*, and only the moods the game has a
system for are in the shuffle. Today those are loose files and `ambient/`.

    public/music/Silent Orbit.mp3        the score you fly to
    public/music/ambient/long-dark.mp3   the same deck
    public/music/chase/long-way-home.mp3 something is on you and you are running
    public/music/combat/hard-burn.mp3    you are shooting back
    public/music/boss/Iron Pulse.mp3     parked — there is no boss yet

A parked track stays exactly where it is, keeps working as a file, and simply
never comes up. When there is a boss to play it at, `LIVE_MOODS` in
`shared/music.js` grows by one word and it starts playing. The console says what
is on each deck on every load.

## The decks

    calm     nothing is happening
    chase    something has locked onto you and you have not fired back
    combat   you are engaging something

Whichever was last active is held for seven seconds after the last shot, so a
lull between passes does not throw you back to the score, and the change is a
2.2 second crossfade rather than a cut. Every switch draws a fresh track.

A mood with an empty folder borrows the nearest one that has music: with no
`chase/`, being hunted plays combat; with neither, it plays the score. So you
can fill them in any order.

## Controls

`N` skips a track, `[` and `]` set the level, `V` mutes the game including
the music.

## The repo

Nothing here is committed except this file — see `.gitignore`. Your tracks stay
yours and stay out of the repo. Deploying with music means either committing
them deliberately or mounting a folder at `public/music` on the host.
