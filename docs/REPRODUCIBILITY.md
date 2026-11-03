# Reproductibilité

Ce document consigne ce qui a été réellement exécuté, avec versions et durées. Chaque section
`##` est indépendante.

## Environnement de test

Objectif : sur une installation propre, `pip install -e ".[dev]"` suffit pour que `pytest`,
`ruff check`, `ruff format --check` et `mypy` soient verts, sans exclusion ni skip masquant un échec.

### Mesure de départ (base origin/develop @ d9795b2, venv neuf, extra `dev` seul)

- `pytest` : 28 échecs/erreurs (17 `test_fastconformer_adapter`, 8 `test_whisper_adapter`,
  3 `test_speech_segmenter_contract[fake]`), tous `ModuleNotFoundError: No module named 'numpy'`.
- `mypy` : 2 erreurs (`huggingface_hub` introuvable, `hf_hub.py:17` ; `# type: ignore` inutile,
  `segmenters.py:91`).

Classification (détail dans `.artist/decision-log.md`, section 2026-10-06) : aucune régression ;
28 tests = dépendance d'environnement non déclarée (numpy n'était que dans l'extra `audio`) ;
2 erreurs mypy = résultat dépendant de ce qui est installé (même config verte avec torch/transformers
installés, vérifié).

### Correctif

- `dev` ajoute `numpy>=1.26` : le code testé l'importe paresseusement
  (`adapters/whisper_tarteel.py`, `adapters/fastconformer.py`) et `tests/support/real.py` aussi.
- `soundfile` et `huggingface_hub` ne sont pas ajoutés : aucun test ni module testé ne les importe.
- `[[tool.mypy.overrides]]` pour `huggingface_hub`, `torch`, `transformers`, `silero_vad`,
  `recitations_segmenter`, `nemo` (`follow_imports = "skip"`, `ignore_missing_imports = true`) :
  ces bibliothèques valent `Any` qu'elles soient installées ou non. Le `# type: ignore[no-untyped-call]`
  de `segmenters.py` est supprimé.

### Vérification dans un venv neuf (Python 3.11.15)

```bash
python -m venv venv-clean-env && venv-clean-env/bin/pip install -e ".[dev]"   # ~10 s
python -m pytest -p no:cacheprovider    # 383 passed, 4 skipped, 16 deselected in 27.86 s
ruff check src tests scripts            # All checks passed!
ruff format --check src tests scripts   # 91 files already formatted
python -m mypy                          # Success: no issues found in 42 source files (3,0 s)
```

Versions : pytest 9.1.1, ruff 0.16.10, mypy 2.4.0, numpy 2.4.6, PyYAML 6.0.3, hypothesis 6.168.5,
types-PyYAML 6.0.12.

Les 4 tests sautés sont `test_speech_segmenter_contract[silero]` (`pytest.importorskip("silero_vad")` :
extra `segmenter` non installé). Saut légitime d'une dépendance optionnelle, pas un échec masqué.
Les 16 désélectionnés sont les marqueurs `slow`/`acceptance` (config `addopts`).

### mypy avec torch/transformers installés

Venv de travail (torch 2.14.1+cpu, transformers 5.18.0, numpy 2.4.6, huggingface_hub 1.33.0,
silero_vad et recitations_segmenter installés), après `pip install mypy types-pyyaml` et sans
réinstaller le paquet :

```bash
PYTHONPATH=<worktree>/src python -m mypy --no-incremental --cache-dir=/dev/null
# Success: no issues found in 42 source files
```

Contre-épreuve : l'ancienne config de develop est verte dans ce venv mais donne les 2 erreurs dans
le venv neuf, ce qui établit que l'ancien résultat dépendait de l'environnement.
