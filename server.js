// Tiny static server for Nightfall (no dependencies). Used by Railway and any Node host.
//   PORT=8080 node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "nightfall", "site");
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { "Content-Type": type, ...HEADERS, ...extra });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(res, 400, "Bad request", "text/plain"); }
  if (pathname === "/healthz") return send(res, 200, "ok", "text/plain", { "Cache-Control": "no-store" });

  // resolve inside ROOT only (no path traversal)
  let file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  if (pathname.endsWith("/")) file = path.join(file, "index.html");

  fs.stat(file, (err, st) => {
    // unknown routes without a file extension fall back to the app (it uses #/ routes)
    if (err || !st.isFile()) {
      if (!path.extname(pathname)) file = path.join(ROOT, "index.html");
      else return send(res, 404, "Not found", "text/plain");
    }
    const ext = path.extname(file).toLowerCase();
    const cache = ext === ".html" || file.endsWith("deployments.js") ? "no-cache" : /\/(img|vendor)\//.test(file) ? "public, max-age=604800" : "public, max-age=3600";
    fs.readFile(file, (e, data) => {
      if (e) return send(res, 500, "Server error", "text/plain");
      send(res, 200, req.method === "HEAD" ? undefined : data, TYPES[ext] || "application/octet-stream", { "Cache-Control": cache });
    });
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Nightfall listening on port ${PORT}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
