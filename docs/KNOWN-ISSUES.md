# Défauts connus (sources externes et environnement)

Chaque entrée dit : ce qui est observé, où, avec quelle version, l'impact, et ce que le dépôt fait
(ou ne fait volontairement pas). Rien n'est réécrit en silence : l'invariant I2 impose de restituer
les traductions telles que reçues.

## KI-1 — QuranEnc : traduction française dupliquée / contaminée (sourate 42)
- **Référence** : `GET https://quranenc.com/api/v1/translation/sura/french_hameedullah/42`
  (traduction `french_hameedullah`, Muhammad Hamidullah, révision du Complexe du Roi Fahd).
- **Version** : l'API ne fournit ni version ni date. Le champ `version` du dépôt vaut `"quranenc.com"`
  (`src/aqr/adapters/quranenc.py`, `TRANSLATION_METADATA`) : c'est un identifiant de source, pas
  une version. Observation faite le **2026-10-06** (cache local du dépôt : `<cache>/french_hameedullah`).
- **Réponse observée** (`aya` 3 et 4) :
  - 42:3 = `C’est ainsi qu’Allah, le Puissant, le Sage, te fait des révélations, comme à ceux qui ont vécu avant toi.`
    **répétée deux fois** dans la même chaîne ;
  - 42:4 = `A Lui appartient ce qui est dans les cieux et ce qui est sur la terre. Et Il est le Sublime,
    le Très Grand, ` **suivi de la phrase de 42:3**.
- **Étendue** (`scripts/audit_quranenc.py`, 114 sourates, 2026-10-06 ; résultats dans
  `docs/evaluation/quranenc-audit-*.json`) : `french_hameedullah` : 2 versets signalés, tous deux
  dans la sourate 42 (42:3, 42:4). `french_montada` : 0. `french_rashid` : 1 verset signalé par
  l'heuristique (75:35), **faux positif vérifié** : la réponse est `Encore une fois : « Malheur à toi,
  oui malheur ! »` après `« Malheur à toi, oui malheur ! »` (75:34), une répétition légitime du texte.
- **Impact** : le texte rendu pour 42:3 et 42:4 contient une phrase en trop ; une détection correcte
  (reconnue à 1,0 sur l'audio `lot1-05`) est donc accompagnée d'une traduction fautive. Le texte
  arabe (Tanzil) n'est pas concerné.
- **Décision** : pas de correction locale ni de masquage. La traduction est restituée telle que
  reçue (I2) ; ce document et l'audit font foi. À signaler au mainteneur de QuranEnc. Si Cherif veut
  une restitution propre, une liste d'exceptions **explicite et versionnée** (affichée comme telle)
  sera un choix de produit à lui soumettre, pas un correctif silencieux.
- **Test de non-régression de l'audit** : `scripts/audit_quranenc.py` est rejouable et ne modifie rien.

## KI-2 — Dataset audio public vs mention de droits « jamais redistribué »
Voir `docs/data-lots/RIGHTS.md`. Décision de droits attendue de Cherif.

## KI-3 — Repli Silero non fiable par défaut
Mesuré et documenté dans `docs/evaluation/silero-fallback.md` (réglages par défaut : segments d'un mot,
quasi aucune détection en aval). Ne pas le présenter comme équivalent au segmenteur principal.
