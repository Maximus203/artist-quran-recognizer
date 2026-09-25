# Phase 6 — Golden set + benchmark v1 (à coller dans Claude Code)

Cherif a corrigé les étiquettes Audacity des fichiers suivants : <LISTE DES IDs>.

1. `aqr data import-labels` sur chacun, puis `aqr data split`.
2. `aqr bench --set dev` : métriques par catégorie (précision, rappel verset,
   faux positifs en zone non-Coran, erreur de frontière médiane) pour 3 configurations :
   FastConformer libre, Whisper-Tarteel libre, FastConformer contraint.
3. Rapport `docs/reports/bench-v1.md` : tableaux + 10 pires erreurs commentées
   (écoute l'extrait, dis pourquoi). Chaque erreur typique → nouveau cas de test.
4. Recommande une configuration par défaut avec la justification chiffrée, **sans
   l'appliquer** : Cherif tranche. N'utilise jamais le set `test` pour régler quoi que ce soit.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.
