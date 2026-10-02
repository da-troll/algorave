// Dark minor stabs on the offbeat.
const chords = chord("<Cm Cm Ab Bb>").voicing().struct("~ x ~ ~").s("square")
  .lpf(1200).decay(0.2).sustain(0).room(0.4).gain(0.35)
