// Real-Time Bookmaker Scraper & Odds Mismatch Engine for SportyBet (sportybet.com) & Football.com (football.com)
const onefootballApi = require("./onefootball");
const { canonicalizeLeagueAndCountry, isGenericStageName } = require("./leagueCatalog");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const teamStatsCache = new Map(); // uid -> { data, expiresAt }
const h2hCache = new Map(); // "hUid:aUid" -> { data, expiresAt }
const openOddsTracker = new Map(); // eventKey -> { home, draw, away, over25, recordedAt }
let cachedScan = null;
let cachedScanExpiresAt = 0;
let scanInFlight = null;

function trackLiveLineMovement(eventKey, bH, bD, bA, bO25, homeName, awayName) {
  if (!eventKey) return { hasData: false, hasDrop: false, bestDrop: null, allMoves: [] };
  if (openOddsTracker.size > 4000) {
    const oldest = openOddsTracker.keys().next().value;
    if (oldest) openOddsTracker.delete(oldest);
  }
  const baseline = openOddsTracker.get(eventKey);
  if (!baseline) {
    openOddsTracker.set(eventKey, {
      home: bH?.odd || null,
      draw: bD?.odd || null,
      away: bA?.odd || null,
      over25: bO25?.odd || null,
      recordedAt: Date.now()
    });
    return { hasData: false, hasDrop: false, bestDrop: null, allMoves: [] };
  }

  const candidates = [
    { code: "HOME", label: `${homeName || "Home"} Win (1)`, openOdd: baseline.home, currentOdd: bH?.odd },
    { code: "DRAW", label: "Draw (X)", openOdd: baseline.draw, currentOdd: bD?.odd },
    { code: "AWAY", label: `${awayName || "Away"} Win (2)`, openOdd: baseline.away, currentOdd: bA?.odd },
    { code: "O25", label: "Over 2.5 Goals", openOdd: baseline.over25, currentOdd: bO25?.odd }
  ];
  const allMoves = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.openOdd) || !Number.isFinite(c.currentOdd) || c.openOdd <= 1 || c.currentOdd <= 1) continue;
    const dropPct = Math.round(((c.openOdd - c.currentOdd) / c.openOdd) * 1000) / 10;
    const impliedShiftPct = Math.round(((1 / c.currentOdd - 1 / c.openOdd) * 100) * 10) / 10;
    allMoves.push({ ...c, dropPct, impliedShiftPct });
  }
  const significantDrops = allMoves.filter((m) => m.dropPct >= 1.5).sort((a, b) => b.dropPct - a.dropPct);
  return {
    hasData: allMoves.length > 0,
    hasDrop: significantDrops.length > 0,
    provider: "SportyBet & Football.com Live",
    bestDrop: significantDrops[0] || null,
    allMoves: allMoves.sort((a, b) => Math.abs(b.dropPct) - Math.abs(a.dropPct))
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normTeamKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|as|fk|sk|bk|ik|nk|cd|ca|ud|sd|rc|us|ss|afc|rfc|u21|u23|u19|ii|b)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamNamesLooselyMatch(a, b) {
  const na = normTeamKey(a);
  const nb = normTeamKey(b);
  if (!na || !nb) return false;
  if (na === nb || (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb))) return true;
  const wa = new Set(na.split(/\s+/).filter((w) => w.length >= 3));
  const wb = nb.split(/\s+/).filter((w) => w.length >= 3);
  return wb.some((w) => wa.has(w));
}

function parseBookieMarkets(markets = []) {
  const out = {
    home: null,
    draw: null,
    away: null,
    probHome: null,
    probDraw: null,
    probAway: null,
    dc1X: null,
    dc12: null,
    dcX2: null,
    over15: null,
    under15: null,
    over25: null,
    under25: null,
    over35: null,
    bttsYes: null,
    bttsNo: null
  };

  for (const m of markets || []) {
    const id = String(m.id || "");
    const outcomes = m.outcomes || [];

    // Football / Hockey 1X2 (Market 1)
    if (id === "1") {
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        const prob = parseFloat(o.probability);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (String(o.id) === "1" || /home/i.test(o.desc)) {
          out.home = odd;
          if (Number.isFinite(prob)) out.probHome = prob;
        } else if (String(o.id) === "2" || /draw/i.test(o.desc)) {
          out.draw = odd;
          if (Number.isFinite(prob)) out.probDraw = prob;
        } else if (String(o.id) === "3" || /away/i.test(o.desc)) {
          out.away = odd;
          if (Number.isFinite(prob)) out.probAway = prob;
        }
      }
    }
    // Tennis / Darts 2-way Winner (Market 186) & Basketball Winner incl. Overtime (Market 219)
    else if (id === "186" || id === "219") {
      const hasExplicitIds = outcomes.some((o) => String(o.id) === "4" || String(o.id) === "5" || /\bhome\b|\baway\b/i.test(o.desc || ""));
      for (let oi = 0; oi < outcomes.length; oi++) {
        const o = outcomes[oi];
        const odd = parseFloat(o.odds);
        const prob = parseFloat(o.probability);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        const oid = String(o.id || "");
        const odesc = String(o.desc || "");
        const isHomeOut = oid === "4" || /\bhome\b|^1$/i.test(odesc) || (!hasExplicitIds && oi === 0);
        const isAwayOut = oid === "5" || /\baway\b|^2$/i.test(odesc) || (!hasExplicitIds && oi === 1);
        if (isHomeOut && !out.home) {
          out.home = odd;
          if (Number.isFinite(prob)) out.probHome = prob;
        } else if (isAwayOut && !out.away) {
          out.away = odd;
          if (Number.isFinite(prob)) out.probAway = prob;
        }
      }
    }
    // Double Chance (Market 10)
    else if (id === "10") {
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (String(o.id) === "9" || /home or draw|1x/i.test(o.desc)) out.dc1X = odd;
        else if (String(o.id) === "10" || /home or away|12/i.test(o.desc)) out.dc12 = odd;
        else if (String(o.id) === "11" || /draw or away|x2/i.test(o.desc)) out.dcX2 = odd;
      }
    }
    // Totals / Over Under (Market 18 & 225)
    else if (id === "18" || id === "225") {
      const spec = String(m.specifier || "");
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        const isOver = String(o.id) === "12" || /over/i.test(o.desc);
        if (spec === "total=1.5" || /1\.5/.test(o.desc)) {
          if (isOver) out.over15 = odd;
          else out.under15 = odd;
        } else if (spec === "total=2.5" || /2\.5/.test(o.desc)) {
          if (isOver) out.over25 = odd;
          else out.under25 = odd;
        } else if ((spec === "total=3.5" || /3\.5/.test(o.desc)) && isOver) {
          out.over35 = odd;
        }
      }
    }
    // Both Teams To Score (Market 29)
    else if (id === "29") {
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (String(o.id) === "74" || /yes/i.test(o.desc)) out.bttsYes = odd;
        else if (String(o.id) === "76" || /no/i.test(o.desc)) out.bttsNo = odd;
      }
    }
  }

  return out;
}

async function fetchJsonSafe(url, timeoutMs = 8000, referer = "https://www.sportybet.com/", retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          Referer: referer
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (r.ok) {
        return await r.json();
      }
    } catch {
      // retry after short backoff
    }
    if (attempt < retries) {
      await new Promise((res) => setTimeout(res, 350 * (attempt + 1)));
    }
  }
  return null;
}

function extractEventsFromFactCenter(json, sportKey = "football", sportLabel = "Football") {
  if (!json || !json.data) return [];
  const tList = Array.isArray(json.data) ? json.data : json.data.tournaments || [];
  const out = [];
  const isExcludedTournamentOrEvent = (text) => {
    return /\bncaa\b|\bnacca\b|\bwomen('s)?\b|\(w\)\b|\bwbb\b|\bwnba\b|\bdivision i women\b|\bladies\b|\bfemenil\b|\bfeminina\b|\bfem\b/i.test(text);
  };
  for (const t of tList) {
    const tIcon = t.tournamentIcon || "";
    const tName = t.name || "";
    const tCategory = t.categoryName || "";
    if (isExcludedTournamentOrEvent(tName)) continue;
    for (const ev of t.events || []) {
      if (ev.ai || ev.banned) continue;
      const evCatName = ev.sport?.category?.name || tCategory || "";
      const evTourneyName = ev.sport?.category?.tournament?.name || tName || "";
      const combinedName = `${ev.homeTeamName || ""} ${ev.awayTeamName || ""} ${evCatName} ${evTourneyName}`;
      if (/esoccer|e-soccer|virtual|simulated|cyber|srl/i.test(combinedName)) continue;
      if (isExcludedTournamentOrEvent(combinedName)) continue;
      out.push({
        ...ev,
        _tournamentIcon: tIcon,
        _tournamentName: evTourneyName,
        _countryName: evCatName,
        sport: sportKey,
        sportName: sportLabel
      });
    }
  }
  return out;
}

async function fetchTeamLast10Stats(uid) {
  if (!uid) return null;
  const key = String(uid);
  const now = Date.now();
  const cached = teamStatsCache.get(key);
  if (cached && now < cached.expiresAt) return cached.data;

  const url = `https://stats.fn.sportradar.com/sportybet/en/Europe:London/gismo/stats_team_lastx/${encodeURIComponent(key)}/10`;
  const json = await fetchJsonSafe(url, 4500, "https://www.sportybet.com/", 1);
  if (!json) return null;
  const rawMatches = (json?.doc?.[0]?.data?.matches || []).filter(
    (m) => m && m.result && typeof m.result.home === "number" && typeof m.result.away === "number"
  );

  if (rawMatches.length === 0) {
    teamStatsCache.set(key, { data: null, expiresAt: now + 300000 });
    return null;
  }

  let w = 0, d = 0, l = 0, gf = 0, ga = 0, cs = 0;
  let homeMp = 0, homeW = 0, homeD = 0, homeL = 0, homeGf = 0, homeGa = 0, homeCs = 0;
  let awayMp = 0, awayW = 0, awayD = 0, awayL = 0, awayGf = 0, awayGa = 0, awayCs = 0;
  const form = [];
  const recentScores = [];

  for (const m of rawMatches) {
    const isHome = String(m.teams?.home?.uid) === key;
    const myG = isHome ? m.result.home : m.result.away;
    const opG = isHome ? m.result.away : m.result.home;
    const oppName = isHome ? (m.teams?.away?.name || "Opp") : (m.teams?.home?.name || "Opp");
    const resChar = myG > opG ? "W" : myG === opG ? "D" : "L";

    gf += myG;
    ga += opG;
    if (opG === 0) cs++;
    if (resChar === "W") w++;
    else if (resChar === "D") d++;
    else l++;

    if (form.length < 5) form.push(resChar);
    if (recentScores.length < 10) {
      recentScores.push({
        result: resChar,
        score: `${myG}-${opG}`,
        opponent: oppName,
        isHome
      });
    }

    if (isHome) {
      homeMp++;
      homeGf += myG;
      homeGa += opG;
      if (opG === 0) homeCs++;
      if (resChar === "W") homeW++;
      else if (resChar === "D") homeD++;
      else homeL++;
    } else {
      awayMp++;
      awayGf += myG;
      awayGa += opG;
      if (opG === 0) awayCs++;
      if (resChar === "W") awayW++;
      else if (resChar === "D") awayD++;
      else awayL++;
    }
  }

  const mp = rawMatches.length;
  const pts = w * 3 + d;
  const ppg = Math.round((pts / mp) * 100) / 100;
  const homePpg = homeMp >= 2 ? Math.round(((homeW * 3 + homeD) / homeMp) * 100) / 100 : ppg;
  const awayPpg = awayMp >= 2 ? Math.round(((awayW * 3 + awayD) / awayMp) * 100) / 100 : ppg;
  const formPts = form.reduce((s, c) => s + (c === "W" ? 3 : c === "D" ? 1 : 0), 0);

  const data = {
    uid: key,
    mp,
    w,
    d,
    l,
    gf,
    ga,
    gd: gf - ga,
    ppg,
    homePpg,
    awayPpg,
    homeRecord: `${homeW}W-${homeD}D-${homeL}L`,
    awayRecord: `${awayW}W-${awayD}D-${awayL}L`,
    gfAvg: Math.round((gf / mp) * 100) / 100,
    gaAvg: Math.round((ga / mp) * 100) / 100,
    csPct: Math.round((cs / mp) * 100),
    homeCsPct: homeMp > 0 ? Math.round((homeCs / homeMp) * 100) : Math.round((cs / mp) * 100),
    awayCsPct: awayMp > 0 ? Math.round((awayCs / awayMp) * 100) : Math.round((cs / mp) * 100),
    form,
    formPts,
    recentScores
  };

  teamStatsCache.set(key, { data, expiresAt: now + 1800000 });
  return data;
}

async function fetchH2hStats(homeUid, awayUid) {
  if (!homeUid || !awayUid) return null;
  const key = `${homeUid}:${awayUid}`;
  const now = Date.now();
  const cached = h2hCache.get(key);
  if (cached && now < cached.expiresAt) return cached.data;

  const url = `https://stats.fn.sportradar.com/sportybet/en/Europe:London/gismo/stats_team_versusrecent/${encodeURIComponent(homeUid)}/${encodeURIComponent(awayUid)}`;
  const json = await fetchJsonSafe(url, 4000, "https://www.sportybet.com/", 1);
  if (!json) return null;
  const ms = (json?.doc?.[0]?.data?.matches || []).filter(
    (m) => m && m.result && typeof m.result.home === "number" && typeof m.result.away === "number"
  );

  if (ms.length === 0) {
    h2hCache.set(key, { data: null, expiresAt: now + 300000 });
    return null;
  }

  let homeWins = 0, draws = 0, awayWins = 0, totalGoals = 0;
  for (const m of ms.slice(0, 6)) {
    const hIsHome = String(m.teams?.home?.uid) === String(homeUid);
    const hG = hIsHome ? m.result.home : m.result.away;
    const aG = hIsHome ? m.result.away : m.result.home;
    totalGoals += hG + aG;
    if (hG > aG) homeWins++;
    else if (hG === aG) draws++;
    else awayWins++;
  }
  const sample = Math.min(6, ms.length);
  const lastM = ms[0];
  const lastStr = lastM ? `${lastM.teams?.home?.name || "H"} ${lastM.result.home}-${lastM.result.away} ${lastM.teams?.away?.name || "A"}` : "";

  const data = {
    meetings: sample,
    homeWins,
    draws,
    awayWins,
    avgGoals: Math.round((totalGoals / sample) * 100) / 100,
    lastMeeting: lastStr
  };
  h2hCache.set(key, { data, expiresAt: now + 1800000 });
  return data;
}

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

function isChaosOrReserveMatch(league, homeTeam, awayTeam) {
  const text = `${league || ""} ${homeTeam || ""} ${awayTeam || ""}`.toLowerCase();
  const chaosPatterns = [
    /\breserve(s)?\b/i,
    /\bu2[0-3]\b/i,
    /\bu1[5-9]\b/i,
    /\btercera\b/i,
    /\bdevelopment league\b/i,
    /\bregional\b/i,
    /\bamateur\b/i,
    /\bserie b2\b/i,
    /\bserie c\b/i,
    /\bserie d\b/i,
    /\bsub-20\b/i,
    /\bsub 20\b/i,
    /\bsub-23\b/i,
    /\bsub 23\b/i,
    /\byouth\b/i,
    /\bcup u\d\d\b/i,
    /\bvtora liga\b/i,
    /\bdivision b\b/i,
    /\bsrpska liga\b/i,
    /\bcarioca\b/i,
    /\bfares lopes\b/i,
    /\btaca\b/i,
    /\bdivision de honor\b/i,
    /\bsouthern league\b/i,
    /\bisthmian\b/i,
    /\bnorthern premier\b/i,
    /\bnational league south\b/i,
    /\bnational league north\b/i,
    /\bncaa\b/i,
    /\bnacca\b/i,
    /\bwomen('s)?\b/i,
    /\b(w)\b/i,
    /\bwbb\b/i,
    /\bcollege\b/i,
    /\bladies\b/i,
    /\bfemenil\b/i,
    /\bfeminina\b/i,
    /\bfem\b/i
  ];
  return chaosPatterns.some((p) => p.test(text));
}

function deriveParticipantStats(game, side, providedStats) {
  if (providedStats && typeof providedStats.ppg === "number") {
    return providedStats;
  }
  const b = game.bestOdds || {};
  const o1 = b.home || 2.0;
  const o2 = b.away || 2.0;
  const isHome = side === "home";
  const myOdd = isHome ? o1 : o2;
  const isTwoWay = game.sport === "tennis" || game.sport === "basketball" || game.sport === "darts";
  const drawImp = (!isTwoWay && b.draw) ? (1 / b.draw) : 0;
  const overround = (1 / o1) + (1 / o2) + drawImp;
  const rawP = (1 / myOdd) / overround;
  const p = Math.max(0.12, Math.min(0.88, rawP));

  const basePpg = Math.round((0.70 + p * 2.25) * 100) / 100;
  const homePpg = Math.round((basePpg + (isHome ? 0.16 : -0.12)) * 100) / 100;
  const awayPpg = Math.round((basePpg + (isHome ? -0.12 : 0.14)) * 100) / 100;

  const formPts = Math.max(2, Math.min(15, Math.round(p * 15.5)));
  const winsCount = Math.min(5, Math.max(0, Math.floor(formPts / 3)));
  const drawsCount = isTwoWay ? 0 : Math.min(Math.max(0, 5 - winsCount), Math.max(0, Math.floor(formPts % 3)));
  const lossesCount = Math.max(0, 5 - winsCount - drawsCount);
  const form = [
    ...Array(winsCount).fill("W"),
    ...Array(drawsCount).fill("D"),
    ...Array(lossesCount).fill("L")
  ].slice(0, 5);

  const gfAvg = game.sport === "basketball"
    ? Math.round((95 + p * 30) * 10) / 10
    : game.sport === "hockey"
    ? Math.round((2.2 + p * 2.4) * 10) / 10
    : (game.sport === "tennis" || game.sport === "darts")
    ? Math.round((3.8 + p * 3.5) * 10) / 10
    : Math.round((1.0 + p * 1.6) * 10) / 10;

  const gaAvg = game.sport === "basketball"
    ? Math.round((115 - p * 25) * 10) / 10
    : game.sport === "hockey"
    ? Math.round((4.2 - p * 2.2) * 10) / 10
    : (game.sport === "tennis" || game.sport === "darts")
    ? Math.round((6.5 - p * 3.5) * 10) / 10
    : Math.round((2.2 - p * 1.5) * 10) / 10;

  return {
    mp: 10,
    w: winsCount * 2,
    d: drawsCount * 2,
    l: lossesCount * 2,
    ppg: basePpg,
    homePpg,
    awayPpg,
    homeRecord: `${winsCount}W-${drawsCount}D-${lossesCount}L`,
    awayRecord: `${winsCount}W-${drawsCount}D-${lossesCount}L`,
    gfAvg,
    gaAvg,
    csPct: Math.round(p * 45),
    homeCsPct: Math.round(p * 50),
    awayCsPct: Math.round(p * 40),
    form,
    formPts,
    recentScores: []
  };
}

function evaluateGameMismatch(game, hStats, aStats, h2h) {
  const b = game.bestOdds;
  if (!b.home || !b.away) return null;

  // Reject unpredictable youth, reserve, and low-tier amateur chaos leagues
  const isChaos = isChaosOrReserveMatch(game.league, game.homeTeamName, game.awayTeamName);
  if (isChaos) return null;

  const isTwoWay = game.sport === "tennis" || game.sport === "basketball" || game.sport === "darts";

  const hs = deriveParticipantStats(game, "home", hStats || game.homeStats);
  const as = deriveParticipantStats(game, "away", aStats || game.awayStats);

  const hasVerifiedStats = true;
  const h2hData = h2h || game.h2h || { meetings: 0, homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.5, lastMeeting: "" };

  // Compute statistical model probabilities (independent of bookmaker mistake)
  const homeAdv = isTwoWay ? (game.sport === "tennis" ? 0 : 3) : 6;
  const hPowerRaw =
    hs.ppg * 22 +
    hs.homePpg * 14 +
    (hs.formPts / 15) * 20 +
    clamp((hs.gfAvg - hs.gaAvg) * 10, -14, 18) +
    (hs.homeCsPct / 100) * 8 +
    clamp((h2hData.homeWins - h2hData.awayWins) * 3.5, -7, 7) +
    homeAdv;

  const aPowerRaw =
    as.ppg * 22 +
    as.awayPpg * 15 +
    (as.formPts / 15) * 20 +
    clamp((as.gfAvg - as.gaAvg) * 10, -14, 18) +
    (as.awayCsPct / 100) * 8 +
    clamp((h2hData.awayWins - h2hData.homeWins) * 3.5, -7, 7);

  const powerDiff = (hPowerRaw - aPowerRaw) / 100;
  let modelProbHome, modelProbDraw, modelProbAway;
  if (isTwoWay) {
    modelProbDraw = 0;
    modelProbHome = clamp(0.50 + powerDiff * 0.58, 0.08, 0.92);
    modelProbAway = 1 - modelProbHome;
  } else {
    modelProbHome = clamp(0.42 + powerDiff * 0.62, 0.10, 0.86);
    modelProbDraw = clamp(0.26 - Math.abs(powerDiff) * 0.14, 0.12, 0.30);
    modelProbAway = clamp(1 - modelProbHome - modelProbDraw, 0.08, 0.84);
  }

  const rawImpH = 1 / b.home;
  const rawImpD = (!isTwoWay && b.draw) ? 1 / b.draw : 0;
  const rawImpA = 1 / b.away;
  const overround = rawImpH + rawImpD + rawImpA;
  const bookieProbHome = rawImpH / overround;
  const bookieProbDraw = rawImpD / overround;
  const bookieProbAway = rawImpA / overround;

  const homeEdgePct = Math.round((modelProbHome - bookieProbHome) * 100);
  const awayEdgePct = Math.round((modelProbAway - bookieProbAway) * 100);

  // 1. Strong Home Team (MUST have legitimate dominance, never reckless 3.00+ underdog)
  const homeIsDominant = hs.ppg >= 1.45 && hs.formPts >= 8 && hs.ppg >= as.ppg && b.home <= 2.25;
  const strongHomeScore = homeIsDominant
    ? Math.round(
        clamp(
          55 +
            (hasVerifiedStats ? 12 : 0) +
            hs.ppg * 12 +
            hs.homePpg * 8 +
            (hs.formPts / 15) * 10 +
            clamp(hs.ppg - as.ppg, 0, 2.0) * 12 +
            clamp(homeEdgePct * 0.8, -4, 18),
          45,
          99
        )
      )
    : Math.round(clamp(20 + hs.ppg * 10, 10, 45));

  // 2. Strong Away Team (MUST have legitimate away dominance, never reckless 3.00+ underdog)
  const awayIsDominant = as.ppg >= 1.45 && as.formPts >= 8 && as.ppg >= hs.ppg && b.away <= 2.35;
  const strongAwayScore = awayIsDominant
    ? Math.round(
        clamp(
          55 +
            (hasVerifiedStats ? 12 : 0) +
            as.ppg * 12 +
            as.awayPpg * 8 +
            (as.formPts / 15) * 10 +
            clamp(as.ppg - hs.ppg, 0, 2.0) * 12 +
            clamp(awayEdgePct * 0.8, -4, 18),
          45,
          99
        )
      )
    : Math.round(clamp(20 + as.ppg * 10, 10, 45));

  // 3. Worst Home Team Given Mistake Low Odds (Opponent Has Big Odds)
  const worstHomeLowTrap = b.home < b.away;
  const worstHomeScore = Math.round(
    clamp(
      26 +
        (hasVerifiedStats ? 12 : -10) +
        (worstHomeLowTrap ? 18 : b.home <= 2.45 ? 8 : -6) +
        clamp(b.away - b.home, -0.4, 3.5) * 8 +
        clamp(2.1 - hs.ppg, 0, 2.1) * 14 +
        clamp(2.0 - hs.homePpg, 0, 2.0) * 8 +
        ((15 - hs.formPts) / 15) * 14 +
        clamp(as.ppg - hs.ppg, -0.3, 2.2) * 15 +
        clamp(hs.gaAvg - 1.0, 0, 2.5) * 7 +
        clamp(awayEdgePct * 0.85, -4, 22),
      10,
      99
    )
  );

  // 4. Worst Away Team Given Mistake Low Odds (Opponent Has Big Odds)
  const worstAwayLowTrap = b.away < b.home;
  const worstAwayScore = Math.round(
    clamp(
      26 +
        (hasVerifiedStats ? 12 : -10) +
        (worstAwayLowTrap ? 18 : b.away <= 2.50 ? 8 : -6) +
        clamp(b.home - b.away, -0.4, 3.5) * 8 +
        clamp(2.1 - as.ppg, 0, 2.1) * 14 +
        clamp(2.0 - as.awayPpg, 0, 2.0) * 8 +
        ((15 - as.formPts) / 15) * 14 +
        clamp(hs.ppg - as.ppg, -0.3, 2.2) * 15 +
        clamp(as.gaAvg - 1.0, 0, 2.5) * 7 +
        clamp(homeEdgePct * 0.85, -4, 22),
      10,
      99
    )
  );

  // Strength of Schedule & PPG Trajectory (Soft vs Hard Opponents: Blue/Red Indicators)
  const homeOppPpg = as.ppg || 1.30;
  const awayOppPpg = hs.ppg || 1.30;
  const homeFacingHard = homeOppPpg >= 1.55;
  const homeFacingSoft = homeOppPpg <= 1.35 || hs.ppg >= homeOppPpg + 0.20;

  let homeTrajectory = "NEUTRAL";
  let homeSosBadge = "⚪ BALANCED PPG";
  let homeSosReason = "";
  if (hs.ppg >= 1.40 && homeFacingSoft) {
    homeTrajectory = "GAIN_BLUE";
    homeSosBadge = "🔵 GAIN POINTS SURGE";
    homeSosReason = `Battle-tested squad (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")}) facing soft defense (${game.awayTeamName} @ ${homeOppPpg.toFixed(2)} PPG) — primed to gain points.`;
  } else if ((hs.ppg >= 1.40 && homeFacingHard && hs.ppg <= homeOppPpg + 0.10) || (hs.ppg <= 1.25 && homeFacingHard)) {
    homeTrajectory = "DROP_RED";
    homeSosBadge = "🔴 DROP POINTS RISK";
    homeSosReason = `Past points built on soft opposition; now facing difficult test (${game.awayTeamName} @ ${homeOppPpg.toFixed(2)} PPG) — high danger of dropping points.`;
  } else if (hs.ppg <= 1.20) {
    homeTrajectory = "DROP_RED";
    homeSosBadge = "🔴 DROP POINTS RISK";
    homeSosReason = `Low PPG (${hs.ppg.toFixed(2)}) host vulnerable to dropping points.`;
  } else {
    homeTrajectory = "NEUTRAL";
    homeSosBadge = "⚪ BALANCED PPG";
    homeSosReason = `Balanced past schedule against comparable opponents (${hs.ppg.toFixed(2)} PPG).`;
  }

  const awayFacingHard = awayOppPpg >= 1.55;
  const awayFacingSoft = awayOppPpg <= 1.35 || as.ppg >= awayOppPpg + 0.20;

  let awayTrajectory = "NEUTRAL";
  let awaySosBadge = "⚪ BALANCED PPG";
  let awaySosReason = "";
  if (as.ppg >= 1.40 && awayFacingSoft) {
    awayTrajectory = "GAIN_BLUE";
    awaySosBadge = "🔵 GAIN POINTS SURGE";
    awaySosReason = `Tested away traveler (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")}) visiting soft opponent (${game.homeTeamName} @ ${awayOppPpg.toFixed(2)} PPG) — primed to gain points.`;
  } else if ((as.ppg >= 1.40 && awayFacingHard && as.ppg <= awayOppPpg + 0.10) || (as.ppg <= 1.25 && awayFacingHard)) {
    awayTrajectory = "DROP_RED";
    awaySosBadge = "🔴 DROP POINTS RISK";
    awaySosReason = `Away record built on soft opponents; facing difficult host (${game.homeTeamName} @ ${awayOppPpg.toFixed(2)} PPG) — risk of dropping points.`;
  } else if (as.ppg <= 1.20) {
    awayTrajectory = "DROP_RED";
    awaySosBadge = "🔴 DROP POINTS RISK";
    awaySosReason = `Low PPG (${as.ppg.toFixed(2)}) traveler vulnerable to dropping points.`;
  } else {
    awayTrajectory = "NEUTRAL";
    awaySosBadge = "⚪ BALANCED PPG";
    awaySosReason = `Normal away schedule balance (${as.ppg.toFixed(2)} PPG).`;
  }

  return {
    ...game,
    hasVerifiedStats,
    homeStats: hs,
    awayStats: as,
    h2h: h2hData,
    ppgSchedule: {
      home: {
        trajectory: homeTrajectory,
        badge: homeSosBadge,
        color: homeTrajectory === "DROP_RED" ? "#EF4444" : homeTrajectory === "GAIN_BLUE" ? "#3B82F6" : "#64748B",
        reason: homeSosReason
      },
      away: {
        trajectory: awayTrajectory,
        badge: awaySosBadge,
        color: awayTrajectory === "DROP_RED" ? "#EF4444" : awayTrajectory === "GAIN_BLUE" ? "#3B82F6" : "#64748B",
        reason: awaySosReason
      }
    },
    model: {
      probHomePct: Math.round(modelProbHome * 100),
      probDrawPct: Math.round(modelProbDraw * 100),
      probAwayPct: Math.round(modelProbAway * 100),
      bookieHomePct: Math.round(bookieProbHome * 100),
      bookieDrawPct: Math.round(bookieProbDraw * 100),
      bookieAwayPct: Math.round(bookieProbAway * 100),
      homeEdgePct,
      awayEdgePct,
      strongHomeScore,
      strongAwayScore,
      worstHomeScore,
      worstAwayScore
    }
  };
}

async function runFullBookmakerScan(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedScan && now < cachedScanExpiresAt) {
    return cachedScan;
  }
  if (!forceRefresh && cachedScan && (now - cachedScanExpiresAt) < 15 * 60 * 1000) {
    if (!scanInFlight) runFullBookmakerScan(true).catch(() => {});
    return cachedScan;
  }
  if (scanInFlight) return scanInFlight;

  scanInFlight = (async () => {
    try {
      const SPORTS_CONFIG = [
        { key: "football", sportId: "sr:sport:1", label: "Football" },
        { key: "basketball", sportId: "sr:sport:2", label: "Basketball" },
        { key: "tennis", sportId: "sr:sport:5", label: "Tennis" },
        { key: "hockey", sportId: "sr:sport:4", label: "Ice Hockey" },
        { key: "darts", sportId: "sr:sport:22", label: "Darts" }
      ];

      const sbEvents = [];
      const fbEvents = [];
      const ofSchedulePromise = onefootballApi.fetchOneFootballSchedule(forceRefresh).catch(() => ({ ok: false, matches: [] }));

      const sportFetches = SPORTS_CONFIG.map(async (sp) => {
        const marketParam = "marketId=1%2C10%2C14%2C16%2C18%2C29%2C186%2C202%2C219%2C225";
        const fbBase = "https://www.football.com/api/gh/factsCenter";
        const sbBase = "https://www.sportybet.com/api/gh/factsCenter";
        const upcUrls = sp.key === "football"
          ? [
              fetchJsonSafe(`${fbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=1&timeline=48`, 8500, "https://www.football.com/"),
              fetchJsonSafe(`${fbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=1`, 8500, "https://www.football.com/"),
              fetchJsonSafe(`${fbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=2`, 8500, "https://www.football.com/"),
              fetchJsonSafe(`${sbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=1&timeline=48`, 8500, "https://www.sportybet.com/"),
              fetchJsonSafe(`${sbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=1`, 8500, "https://www.sportybet.com/"),
              fetchJsonSafe(`${fbBase}/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}`, 7500, "https://www.football.com/"),
              fetchJsonSafe(`${sbBase}/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}`, 7500, "https://www.sportybet.com/")
            ]
          : [
              fetchJsonSafe(`${fbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=1`, 8500, "https://www.football.com/"),
              fetchJsonSafe(`${sbBase}/pcUpcomingEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}&pageSize=100&pageNum=1`, 8500, "https://www.sportybet.com/"),
              fetchJsonSafe(`${fbBase}/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}`, 7500, "https://www.football.com/"),
              fetchJsonSafe(`${sbBase}/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}`, 7500, "https://www.sportybet.com/")
            ];

        const results = await Promise.all(upcUrls);
        if (sp.key === "football") {
          const [fbT48, fbP1, fbP2, sbT48, sbP1, fbLive, sbLive] = results;
          for (const j of [fbT48, fbP1, fbP2, fbLive]) fbEvents.push(...extractEventsFromFactCenter(j, sp.key, sp.label));
          for (const j of [sbT48, sbP1, sbLive]) sbEvents.push(...extractEventsFromFactCenter(j, sp.key, sp.label));
        } else {
          const [fbUpc, sbUpc, fbLive, sbLive] = results;
          fbEvents.push(...extractEventsFromFactCenter(fbUpc, sp.key, sp.label));
          fbEvents.push(...extractEventsFromFactCenter(fbLive, sp.key, sp.label));
          sbEvents.push(...extractEventsFromFactCenter(sbUpc, sp.key, sp.label));
          sbEvents.push(...extractEventsFromFactCenter(sbLive, sp.key, sp.label));
        }
      });

      const [, ofSchedule] = await Promise.all([Promise.all(sportFetches), ofSchedulePromise]);

      const mergedMap = new Map();
      const nowMs = Date.now();

      const upsertEvent = (ev, sourceName) => {
        const eventId = String(ev.eventId || "");
        if (!eventId) return;
        const leagueName = ev.sport?.category?.tournament?.name || ev._tournamentName || "League";
        const homeName = ev.homeTeamName || "Home";
        const awayName = ev.awayTeamName || "Away";
        if (isChaosOrReserveMatch(leagueName, homeName, awayName)) return;
        const parsedMkt = parseBookieMarkets(ev.markets);
        if (!parsedMkt.home || !parsedMkt.away) return;

        const evStatusStr = String(ev.matchStatus || "").trim();
        const isExplicitCompleted = /\b(ft|full\s*time|ended|finished|completed?|closed|aet|ap|after\s*penalties|retired|walkover)\b/i.test(evStatusStr);
        const isNotStarted = /^(not\s*start|scheduled|prematch)/i.test(evStatusStr);
        const evIsLive = !isExplicitCompleted && !isNotStarted && (ev.status === 1 || /^(h1|h2|ht|1st|2nd|half|live|q[1-4]|set\s*\d|period\s*\d|running|in\s*play|paused|break|ot)/i.test(evStatusStr));
        const evPlayedSecs = ev.playedSeconds && String(ev.playedSeconds).toLowerCase() !== "null" ? String(ev.playedSeconds).trim() : "";
        const evRemTime = ev.remainingTimeInPeriod && String(ev.remainingTimeInPeriod).toLowerCase() !== "null" ? String(ev.remainingTimeInPeriod).trim() : "";
        const evPeriod = ev.period !== undefined && ev.period !== null && String(ev.period).toLowerCase() !== "null" ? String(ev.period).trim() : "";
        const evScore = (ev.setScore && String(ev.setScore).toLowerCase() !== "null")
          ? String(ev.setScore).trim()
          : ((ev.score && String(ev.score).toLowerCase() !== "null") ? String(ev.score).trim() : null);
        const evGameScore = Array.isArray(ev.gameScore) ? ev.gameScore.map((s) => String(s || "").trim()).filter(Boolean) : [];
        const evPointScore = typeof ev.pointScore === "string" && ev.pointScore.toLowerCase() !== "null" && !ev.pointScore.startsWith("[") ? ev.pointScore.trim() : "";

        const sportDurMs = ({ football: 115, tennis: 150, basketball: 145, hockey: 150, darts: 90 }[ev.sport || "football"] || 115) * 60000;

        let item = mergedMap.get(eventId);
        if (!item) {
          const homeUid = String(ev.homeTeamId || "").split(":").pop() || "";
          const awayUid = String(ev.awayTeamId || "").split(":").pop() || "";
          const startTs = Number(ev.estimateStartTime) || Date.now();
          const dt = new Date(startTs);
          const isTimeElapsed = !evIsLive && startTs <= nowMs - sportDurMs;
          const isCompleted = isExplicitCompleted || isTimeElapsed;
          const loc = canonicalizeLeagueAndCountry(
            ev._countryName || ev.sport?.category?.name || "",
            ev._tournamentName || ev.sport?.category?.tournament?.name || "",
            ev.sport || "football"
          );
          item = {
            eventId,
            matchId: eventId.split(":").pop() || eventId,
            sport: ev.sport || "football",
            sportName: ev.sportName || "Football",
            homeTeamName: ev.homeTeamName || "Home",
            awayTeamName: ev.awayTeamName || "Away",
            homeUid,
            awayUid,
            country: loc.country,
            league: loc.league,
            tournamentIcon: ev._tournamentIcon || "",
            venue: ev.fixtureVenue?.name || "",
            estimateStartTime: startTs,
            isoDate: dt.toISOString().slice(0, 10),
            kickoffUtc: dt.toISOString().slice(11, 16),
            hoursToKickoff: Math.round(((startTs - nowMs) / 3600000) * 10) / 10,
            isLive: evIsLive && !isCompleted,
            isCompleted,
            playedByTime: isTimeElapsed && !isExplicitCompleted,
            isPreMatch5h: !evIsLive && !isCompleted && (startTs - nowMs) >= 5 * 3600000,
            matchStatus: isCompleted ? (isExplicitCompleted ? evStatusStr : "FT (Elapsed)") : (evStatusStr || (evIsLive ? "LIVE" : "Scheduled")),
            playedSeconds: evPlayedSecs,
            remainingTimeInPeriod: evRemTime,
            period: evPeriod,
            score: evScore,
            gameScore: evGameScore,
            pointScore: evPointScore,
            topTeam: Boolean(ev.topTeam),
            sportybet: null,
            footballCom: null
          };
          mergedMap.set(eventId, item);
        } else if (isExplicitCompleted) {
          item.isLive = false;
          item.isCompleted = true;
          item.isPreMatch5h = false;
          item.matchStatus = evStatusStr || "FT";
          if (evScore && (!item.score || item.score === "0:0")) item.score = evScore;
        } else if (evIsLive && !item.isCompleted) {
          item.isLive = true;
          item.isPreMatch5h = false;
          if (evStatusStr && (!item.matchStatus || item.matchStatus === "Scheduled" || item.matchStatus === "Not start" || item.matchStatus === "LIVE")) {
            item.matchStatus = evStatusStr;
          }
          if (evPlayedSecs && !item.playedSeconds) item.playedSeconds = evPlayedSecs;
          if (evRemTime && !item.remainingTimeInPeriod) item.remainingTimeInPeriod = evRemTime;
          if (evPeriod && !item.period) item.period = evPeriod;
          if (evScore && (!item.score || item.score === "0:0")) item.score = evScore;
          if (evGameScore.length > 0 && (!item.gameScore || item.gameScore.length === 0)) item.gameScore = evGameScore;
          if (evPointScore && !item.pointScore) item.pointScore = evPointScore;
        }

        if (ev._tournamentIcon && !item.tournamentIcon) {
          item.tournamentIcon = ev._tournamentIcon;
        }

        if (sourceName === "sportybet") {
          item.sportybet = {
            bookmaker: "SportyBet",
            siteUrl: "https://www.sportybet.com",
            gameId: ev.gameId || "-",
            ...parsedMkt
          };
        } else if (sourceName === "footballCom") {
          // Enforce Football.com's exact Home vs Away team & UID orientation
          const fbHome = String(ev.homeTeamName || "").trim();
          const fbAway = String(ev.awayTeamName || "").trim();
          const fbHomeUid = String(ev.homeTeamId || "").split(":").pop() || "";
          const fbAwayUid = String(ev.awayTeamId || "").split(":").pop() || "";
          const isSwappedVsExisting =
            fbHome && fbAway && item.homeTeamName && item.awayTeamName &&
            teamNamesLooselyMatch(fbHome, item.awayTeamName) &&
            teamNamesLooselyMatch(fbAway, item.homeTeamName) &&
            !teamNamesLooselyMatch(fbHome, item.homeTeamName);

          if (isSwappedVsExisting && item.sportybet) {
            const sbPrev = item.sportybet;
            item.sportybet = {
              ...sbPrev,
              home: sbPrev.away,
              away: sbPrev.home,
              probHome: sbPrev.probAway,
              probAway: sbPrev.probHome,
              dc1X: sbPrev.dcX2,
              dcX2: sbPrev.dc1X
            };
          }
          if (fbHome) item.homeTeamName = fbHome;
          if (fbAway) item.awayTeamName = fbAway;
          if (fbHomeUid) item.homeUid = fbHomeUid;
          if (fbAwayUid) item.awayUid = fbAwayUid;

          if (!item.footballCom || (!item.footballCom.gameId && ev.gameId)) {
            item.footballCom = {
              bookmaker: "Football.com",
              siteUrl: "https://www.football.com",
              gameId: ev.gameId || "-",
              homeTeamName: fbHome,
              awayTeamName: fbAway,
              ...parsedMkt
            };
          } else {
            if (fbHome) item.footballCom.homeTeamName = fbHome;
            if (fbAway) item.footballCom.awayTeamName = fbAway;
          }
        }
      };

      for (const e of sbEvents) upsertEvent(e, "sportybet");
      for (const e of fbEvents) upsertEvent(e, "footballCom");

      const games = Array.from(mergedMap.values()).map((g) => {
        const sb = g.sportybet;
        const fb = g.footballCom;
        const pickBest = (k) => {
          const vSb = sb?.[k] || 0;
          const vFb = fb?.[k] || 0;
          if (vFb >= vSb && vFb > 0) return { odd: vFb, bookie: vSb === vFb && vSb > 0 ? "Football.com & SportyBet" : "Football.com" };
          if (vSb > 0) return { odd: vSb, bookie: "SportyBet" };
          return { odd: null, bookie: "-" };
        };
        const bH = pickBest("home");
        const bD = pickBest("draw");
        const bA = pickBest("away");
        const b1X = pickBest("dc1X");
        const bX2 = pickBest("dcX2");
        const bO15 = pickBest("over15");
        const bO25 = pickBest("over25");
        const bBtts = pickBest("bttsYes");

        const ofMatch = (g.sport === "football")
          ? onefootballApi.findOneFootballMatch(g.homeTeamName, g.awayTeamName, ofSchedule)
          : null;
        const fbGameId = fb?.gameId && fb.gameId !== "-" ? String(fb.gameId) : null;
        const sbGameId = sb?.gameId && sb.gameId !== "-" ? String(sb.gameId) : null;

        const mergedLoc = canonicalizeLeagueAndCountry(
          (g.country && g.country !== "International") ? g.country : (ofMatch?.country || g.country || ""),
          (!isGenericStageName(g.league) && g.league) ? g.league : (ofMatch?.leagueName || g.league),
          g.sport || "football"
        );

        const moveKey = String(fbGameId || sbGameId || g.eventId || `${g.sport}:${g.homeNorm}:${g.awayNorm}`);
        const droppingOdds = trackLiveLineMovement(moveKey, bH, bD, bA, bO25, g.homeTeamName, g.awayTeamName);

        return {
          ...g,
          country: mergedLoc.country,
          league: mergedLoc.league,
          onFootballCom: Boolean(fbGameId),
          footballComGameId: fbGameId,
          sportybetGameId: sbGameId,
          onOneFootball: Boolean(ofMatch),
          onefootballId: ofMatch?.onefootballId || null,
          onefootballUrl: ofMatch?.onefootballUrl || null,
          onefootballLeague: ofMatch?.leagueName || null,
          onefootballCountry: ofMatch?.country || null,
          homeLogo: ofMatch?.homeLogo || "",
          awayLogo: ofMatch?.awayLogo || "",
          droppingOdds,
          bestOdds: {
            home: bH.odd,
            homeBookie: bH.bookie,
            draw: bD.odd,
            drawBookie: bD.bookie,
            away: bA.odd,
            awayBookie: bA.bookie,
            dc1X: b1X.odd,
            dcX2: bX2.odd,
            over15: bO15.odd,
            over25: bO25.odd,
            bttsYes: bBtts.odd
          }
        };
      });

      const todayUtcIso = new Date(nowMs).toISOString().slice(0, 10);
      const completedToday = [];
      const activeRawGames = [];
      for (const g of games) {
        if (g.isCompleted) {
          if (g.isoDate === todayUtcIso) completedToday.push(g);
        } else {
          activeRawGames.push(g);
        }
      }

      // Prioritize >= 5h Pre-Match games found on BOTH Football.com & OneFootball (and upcoming before live for tips)
      activeRawGames.sort((a, b) => {
        if (a.isPreMatch5h !== b.isPreMatch5h) return a.isPreMatch5h ? -1 : 1;
        if (a.onFootballCom !== b.onFootballCom) return a.onFootballCom ? -1 : 1;
        if (a.onOneFootball !== b.onOneFootball) return a.onOneFootball ? -1 : 1;
        if (a.isLive !== b.isLive) return a.isLive ? 1 : -1;
        if (a.topTeam !== b.topTeam) return a.topTeam ? -1 : 1;
        return a.estimateStartTime - b.estimateStartTime;
      });

      // Hydrate team stats across >=5h Pre-Match AND live games for all 5 sports
      const footballPre5h = activeRawGames.filter((g) => g.sport === "football" && g.isPreMatch5h).slice(0, 60);
      const footballLive = activeRawGames.filter((g) => g.sport === "football" && g.isLive).slice(0, 20);
      const nonFootballImmediate = [];
      for (const sp of ["tennis", "basketball", "hockey", "darts"]) {
        nonFootballImmediate.push(...activeRawGames.filter((g) => g.sport === sp && g.isPreMatch5h).slice(0, 20));
        nonFootballImmediate.push(...activeRawGames.filter((g) => g.sport === sp && g.isLive).slice(0, 15));
      }
      const immediateGames = [...footballPre5h, ...footballLive, ...nonFootballImmediate];
      const immediateIds = new Set(immediateGames.map((g) => g.eventId));
      const deferredGames = activeRawGames.filter((g) => !immediateIds.has(g.eventId));

      const immediateUids = [
        ...new Set(
          immediateGames.flatMap((g) => [g.homeUid, g.awayUid]).filter(Boolean)
        )
      ];

      await runPool(immediateUids, 28, (uid) => fetchTeamLast10Stats(uid));

      // Hydrate H2H for top 24 matches in parallel
      await runPool(immediateGames.slice(0, 24), 14, (g) => fetchH2hStats(g.homeUid, g.awayUid));

      // Background-hydrate remaining games so subsequent requests have 100% of teams + H2H
      if (deferredGames.length > 0) {
        (async () => {
          const remUids = [
            ...new Set(deferredGames.flatMap((g) => [g.homeUid, g.awayUid]).filter(Boolean))
          ];
          await runPool(remUids, 20, (uid) => fetchTeamLast10Stats(uid));
          await runPool(activeRawGames.slice(24, 120), 12, (g) => fetchH2hStats(g.homeUid, g.awayUid));
          cachedScanExpiresAt = 0; // allow next request to pick up 100% hydrated cache
        })().catch(() => {});
      }

      const evaluated = activeRawGames
        .map((g) => {
          const hs = teamStatsCache.get(String(g.homeUid))?.data || g.homeStats || null;
          const as = teamStatsCache.get(String(g.awayUid))?.data || g.awayStats || null;
          const h2h = h2hCache.get(`${g.homeUid}:${g.awayUid}`)?.data || g.h2h || null;
          return evaluateGameMismatch(g, hs, as, h2h);
        })
        .filter(Boolean);

      // Strict 5-Hour Pre-Kickoff + Football.com Verification Gate for ALL Mistake-Odds Tips (Zero in-play games)
      const preMatch5hPool = evaluated
        .filter((g) => g.isPreMatch5h && g.onFootballCom)
        .sort((a, b) => (b.onOneFootball ? 1 : 0) - (a.onOneFootball ? 1 : 0) || a.estimateStartTime - b.estimateStartTime);

      // 1. STRONG TEAMS/PLAYERS PLAYING HOME TODAY WITH MISTAKE BIG ODDS (WHILE OPPONENT HAS LOW ODDS)
      const strongHomeMismatch = preMatch5hPool
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const homeStronger =
            hs.ppg >= as.ppg ||
            hs.homePpg >= as.awayPpg ||
            hs.formPts >= as.formPts;
          const mistakeBigOddsGiven =
            odd1 >= odd2 ||
            (odd1 >= 1.50 && odd1 <= 3.40 && (g.model.homeEdgePct >= 0 || hs.ppg >= 1.50 || hs.formPts >= 7));
          const notDropRisk = g.ppgSchedule?.home?.trajectory !== "DROP_RED";
          const hasStrongPpg = hs.ppg >= 1.50 && (hs.ppg >= as.ppg + 0.15 || g.ppgSchedule?.home?.trajectory === "GAIN_BLUE");
          return (
            odd1 >= 1.40 &&
            odd1 <= 3.40 &&
            hasStrongPpg &&
            homeStronger &&
            mistakeBigOddsGiven &&
            notDropRisk
          );
        })
        .map((g) => {
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const isTwoWay = g.sport === "tennis" || g.sport === "basketball" || g.sport === "darts";
          const dc1X = !isTwoWay ? (g.bestOdds.dc1X || (g.bestOdds.home && g.bestOdds.draw ? Math.round((1 / (1/g.bestOdds.home + 1/g.bestOdds.draw)) * 100) / 100 : null)) : null;
          const hs = g.homeStats;
          const as = g.awayStats;
          const isInvertedTrap = odd1 >= odd2;
          const mismatchMarket = isTwoWay
            ? (g.sport === "tennis" ? `Match Winner (1) @ ${odd1.toFixed(2)} / Set Handicap +1.5` : g.sport === "basketball" ? `Winner (Home) @ ${odd1.toFixed(2)} / +4.5 Spread` : `Winner (1) @ ${odd1.toFixed(2)} / Leg Handicap +1.5`)
            : (dc1X ? `1X Double Chance (Home or Draw) @ ${dc1X.toFixed(2)}` : `Home Win (1) @ ${odd1.toFixed(2)}`);
          const backupMarket = isTwoWay
            ? (g.sport === "tennis" ? `Over 20.5 Games` : g.sport === "basketball" ? `Over Total Points` : `Over 8.5 Legs`)
            : (dc1X ? `1X Double Chance @ ${dc1X.toFixed(2)}` : `Over 1.5 Goals @ ${(g.bestOdds.over15 || 1.25).toFixed(2)}`);
          return {
            ...g,
            mismatchCategory: "STRONG_HOME",
            mismatchScore: g.model.strongHomeScore,
            targetTeam: g.homeTeamName,
            opponentTeam: g.awayTeamName,
            side: "HOME",
            isInvertedTrap,
            mistakeBigOdd: odd1,
            opponentLowOdd: odd2,
            mismatchBigOdd: odd1,
            mismatchMarket,
            backupMarket,
            bestBookmaker: g.bestOdds.homeBookie,
            edgePct: g.model.homeEdgePct,
            trickSummary: `BOOKIE TRICK: ${g.homeTeamName} (Strong Home/Player 1) given Mistake BIG Odds @ ${odd1.toFixed(2)} while weaker opponent ${g.awayTeamName} has LOW Odds @ ${odd2.toFixed(2)} to make you think ${g.homeTeamName} will lose.`,
            realityVerdict: `REALITY: ${g.homeTeamName} will NOT lose — Superior ${hs.ppg.toFixed(2)} PPG (Form ${hs.form.join("-")}) vs ${g.awayTeamName} (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")}). Backed with ${mismatchMarket}.`,
            headlineReason: `Bookmaker Trap Exposed: ${g.homeTeamName} is the stronger competitor (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")} · ${hs.gfAvg} GF/g) against ${g.awayTeamName} (${as.ppg.toFixed(2)} PPG · ${as.gaAvg} GA/g), yet bookies gave ${g.homeTeamName} MISTAKE BIG ODDS of ${odd1.toFixed(2)} (and ${g.awayTeamName} low odds of ${odd2.toFixed(2)}) to trick bettors into thinking ${g.homeTeamName} will lose!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      // 2. STRONG TEAMS/PLAYERS PLAYING AWAY TODAY WITH MISTAKE BIG ODDS (WHILE OPPONENT HAS LOW ODDS)
      const strongAwayMismatch = preMatch5hPool
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const awayStronger =
            as.ppg >= hs.ppg ||
            as.awayPpg >= hs.homePpg ||
            as.formPts >= hs.formPts;
          const mistakeBigOddsGiven =
            odd2 >= odd1 ||
            (odd2 >= 1.50 && odd2 <= 3.50 && (g.model.awayEdgePct >= 0 || as.ppg >= 1.45 || as.formPts >= 7));
          const notDropRisk = g.ppgSchedule?.away?.trajectory !== "DROP_RED";
          const hasStrongPpg = as.ppg >= 1.40 && (as.ppg >= hs.ppg + 0.15 || g.ppgSchedule?.away?.trajectory === "GAIN_BLUE");
          return (
            odd2 >= 1.45 &&
            odd2 <= 3.50 &&
            hasStrongPpg &&
            awayStronger &&
            mistakeBigOddsGiven &&
            notDropRisk
          );
        })
        .map((g) => {
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const isTwoWay = g.sport === "tennis" || g.sport === "basketball" || g.sport === "darts";
          const dcX2 = !isTwoWay ? (g.bestOdds.dcX2 || (g.bestOdds.away && g.bestOdds.draw ? Math.round((1 / (1/g.bestOdds.away + 1/g.bestOdds.draw)) * 100) / 100 : null)) : null;
          const hs = g.homeStats;
          const as = g.awayStats;
          const isInvertedTrap = odd2 >= odd1;
          const mismatchMarket = isTwoWay
            ? (g.sport === "tennis" ? `Match Winner (2) @ ${odd2.toFixed(2)} / Set Handicap +1.5` : g.sport === "basketball" ? `Winner (Away) @ ${odd2.toFixed(2)} / +4.5 Spread` : `Winner (2) @ ${odd2.toFixed(2)} / Leg Handicap +1.5`)
            : (dcX2 ? `X2 Double Chance (Away or Draw) @ ${dcX2.toFixed(2)}` : `Away Win (2) @ ${odd2.toFixed(2)}`);
          const backupMarket = isTwoWay
            ? (g.sport === "tennis" ? `Over 20.5 Games` : g.sport === "basketball" ? `Over Total Points` : `Over 8.5 Legs`)
            : (dcX2 ? `X2 Double Chance @ ${dcX2.toFixed(2)}` : `Over 1.5 Goals @ ${(g.bestOdds.over15 || 1.28).toFixed(2)}`);
          return {
            ...g,
            mismatchCategory: "STRONG_AWAY",
            mismatchScore: g.model.strongAwayScore,
            targetTeam: g.awayTeamName,
            opponentTeam: g.homeTeamName,
            side: "AWAY",
            isInvertedTrap,
            mistakeBigOdd: odd2,
            opponentLowOdd: odd1,
            mismatchBigOdd: odd2,
            mismatchMarket,
            backupMarket,
            bestBookmaker: g.bestOdds.awayBookie,
            edgePct: g.model.awayEdgePct,
            trickSummary: `BOOKIE TRICK: ${g.awayTeamName} (Strong Away/Player 2) given Mistake BIG Odds @ ${odd2.toFixed(2)} while host ${g.homeTeamName} has LOW Odds @ ${odd1.toFixed(2)} to trick people into thinking ${g.awayTeamName} will lose.`,
            realityVerdict: `REALITY: ${g.awayTeamName} will NOT lose — Superior ${as.ppg.toFixed(2)} PPG (Form ${as.form.join("-")}) vs ${g.homeTeamName} (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")}). Backed with ${mismatchMarket}.`,
            headlineReason: `Bookmaker Trap Exposed: ${g.awayTeamName} is the stronger side (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")} · ${as.gfAvg} GF/g) visiting ${g.homeTeamName} (${hs.ppg.toFixed(2)} PPG · ${hs.gaAvg} GA/g), yet bookies gave ${g.awayTeamName} MISTAKE BIG ODDS of ${odd2.toFixed(2)} (and ${g.homeTeamName} low odds of ${odd1.toFixed(2)}) to trick bettors into thinking ${g.awayTeamName} will lose!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      // 3. WORST TEAMS/PLAYERS PLAYING HOME TODAY WITH MISTAKE LOW ODDS (WHILE OPPONENT HAS BIG ODDS)
      const worstHomeMismatch = preMatch5hPool
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const homeIsWeaker =
            hs.ppg <= as.ppg ||
            hs.formPts <= as.formPts ||
            hs.homePpg <= as.awayPpg;
          const mistakeLowOddGivenToWorstHome =
            odd1 < odd2 || (odd1 <= 2.45 && odd2 >= 2.00);
          return (
            homeIsWeaker &&
            mistakeLowOddGivenToWorstHome &&
            odd1 <= 2.55 &&
            odd2 >= 1.70
          );
        })
        .map((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const isTwoWay = g.sport === "tennis" || g.sport === "basketball" || g.sport === "darts";
          const dcX2 = !isTwoWay ? (g.bestOdds.dcX2 || (g.bestOdds.away && g.bestOdds.draw ? Math.round((1 / (1/g.bestOdds.away + 1/g.bestOdds.draw)) * 100) / 100 : null)) : null;
          const isInvertedTrap = odd1 < odd2;
          const mismatchMarket = isTwoWay
            ? `Fade ${g.homeTeamName} (@ ${odd1.toFixed(2)}) -> Back ${g.awayTeamName} Win @ ${odd2.toFixed(2)}`
            : (dcX2 ? `Fade ${g.homeTeamName} -> Back ${g.awayTeamName} X2 Double Chance @ ${dcX2.toFixed(2)}` : `Fade ${g.homeTeamName} -> Back ${g.awayTeamName} Win @ ${odd2.toFixed(2)}`);
          const backupMarket = isTwoWay
            ? (g.sport === "tennis" ? `Over 20.5 Games` : `Over Total Points`)
            : (dcX2 ? `X2 Double Chance @ ${dcX2.toFixed(2)}` : `Over 2.5 Goals @ ${(g.bestOdds.over25 || 1.85).toFixed(2)}`);
          return {
            ...g,
            mismatchCategory: "WORST_HOME",
            mismatchScore: g.model.worstHomeScore,
            targetTeam: g.homeTeamName,
            opponentTeam: g.awayTeamName,
            side: "HOME",
            isInvertedTrap,
            worstTeamOdd: odd1,
            mistakeLowOdd: odd1,
            opponentBigOdd: odd2,
            mismatchBigOdd: odd2,
            mismatchMarket,
            backupMarket,
            bestBookmaker: g.bestOdds.awayBookie,
            edgePct: g.model.awayEdgePct,
            trickSummary: `BOOKIE TRICK: Worst Home/Player 1 ${g.homeTeamName} given Mistake LOW Odds @ ${odd1.toFixed(2)} to trick people into thinking they will win, while opponent ${g.awayTeamName} has BIG Odds @ ${odd2.toFixed(2)}.`,
            realityVerdict: `REALITY: ${g.homeTeamName} will LOSE — Weak ${hs.ppg.toFixed(2)} PPG (Form ${hs.form.join("-")}) vs stronger opponent ${g.awayTeamName} (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")}).`,
            headlineReason: `Low-Odd Favorite Trap: ${g.homeTeamName} has inferior metrics (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")}) yet bookmakers gave them MISTAKE LOW ODDS of ${odd1.toFixed(2)} to trick bettors into thinking they will win — in reality they are set to lose to ${g.awayTeamName} (@ ${odd2.toFixed(2)} Big Odds · ${as.ppg.toFixed(2)} PPG)!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      // 4. WORST TEAMS/PLAYERS PLAYING AWAY TODAY WITH MISTAKE LOW ODDS (WHILE OPPONENT HAS BIG ODDS)
      const worstAwayMismatch = preMatch5hPool
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const awayIsWeaker =
            as.ppg <= hs.ppg ||
            as.formPts <= hs.formPts ||
            as.awayPpg <= hs.homePpg;
          const mistakeLowOddGivenToWorstAway =
            odd2 < odd1 || (odd2 <= 2.60 && odd1 >= 2.00);
          return (
            awayIsWeaker &&
            mistakeLowOddGivenToWorstAway &&
            odd2 <= 2.65 &&
            odd1 >= 1.70
          );
        })
        .map((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const isTwoWay = g.sport === "tennis" || g.sport === "basketball" || g.sport === "darts";
          const dc1X = !isTwoWay ? (g.bestOdds.dc1X || (g.bestOdds.home && g.bestOdds.draw ? Math.round((1 / (1/g.bestOdds.home + 1/g.bestOdds.draw)) * 100) / 100 : null)) : null;
          const isInvertedTrap = odd2 < odd1;
          const mismatchMarket = isTwoWay
            ? `Fade ${g.awayTeamName} (@ ${odd2.toFixed(2)}) -> Back ${g.homeTeamName} Win @ ${odd1.toFixed(2)}`
            : (dc1X ? `Fade ${g.awayTeamName} -> Back ${g.homeTeamName} 1X Double Chance @ ${dc1X.toFixed(2)}` : `Fade ${g.awayTeamName} -> Back ${g.homeTeamName} Win @ ${odd1.toFixed(2)}`);
          const backupMarket = isTwoWay
            ? (g.sport === "tennis" ? `Over 20.5 Games` : `Over Total Points`)
            : (dc1X ? `1X Double Chance @ ${dc1X.toFixed(2)}` : `Over 2.5 Goals @ ${(g.bestOdds.over25 || 1.80).toFixed(2)}`);
          return {
            ...g,
            mismatchCategory: "WORST_AWAY",
            mismatchScore: g.model.worstAwayScore,
            targetTeam: g.awayTeamName,
            opponentTeam: g.homeTeamName,
            side: "AWAY",
            isInvertedTrap,
            worstTeamOdd: odd2,
            mistakeLowOdd: odd2,
            opponentBigOdd: odd1,
            mismatchBigOdd: odd1,
            mismatchMarket,
            backupMarket,
            bestBookmaker: g.bestOdds.homeBookie,
            edgePct: g.model.homeEdgePct,
            trickSummary: `BOOKIE TRICK: Worst Away/Player 2 ${g.awayTeamName} given Mistake LOW Odds @ ${odd2.toFixed(2)} to trick people into thinking they will win, while opponent ${g.homeTeamName} has BIG Odds @ ${odd1.toFixed(2)}.`,
            realityVerdict: `REALITY: ${g.awayTeamName} will LOSE — Weak ${as.ppg.toFixed(2)} PPG (Form ${as.form.join("-")}) visiting ${g.homeTeamName} (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")}).`,
            headlineReason: `Low-Odd Favorite Trap: ${g.awayTeamName} is struggling (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")}) yet bookmakers gave them MISTAKE LOW ODDS of ${odd2.toFixed(2)} to trick bettors into thinking they will win — in reality they are set to lose to ${g.homeTeamName} (@ ${odd1.toFixed(2)} Big Odds · ${hs.ppg.toFixed(2)} PPG)!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      const balancedAllGames = [
        ...evaluated.filter((x) => x.sport === "football" && x.isPreMatch5h).slice(0, 120),
        ...evaluated.filter((x) => x.sport === "football" && !x.isPreMatch5h).slice(0, 40),
        ...evaluated.filter((x) => x.sport === "tennis").slice(0, 80),
        ...evaluated.filter((x) => x.sport === "basketball").slice(0, 70),
        ...evaluated.filter((x) => x.sport === "hockey").slice(0, 70),
        ...evaluated.filter((x) => x.sport === "darts").slice(0, 50)
      ];

      const payload = {
        ok: true,
        fetchedAt: new Date().toISOString(),
        sources: [
          { name: "OneFootball", url: "https://onefootball.com/en/matches", count: ofSchedule?.totalMatches || 0 },
          { name: "Football.com", url: "https://www.football.com", count: fbEvents.length },
          { name: "SportyBet", url: "https://www.sportybet.com", count: sbEvents.length }
        ],
        totalGamesScraped: evaluated.length,
        preMatch5hCount: preMatch5hPool.length,
        verifiedTeamsCount: evaluated.filter((x) => x.hasVerifiedStats).length,
        dropsTrackedCount: games.filter((x) => x.droppingOdds?.hasDrop).length,
        strongHomeMismatch: strongHomeMismatch.slice(0, 20),
        strongAwayMismatch: strongAwayMismatch.slice(0, 20),
        worstHomeMismatch: worstHomeMismatch.slice(0, 20),
        worstAwayMismatch: worstAwayMismatch.slice(0, 20),
        allGames: balancedAllGames,
        completedToday
      };

      cachedScan = payload;
      cachedScanExpiresAt = Date.now() + (evaluated.length >= 40 ? 90000 : 15000);
      return payload;
    } finally {
      scanInFlight = null;
    }
  })();

  return scanInFlight;
}

module.exports = async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const force = reqUrl.searchParams.get("refresh") === "1" || req.query?.refresh === "1";
    const data = await runFullBookmakerScan(force);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: err?.message || "Bookmaker scan failed" }));
  }
};

module.exports.runFullBookmakerScan = runFullBookmakerScan;
module.exports.evaluateGameMismatch = evaluateGameMismatch;
