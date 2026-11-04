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
