# Acceptance playbook — détection en direct, étape 4 (écran « En direct »)

Page `/direct` de l'atelier ([ADR-0011](../../docs/adr/0011-detection-en-direct-sans-plage.md), conception :
`docs/design/en-direct.md`, contrat : `docs/LIVE-PROTOCOL.md`). Niveaux : U = unitaire (vitest, sans navigateur ni réseau :
réducteur rejoué, client avec faux serveur et fausse horloge), N = navigateur réel (Chrome, build de production, micro simulé
par un fichier de récitation EveryAyah joué en temps réel, vrai service `aqr live-serve`, `web/e2e/live-browser.mjs`), M =
mesure (`docs/evaluation/live-etape4-2026-10-24.md`). Tous les comptes, jetons et clés sont jetables ; aucune voix de personne.
Deux playbooks seulement pour cette étape (celui-ci et l'étape 3, qui couvre le service) : les scénarios réels sont minimaux.

> Build : `feat/live-etape4` · Surface : `[WEB]` mobile 375 px d'abord, puis 1280 px, thèmes clair et sombre.
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail refusés proprement, aucun défilement horizontal, console propre.

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu | Preuve |
|---|---|---|---|---|
| P1 | N | Démarrer l'écoute sur une vraie récitation (`nominal`) | micro demandé au clic seulement, jeton, WebSocket, `READY`, puis candidats PUIS verset nommé avec traduction QuranEnc entière PENDANT la lecture | `live-browser.mjs nominal` + captures `*-candidats.png`, `*-nomme.png` |
| P2 | N+M | Délai voix → écran | mesuré par verset : candidats, nom sur l'écran, délai message → écran (quelques ms) | JSON du scénario, rapport |
| P3 | U | Un scénario de messages rejoué deux fois | même état (réducteur pur) ; `seq` déjà vu ignoré | `live-store.test.ts` |
| P4 | U | Candidats | le nombre, les mots communs du corpus, la piste seulement si le favori l'est par la position ; jamais le texte d'un candidat non nommé | `live-store.test.ts` |
| P5 | U+N | `LOCKED` recognized puis `PROGRESS` | arabe du corpus mot à mot, mots entendus en encre pleine, dernier mot souligné, « n / total mots entendus », `PROGRESS` ne recule jamais | `live-store.test.ts`, captures |
| P6 | U | `LOCKED` inferred | libellé « Déduit de la position », jamais « Reconnu » ; annonce « non reconnu à la voix » | `live-store.test.ts` |
| P7 | U | Passage clos non nommé, `LOST` | « Pas de verset nommé pour l'instant » (état normal), ligne sans texte ; `non_quran` : une ligne neutre hors du compteur | `live-store.test.ts` |
| P8 | U | `JUMP` suivant un passage non nommé | `GAP` dérivé : pas de ligne de saut, le trou se dit « entre 1:2 et 1:4 » ; autre genre de saut : ligne de séparation sans nom | `live-store.test.ts` |
| P9 | U | Patience | rien avant 6 s, puis une phrase à 6, 12 et 21 s depuis les premiers candidats ; seuils lus dans `LIVE_UI` | `live-store.test.ts` |
| P10 | N | Coupure réseau en plein verset (`cut`, relais qui coupe sans trame de fermeture) | bandeau « Connexion perdue… je garde le son », nouvel essai, `START{resume}` avec un NOUVEAU jeton, `READY resumed`, tout le son renvoyé, aucun message en double, aucun faux verset | `live-browser.mjs cut` + capture |
| P11 | U | Reprise | renvoi depuis `audio_received_samples` sans trou ni doublon ; tampon borné (5 min), trou comblé de silence et compté ; abandon après `resume_ttl_s` + marge | `live-client.test.ts` |
| P12 | N | Pause de 40 s (plus que le délai d'inactivité du service) | rien du micro n'est envoyé, la connexion survit (trames de silence de 20 ms par seconde), la reprise continue | `live-browser.mjs pause` |
| P13 | N | Service plein (`busy`) | « Le service d'écoute est complet », texte du service repris tel quel, nouvel essai automatique annoncé, aboutit quand une place se libère | `live-browser.mjs busy` + capture |
| P14 | N | Mode allégé et correction (messages injectés par le relais : le service ne les émet pas encore) | bandeau permanent « Mode allégé », puce, retard réel ; `REVISION` : la ligne reste, « Corrigé », texte retiré, bandeau 14 s | `live-browser.mjs inject` + captures |
| P15 | N | Mode technique | éteint par défaut ; la touche T l'allume ; `PARTIAL` seulement là, étiqueté « non vérifié », jamais annoncé | `live-browser.mjs tech` + capture |
| P16 | N | « Garder cet enregistrement » | le son vient de la mémoire du navigateur, part comme un import classique (`microphone`), la session apparaît en file d'analyse ; « Ne rien garder » annulable 6 s | `live-browser.mjs keep`, `live-net.test.ts` |
| P17 | N | 375 px et 1280 px, clair et sombre | aucun défilement horizontal, console ancrée en bas sur téléphone, cibles ≥ 44 px | captures, `npm run check:layout` |
| P18 | U | Libellés | « Déduit de la position » partout (légende, onde, passage, export) | `passage.test.ts`, `export-text` |

## MUST-FAIL (l'écran doit refuser ou expliquer, sans planter ni mentir)

| # | Niveau | Scénario | Comportement attendu | Preuve |
|---|---|---|---|---|
| F1 | N | Micro refusé par le navigateur (`deny`) | écran « Le micro est bloqué », cause, impact, quoi faire ; aucune connexion ouverte ; `role=alert` | `live-browser.mjs deny` |
| F2 | N | Aucun micro, micro occupé (`nomic`, `micbusy`, erreurs du navigateur simulées) | écrans dédiés, rien n'est parti | `live-browser.mjs nomic / micbusy` |
| F3 | N | Jeton expiré / déjà utilisé (`token`) | un seul nouvel essai automatique avec un jeton neuf, puis « laissez-passer refusé » en clair, sans code brut ; « Réessayer » démarre | `live-browser.mjs token` |
| F4 | U | Page non sécurisée (http hors localhost), navigateur sans AudioWorklet | écrans « interdit sur cette page », « navigateur incompatible » | `live-errors.test.ts` |
| F5 | U | Message du service illisible, de type inconnu, mal formé | écarté, jamais deviné ; le flux continue | `live-protocol.test.ts`, `live-client.test.ts` |
| F6 | U | `REVISION` | ne supprime jamais une ligne, retire le texte (I3) | `live-store.test.ts` |
| F7 | U | `FINAL` qui n'arrive pas, coupure trop longue | fin locale qui le dit, ce qui était entendu reste gardable | `live-client.test.ts`, `live-store-end.test.ts` |
| F8 | U | Texte d'erreur | cause, impact, quoi faire ; jamais un nom de variable ni un code brut | `live-errors.test.ts` |
| F9 | N | Quitter la page en écoute / avec un son non gardé | avertissement standard du navigateur ; fermeture propre du flux | revue du code (`use-live.ts`) ; non automatisable en headless |
