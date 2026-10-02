@AGENTS.md

## Spécificités Claude Code
- Réponses concises, résultats d'abord ; sorties d'outils bruyantes filtrées avant lecture.
- Projet sans interface web pour l'instant (CLI + bibliothèque Python) : le skill
  `browser-validation` (`.claude/skills/`) s'applique dès qu'une surface visible apparaît.
- Vérifier avant de dire « fait » : `pytest`, `ruff check`, `ruff format --check`, `mypy`.
- Réglages personnels dans `.claude/settings.local.json` (non versionné).
