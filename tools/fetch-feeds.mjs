#!/usr/bin/env node
/* ============================================================
   fetch-feeds.mjs  (news pipeline — A3, surface step)

   Pulls RSS from the configured news sources, keyword-filters to
   spending / overreach topics, dedupes against already-approved
   items, and writes CANDIDATES to data/news-candidates.json.

   It does NOT publish. The GitHub Actions workflow opens a PR with
   these candidates; a human approves by merging (which moves items
   into data/news.json). See .github/workflows/refresh-news.yml.

   Only headline + short summary + link are stored — never full text.

   Run locally:  node tools/fetch-feeds.mjs
   ============================================================ */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

/* AP has no reliable public RSS, so we reach its articles through
   Google News RSS scoped to apnews.com. Everything else is a direct feed. */
const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " site:apnews.com when:21d")}&hl=en-US&gl=US&ceid=US:en`;

const SOURCES = [
  { name: "Al Jazeera",     lean: "center", type: "news",   url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Axios",          lean: "center", type: "news",   url: "https://api.axios.com/feed/" },
  { name: "Drop Site News", lean: "left",   type: "news",   url: "https://www.dropsitenews.com/feed" },
  { name: "AP News",        lean: "center", type: "news",   url: gnews("government spending OR federal budget OR deficit") },
  { name: "AP News",        lean: "center", type: "news",   url: gnews("surveillance OR civil liberties OR executive order") },
];

const TOPIC_KEYWORDS = {
  spending: ["budget", "deficit", "debt", "spending", "appropriation", "fiscal", "treasury",
    "irs", "taxpayer", "subsidy", "subsidies", "funding", "shutdown", "earmark", "bailout",
    "stimulus", "entitlement", "medicare", "medicaid", "social security", "doge"],
  overreach: ["surveillance", "civil liberties", "warrant", "privacy", "overreach", "wiretap",
    "executive order", "censorship", "first amendment", "fourth amendment", "due process",
    "detention", "detained", "deportation", "immigration raid", "fisa", "watchlist",
    "crackdown", "martial", "national guard", "emergency powers"],
};

function classify(text) {
  const t = text.toLowerCase();
  const topics = [];
  for (const [topic, words] of Object.entries(TOPIC_KEYWORDS)) {
    if (words.some((w) => t.includes(w))) topics.push(topic);
  }
  return topics;
}

/* ---- minimal, dependency-free RSS/Atom item parser ---- */
function unescapeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // decode entities FIRST so escaped markup (&lt;p&gt;) becomes real tags…
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ").replace(/&#8217;/g, "'").replace(/&#8212;/g, "—")
    .replace(/&#\d+;/g, " ")
    // …then strip all tags
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? unescapeXml(m[1]) : "";
}
function link(block) {
  // RSS <link>…</link> or Atom <link href="…"/>
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim().startsWith("http")) return unescapeXml(rss[1]);
  const atom = block.match(/<link[^>]*href="([^"]+)"/i);
  return atom ? atom[1] : "";
}
function parseItems(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ||
                 xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => ({
    title: tag(b, "title"),
    url: link(b),
    summary: tag(b, "description") || tag(b, "summary") || tag(b, "content"),
    pubDate: tag(b, "pubDate") || tag(b, "published") || tag(b, "updated"),
  }));
}

function truncateWords(s, n) {
  const w = s.split(/\s+/);
  return w.length <= n ? s : w.slice(0, n).join(" ") + "…";
}
function isoDate(d) {
  const t = Date.parse(d);
  return isNaN(t) ? new Date().toISOString().slice(0, 10) : new Date(t).toISOString().slice(0, 10);
}
function idFor(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) { h = (h * 31 + url.charCodeAt(i)) | 0; }
  return "n" + (h >>> 0).toString(36);
}
function normTitle(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

async function loadApproved() {
  try { return JSON.parse(await readFile(join(DATA, "news.json"), "utf8")); }
  catch { return []; }
}

async function main() {
  const approved = await loadApproved();
  const seenUrls = new Set(approved.map((i) => i.url));
  const seenTitles = new Set(approved.map((i) => normTitle(i.title)));
  const candidates = [];
  const localSeen = new Set();

  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { headers: { "user-agent": "OversightFiscalMonitor/1.0 (+news aggregator)" } });
      if (!res.ok) { console.warn(`  ! ${src.name}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      const items = parseItems(xml);
      let kept = 0;
      for (const it of items) {
        if (!it.title || !it.url) continue;
        const topics = classify(it.title + " " + it.summary);
        if (!topics.length) continue;                       // off-topic
        if (seenUrls.has(it.url) || localSeen.has(it.url)) continue;
        const nt = normTitle(it.title);
        if (seenTitles.has(nt) || localSeen.has(nt)) continue; // dedupe
        localSeen.add(it.url); localSeen.add(nt);
        // Google News descriptions are just the headline repeated — drop them.
        let summary = it.summary;
        if (normTitle(summary).includes(nt.slice(0, 40))) summary = "";
        candidates.push({
          id: idFor(it.url),
          title: it.title.replace(/ - [^-]+$/, "").trim(),   // strip trailing " - AP News"
          summary: truncateWords(summary, 40),
          url: it.url,
          source: src.name,
          lean: src.lean,
          type: src.type,
          topic: topics,
          publishedAt: isoDate(it.pubDate),
        });
        kept++;
      }
      console.log(`  ✓ ${src.name.padEnd(16)} ${items.length} items, ${kept} on-topic candidate(s)`);
    } catch (e) {
      console.warn(`  ! ${src.name}: ${e.message}`);
    }
  }

  candidates.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  await writeFile(join(DATA, "news-candidates.json"), JSON.stringify(candidates, null, 2) + "\n");
  console.log(`> wrote ${candidates.length} candidate(s) to data/news-candidates.json`);
  console.log(`> ${approved.length} item(s) already approved in data/news.json`);

  // In CI (APPEND_TO_NEWS=1) also stage candidates INTO news.json so the pull
  // request diff shows them as proposed additions. The reviewer deletes any
  // unwanted rows and MERGES to approve — merging is the approval step.
  if (process.env.APPEND_TO_NEWS === "1" && candidates.length) {
    const today = new Date().toISOString().slice(0, 10);
    const staged = candidates.map((c) => ({ ...c, approvedAt: today }));
    const merged = staged.concat(approved); // newest first
    await writeFile(join(DATA, "news.json"), JSON.stringify(merged, null, 2) + "\n");
    console.log(`> staged ${candidates.length} item(s) into data/news.json for PR review`);
  }
}

main().catch((e) => { console.error("FETCH FAILED:", e.message); process.exit(1); });
