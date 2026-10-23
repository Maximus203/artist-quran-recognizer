# `aqr recognize` — contrat de sortie `aqr.recognition/1`

```bash
aqr recognize FICHIER [--out-dir DIR] [--format json,srt,vtt] [--force] [--translation ID|none]
                      [--asr cascade|fastconformer|whisper|muno-streaming] [--segmenter recitation|silero]
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
             "chain_evidence_words", "acoustic_min_llr_per_frame"?, "acoustic_rescue_min_quality"?,
             "neighbor_max_overlap_words"?, "neighbor_max_gap_words"?},
 "timing": {"extract_s", "segment_s", "asr_s", "match_s", "acoustic_s"?, "relisten_s"?, "total_s"},
 "windows": N, "warnings": [...],
 "cascade"?: {"secondary": [...], "relistened_windows": N, "rescued_windows": N},
 "acoustic_checks": [{"kind":"chain|continuation|relisten|neighbor|head", "t":[a,b], "verses":"55:1[5-5],55:2[1-2]",
                      "llr_per_frame":-0.43|null, "accepted":true, "text_similarity"?:0.92}],
 "intervals": [ ... ]}      // ordre chronologique
```
`engine.acoustic` nomme le modèle CTC qui vérifie les suites (ADR-0008), vide s'il n'y en a pas (poids
du FastConformer absents : signalé dans `warnings` ; ou `--no-acoustic-check`). Les champs marqués `?` n'existent
qu'avec lui. `acoustic_checks` trace chaque vérification : `chain` (suite de versets) ou `continuation` (suite d'un verset
commencé, prédite puis alignée sur la fenêtre suivante), son passage, le texte du corpus aligné (syntaxe de
`aqr align --verses`), la preuve (`null` : le texte ne tient pas dans le passage), pour une suite de verset la
similarité avec la transcription de la fenêtre (second témoin exigé), et la décision. `relisten` : un
candidat proposé par un moteur secondaire de la cascade, gardé seulement si l'audio soutient le texte du
corpus (ADR-0009). `neighbor` : une détection `uncertain` qui prolonge un verset `recognized` voisin, dont le
texte du corpus est aligné sur sa fenêtre (ADR-0010) ; acceptée, elle devient `recognized` (`promoted_by`). `head` : le début d'un verset dont la
suite est reconnue (le récitant a commencé, fait une pause, continué), aligné sur la fenêtre d'avant la pause
et gardé seulement si l'audio ET la transcription le soutiennent ; sinon l'abstention reste (ADR-0010). `cascade` (avec `--asr cascade`) nomme les moteurs secondaires, le nombre de fenêtres
réécoutées et celles où un candidat a atteint le seuil. Diagnostic : une
vérification acceptée n'est pas une vérité terrain.
Trois sortes d'intervalles :
- `{"kind":"verse","ref":"42:3","words":[1,10],"partial":false,"status":"recognized|inferred|uncertain",
  "t":[a,b]|null,"time_interpolated":false,"confidence":0.97,"candidates":[],"repetition":false,
  "text":..., "translation":{"text","translation_id","version","attribution","scope":"verse"}|null,
  "word_times"?:[[a,b],…],"word_times_source"?:"ctc-alignment|interpolated","promoted_by"?:"neighbor"}`
  (les trois derniers champs sont **additifs** : voir « Temps au mot » ci-dessous)
- `{"kind":"non_quran","label":"basmala|istiadha|takbir|amin|…","t":[a,b]}` ; champs **additifs** (l'ancien
  format `{kind, label, t}` reste valide, le schéma reste `aqr.recognition/1`) :
  - **basmala** (d'ouverture d'une sourate, ou un 1:1 isolé non suivi de 1:2 ; dans Al-Fatiha entière, 1:1 reste
    un verset) : `"basmala":true`, `"ref":"1:1"`, `"text"` (le verset 1:1 lu **dans le
    corpus**, I1) et `"translation"` (QuranEnc, même forme que pour un verset : `text`, `translation_id`,
    `version`, `attribution`, `scope:"verse"` ; `null` avec `--translation none`). Exemple réel (cascade, 55:1-4
    précédé de la basmala) :
    `{"kind":"non_quran","label":"basmala","t":[1.29,4.33],"basmala":true,"ref":"1:1","text":"بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ","translation":{"text":"Au nom d’Allah, le Tout Miséricordieux, le Très Miséricordieux.[1]","translation_id":"french_hameedullah","version":"quranenc.com","attribution":"QuranEnc.com — Muhammad Hamidullah (révision du Complexe du Roi Fahd)","scope":"verse"}}` ;
  - **isti'adha, takbir, amin** : aucun texte du Mushaf (hors corpus), ni `ref`, ni traduction ; un libellé arabe
    constant `"label_ar"` (`أعوذ بالله من الشيطان الرجيم`, `الله أكبر`, `آمين`), à afficher comme un libellé et
    jamais comme le texte du Coran ;
  - les autres zones (`french`, `silence`…) restent `{kind, label, t}`. La copie expurgée (`redact_document`)
    retire `text` et `translation` de la basmala comme de tout verset, et garde `basmala` et `ref`.
  - **`ref: "1:1"` sur une zone `non_quran` n'est pas un verset reconnu** : tout consommateur qui compte ou
    cite des versets doit filtrer sur `kind == "verse"`. La zone ne porte pas de statut de preuve : le moteur
    la pose quand la fenêtre ne contient que la basmala (qui est aussi le début du verset 1 de chaque sourate,
    donc toujours ambiguë comme verset). Le texte affiché est celui de la basmala, pas la preuve d'un verset.
  - La traduction de la basmala peut porter sa note de bas de page telle que QuranEnc la livre
    (`…Miséricordieux.[1]`) : elle n'est pas nettoyée (I2), l'affichage décide.
  - Contrôles : le lecteur Python et le schéma web refusent une zone incohérente (`basmala` non booléen ou hors
    1:1, texte/référence/traduction sur une autre zone, `label_ar` sur la basmala) ; seul
    `tests/support/corpus_check.py`, qui charge le corpus, vérifie que `text` est exactement celui de 1:1, que
    `label_ar` est la constante du libellé et que la traduction garde sa provenance (id, version, attribution,
    `scope: "verse"`). Le contenu de la traduction n'est pas comparé (comme pour les versets).
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

## Temps au mot (additif, ADR-0010)
Pour un verset `recognized`, `word_times` donne l'instant de début et de fin de **chaque mot de `words`**, dans
l'ordre (`word_times[i]` est le mot `words[0] + i`) : l'interface s'en sert pour surligner le mot récité.
`word_times_source` dit d'où ils viennent, et l'interface doit en tenir compte :
- `"ctc-alignment"` : mesurés. Chaque mot a été placé par l'alignement forcé du texte du corpus sur le treillis CTC
  (trame de 80 ms). Le premier mot commence où commence `t`, le dernier finit où finit `t` ; les mots sont dans
  l'ordre, avec d'éventuelles pauses entre eux (la fin d'un mot est le début du suivant dans un verset, sauf
  si une pause bornée par l'énergie les sépare). Bornés à la fenêtre du segmenteur, comme `t`.
  **Contrat d'ordre** : `word_times[i].début ≥ word_times[i-1].fin`, toujours, dans ce que le moteur écrit. Deux
  fenêtres voisines peuvent se recouvrir de quelques dizaines de ms ; leurs deux mots de raccord sont alors
  recoupés au milieu du recouvrement. Si le recouvrement dépasse 0,1 s, les temps mesurés ne sont pas publiés
  (`interpolated`). **Lecteur Python** : un chevauchement résiduel ≤ 0,1 s (réglable :
  `word_overlap_tolerance_s`) d'une ancienne sortie est normalisé de la même façon plutôt que de rejeter le
  document ; un chevauchement plus grand, un mot de durée nulle ou négative, un nombre de temps ≠ nombre de
  mots, ou des temps hors de `t` restent refusés. **Interface** : `validateWordTimes` n'exige que des débuts qui
  ne reculent pas, et le schéma zod n'impose pas d'ordre : une sortie au léger chevauchement reste lisible.
- `"interpolated"` : estimés. Seul `t` est mesuré (moteur sans modèle CTC, `--no-acoustic-check`, ou mots
  non mesurés) ; chaque mot reçoit une part de `t` proportionnelle à sa longueur en lettres dans le corpus.
  Les bornes sont celles de `t`, les mots sont contigus. À afficher comme une approximation (ex. surlignage
  sans frontière nette).
- **champs absents** pour un verset `uncertain` (non nommé) ou `inferred` (jamais entendu) : aucun temps n'est
  inventé. Une sortie ancienne, sans ces champs, reste valide.
`time_interpolated` ne change pas de sens : il concerne `t` (verset supposé, coupure interne estimée entre deux
versets d'une même fenêtre), pas les temps au mot. Les deux moitiés d'un verset fusionnées (fenêtres
contiguës) mettent leurs temps bout à bout, sauf si un mot manque au raccord (alors `interpolated`).

`promoted_by: "neighbor"` : la détection était `uncertain` (deux versets au début semblable, ex. 11:61 / 7:73) et
a été promue parce qu'elle prolonge le verset `recognized` voisin ET que l'audio soutient son texte
(`acoustic_checks[kind="neighbor"]`). Son `status` est `recognized`, sa preuve est la suite plus l'audio, pas le
seuil du score. Absent sinon. Exemple réel (session 5014015f, Hud 11:61, texte et traduction retirés) :
```
{"kind": "verse", "ref": "11:61", "words": [1, 10], "partial": true, "status": "recognized", "t": [21.545, 35.688], "time_interpolated": false, "confidence": 0.8864, "candidates": [], "repetition": false, "word_times": [[21.545, 22.665], [22.665, 24.105], [24.105, 26.025], [26.025, 28.665], [28.665, 29.705], [29.705, 31.465], [31.465, 32.985], [32.985, 34.345], [34.345, 34.985], [34.985, 35.688]], "word_times_source": "ctc-alignment", "promoted_by": "neighbor"}
```

## Provenance du texte
Texte arabe : corpus Tanzil versionné (`data/corpus/LOCK.json`), jamais l'ASR (I1). Traduction : QuranEnc telle
que reçue, avec id, « version » (identifiant de source : l'API n'en fournit pas) et attribution (I2) ; anomalies
connues : `docs/KNOWN-ISSUES.md` KI-1.

## SRT / VTT
Une ligne par verset (texte du corpus), `[incertain : 55:13 | 55:16]` pour un verset ambigu, `[déduit] …` pour
un verset supposé, `[isti'adha]`, `[takbir]`, `[amin]`, `[basmala]` pour les formules. Les abstentions n'ont
pas de sous-titre. La basmala garde son libellé `[basmala]` (son texte est dans le JSON).

## Ce qui n'est pas fait
- Décodage contraint sur treillis CTC (`--constrained`, ADR-0005) : la reconnaissance vérifie et horodate les
  candidats du matcher sur le treillis (ADR-0008), mais ne cherche pas elle-même un verset dans le treillis.
- Classification de la parole non coranique au-delà des formules de prière : B3/B5 (phase 7). Une parole
  française ou arabe courante est une abstention (`empty_transcript`, `no_candidate`, `below_threshold`), pas
  une étiquette `french`/`arabic_speech`.
