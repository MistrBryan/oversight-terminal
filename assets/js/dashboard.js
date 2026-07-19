/* dashboard.js — renders spending metric cards + detail view from
   data/spending/*.json. Requires Chart.js (self-hosted, loaded in the page). */

(function () {
  "use strict";

  var GREEN = "#33ff66", DIM = "#1f9e43", RED = "#ff5e5e", AMBER = "#ffb642";
  var PIE = ["#33ff66", "#4fd6ff", "#ffb642", "#6cff96", "#a6ecff", "#1f9e43",
    "#ff9e6c", "#8fe3ff", "#d6ff6c", "#2f9e7a", "#ffd08a", "#5fbf7f"];

  function fmtValue(v, unit) {
    if (unit === "percent") return v.toFixed(1) + "%";
    if (unit === "USD_billions") {
      if (Math.abs(v) >= 1000) return "$" + (v / 1000).toFixed(2) + "<span class='unit'>T</span>";
      return "$" + Math.round(v).toLocaleString() + "<span class='unit'>B</span>";
    }
    return v.toLocaleString();
  }
  function fmtPlain(v) { return fmtValue(v, "USD_billions").replace(/<[^>]+>/g, ""); }

  // metric text originates from third-party APIs — never trust it as markup
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) {
    var s = String(u == null ? "" : u).trim();
    if (!/^https?:\/\//i.test(s)) return "#";
    return esc(s);
  }

  // group a breakdown into top N + aggregated "Other"
  function topN(breakdown, n) {
    if (breakdown.length <= n) return breakdown.slice();
    var top = breakdown.slice(0, n);
    var other = breakdown.slice(n).reduce(function (s, c) { return s + c.value; }, 0);
    return top.concat([{ name: "Other", value: other }]);
  }

  function pctChange(series) {
    if (!series || series.length < 2) return null;
    var a = series[series.length - 2].value, b = series[series.length - 1].value;
    if (!a) return null;
    return ((b - a) / Math.abs(a)) * 100;
  }

  function sparkline(canvas, series, color) {
    return new Chart(canvas, {
      type: "line",
      data: {
        labels: series.map(function (p) { return p.period; }),
        datasets: [{
          data: series.map(function (p) { return p.value; }),
          borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.25,
          fill: true,
          backgroundColor: function (ctx) {
            var g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 60);
            g.addColorStop(0, "rgba(51,255,102,0.25)");
            g.addColorStop(1, "rgba(51,255,102,0)");
            return g;
          }
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  }

  function fullChart(canvas, metric) {
    var neg = metric.series.some(function (p) { return p.value < 0; });
    return new Chart(canvas, {
      type: "bar",
      data: {
        labels: metric.series.map(function (p) { return p.period; }),
        datasets: [{
          data: metric.series.map(function (p) { return p.value; }),
          backgroundColor: neg ? "rgba(255,94,94,0.55)" : "rgba(51,255,102,0.45)",
          borderColor: neg ? RED : GREEN, borderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: DIM }, grid: { color: "rgba(51,255,102,0.08)" } },
          y: { ticks: { color: DIM }, grid: { color: "rgba(51,255,102,0.08)" } }
        }
      }
    });
  }

  function doughnut(canvas, breakdown) {
    var d = topN(breakdown, 8);
    return new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: d.map(function (c) { return c.name; }),
        datasets: [{
          data: d.map(function (c) { return c.value; }),
          backgroundColor: d.map(function (_, i) { return PIE[i % PIE.length]; }),
          borderColor: "#04140a", borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, cutout: "58%",
        plugins: {
          legend: { position: "right", labels: { color: "#b8ffcf", boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: function (c) { return c.label + ": $" + c.parsed.toLocaleString() + "B"; } } },
        },
      },
    });
  }

  // mini category bars for a breakdown card
  function catbars(breakdown) {
    var top = breakdown.slice(0, 4);
    var max = Math.max.apply(null, breakdown.map(function (c) { return c.value; }));
    return "<div class='catbars'>" + top.map(function (c, i) {
      return "<div class='catbar'>" +
        "<span class='cn'><i style='background:" + PIE[i % PIE.length] + "'></i>" + esc(c.name) + "</span>" +
        "<span class='cv'>" + fmtPlain(c.value) + "</span>" +
        "<b style='width:" + Math.round(c.value / max * 100) + "%'></b></div>";
    }).join("") + "</div>";
  }

  function card(metric) {
    var el = document.createElement("article");
    el.className = "panel metric-card";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", metric.title + " — open detail");

    var mid, isBreak = metric.kind === "breakdown", neg = false;
    if (isBreak) {
      mid = "<div class='value'>" + fmtValue(metric.total, "USD_billions") + "</div>" +
        "<div class='delta' style='color:var(--text-dim)'>" + metric.breakdown.length + " categories · total obligations</div>" +
        catbars(metric.breakdown);
    } else {
      var latest = metric.series[metric.series.length - 1];
      neg = latest.value < 0;
      var prev = metric.series[metric.series.length - 2];
      var deltaHtml = "";
      if (prev) {
        var up, amount, magnitude;
        if (metric.unit === "percent") {
          // percentage-POINT change is the correct reading for a ratio
          var diff = latest.value - prev.value;
          up = diff >= 0;
          magnitude = Math.abs(diff);
          amount = magnitude.toFixed(1) + " pts";
        } else {
          var change = pctChange(metric.series);
          up = change >= 0;
          magnitude = Math.abs(change);
          amount = magnitude.toFixed(1) + "%";
        }
        // a change that rounds to 0.0 is not a rise or fall — don't imply one
        if (magnitude < 0.05) {
          deltaHtml = "<div class='delta' style='color:var(--text-dim)'>— unchanged vs " + prev.period + "</div>";
          up = null;
        }
        if (up !== null) deltaHtml = "<div class='delta " + (up ? "up" : "down") + "'>" +
          (up ? "▲ " : "▼ ") + amount + " vs " + prev.period + "</div>";
      }
      mid = "<div class='value " + (neg ? "neg" : "") + "'>" + fmtValue(latest.value, metric.unit) + "</div>" +
        deltaHtml + "<div class='spark'><canvas></canvas></div>";
    }

    el.innerHTML =
      "<div class='label'><span>" + esc(metric.title) + "</span>" +
        "<span class='badge data'>DATA</span></div>" +
      mid +
      "<div class='ctx'>" + esc(metric.context) + "</div>" +
      "<div class='label' style='margin-top:10px'>" +
        "<span class='source-link'>SRC: " + esc(metric.dataSource) + "</span>" +
        "<span class='source-link'>" + esc(metric.fetchedAt) + "</span></div>";

    if (!isBreak) {
      setTimeout(function () {
        sparkline(el.querySelector("canvas"), metric.series, neg ? RED : GREEN);
      }, 0);
    }

    function open() { openDetail(metric); }
    el.addEventListener("click", open);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    return el;
  }

  var detailChartRef = null;
  function openDetail(metric) {
    var modal = document.getElementById("detail");
    var isBreak = metric.kind === "breakdown";
    var headValue, listHtml = "";

    if (isBreak) {
      headValue = fmtValue(metric.total, "USD_billions");
      listHtml = "<table class='src-table' style='margin-top:6px'><tr><th>Category</th><th>Amount</th><th>Share</th></tr>" +
        metric.breakdown.map(function (c) {
          return "<tr><td>" + esc(c.name) + "</td><td>" + fmtPlain(c.value) + "</td><td>" +
            (c.value / metric.total * 100).toFixed(1) + "%</td></tr>";
        }).join("") + "</table>";
    } else {
      var latest = metric.series[metric.series.length - 1];
      headValue = "<span class='" + (latest.value < 0 ? "neg' style='color:var(--red)" : "") + "'>" +
        fmtValue(latest.value, metric.unit) + "</span>";
    }

    modal.querySelector(".detail-body").innerHTML =
      "<div class='section-head'><h2>" + esc(metric.title) + "</h2>" +
        "<span class='tag'>" + (isBreak ? "USASPENDING.GOV" : metric.unit.replace("_", " ")) + "</span></div>" +
      "<div class='value' style='font-size:52px'>" + headValue + "</div>" +
      "<div style='height:280px;margin:14px 0'><canvas id='detail-canvas'></canvas></div>" +
      "<p class='ctx' style='font-size:15px'>" + esc(metric.context) + "</p>" +
      "<div class='callout'><b>WHY THIS MATTERS.</b> " +
        esc(metric.why || "This figure is one input into the overall fiscal picture; read it alongside the other metrics rather than in isolation.") + "</div>" +
      listHtml +
      "<table class='src-table'><tr><th>Numbers</th><td><a href='" + safeUrl(metric.dataSourceUrl) +
        "' target='_blank' rel='noopener noreferrer'>" + esc(metric.dataSource) + "</a> · fetched " + esc(metric.fetchedAt) + "</td></tr>" +
      (metric.contextSource ? "<tr><th>Context</th><td><a href='" + safeUrl(metric.contextSourceUrl) +
        "' target='_blank' rel='noopener noreferrer'>" + esc(metric.contextSource) + "</a></td></tr>" : "") +
      "</table>";

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (detailChartRef) detailChartRef.destroy();
    var canvas = document.getElementById("detail-canvas");
    detailChartRef = isBreak ? doughnut(canvas, metric.breakdown) : fullChart(canvas, metric);
    modal.querySelector(".detail-close").focus();
  }

  function closeDetail() {
    var modal = document.getElementById("detail");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (detailChartRef) { detailChartRef.destroy(); detailChartRef = null; }
  }

  async function load() {
    var host = document.getElementById("metrics");
    try {
      var idx = await (await fetch("data/spending/index.json", { cache: "no-store" })).json();
      var metrics = await Promise.all(idx.metrics.map(function (id) {
        return fetch("data/spending/" + id + ".json").then(function (r) { return r.json(); });
      }));
      host.innerHTML = "";
      metrics.forEach(function (m) { host.appendChild(card(m)); });

      // update ticker with latest headline figures
      var t = document.getElementById("ticker-line");
      if (t) {
        t.innerHTML = metrics.filter(function (m) { return m.series; }).slice(0, 5).map(function (m) {
          var v = m.series[m.series.length - 1];
          return "<span><b>" + m.title.toUpperCase() + ":</b> " + fmtValue(v.value, m.unit).replace(/<[^>]+>/g, "") + "</span>";
        }).join("");
      }
    } catch (e) {
      host.innerHTML = "<div class='empty'>// DATA FEED UNAVAILABLE — run tools/fetch-spending.mjs to populate</div>";
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.addEventListener("click", function (e) {
      if (e.target.closest(".detail-close") || e.target.classList.contains("detail-backdrop")) closeDetail();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });
    load();
  });
})();
