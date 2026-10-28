# Notes de version

<!--
Format STRICT (une page de l'atelier l'affiche en chronologie ; scripts/check_docs_index.py le contrôle) :
  - un titre `## AAAA-MM-JJ — Titre court` par entrée, la plus récente en premier ;
  - juste dessous : `Étiquettes : …` (sous-ensemble de : utilisateur, technique, décision) puis `PR : #NN`
    (plusieurs : `PR : #44, #45` ; aucune : `PR : -`) ;
  - un paragraphe `**Ce qui change.** …` puis, si pertinent, `**Pourquoi / décision.** …` (renvoi ADR).
Nouvelle entrée : python scripts/new_release_note.py "Titre" --tags utilisateur,technique --pr 69
-->

## 2026-10-28 — Quran TR : nouveau nom, essais privés par défaut, API et MCP
Étiquettes : utilisateur, technique, décision
PR : -

**Ce qui change.** L'outil s'appelle désormais **Quran TR** (titres, en-tête, documentation). Les nouveaux audios sont **privés par défaut** — chaque compte ne voit que les siens, y compris pour les testeurs qui arrivent par le tunnel ; « Partagé » reste un choix par essai (réglage de compte et à l'import). Nouvelle page **Compte → API & MCP** : on y crée des jetons d'accès (lecture seule ou écriture, durée facultative), affichés une seule fois et révocables. Avec un jeton, une application ou un agent IA utilise Quran TR au nom du compte, même en local : API REST sous `/api/v1/recordings`, serveur MCP sous `/mcp` (lister les essais, lire les versets avec leur statut de preuve, générer des sous-titres, importer un audio), et une compétence `SKILL.md` téléchargeable qui apprend à l'agent à s'en servir.

**Pourquoi / décision.** Tous les audios d'un atelier ouvert se retrouvaient dans un même espace public : le défaut passe à « privé » (le partage devient explicite). Un jeton n'a que les droits de son compte, jamais l'administration ni la gestion des jetons ; la base ne garde que son empreinte SHA-256. Les outils MCP passent par l'API (mêmes contrôles et quotas) et ne renvoient que le texte du corpus et la traduction QuranEnc (I1, I2). Les essais déjà créés gardent leur portée. Voir `docs/API-MCP.md`.

## 2026-10-28 — Export vidéo : format, tailles, fonds proposés et texte sans chevauchement
Étiquettes : utilisateur, technique, décision
PR : #111

**Ce qui change.** La page Exporter a trois onglets visibles sur téléphone comme sur ordinateur — « 1 · Vérifier », « 2 · Réglages » (sous-titres) et « 3 · Vidéo » — et le formulaire vidéo est indépendant. On règle en regardant un aperçu réel (le verset le plus long de la session) : format horizontal, vertical (Reels, Shorts, TikTok), carré, ou « comme la vidéo importée » ; taille de l'arabe et de la traduction en un clic (Petit à Très grand, réglage précis possible) ; traduction affichée ou non ; fond choisi dans une galerie — cinq dégradés, neuf photos libres (mosquées, déserts, nature), la vidéo d'origine pour une session vidéo, une couleur unie, ou sa propre image — avec des liens vers Unsplash, Pexels, Pixabay et Freepik pour en trouver d'autres. Plus de fond noir par défaut. Le texte passe à la ligne tout seul et se réduit si un verset est très long : référence, arabe et traduction ne se chevauchent jamais et restent au-dessus de l'onde ; sur photo ou vidéo ils reposent sur un support gris aux bords doux. Le mot récité est surligné et l'onde défile avec la tête de lecture, comme dans l'atelier. La source de la traduction n'est plus écrite sous chaque verset. Format et tailles se mémorisent. Une vidéo importée garde son format et reçoit la traduction par-dessus.

**Pourquoi / décision.** Vérifié sur de vrais exports : la première version produisait une vidéo de 2 secondes sans aucun son (FFmpeg `-shortest` sur un flux H.264 brut, et horodatage déclaré par l'encodeur du navigateur), et une session MP4 n'était jamais reconnue comme vidéo (`.mp4` typé « audio »). Le mux assemble désormais les segments, impose 25 im/s (`setts`) et n'utilise plus `-shortest` ; un test avec le vrai FFmpeg garde ce défaut. La mise en page est un module pur testé (`lib/export-video-layout.ts`). Les photos viennent de Pexels (usage libre, crédits dans `web/public/backgrounds/CREDITS.md`) ; le code n'appelle aucun site de photos. L'attribution QuranEnc reste à l'export des sous-titres, pas dans l'image (choix du mainteneur, 2026-10-27). Voir §7 ter de `docs/ARCHITECTURE-ATELIER.md`.

## 2026-10-24 — Détection en direct : l'écran En direct
Étiquettes : utilisateur, technique, décision
PR : #110

**Ce qui change.** L'atelier a un écran « En direct » (page `/direct`, onglet dans la barre du haut, icône sur téléphone, carte « Écouter en direct » dans « Nouvel essai »). Un clic ouvre le micro, et le passage reconnu s'affiche pendant la récitation : d'abord le nombre de versets possibles et leurs mots communs, puis le verset nommé avec son texte du Mushaf mot à mot et sa traduction. Un verset sur trois environ n'est jamais nommé en direct : l'écran le dit comme un état normal (« Pas de verset nommé pour l'instant »), ne montre jamais le texte d'un verset qu'il n'est pas sûr d'avoir entendu, et écrit « Déduit de la position » (et non « Reconnu ») quand le numéro vient de la suite de ce que tu récitais. Une coupure de réseau ne perd rien : le son est gardé puis renvoyé, l'écran le dit. Une panne (micro refusé, service plein, jeton expiré) est expliquée en cause, conséquence et quoi faire. À la fin, « Garder cet enregistrement » envoie le son comme un import classique ; sinon rien n'est conservé par le serveur. Le libellé « Déduit · non entendu » devient « Déduit de la position » partout. Pour les testeurs, le script de démarrage lance maintenant aussi le service d'écoute et son tunnel.

**Pourquoi / décision.** Dernière brique de l'ADR-0011 (étape 4) : sans écran, le moteur en direct de l'étape 3 n'est pas utilisable. Éprouvé dans un vrai Chrome avec le vrai service (micro simulé par une récitation EveryAyah) : les premiers candidats s'affichent 2,2 s après le début de la voix en médiane (p90 3,2 s), le verset nommé 4,0 s (p90 6,9 s), et l'écran ajoute 2 ms au délai du moteur ; 19 versets nommés sur 48, aucun faux. Une coupure de 10 s se répare toute seule, une pause de 130 s tient (une trame de silence par seconde garde la connexion), le micro et le WebSocket passent par le tunnel Cloudflare. Le mode allégé et la correction ne sont éprouvés que par des messages injectés (le service ne les émet pas encore en conditions normales). Pas de voix réelle ni de téléphone réel dans cette preuve. Voir `docs/evaluation/live-etape4-2026-10-24.md`, `docs/design/en-direct.md` et l'ADR-0011.

## 2026-10-24 — Détection en direct : l'étape 3, le service WebSocket
Étiquettes : technique, décision
PR : #109

**Ce qui change.** Rien de visible pour l'instant : le moteur en direct a maintenant son service. `aqr live-serve` charge le modèle une fois et sert des flux audio par WebSocket (`aqr.live/1`, contrat dans `docs/LIVE-PROTOCOL.md`). L'atelier émet un jeton court, signé et à usage unique (`POST /api/live/token`) que le navigateur présente au service ; le service vérifie le jeton, l'origine et le nombre de flux (16 au plus, 2 par compte). Une coupure courte se reprend sans perdre ni répéter un message ; le son n'est jamais conservé ni journalisé. Mesuré avec le vrai modèle : le service ajoute 10 ms en médiane (14 à 39 ms avec le modèle, p90 sous 55 ms) et tient au moins 24 flux simultanés à moins d'une seconde de retard (32 à 1,1 s). Le protocole gagne `PROGRESS` (mot à mot), la clôture d'un passage non nommé, `DEGRADED`, `FINALIZING` et la traduction commune des candidats, demandés par la conception de l'écran.

**Pourquoi / décision.** WebSocket et non WebRTC (ADR-0011) : le service est joignable et le modèle veut du son fidèle. Le jeton n'est pas dans l'adresse (elle finit dans des journaux). `GAP` reste dérivé côté client ; `settle_s` passe à 1,5 s (arbitrage du mainteneur) ; le mode technique est ouvert à tous, éteint par défaut. Limites : une machine, voix propre, aucun navigateur réel ni tunnel avant l'étape 4, pas de vérification acoustique en direct. Voir l'ADR-0011 et `docs/evaluation/live-etape3-2026-10-24.md`.

## 2026-10-24 — Détection en direct : conception de l'écran En direct
Étiquettes : utilisateur, décision
PR : #108

**Ce qui change.** Rien de visible dans l'atelier pour l'instant : l'écran « En direct » est conçu, pas codé. Le brief décrit le parcours complet (bouton dans la barre du haut, demande d'accès au micro, niveau sonore, durée, connexion, mode allégé, coupure et reprise, arrêt, puis le geste « Garder cet enregistrement »), les niveaux d'affichage (écoute, candidats sans aucun texte de verset non nommé, verset nommé avec traduction, déduit de la position, « pas de verset nommé pour l'instant » présenté comme un état normal) et la façon de rendre l'attente de 5 à 20 s lisible. Des prototypes animés (données factices) et leurs captures accompagnent le document.

**Pourquoi / décision.** Le brief propose les choix à valider par le mainteneur (rien conservé par défaut, son gardé en mémoire du navigateur seulement, décalage audio sans effet en direct, libellé « Déduit de la position » à harmoniser dans la revue) et liste ce que `aqr.live/1` doit encore ajouter : progression après le verrou, clôture d'un passage non nommé, changement de dégradation en cours de flux. Voir `docs/design/en-direct.md` et l'ADR-0011.

## 2026-10-24 — Détection en direct : l'étape 2, le moteur incrémental
Étiquettes : technique, décision
PR : #107

**Ce qui change.** Rien de visible pour l'instant : le suivi en direct sait maintenant se nourrir d'un flux audio réel, par blocs, avec le modèle de reconnaissance en continu (ses caches sont gardés d'un bloc à l'autre) ; il rend les mots dès qu'ils sont stables, plus une transcription provisoire à part. Mesuré sur les 91 entrées du banc de l'étape 1, sur CPU : le calcul représente 6 % de la durée de l'audio (retard maximal d'un bloc 0,36 s) ; le premier message de candidats sort en médiane 2,5 s après le début du verset et le verrou en 5,3 s (p90 9,1 s), calcul compris ; aucun faux verrou sur 308. Si le calcul prend du retard, le système le dit (`DegradationChanged`) et durcit la règle de verrou (plus de mots, posterior plus haut), sans jamais l'assouplir. Le suivi comparait chaque mot nouveau à tout le vocabulaire : corrigé, de 3 à 10 fois plus rapide selon l'audio, mêmes résultats.

**Pourquoi / décision.** Les cibles de latence de l'étape 1 sont tenues sur une récitation propre et pas sur la voix réelle difficile (p90 du verrou jusqu'à 21 s) ; le délai vient des morceaux de 1,12 s du modèle et de l'attente de stabilité d'un mot (`settle_s` 0,8 s, mesuré : 80 ms coupait un mot sur trois), pas du calcul. Le GPU n'apporte rien avec le modèle livré (quantisé, facteur 1,0 en CUDA contre 0,06 au CPU). Les contrôles des paliers 2 et 3 (vérification acoustique, réécoute) ont leur contrat mais pas encore d'adaptateur. Voir l'ADR-0011 et `docs/evaluation/live-etape2-2026-10-24.md`.

## 2026-10-23 — Détection en direct : l'étape 1, la simulation hors ligne
Étiquettes : technique, décision
PR : #106

**Ce qui change.** Rien de visible pour l'instant : le suivi en direct (candidats ouverts au début d'un verset, verrou quand un mot départage, suite attendue, saut) existe comme moteur de simulation hors ligne, avec son banc de mesure. Sur 82 scénarios à vérité calculée, le premier message de candidats arrive en médiane 2,0 s après le début du verset et le verrou en 4,8 s (p90 8,7 s) ; 322 versets sur 492 sont nommés, sans aucun faux verrou. Un début de verset attendu dont l'ASR avale le premier mot n'est plus annoncé comme un saut. Un nouveau réglage, `min_lock_density` (0,9 au départ), refuse de nommer un verset dont les mots sont épars dans de la parole : il supprime le seul faux verrou mesuré et les verrous sur 3 600 s de parole réelle, au prix de 54 verrous sur 376.

**Pourquoi / décision.** Le critère de sortie de l'étape 1, zéro faux verset nommé, est atteint en vérité calculée et sur la parole, mais **non démontré sur la récitation réelle** (trois verrous hors de la sortie par lots, dont un suspect). La densité à 0,9 est une décision d'I3 avant le rappel, pas un réglage calibré. Le rapport dit les limites (jeu optimiste, aucune vérité terrain humaine) et propose des cibles de latence. Décisions du 2026-10-23 consignées dans l'ADR-0011 : `INFERRED` accepté avec `identity_basis: context`, `prior` 0,9 et `min_words_lock` 3 en valeurs de départ, transcription provisoire visible en mode technique seulement, audio du flux jamais conservé par défaut, transport WebSocket `aqr.live/1` et non WebRTC. Rapport : `docs/evaluation/live-etape1-2026-10-23.md`.
## 2026-10-23 — L'atelier ne déborde plus : liste des sessions et en-tête
Étiquettes : utilisateur, technique
PR : #104

**Ce qui change.** La page Sessions ne dépasse plus de sa carte entre 1024 et 1159 px : l'étoile des favoris et le menu « … » restent visibles (la colonne « Moteur » s'efface dans cette plage, elle reste dans la fiche). L'en-tête de l'application tient sur une ligne de 768 à 1159 px (avatar seul, « Nouvel essai » en icône, bascule de thème dans le menu du compte) et la page ne défile plus latéralement, y compris la revue d'une session, Documentation, Compte et Performance (de 320 à 460 px).

**Pourquoi / décision.** La colonne « Importé par » élargie à 148 px (PR #103) faisait déborder la grille ; la mesure en navigateur réel sur un build de production (320 à 1400 px, clair et sombre, 5 pages) a montré 150 mesures en échec sur 550, et 0 après correction. La garde `web/e2e/layout-overflow.mjs` rejoue cette mesure.

## 2026-10-23 — Photo de profil et propriétaire de chaque audio dans les listes
Étiquettes : utilisateur, technique
PR : #103

**Ce qui change.** Chaque audio affiche maintenant qui l'a importé : un petit avatar rond et le pseudo, dans le panneau Sessions, dans la page « Toutes les sessions » (colonne « Importé par ») et dans l'en-tête d'une session. Dans Compte, Préférences, une nouvelle carte « Profil » permet de choisir une photo (JPEG, PNG ou WebP, 2 Mo au plus), de la voir en aperçu rond avant de l'enregistrer, ou de la retirer ; l'avatar de l'en-tête et du menu du compte change aussitôt. Sans photo, l'avatar montre l'initiale du pseudo sur une couleur qui reste la même pour la même personne. Les audios déjà importés montrent leur propriétaire sans rien refaire. Un audio privé reste invisible des autres comptes ; les pseudos et les photos, eux, sont visibles de tous les testeurs connectés.

**Pourquoi / décision.** Pour voir d'un coup d'œil qui a testé quoi. La photo est lue par son contenu (SVG et tout autre format refusés), puis réencodée par ffmpeg, déjà requis par l'atelier, en JPEG carré de 256 pixels sans aucune métadonnée : aucune dépendance ajoutée, et ce que contenait le fichier d'origine n'est jamais conservé ni servi. Elle vit dans `AQR_REVIEW_DIR/avatars/`, hors dépôt. Le serveur la sert aux seuls comptes connectés, avec un cache qui se renouvelle quand la photo change. Détails et limites (orientation des photos de téléphone : ffmpeg 7.1 ou plus) : `web/README.md`, « Photo de profil » ; décision dans `.artist/decision-log.md` ; contrôle dans `.artist/acceptance-playbooks/photo-de-profil.md`.

## 2026-10-23 — Décalage audio : le surlignage se cale à l'oreille
Étiquettes : utilisateur, technique
PR : #101

**Ce qui change.** Si le mot surligné devance la voix que tu entends (écouteurs sans fil surtout), un nouveau réglage « Décalage audio » (Compte, Préférences, Affichage) retarde le surlignage de −500 à +500 ms, par pas de 10, et se retrouve sur tous tes appareils. Sous le passage actif, le bouton « Caler à l'oreille » lit le début du passage en boucle (8 secondes au plus) pendant que le curseur, ou les boutons − et +, déplacent le surlignage en direct ; « Terminé » ou Échap referme et arrête la lecture. Le décalage retarde le mot arabe, le fragment de traduction qui le suit et le changement de passage, seulement pendant la lecture : à l'arrêt, un clic sur un mot garde ce mot. L'audio, l'onde, la tête de lecture, les temps du moteur et l'export ne changent pas.

**Pourquoi / décision.** Mesuré le 2026-10-23 sur un build de production dans Chrome, sur les trois sessions au micro signalées : le lecteur lit la copie d'écoute WAV du moteur (`engine-pcm`, durées identiques à celles du moteur : 20,1 s, 136,5 s, 35,4 s) et le mot surligné suit `audio.currentTime` avec un retard de 1 à 40 ms (médiane 6 à 18 ms, 5 à 30 transitions par passage), jamais une avance. Le code n'ajoute donc aucune avance : celle qu'on entend est la latence de sortie de l'appareil d'écoute, que le navigateur ne mesure pas, d'où un réglage par compte plutôt qu'une correction automatique. Avec le réglage à +200, −150 et +500 ms, le retard mesuré devient 206, −136 et 510 ms (médianes). Le calcul est une fonction pure (`web/lib/audio-offset.ts`, `liveAt` dans `web/lib/passage.ts`) ; la préférence `audioOffsetMs` est validée par le schéma commun des préférences.

## 2026-10-23 — Les scripts d'évaluation tournent aussi sous Windows
Étiquettes : technique
PR : #100

**Ce qui change.** `aqr.eval.run` (verrou de dossier de sortie) et `scripts/recognize_batch.py` (pic mémoire) ne dépendent plus de modules propres à Unix : un petit module `aqr.eval.portable` choisit `flock` ou `msvcrt.locking` pour le verrou, et `resource` ou l'API Windows pour la mémoire. La suite de tests Python passe en entier sous Windows (elle comptait 67 échecs) ; quelques tests propres à Unix (bits de permission, signal envoyé à soi-même, liens symboliques sans droit) sont ignorés sous Windows, et deux tests de chemins et de dépôt git parent sont rendus indépendants de la machine. Le résultat produit sous Linux et macOS ne change pas.

**Pourquoi / décision.** Ticket [#89](https://github.com/Maximus203/artist-quran-recognizer/issues/89) : les échecs Windows cachaient d'éventuelles régressions. Aucune dépendance ajoutée. Les anciens rapports d'évaluation gardent leur texte d'origine, daté.

## 2026-10-23 — Export des sous-titres dans l'atelier : vérifier, corriger à l'oreille, exporter
Étiquettes : utilisateur, technique, décision
PR : #99

**Ce qui change.** Une session terminée a maintenant un bouton « Exporter » (ou la touche E) qui ouvre la page d'export, à deux colonnes sur ordinateur et en deux onglets sur téléphone. À gauche, le contrôle : combien de passages ambigus restent, filtrables (incertains, coupures, traductions approximatives), avec écoute en un geste. À droite, les réglages (format SRT, WebVTT, ASS mot à mot ou JSON, contenu, formules, répétitions, nom du fichier) et un aperçu en direct des premiers sous-titres. Un passage se corrige sur un écran dédié : l'onde, ce que le moteur a dit, ce qu'on entend ; on choisit un candidat, une autre référence ou une plage de mots, on exclut le passage ou on l'ignore. Une décision écoutée sur au moins 70 % de sa plage est notée « écoutée » (vérité terrain proposée). Le bouton « Forcer l'export » demande quoi faire des passages restants (les omettre, les garder avec un marqueur, prendre le premier candidat) et montre ce que chacun deviendrait. Le fichier se télécharge avec le rappel d'attribution à copier ; tout se contrôle au clavier (Espace, 1 à 9, X, Entrée, J, K, Échap), en thème clair et sombre, sans défilement horizontal à 375 px.

**Pourquoi / décision.** C'est la quatrième brique de l'export (ADR-0014, `docs/design/export-sous-titres.md`) : les trois premières (#96, #97, #98) posent le format des décisions, le moteur et l'API ; celle-ci n'ajoute que l'écran, sans toucher à la liste ni à la chronologie de l'atelier (nouveaux composants dans `web/app/atelier/export/`, styles dans `web/app/export.css`, quatre variables de couleur de sous-titre ajoutées aux jetons). Le moteur renvoie en plus l'état filtré, la page du premier passage ouvert et les passages non coraniques (≤ 100) pour que l'écran ne recalcule rien. Mesuré le 2026-10-23 sur un serveur de production : la page d'une session de 23 minutes se charge sans erreur console, le contrôle répond en environ 1,4 s, l'export ASS en environ 1 s. Vérifié dans un navigateur : choix, validation, annulation, ignorer, forcer avec marqueur (le fichier téléchargé contient la décision et le marqueur), thème clair, clavier. Pas encore vérifié dans un navigateur : l'écran vu par un non-propriétaire (couvert côté API par le playbook de #98).

## 2026-10-23 — Export des sous-titres : l'API de l'atelier, contrôle, décisions et export
Étiquettes : technique, décision
PR : #98

**Ce qui change.** Le serveur de l'atelier expose l'export des sous-titres, sans écran encore (il vient dans la PR suivante). Une page de passages ambigus « prêt à exporter ? » se calcule à la demande, dix par page, selon ce qu'on exporte. Les corrections à l'oreille s'enregistrent dans un fichier à part (`decisions.json`) et s'annulent ; l'export refuse tant qu'il reste des passages ambigus, sauf si on force (409 `unresolved_items`). Après une nouvelle analyse, une décision dont le passage a changé devient orpheline : l'atelier la montre avec le passage le plus proche et la rattache sur demande, jamais en silence. Seul le propriétaire de l'audio (ou un administrateur) corrige ; l'accord d'utiliser ses corrections pour améliorer le moteur est activé pour ses propres sessions, jamais pour celles des autres. Les corrections écoutées peuvent être proposées à la vérité terrain (jamais validées seules).

**Pourquoi / décision.** Le serveur n'a pas le corpus : il lance le moteur Python (`aqr export-readiness`, `export-subtitles`, `corpus-verse`), au plus trois à la fois, en mémorisant les réponses identiques, au lieu de réécrire le rendu en TypeScript. Le lecteur de `decisions.json` côté atelier et côté moteur donne le même verdict sur 36 documents d'essai et la même empreinte sur 7 intervalles (fixtures partagées). ADR-0014, `web/README.md`, `docs/DECISIONS.md`.

## 2026-10-23 — Export des sous-titres : la commande aqr export-subtitles
Étiquettes : utilisateur, technique, décision
PR : #97

**Ce qui change.** Une commande produit les sous-titres d'un audio analysé : `aqr export-subtitles` écrit du SRT, du WebVTT, de l'ASS (karaoké mot à mot quand les temps des mots sont mesurés) ou le JSON enrichi. Elle contrôle d'abord les passages ambigus de la partie coranique (versets incertains, supposés, coupés au milieu d'une suite, traductions approximatives, signalements de revue confirmés) et refuse d'exporter tant qu'il en reste, sauf si on force. Forcer omet par défaut les passages douteux (jamais un faux verset nommé) ; un marqueur `[incertain : …]` ou le premier candidat restent possibles. Un passage dont le choix ne change rien à ce qui est imprimé (même arabe, même traduction) ne bloque pas, et un signe de pause qui diffère est compté à part. Les abstentions et les formules ne sont jamais obligatoires. `aqr recognize --format srt,vtt` écrit maintenant avec les mêmes écrivains. L'atelier et ses écrans viennent dans les PR suivantes.

**Pourquoi / décision.** Le mainteneur écoute un audio, exporte si tout est correct et corrige ou force sinon. Un seul moteur de rendu en Python (le web n'a pas le corpus) évite deux implémentations qui divergent. Le texte arabe est toujours relu dans le corpus (I1), la traduction est celle de QuranEnc (I2, option explicite pour retirer les renvois de note), la prédiction n'est jamais réécrite (ADR-0014). Mesuré sur une vraie session de 23 minutes : contrôle en 1,4 s, export ASS en 1,0 s. `docs/EXPORT-SOUS-TITRES.md`.

## 2026-10-23 — Export des sous-titres : le calque de décisions humaines (ADR-0014)
Étiquettes : technique, décision
PR : #96

**Ce qui change.** Première brique de l'export des sous-titres (issue #86) : le format du calque de décisions humaines `aqr.decisions/1`. Corriger à l'oreille un passage ambigu (choisir entre `11:61` et `7:73`, confirmer un verset supposé, étendre un verset coupé) ne modifiera jamais la sortie du moteur : la décision est un document à part, accroché au passage par l'empreinte de ce que le moteur avait dit. Rien ne change encore pour l'utilisateur ; le moteur d'export (PR suivante) et les écrans de l'atelier viennent ensuite.

**Pourquoi / décision.** Le moteur se mesure sur sa prédiction : la réécrire avec des corrections empêcherait de savoir s'il s'améliore (I5). ADR-0014 fixe le statut `resolved`/`by: "human"` à côté du `status` intact, l'empreinte (sha256 de la forme canonique, temps en millisecondes entières, mêmes vecteurs en Python et en TypeScript), le sort d'une décision orpheline après une nouvelle analyse (jamais appliquée en silence), l'omission comme règle d'un export forcé et le consentement d'entraînement (activé pour ses propres sessions, verrouillé sinon). Contrat : `docs/DECISIONS.md`.

## 2026-10-23 — Fluidité sur les longs audios : navigation, lecture et ouverture
Étiquettes : utilisateur, technique
PR : #94

**Ce qui change.** Sur un audio de 2 h 14 (3 128 intervalles), l'atelier reste fluide. Un saut entre versets (clic dans la liste, flèches, clic sur l'onde) répond en 30 à 40 ms au lieu de 1,7 s ; la lecture et le surlignage des mots avancent sans à-coup ; le glisser de la timeline et le changement de fenêtre visible ne bloquent plus ; la session s'ouvre en 0,3 à 0,5 s au lieu de 2,5 à 4 s. La liste des intervalles est virtualisée (≈ 25 lignes dans la page au lieu de 3 128) et reste utilisable au clavier : une seule ligne porte la tabulation, flèches, Début, Fin, Page précédente et suivante déplacent le focus, chaque ligne annonce sa position et la taille de la liste. Sur « Fichier entier », les abstentions contiguës se fondent en blocs (151 au lieu de 3 128 segments) : l'onde redevient visible entre eux, et un clic sur un bloc choisit l'intervalle le plus proche du temps cliqué. Les graduations ne couvrent plus que la zone proche. La position affichée change 20 fois par seconde, la tête de lecture 60 fois ; les crêtes de l'onde sont revalidées (304) à la réouverture d'une session. Le banc `web/e2e/perf-measure.mjs` mesure tout cela sur un build de production (`web/README.md`).

**Pourquoi / décision.** Le mainteneur ressentait des saccades en naviguant entre versets sur un audio de 2 h. Mesure avant correction : 22 400 nœuds DOM, 176 tâches longues pour 50 sauts, mise en page de 93 ms par saut ; 86 % du coût venait des 6 300 boutons de segments, le reste de la liste et de la mise en page de toute la page à chaque image de lecture. Règle retenue : le DOM ne dépend que de l'écran (`docs/ARCHITECTURE-ATELIER.md` §6 bis), par des fonctions pures testées. Pas de bibliothèque de virtualisation : une liste à hauteur de ligne fixe et un index temporel se codent en 150 lignes testées, et le fenêtrage de la timeline (fusion de blocs, fenêtre de rendu) n'existe dans aucune bibliothèque. Reste à faire : une mise en page de 5 ms à chaque mise à jour du texte de position sur un écran 240 Hz (voir la PR #94).

## 2026-10-23 — README allégé : l'atelier d'abord, les détails techniques en bas
Étiquettes : utilisateur
PR : #95

**Ce qui change.** Le README met l'atelier web en avant : une démonstration animée en haute définition (WebP de 1800 px de large, 3,7 Mo, remplaçant le GIF de 426 px devenu flou ; une version MP4 sans son est liée dessous), quelques lignes sur ce que fait l'atelier, un démarrage court et l'appel à contribuer. Le moteur, les règles, les mesures, la feuille de route, l'organisation du dépôt et les attributions passent en bas, dans des sections repliables. Aucun code ne change.

**Pourquoi / décision.** La première version du README était trop technique pour une page d'accueil : le lecteur doit voir l'atelier d'abord. Le contenu technique n'est pas supprimé, il est replié.

## 2026-10-23 — Dépôt public : README, contribution, tickets et crédits
Étiquettes : utilisateur, technique
PR : #92

**Ce qui change.** Le dépôt public se présente : le README raconte le projet (démonstration en image, atelier web, fonctionnement du moteur, règles qui ne bougent jamais, chiffres mesurés avec leurs limites, démarrage rapide, feuille de route) et existe aussi en anglais. Le dépôt gagne un guide de contribution, un code de conduite, une politique de sécurité, une page de crédits et de licences, trois formulaires d'issue (bug, problème de reconnaissance, idée) et une carte de la documentation. Aucun code du moteur ni de l'atelier ne change.

**Pourquoi / décision.** Le projet vise des contributions extérieures : relecture à l'oreille, tests d'accessibilité, portage Windows, moteur en flux. Les chantiers ouverts sont tracés en issues (détection en direct, export de sous-titres, transcription des parties non coraniques, vérité terrain, fine-tuning, trois premiers tickets). La licence du code reste MIT ; la bascule vers une licence non commerciale décidée par le mainteneur n'est pas faite et le README le dit.

## 2026-10-23 — Les versets à moitié reconnus sont complétés par l'audio
Étiquettes : utilisateur, technique, décision
PR : #83

**Ce qui change.** Un verset dont une partie est reconnue et l'autre non est maintenant complété par ce que l'audio contient réellement. Cinq défauts relevés à l'écoute d'un enregistrement de 23 minutes sont corrigés (un seul reste, le premier mot de 1:1) : les deux premiers versets de la Fatiha lus mais restés incertains sont reconnus parce que la suite qui les contient a été confirmée ; un mot dit juste après la fin d'un verset est ajouté ; le début manquant d'un verset dont la fin est reconnue, ou son milieu, s'affiche ; un verset redit en entier est détecté comme répétition. Chaque ajout est vérifié sur la parole elle-même : si l'audio ne soutient pas le texte attendu, rien n'est affiché. Sur 11 fichiers (dont deux sans aucun Coran) aucun verset reconnu avant n'est perdu et aucun verset n'est ajouté là où il n'y a pas de Coran. Champs de sortie additifs : `promoted_by` peut valoir `chain` ou `gap`, et `acoustic_checks` trace chaque hypothèse (`kind: gap`).

**Pourquoi / décision.** Le mainteneur a signalé cinq cas du même genre sur le lot3-04. Un seul mécanisme plutôt que cinq rustines : le contexte (verset reconnu avant ou après, fin du fichier) dit presque ce qu'il faut attendre dans le trou ; le texte vient du corpus, jamais d'un modèle, et l'audio décide. La preuve est mesurée sur la seule parole alignée (celle d'un long passage est diluée par les blancs). ADR-0013, mesures dans `docs/evaluation/comblement-de-trou-2026-10-23.md`, liste des ajouts proches du seuil à écouter.

## 2026-10-23 — Courbe de vitesse : réécouter un audio accéléré n'apporte rien à la cascade
Étiquettes : technique, décision
PR : #82

**Ce qui change.** Aucun changement de comportement : le moteur ne réécoute pas les fenêtres douteuses sur un audio accéléré. Le dépôt gagne la mesure qui a permis d'en décider : `scripts/measure_speed.py` (témoins EveryAyah étirés puis accélérés, vrais fichiers lents accélérés de ×1,25 à ×2,5) et `aqr.eval.speed_curve` (grille, remise à l'échelle des temps, estimateurs de débit sans vérité, règle de décision), avec leurs tests.

**Pourquoi / décision.** La règle écrite avant la mesure n'est pas satisfaite : avec le facteur ESTIMÉ, le rappel des témoins gagne +11,0 points à ×0,4 et +21,9 à ×0,3 sans faux verset, mais un fichier de contrôle (`lot1-09`) reçoit un verset nouveau (11:105, probablement une vraie citation) et, mesuré dans la cascade complète, un prototype n'ajoute aucun verset distinct sur 7 fichiers. Découverte : l'optimum de compensation est à une vitesse nette de ×1,2 à ×1,6, pas à l'inverse de l'étirement. Le prototype reste sur la branche `wip/etage-vitesse`, non fusionnée. `docs/evaluation/courbe-vitesse-2026-10-23.md`.

## 2026-10-23 — Glisser pour naviguer dans la timeline, tracé qui se ferme tout seul
Étiquettes : utilisateur
PR : -

**Ce qui change.** Quand la timeline est zoomée, on la saisit avec la souris et on la glisse vers la gauche ou la droite pour naviguer, au lieu d'aller chercher la barre de défilement tout en bas (un simple clic déplace toujours la lecture). Dans la revue, l'outil « Tracer sur l'onde » se ferme tout seul dès qu'une plage ou un point est tracé, et aussi quand on valide le signalement : on continue d'écouter, et on le réactive pour un nouveau signalement.

**Pourquoi / décision.** Retours du propriétaire pendant ses tests : la navigation par la barre du bas est lourde, et devoir quitter manuellement l'outil de tracé après chaque signalement freine le testeur. Au doigt, le défilement natif reste en place.

## 2026-10-23 — La carte du passage actif reste vide quand rien n'est détecté
Étiquettes : utilisateur
PR : -

**Ce qui change.** Pendant la lecture, quand aucun verset n'est localisé à cet instant (silence, parole non coranique ou abstention), la carte « Passage actif » reste vide au lieu d'afficher « Aucun verset localisé à cet instant » ou l'explication d'une abstention à chaque trou. Sa hauteur est conservée pour que la page ne saute pas. L'explication d'une abstention reste affichée quand on la choisit dans la liste des intervalles.

**Pourquoi / décision.** Demande du propriétaire : un message répété à chaque pause est du bruit, puisqu'un verset va suivre. Une abstention choisie volontairement reste un diagnostic utile.

## 2026-10-23 — Dataset du lot 1 repassé en privé
Étiquettes : décision, technique
PR : -

**Ce qui change.** Le dataset Hugging Face qui héberge les 12 audios du lot 1 n'est plus public : il est repassé en privé à la demande du mainteneur (vérifié sans compte : l'API, la page et les fichiers répondent HTTP 401). La lecture sans jeton de la révision épinglée ne fonctionne donc plus ; un agent cloud qui a besoin du lot doit disposer d'un jeton de lecture.

**Pourquoi / décision.** Ces enregistrements sont des voix de tiers dont les droits ne sont pas établis (docs/data-lots/RIGHTS.md) : les rendre publics était une redistribution contraire à la mention « usage interne d'évaluation uniquement ». Les deux autres décisions de RIGHTS.md (retirer certains enregistrements du dataset, mention de droits) restent ouvertes.

## 2026-10-23 — Les temps au mot ne se chevauchent plus
Étiquettes : technique
PR : #78

**Ce qui change.** Une récitation très étirée (vitesse ×0,3) produisait un fichier de résultats que le lecteur refusait : deux moitiés de verset dont les fenêtres se recouvrent de 50 ms plaçaient un mot avant la fin du précédent. Le moteur ne publie plus jamais de temps au mot qui se chevauchent (le recouvrement est partagé au milieu ; au-delà de 0,1 s les temps ne sont pas publiés comme mesurés), et le lecteur normalise un léger chevauchement d'une ancienne sortie au lieu de rejeter tout le document. Les incohérences grossières restent refusées.

**Pourquoi / décision.** Un fichier que le moteur vient d'écrire ne doit jamais être illisible (l'atelier plantait sur la session). Cas réel : campagne de dégradation, Alafasy 67:26, mots 5 et 6, 50 ms. Tolérance réglable (`word_overlap_tolerance_s`, 0,1 s par défaut). ADR-0010, `docs/RECOGNIZE-OUTPUT.md`.

## 2026-10-23 — Une traduction qui suit les mots récités
Étiquettes : utilisateur, technique, décision
PR : #77

**Ce qui change.** Quand le récitant ne dit qu'une partie d'un verset, la traduction n'affiche plus le verset entier : elle commence là où la lecture commence et s'arrête où elle s'arrête (avec des « … » aux bords coupés). La sortie JSON gagne, dans `translation`, les `segments` du verset (chaque tranche de traduction avec la plage de mots arabes qu'elle traduit, pour le surlignage en direct), le `fragment` correspondant à la plage affichée et un `scope` (`fragment` ou `verse`). Sur 732 passages partiels de 53 sessions réelles, 75 % reçoivent un fragment (41 % exactement aux mots affichés), 25 % gardent la traduction du verset entier, étiquetée comme telle. Les anciennes sorties restent lisibles.

**Pourquoi / décision.** La traduction QuranEnc n'est jamais réécrite : elle est seulement découpée en tranches consécutives (6 236 versets sur 6 236 reconstitués à l'identique). Le découpage est calculé hors ligne par un algorithme déterministe (IBM-1 dans les deux sens, longueur, signes de pause), sans modèle génératif ; il ne garde une frontière que si elle est sûre à un mot près, et le repli est toujours le verset entier (ADR-0012). Mesure sur 169 frontières relues : 153 justes, 15 à un mot près, 1 fausse (une inversion d'ordre du français) ; 69,5 % des versets sont découpés. Voir `docs/evaluation/traduction-par-passage-2026-10-23.md`. Le fichier de frontières ne contient aucun texte (indices, offsets, empreintes) ; si la traduction change, le verset retombe sur la traduction entière.

## 2026-10-23 — Courbe de dégradation : jusqu'où le moteur tient
Étiquettes : technique, décision
PR : #76

**Ce qui change.** Une campagne mesure ce que devient le rappel du moteur quand l'enregistrement se dégrade : bruit blanc et rose, réverbération de salle, téléphone avec vrai codec, MP3, récitation ralentie, sur 9 sourates reconstituées dont le contenu est connu. Le script `scripts/measure_degradation.py` la rejoue (conditions, commandes ffmpeg et graines enregistrées) et le rapport `docs/evaluation/courbe-degradation-2026-10-23.md` donne les tableaux, les courbes et la décision.

**Pourquoi / décision.** Le fine-tuning avec dégradations ne se décide qu'avec des preuves. La règle (chute de plus de 15 points à un niveau réaliste, plancher de 95 % en propre) a été écrite avant la mesure : aucune des quatre familles du cahier n'échoue (chute de 0 à −4 points, 0 faux verset), donc **pas de fine-tuning justifié par elles**. La mesure est toutefois saturée (EveryAyah probablement vu à l'entraînement) : le moteur ne casse qu'au-delà du cahier (bruit plus fort que la voix, grande nef, récitation à ×0,4), et un jeu réel annoté reste la preuve qui manque. Trois leviers peu coûteux sont chiffrés avant tout fine-tuning ; un faux verset d'un mot (0,16 s) subsiste à ×0,5. Usage provisoire des audios EveryAyah (`docs/data-lots/ref-corpus-provenance.md`).

## 2026-10-23 — Détection en direct sans plage déclarée : conception et décisions produit
Étiquettes : technique, décision
PR : #74

**Ce qui change.** Rien ne change encore pour celui qui utilise le système : cette étape est une conception. Les décisions de Cherif sont consignées : usage **non commercial** avec publication en open source sous une licence non commerciale, **Hafs uniquement**, et pour objectif la **détection en direct sur un flux, sans plage déclarée** (l'analyse de fichiers reste le premier terrain). L'ADR-0011 (proposé) décrit comment : garder les candidats ouverts au début d'un verset, n'afficher que le passage entendu, nommer `sourate:verset` dès qu'un mot départage, attendre la suite du verset détecté et signaler un saut. Un script mesure le corpus : `scripts/analyze_verse_prefixes.py`.

**Pourquoi / décision.** Chiffres du script (corpus Hafs, mots exacts, donc une borne basse) : 2 mots en médiane pour distinguer un début de verset (74 % des versets en 3 mots), mais 26 % en exigent plus de 3 et 289 versets (4,6 %) n'ont aucun début propre ; avec la sourate pour contexte, 83 % se tranchent en 2 mots. Les écarts à traiter avant de publier (licence, attributions, données de tiers) sont dans `.artist/decision-log.md`. Voir `docs/adr/0011-detection-en-direct-sans-plage.md`.

## 2026-10-22 — La traduction suit le passage entendu et se surligne en direct
Étiquettes : utilisateur, technique
PR : #73

**Ce qui change.** La carte « Passage actif » ne montre plus que la traduction de ce qui est affiché en arabe : quand le moteur a découpé la traduction, tu lis « Traduction du passage (mots 15–23) », avec « … » aux bords si le passage commence ou finit au milieu du verset. Quand le récitant s'arrête, revient en arrière ou répète, la traduction repart exactement là où la reprise démarre. Pendant la lecture, le mot arabe récité et le fragment de traduction qui lui correspond sont surlignés en même temps (fond teinté et trait, pas seulement la couleur) ; à l'arrêt, un clic sur un mot arabe place le lecteur à son début. Un interrupteur « Surligner en direct » (carte du passage et page Compte, activé par défaut, enregistré avec ton compte) coupe le surlignage.

**Pourquoi / décision.** Pour un verset partiel, l'arabe montrait les mots entendus mais la traduction était celle du verset entier, qui ne commençait pas au début de la lecture. L'atelier ne devine rien : sans temps de mots dans le résultat, ou si le texte ne s'aligne pas sur la plage de mots, il ne surligne aucun mot et marque seulement le passage entier ; sans découpage de la traduction, il garde « Traduction du verset entier ». Le texte arabe (corpus) et la traduction (QuranEnc) ne sont jamais modifiés. Les champs lus (`word_times`, `translation.segments`, `translation.fragment`) sont ceux du contrat de sortie ; un ancien résultat s'affiche comme avant.

## 2026-10-22 — Début de verset retrouvé, et temps de chaque mot
Étiquettes : utilisateur, technique, décision
PR : #75

**Ce qui change.** Un début de verset ambigu (le début de 11:61 ressemble à celui de 7:73) n'est plus laissé « incertain » quand le verset reconnu qui le suit le continue et que l'audio soutient son texte : sur la session Hud, l'intervalle 21,5-35,7 s passe en reconnu. De même, quand le récitant commence un verset, fait une pause puis continue, le début d'avant la pause est retrouvé si l'audio et la transcription le confirment ; sinon l'abstention reste (le moteur reste Hafs : un début qui ne correspond pas au texte Hafs n'est jamais forcé). La sortie JSON donne en plus, pour chaque verset reconnu, le temps de chaque mot (`word_times`) et d'où il vient (`word_times_source` : `ctc-alignment` mesuré, `interpolated` estimé) ; l'interface s'en sert pour surligner le mot récité. Champs additifs : `aqr.recognition/1` reste lisible.

**Pourquoi / décision.** Précision d'abord : rien n'est promu sans que l'audio soutienne le texte du corpus (même seuil que les suites). Le « début tardif » signalé à 55,1 s n'était pas un bord de fenêtre : la voix commence à 55,06 s, ce qui précède est une inspiration. ADR-0010, `docs/RECOGNIZE-OUTPUT.md`.

## 2026-10-22 — Comptes, audios globaux ou privés, plusieurs testeurs
Étiquettes : utilisateur, technique, décision
PR : #70, #72

**Ce qui change.** L'atelier s'ouvre à plusieurs testeurs. Tu crées un compte (pseudonyme et mot de passe, pas d'e-mail ; le premier inscrit est administrateur) puis tu te connectes. Tes audios sont **globaux** par défaut : tous les testeurs les écoutent et voient leurs résultats et leurs performances. Tu peux en marquer certains **privés** à l'import ou plus tard (le cadenas le montre) : personne d'autre ne les voit, administrateur compris. Un signalement porte désormais ton compte (plus de champ « Qui teste ? »), et tu ne modifies pas celui d'un autre testeur. La vérité terrain est réservée aux administrateurs. Un quota de 5 Gio par compte (modifiable) prévient à 80 % et bloque l'import à 100 %.

**Pourquoi / décision.** Le socle serveur (base SQLite, connexion, droits, quota) vient de la PR #70 ; cette PR apporte les écrans (connexion, inscription, menu du compte, portée à l'import et sur la session). Choix du mainteneur : inscription ouverte (interrupteur serveur `AQR_SIGNUP`), l'administrateur ne lit pas le contenu privé d'un autre testeur, plafond de 500 Mo par audio (la vidéo garde 2 Gio). Le mode test distant par jeton (`/access`) reste en place comme couche réseau.

## 2026-10-22 — La liste des sessions passe à l'échelle
Étiquettes : utilisateur, technique
PR : #72

**Ce qui change.** La barre de gauche ne liste plus tout : la file d'analyse, tes favoris épinglés, les huit sessions les plus récentes et un bouton « Voir toutes les sessions ». La liste complète vit sur la page **Sessions** : recherche (sans accents), portée (toutes, mes sessions, partagées, favoris, archivées), filtres d'état, de moteur et de date, tri, groupes par date, « Charger plus » par lots de 20, sélection multiple et actions groupées. L'état des filtres est dans l'adresse de la page.

**Pourquoi / décision.** Avec des centaines de sessions, charger toute la liste n'est plus tenable. Le serveur filtre et pagine par curseur ; le navigateur ne relit que ce qui est affiché.

## 2026-10-22 — Documentation et notes de version dans l'atelier
Étiquettes : utilisateur, technique
PR : #72

**Ce qui change.** Un onglet **Documentation** affiche les documents du projet (navigation par document, sommaire « Sur cette page », tableaux et schémas défilables, bouton Copier sur les blocs de code). Les **notes de version** y forment une chronologie filtrable par type (utilisateur, technique, décision), avec un lien vers chaque demande de fusion.

**Pourquoi / décision.** Le rendu Markdown n'interprète jamais de HTML brut, n'affiche aucune image distante et ne crée un lien que vers un document de l'index, une ancre ou une adresse `http(s)` ; seuls les documents de `docs/docs-index.json` sont lisibles. Le dépôt des liens se règle par `AQR_REPO_URL`.

## 2026-10-22 — Favoris, archivage et renommage des sessions
Étiquettes : utilisateur
PR : #72

**Ce qui change.** Une étoile met une session en favori (elle s'épingle dans la barre de gauche) ; « Archiver » la retire des listes sans la supprimer, avec « Annuler » ; la page Sessions propose une portée « Archivées » où l'on peut restaurer ou supprimer définitivement. Le titre d'une session se renomme au double-clic ou au crayon (Entrée valide, Échap annule). Une ligne « Contenu détecté : Yusuf 12:11–31 » est calculée par le système à partir des versets reconnus.

**Pourquoi / décision.** Les favoris et l'archivage sont propres à chaque testeur : archiver une session globale ne la retire qu'à toi. Seul le propriétaire renomme, change la portée ou supprime. Une session archivée compte toujours dans le quota : seule la suppression libère de l'espace.

## 2026-10-22 — Tes préférences te suivent d'un appareil à l'autre
Étiquettes : utilisateur, technique
PR : #72

**Ce qui change.** Le thème, la police et la taille du texte arabe, la traduction, la fenêtre visible de l'onde, le suivi de la lecture, la vitesse, le volume, les panneaux ouverts ou fermés, ton filtre de sessions et la portée de tes nouveaux essais sont enregistrés sur ton compte, et appliqués dès l'affichage de la page, même après une déconnexion ou sur un autre appareil. Tout se règle dans « Compte → Préférences » ; ouvrir ou fermer un panneau, changer la vitesse ou le volume met aussi la préférence à jour. Les boutons « −5 s » et « +5 s » du lecteur deviennent des icônes (flèches ← et → au clavier).

**Pourquoi / décision.** Le serveur pose le thème sur la page avant le premier rendu (aucun clignotement). Si l'enregistrement échoue, l'atelier continue avec ce qui est gardé sur l'appareil, le dit, et réessaie.

## 2026-10-22 — Documentation vivante et notes de version
Étiquettes : technique, décision
PR : #69

**Ce qui change.** La documentation du projet devient une documentation vivante : une page « Le système en bref »
(`docs/SYSTEME-EN-BREF.md`), l'architecture de l'atelier web (`docs/ARCHITECTURE-ATELIER.md`), ces notes de
version, et un index des documents (`docs/docs-index.json`) destiné à l'onglet « Documentation » de l'atelier.
Un script contrôle l'index (fichiers existants, identifiants uniques, aucun texte coranique long ni identifiant
de personne) et un autre crée le squelette d'une nouvelle entrée de ces notes.

**Pourquoi / décision.** Une documentation qui n'est pas mise à jour avec le code devient fausse. Désormais, toute PR
qui change le comportement visible, l'architecture ou une décision ajoute une entrée ici et met à jour le
document concerné (règle dans `AGENTS.md`, case dans `docs/templates/pull-request.md`, rappel non bloquant au
`git push`).

## 2026-10-22 — Deux correctifs de sécurité de l'atelier
Étiquettes : technique
PR : #67, #68

**Ce qui change.** L'atelier contrôle désormais l'en-tête `Host` (et `X-Forwarded-Host`) de chaque requête : un nom
d'hôte étranger, même s'il résout vers la boucle locale, reçoit un refus `403`. Next.js passe de 16.4.0 à 16.4.2,
car la version précédente était signalée vulnérable et faisait échouer `npm run build`.

**Pourquoi / décision.** Avant le correctif, une page tierce dont le nom de domaine pointait vers `127.0.0.1` (attaque
« DNS rebinding ») pouvait **lire** les sessions, l'audio et les résultats de l'atelier : constaté sur le vrai
serveur (`GET /api/sessions` avec `Host: evil.example` répondait 200). Les écritures étaient déjà protégées par
le contrôle de l'origine. Voir `docs/ARCHITECTURE-ATELIER.md`, §9.

## 2026-10-22 — Nouvel atelier « Encre & lapis », revue humaine et performance
Étiquettes : utilisateur, technique, décision
PR : #62, #63, #66

**Ce qui change.** Refonte complète de l'interface de l'atelier. Thème clair et sombre sans flash, panneaux
repliables (tiroirs sous 1 280 px), mise en page mobile avec lecteur ancré en bas. Nouveau **panneau de revue
humaine** : on marque le début et la fin d'un passage (ou on le trace sur l'onde), on choisit parmi 23 puces
en 7 familles, on donne son pseudonyme, et plusieurs testeurs peuvent revoir la même session sans s'écraser
(modèle `aqr.review/2`, lecture toujours compatible avec la v1). Nouvel onglet **Performance** (durée moyenne,
vitesse par moteur, file en cours). Sélecteur de police arabe avec aperçu ; la police KFGQPC Hafs V30, sous
licence réservée, est servie depuis un dossier local et n'entre jamais dans Git.

**Pourquoi / décision.** La direction artistique (#62) et la spécification de la revue (#63) sont dans `docs/design/`.
Limites déclarées dans la PR : pas de passe de QA indépendante avant la fusion (arrêtée sur décision du
mainteneur), traductions françaises des formules (isti'adha, takbir, âmîn) à valider par Cherif, lecteurs
d'écran non testés. Voir
`docs/ARCHITECTURE-ATELIER.md`, §7 et §10.

## 2026-10-22 — File d'attente des analyses, vidéos, « non lu » et durées estimées
Étiquettes : utilisateur, technique
PR : #64

**Ce qui change.** On peut déposer plusieurs audios **et vidéos** d'un coup : les analyses se mettent en file et
s'exécutent une par une, même si l'on ferme la page. Chaque session affiche son état (en attente avec son rang,
en cours, terminée, en échec, annulée), un point « non lu » tant que le résultat n'a pas été ouvert, et une
durée estimée. Une vidéo sans piste son ou un fichier illisible est refusé dès l'import. Après un redémarrage
du serveur, la file reprend dans le même ordre.

**Pourquoi / décision.** La carte graphique supporte mal deux analyses en parallèle. L'estimation est calculée sur
l'historique réel (erreur relative médiane de 11 % sur 33 analyses FastConformer) et reste « indisponible »
plutôt que de montrer un chiffre inventé. Voir `docs/ARCHITECTURE-ATELIER.md`, §5.

## 2026-10-22 — La basmala est affichée comme un verset
Étiquettes : utilisateur, technique
PR : #65

**Ce qui change.** Quand le moteur détecte la basmala, la sortie porte maintenant son texte arabe (celui du verset
1:1 du corpus) et sa traduction QuranEnc, et l'atelier l'affiche comme un verset, avec un badge « Basmala ».
Isti'adha, takbir et âmîn restent de simples libellés, sans texte du Mushaf.

**Pourquoi / décision.** Respect des invariants I1 (texte du corpus) et I2 (traduction officielle). Le contrat de
sortie reste `aqr.recognition/1` (champs ajoutés seulement). Une zone « basmala » n'est **pas** un verset
reconnu : seuls les intervalles de nature « verset » comptent. Voir `docs/RECOGNIZE-OUTPUT.md`.

## 2026-10-20 — La cascade de modèles devient le comportement par défaut
Étiquettes : utilisateur, technique, décision
PR : #61

**Ce qui change.** FastConformer transcrit tout le fichier ; Whisper puis Muno réécoutent **seulement les fenêtres
douteuses**. Un verset proposé par un moteur secondaire n'est gardé que si l'audio soutient le texte du corpus
(arbitre acoustique). Le choix du moteur disparaît de l'atelier ; `--asr` reste en ligne de commande pour
mesurer un moteur seul. Un bug du moteur Muno (dernier morceau trop court) est corrigé.

**Pourquoi / décision.** ADR-0009. Mesure (split dev) : aucun verset perdu, aucun verset ajouté sur les fichiers sans
Coran récité, EveryAyah 211 → 216/216 versets, +10 versets distincts sur le lot 1 et +5 sur le lot 2. Coût : le
temps de traitement est multiplié par 2,85 sur ces lots (821 s → 2 337 s). Source :
`docs/evaluation/cascade-2026-10-20.md`.

## 2026-10-20 — Écoute exacte : l'audio joué est celui du moteur
Étiquettes : utilisateur, technique
PR : #60

**Ce qui change.** Cliquer sur un verset amène désormais exactement aux bons mots. Le lecteur joue une copie d'écoute
(WAV mono 16 kHz, même décodage que le moteur), la forme d'onde est calculée par le serveur, et l'onde et les
pistes partagent un seul repère de temps.

**Pourquoi / décision.** Mesuré sur un MP3 de 45 min : le navigateur se positionnait à +7,9 s ou −10,3 s de l'instant
demandé ; après correction l'écart est inférieur à 0,05 s. Voir `docs/ARCHITECTURE-ATELIER.md`, §6.

## 2026-10-20 — La riwaya est déclarée « supposée Hafs »
Étiquettes : utilisateur, décision
PR : #58

**Ce qui change.** La sortie du moteur déclare que la riwaya est supposée Hafs et non vérifiée, et l'atelier affiche
un avertissement.

**Pourquoi / décision.** Une récitation en Warsh (lot 2) était reconnue comme du Hafs sans aucun avertissement. Deux
signaux de détection ont été testés (preuve acoustique globale, ibdâl de la hamza muette) et tous deux sont
négatifs : faute de détection fiable, Cherif a retenu l'avertissement tout de suite (I6). Source :
`docs/evaluation/riwaya-2026-10-20.md`.

## 2026-10-20 — Vérification acoustique des suites et temps au mot
Étiquettes : technique, décision
PR : #50, #54, #55, #59

**Ce qui change.** Le moteur vérifie sur le son une suite de versets avant de la nommer : il réaligne le **texte du
corpus** sur l'audio et refuse la suite si l'audio ne la soutient pas. Les temps de début et de fin sont mesurés
au mot près au lieu d'être ceux des fenêtres de découpe. Un verset commencé est prédit jusqu'au bout (la suite
est attendue dans la fenêtre suivante, puis vérifiée). Deux corrections : des versets au texte identique ne
sont plus coupés à tort de la liste des candidats (#55), et l'aligneur n'exige plus un symbole que le modèle
n'émet jamais (#59).

**Pourquoi / décision.** ADR-0008. Mesures : voix de Cherif au micro avec le moteur Muno 1/3 → 3/3 enregistrements
reconnus ; EveryAyah 91,2 % → 96,8 % sans faux verset ; cas « verset commencé, suite non détectée » sur le
lot 1 : 81 → 43. Sources : `docs/evaluation/acoustic-check-2026-10-20.md`, `nuit-2026-10-20.md`.

## 2026-10-20 — Mesures de bout en bout et deuxième lot d'audios
Étiquettes : technique
PR : #49, #52, #56, #57

**Ce qui change.** Mesures de bout en bout avec le code à jour (lot 1, EveryAyah, micro) et un **lot 2** de voix
sénégalaises (12 fichiers, 4,96 h : récitants locaux, tafsir en wolof) avec leurs premiers essais. Versets
reconnus sur le lot 1 : 618 (7 octobre) → 740 ; EveryAyah : 97,7 % (211/216), 0 faux verset.

**Pourquoi / décision.** Ces chiffres sont **descriptifs** : aucune vérité terrain humaine n'existe encore sur ces
audios, donc « plus de versets » ne veut pas dire « plus de versets justes ». Le rapport du lot 2 a déclenché
les corrections de #54 et #55. Sources : `docs/evaluation/nuit-2026-10-20.md`, `lot2-premiers-essais.md`.

## 2026-10-19 — Preuve cumulée par la suite : les versets courts se confirment entre eux
Étiquettes : utilisateur, technique, décision
PR : #47

**Ce qui change.** Un verset d'un ou deux mots, bien entendu mais trop court pour être nommé seul, est maintenant
reconnu quand il s'enchaîne dans le Mushaf avec ses voisins (par exemple 55:1 à 55:4). Un fragment isolé reste
écarté.

**Pourquoi / décision.** ADR-0007. La voix de Cherif au micro (basmala puis 55:1-4) ne produisait aucun verset ; elle
est reconnue avec FastConformer et Whisper. EveryAyah : 71,8 % → 91,2 % de versets reconnus, sans faux verset.
Source : `docs/evaluation/chain-proof-2026-10-19.md`.

## 2026-10-19 — Alignement forcé et atelier de vérité terrain
Étiquettes : utilisateur, technique, décision
PR : #44, #45

**Ce qui change.** On peut déclarer quels versets sont récités dans un passage, et le moteur pose le temps de chaque
verset et de chaque mot en alignant le texte du corpus sur le son (`aqr align`). L'atelier gagne un onglet
« Vérité terrain » (réservé au relecteur) : proposer des passages, corriger, aligner, **écouter chaque verset**,
valider, puis écrire dans le manifeste de test.

**Pourquoi / décision.** ADR-0006, étape A du plan : aucune vérité terrain humaine n'existait sur de l'audio réel (le
rapport du 9 octobre mesurait 52,6 % de versets retrouvés). L'outil est prêt ; il reste à Cherif à valider
2 à 3 heures d'audio. Source : `docs/ALIGN-OUTPUT.md`, `docs/evaluation/alignment-2026-10-19.md`.

## 2026-10-19 — Données du futur fine-tuning préparées (aucun entraînement)
Étiquettes : technique
PR : #46, #48, #51, #53

**Ce qui change.** Sources épinglées, manifestes au format NeMo, contrôle des étiquettes par le modèle de base et
cible d'entraînement dans la graphie du modèle. **Aucun entraînement n'a été lancé** : c'est la préparation de
l'étape C.

**Pourquoi / décision.** EveryAyah est exclu de l'entraînement (décision d'usage provisoire des audios). Source :
`docs/evaluation/finetune-data.md`, `docs/PLAN.md`.

## 2026-10-13 — Moteur Muno et choix du moteur dans l'atelier
Étiquettes : utilisateur, technique
PR : #42, #43

**Ce qui change.** Troisième moteur de reconnaissance, Muno FastConformer en streaming (ONNX quantisé), sélectionnable
en ligne de commande et dans l'atelier ; poids vérifiés par empreinte, hors Git.

**Pourquoi / décision.** Comparer les moteurs sur les mêmes audios. Ce choix manuel sera remplacé par la cascade
(20 octobre, ADR-0009).

## 2026-10-09 — Rapport d'évaluation réelle et protocole de mesure
Étiquettes : technique, décision
PR : #36, #38, #39, #40, #41

**Ce qui change.** Mesures WER/CER et d'identification, tests de bout en bout (ligne de commande et navigateur) sur
un audio court, constructeur du corpus de référence (mixages et dégradations), lot d'évaluation vérifiable par
un fichier `run.json`, protocole séparant réglage (dev) et mesure finale (test).

**Pourquoi / décision.** Premier rapport réel : sur le split dev (82 cas, 232 versets de référence), FastConformer
reconnaît 122 versets (52,6 %), Whisper 117 (50,4 %), **aucun faux verset** ni pour l'un ni pour l'autre. Ce
constat (la décision est le goulot, pas le modèle) a fondé la direction A → B → C → D du 19 octobre. Source :
`docs/evaluation/rapport-reel-2026-10-09.md`.

## 2026-10-09 — Mode test distant protégé pour l'atelier
Étiquettes : technique, décision
PR : #37

**Ce qui change.** Option pour tester l'atelier depuis une autre machine : hôtes supplémentaires acceptés seulement
avec un jeton d'accès, cookie signé à durée limitée, identifiants de session stricts, plafond d'envoi, purge
facultative des sessions inactives (une revue récente garde la session).

**Pourquoi / décision.** Le comportement par défaut ne change pas : boucle locale uniquement. Refus par défaut
(« fail-closed »). Voir `docs/ARCHITECTURE-ATELIER.md`, §9.

## 2026-10-08 — Enregistrement au micro et FastConformer par défaut
Étiquettes : utilisateur
PR : #33, #34, #35

**Ce qui change.** On peut déposer un audio par glisser-déposer, ou enregistrer une récitation directement dans
l'atelier (autorisation du micro, durée, arrêt, réécoute, reprise) puis l'analyser. FastConformer devient le
moteur par défaut de l'atelier.

**Pourquoi / décision.** Aucune voix n'est versionnée ni envoyée vers le cloud. Le choix du moteur par défaut était
provisoire jusqu'au benchmark de la phase 6 (`docs/PLAN.md`).

## 2026-10-07 — Première inférence de bout en bout et premier atelier de revue
Étiquettes : utilisateur, technique
PR : #27, #30, #31, #32

**Ce qui change.** `aqr recognize` traite un fichier réel de bout en bout et produit un JSON (puis SRT et VTT). Le
premier atelier web local permet d'importer un audio, de le voir sur une onde, d'écouter et de signaler des
erreurs, avec export d'un pack ZIP. Une preuve acoustique sur le treillis du modèle est ajoutée au décodage
(ADR-0005 : algorithme seul, non validé sur audio réel à cette date). Une comparaison Whisper / FastConformer
par accord entre moteurs est consignée (ce n'est pas une mesure d'exactitude).

**Pourquoi / décision.** Choix de Next.js et TypeScript pour l'atelier, en appelant la ligne de commande Python
existante plutôt qu'un second serveur (demande du 7 octobre, `docs/PLAN.md` phase 8).

## 2026-10-05 — Modèles épinglés, adapters audio et outillage de données
Étiquettes : technique
PR : #10, #11, #12, #13, #15, #16, #18, #19, #20, #21, #22, #23, #24

**Ce qui change.** Extraction audio (ffmpeg), découpe en segments de récitation, trois moteurs de reconnaissance
derrière des interfaces testées, modèles téléchargés et vérifiés par empreinte (`models/LOCK.json`). Outillage de
données : import, étiquettes Audacity, découpe dev/test, mixages synthétiques à vérité exacte, EveryAyah. Le lot 1
(12 fichiers, 8,69 h) est ingéré et découpé dev/test sans recouvrement de récitant.

**Pourquoi / décision.** Garde-fous : hooks Git qui refusent toute signature d'IA et tout fichier audio ou modèle dans
l'historique (dépôt public).

## 2026-09-25 — Cœur du moteur : corpus, recherche, décodage et rendu
Étiquettes : technique, décision
PR : #1, #2, #3, #4, #5, #6, #9

**Ce qui change.** Corpus Tanzil (Hafs) vérifié par empreinte, recherche de versets tolérante aux erreurs de
transcription (puis sur le flux continu des mots, spans multi-versets), décodage de séquence, rendu du texte et
de la traduction officielle. La recherche sur le flux continu (ADR-0004) est livrée le 2 octobre (#9).

**Pourquoi / décision.** ADR-0001 : pas de LLM génératif ; ADR-0003 : recherche lexicale contrainte, ni base
vectorielle ni LangChain. Bancs de la phase 2b : aucun faux verset nommé sur toutes les fenêtres testées
(`docs/PLAN.md`).
