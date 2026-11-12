const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const handleEspnProxy = require("./api/espn");
const handleWeatherProxy = require("./api/weather");
const handleBookmakersProxy = require("./api/bookmakers");
const handleRuninProxy = require("./api/runin");
const handleOnefootballProxy = require("./api/onefootball");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
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

// ============ MISSION SYSTEM TELEMETRY & SSE REAL-TIME ENGINE ============
const sseClients = new Set();
const missionState = {
  mode: "MISSION_REALTIME_ONLINE",
  bootedAt: new Date().toISOString(),
  bootedMs: Date.now(),
  cycleCount: 0,
  sources: {
    onefootball: {
      intervalMs: 60 * 1000,
      status: "WARMING",
      inFlight: false,
      lastOkAt: null,
      lastOkMs: 0,
      lastErrorAt: null,
      lastError: null,
      latencyMs: 0,
      runCount: 0,
      errorCount: 0,
      meta: {}
    },
    bookmakers: {
      intervalMs: 90 * 1000,
      status: "WARMING",
      inFlight: false,
      lastOkAt: null,
      lastOkMs: 0,
      lastErrorAt: null,
      lastError: null,
      latencyMs: 0,
      runCount: 0,
      errorCount: 0,
      meta: {}
    },
    runin: {
      intervalMs: 10 * 60 * 1000,
      status: "WARMING",
      inFlight: false,
      lastOkAt: null,
      lastOkMs: 0,
      lastErrorAt: null,
      lastError: null,
      latencyMs: 0,
      runCount: 0,
      errorCount: 0,
      meta: {}
    }
  }
};

function getTelemetrySnapshot() {
  return {
    ok: true,
    mode: missionState.mode,
    bootedAt: missionState.bootedAt,
    serverTimeUtc: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - missionState.bootedMs) / 1000),
    cycleCount: missionState.cycleCount,
    sseClients: sseClients.size,
    sources: Object.fromEntries(
      Object.entries(missionState.sources).map(([k, s]) => [
        k,
        {
          intervalMs: s.intervalMs,
          status: s.status,
          inFlight: s.inFlight,
          lastOkAt: s.lastOkAt,
          ageSec: s.lastOkMs ? Math.max(0, Math.round((Date.now() - s.lastOkMs) / 1000)) : null,
          lastErrorAt: s.lastErrorAt,
          lastError: s.lastError,
          latencyMs: s.latencyMs,
          runCount: s.runCount,
          errorCount: s.errorCount,
          meta: s.meta
        }
      ])
    )
  };
}

function broadcastSse(eventName, payload) {
  if (sseClients.size === 0) return;
  const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(packet);
    } catch {
      sseClients.delete(res);
    }
  }
}

async function runMissionJob(sourceKey, forceRefresh = true) {
  const slot = missionState.sources[sourceKey];
  if (!slot || slot.inFlight) return null;
  slot.inFlight = true;
  const startedAt = Date.now();
  try {
    let result = null;
    if (sourceKey === "onefootball" && typeof handleOnefootballProxy.fetchOneFootballSchedule === "function") {
      result = await handleOnefootballProxy.fetchOneFootballSchedule(forceRefresh);
      slot.meta = {
        totalMatches: result?.totalMatches || 0,
        liveCount: result?.liveCount || 0,
        scheduledCount: result?.scheduledCount || 0,
        preMatch5hCount: result?.preMatch5hCount || 0
      };
    } else if (sourceKey === "bookmakers" && typeof handleBookmakersProxy.runFullBookmakerScan === "function") {
      result = await handleBookmakersProxy.runFullBookmakerScan(forceRefresh);
      slot.meta = {
        totalGamesScraped: result?.totalGamesScraped || 0,
        preMatch5hCount: result?.preMatch5hCount || 0,
        dropsTrackedCount: result?.dropsTrackedCount || 0
      };
    } else if (sourceKey === "runin" && typeof handleRuninProxy.fetchTopLeaguesRunin === "function") {
      result = await handleRuninProxy.fetchTopLeaguesRunin(forceRefresh);
      slot.meta = {
        leaguesCount: result?.leaguesCount || 0
      };
    }
    slot.status = "ONLINE";
    slot.lastOkMs = Date.now();
    slot.lastOkAt = new Date(slot.lastOkMs).toISOString();
    slot.lastError = null;
    slot.latencyMs = slot.lastOkMs - startedAt;
    slot.runCount++;
    missionState.cycleCount++;
    broadcastSse("feed_update", {
      source: sourceKey,
      ts: slot.lastOkAt,
      telemetry: getTelemetrySnapshot()
    });
    return result;
  } catch (err) {
    slot.errorCount++;
    slot.lastErrorAt = new Date().toISOString();
    slot.lastError = err?.message || "Sync error";
    slot.status = slot.lastOkMs > 0 ? "DEGRADED" : "RETRYING";
    slot.latencyMs = Date.now() - startedAt;
    broadcastSse("telemetry", getTelemetrySnapshot());
    return null;
  } finally {
    slot.inFlight = false;
  }
}

process.on("uncaughtException", (err) => {
  console.error("[MISSION-WATCHDOG] uncaughtException:", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[MISSION-WATCHDOG] unhandledRejection:", reason);
});

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
    if (reqUrl.pathname === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(getTelemetrySnapshot()));
      return;
    }
    if (reqUrl.pathname === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write(`retry: 3000\nevent: telemetry\ndata: ${JSON.stringify(getTelemetrySnapshot())}\n\n`);
      sseClients.add(res);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }
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
    if (reqUrl.pathname === "/api/runin") {
      await handleRuninProxy(req, res);
      return;
    }
    if (reqUrl.pathname === "/api/onefootball") {
      await handleOnefootballProxy(req, res);
      return;
    }

    let reqPath = decodeURIComponent(reqUrl.pathname);
    if (reqPath === "/") reqPath = "/index.html";
    if (reqPath === "/favicon.ico") reqPath = "/assets/motexiz-mark.svg";

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
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, HOST, () => {
  console.log(`MAMON WIN server running at http://${HOST}:${PORT}/`);
  // Initial Mission Boot Ingestion (all real-time feeds start immediately)
  runMissionJob("onefootball", false);
  runMissionJob("bookmakers", false);
  runMissionJob("runin", false);

  // Autonomous Continuous Real-Time Acquisition Loops
  setInterval(() => { runMissionJob("onefootball", true); }, 60 * 1000);
  setInterval(() => { runMissionJob("bookmakers", true); }, 90 * 1000);
  setInterval(() => { runMissionJob("runin", true); }, 10 * 60 * 1000);

  // Self-Healing Watchdog + SSE Keep-Alive Heartbeat
  setInterval(() => {
    broadcastSse("heartbeat", { ts: new Date().toISOString(), cycleCount: missionState.cycleCount });
  }, 15 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [key, src] of Object.entries(missionState.sources)) {
      const staleLimit = src.intervalMs * 2.5;
      if (!src.inFlight && (src.lastOkMs === 0 || now - src.lastOkMs > staleLimit)) {
        runMissionJob(key, true);
      }
    }
  }, 30 * 1000);
});
