const geoCache = new Map();
const weatherCache = new Map();

function wmoWeatherInfo(code, windKmh = 0, precipMm = 0) {
  const c = Number(code);
  let label = "Clear Sky";
  if (c === 1 || c === 2) label = "Partly Cloudy";
  else if (c === 3) label = "Overcast";
  else if (c === 45 || c === 48) label = "Fog / Mist";
  else if (c >= 51 && c <= 57) label = "Drizzle";
  else if (c >= 61 && c <= 65) label = "Rain";
  else if (c >= 66 && c <= 67) label = "Freezing Rain";
  else if (c >= 71 && c <= 77) label = "Snow";
  else if (c >= 80 && c <= 82) label = "Rain Showers";
  else if (c >= 85 && c <= 86) label = "Snow Showers";
  else if (c >= 95) label = "Thunderstorm";

  let impact = "Good passing & pitch footing";
  let modifier = 0.02;
  if (c >= 95 || precipMm >= 3.0 || windKmh >= 35) {
    impact = "Heavy rain / high wind increases upset & card variance";
    modifier = -0.05;
  } else if (precipMm >= 0.4 || windKmh >= 24 || c === 45 || c === 48 || (c >= 61 && c <= 82)) {
    impact = "Wet / breezy conditions favor direct play & under-dogs";
    modifier = -0.02;
  }
  return { label, impact, modifier };
}

function normalizeCountryForGeo(country) {
  const c = String(country || "").trim();
  const lc = c.toLowerCase();
  if (["england", "scotland", "wales", "northern ireland", "uk"].includes(lc)) return "United Kingdom";
  if (["usa", "united states of america", "us"].includes(lc)) return "United States";
  return c;
}

async function resolveCityCoords(city, country) {
  const cleanCity = String(city || "").trim();
  if (!cleanCity) return null;
  const cleanCountry = normalizeCountryForGeo(country);
  const key = `${cleanCity.toLowerCase()}|${cleanCountry.toLowerCase()}`;
  const cached = geoCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=6&language=en&format=json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!resp.ok) return null;
  const json = await resp.json();
  const results = json?.results || [];
  if (!results.length) {
    geoCache.set(key, { data: null, expiresAt: Date.now() + 3600000 });
    return null;
  }
  let chosen = results[0];
  if (cleanCountry) {
    const match = results.find(
      (r) => String(r.country || "").toLowerCase().includes(cleanCountry.toLowerCase()) ||
        cleanCountry.toLowerCase().includes(String(r.country || "").toLowerCase())
    );
    if (match) chosen = match;
  }
  const data = {
    latitude: chosen.latitude,
    longitude: chosen.longitude,
    name: chosen.name,
    country: chosen.country || cleanCountry || ""
  };
  geoCache.set(key, { data, expiresAt: Date.now() + 86400000 });
  return data;
}

module.exports = async function handler(req, res) {
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const city = String(req.query?.city ?? reqUrl.searchParams.get("city") ?? "").trim();
  const country = String(req.query?.country ?? reqUrl.searchParams.get("country") ?? "").trim();
  const iso = String(req.query?.iso ?? reqUrl.searchParams.get("iso") ?? "").trim();

  if (!city) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Missing city parameter" }));
    return;
  }

  try {
    const loc = await resolveCityCoords(city, country);
    if (!loc) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: false, city, country }));
      return;
    }

    const wKey = `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
    let forecast = weatherCache.get(wKey);
    if (!forecast || Date.now() >= forecast.expiresAt) {
      const fUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,precipitation,rain,wind_speed_10m,weather_code&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code&forecast_days=3&timezone=UTC`;
      const fResp = await fetch(fUrl, { signal: AbortSignal.timeout(5000) });
      if (!fResp.ok) throw new Error(`Open-Meteo HTTP ${fResp.status}`);
      const fData = await fResp.json();
      forecast = { data: fData, expiresAt: Date.now() + 1800000 };
      weatherCache.set(wKey, forecast);
    }

    const fData = forecast.data || {};
    const cur = fData.current || {};
    const hourly = fData.hourly || {};
    let tempC = typeof cur.temperature_2m === "number" ? cur.temperature_2m : null;
    let windKmh = typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : 0;
    let precipMm = typeof cur.precipitation === "number" ? cur.precipitation : 0;
    let precipProbPct = null;
    let weatherCode = typeof cur.weather_code === "number" ? cur.weather_code : 0;

    if (iso && Array.isArray(hourly.time) && hourly.time.length > 0) {
      const targetTs = new Date(iso).getTime();
      if (Number.isFinite(targetTs)) {
        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let i = 0; i < hourly.time.length; i++) {
          const ts = new Date(hourly.time[i] + "Z").getTime();
          const diff = Math.abs(ts - targetTs);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0 && bestDiff <= 5400000) {
          if (typeof hourly.temperature_2m?.[bestIdx] === "number") tempC = hourly.temperature_2m[bestIdx];
          if (typeof hourly.wind_speed_10m?.[bestIdx] === "number") windKmh = hourly.wind_speed_10m[bestIdx];
          if (typeof hourly.precipitation?.[bestIdx] === "number") precipMm = hourly.precipitation[bestIdx];
          if (typeof hourly.precipitation_probability?.[bestIdx] === "number") precipProbPct = hourly.precipitation_probability[bestIdx];
          if (typeof hourly.weather_code?.[bestIdx] === "number") weatherCode = hourly.weather_code[bestIdx];
        }
      }
    }

    const info = wmoWeatherInfo(weatherCode, windKmh, precipMm);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        ok: true,
        city: loc.name,
        country: loc.country,
        tempC: tempC !== null ? Math.round(tempC * 10) / 10 : null,
        windKmh: Math.round(windKmh),
        precipMm: Math.round(precipMm * 10) / 10,
        precipProbPct,
        weatherCode,
        condition: info.label,
        impact: info.impact,
        modifier: info.modifier
      })
    );
  } catch (err) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ ok: false, city, country, error: err?.message || "Weather unavailable" }));
  }
};
