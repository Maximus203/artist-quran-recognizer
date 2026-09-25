# Architecture — artist-quran-recognizer

> Moteur qui prend un audio/vidéo **quelconque** (récitation, prière, assise, cours
> mêlant français, arabe, hadiths, invocations) et produit une **timeline horodatée
> des versets du Coran récités**, puis restitue leur texte exact (Mushaf) et leur
> traduction officielle.

## 1. Invariants (non négociables — chaque PR les respecte)

| # | Invariant | Conséquence technique |
|---|-----------|------------------------|
| I1 | **Le texte arabe restitué ne vient JAMAIS d'un modèle.** Il vient du corpus de référence, par consultation `VerseRef → texte`. | L'ASR ne sert qu'à *localiser*. Aucun LLM génératif dans la chaîne. Le récitateur peut se tromper, le rendu reste exact par construction. |
| I2 | **Traductions officielles, non modifiées, versionnées.** | Source : QuranEnc (API/export). Stockage avec `translation_id` + `version`. Attribution affichée. Aucune reformulation. |
| I3 | **Nommer un faux verset est pire que n'en nommer aucun.** | « Porte de confiance » : sous le seuil → `UNCERTAIN` ou rien. Les métriques de précision priment sur le rappel. |
| I4 | **Tout ce qui n'est pas du Coran est explicitement étiqueté et ignoré** (français, arabe courant, hadiths, invocations, silence, bruit). | Classe `NON_QURAN` dans la timeline, jamais un verset « le plus proche ». |
| I5 | **Chaque verset porte un statut de preuve** : `RECOGNIZED` (entendu et aligné), `INFERRED` (déduit d'un trou entre deux versets reconnus), `UNCERTAIN`. | Un verset `INFERRED` n'a pas d'horodatage mesuré (ou un intervalle interpolé, marqué comme tel). |
| I6 | **La riwaya est un paramètre, pas une constante.** | Corpus et modèle ASR sont sélectionnés par `riwaya` (`hafs` en V1, `warsh` en V1.1). |
| I7 | **Chaque brique est remplaçable** derrière un port (interface) testé par un test de contrat. | Architecture hexagonale : `domain` ne dépend de rien. |

## 2. Vue d'ensemble — le pipeline

```
 fichier audio/vidéo
        │
 [B1] AudioExtractor ──────── ffmpeg → WAV mono 16 kHz
        │
 [B2] SpeechSegmenter ─────── découpe en segments de parole (pauses / waqf)
        │                     (obadx/recitation-segmenter-v2 ; VAD en repli)
 [B3] LanguageGate ────────── français / autre langue → NON_QURAN direct
        │  (arabe seulement)
 [B4] QuranASR ────────────── transcription orientée Coran + timestamps mots
        │                     (FastConformer-Quran | Whisper-Tarteel)
 [B5] QuranicityGate ──────── est-ce VRAIMENT du Coran ?  (cf. §4, piège n°1)
        │
 [B6] VerseMatcher ────────── texte normalisé → candidats (VerseRef, plage de mots, score)
        │                     index n-grammes sur les 6236 versets + alignement fin
 [B7] SequenceDecoder ─────── Viterbi sur le graphe des versets :
        │                     continuité, sauts, répétitions, trous → INFERRED
 [B8] Timeline ────────────── [ {ref, mots i..j, t_debut, t_fin, statut, confiance}, NON_QURAN… ]
        │
 [B9] Renderer ────────────── par lots paramétrables : texte Mushaf (I1) + traduction (I2)
        │                     formats : JSON, SRT/VTT (base de la V2 sous-titrage vidéo)
```

## 3. Les briques — contrats

Toutes les interfaces vivent dans `src/aqr/domain/ports.py`. Les implémentations
dans `src/aqr/adapters/`. Chaque port a un **test de contrat** (`tests/contract/`)
que toute implémentation doit passer.

| Brique | Port | Entrée → Sortie | Implémentation V1 | Testable sans GPU ? |
|---|---|---|---|---|
| B1 | `AudioExtractor` | chemin fichier → `AudioClip` (PCM 16 kHz mono) | ffmpeg | oui |
| B2 | `SpeechSegmenter` | `AudioClip` → `list[TimeSpan]` | recitation-segmenter-v2, repli Silero VAD | faux (fake) |
| B3 | `LanguageGate` | segment → `lang` + confiance | Whisper LID | faux |
| B4 | `QuranASR` | segment → `Transcript` (mots + timestamps + confiance) | FastConformer-Quran (CC-BY-4.0) ; Whisper-Tarteel en challenger | faux |
| B5 | `QuranicityGate` | `Transcript` (+ transcript générique) → score ∈ [0,1] | double ASR + couverture d'alignement | **oui (pur)** |
| B6 | `VerseMatcher` | texte normalisé → `list[Candidate]` | index n-grammes + Levenshtein au niveau mot | **oui (pur)** |
| B7 | `SequenceDecoder` | `list[list[Candidate]]` → `Timeline` | Viterbi / HMM | **oui (pur)** |
| — | `CorpusRepository` | `VerseRef` → texte Mushaf, texte normalisé | Tanzil Uthmani (CC-BY-3.0), checksum épinglé | oui |
| — | `TranslationRepository` | `VerseRef`, `translation_id` → texte + version | QuranEnc (Hamidullah/KFC, Rachid Maach, Nûr) | oui |
| B9 | `Renderer` | `Timeline` + options de lot → JSON / SRT / VTT | maison | **oui (pur)** |

**Conséquence TDD** : le cœur de l'intelligence (B5, B6, B7, normalisation arabe,
rendu) est **pur et déterministe** → on l'écrit test d'abord, sans modèle, en
millisecondes. Les modèles lourds (B2–B4) sont derrière des ports ; en test on
les remplace par des fakes qui renvoient des transcriptions scénarisées.

## 4. Les pièges connus et comment l'architecture y répond

### Piège n°1 — L'ASR spécialisé Coran « voit du Coran partout »
Un modèle fine-tuné sur le Coran projette **n'importe quel arabe** (hadith, dou'a,
khutba) vers le texte coranique le plus proche. C'est le risque principal de
faux positifs (I3).
**Réponse (B5 QuranicityGate)** — un segment n'est accepté que si **plusieurs
signaux concordent** :
1. un ASR **généraliste** (Whisper large-v3) transcrit le même segment ; forte
   divergence entre les deux transcriptions → pas du Coran ;
2. **couverture d'alignement** : au moins *N* mots consécutifs alignés sur un verset
   avec une similarité ≥ seuil (N et seuil calibrés sur le corpus de test) ;
3. (V1.1) indices acoustiques de tartil (débit, allongements) — en option.

Les **citations coraniques à l'intérieur d'un hadith ou d'un cours** SONT du Coran :
elles doivent être détectées. Le test de référence : un hadith qui cite un verset
→ seule la citation est étiquetée comme verset.

### Piège n°2 — Récitation non linéaire
Arrêts en milieu de verset (waqf), reprises (i'ada), répétitions, sauts de sourate,
verset non reconnu entre deux versets reconnus.
**Réponse (B7 SequenceDecoder)** — HMM dont les états sont les positions
(sourate, verset, mot) et les transitions sont pondérées :

| Transition | Probabilité a priori |
|---|---|
| mot suivant / verset suivant | forte |
| répétition (reprise de quelques mots en arrière) | moyenne |
| verset v → v+2 (un verset manqué) | faible → le verset v+1 est marqué `INFERRED` |
| saut arbitraire (autre sourate) | très faible, exige une forte confiance acoustique |
| entrée / sortie d'une plage `NON_QURAN` | selon B5 |

Les probabilités sont des **paramètres de configuration**, calibrés sur le corpus
de test — pas codés en dur.

### Piège n°3 — Versets identiques ou quasi identiques
Ex. « فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ » (Ar-Rahman, 31 occurrences). Le contexte
(verset précédent/suivant) désambiguïse, d'où le décodage de séquence plutôt qu'un
matching verset par verset. Si l'ambiguïté persiste → `UNCERTAIN` avec la liste
des candidats.

### Piège n°4 — Isti'adha, basmala, takbir, amin
Ne sont pas des versets (sauf la basmala d'Al-Fatiha selon le comptage). Étiquettes
dédiées : `ISTIADHA`, `BASMALA`, `TAKBIR`, `AMIN` — ni versets, ni bruit.

## 5. Modèle de données (domaine)

```text
VerseRef(surah: 1..114, ayah: 1..n)           # validé contre le corpus
WordSpan(ref: VerseRef, first_word, last_word) # plage de mots dans un verset
TimeSpan(start_s, end_s)                       # secondes, start < end
Detection(span: WordSpan, time: TimeSpan | None, status, confidence, candidates)
NonQuranSpan(time: TimeSpan, kind)             # FRENCH | ARABIC_SPEECH | HADITH? | SILENCE | NOISE | ISTIADHA…
Timeline(items: tuple[Detection | NonQuranSpan, ...], riwaya, engine_version)
```

## 6. Organisation du code

```
src/aqr/
├── domain/        # modèles + ports. ZÉRO dépendance externe.
├── corpus/        # normalisation arabe, chargement Tanzil, checksums
├── matching/      # B5 + B6 (pur)
├── decoding/      # B7 (pur)
├── adapters/      # ffmpeg, modèles HF/NeMo, QuranEnc… (dépendances lourdes, extras optionnels)
├── app/           # cas d'usage : recognize(), render()
└── cli.py
tests/
├── unit/          # pur, rapide, lancé à chaque commit
├── contract/      # un test par port, rejoué contre chaque adapter
├── integration/   # vrais modèles, marqué @slow, GPU optionnel
└── acceptance/    # scénarios audio du manifeste → métriques vs seuils
```

## 7. Évaluation — ce qui définit « ça marche »

Chaque fichier audio de test a une **vérité terrain** dans
`tests/fixtures/audio/manifest.yaml` (voir `docs/TEST-CORPUS.md`). Métriques :

| Métrique | Définition | Cible V1 (à confirmer après le 1er benchmark) |
|---|---|---|
| **Précision verset** | versets annoncés `RECOGNIZED` corrects / annoncés | ≥ 99 % |
| **Rappel verset** | versets réellement récités retrouvés (`RECOGNIZED` + `INFERRED` corrects) | ≥ 95 % (murattal propre) |
| **Faux positifs en zone non-Coran** | versets annoncés dans une plage `NON_QURAN` de la vérité terrain | **0** sur le jeu « assise/prière » |
| **Erreur de frontière** | écart médian début/fin vs vérité terrain | ≤ 300 ms |
| **Exactitude du texte rendu** | texte Mushaf = corpus de référence (octet pour octet) | 100 % (garanti par I1, testé quand même) |

Le benchmark public `QUD-Technologies/quran-alignment-benchmark` est utilisé en
complément (métriques Words F1, Repeats F1).

## 8. Extensions prévues (hors V1, rendues possibles par les ports)

- **V1.1** : riwaya Warsh (corpus + fine-tuning ASR dédié).
- **V2** : traduction anglaise (nouveau `translation_id`, zéro changement de code).
- **V2+** : sous-titrage automatique de vidéos (Timeline → SRT/ASS stylé → incrustation
  ffmpeg, polices arabes). Nouveau cas d'usage dans `app/`, aucune brique existante modifiée.
- **V2+** : mode temps réel (streaming) : B2–B7 en fenêtres glissantes.
