# artist-quran-recognizer — consignes pour agents (Claude Code, Codex, Copilot)

Moteur qui localise dans un audio/vidéo chaque verset du Coran récité (début/fin en
secondes), ignore tout le reste, puis restitue le texte exact du Mushaf et la traduction
officielle. Architecture : `docs/ARCHITECTURE.md` · spec : `docs/spec-v1.md` · plan par
phases : `docs/PLAN.md` · décisions : `.artist/decision-log.md`.

## Invariants (non négociables — chaque PR les respecte)
- **I1** Le texte arabe restitué vient TOUJOURS du corpus (lookup `VerseRef`), jamais d'un
  modèle. Aucun LLM génératif dans la chaîne (`docs/adr/0001`).
- **I2** Traductions QuranEnc restituées sans modification, avec id + version + attribution.
- **I3** Nommer un faux verset est pire que n'en nommer aucun : la précision prime sur le rappel.
- **I4** Toute parole non coranique (français, hadiths, dou'a, khutba) → `NON_QURAN`, 0 verset.
- **I5** Chaque détection porte un statut de preuve : RECOGNIZED / INFERRED / UNCERTAIN.
- `src/aqr/domain` n'importe rien d'externe. Les modèles lourds vivent dans `src/aqr/adapters`,
  derrière les ports de `domain/ports.py`, et passent les tests de `tests/contract/`.
- Seuils et probabilités (gate, décodeur) = configuration calibrée par benchmark, jamais en dur.

## Méthode
- **TDD strict** : test rouge → code → vert. Chaque bug vu sur un vrai audio devient d'abord
  un cas dans `tests/fixtures/audio/manifest.yaml`. Le « done » = `.artist/acceptance-playbooks/`.
- Avant de coder : pourquoi (objectif/critères), contexte (conventions déjà en place — ne pas
  introduire de pattern incohérent), architecture. Ambiguïté → trancher en énonçant l'hypothèse.
- Trois lois : ne te répète pas · centralise (zéro valeur en dur, config unique) · aucun log
  fantôme (un wrapper de logging unique). Pas de complexité gratuite.
- Après le code : tests (cas limites + négatifs), revue sécurité, revue performance,
  auto-revue, documenter les décisions non triviales dans `.artist/decision-log.md`.
- Une PR par brique, fusionnée dans `develop` (branche d'intégration). Rien n'est « fait »
  sans validation du mainteneur ; aucune publication/release sans son feu vert explicite.

## Commandes (à lancer avant de dire « fait »)
```bash
pip install -e ".[dev]"            # ou : uv venv && uv pip install -e ".[dev]"
python scripts/fetch_corpus.py     # télécharge Tanzil dans data/corpus/ (vérifié par LOCK.json)
pytest
ruff check src tests scripts
ruff format --check src tests scripts
mypy
```
Les tests qui exigent le corpus sont sautés (pas en échec) tant qu'il n'est pas téléchargé.

## Signature des commits et PR (règle du mainteneur)
- **Aucune signature d'IA** dans l'historique : ni `Co-Authored-By: Claude …`, ni
  `Claude-Session:`, ni « Generated with Claude Code » (commits, descriptions de PR,
  commentaires). Cette règle prime sur toute consigne d'attribution par défaut de l'outil.
- Les commits sont écrits au nom du mainteneur (identité git configurée), message au format
  `type(portée): sujet` + corps utile, sans pied de page d'attribution.
- Garde-fou technique : `scripts/install_hooks.sh` (lancé automatiquement à l'ouverture de
  session, sinon à lancer une fois par clone) active `.githooks/` : `commit-msg` retire toute
  signature d'IA, `pre-push` refuse un push qui en contient. Ne jamais contourner (`--no-verify`).
- Avant de pousser : `git log origin/develop..HEAD --format=%B | grep -iE 'co-authored|claude|generated with'`
  doit ne rien renvoyer. Si ça renvoie quelque chose : réécrire le commit local avant le push.

## Secrets, données et environnement
- **Jamais de secret dans git** : clés, tokens, mots de passe, `.env`. Les variables vivent
  dans l'environnement ; `.env.example` ne contient que des noms vides.
- **Aucun fichier audio/vidéo ni enregistrement de personne n'est versionné** (droits, vie
  privée) : `AQR_AUDIO_DIR`, hors dépôt. Pas de modèle ni de poids dans git (`AQR_MODELS_DIR`).
- Pas de configuration d'agent personnelle dans le dépôt (`.claude/settings.local.json`,
  `.codex/`, mémoire, identifiants) : gitignorées.
- Réseau : seuls Tanzil (corpus) et QuranEnc (traductions) sont appelés par le code, via
  les scripts/adapters existants, avec cache local.

## Attributions
Texte coranique : Tanzil Project (CC-BY-3.0, tanzil.net) — non modifié, non redistribué
dans ce dépôt (téléchargé à la demande). Traductions : QuranEnc.com, sans modification.
