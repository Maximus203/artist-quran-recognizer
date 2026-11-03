# Crédits et licences

Ce projet repose sur le travail d'autres personnes. Cette page liste ce qu'il utilise et sous quelle licence. Les modèles et données sont **téléchargés à la demande** : ils ne sont pas dans ce dépôt, et chacun reste sous sa propre licence.

## Texte et traductions

| Élément | Source | Licence / règle |
|---|---|---|
| Texte coranique (Uthmani, simple) | [Tanzil Project](https://tanzil.net) | CC-BY-3.0. Texte non modifié, non redistribué ici, lien vers tanzil.net à conserver. |
| Traductions | [QuranEnc.com](https://quranenc.com) | Restituées sans modification, avec identifiant, version et attribution. |

## Modèles (téléchargés à la demande, hors Git)

| Modèle | Usage | Licence |
|---|---|---|
| `msyukriafifi/fastconformer-quran-ar` | reconnaissance principale | CC-BY-4.0 |
| `Muno459/fastconformer-quran-streaming` | réécoute des fenêtres douteuses | NPL-1.1 (**usage non commercial**) |
| `obadx/recitation-segmenter-v2` | découpage de la récitation | MIT |
| `tarteel-ai/whisper-base-ar-quran` | réécoute des fenêtres douteuses | Apache-2.0 |

## Données préparées pour un éventuel fine-tuning (aucun entraînement n'a été fait)

Tadabur (CC BY-NC 4.0), FLEURS (CC BY 4.0), Common Voice (CC0). Détail : [docs/evaluation/finetune-data.md](docs/evaluation/finetune-data.md). EveryAyah sert de jeu de mesure, avec ses limites ([docs/TEST-CORPUS.md](docs/TEST-CORPUS.md)).

## Polices

Embarquées dans `web/public/fonts/` avec leur texte de licence, sous SIL OFL 1.1 : Amiri Quran, Scheherazade New, Noto Naskh Arabic, Instrument Serif, Atkinson Hyperlegible Next et Mono. La police **KFGQPC Uthmanic Hafs** (Complexe du Roi Fahd) n'est **pas** redistribuée : chaque utilisateur l'installe localement s'il y a droit.

## Logiciels

Python, NeMo, PyTorch, Transformers, ONNX Runtime, ffmpeg, Next.js, React, SQLite (`node:sqlite`) et leurs dépendances, sous leurs licences respectives.

## Licence du code de ce dépôt

[MIT](LICENSE) aujourd'hui. Le mainteneur a décidé d'un usage **non commercial** et d'une publication sous une licence non commerciale ; la bascule n'est pas faite. Ne présumez pas d'un droit d'usage commercial de l'ensemble : le modèle Muno et certaines données l'interdisent déjà.
