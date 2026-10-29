# Checklist sécurité et robustesse avant déploiement

> Document de travail. Il liste ce qui doit être **codé, vérifié, testé et sécurisé** avant qu'une
> version de l'atelier soit exposée sur Internet. Aucun point n'est « fait » sans preuve (commande,
> test, log ou capture) consignée dans la PR qui le traite.

## 0. Lecture et légende

| Marque | Sens |
|---|---|
| ✅ | Existe dans le dépôt (vérifié par lecture du code à la date de rédaction) |
| 🟡 | Partiel : existe mais insuffisant ou non prouvé |
| ❌ | À faire |

**État des lieux (2026-10-30).** Le code contient déjà : hachage de mots de passe (scrypt, `web/lib/passwords.ts`),
règle de longueur et force (`web/lib/password-strength.ts`, 10 caractères minimum), verrouillage progressif
des échecs de connexion et limitation des inscriptions (`web/lib/rate-limit.ts`, en mémoire), jetons API
(`web/lib/api-tokens.ts`), jetons du direct signés HMAC à usage unique (`src/aqr/live/`), mode d'accès à
jeton (`AQR_ACCESS_TOKEN`) et inscription `open | closed | code`. Il n'existe **ni `middleware.ts`, ni en-têtes
HTTP de sécurité** dans `web/next.config.ts`, et le journal serveur (`web/lib/log.ts`) n'écrit que sur la
console, pas dans des fichiers.

**Environnement local.** Node.js `v24.19.0` (poste de développement), Next.js `16.4.2`. Aucun `Dockerfile`
ni `.nvmrc` ni champ `engines` n'est déclaré : la version de Node de production n'est donc pas figée.

---

## 1. Gate bloquant : la pile de traitement (fonctionnel avant sécurité)

Tant que ces points ne sont pas prouvés, on ne déploie rien.

- [x] ✅ **Une seule file pour toutes les charges lourdes.** (PR #124 : `web/lib/queue-scheduler.test.ts`, `video-jobs.test.ts`.) Texte d'origine : Aujourd'hui, les analyses (`web/lib/queue.ts`,
  `web/lib/jobs.ts`) et les exports vidéo (`web/lib/video-jobs.ts`) ont chacun leur file : deux charges
  lourdes peuvent tourner à la fois. Objectif : un ordonnanceur, une place, FIFO.
- [x] ✅ **Modèle chargé une fois** (worker chaud) (PR #125 : mesure réelle 32,5 s puis 0,5 s ; `tests/unit/test_worker.py`). Texte d'origine : aujourd'hui, un processus Python par analyse, environ 50 s
  de chargement à chaque fois.
- [x] ✅ **Équité entre comptes** (PR #124 : tour à tour + plafond de 5 en attente, 429). Texte d'origine : plafond de jobs en attente par compte (ou tour à tour). La FIFO globale
  laisse un compte bloquer les autres.
- [x] ✅ **Watchdog** (PR #124 : arrêt du processus ou du navigateur, place reprise). Texte d'origine : délai maximal par job (multiple de la durée estimée), arrêt du processus, passage au suivant.
- [ ] 🟡 **Annulation** en file et en cours (analyses : OK ; export vidéo en cours : pas encore d'annulation par l'API). Texte d'origine : la place est libérée, le processus tué, les fichiers partiels supprimés.
- [x] ✅ **Redémarrage pendant un job** (PR de ce lot : `web/lib/jobs-orphans.test.ts` ; les exports vidéo en cours, eux, sont perdus au redémarrage : leur registre est en mémoire). Texte d'origine : état `running` orphelin traité explicitement (remise en file ou échec
  visible). Vérifier `recoverQueue`.
- [ ] ❌ **Fichiers très longs** : découpage en tronçons persistés pour que des jobs courts passent entre deux tronçons.
- [ ] ❌ **Direct hors file** (décision du 2026-10-30) : plafond de flux simultanés configuré à partir de la mesure
  de charge sur la machine cible (valeur de départ proposée : 12 sur 16 vCPU). Le direct ne doit pas dégrader la pile.
- [ ] ❌ **Test de charge de la file** sans modèle (jobs factices), avec les scénarios de la section 14.

## 2. Visibilité de la file, en privé

Règle : un utilisateur sait **qu'il attend et pourquoi**, sans voir les détails d'un autre compte.

- [x] ✅ (PR de ce lot : `queue-status.ts`, pastille `queue-notice.tsx`) Affichage « Le système est occupé : une génération est en cours et une autre est en attente » quand la
  place est prise par un autre compte, **sans** titre, durée, nom, identifiant ni contenu du job d'autrui.
- [x] ✅ (position « 3e », attente estimée seulement si l'historique le permet, jamais derrière un export vidéo) Pour son propre job : position dans la file (« 3e »), attente estimée (« environ 12 min »), et état
  (en attente / en cours / terminé / échoué). L'estimation ne s'affiche que si l'historique est suffisant,
  sinon « estimation indisponible ».
- [x] ✅ (`others.shared`, testé) Une génération publique est visible de tous (comportement attendu). Une génération privée n'expose
  jamais son titre dans la file partagée.
- [x] ✅ (`web/app/api/queue/route.test.ts` ; capture : pastille vue par le compte B dans un vrai navigateur) Test : deux comptes A et B. A lance une génération privée. B voit « occupé », jamais le nom ni le
  titre de A. Preuve : capture et réponse JSON de l'API pour B.
- [ ] 🟡 Message d'erreur clair pour un humain (ce qui ne marche pas, depuis quand, quoi faire), jamais un code brut.

## 3. Dépendances, runtime et CVE

- [ ] 🟡 **Node.js : passer à une version corrigée (la production la refuse sinon, preuve `exit=1` ; le poste de Cherif reste en 24.19.0, à mettre à jour — `docs/SECURITE-DEPENDANCES.md`).** Texte d'origine : passer à une version corrigée de CVE-2026-111497 (« Node2Shell »).** Faille de type
  écriture hors limites dans le décodeur Brotli, publiée par Node.js le 21 octobre 2026. Versions corrigées :
  **22.23.4, 24.22.1, 26.12.1**. Les versions antérieures de ces lignes et les lignes 25.x à 12.x en fin de vie
  sont touchées ; Node.js 18 et 20 n'ont pas de correctif officiel pour cette faille. Le poste local (v24.19.0)
  est **en dessous** de la version corrigée. Source : [HeroDevs, CVE-2026-111497](https://www.herodevs.com/blog-posts/cve-2026-111497-node2shell-node-js-brotli-rce),
  [Aikido, Node2Shell](https://www.aikido.dev/blog/node2shell-nodejs-brotli-rce-cve-2026-111497).
  La source officielle (nodejs.org, annonce de sécurité) fait foi pour les versions et la sévérité ; le score
  CVSS rapporté varie selon les sources et n'a pas été confirmé.
- [ ] 🟡 Figer la version de Node en production (`engines` et `.nvmrc` faits ; l'image de base avec tag précis attend la section 15).
- [x] ✅ (Next 16.4.3, aucun avis de sécurité publié sur cette version ; React 19.3.0 propre) Next.js `16.4.2` et React : vérifier les avis de sécurité Next.js publiés depuis la date de la version
  et monter à la version corrigée la plus récente.
- [ ] 🟡 (npm : 0 vulnérabilité après zod 4.6.7 ; Python : 72 entrées, exceptions datées au 2026-11-12, gravité à qualifier sur l'image) `npm audit --omit=dev` (et la sortie de `pip-audit` pour le Python) : zéro vulnérabilité **haute ou critique**
  non justifiée. Chaque exception est écrite avec sa raison et sa date de révision.
- [x] ✅ (`.github/dependabot.yml`, npm et pip, hebdomadaire ; l'activation côté GitHub reste à confirmer dans les réglages du dépôt) Activer les alertes de dépendances (Dependabot ou équivalent) et une revue hebdomadaire.
- [ ] 🟡 (`.python-version` 3.11.9 ; verrou complet des paquets : avec l'image) Version de Python et des paquets épinglée (`requirements` ou lockfile, `models/LOCK.json` pour les modèles).
- [ ] ❌ Image ou environnement de production reconstruit à partir d'un état propre (pas d'arbre de travail
  non commité, cf. règle G-6 du CLAUDE.md global).
- [ ] ❌ Scan de l'image de conteneur (Trivy ou équivalent) avant chaque mise en production.

## 4. Authentification et mots de passe

- [ ] 🟡 Hachage scrypt existant : **vérifier les paramètres** (coût N, r, p, longueur du sel, `needsRehash`) et
  les comparer à une recommandation actuelle de l'OWASP ; le test doit prouver qu'un hash est rehaché quand les
  paramètres changent.
- [ ] 🟡 Règle de mot de passe : aujourd'hui 10 caractères minimum et une estimation de force. **Monter le
  minimum à 12 caractères**, refuser les mots de passe présents dans une liste de fuites connues (Have I Been
  Pwned, téléchargée et vérifiée hors ligne, ou API k-anonymity), refuser le pseudonyme, les motifs trivials
  (suites, répétitions) et les mots du service. Phrase de passe recommandée, sans obligation de symboles.
- [ ] ❌ Vérifier la robustesse à la création **et** au changement de mot de passe (`/compte/securite`), et à la
  réinitialisation (si elle existe, sinon la rendre explicite dans la checklist).
- [ ] ❌ Messages d'erreur de connexion génériques (« identifiant ou mot de passe incorrect ») : aucune énumération
  des comptes, ni à la connexion, ni à l'inscription (réponse et délai identiques, `verifyAgainstDummy` pour les
  comptes inconnus).
- [ ] 🟡 Verrouillage progressif existant (`FailureLimiter`) : **vérifier** qu'il est indexé par compte **et** par
  adresse IP, qu'il survit au redémarrage (aujourd'hui en mémoire, un seul processus), et qu'il ne peut pas être
  utilisé pour verrouiller un compte légitime à distance (déni de service ciblé) : prévoir un déverrouillage
  par courriel ou par administrateur.
- [ ] ❌ Journal des connexions : succès, échecs, verrouillages, changements de mot de passe (sans le mot de passe).
- [ ] ❌ Déconnexion effective : jeton et cookie invalidés côté serveur. « Fermer les autres connexions » fonctionne.
- [ ] ❌ Pas de double facteur (décision : non pertinent à ce stade). À réévaluer si les comptes gagnent des droits
  d'administration ou d'accès à des données de tiers.

## 5. Sessions et cookies

- [ ] 🟡 Cookie `HttpOnly` (documenté). **Vérifier et tester** : `Secure`, `SameSite=Lax` au minimum, durée
  de vie courte avec renouvellement, identifiant de session aléatoire d'au moins 128 bits, nouvel identifiant à
  chaque connexion (anti-fixation).
- [ ] ❌ Protection CSRF sur toutes les routes qui modifient l'état (jeton synchronisé ou vérification stricte de
  l'en-tête `Origin`).
- [ ] ❌ Expiration absolue et inactivité, côté serveur.

## 6. Autorisation (qui voit quoi)

- [ ] ❌ **Contrôle d'accès sur chaque route** `/api/sessions/[id]/…`, `/api/v1/recordings/…`, `/api/mcp`,
  `/api/users/…`, et les fichiers statiques (audio, vidéo, avatar, export). Un test automatisé vérifie qu'un compte B
  ne peut pas lire, modifier, supprimer ou télécharger une ressource de A (IDOR).
- [ ] ❌ Identifiants de ressources non devinables ou vérifiés (les identifiants séquentiels ne suffisent pas
  à protéger quoi que ce soit).
- [ ] ❌ Rôles explicites : utilisateur, testeur, administrateur. La vérité terrain et la gestion des comptes sont
  réservées aux administrateurs (cf. `docs/ARCHITECTURE-ATELIER.md`).
- [ ] ❌ Génération publique : le passage « privé → public » est une action explicite, journalisée, réversible.

## 7. API : authentification, validation, limitation de débit

- [ ] ❌ **Throttling sur toute l'API**, par jeton, par compte et par adresse IP, avec limites distinctes par famille
  (lecture, écriture, envoi de fichiers, génération, MCP, direct). Réponse `429` avec `Retry-After`.
- [ ] ❌ Limite globale de débit au proxy (reverse proxy) en plus de l'application, pour que la protection tienne
  même si le processus est saturé.
- [ ] ❌ **Validation stricte des entrées** : schéma (zod, déjà utilisé) sur chaque corps, paramètre de requête et
  en-tête. Rejet des champs inconnus. Bornes sur les tailles, les listes et les profondeurs.
- [ ] ❌ Taille maximale du corps par route, lecture bornée (pas de lecture entière en mémoire).
- [ ] ❌ Jetons API : stockés hachés, portée limitée, date d'expiration, révocation, journalisation d'usage. Jamais
  affichés une seconde fois.
- [ ] ❌ Réponses d'erreur sans pile ni chemin de fichier ni détail interne.
- [ ] ❌ Versionnement de l'API (`/api/v1/…`) et contrat documenté.

## 8. Middleware et en-têtes HTTP

Aujourd'hui absent (`web/next.config.ts` ne définit aucun en-tête, aucun `middleware.ts`).

- [ ] ❌ Créer un `middleware` (ou un équivalent sur le serveur) qui vérifie **avant** les routes : authentification,
  autorisation de base, limitation de débit, taille maximale, en-tête `Host` et `Origin` autorisés.
- [ ] ❌ **Content-Security-Policy** stricte (pas de `unsafe-inline` ni `unsafe-eval` si évitable ; sources explicites).
- [ ] ❌ `Strict-Transport-Security` (HSTS), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (micro autorisé uniquement là où il est nécessaire : le direct), `X-Frame-Options` ou
  `frame-ancestors`.
- [ ] ❌ Cookies : attributs vérifiés par test automatisé.
- [ ] ❌ Désactiver l'en-tête `X-Powered-By` et les pages de débogage en production.
- [ ] ❌ Vérification par un outil externe (securityheaders.com ou équivalent) avec capture consignée.

## 9. Pièges (honeypots) et détection des bots

Objectif : détecter et ralentir les robots, sans bloquer les humains.

- [ ] ❌ **Champs leurres** dans les formulaires d'inscription et de connexion (cachés aux humains, visibles aux
  robots). Une valeur renseignée, ou un formulaire soumis trop vite (< 2 s), déclenche un refus silencieux
  journalisé.
- [ ] ❌ **Routes pièges** non publiées (`/admin`, `/wp-admin`, `/.env`, `/api/debug`…) : toute requête déclenche un
  verdict de sévérité « hostile » et une adresse IP bloquée pendant une durée croissante.
- [ ] ❌ Verdict et blocage journalisés (adresse IP hachée ou tronquée selon la politique de confidentialité).
- [ ] ❌ Liste d'adresses bloquées avec expiration, persistée, et une procédure pour lever un blocage.
- [ ] ❌ Test : un script de brute force contre un compte de test doit être ralenti puis bloqué ; un humain
  qui se trompe une fois ne doit pas l'être.
- [ ] ❌ Option CAPTCHA seulement si les honeypots ne suffisent pas. Pas de CAPTCHA par défaut (friction).

## 10. Journalisation et diagnostic en production

- [ ] ❌ **Journal dans des fichiers**, rotation quotidienne ou par taille, rétention définie, droits de lecture
  restreints (`0640`), un fichier par flux (applicatif, sécurité, accès, file d'attente). Aujourd'hui, `log.ts`
  n'écrit que sur la console.
- [ ] ❌ Événements obligatoires : connexions (succès, échec, verrouillage), inscriptions, changements de mot de passe,
  création et révocation de jetons, accès refusés (401, 403), honeypots, dépassements de débit (429), analyses
  (démarrage, fin, échec, durée, moteur, version), exports, erreurs serveur, démarrage et arrêt du service,
  dégradations du direct.
- [ ] ❌ **Jamais** de mot de passe, de jeton, de cookie, d'audio, de texte coranique, de traduction ni de contenu
  utilisateur dans les journaux (cf. le journal du direct, qui ne garde que des événements et des nombres).
- [ ] ❌ Identifiant de corrélation par requête, présent dans tous les journaux liés.
- [ ] ❌ Format structuré (une ligne JSON par événement) avec horodatage UTC, niveau, portée, événement, durée.
- [ ] ❌ Journal d'audit distinct, en écriture seule (ajout uniquement).
- [ ] ❌ Procédure de diagnostic écrite : où sont les journaux, quelles commandes, quels indicateurs regarder en premier.
- [ ] ❌ Alerte sur erreurs récurrentes (règle « audit des logs » du CLAUDE.md global) : une erreur qui revient
  depuis des jours doit être remontée, pas silencieuse.
- [ ] ❌ Pas de fuite de données personnelles dans les journaux : adresses IP et identifiants de compte pseudonymisés
  selon la politique publiée.

## 11. Envoi de fichiers (audio, vidéo, avatar)

- [ ] 🟡 Quota par compte (5 Gio) et refus avant envoi si l'espace manque : existant. **Vérifier** le quota
  global du disque et la purge des fichiers expirés.
- [ ] ❌ Vérification du type réel (contenu, pas seulement l'extension ou le type MIME déclaré) : audio, vidéo,
  image. Réencodage des avatars côté serveur (déjà en place : vérifier).
- [ ] ❌ Taille maximale par type, lecture en flux, écriture disque au fil de l'eau (pas de tampon en mémoire).
- [ ] ❌ Nom de fichier jamais utilisé tel quel : identifiant généré, aucune traversée de chemin.
- [ ] ❌ Protection contre les archives piégées (bombe de décompression, nombre d'entrées, taille décompressée
  bornée), pour les paquets ZIP d'export et d'import.
- [ ] ❌ Fichiers servis avec le bon `Content-Type`, `Content-Disposition` et `X-Content-Type-Options: nosniff`.
- [ ] ❌ Droits d'accès aux fichiers vérifiés par la route (cf. section 6), jamais par un dossier public.

## 12. Direct (WebSocket)

- [ ] 🟡 Jeton signé HMAC, à usage unique, durée 60 s, lié au compte (existant, `src/aqr/live/`). **Vérifier** :
  la clé de signature est un secret de l'environnement, jamais dans Git ; rotation documentée.
- [ ] ❌ Contrôle de l'en-tête `Origin` à la connexion WebSocket (refus de toute origine non listée).
- [ ] ❌ Quotas : flux simultanés, par compte, connexions non authentifiées (valeurs à fixer après mesure, section 1).
- [ ] ❌ Taille maximale des trames et durée maximale de flux, bornées.
- [ ] ❌ Vie privée : aucun audio conservé par défaut ; le test vérifie qu'aucun fichier audio n'apparaît sur le disque
  après un flux.

## 13. Secrets et configuration

- [ ] ❌ Aucun secret dans Git : `.env` ignoré, `.env.example` vide, historique vérifié (`git log -p` avec un outil
  de détection de secrets, par exemple gitleaks).
- [ ] ❌ Secrets distincts entre développement, test et production. Les clés de production ne sont jamais
  copiées sur un poste de développement.
- [ ] ❌ Rotation documentée (jetons, clé HMAC, identifiants de base de données).
- [ ] ❌ Variables obligatoires vérifiées au démarrage : le service refuse de démarrer si une valeur de sécurité
  manque (clé, mode d'accès, origines autorisées).
- [ ] ❌ Mode de production explicite (`NODE_ENV=production`), aucune route de test ou de développement exposée.

## 14. Robustesse et tests

**Tests de sécurité automatisés** (à ajouter au pipeline) :
- [ ] ❌ IDOR : compte B ne peut rien faire sur les ressources de A (lecture, écriture, suppression, téléchargement).
- [ ] ❌ Injection : entrées malveillantes sur chaque champ (SQL, chemin, commande, HTML). Aucune exécution.
- [ ] ❌ Authentification : brute force contre un compte de test (verrouillage, ralentissement, journal).
- [ ] ❌ Débit : dépassement des limites sur chaque famille de routes (429 et `Retry-After`).
- [ ] ❌ Honeypots : formulaire leurre rempli, route piège appelée.
- [ ] ❌ En-têtes et cookies (test automatisé sur les réponses).
- [ ] ❌ Téléversement hostile : fichier mal typé, archive piégée, nom de fichier hostile, taille dépassée.

**Scans à exécuter avant la mise en production** (rapport consigné) :
- [ ] ❌ OWASP ZAP (scan de base, puis actif sur l'environnement de test).
- [ ] ❌ `testssl.sh` ou équivalent : TLS 1.2 minimum, pas de suite faible, certificat valide.
- [ ] ❌ securityheaders.com ou équivalent.
- [ ] ❌ `npm audit`, `pip-audit`, Trivy sur l'image.
- [ ] ❌ gitleaks sur l'historique.

**Scénarios de la file d'attente** (rappel de la section 1, à tester ici aussi) :
1. 50 soumissions dans la même seconde : ordre stable, aucune place doublée.
2. Un compte envoie 30 fichiers pendant que d'autres attendent : équité.
3. Fichier de 6 h : les jobs courts passent entre les tronçons.
4. Mort du processus (mémoire saturée) pendant un job : la file avance, le job est en échec explicite.
5. Redémarrage du serveur avec 10 jobs en attente : ordre conservé.
6. Annulation en file, puis en cours : place libérée.
7. Fermeture du navigateur pendant l'attente : le résultat reste disponible.
8. Export vidéo pendant une analyse : une seule charge à la fois.
9. Job figé : le watchdog arrête le processus et débloque la pile.
10. Disque plein à l'envoi : refus propre, rien de partiel.
11. Deux onglets sur le même compte : pas de doublon.
12. Direct actif pendant un lot : retard et contention mesurés.
13. Mise à jour d'un modèle pendant qu'une file attend.

## 15. Infrastructure et exposition

- [ ] ❌ **Serveur cible identifié.** Le « serveur alpha » mentionné n'apparaît dans aucun document du dépôt : à
  confirmer (nom réel, système, accès, emplacement). Pas de déploiement sur une machine non identifiée.
- [ ] ❌ Reverse proxy devant l'application (TLS terminé, limitation de débit, taille maximale du corps, en-têtes),
  l'application n'écoute pas directement sur Internet.
- [ ] ❌ Pare-feu : seuls les ports 80 et 443 ouverts sur Internet. SSH limité (clé uniquement, pas de mot de passe,
  accès restreint ou VPN, pas d'accès root direct).
- [ ] ❌ Mises à jour du système d'exploitation automatiques pour les correctifs de sécurité.
- [ ] ❌ Utilisateur système dédié, sans droits d'administration, pour le service.
- [ ] ❌ Sauvegardes : base de données, comptes, sessions, fichiers. Test de restauration réel consigné. Règle 3-2-1.
- [ ] ❌ Supervision : disponibilité, espace disque, mémoire, profondeur de file, erreurs (ex. Uptime Kuma et Dozzle,
  déjà dans la flotte).
- [ ] ❌ Plan de reprise : procédure écrite pour revenir à la version précédente en moins de 15 minutes.
- [ ] ❌ Page de maintenance et mode arrêt d'urgence (désactiver les inscriptions et les envois sans tout couper).

## 16. Données personnelles et conformité

- [ ] ❌ Politique de confidentialité publiée : données collectées, durée de conservation, droits, contact.
- [ ] ❌ Consentement explicite pour le micro (direct) et pour l'envoi de fichiers.
- [ ] ❌ Droit de suppression du compte et de ses données (sessions, fichiers, journaux nominatifs).
- [ ] ❌ Droits sur les enregistrements (récitants, tiers) vérifiés avant publication : rappel de la règle de
  `AGENTS.md` (aucun enregistrement de personne versionné).

## 17. Critères de sortie (go / no-go)

Le déploiement est autorisé si, et seulement si :

1. Toutes les cases des sections 1, 3, 4, 6, 7, 8, 10, 14 et 15 sont cochées avec leur preuve.
2. Aucune vulnérabilité **haute ou critique** ouverte sans exception datée et justifiée.
3. Node.js est dans une version corrigée de CVE-2026-111497 (22.23.4, 24.22.1 ou 26.12.1 selon la ligne retenue).
4. Les tests de sécurité de la section 14 passent sur l'environnement de test.
5. La procédure de retour arrière a été jouée une fois.
6. La décision finale de mise en production appartient à Cherif Diouf. Aucun agent ne certifie seul son travail.

---

## Annexe : ce qui reste hors périmètre

- Double facteur d'authentification (décision : non pertinent pour l'instant ; à réévaluer, voir section 4).
- Passage à une file distribuée (Redis, base de données) : nécessaire seulement si l'on ajoute un second serveur actif
  (voir section 1 et la décision de pile unique).
- Second moteur de rendu vidéo : hors périmètre, un seul rendu, celui de l'atelier.
