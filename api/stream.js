const { buildTelemetrySnapshot } = require("./health");

module.exports = async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const snapshot = buildTelemetrySnapshot();
  res.write(`retry: 25000\nevent: telemetry\ndata: ${JSON.stringify(snapshot)}\n\nevent: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  res.end();
};
