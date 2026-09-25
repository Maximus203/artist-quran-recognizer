# Prompt de démarrage — à coller dans Claude Code après /artist-init (et /artist-cadrage)

---

Lis `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/spec-v1.md` et
`.artist/acceptance-playbooks/v1-recognition.md`. Le domaine et la normalisation arabe
existent déjà (37 tests verts). Enchaîne les étapes 3 à 6 de l'ordre de construction de
`docs/spec-v1.md`, en **TDD strict** (test rouge commité ou montré → code → vert), une
PR par brique, fusionnée dans `develop` avant de passer à la suivante :

1. **`scripts/fetch_corpus.py` + `TanzilCorpusRepository`** : télécharge Tanzil
   Uthmani (rendu) ET simple-clean (matching) pour Hafs dans `data/corpus/`, épingle
   les versions et SHA-256 dans `data/corpus/LOCK.json` (versionné, lui). Tests :
   6236 versets, correspondance mot à mot Uthmani ↔ simple pour un échantillon,
   F9 (checksum faux → erreur).
2. **`NgramVerseMatcher` (B6)** : index n-grammes de mots sur le texte simple-clean
   normalisé, puis raffinement par distance d'édition au niveau mot → `Candidate`
   avec une plage de mots. Tests P3, P4, F3, F4 et un test de performance
   (< 50 ms par requête sur les 6236 versets).
3. **`ViterbiSequenceDecoder` (B7)** : états = positions (verset, mot),
   transitions paramétrées (suivant, répétition, saut d'un verset → INFERRED,
   saut arbitraire, entrée/sortie NON_QURAN) dans un fichier de configuration.
   Tests P5–P9 et F5, plus des tests de propriété (hypothesis) : une suite
   consécutive propre doit toujours être restituée à l'identique.
4. **`Renderer` + `QuranEncTranslationRepository`** : lots (`batch_size`, par pause,
   par sourate), JSON et SRT/VTT, texte Uthmani du corpus, traduction avec
   attribution et version. Tests P10, P11, F8. Cache local des traductions
   (téléchargement une fois via l'API QuranEnc, `french_hameedullah` par défaut).

Contraintes : `src/aqr/domain` reste sans dépendance ; aucun seuil en dur ;
`pytest`, `ruff check src tests`, `ruff format --check src tests` et `mypy`
verts avant chaque PR ; rapporte les sorties réelles, pas un résumé.
Les adapters modèles (B1–B4) et le QuranicityGate (B5) viendront ensuite, avec le
premier benchmark sur audio réel.
