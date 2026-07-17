/* effects.js — boot sequence, CRT fx toggle, shared chrome.
   Loaded on every page. No dependencies. */

(function () {
  "use strict";

  /* ---- persisted effects / high-contrast toggle ---- */
  var FX_KEY = "oversight-fx";
  function applyFx(state) {
    document.documentElement.setAttribute("data-fx", state);
  }
  var saved = null;
  try { saved = localStorage.getItem(FX_KEY); } catch (e) {}
  // respect prefers-reduced-motion as the default-off signal
  var prefersReduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  applyFx(saved || (prefersReduced ? "off" : "on"));

  window.OVERSIGHT = window.OVERSIGHT || {};
  window.OVERSIGHT.toggleFx = function () {
    var cur = document.documentElement.getAttribute("data-fx") === "off" ? "on" : "off";
    applyFx(cur);
    try { localStorage.setItem(FX_KEY, cur); } catch (e) {}
    updateFxButton();
  };
  function updateFxButton() {
    var btn = document.querySelector(".fx-toggle");
    if (!btn) return;
    var off = document.documentElement.getAttribute("data-fx") === "off";
    btn.textContent = off ? "[ EFFECTS: OFF ]" : "[ EFFECTS: ON ]";
    btn.setAttribute("aria-pressed", off ? "true" : "false");
  }
  document.addEventListener("click", function (e) {
    if (e.target && e.target.classList.contains("fx-toggle")) window.OVERSIGHT.toggleFx();
  });
  document.addEventListener("DOMContentLoaded", updateFxButton);

  /* ---- one-time boot sequence (skipped when fx off or reduced-motion) ---- */
  window.OVERSIGHT.boot = function (lines, done) {
    var host = document.getElementById("boot");
    var fxOff = document.documentElement.getAttribute("data-fx") === "off";
    var seen = false;
    try { seen = sessionStorage.getItem("oversight-booted") === "1"; } catch (e) {}
    if (!host || fxOff || prefersReduced || seen) {
      if (host) host.remove();
      if (done) done();
      return;
    }
    try { sessionStorage.setItem("oversight-booted", "1"); } catch (e) {}
    host.setAttribute("role", "status");
    var i = 0;
    (function next() {
      if (i >= lines.length) {
        setTimeout(function () {
          host.style.transition = "opacity .4s";
          host.style.opacity = "0";
          setTimeout(function () { host.remove(); if (done) done(); }, 420);
        }, 320);
        return;
      }
      var row = document.createElement("div");
      row.textContent = lines[i];
      host.appendChild(row);
      i++;
      setTimeout(next, 180 + Math.random() * 160);
    })();
  };
})();
