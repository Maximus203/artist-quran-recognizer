# Export vidéo — corrections de la seconde recette QA (après #207 et #208)
> Surfaces : [WEB] (Chrome tactile 360 × 640 à 430 × 932, paysage 667 × 375 et 844 × 390, d'abord) · [CALC] (gardes de feuilles de style et fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : branche `fix/editeur-export-recette-2` sur `origin/develop` @ a5b8346
> Périmètre : N1 (aperçu minuscule ou masqué sur écran court), N2 (Retour après F5 ou lien direct), N3 (Retour avec la
> fenêtre-résumé), N4 (pastilles du plateau), N5 (fenêtre de contenu du pas à pas), N9 (`?onglet=` perdu à la connexion).
> Hors périmètre, signalés : N6, N7, N10 (import, autre chantier) ; N8 (m1, deux onglets : limite documentée) ; S1 à S5.
> Environnement : atelier construit dans un worktree jetable (`harness/h.mjs build`), base jetable, session d'essai avec le texte
> du corpus (sourate 112), compte de test. Jamais d'audio de personne. Gestes : Chrome tactile piloté par Playwright.
> **Règle de méthode** : toujours le parcours RÉEL (la session, puis son bouton « Exporter » : navigation douce, lecteur réduit
> présent avant d'entrer). Une adresse directe ne montre pas ce que la navigation douce superpose, ni l'état d'historique.

## Must-pass

### R2.1 — [WEB] N1 : l'aperçu ne descend jamais sous son plancher
**Priorité** : critique · **Technique** : valeurs-limites (écrans courts), partition-équivalence (3 éditeurs × repos / panneau ou feuille ouverts)
**Action** : `AQR_SMOKE_URL=… node web/e2e/stage-floor.mjs` : 360 × 640, 360 × 740, 390 × 844, 430 × 932, 667 × 375, 844 × 390 ;
plateau (repos, feuille « Réglages » de l'arabe), table (repos, panneau de l'arabe, panneau du cadre), pas à pas (3 étapes).
**Attendu** : cadre d'aperçu ≥ 160 px de haut (≥ 140 px en paysage : 284 × 160 en 16:9 à 360 px de large), vu à 100 % (rien ne le
recouvre), aucun défilement horizontal de la page, aucune commande recouverte ou hors écran après défilement.
**Preuve** : `e2e/stage-floor.mjs` (48 mesures, 0 échec), `app/export-stage-floor.test.ts`.

### R2.2 — [WEB] N1 : la mise en page tient aussi quand le lecteur réduit est là
**Priorité** : important · **Technique** : transition-état
**Action** : l'éditeur du téléphone efface le lecteur réduit (`useHideMiniPlayer`) ; le remettre de force (drapeau
`data-mini-player` sur la racine + élément `.mini-player`) et mesurer de nouveau.
**Attendu** : même plancher ; les commandes du bas restent au-dessus de lui ; la page ne défile pas sans besoin.
**Preuve** : mesures « lecteur forcé » du rapport de la PR.

### R2.3 — [WEB] N2 : Retour après F5 ou un lien direct sur la session
**Priorité** : critique · **Technique** : transition-état (rechargement en plein flux)
**Action** : ouvrir `/?session=<id>` par son adresse (puis aussi après F5), toucher « Exporter », Retour du navigateur.
**Attendu** : on revient à la session (adresse ET écran). Avant : l'adresse changeait, l'écran restait sur l'export.
**Preuve** : mesure avant / après du rapport de la PR ; `lib/history-url.test.ts`.

### R2.4 — [WEB] N3 : Retour avec la fenêtre-résumé de l'export ouverte
**Priorité** : important · **Technique** : transition-état
**Action** : parcours réel jusqu'à l'onglet Vidéo, « Exporter » (fenêtre-résumé), Retour ; Retour encore.
**Attendu** : le premier Retour ferme la fenêtre (adresse inchangée, on reste dans l'export) ; le second quitte l'export.
**Preuve** : mesure avant / après du rapport de la PR ; `use-back-close.test.ts`.

### R2.5 — [WEB] N4 : toutes les pastilles du plateau sont dans l'écran
**Priorité** : important · **Technique** : valeurs-limites (largeur 320 à 519 px)
**Action** : plateau en portrait, 320 / 360 / 390 px : « Arabe », « Traduction », « Onde », « Verset », « Cadre ».
**Attendu** : cinq colonnes égales, aucun défilement caché ; chaque pastille ≥ 44 px de haut ; le nom complet (« Sourate et verset »,
« Cadre et fond ») reste celui des lecteurs d'écran.
**Preuve** : `stage-floor.mjs` (10/10 commandes du plateau, toutes atteignables), `export-stage-floor.test.ts`.

### R2.6 — [WEB] N5 : la fenêtre de contenu du pas à pas se lit
**Priorité** : important · **Technique** : valeurs-limites
**Action** : pas à pas, 3 étapes, aux six écrans de R2.1.
**Attendu** : `pas-body` ≥ 160 px en portrait (≥ 120 px en paysage) ; « Suivant » sous le pouce.
**Preuve** : `stage-floor.mjs` (fenêtre de 160 à 333 px en portrait, 131 et 146 px en paysage).

### R2.7 — [CALC] N9 : l'onglet survit à la connexion
**Priorité** : mineur · **Technique** : partition-équivalence
**Action** : adresse directe déconnecté `/s/<id>/exporter?onglet=video` ; valeur hostile `?onglet=<script>`.
**Attendu** : `/login?next=%2Fs%2F<id>%2Fexporter%3Fonglet%3Dvideo` ; une valeur inconnue n'entre jamais dans l'adresse de retour.
**Preuve** : `lib/export-tab.test.ts` (`exportReturnPath`), réponse HTTP avant / après.

## Must-fail

### R2.F1 — [CALC] Une hauteur de rangée qui rend la place à l'aperçu
`export-stage-floor.test.ts` doit échouer si `.xe-plateau` perd `minmax(var(--xe-stage-area-min), 1fr)`, si `.xp-stage` n'utilise plus le plancher,
ou si le rail de la table n'est plus collé.

### R2.F2 — [CALC] Un `history.replaceState(null, …)` revenu dans l'application
`lib/history-url.test.ts` doit échouer : il efface l'état de Next et casse Retour (N2).

### R2.F3 — [CALC] Une fenêtre ouverte sans Retour
`use-back-close.test.ts` doit échouer si `ExportSheet` perd `useBackClose(open, onClose)`.

## Limites connues
- N8 / m1 (deux onglets, un réglage perdu) : NON corrigé, changement de contrat des préférences (voir `docs/ARCHITECTURE-ATELIER.md`).
- Sur la page de la session, à 844 × 390, l'en-tête collant recouvre le bouton « Exporter » après le défilement automatique
  (le clic part alors du bouton lui-même dans la mesure) : défaut de la page de revue, hors éditeur, à traiter à part.
- Téléphone réel, lecteur d'écran, Safari et Firefox : non testés (Chrome tactile émulé seulement).
