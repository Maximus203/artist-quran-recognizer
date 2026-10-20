# Jeu de données du fine-tuning de l'ASR (étape C)

Préparation des données pour affiner le FastConformer (`msyukriafifi/fastconformer-quran-ar`,
NeMo) : **aucun entraînement ici**. Le jeu sert deux buts (`docs/PLAN.md`, « Direction du
2026-10-19 ») : plus de récitants et de conditions d'enregistrement que le modèle n'en a vu, et de
l'arabe **non coranique** transcrit, pour que le modèle écrive ce qui est dit au lieu de tout
ramener au Coran (il « voit du Coran partout »).

Relevé du 2026-10-19 (API Hugging Face, README bruts, page arXiv, un shard réel téléchargé).
Usage **non commercial** confirmé par le mainteneur : CC BY-NC admissible.

Outil : `scripts/build_finetune_manifest.py` (code : `src/aqr/data/finetune*.py`). Empreintes :
`data/finetune/LOCK.json` (versionné). Fichiers, audio et manifestes : `$AQR_FINETUNE_DIR`, hors
dépôt.

## Sources retenues

| Clé | Dépôt @ révision | Licence | Volume | Locuteurs | Rôle |
|---|---|---|---|---|---|
| `tadabur` | `FaisaI/tadabur` @ `3947e295` | CC BY-NC 4.0 | 384 450 versets, 1 400+ h annoncées, 937,0 Go (385 Parquet) | 618 noms (`sheikh_dict.json`) | récitation |
| `fleurs-ar` | `google/fleurs` @ `70bb2e84` (`ar_eg`) | CC BY 4.0 | train 2 104 phrases / 6,05 h ; validation 295 / 0,87 h ; 1,58 Go | non publiés | arabe lu non coranique |
| `common-voice-ar` | `fsicoli/common_voice_17_0` @ `8262c16b` (`ar`) | CC0 1.0 | train 28 369 clips / 32,4 h ; dev 10 470 / 12,8 h ; 1,04 Go | 23 (train), 61 (dev) | arabe lu non coranique |

Les jeux `test` de FLEURS et de Common Voice ne sont **pas** téléchargés : ils restent disponibles
pour mesurer le rejet du non-Coran (étape D) sur des voix jamais vues.

### Tadabur
- **Dépôt officiel : `FaisaI/tadabur`.** L'article (arXiv 2604.18932, Faisal Alherran, 21 avril
  2026) ne cite pas de dépôt, mais la page du projet (`fherran.github.io/tadabur`) pointe vers
  `huggingface.co/datasets/FaisaI/tadabur` et vers les modèles `FaisaI/tadabur-Whisper-Small`. Le
  dépôt existe depuis le 2025-11-28 (4 168 téléchargements). `MShakir7137/tadabur`, créé le
  2026-07-28 avec le même README et la même licence, est une **copie** : non utilisée.
- **Licence : CC BY-NC 4.0** (champ `license` de la fiche et section « License » du README :
  « For research and educational purposes only. Attribution is required. »). La page arXiv affiche
  CC BY-NC-SA 4.0 : c'est la licence de **l'article**, pas des données. Le README demande aussi un
  usage respectueux (pas de moquerie, pas de synthèse trompeuse) : compatible avec ce projet.
- **Format** : Parquet, une ligne par verset : `audio` (octets WAV, constaté 48 kHz stéréo pour 411
  lignes sur 450, 48 kHz mono 35, 44,1 kHz stéréo 4), `reciter_id`, `surah_id`, `ayah_id`,
  `text_ar_simple` (sans voyelles), `text_ar_uthmani`, `ayah_duration_s`, `metadata` (JSON :
  alignements **par mot**, début/fin, obtenus automatiquement par WhisperX, et nom du fichier).
  Shards de 1 000 lignes (le dernier : 450), récitants **mélangés** dans chaque shard : un
  sous-ensemble de shards est un échantillon de récitants, pas une sélection.
- **Numérotation des sourates à partir de 0** (constat, non documenté) : `surah_dict.json` donne
  « الفاتحة » → 0, et sur le shard réel 449 versets sur 450 correspondent au corpus en lisant
  `surah_id + 1`, **0 sur 450** en lisant `surah_id`. Les versets sont numérotés à partir de 1.
- **Riwaya : rien n'est dit** (ni README, ni résumé de l'article). Le texte est celui de Hafs ;
  des récitations d'une autre riwaya (Warsh, Qalun…) porteraient alors une étiquette fausse.
  Le contrôle de texte ci-dessous ne le détecte pas (il compare le texte annoncé, pas l'audio).
- **Basmala** : sur le shard réel, les 7 versets 1 (hors sourates 1 et 9) sont annoncés **sans**
  basmala ; l'outil suit l'annonce de la source pour chaque verset (voir « Texte cible »).
- Volume complet : 937 Go bruts ; extraits en WAV 16 kHz mono 16 bits, ~1 400 h ≈ **160 Go**.

### Arabe non coranique
- **Common Voice officiel n'est plus sur Hugging Face** : depuis octobre 2025, Mozilla ne le
  distribue que par Mozilla Data Collective (compte et acceptation de conditions), ce qu'un agent ne
  fait pas à la place du mainteneur. Le dépôt `mozilla-foundation/common_voice_17_0` ne contient
  plus qu'un README de redirection. On utilise le **miroir non officiel** `fsicoli/common_voice_17_0`
  (CC0, déclaré « unofficial version of the Mozilla Common Voice Corpus 17 ») : CC0 autorise la
  copie, et la révision et chaque sha256 sont épinglés. Limite : on ne peut pas recouper ces
  empreintes avec la distribution officielle. Pour s'en affranchir, le mainteneur peut télécharger
  la version officielle sur Mozilla Data Collective et l'ajouter comme source (même format tar+TSV).
  Comme le demandent les conditions de Common Voice, on ne cherche jamais à identifier un locuteur
  (le `client_id` n'est gardé que tronqué, comme identifiant de voix pour le découpage).
- **Common Voice arabe contient des versets du Coran lus** : sur le jeu dev réel, **2 047 phrases
  sur 10 470 (19,6 %)** partagent au moins 4 mots consécutifs avec un verset ; elles sont écartées
  (voir « Règles »). Sans ce filtre, on apprendrait au modèle des versets lus sans voyelles, sous
  l'étiquette « non coranique ».
- **FLEURS** (`google/fleurs`, Google, officiel, sans conditions d'accès) : phrases de Wikipédia
  lues, arabe standard (`ar_eg`), découpage officiel train/validation/test. Pas d'identifiant de
  locuteur publié : un pseudo-locuteur par jeu.
- Graphie : ces transcriptions sont presque toujours **sans voyelles**, alors que la cible coranique
  est vocalisée. À trancher à l'entraînement (proportion de non-Coran, éventuel retrait des voyelles
  des deux côtés) ; rien n'est réécrit ici.

## Exclus, et pourquoi

| Quoi | Pourquoi |
|---|---|
| EveryAyah, et les lots Hugging Face qui en dérivent | Droits non établis : la décision d'usage provisoire interdit d'entraîner sur ces audios (`docs/data-lots/ref-corpus-provenance.md`). Le PLAN citait EveryAyah pour C : retiré tant que le mainteneur n'a pas décidé autrement. |
| Lot 1 (`docs/data-lots/lot-1.yaml`) | Même décision ; c'est en outre la future vérité terrain de l'étape A. |
| `RetaSy/quranic_audio_dataset` | Voix de personnes privées, consentement non documenté (même décision). |
| `MShakir7137/tadabur` | Copie non officielle de Tadabur. |
| Jeux `test` de FLEURS et Common Voice | Réservés à la mesure du rejet du non-Coran (étape D). |
| Voix Tadabur des jeux d'évaluation du dépôt | Ci-dessous. |

Voix Tadabur exclues de l'entraînement **et** de la validation (`EXCLUDED_TADABUR_RECITERS`,
`src/aqr/data/finetune_sources.py`) :

| `reciter_id` | Jeu du dépôt | Raison |
|---|---|---|
| 33 | test | Husary : corpus de référence (`Husary_128kbps`, jeu test) ; aussi un cas dev du lot 1 |
| 2 | test | voix d'un cas test du lot 1 |
| 128 | test | voix d'un cas test du lot 1 |
| 63 | dev | Alafasy : corpus de référence (`Alafasy_128kbps`, jeu dev) |
| 86 | dev | voix d'un cas dev du lot 1 |

- Les voix **test** sont exclues par principe (sinon la mesure finale serait faite sur des voix
  apprises). Les voix **dev** le sont aussi, par choix : l'étape C sera comparée sur les données de
  l'étape A et le réglage se fait sur dev ; le coût est de 2 voix sur 618. Aucune voix n'est en
  quarantaine à ce jour (`.artist/decision-log.md`) ; une voix mise en quarantaine plus tard doit
  être ajoutée ici.
- **Méthode pour le lot 1** (récitants anonymisés : aucun nom dans le dépôt) : le titre public de
  chaque vidéo source (YouTube oEmbed) nomme l'imam ou le récitant pour 4 cas sur 12 ; chaque nom a
  été cherché dans `sheikh_dict.json` de la révision épinglée. Seul l'identifiant numérique est
  versionné. **Non résolus** : l'imam d'un cas dev (khutba de Médine, imam non nommé dans le titre)
  et les orateurs et l'assise (prédicateurs francophones, absents d'un corpus de récitants a priori,
  non vérifié). À faire à l'oreille si l'on veut une garantie complète.
- Pour le corpus de référence, la correspondance vient des noms de dossiers EveryAyah déjà présents
  dans `tests/fixtures/ref-corpus/manifest.yaml`.
- Contrôle : `build` refuse de tourner si un identifiant exclu n'existe pas dans `sheikh_dict.json`
  (un identifiant faux n'exclurait rien).

## Règles de construction

- **Texte cible coranique = corpus**, jamais la source : graphie Tanzil `simple` (imla'i vocalisée,
  `data/corpus/quran-simple.txt`, vérifiée par `data/corpus/LOCK.json`), marques de pause retirées.
  Le texte de la source sert seulement à vérifier que la ligne dit bien ce verset (comparaison
  après `normalize_arabic`) ; un écart écarte la ligne (`texte_different_du_corpus`). Sur le shard
  réel : 1 ligne sur 450, une variante d'écriture (« يا ويلتا » pour « يَا وَيْلَتَىٰ », 5:31),
  écartée par prudence.
- **Graphie du modèle** : l'alif suscrit et le tatweel sont retirés de toute cible (récitation et
  non-Coran), car le tokenizer du modèle ne les connaît pas (`<unk>`) ; ce sont les deux seuls
  caractères du corpus dans ce cas (`FinetuneConfig.target_drop_chars`, `finetune-label-qc.md`).
- **Basmala** : Tanzil la colle au verset 1 des sourates (sauf 1 et 9) ; si la source ne l'annonce
  pas, elle est retirée du texte cible.
- **Non coranique** : ponctuation et symboles remplacés par une espace ; une phrase qui garde un
  caractère hors de l'alphabet du corpus (chiffres, lettres latines ou persanes) est écartée
  (`caracteres_hors_alphabet`) : il faudrait verbaliser « 1755 », on n'invente pas sa lecture ; une
  phrase qui contient 4 mots consécutifs d'un verset, ou qui est un verset court entier, est
  écartée (`contient_du_coran`, `FinetuneConfig.quran_ngram`).
- **Durée** : 0,5 à 60 s (`FinetuneConfig`). Sur le shard réel, 60 s garde 97,7 % des heures, 40 s
  92,3 %, 30 s 81,6 %, 20 s 62,9 % (versets longs). La borne d'entraînement dépend de la mémoire GPU
  et se règle dans la configuration NeMo (`max_duration`), pas à l'extraction.
- **Découpage** : un locuteur n'est que d'un côté. Tadabur : tirage par hachage salé
  (`aqr-finetune-v1`) de 2 % des **récitants** en validation (11 identifiants sur 0–743 : 81, 256,
  305, 312, 340, 413, 419, 458, 543, 552, 710) ; FLEURS et Common Voice : découpage officiel (train →
  `train`, dev/validation → `val`). La fusion échoue si un locuteur apparaît des deux côtés.
- **Audio** : décodé, ramené en mono, rééchantillonné à 16 kHz (soxr), écrit en WAV PCM 16 bits.

## Sortie

```
$AQR_FINETUNE_DIR/
  raw/<source>/...                 fichiers épinglés (vérifiés au téléchargement et avant usage)
  audio/<source>/<locuteur>/<id>.wav
  manifests/<source>/train.jsonl   manifestes NeMo
  manifests/<source>/val.jsonl
  manifests/<source>/report.json   retenus / écartés par raison (nombre, heures)
  manifests/<source>/build.json    révision, sha256 des LOCK, SHA git, configuration, exclusions
  manifests/<source>/parts/        une part par fichier source (reprise, élagage)
```

Ligne de manifeste : `audio_filepath` (relatif au manifeste, séparateur `/` : valable sous Windows,
WSL ou Linux ; NeMo le résout depuis le dossier du manifeste), `duration`, `text`, plus `aqr_source`,
`aqr_speaker`, `aqr_ref` (verset `s:v`, ou `null`) pour la traçabilité. Les jeux d'entraînement se
combinent dans la configuration NeMo (liste de manifestes) : la proportion de non-Coran y est un
choix d'entraînement.

Les heures écartées ne sont connues que si la source annonce la durée (Tadabur) ; ailleurs le
rapport compte les lignes (`without_duration`) sans inventer de durée.

## Preuve : échantillon réel du 2026-10-19

Machine du mainteneur, `AQR_FINETUNE_DIR` hors dépôt. Téléchargés par `fetch`, sha256 conformes au
LOCK : `tadabur` `sheikh_dict.json` + `data/train-00384.parquet` (1,08 Go, `efc1e6ba…`),
`fleurs-ar` `parquet-data/ar_eg/validation-00000-of-00001.parquet` (0,20 Go, `8b792937…`),
`common-voice-ar` `transcript/ar/{train,dev}.tsv` + `audio/ar/dev/ar_dev_0.tar` (0,30 Go,
`c3d949e3…`).

| Source (fichier) | Retenus | Écartés |
|---|---|---|
| `tadabur` (shard 384, 450 versets, 1,66 h) | 433 versets, 1,55 h, 160 récitants, tous en `train` (aucun des 11 récitants de validation dans ce shard) | 15 voix exclues (0,08 h : identifiants 2, 33, 86, 128), 1 texte ≠ corpus, 1 > 60 s |
| `fleurs-ar` (validation, 295) | 255 phrases, 0,73 h (`val`) | 40 hors alphabet (chiffres, lettres latines) |
| `common-voice-ar` (dev, 10 470) | 8 395 clips, 9,59 h, 61 locuteurs (`val`) | 2 047 contiennent du Coran, 28 hors alphabet |

## Reproduire

```bash
export AQR_FINETUNE_DIR=~/aqr-finetune            # hors dépôt (refusé s'il est dans le dépôt)
pip install -e ".[finetune]"
python scripts/fetch_corpus.py
python scripts/build_finetune_manifest.py fetch --source tadabur --max-files 1 --dry-run
python scripts/build_finetune_manifest.py fetch --source tadabur --max-files 10
python scripts/build_finetune_manifest.py build --source tadabur --prune-raw
python scripts/build_finetune_manifest.py fetch --source fleurs-ar,common-voice-ar
python scripts/build_finetune_manifest.py build --source fleurs-ar,common-voice-ar
```

`pin` n'est à relancer que pour changer de version (`--repin`) : le LOCK versionné fait foi.

**Disque** : Tadabur complet = 937 Go à télécharger et ~160 Go de WAV. Le poste du mainteneur
(2026-10-19) a 91 Go libres sur C: et 10 Go sur D: : construire par lots (`fetch --max-files N`
puis `build --prune-raw`, qui supprime chaque shard une fois sa part écrite) et prévoir un disque
d'au moins 200 Go pour le jeu complet, ou retenir un sous-ensemble (chaque shard ≈ 3,7 h de
récitants mélangés).

**Mémoire et temps** (mesurés sur le shard de 1,08 Go) : lecture 3,0 Go de mémoire au plus (la
colonne audio du shard est chargée en entier), ~7 Go à prévoir pour un shard de 2,4 Go ;
construction des trois échantillons (450 versets, 295 et 10 470 clips) en 2 min 08 s, téléchargement
des 1,6 Go en 2 min 25 s.

## Risques ouverts (à traiter avant ou pendant l'entraînement)

1. **Étiquettes automatiques** : Tadabur est segmenté et aligné automatiquement (WhisperX, filtre
   ASR). **Traité** : `score` puis `filter` notent chaque exemple par l'alignement forcé du modèle
   de base et écartent la queue (`{train,val}.qc.jsonl`, à donner à NeMo à la place des
   manifestes bruts) ; sur le shard 384, 34 exemples sur 433 écartés, dont 14 segments qui
   débordent sur un verset voisin et 3 tronqués (`finetune-label-qc.md`).
2. **Riwaya** non documentée par Tadabur (ci-dessus). Le contrôle des étiquettes n'en détecte que les
   différences de mots ou de voyelles : une seule sur le shard 384 (6:96, « وجاعل »).
3. **Proportion et graphie du non-Coran** : ~45 h utilisables (Common Voice train + dev, FLEURS) contre
   ~1 400 h de récitation ; transcriptions non vocalisées.
4. **Common Voice** vient d'un miroir non officiel (empreintes non recoupables avec Mozilla).
5. **Lot 1** : correspondance des voix partielle (voir « Exclus »).
6. **Cible avec `<unk>`** : **corrigé** — l'alif suscrit et le tatweel (32 % des étiquettes du shard
   384) sont retirés de la cible (`finetune-label-qc.md`, « Constat »). Reste : l'alignement et la
   porte acoustique paient la même pénalité.
