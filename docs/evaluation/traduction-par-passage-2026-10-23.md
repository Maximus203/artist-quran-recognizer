# Traduction par passage — mesure du découpage en fragments

Date : 2026-10-23 · Code : `src/aqr/translation_align/`, `src/aqr/rendering/translation_segments.py` ·
Données : `data/translation-segments/french_hameedullah.json` · Décision : ADR-0012 ·
Reproduire : `python scripts/build_translation_segments.py` puis
`python scripts/measure_translation_segments.py --sessions <dossier de sessions>`.

Ce document ne contient aucun texte coranique ni aucune traduction : des références, des numéros de mots et
des verdicts. Les textes se relisent avec `build_translation_segments.py --show 11:61 …`.

## Ce qui est mesuré, et ce que cela vaut

Il n'existe aucune vérité terrain des frontières de proposition dans la traduction. Trois mesures, de la plus
optimiste à la plus fiable :

1. **Pseudo-vérité** (optimiste). Des suites de 3 à 5 versets consécutifs : la frontière entre deux versets est
   une vraie frontière de proposition, connue. Modèles appris sur les sourates paires, fenêtres des sourates
   impaires (aucune fuite). Pas d'inversion d'ordre, pas de signe de pause dans ces fenêtres : plafond.
2. **Intervalles partiels réels** (couverture seulement) : les `prediction.recognition.json` de 53 sessions de
   revue ; on compte ce que le renderer ferait, sans juger si c'est juste.
3. **Lecture de 40 versets** (la mesure qui compte). L'arabe du corpus et le français en regard, frontière par
   frontière : *juste* (la proposition française commence au mot arabe indiqué), *discutable* (à un mot près, le
   mot de liaison pouvait aller des deux côtés), *fausse* (plus d'un mot d'écart, ou ordre inversé). Une seule
   lectrice (l'agent qui a écrit le code) : les verdicts « discutable » sont une appréciation.

## 1. Pseudo-vérité

Réglages par défaut (`TranslationAlignmentConfig`), première chaîne seule (la seconde chaîne ne peut que
retirer des frontières).

| Fenêtres | Frontières connues | Gardées | Exactes parmi les gardées | À ±1 mot parmi les gardées |
|---|---|---|---|---|
| Suites de versets (3-5) | 2 248 | 50,2 % | 88,0 % | **99,82 %** |
| Unités courtes (≤ 7 mots) | 616 | 70,1 % | 86,1 % | **100 %** |

## 2. Couverture du fichier de données (6 236 versets)

| | Versets | Part |
|---|---|---|
| Découpés (≥ 2 tranches) | 4 337 | 69,5 % |
| Une seule proposition (rien à couper) | 1 464 | 23,5 % |
| Repli : propositions trop incertaines | 435 | 7,0 % |

Mots arabes situés dans un verset découpé : **83,8 %** (les longs versets, ceux qui comptent, sont les mieux
couverts). Tranches par verset : 1 → 1 899, 2 → 1 623, 3 → 1 114, 4 → 647, 5 → 420, 6 → 209, 7 → 119, 8 → 87…
10 950 frontières au total. Reconstitution (I2) : **6 236 / 6 236** versets (tranches jointes = texte d'origine à
l'espace de jonction près, plages de mots contiguës, empreinte lue) ; construction en ~3 min.

**Intervalles partiels de 53 sessions réelles : 732.**

| Ce que fait le renderer | Intervalles | Part |
|---|---|---|
| Fragment dont les mots sont exactement la plage affichée | 300 | 41,0 % |
| Fragment approché (déborde ou écarte un bord) | 249 | 34,0 % |
| Verset entier — verset sans découpage | 92 | 12,6 % |
| Verset entier — fragment trop large pour la plage | 91 | 12,4 % |

Soit **75 %** des intervalles partiels reçoivent un fragment, 25 % le repli honnête (« verset entier »).

## 3. Échantillon relu : 40 versets, 169 frontières

Résultat : **153 justes (90,5 %) · 15 discutables (8,9 %) · 1 fausse (0,6 %)**. À un mot près : 99,4 %.
**L'objectif « 0 frontière fausse » n'est pas atteint** : la frontière fausse est une inversion d'ordre (9:128,
voir ci-dessous) que ni la confiance ni le seuil ne détectent (confiance 0,999) ; relever le seuil ne la retire
pas. Je ne l'ai pas contournée par une règle écrite pour ce verset (ce serait ajuster l'échantillon).

| Verset | Mots | Frontières | Justes | Discutables | Fausses | Remarque |
|---|---|---|---|---|---|---|
| 11:61 | 27 | 10 | 9 | 1 | 0 | « Vous n'avez point… » : le pronom `هو` (14) passe dans la proposition précédente |
| 11:62 | 21 | 3 | 3 | 0 | 0 | |
| 11:63 | 22 | 6 | 6 | 0 | 0 | |
| 2:255 | 50 | 8 | 8 | 0 | 0 | |
| 12:11 | 11 | 3 | 3 | 0 | 0 | |
| 55:13 | 4 | 0 | – | – | – | une proposition |
| 1:1 | 4 | 2 | 2 | 0 | 0 | |
| 2:2 | 7 | 1 | 1 | 0 | 0 | |
| 2:177 | 51 | 13 | 12 | 1 | 0 | `ذوي` rattaché à « quel qu'amour… » au lieu de « aux proches » |
| 2:186 | 17 | 5 | 5 | 0 | 0 | |
| 3:18 | 18 | 4 | 3 | 1 | 0 | `قائما` rattaché à la proposition précédente |
| 4:1 | 32 | 5 | 4 | 1 | 0 | `به` rattaché à la proposition suivante |
| 4:36 | 32 | 6 | 5 | 1 | 0 | `وبذي` rattaché à la proposition précédente |
| 5:3 | 61 | 11 | 10 | 1 | 0 | `غير` rattaché à la proposition précédente |
| 5:8 | 26 | 5 | 5 | 0 | 0 | |
| 7:23 | 12 | 4 | 4 | 0 | 0 | |
| 7:172 | 26 | 7 | 6 | 1 | 0 | `ألست` rattaché à la proposition précédente |
| 9:128 | 14 | 4 | 3 | 0 | **1** | inversion : « un Messager pris parmi vous, est venu à vous » ↔ `جاءكم رسول من أنفسكم` |
| 12:4 | 15 | 4 | 4 | 0 | 0 | |
| 12:23 | 23 | 2 | 1 | 1 | 0 | `وغلقت` ; la seconde chaîne a retiré 2 frontières fausses de la première |
| 16:90 | 16 | 2 | 2 | 0 | 0 | |
| 17:23 | 25 | 4 | 4 | 0 | 0 | |
| 17:24 | 12 | 3 | 1 | 2 | 0 | « Fais-leur, à tous deux, miséricorde » éclaté en français |
| 18:10 | 16 | 4 | 4 | 0 | 0 | |
| 18:60 | 13 | 2 | 2 | 0 | 0 | |
| 19:4 | 14 | 1 | 0 | 1 | 0 | « et dit : » / `رب` |
| 20:14 | 11 | 2 | 2 | 0 | 0 | |
| 24:35 | 48 | 3 | 3 | 0 | 0 | |
| 25:63 | 12 | 3 | 2 | 1 | 0 | `هونا` |
| 33:56 | 13 | 1 | 1 | 0 | 0 | |
| 41:30 | 19 | 3 | 2 | 1 | 0 | « Ceux qui disent : » / `قالوا` |
| 49:13 | 20 | 6 | 6 | 0 | 0 | |
| 59:22 | 13 | 5 | 5 | 0 | 0 | |
| 59:23 | 19 | 6 | 6 | 0 | 0 | liste de noms divins |
| 67:1 | 13 | 0 | – | – | – | repli (une seule tranche) |
| 93:3 | 5 | 1 | 1 | 0 | 0 | |
| 103:2 | 4 | 1 | 1 | 0 | 0 | |
| 14:7 | 11 | 4 | 4 | 0 | 0 | |
| 21:87 | 23 | 2 | 2 | 0 | 0 | |
| 2:282 | 128 | 13 | 11 | 2 | 0 | `وليكتب` / `كاتب` : ordre arabe ≠ ordre français |
| **Total** | | **169** | **153** | **15** | **1** | |

Lecture :
- Les frontières *discutables* sont presque toutes un **mot de tête** (`ذوي`, `قائما`, `غير`, `ألست`, `وبذي`)
  que le français rattache à la proposition qui suit alors que le modèle le laisse à la précédente : un mot rare,
  sans équivalent appris. Elles se mesurent aussi en pseudo-vérité (12 % des frontières gardées ne sont pas
  exactes, 0,2 % hors de ±1).
- La frontière *fausse* est une **inversion d'ordre** : le français déplace une apposition (« un Messager pris
  parmi vous, est venu à vous »), l'arabe suit un autre ordre. L'alignement monotone ne peut pas la voir.
- Avant la seconde chaîne (autre normalisation des mots), 12:23 avait 2 frontières décalées de 2 mots et
  59:23 en avait 2 décalées d'un mot : retirées par l'accord des deux chaînes.

## Ce qui a été essayé et abandonné (mesuré, pour ne pas le refaire)

| Essai | Résultat | Décision |
|---|---|---|
| Prior de frontière appris aussi sur les **fins de verset** | 89 % de justesse en pseudo-vérité, mais la rime (-ين, -ون) fuit : le test *est* des fins de verset | Prior appris sur les seuls signes de pause (73 → 80 % exact après réglage) |
| Lexique appris sur 3 traductions (Hamidullah, Rashid, Montada) | +0,6 point seulement | Abandonné (une traduction suffit, pas de dépendance réseau de plus) |
| Ré-apprentissage sur les tranches trouvées (bootstrap) | +0,7 point | Abandonné |
| « Accord des modèles avant / arrière » seul, sans seuil de probabilité | précision 75-86 % | Gardé comme condition en plus du seuil, jamais seul |
| Détection des inversions par mots « ancrés » de l'autre côté de la frontière | retire 60 % des frontières (les ancres IBM-1 sont trop bruitées), ne retient pas 9:128 | Abandonné |
| Tolérance de position 0 (place exacte exigée) | 94,8 % de justesse mais 27 % des frontières seulement | Tolérance 1, déclarée dans le contrat |

## Limites

- **Un seul relecteur**, 40 versets : l'intervalle de confiance sur « 0,6 % de fausses » est large ; une
  inversion d'ordre rare mais réelle en produit une pour 169.
- La pseudo-vérité n'a ni inversion ni signe de pause : ses 99,8 % sont un plafond.
- Seul `french_hameedullah` est découpé. Une autre traduction se construit avec la même commande
  (`--translation-id`) ; les réglages sont ceux de Hamidullah et n'ont pas été relus pour une autre.
- Les versets dont le texte Tanzil commence par la basmala (premier verset de chaque sourate, sauf 1 et 9) la
  comptent dans leurs mots (4 mots) : la première tranche la contient, elle n'a pas d'équivalent français.
- Surlignage mot à mot : à la jonction de deux segments, le mot peut être décalé d'un mot (voir ci-dessus).
