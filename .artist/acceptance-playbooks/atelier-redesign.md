# Atelier de revue — redesign « Encre & lapis » (shell, file d'attente, carte, revue humaine, Performance)

> Surfaces : [WEB] · [API] · Statut : ⬜ · Build : feat/atelier-redesign @ —
> Périmètre : `web/` — barre du haut, panneaux (sessions, revue humaine), console (lecteur, onde, pistes), carte du passage, sélecteur de police, liste des intervalles, « Nouvel essai », onglet Performance, `PUT /review` multi-testeurs, `GET /api/fonts*`.
> Environnement : `next build` + `next start` sur un port libre (jamais le 3100), `AQR_REVIEW_DIR` = dossier **de test** (copies de quelques sessions, jamais les données réelles), `AQR_FONTS_DIR` = dossier contenant `KFGQPC-Hafs-V30.ttf`. Largeurs 1440, 768 et 375 px, thèmes clair et sombre.
> Données : sessions copiées dans le dossier de test ; les analyses de la file sont lancées **depuis l'interface** (3 petits audios), jamais créées à la main. Aucun identifiant ni secret.
> Critère d'arrêt : tous les must-pass critiques ✅, tous les must-fail bloqués, 0 ❌, console sans erreur.

## Préconditions
- [WEB] Serveur lancé sur le build frais de la branche ; navigateur vierge (pas de `localStorage`).
- [WEB] Au moins une session terminée avec versets reconnus, une avec basmala et une avec abstentions.
- [API] `AQR_FONTS_DIR` pointe vers la police (cas nominal) ; un second serveur **sans** ce dossier pour les cas d'absence.

## Scénarios

### AR.1 — [WEB] Thème et amorçage sans flash
**Priorité** : normal
**Technique** : transition-état
**Action** : ouvrir la page avec le thème du système en clair, recharger plusieurs fois ; basculer le thème avec le bouton de la barre ; recharger.
**Attendu** : le thème choisi est celui de l'affichage dès le premier rendu (aucun éclair du mauvais thème) ; le choix est mémorisé ; sans choix, on suit le système.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.2 — [WEB] Repli des panneaux et pastille
**Priorité** : critique
**Technique** : transition-état
**Action** : à 1440 px, replier le panneau de gauche puis celui de droite, recharger ; lancer une analyse et la laisser tourner panneau de gauche fermé.
**Attendu** : l'état de repli est mémorisé après rechargement ; le bouton de gauche porte une pastille tant qu'il y a du non lu ou une analyse active ; la forme d'onde reste alignée après le repli (pas de décalage).
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.3 — [WEB] Tiroirs sous 1280 px (clavier)
**Priorité** : critique
**Technique** : nominal
**Action** : à 375 px, ouvrir le tiroir de gauche au clavier (Tab + Entrée), parcourir avec Tab jusqu'au bout, Échap ; ouvrir le tiroir de droite, cliquer le voile.
**Attendu** : le focus est piégé dans le tiroir, Échap et le voile le ferment, le focus revient au bouton d'origine ; un tiroir fermé n'est pas atteignable au clavier.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.4 — [WEB] Police arabe : choix, taille, mémorisation, Hafs V30 réelle
**Priorité** : critique
**Technique** : partition-équivalence
**Action** : ouvrir « Police arabe » ; choisir successivement les quatre polices ; régler la taille (28, 40, 72) ; recharger.
**Attendu** : le texte arabe de la carte et de la liste prend la police choisie (Hafs V30 est vraiment chargée : `document.fonts.check` vrai) ; taille et police sont mémorisées ; l'aperçu de chaque option s'affiche dans sa police ; les signes de pause (ۚ ۖ ۗ) sont rendus.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.5 — [API] La police sous licence ne sort jamais de la boucle locale ni de la liste blanche
**Priorité** : critique
**Technique** : erreur
**Action** : `GET /api/fonts/kfgqpc-hafs-v30` en local ; puis avec un `Host` non local (mode test distant avec jeton et hôte autorisé) ; puis `/api/fonts/..%2F..%2Fsession`, `/api/fonts/KFGQPC-Hafs-V30.ttf`, `/api/fonts/inconnue`.
**Attendu** : 200 `font/ttf` en local seulement ; 403 pour tout hôte non local même avec jeton ; 404 pour tout nom hors liste blanche ; jamais un chemin lu à partir de la requête. Aucun fichier `KFGQPC*` dans `public/` ni dans Git.
**Vérif [BE]** : `git ls-files | grep -i kfgqpc` vide ; `web/public/fonts` sans Hafs V30.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.6 — [WEB] Police locale absente : option grisée, repli
**Priorité** : critique
**Technique** : erreur
**Action** : serveur sans `AQR_FONTS_DIR` valide ; ouvrir le sélecteur.
**Attendu** : « KFGQPC Uthmanic Hafs V30 » est grisée avec l'explication (fichier à placer, licence), non sélectionnable ; le texte s'affiche en Amiri Quran ; aucune erreur console.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.7 — [WEB] Import multiple et file d'attente (audios, vidéos)
**Priorité** : critique
**Technique** : transition-état
**Action** : « Nouvel essai », choisir 3 petits audios d'un coup ; observer le panneau de gauche pendant toute la file ; recommencer par glisser-déposer de 2 fichiers (dont une vidéo).
**Attendu** : chaque fichier part dans la file ; états successifs visibles : en attente (rang) → en cours (estimation, progression) → terminé non lu (point) ; une analyse à la fois ; la ligne de synthèse dit « n en cours · n en attente » ; le titre de l'onglet porte le total non lu.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.8 — [WEB] « Non lu » : seul l'ouverture l'efface
**Priorité** : critique
**Technique** : transition-état
**Action** : avec 2 résultats non lus, actualiser la liste plusieurs fois et laisser le sondage tourner ; ouvrir un des deux ; recharger la page.
**Attendu** : le sondage et le bouton Actualiser n'effacent aucun point ; l'ouverture n'efface que le point de la session ouverte, même après rechargement et depuis un autre navigateur.
**Vérif [BE]** : `GET /api/sessions` : `viewed_at` posé seulement pour la session ouverte.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.9 — [WEB] Échec et annulation lisibles
**Priorité** : normal
**Technique** : erreur
**Action** : lancer une analyse avec un moteur indisponible (`AQR_MODELS_DIR` invalide) ; annuler une analyse en attente et une analyse en cours.
**Attendu** : l'échec est en français clair (motif court, triangle, bouton « Relancer », point non lu) ; l'annulation affiche « Annulé après … » sans point ; la suivante de la file démarre.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.10 — [WEB] Carte du passage : verset, basmala, formules
**Priorité** : critique
**Technique** : table-décision
**Action** : cliquer successivement dans la liste un verset reconnu, la basmala, une isti'adha, un takbir, un âmîn, une abstention, une hypothèse, un intervalle incertain.
**Attendu** : verset = texte du corpus + traduction + attribution QuranEnc, `[n]` en exposant ; basmala = carte de verset avec badge « Basmala » ; isti'adha/takbir/âmîn = arabe et traduction française **constants**, avec « Formule — hors Mushaf, traduction indicative (non QuranEnc) » ; abstention/hypothèse/incertain = message, jamais de texte du Mushaf inventé. L'avis « Riwaya Hafs supposée · non vérifiée » est visible dans l'en-tête de session.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.11 — [WEB] Pose d'un signalement : bouton unique, point, tracé
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : donner le pseudonyme « awa-tel » ; avancer la lecture, « Marquer le début » puis, 0,1 s plus loin, « Marquer la fin » ; recommencer à 0,3 s ; poser un point (`P`) ; activer « Tracer sur l'onde » et glisser, puis toucher ; `Maj` + glisser hors mode ; Échap en cours de pose.
**Attendu** : un début puis une fin ≥ 0,2 s créent une plage ; en dessous, un message « Avance un peu l'écoute… » et rien n'est créé ; glisser = plage (dans les deux sens), toucher = point ; hors mode, un clic déplace la lecture sans créer de signalement ; Échap annule la pose ; chaque brouillon est enregistré dès la pose.
**Vérif [BE]** : `review.json` en `aqr.review/2`, `status: draft`, `tester` renseigné.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.12 — [WEB] Poignées, − / +, caler : bornes
**Priorité** : normal
**Technique** : valeurs-limites
**Action** : tirer une poignée au-delà de l'autre, au-delà du début et de la fin du fichier ; − / + répétés ; flèches (0,1 s) et Maj + flèches (1 s) ; « caler sur la lecture ».
**Attendu** : une plage garde au moins 0,2 s et reste dans le fichier ; chaque modification remet « Pas encore écoutée » ; les valeurs sont au dixième.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.13 — [WEB] Puces, verset attendu, confirmation (must-fail inclus)
**Priorité** : critique
**Technique** : partition-équivalence
**Action** : sur un brouillon vide, « Confirmer » ; cocher une puce par famille ; saisir « 2-256 » puis « 2:256 » comme verset attendu ; confirmer ; recharger.
**Attendu** : sans puce ni commentaire la confirmation est refusée avec le message prévu ; les puces sont multi-sélection avec coche + inversion (jamais la couleur seule) ; « 2-256 » est signalé invalide et non enregistré ; après confirmation : « Signalement enregistré », losange plein sur l'onde et la piste Revue ; tout survit au rechargement.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.14 — [WEB] Suppression annulable (6 s)
**Priorité** : normal
**Technique** : transition-état
**Action** : supprimer un signalement ; cliquer « Annuler » dans les 6 s ; recommencer sans annuler et recharger après 8 s.
**Attendu** : annuler restaure le signalement tel quel ; sans annulation il disparaît aussi du serveur ; aucun signalement ne revient après rechargement.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.15 — [WEB][API] Plusieurs testeurs : fusion et conflits
**Priorité** : critique
**Technique** : table-décision
**Action** : deux navigateurs (profils distincts) sur la même session, pseudonymes « Awa » et « Moussa », qui signalent en même temps ; filtrer la liste par testeur ; Moussa modifie un signalement d'Awa ; rafraîchir (15 s) ; envoyer en parallèle deux `PUT` valides au même identifiant avec des `updated_at` différents.
**Attendu** : aucun signalement n'écrase l'autre ; chaque navigateur retrouve le travail de l'autre sans recharger ; le nom d'origine est conservé (`updated_by` = modificateur) avec l'encart de modification ; en conflit, le dernier `updated_at` gagne par identifiant.
**Vérif [BE]** : `review.json` contient les deux ensembles ; `revisions/` garde l'état précédent.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.16 — [WEB] Pseudonyme : règles (must-fail)
**Priorité** : critique
**Technique** : partition-équivalence
**Action** : saisir « a », « a@b.fr », 25 lettres, `<b>x</b>`, une chaîne vide, puis un nom valide ; changer de testeur et vérifier la liste des récents.
**Attendu** : les quatre premiers cas sont refusés avec « 2 à 24 caractères : lettres, chiffres, espace, - _ . (pas d'adresse e-mail). » ; aucun signalement possible sans testeur (toast « Indique d'abord qui teste. ») ; 8 récents au plus, sur cet appareil.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.17 — [WEB] Onglet Vérité terrain réservé au relecteur
**Priorité** : critique
**Technique** : partition-équivalence
**Action** : ouvrir la page sans puis avec `?relecteur=1`.
**Attendu** : sans le paramètre, aucun onglet ni panneau « Vérité terrain » dans le DOM ; avec, l'onglet existe et fonctionne comme avant (proposer, aligner, valider, écrire dans le manifeste).
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.18 — [WEB] Raccourcis à une touche
**Priorité** : normal
**Technique** : partition-équivalence
**Action** : taper `m`, `p`, `l` dans un champ de saisie ; les taper ailleurs ; désactiver le réglage puis recommencer ; `Ctrl+Entrée` sur un brouillon valide.
**Attendu** : aucun raccourci à une touche dans un champ ; désactivés, ils ne font rien (sauf Ctrl+Entrée et Échap) ; Espace n'active pas la lecture quand un bouton a le focus.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.19 — [WEB] Performance
**Priorité** : normal
**Technique** : valeurs-limites
**Action** : ouvrir l'onglet avec 0 analyse (dossier de test vide), puis avec des analyses ; changer la période ; ouvrir « Voir en tableau ».
**Attendu** : état vide lisible, aucun NaN ni « ×Infinity » ; tuiles, barres (une teinte, nommées, chiffrées), file en cours et tableau cohérents entre eux ; la période filtre bien.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.20 — [WEB] Responsive et accessibilité
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : 375, 768 et 1440 px, clair et sombre : défilement horizontal, cibles tactiles, focus visible, contrastes ; `prefers-reduced-motion` ; navigation au clavier de bout en bout (pose, puces, confirmation) ; lecteur d'écran sur la carte (`aria-live`), les onglets, les puces.
**Attendu** : aucun défilement horizontal du document ; cibles ≥ 44 px au tactile (hors segments de piste, doublés par la liste) ; focus visible partout ; contrastes AA ; aucune animation sous réduction de mouvement ; tout le parcours se fait sans souris.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### AR.21 — [WEB] Non-régression : lecteur, écoute exacte, exports
**Priorité** : critique
**Technique** : nominal
**Action** : lecture/pause, ±5 s, vitesse, volume, fenêtre visible (fichier entier, 10 min, 2 min, 30 s, 10 s), « Suivre la lecture », « Écouter ce passage », clic sur un segment, liste d'intervalles et filtres, détails du moteur, pack ZIP et bilan JSON, import d'un résultat existant, enregistrement micro (états micro, point rouge, carré d'arrêt).
**Attendu** : tout fonctionne comme avant ; la tête de lecture traverse l'onde, les trois pistes et la règle au même x à tout zoom ; « Écouter ce passage » s'arrête sur la fin de l'intervalle.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

## Must fail (doivent être bloqués)
- Un pseudonyme e-mail, vide ou de plus de 24 caractères ne s'enregistre jamais.
- Un signalement vide ne se confirme pas ; un verset attendu mal formé n'est pas enregistré.
- `GET /api/fonts/<nom>` ne sert jamais un fichier hors liste blanche ni à un hôte non local.
- Le sondage ou l'actualisation de la liste n'efface jamais un point « non lu ».
- Un `PUT` de revue d'un autre audio, d'une autre session ou hors durée est refusé (400) et n'écrit rien.
- Le texte arabe d'un verset n'est jamais celui d'une constante de l'interface ; une formule n'est jamais présentée comme venant du corpus ou de QuranEnc.
