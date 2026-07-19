/* news.js — renders + filters the approved news feed from data/news.json */

(function () {
  "use strict";

  var items = [];
  var state = { topic: "all", source: "all" };

  function leanClass(lean) {
    if (lean === "left") return "lean-left";
    if (lean === "right") return "lean-right";
    return "lean-center";
  }

  function render() {
    var host = document.getElementById("news-list");
    var filtered = items.filter(function (it) {
      var topicOk = state.topic === "all" || (it.topic || []).indexOf(state.topic) !== -1;
      var srcOk = state.source === "all" || it.source === state.source;
      return topicOk && srcOk;
    });
    if (!filtered.length) {
      host.innerHTML = "<div class='empty'>// NO ITEMS MATCH FILTER</div>";
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
    var topics = ["all"].concat(unique(flatten(items.map(function (i) { return i.topic || []; }))));
    var sources = ["all"].concat(unique(items.map(function (i) { return i.source; })));
    wire("topic-filters", topics, "topic");
    wire("source-filters", sources, "source");
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

  document.addEventListener("click", function (e) {
    var chip = e.target.closest && e.target.closest(".chip");
    if (!chip) return;
    state[chip.dataset.key] = chip.dataset.val;
    buildFilters();
    render();
  });

  document.addEventListener("DOMContentLoaded", async function () {
    var host = document.getElementById("news-list");
    try {
      items = await (await fetch("data/news.json", { cache: "no-store" })).json();
      items.sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
      buildFilters();
      render();
      var c = document.getElementById("news-count");
      if (c) c.textContent = items.length + " APPROVED ITEMS";
    } catch (e) {
      host.innerHTML = "<div class='empty'>// NEWS FEED UNAVAILABLE</div>";
      console.error(e);
    }
  });
})();
