# ADR-0014 — Les décisions humaines se superposent à une prédiction immuable

- Statut : accepté — 2026-10-23 (arbitrages n° 1 à 8 de `docs/design/export-sous-titres.md` §15, défauts du mainteneur)
- Précise : invariants I1, I2, I3, I5 (`docs/ARCHITECTURE.md` §1) ; ADR-0001 (aucun modèle génératif)
- Contrat : `docs/DECISIONS.md` · conception : `docs/design/export-sous-titres.md` · suivi : issue #86

## Problème
Pour exporter des sous-titres, quelqu'un écoute l'audio et corrige ce qui est ambigu dans la partie coranique :
choisir entre `11:61` et `7:73`, confirmer un verset supposé, étendre un verset coupé. Ces corrections ont deux
usages : le fichier exporté, et la vérité terrain qui sert à mesurer (et un jour à entraîner) le moteur. Mais la
prédiction du moteur (`prediction.recognition.json`, `aqr.recognition/1`) est ce qu'on **mesure** : si une
correction la réécrit, on ne sait plus ce que le moteur a dit, ni s'il s'améliore.

## Décision

### 1. La prédiction ne change jamais ; les décisions sont un document à part
Les décisions vivent dans `decisions.json` (schéma `aqr.decisions/1`), à côté de `session.json` et de
`prediction.recognition.json`. Ce n'est pas `aqr.review/2` : une revue est un signalement de testeur (« ce
verset est faux », plusieurs auteurs, fusion par identifiant) ; une décision dit « voici la vérité entendue
pour ce passage », avec son propre cycle de vie (annulable, remplaçable) et sa propre portée de consentement.
Les mélanger casserait la fusion multi-testeurs et le schéma de la revue.

### 2. Le statut du moteur n'est pas réécrit (arbitrage n° 1, I5)
Une décision n'est **pas** un `RECOGNIZED` : c'est une preuve d'une autre nature (un humain a écouté). Le champ
`status` d'un intervalle reste celui du moteur ; la correction s'ajoute dans un champ **`resolved`**
(`by: "human"`, `decision_id`, `ref`, `words`, `t`, `text`, `translation`) que les lecteurs de l'ancien format
ignorent. Un quatrième statut `HUMAN` a été écarté : il aurait effacé l'information « le moteur hésitait », donc
la mesure. La vue fusionnée (moteur + décisions) est calculée à la lecture, jamais écrite sur la prédiction.

### 3. Une décision s'accroche par l'empreinte de l'intervalle, pas par sa position
`fingerprint = sha256` de la forme canonique `{candidates, kind, ref, status, t, words}` de l'intervalle du
moteur : clés triées, JSON compact en UTF-8, temps en **millisecondes entières** (`floor(x × 1000 + 0,5)`, le
même calcul en Python et en TypeScript, vérifié par des vecteurs partagés). `index` n'est qu'un indice.
- Si l'analyse est relancée et que le moteur redit exactement la même chose, la décision s'applique encore.
- Sinon elle devient **orpheline** : elle n'est jamais appliquée en silence à un autre passage. L'atelier la
  montre (« ce passage n'existe plus tel quel »), propose le passage le plus proche dans le temps, et la
  retire ou la rattache sur demande.
- Une décision dont la cible est un **signalement** de revue sans intervalle du moteur (le moteur n'a rien
  reconnu là) n'a pas d'empreinte : elle porte `review_ids`, et seuls `set_ref`, `dismiss_report` et `ignore`
  sont permis ; `set_ref` y exige ses temps.

### 4. Cycle de vie
Annuler = renseigner `withdrawn_at` (jamais supprimer : historique, et vérité terrain proposée à partir de la
décision). Remplacer = `superseded_by`. Une seule décision active par cible, c'est-à-dire par intervalle **et** par sorte de passage (`item` :
`uncertain`, `inferred`, `cut`, `approx`, `report`) : une coupure et une traduction approximative du même verset
sont deux questions, chacune a sa décision. Si deux sont actives (deux
enregistrements simultanés), la plus récente gagne. `decisions_sha256` (empreinte des décisions **actives**)
trace un export : annuler toutes les décisions redonne l'empreinte, et l'export, d'une session sans décision.

### 5. Ce qui est « ambigu » dépend de ce qu'on exporte ; un signe de pause compte à part (arbitrage n° 2)
Seuls comptent les intervalles `verse` et les signalements confirmés ; les abstentions et les formules ne sont
jamais obligatoires (I4). Pour un `uncertain`, les candidats sont comparés mot à mot **dans le corpus** : des
lettres qui diffèrent (`Arabe`), un signe de pause seulement (`Arabe · 1 signe`, mineur mais présent : I1
strict), la traduction seule, ou rien d'imprimé (même arabe, même traduction : `Référence`, bloquant seulement
si la référence est affichée). Un passage qui ne change rien à ce qui est imprimé ne bloque pas.

### 6. Forcer l'export, sans rien nommer à tort (arbitrages n° 4, 5, 8)
Sans correction, l'export est refusé (`unresolved_items`) ; l'utilisateur peut **forcer**. Règle par défaut :
**omettre** (I3 : nommer un faux verset est pire que n'en nommer aucun). Un `inferred` (jamais entendu, temps
interpolé) est omis. Variantes explicites : *marqueur* (`[incertain : a | b]`, `[déduit] …`, comme
`aqr recognize` le fait) ; *premier candidat*, déconseillé, car le moteur ne classe pas ses candidats (aucun score
n'est ajouté au contrat pour l'instant). Une coupure (`partial`) est exportée telle quelle : c'est un fait du
moteur, pas une erreur de nommage. Le JSON exporté porte `review.forced`, `unresolved`, `ignored` et la
politique ; le nom du fichier n'est pas modifié. Tout lecteur de la session peut forcer.

### 7. Consentement d'entraînement et vérité terrain (arbitrage n° 3)
Une décision **écoutée** et **factuelle** (`choose`, `set_ref`, `confirm_*`, `exclude`, `adjust_time`) peut
devenir une **proposition** de vérité terrain (statut `proposed`, relecteur = auteur) ; elle n'entre jamais seule
dans le manifeste. `ignore`, `dismiss_report`, `translation_scope` et « forcer » ne sont jamais de la vérité
terrain. Le consentement (`consent.training`) est **activé pour ses propres sessions**, **verrouillé à faux**
pour celles des autres (on ne consent pas pour l'enregistrement d'un autre, et il n'a pas à subir notre choix) ;
`use_for_training` copie le consentement au moment de la décision et n'écrase pas l'historique. Le consentement se
retire à tout moment, décision par décision ; l'audio n'est envoyé nulle part.

## Conséquences
- `src/aqr/decisions/` (pur, sans dépendance externe) : lecture stricte, empreinte, décisions actives,
  réconciliation. Le moteur de rendu des sous-titres (`aqr export-subtitles`) et l'atelier le consomment.
- Un export est reproductible : même prédiction + mêmes décisions actives + mêmes options → mêmes octets.
- Le texte arabe de l'export vient toujours du corpus (I1), même pour un verset que seul l'humain a nommé ; la
  traduction est celle de QuranEnc, inchangée, sauf l'option explicite « retirer les renvois de note » (écart
  assumé à I2, décochée par défaut).
- Coût : la vue fusionnée et le contrôle de préparation sont calculés par le moteur Python (le web n'a pas le
  corpus) et mis en cache par empreinte de la prédiction et des décisions.

## Alternatives écartées
- **Écrire la correction dans la prédiction** : on perd la mesure du moteur.
- **Un statut `HUMAN`** : voir 2.
- **Fusionner dans `aqr.review/2`** : voir 1.
- **Accrocher par position** : une nouvelle analyse décale les indices ; une décision serait appliquée au
  mauvais passage sans que personne le voie, pire que la perdre.
- **Rattacher automatiquement une décision orpheline au passage le plus proche** : une suggestion, jamais une
  application silencieuse.
