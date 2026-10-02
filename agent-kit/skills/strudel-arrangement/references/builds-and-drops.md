# Arrangement templates and transition recipes

Every block is a complete arrange.js (with the parts declared first so it checks on its own). In a real song the `const` lines live in `parts/*.js`.

## Club techno, 64 bars

intro 16, build 8, drop 16, break 8, drop2 16. `song.json` sections: `intro:16 build:8 drop:16 break:8 drop2:16`.

```js
const drums = stack(s("bd*4"), s("~ cp ~ cp").gain(0.55), s("[~ oh]*4").gain(0.4), s("hh*16").gain(0.2)).bank("RolandTR909")
const bass = note("[~ c2 c2 c2]*4").s("sawtooth").lpf(sine.range(300, 900).slow(16)).decay(0.1).sustain(0).gain(0.45)
const chords = chord("<Cm7 Cm7 Ab^7 Bb7>").voicing().struct("~ ~ x ~ ~ ~ x ~").s("sawtooth").lpf(1800).decay(0.25).sustain(0).gain(0.25)
const roll = s("sd*4").bank("RolandTR909").ply("<1 1 2 2 4 4 8 8>").gain(0.4)
const fx = s("white*16").hpf(saw.range(500, 9000).slow(8)).gain(saw.rangex(0.02, 0.14).slow(8)).decay(0.08).sustain(0)
arrange(
  [16, stack(drums, bass.mask("<0 1>/8"))],
  [8, stack(drums.mask("<1 1 1 1 1 1 1 0>"), bass, chords.lpf(saw.range(400, 4000).slow(8)), roll, fx)],
  [16, stack(drums, bass, chords)],
  [8, stack(chords.room(0.8), fx)],
  [16, stack(drums, bass, chords)],
)
```

## Trance with a breakdown, 56 bars

intro 16, breakdown 8, build 8, drop 16, outro 8. The pad carries the breakdown; the gated chords and the arp carry the drop.

```js
const drums = stack(s("bd*4"), s("[~ oh]*4").gain(0.45), s("~ cp ~ cp").gain(0.5)).bank("RolandTR909")
const bass = note("<a1 f1 c2 g1>").struct("[~ x]*4").s("sawtooth").lpf(700).decay(0.15).sustain(0).gain(0.45)
const pad = chord("<Am F C G>").voicing().s("supersaw").attack(0.5).release(1.5).room(0.9).gain(0.16)
const chords = chord("<Am F C G>").voicing().s("supersaw").struct("x x ~ x x ~ x ~ x x ~ x x ~ x x").decay(0.1).sustain(0).gain(0.2)
const lead = chord("<Am F C G>").voicing().arp("<0 1 2 3>*16").add(note(12)).s("supersaw").decay(0.12).sustain(0).gain(0.18)
const roll = s("sd*4").bank("RolandTR909").ply("<1 1 2 2 4 4 8 8>").gain(0.4)
arrange(
  [16, stack(drums, bass)],
  [8, stack(pad, lead.lpf(1200))],
  [8, stack(chords, lead.lpf(2500), roll)],
  [16, stack(drums, bass, chords, lead)],
  [8, stack(drums, bass, pad)],
)
```

## Ambient arc, 32 bars

No drums. Energy comes from layers and filter, not density.

```js
const chords = chord("<Dm9 G Em7 F^7>/2").voicing().s("gm_pad_warm").attack(1).release(2).room(0.9).gain(0.3)
const bass = note("<d2 d2 g1 a1>/2").s("sine").attack(0.5).release(2).gain(0.35)
const lead = n("0 2 4 6 ~ 4 ~ ~").scale("D4:dorian").s("gm_music_box").degradeBy(0.4).delay(0.5).delaytime(0.6).gain(0.25)
arrange(
  [8, chords.lpf(800)],
  [16, stack(chords, bass, lead)],
  [8, stack(chords.lpf(900), lead.slow(2))],
)
```

## Transition recipes

Kick out for the last bar of an 8-bar phrase, and a crash on the first bar of the next:

```js
const drums = s("bd*4, ~ cp ~ cp").bank("RolandTR909")
const fx = s("<cr ~ ~ ~ ~ ~ ~ ~>").bank("RolandTR909").gain(0.3)
stack(drums.mask("<1 1 1 1 1 1 1 0>"), fx)
```

Fill on the last bar of every 4:

```js
s("~ ~ lt ~ ~ mt ~ ~ ~ lt ~ ~ ht ~ mt ~").bank("RolandTR909").lastOf(4, (x) => x.ply(2)).gain(0.45)
```

Filter close over a section (outgoing), with a sine shape so it breathes rather than ramps:

```js
note("[~ c2 c2 c2]*4").s("sawtooth").lpf(isaw.range(200, 2000).slow(8)).decay(0.1).sustain(0).gain(0.45)
```

Half-time feel for a breakdown: slow the drums by 2 and drop the hats:

```js
const drums = s("bd ~ ~ ~, ~ ~ cp ~").bank("RolandTR909")
drums.slow(2)
```
