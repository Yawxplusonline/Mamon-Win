// Canonical Country -> League resolution across OneFootball, Football.com, SportyBet & ESPN

const GENERIC_STAGE_RE = /^(group stage|league phase|knockout|quarterfinals?|semifinals?|final|round of \d+|prelims?|regular season|play-?offs?|opening round|league|international football|club football|global football)$/i;

const COUNTRY_ALIASES = {
  uk: "England",
  "great britain": "England",
  eng: "England",
  england: "England",
  esp: "Spain",
  spain: "Spain",
  ger: "Germany",
  deu: "Germany",
  germany: "Germany",
  ita: "Italy",
  italy: "Italy",
  fra: "France",
  france: "France",
  ned: "Netherlands",
  holland: "Netherlands",
  netherlands: "Netherlands",
  por: "Portugal",
  portugal: "Portugal",
  tur: "Turkey",
  turkiye: "Turkey",
  "türkiye": "Turkey",
  "turkiye amateur": "Turkey",
  "türkiye amateur": "Turkey",
  turkey: "Turkey",
  bel: "Belgium",
  belgium: "Belgium",
  sco: "Scotland",
  scotland: "Scotland",
  ukr: "Ukraine",
  ukraine: "Ukraine",
  col: "Colombia",
  colombia: "Colombia",
  slv: "El Salvador",
  "el salvador": "El Salvador",
  bra: "Brazil",
  brazil: "Brazil",
  arg: "Argentina",
  argentina: "Argentina",
  chi: "Chile",
  chile: "Chile",
  peru: "Peru",
  per: "Peru",
  uru: "Uruguay",
  uruguay: "Uruguay",
  par: "Paraguay",
  paraguay: "Paraguay",
  ecu: "Ecuador",
  ecuador: "Ecuador",
  ven: "Venezuela",
  venezuela: "Venezuela",
  bol: "Bolivia",
  bolivia: "Bolivia",
  mex: "Mexico",
  mexico: "Mexico",
  usa: "USA",
  "united states": "USA",
  "united states of america": "USA",
  sau: "Saudi Arabia",
  ksa: "Saudi Arabia",
  "saudi arabia": "Saudi Arabia",
  uae: "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
  irq: "Iraq",
  iraq: "Iraq",
  irn: "Iran",
  iran: "Iran",
  blr: "Belarus",
  belarus: "Belarus",
  lva: "Latvia",
  latvia: "Latvia",
  fin: "Finland",
  finland: "Finland",
  hun: "Hungary",
  hungary: "Hungary",
  bgr: "Bulgaria",
  bulgaria: "Bulgaria",
  svn: "Slovenia",
  slovenia: "Slovenia",
  isr: "Israel",
  israel: "Israel",
  cyp: "Cyprus",
  cyprus: "Cyprus",
  egy: "Egypt",
  egypt: "Egypt",
  mar: "Morocco",
  morocco: "Morocco",
  tun: "Tunisia",
  tunisia: "Tunisia",
  dza: "Algeria",
  algeria: "Algeria",
  zaf: "South Africa",
  "south africa": "South Africa",
  nga: "Nigeria",
  nigeria: "Nigeria",
  gha: "Ghana",
  ghana: "Ghana",
  rus: "Russia",
  russia: "Russia",
  swe: "Sweden",
  sweden: "Sweden",
  aus: "Australia",
  australia: "Australia",
  svk: "Slovakia",
  slovakia: "Slovakia",
  gre: "Greece",
  greece: "Greece",
  aut: "Austria",
  austria: "Austria",
  sui: "Switzerland",
  switzerland: "Switzerland",
  pol: "Poland",
  poland: "Poland",
  cze: "Czech Republic",
  czechia: "Czech Republic",
  "czech republic": "Czech Republic",
  den: "Denmark",
  denmark: "Denmark",
  nor: "Norway",
  norway: "Norway",
  rou: "Romania",
  romania: "Romania",
  cro: "Croatia",
  croatia: "Croatia",
  srb: "Serbia",
  serbia: "Serbia",
  jpn: "Japan",
  japan: "Japan",
  kor: "South Korea",
  "korea republic": "South Korea",
  "south korea": "South Korea",
  chn: "China",
  china: "China",
  uefa: "Europe",
  europe: "Europe",
  caf: "Africa",
  africa: "Africa",
  concacaf: "CONCACAF",
  conmebol: "South America",
  "south america": "South America",
  afc: "Asia",
  asia: "Asia",
  international: "International"
};

const DEMONYM_BY_COUNTRY = {
  England: "English",
  Spain: "Spanish",
  Germany: "German",
  Italy: "Italian",
  France: "French",
  Netherlands: "Dutch",
  Portugal: "Portuguese",
  Turkey: "Turkish",
  Belgium: "Belgian",
  Scotland: "Scottish",
  Ukraine: "Ukrainian",
  Colombia: "Colombian",
  Brazil: "Brazilian",
  Argentina: "Argentine",
  Chile: "Chilean",
  Mexico: "Mexican",
  USA: "American",
  "Saudi Arabia": "Saudi",
  Russia: "Russian",
  Sweden: "Swedish",
  Australia: "Australian",
  Slovakia: "Slovakian",
  Greece: "Greek",
  Poland: "Polish",
  Austria: "Austrian",
  Switzerland: "Swiss",
  Denmark: "Danish",
  Norway: "Norwegian",
  Romania: "Romanian",
  Croatia: "Croatian",
  Serbia: "Serbian",
  Japan: "Japanese",
  "South Korea": "South Korean",
  "Czech Republic": "Czech",
  Finland: "Finnish",
  Hungary: "Hungarian",
  Bulgaria: "Bulgarian",
  Slovenia: "Slovenian",
  Israel: "Israeli",
  Cyprus: "Cypriot",
  Belarus: "Belarusian",
  Latvia: "Latvian",
  Peru: "Peruvian",
  Uruguay: "Uruguayan",
  Paraguay: "Paraguayan",
  Ecuador: "Ecuadorian",
  Venezuela: "Venezuelan",
  Bolivia: "Bolivian",
  Iraq: "Iraqi",
  Iran: "Iranian",
  "United Arab Emirates": "UAE",
  Egypt: "Egyptian",
  Morocco: "Moroccan",
  Tunisia: "Tunisian",
  Algeria: "Algerian",
  "South Africa": "South African",
  Nigeria: "Nigerian",
  Ghana: "Ghanaian"
};

const KNOWN_LEAGUE_RULES = [
  // Europe (UEFA)
  { re: /champions league/i, country: "Europe", league: "UEFA Champions League" },
  { re: /europa league/i, country: "Europe", league: "UEFA Europa League" },
  { re: /conference league/i, country: "Europe", league: "UEFA Conference League" },
  { re: /uefa nations league|nations league/i, country: "Europe", league: "UEFA Nations League", exclude: /concacaf/i },
  { re: /euro qualification|european championship/i, country: "Europe", league: "UEFA Euro Qualifiers" },

  // CONCACAF / Americas / Africa / International
  { re: /concacaf nations league/i, country: "CONCACAF", league: "CONCACAF Nations League" },
  { re: /concacaf gold cup|gold cup prelim/i, country: "CONCACAF", league: "CONCACAF Gold Cup" },
  { re: /africa cup of nations|afcon/i, country: "Africa", league: "Africa Cup of Nations Qualification" },
  { re: /copa libertadores/i, country: "South America", league: "Copa Libertadores" },
  { re: /copa sudamericana/i, country: "South America", league: "Copa Sudamericana" },
  { re: /club friendl/i, country: "International", league: "Club Friendly Games" },
  { re: /int\.?\s*friendl|international friendl/i, country: "International", league: "International Friendlies" },
  { re: /world cup qual/i, country: "International", league: "FIFA World Cup Qualifiers" },

  // England
  { re: /^(english\s+)?premier league$/i, country: "England", league: "English Premier League", allowCountryMismatch: false },
  { re: /^(efl\s+|english\s+)?championship$/i, country: "England", league: "English Championship" },
  { re: /^(efl\s+|english\s+)?league one$/i, country: "England", league: "English League One" },
  { re: /^(efl\s+|english\s+)?league two$/i, country: "England", league: "English League Two" },
  { re: /^(english\s+)?national league$/i, country: "England", league: "English National League" },
  { re: /\bfa cup\b/i, country: "England", league: "English FA Cup" },
  { re: /\befl trophy\b|football league trophy/i, country: "England", league: "English EFL Trophy" },
  { re: /\befl cup\b|carabao cup/i, country: "England", league: "English EFL Cup" },

  // Spain
  { re: /^(spanish\s+)?la\s*liga$/i, country: "Spain", league: "Spanish La Liga" },
  { re: /^(spanish\s+)?la\s*liga\s*2$|segunda divisi[oó]n|laliga hypermotion/i, country: "Spain", league: "Spanish LaLiga 2" },
  { re: /copa del rey/i, country: "Spain", league: "Spanish Copa del Rey" },
  { re: /primera federaci[oó]n|primera rfef/i, country: "Spain", league: "Spanish Primera Federación" },
  { re: /liga acb/i, country: "Spain", league: "Spanish Liga ACB", sport: "basketball" },

  // Germany
  { re: /^(german\s+)?bundesliga$/i, country: "Germany", league: "German Bundesliga", exclude: /2\.|austria/i },
  { re: /^(german\s+)?2\.\s*bundesliga$/i, country: "Germany", league: "German 2. Bundesliga" },
  { re: /^(german\s+)?3\.\s*liga$/i, country: "Germany", league: "German 3. Liga" },
  { re: /dfb[\s-]*pokal/i, country: "Germany", league: "German DFB-Pokal" },
  { re: /\bpro a\b/i, country: "Germany", league: "German Pro A", sport: "basketball" },
  { re: /\bbbl\b/i, country: "Germany", league: "German BBL", sport: "basketball" },

  // Italy
  { re: /^(italian\s+)?serie a$/i, country: "Italy", league: "Italian Serie A", exclude: /brazil|brasileir/i },
  { re: /^(italian\s+)?serie b$/i, country: "Italy", league: "Italian Serie B" },
  { re: /coppa italia/i, country: "Italy", league: "Italian Coppa Italia" },

  // France
  { re: /^(french\s+)?ligue 1$/i, country: "France", league: "French Ligue 1" },
  { re: /^(french\s+)?ligue 2$/i, country: "France", league: "French Ligue 2" },
  { re: /coupe de france/i, country: "France", league: "French Coupe de France" },
  { re: /championnat national/i, country: "France", league: "French National" },

  // Netherlands / Portugal / Belgium / Scotland / Turkey
  { re: /^(dutch\s+)?eredivisie$/i, country: "Netherlands", league: "Dutch Eredivisie" },
  { re: /keuken kampioen|eerste divisie/i, country: "Netherlands", league: "Dutch Eerste Divisie" },
  { re: /knvb\s*(beker|cup)/i, country: "Netherlands", league: "Dutch KNVB Cup" },
  { re: /primeira liga|liga portugal/i, country: "Portugal", league: "Portuguese Primeira Liga" },
  { re: /taca de portugal|ta[cç]a de portugal/i, country: "Portugal", league: "Portuguese Cup" },
  { re: /belgian pro league|first division a|jupiler pro/i, country: "Belgium", league: "Belgian Pro League" },
  { re: /scottish premiership|^(cinch|william hill)?\s*premiership$/i, country: "Scotland", league: "Scottish Premiership" },
  { re: /s[uü]per lig/i, country: "Turkey", league: "Turkish Süper Lig" },
  { re: /^1\.\s*lig$/i, country: "Turkey", league: "Turkish 1. Lig" },
  { re: /^2\.\s*lig$/i, country: "Turkey", league: "Turkish 2. Lig" },
  { re: /^3\.\s*lig$/i, country: "Turkey", league: "Turkish 3. Lig" },
  { re: /t[uü]rkiye kupas|turkish cup/i, country: "Turkey", league: "Turkish Cup" },

  // Other Global Leagues & Cups
  { re: /persha li[gh]a/i, country: "Ukraine", league: "Ukrainian Persha Liga" },
  { re: /ukrainian premier/i, country: "Ukraine", league: "Ukrainian Premier League" },
  { re: /ekstraklasa/i, country: "Poland", league: "Polish Ekstraklasa" },
  { re: /^i\s+liga$/i, country: "Poland", league: "Polish I Liga" },
  { re: /^ii\s+liga$/i, country: "Poland", league: "Polish II Liga" },
  { re: /^iii\s+liga/i, country: "Poland", league: "Polish III Liga" },
  { re: /virsliga/i, country: "Latvia", league: "Latvian Virsliga" },
  { re: /vtoraya liga/i, country: "Belarus", league: "Belarusian Vtoraya Liga" },
  { re: /^liga 1$/i, country: "Peru", league: "Peruvian Liga 1" },
  { re: /premier division league/i, country: "Iraq", league: "Iraqi Premier Division League" },
  { re: /pro league cup/i, country: "United Arab Emirates", league: "UAE Pro League Cup" },
  { re: /lnb\s*[eé]lite/i, country: "France", league: "French LNB Élite", sport: "basketball" },
  { re: /copa colombia/i, country: "Colombia", league: "Colombian Copa Colombia" },
  { re: /primera a|categor[ií]a primera/i, country: "Colombia", league: "Colombian Primera A" },
  { re: /primera divisi[oó]n de el salvador/i, country: "El Salvador", league: "El Salvador Primera Division" },
  { re: /primera b/i, country: "Chile", league: "Chilean Primera B" },
  { re: /saudi pro league/i, country: "Saudi Arabia", league: "Saudi Pro League" },
  { re: /\bmls\b|major league soccer/i, country: "USA", league: "USA MLS" },
  { re: /liga mx/i, country: "Mexico", league: "Mexican Liga MX" },
  { re: /brasileir|brazilian serie a/i, country: "Brazil", league: "Brazilian Serie A" },
  { re: /liga profesional|copa argentina|primera nacional/i, country: "Argentina", league: "Argentine Liga" },
  { re: /russian premier/i, country: "Russia", league: "Russian Premier League" },
  { re: /chinese super league/i, country: "China", league: "Chinese Super League" },

  // Multi-sport leagues
  { re: /^khl$/i, country: "Russia", league: "Russian KHL", sport: "hockey" },
  { re: /^vhl$/i, country: "Russia", league: "Russian VHL", sport: "hockey" },
  { re: /^shl$/i, country: "Sweden", league: "Swedish SHL", sport: "hockey" },
  { re: /^allsvenskan$/i, country: "Sweden", league: "Swedish Allsvenskan", sport: "hockey" },
  { re: /^nbl$/i, country: "Australia", league: "Australian NBL", sport: "basketball" },
  { re: /^euroleague$/i, country: "Europe", league: "EuroLeague Basketball", sport: "basketball" },
  { re: /extraliga/i, country: "Slovakia", league: "Slovakian Extraliga", sport: "basketball" },
  { re: /modus super series/i, country: "International", league: "Modus Super Series Darts", sport: "darts" },
  { re: /pdc|premier league darts|players championship/i, country: "International", league: "PDC Darts Tour", sport: "darts" }
];

function isGenericStageName(name) {
  return GENERIC_STAGE_RE.test(String(name || "").trim());
}

function normalizeCountryName(rawCountry) {
  const c = String(rawCountry || "").trim();
  if (!c) return "";
  const low = c.toLowerCase();
  if (COUNTRY_ALIASES[low]) return COUNTRY_ALIASES[low];
  if (/^itf/i.test(low)) return "ITF Tour";
  if (/^atp/i.test(low)) return "ATP Tour";
  if (/^challenger/i.test(low)) return "ATP Challenger";
  return c;
}

function canonicalizeLeagueAndCountry(rawCountry, rawLeague, sportKey = "football") {
  const cleanLeague = String(rawLeague || "").trim();
  let country = normalizeCountryName(rawCountry);
  let league = isGenericStageName(cleanLeague) ? "" : cleanLeague;
  const sp = String(sportKey || "football").toLowerCase();

  if (league) {
    for (const rule of KNOWN_LEAGUE_RULES) {
      if (rule.sport && rule.sport !== sp) continue;
      if (rule.exclude && rule.exclude.test(league)) continue;
      if (rule.re.test(league)) {
        // Respect explicit country when unambiguous domestic cup/division shares name (e.g., Russia vs England Premier League)
        if (!country || country === "International" || country === rule.country) {
          country = rule.country;
          league = rule.league;
        } else if (country === "Russia" && /premier league/i.test(league)) {
          country = "Russia";
          league = "Russian Premier League";
        } else if (country === "Scotland" && /premiership/i.test(league)) {
          country = "Scotland";
          league = "Scottish Premiership";
        } else {
          league = rule.country === country ? rule.league : league;
        }
        break;
      }
    }
  }

  // Tennis tour prefixes
  if (sp === "tennis" && league) {
    if (/^atp challenger/i.test(league)) country = country && country !== "International" ? country : "ATP Challenger";
    else if (/^atp/i.test(league)) country = country && country !== "International" ? country : "ATP Tour";
    else if (/^itf/i.test(league)) country = country && country !== "International" ? country : "ITF Tour";
  }

  if (!country) country = "International";

  // Prepend country demonym on short ambiguous names (e.g. England + "Premier League" -> "English Premier League")
  const demonym = DEMONYM_BY_COUNTRY[country];
  if (
    league &&
    demonym &&
    !league.toLowerCase().includes(country.toLowerCase()) &&
    !league.toLowerCase().includes(demonym.toLowerCase()) &&
    /^(premier league|championship|league one|league two|national league|cup|fa cup|1\. lig|2\. lig|3\. lig|1\. liga|2\. liga|serie [abc]|ligue [12]|super league|primera division|primera b|first division|basketball league|superliga|eliteserien|allsvenskan|veikkausliiga|superligaen)$/i.test(league)
  ) {
    league = `${demonym} ${league}`;
  }

  if (!league) {
    league = country !== "International" ? `${country} Competition` : (sp === "football" ? "International Football" : `${sp.toUpperCase()} Competition`);
  }

  return { country, league };
}

const TEAM_DISPLAY_OVERRIDES = {
  "ac goianiense go": "Atlético Goianiense",
  "atletico goianiense": "Atlético Goianiense",
  "cuiaba ec mt": "Cuiabá EC",
  "america fc mg": "América Mineiro",
  "avai fc sc": "Avaí FC",
  "botafogo fc sp": "Botafogo-SP",
  "operario ferroviario ec pr": "Operário Ferroviário",
  "vila nova fc go": "Vila Nova FC",
  "coritiba fc pr": "Coritiba FC",
  "goias ec go": "Goiás EC",
  "paysandu sc pa": "Paysandu SC",
  "ceara sc ce": "Ceará SC",
  "sport club do recife pe": "Sport Recife",
  "guarani fc sp": "Guarani FC",
  "ponte preta sp": "Ponte Preta",
  "santos fc sp": "Santos FC",
  "novorizontino sp": "Grêmio Novorizontino",
  "gremio novorizontino sp": "Grêmio Novorizontino",
  "mirassol fc sp": "Mirassol FC",
  "chapecoense sc": "Chapecoense",
  "ituano fc sp": "Ituano FC",
  "brusque fc sc": "Brusque FC",
  "cr brasil al": "CRB Maceió",
  "amazonas fc am": "Amazonas FC",
  "man utd": "Manchester United",
  "man united": "Manchester United",
  "man city": "Manchester City",
  "nottm forest": "Nottingham Forest",
  "nott'm forest": "Nottingham Forest",
  "sheff utd": "Sheffield United",
  "sheff wed": "Sheffield Wednesday",
  "wba": "West Bromwich Albion",
  "west brom": "West Bromwich Albion",
  "qpr": "Queens Park Rangers",
  "wolves": "Wolverhampton Wanderers",
  "spurs": "Tottenham Hotspur",
  "psg": "Paris Saint-Germain",
  "paris sg": "Paris Saint-Germain",
  "ath bilbao": "Athletic Club Bilbao",
  "athletic bilbao": "Athletic Club Bilbao",
  "atl madrid": "Atlético Madrid",
  "atl. madrid": "Atlético Madrid",
  "atletico madrid": "Atlético Madrid",
  "inter": "Inter Milan",
  "internazionale": "Inter Milan",
  "milan": "AC Milan",
  "bayern munchen": "Bayern Munich",
  "m'gladbach": "Borussia Mönchengladbach",
  "monchengladbach": "Borussia Mönchengladbach",
  "sporting": "Sporting CP",
  "sporting lisbon": "Sporting CP"
};

function cleanTeamDisplayName(rawName) {
  const s = String(rawName || "").trim();
  if (!s) return "";
  const low = s.toLowerCase().replace(/\s+/g, " ");
  if (TEAM_DISPLAY_OVERRIDES[low]) return TEAM_DISPLAY_OVERRIDES[low];
  // Strip trailing 2-letter Brazilian state codes after FC/EC/SC/AC (e.g. "Vila Nova FC GO" -> "Vila Nova FC")
  const strippedState = s.replace(/\b(FC|EC|SC|AC|CR)\s+(SP|RJ|MG|RS|PR|SC|BA|GO|PE|CE|PA|MT|AL|AM|RN|PB|MA|SE|DF|ES|PI|TO|MS|RO|AC|AP|RR)$/i, "$1");
  return strippedState.trim();
}

module.exports = {
  isGenericStageName,
  normalizeCountryName,
  canonicalizeLeagueAndCountry,
  cleanTeamDisplayName,
  DEMONYM_BY_COUNTRY
};
