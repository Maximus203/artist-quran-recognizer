# Export des sous-titres, API : contrôle, décisions, export forcé, droits, orphelines
> Surfaces : [API] · Statut : ✅ · Build : feat/export-atelier-api @09b3ce4 · Testé : 2026-10-23
> Périmètre : `GET …/export/readiness`, `POST …/export/subtitles`, `GET`/`PUT …/decisions`, `GET /api/corpus/verse`, `POST …/validation from_decisions`.
> Environnement : `next start` (build de production) sur 127.0.0.1, dossier de données de TEST (audio et prédiction réels copiés en lecture seule, jamais les données du mainteneur), un cookie par compte.
> Données : aucun compte pré-créé : Chef Test (premier inscrit = administrateur), Amina Test (propriétaire), Bilal Test (testeur) sont créés par l'API d'inscription ; l'audio par l'API d'import, la prédiction réelle de la session source est posée sur la session d'Amina.
> Critère d'arrêt : tous les scénarios critiques ✅, tous les refus (must-fail) bloqués, aucune ligne d'erreur dans le journal du serveur (observé : 0).
> Rejouer : `cd web && npm run build && AQR_PYTHON=<python du dépôt> node e2e/export-api.mjs --source <dossier sessions> --id <id> --write`.

## Préconditions
- [API] Build de production présent, Node ≥ 24, corpus et cache de traduction du moteur disponibles.

## Scénarios

### E.0 — [API] Une analyse qui n'est pas terminée n'a rien à contrôler : 409 not_ready
**Priorité** : important
**Technique** : transition d'état
**Action** : Amina importe un audio sans lancer l'analyse puis appelle `GET …/export/readiness`.
**Attendu** : `409`, `code: not_ready`.
**Observé** : 409 not_ready
**Verdict** : ✅
**Issue** : —

### E.1 — [API] Le contrôle compte les passages ambigus de la partie coranique, une page à la fois
**Priorité** : critique
**Technique** : partition d'équivalence
**Action** : Amina appelle `GET …/export/readiness?size=10` sur une session réelle (incertains, coupures, traductions approximatives).
**Attendu** : `200` ; `verdict.total` = le nombre de passages ; au plus 10 passages ; réponse < 100 Ko ; abstentions et formules comptées à part, dans aucune liste.
**Observé** : 11 passages (uncertain 2, approx 7, cut 2) ; page de 10 ; 11802 octets ; non coranique 6 + 0
**Verdict** : ✅
**Issue** : —

### E.2 — [API] Changer ce qu'on exporte recompte (arabe seul, référence affichée)
**Priorité** : critique
**Technique** : table-décision
**Action** : Même contrôle avec `content=ar`, puis `content=fr`, puis `ref=1`.
**Attendu** : `content=ar` ne compte pas les traductions approximatives ; `content=fr` ne compte pas les coupures de l'arabe seul ni les signes de pause ; `ref=1` ne compte jamais moins.
**Observé** : ar_fr 11 · ar 4 · ref 11
**Verdict** : ✅
**Issue** : —

### E.3 — [API] Sans correction l'export est refusé (409 unresolved_items) ; forcé, il omet et le dit
**Priorité** : critique
**Technique** : erreur + frontière
**Action** : Amina exporte en SRT sans forcer ; puis avec `allow_unresolved: true` ; puis un nom de fichier piégé `../../x`.
**Attendu** : `409 unresolved_items` avec le nombre exact de passages ; forcé : `200`, `summary.forced: true`, `unresolved: n`, `policy: omit`, aucun verset incertain nommé ; nom de fichier sans `/` ni `..`.
**Observé** : 409 (11) ; forcé : 201 sous-titres, 2 omis, nom « x.ar-fr.srt »
**Verdict** : ✅
**Issue** : —

### E.4 — [API] Le texte arabe du fichier est celui du corpus, mot pour mot (I1) ; la traduction est celle de QuranEnc (I2)
**Priorité** : critique
**Technique** : comparaison à la source
**Action** : Export forcé en ASS (arabe + traduction) ; le texte de chaque verset reconnu est comparé au texte du JSON du moteur (lu dans le corpus).
**Attendu** : Chaque mot arabe écrit dans l'ASS existe dans le texte du verset correspondant ; l'attribution Tanzil et QuranEnc est dans l'en-tête.
**Observé** : 201 lignes arabes, 0 mot hors corpus ; attribution présente
**Verdict** : ✅
**Issue** : —

### E.5 — [API] Une décision résout le passage sans toucher à la prédiction
**Priorité** : critique
**Technique** : transition d'état
**Action** : Amina choisit un candidat du premier passage incertain (`PUT …/decisions`, `decide`).
**Attendu** : `200`, la décision est `applied` ; `decisions.json` porte l'empreinte, l'auteur « Amina Test » et `use_for_training: true` ; `verdict.unresolved` baisse de 1 ; `prediction.recognition.json` identique (sha256).
**Observé** : appliquée (1:1) ; non résolus 11 → 10 ; prédiction inchangée
**Verdict** : ✅
**Issue** : —

### E.6 — [API] Annuler toutes les décisions redonne l'export d'une session sans décision, octet pour octet
**Priorité** : critique
**Technique** : idempotence
**Action** : Export JSON forcé sans décision (référence), puis après la décision de E.5 annulée.
**Attendu** : Les deux contenus sont identiques ; la décision annulée reste dans `decisions.json` (`withdrawn_at`).
**Observé** : export annulé == export sans décision ; export avec décision différent ; décision gardée avec withdrawn_at (relue avant suppression du fichier)
**Verdict** : ✅
**Issue** : —

### E.7 — [API] Tout résoudre ouvre l'export sans forcer, avec le texte du corpus
**Priorité** : critique
**Technique** : parcours nominal
**Action** : Pour chaque passage du contrôle, Amina décide (candidat, confirmer, exclure ou ignorer selon la sorte) ; puis exporte en SRT sans forcer.
**Attendu** : `verdict.ready: true`, `200` sans forcer, `summary.forced: false`.
**Observé** : prêt (11 sur 11 résolus) ; export de 204 sous-titres, forced false
**Verdict** : ✅
**Issue** : —

### E.8 — [API] Droits : seul le propriétaire (ou un administrateur) écrit ; tout lecteur lit et exporte
**Priorité** : critique
**Technique** : table-décision
**Action** : Bilal (testeur, session globale d'Amina) : `GET readiness`, export forcé, `GET decisions`, puis `PUT decisions` (décider, consentir). Chef (administrateur) : décider puis consentir.
**Attendu** : Bilal : lecture et export `200`, écriture `403`. Chef : `decide` `200` mais `use_for_training: false` et le consentement d'Amina intact ; `consent` `403`.
**Observé** : Bilal : 200/200/200, écriture 403 ; Chef : decide 200 (use_for_training false), consentement d'Amina intact, consent 403
**Verdict** : ✅
**Issue** : —

### E.9 — [API] Un audio privé répond 404 identique sur les nouvelles routes, administrateur compris
**Priorité** : critique
**Technique** : table-décision
**Action** : Amina passe la session en privé ; Bilal et Chef appellent readiness, decisions (GET, PUT) et export ; puis une session inexistante.
**Attendu** : Toujours `404` « Session introuvable » (jamais 403 ni « privée »), même message que pour un identifiant inconnu.
**Observé** : 8 appels → 404 « Session introuvable »
**Verdict** : ✅
**Issue** : —

### E.10 — [API] Entrées hostiles : options, décisions et verset refusés proprement
**Priorité** : important
**Technique** : valeurs-limites + injection
**Action** : Options inconnues ou hors bornes, décision avec un genre inconnu / un passage inexistant / une référence 0:1, `corpus/verse` avec `115:1`, `2:300`, `../x`.
**Attendu** : `400` avec un message lisible (jamais un chemin ni une trace) ; `404` pour un verset inexistant.
**Observé** : 6 entrées refusées en 400 ; versets inexistants en 404
**Verdict** : ✅
**Issue** : —

### E.11 — [API] Un verset est lu dans le corpus, mot par mot
**Priorité** : important
**Technique** : partition d'équivalence
**Action** : `GET /api/corpus/verse?ref=11:61&words=1-10`, sans compte puis avec.
**Attendu** : Sans compte `401` ; avec : `200`, 10 mots, `words_total` du verset.
**Observé** : 401 sans compte ; 200 : 10 mots sur 27
**Verdict** : ✅
**Issue** : —

### E.12 — [API] Nouvelle analyse : une décision dont le passage a changé devient orpheline, jamais appliquée en silence
**Priorité** : critique
**Technique** : transition d'état
**Action** : Amina décide sur un passage ; la prédiction est remplacée par une analyse où ce passage a bougé de 0,3 s ; `GET decisions` ; `GET readiness` ; puis `reattach` vers le passage suggéré.
**Attendu** : La décision passe `orphan` avec une suggestion ; le passage est de nouveau à vérifier ; après `reattach`, il est résolu et l'ancienne décision reste `superseded`.
**Observé** : orpheline + suggestion ; passage rouvert ; rattachée → résolu, ancienne conservée (superseded)
**Verdict** : ✅
**Issue** : —

### E.13 — [API] Vérité terrain : seules les corrections écoutées, consenties et appliquées sont proposées, par un administrateur
**Priorité** : critique
**Technique** : table-décision
**Action** : Amina retire le consentement d'une décision écoutée ; Amina puis Chef appellent `POST …/validation {action: from_decisions}` ; Chef rappelle.
**Attendu** : Amina : `403` (réservé aux administrateurs). Chef : `200`, passages `proposed` avec `source: export-review` pour les décisions écoutées et consenties seulement ; deuxième appel : même nombre de passages (idempotent).
**Observé** : 1 proposition(s) `proposed`, rappel idempotent ; accord retiré → plus rien d'ajouté (décision f04e4fa3)
**Verdict** : ✅
**Issue** : —
