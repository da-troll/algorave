// Copies third-party browser files the CSP requires us to serve ourselves.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("apps/web/public/vendor", { recursive: true });
copyFileSync("apps/web/node_modules/hydra-synth/dist/hydra-synth.js", "apps/web/public/vendor/hydra-synth.js");
console.log("vendored hydra-synth.js");
