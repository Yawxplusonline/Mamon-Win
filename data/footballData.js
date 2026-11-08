// Dynamic Schedule Helper, Club Catalog & Community Content for MAMON WIN
// Live & upcoming fixtures are hydrated directly from real-time ESPN feeds via data/realtimeService.js.
window.MAMON_DATA = (() => {
  function formatIsoDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(base, offset) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    return d;
  }

  function formatFriendlyDay(dateObj, offset) {
    const monDay = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (offset === 0) return `Today · ${monDay}`;
    if (offset === 1) return `Tomorrow · ${monDay}`;
    const wk = dateObj.toLocaleDateString("en-US", { weekday: "short" });
    return `${wk}, ${monDay}`;
  }

  const now = new Date();
  const todayIso = formatIsoDate(now);
  const tomorrowIso = formatIsoDate(addDays(now, 1));
  const day2Iso = formatIsoDate(addDays(now, 2));

  const DATES = [
    { id: "UPCOMING_ALL", label: "All Live & Upcoming", short: "All Live/Next" },
    { id: todayIso, label: formatFriendlyDay(now, 0), short: "Today" },
    { id: tomorrowIso, label: formatFriendlyDay(addDays(now, 1), 1), short: "Tomorrow" },
    { id: day2Iso, label: formatFriendlyDay(addDays(now, 2), 2), short: formatFriendlyDay(addDays(now, 2), 2) }
  ];

  // Featured Clubs catalog (dynamically augmented by all clubs from live ESPN feeds)
  const TEAMS = {
    arsenal: { espnId: "359", name: "Arsenal", short: "ARS", color: "#EF0107", league: "england-premier-league", stadium: "Emirates Stadium", manager: "Mikel Arteta" },
    liverpool: { espnId: "364", name: "Liverpool", short: "LIV", color: "#C8102E", league: "england-premier-league", stadium: "Anfield", manager: "Arne Slot" },
    mancity: { espnId: "382", name: "Manchester City", short: "MCI", color: "#6CABDD", league: "england-premier-league", stadium: "Etihad Stadium", manager: "Pep Guardiola" },
    chelsea: { espnId: "363", name: "Chelsea", short: "CHE", color: "#034694", league: "england-premier-league", stadium: "Stamford Bridge", manager: "Enzo Maresca" },
    manutd: { espnId: "360", name: "Manchester United", short: "MUN", color: "#DA291C", league: "england-premier-league", stadium: "Old Trafford", manager: "Ruben Amorim" },
    tottenham: { espnId: "367", name: "Tottenham Hotspur", short: "TOT", color: "#132257", league: "england-premier-league", stadium: "Tottenham Hotspur Stadium", manager: "Ange Postecoglou" },
    brighton: { espnId: "331", name: "Brighton & Hove Albion", short: "BHA", color: "#0057B8", league: "england-premier-league", stadium: "Amex Stadium", manager: "Fabian Hürzeler" },
    brentford: { espnId: "337", name: "Brentford", short: "BRE", color: "#D20000", league: "england-premier-league", stadium: "Gtech Community Stadium", manager: "Thomas Frank" },
    realmadrid: { espnId: "86", name: "Real Madrid", short: "RMA", color: "#FEBE10", league: "spain-la-liga", stadium: "Santiago Bernabéu", manager: "Carlo Ancelotti" },
    barcelona: { espnId: "83", name: "Barcelona", short: "BAR", color: "#A50044", league: "spain-la-liga", stadium: "Spotify Camp Nou", manager: "Hansi Flick" },
    atletico: { espnId: "1068", name: "Atlético Madrid", short: "ATM", color: "#CB3524", league: "spain-la-liga", stadium: "Riyadh Air Metropolitano", manager: "Diego Simeone" },
    inter: { espnId: "110", name: "Inter", short: "INT", color: "#010E80", league: "italy-serie-a", stadium: "San Siro", manager: "Simone Inzaghi" },
    acmilan: { espnId: "103", name: "AC Milan", short: "MIL", color: "#FB090B", league: "italy-serie-a", stadium: "San Siro", manager: "Massimiliano Allegri" },
    juventus: { espnId: "111", name: "Juventus", short: "JUV", color: "#111111", league: "italy-serie-a", stadium: "Allianz Stadium", manager: "Luciano Spalletti" },
    napoli: { espnId: "114", name: "Napoli", short: "NAP", color: "#12A0D7", league: "italy-serie-a", stadium: "Stadio Maradona", manager: "Antonio Conte" },
    bayern: { espnId: "132", name: "Bayern Munich", short: "BAY", color: "#DC052D", league: "germany-bundesliga", stadium: "Allianz Arena", manager: "Vincent Kompany" },
    leverkusen: { espnId: "131", name: "Bayer Leverkusen", short: "B04", color: "#E32221", league: "germany-bundesliga", stadium: "BayArena", manager: "Xabi Alonso" },
    dortmund: { espnId: "124", name: "Borussia Dortmund", short: "BVB", color: "#FDE100", league: "germany-bundesliga", stadium: "Signal Iduna Park", manager: "Niko Kovač" },
    psg: { espnId: "160", name: "Paris Saint-Germain", short: "PSG", color: "#004170", league: "france-ligue-1", stadium: "Parc des Princes", manager: "Luis Enrique" },
    ajax: { espnId: "139", name: "Ajax", short: "AJX", color: "#D2122E", league: "netherlands-eredivisie", stadium: "Johan Cruijff ArenA", manager: "Francesco Farioli" },
    psv: { espnId: "148", name: "PSV Eindhoven", short: "PSV", color: "#ED1C24", league: "netherlands-eredivisie", stadium: "Philips Stadion", manager: "Peter Bosz" },
    sporting: { espnId: "2250", name: "Sporting CP", short: "SCP", color: "#008057", league: "portugal-primeira-liga", stadium: "Estádio José Alvalade", manager: "Rui Borges" },
    benfica: { espnId: "1929", name: "Benfica", short: "SLB", color: "#E83030", league: "portugal-primeira-liga", stadium: "Estádio da Luz", manager: "Bruno Lage" },
    alhilal: { espnId: "929", name: "Al Hilal", short: "HIL", color: "#004B9B", league: "saudi-pro-league", stadium: "Kingdom Arena", manager: "Jorge Jesus" },
    intermiami: { espnId: "20232", name: "Inter Miami", short: "MIA", color: "#F7B5CD", league: "usa-mls", stadium: "Chase Stadium", manager: "Javier Mascherano" },
    kotoko: { espnId: "3964", name: "Asante Kotoko", short: "KOT", color: "#D71920", league: "ghana-premier-league", stadium: "Baba Yara Stadium", manager: "Prosper Narteh Ogum" },
    hearts: { espnId: "3963", name: "Hearts of Oak", short: "HEA", color: "#E31B23", league: "ghana-premier-league", stadium: "Accra Sports Stadium", manager: "Aboubakar Ouattara" }
  };

  Object.keys(TEAMS).forEach((key) => {
    TEAMS[key].key = key;
    TEAMS[key].logo = `https://a.espncdn.com/i/teamlogos/soccer/500/${TEAMS[key].espnId}.png`;
  });

  // Live standings populated directly from ESPN /standings endpoints
  const STANDINGS = {};
  const TOP_SCORERS = {};

  // Initial Community News (augmented with live ESPN matchday news when loaded)
  const NEWS = [
    {
      id: "news-1",
      featured: true,
      title: "11-Factor Match Model: How Home Clean Sheets & Run-in Rest Edges Drive Sure Odds",
      source: "MAMON WIN DESK",
      time: "Live Update",
      tag: "Sure Odds",
      summary: "Combining 5-game Home/Away splits, Head-to-Head tendencies, squad injuries, red-card suspensions, and fixture congestion reveals mispriced football markets.",
      body: [
        "Single-stat betting fails when form lines mask home-away variance. A club carrying W-W-D-L-W overall might be undefeated across five straight home matches with three clean sheets while struggling on its travels.",
        "MAMON WIN calculates all 11 live performance pillars across every fixture before constructing the 2, 5, 10, 80, 100, 200, 500, and 1 Million Sure Odds accumulators.",
        "Every slip mixes only active live and upcoming global matches so you never risk building tickets on completed or cancelled games."
      ]
    },
    {
      id: "news-2",
      featured: false,
      title: "Real-Time Market Scanner: Syncing DraftKings Moneyline & Totals into Live Value Edges",
      source: "QUANT WIRE",
      time: "Real-time",
      tag: "Live Odds",
      summary: "Live bookmaker prices are blended continuously against Poisson goal expectancy (λH, λA) to spotlight high-probability banker picks.",
      body: [
        "As kick-off approaches and lineups confirm, market prices react sharply to injury flags and travel fatigue from midweek European action.",
        "Open any match or click 'Analyze 11 Factors' to inspect both teams' home/away clean-sheet percentages and run-in difficulty before staking."
      ]
    }
  ];

  // Real-time Team Power Picks (Strong/Worst Home & Away) computed live in data/realtimeService.js
  return {
    DATES,
    todayIso,
    tomorrowIso,
    day2Iso,
    TEAMS,
    STANDINGS,
    TOP_SCORERS,
    NEWS
  };
})();
