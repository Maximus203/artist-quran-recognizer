# Annotation du petit ensemble dev — protocole

But : produire une **vérité terrain humaine** sur quelques extraits des fichiers dev, afin que
`scripts/evaluate.py` puisse enfin calculer des taux (faux versets, omissions, limites). Tant
qu'aucun cas n'est annoté par un humain, **aucune métrique n'existe** : ne rien en déduire.

Périmètre : fichiers **dev** seulement (lot1-01, 03, 04, 05, 06, 09, 12). Le jeu **test**
(lot1-02, 07, 08, 10, 11) est réservé aux mesures finales : on ne l'écoute pas pour annoter, on ne
s'en sert pas pour choisir des extraits ni pour régler quoi que ce soit.

La liste des extraits est `docs/evaluation/dev-annotation-queue.yaml` (20 extraits, ≈ 32 min).
Elle dit **où écouter et pourquoi** — jamais ce qu'on y entend. Les champs `model_hint` sont des
observations d'un modèle, « non vérifiées » : ne pas les recopier, les contredire sans hésiter.

## Ce que l'humain doit annoter

Pour chaque extrait (fenêtre `start_s`–`end_s` du fichier), toute la parole audible de la fenêtre :

| Ce qu'on entend | Étiquette Audacity |
|---|---|
| un verset (entier, début → fin du dernier mot) | `67:4\|recognized` |
| un verset dont seule une partie est dite (arrêt, reprise au milieu) | `2:255[1-9]\|recognized` (mots numérotés à partir de 1) |
| un verset que l'on identifie avec certitude mais dont l'audio est brouillé/coupé | `67:5\|inferred` |
| chaque répétition d'un verset | une étiquette par occurrence |
| takbir, isti'adha, amin, basmala (hors 1:1) | `NON_QURAN:takbir`, `:istiadha`, `:amin`, `:basmala` |
| français | `NON_QURAN:french` |
| hadith, dou'a, khutba, arabe courant | `NON_QURAN:arabic_speech` |
| autre langue / bruit / silence long | `NON_QURAN:other_language` / `:noise` / `:silence` (facultatif pour le silence) |

La basmala de la Fatiha est le verset `1:1`. Citation dans une intervention : seule la citation est
un verset, le reste est `french` ou `arabic_speech`. Un `uncertain` est **interdit** en vérité
terrain (l'import le refuse) : on tranche, ou on exclut le passage (voir plus bas).

Limites : début = attaque du premier mot, fin = fin du dernier son du verset (avant la pause).
Tolérance d'évaluation par défaut : 300 ms.

## Comment, dans Audacity

1. Ouvrir l'audio (le WAV dérivé `_derived/<id>.wav` ou l'original), aller à la fenêtre de l'extrait.
2. Pistes d'étiquettes : Ajouter > Piste d'étiquettes, sélectionner une zone, `Ctrl+B`, saisir le texte.
3. Écouter chaque zone à vitesse normale **puis** ralentie pour les limites ; une étiquette = une zone.
4. Exporter : Fichier > Exporter > Exporter les étiquettes vers `<AQR_AUDIO_DIR>/labels/<id>.txt`
   (format : une ligne `début<TAB>fin<TAB>étiquette`, voir docs/DATA-COLLECTION.md §5).
5. Si l'on part d'une préannotation (`python scripts/prepare_annotation.py sortie/<id>.json`) :
   elle est écrite dans `labels/<id>.txt` avec un fichier `<id>.provenance.json`
   (`independent_truth: false`) ; les étiquettes `UNCONFIRMED:*` sont des propositions que l'import
   refuse : les trancher (renommer en étiquette de vérité) ou les supprimer. **Attention à
   l'ancrage** : pour le sous-ensemble double-annoté, annoter **sans** préannotation.
   Une préannotation n'écrase jamais un fichier existant sans `--force`.

## Comment contrôler

- `aqr data import-labels <id>` valide le format (toutes les lignes en défaut sont listées) et que
  rien ne dépasse la durée de l'audio ; corriger jusqu'à passage.
- Relecture : réécouter 100 % des zones `NON_QURAN` et un verset sur trois ; vérifier le texte
  du verset contre le corpus (le numéro, pas la mémoire). Chaque verset de chaque fenêtre a une
  étiquette ; aucune étiquette ne déborde de la fenêtre.
- Le relecteur est une personne qui a écouté. Un modèle ne relit pas.

## Comment enregistrer `annotation.by: human` + `reviewed_by`

`aqr data import-labels` renseigne `expected`/`non_quran` et passe le cas à `annote`, mais **ne
dit pas qui a relu** : sans provenance, le cas reste **non évaluable** (`has_trusted_truth` faux).
Dans l'attente d'une option en ligne de commande, ajouter à la main dans le manifeste :

```yaml
  annotation: {by: human, reviewed_by: rel-01, date: '2026-10-06', note: "extraits dev05-open, dev05-continuous ; sans préannotation"}
  annotated_windows:
  - [0, 100]
  - [150, 300]
```

(ou, en Python, `import_labels(..., reviewed_by="rel-01", date="...", note="...")`).
`reviewed_by` est un identifiant **anonyme** (jamais un nom). `annotated_windows` ne liste que les
fenêtres réellement annotées et relues, **marges comprises** ; hors fenêtre il n'existe pas de
vérité. Une préannotation modèle reste `statut: a_annoter` avec `annotation.by: model_preannotation`.
Ne rien committer d'autre que le manifeste (jamais d'audio).

## Deux relecteurs

Quand c'est possible, au moins **un extrait sur trois (≥ 6 sur 20, au moins un par catégorie
présente)** est annoté indépendamment par deux personnes (sans préannotation, sans se montrer le
travail). Comparer : versets et natures identiques, limites à ± tolérance. Tout désaccord se
tranche en réécoutant ensemble ; garder le compte « accords / total » dans `note` (par ex.
`double annotation avec rel-02 : 41/44 étiquettes identiques avant arbitrage`). Si une seule
personne est disponible, l'écrire dans `note` (`relecteur unique`) : les chiffres seront d'autant
moins défendables.

## Passages inaudibles ou douteux

Ne **jamais** deviner (invariant I3 : un faux verset est pire qu'aucun). Si l'on ne peut pas trancher
après plusieurs écoutes : **exclure le passage** en coupant la fenêtre (`[0, 100]` devient `[0, 62]`
et `[70, 100]`) ; il n'est alors ni vrai ni faux. Si le verset est identifiable avec certitude mais
l'audio brouillé : `inferred`. Noter dans `note` le nombre de passages exclus et leur durée totale.

## Ce qui reste interdit

Aucun audio, aucun poids, aucun secret dans git ; pas de nom de personne dans `reviewed_by` ; pas
de métrique annoncée tant que `scripts/evaluate.py` n'a pas tourné sur des cas annotés humainement,
avec les effectifs affichés.
