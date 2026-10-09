# Évaluation réelle — 2026-10-09

Deux moteurs (FastConformer, Whisper) relancés pour de vrai sur le split `dev` du corpus de référence,
avec le protocole de lot vérifiable (`run.json`, PR #41). Tout chiffre ci-dessous est relevé dans un
artefact conservé (`run.json`, `timings.json`, rapport JSON d'`evaluate.py`, sorties `<id>.json`) :
rien n'est estimé. Ce qui n'a pas d'essai est écrit **« non qualifié »**.

**Les résultats mesurent un plafond optimiste** : audio EveryAyah mixé et dégradé, deux récitants, que
les modèles ont très probablement vu à l'entraînement. Aucune conclusion sur d'autres voix, le
microphone ou la parole non coranique parlée.

## 0. Lire ce rapport : trois blocs étiquetés

| Bloc | Section | Statut |
|---|---|---|
| **Reconnaissance réelle fraîche** | § 3 (dev) | Moteurs relancés au SHA testé, `run.json` vérifié, `evaluate.py` sans `--allow-unverified-run` |
| **Résultats historiques non vérifiés pour ce SHA** | § 4 (test réservé, ancien run dev, ancien libellé) | Anciennes prédictions sans `run.json`, jamais relancées |
| **Tests avec doubles** | § 5 | Tests unitaires avec faux composants : ils ne mesurent **aucune** précision |

## 1. Code testé et exécutions (provenance par moteur)

**SHA testé : `cf3196f120f58ac43c37fb2b8e723f537cccda86`** (`run.json.git` : `dirty: false`, arbre propre) =
branche `feat/recognize-batch-report` après fusion de `develop` @ `e8c8c74` (contient #36, #37, #38, #39,
#40). Les commits postérieurs de la branche (tests, ce rapport, choix du moteur du smoke e2e) ne
touchent ni `src/` ni les scripts de reconnaissance et d'évaluation : `git diff cf3196f <tête publiée>
--stat -- src scripts` ne liste que `scripts/smoke_e2e.sh` (outillage du smoke), et le même diff limité à
`src/aqr/pipeline src/aqr/matching src/aqr/decoding src/aqr/adapters` est vide. Le SHA de tête publié
figure dans la description de la PR #41.

**Le code de reconnaissance est identique à `develop` @ `1a79e20`** (code du premier rapport), à une
exception près, neutralisée ci-dessous :
```
$ git diff 1a79e20 HEAD --stat -- src/aqr/pipeline src/aqr/matching src/aqr/decoding src/aqr/adapters
(sortie vide)
$ git diff 1a79e20 HEAD --stat -- src/aqr/corpus
 src/aqr/corpus/normalize.py | 54 ++++++++++++++++++++++++++++++++++++++-----
```
Le pipeline et le matcher importent `normalize_arabic` depuis `src/aqr/corpus/normalize.py` : ce fichier a
changé (ajout de `normalize_strict_letters`, des constantes de version et d'un `_normalize` partagé), donc
quatre répertoires ne suffisaient pas. **Mesure refaite pour ce rapport** : l'ancienne (`1a79e20`) et la
nouvelle `normalize_arabic`, ainsi que `tokenize`, donnent **0 écart** sur les deux textes Tanzil du corpus
(uthmani et simple-clean : 12 532 lignes et 165 226 mots). Une mesure indépendante du relecteur a trouvé
le même résultat. Autre preuve de comportement : les intervalles des 82 cas × 2 moteurs sont identiques à
ceux de l'ancien run (§ 3.7). Le reste des changements depuis `1a79e20` concerne l'évaluation
(`src/aqr/eval`, `scripts/evaluate.py`), le lot (`scripts/recognize_batch.py`) et la construction du corpus.

| | FastConformer | Whisper |
|---|---|---|
| Dossier des sorties (hors dépôt) | `/root/aqr-ref/out2/dev-fc/` | `/root/aqr-ref/out2/dev-wh/` |
| Rapport `evaluate.py` (hors dépôt) | `/root/aqr-ref/out2/report-dev-fc.json` | `/root/aqr-ref/out2/report-dev-wh.json` |
| Début → fin (UTC, `run.json`) | 22:08:55 → 22:19:54 | 22:19:56 → 22:37:31 |
| Durée du lot (`timing.elapsed_s`) | 658,45 s | 1 054,48 s |
| Somme des temps par cas (`timings.json`) | 656,93 s | 1 052,99 s |
| Création du recognizer (`model_load_s`) | 1,34 s | 1,31 s |
| Code de sortie du lot | 0 | 0 |
| `run.json.status` | `complete` | `complete` |
| planned / done / failed | 82 / 82 / 0 | 82 / 82 / 0 |
| Moteur (`engine.asr`) | `fastconformer-quran@b33af7936f9a` | `whisper-base-quran@5c3c53fdf927/times-estimated` |
| Segmenteur | `recitation-segmenter-v2@5ee90364e709` | idem |
| Pic mémoire **du processus** (`process_peak_rss_mb`, cumulé, modèles compris) | 4 656 Mo | 4 041 Mo |
| Rapport `evaluate.py` : code de sortie, `run.verified` | 0, `true` | 0, `true` |

Empreintes complètes (sha256) : `dev-fc/run.json` `d739dea3d12c492679b90ba774ca4a9cb7ea5b9ffdc537fefa31376818267fb5`,
`dev-wh/run.json` `41fa27a1bc17a9e2270f714fe18cc14d2ed6d4008d52e721da4753420362694d`,
`report-dev-fc.json` `976cf20ce2317dadc698320e314e6d3d62148a1657b339749e08d45f98fce725`,
`report-dev-wh.json` `62739836874c007528a8acaf4d661aa4e1ba585ecab2b6b1d317945976da50d0`.
Les journaux des deux lots sont `/root/aqr-ref/out2/dev-fc.log` et `dev-wh.log` (un seul message « error » :
une ligne d'information NeMo `OneLogger … error_handling_strategy`, sans conséquence).

**Paramètres.** Options du lot (`run.json.options`) : `split: dev`, `final: false`, `limit: 0`,
`only_condition: []`, `translation: none`, `device: cpu`. Les autres paramètres sont les défauts du code
(`RecognizeOptions` : segmenteur `recitation`, `batch_size` 8). Seuils du décodeur, lus dans les sorties :
reconnu ≥ 0,75, rival 0,92, fusion ≤ 5,0 s, inférence ≤ 180,0 s (inchangés, provisoires). Rattachement
temporel d'`evaluate.py` : recouvrement ≥ 0,5. Effectif minimal déclaré : 50 versets de référence.
Normalisation `aqr.normalize/1` + `aqr.normalize-strict/1` (utile seulement au WER/CER, non mesuré).

**Modèles** (`models/LOCK.json`, sha256 `5c0834b482385111e3798112ac3e7dcd1a827d5b90fdf913c473eae820f96576`) :
FastConformer `msyukriafifi/fastconformer-quran-ar` @ `b33af7936f9a…` ; segmenteur
`obadx/recitation-segmenter-v2` @ `5ee90364e709…` ; Whisper `tarteel-ai/whisper-base-ar-quran`
@ `5c3c53fdf927…`.

**Matériel et logiciels.** Intel Xeon @ 2,10 GHz, 4 cœurs, 15,7 Gio de RAM, pas de swap, **aucun GPU**
(ni `nvidia-smi` ni `/dev/nvidia*`, `torch.cuda.is_available()` faux, `device: cpu`). Linux 6.18.44,
glibc 2.39, Python 3.11.15, ffmpeg 6.1.1-3ubuntu5. Venv Whisper : torch 2.14.1+cpu, transformers 5.18.0,
silero-vad 6.2.3. Venv FastConformer : torch 2.14.1+cpu, nemo_toolkit 3.0.0, transformers 5.19.0, librosa
0.11.0. Les deux lots ont tourné l'un après l'autre, jamais en parallèle ; aucune autre charge n'a été
lancée volontairement pendant la mesure (non vérifié par un moniteur de charge).

**Commande exacte.** `SP=/tmp/claude-0/-home-user-artist-quran-recognizer/dbb9e1f2-b393-50f9-a3c7-ab36ec75b279/scratchpad`,
depuis la racine du dépôt (`/tmp/claude-0/rb`) :
```bash
export PYTHONPATH=$PWD/src AQR_MODELS_DIR=$SP/models AQR_CACHE_DIR=$SP/qe_cache2 TRANSFORMERS_VERBOSITY=error
C="--manifest tests/fixtures/ref-corpus/manifest.yaml --audio-dir /root/aqr-ref --split dev \
   --corpus-dir /home/user/artist-quran-recognizer/data/corpus"
$SP/venv-nemo/bin/python scripts/recognize_batch.py $C --asr fastconformer --out-dir /root/aqr-ref/out2/dev-fc
$SP/venv/bin/python      scripts/recognize_batch.py $C --asr whisper       --out-dir /root/aqr-ref/out2/dev-wh
for t in fc wh; do $SP/venv/bin/python scripts/evaluate.py \
  --manifest tests/fixtures/ref-corpus/manifest.yaml --predictions /root/aqr-ref/out2/dev-$t \
  --split dev --min-reference-verses 50 --corpus-dir /home/user/artist-quran-recognizer/data/corpus \
  --out /root/aqr-ref/out2/report-dev-$t.json; done
```

**Critères d'acceptation vérifiés sur les sorties réelles** (script de contrôle, hors dépôt) :

| Critère | FastConformer | Whisper |
|---|---|---|
| 82 cas dev par moteur (= les 82 cas `dev` du manifeste) | 82 fichiers, ids = manifeste | 82 fichiers, ids = manifeste |
| Dossiers et rapports distincts, un seul moteur par dossier | 1 moteur distinct dans les sorties, = `run.json.engine` | idem |
| `run.json` : `complete`, planned == done, failed vide | oui (82 / 82 / 0) | oui (82 / 82 / 0) |
| sha256 de chaque `<id>.json` = `run.json.done[id]` | 82 / 82 | 82 / 82 |
| sha256 audio de la prédiction = manifeste | 82 / 82 | 82 / 82 |
| Aucun cas échoué | `failed: {}` | `failed: {}` |
| `run.verified: true` dans le rapport | oui | oui |

`run.verified: true` ne prouve pas à lui seul l'absence de `--allow-unverified-run` : sur un `run.json`
complet, le flag est sans effet et le rapport dit aussi `true`. **Seule la commande citée plus haut**
(sans le flag) l'atteste. Aucun moteur n'a échoué : aucune reprise n'a été nécessaire.

## 2. Reproduction

```bash
python scripts/build_ref_corpus.py --seed 7 --per-scenario 2          # → ~/aqr-ref (hors git)
# UN dossier de sortie par moteur (jamais un dossier partagé)
python scripts/recognize_batch.py --manifest tests/fixtures/ref-corpus/manifest.yaml \
  --audio-dir ~/aqr-ref --split dev --asr fastconformer --out-dir OUT-fastconformer
python scripts/recognize_batch.py --manifest tests/fixtures/ref-corpus/manifest.yaml \
  --audio-dir ~/aqr-ref --split dev --asr whisper --out-dir OUT-whisper
echo $?   # 0 seulement si OUT-*/run.json est « complete » ; 1 = cas en échec ou lot interrompu
python scripts/evaluate.py --manifest tests/fixtures/ref-corpus/manifest.yaml \
  --predictions OUT-fastconformer --split dev --min-reference-verses 50 \
  --out rapport-fastconformer.json
```
Le lot écrit `OUT/run.json` (`aqr.recognition-run/1` : statut, moteur, SHA git, empreinte du manifeste,
`planned` / `done` avec le sha256 de chaque fichier écrit / `failed`) ; au démarrage il supprime
`run.json`, `timings.json` et les `<id>.json` des cas du lot. `evaluate.py` ne lit que les cas listés dans
`done` avec la même empreinte, et refuse (code 2) un lot `running`, `partial`, `interrupted`,
incohérent ou mêlant deux moteurs ; il rend 1 s'il manque un cas évaluable. Un seul lot à la fois par
dossier (verrou `OUT/.lock`, code 2 si pris) ; SIGTERM conclut le lot `interrupted`.
**`--allow-unverified-run` est réservé aux dossiers d'anciennes prédictions SANS `run.json`** (il ne
contourne jamais un `run.json` existant non complet) : il est tracé dans le rapport
(`run: {verified: false, reason}`) et un chiffre obtenu ainsi ne se publie pas comme une mesure
vérifiée. Le split `test` n'est évalué qu'avec `--final` (§ 4).

## 3. Reconnaissance réelle fraîche — split `dev`

### 3.1 Corpus (sources, droits, couverture)

- **Construction** : `scripts/build_ref_corpus.py --seed 7 --per-scenario 2` (PR #40), sur le SHA
  `3702b575be22…` (arbre propre), ffmpeg 6.1.1-3ubuntu5 / libmp3lame 3.100. Manifeste
  `tests/fixtures/ref-corpus/manifest.yaml` sha256 `da8d638d1fbc9bebfd8fbe22722fa244013f69c38fcb4d815c7509aa0a99bc6f` ;
  trace de construction `tests/fixtures/ref-corpus/manifest.build.json` sha256
  `c31864511ce178502109b3f2ff8a6fe6909c446fbca51f57148d9bba04641b6b` (verrous Tanzil `d3f44344…` et
  EveryAyah `d1c306a8…`). Audio dans `/root/aqr-ref` (hors dépôt) : les 130 fichiers du manifeste (82 dev,
  48 test) ont été relus, aucun manquant, tous les sha256 conformes au manifeste.
- **Sources et droits** : clips verset par verset d'EveryAyah, mixés par construction ; droits **non
  établis** (licence canonique « usage interne d'évaluation uniquement, jamais redistribué »). La décision
  d'usage qui permet cette évaluation interne est **PROVISOIRE, en attente de confirmation écrite du
  mainteneur** (`docs/data-lots/ref-corpus-provenance.md`, « Décision d'usage »). Aucun audio ni modèle n'est
  versionné.
- **Vérité terrain** : exacte **par construction** (`origine: mix`, générée, jamais par un modèle), **pas** une
  annotation humaine. La phrase « cas annoté(s) humainement » que `evaluate.py` imprime est inexacte pour ce
  corpus (la règle exempte `origine: mix`) ; ce rapport ne s'en sert pas.
- **Récitants** : Alafasy_128kbps (dev) et Husary_128kbps (test). Abdul_Basit_Murattal_192kbps est **écarté** :
  `bismillah.mp3` absent d'EveryAyah. Un cas de silence synthétique complète le dev.
- **Conditions audio dev** : propre (10 cas), bruit à 20 / 10 / 0 dB de SNR (10 cas chacun), téléphone (10),
  réverbération (10), MP3 32 kbps (10), silence ajouté de 2 s (10), silence pur (2). Scénarios dev :
  arrêt/waqf 8, murattal continu 8, répétition 8, saut de sourate 8, verset 1 avec basmala 16, verset 1 sans
  basmala 8, verset brouillé 8, versets courts avec souffle 16, silence 2.
- **Risque de recouvrement avec l'entraînement** : EveryAyah est probablement dans les données des modèles
  (déduction de contexte, non vérifiée modèle par modèle) → **plafond optimiste**.
- **Non qualifié (aucun essai)** : autres récitants, voix de femme ou d'enfant, microphone, salle réelle,
  parole non coranique parlée (français, hadith, dou'a, khutba : scénarios `assise_fr`, `khutba_citation`,
  `priere`, hors cible français/arabe ignorés faute de clips), riwayas autres que Hafs, audio long,
  **autres sourates et versets longs** (voir « Effectif réel » ci-dessous).
- **Effectif réel et indépendance** (relevé dans le manifeste) : les 232 « versets de référence » du dev sont
  des **entrées** d'annotation. Elles viennent de **10 clips** d'un seul récitant (Alafasy), soit
  **29 entrées**, chacune présente dans **8 copies** du même clip (propre, bruit 20 / 10 / 0 dB, téléphone,
  réverbération, MP3 32 kbps, silence ajouté) : 29 × 8 = 232. Ces entrées couvrent **20 versets distincts de
  5 sourates courtes** (1, 108, 110, 111, 114). Les copies d'un même clip ne sont pas indépendantes :
  **n indépendant ≈ 29** entrées (10 clips), pas 232. Le test historique n'a que 6 clips (20 entrées × 8 =
  160) et 17 versets distincts (sourates 1, 108, 109, 110, 112), récitant Husary.

### 3.2 Effectifs (identiques pour les deux moteurs)

| Dev | |
|---|---|
| Cas | 82 (80 cas à versets + 2 cas de silence sans verset) |
| « Versets de référence » (`n_reference_verses`) = **entrées** d'annotation | 232 = 29 entrées × 8 copies de 10 clips |
| dont entrées de référence au statut `inferred` dans la vérité | 8 (toutes 111:4, scénario « verset brouillé » : audio du verset remplacé par du bruit) |
| Versets distincts / sourates | 20 / 5 (1, 108, 110, 111, 114) |
| n indépendant approximatif | ≈ 29 entrées (10 clips ; les 8 copies d'un clip sont corrélées) |
| Durée audio | 1 752,3 s (29,2 min) |
| Durée de Coran de référence | 1 653,5 s |

### 3.3 Définitions des métriques (renvoi : `docs/EVALUATION-METRICS.md` ; `docs/evaluation/normalisation.md` ne concerne que le WER/CER)

**Seuls les intervalles au statut `recognized` (horodatés) sont des reconnaissances réussies.** `inferred`
(verset déduit d'un trou entre deux versets reconnus), `uncertain` (plusieurs candidats plausibles) et
l'abstention ne comptent **jamais** comme reconnaissance : ni dans le rappel, ni dans « sourate », ni dans
« verset exact », ni dans « plage exacte » (code : `src/aqr/eval/identification.py`, `src/aqr/eval/metrics.py` ;
tests : `test_eval_identification.py`, dont un qui échoue si le filtre de statut est retiré, et
`test_eval_metrics.py`). Ils sont donc comptés à part (lignes « inférés » et « incertains »).

- **Versets reconnus** : nombre d'intervalles `recognized`. **Faux verset** : un reconnu rattaché à aucun
  verset de référence (recouvrement ≥ 0,5, même verset) ; taux = faux / reconnus.
- **Omission** : verset de référence sans reconnu rattaché ; **rappel** = 1 − omissions / versets de
  référence. Causes : `abstention`, `inferred`, `uncertain`, `merged` (une prédiction du bon verset déjà
  rattachée à une autre entrée : ici une prédiction qui couvre les deux plages de mots d'un verset de
  l'arrêt au waqf, 3 cas `arret_waqf` par moteur : bruit 10 dB, bruit 0 dB, réverbération), `non_quran` (le
  moteur a dit « pas du Coran »), `no_output`, `wrong_verse`.
- **Sourate x / N** : N = 216 = entrées attendues des 80 cas à versets, **après fusion des entrées
  consécutives du même verset** ; x = nombre de ces entrées dont **la sourate** a été nommée par au moins
  un `recognized` du même cas (n'importe quel verset de la sourate). N (216) ≠ 232 entrées parce que deux
  scénarios produisent deux entrées consécutives du même verset, fusionnées en une : les **8 cas
  `arret_waqf`** (un verset, 110:2, récité UNE fois, annoté en deux plages de mots 1-3 et 4-7) et les **8
  cas `repetition`** (1:7 entier, puis la reprise de ses mots 5-9) : 8 + 8 = 16, d'où 232 − 16 = 216. Les 2
  cas de silence n'ont aucune entrée (ils sont hors de N). Les 232 sont des entrées, pas des versets
  distincts (20).
- **Verset exact x / N** : même N ; x = versets attendus nommés exactement (sourate:verset) par un `recognized`.
- **Plage exacte x / 80** : cas dont la suite des versets `recognized` (doublons consécutifs fusionnés) est
  identique à la suite attendue, sans verset en trop ni en moins.
- **Faux positifs silence / hors cible** : versets `recognized` dans un cas sans verset attendu (I3, I4).
- **Abstention** : le moteur ne décide pas ; elle n'est jamais un verset. Causes lues dans les sorties :
  `below_threshold` (score sous le seuil), `empty_transcript` (aucun mot arabe), `no_candidate` (aucun
  verset ne ressemble).

### 3.4 Résultats par moteur (dev, 82 cas, 232 versets de référence)

| | FastConformer | Whisper |
|---|---|---|
| **Versets reconnus** (`recognized`, / 232 de référence) | **122** | **117** |
| Versets inférés (`inferred`, intervalles) | 8 | 7 |
| Versets incertains (`uncertain`, intervalles) | 3 | 8 |
| **Faux versets** (/ reconnus ; borne de Wilson **indicative, non indépendante**) | **0 / 122** (0 – 3,05 %) | **0 / 117** (0 – 3,18 %) |
| Omissions (/ 232 entrées ; borne de Wilson indicative, non indépendante) | 110 (47,4 % ; 41,1 – 53,8 %) | 115 (49,6 % ; 43,2 – 56,0 %) |
| Rappel (reconnus corrects / 232) | 52,6 % | 50,4 % |
| Omissions par cause : abstention | 93 | 96 |
| inferred / uncertain | 8 / 3 | 7 / 8 |
| merged / non_quran / no_output / wrong_verse | 3 / 3 / 0 / 0 | 3 / 0 / 1 / 0 |
| Sourate x / 216 | 162 (75,0 %) | 177 (81,9 %) |
| Verset exact x / 216 | 120 (55,6 %) | 117 (54,2 %) |
| Plage exacte x / 80 cas | 31 (38,8 %) | 25 (31,3 %) |
| Cas à versets sans aucun reconnu | 17 / 80 | 18 / 80 |
| Faux positifs silence (2 cas) | 0 | 0 |
| Faux positifs hors cible | non qualifié (0 cas) | non qualifié (0 cas) |
| Intervalles d'abstention : below_threshold / no_candidate / empty_transcript | 107 / 2 / 1 | 105 / 2 / 0 |
| Intervalles `non_quran` (tous `basmala`) | 21 | 24 |
| Durée « abstenue » = (abstention ∪ incertain) ∩ Coran de référence | 539,6 s / 1 653,5 s (32,6 %) | 546,8 s / 1 653,5 s (33,1 %) |
| dont abstentions seules ∩ Coran de référence | 522,5 s (31,6 %) | 500,4 s (30,3 %) |
| Cas échoués | 0 | 0 |

**Bonnes identifications** : 122 (FastConformer) et 117 (Whisper) versets reconnus, tous rattachés à un
verset de référence. **Fausses identifications** : aucune sur les deux moteurs (0 faux verset : 0 `wrong_verse`,
0 `misplaced`, 0 `non_quran_zone`, 0 `unreferenced`). Le moteur préfère s'abstenir (I3) : l'essentiel de
l'écart au rappel est de l'abstention sous le seuil. Le rappel `recognized` plafonne à **224 / 232 =
96,6 %** : les 8 entrées `inferred` de la vérité (toutes 111:4, audio remplacé par du bruit,
`src/aqr/data/mixer.py`) ne sont pas reconnaissables par construction.

**« 0 faux verset » n'est qu'un 0 observé sur ce jeu** : les bornes de Wilson (≈ 3 % au plus haut) supposent
des observations indépendantes, or les 122 / 117 reconnus viennent de copies dégradées de 10 clips (n
indépendant ≈ 29) : ces bornes sont trop optimistes, à lire comme indicatives. **Autres sourates et versets
longs : non qualifié** (20 versets distincts, 5 sourates courtes).

**Ce qui s'abstient sur audio propre** (les 10 clips non dégradés, sorties réelles) : les deux moteurs
s'abstiennent sur 108:1 et 108:2 (`verset1_sans_basmala`). `repetition` (1:7 puis ses mots 5-9) : les deux
reconnaissent une entrée et s'abstiennent sur l'autre. `arret_waqf` (110:2 en deux plages) : FastConformer en
reconnaît une, Whisper aucune. En murattal continu de la Fatiha, FastConformer s'abstient sur 1:3, 1:4, 1:5
et 1:6 ; Whisper reconnaît 1:5 et s'abstient sur 1:3, 1:4 et 1:6. Dans `saut_de_sourate`, FastConformer
s'abstient sur 1:4 et 1:5, Whisper sur 1:4 seulement. Le comportement diffère donc selon le moteur et le
scénario : on ne peut pas le résumer par « les versets courts de la Fatiha restent sous le seuil ».

**Localisation temporelle** (paires des cas à bornes exactes seulement ; tolérance de 300 ou 500 ms selon
le cas ; les paires des cas à bornes approximatives sont exclues : 18 pour FastConformer, 11 pour Whisper) :
début dans la tolérance 81 / 104 (FastConformer) et 85 / 106 (Whisper) ; fin 10 / 104 et 20 / 106 ; écart
médian de début 17,5 ms et 10,0 ms, de fin 803 ms et 741 ms. La fin des versets est mal bornée par les
deux moteurs. **Prudence avant de comparer la localisation entre moteurs** : le moteur Whisper est
`…/times-estimated`, ses temps de mots sont estimés au prorata des lettres du segment
(`src/aqr/adapters/whisper_tarteel.py`), pas mesurés.

### 3.5 Par condition audio (versets reconnus / versets de référence)

| Condition | Cas | Réf. | FastConformer | Whisper |
|---|---|---|---|---|
| Propre | 10 | 29 | 14 | 16 |
| MP3 32 kbps | 10 | 29 | 15 | 17 |
| Bruit 20 dB | 10 | 29 | 15 | 16 |
| Bruit 10 dB | 10 | 29 | 16 | 17 |
| Bruit 0 dB | 10 | 29 | 15 | **3** |
| Téléphone | 10 | 29 | 18 | 16 |
| Réverbération | 10 | 29 | 15 | 16 |
| Silence ajouté 2 s | 10 | 29 | 14 | 16 |
| Silence pur | 2 | 0 | 0 faux positif | 0 faux positif |

Chaque cellule reprend les 29 entrées des mêmes 10 clips sous une condition : des écarts de 1 ou 2 entrées
ne sont pas significatifs. Le décrochage
de Whisper à 0 dB (3 / 29) est le seul écart net entre moteurs par condition ; le bruit n'a pas d'effet net
visible sur le FastConformer sur ce jeu. Non qualifié au-delà de ce bruit synthétique.

### 3.6 Vitesse (CPU, 4 cœurs, sans GPU)

| | FastConformer | Whisper |
|---|---|---|
| Temps de calcul / audio (`evaluate.py`, somme / somme) | 656,9 s / 1 752,3 s | 1 053,0 s / 1 752,3 s |
| **Facteur temps réel** | **0,375** | **0,601** |
| Facteur temps réel hors premier cas | 0,365 | 0,596 |
| Temps par cas : médiane / max | 8,3 s / 21,2 s | 12,2 s / 28,4 s |
| Premier cas | 21,2 s | 14,1 s |
| Pic mémoire **du processus de lot** | 4 656 Mo | 4 041 Mo |

Le premier cas du FastConformer est plus long que la médiane (21,2 s contre 8,3 s), compatible avec un
chargement paresseux des poids ; ce rapport n'établit pas la cause. Le pic mémoire est le `ru_maxrss`
**cumulé du processus** (modèles chargés compris) relevé après chaque cas : c'est un **pic de processus**,
jamais une mesure par extrait ni une « RAM par cas » (le champ s'appelle `process_peak_rss_mb` dans
`timings.json`). `evaluate.py` affiche donc `pic RAM None` : son bloc `vitesse` ne lit le pic que dans des
fichiers de transcription, qui n'existent pas ici.

### 3.7 Comparaison avec l'ancien run dev (premier rapport)

Sur les 82 cas et les deux moteurs, `engine`, `decoder`, `windows` et **tous les intervalles** des nouvelles
sorties sont **identiques** à ceux de l'ancien run (`/root/aqr-ref/out/dev-fc`, `dev-wh`) : mêmes 122 / 117
reconnus, 0 faux verset, mêmes omissions et mêmes taux d'identification. Seuls les temps diffèrent :
facteur temps réel 0,419 → 0,375 (FastConformer) et 0,640 → 0,601 (Whisper), sans cause établie par ce
rapport (les deux séries sont des mesures uniques sur la même machine). L'ancien rapport attribuait une partie
du temps à un chargement paresseux de ≈ 108 s au premier cas ; cette valeur n'est pas retrouvée dans les
artefacts conservés (premier cas de l'ancien `dev-fc/timings.json` : 26,4 s) et n'est plus avancée.

## 4. Résultats historiques non vérifiés pour ce SHA

**Ce sont d'anciennes prédictions, sans `run.json`, produites par la version antérieure du lot, jamais
relancées ici.** Elles ne sont pas des mesures vérifiées pour le SHA testé : elles ont été lues avec
`--allow-unverified-run`, tracé dans les rapports (`run: {verified: false, reason: run.json absent}`).
Indices de cohérence relevés (pas des preuves) : le bloc `engine` et le bloc `decoder` de ces sorties sont
identiques à ceux du run frais, et les 48 sha256 audio correspondent au manifeste (sinon `evaluate.py` aurait
refusé les cas).

**Test réservé : aucune relecture des moteurs** (l'ensemble réservé a déjà été lu une fois). Les anciennes
prédictions `/root/aqr-ref/out/test-fc` et `test-wh` ont seulement été réévaluées :
`evaluate.py --split test --final --allow-unverified-run` (rapports
`/root/aqr-ref/out2/report-test-fc-historique.json`, sha256 `7204f853734c41e1414bf29baaf5aa4f3edc7aca62d145e6d862471a1ba4b893`,
et `report-test-wh-historique.json`, sha256 `ef64b590d2d44ff236dd322f9b32d37e739ca795cb94e50469b80ddd199d5647`).
Les dossiers n'ont pas été modifiés (empreinte des fichiers vérifiée avant et après). **Ces résultats n'ont
servi ni à régler ni à choisir un seuil ; aucun seuil n'a été réglé sur le test.**

| Test (historique, 48 cas, récitant Husary) | FastConformer | Whisper |
|---|---|---|
| « Versets de référence » = entrées (6 clips × 8 copies ; 17 versets distincts) | 160 | 160 |
| Versets reconnus / inférés / incertains (intervalles) | 97 / 0 / 9 | 90 / 0 / 8 |
| Faux versets | 0 / 97 | 0 / 90 |
| Omissions (abstention / uncertain / merged / no_output) | 63 (43 / 9 / 3 / 8) | 70 (51 / 8 / 3 / 8) |
| Rappel | 60,6 % | 56,3 % |
| Sourate x / 144 | 141 | 132 |
| Verset exact x / 144 | 89 | 83 |
| Plage exacte x / 48 | 23 | 20 |
| Cas sans aucun reconnu | 0 / 48 | 2 / 48 |
| Facteur temps réel (champs `timing` des sorties) | 0,308 | 0,496 |

N = 144 : 160 entrées de référence (6 clips × 8 copies) moins 16 entrées consécutives du même verset
fusionnées (8 cas `arret_waqf` sur 1:7 annoté en plages 1-4 / 5-9, 8 cas `repetition` sur 110:2 puis ses
mots 4-7), même règle qu'au § 3.3.

**Ancien libellé corrigé.** Le premier rapport intitulait la ligne « sourate correcte (versets nommés +
incertains) ». C'était faux : le code n'a jamais compté `inferred` ni `uncertain` dans l'identification (ses
nombres, 162/216, 177/216, 141/144, 132/144, sont des nombres de `recognized`). Aucun défaut de code n'a été
trouvé ; seul le libellé était erroné. Les tableaux ci-dessus utilisent la définition correcte et affichent
inférés et incertains à part. Le « ≈ 53 % de rappel » de l'ancien texte correspond bien à 52,6 %
(FastConformer, dev).

## 5. Tests avec doubles

Les tests unitaires (`tests/unit/test_recognize_batch.py`, `test_evaluate_script.py`, `test_eval_*.py`, …)
injectent de faux composants (un `pipeline.run` qui ne rend que des abstentions, des prédictions fabriquées à la
main). Ils vérifient le **protocole** (purge, écriture atomique, `run.json`, refus d'un lot partiel ou mêlant deux
moteurs, définitions des métriques) et **ne mesurent aucune précision de reconnaissance**. Résultat de la
suite complète : voir la description de la PR #41.

## 6. Non mesuré, non qualifié, limites

- **WER / CER : non mesurés.** Aucune transcription `--transcripts` n'existe : ni `aqr recognize` ni les
  adapters n'écrivent la transcription brute de l'ASR. Aucun chiffre n'est produit.
- **RAM** : seul le pic du processus de lot est mesuré (§ 3.6) ; la RAM par extrait n'est pas mesurée.
- **Plafond optimiste** : EveryAyah vraisemblablement vu à l'entraînement ; ne pas lire ces taux comme une
  performance en conditions réelles. Aucune généralisation prouvée.
- **Deux récitants** (Alafasy en dev, Husary en test) ; **aucune parole non coranique parlée** (seul le
  silence pur est testé pour I4) ; **pas d'enregistrement micro réel** ; autres riwayas : non qualifié.
- Vérité terrain construite, bornes de fin approximatives sur une partie des cas (exclues des taux de
  bornes) ; mesures de vitesse uniques (une exécution par moteur), sans intervalle de confiance.
- Effectif réel : 232 entrées = 29 entrées de 10 clips d'un seul récitant × 8 copies dégradées ; **n
  indépendant ≈ 29**, 20 versets distincts de 5 sourates courtes. Les bornes de Wilson ne tiennent pas
  compte de cette dépendance et sont trop optimistes : indicatives seulement. **Autres sourates et versets
  longs : non qualifié.**
- Rappel plafonné à 224 / 232 (96,6 %) par les 8 entrées `inferred` (111:4, audio remplacé par du bruit).
- L'identification d'un verset n'est **pas** une validation du tajwid ni de la qualité de récitation.
- Seuils provisoires, non calibrés par benchmark ; décision d'usage des audios provisoire (§ 3.1).
- Les anciens chiffres de test sont historiques (§ 4) ; le test n'a pas été relu par les moteurs.

## 7. Décision requise du mainteneur (non exécutée)

1. **Confirmer par écrit la décision d'usage** des audios aux droits non établis (provisoire à ce jour).
   Tant qu'elle manque, ces chiffres restent un usage interne d'évaluation, sans publication.
2. **Mesure finale sur le test réservé** : obtenir des prédictions test *vérifiées* (avec `run.json`)
   exigerait de relancer les deux moteurs sur l'ensemble réservé, c'est-à-dire une seconde lecture de cet
   ensemble. Ce n'est pas dans le mandat de cette phase ; **rien n'a été relancé**. À décider : faut-il le
   faire, sur quel SHA figé, et qui lance (`--split test --final`) ?
3. **Généralisation** : toute affirmation hors EveryAyah exige des enregistrements hors corpus annotés à la
   main (lot 1 sous réserve de ses décisions de droits, `docs/data-lots/RIGHTS.md`) : non entrepris.
