# L'aligneur n'exige plus `<unk>` — mesures du 2026-10-20

Statut : **comparaison avant / après sur les MÊMES transcriptions**, pas de vérité terrain humaine (sauf
EveryAyah, dont les versets attendus sont connus par construction). Moteur `fastconformer-quran@b33af7936f9a`
(+ Whisper-Tarteel et Muno pour le micro), segmenteur `recitation-segmenter-v2`, seuils inchangés
(`min_llr_per_frame` −1,0, Dice 0,6, `energy_ratio` 0,10), RTX 5090 Laptop, Windows.

## Le changement
La graphie Tanzil `simple` (variante `VOCALIZED` de l'aligneur, ADR-0006) contient l'alif suscrit (U+0670,
3 330 mots) et le tatweel (U+0640, 939), que le tokenizer du FastConformer code `<unk>` et que le modèle
n'émet jamais (constat de l'étape C, `finetune-label-qc.md`). Exiger ce symbole pénalisait la variante
vocalisée sur environ un verset sur deux ; la variante `BARE` (`simple-clean`) n'en contient pas et l'aligneur
garde la meilleure des deux, d'où un effet limité mais réel.

Une seule fonction, `aqr.alignment.forced.emittable_encoder(model)`, rend l'encodeur de l'aligneur : les
symboles d'un texte moins `model.unknown_symbol` (ajouté au port `CtcAcousticModel`). Elle sert `aqr align`,
la vérification acoustique de `aqr recognize` (ADR-0008), `scripts/measure_alignment.py` et le contrôle des
étiquettes (`LabelScorer`, qui avait sa propre copie de ce filtre). Le symbole est lu à chaque texte, pas à la
construction : le FastConformer dédié à la vérification reste chargé au premier treillis seulement.

## Protocole
`scripts/measure_acoustic_check.py`, avec un mode de plus pour cette mesure seulement (copie de travail hors
dépôt) : `avant` = même vérificateur, encodeur brut du modèle (comportement de `develop` @ `bf92dc5`) ;
`audio` = encodeur sans `<unk>`. Chaque fichier passe une seule fois par l'ASR : les deux décisions voient les
mêmes fenêtres et les mêmes transcriptions. Sorties hors dépôt.

## 1. Voix de Cherif au micro (3 enregistrements, basmala puis 55:1-4, trois moteurs)
| Enregistrement | Versets (avant = après) | Preuve de la suite 55:1-4, avant → après |
|---|---|---|
| prise FastConformer | 55:1-4 | −0,327 → **−0,077** |
| prise Whisper | 55:1-4 | −0,416 → **−0,121** |
| prise Muno | 55:1-4 | −0,436 → **−0,133** |

Identique avec les trois moteurs (la preuve vient du treillis du FastConformer, pas de l'ASR). « الرَّحْمَٰنُ »
(55:1) porte un alif suscrit : la vraie suite gagne 0,25 à 0,30 par trame et s'éloigne du seuil.

## 2. EveryAyah (3 récitants × 10 sourates, 216 versets)
| | Rappel `recognized` | Faux versets | Limites (début médian · fin médiane) |
|---|---|---|---|
| Avant | 212 / 216 = 98,1 % | 0 | 21 ms · 61 ms |
| Après | 212 / 216 = 98,1 % | 0 | 21 ms · 61 ms |

(La référence de 96,8 % date d'avant la suite d'un verset commencé et `top_k` ; la nuit du 2026-10-20 avait
97,7 %. Ici les deux modes partagent les transcriptions : l'écart avant / après est exact, nul.)

**Preuve des suites** (`llr_per_frame`) :
| | Vraies suites (64) : min · médiane | Suites « hors sourate » (6) : min · max |
|---|---|---|
| Avant | −0,395 · −0,079 | −0,851 · −0,154 |
| Après | **−0,297 · −0,049** | −0,851 · −0,154 |

18 vraies suites gagnent jusqu'à +0,26 (Al-Mulk surtout : « الرَّحْمَٰنِ » quatre fois) ; aucune ne
perd. Les six « hors sourate » sont les quasi-homonymes déjà connus (23:78-79 sur 67:23-24, 32:9) : inchangées,
toujours acceptées, toujours sans faux verset.

## 3. Lot 1, fichiers dev (cas « verset commencé puis abstention », liste de référence 81 cas)
| Fichier | Cas résolus avant → après | Reconnus avant → après | Suites vérifiées |
|---|---|---|---|
| lot1-06 (prière) | 24 → 24 / 24 | 276 → 276 | 73 |
| lot1-01 | 4 → 4 / 6 | 87 → 87 | 35 |
| lot1-09 | 1 → 1 / 2 | 6 → 6 | 13 |
| lot1-05 | 8 → 8 / 8 | 55 → 55 | 24 |
| lot1-03 | 0 → 0 / 3 | 17 → 17 | 23 |
| lot1-12 | 1 → 1 / 3 | 78 → 78 | 31 |
| lot1-04 (assise) | 19 → 19 / 35 | 98 → 98 | 103 |
| **Total** | **57 → 57 / 81** | **617 → 617** | 302 |

Aucun verset reconnu n'apparaît ni ne disparaît ; les cas résolus restent ceux de la référence (57 / 81).

**Suites de versets** (217 vérifiées) : 113 voient leur preuve monter (médiane +0,14, jusqu'à +0,96), aucune
ne baisse.
| | Acceptées : min · médiane | Refusées : max · médiane |
|---|---|---|
| Avant | **−1,000** · −0,216 | −1,017 · −1,512 |
| Après | −0,945 · −0,125 | **−1,209** · −1,539 |

Avant, acceptées et refusées se touchaient au seuil (31:30 dans la prière acceptée à −1,000 pile, 3:161 de
lot1-12 refusée à −1,017). Après, un écart de 0,26 sépare les deux groupes autour de −1,0. Trois suites
changent de décision, toutes vers l'acceptation, sans effet sur la sortie :
- lot1-06, 27:68 posé sur 23:83 (−1,27 → −0,70) et 7:8-9 posé sur 23:102-103 (−1,32 → −0,95) : quasi-homonymes
  d'autres sourates (« لَقَدْ وُعِدْنَا هَٰذَا… », « فَمَنْ ثَقُلَتْ مَوَازِينُهُ… »). Leur refus venait en partie
  du `<unk>` de « هَٰذَا » ; la vraie suite (23:83, 23:102-103) est promue aussi et le décodeur la garde par le
  contexte, comme pour les homonymes d'EveryAyah.
- lot1-12, 3:161 [6-21] (−1,02 → −0,64) : déjà reconnu par sa propre preuve avant comme après.

**Suite d'un verset commencé** (85 vérifiées) : aucune preuve ne change. Les textes alignés sont courts (le
reste d'un verset, aligné à fin libre) : 4 sur 85 seulement contiennent un alif suscrit ou un tatweel, et la
variante sans voyelles l'emporte alors. Distribution inchangée : acceptées −0,67 à 0 (similarité ≥ 0,6),
refusées −3,9 à −0,12, dont 28 au-dessus de −1,0 écartées par la seule similarité.

## Les seuils doivent-ils bouger ?
**Non, pas sur ces mesures.**
- `min_llr_per_frame` −1,0 : la correction ne déplace que les vraies suites et les quasi-homonymes, vers le
  haut ; les suites refusées du lot 1 (homonymes d'autres sourates, citations mal transcrites) restent sous
  −1,2. Le seuil est désormais au milieu d'un écart au lieu d'être sur la frontière : on gagne de la marge pour
  l'audio réverbéré de prière (une vraie suite à −1,003 avait été relevée avant le correctif `model.eval()`).
  Le resserrer (vers −0,8) écarterait 7:8-9 posé sur 23:102-103, mais aussi 36:70 (lot1-04, −0,86) dont on ne
  sait rien sans vérité terrain : à décider sur les annotations de l'étape A, pas ici.
- Dice 0,6 (suite d'un verset commencé) : rien ne change, rien à recalibrer.
- Les quasi-homonymes restent hors de portée de tout seuil absolu (preuve relative entre suites concurrentes :
  non fait, déjà noté dans `acoustic-check-2026-10-20.md`).

## Limites
- Pas de vérité humaine : les décisions changées sont relues, pas annotées.
- La porte acoustique d'ADR-0005 (`verify_candidates`) prend aussi un encodeur ; elle n'est branchée nulle part
  aujourd'hui. Le jour où elle l'est, lui passer `emittable_encoder(model)`.
- Coût : nul (un filtre de liste par mot encodé).
