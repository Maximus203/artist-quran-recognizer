# ADR-0017 — Moteur d'analyse à distance (l'agent appelle l'atelier)

- Statut : **accepté** — plan validé par le mainteneur le 2026-10-29 (« Oui, ce plan »), puis précisé le même jour (voir « Précision du 2026-10-29 » : l'agent tourne sur Atlas, relié à Alpha par un second WireGuard).
- Précise : `docs/INFRASTRUCTURE.md` (Alpha héberge l'atelier seul). Ne change ni le contrat de sortie ni les
  invariants I1 à I5 : le moteur reste le même, seul l'endroit où il tourne change.

## Contexte

Le serveur cible (Alpha) n'a pas de GPU et héberge d'autres projets en production. L'atelier lance aujourd'hui le
moteur lui-même, comme un processus local (`aqr worker`, `web/lib/jobs.ts`). Le moteur doit donc tourner sur le
poste du mainteneur, qui est derrière une box : **aucune connexion entrante** n'est acceptable (ni port ouvert,
ni tunnel à adresse changeante), et le poste dort ou redémarre.

## Décision

- **L'agent appelle l'atelier.** Un agent (`aqr engine-agent`, sur le poste GPU) interroge l'atelier en HTTPS
  sortant : il réclame un job, télécharge l'audio, exécute le moteur existant, dépose le résultat.
- **Une seule couture dans l'atelier** : `startEngine` rend déjà un `JobProcess`. Un moteur distant est un autre
  `JobProcess` (`AQR_ENGINE=remote`) ; la file équitable, le watchdog, l'annulation, la reprise après
  redémarrage et le traitement du résultat (`source.recognition.json`, empreinte de l'audio) ne changent pas.
- **Bail à durée limitée.** Un job réclamé est prêté à un agent (`AQR_ENGINE_LEASE_S`, 90 s par défaut) ; un signal
  de vie le prolonge. Sans signal, le job échoue **explicitement** (« le moteur distant a cessé de répondre »),
  jamais en silence. L'annulation d'un utilisateur est transmise à l'agent par la réponse au signal de vie.
- **Aucun moteur en ligne : les envois restent acceptés** et attendent en file ; l'interface le dit
  (« moteur hors ligne depuis … »). Le délai de garde existant borne l'attente.
- **Sécurité.**
  - Jeton d'agent `qea_` + 256 bits, **distinct des jetons d'utilisateurs** ; seule l'empreinte SHA-256 est
    stockée ; créé et révoqué par un administrateur ; le jeton clair n'est montré qu'une fois.
  - Un agent ne voit que le job qu'il a réclamé : numéro de bail aléatoire de 128 bits, lié à l'agent.
  - Le résultat est **un seul fichier** (`source.recognition.json`), validé par le contrat de sortie
    (`parseRecognition`) et par l'empreinte de l'audio ; taille plafonnée ; aucun nom de fichier ne vient de
    l'agent (pas de traversée de chemin possible).
  - Les routes `/api/engine/*` forment une famille de débit à part ; elles n'acceptent ni cookie de connexion ni
    jeton d'utilisateur, et un jeton d'agent n'ouvre aucune autre route.
  - L'agent supprime l'audio local à la fin de chaque job (vie privée).
- **Hors de ce lot (au moment de l'ADR)** : l'agent Python (phase 2, livré le 2026-10-30, voir plus bas), l'affichage « moteur hors ligne » et la sonde (phase 4), les exports
  ZIP et vidéo à distance, le direct (service d'écoute par tunnel nommé, phase 5).

## Conséquences

- Tant que l'agent n'est pas écrit, `AQR_ENGINE=remote` met les analyses en attente : ne pas l'activer sur Alpha avant
  la phase 2.
- L'audio quitte le poste pour Alpha (serveur public) : déjà le cas avec l'atelier de test ; à valider.
- L'état des baux est en mémoire : un redémarrage de l'atelier fait perdre les baux en cours ; l'agent reçoit
  « bail inconnu », abandonne, et la reprise de file existante remet la session en attente.

## Alternatives écartées

- **L'atelier appelle le poste (VPN ou tunnel)** : exige une connexion entrante vers le domicile ou un tunnel à
  adresse stable, et échoue quand le poste dort.
- **Moteur sur Alpha, sur CPU** : trop lent et concurrence les projets voisins pour 15 Gio de mémoire.

## Précision du 2026-10-29 : l'agent tourne sur Atlas, relié à Alpha par un second WireGuard

Instruction du mainteneur : le moteur est lancé **sur Atlas** (serveur toujours allumé, au lieu du poste), et un
**second WireGuard** relie Atlas à Alpha pour qu'Alpha « voie » Atlas.

- **Le protocole ne change pas** : l'agent reste le client (il appelle Alpha), donc rien n'est ouvert chez Atlas, qui est
  derrière une box. Le WireGuard apporte la **confidentialité du transport** et permet de **fermer les routes du moteur au
  public** : `/api/engine/*` n'est joignable que depuis le réseau du VPN (Traefik : règle de chemin + liste d'adresses
  autorisées), en plus du jeton d'agent.
- **Réserve notée avant exécution** : Atlas n'a **pas de GPU** (ThinkCentre i7-14700T, 15 Gio, `artist-atlas`, socle). Le
  moteur y tournera sur processeur : sa vitesse et sa mémoire sont **à mesurer** (lancer `aqr recognize` et lire `timing`, voir « Mesures sur Atlas ») avant de
  promettre un délai. Le modèle d'agents permet d'ajouter plus tard un agent sur un poste à GPU, sans toucher à l'atelier.
- Hors de ce lot : l'agent Python et son installation sur Atlas (phase 2), la mise en place du VPN et des règles Traefik
  sur Alpha (préparées dans `deploy/`, **non appliquées** : elles touchent un serveur qui héberge d'autres projets).

## Phase 2 livrée le 2026-10-30 : `aqr engine-agent`

Module `src/aqr/app/engine_agent.py`, commande `aqr engine-agent [--once]`, configuré par l'environnement
(`AQR_ENGINE_URL`, `AQR_ENGINE_TOKEN` ou `AQR_ENGINE_TOKEN_FILE`, `AQR_ENGINE_WORK_DIR`, `AQR_MODELS_DIR`…). Sans dépendance
nouvelle (bibliothèque standard).

- **Même moteur, même ligne de commande** : l'agent lance `python -m aqr.cli recognize … --format json`, comme l'atelier
  (`web/lib/python.ts`). Rien du moteur n'est dupliqué.
- **Vérifié avant de lancer** : numéro de bail, moteur parmi `ASR_CHOICES` (jamais passé tel quel à la ligne de commande),
  chemin de l'audio égal à `/api/engine/leases/<bail>/audio`, taille bornée, empreinte SHA-256 de l'audio reçu.
- **Jamais de fuite du jeton** : redirections non suivies, jamais journalisé, refus d'un jeton d'utilisateur (`qtr_`) et d'un
  `http` hors boucle locale. Un jeton refusé arrête l'agent (code de sortie 3, message demandant un nouveau jeton) ;
  une panne de l'atelier ne l'arrête pas (attente exponentielle de 1 à 60 s avec aléa).
- **Vie privée** : l'audio et le résultat sont supprimés du disque local à la fin de chaque analyse, succès ou non.
- **Preuves** : 51 tests unitaires (faux atelier reproduisant le contrat, atelier malveillant ou défaillant : durée de bail
  illisible, champ audio mal formé, exception du moteur) et un scénario de bout en bout contre le **vrai**
  atelier (courtier TypeScript) : analyse nominale terminée par l'atelier, échec du moteur avec son message visible côté
  atelier, annulation apprise au signal de vie, révocation du jeton. Non éprouvé : le vrai moteur (modèles) sur Atlas.

## Mesures sur Atlas, processeur seul (2026-10-30)

Environnement installé dans `/opt/aqr` (torch 2.11.0 en version processeur, NeMo 3.0.0, 2,2 Go) ; poids vérifiés par
empreinte (`scripts/fetch_models.py`, 3,0 Go) et corpus Tanzil (6 236 versets). Le modèle Muno, à accès restreint sur
Hugging Face, a été copié depuis le poste et vérifié par le même verrou. Moteur `cascade`, audio de récitations publiques
(EveryAyah), machine au repos, priorité normale, 28 threads :

| Audio | Durée de calcul | Mémoire max | Résultat |
|---|---|---|---|
| 1 verset (4,4 s) | 17 s (dont ~13 s de chargement des modèles) | 4,0 Go | 1 fenêtre |
| Al-Fatiha (41,8 s) | 22 s | 4,0 Go | 7 versets sur 7 reconnus, 0 avertissement |
| 73 versets (716 s) | 180 s, soit 4 fois plus vite que l'audio | 5,6 Go | 73 versets reconnus, 0 avertissement |

- **Conséquences.** Le processeur d'Atlas suffit : l'analyse va plus vite que l'audio. Un coût fixe d'environ 13 s
  (chargement des modèles) s'ajoute à chaque analyse, car l'agent lance un processus par analyse. Le segmenteur domine
  (116 s sur 175 s pour 716 s d'audio).
- **Impact sur le serveur.** Pendant l'analyse longue, la charge d'Atlas est montée vers 16 sur 28 threads et la mémoire
  disponible est descendue vers 7,5 Go. L'unité d'exemple borne donc l'agent (`Nice`, `CPUQuota`, `MemoryMax`).
- **Limites de la mesure.** Récitations propres d'un seul lecteur, pas de bruit ; extrapolation à plusieurs heures non
  vérifiée ; le passage par l'atelier (téléchargement et dépôt par le VPN) n'est pas inclus.

## Modèles gardés en mémoire (2026-10-30)

L'agent lance par défaut un seul `aqr worker` (protocole d'`aqr.app.worker` : une ligne JSON par requête) au lieu d'un
`aqr recognize` par analyse. Mesure sur un enregistrement réel de 2,6 Mo, poste à GPU : 52 s à la demande, 29 à 33 s
une fois chaud. Le service est arrêté après `AQR_ENGINE_WARM_IDLE_S` (600 s par défaut) sans analyse ; annulation ou
panne : il est arrêté et relancé à la suivante. `AQR_ENGINE_WARM=0` rétablit le processus par analyse.
