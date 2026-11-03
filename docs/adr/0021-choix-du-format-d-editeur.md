# ADR-0021 — Le choix du format d'éditeur d'export (téléphone) : règle unique, préférence du compte, fenêtre explicative

- Statut : **accepté** — phase 4 de la refonte de l'export vidéo en éditeur interactif (décisions du mainteneur du 2026-11-03,
  brief commun du chantier). Bâtit sur le registre des éditeurs de l'ADR-0020 sans le modifier.

## Contexte

Trois éditeurs existent pour le téléphone (plateau, table de montage, pas à pas) ; au bureau la vue est unique. Il faut décider
LEQUEL montrer à qui, demander son goût une seule fois à ceux qui peuvent le dire, le retenir sur le compte (pas sur l'appareil),
le rendre modifiable, et ne jamais poser de question au récitateur (interface réduite).

## Décision

1. **Une seule règle, pure et testée** : `web/lib/export-editor-mode.ts`. Une table par rôle (`fallback`, `asks`, `canChoose`)
   alimente `defaultEditorModeFor(role)`, `shouldAskEditorMode({ role, saved, wide })`, `effectiveEditorMode`,
   `canChooseEditorMode` et `editorChoiceFor` (la décision de l'écran en un appel). Aucun `if (role === …)` ailleurs. Un rôle
   inconnu : ni question ni section, plateau. Les modes (`EDITOR_MODES`, `EditorMode`) vivent là (importables par le schéma
   des préférences sans toucher à React) ; `editor-types.ts` les ré-exporte.
2. **Préférence `editorMode`** dans `preferencesShape` : `plateau | table | pas | null` (`null` = jamais choisi). Mécanisme existant :
   écriture validée par le serveur (`.strict()`, 400 sans rien écrire), horodatage par clé, `DELETE ?key=`. Une valeur inconnue en
   base (futur format) est lue comme `null` sans perdre le reste ; un ancien client qui n'envoie pas la clé ne l'efface pas ;
   un cache local d'avant la clé garde désormais ses modifications en attente (`parseCache` ne jette plus un cache auquel il
   manque une clé).
3. **Qui est interrogé** : testeur (`user`) et administrateur, sur téléphone (< 1024 px), jamais choisi, pas reporté. Le récitateur :
   Pas à pas par défaut, aucune question ; le défaut du rôle n'est PAS écrit sur le compte (changer le défaut d'un rôle plus tard
   atteint tout le monde ; seul un vrai choix se grave).
4. **La question** : une fenêtre modale (focus piégé, Échap, focus d'abord sur la question) et non une page : elle précède l'éditeur
   sans le monter derrière. Trois cartes, UN geste par carte (le bouton nomme son format) : pas de case à cocher puis valider.
   Rien n'est coché d'avance. Même composant dans les paramètres (`EditorModeCards`) : mêmes mots (`mode-info.ts`), mêmes animations.
5. **« Choisir plus tard »** (décision de design) : le plateau pour cette séance du navigateur (`sessionStorage`), on redemande à la
   visite suivante, jamais sur le compte. Raison : ne pas harceler quelqu'un qui enchaîne plusieurs exports, ne pas l'oublier non plus.
   Échap = plus tard (on ne force pas un choix). Un stockage bloqué fait redemander (le moindre mal).
6. **Motion design** : du SVG et du CSS (`transform` et `opacity` seulement), 9 s en boucle, aucune bibliothèque (`gsap` est dans le
   projet, volontairement inutilisé), aucune vidéo ; des barres de texte, jamais une lettre d'arabe. Sans mouvement
   (`prefers-reduced-motion`) : le CSS cache l'animation et montre trois images fixes, les trois temps de la MÊME animation gelés par un
   retard négatif (rien n'est dessiné deux fois), avec légendes en vrai texte. Le dessin est muet pour les aides techniques ; l'image porte
   un texte alternatif qui raconte les trois temps. Bouton de pause (WCAG 2.2.2). Couleurs : jetons du design système uniquement.
7. **La porte** `ExportEditorGate` (au-dessus de `ExportEditor`, qui reste « mode en entrée, éditeur en sortie ») lit rôle et préférence et
   applique `editorChoiceFor`. `VideoPanel` perd sa propriété `editorMode` (plus personne ne la passait).

## Conséquences

- Les phases « table de montage » et « pas à pas » n'ont rien à faire ici : elles s'enregistrent dans `editor-registry.tsx` ; tant qu'un
  mode n'a pas d'éditeur le registre retombe sur le plateau et le choix reste enregistré.
- Une nouvelle option de format = une ligne dans `EDITOR_MODES`, une dans `MODE_INFO` et une animation.
- Non couvert : lecteur d'écran (NVDA, VoiceOver) non testé ; pas de tableau de bord de ce que les testeurs choisissent.

## Alternatives écartées

- Préférence dans le navigateur : perdue d'un appareil à l'autre, contraire à la décision (préférences du compte).
- Écrire le défaut du récitateur sur son compte : fige un défaut qui doit pouvoir évoluer.
- Pré-cocher un format ou choisir puis valider : deux gestes et un biais.
- Une bibliothèque d'animation ou une vidéo : poids et risque sans bénéfice pour trois boucles de 9 s.
