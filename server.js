const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const handleEspnProxy = require("./api/espn");
const handleWeatherProxy = require("./api/weather");
const handleBookmakersProxy = require("./api/bookmakers");

const PORT = 8080;
const HOST = "127.0.0.1";
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
    if (reqUrl.pathname === "/api/espn") {
      await handleEspnProxy(req, res);
      return;
    }
    if (reqUrl.pathname === "/api/weather") {
      await handleWeatherProxy(req, res);
      return;
    }
    if (reqUrl.pathname === "/api/bookmakers") {
      await handleBookmakersProxy(req, res);
      return;
    }

    let reqPath = decodeURIComponent(reqUrl.pathname);
    if (reqPath === "/") reqPath = "/index.html";

    // Prevent directory traversal
    const resolved = path.resolve(ROOT, "." + reqPath);
    if (!resolved.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let filePath = resolved;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback when no static file matches
      if (!path.extname(reqPath)) {
        filePath = path.join(ROOT, "index.html");
      } else {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MAMON WIN server running at http://${HOST}:${PORT}/`);
  if (typeof handleBookmakersProxy.runFullBookmakerScan === "function") {
    handleBookmakersProxy.runFullBookmakerScan(false).catch(() => {});
  }
});
