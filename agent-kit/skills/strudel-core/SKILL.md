---
name: strudel-core
description: Strudel syntax for this song repo. Mini-notation (~ * / <> [] , ! @ ? and euclid (3,8)), the core pattern functions (s, note, n, stack, cat, seq, arrange, fast, slow, every, sometimes, jux, off, ply, chop, struct, mask, euclid), signals (sine, saw, perlin, range, segment), effects (filters, reverb, delay, distortion, gain, pan, orbit, duck sidechain) and tonal helpers (scale, chord, voicing, arp). Use before writing or changing any part file, and whenever a strudel_check error is about syntax or a function.
---

# Strudel core

Verified against the installed packages: `@strudel/core` 1.2.6, `@strudel/mini` 1.2.6, `@strudel/tonal` 1.2.6. If something is not in this skill or its references, assume it does not exist here and run `mcp__ears__strudel_check` before relying on it.

## The one rule that bites everyone: quotes

- `"double quotes"` and `` `backticks` `` are **mini-notation**: `"bd sd"` is two steps.
- `'single quotes'` are a **plain JS string**: `s('bd sd')` asks for one sample literally called `bd sd`, and the check reports it as an unknown sound.

Use double quotes for anything rhythmic or melodic. Use single quotes only for plain values you do not want parsed, such as a filter type name.

```js
// two steps per bar: bd then sd
s("bd sd").bank("RolandTR909")
```

## Time in this app

One cycle is one bar. The tempo comes from `song.json` (`bpm`), and the compiler calls `setcpm` for you. Never call `setcpm` or `setcps` in a part.

## Mini-notation in one block

| Symbol | Meaning | Example |
|---|---|---|
| space | steps share the cycle equally | `"bd sd hh cp"` |
| `~` | rest | `"bd ~ sd ~"` |
| `*n` | repeat the step n times in its slot | `"hh*8"` |
| `/n` | slow the step down over n cycles | `"<c2 eb2>/2"` |
| `[ ]` | subdivide one step | `"bd [sd sd]"` |
| `< >` | one item per cycle (alternate) | `"<c2 g1 bb1>"` |
| `,` | play at the same time (inside `[ ]` or at top level) | `"[bd, hh*4]"` |
| `!` | repeat the previous step as a new step | `"bd!3 sd"` |
| `@n` | make the step n units long | `"c3@3 eb3"` |
| `?` | 50 percent chance to drop the step | `"hh*8?"` |
| `(k,n,r)` | euclidean: k hits over n steps, rotated r | `"bd(3,8,2)"` |
| `:` | sample variant or a second value | `"bd:3"`, `"C4:minor"` |

```js
// every symbol at once: a groove, a polyrhythm and a euclid rim
const drums = stack(
  s("bd ~ [~ bd] ~, ~ cp"),
  s("hh*8?").gain(0.4),
  s("rim(3,8,2)").gain(0.4),
  s("<oh ~> ~ oh@2 ~").gain(0.3),
).bank("RolandTR909")
drums
```

## Building blocks

- Sound: `s("bd")` picks a sample or synth, `.bank("RolandTR909")` chooses the drum machine, `n("0 2")` picks a sample variant or a scale degree.
- Pitch: `note("c3 eb3")` or `note("48 51")`; `n("0 2 4").scale("C3:minor")` for scale degrees.
- Combining: `stack(a, b)` plays together, `cat(a, b)` one per cycle, `seq(a, b)` both squeezed into one cycle, `arrange([8, a], [16, b])` sections in bars.
- Time: `.fast(2)`, `.slow(2)`, `.ply(2)` (repeat each event), `.off(1/8, f)` (delayed copy), `.swingBy(1/6, 4)`.
- Variation: `.every(4, f)` (alias of `firstOf`), `.lastOf(4, f)`, `.sometimes(f)`, `.sometimesBy(0.3, f)`, `.degradeBy(0.2)`, `.jux(rev)`.
- Rhythm from shape: `.struct("x ~ x x")`, `.mask("1 0 1 1")`, `.euclid(3, 8)`.

```js
// a bass that plays a variation every 4th bar and a ghost copy an 8th later
const bass = note("<c2 c2 eb2 g1>*4").s("sawtooth")
  .lastOf(4, (x) => x.ply(2))
  .off(1/8, (x) => x.add(note(12)).gain(0.2))
  .lpf(900).decay(0.15).sustain(0).gain(0.5)
bass
```

## Signals

`sine`, `cosine`, `saw`, `isaw`, `tri`, `square`, `perlin` (smooth noise), `rand` and `irand(n)` are continuous patterns from 0 to 1. Shape them with `.range(lo, hi)` (or `.rangex` for exponential), slow them with `.slow(8)`, and turn them into discrete steps with `.segment(16)`.

```js
// filter sweeps over 8 bars, the hats wander in the stereo field
stack(
  note("c2*8").s("sawtooth").lpf(sine.range(300, 2000).slow(8)).lpq(8).decay(0.12).sustain(0).gain(0.45),
  s("hh*16").bank("RolandTR909").pan(perlin.range(0.2, 0.8)).gain(0.3),
)
```

## Effects you will use most

`lpf`/`hpf` (cutoff Hz) with `lpq`/`hpq` (resonance), `room` + `size`, `delay` + `delaytime` (seconds) + `delayfeedback`, `crush` (bits, lower is dirtier), `coarse`, `shape`, `distort`, `gain`, `postgain`, `pan` (0 left, 1 right), `orbit` (effect bus), and the sidechain `duckorbit` (alias `duck`) with `duckattack`, `duckdepth`, `duckonset`.

```js
// the kick ducks everything on orbit 2 (the pad), a built-in sidechain
stack(
  s("bd*4").bank("RolandTR909").duckorbit(2).duckattack(0.2).duckdepth(0.8),
  chord("<Cm9 Fm9>").voicing().s("supersaw").orbit(2).lpf(1800).room(0.5).gain(0.2),
)
```

## Tonal

`scale("C3:minor")` maps `n` numbers to notes. `chord("<Cm7 Ab^7>").voicing()` turns chord symbols into voiced notes. `.arp("0 1 2 1")` plays the voiced notes by index. Write a major 7th as `^7`, not `maj7`, and sus4 as `sus`: unknown symbols do not error, they go silent.

```js
const chords = chord("<Cm7 Cm7 Ab^7 Bb7>").voicing().s("square").struct("~ x ~ x").decay(0.2).sustain(0).gain(0.25)
const arp = chord("<Cm7 Cm7 Ab^7 Bb7>").voicing().arp("0 1 2 3 2 1 2 3").add(note(12)).s("triangle").decay(0.15).sustain(0).gain(0.25)
stack(chords, arp)
```

## Silent failures (no error, no sound)

These pass evaluation but produce nothing. If a part shows 0 events in the check, look here first.

- Unknown chord symbol: `"Abmaj7"`, `"Csus4"`, `"Cdim"` give 0 events. Use `Ab^7`, `Csus`, `Co`.
- Unknown scale name: `"C:minor_pentatonic"` gives 0 events. Write multi-word scales with colons: `"C3:minor:pentatonic"`.
- A space inside a double-quoted scale name splits it into two steps: `"C3:minor pentatonic"` is wrong.
- Single-quoted sound names (see the quotes rule above).
- `note(perlin.range(36, 48))` is chromatic and fails the key check; use `n(perlin.range(0, 7).segment(8)).scale("C2:minor")`.

## References

- `references/mini-notation.md`: every symbol with worked examples.
- `references/functions.md`: the pattern functions, grouped, with examples.
- `references/effects-and-signals.md`: every effect and signal with ranges that sound good.
- `references/tonal.md`: scales, chord symbols that work, voicing options, arps.
