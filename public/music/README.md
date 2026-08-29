# Music

Drop audio files in here and they become the playlist. Nothing else to edit —
the directory is the manifest, read fresh on every page load.

    public/music/whatever-you-called-it.mp3
    public/music/drifting.mp3

`.mp3`, `.ogg`, `.wav` and `.m4a` all work.

One level of subfolder is kept in the track name, so you can group them now and
have the game read a mood off them later:

    public/music/ambient/long-dark.mp3
    public/music/combat/hard-burn.mp3

Today everything plays as one shuffled playlist regardless of folder. Press N to
skip a track; V mutes the game including the music.

Nothing here is committed except this file — see .gitignore. Your tracks stay
yours and stay out of the repo. Deploying with music means either committing the
files deliberately or mounting them at `public/music` on the host.
