# Phase 7 — Rejet du non-Coran (à coller dans Claude Code)

Configuration par défaut retenue par Cherif : <CONFIG CHOISIE>.
Lis `docs/adr/0002-rejet-arabe-non-coranique.md`.

1. B3 `LanguageGate` (Whisper LID) : français / autre → `NON_QURAN` sans passer par l'ASR Coran.
2. B5 `QuranicityGate` : divergence ASR Coran vs Whisper large-v3 + couverture
   d'alignement (N mots consécutifs, similarité ≥ seuil) ; tout paramètre en configuration.
3. Étiquettes `ISTIADHA`, `BASMALA`, `TAKBIR`, `AMIN` (F9).
4. Calibration **sur dev uniquement** (recherche de grille), puis mesure unique sur test.
   Critères : 0 faux positif C09/C10, rappel ≥ 90 % C11, rappel global ≥ 95 % C01.
5. Si les critères sont incompatibles, présente 2–3 réglages avec leurs chiffres et
   arrête-toi : Cherif arbitre. Passe l'ADR-0002 à « accepté » ou « amendé ».

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.
