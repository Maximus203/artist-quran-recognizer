# Contrôle des étiquettes du jeu de fine-tuning (étape C)

Avant tout entraînement, chaque exemple **récité** des manifestes NeMo (`tadabur`) est noté par le
modèle de base, et la queue de distribution est écartée. Objectif : ne pas apprendre au modèle des
étiquettes fausses. Tadabur est segmenté et étiqueté automatiquement (WhisperX), sa riwaya n'est pas
documentée et une basmala peut être récitée sans être annoncée (`finetune-data.md`, « Risques
ouverts »). Aucun entraînement ici.

Outil : `scripts/build_finetune_manifest.py score|filter`. Code : `src/aqr/data/label_qc.py`.
Réglages : `LabelQcConfig` (`src/aqr/data/config.py`).

## Méthode

- **Score** : alignement forcé du texte de l'étiquette (champ `text`, retrouvé dans le corpus :
  verset `aqr_ref`, avec ou sans basmala) sur le treillis CTC du modèle de base
  `fastconformer-quran` (`models/LOCK.json`), calculé sur tout le WAV. C'est l'aligneur de
  l'ADR-0006 (`PassageAligner`), réutilisé tel quel : il essaie la graphie vocalisée et la graphie
  sans voyelles et garde la meilleure. Le score est la preuve `llr_per_frame` de l'ADR-0005 :
  (chemin contraint − chemin libre) / trames, 0 quand l'audio dit exactement le texte, très négatif
  quand il dit autre chose.
- **Basmala** (verset 1 des sourates autres que 1 et 9) : l'hypothèse inverse est aussi notée (avec
  la basmala si l'étiquette ne l'annonce pas, sans si elle l'annonce). Si elle explique mieux l'audio
  d'au moins `basmala_margin`, l'étiquette est fausse : `basmala_recitee_non_annoncee` ou
  `basmala_annoncee_absente`. Ce contrôle est nécessaire : une basmala récitée et non annoncée ne fait
  descendre le score qu'à −0,23/−0,42, **au-dessus** du seuil (mesure ci-dessous).
- **Symboles inconnus du modèle** : l'alif suscrit (U+0670, 3 330 occurrences dans la graphie
  `simple`) et le tatweel (U+0640, 939) n'ont pas de symbole dans le tokenizer, qui les code `<unk>`.
  Le modèle n'émet jamais `<unk>` : exiger ce symbole noterait comme fausse toute étiquette juste
  qui en contient (ذَٰلِكَ, فَهَدَىٰ, أُولَـٰئِكَ). Il est retiré du texte à aligner (l'aligneur ne
  change pas : c'est l'encodeur qui lui est passé) et compté dans `unknown_symbols` (voir « Constat »).
- **Ce que le modèle entend** (depuis le 2026-10-20) : le même treillis donne aussi le chemin CTC
  libre (`heard`, meilleur symbole par trame), comparé à l'étiquette sur les **lettres seules**
  (voyelles retirées, lettres doublées fusionnées) : ≥ `edge_words` (2) mots en plus au début ou à
  la fin → `debordement` ; mots en plus qui sont des mots du verset (bords ou intérieur) →
  `repetition` ; ≥ 2 mots de l'étiquette absents au début ou à la fin → `troncature` (la fin est
  mesurée à rebours, pour qu'un mot répété dans le verset ne crée pas de faux manque). Ces règles
  jouent **quel que soit le score** : un mot de trop sur un long verset pèse peu par trame. Si le
  modèle n'entend pas au moins la moitié des mots de l'étiquette, les bords ne disent rien (autre
  verset, autre parole) et seul le score décide.
- **Filtre** : écarté si le texte ne correspond pas au corpus (`texte_different_du_corpus`), ne tient
  pas dans les trames (`texte_non_aligne`), si la basmala est fausse, si les mots entendus le
  disent (ci-dessus), ou si `llr_per_frame < min_llr_per_frame` (`preuve_faible`) — **sauf** si le
  modèle entend exactement les lettres de l'étiquette : le score bas vient alors d'une convention
  d'écriture (Tanzil n'écrit pas le soukoun d'un noun assimilé, « الْإِنسَانَ », le modèle l'écrit,
  « الْإِنْسَانَ » : −1 par trame sur un verset de deux mots). Le manifeste filtré reprend les lignes
  d'origine **à l'identique**.
- La parole non coranique (FLEURS, Common Voice) n'est pas concernée : `score` la refuse.

## Sorties (hors dépôt)

```
$AQR_FINETUNE_DIR/manifests/<source>/
  train.qc.jsonl, val.qc.jsonl   manifestes filtrés (à côté des originaux : chemins audio inchangés)
  qc/scores.jsonl                un score par ligne (reprise : une ligne écrite est acquise)
  qc/scores.json                 modèle (révision), empreinte du LOCK du corpus, graphies : une
                                 reprise avec un autre modèle ou corpus est refusée
  qc/report.json                 seuil, gardés / écartés par raison, distribution (quantiles,
                                 histogramme, seuil robuste suggéré), 30 pires exemples
  qc/rejected.m3u                liste d'écoute de TOUS les écartés, les pires d'abord (VLC, mpv)
```

`filter` ne recalcule rien : il se relance en une seconde pour essayer un seuil (`--min-llr`).

## Calibrage du 2026-10-19 (shard `data/train-00384.parquet`)

433 versets, 1,55 h, 155 récitants (échantillon construit par la PR #46). GPU RTX 5090 Laptop :
**8,0 exemples/s** (le Viterbi est en Python pur), soit ~13 h pour les 384 450 versets de Tadabur.

Distribution de `llr_per_frame` (433 alignés, aucun texte refusé ni hors trames) :

| p1 | p2 | p5 | p10 | p25 | p50 | p75 | p90 |
|---|---|---|---|---|---|---|---|
| −1,697 | −1,053 | −0,576 | −0,389 | −0,209 | −0,076 | −0,005 | 0,000 |

Histogramme (pas de 0,145) : 284 exemples dans [−0,145 ; 0], 76 dans [−0,29 ; −0,145[, 36 dans
[−0,435 ; −0,29[, puis une queue longue et clairsemée jusqu'à −2,90. Seuil robuste suggéré par le
rapport (médiane − 3 σ, σ = 1,4826 × MAD = 0,113) : −0,413.

**Méthode** : les 69 exemples sous −0,3 ont été décrits par la transcription libre du même modèle
(mots normalisés), comparée à l'étiquette mot à mot (pas d'écoute humaine : `qc/rejected.m3u`
permet de le faire).

- Sous −0,45 (34 exemples) : **19 étiquettes visiblement fausses** — 14 segments qui débordent sur
  le verset précédent et/ou suivant (+3 à +13 mots), 3 segments tronqués (−3 à −4 mots), 1 passage
  répété par le récitant (19:72), 1 lecture autre que Hafs probable — et 15 où le modèle entend les
  mots de l'étiquette, à de petites erreurs de transcription près (enregistrement, allongements :
  coût du seuil).
- Entre −0,45 et −0,3 (35 exemples) : 2 cas douteux seulement (21:66, « ولا يضركم » non entendu ;
  7:170, transcription confuse), le reste conforme à l'étiquette.
- Le débordement le plus haut observé est à −0,477 (9:125).

**Seuil retenu : −0,45** (`LabelQcConfig.min_llr_per_frame`) : 34 exemples écartés (7,9 %, 0,17 h),
19 des 21 erreurs visibles sous −0,3, au prix de 15 exemples justes. La précision des étiquettes prime
sur le volume (Tadabur annonce 1 400 h). **Marge basmala : 0,02** (témoin ci-dessous). Résultat :
399 exemples gardés (1,38 h, 151 récitants), tous identiques aux lignes d'origine.

### Cinq exemples écartés, décrits

| Verset | Voix | Score | Ce que dit l'audio (transcription libre du modèle de base) |
|---|---|---|---|
| 50:21 | tadabur-518 | −2,899 | 19 mots pour 6 annoncés : la fin de 50:20 (« ونفخ في الصور ذلك يوم الوعيد »), 50:21, puis le début de 50:22 (« لقد كنت في غفلة من هذا فكشف… ») — segment qui déborde des deux côtés. |
| 7:110 | tadabur-664 | −2,391 | 17 mots pour 7 : la fin de 7:109 (« إن هذا لساحر عليم ») avant le verset, 7:111 (« قالوا أرجه وأخاه وأرسل في المدائن… ») après. |
| 6:59 | tadabur-9 | −1,029 | 27 mots pour 31 : la fin du verset (« إلا في كتاب مبين ») n'est pas dans l'audio — segment tronqué. |
| 6:96 | tadabur-202 | −0,601 | Tous les mots sauf un : « وَجَاعِلُ اللَّيْلِ » là où Hafs lit « وَجَعَلَ اللَّيْلَ ». « وجاعل » est la lecture des non-Koufiens (dont Warsh et Qalun, d'après Nafi') : récitant probablement **pas en Hafs**, à confirmer à l'oreille sur ses autres versets. |
| 9:125 | tadabur-693 | −0,477 | 16 mots pour 12 : « يستبشرون » (fin de 9:124) avant, « أولا يرون أن » (début de 9:126) après. Le débordement le moins pénalisé observé : il fixe le seuil. |

Exemple de coût du seuil : 18:83 (tadabur-479, −0,726), le modèle entend exactement les 9 mots de
l'étiquette ; écarté quand même.

### Témoin positif de la basmala

Le shard ne contient aucune basmala fausse (7 versets 1, tous annoncés sans basmala ; l'hypothèse
inverse y est toujours plus mauvaise d'au moins 0,94). Témoin construit hors entraînement, en mesure
seule, avec EveryAyah (1:1 = basmala, puis 112:1, même voix, 0,5 s de silence entre les deux) :

| Voix | Basmala récitée, non annoncée | Basmala annoncée, absente | Étiquettes justes |
|---|---|---|---|
| Husary | −0,261 ; inverse −0,185 → signalée (gain 0,076) | −4,619 ; inverse 0 → signalée | gardées |
| Alafasy | −0,230 ; inverse −0,038 → signalée (gain 0,192) | −6,064 ; inverse 0 → signalée | gardées |
| Abdul Basit | −0,423 ; inverse −0,062 → signalée (gain 0,361) | −2,733 ; inverse −0,154 → signalée | gardées |

Les trois basmalas non annoncées ont un score **au-dessus** du seuil de −0,45 : sans ce contrôle,
elles passeraient. Marge 0,02 : sous le plus petit gain positif (0,076), loin des gains des
étiquettes justes (≤ −0,94).

## Constat : la cible d'entraînement contenait des `<unk>` (corrigé le 2026-10-20)

**140 étiquettes sur 433 (32 %, 0,63 h)** contenaient au moins un alif suscrit ou un tatweel, que le
tokenizer du modèle code `<unk>`. La première passe, sans retrait, en écartait 42 au seuil de −0,6
dont des étiquettes justes (3:94, 38:25, 70:18 : le modèle entend exactement le texte).

1. **Entraînement — corrigé** : mesuré sur tout le corpus `simple` (78 248 mots), l'alif suscrit
   (U+0670, 3 330 mots) et le tatweel (U+0640) sont les **deux seuls** caractères inconnus du
   tokenizer ; sans eux, aucun mot ne donne `<unk>`. `build` écrit désormais toute cible (récitation
   et non-Coran) dans la graphie du modèle (`model_graphie`, `FinetuneConfig.target_drop_chars`) :
   « ذَلِكَ », « الرَّحْمَنُ », comme le modèle les écrit déjà. Échantillon reconstruit : 0 ligne avec
   ces caractères dans les 6 manifestes ; `score` a renoté les 140 lignes changées (le texte entre
   dans la clé de reprise), distribution inchangée, rapport `unknown_symbols` : 0 étiquette.
   `filter` signale toute étiquette qui demanderait encore un `<unk>`.
2. **Alignement (ADR-0006) et porte acoustique (ADR-0005)** : ils encodent le texte du corpus et
   paient la même pénalité sur ~ un verset sur deux ; les seuils calibrés ailleurs l'intègrent sans
   le savoir. Non modifiés ici (comportement de l'alignement inchangé par consigne). **Alignement
   corrigé le 2026-10-20** (`emittable_encoder`, mesures : `alignment-unk-2026-10-20.md`).

## Ce que le modèle entend : résultat du 2026-10-20

**Shard 384** (renoté avec l'écoute, même seuil −0,45) : **405 gardés, 28 écartés, tous nommés** —
16 débordements, 3 répétitions (19:72 « وَنَذَرُ الظَّالِمِينَ », 34:3 « وَلَا أَكْبَرُ », 5:69), 3
troncatures (4:3, 6:59, 21:66), 6 preuves faibles (dont 6:96, lecture autre que Hafs probable). Par
rapport au seuil seul (34 écartés) :
- **9 étiquettes justes sauvées** : le modèle entend exactement leurs mots (3:94, 4:30, 10:35,
  18:83, 23:65, 26:176, 35:36, 50:20, 55:39) ; seule la convention de voyelles les pénalisait.
- **3 étiquettes fausses attrapées** au-dessus du seuil : 4:161 (−0,27, passage repris au début,
  9 mots en plus), 21:66 (−0,42, « وَلَا يَضُرُّكُمْ » absent), 34:3 (−0,29, répétition).
- Sur les étiquettes gardées, jamais plus d'un mot en plus ou en moins aux bords (un fragment du
  verset voisin) : d'où `edge_words = 2`.

**Voix directe : les 3 prises micro de Cherif** (atelier, 2026-10-19 : basmala puis 55:1-4, jamais
vues par le modèle ni par Tadabur ; mesure seule, hors dépôt). Découpées par l'alignement forcé, puis
chaque cas fabriqué à partir de sa voix et noté par le contrôle réel (même modèle, même réglage) :

| Cas (× 3 prises) | Verdict |
|---|---|
| 55:1, 55:2, 55:3, 55:4 bien étiquetés | gardés (12/12 ; 55:3 à −0,68/−1,06 sauvé par l'écoute) |
| 55:2 annoncé 55:3, 55:4 annoncé 55:3 | `preuve_faible` (6/6, −3,0 à −4,6) |
| 55:2+55:3 annoncé 55:2 ; 55:3+55:4 annoncé 55:4 ; 55:1-4 annoncé 55:3 | `debordement` (9/9) |
| 55:3 + premier mot de 55:4 | écarté (3/3 : 2 `debordement`, 1 `preuve_faible`) |
| 55:2 récité deux fois | `repetition` (3/3) |
| 55:4 coupé à moitié, ou au début de son dernier mot | écarté, `preuve_faible` (6/6) |
| basmala seule annoncée « basmala + 55:1 » | écarté (3/3) |
| basmala + 55:1 annoncé sans basmala | `basmala_recitee_non_annoncee` (3/3) |
| basmala + 55:1 annoncé avec | gardé (3/3) |
| 55:1 seul annoncé avec basmala | `basmala_annoncee_absente` (3/3) |

**51/51** décisions justes. Défaut corrigé en chemin : un mot répété dans le passage (« الرحمن … الرحمن »)
faisait croire à une troncature sur une prise ; la fin se mesure désormais à rebours.

## Limites

- Calibré sur **un** shard (433 versets) : à revérifier sur quelques shards de plus (la liste
  d'écoute le permet) avant de traiter tout Tadabur.
- Exemples **décrits** par la transcription du modèle de base, pas écoutés : une transcription peut
  elle-même se tromper (6:96 est à confirmer à l'oreille).
- Une autre riwaya n'est détectée que si elle change des mots ou des voyelles que le modèle entend ;
  les différences de prononciation seules (imala, taqlil, madd) passent. Seul 6:96 l'a révélée ici.
- Un seul mot en plus ou en moins aux bords n'est pas nommé (tolérance mesurée) : sur un verset
  court il est écarté par le score, sur un long verset il peut passer.
- Une troncature d'un verset de deux mots est écartée comme `preuve_faible`, pas nommée.
- L'écoute repose sur la transcription du modèle de base : s'il se trompe sur des mots aux bords
  d'une étiquette juste, celle-ci peut être écartée (aucun cas sur le shard 384).

## Reproduire

```bash
export AQR_FINETUNE_DIR=~/aqr-finetune AQR_MODELS_DIR=~/aqr-models
python scripts/build_finetune_manifest.py score --source tadabur     # reprenable, --limit N
python scripts/build_finetune_manifest.py filter --source tadabur    # seuil de LabelQcConfig
python scripts/build_finetune_manifest.py filter --source tadabur --min-llr -0.6   # essai
```
