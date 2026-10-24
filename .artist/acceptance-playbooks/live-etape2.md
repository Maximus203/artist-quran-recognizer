# Acceptance playbook — détection en direct, étape 2 (moteur incrémental)

Moteur (ADR-0011 §5 et §7). Un scénario est validé par un test automatisé ou une mesure chiffrée, jamais à
l'œil. Niveaux : U = unitaire (doublures, sans modèle), C = contrat (`tests/contract/`, vrai modèle
marqué `slow`), M = mesure sur audio (`docs/evaluation/live-etape2-2026-10-24.md`). Surface : moteur seul
(aucun écran, aucun service réseau). Le modèle `muno-fastconformer-quran-streaming` est déjà dans
`AQR_MODELS_DIR` ; rien n'est téléchargé.

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu | Test |
|---|---|---|---|---|
| P1 | U | Les trames mel calculées au fil de l'eau | identiques à celles du fichier entier, quelle que soit la taille des blocs (20 ms à 3 s) | `test_muno_incremental.py::test_the_chunks_equal_the_offline_features…` |
| P2 | U | Un morceau n'est calculé que quand sa dernière fenêtre est complète | 96 échantillons d'avance, pas un de moins | `test_muno_incremental.py` |
| P3 | U | Les caches du modèle d'un morceau au suivant | le morceau *n* reçoit exactement ce que le morceau *n-1* a rendu ; deux flux ne partagent rien | `test_muno_incremental.py` |
| P4 | U | Temps d'un mot = morceau x 1,12 s + trame x 0,08 s | valeurs exactes | `test_muno_incremental.py` |
| P5 | U | Mot stable seulement quand un autre commence ou après `settle_s` ; texte provisoire à part | livraison au bon morceau ; `finish` livre tout | `test_muno_incremental.py` |
| P6 | C | Contrat `StreamingAsr` (fake et Muno réel) | mots bien formés, indépendants de la taille de bloc, jamais repris, silence = aucun mot, sessions indépendantes, `finish` final | `test_streaming_asr_contract.py` |
| P7 | C | Muno incrémental contre l'adaptateur hors ligne, 3 récitants | mêmes mots, mêmes temps (0,01 s au début, 0,09 s à la fin) | `test_muno_incremental_parity.py` |
| P8 | U | Pipeline : blocs -> ASR -> suivi | mêmes `Candidates`/`Locked`/`Continue` que le rejeu par lots sur les mêmes mots ; chaque événement porte l'heure de sa sortie | `test_live_pipeline.py` |
| P9 | U | Retard : calcul plus lent que le temps réel | `DegradationChanged` annoncé, retard borné par la mesure, jamais silencieux ; retour à la normale dit | `test_live_pipeline.py`, `test_live_drive.py` |
| P10 | U | Palier sauté ou surcharge : la règle de verrou monte | plus de mots et posterior plus haut ; jamais sous la base ; un verrou déjà émis n'est pas retiré | `test_live_budget.py`, `test_live_tracker_hardening.py` |
| P11 | U | Contrôle branché (palier 2 ou 3) | s'exécute seulement au palier permis, sur l'audio du verset ; son refus devient `Revision` visible | `test_live_pipeline.py` |
| P12 | U | Rejeu simulé et en vitesse réelle | mêmes événements ; le réel dort jusqu'à l'heure de chaque bloc et ne dort pas quand il est en retard | `test_live_drive.py` |
| P13 | M | 91 entrées du banc de l'étape 1 avec le vrai modèle | **0 faux verrou**, facteur temps réel, retard, latences bout en bout, mémoire : rapport | `scripts/measure_live_engine.py` |
| P14 | M | Rejeu en vitesse réelle (150 s) contre le simulé | mêmes événements, écart d'horodatage mesuré | rapport |

## MUST-FAIL (le système doit refuser)

| # | Niveau | Scénario | Comportement attendu | Test |
|---|---|---|---|---|
| F1 | U | Audio après `finish` | `ValueError` | contrat, `test_live_pipeline.py` |
| F2 | U | Règle de verrou assouplie en dessous de la base | `ValueError`, règle inchangée | `test_live_tracker_hardening.py` |
| F3 | U | Budget incohérent (seuils dans le désordre, posterior hors ]0,5 ; 1[, surcharge plus lâche qu'un palier sauté), retard négatif ou NaN | `ValueError` | `test_live_budget.py` |
| F4 | U | Taille de morceau que le modèle refuse (< 10 ou > 112 trames) | `ValueError` | `test_muno_incremental.py` |
| F5 | U | Audio de contrôle déjà sorti de la mémoire | contrôle sauté et compté (`windows_lost`), jamais exécuté sur un autre audio | `test_live_pipeline.py` |
| F6 | U | Sans contrôle branché | aucun audio gardé | `test_live_pipeline.py` |
| F7 | U | Parole étrangère / silence | ni candidat ni verrou ; un seul `Lost` | `test_live_pipeline.py` |
| F8 | U | Lot hors du split `dev` dans le banc | refus (`SystemExit`) | `test_measure_live_engine.py` |
| F9 | M | Parole non coranique réelle (4 x 900 s) | **0 verrou non confirmé** | rapport |
