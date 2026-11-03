# Export vidéo — l'éditeur « Pas à pas » (phase 3b)
> Surfaces : [WEB] (mobile 360 / 390 / 430 px tactile d'abord ; thèmes sombre et clair) · [CALC] (fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : `feat/export-editeur-pas-a-pas` @ aa5bfea (PR #204) · ADR-0022
> Périmètre : trois étapes (Le cadre, Les textes, Exporter), encart « déjà prête », pastilles, Précédent / Suivant, progression
> mémorisée, aperçu verrouillé hors de l'étape des textes, étape du cadre gardée montée, sortie de l'éditeur ; correctif du 403 du
> récitateur sur `/export/subtitles` ; cibles de 44 px dans la fenêtre des passages. Hors périmètre : défaut du rôle récitateur et
> choix du format (phase 4), table de montage (phase 3a).
> Environnement : atelier construit dans un worktree jetable avec UN commit temporaire local (`editorMode="pas"` pour tous, jamais
> poussé : la phase 4 posera le défaut du rôle), base jetable (`harness/h.mjs`), session d'essai avec le texte du corpus (sourate
> 112) et traductions d'essai, comptes `admin_test` et `recitant_test`. Jamais d'audio de personne.
> Gestes : Chrome piloté par Playwright ; au toucher, `Input.dispatchTouchEvent`. Script rejouable : `harness/proof-pas.mjs`.
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués, console et réseau propres (hors `/favicon.ico`, existant),
> aucun défilement horizontal.

## Must-pass

### P.1 — [WEB] Ouverture : étape 1, une seule pastille en cours, encart « déjà prête »
**Priorité** : critique · **Technique** : nominal
**Action** : ouvrir l'export vidéo (récitateur : directement ; administrateur : onglet Vidéo).
**Attendu** : le pas à pas (ni plateau ni bureau), la pastille 1 seule porte `aria-current="step"`, l'encart « Déjà prête avec nos
réglages conseillés » et « Exporter maintenant » actif, aperçu sans calque d'édition, un seul « Suivant · Les textes » de 52 px
(pas de Précédent), aucun terme technique (fps, codec, 1080p…), aucun défilement horizontal.
**Preuve** : `proof-pas.mjs` (« ouverture… », « étape 1… »), `shots-pas/*/01-cadre.png`.

### P.2 — [WEB] Trois touchers pour une belle vidéo, sans rien régler
**Priorité** : critique · **Technique** : parcours le plus court
**Action** : compte récitateur : « Exporter maintenant » → « Exporter » (fenêtre-résumé) → « Retélécharger ».
**Attendu** : un MP4 non vide, dont l'image ressemble à l'aperçu ; la fenêtre-résumé reste ouverte pendant le rendu.
**Preuve** : `proof-pas.mjs --role recitant --export 1` (le parcours part du gros bouton de l'étape 3 ; le chemin court de l'encart
ouvre la même fenêtre : `pas-ready-export` → `video-sheet`) ; export réel, image et comparaison dans `shots-pas/recitant-390-dark/`.

### P.3 — [WEB] Étape 2 : l'aperçu se manipule, un onglet par élément
**Priorité** : critique · **Technique** : transition-état
**Action** : « Suivant » ; toucher la traduction dans l'aperçu ; toucher à côté ; « + », « − » ; fond plein (arabe) puis flou
(traduction) ; glisser l'arabe ; croix directionnelle ; masquer puis remettre la traduction.
**Attendu** : annonce « Étape 2 sur 3 : Les textes. » (`aria-live`), focus sur le titre de l'étape, calque monté, aide du premier
affichage ; l'onglet suit le toucher ; toucher à côté garde un onglet ouvert ; la taille change (cibles de 56 × 52 px) ; deux fonds
indépendants ; l'arabe se déplace ; « Descendre » × 2 = +2 points du champ « Haut » ; traduction masquée annoncée, sa zone disparaît.
**Preuve** : `proof-pas.mjs` (« étape 2… », « taille… », « fond… », « glisser… », « flèches… », « traduction masquée… »).

### P.4 — [WEB] Arabe jamais éditable, traduction avec sa source
**Priorité** : critique (I1, I2) · **Technique** : partition (arabe / traduction)
**Attendu** : onglet Arabe : cadenas et phrase « jamais le modifier », ni champ de saisie ni zone de texte ; onglet Traduction :
phrase « restituée telle quelle » et l'attribution de la traduction juste dessous.
**Preuve** : `proof-pas.mjs` (« l'arabe est choisi… », « traduction : attribution collée… ») ; `step-editor.test.tsx`.

### P.5 — [WEB] Pastilles, Précédent, progression mémorisée
**Priorité** : critique · **Technique** : transition-état, refresh en plein flux
**Action** : Précédent ; pastille 3 (saut) ; pastille 2 ; recharger la page sur l'étape 2.
**Attendu** : l'aperçu se reverrouille hors de l'étape 2 ; les sauts marchent à tout moment ; au rechargement on revient à l'étape
des textes, la pastille 1 garde sa coche, l'aide du premier affichage ne revient pas ; une autre récitation repart de l'étape 1.
**Preuve** : `proof-pas.mjs` (« Précédent… », « pastille… », « rechargement… ») ; `export-video-steps.test.ts` (21 cas : garde,
coches, lecture tolérante, clé par récitation, mémoire absente ou bloquée).

### P.6 — [WEB] La vidéo de fond n'est pas coupée par un changement d'étape
**Priorité** : critique · **Technique** : transition-état (envoi en cours)
**Action** : à l'étape 1, choisir une vidéo (20 s) ; aussitôt « Suivant » ×2 puis pastille 1.
**Attendu** : l'étape du cadre reste montée, cachée, à l'étape 2 et 3 ; l'envoi se termine (`data-phase="ready"`) ; « Retirer » libère
la place (trois vidéos par compte).
**Preuve** : `proof-pas.mjs` (« l'étape du cadre reste montée… », « l'envoi… continue… », « la vidéo de fond se retire ») ;
`step-editor.test.tsx` (volet caché mais présent).

### P.7 — [WEB] Étape 3 : résumé, passages, avancé, gros bouton
**Priorité** : critique · **Technique** : nominal
**Attendu** : résumé court (Format, Fond, Traduction), passages en résumé et fenêtre dédiée (plein écran, cibles de 44 px), réglages
avancés rangés (qualité, fluidité), aperçu verrouillé, gros bouton Exporter (52 px) à la place de Suivant.
**Preuve** : `proof-pas.mjs` (« étape 3… », « passages… », « réglages avancés… »), `shots-pas/*/06-exporter.png`, `07-passages.png`.

### P.8 — [WEB] Accessibilité
**Priorité** : important · **Technique** : table-décision (cible × état)
**Attendu** : toutes les cibles ≥ 44 px sur l'ensemble du parcours ; anneau de focus (2 px) au clavier sur une pastille ;
`prefers-reduced-motion` coupe l'animation d'entrée d'étape ; thèmes sombre et clair ; aucun défilement horizontal à 360, 390, 430 px.
**Preuve** : `proof-pas.mjs` (« cibles tactiles… », « focus visible… », « prefers-reduced-motion… », « aucun défilement… »).

### P.9 — [WEB] Sortie et ce que voit le récitateur
**Priorité** : critique · **Technique** : nominal
**Action** : flèche retour de la barre du haut.
**Attendu** : récitateur → « Récitations » (liste de ses récitations, interface réduite : lecture, récitations, playlists) ;
administrateur → l'onglet « Vérifier ». Aucune erreur 403 en console pour le récitateur.
**Preuve** : `proof-pas.mjs` (« sortie (onLeave)… », « console et réseau… »), `11-sortie-mes-recitations.png`.

## Must-fail

### F.1 — [WEB] Aucune étape verrouillée, aucune étape inconnue
**Attendu** : `moveTo` refuse (même objet) une étape inconnue ou la même ; une valeur mémorisée abîmée redonne l'étape 1 sans erreur.
**Preuve** : `export-video-steps.test.ts` (« la garde… », « une valeur abîmée… »).

### F.2 — [WEB] L'aperçu ne se manipule pas hors de l'étape des textes
**Attendu** : aucune zone d'édition aux étapes 1 et 3 (un geste sur l'aperçu ne déplace rien).
**Preuve** : `proof-pas.mjs` (« l'aperçu est verrouillé »), `step-editor.test.tsx` (mutation vérifiée : retirer le verrouillage fait échouer 2 tests).

### F.3 — [WEB] Pas de promesse sans passage
**Attendu** : sans passage à exporter, l'encart ne dit pas « Déjà prête » et propose d'en choisir un ; un export impossible grise les boutons.
**Preuve** : `step-editor.test.tsx` (« sans passage… », « export impossible… »).

### F.4 — [WEB] La dernière écriture ne se masque pas
**Attendu** : traduction masquée → l'interrupteur de l'arabe est grisé avec « Une des deux écritures reste affichée ».
**Preuve** : `step-editor.test.tsx`.

### F.5 — [WEB] Le récitateur ne demande plus les sous-titres
**Attendu** : aucune requête `/export/subtitles` (403) à l'ouverture de l'export pour le compte récitateur.
**Preuve** : `proof-pas.mjs --role recitant` (« console et réseau… » : aucune réponse 4xx).

## Preuves
(voir le rapport de la PR : captures citées, `report.json` par rôle, taille et thème)
