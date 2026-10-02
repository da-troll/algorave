// Plan section 13 end-to-end against the deployed app (host port + edge identity header), dpr=2.
// STEP env selects a stage; state is passed through e2e/.state.json.
import { chromium, type Page } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const base = process.env.BASE ?? "http://127.0.0.1:3597/"; // e2e/edge-proxy.ts in front of the deployed gateway
const STEP = process.env.STEP ?? "main";
const stateFile = "e2e/.state.json";
const S: Record<string, string> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(S, null, 2));
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const mobile = STEP === "mobile";
const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

const p = await ctx.newPage();
const errs: string[] = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
async function shot(name: string) {
  // through the real header toggle, so React's theme state and the DOM agree
  const cur = () => p.evaluate(() => document.documentElement.dataset.theme);
  for (const t of ["dark", "light"] as const) {
    if ((await cur()) !== t) await p.click("[data-testid=theme-toggle]");
    await p.waitForTimeout(700); // past the 200 ms colour transitions
    await p.screenshot({ path: `screenshots/${name}-${t === "dark" ? "mocha" : "latte"}.png` });
  }
  if ((await cur()) !== "dark") await p.click("[data-testid=theme-toggle]");
}
async function tab(id: string) { await p.click(`[data-tab=${id}]`); await p.waitForTimeout(200); }

try {
  if (STEP === "main") {
    await p.goto(base);
    await p.waitForSelector("text=New song");
    await p.selectOption("select[aria-label=Genre]", "hardgroove");
    await p.click("[data-testid=new-genre]");
    await p.waitForURL(/#\/song\//);
    S.slug = p.url().split("#/song/")[1]!;
    log(`song ${S.slug}`);
    await p.waitForSelector("text=hardgroove", { timeout: 5000 }).catch(() => {});
    // next 4 bars: the pending pill is visible for several seconds, so it can be observed
    await p.selectOption("select[aria-label='Apply changes']", "4bars");
    await p.click("[data-testid=start-chat]");
    await p.waitForSelector("text=chat · idle", { timeout: 20000 });
    // play first, so the apply lands on a bar boundary while playing
    await p.click("button[aria-label=Play]", { timeout: 60000 });
    await p.waitForSelector("button[aria-label=Stop]", { timeout: 30000 });
    log("playing");
    await shot("01-song-playing");
    await p.fill("textarea[aria-label=Prompt]", "add an acid line in the drop and make the build 16 bars");
    await p.click("button[aria-label=Send]");
    await p.waitForSelector("[data-role=assistant]", { timeout: 120000 });
    log("streaming assistant text");
    await tab("activity");
    await p.waitForSelector("[data-check]", { timeout: 240000 });
    log("ears check in conversation");
    await shot("02-turn-running");
    const pillP = p.waitForSelector("[data-testid=pending-pill]", { timeout: 300000 }).then(() => true).catch(() => false);
    await p.waitForSelector("text=turn completed", { timeout: 300000 });
    log("turn completed");
    const pill = await pillP;
    log(`pending pill seen: ${pill}`);
    if (pill) { await shot("03-pending-pill"); await p.waitForSelector("[data-testid=pending-pill]", { state: "detached", timeout: 30000 }); log("pending pill resolved"); }
    S.activityChecks = String(await p.locator("[data-activity='artifact.created']").count());
    await tab("timeline");
    await p.waitForSelector("text=turn 1:", { timeout: 15000 });
    log("commit in timeline");
    const code = await p.locator("[data-testid=repl-editor] .cm-content").innerText();
    S.replHasAcid = String(/acid|303|lpq/i.test(code));
    log(`REPL code updated with acid line: ${S.replHasAcid}`);
    await shot("04-after-turn");
    save();
  }
  if (STEP === "reload") {
    // reload mid-turn: transcript restores, no duplicates, the turn continues
    await p.goto(`${base}#/song/${S.slug}`);
    await p.waitForSelector("text=chat · ", { timeout: 20000 });
    await p.fill("textarea[aria-label=Prompt]", "Make the hats a bit swingier and explain in one line what changed.");
    await p.click("button[aria-label=Send]");
    await p.waitForSelector("text=working", { timeout: 30000 });
    await p.waitForTimeout(4000);
    const before = await p.locator("[data-role]").count();
    await p.reload();
    await p.waitForSelector("[data-role=user]", { timeout: 20000 });
    const users = await p.locator("[data-role=user]").allInnerTexts();
    const dupes = users.length - new Set(users).size;
    log(`after reload: ${users.length} user messages, ${dupes} duplicated; ${before} rows before reload`);
    await p.waitForSelector("text=turn completed >> nth=1", { timeout: 300000 });
    const ends = await p.locator("text=turn completed").count();
    log(`turn continued and completed after reload (turn-end markers: ${ends})`);
    S.reloadDupes = String(dupes);
    await shot("05-after-reload");
    save();
  }
  if (STEP === "timeline") {
    await p.goto(`${base}#/song/${S.slug}`);
    await tab("timeline");
    const rows = p.locator("[data-commit]");
    await rows.first().waitFor();
    const n = await rows.count();
    log(`${n} commits`);
    await rows.nth(n - 1).locator("button").first().click();
    await p.click("text=Load as A");
    await rows.nth(0).locator("button").first().click();
    await p.click("text=Load as B");
    await p.waitForSelector("[data-testid=ab-a]");
    await p.click("[data-testid=ab-a]");
    await p.click("text=Swap");
    log("A/B loaded and swapped");
    await shot("06-ab-compare");
    await p.click("text=Back to HEAD");
    S.ab = "ok";
    save();
  }
  if (STEP === "terminal") {
    await p.goto(base);
    await p.waitForSelector("[data-testid=new-blank]");
    await p.click("[data-testid=new-blank]");
    await p.waitForURL(/#\/song\//);
    S.termSlug = p.url().split("#/song/")[1]!;
    await tab("terminal");
    await p.click("text=Open Claude Code terminal");
    await p.waitForSelector("[data-testid=terminal] .xterm-rows", { timeout: 20000 });
    await p.waitForTimeout(9000);
    const screen = await p.locator("[data-testid=terminal] .xterm-rows").innerText();
    log(`terminal screen (first 300 chars): ${screen.replace(/\s+/g, " ").slice(0, 300)}`);
    await shot("07-terminal");
    // Claude Code's workspace-trust prompt is left for the human (default "No, exit"); the test picks "Yes".
    if (/trust/i.test(screen)) { await p.click("[data-testid=terminal] .xterm-screen"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter"); await p.waitForTimeout(6000); await shot("07-terminal-claude"); }
    await p.click("[data-testid=terminal] .xterm-screen");
    await p.keyboard.type("/exit");
    await p.waitForTimeout(500);
    await p.keyboard.press("Enter");
    await p.waitForSelector("text=Open Claude Code terminal", { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const ended = await p.locator("[data-testid=terminal]").count();
    log(`after /exit: terminal panel still attached: ${ended > 0}; offer to open again visible: ${await p.locator("text=Open Claude Code terminal").count()}`);
    await shot("07-terminal-after-exit");
    save();
  }
  if (STEP === "record") {
    await p.goto(`${base}#/song/${S.slug}`);
    await p.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 60000 });
    await tab("record");
    await p.fill("[data-testid=record] input[type=number]", "4");
    await p.waitForTimeout(1000);
    const before = await p.locator("[data-take]").count();
    await p.click("text=Record 4 bars live");
    // a NEW take, not one left by an earlier run
    await p.waitForFunction((n) => document.querySelectorAll("[data-take]").length > n, before, { timeout: 60000 });
    const name = await p.locator("[data-take]").first().getAttribute("data-take");
    log(`takes before ${before}, after ${await p.locator("[data-take]").count()}`);
    const info = await p.evaluate(async (u) => { const r = await fetch(u); const b = await r.arrayBuffer(); const ac = new AudioContext(); const a = await ac.decodeAudioData(b.slice(0)); let peak = 0; const d = a.getChannelData(0); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!)); return { type: r.headers.get("content-type"), bytes: b.byteLength, seconds: a.duration, channels: a.numberOfChannels, peak }; }, `${base}api/songs/${S.slug}/takes/${name}`);
    log(`take ${name}: ${JSON.stringify(info)}`);
    await shot("09-record");
  }
  if (STEP === "panels") {
    await p.goto(`${base}#/song/${S.slug}`);
    await p.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 60000 });
    await p.click("button[aria-label=Play]");
    await tab("visuals");
    await p.click("text=Start visuals");
    await p.waitForSelector("#hydra-canvas", { timeout: 20000 });
    await p.waitForTimeout(2500);
    const lit = await p.evaluate(() => { const c = document.getElementById("hydra-canvas") as HTMLCanvasElement; const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, inPanel: !!c.closest("[data-testid=visuals]") }; });
    log(`hydra canvas: ${JSON.stringify(lit)}`);
    await shot("10-visuals");
    await p.click("text=Stop visuals");
    await tab("genres");
    await p.waitForSelector("[data-genre]");
    log(`genre cards: ${await p.locator("[data-genre]").count()}`);
    await shot("11-genres");
    await tab("path");
    await p.waitForSelector("text=Show me");
    await p.click("text=Do it in my song");
    const prompt = await p.inputValue("textarea[aria-label=Prompt]");
    log(`guided path prefilled prompt: ${prompt.slice(0, 80)}`);
    await shot("12-path");
  }
  if (STEP === "mobile") {
    await p.goto(`${base}#/song/${S.slug}`);
    await p.waitForSelector("[data-tab=chat]");
    await shot("08-mobile-chat");
    await p.click("[data-tab=repl]");
    await p.waitForTimeout(500);
    await shot("08-mobile-repl");
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    log(`mobile scrollWidth ${sw[0]} vs viewport ${sw[1]}`);
  }
} finally {
  log(`console errors: ${JSON.stringify(errs.slice(0, 8))}`);
  await b.close();
}
