# Whisper-Tarteel vs FastConformer — accord sur un extrait (2026-10-06)

Statut : **accord entre moteurs, PAS exactitude.** Aucune vérité terrain n'existe : deux moteurs qui s'accordent
peuvent se tromper ensemble, et un désaccord ne dit pas lequel a raison. Aucun taux de précision n'est annoncé et
aucun moteur par défaut n'est choisi sur cette base (décision de la phase 6, avec annotations humaines).

## Pins
| Élément | Valeur |
|---|---|
| Code | branche `claude/asr-comparison` (base `claude/pipeline-recognize` @ `8c8c68f`) ; `develop` @ `d9795b2` |
| Audio | extrait **60–240 s** de `lot1-05` (fichier **dev**, vérifié par empreinte : `docs/evaluation/lot1-fetch-report.json`), converti par `ffmpeg -ss 60 -t 180 -ac 1 -ar 16000` en WAV, sha256 `de01e2d25bccb50fa34c76820752df6f4296e38d7358ce6713d89c7d583366e9` (non versionné) |
| Moteur A | `whisper-base-quran@5c3c53fdf927` (`models/LOCK.json`) |
| Moteur B | `fastconformer-quran@b33af7936f9a`, checkpoint `phase3_full_wer0.0014.nemo` (SHA-256 vérifié par l'adapter), décodeur CTC |
| Segmenteur (identique) | `recitation-segmenter-v2@5ee90364e709` |
| Dépendances | `docs/evaluation/asr-comparison/requirements-nemo.txt` (Python 3.11.15, torch 2.14.1+cpu) |
| Matériel | Intel Xeon 2,1 GHz, 4 cœurs, 15 Gio RAM, **sans GPU** (NeMo : « CUDA is not available », graphes CUDA désactivés) |

## Commandes
```bash
ffmpeg -ss 60 -t 180 -i lot1-05.mp3 -ac 1 -ar 16000 lot1-05_60-240.wav
python -m aqr.cli recognize lot1-05_60-240.wav --asr whisper       --device cpu --translation none --out-dir A
python -m aqr.cli recognize lot1-05_60-240.wav --asr fastconformer --device cpu --translation none --out-dir B
python scripts/compare_engines.py A/…recognition.json B/…recognition.json --out compare.json
```
Sorties expurgées : `docs/evaluation/asr-comparison/` (`compare.json` et les deux sorties sans texte).

## Résultats observés (180 s d'audio, une exécution chacun)
| | Whisper-Tarteel | FastConformer |
|---|---|---|
| Versets `recognized` | 7 | 6 |
| Temps ASR (CPU) | 38,2 s (RTF 0,21) | 9,3 s (RTF 0,05) |
| Temps total (dont segmentation ≈ 58–70 s, identique) | 108,4 s | 67,9 s |

Accord : 6 versets nommés au même endroit par les deux moteurs, **aucun désaccord de verset**. Différences :
- 42:7 mots 17-22 (146,1–157,3 s) : Whisper le nomme ; FastConformer s'abstient (`below_threshold`, meilleur score 0,53).
- Dernière fenêtre (162,5–180,0 s) : Whisper → 42:8 mots 1-8 ; FastConformer → mots 1-9.
Lequel est exact : **inconnu** (non annoté ; écouter ces deux passages en premier).

## Ce que cela montre, et ne montre pas
- Montre : NeMo et le FastConformer **tournent sur CPU** dans ce cloud via `aqr recognize --asr fastconformer`
  (l'hypothèse « NeMo et GPU absents » du rapport précédent était trop forte pour l'inférence ; elle reste vraie pour
  le GPU) ; le FastConformer est ≈ 4× plus rapide en ASR sur cet extrait.
- Ne montre pas : lequel est le plus exact, ni sur d'autres styles (prière, khutba, voix dégradées), ni sur les fichiers
  `test` (non ouverts). Un seul extrait de 3 minutes d'un seul récitant (dev).
- Réserve héritée (`.artist/decision-log.md`, 2026-10-05) : les deux modèles ont été entraînés sur EveryAyah ; ce
  n'est pas une mesure de généralisation.
- Le décodage contraint (ADR-0005) n'a pas été branché sur le treillis du FastConformer : la preuve acoustique reste
  non validée.
