/* rs.js — Report Summaries client logic (portfolio grid + per-report page).
   No dependencies. Pins / saved-for-later live in localStorage. */
(function () {
  "use strict";
  var PIN_KEY = "rs_pins", SAVE_KEY = "rs_saved";

  /* ── line icons (no emoji anywhere on this page) ── */
  var ICON = {
    pin: '<path d="M12 17v5"/><path d="M8.5 3h7l-.7 4.2a4 4 0 0 0 1.1 3.4L18 12H6l2.1-1.4a4 4 0 0 0 1.1-3.4L8.5 3Z"/>',
    bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
    check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
    external: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    arrowRight: '<path d="M5 12h14"/><path d="M13 5l7 7-7 7"/>'
  };
  function icon(name, cls) {
    return '<svg class="rs-ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + "</svg>";
  }

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
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function prettyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? MONTHS[+m[2] - 1] + " " + m[1] : esc(iso || "");
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

  /* ── charts: dependency-free inline SVG, McKinsey exhibit conventions ──
     One measure, one colour; a second colour appears only where a datum sets
     `highlight: true`. Categories read horizontally so no label is ever rotated
     or wrapped under a bar. Values sit at the end of the mark, the unit lives in
     the subtitle, and the only rule on the plot is the baseline.

     types: bar (horizontal, default) | column (vertical, ordered series)
            stacked (100% share) | line (trend) */
  var GREEN = "#2e6b3f", ACCENT = "#9e7132";
  var SHARE_RAMP = ["#2e6b3f", "#7fae6a", "#c2a878", "#173d2b", "#56bb6e", "#9e7132"];
  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function txt(svg, s, attrs) {
    var t = svgEl("text", attrs); t.textContent = s; svg.appendChild(t); return t;
  }
  function fmt(v) { return v == null ? "" : String(v); }
  function wrapLabel(svg, text, x, y, maxChars, anchor) {
    var words = String(text || "").split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) {
      if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
      else { cur = (cur + " " + w).trim(); }
    });
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach(function (ln, i) {
      txt(svg, ln, { x: x, y: y + i * 12, class: "rs-svg-lbl", "text-anchor": anchor || "middle" });
    });
  }

  function renderChart(host, ch) {
    var data = ch.data || [];
    if (!data.length) return;
    var type = ch.type || "bar";
    var W = 460;
    var vals = data.map(function (d) { return +d.value || 0; });
    var max = Math.max.apply(null, vals.concat([0])) || 1;
    var min = Math.min.apply(null, vals.concat([0]));
    var range = (max - min) || 1;

    if (type === "stacked") {
      var total = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
      var H0 = 62 + data.length * 22, barY = 16, barH = 40, x0 = 0;
      var svg0 = svgEl("svg", { viewBox: "0 0 " + W + " " + H0, class: "rs-svg", role: "img" });
      data.forEach(function (d, i) {
        var w = (+d.value || 0) / total * W;
        svg0.appendChild(svgEl("rect", { x: x0, y: barY, width: Math.max(w, 1), height: barH,
          fill: SHARE_RAMP[i % SHARE_RAMP.length] }));
        if (w > 34) {
          txt(svg0, fmt(d.value), { x: x0 + w / 2, y: barY + barH / 2 + 5, class: "rs-svg-val-on",
            "text-anchor": "middle" });
        }
        x0 += w;
      });
      data.forEach(function (d, i) {
        var ly = barY + barH + 26 + i * 22;
        svg0.appendChild(svgEl("rect", { x: 1, y: ly - 9, width: 11, height: 11, rx: 1,
          fill: SHARE_RAMP[i % SHARE_RAMP.length] }));
        txt(svg0, d.label || "", { x: 20, y: ly, class: "rs-svg-lbl" });
        txt(svg0, fmt(d.value), { x: W - 1, y: ly, class: "rs-svg-val", "text-anchor": "end" });
      });
      host.appendChild(svg0);
      return;
    }

    if (type === "column" || type === "line") {
      var padT = 30, padB = 46, padX = 30, H = 236;
      var iw = W - padX * 2, ih = H - padT - padB, zeroY = padT + ih * (max / range);
      var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "rs-svg", role: "img" });
      svg.appendChild(svgEl("line", { x1: padX, y1: zeroY, x2: W - padX, y2: zeroY, class: "rs-svg-axis" }));
      if (type === "line") {
        var step = iw / Math.max(data.length - 1, 1), pts = [];
        data.forEach(function (d, i) {
          pts.push((padX + step * i) + "," + (padT + ih - ((+d.value || 0) - min) / range * ih));
        });
        svg.appendChild(svgEl("polyline", { points: pts.join(" "), fill: "none", stroke: GREEN,
          "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        data.forEach(function (d, i) {
          var x = padX + step * i, y = padT + ih - ((+d.value || 0) - min) / range * ih;
          svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 3.5, fill: d.highlight ? ACCENT : GREEN }));
          txt(svg, fmt(d.value), { x: x, y: y - 10, class: "rs-svg-val", "text-anchor": "middle" });
          wrapLabel(svg, d.label, x, H - 22, 13);
        });
      } else {
        var gap = iw / data.length, bw = Math.min(gap * 0.5, 54);
        data.forEach(function (d, i) {
          var v = +d.value || 0, x = padX + gap * i + (gap - bw) / 2;
          var h = Math.abs(v) / range * ih, y = v >= 0 ? zeroY - h : zeroY;
          svg.appendChild(svgEl("rect", { x: x, y: y, width: bw, height: Math.max(h, 1),
            fill: d.highlight ? ACCENT : GREEN }));
          txt(svg, fmt(d.value), { x: x + bw / 2, y: y - 9, class: "rs-svg-val", "text-anchor": "middle" });
          wrapLabel(svg, d.label, x + bw / 2, H - 22, Math.max(11, Math.floor(gap / 5)));
        });
      }
      host.appendChild(svg);
      return;
    }

    // horizontal bars (default). Labels are measured, not estimated, so the
    // category gutter always fits the longest one instead of clipping it.
    var rowH = 34, topPad = 6, valW = 44;
    var Hb = topPad + data.length * rowH + 8;
    var svgb = svgEl("svg", { viewBox: "0 0 " + W + " " + Hb, class: "rs-svg", role: "img" });
    var labels = data.map(function (d, i) {
      return txt(svgb, d.label || "", { x: 0, y: topPad + i * rowH + rowH / 2 + 4,
        class: "rs-svg-lbl", "text-anchor": "end" });
    });
    host.appendChild(svgb); // must be in the document before text can be measured

    var widest = 0;
    labels.forEach(function (t) {
      var w = 0;
      try { w = t.getComputedTextLength(); } catch (e) { w = String(t.textContent).length * 5.9; }
      widest = Math.max(widest, w);
    });
    // viewBox units: getComputedTextLength reports user units, which is what we want
    var g = Math.min(Math.max(widest + 2, 60), W * 0.46);
    var plotX = g + 12, plotW = W - plotX - valW;
    var absMax = Math.max.apply(null, vals.map(Math.abs).concat([1]));

    labels.forEach(function (t) {
      t.setAttribute("x", g);
      var w = 0;
      try { w = t.getComputedTextLength(); } catch (e) {}
      // a label longer than the gutter gets condensed rather than clipped
      if (w > g) { t.setAttribute("textLength", g); t.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
    });
    data.forEach(function (d, i) {
      var v = +d.value || 0, cy = topPad + i * rowH + rowH / 2;
      var w = Math.abs(v) / absMax * plotW;
      svgb.appendChild(svgEl("rect", { x: plotX, y: cy - 9, width: Math.max(w, 1), height: 18,
        fill: d.highlight ? ACCENT : GREEN }));
      txt(svgb, fmt(d.value), { x: plotX + w + 8, y: cy + 4, class: "rs-svg-val" });
    });
    svgb.appendChild(svgEl("line", { x1: plotX, y1: topPad, x2: plotX, y2: Hb - 8, class: "rs-svg-axis" }));
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
      btn.innerHTML = icon("external", "rs-ico-sm");
      btn.setAttribute("aria-label", "Copy shareable snippet");
      btn.addEventListener("click", function () {
        var anchor = btn.getAttribute("data-anchor");
        var host = document.getElementById(anchor);
        var text = "";
        if (host) {
          var clone = host.cloneNode(true);
          var b = clone.querySelector(".rs-snip");
          if (b) b.parentNode.removeChild(b);
          text = clone.textContent.replace(/\s*\n\s*/g, "\n").trim();
        }
        var link = location.href.split("#")[0] + "#" + anchor;
        copy(text + "\n\nSource: " + meta.source_name + " (" + meta.source_url + ")\nvia " + link)
          .then(function () { toast("Snippet and source copied"); });
      });
    });
    var share = document.getElementById("rs-share-page");
    if (share) {
      share.innerHTML = icon("link", "rs-ico-sm") + "Copy share link";
      share.addEventListener("click", function () {
        copy(location.href.split("#")[0]).then(function () { toast("Share link copied"); });
      });
    }
    var save = document.getElementById("rs-save-page");
    if (save) {
      var slug = meta.slug;
      var sync = function () {
        var on = has(SAVE_KEY, slug);
        save.innerHTML = icon(on ? "check" : "bookmark", "rs-ico-sm") + (on ? "Saved" : "Save for later");
        save.classList.toggle("rs-on", on);
      };
      sync();
      save.addEventListener("click", function () { toggle(SAVE_KEY, slug); sync(); });
    }
    // expand / collapse all sections
    var toggleAll = document.getElementById("rs-toggle-all");
    if (toggleAll) {
      var secs = function () { return Array.prototype.slice.call(document.querySelectorAll("details.rs-sec")); };
      var syncAll = function () {
        var anyOpen = secs().some(function (s) { return s.open; });
        toggleAll.textContent = anyOpen ? "Collapse all" : "Expand all";
        toggleAll.setAttribute("aria-expanded", anyOpen ? "true" : "false");
      };
      toggleAll.addEventListener("click", function () {
        var open = !secs().some(function (s) { return s.open; });
        secs().forEach(function (s) { s.open = open; });
        syncAll();
      });
      secs().forEach(function (s) { s.addEventListener("toggle", syncAll); });
      syncAll();
    }
    // deep-link highlight: open the target section if it is collapsed
    if (location.hash) {
      var tgt = document.getElementById(location.hash.slice(1));
      if (tgt) {
        if (tgt.tagName === "DETAILS") tgt.open = true;
        var host = tgt.closest ? tgt.closest("details") : null;
        if (host) host.open = true;
        tgt.classList.add("rs-flash");
        tgt.scrollIntoView({ behavior: "smooth", block: "center" });
      }
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
      function cmpNewest(a, b) { return (b.r.date_processed || "").localeCompare(a.r.date_processed || ""); }
      var cmp = {
        newest: cmpNewest,
        source: function (a, b) { return a.r.source_name.localeCompare(b.r.source_name); },
        relevance: function (a, b) { return b.sc - a.sc; }
      }[state.q ? "relevance" : state.sort] || cmpNewest;
      rows.sort(cmp);
      // pinned always float to top
      rows.sort(function (a, b) { return (pins.indexOf(b.r.slug) !== -1) - (pins.indexOf(a.r.slug) !== -1); });

      grid.innerHTML = "";
      if (!rows.length) { grid.innerHTML = '<p class="rs-empty">No matching summaries.</p>'; }
      rows.forEach(function (x) {
        var r = x.r, pinned = pins.indexOf(r.slug) !== -1, isSaved = saved.indexOf(r.slug) !== -1;
        var card = document.createElement("article");
        card.className = "rs-card" + (pinned ? " rs-pinned" : "");
        var tags = (r.tags || []).slice(0, 4).map(function (t) { return '<span class="rs-tag">' + esc(t) + "</span>"; }).join("");
        var metaBits = [prettyDate(r.date_processed)];
        if (r.reading_time_min) metaBits.push(r.reading_time_min + " min read");
        card.innerHTML =
          '<div class="rs-card-top">' +
            '<a class="rs-card-src" href="' + esc(r.source_url) + '" target="_blank" rel="noopener">' + esc(r.source_name) + icon("external", "rs-ico-sm") + "</a>" +
            '<div class="rs-card-acts">' +
              '<button class="rs-icon rs-pin' + (pinned ? " rs-on" : "") + '" title="Pin to top" aria-label="Pin to top" data-slug="' + esc(r.slug) + '">' + icon("pin") + "</button>" +
              '<button class="rs-icon rs-save' + (isSaved ? " rs-on" : "") + '" title="Save for later" aria-label="Save for later" data-slug="' + esc(r.slug) + '">' + icon("bookmark") + "</button>" +
            "</div>" +
          "</div>" +
          '<a class="rs-card-title" href="' + esc(r.url) + '">' + esc(r.title) + "</a>" +
          '<p class="rs-card-tldr">' + esc(r.tldr) + "</p>" +
          '<div class="rs-card-tags">' + tags + "</div>" +
          '<div class="rs-card-foot">' +
            '<span class="rs-card-meta">' + metaBits.filter(Boolean).join(" &middot; ") + "</span>" +
            '<a class="rs-card-cta" href="' + esc(r.url) + '">Read the summary' + icon("arrowRight", "rs-ico-sm") + "</a>" +
          "</div>";
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

    // seed the static control icons
    var pinFilter = document.querySelector('.rs-filter[data-filter="pinned"]');
    if (pinFilter) pinFilter.innerHTML = icon("pin", "rs-ico-sm") + "Pinned";
    var saveFilter = document.querySelector('.rs-filter[data-filter="saved"]');
    if (saveFilter) saveFilter.innerHTML = icon("bookmark", "rs-ico-sm") + "Saved";
    var searchIcon = document.querySelector(".rs-search-wrap");
    if (searchIcon) searchIcon.insertAdjacentHTML("afterbegin",
      '<svg class="rs-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>');

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
    }).catch(function () {
      grid.innerHTML = '<p class="rs-empty">No summaries published yet.</p>';
      countEl.textContent = "";
    });
    return true;
  }

  document.addEventListener("DOMContentLoaded", function () { initReport(); initGrid(); });
})();
