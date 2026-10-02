// pnpm check:design (GW-PLAN 6.8): fails on design-system violations.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
const roots = ["apps/web/src", "packages/ui-theme/src", "packages/ui-agent-shell/src"];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
roots.forEach(walk);
const problems = [];
let themeRoots = 0, useThemes = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  src.split("\n").forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    const code = line.replace(/\/\/.*$/, "");
    if (/#[0-9a-fA-F]{3,8}\b/.test(code) && !/\[data-|&#|#\//.test(code)) problems.push(`${at}: colour literal`);
    if (/\b(rgb|rgba|hsl|hsla)\(/.test(code)) problems.push(`${at}: colour function literal`);
    if (/backdrop-filter|backdrop-blur/.test(code)) problems.push(`${at}: backdrop blur`);
    if (/GlassCard|GlassAmbient/.test(code)) problems.push(`${at}: deprecated glass component`);
    if (/\btext-white\b/.test(code)) problems.push(`${at}: text-white`);
    if (/className=["'`][^"'`]*\bdark\b/.test(code) || /\.dark\b/.test(code) && f.endsWith(".css")) problems.push(`${at}: .dark class usage`);
  });
  themeRoots += (src.match(/<ThemeRoot\b/g) ?? []).length;
  useThemes += (src.match(/\buseTheme\(/g) ?? []).length;
}
if (themeRoots !== 1) problems.push(`expected exactly one <ThemeRoot>, found ${themeRoots}`);
if (useThemes !== 1) problems.push(`expected exactly one useTheme( call, found ${useThemes}`);
const css = "apps/web/src/index.css";
for (const m of readFileSync(css, "utf8").matchAll(/@source\s+"([^"]+)"/g)) {
  const p = resolve(dirname(css), m[1]);
  if (!existsSync(p)) problems.push(`${css}: @source path does not exist: ${m[1]}`);
}
console.log(`check:design scanned ${files.length} files: ${problems.length ? `${problems.length} problem(s)` : "clean"}`);
for (const p of problems) console.log("  " + p);
process.exit(problems.length ? 1 : 0);
