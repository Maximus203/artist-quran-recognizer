# Export : nouvel écran et sélecteur de plage (PR #122)
> Surfaces : [WEB] (téléphone 375 px d'abord, puis 1280 px) · [API] · Statut : ⬜ · Build : feat/export-refonte @ —
> Périmètre : `/s/<id>/exporter` (onglets Vérifier, Sous-titres, Vidéo), frise et liste des plages, bordereau,
> rendu multi-fichiers ; API `export_video` (`ranges[].name`, `suggest`), job (`progress`, `files_done/total`),
> `GET …/thumbnails`. Hors périmètre : la correction d'un passage (écran `corriger`), le direct.
> Environnement : serveur local sur un port libre 3921–3929, `AQR_REVIEW_DIR=D:/01-Dev/Data/aqr-review-vidtest`,
> compte de test (cookie `aqr_session` de `%TEMP%\vt.cookie`), jeton API de `%TEMP%\vt.token`. Chrome ou Edge.
> Données : session vidéo terminée `87b80f10-aeea-408b-a579-34ac7c23ae30` (41,5 s, 5 versets) ; session audio seul
> `a0d10000-0000-4000-8000-00000000a0d1` (copie de test, son extrait en MP3, même résultat).
> Critère d'arrêt : tous les must-pass critiques ✅, tous les must-fail bloqués proprement, console sans erreur,
> aucune requête en échec non gérée, aucun défilement horizontal de page à 375 px.

## Préconditions
- [WEB] Connecté avec le compte de test ; préférences d'export effacées (`localStorage.removeItem("aqr.ui.v1.export-video")`).
- [API] `ffprobe` disponible pour contrôler les MP4.

## Parcours humain

### XR.1 — [WEB] La page s'ouvre sur la porte « Vérifier »
**Priorité** : critique
**Technique** : nominal
**Action** : Ouvrir `/s/<vidéo>/exporter` à 375 px.
**Attendu** : titre « Vérifier *avant* d'exporter » ; rail à trois onglets ; badge « Prêt » (ou un nombre ambre s'il reste des passages à valider) ; frise d'ensemble (onde + losanges sur ambigus/déduits) ; boutons « Exporter les sous-titres » / « Exporter la vidéo » qui changent d'onglet. `scrollWidth = 375`.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.2 — [WEB] Rail au clavier
**Priorité** : normal
**Technique** : transition-état
**Action** : Mettre le focus sur l'onglet actif, flèches ← / →.
**Attendu** : l'onglet change et prend le focus ; le titre suit (« Exporter les *sous-titres* », « Exporter la *vidéo* ») ; un seul onglet est dans l'ordre de tabulation.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.3 — [WEB] Vidéo : « Un verset = une vidéo »
**Priorité** : critique
**Technique** : nominal
**Action** : Onglet Vidéo, toucher « Un verset = une vidéo ».
**Attendu** : 5 plages, nommées par leur référence (ex. « 91:1 »), souffle hachuré entre le bord et la voix ; titre du chapitre « 5 plages · … » ; bordereau « 5 vidéos · une par plage » ; nom de fichier « … — 91.1.mp4 ».
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.4 — [WEB] Glisser une poignée (souris) et l'aimant
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : Bureau 1280 px. Choisir la plage 1, glisser sa poignée de fin de +40 px, puis la ramener près d'un bord de passage.
**Attendu** : la bulle de temps suit la poignée ; à moins de 10 px d'un bord protégé, la fin s'y colle ; la liste affiche les nouveaux temps ; si la fin entre dans le verset suivant : « coupe une voix » (rouge) et « chevauche la plage 2 » (ambre) ; annonce « Fin : … » dans la région vivante ; l'aperçu montre l'image à ce temps.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.5 — [WEB] Must-fail : une plage ne peut pas devenir trop courte ni sortir de l'audio
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : Glisser la poignée de début au-delà de la poignée de fin ; glisser la fin au-delà de la fin de l'audio ; dans la saisie précise (crayon) écrire « abc », « 0:50,0 » (audio de 41,5 s) puis une fin à 0,2 s du début.
**Attendu** : la plage garde 0,5 s au moins et reste dans [0, durée] ; messages en clair : « Écris le temps comme 3:12,4… », « L'audio s'arrête à 0:41,5. », « La fin doit venir au moins 0,5 s après le début. » ; rien n'est appliqué tant que la saisie est fausse.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.6 — [WEB] Clavier complet sur une poignée
**Priorité** : critique
**Technique** : partition-équivalence
**Action** : Tab jusqu'à « Fin de la plage 1 » ; ← / → ; Maj+← ; Alt+→ ; PgPréc ; `]` puis `[` ; Espace ; Suppr.
**Attendu** : ±0,1 s, −1 s, +0,02 s, +10 s ; `]`/`[` sautent au bord protégé voisin ; Espace écoute la plage ; Suppr la retire (la plage suivante est choisie) ; chaque pas est annoncé ; `aria-valuetext` parlé (« 5 min 0,8 s »).
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.7 — [WEB] Téléphone : appui long, pincement, toucher un passage
**Priorité** : critique
**Technique** : nominal
**Action** : 375 px (tactile). Appuyer 450 ms sur une poignée sans bouger, puis glisser ; pincer la loupe (même sur une plage) ; toucher un passage puis « Ajouter ce verset ».
**Attendu** : pastille « Précision ×5 » et geste démultiplié ; le pincement zoome sans déplacer la plage ; la bulle du passage propose « Ajouter ce verset » (sauf passage ambigu : message « vérifie-le avant… ») ; la plage ajoutée apparaît dans la liste.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.8 — [WEB] Vue d'ensemble, loupe et molette
**Priorité** : normal
**Technique** : nominal
**Action** : Glisser la fenêtre de la vue d'ensemble ; toucher ailleurs dans la vue d'ensemble ; boutons zoom − / cadrer / + ; Ctrl+molette ; molette verticale seule ; focus sur la fenêtre puis ← → + −.
**Attendu** : la loupe suit ; Ctrl+molette zoome autour du pointeur ; la molette verticale fait défiler la PAGE (jamais capturée) ; la loupe ne descend pas sous 8 s.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.9 — [WEB] Souffle : les plages automatiques suivent, les retouchées non
**Priorité** : critique
**Technique** : table-décision
**Action** : « Un verset = une vidéo », retoucher la plage 1 à la main, puis « Avant la voix » + jusqu'à 1,2 s ; décocher « Aimanter au silence ».
**Attendu** : les plages 2 à 5 s'élargissent, la plage 1 ne bouge pas ; les marques vertes de silence disparaissent avec l'aimant ; le réglage est mémorisé après rechargement.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.10 — [WEB] Liste : nommer, monter, descendre, retirer, « Voir les autres »
**Priorité** : normal
**Technique** : nominal
**Action** : Renommer la plage 2 « Ouverture » ; la monter ; la descendre ; retirer la 3 ; sur un essai à plus de 6 plages, « Voir les N autres plages ».
**Attendu** : l'ordre change dans la liste ET sur la frise (numéros) ; le nom apparaît dans le nom de fichier du bordereau et dans le JSON de l'API ; « Ajouter une plage » ne repropose pas un passage déjà listé.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.11 — [WEB] Qualité et poids
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : Choisir chaque palier ; « Sur mesure » 2160p à 60 im/s ; « Tout l'audio ».
**Attendu** : chaque palier affiche le poids des plages choisies ; 2160p·60 est toujours « lourd » (motif hachuré + libellé, jamais la couleur seule) ; au-delà de 800 Mo ou d'un fichier de 500 Mo : « très lourd » (points) ; le bordereau propose « Passer en 1080p · 30 im/s » qui ramène la qualité.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.12 — [WEB] Export réel : plusieurs plages, 60 im/s, résolution > 1080
**Priorité** : critique
**Technique** : nominal
**Action** : Deux plages, 1440p à 60 im/s, « Exporter 2 vidéos » ; observer le bordereau pendant le rendu ; puis « Retélécharger tout ».
**Attendu** : « 1 vidéo en cours sur 2 », une ligne par fichier (✓ + poids / barre % / en attente) ; à la fin « 2 vidéos prêtes » ; les MP4 sont téléchargés dès qu'ils sont prêts.
**Vérif [BE]** : `ffprobe` sur chaque fichier : h264 2560×1440 (16:9), `r_frame_rate=60/1`, piste aac, durée = durée de la plage.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.13 — [WEB] Arrêt après la vidéo en cours, reprise après échec
**Priorité** : normal
**Technique** : transition-état
**Action** : 5 plages ; pendant la vidéo 2, « Arrêter après cette vidéo ». Puis provoquer un échec (ex. couper le serveur pendant la vidéo 2 d'un nouvel export) et « Reprendre tel quel ».
**Attendu** : l'export s'arrête après la vidéo 2 (« 2 vidéos prêtes sur 5 (arrêt demandé) ») ; l'échec dit quelle vidéo a échoué, que les précédentes sont téléchargées, et la reprise repart de la vidéo en échec, sans refaire les précédentes.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.14 — [WEB] Téléphone : aperçu en bandeau, dock et feuille
**Priorité** : critique
**Technique** : nominal
**Action** : 375 px, onglet Vidéo, défiler sous l'aperçu ; toucher le résumé du dock ; Échap.
**Attendu** : bandeau d'aperçu fixé en haut (plage + temps, « Voir » remonte) ; dock « N vidéos · ≈ X Mo » + « Exporter » ; la feuille montre le même bordereau (JSON API compris) et se ferme par Échap ou le voile ; aucun défilement horizontal sur les trois onglets.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.15 — [WEB] Session audio seul et session vide
**Priorité** : normal
**Technique** : partition-équivalence
**Action** : Ouvrir l'onglet Vidéo de la session audio seul ; puis d'une session sans passage coranique avec texte (si disponible).
**Attendu** : audio seul : pas de rangée d'imagettes, pas de format « Comme la vidéo » ni de fond « Vidéo d'origine » ; vide : illustration + « Aucun passage coranique avec du texte… » + « Aller à Vérifier », bouton « Rien à exporter » désactivé.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.16 — [WEB] Clair / sombre, mouvement réduit, lecteur d'écran
**Priorité** : normal
**Technique** : nominal
**Action** : Basculer le thème ; activer `prefers-reduced-motion` ; parcourir la frise au lecteur d'écran.
**Attendu** : la frise se redessine avec les couleurs du thème ; le squelette ne pulse plus ; poignées et fenêtre annoncées comme curseurs avec leur temps en clair ; une seule région d'annonce.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

## Parcours agent

### XR.A1 — [API] Le JSON « Même export par l'API » est exact
**Priorité** : critique
**Technique** : nominal
**Action** : Composer deux plages nommées à l'écran, copier le JSON du bordereau, l'envoyer tel quel (sans `id`) en `POST /api/v1/recordings/<id>/export/video/jobs` `{ "options": … }`.
**Attendu** : 202 ; les fichiers produits ont les mêmes noms, dimensions, cadence et durées que l'export fait à l'écran.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.A2 — [API] Découpe protégée par verset, 60 im/s, 1440p, vertical
**Priorité** : critique
**Technique** : nominal
**Action** : `{"options":{"suggest":"verse","fps":60,"resolution":1440,"orientation":"9:16"}}`, suivre le job toutes les 6 s.
**Attendu** : `progress` lisible (« Vidéo 2/5 : rendu 40 % »), `files_done` qui monte jusqu'à `files_total` = 5 ; 5 téléchargements nommés « … — 91.1.mp4 » à « … — 91.5.mp4 ».
**Vérif [BE]** : `ffprobe` : 1440×2560, 60/1, durées = `end − start` de `GET …/export/suggestions`.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.A3 — [API] Must-fail : noms et imagettes
**Priorité** : critique
**Technique** : erreur
**Action** : `ranges:[{start:0,end:5,name:""}]` ; un nom de 81 caractères ; `ranges` + `suggest` ensemble ; `GET …/thumbnails` sur la session audio ; `?count=0`, `?width=999` ; sans jeton.
**Attendu** : 400 lisibles pour les options ; 409 `no_video` pour l'audio seul ; 400 hors bornes ; 401 sans jeton. Un nom « ../x » ne sort jamais du dossier (nom de fichier nettoyé).
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.A4 — [API] Imagettes d'une session vidéo
**Priorité** : normal
**Technique** : nominal
**Action** : `GET /api/v1/recordings/<vidéo>/thumbnails?count=12&width=64`, deux fois.
**Attendu** : JPEG de 12 × 64 px de large ; en-têtes `X-Aqr-Thumb-Count: 12`, `X-Aqr-Thumb-Every` ; la seconde réponse vient du cache (`listening/thumbs-12x64.jpg`, pas de nouveau ffmpeg).
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —

### XR.A5 — [API] MCP
**Priorité** : normal
**Technique** : nominal
**Action** : `export_video` avec `ranges:[{start,end,name}]` puis `get_video_export`.
**Attendu** : les noms passent jusqu'aux fichiers ; `progress`, `files_done`, `files_total` présents ; `get_export_options` décrit `ranges[].name`.
**Observé** : _(à remplir)_
**Verdict** : ⬜
**Issue** : —
