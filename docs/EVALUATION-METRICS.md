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

## Annotation partielle (fenêtres)

Un cas peut n'être annoté que sur des extraits : champ de manifeste `annotated_windows: [[a, b], ...]`
(vide = tout le fichier). Seules les prédictions dont le **milieu** tombe dans une fenêtre sont jugées ;
les autres sont comptées dans `n_out_of_scope_intervals` (hors fenêtre il n'existe pas de vérité : un
verset reconnu là n'est ni juste ni faux). Une étiquette de référence hors de toute fenêtre est une
erreur d'annotation (`EvaluationRefused`). Les taux portent alors sur les extraits, pas sur le fichier.

## Agrégation

Toujours par **sommes** (comptes et secondes), jamais de moyenne de ratios. Intervalles de Wilson à
95 % fournis pour le taux de faux versets et le taux d'omission. Par catégorie du manifeste : un cas
à plusieurs catégories compte dans chacune (les totaux par catégorie se recouvrent).

## Rapport `aqr.evaluation/2` : deux blocs

`scripts/evaluate.py` écrit un rapport en deux blocs, plus une provenance commune. Code :
`src/aqr/eval/identification.py`, `transcription.py`, `report.py` · tests :
`tests/unit/test_eval_identification.py`, `test_eval_transcription.py`, `test_eval_report.py`,
`test_evaluate_script.py`.

**Bloc `vitesse`** : `wall_s` (somme des `timing.total_s`), `audio_s`, `realtime_factor`
(somme/somme), `peak_ram_mb` (maximum des `run.peak_rss_mb` des fichiers de transcription ; `null`
+ `peak_ram_note` « non mesuré » sinon, jamais inventé), `machine` (modèle de CPU, cœurs, plateforme,
Python ; pas de nom d'hôte). La machine est celle qui lance `evaluate.py` : la lancer sur la machine
qui a produit les sorties, sinon le facteur temps réel n'est pas lisible.

**Bloc `exactitude`** : `localisation` (= `aggregate` ci-dessus, même objet), `identification`,
`transcription`.

**Provenance** (haut du rapport) : `git` (SHA + arbre modifié), `models` (révision et SHA-256 de chaque
fichier de `models/LOCK.json` + empreinte du LOCK), `manifest` (empreinte du fichier + des cas
évalués), `split`, `final`, `thresholds` (rattachement, décodeur lu dans les sorties, seuil
d'effectif), `normalization` (versions `aqr.normalize/N` et `aqr.normalize-strict/N`, empreinte de ces
versions + dictionnaire imla'i), `engine` (le bloc `engine` des sorties : un seul moteur par
rapport), `run` (voir ci-dessous), `warnings`.

**Entrée : un lot, pas un dossier quelconque.** `scripts/recognize_batch.py` écrit `run.json`
(`aqr.recognition-run/1` : `status` `running` → `complete` / `partial` / `interrupted`, moteur,
options, SHA git, empreinte du manifeste, `planned`, `done` = cas → sha256 du fichier écrit,
`failed` = cas → message). `evaluate.py` ne lit un cas que s'il est dans `done` avec la même
empreinte ; il refuse (code 2, rien d'écrit) un lot absent ou non `complete`, et un dossier dont les
sorties mêlent deux moteurs. Un cas évaluable sans prédiction (hors lot, en échec, fichier modifié)
est listé (`missing_predictions` / `refused`) et le code de sortie est 1. `--allow-unverified-run`
lit d'anciennes prédictions sans `run.json` : le rapport porte alors `run: {verified: false, reason}`
et un avertissement. Code : `src/aqr/eval/run.py` · tests : `test_eval_run.py`,
`test_recognize_batch.py`.

### Identification (sans horodatage)

Séquences : attendu = refs de `expected` triées par temps ; prédit = refs des versets `recognized`
(dans la fenêtre annotée) triées par temps ; doublons consécutifs fusionnés. Par verset attendu :
`surah` (une sourate identique a été nommée), `verse_exact` (ce verset exact a été nommé) ; par cas :
`range_exact` (suite prédite identique à la suite attendue : mêmes versets, même ordre, rien en
plus ni en moins). `unrecognized` : cas à versets attendus sans aucun verset `recognized`
(`inferred`/`uncertain`/abstention ne comptent pas). `n_extra_refs` : versets nommés absents de
l'attendu. Cas sans verset attendu : `silence` (zones silence/bruit seulement) ou `off_target` (tout
autre `non_quran` : français, arabe non coranique, autre langue, formules) ; tout verset `recognized`
y est un faux positif (I3, I4), compté en cas et en versets. Aucun taux quand le dénominateur est nul.

### Transcription : WER et CER (`--transcripts`)

Entrée : un `<id>.transcript.json` par cas (`aqr.transcript/1` : `source.sha256` du manifeste,
`engine`, `text` = sortie BRUTE de l'ASR, `run.peak_rss_mb` optionnel). Référence = mots Uthmani du
corpus Tanzil des versets attendus (plages de mots respectées), jamais un modèle (I1). Deux
variantes, toujours nommées :

| variante | normalisation | CER |
|---|---|---|
| `tolerante` | `normalize_arabic` (replis `أ إ آ ٱ`→`ا`, `ى`→`ي`, `ة`→`ه`, `ؤ`→`و`, `ئ`→`ي`) + dictionnaire imla'i (`imlai_corrections`) sur la référence | lettres sans espaces |
| `strict-lettres` | `normalize_strict_letters` : NFC, diacritiques et tatweel supprimés, non-arabe → espace ; **aucun repli de lettres sauf `ٱ`→`ا`** ; `ء` conservé ; pas de dictionnaire | lettres sans espaces |

Chaque variante a son normaliseur (table `VARIANT_NORMALIZERS`), appliqué à la référence ET à
l'hypothèse. La variante stricte est une fonction distincte (`normalize_strict_letters`,
`tokenize_strict_letters`), jamais un drapeau de `normalize_arabic`. Le CER compte les lettres SANS
espaces dans les deux variantes : une coupure de mots différente coûte au WER, jamais au CER, et
l'écart tolérante/stricte ne vient que de la normalisation (replis de lettres, dictionnaire imla'i),
jamais de la façon de compter les espaces.

**`strict-lettres` est un plancher d'orthographe du Mushaf, pas une erreur d'ASR.** La référence est
le texte Uthmani du corpus, pas une orthographe imla'i : la variante compte donc aussi les
conventions du Mushaf qu'une transcription imla'i n'a pas (madda écrite `ءَا` contre `آ`, hamza
combinant, alef suscrit supprimé contre alef plein, `ى` contre `ي`). Le rapport le dit dans le champ
`description` de la variante. Mesure du 2026-10-09 sur le corpus épinglé (6 236 versets), avec pour
hypothèse le texte imla'i du corpus lui-même (un ASR parfait en imla'i) : `tolerante` WER 1,55 % /
CER 0,27 % ; `strict-lettres` WER 18,79 % / CER 5,07 %. Avec le texte Uthmani recopié :
`strict-lettres` 0 %, `tolerante` WER 9,24 % (elle suppose une hypothèse imla'i). Origine de l'écart,
sur les 70 798 mots des 5 873 versets dont les nombres de mots Uthmani et imla'i coïncident :
12 658 mots diffèrent en stricte, dont 5 933 sont absorbés par les seuls replis de lettres, 6 542
par le dictionnaire imla'i et 183 par aucun des deux. La stricte sert à diagnostiquer ce que la
tolérance cache ; ne pas la lire comme un taux d'erreur de l'ASR, et ne régler aucun seuil dessus.

Versions : `STRICT_NORMALIZATION_VERSION` (`aqr.normalize-strict/N`) est écrite dans le bloc
`normalization` du rapport et incluse dans son empreinte ; elle est à incrémenter dès que
`normalize_strict_letters` ou la façon dont la variante stricte est notée change. Un rapport d'avant
le correctif n'a pas ce champ : `--baseline` le refuse (voir plus bas).

WER = distance de Levenshtein sur les mots / mots de référence ; CER idem sur les lettres. Somme des
erreurs sur somme des longueurs. Transcription vide = WER 1. Sans `--transcripts`, le bloc dit
« non mesuré ». Une transcription dont le `sha256` ne correspond pas au manifeste est refusée.

### Avertissements écrits dans chaque rapport

- « identification de verset != validation du tajwid » : retrouver quel verset est récité ne dit rien
  de la justesse de la récitation.
- « plafond optimiste si audio EveryAyah » : l'audio de studio verset par verset est le cas facile ;
  une ligne supplémentaire compte les cas EveryAyah / mixés (heuristique : `origine: mix` ou
  « everyayah » dans `source`, `file` ou `recitant`).

### Comparaison `--baseline rapport.json`

Ajoute un bloc `comparison` (écart courant − base de chaque valeur numérique commune de `vitesse` et
`exactitude`, et `context_changes` : git, modèles, seuils, machine). **Refus (code 2, rien n'est
écrit)** si le manifeste (fichier ou cas évalués), le split, le schéma ou la normalisation (versions
tolérante et stricte + dictionnaire) diffèrent, ou si la base est illisible : on ne compare que ce
qui est comparable. Le message de refus ne liste que les parties qui diffèrent (par exemple « version
stricte : absente (base) ≠ aqr.normalize-strict/1 » pour un rapport d'avant le correctif
`strict-lettres`). `--split test` exige toujours `--final`, avec ou sans base.

## Limites connues

- Les plages de mots partielles ne sont comparées qu'en recouvrement (pas de couverture de mots,
  le nombre de mots d'un verset `all` n'étant pas connu du module).
- Un intervalle `verse` non localisé (`t: null`) est ignoré (compté dans `n_unlocated_intervals`).
- Le rattachement un-pour-un d'une prédiction qui couvre deux répétitions du même verset ne trouve
  qu'une occurrence (la seconde est une omission `merged`).
- Les métriques parole non coranique (précision de la détection `NON_QURAN` par durée) ne sont pas
  mesurées ici : seule son effet sur les versets l'est (faux versets en zone non coranique,
  omissions `non_quran`, faux positifs des cas silence / hors cible).
- Ni `aqr recognize` ni les adapters n'écrivent encore la transcription brute ni le pic de RAM :
  `--transcripts` attend des fichiers produits à part (brique à venir) ; sans eux, WER/CER et RAM
  restent « non mesuré ».
- Le WER/CER juge la transcription d'un cas entier contre la concaténation des versets attendus ; il
  ne dit rien de la justesse du tajwid, ni des cas à parole non coranique mêlée (la référence ne
  couvre alors que les versets).
