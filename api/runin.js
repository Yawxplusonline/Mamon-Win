// Public SoccerSTATS.com Run-In Analysis Proxy & Parser for MAMON WIN
// Uses public Run-In Analysis tables (no logins/memberships):
// Opponents Played (PLD PPG), Remaining Opponents (REM PPG), Played vs Remaining (% diff)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOCCERSTATS_LEAGUES = [
  { code: "england", espnCode: "eng.1", mamonSlug: "england-premier-league", name: "Premier League", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/premier-league/england", priority: 1 },
  { code: "spain", espnCode: "esp.1", mamonSlug: "spain-la-liga", name: "La Liga", country: "Spain", flag: "🇪🇸", path: "spain/laliga/spain", priority: 2 },
  { code: "italy", espnCode: "ita.1", mamonSlug: "italy-serie-a", name: "Serie A", country: "Italy", flag: "🇮🇹", path: "italy/serie-a/italy", priority: 3 },
  { code: "germany", espnCode: "ger.1", mamonSlug: "germany-bundesliga", name: "Bundesliga", country: "Germany", flag: "🇩🇪", path: "germany/bundesliga/germany", priority: 4 },
  { code: "france", espnCode: "fra.1", mamonSlug: "france-ligue-1", name: "Ligue 1", country: "France", flag: "🇫🇷", path: "france/ligue-1/france", priority: 5 },
  { code: "cleague", espnCode: "uefa.champions", mamonSlug: "uefa-champions-league", name: "UEFA Champions League", country: "Europe", flag: "🇪🇺", path: "uefa/champions-league/cleague", priority: 6 },
  { code: "eleague", espnCode: "uefa.europa", mamonSlug: "uefa-europa-league", name: "UEFA Europa League", country: "Europe", flag: "🇪🇺", path: "uefa/europa-league/eleague", priority: 7 },
  { code: "cfleague", espnCode: "uefa.europa.conf", mamonSlug: "uefa-conference-league", name: "UEFA Conference League", country: "Europe", flag: "🇪🇺", path: "uefa/conference-league/cfleague", priority: 8 },
  { code: "netherlands", espnCode: "ned.1", mamonSlug: "netherlands-eredivisie", name: "Eredivisie", country: "Netherlands", flag: "🇳🇱", path: "netherlands/eredivisie/netherlands", priority: 9 },
  { code: "portugal", espnCode: "por.1", mamonSlug: "portugal-primeira-liga", name: "Liga Portugal", country: "Portugal", flag: "🇵🇹", path: "portugal/liga-portugal/portugal", priority: 10 },
  { code: "turkey", espnCode: "tur.1", mamonSlug: "turkey-super-lig", name: "Süper Lig", country: "Turkey", flag: "🇹🇷", path: "turkey/super-lig/turkey", priority: 11 },
  { code: "belgium", espnCode: "bel.1", mamonSlug: "belgium-first-division-a", name: "Pro League", country: "Belgium", flag: "🇧🇪", path: "belgium/pro-league/belgium", priority: 12 },
  { code: "scotland", espnCode: "sco.1", mamonSlug: "scotland-premiership", name: "Scottish Premiership", country: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", path: "scotland/premiership/scotland", priority: 13 },
  { code: "england2", espnCode: "eng.2", mamonSlug: "england-championship", name: "Championship", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/championship/england2", priority: 14 },
  { code: "germany2", espnCode: "ger.2", mamonSlug: "germany-2-bundesliga", name: "2. Bundesliga", country: "Germany", flag: "🇩🇪", path: "germany/2-bundesliga/germany2", priority: 15 },
  { code: "spain2", espnCode: "esp.2", mamonSlug: "spain-segunda-division", name: "LaLiga 2", country: "Spain", flag: "🇪🇸", path: "spain/laliga2/spain2", priority: 16 },
  { code: "italy2", espnCode: "ita.2", mamonSlug: "italy-serie-b", name: "Serie B", country: "Italy", flag: "🇮🇹", path: "italy/serie-b/italy2", priority: 17 },
  { code: "france2", espnCode: "fra.2", mamonSlug: "france-ligue-2", name: "Ligue 2", country: "France", flag: "🇫🇷", path: "france/ligue-2/france2", priority: 18 },
  { code: "brazil", espnCode: "bra.1", mamonSlug: "brazil-serie-a", name: "Brazil Serie A", country: "Brazil", flag: "🇧🇷", path: "brazil/serie-a/brazil", priority: 19 },
  { code: "argentina", espnCode: "arg.1", mamonSlug: "argentina-liga-profesional", name: "Liga Profesional", country: "Argentina", flag: "🇦🇷", path: "argentina/liga-profesional/argentina", priority: 20 },
  { code: "england3", espnCode: "eng.3", mamonSlug: "england-league-one", name: "League One", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/league-one/england3", priority: 21 },
  { code: "england4", espnCode: "eng.4", mamonSlug: "england-league-two", name: "League Two", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/league-two/england4", priority: 22 },
  { code: "england5", espnCode: "eng.5", mamonSlug: "england-national-league", name: "National League", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/national-league/england5", priority: 23 },
  { code: "netherlands2", espnCode: "ned.2", mamonSlug: "netherlands-eerste-divisie", name: "Eerste Divisie", country: "Netherlands", flag: "🇳🇱", path: "netherlands/eerste-divisie/netherlands2", priority: 24 },
  { code: "portugal2", espnCode: "por.2", mamonSlug: "portugal-liga-2", name: "Liga Portugal 2", country: "Portugal", flag: "🇵🇹", path: "portugal/liga-portugal-2/portugal2", priority: 25 },
  { code: "scotland2", espnCode: "sco.2", mamonSlug: "scotland-championship", name: "Scottish Championship", country: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", path: "scotland/championship/scotland2", priority: 26 },
  { code: "austria", espnCode: "aut.1", mamonSlug: "austria-bundesliga", name: "Austrian Bundesliga", country: "Austria", flag: "🇦🇹", path: "austria/bundesliga/austria", priority: 27 },
  { code: "switzerland", espnCode: "sui.1", mamonSlug: "switzerland-super-league", name: "Swiss Super League", country: "Switzerland", flag: "🇨🇭", path: "switzerland/super-league/switzerland", priority: 28 },
  { code: "denmark", espnCode: "den.1", mamonSlug: "denmark-superligaen", name: "Superligaen", country: "Denmark", flag: "🇩🇰", path: "denmark/superligaen/denmark", priority: 29 },
  { code: "greece", espnCode: "gre.1", mamonSlug: "greece-super-league", name: "Super League Greece", country: "Greece", flag: "🇬🇷", path: "greece/super-league/greece", priority: 30 },
  { code: "norway", espnCode: "nor.1", mamonSlug: "norway-eliteserien", name: "Eliteserien", country: "Norway", flag: "🇳🇴", path: "norway/eliteserien/norway", priority: 31 },
  { code: "sweden", espnCode: "swe.1", mamonSlug: "sweden-allsvenskan", name: "Allsvenskan", country: "Sweden", flag: "🇸🇪", path: "sweden/allsvenskan/sweden", priority: 32 },
  { code: "poland", espnCode: "pol.1", mamonSlug: "poland-ekstraklasa", name: "Ekstraklasa", country: "Poland", flag: "🇵🇱", path: "poland/ekstraklasa/poland", priority: 33 },
  { code: "czechrepublic", espnCode: "cze.1", mamonSlug: "czech-first-league", name: "Czech 1. Liga", country: "Czech Republic", flag: "🇨🇿", path: "czechrepublic/1-liga/czechrepublic", priority: 34 },
  { code: "russia", espnCode: "rus.1", mamonSlug: "russia-premier-league", name: "Russian Premier League", country: "Russia", flag: "🇷🇺", path: "russia/premier-league/russia", priority: 35 },
  { code: "ukraine", espnCode: "ukr.1", mamonSlug: "ukraine-premier-league", name: "Ukrainian Premier League", country: "Ukraine", flag: "🇺🇦", path: "ukraine/premier-league/ukraine", priority: 36 },
  { code: "japan", espnCode: "jpn.1", mamonSlug: "japan-j1-league", name: "J1 League", country: "Japan", flag: "🇯🇵", path: "japan/j1-league/japan", priority: 37 },
  { code: "southkorea", espnCode: "kor.1", mamonSlug: "south-korea-k-league-1", name: "K League 1", country: "South Korea", flag: "🇰🇷", path: "southkorea/k-league-1/southkorea", priority: 38 },
  { code: "australia", espnCode: "aus.1", mamonSlug: "australia-a-league", name: "A-League", country: "Australia", flag: "🇦🇺", path: "australia/a-league/australia", priority: 39 },
  { code: "finland", espnCode: "fin.1", mamonSlug: "finland-veikkausliiga", name: "Veikkausliiga", country: "Finland", flag: "🇫🇮", path: "finland/veikkausliiga/finland", priority: 40 }
];

const CORE_TOP_CODES = [
  "england", "spain", "italy", "germany", "france",
  "cleague", "eleague", "cfleague",
  "netherlands", "portugal", "turkey", "belgium", "scotland",
  "england2", "germany2", "spain2", "italy2", "france2",
  "brazil", "argentina"
];

const leagueCache = new Map(); // code -> { expiresAt, payload }
const inFlight = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000;

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const TEAM_KEY_ALIASES = {
  "manchester city": "man city",
  "manchester united": "man utd",
  "man united": "man utd",
  "tottenham hotspur": "tottenham",
  "spurs": "tottenham",
  "wolverhampton wanderers": "wolves",
  "wolverhampton": "wolves",
  "nottm forest": "nottingham forest",
  "nott m forest": "nottingham forest",
  "newcastle united": "newcastle",
  "newcastle utd": "newcastle",
  "west ham united": "west ham",
  "brighton hove albion": "brighton",
  "brighton and hove albion": "brighton",
  "leicester city": "leicester",
  "leeds united": "leeds",
  "leeds utd": "leeds",
  "ipswich town": "ipswich",
  "sheffield united": "sheffield utd",
  "paris saint germain": "paris sg",
  "psg": "paris sg",
  "inter milan": "inter",
  "internazionale": "inter",
  "ac milan": "milan",
  "atletico de madrid": "atletico madrid",
  "ath bilbao": "athletic bilbao",
  "athletic club": "athletic bilbao",
  "bayern munchen": "bayern munich",
  "bayer 04 leverkusen": "bayer leverkusen",
  "borussia monchengladbach": "monchengladbach",
  "sporting cp": "sporting"
};

function normalizeTeamKey(name) {
  const cleaned = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\b(fc|cf|sc|afc|ac|as|us|cd|ud|rcd|rc|sd|sv|vfl|vfb|fsv|tsg|rb|bsc|fk|sk|if|bk|ik|aik)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_KEY_ALIASES[cleaned] || cleaned;
}

function resolveLeagueMeta(queryCode) {
  const q = String(queryCode || "england").trim().toLowerCase();
  return (
    SOCCERSTATS_LEAGUES.find(
      (l) =>
        l.code === q ||
        l.espnCode.toLowerCase() === q ||
        l.mamonSlug.toLowerCase() === q ||
        l.name.toLowerCase() === q
    ) || SOCCERSTATS_LEAGUES[0]
  );
}

function parseTooltipOpponents(tooltipHtml) {
  if (!tooltipHtml) return [];
  const items = [];
  // Matches: (H) vs <strong>Hull City</strong> <span>(PPG away = 0.80)</span>
  // or (A) at <strong>Liverpool</strong> <span>(PPG at home = 1.00)</span>
  const entryRegex = /\(([HA])\)\s*(?:vs|at)<\/span>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<span[^>]*>\(([^)]+)\)<\/span>/gi;
  let m;
  while ((m = entryRegex.exec(tooltipHtml)) !== null) {
    const venue = m[1].toUpperCase();
    const opponent = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, "").trim());
    const ppgText = m[3].trim();
    const ppgNumMatch = ppgText.match(/([\d.]+)/);
    const oppVenuePpg = ppgNumMatch ? Number(ppgNumMatch[1]) : null;
    items.push({
      venue,
      opponent,
      oppVenuePpg,
      label: `(${venue}) ${venue === "H" ? "vs" : "at"} ${opponent}`,
      ppgLabel: ppgText
    });
  }
  return items;
}

function parseRuninHtml(html, leagueMeta) {
  const rows = html.match(/<tr class="access-row"[\s\S]*?<\/tr>/gi) || [];
  const parsed = [];

  for (const rowHtml of rows) {
    const tds = rowHtml.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (tds.length < 11) continue;

    const stripTags = (s) => decodeHtmlEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const cleanCellText = (tdHtml) => {
      const noTooltip = tdHtml.replace(/<div class="ppi-tooltip-content"[\s\S]*?<\/div>\s*<\/div>/gi, "");
      return stripTags(noTooltip);
    };

    const rank = parseInt(stripTags(tds[0]), 10) || parsed.length + 1;
    const teamAnchorMatch = tds[1].match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const teamUrl = teamAnchorMatch ? teamAnchorMatch[1] : "";
    const team = teamAnchorMatch ? stripTags(teamAnchorMatch[2]) : stripTags(tds[1]);
    if (!team) continue;

    const gp = parseInt(stripTags(tds[2]), 10) || 0;
    const w = parseInt(stripTags(tds[3]), 10) || 0;
    const d = parseInt(stripTags(tds[4]), 10) || 0;
    const l = parseInt(stripTags(tds[5]), 10) || 0;
    const pts = parseInt(stripTags(tds[6]), 10) || 0;
    const ppg = parseFloat(stripTags(tds[7])) || (gp > 0 ? Math.round((pts / gp) * 100) / 100 : 0);

    // Cell 8: Opponents Played PPG (PLD) + tooltip list
    const pldRawMatch = tds[8].match(/font-weight:\s*bold[^>]*>([\d.-]+)</i);
    const playedPpg = pldRawMatch ? parseFloat(pldRawMatch[1]) : parseFloat(cleanCellText(tds[8])) || 0;
    const pldTooltipMatch = tds[8].match(/<div class="ppi-tooltip-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    const playedOpponents = parseTooltipOpponents(pldTooltipMatch ? pldTooltipMatch[1] : tds[8]);

    // Cell 9: Opponents Remaining PPG (REM) + tooltip list + strength bar width
    const remRawMatch = tds[9].match(/color:\s*#2563eb[^>]*>([\d.-]+)</i);
    const remainingPpg = remRawMatch ? parseFloat(remRawMatch[1]) : parseFloat(cleanCellText(tds[9])) || 0;
    const remBarMatch = tds[9].match(/width:\s*([\d.]+)%;\s*background:\s*#3b82f6/i);
    const remainingBarPct = remBarMatch ? Math.round(parseFloat(remBarMatch[1]) * 10) / 10 : Math.min(100, Math.round((remainingPpg / 3) * 100));
    const remTooltipMatch = tds[9].match(/<div class="ppi-tooltip-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    const remainingOpponents = parseTooltipOpponents(remTooltipMatch ? remTooltipMatch[1] : tds[9]);

    // Cell 10: Played vs Remaining (%) comparison
    const diffText = stripTags(tds[10]);
    const diffMatch = diffText.match(/([+-]?\d+)\s*%/);
    const computedDiff = playedPpg > 0 ? Math.round(((playedPpg - remainingPpg) / playedPpg) * 100) : 0;
    const diffPct = diffMatch ? parseInt(diffMatch[1], 10) : computedDiff;
    const diffLabel = `${diffPct > 0 ? "+" : ""}${diffPct}%`;
    const verdict = diffPct > 0 ? "FAVORABLE" : diffPct < 0 ? "TOUGH" : "BALANCED";

    parsed.push({
      rank,
      team,
      teamNormalized: normalizeTeamKey(team),
      teamUrl: teamUrl ? `https://www.soccerstats.com${teamUrl}` : "",
      leagueCode: leagueMeta.code,
      espnCode: leagueMeta.espnCode,
      leagueName: leagueMeta.name,
      country: leagueMeta.country,
      gp,
      w,
      d,
      l,
      pts,
      ppg: Math.round(ppg * 100) / 100,
      playedPpg: Math.round(playedPpg * 100) / 100,
      remainingPpg: Math.round(remainingPpg * 100) / 100,
      remainingBarPct,
      diffPct,
      diffLabel,
      verdict,
      playedOpponents,
      remainingOpponents
    });
  }

  // Optional Season Summary extraction
  let summary = null;
  const seasonProgressMatch = html.match(/<strong>(\d+)<\/strong>\s*matches played\s*\/\s*(\d+)[\s\S]*?<strong>([\d.]+%)<\/strong>/i);
  if (seasonProgressMatch) {
    summary = {
      matchesPlayed: parseInt(seasonProgressMatch[1], 10),
      totalMatches: parseInt(seasonProgressMatch[2], 10),
      progressPct: seasonProgressMatch[3]
    };
  }

  return {
    rows: parsed,
    summary
  };
}

async function fetchLeagueRunin(leagueCodeOrSlug, forceRefresh = false) {
  const meta = resolveLeagueMeta(leagueCodeOrSlug);
  const now = Date.now();
  const cached = leagueCache.get(meta.code);
  if (!forceRefresh && cached && now < cached.expiresAt) {
    return { ...cached.payload, cache: "HIT" };
  }

  if (inFlight.has(meta.code)) {
    return inFlight.get(meta.code);
  }

  const promise = (async () => {
    try {
      const targetUrl = `https://www.soccerstats.com/en-gb/leagues/${meta.path}/table/runin`;
      const resp = await fetch(targetUrl, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-GB,en;q=0.9"
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!resp.ok) {
        throw new Error(`SoccerSTATS returned HTTP ${resp.status} for ${meta.name}`);
      }

      const html = await resp.text();
      const { rows, summary } = parseRuninHtml(html, meta);

      const payload = {
        ok: true,
        source: "SoccerSTATS.com Run-In Analysis",
        sourceUrl: targetUrl,
        fetchedAt: new Date().toISOString(),
        league: meta,
        summary,
        table: rows
      };

      leagueCache.set(meta.code, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload
      });
      return { ...payload, cache: "MISS" };
    } finally {
      inFlight.delete(meta.code);
    }
  })();

  inFlight.set(meta.code, promise);
  return promise;
}

let cachedTopPayload = null;
let cachedTopExpiresAt = 0;

async function fetchTopLeaguesRunin(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedTopPayload && now < cachedTopExpiresAt) {
    return cachedTopPayload;
  }

  const batchSize = 5;
  const results = [];
  for (let i = 0; i < CORE_TOP_CODES.length; i += batchSize) {
    const slice = CORE_TOP_CODES.slice(i, i + batchSize);
    const batch = await Promise.allSettled(slice.map((c) => fetchLeagueRunin(c, forceRefresh)));
    for (const r of batch) {
      if (r.status === "fulfilled" && r.value?.ok) {
        results.push(r.value);
      }
    }
  }

  const leagueTables = {};
  const teamsIndex = {};
  const compactRow = (row) => ({
    ...row,
    playedCount: row.playedOpponents.length,
    remainingCount: row.remainingOpponents.length,
    playedOpponents: row.playedOpponents.slice(-6),
    remainingOpponents: row.remainingOpponents.slice(0, 6)
  });

  for (const res of results) {
    const compactRows = res.table.map(compactRow);
    leagueTables[res.league.code] = {
      league: res.league,
      summary: res.summary,
      table: compactRows,
      sourceUrl: res.sourceUrl
    };
    for (const row of compactRows) {
      const exactKey = row.team.toLowerCase().trim();
      const normKey = row.teamNormalized;
      if (exactKey && !teamsIndex[exactKey]) teamsIndex[exactKey] = row;
      if (normKey && !teamsIndex[normKey]) teamsIndex[normKey] = row;
    }
  }

  cachedTopPayload = {
    ok: true,
    source: "SoccerSTATS.com Run-In Analysis",
    fetchedAt: new Date().toISOString(),
    leaguesCount: results.length,
    leagues: SOCCERSTATS_LEAGUES,
    leagueTables,
    teamsIndex
  };
  cachedTopExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedTopPayload;
}

module.exports = async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const mode = String(req.query?.mode ?? reqUrl.searchParams.get("mode") ?? "").trim().toLowerCase();
    const leagueParam = String(req.query?.league ?? reqUrl.searchParams.get("league") ?? "england").trim();
    const refresh = (req.query?.refresh ?? reqUrl.searchParams.get("refresh")) === "1";

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (mode === "catalog") {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, leagues: SOCCERSTATS_LEAGUES }));
      return;
    }

    if (mode === "top" || mode === "all") {
      const payload = await fetchTopLeaguesRunin(refresh);
      res.statusCode = 200;
      res.end(JSON.stringify(payload));
      return;
    }

    const data = await fetchLeagueRunin(leagueParam, refresh);
    res.statusCode = 200;
    res.end(JSON.stringify({ ...data, leagues: SOCCERSTATS_LEAGUES }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: err?.message || "Run-In Analysis fetch failed", leagues: SOCCERSTATS_LEAGUES }));
  }
};

module.exports.fetchLeagueRunin = fetchLeagueRunin;
module.exports.fetchTopLeaguesRunin = fetchTopLeaguesRunin;
module.exports.SOCCERSTATS_LEAGUES = SOCCERSTATS_LEAGUES;
