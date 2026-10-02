---
name: strudel-sound-design
description: Timbre and mix in Strudel. Synth waveforms (sine, triangle, square, sawtooth, supersaw, noise), ADSR envelopes, filter envelopes, FM, the sample banks and GM soundfonts that actually exist here (references/sounds.json is the full list), layering, and gain staging so stacked parts do not clip. Use when the user asks for a different sound, says something is too loud, muddy, thin or harsh, or when the check reports an unknown sound.
---

# Strudel sound design

## Only these sounds exist

`references/sounds.json` is the complete list the checker and the browser know: `synths`, `soundfonts` (GM instruments), `samples`, and `bankAliases`. A name not in it plays silence in the browser, and `strudel_check` reports it as an unknown sound. Grep it before using a new name:

```
Grep pattern "RolandTR909_" path .claude/skills/strudel-sound-design/references/sounds.json
```

`s("bd").bank("RolandTR909")` resolves to the sample `RolandTR909_bd`. Short aliases work too (`.bank("TR909")`). Without `.bank`, `s("bd")` uses the default Dirt sample set.

## Synths

| Name | Character | Good for |
|---|---|---|
| `sine` | pure, no harmonics | sub bass, soft pads, kicks with `penv` |
| `triangle` | soft, flute-like | leads, arps, bells |
| `square` | hollow, woody | stabs, chiptune leads |
| `sawtooth` | bright, buzzy | bass, acid, pads (filter it) |
| `supersaw` | wide detuned saws | trance leads and pads; `unison`, `detune`, `spread` |
| `pulse` | variable width square | basses |
| `white`, `pink`, `brown` | noise | risers, hats, texture |
| `crackle` | vinyl crackle | dub and lo-fi texture |

A pitched pattern with no `s(...)` plays `triangle`.

## Envelopes

- Amplitude: `attack`, `decay`, `sustain` (level 0 to 1), `release`, or `adsr("a:d:s:r")`.
- Pluck: `.decay(0.15).sustain(0)`. Pad: `.attack(0.5).release(1.5)`.
- Filter: `lpf` sets the base cutoff, `lpenv` how many octaves the envelope opens it, `lpattack`/`lpdecay`/`lpsustain`/`lprelease` its shape.
- Pitch: `penv` (semitones) with `pattack`/`pdecay` for kick-like drops.

```js
// three envelopes on one saw: pluck amplitude, snappy filter, a tiny pitch drop
note("<c2 c2 eb2 g1>*8").s("sawtooth")
  .decay(0.18).sustain(0)
  .lpf(250).lpenv(4).lpdecay(0.12).lpsustain(0).lpq(8)
  .penv(-2).pdecay(0.05)
  .gain(0.45)
```

```js
// pad: slow attack and release, supersaw spread wide
chord("<Cm9 Ab^7>").voicing().s("supersaw").unison(5).detune(0.25).spread(0.8)
  .attack(0.6).release(1.5).lpf(1600).room(0.6).gain(0.18)
```

## FM

`fm` (modulation index), `fmh` (harmonicity ratio), `fmattack`/`fmdecay` for an envelope on the index. Integer `fmh` is harmonic (bells at 2 to 4), non-integer is metallic.

```js
n("0 4 7 9").scale("C4:minor").s("sine").fm(3).fmh(3.5).fmdecay(0.3)
  .decay(0.4).sustain(0).room(0.5).gain(0.3)
```

## Drum machines worth knowing

| Bank | Has | Use for |
|---|---|---|
| `RolandTR909` | bd cp cr hh ht lt mt oh rd rim sd | techno, house, trance, hardgroove |
| `RolandTR808` | bd cb cp cr hh ht lt mt oh perc rim sd sh | minimal, electro, the 808 shaker |
| `RolandTR707` | bd cb cp cr hh ht lt mt oh rim sd tb | 80s house, tambourine (tb) |
| `RolandTR606` | bd cr hh ht lt oh sd | thin acid-era kits |
| `LinnDrum` | bd cb cp cr hh ht lt mt oh perc rd rim sd sh tb | 80s pop, funk |
| `AkaiMPC60` | bd cp cr hh ht lt misc mt oh perc rd rim sd | hip hop, gritty breaks |
| `OberheimDMX` | bd cp cr hh ht lt mt oh rd rim sd sh tb | electro, early hip hop |
| `EmuSP12` | bd cb cp cr hh ht lt misc mt oh perc rd rim sd | boom bap |

Plus samples without a bank: `bd`, `sd`, `hh`, `oh`, `cp`, `rim`, `cr`, `rd`, `sh`, `brk` (a breakbeat for `splice`/`chop`), and hand percussion such as `conga`, `bongo`, `cowbell`, `clave`, `tambourine`, `woodblock`. Full list in `references/banks.md`.

## GM soundfonts

Use with `note`/`n`: `gm_piano`, `gm_epiano1`, `gm_epiano2`, `gm_pad_warm`, `gm_pad_poly`, `gm_pad_halo`, `gm_pad_sweep`, `gm_synth_strings_1`, `gm_string_ensemble_1`, `gm_choir_aahs`, `gm_synth_bass_1`, `gm_synth_bass_2`, `gm_acoustic_bass`, `gm_fretless_bass`, `gm_lead_1_square`, `gm_lead_2_sawtooth`, `gm_music_box`, `gm_celesta`, `gm_vibraphone`, `gm_marimba`, `gm_kalimba`, `gm_fx_atmosphere`, `gm_fx_crystal`. All 125 are in `sounds.json`.

```js
stack(
  chord("<Cm9 Fm9>").voicing().s("gm_epiano1").struct("x ~ ~ x ~ ~ x ~").gain(0.35),
  n("0 ~ 4 ~ 7 ~ 4 ~").scale("C2:minor").s("gm_synth_bass_1").gain(0.5),
)
```

## Gain staging (stacked parts must not clip)

Parts add up. Start from these levels and adjust by ear and by the check's density:

| Part | gain |
|---|---|
| kick | 0.9 to 1 |
| clap / snare | 0.45 to 0.6 |
| hats | 0.2 to 0.4 (accent with "[0.2 0.35]*8") |
| bass | 0.4 to 0.55 |
| chords / pads | 0.15 to 0.3 |
| lead | 0.2 to 0.3 |
| noise, risers, texture | 0.03 to 0.12 |

- Supersaw and chords are many voices: keep them lower than you think.
- `hpf(150..300)` on chords and pads leaves room for kick and bass.
- Sidechain the bass or pad to the kick: kick `.duckorbit(2)`, bass `.orbit(2)`.
- More reverb and delay on one orbit adds level too.
- If everything is loud, turn parts down. Never push everything up.

## References

- `references/sounds.json`: every valid name (link to `agent-kit/ears/sounds.json`).
- `references/banks.md`: all drum machine banks, the Dirt sample names, GM groups.
- `references/synthesis.md`: recipes for kick, bass, acid, stab, pad, pluck, riser, layering.
