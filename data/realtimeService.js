// Real-Time Football Telemetry, 11-Factor Match Analyzer & Sure Odds Engine for MAMON WIN
window.MAMON_REALTIME = (() => {
  const DATA = window.MAMON_DATA || {};
  const LEAGUES = window.MAMON_LEAGUES || [];
  const leagueBySlug = new Map(LEAGUES.map((l) => [l.slug, l]));

  // ESPN League Code <-> MAMON League Slug map
  const ESPN_LEAGUES = [
    { code: "eng.1", slug: "england-premier-league", name: "Premier League", country: "England", priority: 1 },
    { code: "esp.1", slug: "spain-la-liga", name: "La Liga", country: "Spain", priority: 2 },
    { code: "ita.1", slug: "italy-serie-a", name: "Serie A", country: "Italy", priority: 3 },
    { code: "ger.1", slug: "germany-bundesliga", name: "Bundesliga", country: "Germany", priority: 4 },
    { code: "fra.1", slug: "france-ligue-1", name: "Ligue 1", country: "France", priority: 5 },
    { code: "uefa.champions", slug: "uefa-champions-league", name: "UEFA Champions League", country: "Europe", priority: 6 },
    { code: "uefa.europa", slug: "uefa-europa-league", name: "UEFA Europa League", country: "Europe", priority: 7 },
    { code: "uefa.europa.conf", slug: "uefa-conference-league", name: "UEFA Conference League", country: "Europe", priority: 8 },
    { code: "ned.1", slug: "netherlands-eredivisie", name: "Eredivisie", country: "Netherlands", priority: 9 },
    { code: "por.1", slug: "portugal-primeira-liga", name: "Primeira Liga", country: "Portugal", priority: 10 },
    { code: "tur.1", slug: "turkey-super-lig", name: "Süper Lig", country: "Turkey", priority: 11 },
    { code: "bel.1", slug: "belgium-first-division-a", name: "Belgian Pro League", country: "Belgium", priority: 12 },
    { code: "sco.1", slug: "scotland-premiership", name: "Scottish Premiership", country: "Scotland", priority: 13 },
    { code: "eng.2", slug: "england-championship", name: "Championship", country: "England", priority: 14 },
    { code: "ger.2", slug: "germany-2-bundesliga", name: "2. Bundesliga", country: "Germany", priority: 15 },
    { code: "esp.2", slug: "spain-segunda-division", name: "LaLiga 2", country: "Spain", priority: 16 },
    { code: "ita.2", slug: "italy-serie-b", name: "Serie B", country: "Italy", priority: 17 },
    { code: "fra.2", slug: "france-ligue-2", name: "Ligue 2", country: "France", priority: 18 },
    { code: "sau.1", slug: "saudi-pro-league", name: "Saudi Pro League", country: "Saudi Arabia", priority: 19 },
    { code: "usa.1", slug: "usa-mls", name: "MLS", country: "United States", priority: 20 },
    { code: "mex.1", slug: "mexico-liga-mx", name: "Liga MX", country: "Mexico", priority: 21 },
    { code: "bra.1", slug: "brazil-serie-a", name: "Brazil Serie A", country: "Brazil", priority: 22 },
    { code: "arg.1", slug: "argentina-liga-profesional", name: "Liga Profesional", country: "Argentina", priority: 23 },
    { code: "rus.1", slug: "russia-premier-league", name: "Russian Premier League", country: "Russia", priority: 24 },
    { code: "chn.1", slug: "china-super-league", name: "Chinese Super League", country: "China", priority: 25 }
  ];

  const codeToMeta = new Map(ESPN_LEAGUES.map((x) => [x.code, x]));
  const slugToEspnCode = new Map(ESPN_LEAGUES.map((x) => [x.slug, x.code]));

  // Season slug pattern fallback for /all/scoreboard
  const SEASON_PATTERNS = [
    [/english-premier-league/i, "eng.1"],
    [/english-league-championship/i, "eng.2"],
    [/laliga2|segunda/i, "esp.2"],
    [/laliga/i, "esp.1"],
    [/italian-serie-b/i, "ita.2"],
    [/italian-serie-a/i, "ita.1"],
    [/german-2-bundesliga/i, "ger.2"],
    [/german-bundesliga/i, "ger.1"],
    [/french-ligue-2/i, "fra.2"],
    [/ligue-1/i, "fra.1"],
    [/dutch-eredivisie|eredivisie/i, "ned.1"],
    [/keuken-kampioen/i, "ned.2"],
    [/portuguese-primeira-liga/i, "por.1"],
    [/turkish-super-lig/i, "tur.1"],
    [/scottish-premiership/i, "sco.1"],
    [/belgian-pro-league/i, "bel.1"],
    [/uefa-champions-league/i, "uefa.champions"],
    [/uefa-europa-league/i, "uefa.europa"],
    [/uefa-conference-league/i, "uefa.europa.conf"],
    [/saudi-pro-league/i, "sau.1"],
    [/major-league-soccer|mls/i, "usa.1"],
    [/liga-mx/i, "mex.1"],
    [/brazilian-serie-a/i, "bra.1"],
    [/argentine-liga-profesional/i, "arg.1"],
    [/russian-premier-league/i, "rus.1"],
    [/chinese-super-league/i, "chn.1"],
    [/english-womens-super-league/i, "eng.w.1"],
    [/spanish-liga-f/i, "esp.w.1"]
  ];

  const summaryCache = new Map();
  const teamScheduleCache = new Map();
  const teamRosterCache = new Map();
  const standingsByTeamId = new Map();
  const injuriesByLeague = new Map();
  const newsByLeague = new Map();
  const weatherCache = new Map();
  const weatherInFlight = new Map();

  async function fetchMatchWeather(match) {
    if (!match) return null;
    if (match.weather?.ok) return match.weather;
    const city = match.venueCity || "";
    const country = match.venueCountry || "";
    if (!city) return null;
    const hourKey = String(match.isoDateTime || "").slice(0, 13);
    const key = `${city.toLowerCase()}|${country.toLowerCase()}|${hourKey}`;
    if (weatherCache.has(key)) {
      const cached = weatherCache.get(key);
      if (cached) {
        match.weather = cached;
        if (match.analysis?.factors) match.analysis.factors.weather = cached;
      }
      return cached;
    }
    try {
      let reqPromise = weatherInFlight.get(key);
      if (!reqPromise) {
        const url = `/api/weather?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&iso=${encodeURIComponent(match.isoDateTime || "")}`;
        reqPromise = fetch(url, { signal: AbortSignal.timeout(4500) })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            const val = data?.ok ? data : null;
            weatherCache.set(key, val);
            return val;
          })
          .catch(() => null)
          .finally(() => weatherInFlight.delete(key));
        weatherInFlight.set(key, reqPromise);
      }
      const data = await reqPromise;
      if (data?.ok) {
        match.weather = data;
        if (match.analysis?.factors) match.analysis.factors.weather = data;
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function hydrateWeatherForMatches(matches = []) {
    const seen = new Set();
    const targets = [];
    for (const m of matches || []) {
      if (!m || !m.venueCity || m.weather?.ok) continue;
      const idKey = m.espnId || m.id;
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      targets.push(m);
      if (targets.length >= 40) break;
    }
    if (!targets.length) return false;
    let changed = false;
    for (let i = 0; i < targets.length; i += 8) {
      const batch = targets.slice(i, i + 8);
      const res = await Promise.all(batch.map((m) => fetchMatchWeather(m)));
      if (res.some((w) => w?.ok)) changed = true;
    }
    return changed;
  }

  async function fetchJson(url, timeoutMs = 6500) {
    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let fetchTarget = url;
      if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http") && url.startsWith("https://site.api.espn.com")) {
        const espnPath = url.slice("https://site.api.espn.com".length);
        fetchTarget = `/api/espn?path=${encodeURIComponent(espnPath)}`;
      }
      const res = await fetch(fetchTarget, controller ? { signal: controller.signal } : undefined);
      if (timer) clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function yyyymmdd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseAmericanToDecimal(oddsVal) {
    if (oddsVal === null || oddsVal === undefined || oddsVal === "") return null;
    if (typeof oddsVal === "number") {
      if (oddsVal > 1 && oddsVal < 30 && !Number.isInteger(oddsVal)) return oddsVal;
    }
    const str = String(oddsVal).trim().toUpperCase();
    if (str === "EVEN" || str === "EV") return 2.0;
    const n = parseFloat(str.replace(/^\+/, ""));
    if (!Number.isFinite(n) || n === 0) return null;
    if (n > 0) return Math.round((1 + n / 100) * 100) / 100;
    return Math.round((1 + 100 / Math.abs(n)) * 100) / 100;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function inferEspnCode(ev, forcedCode = null) {
    if (forcedCode) return forcedCode;
    const slug = ev.season?.slug || "";
    for (const [re, code] of SEASON_PATTERNS) {
      if (re.test(slug)) return code;
    }
    return "all";
  }

  function mapLeagueMeta(espnCode, ev, scoreboardLeague = null) {
    const known = codeToMeta.get(espnCode);
    if (known) {
      const staticLg = leagueBySlug.get(known.slug);
      return {
        leagueSlug: known.slug,
        espnLeagueCode: espnCode,
        leagueName: staticLg?.name || scoreboardLeague?.name || known.name,
        leagueCountry: staticLg?.country || known.country,
        leagueLogo: scoreboardLeague?.logos?.[0]?.href || staticLg?.logo || "",
        priority: known.priority
      };
    }

    const rawSlug = ev.season?.slug || "";
    const cleanedName = rawSlug
      .replace(/^\d{4}-\d{2}-/, "")
      .replace(/^\d{4}-/, "")
      .replace(/---/g, " ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || scoreboardLeague?.name || "Global Football";

    const slugGuess = rawSlug.replace(/^\d{4}-\d{2}-/, "").replace(/^\d{4}-/, "") || `espn-${espnCode}`;
    const staticMatch = leagueBySlug.get(slugGuess);
    return {
      leagueSlug: staticMatch ? staticMatch.slug : slugGuess,
      espnLeagueCode: espnCode,
      leagueName: staticMatch?.name || scoreboardLeague?.name || cleanedName,
      leagueCountry: staticMatch?.country || "International",
      leagueLogo: scoreboardLeague?.logos?.[0]?.href || staticMatch?.logo || "",
      priority: 40
    };
  }

  function parseRecordStr(recSummary) {
    if (!recSummary || typeof recSummary !== "string") return { w: 4, d: 2, l: 3, mp: 9 };
    const parts = recSummary.split("-").map((x) => parseInt(x, 10));
    if (parts.length < 3 || parts.some(Number.isNaN)) return { w: 4, d: 2, l: 3, mp: 9 };
    // ESPN soccer record format is W-D-L (e.g., 6-1-2)
    return { w: parts[0], d: parts[1], l: parts[2], mp: parts[0] + parts[1] + parts[2] };
  }

  function parseFormArray(formStr) {
    if (!formStr || typeof formStr !== "string") return ["W", "D", "W", "L", "W"];
    const letters = formStr.toUpperCase().replace(/[^WDL]/g, "").split("").slice(-5);
    return letters.length > 0 ? letters : ["W", "D", "W", "L", "W"];
  }

  function ensureTeamObject(comp, leagueSlug) {
    const t = comp?.team || {};
    const id = String(t.id || comp?.id || Math.random().toString(36).slice(2, 8));
    const key = `espn-${id}`;
    const logo = t.logo || t.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
    const color = t.color ? `#${t.color.replace(/^#/, "")}` : "#0A7B5C";
    const teamObj = {
      key,
      espnId: id,
      name: t.displayName || t.shortDisplayName || t.name || "Club FC",
      short: t.abbreviation || (t.shortDisplayName || t.displayName || "FC").slice(0, 4).toUpperCase(),
      color,
      logo,
      league: leagueSlug,
      stadium: "",
      manager: ""
    };
    DATA.TEAMS[key] = { ...(DATA.TEAMS[key] || {}), ...teamObj };
    return key;
  }

  function formatLocalTime(isoStr) {
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return "TBD";
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function parseEvent(ev, forcedCode = null, scoreboardLeague = null) {
    const comp = ev.competitions?.[0];
    if (!comp || !comp.competitors || comp.competitors.length < 2) return null;

    const statusType = ev.status?.type || comp.status?.type || {};
    const rawState = statusType.state || "pre";
    const detail = statusType.shortDetail || statusType.detail || "Scheduled";

    // Filter out postponed/canceled/abandoned/unknown non-playable dead events
    if (/postponed|cancel|abandon|suspend|delay/i.test(detail)) return null;

    const matchDt = new Date(ev.date);
    const localDate = isoDate(matchDt);
    const todayStr = isoDate(new Date());

    // Strict real-time rule: no past dates before today!
    if (localDate < todayStr && rawState !== "in") return null;

    const espnCode = inferEspnCode(ev, forcedCode);
    const homeCompPre = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
    const awayCompPre = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
    const stHomePre = standingsByTeamId.get(String(homeCompPre?.team?.id));
    const stAwayPre = standingsByTeamId.get(String(awayCompPre?.team?.id));
    const resolvedCode = espnCode !== "all" ? espnCode : (stHomePre?.espnCode || stAwayPre?.espnCode || "all");
    const leagueMeta = mapLeagueMeta(resolvedCode, ev, scoreboardLeague);

    const homeComp = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
    const awayComp = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];

    const homeKey = ensureTeamObject(homeComp, leagueMeta.leagueSlug);
    const awayKey = ensureTeamObject(awayComp, leagueMeta.leagueSlug);
    if (comp.venue?.fullName && DATA.TEAMS[homeKey]) {
      DATA.TEAMS[homeKey].stadium = comp.venue.fullName;
    }

    const status = rawState === "in" ? "LIVE" : rawState === "post" ? "FT" : "SCHEDULED";
    const parsedMinute = rawState === "in"
      ? (/\b(HT|Half)\b/i.test(String(detail))
          ? 45
          : /^(FT|AET|PEN)/i.test(String(detail).trim())
            ? 90
            : (parseInt((String(detail).match(/(\d+)/) || [])[1], 10) || 45))
      : status === "FT"
        ? 90
        : null;

    const homeScore = rawState === "pre" ? null : parseInt(homeComp.score ?? "0", 10) || 0;
    const awayScore = rawState === "pre" ? null : parseInt(awayComp.score ?? "0", 10) || 0;

    // Extract DraftKings / ESPN real odds + open -> close/current Dropping Odds if provided
    const rawOdds = Array.isArray(comp.odds) ? comp.odds.find(Boolean) : null;
    const parseNodeOdd = (node) => {
      if (!node || !node.odds || String(node.odds).toUpperCase() === "OFF") return null;
      return parseAmericanToDecimal(node.odds);
    };
    const buildDropMove = (code, label, block) => {
      if (!block) return null;
      const openOdd = parseNodeOdd(block.open);
      const closeOdd = parseNodeOdd(block.close);
      const currOdd = parseNodeOdd(block.current);
      const latestOdd = currOdd || closeOdd || openOdd;
      if (!latestOdd) return null;
      if (!openOdd || Math.abs(openOdd - latestOdd) < 0.005) {
        return { code, label, openOdd: openOdd || latestOdd, currentOdd: latestOdd, dropPct: 0, impliedShiftPct: 0 };
      }
      const dropPct = Math.round(((openOdd - latestOdd) / openOdd) * 1000) / 10;
      const impliedShiftPct = Math.round(((1 / latestOdd - 1 / openOdd) * 100) * 10) / 10;
      return { code, label, openOdd, currentOdd: latestOdd, dropPct, impliedShiftPct };
    };

    const hMove = buildDropMove("HOME", `${DATA.TEAMS[homeKey]?.short || "HOME"} Win (1)`, rawOdds?.moneyline?.home);
    const dMove = buildDropMove("DRAW", "Draw (X)", rawOdds?.moneyline?.draw);
    const aMove = buildDropMove("AWAY", `${DATA.TEAMS[awayKey]?.short || "AWAY"} Win (2)`, rawOdds?.moneyline?.away);
    const overUnderLine = typeof rawOdds?.overUnder === "number" ? rawOdds.overUnder : 2.5;
    const oMove = buildDropMove("O25", `Over ${overUnderLine} Goals`, rawOdds?.total?.over);
    const uMove = buildDropMove("U25", `Under ${overUnderLine} Goals`, rawOdds?.total?.under);

    const allMoves = [hMove, dMove, aMove, oMove, uMove].filter(Boolean);
    const sortedDrops = [...allMoves].filter((m) => m.dropPct > 0).sort((a, b) => b.dropPct - a.dropPct);
    const droppingOdds = {
      provider: rawOdds?.provider?.name || (rawOdds ? "DraftKings" : "MAMON Market"),
      hasData: allMoves.some((m) => m.dropPct !== 0),
      hasDrop: sortedDrops.some((m) => m.dropPct >= 2.0),
      bestDrop: sortedDrops[0] || null,
      movesByCode: {
        HOME: hMove,
        DRAW: dMove,
        AWAY: aMove,
        O25: oMove,
        U25: uMove
      },
      allMoves
    };

    let homeOdd = hMove?.currentOdd || parseAmericanToDecimal(rawOdds?.moneyline?.home?.close?.odds ?? rawOdds?.moneyline?.home?.open?.odds);
    let drawOdd = dMove?.currentOdd || parseAmericanToDecimal(rawOdds?.moneyline?.draw?.close?.odds ?? rawOdds?.moneyline?.draw?.open?.odds);
    let awayOdd = aMove?.currentOdd || parseAmericanToDecimal(rawOdds?.moneyline?.away?.close?.odds ?? rawOdds?.moneyline?.away?.open?.odds);
    const overOddRaw = oMove?.currentOdd || parseAmericanToDecimal(rawOdds?.total?.over?.close?.odds);
    const underOddRaw = uMove?.currentOdd || parseAmericanToDecimal(rawOdds?.total?.under?.close?.odds);

    const homeForm = parseFormArray(homeComp.form);
    const awayForm = parseFormArray(awayComp.form);
    const homeRecord = parseRecordStr(homeComp.records?.[0]?.summary);
    const awayRecord = parseRecordStr(awayComp.records?.[0]?.summary);

    const stHome = standingsByTeamId.get(String(homeComp.team?.id));
    const stAway = standingsByTeamId.get(String(awayComp.team?.id));

    // Derive missing 1X2 odds coherently from standings PPG + form + home edge
    if (!homeOdd || !drawOdd || !awayOdd) {
      const hPpg = stHome?.mp ? stHome.pts / stHome.mp : (homeRecord.w * 3 + homeRecord.d) / Math.max(1, homeRecord.mp);
      const aPpg = stAway?.mp ? stAway.pts / stAway.mp : (awayRecord.w * 3 + awayRecord.d) / Math.max(1, awayRecord.mp);
      const diff = (hPpg + 0.25) - aPpg;
      const pHome = clamp(0.42 + diff * 0.16, 0.16, 0.78);
      const pDraw = clamp(0.28 - Math.abs(diff) * 0.04, 0.16, 0.31);
      const pAway = clamp(1 - pHome - pDraw, 0.10, 0.72);
      const sum = pHome + pDraw + pAway;
      homeOdd = Math.round((1.05 / (pHome / sum)) * 100) / 100;
      drawOdd = Math.round((1.05 / (pDraw / sum)) * 100) / 100;
      awayOdd = Math.round((1.05 / (pAway / sum)) * 100) / 100;
    }

    const impH = 1 / homeOdd;
    const impD = 1 / drawOdd;
    const impA = 1 / awayOdd;
    const impSum = impH + impD + impA;

    const match = {
      id: `espn-${ev.id}`,
      espnId: String(ev.id),
      espnLeagueCode: leagueMeta.espnLeagueCode,
      leagueSlug: leagueMeta.leagueSlug,
      leagueName: leagueMeta.leagueName,
      leagueCountry: leagueMeta.leagueCountry,
      leagueLogo: leagueMeta.leagueLogo,
      priority: leagueMeta.priority,
      date: localDate,
      isoDateTime: ev.date,
      status,
      minute: parsedMinute,
      displayTime: status === "LIVE" ? detail : status === "FT" ? "FT" : formatLocalTime(ev.date),
      home: homeKey,
      away: awayKey,
      homeEspnId: String(homeComp.team?.id || ""),
      awayEspnId: String(awayComp.team?.id || ""),
      homeScore,
      awayScore,
      homeRed: 0,
      awayRed: 0,
      homeForm,
      awayForm,
      homeRecord,
      awayRecord,
      venue: comp.venue?.fullName || DATA.TEAMS[homeKey]?.stadium || "Match Stadium",
      venueCity: comp.venue?.address?.city || "",
      venueCountry: comp.venue?.address?.country || "",
      weather: null,
      hasBookOdds: Boolean(rawOdds?.moneyline?.home?.close?.odds || rawOdds?.moneyline?.home?.open?.odds),
      droppingOdds,
      odds: {
        home: homeOdd,
        draw: drawOdd,
        away: awayOdd,
        overUnder: overUnderLine,
        overOdds: overOddRaw || null,
        underOdds: underOddRaw || null,
        provider: rawOdds?.provider?.name || (rawOdds ? "DraftKings" : "MAMON Quant Model")
      },
      communityVote: {
        home: Math.round((impH / impSum) * 100),
        draw: Math.round((impD / impSum) * 100),
        away: 100 - Math.round((impH / impSum) * 100) - Math.round((impD / impSum) * 100)
      },
      mustWatch: leagueMeta.priority <= 10 && rawState !== "post",
      mustWatchTag: status === "LIVE" ? "LIVE NOW" : leagueMeta.priority <= 6 ? "TOP CLASH" : "FEATURED",
      mustWatchReason: `${leagueMeta.name || leagueMeta.leagueName} · Real-time odds & 11-factor scouting`,
      events: [],
      stats: null,
      lineups: null,
      enriched: false,
      analysis: null
    };

    match.analysis = buildMatchAnalysis(match, null);
    return match;
  }

  function formPoints(formArr) {
    return (formArr || []).reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  }

  function factorial(n) {
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return f;
  }

  function poissonPmf(k, lambda) {
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  }

  function computePoissonProbs(lamH, lamA) {
    let pH = 0, pD = 0, pA = 0;
    let pO15 = 0, pO25 = 0, pO35 = 0, pBtts = 0;
    let pHomeToNil = 0, pAwayToNil = 0, pHomeO15 = 0, pAwayO15 = 0, pHomeO25 = 0, pAwayO25 = 0;
    let pHomeBtts = 0, pAwayBtts = 0;

    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        const p = poissonPmf(h, lamH) * poissonPmf(a, lamA);
        if (h > a) pH += p;
        else if (h === a) pD += p;
        else pA += p;

        if (h + a >= 2) pO15 += p;
        if (h + a >= 3) pO25 += p;
        if (h + a >= 4) pO35 += p;
        if (h >= 1 && a >= 1) pBtts += p;
        if (h > a && a === 0) pHomeToNil += p;
        if (a > h && h === 0) pAwayToNil += p;
        if (h > a && h + a >= 2) pHomeO15 += p;
        if (a > h && h + a >= 2) pAwayO15 += p;
        if (h > a && h + a >= 3) pHomeO25 += p;
        if (a > h && h + a >= 3) pAwayO25 += p;
        if (h > a && h >= 1 && a >= 1) pHomeBtts += p;
        if (a > h && h >= 1 && a >= 1) pAwayBtts += p;
      }
    }

    return {
      pH, pD, pA,
      p1X: pH + pD,
      pX2: pA + pD,
      p12: pH + pA,
      pO15, pU15: Math.max(0.05, 1 - pO15),
      pO25, pU25: Math.max(0.05, 1 - pO25),
      pO35, pU35: Math.max(0.05, 1 - pO35),
      pBtts, pBttsNo: Math.max(0.05, 1 - pBtts),
      pHomeToNil, pAwayToNil,
      pHomeO15, pAwayO15,
      pHomeO25, pAwayO25,
      pHomeBtts, pAwayBtts,
      pHtFtHH: pH * clamp(0.62 + (lamH - lamA) * 0.08, 0.45, 0.78),
      pHtFtAA: pA * clamp(0.60 + (lamA - lamH) * 0.08, 0.42, 0.76)
    };
  }

  function extractHomeAwaySplits(scheduleEvents, teamId, wantHomeAway) {
    if (!Array.isArray(scheduleEvents)) return null;
    const completed = scheduleEvents
      .filter((ev) => ev.competitions?.[0]?.status?.type?.state === "post")
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const venueGames = [];
    const allCompleted = [];
    for (const ev of completed) {
      const comp = ev.competitions[0];
      const comps = comp.competitors || [];
      const me = comps.find((c) => String(c.team?.id) === String(teamId));
      const opp = comps.find((c) => String(c.team?.id) !== String(teamId));
      if (!me || !opp) continue;
      const myGoals = parseInt(me.score?.displayValue ?? me.score ?? "0", 10) || 0;
      const oppGoals = parseInt(opp.score?.displayValue ?? opp.score ?? "0", 10) || 0;
      const result = myGoals > oppGoals ? "W" : myGoals === oppGoals ? "D" : "L";
      const item = {
        date: ev.date ? isoDate(new Date(ev.date)) : "",
        opponent: opp.team?.shortDisplayName || opp.team?.displayName || "Opponent",
        opponentAbbr: opp.team?.abbreviation || "OPP",
        homeAway: me.homeAway,
        myGoals,
        oppGoals,
        score: `${myGoals}-${oppGoals}`,
        result,
        cleanSheet: oppGoals === 0
      };
      allCompleted.push(item);
      if (me.homeAway === wantHomeAway) {
        venueGames.push(item);
      }
    }

    return { venueGames, allCompleted };
  }

  function extractUpcomingFixtures(fixtureEvents, matchDateIso, afterIsoDateTime) {
    if (!Array.isArray(fixtureEvents)) return [];
    const cutoff = afterIsoDateTime ? new Date(afterIsoDateTime).getTime() : Date.now();
    return fixtureEvents
      .filter((ev) => {
        const t = new Date(ev.date).getTime();
        const st = ev.competitions?.[0]?.status?.type?.state;
        return st === "pre" && t > cutoff + 3600 * 1000;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3)
      .map((ev) => ({
        date: ev.date ? isoDate(new Date(ev.date)) : "",
        name: ev.shortName || ev.name || "Next Fixture",
        league: ev.seasonType?.name || ""
      }));
  }

  function extractH2HFromSummary(sum, homeId, awayId) {
    const series = sum?.seasonseries?.[0];
    if (!series || !Array.isArray(series.events) || series.events.length === 0) return null;
    let homeWins = 0, draws = 0, awayWins = 0, totalGoals = 0, btts = 0;
    const recent = [];

    for (const ev of series.events.slice(0, 5)) {
      const comps = ev.competitors || [];
      const hTeam = comps.find((c) => String(c.team?.id) === String(homeId));
      const aTeam = comps.find((c) => String(c.team?.id) === String(awayId));
      if (!hTeam || !aTeam) continue;
      const hg = parseInt(hTeam.score?.displayValue ?? hTeam.score ?? "0", 10) || 0;
      const ag = parseInt(aTeam.score?.displayValue ?? aTeam.score ?? "0", 10) || 0;
      totalGoals += hg + ag;
      if (hg > 0 && ag > 0) btts += 1;
      if (hg > ag) homeWins += 1;
      else if (hg === ag) draws += 1;
      else awayWins += 1;

      const hostName = comps.find((c) => c.homeAway === "home")?.team?.abbreviation || "H";
      const guestName = comps.find((c) => c.homeAway === "away")?.team?.abbreviation || "A";
      const hostScore = comps.find((c) => c.homeAway === "home")?.score?.displayValue ?? comps.find((c) => c.homeAway === "home")?.score ?? 0;
      const guestScore = comps.find((c) => c.homeAway === "away")?.score?.displayValue ?? comps.find((c) => c.homeAway === "away")?.score ?? 0;
      recent.push({
        date: ev.date ? ev.date.slice(0, 10) : "",
        label: `${hostName} ${hostScore}-${guestScore} ${guestName}`
      });
    }

    if (recent.length === 0) return null;
    const avgGoals = totalGoals / recent.length;
    return {
      isLiveFeed: true,
      meetings: recent.length,
      homeWins,
      draws,
      awayWins,
      bttsRate: Math.round((btts / recent.length) * 100),
      avgGoals: Math.round(avgGoals * 100) / 100,
      summary: series.summary || `${homeWins}W-${draws}D-${awayWins}W (${recent.length} meetings)`,
      recent
    };
  }

  function extractRosterFlags(rosterJson) {
    const injuries = [];
    const cardRisks = [];
    const athletes = rosterJson?.athletes || [];
    for (const a of athletes) {
      const name = a.displayName || a.shortName;
      if (!name) continue;
      if (Array.isArray(a.injuries) && a.injuries.length > 0) {
        const inj = a.injuries[0];
        const statusStr = inj?.status || inj?.type?.description || "Injured";
        injuries.push(`${name} — ${statusStr}`);
      } else if (a.status?.type && !/active/i.test(a.status.type)) {
        injuries.push(`${name} (${a.status.name || a.status.type})`);
      }

      const genStats = (a.statistics?.splits?.categories || []).find((c) => c.name === "general")?.stats || [];
      const yc = Number(genStats.find((s) => s.name === "yellowCards")?.value || 0);
      const rc = Number(genStats.find((s) => s.name === "redCards")?.value || 0);
      if (rc > 0 || yc >= 4) {
        cardRisks.push({
          name,
          rc,
          yc,
          score: rc * 10 + yc,
          label: rc > 0 ? `${name} (${rc} Red, ${yc} YC)` : `${name} (${yc} YC · Ban risk)`
        });
      }
    }
    cardRisks.sort((a, b) => b.score - a.score);
    return { injuries: injuries.slice(0, 4), cardRisks: cardRisks.slice(0, 4) };
  }

  function matchesClubInText(txt, teamObj) {
    const low = String(txt || "").toLowerCase();
    const fullName = String(teamObj?.name || "").toLowerCase();
    if (fullName.length >= 4 && low.includes(fullName)) return true;
    const stop = new Set(["city", "united", "real", "club", "athletic", "atletico", "sporting", "inter", "town", "rovers", "albion"]);
    const tokens = fullName.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !stop.has(w));
    return tokens.some((w) => low.includes(w));
  }

  function scanInjuriesAndSuspensions(match, sum, homeRoster = null, awayRoster = null) {
    const homeTeam = DATA.TEAMS[match.home] || { name: "Home", short: "HOM" };
    const awayTeam = DATA.TEAMS[match.away] || { name: "Away", short: "AWY" };
    const leagueInj = injuriesByLeague.get(match.espnLeagueCode) || [];
    const leagueNews = newsByLeague.get(match.espnLeagueCode) || [];
    const sumNews = sum?.news?.articles || [];
    const allNews = [...sumNews, ...leagueNews];

    const homeInjuries = [];
    const awayInjuries = [];
    const homeSuspensions = [];
    const awaySuspensions = [];
    const pushUnique = (arr, item, cap = 4) => {
      if (item && !arr.includes(item) && arr.length < cap) arr.push(item);
    };

    // 1. Check ESPN League Injuries array if populated
    for (const entry of leagueInj) {
      const tid = String(entry.team?.id || "");
      const athleteName = entry.athlete?.displayName || entry.athlete?.shortName;
      if (!athleteName) continue;
      const statusText = `${entry.status || "Out"} (${entry.type?.description || entry.details?.type || "Injury"})`;
      if (tid === match.homeEspnId) pushUnique(homeInjuries, `${athleteName} — ${statusText}`);
      if (tid === match.awayEspnId) pushUnique(awayInjuries, `${athleteName} — ${statusText}`);
    }

    // 2. Scan full ESPN team rosters for injury/status & card accumulation / red card ban risk
    const homeFlags = homeRoster ? extractRosterFlags(homeRoster) : { injuries: [], cardRisks: [] };
    const awayFlags = awayRoster ? extractRosterFlags(awayRoster) : { injuries: [], cardRisks: [] };
    homeFlags.injuries.forEach((x) => pushUnique(homeInjuries, x));
    awayFlags.injuries.forEach((x) => pushUnique(awayInjuries, x));
    homeFlags.cardRisks.forEach((c) => pushUnique(homeSuspensions, c.label, 4));
    awayFlags.cardRisks.forEach((c) => pushUnique(awaySuspensions, c.label, 4));

    // 3. Scan rosters from match summary (inactive/unavailable when published)
    if (Array.isArray(sum?.rosters)) {
      for (const side of sum.rosters) {
        const isHomeSide = String(side.team?.id) === match.homeEspnId || side.homeAway === "home";
        const targetInj = isHomeSide ? homeInjuries : awayInjuries;
        const inactiveStarters = (side.roster || []).filter((p) => p.active === false && p.athlete?.displayName);
        for (const p of inactiveStarters.slice(0, 3)) {
          pushUnique(targetInj, `${p.athlete.displayName} (Inactive / Fitness watch)`);
        }
      }
    }

    // 4. Live match events Red Cards (exact player names!)
    for (const ev of match.events || []) {
      if (ev.type === "red") {
        const lbl = `${ev.player} (Live Red Card ${ev.min})`;
        if (ev.team === "home") pushUnique(homeSuspensions, lbl, 4);
        else pushUnique(awaySuspensions, lbl, 4);
      }
    }

    // 5. Standings season red cards
    const stH = standingsByTeamId.get(`${match.leagueSlug}:${match.homeEspnId}`) || standingsByTeamId.get(match.homeEspnId);
    const stA = standingsByTeamId.get(`${match.leagueSlug}:${match.awayEspnId}`) || standingsByTeamId.get(match.awayEspnId);

    // 6. Scan live news headlines for explicit injury/suspension mentions tied strictly to club name
    const injRe = /(injur|ruled out|sidelined|hamstring|knee|ankle|ACL|fitness doubt|miss the clash)/i;
    const suspRe = /(suspend|ban(?:ned)?|red card|sent off|sending off|disciplinary)/i;
    for (const art of allNews.slice(0, 20)) {
      const txt = `${art.headline || ""} ${art.description || ""}`;
      const mentionsHome = matchesClubInText(txt, homeTeam);
      const mentionsAway = matchesClubInText(txt, awayTeam);
      if (injRe.test(txt)) {
        if (mentionsHome) pushUnique(homeInjuries, art.headline.slice(0, 72), 3);
        if (mentionsAway) pushUnique(awayInjuries, art.headline.slice(0, 72), 3);
      }
      if (suspRe.test(txt)) {
        if (mentionsHome) pushUnique(homeSuspensions, art.headline.slice(0, 72), 3);
        if (mentionsAway) pushUnique(awaySuspensions, art.headline.slice(0, 72), 3);
      }
    }

    if (match.homeRed > 0 && homeSuspensions.length === 0) homeSuspensions.unshift(`${match.homeRed} live match red card(s)`);
    if (match.awayRed > 0 && awaySuspensions.length === 0) awaySuspensions.unshift(`${match.awayRed} live match red card(s)`);

    const hasAlert = Boolean(
      homeInjuries.length ||
      awayInjuries.length ||
      homeSuspensions.length ||
      awaySuspensions.length ||
      (stH?.rc ?? 0) > 0 ||
      (stA?.rc ?? 0) > 0
    );

    return {
      homeInjuries,
      awayInjuries,
      homeSuspensions,
      awaySuspensions,
      homeCardRisks: homeFlags.cardRisks,
      awayCardRisks: awayFlags.cardRisks,
      homeSeasonRedCards: stH?.rc ?? 0,
      awaySeasonRedCards: stA?.rc ?? 0,
      hasAlert
    };
  }

  function computeTeamStandingsCalc(match, side, stMe, stOpp) {
    const oppShort = side === "home"
      ? (DATA.TEAMS[match.away]?.short || "OPP")
      : (DATA.TEAMS[match.home]?.short || "OPP");
    const table = DATA.STANDINGS?.[match.leagueSlug];

    if (!Array.isArray(table) || table.length < 4 || !stMe) {
      return {
        hasTable: false,
        rank: null,
        totalTeams: null,
        pts: null,
        gd: null,
        gamesLeft: null,
        urgencyTier: "CUP",
        urgencyScore: 1,
        pointsNeeded: "Cup / Unranked Tie — Points & progression depend on today's direct result",
        drawImportance: side === "away"
          ? "Important Away Point: Keeps tie/group balance alive entering next fixture"
          : "Moderate — Home sides usually push for full 3 pts / win",
        lossEffect: `Defeat damages progression / seeding directly against ${oppShort}`
      };
    }

    const totalTeams = table.length;
    const seasonTotalMp = totalTeams >= 30 ? 8 : (totalTeams - 1) * 2;
    const gamesLeft = Math.max(0, seasonTotalMp - (stMe.mp || 0));
    const maxPossible = stMe.pts + gamesLeft * 3;
    const leader = table[0];
    const second = table[1];
    const uclLineIdx = totalTeams >= 30 ? 7 : Math.min(3, totalTeams - 1);
    const uclLine = table[uclLineIdx];
    const relStartIdx = totalTeams >= 14 ? totalTeams - 3 : Math.max(1, totalTeams - 2);
    const relCutoff = table[relStartIdx];
    const safetyRow = table[Math.max(0, relStartIdx - 1)];

    const gapToFirst = leader ? leader.pts - stMe.pts : 0;
    const leadOverSecond = stMe.rank === 1 && second ? stMe.pts - second.pts : 0;
    const gapToTopZone = uclLine ? uclLine.pts - stMe.pts : 0;
    const gapAboveRel = relCutoff ? stMe.pts - relCutoff.pts : 0;
    const gdStr = stMe.gd > 0 ? `+${stMe.gd}` : String(stMe.gd ?? 0);

    const lossThreatClubs = table.filter(
      (r) => r.pos > stMe.rank && (stMe.pts - r.pts) >= 0 && (stMe.pts - r.pts) <= 3
    );
    const winClimbClubs = table.filter(
      (r) => r.pos < stMe.rank && (r.pts - stMe.pts) >= 0 && (r.pts - stMe.pts) <= 3
    );

    let urgencyTier = "MID";
    let urgencyScore = 0;
    let pointsNeeded = "";

    if (stMe.rank === 1) {
      urgencyTier = "TITLE";
      urgencyScore = 3;
      pointsNeeded = `NEEDED (Protect #1): On ${stMe.pts} pts (${leadOverSecond > 0 ? `+${leadOverSecond} ahead of ${second?.customName || "#2"}` : "tied at the top"}) · ${gamesLeft} GP left`;
    } else if (gapToFirst > 0 && gapToFirst <= 6 && maxPossible >= (leader?.pts || 0)) {
      urgencyTier = "TITLE";
      urgencyScore = 3;
      pointsNeeded = `POINTS NEEDED (Title Chase): Only ${gapToFirst} pt(s) off #1 (${leader?.customName}) with ${gamesLeft} GP left`;
    } else if (stMe.rank >= relStartIdx + 1 || (gapAboveRel <= 4 && stMe.rank > uclLineIdx + 2)) {
      urgencyTier = "RELEGATION";
      urgencyScore = 3;
      const diffTxt = gapAboveRel <= 0 ? `${Math.abs((safetyRow?.pts || 0) - stMe.pts)} pts from safety` : `only +${gapAboveRel} pt(s) above bottom 3`;
      pointsNeeded = `SURVIVAL CRITICAL: #${stMe.rank} (${diffTxt}) — points urgently needed`;
    } else if (gapToTopZone > 0 && gapToTopZone <= 7) {
      urgencyTier = "EUROPE";
      urgencyScore = 2;
      pointsNeeded = `NEEDED (Top ${uclLineIdx + 1} Push): ${gapToTopZone} pt(s) off qualification (${uclLine?.pts} pts) with ${gamesLeft} GP left`;
    } else if (stMe.rank <= uclLineIdx + 1) {
      urgencyTier = "DEFEND_TOP";
      urgencyScore = 2;
      pointsNeeded = `IMPORTANT (#${stMe.rank} Spot): Defending Top ${uclLineIdx + 1} (+${Math.abs(gapToTopZone)} pt buffer, max ${maxPossible} pts)`;
    } else {
      urgencyTier = "COMFORTABLE";
      urgencyScore = 0;
      pointsNeeded = `LOWER URGENCY (#${stMe.rank}): Mid-table (+${gapAboveRel} safe above drop / ${gapToTopZone} pts behind Top ${uclLineIdx + 1})`;
    }

    let drawImportance = "";
    const vsCloseRival = stOpp && Math.abs(stMe.pts - stOpp.pts) <= 3;
    if (side === "away" && (urgencyTier === "TITLE" || urgencyTier === "DEFEND_TOP" || vsCloseRival || lossThreatClubs.length >= 1)) {
      const cushion = lossThreatClubs[0] ? stMe.pts - lossThreatClubs[0].pts : leadOverSecond;
      drawImportance = `IMPORTANT (Away): 1 pt protects +${Math.max(0, cushion)} pt cushion${vsCloseRival ? ` & blocks direct rival ${oppShort}` : ""}`;
    } else if (urgencyTier === "RELEGATION") {
      drawImportance = "Helpful but 3 pts Better: 1 pt nudges survival tally, win needed to escape drop zone";
    } else if ((urgencyTier === "TITLE" || urgencyTier === "EUROPE") && side === "home") {
      drawImportance = `NOT ENOUGH at Home: Drawing costs 2 pts in ${urgencyTier === "TITLE" ? "title race" : `Top-${uclLineIdx + 1} hunt`} (${gapToFirst > 0 ? `${gapToFirst} behind #1` : `+${leadOverSecond} lead`})`;
    } else if (vsCloseRival) {
      drawImportance = `Important 6-Pointer: Sharing 1 pt keeps ${oppShort} (${stOpp.pts} pts) from swinging a 3-pt gap`;
    } else {
      drawImportance = `Routine Value: 1 pt keeps steady pace (${gamesLeft} matches left)`;
    }

    let lossEffect = "";
    if (lossThreatClubs.length > 0) {
      const chasers = lossThreatClubs.slice(0, 2).map((c) => `${c.customName} (${c.pts})`).join(" & ");
      const dropPos = Math.min(totalTeams, stMe.rank + lossThreatClubs.length);
      lossEffect = `YES — HIGH STANDINGS RISK: Frozen at ${stMe.pts} pts; loss lets ${chasers} overtake (could drop #${stMe.rank} -> #${dropPos})`;
    } else if (stMe.rank === 1) {
      lossEffect = `Points Lead Hit: Stays #1 (+${leadOverSecond} pts ahead), but ${second?.customName || "#2"} closes gap`;
    } else if (stMe.rank >= relStartIdx) {
      lossEffect = `SEVERE DAMAGE: Zero pts keeps club stuck in relegation fight (#${stMe.rank}, ${stMe.pts} pts, ${gdStr} GD)`;
    } else {
      const nextTarget = winClimbClubs[0]?.customName;
      lossEffect = `Points Freeze (#${stMe.rank}): Zero pts gained${nextTarget ? ` — misses passing ${nextTarget}` : ""}; buffer shrinks to +${gapAboveRel}`;
    }

    return {
      hasTable: true,
      rank: stMe.rank,
      totalTeams,
      pts: stMe.pts,
      gd: stMe.gd,
      gdStr,
      gamesLeft,
      maxPossible,
      gapToFirst,
      gapToTopZone,
      gapAboveRel,
      lossThreatCount: lossThreatClubs.length,
      winClimbCount: winClimbClubs.length,
      urgencyTier,
      urgencyScore,
      pointsNeeded,
      drawImportance,
      lossEffect
    };
  }

  function buildMatchAnalysis(match, sum = null, homeSched = null, awaySched = null, homeRoster = null, awayRoster = null) {
    const homeTeam = DATA.TEAMS[match.home] || { name: "Home", short: "HOM" };
    const awayTeam = DATA.TEAMS[match.away] || { name: "Away", short: "AWY" };
    const stH = standingsByTeamId.get(`${match.leagueSlug}:${match.homeEspnId}`) || standingsByTeamId.get(match.homeEspnId);
    const stA = standingsByTeamId.get(`${match.leagueSlug}:${match.awayEspnId}`) || standingsByTeamId.get(match.awayEspnId);

    // 1. Head-to-Head
    const liveH2h = sum ? extractH2HFromSummary(sum, match.homeEspnId, match.awayEspnId) : null;
    const h2h = liveH2h || {
      isLiveFeed: false,
      meetings: 0,
      homeWins: stH && stA && stH.rank < stA.rank ? 2 : 1,
      draws: 1,
      awayWins: stH && stA && stA.rank < stH.rank ? 2 : 1,
      bttsRate: 54,
      avgGoals: 2.55,
      summary: "Pending live H2H summary hydration (or tap Analyze to fetch full H2H)",
      recent: []
    };

    // 2. Current Form (Overall Last 5 + Record)
    let homeLast5 = match.homeForm || ["W", "D", "W", "L", "W"];
    let awayLast5 = match.awayForm || ["D", "W", "L", "W", "D"];
    let homeLast5Games = [];
    let awayLast5Games = [];

    if (sum?.lastFiveGames?.length >= 2) {
      const l5Home = sum.lastFiveGames.find((x) => String(x.team?.id) === match.homeEspnId) || sum.lastFiveGames[0];
      const l5Away = sum.lastFiveGames.find((x) => String(x.team?.id) === match.awayEspnId) || sum.lastFiveGames[1];
      if (l5Home?.events?.length) {
        homeLast5Games = l5Home.events.slice(0, 5).map((e) => ({
          result: e.gameResult || "D",
          score: e.score || "-",
          opponent: e.opponent?.shortDisplayName || e.opponent?.abbreviation || "OPP",
          atVs: e.atVs || "vs"
        }));
        homeLast5 = homeLast5Games.map((x) => x.result).reverse();
      }
      if (l5Away?.events?.length) {
        awayLast5Games = l5Away.events.slice(0, 5).map((e) => ({
          result: e.gameResult || "D",
          score: e.score || "-",
          opponent: e.opponent?.shortDisplayName || e.opponent?.abbreviation || "OPP",
          atVs: e.atVs || "vs"
        }));
        awayLast5 = awayLast5Games.map((x) => x.result).reverse();
      }
    }

    const homeFormPts = formPoints(homeLast5);
    const awayFormPts = formPoints(awayLast5);

    // 5 & 6: Last 5 HOME games for Home team & Last 5 AWAY games for Away team
    const homeSplit = homeSched?.past ? extractHomeAwaySplits(homeSched.past, match.homeEspnId, "home") : null;
    const awaySplit = awaySched?.past ? extractHomeAwaySplits(awaySched.past, match.awayEspnId, "away") : null;

    const home5AtHome = homeSplit?.venueGames?.slice(0, 5) || null;
    const away5AtAway = awaySplit?.venueGames?.slice(0, 5) || null;

    // Fallback venue estimates calibrated to team record & standings until schedule hydrates
    const hMp = stH?.mp || Math.max(1, match.homeRecord?.mp || 8);
    const aMp = stA?.mp || Math.max(1, match.awayRecord?.mp || 8);
    const hPpg = stH ? stH.pts / Math.max(1, stH.mp) : (match.homeRecord.w * 3 + match.homeRecord.d) / Math.max(1, match.homeRecord.mp);
    const aPpg = stA ? stA.pts / Math.max(1, stA.mp) : (match.awayRecord.w * 3 + match.awayRecord.d) / Math.max(1, match.awayRecord.mp);

    const home5Summary = home5AtHome && home5AtHome.length > 0
      ? {
          isLiveFeed: true,
          games: home5AtHome,
          wins: home5AtHome.filter((g) => g.result === "W").length,
          draws: home5AtHome.filter((g) => g.result === "D").length,
          losses: home5AtHome.filter((g) => g.result === "L").length,
          gf: home5AtHome.reduce((s, g) => s + g.myGoals, 0),
          ga: home5AtHome.reduce((s, g) => s + g.oppGoals, 0),
          cs: home5AtHome.filter((g) => g.cleanSheet).length
        }
      : {
          isLiveFeed: false,
          games: homeLast5.slice(-5).map((r) => ({ result: r, score: r === "W" ? "2-1" : r === "D" ? "1-1" : "0-1", opponent: "Home Split Est." })),
          wins: Math.min(5, homeLast5.filter((r) => r === "W").length + (hPpg > 1.7 ? 1 : 0)),
          draws: homeLast5.filter((r) => r === "D").length,
          losses: Math.max(0, homeLast5.filter((r) => r === "L").length - (hPpg > 1.7 ? 1 : 0)),
          gf: null,
          ga: null,
          cs: null
        };

    const away5Summary = away5AtAway && away5AtAway.length > 0
      ? {
          isLiveFeed: true,
          games: away5AtAway,
          wins: away5AtAway.filter((g) => g.result === "W").length,
          draws: away5AtAway.filter((g) => g.result === "D").length,
          losses: away5AtAway.filter((g) => g.result === "L").length,
          gf: away5AtAway.reduce((s, g) => s + g.myGoals, 0),
          ga: away5AtAway.reduce((s, g) => s + g.oppGoals, 0),
          cs: away5AtAway.filter((g) => g.cleanSheet).length
        }
      : {
          isLiveFeed: false,
          games: awayLast5.slice(-5).map((r) => ({ result: r, score: r === "W" ? "1-0" : r === "D" ? "1-1" : "1-2", opponent: "Away Split Est." })),
          wins: awayLast5.filter((r) => r === "W").length,
          draws: awayLast5.filter((r) => r === "D").length,
          losses: awayLast5.filter((r) => r === "L").length,
          gf: null,
          ga: null,
          cs: null
        };

    // 7 & 8: Goals Scored & Goals Conceded
    const hGfTotal = stH?.gf ?? Math.round((homeLast5.reduce((s, r) => s + (r === "W" ? 2.1 : r === "D" ? 1.1 : 0.6), 0) / 5) * hMp);
    const hGaTotal = stH?.ga ?? Math.round((homeLast5.reduce((s, r) => s + (r === "W" ? 0.8 : r === "D" ? 1.1 : 1.9), 0) / 5) * hMp);
    const aGfTotal = stA?.gf ?? Math.round((awayLast5.reduce((s, r) => s + (r === "W" ? 1.9 : r === "D" ? 1.0 : 0.6), 0) / 5) * aMp);
    const aGaTotal = stA?.ga ?? Math.round((awayLast5.reduce((s, r) => s + (r === "W" ? 0.9 : r === "D" ? 1.1 : 1.9), 0) / 5) * aMp);

    const hGfAvg = Math.round((hGfTotal / Math.max(1, hMp)) * 100) / 100;
    const hGaAvg = Math.round((hGaTotal / Math.max(1, hMp)) * 100) / 100;
    const aGfAvg = Math.round((aGfTotal / Math.max(1, aMp)) * 100) / 100;
    const aGaAvg = Math.round((aGaTotal / Math.max(1, aMp)) * 100) / 100;

    // 9 & 10: Clean Sheets Kept for Home Games (Home team) & Clean Sheets Kept for Away Games (Away team)
    const homeCsCount = home5Summary.cs !== null
      ? home5Summary.cs
      : clamp(Math.round((1.5 - hGaAvg) * 3.1), 0, 5);
    const homeCsSample = home5Summary.isLiveFeed ? Math.max(1, home5Summary.games.length) : 5;
    const homeCsPct = Math.round((homeCsCount / homeCsSample) * 100);

    const awayCsCount = away5Summary.cs !== null
      ? away5Summary.cs
      : clamp(Math.round((1.35 - aGaAvg) * 2.6), 0, 5);
    const awayCsSample = away5Summary.isLiveFeed ? Math.max(1, away5Summary.games.length) : 5;
    const awayCsPct = Math.round((awayCsCount / awayCsSample) * 100);

    // 3 & 4: Injuries & Suspensions
    const squadReport = scanInjuriesAndSuspensions(match, sum, homeRoster, awayRoster);

    // PPG (Points Per Game: Overall + Venue Home/Away splits)
    const calcPpg = (gamesArr) => {
      if (!gamesArr || gamesArr.length === 0) return null;
      const p = gamesArr.reduce((s, g) => s + (g.result === "W" ? 3 : g.result === "D" ? 1 : 0), 0);
      return Math.round((p / gamesArr.length) * 100) / 100;
    };
    const homeOverallPpg = Math.round(hPpg * 100) / 100;
    const awayOverallPpg = Math.round(aPpg * 100) / 100;
    const homeHomePpg = home5Summary.isLiveFeed && home5Summary.games.length
      ? calcPpg(homeSplit.venueGames)
      : Math.round(clamp(hPpg + 0.22, 0.2, 3.0) * 100) / 100;
    const awayAwayPpg = away5Summary.isLiveFeed && away5Summary.games.length
      ? calcPpg(awaySplit.venueGames)
      : Math.round(clamp(aPpg - 0.14, 0.15, 2.8) * 100) / 100;
    const ppgGap = Math.round(Math.abs(homeOverallPpg - awayOverallPpg) * 100) / 100;

    match.ppgSummary = {
      homeOverall: homeOverallPpg,
      awayOverall: awayOverallPpg,
      homeVenue: homeHomePpg,
      awayVenue: awayAwayPpg,
      gap: ppgGap,
      edge: homeOverallPpg >= awayOverallPpg ? homeTeam.short : awayTeam.short
    };

    // 11: Run-in Analysis for Both Teams
    const homeUpcoming = homeSched?.upcoming ? extractUpcomingFixtures(homeSched.upcoming, match.date, match.isoDateTime) : [];
    const awayUpcoming = awaySched?.upcoming ? extractUpcomingFixtures(awaySched.upcoming, match.date, match.isoDateTime) : [];

    let homeRestDays = null;
    let awayRestDays = null;
    const koTs = new Date(match.isoDateTime || Date.now()).getTime();
    if (homeSplit?.allCompleted?.[0]?.date) {
      homeRestDays = Math.max(2, Math.round((koTs - new Date(homeSplit.allCompleted[0].date).getTime()) / 86400000));
    }
    if (awaySplit?.allCompleted?.[0]?.date) {
      awayRestDays = Math.max(2, Math.round((koTs - new Date(awaySplit.allCompleted[0].date).getTime()) / 86400000));
    }

    const stakeLabel = (st) => {
      if (!st) return "League Points Battle";
      if (st.rank <= 2) return `#${st.rank} Title Pace (${st.pts} pts)`;
      if (st.rank <= 5) return `#${st.rank} Continental Race (${st.pts} pts)`;
      if (st.rank >= 16) return `#${st.rank} Relegation Pressure (${st.pts} pts)`;
      return `#${st.rank} Mid-Table Push (${st.pts} pts)`;
    };

    const runInEdge = homeRestDays && awayRestDays && homeRestDays - awayRestDays >= 2
      ? `${homeTeam.short} Fresher (+${homeRestDays - awayRestDays}d rest)`
      : homeRestDays && awayRestDays && awayRestDays - homeRestDays >= 2
        ? `${awayTeam.short} Fresher (+${awayRestDays - homeRestDays}d rest)`
        : (stH?.rank || 8) < (stA?.rank || 10)
          ? `${homeTeam.short} Higher Stakes / Home Edge`
          : `${awayTeam.short} Competitive Run-in`;

    // Blend Poisson Expected Goals (lambdaH, lambdaA) across all 11 factors + market odds anchor
    const homeAttack = home5Summary.isLiveFeed && home5Summary.games.length >= 2
      ? (hGfAvg * 0.55 + (home5Summary.gf / home5Summary.games.length) * 0.45)
      : hGfAvg;
    const awayDefense = away5Summary.isLiveFeed && away5Summary.games.length >= 2
      ? (aGaAvg * 0.55 + (away5Summary.ga / away5Summary.games.length) * 0.45)
      : aGaAvg;
    const awayAttack = away5Summary.isLiveFeed && away5Summary.games.length >= 2
      ? (aGfAvg * 0.55 + (away5Summary.gf / away5Summary.games.length) * 0.45)
      : aGfAvg;
    const homeDefense = home5Summary.isLiveFeed && home5Summary.games.length >= 2
      ? (hGaAvg * 0.55 + (home5Summary.ga / home5Summary.games.length) * 0.45)
      : hGaAvg;

    let lamH = ((homeAttack + awayDefense) / 2) * 1.12;
    let lamA = ((awayAttack + homeDefense) / 2) * 0.94;

    // Form, Clean sheet, Injury/Suspension, H2H, Rest adjustments
    lamH += (homeFormPts - awayFormPts) * 0.025;
    lamA += (awayFormPts - homeFormPts) * 0.020;
    lamA *= (1 - (homeCsPct / 100) * 0.14);
    lamH *= (1 - (awayCsPct / 100) * 0.12);
    if (liveH2h) {
      lamH += (liveH2h.homeWins - liveH2h.awayWins) * 0.06;
      lamA += (liveH2h.awayWins - liveH2h.homeWins) * 0.05;
    }
    lamH -= Math.min(0.32, (squadReport.homeInjuries.length * 0.07 + squadReport.homeSuspensions.length * 0.12));
    lamA -= Math.min(0.32, (squadReport.awayInjuries.length * 0.07 + squadReport.awaySuspensions.length * 0.12));

    // Market anchor using real 1X2 implied strength + sharp dropping odds steam
    const impH = 1 / (match.odds?.home || 2.1);
    const impA = 1 / (match.odds?.away || 3.4);
    const mktDelta = (impH - impA) * 0.85;
    lamH = clamp(lamH + mktDelta * 0.45, 0.55, 3.25);
    lamA = clamp(lamA - mktDelta * 0.40, 0.40, 2.85);

    const bestDrop = match.droppingOdds?.bestDrop;
    if (bestDrop && bestDrop.dropPct >= 4) {
      const steamBoost = clamp(bestDrop.dropPct * 0.009, 0.03, 0.16);
      if (bestDrop.code === "HOME") lamH = clamp(lamH + steamBoost, 0.55, 3.35);
      if (bestDrop.code === "AWAY") lamA = clamp(lamA + steamBoost, 0.40, 2.95);
      if (bestDrop.code === "O25") {
        lamH = clamp(lamH + steamBoost * 0.6, 0.55, 3.35);
        lamA = clamp(lamA + steamBoost * 0.6, 0.40, 2.95);
      }
    }

    if (match.weather?.ok && typeof match.weather.modifier === "number" && match.weather.modifier < 0) {
      const dampen = 1 + match.weather.modifier;
      lamH = clamp(lamH * dampen, 0.50, 3.25);
      lamA = clamp(lamA * dampen, 0.35, 2.85);
    }

    // Account for in-play elapsed time & score if LIVE
    let probs = computePoissonProbs(lamH, lamA);
    if (match.status === "LIVE") {
      const remFrac = clamp((90 - (match.minute || 30)) / 90, 0.12, 0.95);
      const curH = match.homeScore || 0;
      const curA = match.awayScore || 0;
      const remProbs = computePoissonProbs(lamH * remFrac, lamA * remFrac);
      // Simple exact remaining score convolution for live adjustments
      const remLamH = lamH * remFrac;
      const remLamA = lamA * remFrac;
      let pH = 0, pD = 0, pA = 0, pO15 = 0, pO25 = 0, pO35 = 0, pBtts = 0;
      for (let dh = 0; dh <= 5; dh++) {
        for (let da = 0; da <= 5; da++) {
          const p = poissonPmf(dh, remLamH) * poissonPmf(da, remLamA);
          const fh = curH + dh, fa = curA + da;
          if (fh > fa) pH += p; else if (fh === fa) pD += p; else pA += p;
          if (fh + fa >= 2) pO15 += p;
          if (fh + fa >= 3) pO25 += p;
          if (fh + fa >= 4) pO35 += p;
          if (fh >= 1 && fa >= 1) pBtts += p;
        }
      }
      probs = {
        ...remProbs,
        pH, pD, pA,
        p1X: pH + pD,
        pX2: pA + pD,
        p12: pH + pA,
        pO15, pU15: 1 - pO15,
        pO25, pU25: 1 - pO25,
        pO35, pU35: 1 - pO35,
        pBtts, pBttsNo: 1 - pBtts
      };
    }

    // Generate rated betting market candidates for Sure Odds engine
    const marketOdds = (prob, floor = 1.12, cap = 9.5) => {
      const fair = 1 / clamp(prob, 0.08, 0.94);
      const book = fair * 0.94;
      return Math.round(clamp(book, floor, cap) * 100) / 100;
    };

    const hOddReal = match.odds?.home || marketOdds(probs.pH, 1.18, 8.0);
    const aOddReal = match.odds?.away || marketOdds(probs.pA, 1.18, 9.5);
    const dOddReal = match.odds?.draw || marketOdds(probs.pD, 2.75, 6.5);

    const markets = [
      {
        code: "1X",
        label: `${homeTeam.short} or Draw (1X)`,
        prob: probs.p1X,
        odds: marketOdds(probs.p1X, 1.12, 2.4),
        riskTier: "SAFE",
        reason: `${homeTeam.short} ${home5Summary.wins}W-${home5Summary.draws}D at home · ${homeCsPct}% home clean sheets`
      },
      {
        code: "X2",
        label: `Draw or ${awayTeam.short} (X2)`,
        prob: probs.pX2,
        odds: marketOdds(probs.pX2, 1.14, 2.6),
        riskTier: "SAFE",
        reason: `${awayTeam.short} form ${awayLast5.join("")} (${awayFormPts}/15 pts) · ${aGfAvg} GF/g away readiness`
      },
      {
        code: "O15",
        label: "Over 1.5 Goals",
        prob: probs.pO15,
        odds: marketOdds(probs.pO15, 1.15, 1.85),
        riskTier: "SAFE",
        reason: `Combined xG ${(lamH + lamA).toFixed(2)} · H2H avg ${h2h.avgGoals} goals · Attack ${(hGfAvg + aGfAvg).toFixed(2)} avg`
      },
      {
        code: "HOME",
        label: `${homeTeam.name} Win (1)`,
        prob: probs.pH,
        odds: hOddReal,
        riskTier: "CORE",
        reason: `${homeTeam.short} leads form (${homeFormPts} vs ${awayFormPts} pts), ${home5Summary.wins}W in home last 5`
      },
      {
        code: "AWAY",
        label: `${awayTeam.name} Win (2)`,
        prob: probs.pA,
        odds: aOddReal,
        riskTier: "CORE",
        reason: `${awayTeam.short} scoring ${aGfAvg}/g · Run-in edge & away momentum (${awayFormPts}/15 pts)`
      },
      {
        code: "DRAW",
        label: "Match Draw (X)",
        prob: probs.pD,
        odds: dOddReal,
        riskTier: "VALUE",
        reason: `Tight parity (${hGfAvg} vs ${aGfAvg} GF/g) · H2H draws: ${h2h.draws}`
      },
      {
        code: "O25",
        label: "Over 2.5 Goals",
        prob: probs.pO25,
        odds: match.odds?.overOdds || marketOdds(probs.pO25, 1.48, 2.85),
        riskTier: "CORE",
        reason: `Expected total ${(lamH + lamA).toFixed(2)} goals · ${homeTeam.short} ${hGfAvg} GF/g vs ${awayTeam.short} ${aGaAvg} GA/g`
      },
      {
        code: "BTTS",
        label: "Both Teams To Score (GG)",
        prob: probs.pBtts,
        odds: marketOdds(probs.pBtts, 1.50, 2.75),
        riskTier: "CORE",
        reason: `Home CS ${homeCsPct}% / Away CS ${awayCsPct}% · Both avg ${(hGfAvg + aGfAvg).toFixed(2)} GF`
      },
      {
        code: "U35",
        label: "Under 3.5 Goals",
        prob: probs.pU35,
        odds: marketOdds(probs.pU35, 1.18, 1.75),
        riskTier: "SAFE",
        reason: `Disciplined back lines (${homeCsPct}% home CS / ${awayCsPct}% away CS) & low total ${(lamH + lamA).toFixed(2)} xG`
      },
      {
        code: "H_O15",
        label: `${homeTeam.short} Win & Over 1.5`,
        prob: probs.pHomeO15,
        odds: marketOdds(probs.pHomeO15, 1.65, 4.20),
        riskTier: "VALUE",
        reason: `${homeTeam.short} dominant home record (${home5Summary.wins}W in 5) with ${(lamH + lamA).toFixed(2)} xG`
      },
      {
        code: "A_O15",
        label: `${awayTeam.short} Win & Over 1.5`,
        prob: probs.pAwayO15,
        odds: marketOdds(probs.pAwayO15, 1.85, 5.20),
        riskTier: "VALUE",
        reason: `${awayTeam.short} away attacking edge (${aGfAvg} GF/g) against ${hGaAvg} GA/g defense`
      },
      {
        code: "H_NIL",
        label: `${homeTeam.short} Win to Nil (CS)`,
        prob: probs.pHomeToNil,
        odds: marketOdds(probs.pHomeToNil, 2.25, 6.00),
        riskTier: "HIGH",
        reason: `${homeTeam.short} kept ${homeCsPct}% clean sheets in home games vs ${awayTeam.short} ${aGfAvg} GF/g`
      },
      {
        code: "HTFT_H",
        label: `HT/FT: ${homeTeam.short} / ${homeTeam.short}`,
        prob: probs.pHtFtHH,
        odds: marketOdds(probs.pHtFtHH, 2.15, 5.50),
        riskTier: "HIGH",
        reason: `Strong early pressure at ${match.venue || "home"} (${homeTeam.short} ${(probs.pH * 100).toFixed(0)}% win prob)`
      },
      {
        code: "H_BTTS",
        label: `${homeTeam.short} Win & BTTS Yes`,
        prob: probs.pHomeBtts,
        odds: marketOdds(probs.pHomeBtts, 2.85, 6.20),
        riskTier: "HIGH",
        reason: `${homeTeam.short} wins on attack (${hGfAvg} GF/g) while ${awayTeam.short} threatens (${aGfAvg} GF/g)`
      },
      {
        code: "A_BTTS",
        label: `${awayTeam.short} Win & BTTS Yes`,
        prob: probs.pAwayBtts,
        odds: marketOdds(probs.pAwayBtts, 3.20, 7.50),
        riskTier: "HIGH",
        reason: `High-tempo transition clash (${(lamH + lamA).toFixed(2)} total xG)`
      }
    ].filter((mkt) => Number.isFinite(mkt.odds) && mkt.odds >= 1.12);

    const movesMap = match.droppingOdds?.movesByCode || {};
    markets.forEach((mkt) => {
      const mv = movesMap[mkt.code];
      if (mv && mv.dropPct > 0) {
        mkt.dropPct = mv.dropPct;
        mkt.openOdd = mv.openOdd;
      }
    });

    // Best primary recommendation
    const sortedCore = [...markets]
      .filter((x) => ["1X", "X2", "O15", "HOME", "AWAY", "BTTS", "O25", "H_O15"].includes(x.code))
      .sort((a, b) => {
        const dropBoostA = (a.dropPct || 0) >= 3 ? 0.04 : 0;
        const dropBoostB = (b.dropPct || 0) >= 3 ? 0.04 : 0;
        return (b.prob * 0.78 + (1 / b.odds) * 0.22 + dropBoostB) - (a.prob * 0.78 + (1 / a.odds) * 0.22 + dropBoostA);
      });

    const bestPick = sortedCore[0] || markets[0];
    const modelConfPct = Math.round(clamp(bestPick.prob * 100, 48, 92));
    const calcHome = computeTeamStandingsCalc(match, "home", stH, stA);
    const calcAway = computeTeamStandingsCalc(match, "away", stA, stH);

    // Return full structured multi-factor object
    return {
      isLiveHydrated: Boolean(sum || homeSched || awaySched),
      expectedGoals: { home: Math.round(lamH * 100) / 100, away: Math.round(lamA * 100) / 100 },
      confidencePct: modelConfPct,
      probs: {
        pH: probs.pH,
        pD: probs.pD,
        pA: probs.pA,
        p1X: probs.p1X,
        pX2: probs.pX2,
        pO15: probs.pO15,
        pO25: probs.pO25,
        pBtts: probs.pBtts
      },
      bestPick,
      markets,
      factors: {
        // 1. Head to Head
        h2h,
        // 2. Current Form
        currentForm: {
          homeForm: homeLast5,
          awayForm: awayLast5,
          homePts: homeFormPts,
          awayPts: awayFormPts,
          homeRecord: stH ? `${stH.w}-${stH.d}-${stH.l}` : `${match.homeRecord.w}-${match.homeRecord.d}-${match.homeRecord.l}`,
          awayRecord: stA ? `${stA.w}-${stA.d}-${stA.l}` : `${match.awayRecord.w}-${match.awayRecord.d}-${match.awayRecord.l}`,
          homeLast5Games,
          awayLast5Games,
          edge: homeFormPts >= awayFormPts ? homeTeam.short : awayTeam.short
        },
        // 3. Injuries
        injuries: {
          home: squadReport.homeInjuries,
          away: squadReport.awayInjuries,
          statusTextHome: squadReport.homeInjuries.length ? `${squadReport.homeInjuries.length} flagged` : "0 reported in feed",
          statusTextAway: squadReport.awayInjuries.length ? `${squadReport.awayInjuries.length} flagged` : "0 reported in feed",
          edge: squadReport.homeInjuries.length <= squadReport.awayInjuries.length ? homeTeam.short : awayTeam.short
        },
        // 4. Suspensions
        suspensions: {
          home: squadReport.homeSuspensions,
          away: squadReport.awaySuspensions,
          homeCardRisks: squadReport.homeCardRisks,
          awayCardRisks: squadReport.awayCardRisks,
          homeRedSeason: squadReport.homeSeasonRedCards,
          awayRedSeason: squadReport.awaySeasonRedCards,
          hasAlert: squadReport.hasAlert,
          statusTextHome: squadReport.homeSuspensions.length ? squadReport.homeSuspensions.slice(0, 2).join(" · ") : `Clean (${squadReport.homeSeasonRedCards} season RC)`,
          statusTextAway: squadReport.awaySuspensions.length ? squadReport.awaySuspensions.slice(0, 2).join(" · ") : `Clean (${squadReport.awaySeasonRedCards} season RC)`
        },
        // 5. Last 5 Games for Home Games (Home team at home)
        last5HomeGames: home5Summary,
        // 6. Last 5 Games for Away Games (Away team away)
        last5AwayGames: away5Summary,
        // 7. Goals Scored
        goalsScored: {
          homeTotal: hGfTotal,
          homeAvg: hGfAvg,
          awayTotal: aGfTotal,
          awayAvg: aGfAvg,
          edge: hGfAvg >= aGfAvg ? homeTeam.short : awayTeam.short
        },
        // 8. Goals Conceded
        goalsConceded: {
          homeTotal: hGaTotal,
          homeAvg: hGaAvg,
          awayTotal: aGaTotal,
          awayAvg: aGaAvg,
          edge: hGaAvg <= aGaAvg ? homeTeam.short : awayTeam.short
        },
        // 9. Clean Sheets Kept for Home Games
        cleanSheetsHome: {
          count: homeCsCount,
          sample: homeCsSample,
          pct: homeCsPct,
          label: `${homeCsCount}/${homeCsSample} home games (${homeCsPct}%)`,
          isLiveFeed: home5Summary.isLiveFeed
        },
        // 10. Clean Sheets Kept for Away Games
        cleanSheetsAway: {
          count: awayCsCount,
          sample: awayCsSample,
          pct: awayCsPct,
          label: `${awayCsCount}/${awayCsSample} away games (${awayCsPct}%)`,
          isLiveFeed: away5Summary.isLiveFeed
        },
        // 11. Run-in Analysis (Both Teams) & Points Calculations
        runInAnalysis: {
          homeRank: stH?.rank || null,
          awayRank: stA?.rank || null,
          homeStake: stakeLabel(stH),
          awayStake: stakeLabel(stA),
          homeRestDays,
          awayRestDays,
          homeUpcoming,
          awayUpcoming,
          calcHome,
          calcAway,
          edge: runInEdge
        },
        // Weather conditions at stadium city
        weather: match.weather?.ok
          ? match.weather
          : {
              ok: false,
              city: match.venueCity || "",
              country: match.venueCountry || "",
              condition: match.venueCity ? "Pitch forecast ready on sync" : "Venue forecast pending",
              impact: "Calm conditions assumed until city forecast syncs",
              modifier: 0
            },
        // 12. PPG (Points Per Game: Overall & Venue Home/Away)
        ppg: {
          homeOverall: homeOverallPpg,
          awayOverall: awayOverallPpg,
          homeHomePpg,
          awayAwayPpg,
          homePlayed: hMp,
          awayPlayed: aMp,
          gap: ppgGap,
          edge: homeOverallPpg >= awayOverallPpg ? homeTeam.short : awayTeam.short,
          venueEdge: (homeHomePpg ?? homeOverallPpg) >= (awayAwayPpg ?? awayOverallPpg) ? homeTeam.short : awayTeam.short,
          isLiveVenueSplit: Boolean(home5Summary.isLiveFeed || away5Summary.isLiveFeed)
        },
        // 13. Dropping Odds (Real Bookmaker Open -> Latest Movement)
        droppingOdds: match.droppingOdds || { hasData: false, hasDrop: false, bestDrop: null, allMoves: [] }
      }
    };
  }

  // Exact 8 Requested Sure Odds Accumulator Tiers
  const SURE_TIERS = [
    { id: "2", title: "2 Sure Odds", badge: "Banker 2.0x", target: 2.04, min: 1.90, max: 2.35, minLegs: 2, maxLegs: 2, pool: "SAFE", subtitle: "Ultra-high probability 2-leg daily banker built on Home/Away safety, Clean Sheets & Goals" },
    { id: "5", title: "5 Sure Odds", badge: "Rollover 5.0x", target: 5.05, min: 4.65, max: 5.75, minLegs: 3, maxLegs: 4, pool: "SAFE_CORE", subtitle: "3–4 dominant multi-factor edges blending Last 5 Home/Away form & Goals Scored" },
    { id: "10", title: "10 Sure Odds", badge: "Strong 10x", target: 10.2, min: 9.20, max: 11.80, minLegs: 5, maxLegs: 6, pool: "CORE", subtitle: "5–6 real-time fixtures filtered by Injuries, Suspensions, H2H & Run-in Rest" },
    { id: "80", title: "80 Sure Odds", badge: "Value 80x", target: 81.0, min: 72.0, max: 94.0, minLegs: 8, maxLegs: 10, pool: "CORE_VALUE", subtitle: "8–10 cross-league matches combining Straight Wins, Over 2.5 & Win + Over 1.5" },
    { id: "100", title: "100 Sure Odds", badge: "Pro 100x", target: 102.0, min: 92.0, max: 116.0, minLegs: 8, maxLegs: 11, pool: "CORE_VALUE", subtitle: "Precision 100x ticket balancing Clean Sheet dominance with attacking mismatches" },
    { id: "200", title: "200 Sure Odds", badge: "Elite 200x", target: 204.0, min: 182.0, max: 232.0, minLegs: 10, maxLegs: 13, pool: "VALUE", subtitle: "High-yield multi-market accumulator across top European & global kick-offs" },
    { id: "500", title: "500 Sure Odds", badge: "Super 500x", target: 508.0, min: 455.0, max: 575.0, minLegs: 11, maxLegs: 15, pool: "HIGH", subtitle: "Aggressive multi-factor combo slip mixing HT/FT, Win to Nil & Over Goals" },
    { id: "1000000", title: "1 Million Sure Odds", badge: "Jackpot 1,000,000x", target: 1120000.0, min: 1000000.0, max: 1550000.0, minLegs: 18, maxLegs: 26, pool: "MEGA", subtitle: "20+ distinct real-time global fixtures engineered to reach 1,000,000x+ payout" }
  ];

  function allowedMarketsForPool(match, pool) {
    const all = match.analysis?.markets || [];
    if (pool === "SAFE") {
      return all.filter((m) => ["1X", "X2", "O15", "U35"].includes(m.code) || (["HOME", "AWAY"].includes(m.code) && m.odds <= 1.55));
    }
    if (pool === "SAFE_CORE") {
      return all.filter((m) => ["1X", "X2", "O15", "U35", "HOME", "AWAY", "H_O15", "O25"].includes(m.code) && m.odds <= 2.15);
    }
    if (pool === "CORE") {
      return all.filter((m) => ["1X", "X2", "O15", "HOME", "AWAY", "O25", "BTTS", "H_O15", "A_O15"].includes(m.code) && m.odds <= 2.35);
    }
    if (pool === "CORE_VALUE") {
      return all.filter((m) => !["DRAW", "H_BTTS", "A_BTTS"].includes(m.code) && m.odds >= 1.32 && m.odds <= 2.80);
    }
    if (pool === "VALUE") {
      return all.filter((m) => m.odds >= 1.40 && m.odds <= 3.60);
    }
    if (pool === "HIGH") {
      return all.filter((m) => m.odds >= 1.45 && m.odds <= 4.80);
    }
    // MEGA (1,000,000 odds): allow strong multi-factor combos & HT/FT & Win+BTTS
    return all.filter((m) => m.odds >= 1.55);
  }

  function buildSlipForTier(matchesPool, tier, variationSeed = 0) {
    // Only use LIVE (<= 65') or UPCOMING matches — NEVER finished/dead past games
    const playable = matchesPool
      .filter((m) => m.status === "SCHEDULED" || (m.status === "LIVE" && (m.minute || 0) <= 68))
      .map((m) => {
        if (!m.analysis) m.analysis = buildMatchAnalysis(m);
        const topProb = m.analysis?.bestPick?.prob || 0.6;
        // Prefer upcoming top-league fixtures + hydrated analyses + deterministic slight rotation for Regenerate button
        const jitter = variationSeed === 0 ? 0 : ((hashSeed(m.id + ":" + variationSeed) % 100) / 400);
        const rankScore = (m.status === "SCHEDULED" ? 1.0 : 0.72) + (1 / Math.max(1, m.priority)) * 0.25 + topProb * 0.8 + (m.analysis.isLiveHydrated ? 0.12 : 0) - jitter;
        return { match: m, rankScore };
      })
      .sort((a, b) => b.rankScore - a.rankScore)
      .map((x) => x.match);

    if (playable.length === 0) {
      return { ...tier, legs: [], totalOdds: 1.0, estWinPct: 0 };
    }

    const legs = [];
    const usedIds = new Set();
    let product = 1.0;

    // Step 1: Greedily pick legs steering multiplicatively toward target
    const targetLegs = Math.min(playable.length, Math.round((tier.minLegs + tier.maxLegs) / 2));

    for (const m of playable) {
      if (legs.length >= tier.maxLegs) break;
      if (product >= tier.min && legs.length >= tier.minLegs) break;
      if (usedIds.has(m.id)) continue;

      const cands = allowedMarketsForPool(m, tier.pool);
      if (cands.length === 0) continue;

      const remaining = Math.max(1, targetLegs - legs.length);
      const neededTotal = Math.max(1.15, tier.target / product);
      const idealLegOdd = clamp(Math.pow(neededTotal, 1 / remaining), 1.12, tier.pool === "MEGA" ? 6.5 : 3.4);

      // Rank candidate market balancing closeness to idealLegOdd + true multi-factor probability
      let bestCand = null;
      let bestScore = -1e9;
      for (const c of cands) {
        if (tier.id !== "1000000" && product * c.odds > tier.max * 1.12) continue;
        const distPenalty = Math.abs(Math.log(c.odds) - Math.log(idealLegOdd));
        const probBonus = c.prob * (tier.target <= 15 ? 2.2 : 1.1);
        const s = probBonus - distPenalty * 1.45;
        if (s > bestScore) {
          bestScore = s;
          bestCand = c;
        }
      }

      if (!bestCand) {
        bestCand = [...cands].sort((a, b) => Math.abs(a.odds - idealLegOdd) - Math.abs(b.odds - idealLegOdd))[0];
      }

      if (bestCand) {
        usedIds.add(m.id);
        product *= bestCand.odds;
        legs.push({
          matchId: m.id,
          match: m,
          market: bestCand
        });
      }
    }

    // Step 2: Fine-tune multiplier upward if still below tier.min
    let guard = 0;
    while (product < tier.min && guard < 40) {
      guard++;
      // Try upgrading an existing leg's market first (if not at 1M maxLegs yet, or adding new match)
      const nextUnused = playable.find((m) => !usedIds.has(m.id));
      if (nextUnused && legs.length < tier.maxLegs + 4) {
        const cands = (nextUnused.analysis?.markets || []).filter((c) => c.odds >= 1.35);
        const gapRatio = tier.target / product;
        const pick = [...cands].sort((a, b) => Math.abs(a.odds - Math.min(6.0, gapRatio)) - Math.abs(b.odds - Math.min(6.0, gapRatio)))[0];
        if (pick) {
          usedIds.add(nextUnused.id);
          product *= pick.odds;
          legs.push({ matchId: nextUnused.id, match: nextUnused, market: pick });
          continue;
        }
      }
      // Otherwise swap lowest-odds leg to highest available value market on that same match
      let upgraded = false;
      for (const leg of legs) {
        const higher = [...(leg.match.analysis?.markets || [])]
          .filter((c) => c.odds > leg.market.odds && (product / leg.market.odds) * c.odds <= tier.max * 1.25)
          .sort((a, b) => b.odds - a.odds)[0];
        if (higher) {
          product = (product / leg.market.odds) * higher.odds;
          leg.market = higher;
          upgraded = true;
          break;
        }
      }
      if (!upgraded) break;
    }

    // Step 3: Fine-tune downward if overshot tier.max cleanly
    if (product > tier.max && legs.length >= 2) {
      for (const leg of [...legs].reverse()) {
        if (product <= tier.max) break;
        const lower = [...(leg.match.analysis?.markets || [])]
          .filter((c) => c.odds < leg.market.odds && (product / leg.market.odds) * c.odds >= tier.min)
          .sort((a, b) => b.prob - a.prob)[0];
        if (lower) {
          product = (product / leg.market.odds) * lower.odds;
          leg.market = lower;
        }
      }
    }

    const combinedProb = legs.reduce((p, l) => p * l.market.prob, 1);
    return {
      ...tier,
      legs,
      totalOdds: Math.round(product * 100) / 100,
      estWinPct: Math.round(combinedProb * 10000) / 100
    };
  }

  function buildSureOddsSlips(matchesPool, variationSeed = 0) {
    const slips = {};
    for (const tier of SURE_TIERS) {
      slips[tier.id] = buildSlipForTier(matchesPool, tier, variationSeed);
    }
    return slips;
  }

  // Deep ESPN Hydration for any single match (H2H + Last 5 Home/Away + Clean Sheets + Run-in + Injuries/Suspensions)
  async function enrichMatchDetails(match) {
    if (!match || !match.espnId) return match;
    if (match.enriched && match.analysis?.factors?.h2h?.isLiveFeed && match.analysis?.factors?.last5HomeGames?.isLiveFeed) {
      return match;
    }

    const code = match.espnLeagueCode && match.espnLeagueCode !== "all" ? match.espnLeagueCode : "all";
    const sumPromise = summaryCache.has(match.espnId)
      ? Promise.resolve(summaryCache.get(match.espnId))
      : fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/summary?event=${match.espnId}`, 5000)
          .then((d) => {
            if (d) summaryCache.set(match.espnId, d);
            return d;
          });

    const fetchTeamSched = async (teamId) => {
      if (!teamId) return null;
      if (teamScheduleCache.has(teamId)) return teamScheduleCache.get(teamId);
      const [pastRes, futRes] = await Promise.all([
        fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule`, 5000),
        fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule?fixture=true`, 5000)
      ]);
      const data = {
        past: pastRes?.events || [],
        upcoming: futRes?.events || []
      };
      teamScheduleCache.set(teamId, data);
      return data;
    };

    const fetchTeamRoster = async (teamId) => {
      if (!teamId) return null;
      const stGlobal = standingsByTeamId.get(String(teamId));
      const stMatchLg = standingsByTeamId.get(`${match.leagueSlug}:${teamId}`);
      const domesticCode = stGlobal && !stGlobal.isUEFA ? stGlobal.espnCode : (stMatchLg && !stMatchLg.isUEFA ? stMatchLg.espnCode : null);
      const rCode = code?.startsWith("uefa.")
        ? (domesticCode || code)
        : (code !== "all" ? code : (domesticCode || stMatchLg?.espnCode));
      if (!rCode || rCode === "all") return null;
      const cacheKey = `${rCode}:${teamId}`;
      if (teamRosterCache.has(cacheKey)) return teamRosterCache.get(cacheKey);
      const rJson = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${rCode}/teams/${teamId}/roster`, 4500);
      teamRosterCache.set(cacheKey, rJson || null);
      return rJson;
    };

    const [sum, homeSched, awaySched, homeRoster, awayRoster] = await Promise.all([
      sumPromise,
      fetchTeamSched(match.homeEspnId),
      fetchTeamSched(match.awayEspnId),
      fetchTeamRoster(match.homeEspnId),
      fetchTeamRoster(match.awayEspnId),
      fetchMatchWeather(match)
    ]);

    // Update live stats & events & lineups from summary if present
    if (sum) {
      if (sum.header?.league) {
        const lgSlug = codeToMeta.get(sum.header.league.slug)?.slug || match.leagueSlug;
        match.espnLeagueCode = sum.header.league.slug || match.espnLeagueCode;
        match.leagueSlug = lgSlug;
        match.leagueName = sum.header.league.name || match.leagueName;
        if (sum.header.league.logos?.[0]?.href) match.leagueLogo = sum.header.league.logos[0].href;
      }

      if (sum.gameInfo?.venue?.fullName) {
        match.venue = sum.gameInfo.venue.fullName;
      }

      // Live keyEvents timeline
      if (Array.isArray(sum.keyEvents) && sum.keyEvents.length > 0) {
        match.events = sum.keyEvents
          .filter((ke) => /goal|card/i.test(ke.type?.text || ""))
          .map((ke) => ({
            min: ke.clock?.displayValue || "",
            team: String(ke.team?.id) === match.homeEspnId ? "home" : "away",
            type: /red/i.test(ke.type?.text || "") ? "red" : /yellow/i.test(ke.type?.text || "") ? "yellow" : "goal",
            player: ke.participants?.[0]?.athlete?.displayName || ke.text || "Match Event",
            assist: ""
          }));
        match.homeRed = match.events.filter((e) => e.team === "home" && e.type === "red").length;
        match.awayRed = match.events.filter((e) => e.team === "away" && e.type === "red").length;
      }

      // Boxscore stats
      if (Array.isArray(sum.boxscore?.teams) && sum.boxscore.teams.length >= 2) {
        const hBox = sum.boxscore.teams.find((t) => String(t.team?.id) === match.homeEspnId) || sum.boxscore.teams[0];
        const aBox = sum.boxscore.teams.find((t) => String(t.team?.id) === match.awayEspnId) || sum.boxscore.teams[1];
        const statVal = (box, names) => {
          const s = (box?.statistics || []).find((x) => names.includes(x.name));
          return s ? parseFloat(s.displayValue) || 0 : 0;
        };
        const hPoss = statVal(hBox, ["possessionPct"]) || 50;
        const aPoss = statVal(aBox, ["possessionPct"]) || 100 - hPoss;
        match.stats = {
          possession: [Math.round(hPoss), Math.round(aPoss)],
          shots: [statVal(hBox, ["totalShots"]), statVal(aBox, ["totalShots"])],
          shotsOnTarget: [statVal(hBox, ["shotsOnTarget"]), statVal(aBox, ["shotsOnTarget"])],
          xg: [String(statVal(hBox, ["expectedGoals"]) || "-"), String(statVal(aBox, ["expectedGoals"]) || "-")],
          corners: [statVal(hBox, ["wonCorners"]), statVal(aBox, ["wonCorners"])],
          passes: [statVal(hBox, ["totalPasses"]), statVal(aBox, ["totalPasses"])],
          fouls: [statVal(hBox, ["foulsCommitted"]), statVal(aBox, ["foulsCommitted"])]
        };
      }

      // Lineups
      if (Array.isArray(sum.rosters) && sum.rosters.length >= 2) {
        const hR = sum.rosters.find((r) => String(r.team?.id) === match.homeEspnId) || sum.rosters[0];
        const aR = sum.rosters.find((r) => String(r.team?.id) === match.awayEspnId) || sum.rosters[1];
        const hXI = (hR.roster || []).filter((p) => p.starter).map((p) => p.athlete?.shortName || p.athlete?.displayName).filter(Boolean);
        const aXI = (aR.roster || []).filter((p) => p.starter).map((p) => p.athlete?.shortName || p.athlete?.displayName).filter(Boolean);
        if (hXI.length > 0 || aXI.length > 0) {
          match.lineups = {
            homeFormation: hR.formation || "XI",
            awayFormation: aR.formation || "XI",
            homeXI: hXI,
            awayXI: aXI
          };
        }
      }
    }

    match.enriched = true;
    match.analysis = buildMatchAnalysis(match, sum, homeSched, awaySched, homeRoster, awayRoster);
    return match;
  }

  async function fetchStandingsAndInjuries() {
    const standingsTargets = ESPN_LEAGUES.slice(0, 18);
    const newsTargets = ESPN_LEAGUES.slice(0, 6);

    const newsPromise = Promise.all(
      newsTargets.map(async (lgMeta) => {
        try {
          const nRes = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lgMeta.code}/news?limit=25`, 4500);
          if (Array.isArray(nRes?.articles)) {
            newsByLeague.set(lgMeta.code, nRes.articles);
          }
        } catch {
          // Ignore single news hiccup
        }
      })
    );

    const standingsPromiseAll = Promise.all(
      standingsTargets.map(async (lgMeta) => {
        try {
          const stRes = await fetchJson(`https://site.api.espn.com/apis/v2/sports/soccer/${lgMeta.code}/standings`, 5000);

          const entries = stRes?.children?.[0]?.standings?.entries || stRes?.standings?.entries || [];
          if (entries.length === 0) return;

          const tableRows = entries.map((entry, idx) => {
            const stMap = new Map((entry.stats || []).map((s) => [s.abbreviation || s.name, s.value]));
            const tid = String(entry.team?.id || "");
            const key = `espn-${tid}`;
            const logo = entry.team?.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/soccer/500/${tid}.png`;

            DATA.TEAMS[key] = {
              ...(DATA.TEAMS[key] || {}),
              key,
              espnId: tid,
              name: entry.team?.displayName || entry.team?.name || entry.team || "Club",
              short: entry.team?.abbreviation || "FC",
              color: "#0A7B5C",
              logo,
              league: lgMeta.slug
            };

            const mp = stMap.get("GP") ?? stMap.get("gamesPlayed") ?? 0;
            const w = stMap.get("W") ?? stMap.get("wins") ?? 0;
            const d = stMap.get("D") ?? stMap.get("ties") ?? 0;
            const l = stMap.get("L") ?? stMap.get("losses") ?? 0;
            const gf = stMap.get("F") ?? stMap.get("pointsFor") ?? 0;
            const ga = stMap.get("A") ?? stMap.get("pointsAgainst") ?? 0;
            const gdVal = stMap.get("GD") ?? stMap.get("pointDifferential") ?? (gf - ga);
            const pts = stMap.get("P") ?? stMap.get("points") ?? (w * 3 + d);
            const rank = stMap.get("R") ?? stMap.get("rank") ?? idx + 1;
            const rc = stMap.get("RC") ?? stMap.get("redCards") ?? 0;
            const ppg = mp > 0 ? Math.round((pts / mp) * 100) / 100 : 0;

            const existingSt = standingsByTeamId.get(tid);
            const isDomestic = !lgMeta.code.startsWith("uefa.");
            if (!existingSt || (isDomestic && existingSt.isUEFA) || (!existingSt.isUEFA && mp > existingSt.mp)) {
              standingsByTeamId.set(tid, {
                rank, mp, w, d, l, gf, ga, gd: gdVal, pts, ppg, rc,
                espnCode: lgMeta.code,
                leagueSlug: lgMeta.slug,
                isUEFA: !isDomestic
              });
            }
            standingsByTeamId.set(`${lgMeta.slug}:${tid}`, {
              rank, mp, w, d, l, gf, ga, gd: gdVal, pts, ppg, rc,
              espnCode: lgMeta.code,
              leagueSlug: lgMeta.slug,
              isUEFA: !isDomestic
            });

            return {
              pos: rank,
              team: key,
              customName: entry.team?.displayName || entry.team?.name || "Club",
              mp, w, d, l, gf, ga,
              gd: gdVal > 0 ? `+${gdVal}` : String(gdVal),
              pts,
              ppg,
              form: [],
              zone: rank <= 4 ? "ucl" : rank <= 6 ? "uel" : rank >= entries.length - 2 ? "rel" : ""
            };
          });

          DATA.STANDINGS[lgMeta.slug] = tableRows;
        } catch {
          // Ignore single league standing hiccup
        }
      })
    );

    await Promise.all([newsPromise, standingsPromiseAll]);
  }

  function buildTodayPowerRankings(matches = []) {
    // Only rank actionable live (< 75') and scheduled upcoming fixtures so near-FT 90'+ games don't top Power lists
    const playableAll = (matches || []).filter(
      (m) => m.status === "SCHEDULED" || (m.status === "LIVE" && (m.minute || 0) < 75)
    );
    const activeAll = playableAll.length >= 6
      ? playableAll
      : (matches || []).filter((m) => m.status !== "FT");
    const todayIso = DATA.todayIso;
    let pool = activeAll.filter((m) => m.date === todayIso);
    const isTodayOnly = pool.length >= 4;
    if (!isTodayOnly) {
      pool = activeAll;
    }

    const strongHome = [];
    const strongAway = [];
    const worstHome = [];
    const worstAway = [];

    for (const m of pool) {
      const a = m.analysis || buildMatchAnalysis(m);
      const f = a?.factors;
      if (!f) continue;

      const stH = standingsByTeamId.get(`${m.leagueSlug}:${m.homeEspnId}`) || standingsByTeamId.get(m.homeEspnId);
      const stA = standingsByTeamId.get(`${m.leagueSlug}:${m.awayEspnId}`) || standingsByTeamId.get(m.awayEspnId);

      const hMp = stH?.mp ?? m.homeRecord?.mp ?? 0;
      const aMp = stA?.mp ?? m.awayRecord?.mp ?? 0;

      const hTeam = DATA.TEAMS[m.home] || { name: "Home", short: "HOM" };
      const aTeam = DATA.TEAMS[m.away] || { name: "Away", short: "AWY" };

      const probs = a.probs || { pH: 0.42, pD: 0.27, pA: 0.31, p1X: 0.69, pX2: 0.58 };
      const weatherObj = m.weather?.ok ? m.weather : f.weather;
      const weatherMod = weatherObj?.modifier || 0;

      const buildSideEntry = (side) => {
        const isHome = side === "home";
        const team = isHome ? hTeam : aTeam;
        const opp = isHome ? aTeam : hTeam;
        const stMe = isHome ? stH : stA;
        const stOpp = isHome ? stA : stH;
        const myMp = isHome ? hMp : aMp;
        const oppMp = isHome ? aMp : hMp;

        const formArr = isHome ? f.currentForm.homeForm : f.currentForm.awayForm;
        const formPts = isHome ? f.currentForm.homePts : f.currentForm.awayPts;
        const myRecord = isHome ? f.currentForm.homeRecord : f.currentForm.awayRecord;

        const myGfAvg = isHome ? f.goalsScored.homeAvg : f.goalsScored.awayAvg;
        const oppGaAvg = isHome ? f.goalsConceded.awayAvg : f.goalsConceded.homeAvg;
        const myGaAvg = isHome ? f.goalsConceded.homeAvg : f.goalsConceded.awayAvg;
        const oppGfAvg = isHome ? f.goalsScored.awayAvg : f.goalsScored.homeAvg;
        const myXg = isHome ? a.expectedGoals.home : a.expectedGoals.away;
        const oppXg = isHome ? a.expectedGoals.away : a.expectedGoals.home;

        const myPpg = isHome ? f.ppg.homeOverall : f.ppg.awayOverall;
        const myVenuePpg = isHome ? (f.ppg.homeHomePpg ?? myPpg) : (f.ppg.awayAwayPpg ?? myPpg);
        const oppPpg = isHome ? f.ppg.awayOverall : f.ppg.homeOverall;
        const oppVenuePpg = isHome ? (f.ppg.awayAwayPpg ?? oppPpg) : (f.ppg.homeHomePpg ?? oppPpg);

        const myInj = isHome ? f.injuries.home : f.injuries.away;
        const oppInj = isHome ? f.injuries.away : f.injuries.home;
        const mySusp = isHome ? f.suspensions.home : f.suspensions.away;
        const oppSusp = isHome ? f.suspensions.away : f.suspensions.home;
        const myRedSeason = isHome ? f.suspensions.homeRedSeason : f.suspensions.awayRedSeason;

        const myVenueSplit = isHome ? f.last5HomeGames : f.last5AwayGames;
        const myCs = isHome ? f.cleanSheetsHome : f.cleanSheetsAway;
        const myH2hWins = isHome ? f.h2h.homeWins : f.h2h.awayWins;
        const oppH2hWins = isHome ? f.h2h.awayWins : f.h2h.homeWins;

        const calc = (isHome ? f.runInAnalysis.calcHome : f.runInAnalysis.calcAway) || computeTeamStandingsCalc(m, side, stMe, stOpp);
        const calcOpp = (isHome ? f.runInAnalysis.calcAway : f.runInAnalysis.calcHome) || computeTeamStandingsCalc(m, isHome ? "away" : "home", stOpp, stMe);

        const winProb = isHome ? probs.pH : probs.pA;
        const loseProb = isHome ? probs.pA : probs.pH;
        const winOdd = isHome ? m.odds.home : m.odds.away;
        const oppOdd = isHome ? m.odds.away : m.odds.home;

        // Reliability gate so unplayed 0-MP youth/reserve fixtures don't dominate real leagues
        const sampleBonus = (myMp >= 2 ? 3 : -8) + (oppMp >= 2 ? 2 : -4) + (calc.hasTable ? 3 : 0);

        // STRONG TEAM SCORE (0..100) using all 13 criteria
        let strongRaw = 20 + sampleBonus;
        strongRaw += (formPts / 15) * 14;
        strongRaw += (myVenueSplit.wins / 5) * 11;
        strongRaw += (myCs.pct / 100) * 6;
        strongRaw += isHome ? 4 : 0; // Home advantage weight (Away strong needs extra road proof)
        strongRaw += clamp(myVenuePpg * 5.2, 0, 15);
        strongRaw += clamp((myPpg - oppPpg) * 5.5, -6, 9);
        strongRaw += clamp(myGfAvg * 5.2, 0, 11);
        strongRaw += clamp((myGfAvg - oppGaAvg) * 2.5, -3, 5);
        strongRaw += clamp((myGfAvg - myGaAvg) * 3.0, -4, 6);
        strongRaw += clamp((myH2hWins - oppH2hWins) * 2.0, -4, 5);
        strongRaw += (calc.hasTable && calc.rank <= 4 ? 4 : calc.hasTable && calc.rank <= 8 ? 2 : 0);
        strongRaw += (calc.urgencyScore >= 2 ? 3 : 0);
        strongRaw -= Math.min(10, myInj.length * 2.5 + mySusp.length * 3.5);
        strongRaw += Math.min(6, oppInj.length * 1.4 + oppSusp.length * 2.2);
        strongRaw += winProb * 18;
        strongRaw += weatherMod * 45;
        const strongScore = Math.round(clamp(strongRaw, 8, 99));

        // WORST TEAM SCORE (0..100, higher = weaker / most vulnerable today)
        let worstRaw = 18 + sampleBonus;
        worstRaw += ((15 - formPts) / 15) * 15;
        worstRaw += (myVenueSplit.losses / 5) * 11;
        worstRaw += ((100 - myCs.pct) / 100) * 6;
        worstRaw += !isHome ? 3 : 0; // Playing away while weak amplifies risk
        worstRaw += clamp((1.75 - myVenuePpg) * 7.5, 0, 14);
        worstRaw += clamp((oppPpg - myPpg) * 6.0, -4, 10);
        worstRaw += clamp((1.4 - myGfAvg) * 5.5, 0, 9);
        worstRaw += clamp(myGaAvg * 5.2, 0, 11);
        worstRaw += clamp((oppH2hWins - myH2hWins) * 2.0, -3, 5);
        worstRaw += (calc.hasTable && calc.rank >= Math.max(8, (calc.totalTeams || 18) - 5) ? 5 : 0);
        worstRaw += (calc.lossThreatCount >= 2 ? 2.5 : 0);
        worstRaw += Math.min(10, myInj.length * 2.5 + mySusp.length * 3.5 + (myRedSeason > 0 ? 1.5 : 0));
        worstRaw -= Math.min(5, oppInj.length * 1.2 + oppSusp.length * 2.0);
        worstRaw += loseProb * 18;
        worstRaw += weatherMod < 0 ? Math.abs(weatherMod) * 35 : 0;
        const worstScore = Math.round(clamp(worstRaw, 8, 99));

        const gdDisplay = stMe ? (stMe.gd > 0 ? `+${stMe.gd}` : String(stMe.gd)) : "-";
        const standingSummary = calc.hasTable
          ? `#${calc.rank}/${calc.totalTeams} (${stMe.pts} pts · ${gdDisplay} GD) vs #${stOpp?.rank || "-"}`
          : `${myRecord} season record vs ${isHome ? f.currentForm.awayRecord : f.currentForm.homeRecord}`;

        const historySummary = `Season ${myRecord} (${gdDisplay} GD) · Form ${formArr.join("-")} · H2H vs ${opp.short}: ${myH2hWins}W-${f.h2h.draws}D-${oppH2hWins}L`;

        const weatherSummary = weatherObj?.ok
          ? `${weatherObj.tempC}°C · ${weatherObj.condition} · Wind ${weatherObj.windKmh} km/h${weatherObj.precipMm > 0 ? ` · ${weatherObj.precipMm}mm rain` : ""}`
          : `${m.venueCity ? `${m.venueCity}: ` : ""}${weatherObj?.condition || "Venue conditions mild"}`;

        const venueAdvLabel = isHome
          ? `Home Last 5: ${myVenueSplit.wins}W-${myVenueSplit.draws}D-${myVenueSplit.losses}L · ${myCs.pct}% Home CS · ${myVenuePpg.toFixed(2)} Home PPG`
          : `Away Last 5: ${myVenueSplit.wins}W-${myVenueSplit.draws}D-${myVenueSplit.losses}L · ${myCs.pct}% Away CS · ${myVenuePpg.toFixed(2)} Away PPG`;

        const entry = {
          match: m,
          side,
          isHome,
          team,
          opponent: opp,
          strongScore,
          worstScore,
          winProbPct: Math.round(winProb * 100),
          loseProbPct: Math.round(loseProb * 100),
          winOdd,
          oppOdd,
          criteria: {
            form: { formArr, pts: formPts, record: myRecord },
            goalScoringPower: {
              gfAvg: myGfAvg,
              gaAvg: myGaAvg,
              oppGaAvg,
              oppGfAvg,
              xg: myXg,
              oppXg
            },
            ppg: {
              overall: myPpg,
              venue: myVenuePpg,
              oppOverall: oppPpg,
              oppVenue: oppVenuePpg,
              edgeDiff: Math.round((myPpg - oppPpg) * 100) / 100
            },
            injuries: {
              mine: myInj,
              opp: oppInj
            },
            suspensions: {
              mine: mySusp,
              opp: oppSusp,
              redSeason: myRedSeason
            },
            venueAdvantage: {
              label: venueAdvLabel,
              wins: myVenueSplit.wins,
              draws: myVenueSplit.draws,
              losses: myVenueSplit.losses,
              csPct: myCs.pct
            },
            weather: {
              ok: Boolean(weatherObj?.ok),
              summary: weatherSummary,
              impact: weatherObj?.impact || "Normal playing conditions"
            },
            h2h: {
              myWins: myH2hWins,
              draws: f.h2h.draws,
              oppWins: oppH2hWins,
              avgGoals: f.h2h.avgGoals,
              summary: f.h2h.summary
            },
            standing: {
              summary: standingSummary,
              rank: calc.rank,
              pts: calc.pts,
              oppRank: stOpp?.rank || null
            },
            pointsNeeded: calc.pointsNeeded,
            drawImportance: calc.drawImportance,
            lossEffect: calc.lossEffect,
            histories: historySummary,
            oppPointsNeeded: calcOpp.pointsNeeded
          }
        };

        return entry;
      };

      const hEntry = buildSideEntry("home");
      const aEntry = buildSideEntry("away");

      // Strong candidates: legitimate win edge + healthy scoring balance
      if (hEntry.winProbPct >= 44 && hEntry.strongScore >= hEntry.worstScore + 4) {
        strongHome.push(hEntry);
      }
      if (aEntry.winProbPct >= 40 && aEntry.strongScore >= aEntry.worstScore + 4) {
        strongAway.push(aEntry);
      }

      // Worst candidates: vulnerable / struggling teams likely to drop points
      if (hEntry.loseProbPct >= 34 && hEntry.worstScore >= hEntry.strongScore + 4) {
        worstHome.push(hEntry);
      }
      if (aEntry.loseProbPct >= 38 && aEntry.worstScore >= aEntry.strongScore + 4) {
        worstAway.push(aEntry);
      }
    }

    // Fallback sort even on slim matchdays so all 4 quadrants always show top ranked picks if active
    strongHome.sort((a, b) => b.strongScore - a.strongScore || b.winProbPct - a.winProbPct);
    strongAway.sort((a, b) => b.strongScore - a.strongScore || b.winProbPct - a.winProbPct);
    worstHome.sort((a, b) => b.worstScore - a.worstScore || b.loseProbPct - a.loseProbPct);
    worstAway.sort((a, b) => b.worstScore - a.worstScore || b.loseProbPct - a.loseProbPct);

    return {
      isTodayOnly,
      scopeLabel: isTodayOnly ? `Today (${todayIso})` : "Today & Next Live Window",
      totalEvaluated: pool.length,
      strongHome: strongHome.slice(0, 10),
      strongAway: strongAway.slice(0, 10),
      worstHome: worstHome.slice(0, 10),
      worstAway: worstAway.slice(0, 10)
    };
  }

  async function load(onProgress = null) {
    const now = new Date();
    const datesToFetch = [0, 1, 2].map((off) => {
      const d = new Date(now);
      d.setDate(d.getDate() + off);
      return { offset: off, ymd: yyyymmdd(d), iso: isoDate(d) };
    });

    // Update dynamic dates strip in DATA
    DATA.DATES = [
      { id: "UPCOMING_ALL", label: "All Live & Upcoming", short: "Live/Next" },
      ...datesToFetch.map((dt) => {
        const d = new Date(dt.iso + "T12:00:00");
        const monDay = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const lbl = dt.offset === 0 ? `Today · ${monDay}` : dt.offset === 1 ? `Tomorrow · ${monDay}` : `${d.toLocaleDateString("en-US", { weekday: "short" })}, ${monDay}`;
        return { id: dt.iso, label: lbl, short: dt.offset === 0 ? "Today" : dt.offset === 1 ? "Tomorrow" : monDay };
      })
    ];

    // Step 1: Fetch standings + key today scoreboards + global 3-day all/scoreboard in parallel
    const standingsPromise = fetchStandingsAndInjuries();
    const priorityLeagues = ESPN_LEAGUES.slice(0, 10);

    const priorityPromise = Promise.all(
      priorityLeagues.map((lgMeta) =>
        fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lgMeta.code}/scoreboard?dates=${datesToFetch[0].ymd}`, 5000)
          .then((json) => ({ code: lgMeta.code, json }))
      )
    );

    const allScoreboardPromise = Promise.all(
      datesToFetch.map((dt) =>
        fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dt.ymd}`, 5000)
          .then((json) => ({ code: null, json }))
      )
    );

    const [_, priorityBoards, allBoards] = await Promise.all([
      standingsPromise,
      priorityPromise,
      allScoreboardPromise
    ]);

    const activeMap = new Map();
    const finishedTodayMap = new Map();

    function ingestBoard(item) {
      if (!item || !item.json || !Array.isArray(item.json.events)) return;
      const sbLeague = item.json.leagues?.[0] || null;
      if (item.code && Array.isArray(item.json.news?.articles)) {
        newsByLeague.set(item.code, item.json.news.articles);
      }
      for (const ev of item.json.events) {
        const parsed = parseEvent(ev, item.code, sbLeague);
        if (!parsed) continue;
        if (parsed.status === "FT") {
          if (parsed.date === datesToFetch[0].iso && !finishedTodayMap.has(parsed.espnId)) {
            finishedTodayMap.set(parsed.espnId, parsed);
          }
          continue;
        }
        // Always let explicit league board override generic /all/board entry
        if (!activeMap.has(parsed.espnId) || (item.code && activeMap.get(parsed.espnId).espnLeagueCode === "all")) {
          activeMap.set(parsed.espnId, parsed);
        }
      }
    }

    priorityBoards.forEach(ingestBoard);
    allBoards.forEach(ingestBoard);

    const activeMatches = Array.from(activeMap.values()).sort((a, b) => {
      if (a.status === "LIVE" && b.status !== "LIVE") return -1;
      if (a.status !== "LIVE" && b.status === "LIVE") return 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.isoDateTime) - new Date(b.isoDateTime);
    });

    const finishedToday = Array.from(finishedTodayMap.values());

    // Fetch live news from premier + uefa for News panel
    const liveArticles = [];
    for (const [code, arts] of newsByLeague.entries()) {
      for (const a of arts.slice(0, 2)) {
        liveArticles.push({
          id: `espn-news-${a.id || Math.random().toString(36).slice(2)}`,
          featured: liveArticles.length === 0,
          title: a.headline,
          source: code.toUpperCase(),
          time: a.published ? new Date(a.published).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Today",
          tag: codeToMeta.get(code)?.name || "Football",
          summary: a.description || a.headline,
          body: [a.description || a.headline, "Live story synced via MAMON WIN real-time football desk."]
        });
      }
    }
    if (liveArticles.length > 0) {
      DATA.NEWS = [...liveArticles.slice(0, 6), ...DATA.NEWS];
    }

    // Launch immediate city weather hydration in parallel for Top Today Power Pick venues + background-hydrate top 18 fixtures
    const initialPower = buildTodayPowerRankings(activeMatches);
    const initialWeatherTargets = [
      ...initialPower.strongHome.slice(0, 6),
      ...initialPower.strongAway.slice(0, 6),
      ...initialPower.worstHome.slice(0, 6),
      ...initialPower.worstAway.slice(0, 6)
    ].map((x) => x.match);

    const hydrationQueue = activeMatches.slice(0, 18);
    if (typeof onProgress === "function") {
      if (initialWeatherTargets.length > 0) {
        hydrateWeatherForMatches(initialWeatherTargets).then((wChanged) => {
          if (wChanged) {
            initialWeatherTargets.forEach((m) => {
              if (!m.enriched) m.analysis = buildMatchAnalysis(m);
            });
            onProgress(activeMatches, finishedToday);
          }
        });
      }

      if (hydrationQueue.length > 0) {
        (async () => {
          for (let i = 0; i < hydrationQueue.length; i += 4) {
            const batch = hydrationQueue.slice(i, i + 4);
            await Promise.all(batch.map((m) => enrichMatchDetails(m)));
            onProgress(activeMatches, finishedToday);
          }
          const postPower = buildTodayPowerRankings(activeMatches);
          const postWeatherTargets = [
            ...postPower.strongHome.slice(0, 6),
            ...postPower.strongAway.slice(0, 6),
            ...postPower.worstHome.slice(0, 6),
            ...postPower.worstAway.slice(0, 6)
          ].map((x) => x.match);
          const wChanged2 = await hydrateWeatherForMatches(postWeatherTargets);
          if (wChanged2) {
            postWeatherTargets.forEach((m) => {
              if (!m.enriched) m.analysis = buildMatchAnalysis(m);
            });
            onProgress(activeMatches, finishedToday);
          }
        })();
      }
    }

    return {
      activeMatches,
      finishedToday,
      fetchedAt: new Date().toISOString()
    };
  }

  return {
    SURE_TIERS,
    load,
    enrichMatchDetails,
    buildSureOddsSlips,
    buildMatchAnalysis,
    buildTodayPowerRankings,
    hydrateWeatherForMatches,
    slugToEspnCode
  };
})();
