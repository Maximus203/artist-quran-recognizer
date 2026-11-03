# Export vidéo — choix du format d'éditeur sur téléphone (phase 4)
> Surfaces : [WEB] (mobile 360 / 390 / 430 px d'abord, puis 1280 px) · [API] · [CALC] (règle pure)
> Build : `feat/export-choix-format` · ADR-0021
> Périmètre : règle `lib/export-editor-mode.ts`, clé `editorMode` des préférences du compte, fenêtre de la première ouverture,
> trois animations (et leurs images fixes), section des paramètres, porte `ExportEditorGate`, défaut du rôle récitateur.
> Environnement : atelier construit dans un worktree jetable, base jetable, comptes `admin_test` et `recitant_test`, Chrome de Playwright.
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués, cibles ≥ 44 px, aucun défilement horizontal, console propre.

## Must-pass

### C.1 — [WEB] Première ouverture (testeur ou administrateur, téléphone)
**Action** : compte sans choix, ouvrir l'onglet Vidéo de l'export à 390 px.
**Attendu** : fenêtre modale « Comment veux-tu régler ta vidéo ? » (focus sur la question), trois cartes (Plateau, Table de montage, Pas à pas)
chacune avec sa phrase, ce que ça donne, pour qui, son animation et son bouton d'un seul geste ; aucun éditeur monté derrière ; rien de coché.

### C.2 — [WEB] Les animations montrent chaque format
**Attendu** : les trois boucles jouent (le doigt touche le texte et la barre d'outils apparaît ; la tête de lecture glisse puis on cale le film ;
trois étapes défilent puis le gros bouton) ; « Mettre les animations en pause » les arrête et les reprend ; texte alternatif qui raconte les trois temps.

### C.3 — [WEB] Un geste valide, le choix est gardé par le serveur
**Action** : choisir chacun des trois formats. **Attendu** : la fenêtre se ferme, l'éditeur s'ouvre, `editorMode` est sur le compte (horodaté),
retrouvé après rechargement, et sur une autre connexion (autre appareil) sans nouvelle question.

### C.4 — [WEB] « Choisir plus tard » (et Échap)
**Attendu** : le plateau pour cette séance ; rien n'est écrit sur le compte ; même séance rechargée : pas de nouvelle question ; nouvelle séance : la question revient.

### C.5 — [WEB] Focus et clavier
**Attendu** : Tab et Maj+Tab ne sortent jamais de la fenêtre, focus visible (≥ 2 px), Échap ferme (= plus tard), cibles ≥ 44 px (boutons, « Choisir plus tard », pause).

### C.6 — [WEB] Mouvement réduit
**Attendu** : l'animation est cachée, trois images fixes DISTINCTES par format avec leur légende en vrai texte, aucune animation en cours, pas de bouton de pause.

### C.7 — [WEB] Paramètres
**Action** : Compte → Préférences, section « Éditeur d'export (téléphone) ». **Attendu** : mêmes cartes et animations, le format actuel marqué (« Actuel »,
« Format actuel », sans bouton), un geste enregistre sur le compte et annonce le changement ; effet à la prochaine ouverture de l'export (aucune question).
Au bureau : trois cartes côte à côte.

### C.8 — [WEB] Récitateur
**Attendu** : aucune fenêtre de choix, jamais ; format par défaut Pas à pas (le compte reste « jamais choisi ») ; sa page de paramètres montre la section
avec « Actuel · par défaut » ; il peut choisir un autre format, qui s'applique.

### C.9 — [WEB] Bureau
**Attendu** : 1280 px, aucune question pour aucun rôle, vue unifiée, compte inchangé.

### C.10 — [API] Schéma
**Attendu** : `PATCH {editorMode: "plateau"|"table"|"pas"|null}` accepté ; un ancien client qui n'envoie pas la clé ne l'efface pas ; `DELETE ?key=editorMode` la remet à zéro.

## Must-fail

### C.F1 — [API] Valeur inconnue ou mal typée
`editorMode` = `"carrousel"`, `""`, `2`, `false`, `["pas"]`, `{…}` → 400, valeur précédente intacte. Clé inconnue avec un format valide → 400, rien d'écrit. Sans connexion → 401.

### C.F2 — [CALC] Valeur d'un futur format en base
Lue comme « jamais choisi » (le reste des préférences est lu) ; jamais d'écran vide : le plateau est le repli.

### C.F3 — [WEB] Pas de question hors cadre
Aucune fenêtre pour un récitateur, ni au bureau, ni quand un format est déjà choisi, ni après « plus tard » dans la même séance, ni sur la page « aucun passage coranique ».

### C.F4 — [CALC] Rôle inconnu
Ni question ni section dans les paramètres ; défaut = plateau.

### C.F5 — [WEB] Stockage de séance bloqué
`sessionStorage` illisible : la question revient (jamais l'inverse), rien ne plante.

## Preuves
Voir la description de la PR et `.artist/decision-log.md` (captures, rapports de la campagne).
