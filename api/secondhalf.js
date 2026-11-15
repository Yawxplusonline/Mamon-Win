// Real-Time 2nd Half Highest Scoring Intelligence Engine (Domestic + UEFA Competitions)
// Aggregates real ESPN match goal minutes (1H vs 2H), per-league 2H dominance,
// per-team 2H scoring rates, and 1st-Half Draw -> 2nd-Half Goal breakout teams.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TARGET_LEAGUES = [
  // UEFA Club Competitions
  { code: "uefa.champions", slug: "uefa-champions-league", name: "UEFA Champions League", country: "Europe", flag: "🇪🇺", category: "UEFA", uefaAnchor: "86", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png" },
  { code: "uefa.europa", slug: "uefa-europa-league", name: "UEFA Europa League", country: "Europe", flag: "🇪🇺", category: "UEFA", uefaAnchor: "110", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2310.png" },
  { code: "uefa.europa.conf", slug: "uefa-conference-league", name: "UEFA Conference League", country: "Europe", flag: "🇪🇺", category: "UEFA", uefaAnchor: "115", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/20296.png" },
  // Domestic Leagues (Top European, 2nd Tiers & Global Attacking Leagues)
  { code: "eng.1", slug: "england-premier-league", name: "English Premier League", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png" },
  { code: "ger.1", slug: "germany-bundesliga", name: "German Bundesliga", country: "Germany", flag: "🇩🇪", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png" },
  { code: "esp.1", slug: "spain-la-liga", name: "Spanish La Liga", country: "Spain", flag: "🇪🇸", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png" },
  { code: "ita.1", slug: "italy-serie-a", name: "Italian Serie A", country: "Italy", flag: "🇮🇹", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png" },
  { code: "fra.1", slug: "france-ligue-1", name: "French Ligue 1", country: "France", flag: "🇫🇷", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png" },
  { code: "ned.1", slug: "netherlands-eredivisie", name: "Dutch Eredivisie", country: "Netherlands", flag: "🇳🇱", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/11.png" },
  { code: "por.1", slug: "portugal-primeira-liga", name: "Portuguese Primeira Liga", country: "Portugal", flag: "🇵🇹", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/14.png" },
  { code: "bel.1", slug: "belgium-first-division-a", name: "Belgian Pro League", country: "Belgium", flag: "🇧🇪", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/6.png" },
  { code: "tur.1", slug: "turkey-super-lig", name: "Turkish Süper Lig", country: "Turkey", flag: "🇹🇷", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/18.png" },
  { code: "eng.2", slug: "england-championship", name: "English Championship", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/24.png" },
  { code: "ger.2", slug: "germany-2-bundesliga", name: "German 2. Bundesliga", country: "Germany", flag: "🇩🇪", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/13.png" },
  { code: "esp.2", slug: "spain-segunda-division", name: "Spanish LaLiga 2", country: "Spain", flag: "🇪🇸", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/16.png" },
  { code: "sco.1", slug: "scotland-premiership", name: "Scottish Premiership", country: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/45.png" },
  { code: "aut.1", slug: "austria-bundesliga", name: "Austrian Bundesliga", country: "Austria", flag: "🇦🇹", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/5.png" },
  { code: "sui.1", slug: "switzerland-super-league", name: "Swiss Super League", country: "Switzerland", flag: "🇨🇭", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/17.png" },
  { code: "den.1", slug: "denmark-superligaen", name: "Danish Superligaen", country: "Denmark", flag: "🇩🇰", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/7.png" },
  { code: "bra.1", slug: "brazil-serie-a", name: "Brazilian Serie A", country: "Brazil", flag: "🇧🇷", category: "DOMESTIC", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/85.png" }
];

const CACHE_TTL_MS = 25 * 60 * 1000;
let cachedPayload = null;
let cacheExpiresAt = 0;
let inFlightBuild = null;

async function fetchJsonSafe(url, timeoutMs = 5500) {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function classifyGoalHalf(detail) {
  const clk = String(detail?.clock?.displayValue || "").trim();
  const valSec = Number(detail?.clock?.value);
  // Stoppage time of 1H: "45'+2'" or period 1 -> 1st Half
  if (Number(detail?.period?.number) === 1 || /^45\s*\+/.test(clk)) return 1;
  if (Number(detail?.period?.number) === 2) return 2;
  const min = parseInt(clk, 10);
  if (Number.isFinite(min) && min > 0) {
    return min <= 45 ? 1 : 2;
  }
  if (Number.isFinite(valSec) && valSec > 0) {
    return valSec <= 2750 ? 1 : 2;
  }
  return 2;
}

async function fetchLeagueMatchHistory(lg, todayIso) {
  const baseSb = await fetchJsonSafe(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.code}/scoreboard`,
    5500
  );
  if (!baseSb) return { lg, completed: [], upcoming: [] };

  const espnLogo = baseSb.leagues?.[0]?.logos?.[0]?.href || lg.logo || "";
  let pastDates = [];
  if (lg.code.startsWith("uefa.")) {
    const firstTeamId = baseSb.events?.[0]?.competitions?.[0]?.competitors?.[0]?.team?.id || lg.uefaAnchor;
    const sched = await fetchJsonSafe(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.code}/teams/${firstTeamId}/schedule`,
      5500
    );
    if (sched && Array.isArray(sched.events)) {
      const rawDates = sched.events
        .filter((e) => e.competitions?.[0]?.status?.type?.state === "post")
        .map((e) => String(e.date || "").slice(0, 10))
        .filter(Boolean);
      const expandSet = new Set();
      for (const dt of rawDates.slice(-6)) {
        const ts = Date.parse(`${dt}T12:00:00Z`);
        if (Number.isFinite(ts)) {
          for (const off of [-1, 0, 1]) {
            expandSet.add(new Date(ts + off * 86400000).toISOString().slice(0, 10));
          }
        }
      }
      pastDates = [...expandSet].filter((d) => d <= todayIso).sort().slice(-12);
    }
  } else {
    const cal = (baseSb.leagues?.[0]?.calendar || [])
      .filter((x) => typeof x === "string")
      .map((x) => x.slice(0, 10))
      .filter((d) => d <= todayIso);
    pastDates = cal.slice(-11);
  }

  const upcoming = [];
  for (const ev of baseSb.events || []) {
    const comp = ev.competitions?.[0];
    const st = comp?.status?.type?.state;
    if (st === "pre" || st === "in") {
      const h = comp.competitors?.find((c) => c.homeAway === "home");
      const a = comp.competitors?.find((c) => c.homeAway === "away");
      if (h?.team && a?.team) {
        upcoming.push({
          eventId: ev.id,
          date: String(ev.date || "").slice(0, 10),
          kickoffIso: ev.date,
          isLive: st === "in",
          homeName: h.team.displayName || h.team.name,
          homeId: h.team.id,
          homeLogo: h.team.logo || "",
          awayName: a.team.displayName || a.team.name,
          awayId: a.team.id,
          awayLogo: a.team.logo || ""
        });
      }
    }
  }

  const dayPayloads = await Promise.all(
    pastDates.map((d) =>
      fetchJsonSafe(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.code}/scoreboard?dates=${d.replace(/-/g, "")}`,
        5000
      )
    )
  );

  const seenIds = new Set();
  const completed = [];
  for (const dp of dayPayloads) {
    if (!dp || !Array.isArray(dp.events)) continue;
    for (const ev of dp.events) {
      if (!ev?.id || seenIds.has(ev.id)) continue;
      const comp = ev.competitions?.[0];
      if (comp?.status?.type?.state !== "post") continue;
      seenIds.add(ev.id);
      completed.push(ev);
    }
  }

  return { lg: { ...lg, logo: espnLogo }, completed, upcoming };
}

function buildSecondHalfDataset(leagueResults) {
  const leaguesRanked = [];
  const teamMap = new Map();

  const ensureTeam = (teamObj, lg) => {
    const idKey = `${lg.code}:${teamObj.id || teamObj.displayName}`;
    if (!teamMap.has(idKey)) {
      teamMap.set(idKey, {
        id: idKey,
        teamId: String(teamObj.id || ""),
        team: teamObj.displayName || teamObj.name || "Club",
        shortName: teamObj.shortDisplayName || teamObj.abbreviation || teamObj.displayName || "Club",
        logo: teamObj.logo || "",
        leagueCode: lg.code,
        leagueSlug: lg.slug,
        leagueName: lg.name,
        leagueLogo: lg.logo,
        country: lg.country,
        flag: lg.flag,
        category: lg.category,
        matches: 0,
        goals1H: 0,
        goals2H: 0,
        conceded1H: 0,
        conceded2H: 0,
        team2hHigherMatches: 0,
        match2hHigherMatches: 0,
        htDraws: 0,
        ht00Count: 0,
        htDrawsWith2hGoal: 0,
        htDrawsTeamScored2h: 0,
        ht00With2hGoal: 0,
        htDrawTotal2hGoals: 0,
        htDrawTeam2hGoals: 0,
        recentMatches: [],
        recentHtDraws: []
      });
    }
    return teamMap.get(idKey);
  };

  for (const { lg, completed, upcoming } of leagueResults) {
    if (!completed || completed.length === 0) continue;

    let lgMatches = 0;
    let lg1H = 0;
    let lg2H = 0;
    let lg2hHigher = 0;
    let lg1hHigher = 0;
    let lgEqual = 0;
    let lgHtDraws = 0;
    let lgHtDrawsWith2hGoal = 0;
    let lgHt00 = 0;
    let lgHt00With2hGoal = 0;

    for (const ev of completed) {
      const comp = ev.competitions?.[0];
      const h = comp?.competitors?.find((c) => c.homeAway === "home");
      const a = comp?.competitors?.find((c) => c.homeAway === "away");
      if (!h?.team || !a?.team) continue;

      const hFinal = Number(h.score);
      const aFinal = Number(a.score);
      if (!Number.isFinite(hFinal) || !Number.isFinite(aFinal)) continue;

      let h1 = 0, a1 = 0, h2 = 0, a2 = 0;
      const details = Array.isArray(comp.details) ? comp.details : [];
      const scoringDetails = details.filter((d) => d?.scoringPlay);

      for (const d of scoringDetails) {
        const half = classifyGoalHalf(d);
        const isHome = String(d.team?.id || "") === String(h.team.id || "");
        if (half === 1) {
          if (isHome) h1++; else a1++;
        } else {
          if (isHome) h2++; else a2++;
        }
      }

      // Reconcile if ESPN details missed an own goal / scoring flag vs official FT score
      if (scoringDetails.length === 0 && (hFinal + aFinal) > 0) {
        continue;
      }

      const m1H = h1 + a1;
      const m2H = h2 + a2;
      const isHtDraw = h1 === a1;
      const isHt00 = h1 === 0 && a1 === 0;

      lgMatches++;
      lg1H += m1H;
      lg2H += m2H;
      if (m2H > m1H) lg2hHigher++;
      else if (m1H > m2H) lg1hHigher++;
      else lgEqual++;

      if (isHtDraw) {
        lgHtDraws++;
        if (m2H > 0) lgHtDrawsWith2hGoal++;
      }
      if (isHt00) {
        lgHt00++;
        if (m2H > 0) lgHt00With2hGoal++;
      }

      const dateIso = String(ev.date || "").slice(0, 10);
      const htScoreStr = `${h1}-${a1}`;
      const ftScoreStr = `${h1 + h2}-${a1 + a2}`;
      const secondHalfScoreStr = `${h2}-${a2}`;

      // Update Home Team
      const hRec = ensureTeam(h.team, lg);
      hRec.matches++;
      hRec.goals1H += h1;
      hRec.goals2H += h2;
      hRec.conceded1H += a1;
      hRec.conceded2H += a2;
      if (h2 > h1) hRec.team2hHigherMatches++;
      if (m2H > m1H) hRec.match2hHigherMatches++;
      hRec.recentMatches.push({
        date: dateIso,
        venue: "H",
        opponent: a.team.shortDisplayName || a.team.displayName,
        opponentLogo: a.team.logo || "",
        htScore: htScoreStr,
        ftScore: ftScoreStr,
        shScore: secondHalfScoreStr,
        team1H: h1,
        team2H: h2,
        match1H: m1H,
        match2H: m2H
      });
      if (isHtDraw) {
        hRec.htDraws++;
        if (isHt00) hRec.ht00Count++;
        if (m2H > 0) {
          hRec.htDrawsWith2hGoal++;
          if (isHt00) hRec.ht00With2hGoal++;
        }
        if (h2 > 0) hRec.htDrawsTeamScored2h++;
        hRec.htDrawTotal2hGoals += m2H;
        hRec.htDrawTeam2hGoals += h2;
        hRec.recentHtDraws.push({
          date: dateIso,
          venue: "H",
          opponent: a.team.shortDisplayName || a.team.displayName,
          htScore: htScoreStr,
          ftScore: ftScoreStr,
          team2H: h2,
          match2H: m2H
        });
      }

      // Update Away Team
      const aRec = ensureTeam(a.team, lg);
      aRec.matches++;
      aRec.goals1H += a1;
      aRec.goals2H += a2;
      aRec.conceded1H += h1;
      aRec.conceded2H += h2;
      if (a2 > a1) aRec.team2hHigherMatches++;
      if (m2H > m1H) aRec.match2hHigherMatches++;
      aRec.recentMatches.push({
        date: dateIso,
        venue: "A",
        opponent: h.team.shortDisplayName || h.team.displayName,
        opponentLogo: h.team.logo || "",
        htScore: `${a1}-${h1}`,
        ftScore: `${a1 + a2}-${h1 + h2}`,
        shScore: `${a2}-${h2}`,
        team1H: a1,
        team2H: a2,
        match1H: m1H,
        match2H: m2H
      });
      if (isHtDraw) {
        aRec.htDraws++;
        if (isHt00) aRec.ht00Count++;
        if (m2H > 0) {
          aRec.htDrawsWith2hGoal++;
          if (isHt00) aRec.ht00With2hGoal++;
        }
        if (a2 > 0) aRec.htDrawsTeamScored2h++;
        aRec.htDrawTotal2hGoals += m2H;
        aRec.htDrawTeam2hGoals += a2;
        aRec.recentHtDraws.push({
          date: dateIso,
          venue: "A",
          opponent: h.team.shortDisplayName || h.team.displayName,
          htScore: `${a1}-${h1}`,
          ftScore: `${a1 + a2}-${h1 + h2}`,
          team2H: a2,
          match2H: m2H
        });
      }
    }

    if (lgMatches === 0) continue;
    const totalLgGoals = Math.max(1, lg1H + lg2H);
    const pct2hGoals = Math.round((lg2H / totalLgGoals) * 100);
    const pct2hHigherThan1h = Math.round((lg2hHigher / lgMatches) * 100);
    const pct1hHigher = Math.round((lg1hHigher / lgMatches) * 100);
    const pctEqual = Math.max(0, 100 - pct2hHigherThan1h - pct1hHigher);
    const avg2hGoalsPerMatch = Math.round((lg2H / lgMatches) * 100) / 100;
    const avg1hGoalsPerMatch = Math.round((lg1H / lgMatches) * 100) / 100;
    const pctHtDrawWith2hGoals = lgHtDraws > 0 ? Math.round((lgHtDrawsWith2hGoal / lgHtDraws) * 100) : 0;
    const pctHt00With2hGoals = lgHt00 > 0 ? Math.round((lgHt00With2hGoal / lgHt00) * 100) : 0;
    const dominanceScore = Math.round(pct2hHigherThan1h * 0.55 + pct2hGoals * 0.45);

    leaguesRanked.push({
      code: lg.code,
      slug: lg.slug,
      name: lg.name,
      country: lg.country,
      flag: lg.flag,
      logo: lg.logo,
      category: lg.category,
      matchesAnalyzed: lgMatches,
      goals1H: lg1H,
      goals2H: lg2H,
      avg1hGoalsPerMatch,
      avg2hGoalsPerMatch,
      pct2hGoals,
      pct2hHigherThan1h,
      pct1hHigher,
      pctEqual,
      htDraws: lgHtDraws,
      htDrawsWith2hGoal: lgHtDrawsWith2hGoal,
      pctHtDrawWith2hGoals,
      pctHt00With2hGoals,
      dominanceScore,
      upcomingCount: upcoming.length,
      upcomingSample: upcoming.slice(0, 4),
      recommendedTip: pct2hHigherThan1h >= 55 || pct2hGoals >= 58
        ? "🔥 Elite League for 2nd Half Highest Scoring & 2H Over 0.5/1.5 Goals"
        : pct2hGoals >= 53
          ? "🎯 Strong 2nd Half Bias · Target 2H Goals at 0-0 HT"
          : "📈 Selective 2H Spots · Wait for HT Draw Setup"
    });
  }

  leaguesRanked.sort((a, b) => b.dominanceScore - a.dominanceScore || b.pct2hGoals - a.pct2hGoals);

  const teamsAll = Array.from(teamMap.values()).filter((t) => t.matches >= 2);

  // Teams That Score More Goals in 2nd Half
  const teams2hScorers = teamsAll
    .filter((t) => t.goals2H > t.goals1H && t.goals2H >= 3)
    .map((t) => {
      const totFor = Math.max(1, t.goals1H + t.goals2H);
      const pct2hFor = Math.round((t.goals2H / totFor) * 100);
      const avg2hFor = Math.round((t.goals2H / t.matches) * 100) / 100;
      const avg1hFor = Math.round((t.goals1H / t.matches) * 100) / 100;
      const match2hHigherPct = Math.round((t.match2hHigherMatches / t.matches) * 100);
      const score = Math.round(pct2hFor * 0.45 + Math.min(35, avg2hFor * 18) + match2hHigherPct * 0.25);
      return {
        ...t,
        pct2hFor,
        avg2hFor,
        avg1hFor,
        match2hHigherPct,
        score2H: score,
        recentMatches: t.recentMatches.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
        recommendedTip: `${t.team} 2nd Half Over 0.5 Team Goals / 2nd Half Highest Scoring`
      };
    })
    .sort((a, b) => b.score2H - a.score2H || b.goals2H - a.goals2H || b.pct2hFor - a.pct2hFor)
    .slice(0, 60);

  // Teams That Play a 1st-Half Draw & Score Goals in the 2nd Half
  const htDrawBreakoutTeams = teamsAll
    .filter((t) => t.htDraws >= 2 && t.htDrawsTeamScored2h >= 1 && t.htDrawsWith2hGoal >= 2)
    .map((t) => {
      const htDrawBreakoutRatePct = Math.round((t.htDrawsWith2hGoal / Math.max(1, t.htDraws)) * 100);
      const htDrawTeamScoredPct = Math.round((t.htDrawsTeamScored2h / Math.max(1, t.htDraws)) * 100);
      const avg2hGoalsAfterHtDraw = Math.round((t.htDrawTotal2hGoals / Math.max(1, t.htDraws)) * 100) / 100;
      const breakoutScore = Math.round(
        htDrawBreakoutRatePct * 0.40 +
        htDrawTeamScoredPct * 0.35 +
        Math.min(25, t.htDrawsWith2hGoal * 4.5)
      );
      return {
        ...t,
        htDrawBreakoutRatePct,
        htDrawTeamScoredPct,
        avg2hGoalsAfterHtDraw,
        breakoutScore,
        recentHtDraws: t.recentHtDraws.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
        recommendedTip: `Live/Pre-Match: If HT is Draw (0-0/1-1) → Back 2H Over 0.5 Goals & 2nd Half Highest Scoring`
      };
    })
    .sort((a, b) => b.breakoutScore - a.breakoutScore || b.htDrawsTeamScored2h - a.htDrawsTeamScored2h || b.htDrawTeam2hGoals - a.htDrawTeam2hGoals)
    .slice(0, 60);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    leaguesAnalyzed: leaguesRanked.length,
    totalMatchesAnalyzed: leaguesRanked.reduce((s, l) => s + l.matchesAnalyzed, 0),
    leaguesRanked,
    teams2hScorers,
    htDrawBreakoutTeams
  };
}

async function fetchSecondHalfIntelligence(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedPayload && now < cacheExpiresAt) {
    return { ...cachedPayload, cacheHit: true };
  }
  if (!forceRefresh && inFlightBuild) {
    return inFlightBuild;
  }

  inFlightBuild = (async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(TARGET_LEAGUES.map((lg) => fetchLeagueMatchHistory(lg, todayIso)));
    const payload = buildSecondHalfDataset(results);
    cachedPayload = payload;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return { ...payload, cacheHit: false };
  })().finally(() => {
    inFlightBuild = null;
  });

  return inFlightBuild;
}

async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const force = reqUrl.searchParams.get("refresh") === "1";
    const data = await fetchSecondHalfIntelligence(force);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: err?.message || "Failed to build 2nd half analytics" }));
  }
}

module.exports = handler;
module.exports.fetchSecondHalfIntelligence = fetchSecondHalfIntelligence;
