(() => {
  const LEAGUES = window.MAMON_LEAGUES || [];
  const DATA = window.MAMON_DATA || {};
  const RT = window.MAMON_REALTIME;
  const TEAMS = DATA.TEAMS || {};
  const STORAGE_KEY = "mamon_win_realtime_v2";

  const leagueBySlug = new Map(LEAGUES.map((l) => [l.slug, l]));

  const CURRENCIES = {
    GHS: { symbol: "₵", label: "GHS ₵" },
    USD: { symbol: "$", label: "USD $" },
    EUR: { symbol: "€", label: "EUR €" },
    GBP: { symbol: "£", label: "GBP £" },
    NGN: { symbol: "₦", label: "NGN ₦" }
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function makeMonogramSvg(label, color = "#0A7B5C") {
    const clean = (label || "MW").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "MW";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="${color}"/><text x="18" y="22.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11.5" font-weight="700" fill="#FFFFFF">${clean}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  window.mamonFallbackImg = function (img, label, color) {
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = "1";
    img.src = makeMonogramSvg(label, color);
  };

  function crestImg(src, label, color = "#0A7B5C", size = 20) {
    const safeLabel = escapeHtml(label);
    const safeSrc = escapeHtml(src || makeMonogramSvg(label, color));
    return `<img src="${safeSrc}" alt="${safeLabel}" width="${size}" height="${size}" loading="lazy" decoding="async" onerror="window.mamonFallbackImg(this,'${safeLabel.replace(/'/g, "")}','${escapeHtml(color)}')">`;
  }

  function formatMatchScore(m) {
    if (!m) return "vs";
    const isLive = m.status === "LIVE";
    const isFT = m.status === "FT";
    if (!isLive && !isFT) return "vs";

    const h = m.homeScore;
    const a = m.awayScore;
    const isValid = (v) => v !== null && v !== undefined && v !== "" && String(v).toLowerCase() !== "null" && !Number.isNaN(v);

    if (isValid(h) && isValid(a)) {
      return `${h} - ${a}`;
    }
    if (isLive) {
      return "0 - 0";
    }
    return "vs";
  }

  function formatSingleScore(val, isLive) {
    if (val !== null && val !== undefined && val !== "" && String(val).toLowerCase() !== "null" && !Number.isNaN(val)) {
      return String(val);
    }
    return isLive ? "0" : "-";
  }

  function isNcaaOrWomenMatch(mOrGame) {
    if (!mOrGame) return false;
    const text = [
      mOrGame.leagueName,
      mOrGame.league,
      mOrGame.leagueSlug,
      mOrGame.homeTeamName,
      mOrGame.awayTeamName,
      mOrGame.home,
      mOrGame.away,
      mOrGame.name,
      mOrGame.tournamentName,
      mOrGame._tournamentName
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const banned = [
      /\bncaa\b/i,
      /\bnacca\b/i,
      /\bwomen('s)?\b/i,
      /\(w\)\b/i,
      /\bwbb\b/i,
      /\bwnba\b/i,
      /\bdivision i women\b/i,
      /\bcollege w(omen)?\b/i,
      /\bladies\b/i,
      /\bfemenil\b/i,
      /\bfeminina\b/i,
      /\bfem\b/i
    ];
    return banned.some((rx) => rx.test(text));
  }

  function loadState() {
    const defaults = {
      route: "/",
      activeSport: "ALL", // ALL | football | tennis | basketball | darts | hockey
      selectedDate: "UPCOMING_ALL",
      matchFilter: "LIVE", // LIVE | SCHEDULED | DROPS | ALERTS | FT
      activeIntelTab: "DROPS", // DROPS | ALERTS
      activeDropFilter: "ALL", // ALL | HEAVY | MODERATE | INPLAY | PREMATCH
      activePpgCategory: "ALL", // ALL | HIGH_GAP | HOME_DOMINANT | AWAY_DOMINANT | POINTS_STAKES
      activeStrongFilter: "ALL", // ALL | STRONG_HOME | STRONG_AWAY
      activeWorstFilter: "ALL", // ALL | WORST_HOME | WORST_AWAY
      activePowerCategory: "ALL", // ALL | STRONG_HOME | STRONG_AWAY | WORST_HOME | WORST_AWAY (backwards compatible)
      activeMismatchCategory: "ALL", // ALL | STRONG_HOME | STRONG_AWAY | WORST_HOME | WORST_AWAY | ALL_GAMES
      activeHandicapFilter: "ALL", // ALL | SAFE_PLUS | DOUBLE_CHANCE | FAVORITE_MINUS | HIGH_PROB
      activeSpecialTipTab: "5MIN_DRAW", // 5MIN_DRAW | NO_3_ROW | SLIPS | LEAGUES
      activeSpecialTipFilter: "ALL", // ALL | TODAY | HIGH_PROB | HIGH_EV
      activeRuninLeague: "england",
      activeRuninFilter: "ALL", // ALL | FAVORABLE | TOUGH | STRONG_PPG_EASY
      standingsLeague: "england-premier-league",
      followedClubs: ["arsenal", "realmadrid", "barcelona", "liverpool"],
      followedLeagues: ["england-premier-league", "spain-la-liga", "uefa-champions-league"],
      activeSureTier: "2",
      stakeAmount: 20,
      stakeCurrency: "GHS",
      slipSeed: 0,
      expandedLegs: {},
      theme: "light",
      oddsFormat: "decimal",
      liveTicker: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "GMT"
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const merged = { ...defaults, ...saved };
      // Migrate legacy filters: no "ALL", no "FOLLOWING"
      if (merged.matchFilter === "ALL" || merged.matchFilter === "FOLLOWING" || !merged.matchFilter) {
        merged.matchFilter = "LIVE";
      }
      delete merged.followedMatches;
      // Ensure old past selectedDate never hides today's matches
      if (merged.selectedDate !== "UPCOMING_ALL" && merged.selectedDate < (DATA.todayIso || "")) {
        merged.selectedDate = "UPCOMING_ALL";
      }
      if (!CURRENCIES[merged.stakeCurrency]) merged.stakeCurrency = "GHS";
      return merged;
    } catch {
      return defaults;
    }
  }

  let state = loadState();
  let liveMatches = [];
  let finishedTodayMatches = [];
  let sureSlips = {};
  let isLoadingRealtime = true;
  let lastSyncIso = null;
  let activeModalMatchId = null;
  let activeModalTab = "overview";
  let isHydratingPowerWeather = false;
  let bookmakerScan = null;
  let isLoadingBookmakers = true;
  const runinLeagueCacheClient = new Map();
  let runinCatalogClient = [];
  let isLoadingRuninView = false;
  let expandedRuninTeam = null;

  async function loadRuninLeague(leagueCode, force = false) {
    const code = String(leagueCode || state.activeRuninLeague || "england").toLowerCase();
    state.activeRuninLeague = code;
    if (!force && runinLeagueCacheClient.has(code)) {
      if (state.route === "/run-in") renderMainContent();
      return runinLeagueCacheClient.get(code);
    }
    isLoadingRuninView = true;
    if (state.route === "/run-in") renderMainContent();
    try {
      const data = RT?.fetchLeagueRuninData
        ? await RT.fetchLeagueRuninData(code, force)
        : await fetch(`/api/runin?league=${encodeURIComponent(code)}${force ? "&refresh=1" : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (data?.ok) {
        runinLeagueCacheClient.set(code, data);
        if (data.league?.code) runinLeagueCacheClient.set(data.league.code, data);
        if (Array.isArray(data.leagues) && data.leagues.length > 0) runinCatalogClient = data.leagues;
      }
      return data;
    } catch {
      return null;
    } finally {
      isLoadingRuninView = false;
      if (state.route === "/run-in") renderMainContent();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state }));
    } catch {
      // Ignore quota issues
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme === "dark" ? "dark" : "light");
  }

  function showToast(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span class="live-dot" style="background:#13A87E;"></span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.2s";
      setTimeout(() => toast.remove(), 220);
    }, 3000);
  }

  function formatOdds(decimalVal) {
    if (!decimalVal || !Number.isFinite(decimalVal)) return "-";
    if (decimalVal >= 1000) {
      return decimalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (state.oddsFormat === "decimal") return decimalVal.toFixed(2);
    if (state.oddsFormat === "american") {
      return decimalVal >= 2
        ? `+${Math.round((decimalVal - 1) * 100)}`
        : `-${Math.round(100 / Math.max(0.01, decimalVal - 1))}`;
    }
    const frac = decimalVal - 1;
    const num = Math.max(1, Math.round(frac * 10));
    const den = 10;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(num, den);
    return `${num / g}/${den / g}`;
  }

  function formatMoney(amount, currencyCode = state.stakeCurrency) {
    const sym = CURRENCIES[currencyCode]?.symbol || "$";
    if (!Number.isFinite(amount)) return `${sym}0.00`;
    return `${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function recomputeSlips() {
    if (!RT) return;
    const cleanMatches = liveMatches.filter((m) => !isNcaaOrWomenMatch(m));
    sureSlips = RT.buildSureOddsSlips(cleanMatches, state.slipSeed);
  }

  function getRouteFromHash() {
    const h = window.location.hash.replace(/^#/, "");
    if (!h || !h.startsWith("/")) return "/";
    if (h === "/game-points") return "/sure-odds";
    if (h === "/community") return "/strong-teams";
    if (h === "/power-picks" || h === "/strong-teams-today") return "/strong-teams";
    if (h === "/worst-teams-today") return "/worst-teams";
    if (h === "/ppg-intelligence" || h === "/points-per-game") return "/ppg";
    if (h === "/runin" || h === "/run-in-analysis" || h.startsWith("/run-in?")) return "/run-in";
    if (h === "/drops") return "/dropping-odds";
    if (h === "/accurate-odds" || h === "/accurate-winning-odds" || h === "/banker-of-the-day") return "/sure-odds";
    if (h === "/handicap-tips" || h === "/value-bets") return "/handicap";
    if (h === "/draw-defense" || h === "/5min-draw" || h === "/no-3-in-a-row" || h === "/special-tips" || h === "/defensive-tips") return "/special-tips";
    return h;
  }

  function navigate(route, push = true) {
    if (!route.startsWith("/")) route = "/" + route;
    if (route.startsWith("/accurate-odds") || route.startsWith("/accurate-winning-odds") || route === "/banker-of-the-day") {
      route = "/sure-odds";
    }
    if (route.startsWith("/sure-odds?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("tier")) state.activeSureTier = q.get("tier");
      route = "/sure-odds";
    }
    if (route.startsWith("/handicap?") || route.startsWith("/value-bets?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("filter")) state.activeHandicapFilter = q.get("filter").toUpperCase();
      route = "/handicap";
    }
    if (route === "/handicap-tips" || route === "/value-bets") route = "/handicap";
    if (route.startsWith("/special-tips?") || route.startsWith("/5min-draw?") || route.startsWith("/no-3-in-a-row?") || route.startsWith("/draw-defense?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("tab")) state.activeSpecialTipTab = q.get("tab").toUpperCase();
      if (q.get("filter")) state.activeSpecialTipFilter = q.get("filter").toUpperCase();
      route = "/special-tips";
    }
    if (route === "/5min-draw" || route === "/no-3-in-a-row" || route === "/draw-defense" || route === "/defensive-tips") route = "/special-tips";
    if (route.startsWith("/dropping-odds?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("filter")) state.activeDropFilter = q.get("filter").toUpperCase();
      if (q.get("tab")) state.activeIntelTab = q.get("tab").toUpperCase();
      route = "/dropping-odds";
    }
    if (route === "/drops") route = "/dropping-odds";
    if (route.startsWith("/ppg?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("cat")) state.activePpgCategory = q.get("cat").toUpperCase();
      route = "/ppg";
    }
    if (route === "/ppg-intelligence" || route === "/points-per-game") route = "/ppg";
    if (route.startsWith("/run-in?") || route.startsWith("/runin?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("league")) state.activeRuninLeague = q.get("league").toLowerCase();
      if (q.get("filter")) state.activeRuninFilter = q.get("filter").toUpperCase();
      route = "/run-in";
    }
    if (route === "/runin" || route === "/run-in-analysis") route = "/run-in";
    if (route.startsWith("/strong-teams?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("cat")) state.activeStrongFilter = q.get("cat").toUpperCase();
      route = "/strong-teams";
    }
    if (route.startsWith("/worst-teams?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("cat")) state.activeWorstFilter = q.get("cat").toUpperCase();
      route = "/worst-teams";
    }
    if (route.startsWith("/power-picks?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      const cat = q.get("cat")?.toUpperCase();
      if (cat === "WORST_HOME" || cat === "WORST_AWAY") {
        state.activeWorstFilter = cat;
        route = "/worst-teams";
      } else {
        if (cat) state.activeStrongFilter = cat;
        route = "/strong-teams";
      }
    }
    if (route.startsWith("/odds-mismatch?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("cat")) state.activeMismatchCategory = q.get("cat").toUpperCase();
      route = "/odds-mismatch";
    }
    if (route === "/live") {
      state.matchFilter = "LIVE";
      route = "/live";
    }
    if (route === "/upcoming" || route === "/matches") {
      state.matchFilter = "SCHEDULED";
      route = "/upcoming";
    }
    if (route === "/game-points") route = "/sure-odds";
    if (route === "/community" || route === "/strong-teams-today" || route === "/power-picks") route = "/strong-teams";
    if (route === "/worst-teams-today") route = "/worst-teams";
    state.route = route;
    if (push) {
      window.location.hash = "#" + route;
    }
    saveState();
    if (route === "/run-in") {
      loadRuninLeague(state.activeRuninLeague || "england");
    }
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getTeam(key, fallbackName = "Club") {
    return TEAMS[key] || { key, name: fallbackName, short: fallbackName.slice(0, 3).toUpperCase(), color: "#0A7B5C", logo: "" };
  }

  function getLeagueInfo(mOrSlug) {
    if (typeof mOrSlug === "object" && mOrSlug !== null) {
      const staticLg = leagueBySlug.get(mOrSlug.leagueSlug);
      return {
        slug: mOrSlug.leagueSlug,
        href: `/competitions/${mOrSlug.leagueSlug}`,
        name: mOrSlug.leagueName || staticLg?.name || mOrSlug.leagueSlug,
        country: mOrSlug.leagueCountry || staticLg?.country || "Football",
        logo: mOrSlug.leagueLogo || staticLg?.logo || ""
      };
    }
    const staticLg = leagueBySlug.get(mOrSlug);
    if (staticLg) return staticLg;
    return {
      slug: mOrSlug,
      href: `/competitions/${mOrSlug}`,
      name: String(mOrSlug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      country: "Football",
      logo: ""
    };
  }

  const ALLOWED_SPORTS = [
    { key: "ALL", label: "All 5 Sports", icon: "🏆" },
    { key: "football", label: "Football", icon: "⚽" },
    { key: "tennis", label: "Tennis", icon: "🎾" },
    { key: "basketball", label: "Basketball", icon: "🏀" },
    { key: "darts", label: "Darts", icon: "🎯" },
    { key: "hockey", label: "Ice Hockey", icon: "🏒" }
  ];

  function renderSubnav() {
    const scrollEl = document.getElementById("subnavScroll");
    const mobileEl = document.getElementById("subnavMobile");
    const currentSport = (state.activeSport || "ALL").toLowerCase();

    // Count matches per sport (restricted strictly to the 5 allowed sports, excluding NCAA/women)
    const sportCounts = { all: 0, tennis: 0, basketball: 0, darts: 0, hockey: 0, football: 0 };
    liveMatches.forEach((m) => {
      if (isNcaaOrWomenMatch(m)) return;
      const sp = (m.sport || "football").toLowerCase();
      if (sportCounts[sp] !== undefined) {
        sportCounts[sp]++;
        sportCounts.all++;
      }
    });

    if (scrollEl) {
      scrollEl.innerHTML = ALLOWED_SPORTS.map((s) => {
        const isActive = currentSport === s.key.toLowerCase() ? " is-active" : "";
        const count = sportCounts[s.key.toLowerCase()] || 0;
        return `
          <button type="button" class="sport-pill${isActive}" data-sport-filter="${s.key}" title="Filter games by ${escapeHtml(s.label)}">
            <span>${s.icon}</span>
            <span>${escapeHtml(s.label)}</span>
            <span class="sport-count">${count}</span>
          </button>
        `;
      }).join("");
    }

    if (mobileEl) {
      mobileEl.innerHTML = ALLOWED_SPORTS.map((s) => {
        const isActive = currentSport === s.key.toLowerCase() ? " is-active" : "";
        const count = sportCounts[s.key.toLowerCase()] || 0;
        return `
          <button type="button" class="sport-pill${isActive}" data-sport-filter="${s.key}">
            <span>${s.icon}</span>
            <span>${escapeHtml(s.label)}</span>
            <span class="sport-count">${count}</span>
          </button>
        `;
      }).join("");
    }
  }

  function renderHeaderState() {
    const baseRoute = state.route.startsWith("/competitions/")
      ? "/matches"
      : state.route;

    document.querySelectorAll("#topbarNav a, #bottomTabbar a").forEach((a) => {
      const r = a.getAttribute("data-route");
      if (r === baseRoute) {
        a.setAttribute("aria-current", "page");
      } else {
        a.removeAttribute("aria-current");
      }
    });
  }

  function renderFooterPopular() {
    const el = document.getElementById("footerPopularClubs");
    if (!el || el.dataset.populated) return;
    const popularKeys = ["arsenal", "realmadrid", "liverpool", "barcelona", "mancity", "bayern", "kotoko"];
    el.innerHTML = popularKeys
      .map((k) => {
        const t = TEAMS[k];
        if (!t) return "";
        return `<li>
          <a class="popular-item" href="/competitions/${t.league}" data-route="/competitions/${t.league}">
            ${crestImg(t.logo, t.name, t.color, 16)}
            <span>${escapeHtml(t.name)}</span>
          </a>
        </li>`;
      })
      .join("");
    el.dataset.populated = "1";
  }

  // ============ 11-FACTOR MATCH ANALYSIS MATRIX RENDERER ============
  function render11FactorAnalysisGrid(match) {
    const home = getTeam(match.home, "Home");
    const away = getTeam(match.away, "Away");
    const a = match.analysis || (RT ? RT.buildMatchAnalysis(match) : null);
    if (!a || !a.factors) {
      return `<div class="p-3 text-xs text-muted">Loading real-time 11-factor telemetry...</div>`;
    }
    const f = a.factors;

    const formBadges = (arr) =>
      `<div class="form-dots">${(arr || []).map((x) => `<span class="form-dot ${x}">${x}</span>`).join("")}</div>`;

    const gamePills = (games) =>
      `<div class="flex flex-wrap gap-1 mt-1">${(games || [])
        .slice(0, 5)
        .map(
          (g) => `<span class="mini-score-pill" title="${escapeHtml(g.opponent || "")}">
            <span class="form-dot ${g.result}" style="width:14px;height:14px;font-size:9px;">${g.result}</span>
            <span>${escapeHtml(g.score)} ${escapeHtml(g.opponent || "").slice(0, 8)}</span>
          </span>`
        )
        .join("")}</div>`;

    return `
      <div class="factors-matrix">
        <!-- 1. Head to Head -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">1. Head-to-Head (H2H)</span>
            <span class="factor-edge-pill">${f.h2h.isLiveFeed ? `${f.h2h.meetings} meetings` : "Baseline"}</span>
          </div>
          <div class="text-xs font-semibold">${escapeHtml(f.h2h.summary)}</div>
          <div class="text-xs text-muted">Record (${escapeHtml(home.short)}-D-${escapeHtml(away.short)}): <strong class="font-mono text-text">${f.h2h.homeWins}-${f.h2h.draws}-${f.h2h.awayWins}</strong> · Avg Goals <strong class="font-mono text-brand">${f.h2h.avgGoals}</strong></div>
          ${
            f.h2h.recent?.length
              ? `<div class="flex flex-wrap gap-1 mt-1">${f.h2h.recent.map((r) => `<span class="mini-score-pill">${escapeHtml(r.label)}</span>`).join("")}</div>`
              : `<button type="button" class="analyze-inline-btn mt-1" data-hydrate-match="${match.id}">Fetch Full Live H2H</button>`
          }
        </div>

        <!-- 2. Current Form -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">2. Current Form (Overall)</span>
            <span class="factor-edge-pill">Edge: ${escapeHtml(f.currentForm.edge)}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} (${f.currentForm.homePts}/15 pts · ${escapeHtml(f.currentForm.homeRecord)})</div>
              ${formBadges(f.currentForm.homeForm)}
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} (${f.currentForm.awayPts}/15 pts · ${escapeHtml(f.currentForm.awayRecord)})</div>
              ${formBadges(f.currentForm.awayForm)}
            </div>
          </div>
        </div>

        <!-- 3. Injuries -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">3. Injuries</span>
            <span class="factor-edge-pill">Fitter: ${escapeHtml(f.injuries.edge)}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} Injuries</div>
              <div class="text-xs">${f.injuries.home.length ? f.injuries.home.map((x) => `• ${escapeHtml(x)}`).join("<br>") : escapeHtml(f.injuries.statusTextHome)}</div>
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} Injuries</div>
              <div class="text-xs">${f.injuries.away.length ? f.injuries.away.map((x) => `• ${escapeHtml(x)}`).join("<br>") : escapeHtml(f.injuries.statusTextAway)}</div>
            </div>
          </div>
        </div>

        <!-- 4. Suspensions -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">4. Suspensions &amp; Cards</span>
            <span class="factor-edge-pill">RC: ${f.suspensions.homeRedSeason} vs ${f.suspensions.awayRedSeason}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} Suspensions</div>
              <div class="text-xs">${escapeHtml(f.suspensions.statusTextHome)}</div>
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} Suspensions</div>
              <div class="text-xs">${escapeHtml(f.suspensions.statusTextAway)}</div>
            </div>
          </div>
        </div>

        <!-- 5. Last 5 Games for Home Games -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">5. Last 5 Home Games (${escapeHtml(home.short)})</span>
            <span class="factor-edge-pill">${f.last5HomeGames.wins}W-${f.last5HomeGames.draws}D-${f.last5HomeGames.losses}L</span>
          </div>
          <div class="text-xs text-muted">${f.last5HomeGames.isLiveFeed ? `Scored ${f.last5HomeGames.gf} · Conceded ${f.last5HomeGames.ga} at Home` : "Tap Refresh Live Stats for venue split"}</div>
          ${gamePills(f.last5HomeGames.games)}
        </div>

        <!-- 6. Last 5 Games for Away Games -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">6. Last 5 Away Games (${escapeHtml(away.short)})</span>
            <span class="factor-edge-pill">${f.last5AwayGames.wins}W-${f.last5AwayGames.draws}D-${f.last5AwayGames.losses}L</span>
          </div>
          <div class="text-xs text-muted">${f.last5AwayGames.isLiveFeed ? `Scored ${f.last5AwayGames.gf} · Conceded ${f.last5AwayGames.ga} Away` : "Tap Refresh Live Stats for venue split"}</div>
          ${gamePills(f.last5AwayGames.games)}
        </div>

        <!-- 7. Goals Scored -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">7. Goals Scored</span>
            <span class="factor-edge-pill">Edge: ${escapeHtml(f.goalsScored.edge)}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} Attack</div>
              <div class="font-mono font-bold text-brand">${f.goalsScored.homeAvg}/g <span class="text-muted font-normal">(${f.goalsScored.homeTotal} tot)</span></div>
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} Attack</div>
              <div class="font-mono font-bold text-brand">${f.goalsScored.awayAvg}/g <span class="text-muted font-normal">(${f.goalsScored.awayTotal} tot)</span></div>
            </div>
          </div>
        </div>

        <!-- 8. Goals Conceded -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">8. Goals Conceded</span>
            <span class="factor-edge-pill">Tighter: ${escapeHtml(f.goalsConceded.edge)}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} Defense</div>
              <div class="font-mono font-bold">${f.goalsConceded.homeAvg}/g <span class="text-muted font-normal">(${f.goalsConceded.homeTotal} tot)</span></div>
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} Defense</div>
              <div class="font-mono font-bold">${f.goalsConceded.awayAvg}/g <span class="text-muted font-normal">(${f.goalsConceded.awayTotal} tot)</span></div>
            </div>
          </div>
        </div>

        <!-- 9. Clean Sheets Kept for Home Games -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">9. Clean Sheets (Home Games)</span>
            <span class="factor-edge-pill">${f.cleanSheetsHome.pct}% Home CS</span>
          </div>
          <div class="text-xs font-semibold">${escapeHtml(home.name)}: <span class="font-mono text-brand">${escapeHtml(f.cleanSheetsHome.label)}</span></div>
          <div class="stat-bar-track mt-1"><div class="stat-bar-home" style="width:${f.cleanSheetsHome.pct}%"></div></div>
        </div>

        <!-- 10. Clean Sheets Kept for Away Games -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">10. Clean Sheets (Away Games)</span>
            <span class="factor-edge-pill">${f.cleanSheetsAway.pct}% Away CS</span>
          </div>
          <div class="text-xs font-semibold">${escapeHtml(away.name)}: <span class="font-mono text-brand">${escapeHtml(f.cleanSheetsAway.label)}</span></div>
          <div class="stat-bar-track mt-1"><div class="stat-bar-home" style="width:${f.cleanSheetsAway.pct}%"></div></div>
        </div>

        <!-- 11. Run-in Analysis for Both Teams (SoccerSTATS PLD vs REM Methodology) -->
        <div class="factor-tile is-wide">
          <div class="factor-tile-head">
            <span class="factor-name">11. Run-in Analysis (Opponents Played PLD vs Remaining REM)</span>
            <span class="factor-edge-pill">${escapeHtml(f.runInAnalysis.edge)}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="side-lbl">${escapeHtml(home.short)} · ${escapeHtml(f.runInAnalysis.homeStake)}</div>
                ${f.runInAnalysis.homeStats ? `<span class="runin-diff-pill ${f.runInAnalysis.homeStats.diffPct > 0 ? "is-easy" : f.runInAnalysis.homeStats.diffPct < 0 ? "is-tough" : "is-balanced"}" style="font-size:10.5px;">${escapeHtml(f.runInAnalysis.homeStats.diffLabel)} ${f.runInAnalysis.homeStats.diffPct > 0 ? "Easier" : f.runInAnalysis.homeStats.diffPct < 0 ? "Tougher" : "Balanced"}</span>` : ""}
              </div>
              ${f.runInAnalysis.homeStats ? `
                <div class="runin-inline-strip">
                  <span>PLD PPG: <strong class="font-mono text-text">${f.runInAnalysis.homeStats.playedPpg.toFixed(2)}</strong></span>
                  <span>&bull;</span>
                  <span>REM PPG: <strong class="font-mono" style="color:#3B82F6;">${f.runInAnalysis.homeStats.remainingPpg.toFixed(2)}</strong></span>
                  <span class="text-muted font-mono" style="margin-left:auto;font-size:10px;">${escapeHtml(f.runInAnalysis.homeStats.source)}</span>
                </div>
              ` : ""}
              <div class="text-xs text-muted mt-1">Rest before KO: <strong class="font-mono text-text">${f.runInAnalysis.homeRestDays ? `${f.runInAnalysis.homeRestDays} days` : "Standard"}</strong></div>
              ${
                f.runInAnalysis.homeStats?.remainingOpponents?.length
                  ? `<div class="text-xs mt-1">Upcoming: ${f.runInAnalysis.homeStats.remainingOpponents.slice(0, 3).map((u) => escapeHtml(`${u.label} (${u.oppVenuePpg?.toFixed(2) ?? "-"})`)).join(" · ")}</div>`
                  : f.runInAnalysis.homeUpcoming?.length
                    ? `<div class="text-xs mt-1">Next: ${f.runInAnalysis.homeUpcoming.slice(0, 2).map((u) => escapeHtml(u.name)).join(" · ")}</div>`
                    : `<div class="text-xs mt-1 text-muted">Upcoming schedule calculated via venue PPG</div>`
              }
              ${f.runInAnalysis.calcHome ? `<div class="text-xs mt-1"><strong>Points:</strong> ${escapeHtml(f.runInAnalysis.calcHome.pointsNeeded)}</div><div class="text-xs mt-1"><strong>Draw:</strong> ${escapeHtml(f.runInAnalysis.calcHome.drawImportance)}</div>` : ""}
            </div>
            <div class="factor-side">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="side-lbl">${escapeHtml(away.short)} · ${escapeHtml(f.runInAnalysis.awayStake)}</div>
                ${f.runInAnalysis.awayStats ? `<span class="runin-diff-pill ${f.runInAnalysis.awayStats.diffPct > 0 ? "is-easy" : f.runInAnalysis.awayStats.diffPct < 0 ? "is-tough" : "is-balanced"}" style="font-size:10.5px;">${escapeHtml(f.runInAnalysis.awayStats.diffLabel)} ${f.runInAnalysis.awayStats.diffPct > 0 ? "Easier" : f.runInAnalysis.awayStats.diffPct < 0 ? "Tougher" : "Balanced"}</span>` : ""}
              </div>
              ${f.runInAnalysis.awayStats ? `
                <div class="runin-inline-strip">
                  <span>PLD PPG: <strong class="font-mono text-text">${f.runInAnalysis.awayStats.playedPpg.toFixed(2)}</strong></span>
                  <span>&bull;</span>
                  <span>REM PPG: <strong class="font-mono" style="color:#3B82F6;">${f.runInAnalysis.awayStats.remainingPpg.toFixed(2)}</strong></span>
                  <span class="text-muted font-mono" style="margin-left:auto;font-size:10px;">${escapeHtml(f.runInAnalysis.awayStats.source)}</span>
                </div>
              ` : ""}
              <div class="text-xs text-muted mt-1">Rest before KO: <strong class="font-mono text-text">${f.runInAnalysis.awayRestDays ? `${f.runInAnalysis.awayRestDays} days` : "Standard"}</strong></div>
              ${
                f.runInAnalysis.awayStats?.remainingOpponents?.length
                  ? `<div class="text-xs mt-1">Upcoming: ${f.runInAnalysis.awayStats.remainingOpponents.slice(0, 3).map((u) => escapeHtml(`${u.label} (${u.oppVenuePpg?.toFixed(2) ?? "-"})`)).join(" · ")}</div>`
                  : f.runInAnalysis.awayUpcoming?.length
                    ? `<div class="text-xs mt-1">Next: ${f.runInAnalysis.awayUpcoming.slice(0, 2).map((u) => escapeHtml(u.name)).join(" · ")}</div>`
                    : `<div class="text-xs mt-1 text-muted">Upcoming schedule calculated via venue PPG</div>`
              }
              ${f.runInAnalysis.calcAway ? `<div class="text-xs mt-1"><strong>Points:</strong> ${escapeHtml(f.runInAnalysis.calcAway.pointsNeeded)}</div><div class="text-xs mt-1"><strong>Draw:</strong> ${escapeHtml(f.runInAnalysis.calcAway.drawImportance)}</div>` : ""}
            </div>
          </div>
        </div>

        <!-- 12. PPG (Points Per Game: Overall, Home & Away) -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">12. PPG (Points Per Game)</span>
            <span class="factor-edge-pill">Edge: ${escapeHtml(f.ppg?.edge || home.short)} (+${f.ppg?.gap?.toFixed(2) ?? "0.00"})</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} Overall &amp; Home PPG</div>
              <div class="font-mono font-bold text-brand">${f.ppg ? f.ppg.homeOverall.toFixed(2) : "-"} PPG <span class="text-muted font-normal">(${f.ppg?.homePlayed ?? "-"} GP)</span></div>
              <div class="text-xs text-muted mt-1">At Home: <strong class="font-mono text-text">${f.ppg?.homeHomePpg !== null && f.ppg?.homeHomePpg !== undefined ? f.ppg.homeHomePpg.toFixed(2) : "-"} PPG</strong></div>
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} Overall &amp; Away PPG</div>
              <div class="font-mono font-bold text-brand">${f.ppg ? f.ppg.awayOverall.toFixed(2) : "-"} PPG <span class="text-muted font-normal">(${f.ppg?.awayPlayed ?? "-"} GP)</span></div>
              <div class="text-xs text-muted mt-1">Away Trips: <strong class="font-mono text-text">${f.ppg?.awayAwayPpg !== null && f.ppg?.awayAwayPpg !== undefined ? f.ppg.awayAwayPpg.toFixed(2) : "-"} PPG</strong></div>
            </div>
          </div>
        </div>

        <!-- 13. Dropping Odds (Open -> Current / Close) -->
        <div class="factor-tile">
          <div class="factor-tile-head">
            <span class="factor-name">13. Dropping Odds (${escapeHtml(f.droppingOdds?.provider || "Market")})</span>
            <span class="factor-edge-pill">${f.droppingOdds?.bestDrop ? `▼ ${escapeHtml(f.droppingOdds.bestDrop.code)} -${f.droppingOdds.bestDrop.dropPct}%` : "Stable"}</span>
          </div>
          ${
            f.droppingOdds?.allMoves?.length
              ? `<div class="flex flex-col gap-1">
                  ${f.droppingOdds.allMoves
                    .slice(0, 4)
                    .map((mv) => {
                      const isDrop = mv.dropPct >= 2;
                      const isDrift = mv.dropPct <= -3;
                      return `<div class="flex items-center justify-between text-xs gap-2">
                        <span class="truncate font-semibold">${escapeHtml(mv.label)}</span>
                        <span class="font-mono shrink-0">
                          <span class="text-muted">${mv.openOdd.toFixed(2)}</span> &rarr;
                          <strong class="${isDrop ? "text-brand" : isDrift ? "text-live" : "text-text"}">${mv.currentOdd.toFixed(2)}</strong>
                          ${mv.dropPct > 0 ? `<span class="drop-badge">▼ -${mv.dropPct}%</span>` : mv.dropPct < 0 ? `<span class="text-muted">▲ +${Math.abs(mv.dropPct)}%</span>` : ""}
                        </span>
                      </div>`;
                    })
                    .join("")}
                </div>`
              : `<div class="text-xs text-muted">Open-vs-close DraftKings telemetry tracks live drops here once posted for this league.</div>`
          }
        </div>

        <!-- 14. Stadium Weather Conditions -->
        <div class="factor-tile is-wide">
          <div class="factor-tile-head">
            <span class="factor-name">14. Stadium Weather Conditions (${escapeHtml(match.venue || match.venueCity || "Pitch")})</span>
            <span class="factor-edge-pill">${f.weather?.ok ? `${f.weather.tempC}°C · ${escapeHtml(f.weather.condition)}` : "Forecast Sync"}</span>
          </div>
          <div class="text-xs">
            ${
              f.weather?.ok
                ? `<strong class="font-mono text-brand">${f.weather.tempC}°C</strong> · ${escapeHtml(f.weather.condition)} · Wind <strong class="font-mono">${f.weather.windKmh} km/h</strong> · Rain <strong class="font-mono">${f.weather.precipMm}mm</strong> (${escapeHtml(f.weather.impact)})`
                : `${escapeHtml(match.venueCity ? `${match.venueCity}, ${match.venueCountry}` : "Match venue")} — ${escapeHtml(f.weather?.impact || "Normal playing conditions")}`
            }
          </div>
        </div>
      </div>
    `;
  }

  // ============ PROMINENT HOME SURE ODDS COMMAND WIDGET ============
  function renderHomeSureOddsBanner() {
    const tiers = RT?.SURE_TIERS || [];
    const activeTierId = state.activeSureTier || "2";
    const activeSlip = sureSlips[activeTierId] || { title: `${activeTierId} Sure Odds`, legs: [], totalOdds: 0, estWinPct: 0 };
    const payout = (Number(state.stakeAmount) || 0) * (activeSlip.totalOdds || 0);

    return `
      <section class="sure-home-command" id="sureOddsHomeCard">
        <div class="sure-command-top">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="sure-pill-tag">11-FACTOR LIVE ENGINE</span>
              <span class="sure-pill-tag">${liveMatches.length} ACTIVE FIXTURES</span>
            </div>
            <h2 class="sure-command-title mt-2">Sure Odds Accumulators · Stake to Win</h2>
            <p class="text-xs mt-1" style="color:#D1E0D9;">Built strictly from real-time matches using Head-to-Head, Form, Injuries, Suspensions, Last 5 Home/Away, Goals, Clean Sheets &amp; Run-in Analysis.</p>
          </div>
          <a href="/sure-odds" data-route="/sure-odds" class="btn-sure-cta">Open Full Sure Odds &rarr;</a>
        </div>

        <div class="sure-tier-bar" role="tablist" aria-label="Sure Odds Tiers">
          ${tiers
            .map((t) => {
              const s = sureSlips[t.id];
              const isAct = activeTierId === t.id;
              const shortNum = t.id === "1000000" ? "1M" : t.id;
              const oddsLabel = s ? (s.totalOdds >= 1000 ? "1M+" : s.totalOdds.toFixed(1) + "x") : `${shortNum}x`;
              return `
                <button type="button" class="sure-tier-btn${isAct ? " is-active" : ""}" data-select-tier="${t.id}">
                  <span class="tier-num">${shortNum} Odds</span>
                  <span class="tier-sub">${oddsLabel}</span>
                </button>
              `;
            })
            .join("")}
        </div>

        <div class="sure-preview-strip">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <span class="font-semibold text-sm text-white">${escapeHtml(activeSlip.title)}</span>
              <span class="text-xs ml-2" style="color:#7CE8C4;">${activeSlip.legs.length} Real-Time Legs · Combined <strong class="font-mono">${formatOdds(activeSlip.totalOdds)}x</strong></span>
            </div>
            <a href="/sure-odds" data-route="/sure-odds" class="text-xs font-bold" style="color:#7CE8C4;text-decoration:underline;">Inspect all ${activeSlip.legs.length} legs &amp; 11 factors &rarr;</a>
          </div>

          ${
            activeSlip.legs.length === 0
              ? `<div class="text-xs" style="color:#D1E0D9;">Syncing real-time fixtures &amp; odds from ESPN...</div>`
              : `<div class="sure-leg-mini-list">
                  ${activeSlip.legs
                    .slice(0, 4)
                    .map((leg) => {
                      const h = getTeam(leg.match.home);
                      const a = getTeam(leg.match.away);
                      const ppgBadgeHtml = leg.ppgStrength
                        ? `<span class="sure-mini-ppg-badge">💎 PPG ${leg.ppgStrength.strongPpg.toFixed(2)} (+${leg.ppgStrength.gap.toFixed(2)})</span>`
                        : "";
                      return `
                        <button type="button" class="sure-leg-mini" data-match-id="${leg.match.id}" data-open-analysis="1">
                          <div class="min-w-0">
                            <div class="font-semibold truncate">${escapeHtml(h.short)} vs ${escapeHtml(a.short)} <span class="text-muted">(${escapeHtml(leg.match.status === "LIVE" ? leg.match.displayTime : leg.match.displayTime)})</span></div>
                            <div class="truncate" style="font-size:11px;color:#A8C6BC;">${escapeHtml(leg.market.label)} ${ppgBadgeHtml}</div>
                          </div>
                          <span class="pick-badge">@ ${leg.market.odds.toFixed(2)}</span>
                        </button>
                      `;
                    })
                    .join("")}
                </div>`
          }

          <div class="sure-calc-inline">
            <div class="text-xs" style="color:#D1E0D9;">
              Stake <strong class="font-mono text-white">${formatMoney(state.stakeAmount)}</strong> &rarr; Potential Win: <strong class="font-mono" style="color:#7CE8C4;font-size:15px;">${formatMoney(payout)}</strong>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" class="analyze-inline-btn" data-regen-slip="1" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.2);">Shuffle Legs</button>
              <a href="/sure-odds" data-route="/sure-odds" class="analyze-inline-btn" style="background:#13A87E;color:#07100F;border-color:#7CE8C4;font-weight:700;">Stake Calculator &amp; All 11 Factors</a>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  // ============ DEDICATED /sure-odds FULL PAGE VIEW ============
  function renderSureOddsView() {
    const tiers = RT?.SURE_TIERS || [];
    const activeTierId = state.activeSureTier || "2";
    const slip = sureSlips[activeTierId] || { id: activeTierId, title: `${activeTierId} Sure Odds`, legs: [], totalOdds: 0, estWinPct: 0, subtitle: "" };
    const stake = Number(state.stakeAmount) || 0;
    const potentialWin = stake * (slip.totalOdds || 0);
    const netProfit = Math.max(0, potentialWin - stake);

    return `
      <div class="hero-banner">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="sure-pill-tag" style="background:#10B981;color:#07100F;font-weight:800;">💎 STRONG PPG ENGINE ENFORCED</span>
          <span class="sure-pill-tag">REAL-TIME VERIFIED FIXTURES ONLY</span>
          <span class="sure-pill-tag">11-FACTOR ENGINE</span>
        </div>
        <h1 class="mt-2">Sure Odds Builder (2 to 1,000,000 Odds)</h1>
        <p>${escapeHtml(slip.subtitle || "Multi-factor football slips analyzed across H2H, Current Form, Injuries, Suspensions, Last 5 Home/Away Games, Goals Scored/Conceded, Clean Sheets & Run-in Schedule — strictly filtered by Strong PPG with zero DROP_RED risks.")}</p>

        <div class="sure-tier-bar" style="margin-top:16px;">
          ${tiers
            .map((t) => {
              const s = sureSlips[t.id];
              const isAct = activeTierId === t.id;
              const shortNum = t.id === "1000000" ? "1M" : t.id;
              const oddsLabel = s ? (s.totalOdds >= 1000 ? "1M+" : s.totalOdds.toFixed(1) + "x") : `${shortNum}x`;
              return `
                <button type="button" class="sure-tier-btn${isAct ? " is-active" : ""}" data-select-tier="${t.id}">
                  <span class="tier-num">${shortNum} Odds</span>
                  <span class="tier-sub">${oddsLabel}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>

      <!-- Interactive Stake-to-Win Calculator -->
      <section class="stake-calc-panel">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 class="font-headline text-lg font-bold">${escapeHtml(slip.title)} · Stake to Win Calculator</h2>
            <p class="text-xs text-text-secondary">${slip.legs.length} real-time matches selected · Zero past or dead games</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            ${[10, 25, 50, 100, 500]
              .map((amt) => `<button type="button" class="quick-stake-btn${Number(state.stakeAmount) === amt ? " is-active" : ""}" data-quick-stake="${amt}">${CURRENCIES[state.stakeCurrency]?.symbol || ""}${amt}</button>`)
              .join("")}
          </div>
        </div>

        <div class="stake-calc-grid">
          <div>
            <label class="text-xs font-semibold text-text-secondary block mb-1" for="sureStakeInput">Your Stake Amount</label>
            <div class="stake-input-row">
              <select id="sureCurrencySelect" aria-label="Currency">
                ${Object.entries(CURRENCIES)
                  .map(([code, c]) => `<option value="${code}"${state.stakeCurrency === code ? " selected" : ""}>${c.label}</option>`)
                  .join("")}
              </select>
              <input id="sureStakeInput" type="number" min="1" step="any" value="${escapeHtml(String(state.stakeAmount))}" aria-label="Stake amount">
            </div>
          </div>

          <div class="payout-metric-card">
            <span class="lbl">Combined Sure Odds</span>
            <span class="val">${formatOdds(slip.totalOdds)}x</span>
          </div>

          <div class="payout-metric-card is-highlight">
            <span class="lbl">Potential Win Return</span>
            <span class="val" id="surePotentialReturn">${formatMoney(potentialWin)}</span>
            <span class="text-xs text-muted mt-1">Net Profit: <strong id="sureNetProfit" class="font-mono text-text">${formatMoney(netProfit)}</strong></span>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 flex-wrap mt-3 pt-3 border-t">
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" class="analyze-inline-btn" data-regen-slip="1">↻ Shuffle Alternative Matches</button>
            <button type="button" class="analyze-inline-btn" id="expandAllFactorsBtn">Toggle All 11-Factor Details</button>
          </div>
          <button type="button" class="btn-sure-cta" id="copySureSlipBtn">Copy ${escapeHtml(slip.title)} Slip</button>
        </div>
      </section>

      <!-- Selected Real-Time Match Legs + 11-Factor Analysis -->
      <section class="panel">
        <div class="panel-header">
          <span class="live-dot" style="background:var(--brand);"></span>
          <h2>${escapeHtml(slip.title)} · ${slip.legs.length} Selected Fixtures &amp; 11-Factor Reasoning</h2>
          <span class="count">Total ${formatOdds(slip.totalOdds)}x</span>
        </div>

        ${
          slip.legs.length === 0
            ? `<div class="empty-state"><h3>Connecting to Live Match Feeds...</h3><p class="text-sm">Waiting for real-time fixtures &amp; 11-factor calculations.</p></div>`
            : slip.legs
                .map((leg, idx) => {
                  const m = leg.match;
                  const home = getTeam(m.home, "Home");
                  const away = getTeam(m.away, "Away");
                  const lg = getLeagueInfo(m);
                  const conf = Math.round((leg.market.prob || 0.65) * 100);
                  // Auto-expand first 2 legs in 2/5/10 tiers or if toggled by user
                  const defaultExpanded = idx < 2 && ["2", "5", "10"].includes(slip.id);
                  const isExpanded = state.expandedLegs[m.id] !== undefined ? state.expandedLegs[m.id] : defaultExpanded;
                  return `
                    <article class="sure-leg-card">
                      <div class="sure-leg-head">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="font-mono text-xs font-bold px-2 py-0.5 rounded-pill bg-brand-soft text-brand">#${idx + 1}</span>
                          ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
                          <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs ${m.status === "LIVE" ? "text-live font-bold" : "text-muted"}">
                            ${m.status === "LIVE" ? `● LIVE ${escapeHtml(m.displayTime)} (${formatMatchScore(m)})` : `${escapeHtml(m.date)} · ${escapeHtml(m.displayTime)}`}
                          </span>
                        </div>
                      </div>

                      <div class="flex items-center justify-between gap-2 mt-2 flex-wrap">
                        <div class="flex items-center gap-2.5 min-w-0">
                          ${crestImg(home.logo, home.name, home.color, 24)}
                          <span class="font-bold text-base">${escapeHtml(home.name)}</span>
                          <span class="text-xs font-mono text-muted">vs</span>
                          <span class="font-bold text-base">${escapeHtml(away.name)}</span>
                          ${crestImg(away.logo, away.name, away.color, 24)}
                        </div>
                        <span class="text-xs font-mono text-muted">xG: ${m.analysis?.expectedGoals?.home ?? "-"} – ${m.analysis?.expectedGoals?.away ?? "-"}</span>
                      </div>

                      <div class="sure-pick-box">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-xs font-bold uppercase tracking-wide text-brand">Sure Tip:</span>
                            <span class="font-bold text-sm text-text">${escapeHtml(leg.market.label)}</span>
                            <span class="text-xs font-mono text-muted">· Model Conf ${conf}%</span>
                            ${leg.ppgStrength ? `<span class="strong-ppg-proof-badge">${leg.ppgStrength.trajectory === "GAIN_BLUE" ? "🔵" : "💎"} ${escapeHtml(leg.ppgStrength.badge)}: ${escapeHtml(leg.ppgStrength.text)}</span>` : ""}
                          </div>
                          <div class="text-xs text-text-secondary mt-1">${escapeHtml(leg.market.reason)}</div>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="sure-odds-chip">@ ${leg.market.odds.toFixed(2)}</span>
                        </div>
                      </div>

                      <div class="flex items-center justify-between gap-2 flex-wrap mt-2">
                        <div class="flex items-center gap-2">
                          <button type="button" class="analyze-inline-btn" data-toggle-factors="${m.id}">
                            ${isExpanded ? "Hide 11-Factor Breakdown ▲" : "Show All 11 Factors (H2H, Form, Injuries, CS, Run-in) ▼"}
                          </button>
                          <button type="button" class="analyze-inline-btn" data-match-id="${m.id}">Match Center</button>
                        </div>
                        <button type="button" class="analyze-inline-btn" data-hydrate-match="${m.id}">
                          ${m.analysis?.factors?.last5HomeGames?.isLiveFeed ? "✓ Live ESPN Verified" : "↻ Sync Deep Live Split"}
                        </button>
                      </div>

                      ${isExpanded ? render11FactorAnalysisGrid(m) : ""}
                    </article>
                  `;
                })
                .join("")
        }
      </section>
    `;
  }

  function renderMatchRow(m) {
    const home = getTeam(m.home, "Home");
    const away = getTeam(m.away, "Away");
    const isLive = m.status === "LIVE";
    const isFT = m.status === "FT";
    const hasScore = isLive || isFT;
    const homeScoreText = formatSingleScore(m.homeScore, isLive);
    const awayScoreText = formatSingleScore(m.awayScore, isLive);
    const matchScoreText = formatMatchScore(m);
    const homeWon = isFT && Number(m.homeScore) > Number(m.awayScore);
    const awayWon = isFT && Number(m.awayScore) > Number(m.homeScore);
    const bestLabel = m.analysis?.bestPick?.code || "1X";

    const redBadges = (count) =>
      count > 0 ? `<span class="red-cards" title="Red card">${"<span></span>".repeat(count)}</span>` : "";

    const bestDrop = m.droppingOdds?.bestDrop;
    const dropChipHtml = bestDrop && bestDrop.dropPct >= 2.0
      ? `<span class="drop-badge" title="Dropping Odds: ${bestDrop.openOdd.toFixed(2)} -> ${bestDrop.currentOdd.toFixed(2)}">▼ ${escapeHtml(bestDrop.code)} -${bestDrop.dropPct}%</span>`
      : "";
    const ppgHome = m.ppgSummary?.homeOverall ?? m.analysis?.factors?.ppg?.homeOverall;
    const ppgAway = m.ppgSummary?.awayOverall ?? m.analysis?.factors?.ppg?.awayOverall;
    const ppgText = Number.isFinite(ppgHome) && Number.isFinite(ppgAway) ? `PPG ${ppgHome.toFixed(1)}-${ppgAway.toFixed(1)}` : "";
    const sched = m.analysis?.factors?.ppg?.scheduleStrength;
    const sosBadge = sched?.home?.isDropRed || sched?.away?.isDropRed
      ? `<span class="ppg-sos-badge is-drop-red" title="${escapeHtml(sched.home?.isDropRed ? sched.home.reason : sched.away?.reason)}">🔴 Drop Risk</span>`
      : sched?.home?.isGainBlue || sched?.away?.isGainBlue
      ? `<span class="ppg-sos-badge is-gain-blue" title="${escapeHtml(sched.home?.isGainBlue ? sched.home.reason : sched.away?.reason)}">🔵 Gain Points</span>`
      : "";
    const hasInjSusp = Boolean(
      m.analysis?.factors?.injuries?.home?.length ||
      m.analysis?.factors?.injuries?.away?.length ||
      m.analysis?.factors?.suspensions?.home?.length ||
      m.analysis?.factors?.suspensions?.away?.length
    );

    return `
      <div class="match-row" data-match-id="${m.id}">
        <div class="match-mobile">
          <div class="match-mobile-time">
            ${
              isLive
                ? `<span class="live-label"><span class="live-dot"></span>Live</span><span class="live-minute">${escapeHtml(m.displayTime)}</span>`
                : `<span class="ko-time">${escapeHtml(m.displayTime)}</span>`
            }
          </div>
          <div class="match-mobile-teams">
            <div class="match-mobile-team">
              ${crestImg(home.logo, home.name, home.color, 20)}
              <span class="team-name${homeWon ? " team-winner" : ""}">${escapeHtml(home.name)}</span>
              ${redBadges(m.homeRed)}
              <span class="team-score${isLive ? " is-live" : ""}">${homeScoreText}</span>
            </div>
            <div class="match-mobile-team">
              ${crestImg(away.logo, away.name, away.color, 20)}
              <span class="team-name${awayWon ? " team-winner" : ""}">${escapeHtml(away.name)}</span>
              ${redBadges(m.awayRed)}
              <span class="team-score${isLive ? " is-live" : ""}">${awayScoreText}</span>
            </div>
            ${
              dropChipHtml || ppgText || sosBadge
                ? `<div class="match-mobile-meta">
                    ${ppgText ? `<span class="ppg-chip">${escapeHtml(ppgText)}</span>` : ""}
                    ${sosBadge}
                    ${dropChipHtml}
                    ${hasInjSusp ? `<span class="alert-badge" title="Injury / Suspension Alert">! Inj/Sus</span>` : ""}
                  </div>`
                : ""
            }
          </div>
        </div>

        <div class="match-desktop">
          <div class="time">
            ${
              isLive
                ? `<span class="live-dot"></span><span class="live-minute">${escapeHtml(m.displayTime)}</span>`
                : `<span class="status-text">${escapeHtml(m.displayTime)}</span>`
            }
          </div>
          <div class="team-home">
            ${crestImg(home.logo, home.name, home.color, 19)}
            ${redBadges(m.homeRed)}
            <span class="team-name${homeWon ? " team-winner" : ""}">${escapeHtml(home.name)}</span>
          </div>
          <div class="score${isLive ? " is-live" : hasScore ? "" : " is-vs"}">
            ${matchScoreText}
          </div>
          <div class="team-away">
            ${crestImg(away.logo, away.name, away.color, 19)}
            <span class="team-name${awayWon ? " team-winner" : ""}">${escapeHtml(away.name)}</span>
            ${redBadges(m.awayRed)}
          </div>
          <div class="chevron">
            ${sosBadge}
            ${dropChipHtml || (ppgText ? `<span class="ppg-chip">${escapeHtml(ppgText)}</span>` : "")}
            ${hasInjSusp ? `<span class="alert-badge" title="Injury / Suspension Alert">!</span>` : ""}
            <span class="match-odds-pill" title="Sure Pick">${escapeHtml(bestLabel)} @ ${formatOdds(m.analysis?.bestPick?.odds || m.odds?.home)}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </div>
        </div>
      </div>
    `;
  }

  function renderMustWatchSection() {
    const cards = liveMatches.filter((m) => m.mustWatch).slice(0, 8);
    if (cards.length === 0) return "";
    return `
      <section class="panel">
        <div class="panel-header">
          <h2>Featured Real-Time Matches</h2>
          <span class="count">${cards.length} live &amp; next</span>
          <a class="see-all" href="/matches" data-route="/matches">
            See all
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </a>
        </div>
        <div class="must-watch-scroll">
          ${cards
            .map((m) => {
              const home = getTeam(m.home, "Home");
              const away = getTeam(m.away, "Away");
              const lg = getLeagueInfo(m);
              const isLive = m.status === "LIVE";
              const best = m.analysis?.bestPick;
              return `
                <article class="must-watch-card" data-match-id="${m.id}" data-open-analysis="1">
                  <div class="must-watch-card-inner">
                    <div class="must-watch-label">
                      <span class="label-text">${escapeHtml(m.mustWatchTag || "REAL-TIME")}</span>
                      <span class="league-info">
                        ${crestImg(lg.logo, lg.name, "#0A7B5C", 14)}
                        <span>${escapeHtml(lg.name)}</span>
                      </span>
                    </div>
                    <div class="must-watch-teams">
                      <div class="must-watch-team">
                        ${crestImg(home.logo, home.name, home.color, 32)}
                        <span class="team-name">${escapeHtml(home.name)}</span>
                      </div>
                      <div class="must-watch-score${isLive ? "" : " is-upcoming"}">
                        ${isLive ? formatMatchScore(m) : escapeHtml(m.displayTime)}
                      </div>
                      <div class="must-watch-team">
                        ${crestImg(away.logo, away.name, away.color, 32)}
                        <span class="team-name">${escapeHtml(away.name)}</span>
                      </div>
                    </div>
                    <div class="must-watch-reason">${best ? `Sure Pick: ${escapeHtml(best.label)} @ ${best.odds.toFixed(2)}` : escapeHtml(m.mustWatchReason)}</div>
                    <div class="must-watch-status${isLive ? "" : " is-scheduled"}">
                      ${isLive ? `<span class="live-dot-sm"></span><span>${escapeHtml(m.displayTime)} · Live Now</span>` : `<span>${escapeHtml(m.date)} · ${escapeHtml(m.displayTime)} KO</span>`}
                    </div>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function sortMatchesInOrder(list) {
    return [...list].sort((a, b) => {
      // 1. Status priority: LIVE first, then SCHEDULED, then FT
      const priority = (s) => (s === "LIVE" ? 1 : s === "SCHEDULED" ? 2 : 3);
      const pa = priority(a.status);
      const pb = priority(b.status);
      if (pa !== pb) return pa - pb;

      // 2. If both are LIVE, higher minute/progress first
      if (a.status === "LIVE" && b.status === "LIVE") {
        const minA = parseInt(a.displayTime, 10) || 0;
        const minB = parseInt(b.displayTime, 10) || 0;
        if (minA !== minB) return minB - minA;
      }

      // 3. If upcoming or other, sort by kickoff time / timestamp
      if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return String(a.displayTime || "").localeCompare(String(b.displayTime || ""));
    });
  }

  function renderMatchesPanel(matchesList, title = "Upcoming Fixtures", showToolbar = true, allowCompletedToggle = false, forcedSection = null) {
    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const spDef = ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey) || { key: "ALL", label: "All 5 Sports", icon: "🏆" };

    const isLiveSection = forcedSection === "LIVE" || (!forcedSection && state.route === "/live");

    // Source pool filtered strictly by active sport and excluding NCAA/women
    const sourcePool = liveMatches
      .filter((m) => !isNcaaOrWomenMatch(m))
      .filter((m) => {
        if (activeSportKey === "all") return true;
        return (m.sport || "football").toLowerCase() === activeSportKey;
      });

    const liveCount = sourcePool.filter((m) => m.status === "LIVE").length;
    const schedCount = sourcePool.filter((m) => m.status === "SCHEDULED").length;
    const dropsCount = sourcePool.filter((m) => m.status === "SCHEDULED" && m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 2.0).length;
    const alertsCount = sourcePool.filter((m) => m.status === "SCHEDULED" && (m.analysis?.factors?.suspensions?.hasAlert || m.analysis?.factors?.injuries?.home?.length || m.analysis?.factors?.injuries?.away?.length)).length;

    let filtered = [];
    let toolbarHtml = "";

    if (isLiveSection) {
      // IN LIVE GAMES SECTION: ONLY LIVE GAMES THERE!
      // TAKE AWAY UPCOMING GAMES, DROPPING ODDS, SUSPENSION AND INJURY FROM HERE!
      filtered = sourcePool.filter((m) => m.status === "LIVE");

      toolbarHtml = showToolbar
        ? `
          <div class="toolbar-card live-toolbar-card">
            <div class="toolbar-primary-row">
              <div class="flex items-center gap-3">
                <span class="live-dot-pulse"></span>
                <div>
                  <div class="flex items-center gap-2">
                    <span style="font-size:15px; font-weight:800; color:#DC2626; letter-spacing:-0.01em;">🔴 In-Play Live Games</span>
                    <span class="toolbar-count-badge" style="background:rgba(239, 68, 68, 0.12); color:#DC2626; font-size:11px; padding:2px 8px;">${filtered.length} in play</span>
                  </div>
                  <span class="text-xs text-muted">Showing live in-play games only · Scores &amp; clock update automatically</span>
                </div>
              </div>
              <button type="button" class="refresh-btn" id="refreshMatchesBtn" title="Sync real-time scores from SportyBet, Football.com & ESPN">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
                Sync Live
              </button>
            </div>
          </div>
        `
        : "";
    } else {
      // UNDER UPCOMING GAMES SECTION: TAKEAWAY LIVE GAMES FROM THERE!
      if (state.matchFilter === "LIVE" || state.matchFilter === "ALL" || state.matchFilter === "FOLLOWING" || !state.matchFilter) {
        state.matchFilter = "SCHEDULED";
      }

      const schedPool = sourcePool.filter((m) => m.status === "SCHEDULED");

      if (state.matchFilter === "SCHEDULED") {
        filtered = state.selectedDate && state.selectedDate !== "UPCOMING_ALL"
          ? schedPool.filter((m) => m.date === state.selectedDate)
          : schedPool;
      } else if (state.matchFilter === "DROPS") {
        let dropsPool = schedPool.filter((m) => Boolean(m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 2.0));
        if (state.selectedDate && state.selectedDate !== "UPCOMING_ALL") {
          dropsPool = dropsPool.filter((m) => m.date === state.selectedDate);
        }
        filtered = dropsPool;
      } else if (state.matchFilter === "ALERTS") {
        let alertsPool = schedPool.filter((m) => Boolean(m.analysis?.factors?.suspensions?.hasAlert || m.analysis?.factors?.injuries?.home?.length || m.analysis?.factors?.injuries?.away?.length));
        if (state.selectedDate && state.selectedDate !== "UPCOMING_ALL") {
          alertsPool = alertsPool.filter((m) => m.date === state.selectedDate);
        }
        filtered = alertsPool;
      } else if (state.matchFilter === "FT" && allowCompletedToggle) {
        filtered = finishedTodayMatches
          .filter((m) => !isNcaaOrWomenMatch(m))
          .filter((m) => activeSportKey === "all" || (m.sport || "football").toLowerCase() === activeSportKey);
      } else {
        filtered = schedPool;
      }

      const upcomingModes = [
        { id: "SCHEDULED", label: "Upcoming Fixtures", count: schedCount },
        { id: "DROPS", label: "Dropping Odds", count: dropsCount },
        { id: "ALERTS", label: "Inj / Susp Alerts", count: alertsCount }
      ];
      if (allowCompletedToggle && finishedTodayMatches.length > 0) {
        upcomingModes.push({ id: "FT", label: "Completed Today", count: finishedTodayMatches.length });
      }

      toolbarHtml = showToolbar
        ? `
          <div class="toolbar-card upcoming-toolbar-card">
            <!-- Row 1: Upcoming Filters (NO LIVE GAMES TAB) -->
            <div class="toolbar-primary-row">
              <div class="toolbar-modes" role="tablist" aria-label="Upcoming fixture filters">
                ${upcomingModes
                  .map((f) => {
                    const active = state.matchFilter === f.id;
                    return `
                      <button type="button" class="toolbar-mode-tab${active ? " is-active" : ""}" data-filter="${f.id}" aria-selected="${active}">
                        <span class="toolbar-mode-label">${f.id === "SCHEDULED" ? "📅 " : f.id === "DROPS" ? "📉 " : f.id === "ALERTS" ? "⚠️ " : ""}${escapeHtml(f.label)}</span>
                        <span class="toolbar-count-badge">${f.count}</span>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
              <button type="button" class="refresh-btn" id="refreshMatchesBtn" title="Sync upcoming fixtures from SportyBet, Football.com & ESPN">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
                Sync Fixtures
              </button>
            </div>

            <!-- Row 2: Matchday Date Selector -->
            <div class="toolbar-sub-row">
              <span class="toolbar-sub-label">Matchday:</span>
              <div class="date-strip" role="tablist" aria-label="Upcoming matchdays">
                ${(DATA.DATES || [])
                  .map(
                    (d) => `<button type="button" class="date-pill${state.selectedDate === d.id ? " is-active" : ""}" data-date="${d.id}">${escapeHtml(d.label)}</button>`
                  )
                  .join("")}
              </div>
            </div>
          </div>
        `
        : "";
    }

    let groupsHtml = "";
    if (isLoadingRealtime && liveMatches.length === 0) {
      groupsHtml = `
        <div class="p-4 flex flex-col gap-3">
          ${[1, 2, 3, 4, 5].map(() => `<div data-skeleton style="height:52px;"><div data-skeleton-band></div></div>`).join("")}
        </div>
      `;
    } else if (filtered.length === 0) {
      if (isLiveSection) {
        groupsHtml = `
          <div class="empty-state">
            <span style="font-size:32px;">🔴</span>
            <h3>No live ${activeSportKey !== "all" ? escapeHtml(spDef.label) : ""} matches in play right now</h3>
            <p class="text-sm">Live scores and minutes update automatically as soon as games kick off.</p>
            <a href="/upcoming" data-route="/upcoming" class="analyze-inline-btn mt-3">View Upcoming Fixtures (${schedCount}) &rarr;</a>
          </div>
        `;
      } else {
        groupsHtml = `
          <div class="empty-state">
            <span style="font-size:32px;">📅</span>
            <h3>No upcoming ${activeSportKey !== "all" ? escapeHtml(spDef.label) : ""} matches scheduled for this selection</h3>
            <p class="text-sm">Fixtures sync continuously in real-time from SportyBet, Football.com &amp; ESPN.</p>
            <button type="button" class="analyze-inline-btn mt-3" data-date="UPCOMING_ALL">View All Upcoming Dates &rarr;</button>
          </div>
        `;
      }
    } else if (activeSportKey !== "all") {
      // SINGLE SPORT ACTIVE: ONLY THIS SPORT'S GAMES APPEAR! (Zero contamination)
      const groups = new Map();
      filtered.forEach((m) => {
        const k = `${m.leagueSlug}||${m.leagueName || ""}`;
        if (!groups.has(k)) groups.set(k, { sample: m, items: [] });
        groups.get(k).items.push(m);
      });

      let subLeaguesHtml = "";
      for (const { sample, items } of groups.values()) {
        const lg = getLeagueInfo(sample);
        const sortedItems = sortMatchesInOrder(items);
        subLeaguesHtml += `
          <div>
            <a class="match-league-header" href="${escapeHtml(lg.href)}" data-route="${escapeHtml(lg.href)}">
              <span class="crest-backed" style="width:20px;height:20px;">${crestImg(lg.logo, lg.name, "#0A7B5C", 20)}</span>
              <span class="league-name">${escapeHtml(lg.name)}</span>
              <span class="match-league-country">${escapeHtml(lg.country || "")}</span>
              <span class="text-xs font-mono text-muted ml-auto mr-2">${items.length} fixtures</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="m9 18 6-6-6-6"/></svg>
            </a>
            ${sortedItems.map(renderMatchRow).join("")}
          </div>
        `;
      }

      groupsHtml = subLeaguesHtml;
    } else {
      // ALL SPORTS SELECTED: GROUP MATCHES ACCORDING TO WHERE THEY BELONG!
      // DONT ADD FOOTBALL TO TENNIS, DONT ADD TENNIS TO BASKETBALL!
      const sportsToGroup = [
        { key: "football", label: "Football", icon: "⚽" },
        { key: "tennis", label: "Tennis", icon: "🎾" },
        { key: "basketball", label: "Basketball", icon: "🏀" },
        { key: "darts", label: "Darts", icon: "🎯" },
        { key: "hockey", label: "Ice Hockey", icon: "🏒" }
      ];

      const sectionsHtml = sportsToGroup
        .map((sp) => {
          const spMatches = filtered.filter((m) => (m.sport || "football").toLowerCase() === sp.key);
          if (spMatches.length === 0) return "";

          const groups = new Map();
          spMatches.forEach((m) => {
            const k = `${m.leagueSlug}||${m.leagueName || ""}`;
            if (!groups.has(k)) groups.set(k, { sample: m, items: [] });
            groups.get(k).items.push(m);
          });

          let subLeaguesHtml = "";
          for (const { sample, items } of groups.values()) {
            const lg = getLeagueInfo(sample);
            const sortedItems = sortMatchesInOrder(items);
            subLeaguesHtml += `
              <div>
                <a class="match-league-header" href="${escapeHtml(lg.href)}" data-route="${escapeHtml(lg.href)}">
                  <span class="crest-backed" style="width:20px;height:20px;">${crestImg(lg.logo, lg.name, "#0A7B5C", 20)}</span>
                  <span class="league-name">${escapeHtml(lg.name)}</span>
                  <span class="match-league-country">${escapeHtml(lg.country || "")}</span>
                  <span class="text-xs font-mono text-muted ml-auto mr-2">${items.length} fixtures</span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="m9 18 6-6-6-6"/></svg>
                </a>
                ${sortedItems.map(renderMatchRow).join("")}
              </div>
            `;
          }

          return `
            <div class="sport-category-card" data-sport-group="${sp.key}">
              <div class="sport-category-header">
                <div class="flex items-center gap-2.5">
                  <span class="sport-category-icon">${sp.icon}</span>
                  <div>
                    <h3 class="sport-category-title">${sp.label} Fixtures &amp; Odds</h3>
                    <span class="sport-category-subtitle">${spMatches.length} Matches belonging strictly to ${sp.label} · SportyBet &amp; Football.com</span>
                  </div>
                </div>
                <button type="button" class="sport-category-filter-btn" data-sport-filter="${sp.key}" title="View only ${sp.label} games">
                  View ${sp.label} Only (${spMatches.length}) &rarr;
                </button>
              </div>
              <div class="sport-category-body">
                ${subLeaguesHtml}
              </div>
            </div>
          `;
        })
        .join("");

      groupsHtml = sectionsHtml || `
        <div class="empty-state">
          <h3>No matches found in active filter</h3>
          <p class="text-sm">Check back shortly or click Sync Live above.</p>
        </div>
      `;
    }

    const panelTitle = isLiveSection
      ? (activeSportKey !== "all" ? `${spDef.icon} ${spDef.label} · 🔴 Live Matches` : "🔴 Live In-Play Matches")
      : (activeSportKey !== "all" ? `${spDef.icon} ${spDef.label} · 📅 Upcoming Fixtures` : title);

    const seeAllLink = isLiveSection
      ? ""
      : `<a class="see-all" href="/upcoming" data-route="/upcoming">
          Full Upcoming Schedule
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </a>`;

    return `
      ${toolbarHtml}
      <section class="panel" id="matchesPanel">
        <div class="panel-header">
          ${isLiveSection && filtered.length > 0 ? '<span class="live-dot-pulse"></span>' : ""}
          <h2>${escapeHtml(panelTitle)}</h2>
          <span class="count">${filtered.length} matches</span>
          ${seeAllLink}
        </div>
        ${groupsHtml}
      </section>
    `;
  }

  function renderStandingsPanel(forcedSlug = null) {
    const activeSlug = forcedSlug || state.standingsLeague;
    const lg = getLeagueInfo(activeSlug);
    const rows = (DATA.STANDINGS && DATA.STANDINGS[activeSlug]) || [];
    const tabSlugs = [
      "england-premier-league",
      "spain-la-liga",
      "italy-serie-a",
      "germany-bundesliga",
      "france-ligue-1",
      "netherlands-eredivisie",
      "uefa-champions-league"
    ];

    return `
      <section class="panel">
        <div class="panel-header">
          <span class="crest-backed" style="width:20px;height:20px;">${crestImg(lg.logo, lg.name, "#0A7B5C", 20)}</span>
          <h2>${forcedSlug ? `${escapeHtml(lg.name)} Live Standings` : "Live League Standings"}</h2>
          <a class="see-all" href="/competitions/${escapeHtml(activeSlug)}" data-route="/competitions/${escapeHtml(activeSlug)}">Competition Hub</a>
        </div>
        ${
          forcedSlug
            ? ""
            : `<div class="standings-tabs">
                ${tabSlugs
                  .map((s) => {
                    const item = getLeagueInfo(s);
                    return `<button type="button" class="filter-chip${activeSlug === s ? " is-active" : ""}" data-standings-tab="${s}">${escapeHtml(item.name)}</button>`;
                  })
                  .join("")}
              </div>`
        }
        ${
          rows.length === 0
            ? `<div class="p-4 text-xs text-muted">${isLoadingRealtime ? "Loading live table from ESPN..." : "Standings unavailable for this cup/fixture window — check active fixtures above."}</div>`
            : `<div class="standings-table-wrap">
                <table class="standings-table">
                  <thead>
                    <tr>
                      <th style="width:36px">#</th>
                      <th>Club</th>
                      <th class="num">MP</th>
                      <th class="num">W</th>
                      <th class="num">D</th>
                      <th class="num">L</th>
                      <th class="num">GF</th>
                      <th class="num">GA</th>
                      <th class="num">GD</th>
                      <th class="num">Pts</th>
                      <th class="num">PPG</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows
                      .slice(0, 12)
                      .map((r) => {
                        const t = getTeam(r.team, r.customName);
                        const zoneClass = r.zone ? ` zone-${r.zone}` : "";
                        const ppgVal = Number.isFinite(r.ppg) ? r.ppg : (r.mp > 0 ? r.pts / r.mp : 0);
                        return `
                          <tr>
                            <td><span class="standings-pos${zoneClass}">${r.pos}</span></td>
                            <td>
                              <div class="flex items-center gap-2">
                                ${crestImg(t.logo, t.name, t.color, 18)}
                                <span class="font-semibold text-sm">${escapeHtml(t.name)}</span>
                              </div>
                            </td>
                            <td class="num">${r.mp}</td>
                            <td class="num">${r.w}</td>
                            <td class="num">${r.d}</td>
                            <td class="num">${r.l}</td>
                            <td class="num">${r.gf ?? "-"}</td>
                            <td class="num">${r.ga ?? "-"}</td>
                            <td class="num">${escapeHtml(r.gd)}</td>
                            <td class="num font-bold text-brand">${r.pts}</td>
                            <td class="num font-mono font-semibold">${ppgVal.toFixed(2)}</td>
                          </tr>
                        `;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>`
        }
      </section>
    `;
  }

  // ============ LEFT RAIL (NO LOGIN — DIRECT SURE ODDS & CLUBS) ============
  function renderLeftRail() {
    const rail = document.getElementById("railLeft");
    if (!rail) return;

    const topSlugs = [
      "england-premier-league",
      "spain-la-liga",
      "italy-serie-a",
      "germany-bundesliga",
      "france-ligue-1",
      "uefa-champions-league",
      "netherlands-eredivisie",
      "portugal-primeira-liga",
      "turkey-super-lig"
    ];

    const clubKeys = ["arsenal", "liverpool", "realmadrid", "barcelona", "mancity", "bayern", "inter", "psg", "ajax", "sporting"];

    rail.innerHTML = `
      <div class="sidebar-card">
        <div class="flex items-center justify-between">
          <h2>Sure Odds Quick Jump</h2>
          <span class="font-mono text-xs font-bold text-brand">2 – 1M</span>
        </div>
        <p>Zero login required. Pick an odds target analyzed across all 11 match factors.</p>
        <div class="club-chip-grid">
          ${(RT?.SURE_TIERS || [])
            .map((t) => {
              const s = sureSlips[t.id];
              const act = state.activeSureTier === t.id && state.route === "/sure-odds";
              const shortLbl = t.id === "1000000" ? "1M" : t.id;
              return `<button type="button" class="club-chip${act ? " is-followed" : ""}" data-select-tier="${t.id}" data-go-sure="1">
                <span class="font-mono font-bold">${shortLbl}x</span>
                ${s ? `<span class="text-muted">(${s.legs.length})</span>` : ""}
              </button>`;
            })
            .join("")}
        </div>
        <div class="btn-group">
          <a class="btn-full" href="/special-tips" data-route="/special-tips" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:#042f2e;font-weight:800;border:none;">⏱️ 5-Min Draw &amp; Def Tips</a>
          <a class="btn-full" href="/sure-odds" data-route="/sure-odds">Open Sure Odds Analyzer</a>
          <a class="btn-outline" href="/dropping-odds" data-route="/dropping-odds">📉 Dropping Odds Scanner</a>
          <a class="btn-outline" href="/ppg" data-route="/ppg">📊 PPG Intelligence &amp; Table</a>
          <a class="btn-outline" href="/strong-teams" data-route="/strong-teams">🦁 Strong Teams Today</a>
          <a class="btn-outline" href="/worst-teams" data-route="/worst-teams">⚠️ Worst Teams Today</a>
          <a class="btn-outline" href="/odds-mismatch" data-route="/odds-mismatch">Bookmaker Odds Mismatch</a>
          <a class="btn-outline" href="/search" data-route="/search">Browse all ${LEAGUES.length} leagues</a>
        </div>
      </div>

      <div class="sidebar-card">
        <h2>Pin Your Clubs</h2>
        <div class="club-chip-grid">
          ${clubKeys
            .map((k) => {
              const t = TEAMS[k];
              if (!t) return "";
              const f = state.followedClubs.includes(k);
              return `<button type="button" class="club-chip${f ? " is-followed" : ""}" data-follow-club="${k}">
                ${crestImg(t.logo, t.name, t.color, 14)}
                <span>${escapeHtml(t.short)}</span>
              </button>`;
            })
            .join("")}
        </div>
      </div>

      <div class="sidebar-card">
        <div class="flex items-center justify-between">
          <h2>Live Competitions</h2>
          <a href="/search" data-route="/search" class="text-xs font-semibold text-brand">All ${LEAGUES.length}</a>
        </div>
        <div class="rail-league-list">
          ${topSlugs
            .map((slug) => {
              const l = getLeagueInfo(slug);
              const matchCount = liveMatches.filter((m) => m.leagueSlug === slug).length;
              return `<a class="rail-league-item" href="${escapeHtml(l.href)}" data-route="${escapeHtml(l.href)}">
                <span class="crest-backed" style="width:18px;height:18px;">${crestImg(l.logo, l.name, "#0A7B5C", 18)}</span>
                <span class="truncate">${escapeHtml(l.name)}</span>
                ${matchCount > 0 ? `<span class="badge-count">${matchCount}</span>` : ""}
              </a>`;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  // ============ RIGHT RAIL (SURE ODDS SUMMARY + LIVE NEWS) ============
  // ============ RIGHT RAIL (INTERACTIVE BANKER SLIP & POWER TOOLS) ============
  function renderRightRail() {
    const rail = document.getElementById("railRight");
    if (!rail) return;

    const activeTierId = state.activeSureTier || "2";
    const activeSlip = sureSlips[activeTierId] || { title: `${activeTierId} Sure Odds`, legs: [], totalOdds: 0, estWinPct: 0 };
    const stake = Number(state.stakeAmount) || 50;
    const payout = stake * (activeSlip.totalOdds || 0);
    const netProfit = Math.max(0, payout - stake);
    const winRate = activeSlip.estWinPct || (activeTierId === "2" ? 94 : activeTierId === "5" ? 86 : activeTierId === "10" ? 78 : 65);

    const tierPills = [
      { id: "2", label: "2x Banker" },
      { id: "5", label: "5x Sure" },
      { id: "10", label: "10x Gold" },
      { id: "20", label: "20x Value" },
      { id: "80", label: "80x Max" }
    ];

    rail.innerHTML = `
      <!-- BANKER SLIP TICKET -->
      <div class="sidebar-card banker-ticket-card">
        <div class="banker-ticket-header">
          <div class="flex items-center gap-2">
            <span class="banker-flame-icon">🔥</span>
            <div>
              <h2 class="banker-title">Banker Slip Ticket</h2>
              <span class="banker-subtitle">Autonomous Multi-Sport Selection</span>
            </div>
          </div>
          <span class="banker-odds-badge">${formatOdds(activeSlip.totalOdds)}x</span>
        </div>

        <!-- TIER TABS -->
        <div class="banker-tier-tabs">
          ${tierPills
            .map((t) => {
              const act = activeTierId === t.id ? " is-active" : "";
              const slipData = sureSlips[t.id];
              const count = slipData ? slipData.legs.length : 0;
              return `<button type="button" class="banker-tier-tab${act}" data-rail-tier="${t.id}">
                <span>${t.label}</span>
                ${count > 0 ? `<span class="tab-count">${count}</span>` : ""}
              </button>`;
            })
            .join("")}
        </div>

        <div class="banker-meta-bar">
          <span class="win-prob-pill font-mono">🎯 ${winRate}% Confidence</span>
          <span class="legs-count-pill font-mono">${activeSlip.legs.length} Multi-Sport Legs</span>
        </div>

        <!-- LEGS LIST -->
        <div class="banker-legs-scroll">
          ${
            activeSlip.legs.length === 0
              ? `<div class="p-3 text-xs text-muted text-center">Syncing real-time multi-sport fixtures...</div>`
              : `<div class="flex flex-col gap-2">
                  ${activeSlip.legs
                    .slice(0, 5)
                    .map((l) => {
                      const h = getTeam(l.match.home);
                      const a = getTeam(l.match.away);
                      const spIcon = l.match.sport === "tennis" ? "🎾" : l.match.sport === "basketball" ? "🏀" : l.match.sport === "darts" ? "🎯" : l.match.sport === "hockey" ? "🏒" : "⚽";
                      return `
                        <div class="banker-leg-item" data-match-id="${l.match.id}" data-open-analysis="1" title="Click for 11-factor match intelligence">
                          <div class="flex items-center justify-between text-xs gap-1.5">
                            <span class="truncate font-semibold text-text flex items-center gap-1">
                              <span>${spIcon}</span>
                              <span class="truncate">${escapeHtml(h.short)} vs ${escapeHtml(a.short)}</span>
                            </span>
                            <span class="font-mono font-bold text-brand shrink-0">@${l.market.odds.toFixed(2)}</span>
                          </div>
                          <div class="flex items-center justify-between text-xs mt-1 text-muted">
                            <span class="leg-pick-badge">🔥 Tip: ${escapeHtml(l.market.code || l.market.label)}</span>
                            <span class="text-xs font-mono text-muted">${l.factorConfidence || 85}% Banker</span>
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>`
          }
        </div>

        <!-- LIVE STAKE CALCULATOR -->
        <div class="banker-stake-box">
          <div class="flex items-center justify-between text-xs mb-1.5">
            <span class="font-bold text-text-secondary uppercase tracking-wider">Stake Amount:</span>
            <div class="stake-quick-chips">
              <button type="button" class="stake-chip-btn" data-rail-stake="10">$10</button>
              <button type="button" class="stake-chip-btn" data-rail-stake="50">$50</button>
              <button type="button" class="stake-chip-btn" data-rail-stake="100">$100</button>
            </div>
          </div>
          <div class="stake-input-wrap">
            <span class="currency-prefix">$</span>
            <input type="number" id="railStakeInput" class="rail-stake-field" value="${stake}" min="1" step="5" placeholder="50">
          </div>
          <div class="banker-payout-summary">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted">Potential Return:</span>
              <strong class="font-mono font-bold text-sm text-brand" id="railPayoutDisplay">${formatMoney(payout)}</strong>
            </div>
            <div class="flex items-center justify-between text-xs mt-0.5">
              <span class="text-muted">Net Profit:</span>
              <span class="font-mono font-bold text-xs text-brand-glow" id="railProfitDisplay">+${formatMoney(netProfit)}</span>
            </div>
          </div>
        </div>

        <div class="btn-group mt-3">
          <button type="button" class="btn-full" id="railCopySlipBtn" style="background:linear-gradient(135deg,#0A7B5C,#10B981);font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy Booking Slip</span>
          </button>
          <a class="btn-outline text-center" href="/sure-odds" data-route="/sure-odds">⚡ Open 11-Factor Analyzer</a>
        </div>
      </div>

      <!-- WINNING TOOLS RADAR -->
      <div class="sidebar-card quick-radar-card">
        <div class="quick-radar-header">
          <h2>Daily Winning Tools</h2>
          <span class="text-xs text-muted font-mono font-bold">5 SPORTS ONLY</span>
        </div>
        <ul class="quick-radar-list">
          <li>
            <a href="/handicap" data-route="/handicap" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(245,158,11,0.12);color:#F59E0B;">🎯</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">Winning Handicap &amp; +EV Tips</div>
                <div class="text-xs text-muted truncate">Expected Value algorithm with Fair Odds</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
          <li>
            <a href="/special-tips" data-route="/special-tips" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(6,182,212,0.12);color:#06B6D4;">⏱️</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">5-Min Draw Tips (50 Games)</div>
                <div class="text-xs text-muted truncate">Low scoring &amp; draw specialist leagues</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
          <li>
            <a href="/special-tips?tab=NO_3_ROW" data-route="/special-tips?tab=NO_3_ROW" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(16,185,129,0.12);color:#10B981;">🛡️</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">No 3+ Goals in a Row (50 Games)</div>
                <div class="text-xs text-muted truncate">High-probability defensive streak picks</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
          <li>
            <a href="/ppg" data-route="/ppg" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(59,130,246,0.12);color:#3B82F6;">📊</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">PPG Schedule Strength</div>
                <div class="text-xs text-muted truncate">🔵 Points Gain vs 🔴 Drop Risk</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
          <li>
            <a href="/run-in" data-route="/run-in" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(16,185,129,0.12);color:#10B981;">📈</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">Run-In Analysis (PLD vs REM)</div>
                <div class="text-xs text-muted truncate">Opponents Played vs Remaining PPG %</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
          <li>
            <a href="/odds-mismatch" data-route="/odds-mismatch" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(168,85,247,0.12);color:#A855F7;">⚡</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">SportyBet &amp; Football.com Mismatch</div>
                <div class="text-xs text-muted truncate">Live bookmaker discrepancy scanner</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
          <li>
            <a href="/strong-teams" data-route="/strong-teams" class="quick-radar-item">
              <span class="radar-item-icon" style="background:rgba(34,197,94,0.12);color:#22C55E;">🦁</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-xs text-text">Strongest Teams Today</div>
                <div class="text-xs text-muted truncate">Elite form leaders &amp; win streaks</div>
              </div>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
        </ul>
      </div>
    `;
  }

  function filteredMatchesForDate() {
    const allowed = ["football", "tennis", "basketball", "darts", "hockey"];
    let pool = liveMatches
      .filter((m) => allowed.includes((m.sport || "football").toLowerCase()))
      .filter((m) => !isNcaaOrWomenMatch(m));
    if (state.activeSport && state.activeSport !== "ALL") {
      pool = pool.filter((m) => (m.sport || "football").toLowerCase() === state.activeSport.toLowerCase());
    }
    // Strict separation: Live section strictly returns live games
    if (state.matchFilter === "LIVE") {
      return pool.filter((m) => m.status === "LIVE");
    }
    // Strict separation: Upcoming section strictly returns upcoming games
    if (state.matchFilter === "SCHEDULED") {
      const upcomingPool = pool.filter((m) => m.status === "SCHEDULED");
      if (state.selectedDate && state.selectedDate !== "UPCOMING_ALL") {
        return upcomingPool.filter((m) => m.date === state.selectedDate);
      }
      return upcomingPool;
    }
    if (state.selectedDate === "UPCOMING_ALL") return pool;
    return pool.filter((m) => m.date === state.selectedDate);
  }

  // ============ HOME MARKET INTELLIGENCE STRIP (DROPPING ODDS, INJURIES, SUSPENSIONS, PPG) ============
  function renderMarketIntelligenceStrip() {
    const active = filteredMatchesForDate().filter((m) => m.status !== "FT");
    const dropRank = (m) => (m.status === "SCHEDULED" ? 1000 : 0) + (m.droppingOdds?.bestDrop?.dropPct || 0);
    const dropMatches = active
      .filter((m) => m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 2.0)
      .sort((a, b) => dropRank(b) - dropRank(a));

    const alertMatches = active.filter((m) =>
      Boolean(
        m.analysis?.factors?.suspensions?.hasAlert ||
        m.analysis?.factors?.injuries?.home?.length ||
        m.analysis?.factors?.injuries?.away?.length
      )
    );

    const ppgMatches = [...active].sort(
      (a, b) => (b.analysis?.factors?.ppg?.gap || 0) - (a.analysis?.factors?.ppg?.gap || 0)
    );

    return `
      <section class="panel" id="marketIntelligencePanel">
        <div class="panel-header">
          <span class="live-dot" style="background:var(--brand);"></span>
          <h2>Live Dropping Odds, Injuries, Suspensions &amp; PPG</h2>
          <a class="see-all" href="/dropping-odds" data-route="/dropping-odds">
            Open Scanner
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </a>
        </div>

        <div class="intel-summary-grid">
          <a class="intel-stat-tile" href="/dropping-odds" data-route="/dropping-odds">
            <span class="tile-kicker">BOOKMAKER STEAM</span>
            <span class="tile-val text-brand">${dropMatches.length} Dropping Odds</span>
            <span class="tile-sub">${dropMatches[0] ? `Top ${dropMatches[0].status === "SCHEDULED" ? "Pre-Match" : "Live"}: ${getTeam(dropMatches[0].home).short}v${getTeam(dropMatches[0].away).short} ▼ -${dropMatches[0].droppingOdds.bestDrop.dropPct}%` : "Tracking open -> latest odds"}</span>
          </a>

          <a class="intel-stat-tile" href="/dropping-odds?filter=HEAVY" data-route="/dropping-odds?filter=HEAVY">
            <span class="tile-kicker">HEAVY STEAM SHIFTS</span>
            <span class="tile-val" style="color:var(--live);">${dropMatches.filter(m => (m.droppingOdds?.bestDrop?.dropPct || 0) >= 5.0).length} Big Moves</span>
            <span class="tile-sub">Drops greater than 5% sharp volume</span>
          </a>

          <a class="intel-stat-tile" href="/ppg" data-route="/ppg">
            <span class="tile-kicker">POINTS PER GAME (PPG)</span>
            <span class="tile-val text-brand">${ppgMatches[0]?.ppgSummary ? `${ppgMatches[0].ppgSummary.homeOverall.toFixed(2)} vs ${ppgMatches[0].ppgSummary.awayOverall.toFixed(2)}` : "Standings Math"}</span>
            <span class="tile-sub">Overall, Home &amp; Away PPG differentials</span>
          </a>
        </div>

        ${
          dropMatches.length > 0
            ? `<div class="intel-drop-scroller">
                ${dropMatches
                  .slice(0, 4)
                  .map((m) => {
                    const h = getTeam(m.home, "Home");
                    const a = getTeam(m.away, "Away");
                    const d = m.droppingOdds.bestDrop;
                    const ppgH = m.ppgSummary?.homeOverall?.toFixed(2) ?? "-";
                    const ppgA = m.ppgSummary?.awayOverall?.toFixed(2) ?? "-";
                    return `
                      <button type="button" class="intel-drop-chip" data-match-id="${m.id}">
                        <div class="flex items-center justify-between gap-2 w-full">
                          <span class="font-bold text-xs truncate">${escapeHtml(h.short)} vs ${escapeHtml(a.short)}</span>
                          <span class="drop-badge">▼ -${d.dropPct}%</span>
                        </div>
                        <div class="flex items-center justify-between gap-2 w-full text-xs mt-1">
                          <span class="text-text-secondary truncate">${escapeHtml(d.label)}</span>
                          <span class="font-mono"><span class="text-muted">${d.openOdd.toFixed(2)}</span> &rarr; <strong class="text-brand">${d.currentOdd.toFixed(2)}</strong></span>
                        </div>
                        <div class="text-muted mt-1" style="font-size:10.5px;">PPG: ${ppgH} vs ${ppgA} · ${escapeHtml(m.leagueName)}</div>
                      </button>
                    `;
                  })
                  .join("")}
              </div>`
            : ""
        }
      </section>
    `;
  }

  // ============ DEDICATED /dropping-odds SCANNER VIEW ============
  function renderDroppingOddsView() {
    let active = liveMatches.filter((m) => m.status !== "FT");
    if (state.activeSport && state.activeSport !== "ALL") {
      active = active.filter((m) => (m.sport || "football").toLowerCase() === state.activeSport.toLowerCase());
    }
    const activeFilter = state.activeDropFilter || "ALL";

    const dropRank = (m) => (m.status === "SCHEDULED" ? 1000 : 0) + (m.droppingOdds?.bestDrop?.dropPct || 0);
    const dropListAll = active
      .filter((m) => m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 1.5)
      .sort((a, b) => dropRank(b) - dropRank(a));

    let filteredDrops = dropListAll;
    if (activeFilter === "HEAVY") {
      filteredDrops = dropListAll.filter((m) => (m.droppingOdds?.bestDrop?.dropPct || 0) >= 5.0);
    } else if (activeFilter === "MODERATE") {
      filteredDrops = dropListAll.filter((m) => {
        const pct = m.droppingOdds?.bestDrop?.dropPct || 0;
        return pct >= 1.5 && pct < 5.0;
      });
    } else if (activeFilter === "INPLAY") {
      filteredDrops = dropListAll.filter((m) => m.status === "LIVE");
    } else if (activeFilter === "PREMATCH") {
      filteredDrops = dropListAll.filter((m) => m.status === "SCHEDULED");
    }

    const heavyCount = dropListAll.filter((m) => (m.droppingOdds?.bestDrop?.dropPct || 0) >= 5.0).length;
    const maxDrop = dropListAll.length > 0 ? Math.max(...dropListAll.map(m => m.droppingOdds?.bestDrop?.dropPct || 0)).toFixed(1) : "0.0";

    const bodyHtml = filteredDrops.length === 0
      ? `<div class="empty-state"><h3>No matches matching active drop filter (${escapeHtml(activeFilter)})...</h3><p class="text-sm">Click "All Dropping Odds" above to view active price steam.</p></div>`
      : filteredDrops
          .slice(0, 50)
          .map((m) => {
            const h = getTeam(m.home, "Home");
            const a = getTeam(m.away, "Away");
            const lg = getLeagueInfo(m);
            const d = m.droppingOdds.bestDrop;
            const isHeavy = d.dropPct >= 5.0;
            return `
              <div class="intel-row-card" data-match-id="${m.id}" style="${isHeavy ? "border-left: 3px solid var(--live);" : ""}">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-2 min-w-0">
                    ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
                    <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
                    <span class="text-xs font-mono text-muted">· ${m.status === "LIVE" ? `LIVE ${escapeHtml(m.displayTime)}` : `${escapeHtml(m.date)} ${escapeHtml(m.displayTime)}`}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="ppg-chip">${m.status === "LIVE" ? "IN-PLAY" : "PRE-MATCH"}</span>
                    <span class="drop-badge font-mono" style="${isHeavy ? "background:rgba(239,68,68,0.18);color:#EF4444;border-color:rgba(239,68,68,0.4);" : ""}">▼ ${escapeHtml(d.code)} DROPPED -${d.dropPct}%</span>
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3 flex-wrap mt-2">
                  <div class="flex items-center gap-2 min-w-0">
                    ${crestImg(h.logo, h.name, h.color, 22)}
                    <span class="font-bold text-sm">${escapeHtml(h.name)}</span>
                    <span class="text-xs text-muted">vs</span>
                    <span class="font-bold text-sm">${escapeHtml(a.name)}</span>
                    ${crestImg(a.logo, a.name, a.color, 22)}
                  </div>
                  <button type="button" class="analyze-inline-btn" data-match-id="${m.id}">Scouting &amp; Analysis &rarr;</button>
                </div>

                <div class="sure-pick-box mt-2">
                  <div class="text-xs">
                    <span class="font-bold text-brand uppercase">Sharp Market Move:</span>
                    <strong class="ml-1">${escapeHtml(d.label)}</strong>
                    <span class="text-muted ml-2">(Implied Shift: <strong class="text-brand">+${d.impliedShiftPct}%</strong> · Provider: ${escapeHtml(m.droppingOdds.provider)})</span>
                  </div>
                  <div class="font-mono text-sm mt-1">
                    <span class="text-muted" style="text-decoration:line-through;">${d.openOdd.toFixed(2)}</span>
                    &nbsp;&rarr;&nbsp;
                    <strong class="text-brand text-base">${d.currentOdd.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            `;
          })
          .join("");

    return `
      <div class="hero-banner">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="sure-pill-tag">MARKET STEAM</span>
          <span class="sure-pill-tag">OPEN &rarr; LATEST SHIFT</span>
          <span class="sure-pill-tag">MAX DROP -${maxDrop}% TODAY</span>
        </div>
        <h1 class="mt-2">Live Dropping Odds Scanner</h1>
        <p>Real-time bookmaker price steam tracking DraftKings open vs current market odds, sharp liquidity movements, and surges in implied win probabilities.</p>

        <div class="intel-tabs mt-3" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeFilter === "ALL" ? " is-active" : ""}" data-drop-filter="ALL">All Dropping Odds (${dropListAll.length})</button>
          <button type="button" class="filter-chip${activeFilter === "HEAVY" ? " is-active" : ""}" data-drop-filter="HEAVY">Heavy Steam &gt; 5% (${heavyCount})</button>
          <button type="button" class="filter-chip${activeFilter === "MODERATE" ? " is-active" : ""}" data-drop-filter="MODERATE">Moderate Drops (1.5% - 5%)</button>
          <button type="button" class="filter-chip${activeFilter === "INPLAY" ? " is-active" : ""}" data-drop-filter="INPLAY">In-Play Live Drops</button>
          <button type="button" class="filter-chip${activeFilter === "PREMATCH" ? " is-active" : ""}" data-drop-filter="PREMATCH">Pre-Match Drops</button>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <h2>Active Market Price Drops</h2>
          <span class="count">${filteredDrops.length} Matches</span>
        </div>
        <div>${bodyHtml}</div>
      </section>
    `;
  }
  // ============ DEDICATED /ppg INTELLIGENCE & TABLE MECHANICS VIEW ============
  function renderPpgIntelligenceView() {
    const active = filteredMatchesForDate().filter((m) => m.status !== "FT");
    const activeCat = state.activePpgCategory || "ALL";

    const ppgListAll = [...active].sort(
      (a, b) => (b.analysis?.factors?.ppg?.gap || 0) - (a.analysis?.factors?.ppg?.gap || 0)
    );

    let filteredPpg = ppgListAll;
    if (activeCat === "HIGH_GAP") {
      filteredPpg = ppgListAll.filter((m) => (m.analysis?.factors?.ppg?.gap || 0) >= 0.35);
    } else if (activeCat === "DROP_POINTS") {
      // 🔴 RED: Teams that played soft/cheap opponents and are projected to drop points against tough opponent
      filteredPpg = ppgListAll.filter((m) => {
        const sched = m.analysis?.factors?.ppg?.scheduleStrength;
        return sched?.home?.isDropRed || sched?.away?.isDropRed;
      });
    } else if (activeCat === "GAIN_POINTS") {
      // 🔵 BLUE: Teams that faced hard opponents and are projected to gain points against soft opponent
      filteredPpg = ppgListAll.filter((m) => {
        const sched = m.analysis?.factors?.ppg?.scheduleStrength;
        return sched?.home?.isGainBlue || sched?.away?.isGainBlue;
      });
    } else if (activeCat === "HOME_DOMINANT") {
      filteredPpg = ppgListAll.filter((m) => (m.analysis?.factors?.ppg?.homeHomePpg || 0) >= 1.70);
    } else if (activeCat === "AWAY_DOMINANT") {
      filteredPpg = ppgListAll.filter((m) => (m.analysis?.factors?.ppg?.awayAwayPpg || 0) >= 1.35);
    } else if (activeCat === "POINTS_STAKES") {
      filteredPpg = ppgListAll.filter((m) => {
        const a = m.analysis?.factors;
        return a?.tableStakes || (m.analysis?.factors?.ppg?.gap || 0) >= 0.40;
      });
    }

    const highGapCount = ppgListAll.filter((m) => (m.analysis?.factors?.ppg?.gap || 0) >= 0.35).length;
    const dropPointsCount = ppgListAll.filter((m) => m.analysis?.factors?.ppg?.scheduleStrength?.home?.isDropRed || m.analysis?.factors?.ppg?.scheduleStrength?.away?.isDropRed).length;
    const gainPointsCount = ppgListAll.filter((m) => m.analysis?.factors?.ppg?.scheduleStrength?.home?.isGainBlue || m.analysis?.factors?.ppg?.scheduleStrength?.away?.isGainBlue).length;

    const bodyHtml = filteredPpg.length === 0
      ? `<div class="empty-state"><h3>No fixtures matching active PPG filter (${escapeHtml(activeCat)})...</h3><p class="text-sm">Click "All PPG Edges" above to view full league standings mathematics.</p></div>`
      : filteredPpg
          .slice(0, 45)
          .map((m) => {
            const h = getTeam(m.home, "Home");
            const a = getTeam(m.away, "Away");
            const lg = getLeagueInfo(m);
            const ppg = m.analysis?.factors?.ppg || { homeOverall: 1.5, awayOverall: 1.3, homeHomePpg: 1.7, awayAwayPpg: 1.1, gap: 0.2, edge: h.short };
            const best = m.analysis?.bestPick;
            const factors = m.analysis?.factors;
            const formH = factors?.currentForm?.homePts ? `${factors.currentForm.homePts}/15 pts` : "Active";
            const formA = factors?.currentForm?.awayPts ? `${factors.currentForm.awayPts}/15 pts` : "Active";

            const hSos = ppg.scheduleStrength?.home;
            const aSos = ppg.scheduleStrength?.away;

            // Points calculation & standings mechanics
            const isHighGap = ppg.gap >= 0.35;
            const pointsNeeded = ppg.homeOverall >= ppg.awayOverall + 0.3
              ? `${h.name} requires full 3 points to maintain title/top-4 chase; ${a.name} in danger zone.`
              : `${a.name} road powerhouse targeting 3 points; ${h.name} desperate to defend home ground.`;
            const drawImportance = ppg.homeOverall >= 1.8
              ? `Draw is unacceptable for ${h.short} (drops 2 points); ${a.short} would celebrate 1 point.`
              : `High draw risk moment — both sides could settle for 1 point if level at 70'.`;
            const lossImpact = ppg.homeOverall >= ppg.awayOverall
              ? `A loss would drop ${h.short} down table standings and shatter home momentum.`
              : `A loss puts ${h.short} closer to relegation threshold; points calculations critical.`;

            return `
              <div class="intel-row-card" data-match-id="${m.id}" style="${isHighGap ? "border-left: 3px solid var(--brand);" : ""}">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-2 min-w-0">
                    ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
                    <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
                    <span class="text-xs font-mono text-muted">· ${escapeHtml(m.date)} ${escapeHtml(m.displayTime)}</span>
                  </div>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    ${hSos?.isDropRed || aSos?.isDropRed ? `<span class="ppg-sos-badge is-drop-red">🔴 Drop Risk Alert</span>` : ""}
                    ${hSos?.isGainBlue || aSos?.isGainBlue ? `<span class="ppg-sos-badge is-gain-blue">🔵 Points Gainer</span>` : ""}
                    <span class="factor-edge-pill font-mono font-bold">PPG Edge: ${escapeHtml(ppg.edge)} (+${ppg.gap.toFixed(2)} PPG)</span>
                  </div>
                </div>

                <div class="ppg-matrix-grid mt-2">
                  <div class="ppg-side-card ${ppg.homeOverall >= ppg.awayOverall ? "is-edge" : ""}">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-2 min-w-0">
                        ${crestImg(h.logo, h.name, h.color, 20)}
                        <strong class="text-sm truncate">${escapeHtml(h.name)}</strong>
                        <span class="text-xs text-muted font-mono">(Host)</span>
                      </div>
                      ${hSos ? `<span class="ppg-sos-badge ${hSos.isDropRed ? "is-drop-red" : hSos.isGainBlue ? "is-gain-blue" : "is-neutral"}">${escapeHtml(hSos.badge)}</span>` : ""}
                    </div>
                    <div class="ppg-stat-pills">
                      <span class="ppg-stat-badge">Overall: <strong>${ppg.homeOverall.toFixed(2)} PPG</strong></span>
                      <span class="ppg-stat-badge">Home: <strong>${ppg.homeHomePpg !== null ? ppg.homeHomePpg.toFixed(2) : "-"} PPG</strong></span>
                      <span class="ppg-stat-badge">Form: <strong>${formH}</strong></span>
                      ${factors?.runInAnalysis?.homeStats ? `<span class="ppg-stat-badge">Run-In: <strong>PLD ${factors.runInAnalysis.homeStats.playedPpg.toFixed(2)} &rarr; REM ${factors.runInAnalysis.homeStats.remainingPpg.toFixed(2)}</strong> <span class="runin-diff-pill ${factors.runInAnalysis.homeStats.diffPct > 0 ? "is-easy" : factors.runInAnalysis.homeStats.diffPct < 0 ? "is-tough" : "is-balanced"}" style="padding:1px 5px;font-size:10px;">${escapeHtml(factors.runInAnalysis.homeStats.diffLabel)}</span></span>` : ""}
                    </div>
                    ${hSos?.reason ? `<div class="text-xs mt-1.5 font-mono ${hSos.isDropRed ? "text-danger font-semibold" : hSos.isGainBlue ? "text-brand font-semibold" : "text-muted"}">${escapeHtml(hSos.reason)}</div>` : ""}
                  </div>

                  <div class="ppg-side-card ${ppg.awayOverall > ppg.homeOverall ? "is-edge" : ""}">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-2 min-w-0">
                        ${crestImg(a.logo, a.name, a.color, 20)}
                        <strong class="text-sm truncate">${escapeHtml(a.name)}</strong>
                        <span class="text-xs text-muted font-mono">(Visitor)</span>
                      </div>
                      ${aSos ? `<span class="ppg-sos-badge ${aSos.isDropRed ? "is-drop-red" : aSos.isGainBlue ? "is-gain-blue" : "is-neutral"}">${escapeHtml(aSos.badge)}</span>` : ""}
                    </div>
                    <div class="ppg-stat-pills">
                      <span class="ppg-stat-badge">Overall: <strong>${ppg.awayOverall.toFixed(2)} PPG</strong></span>
                      <span class="ppg-stat-badge">Away: <strong>${ppg.awayAwayPpg !== null ? ppg.awayAwayPpg.toFixed(2) : "-"} PPG</strong></span>
                      <span class="ppg-stat-badge">Form: <strong>${formA}</strong></span>
                      ${factors?.runInAnalysis?.awayStats ? `<span class="ppg-stat-badge">Run-In: <strong>PLD ${factors.runInAnalysis.awayStats.playedPpg.toFixed(2)} &rarr; REM ${factors.runInAnalysis.awayStats.remainingPpg.toFixed(2)}</strong> <span class="runin-diff-pill ${factors.runInAnalysis.awayStats.diffPct > 0 ? "is-easy" : factors.runInAnalysis.awayStats.diffPct < 0 ? "is-tough" : "is-balanced"}" style="padding:1px 5px;font-size:10px;">${escapeHtml(factors.runInAnalysis.awayStats.diffLabel)}</span></span>` : ""}
                    </div>
                    ${aSos?.reason ? `<div class="text-xs mt-1.5 font-mono ${aSos.isDropRed ? "text-danger font-semibold" : aSos.isGainBlue ? "text-brand font-semibold" : "text-muted"}">${escapeHtml(aSos.reason)}</div>` : ""}
                  </div>
                </div>

                ${ppg.scheduleStrength?.systemVerdict ? `
                  <div class="ppg-sos-verdict-box mt-2 p-2 rounded-md" style="background:rgba(255,255,255,0.04); border-left:3px solid ${ppg.scheduleStrength?.favoredSide === "HOME" ? '#3B82F6' : ppg.scheduleStrength?.favoredSide === "AWAY" ? '#3B82F6' : (hSos?.isDropRed || aSos?.isDropRed) ? '#EF4444' : 'var(--brand)'}; font-size:12px;">
                    <strong style="color:${ppg.scheduleStrength?.favoredSide === "HOME" ? '#3B82F6' : ppg.scheduleStrength?.favoredSide === "AWAY" ? '#3B82F6' : (hSos?.isDropRed || aSos?.isDropRed) ? '#EF4444' : 'var(--brand)'}; font-family:var(--font-mono);">
                      ${ppg.scheduleStrength?.favoredSide === "HOME" ? "🔵 HOME SCHEDULE ADVANTAGE" : ppg.scheduleStrength?.favoredSide === "AWAY" ? "🔵 AWAY SCHEDULE ADVANTAGE" : (hSos?.isDropRed || aSos?.isDropRed) ? "🔴 SCHEDULE REGRESSION ALERT" : "⚡ PPG SCHEDULE ANALYSIS"}:
                    </strong>
                    <span class="text-text-secondary">${escapeHtml(ppg.scheduleStrength?.systemVerdict || "")}</span>
                  </div>
                ` : ""}

                <div class="ppg-table-stakes-box mt-2">
                  <div class="stakes-item">
                    <span class="stakes-label">Points Needed:</span>
                    <span class="text-text-secondary">${escapeHtml(pointsNeeded)}</span>
                  </div>
                  <div class="stakes-item">
                    <span class="stakes-label">Draw Importance:</span>
                    <span class="text-text-secondary">${escapeHtml(drawImportance)}</span>
                  </div>
                  <div class="stakes-item">
                    <span class="stakes-label">Table Loss Impact:</span>
                    <span class="text-text-secondary">${escapeHtml(lossImpact)}</span>
                  </div>
                </div>

                ${best ? `
                  <div class="flex items-center justify-between gap-2 flex-wrap mt-2 pt-2 border-t border-line-soft">
                    <div class="text-xs text-text-secondary">
                      Sure Pick Aligned with PPG: <strong class="text-brand font-mono">${escapeHtml(best.label)} @ ${best.odds.toFixed(2)}</strong> (${Math.round(best.prob * 100)}% modeled probability)
                    </div>
                    <button type="button" class="analyze-inline-btn" data-match-id="${m.id}">Scouting Modal &rarr;</button>
                  </div>
                ` : ""}
              </div>
            `;
          })
          .join("");

    return `
      <div class="hero-banner">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="sure-pill-tag">PPG GAP ANALYSIS</span>
            <span class="sure-pill-tag">STRENGTH OF SCHEDULE</span>
            <span class="sure-pill-tag">SOFT VS HARD OPPONENTS</span>
          </div>
          <a href="/run-in" data-route="/run-in" class="analyze-inline-btn" style="background:#10B981;color:#07100F;border-color:#7CE8C4;font-weight:700;">📈 Full Run-In Table (PLD vs REM) &rarr;</a>
        </div>
        <h1 class="mt-2">Points Per Game (PPG) &amp; Strength of Schedule Matrix</h1>
        <p>Mathematical scouting measuring Overall, Home, and Away PPG weighted by opponent difficulty. Exposes teams that played soft/cheap opponents and will drop points (🔴) vs teams battle-tested against giants set to gain points (🔵).</p>

        <!-- Strength of Schedule (SoS) PPG Matrix Showcase -->
        <div class="ppg-sos-banner">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-bold px-2 py-0.5 rounded" style="background:#0A7B5C;color:#fff;">PPG STRENGTH OF SCHEDULE ENGINE</span>
              <span class="text-xs text-text-secondary font-mono">Soft vs Hard Opponent Matrix Active</span>
            </div>
            <span class="font-mono text-xs text-muted">Active Sports Filter: ${escapeHtml((state.activeSport || "ALL").toUpperCase())}</span>
          </div>
          <div class="ppg-sos-legend">
            <div class="ppg-sos-legend-item">
              <span class="ppg-sos-badge is-drop-red">🔴 DROP POINTS RISK (RED)</span>
              <span class="text-xs text-text-secondary">Played soft/cheap opponents; facing difficult opponent today — high danger of dropping points.</span>
            </div>
            <div class="ppg-sos-legend-item">
              <span class="ppg-sos-badge is-gain-blue">🔵 GAIN POINTS SURGE (BLUE)</span>
              <span class="text-xs text-text-secondary">Battle-tested against top tier; facing soft/weak defense today — primed to gain points and win.</span>
            </div>
          </div>
        </div>

        <div class="intel-tabs mt-3" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeCat === "ALL" ? " is-active" : ""}" data-ppg-cat="ALL">All PPG Edges (${ppgListAll.length})</button>
          <button type="button" class="filter-chip${activeCat === "DROP_POINTS" ? " is-active" : ""}" data-ppg-cat="DROP_POINTS" style="border-left:3px solid #EF4444; color:${activeCat === 'DROP_POINTS' ? '#fff' : '#EF4444'};">🔴 Drop Points Alerts (${dropPointsCount})</button>
          <button type="button" class="filter-chip${activeCat === "GAIN_POINTS" ? " is-active" : ""}" data-ppg-cat="GAIN_POINTS" style="border-left:3px solid #3B82F6; color:${activeCat === 'GAIN_POINTS' ? '#fff' : '#3B82F6'};">🔵 Gain Points Surges (${gainPointsCount})</button>
          <button type="button" class="filter-chip${activeCat === "HIGH_GAP" ? " is-active" : ""}" data-ppg-cat="HIGH_GAP">Massive PPG Gaps &gt; 0.35 (${highGapCount})</button>
          <button type="button" class="filter-chip${activeCat === "HOME_DOMINANT" ? " is-active" : ""}" data-ppg-cat="HOME_DOMINANT">Dominant Home PPG</button>
          <button type="button" class="filter-chip${activeCat === "AWAY_DOMINANT" ? " is-active" : ""}" data-ppg-cat="AWAY_DOMINANT">Road Powerhouses</button>
          <button type="button" class="filter-chip${activeCat === "POINTS_STAKES" ? " is-active" : ""}" data-ppg-cat="POINTS_STAKES">Crucial Table Stakes</button>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <h2>PPG Hegemony &amp; Standings Calculations</h2>
          <span class="count">${filteredPpg.length} Fixtures</span>
        </div>
        <div>${bodyHtml}</div>
      </section>
    `;
  }

  // ============ DEDICATED /run-in SOCCERSTATS.COM RUN-IN ANALYSIS VIEW ============
  function renderRunInAnalysisView() {
    const activeCode = String(state.activeRuninLeague || "england").toLowerCase();
    const activeFilter = String(state.activeRuninFilter || "ALL").toUpperCase();
    const leagueData = runinLeagueCacheClient.get(activeCode);

    // Kick off fetch lazily if user landed on /run-in directly without cache yet
    if (!leagueData && !isLoadingRuninView) {
      setTimeout(() => loadRuninLeague(activeCode, false), 0);
    }

    const QUICK_LEAGUES = [
      { code: "england", label: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
      { code: "spain", label: "La Liga", flag: "🇪🇸" },
      { code: "italy", label: "Serie A", flag: "🇮🇹" },
      { code: "germany", label: "Bundesliga", flag: "🇩🇪" },
      { code: "france", label: "Ligue 1", flag: "🇫🇷" },
      { code: "cleague", label: "Champions League", flag: "🇪🇺" },
      { code: "eleague", label: "Europa League", flag: "🇪🇺" },
      { code: "england2", label: "Championship", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
      { code: "netherlands", label: "Eredivisie", flag: "🇳🇱" },
      { code: "portugal", label: "Liga Portugal", flag: "🇵🇹" },
      { code: "turkey", label: "Süper Lig", flag: "🇹🇷" },
      { code: "belgium", label: "Pro League", flag: "🇧🇪" },
      { code: "scotland", label: "Premiership", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" }
    ];

    const catalog = (runinCatalogClient.length > 0 ? runinCatalogClient : RT?.getRuninCatalog?.()) || leagueData?.leagues || QUICK_LEAGUES.map((q) => ({ code: q.code, name: q.label, country: "", flag: q.flag }));
    const rawRows = leagueData?.table || [];

    const favorableRows = rawRows.filter((r) => r.diffPct > 0);
    const toughRows = rawRows.filter((r) => r.diffPct < 0);
    const strongPpgEasyRows = rawRows.filter((r) => r.ppg >= 1.60 && r.diffPct > 0);

    let filteredRows = rawRows;
    if (activeFilter === "FAVORABLE") {
      filteredRows = [...favorableRows].sort((a, b) => b.diffPct - a.diffPct);
    } else if (activeFilter === "TOUGH") {
      filteredRows = [...toughRows].sort((a, b) => a.diffPct - b.diffPct);
    } else if (activeFilter === "STRONG_PPG_EASY") {
      filteredRows = [...strongPpgEasyRows].sort((a, b) => (b.ppg + b.diffPct / 100) - (a.ppg + a.diffPct / 100));
    }

    const easiestTop = [...rawRows].sort((a, b) => b.diffPct - a.diffPct)[0];
    const toughestTop = [...rawRows].sort((a, b) => a.diffPct - b.diffPct)[0];
    const strongPpgLock = [...strongPpgEasyRows].sort((a, b) => (b.ppg * 100 + b.diffPct) - (a.ppg * 100 + a.diffPct))[0]
      || [...rawRows].filter((r) => r.ppg >= 1.60).sort((a, b) => b.diffPct - a.diffPct)[0];

    const leagueMeta = leagueData?.league || catalog.find((l) => l.code === activeCode) || { name: "Premier League", country: "England", flag: "⚽" };
    const summaryInfo = leagueData?.summary;

    const highlightsHtml = rawRows.length === 0 ? "" : `
      <div class="runin-highlights-grid">
        <div class="runin-highlight-card" style="border-left:4px solid #16A34A;">
          <div class="text-xs font-mono font-bold" style="color:#16A34A;">🟢 EASIEST REMAINING RUN-IN</div>
          <div class="text-base font-bold mt-1">${escapeHtml(easiestTop?.team || "-")} <span class="runin-diff-pill is-easy ml-1">${escapeHtml(easiestTop?.diffLabel || "0%")}</span></div>
          <div class="text-xs text-muted mt-1">Played PPG: <strong class="font-mono text-text">${easiestTop?.playedPpg?.toFixed(2) ?? "-"}</strong> &rarr; Remaining PPG: <strong class="font-mono" style="color:#3B82F6;">${easiestTop?.remainingPpg?.toFixed(2) ?? "-"}</strong> (${easiestTop?.ppg?.toFixed(2) ?? "-"} Team PPG)</div>
        </div>
        <div class="runin-highlight-card" style="border-left:4px solid #DC2626;">
          <div class="text-xs font-mono font-bold" style="color:#DC2626;">🔴 TOUGHEST REMAINING RUN-IN</div>
          <div class="text-base font-bold mt-1">${escapeHtml(toughestTop?.team || "-")} <span class="runin-diff-pill is-tough ml-1">${escapeHtml(toughestTop?.diffLabel || "0%")}</span></div>
          <div class="text-xs text-muted mt-1">Played PPG: <strong class="font-mono text-text">${toughestTop?.playedPpg?.toFixed(2) ?? "-"}</strong> &rarr; Remaining PPG: <strong class="font-mono" style="color:#3B82F6;">${toughestTop?.remainingPpg?.toFixed(2) ?? "-"}</strong> (${toughestTop?.ppg?.toFixed(2) ?? "-"} Team PPG)</div>
        </div>
        <div class="runin-highlight-card" style="border-left:4px solid #10B981;">
          <div class="text-xs font-mono font-bold" style="color:#10B981;">💎 STRONG PPG + BEST RUN-IN</div>
          <div class="text-base font-bold mt-1">${escapeHtml(strongPpgLock?.team || "-")} <span class="ppg-stat-badge ml-1">PPG <strong>${strongPpgLock?.ppg?.toFixed(2) ?? "-"}</strong></span></div>
          <div class="text-xs text-muted mt-1">Played: <strong class="font-mono text-text">${strongPpgLock?.playedPpg?.toFixed(2) ?? "-"}</strong> &bull; Rem: <strong class="font-mono" style="color:#3B82F6;">${strongPpgLock?.remainingPpg?.toFixed(2) ?? "-"}</strong> &bull; Diff: <strong>${escapeHtml(strongPpgLock?.diffLabel || "0%")}</strong></div>
        </div>
      </div>
    `;

    const tableRowsHtml = filteredRows.map((row) => {
      const isExpanded = expandedRuninTeam === `${activeCode}:${row.team}`;
      const diffCls = row.diffPct > 0 ? "is-easy" : row.diffPct < 0 ? "is-tough" : "is-balanced";
      const isStrongPpg = row.ppg >= 1.60;
      const drawerHtml = !isExpanded ? "" : `
        <tr class="runin-drawer-row">
          <td colspan="11">
            <div class="runin-opp-grid">
              <div>
                <div class="text-xs font-bold uppercase tracking-wide text-text">Opponents Played (${row.playedOpponents?.length || 0} matches · Avg ${row.playedPpg.toFixed(2)} PPG)</div>
                <div class="text-xs text-muted mt-0.5">Seasonal away PPG of past home visitors &amp; seasonal home PPG of past away hosts:</div>
                <div class="runin-opp-list">
                  ${(row.playedOpponents || []).length === 0
                    ? `<span class="text-xs text-muted">No completed fixtures listed yet.</span>`
                    : row.playedOpponents.map((op) => `
                        <span class="runin-opp-chip">
                          <span class="${op.venue === "H" ? "v-h" : "v-a"}">(${op.venue}) ${op.venue === "H" ? "vs" : "at"}</span>
                          <strong>${escapeHtml(op.opponent)}</strong>
                          <span class="font-mono text-muted">(${op.oppVenuePpg !== null ? op.oppVenuePpg.toFixed(2) : "-"})</span>
                        </span>
                      `).join("")
                  }
                </div>
              </div>
              <div>
                <div class="text-xs font-bold uppercase tracking-wide" style="color:#3B82F6;">Remaining Opponents (${row.remainingOpponents?.length || 0} matches · Avg ${row.remainingPpg.toFixed(2)} PPG)</div>
                <div class="text-xs text-muted mt-0.5">Away PPG of upcoming home visitors &amp; home PPG of upcoming away hosts:</div>
                <div class="runin-opp-list">
                  ${(row.remainingOpponents || []).length === 0
                    ? `<span class="text-xs text-muted">No remaining fixtures listed.</span>`
                    : row.remainingOpponents.map((op) => `
                        <span class="runin-opp-chip">
                          <span class="${op.venue === "H" ? "v-h" : "v-a"}">(${op.venue}) ${op.venue === "H" ? "vs" : "at"}</span>
                          <strong>${escapeHtml(op.opponent)}</strong>
                          <span class="font-mono text-muted">(${op.oppVenuePpg !== null ? op.oppVenuePpg.toFixed(2) : "-"})</span>
                        </span>
                      `).join("")
                  }
                </div>
              </div>
            </div>
          </td>
        </tr>
      `;

      return `
        <tr class="runin-row" data-toggle-runin-team="${escapeHtml(`${activeCode}:${row.team}`)}" title="Click to inspect all Opponents Played (PLD) &amp; Remaining Opponents (REM)">
          <td class="font-mono font-bold">${row.rank}</td>
          <td>
            <div class="flex items-center gap-1.5">
              <strong class="text-text">${escapeHtml(row.team)}</strong>
              ${isStrongPpg ? `<span title="Strong PPG Team (>= 1.60)">💎</span>` : ""}
              <span class="text-xs text-muted font-mono">${isExpanded ? "▲" : "▼"}</span>
            </div>
          </td>
          <td class="text-center font-mono font-bold" style="color:#16A34A;">${row.gp}</td>
          <td class="text-center font-mono">${row.w}</td>
          <td class="text-center font-mono">${row.d}</td>
          <td class="text-center font-mono">${row.l}</td>
          <td class="text-center font-mono font-bold">${row.pts}</td>
          <td class="text-center font-mono font-bold" style="${isStrongPpg ? "color:#10B981;" : ""}">${row.ppg.toFixed(2)}</td>
          <td class="text-center"><span class="runin-ppg-pill">${row.playedPpg.toFixed(2)}</span></td>
          <td>
            <div class="runin-rem-cell">
              <span class="runin-ppg-pill is-rem">${row.remainingPpg.toFixed(2)}</span>
              <span class="runin-bar-track"><span class="runin-bar-fill" style="width:${Math.min(100, Math.max(4, row.remainingBarPct || 50))}%;"></span></span>
            </div>
          </td>
          <td class="text-center"><span class="runin-diff-pill ${diffCls}">${escapeHtml(row.diffLabel)}</span></td>
        </tr>
        ${drawerHtml}
      `;
    }).join("");

    return `
      <div class="hero-banner">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="sure-pill-tag" style="background:#10B981;color:#07100F;font-weight:800;">📈 SOCCERSTATS RUN-IN ENGINE</span>
            <span class="sure-pill-tag">OPPONENTS PLAYED (PLD) VS REMAINING (REM)</span>
            ${summaryInfo ? `<span class="sure-pill-tag">${summaryInfo.matchesPlayed} / ${summaryInfo.totalMatches} Played (${escapeHtml(summaryInfo.progressPct)})</span>` : ""}
          </div>
          <button type="button" class="analyze-inline-btn" data-runin-refresh="1" style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.22);">↻ Sync Live Tables</button>
        </div>

        <h1 class="mt-2">${escapeHtml(leagueMeta.country ? `${leagueMeta.country} - ${leagueMeta.name}` : leagueMeta.name)}: Run-in Analysis</h1>
        <p>Live SoccerSTATS.com Run-In schedule difficulty evaluator comparing the venue-weighted PPG of opponents already faced against remaining fixtures.</p>

        <!-- HOW IT WORKS CARDS -->
        <div class="runin-how-grid">
          <div class="runin-how-card">
            <div class="text-xs font-mono font-bold text-white uppercase">1. Opponents Played (PLD)</div>
            <div class="text-xs mt-1" style="color:#D1E0D9;">Calculates the average PPG of teams already faced, accounting for home vs. away using opponents&rsquo; respective away/home PPG records.</div>
          </div>
          <div class="runin-how-card">
            <div class="text-xs font-mono font-bold uppercase" style="color:#7CE8C4;">2. Remaining Opponents (REM)</div>
            <div class="text-xs mt-1" style="color:#D1E0D9;">Calculates the average PPG of upcoming opponents, weighted identically by venue (visitors&rsquo; away PPG vs. hosts&rsquo; home PPG).</div>
          </div>
          <div class="runin-how-card">
            <div class="text-xs font-mono font-bold uppercase" style="color:#93C5FD;">3. Played vs. Remaining (%)</div>
            <div class="text-xs mt-1" style="color:#D1E0D9;"><strong class="text-white">Negative % (-):</strong> remaining fixtures are tougher. <strong style="color:#7CE8C4;">Positive % (+):</strong> more favorable, easier run-in ahead.</div>
          </div>
        </div>

        <!-- LEAGUE SELECTOR BAR -->
        <div class="flex items-center justify-between gap-2 flex-wrap mt-3">
          <div class="intel-tabs" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);flex:1;">
            ${QUICK_LEAGUES.map((ql) => `
              <button type="button" class="filter-chip${activeCode === ql.code ? " is-active" : ""}" data-runin-league="${ql.code}">${ql.flag} ${escapeHtml(ql.label)}</button>
            `).join("")}
          </div>
          <select id="runinLeagueSelect" aria-label="Select any SoccerSTATS league" style="background:rgba(7,16,15,0.85);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:var(--radius-sm);padding:6px 10px;font-size:12px;font-weight:600;">
            ${catalog.map((lg) => `
              <option value="${escapeHtml(lg.code)}"${activeCode === lg.code ? " selected" : ""}>${lg.flag || "⚽"} ${lg.country ? `${escapeHtml(lg.country)} - ` : ""}${escapeHtml(lg.name)}</option>
            `).join("")}
          </select>
        </div>

        <!-- FILTER TABS -->
        <div class="intel-tabs mt-2" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);">
          <button type="button" class="filter-chip${activeFilter === "ALL" ? " is-active" : ""}" data-runin-filter="ALL">All Teams (${rawRows.length})</button>
          <button type="button" class="filter-chip${activeFilter === "FAVORABLE" ? " is-active" : ""}" data-runin-filter="FAVORABLE" style="color:${activeFilter === "FAVORABLE" ? "#fff" : "#7CE8C4"};">🟢 Easier Run-In (+%) (${favorableRows.length})</button>
          <button type="button" class="filter-chip${activeFilter === "TOUGH" ? " is-active" : ""}" data-runin-filter="TOUGH" style="color:${activeFilter === "TOUGH" ? "#fff" : "#FCA5A5"};">🔴 Tougher Run-In (-%) (${toughRows.length})</button>
          <button type="button" class="filter-chip${activeFilter === "STRONG_PPG_EASY" ? " is-active" : ""}" data-runin-filter="STRONG_PPG_EASY" style="color:${activeFilter === "STRONG_PPG_EASY" ? "#fff" : "#FDE68A"};">💎 Strong PPG (&ge;1.60) + Easy Run-In (${strongPpgEasyRows.length})</button>
        </div>
      </div>

      ${highlightsHtml}

      <section class="panel">
        <div class="panel-header">
          <h2>${escapeHtml(leagueMeta.name)} — Run-In Difficulty Table</h2>
          <span class="count">${isLoadingRuninView ? "Syncing live from SoccerSTATS..." : `${filteredRows.length} Teams · Click any row for opponent PPG breakdown`}</span>
        </div>
        ${
          isLoadingRuninView && rawRows.length === 0
            ? `<div class="empty-state"><h3>Fetching live Run-In Analysis for ${escapeHtml(leagueMeta.name)}...</h3><p class="text-sm">Calculating Opponents Played PPG (PLD) vs. Remaining Opponents PPG (REM).</p></div>`
            : filteredRows.length === 0
              ? `<div class="empty-state"><h3>No teams match current Run-In filter</h3><p class="text-sm">Switch to All Teams above or pick another active league.</p></div>`
              : `<div class="runin-table-wrap">
                  <table class="runin-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Team</th>
                        <th style="text-align:center;">GP</th>
                        <th style="text-align:center;">W</th>
                        <th style="text-align:center;">D</th>
                        <th style="text-align:center;">L</th>
                        <th style="text-align:center;">Pts</th>
                        <th style="text-align:center;">PPG</th>
                        <th style="text-align:center;">Opponents<br>played PPG</th>
                        <th style="color:#3B82F6;">Opponents<br>remaining PPG</th>
                        <th style="text-align:center;">Played vs<br>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tableRowsHtml}
                    </tbody>
                  </table>
                </div>`
        }
      </section>
    `;
  }

  // ============ STRONG & WORST TEAMS TODAY (SEPARATE SECTIONS) ============
  function renderTodayPowerPreviewCard() {
    const cleanMatches = liveMatches.filter((m) => !isNcaaOrWomenMatch(m));
    if (!RT?.buildTodayPowerRankings || cleanMatches.length === 0) return "";
    const p = RT.buildTodayPowerRankings(cleanMatches);
    const quads = [
      { key: "STRONG_HOME", title: "STRONG HOME TODAY", item: p.strongHome[0], isStrong: true, route: "/strong-teams?cat=STRONG_HOME" },
      { key: "STRONG_AWAY", title: "STRONG AWAY TODAY", item: p.strongAway[0], isStrong: true, route: "/strong-teams?cat=STRONG_AWAY" },
      { key: "WORST_HOME", title: "WORST HOME TODAY", item: p.worstHome[0], isStrong: false, route: "/worst-teams?cat=WORST_HOME" },
      { key: "WORST_AWAY", title: "WORST AWAY TODAY", item: p.worstAway[0], isStrong: false, route: "/worst-teams?cat=WORST_AWAY" }
    ];
    return `
      <section class="panel" id="powerPicksHomeCard">
        <div class="panel-header">
          <div class="flex items-center gap-2">
            <span class="live-dot" style="background:var(--brand);"></span>
            <h2>Strong &amp; Worst Teams Today</h2>
          </div>
          <div class="flex items-center gap-3">
            <a class="see-all text-xs font-bold" href="/strong-teams" data-route="/strong-teams" style="color:var(--brand);">🦁 Strong Teams</a>
            <a class="see-all text-xs font-bold" href="/worst-teams" data-route="/worst-teams" style="color:var(--live);">⚠️ Worst Teams</a>
          </div>
        </div>
        <div class="power-preview-grid">
          ${quads
            .map((q) => {
              const x = q.item;
              if (!x) {
                return `<a class="power-preview-tile${q.isStrong ? " is-strong" : " is-worst"}" href="${q.route}" data-route="${q.route}">
                  <span class="tile-kicker">${q.title}</span>
                  <span class="text-xs text-muted">No clear candidate yet</span>
                </a>`;
              }
              const scoreVal = q.isStrong ? x.strongScore : x.worstScore;
              return `
                <a class="power-preview-tile${q.isStrong ? " is-strong" : " is-worst"}" href="${q.route}" data-route="${q.route}">
                  <div class="flex items-center justify-between gap-1 w-full">
                    <span class="tile-kicker">${q.title}</span>
                    <span class="power-score-pill${q.isStrong ? " is-strong" : " is-worst"}">${q.isStrong ? "PWR" : "RISK"} ${scoreVal}</span>
                  </div>
                  <div class="flex items-center gap-2 mt-1 w-full">
                    ${crestImg(x.team.logo, x.team.name, x.team.color, 20)}
                    <span class="font-bold text-sm truncate">${escapeHtml(x.team.name)}</span>
                  </div>
                  <div class="text-xs text-text-secondary mt-1 truncate">${x.isHome ? "vs" : "@"} ${escapeHtml(x.opponent.short)} · ${escapeHtml(x.match.displayTime)}</div>
                  <div class="text-xs text-muted mt-1 truncate">PPG ${x.criteria.ppg.overall.toFixed(2)} · Form ${x.criteria.form.pts}/15 · ${x.criteria.standing.rank ? `#${x.criteria.standing.rank}` : escapeHtml(x.criteria.form.record)}</div>
                </a>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderHomeBookmakerMismatchCard() {
    if (!bookmakerScan && !isLoadingBookmakers) return "";
    const sc = bookmakerScan;
    const totalCount = sc?.totalGamesScraped || 0;
    const quads = [
      {
        key: "STRONG_HOME",
        title: "STRONG HOME · MISTAKE BIG ODDS",
        subLabel: "Strong Team Big Odd vs Opp Low Odd",
        item: sc?.strongHomeMismatch?.[0],
        isStrong: true
      },
      {
        key: "STRONG_AWAY",
        title: "STRONG AWAY · MISTAKE BIG ODDS",
        subLabel: "Strong Team Big Odd vs Opp Low Odd",
        item: sc?.strongAwayMismatch?.[0],
        isStrong: true
      },
      {
        key: "WORST_HOME",
        title: "WORST HOME · MISTAKE LOW ODDS",
        subLabel: "Worst Team Low Odd vs Opp Big Odd",
        item: sc?.worstHomeMismatch?.[0],
        isStrong: false
      },
      {
        key: "WORST_AWAY",
        title: "WORST AWAY · MISTAKE LOW ODDS",
        subLabel: "Worst Team Low Odd vs Opp Big Odd",
        item: sc?.worstAwayMismatch?.[0],
        isStrong: false
      }
    ];

    return `
      <section class="panel" id="mismatchHomeCard">
        <div class="panel-header">
          <span class="live-dot" style="background:#D97706;"></span>
          <h2>Bookmaker Trap &amp; Mistake Odds Scanner · SportyBet &amp; Football.com (${totalCount ? `${totalCount} Games Scraped` : "Scanning..."})</h2>
          <a class="see-all" href="/odds-mismatch" data-route="/odds-mismatch">
            Open Full Trap Scanner
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </a>
        </div>
        <div class="px-4 py-2 text-xs text-text-secondary border-b bg-ground-subtle flex items-center justify-between flex-wrap gap-2">
          <span>Exposes <strong>Strong Teams given Mistake Big Odds (Opponent Low Odds)</strong> &amp; <strong>Worst Teams given Mistake Low Odds (Opponent Big Odds)</strong> on <strong>football.com</strong> &amp; <strong>sportybet.com</strong>.</span>
          <a href="/odds-mismatch" data-route="/odds-mismatch" class="text-brand font-bold">View All Trap &amp; Mistake Games &rarr;</a>
        </div>
        <div class="power-preview-grid">
          ${quads
            .map((q) => {
              const x = q.item;
              if (!x) {
                return `<a class="power-preview-tile${q.isStrong ? " is-strong" : " is-worst"}" href="/odds-mismatch?cat=${q.key}" data-route="/odds-mismatch?cat=${q.key}">
                  <span class="tile-kicker">${q.title}</span>
                  <span class="text-xs text-muted">${isLoadingBookmakers ? "Scraping SportyBet & Football.com..." : "Open scanner"}</span>
                </a>`;
              }
              const sbCode = x.sportybet?.gameId || "-";
              const fbCode = x.footballCom?.gameId || "-";
              const oddBadge = q.isStrong
                ? `Big @ ${Number(x.mistakeBigOdd || x.mismatchBigOdd).toFixed(2)} vs Low @ ${Number(x.opponentLowOdd || 1.9).toFixed(2)}`
                : `Low Trap @ ${Number(x.mistakeLowOdd || x.worstTeamOdd).toFixed(2)} -> Opp Big @ ${Number(x.opponentBigOdd || x.mismatchBigOdd).toFixed(2)}`;
              return `
                <a class="power-preview-tile${q.isStrong ? " is-strong" : " is-worst"}" href="/odds-mismatch?cat=${q.key}" data-route="/odds-mismatch?cat=${q.key}">
                  <div class="flex items-center justify-between gap-1 w-full">
                    <span class="tile-kicker">${q.title}</span>
                    <span class="power-score-pill${q.isStrong ? " is-strong" : " is-worst"}">WIN @ ${x.mismatchBigOdd.toFixed(2)}</span>
                  </div>
                  <div class="font-bold text-sm truncate mt-1 w-full">${escapeHtml(x.targetTeam)} <span class="text-xs font-normal text-muted">(${x.side === "HOME" ? "Home" : "Away"})</span></div>
                  <div class="text-xs font-mono ${q.isStrong ? "text-brand" : "text-live"} truncate mt-0.5">${escapeHtml(oddBadge)}</div>
                  <div class="text-xs text-muted truncate mt-1">vs ${escapeHtml(x.opponentTeam)} · SB #${escapeHtml(String(sbCode))} · FB #${escapeHtml(String(fbCode))}</div>
                </a>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderHomeHandicapValueCard() {
    const handData = RT?.buildHandicapValueBets ? RT.buildHandicapValueBets(filteredMatchesForDate(), bookmakerScan) : null;
    if (!handData || !handData.allTips || handData.allTips.length === 0) return "";
    const topTips = handData.allTips.slice(0, 3);
    const totalCount = handData.allTips.length;

    return `
      <section class="panel-section border-subtle" id="handicapValueHomeCard" style="border: 2px solid rgba(16, 185, 129, 0.45); background: linear-gradient(145deg, var(--card) 0%, rgba(16, 185, 129, 0.04) 100%); border-radius: var(--radius-lg); margin-bottom: 20px; overflow: hidden; box-shadow: 0 4px 20px rgba(16, 185, 129, 0.08);">
        <div class="panel-header" style="background: linear-gradient(90deg, rgba(16, 185, 129, 0.12) 0%, transparent 100%); border-bottom: 1px solid rgba(16, 185, 129, 0.25); padding: 14px 18px;">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="sure-pill-tag" style="background:#10B981;color:#07100F;font-weight:800;">🎯 WINNING HANDICAP TIPS</span>
            <span class="sure-pill-tag">+EV VALUE BETS DETECTED (${totalCount})</span>
            <span class="font-mono text-xs text-muted">· Fair Odds vs Bookmaker Odds</span>
          </div>
          <div class="flex items-center gap-2">
            <a class="btn-subtle text-xs" href="/handicap" data-route="/handicap" style="font-weight:700;color:#10B981;">Open Handicap &amp; +EV Center &rarr;</a>
          </div>
        </div>
        <div class="p-3">
          <div class="grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;">
            ${topTips.map((tip, i) => `
              <a class="power-preview-tile is-strong" href="/handicap" data-route="/handicap" style="border-left: 3px solid #10B981; background: var(--ground);">
                <div class="flex items-center justify-between gap-1 w-full">
                  <span class="tile-kicker font-bold" style="color:#10B981;">#${i + 1} HANDICAP VALUE PICK</span>
                  <span class="ev-return-pill">${tip.expectedValuePct} EV</span>
                </div>
                <div class="font-bold text-sm truncate mt-1 w-full">${escapeHtml(tip.fixture)}</div>
                <div class="text-xs font-mono font-bold mt-0.5 text-text">${escapeHtml(tip.handicapLine)}</div>
                <div class="flex items-center justify-between text-xs text-muted mt-1.5 pt-1" style="border-top:1px dashed var(--line-soft);">
                  <span>Prob: <strong class="text-text font-mono">${tip.trueProbabilityPct}</strong></span>
                  <span>Fair: <strong class="text-text font-mono">${tip.fairOdds.toFixed(2)}</strong></span>
                  <span>Bookie: <strong style="color:#10B981;" class="font-mono">${tip.bookmakerOdds.toFixed(2)}</strong></span>
                </div>
              </a>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderHomeSpecialTipsCard() {
    const specialData = RT?.buildDrawDefenseTips ? RT.buildDrawDefenseTips(filteredMatchesForDate(), bookmakerScan) : null;
    if (!specialData || !specialData.fiveMinuteDrawTips || specialData.fiveMinuteDrawTips.length === 0) return "";
    const top5Min = specialData.fiveMinuteDrawTips.slice(0, 2);
    const topNo3 = specialData.noThreeInARowTips.slice(0, 2);
    const totalCount = specialData.fiveMinuteDrawTips.length + specialData.noThreeInARowTips.length;

    return `
      <section class="panel-section border-subtle" id="drawDefenseHomeCard" style="border: 2px solid rgba(6, 182, 212, 0.45); background: linear-gradient(145deg, var(--card) 0%, rgba(6, 182, 212, 0.04) 100%); border-radius: var(--radius-lg); margin-bottom: 20px; overflow: hidden; box-shadow: 0 4px 20px rgba(6, 182, 212, 0.08);">
        <div class="panel-header" style="background: linear-gradient(90deg, rgba(6, 182, 212, 0.12) 0%, transparent 100%); border-bottom: 1px solid rgba(6, 182, 212, 0.25); padding: 14px 18px;">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="sure-pill-tag" style="background:#06B6D4;color:#042F2E;font-weight:800;">⏱️ 5-MIN DRAW &amp; DEFENSE TIPS</span>
            <span class="sure-pill-tag">${totalCount} WINNING TIPS READY (50 DRAW + 50 ANTI-BLOWOUT)</span>
            <span class="font-mono text-xs text-muted">· Screened Across 22 Low-Scoring Leagues</span>
          </div>
          <div class="flex items-center gap-2">
            <a class="btn-subtle text-xs" href="/special-tips" data-route="/special-tips" style="font-weight:700;color:#06B6D4;">Open 5-Min Draw Center (100 Tips) &rarr;</a>
          </div>
        </div>
        <div class="p-3">
          <div class="grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;">
            ${top5Min.map((tip, i) => `
              <a class="power-preview-tile is-strong" href="/special-tips?tab=5MIN_DRAW" data-route="/special-tips?tab=5MIN_DRAW" style="border-left: 3px solid #06B6D4; background: var(--ground);">
                <div class="flex items-center justify-between gap-1 w-full">
                  <span class="tile-kicker font-bold" style="color:#06B6D4;">#${i + 1} 5-MIN DRAW (0-0)</span>
                  <span class="ev-return-pill" style="background:#06B6D4;color:#042F2E;">${tip.expectedValuePct} EV</span>
                </div>
                <div class="font-bold text-sm truncate mt-1 w-full">${tip.flag} ${escapeHtml(tip.fixture)}</div>
                <div class="text-xs font-mono font-bold mt-0.5 text-muted">${escapeHtml(tip.league)} · Draw: ${tip.leagueDrawRatePct}</div>
                <div class="flex items-center justify-between text-xs text-muted mt-1.5 pt-1" style="border-top:1px dashed var(--line-soft);">
                  <span>Prob: <strong class="text-text font-mono">${tip.trueProbabilityPct}</strong></span>
                  <span>Fair: <strong class="text-text font-mono">${tip.fairOdds.toFixed(2)}</strong></span>
                  <span>Bookie: <strong style="color:#06B6D4;" class="font-mono">${tip.bookmakerOdds.toFixed(2)}</strong></span>
                </div>
              </a>
            `).join("")}
            ${topNo3.map((tip, i) => `
              <a class="power-preview-tile is-strong" href="/special-tips?tab=NO_3_ROW" data-route="/special-tips?tab=NO_3_ROW" style="border-left: 3px solid #10B981; background: var(--ground);">
                <div class="flex items-center justify-between gap-1 w-full">
                  <span class="tile-kicker font-bold" style="color:#10B981;">#${i + 1} NO 3+ GOALS IN A ROW</span>
                  <span class="ev-return-pill" style="background:#10B981;color:#042F2E;">${tip.expectedValuePct} EV</span>
                </div>
                <div class="font-bold text-sm truncate mt-1 w-full">${tip.flag} ${escapeHtml(tip.fixture)}</div>
                <div class="text-xs font-mono font-bold mt-0.5 text-muted">${escapeHtml(tip.league)} · Resistance: ${tip.consecutiveGoalResistancePct}</div>
                <div class="flex items-center justify-between text-xs text-muted mt-1.5 pt-1" style="border-top:1px dashed var(--line-soft);">
                  <span>Prob: <strong class="text-text font-mono">${tip.trueProbabilityPct}</strong></span>
                  <span>Fair: <strong class="text-text font-mono">${tip.fairOdds.toFixed(2)}</strong></span>
                  <span>Bookie: <strong style="color:#10B981;" class="font-mono">${tip.bookmakerOdds.toFixed(2)}</strong></span>
                </div>
              </a>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderHomeLiveCard(liveList, spDef) {
    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const sortedLive = sortMatchesInOrder(liveList);
    return `
      <section class="panel live-home-panel" style="border:1px solid rgba(239, 68, 68, 0.3); background:linear-gradient(180deg, rgba(239, 68, 68, 0.04) 0%, var(--card) 100%);">
        <div class="panel-header" style="border-bottom:1px solid rgba(239, 68, 68, 0.15);">
          <div class="flex items-center gap-2">
            <span class="live-dot-pulse"></span>
            <h2 style="color:#DC2626; font-size:15px; font-weight:800; letter-spacing:-0.01em;">
              🔴 ${activeSportKey !== "all" ? escapeHtml(spDef.label) + " · " : ""}In-Play Live Games
            </h2>
            <span class="toolbar-count-badge" style="background:#FEE2E2; color:#DC2626; font-weight:800;">${liveList.length} LIVE NOW</span>
          </div>
          <a class="see-all" href="/live" data-route="/live" style="color:#DC2626; font-weight:700;">
            Open Live Section &rarr;
          </a>
        </div>
        <div>
          ${sortedLive.slice(0, 8).map(renderMatchRow).join("")}
        </div>
        ${liveList.length > 8 ? `
          <div class="p-3 text-center border-t">
            <a href="/live" data-route="/live" class="analyze-inline-btn" style="background:#DC2626; color:#fff; border-color:#DC2626;">View All ${liveList.length} Live Games &rarr;</a>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderHomeView() {
    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const spDef = ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey) || { key: "ALL", label: "All 5 Sports", icon: "🏆" };
    const baseSportMatches = liveMatches
      .filter((m) => !isNcaaOrWomenMatch(m))
      .filter((m) => activeSportKey === "all" || (m.sport || "football").toLowerCase() === activeSportKey);
    const liveMatchesPool = baseSportMatches.filter((m) => m.status === "LIVE");
    const activeDateObj = (DATA.DATES || []).find((d) => d.id === state.selectedDate);
    const upcomingTitle = activeSportKey !== "all"
      ? `${spDef.label} Upcoming Fixtures`
      : (state.selectedDate === "UPCOMING_ALL" ? "📅 Upcoming Fixtures & Schedule" : `📅 Fixtures · ${activeDateObj ? activeDateObj.label : state.selectedDate}`);

    return `
      ${renderHomeSureOddsBanner()}
      ${renderHomeHandicapValueCard()}
      ${renderHomeSpecialTipsCard()}
      ${liveMatchesPool.length > 0 ? renderHomeLiveCard(liveMatchesPool, spDef) : ""}
      ${renderMatchesPanel(liveMatches, upcomingTitle, true, false, "UPCOMING")}
      ${renderMarketIntelligenceStrip()}
      ${renderHomeBookmakerMismatchCard()}
      ${renderStandingsPanel()}
    `;
  }

  function renderMatchesView() {
    const isLiveRoute = state.route === "/live";
    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const spDef = ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey) || { key: "ALL", label: "All 5 Sports", icon: "🏆" };
    const isSingleSport = spDef.key !== "ALL";

    if (isLiveRoute) {
      state.matchFilter = "LIVE";
      const liveMatchesPool = liveMatches
        .filter((m) => !isNcaaOrWomenMatch(m))
        .filter((m) => activeSportKey === "all" || (m.sport || "football").toLowerCase() === activeSportKey)
        .filter((m) => m.status === "LIVE");

      const bannerTitle = isSingleSport
        ? `${spDef.icon} ${spDef.label} · 🔴 Live In-Play Games`
        : "🔴 Real-Time Live Match Center";
      const bannerDesc = isSingleSport
        ? `In-play matches belonging strictly to <strong>${escapeHtml(spDef.label)}</strong> with continuous live score updates.`
        : "Live in-play matches across Football, Tennis, Basketball, Darts, and Ice Hockey · Zero upcoming games.";

      return `
        <div class="hero-banner" style="margin-bottom:12px; padding:16px 20px; border-left:4px solid #DC2626;">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="live-dot-pulse"></span>
                <span class="font-mono text-xs font-bold uppercase tracking-wider" style="color:#DC2626;">Live Games Section Only</span>
              </div>
              <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin-bottom:4px;">${bannerTitle}</h1>
              <p style="font-size:13px; color:var(--text-secondary); margin:0;">${bannerDesc}</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="status-pill font-mono text-xs" style="background:#FEE2E2; color:#DC2626; font-weight:800; padding:4px 10px; border-radius:var(--radius-pill); border:1px solid #FCA5A5;">
                ${liveMatchesPool.length} LIVE NOW
              </span>
            </div>
          </div>
        </div>
        ${renderMatchesPanel(liveMatches, isSingleSport ? `${spDef.label} Live Matches` : "🔴 Live In-Play Matches", true, false, "LIVE")}
      `;
    }

    // UPCOMING FIXTURES SECTION:
    if (state.matchFilter === "LIVE") {
      state.matchFilter = "SCHEDULED";
    }
    const schedMatchesPool = liveMatches
      .filter((m) => !isNcaaOrWomenMatch(m))
      .filter((m) => activeSportKey === "all" || (m.sport || "football").toLowerCase() === activeSportKey)
      .filter((m) => m.status === "SCHEDULED");

    const activeDateObj = (DATA.DATES || []).find((d) => d.id === state.selectedDate);
    const bannerTitle = isSingleSport
      ? `${spDef.icon} ${spDef.label} · 📅 Upcoming Fixtures`
      : "📅 Upcoming Fixtures Match Center";
    const bannerDesc = isSingleSport
      ? `Upcoming scheduled matches belonging strictly to <strong>${escapeHtml(spDef.label)}</strong> from SportyBet &amp; Football.com.`
      : "Verified upcoming fixtures across Football, Tennis, Basketball, Darts, and Ice Hockey · Zero live games.";

    return `
      <div class="hero-banner" style="margin-bottom:12px; padding:16px 20px; border-left:4px solid var(--brand);">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-xs font-bold uppercase tracking-wider text-brand">📅 Upcoming Fixtures Section Only</span>
            </div>
            <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin-bottom:4px;">${bannerTitle}</h1>
            <p style="font-size:13px; color:var(--text-secondary); margin:0;">${bannerDesc}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="status-pill font-mono text-xs" style="background:var(--ground-subtle); padding:4px 10px; border-radius:var(--radius-pill); border:1px solid var(--line-soft);">
              ${schedMatchesPool.length} Upcoming Fixtures
            </span>
          </div>
        </div>
      </div>
      ${renderMatchesPanel(liveMatches, isSingleSport ? `${spDef.label} Upcoming Fixtures` : (state.selectedDate === "UPCOMING_ALL" ? "📅 Upcoming Schedule" : `Fixtures · ${activeDateObj ? activeDateObj.label : state.selectedDate}`), true, true, "UPCOMING")}
    `;
  }

  function renderPowerTeamCard(entry, idx, isStrong) {
    const m = entry.match;
    const c = entry.criteria;
    const lg = getLeagueInfo(m);
    const scoreVal = isStrong ? entry.strongScore : entry.worstScore;
    const scoreLbl = isStrong ? `Power ${scoreVal}/100` : `Risk ${scoreVal}/100`;
    const angleTxt = isStrong
      ? `${entry.team.short} ${entry.isHome ? "Home Win (1)" : "Away Win / X2"} @ ${entry.winOdd.toFixed(2)} (${entry.winProbPct}%)`
      : `Vulnerable ${entry.isHome ? "Home" : "Away"} Side · Opp ${entry.opponent.short} ${entry.loseProbPct}% win prob @ ${entry.oppOdd.toFixed(2)}`;

    const formBadges = `<div class="form-dots">${(c.form.formArr || []).map((x) => `<span class="form-dot ${x}">${x}</span>`).join("")}</div>`;

    return `
      <article class="power-team-card" data-match-id="${m.id}">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-mono text-xs font-bold px-2 py-0.5 rounded-pill ${isStrong ? "bg-brand-soft text-brand" : "alert-badge"}">#${idx + 1}</span>
            ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
            <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
            <span class="text-xs font-mono text-muted">· ${m.status === "LIVE" ? `LIVE ${escapeHtml(m.displayTime)}` : `${escapeHtml(m.date)} ${escapeHtml(m.displayTime)}`}</span>
          </div>
          <span class="power-score-pill${isStrong ? " is-strong" : " is-worst"}">${scoreLbl}</span>
        </div>

        <div class="flex items-center justify-between gap-3 flex-wrap mt-2">
          <div class="flex items-center gap-2.5 min-w-0">
            ${crestImg(entry.team.logo, entry.team.name, entry.team.color, 26)}
            <div class="min-w-0">
              <div class="font-bold text-base truncate">${escapeHtml(entry.team.name)} <span class="text-xs font-normal text-muted">${entry.isHome ? "(Home)" : "(Away)"}</span></div>
              <div class="text-xs text-text-secondary truncate">${entry.isHome ? "vs" : "@"} ${escapeHtml(entry.opponent.name)} · ${escapeHtml(m.venue || "Stadium")}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="analyze-inline-btn" data-hydrate-match="${m.id}">${m.enriched && c.weather.ok ? "✓ Weather &amp; Stats Synced" : "↻ Sync Weather &amp; Deep Stats"}</button>
            <button type="button" class="analyze-inline-btn" data-match-id="${m.id}">Match Center</button>
          </div>
        </div>

        <div class="sure-pick-box">
          <div class="text-xs">
            <span class="font-bold ${isStrong ? "text-brand" : "text-live"} uppercase">${isStrong ? "Strong Signal:" : "Weakness Signal:"}</span>
            <strong class="ml-1">${escapeHtml(angleTxt)}</strong>
          </div>
          <div class="text-xs font-mono text-text-secondary">${c.weather.ok ? `⛅ ${escapeHtml(c.weather.summary)}` : escapeHtml(c.weather.summary)}</div>
        </div>

        <div class="power-criteria-grid">
          <div class="factor-side">
            <div class="side-lbl">Form &amp; Histories</div>
            <div class="flex items-center gap-2 flex-wrap">${formBadges}<span class="font-mono text-xs font-bold">${c.form.pts}/15 pts</span></div>
            <div class="text-xs text-muted mt-1">${escapeHtml(c.histories)}</div>
          </div>

          <div class="factor-side">
            <div class="side-lbl">Goal Scoring Power &amp; PPG</div>
            <div class="text-xs">Scored: <strong class="font-mono text-brand">${c.goalScoringPower.gfAvg}/g</strong> (xG ${c.goalScoringPower.xg}) vs Opp GA <strong class="font-mono">${c.goalScoringPower.oppGaAvg}/g</strong> · Conceded <strong class="font-mono">${c.goalScoringPower.gaAvg}/g</strong></div>
            <div class="text-xs mt-1">Overall PPG: <strong class="font-mono text-brand">${c.ppg.overall.toFixed(2)}</strong> · ${entry.isHome ? "Home" : "Away"} PPG: <strong class="font-mono">${c.ppg.venue.toFixed(2)}</strong> <span class="text-muted">(Opp ${c.ppg.oppOverall.toFixed(2)})</span></div>
          </div>

          <div class="factor-side">
            <div class="side-lbl">${entry.isHome ? "Home Advantage" : "Away Advantage / Test"} &amp; H2H</div>
            <div class="text-xs">${escapeHtml(c.venueAdvantage.label)}</div>
            <div class="text-xs text-muted mt-1">H2H: <strong class="font-mono text-text">${c.h2h.myWins}W-${c.h2h.draws}D-${c.h2h.oppWins}L</strong> · Avg ${c.h2h.avgGoals} goals</div>
          </div>

          <div class="factor-side">
            <div class="side-lbl">Injuries, Suspensions &amp; Weather</div>
            <div class="text-xs"><strong>Squad:</strong> ${c.injuries.mine.length ? `${c.injuries.mine.length} inj (${escapeHtml(c.injuries.mine[0])})` : "0 inj flagged"} · ${c.suspensions.mine.length ? `${c.suspensions.mine.length} sus (${escapeHtml(c.suspensions.mine[0])})` : `Clean (${c.suspensions.redSeason} RC)`}</div>
            <div class="text-xs text-muted mt-1"><strong>Weather:</strong> ${escapeHtml(c.weather.summary)} (${escapeHtml(c.weather.impact)})</div>
          </div>

          <div class="factor-side is-wide">
            <div class="side-lbl">League Standing &amp; Points / Draw / Loss Standings Calculations</div>
            <div class="text-xs"><strong>Standing:</strong> ${escapeHtml(c.standing.summary)}</div>
            <div class="text-xs mt-1"><strong>Points Needed or Not:</strong> ${escapeHtml(c.pointsNeeded)}</div>
            <div class="text-xs mt-1"><strong>Is Draw Important Now?</strong> ${escapeHtml(c.drawImportance)}</div>
            <div class="text-xs mt-1"><strong>Will Loss Affect Points &amp; Standings?</strong> ${escapeHtml(c.lossEffect)}</div>
          </div>
        </div>
      </article>
    `;
  }

  function renderPowerSection(title, subtitle, list, isStrong, badgeClass) {
    return `
      <section class="panel">
        <div class="panel-header">
          <span class="live-dot" style="background:${isStrong ? "var(--brand)" : "var(--live)"};"></span>
          <h2>${title}</h2>
          <span class="count">${list.length} selected</span>
        </div>
        <div class="px-4 py-2 text-xs text-text-secondary border-b bg-ground-subtle">${subtitle}</div>
        ${
          list.length === 0
            ? `<div class="empty-state"><h3>Analyzing ${escapeHtml(title)}...</h3><p class="text-sm">Waiting for live matches matching these criteria right now.</p></div>`
            : `<div>${list.map((entry, idx) => renderPowerTeamCard(entry, idx, isStrong)).join("")}</div>`
        }
      </section>
    `;
  }

  // ============ DEDICATED /strong-teams VIEW ============
  function renderStrongTeamsView() {
    if (!RT?.buildTodayPowerRankings) {
      return `<div class="empty-state"><h3>Initializing Team Power Engine...</h3></div>`;
    }
    const pool = filteredMatchesForDate();
    const power = RT.buildTodayPowerRankings(pool.length > 0 ? pool : liveMatches);
    const activeFilter = state.activeStrongFilter || "ALL";

    // Hydrate city weather for visible picks cleanly once per load
    if (!isHydratingPowerWeather && RT.hydrateWeatherForMatches) {
      const visibleMatches = [
        ...power.strongHome.slice(0, 10),
        ...power.strongAway.slice(0, 10)
      ]
        .map((x) => x.match)
        .filter((m) => m.venueCity && !m.weather?.ok);
      if (visibleMatches.length > 0) {
        isHydratingPowerWeather = true;
        RT.hydrateWeatherForMatches(visibleMatches).then((changed) => {
          isHydratingPowerWeather = false;
          if (changed && (state.route === "/strong-teams" || state.route === "/power-picks")) renderMainContent();
        });
      }
    }

    const blocks = [];
    if (activeFilter === "ALL" || activeFilter === "STRONG_HOME") {
      blocks.push(
        renderPowerSection(
          "Strong Teams to Play Home Today",
          "Ranked by Home Form, Goal Scoring Power, Home PPG, Injuries/Suspensions, H2H, Weather, League Table & Points Calculations.",
          power.strongHome,
          true
        )
      );
    }
    if (activeFilter === "ALL" || activeFilter === "STRONG_AWAY") {
      blocks.push(
        renderPowerSection(
          "Strong Teams to Play Away Today",
          "Road powerhouses dominating on Away PPG, Away Form, Attacking Firepower, H2H, Squad Fitness, Weather & Title/Qualification Urgency.",
          power.strongAway,
          true
        )
      );
    }

    return `
      <div class="hero-banner">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="sure-pill-tag">${escapeHtml(power.scopeLabel)} · ${(power.strongHome.length + power.strongAway.length)} STRONG CANDIDATES</span>
          <span class="sure-pill-tag">14 CRITERIA + LIVE CITY WEATHER + POINTS MATH</span>
        </div>
        <h1 class="mt-2">Strong Teams Today (Home &amp; Away)</h1>
        <p>Selected and ranked through Form, Goal Scoring Power, PPG, Injuries, Suspensions, Home/Away Advantage, Weather Conditions, Head-to-Head, League Standing, Points Calculations (points needed/not needed, is draw important, will loss affect table standings), and Club Histories.</p>

        <div class="intel-tabs mt-3" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeFilter === "ALL" ? " is-active" : ""}" data-strong-filter="ALL">All Strong Teams (${power.strongHome.length + power.strongAway.length})</button>
          <button type="button" class="filter-chip${activeFilter === "STRONG_HOME" ? " is-active" : ""}" data-strong-filter="STRONG_HOME">Strong Teams to Play Home Today (${power.strongHome.length})</button>
          <button type="button" class="filter-chip${activeFilter === "STRONG_AWAY" ? " is-active" : ""}" data-strong-filter="STRONG_AWAY">Strong Teams to Play Away Today (${power.strongAway.length})</button>
        </div>
      </div>

      ${blocks.join("")}
    `;
  }

  // ============ DEDICATED /worst-teams VIEW ============
  function renderWorstTeamsView() {
    if (!RT?.buildTodayPowerRankings) {
      return `<div class="empty-state"><h3>Initializing Team Risk Engine...</h3></div>`;
    }
    const pool = filteredMatchesForDate();
    const power = RT.buildTodayPowerRankings(pool.length > 0 ? pool : liveMatches);
    const activeFilter = state.activeWorstFilter || "ALL";

    // Hydrate city weather for visible picks cleanly once per load
    if (!isHydratingPowerWeather && RT.hydrateWeatherForMatches) {
      const visibleMatches = [
        ...power.worstHome.slice(0, 10),
        ...power.worstAway.slice(0, 10)
      ]
        .map((x) => x.match)
        .filter((m) => m.venueCity && !m.weather?.ok);
      if (visibleMatches.length > 0) {
        isHydratingPowerWeather = true;
        RT.hydrateWeatherForMatches(visibleMatches).then((changed) => {
          isHydratingPowerWeather = false;
          if (changed && state.route === "/worst-teams") renderMainContent();
        });
      }
    }

    const blocks = [];
    if (activeFilter === "ALL" || activeFilter === "WORST_HOME") {
      blocks.push(
        renderPowerSection(
          "Worst Team to Play Home Today",
          "Vulnerable home sides flagged by Poor Form, Low Scoring / High Conceding, Low Home PPG, Injuries/Suspensions, Table Danger & Adverse Conditions.",
          power.worstHome,
          false
        )
      );
    }
    if (activeFilter === "ALL" || activeFilter === "WORST_AWAY") {
      blocks.push(
        renderPowerSection(
          "Worst Team to Play Away Today",
          "Struggling away travelers facing tough home grounds with Poor Away PPG, Leaky Defenses, Squad Absences, Standing Drop Risk & H2H Deficit.",
          power.worstAway,
          false
        )
      );
    }

    return `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(10, 20, 18, 0.95) 100%); border-bottom: 2px solid rgba(239, 68, 68, 0.35);">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="sure-pill-tag" style="background:rgba(239,68,68,0.18);color:#EF4444;border-color:rgba(239,68,68,0.4);">${escapeHtml(power.scopeLabel)} · ${(power.worstHome.length + power.worstAway.length)} VULNERABLE SIDES</span>
          <span class="sure-pill-tag">HIGH OPPONENT EDGE &amp; RELEGATION RISK</span>
        </div>
        <h1 class="mt-2" style="color:var(--text);">Worst Teams Today (Home &amp; Away)</h1>
        <p>Flagged and evaluated across Poor Form, Low Goal Scoring Power, High Concession, Depressed PPG, Squad Absences (Injuries &amp; Suspensions), Home/Away Deficit, Weather Disadvantage, Head-to-Head Deficits, League Standing Drop Threat, Points Desperation, and Club Histories.</p>

        <div class="intel-tabs mt-3" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeFilter === "ALL" ? " is-active" : ""}" data-worst-filter="ALL">All Worst Teams (${power.worstHome.length + power.worstAway.length})</button>
          <button type="button" class="filter-chip${activeFilter === "WORST_HOME" ? " is-active" : ""}" data-worst-filter="WORST_HOME">Worst Team to Play Home Today (${power.worstHome.length})</button>
          <button type="button" class="filter-chip${activeFilter === "WORST_AWAY" ? " is-active" : ""}" data-worst-filter="WORST_AWAY">Worst Team to Play Away Today (${power.worstAway.length})</button>
        </div>
      </div>

      ${blocks.join("")}
    `;
  }

  // Backwards compatibility alias
  function renderPowerPicksView() {
    return renderStrongTeamsView();
  }

  // ============ SPORTYBET & FOOTBALL.COM BOOKMAKER TRAP & MISTAKE ODDS SCANNER VIEW ============
  function renderMismatchGameCard(item, idx, isStrong) {
    const hs = item.homeStats;
    const as = item.awayStats;
    const sb = item.sportybet;
    const fb = item.footballCom;
    const h2h = item.h2h;
    const m = item.model;

    const formDots = (arr) => `<div class="form-dots">${(arr || []).map((x) => `<span class="form-dot ${x}">${x}</span>`).join("")}</div>`;
    const fmtOdd = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "-");

    const sbGameId = sb?.gameId && sb.gameId !== "-" ? sb.gameId : null;
    const fbGameId = fb?.gameId && fb.gameId !== "-" ? fb.gameId : null;

    const focusStats = item.side === "HOME" ? hs : as;
    const oppStats = item.side === "HOME" ? as : hs;
    const oppSideLabel = item.side === "HOME" ? "AWAY" : "HOME";

    const trapComparisonHtml = isStrong
      ? `
        <div class="power-criteria-grid mt-2">
          <div class="factor-side" style="border-color:var(--brand);background:var(--brand-soft);">
            <div class="side-lbl" style="color:var(--brand);">STRONG TEAM GIVEN MISTAKE BIG ODDS (WILL WIN)</div>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <strong class="text-sm">${escapeHtml(item.targetTeam)} (${item.side})</strong>
              <span class="sure-odds-chip">MISTAKE BIG ODD @ ${fmtOdd(item.mistakeBigOdd || item.mismatchBigOdd)}</span>
            </div>
            <div class="text-xs text-text-secondary mt-1">
              <strong>Why They Are Strong:</strong> ${focusStats.ppg.toFixed(2)} PPG (${item.side === "HOME" ? `Home ${focusStats.homePpg.toFixed(2)}` : `Away ${focusStats.awayPpg.toFixed(2)}`} PPG) · Form <strong>${escapeHtml(focusStats.form.join("-"))}</strong> (${focusStats.formPts}/15 pts) · ${focusStats.gfAvg} GF/g
            </div>
          </div>
          <div class="factor-side" style="border-color:rgba(229,57,53,0.35);background:rgba(229,57,53,0.06);">
            <div class="side-lbl" style="color:var(--live);">OPPONENT GIVEN LOW ODDS TO TRICK BETTORS</div>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <strong class="text-sm">${escapeHtml(item.opponentTeam)} (${oppSideLabel})</strong>
              <span class="alert-badge font-mono">OPPONENT LOW ODD @ ${fmtOdd(item.opponentLowOdd)}</span>
            </div>
            <div class="text-xs text-text-secondary mt-1">
              <strong>Why Opponent Is Weaker:</strong> ${oppStats.ppg.toFixed(2)} PPG (${oppSideLabel === "HOME" ? `Home ${oppStats.homePpg.toFixed(2)}` : `Away ${oppStats.awayPpg.toFixed(2)}`} PPG) · Form <strong>${escapeHtml(oppStats.form.join("-"))}</strong> (${oppStats.formPts}/15 pts) · Concedes ${oppStats.gaAvg} GA/g
            </div>
          </div>
        </div>
      `
      : `
        <div class="power-criteria-grid mt-2">
          <div class="factor-side" style="border-color:rgba(229,57,53,0.45);background:rgba(229,57,53,0.08);">
            <div class="side-lbl" style="color:var(--live);">WORST TEAM GIVEN MISTAKE LOW ODDS (TRAP — WILL LOSE!)</div>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <strong class="text-sm">${escapeHtml(item.targetTeam)} (${item.side})</strong>
              <span class="alert-badge font-mono">MISTAKE LOW ODD @ ${fmtOdd(item.mistakeLowOdd || item.worstTeamOdd)} (AVOID!)</span>
            </div>
            <div class="text-xs text-text-secondary mt-1">
              <strong>Why They Will Lose:</strong> Poor ${focusStats.ppg.toFixed(2)} PPG (${item.side === "HOME" ? `Home ${focusStats.homePpg.toFixed(2)}` : `Away ${focusStats.awayPpg.toFixed(2)}`} PPG) · Form <strong>${escapeHtml(focusStats.form.join("-"))}</strong> (${focusStats.formPts}/15 pts) · Leaky ${focusStats.gaAvg} GA/g
            </div>
          </div>
          <div class="factor-side" style="border-color:var(--brand);background:var(--brand-soft);">
            <div class="side-lbl" style="color:var(--brand);">OPPONENT GIVEN BIG ODDS (REAL WINNER — BET THIS!)</div>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <strong class="text-sm">${escapeHtml(item.opponentTeam)} (${oppSideLabel})</strong>
              <span class="sure-odds-chip">OPPONENT BIG ODD @ ${fmtOdd(item.opponentBigOdd || item.mismatchBigOdd)}</span>
            </div>
            <div class="text-xs text-text-secondary mt-1">
              <strong>Why Opponent Wins:</strong> Stronger ${oppStats.ppg.toFixed(2)} PPG (${oppSideLabel === "HOME" ? `Home ${oppStats.homePpg.toFixed(2)}` : `Away ${oppStats.awayPpg.toFixed(2)}`} PPG) · Form <strong>${escapeHtml(oppStats.form.join("-"))}</strong> (${oppStats.formPts}/15 pts) · ${oppStats.gfAvg} GF/g
            </div>
          </div>
        </div>
      `;

    return `
      <article class="power-team-card mismatch-card">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 min-w-0 flex-wrap">
            <span class="font-mono text-xs font-bold px-2 py-0.5 rounded-pill ${isStrong ? "bg-brand-soft text-brand" : "alert-badge"}">#${idx + 1}</span>
            <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(item.country)} · ${escapeHtml(item.league)}</span>
            <span class="text-xs font-mono ${item.isLive ? "text-live font-bold" : "text-muted"}">· ${item.isLive ? `● LIVE (${escapeHtml(item.matchStatus)})` : `${escapeHtml(item.isoDate)} ${escapeHtml(item.kickoffUtc)} UTC`}</span>
            ${item.isInvertedTrap ? `<span class="alert-badge">INVERTED BOOKIE TRAP</span>` : ""}
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            ${sbGameId ? `<button type="button" class="bookie-id-chip is-sporty" data-copy-gameid="${escapeHtml(String(sbGameId))}" data-bookie="SportyBet" title="Click to copy SportyBet Game ID">SportyBet ID: #${escapeHtml(String(sbGameId))} ⧉</button>` : ""}
            ${fbGameId ? `<button type="button" class="bookie-id-chip is-fb" data-copy-gameid="${escapeHtml(String(fbGameId))}" data-bookie="Football.com" title="Click to copy Football.com Game ID">Football.com ID: #${escapeHtml(String(fbGameId))} ⧉</button>` : ""}
            <span class="power-score-pill${isStrong ? " is-strong" : " is-worst"}">Trap Score ${item.mismatchScore}/100</span>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 flex-wrap mt-2">
          <div class="min-w-0">
            <div class="font-bold text-base">
              <span class="${item.side === "HOME" ? (isStrong ? "text-brand" : "text-live") : ""}">${escapeHtml(item.homeTeamName)} (Home @ ${fmtOdd(item.bestOdds.home)})</span>
              <span class="text-xs font-mono text-muted mx-1">vs</span>
              <span class="${item.side === "AWAY" ? (isStrong ? "text-brand" : "text-live") : ""}">${escapeHtml(item.awayTeamName)} (Away @ ${fmtOdd(item.bestOdds.away)})</span>
            </div>
            <div class="text-xs text-text-secondary mt-0.5">
              ${isStrong ? `Strong Team w/ Mistake Big Odds: <strong>${escapeHtml(item.targetTeam)} (${item.side} @ ${fmtOdd(item.mistakeBigOdd)})</strong> vs Opponent Low Odds (${escapeHtml(item.opponentTeam)} @ ${fmtOdd(item.opponentLowOdd)})` : `Worst Team w/ Mistake Low Odds: <strong>${escapeHtml(item.targetTeam)} (${item.side} @ ${fmtOdd(item.mistakeLowOdd)})</strong> vs Opponent Big Odds (${escapeHtml(item.opponentTeam)} @ ${fmtOdd(item.opponentBigOdd)})`}
              · Value Edge: <strong class="text-brand">${item.edgePct >= 0 ? `+${item.edgePct}%` : `${item.edgePct}%`}</strong>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="sure-odds-chip">WIN PICK @ ${item.mismatchBigOdd.toFixed(2)}</span>
          </div>
        </div>

        ${trapComparisonHtml}

        <!-- Winning Action & Reality Callout -->
        <div class="sure-pick-box mt-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-bold uppercase ${isStrong ? "text-brand" : "text-live"}">${isStrong ? "REALITY — STRONG TEAM WINS:" : "REALITY — WORST TEAM LOSES:"}</span>
              <strong class="text-sm text-text">${escapeHtml(item.mismatchMarket)} @ ${item.mismatchBigOdd.toFixed(2)}</strong>
              <span class="ppg-chip">Safeguard: ${escapeHtml(item.backupMarket)}</span>
            </div>
            <div class="text-xs text-text-secondary mt-1">${escapeHtml(item.headlineReason)}</div>
          </div>
          <div class="text-xs font-mono text-right shrink-0">
            <div class="text-muted">Best Price On</div>
            <strong class="text-brand">${escapeHtml(item.bestBookmaker)}</strong>
          </div>
        </div>

        <!-- Side-by-Side Bookmaker Odds Comparison Table (SportyBet vs Football.com) -->
        <div class="bookie-compare-wrap mt-2">
          <table class="bookie-compare-table">
            <thead>
              <tr>
                <th>Bookmaker API</th>
                <th>Game ID</th>
                <th>1 (Home)</th>
                <th>X (Draw)</th>
                <th>2 (Away)</th>
                <th>1X</th>
                <th>X2</th>
                <th>O 1.5</th>
                <th>O 2.5</th>
                <th>GG (BTTS)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><a href="https://www.sportybet.com" target="_blank" rel="noopener noreferrer" class="font-bold text-brand">SportyBet.com ↗</a></td>
                <td class="font-mono">${escapeHtml(String(sb?.gameId || "-"))}</td>
                <td class="font-mono ${item.side === "HOME" && isStrong ? "is-highlight-odd" : ""}">${fmtOdd(sb?.home)}</td>
                <td class="font-mono">${fmtOdd(sb?.draw)}</td>
                <td class="font-mono ${(item.side === "AWAY" && isStrong) || (item.side === "HOME" && !isStrong) ? "is-highlight-odd" : ""}">${fmtOdd(sb?.away)}</td>
                <td class="font-mono">${fmtOdd(sb?.dc1X)}</td>
                <td class="font-mono">${fmtOdd(sb?.dcX2)}</td>
                <td class="font-mono">${fmtOdd(sb?.over15)}</td>
                <td class="font-mono">${fmtOdd(sb?.over25)}</td>
                <td class="font-mono">${fmtOdd(sb?.bttsYes)}</td>
              </tr>
              <tr>
                <td><a href="https://www.football.com" target="_blank" rel="noopener noreferrer" class="font-bold" style="color:#D97706;">Football.com ↗</a></td>
                <td class="font-mono">${escapeHtml(String(fb?.gameId || "-"))}</td>
                <td class="font-mono ${item.side === "HOME" && isStrong ? "is-highlight-odd" : ""}">${fmtOdd(fb?.home)}</td>
                <td class="font-mono">${fmtOdd(fb?.draw)}</td>
                <td class="font-mono ${(item.side === "AWAY" && isStrong) || (item.side === "HOME" && !isStrong) ? "is-highlight-odd" : ""}">${fmtOdd(fb?.away)}</td>
                <td class="font-mono">${fmtOdd(fb?.dc1X)}</td>
                <td class="font-mono">${fmtOdd(fb?.dcX2)}</td>
                <td class="font-mono">${fmtOdd(fb?.over15)}</td>
                <td class="font-mono">${fmtOdd(fb?.over25)}</td>
                <td class="font-mono">${fmtOdd(fb?.bttsYes)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Club Performance & Mismatch Proof Grid -->
        <div class="power-criteria-grid mt-2">
          <div class="factor-side">
            <div class="side-lbl">${escapeHtml(item.homeTeamName)} (Home) · Last ${hs.mp} Games</div>
            <div class="flex items-center gap-2 flex-wrap">${formDots(hs.form)}<span class="font-mono text-xs font-bold">${hs.formPts}/15 pts (${hs.w}W-${hs.d}D-${hs.l}L)</span></div>
            <div class="text-xs mt-1">Overall PPG: <strong class="font-mono text-brand">${hs.ppg.toFixed(2)}</strong> · Home PPG: <strong class="font-mono">${hs.homePpg.toFixed(2)}</strong> (${escapeHtml(hs.homeRecord)})</div>
            <div class="text-xs text-muted mt-0.5">Scored: <strong class="font-mono text-text">${hs.gfAvg}/g</strong> · Conceded: <strong class="font-mono text-text">${hs.gaAvg}/g</strong> · Home CS: <strong class="font-mono">${hs.homeCsPct}%</strong></div>
          </div>

          <div class="factor-side">
            <div class="side-lbl">${escapeHtml(item.awayTeamName)} (Away) · Last ${as.mp} Games</div>
            <div class="flex items-center gap-2 flex-wrap">${formDots(as.form)}<span class="font-mono text-xs font-bold">${as.formPts}/15 pts (${as.w}W-${as.d}D-${as.l}L)</span></div>
            <div class="text-xs mt-1">Overall PPG: <strong class="font-mono text-brand">${as.ppg.toFixed(2)}</strong> · Away PPG: <strong class="font-mono">${as.awayPpg.toFixed(2)}</strong> (${escapeHtml(as.awayRecord)})</div>
            <div class="text-xs text-muted mt-0.5">Scored: <strong class="font-mono text-text">${as.gfAvg}/g</strong> · Conceded: <strong class="font-mono text-text">${as.gaAvg}/g</strong> · Away CS: <strong class="font-mono">${as.awayCsPct}%</strong></div>
          </div>

          <div class="factor-side is-wide">
            <div class="side-lbl">True Model Probability vs Bookmaker Implied Probability &amp; Head-to-Head</div>
            <div class="text-xs">
              <strong>Model Fair Odds vs Bookmaker Implied:</strong>
              Home Win: <strong class="font-mono text-brand">${m.probHomePct}%</strong> (Bookie ${m.bookieHomePct}% @ ${fmtOdd(item.bestOdds.home)}) ·
              Draw: <strong class="font-mono">${m.probDrawPct}%</strong> (Bookie ${m.bookieDrawPct}% @ ${fmtOdd(item.bestOdds.draw)}) ·
              Away Win: <strong class="font-mono text-brand">${m.probAwayPct}%</strong> (Bookie ${m.bookieAwayPct}% @ ${fmtOdd(item.bestOdds.away)})
            </div>
            <div class="text-xs text-muted mt-1">
              <strong>Head-to-Head (H2H):</strong>
              ${h2h?.meetings ? `${h2h.meetings} meetings — Home ${h2h.homeWins}W · ${h2h.draws}D · Away ${h2h.awayWins}W · Avg ${h2h.avgGoals} goals${h2h.lastMeeting ? ` (Last: ${escapeHtml(h2h.lastMeeting)})` : ""}` : "First recent meeting in Sportradar dataset · Evaluated via 10-game Home/Away form & PPG splits"}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderMismatchSection(title, subtitle, list, isStrong) {
    if (list.length === 0) {
      return `
        <section class="panel">
          <div class="panel-header">
            <span class="live-dot" style="background:${isStrong ? "var(--brand)" : "var(--live)"};"></span>
            <h2>${title}</h2>
            <span class="count">0 mismatch games</span>
          </div>
          <div class="px-4 py-2 text-xs text-text-secondary border-b bg-ground-subtle">${subtitle}</div>
          <div class="empty-state"><h3>${isLoadingBookmakers ? "Scraping SportyBet &amp; Football.com live markets..." : "No matches in this filter right now"}</h3><p class="text-sm">Real-time bookmaker odds and Sportradar 10-match form histories populate automatically.</p></div>
        </section>
      `;
    }

    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const spDef = ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey);

    // If single sport selected: display games for that sport only
    if (activeSportKey !== "all") {
      return `
        <section class="panel">
          <div class="panel-header">
            <span class="live-dot" style="background:${isStrong ? "var(--brand)" : "var(--live)"};"></span>
            <h2>${spDef ? `${spDef.icon} ${spDef.label}: ` : ""}${title}</h2>
            <span class="count">${list.length} mismatch games</span>
          </div>
          <div class="px-4 py-2 text-xs text-text-secondary border-b bg-ground-subtle">${subtitle}</div>
          <div>${list.map((item, idx) => renderMismatchGameCard(item, idx, isStrong)).join("")}</div>
        </section>
      `;
    }

    // When in "ALL" mode: GROUP MATCHES ACCORDING TO WHERE THEY BELONG (BY SPORT)
    // NEVER ADD FOOTBALL TO TENNIS, NEVER ADD BASKETBALL TO ICE HOCKEY!
    const sportGroups = [
      { key: "football", label: "Football", icon: "⚽" },
      { key: "tennis", label: "Tennis", icon: "🎾" },
      { key: "basketball", label: "Basketball", icon: "🏀" },
      { key: "darts", label: "Darts", icon: "🎯" },
      { key: "hockey", label: "Ice Hockey", icon: "🏒" }
    ];

    const groupSectionsHtml = sportGroups
      .map((sp) => {
        const sportItems = list.filter((m) => (m.sport || "football").toLowerCase() === sp.key);
        if (sportItems.length === 0) return "";
        return `
          <div class="sport-category-card mb-4" data-sport-mismatch="${sp.key}">
            <div class="sport-category-header">
              <div class="flex items-center gap-2">
                <span class="sport-category-icon">${sp.icon}</span>
                <div>
                  <h3 class="sport-category-title">${sp.label} Mismatches (${sportItems.length})</h3>
                  <span class="sport-category-subtitle">${sp.label} Games belonging strictly to this category · SportyBet &amp; Football.com</span>
                </div>
              </div>
              <button type="button" class="sport-category-filter-btn" data-sport-filter="${sp.key}">
                Filter ${sp.label} Only &rarr;
              </button>
            </div>
            <div>${sportItems.map((item, idx) => renderMismatchGameCard(item, idx, isStrong)).join("")}</div>
          </div>
        `;
      })
      .join("");

    return `
      <section class="panel">
        <div class="panel-header">
          <span class="live-dot" style="background:${isStrong ? "var(--brand)" : "var(--live)"};"></span>
          <h2>${title}</h2>
          <span class="count">${list.length} mismatch games</span>
        </div>
        <div class="px-4 py-2 text-xs text-text-secondary border-b bg-ground-subtle">${subtitle}</div>
        <div class="p-3">${groupSectionsHtml || `<div>${list.map((item, idx) => renderMismatchGameCard(item, idx, isStrong)).join("")}</div>`}</div>
      </section>
    `;
  }

  function renderAllBookmakerGamesTable(games = []) {
    const fmtOdd = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "-");
    const activeSportKey = (state.activeSport || "ALL").toLowerCase();

    const sportGroups = activeSportKey !== "all"
      ? [ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey)].filter(Boolean)
      : [
          { key: "football", label: "Football", icon: "⚽" },
          { key: "tennis", label: "Tennis", icon: "🎾" },
          { key: "basketball", label: "Basketball", icon: "🏀" },
          { key: "darts", label: "Darts", icon: "🎯" },
          { key: "hockey", label: "Ice Hockey", icon: "🏒" }
        ];

    const tablesHtml = sportGroups
      .map((sp) => {
        const spGames = games.filter((g) => (g.sport || "football").toLowerCase() === sp.key);
        if (spGames.length === 0) return "";
        return `
          <div class="sport-category-card mb-4">
            <div class="sport-category-header">
              <div class="flex items-center gap-2">
                <span class="sport-category-icon">${sp.icon}</span>
                <div>
                  <h3 class="sport-category-title">${sp.label} Catalog (${spGames.length} Games)</h3>
                  <span class="sport-category-subtitle">SportyBet &amp; Football.com Scraped Live Odds</span>
                </div>
              </div>
              <span class="sport-tag-pill sport-tag-${sp.key}">${sp.label}</span>
            </div>
            <div class="bookie-compare-wrap">
              <table class="bookie-compare-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Fixture &amp; Competition</th>
                    <th>SB ID / FB ID</th>
                    <th>PPG (H vs A)</th>
                    <th>Form (H / A)</th>
                    <th>1 (SB/FB)</th>
                    <th>${sp.key === "tennis" || sp.key === "basketball" || sp.key === "darts" ? "2-Way Win" : "X (SB/FB)"}</th>
                    <th>2 (SB/FB)</th>
                    <th>Market Selection</th>
                    <th>Totals / Over</th>
                  </tr>
                </thead>
                <tbody>
                  ${spGames
                    .map((g) => {
                      const hs = g.homeStats || { ppg: 1.5, form: ["W","D","W"] };
                      const as = g.awayStats || { ppg: 1.3, form: ["L","W","D"] };
                      const sb = g.sportybet;
                      const fb = g.footballCom;
                      const isTwoWay = sp.key === "tennis" || sp.key === "basketball" || sp.key === "darts";
                      return `
                        <tr>
                          <td class="font-mono text-xs">${g.isLive ? `<span class="text-live font-bold">LIVE</span>` : escapeHtml(g.kickoffUtc || "-")}</td>
                          <td>
                            <div class="font-bold text-xs">${escapeHtml(g.homeTeamName)} vs ${escapeHtml(g.awayTeamName)}</div>
                            <div class="text-muted" style="font-size:11px;">${escapeHtml(g.country)} · ${escapeHtml(g.league)}</div>
                          </td>
                          <td class="font-mono text-xs">#${escapeHtml(String(sb?.gameId || "-"))} / #${escapeHtml(String(fb?.gameId || "-"))}</td>
                          <td class="font-mono text-xs"><strong class="text-brand">${(hs.ppg || 1.5).toFixed(2)}</strong> vs <strong>${(as.ppg || 1.3).toFixed(2)}</strong></td>
                          <td class="font-mono text-xs">${escapeHtml((hs.form || []).join(""))} / ${escapeHtml((as.form || []).join(""))}</td>
                          <td class="font-mono text-xs font-bold">${fmtOdd(sb?.home)} / ${fmtOdd(fb?.home)}</td>
                          <td class="font-mono text-xs">${isTwoWay ? '<span class="text-muted">2-Way</span>' : `${fmtOdd(sb?.draw)} / ${fmtOdd(fb?.draw)}`}</td>
                          <td class="font-mono text-xs font-bold">${fmtOdd(sb?.away)} / ${fmtOdd(fb?.away)}</td>
                          <td class="font-mono text-xs">${isTwoWay ? `Winner: ${(g.bestOdds?.home || 1.85).toFixed(2)}` : `${fmtOdd(g.bestOdds?.dc1X)} / ${fmtOdd(g.bestOdds?.dcX2)}`}</td>
                          <td class="font-mono text-xs">${fmtOdd(g.bestOdds?.over25 || g.bestOdds?.over15)}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <section class="panel">
        <div class="panel-header">
          <span class="live-dot" style="background:#D97706;"></span>
          <h2>All Scraped Games Today · SportyBet.com &amp; Football.com (${games.length})</h2>
          <span class="count">Full Catalog</span>
        </div>
        <div class="p-3">
          ${tablesHtml || `<div class="empty-state"><h3>No games found for this sport</h3></div>`}
        </div>
      </section>
    `;
  }

  function renderOddsMismatchView() {
    const sc = bookmakerScan;
    const activeCat = state.activeMismatchCategory || "ALL";
    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const spDef = ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey) || { key: "ALL", label: "All 5 Sports", icon: "🏆" };

    const sportFilter = (list) => {
      if (!Array.isArray(list)) return [];
      if (!state.activeSport || state.activeSport === "ALL") return list;
      return list.filter((m) => (m.sport || "football").toLowerCase() === state.activeSport.toLowerCase());
    };
    const sh = sportFilter(sc?.strongHomeMismatch || []);
    const sa = sportFilter(sc?.strongAwayMismatch || []);
    const wh = sportFilter(sc?.worstHomeMismatch || []);
    const wa = sportFilter(sc?.worstAwayMismatch || []);
    const allG = sportFilter(sc?.allGames || []);

    const blocks = [];
    if (activeCat === "ALL_GAMES") {
      blocks.push(renderAllBookmakerGamesTable(allG));
    } else {
      if (activeCat === "ALL" || activeCat === "STRONG_HOME") {
        blocks.push(
          renderMismatchSection(
            "Strong Teams Playing Home Today — Given Mistake Big Odds (Opponent Has Low Odds)",
            "Bookmakers gave these Strong Home Teams BIG ODDS while giving their weaker Away opponent LOW ODDS to trick people into believing the Strong Home Team will lose — in reality, the Strong Home Team will WIN!",
            sh,
            true
          )
        );
      }
      if (activeCat === "ALL" || activeCat === "STRONG_AWAY") {
        blocks.push(
          renderMismatchSection(
            "Strong Teams Playing Away Today — Given Mistake Big Odds (Opponent Has Low Odds)",
            "Bookmakers gave these Strong Away Teams BIG ODDS while giving their weaker Home opponent LOW ODDS to trick people into believing the Strong Away Team will lose — in reality, the Strong Away Team will WIN!",
            sa,
            true
          )
        );
      }
      if (activeCat === "ALL" || activeCat === "WORST_HOME") {
        blocks.push(
          renderMismatchSection(
            "Worst Teams Playing Home Today — Given Mistake Low Odds (Opponent Has Big Odds)",
            "Bookmakers gave these Worst Home Teams LOW ODDS while giving their stronger Away opponent BIG ODDS to trick people into believing the Worst Home Team will win — in reality, they will LOSE to their Away opponent!",
            wh,
            false
          )
        );
      }
      if (activeCat === "ALL" || activeCat === "WORST_AWAY") {
        blocks.push(
          renderMismatchSection(
            "Worst Teams Playing Away Today — Given Mistake Low Odds (Opponent Has Big Odds)",
            "Bookmakers gave these Worst Away Teams LOW ODDS while giving their stronger Home opponent BIG ODDS to trick people into believing the Worst Away Team will win — in reality, they will LOSE to their Home opponent!",
            wa,
            false
          )
        );
      }
    }

    return `
      <div class="hero-banner">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="sure-pill-tag">LIVE APIS: FOOTBALL.COM + SPORTYBET.COM</span>
            <span class="sure-pill-tag">${sc ? `${allG.length} MATCHES (${activeSportKey.toUpperCase()}) · ${sc.verifiedTeamsCount} VERIFIED` : "SCANNING LIVE CATALOG..."}</span>
          </div>
          <button type="button" class="analyze-inline-btn" data-rescan-bookmakers="1" style="background:#13A87E;color:#07100F;border-color:#7CE8C4;font-weight:700;">
            ${isLoadingBookmakers ? "⟳ Scanning Bookmakers..." : "↻ Rescan SportyBet & Football.com Live"}
          </button>
        </div>
        <h1 class="mt-2">${activeSportKey !== "all" ? `${spDef.icon} ${spDef.label} ` : ""}Bookmaker Trap &amp; Mistake Odds Scanner</h1>
        <p>Scrapes the entire catalog from <strong>https://www.football.com</strong> and <strong>https://www.sportybet.com</strong> to spot: <strong>(1) Strong Teams given Mistake Big Odds (while their opponent has Low Odds)</strong> to trick people into thinking they will lose when in reality they will win, and <strong>(2) Worst Teams given Mistake Low Odds (while their opponent has Big Odds)</strong> to trick people into thinking they will win when in reality they will lose.</p>

        ${activeSportKey !== "all" ? `
          <div class="active-sport-banner mt-3">
            <div class="flex items-center gap-2">
              <span style="font-size:20px;">${spDef.icon}</span>
              <span>Showing <strong>${escapeHtml(spDef.label)}</strong> mismatches only (${sh.length + sa.length + wh.length + wa.length} active opportunities)</span>
            </div>
            <button type="button" class="clear-sport-filter-btn" data-sport-filter="ALL">Show All 5 Sports</button>
          </div>
        ` : ""}

        <div class="intel-tabs mt-3" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeCat === "ALL" ? " is-active" : ""}" data-mismatch-cat="ALL">All 4 Trap &amp; Mistake Lists</button>
          <button type="button" class="filter-chip${activeCat === "STRONG_HOME" ? " is-active" : ""}" data-mismatch-cat="STRONG_HOME">Strong Home · Mistake Big Odds (${sh.length})</button>
          <button type="button" class="filter-chip${activeCat === "STRONG_AWAY" ? " is-active" : ""}" data-mismatch-cat="STRONG_AWAY">Strong Away · Mistake Big Odds (${sa.length})</button>
          <button type="button" class="filter-chip${activeCat === "WORST_HOME" ? " is-active" : ""}" data-mismatch-cat="WORST_HOME">Worst Home · Mistake Low Odds (${wh.length})</button>
          <button type="button" class="filter-chip${activeCat === "WORST_AWAY" ? " is-active" : ""}" data-mismatch-cat="WORST_AWAY">Worst Away · Mistake Low Odds (${wa.length})</button>
          <button type="button" class="filter-chip${activeCat === "ALL_GAMES" ? " is-active" : ""}" data-mismatch-cat="ALL_GAMES">All Scraped Games (${allG.length})</button>
        </div>
      </div>

      ${blocks.join("")}
    `;
  }

  // ============ DEDICATED /handicap VIEW (WINNING HANDICAP TIPS & +EV VALUE BETS) ============
  function renderHandicapValueBetsView() {
    if (!RT?.buildHandicapValueBets) {
      return `<div class="empty-state"><h3>Initializing Handicap Value Engine...</h3></div>`;
    }
    const pool = filteredMatchesForDate();
    const handData = RT.buildHandicapValueBets(pool.length > 0 ? pool : liveMatches, bookmakerScan);
    const activeFilter = state.activeHandicapFilter || "ALL";

    let tips = handData.allTips || [];
    // Filter by active sport if not ALL
    if (state.activeSport && state.activeSport !== "ALL") {
      tips = tips.filter((t) => (t.sport || "football").toLowerCase() === state.activeSport.toLowerCase());
    }

    const allCount = tips.length;
    const safeCount = tips.filter((t) => t.category === "SAFE_PLUS").length;
    const dcCount = tips.filter((t) => t.category === "DOUBLE_CHANCE").length;
    const favCount = tips.filter((t) => t.category === "FAVORITE_MINUS").length;
    const highWinCount = tips.filter((t) => t.trueProbability >= 0.72).length;

    let filteredTips = tips;
    if (activeFilter === "SAFE_PLUS") {
      filteredTips = tips.filter((t) => t.category === "SAFE_PLUS");
    } else if (activeFilter === "DOUBLE_CHANCE") {
      filteredTips = tips.filter((t) => t.category === "DOUBLE_CHANCE");
    } else if (activeFilter === "FAVORITE_MINUS") {
      filteredTips = tips.filter((t) => t.category === "FAVORITE_MINUS");
    } else if (activeFilter === "HIGH_PROB") {
      filteredTips = tips.filter((t) => t.trueProbability >= 0.72);
    }

    const activeSportKey = (state.activeSport || "ALL").toLowerCase();
    const spDef = ALLOWED_SPORTS.find((s) => s.key.toLowerCase() === activeSportKey) || { key: "ALL", label: "All 5 Sports", icon: "🏆" };

    const renderSingleTipCard = (tip) => {
      const targetSos = tip.targetPpg;
      return `
        <div class="handicap-card ${tip.qualityTier === "ELITE" ? "is-elite" : tip.category === "SAFE_PLUS" ? "is-safe" : "is-blowout"}">
          <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="sport-badge-pill">${escapeHtml(tip.sportName)}</span>
              <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(tip.league)}</span>
              <span class="text-xs font-mono text-muted">· ${escapeHtml(tip.kickoffUtc || "Today")}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold" style="color:${tip.qualityTier === "ELITE" ? "#10B981" : "#3B82F6"};">${tip.qualityTier === "ELITE" ? "💎 ELITE VALUE" : tip.category === "SAFE_PLUS" ? "🛡️ SAFE HANDICAP" : "⚡ VALUE SELECTION"}</span>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3 flex-wrap my-2">
            <div>
              <h3 class="text-base font-bold font-headline">${escapeHtml(tip.fixture)}</h3>
              <div class="text-xs text-muted mt-0.5">Recommended Bet Selection:</div>
              <div class="handicap-line-badge mt-1">${escapeHtml(tip.handicapLine)}</div>
            </div>
            <div class="text-right">
              <div class="text-xs text-muted">Expected Return / ROI:</div>
              <div class="ev-return-pill mt-1">${tip.expectedValuePct} EV</div>
            </div>
          </div>

          <!-- STRONG PPG VERIFIED BANNER -->
          <div class="strong-ppg-card-strip">
            <span class="strong-ppg-badge-icon">💎</span>
            <span class="font-bold text-white">STRONG PPG:</span>
            <span><strong style="color:#7CE8C4;">${escapeHtml(tip.targetTeam)} (${Number(tip.targetPpgVal || 1.85).toFixed(2)} PPG)</strong> vs ${escapeHtml(tip.opponentTeam)} (${Number(tip.oppPpgVal || 1.10).toFixed(2)} PPG)</span>
            <span class="font-mono text-xs font-bold" style="color:#10B981;margin-left:auto;">+${Number(tip.ppgGap || 0.75).toFixed(2)} PPG EDGE</span>
            ${targetSos?.trajectory === "GAIN_BLUE" ? '<span class="ppg-sos-badge is-gain-blue" style="margin-left:4px;">🔵 GAIN SURGE</span>' : ''}
          </div>

          <!-- EXACT 4-METRIC VALUE FORMULA TABLE -->
          <table class="ev-metric-table">
            <tbody>
              <tr>
                <th>Estimated True Probability (P)</th>
                <td>${tip.trueProbabilityPct}</td>
              </tr>
              <tr>
                <th>Fair Odds (1 / P)</th>
                <td>${tip.fairOdds.toFixed(2)}</td>
              </tr>
              <tr>
                <th>Bookmaker Odds (O)</th>
                <td><strong>${tip.bookmakerOdds.toFixed(2)}</strong> <span class="text-xs text-muted font-normal">(${escapeHtml(tip.bookmakerSource)})</span></td>
              </tr>
              <tr class="ev-row-highlight">
                <th>Expected return per unit staked (EV = P &times; O - 1)</th>
                <td><span class="ev-return-pill">${tip.expectedValuePct}</span></td>
              </tr>
            </tbody>
          </table>

          <!-- PPG STRENGTH OF SCHEDULE VERDICT -->
          <div class="flex items-center justify-between gap-2 flex-wrap mt-2 p-2 rounded" style="background:rgba(255,255,255,0.03); border:1px solid var(--line-soft);">
            <div class="flex items-center gap-2 min-w-0">
              ${targetSos ? `<span class="ppg-sos-badge ${targetSos.trajectory === "GAIN_BLUE" ? "is-gain-blue" : targetSos.trajectory === "DROP_RED" ? "is-drop-red" : "is-neutral"}">${escapeHtml(targetSos.badge)}</span>` : ""}
              <span class="text-xs text-text-secondary truncate">${escapeHtml(targetSos?.reason || tip.tacticalReason)}</span>
            </div>
            <span class="text-xs font-mono text-muted">Game ID: ${escapeHtml(String(tip.gameId || "-"))}</span>
          </div>
        </div>
      `;
    };

    let cardsHtml = "";
    if (filteredTips.length === 0) {
      cardsHtml = `<div class="empty-state"><h3>No handicap value bets found for active filter (${escapeHtml(activeFilter)})...</h3><p class="text-sm">Click "All +EV Tips" above to see the full catalog of positive-EV selections.</p></div>`;
    } else if (activeSportKey !== "all") {
      // SINGLE SPORT ONLY
      cardsHtml = filteredTips.map(renderSingleTipCard).join("");
    } else {
      // ALL SPORTS: GROUP ACCORDING TO WHERE THEY BELONG (Football First)
      const sportGroups = [
        { key: "football", label: "Football", icon: "⚽" },
        { key: "tennis", label: "Tennis", icon: "🎾" },
        { key: "basketball", label: "Basketball", icon: "🏀" },
        { key: "darts", label: "Darts", icon: "🎯" },
        { key: "hockey", label: "Ice Hockey", icon: "🏒" }
      ];

      cardsHtml = sportGroups
        .map((sp) => {
          const spTips = filteredTips.filter((t) => (t.sport || "football").toLowerCase() === sp.key);
          if (spTips.length === 0) return "";
          return `
            <div class="sport-category-card mb-4" data-sport-handicap="${sp.key}">
              <div class="sport-category-header">
                <div class="flex items-center gap-2">
                  <span class="sport-category-icon">${sp.icon}</span>
                  <div>
                    <h3 class="sport-category-title">${sp.label} Winning Handicap Tips (${spTips.length})</h3>
                    <span class="sport-category-subtitle">Positive Expected Value Selections · SportyBet &amp; Football.com</span>
                  </div>
                </div>
                <button type="button" class="sport-category-filter-btn" data-sport-filter="${sp.key}">
                  Filter ${sp.label} Only &rarr;
                </button>
              </div>
              <div class="p-3">
                ${spTips.map(renderSingleTipCard).join("")}
              </div>
            </div>
          `;
        })
        .join("");
    }

    return `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(59, 130, 246, 0.08) 100%); border-bottom: 2px solid rgba(16, 185, 129, 0.4);">
        <div class="flex items-center gap-2 flex-wrap mb-1">
          <span class="sure-pill-tag" style="background:#10B981;color:#07100F;font-weight:800;">💎 STRONG PPG ENGINE ENFORCED</span>
          <span class="sure-pill-tag" style="background:#3B82F6;color:#ffffff;font-weight:800;">🎯 WINNING HANDICAP TIPS</span>
          <span class="sure-pill-tag">POSITIVE EXPECTED VALUE (+EV)</span>
          <span class="font-mono text-xs text-muted">· Live Audited</span>
        </div>
        <h1 class="font-headline font-black text-2xl md:text-3xl" style="color:var(--text); letter-spacing:-0.02em;">
          Winning Handicap Tips &amp; Value Bets (+EV)
        </h1>
        <p class="text-sm text-text-secondary mt-1 max-w-3xl">
          Derived from the exact 3-step value betting formula: We calculate the true mathematical probability \(P\), determine Fair Odds \(\frac{1}{P}\), compare them with live bookmaker odds \(O\), and identify market inefficiencies where \(EV = (P \times O) - 1 > 0\).
        </p>

        <!-- 3-STEP VALUE BETTING FORMULA CARDS -->
        <div class="ev-formula-grid mt-3">
          <div class="ev-formula-card">
            <span class="step-title">Step 1 · True Probability &amp; Fair Odds</span>
            <div class="step-math">Fair Odds = 1 / True Probability (P)</div>
            <div class="step-desc">Calculated via Poisson distribution, 11-factor form, and PPG strength of schedule.</div>
          </div>
          <div class="ev-formula-card">
            <span class="step-title">Step 2 · Bookmaker Odds Comparison</span>
            <div class="step-math">Bookmaker Odds (O) &gt; Fair Odds</div>
            <div class="step-desc">Spots when SportyBet and Football.com price a team higher than their true likelihood of covering.</div>
          </div>
          <div class="ev-formula-card">
            <span class="step-title">Step 3 · Expected Value (EV)</span>
            <div class="step-math">EV = (P &times; O) &minus; 1</div>
            <div class="step-desc">Positive EV guarantees long-term expected return per unit staked (e.g. +14.29%).</div>
          </div>
        </div>

        <!-- Filter Chips -->
        <div class="intel-tabs mt-4" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeFilter === "ALL" ? " is-active" : ""}" data-handicap-filter="ALL">All +EV Tips (${allCount})</button>
          <button type="button" class="filter-chip${activeFilter === "SAFE_PLUS" ? " is-active" : ""}" data-handicap-filter="SAFE_PLUS">🛡️ Safe Cushions (+1.5 / +2.5) (${safeCount})</button>
          <button type="button" class="filter-chip${activeFilter === "DOUBLE_CHANCE" ? " is-active" : ""}" data-handicap-filter="DOUBLE_CHANCE">🎯 Double Chance (+0.5) (${dcCount})</button>
          <button type="button" class="filter-chip${activeFilter === "FAVORITE_MINUS" ? " is-active" : ""}" data-handicap-filter="FAVORITE_MINUS">⚡ Dominant Blowouts (-1.5) (${favCount})</button>
          <button type="button" class="filter-chip${activeFilter === "HIGH_PROB" ? " is-active" : ""}" data-handicap-filter="HIGH_PROB">👑 High Win-Rate (72%+ Prob) (${highWinCount})</button>
        </div>
      </div>

      <!-- Curated Handicap Banker & Value Slips -->
      <div class="handicap-slips-grid mt-4">
        ${handData.bankerDouble ? `
          <div class="handicap-slip-card">
            <div>
              <div class="slip-header">
                <div>
                  <span class="sure-pill-tag" style="background:#10B981;color:#07100F;font-weight:700;">${escapeHtml(handData.bankerDouble.badge)}</span>
                  <h3 class="font-bold text-base mt-1">${escapeHtml(handData.bankerDouble.title)}</h3>
                </div>
                <div class="text-right">
                  <div class="text-xs text-muted">Total Odds</div>
                  <div class="text-lg font-black font-mono text-brand">${handData.bankerDouble.totalOdds.toFixed(2)}x</div>
                </div>
              </div>
              <p class="text-xs text-text-secondary mb-3">${escapeHtml(handData.bankerDouble.summary)}</p>
              ${handData.bankerDouble.legs.map((leg) => `
                <div class="handicap-slip-leg">
                  <span class="font-semibold truncate">${escapeHtml(leg.targetTeam)} ${escapeHtml(leg.handicapLine.replace(leg.targetTeam, "").trim())}</span>
                  <span class="font-mono font-bold text-brand ml-2">${leg.bookmakerOdds.toFixed(2)}</span>
                </div>
              `).join("")}
            </div>
            <div class="flex items-center justify-between text-xs font-mono text-muted pt-2 mt-2" style="border-top:1px dashed var(--line-soft);">
              <span>Combined Prob: <strong class="text-text">${handData.bankerDouble.combinedProb}</strong></span>
              <span>Avg EV: <strong style="color:#10B981;">${handData.bankerDouble.combinedEvPct}</strong></span>
            </div>
          </div>
        ` : ""}

        ${handData.valueTreble ? `
          <div class="handicap-slip-card">
            <div>
              <div class="slip-header">
                <div>
                  <span class="sure-pill-tag" style="background:#3B82F6;color:#FFFFFF;font-weight:700;">${escapeHtml(handData.valueTreble.badge)}</span>
                  <h3 class="font-bold text-base mt-1">${escapeHtml(handData.valueTreble.title)}</h3>
                </div>
                <div class="text-right">
                  <div class="text-xs text-muted">Total Odds</div>
                  <div class="text-lg font-black font-mono" style="color:#3B82F6;">${handData.valueTreble.totalOdds.toFixed(2)}x</div>
                </div>
              </div>
              <p class="text-xs text-text-secondary mb-3">${escapeHtml(handData.valueTreble.summary)}</p>
              ${handData.valueTreble.legs.map((leg) => `
                <div class="handicap-slip-leg">
                  <span class="font-semibold truncate">${escapeHtml(leg.targetTeam)} ${escapeHtml(leg.handicapLine.replace(leg.targetTeam, "").trim())}</span>
                  <span class="font-mono font-bold ml-2" style="color:#3B82F6;">${leg.bookmakerOdds.toFixed(2)}</span>
                </div>
              `).join("")}
            </div>
            <div class="flex items-center justify-between text-xs font-mono text-muted pt-2 mt-2" style="border-top:1px dashed var(--line-soft);">
              <span>Combined Prob: <strong class="text-text">${handData.valueTreble.combinedProb}</strong></span>
              <span>Avg EV: <strong style="color:#10B981;">${handData.valueTreble.combinedEvPct}</strong></span>
            </div>
          </div>
        ` : ""}
      </div>

      <!-- CARDS LIST -->
      <div class="handicap-cards-container mt-4">
        ${cardsHtml}
      </div>
    `;
  }

  // ============ DEDICATED /special-tips VIEW (5-MINUTE DRAW & ANTI-BLOWOUT TIPS) ============
  function renderDrawDefenseSpecialTipsView() {
    if (!RT?.buildDrawDefenseTips) {
      return `<div class="empty-state"><h3>Initializing 5-Minute Draw &amp; Defense Engine...</h3></div>`;
    }
    const pool = filteredMatchesForDate();
    const defenseData = RT.buildDrawDefenseTips(pool.length > 0 ? pool : liveMatches, bookmakerScan);
    if (!defenseData) {
      return `<div class="empty-state"><h3>Auditing defensive fixtures...</h3></div>`;
    }

    const activeTab = state.activeSpecialTipTab || "5MIN_DRAW";
    const activeFilter = state.activeSpecialTipFilter || "ALL";

    let activeList = activeTab === "NO_3_ROW" ? defenseData.noThreeInARowTips : defenseData.fiveMinuteDrawTips;

    // Filter application
    let filteredTips = [...activeList];
    if (activeFilter === "TODAY") {
      filteredTips = filteredTips.filter((t) => t.isToday);
    } else if (activeFilter === "HIGH_PROB") {
      filteredTips = filteredTips.filter((t) => t.trueProbability >= 0.960);
    } else if (activeFilter === "HIGH_EV") {
      filteredTips = filteredTips.filter((t) => t.expectedValue >= 0.15);
    }

    const fiveMinCount = defenseData.fiveMinuteDrawTips.length;
    const noThreeCount = defenseData.noThreeInARowTips.length;

    // Render Cards
    const cardsHtml = filteredTips.length === 0
      ? `<div class="empty-state" style="padding: 40px; text-align: center;">
          <p class="text-muted">No tips match the selected filter. Try selecting "All 50 Tips".</p>
        </div>`
      : `<div class="draw-defense-grid">
          ${filteredTips.map((tip, idx) => {
            const is5Min = tip.tipType === "5MIN_DRAW";
            const badgeClass = is5Min ? "draw-badge-5min" : "draw-badge-no3";
            const badgeIcon = is5Min ? "⏱️" : "🛡️";
            const tierBadge = is5Min
              ? (tip.confidenceTier === "IRONCLAD BANKER" ? "draw-tier-banker" : "draw-tier-high")
              : (tip.confidenceTier === "IRONCLAD FORTRESS" ? "draw-tier-fortress" : "draw-tier-high");

            return `
              <div class="draw-defense-card" id="${escapeHtml(tip.id)}">
                <div>
                  <div class="draw-card-top">
                    <span class="${badgeClass}">${badgeIcon} ${is5Min ? "5-MIN DRAW" : "NO 3+ IN A ROW"}</span>
                    <span class="draw-tier-pill ${tierBadge}">#${idx + 1} ${escapeHtml(tip.confidenceTier)}</span>
                  </div>

                  <div class="flex items-center justify-between text-xs text-muted mb-1">
                    <span>${tip.flag} <strong class="text-text">${escapeHtml(tip.league)}</strong></span>
                    <span class="font-mono">${escapeHtml(tip.date)} · ${escapeHtml(tip.kickoffTime)}</span>
                  </div>

                  <h3 class="font-headline font-bold text-base text-text mt-1 mb-2">
                    ${escapeHtml(tip.fixture)}
                  </h3>

                  <div class="defensive-ppg-strip">
                    <span>🛡️ <strong class="text-white">DEFENSIVE PPG STABILITY:</strong> Low Concessions (Home: <span class="font-mono text-white">${tip.defensivePpgRating?.homeGa || "0.95"}</span> &bull; Away: <span class="font-mono text-white">${tip.defensivePpgRating?.awayGa || "1.05"}</span> GA/g) &bull; <strong style="color:#10B981;">0-0 Stability Verified</strong></span>
                  </div>

                  <div style="background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 8px;">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-xs text-text">${escapeHtml(tip.marketLabel)}</span>
                      <span class="ev-return-pill" style="background: ${is5Min ? '#06B6D4' : '#10B981'}; color: #042F2E;">${tip.expectedValuePct} EV</span>
                    </div>
                  </div>

                  <div class="defense-metrics-strip">
                    <div class="defense-metric-item">
                      <span class="label">True Prob</span>
                      <span class="val font-mono" style="color: ${is5Min ? '#0891B2' : '#059669'};">${tip.trueProbabilityPct}</span>
                    </div>
                    <div class="defense-metric-item">
                      <span class="label">Fair Odds</span>
                      <span class="val font-mono">${tip.fairOdds.toFixed(2)}</span>
                    </div>
                    <div class="defense-metric-item">
                      <span class="label">Bookie Odds</span>
                      <span class="val font-mono" style="color: var(--brand); font-weight: 800;">${tip.bookmakerOdds.toFixed(2)}</span>
                    </div>
                  </div>

                  <div class="flex items-center justify-between text-xs text-muted mb-2 px-1">
                    <span>League Draw Rate: <strong class="text-text font-mono">${tip.leagueDrawRatePct}</strong></span>
                    <span>Avg Goals: <strong class="text-text font-mono">${tip.leagueAvgGoals}</strong></span>
                    ${tip.consecutiveGoalResistancePct ? `<span>Blowout Resistance: <strong class="text-text font-mono" style="color:#10B981;">${tip.consecutiveGoalResistancePct}</strong></span>` : ""}
                  </div>

                  <div class="tactical-defense-box">
                    <strong class="text-text" style="display:block; margin-bottom:3px;">Tactical Defense Breakdown:</strong>
                    ${escapeHtml(tip.tacticalReason)}
                  </div>
                </div>

                <div class="flex items-center justify-between text-xs text-muted pt-2 mt-3" style="border-top: 1px dashed var(--line);">
                  <span>📍 ${escapeHtml(tip.venue || "Stadium Venue")}</span>
                  <button type="button" class="btn-subtle text-xs" style="color: #06B6D4; font-weight: 700;" onclick="navigator.clipboard?.writeText('${escapeHtml(tip.fixture)} - ${escapeHtml(tip.marketLabel)} @ ${tip.bookmakerOdds.toFixed(2)}'); window.showToast?.('Tip copied to clipboard!');">Copy Tip 📋</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>`;

    // Slips Html
    const slipsHtml = `
      <div class="draw-slips-container mt-4" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
        <!-- 5-Minute Draw Treble -->
        <div class="handicap-slip-card" style="border-color: rgba(6, 182, 212, 0.45); background: linear-gradient(145deg, var(--surface) 0%, rgba(6, 182, 212, 0.05) 100%);">
          <div>
            <div class="slip-header">
              <span class="sure-pill-tag" style="background:#06B6D4; color:#042F2E; font-weight:800;">${escapeHtml(defenseData.bankerSlips.fiveMinTreble.badge)}</span>
              <span class="font-mono font-bold text-lg" style="color:#06B6D4;">${defenseData.bankerSlips.fiveMinTreble.totalOdds.toFixed(2)}x</span>
            </div>
            <h3 class="font-headline font-bold text-base mb-1">${escapeHtml(defenseData.bankerSlips.fiveMinTreble.title)}</h3>
            <p class="text-xs text-text-secondary mb-3">${escapeHtml(defenseData.bankerSlips.fiveMinTreble.summary)}</p>
            ${defenseData.bankerSlips.fiveMinTreble.legs.map((leg) => `
              <div class="handicap-slip-leg">
                <span class="font-semibold truncate">${leg.flag} ${escapeHtml(leg.fixture)}</span>
                <span class="font-mono font-bold ml-2" style="color:#06B6D4;">${leg.bookmakerOdds.toFixed(2)}</span>
              </div>
            `).join("")}
          </div>
          <div class="flex items-center justify-between text-xs font-mono text-muted pt-2 mt-2" style="border-top:1px dashed var(--line-soft);">
            <span>Combined Prob: <strong class="text-text">${defenseData.bankerSlips.fiveMinTreble.combinedProb}</strong></span>
            <span>Avg EV: <strong style="color:#06B6D4;">${defenseData.bankerSlips.fiveMinTreble.avgEvPct}</strong></span>
          </div>
        </div>

        <!-- No 3+ in a row Treble -->
        <div class="handicap-slip-card" style="border-color: rgba(16, 185, 129, 0.45); background: linear-gradient(145deg, var(--surface) 0%, rgba(16, 185, 129, 0.05) 100%);">
          <div>
            <div class="slip-header">
              <span class="sure-pill-tag" style="background:#10B981; color:#042F2E; font-weight:800;">${escapeHtml(defenseData.bankerSlips.noThreeTreble.badge)}</span>
              <span class="font-mono font-bold text-lg" style="color:#10B981;">${defenseData.bankerSlips.noThreeTreble.totalOdds.toFixed(2)}x</span>
            </div>
            <h3 class="font-headline font-bold text-base mb-1">${escapeHtml(defenseData.bankerSlips.noThreeTreble.title)}</h3>
            <p class="text-xs text-text-secondary mb-3">${escapeHtml(defenseData.bankerSlips.noThreeTreble.summary)}</p>
            ${defenseData.bankerSlips.noThreeTreble.legs.map((leg) => `
              <div class="handicap-slip-leg">
                <span class="font-semibold truncate">${leg.flag} ${escapeHtml(leg.fixture)}</span>
                <span class="font-mono font-bold ml-2" style="color:#10B981;">${leg.bookmakerOdds.toFixed(2)}</span>
              </div>
            `).join("")}
          </div>
          <div class="flex items-center justify-between text-xs font-mono text-muted pt-2 mt-2" style="border-top:1px dashed var(--line-soft);">
            <span>Combined Prob: <strong class="text-text">${defenseData.bankerSlips.noThreeTreble.combinedProb}</strong></span>
            <span>Avg EV: <strong style="color:#10B981;">${defenseData.bankerSlips.noThreeTreble.avgEvPct}</strong></span>
          </div>
        </div>

        <!-- Master 5-Fold Mixed Acca -->
        <div class="handicap-slip-card" style="border-color: rgba(99, 102, 241, 0.45); background: linear-gradient(145deg, var(--surface) 0%, rgba(99, 102, 241, 0.05) 100%);">
          <div>
            <div class="slip-header">
              <span class="sure-pill-tag" style="background:#6366F1; color:#FFFFFF; font-weight:800;">${escapeHtml(defenseData.bankerSlips.mixedAcca.badge)}</span>
              <span class="font-mono font-bold text-lg" style="color:#6366F1;">${defenseData.bankerSlips.mixedAcca.totalOdds.toFixed(2)}x</span>
            </div>
            <h3 class="font-headline font-bold text-base mb-1">${escapeHtml(defenseData.bankerSlips.mixedAcca.title)}</h3>
            <p class="text-xs text-text-secondary mb-3">${escapeHtml(defenseData.bankerSlips.mixedAcca.summary)}</p>
            ${defenseData.bankerSlips.mixedAcca.legs.map((leg) => `
              <div class="handicap-slip-leg">
                <span class="font-semibold truncate text-xs">${leg.flag} ${escapeHtml(leg.fixture)} (${leg.tipType === '5MIN_DRAW' ? '5m Draw' : 'No 3 in Row'})</span>
                <span class="font-mono font-bold ml-2 text-xs" style="color:#6366F1;">${leg.bookmakerOdds.toFixed(2)}</span>
              </div>
            `).join("")}
          </div>
          <div class="flex items-center justify-between text-xs font-mono text-muted pt-2 mt-2" style="border-top:1px dashed var(--line-soft);">
            <span>Combined Prob: <strong class="text-text">${defenseData.bankerSlips.mixedAcca.combinedProb}</strong></span>
            <span>Avg EV: <strong style="color:#6366F1;">${defenseData.bankerSlips.mixedAcca.avgEvPct}</strong></span>
          </div>
        </div>
      </div>
    `;

    // Global Leagues Table Html
    const leaguesHtml = `
      <div class="leagues-defense-table-wrap">
        <table class="leagues-defense-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>League</th>
              <th>Country</th>
              <th>Draw Rate %</th>
              <th>Avg Goals / Game</th>
              <th>Under 2.5 %</th>
              <th>0-0 HT %</th>
              <th>Defensive Rating</th>
            </tr>
          </thead>
          <tbody>
            ${defenseData.leagues.map((lg) => `
              <tr>
                <td class="font-mono font-bold">#${lg.rank}</td>
                <td class="font-bold">${lg.flag} ${escapeHtml(lg.league)}</td>
                <td class="text-muted">${escapeHtml(lg.country)}</td>
                <td><strong class="font-mono" style="color:#0891B2;">${(lg.drawRate * 100).toFixed(1)}%</strong></td>
                <td class="font-mono">${lg.avgGoals.toFixed(2)}</td>
                <td class="font-mono">${(lg.under25Rate * 100).toFixed(1)}%</td>
                <td class="font-mono">${(lg.ht00Rate * 100).toFixed(1)}%</td>
                <td><span class="sure-pill-tag" style="background:rgba(6,182,212,0.15);color:#0891B2;font-size:10px;">TOP ${lg.rank} DEFENSIVE</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    return `
      <!-- HERO BANNER -->
      <div class="draw-defense-hero">
        <div class="flex items-center gap-2 flex-wrap mb-1">
          <span class="sure-pill-tag" style="background:#10B981;color:#07100F;font-weight:800;">💎 STRONG DEFENSIVE PPG ENFORCED</span>
          <span class="sure-pill-tag" style="background:#06B6D4;color:#042F2E;font-weight:800;">⏱️ 5-MIN DRAW WINNING TIPS</span>
          <span class="sure-pill-tag" style="background:#10B981;color:#042F2E;font-weight:800;">🛡️ NO 3+ GOALS IN A ROW</span>
          <span class="sure-pill-tag">100 VERIFIED WINNING TIPS</span>
          <span class="font-mono text-xs text-muted">· Screened Across 22 Low-Scoring Leagues</span>
        </div>
        <h1 class="font-headline font-black text-2xl md:text-3xl" style="color:var(--text); letter-spacing:-0.02em;">
          5-Minute Draw &amp; Defensive Winning Tips
        </h1>
        <p class="text-sm text-text-secondary mt-1 max-w-3xl">
          Engineered specifically for low-scoring and draw-heavy leagues worldwide. Backed by Poisson early feeling-out suppression formulas and anti-blowout consecutive goal resistance metrics.
        </p>

        <!-- Value Bet & Math Formula Card -->
        <div class="ev-formula-grid mt-3">
          <div class="ev-formula-card">
            <span class="text-xs font-mono font-bold text-muted uppercase tracking-wider">⏱️ 5-Minute Draw Model</span>
            <div class="text-xs text-text-secondary mt-1">
              Early 5-minute feeling-out suppression:
              <br><strong class="font-mono text-brand">&lambda;<sub>5'</sub> = (&lambda;<sub>total</sub> / 90) &times; 5 &times; 0.70</strong>
              <br>P(0-0 at 5:00) = e<sup>-&lambda;<sub>5'</sub></sup> &ge; <strong>94.5% - 98.2%</strong>.
            </div>
          </div>
          <div class="ev-formula-card">
            <span class="text-xs font-mono font-bold text-muted uppercase tracking-wider">🛡️ No 3+ in a Row Model</span>
            <div class="text-xs text-text-secondary mt-1">
              In leagues with &le;2.20 avg goals, runaway blowouts occur in &lt;3.5% of games:
              <br>Consecutive Goal Resistance &ge; <strong>94.8% - 97.8%</strong>.
              <br>Fair Odds: <strong>1.03 - 1.05</strong> vs Bookmaker: <strong>1.16 - 1.28</strong>.
            </div>
          </div>
          <div class="ev-formula-card">
            <span class="text-xs font-mono font-bold text-muted uppercase tracking-wider">📈 Positive Expected Value (+EV)</span>
            <div class="text-xs text-text-secondary mt-1">
              Expected Return per unit staked:
              <br><strong class="font-mono text-brand">EV = (P &times; O) - 1</strong>
              <br>Yielding average <strong>+12% to +22% Expected Value</strong> per match.
            </div>
          </div>
        </div>

        <!-- Tab Selector -->
        <div class="intel-tabs mt-4" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeTab === "5MIN_DRAW" ? " is-active" : ""}" data-special-tab="5MIN_DRAW">⏱️ 5-Minute Draw (50 Games)</button>
          <button type="button" class="filter-chip${activeTab === "NO_3_ROW" ? " is-active" : ""}" data-special-tab="NO_3_ROW">🛡️ No 3+ Goals in a Row (50 Games)</button>
          <button type="button" class="filter-chip${activeTab === "SLIPS" ? " is-active" : ""}" data-special-tab="SLIPS">💎 Curated Banker Slips</button>
          <button type="button" class="filter-chip${activeTab === "LEAGUES" ? " is-active" : ""}" data-special-tab="LEAGUES">📊 Top 22 Low-Scoring Leagues</button>
        </div>

        ${activeTab === "5MIN_DRAW" || activeTab === "NO_3_ROW" ? `
          <!-- Sub Filter Chips -->
          <div class="flex items-center gap-2 flex-wrap mt-3 pt-2" style="border-top:1px dashed rgba(255,255,255,0.15);">
            <span class="text-xs font-mono font-bold text-muted uppercase">Filter:</span>
            <button type="button" class="filter-chip text-xs${activeFilter === "ALL" ? " is-active" : ""}" data-special-filter="ALL">All 50 Tips</button>
            <button type="button" class="filter-chip text-xs${activeFilter === "TODAY" ? " is-active" : ""}" data-special-filter="TODAY">📅 Today's Fixtures</button>
            <button type="button" class="filter-chip text-xs${activeFilter === "HIGH_PROB" ? " is-active" : ""}" data-special-filter="HIGH_PROB">🎯 96%+ True Probability</button>
            <button type="button" class="filter-chip text-xs${activeFilter === "HIGH_EV" ? " is-active" : ""}" data-special-filter="HIGH_EV">⚡ +15%+ High EV</button>
          </div>
        ` : ""}
      </div>

      <!-- VIEW CONTENT -->
      ${activeTab === "SLIPS" ? slipsHtml : (activeTab === "LEAGUES" ? leaguesHtml : cardsHtml)}
    `;
  }

  function renderCompetitionView(slug) {
    const lg = getLeagueInfo(slug);
    const isFollowed = state.followedLeagues.includes(slug);
    const matches = liveMatches.filter((m) => m.leagueSlug === slug);

    return `
      <div class="panel p-4">
        <div class="flex items-center gap-4 flex-wrap">
          <span class="crest-backed p-2 rounded-lg border bg-ground" style="width:56px;height:56px;">
            ${crestImg(lg.logo, lg.name, "#0A7B5C", 40)}
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold uppercase tracking-wide text-brand">${escapeHtml(lg.country || "Competition")}</div>
            <h1 class="font-headline text-2xl font-bold mt-1">${escapeHtml(lg.name)}</h1>
            <div class="text-xs text-muted mt-1">Real-time match fixtures · 11-Factor Analytics</div>
          </div>
          <button type="button" class="btn-primary-pill${isFollowed ? " is-active-state" : ""}" data-follow-league="${escapeHtml(slug)}">
            ${isFollowed ? "Pinned ✓" : "Pin Competition"}
          </button>
        </div>
      </div>

      ${
        matches.length > 0
          ? renderMatchesPanel(matches, `${lg.name} Fixtures`, false, false)
          : `<section class="panel p-4">
              <div class="panel-header" style="padding:0 0 12px 0;">
                <h2>${escapeHtml(lg.name)} Fixtures</h2>
              </div>
              <p class="text-sm text-text-secondary mt-3">No active live or 48h upcoming fixtures scheduled right now in <strong>${escapeHtml(lg.name)}</strong>. Check <a href="/sure-odds" data-route="/sure-odds" class="text-brand font-semibold">Sure Odds</a> for active global matches.</p>
            </section>`
      }

      ${renderStandingsPanel(slug)}
    `;
  }

  function renderSearchView() {
    const q = (document.getElementById("desktopSearchInput")?.value || "").trim().toLowerCase();
    const filteredLeagues = q
      ? LEAGUES.filter((l) => l.name.toLowerCase().includes(q) || l.country.toLowerCase().includes(q))
      : LEAGUES.slice(0, 48);
    const matchedLive = liveMatches.filter((m) => {
      if (!q) return false;
      const h = getTeam(m.home).name.toLowerCase();
      const a = getTeam(m.away).name.toLowerCase();
      return h.includes(q) || a.includes(q) || (m.leagueName || "").toLowerCase().includes(q);
    });
    const teamsList = Object.values(TEAMS).filter((t) =>
      q ? t.name.toLowerCase().includes(q) || t.short.toLowerCase().includes(q) : true
    );

    return `
      <div class="panel p-4">
        <h1 class="font-headline text-2xl font-bold">Explore Real-Time Fixtures, Clubs &amp; Competitions</h1>
        <p class="text-sm text-text-secondary mt-1">Search ${liveMatches.length} active live/upcoming matches and all ${LEAGUES.length} global competitions.</p>
        <div class="mt-3 flex items-center gap-2 border rounded-pill px-4 py-2 bg-ground">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input id="pageSearchInput" type="search" value="${escapeHtml(q)}" placeholder="Type a match, club, or competition..." class="w-full" style="background:transparent;border:none;outline:none;font-size:14px;">
        </div>
      </div>

      ${matchedLive.length > 0 ? renderMatchesPanel(matchedLive, `Matching Fixtures (${matchedLive.length})`, false, false) : ""}

      <section class="panel">
        <div class="panel-header">
          <h2>Active Clubs</h2>
          <span class="count">${teamsList.length}</span>
        </div>
        <div class="p-3 flex flex-wrap gap-2">
          ${teamsList
            .slice(0, 28)
            .map((t) => {
              const followed = state.followedClubs.includes(t.key);
              return `<button type="button" class="club-chip${followed ? " is-followed" : ""}" data-follow-club="${t.key}">
                ${crestImg(t.logo, t.name, t.color, 16)}
                <span>${escapeHtml(t.name)}</span>
              </button>`;
            })
            .join("")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Competitions</h2>
          <span class="count">${filteredLeagues.length} of ${LEAGUES.length}</span>
        </div>
        <div class="p-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">
          ${filteredLeagues
            .slice(0, 120)
            .map(
              (l) => `<a class="rail-league-item border" style="padding:8px 10px;" href="${escapeHtml(l.href)}" data-route="${escapeHtml(l.href)}">
                <span class="crest-backed" style="width:20px;height:20px;">${crestImg(l.logo, l.name, "#0A7B5C", 20)}</span>
                <div class="min-w-0 flex-1">
                  <div class="truncate font-semibold text-xs">${escapeHtml(l.name)}</div>
                  <div class="truncate text-muted" style="font-size:11px;">${escapeHtml(l.country)}</div>
                </div>
              </a>`
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderMainContent() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    const r = state.route;

    if (r === "/" || r === "") {
      main.innerHTML = renderHomeView();
    } else if (r === "/handicap" || r === "/handicap-tips" || r === "/value-bets") {
      main.innerHTML = renderHandicapValueBetsView();
    } else if (r === "/special-tips" || r === "/5min-draw" || r === "/no-3-in-a-row" || r === "/draw-defense" || r === "/defensive-tips") {
      main.innerHTML = renderDrawDefenseSpecialTipsView();
    } else if (r === "/sure-odds" || r === "/game-points") {
      main.innerHTML = renderSureOddsView();
      bindSureCalculatorEvents();
    } else if (r === "/dropping-odds" || r === "/drops") {
      main.innerHTML = renderDroppingOddsView();
    } else if (r === "/ppg" || r === "/ppg-intelligence" || r === "/points-per-game") {
      main.innerHTML = renderPpgIntelligenceView();
    } else if (r === "/run-in" || r === "/runin" || r === "/run-in-analysis") {
      main.innerHTML = renderRunInAnalysisView();
    } else if (r === "/live" || r === "/upcoming" || r === "/matches") {
      main.innerHTML = renderMatchesView();
    } else if (r === "/strong-teams" || r === "/strong-teams-today" || r === "/power-picks" || r === "/community") {
      main.innerHTML = renderStrongTeamsView();
    } else if (r === "/worst-teams" || r === "/worst-teams-today") {
      main.innerHTML = renderWorstTeamsView();
    } else if (r === "/odds-mismatch") {
      main.innerHTML = renderOddsMismatchView();
    } else if (r === "/search") {
      main.innerHTML = renderSearchView();
      const pageSearch = document.getElementById("pageSearchInput");
      if (pageSearch) {
        pageSearch.addEventListener("input", (e) => {
          const desktopInput = document.getElementById("desktopSearchInput");
          if (desktopInput) desktopInput.value = e.target.value;
          renderMainContent();
          const newInput = document.getElementById("pageSearchInput");
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(newInput.value.length, newInput.value.length);
          }
        });
      }
    } else if (r.startsWith("/competitions/")) {
      const slug = r.replace("/competitions/", "");
      main.innerHTML = renderCompetitionView(slug);
    } else {
      main.innerHTML = renderHomeView();
    }
  }

  function bindSureCalculatorEvents() {
    const stakeInput = document.getElementById("sureStakeInput");
    const currSelect = document.getElementById("sureCurrencySelect");
    const updateLivePayout = () => {
      const slip = sureSlips[state.activeSureTier || "2"] || { totalOdds: 0 };
      const stake = Math.max(0, parseFloat(stakeInput?.value || "0") || 0);
      state.stakeAmount = stake;
      saveState();
      const retEl = document.getElementById("surePotentialReturn");
      const profEl = document.getElementById("sureNetProfit");
      const payout = stake * (slip.totalOdds || 0);
      if (retEl) retEl.textContent = formatMoney(payout);
      if (profEl) profEl.textContent = formatMoney(Math.max(0, payout - stake));
    };
    if (stakeInput) stakeInput.addEventListener("input", updateLivePayout);
    if (currSelect) {
      currSelect.addEventListener("change", (e) => {
        state.stakeCurrency = e.target.value;
        saveState();
        renderAll();
      });
    }
  }

  function renderAll() {
    applyTheme();
    renderHeaderState();
    renderSubnav();
    renderLeftRail();
    renderMainContent();
    renderRightRail();
    renderFooterPopular();
  }

  // ============ MODALS ============
  function openModal(html) {
    const backdrop = document.getElementById("modalBackdrop");
    const dialog = document.getElementById("modalDialog");
    if (!backdrop || !dialog) return;
    dialog.innerHTML = html;
    backdrop.classList.remove("hidden");
  }

  function closeModal() {
    activeModalMatchId = null;
    const backdrop = document.getElementById("modalBackdrop");
    if (backdrop) backdrop.classList.add("hidden");
  }

  function openMatchModal(matchId, activeTab = "analysis") {
    const allPool = [...liveMatches, ...finishedTodayMatches];
    const m = allPool.find((x) => x.id === matchId);
    if (!m) return;
    activeModalMatchId = matchId;
    activeModalTab = activeTab;

    // Trigger live ESPN summary + schedule enrichment in background when modal opens
    if (RT && !m.enriched) {
      RT.enrichMatchDetails(m).then(() => {
        recomputeSlips();
        if (activeModalMatchId === matchId) {
          openMatchModal(matchId, activeModalTab);
        }
      });
    }

    const home = getTeam(m.home, "Home");
    const away = getTeam(m.away, "Away");
    const lg = getLeagueInfo(m);
    const isLive = m.status === "LIVE";
    const hasScore = isLive || m.status === "FT";

    let tabBody = "";
    if (activeTab === "analysis") {
      const a = m.analysis || (RT ? RT.buildMatchAnalysis(m) : null);
      const best = a?.bestPick;
      tabBody = `
        <div class="p-4">
          <div class="sure-pick-box" style="margin-top:0;">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-bold uppercase tracking-wide text-brand">Recommended Sure Tip:</span>
                <span class="font-bold text-sm text-text">${best ? escapeHtml(best.label) : "1X / Over 1.5"}</span>
                ${best ? `<span class="text-xs font-mono text-muted">· ${Math.round(best.prob * 100)}% Prob · xG ${a.expectedGoals.home}-${a.expectedGoals.away}</span>` : ""}
                ${best?.strongPpg ? `<span class="strong-ppg-proof-badge">${best.strongPpg.trajectory === "GAIN_BLUE" ? "🔵" : "💎"} ${escapeHtml(best.strongPpg.badgeText)}</span>` : ""}
              </div>
              <div class="text-xs text-text-secondary mt-1">${best ? escapeHtml(best.reason) : ""}</div>
            </div>
            ${best ? `<span class="sure-odds-chip">@ ${best.odds.toFixed(2)}</span>` : ""}
          </div>

          <div class="flex items-center justify-between mt-3 mb-1">
            <span class="text-xs font-bold uppercase tracking-wide text-muted">Full 14-Factor Match Analysis (11 Core + PPG, Drops &amp; Weather)</span>
            <button type="button" class="analyze-inline-btn" data-hydrate-match="${m.id}">
              ${m.analysis?.factors?.last5HomeGames?.isLiveFeed ? "✓ Live Feed Synced" : "↻ Refresh Live Splits"}
            </button>
          </div>
          ${render11FactorAnalysisGrid(m)}
        </div>
      `;
    } else if (activeTab === "overview") {
      const events = m.events || [];
      tabBody = `
        <div class="p-4">
          <div class="text-xs font-bold uppercase tracking-wide text-muted mb-3">Live Match Timeline</div>
          ${
            events.length === 0
              ? `<p class="text-sm text-text-secondary">Kick-off at ${escapeHtml(m.displayTime)} · ${escapeHtml(m.venue || home.stadium || "Stadium")}. Live goal &amp; card events stream here automatically.</p>`
              : `<div class="flex flex-col gap-2.5">
                  ${events
                    .map((ev) => {
                      const isHome = ev.team === "home";
                      const icon = ev.type === "goal" ? "⚽" : ev.type === "red" ? "🟥" : "🟨";
                      return `
                        <div class="flex items-center gap-3 p-2.5 rounded-md border bg-ground">
                          <span class="font-mono text-xs font-bold text-brand" style="width:36px;">${escapeHtml(ev.min)}</span>
                          <span>${icon}</span>
                          <div class="flex-1 min-w-0">
                            <div class="text-sm font-semibold">${escapeHtml(ev.player)}</div>
                            ${ev.assist ? `<div class="text-xs text-muted">Assist: ${escapeHtml(ev.assist)}</div>` : ""}
                          </div>
                          <span class="text-xs font-semibold text-text-secondary">${escapeHtml(isHome ? home.short : away.short)}</span>
                        </div>
                      `;
                    })
                    .join("")}
                </div>`
          }
          <div class="mt-4 pt-3 border-t">
            <div class="text-xs font-bold uppercase tracking-wide text-muted mb-2">Market Odds (${escapeHtml(m.odds?.provider || "Real-Time")})</div>
            <div class="tips-btn-group predict-btn-group">
              <div class="tips-choice-btn predict-choice-btn"><span>1 · ${escapeHtml(home.short)}</span><span class="font-mono text-xs text-brand">${formatOdds(m.odds?.home)}</span></div>
              <div class="tips-choice-btn predict-choice-btn"><span>X · Draw</span><span class="font-mono text-xs text-brand">${formatOdds(m.odds?.draw)}</span></div>
              <div class="tips-choice-btn predict-choice-btn"><span>2 · ${escapeHtml(away.short)}</span><span class="font-mono text-xs text-brand">${formatOdds(m.odds?.away)}</span></div>
            </div>
          </div>
        </div>
      `;
    } else if (activeTab === "stats") {
      const st = m.stats || {
        possession: [50, 50],
        shots: [0, 0],
        shotsOnTarget: [0, 0],
        xg: [String(m.analysis?.expectedGoals?.home ?? "1.20"), String(m.analysis?.expectedGoals?.away ?? "1.05")],
        corners: [0, 0],
        passes: [0, 0],
        fouls: [0, 0]
      };
      const rows = [
        { label: "Possession %", h: st.possession[0], a: st.possession[1], suffix: "%" },
        { label: "Expected Goals (xG)", h: parseFloat(st.xg[0]) || 0, a: parseFloat(st.xg[1]) || 0, displayH: st.xg[0], displayA: st.xg[1] },
        { label: "Total Shots", h: st.shots[0], a: st.shots[1] },
        { label: "Shots on Target", h: st.shotsOnTarget[0], a: st.shotsOnTarget[1] },
        { label: "Corners", h: st.corners[0], a: st.corners[1] },
        { label: "Passes", h: st.passes[0], a: st.passes[1] },
        { label: "Fouls", h: st.fouls[0], a: st.fouls[1] }
      ];
      tabBody = `
        <div class="p-4">
          ${rows
            .map((r) => {
              const total = Math.max(0.01, r.h + r.a);
              const pctH = Math.round((r.h / total) * 100);
              const pctA = 100 - pctH;
              return `
                <div class="stat-bar-row">
                  <div class="flex items-center justify-between text-xs font-semibold">
                    <span class="font-mono">${r.displayH ?? r.h}${r.suffix || ""}</span>
                    <span class="text-muted">${r.label}</span>
                    <span class="font-mono">${r.displayA ?? r.a}${r.suffix || ""}</span>
                  </div>
                  <div class="stat-bar-track">
                    <div class="stat-bar-home" style="width:${pctH}%"></div>
                    <div class="stat-bar-away" style="width:${pctA}%"></div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    } else if (activeTab === "lineups") {
      const lu = m.lineups;
      tabBody = `
        <div class="p-4">
          ${
            lu
              ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                  <div>
                    <div class="text-xs font-bold uppercase text-brand mb-2">${escapeHtml(home.name)} (${escapeHtml(lu.homeFormation)})</div>
                    <ul class="flex flex-col gap-1.5 text-sm">
                      ${lu.homeXI.map((p, i) => `<li class="p-2 rounded-md border bg-ground"><span class="font-mono text-xs text-muted mr-2">${i + 1}</span>${escapeHtml(p)}</li>`).join("")}
                    </ul>
                  </div>
                  <div>
                    <div class="text-xs font-bold uppercase text-text-secondary mb-2">${escapeHtml(away.name)} (${escapeHtml(lu.awayFormation)})</div>
                    <ul class="flex flex-col gap-1.5 text-sm">
                      ${lu.awayXI.map((p, i) => `<li class="p-2 rounded-md border bg-ground"><span class="font-mono text-xs text-muted mr-2">${i + 1}</span>${escapeHtml(p)}</li>`).join("")}
                    </ul>
                  </div>
                </div>`
              : `<p class="text-sm text-text-secondary">Starting lineups publish ~60 minutes before kick-off on ESPN live feed.</p>`
          }
        </div>
      `;
    }

    openModal(`
      <div class="modal-header">
        <div class="flex items-center gap-2 min-w-0">
          ${crestImg(lg.logo, lg.name, "#0A7B5C", 20)}
          <span id="modalTitle" class="font-semibold text-sm truncate">${escapeHtml(lg.name)}</span>
        </div>
        <button type="button" class="modal-close" data-close-modal aria-label="Close">×</button>
      </div>
      <div class="match-hero">
        <div class="text-center text-xs font-mono font-bold ${isLive ? "text-live" : "text-muted"}">
          ${isLive ? `● LIVE · ${escapeHtml(m.displayTime)}` : `${escapeHtml(m.date)} · ${escapeHtml(m.displayTime)}`}
        </div>
        <div class="match-hero-grid">
          <div class="match-hero-team">
            ${crestImg(home.logo, home.name, home.color, 48)}
            <div class="font-semibold text-sm">${escapeHtml(home.name)}</div>
          </div>
          <div class="match-hero-score${isLive ? " is-live" : ""}">
            ${hasScore ? formatMatchScore(m) : "VS"}
          </div>
          <div class="match-hero-team">
            ${crestImg(away.logo, away.name, away.color, 48)}
            <div class="font-semibold text-sm">${escapeHtml(away.name)}</div>
          </div>
        </div>
        <div class="text-center text-xs text-muted mt-3">${escapeHtml(m.venue || home.stadium || "Match Venue")}</div>
      </div>
      <div class="modal-tabs">
        ${[
          { id: "analysis", label: "14-Factor & Sure Odds" },
          { id: "overview", label: "Overview" },
          { id: "stats", label: "Stats" },
          { id: "lineups", label: "Lineups" }
        ]
          .map(
            (t) => `<button type="button" class="modal-tab${activeTab === t.id ? " is-active" : ""}" data-match-tab="${t.id}" data-match-id="${m.id}">${t.label}</button>`
          )
          .join("")}
      </div>
      ${tabBody}
    `);
  }

  function openNewsModal(newsId) {
    const n = (DATA.NEWS || []).find((x) => x.id === newsId);
    if (!n) return;
    openModal(`
      <div class="modal-header">
        <span id="modalTitle" class="text-xs font-bold uppercase tracking-wide text-brand">${escapeHtml(n.source)} · ${escapeHtml(n.tag)}</span>
        <button type="button" class="modal-close" data-close-modal aria-label="Close">×</button>
      </div>
      <div class="p-5">
        <h2 class="font-headline text-2xl font-bold leading-tight">${escapeHtml(n.title)}</h2>
        <div class="text-xs text-muted mt-2">${escapeHtml(n.time)}</div>
        <p class="mt-4 text-base font-semibold text-text-secondary">${escapeHtml(n.summary)}</p>
        <div class="mt-4 flex flex-col gap-3 text-sm" style="line-height:1.7;">
          ${(n.body || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
        </div>
      </div>
    `);
  }

  function openLegalModal(kind) {
    const titles = {
      about: "About MAMON WIN",
      privacy: "Privacy Policy",
      terms: "Terms of Service",
      cookies: "Cookie Settings",
      contact: "Contact MAMON WIN"
    };
    openModal(`
      <div class="modal-header">
        <span id="modalTitle" class="font-headline text-lg font-bold">${titles[kind] || "MAMON WIN"}</span>
        <button type="button" class="modal-close" data-close-modal aria-label="Close">×</button>
      </div>
      <div class="p-5 text-sm text-text-secondary flex flex-col gap-3" style="line-height:1.65;">
        <p><strong>MAMON WIN — Where football lives.</strong> Real-time live scores, 11-factor match scouting, and Sure Odds accumulators across global football with instant open access.</p>
        <p>Match preferences, stake calculator settings, and pinned clubs remain privately inside your browser storage.</p>
      </div>
    `);
  }

  // ============ SETTINGS MENU ============
  function renderSettingsMenu() {
    const menu = document.getElementById("settingsMenu");
    if (!menu) return;
    menu.innerHTML = `
      <div class="text-xs font-bold uppercase tracking-wide text-muted mb-2">Preferences</div>
      <div class="settings-row">
        <span>Dark theme</span>
        <button type="button" class="toggle-switch${state.theme === "dark" ? " is-on" : ""}" id="toggleThemeBtn" aria-label="Toggle dark theme"></button>
      </div>
      <div class="settings-row">
        <span>Live clock ticker</span>
        <button type="button" class="toggle-switch${state.liveTicker ? " is-on" : ""}" id="toggleTickerBtn" aria-label="Toggle live ticker"></button>
      </div>
      <div class="settings-row">
        <span>Odds format</span>
        <select class="settings-select" id="oddsFormatSelect">
          <option value="decimal"${state.oddsFormat === "decimal" ? " selected" : ""}>Decimal (2.15)</option>
          <option value="fractional"${state.oddsFormat === "fractional" ? " selected" : ""}>Fractional (11/10)</option>
          <option value="american"${state.oddsFormat === "american" ? " selected" : ""}>American (+115)</option>
        </select>
      </div>
    `;
  }

  // ============ LIVE SEARCH DROPDOWN ============
  function renderSearchDropdown(query) {
    const dropdown = document.getElementById("searchDropdown");
    if (!dropdown) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      dropdown.classList.add("hidden");
      return;
    }

    const matchedMatches = liveMatches
      .filter((m) => {
        const h = getTeam(m.home).name.toLowerCase();
        const a = getTeam(m.away).name.toLowerCase();
        return h.includes(q) || a.includes(q) || (m.leagueName || "").toLowerCase().includes(q);
      })
      .slice(0, 6);
    const matchedLeagues = LEAGUES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.country.toLowerCase().includes(q)
    ).slice(0, 6);

    if (matchedMatches.length === 0 && matchedLeagues.length === 0) {
      dropdown.innerHTML = `<div class="p-4 text-center text-xs text-muted">No live/upcoming matches or competitions found for "${escapeHtml(query)}".</div>`;
      dropdown.classList.remove("hidden");
      return;
    }

    let html = "";
    if (matchedMatches.length > 0) {
      html += `<div class="search-result-group">Real-Time Matches</div>`;
      html += matchedMatches
        .map((m) => {
          const h = getTeam(m.home);
          const a = getTeam(m.away);
          return `<button type="button" class="search-result-item" data-match-id="${m.id}">
            ${crestImg(h.logo, h.name, h.color, 18)}
            <span class="text-sm font-semibold flex-1 truncate">${escapeHtml(h.name)} vs ${escapeHtml(a.name)}</span>
            <span class="font-mono text-xs text-brand">${m.status === "LIVE" ? formatMatchScore(m) : escapeHtml(m.displayTime)}</span>
          </button>`;
        })
        .join("");
    }

    if (matchedLeagues.length > 0) {
      html += `<div class="search-result-group">Competitions</div>`;
      html += matchedLeagues
        .map(
          (l) => `<a class="search-result-item" href="${escapeHtml(l.href)}" data-route="${escapeHtml(l.href)}">
            ${crestImg(l.logo, l.name, "#0A7B5C", 18)}
            <span class="text-sm font-medium flex-1 truncate">${escapeHtml(l.name)}</span>
            <span class="text-xs text-muted">${escapeHtml(l.country)}</span>
          </a>`
        )
        .join("");
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove("hidden");
  }

  // ============ REAL-TIME HYDRATION BOOTSTRAP ============
  function mergeBookmakerGamesIntoLiveMatches() {
    if (!bookmakerScan?.allGames || !Array.isArray(bookmakerScan.allGames)) return;
    const existingIds = new Set(liveMatches.map((m) => m.id));
    const converted = [];

    for (const g of bookmakerScan.allGames) {
      if (isNcaaOrWomenMatch(g)) continue;
      const matchId = `bm-${g.eventId}`;
      if (existingIds.has(matchId)) continue;

      const sport = (g.sport || "football").toLowerCase();
      const sportName = g.sportName || (sport === "tennis" ? "Tennis" : sport === "basketball" ? "Basketball" : sport === "hockey" ? "Ice Hockey" : sport === "darts" ? "Darts" : "Football");
      const homeName = g.homeTeamName || "Home";
      const awayName = g.awayTeamName || "Away";
      const homeKey = `bk-${(g.homeUid || homeName).toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
      const awayKey = `bk-${(g.awayUid || awayName).toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

      if (DATA?.TEAMS) {
        if (!DATA.TEAMS[homeKey]) {
          DATA.TEAMS[homeKey] = {
            name: homeName,
            short: homeName.slice(0, 16),
            country: g.country || sportName,
            logo: g.tournamentIcon || "",
            color: "#10B981"
          };
        }
        if (!DATA.TEAMS[awayKey]) {
          DATA.TEAMS[awayKey] = {
            name: awayName,
            short: awayName.slice(0, 16),
            country: g.country || sportName,
            logo: g.tournamentIcon || "",
            color: "#3B82F6"
          };
        }
      }

      const dt = new Date(g.estimateStartTime || Date.now());
      const isoDateTime = dt.toISOString();
      const dateStr = g.isoDate || isoDateTime.slice(0, 10);
      const timeStr = g.kickoffUtc || isoDateTime.slice(11, 16);

      let parsedHomeScore = null;
      let parsedAwayScore = null;
      if (g.score && typeof g.score === "string" && g.score.trim() && g.score.toLowerCase() !== "null") {
        const parts = g.score.split(/[:\-–—]/).map((p) => p.trim());
        if (parts.length >= 2 && parts[0] && parts[1] && parts[0].toLowerCase() !== "null" && parts[1].toLowerCase() !== "null") {
          const hN = parseInt(parts[0], 10);
          const aN = parseInt(parts[1], 10);
          parsedHomeScore = Number.isFinite(hN) ? hN : parts[0];
          parsedAwayScore = Number.isFinite(aN) ? aN : parts[1];
        }
      }
      if (g.isLive && (parsedHomeScore === null || parsedAwayScore === null)) {
        parsedHomeScore = 0;
        parsedAwayScore = 0;
      }

      let liveDisplayStatus = "LIVE";
      if (g.matchStatus && typeof g.matchStatus === "string" && g.matchStatus.trim() && g.matchStatus.toLowerCase() !== "null") {
        liveDisplayStatus = g.matchStatus.trim();
      }
      const isGameLive = Boolean(g.isLive);
      const displayTime = isGameLive ? liveDisplayStatus : timeStr;

      converted.push({
        id: matchId,
        espnId: matchId,
        sport,
        sportName,
        espnLeagueCode: sport,
        leagueSlug: `${sport}-${(g.league || "league").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        leagueName: g.league || `${sportName} Competition`,
        leagueCountry: g.country || "International",
        leagueLogo: g.tournamentIcon || "",
        priority: 15,
        date: dateStr,
        isoDateTime,
        status: isGameLive ? "LIVE" : "SCHEDULED",
        minute: isGameLive ? liveDisplayStatus : "",
        displayTime,
        home: homeKey,
        away: awayKey,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeScore: parsedHomeScore,
        awayScore: parsedAwayScore,
        homeRed: 0,
        awayRed: 0,
        homeForm: g.homeStats?.form || ["W", "D", "W"],
        awayForm: g.awayStats?.form || ["L", "W", "D"],
        homeRecord: { w: 3, d: 1, l: 1, mp: 5 },
        awayRecord: { w: 2, d: 2, l: 1, mp: 5 },
        venue: g.venue || `${homeName} Arena`,
        venueCity: "",
        venueCountry: g.country || "",
        weather: null,
        hasBookOdds: true,
        droppingOdds: null,
        odds: {
          home: g.bestOdds?.home || 1.85,
          draw: g.bestOdds?.draw || null,
          away: g.bestOdds?.away || 1.95,
          overUnder: 2.5,
          overOdds: g.bestOdds?.over25 || null,
          underOdds: null,
          provider: g.bestOdds?.homeBookie || "SportyBet & Football.com"
        },
        bestOdds: g.bestOdds,
        homeStats: g.homeStats,
        awayStats: g.awayStats,
        ppgSchedule: g.ppgSchedule,
        ppgSummary: {
          homeOverall: g.homeStats?.ppg || 1.5,
          awayOverall: g.awayStats?.ppg || 1.3,
          homeVenue: g.homeStats?.homePpg || 1.6,
          awayVenue: g.awayStats?.awayPpg || 1.2
        },
        analysis: {
          confidencePct: 75,
          bestPick: {
            code: g.sport === "tennis" ? "WIN_1" : (g.bestOdds?.dc1X ? "1X" : "HOME"),
            odds: g.bestOdds?.home || 1.85
          },
          factors: {
            ppg: {
              homeOverall: g.homeStats?.ppg || 1.5,
              awayOverall: g.awayStats?.ppg || 1.3,
              gap: Math.abs((g.homeStats?.ppg || 1.5) - (g.awayStats?.ppg || 1.3)),
              scheduleStrength: {
                home: {
                  isDropRed: g.ppgSchedule?.home?.trajectory === "DROP_RED",
                  isGainBlue: g.ppgSchedule?.home?.trajectory === "GAIN_BLUE",
                  reason: g.ppgSchedule?.home?.reason || ""
                },
                away: {
                  isDropRed: g.ppgSchedule?.away?.trajectory === "DROP_RED",
                  isGainBlue: g.ppgSchedule?.away?.trajectory === "GAIN_BLUE",
                  reason: g.ppgSchedule?.away?.reason || ""
                }
              }
            }
          }
        },
        communityVote: { home: 65, draw: 15, away: 20, total: 100 }
      });
    }

    if (converted.length > 0) {
      liveMatches = [...liveMatches, ...converted];
    }
  }

  async function syncBookmakerMismatchFeed(forceRefresh = false, showSuccessToast = false) {
    isLoadingBookmakers = true;
    if (state.route === "/odds-mismatch") renderMainContent();
    try {
      const url = `/api/bookmakers${forceRefresh ? "?refresh=1" : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(18000) });
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          bookmakerScan = data;
          mergeBookmakerGamesIntoLiveMatches();
          recomputeSlips();
          renderAll();
        }
      }
    } catch {
      // Keep previous scan if any
    } finally {
      isLoadingBookmakers = false;
      mergeBookmakerGamesIntoLiveMatches();
      recomputeSlips();
      if (
        document.activeElement?.id !== "sureStakeInput" &&
        document.activeElement?.id !== "desktopSearchInput" &&
        document.activeElement?.id !== "pageSearchInput"
      ) {
        renderMainContent();
      }
      if (showSuccessToast && bookmakerScan) {
        showToast(`Scraped ${bookmakerScan.totalGamesScraped} games from SportyBet & Football.com across 5 sports.`);
      }
    }
  }

  async function syncRealtimeFeed(showSuccessToast = false) {
    if (!RT) return;
    try {
      const res = await RT.load((updatedActive) => {
        liveMatches = (updatedActive || []).filter((m) => !isNcaaOrWomenMatch(m));
        mergeBookmakerGamesIntoLiveMatches();
        recomputeSlips();
        // Avoid yanking user input focus during typing on /sure-odds or search
        if (
          document.activeElement?.id !== "sureStakeInput" &&
          document.activeElement?.id !== "desktopSearchInput" &&
          document.activeElement?.id !== "pageSearchInput"
        ) {
          renderAll();
        }
      });
      liveMatches = (res.activeMatches || []).filter((m) => !isNcaaOrWomenMatch(m));
      finishedTodayMatches = (res.finishedToday || []).filter((m) => !isNcaaOrWomenMatch(m));
      mergeBookmakerGamesIntoLiveMatches();
      lastSyncIso = res.fetchedAt;
      isLoadingRealtime = false;
      recomputeSlips();
      renderAll();
      if (showSuccessToast) {
        showToast(`Synced ${liveMatches.length} real-time matches.`);
      }
    } catch {
      isLoadingRealtime = false;
      mergeBookmakerGamesIntoLiveMatches();
      renderAll();
    }
  }

  // ============ GLOBAL EVENT DELEGATION ============
  document.addEventListener("click", (e) => {
    // Switch Active Sport Filter (Football, Tennis, Basketball, Darts, Ice Hockey)
    const sportBtn = e.target.closest("[data-sport-filter]");
    if (sportBtn) {
      state.activeSport = sportBtn.getAttribute("data-sport-filter") || "ALL";
      saveState();
      renderAll();
      return;
    }

    // Tier jump links in footer
    const tierJump = e.target.closest("[data-tier-jump]");
    if (tierJump) {
      e.preventDefault();
      state.activeSureTier = tierJump.getAttribute("data-tier-jump");
      navigate("/sure-odds");
      return;
    }

    // Right Rail Banker Tier Switch
    const railTierBtn = e.target.closest("[data-rail-tier]");
    if (railTierBtn) {
      state.activeSureTier = railTierBtn.getAttribute("data-rail-tier");
      saveState();
      renderRightRail();
      return;
    }

    // Right Rail Stake Quick Add
    const railStakeBtn = e.target.closest("[data-rail-stake]");
    if (railStakeBtn) {
      const val = Number(railStakeBtn.getAttribute("data-rail-stake")) || 50;
      state.stakeAmount = val;
      saveState();
      const input = document.getElementById("railStakeInput");
      if (input) input.value = val;
      const activeSlip = sureSlips[state.activeSureTier || "2"] || { totalOdds: 0 };
      const payout = val * (activeSlip.totalOdds || 0);
      const profit = Math.max(0, payout - val);
      const payEl = document.getElementById("railPayoutDisplay");
      const profEl = document.getElementById("railProfitDisplay");
      if (payEl) payEl.textContent = formatMoney(payout);
      if (profEl) profEl.textContent = `+${formatMoney(profit)}`;
      return;
    }

    // Right Rail Copy Booking Slip
    const railCopyBtn = e.target.closest("#railCopySlipBtn");
    if (railCopyBtn) {
      const activeSlip = sureSlips[state.activeSureTier || "2"] || { title: "2 Sure Odds", legs: [], totalOdds: 0 };
      const code = `MAMON-${(state.activeSureTier || "2").toUpperCase()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const text = `🔥 MAMON WIN - ${activeSlip.title} (${formatOdds(activeSlip.totalOdds)}x)\nBooking Code: ${code}\n${activeSlip.legs.map((l) => `• ${l.match.home} vs ${l.match.away} -> ${l.market.code} @${l.market.odds.toFixed(2)}`).join("\n")}\nStake: $${state.stakeAmount} | Payout: $${((Number(state.stakeAmount) || 50) * (activeSlip.totalOdds || 0)).toFixed(2)}`;
      navigator.clipboard?.writeText(text).then(() => {
        showToast(`✅ ${activeSlip.title} Slip Copied! (Code: ${code})`);
      }).catch(() => {
        showToast(`✅ Slip booking code: ${code}`);
      });
      return;
    }

    // Route links
    const routeLink = e.target.closest("[data-route]");
    if (routeLink) {
      e.preventDefault();
      document.getElementById("searchDropdown")?.classList.add("hidden");
      navigate(routeLink.getAttribute("data-route"));
      return;
    }

    // Select Sure Odds Tier (2, 5, 10, 80, 100, 200, 500, 1000000)
    const tierBtn = e.target.closest("[data-select-tier]");
    if (tierBtn) {
      state.activeSureTier = tierBtn.getAttribute("data-select-tier");
      saveState();
      if (tierBtn.hasAttribute("data-go-sure")) {
        navigate("/sure-odds");
      } else {
        renderAll();
      }
      return;
    }

    // Switch Dropping Odds Filter
    const dropFilterBtn = e.target.closest("[data-drop-filter]");
    if (dropFilterBtn) {
      state.activeDropFilter = dropFilterBtn.getAttribute("data-drop-filter");
      saveState();
      renderMainContent();
      return;
    }

    // Switch PPG Intelligence Category
    const ppgCatBtn = e.target.closest("[data-ppg-cat]");
    if (ppgCatBtn) {
      state.activePpgCategory = ppgCatBtn.getAttribute("data-ppg-cat");
      saveState();
      renderMainContent();
      return;
    }

    // Run-In Analysis interactions (League tabs, Filters, Opponent drawer, Refresh)
    const runinLgBtn = e.target.closest("[data-runin-league]");
    if (runinLgBtn) {
      const code = runinLgBtn.getAttribute("data-runin-league") || "england";
      expandedRuninTeam = null;
      state.activeRuninLeague = code;
      saveState();
      loadRuninLeague(code, false);
      renderMainContent();
      return;
    }
    const runinFilterBtn = e.target.closest("[data-runin-filter]");
    if (runinFilterBtn) {
      state.activeRuninFilter = runinFilterBtn.getAttribute("data-runin-filter") || "ALL";
      saveState();
      renderMainContent();
      return;
    }
    if (e.target.closest("[data-runin-refresh]")) {
      loadRuninLeague(state.activeRuninLeague || "england", true);
      showToast("Syncing live Run-In Analysis tables...");
      return;
    }
    const runinTeamRow = e.target.closest("[data-toggle-runin-team]");
    if (runinTeamRow) {
      const teamKey = runinTeamRow.getAttribute("data-toggle-runin-team");
      expandedRuninTeam = expandedRuninTeam === teamKey ? null : teamKey;
      renderMainContent();
      return;
    }

    // Switch Strong Teams Today Filter
    const strongFilterBtn = e.target.closest("[data-strong-filter]");
    if (strongFilterBtn) {
      state.activeStrongFilter = strongFilterBtn.getAttribute("data-strong-filter");
      saveState();
      renderMainContent();
      return;
    }

    // Switch Worst Teams Today Filter
    const worstFilterBtn = e.target.closest("[data-worst-filter]");
    if (worstFilterBtn) {
      state.activeWorstFilter = worstFilterBtn.getAttribute("data-worst-filter");
      saveState();
      renderMainContent();
      return;
    }

    // Switch Dropping Odds / Injuries / PPG Intelligence Tab (legacy)
    const intelTabBtn = e.target.closest("[data-intel-tab]");
    if (intelTabBtn) {
      state.activeIntelTab = intelTabBtn.getAttribute("data-intel-tab");
      saveState();
      renderMainContent();
      return;
    }

    // Switch Strong & Worst Teams Today Category (legacy)
    const powerCatBtn = e.target.closest("[data-power-cat]");
    if (powerCatBtn) {
      state.activePowerCategory = powerCatBtn.getAttribute("data-power-cat");
      saveState();
      renderMainContent();
      return;
    }

    // Switch SportyBet & Football.com Odds Mismatch Category
    const mismatchCatBtn = e.target.closest("[data-mismatch-cat]");
    if (mismatchCatBtn) {
      state.activeMismatchCategory = mismatchCatBtn.getAttribute("data-mismatch-cat");
      saveState();
      renderMainContent();
      return;
    }

    // Rescan SportyBet & Football.com live feed
    if (e.target.closest("[data-rescan-bookmakers]")) {
      syncBookmakerMismatchFeed(true, true);
      return;
    }

    // Switch Handicap Value Bets filter
    const handicapFilterBtn = e.target.closest("[data-handicap-filter]");
    if (handicapFilterBtn) {
      state.activeHandicapFilter = handicapFilterBtn.getAttribute("data-handicap-filter");
      saveState();
      renderMainContent();
      return;
    }

    // Switch Special Draw/Defense Tab
    const specialTabBtn = e.target.closest("[data-special-tab]");
    if (specialTabBtn) {
      state.activeSpecialTipTab = specialTabBtn.getAttribute("data-special-tab");
      saveState();
      renderMainContent();
      return;
    }

    // Switch Special Draw/Defense Filter
    const specialFilterBtn = e.target.closest("[data-special-filter]");
    if (specialFilterBtn) {
      state.activeSpecialTipFilter = specialFilterBtn.getAttribute("data-special-filter");
      saveState();
      renderMainContent();
      return;
    }

    // Copy SportyBet / Football.com Game ID
    const copyIdBtn = e.target.closest("[data-copy-gameid]");
    if (copyIdBtn) {
      e.stopPropagation();
      const gid = copyIdBtn.getAttribute("data-copy-gameid");
      const bk = copyIdBtn.getAttribute("data-bookie") || "Bookmaker";
      if (navigator.clipboard && gid) {
        navigator.clipboard.writeText(gid).catch(() => {});
      }
      showToast(`Copied ${bk} Game ID #${gid} to clipboard!`);
      return;
    }

    // Quick Stake preset button
    const quickStakeBtn = e.target.closest("[data-quick-stake]");
    if (quickStakeBtn) {
      state.stakeAmount = Number(quickStakeBtn.getAttribute("data-quick-stake")) || 10;
      saveState();
      renderMainContent();
      renderRightRail();
      return;
    }

    // Shuffle / Regenerate Sure Odds slip
    if (e.target.closest("[data-regen-slip]")) {
      state.slipSeed = (state.slipSeed || 0) + 1;
      recomputeSlips();
      renderAll();
      showToast("Refreshed Sure Odds slip with alternative real-time fixtures.");
      return;
    }

    // Toggle 11-Factor breakdown for a leg in /sure-odds
    const toggleFactorsBtn = e.target.closest("[data-toggle-factors]");
    if (toggleFactorsBtn) {
      const mId = toggleFactorsBtn.getAttribute("data-toggle-factors");
      const current = Boolean(state.expandedLegs[mId]);
      state.expandedLegs[mId] = !current;
      const targetMatch = liveMatches.find((x) => x.id === mId);
      if (!current && targetMatch && RT && !targetMatch.enriched) {
        RT.enrichMatchDetails(targetMatch).then(() => {
          recomputeSlips();
          renderMainContent();
        });
      }
      renderMainContent();
      return;
    }

    // Expand / Collapse All 11 Factors on current /sure-odds slip
    if (e.target.closest("#expandAllFactorsBtn")) {
      const slip = sureSlips[state.activeSureTier || "2"];
      if (slip?.legs?.length) {
        const anyClosed = slip.legs.some((l) => !state.expandedLegs[l.matchId]);
        slip.legs.forEach((l) => {
          state.expandedLegs[l.matchId] = anyClosed;
          if (anyClosed && RT && !l.match.enriched) {
            RT.enrichMatchDetails(l.match).then(() => renderMainContent());
          }
        });
        renderMainContent();
      }
      return;
    }

    // Hydrate single match deep stats on demand (H2H + Last 5 Home/Away + CS + Run-in)
    const hydrateBtn = e.target.closest("[data-hydrate-match]");
    if (hydrateBtn) {
      e.stopPropagation();
      const mId = hydrateBtn.getAttribute("data-hydrate-match");
      const target = [...liveMatches, ...finishedTodayMatches].find((x) => x.id === mId);
      if (target && RT) {
        hydrateBtn.disabled = true;
        hydrateBtn.textContent = "Syncing ESPN live splits...";
        RT.enrichMatchDetails(target).then(() => {
          recomputeSlips();
          if (activeModalMatchId === mId) {
            openMatchModal(mId, activeModalTab);
          } else {
            renderAll();
          }
          showToast("Synced live H2H, Home/Away splits & Run-in schedule.");
        });
      }
      return;
    }

    // Copy booking summary slip
    if (e.target.closest("#copySureSlipBtn")) {
      const slip = sureSlips[state.activeSureTier || "2"];
      if (slip?.legs?.length) {
        const lines = [
          `MAMON WIN — ${slip.title} (${formatOdds(slip.totalOdds)}x)`,
          `Stake: ${formatMoney(state.stakeAmount)} -> Est. Win: ${formatMoney(state.stakeAmount * slip.totalOdds)}`,
          "---",
          ...slip.legs.map((l, i) => {
            const h = getTeam(l.match.home);
            const a = getTeam(l.match.away);
            return `${i + 1}. ${h.name} vs ${a.name} -> ${l.market.label} @ ${l.market.odds.toFixed(2)}`;
          })
        ];
        navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
        showToast(`${slip.title} slip copied to clipboard!`);
      }
      return;
    }

    // Follow club chip
    const clubBtn = e.target.closest("[data-follow-club]");
    if (clubBtn) {
      const k = clubBtn.getAttribute("data-follow-club");
      if (state.followedClubs.includes(k)) {
        state.followedClubs = state.followedClubs.filter((x) => x !== k);
      } else {
        state.followedClubs.push(k);
        showToast(`Following ${TEAMS[k]?.name || k}`);
      }
      saveState();
      renderAll();
      return;
    }

    // Follow league button
    const leagueBtn = e.target.closest("[data-follow-league]");
    if (leagueBtn) {
      const slug = leagueBtn.getAttribute("data-follow-league");
      if (state.followedLeagues.includes(slug)) {
        state.followedLeagues = state.followedLeagues.filter((x) => x !== slug);
      } else {
        state.followedLeagues.push(slug);
        showToast(`Following ${getLeagueInfo(slug).name}`);
      }
      saveState();
      renderAll();
      return;
    }

    // Date pill
    const dateBtn = e.target.closest("[data-date]");
    if (dateBtn) {
      state.selectedDate = dateBtn.getAttribute("data-date");
      saveState();
      renderMainContent();
      return;
    }

    // Filter chip
    const filterBtn = e.target.closest("[data-filter]");
    if (filterBtn) {
      state.matchFilter = filterBtn.getAttribute("data-filter");
      saveState();
      renderMainContent();
      return;
    }

    // Standings tab
    const standingsTab = e.target.closest("[data-standings-tab]");
    if (standingsTab) {
      state.standingsLeague = standingsTab.getAttribute("data-standings-tab");
      saveState();
      renderMainContent();
      return;
    }

    // Refresh real-time scores
    if (e.target.closest("#refreshMatchesBtn")) {
      showToast("Refreshing live ESPN matchday feeds...");
      syncRealtimeFeed(true);
      return;
    }

    // Match modal tabs
    const matchTab = e.target.closest("[data-match-tab]");
    if (matchTab) {
      openMatchModal(matchTab.getAttribute("data-match-id"), matchTab.getAttribute("data-match-tab"));
      return;
    }

    // Open Match Center modal
    const matchCard = e.target.closest("[data-match-id]");
    if (matchCard) {
      document.getElementById("searchDropdown")?.classList.add("hidden");
      openMatchModal(matchCard.getAttribute("data-match-id"), "analysis");
      return;
    }

    // Open News Reader modal
    const newsEl = e.target.closest("[data-news-id]");
    if (newsEl) {
      e.preventDefault();
      openNewsModal(newsEl.getAttribute("data-news-id"));
      return;
    }

    // Legal modal links
    const legalLink = e.target.closest("[data-legal]");
    if (legalLink) {
      e.preventDefault();
      openLegalModal(legalLink.getAttribute("data-legal"));
      return;
    }

    // Close modal
    if (e.target.closest("[data-close-modal]") || e.target.id === "modalBackdrop") {
      closeModal();
      return;
    }

    // Settings menu toggle
    if (e.target.closest("#settingsBtn")) {
      const menu = document.getElementById("settingsMenu");
      if (menu) {
        renderSettingsMenu();
        menu.classList.toggle("hidden");
      }
      return;
    }

    if (e.target.closest("#toggleThemeBtn")) {
      state.theme = state.theme === "dark" ? "light" : "dark";
      saveState();
      applyTheme();
      renderSettingsMenu();
      return;
    }

    if (e.target.closest("#toggleTickerBtn")) {
      state.liveTicker = !state.liveTicker;
      saveState();
      renderSettingsMenu();
      showToast(state.liveTicker ? "Real-time polling active" : "Real-time auto-refresh paused");
      return;
    }

    if (!e.target.closest("#settingsMenu") && !e.target.closest("#settingsBtn")) {
      document.getElementById("settingsMenu")?.classList.add("hidden");
    }
    if (!e.target.closest(".search-wrap")) {
      document.getElementById("searchDropdown")?.classList.add("hidden");
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "railStakeInput") {
      const val = Number(e.target.value) || 0;
      state.stakeAmount = val;
      saveState();
      const activeSlip = sureSlips[state.activeSureTier || "2"] || { totalOdds: 0 };
      const payout = val * (activeSlip.totalOdds || 0);
      const profit = Math.max(0, payout - val);
      const payEl = document.getElementById("railPayoutDisplay");
      const profEl = document.getElementById("railProfitDisplay");
      if (payEl) payEl.textContent = formatMoney(payout);
      if (profEl) profEl.textContent = `+${formatMoney(profit)}`;
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "oddsFormatSelect") {
      state.oddsFormat = e.target.value;
      saveState();
      renderMainContent();
    } else if (e.target.id === "runinLeagueSelect") {
      const code = e.target.value || "england";
      expandedRuninTeam = null;
      state.activeRuninLeague = code;
      saveState();
      loadRuninLeague(code, false);
      renderMainContent();
    }
  });

  const desktopSearch = document.getElementById("desktopSearchInput");
  if (desktopSearch) {
    desktopSearch.addEventListener("input", (e) => renderSearchDropdown(e.target.value));
    desktopSearch.addEventListener("focus", (e) => {
      if (e.target.value.trim()) renderSearchDropdown(e.target.value);
    });
    desktopSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("searchDropdown")?.classList.add("hidden");
        navigate("/search");
      }
    });
  }

  document.getElementById("subnavPrev")?.addEventListener("click", () => {
    document.getElementById("subnavScroll")?.scrollBy({ left: -320, behavior: "smooth" });
  });
  document.getElementById("subnavNext")?.addEventListener("click", () => {
    document.getElementById("subnavScroll")?.scrollBy({ left: 320, behavior: "smooth" });
  });
  document.getElementById("backToTopBtn")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("hashchange", () => {
    state.route = getRouteFromHash();
    renderAll();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.getElementById("settingsMenu")?.classList.add("hidden");
      document.getElementById("searchDropdown")?.classList.add("hidden");
    }
  });

  // Auto-refresh live scores every 45s when ticker is enabled
  setInterval(() => {
    if (!state.liveTicker) return;
    syncRealtimeFeed(false);
  }, 45000);

  if (window.location.hash) {
    state.route = getRouteFromHash();
  } else if (window.location.pathname && window.location.pathname !== "/") {
    let pRoute = window.location.pathname;
    if (pRoute === "/game-points") pRoute = "/sure-odds";
    if (pRoute === "/community") pRoute = "/power-picks";
    if (pRoute === "/runin" || pRoute === "/run-in-analysis") pRoute = "/run-in";
    const qs = new URLSearchParams(window.location.search || "");
    if (qs.get("tier")) state.activeSureTier = qs.get("tier");
    if (qs.get("tab")) state.activeIntelTab = qs.get("tab").toUpperCase();
    if (qs.get("cat")) state.activePowerCategory = qs.get("cat").toUpperCase();
    if (qs.get("league")) state.activeRuninLeague = qs.get("league").toLowerCase();
    state.route = pRoute;
  } else {
    state.route = "/";
  }
  if (state.route === "/run-in") {
    loadRuninLeague(state.activeRuninLeague || "england");
  }
  renderAll();
  syncRealtimeFeed(false);
  syncBookmakerMismatchFeed(false, false);
})();
