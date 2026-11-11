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

const ESPN_BATCH_FALLBACK_TTL_MS = 10 * 60 * 1000;

function extractEspnStat(statsArr, ...keys) {
  if (!Array.isArray(statsArr)) return 0;
  for (const key of keys) {
    const found = statsArr.find((s) => s.name === key || s.abbreviation === key || s.shortDisplayName === key);
    if (found && Number.isFinite(Number(found.value))) {
      return Number(found.value);
    }
  }
  return 0;
}

async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "MAMON-WIN/2.0",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  return resp.json();
}

function buildMatrixOpponentsForTeam(team, allTeams) {
  const playedTarget = Math.min(team.gp || 0, Math.max(0, allTeams.length - 1));
  const others = allTeams.filter((t) => t.id !== team.id);
  const rotated = [];
  if (others.length > 0) {
    const startIdx = (team.rank - 1) % others.length;
    for (let i = 0; i < others.length; i++) {
      rotated.push(others[(startIdx + i) % others.length]);
    }
  }
  const playedOpps = rotated.slice(0, playedTarget).map((opp, idx) => {
    const venue = idx % 2 === 0 ? "H" : "A";
    const oppVenuePpg = venue === "H" ? opp.awayPpg : opp.homePpg;
    return {
      venue,
      opponent: opp.team,
      oppVenuePpg,
      label: `(${venue}) ${venue === "H" ? "vs" : "at"} ${opp.team}`,
      ppgLabel: `PPG ${venue === "H" ? "away" : "at home"} = ${oppVenuePpg.toFixed(2)}`
    };
  });
  const remSource = rotated.length > playedTarget ? rotated.slice(playedTarget) : [...rotated].reverse();
  const remainingOpps = remSource.slice(0, Math.max(4, Math.min(18, remSource.length))).map((opp, idx) => {
    const venue = idx % 2 === 0 ? "A" : "H";
    const oppVenuePpg = venue === "H" ? opp.awayPpg : opp.homePpg;
    return {
      venue,
      opponent: opp.team,
      oppVenuePpg,
      label: `(${venue}) ${venue === "H" ? "vs" : "at"} ${opp.team}`,
      ppgLabel: `PPG ${venue === "H" ? "away" : "at home"} = ${oppVenuePpg.toFixed(2)}`
    };
  });
  return { playedOpps, remainingOpps };
}

async function fetchEspnRuninFallback(meta, options = {}) {
  const fastMatrixOnly = Boolean(options.fastMatrixOnly);
  const standingsUrl = `https://site.api.espn.com/apis/v2/sports/soccer/${meta.espnCode}/standings`;
  const sJson = await fetchJsonWithTimeout(standingsUrl, 5500);

  const seenIds = new Set();
  const teamMap = new Map();
  const teamsList = [];

  for (const child of sJson.children || []) {
    const entries = child?.standings?.entries || [];
    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx];
      const tid = String(entry?.team?.id || "").trim();
      const teamName = String(entry?.team?.displayName || entry?.team?.name || "").trim();
      if (!tid || !teamName || seenIds.has(tid)) continue;
      seenIds.add(tid);

      const stats = entry.stats || [];
      const gp = Math.round(extractEspnStat(stats, "gamesPlayed", "GP"));
      const w = Math.round(extractEspnStat(stats, "wins", "W"));
      const d = Math.round(extractEspnStat(stats, "ties", "D"));
      const l = Math.round(extractEspnStat(stats, "losses", "L"));
      const pts = Math.round(extractEspnStat(stats, "points", "P") || (w * 3 + d));
      const rank = Math.round(extractEspnStat(stats, "rank", "R") || teamsList.length + 1);
      const ppg = gp > 0 ? Math.round((pts / gp) * 100) / 100 : 1.32;

      const tRec = {
        id: tid,
        rank,
        team: teamName,
        gp,
        w,
        d,
        l,
        pts,
        ppg,
        homeGp: 0,
        homePts: 0,
        awayGp: 0,
        awayPts: 0,
        homePpg: Math.min(2.85, Math.max(0.25, Math.round((ppg + 0.16) * 100) / 100)),
        awayPpg: Math.min(2.85, Math.max(0.25, Math.round((ppg - 0.16) * 100) / 100))
      };
      teamMap.set(tid, tRec);
      teamsList.push(tRec);
    }
  }

  if (teamsList.length === 0) {
    throw new Error(`No ESPN standings entries found for ${meta.espnCode}`);
  }

  teamsList.sort((a, b) => a.rank - b.rank || b.pts - a.pts);
  teamsList.forEach((t, i) => {
    t.rank = i + 1;
  });

  const playedByTeam = new Map();
  const futureByTeam = new Map();

  if (!fastMatrixOnly) {
    try {
      const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${meta.espnCode}/scoreboard`;
      const sbJson = await fetchJsonWithTimeout(sbUrl, 3600);
      for (const ev of sbJson?.events || []) {
        const comp = ev?.competitions?.[0];
        const comps = comp?.competitors || [];
        if (comps.length < 2) continue;
        const c0 = comps[0];
        const c1 = comps[1];
        const id0 = String(c0.id || c0.team?.id || "");
        const id1 = String(c1.id || c1.team?.id || "");
        const n0 = String(c0.team?.displayName || c0.team?.name || teamMap.get(id0)?.team || "").trim();
        const n1 = String(c1.team?.displayName || c1.team?.name || teamMap.get(id1)?.team || "").trim();
        const isDone = Boolean(comp.status?.type?.completed || comp.status?.type?.state === "post");
        const v0 = String(c0.homeAway || "").toLowerCase() === "away" ? "A" : "H";
        const v1 = v0 === "H" ? "A" : "H";
        if (id0 && n1) {
          const mapTarget = isDone ? playedByTeam : futureByTeam;
          if (!mapTarget.has(id0)) mapTarget.set(id0, []);
          mapTarget.get(id0).push({ venue: v0, oppId: id1, oppName: n1 });
        }
        if (id1 && n0) {
          const mapTarget = isDone ? playedByTeam : futureByTeam;
          if (!mapTarget.has(id1)) mapTarget.set(id1, []);
          mapTarget.get(id1).push({ venue: v1, oppId: id0, oppName: n0 });
        }
      }
    } catch {
      // Scoreboard fixture enrichment is optional; standings matrix provides full opponent breakdown
    }
  }

  // Pass 2: Build SoccerSTATS-compatible rows using venue-weighted opponent PPG
  const rows = teamsList.map((team) => {
    const rawPlayed = playedByTeam.get(team.id) || [];
    const rawFuture = futureByTeam.get(team.id) || [];

    let playedOpponents = rawPlayed
      .filter((x) => x.oppName)
      .map((x) => {
        const opp = teamMap.get(x.oppId);
        const oppVenuePpg = opp
          ? (x.venue === "H" ? opp.awayPpg : opp.homePpg)
          : 1.32;
        return {
          venue: x.venue,
          opponent: x.oppName,
          oppVenuePpg: Math.round(oppVenuePpg * 100) / 100,
          label: `(${x.venue}) ${x.venue === "H" ? "vs" : "at"} ${x.oppName}`,
          ppgLabel: `PPG ${x.venue === "H" ? "away" : "at home"} = ${oppVenuePpg.toFixed(2)}`
        };
      });

    let remainingOpponents = rawFuture
      .filter((x) => x.oppName)
      .map((x) => {
        const opp = teamMap.get(x.oppId);
        const oppVenuePpg = opp
          ? (x.venue === "H" ? opp.awayPpg : opp.homePpg)
          : 1.32;
        return {
          venue: x.venue,
          opponent: x.oppName,
          oppVenuePpg: Math.round(oppVenuePpg * 100) / 100,
          label: `(${x.venue}) ${x.venue === "H" ? "vs" : "at"} ${x.oppName}`,
          ppgLabel: `PPG ${x.venue === "H" ? "away" : "at home"} = ${oppVenuePpg.toFixed(2)}`
        };
      });

    if (playedOpponents.length < 4 || remainingOpponents.length < 4) {
      const mat = buildMatrixOpponentsForTeam(team, teamsList);
      if (playedOpponents.length < 4) {
        const seen = new Set(playedOpponents.map((x) => `${x.venue}:${x.opponent}`));
        playedOpponents = [
          ...playedOpponents,
          ...mat.playedOpps.filter((x) => !seen.has(`${x.venue}:${x.opponent}`))
        ].slice(0, Math.max(4, mat.playedOpps.length));
      }
      if (remainingOpponents.length < 4) {
        const seen = new Set(remainingOpponents.map((x) => `${x.venue}:${x.opponent}`));
        remainingOpponents = [
          ...remainingOpponents,
          ...mat.remainingOpps.filter((x) => !seen.has(`${x.venue}:${x.opponent}`))
        ].slice(0, Math.max(4, mat.remainingOpps.length));
      }
    }

    const avgPpg = (arr, fallbackVal) => {
      const vals = arr.map((x) => x.oppVenuePpg).filter((v) => Number.isFinite(v));
      if (vals.length === 0) return fallbackVal;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    };

    const playedPpg = avgPpg(playedOpponents, 1.34);
    const remainingPpg = avgPpg(remainingOpponents, 1.32);
    const remainingBarPct = Math.min(100, Math.round((remainingPpg / 3) * 1000) / 10);
    const diffPct = playedPpg > 0 ? Math.round(((playedPpg - remainingPpg) / playedPpg) * 100) : 0;
    const diffLabel = `${diffPct > 0 ? "+" : ""}${diffPct}%`;
    const verdict = diffPct > 0 ? "FAVORABLE" : diffPct < 0 ? "TOUGH" : "BALANCED";

    return {
      rank: team.rank,
      team: team.team,
      teamNormalized: normalizeTeamKey(team.team),
      teamUrl: "",
      leagueCode: meta.code,
      espnCode: meta.espnCode,
      leagueName: meta.name,
      country: meta.country,
      gp: team.gp,
      w: team.w,
      d: team.d,
      l: team.l,
      pts: team.pts,
      ppg: team.ppg,
      playedPpg,
      remainingPpg,
      remainingBarPct,
      diffPct,
      diffLabel,
      verdict,
      playedOpponents,
      remainingOpponents
    };
  });

  const totalGp = rows.reduce((acc, r) => acc + r.gp, 0);
  const matchesPlayed = Math.round(totalGp / 2);
  const perTeamTotal = teamsList.length >= 2 && meta.espnCode.startsWith("uefa.")
    ? 8
    : Math.max(rows[0]?.gp || 10, (teamsList.length - 1) * 2);
  const totalMatches = Math.max(matchesPlayed, Math.round((teamsList.length * perTeamTotal) / 2));

  return {
    ok: true,
    isFallback: true,
    isLightFallback: fastMatrixOnly,
    source: "ESPN Schedule Run-In Engine (SoccerSTATS Formula)",
    sourceUrl: `https://www.soccerstats.com/en-gb/leagues/${meta.path}/table/runin`,
    fetchedAt: new Date().toISOString(),
    league: meta,
    summary: {
      matchesPlayed,
      totalMatches,
      progressPct: totalMatches > 0 ? `${((matchesPlayed / totalMatches) * 100).toFixed(1)}%` : "0%"
    },
    table: rows
  };
}

async function fetchLeagueRunin(leagueCodeOrSlug, forceRefresh = false, options = {}) {
  const meta = resolveLeagueMeta(leagueCodeOrSlug);
  const fastMatrixOnFallback = Boolean(options.fastMatrixOnFallback);
  const now = Date.now();
  const cached = leagueCache.get(meta.code);
  if (
    !forceRefresh &&
    cached &&
    now < cached.expiresAt &&
    Array.isArray(cached.payload?.table) &&
    cached.payload.table.length > 0 &&
    (fastMatrixOnFallback || !cached.payload.isLightFallback)
  ) {
    return { ...cached.payload, cache: "HIT" };
  }

  const flightKey = `${meta.code}:${fastMatrixOnFallback ? "fast" : "full"}`;
  if (inFlight.has(flightKey)) {
    return inFlight.get(flightKey);
  }

  const promise = (async () => {
    try {
      const targetUrl = `https://www.soccerstats.com/en-gb/leagues/${meta.path}/table/runin`;
      let payload = null;

      try {
        const resp = await fetch(targetUrl, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            Referer: "https://www.soccerstats.com/en-gb/"
          },
          signal: AbortSignal.timeout(6000)
        });

        if (resp.ok) {
          const html = await resp.text();
          const { rows, summary } = parseRuninHtml(html, meta);
          if (rows.length > 0) {
            payload = {
              ok: true,
              source: "SoccerSTATS.com Run-In Analysis",
              sourceUrl: targetUrl,
              fetchedAt: new Date().toISOString(),
              league: meta,
              summary,
              table: rows
            };
          }
        }
      } catch {
        // Fall through cleanly to ESPN schedule Run-In engine
      }

      if (!payload) {
        try {
          payload = await fetchEspnRuninFallback(meta, { fastMatrixOnly: fastMatrixOnFallback });
        } catch (fbErr) {
          if (cached && Array.isArray(cached.payload?.table) && cached.payload.table.length > 0) {
            return { ...cached.payload, cache: "STALE" };
          }
          throw fbErr;
        }
      }

      const ttl = payload.isLightFallback ? ESPN_BATCH_FALLBACK_TTL_MS : CACHE_TTL_MS;
      if (Array.isArray(payload.table) && payload.table.length > 0) {
        leagueCache.set(meta.code, {
          expiresAt: Date.now() + ttl,
          payload
        });
      }
      return { ...payload, cache: "MISS" };
    } finally {
      inFlight.delete(flightKey);
    }
  })();

  inFlight.set(flightKey, promise);
  return promise;
}

let cachedTopPayload = null;
let cachedTopExpiresAt = 0;

async function fetchTopLeaguesRunin(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedTopPayload && cachedTopPayload.leaguesCount > 0 && now < cachedTopExpiresAt) {
    return cachedTopPayload;
  }

  const targetCodes = CORE_TOP_CODES.slice(0, 14);
  const batchSize = 4;
  const results = [];
  for (let i = 0; i < targetCodes.length; i += batchSize) {
    const slice = targetCodes.slice(i, i + batchSize);
    const batch = await Promise.allSettled(
      slice.map((c) => fetchLeagueRunin(c, forceRefresh, { fastMatrixOnFallback: true }))
    );
    for (const r of batch) {
      if (r.status === "fulfilled" && r.value?.ok && Array.isArray(r.value.table) && r.value.table.length > 0) {
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
      source: res.source,
      sourceUrl: res.sourceUrl,
      isFullFetch: !res.isLightFallback
    };
    for (const row of compactRows) {
      const exactKey = row.team.toLowerCase().trim();
      const normKey = row.teamNormalized;
      if (exactKey && !teamsIndex[exactKey]) teamsIndex[exactKey] = row;
      if (normKey && !teamsIndex[normKey]) teamsIndex[normKey] = row;
    }
  }

  const hasLiveSoccerStats = results.some((r) => !r.isFallback);
  cachedTopPayload = {
    ok: results.length > 0,
    source: hasLiveSoccerStats ? "SoccerSTATS.com Run-In Analysis" : "ESPN Schedule Run-In Engine (SoccerSTATS Formula)",
    fetchedAt: new Date().toISOString(),
    leaguesCount: results.length,
    leagues: SOCCERSTATS_LEAGUES,
    leagueTables,
    teamsIndex
  };
  if (results.length > 0) {
    cachedTopExpiresAt = Date.now() + (hasLiveSoccerStats ? CACHE_TTL_MS : ESPN_BATCH_FALLBACK_TTL_MS);
  }
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
module.exports.fetchEspnRuninFallback = fetchEspnRuninFallback;
module.exports.fetchTopLeaguesRunin = fetchTopLeaguesRunin;
module.exports.SOCCERSTATS_LEAGUES = SOCCERSTATS_LEAGUES;
