# À faire dans Claude Code, dans l'ordre

0. Si `/artist-init` n'est pas reconnu par Claude Code : le repo `artist-skills`
   n'est pas encore déployé sur cette machine. Voir son `README.md`, section
   Installation (`artist-skill-sync/scripts/deploy-links.ps1`) — une fois par
   machine, avant tout le reste.
1. Ouvrir ce dossier dans Claude Code.
2. Lancer `/artist-init` — une fois, complète CLAUDE.md/AGENTS.md, pose les
   hooks adaptés à la stack détectée, installe browser-validation.
3. Si tu déposes un fichier de spec dans `docs/` (avant ou après le bootstrap),
   renseigne `project-meta.yaml → spec_file: <chemin>` — `artist-cadrage` le
   lira automatiquement, sans qu'on te redemande le scope.
   (Déjà renseigné : `docs/spec-v1.md`.)
4. Piste "projet complet" seulement : lancer `/artist-cadrage` avant d'écrire
   du code — désambiguïse la spec, écrit les acceptance-playbooks, ouvre le
   GATE Ready-to-fly.
5. Piste "projet complet" seulement : pour livrer en autonomie, `/artist-livraison`
   prend le relais une fois le GATE vert.
6. Optionnel : pour tracer ce projet dans le QG Notion (base Projets), utiliser
   le skill `qg-capture` — pas automatique, à la demande.

Puis : coller le contenu de `docs/PROMPT-CLAUDE-CODE.md` pour lancer la 1ʳᵉ brique en TDD.

Catalogue complet des skills : voir le `README.md` du repo `artist-skills` —
ne pas le dupliquer ici, il évolue.
