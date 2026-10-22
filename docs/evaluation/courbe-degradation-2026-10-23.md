# Courbe de dégradation : le moteur résiste-t-il à un enregistrement imparfait ? — 2026-10-23

Statut : **mesure en cours.** Cette section « Règle de décision » est écrite et commitée AVANT la
première mesure ; elle ne sera pas modifiée après coup. Les résultats viennent à la suite.

Les chiffres obtenus sur des audios EveryAyah relèvent de la décision d'usage **provisoire** du
mainteneur (`docs/data-lots/ref-corpus-provenance.md`, « Décision d'usage ») : évaluation interne
locale, audio hors dépôt, aucune redistribution, aucun entraînement.

## Question et principe

Faut-il un fine-tuning avec dégradations ? On ne le décide qu'avec des preuves. Aucune vérité terrain
humaine n'existe encore : la mesure utilise donc des enregistrements dont le contenu est **connu par
construction** (sourates reconstituées par concaténation des clips EveryAyah, versets et temps
exacts), leur applique des dégradations contrôlées et reproductibles, relance le moteur et regarde
comment le rappel (versets attendus retrouvés, à zéro faux verset) se dégrade.

## Règle de décision (écrite avant la mesure)

Constantes dans `aqr.eval.degradation_curve.DECISION_RULE`, appliquées par `family_verdict` et
`decide` (testées dans `tests/unit/test_degradation_curve.py`).

1. **Rappel** = versets attendus nommés `recognized` / versets attendus (distincts). Les versets
   `inferred`, `uncertain` ou en abstention ne comptent pas comme retrouvés (I5). Les faux versets
   (`recognized` non attendus) sont comptés à part : nommer un faux verset est pire qu'un oubli (I3).
2. **Plancher.** Si le rappel du propre est < 95 %, la mesure est **non concluante** : le défaut
   n'est pas la dégradation.
3. **Niveau jugé.** Pour chaque famille, un niveau « réaliste » (l'ancre) est comparé au propre :
   bruit blanc SNR 10 dB, réverbération moyenne, MP3 48 kbit/s, vitesse ×0,6 (les quatre familles
   **obligatoires**, celles du cahier) ; bruit rose SNR 10 dB, téléphone AMR-NB 12,2 kbit/s et la
   combinaison réverbération moyenne + bruit 10 dB (familles **complémentaires**).
4. **Chute** = (rappel du propre − rappel à l'ancre) en points, sur la somme des versets attendus
   des 9 fichiers.
5. **Verdict d'une famille.**
   - **échoue** : chute > 15 points ET au moins la moitié des fichiers perdent plus de 10 points
     (une chute portée par un seul fichier est un accident, pas une famille) ;
   - **robuste** : chute ≤ 5 points ;
   - **dégradée** : entre les deux (ou chute > 15 points portée par moins de la moitié des fichiers).
6. **Décision.**
   - au moins une famille **obligatoire** échoue → **un fine-tuning avec ces dégradations est
     justifié**, et les familles qui échouent sont les cibles ;
   - sinon → le fine-tuning n'est **pas justifié par ces familles** ; une famille complémentaire en
     échec est signalée (elle éclaire le choix des cibles) mais ne décide pas seule.
7. **Alerte précision**, indépendante du rappel : plus d'un faux verset pour 100 attendus à l'ancre.

Limites de la règle, assumées d'avance : 9 fichiers et environ 70 versets (un seul fichier de
30 versets), donc des intervalles de confiance larges (Wilson 95 %, indicatifs : les versets d'un
même fichier ne sont pas indépendants) ; EveryAyah est probablement dans l'entraînement des
modèles, donc le rappel du propre est un **plafond optimiste** et c'est la dégradation **relative**
qui informe.
