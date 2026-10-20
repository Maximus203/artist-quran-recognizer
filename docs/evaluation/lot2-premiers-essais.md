# Lot 2 (voix sénégalaises) — premiers essais de `aqr recognize` (2026-10-20)

Statut : **observations sans vérité terrain**. Aucun fichier du lot n'est annoté : ni précision, ni
rappel, ni erreur de limites ne sont calculables. Ce document dit ce qui a tourné, ce que le moteur a
nommé, ce qu'il a laissé en abstention et **pourquoi** (transcription réelle de l'ASR sous les
abstentions, voir la méthode). Les cas `test` du lot (lot2-08 à lot2-10) n'ont pas été ouverts.

## En bref
1. **Récitations propres en studio (orateur_C) : le moteur tient.** Maryam 19:3→19:98 sans trou
   (90 % du temps couvert par des versets reconnus), Al-Waqi'a 80 %, Al-Mulk 76 %.
2. **Tafsir en wolof : aucun faux verset dans la parole wolof** (1 943 fenêtres, I4 tenu), mais
   **presque aucune citation retrouvée** : l'oustaz cite 2 à 4 mots à la fois, et le plafond de preuve
   (5 mots) les écarte même quand l'ASR les entend parfaitement (18:11 : qualité 1,0, score 0,6).
3. **Récitant du style d'Al-Husary, enregistrements en public (recitant_L) : de 10 % à 71 %.**
   L'ASR déforme les passages ornés ou mal captés (lot2-07 : 2 versets reconnus en 6 min).
4. **Une récitation du lot est en Warsh** (lot2-05, annoncée par le présentateur) : le moteur la
   reconnaît à 61 % **et affiche le texte Hafs**, sans aucun avertissement (riwaya, C15).
5. **Bug reproductible de désambiguïsation (C07)** : 67:25 a cinq jumeaux exacts. Le matcher coupe à
   `top_k = 5` dans l'ordre du Mushaf : **67:25 sort de la liste**, et le décodeur, qui encadre la
   fenêtre par 67:24 et 67:26, ne peut que répondre `uncertain` 10:48.
6. **Respiration au milieu d'un verset** : sur 29 abstentions qui suivent de près un verset partiel,
   12 ont pour meilleur candidat la suite exacte du verset (≈ 15 en comptant les reprises), sous le
   seuil parce que l'ASR est approximatif ou que le fragment est court.

## Pins
| Élément | Valeur |
|---|---|
| Code exécuté | `develop` @ `6c7b189` (preuve par la suite, PR #47) ; `develop` a reçu depuis #48/#49, sans effet sur `recognize` (ajout de `unknown_symbol` à l'adaptateur, outillage de l'étape C) |
| Audios | `docs/data-lots/lot-2.yaml` : 12 fichiers, 4,96 h, SHA-256 vérifiés à l'ingestion ; dev = lot2-01 à 07, 11, 12 (3,06 h) |
| ASR | `fastconformer-quran@b33af7936f9a` (décodage CTC), GPU |
| Segmenteur | `recitation-segmenter-v2@5ee90364e709`, aucun repli Silero |
| Décodeur | `viterbi-decoder-v2` : seuil 0,75, ratio d'incertitude 0,92, fusion ≤ 5 s, inférence ≤ 180 s, preuve par la suite 5 mots |
| Corpus | Tanzil Hafs (`data/corpus/LOCK.json`), traduction `french_hameedullah` |
| Matériel | Windows 11, RTX 5090 Laptop (24 Go), torch 2.11.0+cu128, NeMo 3.0.0, ffmpeg 9.0 |

```bash
AQR_MODELS_DIR=D:\01-Dev\Data\aqr-models PYTHONPATH=src \
python -m aqr.cli recognize <audio> --asr fastconformer --device cuda \
    --out-dir D:\01-Dev\Data\aqr-out\lot-2 --format json,srt
python scripts/probe_abstentions.py <audio> <id>.recognition.json \
    --out D:\01-Dev\Data\aqr-out\lot-2\probes\<id>.probe.json --sample 20 --top-scores 8
```
Sorties (JSON, SRT, sondes) : hors dépôt, `D:\01-Dev\Data\aqr-out\lot-2\`. Calcul : 496 s pour
11 015 s d'audio (facteur temps réel 0,045, chargement des modèles compris à chaque fichier).

## Constitution du lot
- **Recherche** `yt-dlp "ytsearch15:…"` sans navigateur ; identité vérifiée par le titre, la chaîne et
  la durée. Écartés : vidéos d'imitation, compilations, et les vidéos d'un homonyme probable
  (« Ibrahima Camara de Saint-Louis ») dont le lien avec recitant_L n'est pas établi. L'annonce du
  concours entendue dans lot2-05 confirme a posteriori l'identité de recitant_L.
- **orateur_C** est le même intervenant que lot1-01 et lot1-04 : même identifiant, affectation `dev`
  héritée (figée).
- **Le découpage par récitant place orateur_M (tafsir wolof) en `test`** : ses trois fichiers ne
  peuvent pas servir aux essais (protocole). Pour observer quand même la parole wolof en dev, une
  **seconde voix de tafsir wolof (orateur_N, 1,17 h)** a été ajoutée ; simulée avant téléchargement,
  elle tombe en `dev` sans modifier aucune autre affectation. orateur_M reste la **seule voix wolof
  du jeu test** : à garder intacte pour la mesure finale.
- **Riwaya corrigée d'après l'audio** : lot2-04 annonce « Hafs » en ouverture, lot2-05 « Warsh »
  (catégorie C15 ajoutée). Les autres restent `inconnu` ; la Fatiha de lot2-06 est cohérente avec
  Hafs (« مالك », « عليهم » sans prolongation), ce qui n'est qu'un indice (un ASR entraîné sur Hafs
  normalise sa sortie).
- `scripts/audio_lot.py` écrit désormais dans les fiches la licence déclarée par le lot (libellé
  canonique « droits non établis… ») ; le lot 1 garde son libellé hérité.

## Résultats par fichier (dev)
| Fichier | Voix, contexte | Durée | Fenêtres | Versets nommés | Abstentions | Temps en versets reconnus | Suites cohérentes |
|---|---|---|---|---|---|---|---|
| lot2-01 | orateur_C, conférence publique | 1 686 s | 123 | 42 `recognized` (30 partiels, 17 répétitions) | 72 (52 sous le seuil, 17 sans candidat, 3 transcriptions vides) | 713 s (42 %) | 7:196→7:206, 8:1→8:4, puis 12:23 (1), 4:69-70 |
| lot2-02 | orateur_C, studio | 1 600 s | 124 | 99 `recognized`, 1 `inferred` | 8 | 1 433 s (90 %) | 19:3→19:98, sans trou |
| lot2-03 | orateur_C, studio | 817 s | 94 | 90 `recognized`, 4 `inferred` | 10 | 651 s (80 %) | 56:3→56:56, 56:59→56:96 |
| lot2-04 | orateur_C, studio | 586 s | 56 | 35 `recognized`, 1 `uncertain` | 12 | 443 s (76 %) | 67:1→67:24, [10:48 au lieu de 67:25], 67:26→67:30 |
| lot2-05 | recitant_L, concours, **Warsh** | 1 107 s | 102 | 53 `recognized`, 4 `inferred` | 34 | 678 s (61 %) | 4:12→4:14, 17:4→17:12, 83:1→83:31 |
| lot2-06 | recitant_L, en public | 639 s | 38 | 27 `recognized` (16 partiels, 11 répétitions) | 4 | 456 s (71 %) | 1:1→1:7, 9:16→9:22 |
| lot2-07 | recitant_L, en public | 373 s | 23 | 2 `recognized` (2:266, partiels) | 21 | 36 s (10 %) | 2:266 seul (passage réel ≈ 2:264→2:267, d'après les candidats sous le seuil) |
| lot2-11 | orateur_N, tafsir wolof | 915 s | 357 | **0** | 357 (249 sans candidat, 105 sous le seuil, 3 vides) | 0 % | — |
| lot2-12 | orateur_N, tafsir wolof | 3 292 s | 1 586 | 4 `recognized` (16:53, 72:19, 73:3-4) | 1 582 | 7 s | citations isolées, aucune de la sourate 18 commentée |

Formules : isti'adha reconnue en ouverture de lot2-03 à 06, basmala entre les sourates de lot2-05 ;
un `amin` dans lot2-12.

**Ce qui est cohérent** (pas une mesure d'exactitude) : sur les récitations, chaque suite nommée suit
l'ordre du Mushaf, et les changements de sourate (lot2-05, lot2-06) sont pris. Les détections isolées
à vérifier à l'oreille sont listées plus bas, avec les extraits.

## Méthode des sondes
`aqr.recognition/1` ne garde pas ce que l'ASR a transcrit sous une abstention (I1). La sonde
(`scripts/probe_abstentions.py`) retranscrit la même plage avec le même ASR, la normalise, la repasse
au matcher et garde les 3 meilleurs candidats avec leur **qualité** (ressemblance avant le plafond de
preuve) et leur **score** (qualité × min(1, mots expliqués / 5)). Trois tirages par fichier : toutes
les abstentions qui suivent un verset partiel à moins de 5 s (`after_partial`), les 8 mieux notées
(`top_score`) et 20 au hasard (`random`, seul tirage représentatif). 170 plages sondées au total.

Lecture des causes (meilleur candidat de chaque plage) :

| Cause | Récitations, tirage au hasard (44) | Tafsir, au hasard (36) | Récitations, les mieux notées (45) | Tafsir, les mieux notées (16) |
|---|---|---|---|---|
| A. Transcription vide (allongement, bruit, silence non numérique) | 3 | 10 | 0 | 0 |
| B. Aucun candidat (parole non coranique, ou ASR hors Coran) | 15 | 13 | 0 | 0 |
| C. **Fragment court bien entendu** (qualité ≥ 0,75, < 5 mots) | 4 | 0 | 15 | 9 |
| D. Bien entendu, ≥ 5 mots | 0 | 0 | 2 | 2 |
| E. ASR approximatif (qualité 0,5–0,75) | 6 | 5 | 21 | 5 |
| F. ASR déformé (qualité < 0,5) | 16 | 8 | 7 | 0 |

Les 4 plages D sont des abstentions justifiées : 12:23 à 0,74 (répété et reconnu plus loin),
une fin de verset partagée par 3 versets (2:255 / 3:2 / 4:87 sur un passage de 2:266), deux citations
du tafsir où le texte est commun à plusieurs versets. **Aucun faux verset n'a été repéré parmi les
abstentions** : le moteur s'abstient pour de bonnes raisons ; ce qu'il perd, il le perd par prudence
(I3) ou parce que l'ASR déforme.

## Constats détaillés

### 1. Tafsir wolof : zéro faux positif, citations perdues par le plafond de preuve
- **Parole wolof** : l'ASR, entraîné sur le seul Coran, la transcrit en « arabe » sans sens (ou en
  noms propres arabes du récit : Quraych, Abou Jahl dans le tafsir de 'Abasa) ; le matcher ne trouve
  rien ou des fragments d'un mot (score ≤ 0,36). 1 939 fenêtres sur 1 943 en abstention.
- **Fenêtres minuscules** : la parole est découpée en fenêtres de 2,1 à 2,6 s en moyenne (médiane
  des abstentions : 1,4 à 1,8 s), contre 9 à 17 s sur les récitations.
- **Citations entendues mais écartées** (tirage `top_score`, lot2-12 sur la sourate 18) : 18:11
  « فضربنا على آذانهم » qualité 1,0 → score 0,6 ; 18:25 qualité 0,93 → 0,52 ; 18:14 0,76 → 0,58 ;
  18:7 0,75 → 0,45 ; 17:1 « أسرى بعبده » 1,0 → 0,4. Dans lot2-11 ('Abasa) : 80:15 « بأيدي سفرة »
  0,9 → 0,32. L'oustaz cite mot à mot puis commente : le plafond (5 mots) les écarte toutes.
- **Les 4 détections de lot2-12 sont plausiblement justes** : 72:19 « وأنه لما قام عبد الله » arrive
  4 s après « أسرى بعبده » (17:1) dans le commentaire de 18:1 (« sur Son serviteur ») : l'oustaz
  enchaîne les versets où le Prophète est appelé « serviteur ». 16:53 et 73:3-4 sont des citations
  courtes (1,9 s et 2,3 s) dont le contexte n'est pas vérifiable sans écoute. Extraits à écouter
  ci-dessous.

### 2. Warsh reconnu en Hafs, sans avertissement
lot2-05 : le présentateur annonce le candidat et précise qu'il lit selon Warsh. L'ASR (entraîné sur
Hafs) rend un texte à l'orthographe Hafs (17:4 et 83:14 transcrits mot pour mot comme Tanzil) ; là où Warsh et Hafs ne diffèrent que
par la prononciation, le matcher retrouve le verset. Résultat : 53 versets `recognized`, **texte et
découpage Hafs affichés sur une récitation Warsh**. C'est le texte exact du Mushaf Hafs (I1 tenu à
la lettre), mais ce n'est pas ce qui a été récité ; aucun champ de la sortie ne le signale.

### 3. Désambiguïsation des versets identiques : `top_k` coupe la bonne réponse
Reproduction sans audio :
```python
matcher.match(normalize_arabic(corpus.text(VerseRef(67, 25))), top_k=5)
# 10:48, 21:38, 27:71, 34:29, 36:48 (score 1,0) — 67:25 absent
matcher.match(..., top_k=10)  # 67:25 apparaît en 6e position, score 1,0
```
Le pipeline appelle le matcher avec `top_k = 5` (`PipelineConfig.top_k`). Six versets portent ce texte
exact ; ils sont classés dans l'ordre du Mushaf, et le sixième (67:25) est coupé. Le décodeur, qui
voit 67:24 avant et 67:26 après, n'a pas la bonne réponse parmi ses candidats : il rend `uncertain`
10:48 (honnête, mais faux et évitable). Même risque pour tout texte partagé par plus de 5 versets
(formules répétées d'Ar-Rahman, d'Al-Mursalat, fins de versets courantes).

### 4. Respiration au milieu d'un verset
29 abstentions suivent un verset partiel à moins de 5 s. Pour 12, le meilleur candidat est la suite
exacte du verset (règle stricte de la sonde) ; 3 autres sont des reprises (17:4 mots 7-12 après 1-9,
17:12 mots 12-19 après 8-15) ou une fin de verset partagée (« إنه عليم بذات الصدور » après 67:13
mots 1-5 : le matcher préfère 8:43 à qualité 0,94 car le fragment ne dit pas de quel verset il
vient). Elles restent sous le seuil parce que :
- l'ASR est approximatif sur la suite (4:12 : qualité 0,57 à 0,70 ; 9:19 : 0,68) ;
- ou le fragment est trop court pour la preuve (67:17 mots 10-11, 67:19 mots 12-15 : qualité
  0,67-0,69, 2 à 4 mots).
La preuve par la suite (étape B) promeut les versets **entiers** voisins ; elle ne teste pas
l'hypothèse « cette fenêtre est la suite du verset partiel qui précède ».

### 5. Débuts de sourate et lettres isolées
- 19:1 « كهيعص » : l'ASR l'écrit d'un bloc, le matcher le trouve (qualité 1,0) mais un seul « mot »
  → score 0,2. 19:2 est déformé (0,25). Le passage reconnu commence à 19:3.
- 56:1 « إذا وقعت الواقعة » : bien entendu (qualité 1,0, 3 mots) → 0,6 ; 56:2 approximatif (0,62) →
  0,23. La suite 56:3→56:56 commence juste après : la preuve par la suite ne remonte pas vers les
  fenêtres qui la précèdent.
- La basmala d'ouverture déformée (« بسسم الله الر الرحمن الر الرحيم », qualité 0,58-0,63) reste une
  abstention dans lot2-02 et lot2-03, alors qu'elle est reconnue ailleurs.
- 56:57-58 (deux versets entre deux suites reconnues) : non inférés ; les 9 versets `inferred` du lot
  comblent tous un trou d'un seul verset (56:38, 56:75, 56:80, 56:86, 83:5, 83:10, 83:18, 83:20,
  19:89).

### 6. Style d'Al-Husary en public (recitant_L)
lot2-07 (2 versets sur un passage d'environ 4 versets en 6 min) : fenêtres de 10 à 22 s, ASR très
déformé (2:264 « لا تبطلوا صدقاتكم » rendu « لَا تُطِعطِرُوا الصَّدَقَاتِ ») ; une fenêtre de 10 s
rendue par « ال » seul. Le débit n'explique pas tout : les récitations du lot sont à 0,4-0,7 mot/s,
du même ordre que Husary et Abdul Basit sur EveryAyah (0,55-0,72 mot/s, silences de bord compris) ;
la prise de son en public et l'ornementation sont les suspects principaux (C12, C14 non étiquetés,
faute d'écoute).

### 7. Parole non coranique des récitations
Bien gérée : annonces en arabe du début de lot2-04 et lot2-05 (riwaya, nom du candidat, sourate),
« صدق الله العظيم » en fin de passage, « الله أكبر » de l'assistance (lot2-01) : toutes en abstention,
aucun verset nommé. Elles ne sont pas étiquetées non coraniques : « صدق الله العظيم » n'est pas une
formule connue du classificateur, et « الله أكبر أكبر » (assistance) n'est pas reconnu comme takbir.

## Hypothèses et propositions (pour l'étape B et la suite ; aucun code de `pipeline`, `decoding` ou `matching` modifié ici)
| # | Proposition | Constat | Risque pour I3 |
|---|---|---|---|
| P1 | **Ne jamais couper une égalité exacte de texte à `top_k`** : regrouper les versets au texte identique en un seul candidat portant tous les `refs`, ou étendre la liste jusqu'à la fin de l'égalité. Test de non-régression : 67:24 → [67:25] → 67:26 doit rendre 67:25. | §3 | nul (aucun score ne change) |
| P2 | **Hypothèse « suite du verset partiel »** : après un verset partiel arrêté au mot *k*, tester explicitement la fenêtre suivante contre la fin du verset (mots *k+1…n*), avec un seuil de qualité propre ; nommer en `inferred` (ou `recognized` si la qualité suffit). | §4 : ≈ 15 cas sur 29 | faible (hypothèse unique, contrainte par le contexte) |
| P3 | **Preuve cumulée à distance dans les cours** : plusieurs citations courtes bien entendues (qualité ≥ 0,9) de la même sourate, dans l'ordre, séparées par de la parole non coranique, se confirment ; à calibrer sur un fichier `dev` annoté. | §1 : 18:7, 18:11, 18:14, 18:25 en 50 min | **réel** (expressions courantes partagées) : seulement en `inferred`, avec un plancher de mots par citation |
| P4 | **Remonter la preuve par la suite vers l'arrière** (fenêtres qui précèdent le premier verset d'une suite : 56:1-2, 19:1-2) et accepter les lettres isolées connues (« كهيعص ») comme un mot de preuve complet. | §5 | faible |
| P5 | **Avertir quand la riwaya semble ne pas être Hafs** : au minimum un champ de la sortie (`riwaya: hafs` déclaré, non vérifié) ; à terme, détecteur Warsh (marqueurs : silat al-mim, imala, « ملك ») et corpus Warsh (C15, V1.1). | §2 | aucun (information ajoutée) |
| P6 | **Formules non coraniques** : ajouter « صدق الله العظيم » (et la variante « الله أكبر أكبر » de l'assistance) au classificateur de formules pour qu'elles soient étiquetées au lieu de rester des abstentions. | §7 | nul |
| P7 | **Fine-tuning de l'ASR (étape C)** : inclure des voix ouest-africaines, des récitations en public et du Warsh. Les voix du lot 2 (dev et test) doivent être exclues de l'entraînement si elles figurent dans Tadabur (`EXCLUDED_TADABUR_RECITERS`). | §6, §2 | — |
| P8 | **Annoter lot2-02, lot2-03 et lot2-05** en premier (atelier d'alignement) : récitations longues, peu d'abstentions, une en Warsh ; elles donneraient vite des chiffres de précision et de rappel pour ce lot. | — | — |

## À écouter (extraits hors dépôt, `D:\01-Dev\Data\aqr-out\lot-2\a-ecouter\`, ±2 s)
| Extrait | Question |
|---|---|
| `lot2-12_72-19.mp3`, `lot2-12_16-53.mp3`, `lot2-12_73-3-4.mp3` | citations réelles dans le tafsir ? (72:19 très probable) |
| `lot2-01_12-23.mp3`, `lot2-01_4-69-70.mp3` | 12:23 récité ? 4:69-70 en fin de conférence : récitation ou dou'a qui cite le verset ? |
| `lot2-04_10-48_attendu_67-25.mp3` | confirme le bug §3 (on y entend 67:25 dans la récitation d'Al-Mulk) |
| `lot2-07_2-265_abstention.mp3` | idée de ce que l'ASR ne parvient pas à transcrire |

## Limites
- Pas de vérité terrain ; une exécution par fichier ; un seul ASR (FastConformer CTC).
- Le tirage `random` des sondes est petit (44 et 36 plages) : les proportions sont des ordres de
  grandeur. Le tirage `top_score` est volontairement biaisé vers les « presque reconnus ».
- Catégories C12/C14 non attribuées sans écoute ; riwaya établie pour 2 fichiers sur 12.
- Les citations « plausiblement justes » de lot2-12 ne sont pas vérifiées.
