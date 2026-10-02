// Gateway access control (GW-PLAN 10, plan section 8): checkRequest matrix and trustedPeer.
// Run: node --test tests/auth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// config.ts reads the environment at import time: pin it before importing auth.ts.
process.env.PORT = "3553";
process.env.ALGORAVE_BIND = "127.0.0.1,172.17.0.1";
process.env.ALGORAVE_PUBLIC_HOST = "mvp.trollefsen.com";
process.env.ALGORAVE_USER = "daniel";
const { checkRequest, trustedPeer } = await import("../apps/gateway/src/auth.ts");

const HOST = "127.0.0.1:3553";
const ORIGIN = "http://127.0.0.1:3553";
const PUB_ORIGIN = "https://mvp.trollefsen.com";
type Opts = Parameters<typeof checkRequest>[0];

const get = (o: Partial<Opts> = {}): Opts => ({ method: "GET", host: HOST, user: "daniel", peer: "127.0.0.1", ...o });
const post = (o: Partial<Opts> = {}): Opts => ({ method: "POST", host: HOST, origin: ORIGIN, user: "daniel", peer: "127.0.0.1", csrf: "1", contentType: "application/json", ...o });

function expectVerdict(o: Opts, status: number | "ok", code?: string) {
  const v = checkRequest(o);
  if (status === "ok") { assert.deepEqual(v, { ok: true }, `expected ok for ${JSON.stringify(o)}`); return; }
  assert.equal(v.ok, false, `expected ${status} for ${JSON.stringify(o)}`);
  if (!v.ok) {
    assert.equal(v.status, status);
    if (code) assert.equal(v.code, code);
  }
}

test("trustedPeer: loopback and the docker bridge range only", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "172.17.0.1", "172.18.0.5", "::ffff:172.18.0.5", "172.16.0.1", "172.31.255.254"]) assert.equal(trustedPeer(a), true, a);
  for (const a of [undefined, "", "8.8.8.8", "192.168.1.5", "10.0.0.1", "172.15.0.1", "172.32.0.1", "127.0.0.2", "::ffff:8.8.8.8", "172.18.0.5.evil", "fe80::1"]) assert.equal(trustedPeer(a), false, String(a));
});

test("bad or missing Host -> 400", () => {
  expectVerdict(get({ host: "evil.example" }), 400, "bad-host");
  expectVerdict(get({ host: null }), 400, "bad-host");
  expectVerdict(get({ host: "127.0.0.1:9999" }), 400, "bad-host");
  expectVerdict(post({ host: "attacker.rebind.example:3553" }), 400, "bad-host");
});

test("allowed hosts pass", () => {
  for (const h of ["127.0.0.1:3553", "172.17.0.1:3553", "localhost:3553", "host.docker.internal:3553", "mvp.trollefsen.com"]) expectVerdict(get({ host: h }), "ok");
});

test("untrusted peer -> 403 even with the identity header", () => {
  expectVerdict(get({ peer: "8.8.8.8" }), 403, "untrusted-peer");
  expectVerdict(get({ peer: "192.168.1.5" }), 403, "untrusted-peer");
  expectVerdict(get({ peer: undefined }), 403, "untrusted-peer");
});

test("docker bridge 172.18.0.5 and loopback are trusted", () => {
  expectVerdict(get({ peer: "172.18.0.5" }), "ok");
  expectVerdict(get({ peer: "::ffff:172.18.0.5" }), "ok");
  expectVerdict(get({ peer: "127.0.0.1" }), "ok");
  expectVerdict(get({ peer: "::1" }), "ok");
  expectVerdict(post({ peer: "172.18.0.5", host: "mvp.trollefsen.com", origin: PUB_ORIGIN }), "ok");
});

test("missing or wrong user -> 401", () => {
  expectVerdict(get({ user: null }), 401, "unauthenticated");
  expectVerdict(get({ user: "" }), 401, "unauthenticated");
  expectVerdict(get({ user: "eve" }), 401, "unauthenticated");
  expectVerdict(get({ user: "Daniel" }), 401, "unauthenticated");
  expectVerdict(post({ user: null }), 401, "unauthenticated");
});

test("GET without Origin is ok; GET with a foreign Origin is refused", () => {
  expectVerdict(get({ origin: null }), "ok");
  expectVerdict(get({ origin: undefined }), "ok");
  expectVerdict(get({ origin: ORIGIN }), "ok");
  expectVerdict(get({ origin: "https://evil.example" }), 403, "bad-origin");
});

test("POST without Origin -> 403", () => {
  expectVerdict(post({ origin: null }), 403, "missing-origin");
  expectVerdict(post({ origin: undefined }), 403, "missing-origin");
});

test("POST with a foreign or null Origin -> 403", () => {
  expectVerdict(post({ origin: "https://evil.example" }), 403, "bad-origin");
  expectVerdict(post({ origin: "null" }), 403, "bad-origin");
  expectVerdict(post({ origin: "http://mvp.trollefsen.com" }), 403, "bad-origin");
});

test("POST without X-Algorave: 1 -> 403", () => {
  expectVerdict(post({ csrf: null }), 403, "csrf");
  expectVerdict(post({ csrf: "true" }), 403, "csrf");
  expectVerdict(post({ method: "PUT", csrf: null }), 403, "csrf");
  expectVerdict(post({ method: "DELETE", csrf: null }), 403, "csrf");
});

test("POST with a non-JSON body -> 400; DELETE does not need JSON", () => {
  expectVerdict(post({ contentType: "text/plain" }), 400, "json-only");
  expectVerdict(post({ contentType: "application/x-www-form-urlencoded" }), 400, "json-only");
  expectVerdict(post({ contentType: null }), 400, "json-only");
  expectVerdict(post({ contentType: "application/json; charset=utf-8" }), "ok");
  expectVerdict(post({ method: "DELETE", contentType: null }), "ok");
});

test("WS upgrade: bad Origin 403, missing Origin 403, good Origin ok without CSRF header", () => {
  expectVerdict(get({ upgrade: true, origin: "https://evil.example" }), 403, "bad-origin");
  expectVerdict(get({ upgrade: true, origin: null }), 403, "missing-origin");
  expectVerdict(get({ upgrade: true, origin: ORIGIN, csrf: null, contentType: null }), "ok");
  expectVerdict(get({ upgrade: true, origin: ORIGIN, user: null }), 401, "unauthenticated");
});

test("check order: Host before peer before identity", () => {
  expectVerdict({ method: "POST", host: "evil", peer: "8.8.8.8", user: null }, 400, "bad-host");
  expectVerdict({ method: "POST", host: HOST, peer: "8.8.8.8", user: null }, 403, "untrusted-peer");
  expectVerdict({ method: "POST", host: HOST, peer: "127.0.0.1", user: null }, 401, "unauthenticated");
});
