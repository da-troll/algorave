// Test-only stand-in for the edge: like Caddy + Authentik forward_auth, it adds
// X-authentik-Username server-side and forwards HTTP and WebSocket upgrades.
// Host/Origin are mapped to the gateway's own address (which the allowlist accepts).
import http from "node:http";
import net from "node:net";
const UP = Number(process.env.UP ?? 3553), PORT = Number(process.env.EDGE ?? 3597);
const fix = (h: http.IncomingHttpHeaders) => {
  const o = { ...h, host: `127.0.0.1:${UP}`, "x-authentik-username": "daniel" } as Record<string, string | string[] | undefined>;
  if (o.origin === `http://127.0.0.1:${PORT}`) o.origin = `http://127.0.0.1:${UP}`;
  return o;
};
const srv = http.createServer((req, res) => {
  const up = http.request({ host: "127.0.0.1", port: UP, method: req.method, path: req.url, headers: fix(req.headers) }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  up.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});
srv.on("upgrade", (req, sock, head) => {
  const up = net.connect(UP, "127.0.0.1", () => {
    const h = fix(req.headers);
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});
srv.listen(PORT, "127.0.0.1", () => console.log(`edge proxy :${PORT} -> :${UP}`));
