# Export des sous-titres — le moteur `aqr export-subtitles`

Conception : `docs/design/export-sous-titres.md` · décisions humaines : `docs/DECISIONS.md` et ADR-0014 ·
code : `src/aqr/export/` (analyse, vue, sous-titres, service) et `src/aqr/rendering/subtitles.py`
(écrivains SRT, WebVTT, ASS). Un seul moteur de rendu : `aqr recognize --format srt,vtt` utilise les mêmes
écrivains.

```bash
aqr export-subtitles PREDICTION [--decisions decisions.json] [--review review.json]
                     [--options '{"format":"ass","content":"ar_fr"}']
                     [--format srt|vtt|ass|json] [--content ar_fr|ar|fr] [--policy omit|marker|first]
                     [--allow-unresolved] [--blocking-tags a,b] (--out FICHIER [--force] | --preview N)
aqr export-readiness PREDICTION [--decisions …] [--review …] [--options …] [--page N --size N --type T]
aqr corpus-verse REF [--words DÉBUT-FIN]
# communs : --corpus-dir data/corpus  --no-translations (hors ligne strict)
```

Codes : 0 succès · 1 erreur sur les données (fichier illisible, option inconnue, sortie déjà présente sans
`--force`) · 2 utilisation impossible · **3 des passages ambigus restent à corriger** (la sortie standard porte
`{"error": "unresolved_items", "unresolved": n}`). Les traductions viennent du cache QuranEnc
(`$AQR_CACHE_DIR/translations`, comme `recognize`) ; hors ligne, l'export continue sans traduction pour les
versets absents du cache et le dit dans `warnings`.

## Ce qui est « ambigu » (contrôle de préparation)

Seuls comptent les intervalles `verse` et les signalements de revue **confirmés** (étiquettes passées par
`--blocking-tags` : l'atelier lit la propriété `blocksExport` des puces). Abstentions et formules ne sont jamais
obligatoires (I4). Cinq sortes de passage (`item`) :

| `item` | Condition | Se résout par |
|---|---|---|
| `uncertain` | `status == "uncertain"` ; compte seulement si le choix changerait le fichier | `choose`, `set_ref`, `exclude`, `ignore` |
| `inferred` | `status == "inferred"` (jamais entendu) | `confirm_inferred`, `exclude`, `ignore` |
| `cut` | verset reconnu et incomplet à un bord, dont le voisin proche (≤ `decoder.merge_max_gap_s`) est une abstention hors silence, un incertain ou le verset d'à côté ; pas pour une répétition ni après la basmala concaténée | `set_ref`, `confirm_partial`, `exclude`, `ignore` |
| `approx` | `translation.scope == "fragment"` et `fragment.approximate` ; compte seulement si la traduction est exportée | `translation_scope`, `ignore` |
| `report` | signalement confirmé portant une étiquette bloquante, sur un passage qui n'est pas déjà à vérifier (sinon il lui est rattaché) | `set_ref`, `adjust_time`, `exclude`, `dismiss_report`, `ignore` |

Impact d'un `uncertain` (les candidats sont comparés mot à mot **dans le corpus**, avec la plage de mots du
moteur) : `arabic` (des lettres diffèrent) · `arabic_sign` (un signe de pause seulement : 11:61 / 7:73) ·
`translation` (même arabe, traductions différentes ou inconnues) · `reference` (rien d'imprimé ne change, ex.
55:13 / 55:16 : bloque seulement si la référence est affichée). Changer `content` ou `show_ref` recompte.
Un incertain sans effet est exporté avec son texte commun, sans nommer de verset.

## Politique d'un export forcé (`allow_unresolved`)

| Passage non résolu | `omit` (défaut) | `marker` | `first` (déconseillé : le moteur ne classe pas ses candidats) |
|---|---|---|---|
| `uncertain` | omis | `[incertain : a \| b]` | le premier candidat |
| `inferred` | omis | `[déduit] texte` | `[déduit] texte` |
| `cut`, `approx`, `report` | exporté tel quel | idem | idem |

Un passage **ignoré** suit la même politique mais sort du compteur. Le résumé porte `forced`, `unresolved`,
`ignored`, `applied`, `orphans`, `policy`, la liste des passages `omitted` (avec la raison) et
`decisions_sha256`.

## Options (`ExportOptions`, défauts de la conception §7)

`format` srt · `content` ar_fr · `formulas` [basmala] (basmala = verset 1:1 du corpus ; les autres formules
sont des libellés arabes entre crochets, exportés seulement avec l'arabe) · `repetitions` keep|merge ·
`min_s` 1,0 · `max_s` 7,0 (un verset plus long est coupé aux temps mesurés des mots, sinon au prorata des
mots avec un avertissement ; la traduction suit les tranches `segments` de QuranEnc, sinon une coupe
proportionnelle) · `line_chars` 42 · `offset_ms` 0 · `rtl` vrai (U+202B…U+202C autour de l'arabe, SRT et WebVTT)
· `strip_notes` faux (retire les renvois `[1]` : écart assumé à I2) · `show_ref` faux · `bom` faux ·
`karaoke` vrai (ASS, seulement avec des temps de mots mesurés) · `font` Amiri Quran | Scheherazade New | Noto
Naskh Arabic (OFL ; KFGQPC n'est jamais proposée) · `policy` omit · `allow_unresolved` faux.

## Formats

- **SRT** : aucune attribution possible dans le fichier ; le résumé la donne pour la description de la vidéo.
- **WebVTT** : l'attribution dans un bloc `NOTE`. **ASS** : en commentaires `;` ; karaoké mot à mot `{\k}` ;
  deux styles (arabe, traduction).
- **JSON** : la prédiction recopiée **telle quelle** (jamais le `status` réécrit), plus un bloc `review`
  (`decisions_sha256`, `applied`, `unresolved`, `ignored`, `orphans`, `forced`, `policy`, `added`) et, pour chaque
  passage décidé, un champ `resolved` (`by: "human"`, `decision_ids`, `ref`, `words`, `t`, `text` lu dans le
  corpus, `translation` QuranEnc). Annuler toutes les décisions redonne l'export d'une session sans décision, octet
  pour octet.

## Contrôle de préparation (`aqr export-readiness`, `aqr.export-readiness/1`)

`verdict` (`total`, `resolved`, `unresolved`, `ready`, `arabic`, `other`), `counts` par sorte, `non_quran`
(`abstentions`, `formulas`), une **page** de passages (10 par défaut, 50 au plus) triés par temps avec, pour un
incertain, ses candidats (mots du corpus, mots qui diffèrent signalés, traduction), `first_open`, les passages
« sans effet avec ces réglages » (20 au plus) et les décisions `orphans`. Une session de 3 000 intervalles ne
renvoie jamais ses 3 000 intervalles.

## Ce qui n'est pas fait ici
- Aucun score par candidat : `first` prend le premier candidat de la liste du moteur.
- La coupe de la traduction d'un long verset n'a pas de découpage QuranEnc pour tous les versets : sinon
  proportionnelle aux espaces (avertissement).
- Les temps au mot ne sont pas conservés quand une décision déplace le passage ou que des répétitions sont fusionnées.
