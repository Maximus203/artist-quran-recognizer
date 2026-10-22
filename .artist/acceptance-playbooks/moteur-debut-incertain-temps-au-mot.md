# Acceptance playbook — début incertain promu par son voisin, début avant pause, temps au mot

Moteur (ADR-0010). Un scénario est validé par un test automatisé ou une mesure chiffrée, jamais à l'œil.
Niveaux : U = unitaire (pur), I = intégration (pipeline, corpus réel, audio factice), M = mesure sur audio réel
(`docs/evaluation/` ou description de la PR). Surface : moteur seul (aucun écran) ; l'interface lit `word_times`.

## MUST-PASS

| # | Niveau | Scénario | Résultat attendu | Test |
|---|---|---|---|---|
| P1 | U | `uncertain` 11:61 [1-10] suivi de `recognized` 11:61 [10-17] contigu | proposé à la promotion avec le candidat de 11:61, jamais celui de 7:73 | `test_neighbors.py` |
| P2 | I | Même cas, l'audio soutient le texte du corpus | `recognized`, `candidates: []`, `promoted_by: "neighbor"`, temps de l'alignement, 10 temps au mot | `test_pipeline.py::test_le_debut_ambigu_est_promu…` |
| P3 | U | `uncertain` APRÈS un `recognized` qui le prolonge, ou ouvrant le verset suivant | proposé (symétrique) | `test_neighbors.py` |
| P4 | I | Début avant pause mal transcrit (qualité < 0,5), suite 17:7 [8-13] reconnue, l'audio et la transcription le soutiennent | un seul passage 17:7 [1-13] `recognized`, `acoustic_checks[kind=head]` accepté | `test_pipeline.py::test_le_debut_avant_la_pause…` |
| P5 | U | Trou au milieu d'un verset entre deux morceaux reconnus | comblé sur l'audio, sans le mot déjà reconnu ni le mot suivant | `test_acoustic_verification.py` |
| P6 | U/I | Verset `recognized` avec temps mesurés | `word_times` (un par mot de `words`), `word_times_source: "ctc-alignment"`, premier début = `t[0]`, dernier fin = `t[1]` | `test_pipeline_output.py`, `test_acoustic_verification.py` |
| P7 | U | Verset `recognized` sans temps mesurés | `word_times_source: "interpolated"`, proportionnel à la longueur des mots, borné à `t`, contigu | `test_pipeline_output.py`, `test_word_times.py` |
| P8 | U | Ancienne sortie sans `word_times` | lue sans erreur (`word_times: None`) | `test_pipeline_output.py` |
| P9 | M | Session 5014015f (29 min, Hud 11:61-90) | l'intervalle 2 passe `recognized` ; aucun autre intervalle ne change de statut | description de la PR |
| P10 | M | EveryAyah concaténé (36 versets) | rappel non inférieur, 0 faux verset | description de la PR |

## MUST-FAIL (le système doit refuser)

| # | Niveau | Scénario | Comportement attendu | Test |
|---|---|---|---|---|
| F1 | I | Voisin `recognized` mais l'audio de la fenêtre dit autre chose | reste `uncertain` (I3), check `neighbor` refusé | `test_pipeline.py` |
| F2 | U | Plage à plus de 2 mots de chevauchement, ou plus d'1 mot perdu au raccord, ou écart > `merge_max_gap_s`, ou fenêtre écartée au milieu | aucune proposition | `test_neighbors.py` |
| F3 | U | Voisin `inferred` ou `uncertain`; deux plages à égalité qui prolongent le voisin | aucune proposition | `test_neighbors.py` |
| F4 | I | Sans modèle CTC, ou promotion désactivée | aucune promotion | `test_pipeline.py` |
| F5 | I | Début avant pause que l'audio ne soutient pas (autre riwaya, autre parole) | l'abstention reste, jamais un début forcé | `test_pipeline.py`, `test_acoustic_verification.py` |
| F6 | U | Début soutenu par l'audio mais pas par la transcription | non nommé | `test_acoustic_verification.py` |
| F7 | U | Formule (isti'adha, amin…) juste avant la suite | jamais prise pour un début de verset | `test_acoustic_verification.py` |
| F8 | U | `word_times` de longueur ≠ nombre de mots, chevauchants, hors de `t`, source inconnue | `RecognitionError` | `test_pipeline_output.py` |
| F9 | U | `uncertain` / `inferred` | aucun `word_times` publié | `test_pipeline_output.py` |
| F10 | M | Fichier sans Coran (cours, wolof) | **0** verset ajouté par rapport à avant | description de la PR |
