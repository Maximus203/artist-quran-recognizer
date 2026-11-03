# `aqr recognize` sur le lot 1 — exécutions réelles (2026-10-06)

Statut : **observations sans vérité terrain**. Aucun fichier du lot n'est annoté : aucun taux de précision, de
rappel ni d'erreur de limites n'est calculable. Ce document dit ce qui a tourné, avec quoi, en combien de temps.

## Pins
| Élément | Valeur |
|---|---|
| Code exécuté | branche `claude/pipeline-recognize` @ `5510dc076102ac47e40cc9e413ca1ad5449ffefa` (commits suivants : docs et expurgation seulement) |
| Base | `develop` @ `d9795b2d826a50a6509db50e6437109f4150ffc6` |
| Audios | dataset `printf0cherif/aqr-audio-private` @ `f00ebced79755213c0d2050566126602454f5517`, téléchargés par `scripts/fetch_public_lot.py` (PR #25) : **12/12 SHA-256 conformes** (`docs/evaluation/lot1-fetch-report.json`) ; les 3 fichiers ci-dessous en font partie |
| ASR | `whisper-base-quran@5c3c53fdf927` (vérifié contre `models/LOCK.json`) |
| Segmenteur | `recitation-segmenter-v2@5ee90364e709` (vérifié) ; **aucun repli Silero** |
| Corpus | Tanzil Hafs, SHA-256 épinglés `data/corpus/LOCK.json` ; traduction `french_hameedullah` (QuranEnc, telle que reçue) |
| Dépendances | `docs/evaluation/trials/requirements-trials.txt` (PR #25), Python 3.11.15, torch 2.14.1+cpu |
| Matériel | cloud : Intel Xeon 2,1 GHz, 4 cœurs, 15 Gio RAM, **sans GPU** ; ffmpeg 6.1.1 |

## Commande
```bash
export AQR_MODELS_DIR=$M  PYTHONPATH=src
python -m aqr.cli recognize $A/lot1-05.mp3 --out-dir $OUT --format json,srt,vtt --device cpu
python scripts/repro/redact_recognition.py $OUT/lot1-05.recognition.json \
    > docs/evaluation/trials/cli/lot1-05.recognition.redacted.json
```
Sorties versionnées : `docs/evaluation/trials/cli/lot1-NN.recognition.redacted.json` (sans texte ni traduction).

## Résultats observés
| Fichier | Durée audio | Calcul | Fenêtres | Détections | Abstentions | Non coranique | Temps couvert par des versets reconnus |
|---|---|---|---|---|---|---|---|
| lot1-05 (C01, dev) | 1 709,0 s | 763 s | 89 | 53 `recognized` | 12 `below_threshold` | 1 basmala | 1 210 s |
| lot1-06 (C08, dev) | 3 128,6 s | 2 068 s | 365 | 278 `recognized`, 1 `inferred` | 27 `below_threshold`, 1 `no_candidate` | 2 takbir | 2 900 s |
| lot1-09 (C09, dev) | 1 800,0 s | 1 616 s | 1 092 | 3 `recognized`, 1 `uncertain` | 731 `no_candidate`, 357 `below_threshold` | 0 | 10 s |

Détail du calcul (s) : lot1-05 : extraction 7,5 · segmentation 430,7 · ASR 320,7 · recherche 0,2 ; lot1-06 : 13,7 ·
630,9 · 1 419,0 · 0,7 ; lot1-09 : 7,4 · 356,7 · 1 248,2 · 0,6. Facteurs temps réel (CPU) : 0,45 / 0,66 / 0,90.

Cohérence interne (**pas une mesure d'exactitude**) :
- lot1-05 : sourate 42, versets 3 à 40, sans verset manquant ; 4 répétitions (42:13, 42:16, 42:19, 42:24) ;
  28 passages partiels ; la basmala d'ouverture est étiquetée `non_quran/basmala` (v0 : `uncertain` 1:1 | 27:30) ;
  l'isti'adha initiale (0,85–6,0 s) reste une abstention : l'ASR l'a transcrite « فعلوا الله من الشيطان الرجيم »,
  la formule n'est pas reconnue et le meilleur candidat (16:98, 0,58) n'est pas nommé.
- lot1-06 : 1:2 → 1:7, puis 21:51 → 23:118 ; seul 21:106 manque et il est `inferred` (jamais présenté comme reconnu) ;
  2 takbir au début ; 11 répétitions. Cohérent avec le titre public de la source (déclaré par un tiers).
- lot1-09 (assise en français) : 1 088 fenêtres sont des abstentions ; les 3 versets reconnus (11:106-108) et
  l'`uncertain` ne sont pas vérifiés (fichier non annoté).

## Écarts par rapport aux essais v0 (`docs/evaluation/lot1-trials.md`)
- Plus de détections : la fusion des moitiés d'un verset est désormais limitée (écart ≤ `merge_max_gap_s` = 5 s, et
  jamais au-dessus d'une fenêtre écartée) ; les longues pauses de la récitation de lot1-05 donnent donc des
  détections partielles distinctes (ex. 42:5 : mots 1-13 puis 14-19) au lieu d'une seule dont le temps couvrait un
  intervalle non reconnu. Le seuil (5 s) est **provisoire**, à calibrer sur des annotations humaines.
- Les abstentions sont explicites (v0 : fenêtres simplement absentes de la sortie).
- Fenêtres : coupe aux creux d'énergie, pas à intervalle fixe (v0).

## Particularité à connaître
- Un verset `inferred` peut recouvrir une abstention qu'il explique (lot1-06 : 21:106 inféré sur 662,9–669,7 s ; la
  fenêtre illisible 663,3–669,6 s est une abstention). C'est voulu (playbook P6) : l'hypothèse n'est jamais « reconnue »
  et reste marquée `time_interpolated`. Un évaluateur doit traiter ce recouvrement, pas le compter comme erreur.

## Limites
- Pas de vérité terrain ; une seule exécution par fichier (aucune variabilité estimée) ; CPU seulement ; Whisper-Tarteel
  uniquement (temps de mots estimés : seules les limites de fenêtre sont mesurées).
- FastConformer et le décodage contraint n'ont pas été exécutés (voir `docs/adr/0005-…`).
- Les fichiers `test` du lot (02, 07, 08, 10, 11) n'ont pas été ouverts.
