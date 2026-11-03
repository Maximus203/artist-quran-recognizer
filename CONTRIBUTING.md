# Contribuer à artist-quran-recognizer

Merci de l'intérêt porté au projet. Ce document est volontairement court. English speakers: issues and PRs in English are welcome; the project documentation is mostly in French.

## Par où commencer

| Vous avez… | Vous pouvez… |
|---|---|
| Une bonne oreille et la lecture du Coran (Hafs) | **Valider des passages** dans l'atelier web : [appel aux relecteurs](https://github.com/Maximus203/artist-quran-recognizer/issues/87). Aucun code requis. |
| Un lecteur d'écran (NVDA, VoiceOver) | Tester l'atelier : [#90](https://github.com/Maximus203/artist-quran-recognizer/issues/90). |
| Windows | Rendre portables les scripts d'évaluation : [#89](https://github.com/Maximus203/artist-quran-recognizer/issues/89). |
| Du Python / de l'ASR | Le moteur en flux : [#84](https://github.com/Maximus203/artist-quran-recognizer/issues/84), étape 1 (simulation hors ligne). |
| Du TypeScript / React | L'atelier web, l'export de sous-titres : [#86](https://github.com/Maximus203/artist-quran-recognizer/issues/86). |
| Une autre traduction QuranEnc | Le découpage par fragments : [#91](https://github.com/Maximus203/artist-quran-recognizer/issues/91). |

Les tickets débutants portent l'étiquette [`good first issue`](https://github.com/Maximus203/artist-quran-recognizer/labels/good%20first%20issue). Avant un gros chantier, **ouvrez une issue** pour en parler : cela évite un travail refusé.

## Les règles qui ne se négocient pas

Les invariants I1 à I7 ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [AGENTS.md](AGENTS.md)) :

- **I1** le texte arabe vient toujours du corpus, jamais d'un modèle ; aucun LLM génératif dans la chaîne coranique ;
- **I2** la traduction QuranEnc est restituée sans modification, avec id, version et attribution ;
- **I3** nommer un faux verset est pire que n'en nommer aucun ;
- **I4** la parole non coranique ne produit aucun verset ; **I5** chaque détection a un statut de preuve ;
- **I6** la riwaya est un paramètre ; **I7** chaque brique est remplaçable derrière une interface testée.

`src/aqr/domain` n'importe rien d'externe. Les modèles lourds vivent dans `src/aqr/adapters`, derrière les ports de `domain/ports.py`, et passent les tests de `tests/contract/`. Les seuils sont de la **configuration calibrée par mesure**, jamais des valeurs en dur.

## Données et droits

- **Jamais dans Git** : secrets, `.env`, fichiers audio ou vidéo, enregistrements de personnes, poids de modèles.
- N'importez et ne partagez que des audios **dont vous avez les droits**. Un problème de reconnaissance se décrit sans joindre l'audio si vous ne pouvez pas le partager.
- Pas de nom réel ni d'adresse e-mail dans les jeux ou les fixtures.

## Mettre en place l'environnement

```bash
python -m venv .venv && . .venv/bin/activate       # Windows : .venv\Scripts\activate
pip install -e ".[dev]"
python scripts/fetch_corpus.py
pytest
```

Pour l'atelier web : Node 24 puis `cd web && npm ci` ([web/README.md](web/README.md)). Les modèles se téléchargent avec `python scripts/fetch_models.py` (GPU NVIDIA conseillé).

## Méthode

1. **Test d'abord (TDD)** : un test rouge, puis le code, puis vert. Un bug vu sur un vrai audio devient d'abord un cas dans `tests/fixtures/audio/manifest.yaml`.
2. **Pas de valeur en dur, pas de répétition, pas de log fantôme** : une configuration unique, un seul wrapper de logging.
3. **Une PR par brique**, ouverte vers **`develop`** (branche d'intégration). Une PR courte et ciblée est relue plus vite.
4. **Avant de pousser** :

   ```bash
   pytest
   ruff check src tests scripts
   ruff format --check src tests scripts
   mypy
   ```

   Si vous touchez à l'atelier, lancez aussi les tests et le lint de `web/` (voir `web/package.json`).
5. **Documentation avec le code.** Une PR qui change un comportement visible, l'architecture ou une décision ajoute une entrée en tête de [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md) et met à jour le document concerné :

   ```bash
   python scripts/new_release_note.py "Titre court" --tags utilisateur,technique --pr 123
   python scripts/check_docs_index.py
   ```

   Une nouvelle décision d'architecture = une ADR dans `docs/adr/` + une ligne dans `docs/docs-index.json`.
6. **Aucun chiffre inventé** : chaque affirmation chiffrée cite sa source (fichier, PR). Ce qui n'existe pas encore est marqué « en cours », jamais décrit comme livré.

## Messages de commit et PR

Format `type(portée): sujet` (`feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`), avec un corps qui explique le *pourquoi*. Décrivez la PR avec [le modèle fourni](.github/PULL_REQUEST_TEMPLATE.md) et joignez les sorties des commandes ci-dessus. Pour tout changement visible dans l'atelier, une capture d'écran.

Les mainteneurs relisent, peuvent demander des changements, et décident de la fusion. Aucune publication ni release sans leur feu vert.

## Signaler un problème

- **Bug** ou **idée** : [ouvrir une issue](https://github.com/Maximus203/artist-quran-recognizer/issues/new/choose).
- **Faille de sécurité** : ne l'ouvrez pas en public, voir [SECURITY.md](SECURITY.md).
- **Comportement d'un participant** : voir [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence de vos contributions

En contribuant, vous acceptez que votre contribution soit publiée sous la licence du dépôt (aujourd'hui [MIT](LICENSE) ; le mainteneur prévoit de passer à une licence non commerciale, voir le [README](README.md#licence-attributions-et-limites)).
