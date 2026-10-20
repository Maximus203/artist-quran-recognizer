# `aqr recognize` — contrat de sortie `aqr.recognition/1`

```bash
aqr recognize FICHIER [--out-dir DIR] [--format json,srt,vtt] [--force] [--translation ID|none]
                      [--asr whisper|fastconformer|muno-streaming] [--segmenter recitation|silero]
                      [--allow-fallback-segmenter] [--models-dir D] [--lock models/LOCK.json]
                      [--corpus-dir data/corpus] [--device auto|cpu|cuda] [--batch-size N] [--constrained]
                      [--no-acoustic-check]
```
Codes : 0 succès · 1 erreur sur les données (fichier absent, sortie déjà présente sans `--force`, extraction
impossible) · 2 utilisation impossible (variable manquante, option indisponible comme `--constrained`).

## JSON (`<fichier>.recognition.json`)
```
{"schema": "aqr.recognition/1",
 "source": {"file", "sha256", "duration_s"},
 "engine": {"asr", "segmenter", "matcher", "decoder", "constrained", "corpus", "acoustic"},
 "decoder": {"min_recognized_score", "uncertainty_ratio", "merge_max_gap_s", "infer_max_gap_s",
             "chain_evidence_words", "acoustic_min_llr_per_frame"?, "acoustic_rescue_min_quality"?},
 "timing": {"extract_s", "segment_s", "asr_s", "match_s", "acoustic_s"?, "total_s"},
 "windows": N, "warnings": [...],
 "acoustic_checks": [{"kind":"chain|continuation", "t":[a,b], "verses":"55:1[5-5],55:2[1-2]",
                      "llr_per_frame":-0.43|null, "accepted":true, "text_similarity"?:0.92}],
 "intervals": [ ... ]}      // ordre chronologique
```
`engine.acoustic` nomme le modèle CTC qui vérifie les suites (ADR-0008), vide s'il n'y en a pas (poids
du FastConformer absents : signalé dans `warnings` ; ou `--no-acoustic-check`). Les champs marqués `?` n'existent
qu'avec lui. `acoustic_checks` trace chaque vérification : `chain` (suite de versets) ou `continuation` (suite d'un verset
commencé, prédite puis alignée sur la fenêtre suivante), son passage, le texte du corpus aligné (syntaxe de
`aqr align --verses`), la preuve (`null` : le texte ne tient pas dans le passage), pour une suite de verset la
similarité avec la transcription de la fenêtre (second témoin exigé), et la décision. Diagnostic : une
vérification acceptée n'est pas une vérité terrain.
Trois sortes d'intervalles :
- `{"kind":"verse","ref":"42:3","words":[1,10],"partial":false,"status":"recognized|inferred|uncertain",
  "t":[a,b]|null,"time_interpolated":false,"confidence":0.97,"candidates":[],"repetition":false,
  "text":..., "translation":{"text","translation_id","version","attribution","scope":"verse"}|null}`
- `{"kind":"non_quran","label":"basmala|istiadha|takbir|amin","t":[a,b]}`
- `{"kind":"abstention","reason":"silence|empty_transcript|no_candidate|below_threshold","t":[a,b],"best_score":0.6}`

## Ce que chaque statut AFFIRME (I3, I5)
- `recognized` : le texte entendu ressemble au verset au-dessus du seuil du décodeur (seul, ou par la suite de
  versets qu'il continue, ADR-0007) et rien d'aussi bon ne le dispute ; avec `engine.acoustic`, une suite n'est
  retenue que si l'audio soutient le texte du corpus de la suite (ADR-0008). `t` = le temps de l'alignement
  forcé de ce texte (au mot près, trame de 80 ms) quand l'audio le soutient, sinon le temps des fenêtres du
  passage ; `time_interpolated` vrai si une coupure entre deux versets d'une même fenêtre est estimée.
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
- Décodage contraint sur treillis CTC (`--constrained`, ADR-0005) : la reconnaissance vérifie et horodate les
  candidats du matcher sur le treillis (ADR-0008), mais ne cherche pas elle-même un verset dans le treillis.
- Classification de la parole non coranique au-delà des formules de prière : B3/B5 (phase 7). Une parole
  française ou arabe courante est une abstention (`empty_transcript`, `no_candidate`, `below_threshold`), pas
  une étiquette `french`/`arabic_speech`.
