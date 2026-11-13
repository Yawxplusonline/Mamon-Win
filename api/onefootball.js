// Real-Time OneFootball (https://onefootball.com/en/matches) Schedule & Match Proxy for MAMON WIN
const { isGenericStageName, canonicalizeLeagueAndCountry } = require("./leagueCatalog");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 90 * 1000;
const FOOTBALL_PLAYED_ELAPSED_MS = 115 * 60000; // 1h 55m after kickoff => match played by schedule time
let cachedSchedule = null;
let cachedExpiresAt = 0;
let inFlightFetch = null;

const TEAM_ALIASES = {
  "manchester united": "man utd",
  "man united": "man utd",
  "manchester city": "man city",
  "tottenham hotspur": "tottenham",
  "spurs": "tottenham",
  "wolverhampton wanderers": "wolves",
  "wolverhampton": "wolves",
  "nottingham forest": "nottm forest",
  "newcastle united": "newcastle",
  "west ham united": "west ham",
  "brighton hove albion": "brighton",
  "brighton and hove albion": "brighton",
  "paris saint germain": "psg",
  "paris sg": "psg",
  "internazionale": "inter",
  "inter milan": "inter",
  "ac milan": "milan",
  "bayern munchen": "bayern munich",
  "bayer 04 leverkusen": "bayer leverkusen",
  "atletico de madrid": "atletico madrid",
  "athletic club": "athletic bilbao",
  "ath bilbao": "athletic bilbao",
  "sporting cp": "sporting",
  "turkiye": "turkey",
  "czechia": "czech republic",
  "korea republic": "south korea",
  "bosnia herzegovina": "bosnia",
  "juventus turin": "juventus",
  "olympique lyon": "lyon",
  "olympique lyonnais": "lyon"
};

function normTeamKey(name) {
  const cleaned = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\b(fc|cf|sc|afc|ac|as|us|cd|ud|rcd|rc|sd|sv|vfl|vfb|fsv|tsg|rb|bsc|fk|sk|if|bk|ik|aik|city|town|united|utd|spor|kulubu|as)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (TEAM_ALIASES[cleaned]) return TEAM_ALIASES[cleaned];
  // Second pass without stripping club suffixes in case two short words remain
  const basic = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[basic] || cleaned || basic;
}

function teamNamesSimilar(a, b) {
  const na = normTeamKey(a);
  const nb = normTeamKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const wa = na.split(" ").filter((w) => w.length >= 3);
  const wb = nb.split(" ").filter((w) => w.length >= 3);
  if (wa.length > 0 && wb.length > 0) {
    const shared = wa.filter((w) => wb.includes(w));
    if (shared.length >= 1 && (wa.length === 1 || wb.length === 1 || shared.length >= 2)) {
      return true;
    }
  }
  return false;
}

function isChaosOrWomen(comp, home, away) {
  const text = `${comp || ""} ${home || ""} ${away || ""}`.toLowerCase();
  const banned = [
    /\breserve(s)?\b/i,
    /\bu2[0-3]\b/i,
    /\bu1[5-9]\b/i,
    /\bsub-20\b|\bsub 20\b|\bsub-23\b|\bsub 23\b/i,
    /\byouth\b|\bacademy\b/i,
    /\bwomen('s)?\b|\bfemenil\b|\bfeminina\b|\bfeminino\b|\bladies\b|\blady\b|\bfem\b|\bfemminile\b|\bféminine\b|\bfrauen\b|\bw-league\b|\bwsl\b|\bnwsl\b|\bd1\s*arkema\b|\bliga\s*f\b|\bdamallsvenskan\b|\bwbb\b|\bwnba\b/i,
    /\s+w\b/i,
    /\(w\)/i,
    /\bncaa\b|\bcollege\b|\bamateur\b|\bdivision\s*[i|1|2|3]+\s*women\b/i
  ];
  return banned.some((rx) => rx.test(text));
}

function parseOneFootballPage(html, fallbackDateIso) {
  const m = String(html || "").match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m || !m[1]) return [];
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return [];
  }

  const containers = parsed.props?.pageProps?.containers || [];
  const extracted = [];
  let currentCompHint = "";
  const now = Date.now();

  function walk(node, localComp = "") {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, localComp);
      return;
    }

    if (node.sectionHeader?.title) {
      const t = String(node.sectionHeader.title || "").trim();
      if (t && !/^all of .*(matches|football)/i.test(t) && !/^live matches$/i.test(t) && !isGenericStageName(t)) {
        currentCompHint = t;
      }
    }

    const candComp = [node.competitionName, node.competition?.name, node.header?.title].find(
      (x) => x && !isGenericStageName(String(x).trim())
    );
    const nextComp = candComp || (!isGenericStageName(localComp) ? localComp : currentCompHint);

    if (node.homeTeam && node.awayTeam && (node.kickoff || node.link || node.id)) {
      const te = (Array.isArray(node.trackingEvents) ? node.trackingEvents : []).find((x) => x?.typedServerParameter)?.typedServerParameter || {};
      const matchId = String(te.match_id?.value || node.id || (node.link || "").split("/").pop() || "").trim();
      const homeName = String(node.homeTeam?.name || "").trim();
      const awayName = String(node.awayTeam?.name || "").trim();
      const teComp = String(te.competition?.value || "").trim();
      const rawCompName = (!isGenericStageName(teComp) && teComp) ? teComp : (nextComp || "International Football");
      const rawCountry = String(te.country?.value || node.competition?.country?.name || "").trim();
      const canonicalLoc = canonicalizeLeagueAndCountry(rawCountry, rawCompName, "football");
      const compName = canonicalLoc.league;
      const countryName = canonicalLoc.country;
      const compId = String(te.competition_id?.value || "").trim();

      if (matchId && homeName && awayName && !isChaosOrWomen(compName, homeName, awayName)) {
        const koIso = node.kickoff || `${fallbackDateIso}T12:00:00Z`;
        const koMs = Date.parse(koIso);
        if (Number.isFinite(koMs)) {
          const matchStateRaw = String(te.match_state?.value || "").trim();
          const periodNum = Number(node.period);
          const rawMinute = parseInt(te.match_minute?.value || node.timePeriod || "0", 10) || 0;
          const hScoreRaw = node.homeTeam?.score;
          const aScoreRaw = node.awayTeam?.score;
          const hScore = hScoreRaw !== "" && hScoreRaw !== null && hScoreRaw !== undefined ? parseInt(hScoreRaw, 10) : null;
          const aScore = aScoreRaw !== "" && aScoreRaw !== null && aScoreRaw !== undefined ? parseInt(aScoreRaw, 10) : null;

          let status = "SCHEDULED";
          let playedByTime = false;
          const isDead = /\b(aband|interrupt|susp|cancel|postpon|delay|fail.*continu|stop|terminat|void|walkover|retir)/i.test(matchStateRaw);
          if (isDead) {
            status = "ABANDONED";
          } else if (/full|ft|finished|post|ended/i.test(matchStateRaw) || periodNum >= 10) {
            status = "FT";
          } else if (/live|inplay|halftime|half_time|1st|2nd/i.test(matchStateRaw) || (periodNum > 1 && periodNum < 10)) {
            status = "LIVE";
          } else if (koMs <= now - FOOTBALL_PLAYED_ELAPSED_MS) {
            // Once kickoff + full match window (115 min) has elapsed without being live, classify as completed
            status = "FT";
            playedByTime = true;
          }

          const hoursToKickoff = Math.round(((koMs - now) / 3600000) * 10) / 10;
          const linkPath = node.link ? (node.link.startsWith("http") ? node.link : `https://onefootball.com${node.link}`) : `https://onefootball.com/en/match/${matchId}`;

          extracted.push({
            id: `of-${matchId}`,
            onefootballId: matchId,
            onefootballUrl: linkPath,
            homeTeamName: homeName,
            awayTeamName: awayName,
            homeNorm: normTeamKey(homeName),
            awayNorm: normTeamKey(awayName),
            homeLogo: node.homeTeam?.imageObject?.path || "",
            awayLogo: node.awayTeam?.imageObject?.path || "",
            country: countryName,
            leagueName: compName,
            competitionId: compId,
            kickoffIso: new Date(koMs).toISOString(),
            kickoffMs: koMs,
            isoDate: new Date(koMs).toISOString().slice(0, 10),
            kickoffUtc: new Date(koMs).toISOString().slice(11, 16),
            hoursToKickoff,
            isLive: status === "LIVE",
            isAbandoned: isDead,
            isPreMatch5h: status === "SCHEDULED" && koMs - now >= 5 * 3600000,
            playedByTime,
            status,
            matchState: isDead ? (matchStateRaw || "Abandoned") : (playedByTime ? "Full Time (Elapsed)" : (matchStateRaw || (status === "LIVE" ? "Live" : status === "FT" ? "FullTime" : "PreMatch"))),
            period: periodNum || 1,
            minute: status === "LIVE" ? rawMinute : 0,
            displayTime: isDead ? (matchStateRaw || "Abandoned") : (status === "LIVE" ? (rawMinute > 0 ? `${rawMinute}'` : node.timePeriod || "LIVE") : new Date(koMs).toISOString().slice(11, 16)),
            homeScore: Number.isFinite(hScore) ? hScore : null,
            awayScore: Number.isFinite(aScore) ? aScore : null
          });
        }
      }
    }

    for (const k of Object.keys(node)) {
      if (k !== "trackingEvents") walk(node[k], nextComp);
    }
  }

  walk(containers, "");
  return extracted;
}

function refreshStatusesByTime(payload, nowMs = Date.now()) {
  if (!payload || !Array.isArray(payload.matches)) return payload;
  for (const m of payload.matches) {
    if (m.isAbandoned || /\b(aband|interrupt|susp|cancel|postpon|delay|fail.*continu|stop|terminat|void|walkover|retir)/i.test(`${m.matchState || ""} ${m.status || ""}`)) {
      m.status = "ABANDONED";
      m.isLive = false;
      m.isAbandoned = true;
      m.isPreMatch5h = false;
      continue;
    }
    if (m.status === "SCHEDULED" && Number.isFinite(m.kickoffMs)) {
      if (m.kickoffMs <= nowMs - FOOTBALL_PLAYED_ELAPSED_MS) {
        m.status = "FT";
        m.isLive = false;
        m.isPreMatch5h = false;
        m.playedByTime = true;
        m.matchState = "Full Time (Elapsed)";
      } else {
        m.hoursToKickoff = Math.round(((m.kickoffMs - nowMs) / 3600000) * 10) / 10;
        m.isPreMatch5h = m.kickoffMs - nowMs >= 5 * 3600000;
      }
    }
  }
  payload.liveCount = payload.matches.filter((m) => m.status === "LIVE" && !m.isAbandoned).length;
  payload.scheduledCount = payload.matches.filter((m) => m.status === "SCHEDULED" && !m.isAbandoned).length;
  payload.ftCount = payload.matches.filter((m) => m.status === "FT").length;
  payload.preMatch5hCount = payload.matches.filter((m) => m.isPreMatch5h).length;
  return payload;
}

async function fetchOneFootballSchedule(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSchedule && now < cachedExpiresAt) {
    return refreshStatusesByTime(cachedSchedule, now);
  }
  if (inFlightFetch) return inFlightFetch;

  inFlightFetch = (async () => {
    try {
      const days = [0, 1, 2].map((off) => {
        const d = new Date(Date.now() + off * 86400000);
        const iso = d.toISOString().slice(0, 10);
        const url = off === 0 ? "https://onefootball.com/en/matches" : `https://onefootball.com/en/matches?date=${iso}`;
        return { off, iso, url };
      });

      const pages = await Promise.all(
        days.map(async (dy) => {
          try {
            const resp = await fetch(dy.url, {
              headers: {
                "User-Agent": UA,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
              },
              signal: AbortSignal.timeout(9000)
            });
            if (!resp.ok) return [];
            const html = await resp.text();
            return parseOneFootballPage(html, dy.iso);
          } catch {
            return [];
          }
        })
      );

      const dedupMap = new Map();
      for (const list of pages) {
        for (const item of list) {
          const prev = dedupMap.get(item.onefootballId);
          if (!prev || (item.leagueName !== "International Football" && prev.leagueName === "International Football")) {
            dedupMap.set(item.onefootballId, item);
          }
        }
      }

      const matches = Array.from(dedupMap.values()).sort((a, b) => a.kickoffMs - b.kickoffMs);
      const payload = refreshStatusesByTime({
        ok: true,
        source: "https://onefootball.com/en/matches",
        fetchedAt: new Date().toISOString(),
        totalMatches: matches.length,
        liveCount: 0,
        scheduledCount: 0,
        ftCount: 0,
        preMatch5hCount: 0,
        matches
      }, Date.now());

      if (matches.length > 0 || !cachedSchedule) {
        cachedSchedule = payload;
        cachedExpiresAt = Date.now() + CACHE_TTL_MS;
      }
      return payload;
    } finally {
      inFlightFetch = null;
    }
  })();

  return inFlightFetch;
}

function findOneFootballMatch(homeName, awayName, schedulePayload = cachedSchedule) {
  const list = schedulePayload?.matches || [];
  if (!homeName || !awayName || list.length === 0) return null;
  for (const ofm of list) {
    if (teamNamesSimilar(homeName, ofm.homeTeamName) && teamNamesSimilar(awayName, ofm.awayTeamName)) {
      return ofm;
    }
  }
  return null;
}

async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url || "/api/onefootball", "http://localhost");
    const refresh = reqUrl.searchParams.get("refresh") === "1";
    const data = await fetchOneFootballSchedule(refresh);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache"
    });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: err?.message || "OneFootball proxy failed" }));
  }
}

handler.fetchOneFootballSchedule = fetchOneFootballSchedule;
handler.findOneFootballMatch = findOneFootballMatch;
handler.normTeamKey = normTeamKey;
handler.teamNamesSimilar = teamNamesSimilar;

module.exports = handler;
