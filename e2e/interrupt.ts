// Which interrupt path does the installed CLI need? (plan 5.3) Against the deployed gateway.
const base = "http://127.0.0.1:3597";
const H = { origin: base, "x-algorave": "1", "content-type": "application/json" };
const j = async (m: string, p: string, b?: unknown, h: Record<string, string> = {}) => { const r = await fetch(base + p, { method: m, headers: { ...H, ...h }, body: m === "GET" ? undefined : JSON.stringify(b ?? {}) }); return { s: r.status, b: await r.json() as any }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const song = (await j("POST", "/api/songs", { title: "Interrupt probe" })).b;
const ses = (await j("POST", `/api/songs/${song.slug}/sessions`, { kind: "chat" })).b;
await j("POST", `/api/sessions/${ses.id}/turns`, { input: "Write a long, detailed 600-word essay about the history of acid house before touching any file." }, { "idempotency-key": crypto.randomUUID() });
await sleep(6000);
const t0 = Date.now();
const r = await j("POST", `/api/sessions/${ses.id}/interrupt`);
console.log("interrupt:", r.s, JSON.stringify(r.b), `${Date.now() - t0} ms`);
await sleep(1500);
const snap = (await j("GET", `/api/sessions/${ses.id}`)).b;
const ev = (await j("GET", `/api/sessions/${ses.id}/events?afterSeq=${Math.max(0, snap.lastSeq - 6)}`)).b.events;
console.log(ev.map((e: any) => `${e.seq} ${e.type} ${e.payload.reason ?? e.payload.status ?? e.payload.error ?? ""}`).join("\n"));
// the session must still take a prompt afterwards
const t2 = await j("POST", `/api/sessions/${ses.id}/turns`, { input: "Reply with just the word ready." }, { "idempotency-key": crypto.randomUUID() });
for (let i = 0; i < 90; i++) { const s = (await j("GET", `/api/sessions/${ses.id}`)).b; if (!s.runningTurn) break; await sleep(1000); }
const tail = (await j("GET", `/api/sessions/${ses.id}/events?afterSeq=${snap.lastSeq}`)).b.events;
console.log("after interrupt, next turn:", t2.s, tail.filter((e: any) => e.type.startsWith("turn.") || e.type === "message.completed").map((e: any) => `${e.type}:${(e.payload.text ?? e.payload.reason ?? "").slice(0, 40)}`).join(" | "));
await j("POST", `/api/sessions/${ses.id}/stop`);
