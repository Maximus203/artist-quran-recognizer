# ADR-0009 — Cascade multi-modèles, arbitrée par l'audio

- Statut : accepté — 2026-10-20 (étape B, troisième brique)
- Précise : ADR-0008 (vérification acoustique des suites)

## Problème
Chaque moteur ASR rate des fenêtres que les autres entendent : sur la voix de Cherif au micro, Muno
semblait meilleur ; sur EveryAyah, FastConformer coupait An-Nas. Choisir un moteur dans l'interface
reporte sur l'utilisateur une décision qu'il ne peut pas prendre, et faire voter trois moteurs sur
tout le fichier triple le coût sans dire lequel croire.

## Décision
1. **FastConformer transcrit tout le fichier** (meilleur moteur mesuré, `asr-comparison.md`) ; la
   décision normale (suites, vérification acoustique) tourne une première fois.
2. **Fenêtres douteuses** : sans verset retenu, hors silence et formules, avec un candidat coranique
   de qualité ≥ `CascadeConfig.relisten_min_quality` (0,3) ou voisine d'un verset retenu
   (`relisten_neighbors`). Seules celles-ci sont réécoutées par les moteurs secondaires (Whisper, puis
   Muno ; un moteur dont les poids manquent est sauté avec un avertissement).
3. **Arbitre acoustique (I3)** : un candidat secondaire qui se suffit seul (score au seuil) n'est
   gardé que si l'alignement du **texte du corpus** sur l'audio de la fenêtre atteint le seuil de
   l'ADR-0008 (`AcousticVerifier.supports`) ; trace `acoustic_checks[kind=relisten]`. Les autres
   candidats ne deviennent un verset que par une suite, vérifiée comme toute suite.
4. La décision retourne une seconde fois sur l'ensemble. Le moteur principal n'est jamais contredit :
   la cascade ajoute des candidats, elle n'en retire aucun.
5. Sans vérificateur acoustique (`--no-acoustic-check`, poids absents), pas de réécoute : un moteur
   secondaire sans arbitre augmenterait le risque de faux verset.

## Conséquences
- Mesure (`docs/evaluation/cascade-2026-10-20.md`) : aucun verset perdu, aucun ajouté sur les fichiers
  sans Coran ; EveryAyah 211 → 216/216 ; +10 versets distincts sur le lot 1 dev, +5 sur le lot 2 dev.
- Coût ×2,85 sur des fichiers parlés (beaucoup de fenêtres douteuses), faible sur une récitation.
- Défaut de l'atelier et de `aqr recognize` ; l'interface ne propose plus de moteur.
- Les seuils (0,3, voisinage) sont de la configuration, réglables sur le split `dev` seulement.
