# ADR-0018 — Mise en page de la vidéo par blocs (boîtes, styles de texte, fond de texte, fond vidéo)

- Statut : **accepté** — noyau (phase 1) de la refonte de l'export vidéo en éditeur interactif, décisions du mainteneur du
  2026-11-03 (brief commun du chantier). Les éditeurs (plateau, table de montage, pas à pas), la vue bureau et le choix du
  format d'éditeur sont les phases 2 à 4 et bâtissent sur ce contrat.
- Remplace : le bloc unique de texte (`layoutCard` empilant référence, arabe et traduction dans la zone libre, avec
  `textPosition`, `fill` et `showWave` globaux).

## Contexte

Un éditeur où l'on touche, déplace et redimensionne chaque élément (texte arabe, traduction, onde, sourate et verset) ne se
construit pas sur un seul bloc empilé. Il demande aussi un fond de texte au choix (aucun, transparent, flou, plein) pour
l'arabe comme pour la traduction, des tailles relatives au lieu de « petit / moyen / grand », et un fond vidéo qui n'a presque
jamais la durée de la récitation.

## Décision

1. **Quatre blocs, chacun dans sa boîte.** `ExportLayout = { ref, arabic, translation, wave }`, chaque boîte `{ x, y, w, h }`
   en fractions du cadre (0–1), **une mise en page par forme de cadre** (16:9, 9:16, 1:1 ; « comme la vidéo » suit la forme la
   plus proche, `layoutKeyFor`). Les styles (`TextStyle`) sont partagés par les trois formats : un verset s'ajuste à chaque
   boîte par la réduction décrite plus bas. Code : `web/lib/export-video-model.ts`.
2. **`layoutCard` place chaque bloc dans sa boîte** (`web/lib/export-video-layout.ts`) : retour à la ligne puis réduction
   homothétique **par bloc** jusqu'à tenir (plancher 40 %), puis dichotomie pour retrouver la plus grande taille qui tient
   (réduire change le nombre de lignes : sans cela le premier facteur qui tient pouvait être de 25 % trop petit). La
   réduction est **rapportée** (`fit`, `note` « réduit à 87 % », `overflow` quand la zone est trop petite). `wrapArabic`,
   `wrapTranslation` et `MIN_FIT` sont inchangés. **I1** : l'arabe n'est que découpé. **I2** : la traduction n'est que découpée ;
   son attribution, quand on la fournit, est placée **dans le bloc de la traduction**, collée dessous (le rendu ne la fournit
   toujours pas : choix du mainteneur du 2026-10-27).
3. **Style de texte** : `size` relatif (1 = taille par défaut, dans la vidéo de référence de 1080 px de côté court : arabe 72,
   traduction 30, référence 26), `fill` (remplir la zone), `valign` (début, milieu, fin de la boîte) et `panel`
   (`none | transparent | blur | solid`, couleur, opacité, arrondi, lisibilité ombre ou contour, étendue texte ou boîte).
   Les trois textes ont chacun le leur ; le fond de l'arabe et celui de la traduction sont indépendants.
4. **Fond de texte** (`web/lib/export-video-panels.ts`) : « transparent » reprend le voile aux bords adoucis d'avant ;
   « plein » est opaque ; « aucun » rend le texte lisible par une ombre douce ou un contour ; « flou » redessine le décor flouté
   (voir *Mesures*). Le voile « automatique » d'avant (sur photo ou vidéo seulement) n'est plus implicite :
   `autoPanelKind` / `applyBackgroundPanels` l'appliquent à la demande quand on change de fond, sans toucher un fond choisi.
5. **Fond vidéo** (`web/lib/export-video-vtime.ts`) : `vtime(t, { videoDuration, audioDuration, offset, mode })` donne
   l'instant de la vidéo à montrer (boucle, aller-retour, figé, ralenti ; plus longue : portion à partir du départ ; même durée :
   rien à régler), `describeFit` le dit en français clair, `loopSeams` donne les raccords. Le temps est **local à chaque vidéo
   exportée** (une plage = une vidéo) ; le **départ est unique** pour toutes les plages, borné pour chacune. La vidéo de fond
   est **muette** : le mux ne lit que la copie d'écoute (`-map 0:v:0 -map 1:a:0`, testé).
6. **Préférences** (`web/lib/export-video-prefs.ts`) : le schéma passe au nouveau modèle ; l'ancien format à plat est
   **converti à l'identique au chargement** (`z.preprocess`) : `arabicSize`/`translationSize` (px) → `size` relatif, `textPosition`
   → les trois boîtes déplacées ensemble, `fill`, onde et écritures gardés, voile selon le fond, valeur absente ou corrompue →
   défaut, jamais d'échec. À la lecture, le serveur récupère un objet abîmé **champ par champ** (`sanitizeVideoPrefs`) au lieu
   de perdre tous les réglages du compte. Le mécanisme (`preferences-schema.ts`, `prefs-sync.ts`, `useShell().prefs`) ne change
   pas. La préférence « format d'éditeur » est la phase 4.
7. **Transport vers l'export serveur.** L'export lancé depuis l'atelier est rendu **sur le serveur** par le JSON de « Même
   export par l'API ». Pour qu'il soit celui de l'aperçu, l'API accepte en plus `layouts`, `styles` et `show_ref`
   (facultatifs, mêmes schémas, l'emportent sur `text_position`, tailles à plat et `fill`) ; `exportVideoRequest` ne les ajoute
   que quand les options à plat ne redonnent pas les réglages. Les options à plat (tailles en points, noms « small » à « xlarge »)
   ne changent pas pour leurs appelants.
8. **Aides à l'édition pures** (`web/lib/export-video-edit.ts`) : déplacement et redimensionnement d'une boîte avec aimant
   sur le centre et les marges (renvoie les repères actifs), bornes, clavier (1 % / 5 %, Ctrl = zone), pixels d'écran ↔
   fractions, taille par pas (≈ 6 %) et pincement.

## Défauts

Les boîtes par défaut reproduisent l'ancien rendu : texte sur 84 % de la largeur (86 % en portrait), pile centrée dans la
zone libre (5 % de marge en haut, au-dessus de l'onde), onde sur toute la largeur en bas (22 % de la hauteur, 16 % en
portrait). Une pile qui s'adapte à chaque verset ne peut pas être reproduite par des boîtes fixes ; c'est la **capacité**
qui est conservée : mesuré au navigateur sur Al-Baqara 2:255, le paysage (4 lignes d'arabe, 2 de traduction) et le portrait
(7 lignes, 4 de traduction) tiennent à 100 %, comme l'ancien rendu. Un verset court, lui, laisse de l'air entre les trois
blocs au lieu de les serrer.

## Mesures — fond flouté (le risque levé)

Banc jetable (non versionné), Chrome 156 piloté par Playwright, Intel Core Ultra 9 275HX, 1920×1080, 300 images, lecture du
canevas comprise, encodage non compris. Chiffres et conclusions : `.artist/decision-log.md`, « Fond flouté ».

## Conséquences

- La clé de réutilisation d'une vidéo (`videoKey`) change de forme (`v: 2`) : les vidéos gardées avant ce changement ne sont
  plus reconnues « identiques » et sont refaites une fois.
- Les anciennes options `ARABIC_SIZE_PRESETS` / `TRANSLATION_SIZE_PRESETS` ne vivent plus que dans l'API.
- **Reste à faire** (phases suivantes ou chantier à part) : l'envoi au serveur du **fichier** de la vidéo de fond (le rendu du
  serveur est un navigateur sans interface qui ne peut pas lire un fichier resté sur l'appareil ; `apiDifferences` le signale) ;
  tout l'interface d'édition.
