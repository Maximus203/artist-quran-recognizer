<!-- BEGIN artist-signature (rempli par /artist-init) -->
Doctrine complète : voir `AGENTS.md` (même contenu, portable Claude Code / Codex / Copilot).

**Spécificités Claude Code** : test navigateur via l'extension **Claude in Chrome**, skill
`browser-validation` — projet actuellement sans interface web (CLI + bibliothèque Python) ;
la boucle s'applique dès qu'une surface visible apparaît (dashboard, API exposée en UI...).
Ne jamais solliciter Cherif pour valider avant d'être soi-même au vert (tests + revue).
<!-- END artist-signature -->

<!-- BEGIN artist-brief (rempli par /artist-init) -->
<!-- snapshot du Brief Fondateur (Notion 37ba5949-b309-8142-8df6-e3f353333f0d) — généré le 2026-09-25 -->
**Qui** : Cherif Diouf, alias « l'Artist » — Fondateur/CEO Artist Digital (artist-dev.com),
professeur ESTM Dakar, doctorant UN-CHK, chef de projet TerangaDev. Basé à Dakar, Sénégal.

**Standards non-négociables (Definition of Done, §3 du Brief)** :
- UX/UI exigence haute — jamais l'apparence "template par défaut", mobile-first, hiérarchie
  visuelle nette, micro-interactions soignées, accessibilité. Vitrines → niveau Awwwards 2026.
- Performance : chargement perçu rapide, pas de jank, lazy-loading, requêtes optimisées.
- Disponibilité : pensé pour tourner en prod (santé, logs, dégradation gracieuse).
- Sécurité validée par défaut (entrées, authz/authn, secrets, surface d'attaque) — pas une
  option de fin de projet.
- Doctrine de code : TDD, design patterns, Clean Architecture — non négociables.

**Préférences de livraison (§4 du Brief)** :
- Jamais de commandes à taper manuellement pour une grosse config/séquence : un
  `CLAUDE.md`/prompt prêt pour Claude Code, ou un script bash autonome en une seule action.
- Aller à l'essentiel, pas de remplissage — repère le bullshit.
- Décision structurante en jeu → 2-3 options tranchées avec arbitrages, pas de "ça dépend".

Page canonique (source de vérité, à re-consulter si ce snapshot date) :
https://app.notion.com/p/37ba5949b30981428df6e3f353333f0d
<!-- END artist-brief -->

<!-- BEGIN artist-agents (rempli par /artist-init) -->
## Agents disponibles pour ce projet (`~/.claude/agents`)

- `cherif` — orchestrateur principal, cadre la mission et route vers les spécialistes. Voir `~/.claude/agents/cherif.md`.
- `ibrahima` — développeur senior / architecte logiciel, TDD et design patterns. Voir `~/.claude/agents/ibrahima.md`.
- `cherif-qa` — testeur QA sceptique, exécute les playbooks et rapporte avec preuves. Voir `~/.claude/agents/cherif-qa.md`.

`sofia` (direction artistique) existe dans le registre global mais n'est pas pertinente ici :
ce projet n'a pas d'interface (CLI + bibliothèque Python). À réévaluer si une UI apparaît.
<!-- END artist-agents -->

<!-- BEGIN artist-tokens -->
## Sobriété de contexte (règles permanentes)
- Réponses concises par défaut : va droit au résultat, saute le préambule et
  la narration. Reste exhaustif pour une explication demandée, un rapport
  d'erreur, une alerte de sécurité, une confirmation d'action destructive.
- CLAUDE.md / règles de projet : ne documente que ce que le code ne dit pas
  déjà.
- Fichier plutôt que texte collé au-delà d'environ 30 lignes.
- PDF en entrée -> Markdown immédiatement ; PDF en sortie -> seulement à la
  demande finale explicite.
- Filtre les sorties d'outils bruyantes avant de les lire en entier.
<!-- END artist-tokens -->

<!-- BEGIN projet-aqr -->
## Projet — invariants et méthode (détail : docs/ARCHITECTURE.md)
- **I1** Le texte arabe restitué vient TOUJOURS du corpus (lookup `VerseRef`), jamais d'un modèle.
  Aucun LLM génératif dans la chaîne (docs/adr/0001).
- **I2** Traductions QuranEnc restituées sans modification, avec id + version + attribution.
- **I3** Nommer un faux verset est pire que n'en nommer aucun : la précision prime sur le rappel.
- **I4** Toute parole non coranique (français, hadiths, dou'a, khutba) → `NON_QURAN`, 0 verset.
- **I5** Chaque détection porte un statut de preuve : RECOGNIZED / INFERRED / UNCERTAIN.
- `src/aqr/domain` n'importe rien d'externe. Les modèles lourds vivent dans `src/aqr/adapters`,
  derrière les ports de `domain/ports.py`, et passent les tests de `tests/contract/`.
- TDD strict : test rouge → code → vert. Chaque bug vu sur un vrai audio devient d'abord un cas
  dans `tests/fixtures/audio/manifest.yaml`. Le « done » = `.artist/acceptance-playbooks/`.
- Seuils et probabilités (gate, décodeur) = configuration calibrée par benchmark, jamais en dur.
- Vérifier avant de dire « fait » : `pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy`.
<!-- END projet-aqr -->
