# `aqr recognize` — contrat de sortie `aqr.recognition/1`

```bash
aqr recognize FICHIER [--out-dir DIR] [--format json,srt,vtt] [--force] [--translation ID|none]
                      [--asr whisper|fastconformer] [--segmenter recitation|silero]
                      [--allow-fallback-segmenter] [--models-dir D] [--lock models/LOCK.json]
                      [--corpus-dir data/corpus] [--device auto|cpu|cuda] [--batch-size N] [--constrained]
```
Codes : 0 succès · 1 erreur sur les données (fichier absent, sortie déjà présente sans `--force`, extraction
impossible) · 2 utilisation impossible (variable manquante, option indisponible comme `--constrained`).

## JSON (`<fichier>.recognition.json`)
```
{"schema": "aqr.recognition/1",
 "source": {"file", "sha256", "duration_s"},
 "engine": {"asr", "segmenter", "matcher", "decoder", "constrained", "corpus"},
 "decoder": {"min_recognized_score", "uncertainty_ratio", "merge_max_gap_s", "infer_max_gap_s"},
 "timing": {"extract_s", "segment_s", "asr_s", "match_s", "total_s"},
 "windows": N, "warnings": [...],
 "intervals": [ ... ]}      // ordre chronologique
```
Trois sortes d'intervalles :
- `{"kind":"verse","ref":"42:3","words":[1,10],"partial":false,"status":"recognized|inferred|uncertain",
  "t":[a,b]|null,"time_interpolated":false,"confidence":0.97,"candidates":[],"repetition":false,
  "text":..., "translation":{"text","translation_id","version","attribution","scope":"verse"}|null}`
- `{"kind":"non_quran","label":"basmala|istiadha|takbir|amin","t":[a,b]}`
- `{"kind":"abstention","reason":"silence|empty_transcript|no_candidate|below_threshold","t":[a,b],"best_score":0.6}`

## Ce que chaque statut AFFIRME (I3, I5)
- `recognized` : le texte entendu ressemble au verset au-dessus du seuil du décodeur et rien d'aussi bon ne
  le dispute. `t` = le temps des fenêtres du passage (précision limitée par le segmenteur : aucune mesure
  tant qu'il n'y a pas de référence annotée).
- `inferred` : verset **supposé** entre deux versets reconnus (continuité), jamais entendu. `time_interpolated`
  vrai. Jamais une récitation reconnue.
- `uncertain` : plusieurs versets plausibles (`candidates`) ; **ni texte ni traduction** (jamais nommé).
- `inferred` peut recouvrir une abstention qu'il explique (le verset illisible entre deux versets reconnus) : voulu
  (playbook P6) ; les autres intervalles ne se recouvrent pas.
- `abstention` : aucune décision ; ce n'est pas un verset. Les passages non reconnus ne sont jamais couverts
  par le temps d'un verset voisin (une fenêtre écartée interdit la fusion de deux moitiés d'un verset).
- `repetition` : mots redits ; chaque passage garde son propre temps.
- `partial` : plage de mots ; `text` est la sous-chaîne exacte du Mushaf pour ces mots ; la traduction couvre
  le verset entier (`scope: "verse"`).

## Provenance du texte
Texte arabe : corpus Tanzil versionné (`data/corpus/LOCK.json`), jamais l'ASR (I1). Traduction : QuranEnc telle
que reçue, avec id, « version » (identifiant de source : l'API n'en fournit pas) et attribution (I2) ; anomalies
connues : `docs/KNOWN-ISSUES.md` KI-1.

## SRT / VTT
Une ligne par verset (texte du corpus), `[incertain : 55:13 | 55:16]` pour un verset ambigu, `[déduit] …` pour
un verset supposé, `[isti'adha]`, `[takbir]`, `[amin]`, `[basmala]` pour les formules. Les abstentions n'ont
pas de sous-titre.

## Ce qui n'est pas fait
- Décodage contraint sur treillis CTC : algorithme présent (ADR-0005), non branché sur un modèle réel.
- Classification de la parole non coranique au-delà des formules de prière : B3/B5 (phase 7). Une parole
  française ou arabe courante est une abstention (`empty_transcript`, `no_candidate`, `below_threshold`), pas
  une étiquette `french`/`arabic_speech`.
