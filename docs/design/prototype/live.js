/* « En direct » — contrôleur du prototype (live.html). Rejoue un scénario factice (live-data.js) à travers le
   réducteur de live-core.js. Adresse : #sc=fatiha|lente|refrain|sauts|correction|coupure|expiree|surcharge
   · t=12.4 (fige cet instant) · theme=light|dark · font=amiri-quran|scheherazade|noto-naskh · tech=1 · bench=0
   · err=denied|insecure|nomic|busy|server_busy|unsupported|internal · speed=1|2|4 */
(function () {
  var C = window.LiveCore, SC = window.LIVE_SCENARIOS, T0 = window.LIVE_T0;
  document.body.insertAdjacentHTML("afterbegin", C.SPRITE);
  var q = {}; location.hash.replace(/^#/, "").split("&").forEach(function (p) { var a = p.split("="); if (a[0]) q[a[0]] = decodeURIComponent(a[1] || ""); });
  var root = document.documentElement;
  if (q.theme) root.setAttribute("data-theme", q.theme);
  if (q.font) root.setAttribute("data-quran-font", q.font);
  var $ = function (id) { return document.getElementById(id); };
  var id = SC[q.sc] ? q.sc : "fatiha", sc = SC[id];
  var st = { now: q.t != null ? +q.t : 0, playing: false, speed: +(q.speed || SC[id].speed || 1), paused: false, ui: { keep: null }, tech: q.tech === "1", err: q.err || null, prev: null, lastAnn: 0, cache: {} };
  var FONTS = ["amiri-quran", "scheherazade", "noto-naskh"];
  var dur = function () { return sc.stop != null ? sc.stop + 1.4 + 3 : 50; };

  function build() {
    var patch = { ui: st.ui };
    var s = C.stateAt(sc, st.now, null);
    if (st.err) { patch.phase = "error"; patch.errCode = st.err; }
    else if (st.paused && s.phase === "listening") patch.phase = "paused";
    if (st.tabHidden) patch.tabHidden = st.tabHidden;
    s = C.stateAt(sc, st.now, patch);
    return s;
  }
  function setHTML(slot, html) { if (st.cache[slot] !== html) { st.cache[slot] = html; $(slot).innerHTML = html; } }
  function render() {
    var s = build();
    document.querySelector(".lv").dataset.phase = s.phase; setHTML("stage", C.stageHTML(s)); setHTML("bar", C.barHTML(s)); setHTML("notices", C.noticesHTML(s)); setHTML("know", C.knowHTML(s)); setHTML("hist", C.histHTML(s));
    setHTML("tech", st.tech ? C.techHTML(s) : "");
    var key = [s.phase, s.net && s.net.state, s.lock ? 1 : 0].join("|"), slot = $("dock-slot");
    if (slot.dataset.key !== key) { slot.dataset.key = key; slot.innerHTML = C.dockHTML(s); }
    else { var tm = slot.querySelector(".dock-time span:last-child"); if (tm) tm.textContent = C.fmt(s.elapsed); var bars = slot.querySelectorAll(".ribbon i"); if (bars.length) { var tmp = document.createElement("div"); tmp.innerHTML = C.dockHTML(s); var nb = tmp.querySelectorAll(".ribbon i"); for (var i = 0; i < bars.length && i < nb.length; i++) bars[i].style.setProperty("--h", nb[i].style.getPropertyValue("--h")); } }
    $("tech-sw").setAttribute("aria-checked", st.tech ? "true" : "false");
    $("btn-play").innerHTML = st.playing ? "Pause démo" : "Lecture démo";
    $("scrub").value = st.now; $("tnow").textContent = st.now.toFixed(1).replace(".", ",") + " s";
    if (st.playing || st.prev) { var m = C.announceFrom(st.prev, s); if (m && st.playing && Date.now() - st.lastAnn > 2500) { $("live").textContent = m; st.lastAnn = Date.now(); } }
    st.prev = s;
  }
  function setScenario(k) { id = k; sc = SC[k]; st.now = 0; st.playing = false; st.paused = false; st.ui = { keep: null }; st.err = null; st.speed = SC[k].speed || 1; st.cache = {}; st.prev = null; $("dock-slot").dataset.key = ""; $("scrub").max = dur(); $("about").textContent = sc.about; $("speed").value = String(st.speed); render(); }
  function toast(t) { var d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b) return; var a = b.getAttribute("data-act");
    if (a === "start") { st.err = null; if (st.now >= 1.6 && st.now < 3.6 && !st.playing) { st.playing = true; } else { st.now = 1.6; st.playing = true; } st.paused = false; }
    else if (a === "restart") { st.now = 0; st.playing = false; st.paused = false; st.ui = { keep: null }; st.err = null; }
    else if (a === "pause") { st.paused = true; }
    else if (a === "resume") { st.paused = false; }
    else if (a === "stop") { if (sc.stop != null && st.now < sc.stop) st.now = sc.stop; st.paused = false; st.playing = true; }
    else if (a === "font") { var cur = root.getAttribute("data-quran-font") || "amiri-quran"; root.setAttribute("data-quran-font", FONTS[(FONTS.indexOf(cur) + 1) % FONTS.length]); toast("Police : " + root.getAttribute("data-quran-font") + " (KFGQPC Hafs V30 n’est pas embarquée dans le prototype)"); }
    else if (a === "bigger" || a === "smaller") { var cs = parseFloat(getComputedStyle(root).getPropertyValue("--quran-size")) || 40; root.style.setProperty("--quran-size", Math.max(28, Math.min(72, cs + (a === "bigger" ? 4 : -4))) + "px"); }
    else if (a === "keep") { st.ui = { keep: "sending", p: 5 }; var t = setInterval(function () { st.ui.p += 18; if (st.ui.p >= 100) { clearInterval(t); st.ui = { keep: "queued" }; } render(); }, 280); }
    else if (a === "discard") { st.ui = { keep: "discarded" }; }
    else if (a === "undo") { st.ui = { keep: null }; }
    else if (a === "copy") { toast("Liste copiée (démo)"); }
    else if (a === "retry") { toast("Nouvelle tentative de connexion…"); }
    else if (a === "classic") { toast("Dans l’atelier : Nouvel essai, puis Enregistrer une récitation"); }
    render();
  });
  $("tech-sw").addEventListener("click", function () { st.tech = !st.tech; render(); });
  $("btn-play").addEventListener("click", function () { if (st.now >= dur()) st.now = 0; st.playing = !st.playing; render(); });
  $("btn-restart").addEventListener("click", function () { st.now = 0; st.playing = false; st.paused = false; st.ui = { keep: null }; st.err = null; render(); });
  $("scrub").addEventListener("input", function (e) { st.now = +e.target.value; st.playing = false; st.err = null; render(); });
  $("speed").addEventListener("change", function (e) { st.speed = +e.target.value; });
  $("scn").addEventListener("change", function (e) { setScenario(e.target.value); });
  $("theme").addEventListener("click", function () { var d = root.getAttribute("data-theme"); var dark = d ? d === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; root.setAttribute("data-theme", dark ? "light" : "dark"); });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest("input,select,textarea,button,summary")) return;
    if (e.code === "Space" && ["listening", "paused"].indexOf(build().phase) >= 0) { e.preventDefault(); st.paused = !st.paused; render(); }
    if (e.key === "t" || e.key === "T") { st.tech = !st.tech; render(); }
  });

  Object.keys(SC).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = SC[k].title; if (k === id) o.selected = true; $("scn").appendChild(o); });
  $("scrub").max = dur(); $("about").textContent = sc.about; $("speed").value = String(st.speed);
  if (q.bench === "0") $("bench").hidden = true;
  setInterval(function () { if (st.playing && !st.paused) { st.now = Math.min(dur(), st.now + 0.1 * st.speed); if (st.now >= dur()) st.playing = false; } if (st.playing || st.paused) render(); }, 100);
  render();
})();
