/* Prototype « Exporter les sous-titres » : état, rendu de la liste « à vérifier », réglages, aperçu en direct, forcer l'export.
   Rien n'est enregistré : tout vit dans cette page. États par l'adresse : #v=resultat · #forcer · #tab=reglages · #s=pret|long|etats · #theme=light|dark. */
(function () {
  "use strict";
  var V = window.AQR_VERSES || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var clock = function (s) { var m = Math.floor(s / 60), r = s - m * 60; return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r.toFixed(1); };
  var ts = function (s, sep) { var ms = Math.round(s * 1000), h = Math.floor(ms / 3600000); ms -= h * 3600000; var m = Math.floor(ms / 60000); ms -= m * 60000; var x = Math.floor(ms / 1000); ms -= x * 1000; var p = function (n, l) { return ("000" + n).slice(-l); }; return p(h, 2) + ":" + p(m, 2) + ":" + p(x, 2) + sep + p(ms, 3); };
  var words = function (ref, a, b) { return V[ref] ? V[ref].words.slice(a - 1, b).join(" ") : ""; };

  /* ── Les éléments à vérifier (données factices) ─────────────────────────────────────────────
     type : inferred | uncertain | cut | report | approx — voir docs/design/export-sous-titres.md §3.
     concerns : ce que l'élément change dans l'export (ar = lettres arabes, fr = traduction, ref = libellé de référence). */
  var ITEMS = [
    { id: "a", type: "inferred", t: [17.0, 21.8], ref: "112:3", words: "mots 1–4", concerns: ["ar", "fr"], glyph: "s-inferred",
      label: "Supposé, non entendu", why: "Verset <b>supposé</b> entre 112:2 et 112:4, jamais entendu. Il n'apparaîtra pas dans l'export tant que tu ne l'as pas confirmé à l'oreille." },
    { id: "h", type: "uncertain", t: [41.0, 48.0], ref: "11:61", words: "mots 1–10", concerns: ["ar", "fr"], glyph: "s-uncertain",
      label: "Incertain · 2 candidats", why: "<b>2 candidats</b> : 11:61 ou 7:73. Mêmes lettres ; un seul signe de pause diffère au mot 5 (signe jîm ou signe qalâ).",
      minor: true, decision: { kind: "Choix", text: "11:61 · mots 1–10", ear: true } },
    { id: "b", type: "uncertain", t: [48.2, 62.6], ref: "11:61 ou 7:73", words: "mots 11–17", concerns: ["ar", "fr"], glyph: "s-uncertain",
      label: "Incertain · 2 candidats", why: "<b>2 candidats</b> : 11:61 ou 7:73. L'arabe <b>diffère</b> aux mots 16–17 (<span lang=\"ar\" dir=\"rtl\" style=\"font-family:var(--font-quran);font-size:1.15em\">هُوَ أَنشَأَكُم</span> / <span lang=\"ar\" dir=\"rtl\" style=\"font-family:var(--font-quran);font-size:1.15em\">قَدْ جَآءَتْكُم</span>).", href: "corriger.html" },
    { id: "c", type: "cut", t: [70.0, 82.0], ref: "17:74", words: "mot 1 sur 9", concerns: ["ar", "fr"], glyph: "s-recognized",
      label: "Coupure · fin manquante", why: "Le verset <b>17:74</b> s'arrête au mot 1 ; la suite (mots 2–9) n'est pas reconnue : une abstention de 7,8 s suit (« score insuffisant »)." },
    { id: "d", type: "report", t: [108.0, 116.0], ref: "Verset manquant", words: "signalé par Awa", concerns: ["ar", "fr"], glyph: "s-human",
      label: "Signalement confirmé", why: "Signalement <b>confirmé</b> par Awa : « Verset manquant ». Le moteur n'a rien reconnu sur cette plage." },
    { id: "f", type: "approx", t: [125.0, 131.5], ref: "17:74", words: "mots 5–9", concerns: ["fr"], glyph: "s-recognized",
      label: "Traduction approximative", why: "Verset <b>partiel</b> : la traduction affichée (« … tu aurais bien failli t’incliner quelque peu vers eux. ») ne coïncide qu'à peu près avec les mots 5–9. Ne concerne que la traduction." },
    { id: "g", type: "uncertain", t: [150.0, 154.0], ref: "55:13 ou 55:16", words: "mots 1–4", concerns: ["ref"], glyph: "s-uncertain",
      label: "Référence incertaine", why: "<b>2 candidats</b> : 55:13 ou 55:16. Texte arabe et traduction <b>identiques</b> ; seule la référence diffère." }
  ];
  var TYPE_LABEL = { inferred: "Supposés", uncertain: "Incertains", cut: "Coupures", report: "Signalements", approx: "Traduction" };

  var state = { content: "arfr", fmt: "srt", forced: false, policy: "omit", refShown: false, long: false, page: 1, filter: "all", istiadha: false, basmala: true, takbir: false, amin: false, notes: true, bom: false, rtl: true, offset: 0, tab: "verifier", cur: "b" };
  var LONG = { total: 47, resolved: 12 };

  function concerned(it) {
    var c = it.concerns;
    if (state.content === "ar") return c.indexOf("ar") >= 0;
    if (state.content === "fr") return c.indexOf("fr") >= 0;
    return c.indexOf("ar") >= 0 || c.indexOf("fr") >= 0 || (state.refShown && c.indexOf("ref") >= 0);
  }
  function resolved(it) { return !!it.resolved || !!it.decision; }
  function counts() {
    var act = ITEMS.filter(concerned);
    var open = act.filter(function (i) { return !resolved(i); });
    if (state.long) return { total: LONG.total, done: LONG.resolved, open: LONG.total - LONG.resolved, openAr: 31 };
    return { total: act.length, done: act.length - open.length, open: open.length, openAr: open.filter(function (i) { return i.concerns.indexOf("ar") >= 0; }).length };
  }

  /* ── Rendu de la liste ── */
  function glyph(cls) { return '<span class="sw ' + cls + '" aria-hidden="true">' + (cls === "s-human" ? "<i></i>" : "") + "</span>"; }
  function row(it, i, n) {
    var done = resolved(it);
    var dec = "";
    if (it.decision) dec = '<div class="decision-line"><span class="dia" aria-hidden="true"></span><span>Décision : <b>' + esc(it.decision.text) + '</b>' + (it.decision.ear ? ' · écouté' : "") + '</span><button type="button" data-undo="' + it.id + '">Annuler</button></div>' +
      '<div class="decision-line"><span class="dia hollow" aria-hidden="true"></span><span class="muted">Moteur : ' + esc(it.label.toLowerCase()) + ' (inchangé)</span></div>';
    if (it.resolved === "ignored") dec = '<div class="decision-line"><span class="muted">Ignoré — exporté selon la règle par défaut</span><button type="button" data-undo="' + it.id + '">Annuler</button></div>';
    var tags = '<span class="tag">' + esc(it.label) + "</span>" +
      (it.concerns.indexOf("ar") >= 0 ? '<span class="tag tag--ar">Arabe' + (it.minor ? " · 1 signe" : "") + "</span>" : "") +
      (it.concerns.indexOf("fr") >= 0 && it.concerns.indexOf("ar") < 0 ? '<span class="tag">Traduction</span>' : "") +
      (it.concerns.indexOf("ref") >= 0 ? '<span class="tag">Référence</span>' : "");
    var actions = done ? '<button class="btn btn--ghost btn--sm" type="button" aria-label="Écouter ' + esc(it.ref) + '"><svg class="i"><use href="#i-play"/></svg><span class="hide-m">Écouter</span></button>' :
      '<button class="btn btn--ghost btn--sm btn--icon" type="button" aria-label="Écouter ' + esc(it.ref) + ' à ' + clock(it.t[0]) + '"><svg class="i"><use href="#i-play"/></svg></button>' +
      '<a class="btn btn--secondary btn--sm" href="corriger.html?i=' + it.id + '">Corriger</a>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-ignore="' + it.id + '">Ignorer</button>';
    return '<li class="xi' + (done ? " is-done" : "") + '"' + (it.id === state.cur && !done ? ' aria-current="true"' : "") + ' data-id="' + it.id + '">' +
      glyph(it.glyph) +
      '<div class="xi-main"><div class="xi-top"><span class="xi-ref">' + esc(it.ref) + '</span><span class="xi-t">' + clock(it.t[0]) + " → " + clock(it.t[1]) + " · " + esc(it.words) + "</span></div>" +
      '<p class="xi-why">' + it.why + "</p>" + dec + '<div class="xi-tags">' + tags + "</div></div>" +
      '<div class="xi-act">' + actions + "</div></li>";
  }
  function renderList() {
    var host = $("#xlist"); if (!host) return;
    var act = ITEMS.filter(concerned), off = ITEMS.filter(function (i) { return !concerned(i); });
    if (state.filter !== "all") act = act.filter(function (i) { return i.type === state.filter; });
    var html = "";
    if (state.long) {
      var demo = ITEMS.filter(function (i) { return !i.decision && i.type !== "approx" && i.type !== "report"; }).concat(ITEMS.filter(function (i) { return i.id === "c"; }));
      html = '<ul class="xlist" aria-label="Passages à vérifier, page 1 sur 5">' + ITEMS.filter(concerned).slice(0, 4).map(row).join("") + "</ul>" +
        '<div class="pager"><span aria-live="polite">1–10 sur 35 à traiter · le reste se charge page par page</span><span style="display:flex;gap:6px"><button class="btn btn--secondary btn--sm" type="button" disabled>‹ Précédent</button><button class="btn btn--secondary btn--sm" type="button">Suivant ›</button></span></div>';
    } else {
      html = '<ul class="xlist" aria-label="Passages à vérifier">' + act.map(row).join("") + "</ul>";
      if (off.length && state.filter === "all") html += '<details class="grp-off" style="margin-top:12px"><summary class="grp-title" style="cursor:pointer;list-style:none"><h4>Sans effet avec ces réglages · ' + off.length + '</h4><span>Une référence incertaine ne gêne pas tant qu’elle n’est pas affichée</span></summary><ul class="xlist" style="margin-top:8px">' + off.map(row).join("") + "</ul></details>";
      html += '<div class="pager"><span>' + act.length + " sur " + act.length + " affichés</span></div>";
    }
    host.innerHTML = html;
  }
  function renderChips() {
    var host = $("#fchips"); if (!host) return;
    var act = ITEMS.filter(concerned).filter(function (i) { return !resolved(i); });
    var by = {}; act.forEach(function (i) { by[i.type] = (by[i.type] || 0) + 1; });
    var html = '<button class="chip" type="button" data-f="all" aria-pressed="' + (state.filter === "all") + '">Tous <span class="n">' + act.length + "</span></button>";
    Object.keys(TYPE_LABEL).forEach(function (k) { if (by[k]) html += '<button class="chip" type="button" data-f="' + k + '" aria-pressed="' + (state.filter === k) + '">' + TYPE_LABEL[k] + ' <span class="n">' + by[k] + "</span></button>"; });
    host.innerHTML = state.long ? '<button class="chip" type="button" aria-pressed="true">Tous <span class="n">35</span></button><button class="chip" type="button" aria-pressed="false">Supposés <span class="n">18</span></button><button class="chip" type="button" aria-pressed="false">Incertains <span class="n">11</span></button><button class="chip" type="button" aria-pressed="false">Coupures <span class="n">4</span></button><button class="chip" type="button" aria-pressed="false">Signalements <span class="n">2</span></button>' : html;
  }

  /* ── Verdict, barre fixée, onglets ── */
  function renderVerdict() {
    var c = counts(), v = $("#verdict"); if (!v) return;
    var ready = c.open === 0;
    v.className = "verdict" + (ready ? " verdict--ready" : "");
    $("#v-n").innerHTML = ready ? '<svg class="i"><use href="#i-check"/></svg>' : c.open;
    $("#v-h").textContent = ready ? "Tout est vérifié : prêt à exporter" : (c.open === 1 ? "passage à vérifier avant d’exporter" : "passages à vérifier avant d’exporter");
    $("#v-p").innerHTML = ready ? "Aucun passage ambigu dans la partie coranique. Tu peux régler l’export puis le lancer en un clic." :
      (c.openAr === c.open ? "Tous touchent <b>l’arabe</b>." : "<b>" + c.openAr + "</b> touchent l’arabe ; " + (c.open - c.openAr) + " concernent seulement la traduction ou la référence.") +
      " Corrige-les à l’oreille, ou force l’export : les passages ambigus seront alors traités selon la règle que tu choisis.";
    var p = c.total ? Math.round(100 * c.done / c.total) : 0;
    $("#v-meter").style.setProperty("--p", p + "%");
    $("#v-prog").innerHTML = "<span>Progression</span><b>" + c.done + " sur " + c.total + " résolus</b>";
    $("#v-act").style.display = ready ? "none" : "flex";
    $("#v-first").textContent = "Corriger le premier passage (" + c.open + " restants)";
    var sb = $("#sb-main"); if (sb) sb.textContent = ready ? "Régler l’export" : "Corriger (" + c.open + ")";
    var tn = $("#tab-n"); if (tn) { tn.textContent = ready ? "✓" : c.open; }
    var go = $("#go"), force = $("#force"), micro = $("#micro");
    go.hidden = !ready; force.hidden = ready;
    $("#go-fmt").textContent = state.fmt.toUpperCase();
    micro.innerHTML = state.fmt === "json" ? "Fichier <b>aqr.recognition/1</b> corrigé · ≈ 18 Ko" : "<b>" + (ready ? 44 : 40) + "</b> sous-titres · ≈ 6 Ko" + (ready ? "" : " · " + c.open + " passages ambigus à traiter");
    var meta = $("#hdr-state"); if (meta) meta.textContent = ready ? "Prêt à exporter" : c.open + " à vérifier";
    var live = $("#live"); if (live) live.textContent = c.done + " sur " + c.total + " résolus. " + (ready ? "Prêt à exporter." : c.open + " restants.");
    var fl = $("#force-n"); if (fl) fl.textContent = c.open;
    renderForceTable();
  }

  function renderForceTable() {
    var t = $("#force-tbl"); if (!t) return;
    var open = ITEMS.filter(concerned).filter(function (i) { return !resolved(i); });
    var rows = [];
    var pol = state.policy;
    open.forEach(function (i) {
      var what = i.type === "inferred" ? (pol === "omit" ? "Omis" : "Marqué « [déduit] »") :
        i.type === "uncertain" ? (pol === "omit" ? "Omis" : pol === "mark" ? "Marqué « [incertain : …] »" : "Premier candidat (ordre du corpus)") :
        i.type === "cut" ? "Exporté tel quel : mot 1 seulement" :
        i.type === "report" ? "Rien (le moteur n’a rien reconnu)" : "Exporté tel quel : fragment approximatif";
      rows.push("<tr><td class=\"num\">" + clock(i.t[0]).slice(0, 5) + "</td><td><b>" + esc(i.ref) + "</b> · " + esc(i.label.toLowerCase()) + "</td><td>" + what + "</td></tr>");
    });
    t.innerHTML = "<thead><tr><th>Temps</th><th>Passage</th><th>Dans l’export</th></tr></thead><tbody>" + rows.join("") + "</tbody>";
  }

  /* ── Aperçu en direct ── */
  function cues() {
    var out = [], m = state.content, ar = m !== "fr", fr = m !== "ar", off = state.offset / 1000;
    if (state.istiadha) out.push({ t: [2.0, 5.4], ar: "[الاستعاذة]", fr: "", label: true });
    if (state.basmala) out.push({ t: [6.0, 10.1], ar: ar ? V["1:1"].words.join(" ") : "", fr: fr ? V["1:1"].fr : "" });
    out.push({ t: [12.3, 17.0], ar: ar ? words("112:2", 1, 2) : "", fr: fr ? V["112:2"].fr : "" });
    out.push({ flag: ITEMS[0] });
    return out.slice(0, 3).map(function (c) { if (c.t) c.t = [c.t[0] + off, c.t[1] + off]; return c; });
  }
  function fileName() { var suf = state.content === "ar" ? "ar" : state.content === "fr" ? "fr" : "ar-fr"; return "recitation-hud-isra." + suf + "." + state.fmt; }
  function fr(s) { return state.notes ? s : s.replace(/\[\d+\]/g, ""); }
  function renderPreview() {
    var host = $("#pv"); if (!host) return;
    var cs = cues(), mode = ($("#pv-tabs [aria-selected=true]") || {}).dataset ? $("#pv-tabs [aria-selected=true]").dataset.pv : "rendu";
    var sep = state.fmt === "vtt" ? "." : ",", rle = state.rtl ? "‫" : "", pdf = state.rtl ? "‬" : "";
    if (state.fmt === "json") {
      host.innerHTML = '<pre class="code" aria-label="Aperçu du fichier JSON">' + esc('{ "schema": "aqr.recognition/1",\n  "review": { "schema": "aqr.decisions/1", "applied": 1,\n              "forced": false, "unresolved": ' + counts().open + ' },\n  "intervals": [ … 44 intervalles, dont 1 avec "resolved": {…} ] }') + "</pre>" +
        '<p class="pv-note">La prédiction du moteur est recopiée telle quelle ; les décisions humaines s’ajoutent dans <code>resolved</code>, jamais à la place.</p>';
      return;
    }
    if (mode === "fichier") {
      var txt = (state.fmt === "vtt" ? "WEBVTT\n\n" : "") + (state.fmt === "ass" ? "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\n\n[V4+ Styles]\nStyle: Arabe,Amiri Quran,64,&H00FFFFFF…\nStyle: Fr,Atkinson Hyperlegible Next,38,&H00D9D5CA…\n\n[Events]\n" : "");
      cs.forEach(function (c, i) {
        if (c.flag) { txt += (state.fmt === "ass" ? "; " : "") + "NOTE passage ambigu omis : " + c.flag.ref + " (supposé, non entendu)\n\n"; return; }
        if (state.fmt === "ass") { txt += "Dialogue: 0,0:00:" + (c.t[0] < 10 ? "0" : "") + c.t[0].toFixed(2) + ",0:00:" + (c.t[1] < 10 ? "0" : "") + c.t[1].toFixed(2) + ",Arabe,,0,0,0,," + (c.ar ? "{\\k35}" + c.ar : "") + (c.fr ? "\\N{\\rFr}" + fr(c.fr) : "") + "\n"; return; }
        txt += (state.fmt === "srt" ? (i + 1) + "\n" : "") + ts(c.t[0], sep) + " --> " + ts(c.t[1], sep) + "\n" + (c.ar ? rle + c.ar + pdf + "\n" : "") + (c.fr ? fr(c.fr) + "\n" : "") + "\n";
      });
      host.innerHTML = '<pre class="code rt" aria-label="Aperçu du texte du fichier">' + esc(txt) + "</pre>";
      return;
    }
    host.innerHTML = '<div class="pv" role="list">' + cs.map(function (c, i) {
      if (c.flag) return '<div class="cue cue--flag" role="listitem"><div class="cue-t">' + clock(c.flag.t[0]).slice(0, 5) + '<br>→ ' + clock(c.flag.t[1]).slice(0, 5) + '</div><div class="cue-box"><div class="why"><b>Omis dans cet export</b> · ' + c.flag.ref + ' est un verset <b>supposé</b>, jamais entendu.</div><button type="button" data-goto="a">Le corriger</button></div></div>';
      return '<div class="cue" role="listitem"><div class="cue-t">' + clock(c.t[0]).slice(0, 5) + '<br>→ ' + clock(c.t[1]).slice(0, 5) + '</div><div class="cue-box">' + (c.ar ? '<div class="ar" lang="ar" dir="rtl">' + esc(c.ar) + "</div>" : "") + (c.fr ? '<div class="fr">' + esc(fr(c.fr)) + "</div>" : "") + "</div></div>";
    }).join("") + "</div>";
  }

  function renderFile() {
    var n = $("#file-name"); if (n) { if (!n.dataset.touched) n.value = fileName(); }
    var r = $("#res-name"); if (r) r.textContent = ($("#file-name") || {}).value || fileName();
    $$(".fmt-lbl").forEach(function (e) { e.textContent = state.fmt.toUpperCase(); });
    var ass = $("#ass-opts"); if (ass) { ass.hidden = state.fmt !== "ass"; }
    var kar = $("#karaoke"); if (kar) kar.disabled = state.fmt !== "ass";
    var bomW = $("#bom-sub"); if (bomW) bomW.textContent = state.fmt === "json" ? "Inutile pour du JSON" : "À activer si un vieux lecteur Windows affiche mal les accents";
  }

  function render() { renderList(); renderChips(); renderVerdict(); renderPreview(); renderFile(); }

  /* ── Événements ── */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a, [data-f]"); if (!t) return;
    if (t.dataset.f) { state.filter = t.dataset.f; render(); return; }
    if (t.dataset.ignore) { var it = ITEMS.filter(function (x) { return x.id === t.dataset.ignore; })[0]; it.resolved = "ignored"; toast("Élément ignoré — il sera exporté selon la règle par défaut"); render(); return; }
    if (t.dataset.undo) { var u = ITEMS.filter(function (x) { return x.id === t.dataset.undo; })[0]; delete u.resolved; delete u.decision; toast("Décision annulée — la prédiction du moteur n’a jamais changé"); render(); return; }
    if (t.dataset.goto) { location.href = "corriger.html?i=" + t.dataset.goto; return; }
    if (t.dataset.pv) { $$("#pv-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b === t ? "true" : "false"); }); renderPreview(); return; }
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.id === "v-first" || t.id === "sb-main") { if (counts().open) location.href = "corriger.html"; else setTab("reglages"); return; }
    if (t.id === "force" || t.id === "sb-force") { openDlg(true); return; }
    if (t.dataset.close) { openDlg(false); return; }
    if (t.id === "do-force") { state.forced = true; openDlg(false); showResult(); return; }
    if (t.id === "go" || t.id === "sb-go") { showResult(); return; }
    if (t.id === "again") { hideResult(); return; }
    if (t.id === "copy") { toast("Attribution copiée"); return; }
    if (t.id === "theme") { var dk = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = dk ? "light" : "dark"; return; }
    if (t.dataset.step) { var inp = $("#" + t.dataset.step), d = parseFloat(t.dataset.d); inp.value = Math.max(-5000, Math.min(5000, (parseFloat(inp.value) || 0) + d)); inp.dispatchEvent(new Event("input", { bubbles: true })); return; }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "fmt") { state.fmt = t.value; var n = $("#file-name"); if (n) delete n.dataset.touched; }
    else if (t.name === "content") { state.content = t.value; var n2 = $("#file-name"); if (n2) delete n2.dataset.touched; }
    else if (t.name === "policy") state.policy = t.value;
    else if (t.name === "chk") state[t.value] = t.checked;
    else if (t.id === "ref-shown") state.refShown = t.checked;
    else if (t.id === "notes") state.notes = !t.checked;
    else if (t.id === "rtl") state.rtl = t.checked;
    else return;
    render();
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "offset") { state.offset = parseFloat(e.target.value) || 0; renderPreview(); }
    if (e.target.id === "file-name") { e.target.dataset.touched = "1"; renderFile(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && $("#dlg-back") && $("#dlg-back").dataset.open === "true") openDlg(false);
  });

  function setTab(t) { state.tab = t; var xp = $(".xp"); if (xp) xp.dataset.tab = t; $$("[data-tab][role=tab]").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === t ? "true" : "false"); }); var sb = $("#stickybar"); if (sb) { sb.dataset.tab = t; $("#sb-main").hidden = t !== "verifier"; $("#sb-go").hidden = !(t === "reglages" && counts().open === 0); $("#sb-force").hidden = !(t === "reglages" && counts().open > 0) && t !== "verifier"; } }
  function openDlg(o) { var d = $("#dlg-back"); d.dataset.open = o ? "true" : "false"; if (o) { renderForceTable(); var f = $("#dlg input:checked"); if (f) f.focus(); } }
  function showResult() {
    var c = counts();
    $("#view-check").hidden = true; $("#view-res").hidden = false;
    $("#res-forced").hidden = !state.forced; $("#res-clean").hidden = state.forced;
    $("#res-omitted").textContent = state.forced ? c.open : 0;
    var r = $("#res-name"); r.textContent = ($("#file-name") || {}).value || fileName();
    $("#live").textContent = "Export terminé : " + r.textContent;
    window.scrollTo(0, 0); var main = $(".xp-page"); if (main) main.scrollTop = 0;
  }
  function hideResult() { $("#view-check").hidden = false; $("#view-res").hidden = true; state.forced = false; }
  var tt; function toast(m) { var t = $("#toast2"); t.textContent = m; t.dataset.open = "true"; clearTimeout(tt); tt = setTimeout(function () { t.dataset.open = "false"; }, 3500); }

  /* ── Démarrage depuis l'adresse ── */
  function boot() {
    var h = new URLSearchParams(location.hash.replace(/^#/, "").replace(/&/g, "&"));
    if (h.get("theme")) document.documentElement.dataset.theme = h.get("theme");
    if (h.get("s") === "pret") ITEMS.forEach(function (i) { i.resolved = i.resolved || "ignored"; });
    if (h.get("s") === "long") { state.long = true; var tt2 = $("#xp-title-sub"); if (tt2) tt2.textContent = "Cours de tajwîd · 2 h 04 · 3 012 intervalles"; }
    if (h.get("content")) { state.content = h.get("content"); var r = $("input[name=content][value=" + h.get("content") + "]"); if (r) r.checked = true; }
    if (h.get("fmt")) { state.fmt = h.get("fmt"); var f = $("input[name=fmt][value=" + h.get("fmt") + "]"); if (f) f.checked = true; }
    if (h.get("pv") === "fichier") { $$("#pv-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.pv === "fichier" ? "true" : "false"); }); }
    render();
    setTab(h.get("tab") || "verifier");
    if (h.get("v") === "resultat") { state.forced = h.get("forced") === "1"; showResult(); }
    if (h.has("forcer")) openDlg(true);
    if (h.get("adv")) { var a = $("#adv"); if (a) a.open = true; }
  }
  if (document.readyState !== "loading") boot(); else document.addEventListener("DOMContentLoaded", boot);
  window.AQR_EXPORT = { ITEMS: ITEMS, state: state, esc: esc, clock: clock, words: words };
})();
