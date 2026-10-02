// Noise riser across 8 bars.
const fx = s("white").hpf(saw.range(500, 8000).slow(8)).decay(0.5).sustain(0).gain(0.12)
