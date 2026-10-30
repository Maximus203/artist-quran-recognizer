# Infrastructure et exposition

Ce document prépare la mise en ligne (section 15 de `docs/SECURITE-PRE-DEPLOIEMENT.md`). **Rien de ce qui
est décrit ici n'a été appliqué** : ni port ouvert, ni service installé, ni déploiement. Les fichiers de
`deploy/` sont des modèles à relire, adapter et jouer sur la machine cible, une fois celle-ci identifiée.

## Ce qui existe aujourd'hui

L'exposition actuelle est un essai pour testeurs : `scripts/testeurs/atelier-testeurs.ps1` lance l'atelier
sur le poste de Windows (port 3200) derrière un tunnel Cloudflare à adresse changeante, avec un jeton
d'accès. Ce n'est pas une infrastructure de production : le poste dort, redémarre, change de réseau, et
le tunnel gratuit n'offre aucune garantie. Depuis la section 13, ce script fournit aussi les valeurs de
sécurité que le serveur exige (sel d'audit et clé des formulaires créés une fois dans le dossier d'état).

## Serveur cible : Alpha, pour l'atelier seul (décision du 2026-10-29)

**Alpha** est le serveur Hetzner `alpha-app-server` (Ubuntu 26.04, 8 vCPU, 15 Gio de mémoire dont moins de
1 Gio libre hors cache, 208 Go de disque libre, **aucun GPU**). Relevé en lecture seule le 2026-10-29 :
SSH par clé seulement, pare-feu actif (80 et 443 ouverts, administration par VPN WireGuard), mises à jour
automatiques actives, **Traefik v3.7 dans Docker** (réseau `web`, entrypoint `websecure`, résolveur
`letsencrypt`). Il héberge déjà en production d'autres projets (Murabbi, SAP, CRM) : **l'atelier y est un
voisin, pas le locataire principal.** Le Node de l'hôte (22.22.1) est touché par CVE-2026-111497 : l'atelier
y tourne donc **dans une image** qui apporte un Node corrigé.

Décision de Cherif Diouf : **Alpha héberge l'atelier seul ; le moteur d'analyse tourne sur Atlas** (toujours
allumé), relié à Alpha par un **second WireGuard** (précision du 2026-10-29, `docs/adr/0017`). Atlas n'a **pas de
GPU** : le moteur y tourne sur processeur, à mesurer. Le direct reste à décider. Nom public de l'atelier :
**`quran-tr.artist-dev.com`** (frontend servi par Traefik sur Alpha). Conséquences :

- Alpha tourne en **`AQR_ENGINE=remote`** : les analyses attendent un agent du moteur (ADR-0017). La couture
  (courtier, bail, routes `/api/engine/*`, jetons d'agent) est **écrite et testée**, et **l'agent Python (`aqr engine-agent`)
  est écrit et éprouvé contre le vrai atelier** ; l'environnement du moteur est **installé et mesuré sur Atlas** (ADR-0017, 12 min d'audio en 3 min), mais l'agent n'est **pas encore démarré** (modèle d'unité :
  `deploy/systemd/aqr-engine-agent.service`) : tant qu'aucun agent n'est en ligne, les envois sont acceptés mais
  aucune analyse ne démarre. Pour
  geler les envois d'ici là : `AQR_SERVICE_MODE=restricted`. L'image ne contient ni Python ni Chromium.
- Les bornes de l'atelier protègent les voisins : 2 Gio de mémoire, 2 processeurs, 512 processus, système de
  fichiers en lecture seule, aucune capacité Linux, disque protégé par la réserve de 1 Gio (`AQR_MIN_FREE_BYTES`).

## Schéma

```
Internet ─ 443 ─▶ Traefik (TLS, existant) ─▶ conteneur « atelier » (réseau web, port 3000, jamais publié)
                                                 └▶ volume atelier-data (/data) : base, sessions, avatars, journaux, control/
Atlas ─ WireGuard wg1 (10.78.0.2 ↔ 10.78.0.1) ─▶ /api/engine/* (réservé au VPN) ◀── agent du moteur (appelle Alpha)
```

L'agent est le client : Atlas n'ouvre aucun port. Atlas résout `quran-tr.artist-dev.com` vers l'adresse VPN d'Alpha
(`/etc/hosts`), si bien que le trafic du moteur ne passe jamais par Internet.

## Modèles fournis (`deploy/`)

| Fichier | Rôle | Validé |
|---|---|---|
| `docker/Dockerfile` | image de l'atelier seul, Node épinglé corrigé, utilisateur `node`, sonde de santé | **non construit** (télécharge l'image Node ; à autoriser) |
| `docker/compose.alpha.yaml` | service derrière Traefik (étiquettes relevées sur les conteneurs en place), bornes, secrets dans `/opt/atelier/atelier.env` | syntaxe **oui** (`docker compose config`), non appliqué |
| `wireguard/*.example` | second WireGuard Alpha ↔ Atlas (sous-réseau 10.78.0.0/30, port 51821/udp), sans clé | **non** (modèles, rien de généré ni appliqué) |
| `scripts/service-mode.sh` | arrêt d'urgence, dans le conteneur | **oui** (local) et sur un vrai serveur (voir plus bas) |
| `scripts/release.sh`, `rollback.sh` | bascule et retour arrière par tag d'image | syntaxe seulement ; **jamais joués** |
| `systemd/aqr-backup.{service,timer}` | sauvegarde quotidienne 03 h 30 dans le conteneur puis copie restic | outil **oui**, unité non |
| `systemd/aqr-logreport.{service,timer}` | rapport quotidien 07 h, poussé vers Uptime Kuma | script **oui** (sans poussée réelle), unité non |

Le pare-feu, le proxy et les mises à jour automatiques d'Alpha **existent déjà** : rien à ajouter, rien à
modifier. L'atelier n'ouvre aucun port sur l'hôte.

## Réseau, accès, utilisateur

- **Second WireGuard** (`deploy/wireguard/`) : interface `wg1` distincte de `wg0` (VPN d'administration existant, qu'on ne touche pas). Atlas, derrière sa box, **initie** la connexion vers Alpha (`PersistentKeepalive`) : seul Alpha ouvre un port (51821/udp). **État au 2026-10-30 : le tunnel est appliqué et éprouvé** (interface `wg1` créée des deux côtés, `51821/udp` ouvert sur Alpha, service `wg-quick@wg1` activé au démarrage, poignée de main établie, `ping` Atlas → 10.78.0.1 à 0 % de perte, ~103 ms ; `wg0` et `tailscale0` intacts). Les clés privées vivent seulement dans `/etc/wireguard/wg1.key` de chaque machine. **Atelier déployé sur Alpha le 2026-10-30** (`https://quran-tr.artist-dev.com`, image `atelier:588aafe` = `develop`, enregistrement DNS A chez o2switch vers l'IP d'Alpha, certificat Let's Encrypt, Node 24.22.2). Conteneur borné (2 Go, 2 CPU, système de fichiers en lecture seule, sans privilège), règles Traefik appliquées : routeur public sans `/api/engine/*`, routeur du moteur réservé à `10.78.0.0/30`. Configuration en mode `AQR_SIGNUP=code` (le premier compte créé devient administrateur : un code évite qu'un inconnu le devienne) et `AQR_SERVICE_MODE=restricted` tant que l'agent d'Atlas n'existe pas (envois, analyses et direct suspendus). Secrets générés sur place dans `/opt/atelier/atelier.env` (root, 0600), jamais affichés.

**Preuves relevées le 2026-10-30** : depuis Internet, `/api/engine/*` est refusé par Traefik (403 texte brut) ; depuis Atlas par le VPN il atteint l'application (401 sans jeton d'agent). Avec un vrai jeton, dans un conteneur jetable de la même image : API `/api/v1/me` 200, MCP `initialize` 200, `tools/list` 25 outils, `tools/call list_recordings` avec de vraies données ; jeton faux 401, sans jeton 403. TLS 1.2 et 1.3 seulement, aucun en-tête révélateur, limitation de débit effective (29 requêtes passées puis 11 en 429 sur 40), corps de 3 Mo refusé en 413, écriture depuis une origine étrangère refusée. Impact : atelier 86 Mo sur 2 Go, charge d'Alpha 0,46, aucun conteneur voisin en défaut, aucun nouveau port TCP ouvert (seul `51821/udp` s'ajoute), pare-feu d'Atlas inchangé.

**Défauts trouvés en testant le déploiement réel** (corrigés, PR #153 et #155) : le conteneur écoute sur `0.0.0.0` et toutes les routes protégées répondaient 403 ; puis les outils du MCP se rappelaient en `https` sur un serveur en clair. **Restent ouverts** : `TRACE` répond 500 au lieu de 405 (bénin) ; l'adresse publique du domicile est la même pour le poste et pour Atlas, donc un balayage de pièges depuis l'un bloque l'autre une heure sur l'atelier. Le pare-feu d'Atlas n'est pas modifié : Atlas initie, les réponses passent ; Alpha ne peut pas ouvrir de connexion vers Atlas.
- **Traefik** (`compose.alpha.yaml`) : `quran-tr.artist-dev.com` est le frontend. Les routes `/api/engine/*` sont **exclues du routeur public** et servies par un second routeur limité aux adresses du VPN (`10.78.0.0/30`). L'enregistrement DNS `quran-tr.artist-dev.com` doit pointer vers Alpha : non vérifié.

- Seul Traefik atteint l'atelier (réseau Docker `web`). Aucun port n'est publié.
- `AQR_TRUST_PROXY=1` : Traefik ajoute l'adresse du client à la fin de `X-Forwarded-For`, que l'atelier lit.
  Si un autre proxy (Cloudflare) se place devant Traefik, déclarer ses adresses côté Traefik.
- Le processus tourne en utilisateur `node` (non administrateur) dans un conteneur sans capacité Linux.
- L'accès `root` par SSH d'Alpha est celui des autres projets : je ne l'utilise qu'en lecture, sur accord.

## Sauvegardes

Quoi : la base, les sessions (audios, prédictions, décisions) et les avatars. Pas les journaux (leur
rétention propre : `docs/DIAGNOSTIC-PRODUCTION.md`).

- **Outil** : `node scripts/backup.mjs backup|verify|restore` (dans le conteneur). La base est copiée par
  `VACUUM INTO` (instantané cohérent même pendant les écritures), chaque fichier a une empreinte SHA-256,
  chaque table un nombre de lignes. Une sauvegarde altérée, incomplète ou avec un fichier en trop est
  refusée. La restauration n'écrase jamais un dossier non vide.
- **Règle 3-2-1** : 3 copies, 2 supports, 1 hors site. Copie 1 : `/data/backups` (14 dernières, même disque).
  Copie 2 : restic vers un second emplacement. Copie 3 : restic vers un stockage distant. Les dépôts restic
  sont chiffrés ; leur mot de passe est dans `/etc/aqr/restic.env`, et **une copie est conservée hors de la
  machine** : sans lui, les sauvegardes sont perdues. Alpha a déjà restic installé ; ses dépôts n'ont pas été lus.
- **Test de restauration** (à rejouer à chaque changement de procédure, et trimestriellement) :
  `docker exec atelier node scripts/backup.mjs verify /data/backups/aqr-<horodatage>` puis restauration dans un
  volume neuf (`rollback.sh --restore-db`), ouverture d'une session.

**Preuve au 2026-10-29** : `web/lib/backup.test.ts` (6 cas) restaure une vraie base SQLite en mode WAL avec des
écritures en cours, retrouve les mêmes lignes et les mêmes octets, et détecte une altération, un fichier
manquant, un fichier en trop et une base corrompue. Ligne de commande jouée sur des données de test.
**Pas encore fait** : une restauration depuis restic sur Alpha.

## Supervision

| Quoi | Comment |
|---|---|
| Disponibilité | monitor HTTP Uptime Kuma sur `https://<hôte>/api/health` (200 attendu ; 503 = base, disque sous la réserve, ou maintenance). La sonde ne révèle ni chemin, ni version, ni chiffre. |
| Espace disque | la sonde passe en 503 sous la réserve (`AQR_MIN_FREE_BYTES`, 1 Gio) ; ajouter un monitor Uptime Kuma « disque » de l'hôte avec une alerte à 80 %. |
| Mémoire et processeur | monitor de l'hôte (Uptime Kuma ou node exporter) ; alerte à 90 % durable. |
| Profondeur de file | `/api/queue` (compte connecté) et journal `queue` ; alerte sur une attente qui dépasse le délai de garde. |
| Erreurs récurrentes | `aqr-logreport.timer` chaque matin, poussé vers un monitor Uptime Kuma « push » (`AQR_PUSH_URL`). Une erreur qui revient depuis des jours le fait passer au rouge. |
| Journaux en direct | `docker logs atelier` et le dossier `/data/logs/` du volume ; Dozzle si présent sur Alpha. |

**Pas encore fait** : créer les monitors Uptime Kuma (aucun accès n'a été utilisé) et vérifier une alerte reçue.

## Arrêt d'urgence et maintenance

Sans redéploiement ni redémarrage, effet en moins de 2 secondes :

```bash
deploy/scripts/service-mode.sh restricted    # plus d'inscriptions, d'envois, d'analyses ni de direct ; lecture et connexion restent
deploy/scripts/service-mode.sh maintenance   # tout répond 503 avec une page claire, sauf /api/health
deploy/scripts/service-mode.sh normal        # lève les deux
```

C'est un fichier vide dans `<données>/control/` (`restricted` ou `maintenance`) ; `AQR_SERVICE_MODE` fixe le
mode au démarrage. Le plus strict l'emporte. **Preuve** : `web/lib/service-mode.test.ts` (17 cas) et un vrai
serveur de production : normal → 200 ; restreint → inscription et envoi en 503, lecture et connexion en 200 ;
maintenance → page en 503, sonde en 503 (« maintenance »), levé → 200.

## Retour arrière (moins de 15 minutes)

Principe : chaque version est une image `atelier:<sha>` ; le tag en service est noté dans `/opt/atelier/current`.

1. `deploy/scripts/release.sh <tag>` : sauvegarde, démarrage de l'image, attente de la santé du conteneur ; sans
   santé en 90 s, retour automatique.
2. Retour manuel : `deploy/scripts/rollback.sh` (relance l'image précédente et attend sa santé : 1 à 2 min).
3. **Si la version retirée avait appliqué une migration de base** (les migrations ne sont pas réversibles),
   restaurer d'abord la sauvegarde prise juste avant la bascule : `rollback.sh --restore-db aqr-<horodatage>`
   (restauration dans un volume neuf, l'ancien est conservé). Les données saisies depuis la bascule sont alors
   perdues : l'arbitrage appartient à Cherif Diouf.

**La procédure n'a jamais été jouée.** Elle doit l'être une fois sur Alpha (sous un nom d'hôte de test),
chronomètre en main, avant la mise en production (critère n° 5 de la section 17).

## Décisions qui appartiennent à Cherif Diouf

1. ~~Quelle machine~~ : **Alpha pour l'atelier, Atlas pour le moteur** (2026-10-29). L'agent est écrit ; reste à l'installer sur
   Atlas (environnement Python du moteur, poids des modèles copiés hors Git, jeton d'agent créé par un administrateur,
   vitesse sur processeur à mesurer). Le second WireGuard et les règles Traefik sont appliqués (2026-10-30).
2. ~~Nom d'hôte~~ : `quran-tr.artist-dev.com`. Reste : vérifier que le DNS pointe vers Alpha.
3. Inscriptions publiques : `open`, `code` ou `closed` (le script des testeurs garde `open` comme avant).
4. Liste complète des mots de passe divulgués (réseau sortant ou gros fichier local).
5. Mettre Node à jour sur le poste (24.22.2 recommandé) ; l'image d'Alpha en apporte un corrigé.
6. Autoriser le téléchargement des images Docker (Node pour construire l'atelier ; ZAP, testssl, Trivy, gitleaks pour les scans).
7. Alpha héberge Murabbi et SAP en production : accepter ce voisinage, ou prendre une machine dédiée.
