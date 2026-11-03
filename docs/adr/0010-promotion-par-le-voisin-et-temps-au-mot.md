# ADR-0010 — Promotion d'un début incertain par son voisin reconnu, et temps au mot dans la sortie

- Statut : accepté — 2026-10-22 (étape B, quatrième brique)
- Précise : ADR-0007 (preuve cumulée par la suite), ADR-0008 (vérification acoustique, temps au mot)

## Problème
Deux défauts relevés par Cherif sur la session 5014015f (Hud 11:61-90, récitation lente, ≈ 0,47 mot/s).

1. **Un début de verset reste « incertain » alors que sa suite est reconnue.** La fenêtre 21,5-35,7 s porte
   11:61 [1-10] ; son début ressemble à celui de 7:73 : le matcher propose les deux à égalité et le décodeur
   (Viterbi) marque `uncertain` (`candidates: 7:73, 11:61`). La fenêtre suivante, contiguë, est
   `recognized` 11:61 [10-17] : elle prolonge 11:61, pas 7:73. Cette preuve n'était jamais consultée.
   Causes : (a) l'incertitude du décodeur se mesure sur le score avant (`forward`) de la couche, donc sans
   l'information de la couche suivante ; (b) la preuve par la suite (ADR-0007/0008) ne relie que des plages
   qui ne se chevauchent pas (`last_word < first_word`) : ici le mot 10 est dans les deux fenêtres, la chaîne
   ne se forme pas.
2. **Les temps de la sortie s'arrêtent au verset.** L'interface ne peut pas surligner le mot récité.

## Décision
1. **Promotion par le voisin** (`aqr.decoding.neighbors`, pur). Une détection `uncertain` à côté d'une
   détection `recognized` est PROPOSÉE à la promotion si un candidat viable (score ≥ seuil du décodeur, une
   plage) de sa fenêtre, parmi les versets que le décodeur disait possibles, PROLONGE ce voisin :
   - même verset : la plage commence là où celle du voisin finit, avec au plus
     `NeighborConfig.max_overlap_words` (2) mots en commun ou `max_gap_words` (1) mot perdu au raccord ;
   - ou verset suivant, ouvert par son début alors que le voisin est fini ;
   - écart de temps ≤ `DecoderConfig.merge_max_gap_s` (5 s) et aucune fenêtre écartée au milieu ;
   - deux plages qui prolongent aussi bien le voisin (même score) ne départagent rien : aucune proposition.
   Symétrique (voisin avant ou après). Le voisin doit être `recognized` : un `inferred` ou un `uncertain` ne
   prouve rien.
2. **L'audio a le dernier mot (I3).** Le pipeline ne promeut qu'après `AcousticVerifier.verify_alone` : le
   texte du CORPUS de la plage est aligné sur le treillis CTC de la fenêtre et doit atteindre le même seuil
   que toute suite (`llr_per_frame` ≥ −1,0). Sans modèle CTC (`--no-acoustic-check`, poids absents), aucune
   promotion. Promue : la détection devient `recognized`, `candidates` vide, `promoted_by: "neighbor"`
   (statut de preuve : la suite et l'audio, pas le seuil du score), temps et mots de l'alignement. Refusée :
   elle reste `uncertain`. Trace : `acoustic_checks[kind="neighbor"]`.
   De proche en proche : une promotion peut en permettre une autre.
3. **La détection promue n'est pas refusionnée** avec son voisin (même verset, un mot en commun) : elle
   serait marquée `repetition` à tort par le décodeur, et la fenêtre garde son propre temps.
4. **Temps au mot** (additif, `aqr.recognition/1` reste lisible). `Candidate.word_times` et
   `Detection.word_times` portent le temps de CHAQUE mot de la plage, mesuré par le même alignement forcé
   (ADR-0006) ; le temps d'une plage est exactement celui de son premier mot au dernier. Les mots sont bornés
   à la fenêtre comme l'était déjà le temps du verset (+2,7 s mesurés sinon, Husary 67:4). Dans la sortie,
   pour un verset `recognized` :
   - `word_times: [[début, fin], …]` (un par mot de `words`, mêmes bornes, contigus ou séparés par une
     pause) + `word_times_source: "ctc-alignment"` ;
   - à défaut de temps mesurés (ou s'ils ne couvrent pas exactement `words`, ex. deux moitiés fusionnées avec
     un mot perdu au raccord) : une estimation proportionnelle à la longueur des mots du corpus, bornée à
     l'intervalle, avec `word_times_source: "interpolated"` ;
   - rien pour un verset `uncertain` (non nommé) ou `inferred` (jamais entendu) : un faux temps vaut moins
     que pas de temps.
   Le lecteur Python (`aqr.eval.recognition`) valide la forme (un temps par mot, croissants, dans `t`).
   **Jamais de chevauchement** (correctif du 2026-10-23, cas réel vitesse ×0,3 : deux fenêtres voisines
   qui se recouvrent de 50 ms plaçaient le mot 6 avant la fin du mot 5, et le lecteur rejetait tout le
   document) : `aqr.domain.word_timing.without_overlap` recoupe au milieu un recouvrement ≤ 0,1 s, à la fusion
   des moitiés comme à la sortie ; au-delà, les temps mesurés ne sont pas publiés. Le lecteur normalise de la
   même façon un résiduel ≤ `word_overlap_tolerance_s` (0,1 s) et refuse le reste.
5. **Début d'intervalle = début du premier mot aligné.** Vérifié sur le cas réel de Cherif (« début tardif »,
   55,1 s) : le bord de fenêtre n'est pas en cause. La RMS monte à 55,06 s ; le premier mot est placé à
   55,12 s ; ce que Cherif entend à ~54,8 s est une inspiration (RMS ≈ 2 % de la voix, 54,58-54,80 s),
   que ni l'alignement ni le segmenteur ne comptent comme parole. Élargir le treillis de 0,5 s à 1,5 s
   avant la fenêtre donne le même début (55,08-55,12 s). Aucune marge n'est donc ajoutée (elle ferait entrer
   dans le treillis la fin du verset voisin pour rien) ; la liste `word_times` garantit seulement
   `word_times[0].début == t.début` et `word_times[-1].fin == t.fin`.

6. **Le début d'un verset dont la suite est reconnue** (`head`). Cas signalé sur `lot2-05` (récitation
   avec pauses, autre riwaya) : « le récitant commence une partie du verset, fait une pause, continue »
   et la partie commencée n'est jamais reconnue. Miroir de la suite d'un verset commencé (ADR-0008,
   points 6-8) : une fenêtre sans verset retenu JUSTE AVANT un candidat retenu qui ne commence pas son
   verset reçoit le texte du CORPUS qui manque (du début du verset, ou, si un morceau du même verset est
   déjà retenu dans la fenêtre d'avant, du mot qui suit ce morceau, avec une reprise possible), poussé
   jusqu'à `continuation_reprise_words` mots après la coupure. Aligné à fin libre ; il doit atteindre le
   mot qui précède la suite (à `word_slack` près), atteindre le même seuil acoustique et que la
   transcription de la fenêtre lui ressemble (Dice ≥ 0,6) : les deux témoins, comme pour une suite.
   Trace `acoustic_checks[kind="head"]`, désactivable (`AcousticCheckConfig.head`).
   **Hafs uniquement (décision de Cherif)** : on ne cherche pas à lire le Warsh. Si l'audio ne soutient pas
   le texte Hafs (autre riwaya, autre parole), le début n'est PAS nommé et l'abstention reste : c'est le
   bon comportement, jamais un début forcé.

## Ce qui n'est PAS fait
- Le décodeur lui-même ne change pas : son test d'incertitude reste sur le score avant (une vraie
  comparaison avant-arrière — max-marginals — rendrait la promotion inutile sans audio ; elle déplacerait
  la décision hors de la vérification acoustique que cette ADR veut garder).
- Raccord plus lâche que `max_overlap_words`/`max_gap_words` (reprise de plusieurs mots, i'ada) : le voisin
  ne prouve plus la même parole.
- Seuils provisoires, à calibrer sur les annotations validées à l'oreille (étape A).
- `word_times` suppose le texte Uthmani de Tanzil (mots séparés par espaces) ; un mot du corpus sans symbole
  que le modèle peut émettre n'a pas de temps mesuré, et le verset passe à `interpolated`.
