# Export vidéo — réglages mémorisés par vidéo
> Surfaces : [WEB] (1280 px ; 375 px à rejouer) · [API] · [BE] (magasin) · ADR-0028
> Build : prod, worktree jetable, base jetable, Chrome de Playwright · Testé : 2026-11-17
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués proprement, aucune fuite d'une vidéo à l'autre.

## Must-pass

### R.1 — [WEB] Vidéo neuve : le point de départ
**Action** : ouvrir la génération A (jamais personnalisée), onglet Vidéo.
**Attendu** : texte arabe, traduction, onde, sourate affichés (défaut ou global) ; `GET /video-prefs` rend `prefs: null`.
**Verdict** : ✅ (scénario Playwright, 14 points).

### R.2 — [WEB] Réglages enregistrés par vidéo, sauvegarde automatique
**Action** : sur A, masquer la traduction et l'onde ; attendre ~1,8 s.
**Attendu** : `GET /video-prefs` de A rend `showTranslation: false`, `showWave: false`. Sans changement : rien n'est envoyé.
**Verdict** : ✅.

### R.3 — [WEB] Sauvegarde au lancement d'un export
**Action** : sur A, masquer la sourate puis cliquer « Exporter » aussitôt.
**Attendu** : `showRef: false` est enregistré avant la fin de l'export (le rendu lui-même a échoué dans le banc : port du moteur de rendu, sans lien).
**Verdict** : ✅ pour la sauvegarde.

### R.4 — [WEB] B ne montre rien de A
**Action** : ouvrir B (jamais personnalisée) après avoir réglé A.
**Attendu** : tout affiché (défaut/global) ; `prefs: null` pour B ; le réglage global du compte est inchangé.
**Verdict** : ✅.

### R.5 — [WEB] Aller-retour A ↔ B
**Action** : régler B (arabe masqué), revenir sur A, puis sur B.
**Attendu** : A retrouve exactement « sans traduction, sans onde, sans sourate, arabe visible » ; B « arabe masqué seulement ».
**Verdict** : ✅.

### R.6 — [WEB] Persistance
**Action** : recharger la page ; effacer le cookie, se reconnecter ; rouvrir A puis B.
**Attendu** : mêmes réglages. **Verdict** : ✅.

### R.7 — [WEB] Départ immédiat
**Action** : changer un réglage de B puis changer de page tout de suite.
**Attendu** : le changement est enregistré (envoi au démontage), A intacte. **Verdict** : ✅.

## Must-fail

### F.1 — [API] Sans connexion → 401 sur GET, PUT, DELETE. **Verdict** : ✅ (`video-prefs-route.test.ts`).
### F.2 — [API] Un autre compte sur la session PRIVÉE d'autrui → 404 sur chaque méthode, réglages du propriétaire intacts. **Verdict** : ✅.
### F.3 — [API] Sur une session globale, B lit les SIENS (vides), son écriture et sa suppression ne touchent jamais ceux de A. **Verdict** : ✅.
### F.4 — [API] Administrateur sur la session privée de A : accès, mais ses propres réglages (pas ceux de A). **Verdict** : ✅.
### F.5 — [API] Corps invalide (fps 7, clé inconnue) → 400, rien d'écrit. Session inexistante → 404. **Verdict** : ✅.
### F.6 — [BE] Ligne illisible ou abîmée : jamais d'erreur 500 ; illisible = « jamais personnalisée », abîmée = récupérée champ par champ. **Verdict** : ✅.
### F.7 — [BE] Suppression de la session → réglages supprimés (cascade). **Verdict** : ✅.
