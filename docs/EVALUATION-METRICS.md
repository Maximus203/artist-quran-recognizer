# Métriques d'évaluation — définitions exactes

Code : `src/aqr/eval/` (`metrics.py`, lecteur `recognition.py`) · tests : `tests/unit/test_eval_metrics.py`
· CLI : `scripts/evaluate.py`. La docstring de `metrics.py` et ce document disent la même chose ;
toute modification touche les deux.

## Règle de fond

- Seuls les intervalles `verse` au statut `recognized` (horodatés) sont des versets reconnus.
- `inferred` et `uncertain` ne sont **jamais** une reconnaissance ; `abstention` est l'absence de
  décision, pas un verset.
- **On ne calcule jamais de métrique** sur un cas qui n'est pas `statut: annote` avec
  `annotation.by: human` et `annotation.reviewed_by` non vide (`EvaluationRefused`). Exception :
  un cas `origine: mix` (vérité exacte construite, jamais produite par un modèle). Une
  préannotation modèle (`model_preannotation`) n'est pas une vérité terrain.
- Une métrique sur peu de versets ne prouve rien : `aggregate` renvoie les effectifs et un champ
  `defensible: false` sous `min_reference_verses` (paramètre de l'appelant, pas de défaut caché).

## Rattachement (paramètre `MatchPolicy.min_overlap`, ]0, 1])

`ratio(a, b) = durée(a ∩ b) / min(durée(a), durée(b))`. Une prédiction **correspond** à un verset
de référence `e` si : même `ref`, plages de mots qui se recouvrent (`all` recouvre tout ;
`2:255[1-5]` et `[6-10]` ne se recouvrent pas), et `ratio >= min_overlap`. Elle est rattachée au
seul `e` de meilleur (ratio, recouvrement, début le plus tôt). Plusieurs prédictions peuvent se
rattacher au même `e` (verset coupé en deux). `min_overlap` est une convention de mesure, non
calibrée : la valeur utilisée est écrite dans le rapport.

## (a) Faux versets

Prédiction `recognized` rattachée à aucun verset de référence. Raison (premier critère vrai) :

| raison | critère |
|---|---|
| `non_quran_zone` | ≥ `min_overlap` de sa durée dans une zone `non_quran` de référence |
| `wrong_verse` | ratio ≥ `min_overlap` avec un `e` auquel elle ne correspond pas (autre verset ou autres mots) |
| `misplaced` | bon verset, bons mots, mais ratio < `min_overlap` (recouvrement > 0) |
| `unreferenced` | rien de la référence à cet endroit |

Taux = faux versets / prédictions `recognized` localisées (jamais « sur le nombre de versets de
référence »).

## (b) Omissions

Verset de référence sans aucune prédiction `recognized` rattachée. Cause (premier critère vrai,
avec ratio ≥ `min_overlap` sur le verset) : `wrong_verse` (autre verset reconnu à la place), `merged`
(le bon verset reconnu, mais déjà rattaché à une autre occurrence), `inferred`, `uncertain`,
`abstention`, `non_quran` (le moteur a dit « non coranique »), `no_output`. Pour `inferred` /
`uncertain` : `ref_correct` (le verset nommé est le bon) ; pour `uncertain` : `candidate_hit` (le bon
verset est parmi les candidats). Taux d'omission = omissions / versets de référence ; rappel = 1 − taux.

Un verset de référence de statut `inferred` (audio volontairement brouillé) reste un verset de
référence ; il est compté à part (`n_reference_verses_inferred_truth`).

## (c) Erreurs de limites

Pour chaque verset retrouvé : début prédit = min des débuts rattachés, fin = max des fins ;
`start_error_ms` / `end_error_ms` signés (prédit − référence) ; « dans la tolérance » = |erreur| ≤
`tolerance_ms` du cas ; `both_within_tolerance` = début et fin. Les cas `boundaries: approximate`
sont exclus des statistiques de limites (comptés dans `n_boundary_excluded_approximate`) ; les limites
interpolées sont incluses et dénombrées (`n_boundary_interpolated`). Médiane et max sont calculés sur
les erreurs absolues poolées de tous les versets.

## (d) Abstention

Durée de (union des intervalles `abstention` et `uncertain` localisés) ∩ (union des versets de
référence), divisée par la durée de cette union (`abstention_share`, agrégé en sommes de secondes).
`inferred` n'est pas une abstention.

## (e) Temps de calcul

`realtime_factor = timing.total_s / durée audio` (durée du manifeste, sinon de la source). Agrégé :
somme des temps / somme des durées, sur les cas qui ont un timing.

## Agrégation

Toujours par **sommes** (comptes et secondes), jamais de moyenne de ratios. Intervalles de Wilson à
95 % fournis pour le taux de faux versets et le taux d'omission. Par catégorie du manifeste : un cas
à plusieurs catégories compte dans chacune (les totaux par catégorie se recouvrent).

## Limites connues

- Les plages de mots partielles ne sont comparées qu'en recouvrement (pas de couverture de mots,
  le nombre de mots d'un verset `all` n'étant pas connu du module).
- Un intervalle `verse` non localisé (`t: null`) est ignoré (compté dans `n_unlocated_intervals`).
- Le rattachement un-pour-un d'une prédiction qui couvre deux répétitions du même verset ne trouve
  qu'une occurrence (la seconde est une omission `merged`).
- Les métriques parole non coranique (précision de la détection `NON_QURAN` par durée) ne sont pas
  mesurées ici : seule son effet sur les versets l'est (faux versets en zone non coranique,
  omissions `non_quran`).
