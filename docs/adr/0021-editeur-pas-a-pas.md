# ADR-0021 — L'éditeur « Pas à pas » de la vidéo d'export

- Statut : **accepté** — phase 3b de la refonte de l'export vidéo en éditeur interactif (décisions du mainteneur du
  2026-11-03, brief commun du chantier, maquette « Le pas à pas », direction C). Se branche sur l'ADR-0020 (calque
  d'édition, contrôleur, sections, registre) sans le modifier.

## Contexte

Le rôle `recitant` n'a pas la revue, pas les sous-titres, pas de réglage de format d'éditeur : il vient fabriquer une
vidéo. Son éditeur doit se comprendre sans une ligne d'explication, montrer **une seule chose à faire à l'écran**, et lui
permettre d'obtenir une belle vidéo sans rien régler. Les trois étapes de la maquette (Le cadre, Les textes, Exporter) y
répondent ; les réglages eux-mêmes existent déjà (sections partagées de l'ADR-0020).

## Décision

1. **Un éditeur de plus au registre, une ligne** (`pas: StepEditor`) ; il reçoit les mêmes `EditorProps` que le plateau.
   Il n'invente aucun réglage : chaque contrôle est une section partagée (`FormatSection`, `BackgroundSection`,
   `SizeSection`, `PanelSection`, `PositionSection`, `PassagesSection`, `AdvancedSection`) branchée sur le contrôleur
   `useEditorController`. Un réglage se comporte donc comme sur le plateau ou au bureau.
2. **La logique des étapes est pure** (`web/lib/export-video-steps.ts`, testée sans DOM) : l'ordre, `moveTo` (la garde :
   une étape inconnue ou la même ne change rien, le même objet revient ; quitter une étape vers l'avant la coche, revenir
   en arrière ne défait rien ; **aucune étape n'est verrouillée**), la lecture tolérante de la progression mémorisée (une
   valeur abîmée redonne le début), et l'élément ouvert à l'étape des textes.
3. **Progression mémorisée par récitation, dans l'onglet** (`sessionStorage`, clé `aqr.export-steps.v1:<id>`) : quitter
   l'éditeur et revenir, ou recharger, ramène à la même étape ; une autre récitation repart du début ; sans mémoire de
   navigateur rien ne casse. Pas sur le compte : ce n'est pas un réglage, c'est un fil de lecture.
4. **L'aperçu est verrouillé hors de l'étape des textes** : le calque d'édition partagé n'y est monté qu'à l'étape 2
   (`EditableStage interactive`). Arriver à l'étape 2 choisit l'élément ouvert, en partir ne laisse rien de choisi. Toucher
   l'aperçu change l'onglet ; toucher à côté garde l'élément ouvert : à cette étape un réglage est toujours ouvert.
5. **L'étape du cadre reste montée, cachée, quand on la quitte.** La section de la vidéo de fond arrête son envoi à son
   démontage : changer d'étape ne doit jamais l'interrompre (comme la feuille « Fond » du plateau). Mesuré au navigateur :
   une vidéo choisie à l'étape 1, puis les étapes 2 et 3, puis retour : l'envoi se termine (`data-phase="ready"`).
6. **Langage et accessibilité** : une phrase d'aide par étape, aucun terme technique en première ligne (qualité, fluidité et
   poids sont sous « Réglages avancés », à l'étape 3) ; cibles de 44 px au moins sur le bouton lui-même (Précédent, Suivant
   et Exporter font 52 px) ; pastilles `aria-current="step"` avec « (faite) » ; le changement d'étape est annoncé
   (`aria-live`) et le focus va au titre de l'étape ; `prefers-reduced-motion` coupe l'animation d'entrée (règle globale
   de `tokens.css`). Le texte arabe a son cadenas et sa phrase (jamais modifiable, I1) ; la traduction a son attribution
   collée à elle (I2).

## Choix pris seul

- « Précédent / Suivant » (et non « Retour / Continuer » de la maquette) : « Retour » est déjà la flèche de la barre du haut
  (elle quitte l'éditeur).
- Étape des textes : titre masqué visuellement (la pastille le dit), phrase d'aide réduite, aperçu un peu plus petit que sur
  les autres étapes : sur un téléphone de 360 px de large la place manque pour les réglages sinon.
- L'encart « Déjà prête » ne promet rien quand aucun passage n'est à exporter (il propose d'en choisir un) et montre l'état
  de l'export pendant le rendu.
- La fenêtre des passages (partagée par tous les éditeurs) a désormais des cibles de 44 px (numéro et nom d'une plage).
- Le récitateur ne demandait plus l'aperçu des sous-titres : cet appel (réservé aux autres rôles) répondait 403 à chaque
  ouverture de la page d'export (bruit en console, sans écran vide).

## Conséquences

- Le défaut du rôle `recitant` (mode `pas`) et le choix du format sont posés par la phase 4 ; tant qu'elle n'est pas là,
  `editorMode` vaut `plateau` et le pas à pas n'est atteint que par `ExportEditor mode="pas"`.
- Hors périmètre : lecteur d'écran non testé avec NVDA ou VoiceOver ; pas de barre de position dans l'aperçu animé (limite de
  la phase 2).
