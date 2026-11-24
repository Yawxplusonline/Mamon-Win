// FootyMetrics Opta-Level Stats, Trends & Referee Intelligence Extractor
// Fetches public unauthenticated SSR data from footymetrics.com (ignoring all payment/auth gates)

let cachedFootyMetrics = null;
let lastFetchMs = 0;
let inFlightPromise = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

function decodeNextFlight(html) {
  if (!html) return "";
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse('"' + m[1] + '"'));
    } catch {
      chunks.push(m[1]);
    }
  }
  return chunks.join("");
}

function extractBalancedArray(text, keyPattern, startFrom = 0) {
  const idx = text.indexOf(keyPattern, startFrom);
  if (idx === -1) return null;
  const arrStart = text.indexOf("[", idx + keyPattern.length - 1);
  if (arrStart === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = arrStart; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        const raw = text.slice(arrStart, i + 1);
        try {
          return { data: JSON.parse(raw), endIdx: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|as|afc|fk|sk|bk|ik|nk|cd|ca|ud|rc|sd|us|ss|vfb|vfl|tsg|rb|sv|bsc|fsv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const cleaned = String(ts).replace(/^\$D/, "");
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sanitizeTeamStats(t) {
  if (!t || typeof t !== "object") return null;
  return {
    apid: t.apid || null,
    name: t.name || "",
    normName: normName(t.name),
    logo: t.logo || null,
    form: t.form || "",
    win5: Number.isFinite(Number(t.win5)) ? Number(t.win5) : null,
    win10: Number.isFinite(Number(t.win10)) ? Number(t.win10) : null,
    win15: Number.isFinite(Number(t.win15)) ? Number(t.win15) : null,
    over255: Number.isFinite(Number(t.over255)) ? Number(t.over255) : null,
    over2510: Number.isFinite(Number(t.over2510)) ? Number(t.over2510) : null,
    over2515: Number.isFinite(Number(t.over2515)) ? Number(t.over2515) : null,
    btts5: Number.isFinite(Number(t.btts5)) ? Number(t.btts5) : null,
    btts10: Number.isFinite(Number(t.btts10)) ? Number(t.btts10) : null,
    btts15: Number.isFinite(Number(t.btts15)) ? Number(t.btts15) : null,
    homeWin5: Number.isFinite(Number(t.homeWin5)) ? Number(t.homeWin5) : null,
    awayWin5: Number.isFinite(Number(t.awayWin5)) ? Number(t.awayWin5) : null,
    homeOver255: Number.isFinite(Number(t.homeOver255)) ? Number(t.homeOver255) : null,
    awayOver255: Number.isFinite(Number(t.awayOver255)) ? Number(t.awayOver255) : null,
    homeBtts5: Number.isFinite(Number(t.homeBtts5)) ? Number(t.homeBtts5) : null,
    awayBtts5: Number.isFinite(Number(t.awayBtts5)) ? Number(t.awayBtts5) : null
  };
}

function sanitizeFixture(f) {
  if (!f || !f.Home || !f.Away) return null;
  const home = sanitizeTeamStats(f.Home);
  const away = sanitizeTeamStats(f.Away);
  return {
    id: String(f.id || f.apid || ""),
    apid: f.apid || null,
    slug: f.slug || "",
    timestamp: parseTimestamp(f.timestamp),
    status: f.status || "NS",
    homeGoals: Number.isFinite(Number(f.homeGoals)) ? Number(f.homeGoals) : null,
    awayGoals: Number.isFinite(Number(f.awayGoals)) ? Number(f.awayGoals) : null,
    homePos: Number.isFinite(Number(f.homePos)) ? Number(f.homePos) : null,
    awayPos: Number.isFinite(Number(f.awayPos)) ? Number(f.awayPos) : null,
    lineupConfirmed: Boolean(f.lineupConfirmed),
    lineupPredicted: Boolean(f.lineupPredicted),
    stageName: f.stageName || "",
    league: {
      name: f.League?.name || "",
      country: f.League?.Country?.name || "",
      flag: f.League?.Country?.flag || "",
      logo: f.League?.logo || ""
    },
    home,
    away,
    referee: f.referee
      ? {
          name: f.referee.name || "",
          avgYellowCards: Number(f.referee.avgYellowCards || 0),
          avgFouls: Number(f.referee.avgFouls || 0)
        }
      : null,
    odds: {
      odd1: Number(f.odd_1 || 0) || null,
      oddX: Number(f.odd_X || 0) || null,
      odd2: Number(f.odd_2 || 0) || null,
      odd1x: Number(f.odd_1x || 0) || null,
      odd12: Number(f.odd_12 || 0) || null,
      oddX2: Number(f.odd_x2 || 0) || null,
      oddOver15: Number(f.odd_over15 || 0) || null,
      oddUnder15: Number(f.odd_under15 || 0) || null,
      oddOver25: Number(f.odd_over25 || 0) || null,
      oddUnder25: Number(f.odd_under25 || 0) || null,
      oddBtts: Number(f.odd_btts || 0) || null,
      oddBttsNo: Number(f.odd_btts_no || 0) || null,
      oddOver75Corners: Number(f.odd_over75_corners || 0) || null,
      oddOver85Corners: Number(f.odd_over85_corners || 0) || null,
      oddOver95Corners: Number(f.odd_over95_corners || 0) || null,
      oddOver105Corners: Number(f.odd_over105_corners || 0) || null
    }
  };
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFootyMetricsIntelligence(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedFootyMetrics && now - lastFetchMs < CACHE_TTL_MS) {
    return cachedFootyMetrics;
  }
  if (inFlightPromise && !forceRefresh) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    const [homeHtml, refHtml] = await Promise.all([
      fetchTextWithTimeout("https://www.footymetrics.com/", 12000),
      fetchTextWithTimeout("https://www.footymetrics.com/referees", 12000)
    ]);

    const fixturesMap = new Map();
    const playerTrends = [];
    const refereeAppointments = [];
    const topReferees = [];

    if (homeHtml) {
      const fullH = decodeNextFlight(homeHtml);
      let pos = 0;
      while (true) {
        const found = extractBalancedArray(fullH, '"fixtures":[', pos);
        if (!found) break;
        if (Array.isArray(found.data)) {
          for (const rawF of found.data) {
            const clean = sanitizeFixture(rawF);
            if (clean && clean.id && !fixturesMap.has(clean.id)) {
              fixturesMap.set(clean.id, clean);
            }
          }
        }
        pos = found.endIdx;
      }

      const trendsRes = extractBalancedArray(fullH, '"trends":[');
      if (trendsRes && Array.isArray(trendsRes.data)) {
        for (const t of trendsRes.data) {
          if (t && (t.shortName || t.name)) {
            playerTrends.push({
              id: String(t.id || ""),
              name: t.shortName || t.name || "",
              photo: t.photo || null,
              pos: t.pos || "",
              market: t.market || t.key || "",
              direction: t.direction || "over",
              line: t.line || "",
              percentage: Number(t.percentage || 0),
              bestCount: Number(t.bestCount || 0),
              bestTotal: Number(t.bestTotal || 0),
              avg: t.va ? Number(t.va) : null,
              timestamp: parseTimestamp(t.timestamp)
            });
          }
        }
      }
    }

    if (refHtml) {
      const fullR = decodeNextFlight(refHtml);
      const apptRes = extractBalancedArray(fullR, '"appointments":[');
      if (apptRes && Array.isArray(apptRes.data)) {
        for (const a of apptRes.data) {
          if (!a || !a.referee || !a.fixture) continue;
          refereeAppointments.push({
            fixtureSlug: a.fixture.slug || "",
            timestamp: parseTimestamp(a.fixture.timestamp),
            leagueName: a.fixture.league?.name || "",
            refereeName: a.referee.name || "",
            country: a.referee.country?.name || "",
            games: Number(a.stats?.games || 0),
            cardsPg: Number(a.stats?.cardsPg || 0),
            yellowPg: Number(a.stats?.yellowPg || 0),
            redPg: Number(a.stats?.redPg || 0),
            foulsPg: Number(a.stats?.foulsPg || 0),
            penaltiesPg: Number(a.stats?.penaltiesPg || 0)
          });
        }
      }

      const rowsRes = extractBalancedArray(fullR, '"rows":[');
      if (rowsRes && Array.isArray(rowsRes.data)) {
        for (const r of rowsRes.data) {
          if (!r || !r.name) continue;
          topReferees.push({
            name: r.name,
            country: r.country?.name || "",
            leagueName: r.mainLeague?.name || "",
            games: Number(r.stats?.games || 0),
            cardsPg: Number(r.stats?.cardsPg || 0),
            yellowPg: Number(r.stats?.yellowPg || 0),
            redPg: Number(r.stats?.redPg || 0),
            foulsPg: Number(r.stats?.foulsPg || 0)
          });
        }
      }
    }

    const todayUtcIso = new Date().toISOString().slice(0, 10);
    const fixtures = Array.from(fixturesMap.values()).filter(
      (f) => !f.timestamp || f.timestamp.slice(0, 10) === todayUtcIso
    );
    const todayTrends = playerTrends.filter(
      (t) => !t.timestamp || t.timestamp.slice(0, 10) === todayUtcIso
    );
    const todayRefs = refereeAppointments.filter(
      (r) => !r.timestamp || r.timestamp.slice(0, 10) === todayUtcIso
    );
    const payload = {
      source: "footymetrics.com (Opta-Level Stats, Form & Referees)",
      todayIso: todayUtcIso,
      fetchedAt: new Date().toISOString(),
      fixturesCount: fixtures.length,
      refereeAppointmentsCount: todayRefs.length,
      playerTrendsCount: todayTrends.length,
      fixtures,
      playerTrends: todayTrends,
      refereeAppointments: todayRefs
        .sort((a, b) => (b.cardsPg || 0) - (a.cardsPg || 0))
        .slice(0, 60),
      topReferees
    };

    if (fixtures.length > 0 || refereeAppointments.length > 0) {
      cachedFootyMetrics = payload;
      lastFetchMs = Date.now();
    }
    return cachedFootyMetrics || payload;
  })();

  try {
    return await inFlightPromise;
  } finally {
    inFlightPromise = null;
  }
}

module.exports = async function handleFootyMetricsProxy(req, res) {
  try {
    const reqUrl = new URL(req.url, "http://localhost");
    const force = reqUrl.searchParams.get("refresh") === "1";
    const data = await fetchFootyMetricsIntelligence(force);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=120"
    });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err?.message || "FootyMetrics sync error" }));
  }
};

module.exports.fetchFootyMetricsIntelligence = fetchFootyMetricsIntelligence;
