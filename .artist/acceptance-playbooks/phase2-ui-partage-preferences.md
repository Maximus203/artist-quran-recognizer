# Phase 2 (interface) — partage entre testeurs et préférences du compte
> Surfaces : [WEB] [API] · Statut : ✅ · Build : feat/atelier-phase2-ui (merge de feat/comptes-et-partage et de develop @57e9828) · Testé : 2026-10-22
> Périmètre : deux comptes (admin + testeuse), privé / global, lecture seule des signalements d'autrui, préférences enregistrées côté serveur et conservées après déconnexion, page Sessions (filtres, « Charger plus », sélection, archivage), Documentation (document + notes de version).
> Environnement : même serveur de test que `phase2-ui-parcours.md` ; le compte administrateur dans Chrome, la testeuse dans le navigateur intégré (375×812). 26 sessions clonées de la session de test (nouveaux identifiants, dates étalées) pour dépasser une page de 20.
> Données : comptes créés par l'écran d'inscription ; sessions clonées sur disque puis indexées au démarrage (comme des sessions « d'avant les comptes »).
> Critère d'arrêt : must-pass ✅, must-fail bloqués.
> Captures : `.artist/acceptance-playbooks/captures/phase2-ui/`

## Scénarios

### P2.1 — [WEB][API] Un privé n'est pas visible d'un autre testeur (must-fail)
**Priorité** : critique · **Technique** : partition-équivalence
**Action** : l'administrateur importe un audio en « Privé » ; la testeuse liste les sessions, appelle `GET /api/sessions/<id>` et ouvre `/?session=<id>`.
**Attendu** : la liste de la testeuse ne le contient pas ; l'API répond `404 { code: "not_found" }` ; l'écran dit « Cette session n'existe pas ou n'est pas visible avec ton compte. » sans autre message parasite.
**Observé** : total 3 pour la testeuse (dont aucune privée), `404` sur l'API, message conforme. Un défaut a été trouvé et corrigé : un message de forme d'onde « Session introuvable. Lecture du fichier original… » s'ajoutait (la forme d'onde est maintenant demandée seulement une fois la session connue).
**Verdict** : ✅
**Issue** : corrigé dans cette PR

### P2.2 — [WEB] Un global est visible, mais en lecture seule pour un autre (must-pass + must-fail)
**Priorité** : critique · **Technique** : table-décision
**Action** : la testeuse ouvre la session globale de l'administrateur et son panneau « Signalements ».
**Attendu** : titre non renommable (ni crayon ni double-clic), « Propriétaire : admin-test », pas de bouton portée ni « Lancer l'analyse », pas d'onglet « Vérité terrain » ; le signalement de l'administrateur est visible avec un cadenas « lecture seule » et sans bouton Modifier ; elle peut mettre la session en favori.
**Observé** : conforme (renommage absent, propriétaire affiché, un signalement, 0 bouton Modifier, 1 cadenas, pas d'onglet Vérité terrain, favori présent) (capture 17).
**Verdict** : ✅
**Issue** : —

### P2.3 — [WEB] Préférences conservées après déconnexion/reconnexion (must-pass)
**Priorité** : critique · **Technique** : transition-état
**Action** : en tant qu'administrateur : fenêtre visible = 2 min, fermer le panneau Revue, passer au thème clair ; vérifier `GET /api/me/preferences` ; se déconnecter ; se reconnecter.
**Attendu** : le serveur porte `visibleSpanSeconds: 120`, `rightPanelOpen: false`, `theme: "light"` ; la page de connexion s'affiche déjà en clair ; après reconnexion le HTML rendu par le serveur porte `data-theme="light"` (aucun clignotement) et le panneau Revue est fermé.
**Vérif [BE]** : `GET /api/me/preferences`.
**Observé** : valeurs exactes côté serveur ; connexion en clair ; après reconnexion `data-theme` présent dans le HTML serveur et panneau droit fermé (captures 06, 08).
**Verdict** : ✅
**Issue** : —

### P2.4 — [WEB] Page Sessions : recherche, filtre de date, « Charger plus », sélection, archivage (must-pass)
**Priorité** : critique · **Technique** : valeurs-limites
**Action** : ouvrir `/sessions` (30 sessions) ; « Charger 10 de plus » ; chercher « khutba » puis un mot absent ; filtre Date « 7 jours » + portée « Mes sessions » ; cocher une ligne, « Archiver », puis « Annuler » dans le toast.
**Attendu** : 20 lignes puis 30 (focus sur la première nouvelle, annonce « 30 sessions affichées ») ; recherche réduite (5 résultats, adresse `?q=khutba`), puis état « Aucune session ne correspond » ; puce « Date : 7 derniers jours » ; barre d'actions « 1 sélectionnée » ; archivage puis restauration par « Annuler ».
**Observé** : conforme à chaque étape (captures 10, 13). Le filtre « Mes sessions » est mémorisé comme préférence et réappliqué à la reconnexion.
**Verdict** : ✅
**Issue** : —

### P2.5 — [WEB] Documentation : un document et les notes de version (must-pass)
**Priorité** : normal · **Technique** : nominal
**Action** : ouvrir `/docs/architecture-atelier` puis `/docs/release-notes`.
**Attendu** : navigation par document, sommaire « Sur cette page », tableaux défilables nommés, schéma ASCII avec bouton Copier, aucun HTML brut interprété ; notes en chronologie avec étiquettes, filtres par type avec compteurs et lien « Demande de fusion n° NN ».
**Observé** : conforme (capture 12) ; un `slug` hors index répond 404 (liste blanche, test unitaire `docs.test.ts`).
**Verdict** : ✅
**Issue** : —

### P2.6 — [WEB] Mes statistiques et quota (must-pass)
**Priorité** : normal · **Technique** : nominal
**Action** : ouvrir `/compte/statistiques` et `/performance?vue=moi`.
**Attendu** : quatre tuiles (tests, audio analysé, vitesse moyenne, espace utilisé sur 5 Go), jauge de stockage avec repère à 80 %, plus gros fichiers, analyses par moteur ; uniquement MES chiffres.
**Observé** : conforme (capture 11) ; la jauge globale du serveur et la colonne « Testeur » sont sur `/performance` (capture 14).
**Verdict** : ✅
**Issue** : —

## Limites de ce passage
- Alerte à 80 % et blocage à 100 % du quota : logique testée en unitaire (`lib/storage-meter.test.ts`) ; non reproduits sur écran (il aurait fallu remplir 4 Go).
- Pas de test de l'inscription fermée ou sur code (variable serveur) : la page lit le mode côté serveur.
