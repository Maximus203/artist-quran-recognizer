# ADR-0028 — Les réglages de l'éditeur d'export sont mémorisés par vidéo

- Statut : **accepté** (2026-11-17, demande du mainteneur). Complète l'ADR-0020 (éditeur d'export) ; ne change ni le modèle de
  réglages (`VideoPrefs`) ni le rendu.

## Contexte

Les réglages de la vidéo d'export (traduction oui/non, arabe seul, onde, sourate, style, calques, format, fond) étaient une préférence
du COMPTE (`videoPrefs`). Conséquence : régler la récitation A changeait la récitation B, et on ne retrouvait jamais « sa » vidéo
telle qu'on l'avait laissée. Ce qu'on veut : retrouver, vidéo par vidéo, ce qu'on y a réglé.

## Décision

1. **Une ligne par (compte, session)** dans `session_video_prefs` (migration 012, additive : aucune table existante touchée).
   Clé primaire `(user_id, session_id)`, JSON du jeu complet `VideoPrefs`, horodatage ; supprimée avec la session ou le compte.
   Le réglage est par compte ET par vidéo : sur une session partagée, chacun garde les siens.
2. **Priorité** (`startingVideoPrefs`) : réglages de cette vidéo > réglage global du compte (point de départ d'une vidéo jamais
   personnalisée) > défaut « vidéo d'origine » d'une vidéo envoyée. L'éditeur n'écrit plus le réglage global : il n'y a donc plus
   de fuite d'une vidéo vers une autre, ni vers une vidéo neuve.
3. **Serveur** : `GET`, `PUT`, `DELETE /api/sessions/<id>/video-prefs`, gardés par `sessionAccess(..., "view")` : session invisible
   → 404 (y compris la privée d'autrui), administrateur admis sur toutes mais avec SES réglages. `PUT` valide le jeu complet avec le
   schéma existant (`videoPrefsSchema`, clé inconnue ou valeur invalide → 400, rien n'est écrit). La lecture récupère champ par
   champ une ligne abîmée (`sanitizeVideoPrefs`), comme pour le compte. Le balayage IDOR existant couvre la nouvelle route.
4. **Navigateur** : l'écran n'apparaît qu'une fois les réglages de la vidéo lus (jamais ceux d'une autre vidéo). Sauvegarde
   automatique anti-rebond (`PrefsAutosave`, 600 ms, valeur dans `EXPORT_VIDEO_CONFIG.videoPrefs`) : jamais deux envois en même
   temps, un changement pendant un envoi n'est pas perdu, un échec garde la valeur sans boucle. Envoi immédiat au lancement d'un
   export, au départ de l'éditeur, au masquage de l'onglet et à la fermeture de la page (`keepalive`). `VideoPanel` est monté avec
   `key={sessionId}` : aucun état d'une vidéo ne survit au passage à une autre.
5. Le défaut « vidéo d'origine » d'une vidéo envoyée n'est écrit qu'au premier vrai changement, jamais à l'ouverture.

## Choix pris seul

- Sauvegarde du jeu complet (pas de fusion champ par champ) : plus simple, et la limite « deux onglets » ne concerne plus que le
  même couple (compte, vidéo).
- Pas de migration des réglages globaux existants vers les vidéos : une vidéo déjà exportée repart du global, comme une neuve
  (rien n'était mémorisé par vidéo avant).
- Pas de bouton « remettre cette vidéo à zéro » dans l'interface : `DELETE` existe côté serveur, l'écran viendra si on le demande.

## Conséquences

Rien ne change pour le rendu ni pour l'API d'export. Sans ligne, le comportement est celui d'avant (réglages du compte). Retour
arrière : ignorer la table (elle peut rester ; elle n'est lue que par la route et l'éditeur).
