/* rs.js — Report Summaries client logic (portfolio grid + per-report page).
   No dependencies. Pins / saved-for-later live in localStorage. */
(function () {
  "use strict";
  var PIN_KEY = "rs_pins", SAVE_KEY = "rs_saved";

  function load(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } }
  function store(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }
  function has(key, slug) { return load(key).indexOf(slug) !== -1; }
  function toggle(key, slug) {
    var a = load(key), i = a.indexOf(slug);
    if (i === -1) a.push(slug); else a.splice(i, 1);
    store(key, a); return i === -1;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "rs-toast"; t.textContent = msg; document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 1800);
  }
  function copy(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove();
    return Promise.resolve();
  }

  /* ── charts: dependency-free inline SVG ── */
  var PALETTE = ["#2e6b3f", "#56bb6e", "#9e7132", "#173d2b", "#7fae6a", "#c2a878"];
  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function renderChart(host, ch) {
    var data = ch.data || [], W = 460, H = 240, pad = 34;
    if (!data.length) return;
    var type = ch.type || "bar";
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "rs-svg", role: "img" });
    var vals = data.map(function (d) { return +d.value || 0; });
    var max = Math.max.apply(null, vals.concat([0])) || 1;
    var min = Math.min.apply(null, vals.concat([0]));
    var range = (max - min) || 1;
    if (type === "pie") {
      var total = vals.reduce(function (a, b) { return a + b; }, 0) || 1, cx = 120, cy = H / 2, r = 90, ang = -Math.PI / 2;
      data.forEach(function (d, i) {
        var frac = (+d.value || 0) / total, a2 = ang + frac * 2 * Math.PI;
        var x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
        var x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
        var large = frac > 0.5 ? 1 : 0;
        svg.appendChild(svgEl("path", {
          d: "M" + cx + "," + cy + " L" + x1 + "," + y1 + " A" + r + "," + r + " 0 " + large + " 1 " + x2 + "," + y2 + " Z",
          fill: PALETTE[i % PALETTE.length]
        }));
        ang = a2;
      });
      var lx = 240, ly = 40;
      data.forEach(function (d, i) {
        svg.appendChild(svgEl("rect", { x: lx, y: ly + i * 22 - 10, width: 12, height: 12, rx: 2, fill: PALETTE[i % PALETTE.length] }));
        var t = svgEl("text", { x: lx + 20, y: ly + i * 22, class: "rs-svg-lbl" });
        t.textContent = (d.label || "") + " — " + (d.value != null ? d.value : "");
        svg.appendChild(t);
      });
    } else {
      var iw = W - pad * 2, ih = H - pad * 2, zeroY = pad + ih * (max / range);
      // baseline
      svg.appendChild(svgEl("line", { x1: pad, y1: zeroY, x2: W - pad, y2: zeroY, class: "rs-svg-axis" }));
      if (type === "line") {
        var step = iw / Math.max(data.length - 1, 1), pts = [];
        data.forEach(function (d, i) {
          var x = pad + step * i, y = pad + ih - ((+d.value || 0) - min) / range * ih;
          pts.push(x + "," + y);
          svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 3.5, fill: PALETTE[0] }));
        });
        svg.appendChild(svgEl("polyline", { points: pts.join(" "), fill: "none", stroke: PALETTE[0], "stroke-width": 2.5 }));
        data.forEach(function (d, i) {
          var x = pad + step * i, t = svgEl("text", { x: x, y: H - 10, class: "rs-svg-lbl", "text-anchor": "middle" });
          t.textContent = d.label || ""; svg.appendChild(t);
        });
      } else { // bar
        var bw = iw / data.length * 0.62, gap = iw / data.length;
        data.forEach(function (d, i) {
          var v = +d.value || 0, x = pad + gap * i + (gap - bw) / 2;
          var h = Math.abs(v) / range * ih, y = v >= 0 ? zeroY - h : zeroY;
          svg.appendChild(svgEl("rect", { x: x, y: y, width: bw, height: Math.max(h, 1), rx: 2, fill: PALETTE[i % PALETTE.length] }));
          var vt = svgEl("text", { x: x + bw / 2, y: y - 5, class: "rs-svg-val", "text-anchor": "middle" });
          vt.textContent = d.value != null ? d.value : ""; svg.appendChild(vt);
          var lt = svgEl("text", { x: x + bw / 2, y: H - 10, class: "rs-svg-lbl", "text-anchor": "middle" });
          lt.textContent = d.label || ""; svg.appendChild(lt);
        });
      }
    }
    host.appendChild(svg);
    if (ch.unit) { var u = document.createElement("span"); u.className = "rs-chart-unit"; u.textContent = ch.unit; host.parentNode.insertBefore(u, host.nextSibling); }
  }

  /* ── report page ── */
  function initReport() {
    var dataEl = document.getElementById("rs-data");
    if (!dataEl) return false;
    var meta = {};
    try { meta = JSON.parse(dataEl.textContent); } catch (e) {}
    var charts = meta.charts || [];
    document.querySelectorAll(".rs-chart-canvas").forEach(function (host) {
      var idx = +host.getAttribute("data-chart");
      if (charts[idx]) renderChart(host, charts[idx]);
    });
    // snippet copy buttons
    document.querySelectorAll(".rs-snip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var anchor = btn.getAttribute("data-anchor");
        var host = document.getElementById(anchor);
        var text = host ? host.innerText.replace(/↗/g, "").trim() : "";
        var link = location.href.split("#")[0] + "#" + anchor;
        copy(text + "\n\n— " + meta.source_name + " (" + meta.source_url + ")\nvia " + link)
          .then(function () { toast("Snippet + source copied"); });
      });
    });
    var share = document.getElementById("rs-share-page");
    if (share) share.addEventListener("click", function () {
      copy(location.href.split("#")[0]).then(function () { toast("Share link copied"); });
    });
    var save = document.getElementById("rs-save-page");
    if (save) {
      var slug = meta.slug;
      var sync = function () { save.textContent = has(SAVE_KEY, slug) ? "✓ Saved" : "Save for later"; save.classList.toggle("rs-on", has(SAVE_KEY, slug)); };
      sync();
      save.addEventListener("click", function () { toggle(SAVE_KEY, slug); sync(); });
    }
    // deep-link highlight
    if (location.hash) {
      var tgt = document.getElementById(location.hash.slice(1));
      if (tgt) { tgt.classList.add("rs-flash"); tgt.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }
    return true;
  }

  /* ── portfolio grid ── */
  function initGrid() {
    var grid = document.getElementById("rs-grid");
    if (!grid) return false;
    var state = { q: "", sort: "newest", filter: "all", reports: [] };
    var searchEl = document.getElementById("rs-search");
    var sortEl = document.getElementById("rs-sort");
    var countEl = document.getElementById("rs-count");

    function score(r, q) {
      if (!q) return 1;
      var hay = (r.title + " " + r.source_name + " " + r.tldr + " " + (r.tags || []).join(" ") + " " + (r.key_points || []).join(" ")).toLowerCase();
      var terms = q.toLowerCase().split(/\s+/).filter(Boolean), s = 0;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        if (hay.indexOf(t) === -1) {
          // fuzzy: allow subsequence match for typos
          var hi = 0, ti = 0;
          while (hi < hay.length && ti < t.length) { if (hay[hi] === t[ti]) ti++; hi++; }
          if (ti < t.length) return 0;
          s += 0.5;
        } else { s += (r.title.toLowerCase().indexOf(t) !== -1 ? 3 : 1); }
      }
      return s;
    }

    function render() {
      var pins = load(PIN_KEY), saved = load(SAVE_KEY);
      var rows = state.reports.map(function (r) { return { r: r, sc: score(r, state.q) }; })
        .filter(function (x) { return x.sc > 0; });
      if (state.filter === "saved") rows = rows.filter(function (x) { return saved.indexOf(x.r.slug) !== -1; });
      if (state.filter === "pinned") rows = rows.filter(function (x) { return pins.indexOf(x.r.slug) !== -1; });
      var cmp = {
        newest: function (a, b) { return (b.r.date_processed || "").localeCompare(a.r.date_processed || ""); },
        source: function (a, b) { return a.r.source_name.localeCompare(b.r.source_name); },
        relevance: function (a, b) { return b.sc - a.sc; }
      }[state.q ? "relevance" : state.sort] || cmp_newest;
      function cmp_newest(a, b) { return (b.r.date_processed || "").localeCompare(a.r.date_processed || ""); }
      rows.sort(cmp);
      // pinned always float to top
      rows.sort(function (a, b) { return (pins.indexOf(b.r.slug) !== -1) - (pins.indexOf(a.r.slug) !== -1); });

      grid.innerHTML = "";
      if (!rows.length) { grid.innerHTML = '<p class="rs-empty">No matching summaries.</p>'; }
      rows.forEach(function (x) {
        var r = x.r, pinned = pins.indexOf(r.slug) !== -1, isSaved = saved.indexOf(r.slug) !== -1;
        var card = document.createElement("article");
        card.className = "rs-card" + (pinned ? " rs-pinned" : "");
        var tags = (r.tags || []).slice(0, 4).map(function (t) { return '<span class="rs-tag">' + esc(t) + '</span>'; }).join("");
        var metaBits = [esc(r.source_type || "report"), esc(r.date_processed || "")];
        if (r.chart_count) metaBits.push(r.chart_count + (r.chart_count > 1 ? " charts" : " chart"));
        card.innerHTML =
          '<div class="rs-card-top">' +
            '<a class="rs-card-src" href="' + esc(r.source_url) + '" target="_blank" rel="noopener">' + esc(r.source_name) + ' ↗</a>' +
            '<div class="rs-card-acts">' +
              '<button class="rs-icon rs-pin' + (pinned ? " rs-on" : "") + '" title="Pin" data-slug="' + esc(r.slug) + '">📌</button>' +
              '<button class="rs-icon rs-save' + (isSaved ? " rs-on" : "") + '" title="Save for later" data-slug="' + esc(r.slug) + '">🔖</button>' +
            '</div>' +
          '</div>' +
          '<a class="rs-card-title" href="' + esc(r.url) + '">' + esc(r.title) + '</a>' +
          '<p class="rs-card-tldr">' + esc(r.tldr) + '</p>' +
          '<div class="rs-card-tags">' + tags + '</div>' +
          '<div class="rs-card-meta">' + metaBits.filter(Boolean).join(" · ") + '</div>';
        grid.appendChild(card);
      });
      countEl.textContent = rows.length + (rows.length === 1 ? " summary" : " summaries");

      grid.querySelectorAll(".rs-pin").forEach(function (b) {
        b.addEventListener("click", function () { toggle(PIN_KEY, b.getAttribute("data-slug")); render(); });
      });
      grid.querySelectorAll(".rs-save").forEach(function (b) {
        b.addEventListener("click", function () { toggle(SAVE_KEY, b.getAttribute("data-slug")); render(); });
      });
    }

    if (searchEl) searchEl.addEventListener("input", function () { state.q = searchEl.value; render(); });
    if (sortEl) sortEl.addEventListener("change", function () { state.sort = sortEl.value; render(); });
    document.querySelectorAll(".rs-filter").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".rs-filter").forEach(function (x) { x.classList.remove("rs-on"); });
        b.classList.add("rs-on"); state.filter = b.getAttribute("data-filter"); render();
      });
    });

    fetch("data/index.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      state.reports = j.reports || [];
      // support #tag=foo deep link from report pages
      var m = /tag=([^&]+)/.exec(location.hash);
      if (m && searchEl) { searchEl.value = decodeURIComponent(m[1]); state.q = searchEl.value; }
      render();
    }).catch(function () { grid.innerHTML = '<p class="rs-empty">No summaries yet. Drop a link or document in Discord to add one.</p>'; countEl.textContent = ""; });
    return true;
  }

  document.addEventListener("DOMContentLoaded", function () { initReport(); initGrid(); });
})();
