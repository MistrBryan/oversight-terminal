# Oversight Terminal

A public, static, retro-terminal website that (1) tracks U.S. federal **spending**
using authoritative government data feeds and (2) aggregates **news on spending and
government overreach**, linking out to the original reporting.

Design goal: **transparency over the illusion of neutrality.** Every figure is
machine-fetched, dated, and linked to its source; analysis is labeled and kept
separate from raw data.

> The green-CRT styling is an original design and is **not affiliated with any
> game, studio, or agency**.

## How it works

- **Frontend** — plain static HTML/CSS/JS (no build step). Charts via Chart.js (CDN).
- **Spending data (auto, no approval gate)** — `tools/fetch-spending.mjs` pulls
  numbers from free official APIs (Treasury Fiscal Data today; USAspending.gov and
  FRED are wired for extension) and writes `data/spending/*.json`. Plain-language
  context lives in `tools/context.json` and is merged in. A weekly GitHub Action
  (`.github/workflows/refresh-data.yml`) commits refreshed figures.
- **News (auto-surface, human-approve — flow A3)** — `tools/fetch-feeds.mjs` pulls
  RSS, filters to spending/overreach topics, and stages candidates. A daily Action
  (`.github/workflows/refresh-news.yml`) opens a **pull request**; you delete rows you
  don't want and **merge to publish**. Only headline + short summary + link are stored.

## Run locally

```bash
npm run fetch:data     # refresh spending JSON from gov APIs
npm run fetch:news     # surface news candidates -> data/news-candidates.json
npm run serve          # serve at http://localhost:4173
```

## Sources

| Purpose | Source | Key |
|---|---|---|
| Data | Treasury Fiscal Data API | none |
| Data | USAspending.gov API | none |
| Data | FRED (St. Louis Fed) | free key → `FRED_API_KEY` secret |
| Context | Penn Wharton Budget Model, Hamilton Project, Brookings | — |
| News | AP News (via Google News RSS), Axios, Al Jazeera, Drop Site News | none |

See the in-site **Sources & Methodology** page for lean labels and full detail.

## Deploy

Any static host works. GitHub Pages is the natural fit (Actions + Pages in one repo):
push to `main`, enable Pages on the repo root. Add `FRED_API_KEY` under
**Settings → Secrets → Actions** if you enable FRED metrics.

## Notes / known limitations

- **AP News** has no reliable public RSS, so AP items are reached via Google News RSS
  scoped to `apnews.com`; those links redirect through Google News.
- The news classifier is intentionally **over-inclusive** — the human PR-merge step is
  the real filter.
