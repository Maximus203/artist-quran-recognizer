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
