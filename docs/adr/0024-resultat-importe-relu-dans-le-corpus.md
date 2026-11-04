# ADR-0024 — Un résultat importé est relu dans le corpus avant d'être conservé

- Statut : **accepté** — correctif M2 du rapport QA de l'éditeur d'export (2026-11-04). Applique les invariants I1 (le texte
  arabe vient TOUJOURS du corpus), I2 (traduction QuranEnc sans modification) et I3 (nommer un faux verset est pire que n'en
  nommer aucun). Ne modifie ni l'ADR-0001 (aucun LLM génératif) ni l'ADR-0014 (décisions humaines sur une prédiction immuable).

## Contexte

`POST /api/sessions` accepte, avec l'audio, un résultat `aqr.recognition/1` (champ `result`, aussi utilisé par l'atelier pour
rouvrir un travail). Le moteur écrit lui-même le texte arabe de chaque intervalle, lu dans le corpus, et la traduction QuranEnc
avec son identifiant, sa version et son attribution. Un fichier qui arrive de l'extérieur n'a pas cette garantie : le serveur ne
vérifiait que la forme (zod) et l'empreinte de l'audio. Un `text` inventé pour `112:1`, ou une traduction retouchée, était donc
conservé, affiché dans l'éditeur, puis gravé dans la vidéo exportée comme du Coran (QA, scénario s32 : `201`, texte relu tel quel).
L'éditeur, lui, ne permet jamais de modifier l'arabe : la faille est uniquement dans la porte d'entrée.

## Décision

1. **On ne fait confiance à aucun texte reçu.** À l'import, chaque intervalle est relu dans le corpus (arabe) et dans QuranEnc
   (traduction) par `aqr verify-recognition`, lancé comme `export-readiness` : le serveur web n'a pas le corpus, et deux
   contrôles (Python et TypeScript) finiraient par diverger. Le contrôle est `aqr.rendering.verify_recognition` (fonction pure sur
   les ports `CorpusRepository` et `TranslationRepository`), le même code de lecture que le moteur (`HomeRenderer.passage_text`).
2. **Refuser plutôt que remplacer.** Un résultat contredit est refusé en entier (`422 result_contradicts_corpus`, message en
   français : rang de l'intervalle, verset, nature de l'écart ; le faux texte n'est jamais recopié), rien n'est conservé. On ne
   corrige pas en silence : un fichier qui ment sur un verset ment peut-être aussi sur son découpage, et réécrire le fichier changerait
   son empreinte (`prediction_sha256`, empreinte des décisions). Le fichier conservé est celui reçu, à l'octet près.
3. **Ce qui est contrôlé.** Référence de verset existante ; plage de mots dans le verset ; candidats existants ; texte arabe
   égal à celui des mots déclarés (verset entier ou plage) ; basmala égale au verset 1:1 ; libellé arabe d'une formule égal à
   la constante du moteur (`FORMULA_LABELS_AR`), interdit ailleurs ; zone non coranique sans texte ni traduction ; traduction :
   identifiant QuranEnc connu, texte, version et attribution identiques à la source, segments et fragment réellement extraits
   du texte officiel. Un texte ou une traduction absents ne sont pas une falsification (copie expurgée) : seul ce qui est présent
   est contrôlé.
4. **Un contrôle qui n'a pas eu lieu n'est jamais un « oui ».** QuranEnc injoignable, cache corrompu ou moteur absent :
   `503` (`result_unverifiable`, `result_check_unavailable`), rien n'est conservé ; on peut réessayer ou envoyer le résultat sans
   traduction. Le premier échec réseau coupe les suivants (un délai, pas un délai par passage).
5. **Obligatoire, pas facultatif.** `ImportDeps.verifyResult` est une dépendance requise (un oubli est une erreur de
   compilation) ; le contrôle précède l'inscription du propriétaire et la sonde du média, et suit les refus peu coûteux (JSON
   invalide, empreinte de l'audio).

## Autres entrées examinées

- **Décisions humaines et revue** (`PUT …/decisions`, `…/review`) : elles ne portent ni texte arabe ni traduction (référence,
  plage de mots, temps, motif, portée). L'export relit le corpus par `VerseRef`. Pas de faille de ce type.
- **Résultat d'un moteur distant** (`PUT /api/engine/leases/<bail>/result`) et **résultat du moteur local** : même format, mais
  écrits par un agent authentifié et provisionné par l'administrateur, ou par le processus du serveur lui-même. Non contrôlés
  par cette décision (contrat de sortie et empreinte de l'audio seulement) ; à examiner si un jour des agents tiers sont admis.

## Conséquences

- Un import avec résultat lance un processus Python (deux au plus à la fois) et, la première fois qu'une sourate est vue, peut
  télécharger sa traduction (cache `AQR_CACHE_DIR`). L'atelier de production a déjà ce cache.
- Un résultat d'un autre corpus (autre version, autre recension) est refusé même s'il est honnête : le texte affiché est celui
  du corpus de ce serveur (I1).
- Les sessions de test qui importaient une traduction de fixture sous un identifiant QuranEnc réel (rapport QA) doivent
  désormais utiliser la vraie traduction, ou aucune.
- Validé sur 17 602 intervalles rendus par le vrai moteur de rendu (tous les versets, entiers et plages partielles, 5 074
  fragments de traduction, cache QuranEnc réel) : 0 constat, 0 traduction invérifiable.

## Addendum 2026-11-04 — champs libres, fichiers illisibles, journal (seconde recette QA : N6, N7, N10)

La seconde recette a rejoué 72 cas : 23 résultats légitimes sur 23 acceptés, 48 falsifications sur 49 refusées (la 49e, des clés
JSON dupliquées où le dernier gagne, montre le vrai texte). Elle a trouvé trois restes, corrigés ici sans changer la décision.

**N6 — les champs libres que l'interface affiche aussi.** Le contrôle relisait `text`, `translation` et `label_ar`, pas
`riwaya`, `engine.*`, `warnings` ni le libellé `label` d'une zone non coranique : un faux verset glissé dans `riwaya.assumed`
s'affichait dans l'en-tête de la session (« Riwaya … supposée · non vérifiée »). Deux étages, parce que les deux se complètent :
1. **À l'import, refus** (`verify_recognition`, même rapport, même `422 result_contradicts_corpus`). Liste blanche ou forme
   bornée, jamais d'écriture arabe : `riwaya.assumed` ∈ {`hafs`, `warsh`} (`Riwaya`) ; `riwaya.notice` ≤ 1 000 signes ;
   `engine.asr|segmenter|matcher|decoder|corpus|acoustic` ≤ 300 signes, une ligne ; ni caractère de contrôle ni de mise en forme
   (retournement du sens d'écriture, largeur nulle) ; `label` d'une zone non coranique = une catégorie `NonQuranKind` (même
   simplification que `formulaFromLabel` côté web : `[isti'adha]` passe) ; `warnings` = liste d'au plus 200 textes de 2 000 signes.
2. **À la lecture, neutralisation** (`web/lib/recognition.ts`, qui ne rend jamais un résultat illisible) : pour un résultat déjà
   conservé avant ce correctif ou venu d'un moteur distant (non contrôlé par cette décision), l'arabe de ces champs est masqué
   (« [texte arabe masqué] »), les caractères de contrôle retirés, la taille bornée, et une riwaya inconnue n'est pas montrée.
Choix : **les avertissements ne sont pas refusés pour leur arabe**, seulement bornés, puis masqués à la lecture. Ce sont des
phrases du moteur qui citent des chemins ou le message d'une exception ; un système en arabe (dossier utilisateur, message d'erreur
localisé) en produit légitimement, et la règle est qu'un vrai résultat du moteur n'est jamais refusé. Les noms de moteur, la
riwaya et les libellés, eux, ne contiennent jamais d'arabe : refus. Non-régression : valeurs exactes des constantes du moteur
(`RIWAYA_NOTICE`, `SILERO_WARNING`, cascade…), la sortie réelle de `build_json` pour chaque catégorie de zone non coranique et les
résultats réels expurgés de `docs/evaluation/` passent sans constat. Limite : une translittération latine d'un verset (« Qul huwa
Allahu ahad ») passerait par un champ libre ; ce n'est pas le texte arabe du Mushaf (I1) et l'interface l'affiche sous
l'étiquette du champ.

**N7 — ce que l'analyseur ne sait pas lire n'est pas une panne.**
- **JSON très imbriqué** (20 000 niveaux, scénario QA) : le plantage de la pile de Python était lu comme « contrôle indisponible »
  (503, « corpus ou moteur introuvable »), faux. L'import mesure maintenant la profondeur sur les octets avant tout autre travail
  (sans récursion, textes et échappements ignorés) et refuse au-delà de 32 niveaux (un vrai résultat en a une dizaine) :
  `422 result_too_deep`. `aqr verify-recognition` attrape aussi `RecursionError` et le dit en une ligne (code 1).
- **BOM UTF-8** (outils Windows) : **accepté, retiré**. Hypothèse tranchée : refuser un fichier légitime pour trois octets ne
  protège de rien, et ce retrait est sans perte et déterministe. Il a lieu une seule fois, à l'entrée, avant le contrôle, la
  lecture et l'empreinte : zod, le contrôle Python et l'export lisent donc tous le même fichier, et `prediction_sha256` est celle du
  fichier conservé. C'est l'unique écart à « le fichier conservé est celui reçu à l'octet près » (§ Décision 2), qui visait la
  correction d'un contenu, pas un octet de codage. **UTF-16** (`>` de PowerShell 5) : refusé, `400 result_encoding`, avec la marche
  à suivre (« enregistre-le en UTF-8 ») ; le convertir serait réécrire le fichier.
- **Cause d'une traduction invérifiable** : le message disait toujours « QuranEnc n'est pas joignable ». Le rapport porte
  maintenant `cause` (`offline`, `local_copy`, `no_source`) et le message nomme la vraie ; une cause inconnue (autre moteur) donne
  une phrase générique, jamais une fausse précision.

**N10 — les refus d'import sont journalisés.** Un `503 result_check_unavailable` passait inaperçu sans plainte d'un utilisateur.
Chaque refus d'un résultat joint (JSON illisible, autre audio, encodage, imbrication, 422, 503) écrit un événement
`import.result_refused` par l'unique porte de sortie (`log.event`, scope `import`) : code, statut HTTP, propriétaire (identifiant
opaque), issue, rang de l'intervalle, verset, champ du premier écart, champs distincts, total ; `error` pour l'indisponibilité
(avec la raison du moteur, une ligne bornée), `warn` pour le reste. Jamais le message ni le contenu reçu : un verset ne figure que
s'il a la forme `sourate:verset`, un champ que s'il a la forme d'un nom de champ du rapport (`describeVerdict`).

**Toujours hors contrôle** (inchangé) : un résultat de moteur distant authentifié ou du moteur local ; `source.file` n'est restitué
nulle part dans l'interface ni dans l'export (examiné, non contrôlé) ; `PUT …/decisions` ne porte ni arabe ni traduction.
