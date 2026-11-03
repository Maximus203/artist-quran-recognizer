# ADR-0023 — La table de montage : une chronologie sur l'axe de toute la session

- Statut : **accepté** — phase 3a de la refonte de l'export vidéo en éditeur interactif (décisions du mainteneur du
  2026-11-03, brief commun du chantier, maquette « La table de montage »). Bâtit sur l'ADR-0020 (calque d'édition, contrôleur,
  sections, registre) et sur l'ADR-0019 (vidéo de fond) sans les modifier.

## Contexte

La vidéo de fond n'a presque jamais la durée de la récitation : plus courte, elle se répète ; plus longue, il faut choisir
quelle partie l'accompagne. Une feuille de réglages le dit en mots ; une chronologie le **montre** (les répétitions, leurs
raccords, la portion). La table de montage est l'éditeur mobile qui range l'export autour de cette chronologie : aperçu,
chronologie, rail d'outils. Risque assumé : c'est un outil de monteur, donc le plus technique d'allure des trois éditeurs ;
le vocabulaire (« piste », « tête de lecture ») est expliqué au premier affichage et à la demande.

## Décision

1. **L'axe est celui de TOUTE la session, pas d'une vidéo concaténée.** Chaque plage exportée est une vidéo (ADR-0018) : la
   chronologie montre l'audio entier avec ses plages, et la vidéo de fond recommence ou glisse sous **chaque** plage depuis
   son propre début (`filmSegments`, qui réutilise `describeFit`, `loopSeams` et `filmView` : aucune règle n'est recalculée).
   Un seul départ vaut pour toutes les plages, borné pour la plus longue (comme la section « Vidéo de fond »). La maquette
   concaténait les versets choisis ; le produit ne le fait pas.
2. **La logique est pure et testée** (`web/lib/export-table-timeline.ts`, 54 cas) : niveaux de zoom (jamais plus de 90 px par
   seconde ni 8 000 px de piste), conversions temps ↔ pixels, défilement qui garde la tête visible et ancre le zoom,
   règle, touches de la tête de lecture, blocs des passages, segments de la piste du fond, pastille, glisser le film.
3. **La tête de lecture vit dans un magasin observable** (`createStore`, comme le lecteur). Sa ligne, sa bulle et la couleur
   de l'onde (deux couches, la lue rognée par CSS jusqu'à la tête) suivent le doigt ou la lecture sans redessiner la
   chronologie. L'aperçu immobile reçoit l'instant par `at`, au plus une fois par image d'écran. La lecture animée part de la
   tête et la fait avancer (`VideoPreview` : `playFrom`, `onTime`, `clipRange`, `stopToken`, tous facultatifs) ; déplacer la
   tête pendant la lecture l'arrête et rend la main au doigt.
4. **L'onde est factorisée** (`web/lib/export-wave.ts` : crêtes, barres, dessin ; `use-theme-tick.ts`) : la frise des passages
   et la table de montage dessinent la même onde par le même code.
5. **Les vignettes de la vidéo de fond sont lues une fois par fichier** (`use-film-frames.ts`, cache par fichier, arrêt quand
   plus personne ne regarde) : la section « Vidéo de fond » et la chronologie les partagent.
6. **Trois états lisibles** : chronologie entière ; un panneau d'élément ouvert la masque (sinon l'aperçu devient minuscule) avec
   un bouton « Chronologie » pour revenir ; un panneau du cadre (cadre, fond, passages) la réduit à l'onde et au fond.
   La section « Vidéo de fond » reste montée dès la première ouverture du panneau Fond (elle arrête son envoi à son démontage) ;
   posée à côté de la chronologie (`BackgroundVideoLayout = "timeline"`), elle ne redessine pas la bande ni la fenêtre.
7. **Accessibilité** : cibles de 44 px sur le bouton lui-même (la poignée de la tête et les raccords ⟲ compris, la piste a une
   marge de 22 px pour que la poignée déborde sans créer de défilement), une alternative au glisser pour tout (boutons,
   clavier, passage suivant), `aria-live`, aide du premier affichage mémorisée dans le navigateur (propre à cet éditeur).

## Alternatives écartées

- **Concaténer les plages sur l'axe** (la maquette) : faux pour l'export, où chaque plage est une vidéo.
- **Une chronologie dessinée entièrement sur un canevas** : pas de cibles tactiles ni de lecteur d'écran. Seule l'onde est un
  canevas ; règle, passages, fond et poignée sont du DOM.
- **Défilement par état (fenêtre `a`–`b` de la frise des passages)** : le défilement natif d'un conteneur donne l'inertie du
  doigt et le clavier gratuitement ; le zoom est un niveau discret.

## Conséquences

- `EditorProps` gagne `montage?` (plages exportées, plus longue, vidéo de fond, de quoi la changer), rempli par `VideoPanel`.
- Le fond « vidéo d'origine » n'a pas de vignettes sur la piste (teinte neutre) ; le lecteur d'écran n'est pas testé avec
  NVDA ou VoiceOver ; la lecture animée de l'aperçu dure toujours 10 secondes.
