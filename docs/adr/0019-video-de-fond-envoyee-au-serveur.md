# ADR-0019 — La vidéo de fond choisie est envoyée au serveur, préparée une fois, et lue par le rendu

- Statut : **accepté** — phase 2b de la refonte de l'export vidéo en éditeur interactif (brief commun du chantier,
  2026-11-03). Lève la limite laissée par l'[ADR-0018](0018-mise-en-page-par-blocs.md) : « le fichier d'une vidéo de fond
  n'est pas envoyé au serveur ».

## Contexte

L'export lancé depuis l'atelier est rendu **sur le serveur**, par un navigateur sans interface qui lit le JSON de l'API. Une
vidéo choisie par l'utilisateur reste sur son appareil : elle n'atteignait jamais le rendu. Il faut la transporter (fichiers de
plusieurs centaines de Mo, téléphone en 4G), la contrôler (elle vient d'une personne), la rattacher à son propriétaire, la
nettoyer, et la faire lire au rendu, **muette** (seul le son de la récitation est exporté).

## Décision

1. **Transport : le même mécanisme par morceaux que l'import de sessions**, factorisé. `web/lib/chunk-staging.ts` porte le
   plan des morceaux, l'écriture atomique d'un morceau (nom choisi par le serveur), la liste des morceaux reçus et leur
   relecture ; `chunked-upload.ts` (sessions) et `background-video-store.ts` (vidéo de fond) s'y appuient. Côté navigateur,
   `chunkSender` (`chunked-upload-client.ts`) renvoie un morceau perdu seul, jusqu'à six fois, et assemble. Les routes de
   l'import (`/api/uploads`) ne conviennent pas : elles créent une **session** à la fin et ne sont pas ouvertes aux jetons d'API.
   La vidéo de fond a ses routes sous la session : `/api/sessions/<id>/background-videos[/<vid>[/chunks/<n>|/complete|/file]]`.
2. **Propriété par compte ET par session.** Une vidéo est à un compte et à une session ; tout autre accès (autre compte, autre
   session, même un administrateur, même avec le bon identifiant) répond **404**, jamais 403. Les identifiants sont 32
   caractères hexadécimaux validés avant tout accès disque ; aucun nom de fichier ne vient du client (`original<ext>`,
   `video.mp4`).
3. **Contrôle du contenu réel.** Signature des premiers octets (`sniffMedia` : conteneur MP4/MOV, Matroska/WebM ou AVI, pas un
   MP3 ni une page web nommés `.mp4`), puis ffprobe avec le **démultiplexeur imposé** (`-f mov|matroska|avi`, un fichier de
   liste de lecture déguisé n'est pas suivi) et `-protocol_whitelist file`. Refus : sans image (une pochette n'est pas une image),
   illisible, durée au-dessus du plafond, côté d'image au-dessus de 7 680 px (bombe de décompression), empreinte annoncée fausse.
4. **Plafonds dits avant le choix** : 500 Mo, 10 min, trois vidéos par compte, réglables (`AQR_MAX_BACKGROUND_VIDEO_BYTES`,
   `…_SECONDS`, `AQR_MAX_BACKGROUND_VIDEOS`) ; lus sur le serveur par `GET …/background-videos` et jamais écrits en dur côté
   écran. Place disque : refus avant d'écrire quand l'original ET sa copie ne tiendraient pas (réserve existante). Les vidéos de
   fond **ne comptent pas** dans le quota de stockage de l'utilisateur (elles sont temporaires et plafonnées à part).
5. **Préparation sur le serveur, une fois, une à la fois.** ffmpeg produit une copie **sans son**, H.264, 1080p au plus, image
   clé toutes les 8 images, débit plafonné à 8 Mbit/s (même réglage que la copie de la vidéo d'origine, qui a mesuré 17 fois
   moins de temps de positionnement image par image). La préparation n'est pas dans la requête (un proxy coupe à 60 s) : `complete`
   répond **202**, l'état se lit sur `GET` (`processing` avec un pourcentage, `ready`, `failed` avec la raison en clair).
   File d'attente propre, séparée de celle des analyses (une vidéo de fond ne doit pas attendre une analyse de plusieurs
   heures). Après un redémarrage, une vidéo « en préparation » repart seule à la prochaine lecture de son état.
6. **Le rendu lit la vidéo par le job, pas par le compte.** Au lancement d'un export (`background.video.upload_id`), la route
   contrôle compte, session et état, puis **lie** (lien dur, sinon copie) la copie dans le dossier du job. Le navigateur de rendu
   la lit par `…/jobs/<job>/background-video` (propriétaire du job seulement, intervalles d'octets). Retirer la vidéo ou la
   voir expirer pendant un export ne l'interrompt donc pas. Le rendu l'utilise avec `videoSeeker` et `backgroundVideoTimeAt`
   de la phase 1 ; l'identité de la vidéo (empreinte de l'original) nomme le fichier : un même fond redonne la même clé de
   réutilisation.
7. **API rétro-compatible.** `background` accepte toujours un identifiant en texte ; il accepte aussi
   `{ video: { upload_id, offset?, mode? } }` (`offset` en secondes, un seul pour toutes les plages ; `mode` : `loop`,
   `pingpong`, `freeze`, `slow`). Image et vidéo ensemble : 400. `exportVideoRequest(…, extras)` écrit l'objet quand la vidéo
   est prête ; `apiDifferences` ne signale plus rien dans ce cas et dit « pas encore envoyée » sinon. Le catalogue
   (`GET /api/v1/export/options`) et l'outil MCP `export_video` décrivent les deux formes.
8. **Nettoyage.** Abandon (`DELETE`), annulation côté écran, expiration (envoi 24 h, **vidéo prête 3 jours sans usage**, chaque
   usage repousse l'échéance, échec 1 h, dossier sans méta 24 h), suppression de la session (crochet `sessionHooks.removed`,
   donc aussi la purge automatique) et du compte (route d'administration). Passage au démarrage puis toutes les heures.
9. **Reprise et progression côté écran.** Une coupure garde l'envoi sur le serveur : l'erreur porte un `resumeId`, et « Reprendre
   l'envoi » ne renvoie que les morceaux manquants (mesuré : 54 morceaux distincts, aucun doublon). Annuler supprime ce qui a
   été reçu. Un navigateur qui ne lit pas la vidéo (HEVC d'un téléphone sur Chrome, MKV, AVI) n'est pas un refus : le serveur la
   lit, et l'aperçu lit la copie préparée.

## Alternatives écartées

- **Envoyer la vidéo avec la demande d'export** (multipart, comme l'image de fond) : le formulaire est lu en mémoire, un
  fichier de 200 Mo y est impossible ; et la vidéo ne servirait qu'à un seul export.
- **Faire lire le fichier par le navigateur de l'utilisateur** (rendu local) : abandonné par le chantier — l'export doit
  continuer sur le serveur page fermée.
- **Servir l'original sans préparation** : le HEVC des téléphones n'est pas lu par le Chrome du serveur, le son serait
  à retirer au mux, et le positionnement image par image d'un fichier à images clés rares est des dizaines de fois trop lent.
- **Lier la vidéo à la session sur le disque** (`sessions/<id>/…`) : aurait donné la suppression gratuite, mais déposerait
  jusqu'à 500 Mo dans la session d'un autre compte (un lecteur d'une session globale peut exporter) et hors de son quota.

## Conséquences

- Un export avec une vidéo de fond de 5 min en 1080p demande une préparation d'environ 2 à 3 minutes sur ce poste de
  développement (mesures dans `.artist/decision-log.md`) : la barre le dit, l'écran n'est pas bloqué.
- La copie préparée peut être plus lourde que l'original (le débit est plafonné, pas minimisé) : sur la vidéo bruitée de test,
  287 Mo pour 224 Mo. Plafonnée à environ 600 Mo pour 10 min.
- **Reste à faire** : brancher `BackgroundVideoSection` dans l'éditeur (phases 2 et suivantes) ; passer `backgroundVideoRequest`
  à `exportVideoRequest` et appeler `ensureClipOnServer` juste avant un export ; une vidéo « fournie » par le produit (aucune
  n'existe aujourd'hui).
