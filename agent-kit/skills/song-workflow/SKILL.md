---
name: song-workflow
description: The turn contract for working in an Algorave Room song repo. Read song.json, edit one part per idea, call mcp__ears__strudel_check after every edit, never end on a failing check, call mcp__ears__runtime_errors when the user says it sounds broken or silent, name parts well, and close each turn with 1 to 3 lines in musical terms. Use at the start of every turn in a song repo.
---

# Song workflow

## Every turn

1. **Orient.** Read `song.json` (bpm, key, scale, genre, sections, notes). If you have not seen the repo this session, call `mcp__ears__song_info` for the part list and recent commits.
2. **Plan in music.** Decide which part changes and what the listener should hear. One musical idea per change.
3. **Edit parts.** Change `parts/<name>.js`, or add a new part file plus a line in `arrange.js`. Keep `arrange.js` for combining parts and section-level tweaks only.
4. **Check.** Call `mcp__ears__strudel_check` after EVERY edit, not once at the end.
5. **Fix until clean.** Never end a turn with `CHECK FAILED` or unexplained problems. Out-of-key notes or unknown sounds: fix them, or explain in the closing note why a note is intentional (a blue note, a chromatic run).
6. **Close.** 1 to 3 lines in musical terms. No code in chat: the diff is in the Timeline.

## The files

- `song.json`: tempo, key and scale live here. Change tempo here, never with `setcpm`/`setcps` in a part (the check flags it).
- `parts/<name>.js`: exactly one `const <name> = ...`, named after the file. No imports, no exports.
- `arrange.js`: the last expression, `arrange([bars, stack(...)], ...)` or a single `stack(...)` loop. One cycle is one bar.
- Compile order: drums, bass, chords, lead, fx, then other parts alphabetically, then arrange.js. A part may use an earlier part's name, never a later one.

```js
// parts/bass.js may build on parts/drums.js (drums compiles first)
const drums = s("bd*4, ~ cp ~ cp").bank("RolandTR909")
const bass = note("[~ c2]*4").s("sawtooth").lpf(600).decay(0.15).sustain(0).gain(0.5)
stack(drums, bass)
```

## Naming parts

- Name by role, lower case, a valid JS identifier: `drums`, `hats`, `perc`, `bass`, `sub`, `acid`, `chords`, `pad`, `stabs`, `lead`, `arp`, `vox`, `fx`, `riser`, `roll`.
- Split a part when it does two jobs that need different sections: hats that drop out in the breakdown while the kick stays are their own `hats` part.
- Do not number parts (`lead2`); name the difference (`counter`, `hook`).
- Renaming a part means renaming the file, the `const`, and every use in `arrange.js`.

## Reading the check

```
CHECK OK
tempo 128 bpm (code 128) · key C minor [C D Eb F G Ab Bb] · 32 bars analysed (arranged) · 1180 events
parts (events/bar min/avg/max · sounds · range):
  drums: 26/26/26 · RolandTR909_bd,RolandTR909_cp,...
  bass: 8/8/8 · sawtooth · C2-Eb2 {C Eb}
drums, intro (bar 1, 16 steps):
  RolandTR909_bd x... x... x... x...
sections (bars @start · events/bar):
  intro 8@1 30 | build 8@9 52 | drop 16@17 98
```

- A part with `0/0/0` events is silent: a misspelled chord or scale (see strudel-core "Silent failures"), a mask that is always 0, or single quotes.
- The drum grid shows bar 1 of each section: use it to verify kick placement and swing.
- Section events/bar is the energy curve: the drop should be densest.
- `out of key in bass: E2x16` means 16 E2 events outside C minor. Fix the note or justify it.
- `unknown sound in fx: RolandTR909_cb` means that bank has no such sample. Grep `sounds.json`.
- `CHECK FAILED ... at: parts/bass.js:2` gives file and line; the browser keeps playing the previous version until it passes.

## When the user says it sounds broken or silent

The check evaluates in Node; the browser can still fail (sample loading, audio scheduling). Call `mcp__ears__runtime_errors` first and read what the browser actually did, then fix. Do not guess.

## Closing note

1 to 3 lines. What changed, in musical terms, and what to listen for and where (bar, section, beat). Mention anything deliberate the check flagged.

Good:

> The bass now rolls 16ths between the kicks and its filter opens over the 8-bar build, so the drop at bar 17 lands brighter. Listen for the open hat moving to the offbeat in the breakdown.

Bad:

> Updated bass.js and arrange.js, changed lpf to sine.range(400, 1800).slow(8) and added a mask. Check passes.

The bad one lists code (the Timeline already shows it) and says nothing about what to hear. More examples in `references/closing-notes.md`.

## Small rules that save a turn

- Respect bpm, key and scale unless the user asks; when they do, change `song.json`.
- Keep `song.json` sections and `arrange.js` in sync (names, order, bar counts).
- One idea per turn unless asked for more. If you made several changes, say which is the main one.
- Keep code readable: line breaks after `stack(` and between effect groups, a short comment at the top of each part saying what it does musically.
- No shell, no web. Only Read, Edit, Write, Glob, Grep and the ears tools, inside this repo.

## References

- `references/closing-notes.md`: more good and bad closing notes, and how to describe sound in words.
