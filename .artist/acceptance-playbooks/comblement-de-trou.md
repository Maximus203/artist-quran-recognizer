# Acceptance playbook — comblement de trou entre deux versets reconnus (revue lot3-04)

Moteur (ADR-0013). Un scénario est validé par un test automatisé ou une mesure chiffrée, jamais à l'œil.
Niveaux : U = unitaire (pur), I = intégration (pipeline, corpus réel, audio factice), M = mesure sur audio réel
(`docs/evaluation/comblement-de-trou-2026-10-23.md`). Surface : moteur seul (aucun écran) ; champs de sortie additifs.

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu | Test |
|---|---|---|---|---|
| P1 | U | `uncertain` membre d'une suite acceptée par l'audio (1:1 [2-4], 1:2 [1-4] dans 1:1-1:5) | `recognized`, `promoted_by: "chain"`, plus de candidats | `test_chain_members.py` |
| P2 | U | Début manquant du verset reconnu (12:21 [13-23] : il manque [1-12]), verset précédent fini | hypothèse `between` = 12:21 [1-12] entier | `test_gaps.py` |
| P3 | U | Reste d'un verset dont le début est reconnu (17:74 [1-1], puis 17:75) | hypothèses `between` = 17:74 [2-n], départs jusqu'à 3 mots en arrière | `test_gaps.py` |
| P4 | U | Verset reconnu puis rien (17:76 fini) | hypothèse `repetition` : verset entier, plage reconnue, fins de 3 et 6 mots (seulement celles déjà reconnues) | `test_gaps.py` |
| P5 | U | Preuve mesurée sur la seule parole alignée | un mauvais texte dilué dans 60 s de blancs est refusé (`llr_per_frame` < seuil) alors que la preuve du passage entier le laisserait passer | `test_gap_verification.py`, `test_forced_alignment.py` |
| P6 | U | Audio fort (llr ≥ −0,5) et transcription pauvre (0,3 ≤ similarité < 0,6) | accepté ; en dessous de 0,3, refusé | `test_gap_verification.py` |
| P7 | U | Variantes compatibles d'un texte (reprise, fin seule) | gagne celle qui explique le plus de parole (preuve totale), pas la meilleure moyenne par trame | `test_gap_verification.py` |
| P8 | U | Un mot au bord du verset dit dans la fenêtre mais absent du texte (2:87 mot 13) | `extension` : plage étendue, temps au mot recalés sans chevauchement | `test_gap_extension.py` |
| P9 | I | Milieu manquant d'un verset (67:3 [6-13]), ASR pauvre | un seul passage 67:3 [1-18] `recognized`, `promoted_by: "gap"`, 18 temps au mot, abstention retirée | `test_pipeline.py::test_le_milieu_manquant…` |
| P10 | I | Verset redit en entier dans une fenêtre abstenue | détection `repetition: true`, `promoted_by: "gap"` | `test_pipeline.py::test_la_repetition…` |
| P11 | U | Détections ajoutées au décodage | à leur place dans le temps ; moitiés fusionnées seulement si aucun mot ne manque entre elles | `test_viterbi_decoder_pur.py` |
| P12 | M | Revue lot3-04 (5 signalements) | les cinq cas corrigés sauf le mot « بسم » (cas 1), voir le rapport | description de la PR |
| P13 | M | 6 lot3, lot1-05, lot1-06, lot2-04 | **0** verset de référence perdu ; versets gagnés listés avec leur preuve | description de la PR |

## MUST-FAIL (le système doit refuser)

| # | Niveau | Scénario | Comportement attendu | Test |
|---|---|---|---|---|
| F1 | U/I | Le trou contient autre chose que le texte déduit | aucun verset nommé, l'abstention reste (I3) | `test_gap_verification.py`, `test_pipeline.py` |
| F2 | U | Trou muet (le modèle n'émet rien) | pas même une trace | `test_gap_verification.py` |
| F3 | U | Aucune transcription : texte de plus de 3 mots | refusé (l'audio seul ne suffit pas) | `test_gap_verification.py` |
| F4 | U | Répétition de moins de 3 mots | refusée | `test_gap_verification.py` |
| F5 | U | Reprise de mots qui n'atteint aucun mot nouveau | refusée (ce serait ré-attribuer la queue d'un verset déjà nommé) | `test_gap_verification.py` |
| F6 | U | Concurrent mieux expliqué de 3 nats ou plus ; deux textes différents à moins de 3 nats | refusé / ambigu, rien n'est nommé | `test_gap_verification.py` |
| F7 | U | Mot sans soutien (sous −3 par trame) dans un texte court | refusé ; toléré dans un long texte (15 % des mots) | `test_gap_verification.py` |
| F8 | U | Deux suites acceptées sur le même temps avec des plages différentes | aucun `uncertain` promu | `test_chain_members.py` |
| F9 | U | Voisin `uncertain`, non coranique ou `inferred` | ferme le trou sans le contextualiser | `test_gaps.py` |
| F10 | U | Extension : mot non dit, gain insuffisant, voisin atteint, verset fini ou commençant au mot 1 | aucune extension, aucun treillis calculé quand il n'y a rien à ajouter | `test_gap_extension.py` |
| F11 | I | Fichier sans Coran | **0** verset (aucune ancre, aucun trou) | `test_pipeline.py` |
| F12 | M | lot2-11, lot2-12 (sans Coran), EveryAyah | **0** verset ajouté, rappel inchangé | description de la PR |
