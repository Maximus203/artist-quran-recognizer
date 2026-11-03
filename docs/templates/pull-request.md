<!--
Modèle de description de PR. La version pré-remplie par GitHub est .github/PULL_REQUEST_TEMPLATE.md ;
la case « Notes de version / documentation mises à jour » doit rester identique dans les deux fichiers
(un test le vérifie). Ni signature d'IA ni mention d'outil dans la description : voir AGENTS.md.
-->

## Pourquoi
<!-- Le problème, vu de l'utilisateur ou du système. Renvoyer vers l'ADR ou le rapport si une décision est prise. -->

## Ce qui change
<!-- Comportement visible, architecture, contrat de sortie. Une phrase par changement. -->

## Preuves avant merge
- [ ] `pytest`, `ruff check src tests scripts`, `ruff format --check src tests scripts`, `mypy` verts (sorties jointes)
- [ ] Surface visible (si applicable) vérifiée dans le navigateur

## Documentation vivante
- [ ] Notes de version / documentation mises à jour (`docs/RELEASE-NOTES.md`, le document concerné, `docs/docs-index.json` pour une nouvelle ADR ou un nouveau rapport), ou sans objet (dire pourquoi)
- [ ] `python scripts/check_docs_index.py` vert

Entrée à ajouter dans `docs/RELEASE-NOTES.md` (squelette : `python scripts/new_release_note.py "Titre" --tags utilisateur,technique --pr NN`) :

```
## AAAA-MM-JJ — Titre court
Étiquettes : utilisateur, technique, décision
PR : #NN

**Ce qui change.** Deux ou trois phrases, du point de vue de celui qui utilise ou lit le système.

**Pourquoi / décision.** Le motif, les chiffres mesurés avec leur source, le renvoi à l'ADR.
```

## Invariants du projet (docs/ARCHITECTURE.md §1)
- [ ] Aucun texte arabe ni aucune traduction n'est produit par un modèle (I1, I2)
- [ ] Nouveaux cas de test : must-pass ET must-fail
- [ ] Métriques du benchmark jointes si la PR touche B2–B7
- [ ] Aucun secret, aucun fichier audio/modèle ajouté
- [ ] Aucune signature d'IA dans les commits/PR (`Co-Authored-By`, `Claude-Session`, « Generated with »)
