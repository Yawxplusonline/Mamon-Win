# Mamon-Win

Real-time football scores, live dropping odds, PPG rankings, Open-Meteo stadium weather, 14-factor match scouting, Strong & Worst Teams Today rankings, and Sure Odds accumulators (2 to 1,000,000 odds).

## Local Development

```bash
npm start
```

Runs the MAMON WIN server at http://127.0.0.1:8080/ with `/api/espn` and `/api/weather` proxies.

## Vercel Deployment

- Serverless functions under `/api/espn.js` and `/api/weather.js`
- SPA route rewrites configured in `vercel.json`
- Framework preset: **Other** (no build step required)
