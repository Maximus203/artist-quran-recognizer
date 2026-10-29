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

## Serveur cible : à décider (bloquant)

Le « serveur alpha » n'apparaît dans aucun fichier du dépôt. Aucune machine n'est donc ciblée. Trois
contraintes orientent le choix :

1. **Le moteur d'analyse demande un GPU** et des modèles de plusieurs Gio (`AQR_MODELS_DIR`) ; le service
   du direct aussi (`aqr live-serve`).
2. **L'atelier lui-même est léger** (Node, SQLite, ffmpeg) et peut tourner sans GPU si le moteur est joint
   ailleurs. Aujourd'hui le moteur est lancé par l'atelier sur la même machine (`aqr worker`) ; les séparer
   serait un chantier de code, pas d'infrastructure.
3. **L'hôte doit tenir la charge mesurée** : les plafonds de flux du direct (section 12) ne se fixent que par
   une mesure sur la machine cible (`scripts/measure_live_service.py`).

**Recommandation** : une machine Linux unique avec GPU, atelier et moteur ensemble, installés sur l'hôte
(unités systemd de `deploy/systemd/`), pas dans des conteneurs. Raison : l'accès GPU, les modèles et le
worker chaud rendent une image lourde et fragile pour un seul hôte, alors que systemd donne déjà
l'utilisateur dédié, le durcissement, le redémarrage et les journaux. Trivy s'applique alors au système de
fichiers de la version (`trivy fs`) plutôt qu'à une image. À reconsidérer si l'atelier passe sur une
machine sans GPU et le moteur ailleurs.

## Schéma

```
Internet ─ 80/443 ─▶ Caddy (TLS, corps max, en-têtes) ─▶ 127.0.0.1:3000  atelier (Next.js)
                                                      └▶ 127.0.0.1:8765  direct (WebSocket, /live)
                                   atelier ──▶ aqr worker (Python, GPU) ; ffmpeg
                                   données : /var/lib/aqr   sauvegardes : /var/backups/aqr
```

L'atelier et le direct n'écoutent **que** sur 127.0.0.1 : ils ne sont joignables que par le proxy.

## Modèles fournis (`deploy/`)

| Fichier | Rôle | Validé |
|---|---|---|
| `caddy/Caddyfile.example` | TLS automatique, corps maximal 2100 Mo, retrait de `Server`, chemin `/live`, sonde `/api/health` | non (à valider sur l'hôte : `caddy validate`) |
| `systemd/aqr-atelier.service` | utilisateur `aqr`, écriture limitée à `/var/lib/aqr`, durcissement, 3 essais puis échec visible | non (à valider : `systemd-analyze verify`) |
| `systemd/aqr-live.service` | service du direct | non |
| `systemd/aqr-backup.{service,timer}` | sauvegarde quotidienne 03 h 30 puis copie restic | script de sauvegarde **oui**, unité non |
| `systemd/aqr-logreport.{service,timer}` | rapport quotidien 07 h, poussé vers Uptime Kuma | script **oui** (sans poussée réelle), unité non |
| `scripts/firewall.sh` | règles ufw ; n'applique rien sans `--apply` | syntaxe et affichage oui |
| `scripts/service-mode.sh` | arrêt d'urgence (voir plus bas) | **oui**, sur un vrai serveur |
| `scripts/release.sh`, `rollback.sh` | bascule et retour arrière | syntaxe seulement ; **jamais joués** |

## Réseau et pare-feu

- Ouverts sur Internet : **80 et 443 seulement**. Tout le reste fermé (3000 et 8765 ne le sont jamais).
- SSH : jamais ouvert à tout Internet. `scripts/firewall.sh --ssh-from <réseau>` l'ouvre vers un réseau privé
  seulement (VPN, Tailscale). Configuration `sshd` : `PasswordAuthentication no`, `PermitRootLogin no`,
  `AllowUsers <compte d'administration>`, clé uniquement.
- Garder une console (hors SSH) avant d'activer `ufw` : une règle fautive coupe la session.

## Mises à jour du système

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # correctifs de sécurité seulement
```

Redémarrage automatique du noyau exclu pendant les heures d'usage ; Node reste épinglé à une ligne corrigée
(`docs/SECURITE-DEPENDANCES.md`), et le serveur refuse de démarrer sur une version touchée.

## Utilisateur dédié

```bash
sudo useradd --system --home /var/lib/aqr --shell /usr/sbin/nologin aqr
sudo install -d -o aqr -g aqr -m 0750 /var/lib/aqr /var/backups/aqr
sudo install -d -o root -g aqr -m 0750 /etc/aqr   # atelier.env, live.env, restic.env : root:aqr, mode 0640 ou 0600
```

Le service n'a aucun droit d'administration, ne peut écrire que dans `/var/lib/aqr`, et ne voit ni `/home` ni
le reste du système (`ProtectSystem=strict`, `ProtectHome=true`).

## Sauvegardes

Quoi : la base, les sessions (audios, prédictions, décisions) et les avatars. Pas les journaux (leur
rétention propre : `docs/DIAGNOSTIC-PRODUCTION.md`).

- **Outil** : `node web/scripts/backup.mjs backup|verify|restore`. La base est copiée par `VACUUM INTO`
  (instantané cohérent même pendant les écritures), chaque fichier a une empreinte SHA-256, chaque table
  un nombre de lignes. Une sauvegarde altérée, incomplète ou avec un fichier en trop est refusée. La
  restauration n'écrase jamais un dossier non vide.
- **Règle 3-2-1** : 3 copies, 2 supports, 1 hors site. Copie 1 : `/var/backups/aqr` (14 dernières).
  Copie 2 : restic vers un second disque. Copie 3 : restic vers un stockage distant (par exemple le dépôt
  B2 de la flotte). Les dépôts restic sont chiffrés ; leur mot de passe est dans `/etc/aqr/restic.env`, et
  **une copie du mot de passe est conservée hors de la machine** : sans lui, les sauvegardes sont perdues.
- **Test de restauration** (à rejouer à chaque changement de procédure, et trimestriellement) :
  ```bash
  node web/scripts/backup.mjs verify /var/backups/aqr/aqr-<horodatage>
  node web/scripts/backup.mjs restore /var/backups/aqr/aqr-<horodatage> --target /tmp/essai-restauration
  ```
  puis ouvrir l'atelier sur `/tmp/essai-restauration` (`AQR_REVIEW_DIR`) et lire une session.

**Preuve au 2026-10-29** : `web/lib/backup.test.ts` (6 cas) restaure une vraie base SQLite en mode WAL avec des
écritures en cours, retrouve les mêmes lignes et les mêmes octets, et détecte une altération, un fichier
manquant, un fichier en trop et une base corrompue. Lancé en ligne de commande sur des données de test :
sauvegarde, vérification, restauration (code 0), refus d'une cible non vide (code 1), refus d'une sauvegarde
altérée (code 1). **Pas encore fait** : une restauration depuis restic sur la machine cible.

## Supervision

| Quoi | Comment |
|---|---|
| Disponibilité | monitor HTTP Uptime Kuma sur `https://<hôte>/api/health` (200 attendu ; 503 = base, disque sous la réserve, ou maintenance). La sonde ne révèle ni chemin, ni version, ni chiffre. |
| Espace disque | la sonde passe en 503 sous la réserve (`AQR_MIN_FREE_BYTES`, 1 Gio) ; ajouter un monitor Uptime Kuma « disque » de l'hôte avec une alerte à 80 %. |
| Mémoire et processeur | monitor de l'hôte (Uptime Kuma ou node exporter) ; alerte à 90 % durable. |
| Profondeur de file | `/api/queue` (compte connecté) et journal `queue` ; alerte sur une attente qui dépasse le délai de garde. |
| Erreurs récurrentes | `aqr-logreport.timer` chaque matin, poussé vers un monitor Uptime Kuma « push » (`AQR_PUSH_URL`). Une erreur qui revient depuis des jours le fait passer au rouge. |
| Journaux en direct | Dozzle pour les conteneurs de la flotte ; pour l'hôte, `journalctl -u aqr-atelier` et le dossier `logs/`. |

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

Principe : chaque version vit dans `/opt/aqr/releases/<sha>/`, `current` pointe sur la version en service.

1. `deploy/scripts/release.sh <sha>` : sauvegarde, construction à côté, bascule, contrôle de la sonde ; si elle
   ne passe pas en 60 s, retour automatique.
2. Retour manuel : `deploy/scripts/rollback.sh` (repointe `current`, redémarre, contrôle la sonde : 2 à 3 min).
3. **Si la version retirée avait appliqué une migration de base** (les migrations ne sont pas réversibles),
   restaurer d'abord la sauvegarde prise juste avant la bascule :
   `rollback.sh --restore-db /var/backups/aqr/aqr-<horodatage>`. Les données saisies depuis la bascule sont
   alors perdues : l'arbitrage appartient à Cherif Diouf, la sauvegarde `avant-retour` est conservée.

**La procédure n'a jamais été jouée** (aucune machine cible). Elle doit l'être une fois sur l'environnement de
test, chronomètre en main, avant la mise en production (critère n° 5 de la section 17).

## Décisions qui appartiennent à Cherif Diouf

1. Quelle machine sert de serveur cible (et où tourne le moteur GPU).
2. Inscriptions publiques : `open`, `code` ou `closed` (le script des testeurs garde `open` comme avant).
3. Liste complète des mots de passe divulgués (réseau sortant ou gros fichier local).
4. Mettre Node à jour sur le poste (24.22.2 recommandé) : tant que ce n'est pas fait, le serveur de production
   refuse de démarrer sur ce poste.
5. Autoriser le téléchargement des images Docker des scans (ZAP, testssl, Trivy, gitleaks).
