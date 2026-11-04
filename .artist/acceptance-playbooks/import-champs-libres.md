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

### I.10 — [API] P5/P6 : ce qui est légitime et inhabituel passe
**Priorité** : critique · **Technique** : partition-équivalence, non-régression
**Action** : importer (a) un résultat réel du moteur avec `acoustic_checks` de toutes natures (`chain`, `continuation`, `neighbor`,
`head`, `relisten`, `gap` et ses rôles) et `cascade` ; (b) `source.file` = « سورة الإخلاص.mp3 » ; (c) un champ inconnu fait de lettres
latines et de chiffres (document, intervalle) ; (d) `engine.acoustic` = `null`, `""` ou absent.
**Attendu** : `201` pour chacun ; (b) la session s'ouvre, `GET /api/sessions/:id` rend `source.file` masqué (« [texte arabe masqué].mp3 »).
**Preuve** : `tests/unit/test_verify_recognition.py` (`real_engine_document`, 1 594 résultats réels relus hors test), `web/lib/recognition.test.ts`.

## Must-fail

### I.11 — [API] P5 : du faux arabe dans un champ que personne ne lit est refusé
**Priorité** : critique · **Technique** : injection
**Action** : un résultat légitime avec du faux arabe, tour à tour, dans une valeur de `acoustic_checks` (kind, verses, role, clé, imbriqué),
dans `cascade`, dans une clé de `decoder`, une valeur de `timing`, `windows`, `source.note`, `engine.constrained`, `riwaya.verified`, un
champ en trop d'un intervalle (`promoted_by`, `word_times_source`, `note`), d'une zone non coranique, d'une abstention, d'une traduction,
d'un segment, du fragment, un champ inconnu du document ; un libellé « [isti'adha] » suivi de faux arabe ; `source.file` de 256 signes
ou avec un caractère de contrôle ; `acoustic_checks` qui n'est pas une liste de relevés ; `cascade` qui n'est pas un objet.
**Attendu** : `422 result_contradicts_corpus`, rien n'est conservé, le message nomme la partie (`acoustic_checks`, `cascade`,
`source.file`, `extra_field`, `translation.extra`, `label`) sans recopier aucun signe arabe.
**Preuve** : `tests/unit/test_verify_recognition.py` (cas paramétrés), scripts QA `t03`, `t06` rejoués.

### I.12 — [API] P6 : chaque refus dit sa vraie raison
**Priorité** : important · **Technique** : partition-équivalence
**Action** : `riwaya` sans `notice` ; `notice` = 5 ; `notice` de 1 001 signes ; `notice` arabe ; `notice` avec un caractère de contrôle ;
`engine.asr` = `null` ; `engine.matcher` arabe ; un champ obligatoire absent (`engine.asr`) ; un intervalle au champ `t` mal formé ; un
fichier qui n'est pas du JSON.
**Attendu** : des phrases DIFFÉRENTES — « valeur absente ou nulle », « un texte est attendu », « texte trop long (au plus 1 000 signes) »,
« écriture arabe », « caractère de contrôle » ; un contrat refusé nomme `engine.asr` ou « intervalle 2, champ « t » » ; un fichier
illisible est dit « pas du JSON lisible », jamais « pas un résultat aqr.recognition/1 valide ». Un nom d'utilisateur (arabe) n'est
jamais recopié (« … »).
**Preuve** : `tests/unit/test_verify_recognition.py` (messages), `web/lib/import-session-verify.test.ts` (P6).

### I.13 — [API] P6 : UTF-16 et UTF-32 sans BOM reçoivent la marche à suivre
**Priorité** : important · **Technique** : valeur-limite
**Action** : résultat enregistré en UTF-16 petit-boutiste, gros-boutiste, avec espace ou saut de ligne devant, puis en UTF-32, SANS BOM.
**Attendu** : `400 result_encoding`, « enregistre-le en UTF-8 … `Out-File -Encoding utf8` … Bloc-notes », jamais « JSON invalide » ; un JSON
UTF-8 (arabe, accentué, vide, `[]`) n'est jamais pris pour du UTF-16. **Preuve** : `web/lib/prediction-bytes.test.ts`,
`import-session-verify.test.ts`.

### I.14 — [API] P5 : ce qui est déjà conservé ne ressort pas par l'API de la session
**Priorité** : important · **Technique** : état obsolète
**Action** : réécrire sur le disque du serveur de banc le fichier conservé d'une session (faux arabe dans `source.file`, `acoustic_checks`,
`cascade`, une clé de `decoder`), puis `GET /api/sessions/:id`.
**Attendu** : la réponse ne contient aucun signe du faux arabe (`source.file` masqué, `decoder` sans la clé) ; la session reste lisible.
Limite assumée : `GET /api/sessions/:id/export` cite le fichier à l'octet près (son empreinte en dépend).
**Preuve** : `web/lib/store.test.ts`, `qa/t06-api-leak.mjs`.

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
