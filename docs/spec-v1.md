# Spécification V1 — artist-quran-recognizer

## Objectif
À partir d'un fichier audio ou vidéo, produire la **timeline des versets coraniques
récités** (qui, de quelle seconde à quelle seconde, avec quel statut de preuve), puis
restituer leur **texte exact du Mushaf** et leur **traduction française officielle**,
par lots paramétrables.

## Périmètre V1
- Entrées : fichiers audio/vidéo (tout format lu par ffmpeg). Pas de streaming.
- Riwaya : **Hafs** (l'architecture accepte déjà un paramètre `riwaya`).
- Contenus : récitation seule, **prière**, **assise ou cours** mêlant français, arabe
  courant, hadiths, invocations et récitations.
- Sorties : JSON (timeline + textes), SRT/VTT (préparation de la V2 sous-titrage).
- Traduction : FR, Hamidullah (révision du Complexe du Roi Fahd) par défaut. Rachid Maach
  et Centre Nûr sont sélectionnables.
- Exécution : **CLI locale, hors ligne** une fois les modèles téléchargés.

## Hors périmètre V1
Warsh (V1.1), anglais (V2), incrustation de sous-titres dans la vidéo (V2+), temps réel,
correction du tajwid, interface web ou mobile.

## Exigences fonctionnelles
| ID | Exigence |
|---|---|
| F1 | Détecter tous les versets récités, pas seulement le premier et le dernier. |
| F2 | Gérer un début et une fin quelconques, les sauts de sourate, les répétitions et les arrêts en milieu de verset (plages de mots). |
| F3 | Un verset non reconnu, encadré par des voisins reconnus, est restitué avec le statut `INFERRED`. |
| F4 | Toute parole non coranique est étiquetée `NON_QURAN` et ne produit **aucun** verset. |
| F5 | Chaque détection fournit `t_debut` et `t_fin` en secondes (sauf `INFERRED` : intervalle interpolé marqué comme tel). |
| F6 | Le texte arabe restitué est celui du corpus de référence, jamais celui de l'ASR. |
| F7 | La traduction est restituée sans modification, avec son identifiant, sa version et l'attribution de la source. |
| F8 | Rendu par lots : `--batch-size N` versets, ou regroupement par pause ou par sourate. |
| F9 | Isti'adha, basmala, takbir et amin portent des étiquettes dédiées. |

## Exigences non fonctionnelles
| ID | Exigence |
|---|---|
| NF1 | Précision (versets `RECOGNIZED` corrects) ≥ 99 %, faux positifs en zone non-Coran = 0 sur C09/C10. |
| NF2 | Cœur logique (normalisation, matching, décodage, rendu) pur, couvert à ≥ 90 %, suite unitaire < 10 s. |
| NF3 | Traitement plus rapide que le temps réel sur le laptop de dev (GPU), temps réel ×1 max sur CPU. |
| NF4 | Versions du corpus, des traductions et des modèles épinglées et tracées dans chaque sortie (`engine_version`). |

## Ordre de construction (TDD, brique par brique)
1. Domaine (modèles, invariants) ✅ amorcé dans le squelette
2. Normalisation arabe ✅ amorcée dans le squelette
3. `CorpusRepository` Tanzil + checksum
4. `VerseMatcher` (B6) sur transcriptions textuelles simulées
5. `SequenceDecoder` (B7) : continuité, saut, répétition, trou → `INFERRED`
6. `Renderer` (B9) + `TranslationRepository` QuranEnc
7. Adapters modèles (B1–B4), derrière les tests de contrat
8. `QuranicityGate` (B5) calibré sur C09–C11
9. Benchmark de bout en bout sur le manifeste, puis comparaison FastConformer vs Whisper-Tarteel
