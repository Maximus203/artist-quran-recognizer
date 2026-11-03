# ADR-0016 — Confirmation du direct par le moteur du lot

- Statut : **accepté** — piste choisie par le mainteneur le 2026-10-29 (« piste 1 »).
- Précise : ADR-0011 (détection en direct), dont elle ne retire rien : le suivi rapide reste la première lecture ;
  le moteur du lot la **confirme** passage par passage. Complète ADR-0015 (récitation guidée), qui reste indépendante.

## Contexte

Sur des enregistrements faits au micro dans l'atelier, le direct (ADR-0011) rate beaucoup de versets que le lot
(ADR-0004 à 0010) retrouve sur le **même** audio. Mesuré le 2026-10-29 (`scripts/measure_live_vs_batch.py`, référence =
`prediction.recognition.json` du lot) :

| Session (micro) | Versets du lot | Retrouvés par le direct seul | En trop |
|---|---|---|---|
| Al-Baqara 2:208-213, 100 s | 6 | 4 | 0 |
| Al-Fatiha répétée puis Al-Baqara, 456 s | 22 | 11 | 0 |

Le direct ne se trompe pas (zéro verset en trop, I3) : son défaut est le **rappel**. La cause n'est pas la recherche
mais l'entrée : un modèle léger lit des fenêtres d'environ 1,1 s sans voir la suite, alors que le lot voit un passage
entier, le segmente, le réécoute avec d'autres modèles (cascade, ADR-0009) et vérifie l'audio (ADR-0008). Régler les
seuils du suivi ne rend pas des mots que le modèle n'entend pas.

## Décision

- **Deux temps.** Le suivi du direct répond tout de suite (inchangé). En parallèle, le flux est découpé aux **pauses** de
  la récitation (`PauseCutter` : silence d'au moins 0,8 s après au moins 6 s de passage, coupe forcée à 25 s, un passage
  sans assez de voix est ignoré). Chaque passage clos est confié au **moteur du lot** (`RecognitionPipeline.run_clip`,
  cascade + vérification acoustique), sur **un fil unique** pour tout le service.
- **Message `CONFIRMED`** (`aqr.live/1`, additif) : les versets `recognized` / `inferred` du passage, au contrat du lot,
  datés dans le temps du flux, avec le texte du corpus (I1) et la traduction QuranEnc entière (I2). Un passage resté
  ambigu n'est **jamais** confirmé (I3, I5). Un client qui ne connaît pas le type l'ignore.
- **Écran.** Un verset confirmé remplace la ligne du direct de même verset qui se recoupe dans le temps (étiquette
  « Confirmé »), ou s'insère à sa place dans le temps ; un « passage non nommé » qu'il éclaire disparaît. Le lot ne prouve
  jamais qu'une ligne du direct est fausse : aucune autre ligne n'est touchée.
- **Audio.** Le passage n'existe en mémoire que le temps de sa confirmation ; rien n'est écrit sur disque (ADR-0011 §4).
- **Dégradation sûre.** Le moteur du lot est **préchauffé au démarrage** du service (le premier appel à froid coûtait
  des dizaines de secondes). Quand 2 passages sont déjà en file, le suivant est traité **sans réécoute** par les moteurs
  secondaires (`relisten=False` : plus rapide, un peu moins de versets sauvés). Au plus 4 passages en attente par flux ;
  au-delà, le suivant n'est pas confirmé (`confirm.skipped` au journal). Une erreur du lot (`confirm.failed`) ou une attente de fin dépassée (45 s, `confirm.timeout`) ne coupe
  jamais le flux. `aqr live-serve --no-confirm` démarre sans le moteur du lot.
- **Document final.** Inchangé : il garde ce que le direct a décidé. La référence reste le lot (analyse du fichier
  enregistré) ; intégrer les confirmations au document final est une suite possible.

## Mesure (vrai moteur, `scripts/measure_live_vs_batch.py`)

| Session | Direct seul | Avec confirmation | En trop |
|---|---|---|---|
| Al-Baqara 2:208-213, 100 s | 4 sur 6 | **6 sur 6** | 0 |
| Al-Fatiha répétée puis Al-Baqara, 456 s, **temps réel** | 11 sur 22 | **21 sur 22** (reste 1:1) | 0 |

Délai entre la fin d'un passage et sa confirmation, en temps réel : 3 à 16 s, typiquement 7 à 10 s (29 passages sur la
session longue, aucun ignoré). Sans mode rapide, un passage difficile avait bloqué la file : 18 sur 22, des confirmations
à 140-190 s et 11 passages ignorés ; sans préchauffage, la première confirmation arrivait plus de 60 s après son passage.
Le premier verset (1:1, basmala) manque encore.

## Limites et suite

- Deux sessions seulement, une seule voix : les valeurs de coupe (0,8 s, 6 s, 25 s) sont des points de départ.
- La confirmation arrive après la fin du passage, pas pendant : le direct reste la seule lecture « en cours ».
- Le moteur du lot pèse en mémoire et au démarrage du service ; un service très chargé saute des confirmations.
- Piste suivante, non traitée : intégrer les confirmations au document `FINAL` ; modèle de flux plus fort (piste 2).
