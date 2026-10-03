// The chat panel follows chat sessions; a terminal session lives only in the Terminal tab.
// Runs on a scratch song (printed as SLUG, archive it afterwards); only VIEWS the demo song.
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:3597/";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
const log = (m: string) => console.log(m);
const header = async () => (await p.locator("header").innerText()).replace(/\s+/g, " ");
const bar = async () => (await p.locator("section[aria-label=Conversation]").innerText()).replace(/\s+/g, " ").slice(0, 160);
const stopDialog = async (name: RegExp) => { await p.getByRole("button", { name }).last().click(); };
try {
  await p.goto(base); await p.click("[data-testid=new-blank]"); await p.waitForURL(/#\/song\//);
  log(`SLUG ${p.url().split("#/song/")[1]}`);
  await p.click("[data-testid=start-chat]"); await p.waitForSelector("text=chat · idle", { timeout: 30000 });
  await p.getByRole("button", { name: "Stop session" }).click(); await stopDialog(/^Stop$/);
  await p.waitForSelector("[data-testid=start-chat]:not([disabled])", { timeout: 15000 });
  await p.click("[data-testid=start-chat]"); await p.waitForSelector("text=chat · idle", { timeout: 30000 });
  const opts = await p.locator("[data-testid=chat-picker] option").allInnerTexts();
  log(`picker after 2 chats: ${JSON.stringify(opts)}`);
  await p.click("[data-tab=terminal]"); await p.click("text=Open Claude Code terminal"); await stopDialog(/Stop and open terminal/);
  await p.waitForSelector("[data-testid=terminal] .xterm-rows", { timeout: 20000 });
  await p.waitForTimeout(1500);
  log(`terminal holds: header="${await header()}"`);
  log(`terminal holds: chat="${await bar()}"`);
  log(`chat prompt placeholder/disabled: ${await p.locator("textarea[aria-label=Prompt]").isDisabled()}`);
  await p.screenshot({ path: "screenshots/12-terminal-holds-chat-kept.png" });
  await p.getByRole("button", { name: "Stop terminal" }).click(); await stopDialog(/^Stop$/);
  await p.waitForSelector("text=Open Claude Code terminal", { timeout: 20000 });
  log(`terminal stopped: chat="${await bar()}"`);
  // the demo song: view only, never start anything
  await p.goto(base + "#/song/hardgroove-jam-c937"); await p.waitForSelector("[data-role=assistant]", { timeout: 20000 });
  log(`demo: user turns=${await p.locator("[data-role=user]").count()} assistant=${await p.locator("[data-role=assistant]").count()} chat="${await bar()}"`);
  await p.screenshot({ path: "screenshots/13-demo-song-conversation.png" });
} finally { await b.close(); }
