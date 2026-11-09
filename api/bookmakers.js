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
    } else if (id === "10") {
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (String(o.id) === "9" || /home or draw|1x/i.test(o.desc)) out.dc1X = odd;
        else if (String(o.id) === "10" || /home or away|12/i.test(o.desc)) out.dc12 = odd;
        else if (String(o.id) === "11" || /draw or away|x2/i.test(o.desc)) out.dcX2 = odd;
      }
    } else if (id === "18") {
      const spec = String(m.specifier || "");
      for (const o of outcomes) {
        const odd = parseFloat(o.odds);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        const isOver = String(o.id) === "12" || /over/i.test(o.desc);
        if (spec === "total=1.5") {
          if (isOver) out.over15 = odd;
          else out.under15 = odd;
        } else if (spec === "total=2.5") {
          if (isOver) out.over25 = odd;
          else out.under25 = odd;
        } else if (spec === "total=3.5" && isOver) {
          out.over35 = odd;
        }
      }
    } else if (id === "29") {
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

function extractEventsFromFactCenter(json) {
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
      out.push({ ...ev, _tournamentIcon: tIcon, _tournamentName: tName });
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

function evaluateGameMismatch(game, hStats, aStats, h2h) {
  const b = game.bestOdds;
  if (!b.home || !b.away) return null;

  // Fallback baseline stats when Sportradar doesn't have 10-game history for a club
  const hs = hStats || {
    mp: 6, w: 3, d: 1, l: 2, gd: 1, ppg: 1.5, homePpg: 1.65, awayPpg: 1.35,
    homeRecord: "2W-1D-1L", awayRecord: "1W-0D-1L",
    gfAvg: 1.45, gaAvg: 1.25, csPct: 30, homeCsPct: 35, awayCsPct: 25,
    form: ["W", "D", "W", "L", "W"], formPts: 10, recentScores: []
  };
  const as = aStats || {
    mp: 6, w: 2, d: 2, l: 2, gd: 0, ppg: 1.33, homePpg: 1.45, awayPpg: 1.2,
    homeRecord: "1W-1D-1L", awayRecord: "1W-1D-1L",
    gfAvg: 1.3, gaAvg: 1.3, csPct: 25, homeCsPct: 28, awayCsPct: 22,
    form: ["D", "W", "L", "D", "W"], formPts: 8, recentScores: []
  };

  const hasVerifiedStats = Boolean(hStats && aStats);
  const h2hData = h2h || { meetings: 0, homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.5, lastMeeting: "" };

  // Compute statistical model probabilities (independent of bookmaker mistake)
  const hPowerRaw =
    hs.ppg * 22 +
    hs.homePpg * 14 +
    (hs.formPts / 15) * 20 +
    clamp((hs.gfAvg - hs.gaAvg) * 10, -14, 18) +
    (hs.homeCsPct / 100) * 8 +
    clamp((h2hData.homeWins - h2hData.awayWins) * 3.5, -7, 7) +
    6; // home pitch baseline

  const aPowerRaw =
    as.ppg * 22 +
    as.awayPpg * 15 +
    (as.formPts / 15) * 20 +
    clamp((as.gfAvg - as.gaAvg) * 10, -14, 18) +
    (as.awayCsPct / 100) * 8 +
    clamp((h2hData.awayWins - h2hData.homeWins) * 3.5, -7, 7);

  const powerDiff = (hPowerRaw - aPowerRaw) / 100;
  const modelProbHome = clamp(0.42 + powerDiff * 0.62, 0.10, 0.86);
  const modelProbDraw = clamp(0.26 - Math.abs(powerDiff) * 0.14, 0.12, 0.30);
  const modelProbAway = clamp(1 - modelProbHome - modelProbDraw, 0.08, 0.84);

  const rawImpH = 1 / b.home;
  const rawImpD = b.draw ? 1 / b.draw : 0.28;
  const rawImpA = 1 / b.away;
  const overround = rawImpH + rawImpD + rawImpA;
  const bookieProbHome = rawImpH / overround;
  const bookieProbDraw = rawImpD / overround;
  const bookieProbAway = rawImpA / overround;

  const homeEdgePct = Math.round((modelProbHome - bookieProbHome) * 100);
  const awayEdgePct = Math.round((modelProbAway - bookieProbAway) * 100);

  // 1. Strong Home Team Given Mistake Big Odds (Opponent Has Low Odds)
  const homeInverted = b.home >= b.away;
  const strongHomeScore = Math.round(
    clamp(
      26 +
        (hasVerifiedStats ? 12 : -10) +
        (homeInverted ? 16 : b.home >= 2.0 ? 8 : 0) +
        clamp(b.home - b.away, -0.6, 2.5) * 9 +
        hs.ppg * 13 +
        hs.homePpg * 8 +
        (hs.formPts / 15) * 13 +
        clamp(hs.ppg - as.ppg, -0.5, 2.2) * 15 +
        clamp(hs.gfAvg - as.gfAvg, -1, 2) * 6 +
        clamp(homeEdgePct * 0.9, -6, 24),
      10,
      99
    )
  );

  // 2. Strong Away Team Given Mistake Big Odds (Opponent Has Low Odds)
  const awayInverted = b.away >= b.home;
  const strongAwayScore = Math.round(
    clamp(
      26 +
        (hasVerifiedStats ? 12 : -10) +
        (awayInverted ? 16 : b.away >= 2.0 ? 8 : 0) +
        clamp(b.away - b.home, -0.6, 2.8) * 9 +
        as.ppg * 13 +
        as.awayPpg * 9 +
        (as.formPts / 15) * 13 +
        clamp(as.ppg - hs.ppg, -0.5, 2.2) * 16 +
        clamp(as.gfAvg - hs.gfAvg, -1, 2) * 6 +
        clamp(awayEdgePct * 0.9, -6, 24),
      10,
      99
    )
  );

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

  return {
    ...game,
    hasVerifiedStats,
    homeStats: hs,
    awayStats: as,
    h2h: h2hData,
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
      const sbTodayUrl = "https://www.sportybet.com/api/gh/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C18%2C29&todayGames=true&pageSize=100&pageNum=1";
      const sbLiveUrl = "https://www.sportybet.com/api/gh/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C18%2C29";
      const fbTodayGhUrl = "https://www.football.com/api/gh/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C18%2C29&todayGames=true&pageSize=100&pageNum=1";
      const fbTodayNgUrl = "https://www.football.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C18%2C29&todayGames=true&pageSize=100&pageNum=1";

      const [sbTodayJson, sbLiveJson, fbGhJson, fbNgJson] = await Promise.all([
        fetchJsonSafe(sbTodayUrl, 8500, "https://www.sportybet.com/"),
        fetchJsonSafe(sbLiveUrl, 6500, "https://www.sportybet.com/"),
        fetchJsonSafe(fbTodayGhUrl, 8500, "https://www.football.com/"),
        fetchJsonSafe(fbTodayNgUrl, 8500, "https://www.football.com/")
      ]);

      const sbEvents = [
        ...extractEventsFromFactCenter(sbLiveJson),
        ...extractEventsFromFactCenter(sbTodayJson)
      ];
      const fbEvents = [
        ...extractEventsFromFactCenter(fbGhJson),
        ...extractEventsFromFactCenter(fbNgJson)
      ];

      // If todayGames has a second page (>100 games today), fetch page 2 sequentially to avoid CloudFront burst blocks
      if ((sbTodayJson?.data?.totalNum || 0) > 100) {
        const [sbP2, fbP2] = await Promise.all([
          fetchJsonSafe("https://www.sportybet.com/api/gh/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C18%2C29&todayGames=true&pageSize=100&pageNum=2", 7500, "https://www.sportybet.com/"),
          fetchJsonSafe("https://www.football.com/api/gh/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C18%2C29&todayGames=true&pageSize=100&pageNum=2", 7500, "https://www.football.com/")
        ]);
        sbEvents.push(...extractEventsFromFactCenter(sbP2));
        fbEvents.push(...extractEventsFromFactCenter(fbP2));
      }

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
            score: ev.setScore || null,
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
          const hs = teamStatsCache.get(String(g.homeUid))?.data || null;
          const as = teamStatsCache.get(String(g.awayUid))?.data || null;
          const h2h = h2hCache.get(`${g.homeUid}:${g.awayUid}`)?.data || null;
          return evaluateGameMismatch(g, hs, as, h2h);
        })
        .filter(Boolean);

      // 1. STRONG TEAMS PLAYING HOME TODAY WITH MISTAKE BIG ODDS (WHILE OPPONENT HAS LOW ODDS)
      const strongHomeMismatch = evaluated
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const homeStronger =
            hs.ppg >= as.ppg + 0.12 ||
            hs.homePpg >= as.awayPpg + 0.25 ||
            hs.formPts >= as.formPts + 2;
          const mistakeBigOddsGiven =
            odd1 >= odd2 ||
            (odd1 >= 1.95 && odd2 <= 3.50 && (hs.ppg >= as.ppg + 0.25 || hs.formPts >= as.formPts + 3));
          return (
            g.hasVerifiedStats &&
            odd1 >= 1.90 &&
            odd1 <= 6.80 &&
            hs.ppg >= 1.30 &&
            hs.formPts >= 7 &&
            homeStronger &&
            mistakeBigOddsGiven
          );
        })
        .map((g) => {
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const dc1X = g.bestOdds.dc1X;
          const hs = g.homeStats;
          const as = g.awayStats;
          const isInvertedTrap = odd1 >= odd2;
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
            mismatchMarket: `Back Strong Home (${g.homeTeamName}) Win (1)`,
            backupMarket: dc1X ? `1X Double Chance @ ${dc1X.toFixed(2)}` : `Over 1.5 Goals @ ${(g.bestOdds.over15 || 1.25).toFixed(2)}`,
            bestBookmaker: g.bestOdds.homeBookie,
            edgePct: g.model.homeEdgePct,
            trickSummary: `BOOKIE TRICK: ${g.homeTeamName} (Strong Home) given Mistake BIG Odds @ ${odd1.toFixed(2)} while weaker opponent ${g.awayTeamName} has LOW Odds @ ${odd2.toFixed(2)} to make you think ${g.homeTeamName} will lose.`,
            realityVerdict: `REALITY: ${g.homeTeamName} will WIN — Superior ${hs.ppg.toFixed(2)} PPG (Home ${hs.homePpg.toFixed(2)} PPG · Form ${hs.form.join("-")}) vs ${g.awayTeamName} (${as.ppg.toFixed(2)} PPG · Away ${as.awayPpg.toFixed(2)} PPG).`,
            headlineReason: `Bookmaker Trap Exposed: ${g.homeTeamName} is the stronger team (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")} · ${hs.gfAvg} GF/g) against ${g.awayTeamName} (${as.ppg.toFixed(2)} PPG · ${as.gaAvg} GA/g), yet bookies gave ${g.homeTeamName} MISTAKE BIG ODDS of ${odd1.toFixed(2)} (and ${g.awayTeamName} low odds of ${odd2.toFixed(2)}) to trick bettors into thinking ${g.homeTeamName} will lose!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      // 2. STRONG TEAMS PLAYING AWAY TODAY WITH MISTAKE BIG ODDS (WHILE OPPONENT HAS LOW ODDS)
      const strongAwayMismatch = evaluated
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const awayStronger =
            as.ppg >= hs.ppg + 0.10 ||
            as.awayPpg >= hs.homePpg + 0.20 ||
            as.formPts >= hs.formPts + 2;
          const mistakeBigOddsGiven =
            odd2 >= odd1 ||
            (odd2 >= 1.95 && odd1 <= 3.60 && (as.ppg >= hs.ppg + 0.25 || as.formPts >= hs.formPts + 3));
          return (
            g.hasVerifiedStats &&
            odd2 >= 1.90 &&
            odd2 <= 7.00 &&
            as.ppg >= 1.30 &&
            as.formPts >= 7 &&
            awayStronger &&
            mistakeBigOddsGiven
          );
        })
        .map((g) => {
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const dcX2 = g.bestOdds.dcX2;
          const hs = g.homeStats;
          const as = g.awayStats;
          const isInvertedTrap = odd2 >= odd1;
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
            mismatchMarket: `Back Strong Away (${g.awayTeamName}) Win (2)`,
            backupMarket: dcX2 ? `X2 Double Chance @ ${dcX2.toFixed(2)}` : `Over 1.5 Goals @ ${(g.bestOdds.over15 || 1.28).toFixed(2)}`,
            bestBookmaker: g.bestOdds.awayBookie,
            edgePct: g.model.awayEdgePct,
            trickSummary: `BOOKIE TRICK: ${g.awayTeamName} (Strong Away) given Mistake BIG Odds @ ${odd2.toFixed(2)} while weaker host ${g.homeTeamName} has LOW Odds @ ${odd1.toFixed(2)} to trick people into thinking ${g.awayTeamName} will lose.`,
            realityVerdict: `REALITY: ${g.awayTeamName} will WIN — Superior ${as.ppg.toFixed(2)} PPG (Away ${as.awayPpg.toFixed(2)} PPG · Form ${as.form.join("-")}) vs ${g.homeTeamName} (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")}).`,
            headlineReason: `Bookmaker Trap Exposed: ${g.awayTeamName} is the stronger side (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")} · ${as.gfAvg} GF/g) visiting ${g.homeTeamName} (${hs.ppg.toFixed(2)} PPG · ${hs.gaAvg} GA/g), yet bookies gave ${g.awayTeamName} MISTAKE BIG ODDS of ${odd2.toFixed(2)} (and ${g.homeTeamName} low odds of ${odd1.toFixed(2)}) to trick bettors into thinking ${g.awayTeamName} will lose!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      // 3. WORST TEAMS PLAYING HOME TODAY WITH MISTAKE LOW ODDS (WHILE OPPONENT HAS BIG ODDS)
      const worstHomeMismatch = evaluated
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const homeIsTrulyWeak =
            hs.ppg <= 1.25 &&
            hs.formPts <= 7 &&
            (hs.ppg <= as.ppg || hs.formPts <= as.formPts || hs.homePpg <= as.awayPpg);
          const mistakeLowOddGivenToWorstHome =
            odd1 < odd2 || (odd1 <= 2.45 && odd2 >= 2.50);
          return (
            g.hasVerifiedStats &&
            homeIsTrulyWeak &&
            mistakeLowOddGivenToWorstHome &&
            odd1 <= 2.55 &&
            odd2 >= 2.15
          );
        })
        .map((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const dcX2 = g.bestOdds.dcX2;
          const isInvertedTrap = odd1 < odd2;
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
            mismatchMarket: `Fade Worst Home (${g.homeTeamName} @ ${odd1.toFixed(2)}) -> Back ${g.awayTeamName} Win (2)`,
            backupMarket: dcX2 ? `X2 Double Chance @ ${dcX2.toFixed(2)}` : `Over 2.5 Goals @ ${(g.bestOdds.over25 || 1.85).toFixed(2)}`,
            bestBookmaker: g.bestOdds.awayBookie,
            edgePct: g.model.awayEdgePct,
            trickSummary: `BOOKIE TRICK: Worst Home Team ${g.homeTeamName} given Mistake LOW Odds @ ${odd1.toFixed(2)} to trick people into thinking they will win, while opponent ${g.awayTeamName} has BIG Odds @ ${odd2.toFixed(2)}.`,
            realityVerdict: `REALITY: ${g.homeTeamName} will LOSE — Weak ${hs.ppg.toFixed(2)} PPG (Form ${hs.form.join("-")} · ${hs.gaAvg} GA/g) vs stronger opponent ${g.awayTeamName} (${as.ppg.toFixed(2)} PPG · Form ${as.form.join("-")}).`,
            headlineReason: `Low-Odd Favorite Trap: ${g.homeTeamName} has poor metrics (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")} · ${hs.gaAvg} GA/g) yet bookmakers gave them MISTAKE LOW ODDS of ${odd1.toFixed(2)} to trick bettors into thinking they will win — in reality they are set to lose to ${g.awayTeamName} (@ ${odd2.toFixed(2)} Big Odds · ${as.ppg.toFixed(2)} PPG)!`
          };
        })
        .sort((a, b) => (b.isInvertedTrap ? 1 : 0) - (a.isInvertedTrap ? 1 : 0) || b.mismatchScore - a.mismatchScore || b.edgePct - a.edgePct);

      // 4. WORST TEAMS PLAYING AWAY TODAY WITH MISTAKE LOW ODDS (WHILE OPPONENT HAS BIG ODDS)
      const worstAwayMismatch = evaluated
        .filter((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home || 0;
          const odd2 = g.bestOdds.away || 0;
          const awayIsTrulyWeak =
            as.ppg <= 1.25 &&
            as.formPts <= 7 &&
            (as.ppg <= hs.ppg || as.formPts <= hs.formPts || as.awayPpg <= hs.homePpg);
          const mistakeLowOddGivenToWorstAway =
            odd2 < odd1 || (odd2 <= 2.65 && odd1 >= 2.25);
          return (
            g.hasVerifiedStats &&
            awayIsTrulyWeak &&
            mistakeLowOddGivenToWorstAway &&
            odd2 <= 2.75 &&
            odd1 >= 2.05
          );
        })
        .map((g) => {
          const hs = g.homeStats;
          const as = g.awayStats;
          const odd1 = g.bestOdds.home;
          const odd2 = g.bestOdds.away;
          const dc1X = g.bestOdds.dc1X;
          const isInvertedTrap = odd2 < odd1;
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
            mismatchMarket: `Fade Worst Away (${g.awayTeamName} @ ${odd2.toFixed(2)}) -> Back ${g.homeTeamName} Win (1)`,
            backupMarket: dc1X ? `1X Double Chance @ ${dc1X.toFixed(2)}` : `Over 2.5 Goals @ ${(g.bestOdds.over25 || 1.80).toFixed(2)}`,
            bestBookmaker: g.bestOdds.homeBookie,
            edgePct: g.model.homeEdgePct,
            trickSummary: `BOOKIE TRICK: Worst Away Team ${g.awayTeamName} given Mistake LOW Odds @ ${odd2.toFixed(2)} to trick people into thinking they will win, while host ${g.homeTeamName} has BIG Odds @ ${odd1.toFixed(2)}.`,
            realityVerdict: `REALITY: ${g.awayTeamName} will LOSE — Weak ${as.ppg.toFixed(2)} PPG (Away ${as.awayPpg.toFixed(2)} PPG · Form ${as.form.join("-")}) visiting ${g.homeTeamName} (${hs.ppg.toFixed(2)} PPG · Form ${hs.form.join("-")}).`,
            headlineReason: `Low-Odd Favorite Trap: ${g.awayTeamName} is struggling (${as.ppg.toFixed(2)} PPG · Away ${as.awayPpg.toFixed(2)} PPG · Form ${as.form.join("-")}) yet bookmakers gave them MISTAKE LOW ODDS of ${odd2.toFixed(2)} to trick bettors into thinking they will win — in reality they are set to lose to ${g.homeTeamName} (@ ${odd1.toFixed(2)} Big Odds · ${hs.ppg.toFixed(2)} PPG)!`
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
