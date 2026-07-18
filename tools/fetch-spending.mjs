#!/usr/bin/env node
/* ============================================================
   fetch-spending.mjs  (spending data pipeline — B2/B3)

   Pulls authoritative U.S. federal spending figures from FREE
   official government APIs and writes them to data/spending/*.json,
   merging in the hand-curated context from tools/context.json.

   Numbers are machine-fetched and dated. No hand-editing of figures.

   Run locally:   node tools/fetch-spending.mjs
   In CI:         .github/workflows/refresh-data.yml (weekly cron)

   Sources:
     - Treasury Fiscal Data API  (no key)   -> outlays, deficit, receipts, debt, interest
     - USAspending.gov API       (no key)   -> spending by budget function (breakdown)
     - FRED (St. Louis Fed)      (free key)  -> debt/deficit/spending as % of GDP
                                               (set FRED_API_KEY; skipped if absent)
   ============================================================ */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "spending");

const FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const YEARS = [2021, 2022, 2023, 2024, 2025]; // fiscal years to chart
const today = new Date().toISOString().slice(0, 10);
const FRED_KEY = process.env.FRED_API_KEY; // optional; enables the %-of-GDP metrics

const toB = (amt) => Math.round(Number(amt) / 1e9); // dollars -> whole $B

async function getJSON(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---- Monthly Treasury Statement: annual outlays / receipts / deficit ---- */
async function treasuryMTS() {
  // September "Year-to-Date" rows carry full fiscal-year totals.
  const url = `${FISCAL}/v1/accounting/mts/mts_table_1` +
    `?filter=record_calendar_month:eq:09&sort=-record_date&page[size]=400`;
  const { data } = await getJSON(url);

  // Each September record contains TWO "Year-to-Date" rows: the prior-year
  // comparative (lower src_line_nbr, ~14) and the current-year total
  // (higher src_line_nbr, ~28). Take the current year = highest src_line_nbr.
  const pick = (year) => {
    const rows = data
      .filter((r) => r.record_date === `${year}-09-30` && r.classification_desc === "Year-to-Date")
      .sort((a, b) => Number(b.src_line_nbr) - Number(a.src_line_nbr));
    return rows[0];
  };

  const outlays = [], receipts = [], deficit = [];
  for (const y of YEARS) {
    const row = pick(y);
    if (!row) { console.warn(`  ! no MTS YTD row for FY${y}`); continue; }
    const label = `FY${String(y).slice(2)}`;
    outlays.push({ period: label, value: toB(row.current_month_gross_outly_amt) });
    receipts.push({ period: label, value: toB(row.current_month_gross_rcpt_amt) });
    deficit.push({ period: label, value: toB(row.current_month_dfct_sur_amt) });
  }
  return { outlays, receipts, deficit };
}

/* ---- Debt to the Penny: fiscal-year-end national debt + latest ---- */
async function treasuryDebt() {
  const url = `${FISCAL}/v2/accounting/od/debt_to_penny` +
    `?filter=record_calendar_month:eq:09&sort=-record_date&page[size]=600`;
  const { data } = await getJSON(url);

  // latest fiscal-year-end record per year (max day in September)
  const byYear = new Map();
  for (const r of data) {
    const y = Number(r.record_fiscal_year);
    if (!YEARS.includes(y)) continue;
    const prev = byYear.get(y);
    if (!prev || r.record_date > prev.record_date) byYear.set(y, r);
  }
  const years = YEARS.filter((y) => byYear.has(y));
  const series = years.map((y) => ({ period: `FY${String(y).slice(2)}`, value: toB(byYear.get(y).tot_pub_debt_out_amt) }));
  const heldPublic = years.map((y) => ({ period: `FY${String(y).slice(2)}`, value: toB(byYear.get(y).debt_held_public_amt) }));

  // append the very latest snapshot as "Now"
  const latest = await getJSON(
    `${FISCAL}/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1`);
  const l = latest.data[0];
  series.push({ period: "Now", value: toB(l.tot_pub_debt_out_amt) });
  heldPublic.push({ period: "Now", value: toB(l.debt_held_public_amt) });
  return { series, heldPublic, asOf: l.record_date };
}

/* ---- Interest Expense on the Public Debt: gross interest per fiscal year ---- */
async function treasuryInterest() {
  const url = `${FISCAL}/v2/accounting/od/interest_expense` +
    `?filter=record_calendar_month:eq:09&sort=-record_date&page[size]=800`;
  const { data } = await getJSON(url);
  // Each FY-end record holds ~38 rows (one per security type). Summing the
  // year-to-date figures gives total gross interest expense for that year.
  const series = [];
  for (const y of YEARS) {
    const rows = data.filter((r) => r.record_date === `${y}-09-30`);
    if (!rows.length) continue;
    const total = rows.reduce((s, r) => s + Number(r.fytd_expense_amt || 0), 0);
    series.push({ period: `FY${String(y).slice(2)}`, value: toB(total) });
  }
  return series;
}

/* ---- USAspending: spending by budget function (categorical breakdown) ---- */
async function usaspendingByFunction() {
  // most recently completed fiscal year (US FY ends Sep 30)
  const now = new Date();
  let fy = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  for (let attempt = 0; attempt < 2; attempt++, fy--) {
    try {
      const res = await fetch("https://api.usaspending.gov/api/v2/spending/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ type: "budget_function", filters: { fy: String(fy), quarter: "4" } }),
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (!d.results || !d.results.length) continue;
      const breakdown = d.results
        .filter((r) => r.name && !/unreported/i.test(r.name) && Number(r.amount) > 0)
        .map((r) => ({ name: r.name, value: toB(r.amount) }))
        .sort((a, b) => b.value - a.value);
      return { breakdown, fy, total: toB(d.total) };
    } catch { /* try previous year */ }
  }
  return null;
}

/* ---- FRED (St. Louis Fed): fiscal ratios to GDP (needs free API key) ---- */
async function fredSeries(seriesId, { negate = false, lastN = 6 } = {}) {
  const url = "https://api.stlouisfed.org/fred/series/observations" +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    "&observation_start=2016-01-01&sort_order=asc";
  const { observations } = await getJSON(url);
  // collapse to one point per calendar year (last valid obs of each year)
  const byYear = new Map();
  for (const o of observations) {
    if (o.value === "." || o.value === "") continue;
    byYear.set(o.date.slice(0, 4), o.value); // asc order => keeps latest of year
  }
  return [...byYear.keys()].sort().slice(-lastN).map((y) => {
    let v = Number(byYear.get(y));
    if (negate) v = -v;
    return { period: y, value: Math.round(v * 10) / 10 };
  });
}

async function fredMetrics() {
  if (!FRED_KEY) { console.log("> FRED_API_KEY not set — skipping FRED %-of-GDP metrics"); return []; }
  console.log("> fetching FRED (% of GDP) series …");
  const defs = [
    { id: "debt-to-gdp",    title: "Debt as % of GDP",     seriesId: "GFDEGDQ188S", opts: {} },
    { id: "deficit-to-gdp", title: "Deficit as % of GDP",  seriesId: "FYFSGDA188S", opts: { negate: true } },
    { id: "outlays-to-gdp", title: "Spending as % of GDP",  seriesId: "FYONGDA188S", opts: {} },
  ];
  const out = [];
  for (const d of defs) {
    try {
      const series = await fredSeries(d.seriesId, d.opts);
      if (!series.length) { console.warn(`  ! FRED ${d.seriesId}: no observations`); continue; }
      out.push({
        id: d.id, title: d.title, unit: "percent", series,
        dataSource: `FRED (${d.seriesId})`,
        dataSourceUrl: `https://fred.stlouisfed.org/series/${d.seriesId}`,
      });
      console.log(`  ✓ ${d.id.padEnd(16)} ${series.length} pts, latest ${series[series.length - 1].period}=${series[series.length - 1].value}%`);
    } catch (e) { console.warn(`  ! FRED ${d.seriesId}: ${e.message}`); }
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const context = JSON.parse(await readFile(join(__dirname, "context.json"), "utf8"));

  const MTS = "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/";
  console.log("> fetching Treasury Monthly Treasury Statement …");
  const mts = await treasuryMTS();
  console.log("> fetching Treasury Debt to the Penny …");
  const debt = await treasuryDebt();
  console.log("> fetching Treasury Interest Expense …");
  const interest = await treasuryInterest();
  console.log("> fetching USAspending budget-function breakdown …");
  const byFunction = await usaspendingByFunction();
  const fred = await fredMetrics();

  const metrics = [
    { id: "federal-outlays", title: "Federal Outlays", unit: "USD_billions", series: mts.outlays,
      dataSource: "Treasury Fiscal Data (MTS)", dataSourceUrl: MTS },
    { id: "federal-deficit", title: "Federal Deficit", unit: "USD_billions", series: mts.deficit,
      dataSource: "Treasury Fiscal Data (MTS)", dataSourceUrl: MTS },
    { id: "federal-receipts", title: "Federal Receipts", unit: "USD_billions", series: mts.receipts,
      dataSource: "Treasury Fiscal Data (MTS)", dataSourceUrl: MTS },
    { id: "interest-on-debt", title: "Interest on the Debt", unit: "USD_billions", series: interest,
      dataSource: "Treasury Fiscal Data (Interest Expense)",
      dataSourceUrl: "https://fiscaldata.treasury.gov/datasets/interest-expense-debt-outstanding/" },
    { id: "national-debt", title: "National Debt", unit: "USD_billions", series: debt.series,
      dataSource: "Treasury Fiscal Data (Debt to the Penny)",
      dataSourceUrl: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/" },
    { id: "debt-held-by-public", title: "Debt Held by the Public", unit: "USD_billions", series: debt.heldPublic,
      dataSource: "Treasury Fiscal Data (Debt to the Penny)",
      dataSourceUrl: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/" },
    ...fred, // %-of-GDP ratios (only present when FRED_API_KEY is set)
  ];

  if (byFunction) {
    metrics.push({
      id: "spending-by-function", title: `Spending by Category (FY${String(byFunction.fy).slice(2)})`,
      unit: "USD_billions", kind: "breakdown", breakdown: byFunction.breakdown, total: byFunction.total,
      dataSource: "USAspending.gov",
      dataSourceUrl: "https://www.usaspending.gov/explorer/budget_function",
    });
  }

  const written = [];
  for (const m of metrics) {
    const hasData = m.kind === "breakdown" ? (m.breakdown && m.breakdown.length) : (m.series && m.series.length);
    if (!hasData) { console.warn(`  ! skipping ${m.id} (no data)`); continue; }
    const ctx = context[m.id] || {};
    const record = {
      ...m,
      fetchedAt: today,
      context: ctx.context || "",
      why: ctx.why || "",
      contextSource: ctx.contextSource || null,
      contextSourceUrl: ctx.contextSourceUrl || null,
    };
    await writeFile(join(OUT, `${m.id}.json`), JSON.stringify(record, null, 2) + "\n");
    written.push(m.id);
    if (m.kind === "breakdown") {
      console.log(`  ✓ ${m.id.padEnd(20)} ${m.breakdown.length} categories, total $${m.total}B`);
    } else {
      const last = m.series[m.series.length - 1];
      console.log(`  ✓ ${m.id.padEnd(20)} ${m.series.length} pts, latest ${last.period}=$${last.value}B`);
    }
  }

  // ordering for the dashboard + which files to load (static hosts can't list dirs)
  await writeFile(join(OUT, "index.json"),
    JSON.stringify({ metrics: written, updatedAt: today }, null, 2) + "\n");
  console.log(`> wrote index.json (${written.length} metrics)`);
}

main().catch((e) => { console.error("FETCH FAILED:", e.message); process.exit(1); });
