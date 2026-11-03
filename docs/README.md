# Carte de la documentation

Pour comprendre le projet, lisez dans cet ordre : **[Le système en bref](SYSTEME-EN-BREF.md)**, puis l'[architecture](ARCHITECTURE.md), puis les décisions ([ADR](adr)) qui vous intéressent. Les images du README sont dans [`assets/`](assets).

## Comprendre

| Document | Contenu |
|---|---|
| [SYSTEME-EN-BREF.md](SYSTEME-EN-BREF.md) | À quoi ça sert, ce qui se passe quand on dépose un audio, les invariants, où en est-on, les chiffres et leurs limites. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Les couches, les ports, les invariants I1 à I7. |
| [ARCHITECTURE-ATELIER.md](ARCHITECTURE-ATELIER.md) | L'atelier web : données, comptes, file d'analyse, revue. |
| [spec-v1.md](spec-v1.md) · [PLAN.md](PLAN.md) | La spécification et le plan par phases (directions A, B, C, D). |
| [RELEASE-NOTES.md](RELEASE-NOTES.md) | Ce qui a changé, du point de vue de celui qui utilise ou lit le système. |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | Limites connues, y compris celles des sources. |

## Les décisions (ADR)

Chaque décision d'architecture a son fichier dans [`adr/`](adr) : pas de LLM génératif ([0001](adr/0001-pas-de-llm-generatif.md)), rejet de l'arabe non coranique, recherche lexicale contrainte et sur flux continu, décodage et preuve acoustique, alignement forcé, preuve cumulée par la suite, vérification acoustique, cascade multi-modèles, promotion par le voisin, détection en direct sans plage ([0011](adr/0011-detection-en-direct-sans-plage.md)), traduction découpée en fragments, comblement de trou.

## Contrats de sortie

[RECOGNIZE-OUTPUT.md](RECOGNIZE-OUTPUT.md) (`aqr recognize`, format `aqr.recognition/1`) · [ALIGN-OUTPUT.md](ALIGN-OUTPUT.md) (`aqr align`).

## Mesures et évaluations

Rapports datés dans [`evaluation/`](evaluation) : [courbe de dégradation](evaluation/courbe-degradation-2026-10-23.md), [courbe de vitesse](evaluation/courbe-vitesse-2026-10-23.md), [comblement de trou](evaluation/comblement-de-trou-2026-10-23.md), [traduction par passage](evaluation/traduction-par-passage-2026-10-23.md), [cascade](evaluation/cascade-2026-10-20.md), [données de fine-tuning](evaluation/finetune-data.md). Méthode : [EVALUATION-METRICS.md](EVALUATION-METRICS.md), [protocole de réglage](evaluation/protocole-reglage-evaluation.md), [REPRODUCIBILITY.md](REPRODUCIBILITY.md).

## Données et droits

[TEST-CORPUS.md](TEST-CORPUS.md) · [DATA-COLLECTION.md](DATA-COLLECTION.md) · [ANNOTATION-DEV-SET.md](ANNOTATION-DEV-SET.md) · [data-lots/RIGHTS.md](data-lots/RIGHTS.md) (droits des lots audio : aucun audio n'est versionné).

## Design de l'atelier

Direction « Encre & lapis » : [design/atelier-direction.md](design/atelier-direction.md), [revue humaine](design/revue-humaine.md), [phase 2](design/phase2.md), [tokens.css](design/tokens.css).

## Contribuer à la documentation

La documentation suit le code : elle est mise à jour **dans la PR qui change les choses** ([CONTRIBUTING.md](../CONTRIBUTING.md)). `python scripts/check_docs_index.py` contrôle l'index ([docs-index.json](docs-index.json)), les ADR et le format des notes de version. Aucun chiffre inventé : chaque affirmation cite sa source.
