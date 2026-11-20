// Over/Under Stat-Market Intelligence Engine (Goals, Throw-ins, Shots On Target, Offside, Bookings, Goal Kicks, Saves)
// Fetches live Football.com prop lines + ESPN last-5 match statistics + Sportradar form/goals to compute Poisson +EV tips.

const bookmakersApi = require("./bookmakers");
const { canonicalizeLeagueAndCountry } = require("./leagueCatalog");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let cachedPropsPayload = null;
let cachedPropsExpiresAt = 0;
let propsInFlight = null;

const espnTeamStatsCache = new Map(); // normalizedName -> { stats, expiresAt }
const espnLeagueTeamsCache = new Map(); // code -> { teams, expiresAt }

const ESPN_LEAGUE_MAP = [
  { re: /premier league/i, ex: /women|wsl|scotland|ireland|ukraine|russia|egypt|india|kenya|ghana|nigeria|armenia/i, code: "eng.1" },
  { re: /laliga|la liga/i, ex: /hypermotion|segunda|federacion|women/i, code: "esp.1" },
  { re: /bundesliga/i, ex: /2\.|austria|women/i, code: "ger.1" },
  { re: /serie a/i, ex: /brazil|brasileiro|women/i, code: "ita.1" },
  { re: /ligue 1/i, ex: /tunisia|algeria|ivory|women/i, code: "fra.1" },
  { re: /eredivisie/i, ex: /women|vrouwen|eerste/i, code: "ned.1" },
  { re: /champions league/i, ex: /women/i, code: "uefa.champions" },
  { re: /europa league/i, ex: /women/i, code: "uefa.europa" }
];

async function fetchJsonSafe(url, timeoutMs = 7500, referer = "https://www.football.com/") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "application/json", "Referer": referer }
    });
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
    .replace(/\b(fc|cf|sc|ac|as|afc|cfc|sfc|sv|vfb|vfl|1\.|ssc|us|cd|ca|ud|sd|rc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function poissonPmf(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lam) * Math.pow(lam, k)) / fact;
}

function probOverHalfLine(lam, lineFloat) {
  const kFloor = Math.floor(lineFloat);
  let pLe = 0;
  for (let i = 0; i <= kFloor; i++) pLe += poissonPmf(i, lam);
  const pOver = clamp(1 - pLe, 0.03, 0.96);
  const pUnder = clamp(pLe, 0.03, 0.96);
  return { pOver, pUnder };
}

function parseLineNumber(specifier) {
  const m = String(specifier || "").match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function detectEspnLeagueCode(leagueName) {
  const s = String(leagueName || "");
  for (const row of ESPN_LEAGUE_MAP) {
    if (row.re.test(s) && (!row.ex || !row.ex.test(s))) return row.code;
  }
  return null;
}

async function getEspnLeagueTeams(code) {
  if (!code) return [];
  const now = Date.now();
  const cached = espnLeagueTeamsCache.get(code);
  if (cached && now < cached.expiresAt) return cached.teams;
  const json = await fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/teams`, 6000, "https://www.espn.com/");
  const teams = (json?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team).filter(Boolean);
  if (teams.length > 0) {
    espnLeagueTeamsCache.set(code, { teams, expiresAt: now + 6 * 3600000 });
  }
  return teams;
}

async function fetchEspnTeamRecentStats(code, teamName) {
  const cacheKey = `${code || "global"}::${normTeamKey(teamName)}`;
  const now = Date.now();
  const cached = espnTeamStatsCache.get(cacheKey);
  if (cached && now < cached.expiresAt) return cached.stats;
  if (!code) return null;

  const teams = await getEspnLeagueTeams(code);
  const qNorm = normTeamKey(teamName);
  const found = teams.find((t) => {
    const dNorm = normTeamKey(t.displayName);
    const sNorm = normTeamKey(t.shortDisplayName);
    return dNorm === qNorm || sNorm === qNorm || dNorm.includes(qNorm) || qNorm.includes(dNorm) || (sNorm.length >= 4 && qNorm.includes(sNorm));
  });
  if (!found) return null;

  const sch = await fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/teams/${found.id}/schedule`, 6000, "https://www.espn.com/");
  const past = (sch?.events || []).filter((e) => e.competitions?.[0]?.status?.type?.completed).slice(-5);
  if (past.length === 0) return null;

  const sums = await Promise.all(
    past.map((ev) => fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/summary?event=${ev.id}`, 5500, "https://www.espn.com/"))
  );

  const rows = [];
  for (let idx = 0; idx < past.length; idx++) {
    const sum = sums[idx];
    const bx = sum?.boxscore?.teams || [];
    const myBx = bx.find((b) => String(b.team?.id) === String(found.id));
    const opBx = bx.find((b) => String(b.team?.id) !== String(found.id));
    if (!myBx || !opBx) continue;

    const getVal = (teamBx, key) => {
      const s = (teamBx.statistics || []).find((x) => x.name === key);
      const n = s ? parseFloat(s.displayValue) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    const comp = past[idx].competitions?.[0];
    const oppScoreObj = (comp?.competitors || []).find((c) => String(c.id) !== String(found.id));
    const opGoals = oppScoreObj ? parseFloat(oppScoreObj.score?.value ?? oppScoreObj.score ?? 1) : 1;

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
    const explicitSaves = getVal(myBx, "saves");
    const savesEst = explicitSaves !== null ? explicitSaves : (sotAg !== null ? Math.max(0, sotAg - (Number.isFinite(opGoals) ? opGoals : 1)) : null);
    const missedFor = shotsFor !== null && sotFor !== null ? Math.max(0, shotsFor - sotFor) : null;
    const missedAg = shotsAg !== null && sotAg !== null ? Math.max(0, shotsAg - sotAg) : null;

    rows.push({
      sotFor, sotAg, shotsFor, shotsAg, missedFor, missedAg,
      offFor, offAg, ycFor, ycAg, foulsFor, foulsAg,
      possFor, passFor,
      passAccPct: (accPass !== null && passFor && passFor > 0) ? (accPass / passFor) * 100 : null,
      savesFor: savesEst
    });
  }

  if (rows.length === 0) return null;
  const avg = (k) => {
    const vals = rows.map((r) => r[k]).filter((v) => v !== null && Number.isFinite(v));
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
  };

  const stats = {
    source: "ESPN Last-5 Boxscores",
    mp: rows.length,
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
    savesFor: avg("savesFor")
  };

  espnTeamStatsCache.set(cacheKey, { stats, expiresAt: now + 3600000 });
  return stats;
}

function pickBestOuFromLines(candidates, category, g, logicSummary, mastermindFn) {
  const valid = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.line) || !Number.isFinite(c.lam) || c.lam <= 0) continue;
    const { pOver, pUnder } = probOverHalfLine(c.lam, c.line);

    if (Number.isFinite(c.oddOver) && c.oddOver > 1.08) {
      const evO = (pOver * c.oddOver) - 1;
      const fairO = Math.round((1 / pOver) * 100) / 100;
      if (pOver >= 0.56 && evO >= -0.02) {
        valid.push({ side: "OVER", marketLine: c.labelOver || `Over ${c.line}`, prob: pOver, fairOdds: fairO, bookieOdds: c.oddOver, ev: evO, lam: c.lam, targetTeam: c.targetTeam || g.homeTeamName, scope: c.scope || "Match Total" });
      }
    }
    if (Number.isFinite(c.oddUnder) && c.oddUnder > 1.08) {
      const evU = (pUnder * c.oddUnder) - 1;
      const fairU = Math.round((1 / pUnder) * 100) / 100;
      if (pUnder >= 0.56 && evU >= -0.02) {
        valid.push({ side: "UNDER", marketLine: c.labelUnder || `Under ${c.line}`, prob: pUnder, fairOdds: fairU, bookieOdds: c.oddUnder, ev: evU, lam: c.lam, targetTeam: c.targetTeam || g.homeTeamName, scope: c.scope || "Match Total" });
      }
    }
  }
  if (valid.length === 0) return null;

  valid.sort((a, b) => (b.ev * 1.4 + (b.prob - 0.55) * 0.6) - (a.ev * 1.4 + (a.prob - 0.55) * 0.6));
  const best = valid[0];
  const evPctNum = Math.round(best.ev * 10000) / 100;
  const probPctNum = Math.round(best.prob * 1000) / 10;

  return {
    id: `prop_${category}_${g.eventId}_${best.side}_${best.marketLine.replace(/[^a-z0-9]/gi, "_")}`,
    category,
    eventId: g.eventId,
    fixture: `${g.homeTeamName} vs ${g.awayTeamName}`,
    homeTeam: g.homeTeamName,
    awayTeam: g.awayTeamName,
    homeLogo: g.homeLogo || "",
    awayLogo: g.awayLogo || "",
    league: g.league || "Football",
    country: g.country || "International",
    flag: g.flag || canonicalizeLeagueAndCountry(g.league, g.country).flag || "🌍",
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
    fairOdds: best.fairOdds,
    bookmakerOdds: best.bookieOdds,
    expectedValue: Math.round(best.ev * 10000) / 10000,
    expectedValuePct: `${evPctNum >= 0 ? "+" : ""}${evPctNum.toFixed(2)}%`,
    isPositiveEv: best.ev > 0,
    qualityTier: best.ev >= 0.08 && best.prob >= 0.64 ? "ELITE" : (best.ev > 0 ? "VALUE" : "SOLID"),
    logicSummary,
    mastermind: mastermindFn ? mastermindFn(best) : null
  };
}

function buildGoalsPicksForGame(g, markets) {
  const hs = g.homeStats || {};
  const as = g.awayStats || {};
  const hGf = hs.gfAvg || 1.35;
  const aGf = as.gfAvg || 1.15;
  const hGa = hs.gaAvg || 1.15;
  const aGa = as.gaAvg || 1.25;
  const lamTotal = clamp(((hGf + aGa) * 0.5) + ((aGf + hGa) * 0.5), 1.45, 4.10);

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

  return pickBestOuFromLines(
    candidates,
    "GOALS",
    g,
    `Goal Expectancy λ=${lamTotal.toFixed(2)} (${g.homeTeamName} ${hGf} GF/${hGa} GA vs ${g.awayTeamName} ${aGf} GF/${aGa} GA)`,
    (b) => ({
      logic: `Poisson total goal rate λ = ${lamTotal.toFixed(2)} yields ${(b.prob * 100).toFixed(1)}% for ${b.marketLine}.`,
      decision: `${b.marketLine} @ ${b.bookieOdds.toFixed(2)} (Fair ${b.fairOdds.toFixed(2)})`
    })
  );
}

function buildStatPicksForGame(g, markets, hEspn, aEspn) {
  const out = [];
  const hasEspn = Boolean(hEspn && aEspn);
  const hs = g.homeStats || {};
  const as = g.awayStats || {};

  // Shared helper to parse O/U markets by id
  const collectOu = (marketId, scope, targetTeam, lamFn, prefix) => {
    const arr = [];
    for (const m of markets.filter((x) => String(x.id) === String(marketId))) {
      const line = parseLineNumber(m.specifier);
      if (!Number.isFinite(line)) continue;
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
  const goalPick = buildGoalsPicksForGame(g, markets);
  if (goalPick) out.push(goalPick);

  // 2. THROW-INS O/U (Modelled from ESPN Possession %, Pass Accuracy %, Total Passes & Fouls — direct play = more throw-ins!)
  if (markets.some((x) => String(x.id) === "900769" || String(x.id) === "900778" || String(x.id) === "900779")) {
    const hPoss = hEspn?.possFor ?? 50;
    const aPoss = aEspn?.possFor ?? 50;
    const hAcc = hEspn?.passAccPct ?? 82;
    const aAcc = aEspn?.passAccPct ?? 82;
    const avgPoss = (hPoss + aPoss) * 0.5;
    const avgAcc = (hAcc + aAcc) * 0.5;
    // Lower possession / lower pass accuracy / direct transitions create more out-of-play throw-ins (~30 to 42)
    const lamMatchThrows = clamp(36.0 + (50 - avgPoss) * 0.28 + (82 - avgAcc) * 0.45, 28.0, 44.0);
    const lamHomeThrows = clamp(lamMatchThrows * (0.50 + ((50 - hPoss) * 0.004)), 13.0, 23.0);
    const lamAwayThrows = clamp(lamMatchThrows - lamHomeThrows, 12.0, 22.0);

    const throwCands = [
      ...collectOu(900769, "Match Total Throw-Ins", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamMatchThrows, "Match Throw-Ins"),
      ...collectOu(900778, `${g.homeTeamName} Throw-Ins`, g.homeTeamName, () => lamHomeThrows, `${g.homeTeamName} Throw-Ins`),
      ...collectOu(900779, `${g.awayTeamName} Throw-Ins`, g.awayTeamName, () => lamAwayThrows, `${g.awayTeamName} Throw-Ins`)
    ];
    const tp = pickBestOuFromLines(
      throwCands,
      "THROW_INS",
      g,
      hasEspn
        ? `Tempo Model (${hPoss.toFixed(1)}% poss / ${hAcc.toFixed(0)}% pass acc vs ${aPoss.toFixed(1)}% / ${aAcc.toFixed(0)}%) -> Est. ${lamMatchThrows.toFixed(1)} Throw-ins`
        : `Directness Tempo Model -> Est. ${lamMatchThrows.toFixed(1)} Throw-ins`
    );
    if (tp) out.push(tp);
  }

  // 3. SHOTS ON TARGET O/U
  if (markets.some((x) => String(x.id) === "900393" || String(x.id) === "900546" || String(x.id) === "900547")) {
    const hSotF = hEspn?.sotFor ?? clamp((hs.gfAvg || 1.3) * 3.1, 2.2, 7.5);
    const hSotA = hEspn?.sotAg ?? clamp((hs.gaAvg || 1.2) * 3.1, 2.0, 6.8);
    const aSotF = aEspn?.sotFor ?? clamp((as.gfAvg || 1.1) * 3.1, 2.0, 7.0);
    const aSotA = aEspn?.sotAg ?? clamp((as.gaAvg || 1.3) * 3.1, 2.2, 7.2);

    const lamHomeSot = clamp((hSotF + aSotA) * 0.5, 1.8, 9.0);
    const lamAwaySot = clamp((aSotF + hSotA) * 0.5, 1.5, 8.2);
    const sotCands = [
      ...collectOu(900393, "Match Total Shots On Target", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeSot + lamAwaySot, "Match SOT"),
      ...collectOu(900546, `${g.homeTeamName} SOT`, g.homeTeamName, () => lamHomeSot, `${g.homeTeamName} SOT`),
      ...collectOu(900547, `${g.awayTeamName} SOT`, g.awayTeamName, () => lamAwaySot, `${g.awayTeamName} SOT`)
    ];
    const sp = pickBestOuFromLines(
      sotCands,
      "SHOTS_ON_TARGET",
      g,
      hasEspn
        ? `ESPN Verified SOT: ${g.homeTeamName} (${hSotF} For / ${hSotA} Ag) vs ${g.awayTeamName} (${aSotF} For / ${aSotA} Ag)`
        : `PPG Attack-Derived SOT: ${lamHomeSot.toFixed(1)} vs ${lamAwaySot.toFixed(1)}`
    );
    if (sp) out.push(sp);
  }

  // 4. OFFSIDES O/U
  if (markets.some((x) => String(x.id) === "900396" || String(x.id) === "900568" || String(x.id) === "900569")) {
    const hOffF = hEspn?.offFor ?? 1.7;
    const hOffA = hEspn?.offAg ?? 1.8;
    const aOffF = aEspn?.offFor ?? 1.7;
    const aOffA = aEspn?.offAg ?? 1.8;
    const lamHomeOff = clamp((hOffF + aOffA) * 0.5, 0.7, 4.8);
    const lamAwayOff = clamp((aOffF + hOffA) * 0.5, 0.7, 4.8);

    const offCands = [
      ...collectOu(900396, "Match Total Offsides", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeOff + lamAwayOff, "Match Offsides"),
      ...collectOu(900568, `${g.homeTeamName} Offsides`, g.homeTeamName, () => lamHomeOff, `${g.homeTeamName} Offsides`),
      ...collectOu(900569, `${g.awayTeamName} Offsides`, g.awayTeamName, () => lamAwayOff, `${g.awayTeamName} Offsides`)
    ];
    const op = pickBestOuFromLines(
      offCands,
      "OFFSIDE",
      g,
      hasEspn
        ? `ESPN Offside Trap: ${g.homeTeamName} (${hOffF} For / ${hOffA} Trap) vs ${g.awayTeamName} (${aOffF} For / ${aOffA} Trap)`
        : `Tactical Line Trap Model -> ${lamHomeOff.toFixed(1)} vs ${lamAwayOff.toFixed(1)} Offsides`
    );
    if (op) out.push(op);
  }

  // 5. BOOKINGS O/U (Team Totals [900304/5], Match [139], and Match Cards [800063])
  {
    const hYcF = hEspn?.ycFor ?? 1.8;
    const hYcA = hEspn?.ycAg ?? 1.8;
    const aYcF = aEspn?.ycFor ?? 1.9;
    const aYcA = aEspn?.ycAg ?? 1.7;
    const lamHomeYc = clamp((hYcF + aYcA) * 0.5, 0.7, 3.8);
    const lamAwayYc = clamp((aYcF + hYcA) * 0.5, 0.8, 3.8);

    const bookCands = [
      ...collectOu(139, "Match Total Bookings", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeYc + lamAwayYc, "Match Bookings"),
      ...collectOu(900304, `${g.homeTeamName} Bookings`, g.homeTeamName, () => lamHomeYc, `${g.homeTeamName} Bookings`),
      ...collectOu(900305, `${g.awayTeamName} Bookings`, g.awayTeamName, () => lamAwayYc, `${g.awayTeamName} Bookings`)
    ];

    // Also include Market [800063] "Match Cards" discrete thresholds (3+ = Over 2.5, 4+ = Over 3.5, 5+ = Over 4.5)
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
      hasEspn
        ? `ESPN Discipline: ${g.homeTeamName} (${hYcF} YC / ${hEspn.foulsFor || 11} Fouls) vs ${g.awayTeamName} (${aYcF} YC / ${aEspn.foulsFor || 11} Fouls)`
        : `Discipline Model -> ${(lamHomeYc + lamAwayYc).toFixed(1)} Total Cards`
    );
    if (bp) out.push(bp);
  }

  // 6. GOAL KICKS O/U (Physics: Off-Target Opponent Shots = totalShots - shotsOnTarget + base clearances over endline)
  if (markets.some((x) => String(x.id) === "900622" || String(x.id) === "900623" || String(x.id) === "900624")) {
    const hMissedFor = hEspn?.missedFor ?? clamp((hs.gfAvg || 1.3) * 5.2, 4.5, 13.0);
    const aMissedFor = aEspn?.missedFor ?? clamp((as.gfAvg || 1.1) * 5.2, 4.0, 12.5);
    const hMissedAg = hEspn?.missedAg ?? 7.5;
    const aMissedAg = aEspn?.missedAg ?? 8.2;
    // Home Goal Kicks happen when Away misses shots + passes over endline (~3.0 base per half-court match)
    const lamHomeGk = clamp(((aMissedFor + hMissedAg) * 0.5) * 0.68 + 2.4, 4.0, 13.5);
    const lamAwayGk = clamp(((hMissedFor + aMissedAg) * 0.5) * 0.68 + 2.4, 4.0, 14.5);

    const gkCands = [
      ...collectOu(900622, "Match Total Goal Kicks", `${g.homeTeamName} vs ${g.awayTeamName}`, () => lamHomeGk + lamAwayGk, "Match Goal Kicks"),
      ...collectOu(900623, `${g.homeTeamName} Goal Kicks`, g.homeTeamName, () => lamHomeGk, `${g.homeTeamName} Goal Kicks`),
      ...collectOu(900624, `${g.awayTeamName} Goal Kicks`, g.awayTeamName, () => lamAwayGk, `${g.awayTeamName} Goal Kicks`)
    ];
    const gkp = pickBestOuFromLines(
      gkCands,
      "GOAL_KICKS",
      g,
      hasEspn
        ? `Off-Target Volume: ${g.homeTeamName} misses ${hMissedFor} shots/g vs ${g.awayTeamName} misses ${aMissedFor} shots/g -> Est. ${(lamHomeGk + lamAwayGk).toFixed(1)} Goal Kicks`
        : `Shot-Variance Model -> Est. ${(lamHomeGk + lamAwayGk).toFixed(1)} Goal Kicks`
    );
    if (gkp) out.push(gkp);
  }

  // 7. SAVES O/U (Market [800297] Player/GK Saves threshold k+ === Over (k-0.5) Saves)
  {
    const hSotF = hEspn?.sotFor ?? clamp((hs.gfAvg || 1.3) * 3.1, 2.5, 7.5);
    const aSotF = aEspn?.sotFor ?? clamp((as.gfAvg || 1.1) * 3.1, 2.2, 7.0);
    const hSotA = hEspn?.sotAg ?? 4.2;
    const aSotA = aEspn?.sotAg ?? 4.5;
    const hSavesHist = hEspn?.savesFor ?? Math.max(1.8, hSotA - (hs.gaAvg || 1.2));
    const aSavesHist = aEspn?.savesFor ?? Math.max(1.8, aSotA - (as.gaAvg || 1.3));
    const lamHomeGkSaves = clamp((hSavesHist + Math.max(1.5, aSotF - (hs.gaAvg || 1.2))) * 0.5, 1.5, 6.2);
    const lamAwayGkSaves = clamp((aSavesHist + Math.max(1.5, hSotF - (as.gaAvg || 1.4))) * 0.5, 1.5, 6.5);

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
        const gkLam = isHomeGk ? lamHomeGkSaves : lamAwayGkSaves;
        saveCands.push({
          line: threshold - 0.5,
          lam: gkLam,
          oddOver: odd,
          oddUnder: null,
          labelOver: `${player} (${teamLabel}) Over ${threshold - 0.5} Saves (${threshold}+)`,
          scope: "Goalkeeper Saves Over",
          targetTeam: `${player} (${teamLabel})`
        });
      }
    }
    const svp = pickBestOuFromLines(
      saveCands,
      "SAVES",
      g,
      hasEspn
        ? `ESPN Saves vs Opponent SOT: Home GK ~${lamHomeGkSaves.toFixed(2)} saves/g · Away GK ~${lamAwayGkSaves.toFixed(2)} saves/g`
        : `Shots-on-Target Save Model: Home GK ~${lamHomeGkSaves.toFixed(2)} · Away GK ~${lamAwayGkSaves.toFixed(2)}`
    );
    if (svp) out.push(svp);
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

      // Prioritize major European & international fixtures where Football.com exposes deep O/U stat props
      const sorted = [...allFootball].sort((a, b) => {
        const aTop = detectEspnLeagueCode(a.league) ? 1 : 0;
        const bTop = detectEspnLeagueCode(b.league) ? 1 : 0;
        if (aTop !== bTop) return bTop - aTop;
        if (Boolean(a.hasVerifiedStats) !== Boolean(b.hasVerifiedStats)) return a.hasVerifiedStats ? -1 : 1;
        return (a.estimateStartTime || 0) - (b.estimateStartTime || 0);
      });

      const targets = sorted.slice(0, 18);
      const buckets = {
        GOALS: [],
        THROW_INS: [],
        SHOTS_ON_TARGET: [],
        OFFSIDE: [],
        BOOKINGS: [],
        GOAL_KICKS: [],
        SAVES: []
      };

      // Fetch markets & ESPN stats in bounded parallel batches
      const chunkSize = 6;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (g) => {
            const code = detectEspnLeagueCode(g.league);
            const [evJson, hEspn, aEspn] = await Promise.all([
              fetchJsonSafe(`https://www.football.com/api/gh/factsCenter/event?eventId=${encodeURIComponent(g.eventId)}&productId=3`, 7500),
              code ? fetchEspnTeamRecentStats(code, g.homeTeamName) : Promise.resolve(null),
              code ? fetchEspnTeamRecentStats(code, g.awayTeamName) : Promise.resolve(null)
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

      // Sort each category by +EV and true probability
      for (const k of Object.keys(buckets)) {
        buckets[k].sort((a, b) => (b.expectedValue * 1.4 + (b.trueProbability - 0.55) * 0.6) - (a.expectedValue * 1.4 + (a.trueProbability - 0.55) * 0.6));
      }

      const payload = {
        ok: true,
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
