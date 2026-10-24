# Acceptance playbook — détection en direct, étape 3 (service WebSocket)

Service `aqr live-serve` et contrat `aqr.live/1` (`docs/LIVE-PROTOCOL.md`, ADR-0011 §6). Niveaux : U = unitaire
(sans réseau), I = intégration (vrai serveur WebSocket sur 127.0.0.1, vrai client, faux ASR), R = réel (vrai
modèle, vrai audio EveryAyah, marqué `slow`), M = mesure (`docs/evaluation/live-etape3-2026-10-24.md`), W =
atelier (`web/`, vitest). Surface : service réseau, aucun écran (l'écran « En direct » est l'étape 4).
Tous les jetons, comptes et clés des tests sont jetables ; aucune clé de production.

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu | Test |
|---|---|---|---|---|
| P1 | I | Flux complet : `START` -> `READY` -> audio -> `END` | `READY` (seq 0), événements de seq 1..n sans trou, `FINALIZING`, `FINAL` (document `aqr.recognition/1` relu par le lecteur du dépôt), fermeture 1000 | `test_live_service.py::test_a_full_stream…` |
| P2 | R | Vrai modèle, EveryAyah, client au plus vite ET à la vitesse de la voix | les messages reçus sont **identiques** à ceux du moteur appelé hors réseau ; aucun `DEGRADED` | `test_live_service_real.py` |
| P3 | I | Plusieurs flux à la fois | chacun reçoit ses propres événements, sessions distinctes | `test_several_streams_at_once…` |
| P4 | I+U | Jeton | usage unique, expiré refusé, falsifié refusé, lié au compte ; vecteurs communs Python / TypeScript | `test_live_tokens.py`, `test_live_hub.py`, `live-token.test.ts` |
| P5 | I | Origine et hôte | origine de l'atelier et client sans origine acceptés ; origine étrangère, `Host` réattribué (DNS rebinding), chemin inconnu refusés avant la poignée de main | `test_live_service.py`, `test_live_access.py` |
| P6 | I | Quotas | par compte et global (`server_busy` avec `retry_after_s`), place rendue à la fin d'un flux, connexions sans jeton bornées | `test_live_service.py`, `test_live_hub.py` |
| P7 | I | Reprise après coupure brutale | `READY{resumed}`, messages manqués rejoués dans l'ordre sans doublon ni trou, résultat final identique à un flux sans coupure | `test_a_cut_connection_resumes…` |
| P8 | I | Reprise refusée | autre compte, session inconnue, anneau insuffisant, session expirée (résultat rendu une fois) | `test_live_service.py` |
| P9 | I | Contre-pression | une rafale plus rapide que le moteur est freinée, rien n'est perdu, l'arriéré reste borné | `test_a_flood_faster…` |
| P10 | I | Retard visible | un bloc traité en retard produit `DEGRADED` (jamais un retard en silence) | `test_a_late_arrival…` |
| P11 | U | `PROGRESS`, clôture non nommée, `FINALIZING`, traduction commune, `GAP` dérivé du client | messages conformes à `docs/LIVE-PROTOCOL.md` ; un passage non nommé n'a ni texte ni traduction | `test_live_presenter.py`, `test_live_stream.py`, `test_live_progress.py` |
| P12 | I | Vie privée | ni jeton, ni audio, ni texte arabe dans le journal ; aucun fichier ouvert par un flux | `test_the_log_never_contains…`, `test_no_audio_is_kept…` |
| P13 | I | Arrêt propre | fermeture 1001 des flux en cours | `test_stopping_the_service…` |
| P14 | W | `POST /api/live/token` | jeton lié au compte, `technical` seulement si demandé, limite par compte, 503 si mal configuré | `live-session.test.ts` |
| P15 | M | Délai ajouté, flux tenus, mémoire, démarrage | chiffres mesurés avec leur méthode | rapport |

## MUST-FAIL (le service doit refuser sans planter)

| # | Niveau | Scénario | Comportement attendu | Test |
|---|---|---|---|---|
| F1 | I | Premier message : JSON illisible, `{}`, `END`, binaire, trop gros | `ERROR bad_message`, le service continue de servir | `test_a_bad_first_message…` |
| F2 | I | Mauvais schéma / format audio | `unsupported_schema`, `bad_audio_format` | idem |
| F3 | I | Jeton rejoué, expiré, falsifié, absent | `token_replayed`, `token_expired`, `token_invalid` | `test_live_service.py` |
| F4 | I | Origine étrangère, `Host` réattribué | `403` avant le WebSocket | idem |
| F5 | I | Bloc vide, de taille impaire, plus grand que la limite | `ERROR bad_audio_block` puis `FINAL` ; au-delà de la taille de trame, fermeture 1009 ; le service survit | idem |
| F6 | I | Flux plus long que le maximum / silence trop long | `stream_too_long`, `silence_too_long` puis `FINAL` | idem |
| F7 | I | Aucun `START`, aucune trame | `start_timeout`, `idle_timeout` (session reprenable) | idem |
| F8 | I | Second `START` en cours de flux | `bad_message` puis `FINAL` | idem |
| F9 | I | Compte au-dessus de son quota, service plein | `too_many_streams`, `server_busy` | idem |
| F10 | I | Reprise d'un autre compte | `session_expired` (même réponse qu'une session inconnue) | idem |
| F11 | I | Service dépassé trop longtemps | `server_busy` puis `FINAL` | `test_a_service_that_stays_overwhelmed…` |
| F12 | U | Clé de signature trop courte, fichier de clé vide, URL du direct mal formée | erreur claire, jamais de jeton | `test_live_tokens.py`, `live-token.test.ts` |
| F13 | U | Texte d'un candidat non nommé | jamais de texte ni de traduction (I3) | `test_live_presenter.py` |
