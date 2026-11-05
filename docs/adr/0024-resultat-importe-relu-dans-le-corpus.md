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

**Toujours hors contrôle** (inchangé) : un résultat de moteur distant authentifié ou du moteur local ; `PUT …/decisions` ne porte ni
arabe ni traduction. (`source.file`, écrit ici « non restitué », l'était par l'API : corrigé par l'addendum suivant.)

## Addendum 2026-11-04 (3) — champs libres résiduels et messages exacts (troisième recette QA : P5, P6)

La troisième recette a rejoué 23 résultats légitimes et 10 résultats réels du moteur (tous acceptés) et trouvé deux restes. Rien ne
change à la décision ; la règle est étendue aux champs que l'interface n'affiche pas.

**P5 — `source.file`, `acoustic_checks`, `cascade`, champs en trop : une seule règle.** Ces champs acceptaient du faux arabe (201)
et `GET /api/sessions/:id` (`source.file`) comme `…/export` (le fichier entier) le rendaient. La règle, unique, vit dans
`verify_recognition` : **tout ce que le contrôle ne relit pas contre le corpus ou QuranEnc ne contient aucune écriture arabe, clés
comprises** (`_inert`, parcours itératif). S'y appliquent : `acoustic_checks` (liste de relevés), `cascade` (objet), `decoder`,
`timing`, `windows`, `source.*` hors `file`, `engine.*` hors noms de moteur, `riwaya.*` hors `assumed`/`notice`, les champs d'un
intervalle hors `ref`/`words`/`candidates`/`text`/`translation`/`label`/`label_ar` (donc aussi `promoted_by` et
`word_times_source`, que le contrat web tolère), les champs annexes d'une traduction et ce que portent ses segments et son fragment
hors leur `text`, et tout champ inconnu du document. Constats `extra_field` (avec le rang de l'intervalle), `acoustic_checks`,
`cascade`, `translation.extra` ; messages fixes, jamais le contenu. Le libellé d'une zone non coranique est aussi contrôlé dans sa
forme (l'ancien rapprochement ignorait tout ce qui n'est pas a-z : « [isti'adha] » suivi d'un faux verset passait).
- **Un champ inconnu reste permis tant qu'il n'écrit pas d'arabe.** « Refuser les champs inconnus » aurait refusé le résultat d'un
  moteur plus récent qui ajoute un champ, alors que le contrat est additif ; « écarter » les champs aurait réécrit le fichier, donc
  changé son empreinte (Décision 2).
- **`source.file` : l'arabe est permis.** Une récitation s'appelle souvent « الفاتحة.mp3 » : refuser le résultat d'un vrai moteur
  pour cela serait pire que le risque. Le nom est borné (255 signes) et sans caractère de contrôle (refus, message exact) ; à la
  lecture il est masqué (`recognition.ts`, comme les avertissements).
- **Lecture** : le contrat web ne rendait déjà ni `acoustic_checks`, ni `cascade`, ni les champs en trop (zod les écarte). Il rend
  maintenant `source.file` borné et masqué, et écarte les clés arabes de `decoder` / `timing` (fichiers conservés avant ce contrôle,
  ou venus d'un moteur distant). Un test fixe que rien du faux arabe de ces champs ne ressort de `readResult().parsed`.
- **Export (`…/export`, `aqr.review-pack/1`) : le fichier reste cité à l'octet près.** `prediction.original_json` est le fichier dont
  `prediction.sha256` est l'empreinte, celle à laquelle les décisions humaines se réfèrent (ADR-0014) : le masquer ou le réécrire le
  ferait mentir sur son empreinte. Pour un import fait après ce correctif, ce fichier ne contient d'arabe que dans le texte du Mushaf
  et la traduction (relus), les avertissements et `source.file` (bornés, masqués par l'interface). **Limite** : un fichier conservé
  avant ce correctif, ou venu d'un moteur distant authentifié (hors contrôle), est exporté tel qu'il est ; l'interface et
  `GET /api/sessions/:id` ne le rendent jamais tel quel.
- **Non-régression mesurée** : 1 594 résultats distincts du moteur trouvés sur le poste (92 921 intervalles ; 1 387 avec
  `acoustic_checks`, 303 avec `cascade`) : 1 593 sans aucun constat. Le seul constat est une plage de mots 1-144 pour 2:282 (128
  mots), refusée par le contrôle des plages de mots d'avant ce correctif, inchangé ici. S'y ajoutent les valeurs exactes des
  constantes du moteur et la sortie réelle de `build_json` avec des vérifications de toutes natures (`chain`, `continuation`,
  `neighbor`, `head`, `relisten`, `gap` et ses rôles) dans `tests/unit/test_verify_recognition.py`.

**P6 — messages exacts.** Le contrôle disait « n'est pas un court texte sans écriture arabe » pour une notice ABSENTE ou un nom nul.
`_text_problem` distingue maintenant `absent`, `type`, `long`, `arabic`, `control`, et chaque phrase dit la vraie raison (« La
notice de riwaya : valeur absente ou nulle. »).
- **`riwaya` sans `notice`** : refusé, avec ce message. Aucune version du moteur ne l'écrit sans (introduite avec la notice, #58) ; et
  sans notice le contrat web écarterait toute la riwaya, donc le bandeau « supposée, non vérifiée » (I3).
- **`engine.acoustic: null`** : **accepté**, comme vide ou absent (« aucun modèle acoustique »). Le champ n'est lu nulle part ; un
  autre producteur peut écrire `null` pour dire la même chose. Les autres noms de moteur nuls restent refusés (le contrat web les
  refuse déjà).
- **UTF-16 / UTF-32 sans BOM** : **refusé avec la marche à suivre**, comme avec BOM (400 `result_encoding`). Détection : un octet nul
  parmi les 8 premiers (un JSON UTF-8 n'en a jamais). Il n'est pas converti : ce serait réécrire le fichier (Décision 2) ; le message
  indique `Out-File -Encoding utf8` et le Bloc-notes. Le BOM UTF-8 reste le seul octet retiré.
- **Contrat refusé** : au lieu du « n'est pas un JSON aqr.recognition/1 valide » unique, un JSON illisible est dit tel, et un
  contrat refusé nomme le rang de l'intervalle et le champ (« intervalle 2, champ « t » absent ou mal formé »). Seuls les noms du
  contrat sont recopiés (un autre nom devient « … ») ; le champ est aussi dans le journal `import.result_refused`.
