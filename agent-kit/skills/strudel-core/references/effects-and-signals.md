# Effects and signals

Every name here exists in `@strudel/core` 1.2.6 `controls.mjs` or `signal.mjs`. Effects take a number or a pattern ("200 800") or a signal.

## Filters

| Control | Range that sounds good | Notes |
|---|---|---|
| `lpf` (alias `cutoff`, `lp`) | 200 to 8000 Hz | low-pass; `lpf("800:10")` sets cutoff and resonance together |
| `lpq` (alias `resonance`) | 0 to 20 | above 12 gets squelchy (acid) |
| `hpf` | 50 to 2000 Hz | clear low end from pads and chords |
| `hpq` | 0 to 10 | |
| `bpf` + `bpq` | 300 to 4000 Hz | band-pass, telephone and whistle sounds |
| `ftype` | 'ladder', '12db', '24db' | filter model; single quotes because it is a plain string |
| `vowel` | "a e i o u" | formant filter |

```js
// acid: resonant low-pass sweeping over 8 bars
note("a1 a1 a2 a1 c2 a1 e2 a1").s("sawtooth").lpf(sine.range(300, 2400).slow(8)).lpq(16)
  .decay(0.15).sustain(0).gain(0.4)
```

## Filter envelope

`lpenv` sets how far the envelope opens the filter (in octaves, negative closes), with `lpattack`, `lpdecay`, `lpsustain`, `lprelease`. Same for `hpenv` and friends.

```js
note("c2*8").s("sawtooth").lpf(300).lpenv(4).lpattack(0.005).lpdecay(0.15).lpsustain(0)
  .decay(0.2).sustain(0).gain(0.45)
```

## Space

- `room` (0 to 1, reverb send) and `size` (alias `roomsize`, 0 to 1).
- `delay` (send 0 to 1), `delaytime` (seconds), `delayfeedback` (0 to 0.9; above 0.9 runs away).
- Delay times at common tempos (seconds): 8th = 30 / bpm, dotted 8th = 45 / bpm, 16th = 15 / bpm. At 128 bpm: 0.234, 0.352, 0.117.

```js
// dub stab: short note, long space
chord("Cm9").voicing().struct("~ x ~ ~").s("sawtooth").lpf(1200).decay(0.25).sustain(0)
  .delay(0.6).delaytime(0.352).delayfeedback(0.65).room(0.8).size(0.9).gain(0.25)
```

## Dirt and level

- `crush` (bits: 16 clean, 4 dirty), `coarse` (sample-rate reduction, 1 to 32).
- `shape` (0 to 1, waveshaper), `distort` (0 to 1 and up, louder).
- `gain` (per event, before effects; 0 to 1 typical), `postgain` (after effects), `velocity` (0 to 1).
- `pan` (0 left, 0.5 centre, 1 right).

```js
stack(
  s("bd*4").bank("RolandTR909").shape(0.4).gain(0.9),
  s("hh*16").bank("RolandTR909").crush(6).pan(sine.range(0.2, 0.8).slow(2)).gain(0.3),
)
```

## Orbits and sidechain

Each `orbit` is its own effect bus (reverb and delay are per orbit). `duckorbit(n)` (alias `duck`) on a trigger pattern lowers the volume of everything on orbit n each time it plays. Tune with `duckattack` (seconds to come back up), `duckdepth` (0 to 1) and `duckonset` (seconds to duck; 0 clicks, 0.01 is smooth).

```js
// kick on orbit 1 ducks the bass on orbit 2
stack(
  s("bd*4").bank("RolandTR909").duckorbit(2).duckattack(0.15).duckdepth(0.8).duckonset(0.01),
  note("c2*16").s("sawtooth").lpf(500).orbit(2).gain(0.5),
)
```

## Signals

| Signal | Shape |
|---|---|
| `sine`, `cosine` | smooth up and down |
| `saw` / `isaw` | ramp up / ramp down |
| `tri` | triangle |
| `square` | on/off |
| `perlin` | smooth random |
| `rand` | random per query |
| `irand(n)` | random integer 0 to n-1 |

Methods: `.range(lo, hi)`, `.rangex(lo, hi)` (exponential, better for frequencies and gain), `.slow(n)` (one sweep over n bars), `.segment(n)` (sample n times per cycle), `.round()`.

```js
// a riser: saw on the high-pass over 8 bars, gain rising too
s("white*16").hpf(saw.range(500, 9000).slow(8)).gain(saw.rangex(0.02, 0.15).slow(8)).decay(0.08).sustain(0)
```

```js
// random but in key: perlin picks scale degrees, segmented to 8ths
n(perlin.range(0, 7).segment(8).round()).scale("C3:minor").s("triangle").decay(0.2).sustain(0).gain(0.3)
```
