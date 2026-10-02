# Closing notes

The closing note is the only thing Daniel reads in chat. He hears the change and sees the diff in the Timeline, so the note connects the two: what to listen for, and where.

## Shape

1. What changed, as music (instrument, rhythm, harmony, space, energy).
2. Where to hear it (section, bar, beat).
3. Anything deliberate the check flagged, or a choice he might want to reverse.

## Good

> Added a clap on 2 and 4 with a short room, and the hats now swing slightly. The groove should feel looser from bar 1.

> The chords moved from Cm to a Cm7, Ab maj7, Bb7 cycle over 4 bars. The lead arp follows them, so it lifts on bar 3 of every phrase.

> The 8-bar build now strips the kick on its last bar, and a noise riser climbs across it. The drop at bar 17 should hit noticeably harder.

> The bass plays a deliberate B natural on the last 16th of bar 4 as a leading tone back to C; the check flags it as out of key.

> Took the bass and kick out of the breakdown (bars 25 to 32) and opened the pad reverb, so the arp carries the section alone.

## Bad, and why

> Edited bass.js: note("[~ c2]*4") to note("[~ c2 c2 c2]*4"), lpf 600 to sine.range(300, 900).slow(16).

Code in chat; nothing about the sound.

> Done! The check passes with 0 problems and 3504 events.

Bookkeeping, not music.

> I made the track better and more energetic with lots of improvements across all parts.

Vague; nothing to listen for, and "all parts" means the turn did too much.

## Words for sound

| Change | Say |
|---|---|
| lpf up / down | brighter, more open / darker, muffled |
| lpq up | more resonant, squelchy, vocal |
| room / size up | further away, bigger space, washier |
| delay feedback up | longer echo tail |
| shape / distort | grittier, more saturated |
| hpf on a part | thinner, out of the bass's way |
| ply / roll | stutter, roll, tension |
| degradeBy, sometimes | looser, less mechanical |
| duckorbit | pumping, the bass breathes with the kick |
| attack up | softer start, swells in |
| decay down, sustain 0 | tighter, plucky |

## A snippet worth describing

When a change is subtle, name the exact place. For example, this fill only plays on bar 4 of each phrase, so the note should say "listen at the end of every 4th bar":

```js
s("~ ~ lt ~ ~ mt ~ ~ ~ lt ~ ~ ht ~ mt ~").bank("RolandTR909").lastOf(4, (x) => x.ply(2)).gain(0.45)
```
