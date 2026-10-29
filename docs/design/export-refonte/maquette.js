/*
 * Maquette interactive de l'écran « Exporter » — données SIMULÉES (aucun audio, aucun verset réel).
 * La frise reproduit les comportements décrits dans SPEC.md §4 : poignées, souffle, aimant, zoom,
 * vue d'ensemble, précision au doigt (appui long), clavier, lecture (simulée) de la plage.
 */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const BG_DIR = "../../../web/public/backgrounds/";

  /* ───────────── Données simulées : 51:20 de tarawih, 38 passages en 4 groupes ───────────── */
  const D = 3080; // secondes
  const PPS = 10; // crêtes par seconde (le produit en a 50 : /api/sessions/{id}/peaks)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const verses = []; // {i, s, e, st: rec|inf|unc}
  const nq = []; // zones non coraniques {s, e}
  nq.push({ s: 4, e: 31 });
  const groups = [40, 760, 1720, 2420];
  let n = 1;
  groups.forEach((g0, gi) => {
    let t = g0;
    const count = gi === 0 ? 10 : gi === 1 ? 10 : gi === 2 ? 9 : 9;
    for (let k = 0; k < count; k++) {
      const len = 6 + rnd() * 17;
      const st = n === 14 || n === 29 ? (n === 14 ? "unc" : "inf") : n === 7 || n === 22 ? "inf" : "rec";
      verses.push({ i: n++, s: t, e: t + len, st });
      t += len + 1.4 + rnd() * 2.4;
    }
    if (gi < 3) nq.push({ s: t + 25, e: t + 25 + 40 + rnd() * 60 });
  });
  nq.push({ s: 2980, e: 3060 });
  const peaks = new Float32Array(D * PPS);
  for (let k = 0; k < peaks.length; k++) {
    const t = k / PPS;
    const v = verses.find((x) => t >= x.s && t <= x.e);
    const z = nq.find((x) => t >= x.s && t <= x.e);
    if (v) {
      const w = Math.abs(Math.sin(t * 2.1 + v.i)) * 0.55 + 0.3;
      peaks[k] = Math.min(1, w * (0.65 + rnd() * 0.45)) * (Math.sin(t * 0.9 + v.i) > -0.92 ? 1 : 0.15);
    } else if (z) peaks[k] = 0.15 + rnd() * 0.35;
    else peaks[k] = 0.015 + rnd() * 0.04;
  }
  const SILENT = 0.07;

  /* ───────────── État ───────────── */
  const st = {
    tab: params.get("tab") || "video",
    source: params.get("source") || "audio",
    state: params.get("state") || "idle",
    pre: 0.6, post: 0.4, magnet: true,
    ranges: [], sel: null, nextId: 1,
    view: { a: 0, b: D },
    playing: null, playT: 0,
    showAll: false,
    prefs: { o: "16:9", bg: "mosquee-crepuscule", ar: 72, tr: 30, showTr: true, wave: true, pos: 50, fill: false, res: 1080, fps: 30 },
  };

  /* ───────────── Format du temps (même règle que formatTimeInput du produit) ───────────── */
  const fmt = (v) => {
    const whole = Math.floor(v + 1e-6);
    let tenths = Math.round((v - whole) * 10);
    let tot = whole + (tenths === 10 ? 1 : 0);
    tenths %= 10;
    const h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
    const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    return `${base},${tenths}`;
  };
  const dur = (sec) => {
    if (sec < 60) return `${sec.toFixed(1).replace(".", ",")} s`;
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (m < 60) return `${m} min ${String(s).padStart(2, "0")} s`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  };
  const spoken = (v) => {
    const m = Math.floor(v / 60), s = (v % 60).toFixed(1).replace(".", ",");
    return m ? `${m} min ${s} s` : `${s} s`;
  };
  const parseTime = (text) => {
    const c = text.trim().replace(",", ".").replace(/\s*s$/, "");
    if (!c) return null;
    const parts = c.split(":");
    if (parts.length > 3) return null;
    let tot = 0;
    for (const p of parts) { if (!/^\d+(\.\d+)?$/.test(p)) return null; tot = tot * 60 + Number(p); }
    return tot;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ───────────── Plages : souffle + aimant ───────────── */
  const peakAt = (t) => peaks[clamp(Math.round(t * PPS), 0, peaks.length - 1)];
  /** Bord calé sur le silence le plus proche (±0,8 s), sans jamais entrer dans la voix. */
  const snapSilence = (t, side, voiceEdge) => {
    if (!st.magnet) return t;
    let best = null;
    for (let d = 0; d <= 0.8; d += 1 / PPS) {
      for (const c of [t - d, t + d]) {
        if (c < 0 || c > D) continue;
        if (side === "s" && c > voiceEdge - 0.15) continue;
        if (side === "e" && c < voiceEdge + 0.15) continue;
        if (peakAt(c) < SILENT) { best = c; break; }
      }
      if (best !== null) break;
    }
    return best ?? t;
  };
  const voiceIn = (r) => {
    const inside = [...verses, ...nq.map((z) => ({ ...z, nq: true }))].filter((x) => x.e > r.start && x.s < r.end);
    if (!inside.length) return null;
    return { s: Math.min(...inside.map((x) => x.s)), e: Math.max(...inside.map((x) => x.e)) };
  };
  const versesIn = (r) => verses.filter((v) => v.e > r.start + 0.2 && v.s < r.end - 0.2);
  const fromVerses = (list, name) => {
    const s0 = list[0].s, e0 = list[list.length - 1].e;
    const start = clamp(snapSilence(s0 - st.pre, "s", s0), 0, D);
    const end = clamp(snapSilence(e0 + st.post, "e", e0), 0, D);
    return { id: st.nextId++, start, end, name, auto: true };
  };
  const vName = (list) => (list.length === 1 ? `Passage ${list[0].i}` : `Passages ${list[0].i} à ${list[list.length - 1].i}`);

  st.ranges = [
    fromVerses(verses.slice(3, 6), vName(verses.slice(3, 6))),
    fromVerses([verses[11]], vName([verses[11]])),
    fromVerses(verses.slice(23, 26), vName(verses.slice(23, 26))),
  ];
  st.sel = st.ranges[clamp(Number(params.get("sel") || 1) - 1, 0, 2)].id;
  const selR = () => st.ranges.find((r) => r.id === st.sel) || null;

  /* ───────────── Couleurs résolues depuis les tokens (light-dark compris) ───────────── */
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  let C = {};
  const readColors = () => {
    const get = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
    C = {
      accent: get("--accent"), warn: get("--warn-edge"), slate: get("--slate-edge"), text3: get("--text-3"), text2: get("--text-2"),
      wave: get("--wave"), played: get("--wave-played"), ink: get("--action-bg"), border: get("--border"), surface: get("--surface-1"),
      sub: get("--border-subtle"), ok: get("--ok"),
    };
  };
  const alpha = (rgb, a) => rgb.replace("rgb(", "rgba(").replace(")", `, ${a})`);

  /* ───────────── Thème ───────────── */
  const setTheme = (v) => {
    if (v === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
    readColors();
    drawAll();
  };

  /* ───────────── Images (fonds du produit, Pexels) ───────────── */
  const PHOTOS = [
    ["mosquee-crepuscule", "Mosquée au crépuscule"], ["mosquee-arche-bleue", "Arche bleue"], ["mosquee-minarets", "Minarets"],
    ["mosquee-faience", "Faïence"], ["desert-dunes", "Dunes"], ["desert-nuit", "Désert de nuit"], ["ciel-orange", "Ciel orangé"],
    ["foret-brume", "Forêt dans la brume"], ["foret-lumiere", "Forêt lumineuse"],
  ];
  const GRADS = [
    ["nuit-doree", "Nuit dorée", "#0d1b2a", "#16263a", "rgba(216,180,90,.20)", "hsl(43 62% 64%)"],
    ["emeraude", "Émeraude", "#0b2a24", "#123f35", "rgba(120,220,180,.18)", "hsl(158 55% 70%)"],
    ["aube", "Aube", "#2a1f3d", "#4a2c4d", "rgba(255,170,120,.22)", "hsl(20 85% 74%)"],
    ["sable", "Sable sombre", "#2b2218", "#3d3022", "rgba(240,200,130,.20)", "hsl(38 62% 68%)"],
    ["ardoise", "Ardoise", "#1a1d23", "#2a2f38", "rgba(160,180,210,.16)", "hsl(210 55% 76%)"],
  ];
  const thumbs = PHOTOS.map(([id]) => { const im = new Image(); im.src = `${BG_DIR}thumb-${id}.jpg`; im.onload = () => drawMain(); return im; });

  /* ───────────── Canvases de la frise ───────────── */
  const stageF = $("#stage-f"), mainC = $("#main-c"), miniC = $("#mini-c"), overlay = $("#overlay");
  const RULER = 18, THUMB = 48, LANE = 22;
  const waveH = () => (innerWidth < 768 ? 92 : 112);
  const topWave = () => RULER + (st.source === "video" ? THUMB + 4 : 0) + LANE + 6;
  const fullH = () => topWave() + waveH() + 6;
  const W = () => stageF.clientWidth;
  const span = () => st.view.b - st.view.a;
  const X = (t) => ((t - st.view.a) / span()) * W();
  const T = (x) => st.view.a + (x / W()) * span();
  const MIN_SPAN = 8;

  const fitCanvas = (c, w, h) => {
    const dpr = devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.height = `${h}px`;
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g;
  };
  const pattern = (g, kind, color) => {
    const p = document.createElement("canvas"); p.width = p.height = 6;
    const q = p.getContext("2d"); q.strokeStyle = color; q.fillStyle = color; q.lineWidth = 1.2;
    if (kind === "hatch") { q.beginPath(); q.moveTo(0, 6); q.lineTo(6, 0); q.stroke(); }
    else { q.beginPath(); q.arc(3, 3, 1.1, 0, 7); q.fill(); }
    return g.createPattern(p, "repeat");
  };

  function drawMain() {
    if (!mainC.isConnected || !W()) return;
    const w = W(), h = fullH();
    const g = fitCanvas(mainC, w, h);
    g.clearRect(0, 0, w, h);
    // Règle
    const target = (span() / w) * 90;
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s >= target) || 600;
    g.font = "600 11px 'Atkinson Hyperlegible Mono', monospace"; g.fillStyle = C.text3; g.strokeStyle = C.sub; g.lineWidth = 1;
    for (let t = Math.ceil(st.view.a / step) * step; t <= st.view.b; t += step) {
      const x = Math.round(X(t)) + 0.5;
      g.beginPath(); g.moveTo(x, RULER - 5); g.lineTo(x, h); g.stroke();
      const lbl = fmt(t).replace(/,0$/, "");
      if (x + 4 + g.measureText(lbl).width < w) g.fillText(lbl, x + 3, 12);
    }
    let y = RULER;
    // Imagettes (vidéo importée) : une tous les 64 px, prises au temps du milieu de la tuile
    if (st.source === "video") {
      for (let x = 0; x < w; x += 64) {
        const t = T(x + 32), im = thumbs[Math.floor(t / 340) % thumbs.length];
        if (im.complete && im.naturalWidth) {
          const r = im.naturalWidth / im.naturalHeight, sh = im.naturalHeight, sw = Math.min(im.naturalWidth, sh * (64 / THUMB));
          g.drawImage(im, (im.naturalWidth - sw) / 2, 0, sw, sh, x, y, 63, THUMB);
          void r;
        } else { g.fillStyle = C.sub; g.fillRect(x, y, 63, THUMB); }
      }
      y += THUMB + 4;
    }
    // Rangée des passages (le motif porte le statut, jamais la couleur seule)
    const hatch = pattern(g, "hatch", C.accent), dots = pattern(g, "dots", C.warn);
    for (const z of nq) {
      if (z.e < st.view.a || z.s > st.view.b) continue;
      const x0 = X(z.s), x1 = X(z.e);
      g.fillStyle = alpha(C.slate, 0.22); g.fillRect(x0, y + 4, x1 - x0, LANE - 8);
      g.strokeStyle = C.slate; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y + 4.5); g.lineTo(x1, y + 4.5); g.moveTo(x0, y + LANE - 4.5); g.lineTo(x1, y + LANE - 4.5); g.stroke();
    }
    g.font = "700 10px 'Atkinson Hyperlegible Mono', monospace"; g.textBaseline = "middle";
    for (const v of verses) {
      if (v.e < st.view.a || v.s > st.view.b) continue;
      const x0 = X(v.s), x1 = X(v.e), ww = Math.max(2, x1 - x0);
      const col = v.st === "unc" ? C.warn : C.accent;
      g.fillStyle = v.st === "rec" ? alpha(C.accent, 0.26) : v.st === "inf" ? hatch : dots;
      g.fillRect(x0, y, ww, LANE);
      g.strokeStyle = col; g.lineWidth = 1.5;
      if (v.st === "unc") g.setLineDash([3, 2]); else if (v.st === "inf") g.setLineDash([6, 3]);
      g.strokeRect(x0 + 0.75, y + 0.75, ww - 1.5, LANE - 1.5); g.setLineDash([]);
      if (ww > 22) { g.fillStyle = col; g.fillText(String(v.i), x0 + 5, y + LANE / 2 + 1); }
    }
    g.textBaseline = "alphabetic";
    y = topWave();
    // Onde : colonne par pixel, plus foncée dans une plage
    const mid = y + waveH() / 2, amp = waveH() / 2 - 2;
    for (let x = 0; x < w; x += 2) {
      const t0 = T(x), t1 = T(x + 2);
      let m = 0;
      for (let k = Math.floor(t0 * PPS); k <= Math.ceil(t1 * PPS) && k < peaks.length; k++) if (k >= 0 && peaks[k] > m) m = peaks[k];
      const inside = st.ranges.some((r) => t0 >= r.start && t0 <= r.end);
      g.fillStyle = inside ? C.played : C.wave;
      const hh = Math.max(1, m * amp);
      g.fillRect(x, mid - hh, 1.4, hh * 2);
    }
    // Silences candidats de l'aimant (petites marques), seulement au zoom fin
    if (st.magnet && span() < 120) {
      g.fillStyle = C.ok;
      for (let x = 0; x < w; x += 3) if (peakAt(T(x)) < SILENT) g.fillRect(x, h - 4, 2, 2);
    }
    placeRanges();
  }

  function drawMini() {
    const w = $("#mini").clientWidth, h = 34;
    if (!w) return;
    const g = fitCanvas(miniC, w, h);
    miniC.style.height = "100%";
    const x = (t) => (t / D) * w;
    for (let px = 0; px < w; px++) {
      let m = 0;
      const k0 = Math.floor((px / w) * D * PPS), k1 = Math.floor(((px + 1) / w) * D * PPS);
      for (let k = k0; k < k1; k += 3) if (peaks[k] > m) m = peaks[k];
      g.fillStyle = C.wave; g.fillRect(px, h / 2 - m * 11, 1, m * 22 + 0.5);
    }
    for (const r of st.ranges) {
      g.fillStyle = r.id === st.sel ? C.ink : C.text3;
      g.fillRect(x(r.start), h - 5, Math.max(2, x(r.end) - x(r.start)), 4);
    }
    for (const v of verses) if (v.st !== "rec") { g.fillStyle = v.st === "unc" ? C.warn : C.accent; g.fillRect(x(v.s) - 1, 1, 3, 5); }
    const view = $("#mini-view");
    view.style.left = `${(st.view.a / D) * 100}%`;
    view.style.width = `${(span() / D) * 100}%`;
    view.setAttribute("aria-valuenow", String(Math.round(st.view.a)));
    view.setAttribute("aria-valuetext", `De ${spoken(st.view.a)} à ${spoken(st.view.b)}`);
  }

  /* ───────────── Plages posées sur la frise (DOM : focus, lecteur d'écran, cibles 44 px) ───────────── */
  function placeRanges() {
    overlay.style.top = `${RULER + (st.source === "video" ? 0 : 0)}px`;
    overlay.innerHTML = "";
    st.ranges.forEach((r, idx) => {
      if (r.end < st.view.a || r.start > st.view.b) return;
      const el = document.createElement("div");
      el.className = "plage"; el.dataset.selected = String(r.id === st.sel); el.dataset.id = r.id;
      const x0 = X(r.start), x1 = X(r.end);
      el.style.left = `${x0}px`; el.style.width = `${Math.max(2, x1 - x0)}px`;
      const voice = voiceIn(r);
      let br = "";
      if (voice) {
        const bl = clamp(X(voice.s) - x0, 0, x1 - x0), brw = clamp(x1 - X(voice.e), 0, x1 - x0);
        if (bl > 0.5) br += `<i class="breath" style="left:0;width:${bl}px"></i>`;
        if (brw > 0.5) br += `<i class="breath" style="right:0;width:${brw}px"></i>`;
      }
      el.innerHTML = `<div class="body" title="${r.name}"></div>${br}<span class="tag">${idx + 1}</span>` +
        ["s", "e"].map((k) => `<div class="grip grip--${k}" style="${k === "s" ? "left:0" : "left:100%"}" role="slider" tabindex="0" data-k="${k}"
          aria-label="${k === "s" ? "Début" : "Fin"} de la plage ${idx + 1}" aria-valuemin="0" aria-valuemax="${D}"
          aria-valuenow="${(k === "s" ? r.start : r.end).toFixed(1)}" aria-valuetext="${spoken(k === "s" ? r.start : r.end)}"><span class="grip-bubble">${fmt(k === "s" ? r.start : r.end)}</span></div>`).join("");
      overlay.appendChild(el);
    });
    if (st.playing) { const ph = $("#playhead"); ph.style.display = "block"; ph.style.left = `${X(st.playT)}px`; }
  }

  /* ───────────── Interactions de la frise ───────────── */
  const announce = (txt) => { live.textContent = ""; setTimeout(() => (live.textContent = txt), 30); };
  const live = document.createElement("div");
  live.className = "sr"; live.setAttribute("aria-live", "polite"); document.body.appendChild(live);

  const setView = (a, b) => {
    let s = clamp(b - a, MIN_SPAN, D);
    a = clamp(a, 0, D - s);
    st.view = { a, b: a + s };
    drawMain(); drawMini();
  };
  const zoom = (f, at = (st.view.a + st.view.b) / 2) => {
    const s = clamp(span() * f, MIN_SPAN, D);
    const k = (at - st.view.a) / span();
    setView(at - k * s, at - k * s + s);
  };
  const fitSel = () => {
    const r = selR(); if (!r) return setView(0, D);
    const pad = Math.max(4, (r.end - r.start) * 0.25);
    setView(r.start - pad, r.end + pad);
  };
  const snapTargets = () => verses.flatMap((v) => [v.s - st.pre, v.e + st.post]);
  const setBound = (r, k, val, snap) => {
    if (k === "s") {
      val = clamp(val, 0, r.end - 0.5);
      if (snap && st.magnet) { const c = snapTargets().find((t) => Math.abs(X(t) - X(val)) < 10); if (c !== undefined && c < r.end - 0.5) val = Math.max(0, c); }
      r.start = val;
    } else {
      val = clamp(val, r.start + 0.5, D);
      if (snap && st.magnet) { const c = snapTargets().find((t) => Math.abs(X(t) - X(val)) < 10); if (c !== undefined && c > r.start + 0.5) val = Math.min(D, c); }
      r.end = val;
    }
    r.auto = false;
  };
  const refresh = () => { drawMain(); drawMini(); renderList(); renderSummary(); renderStage(); };

  const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointeur déjà relâché */ } };
  let drag = null;
  overlay.addEventListener("pointerdown", (e) => {
    const plage = e.target.closest(".plage"); if (!plage) return;
    const r = st.ranges.find((x) => String(x.id) === plage.dataset.id); if (!r) return;
    const grip = e.target.closest(".grip");
    e.stopPropagation(); e.preventDefault();
    if (st.sel !== r.id) { st.sel = r.id; refresh(); if (!grip) return; }
    const kind = grip ? grip.dataset.k : "move";
    drag = { r, kind, x0: e.clientX, s0: r.start, e0: r.end, scale: 1, moved: false, id: e.pointerId };
    capture(stageF, e.pointerId);
    // Appui long sans bouger = mode précision (le doigt couvre la poignée : on démultiplie le geste)
    drag.timer = setTimeout(() => { if (drag && !drag.moved) { drag.scale = 0.2; drag.x0 = drag.lastX ?? drag.x0; drag.s0 = r.start; drag.e0 = r.end; $("#frise").dataset.precision = ""; navigator.vibrate?.(10); } }, 450);
    const gEl = overlay.querySelector(`.plage[data-id="${r.id}"] .grip--${kind === "move" ? "s" : kind}`);
    if (grip && gEl) gEl.dataset.drag = "";
  });
  stageF.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.lastX = e.clientX;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 3) drag.moved = true;
    const dt = (dx / W()) * span() * drag.scale;
    const r = drag.r;
    if (drag.kind === "move") {
      const len = drag.e0 - drag.s0;
      r.start = clamp(drag.s0 + dt, 0, D - len); r.end = r.start + len; r.auto = false;
    } else setBound(r, drag.kind, (drag.kind === "s" ? drag.s0 : drag.e0) + dt, drag.scale === 1);
    drawMain(); drawMini(); renderSummary(); renderStage(drag.kind === "e" ? r.end : r.start); renderReadout();
    const g = overlay.querySelector(`.plage[data-id="${r.id}"] .grip--${drag.kind === "move" ? "s" : drag.kind}`);
    if (g && drag.kind !== "move") g.dataset.drag = "";
  });
  const endDrag = (e) => {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.kind === "move" && !drag.moved && e?.type === "pointerup") {
      // Toucher une plage sans la déplacer = toucher le passage dessous (proposer « Ajouter ce verset »)
      const x = e.clientX - stageF.getBoundingClientRect().left, t = T(x);
      const v = verses.find((q) => t >= q.s - 0.3 && t <= q.e + 0.3);
      drag = null; refresh(); if (v) openPop(v, x); return;
    }
    delete $("#frise").dataset.precision;
    const r = drag.r, k = drag.kind;
    drag = null;
    refresh();
    announce(k === "move" ? `Plage déplacée : ${spoken(r.start)} à ${spoken(r.end)}.` : `${k === "s" ? "Début" : "Fin"} : ${spoken(k === "s" ? r.start : r.end)}.`);
  };
  stageF.addEventListener("pointerup", endDrag);
  stageF.addEventListener("pointercancel", endDrag);

  // Clavier sur les poignées : ←/→ 0,1 s · Maj ±1 s · Alt ±0,02 s · Pg ±10 s · [ ] bord de passage voisin
  overlay.addEventListener("keydown", (e) => {
    const grip = e.target.closest(".grip"); if (!grip) return;
    const r = st.ranges.find((x) => String(x.id) === grip.closest(".plage").dataset.id);
    const k = grip.dataset.k, cur = k === "s" ? r.start : r.end;
    const stepK = e.shiftKey ? 1 : e.altKey ? 0.02 : 0.1;
    let v = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = cur - stepK;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") v = cur + stepK;
    else if (e.key === "PageDown") v = cur - 10;
    else if (e.key === "PageUp") v = cur + 10;
    else if (e.key === "[" || e.key === "]") {
      const t = snapTargets().sort((a, b) => a - b);
      v = e.key === "[" ? [...t].reverse().find((x) => x < cur - 0.05) : t.find((x) => x > cur + 0.05);
    } else if (e.key === " ") { e.preventDefault(); togglePlay(); return; }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeRange(r.id); return; }
    if (v == null) return;
    e.preventDefault();
    setBound(r, k, v, false);
    refresh();
    const again = overlay.querySelector(`.plage[data-id="${r.id}"] .grip--${k}`); again?.focus();
    announce(`${k === "s" ? "Début" : "Fin"} : ${spoken(k === "s" ? r.start : r.end)}.`);
  });

  // Glisser hors d'une plage = se déplacer ; toucher un passage = le proposer ; pincer = zoomer
  const pointers = new Map();
  let pan = null;
  stageF.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".plage")) return;
    pointers.set(e.pointerId, e.clientX);
    capture(stageF, e.pointerId);
    if (pointers.size === 2) { const xs = [...pointers.values()]; pan = { pinch: Math.abs(xs[0] - xs[1]), a: st.view.a, b: st.view.b, mid: T((xs[0] + xs[1]) / 2 - stageF.getBoundingClientRect().left) }; return; }
    pan = { x0: e.clientX, a: st.view.a, moved: false };
  });
  stageF.addEventListener("pointermove", (e) => {
    if (!pan || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e.clientX);
    if (pan.pinch && pointers.size === 2) {
      const xs = [...pointers.values()], d = Math.abs(xs[0] - xs[1]) || 1;
      const s = clamp((pan.b - pan.a) * (pan.pinch / d), MIN_SPAN, D);
      const k = (pan.mid - pan.a) / (pan.b - pan.a);
      setView(pan.mid - k * s, pan.mid - k * s + s);
      return;
    }
    const dx = e.clientX - pan.x0;
    if (Math.abs(dx) > 4) pan.moved = true;
    if (pan.moved) setView(pan.a - (dx / W()) * span(), pan.a - (dx / W()) * span() + span());
  });
  const endPan = (e) => {
    pointers.delete(e.pointerId);
    if (!pan) return;
    if (!pan.moved && !pan.pinch && e.type === "pointerup") {
      const t = T(e.clientX - stageF.getBoundingClientRect().left);
      const v = verses.find((x) => t >= x.s - 0.3 && t <= x.e + 0.3);
      if (v) openPop(v, e.clientX - stageF.getBoundingClientRect().left); else closePop();
    }
    if (pointers.size === 0) pan = null;
  };
  stageF.addEventListener("pointerup", endPan);
  stageF.addEventListener("pointercancel", endPan);
  stageF.addEventListener("dblclick", (e) => {
    if (e.target.closest(".plage")) return;
    const t = T(e.clientX - stageF.getBoundingClientRect().left);
    const v = verses.find((x) => t >= x.s - 0.3 && t <= x.e + 0.3);
    if (v) addVerse(v);
  });
  // Molette : Ctrl/⌘ = zoom autour du pointeur ; défilement horizontal = déplacement ; vertical = la page défile
  stageF.addEventListener("wheel", (e) => {
    const at = T(e.clientX - stageF.getBoundingClientRect().left);
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY > 0 ? 1.25 : 0.8, at); }
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { e.preventDefault(); const d = (e.shiftKey ? e.deltaY : e.deltaX) / W() * span(); setView(st.view.a + d, st.view.b + d); }
  }, { passive: false });

  let popV = null;
  const openPop = (v, x) => {
    popV = v;
    const pop = $("#pop");
    $("#pop-txt").innerHTML = `<b>Passage ${v.i}</b> <span class="mono muted">${fmt(v.s)} → ${fmt(v.e)}</span>`;
    pop.dataset.open = "";
    const pw = pop.offsetWidth, half = Math.min(pw, W()) / 2;
    pop.style.left = `${clamp(x, half, W() - half)}px`;
    pop.style.top = `${stageF.offsetTop + RULER + (st.source === "video" ? THUMB + 4 : 0) + LANE}px`;
    $("#pop-add").focus({ preventScroll: true });
  };
  const closePop = () => { delete $("#pop").dataset.open; popV = null; };
  $("#pop-add").addEventListener("click", () => { if (popV) addVerse(popV); closePop(); });
  $("#pop-x").addEventListener("click", closePop);

  // Vue d'ensemble : glisser la fenêtre, toucher ailleurs = s'y rendre
  const mini = $("#mini"), miniView = $("#mini-view");
  let mdrag = null;
  mini.addEventListener("pointerdown", (e) => {
    const rect = mini.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * D;
    if (e.target !== miniView) setView(t - span() / 2, t + span() / 2);
    mdrag = { x0: e.clientX, a: st.view.a };
    capture(mini, e.pointerId);
  });
  mini.addEventListener("pointermove", (e) => {
    if (!mdrag) return;
    const d = ((e.clientX - mdrag.x0) / mini.clientWidth) * D;
    setView(mdrag.a + d, mdrag.a + d + span());
  });
  mini.addEventListener("pointerup", () => (mdrag = null));
  miniView.addEventListener("keydown", (e) => {
    const d = (e.shiftKey ? 0.5 : 0.1) * span();
    if (e.key === "ArrowLeft") { e.preventDefault(); setView(st.view.a - d, st.view.b - d); }
    if (e.key === "ArrowRight") { e.preventDefault(); setView(st.view.a + d, st.view.b + d); }
    if (e.key === "+" || e.key === "=") zoom(0.7);
    if (e.key === "-") zoom(1.4);
  });

  $("#z-in").onclick = () => zoom(0.5);
  $("#z-out").onclick = () => zoom(2);
  $("#z-fit").onclick = fitSel;

  /* ───────────── Lecture simulée de la plage choisie ───────────── */
  let raf = 0;
  function togglePlay() {
    if (st.playing) { stopPlay(); return; }
    const r = selR(); if (!r) return;
    st.playing = { r, t0: performance.now() };
    st.playT = r.start;
    $("#play-l").textContent = "Arrêter";
    $("#play-i").innerHTML = '<use href="#i-pause"/>';
    if (st.playT < st.view.a || r.end > st.view.b) fitSel();
    const step = (now) => {
      if (!st.playing) return;
      st.playT = r.start + (now - st.playing.t0) / 1000;
      if (st.playT >= r.end) { stopPlay(); return; }
      const ph = $("#playhead"); ph.style.display = "block"; ph.style.left = `${X(st.playT)}px`;
      renderStage(st.playT); renderReadout();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    announce(`Lecture de la plage, de ${spoken(r.start)} à ${spoken(r.end)}.`);
  }
  function stopPlay() {
    cancelAnimationFrame(raf); st.playing = null; $("#playhead").style.display = "none";
    $("#play-l").textContent = "Écouter la plage"; $("#play-i").innerHTML = '<use href="#i-play"/>';
    renderReadout();
  }
  $("#play").onclick = togglePlay;

  function renderReadout() {
    const r = selR(), idx = st.ranges.indexOf(r);
    $("#readout").innerHTML = !r ? "Aucune plage choisie" : st.playing
      ? `<b class="mono">${fmt(st.playT)}</b> · lecture simulée`
      : `Plage ${idx + 1} · <span class="mono">${fmt(r.start)} → ${fmt(r.end)}</span> · <b>${dur(r.end - r.start)}</b>`;
  }

  /* ───────────── Composer : raccourcis ───────────── */
  function addVerse(v) {
    const r = fromVerses([v], vName([v]));
    st.ranges.push(r); st.sel = r.id; refresh();
    announce(`Plage ajoutée : passage ${v.i}, ${dur(r.end - r.start)}.`);
  }
  function removeRange(id) {
    const i = st.ranges.findIndex((r) => r.id === id);
    if (i < 0) return;
    const [gone] = st.ranges.splice(i, 1);
    st.sel = st.ranges[Math.min(i, st.ranges.length - 1)]?.id ?? null;
    refresh();
    announce(`Plage « ${gone.name} » retirée.`);
  }
  $("#q-all").onclick = () => {
    st.ranges = [{ id: st.nextId++, start: 0, end: D, name: "Tout l’audio", auto: true }];
    st.sel = st.ranges[0].id; setView(0, D); refresh(); announce("Une seule vidéo : tout l’audio.");
  };
  $("#q-verses").onclick = () => {
    st.ranges = verses.map((v) => fromVerses([v], vName([v])));
    st.sel = st.ranges[0].id; st.showAll = false; fitSel(); refresh();
    announce(`${st.ranges.length} plages : une vidéo par passage reconnu, souffle compris.`);
  };
  $("#q-add").onclick = () => {
    const c = (st.view.a + st.view.b) / 2;
    const v = verses.find((x) => x.e > c) || verses[verses.length - 1];
    addVerse(v);
  };

  /* ───────────── Liste des plages ───────────── */
  function renderList() {
    const list = $("#plist");
    const shown = st.showAll ? st.ranges : st.ranges.slice(0, 6);
    list.innerHTML = shown.map((r) => {
      const idx = st.ranges.indexOf(r);
      const vs = versesIn(r), amb = vs.filter((v) => v.st !== "rec").length;
      const over = st.ranges.find((o) => o !== r && o.start < r.end && o.end > r.start);
      const voice = voiceIn(r);
      const cut = voice && (voice.s < r.start - 0.05 || voice.e > r.end + 0.05) && r.end - r.start < D - 1;
      return `<li class="pitem" data-id="${r.id}" data-selected="${r.id === st.sel}" data-fine="${r.fine ? "true" : "false"}">
        <div class="pitem-head">
          <span class="pnum" aria-hidden="true">${idx + 1}</span>
          <div class="pmain">
            <input class="pname" value="${r.name}" aria-label="Nom de la plage ${idx + 1}, utilisé dans le nom du fichier" data-act="name">
            <span class="pmeta"><span class="mono">${fmt(r.start)} → ${fmt(r.end)}</span><span>${dur(r.end - r.start)}</span>
              <span>${vs.length ? `${vs.length} passage${vs.length > 1 ? "s" : ""}` : "aucun passage"}${amb ? ` · <span style="color:var(--warn)">${amb} à vérifier</span>` : ""}</span>
              ${over ? `<span style="color:var(--warn)">chevauche la plage ${st.ranges.indexOf(over) + 1}</span>` : ""}
              ${cut ? `<span style="color:var(--danger)">coupe une voix</span>` : ""}</span>
          </div>
          <div class="pact">
            <button class="btn btn--ghost btn--icon" type="button" data-act="fine" aria-expanded="${!!r.fine}" aria-label="Saisir les temps de la plage ${idx + 1}"><svg class="ico"><use href="#i-pen"/></svg></button>
            <button class="btn btn--ghost btn--icon" type="button" data-act="up" aria-label="Monter la plage ${idx + 1}" ${idx === 0 ? "disabled" : ""}><svg class="ico"><use href="#i-up"/></svg></button>
            <button class="btn btn--ghost btn--icon" type="button" data-act="del" aria-label="Retirer la plage ${idx + 1}"><svg class="ico"><use href="#i-trash"/></svg></button>
          </div>
        </div>
        <div class="pfine">
          ${["s", "e"].map((k) => `<label class="tfield">${k === "s" ? "Début" : "Fin"} (min:s,dixièmes)<span class="stp"><button type="button" data-act="step" data-k="${k}" data-d="-0.1" aria-label="${k === "s" ? "Début" : "Fin"} moins 0,1 s">−</button><input value="${fmt(k === "s" ? r.start : r.end)}" data-act="time" data-k="${k}" inputmode="decimal" autocomplete="off" spellcheck="false"><button type="button" data-act="step" data-k="${k}" data-d="0.1" aria-label="${k === "s" ? "Début" : "Fin"} plus 0,1 s">+</button></span></label>`).join("")}
          <span class="perr" role="alert"></span>
        </div>
      </li>`;
    }).join("") + (st.ranges.length > 6 && !st.showAll ? `<li><button class="btn btn--ghost btn--block" type="button" data-act="more">Voir les ${st.ranges.length - 6} autres plages</button></li>` : "");
    $("#sum-parties").textContent = st.ranges.length === 1 && st.ranges[0].end - st.ranges[0].start >= D - 1 ? "Tout l’audio" : `${st.ranges.length} plage${st.ranges.length > 1 ? "s" : ""} · ${dur(total())}`;
    renderReadout();
  }
  const rangeOf = (el) => st.ranges.find((r) => String(r.id) === el.closest(".pitem")?.dataset.id);
  $("#plist").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b?.dataset.act === "more") { st.showAll = true; renderList(); return; }
    const r = rangeOf(e.target); if (!r) return;
    if (st.sel !== r.id && b?.dataset.act !== "name") { st.sel = r.id; }
    if (!b) { st.sel = r.id; fitSel(); refresh(); return; }
    const act = b.dataset.act;
    if (act === "del") return removeRange(r.id);
    if (act === "up") { const i = st.ranges.indexOf(r); st.ranges.splice(i, 1); st.ranges.splice(i - 1, 0, r); refresh(); announce(`Plage montée en position ${i}.`); return; }
    if (act === "fine") { r.fine = !r.fine; st.sel = r.id; refresh(); return; }
    if (act === "step") { setBound(r, b.dataset.k, (b.dataset.k === "s" ? r.start : r.end) + Number(b.dataset.d), false); refresh(); return; }
    if (act === "name") { if (st.sel !== r.id) { st.sel = r.id; drawMain(); drawMini(); renderReadout(); } }
  });
  $("#plist").addEventListener("change", (e) => {
    const r = rangeOf(e.target); if (!r) return;
    if (e.target.dataset.act === "name") { r.name = e.target.value.trim() || r.name; renderSummary(); return; }
    if (e.target.dataset.act === "time") {
      const v = parseTime(e.target.value), k = e.target.dataset.k;
      const err = e.target.closest(".pitem").querySelector(".perr");
      if (v === null) { e.target.setAttribute("aria-invalid", "true"); err.textContent = "Écris le temps comme 3:12,4 (minutes:secondes,dixièmes)."; return; }
      if ((k === "s" && v >= r.end - 0.5) || (k === "e" && v <= r.start + 0.5)) { e.target.setAttribute("aria-invalid", "true"); err.textContent = "La fin doit venir au moins 0,5 s après le début."; return; }
      if (v > D) { e.target.setAttribute("aria-invalid", "true"); err.textContent = `L’audio s’arrête à ${fmt(D)}.`; return; }
      setBound(r, k, v, false); fitSel(); refresh();
    }
  });

  /* ───────────── Souffle ───────────── */
  const renderMargins = () => { $("#m-pre").value = `${st.pre.toFixed(1).replace(".", ",")} s`; $("#m-post").value = `${st.post.toFixed(1).replace(".", ",")} s`; };
  $$("[data-m]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.m;
    st[k] = clamp(Math.round((st[k] + Number(b.dataset.d)) * 10) / 10, 0, 3);
    // Les plages encore « automatiques » suivent le nouveau souffle ; celles retouchées à la main ne bougent pas
    st.ranges = st.ranges.map((r) => { if (!r.auto || r.end - r.start >= D - 1) return r; const vs = versesIn(r); if (!vs.length) return r; const n2 = fromVerses(vs, r.name); n2.id = r.id; st.nextId--; return n2; });
    renderMargins(); refresh();
  }));
  $("#magnet").onchange = (e) => { st.magnet = e.target.checked; drawMain(); };

  /* ───────────── Apparence ───────────── */
  const FORMATS = [["16:9", "Horizontal", "YouTube, écran", 36, 20], ["9:16", "Vertical", "Reels, Shorts", 18, 32], ["1:1", "Carré", "Publications", 26, 26], ["source", "Comme la vidéo", "1920 × 1080", 34, 20]];
  const SIZES_AR = [["Petit", 56], ["Moyen", 72], ["Grand", 96], ["Très grand", 120]];
  const SIZES_TR = [["Petit", 24], ["Moyen", 30], ["Grand", 40], ["Très grand", 52]];
  const POS = [["Haut", 12], ["Centre", 50], ["Bas", 88]];
  const radios = (host, items, cur, key, label = (x) => x[0], val = (x) => x[1]) => {
    host.innerHTML = items.map((x) => `<button type="button" role="radio" aria-checked="${val(x) === cur}" data-v="${val(x)}">${label(x)}</button>`).join("");
    host.onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; const v = b.dataset.v; st.prefs[key] = isNaN(Number(v)) ? v : Number(v); renderLook(); };
    host.onkeydown = (e) => rovingKeys(e, host);
  };
  const rovingKeys = (e, host) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const bs = $$("[role=radio]:not([disabled])", host); const i = bs.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const n2 = bs[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length]; n2.focus(); n2.click();
  };
  function renderLook() {
    const p = st.prefs;
    const fm = FORMATS.filter((f) => f[0] !== "source" || st.source === "video");
    if (p.o === "source" && st.source !== "video") p.o = "16:9";
    $("#formats").style.gridTemplateColumns = innerWidth < 480 && fm.length > 3 ? "" : `repeat(${fm.length}, minmax(0,1fr))`;
    $("#formats").innerHTML = fm.map(([id, l, h, w, hh]) => `<button class="fmt" type="button" role="radio" aria-checked="${p.o === id}" data-v="${id}"><span class="shape" style="width:${w}px;height:${hh}px" aria-hidden="true"></span><b>${l}</b><small>${h}</small></button>`).join("");
    $("#formats").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { p.o = b.dataset.v; renderLook(); } };
    $("#formats").onkeydown = (e) => rovingKeys(e, $("#formats"));
    const tiles = [
      ["upload", "Ma propre image", `<svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>`],
      ...(st.source === "video" ? [["source", "Vidéo d’origine", `<img src="${BG_DIR}thumb-mosquee-faience.jpg" alt=""><svg class="ico" style="position:absolute;color:#fff" aria-hidden="true"><use href="#i-play"/></svg>`]] : []),
      ...PHOTOS.map(([id, l]) => [id, l, `<img src="${BG_DIR}thumb-${id}.jpg" alt="" loading="lazy" width="96" height="64">`]),
      ...GRADS.map(([id, l, a, b, glow]) => [id, l, `<span style="position:absolute;inset:0;background:radial-gradient(circle at 50% 38%, ${glow}, transparent 70%), linear-gradient(${a}, ${b})"></span>`]),
      ["color", "Couleur unie", `<span style="position:absolute;inset:0;background:#101418"></span>`],
    ];
    $("#bgs").innerHTML = tiles.map(([id, l, inner]) => `<button class="bgt" type="button" role="radio" aria-checked="${p.bg === id}" data-v="${id}"><span class="sw-img">${inner}</span><span class="nm">${l}</span></button>`).join("");
    $("#bgs").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v !== "upload") { p.bg = b.dataset.v; renderLook(); } };
    $("#bgs").onkeydown = (e) => rovingKeys(e, $("#bgs"));
    radios($("#seg-ar"), SIZES_AR, p.ar, "ar");
    radios($("#seg-tr"), SIZES_TR, p.tr, "tr");
    radios($("#seg-pos"), POS, p.pos, "pos");
    $("#r-ar").value = p.ar; $("#v-ar").textContent = p.ar;
    $("#r-pos").value = p.pos; $("#v-pos").textContent = `${p.pos} %`;
    $("#sw-tr").checked = p.showTr; $("#sw-wave").checked = p.wave; $("#sw-fill").checked = p.fill;
    const bgName = [...PHOTOS, ...GRADS].find((x) => x[0] === p.bg)?.[1] || (p.bg === "source" ? "Vidéo d’origine" : "Couleur unie");
    $("#sum-look").textContent = `${FORMATS.find((f) => f[0] === p.o)[1]} · ${bgName} · arabe ${SIZES_AR.find((s) => s[1] === p.ar)?.[0].toLowerCase() ?? p.ar}`;
    renderStage(); renderQuality();
  }
  $("#r-ar").oninput = (e) => { st.prefs.ar = Number(e.target.value); renderLook(); };
  $("#r-pos").oninput = (e) => { st.prefs.pos = Number(e.target.value); renderLook(); };
  $("#sw-tr").onchange = (e) => { st.prefs.showTr = e.target.checked; renderStage(); };
  $("#sw-wave").onchange = (e) => { st.prefs.wave = e.target.checked; renderStage(); };
  $("#sw-fill").onchange = (e) => { st.prefs.fill = e.target.checked; renderStage(); };

  /* ───────────── Aperçu ───────────── */
  function renderStage(at) {
    const p = st.prefs, stage = $("#stage"), img = $("#st-img");
    stage.dataset.o = p.o === "source" ? "16:9" : p.o;
    const grad = GRADS.find((g) => g[0] === p.bg);
    if (grad) { img.style.display = "none"; stage.style.background = `radial-gradient(circle at 50% 38%, ${grad[4]}, transparent 70%), linear-gradient(${grad[2]}, ${grad[3]})`; }
    else if (p.bg === "color") { img.style.display = "none"; stage.style.background = "#101418"; }
    else { img.style.display = ""; stage.style.background = ""; const id = p.bg === "source" ? "mosquee-faience" : p.bg; img.src = `${BG_DIR}${id}.jpg`; $("#mini-img").src = `${BG_DIR}thumb-${id}.jpg`; }
    stage.style.setProperty("--acc", grad ? grad[5] : "hsl(43 62% 64%)");
    const k = p.fill ? 1.5 : 1;
    stage.style.setProperty("--ar", `${(p.ar / 10.8) * k}cqmin`);
    stage.style.setProperty("--tr", `${(p.tr / 10.8) * k}cqmin`);
    $("#st-tr").style.display = p.showTr ? "" : "none";
    const waveFrac = p.wave ? 13 : 0;
    $("#st-txt").style.top = `${10 + (p.pos / 100) * (80 - waveFrac)}%`;
    $("#st-wave").style.display = p.wave ? "" : "none";
    const r = selR();
    const t = at ?? (r ? r.start + st.pre + 0.5 : 60);
    const v = verses.find((x) => t >= x.s - 1 && t <= x.e + 1) || verses.find((x) => x.s > t) || verses[0];
    $("#st-ref").textContent = `Passage ${v.i} (référence du corpus)`;
    $("#st-badge").textContent = st.playing ? "Lecture simulée" : "Aperçu";
    $("#st-cap").innerHTML = r ? `Image à <span class="mono">${fmt(t)}</span> · plage ${st.ranges.indexOf(r) + 1} · le texte vient toujours du corpus` : "Choisis une plage pour voir l’image";
    $("#mini-txt").innerHTML = `<b>Aperçu</b> · Passage ${v.i} · <span class="mono">${fmt(t)}</span>`;
    if (p.wave) {
      const c = $("#st-wave"), w = c.clientWidth || 300, h = c.clientHeight || 30;
      const g = fitCanvas(c, w, h); c.style.height = ""; g.clearRect(0, 0, w, h);
      for (let x = 0; x < w; x += 3) {
        const tt = t - 6 + (x / w) * 12, m = peakAt(clamp(tt, 0, D));
        g.fillStyle = tt < t ? (grad ? grad[5] : "hsl(43 62% 64%)") : "rgba(242,239,230,.45)";
        g.fillRect(x, h / 2 - m * h * 0.42, 2, m * h * 0.84 + 1);
      }
    }
  }

  /* ───────────── Qualité, poids, bordereau ───────────── */
  const TIERS = [
    ["Léger", 720, 30, "Messagerie, téléphone"], ["Standard", 1080, 30, "YouTube, partage"], ["Fluide", 1080, 60, "Mouvements plus doux"],
    ["Grand écran", 1440, 30, "Projection, TV"], ["Maximum", 2160, 60, "4K : très lourd"],
  ];
  const even = (v) => Math.round(v / 2) * 2;
  const dims = (o, res) => o === "9:16" ? [res, even((res * 16) / 9)] : o === "1:1" ? [res, res] : [even((res * 16) / 9), res];
  const total = () => st.ranges.reduce((s, r) => s + (r.end - r.start), 0);
  const mb = (res, fps, sec = total()) => { const [w, h] = dims(st.prefs.o, res); const br = Math.min(40e6, Math.max(1e6, Math.round(w * h * fps * 0.08))); return Math.max(0.1, ((br + 128000) * sec) / 8 / 1e6); };
  const mbTxt = (v) => v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} Go` : v >= 10 ? `${Math.round(v)} Mo` : `${v.toFixed(1).replace(".", ",")} Mo`;
  // Seuils : configuration calibrée (SPEC §6), pas des constantes du composant
  const LIMITS = { warnMb: 250, dangerMb: 800, fileDangerMb: 500 };
  const level = (res, fps) => {
    const m = mb(res, fps), maxFile = Math.max(...st.ranges.map((r) => mb(res, fps, r.end - r.start)), 0);
    if (m > LIMITS.dangerMb || maxFile > LIMITS.fileDangerMb) return "danger";
    if (m > LIMITS.warnMb || (res >= 2160 && fps === 60)) return "warn";
    return "ok";
  };
  function renderQuality() {
    const p = st.prefs;
    $("#tiers").innerHTML = TIERS.map(([l, res, fps, use]) => {
      const on = p.res === res && p.fps === fps, lv = level(res, fps);
      return `<button class="tier" type="button" role="radio" aria-checked="${on}" data-res="${res}" data-fps="${fps}" data-heavy="${lv === "ok" ? "" : lv}">
        <b>${l}</b><span class="spec">${res}p · ${fps} im/s</span><small class="muted" style="font-size:var(--fs-xs)">${use}</small>
        <span class="wt">≈ ${mbTxt(mb(res, fps))}${lv !== "ok" ? ` <small>${lv === "danger" ? "très lourd" : "lourd"}</small>` : ""}</span></button>`;
    }).join("");
    $("#tiers").onclick = (e) => { const b = e.target.closest("[data-res]"); if (b) { p.res = Number(b.dataset.res); p.fps = Number(b.dataset.fps); renderQuality(); } };
    $("#tiers").onkeydown = (e) => rovingKeys(e, $("#tiers"));
    radios($("#seg-res"), [360, 480, 720, 1080, 1440, 2160].map((r) => [`${r}p${r === 2160 ? " (4K)" : r === 1440 ? " (2K)" : ""}`, r]), p.res, "res");
    radios($("#seg-fps"), [["30 im/s", 30], ["60 im/s · plus fluide", 60]], p.fps, "fps");
    $("#seg-res").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { p.res = Number(b.dataset.v); renderQuality(); } };
    $("#seg-fps").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { p.fps = Number(b.dataset.v); renderQuality(); } };
    const m = mb(p.res, p.fps), lv = level(p.res, p.fps);
    $("#gauge").dataset.level = lv;
    $("#gauge-i").style.width = `${clamp((m / 1000) * 100, 2, 100)}%`;
    $("#gauge-max").textContent = "1 Go";
    const [w, h] = dims(p.o, p.res);
    $("#q-note").innerHTML = lv === "ok"
      ? `<p class="note"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg><span><b>≈ ${mbTxt(m)} au total</b> pour ${dur(total())} de vidéo (image ${w} × ${h}, ${p.fps} im/s). Facile à envoyer.</span></p>`
      : `<p class="note note--${lv}"><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span><b>${lv === "danger" ? "Très lourd" : "Lourd"} : ≈ ${mbTxt(m)}.</b> La vidéo se fabrique dans ce navigateur, qui garde tout en mémoire pendant le rendu : sur téléphone, il peut s’arrêter en route. ${p.res >= 1440 ? "1080p reste net sur presque tous les écrans." : "Raccourcis les plages ou baisse la fluidité."}</span></p>`;
    const custom = !TIERS.some(([, r, f]) => r === p.res && f === p.fps);
    if (custom) $("#custom-q").open = true;
    $("#sum-q").textContent = `${p.res}p · ${p.fps} im/s · ≈ ${mbTxt(m)}`;
    renderSummary();
  }

  const fileStem = "recitation-tarawih-nuit-27";
  const apiJson = () => JSON.stringify({
    orientation: st.prefs.o, resolution: st.prefs.res, fps: st.prefs.fps,
    arabic_size: st.prefs.ar, translation_size: st.prefs.tr, show_translation: st.prefs.showTr,
    show_wave: st.prefs.wave, text_position: st.prefs.pos, fill: st.prefs.fill, background: st.prefs.bg,
    ranges: st.ranges.slice(0, 3).map((r) => ({ start: Math.round(r.start * 10) / 10, end: Math.round(r.end * 10) / 10, name: r.name })).concat(st.ranges.length > 3 ? ["…"] : []),
    padding: { before_s: st.pre, after_s: st.post, snap_to_silence: st.magnet },
  }, null, 2);

  function filesHtml(mode) {
    return `<ul class="files">${st.ranges.slice(0, 4).map((r, i) => {
      const s = mode === "done" ? "done" : mode === "error" ? (i === 0 ? "done" : i === 1 ? "err" : "wait") : i === 0 ? "done" : i === 1 ? "run" : "wait";
      const ic = s === "done" ? "i-check" : s === "err" ? "i-alert" : s === "run" ? "i-film" : "i-film";
      const label = s === "done" ? mbTxt(mb(st.prefs.res, st.prefs.fps, r.end - r.start)) : s === "err" ? "échec" : s === "run" ? "64 %" : "en attente";
      return `<li data-s="${s}"><svg class="ico ico--sm" aria-hidden="true"><use href="#${ic}"/></svg><span class="fn" title="${fileStem} — ${r.name}.mp4">${r.name}.mp4</span><span class="st">${label}</span>${s === "run" ? `<span class="bar"><i style="width:64%"></i></span>` : ""}</li>`;
    }).join("")}${st.ranges.length > 4 ? `<li><span></span><span class="st">et ${st.ranges.length - 4} autres</span><span></span></li>` : ""}</ul>`;
  }

  function bordHtml() {
    const p = st.prefs, n2 = st.ranges.length, m = mb(p.res, p.fps), lv = level(p.res, p.fps), [w, h] = dims(p.o, p.res);
    const render = Math.round(total() * 0.5);
    const heavyRender = p.fps === 60 || p.res >= 1440;
    if (st.state === "empty") return `<div class="bord-big"><b>0</b><span>vidéo</span></div><p class="lead">Aucun passage coranique avec du texte à montrer : il n’y a rien à mettre en vidéo.</p><button class="btn btn--primary btn--lg btn--block" disabled>Rien à exporter</button>`;
    if (st.state === "loading") return `<div class="skel" aria-hidden="true"><i></i><i style="height:60px"></i><i></i></div><p class="lead" role="status">Lecture de l’audio et des passages…</p>`;
    if (st.state === "render") return `<div class="bord-big"><b class="mono">2</b><span>vidéo en cours sur ${n2}</span></div>
      <p class="namepat">Préfixe des fichiers : ${fileStem} — …</p>
      ${filesHtml("render")}
      <p class="note"><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span>Garde cet onglet ouvert : la vidéo se fabrique dans ton navigateur. Chaque vidéo se télécharge dès qu’elle est prête.</span></p>
      <button class="btn btn--lg btn--block" type="button">Arrêter après cette vidéo</button>`;
    if (st.state === "done") return `<div class="bord-big"><b class="mono">${n2}</b><span>vidéo${n2 > 1 ? "s" : ""} prête${n2 > 1 ? "s" : ""}</span></div>
      ${filesHtml("done")}
      <p class="lead">Téléchargées dans ton dossier habituel. Si le navigateur a bloqué les téléchargements multiples, autorise-les puis relance ceux qui manquent.</p>
      <div class="row"><button class="btn btn--primary" type="button"><svg class="ico ico--sm"><use href="#i-dl"/></svg>Retélécharger tout</button><button class="btn btn--ghost" type="button">Nouvel export</button></div>`;
    if (st.state === "error") return `<div class="bord-big"><b class="mono">1</b><span>vidéo créée sur ${n2}</span></div>
      ${filesHtml("error")}
      <p class="note note--danger"><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span><b>La vidéo 2 n’a pas pu être fabriquée</b> : le navigateur a manqué de mémoire en ${p.res}p à ${p.fps} im/s. La vidéo 1 est bien téléchargée, rien n’est perdu.</span></p>
      <div class="row"><button class="btn btn--primary" type="button">Reprendre en 1080p</button><button class="btn btn--ghost" type="button">Reprendre tel quel</button></div>`;
    return `<div class="bord-big"><b class="mono">${n2}</b><span>vidéo${n2 > 1 ? "s" : ""} · une par plage</span></div>
      <dl>
        <dt>Durée totale</dt><dd>${dur(total())}</dd>
        <dt>Format</dt><dd>${FORMATS.find((f) => f[0] === p.o)[1]} · ${w} × ${h}</dd>
        <dt>Fluidité</dt><dd>${p.fps} images par seconde</dd>
        <dt>Poids estimé</dt><dd class="mono" style="color:${lv === "ok" ? "inherit" : lv === "warn" ? "var(--warn)" : "var(--danger)"}">≈ ${mbTxt(m)}${lv !== "ok" ? " · lourd" : ""}</dd>
        <dt>Rendu</dt><dd>${heavyRender ? "plus de " : "≈ "}${dur(render)}, ici</dd>
      </dl>
      ${lv === "ok" ? "" : `<p class="note note--${lv}"><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span>${lv === "danger" ? "Très lourd" : "Lourd"} pour un navigateur, surtout sur téléphone. <button class="link" type="button" data-tier="1080">Passer en 1080p · 30 im/s</button></span></p>`}
      <button class="btn btn--primary btn--lg btn--block" type="button" id="go"><svg class="ico"><use href="#i-dl"/></svg>Exporter ${n2 > 1 ? `${n2} vidéos` : "la vidéo"}</button>
      <p class="namepat">${fileStem} — ${st.ranges[0]?.name ?? ""}.mp4${n2 > 1 ? ` · …` : ""}</p>
      <details class="api"><summary><svg class="ico ico--sm"><use href="#i-braces"/></svg>Même export par l’API (export_video)</summary><pre>${apiJson()}</pre></details>`;
  }

  function renderSummary() {
    const html = bordHtml();
    $("#bord").innerHTML = html;
    $("#bord-sheet").innerHTML = html;
    const p = st.prefs, n2 = st.ranges.length, m = mb(p.res, p.fps), lv = level(p.res, p.fps);
    $("#rail-video").textContent = `${n2} vidéo${n2 > 1 ? "s" : ""} · ${p.res}p`;
    const dock = $("#dock");
    if (st.tab === "verifier") dock.innerHTML = `<span class="sumbtn"><b>2 passages à valider</b><small>36 sur 38 sûrs</small></span><a class="btn btn--primary btn--lg" href="#">Corriger</a>`;
    else if (st.tab === "soustitres") dock.innerHTML = `<button class="sumbtn" type="button" data-sheet><b>42 sous-titres · SRT</b><small>≈ 3 Ko · 2 ambigus omis</small></button><button class="btn btn--primary btn--lg" type="button">Exporter</button>`;
    else if (st.state === "render") dock.innerHTML = `<button class="sumbtn" type="button" data-sheet><b>Vidéo 2 sur ${n2} · 64 %</b><small>Garde cet onglet ouvert</small></button><button class="btn btn--lg" type="button">Arrêter</button>`;
    else if (st.state === "done") dock.innerHTML = `<button class="sumbtn" type="button" data-sheet><b>${n2} vidéos prêtes</b><small>Téléchargées</small></button><button class="btn btn--primary btn--lg" type="button" data-sheet>Voir</button>`;
    else if (st.state === "error") dock.innerHTML = `<button class="sumbtn" type="button" data-sheet><b>La vidéo 2 a échoué</b><small class="warn">Mémoire du navigateur insuffisante</small></button><button class="btn btn--primary btn--lg" type="button" data-sheet>Voir</button>`;
    else if (st.state === "empty" || st.state === "loading") dock.innerHTML = `<span class="sumbtn"><b>${st.state === "empty" ? "Rien à exporter" : "Chargement…"}</b></span><button class="btn btn--primary btn--lg" disabled>Exporter</button>`;
    else dock.innerHTML = `<button class="sumbtn" type="button" data-sheet aria-haspopup="dialog"><b>${n2} vidéo${n2 > 1 ? "s" : ""} · ≈ ${mbTxt(m)}</b><small class="${lv === "ok" ? "" : "warn"}">${p.res}p · ${p.fps} im/s · ${dur(total())}${lv === "ok" ? "" : " · lourd"}</small></button><button class="btn btn--primary btn--lg" type="button">Exporter</button>`;
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-tier]")) { st.prefs.res = 1080; st.prefs.fps = 30; renderQuality(); announce("Qualité ramenée à 1080p, 30 images par seconde."); }
    if (e.target.closest("[data-sheet]")) { document.body.dataset.sheet = ""; }
    if (e.target.closest("#scrim")) delete document.body.dataset.sheet;
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { delete document.body.dataset.sheet; closePop(); } });

  /* ───────────── Onglets, chapitres, états ───────────── */
  const TITLES = { verifier: "Vérifier <em>avant</em> d’exporter", soustitres: "Exporter les <em>sous-titres</em>", video: "Exporter la <em>vidéo</em>" };
  function setTab(t) {
    st.tab = t; document.body.dataset.tab = t;
    $$(".rail [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $("#title").innerHTML = TITLES[t];
    renderSummary();
    requestAnimationFrame(drawAll);
  }
  $(".rail").addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) setTab(b.dataset.tab); });
  $(".rail").addEventListener("keydown", (e) => {
    const bs = $$(".rail [role=tab]"), i = bs.indexOf(document.activeElement);
    if (i < 0 || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const n2 = bs[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3]; n2.focus(); setTab(n2.dataset.tab);
  });
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.go)));
  $$(".chap .tog").forEach((b) => b.addEventListener("click", () => {
    const c = b.closest(".chap"), open = c.dataset.open !== "true";
    c.dataset.open = String(open); b.setAttribute("aria-expanded", String(open)); b.setAttribute("aria-label", open ? "Replier" : "Déplier");
    if (open) requestAnimationFrame(drawAll);
  }));

  function setState(s) {
    st.state = s;
    const alt = $("#parties-alt");
    $("#parties-live").style.display = s === "empty" || s === "loading" ? "none" : "";
    alt.innerHTML = s === "empty"
      ? `<div class="empty"><svg viewBox="0 0 120 60" aria-hidden="true"><path d="M4 30h112" stroke="var(--border-strong)" stroke-width="1.6" fill="none"/>${[14, 30, 48, 70, 90, 104].map((x, i) => `<rect x="${x}" y="${22 - (i % 3) * 3}" width="10" height="${16 + (i % 3) * 6}" rx="2" fill="none" stroke="var(--slate-edge)" stroke-width="1.6" stroke-dasharray="3 2"/>`).join("")}</svg>
         <p><b style="color:var(--text)">Aucun passage coranique avec du texte.</b> Cet enregistrement ne contient que des passages non coraniques ou incertains : la vidéo n’aurait rien à afficher. Vérifie d’abord les passages ambigus.</p><button class="btn" type="button" data-go2="verifier">Aller à Vérifier</button></div>`
      : s === "loading" ? `<div class="skel" aria-hidden="true"><i></i><i></i><i></i></div><p class="lead" role="status" style="margin-top:var(--sp-2)">Lecture de la forme d’onde (51:20)…</p>` : "";
    alt.querySelector("[data-go2]")?.addEventListener("click", () => setTab("verifier"));
    renderSummary();
    requestAnimationFrame(drawAll);
  }

  /* ───────────── Aperçu réduit au défilement (téléphone) ───────────── */
  const ministage = $("#ministage");
  new IntersectionObserver(([en]) => {
    if (!en.isIntersecting && st.tab === "video" && en.boundingClientRect.top < 0) ministage.dataset.show = ""; else delete ministage.dataset.show;
  }).observe($("#stage-wrap"));
  $("#mini-up").onclick = () => $("#stage-wrap").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  /* ───────────── Vue d'ensemble de l'onglet Vérifier ───────────── */
  function drawOverview() {
    const c = $("#ov"); const w = c.clientWidth; if (!w) return;
    const g = fitCanvas(c, w, 44); c.style.height = "44px";
    for (let px = 0; px < w; px += 1) {
      let m = 0; const k0 = Math.floor((px / w) * peaks.length), k1 = Math.floor(((px + 1) / w) * peaks.length);
      for (let k = k0; k < k1; k += 3) if (peaks[k] > m) m = peaks[k];
      g.fillStyle = C.wave; g.fillRect(px, 22 - m * 12, 1, m * 24 + 0.5);
    }
    for (const z of nq) { g.fillStyle = alpha(C.slate, 0.3); g.fillRect((z.s / D) * w, 38, ((z.e - z.s) / D) * w, 4); }
    for (const v of verses) {
      const x = (v.s / D) * w;
      if (v.st === "rec") { g.fillStyle = alpha(C.accent, 0.55); g.fillRect(x, 38, Math.max(1, ((v.e - v.s) / D) * w), 4); }
      else { g.fillStyle = v.st === "unc" ? C.warn : C.accent; g.beginPath(); g.moveTo(x, 2); g.lineTo(x + 6, 10); g.lineTo(x, 18); g.lineTo(x - 6, 10); g.fill(); }
    }
  }

  function drawAll() { if (st.tab === "video") { drawMain(); drawMini(); renderStage(); } if (st.tab === "verifier") drawOverview(); }
  let rz = 0;
  addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { renderLook(); drawAll(); }); });

  /* ───────────── Commandes de la maquette ───────────── */
  $("#mk-theme").onchange = (e) => setTheme(e.target.value);
  $("#mk-source").onchange = (e) => { st.source = e.target.value; stageF.dataset.source = st.source; $("#fact-src").textContent = st.source === "video" ? "Vidéo" : "Audio"; renderLook(); drawAll(); };
  $("#mk-state").onchange = (e) => setState(e.target.value);

  /* Vues statiques (Vérifier, Sous-titres) : radios et puces simplement cochables */
  $$(".pane--soustitres [role=radiogroup], .pane--verifier [role=radiogroup]").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest("[role=radio]"); if (!b) return;
    $$("[role=radio]", g).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));
  $$(".pane--soustitres .chip").forEach((c) => c.addEventListener("click", () => c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true"))));

  /* ───────────── Démarrage (paramètres d'URL pour les captures) ───────────── */
  const theme = params.get("theme") || "system";
  $("#mk-theme").value = theme; $("#mk-source").value = st.source; $("#mk-state").value = st.state;
  if (theme !== "system") document.documentElement.setAttribute("data-theme", theme);
  stageF.dataset.source = st.source; $("#fact-src").textContent = st.source === "video" ? "Vidéo" : "Audio";
  if (params.get("q")) { const [r, f] = params.get("q").split("@").map(Number); st.prefs.res = r; st.prefs.fps = f; }
  if (params.get("o")) st.prefs.o = params.get("o");
  if (params.get("bg")) st.prefs.bg = params.get("bg");
  if (params.get("ranges") === "verses") { st.ranges = verses.map((v) => fromVerses([v], vName([v]))); st.sel = st.ranges[0].id; }
  if (params.get("fine")) st.ranges[0].fine = true;
  readColors();
  renderMargins();
  document.fonts.ready.then(() => { fitSel(); renderLook(); renderList(); setTab(st.tab); setState(st.state); if (params.get("sheet")) document.body.dataset.sheet = ""; if (params.get("pop")) openPop(verses[4], W() / 2); if (params.get("y")) scrollTo(0, Number(params.get("y"))); });
})();
