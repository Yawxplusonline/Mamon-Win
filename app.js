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

  function loadState() {
    const defaults = {
      route: "/",
      selectedDate: "UPCOMING_ALL",
      matchFilter: "ALL", // ALL | LIVE | SCHEDULED | DROPS | ALERTS | FOLLOWING | FT
      activeIntelTab: "DROPS", // DROPS | ALERTS | PPG
      activePowerCategory: "ALL", // ALL | STRONG_HOME | STRONG_AWAY | WORST_HOME | WORST_AWAY
      standingsLeague: "england-premier-league",
      followedMatches: [],
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
    sureSlips = RT.buildSureOddsSlips(liveMatches, state.slipSeed);
  }

  function getRouteFromHash() {
    const h = window.location.hash.replace(/^#/, "");
    if (!h || !h.startsWith("/")) return "/";
    if (h === "/game-points") return "/sure-odds";
    if (h === "/community") return "/power-picks";
    return h;
  }

  function navigate(route, push = true) {
    if (!route.startsWith("/")) route = "/" + route;
    if (route.startsWith("/sure-odds?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("tier")) state.activeSureTier = q.get("tier");
      route = "/sure-odds";
    }
    if (route.startsWith("/dropping-odds?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("tab")) state.activeIntelTab = q.get("tab").toUpperCase();
      route = "/dropping-odds";
    }
    if (route.startsWith("/power-picks?")) {
      const q = new URLSearchParams(route.split("?")[1]);
      if (q.get("cat")) state.activePowerCategory = q.get("cat").toUpperCase();
      route = "/power-picks";
    }
    if (route === "/game-points") route = "/sure-odds";
    if (route === "/community") route = "/power-picks";
    state.route = route;
    if (push) {
      window.location.hash = "#" + route;
    }
    saveState();
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

  function renderSubnav() {
    const scrollEl = document.getElementById("subnavScroll");
    const mobileEl = document.getElementById("subnavMobile");
    if (scrollEl && !scrollEl.dataset.populated) {
      scrollEl.innerHTML = LEAGUES.map((l) => {
        const active = state.route === l.href ? " is-active" : "";
        return `<a class="subnav-item${active}" href="${escapeHtml(l.href)}" data-route="${escapeHtml(l.href)}">
          <span class="crest-backed" style="width:20px;height:20px;">${crestImg(l.logo, l.name, "#0A7B5C", 20)}</span>
          ${escapeHtml(l.name)}
        </a>`;
      }).join("");
      scrollEl.dataset.populated = "1";
    } else if (scrollEl) {
      scrollEl.querySelectorAll(".subnav-item").forEach((a) => {
        a.classList.toggle("is-active", a.getAttribute("data-route") === state.route);
      });
    }

    if (mobileEl) {
      const mobileQuick = [
        { label: "Sure Odds", route: "/sure-odds", logo: "/assets/motexiz-mark.svg" },
        { label: "Live/Next", route: "/matches", logo: "/assets/motexiz-mark.svg" },
        ...LEAGUES.filter((l) => l.featured).slice(0, 8)
      ];
      mobileEl.innerHTML = mobileQuick
        .map((item) => {
          const r = item.route || item.href;
          const active = state.route === r ? " is-active" : "";
          return `<a class="subnav-mobile-item${active}" href="${escapeHtml(r)}" data-route="${escapeHtml(r)}">
            <span class="crest-backed" style="width:24px;height:24px;">${crestImg(item.logo, item.label || item.name, "#0A7B5C", 24)}</span>
            <span>${escapeHtml(item.label || item.name)}</span>
          </a>`;
        })
        .join("");
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

        <!-- 11. Run-in Analysis for Both Teams -->
        <div class="factor-tile is-wide">
          <div class="factor-tile-head">
            <span class="factor-name">11. Run-in Analysis (Both Teams)</span>
            <span class="factor-edge-pill">${escapeHtml(f.runInAnalysis.edge)}</span>
          </div>
          <div class="factor-vs-row">
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(home.short)} · ${escapeHtml(f.runInAnalysis.homeStake)}</div>
              <div class="text-xs text-muted">Rest before KO: <strong class="font-mono text-text">${f.runInAnalysis.homeRestDays ? `${f.runInAnalysis.homeRestDays} days` : "Standard"}</strong></div>
              ${
                f.runInAnalysis.homeUpcoming?.length
                  ? `<div class="text-xs mt-1">Next: ${f.runInAnalysis.homeUpcoming.slice(0, 2).map((u) => escapeHtml(u.name)).join(" · ")}</div>`
                  : `<div class="text-xs mt-1 text-muted">Upcoming schedule syncing with live feed</div>`
              }
              ${f.runInAnalysis.calcHome ? `<div class="text-xs mt-1"><strong>Points:</strong> ${escapeHtml(f.runInAnalysis.calcHome.pointsNeeded)}</div><div class="text-xs mt-1"><strong>Draw:</strong> ${escapeHtml(f.runInAnalysis.calcHome.drawImportance)}</div><div class="text-xs mt-1"><strong>Loss Risk:</strong> ${escapeHtml(f.runInAnalysis.calcHome.lossEffect)}</div>` : ""}
            </div>
            <div class="factor-side">
              <div class="side-lbl">${escapeHtml(away.short)} · ${escapeHtml(f.runInAnalysis.awayStake)}</div>
              <div class="text-xs text-muted">Rest before KO: <strong class="font-mono text-text">${f.runInAnalysis.awayRestDays ? `${f.runInAnalysis.awayRestDays} days` : "Standard"}</strong></div>
              ${
                f.runInAnalysis.awayUpcoming?.length
                  ? `<div class="text-xs mt-1">Next: ${f.runInAnalysis.awayUpcoming.slice(0, 2).map((u) => escapeHtml(u.name)).join(" · ")}</div>`
                  : `<div class="text-xs mt-1 text-muted">Upcoming schedule syncing with live feed</div>`
              }
              ${f.runInAnalysis.calcAway ? `<div class="text-xs mt-1"><strong>Points:</strong> ${escapeHtml(f.runInAnalysis.calcAway.pointsNeeded)}</div><div class="text-xs mt-1"><strong>Draw:</strong> ${escapeHtml(f.runInAnalysis.calcAway.drawImportance)}</div><div class="text-xs mt-1"><strong>Loss Risk:</strong> ${escapeHtml(f.runInAnalysis.calcAway.lossEffect)}</div>` : ""}
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
              <span class="sure-pill-tag">${liveMatches.length} LIVE &amp; UPCOMING MATCHES</span>
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
                      return `
                        <button type="button" class="sure-leg-mini" data-match-id="${leg.match.id}" data-open-analysis="1">
                          <div class="min-w-0">
                            <div class="font-semibold truncate">${escapeHtml(h.short)} vs ${escapeHtml(a.short)} <span class="text-muted">(${escapeHtml(leg.match.status === "LIVE" ? leg.match.displayTime : leg.match.displayTime)})</span></div>
                            <div class="truncate" style="font-size:11px;color:#A8C6BC;">${escapeHtml(leg.market.label)}</div>
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
          <span class="sure-pill-tag">REAL-TIME LIVE &amp; UPCOMING ONLY</span>
          <span class="sure-pill-tag">11-FACTOR ENGINE</span>
        </div>
        <h1 class="mt-2">Sure Odds Builder (2 to 1,000,000 Odds)</h1>
        <p>${escapeHtml(slip.subtitle || "Multi-factor football slips analyzed across H2H, Current Form, Injuries, Suspensions, Last 5 Home/Away Games, Goals Scored/Conceded, Clean Sheets & Run-in Schedule.")}</p>

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
                            ${m.status === "LIVE" ? `● LIVE ${escapeHtml(m.displayTime)} (${m.homeScore}-${m.awayScore})` : `${escapeHtml(m.date)} · ${escapeHtml(m.displayTime)}`}
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
                            <span class="text-xs font-bold uppercase tracking-wide text-brand">Sure Pick:</span>
                            <span class="font-bold text-sm text-text">${escapeHtml(leg.market.label)}</span>
                            <span class="text-xs font-mono text-muted">· Model Conf ${conf}%</span>
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
    const isFollowed = state.followedMatches.includes(m.id);
    const isLive = m.status === "LIVE";
    const isFT = m.status === "FT";
    const hasScore = isLive || isFT;
    const homeWon = isFT && m.homeScore > m.awayScore;
    const awayWon = isFT && m.awayScore > m.homeScore;
    const bestLabel = m.analysis?.bestPick?.code || "1X";

    const redBadges = (count) =>
      count > 0 ? `<span class="red-cards" title="Red card">${"<span></span>".repeat(count)}</span>` : "";

    const starSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

    const bestDrop = m.droppingOdds?.bestDrop;
    const dropChipHtml = bestDrop && bestDrop.dropPct >= 2.0
      ? `<span class="drop-badge" title="Dropping Odds: ${bestDrop.openOdd.toFixed(2)} -> ${bestDrop.currentOdd.toFixed(2)}">▼ ${escapeHtml(bestDrop.code)} -${bestDrop.dropPct}%</span>`
      : "";
    const ppgHome = m.ppgSummary?.homeOverall ?? m.analysis?.factors?.ppg?.homeOverall;
    const ppgAway = m.ppgSummary?.awayOverall ?? m.analysis?.factors?.ppg?.awayOverall;
    const ppgText = Number.isFinite(ppgHome) && Number.isFinite(ppgAway) ? `PPG ${ppgHome.toFixed(1)}-${ppgAway.toFixed(1)}` : "";
    const hasInjSusp = Boolean(
      m.analysis?.factors?.injuries?.home?.length ||
      m.analysis?.factors?.injuries?.away?.length ||
      m.analysis?.factors?.suspensions?.home?.length ||
      m.analysis?.factors?.suspensions?.away?.length
    );

    return `
      <div class="match-row" data-match-id="${m.id}">
        <button class="follow-btn${isFollowed ? " is-followed" : ""}" type="button" data-follow-match="${m.id}" aria-label="${isFollowed ? "Unfollow" : "Follow"} ${escapeHtml(home.name)} vs ${escapeHtml(away.name)}" title="Follow match">
          ${starSvg}
        </button>

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
              <span class="team-score${isLive ? " is-live" : ""}">${hasScore ? m.homeScore : "-"}</span>
            </div>
            <div class="match-mobile-team">
              ${crestImg(away.logo, away.name, away.color, 20)}
              <span class="team-name${awayWon ? " team-winner" : ""}">${escapeHtml(away.name)}</span>
              ${redBadges(m.awayRed)}
              <span class="team-score${isLive ? " is-live" : ""}">${hasScore ? m.awayScore : "-"}</span>
            </div>
            ${
              dropChipHtml || ppgText
                ? `<div class="match-mobile-meta">
                    ${ppgText ? `<span class="ppg-chip">${escapeHtml(ppgText)}</span>` : ""}
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
            ${hasScore ? `${m.homeScore} - ${m.awayScore}` : "vs"}
          </div>
          <div class="team-away">
            ${crestImg(away.logo, away.name, away.color, 19)}
            <span class="team-name${awayWon ? " team-winner" : ""}">${escapeHtml(away.name)}</span>
            ${redBadges(m.awayRed)}
          </div>
          <div class="chevron">
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
                        ${isLive ? `${m.homeScore} : ${m.awayScore}` : m.displayTime}
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

  function renderMatchesPanel(matchesList, title = "Live & Upcoming Matches", showToolbar = true, allowCompletedToggle = false) {
    // By default ONLY show active LIVE or SCHEDULED real-time fixtures; never dead past matches
    const sourcePool = state.matchFilter === "FT" && allowCompletedToggle ? finishedTodayMatches : matchesList;

    const filtered = sourcePool.filter((m) => {
      if (state.matchFilter === "LIVE") return m.status === "LIVE";
      if (state.matchFilter === "SCHEDULED") return m.status === "SCHEDULED";
      if (state.matchFilter === "DROPS") return m.status !== "FT" && Boolean(m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 2.0);
      if (state.matchFilter === "ALERTS") return m.status !== "FT" && Boolean(m.analysis?.factors?.suspensions?.hasAlert || m.analysis?.factors?.injuries?.home?.length || m.analysis?.factors?.injuries?.away?.length);
      if (state.matchFilter === "FT") return m.status === "FT";
      if (state.matchFilter === "FOLLOWING") {
        return (
          state.followedMatches.includes(m.id) ||
          state.followedClubs.includes(m.home) ||
          state.followedClubs.includes(m.away) ||
          state.followedLeagues.includes(m.leagueSlug)
        );
      }
      return m.status !== "FT";
    });

    const groups = new Map();
    filtered.forEach((m) => {
      const k = `${m.leagueSlug}||${m.leagueName || ""}`;
      if (!groups.has(k)) groups.set(k, { sample: m, items: [] });
      groups.get(k).items.push(m);
    });

    const liveCount = matchesList.filter((m) => m.status === "LIVE").length;
    const schedCount = matchesList.filter((m) => m.status === "SCHEDULED").length;
    const dropsCount = matchesList.filter((m) => m.status !== "FT" && m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 2.0).length;
    const alertsCount = matchesList.filter((m) => m.status !== "FT" && (m.analysis?.factors?.suspensions?.hasAlert || m.analysis?.factors?.injuries?.home?.length || m.analysis?.factors?.injuries?.away?.length)).length;

    const filterChips = [
      { id: "ALL", label: `Live & Upcoming (${liveCount + schedCount})` },
      { id: "LIVE", label: `Live Now (${liveCount})` },
      { id: "DROPS", label: `Dropping Odds (${dropsCount})` },
      { id: "ALERTS", label: `Inj/Susp (${alertsCount})` },
      { id: "SCHEDULED", label: `Upcoming (${schedCount})` },
      { id: "FOLLOWING", label: `Following (${state.followedMatches.length})` }
    ];
    if (allowCompletedToggle && finishedTodayMatches.length > 0) {
      filterChips.push({ id: "FT", label: `Completed Today (${finishedTodayMatches.length})` });
    }

    const toolbarHtml = showToolbar
      ? `
        <div class="toolbar-card">
          <div class="date-strip" role="tablist" aria-label="Upcoming matchdays">
            ${(DATA.DATES || [])
              .map(
                (d) => `<button type="button" class="date-pill${state.selectedDate === d.id ? " is-active" : ""}" data-date="${d.id}">${escapeHtml(d.label)}</button>`
              )
              .join("")}
          </div>
          <div class="filter-row">
            <div class="filter-chips">
              ${filterChips
                .map(
                  (f) => `<button type="button" class="filter-chip${state.matchFilter === f.id ? " is-active" : ""}" data-filter="${f.id}">${f.id === "LIVE" && liveCount > 0 ? '<span class="live-dot"></span>' : ""}${escapeHtml(f.label)}</button>`
                )
                .join("")}
            </div>
            <button type="button" class="refresh-btn" id="refreshMatchesBtn" title="Sync real-time scores from ESPN">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
              Sync Live
            </button>
          </div>
        </div>
      `
      : "";

    let groupsHtml = "";
    if (isLoadingRealtime && liveMatches.length === 0) {
      groupsHtml = `
        <div class="p-4 flex flex-col gap-3">
          ${[1, 2, 3, 4, 5].map(() => `<div data-skeleton style="height:52px;"><div data-skeleton-band></div></div>`).join("")}
        </div>
      `;
    } else if (groups.size === 0) {
      groupsHtml = `
        <div class="empty-state">
          <h3>No matches match this filter</h3>
          <p class="text-sm">Switch to "All Live &amp; Upcoming" to view every active global fixture.</p>
        </div>
      `;
    } else {
      for (const { sample, items } of groups.values()) {
        const lg = getLeagueInfo(sample);
        groupsHtml += `
          <div>
            <a class="match-league-header" href="${escapeHtml(lg.href)}" data-route="${escapeHtml(lg.href)}">
              <span class="crest-backed" style="width:20px;height:20px;">${crestImg(lg.logo, lg.name, "#0A7B5C", 20)}</span>
              <span class="league-name">${escapeHtml(lg.name)}</span>
              <span class="match-league-country">${escapeHtml(lg.country || "")}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="m9 18 6-6-6-6"/></svg>
            </a>
            ${items.map(renderMatchRow).join("")}
          </div>
        `;
      }
    }

    return `
      ${toolbarHtml}
      <section class="panel" id="matchesPanel">
        <div class="panel-header">
          ${liveCount > 0 ? '<span class="live-dot"></span>' : ""}
          <h2>${escapeHtml(title)}</h2>
          <span class="count">${filtered.length} real-time</span>
          <a class="see-all" href="/matches" data-route="/matches">
            Full schedule
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </a>
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
          <a class="btn-full" href="/sure-odds" data-route="/sure-odds">Open Sure Odds Analyzer</a>
          <a class="btn-outline" href="/dropping-odds" data-route="/dropping-odds">Dropping Odds, Inj &amp; PPG</a>
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
  function renderRightRail() {
    const rail = document.getElementById("railRight");
    if (!rail) return;

    const featuredNews = (DATA.NEWS || []).find((n) => n.featured) || (DATA.NEWS || [])[0];
    const otherNews = (DATA.NEWS || []).filter((n) => n.id !== featuredNews?.id).slice(0, 5);
    const activeSlip = sureSlips[state.activeSureTier || "2"] || { title: "2 Sure Odds", legs: [], totalOdds: 0 };
    const payout = (Number(state.stakeAmount) || 0) * (activeSlip.totalOdds || 0);

    rail.innerHTML = `
      <div class="sidebar-card">
        <div class="flex items-center justify-between">
          <h2>${escapeHtml(activeSlip.title)} Slip</h2>
          <span class="font-mono text-xs font-bold text-brand">${formatOdds(activeSlip.totalOdds)}x</span>
        </div>
        <p>Real-time multi-factor selections (${activeSlip.legs.length} legs). Stake ${formatMoney(state.stakeAmount)} to win <strong class="text-brand">${formatMoney(payout)}</strong>.</p>
        <div class="quick-predict-box">
          ${
            activeSlip.legs.length === 0
              ? `<div class="text-xs text-muted">Syncing real-time fixtures...</div>`
              : `<div class="flex flex-col gap-1.5">
                  ${activeSlip.legs
                    .slice(0, 4)
                    .map((l) => {
                      const h = getTeam(l.match.home);
                      const a = getTeam(l.match.away);
                      return `<div class="flex items-center justify-between text-xs gap-2" data-match-id="${l.match.id}" data-open-analysis="1" style="cursor:pointer;">
                        <span class="truncate font-semibold">${escapeHtml(h.short)} vs ${escapeHtml(a.short)} · <span class="text-brand">${escapeHtml(l.market.code)}</span></span>
                        <span class="font-mono font-bold shrink-0">@${l.market.odds.toFixed(2)}</span>
                      </div>`;
                    })
                    .join("")}
                </div>`
          }
        </div>
        <div class="btn-group">
          <a class="btn-full" href="/sure-odds" data-route="/sure-odds">Inspect Factors &amp; Stake</a>
          <a class="btn-outline" href="/power-picks" data-route="/power-picks">Strong &amp; Worst Teams Today</a>
        </div>
      </div>

      <section class="news-card">
        <div class="news-card-header">
          <h2>Matchday Intelligence</h2>
          <a href="/power-picks" data-route="/power-picks">Strong/Worst</a>
        </div>
        ${
          featuredNews
            ? `<article class="news-featured" data-news-id="${featuredNews.id}">
                <h3>${escapeHtml(featuredNews.title)}</h3>
                <div class="meta">
                  <span class="source">${escapeHtml(featuredNews.source)}</span>
                  <span>·</span>
                  <span>${escapeHtml(featuredNews.time)}</span>
                </div>
              </article>`
            : ""
        }
        <ul class="news-list">
          ${otherNews
            .map(
              (n) => `<li>
                <a href="#news-${n.id}" data-news-id="${n.id}">
                  <div class="flex-1 min-w-0">
                    <div class="news-title">${escapeHtml(n.title)}</div>
                    <div class="meta">
                      <span class="source">${escapeHtml(n.source)}</span>
                      <span>·</span>
                      <span>${escapeHtml(n.time)}</span>
                    </div>
                  </div>
                  <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </a>
              </li>`
            )
            .join("")}
        </ul>
      </section>
    `;
  }

  function filteredMatchesForDate() {
    if (state.selectedDate === "UPCOMING_ALL") return liveMatches;
    return liveMatches.filter((m) => m.date === state.selectedDate);
  }

  // ============ HOME MARKET INTELLIGENCE STRIP (DROPPING ODDS, INJURIES, SUSPENSIONS, PPG) ============
  function renderMarketIntelligenceStrip() {
    const active = liveMatches.filter((m) => m.status !== "FT");
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
          <a class="intel-stat-tile" href="/dropping-odds?tab=DROPS" data-route="/dropping-odds?tab=DROPS">
            <span class="tile-kicker">BOOKMAKER STEAM</span>
            <span class="tile-val text-brand">${dropMatches.length} Dropping Odds</span>
            <span class="tile-sub">${dropMatches[0] ? `Top ${dropMatches[0].status === "SCHEDULED" ? "Pre-Match" : "Live"}: ${getTeam(dropMatches[0].home).short}v${getTeam(dropMatches[0].away).short} ▼ -${dropMatches[0].droppingOdds.bestDrop.dropPct}%` : "Tracking open -> latest odds"}</span>
          </a>

          <a class="intel-stat-tile" href="/dropping-odds?tab=ALERTS" data-route="/dropping-odds?tab=ALERTS">
            <span class="tile-kicker">SQUAD AVAILABILITY</span>
            <span class="tile-val" style="color:var(--live);">${alertMatches.length} Inj &amp; Sus Watch</span>
            <span class="tile-sub">Red cards, 4+ YC bans &amp; squad reports</span>
          </a>

          <a class="intel-stat-tile" href="/dropping-odds?tab=PPG" data-route="/dropping-odds?tab=PPG">
            <span class="tile-kicker">POINTS PER GAME</span>
            <span class="tile-val">${ppgMatches[0]?.ppgSummary ? `${ppgMatches[0].ppgSummary.homeOverall.toFixed(2)} vs ${ppgMatches[0].ppgSummary.awayOverall.toFixed(2)}` : "Live PPG"}</span>
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

  // ============ DEDICATED /dropping-odds SCANNER VIEW (DROPS, INJURIES, SUSPENSIONS, PPG) ============
  function renderDroppingOddsView() {
    const activeTab = state.activeIntelTab || "DROPS";
    const active = liveMatches.filter((m) => m.status !== "FT");

    const dropRank = (m) => (m.status === "SCHEDULED" ? 1000 : 0) + (m.droppingOdds?.bestDrop?.dropPct || 0);
    const dropList = active
      .filter((m) => m.droppingOdds?.bestDrop && m.droppingOdds.bestDrop.dropPct >= 1.5)
      .sort((a, b) => dropRank(b) - dropRank(a));

    const alertList = active
      .filter((m) =>
        Boolean(
          m.analysis?.factors?.suspensions?.hasAlert ||
          m.analysis?.factors?.injuries?.home?.length ||
          m.analysis?.factors?.injuries?.away?.length
        )
      )
      .sort((a, b) => {
        const score = (m) =>
          (m.analysis?.factors?.injuries?.home?.length || 0) +
          (m.analysis?.factors?.injuries?.away?.length || 0) +
          (m.analysis?.factors?.suspensions?.home?.length || 0) * 2 +
          (m.analysis?.factors?.suspensions?.away?.length || 0) * 2 +
          (m.analysis?.factors?.suspensions?.homeRedSeason || 0) +
          (m.analysis?.factors?.suspensions?.awayRedSeason || 0);
        return score(b) - score(a);
      });

    const ppgList = [...active].sort(
      (a, b) => (b.analysis?.factors?.ppg?.gap || 0) - (a.analysis?.factors?.ppg?.gap || 0)
    );

    let bodyHtml = "";
    if (activeTab === "DROPS") {
      bodyHtml = dropList.length === 0
        ? `<div class="empty-state"><h3>Syncing live open vs close market odds...</h3><p class="text-sm">Active DraftKings open &amp; latest odds movements appear here as pre-match liquidity moves.</p></div>`
        : dropList
            .slice(0, 45)
            .map((m) => {
              const h = getTeam(m.home, "Home");
              const a = getTeam(m.away, "Away");
              const lg = getLeagueInfo(m);
              const d = m.droppingOdds.bestDrop;
              const fPpg = m.analysis?.factors?.ppg;
              return `
                <div class="intel-row-card" data-match-id="${m.id}">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2 min-w-0">
                      ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
                      <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
                      <span class="text-xs font-mono text-muted">· ${m.status === "LIVE" ? `LIVE ${escapeHtml(m.displayTime)}` : `${escapeHtml(m.date)} ${escapeHtml(m.displayTime)}`}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="ppg-chip">${m.status === "LIVE" ? "IN-PLAY" : "PRE-MATCH"}</span>
                      <span class="drop-badge">▼ ${escapeHtml(d.code)} DROPPED -${d.dropPct}%</span>
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
                    <div class="flex items-center gap-2">
                      <span class="ppg-chip">PPG: ${fPpg ? `${fPpg.homeOverall.toFixed(2)} - ${fPpg.awayOverall.toFixed(2)}` : "-"}</span>
                      <button type="button" class="analyze-inline-btn" data-match-id="${m.id}">Full Analysis</button>
                    </div>
                  </div>

                  <div class="sure-pick-box">
                    <div class="text-xs">
                      <span class="font-bold text-brand uppercase">Dropping Market:</span>
                      <strong class="ml-1">${escapeHtml(d.label)}</strong>
                      <span class="text-muted ml-2">(Implied Prob Shift: <strong class="text-brand">+${d.impliedShiftPct}%</strong> · Provider: ${escapeHtml(m.droppingOdds.provider)})</span>
                    </div>
                    <div class="font-mono text-sm">
                      <span class="text-muted" style="text-decoration:line-through;">${d.openOdd.toFixed(2)}</span>
                      &nbsp;&rarr;&nbsp;
                      <strong class="text-brand">${d.currentOdd.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>
              `;
            })
            .join("");
    } else if (activeTab === "ALERTS") {
      bodyHtml = alertList.length === 0
        ? `<div class="empty-state"><h3>Hydrating live team rosters &amp; disciplinary cards...</h3><p class="text-sm">Click any match or tap Sync Live to inspect squad yellow/red card bans &amp; injury watchlists.</p></div>`
        : alertList
            .slice(0, 45)
            .map((m) => {
              const h = getTeam(m.home, "Home");
              const a = getTeam(m.away, "Away");
              const lg = getLeagueInfo(m);
              const inj = m.analysis?.factors?.injuries || { home: [], away: [] };
              const susp = m.analysis?.factors?.suspensions || { home: [], away: [], homeRedSeason: 0, awayRedSeason: 0 };
              return `
                <div class="intel-row-card" data-match-id="${m.id}">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2 min-w-0">
                      ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
                      <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
                      <span class="text-xs font-mono text-muted">· ${escapeHtml(m.date)} ${escapeHtml(m.displayTime)}</span>
                    </div>
                    <span class="alert-badge">RC: ${susp.homeRedSeason} vs ${susp.awayRedSeason} · ${(inj.home.length + inj.away.length)} Inj / ${(susp.home.length + susp.away.length)} Sus</span>
                  </div>

                  <div class="flex items-center justify-between gap-2 flex-wrap mt-2">
                    <div class="flex items-center gap-2">
                      ${crestImg(h.logo, h.name, h.color, 22)}
                      <span class="font-bold text-sm">${escapeHtml(h.name)}</span>
                      <span class="text-xs text-muted">vs</span>
                      <span class="font-bold text-sm">${escapeHtml(a.name)}</span>
                      ${crestImg(a.logo, a.name, a.color, 22)}
                    </div>
                    <button type="button" class="analyze-inline-btn" data-hydrate-match="${m.id}">↻ Sync Full Roster Cards</button>
                  </div>

                  <div class="factor-vs-row mt-2">
                    <div class="factor-side">
                      <div class="side-lbl">${escapeHtml(h.short)} Injuries &amp; Suspensions</div>
                      <div class="text-xs"><strong>Injuries:</strong> ${inj.home.length ? inj.home.map(escapeHtml).join(" · ") : "None flagged"}</div>
                      <div class="text-xs mt-1"><strong>Suspensions / Cards:</strong> ${susp.home.length ? susp.home.map(escapeHtml).join(" · ") : `${susp.homeRedSeason} season red cards`}</div>
                    </div>
                    <div class="factor-side">
                      <div class="side-lbl">${escapeHtml(a.short)} Injuries &amp; Suspensions</div>
                      <div class="text-xs"><strong>Injuries:</strong> ${inj.away.length ? inj.away.map(escapeHtml).join(" · ") : "None flagged"}</div>
                      <div class="text-xs mt-1"><strong>Suspensions / Cards:</strong> ${susp.away.length ? susp.away.map(escapeHtml).join(" · ") : `${susp.awayRedSeason} season red cards`}</div>
                    </div>
                  </div>
                </div>
              `;
            })
            .join("");
    } else {
      bodyHtml = ppgList
        .slice(0, 45)
        .map((m) => {
          const h = getTeam(m.home, "Home");
          const a = getTeam(m.away, "Away");
          const lg = getLeagueInfo(m);
          const ppg = m.analysis?.factors?.ppg || { homeOverall: 1.5, awayOverall: 1.3, homeHomePpg: 1.7, awayAwayPpg: 1.1, gap: 0.2, edge: h.short };
          const best = m.analysis?.bestPick;
          return `
            <div class="intel-row-card" data-match-id="${m.id}">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  ${crestImg(lg.logo, lg.name, "#0A7B5C", 18)}
                  <span class="text-xs font-semibold text-text-secondary truncate">${escapeHtml(lg.name)}</span>
                  <span class="text-xs font-mono text-muted">· ${escapeHtml(m.date)} ${escapeHtml(m.displayTime)}</span>
                </div>
                <span class="factor-edge-pill">PPG Edge: ${escapeHtml(ppg.edge)} (+${ppg.gap.toFixed(2)})</span>
              </div>

              <div class="factor-vs-row mt-2">
                <div class="factor-side">
                  <div class="flex items-center gap-2">
                    ${crestImg(h.logo, h.name, h.color, 18)}
                    <span class="font-bold text-sm truncate">${escapeHtml(h.name)}</span>
                  </div>
                  <div class="text-xs mt-1">Overall PPG: <strong class="font-mono text-brand">${ppg.homeOverall.toFixed(2)}</strong> · Home PPG: <strong class="font-mono">${ppg.homeHomePpg !== null ? ppg.homeHomePpg.toFixed(2) : "-"}</strong></div>
                </div>
                <div class="factor-side">
                  <div class="flex items-center gap-2">
                    ${crestImg(a.logo, a.name, a.color, 18)}
                    <span class="font-bold text-sm truncate">${escapeHtml(a.name)}</span>
                  </div>
                  <div class="text-xs mt-1">Overall PPG: <strong class="font-mono text-brand">${ppg.awayOverall.toFixed(2)}</strong> · Away PPG: <strong class="font-mono">${ppg.awayAwayPpg !== null ? ppg.awayAwayPpg.toFixed(2) : "-"}</strong></div>
                </div>
              </div>

              ${best ? `<div class="text-xs mt-2 text-text-secondary">Sure Pick aligned with PPG: <strong class="text-brand">${escapeHtml(best.label)} @ ${best.odds.toFixed(2)}</strong> (${Math.round(best.prob * 100)}% prob)</div>` : ""}
            </div>
          `;
        })
        .join("");
    }

    return `
      <div class="hero-banner">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="sure-pill-tag">OPEN -> CURRENT ODDS STEAM</span>
          <span class="sure-pill-tag">INJURIES · SUSPENSIONS · PPG</span>
        </div>
        <h1 class="mt-2">Dropping Odds, Injuries, Suspensions &amp; PPG Scanner</h1>
        <p>Live market steam tracking DraftKings open vs current prices, ESPN roster card bans/suspensions, injury watchlists, and Overall / Home / Away Points Per Game (PPG).</p>
      </div>

      <section class="panel">
        <div class="intel-tabs">
          <button type="button" class="filter-chip${activeTab === "DROPS" ? " is-active" : ""}" data-intel-tab="DROPS">Dropping Odds (${dropList.length})</button>
          <button type="button" class="filter-chip${activeTab === "ALERTS" ? " is-active" : ""}" data-intel-tab="ALERTS">Injuries &amp; Suspensions (${alertList.length})</button>
          <button type="button" class="filter-chip${activeTab === "PPG" ? " is-active" : ""}" data-intel-tab="PPG">PPG Power Edges (${ppgList.length})</button>
        </div>
        <div>${bodyHtml}</div>
      </section>
    `;
  }

  // ============ STRONG & WORST TEAMS TODAY (REPLACES COMMUNITY SECTION) ============
  function renderTodayPowerPreviewCard() {
    if (!RT?.buildTodayPowerRankings || liveMatches.length === 0) return "";
    const p = RT.buildTodayPowerRankings(liveMatches);
    const quads = [
      { key: "STRONG_HOME", title: "STRONG HOME TODAY", item: p.strongHome[0], isStrong: true },
      { key: "STRONG_AWAY", title: "STRONG AWAY TODAY", item: p.strongAway[0], isStrong: true },
      { key: "WORST_HOME", title: "WORST HOME TODAY", item: p.worstHome[0], isStrong: false },
      { key: "WORST_AWAY", title: "WORST AWAY TODAY", item: p.worstAway[0], isStrong: false }
    ];
    return `
      <section class="panel" id="powerPicksHomeCard">
        <div class="panel-header">
          <span class="live-dot" style="background:var(--brand);"></span>
          <h2>Strong &amp; Worst Teams Today</h2>
          <a class="see-all" href="/power-picks" data-route="/power-picks">
            All 4 Lists
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </a>
        </div>
        <div class="power-preview-grid">
          ${quads
            .map((q) => {
              const x = q.item;
              if (!x) {
                return `<a class="power-preview-tile${q.isStrong ? " is-strong" : " is-worst"}" href="/power-picks?cat=${q.key}" data-route="/power-picks?cat=${q.key}">
                  <span class="tile-kicker">${q.title}</span>
                  <span class="text-xs text-muted">No clear candidate yet</span>
                </a>`;
              }
              const scoreVal = q.isStrong ? x.strongScore : x.worstScore;
              return `
                <a class="power-preview-tile${q.isStrong ? " is-strong" : " is-worst"}" href="/power-picks?cat=${q.key}" data-route="/power-picks?cat=${q.key}">
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

  function renderHomeView() {
    const dayMatches = filteredMatchesForDate();
    const activeDateObj = (DATA.DATES || []).find((d) => d.id === state.selectedDate);
    const heading = state.selectedDate === "UPCOMING_ALL" ? "Real-Time Live & Upcoming Matches" : `Fixtures · ${activeDateObj ? activeDateObj.label : state.selectedDate}`;
    return `
      ${renderHomeSureOddsBanner()}
      ${renderMarketIntelligenceStrip()}
      ${renderTodayPowerPreviewCard()}
      ${renderMustWatchSection()}
      ${renderMatchesPanel(dayMatches, heading, true, false)}
      ${renderStandingsPanel()}
    `;
  }

  function renderMatchesView() {
    const dayMatches = filteredMatchesForDate();
    const activeDateObj = (DATA.DATES || []).find((d) => d.id === state.selectedDate);
    return `
      <div class="hero-banner">
        <h1>Real-Time Match Center</h1>
        <p>Strict live &amp; upcoming fixtures feed — zero stale or past dead games. Click any fixture for full 13-Factor Scouting &amp; Sure Odds.</p>
      </div>
      ${renderMatchesPanel(dayMatches, state.selectedDate === "UPCOMING_ALL" ? "Live & Upcoming Schedule" : `Fixtures · ${activeDateObj ? activeDateObj.label : state.selectedDate}`, true, true)}
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

  function renderPowerPicksView() {
    if (!RT?.buildTodayPowerRankings) {
      return `<div class="empty-state"><h3>Initializing Team Power Engine...</h3></div>`;
    }
    const power = RT.buildTodayPowerRankings(liveMatches);
    const activeCat = state.activePowerCategory || "ALL";

    // Hydrate city weather for visible picks cleanly once per load
    if (!isHydratingPowerWeather && RT.hydrateWeatherForMatches) {
      const visibleMatches = [
        ...power.strongHome.slice(0, 10),
        ...power.strongAway.slice(0, 10),
        ...power.worstHome.slice(0, 10),
        ...power.worstAway.slice(0, 10)
      ]
        .map((x) => x.match)
        .filter((m) => m.venueCity && !m.weather?.ok);
      if (visibleMatches.length > 0) {
        isHydratingPowerWeather = true;
        RT.hydrateWeatherForMatches(visibleMatches).then((changed) => {
          isHydratingPowerWeather = false;
          if (changed && state.route === "/power-picks") renderMainContent();
        });
      }
    }

    const blocks = [];
    if (activeCat === "ALL" || activeCat === "STRONG_HOME") {
      blocks.push(
        renderPowerSection(
          "Strong Teams to Play Home Today",
          "Ranked by Home Form, Goal Scoring Power, Home PPG, Injuries/Suspensions, H2H, Weather, League Table & Points Calculations.",
          power.strongHome,
          true
        )
      );
    }
    if (activeCat === "ALL" || activeCat === "STRONG_AWAY") {
      blocks.push(
        renderPowerSection(
          "Strong Teams to Play Away Today",
          "Road clubs dominating on Away PPG, Away Form, Attacking Power, H2H, Squad Fitness, Weather & Title/Qualification Urgency.",
          power.strongAway,
          true
        )
      );
    }
    if (activeCat === "ALL" || activeCat === "WORST_HOME") {
      blocks.push(
        renderPowerSection(
          "Worst Teams to Play Home Today",
          "Vulnerable home sides flagged by Poor Form, Low Scoring / High Conceding, Low Home PPG, Injuries/Suspensions, Table Danger & Adverse Conditions.",
          power.worstHome,
          false
        )
      );
    }
    if (activeCat === "ALL" || activeCat === "WORST_AWAY") {
      blocks.push(
        renderPowerSection(
          "Worst Teams to Play Away Today",
          "Struggling away travelers facing tough home grounds with Poor Away PPG, Leaky Defenses, Squad Absences, Standing Drop Risk & H2H Deficit.",
          power.worstAway,
          false
        )
      );
    }

    return `
      <div class="hero-banner">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="sure-pill-tag">${escapeHtml(power.scopeLabel)} · ${power.totalEvaluated} FIXTURES EVALUATED</span>
          <span class="sure-pill-tag">13 CRITERIA + LIVE CITY WEATHER + POINTS MATH</span>
        </div>
        <h1 class="mt-2">Strong &amp; Worst Teams Today (Home &amp; Away)</h1>
        <p>Evaluated across Form, Goal Scoring Power, PPG, Injuries, Suspensions, Home/Away Advantage, Weather Conditions, Head-to-Head, League Standing, Points Needed, Draw Importance, Loss Table Impact &amp; Club Histories.</p>

        <div class="intel-tabs mt-3" style="border-radius:var(--radius-md);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);">
          <button type="button" class="filter-chip${activeCat === "ALL" ? " is-active" : ""}" data-power-cat="ALL">All 4 Lists</button>
          <button type="button" class="filter-chip${activeCat === "STRONG_HOME" ? " is-active" : ""}" data-power-cat="STRONG_HOME">Strong Home (${power.strongHome.length})</button>
          <button type="button" class="filter-chip${activeCat === "STRONG_AWAY" ? " is-active" : ""}" data-power-cat="STRONG_AWAY">Strong Away (${power.strongAway.length})</button>
          <button type="button" class="filter-chip${activeCat === "WORST_HOME" ? " is-active" : ""}" data-power-cat="WORST_HOME">Worst Home (${power.worstHome.length})</button>
          <button type="button" class="filter-chip${activeCat === "WORST_AWAY" ? " is-active" : ""}" data-power-cat="WORST_AWAY">Worst Away (${power.worstAway.length})</button>
        </div>
      </div>

      ${blocks.join("")}
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
            <div class="text-xs text-muted mt-1">Real-time live &amp; upcoming fixtures · 11-Factor Analytics</div>
          </div>
          <button type="button" class="btn-primary-pill${isFollowed ? " is-active-state" : ""}" data-follow-league="${escapeHtml(slug)}">
            ${isFollowed ? "Following ✓" : "Follow Competition"}
          </button>
        </div>
      </div>

      ${
        matches.length > 0
          ? renderMatchesPanel(matches, `${lg.name} Live & Upcoming`, false, false)
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

      ${matchedLive.length > 0 ? renderMatchesPanel(matchedLive, `Matching Live & Upcoming (${matchedLive.length})`, false, false) : ""}

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
    } else if (r === "/sure-odds" || r === "/game-points") {
      main.innerHTML = renderSureOddsView();
      bindSureCalculatorEvents();
    } else if (r === "/dropping-odds") {
      main.innerHTML = renderDroppingOddsView();
    } else if (r === "/matches") {
      main.innerHTML = renderMatchesView();
    } else if (r === "/power-picks" || r === "/community") {
      main.innerHTML = renderPowerPicksView();
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
                <span class="text-xs font-bold uppercase tracking-wide text-brand">Recommended Sure Pick:</span>
                <span class="font-bold text-sm text-text">${best ? escapeHtml(best.label) : "1X / Over 1.5"}</span>
                ${best ? `<span class="text-xs font-mono text-muted">· ${Math.round(best.prob * 100)}% Prob · xG ${a.expectedGoals.home}-${a.expectedGoals.away}</span>` : ""}
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
            <div class="predict-btn-group">
              <div class="predict-choice-btn"><span>1 · ${escapeHtml(home.short)}</span><span class="font-mono text-xs text-brand">${formatOdds(m.odds?.home)}</span></div>
              <div class="predict-choice-btn"><span>X · Draw</span><span class="font-mono text-xs text-brand">${formatOdds(m.odds?.draw)}</span></div>
              <div class="predict-choice-btn"><span>2 · ${escapeHtml(away.short)}</span><span class="font-mono text-xs text-brand">${formatOdds(m.odds?.away)}</span></div>
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
            ${hasScore ? `${m.homeScore} - ${m.awayScore}` : "VS"}
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
            <span class="font-mono text-xs text-brand">${m.status === "LIVE" ? `${m.homeScore}-${m.awayScore}` : m.displayTime}</span>
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
  async function syncRealtimeFeed(showSuccessToast = false) {
    if (!RT) return;
    try {
      const res = await RT.load((updatedActive) => {
        liveMatches = updatedActive;
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
      liveMatches = res.activeMatches || [];
      finishedTodayMatches = res.finishedToday || [];
      lastSyncIso = res.fetchedAt;
      isLoadingRealtime = false;
      recomputeSlips();
      renderAll();
      if (showSuccessToast) {
        showToast(`Synced ${liveMatches.length} real-time live & upcoming matches.`);
      }
    } catch {
      isLoadingRealtime = false;
      renderAll();
    }
  }

  // ============ GLOBAL EVENT DELEGATION ============
  document.addEventListener("click", (e) => {
    // Tier jump links in footer
    const tierJump = e.target.closest("[data-tier-jump]");
    if (tierJump) {
      e.preventDefault();
      state.activeSureTier = tierJump.getAttribute("data-tier-jump");
      navigate("/sure-odds");
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

    // Switch Dropping Odds / Injuries / PPG Intelligence Tab
    const intelTabBtn = e.target.closest("[data-intel-tab]");
    if (intelTabBtn) {
      state.activeIntelTab = intelTabBtn.getAttribute("data-intel-tab");
      saveState();
      renderMainContent();
      return;
    }

    // Switch Strong & Worst Teams Today Category
    const powerCatBtn = e.target.closest("[data-power-cat]");
    if (powerCatBtn) {
      state.activePowerCategory = powerCatBtn.getAttribute("data-power-cat");
      saveState();
      renderMainContent();
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

    // Follow match star
    const followBtn = e.target.closest("[data-follow-match]");
    if (followBtn) {
      e.stopPropagation();
      const id = followBtn.getAttribute("data-follow-match");
      if (state.followedMatches.includes(id)) {
        state.followedMatches = state.followedMatches.filter((x) => x !== id);
        showToast("Removed match from Following");
      } else {
        state.followedMatches.push(id);
        showToast("Match pinned to Following ★");
      }
      saveState();
      renderAll();
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

  document.addEventListener("change", (e) => {
    if (e.target.id === "oddsFormatSelect") {
      state.oddsFormat = e.target.value;
      saveState();
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
    const qs = new URLSearchParams(window.location.search || "");
    if (qs.get("tier")) state.activeSureTier = qs.get("tier");
    if (qs.get("tab")) state.activeIntelTab = qs.get("tab").toUpperCase();
    if (qs.get("cat")) state.activePowerCategory = qs.get("cat").toUpperCase();
    state.route = pRoute;
  } else {
    state.route = "/";
  }
  renderAll();
  syncRealtimeFeed(false);
})();
