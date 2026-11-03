# Collecte des données audio — guide opérationnel

> Complète `docs/TEST-CORPUS.md` (catégories C01–C15, format de vérité terrain).
> Ici : **quoi fournir, sous quelle forme, combien, et ce que le système en fait.**

## 0. Principe

On **n'entraîne pas** de modèle en V1 (ADR-0001). Les audios servent à **évaluer et
calibrer** le système : on compte en **heures annotées**, pas en gigaoctets.

- Les clips « un verset par fichier » **ne sont pas à collecter** : ils existent en libre
  (EveryAyah) et sont téléchargés par script (`scripts/fetch_everyayah.py`, phase 3).
- Ce qu'il faut collecter : des **enregistrements réels, complets, non découpés**, dans les
  situations d'usage visées (prière, assise, cours, mosquée, apprenants, Warsh).

## 1. Priorités et volumes cibles V1

| Priorité | Catégorie | Cible | Diversité minimale |
|---|---|---|---|
| 1 | C08 Prière (à voix haute, tarawih) | 2 h | ≥ 3 imams, ≥ 2 lieux |
| 1 | C09 Assise/cours en français + récitations intercalées | 3 h | ≥ 3 intervenants |
| 1 | C10/C11 Arabe non coranique : hadiths, dou'a, khutba, hadiths citant un verset | 2 h | ≥ 3 intervenants |
| 2 | C12 Conditions dégradées (écho, téléphone loin, WhatsApp, foule) | 1–2 h | variée |
| 2 | C13 Voix non professionnelles (enfants, daara, apprenants, erreurs) | 1–2 h | ≥ 5 voix |
| 3 | C01–C07 Récitation propre (sauts, répétitions, versets identiques) | 1–2 h réelles | le reste est synthétisé |
| V1.1 | C15 Warsh | à part | voir §6 |

**Total V1 : 12–15 h annotées.** Démarrage : un **premier lot de 2–3 h** couvrant la
priorité 1 permet le premier benchmark.

## 2. Format des fichiers

- **Original, sans conversion** (mp3, m4a, wav, ogg, opus, mp4, mkv…). Le système
  extrait lui-même un WAV 16 kHz mono.
- Pas de passage par WhatsApp si l'original existe (recompression), **sauf** pour C12.
- **1 fichier = 1 enregistrement continu**, 1 à 60 min. Ne pas couper, ne pas nettoyer,
  ne pas réduire le bruit.
- Vidéo : courte → telle quelle ; longue → piste audio seule suffit.
- Nom : `AAAA-MM-JJ_<contexte>_<lieu-court>.<ext>` (ex. `2026-09-26_isha_mosquee-a.m4a`).

## 3. Fiche d'accompagnement (obligatoire, 2 minutes)

Même nom que l'audio, extension `.yaml` :

```yaml
fichier: 2026-09-26_isha_mosquee-a.m4a
categorie: C08            # une ou plusieurs : [C08, C12]
lieu: "mosquée, téléphone posé à ~5 m"
recitant: imam_A          # identifiant anonyme stable (jamais le nom)
riwaya: hafs              # hafs | warsh | inconnu
langues: [ar]             # ar, fr, wo…
contenu_approx: |
  00:40 Fatiha puis Al-A'la en entier (1re rak'a)
  04:10 Fatiha puis Al-Ghashiya 1-10 (2e rak'a)
droits: "enregistré par moi, accord de l'imam, usage interne test"
```

Les secondes exactes ne sont **pas** demandées : un repère approximatif suffit,
la précision vient de la pré-annotation + correction (§5).

## 4. Rangement

```
<AQR_AUDIO_DIR>/                   ← hors git, sauvegardé
├── inbox\                         ← tu déposes ici (audio + .yaml)
├── C08\ C09\ C10\ …               ← rangé par le script d'ingestion
└── _derived\                      ← WAV 16 kHz, pré-annotations (régénérables)
```

**Droits** : accord des personnes enregistrées ; fichiers privés ; jamais dans git,
jamais publiés.

## 5. Ce que le système en fait (pipeline de données, phase 3)

| Étape | Qui | Commande prévue | Résultat |
|---|---|---|---|
| 1. Ingestion | script | `aqr data ingest` | checksum, copie WAV, lecture du .yaml, cas ajouté au manifeste (statut `a_annoter`) |
| 2. Pré-annotation | système | `aqr data preannotate <id>` | timeline proposée + fichier d'étiquettes Audacity |
| 3. Correction | **toi** | ouvrir dans Audacity, corriger les étiquettes, exporter | ≈ 1 h de travail par heure d'audio |
| 4. Import | script | `aqr data import-labels <id>` | vérité terrain dans le manifeste (statut `annote`) |
| 5. Split | script | `aqr data split` | 70 % dev (calibrage) / 30 % test (jamais utilisé pour régler), **par récitant** |
| 6. Benchmark | système | `aqr bench --set dev|test` | précision, rappel, faux positifs, erreur de frontière, par catégorie |

Format des étiquettes Audacity (une ligne par zone, tabulations) :
```
0.000	6.100	67:4|recognized
6.100	11.400	67:5|inferred
11.400	17.800	67:6|recognized
17.800	25.000	NON_QURAN:french
```
Plage de mots partielle : `2:255[1-9]|recognized`.

## 6. Volumes disque

| Forme | 1 h | 15 h |
|---|---|---|
| Original mp3/m4a | 30–60 Mo | 0,5–1 Go |
| WAV 16 kHz mono dérivé | ~115 Mo | ~1,7 Go |
| Sous-ensemble EveryAyah | — | quelques Go |

Prévoir **~10 Go**. Le facteur limitant est le temps d'annotation, pas le disque.

**Warsh (V1.1)** : si le benchmark impose un fine-tuning de l'ASR, il faudra des
**dizaines d'heures** (ordre de grandeur 20–50 h). Les étiquettes s'obtiennent en grande
partie par alignement forcé sur le texte connu à partir de récitations complètes de
sourates identifiées. Commencer dès maintenant à mettre de côté des récitations Warsh.

## 7. Agents cloud : comment les audios arrivent (dépôt public → jamais d'audio dans git)

Les audios vivent dans un **dataset Hugging Face privé** (`printf0cherif/aqr-audio-private`,
dossier `lot-N/`, fichiers `lotN-NN.mp3`). Le manifeste public `docs/data-lots/lot-N.yaml`
(sha256, durée, catégories, source) est le contrat.

- **Au démarrage d'une session cloud** : `pip install -e ".[data]"` puis
  `AQR_AUDIO_DIR=$HOME/aqr-audio python scripts/audio_lot.py fetch --lot 1`
  (variables `HF_TOKEN` en lecture seule, `AQR_HF_DATASET` : secrets de l'environnement cloud).
  Le script vérifie chaque sha256 et écrit les fiches `.yaml` à côté des fichiers.
- **Nouveau lot** : ajouter les fichiers à `inbox\`, générer `docs/data-lots/lot-N.yaml`,
  déposer `lot-N/` dans le dataset, commit du manifeste seul.
- Interdit : `git add` d'un audio, d'un modèle ou d'un poids (`.gitignore` + `pre-push` +
  `tests/test_audio_lot_manifest.py` le bloquent).
