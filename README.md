# artist-quran-recognizer

Localise dans un audio ou une vidéo **chaque verset du Coran récité** (de quelle seconde
à quelle seconde), ignore tout le reste (français, hadiths, invocations), puis restitue le
**texte exact du Mushaf** et la **traduction officielle** par lots paramétrables.

> **Statut : développement actif (V1 en construction).** Le cœur logique (corpus, recherche
> lexicale, décodage de séquence, rendu) est en place et testé ; les adapters audio/ASR et la
> CLI de bout en bout arrivent aux phases suivantes ([docs/PLAN.md](docs/PLAN.md)).

Principe : le texte et la traduction sont **consultés, jamais générés** — aucun LLM génératif
dans la chaîne ([ADR-0001](docs/adr/0001-pas-de-llm-generatif.md)). L'ASR ne sert qu'à
*localiser* ; nommer un faux verset est pire que n'en nommer aucun.

- Architecture et invariants : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Spécification V1 : [docs/spec-v1.md](docs/spec-v1.md)
- État de l'existant : [docs/RESEARCH.md](docs/RESEARCH.md)
- Corpus de test audio : [docs/TEST-CORPUS.md](docs/TEST-CORPUS.md) · collecte : [docs/DATA-COLLECTION.md](docs/DATA-COLLECTION.md)
- Définition du « done » : [.artist/acceptance-playbooks/v1-recognition.md](.artist/acceptance-playbooks/v1-recognition.md)
- Décisions : [.artist/decision-log.md](.artist/decision-log.md)

## Démarrage (local ou cloud)

```bash
python -m venv .venv && . .venv/bin/activate      # Windows : .venv\Scripts\activate
pip install -e ".[dev]"
python scripts/fetch_corpus.py                    # Tanzil -> data/corpus/ (checksums épinglés)
pytest                                            # unitaires + contrats
ruff check src tests scripts && ruff format --check src tests scripts && mypy
python scripts/bench_matcher.py --n 2000          # banc de robustesse de la recherche
```

Les tests qui ont besoin du corpus sont sautés tant qu'il n'est pas téléchargé. Les audios,
modèles et caches vivent hors dépôt (`AQR_AUDIO_DIR`, `AQR_MODELS_DIR`, voir `.env.example`).
Extras optionnels : `.[audio]`, `.[asr]` (PyTorch/NeMo, GPU conseillé). GPU NVIDIA récent (RTX 50xx,
Blackwell) : installer PyTorch **avant** l'extra, depuis l'index CUDA 12.8 —
`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128` — puis `pip install -e ".[asr]"`.

## Contribuer
TDD strict, une PR par brique, invariants I1–I5 non négociables : voir [AGENTS.md](AGENTS.md).
Aucun secret, aucun enregistrement audio de personne, aucun poids de modèle dans git.

## Licence
Code : [MIT](LICENSE).

## Attributions
- Texte coranique : [Tanzil Project](https://tanzil.net) (CC-BY-3.0) — téléchargé à la demande,
  non modifié, non redistribué dans ce dépôt ; un lien vers tanzil.net doit être conservé.
- Traductions : [QuranEnc.com](https://quranenc.com) — restituées sans modification, avec
  mention de la source et de la version.
- Modèles candidats (téléchargés à la demande, sous leurs licences propres) : voir
  [docs/RESEARCH.md](docs/RESEARCH.md).
