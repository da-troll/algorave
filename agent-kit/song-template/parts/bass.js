// Rolling offbeat bass on the root, filter opening slowly.
const bass = note("~ c2 ~ c2 ~ c2 ~ eb2").s("sawtooth")
  .lpf(sine.range(400, 1600).slow(8)).lpq(6)
  .decay(0.15).sustain(0).gain(0.6)
