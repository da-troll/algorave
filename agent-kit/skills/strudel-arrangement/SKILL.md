---
name: strudel-arrangement
description: Song structure in arrange.js. Sections, energy curves, 8/16/32-bar phrasing, builds (filter sweeps, snare rolls with ply, noise risers), drops, breakdowns and transitions, all expressed with arrange([bars, stack(...)], ...) where one cycle is one bar. Use when the user asks for an intro, build, drop, breakdown, outro, a longer track, or says the song "goes nowhere".
---

# Strudel arrangement

## The model

`arrange.js` is one expression:

```js
const drums = s("bd*4, ~ cp ~ cp, [~ oh]*4").bank("RolandTR909")
const bass = note("[~ c2]*4").s("sawtooth").lpf(700).decay(0.15).sustain(0).gain(0.5)
const chords = chord("<Cm7 Ab^7>").voicing().struct("~ x ~ ~").s("square").decay(0.2).sustain(0).gain(0.25)
arrange(
  [8, stack(drums, chords)],
  [8, stack(drums, bass)],
  [16, stack(drums, bass, chords)],
)
```

- Each entry is `[bars, pattern]`. One cycle is one bar, so `[16, ...]` lasts 16 bars.
- Sections play in order, then the whole arrangement loops.
- `song.json` `sections` must list the same names and bar counts in the same order. The check prints both and flags a mismatch.
- Parts are defined in `parts/*.js`; `arrange.js` only combines them and applies section-level tweaks (`.mask`, `.lpf`, `.gain`). Put anything new and musical in a part file.
- The check analyses at most 64 bars. Keep the important sections within the first 64 if you want them checked.

## Phrasing

- Work in 8, 16 and 32 bars. Every change lands on a phrase boundary.
- Inside a section, mark the 4th or 8th bar: `.lastOf(4, (x) => x.ply(2))` on a percussion part, or a crash on the first bar of a phrase.
- A section is defined by what is missing as much as what plays.

## Energy curve

Plan the density before you write: the check reports events per bar for each section, so you can confirm the curve.

| Section | Energy | Typical content |
|---|---|---|
| intro | 2 to 4 of 10 | drums only, or drums plus one texture; DJ-friendly 16 or 32 bars |
| build | rising | add bass, open the filter, roll, riser, then remove the kick for the last bar |
| drop | 8 to 10 | everything, filter open |
| breakdown | 3 to 5 | no kick; pads, chords, the hook alone |
| outro | falling | mirror the intro so it mixes out |

## Builds

Three tools, usually together over 8 bars:

1. Filter sweep: `part.lpf(saw.range(400, 6000).slow(8))` in the build section.
2. Snare roll: `s("sd*4").ply("<1 1 2 2 4 4 8 8>")` doubles every two bars.
3. Riser: white noise with a rising high-pass and gain.

Then drop out the kick for the last bar: `drums.mask("<1 1 1 1 1 1 1 0>")`.

```js
const drums = s("bd*4, ~ cp ~ cp").bank("RolandTR909")
const chords = chord("<Cm7 Ab^7>").voicing().struct("~ x ~ x").s("sawtooth").decay(0.2).sustain(0).gain(0.22)
const roll = s("sd*4").bank("RolandTR909").ply("<1 1 2 2 4 4 8 8>").gain(saw.range(0.2, 0.5).slow(8))
const riser = s("white*16").hpf(saw.range(500, 9000).slow(8)).gain(saw.rangex(0.02, 0.14).slow(8)).decay(0.08).sustain(0)
arrange(
  [8, stack(drums.mask("<1 1 1 1 1 1 1 0>"), chords.lpf(saw.range(400, 6000).slow(8)), roll, riser)],
  [8, stack(drums, chords)],
)
```

`<...>` inside a section counts from the start of that section: `arrange` restarts each section's patterns at their own first cycle, so an 8-step `<1 1 2 2 4 4 8 8>` roll in an 8-bar build always starts at 1. (On the second loop of the whole song a section continues from its next cycle; with 8-step patterns in 8-bar sections that lands back on step 1.) Verified against @strudel/core 1.2.6.

## Drops

The drop is the build's resolution: everything returns at once on bar 1 of the section. Make the contrast bigger by thinning the bar before it (no kick, filter closed, or silence for a beat).

## Breakdowns

Take the kick and bass out. Give the harmony room: longer release, more reverb, the lead filtered down.

```js
const chords = chord("<Am F C G>").voicing().s("supersaw").attack(0.5).release(1.5).gain(0.16)
const lead = chord("<Am F C G>").voicing().arp("<0 1 2 3>*16").add(note(12)).s("supersaw").decay(0.12).sustain(0).gain(0.16)
arrange(
  [8, stack(chords.room(0.9).size(0.9), lead.lpf(1200))],
)
```

## Transitions

- Mute for one bar: `part.mask("<1 1 1 0>")` on a 4-bar cycle.
- Fill on the last bar of a phrase: `.lastOf(8, (x) => x.ply(2))`.
- Crash on the downbeat of the new section: a `fx` part like `s("<cr ~ ~ ~ ~ ~ ~ ~>")`.
- Filter the outgoing section down while the next one starts open.

## References

- `references/builds-and-drops.md`: full section templates (16/32-bar techno, trance with breakdown, ambient arc) and transition recipes.
