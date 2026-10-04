# Phase 8 — V1 « utilisation libre » (à coller dans Claude Code)

1. `aqr recognize-dir <dossier>` : traite un dossier, reprend là où il s'est arrêté,
   un JSON + un SRT par fichier, un récapitulatif CSV.
2. Interface web locale (`aqr serve`, FastAPI + une page, sans framework lourd) :
   dépôt d'un fichier audio/vidéo, progression, lecteur synchronisé avec la timeline
   (verset courant surligné), texte Mushaf + traduction par lots paramétrables,
   export JSON/SRT/VTT, affichage des statuts (reconnu / déduit / incertain / non-Coran).
   Valide-la avec `browser-validation`.
3. README utilisateur (installation Windows, première utilisation, attributions Tanzil
   et QuranEnc), `CHANGELOG.md`.
4. Prépare la release `v1.0.0` (branche de release, notes) **sans taguer** : le feu vert
   final appartient à Cherif après une semaine d'usage réel.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.

**Signature** : aucune mention de Claude/IA dans les commits et PR (ni `Co-Authored-By`, ni `Claude-Session`, ni « Generated with »), cf. AGENTS.md § Signature.
