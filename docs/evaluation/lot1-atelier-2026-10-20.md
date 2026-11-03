# Lot 1 entier dans l'atelier après la preuve par la suite (ADR-0007) — 2026-10-20

Statut : **comptes descriptifs, pas de vérité terrain**. Les 12 fichiers du lot 1 importés dans l'atelier
(`AQR_REVIEW_DIR`, une session par fichier) et analysés par FastConformer
(`fastconformer-quran@b33af7936f9a`, segmenteur `recitation-segmenter-v2`, RTX 5090 Laptop partagé avec deux
autres traitements), code `develop` @ `6c7b189` (#47). Comparaison avec les sorties du 2026-10-07
(`D:\01-Dev\Data\aqr-out`, même moteur, avant la preuve par la suite). Les fichiers **test** n'ont servi à
aucun réglage : ils sont listés pour mémoire.

| Fichier | Jeu | Reconnus avant → maintenant | Incertains | Supposés | Abstentions | Calcul / durée |
|---|---|---|---|---|---|---|
| lot1-01 | dev | 45 → **68** | 0 → 0 | 3 → 3 | 123 → 100 | 63 s / 26 min |
| lot1-02 | test | 44 → **44** | 4 → 4 | 1 → 1 | 1324 → 1313 | 113 s / 76 min |
| lot1-03 | dev | 19 → **20** | 2 → 2 | 0 → 0 | 1579 → 1571 | 113 s / 67 min |
| lot1-04 | dev | 78 → **85** | 7 → 5 | 1 → 1 | 3085 → 3049 | 182 s / 134 min |
| lot1-05 | dev | 49 → **53** | 0 → 0 | 1 → 0 | 22 → 9 | 61 s / 28 min |
| lot1-06 | dev | 271 → **272** | 0 → 0 | 7 → 4 | 42 → 19 | 80 s / 52 min |
| lot1-07 | test | 13 → **13** | 2 → 2 | 1 → 1 | 451 → 450 | 62 s / 21 min |
| lot1-08 | test | 3 → **4** | 1 → 1 | 0 → 0 | 228 → 227 | 45 s / 11 min |
| lot1-09 | dev | 5 → **7** | 1 → 1 | 0 → 0 | 1087 → 1080 | 72 s / 30 min |
| lot1-10 | test | 6 → **7** | 1 → 1 | 0 → 0 | 315 → 313 | 60 s / 19 min |
| lot1-11 | test | 38 → **38** | 2 → 1 | 0 → 0 | 423 → 411 | 76 s / 26 min |
| lot1-12 | dev | 47 → **69** | 1 → 1 | 5 → 2 | 345 → 317 | 77 s / 31 min |

Total reconnus : 618 → 680

Lecture :
- Les gains portent sur les fichiers où des versets courts se suivent (lot1-01 et lot1-12 : sourates
  courtes et Al-Qiyama ; lot1-05 : Ash-Shura en récitation continue). Plusieurs versets supposés
  (`inferred`) deviennent reconnus (lot1-06 : 7 → 4 supposés, lot1-12 : 5 → 2).
- Sur les assises (lot1-03, lot1-09), peu de changements : les nouveaux versets relus sont des citations
  réelles (`docs/evaluation/chain-proof-2026-10-19.md`).
- Le calcul tient en 45 à 182 s par fichier de 11 à 134 min (GPU partagé).
- Reste le scénario « verset commencé, suite non détectée » : 81 cas sur les fichiers dev avant #47
  (`D:\01-Dev\Data\aqr-out\suites-non-detectees-dev.json`), confié à l'étape B (vérification acoustique).
