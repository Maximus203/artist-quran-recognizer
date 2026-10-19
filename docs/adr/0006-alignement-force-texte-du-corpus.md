# ADR-0006 — Alignement forcé du texte du corpus sur le treillis CTC

- Statut : accepté — 2026-10-19 (audit du 2026-10-19, direction A → B → C → D validée par Cherif)
- Précise : ADR-0005 (preuve acoustique CTC) ; prépare la vérité terrain semi-automatique (étape A)
  et la vérification acoustique des candidats dans la reconnaissance (étape B)

## Problème
Le rapport réel du 2026-10-09 mesure, sur de l'audio EveryAyah que les modèles ont vraisemblablement
vu à l'entraînement, un rappel de 52,6 % (FastConformer) et une erreur médiane de **fin** de verset
de 803 ms : la chaîne « transcription libre → recherche dans le texte » perd la moitié des versets et
borne mal leur fin, alors que l'ASR seul retrouve le bon verset dans 97 à 100 % des cas. Par ailleurs,
aucune vérité terrain humaine n'existe sur les audios réels : annoter à la main dans Audacity
(≈ 1 h par heure d'audio) n'a jamais été fait.

## Décision
1. **Aligner le TEXTE DU CORPUS, pas une transcription.** Pour une suite de versets connue (déclarée
   par un humain, ou candidate), on calcule le meilleur chemin CTC qui produit exactement ce texte
   (`aqr.alignment.forced.PassageAligner`, Viterbi CTC d'ADR-0005). On obtient les trames de chaque
   symbole, donc le temps de chaque mot, et la preuve acoustique `llr_per_frame` (chemin contraint
   contre chemin libre).
2. **Graphie de l'ASR, indices du Mushaf.** Le FastConformer (SentencePiece, 1 024 symboles) a appris
   l'imla'i, avec voyelles dans la plupart de ses sorties. On aligne la graphie Tanzil `simple` (avec
   voyelles, nouveau fichier épinglé dans `data/corpus/LOCK.json`, jamais rendu) et `simple-clean`
   (sans) ; la meilleure est retenue par passage. Chaque mot imla'i est rattaché à l'indice du mot
   **Uthmani** qu'il prononce (`aqr.corpus.alignment_text`) : positionnel pour 5 873 versets,
   alignement des lettres pour les 363 où les découpages diffèrent (« يَـٰٓأَيُّهَا » = « يا أيها »).
   Couverture vérifiée sur les 6 236 versets. La basmala que Tanzil concatène au verset 1 est exclue
   d'un verset entier (`recited_span`).
   Mesure (216 versets EveryAyah, 3 récitants) : la preuve sépare le vrai verset des faux voisins
   dans 189 / 189 cas hors basmala ; l'uthmani brut ne sépare que 79 %.
3. **Limites par l'énergie.** Un CTC émet ses symboles tôt et laisse un son tenu (madd) aux blancs :
   sans correction, la fin d'un verset arrive 470 ms trop tôt en médiane. Le treillis porte la RMS
   de chaque trame (`CtcLattice.frame_rms`) ; un verset s'étend autour de ses symboles tant que la
   RMS reste ≥ `energy_ratio` × sa RMS maximale, et recule si un symbole a été posé sur du silence,
   sans jamais empiéter sur ses voisins. `energy_ratio` est une configuration (défaut provisoire 0,10).
4. **Port `CtcAcousticModel`** (`domain/ports.py`) : `lattice(clip, span)` et `encode(text)`.
   Implémenté par le FastConformer (sorties `ctc_decoder` de NeMo, trame de 80 ms) ; contrat rejoué
   sur le vrai modèle (`tests/contract/test_ctc_acoustic_model_contract.py`, `slow`).
5. **`aqr align FICHIER --verses ... [--at a-b]`** : sortie `aqr.alignment/1`
   (`docs/ALIGN-OUTPUT.md`). Ce n'est jamais une reconnaissance : elle dit où des versets DÉCLARÉS
   seraient dits et à quel point l'audio les soutient.

## Mesures (2026-10-19, RTX 5090) — détail : `docs/evaluation/alignment-2026-10-19.md`
- EveryAyah (85 passages, 40,7 min, 216 versets, référence = étendue d'énergie de chaque clip) :
  début médian 20 à 40 ms, fin médiane 22 à 200 ms selon la définition de la référence (la fin d'un
  son qui s'éteint n'est pas un point net) ; ≥ 96 % des fins à moins de 500 ms. Calcul de
  l'alignement : 0,4 % du temps réel en Python pur.
- Prière réelle (lot1-06, 46–160 s, 21:51–21:62) : limites cohérentes avec les fenêtres du moteur ;
  21:53 et 21:62, que le moteur ne savait que supposer (`inferred`), sont placés ; une déclaration
  décalée d'un verset tombe de −0,26 à −1,47 par trame. En mosquée, la réverbération entretient
  l'énergie : à 0,05 les fins collent au verset suivant, d'où le défaut 0,10.

## Ce qui n'est PAS fait
- Aucune limite n'a été validée à l'oreille : tous les seuils restent provisoires.
- La reconnaissance (`aqr recognize`) n'utilise pas encore l'alignement (étape B) ; `--constrained`
  reste indisponible.
- Un passage est limité à `lattice_max_s` (120 s) : un fichier entier se traite par passages
  (l'atelier les enchaînera à partir des fenêtres du moteur, étape A).
- Les reprises (i'ada) doivent être déclarées (« 1:7, 1:7[5-9] ») : un texte déclaré sans la reprise
  l'absorbe dans le verset (observé sur lot1-06, 21:56).

## Conséquences
- Annoter devient « dire quoi » (référence du verset) et « écouter pour valider » ; les temps sont
  calculés. C'est la base de l'étape A (atelier) et de la mesure de toute amélioration ultérieure.
- La même brique vérifiera acoustiquement les candidats du matcher (étape B) et donnera des temps au
  mot près à `aqr recognize`.
