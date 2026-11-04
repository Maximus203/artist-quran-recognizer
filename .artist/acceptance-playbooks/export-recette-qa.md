# Export vidéo — corrections de la recette QA indépendante (PR #200 à #206)
> Surfaces : [WEB] (mobile 360 / 390 px tactile et paysage 667 × 375 d'abord) · [CALC] (fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : branche `fix/export-recette-qa` sur `origin/develop` @ 350d84b
> Périmètre : B1 (lecteur réduit), M1 (cadenas et attribution du plateau), m2 (onglet), m3 (Retour), m4 (saut de l'aperçu),
> m5 (coupure de réseau), m6 (petits écrans), m7 (404), m8 (délai du test). Hors périmètre : M2 (contrôle de l'import contre le corpus).
> Environnement : atelier construit dans un worktree jetable (`harness/h.mjs build`), base jetable, session d'essai avec le texte du
> corpus (sourate 112) et traductions d'essai, compte `admin_test`. Jamais d'audio de personne. Gestes : Chrome piloté par Playwright,
> au toucher. Scripts rejouables : `harness/proof-b1.mjs`, `harness/proof-m.mjs`.
> **Règle de méthode** : toujours le parcours RÉEL (session, puis bouton « Exporter » : navigation douce, le lecteur réduit s'ouvre).
> Une adresse directe ne montre pas ce que la navigation douce superpose (leçon de la recette).

## Must-pass

### Q.1 — [WEB] B1 : le lecteur réduit ne recouvre aucune commande du bas des trois éditeurs
**Priorité** : critique · **Technique** : parcours réel
**Action** : 390 puis 360 px tactile, session terminée → « Exporter » → onglet Vidéo, pour chaque éditeur (plateau, table, pas à pas) ; toucher « Réglages » (plateau, arabe choisi), le rail « Fond » (table), « Suivant » (pas à pas).
**Attendu** : le bas de l'éditeur est au-dessus du lecteur réduit (`--mini-reserve` non nulle, drapeau `data-mini-player` posé) ; le toucher ouvre la feuille ou change d'étape, JAMAIS la session.
**Preuve** : `proof-b1.mjs`, `shots-ibr/b1/*.png`.

### Q.2 — [WEB] M1 : cadenas de l'arabe et attribution de la traduction dans le plateau
**Priorité** : critique · **Technique** : invariants I1, I2
**Action** : plateau, toucher l'arabe, puis la traduction ; ouvrir « Réglages » de l'arabe.
**Attendu** : « jamais le modifier » avec cadenas sous la barre d'outils ET en tête de la feuille ; la traduction porte « restituée telle quelle, avec sa source : <attribution> » ; aucun champ de saisie pour l'arabe. La vidéo exportée reste sans attribution (décision du 2026-10-27).
**Preuve** : `proof-b1.mjs` (`lock: 1`), `shots-ibr/m4/*.png`, `dock-below.test.tsx`.

### Q.3 — [WEB] m4 : la scène ne bouge pas à la première sélection
**Priorité** : important · **Technique** : transition-état
**Action** : plateau, relever le haut et la hauteur de la zone d'aperçu, toucher l'arabe, la traduction, « Cadre et fond ».
**Attendu** : écart d'au plus 2 px (60 px avant).
**Preuve** : `proof-m.mjs m4`.

### Q.4 — [WEB] m3 : Retour ferme la feuille ouverte
**Priorité** : important · **Technique** : transition-état
**Action** : plateau puis table, ouvrir la feuille « Fond », Retour du navigateur ; puis « Terminé » ; puis Retour.
**Attendu** : la feuille se ferme, l'éditeur reste, l'adresse ne change pas ; « Terminé » ne laisse aucune entrée d'historique en trop ; Retour sans feuille quitte l'export.
**Preuve** : `proof-m.mjs m3`, `lib/back-close.test.ts`.

### Q.5 — [WEB] m2 : recharger garde l'onglet
**Priorité** : normal · **Technique** : refresh en plein flux
**Action** : onglet Vidéo, recharger ; ouvrir l'adresse nue ; onglet Sous-titres.
**Attendu** : `?onglet=video` retrouvé, éditeur monté ; adresse nue = « Vérifier » ; `?onglet=soustitres` écrit sans entrée d'historique.
**Preuve** : `proof-m.mjs m2`, `lib/export-tab.test.ts`.

### Q.6 — [WEB] m6 : petits écrans, aucune commande derrière un défilement caché
**Priorité** : important · **Technique** : valeurs-limites
**Action** : 360 × 740, 390 × 844 et paysage 667 × 375 : plateau (arabe choisi), table, pas à pas ; relever la position et le recouvrement de chaque commande.
**Attendu** : « Fond », « Réglages », « Masquer », les sept outils du rail, « Suivant » sont dans l'écran et ne sont pas recouverts ; aucun défilement horizontal ; en paysage, aperçu à gauche et commandes à droite.
**Preuve** : `proof-m.mjs m6`, `shots-ibr/m6/*.png`.

### Q.7 — [WEB] m5 : coupure de réseau pendant le rendu
**Priorité** : important · **Technique** : réseau coupé
**Attendu** : le bordereau dit « Connexion perdue. Le rendu continue sur le serveur… » (région d'annonce polie) et la progression se rattrape seule au retour du réseau ; une autre erreur (ex. 404) n'affiche pas ce message.
**Preuve** : `lib/export-video-follow.test.ts`, `video-bordereau.test.tsx` ; non rejoué au navigateur dans cette passe (voir « Limites »).

### Q.8 — [CALC] m7 : un refus à l'assemblage ne demande pas de supprimer deux fois
**Priorité** : normal · **Technique** : partition-équivalence
**Attendu** : après 400, 413, 415 ou 422 à l'assemblage, aucun DELETE ; après 409, 503 ou 507, un DELETE.
**Preuve** : `lib/background-video-client.test.ts`.

## Must-fail

### Q.F1 — [WEB] Un toucher sur une commande ne doit jamais ouvrir la session
Si `proof-b1.mjs` voit l'adresse changer après le toucher, ou un élément `mini-player` au point de la commande : ÉCHEC.

### Q.F2 — [CALC] Une hauteur « écran moins l'en-tête » sans `--mini-reserve`
`mini-reserve.test.ts` doit échouer si une règle `height: calc(100dvh - var(--header-h)…)` ne retire pas la réserve.

### Q.F3 — [CALC] `?onglet=` inconnu, en liste ou `__proto__`, ou récitant demandant « soustitres »
Doit retomber sur « Vérifier » (récitant : « Vidéo »), jamais sur un onglet inventé.

## Limites connues (voir `docs/ARCHITECTURE-ATELIER.md`, §7 ter)
- m1 (deux onglets, un réglage perdu) : NON corrigé, c'est un changement de contrat des préférences.
- m9 (suite web sensible à la charge) : non modifié ; lancer avec `--maxWorkers=2`.
- Lecteur d'écran, téléphone physique, Safari et Firefox : non testés.
