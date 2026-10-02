# Genre to parts: checklists

For each genre: the parts to have, and the most common reason it does not sound like the genre. The full starter is in `genres/<id>.json`.

## Hardgroove (135 to 145)

Parts: `drums` (909 kick, clap), `hats`, `perc` (toms and rims), a quiet `bass`.
Wrong if: there is a melody carrying the track, or the percussion never changes. The groove must loop, with small variations every 4 bars.

```js
const perc = stack(
  s("rim(5,16,2)").gain(0.5),
  s("~ ~ lt ~ ~ mt ~ ~ ~ lt ~ ~ ht ~ mt ~").gain(0.45),
).bank("RolandTR909").lastOf(4, (x) => x.ply(2))
perc
```

## Peak-time techno (128 to 135)

Parts: `drums`, rolling `bass`, short `chords` stabs, a riff `lead`, a riser `fx`.
Wrong if: the bass plays on the kick. Put it between the kicks.

```js
const bass = note("[~ a1 a2 a1]*4").s("sawtooth").lpf(sine.range(300, 900).slow(16)).lpq(5)
  .decay(0.1).sustain(0).gain(0.5)
bass
```

## Minimal techno (122 to 128)

Parts: dry `drums` (808), `perc` shaker with perlin gain, a sine `bass`, one delayed stab.
Wrong if: too many layers at once. Remove before you add.

```js
s("sh*16").bank("RolandTR808").gain(perlin.range(0.1, 0.3)).pan(sine.range(0.3, 0.7).slow(4))
```

## Dub techno (115 to 125)

Parts: soft `drums`, sine `bass`, offbeat minor 9th `chords` with long delay and reverb, crackle `fx`.
Wrong if: the delay feedback is low or the filter is static. The tail is the sound.

```js
chord("<Cm9 Fm9>").voicing().struct("~ x ~ ~").s("sawtooth")
  .lpf(sine.range(500, 1600).slow(16)).decay(0.3).sustain(0)
  .delay(0.6).delaytime(0.375).delayfeedback(0.65).room(0.8).size(0.9).gain(0.28)
```

## Acid techno (130 to 145)

Parts: `drums`, a sub `bass`, the `acid` 303 line.
Wrong if: the resonance is under 10 or nothing moves the cutoff.

```js
note("a1 a1 a2 a1 c2 a1 [a2 a1] e2").s("sawtooth").lpf(sine.range(300, 2400).slow(8)).lpq(16)
  .decay(0.18).sustain(0).shape(0.3).gain(0.4)
```

## Melodic techno (120 to 126)

Parts: `drums`, rolling `bass` on chord roots, supersaw pad `chords`, an arp `lead`.
Wrong if: the arp ignores the chords. Derive both from the same `chord(...)` string.

```js
const prog = "<Dm Bb F C>"
const lead = chord(prog).voicing().arp("0 1 2 3 2 1 0 2").add(note(12)).s("triangle")
  .decay(0.2).sustain(0).delay(0.4).delaytime(0.36).gain(0.25)
lead
```

## Trance, Switch Angel style (136 to 142)

Parts: `drums`, offbeat `bass`, gated supersaw `chords`, 16th supersaw arp `lead`, a sustained `pad` for the breakdown, a `roll` and an `fx` riser for the build.
Wrong if: the chords are sustained during the drop (no gate) or the arp is slower than 16ths.

```js
s("sd*4").bank("RolandTR909").ply("<1 1 2 2 4 4 8 8>").gain(saw.range(0.2, 0.5).slow(8))
```

## Progressive house (120 to 126)

Parts: `drums`, a shaker `perc`, `bass`, offbeat 7th `chords`, a pluck `lead`.
Wrong if: sections change abruptly. Add one layer per 8 or 16 bars and filter over 32.

```js
chord("<Gm7 Eb^7 Bb^7 F>").voicing().struct("~ x ~ x ~ x ~ x").s("sawtooth")
  .lpf(sine.range(400, 2400).slow(32)).decay(0.3).sustain(0.1).room(0.6).gain(0.2)
```

## Breakbeat / jungle (160 to 175)

Parts: `drums` (chopped `brk` plus reinforcing kick and snare), a long sine `bass`, a dark pad `chords`.
Wrong if: the break plays straight through unchanged, or the bass moves as fast as the drums.

```js
s("brk").splice(16, "0 1 2 3 4 5 6 7 8 9 [10 10] 11 12 13 [14 3] 15").gain(0.7)
```

## Ambient (60 to 90)

Parts: pad `chords`, a slow `bass` drone, sparse `lead` bells, a noise `fx` bed. No kick.
Wrong if: anything is on a strict grid and loud. Use `degradeBy`, slow chord changes (`/2`), long attack and release.

```js
n("0 2 4 6 ~ 4 ~ ~").scale("D4:dorian").s("gm_music_box").degradeBy(0.4)
  .delay(0.5).delaytime(0.6).delayfeedback(0.6).room(0.8).gain(0.25)
```
