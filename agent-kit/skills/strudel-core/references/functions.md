# Pattern functions

All of these exist in `@strudel/core` 1.2.6 and pass `strudel_check`. Functions taking a function argument use arrow functions: `(x) => x.fast(2)`.

## Sources

| Function | What it does |
|---|---|
| `s("bd sd")` | sample or synth name per step |
| `note("c3 eb3")` | pitch by name or MIDI number |
| `n("0 2 4")` | sample variant, or scale degree when followed by `.scale()` |
| `silence` | nothing (useful in arrange) |
| `run(8)` | the numbers 0 to 7 as 8 steps |
| `irand(8)` | random integers 0 to 7 (use with `.segment`) |

```js
// scale degrees from run(), one octave of C minor
n(run(8)).scale("C3:minor").s("triangle").decay(0.2).sustain(0).gain(0.35)
```

## Combining patterns

- `stack(a, b, ...)`: all at once.
- `cat(a, b, ...)`: one pattern per cycle, in turn.
- `seq(a, b, ...)`: all squeezed into one cycle, one after another.
- `arrange([bars, pattern], ...)`: song sections. One cycle is one bar.

```js
const a = s("bd*4").bank("RolandTR909")
const b = s("bd*2 [~ bd] bd").bank("RolandTR909")
stack(
  cat(a, b),
  seq(s("~ cp"), s("~ cp*2")).bank("RolandTR909").gain(0.5),
)
```

```js
const drums = s("bd*4, ~ cp").bank("RolandTR909")
const bass = note("[~ c2]*4").s("sawtooth").lpf(600).decay(0.15).sustain(0).gain(0.5)
arrange(
  [4, drums],
  [4, stack(drums, bass)],
)
```

## Speed and repetition

- `.fast(n)` / `.slow(n)`: play faster or slower.
- `.hurry(n)`: faster and higher pitched (speed too).
- `.ply(n)`: repeat each event n times in its own slot. `ply("<1 2 4 8>")` is the classic snare roll.
- `.chop(n)`: cut each event (or sample) into n pieces.
- `.echo(times, time, feedback)`: rhythmic echoes as new events.
- `.off(time, f)`: add a copy shifted by `time` cycles, transformed by `f`.

```js
// snare roll that doubles every bar
s("sd*4").bank("RolandTR909").ply("<1 2 4 8>").gain(0.45)
```

```js
// an offset copy a 16th later, an octave up and quieter
note("c3 ~ eb3 ~ g3 ~ bb3 ~").s("triangle").decay(0.15).sustain(0)
  .off(1/16, (x) => x.add(note(12)).gain(0.15)).gain(0.35)
```

## Conditional and random variation

- `.every(n, f)` (same as `.firstOf`): apply f on the first of every n cycles.
- `.lastOf(n, f)`: apply f on the last of every n cycles (fills at the end of a phrase).
- `.when("<1 0>", f)`: apply where the boolean pattern is true.
- `.sometimes(f)`, `.often(f)`, `.rarely(f)`, `.sometimesBy(p, f)`: random per event.
- `.degradeBy(p)`: drop events with probability p.
- `.chunk(n, f)`: apply f to one nth of the cycle, moving each cycle.
- `.iter(n)`, `.palindrome()`, `.rev()`: reorder.
- `.jux(f)`: original on the left, f applied on the right.
- `.superimpose(f)`, `.layer(f, g)`: add transformed copies.

```js
// fill on the last bar of every 4, random ghost hats, stereo variation
stack(
  s("bd ~ ~ bd ~ ~ bd ~").lastOf(4, (x) => x.ply(2)),
  s("hh*16").sometimesBy(0.3, (x) => x.gain(0.12)).gain(0.3),
  s("~ cp").jux(rev).gain(0.5),
).bank("RolandTR909")
```

## Rhythm from structure

- `.struct("x ~ x x")`: impose a rhythm on a value (chords, notes).
- `.mask("1 0 1 1")`: keep events only where the mask is 1. `mask("<0 1>/4")` mutes for 4 bars, then plays 4.
- `.euclid(k, n)`, `.euclidRot(k, n, r)`, `.euclidLegato(k, n)`.
- `.beat("0,4,8,11", 16)`: hits on the listed 16th positions.
- `.swingBy(amount, n)`, `.swing(n)`: shuffle.

```js
stack(
  s("bd").beat("0,4,8,11,14", 16),
  s("hh*8").swingBy(1/6, 4).gain(0.35),
  s("rim").euclidRot(3, 8, 2).gain(0.4),
).bank("RolandTR909")
```

```js
// chord rhythm with struct, muted every other 2 bars with mask
chord("<Cm7 Fm7>").voicing().struct("~ x ~ x ~ ~ x ~").s("square")
  .decay(0.2).sustain(0).gain(0.25).mask("<1 1 0 0>")
```

## Sample slicing

`brk` is a breakbeat sample. `.splice(n, pattern)` slices it into n parts and plays the slices in the given order, fitted to the step length. `.slice` does the same without fitting, `.striate(n)` interleaves, `.loopAt(n)` stretches a sample over n cycles, `.fit()` fits it to its event.

```js
// a resequenced break with a stutter on slice 10
s("brk").splice(16, "0 1 2 3 4 5 6 7 8 9 [10 10] 11 12 13 [14 3] 15").gain(0.7)
```

```js
s("brk").loopAt(2).chop(16).gain(0.7)
```

## Arithmetic on values

`.add(note(12))` transposes up an octave, `.sub`, `.mul`, `.transpose(2)` in semitones, `.scaleTranspose(1)` one scale step.

```js
n("0 2 4 2").scale("C3:minor").scaleTranspose("<0 1 2 1>").s("triangle").decay(0.2).sustain(0).gain(0.3)
```
