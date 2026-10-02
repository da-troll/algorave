// Generates agent-kit/ears/sounds.json: every sound name the browser REPL can play,
// from the same sources @strudel/repl 1.3.0 prebake() loads. Run once, commit the output.
import { writeFileSync } from "node:fs";
import gm from "../node_modules/.pnpm/@strudel+soundfonts@1.3.0/node_modules/@strudel/soundfonts/gm.mjs";

const ds = "https://raw.githubusercontent.com/felixroos/dough-samples/main";
const tc = "https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main";
const ts = "https://raw.githubusercontent.com/todepond/samples/main";
const maps = [`${ds}/tidal-drum-machines.json`, `${ds}/piano.json`, `${ds}/Dirt-Samples.json`, `${ds}/vcsl.json`, `${ds}/mridangam.json`, `${tc}/strudel.json`];

const samples = new Set();
for (const url of maps) {
  const j = await (await fetch(url)).json();
  for (const k of Object.keys(j)) if (!k.startsWith("_")) samples.add(k);
}
const aliases = await (await fetch(`${ts}/tidal-drum-machines-alias.json`)).json();
// superdough synth.mjs / noise.mjs / zzfx.mjs, read from source 2026-10-02
const synths = ["triangle", "square", "sawtooth", "sine", "user", "one", "tri", "sqr", "saw", "sin",
  "supersaw", "pulse", "sbd", "bytebeat", "bus", "white", "pink", "brown", "crackle",
  "z_sine", "z_triangle", "z_sawtooth", "z_tan", "z_noise"];
const out = {
  generated: new Date().toISOString().slice(0, 10),
  sources: [...maps, `${ts}/tidal-drum-machines-alias.json`, "superdough@1.3.0 synth/noise/zzfx", "@strudel/soundfonts@1.3.0 gm.mjs"],
  synths,
  soundfonts: Object.keys(gm).sort(),
  samples: [...samples].sort(),
  bankAliases: aliases,
};
writeFileSync(new URL("../agent-kit/ears/sounds.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`synths=${synths.length} soundfonts=${out.soundfonts.length} samples=${out.samples.length} aliases=${Object.keys(aliases).length}`);
