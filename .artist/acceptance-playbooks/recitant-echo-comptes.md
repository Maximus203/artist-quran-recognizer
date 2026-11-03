# Rôle récitateur, écho de l'écoute, suppression d'un compte
> Surfaces : [API] · [desktop 1280 px] · Statut : ✅ (7 scénarios) · Build : feat/role-recitant, feat/lecteur-echo, feat/comptes-suppression · Testé : 2026-11-03
> Périmètre : rôle `recitant` (migration `010_role_recitant.sql`, `web/lib/access.ts`, `web/lib/role-view.ts`), curseur « Écho » (`web/app/atelier/echo-graph.ts`), `DELETE /api/admin/users/<id>`.
> Environnement : `next build` puis `next start`, données de TEST jetables, Chrome local piloté par Playwright, un audio sinus de 8 s avec un résultat d'analyse minimal importé.
> Critère d'arrêt : tous les scénarios ✅, aucune erreur inattendue en console.
> Limites connues : rendu sonore de l'écho non écouté (pas de carte son) ; la visibilité des sessions partagées reste celle des testeurs côté données.

## Scénarios

### R.1 — [API] Le récitateur n'a ni revue ni sous-titres
**Priorité** : critique · **Technique** : partition d'équivalence (rôle)
**Action** : le récitant appelle l'export des sous-titres et la revue de sa session.
**Attendu** : 403 ; l'administrateur franchit le contrôle d'accès.
**Observé** : 403 avec le message « seule la vidéo l'est » ; l'administrateur reçoit 409 (session sans résultat), donc le contrôle d'accès est passé
**Verdict** : ✅

### R.2 — [desktop] Interface réduite du récitateur
**Priorité** : critique · **Technique** : parcours nominal
**Action** : se connecter en récitant ; ouvrir `/`, `/performance`, `/direct`, `/docs`.
**Attendu** : atterrissage sur `/sessions`, barre réduite à « Sessions », les autres pages renvoient vers `/sessions`, `/?vue=new` reste ouvert sans écoute en direct.
**Observé** : conforme
**Verdict** : ✅

### R.3 — [desktop] Export vidéo seul, erreur visible en cas d'échec
**Priorité** : critique · **Technique** : parcours nominal et échec simulé
**Action** : ouvrir l'export d'une session analysée ; puis simuler une réponse 400 du contrôle.
**Attendu** : ni « Vérifier » ni « Sous-titres », seul le panneau vidéo ; en cas d'échec, le message et « Réessayer » restent visibles.
**Observé** : panneau vidéo seul ; message « Le contrôle n'a pas pu se faire » et « Réessayer » visibles
**Verdict** : ✅

### R.4 — [desktop] L'écho se règle depuis le lecteur
**Priorité** : haute · **Technique** : parcours nominal
**Action** : ouvrir la revue d'une session, régler « Écho » à 0,6, lancer la lecture.
**Attendu** : aucun montage avant le réglage ; ensuite source, gains et convolueur ; la lecture démarre ; la préférence est enregistrée.
**Observé** : 0 appel avant ; `createMediaElementSource`, 2 × `createGain`, `createConvolver` après ; lecture en cours ; préférence `echo = 0.6`
**Verdict** : ✅

### R.5 — [API] Suppression d'un compte : droits et garde-fous
**Priorité** : critique · **Technique** : partition d'équivalence
**Action** : supprimer un compte (administrateur, testeur), le sien, un compte inconnu ; supprimer le dernier administrateur actif.
**Attendu** : 204, 403, 409 `self`, 404, 409 `last_admin`.
**Observé** : conforme (tests automatisés `app/api/admin/users/[id]/route.test.ts`, `lib/users-delete.test.ts`)
**Verdict** : ✅

### R.6 — [API] Les invitations et agents d'un administrateur supprimé sont conservés
**Priorité** : haute · **Technique** : cas limite (clés étrangères sans cascade)
**Action** : supprimer un administrateur qui a créé une invitation et un agent du moteur.
**Attendu** : suppression réussie ; invitation et agent rattachés à celui qui supprime.
**Observé** : conforme (tests automatisés)
**Verdict** : ✅

### R.7 — [desktop] Page des comptes : rôle et suppression
**Priorité** : moyenne · **Technique** : parcours nominal
**Action** : ouvrir `/gestion/comptes` en administrateur.
**Attendu** : un sélecteur de rôle (testeur, récitateur, administrateur) et un bouton « Supprimer » sur chaque autre compte, aucun sur le sien.
**Observé** : 1 sélecteur, 1 bouton « Supprimer » (pour le seul autre compte)
**Verdict** : ✅
