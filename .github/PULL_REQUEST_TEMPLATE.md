## Rappel — 2 identités GitHub obligatoires
Auteur ≠ reviewer (règle `artist-cadrage` / `artist-validation-gate`). Ne
jamais merger une PR review par son propre auteur.

## Preuve avant merge
- [ ] `artist-validation-gate` passé (review → test → preuve → verdict)
- [ ] Surface visible → validée par `browser-validation`

## Invariants du projet (docs/ARCHITECTURE.md §1)
- [ ] Aucun texte arabe ni aucune traduction n'est produit par un modèle (I1, I2)
- [ ] Nouveaux cas de test : must-pass ET must-fail
- [ ] Métriques du benchmark jointes si la PR touche B2–B7
