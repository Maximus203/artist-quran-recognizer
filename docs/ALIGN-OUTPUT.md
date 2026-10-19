# Alignement forcé et vérité terrain semi-automatique (ADR-0006)

Trois commandes, un parcours : le moteur **propose**, l'humain **déclare** ce qui est récité, l'alignement
**pose les temps**, l'humain **écoute et valide**, les passages validés **entrent dans le manifeste**.
L'atelier web enchaîne les trois (panneau « 07 / VÉRITÉ TERRAIN ») ; la CLI reste utilisable seule.

```bash
aqr plan-alignment sortie/lot1-06.recognition.json --out plan.json      # propositions du moteur
aqr align lot1-06.mp3 --plan plan.json                                    # plusieurs passages, un chargement du modèle
aqr align lot1-06.mp3 --verses "1:2-1:7, amin, 21:51-21:56" --at 11-115   # un seul passage
aqr data import-alignment validés.alignment.json --reviewed-by rel-01     # vérité terrain du manifeste
```

## Déclarer ce qui est récité (`--verses`, champ « Versets récités » de l'atelier)
Dans l'ordre, séparé par des virgules :
- `112:1-4`, `21:51-23:118` (à travers les sourates) : versets entiers ; la basmala que Tanzil concatène au
  verset 1 en est exclue ;
- `2:255[1-10]` : plage de mots (indices Uthmani, ceux du rendu) ; reprise : `1:7, 1:7[5-9]` ;
- `amin`, `takbir`, `istiadha`, `basmala` : formules de la prière, alignées à leur place pour qu'un verset
  voisin n'absorbe pas leur voix ; elles deviennent des zones `non_quran`, jamais des versets.

## `aqr.align-plan/1` (propositions)
`{"schema", "source": {"sha256", "duration_s"}, "notice", "passages": [{"t": [a, b], "verses": "..."}]}`.
Versets `recognized`/`inferred` proches regroupés (≤ 110 s, écart ≤ 6 s, marge d'écoute 1 s, sans
chevauchement) ; formules détectées par le moteur incluses à leur place ; un `uncertain` coupe la
proposition. **Une proposition n'est pas une vérité terrain.**

## `aqr.alignment/2` (`<fichier>.alignment.json`)
```
{"schema": "aqr.alignment/2", "kind": "forced_alignment", "notice": "...",
 "source": {"file", "sha256", "duration_s"},
 "engine": {"model": "fastconformer-quran@b33af7936f9a/ctc", "corpus": "tanzil.net hafs (...)"},
 "config": {"energy_ratio": 0.1, "verse_end_extension_s": 0.0, "variants": ["simple", "simple_clean"]},
 "passages": [
   {"declared": "1:7, amin", "t": [30.0, 48.0], "variant": "simple",
    "evidence": {"llr_per_frame": -0.31, "forced_logprob", "free_logprob", "frames"},
    "spans": [{"kind": "verse", "ref": "1:7", "words": [1, 9], "partial": false, "t": [31.05, 44.25],
               "word_times": [[1, 31.05, 32.1], ...]},
              {"kind": "non_quran", "label": "amin", "t": [44.25, 47.21], "word_times": [...]}]},
   {"declared": "21:87", "t": [377.5, 443.1], "error": "le texte déclaré ... ne tient pas ..."}]}
```
Un passage illisible, hors du fichier ou trop court pour son texte porte `error` sans arrêter les autres.
Codes : 0 au moins un passage aligné · 1 tous en erreur, fichier absent, sortie déjà présente sans
`--force` · 2 `--verses`/`--plan` illisible, plan d'un autre audio, `AQR_MODELS_DIR` absent.

### Ce que la sortie AFFIRME
- Où les éléments **déclarés** seraient dits si la déclaration est juste ; jamais qu'ils le sont.
- `evidence.llr_per_frame` ≤ 0 : proche de 0, l'audio soutient la déclaration. Repère d'affichage de
  l'atelier : en dessous de −0,8, « la déclaration colle mal » (mesuré : bonne déclaration −0,2 à −0,7,
  décalée d'un verset −1,5 ; non calibré).
- Aucun texte n'est écrit : le texte d'un verset se lit dans le corpus (I1).

## `aqr data import-alignment` (vérité terrain)
Écrit les passages d'un document `aqr.alignment/2` (ceux que l'humain a validés) dans le manifeste
(`--manifest`, `$AQR_MANIFEST`, sinon `tests/fixtures/audio/manifest.yaml`). Le cas est retrouvé par
l'empreinte de l'audio. Refusé : fichier `test` ou en quarantaine (protocole), relecteur qui n'est pas un
identifiant anonyme (`rel-01`, jamais un nom), passage en erreur ou hors durée. Chaque passage devient
une fenêtre de `annotated_windows` ; ses versets entrent dans `expected` (`recognized`), ses formules
dans `non_quran` ; `annotation.by: human`. Une revalidation remplace ce qui est dans sa fenêtre ; une
préannotation de modèle est remplacée, jamais fusionnée.
