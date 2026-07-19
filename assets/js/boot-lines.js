/* boot-lines.js — the terminal boot sequence text for the dashboard.
   Kept in its own file (not inline) so the page can enforce a strict
   Content-Security-Policy with script-src 'self' (no 'unsafe-inline'). */

OVERSIGHT.boot([
  "OVERSIGHT TERMINAL — UNIFIED FISCAL MONITOR",
  "COPYRIGHT (C) PUBLIC DOMAIN DATA / OPEN SOURCE",
  "",
  "> MOUNTING DATA VOLUMES ......... OK",
  "> CONNECTING TREASURY FISCAL DATA ... OK",
  "> CONNECTING USASPENDING.GOV ....... OK",
  "> CONNECTING FRED (ST. LOUIS FED) ... OK",
  "> LOADING CURATED CONTEXT LAYER .... OK",
  "",
  "INITIALIZING OVERSIGHT TERMINAL_"
]);
