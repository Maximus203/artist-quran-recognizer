# Export vidéo — la table de montage : chronologie, tête de lecture, fond vidéo sur la piste (phase 3a)
> Surfaces : [WEB] (mobile 360 / 390 / 430 px d'abord, tactile ; thèmes sombre et clair) · [CALC] (fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : `feat/export-editeur-table` @ a363fc1 (PR #206) · ADR-0023
> Périmètre : éditeur mobile « table de montage » (mode `table`) : aperçu partagé, chronologie (règle, passages, onde, piste du fond,
> tête de lecture), rail d'outils (Cadre, Arabe, Traduction, Onde, Verset, Fond, Passages), panneaux faits des sections partagées,
> aide du premier affichage, fond vidéo sur la chronologie, onde factorisée. Hors périmètre : plateau, pas à pas, bureau, choix du
> format (testé par ses propres playbooks).
> Environnement : atelier construit dans un worktree jetable, base de test jetable (`harness/h.mjs`), session d'essai de 20 s avec
> le texte du corpus (sourate 112, quatre passages de 5 s), vidéos d'essai de 3 s, 8 s, 20 s et 45 s (compteur de temps incrusté),
> compte `admin_test`. Jamais d'audio de personne.
> Gestes : Chrome piloté par Playwright ; au toucher, `Input.dispatchTouchEvent`. Script rejouable : `harness/proof-table.mjs`
> (`--size 360|390|430 --theme dark|light --export 1`), intégration : `harness/proof-table-gate.mjs`.
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués, console propre, aucun défilement horizontal de la page.

## Must-pass

### T.1 — [WEB] L'écran de départ est simple, et l'aide explique les mots
**Priorité** : critique · **Technique** : nominal
**Action** : ouvrir l'export vidéo en mode « table » pour la première fois.
**Attendu** : la chronologie entière, aucun panneau ; une aide qui explique « chronologie », « piste » et « tête de lecture » et reste
jusqu'à « Compris » ; plus jamais au deuxième affichage ; le « ? » la rouvre ; un seul bouton Exporter.
**Preuve** : `proof-table.mjs` (contrôles 1.), captures `01-aide-premier-affichage`, `02-depart` ; `table-editor.test.tsx` (aide).

### T.2 — [WEB] Déplacer la tête de lecture : glisser, boutons, clavier, passages
**Priorité** : critique · **Technique** : valeurs-limites, table-décision (geste × effet)
**Action** : glisser sur la règle (10 % → 60 %), sur l'onde ; ± 0,1 s, − 1 s, passage suivant / précédent, appui long ; poignée au clavier (→, Maj+→, Fin, Début).
**Attendu** : la tête se pose à ± 0,4 s du doigt (12 s, 6 s), l'aperçu change de passage, les pas sont exacts, l'appui long répète, Fin = 20 s, Début = 0.
**Preuve** : `proof-table.mjs` (contrôles 2.) ; `export-table-timeline.test.ts` (`playheadKey`, `movePlayhead`, `pxToTime`).

### T.3 — [WEB] La tête et la lecture de l'aperçu sont liées
**Action** : lancer l'aperçu animé depuis 5 s ; glisser la tête pendant la lecture ; relancer puis arrêter.
**Attendu** : la tête avance avec le son (5 → 7,1 s en 2,2 s) ; la déplacer arrête la lecture et elle ne bouge plus ; l'arrêt la laisse où il s'est fait.
**Preuve** : `proof-table.mjs` (« lecture… »), capture `04-lecture`.

### T.4 — [WEB] Zoom : la piste défile seule, la page jamais
**Priorité** : critique · **Technique** : valeurs-limites (niveau 1, 2, maximum)
**Action** : zoom ×2, tête jusqu'à la fin, glisser les passages, zoom maximal, « Tout ».
**Attendu** : la piste est plus large que l'écran (668 / 356 px), la tête reste visible, le défilement est dit, la page ne défile pas de côté, le zoom a une borne (×4 sur 20 s), « Tout » revient.
**Preuve** : `proof-table.mjs` (contrôles 3.), capture `05-zoom-x2` ; `export-table-timeline.test.ts` (`zoomLevels`, `scrollAfterZoom`, `scrollToReveal`).

### T.5 — [WEB] Le rail et les panneaux : deux états faciles à comprendre
**Action** : ouvrir chaque outil, revenir par « Chronologie » ; Échap ; toucher le texte arabe dans l'aperçu.
**Attendu** : Arabe, Traduction, Onde, Verset : la chronologie se masque, « Chronologie » la ramène ; Cadre, Fond, Passages : elle se réduit à l'onde et au fond ; Échap ferme ; toucher l'arabe ouvre ses réglages ; l'attribution de la traduction reste collée ; cibles de 44 px dans chaque état.
**Preuve** : `proof-table.mjs` (contrôles 4.), captures `06` à `10`.

### T.6 — [WEB] Fond vidéo plus court : répétitions, raccords, comportement
**Priorité** : critique · **Technique** : partition-équivalence (boucle, aller-retour, dernière image, ralenti)
**Action** : choisir une vidéo de 3 s sous 20 s ; toucher un raccord ⟲ ; choisir chaque comportement ; vérifier le panneau Fond.
**Attendu** : 6 raccords de 44 px, « en boucle ×6,5 », « environ 6,5 fois » ; aller-retour 6 raccords ; dernière image 1 raccord + image figée ; ralenti 0 raccord, « ralentie à 15 % » ; le panneau Fond montre le même comportement et ne redessine pas la bande ; 8 s : 2 raccords.
**Preuve** : `proof-table.mjs` (contrôles 5.), captures `11` à `14` ; `table-editor.test.tsx` (piste « Fond »).

### T.7 — [WEB] Fond vidéo plus long : glisser la bande
**Priorité** : critique · **Technique** : valeurs-limites (début, fin, au-delà)
**Action** : vidéo de 45 s sous 20 s ; glisser la bande de 100 px ; trop loin des deux côtés ; clavier ; ± 0,1 s et ± 1 s.
**Attendu** : 100 px = 6,4 s de départ (échelle de la piste) ; borné à 0 et à 25 s (45 − 20) ; valeurs « Partie utilisée : 0:06,4 → 0:26,4 sur 0:45,0 » ; → 0,1 s, Maj+→ 1 s, boutons exacts ; `aria-valuetext` lisible.
**Preuve** : `proof-table.mjs` (contrôles 6.), captures `16`, `17`, `18` ; `export-table-timeline.test.ts` (`offsetFromFilmDrag`).

### T.8 — [WEB] Même durée : rien à régler
**Action** : vidéo de 20 s sous 20 s.
**Attendu** : « rien à régler », ni raccord ni bande à glisser.
**Preuve** : `proof-table.mjs` (« même durée »), capture `15`.

### T.9 — [WEB] Un envoi de vidéo ne se coupe pas quand on change d'écran
**Action** : choisir une vidéo, ouvrir tout de suite « Arabe », revenir.
**Attendu** : la section reste montée, l'envoi aboutit, la chronologie montre la vidéo.
**Preuve** : `proof-table.mjs` (contrôles 7.).

### T.10 — [WEB] Deux VRAIS exports
**Priorité** : critique · **Technique** : preuve par l'état observé
**Action** : exporter (qualité légère) la vidéo de 3 s en boucle, puis la vidéo de 45 s avec un départ de 12 s ; extraire des images du MP4 livré.
**Attendu** : la vidéo de 3 s recommence à 3 s (image à 3,5 s = image à 0,5 s, écart 2,5 contre 12,1 avec l'image à 1,5 s) ; l'image à 2 s de l'export porte le compteur `00:00:14.000` de la source (12 + 2).
**Preuve** : `proof-table.mjs --export 1`, images `boucle-0s5/3s5/1s5.png`, `portion-2s.png`, `portion-contre-source.png`.

### T.11 — [WEB] Intégration avec le choix du format
**Action** : compte admin sans choix enregistré, 390 px : ouvrir l'export vidéo, choisir « Table de montage », recharger.
**Attendu** : la fenêtre de choix s'affiche, le choix mène à la table, il est enregistré sur le compte et retrouvé au rechargement sans question.
**Preuve** : `proof-table-gate.mjs` (8 contrôles), captures `shots-table-gate/390/`.

### T.12 — [CALC] Logique pure
**Attendu** : zoom, conversions, défilement, règle, tête, blocs, segments du fond, pastille, image fixe, glisser le film, onde (crêtes, barres, dessin).
**Preuve** : `export-table-timeline.test.ts` (54 cas), `export-wave.test.ts` (10 cas), `table-editor.test.tsx` (25 cas de rendu).

## Must-fail

### F.1 — [WEB] Aucun texte coranique dans la chronologie (I1, I2)
**Attendu** : la chronologie ne montre ni le texte arabe ni la traduction ; les passages portent un numéro.
**Preuve** : `table-editor.test.tsx` (« jamais de texte coranique ni de traduction… »).

### F.2 — [WEB] Pas de passage avant le début ni après la fin
**Attendu** : « passage précédent » au début ne bouge pas et le dit (`aria-live`).
**Preuve** : `proof-table.mjs` (« pas de passage avant le début : annoncé »).

### F.3 — [WEB] Glisser la bande trop loin ne sort pas des bornes ; zoom au-delà de la borne désactivé
**Preuve** : `proof-table.mjs` (6. « trop loin », 3. « le zoom a une borne »).

### F.4 — [WEB] Une vidéo choisie mais un autre fond sélectionné : la piste montre ce fond, pas la vidéo
**Preuve** : `table-editor.test.tsx`.

## Preuves (2026-11-03)

- `harness/proof-table.mjs` : 96 / 96 (360 dark, 430 light, 360 light), 99 / 99 avec exports (390 dark, 390 light, et sur la branche fusionnée avec #204 et #205). Aucune erreur de console. Cibles : tête de lecture et raccords 44 × 44 px.
- Hauteur de l'aperçu à 390 px : 190 px chronologie visible, 179 px avec un panneau d'élément, 131 px avec Cadre ou Fond.
- Écarts connus : lecteur d'écran non testé (NVDA, VoiceOver) ; « vidéo d'origine » sans vignettes sur la piste ; la page garde son défilement vertical (la bibliothèque des vidéos est sous l'éditeur, comme pour le plateau).
