# Import d'un résultat — champs libres, fichiers illisibles, refus journalisés (N6, N7, N10)
> Surfaces : [API] `POST /api/sessions` (champ `result`) · [BE] moteur `aqr verify-recognition` · [LOG] journal serveur
> Statut : voir « Preuves » · Build : branche `fix/import-champs-libres-qa2` sur `origin/develop` @ a5b8346
> Périmètre : N6 (riwaya, noms de moteur, notice, libellé de zone, avertissements), N7 (JSON très imbriqué, BOM, UTF-16, cause d'une
> traduction invérifiable), N10 (refus journalisés). Suite de `export-recette-qa.md` (M2) et de l'ADR-0024.
> Environnement : atelier construit dans un worktree jetable (`harness/h.mjs build`), base jetable, comptes d'essai, sinus ffmpeg
> comme audio (jamais d'audio de personne), textes et traductions lus dans le corpus et le cache QuranEnc local. Scripts rejouables du
> QA : `qa/r17-import.mjs` (72 cas), `qa/r18-free-fields.mjs`, `qa/r19-offline-import.mjs`.
> Pas de surface visible nouvelle (aucun écran touché) : le parcours navigateur est celui de `qa/r18` (en-tête de la session).

## Must-pass

### I.1 — [API] Un vrai résultat du moteur n'est jamais refusé
**Priorité** : critique · **Technique** : non-régression
**Action** : importer (a) les 23 résultats légitimes de `r17` (dont riwaya Hafs supposée, avertissements, basmala, isti'adha, takbir, amin,
french, silence, abstention), (b) un résultat dont les champs libres sont les valeurs EXACTES du moteur (notice `RIWAYA_NOTICE`, nom de
moteur en cascade, `SILERO_WARNING`).
**Attendu** : `201` pour chacun. **Preuve** : `r17`, `tests/unit/test_verify_recognition.py` (constantes réelles, `build_json` pour
chaque catégorie, résultats réels de `docs/evaluation/`).

### I.2 — [API] Un avertissement qui cite de l'arabe (chemin, message d'un système en arabe) est accepté, jamais montré
**Priorité** : important · **Technique** : partition-équivalence
**Action** : `warnings: ["poids absents de C:\\Users\\<nom arabe>\\models"]`, puis ouvrir la session.
**Attendu** : `201` ; l'arabe n'apparaît ni dans l'en-tête ni dans le panneau de détails (« [texte arabe masqué] »).
**Preuve** : `r18`, `web/lib/recognition.test.ts`.

### I.3 — [API] Fichier avec BOM UTF-8 : accepté
**Priorité** : important · **Technique** : valeur-limite
**Action** : envoyer un résultat légitime précédé de `EF BB BF`.
**Attendu** : `201` ; le fichier conservé est le même sans les trois octets ; `prediction_sha256` est celle du fichier conservé.
**Preuve** : `web/lib/import-session-verify.test.ts`, `web/lib/import-session-corpus.test.ts`, `r17` (cas BOM).

## Must-fail

### I.4 — [API] N6 : un faux verset dans un champ libre est refusé
**Priorité** : critique · **Technique** : injection
**Action** : un résultat légitime avec, tour à tour, `riwaya.assumed`, `riwaya.notice`, chacun de `engine.asr|segmenter|matcher|decoder|corpus|
acoustic`, le `label` d'une zone non coranique = du faux arabe ; puis `riwaya.assumed` = « Qul huwa », vide, `HAFS`, un nombre ; un nom de
moteur de 301 signes ou contenant un caractère de retournement du sens d'écriture ; 201 avertissements ; un avertissement de 2 001 signes.
**Attendu** : `422 result_contradicts_corpus`, rien n'est conservé, le message nomme le champ en français et ne recopie AUCUN signe arabe.
**Preuve** : `r18` (le cas du rapport : `Riwaya … supposée` avec du faux arabe), `tests/unit/test_verify_recognition.py`.

### I.5 — [API] N7 : un JSON de 20 000 niveaux est un refus clair
**Priorité** : critique · **Technique** : valeur extrême
**Action** : un résultat légitime avec un champ en trop imbriqué sur 20 000 niveaux (`r17`, cas « imbriqué »).
**Attendu** : `422 result_too_deep` (« trop imbriqué »), JAMAIS `503 result_check_unavailable` « corpus ou moteur introuvable ».
**Preuve** : `r17`, `web/lib/prediction-bytes.test.ts`, `tests/unit/test_verify_recognition.py` (CLI).

### I.6 — [API] N7 : UTF-16 refusé avec la marche à suivre
**Priorité** : important · **Technique** : partition-équivalence
**Action** : résultat enregistré en UTF-16 (BOM `FF FE`).
**Attendu** : `400 result_encoding`, message « enregistre-le en UTF-8 (sans BOM) », rien conservé.
**Preuve** : `web/lib/prediction-bytes.test.ts`, `import-session-verify.test.ts`.

### I.7 — [API] N7 : la cause d'une traduction invérifiable est la vraie
**Priorité** : important · **Technique** : transition-état
**Action** : (a) hors ligne, cache vide, proxy mort (`r19`) ; (b) copie locale illisible (somme de contrôle fausse) ; (c) sans source.
**Attendu** : `503 result_unverifiable` ; le message dit « QuranEnc n'est pas joignable » SEULEMENT pour (a), « copie locale illisible »
pour (b), « aucune source » pour (c). **Preuve** : `r19`, `tests/unit/test_verify_recognition.py` (cause), `result-check.test.ts`.

### I.9 — [WEB] N6 à la lecture : un résultat déjà conservé avec du faux arabe ne le montre pas
**Priorité** : important · **Technique** : état obsolète
**Action** : importer un résultat légitime, réécrire le fichier conservé sur le disque du serveur de banc (faux arabe dans `riwaya`, `engine.segmenter`, `warnings`, balise `<img onerror>`), ouvrir la session à 390 px, ouvrir le panneau de détails.
**Attendu** : la session reste lisible ; aucun faux arabe, pas de bandeau de riwaya, « [texte arabe masqué] » dans les détails ; `window.__pwned` jamais posé.
**Preuve** : `qa/n6-readtime.mjs` (`faux arabe visible : false`, `masque présent : true`, `__pwned : null`), `web/lib/recognition.test.ts`.

### I.8 — [LOG] N10 : chaque refus laisse une trace, jamais le faux texte
**Priorité** : important · **Technique** : observabilité
**Action** : rejouer I.4 à I.7, lire `<AQR_REVIEW_DIR>/logs` (flux `app`).
**Attendu** : une ligne `import.result_refused` par refus avec `code`, `http`, `owner`, `verdict`, `rank`, `ref`, `field` (et `cause` ou
`reason` pour un 503) ; niveau `error` pour `result_check_unavailable`, `warn` sinon ; AUCUN signe arabe dans le journal.
**Preuve** : `import-session-verify.test.ts` (« les refus sont journalisés »), lecture du journal du serveur de banc.

## Preuves (2026-11-04, build de la branche, serveur de banc jetable sur le port 3641, 3642 hors ligne)
- `qa/r17-import.mjs` rejoué : **75 / 75 conformes**, 0 message qui recopie du faux arabe ; F37 (20 000 niveaux) = `422 result_too_deep` (au lieu du `503`) ; F39 (BOM UTF-8) = `201` ; G1 (riwaya = faux verset) et G3 (`engine.asr`) = `422` ; G2 (avertissements avec arabe et balise) = `201`, jamais montré.
- `qa/r19-offline-import.mjs` rejoué (cache vide, proxy mort) : 503 `result_unverifiable` en 2,7 s dont le message dit « QuranEnc n'est pas joignable » (cause `offline`) ; 201 sans traduction ; 422 pour le faux arabe.
- `qa/n6-readtime.mjs` (Chrome, 390 px) : voir I.9.
- Journal : 55 lignes `import.result_refused` sur les deux serveurs (29 + 3 `result_contradicts_corpus`, 20 `invalid`, 1 `result_too_deep`, 2 `result_unverifiable` avec `cause: offline`), **0 signe arabe**.
- Limite : le `503 result_check_unavailable` n'a pas été provoqué sur le banc (moteur absent) ; couvert par `import-session-verify.test.ts` (niveau `error`).
