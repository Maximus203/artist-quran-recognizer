# `aqr.decisions/1` — le calque des décisions humaines

Décision d'architecture : `docs/adr/0014-decisions-humaines-sur-une-prediction-immuable.md`.
Code : `src/aqr/decisions/` (Python, pur) ; l'atelier (`web/lib/decisions.ts`) écrit et lit le même format.

Une session porte trois fichiers qui ne se mélangent pas :

| Fichier | Contenu | Qui l'écrit |
|---|---|---|
| `prediction.recognition.json` | ce que le moteur a dit (`aqr.recognition/1`), **jamais modifié** | le moteur |
| `review.json` | signalements de testeurs (`aqr.review/2`) | les testeurs |
| `decisions.json` | **vérité entendue** par passage (`aqr.decisions/1`) | le propriétaire de la session |

## Document

```jsonc
{
  "schema": "aqr.decisions/1",
  "session_id": "<uuid de la session>",
  "prediction_sha256": "<empreinte de la prédiction au dernier enregistrement>" | null,
  "consent": { "training": true, "by": "pseudonyme", "at": "2026-10-23T14:00:00Z" },
  "revision": 3,                       // augmente à chaque enregistrement
  "updated_at": "2026-10-23T14:02:11Z",
  "decisions": [ /* voir ci-dessous */ ]
}
```

## Une décision

```jsonc
{
  "id": "<uuid>",
  "kind": "choose" | "set_ref" | "confirm_inferred" | "confirm_partial" | "exclude"
        | "adjust_time" | "translation_scope" | "dismiss_report" | "ignore",
  "target": {
    "fingerprint": "<sha256 hex>" | null,   // l'intervalle du moteur visé ; null = un signalement sans intervalle
    "item": "uncertain" | "inferred" | "cut" | "approx" | "report",   // la question à laquelle on répond
    "index": 17,                            // position dans intervals[] : un indice, l'empreinte fait foi
    "snapshot": { "kind": "verse", "status": "uncertain", "ref": "11:61", "words": [1, 10],
                  "t": [48.2, 62.6], "candidates": ["11:61", "7:73"] },   // ce que le moteur avait dit
    "review_ids": ["<uuid>"]                // signalements de revue que la décision résout (facultatif)
  },
  "value": { /* selon kind, voir le tableau */ },
  "evidence": { "listened": true, "listened_s": 14.4, "device": "desktop" },
  "use_for_training": true,                 // copie de consent.training à cet instant
  "decided_by": "pseudonyme", "decided_at": "2026-10-23T14:02:11Z", "revision": 1,
  "superseded_by": null | "<uuid>",         // remplacée par une décision plus récente sur la même cible
  "withdrawn_at": null | "2026-10-23T15:00:00Z"   // annulée (jamais supprimée)
}
```

Un intervalle peut porter plusieurs questions (`item`) : une coupure ET une traduction approximative ont
chacune leur décision. Les genres permis dépendent de la sorte de passage :

| `item` | Pourquoi le passage est à vérifier | `kind` permis |
|---|---|---|
| `uncertain` | le moteur hésite entre plusieurs versets | `choose`, `set_ref`, `exclude`, `ignore` |
| `inferred` | verset supposé, jamais entendu | `confirm_inferred`, `exclude`, `ignore` |
| `cut` | verset à moitié reconnu dans une suite | `set_ref`, `confirm_partial`, `exclude`, `ignore` |
| `approx` | la traduction ne colle qu'à peu près à l'arabe affiché | `translation_scope`, `ignore` |
| `report` | un testeur a signalé une erreur (revue confirmée) | `set_ref`, `adjust_time`, `exclude`, `dismiss_report`, `ignore` |

| `kind` | `value` | Effet sur l'export |
|---|---|---|
| `choose` | `ref`, `words`, `t`? | un `uncertain` devient le verset choisi (texte du corpus) |
| `set_ref` | `ref`, `words`, `t`? (`t` requis pour un signalement) | pose ou corrige la référence et la plage de mots |
| `confirm_inferred` | `t`? | un `inferred` est entendu : exporté, sans marqueur |
| `confirm_partial` | — | « le lecteur s'arrête là » : la coupure n'en est plus une |
| `exclude` | `reason` : `not_quran` · `not_heard` · `unwanted` | le passage n'est pas exporté |
| `adjust_time` | `t` | début et fin corrigés (les temps au mot ne s'appliquent plus) |
| `translation_scope` | `scope` : `verse` · `fragment` · `none` | traduction du verset entier, du fragment, ou aucune |
| `dismiss_report` | — | le signalement de revue est faux |
| `ignore` | — | exporté selon la règle par défaut (omis) ; sort du compteur |

Valeurs factuelles (`choose`, `set_ref`, `confirm_*`, `exclude`, `adjust_time`) : seules elles peuvent devenir une
**proposition** de vérité terrain, si le passage a été écouté et que `use_for_training` est vrai. `ignore`,
`dismiss_report`, `translation_scope` ne le sont jamais.

## Empreinte d'un intervalle

`fingerprint = sha256( UTF-8( JSON compact, clés triées, sans échappement des caractères non ASCII ) )` de

```json
{"candidates": ["11:61", "7:73"], "kind": "verse", "ref": "11:61", "status": "uncertain",
 "t": [48200, 62600], "words": [1, 10]}
```

- seulement un intervalle `verse` a une empreinte ; les champs qui ne sont pas dits par le moteur (`text`,
  `translation`, `confidence`, `word_times`…) n'y entrent pas ;
- `candidates` garde l'ordre du moteur ; `t` est en **millisecondes entières**, `floor(x × 1000 + 0,5)` (le
  demi vers le haut, pas l'arrondi bancaire) ; `ref`, `status`, `t`, `words` valent `null` quand le moteur ne les
  donne pas ;
- vecteurs de référence partagés par Python et TypeScript : `tests/fixtures/decisions/fingerprint-vectors.json`.

## États d'une décision à la lecture

| État | Condition | Conséquence |
|---|---|---|
| appliquée | active, et un intervalle de même empreinte existe | la vue fusionnée la porte |
| orpheline | active, mais plus d'intervalle de même empreinte (analyse relancée) | non appliquée ; l'atelier la montre pour la rattacher ou la retirer |
| annulée | `withdrawn_at` renseigné | ignorée, conservée dans l'historique |
| remplacée | `superseded_by` renseigné | ignorée, conservée |

Une seule décision est active par cible (empreinte de l'intervalle, ou signalements, et `item`) ; si deux le sont, la plus récente (`decided_at`, puis `revision`,
puis `id`) gagne. `decisions_sha256` = SHA-256 des seules décisions actives, triées par identifiant.

## Dans l'atelier
- `GET` / `PUT /api/sessions/<id>/decisions` (contrat : `web/README.md`) : le serveur fixe l'empreinte, l'auteur, la
  date et la révision. Annuler marque `withdrawn_at` ; décider de nouveau sur la même cible remplace la
  décision précédente (`superseded_by`), sans la supprimer.
- **Après une nouvelle analyse**, les décisions orphelines sont listées avec le passage du moteur le plus proche
  dans le temps (recouvrement ≥ 50 %) ; `reattach` les rattache, l'ancienne reste dans l'historique.
- **Vérité terrain** : `POST …/validation {action: "from_decisions"}` (administrateurs) ajoute, comme
  propositions `proposed`, les décisions factuelles **écoutées**, dont le consentement du document ET celui de la
  décision sont donnés. Rien n'entre seul dans le manifeste.

## Ce que ce format ne fait pas
- Il ne réécrit jamais `prediction.recognition.json` ni le `status` d'un intervalle (I5).
- Il ne stocke aucun texte coranique ni aucune traduction : le texte vient du corpus à l'export (I1, I2).
- Il ne classe pas les candidats : le moteur n'a pas de score par candidat, donc « premier candidat » n'est pas
  un meilleur candidat.
