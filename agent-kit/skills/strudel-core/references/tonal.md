# Tonal: scales, chords, voicings, arps

From `@strudel/tonal` 1.2.6. The checker compares every pitched note against `song.json` key and scale, so tonal helpers are the easiest way to stay in key.

## scale

`n(...)` numbers become scale degrees. Root and octave come first, then the scale name, separated by colons. Multi-word scales use more colons.

| Write | Means |
|---|---|
| `"C3:minor"` | natural minor from C3 |
| `"A2:minor:pentatonic"` | minor pentatonic |
| `"D3:dorian"`, `"E3:phrygian"`, `"F3:lydian"`, `"G3:mixolydian"` | modes |
| `"C3:harmonic:minor"` | harmonic minor |
| `"<C3:minor F3:minor>"` | change scale per bar |

Degrees go below zero too: `-1` is the step under the root.

```js
n("0 2 4 <6 7> 4 2 0 -1").scale("C3:minor").s("triangle").decay(0.2).sustain(0).gain(0.35)
```

```js
n("0 1 2 3 4").scale("A2:minor:pentatonic").s("sawtooth").lpf(1200).decay(0.15).sustain(0).gain(0.35)
```

## chord + voicing

`chord("<Cm7 Fm7>")` sets chord symbols; `.voicing()` turns them into notes in a close voicing around the middle register. Symbols that work (tested):

- triads: `C`, `Cm`, `Co` (diminished; `Cdim` is silent)
- sevenths: `Cm7`, `C7`, `C^7` (major 7th), `Ch7` (half-diminished)
- extensions: `Cm9`, `Cm11`, `Cadd9`, `Csus` (C F G, a sus4)
- the ireal style with a minus also works: `C-7`

**Do not write** `Cmaj7`, `Csus4` or `Cdim`: they give zero events without an error. Use `C^7`, `Csus` and `Co`.

```js
chord("<Cm9 Fm9 Ab^7 Bb7>").voicing().s("gm_epiano1").gain(0.35)
```

Options: `.anchor("c5")` (the voicing stays near this note), `.mode("below")` (top note at or below the anchor), `.dict("ireal")` (the default dictionary), `.rootNotes(2)` (only the roots, in octave 2, good for a bass that follows the chords).

```js
const chords = chord("<Cm7 Ab^7 Eb^7 Bb7>").voicing().anchor("g4").mode("below").s("square")
  .struct("~ x ~ x").decay(0.2).sustain(0).gain(0.22)
const bass = chord("<Cm7 Ab^7 Eb^7 Bb7>").rootNotes(2).struct("[~ x]*4").s("sawtooth")
  .lpf(600).decay(0.15).sustain(0).gain(0.45)
stack(chords, bass)
```

## arp

`.arp("0 1 2 3")` picks voiced notes by index (wraps around). `.arpWith(f)` gets the array of haps and returns one.

```js
// a 16th trance arp an octave up, following the chords
chord("<Am F C G>").voicing().arp("<0 1 2 3>*16").add(note(12)).s("supersaw")
  .lpf(3000).decay(0.12).sustain(0).gain(0.2)
```

```js
note("<[c3,eb3,g3] [c3,f3,ab3]>").arpWith((h) => h[2]).s("triangle").gain(0.3)
```

## Transposition

`.transpose(n)` moves by semitones (can leave the key), `.scaleTranspose(n)` moves by scale steps (stays in key), `.add(note(12))` adds an octave.

```js
n("0 2 4").scale("C3:minor").scaleTranspose("<0 2 4 2>").s("triangle").decay(0.2).sustain(0).gain(0.3)
```
