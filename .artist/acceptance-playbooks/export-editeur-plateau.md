# Export vidéo — l'éditeur : plateau mobile, vue bureau, calque d'édition partagé (phase 2)
> Surfaces : [WEB] (mobile 360 / 390 / 430 px d'abord, puis 1280 px ; thèmes sombre et clair) · [CALC] (fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : `feat/export-editeur-plateau` @ 27baa2a (PR #202) · ADR-0020
> Périmètre : calque d'édition partagé, sections de réglages (taille, fond du texte, position, cadre), plateau (< 1024 px),
> vue bureau unifiée (≥ 1024 px), `ExportEditor` + registre, retrait des boutons « petit / moyen / grand ». Hors périmètre :
> table de montage, pas à pas, choix du format d'éditeur.
> Environnement : atelier construit dans un worktree jetable, base de test jetable (`harness/h.mjs`), session d'essai avec le
> texte du corpus (sourate 112) et traductions d'essai, comptes `admin_test` et `recitant_test`. Jamais d'audio de personne.
> Gestes : Chrome piloté par Playwright ; au toucher, `Input.dispatchTouchEvent` (un et deux doigts) ; à la souris, événements
> souris réels. Script : `harness/proof-editor.mjs` (rejouable).
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués, console propre, aucun défilement horizontal.

## Must-pass

### E.1 — [WEB] Choisir un élément en le touchant ; ses poignées apparaissent
**Priorité** : critique · **Technique** : nominal
**Action** : toucher (clic au bureau) le texte arabe dans l'aperçu.
**Attendu** : l'élément est choisi (`aria-pressed`), son cadre et son étiquette (« Arabe ») apparaissent, huit poignées de 44 × 44 px.
**Preuve** : `proof-editor.mjs` (contrôles « choisi », « poignées : zone de 44 px »), captures `02-arabe-choisi`.

### E.2 — [WEB] Glisser, avec repères et aimant ; la page ne défile pas
**Priorité** : critique · **Technique** : transition-état (appui, glissement, relâcher)
**Action** : glisser l'arabe ; le glisser près du centre du cadre.
**Attendu** : l'élément suit le doigt, reste dans le cadre ; le repère de centre s'affiche près du centre et l'élément s'y pose (écart < 1,5 px) ; `scrollY` ne bouge pas.
**Preuve** : `proof-editor.mjs` (« glisser : repère de centre visible », « s'aimante au centre », « la page n'a pas défilé »).

### E.3 — [WEB] Poignée : la zone change, le coin opposé reste
**Action** : tirer la poignée du coin bas-droit.
**Attendu** : largeur et hauteur changent, le coin haut-gauche ne bouge pas.
**Preuve** : `proof-editor.mjs` (« poignée »).

### E.4 — [WEB] Pincer à deux doigts : la taille du texte
**Priorité** : critique · **Technique** : valeurs-limites (écart de départ, ouverture, fermeture)
**Action** : deux doigts écartés puis rapprochés sur l'arabe.
**Attendu** : la taille monte puis descend (affichée en pourcents) ; la page ne défile pas.
**Preuve** : `proof-editor.mjs` (« pincer… », 100 % → 244 % → 130 %) ; `export-video-gesture.test.ts` (pincement, annulation, doigt qui reste, écart nul, troisième doigt).

### E.5 — [WEB] Clavier : flèches 1 %, Maj 5 %, Ctrl = zone, + / −, Échap, annonces
**Priorité** : critique · **Technique** : table-décision (touche × modificateur)
**Action** : Tab jusqu'à la zone de l'arabe, 3 × →, Maj + ↓, Ctrl + →, +, −, Échap.
**Attendu** : 3 % du cadre, 5 %, +1 % de largeur (coin haut-gauche fixe), taille ± un pas, désélection ; `aria-live` annonce chaque geste ; anneau de focus visible.
**Preuve** : `proof-editor.mjs` (« clavier », « aria-live », « focus ») ; `export-video-gesture.test.ts` (`keyAction`).

### E.6 — [WEB] Taille : − / +, appui long qui répète, valeur toujours visible
**Action** : « + », « − », « + » tenu 1,7 s, puis la valeur (remise à 100 %).
**Attendu** : 100 → 106 → 100 ; tenu : au moins 118 % sans relâcher ; la valeur remet à 100 % ; aucun « petit / moyen / grand » nulle part.
**Preuve** : `proof-editor.mjs` ; `editor.test.tsx` (« − 100 % + », bornes) ; `export-video-edit.test.ts` (`repeatDelay`).

### E.7 — [WEB] Fond du texte : les quatre, indépendants, couleur et transparence
**Priorité** : critique · **Technique** : partition-équivalence (aucun, transparent, flou, plein)
**Action** : sur la traduction, choisir chacun des quatre fonds ; puis « transparent » en blanc.
**Attendu** : la tuile est cochée à chaque fois ; les quatre rendus de l'aperçu sont différents (luminosité moyenne de la zone) ; « plein » est le plus sombre ; le blanc éclaircit la zone ; sans fond : « ombre douce / contour noir » ; avec fond : couleur, transparence, arrondi ; l'arabe garde le sien.
**Preuve** : `proof-editor.mjs` (« fond du texte … », 46,7 / 40,5 / 41,5 / 38,8 ; blanc 40,5 → 80,5) ; `editor.test.tsx` (`PanelSection`) ; `export-video-editor.test.ts` (`setPanel`).

### E.8 — [WEB] Masquer la traduction ; la dernière écriture ne se masque pas
**Action** : « Masquer » la traduction, puis la réafficher ; masquer l'arabe puis tenter de masquer la traduction.
**Attendu** : sa zone disparaît, sa pastille dit « masqué » et la rend ; le dernier texte affiché a son bouton désactivé avec la raison.
**Preuve** : `proof-editor.mjs` ; `export-video-editor.test.ts` (`canHide`, `setVisibility`).

### E.9 — [WEB] Position sans glisser : croix directionnelle, champs, centrer, remettre
**Action** : 2 appuis sur →, saisir Largeur 60, « Centrer dans l'image », « Remettre à la place d'origine ».
**Attendu** : Gauche +2 % ; largeur 60 % de l'image ; centre de l'image ; place d'origine (x 0,08, largeur 0,84).
**Preuve** : `proof-editor.mjs` ; `export-video-edit.test.ts` (`setBoxField`, `centerBox`, `defaultBox`).

### E.10 — [WEB] Cadre : passages dans leur fenêtre, qualité sous « Réglages avancés », un seul « Exporter »
**Action** : rien de choisi : outils Format · Fond · Passages · Avancé ; « Choisir les passages… » ; « Avancé » ; bouton « Exporter ».
**Attendu** : la fenêtre des passages montre la frise, la liste et le souffle ; la qualité et la fluidité sont dans « Réglages avancés » ; un seul bouton « Exporter » (barre du haut) ouvre la fenêtre-résumé, qui reste ouverte pendant le rendu.
**Preuve** : `proof-editor.mjs` (captures `10-passages`, `11-avance`, `13-fenetre-resume`, `14-export-fait`) ; `editor.test.tsx` (un seul `video-export`).

### E.11 — [WEB][BE] Ce que montre l'aperçu est ce qui sort
**Priorité** : critique · **Technique** : nominal (comparaison)
**Action** : fond flou sur la traduction, fond plein sur l'arabe, qualité légère ; « Exporter » ; télécharger le MP4 ; en extraire l'image du milieu du premier verset ; la comparer à l'aperçu.
**Attendu** : MP4 H.264 + AAC non vide ; mêmes boîtes, mêmes fonds, même taille relative de la sourate, même nombre de barres d'onde.
**Preuve** : `proof-editor.mjs --export 1` (703 Ko ; écart moyen de niveaux de gris 1,45 / 255 en 64 × 36 ; avant les deux corrections 4,82) ; capture `apercu-contre-export.png`.

### E.12 — [WEB] Même éditeur pour tous les rôles ; vue bureau à partir de 1024 px
**Action** : ouvrir l'export vidéo avec `recitant_test` (390 et 1280 px) et avec `admin_test` à 1280 px.
**Attendu** : au téléphone le plateau ; au bureau la liste des éléments, l'aperçu, l'inspecteur ; le récitateur retourne à ses récitations.
**Preuve** : captures `recitant-390-dark`, `recitant-cadre-1280-dark` ; `proof-editor.mjs --size 1280`.

### E.13 — [WEB] Aide du premier affichage, une seule fois ; mouvement réduit
**Action** : premier affichage (contexte neuf), recharger ; `prefers-reduced-motion: reduce`.
**Attendu** : la main désigne un texte la première fois seulement ; animation coupée en mouvement réduit.
**Preuve** : `proof-editor.mjs` (« aide du premier affichage », « prefers-reduced-motion »).

### E.14 — [WEB] Contraintes d'affichage
**Attendu** : aucun défilement horizontal à 360, 390, 430 et 1280 px, thèmes sombre et clair ; toutes les commandes de l'éditeur (zones, poignées, boutons, tuiles, champs, liens) mesurent 44 px au moins sur l'élément lui-même, dans tous les états visités ; console sans erreur.
**Preuve** : `proof-editor.mjs` (contrôles « aucun défilement horizontal », « cibles », « console »).

### E.15 — [CALC] Logique des gestes, sans navigateur
**Attendu** : machine à gestes (toucher, glisser avec seuil souris / doigt, aimants par axe, poignées, pincement, annulation propre, `reset`), `hitLayout` (44 px, dans le cadre), `handlePlacements` (jamais deux cibles l'une sur l'autre), `overlappingBlocks`, `cycleBlock`, réglages purs.
**Preuve** : `export-video-gesture.test.ts`, `export-video-handles.test.ts`, `export-video-hit.test.ts`, `export-video-edit.test.ts`, `export-video-edit-snap.test.ts`, `export-video-editor.test.ts`, `export-video-edit-text.test.ts`, `editor.test.tsx`.

### E.16 — [WEB][BE] Une vidéo de fond choisie depuis l'éditeur sort dans la vidéo exportée
**Priorité** : critique · **Technique** : transition-état (choisir, fermer en plein envoi, exporter)
**Action** : section Fond, « Ma vidéo… » (clip de 3 s, puis de 20 s) ; fermer la feuille (au bureau : choisir un autre élément) pendant l'envoi ; revenir au Fond ; qualité légère ; « Exporter » ; télécharger le MP4.
**Attendu** : l'envoi se termine malgré la fermeture ; les réglages du compte portent `background: "video"`, le nom du fichier, le départ et le comportement ; MP4 H.264 avec UNE seule piste audio ; le fond change d'un instant à l'autre dans l'image extraite ; l'aperçu et l'image exportée montrent la même scène.
**Preuve** : `proof-editor-fond.mjs` (390 px, clip 3 s ; 1280 px, clip 20 s) ; capture `apercu-contre-export.png`.

## Must-fail (doivent être refusés ou retomber proprement)

- **F.1** `pointercancel` en plein glissement, redimensionnement ou pincement : l'élément retrouve sa place de départ, plus aucun geste en cours (`export-video-gesture.test.ts`).
- **F.2** Poignée d'un élément qui n'est pas le choisi, bouton droit de la souris, troisième doigt, doigts collés au départ du pincement, pincement sur l'onde : ignorés.
- **F.3** Boîte poussée hors du cadre ou réduite sous le minimum, champ non numérique, couleur de fond qui n'est pas `#rrggbb`, taille NaN : ramenées au cadre / refusées, réglages inchangés (`export-video-edit.test.ts`, `export-video-editor.test.ts`).
- **F.4** Masquer la dernière écriture : refusé, avec la raison (`export-video-editor.test.ts`, `editor.test.tsx`).
- **F.5** L'arabe n'a jamais de champ de saisie ni de zone de texte (`editor.test.tsx`, I1) ; la traduction ne se montre pas sans son attribution (I2).
- **F.6** Un appui long qui atteint la borne s'arrête (le bouton désactivé ne laisse pas tourner la répétition).

## Limites connues (dites, pas cachées)
- La table de montage et le pas à pas n'existent pas encore : leur mode retombe sur le plateau.
- Pas de barre de position dans l'aperçu animé (10 secondes à partir du verset le plus long, avec le son).
- Lecteur d'écran (NVDA, VoiceOver) : étiquettes, rôles et annonces posés, non testés.
- Non mesurés : téléphone réel (gestes testés sur Chrome émulant le toucher), `Input.dispatchTouchEvent` à deux doigts n'est pas un pincement matériel.
- L'appel à `/api/sessions/<id>/export/subtitles` répond 403 au récitateur (console) : l’appel vient de la page d’export, que cette PR ne modifie pas sur ce point.
