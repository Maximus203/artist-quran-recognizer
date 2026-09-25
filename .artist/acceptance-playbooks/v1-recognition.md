# Acceptance playbook — V1 reconnaissance

Ce fichier définit le « done ». Un scénario est validé par un test automatisé, jamais
à l'œil. Les niveaux : U = unitaire (pur), C = contrat, I = intégration (modèles réels),
A = acceptation (audio du manifeste).

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu |
|---|---|---|---|
| P1 | U | `VerseRef(114, 6)` | valide |
| P2 | U | Normalisation : texte Uthmani avec harakat == même texte sans harakat | égalité |
| P3 | U | Matcher : transcription exacte de 2:255 | 1ᵉʳ candidat = 2:255, score ≥ 0,95 |
| P4 | U | Matcher : 2:255 avec 2 mots erronés (erreur de récitateur) | 1ᵉʳ candidat = 2:255 |
| P5 | U | Décodeur : 67:1, 67:2, 67:3 consécutifs | 3 `RECOGNIZED`, ordre conservé |
| P6 | U | Décodeur : 67:4, segment illisible, 67:6 | 67:5 `INFERRED` |
| P7 | U | Décodeur : 1:1..1:7 puis 112:1..112:4 | saut accepté, aucune détection 2:x fantôme |
| P8 | U | Décodeur : reprise de la 2ᵉ moitié de 2:255 | une seule détection 2:255 (plage fusionnée) ou deux détections marquées répétition — jamais un autre verset |
| P9 | U | Décodeur : 55:13 isolé et ambigu (verset répété) | contexte → bonne occurrence ; sans contexte → `UNCERTAIN` + candidats |
| P10 | U | Rendu : le texte arabe sorti == corpus octet pour octet, même si la transcription ASR diffère | égalité stricte |
| P11 | U | Rendu : lot de 3 sur 7 versets | 3 + 3 + 1 |
| P12 | C | Chaque adapter passe le test de contrat de son port | vert |
| P13 | A | C01 murattal propre | précision ≥ 99 %, rappel ≥ 95 %, frontières ≤ 300 ms |
| P14 | A | C11 citation dans un hadith | la citation est détectée, le reste est `NON_QURAN` |

## MUST-FAIL (le système doit refuser)

| # | Niveau | Scénario | Comportement attendu |
|---|---|---|---|
| F1 | U | `VerseRef(115, 1)`, `VerseRef(1, 8)`, `VerseRef(0, 1)` | exception de validation |
| F2 | U | `TimeSpan(5.0, 3.0)` | exception |
| F3 | U | Matcher : phrase arabe courante sans lien avec le Coran | aucun candidat au-dessus du seuil |
| F4 | U | Matcher : texte français | aucun candidat |
| F5 | U | Décodeur : un seul mot isolé qui ressemble à un mot coranique | pas de détection `RECOGNIZED` |
| F6 | A | C09 assise en français | **0** verset dans les plages françaises |
| F7 | A | C10 lecture de hadiths | **0** faux positif |
| F8 | U | Rendu avec une traduction dont le checksum ne correspond pas | erreur explicite, pas de rendu silencieux |
| F9 | U | Chargement d'un corpus dont le checksum diffère de celui épinglé | erreur explicite |
