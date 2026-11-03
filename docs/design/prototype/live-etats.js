/* « En direct » — galerie de tous les états (live-etats.html). Chaque cadre est un instant d'un scénario factice rendu
   par le même noyau que live.html (live-core.js). Données factices, voir live-data.js. */
(function () {
  var C = window.LiveCore, SC = window.LIVE_SCENARIOS;
  document.body.insertAdjacentHTML("afterbegin", C.SPRITE);
  var q = {}; location.hash.replace(/^#/, "").split("&").forEach(function (p) { var a = p.split("="); if (a[0]) q[a[0]] = decodeURIComponent(a[1] || ""); });
  if (q.theme) document.documentElement.setAttribute("data-theme", q.theme);
  if (q.font) document.documentElement.setAttribute("data-quran-font", q.font);
  var E = function (c) { return { phase: "error", errCode: c }; };
  var S = [
    ["a", "Avant l’écoute", [
      ["Prêt", "On sait déjà quoi attendre : la légende des états, la patience annoncée, la promesse sur le son.", "fatiha", 0, null, ["stage", "dock"]],
      ["Demande d’accès au micro", "Avant la fenêtre du navigateur : ce qui va se passer, et que rien n’est envoyé.", "fatiha", 2.2, null, ["stage", "dock"]],
      ["Connexion au service", "Le micro est ouvert, aucun son ne part avant READY.", "fatiha", 3.9, null, ["stage", "dock"]],
      ["Micro refusé", "Ce qui ne marche pas, pourquoi, l’impact, que faire.", "fatiha", 0, E("denied"), ["stage", "dock"]],
      ["Page non sécurisée (http)", "Cas du téléphone sur le réseau local : le navigateur interdit le micro.", "fatiha", 0, E("insecure"), ["stage", "dock"]],
      ["Aucun micro", "", "fatiha", 0, E("nomic"), ["stage"]],
      ["Micro déjà utilisé", "", "fatiha", 0, E("busy"), ["stage"]],
      ["Service complet (server_busy)", "Le message du service est en français clair ; l’interface ajoute la cause et la suite.", "fatiha", 0, E("server_busy"), ["stage"]],
      ["Navigateur incompatible", "", "fatiha", 0, E("unsupported"), ["stage"]]
    ]],
    ["b", "Pendant : les niveaux d’affichage", [
      ["Niveau 0 · Écoute", "Rien d’inventé : l’anneau respire, le niveau sonore bouge, les compteurs disent « — ».", "fatiha", 7.2, null, ["bar", "stage", "know", "dock"]],
      ["Niveau 1 · Candidats", "Le nombre, les mots communs, un emplacement vide pour le mot suivant. Aucun nom de verset, aucun texte de candidat.", "fatiha", 8.8, null, ["bar", "stage", "know"]],
      ["Niveau 1 · Candidats, piste", "La suite attendue est une piste, pas un nom : référence seulement, jamais de texte.", "fatiha", 13.2, null, ["stage"]],
      ["Niveau 1 · Sosies, traduction commune", "Tous les candidats ont le même texte et la même traduction : on peut les montrer, sans nommer.", "refrain", 9.9, null, ["stage"]],
      ["Niveau 3 · Verset nommé", "Texte du corpus, traduction QuranEnc avec attribution ; mots entendus en encre pleine, mots à venir en gris, dernier mot entendu souligné.", "fatiha", 10.6, null, ["bar", "stage", "know"]],
      ["Niveau 3 · Nommé, verset entendu en entier", "", "fatiha", 11.3, null, ["stage"]],
      ["Niveau 3 · Sans temps de mots", "Pas de temps par mot : le verset entier, sans surlignage, et on le dit.", "fatiha", 11.3, { noTimes: true }, ["stage"]],
      ["Niveau 4 · Déduit de la position", "Le texte est entendu, le numéro est déduit : badge, référence en italique pointillé, explication, jamais « Reconnu ».", "refrain", 11.0, null, ["stage"]],
      ["Pas de verset nommé pour l’instant", "État normal. Rassure sans mentir : pas une erreur, un verset sur trois environ, l’analyse complète peut faire mieux.", "fatiha", 16.2, null, ["stage"]],
      ["Parole non coranique", "Aucun candidat, aucun verset. Une ligne neutre dans la liste.", "sauts", 16.0, null, ["stage"]],
      ["Silence prolongé", "Une aide, pas une erreur. Après un verset, le dernier verset reste affiché et la même aide s’ajoute.", "fatiha", 5, { silenceS: 11 }, ["stage"]],
      ["Latence 1 · après 6 s de candidats", "On dit que c’est normal, sans compte à rebours.", "lente", 16.0, null, ["stage"]],
      ["Latence 2 · après 12 s", "Récitation lente ou mal entendue : le système continue, rien n’est perdu.", "lente", 22.5, null, ["stage"]],
      ["Verset terminé · j’écoute la suite", "Le dernier verset reste affiché (atténué) pendant les ≈ 2,5 s avant les premiers candidats.", "fatiha", 12.2, null, ["stage"]],
      ["Saut : le passage change", "JUMP : aucun nom avant d’avoir entendu assez de mots.", "sauts", 22.05, null, ["stage"]],
      ["Reprise du même verset", "La carte repart du premier mot ; l’étiquette « Reprise ».", "sauts", 43.0, null, ["stage", "hist"]]
    ]],
    ["c", "Corrections, dégradations, coupures", [
      ["Correction (REVISION)", "Le verset reste dans la liste, marqué « Corrigé » ; son texte n’est plus affiché. Bandeau explicatif 14 s.", "correction", 19.0, null, ["notices", "hist"]],
      ["Mode allégé · palier 2 sauté", "Dit en clair, jamais caché : la vérification acoustique est sautée, le verrou se durcit.", "surcharge", 13.5, null, ["bar", "notices", "stage"]],
      ["Mode allégé · surcharge", "Retard chiffré, conséquence nommée (un verset court peut ne pas être nommé).", "surcharge", 21.0, null, ["bar", "notices", "stage"]],
      ["Mode allégé · palier 3 sauté", "Les réécoutes de contrôle sont suspendues : une correction peut tarder ou ne pas venir.", "fatiha", 19.0, { degraded: [3], lag: 0.6 }, ["bar", "notices"]],
      ["Passage non nommé à cause du durcissement", "Un verset de 3 mots n’atteint plus le minimum en mode allégé : état normal, expliqué.", "surcharge", 16.6, null, ["stage", "hist"]],
      ["Connexion perdue", "Le micro continue, le son est gardé ; nouvel essai automatique et manuel.", "coupure", 12.5, null, ["bar", "notices", "dock", "know"]],
      ["Connexion rétablie · rattrapage", "Le son gardé est renvoyé ; les résultats rattrapent leur retard.", "coupure", 16.8, null, ["bar", "notices", "stage"]],
      ["Onglet resté en arrière-plan", "Le navigateur a pu couper le micro : on le dit, avec la plage concernée.", "fatiha", 22.0, { tabHidden: [10, 18] }, ["notices", "stage"]],
      ["En pause", "Micro coupé, durée figée, rien n’est envoyé.", "fatiha", 9.0, { phase: "paused" }, ["bar", "dock"]]
    ]],
    ["d", "Après l’écoute", [
      ["Fin en cours", "END envoyé : le serveur vide ses tampons avant FINAL.", "fatiha", 31.8, null, ["dock", "stage"]],
      ["Écoute terminée", "Résumé honnête (nommés, non nommés) ; « Garder cet enregistrement » est le seul geste qui crée quoi que ce soit.", "fatiha", 34.5, null, ["stage", "hist"]],
      ["Garder · envoi", "Même parcours qu’un import classique.", "fatiha", 34.5, { ui: { keep: "sending", p: 55 } }, ["stage"]],
      ["Garder · dans la file", "", "fatiha", 34.5, { ui: { keep: "queued" } }, ["stage"]],
      ["Ne rien garder", "Le son et la liste sont effacés de ce navigateur ; annulable 6 s.", "fatiha", 34.5, { ui: { keep: "discarded" } }, ["stage"]],
      ["Session expirée (coupure trop longue)", "L’erreur s’explique ; le résumé garde ce qui avait été entendu ; garder l’enregistrement local reste possible.", "expiree", 45, null, ["stage", "hist"]]
    ]]
  ];
  var out = '<nav class="toc" aria-label="Sections">' + S.map(function (x) { return '<a href="#sec-' + x[0] + '">' + x[1] + "</a>"; }).join("") + "</nav>";
  S.forEach(function (sec) {
    out += '<h2 class="sec" id="sec-' + sec[0] + '">' + sec[1] + '</h2><div class="gal-grid" id="grid-' + sec[0] + '">';
    sec[2].forEach(function (f) {
      var s = C.stateAt(SC[f[2]], f[3], f[4]), html = "", parts = f[5];
      if (f[4] && f[4].ui) s.ui = f[4].ui;
      parts.forEach(function (p) {
        if (p === "bar") { var b = C.barHTML(s); if (b) html += '<div class="statusbar">' + b + "</div>"; }
        if (p === "notices") { var n = C.noticesHTML(s); if (n) html += '<div class="notices">' + n + "</div>"; }
        if (p === "stage") html += C.stageHTML(s);
        if (p === "know") html += C.knowHTML(s);
        if (p === "dock") html += C.dockHTML(s);
        if (p === "hist") html += C.histHTML(s);
      });
      out += '<div class="frame"><div class="cap"><b>' + f[0] + "</b>" + (f[1] || "") + '</div><div class="lv-frame">' + html + "</div></div>";
    });
    out += "</div>";
  });
  document.getElementById("gal").innerHTML = out;
})();
