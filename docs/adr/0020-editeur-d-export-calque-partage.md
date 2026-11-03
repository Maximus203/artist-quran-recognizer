# ADR-0020 — L'éditeur de la vidéo d'export : calque d'édition partagé, contrôleur, sections réutilisables, registre

- Statut : **accepté** — phase 2 de la refonte de l'export vidéo en éditeur interactif (décisions du mainteneur du
  2026-11-03, brief commun du chantier). Bâtit sur le noyau de l'ADR-0018 ; les phases suivantes (table de montage,
  pas à pas, choix du format d'éditeur, transport du fond vidéo) s'y branchent sans le modifier.
- Remplace : la pile de trois chapitres (« Ce que tu exportes », « À quoi elle ressemble », « Qualité et poids »), son aperçu
  collant et son dock du téléphone.

## Contexte

L'export vidéo était un formulaire : l'aperçu en haut, des réglages en dessous. L'éditeur voulu fait l'inverse — **l'aperçu est
l'éditeur** : on touche un élément (texte arabe, traduction, onde, sourate et verset), on le déplace, on change sa zone, on
pince pour la taille du texte, et les réglages de l'élément s'ouvrent à côté. Trois éditeurs mobiles (plateau, table de
montage, pas à pas) et une vue bureau unique doivent partager le geste, les réglages et leurs contrôles : le calque d'édition
est le composant le plus délicat, et le moins pardonnable s'il est écrit trois fois.

## Décision

1. **L'aperçu reste la vraie `drawFrame` ; des zones DOM transparentes se posent par-dessus.** Une zone par élément affiché,
   construite sur la boîte de la mise en page (`web/app/atelier/export/editor/edit-overlay.tsx`). Le texte n'est jamais redessiné
   en DOM : ce qu'on manipule est exactement ce qui sortira. Le calque ne sait rien du plateau : il reçoit la mise en page,
   l'élément choisi et des tailles, rend `onSelect`, `onBox`, `onSize` et n'écrit jamais dans les réglages.
2. **Les gestes sont une machine à états sans DOM** (`web/lib/export-video-gesture.ts`). Elle reçoit des échantillons de pointeur
   (appui, déplacement, relâchement, annulation) et rend des **effets** (choisir, toucher, déplacer, redimensionner, changer la
   taille, annoncer). Un effet `box` ou `size` a une **phase** : `live` (l'interface montre, n'enregistre rien), `end`
   (elle enregistre), `cancel` (elle rejette ; la valeur de départ est rendue). Seuil de glissement (4 px souris, 8 px doigt),
   aimants par axe (`snap` et `snapY` : 10 px d'écran valent des fractions différentes en largeur et en hauteur), pincement à
   deux doigts, annulation propre sur `pointercancel`, doigt qui reste après un pincement ignoré : tout se teste à froid
   (33 cas) et le calque ne fait que brancher les Pointer Events dessus (capture du pointeur, pas d'écouteur global, rien à
   nettoyer au démontage hors `reset()`). Les calculs sont ceux du noyau (`moveBox`, `resizeBox`, `pinchSize`…) : un geste, le
   clavier, la croix directionnelle et les champs de l'inspecteur donnent le même résultat.
3. **Un brouillon pendant le geste, un réglage au relâcher.** Le contrôleur (`use-editor-controller.ts`) garde le brouillon et
   montre à l'aperçu les réglages « comme si » ; le compte n'est écrit qu'à `end`. `patch` accepte une **fonction** qui part
   des réglages les plus récents : deux pas d'un appui long ne se perdent pas l'un l'autre. Toutes les modifications sont des
   fonctions pures testées (`web/lib/export-video-editor.ts` : boîte, taille, fond du texte, affichage des éléments, remise à
   la place d'origine).
4. **Toucher : zones d'appui de 44 px, vraie boîte inchangée.** Une ligne de sourate fait 11 px de haut dans un aperçu de
   téléphone : `hitLayout` agrandit la zone qu'on attrape à 44 px autour de son centre (jamais hors du cadre) ; le cadre de
   sélection, les champs et le rendu gardent la vraie boîte. Les huit poignées ont chacune 44 px de zone tactile, posées à
   l'extérieur ; sur une boîte plus étroite que deux poignées elles s'écartent vers l'extérieur et celles du milieu qui n'ont plus
   de place disparaissent (`handlePlacements` : jamais deux cibles l'une sur l'autre, propriété testée). Quand des éléments se
   chevauchent, toucher encore au même endroit passe à celui d'en dessous (`cycleBlock`), et les pastilles (Arabe · Traduction ·
   Onde · Verset · Cadre) restent le moyen sûr de choisir.
5. **Défilement.** Les éléments et les poignées ont `touch-action: none` ; le reste du calque `pan-y`. Glisser un élément ne
   fait jamais bouger la page ; la page défile partout ailleurs.
6. **Sections de réglages réutilisables.** Taille (`− 100 % +`, appui long qui répète, `stepSize`), fond du texte (aucun avec
   ombre douce ou contour, transparent, flou, plein ; six couleurs et une libre, transparence, arrondi ; l'arabe et la traduction
   indépendamment), position (croix directionnelle, champs Gauche/Haut/Largeur/Hauteur, centrer, remettre à la place d'origine),
   cadre (format, fond, passages en résumé court et fenêtre dédiée, réglages avancés). Ce sont les **mêmes composants** dans la
   feuille du téléphone (une section à la fois) et l'inspecteur du bureau (toutes, l'une sous l'autre) :
   `inspector-sections.tsx`. « Petit / moyen / grand » n'existe plus nulle part. **I1** : l'arabe n'a aucun champ de saisie
   (cadenas et phrase d'explication). **I2** : l'attribution de la traduction (`QuranEnc.com — …`, lue dans le résultat) est
   toujours collée à elle dans ses réglages.
7. **Intégration : `ExportEditor`, un registre.** `EditorMode = "plateau" | "table" | "pas"`, `ExportEditor({ mode, …EditorProps })`
   monte la **vue bureau unifiée** dès 1024 px, quel que soit le mode, et l'éditeur du mode en dessous. Le registre
   `editor-registry.tsx` porte une ligne par éditeur (les phases 3a et 3b ajoutent la leur) ; un mode sans éditeur retombe sur
   le plateau, tant que la préférence du compte (phase 4) n'existe pas. `EditorProps` est le contrat : réglages, source de
   l'aperçu, contrôles du cadre, passages, qualité, action d'export, retour.
8. **Un seul bouton « Exporter » ; la fenêtre-résumé reste ouverte pendant le rendu.** Il ouvre la fenêtre-résumé existante
   (le bordereau) au téléphone comme au bureau ; elle garde la progression et les vidéos prêtes, et le bouton du haut en
   porte l'état une fois la fenêtre fermée. Les passages (frise, liste, souffle) vivent dans leur fenêtre ; la qualité, la
   fluidité et le poids sous « Réglages avancés ». Sur l'onglet Vidéo l'éditeur prend la place de l'en-tête de la page (il a
   sa barre : retour, nom, Exporter).
9. **Fidélité aperçu / export.** Regarder une image de la vidéo produite a montré deux écarts, corrigés dans le noyau (à
   1080 px rien ne change) : le plancher de la sourate (14 px) ne suivait pas l'échelle (l'aperçu, plus petit, la montrait
   60 % plus grande que l'export), et l'espacement des barres de l'onde non plus (2× moins de barres dans l'aperçu à 720p).

## Choix pris seul

- L'aide du premier affichage (la main sur le texte arabe, une fois) est mémorisée **dans le navigateur** (`localStorage`),
  pas sur le compte : ce n'est pas un réglage de la vidéo, et le schéma des préférences n'a pas à porter un état d'aide.
- Pas de barre de position dans l'aperçu : le lecteur anime 10 secondes à partir du verset le plus long, avec le son.
- Aucune dépendance de test ajoutée (pas de jsdom ni de testing-library dans le projet) : la logique des gestes est testée sans
  DOM, le rendu des composants en HTML statique, les gestes réels au navigateur (Chrome DevTools, un et deux doigts).
- Le fond vidéo est un **emplacement** (`frame.backgroundVideo`) rempli par `BackgroundVideoSection` (ADR-0019, fond vidéo) : le panneau garde la
  valeur (`BackgroundVideoValue`), range `backgroundVideoPrefs` dans les réglages du compte, appelle `ensureClipOnServer` juste avant le
  rendu et passe `backgroundVideoRequest` à `exportVideoRequest`. La section héberge un envoi qui s'arrête à son démontage : la feuille « Fond »
  du téléphone et le volet « Cadre » du bureau restent montés (cachés) une fois ouverts, pour que fermer la feuille ou choisir un élément
  n'interrompe pas l'envoi.

## Conséquences

- La table de montage et le pas à pas réutilisent `EditableStage` (aperçu manipulable), `useEditorController`, les sections et
  `EditOverlay` tels quels ; ils n'écrivent que leur disposition.
- Les gestes sont éprouvés au toucher (un et deux doigts) et à la souris ; l'accessibilité au lecteur d'écran (annonces,
  rôles) est posée mais non testée avec NVDA ou VoiceOver.
- `video-look.tsx`, le dock et l'aperçu collant sont supprimés ; `Chapter` aussi.
