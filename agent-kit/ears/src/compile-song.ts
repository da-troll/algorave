// Node wrapper around compile-core: reads a song directory (working tree) or a
// commit (via a caller-supplied reader, so git stays in the gateway).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { compileFiles, type CompiledSong, type SongFiles } from "./compile-core.ts";

export * from "./compile-core.ts";

export function readSongFiles(dir: string): SongFiles {
  const partsDir = join(dir, "parts");
  const parts: Record<string, string> = {};
  if (existsSync(partsDir)) {
    for (const f of readdirSync(partsDir).sort()) {
      if (f.endsWith(".js")) parts[f.slice(0, -3)] = readFileSync(join(partsDir, f), "utf8");
    }
  }
  return {
    songJson: readFileSync(join(dir, "song.json"), "utf8"),
    parts,
    arrange: existsSync(join(dir, "arrange.js")) ? readFileSync(join(dir, "arrange.js"), "utf8") : "",
  };
}

export function compileSong(dir: string): CompiledSong {
  return compileFiles(readSongFiles(dir));
}
