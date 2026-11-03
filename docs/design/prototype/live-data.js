/* « En direct » — données FACTICES du prototype.
   Ce que ce fichier contient de réel : le texte arabe (Tanzil) et la traduction (QuranEnc) lus dans live-verses.js,
   les noms de sourates, et les ordres de grandeur de latence (premier CANDIDATES ≈ 2,5 s après le début d'un verset,
   LOCKED ≈ 5 s, jusqu'à 20 s sur voix difficile : docs/evaluation/live-etape2-2026-10-24.md).
   Ce qui est inventé : tous les temps, tous les nombres de candidats, les pistes, les niveaux sonores, les coupures.
   Les scénarios sont écrits à la main d'après les règles de l'ADR-0011, PAS produits par le moteur.
   Les événements reprennent les messages d'aqr.live/1 (CANDIDATES, LOCKED, CONTINUE, JUMP, LOST, REVISION…) ;
   PROGRESS et CLOSED sont des propositions (voir docs/design/en-direct.md §9). `at` = secondes du banc de démo. */
(function () {
  var T0 = 4.2; // le flux commence à la fin de l'établissement de la connexion
  window.LIVE_T0 = T0;
  window.LIVE_SURAH = { 1: "Al-Fatiha", 2: "Al-Baqara", 56: "Al-Waqi‘a", 67: "Al-Mulk", 69: "Al-Haqqa" };

  var PRE = [
    { at: 0, type: "PHASE", phase: "idle" },
    { at: 1.6, type: "PHASE", phase: "permission" },
    { at: 3.6, type: "PHASE", phase: "connecting" },
    { at: T0, type: "READY", degraded: [] },
    { at: T0, type: "PHASE", phase: "listening" }
  ];
  var C = function (at, ref, k, count, cls, o) { o = o || {}; return { at: at, type: "CANDIDATES", heard: { ref: ref, L: o.L || k }, k: k, count: count, cls: cls || "start", items: o.items || [], exp: o.exp || null, commonTr: !!o.commonTr }; };
  var L = function (at, ref, k, status, basis, start, o) { o = o || {}; return { at: at, type: "LOCKED", ref: ref, k: k, status: status || "recognized", basis: basis || "words", start: start, rep: !!o.rep }; };
  var P = function (at, ref, n) { return { at: at, type: "PROGRESS", ref: ref, n: n }; };
  var K = function (at, ref, end, exp) { return { at: at, type: "CONTINUE", ref: ref, end: end, exp: exp || null }; };
  var Z = function (at, ref, k, start, end) { return { at: at, type: "CLOSED", status: "uncertain", heard: { ref: ref, L: k }, k: k, start: start, end: end }; };
  var J = function (at, kind, from) { return { at: at, type: "JUMP", kind: kind, from: from }; };
  var X = function (at, reason) { return { at: at, type: "LOST", reason: reason }; };
  var STOP = function (at) { return [{ at: at, type: "PHASE", phase: "ending" }, { at: at + 1.4, type: "FINAL" }]; };
  var cat = function () { return Array.prototype.concat.apply([], arguments); };

  var fatiha12 = [C(8.6, "1:2", 2, 52, "start", { items: ["1:2", "6:1", "18:1", "34:1", "35:1"] }), C(9.5, "1:2", 3, 7, "start", { items: ["1:2", "6:1"] }), L(10.4, "1:2", 3, "recognized", "words", 6), P(11.1, "1:2", 4), K(11.5, "1:2", 9.8, "1:3")];

  window.LIVE_SCENARIOS = {
    fatiha: {
      title: "Récitation nette (Al-Fatiha)", about: "1:2 nommé, 1:3 (deux mots) jamais nommé, puis 1:4 à 1:6 nommés. Un verset sur trois non nommé est normal.",
      speech: [[6, 9.8], [10.4, 12.4], [13.6, 16.6], [17.4, 21.8], [22.6, 26]], stop: 31,
      events: cat(PRE, fatiha12, [
        C(12.9, "1:3", 2, 14, "continue", { exp: "1:3", items: ["1:3", "55:1"] }),
        Z(16.0, "1:3", 2, 10.4, 12.4), J(16.0, "skip", "1:2"),
        C(16.3, "1:4", 2, 3, "start", { items: ["1:4"] }), L(17.9, "1:4", 3, "recognized", "words", 13.6), K(18.4, "1:4", 16.6, "1:5"),
        C(19.9, "1:5", 2, 9, "continue", { exp: "1:5", items: ["1:5", "2:150"] }), L(21.7, "1:5", 3, "recognized", "words", 17.4), P(22.9, "1:5", 4), K(23.1, "1:5", 21.8, "1:6"),
        C(25.1, "1:6", 2, 5, "continue", { exp: "1:6", items: ["1:6", "2:142"] }), L(27.3, "1:6", 3, "recognized", "words", 22.6), K(27.8, "1:6", 26, "1:7")], STOP(31))
    },
    lente: {
      title: "Récitation lente (verrou à 20 s)", about: "Al-Fatiha 1:7, un mot toutes les 2 s. Rien n'est cassé : le système écoute, resserre les candidats et dit sa patience.",
      speech: [[6, 7.6], [8.4, 10.2], [11, 12.8], [13.6, 15.4], [16.2, 18], [18.8, 20.6], [21.4, 23.2], [24, 25.8], [26.6, 28.4]], stop: 35, speed: 2,
      events: cat(PRE, [
        C(9.0, "1:7", 1, 214, "start"), C(11.7, "1:7", 2, 61, "start"), C(14.2, "1:7", 3, 24, "start", { items: ["1:7", "2:213", "2:252", "6:87", "36:61"] }),
        C(17.0, "1:7", 4, 9, "start", { items: ["1:7", "2:213", "2:252"] }), C(19.6, "1:7", 5, 4, "start", { items: ["1:7", "2:213"] }), C(22.0, "1:7", 6, 2, "start", { items: ["1:7", "2:213"] }),
        L(24.6, "1:7", 7, "recognized", "words", 6), P(27.2, "1:7", 8), P(30.0, "1:7", 9), K(30.6, "1:7", 28.4, "2:1")], STOP(35))
    },
    refrain: {
      title: "Refrain identique (déduit de la position)", about: "56:74 existe à l'identique en 56:96 et 69:52 : le texte est entendu, la référence est déduite de la suite de 56:73.",
      seed: [{ kind: "verse", ref: "56:73", status: "recognized", t: [-31, -24], noText: true }],
      speech: [[6, 9.4]], stop: 16, expect: "56:74",
      events: cat(PRE, [
        C(8.6, "56:74", 2, 9, "continue", { exp: "56:74", items: ["56:74", "56:96", "69:52"] }),
        C(9.7, "56:74", 3, 3, "continue", { exp: "56:74", items: ["56:74", "56:96", "69:52"], commonTr: true }),
        L(10.7, "56:74", 4, "inferred", "context", 6), K(11.6, "56:74", 9.4, "56:75")], STOP(16))
    },
    sauts: {
      title: "Parole, saut et reprise", about: "Un verset nommé, de la parole non coranique, un saut vers une autre sourate (67:3), puis une reprise du même verset.",
      speech: [[6, 9.8], [12, 18], [19, 31], [38.6, 49]], stop: 49, speed: 2,
      events: cat(PRE, fatiha12, [
        X(15.6, "non_quran"), J(22.0, "unknown", "1:2"),
        C(22.1, "67:3", 3, 18, "start", { items: ["67:3", "67:4"] }), L(24.5, "67:3", 5, "recognized", "words", 19), P(27.0, "67:3", 10), P(30.5, "67:3", 15), P(32.3, "67:3", 18), K(32.8, "67:3", 31, "67:4"),
        C(41.0, "67:3", 3, 2, "repeat", { items: ["67:3"] }), L(42.4, "67:3", 5, "recognized", "words", 38.6, { rep: true }), P(45.8, "67:3", 11)], STOP(49))
    },
    correction: {
      title: "Correction d'un verset nommé (REVISION)", about: "1:5 est nommé, puis la vérification acoustique le retire : il reste visible, marqué corrigé, jamais effacé en silence.",
      speech: [[6, 10.4], [13.2, 16.2]], stop: 24,
      events: cat(PRE, [
        C(8.5, "1:5", 2, 11, "start", { items: ["1:5", "2:150"] }), L(10.2, "1:5", 3, "recognized", "words", 6), P(11.7, "1:5", 4), K(12.2, "1:5", 10.4, "1:6"),
        C(15.8, "1:6", 2, 5, "continue", { exp: "1:6", items: ["1:6", "2:142"] }), L(17.5, "1:6", 3, "recognized", "words", 13.2),
        { at: 18.4, type: "REVISION", ref: "1:5", status: "uncertain", reason: "acoustic_check" }, K(18.9, "1:6", 16.2, "1:7")], STOP(24))
    },
    coupure: {
      title: "Connexion coupée puis reprise", about: "La connexion tombe à 5 s du flux : le micro continue, le son est gardé, puis renvoyé. Aucun mot perdu, les résultats rattrapent leur retard.",
      speech: [[6, 10.4], [11.6, 14.6]], stop: 22,
      events: cat(PRE, [
        C(8.5, "1:5", 2, 11, "start", { items: ["1:5", "2:150"] }), { at: 9.2, type: "NET", state: "lost" }, { at: 16.0, type: "NET", state: "back", catchup: 3.4 },
        L(17.0, "1:5", 3, "recognized", "words", 6), P(17.4, "1:5", 4), K(17.9, "1:5", 10.4, "1:6"),
        C(18.2, "1:6", 3, 5, "continue", { exp: "1:6", items: ["1:6"] }), L(18.9, "1:6", 3, "recognized", "words", 11.6), K(19.4, "1:6", 14.6, "1:7")], STOP(22))
    },
    expiree: {
      title: "Coupure trop longue (session expirée)", about: "La connexion ne revient pas à temps : le serveur ferme la session. Ce qui a été entendu avant reste, l'enregistrement local peut être gardé.",
      speech: [[6, 9.8], [20, 30]], stop: null, speed: 4,
      events: cat(PRE, fatiha12, [{ at: 14.0, type: "NET", state: "lost" }, { at: 44.0, type: "ERR", code: "expired" }, { at: 44.0, type: "PHASE", phase: "ended" }])
    },
    surcharge: {
      title: "Mode allégé puis surcharge", about: "Le serveur est occupé : la vérification acoustique est sautée puis le retard grandit. Le verrou se durcit, c'est dit en clair, et un verset court n'est plus nommé.",
      speech: [[6, 10.4], [11.2, 14.2], [15, 22]], stop: 29,
      events: cat(PRE, [
        C(8.5, "1:5", 2, 11, "start", { items: ["1:5", "2:150"] }), L(10.2, "1:5", 3, "recognized", "words", 6), P(11.7, "1:5", 4), K(12.2, "1:5", 10.4, "1:6"),
        { at: 12.6, type: "DEG", tiers: [2], lag: 1.4 },
        C(14.3, "1:6", 2, 5, "continue", { exp: "1:6", items: ["1:6", "2:142"] }), C(15.2, "1:6", 3, 2, "continue", { exp: "1:6", items: ["1:6", "2:142"] }),
        Z(16.4, "1:6", 3, 11.2, 14.2),
        C(17.5, "1:7", 2, 64, "start"), C(18.6, "1:7", 3, 20, "start"), { at: 20.0, type: "DEG", tiers: [2, "overload"], lag: 5.3 },
        C(19.8, "1:7", 4, 8, "start", { items: ["1:7", "2:213"] }), L(23.1, "1:7", 6, "recognized", "words", 15), P(24.6, "1:7", 9), K(25.3, "1:7", 22, "2:1"),
        { at: 27.0, type: "DEG", tiers: [], lag: 0.2 }], STOP(29))
    }
  };

  /* Erreurs : ce qui ne marche pas · pourquoi · impact · quoi faire (règle « une erreur s'explique »). */
  window.LIVE_ERRORS = {
    denied: { icon: "mic-off", title: "Le micro est bloqué pour ce site", cause: "Tu as refusé l’accès au micro, ou le navigateur s’en souvient d’une fois précédente.", impact: "Rien n’est écouté et rien n’est envoyé.", todo: "Clique sur le cadenas à gauche de l’adresse, autorise le micro, puis réessaie.", btn: "Réessayer" },
    insecure: { icon: "lock", title: "Le micro est interdit sur cette page", cause: "Les navigateurs n’ouvrent le micro que sur une page sécurisée (adresse en https, ou localhost). Cette page est ouverte en http sur le réseau.", impact: "L’écoute en direct ne peut pas démarrer ici ; l’enregistrement classique non plus.", todo: "Ouvre l’atelier par son adresse https (lien de test) ou depuis l’ordinateur qui l’héberge.", btn: null },
    nomic: { icon: "mic-off", title: "Aucun micro trouvé", cause: "Le navigateur ne voit aucune entrée audio (micro débranché, casque coupé).", impact: "Rien n’est écouté.", todo: "Branche ou active un micro, puis réessaie.", btn: "Réessayer" },
    busy: { icon: "mic-off", title: "Le micro est déjà utilisé", cause: "Une autre application ou un autre onglet a pris le micro.", impact: "L’écoute n’a pas démarré.", todo: "Ferme l’autre application (appel, enregistreur), puis réessaie.", btn: "Réessayer" },
    server_busy: { icon: "link-off", title: "Le service d’écoute est complet", cause: "Trop de personnes écoutent en même temps : le serveur a une limite de flux simultanés.", impact: "Ton écoute n’a pas démarré ; le micro est resté fermé et rien n’a été envoyé.", todo: "Nouvel essai automatique dans 12 s. Tu peux aussi enregistrer ta récitation et l’analyser ensuite.", btn: "Réessayer maintenant", server: "Le service est complet pour le moment. Réessaie dans quelques secondes." },
    expired: { icon: "link-off", title: "L’écoute a été coupée trop longtemps", cause: "La connexion est restée perdue plus longtemps que le délai de reprise : le serveur a fermé la session.", impact: "Ce qui a été entendu avant la coupure est conservé ci-dessous. Le son depuis la coupure n’a pas été analysé.", todo: "Garde l’enregistrement pour l’analyser en entier, ou recommence une écoute.", btn: null },
    unsupported: { icon: "alert", title: "Ce navigateur ne sait pas écouter en direct", cause: "Il lui manque la capture audio continue ou la connexion WebSocket.", impact: "L’écoute en direct n’est pas disponible ; l’import d’un fichier fonctionne.", todo: "Essaie une version récente de Chrome, Edge, Firefox ou Safari, ou utilise « Nouvel essai ».", btn: null },
    internal: { icon: "alert", title: "Le service d’écoute a rencontré un problème", cause: "Une erreur interne du serveur a interrompu l’analyse.", impact: "Ce qui avait été entendu avant l’erreur est conservé ci-dessous.", todo: "Réessaie dans un instant ; garde l’enregistrement si tu veux l’analyser en entier.", btn: "Réessayer" }
  };
})();
