---
name: strudel-genres
description: Style targets for this song repo. How to read the genre cards (hardgroove, peak-time techno, minimal, dub techno, acid, melodic techno, trance, progressive house, breakbeat/jungle, ambient) and turn a genre into concrete Strudel parts, tempo, key and arrangement. Use when Daniel names a genre, an artist, or asks for something to sound "more like" a style.
---

# Strudel genres

The genre cards are JSON files, one per genre, shared with the app's Genre Explorer:

```
.claude/skills/strudel-genres/references/genres/<id>.json
```

Ids: `hardgroove`, `peak-time-techno`, `minimal-techno`, `dub-techno`, `acid-techno`, `melodic-techno`, `trance`, `progressive-house`, `breakbeat-jungle`, `ambient`. Glob the folder: there may be more.

## What a card contains

| Field | Use it for |
|---|---|
| `bpm_range` | set `song.json` bpm inside this range |
| `key_tendency` | which key, scale and chord colours fit |
| `signature` | 4 to 6 idioms: the checklist your parts must hit |
| `listen_for` | what Daniel should hear; reuse it in your closing note |
| `artists_reference` | vocabulary only; never imitate a specific track |
| `starter` | a complete, checked song: `bpm`, `key`, `scale`, `sections`, `parts` (one `const <name> = ...` per part), `arrange` |

## Workflow: genre to parts

1. Read the card. Read `song.json`.
2. Tempo and key: if the song is new or Daniel asked for the genre, set `bpm` from the starter (inside `bpm_range`), and `key`/`scale` from the starter or `key_tendency`. Otherwise keep the song's key and transpose the idioms.
3. Map each `signature` bullet to a part. One idea per part file: a percussion loop is `perc.js`, a 303 line is `acid.js`, a gated supersaw is `chords.js`.
4. Start from the starter parts when the song is empty. When the song already has parts, change them toward the signature instead of replacing everything: Daniel's ideas stay.
5. Copy `starter.sections` and `starter.arrange` only if the arrangement is empty or Daniel asked for the genre's structure. Keep `song.json` sections and `arrange.js` in sync.
6. Run `mcp__ears__strudel_check`. Read the drum grid and the section densities against `listen_for`.

## Translating idioms to code

| Idiom | Strudel |
|---|---|
| four-on-the-floor | `s("bd*4")` |
| offbeat open hat | `s("[~ oh]*4")` |
| rolling 16th bass between kicks | `note("[~ c2 c2 c2]*4")` |
| tom/rim grooves that double at the phrase end | `.lastOf(4, (x) => x.ply(2))` |
| 303 squelch | sawtooth, `lpq(12..20)`, `lpf(sine.range(...).slow(8))` |
| dub chord with long tail | `chord("Cm9").voicing().struct("~ x ~ ~")`, `delayfeedback(0.6+)`, `room(0.8)` |
| trance gate | `.struct("x x ~ x x ~ x ~ ...")` on a supersaw chord |
| supersaw arp | `chord(...).voicing().arp("<0 1 2 3>*16").add(note(12)).s("supersaw")` |
| chopped break | `s("brk").splice(16, "...")` |
| no kick (ambient) | leave `bd` out; pads with `attack(1).release(2)` |

```js
// hardgroove: kick plus looped toms and rims that double on the 4th bar
const drums = s("bd*4, ~ cp ~ cp").bank("RolandTR909")
const perc = stack(
  s("rim(5,16,2)").gain(0.5),
  s("~ ~ lt ~ ~ mt ~ ~ ~ lt ~ ~ ht ~ mt ~").gain(0.45),
).bank("RolandTR909").lastOf(4, (x) => x.ply(2))
stack(drums, perc)
```

```js
// trance: gated supersaw chords under a 16th arp
const chords = chord("<Am F C G>").voicing().s("supersaw")
  .struct("x x ~ x x ~ x ~ x x ~ x x ~ x x").decay(0.1).sustain(0).lpf(2800).gain(0.2)
const lead = chord("<Am F C G>").voicing().arp("<0 1 2 3>*16").add(note(12)).s("supersaw")
  .lpf(3500).decay(0.12).sustain(0).gain(0.18)
stack(chords, lead)
```

## Blending and "more like X"

- Two genres: take tempo and drums from one, harmony and sound design from the other. Say which in the closing note.
- "More like X": find the one or two signature bullets the song misses most and change only those parts.
- Off-genre on purpose is fine; say what you kept and what you broke.

## References

- `references/genres/*.json`: the cards (a link to `content/genres` in the app).
- `references/genre-to-parts.md`: per-genre part checklists and the mistakes that make a genre sound wrong.
