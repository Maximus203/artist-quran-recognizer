# Artist Quran Review

**Atelier d’annotation et de validation des récitations**

Cadrage de l’interface web V1, destiné à l’agent qui l’implémentera. Document préparé le 7 octobre 2026 à partir de `develop@3aa4231cea338b2abcaac1db04c7603a1d3ca3ed`. Aucune interface n’est encore implémentée.

## 1 Objectif et décisions

Permettre à Cherif de déposer un audio, écouter les résultats du moteur et signaler simplement ce qui est faux. Chaque essai doit produire un bilan réutilisable pour améliorer et tester le système, sans altérer la prédiction originale.

Décisions retenues :
- Application locale **Next.js + TypeScript**, GSAP pour les transitions et wavesurfer.js pour la waveform
- Trois zones synchronisées : lecteur/waveform, grande carte arabe, timeline des segments
- Sidebar de signalement : point temporel ou plage, type d’erreur, description et correction attendue
- Boucle d’écoute avant confirmation, autosauvegarde, modification et annulation
- JSON généré automatiquement, annotations séparées, export d’un pack de test versionné et récupérable depuis le cloud
- Réutilisation du moteur Python et de son évaluation existante ; aucun réentraînement automatique

V1 : un fichier audio à la fois. Pas de microphone, streaming, URL distante, vidéo, compte utilisateur, hébergement public ou nouveau service payant. L’import d’un résultat JSON existant avec son audio est également prévu.

## 2 Ce qui existe et ce qui doit être créé

### Sources de vérité inspectées

- [CLI](../src/aqr/cli.py) : `aqr recognize FICHIER`, sortie `<nom>.recognition.json`, SRT/VTT
- [Contrat](RECOGNIZE-OUTPUT.md), [producteur JSON](../src/aqr/pipeline/output.py), [lecteur JSON](../src/aqr/eval/recognition.py)
- [Pipeline](../src/aqr/pipeline/pipeline.py), [renderer](../src/aqr/rendering/home_renderer.py)
- [Corpus et hashes](../data/corpus/LOCK.json), [défauts connus](KNOWN-ISSUES.md)
- [Évaluation](EVALUATION-METRICS.md), [script](../scripts/evaluate.py), [protocole d’annotation](ANNOTATION-DEV-SET.md)

Il n’existe actuellement ni application web, ni `package.json`, ni API HTTP, ni JSON Schema formel séparé. Le contrat est documenté et testé dans le code Python.

Le plan phase 8 prévoyait FastAPI avec une page simple ; `spec-v1.md` exclut encore le web. La demande actuelle retient Next.js/TypeScript pour l’interface, avec un service Python local. Aligner explicitement ces anciens documents lors de l’implémentation.

Ne pas confondre :
- **Existant** : `aqr.recognition/1`, `aqr.evaluation/1`, manifeste d’annotations et scripts Python
- **À créer** : UI, API de jobs, autosauvegarde, sidecar de revue, pack et adaptateur d’évaluation

## 3 Parcours utilisateur

1. **Déposer l’audio** : bouton ou glisser-déposer, nom/taille/durée, validation du format et des limites configurées
2. **Lancer la reconnaissance** : moteur/options visibles, traitement dans le service local
3. **Attendre le résultat** : état réel et temps écoulé ; aucun pourcentage fictif
4. **Écouter** : waveform, carte et timeline suivent le même lecteur, sans autoplay
5. **Signaler ou corriger** : sidebar simple, écoute en boucle, confirmation humaine
6. **Exporter le bilan** : prédiction, annotations, manifeste, provenance et rapport disponible
7. **Rejouer et comparer** : uniquement contre des annotations vérifiées et le bon audio

Les options reprennent les capacités réelles de la CLI. `--constrained` est indisponible ; Silero n’est jamais un repli silencieux. Whisper est le défaut actuel de la CLI, pas un choix démontré comme supérieur.

Le champ `timing` est un bilan après traitement. Une progression par phase nécessite une instrumentation nouvelle. Une annulation doit correspondre à un arrêt confirmé du job.

## 4 Les trois zones

### A Lecteur et waveform

Un seul élément audio, avec :
- Lecture/pause, temps courant/durée, recul/avance courts, segment précédent/suivant
- Vitesses 0,5×, 0,75×, 1×, 1,25×, 1,5× ; conservation de hauteur si disponible
- Zoom, vue globale, ajustement au segment et option « Suivre la lecture »
- Lecture du segment et boucle, marge d’écoute optionnelle explicitement affichée

Échelle continue en secondes. Affichage détaillé `mm:ss.SSS`, ou `hh:mm:ss.SSS` pour un audio long. Des graduations de minute à faible zoom restent de simples repères, jamais des cases de segmentation.

Un clic sur un segment sélectionne et cherche son début. Si le lecteur était en pause, il le reste ; « Lire ce segment » est explicite. L’exploration manuelle suspend l’auto-scroll jusqu’à réactivation.

### B Grande carte arabe

- Référence sourate:verset, statut, temps, badges partiel et répétition
- Texte Uthmani exact, diacritiques et marques conservés
- `lang="ar"`, `dir="rtl"`, taille réglable, hauteur suffisante pour les signes
- Temps et commandes en LTR ; aucune animation lettre par lettre
- Traduction optionnelle avec source, identifiant et version ; « Traduction du verset entier » pour un passage partiel

Le texte vient du corpus via le renderer, jamais de l’ASR. Le JSON fournit une plage de mots, **pas leurs timestamps** : le surlignage V1 reste au niveau du passage.

Sans résultat actif, afficher « Aucun résultat localisé à cet instant ». Ne pas laisser le dernier verset paraître encore actif. Le contexte précédent/suivant peut apparaître séparément.

### C Timeline et liste

- Piste principale : résultats localisés
- Piste distincte pour les hypothèses `inferred`, susceptibles de recouvrir une abstention
- Liste « Sans temps » pour `t: null`, sans seek inventé
- Filtres statut/erreurs/à revoir, sans modifier les données ni la lecture
- Détail repliable : champs originaux, candidats, score, avertissements, provenance et corrections

Chaque occurrence conserve son identité et son temps. Ne pas dédupliquer par référence, fusionner des répétitions ou prolonger un verset dans une pause. La liste permet les mêmes actions essentielles que la waveform.

## 5 États et honnêteté de l’affichage

| Donnée | Affichage |
|---|---|
| `verse / recognized` | Passage reconnu, texte canonique et temps du moteur |
| `verse / inferred` | Hypothèse par continuité, non reconnue dans l’audio ; temps interpolé signalé |
| `verse / uncertain` | Identification ambiguë, références candidates ; aucun texte choisi dans la carte |
| `non_quran` | Formule réellement étiquetée : basmala, isti’adha, takbir, amin |
| `abstention / silence` | Silence selon le moteur |
| `empty_transcript` | Aucun texte exploitable produit |
| `no_candidate` | Aucune correspondance trouvée |
| `below_threshold` | Score insuffisant pour nommer un verset |
| Aucun intervalle | Non déterminé |

Le pipeline ne classe pas encore généralement français/hadith/arabe courant. Une abstention ne devient donc pas automatiquement « non-Coran ». Le champ `ref` technique d’un `uncertain` n’est pas un verset reconnu.

Si hypothèse et abstention se chevauchent, montrer les deux sans promouvoir l’hypothèse. Le score s’appelle « score du moteur » : 0,97 n’est pas une probabilité de correction de 97 %.

## 6 Sidebar Signaler une erreur

Deux entrées :
- **Signaler ici** : capture le temps courant, sans fabriquer une durée
- **Sélectionner une plage** : début/fin par sélection ou saisie en secondes/millisecondes

Formulaire court :
1. Type : **Mauvais verset / Verset manquant / Répétition / Décalage temporel / Autre**
2. Description libre
3. Correction attendue, facultative au signalement : référence/plage de mots, début/fin ou nature du problème
4. **Écouter en boucle**, puis **Confirmer**

Un point seul convient à un signalement. Les corrections nécessitant une durée ne deviennent évaluables qu’après définition d’une plage. La boucle d’un point utilise une fenêtre d’écoute visible et modifiable, distincte d’une frontière de référence.

Les réglages avancés restent repliés. Ne jamais demander à l’utilisateur d’écrire du JSON. La correction d’une référence passe par le corpus ; elle ne réécrit pas le texte coranique.

Actions :
- Autosauvegarde du brouillon après chaque modification, état « Enregistré localement » ou erreur visible
- Modifier/annuler un signalement ; restaurer après rechargement seulement si les hashes correspondent
- Ajouter un passage manqué sans prédiction cible
- Ajuster des limites sur une couche de correction, avec régions originales verrouillées
- Confirmer explicitement après écoute ; un signalement non confirmé reste une observation
- Exclure un passage inaudible plutôt que forcer une réponse

Une sauvegarde locale n’est pas une sauvegarde cloud. Un échec de sauvegarde doit être visible avant de quitter ou changer d’audio.

## 7 Synchronisation et accessibilité

`audio.currentTime`, en secondes, est l’unique horloge. Waveform, curseur, carte et sélection active en dérivent. GSAP ne pilote pas une seconde lecture.

- Convention d’activation `start <= currentTime < end`
- Recalcul immédiat après seek, changement de vitesse/source et retour d’onglet
- Rafraîchissement visuel pendant la lecture en relisant le média, sans compteur temporel indépendant
- Préserver tous les intervalles actifs en cas de chevauchement autorisé
- Identité UI fondée sur hash du résultat + index original, jamais seulement sur `ref`
- Nettoyer média, URL locales, animations et abonnements lors du remplacement ; ignorer les réponses d’anciens jobs

Les trois décimales du JSON ne prouvent pas une précision acoustique à la milliseconde. Les bornes actuelles viennent des fenêtres du segmenteur.

Clavier/tactile :
- Noms accessibles, focus visible, commandes utilisables sans hover ni couleur seule
- Espace lecture/pause quand le lecteur a le focus ; ne pas intercepter un champ de saisie
- Flèches pour déplacement court, boutons explicites pour zoom/boucle/précédent/suivant
- Liste navigable au clavier, cibles tactiles confortables
- Pas de défilement imposé pendant une exploration ni d’annonce vocale à chaque image

GSAP : transitions discrètes de panneaux et carte, jamais de retard sur le statut actif. Respecter `prefers-reduced-motion` et garder toute fonctionnalité disponible sans mouvement.

## 8 Contrat et architecture à respecter

### Contrat existant

`aqr.recognition/1` :
- `source` : `file`, `sha256`, `duration_s`
- `engine` : `asr`, `segmenter`, `matcher`, `decoder`, `constrained`, `corpus`
- `decoder`, `timing`, `windows`, `warnings`, `intervals`

Un verset fournit `ref`, `words`, `partial`, `status`, `t`, `time_interpolated`, `confidence`, `candidates`, `repetition`, `text`, `translation`. Temps en secondes ; mots indexés à partir de 1, bornes incluses.

Ne pas confondre ce format avec l’ancien rendu par lots de `HomeRenderer.render`, qui utilise `items` et `time`.

**Absents aujourd’hui** : transcription brute, temps des mots, progression, identifiant de job, hash du résultat, commit complet du pipeline et hashes complets de toutes les dépendances dans le JSON. Toute métadonnée supplémentaire relève d’une enveloppe d’exécution nouvelle ; une valeur inconnue reste inconnue.

### Validation et import

Valider à l’exécution : schéma, discriminants, valeurs finies, bornes, durée, références, plages de mots, champs nulls et cohérence des statuts. Préserver l’ordre, les occurrences, avertissements et octets originaux.

Rattacher l’audio par SHA-256, pas par nom. Signaler les incohérences de durée sans étirer les temps. Une sortie d’extrait s’aligne sur cet extrait ; le décalage vers l’original exige une provenance explicite.

Les fichiers `*.redacted.json` du dépôt omettent texte/traduction. Ils testent la timeline ; afficher « Texte non inclus » ou consulter explicitement le corpus local vérifié. Ne rien combler par génération.

### Architecture proposée

- Frontend Next.js/TypeScript, composants client pour média et interaction
- Service Python local : jobs, moteur existant, corpus, conversion audio et évaluation
- API de jobs à spécifier : dépôt, lancement, état, annulation, média, résultat, export
- File bornée et polling simple ; modèle lourd hors navigateur et hors requête Next.js longue
- Dossier temporaire hors git, distinct des packs de test versionnés

Si l’original est illisible dans le navigateur, préparer un média dérivé local sans coupe temporelle et tracer sa relation au hash source. Vérifier les durées et l’alignement.

## 9 Corpus texte et bibliothèques

Corpus : Tanzil Uthmani, Hafs, 6 236 versets. Le [LOCK](../data/corpus/LOCK.json) conserve la provenance et le checksum. `simple-clean` n’est pas le texte de rendu.

Afficher l’attribution Tanzil Project et le lien [tanzil.net](https://tanzil.net), préserver les copies verbatim et notices selon [Text License](https://tanzil.net/docs/Text_License). Ne pas normaliser le texte arabe affiché. Le téléchargement local existant du corpus reste la référence.

QuranEnc : conserver texte, identifiant, version et attribution. `version: "quranenc.com"` est actuellement un identifiant de source, pas une révision éditoriale. Signaler les anomalies connues de `french_hameedullah` 42:3 et 42:4 sans correction silencieuse.

Aucune police arabe n’est fournie dans l’arbre inspecté : choisir une police libre adaptée à l’Uthmani, vérifier les glyphes et conserver sa licence, puis la servir localement.

Une future transcription brute doit rester dans un diagnostic distinct, étiqueté non canonique. Elle est indisponible dans le contrat courant.

Wavesurfer :
- Réutiliser le même élément média via `media`
- Régions moteur non déplaçables/non redimensionnables ; corrections sur une couche séparée
- Peaks pré-calculés et durée pour les gros fichiers, plutôt qu’un décodage intégral non borné dans le navigateur
- Lecteur et liste restent utilisables si la waveform échoue
- Vérifier les médias VBR/dérivés, virtualiser les longues listes, éviter le rendu global à chaque image
- Épingler une version et ses API ; la documentation consultée mêle encore exemples v7 et API v8

Sources officielles : [wavesurfer](https://wavesurfer.xyz/docs/), [média et options](https://github.com/katspaugh/wavesurfer.js/blob/main/src/wavesurfer.ts), [régions](https://github.com/katspaugh/wavesurfer.js/blob/main/src/plugins/regions.ts), [licence BSD](https://github.com/katspaugh/wavesurfer.js/blob/main/LICENSE), [Next.js client](https://nextjs.org/docs/app/api-reference/directives/use-client), [GSAP matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/), [currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime), [timeupdate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event).

## 10 JSON de revue et pack de test

### Séparer les objets

1. Résultat original `aqr.recognition/1`, immuable octet pour octet
2. Brouillon local puis révisions de revue immuables
3. Rapport calculé lié à une prédiction et une révision précises

Schéma proposé, **non implémenté** : `aqr.review/1`. Contenu minimal :
- Identité de session, schéma, date UTC, révision et révision précédente
- Audio : nom non sensible, hash, durée, provenance des extraits/dérivés si nécessaire
- Prédiction : fichier original, hash de ses octets, schéma, `engine` et paramètres `decoder`
- Versions pipeline/modèles/corpus/UI et hashes disponibles ; `null` avec raison si absents
- Cas, split connu, fenêtres écoutées et relues, exclusions
- Relecteur humain anonyme, confirmation, date et note
- Corrections : point/plage, type, description, correction attendue, état, zéro/une/plusieurs cibles originales pour insertion/suppression/découpe/fusion
- Référence vérifiée complète sur les fenêtres relues, y compris les résultats initialement corrects
- Évaluation : rapport/hash/paramètres, ou état non calculable et raisons

Un simple signalement n’est pas une vérité terrain. Exporter seulement les erreurs ne permet pas de mesurer le rappel : la référence doit couvrir tous les événements dans les fenêtres déclarées complètes. Les passages douteux sont exclus. La provenance « revue assistée par préannotation » reste enregistrée.

### Exporter le bilan

Bouton toujours disponible après un essai. Un bilan partiel s’exporte avec « Revue partielle, métriques indisponibles », jamais avec des taux inventés.

Destination proposée : `tests/fixtures/reviews/<case-id>/` :
- `manifest.json` : schéma du pack, cas/split, fichiers/hashes, provenance, droits, versions et commande de rejeu
- `predictions/<run-id>.recognition.json` : chaque résultat original
- `reviews/r0001.review.json`, puis nouvelles révisions
- `reports/<run-id>-r0001.evaluation.json` : rapports calculés
- Audio admissible ou référence de stockage versionné avec révision, taille et hash

Les JSON de test, annotations, manifestes et provenance **doivent être versionnés, pas ignorés**. Ne pas écraser les versions antérieures. L’export prépare le pack ; il ne pousse pas automatiquement sur GitHub.

Éviter secrets, chemins absolus et noms de personnes. Si un original ne peut être publié, le préserver dans un stockage versionné déjà autorisé ; une copie expurgée est un dérivé identifié, jamais un original modifié. Sans route admissible, signaler le blocage cloud.

### Audios et disponibilité cloud

Vérification actuelle :
- `.gitignore` ignore globalement wav/mp3/m4a/mp4/mkv/ogg/flac et `tests/fixtures/audio/files/`
- Les JSON dans `tests/fixtures/reviews/` ne sont pas ignorés
- `.gitattributes` ne configure pas LFS

La demande actuelle prévoit des audios réutilisables. Cela nécessite des exceptions ciblées aux règles historiques d’AGENTS.md, après contrôle de droits/confidentialité, sans lever les protections globales.

- Petites fixtures : Git normal si droits, consentements nécessaires, taille et confidentialité vérifiés
- Gros fichiers : LFS uniquement si outil, récupération cloud, quotas et coûts déjà autorisés sont vérifiés
- Sinon : manifeste + stockage déjà autorisé, révision immuable et hashes ; pas de nouveau coût/service
- Si aucune route n’est disponible : conservation locale et blocage explicite, sans perte silencieuse

Vérifier les chemins avec `git check-ignore -v` et `git ls-files`. Déclarer le pack accessible au cloud seulement après récupération propre de la révision, matérialisation de l’audio, vérification des hashes et rejeu du test. Les droits du lot existant restent à clarifier selon [RIGHTS.md](data-lots/RIGHTS.md).

## 11 Comparaison automatique et amélioration

### Réutiliser le socle existant

`scripts/evaluate.py` produit `aqr.evaluation/1` à partir du manifeste. Il vérifie le hash audio et exige une annotation humaine relue, ou l’exception synthétique prévue. Il réserve le test à `--final`.

L’adaptateur de revue doit préparer `expected`, `non_quran`, `annotation`, `annotated_windows` et réutiliser `aqr.eval`. Ne pas créer un second calculateur de métriques dans le frontend ni modifier automatiquement le manifeste versionné.

Attention aux noms : l’évaluateur attend `<id>.json`, la CLI produit `<nom>.recognition.json`. Résoudre cette correspondance dans un espace de travail sans altérer l’original.

Déjà mesuré :
- Faux versets : zone non coranique, mauvaise référence/mots, mauvais placement, absence de référence
- Omissions et causes, rappel
- Écarts signés début/fin, tolérance, médiane et maximum absolus
- Abstention sur les zones coraniques et facteur temps réel
- Effectifs, intervalles de confiance et avertissement d’échantillon insuffisant

Conserver les définitions de [EVALUATION-METRICS.md](EVALUATION-METRICS.md), dont la sélection des prédictions par leur milieu dans une fenêtre annotée. Afficher paramètres, cas refusés et prédictions manquantes.

### Compléments à implémenter

Un wrapper mince, nom indicatif `scripts/evaluate_review.py`, peut valider le pack et appeler l’évaluateur existant. Ajouter :
- Liste cliquable des erreurs et correspondance des occurrences
- Distinction compréhensible identification/omission/insertion, sans total à double comptage
- Diagnostic dédié des répétitions, avec tests de découpe/fusion : l’actuel `merged` ne constitue pas une métrique complète des répétitions
- Mesure de couverture partielle seulement si spécifiée et testée : actuellement les mots sont comparés par recouvrement
- Versionnement de tout changement de convention et conservation des anciennes métriques

`compare_engines.py` compare seulement l’accord entre deux moteurs. Il ne mesure pas leur exactitude ; vérifier le même audio par hash avant de l’exposer.

WER/CER : seulement avec une vraie transcription humaine et une sortie ASR brute comparables, une segmentation et une normalisation documentées. Le texte canonique n’est pas nécessairement tout ce qui a été prononcé. Le JSON actuel ne suffit pas ; comparer directement audio et JSON ne donne pas une vérité terrain.

### Boucle d’amélioration

Corrections confirmées dev → cas de non-régression → exécution baseline/candidat avec versions identifiées → comparaison des gains et régressions → test final réservé.

Le dépôt a actuellement dev/test par récitant. Un futur train doit rester disjoint par audio source et récitant ; tous les extraits/dérivés d’un original restent dans le même groupe. Aucun entraînement, choix automatique du meilleur moteur, réglage sur test ou publication de données n’est déclenché par l’export.

## 12 Sécurité et critères d’acceptation

### Sécurité

Service lié à la boucle locale ; aucune transmission d’audio à une API tierce. Limiter formats, taille, durée, ressources et temps. Noms de travail générés, arguments de processus structurés sans interpolation shell. Affichage textuel sûr des JSON importés.

Fichiers de travail privés hors git ; packs admissibles versionnés. Politique de conservation visible et nettoyage temporaire séparé des exports conservés. Erreurs de modèle/corpus/extraction/mémoire explicitement affichées. Aucun résultat d’un ancien job attribué au nouvel audio.

### Tests obligatoires

- Import complet et expurgé ; JSON invalide ; nombres non finis ; mauvais hash ; incohérence de durée
- Seek, vitesse, boucle, pause, fin, remplacement rapide, retour d’onglet, échec et annulation réelle
- Frontière 59,999 s → 60 s, longs fichiers, segments courts, `t: null`
- Répétitions, parties de verset, trou, ambiguïté et chevauchement inferred/abstention
- Texte arabe et diacritiques sans coupure, RTL/LTR, clavier, tactile et mouvement réduit
- Signalement ponctuel/plage, édition, annulation, autosauvegarde et reprise sur bon audio
- JSON original byte-identique après revue et export ; révisions conservées
- Revue partielle sans métriques, référence complète admissible, mauvais hash et test hors final refusés
- Résultats du wrapper identiques à l’évaluateur sur les fixtures communes
- Pack non ignoré, récupération cloud vérifiée, aucune publication/audio/coût implicite

Prévoir tests unitaires du parseur et des sélecteurs temporels, contrats Python/TypeScript, tests navigateur et non-régression moteur. Les commandes Python restent celles d’AGENTS.md ; documenter les commandes frontend quand elles existeront.

Ces tests constituent la définition à réaliser, pas une validation déjà exécutée.

## 13 Préparation et publication du document

Relevé GitHub le 7 octobre 2026 vers 22:14 UTC : propriétaire Maximus203, branche par défaut `develop`, aucune PR ouverte retournée par recherche et API directe, aucun CODEOWNERS dans l’arbre. Un travail local non poussé reste possible.

Préparer `docs/V1-INTERFACE-WEB.md` dans l’environnement retenu, vérifier la tête actuelle et les travaux concurrents. **Écriture locale autorisée ; aucun push implicite.** Si la publication est ensuite autorisée, branche documentaire et PR en brouillon vers `develop`, sans code, audio, fusion, déploiement ni release.

Après validation du cadrage, une PR par brique : contrat/orchestration, lecteur/affichage, revue/export, adaptation de l’évaluation. Respecter [AGENTS.md](../AGENTS.md).
