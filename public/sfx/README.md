# Sound effects

Drop audio files here and the game uses them instead of its built-in synthesis.
Nothing is required — if a file is missing, the synthesised version plays.

    laser.mp3          your guns
    laser-enemy.mp3    hostile guns   (falls back to laser.mp3, pitched lower)
    explosion.mp3      a ship or an alien coming apart

`.mp3`, `.ogg`, `.wav` and `.m4a` all work.

Pitch and level live in `SFX` at the top of `public/audio.js`. `rate` below 1
plays the file slower and therefore deeper, which is usually what a stock laser
effect needs to sit under a dark score:

    laser:  rate 0.75
    enemy:  rate 0.60
    boom:   rate 0.85

Reload the page after adding or changing a file.
