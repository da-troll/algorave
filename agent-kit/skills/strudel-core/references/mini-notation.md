# Mini-notation reference

Mini-notation lives inside double quotes (or backticks). It describes one cycle, and in this app one cycle is one bar. Every example below is a complete snippet that passes `strudel_check`.

## Steps and rests

Spaces divide the bar into equal steps. `~` is a rest.

```js
// kick on 1 and 3, snare on 2 and 4
s("bd sd bd sd").bank("RolandTR909")
```

```js
// a 16-step grid written out: kick on the downbeats, a syncopated extra kick
s("bd ~ ~ ~ bd ~ ~ bd ~ ~ bd ~ bd ~ ~ ~").bank("RolandTR909")
```

## Repeat and slow: `*` and `/`

`x*n` squeezes n copies into the step. `x/n` stretches it over n cycles.

```js
// 16th hats, and an open hat that only sounds every other bar
stack(
  s("hh*16").gain(0.3),
  s("oh/2").gain(0.4),
).bank("RolandTR909")
```

## Subdivide: `[ ]`

A bracket fits a whole group into one step.

```js
// the last beat is split into two 8ths
s("bd bd bd [bd bd]").bank("RolandTR909")
```

## Alternate per cycle: `< >`

One item per cycle, in turn. Combine with `*` to step through the list faster.

```js
// a 4-bar root movement, one note per bar
note("<c2 c2 ab1 bb1>").s("sawtooth").lpf(600).gain(0.5)
```

```js
// <...>*8 walks the list once per 8th note
note("<c2 eb2 g2 bb2>*8").s("sawtooth").lpf(900).decay(0.12).sustain(0).gain(0.45)
```

## Stack inside a pattern: `,`

Comma means "at the same time". Useful for chords and for compact drum lines.

```js
// kick and hats in one string, plus a chord written as notes
stack(
  s("bd*4, [~ hh]*4").bank("RolandTR909"),
  note("[c3,eb3,g3] ~ [c3,eb3,g3] ~").s("square").decay(0.2).sustain(0).gain(0.2),
)
```

## Repeat as a new step: `!`

`bd!3` is the same as `bd bd bd`: each copy takes its own step (unlike `*`).

```js
s("bd!3 sd").bank("RolandTR909")
```

## Weight: `@`

`@n` makes a step n units long relative to the others.

```js
// the first note lasts three times as long as the second
note("c3@3 eb3").s("triangle").gain(0.4)
```

## Chance: `?`

`?` drops the step half the time (deterministic per cycle, so the check sees the same thing every time). `?0.2` sets the drop chance.

```js
s("hh*16?0.3").bank("RolandTR909").gain(0.35)
```

## Euclidean rhythms: `(k,n,r)`

k hits spread over n steps, optionally rotated by r. Classic patterns: (3,8) tresillo, (5,8) cinquillo, (5,16) a rolling rim, (7,16) busy shaker.

```js
stack(
  s("bd*4"),
  s("rim(5,16,2)").gain(0.45),
  s("lt(3,8)").gain(0.4),
).bank("RolandTR909")
```

## Variants and values: `:`

`bd:3` picks the fourth bd sample in the bank. In `scale("C3:minor")` the colon separates root and scale name.

```js
s("bd:1 sd:2").bank("RolandTR808")
```

## Polymeter: `{ }`

Curly braces line several sequences up on the step count of the first one, so they drift against each other.

```js
s("{bd sd, hh hh hh}").bank("RolandTR909")
```

## Quote rule (again)

```js
// correct: double quotes are mini-notation, two sounds per bar
s("bd sd").bank("RolandTR909")
```

`s('bd sd')` (single quotes) is a plain string: one event with the sound name `bd sd`, reported as unknown.
