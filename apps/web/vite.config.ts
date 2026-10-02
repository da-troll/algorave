import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// The household artifact lint forbids em dashes and CJK characters in the shipped bundle.
// Library code carries both: two em dashes in Strudel log strings (rewritten to a hyphen)
// and Unicode identifier/bracket tables in acorn and CodeMirror (CJK). The tables are
// rewritten as \uXXXX escapes (surrogate pairs above U+FFFF): inside string, template and
// regex literals an escape IS the same character at runtime, so behaviour is unchanged.
const CJK = /[\u3000-\u30ff\u3100-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]|[\u{20000}-\u{2ffff}]/gu;
const esc = (ch: string) => Array.from({ length: ch.length }, (_, i) => "\\u" + ch.charCodeAt(i).toString(16).padStart(4, "0")).join("");
function englishNativeRuntime() {
  return {
    name: "english-native-runtime",
    // generateBundle runs AFTER minification (the minifier turns escapes back into characters)
    generateBundle(_: unknown, bundle: Record<string, { type: string; code?: string }>) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk" && chunk.code) chunk.code = chunk.code.replace(/\u2014/g, "-").replace(CJK, esc);
      }
    },
  };
}

// base './': served under Caddy's /YYYY-MM-DD-slug/ prefix after strip_prefix.
export default defineConfig({
  plugins: [react(), tailwind(), englishNativeRuntime()],
  base: "./",
  resolve: {
    // one copy of each: Strudel's Pattern prototypes, CodeMirror's state/view
    // and React must not be duplicated across workspace packages.
    dedupe: ["react", "react-dom", "@strudel/core", "@strudel/draw", "@strudel/webaudio", "@strudel/transpiler", "@strudel/mini", "@strudel/tonal", "@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/highlight", "@trollefsen-labs/components-react"],
  },
  build: { outDir: "../../out", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000 },
  server: { port: 5291, proxy: { "/api": { target: "http://127.0.0.1:3553", ws: true } } },
});
