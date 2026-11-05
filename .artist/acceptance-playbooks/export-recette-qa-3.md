# Export vidéo — corrections de la troisième recette QA (éditeur, après #210)
> Surfaces : [WEB] (Chrome tactile 320 × 568 à 430 × 932, paysage 667 × 375 et 844 × 390, tablettes 768 × 1024 et 1 023 × 768, bureau 1 024 et 1 280) · [CALC] (gardes de feuilles de style et fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : branche `fix/editeur-export-qa3` sur `origin/develop` @ c2f0b40
> Périmètre : P1 (la page du pas à pas défile dans le vide), P2 (taille − / + sous le pli, fenêtre utile), P3 (table étriquée),
> P4 (champs « Position »), P7 (titre de lecture sur une session étrangère), P8 (lecteur au-dessus de la fenêtre-résumé),
> P9 (fond qui ne charge pas), P10 (1 px de défilement).
> Hors périmètre, signalés : P5, P6 (import, autre chantier) ; N8 / m1 (deux onglets : limite documentée) ; S1 à S5.
> **Règle de méthode** : toujours le parcours RÉEL (la session, lecteur réduit présent, puis « Exporter ») ; le glissement se fait
> au toucher réel (CDP `Input.dispatchTouchEvent`), jamais par `scrollTo`.

## Must-pass

### R3.1 — [WEB] P1 : la page ne défile pas plus que son contenu
**Priorité** : important · **Technique** : valeurs-limites (écrans courts), transition-état (3 étapes)
**Action** : pas à pas, étapes 1, 2, 3, à 360 × 640, 360 × 740, 390 × 844, 430 × 932, paysage ; mesurer `scrollHeight - innerHeight` ;
glisser au doigt en partant du centre de l'aperçu.
**Attendu** : 0 px de défilement de page (sauf 320 × 568, plancher de l'aperçu et de la fenêtre : 57 px) ; le glissement ne déplace pas la page.
**Preuve** : `scratchpad/ibr4/m.mjs` ; `app/export-qa3-layout.test.ts` (colonnes positionnées).

### R3.2 — [WEB] P2 : la taille − / + se voit sans défiler
**Priorité** : important · **Technique** : valeurs-limites
**Action** : pas à pas, étape 2, onglet Arabe, 360 × 640 / 360 × 740 / 390 × 844 / paysage.
**Attendu** : `size-arabic-up` dans la fenêtre de contenu au repos ; fenêtre utile ≥ 160 px à 360 × 640 (barre « Suivant » ne recouvre rien) ; aperçu ≥ 160 px de haut ; zones tactiles ≥ 44 px.
**Preuve** : mesures de la PR ; `web/e2e/stage-floor.mjs` (0 échec) ; `step-editor.test.tsx` (ordre).

### R3.3 — [WEB] P3 : la table se lit
**Priorité** : mineur · **Technique** : valeurs-limites
**Action** : table, repos et panneau ouvert, 360 × 640, 320 × 568, 1 023 × 768, 768 × 1024.
**Attendu** : à 360 × 640 la règle et les trois pistes sont entièrement visibles au repos ; rail de 44 px par outil (7 outils, même à 320 px) ; sur 1 023 × 768 l'aperçu à gauche ≥ 460 × 258 ; bureau 1 024 : aperçu plus large qu'avant.
**Preuve** : mesures de la PR ; `stage-floor.mjs`.

### R3.4 — [WEB] P4 : les champs « Place et zone exactes »
**Priorité** : mineur · **Technique** : partition-équivalence (valide, arabo-indien, illisible, vide)
**Action** : plateau → Arabe → Position ; saisir « ٣٠ », « ٣٫٥ », « 12,5 », « 30 % », « abc », « 😀 », vide, puis sortir du champ.
**Attendu** : les nombres sont lus (bornés par la zone) ; un texte illisible redonne la valeur gardée et la phrase « … n'est pas un nombre. Gauche reste à … % » ; jamais NaN.
**Preuve** : `lib/percent-input.test.ts` ; `scratchpad/ibr4/v-misc.mjs p4`.

### R3.5 — [WEB] P7 : session d'un autre compte
**Priorité** : mineur · **Action** : `/?session=<id inexistant ou d'un autre compte>`.
**Attendu** : seule la phrase « Cette session n'existe pas ou n'est pas visible avec ton compte. » ; aucun « Lecture impossible… ».
**Preuve** : `v-misc.mjs p7` (avant : les deux messages).

### R3.6 — [WEB] P8 : la fenêtre-résumé passe devant le lecteur (bureau)
**Priorité** : mineur · **Action** : bureau 1 280, lecture lancée, « Exporter » (fenêtre-résumé).
**Attendu** : l'élément au centre du lecteur réduit n'est pas le lecteur. **Preuve** : `v-misc.mjs p8` ; garde des jetons de couche.

### R3.7 — [WEB] P9 : un fond qui ne charge pas
**Priorité** : mineur · **Technique** : transition-état (réseau)
**Action** : images de fond bloquées ; ouvrir le choix du fond, toucher une photo ; débloquer ; « Réessayer ».
**Attendu** : vignettes grises (pas d'icône cassée) ; phrase claire + bouton ; après « Réessayer » le fond est posé, plus d'alerte.
**Preuve** : `v-misc.mjs p9` ; `lib/export-video-assets.test.ts`.

### R3.8 — [WEB] P10 : pas de pixel de défilement en trop
**Action** : les trois éditeurs, 320 à 430 px, paysage, tablettes. **Attendu** : `scrollHeight - innerHeight = 0`. **Preuve** : mesures de la PR.

### R3.9 — [WEB] Non-régression : B1, m6, N1
**Attendu** : `web/e2e/stage-floor.mjs` : 0 échec (aperçu ≥ 160 px / 140 px en paysage, vu à 100 %, aucune commande recouverte, aucun défilement horizontal, lecteur réduit absent sur téléphone).

## Must-fail

### R3.F1 — [CALC] Un élément absolu caché dans une colonne non positionnée
`export-qa3-layout.test.ts` échoue si `.xp-body`, `.xe-dock` ou `.xe-sheet-body` perd `position: relative`, ou si `.sr-live` n'est plus fixe.
### R3.F2 — [CALC] Une couche en dur
Le même test échoue si `.mini-player`, `.xr-scrim` ou `.xr-sheet` n'utilisent plus les jetons `--z-*`, ou si le voile n'est plus devant le lecteur.
### R3.F3 — [CALC] Un texte illisible appliqué
`percent-input.test.ts` échoue si « abc », « NaN », « 1e999 », un emoji ou un champ vide sont lus comme un nombre.
### R3.F4 — [CALC] Un repli silencieux
`export-video-assets.test.ts` échoue si une photo de fond qui ne charge pas retombe sur le dégradé au lieu de lever l'erreur.

## Limites connues
- 320 × 568 : le plancher de l'aperçu et de la fenêtre dépasse l'écran de 57 px, la page défile de cette quantité ; fenêtre utile de 103 px au repos.
- N8 / m1 (deux onglets) NON corrigé. Suggestions S1 à S5 NON faites.
- Téléphone réel, lecteur d'écran, Safari et Firefox : non testés (Chrome tactile émulé seulement).
