<!-- BEGIN artist-signature (rempli par /artist-init) -->
<!-- END artist-signature -->

<!-- BEGIN artist-brief (rempli par /artist-init) -->
<!-- END artist-brief -->

<!-- BEGIN artist-tokens -->
## Sobriété de contexte (règles permanentes)
- Réponses concises par défaut : va droit au résultat, saute le préambule et
  la narration. Reste exhaustif pour une explication demandée, un rapport
  d'erreur, une alerte de sécurité, une confirmation d'action destructive.
- CLAUDE.md / règles de projet : ne documente que ce que le code ne dit pas
  déjà.
- Fichier plutôt que texte collé au-delà d'environ 30 lignes.
- PDF en entrée -> Markdown immédiatement ; PDF en sortie -> seulement à la
  demande finale explicite.
- Filtre les sorties d'outils bruyantes avant de les lire en entier.
<!-- END artist-tokens -->

<!-- BEGIN projet-aqr -->
## Projet — invariants et méthode (détail : docs/ARCHITECTURE.md)
- **I1** Le texte arabe restitué vient TOUJOURS du corpus (lookup `VerseRef`), jamais d'un modèle.
  Aucun LLM génératif dans la chaîne (docs/adr/0001).
- **I2** Traductions QuranEnc restituées sans modification, avec id + version + attribution.
- **I3** Nommer un faux verset est pire que n'en nommer aucun : la précision prime sur le rappel.
- **I4** Toute parole non coranique (français, hadiths, dou'a, khutba) → `NON_QURAN`, 0 verset.
- **I5** Chaque détection porte un statut de preuve : RECOGNIZED / INFERRED / UNCERTAIN.
- `src/aqr/domain` n'importe rien d'externe. Les modèles lourds vivent dans `src/aqr/adapters`,
  derrière les ports de `domain/ports.py`, et passent les tests de `tests/contract/`.
- TDD strict : test rouge → code → vert. Chaque bug vu sur un vrai audio devient d'abord un cas
  dans `tests/fixtures/audio/manifest.yaml`. Le « done » = `.artist/acceptance-playbooks/`.
- Seuils et probabilités (gate, décodeur) = configuration calibrée par benchmark, jamais en dur.
- Vérifier avant de dire « fait » : `pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy`.
<!-- END projet-aqr -->
