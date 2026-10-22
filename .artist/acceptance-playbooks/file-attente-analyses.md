# File d'attente des analyses (audios et vidéos), « non lu », durées et estimation

Socle serveur (contrat d'API : `web/README.md`, « File d'attente, vidéos, « non lu » et durées »). L'interface
(liste, indicateurs, import multiple) s'appuie sur ce contrat ; ses scénarios d'écran sont à la fin.

## Must-pass (serveur)

- **FIFO, une à la fois** : trois imports `autorun` presque simultanés → une session `running`, deux `queued` avec
  `queue_position` 1 et 2 ; chacune ne démarre qu'à la fin de la précédente, dans l'ordre d'arrivée (`queued_at`).
- Un import vidéo (MP4, MKV, MOV, AVI, M4V, WebM) est accepté en flux (`x-aqr-filename`), l'audio est extrait par ffmpeg,
  l'analyse aboutit ; `audio_duration_s` est celui de la **piste audio** (sonde), puis celui du moteur à la fin.
- Une vidéo **sans piste audio** est refusée (`422`, « aucune piste audio ») et rien n'est conservé sur le disque.
- Fin d'analyse : `state: done`, `duration_s` réelle (fin − départ), `audio_duration_s`, `engine`, `viewed_at: null`,
  `unread: true` ; un échec est aussi `unread: true`.
- **Non lu** : plusieurs `GET /api/sessions` ne changent pas `unread` ; `POST /api/sessions/<id>/viewed` le passe à
  `false` (date de la première ouverture, conservée aux appels suivants) ; les sessions d'avant le suivi (pas de champ
  `viewed_at`) ne sont pas non lues.
- **Estimation** : avec ≥ 3 analyses terminées du même moteur, `eta_s` est décroissant à mesure que le temps passe,
  jamais négatif ; pour la file, somme de ce qui précède + sa propre durée ; sans historique suffisant `eta_s` vaut `null`
  avec une `eta_reason` (jamais un chiffre inventé).
- **Annulation** d'une analyse en attente : elle quitte la file et ne démarre jamais ; la suivante garde son rang.
  Annulation de l'analyse en cours : la suivante démarre. **Suppression** d'une session en attente : retirée de la file.
- **Redémarrage** du serveur avec des sessions `queued` : elles reprennent seules (sans requête), dans l'ordre de
  `queued_at` ; la session qui tournait au moment de l'arrêt passe `failed` (« Le traitement s'est arrêté… »).
- `GET /api/stats` : par moteur, nombre d'analyses, RTF médian / p90 / moyen, durée totale ; file courante ; dernières
  analyses. La dispersion du RTF (min/max) est visible.
- `AQR_MAX_CONCURRENT=2` : deux analyses en parallèle, la troisième attend.

## Must-fail (serveur)

- Deux lancements simultanés de la même session : un seul passe, l'autre est refusé (« déjà en cours ou en file »).
- Relancer une session déjà en file, en cours ou terminée est refusé.
- Un import au-delà du plafond (`AQR_MAX_UPLOAD_BYTES` audio, `AQR_MAX_VIDEO_UPLOAD_BYTES` vidéo) : `413`, aucun
  dossier ni fichier laissé ; un `Content-Length` trop grand est refusé avant toute écriture.
- Extension non reconnue (`.txt`, `.mp3.exe`), nom absent ou mal encodé, fichier vide, flux coupé : refus propre, rien conservé.
- `POST …/viewed` sans accès local (origine étrangère, hôte inconnu) : `403` ; identifiant invalide ou session inconnue : `404`.
- `viewed` sur une session non terminée ne la marque pas (`viewed_at` reste `null`).
- Une analyse dont l'audio a disparu finit `failed` avec un message ; elle ne bloque pas la file.
- Aucune session en attente n'est purgée par `AQR_SESSION_TTL_S`.
- Aucun rejet non géré : suppression d'une session en attente, annulation pendant le lancement, interpréteur absent.

## Scénarios d'écran (à jouer quand l'interface sera refaite sur ce contrat)

- À 375 px : importer 3 fichiers (2 audios + 1 vidéo) en une seule sélection ; chacun apparaît avec son état
  (en attente n° 1, 2…) sans scroll horizontal ; le point « non lu » apparaît à la fin de chacun et disparaît à
  l'ouverture du résultat, pas avant ; recharger la page garde l'état.
- L'estimation affichée est « indisponible » (et non `0 s`) quand `eta_s` est `null`.

## Vérification du 22 octobre 2026

- Moteur réel (FastConformer) sur 3 extraits Alafasy (2 MP3 + 1 MP4) importés en même temps, serveur `next start` sur
  127.0.0.1:3201, historique réel copié (46 sessions, sans audio) : ordre `running → done` strictement séquentiel,
  `queued#1`, `queued#2` décroissants, `NONLU` après chaque fin, `eta_s` décroissant (49 → 0 s pour la première).
- `viewed` : 3 `GET` n'ont pas marqué ; le `POST` a posé `viewed_at`, le second l'a conservé ; `403` origine étrangère ;
  `404` identifiant inconnu et invalide ; `422` vidéo muette ; `400` extension `.txt`.
- Redémarrage forcé pendant une analyse : au redémarrage, sans aucune requête, la session interrompue est `failed`,
  la suivante `running`, la dernière `queued` dans l'ordre.
- Annulation et suppression de sessions en attente : la file se resserre (positions 3 → 2 → 1), `eta_s` recalculés.
