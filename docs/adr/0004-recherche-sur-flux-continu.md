# ADR-0004 — Recherche sur le flux continu du Coran (B6)

- Statut : accepté — 2026-10-02 (revue externe de la phase 2, `docs/prompts/phase-02b.md`)
- Précise : ADR-0003 (le matcher reste lexical, sans base vectorielle)

## Problème
Le matcher de la phase 2 notait une requête par `difflib.ratio` contre **un verset entier**.
Or un segment audio découpé aux pauses est souvent une partie de verset (waqf), plusieurs
versets d'un souffle (112:1-2), ou un verset 1 sans la basmala que Tanzil y concatène.
Mesuré sur `develop` @ 2b624ba (fenêtres du flux imla'i, graine 7) : top-1 de 65,8 % sur
3–6 mots, 87,0 % sur 7–12 mots, 71,7 % pour « verset 1 sans basmala », et des **faux
versets au-dessus du seuil du décodeur (0,75)** — 10/600, 5/600 et 4/113 : violation de I3.

## Décision
1. **Un seul flux de mots** (77 800 mots, position -> (verset, mot)). La basmala du verset 1
   de chaque sourate (sauf 1:1 et 9) est une **unité à part**, retirée du flux : détectée en
   tête de requête (tolérante à un mot avalé/ajouté), puis réintégrée au `WordSpan` du verset 1
   seulement si elle précède bien son début.
2. **Alignement local** (Smith-Waterman par mots, borné autour de la diagonale) d'une requête
   sur une fenêtre du flux. Amorces : n-grammes de caractères (insensibles aux frontières de
   mot, ADR-0003) qui votent pour des diagonales ; mots entiers pour les requêtes de 1-2 mots.
3. **Score** = `somme des similarités / (mots de la requête + mots du flux sautés)`
   × `min(1, mots expliqués / evidence_words)`. Les parties non récitées d'un verset ne
   coûtent rien ; un fragment trop court pour être discriminant (F5) ne franchit jamais la
   porte de confiance du décodeur. Aucun seuil de décision dans le matcher : tout est dans
   `FlowMatcherConfig`, calibré par `scripts/bench_segments.py`.
4. **Ambiguïté préservée** : toutes les positions distinctes sont renvoyées avec leur score
   (formules répétées : « الله لا إله إلا هو الحي القيوم » -> 2:255 **et** 3:2). À score égal, le
   segment qui épouse les bornes d'un verset passe devant celui qui coupe un verset plus long
   (ordre seulement : le décodeur voit toujours l'égalité et déclare UNCERTAIN).
5. **Résultat multi-versets** : `Candidate.span` (1ᵉʳ verset) + `continuation` (suivants) +
   `query_counts` (mots expliqués par verset). B7 prend pour état la suite de versets du
   candidat et émet une `Detection` par verset ; le temps du segment est réparti au prorata
   des mots, la coupure interne est marquée `time_interpolated` — l'invariant « RECOGNIZED
   n'est jamais interpolé » est levé : le **segment** est mesuré, seule la frontière entre deux
   versets du même segment est estimée. Phase 4 la remplacera par les horodatages mots de l'ASR.

## Conséquences
- `NgramVerseMatcher` est remplacé par `FlowVerseMatcher` (même port `VerseMatcher`).
- La basmala seule ne nomme que 1:1 ; son étiquetage `NonQuranKind.BASMALA` ailleurs reste au
  pipeline (`is_basmala_only_span`, phase 4-5).
- Les requêtes < 5 lettres au total sans verset 1 derrière (un seul mot court) ne produisent
  pas d'amorce : jamais de candidat, ce qui est le comportement voulu (I3).
