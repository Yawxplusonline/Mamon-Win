// Deep Multi-Pillar Over/Under Stat-Market Engine v2.0
// Sources: Football.com live markets + ESPN Home/Away last-6 boxscores & starting GK rosters + Market-Anchored Negative Binomial / Poisson calibration.
// Strict NO-GUESSING gate: requires verified team telemetry on BOTH teams before publishing stat-prop tips.

const bookmakersApi = require("./bookmakers");
const { canonicalizeLeagueAndCountry } = require("./leagueCatalog");

const ESPN_UA = "MAMON-WIN/2.0";
const FB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let cachedPropsPayload = null;
let cachedPropsExpiresAt = 0;
let propsInFlight = null;

const espnTeamStatsCache = new Map(); // cacheKey -> { stats, expiresAt }
const espnLeagueTeamsCache = new Map(); // code -> { teams, expiresAt }

const ESPN_LEAGUE_MAP = [
  { re: /premier league/i, ex: /women|wsl|scotland|ireland|ukraine|russia|egypt|india|kenya|ghana|nigeria|armenia/i, codes: ["eng.1", "eng.2"] },
  { re: /championship/i, ex: /women|scotland/i, codes: ["eng.2", "eng.1"] },
  { re: /laliga|la liga/i, ex: /hypermotion|segunda|federacion|women/i, codes: ["esp.1", "esp.2"] },
  { re: /la liga 2|segunda|hypermotion/i, ex: /federacion|women/i, codes: ["esp.2", "esp.1"] },
  { re: /bundesliga/i, ex: /2\.|austria|women/i, codes: ["ger.1", "ger.2"] },
  { re: /2\.\s*bundesliga|dfb.?pokal/i, ex: /women/i, codes: ["ger.1", "ger.2"] },
  { re: /serie a/i, ex: /brazil|brasileiro|women/i, codes: ["ita.1", "ita.2"] },
  { re: /serie b/i, ex: /brazil|women/i, codes: ["ita.2", "ita.1"] },
  { re: /ligue 1/i, ex: /tunisia|algeria|ivory|women/i, codes: ["fra.1", "fra.2"] },
  { re: /ligue 2/i, ex: /women/i, codes: ["fra.2", "fra.1"] },
  { re: /eredivisie/i, ex: /women|vrouwen|eerste/i, codes: ["ned.1"] },
  { re: /primeira liga|liga portugal/i, ex: /2|b|women/i, codes: ["por.1"] },
  { re: /jupiler|pro league/i, ex: /women|challenge/i, codes: ["bel.1"] },
  { re: /super lig|süper lig/i, ex: /women|1\./i, codes: ["tur.1"] },
  { re: /premiership/i, ex: /northern|women/i, codes: ["sco.1"] },
  { re: /champions league/i, ex: /women/i, codes: ["uefa.champions", "eng.1", "esp.1", "ger.1", "ita.1", "fra.1"] },
  { re: /europa league/i, ex: /conference|women/i, codes: ["uefa.europa", "eng.1", "esp.1", "ger.1", "ita.1", "fra.1"] },
  { re: /conference league/i, ex: /women/i, codes: ["uefa.europa.conf", "eng.1", "esp.1", "ger.1", "ita.1", "fra.1"] }
];

async function fetchJsonSafe(url, timeoutMs = 7000, isEspn = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = isEspn
      ? { "User-Agent": ESPN_UA, Accept: "application/json" }
      : { "User-Agent": FB_UA, Accept: "application/json", Referer: "https://www.football.com/" };
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normTeamKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|as|afc|cfc|sfc|sv|vfb|vfl|1\.|ssc|us|cd|ca|ud|sd|rc|estac|club|de)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function poissonPmf(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lam) * Math.pow(lam, k)) / fact;
}

// Overdispersed Gamma-Poisson (Negative Binomial) when dispersion > 1.0, exact Poisson when dispersion <= 1.0
function probOverHalfLine(lam, lineFloat, dispersion = 1.0) {
  const kFloor = Math.floor(lineFloat);
  if (dispersion <= 1.02 || lam <= 0.1) {
    let pLe = 0;
    for (let i = 0; i <= kFloor; i++) pLe += poissonPmf(i, lam);
    return { pOver: clamp(1 - pLe, 0.04, 0.94), pUnder: clamp(pLe, 0.04, 0.94) };
  }
  // Negative binomial parameterization: mean = lam, var = lam * dispersion => r = lam / (dispersion - 1), p = r / (r + lam) = 1 / dispersion
  const r = lam / (dispersion - 1);
  const p = 1 / dispersion;
  let pmf = Math.pow(p, r);
  let pLe = pmf;
  for (let k = 0; k < kFloor; k++) {
    pmf = pmf * ((k + r) / (k + 1)) * (1 - p);
    pLe += pmf;
    if (!Number.isFinite(pLe)) break;
  }
  pLe = clamp(pLe, 0.04, 0.94);
  return { pOver: clamp(1 - pLe, 0.04, 0.94), pUnder: pLe };
}

function parseLineNumber(specifier) {
  const m = String(specifier || "").match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function detectEspnLeagueCodes(leagueName) {
  const s = String(leagueName || "");
  for (const row of ESPN_LEAGUE_MAP) {
    if (row.re.test(s) && (!row.ex || !row.ex.test(s))) return row.codes;
  }
  return [];
}

async function getEspnLeagueTeams(code) {
  if (!code) return [];
  const now = Date.now();
  const cached = espnLeagueTeamsCache.get(code);
  if (cached && now < cached.expiresAt) return cached.teams;
  const json = await fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/teams`, 6000, true);
  const teams = (json?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team).filter(Boolean);
  if (teams.length > 0) {
    espnLeagueTeamsCache.set(code, { teams, expiresAt: now + 6 * 3600000 });
  }
  return teams;
}

function teamNameMatches(teamObj, qNorm) {
  const dNorm = normTeamKey(teamObj.displayName);
  const sNorm = normTeamKey(teamObj.shortDisplayName);
  const nNorm = normTeamKey(teamObj.name);
  if (dNorm === qNorm || sNorm === qNorm || nNorm === qNorm) return true;
  if (qNorm.length >= 4 && (dNorm.includes(qNorm) || qNorm.includes(dNorm))) return true;
  if (sNorm.length >= 4 && qNorm.includes(sNorm)) return true;
  return false;
}

async function fetchEspnTeamRecentStats(codes, teamName) {
  const qNorm = normTeamKey(teamName);
  const codeList = Array.isArray(codes) ? codes : (codes ? [codes] : []);
  if (!qNorm || codeList.length === 0) return null;

  const cacheKey = `${codeList[0]}::${qNorm}`;
  const now = Date.now();
  const cached = espnTeamStatsCache.get(cacheKey);
  if (cached && now < cached.expiresAt) return cached.stats;

  let matchedTeam = null;
  let matchedCode = null;
  for (const c of codeList) {
    const teams = await getEspnLeagueTeams(c);
    const hit = teams.find((t) => teamNameMatches(t, qNorm));
    if (hit) {
      matchedTeam = hit;
      matchedCode = c;
      break;
    }
  }
  if (!matchedTeam) {
    espnTeamStatsCache.set(cacheKey, { stats: null, expiresAt: now + 30 * 60000 });
    return null;
  }

  const sch = await fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${matchedCode}/teams/${matchedTeam.id}/schedule`, 6500, true);
  const past = (sch?.events || []).filter((e) => e.competitions?.[0]?.status?.type?.completed).slice(-6);
  if (past.length < 3) {
    espnTeamStatsCache.set(cacheKey, { stats: null, expiresAt: now + 30 * 60000 });
    return null;
  }

  const sums = await Promise.all(
    past.map((ev) => fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${matchedCode}/summary?event=${ev.id}`, 6000, true))
  );

  const rows = [];
  const gkStarts = new Map();
  let latestStarterGk = null;

  for (let idx = 0; idx < past.length; idx++) {
    const ev = past[idx];
    const sum = sums[idx];
    const bx = sum?.boxscore?.teams || [];
    const myBx = bx.find((b) => String(b.team?.id) === String(matchedTeam.id));
    const opBx = bx.find((b) => String(b.team?.id) !== String(matchedTeam.id));
    if (!myBx || !opBx) continue;

    const getVal = (teamBx, key) => {
      const s = (teamBx.statistics || []).find((x) => x.name === key);
      const n = s ? parseFloat(s.displayValue) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    const comp = ev.competitions?.[0];
    const myComp = (comp?.competitors || []).find((c) => String(c.id) === String(matchedTeam.id));
    const opComp = (comp?.competitors || []).find((c) => String(c.id) !== String(matchedTeam.id));
    const venue = myComp?.homeAway === "away" ? "away" : "home";
    const myGoals = myComp ? parseFloat(myComp.score?.value ?? myComp.score ?? NaN) : NaN;
    const opGoals = opComp ? parseFloat(opComp.score?.value ?? opComp.score ?? NaN) : NaN;

    // Extract starting goalkeeper from roster
    const myRoster = (sum?.rosters || []).find((r) => String(r.team?.id) === String(matchedTeam.id));
    const startGks = (myRoster?.roster || []).filter((p) => p.starter && /^g/i.test(p.position?.abbreviation || p.position?.displayName || ""));
    if (startGks.length > 0 && startGks[0].athlete?.displayName) {
      const gkName = startGks[0].athlete.displayName.trim();
      gkStarts.set(gkName, (gkStarts.get(gkName) || 0) + 1);
      latestStarterGk = gkName;
    }

    const sotFor = getVal(myBx, "shotsOnTarget");
    const sotAg = getVal(opBx, "shotsOnTarget");
    const shotsFor = getVal(myBx, "totalShots");
    const shotsAg = getVal(opBx, "totalShots");
    const offFor = getVal(myBx, "offsides");
    const offAg = getVal(opBx, "offsides");
    const ycFor = getVal(myBx, "yellowCards");
    const ycAg = getVal(opBx, "yellowCards");
    const foulsFor = getVal(myBx, "foulsCommitted");
    const foulsAg = getVal(opBx, "foulsCommitted");
    const possFor = getVal(myBx, "possessionPct");
    const passFor = getVal(myBx, "totalPasses");
    const accPass = getVal(myBx, "accuratePasses");
    const clearancesFor = getVal(myBx, "totalClearance");
    const clearancesAg = getVal(opBx, "totalClearance");
    const longBallsFor = getVal(myBx, "totalLongBalls");
    const longBallsAg = getVal(opBx, "totalLongBalls");
    const crossesFor = getVal(myBx, "totalCrosses");
    const crossesAg = getVal(opBx, "totalCrosses");
    const blockedFor = getVal(myBx, "blockedShots");
    const blockedAg = getVal(opBx, "blockedShots");
    const cornersFor = getVal(myBx, "wonCorners");
    const cornersAg = getVal(opBx, "wonCorners");
    const explicitSaves = getVal(myBx, "saves");
    const savesEst = explicitSaves !== null
      ? explicitSaves
      : (sotAg !== null && Number.isFinite(opGoals) ? Math.max(0, sotAg - opGoals) : null);
    const missedFor = shotsFor !== null && sotFor !== null ? Math.max(0, shotsFor - sotFor) : null;
    const missedAg = shotsAg !== null && sotAg !== null ? Math.max(0, shotsAg - sotAg) : null;

    rows.push({
      venue,
      myGoals: Number.isFinite(myGoals) ? myGoals : null,
      opGoals: Number.isFinite(opGoals) ? opGoals : null,
      sotFor, sotAg, shotsFor, shotsAg, missedFor, missedAg,
      offFor, offAg, ycFor, ycAg, foulsFor, foulsAg,
      possFor, passFor,
      passAccPct: (accPass !== null && passFor && passFor > 0) ? (accPass / passFor) * 100 : null,
      clearancesFor, clearancesAg, longBallsFor, longBallsAg, crossesFor, crossesAg,
      blockedFor, blockedAg, cornersFor, cornersAg,
      savesFor: savesEst
    });
  }

  if (rows.length < 3) {
    espnTeamStatsCache.set(cacheKey, { stats: null, expiresAt: now + 30 * 60000 });
    return null;
  }

  const calcSplit = (subset) => {
    const avg = (k) => {
      const vals = subset.map((r) => r[k]).filter((v) => v !== null && Number.isFinite(v));
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    };
    return {
      mp: subset.length,
      gfAvg: avg("myGoals"),
      gaAvg: avg("opGoals"),
      sotFor: avg("sotFor"),
      sotAg: avg("sotAg"),
      shotsFor: avg("shotsFor"),
      shotsAg: avg("shotsAg"),
      missedFor: avg("missedFor"),
      missedAg: avg("missedAg"),
      offFor: avg("offFor"),
      offAg: avg("offAg"),
      ycFor: avg("ycFor"),
      ycAg: avg("ycAg"),
      foulsFor: avg("foulsFor"),
      foulsAg: avg("foulsAg"),
      possFor: avg("possFor"),
      passFor: avg("passFor"),
      passAccPct: avg("passAccPct"),
      clearancesFor: avg("clearancesFor"),
      clearancesAg: avg("clearancesAg"),
      longBallsFor: avg("longBallsFor"),
      longBallsAg: avg("longBallsAg"),
      crossesFor: avg("crossesFor"),
      crossesAg: avg("crossesAg"),
      blockedFor: avg("blockedFor"),
      blockedAg: avg("blockedAg"),
      cornersFor: avg("cornersFor"),
      cornersAg: avg("cornersAg"),
      savesFor: avg("savesFor")
    };
  };

  const homeRows = rows.filter((r) => r.venue === "home");
  const awayRows = rows.filter((r) => r.venue === "away");
  const overall = calcSplit(rows);

  const stats = {
    source: `ESPN ${matchedCode} (${rows.length}G: ${homeRows.length}H/${awayRows.length}A)`,
    leagueCode: matchedCode,
    ...overall,
    homeSplit: homeRows.length >= 2 ? calcSplit(homeRows) : null,
    awaySplit: awayRows.length >= 2 ? calcSplit(awayRows) : null,
    gkStarts: Array.from(gkStarts.entries()).map(([name, starts]) => ({ name, starts })).sort((a, b) => b.starts - a.starts),
    latestStarterGk
  };

  espnTeamStatsCache.set(cacheKey, { stats, expiresAt: now + 3600000 });
  return stats;
}

// Blend venue-specific average with overall average (60% venue / 40% overall) for realistic home/away edge
function venueStat(teamStats, venueSide, key) {
  if (!teamStats) return null;
  const split = venueSide === "home" ? teamStats.homeSplit : teamStats.awaySplit;
  const overallVal = teamStats[key];
  const splitVal = split ? split[key] : null;
  if (splitVal !== null && Number.isFinite(splitVal) && overallVal !== null && Number.isFinite(overallVal)) {
    return splitVal * 0.60 + overallVal * 0.40;
  }
  return overallVal !== null && Number.isFinite(overallVal) ? overallVal : null;
}

// Compute match 1X2 vig-free dominance and competitiveness
function computeMatchContext(g) {
  const b = g.bestOdds || {};
  const oH = Number(b.home);
  const oD = Number(b.draw);
  const oA = Number(b.away);
  if (!Number.isFinite(oH) || !Number.isFinite(oA) || oH <= 1 || oA <= 1) {
    return { pHome: 0.42, pDraw: 0.26, pAway: 0.32, dom: 0.10, tightness: 0.85, favoriteSide: "EVEN" };
  }
  const rH = 1 / oH;
  const rD = Number.isFinite(oD) && oD > 1 ? 1 / oD : 0.25;
  const rA = 1 / oA;
  const sum = rH + rD + rA;
  const pHome = rH / sum;
  const pDraw = rD / sum;
  const pAway = rA / sum;
  const dom = pHome - pAway; // positive = home favorite, negative = away favorite
  const tightness = clamp(1 - Math.abs(dom) * 1.15, 0.25, 1.0);
  const favoriteSide = dom > 0.18 ? "HOME" : (dom < -0.18 ? "AWAY" : "BALANCED");
  return { pHome, pDraw, pAway, dom, tightness, favoriteSide };
}

function isConfirmedStarterGk(playerName, espnStats) {
  if (!espnStats || !espnStats.gkStarts || espnStats.gkStarts.length === 0) return false;
  const pNorm = normTeamKey(playerName);
  const pTokens = pNorm.split(" ").filter((x) => x.length >= 3);
  const topGk = espnStats.latestStarterGk || espnStats.gkStarts[0].name;
  // Match either latest starter OR someone who started >= 2 of last 6 matches
  const checkMatch = (candidateName) => {
    const cNorm = normTeamKey(candidateName);
    if (!cNorm || !pNorm) return false;
    if (cNorm === pNorm || cNorm.includes(pNorm) || pNorm.includes(cNorm)) return true;
    // Match surname token when ESPN includes full/abbreviated first name
    const pLast = pTokens[pTokens.length - 1];
    const cTokens = cNorm.split(" ");
    const cLast = cTokens[cTokens.length - 1];
    if (pLast && cLast && pLast.length >= 4 && pLast === cLast && pTokens[0]?.[0] === cTokens[0]?.[0]) return true;
    return false;
  };
  if (checkMatch(topGk)) return true;
  return espnStats.gkStarts.some((g) => g.starts >= 2 && checkMatch(g.name));
}

// Market-Anchored +EV Selection with Dispersion & Sanity Guard
function pickBestOuFromLines(candidates, category, g, logicSummary, options = {}) {
  const dispersion = options.dispersion || 1.0;
  const modelWeight = options.modelWeight || 0.62;
  const pillars = options.pillars || [];
  const dataQuality = options.dataQuality || "ESPN_VERIFIED";
  const valid = [];

  for (const c of candidates) {
    if (!Number.isFinite(c.line) || !Number.isFinite(c.lam) || c.lam <= 0) continue;
    const { pOver: pModelO, pUnder: pModelU } = probOverHalfLine(c.lam, c.line, dispersion);

    // Vig-free market implied probabilities when 2-way line is quoted
    let pMktO = null;
    let pMktU = null;
    if (Number.isFinite(c.oddOver) && c.oddOver > 1.05 && Number.isFinite(c.oddUnder) && c.oddUnder > 1.05) {
      const rO = 1 / c.oddOver;
      const rU = 1 / c.oddUnder;
      pMktO = rO / (rO + rU);
      pMktU = rU / (rO + rU);
    }

    // Check OVER
    if (Number.isFinite(c.oddOver) && c.oddOver >= 1.25 && c.oddOver <= 3.60) {
      const marketRef = pMktO !== null ? pMktO : clamp((1 / c.oddOver) * 0.93, 0.10, 0.90);
      const divergence = pModelO - marketRef;
      // Reject extreme model-vs-market hallucinations (divergence > 20% usually signals missing lineup/context)
      if (divergence <= 0.21 && divergence >= -0.05) {
        const pCalibrated = pMktO !== null ? (pModelO * modelWeight + pMktO * (1 - modelWeight)) : (pModelO * 0.72 + marketRef * 0.28);
        const ev = (pCalibrated * c.oddOver) - 1;
        const fairOdds = Math.round((1 / pCalibrated) * 100) / 100;
        if (pCalibrated >= 0.57 && ev >= 0.02 && ev <= 0.25) {
          valid.push({
            side: "OVER",
            marketLine: c.labelOver || `Over ${c.line}`,
            prob: pCalibrated,
            modelProb: pModelO,
            marketProb: marketRef,
            fairOdds,
            bookieOdds: c.oddOver,
            ev,
            lam: c.lam,
            targetTeam: c.targetTeam || g.homeTeamName,
            scope: c.scope || "Match Total"
          });
        }
      }
    }

    // Check UNDER
    if (Number.isFinite(c.oddUnder) && c.oddUnder >= 1.25 && c.oddUnder <= 3.60) {
      const marketRef = pMktU !== null ? pMktU : clamp((1 / c.oddUnder) * 0.93, 0.10, 0.90);
      const divergence = pModelU - marketRef;
      if (divergence <= 0.21 && divergence >= -0.05) {
        const pCalibrated = pMktU !== null ? (pModelU * modelWeight + pMktU * (1 - modelWeight)) : (pModelU * 0.72 + marketRef * 0.28);
        const ev = (pCalibrated * c.oddUnder) - 1;
        const fairOdds = Math.round((1 / pCalibrated) * 100) / 100;
        if (pCalibrated >= 0.57 && ev >= 0.02 && ev <= 0.25) {
          valid.push({
            side: "UNDER",
            marketLine: c.labelUnder || `Under ${c.line}`,
            prob: pCalibrated,
            modelProb: pModelU,
            marketProb: marketRef,
            fairOdds,
            bookieOdds: c.oddUnder,
            ev,
            lam: c.lam,
            targetTeam: c.targetTeam || g.homeTeamName,
            scope: c.scope || "Match Total"
          });
        }
      }
    }
  }

  if (valid.length === 0) return null;

  // Score prioritizes balanced high-probability + sustainable +EV
  valid.sort((a, b) => (b.ev * 1.2 + (b.prob - 0.55) * 0.85) - (a.ev * 1.2 + (a.prob - 0.55) * 0.85));
  const best = valid[0];
  const evPctNum = Math.round(best.ev * 10000) / 100;
  const probPctNum = Math.round(best.prob * 1000) / 10;
  const modelPctNum = Math.round(best.modelProb * 1000) / 10;
  const mktPctNum = Math.round(best.marketProb * 1000) / 10;

  let grade = "B+ SOLID";
  if (best.ev >= 0.08 && best.prob >= 0.62) grade = "A+ ELITE";
  else if (best.ev >= 0.045 && best.prob >= 0.58) grade = "A STRONG";

  const loc = canonicalizeLeagueAndCountry(g.league, g.country);

  return {
    id: `prop_${category}_${g.eventId}_${best.side}_${best.marketLine.replace(/[^a-z0-9]/gi, "_")}`,
    category,
    eventId: g.eventId,
    fixture: `${g.homeTeamName} vs ${g.awayTeamName}`,
    homeTeam: g.homeTeamName,
    awayTeam: g.awayTeamName,
    homeLogo: g.homeLogo || "",
    awayLogo: g.awayLogo || "",
    league: loc.leagueName || g.league || "Football",
    country: loc.country || g.country || "International",
    flag: g.flag || loc.flag || "🌍",
    isoDate: g.isoDate,
    kickoffUtc: g.kickoffUtc,
    footballComGameId: g.footballComGameId || g.footballCom?.gameId || null,
    sportybetGameId: g.sportybetGameId || g.sportybet?.gameId || null,
    side: best.side,
    scope: best.scope,
    targetTeam: best.targetTeam,
    marketLine: best.marketLine,
    expectedAvg: Math.round(best.lam * 100) / 100,
    trueProbability: Math.round(best.prob * 1000) / 1000,
    trueProbabilityPct: `${probPctNum.toFixed(1)}%`,
    modelProbabilityPct: `${modelPctNum.toFixed(1)}%`,
    marketImpliedPct: `${mktPctNum.toFixed(1)}%`,
    fairOdds: best.fairOdds,
    bookmakerOdds: best.bookieOdds,
    expectedValue: Math.round(best.ev * 10000) / 10000,
    expectedValuePct: `${evPctNum >= 0 ? "+" : ""}${evPctNum.toFixed(2)}%`,
    isPositiveEv: best.ev > 0,
    qualityTier: grade,
    dataQuality,
    pillars,
    logicSummary,
    mastermind: {
      logic: `${grade} · Calibrated Prob ${probPctNum.toFixed(1)}% (Model ${modelPctNum.toFixed(1)}% anchored with Market ${mktPctNum.toFixed(1)}%) -> Fair ${best.fairOdds.toFixed(2)}.`,
      decision: `${best.marketLine} @ ${best.bookieOdds.toFixed(2)} (${evPctNum >= 0 ? "+" : ""}${evPctNum.toFixed(2)}% EV)`
    }
  };
}

function buildGoalsPicksForGame(g, markets, hEspn, aEspn, ctx) {
  const hasBothEspn = Boolean(hEspn && aEspn);
  // Require verified team stats either from ESPN or Sportradar verified form
  if (!hasBothEspn && !g.hasVerifiedStats) return null;

  const hs = g.homeStats || {};
  const as = g.awayStats || {};
  const hGf = hasBothEspn ? (venueStat(hEspn, "home", "gfAvg") ?? hs.gfAvg ?? 1.3) : hs.gfAvg;
  const hGa = hasBothEspn ? (venueStat(hEspn, "home", "gaAvg") ?? hs.gaAvg ?? 1.2) : hs.gaAvg;
  const aGf = hasBothEspn ? (venueStat(aEspn, "away", "gfAvg") ?? as.gfAvg ?? 1.1) : as.gfAvg;
  const aGa = hasBothEspn ? (venueStat(aEspn, "away", "gaAvg") ?? as.gaAvg ?? 1.2) : as.gaAvg;
  if (!Number.isFinite(hGf) || !Number.isFinite(aGf) || !Number.isFinite(hGa) || !Number.isFinite(aGa)) return null;

  // Include Shots On Target efficiency adjustment if ESPN verified
  let sotBoost = 0;
  if (hasBothEspn && hEspn.sotFor && aEspn.sotFor) {
    const matchSot = ((venueStat(hEspn, "home", "sotFor") + venueStat(aEspn, "away", "sotAg")) * 0.5)
      + ((venueStat(aEspn, "away", "sotFor") + venueStat(hEspn, "home", "sotAg")) * 0.5);
    sotBoost = clamp((matchSot - 8.5) * 0.08, -0.35, 0.35);
  }

  const lamTotal = clamp(((hGf + aGa) * 0.5) + ((aGf + hGa) * 0.5) + sotBoost, 1.40, 4.30);

  const candidates = [];
  for (const m of markets.filter((x) => String(x.id) === "18")) {
    const line = parseLineNumber(m.specifier);
    if (!line || line < 1.5 || line > 3.5 || Math.abs((line % 1) - 0.5) > 0.01) continue;
    let oddO = null, oddU = null;
    for (const o of (m.outcomes || [])) {
      const odd = parseFloat(o.odds);
      if (!Number.isFinite(odd)) continue;
      if (/over/i.test(o.desc)) oddO = odd;
      if (/under/i.test(o.desc)) oddU = odd;
    }
    candidates.push({
      line,
      lam: lamTotal,
      oddOver: oddO,
      oddUnder: oddU,
      labelOver: `Over ${line} Goals`,
      labelUnder: `Under ${line} Goals`,
      scope: "Match Total Goals"
    });
  }

  const dataSrc = hasBothEspn ? `${hEspn.source} + ${aEspn.source}` : "Verified Season/Form Goal Rates";
  return pickBestOuFromLines(
    candidates,
    "GOALS",
    g,
    `Venue-Weighted Goal λ=${lamTotal.toFixed(2)}: ${g.homeTeamName} Home GF ${hGf.toFixed(2)}/GA ${hGa.toFixed(2)} vs ${g.awayTeamName} Away GF ${aGf.toFixed(2)}/GA ${aGa.toFixed(2)}${sotBoost !== 0 ? ` (SOT Tempo ${sotBoost >= 0 ? "+" : ""}${sotBoost.toFixed(2)})` : ""}`,
    {
      dispersion: 1.05,
      modelWeight: hasBothEspn ? 0.62 : 0.52,
      dataQuality: hasBothEspn ? "ESPN_VENUE_VERIFIED" : "VERIFIED_FORM",
      pillars: [
        `Data: ${dataSrc}`,
        `Matchup: ${ctx.favoriteSide} (${Math.round(ctx.pHome * 100)}%/${Math.round(ctx.pDraw * 100)}%/${Math.round(ctx.pAway * 100)}%)`
      ]
    }
  );
}

function buildStatPicksForGame(g, markets, hEspn, aEspn) {
  const out = [];
  const ctx = computeMatchContext(g);
  const hasStrictEspn = Boolean(hEspn && aEspn && hEspn.mp >= 3 && aEspn.mp >= 3);

  const collectOu = (marketId, scope, targetTeam, lamFn, prefix) => {
    const arr = [];
    for (const m of markets.filter((x) => String(x.id) === String(marketId))) {
      const line = parseLineNumber(m.specifier);
      if (!Number.isFinite(line) || Math.abs((line % 1) - 0.5) > 0.01) continue;
      let oddO = null, oddU = null;
      for (const o of (m.outcomes || [])) {
        const odd = parseFloat(o.odds);
        if (!Number.isFinite(odd)) continue;
        if (/over/i.test(o.desc)) oddO = odd;
        if (/under/i.test(o.desc)) oddU = odd;
      }
      const lam = lamFn(line);
      if (!Number.isFinite(lam)) continue;
      arr.push({
        line,
        lam,
        oddOver: oddO,
        oddUnder: oddU,
        labelOver: `${prefix} Over ${line}`,
        labelUnder: `${prefix} Under ${line}`,
        scope,
        targetTeam
      });
    }
    return arr;
  };

  // 1. GOALS O/U
  const goalPick = buildGoalsPicksForGame(g, markets, hEspn, aEspn, ctx);
  if (goalPick) out.push(goalPick);

  // STRICT NO-GUESSING GATE for detailed stat props: require real ESPN boxscores (>=3 matches) for BOTH teams
  if (!hasStrictEspn) {
    return out;
  }

  // Venue-weighted match possession projection (Accounts for dominance!)
  const hPossBase = venueStat(hEspn, "home", "possFor") ?? 50;
  const aPossBase = venueStat(aEspn, "away", "possFor") ?? 50;
  const estHomePoss = clamp(50 + ((hPossBase - aPossBase) * 0.45) + (ctx.dom * 14), 26, 74);
  const estAwayPoss = 100 - estHomePoss;

  // 2. THROW-INS O/U (Real Clearances + Long Balls + Crosses + Contested Tempo, heavily anchored to Market)
  if (markets.some((x) => String(x.id) === "900769" || String(x.id) === "900778" || String(x.id) === "900779")) {
    const hClear = venueStat(hEspn, "home", "clearancesFor") ?? 16;
    const aClear = venueStat(aEspn, "away", "clearancesFor") ?? 16;
    const hLong = venueStat(hEspn, "home", "longBallsFor") ?? 48;
    const aLong = venueStat(aEspn, "away", "longBallsFor") ?? 48;
    const hCross = venueStat(hEspn, "home", "crossesFor") ?? 14;
    const aCross = venueStat(aEspn, "away", "crossesFor") ?? 14;
    const hAcc = venueStat(hEspn, "home", "passAccPct") ?? 81;
    const aAcc = venueStat(aEspn, "away", "passAccPct") ?? 81;
    const avgAcc = (hAcc + aAcc) * 0.5;

    // Physics: Clearances + Crosses + Long balls into channels + Inaccurate passing drive ball out via touchline
    const disruptionIndex = ((hClear + aClear) - 32) * 0.16 + ((hLong + aLong) - 95) * 0.05 + ((hCross + aCross) - 28) * 0.14 + (82 - avgAcc) * 0.42;
    const lamMatchThrows = clamp(35.0 + disruptionIndex, 27.0, 44.0);
    // Team spending LESS time on the ball wins/forces throw-ins differently: higher possession opponent yields throw-ins in opponent third, underdog defends wings
    const hShare = clamp(0.50 + ((50 - estHomePoss) * 0.0035) + ((aClear - hClear) * 0.002), 0.38, 0.62);
    const lamHomeThrows = clamp(lamMatchThrows * hShare, 12.0, 23.0);
    const lamAwayThrows = clamp(lamMatchThrows - lamHomeThrows, 12.0, 23.0);

    const throwCands = [
      ...collectOu(900769, "Match Total Throw-Ins", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamMatchThrows, "Match Throw-Ins"),
      ...collectOu(900778, `${g.homeTeamName} Throw-Ins`, g.homeTeamName, () => lamHomeThrows, `${g.homeTeamName} Throw-Ins`),
      ...collectOu(900779, `${g.awayTeamName} Throw-Ins`, g.awayTeamName, () => lamAwayThrows, `${g.awayTeamName} Throw-Ins`)
    ];
    const tp = pickBestOuFromLines(
      throwCands,
      "THROW_INS",
      g,
      `Clearances/Long-Ball Physics: ${g.homeTeamName} (${hClear.toFixed(0)} Clr, ${hLong.toFixed(0)} LB, ${estHomePoss.toFixed(0)}% est poss) vs ${g.awayTeamName} (${aClear.toFixed(0)} Clr, ${aLong.toFixed(0)} LB, ${hAcc.toFixed(0)}%/${aAcc.toFixed(0)}% Pass%)`,
      {
        dispersion: 1.42,
        modelWeight: 0.46,
        dataQuality: "ESPN_PHYSICS_PROXY",
        pillars: [
          `ESPN Boxscores: ${hEspn.source} · ${aEspn.source}`,
          `Touchline Drivers: Clr ${(hClear + aClear).toFixed(0)} · LB ${(hLong + aLong).toFixed(0)} · Cross ${(hCross + aCross).toFixed(0)}`
        ]
      }
    );
    if (tp) out.push(tp);
  }

  // 3. SHOTS ON TARGET O/U (Venue-Split SOT adjusted by Match Dominance / Possession Share)
  if (markets.some((x) => String(x.id) === "900393" || String(x.id) === "900546" || String(x.id) === "900547")) {
    const hSotF = venueStat(hEspn, "home", "sotFor");
    const hSotA = venueStat(hEspn, "home", "sotAg");
    const aSotF = venueStat(aEspn, "away", "sotFor");
    const aSotA = venueStat(aEspn, "away", "sotAg");

    if (hSotF !== null && hSotA !== null && aSotF !== null && aSotA !== null) {
      // Scale team SOT expectation by dominance factor (favorites at home generate more SOT, strong defenses suppress underdogs)
      const hDomScale = clamp(1 + ctx.dom * 0.28 + ((estHomePoss - 50) * 0.004), 0.72, 1.32);
      const aDomScale = clamp(1 - ctx.dom * 0.28 + ((estAwayPoss - 50) * 0.004), 0.68, 1.28);
      const lamHomeSot = clamp(((hSotF * 0.58 + aSotA * 0.42) * hDomScale), 1.6, 8.8);
      const lamAwaySot = clamp(((aSotF * 0.58 + hSotA * 0.42) * aDomScale), 1.2, 8.0);

      const sotCands = [
        ...collectOu(900393, "Match Total Shots On Target", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeSot + lamAwaySot, "Match SOT"),
        ...collectOu(900546, `${g.homeTeamName} SOT`, g.homeTeamName, () => lamHomeSot, `${g.homeTeamName} SOT`),
        ...collectOu(900547, `${g.awayTeamName} SOT`, g.awayTeamName, () => lamAwaySot, `${g.awayTeamName} SOT`)
      ];
      const sp = pickBestOuFromLines(
        sotCands,
        "SHOTS_ON_TARGET",
        g,
        `Venue SOT + Dominance: ${g.homeTeamName} Home SOT ${hSotF.toFixed(1)}F/${hSotA.toFixed(1)}A (Poss ${estHomePoss.toFixed(0)}%) vs ${g.awayTeamName} Away SOT ${aSotF.toFixed(1)}F/${aSotA.toFixed(1)}A`,
        {
          dispersion: 1.18,
          modelWeight: 0.62,
          dataQuality: "ESPN_VENUE_VERIFIED",
          pillars: [
            `ESPN Boxscores: ${hEspn.source} · ${aEspn.source}`,
            `Dominance Adj: Home ×${hDomScale.toFixed(2)} · Away ×${aDomScale.toFixed(2)}`
          ]
        }
      );
      if (sp) out.push(sp);
    }
  }

  // 4. OFFSIDES O/U (Venue-Split Offsides + Long-Ball Directness)
  if (markets.some((x) => String(x.id) === "900396" || String(x.id) === "900568" || String(x.id) === "900569")) {
    const hOffF = venueStat(hEspn, "home", "offFor");
    const hOffA = venueStat(hEspn, "home", "offAg");
    const aOffF = venueStat(aEspn, "away", "offFor");
    const aOffA = venueStat(aEspn, "away", "offAg");

    if (hOffF !== null && hOffA !== null && aOffF !== null && aOffA !== null) {
      const lamHomeOff = clamp(hOffF * 0.55 + aOffA * 0.45, 0.6, 4.5);
      const lamAwayOff = clamp(aOffF * 0.55 + hOffA * 0.45, 0.6, 4.5);

      const offCands = [
        ...collectOu(900396, "Match Total Offsides", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeOff + lamAwayOff, "Match Offsides"),
        ...collectOu(900568, `${g.homeTeamName} Offsides`, g.homeTeamName, () => lamHomeOff, `${g.homeTeamName} Offsides`),
        ...collectOu(900569, `${g.awayTeamName} Offsides`, g.awayTeamName, () => lamAwayOff, `${g.awayTeamName} Offsides`)
      ];
      const op = pickBestOuFromLines(
        offCands,
        "OFFSIDE",
        g,
        `Venue Offside Trap: ${g.homeTeamName} (${hOffF.toFixed(1)} Off / ${hOffA.toFixed(1)} Trap) vs ${g.awayTeamName} (${aOffF.toFixed(1)} Off / ${aOffA.toFixed(1)} Trap)`,
        {
          dispersion: 1.25,
          modelWeight: 0.58,
          dataQuality: "ESPN_VENUE_VERIFIED",
          pillars: [
            `ESPN Boxscores: ${hEspn.source} · ${aEspn.source}`,
            `Trap Rate: Home ${hOffA.toFixed(1)}/g · Away ${aOffA.toFixed(1)}/g`
          ]
        }
      );
      if (op) out.push(op);
    }
  }

  // 5. BOOKINGS O/U (Yellow Cards + Fouls Committed + Match Competitiveness/Tightness Multiplier)
  {
    const hYcF = venueStat(hEspn, "home", "ycFor");
    const hYcA = venueStat(hEspn, "home", "ycAg");
    const aYcF = venueStat(aEspn, "away", "ycFor");
    const aYcA = venueStat(aEspn, "away", "ycAg");
    const hFouls = venueStat(hEspn, "home", "foulsFor") ?? 10.5;
    const aFouls = venueStat(aEspn, "away", "foulsFor") ?? 11.5;

    if (hYcF !== null && hYcA !== null && aYcF !== null && aYcA !== null) {
      // Competitive matches generate +8% more cards; one-sided matches generate slightly fewer tactical fouls
      const compMult = clamp(0.88 + ctx.tightness * 0.20, 0.88, 1.08);
      const foulCardAdj = clamp(((hFouls + aFouls) - 21.5) * 0.04, -0.35, 0.45);
      const lamHomeYc = clamp(((hYcF * 0.58 + aYcA * 0.42) * compMult) + foulCardAdj * 0.45, 0.7, 3.8);
      const lamAwayYc = clamp(((aYcF * 0.58 + hYcA * 0.42) * compMult) + foulCardAdj * 0.55, 0.8, 4.0);

      const bookCands = [
        ...collectOu(139, "Match Total Bookings", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeYc + lamAwayYc, "Match Bookings"),
        ...collectOu(900304, `${g.homeTeamName} Bookings`, g.homeTeamName, () => lamHomeYc, `${g.homeTeamName} Bookings`),
        ...collectOu(900305, `${g.awayTeamName} Bookings`, g.awayTeamName, () => lamAwayYc, `${g.awayTeamName} Bookings`)
      ];

      for (const m of markets.filter((x) => String(x.id) === "800063")) {
        for (const o of (m.outcomes || [])) {
          const km = String(o.desc || "").match(/^(\d+)\+$/);
          const odd = parseFloat(o.odds);
          if (!km || !Number.isFinite(odd)) continue;
          const threshold = parseInt(km[1], 10);
          if (threshold < 2 || threshold > 6) continue;
          bookCands.push({
            line: threshold - 0.5,
            lam: lamHomeYc + lamAwayYc,
            oddOver: odd,
            oddUnder: null,
            labelOver: `Match Cards ${threshold}+ (Over ${threshold - 0.5})`,
            scope: "Match Total Cards",
            targetTeam: `${g.homeTeamName} vs ${g.awayTeamName}`
          });
        }
      }

      const bp = pickBestOuFromLines(
        bookCands,
        "BOOKINGS",
        g,
        `Discipline & Tightness: ${g.homeTeamName} (${hYcF.toFixed(1)} YC, ${hFouls.toFixed(1)} Fouls) vs ${g.awayTeamName} (${aYcF.toFixed(1)} YC, ${aFouls.toFixed(1)} Fouls) · Tightness ${(ctx.tightness * 100).toFixed(0)}%`,
        {
          dispersion: 1.28,
          modelWeight: 0.60,
          dataQuality: "ESPN_VENUE_VERIFIED",
          pillars: [
            `ESPN Boxscores: ${hEspn.source} · ${aEspn.source}`,
            `Fouls & Tightness: ${(hFouls + aFouls).toFixed(1)} Fouls/g · ×${compMult.toFixed(2)}`
          ]
        }
      );
      if (bp) out.push(bp);
    }
  }

  // 6. SAVES O/U (Confirmed Starter GK Filter + Real ESPN Saves & Opponent Attacking Pressure Gate)
  {
    const hSotF = venueStat(hEspn, "home", "sotFor");
    const aSotF = venueStat(aEspn, "away", "sotFor");
    const hSotA = venueStat(hEspn, "home", "sotAg");
    const aSotA = venueStat(aEspn, "away", "sotAg");
    const hSavesHist = venueStat(hEspn, "home", "savesFor");
    const aSavesHist = venueStat(aEspn, "away", "savesFor");
    const hOppGoalsEst = venueStat(hEspn, "home", "gaAvg") ?? 1.1;
    const aOppGoalsEst = venueStat(aEspn, "away", "gaAvg") ?? 1.3;

    if (hSotF !== null && aSotF !== null && hSavesHist !== null && aSavesHist !== null) {
      const hDomScale = clamp(1 + ctx.dom * 0.25, 0.72, 1.30);
      const aDomScale = clamp(1 - ctx.dom * 0.25, 0.70, 1.28);
      const expectedSotOnHome = ((aSotF * 0.55 + (hSotA ?? aSotF) * 0.45) * aDomScale);
      const expectedSotOnAway = ((hSotF * 0.55 + (aSotA ?? hSotF) * 0.45) * hDomScale);

      const lamHomeGkSaves = clamp((hSavesHist * 0.48) + (Math.max(1.2, expectedSotOnHome - hOppGoalsEst) * 0.52), 1.4, 5.8);
      const lamAwayGkSaves = clamp((aSavesHist * 0.48) + (Math.max(1.4, expectedSotOnAway - aOppGoalsEst) * 0.52), 1.5, 6.2);

      const saveCands = [];
      for (const m of markets.filter((x) => String(x.id) === "800297")) {
        for (const o of (m.outcomes || [])) {
          const match = String(o.desc || "").match(/^(.+?)\s*\(([^)]+)\)\s*(\d+)\+$/);
          const odd = parseFloat(o.odds);
          if (!match || !Number.isFinite(odd)) continue;
          const player = match[1].trim();
          const teamLabel = match[2].trim();
          const threshold = parseInt(match[3], 10);
          if (threshold < 2 || threshold > 6) continue;

          const isHomeGk = normTeamKey(teamLabel).includes(normTeamKey(g.homeTeamName).split(" ")[0] || "___") ||
            normTeamKey(g.homeTeamName).includes(normTeamKey(teamLabel).split(" ")[0] || "___");
          const teamEspn = isHomeGk ? hEspn : aEspn;

          // Block 2nd/3rd choice non-starting keepers AND avoid GKs whose team faces weak attacking pressure
          if (!isConfirmedStarterGk(player, teamEspn)) continue;
          const oppWinProb = isHomeGk ? ctx.pAway : ctx.pHome;
          const expSotOnMe = isHomeGk ? expectedSotOnHome : expectedSotOnAway;
          if (oppWinProb < 0.30 && expSotOnMe < 4.5) continue;

          const gkLam = isHomeGk ? lamHomeGkSaves : lamAwayGkSaves;
          saveCands.push({
            line: threshold - 0.5,
            lam: gkLam,
            oddOver: odd,
            oddUnder: null,
            labelOver: `${player} (${teamLabel}) Over ${threshold - 0.5} Saves (${threshold}+)`,
            scope: "Starter GK Saves Over",
            targetTeam: `${player} (${teamLabel})`
          });
        }
      }

      const svp = pickBestOuFromLines(
        saveCands,
        "SAVES",
        g,
        `Starter GK Verified: ${hEspn.latestStarterGk || "Home GK"} (~${lamHomeGkSaves.toFixed(2)} sv/g) vs ${aEspn.latestStarterGk || "Away GK"} (~${lamAwayGkSaves.toFixed(2)} sv/g) · Opp Adj SOT ${expectedSotOnHome.toFixed(1)} vs ${expectedSotOnAway.toFixed(1)}`,
        {
          dispersion: 1.15,
          modelWeight: 0.62,
          dataQuality: "ESPN_STARTER_GK_VERIFIED",
          pillars: [
            `Confirmed Starter GK Only (${hEspn.latestStarterGk || "-"} / ${aEspn.latestStarterGk || "-"})`,
            `ESPN Saves Avg: Home ${hSavesHist.toFixed(1)}/g · Away ${aSavesHist.toFixed(1)}/g`
          ]
        }
      );
      if (svp) out.push(svp);
    }
  }

  return out;
}

async function fetchStatPropsIntelligence(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedPropsPayload && now < cachedPropsExpiresAt) {
    return cachedPropsPayload;
  }
  if (propsInFlight && !forceRefresh) {
    return propsInFlight;
  }

  propsInFlight = (async () => {
    try {
      const bkScan = await bookmakersApi.runFullBookmakerScan(false).catch(() => null);
      const allFootball = (bkScan?.allGames || []).filter((g) => (g.sport || "football") === "football" && !g.isCompleted);

      // Prioritize fixtures in leagues where ESPN provides complete deep boxscores + Football.com exposes prop lines
      const sorted = [...allFootball].sort((a, b) => {
        const aTop = detectEspnLeagueCodes(a.league).length > 0 ? 1 : 0;
        const bTop = detectEspnLeagueCodes(b.league).length > 0 ? 1 : 0;
        if (aTop !== bTop) return bTop - aTop;
        if (Boolean(a.hasVerifiedStats) !== Boolean(b.hasVerifiedStats)) return a.hasVerifiedStats ? -1 : 1;
        return (a.estimateStartTime || 0) - (b.estimateStartTime || 0);
      });

      const targets = sorted.slice(0, 26);
      const buckets = {
        GOALS: [],
        SHOTS_ON_TARGET: [],
        OFFSIDE: [],
        BOOKINGS: [],
        THROW_INS: [],
        SAVES: []
      };

      const chunkSize = 6;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (g) => {
            const codes = detectEspnLeagueCodes(g.league);
            if (codes.length === 0 && !g.hasVerifiedStats) return;

            const [evJson, hEspn, aEspn] = await Promise.all([
              fetchJsonSafe(`https://www.football.com/api/gh/factsCenter/event?eventId=${encodeURIComponent(g.eventId)}&productId=3`, 7500, false),
              codes.length > 0 ? fetchEspnTeamRecentStats(codes, g.homeTeamName) : Promise.resolve(null),
              codes.length > 0 ? fetchEspnTeamRecentStats(codes, g.awayTeamName) : Promise.resolve(null)
            ]);
            const markets = evJson?.data?.markets || [];
            if (markets.length === 0) return;

            const picks = buildStatPicksForGame(g, markets, hEspn, aEspn);
            for (const p of picks) {
              if (buckets[p.category]) buckets[p.category].push(p);
            }
          })
        );
      }

      for (const k of Object.keys(buckets)) {
        buckets[k].sort((a, b) => (b.expectedValue * 1.2 + (b.trueProbability - 0.55) * 0.85) - (a.expectedValue * 1.2 + (a.trueProbability - 0.55) * 0.85));
      }

      const payload = {
        ok: true,
        engineVersion: "2.0-DEEP",
        generatedAt: new Date().toISOString(),
        matchesScanned: targets.length,
        categories: buckets,
        counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]))
      };

      cachedPropsPayload = payload;
      cachedPropsExpiresAt = Date.now() + 15 * 60 * 1000;
      return payload;
    } finally {
      propsInFlight = null;
    }
  })();

  return propsInFlight;
}

async function handleStatPropsProxy(req, res) {
  const reqUrl = new URL(req.url || "/api/statprops", `http://${req.headers.host || "localhost"}`);
  const force = reqUrl.searchParams.get("refresh") === "1";
  try {
    const data = await fetchStatPropsIntelligence(force);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: err?.message || "Failed to build stat props" }));
  }
}

handleStatPropsProxy.fetchStatPropsIntelligence = fetchStatPropsIntelligence;
module.exports = handleStatPropsProxy;
