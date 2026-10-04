## Résumé

## Preuves avant merge
- [ ] `pytest`, `ruff check src tests scripts`, `ruff format --check src tests scripts`, `mypy` verts (sorties jointes)
- [ ] Surface visible (si applicable) vérifiée dans le navigateur

## Invariants du projet (docs/ARCHITECTURE.md §1)
- [ ] Aucun texte arabe ni aucune traduction n'est produit par un modèle (I1, I2)
- [ ] Nouveaux cas de test : must-pass ET must-fail
- [ ] Métriques du benchmark jointes si la PR touche B2–B7
- [ ] Aucun secret, aucun fichier audio/modèle ajouté
- [ ] Aucune signature d'IA dans les commits/PR (`Co-Authored-By`, `Claude-Session`, « Generated with »)
