# artist-quran-recognizer

Localise dans un audio ou une vidéo **chaque verset du Coran récité** (de quelle seconde
à quelle seconde), ignore tout le reste (français, hadiths, invocations), puis restitue le
**texte exact du Mushaf** et la **traduction officielle** par lots paramétrables.

- Architecture et invariants : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Spécification V1 : [docs/spec-v1.md](docs/spec-v1.md)
- État de l'existant : [docs/RESEARCH.md](docs/RESEARCH.md)
- Corpus de test audio : [docs/TEST-CORPUS.md](docs/TEST-CORPUS.md)
- Définition du « done » : [.artist/acceptance-playbooks/v1-recognition.md](.artist/acceptance-playbooks/v1-recognition.md)

## Développement

```bash
uv venv && uv pip install -e ".[dev]"
pytest                      # unitaires + contrats (rapide, sans modèle)
pytest -m slow              # vrais modèles ASR
pytest -m acceptance        # audios du manifeste (AQR_AUDIO_DIR)
ruff check src tests && ruff format --check src tests && mypy
```

## Attributions
- Texte coranique : Tanzil Project (CC-BY-3.0) — tanzil.net
- Traductions : QuranEnc.com — restituées sans modification
