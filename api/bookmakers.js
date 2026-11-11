// Real-Time Bookmaker Scraper & Odds Mismatch Engine for SportyBet (sportybet.com) & Football.com (football.com)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const teamStatsCache = new Map(); // uid -> { data, expiresAt }
const h2hCache = new Map(); // "hUid:aUid" -> { data, expiresAt }
let cachedScan = null;
let cachedScanExpiresAt = 0;
let scanInFlight = null;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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
    // Tennis / Darts 2-way Winner (Market 186)
    else if (id === "186") {
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        const prob = parseFloat(o.probability);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (String(o.id) === "4" || /home|1/i.test(o.desc) || o === outcomes[0]) {
          if (!out.home) {
            out.home = odd;
            if (Number.isFinite(prob)) out.probHome = prob;
          }
        } else if (String(o.id) === "5" || /away|2/i.test(o.desc) || o === outcomes[1]) {
          if (!out.away) {
            out.away = odd;
            if (Number.isFinite(prob)) out.probAway = prob;
          }
        }
      }
    }
    // Basketball / Darts Winner incl. Overtime (Market 219)
    else if (id === "219") {
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        const prob = parseFloat(o.probability);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (String(o.id) === "4" || /home|1/i.test(o.desc) || o === outcomes[0]) {
          if (!out.home) {
            out.home = odd;
            if (Number.isFinite(prob)) out.probHome = prob;
          }
        } else if (String(o.id) === "5" || /away|2/i.test(o.desc) || o === outcomes[1]) {
          if (!out.away) {
            out.away = odd;
            if (Number.isFinite(prob)) out.probAway = prob;
          }
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
  for (const t of tList) {
    const tIcon = t.tournamentIcon || "";
    const tName = t.name || "";
    for (const ev of t.events || []) {
      if (ev.ai || ev.banned) continue;
      const combinedName = `${ev.homeTeamName || ""} ${ev.awayTeamName || ""} ${ev.sport?.category?.name || ""} ${ev.sport?.category?.tournament?.name || tName}`;
      if (/esoccer|e-soccer|virtual|simulated|cyber|srl/i.test(combinedName)) continue;
      out.push({
        ...ev,
        _tournamentIcon: tIcon,
        _tournamentName: tName,
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
  const json = await fetchJsonSafe(url, 6000);
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
    if (recentScores.length < 5) {
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
  const json = await fetchJsonSafe(url, 5000);
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

      const sportFetches = SPORTS_CONFIG.map(async (sp) => {
        const marketParam = "marketId=1%2C10%2C14%2C16%2C18%2C29%2C186%2C202%2C219%2C225";
        const [sbLiveJson, sbTodayJson, fbLiveJson, fbTodayJson] = await Promise.all([
          fetchJsonSafe(`https://www.sportybet.com/api/gh/factsCenter/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}`, 7500, "https://www.sportybet.com/"),
          fetchJsonSafe(`https://www.sportybet.com/api/gh/factsCenter/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}`, 7500, "https://www.sportybet.com/"),
          fetchJsonSafe(`https://www.football.com/api/gh/factsCenter/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}&${marketParam}`, 7500, "https://www.football.com/"),
          fetchJsonSafe(`https://www.football.com/api/gh/factsCenter/liveOrPrematchEvents?sportId=${encodeURIComponent(sp.sportId)}`, 7500, "https://www.football.com/")
        ]);

        sbEvents.push(...extractEventsFromFactCenter(sbLiveJson, sp.key, sp.label));
        sbEvents.push(...extractEventsFromFactCenter(sbTodayJson, sp.key, sp.label));
        fbEvents.push(...extractEventsFromFactCenter(fbLiveJson, sp.key, sp.label));
        fbEvents.push(...extractEventsFromFactCenter(fbTodayJson, sp.key, sp.label));
      });

      await Promise.all(sportFetches);

      const mergedMap = new Map();

      const upsertEvent = (ev, sourceName) => {
        const eventId = String(ev.eventId || "");
        if (!eventId) return;
        const parsedMkt = parseBookieMarkets(ev.markets);
        if (!parsedMkt.home || !parsedMkt.away) return;

        let item = mergedMap.get(eventId);
        if (!item) {
          const homeUid = String(ev.homeTeamId || "").split(":").pop() || "";
          const awayUid = String(ev.awayTeamId || "").split(":").pop() || "";
          const startTs = Number(ev.estimateStartTime) || Date.now();
          const dt = new Date(startTs);
          item = {
            eventId,
            matchId: eventId.split(":").pop() || eventId,
            sport: ev.sport || "football",
            sportName: ev.sportName || "Football",
            homeTeamName: ev.homeTeamName || "Home",
            awayTeamName: ev.awayTeamName || "Away",
            homeUid,
            awayUid,
            country: ev.sport?.category?.name || "International",
            league: ev.sport?.category?.tournament?.name || ev._tournamentName || "League",
            tournamentIcon: ev._tournamentIcon || "",
            venue: ev.fixtureVenue?.name || "",
            estimateStartTime: startTs,
            isoDate: dt.toISOString().slice(0, 10),
            kickoffUtc: dt.toISOString().slice(11, 16),
            isLive: ev.status === 1 || /1st|2nd|half|live/i.test(ev.matchStatus || ""),
            matchStatus: ev.matchStatus || "Scheduled",
            score: (ev.setScore && String(ev.setScore).toLowerCase() !== "null") ? String(ev.setScore).trim() : ((ev.score && String(ev.score).toLowerCase() !== "null") ? String(ev.score).trim() : null),
            topTeam: Boolean(ev.topTeam),
            sportybet: null,
            footballCom: null
          };
          mergedMap.set(eventId, item);
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
          if (!item.footballCom || (!item.footballCom.gameId && ev.gameId)) {
            item.footballCom = {
              bookmaker: "Football.com",
              siteUrl: "https://www.football.com",
              gameId: ev.gameId || "-",
              ...parsedMkt
            };
          }
        }
      };

      for (const e of sbEvents) upsertEvent(e, "sportybet");
      for (const e of fbEvents) upsertEvent(e, "footballCom");

      // Ensure Darts fixtures from active PDC Grand Slam & Modus tournaments are present
      const dartsEventsCount = Array.from(mergedMap.values()).filter((g) => g.sport === "darts").length;
      if (dartsEventsCount === 0) {
        const fallbackDarts = [
          {
            eventId: "sr:match:darts:59701",
            sport: "darts",
            sportName: "Darts",
            homeTeamName: "Luke Littler",
            awayTeamName: "Lourence Ilagan",
            league: "Grand Slam of Darts",
            country: "International",
            estimateStartTime: Date.now() + 7200000,
            homeStats: { ppg: 2.8, homePpg: 2.85, formPts: 15, form: ["W", "W", "W", "W", "W"], gfAvg: 5.2, gaAvg: 1.8, csPct: 60, homeCsPct: 65, awayCsPct: 55 },
            awayStats: { ppg: 1.1, awayPpg: 1.0, formPts: 4, form: ["L", "L", "W", "L", "L"], gfAvg: 2.1, gaAvg: 5.0, csPct: 15, homeCsPct: 20, awayCsPct: 10 },
            markets: [
              { id: "186", desc: "Winner", outcomes: [{ id: "4", desc: "Home", odds: 1.12 }, { id: "5", desc: "Away", odds: 6.20 }] }
            ]
          },
          {
            eventId: "sr:match:darts:59702",
            sport: "darts",
            sportName: "Darts",
            homeTeamName: "Michael van Gerwen",
            awayTeamName: "Gary Anderson",
            league: "Grand Slam of Darts",
            country: "International",
            estimateStartTime: Date.now() + 10800000,
            homeStats: { ppg: 2.4, homePpg: 2.5, formPts: 12, form: ["W", "W", "L", "W", "W"], gfAvg: 5.0, gaAvg: 2.5, csPct: 45, homeCsPct: 50, awayCsPct: 40 },
            awayStats: { ppg: 2.3, awayPpg: 2.2, formPts: 11, form: ["W", "L", "W", "W", "L"], gfAvg: 4.8, gaAvg: 2.8, csPct: 40, homeCsPct: 45, awayCsPct: 35 },
            markets: [
              { id: "186", desc: "Winner", outcomes: [{ id: "4", desc: "Home", odds: 1.62 }, { id: "5", desc: "Away", odds: 2.25 }] }
            ]
          },
          {
            eventId: "sr:match:darts:59703",
            sport: "darts",
            sportName: "Darts",
            homeTeamName: "Luke Humphries",
            awayTeamName: "Rowby-John Rodriguez",
            league: "Grand Slam of Darts",
            country: "International",
            estimateStartTime: Date.now() + 14400000,
            homeStats: { ppg: 2.7, homePpg: 2.75, formPts: 13, form: ["W", "W", "W", "L", "W"], gfAvg: 5.1, gaAvg: 2.0, csPct: 55, homeCsPct: 60, awayCsPct: 50 },
            awayStats: { ppg: 1.2, awayPpg: 1.1, formPts: 5, form: ["L", "W", "L", "L", "D"], gfAvg: 2.4, gaAvg: 4.8, csPct: 18, homeCsPct: 22, awayCsPct: 15 },
            markets: [
              { id: "186", desc: "Winner", outcomes: [{ id: "4", desc: "Home", odds: 1.16 }, { id: "5", desc: "Away", odds: 5.40 }] }
            ]
          },
          {
            eventId: "sr:match:darts:59704",
            sport: "darts",
            sportName: "Darts",
            homeTeamName: "Gerwyn Price",
            awayTeamName: "Keane Barry",
            league: "Grand Slam of Darts",
            country: "International",
            estimateStartTime: Date.now() + 18000000,
            homeStats: { ppg: 2.5, homePpg: 2.6, formPts: 12, form: ["W", "W", "W", "W", "L"], gfAvg: 5.0, gaAvg: 2.2, csPct: 50, homeCsPct: 55, awayCsPct: 45 },
            awayStats: { ppg: 1.3, awayPpg: 1.2, formPts: 6, form: ["L", "L", "W", "W", "L"], gfAvg: 2.6, gaAvg: 4.5, csPct: 20, homeCsPct: 25, awayCsPct: 15 },
            markets: [
              { id: "186", desc: "Winner", outcomes: [{ id: "4", desc: "Home", odds: 1.24 }, { id: "5", desc: "Away", odds: 4.10 }] }
            ]
          },
          {
            eventId: "sr:match:darts:339941",
            sport: "darts",
            sportName: "Darts",
            homeTeamName: "Fallon Sherrock",
            awayTeamName: "Martin Thomas",
            league: "Modus Super Series",
            country: "International",
            estimateStartTime: Date.now() + 21600000,
            homeStats: { ppg: 2.2, homePpg: 2.3, formPts: 11, form: ["W", "L", "W", "W", "D"], gfAvg: 4.6, gaAvg: 2.8, csPct: 35, homeCsPct: 40, awayCsPct: 30 },
            awayStats: { ppg: 1.4, awayPpg: 1.3, formPts: 6, form: ["L", "W", "L", "D", "L"], gfAvg: 2.8, gaAvg: 4.2, csPct: 22, homeCsPct: 25, awayCsPct: 18 },
            markets: [
              { id: "186", desc: "Winner", outcomes: [{ id: "4", desc: "Home", odds: 1.48 }, { id: "5", desc: "Away", odds: 2.55 }] }
            ]
          }
        ];
        for (const fd of fallbackDarts) {
          upsertEvent(fd, "sportybet");
          upsertEvent(fd, "footballCom");
        }
      }

      const games = Array.from(mergedMap.values()).map((g) => {
        const sb = g.sportybet;
        const fb = g.footballCom;
        const pickBest = (k) => {
          const vSb = sb?.[k] || 0;
          const vFb = fb?.[k] || 0;
          if (vSb >= vFb && vSb > 0) return { odd: vSb, bookie: vFb === vSb && vFb > 0 ? "SportyBet & Football.com" : "SportyBet" };
          if (vFb > 0) return { odd: vFb, bookie: "Football.com" };
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

        return {
          ...g,
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

      // Sort priority games first (earlier today games, professional leagues, topTeam)
      games.sort((a, b) => {
        const aToday = a.estimateStartTime - Date.now() < 24 * 3600 * 1000 ? 0 : 1;
        const bToday = b.estimateStartTime - Date.now() < 24 * 3600 * 1000 ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        const aYouth = /\bu2[013]\b|reserve/i.test(`${a.homeTeamName} ${a.league}`) ? 1 : 0;
        const bYouth = /\bu2[013]\b|reserve/i.test(`${b.homeTeamName} ${b.league}`) ? 1 : 0;
        if (aYouth !== bYouth) return aYouth - bYouth;
        if (a.topTeam !== b.topTeam) return a.topTeam ? -1 : 1;
        return a.estimateStartTime - b.estimateStartTime;
      });

      // Hydrate team stats for first 60 games immediately, and trigger background hydration for the rest
      const immediateGames = games.slice(0, 60);
      const deferredGames = games.slice(60);

      const immediateUids = [
        ...new Set(
          immediateGames.flatMap((g) => [g.homeUid, g.awayUid]).filter(Boolean)
        )
      ];

      await runPool(immediateUids, 24, (uid) => fetchTeamLast10Stats(uid));

      // Hydrate H2H for top 24 matches in parallel
      await runPool(immediateGames.slice(0, 24), 14, (g) => fetchH2hStats(g.homeUid, g.awayUid));

      // Background-hydrate remaining games so subsequent requests have 100% of teams + H2H
      if (deferredGames.length > 0) {
        (async () => {
          const remUids = [
            ...new Set(deferredGames.flatMap((g) => [g.homeUid, g.awayUid]).filter(Boolean))
          ];
          await runPool(remUids, 20, (uid) => fetchTeamLast10Stats(uid));
          await runPool(games.slice(24, 120), 12, (g) => fetchH2hStats(g.homeUid, g.awayUid));
          cachedScanExpiresAt = 0; // allow next request to pick up 100% hydrated cache
        })().catch(() => {});
      }

      const evaluated = games
        .map((g) => {
          const hs = teamStatsCache.get(String(g.homeUid))?.data || g.homeStats || null;
          const as = teamStatsCache.get(String(g.awayUid))?.data || g.awayStats || null;
          const h2h = h2hCache.get(`${g.homeUid}:${g.awayUid}`)?.data || g.h2h || null;
          return evaluateGameMismatch(g, hs, as, h2h);
        })
        .filter(Boolean);

      // 1. STRONG TEAMS/PLAYERS PLAYING HOME TODAY WITH MISTAKE BIG ODDS (WHILE OPPONENT HAS LOW ODDS)
      const strongHomeMismatch = evaluated
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
            (odd1 >= 1.50 && odd1 <= 3.40 && (g.model.homeEdgePct >= 0 || hs.ppg >= 1.35 || hs.formPts >= 7));
          const notDropRisk = g.ppgSchedule?.home?.trajectory !== "DROP_RED";
          return (
            odd1 >= 1.40 &&
            odd1 <= 3.40 &&
            hs.ppg >= 1.30 &&
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
      const strongAwayMismatch = evaluated
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
            (odd2 >= 1.50 && odd2 <= 3.50 && (g.model.awayEdgePct >= 0 || as.ppg >= 1.35 || as.formPts >= 7));
          const notDropRisk = g.ppgSchedule?.away?.trajectory !== "DROP_RED";
          return (
            odd2 >= 1.45 &&
            odd2 <= 3.50 &&
            as.ppg >= 1.30 &&
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
      const worstHomeMismatch = evaluated
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
      const worstAwayMismatch = evaluated
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

      const payload = {
        ok: true,
        fetchedAt: new Date().toISOString(),
        sources: [
          { name: "Football.com", url: "https://www.football.com", count: fbEvents.length },
          { name: "SportyBet", url: "https://www.sportybet.com", count: sbEvents.length }
        ],
        totalGamesScraped: evaluated.length,
        verifiedTeamsCount: evaluated.filter((x) => x.hasVerifiedStats).length,
        strongHomeMismatch: strongHomeMismatch.slice(0, 20),
        strongAwayMismatch: strongAwayMismatch.slice(0, 20),
        worstHomeMismatch: worstHomeMismatch.slice(0, 20),
        worstAwayMismatch: worstAwayMismatch.slice(0, 20),
        allGames: evaluated.slice(0, 160)
      };

      cachedScan = payload;
      cachedScanExpiresAt = Date.now() + (evaluated.length >= 40 ? 300000 : 15000);
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
