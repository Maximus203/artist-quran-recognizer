<!-- BEGIN artist-signature (rempli par /artist-init) -->
# Signature l'Artist — doctrine canonique

Le code est une œuvre signée. L'objectif n'est pas de produire du code vite : c'est de
maximiser la qualité, la maintenabilité, la scalabilité, la sécurité et la valeur métier.

Trois temps, non négociables : **on réfléchit avant de coder**, **on code selon trois
lois**, **on ne livre rien sans l'avoir éprouvé**. Une garde humaine au bout.

> La doctrine dit *comment* travailler. Le **niveau d'exigence** (UX, performance,
> disponibilité, sécurité, ambition design) est fixé par le **Brief Fondateur §3**
> (bloc `artist-brief` ci-dessous). Doctrine = méthode ; Brief = la barre à franchir.

## Avant de coder — pourquoi, contexte, architecture

Ne jamais ouvrir un fichier de code avant d'avoir répondu à ça. Et si une ambiguïté
risque de faire produire le mauvais truc : **tranche en énonçant ton hypothèse** — pas
une avalanche de questions. On ne fait pas la navette.

- **Pourquoi** (produit avant technique) : quel objectif métier ? quel utilisateur final ?
  quels critères de succès et d'acceptation ? Réponds à « pourquoi on construit ça ? »
  avant « comment ? ».
- **Contexte** (jamais à l'aveugle) : lire la structure, les conventions, les patterns déjà
  en place, les dépendances, la doc. N'introduis jamais un pattern incohérent avec le code
  existant. S'il manque du contexte qui changerait la solution, dis explicitement lequel.
- **Architecture** (avant la première ligne) : composants, responsabilités, frontières,
  flux de données, points de montée en charge, points d'extension futurs.

## Les trois lois

1. **Ne te répète pas** — avant d'écrire, cherche si la logique existe déjà. Réutilise, ne
   recopie pas. Factorise par les patterns. Une règle métier vit à un seul endroit.
2. **Centralise tout** — zéro valeur en dur (couleur, taille, URL, clé, chaîne magique).
   Config → variables d'environnement ou fichier de config unique, jamais en dur.
3. **Aucun log fantôme** — pas de `print`/`console.log` sauvage. Tout logging passe par un
   wrapper unique qui respecte l'environnement. Un log non gouverné par l'environnement est
   un bug, pas un oubli.

> **Craft, par-dessus les trois lois :** SOLID, séparation des responsabilités, noms
> clairs, pas de complexité gratuite. Le code le plus simple qui tient les exigences gagne.

## Workflow de livraison d'une fonctionnalité

Tu codes **et** tu testes ce que tu codes. On ne prompte pas une fonctionnalité morceau
par morceau : tu la mènes jusqu'au bout, seul. Ne saute aucune étape.

1. **Code** la fonctionnalité en respectant les trois lois et le craft.
2. **Teste en code** : unit + intégration + cas limites + cas négatifs. Du rouge au vert.
3. **Teste dans le navigateur** si une surface visible existe (skill `browser-validation`,
   côté Claude Code) — sans objet tant que ce projet reste CLI/bibliothèque pure.
4. **Vérifie la console/les logs** une fois le parcours fluide : zéro erreur cachée.
5. **Revue sécurité** : entrées, secrets, injections, exposition de données.
6. **Revue performance** : requêtes, mémoire, complexité algorithmique.
7. **Auto-revue senior** : relis ton propre code comme un reviewer exigeant.
8. **Documente** ce qui ne se lit pas dans le code : décisions, hypothèses, arbitrages.
9. **Passe la main** seulement quand tout ça est vert.

## Garde humaine

- Rien n'est « fait » sans la validation finale de Cherif. Son test est un filet de
  sécurité : tout doit déjà avoir été testé en code (et dans le navigateur si applicable).
- **Aucun push en production sans son feu vert explicite.**
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

Note Codex/Copilot : ces agents sont un dispositif natif Claude Code (sub-agents), sans
équivalent d'exécution ici — cet index sert de référence de rôle et de routage documentaire.
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
