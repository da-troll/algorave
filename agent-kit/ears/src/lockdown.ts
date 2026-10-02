// Network lockdown for the evaluator child, applied AFTER Strudel has loaded and
// BEFORE any agent-written code runs.
//
// Why: the box has unauthenticated loopback endpoints that act (the agent
// bridge's /inject spawns agent turns; other household services listen on
// loopback). A part file that could open a socket would escape the no-Bash
// boundary without touching a file. Node 22's --permission model does not cover
// the network, unprivileged user namespaces are blocked by AppArmor on this host
// (unshare -rn: "write failed /proc/self/uid_map"), and systemd --user ignores
// IPAddressDeny (measured: a sandboxed fetch still reached the bridge). So this is
// an IN-PROCESS denylist, layered inside the --permission child. Its limits are
// written down in .agent-gateway/PROJECT.md section 10.
import { registerHooks, createRequire } from "node:module";

const require = createRequire(import.meta.url);
let locked = false;

function deny(what: string): never {
  throw new Error(`${what.startsWith("process.") || what.startsWith("import") ? "module and binding access" : "network access"} is disabled in the ears sandbox (${what})`);
}

// Blocks import()/require of ANY module once locked, including node:net,
// node:http and data: URLs. Strudel is fully loaded before this flips.
registerHooks({
  resolve(specifier, context, next) {
    if (locked) deny(`import ${specifier}`);
    return next(specifier, context);
  },
});

export function lockdown(): void {
  const net = require("node:net");
  const tls = require("node:tls");
  const http = require("node:http");
  const https = require("node:https");
  const http2 = require("node:http2");
  const dgram = require("node:dgram");
  const dns = require("node:dns");

  // Builtins are process-wide singletons: patching them covers every path to
  // them (getBuiltinModule, cached requires, undici's own use of net).
  net.Socket.prototype.connect = () => deny("net.Socket.connect");
  net.connect = net.createConnection = () => deny("net.connect");
  net.Server.prototype.listen = () => deny("net.Server.listen");
  tls.connect = () => deny("tls.connect");
  http.request = http.get = () => deny("http.request");
  https.request = https.get = () => deny("https.request");
  http2.connect = () => deny("http2.connect");
  dgram.createSocket = () => deny("dgram.createSocket");
  for (const k of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"]) (dns as Record<string, unknown>)[k] = () => deny(`dns.${k}`);
  const dnsp = require("node:dns/promises");
  for (const k of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"]) dnsp[k] = () => deny(`dns.promises.${k}`);

  const g = globalThis as Record<string, unknown>;
  for (const k of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "Request", "Response", "Headers"]) {
    try { delete g[k]; } catch { /* ignore */ }
    if (k in g) g[k] = undefined;
  }
  const p = process as unknown as Record<string, unknown>;
  p.binding = () => deny("process.binding");
  p._linkedBinding = () => deny("process._linkedBinding");
  p.getBuiltinModule = (m: string) => deny(`process.getBuiltinModule(${m})`);
  p.dlopen = () => deny("process.dlopen");
  locked = true;
}
