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
- **Hors de ce lot** : l'agent Python (phase 2), l'affichage « moteur hors ligne » et la sonde (phase 4), les exports
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
  moteur y tournera sur processeur : sa vitesse et sa mémoire sont **à mesurer** (`scripts/measure_speed.py`) avant de
  promettre un délai. Le modèle d'agents permet d'ajouter plus tard un agent sur un poste à GPU, sans toucher à l'atelier.
- Hors de ce lot : l'agent Python et son installation sur Atlas (phase 2), la mise en place du VPN et des règles Traefik
  sur Alpha (préparées dans `deploy/`, **non appliquées** : elles touchent un serveur qui héberge d'autres projets).
