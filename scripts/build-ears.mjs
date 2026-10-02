// Bundles the ears MCP server and its sandboxed evaluator into agent-kit/ears/dist.
// @kabelsalat/web (imported by @strudel/core) ships only a browser IIFE, so it is
// aliased to a stub; ears never uses Kabelsalat.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const root = new URL("../agent-kit/ears/", import.meta.url).pathname;
mkdirSync(`${root}dist`, { recursive: true });
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  absWorkingDir: root,
  alias: { "@kabelsalat/web": "./src/stubs/kabelsalat-web.ts" },
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
};
await build({ ...common, entryPoints: { server: "src/server.ts", evaluator: "src/evaluator.ts" }, outdir: "dist", outExtension: { ".js": ".mjs" } });
copyFileSync(`${root}sounds.json`, `${root}dist/sounds.json`);
console.log("ears built:", `${root}dist`);
