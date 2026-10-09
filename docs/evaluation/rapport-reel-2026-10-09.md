# Évaluation réelle — 2026-10-09

**Code testé** : `develop` @ `1a79e20` + fusion locale (non poussée) des PR #36, #37, #38, #39, #40
(métriques/rapport `aqr.evaluation/2`, corpus de référence, mode web distant). Le pipeline de
reconnaissance est celui de `1a79e20`. **Machine** : Xeon 2,1 GHz, 4 cœurs, CPU seul, 15 Go.
**Modèles** : épinglés par `models/LOCK.json` (FastConformer `b33af79…`, segmenteur `5ee9036…`,
Whisper-Tarteel `5c3c53f…`). **Seuils** (provisoires) : reconnu ≥ 0,75, rival 0,92.

## Reproduction
```bash
python scripts/build_ref_corpus.py --seed 7 --per-scenario 2          # PR #40 → ~/aqr-ref (hors git)
# UN dossier de sortie par moteur : OUT-fastconformer/, OUT-whisper/ (jamais un dossier partagé)
python scripts/recognize_batch.py --manifest tests/fixtures/ref-corpus/manifest.yaml \
  --audio-dir ~/aqr-ref --split dev --asr fastconformer --out-dir OUT-fastconformer
python scripts/recognize_batch.py --manifest tests/fixtures/ref-corpus/manifest.yaml \
  --audio-dir ~/aqr-ref --split dev --asr whisper --out-dir OUT-whisper
echo $?   # 0 seulement si OUT-*/run.json est « complete » ; 1 = cas en échec ou lot interrompu
python scripts/evaluate.py --manifest tests/fixtures/ref-corpus/manifest.yaml \
  --predictions OUT-fastconformer --split dev --min-reference-verses 50 \
  --out rapport-fastconformer.json                                      # test : --split test --final
```
Le lot écrit `OUT/run.json` (`aqr.recognition-run/1` : statut, moteur, SHA git, empreinte du
manifeste, `planned` / `done` avec le sha256 de chaque fichier écrit / `failed`) ; au démarrage il
supprime `run.json`, `timings.json` et les `<id>.json` des cas du lot. `evaluate.py` ne lit que les
cas listés dans `done` avec la même empreinte, et refuse (code 2) un lot absent, `running`,
`partial`, `interrupted` ou mêlant deux moteurs ; il rend 1 s'il manque un cas évaluable.
`--allow-unverified-run` est réservé aux dossiers d'anciennes prédictions SANS `run.json` (il ne
contourne jamais un `run.json` existant non complet) : il est tracé dans le rapport
(`run: {verified: false, reason}`) et ne doit pas servir à un chiffre publié. Un seul lot à la fois
par dossier de sortie (verrou `OUT/.lock`, code 2 si pris) ; SIGTERM conclut le lot `interrupted`.
`timings.json` donne `process_peak_rss_mb` : pic CUMULÉ du processus, pas celui d'un cas.
**Les chiffres de la section suivante datent d'avant ce protocole** (dossiers sans `run.json`, donc
sans garantie d'origine des fichiers) : ils sont à refaire avec un lot vérifié avant toute
citation.

## Résultats (corpus : audio EveryAyah mixé/dégradé, vérité exacte construite)
| | dev FastConformer | dev Whisper | test FastConformer | test Whisper |
|---|---|---|---|---|
| cas / versets de référence | 82 / 232 | 82 / 232 | 48 / 160 | 48 / 160 |
| versets reconnus | 122 | 117 | 97 | 90 |
| **faux versets** | **0** | **0** | **0** | **0** |
| omissions (surtout abstention sous seuil) | 110 | 115 | 63 | 70 |
| sourate correcte (versets nommés + incertains) | 162/216 | 177/216 | 141/144 | 132/144 |
| verset exact | 120/216 | 117/216 | 89/144 | 83/144 |
| faux positifs silence / hors cible | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| facteur temps réel (CPU) | 0,42 | 0,64 | 0,31 | 0,50 |

Rappel observé ≈ 53 % (dev, FastConformer) : le moteur préfère s'abstenir (I3). Sur audio propre,
les versets très courts et répétitifs (Fatiha 1:3–1:6) restent sous le seuil.
Le facteur temps réel du dev inclut le chargement paresseux des modèles du premier cas (≈ 108 s).

## Limites (à lire avant toute conclusion)
- **Plafond optimiste** : les modèles ont très probablement vu EveryAyah. Aucune généralisation prouvée.
- 2 récitants seulement (Alafasy en dev, Husary en test) ; aucune parole non coranique parlée
  (seul le silence pur est testé pour I4) ; pas d'enregistrement micro réel.
- WER/CER et pic RAM : **non mesurés** (le CLI n'écrit pas la transcription brute ni la RAM).
- Pas de base de comparaison antérieure : la seule comparaison est Whisper vs FastConformer.
- L'identification d'un verset n'est **pas** une validation du tajwid ni de la qualité de récitation.
- Le test réservé a été lu une seule fois (`--final`) ; aucun seuil n'a été réglé dessus.
