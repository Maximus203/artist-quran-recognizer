# Playlists : regrouper des audios et les lire à la suite
> Surfaces : [API] · [desktop 1280 px] · Statut : ✅ (8 scénarios) · Build : feat/playlists · Testé : 2026-11-03
> Périmètre : `/api/playlists` (liste, création, détail, renommage, ordre, ajout, retrait, suppression), pages `/playlists` et `/playlists/<id>`, « Ajouter à une playlist » depuis `/sessions`, migration `011_playlists.sql`, file de lecture `web/lib/playlist-queue.ts`.
> Environnement : `next build` puis `next start` (jamais `next dev`), dossier de données de TEST jetable, Chrome local piloté par Playwright (`--autoplay-policy=no-user-gesture-required`), trois audios sinus de 2 s, vitesse de lecture ×3 pour accélérer.
> Critère d'arrêt : tous les scénarios ✅, aucune erreur dans la console du navigateur (observé : aucune).
> Limites connues : aucune carte son dans la vérification automatisée (le son lui-même n'est pas écouté) ; Chrome seulement ; pas de téléphone réel.

## Préconditions
- Un compte administrateur, trois sessions d'audios courts, une playlist « Test lecteur » créée par l'API avec les trois.

## Scénarios

### PL.1 — [API] Une playlist n'est visible que de son propriétaire
**Priorité** : critique · **Technique** : partition d'équivalence (autre compte)
**Action** : un autre compte lit, renomme, supprime et ajoute à la playlist d'un compte ; l'administrateur la lit.
**Attendu** : 404 partout, y compris pour l'administrateur ; la liste de l'autre compte reste vide.
**Observé** : 404 partout (tests automatisés `app/api/playlists/route.test.ts` et `lib/playlists.test.ts`)
**Verdict** : ✅

### PL.2 — [API] Une playlist ne donne accès à rien
**Priorité** : critique · **Technique** : cas limite (audio privé d'autrui)
**Action** : ajouter l'audio privé d'un autre compte, une session inconnue, un doublon.
**Attendu** : ignorés et comptés (`skipped`) ; l'audio devenu invisible disparaît de la lecture sans quitter la playlist.
**Observé** : conforme (tests automatisés)
**Verdict** : ✅

### PL.3 — [desktop] Passage automatique et fin de playlist
**Priorité** : critique · **Technique** : parcours nominal
**Action** : ouvrir `/playlists/<id>`, lire ; laisser les trois audios se terminer sans répétition.
**Attendu** : « Court 1 » puis « Court 2 » puis « Court 3 », puis arrêt sur le dernier.
**Observé** : 1, 2, 3 puis `paused` sur « Court 3 »
**Verdict** : ✅

### PL.4 — [desktop] Répétition de toute la playlist, puis d'un audio
**Priorité** : critique · **Technique** : table de décision (mode de répétition)
**Action** : activer la répétition « toute la playlist », lire depuis le dernier ; puis « un audio ».
**Attendu** : après le dernier, retour au premier ; en « un audio », l'audio courant se rejoue sans changer.
**Observé** : « Court 3 » puis « Court 1 » ; en « un audio », le nom ne change pas et la lecture continue
**Verdict** : ✅

### PL.5 — [desktop] Aléatoire, suivant et précédent
**Priorité** : haute · **Technique** : parcours nominal
**Action** : activer et couper l'aléatoire ; suivant puis précédent.
**Attendu** : `aria-pressed` suit l'état ; suivant va à l'audio d'après, précédent revient.
**Observé** : `true` puis `false` ; « Court 1 » → « Court 2 » → « Court 1 » (logique mélangée, bouclage et précédent testés sur la file pure, 15 tests)
**Verdict** : ✅

### PL.6 — [desktop] Réordonner garde l'ordre côté serveur
**Priorité** : haute · **Technique** : parcours nominal puis refus
**Action** : descendre le premier audio ; relire par l'API ; envoyer un ordre incomplet.
**Attendu** : ordre « 2, 1, 3 » à l'écran et côté serveur ; ordre incomplet refusé (409).
**Observé** : « Court 2, Court 1, Court 3 » aux deux endroits ; 409 (test automatisé)
**Verdict** : ✅

### PL.7 — [desktop] Ajouter depuis la liste des sessions
**Priorité** : haute · **Technique** : parcours nominal
**Action** : menu d'une ligne → « Ajouter à une playlist » → créer « Nouvelle liste ».
**Attendu** : confirmation « 1 audio ajouté à « Nouvelle liste » » ; la playlist existe avec 1 audio.
**Observé** : message conforme ; `Nouvelle liste:1`, `Test lecteur:3`
**Verdict** : ✅

### PL.8 — [desktop] Écho depuis le lecteur de playlist
**Priorité** : moyenne · **Technique** : parcours nominal
**Action** : régler le curseur « Écho » à 0,5.
**Attendu** : un montage Web Audio est créé (source, convolueur) ; aucune erreur.
**Observé** : `createMediaElementSource`, `createConvolver` ; console sans erreur
**Verdict** : ✅
