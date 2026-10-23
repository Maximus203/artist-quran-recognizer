<div align="center">

# artist-quran-recognizer

**Écoute un audio ou une vidéo, trouve chaque verset du Coran récité, dit de quelle seconde à quelle seconde, et affiche le texte exact du Mushaf avec sa traduction. Tout le reste est ignoré.**

[English version](README.en.md) · [Le système en bref](docs/SYSTEME-EN-BREF.md) · [Contribuer](CONTRIBUTING.md) · [Feuille de route](#feuille-de-route)

<img src="docs/assets/demo-surlignage-en-direct.gif" alt="L'atelier web : la récitation avance, le mot récité et sa traduction sont surlignés en direct" width="860">

<sub>L'atelier web pendant l'écoute : le mot prononcé et le fragment de traduction correspondant s'allument en direct. Le texte arabe vient du corpus, jamais d'un modèle.</sub>

</div>

---

> **Où en est le projet.** Le moteur fonctionne de bout en bout sur des fichiers, avec un atelier web de revue.
> La **détection en direct** sur un flux est l'objectif, pas encore une réalité. Aucun fine-tuning n'a été fait.
> **Aucune vérité terrain validée par un humain n'existe encore** : les chiffres de ce dépôt disent « nommé », pas « juste ».
> [Ce que les chiffres ne disent pas](docs/SYSTEME-EN-BREF.md#ce-que-ces-chiffres-ne-disent-pas) · [Appel aux relecteurs](https://github.com/Maximus203/artist-quran-recognizer/issues/87)

## Sommaire

1. [Pourquoi ce projet](#pourquoi-ce-projet)
2. [L'atelier web](#latelier-web)
3. [Comment le moteur fonctionne](#comment-le-moteur-fonctionne)
4. [Les règles qui ne bougent jamais](#les-règles-qui-ne-bougent-jamais)
5. [Ce qui est mesuré, et ses limites](#ce-qui-est-mesuré-et-ses-limites)
6. [Démarrage rapide](#démarrage-rapide)
7. [Organisation du dépôt](#organisation-du-dépôt)
8. [Feuille de route](#feuille-de-route)
9. [Contribuer](#contribuer)
10. [Licence, attributions et limites](#licence-attributions-et-limites)

## Pourquoi ce projet

Une récitation, une prière filmée, un cours qui cite des versets au milieu de commentaires en français ou en wolof : retrouver *quel* verset est dit, *à quel moment*, et le sous-titrer proprement est un travail manuel long. Les outils existants sont fermés, ou obligent à déclarer à l'avance ce que l'on va réciter.

`artist-quran-recognizer` répond à une seule question : **quels versets du Coran sont récités, de quelle seconde à quelle seconde ?** Pour chacun, il restitue le **texte exact du Mushaf** (celui du corpus, pas celui d'un modèle) et la **traduction officielle** (QuranEnc, sans modification), avec un **statut de preuve** (reconnu, supposé ou incertain).

Le principe directeur : **nommer un faux verset est pire que n'en nommer aucun.** Dans le doute, le système s'abstient. Aucun modèle de langue génératif n'intervient dans la chaîne coranique ([ADR-0001](docs/adr/0001-pas-de-llm-generatif.md)).

## L'atelier web

Le dossier [`web/`](web) contient un atelier local (Next.js) pour importer des audios et vidéos, voir ce que le moteur a compris, et **signaler ce qui est faux**. Ces signalements, avec leur plage exacte, servent de cas de test au moteur et, plus tard, de vérité terrain.

<table>
<tr>
<td width="50%"><img src="docs/assets/revue-sombre.jpg" alt="Atelier de revue, thème sombre : forme d'onde, pistes de versets, passage actif et panneau de revue"></td>
<td width="50%"><img src="docs/assets/revue-claire.jpg" alt="Atelier de revue, thème clair"></td>
</tr>
<tr>
<td colspan="2"><sub><b>Revue.</b> La forme d'onde et les pistes partagent un seul repère temporel. La carte du passage affiche l'arabe du corpus, la traduction découpée sur les mots affichés, et le statut de preuve. À droite, le panneau de revue humaine : on trace la plage fautive sur l'onde, on choisit des puces (« verset faux », « début trop tard »…), on valide.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/assets/sessions.jpg" alt="Liste des sessions : file d'analyse, durée, non lus"></td>
<td width="50%"><img src="docs/assets/documentation.jpg" alt="Onglet Documentation : notes de version dans l'atelier"></td>
</tr>
<tr>
<td colspan="2"><sub><b>Sessions et documentation.</b> File d'analyse avec estimation du temps restant, pastille « non lu », favoris, archivage, renommage. L'onglet Documentation affiche les notes de version et les décisions du projet dans l'application.</sub></td>
</tr>
</table>

Ce que l'atelier fait aujourd'hui :

- **Import** de plusieurs audios ou vidéos à la fois (MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, WebM, MP4, MKV, MOV…), ou **enregistrement au micro**. Les analyses passent dans une **file d'attente**.
- **Écoute exacte** : le lecteur joue une copie décodée comme le moteur le décode. Sans cela, un MP3 à débit variable se décale de plusieurs secondes dans le navigateur.
- **Surlignage en direct** du mot récité et du fragment de traduction correspondant, y compris pour une répétition.
- **Longues durées** : forme d'onde calculée côté serveur, défilement par glisser, fenêtres de zoom (fichier entier, 10 min, 2 min, 30 s, 10 s).
- **Revue humaine** : tracer la plage sur l'onde, puces prédéfinies, raccourcis clavier (`M`, `P`, `L`), pack ZIP exportable.
- **Comptes** (mot de passe haché, premier compte = administrateur), sessions **globales ou privées**, préférences enregistrées côté serveur, quotas.
- **Texte coranique en police Hafs** si vous l'installez (voir [Polices](web/README.md#polices)), sinon Amiri Quran. Thèmes clair et sombre, mobile.

Usage prévu : **en local**, sur votre machine. Tout fonctionne hors ligne une fois les modèles téléchargés. Aucun audio n'est envoyé nulle part.

## Comment le moteur fonctionne

```
  fichier audio ou vidéo
        │
  1. EXTRAIRE      ffmpeg → son mono 16 kHz
        │
  2. DÉCOUPER      en morceaux de parole (segmenteur de récitation)
        │
  3. ÉCOUTER       un modèle de reconnaissance (FastConformer) transcrit chaque morceau ;
        │          Whisper et un modèle en flux réécoutent SEULEMENT les morceaux douteux   (ADR-0009)
        │
  4. CHERCHER      la transcription est comparée au texte du Coran : recherche sur le flux
        │          continu des mots, tolérante aux erreurs du modèle                       (ADR-0003, 0004)
        │
  5. CONFIRMER     preuve par la suite : des versets courts qui s'enchaînent se confirment    (ADR-0007)
        │          preuve acoustique : le TEXTE DU CORPUS est réaligné sur le son ;
        │          si l'audio ne le soutient pas, rien n'est nommé                           (ADR-0006, 0008)
        │
  6. COMBLER       un trou entre deux versets reconnus, un début ou une fin manquants :
        │          complétés par ce que l'audio contient réellement                          (ADR-0010, 0013)
        │
  7. DÉCIDER       chaque passage reçoit un statut : reconnu / supposé / incertain / abstention
        │
  8. RESTITUER     arabe du corpus + traduction QuranEnc + temps (début, fin, parfois au mot)
        │
  JSON `aqr.recognition/1`  (+ SRT / VTT)  →  atelier web
```

**L'idée centrale.** Le modèle de reconnaissance ne sert qu'à *localiser*. Il peut mal entendre : on ne lui fait donc jamais écrire le texte final. On cherche dans le corpus ce qui ressemble à ce qu'il a entendu, puis on **vérifie sur le son** que le texte du corpus colle à l'audio (alignement forcé). Si la preuve manque, le système préfère l'abstention.

**Ce que ça change.** Sur de l'audio que les modèles ont probablement vu à l'entraînement, ils retrouvaient 52,6 % des versets alors que la reconnaissance seule en identifie 97 à 100 % : le goulot était la couche de décision, pas le modèle. Toute l'amélioration mesurée depuis vient de cette couche (preuve par la suite, vérification acoustique, cascade, comblement), avec **les mêmes modèles**. Le détail, avec ses sources : [docs/SYSTEME-EN-BREF.md](docs/SYSTEME-EN-BREF.md).

Pour aller plus loin : [architecture](docs/ARCHITECTURE.md), [spécification V1](docs/spec-v1.md), [décisions (ADR)](docs/adr), [contrat de la sortie](docs/RECOGNIZE-OUTPUT.md).

## Les règles qui ne bougent jamais

Chaque contribution les respecte ([AGENTS.md](AGENTS.md), [architecture §1](docs/ARCHITECTURE.md)).

| # | Règle |
|---|---|
| **I1** | Le texte arabe affiché vient **toujours du corpus**, jamais d'un modèle. Aucun LLM génératif dans la chaîne coranique. |
| **I2** | La traduction est celle de **QuranEnc, telle quelle**, avec son identifiant, sa version et son attribution. |
| **I3** | **Nommer un faux verset est pire que n'en nommer aucun.** La précision prime sur le rappel. |
| **I4** | La parole non coranique (français, hadiths, invocations) ne doit produire **aucun verset**. |
| **I5** | Chaque détection porte un **statut de preuve** : reconnu, supposé, incertain. |
| **I6** | La **riwaya** est un paramètre. Seul le Hafs est géré aujourd'hui. |
| **I7** | Chaque brique est **remplaçable** derrière une interface testée. |

## Ce qui est mesuré, et ses limites

| Mesure | Résultat |
|---|---|
| EveryAyah, 3 récitants × 10 sourates (216 versets) | 71,8 % → 91,2 % → 96,8 % → **97,7 %** de versets reconnus selon les briques ajoutées, **0 faux verset** |
| Lot de 12 audios réels (8,7 h) | 618 → 680 → **740** versets nommés (« nommés », pas « justes ») |
| Réimport de 41 audios avec le moteur actuel | **+61 versets distincts, 0 perdu** par rapport à l'ancienne sortie |
| Tafsir en wolof (1 943 fenêtres) | **0 faux verset** |

**Lisez ceci avant de citer un chiffre.** Ce ne sont pas des taux de précision : il n'existe pas de vérité terrain humaine sur l'audio réel. EveryAyah est un plafond optimiste (les modèles l'ont sans doute vu à l'entraînement). Les seuils ne sont pas calibrés sur une vérité humaine. Les courbes de [dégradation](docs/evaluation/courbe-degradation-2026-10-23.md) (bruit, réverbération, MP3, téléphone) et de [vitesse](docs/evaluation/courbe-vitesse-2026-10-23.md) existent, avec leurs limites. Les récitations très mélodiques ou prises en public restent difficiles.

## Démarrage rapide

**Prérequis.** Python ≥ 3.11, [ffmpeg](https://ffmpeg.org) dans le PATH, un GPU NVIDIA conseillé pour la reconnaissance (le CPU fonctionne, lentement). Pour l'atelier web : Node 24 (le stockage utilise `node:sqlite`).

### 1. Installer le moteur et le corpus

```bash
git clone https://github.com/Maximus203/artist-quran-recognizer.git
cd artist-quran-recognizer
python -m venv .venv && . .venv/bin/activate      # Windows : .venv\Scripts\activate
pip install -e ".[dev]"
python scripts/fetch_corpus.py                    # télécharge le texte (Tanzil), vérifié par empreintes
pytest                                            # les tests qui exigent le corpus s'activent ensuite
```

### 2. Reconnaître un fichier en ligne de commande

```bash
pip install -e ".[asr,data]" && pip install --no-deps -e ".[segmenter]"
python scripts/fetch_models.py                    # modèles épinglés → $AQR_MODELS_DIR (hors Git)
aqr recognize cours.mp3 --out-dir sortie          # → sortie/cours.recognition.json (+ .srt, .vtt)
```

GPU récent (RTX 50xx) : installer PyTorch avant l'extra, depuis l'index CUDA 12.8. Options (`--asr`, `--translation`, `--device`, formats) : [docs/RECOGNIZE-OUTPUT.md](docs/RECOGNIZE-OUTPUT.md).

### 3. Lancer l'atelier web

```bash
cd web
npm ci
export AQR_PYTHON="$(pwd)/../.venv/bin/python"    # Windows : $env:AQR_PYTHON = '...\.venv\Scripts\python.exe'
export AQR_MODELS_DIR=/chemin/des/modeles
export AQR_CORPUS_DIR="$(pwd)/../data/corpus"
export AQR_REVIEW_DIR=/chemin/des/donnees-de-revue   # audios, prédictions et revues : hors Git
npm run build && npm run start -- -p 3100
```

Ouvrez `http://127.0.0.1:3100`, créez un compte (le **premier est administrateur**), déposez un audio. Toutes les variables `AQR_*` et la sécurité (hôtes autorisés, inscription, quotas) : [web/README.md](web/README.md).

> N'importez que des audios dont vous avez les droits. **Aucun fichier audio ni modèle n'est versionné** dans ce dépôt.

### Aligner des versets connus (vérité terrain)

```bash
aqr align priere.mp3 --verses "21:51-21:62" --at 46-160
```

On déclare ce qui est récité, l'alignement forcé donne le temps de chaque verset et de chaque mot. Ce n'est pas de la reconnaissance : c'est la brique qui prépare la vérité terrain ([ADR-0006](docs/adr/0006-alignement-force-texte-du-corpus.md)).

## Organisation du dépôt

```
src/aqr/
  domain/          règles et types du projet : n'importe rien d'externe
  corpus/          texte du Coran (Tanzil) et traductions (QuranEnc), lookup par VerseRef
  matching/        recherche des versets dans une transcription
  decoding/        décision : suites, preuve cumulée, comblement de trous
  alignment/       alignement forcé et vérification acoustique
  adapters/        modèles lourds (ASR, segmenteur) derrière les ports du domaine
  models/          registre, verrouillage et téléchargement des modèles (hors Git)
  pipeline/        orchestration d'une analyse, temps au mot, voisins
  rendering/       JSON, SRT, VTT
  translation_align/ découpage de la traduction par fragments
  eval/            mesures et protocoles d'évaluation
  data/            préparation des jeux (fine-tuning), sans entraînement
web/               atelier Next.js (comptes, file d'analyse, revue)
docs/              architecture, décisions (ADR), évaluations, design, notes de version
scripts/           corpus, modèles, mesures, outils de revue
tests/             unitaires, contrats des adapters, intégration
```

La carte complète de la documentation : [docs/README.md](docs/README.md).

## Feuille de route

| Sujet | Où en est-on | Suivi |
|---|---|---|
| **Détection en direct** sur flux WebSocket, **sans plage déclarée** | Conception ([ADR-0011](docs/adr/0011-detection-en-direct-sans-plage.md)) et mesures, rien de codé côté flux | [#84](https://github.com/Maximus203/artist-quran-recognizer/issues/84) |
| **Export de sous-titres** (SRT, VTT, ASS) avec contrôle des passages ambigus | En conception | [#86](https://github.com/Maximus203/artist-quran-recognizer/issues/86) |
| **Vérité terrain humaine** (2 à 3 h d'audio réel validées à l'oreille) | Outil prêt, **relecteurs recherchés** | [#87](https://github.com/Maximus203/artist-quran-recognizer/issues/87) |
| **Fine-tuning** | Pas fait ; conditions et données | [#88](https://github.com/Maximus203/artist-quran-recognizer/issues/88) |
| **Parties non coraniques** : transcrire et traduire le wolof, l'anglais, l'arabe courant en français | Idée tracée, pas l'objectif actuel | [#85](https://github.com/Maximus203/artist-quran-recognizer/issues/85) |

Les tickets accessibles à un premier contributeur sont étiquetés [`good first issue`](https://github.com/Maximus203/artist-quran-recognizer/labels/good%20first%20issue).

## Contribuer

Le projet est ouvert, et il y a du travail à tous les niveaux : relecture à l'oreille (aucun code), tests d'accessibilité, portage Windows des scripts, nouvelles traductions, mesures, moteur de flux. **Lisez [CONTRIBUTING.md](CONTRIBUTING.md)**, c'est court. L'essentiel :

- **Une PR par brique**, vers `develop`. Méthode TDD : un test rouge d'abord. Un bug vu sur un vrai audio devient d'abord un cas de test.
- **Les invariants I1 à I7 ne se négocient pas.** Une PR qui fait écrire l'arabe ou la traduction à un modèle sera refusée.
- **Documentation avec le code** : une PR qui change le comportement ajoute une entrée dans [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md).
- **Jamais** de secret, d'audio, d'enregistrement de personne ou de poids de modèle dans Git.
- Un problème de reconnaissance sur un audio ? Utilisez le [formulaire dédié](https://github.com/Maximus203/artist-quran-recognizer/issues/new/choose) (sans joindre l'audio si vous n'en avez pas les droits).

```bash
pytest && ruff check src tests scripts && ruff format --check src tests scripts && mypy
```

Questions de sécurité : [SECURITY.md](SECURITY.md). Code de conduite : [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence, attributions et limites

- **Licence du code : [MIT](LICENSE)**, pour l'instant. Le mainteneur a décidé que le projet serait **à usage non commercial** et publié sous une licence non commerciale : cette bascule n'est **pas encore faite**. En attendant, ne présumez pas d'un droit d'usage commercial des modèles et jeux de données utilisés (certains sont non commerciaux, voir [CREDITS.md](CREDITS.md)).
- **Texte coranique** : [Tanzil Project](https://tanzil.net) (CC-BY-3.0), téléchargé à la demande, non modifié, non redistribué ici. Conservez le lien vers tanzil.net.
- **Traductions** : [QuranEnc.com](https://quranenc.com), restituées sans modification avec leur source et leur version.
- **Modèles** : téléchargés à la demande sous leurs licences propres (FastConformer, Muno, segmenteur de récitation, Whisper-Tarteel). La liste complète, avec licences : [CREDITS.md](CREDITS.md).
- **Polices** : Amiri Quran, Scheherazade New, Noto Naskh, Instrument Serif et Atkinson Hyperlegible sont embarquées sous SIL OFL 1.1. La police KFGQPC Hafs n'est **pas** redistribuée (voir [web/README.md](web/README.md#polices)).
- **Limites** : Hafs seulement ; une autre lecture est reconnue comme du Hafs et le dit. Ce logiciel est un outil d'aide, pas une autorité : **la lecture du Coran et sa vérification restent humaines**.

Historique des changements : [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md).
