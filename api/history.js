// Persistent & Real-Time Tip History + Settlement Engine
// Records active system tips and grades all played (FT) games against verified final scores.

const fs = require("node:fs");
const path = require("node:path");
const handleBookmakersProxy = require("./bookmakers");
const handleOnefootballProxy = require("./onefootball");
const handleFootyMetricsProxy = require("./footymetrics");
const handleStatPropsProxy = require("./statprops");

const STORE_PATH = path.join(__dirname, "..", "data", "tipHistory.json");
const MAX_STORED_ITEMS = 600;
const CACHE_TTL_MS = 45 * 1000;

let cachedResponse = null;
let lastBuildMs = 0;
let inFlight = null;

function normTeam(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|as|afc|fk|sk|bk|ik|nk|cd|ca|ud|rc|sd|us|ss|vfb|vfl|tsg|rb|sv|bsc|fsv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GENERIC_TEAM_WORDS = new Set(["real", "al", "el", "la", "de", "san", "saint", "city", "united", "utd", "town", "rovers", "wanderers", "athletic", "atletico", "sporting", "dynamo", "dinamo", "olympic", "olympique", "inter", "club", "youth", "reserves"]);

function teamsSimilar(a, b) {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Never match a youth/reserve team (u17..u23, ii, b) with a senior team
  const tagRegex = /\b(u17|u18|u19|u20|u21|u23|ii|b|women)\b/;
  if (tagRegex.test(na) !== tagRegex.test(nb)) return false;
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return true;
  const wa = na.split(" ").filter((w) => w.length >= 3 && !GENERIC_TEAM_WORDS.has(w));
  const wb = new Set(nb.split(" ").filter((w) => w.length >= 3 && !GENERIC_TEAM_WORDS.has(w)));
  if (wa.length === 0 || wb.size === 0) return false;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits >= Math.min(wa.length, wb.size) && hits >= 1;
}

function makeMatchKey(home, away, isoDate) {
  const d = (isoDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `${d}::${normTeam(home)}::${normTeam(away)}`;
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(items) {
  try {
    const trimmed = items
      .slice()
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
      .slice(0, MAX_STORED_ITEMS);
    fs.writeFileSync(STORE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), items: trimmed }, null, 2), "utf8");
  } catch {
    // Ignore read-only filesystem errors (e.g. serverless environments)
  }
}

/**
 * Grade a betting market tip strictly from verified FT homeScore & awayScore.
 * Returns { result: "WON" | "LOST" | "VOID" | "UNVERIFIED", profitUnits: number }
 */
function gradeTipByScore(tipMarket, sideHint, homeName, awayName, homeScore, awayScore, odds, verifiedStats = null) {
  const h = Number(homeScore);
  const a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) {
    return { result: "UNVERIFIED", profitUnits: 0 };
  }
  const total = h + a;
  const diff = h - a;
  const m = String(tipMarket || "")
    .replace(/\(Fair[^)]*\)/gi, "")
    .replace(/@\s*\d+(?:\.\d+)?/g, "")
    .toLowerCase();
  const oddNum = Number(odds);
  const decOdd = Number.isFinite(oddNum) && oddNum > 1.01 ? oddNum : 1.50;

  let won = null;
  let isVoid = false;

  // 1. Over / Under Goals
  const ouMatch = m.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\s*(?:goals?|total)?/i);
  if (ouMatch && !m.includes("shot") && !m.includes("throw") && !m.includes("corner") && !m.includes("card")) {
    const dir = ouMatch[1].toLowerCase();
    const line = parseFloat(ouMatch[2]);
    if (Number.isFinite(line)) {
      if (total === line) isVoid = true;
      else won = dir === "over" ? total > line : total < line;
    }
  }

  // 1b. Shots on Target & Throw-Ins (ONLY grade from real verified match stats — never estimate from goals)
  if (won === null && !isVoid && (m.includes("shot") || m.includes("throw"))) {
    const stMatch = m.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/i);
    const actualStat = m.includes("shot")
      ? (Number.isFinite(Number(verifiedStats?.shotsOnTarget)) ? Number(verifiedStats.shotsOnTarget) : null)
      : (Number.isFinite(Number(verifiedStats?.throwIns)) ? Number(verifiedStats.throwIns) : null);
    if (stMatch && actualStat !== null) {
      const dir = stMatch[1].toLowerCase();
      const line = parseFloat(stMatch[2]);
      if (Number.isFinite(line)) {
        if (actualStat === line) isVoid = true;
        else won = dir === "over" ? actualStat > line : actualStat < line;
      }
    } else {
      return { result: "UNVERIFIED", profitUnits: 0 };
    }
  }

  // 2. BTTS / GG
  if (won === null && !isVoid && (m.includes("btts") || m.includes("both teams to score") || /\bgg\b/.test(m))) {
    const isNo = m.includes("no") || m.includes("ng");
    won = isNo ? (h === 0 || a === 0) : (h > 0 && a > 0);
  }

  // 3. Double Chance (1X, X2, 12)
  if (won === null && !isVoid) {
    if (/\b1x\b/.test(m) || m.includes("home or draw") || m.includes("home +0.5")) {
      won = h >= a;
    } else if (/\bx2\b/.test(m) || m.includes("away or draw") || m.includes("away +0.5")) {
      won = a >= h;
    } else if (/\b12\b/.test(m) || m.includes("home or away")) {
      won = h !== a;
    }
  }

  // 4. Handicaps (+1.5, -1, -1.5, +0.5, DNB)
  if (won === null && !isVoid && (m.includes("handicap") || m.includes("eh") || /[+-]\d+(?:\.\d+)?/.test(m) || m.includes("dnb"))) {
    const isHomeSide = sideHint === "HOME" || (homeName && m.includes(homeName.toLowerCase())) || m.includes("home");
    const isAwaySide = sideHint === "AWAY" || (awayName && m.includes(awayName.toLowerCase())) || m.includes("away");
    if (m.includes("dnb") || m.includes("draw no bet") || m.includes("+0)")) {
      if (h === a) isVoid = true;
      else won = isAwaySide && !isHomeSide ? a > h : h > a;
    } else {
      const hcpNum = m.match(/([+-]\d+(?:\.\d+)?)/);
      if (hcpNum) {
        const line = parseFloat(hcpNum[1]);
        const targetDiff = isAwaySide && !isHomeSide ? (a - h) : (h - a);
        const adj = targetDiff + line;
        if (adj === 0) isVoid = true;
        else won = adj > 0;
      }
    }
  }

  // 5. Fade worst team -> Back opponent win/DC
  if (won === null && !isVoid && m.includes("fade")) {
    const arrowParts = m.split(/->|back/i);
    const backSide = arrowParts[arrowParts.length - 1] || "";
    const backsHome = homeName && backSide.includes(homeName.toLowerCase().slice(0, 5));
    const backsAway = awayName && backSide.includes(awayName.toLowerCase().slice(0, 5));
    if (backSide.includes("1x")) won = h >= a;
    else if (backSide.includes("x2")) won = a >= h;
    else if (backsHome) won = h > a;
    else if (backsAway) won = a > h;
  }

  // 6. Straight Win (1) / (2) / Home Win / Away Win / Draw (X)
  if (won === null && !isVoid) {
    if (m.includes("home win") || /\(1\)/.test(m) || (homeName && m.includes(homeName.toLowerCase()) && m.includes("win"))) {
      won = diff > 0;
    } else if (m.includes("away win") || /\(2\)/.test(m) || (awayName && m.includes(awayName.toLowerCase()) && m.includes("win"))) {
      won = diff < 0;
    } else if (m.includes("draw") && !m.includes("or draw")) {
      won = diff === 0;
    } else if (sideHint === "HOME") {
      won = diff > 0;
    } else if (sideHint === "AWAY") {
      won = diff < 0;
    }
  }

  if (isVoid) return { result: "VOID", profitUnits: 0 };
  if (won === true) return { result: "WON", profitUnits: Math.round((decOdd - 1) * 100) / 100 };
  if (won === false) return { result: "LOST", profitUnits: -1 };
  return { result: "UNVERIFIED", profitUnits: 0 };
}

async function fetchEspnFinishedScores(isoDates) {
  const results = [];
  await Promise.all(
    isoDates.map(async (dIso) => {
      const yyyymmdd = dIso.replace(/-/g, "");
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${yyyymmdd}&limit=250`,
          { signal: controller.signal }
        );
        clearTimeout(t);
        if (!resp.ok) return;
        const json = await resp.json();
        const events = Array.isArray(json?.events) ? json.events : [];
        for (const ev of events) {
          const comp = ev?.competitions?.[0];
          const state = comp?.status?.type?.state || ev?.status?.type?.state;
          const completed = Boolean(comp?.status?.type?.completed || ev?.status?.type?.completed || state === "post");
          if (!completed) continue;
          const competitors = comp?.competitors || [];
          const homeC = competitors.find((c) => c.homeAway === "home");
          const awayC = competitors.find((c) => c.homeAway === "away");
          if (!homeC || !awayC) continue;
          const hScore = parseInt(homeC.score, 10);
          const aScore = parseInt(awayC.score, 10);
          if (!Number.isFinite(hScore) || !Number.isFinite(aScore)) continue;
          results.push({
            home: homeC.team?.displayName || homeC.team?.name || "",
            away: awayC.team?.displayName || awayC.team?.name || "",
            homeLogo: homeC.team?.logo || "",
            awayLogo: awayC.team?.logo || "",
            homeScore: hScore,
            awayScore: aScore,
            league: ev?.season?.slug || comp?.league?.name || json?.leagues?.[0]?.name || "Football",
            country: "",
            isoDate: (ev.date || dIso).slice(0, 10),
            timestamp: new Date(ev.date || `${dIso}T12:00:00Z`).getTime(),
            status: "FT"
          });
        }
      } catch {
        // Ignore ESPN timeout
      }
    })
  );
  return results;
}

function buildScoreIndex(ofData, bmData, fmData, espnFtList) {
  const ftMap = new Map();

  function upsertFt(entry) {
    if (!entry || !entry.home || !entry.away) return;
    if (!Number.isFinite(Number(entry.homeScore)) || !Number.isFinite(Number(entry.awayScore))) return;
    const key = makeMatchKey(entry.home, entry.away, entry.isoDate);
    if (!ftMap.has(key)) {
      ftMap.set(key, entry);
    }
  }

  // Priority 1: Official ESPN FT Scores
  for (const e of espnFtList || []) {
    upsertFt({ ...e, source: "espn" });
  }

  // Priority 2: Official OneFootball FT Scores
  for (const ofm of ofData?.matches || []) {
    if (ofm.status === "FT" && Number.isFinite(Number(ofm.homeScore)) && Number.isFinite(Number(ofm.awayScore))) {
      upsertFt({
        home: ofm.homeTeamName,
        away: ofm.awayTeamName,
        homeLogo: ofm.homeLogo || "",
        awayLogo: ofm.awayLogo || "",
        homeScore: Number(ofm.homeScore),
        awayScore: Number(ofm.awayScore),
        league: ofm.leagueName || "Football",
        country: ofm.country || "",
        isoDate: ofm.isoDate || new Date().toISOString().slice(0, 10),
        timestamp: Number(ofm.kickoffMs) || Date.now(),
        source: "onefootball"
      });
    }
  }

  // Priority 3: FootyMetrics Verified FT Scores
  for (const f of fmData?.fixtures || []) {
    if (f.status === "FT" && Number.isFinite(f.homeGoals) && Number.isFinite(f.awayGoals)) {
      upsertFt({
        home: f.home?.name,
        away: f.away?.name,
        homeLogo: f.home?.logo || "",
        awayLogo: f.away?.logo || "",
        homeScore: f.homeGoals,
        awayScore: f.awayGoals,
        league: f.league?.name || "Football",
        country: f.league?.country || "",
        flag: f.league?.flag || "",
        isoDate: (f.timestamp || new Date().toISOString()).slice(0, 10),
        timestamp: f.timestamp ? new Date(f.timestamp).getTime() : Date.now(),
        fmFixture: f,
        source: "footymetrics"
      });
    }
  }

  // Priority 4: Bookmakers Completed FT Scores (only when explicitly marked FT/Ended)
  for (const cg of bmData?.completedToday || []) {
    const stStr = String(cg.status || cg.matchStatus || "").toUpperCase();
    if (cg.score && typeof cg.score === "string" && (stStr === "FT" || stStr === "ENDED" || stStr === "COMPLETED" || cg.completed === true)) {
      const parts = cg.score.split(/[:\-–—]/).map((s) => parseInt(s.trim(), 10));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        upsertFt({
          home: cg.homeTeamName,
          away: cg.awayTeamName,
          homeLogo: cg.homeLogo || "",
          awayLogo: cg.awayLogo || "",
          homeScore: parts[0],
          awayScore: parts[1],
          league: cg.league || "Football",
          country: cg.country || "",
          isoDate: cg.isoDate || new Date().toISOString().slice(0, 10),
          timestamp: Number(cg.estimateStartTime) || Date.now(),
          bmGame: cg,
          source: "bookmakers"
        });
      }
    }
  }

  return ftMap;
}

function findMatchingFtScore(item, ftMap) {
  const exact = ftMap.get(makeMatchKey(item.home, item.away, item.isoDate));
  if (exact) return exact;
  for (const ft of ftMap.values()) {
    if (teamsSimilar(item.home, ft.home) && teamsSimilar(item.away, ft.away)) {
      const diffMs = Math.abs((Number(item.timestamp) || 0) - (Number(ft.timestamp) || 0));
      if (!item.timestamp || !ft.timestamp || diffMs <= 36 * 3600000) {
        return ft;
      }
    }
  }
  return null;
}

function collectPendingTipsFromActiveFeeds(bmData, fmData, statPropsData) {
  const candidates = [];
  const nowIso = new Date().toISOString();

  // 1. Bookmaker Mismatch & Trap Shield (Today + Pre-match)
  const bmPools = [
    ...(bmData?.todayMismatchGames || []),
    ...(bmData?.strongHomeMismatch || []),
    ...(bmData?.strongAwayMismatch || []),
    ...(bmData?.worstHomeMismatch || []),
    ...(bmData?.worstAwayMismatch || [])
  ];
  for (const g of bmPools) {
    if (!g.homeTeamName || !g.awayTeamName || !g.mismatchMarket) continue;
    const oddMatch = String(g.mismatchMarket).match(/@\s*(\d+\.\d+)/);
    const marketOdd = oddMatch ? parseFloat(oddMatch[1]) : Number(g.mismatchBigOdd || 1.5);
    candidates.push({
      id: `bm::${makeMatchKey(g.homeTeamName, g.awayTeamName, g.isoDate)}`,
      category: "BOOKIE_MISMATCH",
      categoryLabel: "Mismatch & Trap Shield",
      home: g.homeTeamName,
      away: g.awayTeamName,
      homeLogo: g.homeLogo || "",
      awayLogo: g.awayLogo || "",
      league: g.league || "Football",
      country: g.country || "",
      isoDate: g.isoDate || nowIso.slice(0, 10),
      timestamp: Number(g.estimateStartTime) || Date.now(),
      market: g.mismatchMarket.replace(/\s*@\s*\d+\.\d+/, "").trim(),
      odds: marketOdd,
      side: g.side || null,
      reason: g.headlineReason || g.trickSummary || "Bookmaker odds mismatch vs team PPG & form",
      fbGameId: g.footballCom?.gameId || g.footballComGameId || null,
      sbGameId: g.sportybet?.gameId || g.sportybetGameId || null,
      recordedAt: nowIso
    });
  }

  // 2. Goals Over/Under Stat Markets (scored strictly from FT goals)
  for (const g of statPropsData?.categories?.GOALS || []) {
    if (!g.homeTeam || !g.awayTeam || !g.marketLine) continue;
    candidates.push({
      id: `goals::${makeMatchKey(g.homeTeam, g.awayTeam, g.isoDate)}`,
      category: "GOALS_OU",
      categoryLabel: "Goals Over / Under",
      home: g.homeTeam,
      away: g.awayTeam,
      homeLogo: g.homeLogo || "",
      awayLogo: g.awayLogo || "",
      league: g.league || "Football",
      country: g.country || "",
      isoDate: g.isoDate || nowIso.slice(0, 10),
      timestamp: Number(g.timestamp) || Date.now(),
      market: g.marketLine,
      odds: Number(g.bookmakerOdds || 1.75),
      side: null,
      reason: `Poisson Exp ${Number(g.expectedAvg || 0).toFixed(2)} goals (${g.trueProbabilityPct || ""} prob, ${g.expectedValuePct || ""} EV)`,
      fbGameId: g.footballComGameId || null,
      sbGameId: g.sportybetGameId || null,
      recordedAt: nowIso
    });
  }

  // 3. FootyMetrics Opta Signals (Form Edge & Opta Goals/BTTS)
  for (const f of fmData?.fixtures || []) {
    const h = f.home || {};
    const a = f.away || {};
    const hWin10 = Number(h.win10 ?? 0);
    const aWin10 = Number(a.win10 ?? 0);
    const isoDate = (f.timestamp || nowIso).slice(0, 10);
    const ts = f.timestamp ? new Date(f.timestamp).getTime() : Date.now();

    const avgO25 = (Number(h.over2510 ?? 50) + Number(a.over2510 ?? 50)) / 2;
    const avgBtts = (Number(h.btts10 ?? 50) + Number(a.btts10 ?? 50)) / 2;
    const winGap = Math.abs(hWin10 - aWin10);
    let pickLabel = hWin10 >= aWin10 ? "1X Double Chance (Home or Draw)" : "X2 Double Chance (Away or Draw)";
    let odd = hWin10 >= aWin10 ? (f.odds?.odd1x || f.odds?.odd1 || 1.32) : (f.odds?.oddX2 || f.odds?.odd2 || 1.32);
    let pickSide = hWin10 >= aWin10 ? "HOME" : "AWAY";
    if (winGap < 15 && avgO25 >= 58) {
      pickLabel = "Over 1.5 Goals (5-Engine Safe Consensus)";
      odd = f.odds?.oddOver15 || 1.26;
      pickSide = null;
    }
    candidates.push({
      id: `opta-form::${makeMatchKey(h.name, a.name, isoDate)}`,
      category: "OPTA_INTEL",
      categoryLabel: "FootyMetrics Opta Intel",
      home: h.name,
      away: a.name,
      homeLogo: h.logo || "",
      awayLogo: a.logo || "",
      league: f.league?.name || "Football",
      country: f.league?.country || "",
      isoDate,
      timestamp: ts,
      market: pickLabel,
      odds: Number(odd),
      side: pickSide,
      reason: `Opta 10g Win%: ${h.name} ${hWin10}% vs ${a.name} ${aWin10}% · O2.5 ${Math.round(avgO25)}%`,
      recordedAt: nowIso
    });
    if (avgO25 >= 65 || avgBtts >= 65) {
      const useBtts = avgBtts >= avgO25 && f.odds?.oddBtts;
      candidates.push({
        id: `opta-goals::${makeMatchKey(h.name, a.name, isoDate)}`,
        category: "GOALS_OU",
        categoryLabel: "Goals Over / Under",
        home: h.name,
        away: a.name,
        homeLogo: h.logo || "",
        awayLogo: a.logo || "",
        league: f.league?.name || "Football",
        country: f.league?.country || "",
        isoDate,
        timestamp: ts,
        market: useBtts ? "BTTS (GG) Yes" : "Over 2.5 Goals",
        odds: Number(useBtts ? f.odds?.oddBtts : (f.odds?.oddOver25 || 1.75)),
        side: null,
        reason: `Opta 10g Avg O2.5 ${Math.round(avgO25)}% · BTTS ${Math.round(avgBtts)}%`,
        recordedAt: nowIso
      });
    }

    // Handicap (+0.5 / 1X or X2) & Sure Odds (Over 1.5 Goals / Strong Fav Win) from Opta fixtures
    const hHome5 = Number(h.homeWin5 ?? h.win5 ?? 0);
    const aAway5 = Number(a.awayWin5 ?? a.win5 ?? 0);
    if (hWin10 >= 50 && hHome5 >= 60 && aWin10 <= 50 && f.odds?.odd1x >= 1.14) {
      candidates.push({
        id: `opta-hcp::${makeMatchKey(h.name, a.name, isoDate)}`,
        category: "HANDICAP",
        categoryLabel: "Winning Handicap & +EV",
        home: h.name,
        away: a.name,
        homeLogo: h.logo || "",
        awayLogo: a.logo || "",
        league: f.league?.name || "Football",
        country: f.league?.country || "",
        isoDate,
        timestamp: ts,
        market: "Home +0.5 Handicap (1X)",
        odds: Number(f.odds.odd1x),
        side: "HOME",
        reason: `Home Win5 ${hHome5}% · 10g Win ${hWin10}% vs Away ${aWin10}%`,
        recordedAt: nowIso
      });
    } else if (aWin10 >= 50 && aAway5 >= 60 && hWin10 <= 50 && f.odds?.oddX2 >= 1.14) {
      candidates.push({
        id: `opta-hcp::${makeMatchKey(h.name, a.name, isoDate)}`,
        category: "HANDICAP",
        categoryLabel: "Winning Handicap & +EV",
        home: h.name,
        away: a.name,
        homeLogo: h.logo || "",
        awayLogo: a.logo || "",
        league: f.league?.name || "Football",
        country: f.league?.country || "",
        isoDate,
        timestamp: ts,
        market: "Away +0.5 Handicap (X2)",
        odds: Number(f.odds.oddX2),
        side: "AWAY",
        reason: `Away Win5 ${aAway5}% · 10g Win ${aWin10}% vs Home ${hWin10}%`,
        recordedAt: nowIso
      });
    }

    if (f.odds?.odd1 >= 1.25 && f.odds?.odd1 <= 1.75 && hWin10 >= 65 && aWin10 <= 40) {
      candidates.push({
        id: `opta-sure::${makeMatchKey(h.name, a.name, isoDate)}`,
        category: "SURE_ODDS",
        categoryLabel: "Sure Odds & Match Result",
        home: h.name,
        away: a.name,
        homeLogo: h.logo || "",
        awayLogo: a.logo || "",
        league: f.league?.name || "Football",
        country: f.league?.country || "",
        isoDate,
        timestamp: ts,
        market: "Home Win (1)",
        odds: Number(f.odds.odd1),
        side: "HOME",
        reason: `Banker Home Win: ${hWin10}% 10g Win Rate vs Away ${aWin10}%`,
        recordedAt: nowIso
      });
    } else if (f.odds?.oddOver15 >= 1.15 && f.odds?.oddOver15 <= 1.48 && avgO25 >= 55) {
      candidates.push({
        id: `opta-sure-o15::${makeMatchKey(h.name, a.name, isoDate)}`,
        category: "SURE_ODDS",
        categoryLabel: "Sure Odds & Match Result",
        home: h.name,
        away: a.name,
        homeLogo: h.logo || "",
        awayLogo: a.logo || "",
        league: f.league?.name || "Football",
        country: f.league?.country || "",
        isoDate,
        timestamp: ts,
        market: "Over 1.5 Goals",
        odds: Number(f.odds.oddOver15),
        side: null,
        reason: `High Scoring Banker: 10g Avg O2.5 ${Math.round(avgO25)}%`,
        recordedAt: nowIso
      });
    }
  }

  // 4. Verified Bookmaker Handicap / Sure Value Picks (Evaluated pre-match & FT completedToday)
  const bmEvaluated = [...(bmData?.allGames || []), ...(bmData?.completedToday || [])];
  for (const g of bmEvaluated) {
    if (!g.homeTeamName || !g.awayTeamName || !g.homeStats || !g.awayStats) continue;
    const hs = g.homeStats;
    const as = g.awayStats;
    const odd1 = Number(g.bestOdds?.home || 0);
    const odd2 = Number(g.bestOdds?.away || 0);
    const dc1X = Number(g.bestOdds?.dc1X || 0);
    const dcX2 = Number(g.bestOdds?.dcX2 || 0);
    const o15 = Number(g.bestOdds?.over15 || 0);

    // Sure Odds / Strong PPG Handicap pick
    if (hs.ppg >= 1.75 && hs.ppg >= as.ppg + 0.45 && odd1 >= 1.25 && odd1 <= 2.30) {
      const use1X = odd1 >= 1.65 && dc1X >= 1.15;
      candidates.push({
        id: `handicap::${makeMatchKey(g.homeTeamName, g.awayTeamName, g.isoDate)}`,
        category: use1X ? "HANDICAP" : "SURE_ODDS",
        categoryLabel: use1X ? "Winning Handicap & +EV" : "Sure Odds & Match Result",
        home: g.homeTeamName,
        away: g.awayTeamName,
        homeLogo: g.homeLogo || "",
        awayLogo: g.awayLogo || "",
        league: g.league || "Football",
        country: g.country || "",
        isoDate: g.isoDate || nowIso.slice(0, 10),
        timestamp: Number(g.estimateStartTime) || Date.now(),
        market: use1X ? "Home +0.5 Handicap (1X)" : "Home Win (1)",
        odds: use1X ? dc1X : odd1,
        side: "HOME",
        reason: `Strong Home PPG (${hs.ppg.toFixed(2)} vs ${as.ppg.toFixed(2)} PPG)`,
        fbGameId: g.footballCom?.gameId || g.footballComGameId || null,
        sbGameId: g.sportybet?.gameId || g.sportybetGameId || null,
        recordedAt: nowIso
      });
    } else if (as.ppg >= 1.75 && as.ppg >= hs.ppg + 0.45 && odd2 >= 1.25 && odd2 <= 2.30) {
      const useX2 = odd2 >= 1.65 && dcX2 >= 1.15;
      candidates.push({
        id: `handicap::${makeMatchKey(g.homeTeamName, g.awayTeamName, g.isoDate)}`,
        category: useX2 ? "HANDICAP" : "SURE_ODDS",
        categoryLabel: useX2 ? "Winning Handicap & +EV" : "Sure Odds & Match Result",
        home: g.homeTeamName,
        away: g.awayTeamName,
        homeLogo: g.homeLogo || "",
        awayLogo: g.awayLogo || "",
        league: g.league || "Football",
        country: g.country || "",
        isoDate: g.isoDate || nowIso.slice(0, 10),
        timestamp: Number(g.estimateStartTime) || Date.now(),
        market: useX2 ? "Away +0.5 Handicap (X2)" : "Away Win (2)",
        odds: useX2 ? dcX2 : odd2,
        side: "AWAY",
        reason: `Strong Away PPG (${as.ppg.toFixed(2)} vs ${hs.ppg.toFixed(2)} PPG)`,
        fbGameId: g.footballCom?.gameId || g.footballComGameId || null,
        sbGameId: g.sportybet?.gameId || g.sportybetGameId || null,
        recordedAt: nowIso
      });
    } else if (o15 >= 1.18 && o15 <= 1.55 && (Number(hs.gfAvg || 0) + Number(as.gfAvg || 0)) >= 2.8) {
      candidates.push({
        id: `sure-o15::${makeMatchKey(g.homeTeamName, g.awayTeamName, g.isoDate)}`,
        category: "SURE_ODDS",
        categoryLabel: "Sure Odds & Match Result",
        home: g.homeTeamName,
        away: g.awayTeamName,
        homeLogo: g.homeLogo || "",
        awayLogo: g.awayLogo || "",
        league: g.league || "Football",
        country: g.country || "",
        isoDate: g.isoDate || nowIso.slice(0, 10),
        timestamp: Number(g.estimateStartTime) || Date.now(),
        market: "Over 1.5 Goals",
        odds: o15,
        side: null,
        reason: `Combined attacking avg ${(Number(hs.gfAvg || 0) + Number(as.gfAvg || 0)).toFixed(2)} GF/g`,
        fbGameId: g.footballCom?.gameId || g.footballComGameId || null,
        sbGameId: g.sportybet?.gameId || g.sportybetGameId || null,
        recordedAt: nowIso
      });
    }
  }

  return candidates;
}

async function buildTipHistory(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedResponse && now - lastBuildMs < CACHE_TTL_MS) {
    return cachedResponse;
  }
  if (inFlight && !forceRefresh) {
    return inFlight;
  }

  inFlight = (async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const [bmRes, ofRes, fmRes, spRes, espnFtList] = await Promise.allSettled([
      handleBookmakersProxy.runFullBookmakerScan(false),
      handleOnefootballProxy.fetchOneFootballSchedule(false),
      handleFootyMetricsProxy.fetchFootyMetricsIntelligence(false),
      handleStatPropsProxy.fetchStatPropsIntelligence(false),
      fetchEspnFinishedScores([todayIso, yesterdayIso])
    ]);

    const bmData = bmRes.status === "fulfilled" ? bmRes.value : null;
    const ofData = ofRes.status === "fulfilled" ? ofRes.value : null;
    const fmData = fmRes.status === "fulfilled" ? fmRes.value : null;
    const statPropsData = spRes.status === "fulfilled" ? spRes.value : null;
    const espnFt = espnFtList.status === "fulfilled" ? espnFtList.value : [];

    const ftMap = buildScoreIndex(ofData, bmData, fmData, espnFt);

    // Load persisted ledger and merge newly observed tips
    const stored = readStore();
    const byId = new Map();
    for (const item of stored) {
      if (item && item.id) byId.set(item.id, item);
    }

    const freshTips = collectPendingTipsFromActiveFeeds(bmData, fmData, statPropsData);
    for (const tip of freshTips) {
      if (!byId.has(tip.id)) {
        byId.set(tip.id, tip);
      } else {
        const existing = byId.get(tip.id);
        // Preserve original locked odds/market/recordedAt; only fill missing logos or IDs
        if (!existing.homeLogo && tip.homeLogo) existing.homeLogo = tip.homeLogo;
        if (!existing.awayLogo && tip.awayLogo) existing.awayLogo = tip.awayLogo;
        if (!existing.fbGameId && tip.fbGameId) existing.fbGameId = tip.fbGameId;
        if (!existing.sbGameId && tip.sbGameId) existing.sbGameId = tip.sbGameId;
      }
    }

    // Settle all items against verified FT scores
    const settledPlayed = [];
    const allItems = Array.from(byId.values());

    for (const item of allItems) {
      const ft = findMatchingFtScore(item, ftMap);
      if (ft) {
        const grade = gradeTipByScore(item.market, item.side, item.home, item.away, ft.homeScore, ft.awayScore, item.odds, ft.stats || null);
        if (grade.result !== "UNVERIFIED") {
          item.status = "FT";
          item.homeScore = ft.homeScore;
          item.awayScore = ft.awayScore;
          item.scoreSource = ft.source || item.scoreSource;
          if (ft.homeLogo && !item.homeLogo) item.homeLogo = ft.homeLogo;
          if (ft.awayLogo && !item.awayLogo) item.awayLogo = ft.awayLogo;
          if (ft.country && !item.country) item.country = ft.country;
          if (ft.flag && !item.flag) item.flag = ft.flag;
          item.result = grade.result;
          item.profitUnits = grade.profitUnits;
          item.settledAt = item.settledAt || new Date().toISOString();
          settledPlayed.push(item);
        }
        continue;
      }
      if (item.result === "WON" || item.result === "LOST" || item.result === "VOID") {
        // Keep previously verified goal-based outcomes, but drop any fake Shots/Throw-Ins grades without real stats
        const mLow = String(item.market || "").toLowerCase();
        if (!mLow.includes("shot") && !mLow.includes("throw")) {
          settledPlayed.push(item);
        }
      }
    }

    writeStore(allItems);

    // Build Daily Win Comparison across all settled dates (to see which day had more wins)
    const byDateMap = {};
    for (const x of settledPlayed) {
      if (x.categoryLabel === "Sure Odds & Match Result" || x.categoryLabel === "Goals Over / Under") continue;
      const dKey = String(x.isoDate || (x.settledAt || "").slice(0, 10) || "Unknown");
      if (!byDateMap[dKey]) byDateMap[dKey] = { date: dKey, total: 0, won: 0, lost: 0, void: 0, winRatePct: 0 };
      byDateMap[dKey].total++;
      if (x.result === "WON") byDateMap[dKey].won++;
      else if (x.result === "LOST") byDateMap[dKey].lost++;
      else byDateMap[dKey].void++;
    }
    const byDate = Object.values(byDateMap)
      .map((d) => {
        const dec = d.won + d.lost;
        return { ...d, winRatePct: dec > 0 ? Math.round((d.won / dec) * 1000) / 10 : 0 };
      })
      .sort((a, b) => b.won - a.won || b.winRatePct - a.winRatePct);

    // Exclude removed sections AND restrict displayed played games strictly to TODAY ONLY, 1 entry per unique game
    const catPriority = { "FootyMetrics Opta Intel": 1, "Winning Handicap & +EV": 2, "Mismatch & Trap Shield": 3 };
    const filteredPlayed = settledPlayed
      .filter(
        (x) =>
          x.categoryLabel !== "Sure Odds & Match Result" &&
          x.categoryLabel !== "Goals Over / Under" &&
          String(x.isoDate || (x.settledAt || "").slice(0, 10)) === todayIso
      )
      .sort((a, b) => (catPriority[a.categoryLabel] || 9) - (catPriority[b.categoryLabel] || 9));

    const dedupedPlayed = [];
    for (const item of filteredPlayed) {
      const dup = dedupedPlayed.some((e) => teamsSimilar(e.home, item.home) && teamsSimilar(e.away, item.away));
      if (!dup) dedupedPlayed.push(item);
    }
    settledPlayed.length = 0;
    settledPlayed.push(...dedupedPlayed);

    settledPlayed.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));

    const wonCount = settledPlayed.filter((x) => x.result === "WON").length;
    const lostCount = settledPlayed.filter((x) => x.result === "LOST").length;
    const voidCount = settledPlayed.filter((x) => x.result === "VOID").length;
    const decided = wonCount + lostCount;
    const winRatePct = decided > 0 ? Math.round((wonCount / decided) * 1000) / 10 : 0;
    const netProfitUnits = Math.round(settledPlayed.reduce((acc, x) => acc + (Number(x.profitUnits) || 0), 0) * 100) / 100;

    // Group breakdown summary by category
    const byCategory = {};
    for (const x of settledPlayed) {
      const k = x.category || "SURE_ODDS";
      if (!byCategory[k]) {
        byCategory[k] = { key: k, label: x.categoryLabel || k, total: 0, won: 0, lost: 0, void: 0, netUnits: 0 };
      }
      byCategory[k].total++;
      if (x.result === "WON") byCategory[k].won++;
      else if (x.result === "LOST") byCategory[k].lost++;
      else byCategory[k].void++;
      byCategory[k].netUnits = Math.round((byCategory[k].netUnits + (Number(x.profitUnits) || 0)) * 100) / 100;
    }

    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      trackedActiveCount: allItems.length,
      ftFixturesAvailable: ftMap.size,
      summary: {
        totalPlayed: settledPlayed.length,
        won: wonCount,
        lost: lostCount,
        void: voidCount,
        winRatePct,
        netProfitUnits,
        byDate,
        todayIso
      },
      categoryStats: Object.values(byCategory),
      items: settledPlayed
    };

    cachedResponse = payload;
    lastBuildMs = Date.now();
    return payload;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = async function handleHistoryProxy(req, res) {
  try {
    const reqUrl = new URL(req.url, "http://localhost");
    const force = reqUrl.searchParams.get("refresh") === "1";
    const data = await buildTipHistory(force);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: err?.message || "History engine error" }));
  }
};

module.exports.buildTipHistory = buildTipHistory;
module.exports.gradeTipByScore = gradeTipByScore;
