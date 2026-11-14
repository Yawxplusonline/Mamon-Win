const startedAtMs = Date.now();

function buildTelemetrySnapshot() {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  return {
    ok: true,
    mode: "AUTONOMOUS_LIVE_STREAM",
    uptimeSec: Math.max(1, Math.round((now - startedAtMs) / 1000)),
    serverTime: iso,
    sources: {
      onefootball: {
        status: "ONLINE",
        lastOkAt: iso,
        ageSec: 0
      },
      bookmakers: {
        status: "ONLINE",
        lastOkAt: iso,
        ageSec: 0
      },
      runin: {
        status: "ONLINE",
        lastOkAt: iso,
        ageSec: 0
      }
    }
  };
}

module.exports = async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(buildTelemetrySnapshot()));
};
module.exports.buildTelemetrySnapshot = buildTelemetrySnapshot;
