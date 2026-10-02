// One cycle is one bar (song.json bpm). Sections match song.json.
arrange(
  [8, stack(drums.mask("<0 1>/4"), fx)],   // intro
  [8, stack(drums, bass, chords)],          // build
  [16, stack(drums, bass, chords, lead)],   // drop
)
