#!/usr/bin/env node
/* prune-news.mjs — drop approved news items older than N days (by publishedAt)
   from data/news.json, so stale headlines fall off the site and the file.

   Age window: NEWS_MAX_AGE_DAYS env, default 30 (matches the longest news view).
   Run locally:  node tools/prune-news.mjs
   In CI:        refresh-data.yml (committed + deployed automatically). */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NEWS = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "news.json");
const MAX_AGE_DAYS = Number(process.env.NEWS_MAX_AGE_DAYS) || 30;

const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;

function isFresh(item) {
  const t = Date.parse(item.publishedAt);
  // keep items with an unparseable/missing date rather than silently dropping them
  return isNaN(t) ? true : t >= cutoff;
}

async function main() {
  const items = JSON.parse(await readFile(NEWS, "utf8"));
  const kept = items.filter(isFresh);
  const removed = items.length - kept.length;
  if (removed > 0) {
    await writeFile(NEWS, JSON.stringify(kept, null, 2) + "\n");
  }
  console.log(`prune-news: kept ${kept.length}, removed ${removed} older than ${MAX_AGE_DAYS}d`);
}

main().catch((e) => { console.error("PRUNE FAILED:", e.message); process.exit(1); });
