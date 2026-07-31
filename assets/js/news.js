/* news.js — renders + filters the approved news feed from data/news.json.
   Time-range views (Today / Last 7 Days / Last Month) plus topic + source
   filters. The active range is reflected in the URL hash (#range=month) so
   views are shareable and the back button works. */

(function () {
  "use strict";

  var RETENTION_DAYS = 30;               // ceiling: matches the longest range
  var RANGES = [                          // key, label, max age in days (null = same-day)
    ["today", "Today", null],
    ["7d", "Last 7 Days", 7],
    ["month", "Last Month", 30],
  ];
  var RANGE_KEYS = RANGES.map(function (r) { return r[0]; });

  var items = [];                         // retained items (<= RETENTION_DAYS old)
  var state = { range: "7d", topic: "all", source: "all" };

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function rangeLabel(key) {
    for (var i = 0; i < RANGES.length; i++) if (RANGES[i][0] === key) return RANGES[i][1];
    return key;
  }

  function leanClass(lean) {
    if (lean === "left") return "lean-left";
    if (lean === "right") return "lean-right";
    return "lean-center";
  }

  function inRange(it) {
    if (state.range === "today") return String(it.publishedAt).slice(0, 10) === todayStr();
    var days = state.range === "month" ? 30 : 7;
    var t = Date.parse(it.publishedAt);
    return isNaN(t) ? true : t >= Date.now() - days * 86400000;
  }

  function render() {
    var host = document.getElementById("news-list");
    var filtered = items.filter(function (it) {
      var rangeOk = inRange(it);
      var topicOk = state.topic === "all" || (it.topic || []).indexOf(state.topic) !== -1;
      var srcOk = state.source === "all" || it.source === state.source;
      return rangeOk && topicOk && srcOk;
    });

    var c = document.getElementById("news-count");
    if (c) c.textContent = filtered.length + " ITEMS · " + rangeLabel(state.range).toUpperCase();

    if (!filtered.length) {
      var msg = !items.length
        ? "// NO HEADLINES IN THE LAST " + RETENTION_DAYS + " DAYS — CHECK BACK SOON"
        : "// NO ITEMS IN THIS VIEW";
      host.innerHTML = "<div class='empty'>" + msg + "</div>";
      return;
    }
    host.innerHTML = filtered.map(function (it) {
      var commentary = it.type === "commentary";
      return "<article class='news-item'>" +
        "<div class='meta'>" +
          "<span class='badge " + leanClass(it.lean) + "'>" + escapeHtml(it.source) + "</span>" +
          (commentary ? "<span class='badge commentary'>COMMENTARY</span>" : "") +
          (it.topic || []).map(function (t) { return "<span class='badge'>" + escapeHtml(t) + "</span>"; }).join("") +
          "<time datetime='" + escapeHtml(it.publishedAt) + "'>" + escapeHtml(it.publishedAt) + "</time>" +
        "</div>" +
        "<h3><a href='" + safeUrl(it.url) + "' target='_blank' rel='noopener noreferrer'>" + escapeHtml(it.title) + " ↗</a></h3>" +
        "<p class='summary'>" + escapeHtml(it.summary || "") + "</p>" +
      "</article>";
    }).join("");
  }

  // escapes the single quote too — attributes below are single-quoted
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // only http(s) links may reach an href — blocks javascript:/data: URLs
  function safeUrl(u) {
    var s = String(u == null ? "" : u).trim();
    if (!/^https?:\/\//i.test(s)) return "#";
    return escapeHtml(s);
  }

  function buildFilters() {
    buildRange();
    var topics = ["all"].concat(unique(flatten(items.map(function (i) { return i.topic || []; }))));
    var sources = ["all"].concat(unique(items.map(function (i) { return i.source; })));
    wire("topic-filters", topics, "topic");
    wire("source-filters", sources, "source");
  }

  function buildRange() {
    var host = document.getElementById("range-filters");
    if (!host) return;
    host.innerHTML = RANGES.map(function (r) {
      return "<button class='chip " + (state.range === r[0] ? "active" : "") +
        "' data-key='range' data-val='" + r[0] + "'>" + escapeHtml(r[1]) + "</button>";
    }).join("");
  }

  function wire(id, values, key) {
    var host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = values.map(function (v) {
      return "<button class='chip " + (state[key] === v ? "active" : "") +
        "' data-key='" + key + "' data-val='" + escapeHtml(v) + "'>" + escapeHtml(v) + "</button>";
    }).join("");
  }

  function unique(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }
  function flatten(arr) { return arr.reduce(function (a, b) { return a.concat(b); }, []); }

  function applyHash() {
    var m = /range=(today|7d|month)/.exec(location.hash || "");
    state.range = m ? m[1] : "7d";
  }

  document.addEventListener("click", function (e) {
    var chip = e.target.closest && e.target.closest(".chip");
    if (!chip) return;
    var key = chip.dataset.key, val = chip.dataset.val;
    if (key === "range") {
      state.range = val;
      // reflect in the URL (shareable + back-button); triggers hashchange below
      if (("#range=" + val) !== location.hash) location.hash = "range=" + val;
    } else {
      state[key] = val;
    }
    buildFilters();
    render();
  });

  window.addEventListener("hashchange", function () {
    var prev = state.range;
    applyHash();
    if (prev !== state.range) { buildFilters(); render(); }
  });

  document.addEventListener("DOMContentLoaded", async function () {
    var host = document.getElementById("news-list");
    applyHash();
    try {
      var raw = await (await fetch("data/news.json", { cache: "no-store" })).json();
      // retention ceiling: drop anything older than the longest range, so the
      // site is correct even before CI prunes the file. Unparseable dates kept.
      var cutoff = Date.now() - RETENTION_DAYS * 86400000;
      items = raw.filter(function (it) {
        var t = Date.parse(it.publishedAt);
        return isNaN(t) ? true : t >= cutoff;
      });
      items.sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
      buildFilters();
      render();
    } catch (e) {
      host.innerHTML = "<div class='empty'>// NEWS FEED UNAVAILABLE</div>";
      console.error(e);
    }
  });
})();
