/* « En direct » — noyau du prototype : réducteur d'événements (l'état que le client construira à partir des messages
   aqr.live/1) et rendu en HTML. Données factices : voir live-data.js. Aucun réseau, aucun micro, aucun serveur.
   Le réducteur est PUR : stateAt(scénario, instant) rejoue les événements depuis le début, ce qui permet de figer
   n'importe quel instant dans l'adresse (#sc=…&t=…) et de produire les captures et la galerie des états. */
(function () {
  var V = window.LIVE_VERSES, SUR = window.LIVE_SURAH, T0 = window.LIVE_T0, ERR = window.LIVE_ERRORS;
  var CFG = { patience: [6, 12, 21], silenceHintS: 8, bufferMaxS: 300, retryEveryS: 5, revisionShownS: 14 };
  var ATTR = "QuranEnc.com — Muhammad Hamidullah (révision du Complexe du Roi Fahd) · french_hameedullah · quranenc.com";
  var DUP = { "56:74": ["56:96", "69:52"] };
  var KIND_TXT = { repeat: "Tu reprends le verset précédent.", back: "Tu reviens en arrière.", skip: "Des versets ont été sautés.", other_surah: "Autre sourate : je cherche où tu es.", unknown: "Autre passage : je cherche où tu es." };

  var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6"/></symbol>' +
    '<symbol id="i-mic-off" viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6M4 4l16 16"/></symbol>' +
    '<symbol id="i-pause" viewBox="0 0 24 24"><path d="M8.5 6v12M15.5 6v12"/></symbol>' +
    '<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z"/></symbol>' +
    '<symbol id="i-live" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/></symbol>' +
    '<symbol id="i-link-off" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.5.4l2.5-2.5a4 4 0 0 0-5.6-5.7l-.9.9M14 10a4 4 0 0 0-5.5-.4L6 12.1a4 4 0 0 0 5.6 5.7l.9-.9M4 4l16 16"/></symbol>' +
    '<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4.2M12 17v.01"/></symbol>' +
    '<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></symbol>' +
    '<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>' +
    '<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>' +
    '<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>' +
    '<symbol id="i-gauge" viewBox="0 0 24 24"><path d="M4.5 17a8.5 8.5 0 1 1 15 0M12 13l3.5-4.5M12 17v.01"/></symbol>' +
    '<symbol id="i-keep" viewBox="0 0 24 24"><path d="M6 3.5h9l3.5 3.5v13a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M8.5 3.5v5h6v-5M8.5 20.5v-6h7v6"/></symbol>' +
    '<symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></symbol>' +
    '<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5"/></symbol>' +
    '<symbol id="i-jump" viewBox="0 0 24 24"><path d="M4 16c3 0 3-8 8-8h5M14 5l3 3-3 3M4 19h6"/></symbol>' +
    '<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></symbol>' +
    '<symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16"/></symbol>' +
    '</svg>';

  function ic(n, cls) { return '<svg class="i' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r; }
  function fmt1(s) { return String(Math.round(s * 10) / 10).replace(".", ","); }
  function nm(ref) { var p = ref.split(":"); return (SUR[p[0]] || "Sourate " + p[0]) + " " + ref; }
  function wds(ref) { if (!V[ref]) return []; var o = []; V[ref].ar.split(" ").forEach(function (w) { if (/^[ۖ-ۜ۟-۪ۨ-ۭ]+$/.test(w) && o.length) o[o.length - 1] += " " + w; else o.push(w); }); return o; }
  function plural(n, a, b) { return n + " " + (n > 1 ? b : a); }
  function strip(t) { return t.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "").replace(/ٱ/g, "ا").replace(/ـ/g, ""); }
  function sup(t) { return t.replace(/\[(\d+)\]/g, "<sup>[$1]</sup>"); }
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* ───────── Niveau sonore factice, déterministe ───────── */
  function inSpeech(sc, t) { var w = sc.speech || []; for (var i = 0; i < w.length; i++) if (t >= w[i][0] && t <= w[i][1]) return true; return false; }
  function level(sc, t) {
    if (inSpeech(sc, t)) return Math.min(1, 0.28 + 0.62 * Math.abs(Math.sin(t * 9.1)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 2.3 + 0.7))));
    return 0.04 + 0.03 * Math.abs(Math.sin(t * 5));
  }
  function silenceFor(sc, t) { if (inSpeech(sc, t)) return 0; var last = 0, w = sc.speech || []; for (var i = 0; i < w.length; i++) if (w[i][1] <= t) last = Math.max(last, w[i][1]); return t - last; }
  function speechWin(sc, t) { var w = sc.speech || []; for (var i = 0; i < w.length; i++) if (t >= w[i][0] && t <= w[i][1] + 3) return w[i]; return [t - 3, t]; }

  /* ───────── Réducteur ───────── */
  function stateAt(sc, now, patch) {
    var s = { sc: sc, now: now, phase: "idle", t0: null, conn: "off", degraded: [], degSince: null, degLog: [], lag: 0, cand: null, lock: null, exp: sc.expect || null,
      hist: (sc.seed || []).map(function (h) { return JSON.parse(JSON.stringify(h)); }), between: null, unres: null, lost: null, net: null, rev: null, jump: null,
      firstCandAt: null, trail: [], err: null, log: [], lastWords: "" };
    var evs = sc.events.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) { return a.e.at - b.e.at || a.i - b.i; }).map(function (x) { return x.e; });
    var seq = 0;
    function closeLock(end, partial) {
      if (!s.lock) return;
      s.hist.unshift({ kind: "verse", ref: s.lock.ref, status: s.lock.status, basis: s.lock.basis, t: [s.lock.start - T0, end - T0], rep: s.lock.rep, n: s.lock.n, partial: !!partial });
      s.lock = null;
    }
    evs.forEach(function (e) {
      if (e.at > now) return;
      seq++; s.log.push({ seq: seq, e: e });
      switch (e.type) {
        case "PHASE": s.phase = e.phase; if (e.phase === "listening") s.t0 = e.at; break;
        case "READY": s.conn = "ok"; s.degraded = e.degraded || []; break;
        case "CANDIDATES":
          s.lost = null; s.unres = null; s.between = null; s.jump = null;
          if (s.firstCandAt == null) { s.firstCandAt = e.at; s.trail = []; }
          if (s.trail[s.trail.length - 1] !== e.count) s.trail.push(e.count);
          s.cand = { k: e.k, count: e.count, heard: e.heard, cls: e.cls, items: e.items, exp: e.exp, commonTr: e.commonTr, at: e.at };
          s.lastWords = (wds(e.heard.ref).slice(0, e.heard.L)).join(" ");
          break;
        case "LOCKED":
          s.lost = null; s.unres = null; s.between = null; s.jump = null;
          s.lock = { ref: e.ref, k: e.k, n: e.k, status: e.status, basis: e.basis, at: e.at, start: e.start, rep: e.rep, waited: s.firstCandAt != null ? e.at - s.firstCandAt : 0 };
          s.cand = null; s.firstCandAt = null; s.trail = []; s.exp = null;
          s.lastWords = wds(e.ref).slice(0, e.k).join(" ");
          break;
        case "PROGRESS": if (s.lock && s.lock.ref === e.ref) { s.lock.n = e.n; s.lastWords = wds(e.ref).slice(0, e.n).join(" "); } break;
        case "CONTINUE": closeLock(e.end); s.exp = e.exp; s.between = { ref: e.ref, at: e.at, end: e.end }; s.cand = null; s.firstCandAt = null; s.trail = []; break;
        case "CLOSED":
          s.hist.unshift({ kind: "unres", heard: e.heard, k: e.k, t: [e.start - T0, e.end - T0], status: "uncertain" });
          s.cand = null; s.firstCandAt = null; s.trail = []; s.unres = { heard: e.heard, k: e.k, at: e.at }; s.exp = null; s.between = null;
          break;
        case "JUMP":
          closeLock(e.at, true);
          s.jump = { kind: e.kind, from: e.from, at: e.at }; s.cand = null; s.firstCandAt = null; s.trail = []; s.exp = null;
          if (e.kind === "skip" && s.hist[0] && s.hist[0].kind === "unres") s.hist[0].gap = true;
          else s.hist.unshift({ kind: "jump", jk: e.kind, from: e.from, t: [e.at - T0, e.at - T0] });
          break;
        case "LOST":
          closeLock(e.at, true); s.lost = { reason: e.reason, at: e.at }; s.cand = null; s.firstCandAt = null; s.trail = []; s.between = null;
          if (e.reason === "non_quran" && !(s.hist[0] && s.hist[0].kind === "nq")) { var w = speechWin(sc, e.at); s.hist.unshift({ kind: "nq", t: [w[0] - T0, w[1] - T0] }); }
          break;
        case "REVISION":
          s.hist.forEach(function (h) { if (h.kind === "verse" && h.ref === e.ref && !h.revised) { h.revised = true; h.was = h.status; h.status = e.status; h.reason = e.reason; } });
          s.rev = { ref: e.ref, at: e.at, status: e.status, reason: e.reason };
          break;
        case "DEG":
          s.degraded = e.tiers; s.lag = e.lag || 0;
          if (e.tiers.length && s.degSince == null) s.degSince = e.at;
          if (!e.tiers.length && s.degSince != null) { s.degLog.push([s.degSince - T0, e.at - T0]); s.degSince = null; }
          break;
        case "NET": s.net = { state: e.state, at: e.at, catchup: e.catchup || 0 }; break;
        case "ERR": s.err = e.code; break;
        case "FINAL": closeLock(e.at, true); s.phase = "ended"; break;
      }
    });
    if (s.phase === "ended") closeLock(now, true);
    if (s.phase === "ended" || s.phase === "ending") { var en = evs.filter(function (e) { return (e.type === "PHASE" && e.phase === "ending") || e.type === "ERR"; })[0]; if (en) s.endAt = en.at - T0; }
    if (s.degSince != null) s.degLog.push([s.degSince - T0, null]);
    s.level = level(sc, now); s.silenceS = silenceFor(sc, now);
    s.elapsed = s.t0 != null ? Math.max(0, (s.endAt != null ? Math.min(now, s.endAt + T0) : now) - s.t0) : 0;
    s.cutS = s.net && s.net.state === "lost" ? Math.min(CFG.bufferMaxS, now - s.net.at) : 0;
    s.catchup = s.net && s.net.state === "back" && now < s.net.at + s.net.catchup;
    s.waitS = s.cand && s.firstCandAt != null ? now - s.firstCandAt : 0;
    s.named = s.hist.filter(function (h) { return h.kind === "verse" && (h.status === "recognized" || h.status === "inferred"); }).length + (s.lock ? 1 : 0);
    s.unnamed = s.hist.filter(function (h) { return h.kind === "unres"; }).length;
    if (patch) for (var k in patch) s[k] = patch[k];
    return s;
  }

  function viewOf(s) {
    var p = s.phase;
    if (p === "idle") return "idle"; if (p === "permission") return "perm"; if (p === "connecting") return "conn"; if (p === "error") return "err";
    if (p === "ended" || p === "kept") return "end";
    if (s.lock) return s.lock.status === "inferred" ? "inferred" : "named";
    if (s.cand) return "cands";
    if (s.unres) return "unres";
    if (s.jump) return "jump";
    if (s.lost && s.lost.reason === "non_quran") return "nonquran";
    if (s.between) return "between";
    return "listen";
  }

  /* ───────── Rendu : briques ───────── */
  function arabic(ref, upTo, mode) { // mode : "live" (entendus / à venir), "plain"
    var w = wds(ref), out = "";
    for (var i = 0; i < w.length; i++) {
      var cls = "w";
      if (mode === "live") cls += i < upTo ? (i === upTo - 1 ? " on" : "") : " next";
      out += '<span class="' + cls + '">' + w[i] + "</span> ";
    }
    return out;
  }
  function headerHTML(label) {
    return '<div class="pass-h"><span class="eyebrow">' + label + '</span><button class="btn btn--ghost btn--sm" type="button" data-act="font" aria-label="Police arabe">Police<span class="hide-m"> arabe</span></button>' +
      '<button class="btn btn--ghost btn--sm btn--icon" type="button" data-act="smaller" aria-label="Réduire la taille du texte arabe">A−</button>' +
      '<button class="btn btn--ghost btn--sm btn--icon" type="button" data-act="bigger" aria-label="Agrandir la taille du texte arabe">A+</button></div>';
  }
  function trHTML(ref, scope) {
    return '<div class="sepline"></div><div class="tr-lbl">' + (scope || "Traduction du verset") + '</div><p class="tr">' + sup(V[ref].fr) + '</p><p class="attr">' + ATTR + "</p>";
  }
  function ringIcon(still) { return '<div class="hearing' + (still ? " hearing--still" : "") + '" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-mic"/></svg></div>'; }

  function heroSVG() {
    return '<svg class="hero" viewBox="0 0 420 110" fill="none" aria-hidden="true">' +
      '<path d="M8 55h404" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1 6" stroke-linecap="round"/>' +
      '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' + [150, 162, 174, 186, 198].map(function (x, i) { var h = [10, 22, 34, 18, 8][i]; return '<path d="M' + x + " " + (55 - h) + "v" + 2 * h + '"/>'; }).join("") +
      [222, 234, 246, 258, 270].map(function (x, i) { var h = [8, 16, 30, 20, 10][i]; return '<path d="M' + x + " " + (55 - h) + "v" + 2 * h + '"/>'; }).join("") + "</g>" +
      '<path d="M210 40l15 15-15 15-15-15z" fill="var(--accent)" stroke="none"/>' +
      '<path d="M62 30a40 40 0 0 0 0 50M34 16a68 68 0 0 0 0 78M358 30a40 40 0 0 1 0 50M386 16a68 68 0 0 1 0 78" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" opacity=".55"/></svg>';
  }

  function stageHTML(s) {
    var v = viewOf(s), h = "";
    if (v === "idle") {
      h = '<article class="pass pass--center pass--idle" aria-labelledby="st-title"><span class="eyebrow" style="justify-self:start">En direct</span>' + heroSVG() +
        '<h2 class="pass-title" id="st-title">Récite, je t’écoute.</h2>' +
        '<p class="pass-sub">Le moteur reconnaît les versets pendant que tu récites, sans que tu aies à dire de quelle sourate il s’agit.</p>' +
        '<ul class="legend" aria-label="Comment lire l’écran">' +
        '<li><span class="sw s-pending"></span><span><b>Candidats</b> — plusieurs versets commencent pareil : je garde les possibilités ouvertes et je n’écris aucun nom.</span></li>' +
        '<li><span class="sw s-recognized"></span><span><b>Reconnu</b> — les mots entendus départagent : le verset est nommé, avec son texte et sa traduction.</span></li>' +
        '<li><span class="sw s-inferred"></span><span><b>Déduit de la position</b> — le texte est entendu, mais plusieurs versets sont identiques : le numéro vient de la suite de ce que tu récitais.</span></li>' +
        '<li><span class="sw s-uncertain"></span><span><b>Pas de verset nommé</b> — normal : je préfère me taire plutôt que me tromper.</span></li></ul>' +
        '<div class="promise"><p>' + ic("clock") + '<span><b>Compte environ 5 secondes</b> avant un premier nom, parfois plus de 20 s si la récitation est lente ou difficile à entendre. Ce n’est pas une panne.</span></p>' +
        '<p>' + ic("mic") + '<span><b>Le micro ne s’ouvre qu’au clic</b>, après ton accord dans le navigateur.</span></p>' +
        '<p>' + ic("lock") + '<span><b>Le son n’est pas conservé.</b> À la fin, tu choisis de le garder pour une analyse complète, ou de ne rien garder.</span></p></div></article>';
    } else if (v === "perm") {
      h = '<article class="pass pass--center" aria-labelledby="st-title"><span class="eyebrow" style="justify-self:start">Étape 1 sur 2</span>' + ringIcon(true) +
        '<h2 class="pass-title" id="st-title">Autorise le micro</h2><p class="pass-sub">Ton navigateur va te demander l’accès au micro. Choisis « Autoriser » pour que je puisse t’écouter. Rien n’est envoyé tant que tu n’as pas répondu.</p></article>';
    } else if (v === "conn") {
      h = '<article class="pass pass--center" aria-labelledby="st-title"><span class="eyebrow" style="justify-self:start">Étape 2 sur 2</span>' + ringIcon(true) +
        '<h2 class="pass-title" id="st-title">Connexion au service d’écoute…</h2><p class="pass-sub">Quelques secondes. Le micro est ouvert, mais aucun son n’est envoyé avant que la connexion soit prête.</p></article>';
    } else if (v === "err") {
      var E = ERR[s.errCode || "denied"];
      h = '<article class="pass" role="alert" aria-labelledby="st-title"><span class="eyebrow">Écoute impossible</span><div class="notice notice--danger" style="grid-template-columns:20px minmax(0,1fr)">' + ic(E.icon) +
        '<div><p><b id="st-title">' + E.title + '</b></p><p><b>Pourquoi.</b> ' + E.cause + '</p><p><b>Ce que ça change.</b> ' + E.impact + '</p><p><b>Que faire.</b> ' + E.todo + '</p>' +
        (E.server ? '<p class="meta">Message du service : « ' + E.server + ' »</p>' : "") + "</div></div>" +
        (E.btn ? '<div class="end-acts"><button class="btn btn--primary" data-act="start">' + E.btn + '</button><button class="btn btn--secondary" data-act="classic">Enregistrer puis analyser</button></div>' : '<div class="end-acts"><button class="btn btn--secondary" data-act="classic">Importer un fichier à la place</button></div>') + "</article>";
    } else if (v === "listen") {
      var quiet = s.silenceS >= CFG.silenceHintS || (s.lost && s.lost.reason === "silence");
      h = '<article class="pass pass--center pass--listen" aria-labelledby="st-title"><span class="eyebrow" style="justify-self:start">Passage en cours</span>' + ringIcon(false) +
        '<h2 class="pass-title" id="st-title">' + (quiet ? "Je n’entends rien pour l’instant" : "Je t’écoute.") + "</h2>" +
        '<p class="pass-sub">' + (quiet ? "Aucun son depuis " + Math.floor(s.silenceS) + " s. Si tu récites, rapproche le micro ou vérifie qu’il n’est pas coupé. Je garde le dernier verset et je reprends dès que tu continues." : "Rien d’entendu qui permette de nommer un verset. Je ne montre que ce dont je suis sûr.") + "</p>" +
        (s.exp ? '<div class="piste">' + ic("info") + '<span>Suite attendue : <b>' + s.exp + "</b> · pas encore confirmée, aucun texte n’est montré</span></div>" : "") + "</article>";
    } else if (v === "cands") {
      var c = s.cand, heard = wds(c.heard.ref).slice(0, c.heard.L), trail = "";
      s.trail.forEach(function (n, i) { trail += (i ? '<span class="ar-sep" aria-hidden="true">→</span>' : "") + '<span class="n' + (i === s.trail.length - 1 ? " now" : "") + '">' + n + "</span>"; });
      var pat = "";
      if (s.waitS >= CFG.patience[0]) {
        var pt = s.waitS >= CFG.patience[2] ? "Toujours pas départagé. Ce passage est difficile à identifier en direct ; il restera peut-être non nommé, et ce n’est pas une erreur." : s.waitS >= CFG.patience[1] ? "C’est plus long que d’habitude : récitation lente, ou mots mal entendus. Je continue, rien n’est perdu." : "Je continue d’écouter : il faut en général quelques mots de plus pour être sûr.";
        pat = '<div class="patience">' + ic("clock") + "<span>" + pt + "</span></div>";
      }
      h = '<article class="pass" aria-labelledby="st-title">' + headerHTML("Passage en cours") +
        '<div class="pass-meta"><span class="badge badge--outline"><span class="sw s-pending"></span>Candidats</span><span class="rng">' + plural(c.k, "mot entendu", "mots entendus") + "</span></div>" +
        '<div class="candwrap" id="st-title"><span class="candcount" aria-label="' + c.count + ' versets possibles">' + c.count + '</span><span class="l">' + (c.count > 1 ? "versets possibles" : "verset possible") + "</span></div>" +
        (s.trail.length > 1 ? '<div class="funnel" aria-label="Évolution du nombre de candidats">' + trail + "</div>" : "") + pat +
        '<div class="ar" lang="ar" dir="rtl" aria-label="Mots entendus">' + heard.map(function (w) { return '<span class="w">' + w + "</span>"; }).join(" ") + ' <span class="slot" aria-hidden="true"></span></div>' +
        (c.commonTr ? '<div class="tr-lbl">Traduction — la même pour les ' + c.count + ' versets possibles</div><p class="tr">' + sup(V[c.heard.ref].fr) + '</p><p class="attr">' + ATTR + "</p>" : "") +
        '<p class="pass-note"><b>Pas encore nommé.</b> ' + (c.commonTr ? "Ces versets ont exactement le même texte : seule la suite de ce que tu récitais peut dire lequel est le bon." : "Le texte ci-dessus est celui que tous les candidats ont en commun. Un mot de plus peut départager.") + "</p>" +
        (c.exp ? '<div class="piste">' + ic("info") + "<span>Piste : la suite attendue serait <b>" + c.exp + "</b> · pas encore confirmée</span></div>" : "") +
        (c.items && c.items.length ? '<details class="pistes"><summary>Voir les pistes (' + c.items.length + " sur " + c.count + ')</summary><ul>' + c.items.map(function (r) { return "<li>" + r + "</li>"; }).join("") + '</ul><p>Références seulement : un verset n’est montré, avec son texte, que lorsqu’il est nommé.</p></details>' : "") +
        "</article>";
    } else if (v === "named" || v === "inferred") {
      var L = s.lock, tot = wds(L.ref).length, inf = v === "inferred";
      h = '<article class="pass" aria-labelledby="st-title">' + headerHTML("Passage en cours") +
        '<div class="pass-meta">' + (inf ? '<span class="badge"><span class="sw s-inferred"></span>Déduit de la position</span>' : '<span class="badge"><span class="sw s-recognized"></span>Reconnu</span>') +
        '<span class="ref' + (inf ? " ref--ded" : "") + '" id="st-title">' + nm(L.ref) + "</span>" + (L.rep ? '<span class="tag">Reprise</span>' : "") + "</div>" +
        '<div class="ar" lang="ar" dir="rtl">' + arabic(L.ref, L.n, s.noTimes ? "plain" : "live") + "</div>" +
        (s.noTimes ? '<p class="pass-note">' + ic("info") + " Suivi mot à mot indisponible pour ce verset (pas de temps par mot) : le verset entier est montré, sans surlignage.</p>" : '<div class="prog"><span class="meter" aria-hidden="true"><i style="width:' + Math.round(100 * L.n / tot) + '%"></i></span><span>' + L.n + " / " + tot + " mots entendus</span></div>") +
        (inf ? '<div class="notice notice--info" style="grid-template-columns:20px minmax(0,1fr)">' + ic("info") + "<div><p><b>Entendu, mais pas reconnu à la voix.</b> Ce texte existe à l’identique en " + (DUP[L.ref] || []).join(" et ") + ". Le numéro " + L.ref + " vient de la suite de ce que tu venais de réciter.</p></div></div>" : "") +
        trHTML(L.ref) + "</article>";
    } else if (v === "unres") {
      var U = s.unres, hw = wds(U.heard.ref).slice(0, U.heard.L);
      h = '<article class="pass" aria-labelledby="st-title">' + headerHTML("Passage en cours") +
        '<div class="pass-meta"><span class="badge badge--outline"><span class="sw s-uncertain"></span>Pas de verset nommé</span><span class="rng">' + plural(U.k, "mot entendu", "mots entendus") + "</span></div>" +
        '<h2 class="pass-title" id="st-title">Pas de verset nommé pour l’instant</h2>' +
        '<p class="pass-sub">J’ai entendu ce passage, mais plusieurs versets conviennent : je ne le nomme pas plutôt que de risquer un faux nom.</p>' +
        '<div class="ar" lang="ar" dir="rtl" aria-label="Mots entendus">' + hw.map(function (w) { return '<span class="w">' + w + "</span>"; }).join(" ") + "</div>" +
        '<p class="pass-note"><b>Ce n’est pas une erreur.</b> En direct, un verset sur trois environ n’est jamais nommé (65 % nommés sur le banc de test) ; les versets très courts en font partie. Si tu gardes l’enregistrement, l’analyse complète peut en nommer davantage. Je continue d’écouter.</p>' +
        (s.jump ? '<div class="piste">' + ic("jump") + "<span>" + KIND_TXT[s.jump.kind] + " La suite ne correspond pas à ce que j’attendais.</span></div>" : "") + "</article>";
    } else if (v === "jump") {
      h = '<article class="pass pass--center" aria-labelledby="st-title"><span class="eyebrow" style="justify-self:start">Passage en cours</span>' + ringIcon(false) +
        '<h2 class="pass-title" id="st-title">Le passage change</h2><p class="pass-sub">' + KIND_TXT[s.jump.kind] + " Je n’écris aucun nom avant d’avoir entendu assez de mots.</p></article>";
    } else if (v === "nonquran") {
      h = '<article class="pass pass--center" aria-labelledby="st-title"><span class="eyebrow" style="justify-self:start">Passage en cours</span><span class="badge badge--outline"><span class="sw s-formula"></span>Parole non coranique</span>' +
        '<h2 class="pass-title" id="st-title">Ce n’est pas une récitation</h2><p class="pass-sub">Je ne montre rien tant que ce n’est pas du Coran. Dès qu’une récitation reprend, elle apparaît ici.</p></article>';
    } else if (v === "between") {
      var B = s.between;
      h = '<article class="pass pass--dim" aria-labelledby="st-title">' + headerHTML("Verset terminé") +
        '<div class="pass-meta"><span class="badge badge--outline">Terminé</span><span class="ref" id="st-title">' + nm(B.ref) + "</span></div>" +
        '<div class="ar" lang="ar" dir="rtl">' + arabic(B.ref, 0, "plain") + "</div>" + (V[B.ref] ? '<p class="tr" style="opacity:.8">' + sup(V[B.ref].fr) + "</p>" : "") +
        '<p class="pass-note"><b>J’écoute la suite…</b> ' + (s.exp ? "Suite attendue : " + s.exp + " (pas encore confirmée). " : "") + (s.silenceS >= CFG.silenceHintS ? "Aucun son depuis " + Math.floor(s.silenceS) + " s : rapproche le micro si tu récites." : "") + "</p></article>";
    } else if (v === "end") {
      h = endHTML(s);
    }
    return h;
  }

  function endHTML(s) {
    var ui = s.ui || {}, dur = fmt(s.endAt != null ? s.endAt : s.elapsed);
    var deg = s.degLog.length ? " · mode allégé " + s.degLog.map(function (d) { return fmt(d[0]) + "–" + (d[1] != null ? fmt(d[1]) : fmt(s.elapsed)); }).join(", ") : "";
    var top = s.err ? '<div class="notice notice--danger" role="alert" style="grid-template-columns:20px minmax(0,1fr);width:100%">' + ic(ERR[s.err].icon) + "<div><p><b>" + ERR[s.err].title + "</b></p><p><b>Pourquoi.</b> " + ERR[s.err].cause + "</p><p><b>Ce que ça change.</b> " + ERR[s.err].impact + "</p><p><b>Que faire.</b> " + ERR[s.err].todo + "</p></div></div>" : "";
    var keep;
    if (ui.keep === "sending") keep = '<div class="keep" role="status"><p><b>Envoi de l’enregistrement…</b> Il part comme un import classique ; l’analyse complète démarre ensuite.</p><div class="bar"><i style="--p:' + (ui.p || 40) + '%"></i></div></div>';
    else if (ui.keep === "queued") keep = '<div class="keep" role="status"><p><b>Enregistrement gardé.</b> Il est dans la file d’analyse (n° 1) et apparaîtra dans tes sessions sous le nom « Récitation en direct ». L’analyse complète va le relire en entier.</p><div class="end-acts"><a class="btn btn--primary" href="sessions.html">Ouvrir mes sessions</a><button class="btn btn--ghost" data-act="restart">Nouvelle écoute</button></div></div>';
    else if (ui.keep === "discarded") keep = '<div class="keep" role="status"><p><b>Rien n’a été gardé.</b> Le son et la liste ont été effacés de ce navigateur. Rien n’avait été enregistré sur le serveur.</p><div class="end-acts"><button class="btn btn--primary" data-act="restart">Nouvelle écoute</button><button class="btn btn--ghost" data-act="undo">Annuler (6 s)</button></div></div>';
    else keep = '<div class="keep"><p><b>Garder cet enregistrement ?</b> Le son n’a pas été conservé : il est resté dans la mémoire de ton navigateur, et rien n’est enregistré sur le serveur. Si tu le gardes, il est envoyé comme un import classique, analysé en entier (l’analyse complète peut nommer des versets que le direct n’a pas nommés), puis rangé dans tes sessions pour l’écouter et le relire.</p>' +
      '<div class="end-acts"><button class="btn btn--primary" data-act="keep">' + ic("keep") + 'Garder cet enregistrement</button><button class="btn btn--secondary" data-act="copy">' + ic("copy") + 'Copier la liste</button><button class="btn btn--ghost" data-act="restart">Recommencer</button><button class="btn btn--danger" data-act="discard">Ne rien garder</button></div></div>';
    return '<article class="pass end" aria-labelledby="st-title"><span class="eyebrow">Écoute terminée</span>' + top +
      '<h2 id="st-title">' + (s.err ? "Ce qui avait été entendu" : "Voilà ce que j’ai entendu.") + "</h2>" +
      '<p class="facts"><span>Durée <b>' + dur + "</b></span><span><b>" + s.named + "</b> " + (s.named > 1 ? "versets nommés" : "verset nommé") + "</span><span><b>" + s.unnamed + "</b> " + (s.unnamed > 1 ? "passages non nommés" : "passage non nommé") + "</span>" + (deg ? "<span>" + deg.replace(/^ · /, "") + "</span>" : "") + "</p>" + keep + "</article>";
  }

  function barHTML(s) {
    var p = s.phase, h = "";
    if (p === "listening" || p === "paused" || p === "ending") {
      h += p === "paused" ? '<span class="pill">' + '<span class="pausebars" aria-hidden="true"><i></i><i></i></span>En pause · micro coupé</span>' : '<span class="pill pill--rec"><span class="recdot" aria-hidden="true"></span>Micro actif</span>';
      h += s.net && s.net.state === "lost" ? '<span class="pill pill--warn">' + ic("link-off") + "Connexion perdue</span>" : s.catchup ? '<span class="pill">' + ic("refresh") + "Rattrapage en cours</span>" : '<span class="pill"><span class="d d--ring" aria-hidden="true"></span>Connecté</span>';
      if (s.degraded.length) h += '<span class="pill pill--warn">' + ic("gauge") + "Mode allégé</span>";
      h += '<span class="pill hide-m">' + ic("eye-off") + "Écran maintenu allumé</span>";
    }
    return h;
  }

  function noticesHTML(s) {
    var n = "", p = s.phase;
    if (p !== "listening" && p !== "paused" && p !== "ending") return "";
    if (s.net && s.net.state === "lost") {
      var retry = CFG.retryEveryS - Math.floor(s.cutS) % CFG.retryEveryS;
      n += '<div class="notice notice--warn fadein" role="status">' + ic("link-off") + "<div><p><b>Connexion perdue.</b> Je continue de capter ta voix et je garde le son (" + Math.floor(s.cutS) + " s) pour le renvoyer dès que la connexion revient. Les résultats reprendront ensuite.</p></div>" +
        '<div class="act"><button class="btn btn--secondary btn--sm" data-act="retry">Réessayer maintenant</button><span class="meta">Nouvel essai dans ' + retry + " s</span></div></div>";
    } else if (s.catchup) {
      n += '<div class="notice notice--info fadein" role="status">' + ic("refresh") + "<div><p><b>Connexion rétablie.</b> J’envoie le son gardé pendant la coupure (" + Math.round(s.net.catchup + 3.4) + " s). Les résultats vont rattraper leur retard ; rien n’est perdu.</p></div></div>";
    }
    if (s.degraded.length) {
      var ov = s.degraded.indexOf("overload") >= 0, t3 = s.degraded.indexOf(3) >= 0;
      n += '<div class="notice notice--warn fadein" role="status">' + ic("gauge") + "<div><p><b>Mode allégé" + (ov ? " — serveur surchargé" : "") + ".</b> " +
        (ov ? "L’analyse a " + fmt1(s.lag) + " s de retard : les mots arrivent plus tard. " : t3 ? "Je ne réécoute pas les passages douteux pour l’instant : une correction peut arriver plus tard, ou ne pas arriver. " : "Le serveur est occupé : je saute la vérification acoustique en fin de verset. ") +
        "Pour rester sûr, je demande plus de mots avant de nommer un verset.</p><p><b>Ce que ça change.</b> Les noms arrivent plus tard, et un verset très court peut ne pas être nommé. Ce n’est jamais moins sûr : la règle ne s’assouplit pas.</p></div></div>";
    }
    if (s.rev && s.now - s.rev.at <= CFG.revisionShownS) {
      n += '<div class="notice notice--warn fadein" role="status">' + ic("alert") + "<div><p><b>Correction.</b> " + s.rev.ref + " n’est plus nommé : la vérification acoustique n’a pas confirmé ces mots. Le passage reste dans la liste, marqué « corrigé », et son texte n’est plus affiché.</p></div></div>";
    }
    if (s.tabHidden) n += '<div class="notice notice--warn" role="status">' + ic("eye-off") + "<div><p><b>L’onglet était en arrière-plan.</b> Le navigateur a peut-être coupé le micro entre " + fmt(s.tabHidden[0]) + " et " + fmt(s.tabHidden[1]) + " : ce passage n’a pas été écouté. Garde l’écran allumé et l’onglet au premier plan.</p></div></div>";
    return n;
  }

  function knowHTML(s) {
    if (["listening", "paused", "ending"].indexOf(s.phase) < 0) return "";
    var words = s.lock ? s.lock.n : s.cand ? s.cand.k : 0;
    var cands = s.lock ? "1" : s.cand ? String(s.cand.count) : "—";
    var last = s.hist.filter(function (h) { return h.kind === "verse" && h.status !== "uncertain"; })[0];
    return '<dl class="know"><div><dt>Écoute</dt><dd>' + fmt(s.elapsed) + "<small>" + (s.net && s.net.state === "lost" ? "connexion coupée" : "connecté") + "</small></dd></div>" +
      "<div><dt>Mots entendus</dt><dd>" + (words || "—") + "<small>dans ce passage</small></dd></div>" +
      "<div><dt>Candidats</dt><dd>" + cands + "<small>" + (s.lock ? "verset nommé" : "versets possibles") + "</small></dd></div>" +
      "<div><dt>Dernier nommé</dt><dd>" + (last ? last.ref : "—") + "<small>" + (last ? "il y a " + Math.max(0, Math.round(s.now - (T0 + last.t[1]))) + " s" : "rien pour l’instant") + "</small></dd></div></dl>";
  }

  function ribbonHTML(s, quiet) {
    var o = "", n = 40;
    for (var i = 0; i < n; i++) { var l = s.phase === "paused" ? 0.04 : level(s.sc, s.now - (n - 1 - i) * 0.12); o += '<i style="--h:' + Math.round(8 + l * 92) + '%"></i>'; }
    return '<div class="ribbon" aria-hidden="true" data-quiet="' + (quiet ? "true" : "false") + '">' + o + "</div>";
  }

  function dockHTML(s) {
    var p = s.phase;
    if (p === "idle") return '<div class="dock dock--idle"><div class="grow"><b>Prêt à écouter</b><div class="dock-note">Le micro ne s’ouvre qu’après ton accord.</div></div><button class="btn btn--primary btn--lg btn--wide" type="button" data-act="start">' + ic("mic") + '<span class="lbl">Démarrer l’écoute</span></button></div>';
    if (p === "permission") return '<div class="dock dock--idle"><div class="grow"><b>En attente de ton accord</b><div class="dock-note">Réponds à la demande du navigateur.</div></div><button class="btn btn--primary btn--lg btn--wide" type="button" disabled>' + ic("mic") + '<span class="lbl">Démarrer l’écoute</span></button></div>';
    if (p === "connecting") return '<div class="dock dock--idle"><div class="grow"><b>Connexion…</b><div class="dock-note">Aucun son n’est envoyé pour l’instant.</div></div><button class="btn btn--secondary btn--lg btn--wide" type="button" data-act="restart">Annuler</button></div>';
    if (p === "error") return '<div class="dock dock--idle"><div class="grow"><b>Écoute impossible</b><div class="dock-note">Lis ce qui ne va pas, puis réessaie.</div></div></div>';
    if (p === "ending") return '<div class="dock dock--idle" role="status"><div class="grow"><b>Je termine l’analyse…</b><div class="dock-note">Le dernier passage est en cours de vérification.</div></div><button class="btn btn--secondary btn--lg btn--wide" type="button" disabled>Arrêter</button></div>';
    if (p === "ended" || p === "kept") return '<div class="dock dock--idle"><div class="grow"><b>Écoute terminée</b><div class="dock-note">' + fmt(s.endAt != null ? s.endAt : s.elapsed) + "</div></div>" + '<button class="btn btn--secondary btn--lg btn--wide" type="button" data-act="restart">' + ic("mic") + '<span class="lbl">Nouvelle écoute</span></button></div>';
    var paused = p === "paused", cut = s.net && s.net.state === "lost";
    return '<div class="dock" role="group" aria-label="Contrôles de l’écoute"><span class="dock-time" role="timer" aria-label="Durée d’écoute">' + (paused ? '<span class="pausebars" aria-hidden="true"><i></i><i></i></span>' : '<i class="recdot recdot--pulse" aria-hidden="true"></i>') + "<span>" + fmt(s.elapsed) + "</span></span>" +
      ribbonHTML(s, paused || s.silenceS > 3) + (cut ? '<span class="dock-note">son gardé ' + Math.floor(s.cutS) + " s</span>" : "") +
      (paused ? '<button class="btn btn--primary btn--lg" type="button" data-act="resume">' + ic("play") + '<span class="lbl">Reprendre</span></button>' : '<button class="btn btn--secondary btn--lg" type="button" data-act="pause" aria-label="Mettre en pause">' + ic("pause") + '<span class="lbl">Pause</span></button>') +
      '<button class="btn btn--secondary btn--lg btn--wide" type="button" data-act="stop"><i class="sq" aria-hidden="true"></i><span class="lbl">Arrêter</span></button></div>';
  }

  function histRow(s, h, i) {
    var sw = "s-uncertain", t = "", sub = "", body = "", flat = false, tags = "";
    var range = h.t ? fmt(Math.max(0, h.t[0])) + "–" + fmt(Math.max(0, Math.min(h.t[1], s.now - T0))) : "";
    if (h.kind === "verse") {
      sw = h.status === "recognized" ? "s-recognized" : h.status === "inferred" ? "s-inferred" : "s-uncertain";
      t = nm(h.ref); if (h.rep) tags += '<span class="tag">Reprise</span>'; if (h.revised) tags += '<span class="tag tag--warn">Corrigé</span>'; if (h.partial) tags += '<span class="tag">Interrompu</span>';
      sub = h.revised ? "Nommé puis retiré · incertain après vérification" : h.status === "inferred" ? "Déduit de la position · texte entendu" : "Reconnu";
      if (h.n) sub += " · " + plural(h.n, "mot", "mots");
      if (h.revised) body = '<p class="hrow-s">Ce verset avait été nommé ' + h.ref + ", puis n’a pas été confirmé par la vérification acoustique. Son texte n’est plus affiché : il ne serait plus présenté comme sûr.</p>";
      else if (V[h.ref]) body = '<div class="ar" lang="ar" dir="rtl">' + arabic(h.ref, 0, "plain") + '</div><p class="tr">' + sup(V[h.ref].fr) + '</p><p class="attr">' + ATTR + "</p>";
      else body = '<p class="hrow-s">Texte non chargé dans cette démo.</p>';
    } else if (h.kind === "unres") {
      var older = s.hist.slice(i + 1).filter(function (x) { return x.kind === "verse"; })[0], newer = s.hist.slice(0, i).filter(function (x) { return x.kind === "verse"; }).slice(-1)[0];
      t = "Passage non nommé"; sub = plural(h.k, "mot entendu", "mots entendus") + " · plusieurs versets possibles";
      if (h.gap && older && newer) sub += " · entre " + older.ref + " et " + newer.ref;
      var hw = wds(h.heard.ref).slice(0, h.heard.L);
      body = '<div class="ar" lang="ar" dir="rtl">' + hw.map(function (w) { return '<span class="w">' + w + "</span>"; }).join(" ") + '</div><p class="hrow-s">Mots communs à tous les candidats. Ce n’est pas une erreur : le moteur préfère ne rien nommer. L’analyse complète de l’enregistrement peut en nommer davantage.</p>';
    } else if (h.kind === "jump") {
      return '<li class="hrow hrow--sep"><div class="hrow-flat"><span class="glyph">' + ic("jump") + '</span><div><div class="hrow-t">' + (KIND_TXT[h.jk] || KIND_TXT.unknown).replace(/\.$/, "") + '</div></div><span class="hrow-e">' + fmt(Math.max(0, h.t[0])) + "</span></div></li>";
    } else if (h.kind === "nq") {
      return '<li class="hrow hrow--sep"><div class="hrow-flat"><span class="sw s-formula" style="margin-top:3px"></span><div><div class="hrow-t">Parole non coranique</div><div class="hrow-s">Rien n’est affiché</div></div><span class="hrow-e">' + range + "</span></div></li>";
    }
    return '<li class="hrow" data-revised="' + (h.revised ? "true" : "false") + '"><details><summary><span class="sw ' + sw + '"></span><div><div class="hrow-t">' + t + tags + '</div><div class="hrow-s">' + sub + '</div></div><span class="hrow-e">' + range + '</span></summary><div class="hrow-body">' + body + "</div></details></li>";
  }

  function histHTML(s) {
    var rows = s.hist.map(function (h, i) { return histRow(s, h, i); }).join("");
    var cur = "";
    if (s.lock) cur = '<li class="hrow"><div class="hrow-flat"><span class="sw ' + (s.lock.status === "inferred" ? "s-inferred" : "s-recognized") + '"></span><div><div class="hrow-t">' + nm(s.lock.ref) + '<span class="tag">En cours</span></div><div class="hrow-s">Affiché dans la carte « Passage en cours »</div></div><span class="hrow-e"></span></div></li>';
    var any = rows || cur;
    return '<section class="hist" aria-labelledby="hist-t"><div class="hist-h"><h2 id="hist-t">Passages</h2></div>' +
      '<p class="hist-sum"><b>' + s.named + "</b> " + (s.named > 1 ? "nommés" : "nommé") + " · <b>" + s.unnamed + "</b> non " + (s.unnamed > 1 ? "nommés" : "nommé") + "</p>" +
      (any ? '<ul aria-label="Passages de cette écoute, du plus récent au plus ancien">' + cur + rows + "</ul>" : '<p class="hist-empty">Les passages apparaissent ici au fur et à mesure. Un passage non nommé y a sa place : il n’est pas une erreur.</p>') + "</section>";
  }

  function techHTML(s) {
    var last = s.log.slice(-7).reverse().map(function (x) {
      var e = x.e, d = "";
      if (e.type === "CANDIDATES") d = "k=" + e.k + " count=" + e.count + " class=" + e.cls;
      else if (e.type === "LOCKED") d = "ref=" + e.ref + " status=" + e.status + " basis=" + e.basis + " k=" + e.k;
      else if (e.type === "PROGRESS") d = "ref=" + e.ref + " n=" + e.n;
      else if (e.type === "CONTINUE") d = "ref=" + e.ref + " expected=" + (e.exp || "—");
      else if (e.type === "JUMP") d = "kind=" + e.kind + " from=" + e.from;
      else if (e.type === "LOST") d = "reason=" + e.reason;
      else if (e.type === "REVISION") d = "ref=" + e.ref + " status=" + e.status + " reason=" + e.reason;
      else if (e.type === "CLOSED") d = "status=uncertain k=" + e.k;
      else if (e.type === "DEG") d = "tiers=[" + e.tiers.join(",") + "] lag=" + e.lag;
      else if (e.type === "PHASE") d = e.phase;
      return '<div><span class="s">#' + x.seq + " t=" + fmt1(Math.max(0, e.at - T0)) + "</span> <span class=\"k\">" + e.type + "</span> " + d + "</div>";
    }).join("");
    var part = s.lastWords ? strip(s.lastWords) + " …" : "…";
    return '<section class="tech" aria-label="Mode technique"><h3>Mode technique</h3>' +
      '<div class="partial"><span class="lbl">Transcription provisoire (PARTIAL) — sortie du modèle, non vérifiée, jamais le texte du Mushaf</span><div class="txt" lang="ar" dir="rtl">' + part + "</div></div>" +
      '<div><h3>Derniers messages aqr.live/1</h3><div class="log">' + (last || "—") + "</div></div>" +
      '<div class="log"><div><span class="s">retard de traitement</span> ' + fmt1(s.lag) + " s</div><div><span class=\"s\">son gardé côté client</span> " + Math.floor(s.cutS) + " s</div><div><span class=\"s\">paliers sautés</span> " + (s.degraded.length ? s.degraded.join(", ") : "aucun") + "</div></div></section>";
  }

  /* ───────── Annonces d'accessibilité (sobres) ───────── */
  function announceKey(s) {
    return { phase: s.phase, lock: s.lock ? s.lock.ref + s.lock.status : "", rev: s.rev ? s.rev.ref : "", net: s.net ? s.net.state : "", deg: s.degraded.join(","), unres: s.unres ? "u" + s.unres.at : "", nq: s.lost && s.lost.reason === "non_quran" ? "nq" : "", named: s.named };
  }
  function announce(a, b) {
    if (!a || !b) return null;
    if (a.phase !== b.phase) { if (b.phase === "listening") return "Écoute démarrée."; if (b.phase === "ended") return "Écoute terminée."; if (b.phase === "paused") return "Écoute en pause."; }
    if (b.rev && a.rev !== b.rev) return "Correction : " + b.rev + " n’est plus nommé.";
    return null;
  }
  function announceFrom(prevState, s) {
    var a = prevState ? announceKey(prevState) : null, b = announceKey(s);
    var msg = announce(a, b);
    if (msg) return msg;
    if (a && b.lock && a.lock !== b.lock) return s.lock.status === "inferred" ? "Verset déduit de la position : " + nm(s.lock.ref) + ". Non reconnu à la voix." : "Verset nommé : " + nm(s.lock.ref) + ".";
    if (a && b.net !== a.net) return b.net === "lost" ? "Connexion perdue. L’écoute continue." : b.net === "back" ? "Connexion rétablie." : null;
    if (a && b.deg !== a.deg) return b.deg ? "Mode allégé : les noms arriveront plus tard." : "Retour au mode normal.";
    if (a && b.unres && b.unres !== a.unres) return "Passage entendu, non nommé. Ce n’est pas une erreur.";
    return null;
  }

  window.LiveCore = { CFG: CFG, SPRITE: SPRITE, stateAt: stateAt, viewOf: viewOf, stageHTML: stageHTML, barHTML: barHTML, noticesHTML: noticesHTML, knowHTML: knowHTML, dockHTML: dockHTML,
    histHTML: histHTML, techHTML: techHTML, endHTML: endHTML, announceFrom: announceFrom, fmt: fmt, ic: ic, nm: nm };
})();
