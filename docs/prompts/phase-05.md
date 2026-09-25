# Phase 5 — Pipeline bout-en-bout + CLI (à coller dans Claude Code)

1. Cas d'usage `app.recognize(path, config) -> Timeline` qui câble B1→B2→B4→B6→B7
   (B3/B5 en « passe-tout » configurable jusqu'à la phase 7), injection des adapters
   par configuration (`config/default.yaml`).
2. CLI : `aqr recognize <fichier> [--batch-size N] [--group-by pause|surah]
   [--format json|srt|vtt] [--translation french_hameedullah] [--asr fastconformer|whisper]`.
   `engine_version` inclut les versions du corpus, de la traduction et du modèle.
3. Branche `aqr data preannotate <id>` sur ce pipeline (phase 3).
4. Test d'acceptation sur 3 mixages synthétiques (phase 3) + 3 extraits EveryAyah :
   rapporte précision/rappel/frontières.
5. Documente dans le README la commande exacte pour que Cherif teste sur ses fichiers
   Windows (PowerShell), puis **arrête-toi** : Cherif teste et renvoie ses observations.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.
