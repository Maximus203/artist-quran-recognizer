# Essais v0 sur le lot 1 (2026-10-06) — rapport expurgé et reproductible

Statut : **observations sans vérité terrain**. Aucun des 12 fichiers n'est annoté (`expected: []`,
statut `a_annoter`) : aucun taux de précision, de rappel ni d'erreur de limites n'est calculable ici.
Ce document dit ce qui a tourné, avec quoi, combien de temps, et ce qui est (ou non) vérifiable.

## 1. Données — vérification par empreinte
- Dataset : `printf0cherif/aqr-audio-private`, **public** au 2026-10-06 (`private:false`, `gated:false`),
  révision épinglée `f00ebced79755213c0d2050566126602454f5517` (2 commits : « initial commit »,
  « Upload 12 files »). Tête du dataset non avancée au moment de la vérification.
- Commande : `python scripts/fetch_public_lot.py --lot 1 --dest <dir> --check-head --report docs/evaluation/lot1-fetch-report.json`
  (aucun jeton ; URL = `.../resolve/<révision>/<id>.mp3`).
- Résultat : **12/12 fichiers conformes** au SHA-256 de `docs/data-lots/lot-1.yaml` (qui égale
  l'empreinte LFS annoncée par Hugging Face), 714 058 382 octets, 31 291,9 s = 8,692 h.
  Détail : `docs/evaluation/lot1-fetch-report.json`. Tests : `tests/unit/test_data_lot_fetch.py`.
- Droits : voir `docs/data-lots/RIGHTS.md` (contradiction à trancher par Cherif).

## 2. Code, modèles, dépendances, matériel
| Élément | Valeur |
|---|---|
| Code des adapters/matcher/décodeur | `develop` @ `d9795b2d826a50a6509db50e6437109f4150ffc6` |
| Script d'essai | `scripts/repro/lot1_trial_v0.py` (sha256 `d75664642c92…`, = script ad hoc de la session, racine du dépôt adaptée) |
| ASR | `tarteel-ai/whisper-base-ar-quran` @ `5c3c53fdf9272c4f6ee0bee09a1e5a4a615ee25c` (`pytorch_model.bin` vérifié contre `models/LOCK.json`) |
| Segmenteur | `obadx/recitation-segmenter-v2` @ `5ee90364e7090ea6eb9dffe80353bed06996a196` (vérifié) ; repli Silero 6.2.3 seulement pour l'extrait de comparaison |
| FastConformer | **non exécuté** (NeMo et GPU absents) |
| Corpus | Tanzil Hafs, `data/corpus/LOCK.json` (SHA-256 vérifiés au chargement) |
| Dépendances | `docs/evaluation/trials/requirements-trials.txt` (venv Python 3.11.15, torch CPU) |
| Matériel | cloud : Intel Xeon 2,1 GHz, 4 cœurs (1 thread/cœur), 15 Gio RAM, **sans GPU** ; ffmpeg 6.1.1 |
| Réglages | décodeur : `min_recognized_score=0.75`, `uncertainty_ratio=0.92` ; découpe dure des segments > 25 s (ad hoc, 8 découpes sur lot1-05, 0 ailleurs) |

## 3. Commandes
```bash
python scripts/fetch_models.py --only whisper-base-quran,recitation-segmenter --models-dir $M
python scripts/fetch_public_lot.py --lot 1 --dest $A
PYTHONPATH=src SEG=v2 python scripts/repro/lot1_trial_v0.py $A/lot1-05.mp3 out.json $M 0 0
python scripts/repro/redact_trial.py out.json > docs/evaluation/trials/lot1-05.v0.json
```
(`SEG=silero` ou absent : repli Silero. `$M` = dossier des modèles, `$A` = dossier des audios, hors dépôt.)

## 4. Résultats observés (sorties expurgées : `docs/evaluation/trials/lot1-NN.v0.json`)
| Fichier | Durée audio | Calcul total | Segments | Segments au-dessus du seuil | Détections |
|---|---|---|---|---|---|
| lot1-05 (C01, dev) | 1 709,0 s | 627 s | 89 | 78 | 39 : 38 recognized, 1 uncertain |
| lot1-06 (C08, dev) | 3 128,6 s | 1 983 s | 365 | 335 | 264 : 263 recognized, 1 inferred |
| lot1-09 (C09, dev) | 1 800,0 s | 1 546 s | 1 092 | 4 | 4 : 3 recognized, 1 uncertain |

Détail du calcul (s) : lot1-05 extraction 7,4 · segmentation 368,5 · ASR 249,1 · recherche 0,2 ;
lot1-06 : 13,0 · 670,8 · 1 296,2 · 0,6 ; lot1-09 : 7,3 · 388,2 · 1 146,3 · 0,7.
Facteurs temps réel (CPU) : 0,37 / 0,63 / 0,86.

Observations de cohérence interne (**ce ne sont pas des mesures d'exactitude**) :
- lot1-05 : sourate 42, versets 3 → 40 contigus, sans verset manquant ; basmala initiale `uncertain`
  (1:1 ou 27:30, textes identiques).
- lot1-06 : 1:2 → 1:7, puis 21:51 → 21:112, 22:1 → 22:78, 23:1 → 23:118, sans manquant ni doublon, un
  verset `inferred` (21:106, jamais présenté comme reconnu). Cohérent avec le titre public de la source
  (déclaré par un tiers, non vérifié).
- lot1-09 (assise en français) : 4 détections sur 1 092 fragments ; aucun verset dans les passages de
  parole arabe courante. Les 3 `recognized` (11:106-108) et le `uncertain` ne sont pas vérifiés : le
  fichier n'est pas annoté.

## 5. Limites
- Pas de vérité terrain : l'exactitude, les omissions et les erreurs de limites restent inconnues.
- Whisper-Tarteel : temps de mots estimés ; seule la limite de segment est mesurée.
- Segmenteur sur CPU : ≈ 0,22 de temps réel ; ASR CPU : 0,15 à 0,64 ; sur GPU, les chiffres seront autres.
- Un seul passage par fichier : pas de mesure de variabilité.
- Les fichiers `test` (02, 07, 08, 10, 11) n'ont pas été ouverts.
