# Phase 2 (interface) — parcours normal d'un testeur
> Surfaces : [WEB] · Statut : ✅ · Build : feat/atelier-phase2-ui (merge de feat/comptes-et-partage et de develop @57e9828) · Testé : 2026-10-22
> Périmètre : `/register` → connexion → Nouvel essai (import global) → analyse → ouverture du résultat → signalement → favori → renommage au double-clic. Surface principale 1440×900, coup d'œil à 375×812.
> Environnement : `next start` du worktree, port 3621, `AQR_REVIEW_DIR=D:\01-Dev\Data\aqr-review-phase2-ui` (2 sessions de test copiées), `AQR_DB_PATH` dans ce dossier, `AQR_SIGNUP=open`. Aucune donnée réelle. Le compte de test est créé par l'écran d'inscription (identifiants jetables, non consignés).
> Données : base vide au départ (aucun compte) ; tout est créé par l'interface.
> Critère d'arrêt : tous les must-pass ✅ et les must-fail bloqués.
> Captures : `.artist/acceptance-playbooks/captures/phase2-ui/`

## Préconditions
- [WEB] Serveur lancé sur une base **vide** ; moteur disponible (AQR_PYTHON, modèles, corpus).

## Scénarios

### P1.1 — [WEB] Premier inscrit = administrateur (must-pass)
**Priorité** : critique · **Technique** : nominal
**Action** : ouvrir `/` sans compte, être renvoyé vers `/login?next=%2F`, aller sur « Créer un compte », saisir un pseudonyme et un mot de passe de 24 caractères, valider.
**Attendu** : la note « première personne inscrite : ton compte sera administrateur » est visible ; la jauge indique « Solide » ; après validation on arrive sur l'atelier (Nouvel essai), le menu du compte dit « Administrateur ».
**Vérif [BE]** : `GET /api/me` → `user.role = "admin"`.
**Observé** : redirection `/login?next=%2F` correcte ; note administrateur affichée ; jauge « Solide » ; arrivée sur Nouvel essai, menu « Administrateur » (captures 01, 02, 07).
**Verdict** : ✅
**Issue** : —

### P1.2 — [WEB] Mauvais mot de passe : même message, champ vidé (must-fail)
**Priorité** : critique · **Technique** : erreur
**Action** : se déconnecter, ouvrir `/sessions` (renvoi vers `/login?next=%2Fsessions`), saisir le bon pseudonyme et un mauvais mot de passe.
**Attendu** : « Pseudonyme ou mot de passe incorrect. », le champ mot de passe est vidé et reprend le focus, aucune interface connectée n'a flashé.
**Observé** : message exact affiché, champ vidé avec focus, pas de contenu connecté (capture 09).
**Verdict** : ✅
**Issue** : —

### P1.3 — [WEB] Import d'un audio global, analyse, ouverture du résultat (must-pass)
**Priorité** : critique · **Technique** : nominal
**Action** : sur Nouvel essai, laisser « Global · par défaut » et choisir un petit audio WebM (16 s).
**Attendu** : la session s'ouvre toute seule (`?session=<id>`), apparaît dans « File d'analyse » (anneau + « 1 en cours »), puis devient « Terminé », le « Contenu détecté » s'affiche (Ar-Rahman 55:1–4) et la console montre l'onde et les intervalles.
**Vérif [BE]** : `GET /api/sessions/<id>` → `visibility = "global"`, `owner.username` = le compte, `state = "done"`.
**Observé** : session ouverte à l'import, file puis « Terminé en 57 s », contenu détecté et intervalles 55:1 à 55:4 affichés (capture 03). Aucune erreur dans la console.
**Verdict** : ✅
**Issue** : —

### P1.4 — [WEB] Signaler une plage (must-pass) et auteur = compte (must-fail du champ libre)
**Priorité** : critique · **Technique** : nominal / erreur
**Action** : « Signaler un point ici », écrire un commentaire, « Confirmer le signalement ». Chercher un champ « Qui teste ? ».
**Attendu** : signalement enregistré, porté par le pseudonyme du compte ; le panneau dit « Tu signales en tant que <compte> » ; **aucun** champ de saisie du testeur n'existe.
**Vérif [BE]** : `GET /api/sessions/<id>/review` → `annotations[0].tester` = pseudonyme du compte.
**Observé** : signalement confirmé, étiquette « admin-test » sur l'onde, aucun champ « Qui teste ? » (capture 05).
**Verdict** : ✅
**Issue** : —

### P1.5 — [WEB] Favori et renommage au double-clic (must-pass)
**Priorité** : normal · **Technique** : nominal
**Action** : cliquer l'étoile ; double-cliquer le titre, saisir un nom, Entrée. Essayer aussi Échap sur un second renommage.
**Attendu** : la session apparaît dans « Favoris » de la barre de gauche ; le nouveau nom s'affiche partout (titre, barre de gauche) ; Échap annule.
**Vérif [BE]** : `PATCH /api/sessions/<id>` → `name_source = "user"`.
**Observé** : groupe « Favoris » apparu, nom mis à jour dans la barre de gauche (capture 04). Échap : champ fermé sans changement.
**Verdict** : ✅
**Issue** : —

### P1.6 — [WEB] Mobile 375 px (must-pass)
**Priorité** : normal · **Technique** : partition-équivalence
**Action** : inscription, Nouvel essai et Sessions à 375×812.
**Attendu** : aucun défilement horizontal, cibles tactiles lisibles, formulaire complet dans le premier écran, cartes de session sur deux lignes.
**Observé** : inscription (jauge, œil), Nouvel essai (portée en cartes) et Sessions (cartes, pastilles de filtre qui défilent) corrects (captures 15, 16).
**Verdict** : ✅
**Issue** : —

## Limites de ce passage
- Import vidéo, enregistrement micro et pack ZIP non rejoués (inchangés, couverts par `smoke:browser`, non exécuté ici : Chromium absent de la machine de test).
