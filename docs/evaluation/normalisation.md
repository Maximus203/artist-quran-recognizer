# Normalisation de comparaison — règles exactes et variantes de notation

Code de référence : `src/aqr/corpus/normalize.py` (`normalize_arabic`, `tokenize`) et
`src/aqr/corpus/imlai_corrections.py` (ADR-0003). Ce document décrit ce que le code fait
aujourd'hui ; si le code change, ce document change dans la même PR. Les exemples ci-dessous
ont été exécutés contre le code le 2026-10-09.

La normalisation sert **uniquement à comparer** (correspondance, notation). Elle ne sert jamais
au rendu : le texte arabe restitué vient du corpus (invariant I1).

## 1. Règles de `normalize_arabic`, dans l'ordre d'application

| # | Étape | Règle exacte |
|---|---|---|
| 1 | NFC | `unicodedata.normalize("NFC", texte)`. Pas de NFKC : les formes de présentation (ex. `ﷲ` U+FDF2, `ﻻ` U+FEFB) ne sont pas décomposées. |
| 2 | Signes diacritiques | Suppression des caractères `U+0610–U+061A`, `U+064B–U+065F`, `U+0670`, `U+06D6–U+06ED` (harakat, tanwin, shadda, sukun, madda de combinaison, alef suscrit U+0670, marques de pause et de récitation coraniques). |
| 3 | Tatweel | Suppression de `U+0640` (ـ). |
| 4 | Repli de lettres | `أ إ آ ٱ` (U+0623, U+0625, U+0622, U+0671) -> `ا` ; `ى` (U+0649) -> `ي` ; `ة` (U+0629) -> `ه` ; `ؤ` (U+0624) -> `و` ; `ئ` (U+0626) -> `ي`. |
| 5 | Caractères non arabes | Tout caractère hors `U+0621–U+063A`, `U+0641–U+064A` et hors espaces blancs est remplacé par un espace : ponctuation, chiffres (latins et arabo-indiens), `۝`, lettres latines, lettres persanes/ourdoues (`ک`, `ی`, `پ`…), formes de présentation. |
| 6 | Espaces | Toute suite d'espaces blancs devient un espace ; bords retirés. |

Points à ne pas confondre :

- **Le hamza isolé `ء` (U+0621) est conservé** tel quel. Le hamza porté par une lettre est replié
  sur la lettre porteuse (`ؤ` -> `و`, `ئ` -> `ي`, `أ إ` -> `ا`) : la distinction hamza-sur-alef /
  alef nu disparaît, mais un `ء` écrit seul reste.
- `ى` -> `ي` et `ة` -> `ه` effacent les distinctions alef maqsura / ya et ta marbuta / ha.
- L'étape 4 précède l'étape 5 : `ٱ` (U+0671), hors des plages conservées, est donc replié en `ا`
  avant le filtrage.
- Conséquences vérifiées : `سُؤَال` -> `سوال` ; `ٱلرَّحْمَٰنِ` -> `الرحمن` ; `كتـاب` -> `كتاب` ;
  `ءَ` -> `ء` ; `بِسْمِ ٱللَّهِ ۝` -> `بسم الله` ; `ﷲ`, `ﻻ`, `کی` et `١٢ abc` -> chaîne vide
  (supprimés, non convertis). Un texte avec ces lettres doit donc être converti en amont si on
  veut les comparer.
- Idempotente : `normalize_arabic(normalize_arabic(x)) == normalize_arabic(x)`.
- `tokenize(texte)` = `normalize_arabic(texte).split(" ")`, liste vide si le résultat est vide.

## 2. Écart Uthmani / imla'i : `imlai_corrections` (ADR-0003)

Les règles du §1 ne suffisent pas à faire coïncider le texte Uthmani du Mushaf et la graphie
imla'i que produit un ASR (mesure du 2026-09-25, rappelée dans la docstring de `normalize.py` :
61,6 % des versets ont au moins un mot imla'i normalisé absent du vocabulaire Uthmani, environ
9,3 % des mots). Une règle générique de caractères (« alef suscrit -> alef plein ») a été
essayée et rejetée : elle casse `الرحمن`, écrit sans alef plein aussi en imla'i.

La correction est donc un **dictionnaire** `{forme Uthmani normalisée: forme imla'i normalisée}` :

- construit par `build_word_corrections(corpus, simple_clean_words)` ;
- appris verset par verset, uniquement là où le nombre de mots Uthmani et simple-clean est égal
  (les versets dont la tokenisation diverge, environ 363, sont exclus de l'apprentissage) ;
- vote majoritaire par forme Uthmani, **identité comprise** : un mot le plus souvent aligné sur
  lui-même garde sa forme (cas `الذين`, qui ne doit pas devenir `اللذين`) ;
- ne contient que les mots dont la forme majoritaire diffère de l'entrée.

## 3. Deux variantes de notation, nommées

Toute métrique qui compare du texte arabe (WER/CER, accord de verset, étiquettes de référence)
indique dans son rapport **laquelle** de ces variantes elle utilise. Il n'y a pas de défaut : un
rapport sans ce champ est invalide.

### `tolerante` (= comportement du code)

`normalize_arabic` du §1 à l'identique, avec en plus, lorsque l'on compare une graphie Uthmani à
une sortie imla'i, les `imlai_corrections` du §2 appliquées au côté Uthmani. Elle est tolérante
sur : voyelles, formes de l'alef, alef maqsura/ya, ta marbuta/ha, hamza porté (waw/ya).

### `strict-lettres` (plus stricte ; **spécification, pas encore implémentée**)

Existe pour mesurer ce que la tolérance cache. Règles : les étapes 1, 2, 3, 5 et 6 (NFC,
diacritiques, tatweel, non-arabe, espaces) comme ci-dessus ; **aucun repli de lettres** (étape 4
supprimée) sauf `ٱ` -> `ا` (l'alef wasla est un signe de liaison, non une lettre distincte) ; pas
d'`imlai_corrections`. Un système n'est alors compté juste que s'il écrit `ة`, `ى`, `ؤ`, `ئ`,
`أ/إ/آ` comme le texte de référence.

Implémentation attendue (hors de cette PR) : une fonction distincte dans `aqr.corpus` avec ses
tests, jamais un drapeau caché dans `normalize_arabic`, dont le contrat actuel reste inchangé.

### Règle de lecture

- Les seuils du moteur sont calibrés sur `tolerante` ; un score `strict-lettres` sert à diagnostiquer,
  jamais à régler sans le dire.
- Les deux scores se publient côte à côte quand les deux sont calculables. L'écart est lui-même une
  information (il mesure les erreurs d'orthographe sans effet sur l'identification du verset).
- Le texte rendu à l'utilisateur ne passe par aucune des deux (I1).
