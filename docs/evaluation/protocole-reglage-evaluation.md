# Protocole réglage / évaluation (dev, test, mesure finale)

Objectif : qu'aucun chiffre présenté comme une performance n'ait servi à régler le système.
Références : `docs/DATA-COLLECTION.md` §5, `src/aqr/data/split.py`, `scripts/evaluate.py`,
`docs/EVALUATION-METRICS.md`.

## Les deux jeux

| Jeu | Usage permis | Usage interdit |
|---|---|---|
| `dev` | tout réglage : seuils du gate, paramètres du décodeur, choix de modèle, correction de bugs, inspection des erreurs | l'annoncer comme performance finale |
| `test` | **une** mesure finale par version candidate, avec `--final` | choisir un seuil, une pondération ou un modèle d'après lui ; relancer « pour voir » |

`--split` vaut `dev` par défaut. `scripts/evaluate.py --split test` sans `--final` est refusé
(code de sortie 2) : « le jeu test est réservé aux mesures finales ».

Un troisième état, `quarantaine` (`DataConfig.quarantine_split`), n'est **pas un jeu** : il
accueille les récitants dont le jeu `test` a été exposé (règle 3). Il n'est ni évalué (`--split
quarantaine` est refusé, même avec `--final`), ni utilisé au réglage, ni compté dans le ratio
`dev`/`test`. Aucun chemin n'en sort.

## Découpage : récitants disjoints

- L'unité de découpage est le **récitant**, jamais le fichier ni le verset : un même récitant n'est
  jamais à la fois en `dev` et en `test` (fuite de voix, de style et de micro).
- `assign_splits` (`src/aqr/data/split.py`) trie les récitants par hachage salé
  (`DataConfig.split_seed`, défaut `aqr-split-v1`) et vise une part de durée `dev` de
  `DataConfig.dev_ratio` (défaut 0,7).
- Une affectation déjà écrite dans un manifeste n'est jamais modifiée, sauf la mise en quarantaine
  (règle 3, à sens unique). Un récitant présent dans les deux jeux est une erreur (`ValueError`) :
  fuite à corriger dans le manifeste, jamais à contourner. En quarantaine ET en `test`, c'est une
  mise en quarantaine inachevée : `aqr data quarantine <récitant>` la termine.
- Les variantes d'un même contenu (même récitant ré-encodé, dégradé ou mixé, identifiant dérivé
  `<parent>--<label>`) héritent du jeu du récitant : une dégradation ne crée pas un nouveau récitant.
- Pour un mixage, le jeu est celui du récitant des versets ; la parole non coranique de remplissage
  ne compte pas comme récitant. `mixer.materialize` écrit `mix-<reciter>` (minuscules) : même voix
  que `<reciter>`, la quarantaine les prend ensemble (`voice_key`, `src/aqr/data/split.py`).

## Règles de réglage

1. Tout réglage se fait sur `dev` seulement. Les paramètres calibrés vivent en configuration, pas en
   dur (AGENTS.md).
2. Voir un bug sur un audio du jeu `test`, c'est l'exposer : la règle 3 s'applique d'abord (le
   récitant passe en quarantaine). La correction n'est pas appliquée telle quelle : on reproduit le
   défaut sur un cas `dev` (ou on ajoute un cas `dev`), puis on corrige.
3. Un cas `test` observé pendant le développement (écoute, transcription lue, sortie du moteur
   inspectée) a cessé d'être aveugle. On le signale, puis **tout le groupe du récitant** (parents,
   mixes, dérivés `<parent>--<label>`) passe en split `quarantaine`
   (`aqr data quarantine <récitant> [--dry-run]`, ou `quarantine_recitant` dans
   `src/aqr/data/split.py`), jamais en `dev` : cette sortie à sens unique
   est la seule modification d'affectation admise (voir « Découpage »), et choisir après coup quels
   cas rejoignent le jeu de réglage d'après ce qu'on a vu du test serait une sélection a posteriori.
   Le motif (date, récitant anonymisé, cause de l'exposition, cas touchés) est consigné dans
   `.artist/decision-log.md`. La mesure finale suivante se fait sur de **nouveaux récitants**.
4. Aucun chiffre `dev` n'est présenté comme performance de généralisation ; le rapport porte le
   champ `split`.

## Mesure finale

- Commande : `python scripts/evaluate.py ... --split test --final`. Le rapport enregistre
  `"final": true`.
- Une seule fois par version candidate. Si le résultat déçoit, on ne règle pas d'après lui : on
  revient à `dev`, et la version suivante aura sa propre mesure finale sur un jeu `test` renouvelé :
  de nouveaux récitants, jamais un récitant déjà vu.
- Avant la mesure : manifeste figé, audios épinglés (sha256), variante de normalisation nommée
  (`docs/evaluation/normalisation.md`), `min_overlap` et tolérances écrits.
- Les effectifs sont rapportés ; sous `min_reference_verses`, le résultat est marqué non défendable
  (`docs/EVALUATION-METRICS.md`).

## Biais à écrire dans tout rapport sur le corpus de référence

- Les modèles évalués (Whisper tarteel, FastConformer, etc.) ont probablement été entraînés ou
  affinés sur EveryAyah ou des données qui en dérivent (voir
  `docs/data-lots/ref-corpus-provenance.md`). Un score sur des clips EveryAyah est un **plafond
  optimiste**, pas une estimation de la performance en conditions réelles.
- Les mixages synthétiques ont une vérité exacte mais des transitions artificielles ; les
  dégradations (bruit, bande téléphonique, réverbération, MP3) sont simulées, non enregistrées.
- Seul du réel hors EveryAyah, annoté à la main, peut estimer la généralisation ; le corpus
  synthétique sert à la régression, aux cas limites et à la robustesse. Le lot 1 en est le
  candidat, **pas une référence acquise** : ses droits et son statut de dataset public sont des
  décisions ouvertes (`docs/data-lots/RIGHTS.md`, `docs/data-lots/ref-corpus-provenance.md`
  section « Décision d'usage »). Tout rapport qui s'appuie dessus le dit.
- Les audios aux droits non établis ne sont utilisés que sous la décision d'usage de
  `docs/data-lots/ref-corpus-provenance.md` (section « Décision d'usage »), **provisoire — en
  attente de confirmation écrite du mainteneur**. Tout rapport chiffré obtenu sur ces audios le dit.
  `scripts/evaluate.py` n'écrit pas encore cette mention dans son rapport : l'auteur du rapport
  l'ajoute.
