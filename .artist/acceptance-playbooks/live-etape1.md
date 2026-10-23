# Acceptance playbook — détection en direct, étape 1 (simulation hors ligne)

Moteur (ADR-0011). Un scénario est validé par un test automatisé ou une mesure chiffrée, jamais à l'œil.
Niveaux : U = unitaire (pur, corpus jouet), I = intégration (corpus réel), M = mesure sur audio
(`docs/evaluation/live-etape1-2026-10-23.md`). Surface : moteur seul (aucun écran, aucun réseau, aucun modèle ajouté).

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu | Test |
|---|---|---|---|---|
| P1 | U | Un mot entendu qui ouvre 3 versets | `Candidates` avec `count` = 3, aucun `Locked` | `test_live_tracker.py::test_le_premier_mot_ouvre_des_candidats_sans_verrou` |
| P2 | U | Début unique, 3 mots | `Locked` au 3e mot seulement, `RECOGNIZED`, `identity_basis: words` | `test_live_tracker.py` |
| P3 | U | Suite attendue, posterior déjà haut au 1er mot | pas de verrou avant `min_words_lock` mots (I3) | `test_live_tracker.py` |
| P4 | U | Sosies exacts, contexte (verset précédent verrouillé) | `Locked` `INFERRED`, `identity_basis: context` | `test_live_tracker.py` |
| P5 | U | Saut vers une autre sourate / retour / répétition | `Jump` de type `other_surah` / `back` / `repeat` | `test_live_tracker.py` |
| P6 | U | Mot mal entendu, mot avalé, mot en trop | le bon verset est verrouillé, aucun autre | `test_live_tracker.py` |
| P7 | U | Basmala en tête | `BasmalaHeard`, départs limités aux débuts de sourate, jamais prise pour la fin d'un verset | `test_live_tracker.py` |
| P8 | U | Fin du flux / silence | `Unresolved` ou `Continue` incomplet ; `Lost(silence)` une seule fois | `test_live_tracker.py` |
| P9 | U | Rejeu : arrivée des mots par blocs de 1,12 s, axe du temps restauré (13/14) | arrivées et temps attendus | `test_live_simulation.py` |
| P10 | U | Mesures : latence depuis le début du verset, liste courte, faux verrous, sauts, zones | valeurs exactes sur scénarios jouets | `test_live_simulation.py` |
| P11 | I | Corpus réel | 77 433 mots, 289 versets sans préfixe unique, 113 départs après basmala | `test_live_corpus_flow.py` |
| P12 | M | Montages EveryAyah (3 récitants) et mixages `make_mix`, vérité calculée | **0 faux verrou** (cible I3). **Résultat 2026-10-23 : 1 sur 376, NON ATTEINT**, dit dans le rapport ; ne passe pas tant que le mainteneur n'a pas tranché le garde-fou | rapport, `scripts/measure_live_sim.py` |
| P14 | U | La suite attendue entendue sans son premier mot (avalé par l'ASR) | pas de `Jump` | `test_live_tracker.py::test_un_premier_mot_avale…` |
| P15 | U | Sauts hors attente après un verset non nommé | comptés à part (`jumps_after_gap`) | `test_live_simulation.py` |
| P13 | M | Cibles de latence proposées avec leurs chiffres | tableau du rapport | rapport |

## MUST-FAIL (le système doit refuser)

| # | Niveau | Scénario | Comportement attendu | Test |
|---|---|---|---|---|
| F1 | U | 1 ou 2 mots, posterior > tau | jamais de verrou | `test_live_tracker.py` |
| F2 | U | Rival non sosie qui explique aussi bien les mots (2:2 / 2:3) | pas de verrou tant qu'un mot ne sépare pas | `test_live_tracker.py` |
| F3 | U | Sosies sans contexte | jamais nommés, `Unresolved` | `test_live_tracker.py` |
| F4 | U | Mots inconnus / parole étrangère | ni `Candidates` ni `Locked`, un seul `Lost` | `test_live_tracker.py` |
| F5 | U | Fin de verset de 4 mots entendue seule (isti'adha) | jamais nommée (milieu de verset : `min_words_lock` + `mid_verse_extra_words`) | `test_live_tracker.py` |
| F6 | U | Parole étrangère proche du Coran après un verset | ni `Jump` ni `Locked` | `test_live_tracker.py` |
| F7 | U | Mots peu sûrs / seulement proches avec les garde-fous activés | pas de verrou | `test_live_tracker.py` |
| F8 | U | Mots hors ordre, configuration invalide, lot hors split `dev` | `ValueError` / refus | `test_live_tracker.py`, `test_live_config.py`, `test_measure_live_sim.py` |
| F10 | U | Mots du verset épars dans de la parole, `min_lock_density` 0,8 | pas de verrou ; récitation dense : verrou | `test_live_tracker.py` |
| F9 | M | Parole non coranique réelle (lots `dev`) | verrous recensés un à un avec leur preuve ; aucun présenté comme vérité. **Résultat : 8 verrous non confirmés, dits dans le rapport** | rapport |
