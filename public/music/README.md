# Music

Drop audio files in here and they become the playlist. Nothing else to edit —
the directory is the manifest, read fresh on every page load.

    public/music/Silent Orbit.mp3
    public/music/Deep Space Drift.mp3

`.mp3`, `.ogg`, `.wav` and `.m4a` all work.

## Parking a track

One level of subfolder is the track's *mood*, and only the moods the game has a
system for are in the shuffle. Today those are loose files and `ambient/`.

    public/music/Silent Orbit.mp3       plays
    public/music/ambient/long-dark.mp3  plays
    public/music/boss/Iron Pulse.mp3    parked — there is no boss yet
    public/music/combat/hard-burn.mp3   parked — no combat switching yet

A parked track stays exactly where it is, keeps working as a file, and simply
never comes up between two ambient ones. When there is a boss to play it at,
`LIVE_MOODS` in `shared/music.js` grows by one word and it starts playing. The
console says how many are parked and why on every load.

## Controls

`N` skips a track, `[` and `]` set the level, `V` mutes the game including
the music.

## The repo

Nothing here is committed except this file — see `.gitignore`. Your tracks stay
yours and stay out of the repo. Deploying with music means either committing
them deliberately or mounting a folder at `public/music` on the host.
