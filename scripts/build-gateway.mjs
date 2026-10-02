// Bundles the gateway into apps/gateway/dist/gateway.mjs. Native modules stay
// external and resolve from apps/gateway/node_modules.
import { build } from "esbuild";
await build({
  entryPoints: ["apps/gateway/src/index.ts"],
  outfile: "apps/gateway/dist/gateway.mjs",
  bundle: true, platform: "node", format: "esm", target: "node22",
  external: ["better-sqlite3", "node-pty"],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
});
console.log("gateway built: apps/gateway/dist/gateway.mjs");
