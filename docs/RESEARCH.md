# État de l'existant (recherche du 2026-09-24)

Décision issue de cette recherche : **ni entraînement de zéro, ni fine-tuning d'un LLM
arabe.** On assemble des briques existantes derrière des ports, on les compare par
benchmark, et on ne fine-tune (plus tard) que l'ASR, sur les conditions où il échoue.
Voir `adr/0001`.

## Candidats par brique

| Brique | Candidat | Licence | Notes |
|---|---|---|---|
| ASR Coran | [msyukriafifi/fastconformer-quran-ar](https://huggingface.co/msyukriafifi/fastconformer-quran-ar) | CC-BY-4.0 | NVIDIA FastConformer hybride RNNT/CTC, 115 M params, fine-tuné sur EveryAyah, WER validation 0,14 %. Mauvais hors Coran (attendu). NeMo. |
| ASR Coran | [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran), [tiny](https://huggingface.co/tarteel-ai/whisper-tiny-ar-quran), [faster-whisper](https://huggingface.co/OdyAsh/faster-whisper-base-ar-quran) | ouvert | Challenger. Whisper → timestamps mots moins fiables que CTC. |
| ASR Coran | [IJyad/whisper-large-v3-Tarteel](https://huggingface.co/IJyad/whisper-large-v3-Tarteel) | à vérifier | Gros modèle, à benchmarker. |
| ASR phonèmes | [quran-dev/wav2vec2-ctc-quran-phoneme…](https://huggingface.co/quran-dev/wav2vec2-ctc-quran-phoneme-run66-iqratts-mix-final-20260909) | à vérifier | Piste pour Warsh / tajwid (niveau phonème). |
| Identification | [Tilawi/quran-asr](https://github.com/Tilawi/quran-asr) | MIT (code) | Référence de conception : décodage CTC + porte de confiance. 599/600 versets, 0 faux. En TypeScript : on s'en inspire, on ne l'embarque pas. |
| Segmentation | [obadx/recitation-segmenter-v2](https://huggingface.co/obadx/recitation-segmenter-v2) | MIT | Wav2Vec2-BERT, pauses/waqf à 20 ms, F1 0,996, ~3 Go de VRAM. Lié à arXiv:2509.00094. |
| Alignement | [cpfair/quran-align](https://github.com/cpfair/quran-align), [HsnSaboor/quran-forced-align](https://github.com/HsnSaboor/quran-forced-align) | ouvert | Timestamps mot à mot. |
| Benchmark | [QUD-Technologies/quran-alignment-benchmark](https://github.com/QUD-Technologies/quran-alignment-benchmark) | ouvert | 16 enregistrements, 357 min, prière/bruit/répétitions. Leaderboard vide : on peut y soumettre. |
| Données | [tarteel-ai/everyayah](https://huggingface.co/datasets/tarteel-ai/everyayah), [Tadabur](https://arxiv.org/html/2604.18932v1), [MohamedRashad/Quran-Recitations](https://huggingface.co/datasets/MohamedRashad/Quran-Recitations) | variées | Matière pour les montages synthétiques. |
| Texte | Tanzil (Uthmani, Hafs) | CC-BY-3.0 | Source de vérité. Épingler version + checksum. |
| Traductions FR | [QuranEnc](https://quranenc.com/fr/browse/french_hameedullah) — Hamidullah (révision du Complexe du Roi Fahd), Rachid Maach, Centre Nûr | redistribution **sans modification**, mention de la source + version | API et export disponibles. |

## Ce qu'aucun modèle ne fait tel quel (= notre valeur ajoutée)

1. Rejet fiable de l'arabe **non coranique** (hadiths, dou'a) → B5 QuranicityGate.
2. Décodage de séquence avec sauts, répétitions et versets **déduits** → B7.
3. Timeline unifiée Coran / non-Coran exploitable pour le sous-titrage (V2).
