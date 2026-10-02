# Sound recipes

Each block is a complete snippet that passes `strudel_check` in C minor. Swap notes to fit the song's key.

## Kicks

A sampled kick is usually best. Layer a sine sub under it for weight.

```js
stack(
  s("bd*4").bank("RolandTR909").gain(0.9),
  note("c1*4").s("sine").decay(0.25).sustain(0).penv(12).pdecay(0.04).gain(0.5),
)
```

Distorted, rumbling kick (hard techno):

```js
stack(
  s("bd*4").bank("RolandTR909").shape(0.5).gain(0.85),
  note("c1*4").s("sine").late(0.06).decay(0.3).sustain(0).lpf(120).room(0.3).gain(0.4),
)
```

## Basses

Offbeat pluck (house, techno):

```js
note("[~ c2]*4").s("sawtooth").lpf(600).lpq(4).decay(0.15).sustain(0).gain(0.5)
```

Rolling 16ths with a filter envelope:

```js
note("[~ c2 c2 c2]*4").s("sawtooth").lpf(200).lpenv(3).lpdecay(0.08).lpsustain(0).decay(0.1).sustain(0).gain(0.45)
```

Sub bass (jungle, dub, ambient): sine, long notes, nothing above 200 Hz.

```js
note("<c1 c1 ab0 bb0>").struct("x ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~").s("sine").decay(0.6).sustain(0.4).gain(0.7)
```

Acid (303): saw, high resonance, moving cutoff, a little shape.

```js
note("c2 c2 c3 c2 eb2 c2 [c3 c2] g2").fast(2).s("sawtooth")
  .lpf(perlin.range(300, 2500).slow(4)).lpq(16).decay(0.15).sustain(0).shape(0.3).gain(0.38)
```

## Chords and stabs

Techno stab: square or saw, short, offbeat, a bit of room.

```js
chord("<Cm7 Ab^7>").voicing().struct("~ x ~ ~ ~ x ~ ~").s("square").lpf(1400).decay(0.2).sustain(0).room(0.4).gain(0.25)
```

Dub stab: see strudel-core effects; long delay feedback and room.

Gated supersaw (trance gate):

```js
chord("<Cm Ab Eb Bb>").voicing().s("supersaw").struct("x x ~ x x ~ x ~ x x ~ x x ~ x x")
  .decay(0.1).sustain(0).lpf(2800).gain(0.18)
```

## Pads

```js
chord("<Cm9 Fm9>/2").voicing().s("supersaw").unison(5).detune(0.25).spread(0.8)
  .attack(0.8).release(2).lpf(1400).hpf(200).room(0.7).size(0.9).gain(0.16)
```

Soundfont pad (warmer, cheaper):

```js
chord("<Cm9 Ab^7>/2").voicing().s("gm_pad_warm").attack(0.5).release(2).room(0.6).gain(0.3)
```

## Plucks and leads

```js
n("0 2 4 7 4 2 0 -1").scale("C4:minor").s("triangle").decay(0.15).sustain(0)
  .delay(0.35).delaytime(0.352).delayfeedback(0.45).gain(0.28)
```

FM bell:

```js
n("<0 4> ~ 7 ~").scale("C5:minor").s("sine").fm(4).fmh(3).fmdecay(0.4).decay(0.6).sustain(0).room(0.6).gain(0.25)
```

## Noise: hats, risers, texture

Synthetic hats from white noise:

```js
s("white*16").hpf(8000).decay(0.03).sustain(0).gain("[0.12 0.2]*8")
```

Riser over 8 bars:

```js
s("white*16").hpf(saw.range(500, 9000).slow(8)).gain(saw.rangex(0.02, 0.15).slow(8)).decay(0.08).sustain(0)
```

Texture bed:

```js
stack(
  s("crackle").hpf(2000).gain(0.08),
  s("pink").lpf(sine.range(300, 1200).slow(16)).gain(0.04),
)
```

## Layering

Layer for a reason: one layer per frequency band or per role (attack, body, tail). Two sounds doing the same job in the same band only make it louder and muddier.

```js
// bass: a sine sub for weight plus a filtered saw for bite, the saw high-passed out of the sub's band
stack(
  note("[~ c1]*4").s("sine").decay(0.2).sustain(0).gain(0.45),
  note("[~ c2]*4").s("sawtooth").hpf(150).lpf(1200).decay(0.12).sustain(0).gain(0.25),
)
```

## Clipping checklist

1. Sum the gains of everything that hits on the downbeat. Above about 2.5 in total is asking for clipping.
2. Lower supersaw and chord parts first: they are many voices each.
3. High-pass everything that is not kick or bass.
4. Duck the bass under the kick (`duckorbit`) instead of turning both down.
