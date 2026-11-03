# ADR-0008 — Vérification acoustique des suites de versets, et temps au mot

- Statut : accepté — 2026-10-20 (étape B, deuxième brique)
- Précise : ADR-0006 (alignement forcé du texte du corpus), ADR-0007 (preuve cumulée par la suite)

## Problème
La preuve par la suite (ADR-0007) ne lit que le texte de l'ASR.
1. **Un maillon mal transcrit coupe la suite.** Cas réel (2026-10-19, voix de Cherif au micro, Muno) :
   « عَلَّمَ » transcrit « لَّمَ » au début de sa fenêtre ; le matcher ne propose plus que 55:2 [2-2],
   qualité 0,5 < 0,75. La suite 55:1-4 se coupe, aucun verset nommé (2 enregistrements sur 3).
2. **Une suite dont le texte se tient est promue sans que l'audio soit consulté.** Les homonymes
   d'une sourate à l'autre (23:52-53 ≈ 21:92-93, 23:78-79 ≈ 67:23-24) forment des suites
   textuellement parfaites.
3. **Les temps sont ceux des fenêtres du segmenteur**, et une coupure entre deux versets d'une même
   fenêtre est estimée au prorata des mots.

## Décision
1. `aqr.decoding.chains.find_chains` (pur) : la meilleure suite (en mots expliqués) passant par chaque
   candidat, à un plancher de qualité donné. Au plancher du texte (`ChainConfig.min_quality`, 0,75)
   ce sont les suites qu'ADR-0007 promeut (`promote_chains` en dérive, comportement inchangé) ; au
   plancher de sauvetage (`AcousticCheckConfig.rescue_min_quality`, 0,5), une suite peut contenir un
   maillon amputé. Les exigences de la suite (≥ 2 fenêtres, ≥ 5 mots) ne changent pas.
2. `chain_spans` : le **texte du corpus** de la suite — du premier mot du premier maillon au dernier
   mot du dernier, versets intermédiaires entiers, mots perdus aux bords des fenêtres compris
   (`word_slack`). C'est ce texte que l'audio doit soutenir, jamais une transcription (I1).
3. `aqr.alignment.verification.AcousticVerifier` aligne ce texte sur le treillis CTC des fenêtres de la
   suite (`PassageAligner`, ADR-0006 ; passages ≤ `lattice_max_s`, 120 s) :
   - **acceptée** (`llr_per_frame` ≥ `min_llr_per_frame`, −1,0) : chaque maillon reçoit sa qualité
     pour score, au moins le seuil du décodeur (le maillon sauvé franchit le seuil, sans plus) ; il
     prend les mots que l'alignement place dans sa fenêtre (« عَلَّمَ » retrouvé) et leurs temps ;
   - **refusée** : aucun maillon n'est promu, même si le texte prouvait la suite ; un candidat garde
     toujours le score que le matcher lui donnait seul. Une suite longue refusée ne condamne pas la
     suite plus courte que le texte prouve en elle (vérifiée à part).
4. **Temps au mot** : `Candidate.times` (domaine) porte les temps mesurés de chaque plage ; le
   décodeur les prend à la place des bords de fenêtre (`time_interpolated` faux). Un verset prouvé
   seul (une fenêtre) est aussi aligné sur sa fenêtre, et garde les bords de sa fenêtre si l'audio
   ne le soutient pas (même seuil).
5. **Branchement** : le FastConformer sert de modèle acoustique quel que soit l'ASR (Whisper, Muno
   ou lui-même), dès que ses poids sont là ; sinon la sortie le dit (`warnings`) et ADR-0007 décide
   seul. `--no-acoustic-check` désactive ; `AcousticCheckConfig(min_llr_per_frame=None)` aussi.
   Traçabilité : `engine.acoustic`, `decoder.acoustic_min_llr_per_frame`, `timing.acoustic_s` et
   `acoustic_checks` (chaque suite : passage, texte aligné, preuve, décision ; docs/RECOGNIZE-OUTPUT.md).

## Ajout du 2026-10-20 (demande de Cherif) — la suite d'un verset commencé
Règle de récitation : **un verset commencé est toujours récité jusqu'au bout** ; le récitant peut respirer au
milieu, ou reprendre quelques mots en arrière (i'ada). Cas observé : le début est reconnu (21:56 [1-8], 21:87
[2-10]) et la fenêtre suivante, qui porte la suite, reste une abstention (81 cas sur le lot 1 dev).
6. **Prédire** : après un candidat retenu dont la dernière plage s'arrête au mot k < n, le texte attendu dans la
   fenêtre suivante (si rien n'y est retenu et si ce n'est pas une formule) est le reste du verset (k+1..n),
   avec un départ jusqu'à 3 mots plus tôt (reprise), suivi du verset suivant.
7. **Vérifier** : ce texte est aligné **à fin libre** sur la fenêtre (`ctc_forced_align(ends=…)`,
   `PassageAligner.align(free_end=True)` : l'alignement s'arrête à la fin d'un mot Uthmani, là où l'audio le
   soutient le mieux). Le meilleur départ est retenu.
8. **Deux témoins** : la preuve acoustique (même seuil) ET la transcription de la fenêtre, dont la similarité
   avec le texte aligné (Dice des lettres normalisées) doit atteindre 0,6. Mesuré : l'audio seul laissait
   passer un mot de fin de verset sur de la parole non coranique que le modèle rend surtout en blancs
   (lot1-04 : 9:24 [22] sur « ليه يال لك هنا انتم », −0,55 par trame ; 12:23 [21] cinq fois sur un commentaire).
   Acceptée, la suite devient un candidat (seuil du décodeur, mots et temps de l'alignement) ; elle peut à
   son tour finir avant la fin du verset et se poursuivre dans la fenêtre d'après. Refusée : rien n'est nommé.
   Le décodeur fusionne les deux moitiés contiguës ou marque une reprise (`repetition`).
   `AcousticCheckConfig.continuation*`, désactivable ; trace `acoustic_checks[].kind = "continuation"`.

## Mesures — `docs/evaluation/acoustic-check-2026-10-20.md`
Mêmes transcriptions, décision textuelle (ADR-0007) contre acoustique :
- Micro (3 enregistrements × 3 moteurs) : 55:1-4 reconnus partout ; avec Muno, 1/3 → 3/3.
- EveryAyah (216 versets) : rappel 91,2 % → 96,8 %, 0 faux verset dans les deux cas ; débuts au
  mot près (médiane 63 → 21 ms) ; fins médianes 84 → 64 ms mais 64 ms en avance en moyenne.
- Dev : lot1-01 68 → 82 (Al-Qiyama récitée, une citation de 12:23), lot1-06 272 → 276 (21:62, 22:10,
  22:64, 23:50), lot1-09 inchangé ; aucun faux verset nouveau à la relecture ; les suites refusées
  sont des homonymes que le décodeur écartait déjà par le contexte.
- Suite d'un verset commencé (81 cas dev « verset commencé puis abstention ») : résolus 34 (texte) →
  47 (suites seules) → **57** ; 25 suites acceptées, toutes conformes à leur transcription ; EveryAyah et
  micro inchangés.
- **Bug corrigé en mesurant** : NeMo laisse l'encodeur en mode entraînement après `transcribe()` ;
  le treillis calculé ensuite (même FastConformer) tournait avec dropout et corrompait la BatchNorm
  (lot1-01 : 68 versets reconnus → 5). `model.eval()` avant chaque treillis, contrat sur le vrai modèle.

## Limites (ce que la preuve ne fait pas)
- **Un seuil absolu ne sépare pas les quasi-homonymes** : 23:78-79 posé sur 67:23-24 obtient
  −0,36 à −0,82 (accepté), une vraie suite de prière réverbérée −1,003 (refusée). C'est le décodeur
  (contexte) qui tranche entre deux suites parallèles, comme sous ADR-0007. Une comparaison
  **relative** des suites concurrentes sur les mêmes fenêtres en ferait un discriminant : non faite.
- Seuil (−1,0) et plancher (0,5) provisoires, à calibrer sur les annotations validées à l'oreille
  (étape A) ; `llr_per_frame` est dilué par les pauses d'un long passage.
- Fins de verset : bornées par l'énergie (`energy_ratio` 0,10, ADR-0006), plus tôt que les bords de
  fenêtre ; la référence de fin elle-même est une convention (son qui s'éteint).
- Coût : un treillis par fenêtre retenue et par suite ; 3,6 % du temps réel sur la prière lot1-06
  (RTX 5090, alignement en Python pur).
- Une suite sauvée peut finir sur un quasi-homonyme partiel (75:24 [1-2] « وَوُجُوهٌ يَوْمَئِذٍ » sur la
  reprise « وُجُوهٌ يَوْمَئِذٍ نَاضِرَةٌ ») : la fenêtre devient `uncertain`, jamais un faux verset nommé.
- Une réponse de l'orateur faite de mots du Coran (« بَلَى… » après 75:40 -> 46:33) reste nommée : les mots
  sont dits (étape D).
