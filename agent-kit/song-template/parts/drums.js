// Kick on every beat, offbeat open hats, clap on 2 and 4.
const drums = stack(
  s("bd*4").gain(1),
  s("~ oh ~ oh ~ oh ~ oh").gain(0.5),
  s("~ cp ~ cp").gain(0.7),
).bank("RolandTR909")
