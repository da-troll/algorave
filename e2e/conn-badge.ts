// Repro for the header connection badge after chat -> terminal (stop and open terminal).
// Samples the badge and logs every WebSocket open/close the page makes.
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:3597/";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
// SLOW_CLOSE=ms: a client-initiated close completes late, as on a slow or mobile link
if (process.env.SLOW_CLOSE) await p.addInitScript((ms) => { const c = WebSocket.prototype.close; WebSocket.prototype.close = function (...a) { setTimeout(() => c.apply(this, a), ms); }; }, Number(process.env.SLOW_CLOSE));
const t0 = Date.now(); const log = (m: string) => console.log(`${String(Date.now() - t0).padStart(6)}ms ${m}`);
p.on("websocket", (ws) => { const id = ws.url().split("/sessions/")[1]?.slice(0, 8); log(`ws open ${id}`); ws.on("close", () => log(`ws close ${id}`)); });
const badge = () => p.locator("header").getByText(/^(live|offline|reconnecting|connecting)$/).first().innerText().catch(() => "-");
try {
  await p.goto(base); await p.click("[data-testid=new-blank]"); await p.waitForURL(/#\/song\//);
  console.log("SLUG", p.url().split("#/song/")[1]);
  await p.click("[data-testid=start-chat]"); await p.waitForSelector("text=chat · idle", { timeout: 30000 });
  log(`chat idle, badge=${await badge()}`);
  await p.click("[data-tab=terminal]"); await p.click("text=Open Claude Code terminal");
  await p.getByRole("button", { name: "Stop and open terminal" }).click();
  for (let i = 0; i < 10; i++) { await p.waitForTimeout(500); log(`badge=${await badge()} status=${await p.locator("header").innerText().then((s) => s.replace(/\s+/g, " ").slice(0, 120))}`); }
} finally { await b.close(); }
