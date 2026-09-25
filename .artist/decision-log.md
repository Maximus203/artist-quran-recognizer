# Journal des décisions — artist-quran-recognizer

## 2026-09-24
- Pas d'entraînement de zéro ni de LLM génératif : assemblage de briques existantes (ADR-0001).
- Texte arabe et traduction consultés, jamais générés (invariants I1, I2).
- Riwaya Hafs en V1, Warsh en V1.1. Paramètre `riwaya` présent dès le départ.
- Traduction FR par défaut : Hamidullah (révision du Complexe du Roi Fahd) via QuranEnc, non modifiée.
- Méthode : TDD brique par brique. Le cœur logique est pur et testé sans modèle.
- Rejet de l'arabe non coranique par double transcription (ADR-0002, statut proposé).

## 2026-09-25 — Brique `CorpusRepository` (Tanzil)
- **Découpage en mots Uthmani ≠ simple-clean sur ~363/6236 versets** (ex. "يَـٰٓأَيُّهَا"
  fusionné en un seul mot Uthmani vs "يا أيها" séparé en simple-clean). Vérifié sur le
  corpus téléchargé le 2026-09-25 (script `scripts/fetch_corpus.py`).
- **Décision** : `words(ref)` et toute indexation par mot (WordSpan, matching B6) se
  basent **uniquement sur la tokenisation Uthmani** (texte splitté par espace). Le
  fichier simple-clean reste téléchargé et son checksum épinglé (LOCK.json) pour la
  provenance et un contrôle croisé ponctuel, mais n'est jamais la source des index de
  mots. Ça évite un bug d'alignement WordSpan/rendu sur 5,8 % du corpus, cohérent avec
  I1 (rendu toujours depuis le corpus) et I3 (précision prime).
- **Convention Tanzil à connaître pour B6/B7/B9** : le texte du verset 1 de chaque
  sourate (sauf At-Tawbah, 9) inclut la basmala concaténée dans la même chaîne — donc
  `words(ref)` sur un verset 1 retourne 4 mots de basmala en plus du contenu réel du
  verset. À prendre en compte dans le matcher et le rendu par lots.
- Corpus Hafs Tanzil Uthmani + simple-clean téléchargés et épinglés (CC-BY-3.0),
  6236 versets vérifiés. `data/corpus/` gitignoré (poids) ; seul `LOCK.json` versionné.

## 2026-09-25 — Brique `NgramVerseMatcher` (B6)
- **Bug trouvé en écrivant P3** (transcription exacte de 2:255 devait matcher à
  score 1.0, obtenait 0.93) : le texte Tanzil sépare par des espaces non seulement
  les mots mais aussi les marques de pause isolées (ۖ ۗ ۚ ۛ...) — 8 sur 2:255 à elles
  seules, dans le fichier Uthmani **et** simple-clean malgré `marks=false` sur ce
  dernier. `words()` les comptait comme des « mots ».
- **Correction** : `TanzilCorpusRepository.words()` exclut désormais tout token dont
  `normalize_arabic()` est vide (aucune lettre arabe) — `text()` reste inchangé
  (rendu fidèle, I1, les marques de pause en font partie du Mushaf affiché).
- Index B6 : n-grammes de mots (trigrammes, replis uni/bigramme pour les ~quelques
  versets < 3 mots comme 55:64) construits sur `words()` (Uthmani, jamais
  simple-clean, cf. décision précédente). Pas de seuil de rejet codé en dur dans le
  matcher : l'absence de recouvrement de n-gramme suffit pour F3/F4, le seuil de
  confiance final reste une décision calibrée de la brique appelante (I3).
- Perf mesurée : construction de l'index sur 6236 versets + 6 tests ≈ 0,85 s ;
  une requête après échauffement < 50 ms (budget NF3 respecté).

## 2026-09-25 — Brique `ViterbiSequenceDecoder` (B7)
- États = candidats (VerseRef) proposés par le matcher à chaque étape ; poids de
  transition dans `DecoderWeights` (next_verse, repetition, one_verse_gap,
  arbitrary_jump) — objet de configuration, pas de constante éparpillée.
- `min_recognized_score` (défaut 0.75) filtre les candidats avant même le Viterbi :
  porte d'entrée pour I3/F5 (un mot isolé faiblement ressemblant ne doit jamais
  atteindre RECOGNIZED), sans mêler ce seuil à la logique de transition.
- `uncertainty_ratio` (défaut 0.92) : si le 2ᵉ meilleur chemin à une étape est trop
  proche du meilleur, statut UNCERTAIN + liste des candidats à égalité (P9 sans
  contexte) ; avec un contexte fort (transition next_verse vs arbitrary_jump), l'écart
  devient large et RECOGNIZED l'emporte naturellement (P9 avec contexte).
- Post-traitement en deux passes après le chemin optimal : fusion des répétitions
  consécutives d'un même verset (P8, une seule détection à plage fusionnée) puis
  comblement des trous d'exactement un verset (P6, INFERRED, temps interpolé si les
  bornes temporelles le permettent) — les sauts plus larges ou vers une autre sourate
  (P7) ne déclenchent aucun comblement.
- Testé en pur (sans corpus, mécanique de transition/fusion/comblement) et contre le
  corpus réel (P5-P9, F5) + une propriété Hypothesis : toute suite consécutive propre
  tirée du Mushaf est restituée à l'identique, RECOGNIZED, sans fusion ni trou.

## 2026-09-25 — Brique `Renderer` (B9) + `QuranEncTranslationRepository`
- **Port `Renderer` ajouté à `domain/ports.py`** : absent du fichier malgré
  l'architecture (§3 le liste). `BatchOptions`/`RenderedBatch` complètent le port.
- Pas de dossier dédié prévu dans l'arbre `docs/ARCHITECTURE.md` §6 pour B9 (oubli de
  la doc) : créé `src/aqr/rendering/` par cohérence avec `matching/`/`decoding/` (un
  dossier par brique pure).
- `HomeRenderer` lit toujours le texte via `CorpusRepository.text(ref)` (I1) — la
  `Detection` ne porte qu'une référence, jamais de texte, donc l'invariant est
  garanti par construction, pas seulement par convention.
- `QuranEncTranslationRepository` : cache local par (traduction, sourate) — un seul
  appel API renvoie toute la sourate (`/translation/sura/<id>/<n>`), réutilisé pour
  chaque verset. Checksum sidecar (`<n>.sha256`) vérifié à chaque lecture (F8).
  Slugs FR confirmés sur quranenc.com : `french_hameedullah` (Hamidullah, défaut),
  `french_rashid` (Rachid Maach), `french_montada` (Centre Nûr).
- Attribution/version ne sont pas dans la réponse API (juste `arabic_text`/
  `translation`/`footnotes`) : portées par un petit registre `TRANSLATION_METADATA`
  dans l'adapter, un seul endroit (I2).

## 2026-09-25 — Phase 2 : robustesse du matcher (ADR-0003)
- **Constat vérifié indépendamment** (pas seulement recopié du prompt) : sur le
  corpus épinglé, 3843/6236 versets (61,6 %) ont au moins un mot dont la forme
  imla'i normalisée (`normalize_arabic`) est absente du vocabulaire Uthmani indexé
  par `NgramVerseMatcher` ; 7297/78248 mots (9,3 %). `NgramVerseMatcher` ne
  retrouvait donc correctement que du texte reconstruit depuis le corpus
  lui-même — jamais testé contre une vraie sortie d'ASR (orthographe imla'i).
- **Règle de caractères générique essayée puis rejetée** : mapper systématiquement
  l'alef supérieur (dagger alef, ٰ) vers un ا plein corrige la majorité des cas
  (سموت -> سماوات) mais casse « الرحمن » (jamais « الرحمان », y compris dans la
  basmala — 159 occurrences dans le seul texte simple-clean) : l'orthographe
  moderne retient elle-même certaines graphies courtes historiques. Une règle
  aveugle aurait *dégradé* le matching sur ce mot, très fréquent.
- **Décision : dictionnaire de corrections appris depuis le corpus lui-même**
  (`aqr.corpus.imlai_corrections.build_word_corrections`), pas une règle générique.
  Pour chaque verset où Uthmani et simple-clean ont le même nombre de mots
  (alignement position par position fiable — exclut les ~363 versets déjà connus
  pour diverger, cf. brique B6 du 2026-09-25), on compare `normalize_arabic(mot
  Uthmani)` à `normalize_arabic(mot simple-clean)` ; en cas d'écart, la forme
  imla'i majoritaire observée devient la correction. Table dérivée déterministe
  du corpus épinglé (LOCK.json), jamais committée : reconstruite à l'init du
  matcher, comme son index (même budget de temps, cf. mesure ci-dessous).
- **Matcher à deux niveaux (ADR-0003)** : index n-grammes de *caractères* (5-grammes
  sur le texte squeletté sans espaces) en premier niveau, tolérant au bruit lettre
  par lettre ; index trigrammes de *mots* corrigés en second niveau ; les deux
  alimentent le même réalignement fin (`difflib`) pour le score final et le
  `WordSpan` — aucun seuil de rejet en dur, comme avant.
- **2ᵉ bug trouvé en testant `build_word_corrections`** : le vote majoritaire
  n'enregistrait que les paires où la forme Uthmani ET la forme imla'i différaient
  — donc pour un mot presque toujours bien aligné (« الذين », 810 occurrences), les
  810 votes « identité » étaient ignorés et le seul (rare) mauvais alignement
  position-par-position devenait *la* correction retenue, cassant ce mot très
  fréquent (corrigé à tort vers « اللذين »). Fix : compter aussi les votes
  d'identité, ne retenir une correction que si elle est réellement majoritaire.
- **Mesure après correction** : taux de mots hors du vocabulaire Uthmani corrigé
  9,3 % → 1,07 %. Résiduel dominant connu : le « يا » vocatif, fusionné au mot
  suivant en Uthmani (« يَـٰٓأَيُّهَا ») mais séparé en imla'i (« يا أيها ») — aucune
  substitution mot-à-mot ne peut le corriger puisqu'il n'existe jamais comme mot
  Uthmani isolé dans un verset aligné ; c'est l'index de caractères (sans espaces,
  donc insensible à la frontière de mot) qui l'absorbe.
- **Résultats réels du banc de robustesse** (`scripts/bench_matcher.py`, 2000
  requêtes, graine 42, corpus réel) :
  | Scénario | Top-1 | Latence moyenne |
  |---|---|---|
  | Orthographe imla'i exacte | 99,80 % | 1,85 ms |
  | 1 erreur de lettre / 5 mots | 98,00 % | 1,79 ms |
  | 1 mot manquant | 98,80 % | 1,84 ms |
  | 1 mot en trop | 99,70 % | 2,21 ms |

  Cibles de la phase (≥ 99 % exact, ≥ 95 % avec 1 erreur/5 mots, < 50 ms) dépassées
  sur les quatre scénarios. Un top-1 est compté correct si la référence est la
  bonne OU si son texte est rigoureusement identique à la cible (versets répétés
  mot pour mot, ex. le refrain d'Ar-Rahman, 55:13/16/18/21/23/25/28/30 ×31) : sans
  contexte, aucun matcher ne peut départager deux versets au texte identique — la
  désambiguïsation par contexte est le rôle du décodeur B7 (déjà testé, P9), pas
  de ce niveau. Sans cet ajustement, ces ambiguïtés réelles faisaient chuter le
  score exact-imla'i mesuré à 98,7 % sur un échantillon de 300.
- **Basmala (item 4)** : `aqr.domain.quran_structure.is_basmala_only_span` détecte
  qu'une plage de mots reconnue ne couvre que la basmala concaténée en tête du
  verset 1 (convention Tanzil, toutes sourates sauf At-Tawbah/9) — jamais pour
  1:1 (Al-Fatiha), où la basmala EST le verset. Utilitaire pur, prêt pour le
  pipeline (B7/B9) qui l'utilisera pour étiqueter `NonQuranKind.BASMALA` au lieu
  d'un verset 1 partiellement reconnu — le branchement réel attend B1-B5 (phase 4).
