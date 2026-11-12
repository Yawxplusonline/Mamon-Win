// Public SoccerSTATS.com & Real-Time ESPN/OneFootball Big-Data Run-In Engine for MAMON WIN
// Uses Run-In Analysis tables (no logins/memberships):
// Opponents Played (PLD PPG), Immediate 5 & Remaining Opponents (REM PPG), Played vs Remaining (% diff)

const { canonicalizeLeagueAndCountry } = require("./leagueCatalog");
let onefootballApi = null;
try {
  onefootballApi = require("./onefootball");
} catch {
  onefootballApi = null;
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOCCERSTATS_LEAGUES = [
  { code: "england", espnCode: "eng.1", mamonSlug: "england-premier-league", name: "English Premier League", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/premier-league/england", priority: 1 },
  { code: "spain", espnCode: "esp.1", mamonSlug: "spain-la-liga", name: "Spanish La Liga", country: "Spain", flag: "🇪🇸", path: "spain/laliga/spain", priority: 2 },
  { code: "italy", espnCode: "ita.1", mamonSlug: "italy-serie-a", name: "Italian Serie A", country: "Italy", flag: "🇮🇹", path: "italy/serie-a/italy", priority: 3 },
  { code: "germany", espnCode: "ger.1", mamonSlug: "germany-bundesliga", name: "German Bundesliga", country: "Germany", flag: "🇩🇪", path: "germany/bundesliga/germany", priority: 4 },
  { code: "france", espnCode: "fra.1", mamonSlug: "france-ligue-1", name: "French Ligue 1", country: "France", flag: "🇫🇷", path: "france/ligue-1/france", priority: 5 },
  { code: "cleague", espnCode: "uefa.champions", mamonSlug: "uefa-champions-league", name: "UEFA Champions League", country: "Europe", flag: "🇪🇺", path: "uefa/champions-league/cleague", priority: 6 },
  { code: "eleague", espnCode: "uefa.europa", mamonSlug: "uefa-europa-league", name: "UEFA Europa League", country: "Europe", flag: "🇪🇺", path: "uefa/europa-league/eleague", priority: 7 },
  { code: "cfleague", espnCode: "uefa.europa.conf", mamonSlug: "uefa-conference-league", name: "UEFA Conference League", country: "Europe", flag: "🇪🇺", path: "uefa/conference-league/cfleague", priority: 8 },
  { code: "netherlands", espnCode: "ned.1", mamonSlug: "netherlands-eredivisie", name: "Dutch Eredivisie", country: "Netherlands", flag: "🇳🇱", path: "netherlands/eredivisie/netherlands", priority: 9 },
  { code: "portugal", espnCode: "por.1", mamonSlug: "portugal-primeira-liga", name: "Portuguese Primeira Liga", country: "Portugal", flag: "🇵🇹", path: "portugal/liga-portugal/portugal", priority: 10 },
  { code: "turkey", espnCode: "tur.1", mamonSlug: "turkey-super-lig", name: "Turkish Süper Lig", country: "Turkey", flag: "🇹🇷", path: "turkey/super-lig/turkey", priority: 11 },
  { code: "belgium", espnCode: "bel.1", mamonSlug: "belgium-first-division-a", name: "Belgian Pro League", country: "Belgium", flag: "🇧🇪", path: "belgium/pro-league/belgium", priority: 12 },
  { code: "scotland", espnCode: "sco.1", mamonSlug: "scotland-premiership", name: "Scottish Premiership", country: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", path: "scotland/premiership/scotland", priority: 13 },
  { code: "england2", espnCode: "eng.2", mamonSlug: "england-championship", name: "English Championship", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/championship/england2", priority: 14 },
  { code: "germany2", espnCode: "ger.2", mamonSlug: "germany-2-bundesliga", name: "German 2. Bundesliga", country: "Germany", flag: "🇩🇪", path: "germany/2-bundesliga/germany2", priority: 15 },
  { code: "spain2", espnCode: "esp.2", mamonSlug: "spain-segunda-division", name: "Spanish LaLiga 2", country: "Spain", flag: "🇪🇸", path: "spain/laliga2/spain2", priority: 16 },
  { code: "italy2", espnCode: "ita.2", mamonSlug: "italy-serie-b", name: "Italian Serie B", country: "Italy", flag: "🇮🇹", path: "italy/serie-b/italy2", priority: 17 },
  { code: "france2", espnCode: "fra.2", mamonSlug: "france-ligue-2", name: "French Ligue 2", country: "France", flag: "🇫🇷", path: "france/ligue-2/france2", priority: 18 },
  { code: "brazil", espnCode: "bra.1", mamonSlug: "brazil-serie-a", name: "Brazilian Serie A", country: "Brazil", flag: "🇧🇷", path: "brazil/serie-a/brazil", priority: 19 },
  { code: "argentina", espnCode: "arg.1", mamonSlug: "argentina-liga-profesional", name: "Argentine Liga Profesional", country: "Argentina", flag: "🇦🇷", path: "argentina/liga-profesional/argentina", priority: 20 },
  { code: "england3", espnCode: "eng.3", mamonSlug: "england-league-one", name: "English League One", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/league-one/england3", priority: 21 },
  { code: "england4", espnCode: "eng.4", mamonSlug: "england-league-two", name: "English League Two", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/league-two/england4", priority: 22 },
  { code: "england5", espnCode: "eng.5", mamonSlug: "england-national-league", name: "English National League", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", path: "england/national-league/england5", priority: 23 },
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

const CORE_TOP_CODES = SOCCERSTATS_LEAGUES.map((l) => l.code);

const leagueCache = new Map(); // code -> { expiresAt, payload }
const inFlight = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

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

const RUNIN_MONTH_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseRuninFixtureTimestamp(op, nowMs = Date.now()) {
  if (!op) return NaN;
  if (Number.isFinite(op.timestamp) && op.timestamp > 1e12) return op.timestamp;
  if (Number.isFinite(op.kickoffMs) && op.kickoffMs > 1e12) return op.kickoffMs;
  const raw = String(op.date || "").trim();
  if (!raw || raw === "undefined" || raw === "null") return NaN;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const isoTs = Date.parse(raw.replace(" · ", "T"));
    if (Number.isFinite(isoTs)) return isoTs;
  }

  let day = NaN;
  let monIdx = NaN;
  let year = NaN;
  let hh = 15;
  let mm = 0;

  let m = raw.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*,?\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?/i);
  if (m) {
    day = parseInt(m[1], 10);
    monIdx = RUNIN_MONTH_MAP[m[2].slice(0, 3).toLowerCase()];
    year = m[3] ? parseInt(m[3], 10) : NaN;
    if (m[4]) hh = parseInt(m[4], 10);
    if (m[5]) mm = parseInt(m[5], 10);
  } else {
    m = raw.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*,?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?/i);
    if (m) {
      monIdx = RUNIN_MONTH_MAP[m[1].slice(0, 3).toLowerCase()];
      day = parseInt(m[2], 10);
      year = m[3] ? parseInt(m[3], 10) : NaN;
      if (m[4]) hh = parseInt(m[4], 10);
      if (m[5]) mm = parseInt(m[5], 10);
    }
  }

  if (Number.isFinite(day) && Number.isFinite(monIdx)) {
    if (Number.isFinite(year)) {
      return Date.UTC(year, monIdx, day, hh, mm);
    }
    const curYear = new Date(nowMs).getUTCFullYear();
    let candidate = Date.UTC(curYear, monIdx, day, hh, mm);
    if (candidate < nowMs - 14 * 86400000) {
      candidate = Date.UTC(curYear + 1, monIdx, day, hh, mm);
    }
    return candidate;
  }

  const fallbackTs = Date.parse(raw.replace(" · ", "T"));
  return Number.isFinite(fallbackTs) && fallbackTs > 1e12 ? fallbackTs : NaN;
}

function sortRemainingChronologically(remList) {
  if (!Array.isArray(remList) || remList.length === 0) return remList || [];
  const nowMs = Date.now();
  const stamped = remList.map((op) => {
    const ts = parseRuninFixtureTimestamp(op, nowMs);
    return Number.isFinite(ts) ? { ...op, timestamp: ts } : op;
  });
  return stamped.sort((a, b) => {
    const ta = Number.isFinite(a.timestamp) ? a.timestamp : NaN;
    const tb = Number.isFinite(b.timestamp) ? b.timestamp : NaN;
    const va = Number.isFinite(ta);
    const vb = Number.isFinite(tb);
    if (va && vb) return ta - tb;
    if (va !== vb) return va ? -1 : 1;
    return 0;
  });
}

function computeRuninTip(row) {
  const ppg = Number(row.ppg) || 0;
  const playedPpg = Number(row.playedPpg) || 1.35;
  const diffPct = Number(row.diffPct) || 0;
  const remPpg = Number(row.remainingPpg) || 0;

  if (Array.isArray(row.remainingOpponents) && row.remainingOpponents.length > 0) {
    row.remainingOpponents = sortRemainingChronologically(row.remainingOpponents).map((op) => {
      const ov = typeof op.oppVenuePpg === "number" ? op.oppVenuePpg : remPpg;
      const gap = ppg - ov;
      let matchTip = "⏭️ Skip (<1.60 PPG)";
      let tipClass = "is-skip";
      if (ppg >= 1.60) {
        if (gap >= 0.45 && ov <= 1.35) {
          matchTip = op.venue === "H" ? "💎 Back Home Win (1)" : "💎 Back Away Win (2)";
          tipClass = "is-strong";
        } else if (gap >= 0.15) {
          matchTip = op.venue === "H" ? "💎 Home or Draw (1X)" : "💎 Away or Draw (X2)";
          tipClass = "is-strong";
        } else {
          matchTip = "🛡️ Caution · +0.5 AH / DNB";
          tipClass = "is-safe";
        }
      } else if (ppg < 1.20) {
        matchTip = "🚫 Weak PPG (Fade)";
        tipClass = "is-avoid";
      }
      return { ...op, matchTip, tipClass };
    });
  }

  // Real-time Big-Data Assessment across the team's IMMEDIATE 5 upcoming matches
  const immediate5 = Array.isArray(row.remainingOpponents) ? row.remainingOpponents.slice(0, 5) : [];
  const imm5Vals = immediate5.map((op) => op.oppVenuePpg).filter((v) => Number.isFinite(v));
  const immediate5Ppg = imm5Vals.length > 0
    ? Math.round((imm5Vals.reduce((s, v) => s + v, 0) / imm5Vals.length) * 100) / 100
    : remPpg;
  const immediate5DiffPct = playedPpg > 0 ? Math.round(((playedPpg - immediate5Ppg) / playedPpg) * 100) : diffPct;
  const immediate5StrongCount = immediate5.filter((op) => op.tipClass === "is-strong").length;
  row.immediate5Ppg = immediate5Ppg;
  row.immediate5DiffPct = immediate5DiffPct;
  row.immediate5StrongCount = immediate5StrongCount;
  row.next5Verdict = immediate5DiffPct >= 5 ? "EASY_NEXT_5" : immediate5DiffPct <= -5 ? "TOUGH_NEXT_5" : "BALANCED_NEXT_5";

  const nextOpp = immediate5.length > 0 ? immediate5[0] : null;
  const oppV = nextOpp?.oppVenuePpg;
  const hasWeakNextOpp = typeof oppV === "number" && oppV <= 1.25;
  const hasModerateNextOpp = typeof oppV === "number" && oppV <= 1.45;
  const nextWhen = nextOpp?.date ? ` (${nextOpp.date})` : "";
  const nextLabel = nextOpp ? `${nextOpp.venue === "H" ? "vs" : "@"} ${nextOpp.opponent}${nextWhen}` : "Next league match";
  const nextOppPpgTxt = typeof oppV === "number" ? oppV.toFixed(2) : immediate5Ppg.toFixed(2);
  const next5Tag = immediate5.length > 0 ? ` · Next 5: ${immediate5StrongCount}/${immediate5.length} strong (Avg ${immediate5Ppg.toFixed(2)})` : "";

  const immMeta = {
    immediate5Ppg,
    immediate5DiffPct,
    immediate5StrongCount,
    next5Verdict: row.next5Verdict
  };

  if (ppg >= 1.85) {
    if (hasModerateNextOpp || immediate5DiffPct >= 0 || diffPct >= 0) {
      const market = nextOpp?.venue === "A" ? "Away Win (2) / X2" : "Home Win (1)";
      return {
        ...immMeta,
        isStrongPpg: true,
        tier: "STRONG_LOCK",
        badge: nextOpp?.venue === "A" ? "💎 BACK AWAY WIN (2) / X2" : "💎 BACK HOME WIN (1)",
        market,
        nextFixtureTip: `${nextLabel} → Back ${market}`,
        reason: `Strong ${ppg.toFixed(2)} PPG vs opp ${nextOppPpgTxt} venue PPG${next5Tag}.`
      };
    }
    const market = nextOpp?.venue === "A" ? "X2 / Draw No Bet" : "1X / Draw No Bet";
    return {
      ...immMeta,
      isStrongPpg: true,
      tier: "STRONG_SAFE",
      badge: `🛡️ STRONG PPG · ${market.toUpperCase()}`,
      market,
      nextFixtureTip: `${nextLabel} → Safe ${market}`,
      reason: `Elite ${ppg.toFixed(2)} PPG vs tough ${nextOppPpgTxt} venue opponent${next5Tag}.`
    };
  }

  if (ppg >= 1.60) {
    if (immediate5DiffPct >= 0 || diffPct >= 0 || hasWeakNextOpp) {
      const market = nextOpp?.venue === "A" ? "Away or Draw (X2)" : "Home Win (1) / 1X";
      return {
        ...immMeta,
        isStrongPpg: true,
        tier: "STRONG_EDGE",
        badge: nextOpp?.venue === "A" ? "💎 STRONG PPG · X2 / OVER 1.5" : "💎 STRONG PPG · HOME (1 / 1X)",
        market,
        nextFixtureTip: `${nextLabel} → ${market}`,
        reason: `Strong ${ppg.toFixed(2)} PPG with ${immediate5DiffPct >= 0 ? "favorable" : "manageable"} immediate 5 (${nextOppPpgTxt} opp PPG)${next5Tag}.`
      };
    }
    const market = nextOpp?.venue === "A" ? "Away +0.5 AH / X2" : "Home +0.5 AH / 1X";
    return {
      ...immMeta,
      isStrongPpg: true,
      tier: "STRONG_CAUTION",
      badge: `🛡️ STRONG PPG · ${nextOpp?.venue === "A" ? "X2" : "1X"} SAFE`,
      market,
      nextFixtureTip: `${nextLabel} → Safe ${market}`,
      reason: `Strong ${ppg.toFixed(2)} PPG, tougher immediate 5 (${immediate5DiffPct}%)${next5Tag}.`
    };
  }

  if (ppg < 1.20) {
    return {
      ...immMeta,
      isStrongPpg: false,
      tier: "WEAK_AVOID",
      badge: `🚫 FADE / WEAK PPG (${ppg.toFixed(2)})`,
      market: "Avoid Backing (Lay)",
      nextFixtureTip: `${nextLabel} → Avoid backing ${row.team}`,
      reason: `Weak ${ppg.toFixed(2)} PPG breaks Strong PPG rule (>=1.60)${next5Tag}.`
    };
  }

  return {
    ...immMeta,
    isStrongPpg: false,
    tier: "MID_SKIP",
    badge: `⏭️ SKIP WIN (<1.60 PPG)`,
    market: "No Strong PPG Edge",
    nextFixtureTip: `${nextLabel} → Skip straight win`,
    reason: `Team PPG ${ppg.toFixed(2)} is below 1.60 Strong PPG threshold${next5Tag}.`
  };
}

function teamNamesLooselyMatch(normA, normB) {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 4 && normB.length >= 4 && (normA.includes(normB) || normB.includes(normA))) return true;
  const tA = normA.split(" ").filter((t) => t.length >= 4);
  const tB = new Set(normB.split(" ").filter((t) => t.length >= 4));
  return tA.some((t) => tB.has(t));
}

function parseSoccerStatsScoreRecords(html, isUefa) {
  const cleanCell = (s) => decodeHtmlEntities(String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const byTeamPlayed = new Map();
  const byTeamUpcoming = new Map();

  const pushPlayed = (teamName, rec) => {
    const key = normalizeTeamKey(teamName);
    if (!key) return;
    if (!byTeamPlayed.has(key)) byTeamPlayed.set(key, []);
    byTeamPlayed.get(key).push(rec);
  };
  const pushUpcoming = (teamName, rec) => {
    const key = normalizeTeamKey(teamName);
    if (!key) return;
    if (!byTeamUpcoming.has(key)) byTeamUpcoming.set(key, []);
    byTeamUpcoming.get(key).push(rec);
  };

  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trs) {
    if (isUefa) {
      if (!/tm-match-row/i.test(tr)) continue;
      const tds = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(cleanCell);
      const koMatch = tr.match(/data-kickoff="([^"]*)"/i);
      const dateStr = koMatch ? koMatch[1].slice(0, 10) : (tds[0] || "");
      if (tds.length >= 4 && tds[1] && tds[3]) {
        const scMatch = tds[2].match(/^(\d+)\s*:\s*(\d+)/);
        if (scMatch) {
          const hg = parseInt(scMatch[1], 10);
          const ag = parseInt(scMatch[2], 10);
          const home = tds[1];
          const away = tds[3];
          pushPlayed(home, {
            venue: "H", opponent: away, oppNorm: normalizeTeamKey(away),
            teamGoals: hg, oppGoals: ag, score: `${hg}-${ag}`, matchScore: `${hg}-${ag}`,
            result: hg > ag ? "W" : hg === ag ? "D" : "L", date: dateStr
          });
          pushPlayed(away, {
            venue: "A", opponent: home, oppNorm: normalizeTeamKey(home),
            teamGoals: ag, oppGoals: hg, score: `${ag}-${hg}`, matchScore: `${hg}-${ag}`,
            result: ag > hg ? "W" : ag === hg ? "D" : "L", date: dateStr
          });
          continue;
        }
      }
      const fixCell = tds.find((c) => /.+\s+-\s+.+/.test(c));
      if (fixCell) {
        const parts = fixCell.split(/\s+-\s+/);
        if (parts.length === 2) {
          const home = parts[0].trim();
          const away = parts[1].trim();
          pushUpcoming(home, { venue: "H", opponent: away, oppNorm: normalizeTeamKey(away), date: dateStr });
          pushUpcoming(away, { venue: "A", opponent: home, oppNorm: normalizeTeamKey(home), date: dateStr });
        }
      }
      continue;
    }

    // Domestic results.asp rows
    if (!tr.includes("/matches/")) continue;
    const tds = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(cleanCell);
    const fixtureIdx = tds.findIndex((c) => /\s+vs\s+/i.test(c));
    if (fixtureIdx === -1) continue;
    const vsParts = tds[fixtureIdx].split(/\s+vs\s+/i);
    if (vsParts.length !== 2) continue;
    const home = vsParts[0].trim();
    const away = vsParts[1].trim();
    const dateStr = tds[0] || "";
    const scoreCell = tds.slice(fixtureIdx + 1).find((c) => /^\d+\s*[-:]\s*\d+$/.test(c));
    if (scoreCell) {
      const m = scoreCell.match(/^(\d+)\s*[-:]\s*(\d+)$/);
      const hg = parseInt(m[1], 10);
      const ag = parseInt(m[2], 10);
      pushPlayed(home, {
        venue: "H", opponent: away, oppNorm: normalizeTeamKey(away),
        teamGoals: hg, oppGoals: ag, score: `${hg}-${ag}`, matchScore: `${hg}-${ag}`,
        result: hg > ag ? "W" : hg === ag ? "D" : "L", date: dateStr
      });
      pushPlayed(away, {
        venue: "A", opponent: home, oppNorm: normalizeTeamKey(home),
        teamGoals: ag, oppGoals: hg, score: `${ag}-${hg}`, matchScore: `${hg}-${ag}`,
        result: ag > hg ? "W" : ag === hg ? "D" : "L", date: dateStr
      });
    } else {
      const timeStr = /^\d{1,2}:\d{2}$/.test(tds[1] || "") ? ` ${tds[1]}` : "";
      const when = `${dateStr}${timeStr}`.trim();
      pushUpcoming(home, { venue: "H", opponent: away, oppNorm: normalizeTeamKey(away), date: when });
      pushUpcoming(away, { venue: "A", opponent: home, oppNorm: normalizeTeamKey(home), date: when });
    }
  }

  return { byTeamPlayed, byTeamUpcoming };
}

async function fetchSoccerStatsResults(meta) {
  const isUefa = ["cleague", "eleague", "cfleague"].includes(meta.code);
  const url = isUefa
    ? `https://www.soccerstats.com/en-gb/leagues/${meta.path}`
    : `https://www.soccerstats.com/results.asp?league=${encodeURIComponent(meta.code)}&pmtype=bydate`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: "https://www.soccerstats.com/en-gb/"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!resp.ok) return null;
  const html = await resp.text();
  return parseSoccerStatsScoreRecords(html, isUefa);
}

function getTeamMapRecords(mapObj, teamNorm) {
  if (!mapObj || !teamNorm) return [];
  if (mapObj.has(teamNorm)) return mapObj.get(teamNorm);
  for (const [k, list] of mapObj.entries()) {
    if (teamNamesLooselyMatch(k, teamNorm)) return list;
  }
  return [];
}

function mergeScorelinesAndTipsIntoRows(rows, scoreRecords) {
  if (!Array.isArray(rows)) return [];
  const oppPpgByNorm = new Map();
  for (const r of rows) {
    oppPpgByNorm.set(r.teamNormalized, { homePpg: r.ppg, awayPpg: r.ppg, ppg: r.ppg });
  }

  for (const row of rows) {
    if (scoreRecords) {
      const teamPlayed = getTeamMapRecords(scoreRecords.byTeamPlayed, row.teamNormalized);
      const teamUpcoming = getTeamMapRecords(scoreRecords.byTeamUpcoming, row.teamNormalized);

      const usedIdx = new Set();
      if (Array.isArray(row.playedOpponents) && row.playedOpponents.length > 0 && teamPlayed.length > 0) {
        row.playedOpponents = row.playedOpponents.map((op) => {
          const opNorm = normalizeTeamKey(op.opponent);
          let matchIdx = teamPlayed.findIndex((p, idx) => !usedIdx.has(idx) && p.venue === op.venue && teamNamesLooselyMatch(p.oppNorm, opNorm));
          if (matchIdx === -1) {
            matchIdx = teamPlayed.findIndex((p, idx) => !usedIdx.has(idx) && teamNamesLooselyMatch(p.oppNorm, opNorm));
          }
          if (matchIdx !== -1) {
            usedIdx.add(matchIdx);
            const rec = teamPlayed[matchIdx];
            return {
              ...op,
              score: rec.score,
              matchScore: rec.matchScore,
              teamGoals: rec.teamGoals,
              oppGoals: rec.oppGoals,
              result: rec.result,
              date: rec.date || ""
            };
          }
          return op;
        });
      } else if ((!row.playedOpponents || row.playedOpponents.length === 0) && teamPlayed.length > 0) {
        row.playedOpponents = teamPlayed.slice(0, row.gp || 20).map((rec) => {
          const oppRow = oppPpgByNorm.get(rec.oppNorm);
          const oppVenuePpg = oppRow ? oppRow.ppg : row.playedPpg || 1.32;
          return {
            venue: rec.venue,
            opponent: rec.opponent,
            oppVenuePpg,
            score: rec.score,
            matchScore: rec.matchScore,
            teamGoals: rec.teamGoals,
            oppGoals: rec.oppGoals,
            result: rec.result,
            date: rec.date || "",
            label: `(${rec.venue}) ${rec.venue === "H" ? "vs" : "at"} ${rec.opponent}`,
            ppgLabel: `PPG ${rec.venue === "H" ? "away" : "at home"} = ${oppVenuePpg.toFixed(2)}`
          };
        });
      }

      if (Array.isArray(row.remainingOpponents) && teamUpcoming.length > 0) {
        const usedUpcomingIdx = new Set();
        row.remainingOpponents = row.remainingOpponents.map((op) => {
          const opNorm = normalizeTeamKey(op.opponent);
          let matchIdx = teamUpcoming.findIndex((u, idx) => !usedUpcomingIdx.has(idx) && u.venue === op.venue && teamNamesLooselyMatch(u.oppNorm, opNorm));
          if (matchIdx === -1 && !op.venue) {
            matchIdx = teamUpcoming.findIndex((u, idx) => !usedUpcomingIdx.has(idx) && teamNamesLooselyMatch(u.oppNorm, opNorm));
          }
          if (matchIdx !== -1) {
            usedUpcomingIdx.add(matchIdx);
            const found = teamUpcoming[matchIdx];
            if (found?.date) return { ...op, date: found.date };
          }
          return op;
        });
      }
    }

    row.tip = computeRuninTip(row);
  }
  return rows;
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

  const rawEntries = [];
  for (const child of sJson.children || []) {
    if (Array.isArray(child?.standings?.entries)) rawEntries.push(...child.standings.entries);
  }
  if (rawEntries.length === 0 && Array.isArray(sJson.standings?.entries)) {
    rawEntries.push(...sJson.standings.entries);
  }

  for (let idx = 0; idx < rawEntries.length; idx++) {
    const entry = rawEntries[idx];
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
        const s0 = Number(c0.score?.value ?? c0.score ?? NaN);
        const s1 = Number(c1.score?.value ?? c1.score ?? NaN);
        const hasSc = isDone && Number.isFinite(s0) && Number.isFinite(s1);
        const dateStr = String(ev?.date || "").slice(0, 10);

        if (id0 && n1) {
          const mapTarget = isDone ? playedByTeam : futureByTeam;
          if (!mapTarget.has(id0)) mapTarget.set(id0, []);
          mapTarget.get(id0).push({
            venue: v0, oppId: id1, oppName: n1, date: dateStr,
            ...(hasSc ? { teamGoals: s0, oppGoals: s1, score: `${s0}-${s1}`, result: s0 > s1 ? "W" : s0 === s1 ? "D" : "L" } : {})
          });
        }
        if (id1 && n0) {
          const mapTarget = isDone ? playedByTeam : futureByTeam;
          if (!mapTarget.has(id1)) mapTarget.set(id1, []);
          mapTarget.get(id1).push({
            venue: v1, oppId: id0, oppName: n0, date: dateStr,
            ...(hasSc ? { teamGoals: s1, oppGoals: s0, score: `${s1}-${s0}`, result: s1 > s0 ? "W" : s1 === s0 ? "D" : "L" } : {})
          });
        }
      }
    } catch {
      // Scoreboard enrichment is optional
    }
  }

  // Real-time Big-Data Schedule Assessment: fetch BOTH completed history + future chronological schedules (?fixture=true) across league teams
  const seenPastIds = new Set();
  const seenFutIds = new Set();
  const teamIdsNeedingSchedule = teamsList.filter((_, idx) => idx % 2 === 0 || idx === teamsList.length - 1).slice(0, fastMatrixOnly ? 10 : 14);

  const ingestTeamScheduleBatch = async (teamBatch, includePast = true) => {
    const reqs = [];
    for (const t of teamBatch) {
      reqs.push(
        fetchJsonWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/soccer/${meta.espnCode}/teams/${t.id}/schedule?fixture=true`, 3600)
          .then((j) => ({ kind: "FUT", j }))
          .catch(() => ({ kind: "FUT", j: null }))
      );
      if (includePast) {
        reqs.push(
          fetchJsonWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/soccer/${meta.espnCode}/teams/${t.id}/schedule`, 3600)
            .then((j) => ({ kind: "PAST", j }))
            .catch(() => ({ kind: "PAST", j: null }))
        );
      }
    }
    const resBatch = await Promise.all(reqs);
    const nowMs = Date.now();

    for (const { kind, j } of resBatch) {
      if (!j || !Array.isArray(j.events)) continue;
      for (const ev of j.events) {
        const evId = String(ev.id || "");
        const evSlug = String(ev?.league?.slug || "").toLowerCase();
        if (evSlug && evSlug !== meta.espnCode.toLowerCase()) continue;
        const comp = ev?.competitions?.[0];
        const comps = comp?.competitors || [];
        if (comps.length < 2) continue;
        const c0 = comps[0];
        const c1 = comps[1];
        const id0 = String(c0.id || c0.team?.id || "");
        const id1 = String(c1.id || c1.team?.id || "");
        if (!teamMap.has(id0) || !teamMap.has(id1)) continue;
        const n0 = String(c0.team?.displayName || c0.team?.name || teamMap.get(id0)?.team || "").trim();
        const n1 = String(c1.team?.displayName || c1.team?.name || teamMap.get(id1)?.team || "").trim();
        const v0 = String(c0.homeAway || "").toLowerCase() === "away" ? "A" : "H";
        const v1 = v0 === "H" ? "A" : "H";
        const isDone = Boolean(comp.status?.type?.completed || comp.status?.type?.state === "post");
        const koMs = Date.parse(ev.date || "");
        const dateTimeLabel = Number.isFinite(koMs)
          ? `${new Date(koMs).toISOString().slice(0, 10)} ${new Date(koMs).toISOString().slice(11, 16)}`
          : String(ev.date || "").slice(0, 10);

        if (kind === "PAST" && isDone) {
          if (evId && seenPastIds.has(evId)) continue;
          const s0 = Number(c0.score?.value ?? c0.score ?? NaN);
          const s1 = Number(c1.score?.value ?? c1.score ?? NaN);
          if (!Number.isFinite(s0) || !Number.isFinite(s1)) continue;
          if (evId) seenPastIds.add(evId);
          const dateStr = String(ev.date || "").slice(0, 10);
          if (!playedByTeam.has(id0)) playedByTeam.set(id0, []);
          playedByTeam.get(id0).push({
            venue: v0, oppId: id1, oppName: n1, date: dateStr, timestamp: Number.isFinite(koMs) ? koMs : 0,
            teamGoals: s0, oppGoals: s1, score: `${s0}-${s1}`, result: s0 > s1 ? "W" : s0 === s1 ? "D" : "L"
          });
          if (!playedByTeam.has(id1)) playedByTeam.set(id1, []);
          playedByTeam.get(id1).push({
            venue: v1, oppId: id0, oppName: n0, date: dateStr, timestamp: Number.isFinite(koMs) ? koMs : 0,
            teamGoals: s1, oppGoals: s0, score: `${s1}-${s0}`, result: s1 > s0 ? "W" : s1 === s0 ? "D" : "L"
          });
        } else if (!isDone && (!Number.isFinite(koMs) || koMs >= nowMs - 110 * 60000)) {
          if (evId && seenFutIds.has(evId)) continue;
          if (evId) seenFutIds.add(evId);
          if (!futureByTeam.has(id0)) futureByTeam.set(id0, []);
          futureByTeam.get(id0).push({
            venue: v0, oppId: id1, oppName: n1, date: dateTimeLabel, timestamp: Number.isFinite(koMs) ? koMs : 0
          });
          if (!futureByTeam.has(id1)) futureByTeam.set(id1, []);
          futureByTeam.get(id1).push({
            venue: v1, oppId: id0, oppName: n0, date: dateTimeLabel, timestamp: Number.isFinite(koMs) ? koMs : 0
          });
        }
      }
    }
  };

  for (let i = 0; i < teamIdsNeedingSchedule.length; i += 6) {
    await ingestTeamScheduleBatch(teamIdsNeedingSchedule.slice(i, i + 6), !fastMatrixOnly);
  }

  // Cover any remaining teams still missing >= 5 real upcoming matches cleanly
  const uncoveredTeams = teamsList.filter((t) => (futureByTeam.get(t.id)?.length || 0) < 5);
  for (let i = 0; i < uncoveredTeams.length; i += 6) {
    await ingestTeamScheduleBatch(uncoveredTeams.slice(i, i + 6), false);
  }

  // Merge live OneFootball schedule entries into futureByTeam when kicking off soon
  if (onefootballApi?.fetchOneFootballSchedule) {
    try {
      const ofSched = await onefootballApi.fetchOneFootballSchedule(false);
      const ofLeagueMatches = (ofSched?.matches || []).filter(
        (m) => m.status === "SCHEDULED" && (m.leagueName || "").toLowerCase().includes(meta.name.replace(/^(english|spanish|german|italian|french|dutch|portuguese|turkish|scottish|belgian)\s+/i, "").toLowerCase())
      );
      for (const om of ofLeagueMatches) {
        const hTeam = teamsList.find((t) => teamNamesLooselyMatch(t.teamNormalized, om.homeNorm || normalizeTeamKey(om.homeTeamName)));
        const aTeam = teamsList.find((t) => teamNamesLooselyMatch(t.teamNormalized, om.awayNorm || normalizeTeamKey(om.awayTeamName)));
        if (hTeam && aTeam) {
          const dtLbl = `${om.isoDate} ${om.kickoffUtc}`;
          const pushIfMissing = (myId, oppTeam, venue) => {
            if (!futureByTeam.has(myId)) futureByTeam.set(myId, []);
            const arr = futureByTeam.get(myId);
            if (!arr.some((x) => x.oppId === oppTeam.id && Math.abs((x.timestamp || 0) - om.kickoffMs) < 36 * 3600000)) {
              arr.push({ venue, oppId: oppTeam.id, oppName: oppTeam.team, date: dtLbl, timestamp: om.kickoffMs });
            }
          };
          pushIfMissing(hTeam.id, aTeam, "H");
          pushIfMissing(aTeam.id, hTeam, "A");
        }
      }
    } catch {
      // OneFootball schedule enrichment optional
    }
  }

  // Pass 2: Build SoccerSTATS-compatible rows using venue-weighted opponent PPG
  const rows = teamsList.map((team) => {
    const rawPlayed = [...(playedByTeam.get(team.id) || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const rawFuture = sortRemainingChronologically(futureByTeam.get(team.id) || []);

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
          ...(x.score ? { score: x.score, teamGoals: x.teamGoals, oppGoals: x.oppGoals, result: x.result } : {}),
          ...(x.date ? { date: x.date } : {}),
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
          ...(x.date ? { date: x.date } : {}),
          ...(x.timestamp ? { timestamp: x.timestamp } : {}),
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

    const rowObj = {
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
    rowObj.tip = computeRuninTip(rowObj);
    return rowObj;
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
  const wantScores = !fastMatrixOnFallback;
  const now = Date.now();
  const cached = leagueCache.get(meta.code);
  if (
    !forceRefresh &&
    cached &&
    now < cached.expiresAt &&
    Array.isArray(cached.payload?.table) &&
    cached.payload.table.length > 0 &&
    (fastMatrixOnFallback || (!cached.payload.isLightFallback && cached.payload.hasScores))
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
        const [runinSettled, scoreSettled] = await Promise.allSettled([
          fetch(targetUrl, {
            headers: {
              "User-Agent": UA,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-GB,en;q=0.9",
              Referer: "https://www.soccerstats.com/en-gb/"
            },
            signal: AbortSignal.timeout(15000)
          }),
          wantScores ? fetchSoccerStatsResults(meta) : Promise.resolve(null)
        ]);

        const resp = runinSettled.status === "fulfilled" ? runinSettled.value : null;
        const scoreRecords = scoreSettled.status === "fulfilled" ? scoreSettled.value : null;

        if (resp && resp.ok) {
          const html = await resp.text();
          const { rows, summary } = parseRuninHtml(html, meta);
          if (rows.length > 0) {
            mergeScorelinesAndTipsIntoRows(rows, scoreRecords);
            payload = {
              ok: true,
              hasScores: wantScores,
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
          payload.hasScores = wantScores;
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

  const targetCodes = CORE_TOP_CODES;
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
    tip: row.tip || computeRuninTip(row),
    playedCount: row.playedOpponents.length,
    remainingCount: row.remainingOpponents.length,
    playedOpponents: row.playedOpponents.slice(-6),
    remainingOpponents: row.remainingOpponents.slice(0, 10)
  });

  for (const res of results) {
    const compactRows = res.table.map(compactRow);
    leagueTables[res.league.code] = {
      league: res.league,
      summary: res.summary,
      table: compactRows,
      source: res.source,
      sourceUrl: res.sourceUrl,
      isFullFetch: Boolean(res.hasScores)
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
module.exports.computeRuninTip = computeRuninTip;
module.exports.SOCCERSTATS_LEAGUES = SOCCERSTATS_LEAGUES;
