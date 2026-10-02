// pnpm test:themes (GW-PLAN 6.8): axe colour-contrast on the home page and a song page
// in dark (Mocha) and light (Latte). Runs against the edge proxy (e2e/edge-proxy.ts).
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { readFileSync, existsSync } from "node:fs";
const base = process.env.BASE ?? "http://127.0.0.1:3597/";
const slug = existsSync("e2e/.state.json") ? JSON.parse(readFileSync("e2e/.state.json", "utf8")).slug : null;
const b = await chromium.launch();
let failures = 0;
for (const theme of ["dark", "light"] as const) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("app-theme", t), theme);
  const p = await ctx.newPage();
  for (const [name, url] of [["home", base], ...(slug ? [["song", `${base}#/song/${slug}`]] : [])] as Array<[string, string]>) {
    await p.goto(url);
    await p.waitForTimeout(2500);
    const got = await p.evaluate(() => document.documentElement.dataset.theme);
    if (got !== theme) { console.log(`FAIL ${name} ${theme}: page is in ${got}`); failures++; }
    const r = await new AxeBuilder({ page: p }).withRules(["color-contrast"]).exclude(".cm-editor").exclude(".xterm").analyze();
    const n = r.violations.reduce((a, v) => a + v.nodes.length, 0);
    console.log(`${n ? "FAIL" : "PASS"} ${name} ${theme === "dark" ? "Mocha" : "Latte"}: ${n} contrast violation node(s)`);
    for (const v of r.violations) for (const node of v.nodes.slice(0, 6)) console.log(`   ${node.target.join(" ")} :: ${node.failureSummary?.split("\n").pop()?.trim().slice(0, 140)}`);
    failures += n;
  }
  await ctx.close();
}
await b.close();
console.log(failures ? `test:themes FAILED (${failures})` : "test:themes PASSED");
process.exit(failures ? 1 : 0);
