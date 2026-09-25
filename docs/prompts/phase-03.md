# Phase 3 — Outillage de données (à coller dans Claude Code)

Lis `docs/DATA-COLLECTION.md` et `docs/TEST-CORPUS.md`. Construis en TDD :

1. `aqr data ingest` : parcourt `$AQR_AUDIO_DIR/inbox`, valide chaque fiche `.yaml`
   (schéma strict, erreurs lisibles), calcule le SHA-256, range par catégorie, produit
   le WAV 16 kHz mono dans `_derived/`, ajoute le cas au manifeste (statut `a_annoter`).
   Idempotent (relancer ne duplique rien).
2. `aqr data import-labels <id>` / `export-labels <id>` : conversion bidirectionnelle
   manifeste ↔ fichier d'étiquettes Audacity (format défini dans DATA-COLLECTION §5,
   y compris plages de mots partielles et `NON_QURAN:<kind>`). Tests aller-retour.
3. `aqr data split` : 70/30 dev/test **groupé par récitant**, déterministe, écrit
   dans le manifeste ; un test garantit qu'aucun récitant n'est des deux côtés.
4. `scripts/fetch_everyayah.py` : sous-ensemble configurable (récitants × sourates),
   checksums, dans `$AQR_AUDIO_DIR/everyayah/`. Commence petit (3 récitants, 10 sourates).
5. `scripts/make_mix.py` : montages synthétiques reproductibles (graine) — versets
   EveryAyah enchaînés avec sauts, répétitions, verset brouillé (→ INFERRED), segments
   de parole non coranique ; vérité terrain générée depuis les durées. Test : un mix
   généré puis ré-importé donne exactement sa vérité terrain.
6. `preannotate` sera branché en phase 5 (pipeline) : prévois l'interface, pas le moteur.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.
