const apiCache = new Map();
const inFlight = new Map();

function getCacheTtlMs(apiPath) {
  if (apiPath.includes("/scoreboard")) return 20000;
  return 180000;
}

module.exports = async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const relPath = String(req.query?.path ?? reqUrl.searchParams.get("path") ?? "").trim();

    if (!relPath.startsWith("/apis/") || relPath.includes("..")) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Invalid ESPN API path" }));
      return;
    }

    const now = Date.now();
    const cached = apiCache.get(relPath);
    if (cached && now < cached.expiresAt) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Cache", "HIT");
      res.end(cached.body);
      return;
    }

    let promise = inFlight.get(relPath);
    if (!promise) {
      const targetUrl = `https://site.api.espn.com${relPath}`;
      promise = fetch(targetUrl, {
        headers: {
          "User-Agent": "MAMON-WIN/2.0",
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(7000)
      })
        .then(async (upstream) => {
          const text = await upstream.text();
          if (upstream.ok) {
            apiCache.set(relPath, {
              body: text,
              expiresAt: Date.now() + getCacheTtlMs(relPath)
            });
          }
          return { ok: upstream.ok, status: upstream.status, body: text };
        })
        .finally(() => {
          inFlight.delete(relPath);
        });
      inFlight.set(relPath, promise);
    }

    const result = await promise;
    res.statusCode = result.status || 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Cache", "MISS");
    res.end(result.body);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: err?.message || "Upstream fetch error" }));
  }
};
