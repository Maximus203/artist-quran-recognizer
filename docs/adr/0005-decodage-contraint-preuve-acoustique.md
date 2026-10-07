# ADR-0005 — Décodage contraint : preuve acoustique sur le treillis CTC

- Statut : accepté pour le **principe et l'algorithme** (2026-10-06) ; **branchement sur un modèle réel non
  validé** (aucune exécution NeMo/GPU possible dans l'environnement de cette session).
- Précise : ADR-0003 (point 3, « décodage contraint avec chemin poubelle »).

## Ce qui existait
Aucun décodage contraint (vérifié : pas de trie, pas de chemin poubelle dans `src/`). La chaîne était
« ASR libre → normalisation → matcher B6 → décodeur B7 » : une **correction après reconnaissance**.

## Décision
Plutôt qu'un décodeur de faisceau sur un trie de tout le Coran (lourd, non testable sans modèle), on
contraint **a posteriori mais acoustiquement** : pour chaque candidat du matcher, on mesure sur le
treillis CTC (log-probabilités par trame) à quel point l'audio soutient le TEXTE DU CORPUS :
- chemin contraint : meilleur chemin CTC produisant exactement le texte candidat (Viterbi CTC) ;
- chemin libre : meilleur chemin sans contrainte = le « chemin poubelle » ;
- `llr_per_frame = (contraint − libre) / trames` ≤ 0. Proche de 0 : l'audio soutient le verset ; très
  négatif : le texte candidat n'explique pas l'audio (hallucination, parole non coranique).
- `AcousticGate(min_llr_per_frame)` : seuil de **configuration**, désactivé par défaut, à calibrer sur
  des annotations humaines (phase 6). Désactivée, la preuve est seulement jointe (observabilité).

Implémentation : `aqr.decoding.ctc_constrained` (pur Python, `ctc_forced_align`, `acoustic_support`,
`verify_candidates`), testée sur des treillis synthétiques (`tests/unit/test_ctc_constrained.py`) :
texte dit = preuve ≈ 0, texte différent = fortement pénalisé, symbole répété exige un blanc, trop peu
de trames = −inf, parole hors sujet défavorable, porte désactivée par défaut.

## Ce qui n'est PAS fait (et pourquoi)
- Le modèle FastConformer doit exposer son treillis CTC et son encodeur de symboles ; ce branchement
  exige NeMo et un GPU et doit être vérifié (vocabulaire du modèle : voyelles présentes dans 85 % des
  sorties seulement, cf. journal du 2026-10-05). Whisper n'a pas de treillis CTC.
- Aucune mesure sur de l'audio réel : aucun taux n'est annoncé. `aqr recognize --constrained` échoue
  avec un message explicite tant que l'ASR choisi n'expose pas de treillis.
- Le seuil de la porte n'est pas calibré.

## Conséquences
- La reconnaissance reste correcte sans cette preuve (matcher + décodeur, seuil 0,75) ; la preuve
  acoustique est une défense supplémentaire contre « il voit du Coran partout » (I3, I4).
- L'alignement forcé donne les trames de chaque symbole : base possible de temps de mots exacts.
