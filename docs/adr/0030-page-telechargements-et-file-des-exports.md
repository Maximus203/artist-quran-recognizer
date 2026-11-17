# ADR-0030 — Une seule page « Téléchargements » pour les exports, prêts et en file

- Statut : **accepté** — demande du mainteneur (2026-11-17). Prolonge la page « Fichiers » et le quota de 2 Go (PR #223) et la file
  d'exports confiés au serveur (`web/lib/video-jobs.ts`). Aucun effet sur les invariants I1 à I5 (aucun texte coranique ni
  traduction n'est touché).

## Contexte

Un export vidéo se lance depuis une récitation et son avancement n'y était visible que dans cette récitation. La page « Fichiers »
ne listait que les vidéos déjà gardées. Un utilisateur qui enchaîne des exports dans plusieurs récitations ne voyait nulle part
ce qui attendait, tournait, échouait ou était prêt.

## Décision

1. **Une seule page, une seule source.** « Fichiers » est étendue et renommée « Téléchargements » (`/telechargements`,
   `GET /api/downloads`) ; `/fichiers` redirige, `/api/files` disparaît. Pas de seconde page concurrente.
2. **Pas de nouvelle file.** Les exports passent déjà par la file des analyses (`jobQueue`) : une charge lourde à la fois, équité
   entre comptes, délai maximal. Le plafond propre aux exports (2 par compte) est retiré : la file applique le plafond d'attente
   commun (`AQR_MAX_WAITING_PER_USER`, 5). Un export refusé ne laisse ni fiche ni dossier. Le serveur 2 Go n'est pas plus chargé
   qu'avant : toujours un rendu à la fois.
3. **Service de composition** (`web/lib/downloads.ts`) : il fusionne fichiers prêts et exports en file, par récitation, et applique
   les règles d'accès (`access.ts`) : un fichier est visible si sa récitation l'est (propriétaire, portée publique, administrateur) ;
   un export en file est visible à son lanceur et à l'administrateur, tant que le lanceur voit encore la récitation. Supprimer :
   propriétaire de la récitation ou administrateur ; annuler : lanceur ou administrateur. La route ne fait que sérialiser.
4. **Un export terminé n'apparaît pas deux fois** : s'il a produit assez de fichiers gardés depuis son lancement, seule la vidéo
   gardée est listée ; sinon (espace plein), l'export reste téléchargeable depuis la file pendant une heure.
5. **Actualisation** par relevés (`lib/downloads-poll.ts`) : 2,5 s tant qu'un export est actif, 15 s sinon, ralenti onglet caché.

## Conséquences et limites

- La liste des exports en file est en mémoire du serveur (comme avant) : un redémarrage l'efface ; les vidéos gardées restent.
  Un export échoué ou terminé disparaît de la liste après une heure.
- Les fichiers des récitations publiques d'autres comptes sont visibles (ils l'étaient déjà dans la liste « Vidéos de cet
  enregistrement » de la récitation) ; ils ne comptent que dans l'espace de leur propriétaire.
- Aucune migration de base de données.
