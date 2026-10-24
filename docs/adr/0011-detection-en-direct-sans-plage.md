# ADR-0011 — Détection en direct sur flux, sans plage déclarée

- Statut : **accepté** — décisions du mainteneur du 2026-10-23 ; **étape 1 (simulation hors ligne) livrée**,
  critère de sortie atteint en vérité calculée et sur la parole, non démontré sur la voix réelle (voir
  « Résultats de l'étape 1 ») ; **étape 2 (moteur incrémental) livrée** (voir « Résultats de l'étape 2 »).
  Étapes 3 et 4 : à faire.
- Précise : ADR-0004 (recherche sur le flux continu), ADR-0007 (preuve cumulée), ADR-0008
  (vérification acoustique), ADR-0009 (cascade), ADR-0010 (promotion par le voisin reconnu et temps au
  mot). Remplace la ligne « V2+ : mode temps réel » de
  `docs/ARCHITECTURE.md`.
- Décisions produit qui la fondent : voir `.artist/decision-log.md` (2026-10-23) et
  `docs/SYSTEME-EN-BREF.md` (« Direction produit »).

## Contexte
Le moteur actuel est **par lots** : il reçoit un fichier entier, le segmente, transcrit, cherche les
passages dans le flux de 77 433 mots du Coran (ADR-0004), confirme par la suite (ADR-0007) et par
l'audio (ADR-0008), réécoute les fenêtres douteuses (ADR-0009). Il sait que le passage peut venir de
n'importe où dans le Coran, mais il a **tout l'audio** avant de décider.

Direction produit confirmée par le mainteneur : l'objectif est de **détecter en direct, sur un flux
WebSocket, sans que l'utilisateur déclare une plage** (pas de mode « je récite de telle sourate à telle
sourate » comme chez Tarteel). L'analyse de fichiers reste le premier terrain d'essai.

Le problème propre au direct : **au début d'un verset on n'a entendu que quelques mots**, et beaucoup de
versets commencent pareil. Nommer `sourate:verset` après deux mots serait nommer un faux verset dans
des centaines de cas (invariant I3). L'idée du mainteneur, à formaliser :

> Au début d'un verset, plusieurs versets se ressemblent. Le système ne doit **pas** afficher tout de
> suite la sourate:verset : il garde les candidats ouverts, affiche ce qui est sûr (le passage entendu
> et sa traduction partielle), et dès qu'un mot départage il bascule vers la source exacte. Une fois un
> premier verset détecté, on sait que la personne continue : le verset attendu est le suivant. Si un
> début casse cette attente, c'est un saut vers une autre sourate ou un autre passage.

Briques déjà disponibles : un ASR streaming (Muno FastConformer ONNX, `adapters/muno_streaming.py` —
aujourd'hui rejoué fenêtre par fenêtre, caches remis à zéro, pas encore branché sur un flux), le matcher
de flux (ADR-0004), la vérification acoustique d'un texte connu (ADR-0008) et la cascade (ADR-0009). L'ADR-0010 ajoute aux versets reconnus un temps par mot (`word_times`, issu de
l'alignement CTC ou interpolé, `word_times_source`) : c'est la mesure du moment où chaque mot est dit, donc
celle qu'il faut pour chiffrer la latence d'un verrou.

## Décisions du mainteneur (décidé le 2026-10-23)
Les quatre questions ouvertes de la première version de cet ADR sont tranchées :
1. **`INFERRED` est accepté** pour « texte entendu, référence déduite de la position » (refrains, sosies
   exacts), avec `identity_basis: "context"`. Il n'est **jamais présenté comme reconnu** : l'interface le
   distingue de `RECOGNIZED` (`identity_basis: "words"`). Sans contexte, ces versets restent ambigus puis
   `UNCERTAIN` à la clôture.
2. **Valeurs de départ de simulation** : `prior` = 0,9 et `min_words_lock` = 3. Ce sont des paramètres de
   `LiveConfig`, pas des seuils figés : l'étape 1 les fait varier et le rapport donne ce qu'ils coûtent.
3. **La transcription provisoire (`PARTIAL`) n'est visible qu'en mode technique.** Elle n'est jamais le
   « passage entendu » (I1).
4. **L'audio d'un flux n'est jamais conservé par défaut.** Une conservation éventuelle sera une option
   explicite, pas un réglage implicite.

**Transport : WebSocket (`aqr.live/1`), pas WebRTC.** Le flux est une voix qui va du navigateur vers un
serveur que nous contrôlons : aucune traversée de NAT à négocier entre pairs (le serveur est joignable), un
codage Opus avec pertes ne servirait à rien (le modèle veut du PCM 16 kHz fidèle, et une perte de trame
change les mots), et WebRTC ajoute de la complexité sans contrepartie (signalisation, STUN/TURN, jitter
buffer, pile à embarquer côté serveur). WebSocket suffit : trames binaires PCM, messages JSON, reprise
par numéro de séquence. À rouvrir seulement si un besoin réel de pair à pair apparaît.

## Exigences
1. **Précision d'abord (I3).** Afficher des *candidats* n'est pas nommer un verset. Un verset n'est
   « verrouillé » que si les mots entendus (ou, à défaut, le contexte, signalé comme tel) le
   départagent. Le rappel s'obtient en attendant, pas en devinant.
2. **Texte du corpus uniquement (I1, I2).** Tout texte arabe affiché vient du corpus ; la
   transcription provisoire de l'ASR est étiquetée comme telle et n'est jamais le « passage entendu ».
   Une traduction n'est jamais découpée ni raccourcie (I2) : voir « traduction partielle » plus bas.
3. **Statuts de preuve explicites (I5).** Un état « ambigu : *n* candidats » est distinct de
   `UNCERTAIN` : le premier est **transitoire** (on écoute encore), le second est **final** (le passage
   est clos et reste ambigu).
4. **Non-Coran (I4).** Une parole non coranique ne produit ni candidats ni verrou.
5. **Latence.** Les candidats et le passage sûr apparaissent peu après chaque mot ; le verrou, peu
   après le mot qui départage. Aucune cible chiffrée n'est tenable avant mesure : la fenêtre de calcul
   du modèle streaming est de 112 trames de 10 ms (≈ 1,12 s, `muno_streaming.py`), ce qui fixe un
   plancher. Les cibles seront posées à l'étape 1 du plan.
6. **Cohérence avec le lot.** À la fin du flux, le moteur produit un document `aqr.recognition/1`
   identique à celui de `aqr recognize` : le direct est une vue anticipée, le lot reste la référence.
7. **Hafs seulement.** Un verset d'une autre lecture éventuellement reconnu reçoit simplement sa
   traduction ; aucune détection de riwaya.

## Ce que disent les chiffres
Script `scripts/analyze_verse_prefixes.py` (tests : `tests/test_analyze_verse_prefixes.py`) sur le corpus
Hafs Tanzil (6 236 versets, 77 433 mots du flux), même normalisation que le matcher (dictionnaire
Uthmani → imla'i, basmala du verset 1 retirée du flux). **Hypothèse idéale : l'ASR entend exactement les
mots. Ces nombres sont une borne basse ; avec des erreurs d'ASR il faut plus de mots, jamais moins.**
Le script n'écrit aucun texte coranique, seulement des chiffres et des références.

### A. Combien de mots pour distinguer un début de verset de tous les autres ?
Plus petit *k* tel qu'aucun autre verset ne commence par les mêmes *k* mots.

| | médiane | p90 | max | moyenne |
|---|---|---|---|---|
| Mots (5 947 versets qui ont un préfixe unique) | 2 | 5 | 18 (4:48, 4:116) | 2,81 |
| Lettres (sans les espaces) | 7 | 18 | 69 | 9,36 |

| Versets résolus en au plus … mots (sur 6 236) | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|
| Part | 17,2 % | 54,1 % | 74,3 % | 83,1 % | 88,2 % | 91,0 % | 93,4 % | 94,4 % |

- **289 versets (4,6 %) n'ont aucun préfixe unique** : 278 **sosies exacts** (97 groupes ; les plus gros
  : 31 versets pour le refrain d'Ar-Rahman, 11 pour celui d'Al-Mursalat et ses homonymes, puis 8, 8, 7, 6, 6, 6) et 11 qui
  sont le **début strict d'un verset plus long** (3:2, 55:1, 55:3, 19:88, 20:116, 26:90, 35:19, 70:9,
  79:13, 79:42, 84:7) : leur début seul ne dit pas si le verset s'arrête.
- **25,7 % des versets (1 605) exigent plus de 3 mots**, **11,8 % (736) plus de 5**. Les plus longs sont
  des formules longues partagées jusqu'au bout (4:48 et 4:116 : 18 mots ; 7:54 et 10:3 : 15).

| Début commun d'au moins … mots | groupes | versets concernés | tailles des plus gros groupes |
|---|---|---|---|
| 2 | 783 | 2 846 (45,6 %) | 90, 73, 32, 31, 28 |
| 3 | 532 | 1 580 (25,3 %) | 88, 31, 17, 16, 15 |
| 4 | 370 | 984 (15,8 %) | 31, 27, 12, 11, 10 |
| 5 | 243 | 579 (9,3 %) | 10, 8, 7, 6, 6 |

Le plus gros groupe à 3 mots (88 versets) est une tournure d'ouverture très fréquente : à ce stade, la
liste de candidats est une **famille**, pas une courte liste.

### B. Le passage démarre en milieu de verset
Plus petit *k* tel que ces mots ne commencent aucun autre endroit du Coran (n'importe quel mot de
départ) : médiane 3, p90 5, max 18 ; résolus en ≤ 1 / 2 / 3 / 5 / 10 mots : 10,0 / 45,2 / 69,2 / 86,2 /
93,4 % ; 346 (5,5 %) sans préfixe unique. Un début en milieu de verset coûte donc environ un mot de plus.

### C. Avec l'a priori « suite attendue » (6 122 versets de rang ≥ 2)
1. **Rivaux de la même sourate** (répétition, retour en arrière, saut dans la sourate) : médiane 2, p90
   3, max 18 ; résolus en ≤ 1 / 2 / 3 / 4 / 5 mots : 48,9 / 82,7 / 91,0 / 94,5 / 96,3 % ; 122 (2,0 %) sans
   préfixe unique dans la sourate.
2. Des 289 versets sans préfixe unique dans tout le Coran, **164 deviennent uniques dans leur sourate**
   (le contexte de sourate suffit) et **125 restent ambigus même dans la sourate** : refrains des
   sourates 26 (34 versets), 55 (32), 37 (13), 77 (10), 54 (7), 2 (5), etc. Ceux-là **ne se
   départagent jamais par les mots** : seule la position (suite d'un verset non ambigu) les nomme.
3. **Règle de Bayes à deux niveaux** : la suite reçoit l'a priori `prior`, le reste de la masse part pour
   moitié vers les autres versets de la sourate, pour moitié vers le reste du Coran. Mots nécessaires
   pour que la suite atteigne le posterior `tau` :

| `prior` | `tau` | 1 mot | 2 mots | 3 mots | jamais |
|---|---|---|---|---|---|
| 0,8 | 0,95 | 99,95 % | 99,95 % | 100 % | 0 |
| 0,8 | 0,99 | 87,9 % | 98,2 % | 98,6 % | 43 |
| 0,9 | 0,95 | 100 % | 100 % | 100 % | 0 |
| 0,9 | 0,99 | 97,4 % | 99,1 % | 99,2 % | 43 |
| 0,95 | 0,99 | 99,4 % | 99,4 % | 99,5 % | 31 |

**Ce que cela implique, honnêtement.** Avec un a priori fort, *un seul mot* fait basculer la suite : c'est
mathématiquement juste et **inutilisable tel quel** — l'a priori (0,8 à 0,95) est un paramètre de
simulation, pas une mesure ; une erreur d'ASR sur ce mot unique suffirait à nommer un faux verset. La
règle de verrou ci-dessous exige donc un minimum de mots *indépendamment* du posterior. Et **43 versets
(0,7 %) n'atteignent jamais 0,99** : l'a priori ne leur donne qu'une probabilité, jamais une certitude.

### D. Après une basmala entendue
Une basmala restreint le choix aux premiers versets des sourates (hors 1 et 9) et à 1:2 : 113 candidats ;
médiane 2 mots, p90 5, max 9 ; 17 n'ont aucun préfixe unique (ouvertures par lettres isolées : 2:1, 3:1,
26:1, 28:1, 29:1 à 32:1, 40:1 à 46:1 ; ouvertures identiques : 59:1, 61:1). La basmala est donc un
**signal de réinitialisation fort** (début de sourate), pas un identifiant.

### E. Rejeu en flux (expérience simulée, petite)
`--replay` rejoue 30 sorties `aqr.recognition/1` d'enregistrements EveryAyah déjà produites
(3 récitants × 10 sourates courtes ou moyennes ; 206 versets entiers, environ 70 distincts) comme un
flux : le temps de chaque mot est estimé à débit uniforme dans le verset reconnu (approximation grossière :
les allongements du tajwid la faussent ; ces sorties datent d'avant `word_times`), mots exacts, aucune latence d'ASR.

| | versets | jamais uniques | médiane | p90 | max | part du verset (médiane) |
|---|---|---|---|---|---|---|
| Durée des versets | 206 | | 7,8 s | 19,6 s | 31,7 s | |
| Sans a priori (début de passage) | 206 | 9 | 3,1 s | 6,1 s | 10,5 s | 36 % |
| Suite attendue (face aux rivaux de la sourate) | 177 | 6 | 1,5 s | 4,6 s | 8,6 s | 22 % |

Lecture : sans contexte, le verset est connu après un tiers de sa durée ; avec la suite attendue, après
un cinquième. C'est la preuve chiffrée de l'idée du mainteneur, **sur un échantillon étroit** (récitations
de studio, sourates courtes, Hafs). À refaire sur des audios réels dès que l'étape 1 aura son banc.

### Limites de l'analyse
Mots exacts (pas d'erreur d'ASR) ; normalisation du matcher (deux graphies Uthmani différentes qui se
confondent comptent comme identiques, comme pour le moteur) ; tous les versets pèsent pareil (pas de
pondération par la fréquence d'usage) ; le début de verset est supposé (B donne le cas milieu de verset) ;
le rejeu est un petit échantillon à débit uniforme. Le script utilise déjà `word_times` quand une sortie
récente le porte : refaire la mesure avec les temps réels est la première tâche de l'étape 1.

## Décision proposée

### 1. Un suivi d'hypothèses de position, pas une recherche à chaque instant
Le moteur tient, pour chaque flux, un ensemble d'**hypothèses de position** : « le passage en cours est
le verset *v*, on a entendu ses *j* premiers mots ». Chaque mot reçu de l'ASR met à jour le poids de
chaque hypothèse (vraisemblance tolérante, mêmes similarités de mots que le matcher : `word_similarity`).
Les poids sont normalisés en un posterior. Aucun seuil en dur : tout est dans une `LiveConfig`
calibrée sur le split `dev` (invariant de configuration).

### 2. Quatre classes d'hypothèses, avec leur a priori
| Classe | Quand | Hypothèses | A priori |
|---|---|---|---|
| **DÉBUT DE PASSAGE** | départ du flux, ou après `LOST`/`JUMP` | tous les débuts de verset (uniforme) ; en réserve, les départs en milieu de verset (index « n'importe où », mesure B) | faible par verset, répartie |
| **SUITE** | après un verset verrouillé | le verset suivant (ou, en fin de sourate, le premier verset de la sourate suivante après sa basmala) | **fort** (`prior`, à calibrer) |
| **SAUT LOCAL** | idem | répétition du verset, retour en arrière, saut dans la même sourate | moyen, réparti sur la sourate |
| **SAUT LOINTAIN** | idem | n'importe quel autre début de verset | faible, réparti |

Une basmala entendue réinitialise vers DÉBUT DE SOURATE (113 candidats, mesure D). Une répétition d'un
verset déjà vu pose `repetition: true` comme dans le lot.

### 3. Ce qui s'affiche, et quand (quatre niveaux)
| Niveau | Condition | Ce que voit l'utilisateur | Statut de preuve (I5) |
|---|---|---|---|
| 0. Écoute | rien d'exploitable | indicateur d'écoute | — |
| 1. **Ambigu : *n* candidats** | ≥ 2 hypothèses plausibles | le **passage entendu** (mots communs à tous les candidats, texte du corpus), le nombre *n* de candidats, les 5 meilleurs avec le **mot discriminant attendu** | transitoire, ni `RECOGNIZED` ni `UNCERTAIN` |
| 2. **Piste** | une hypothèse domine mais le verrou n'est pas atteint | « attendu : *v* » (typiquement la suite) | transitoire |
| 3. **Verrou** | règle ci-dessous | le verset exact, son texte et sa traduction | `RECOGNIZED` (les mots départagent) ou `INFERRED` (le contexte seul départage des sosies) |
| 4. **Clos** | fin du verset | l'intervalle final avec ses temps | statut final du lot ; un passage resté ambigu devient `UNCERTAIN` |

**Règle de verrou** (configuration, jamais en dur) : une hypothèse est verrouillée quand (a) son posterior
atteint `tau_lock`, (b) elle explique au moins `min_words_lock` mots entendus, quel que soit le posterior,
(c) aucune autre hypothèse n'explique aussi bien ces mots *sauf* des sosies exacts. Si (c) ne tient que
grâce à des sosies, le verrou porte `identity_basis: "context"` et le statut `INFERRED` : **le texte a été
entendu, la référence est déduite de la position**. Cela étend la définition de I5 (« inféré : jamais
entendu ») et demande l'accord du mainteneur (question ouverte 1).

**Traduction « partielle ».** QuranEnc fournit une traduction par verset ; la couper pour n'en montrer
que le début modifierait le texte (I2). Règle proposée : avant le verrou, afficher le passage arabe sûr
(texte du corpus, seulement si tous les candidats ont la même graphie Uthmani de ces mots) ; afficher une
traduction avant le verrou **seulement si tous les candidats restants ont une traduction strictement
identique** ; sinon, la traduction de chaque candidat n'est proposée qu'à la demande, entière et
étiquetée « si c'est *sourate:verset* ». Après le verrou : traduction du verset, comme dans le lot.

### 4. Suite attendue et saut
- Après `LOCKED(v)` puis clôture, le moteur émet `CONTINUE` avec la suite attendue et pondère SUITE.
- Un début **compatible** avec la suite (mots entendus expliqués par *v + 1*) alimente la piste puis le
  verrou (`basis` « context » ou « words » selon ce qui départage).
- Un début **incompatible** (la suite n'explique plus les mots entendus, son posterior passe sous
  `jump_floor`) émet `JUMP` et ramène l'ensemble à DÉBUT DE PASSAGE, en gardant SAUT LOCAL surpondéré
  pour la sourate courante. Le verset précédent n'est pas invalidé.
- Cas des **refrains** (125 versets sans préfixe unique dans leur sourate) : la suite d'un verset non
  ambigu est connue, donc le refrain est nommé `INFERRED` ; si le fil se perd en plein refrain, le moteur
  ne peut pas dire lequel (jusqu'à 31 candidats) : il le dit (`UNCERTAIN` à la clôture).

### 5. Découpage logiciel (couches et ports)
```
 interface (atelier, client WebSocket)
        │  messages aqr.live/1
 adaptateur WebSocket ── session, reprise, auth (adapters/ws)
        │
 application : LiveSession ── orchestre un flux (budget, mode dégradé)
        │            ▲
        │            └── ports : StreamingAsr (Muno ONNX, chunks) · AcousticVerifier (ADR-0008)
        ▼
 domaine (pur) : PrefixIndex (index des débuts + « n'importe où », construit depuis le corpus)
                 HypothesisTracker (états, a priori, posterior, règle de verrou) · LiveConfig
```
- **State** : `HypothesisTracker` (écoute → ambigu → piste → verrouillé → clos).
- **Strategy** : `PriorPolicy` (uniforme, suite, saut local), pour tester et calibrer chaque a priori seul.
- **Adapter** : un adaptateur par service externe (ASR streaming, WebSocket) derrière les ports de
  `domain/ports.py`. Le domaine n'importe rien d'externe.
- **Memento** : l'instantané du tracker permet la reprise et le rejeu déterministe des tests.
- **Observer** : le tracker publie des événements de domaine ; l'adaptateur les traduit en messages.

### 6. Protocole WebSocket `aqr.live/1` (proposé)
Une connexion = un flux. Messages JSON en texte, audio en binaire.

**Client → serveur**
- `START` : `{"type":"START","schema":"aqr.live/1","audio":{"encoding":"pcm_s16le","sample_rate":16000,
  "channels":1},"options":{"translation":"french_hameedullah"|"none"},"resume":{"session_id","last_seq"}?}`
- **trames binaires** : PCM 16 kHz mono 16 bits little-endian, taille libre (multiple de 2 octets ;
  20 à 100 ms conseillés). Le temps du flux est l'horloge des échantillons reçus, pas l'horloge murale.
- `END` : fin du flux ; le serveur vide ses tampons et répond `FINAL`.

**Serveur → client** (tous : `schema`, `type`, `seq` strictement croissant, `t` = temps du flux en s)
- `READY` : `{"session_id","audio_received_s","degraded":[]}` — accepte `START`, indique d'où reprendre l'audio.
- `PARTIAL` : transcription **provisoire** de l'ASR (`{"t":[a,b],"text","stable":false}`), étiquetée
  comme telle ; jamais le « passage entendu ».
- `CANDIDATES` : `{"state":"ambiguous","words_heard":k,"count":n,"heard":{"words":[1,L],"text"?},
  "items":[{"ref","posterior","class":"continue|repeat|local|far|start","matched":m,
  "next_word":{"index","text"}}…],"leader"?:{"ref","posterior","basis":"words|context"}}` — `heard.text` est
  le texte du corpus des *L* mots communs, présent seulement si la graphie est identique pour tous ;
  `items` est borné à 5, `count` donne le total ; `next_word` est le mot attendu qui départagera (texte
  du corpus).
- `LOCKED` : `{"interval":{…}}` où `interval` a **les champs d'un verset de `aqr.recognition/1`** (`kind`,
  `ref`, `words`, `partial`, `status`, `t` avec fin `null` tant que le verset n'est pas clos,
  `time_interpolated`, `confidence`, `candidates`, `repetition`, `text`, `translation`) plus
  `identity_basis` (`words`|`context`) et `words_heard`. Valeurs de `status` : `recognized`|`inferred`.
- `CONTINUE` : `{"closed":{interval final},"expected":{"ref"}}` — le verset est clos, la suite est attendue.
- `JUMP` : `{"from":"ref","reason":"mismatch_with_expected","kind":"repeat|back|skip|other_surah|unknown"}`
  — le début casse l'attente ; des `CANDIDATES` suivent.
- `LOST` : `{"reason":"silence|non_quran|no_candidate|below_threshold","t":[a,b]}` — mêmes raisons que les
  abstentions du lot ; l'état revient à DÉBUT DE PASSAGE.
- `REVISION` : `{"ref","t":[a,b],"status":…,"reason":"acoustic_check|relisten"}` — la vérification
  acoustique ou la cascade corrige une décision déjà émise (un verrou peut être retiré, jamais caché).
- `FINAL` : le document `aqr.recognition/1` complet (même contrat que le lot).
- `ERROR` : `{"code","message","recoverable","retry_after_s"?}` ; `message` est une phrase de français
  clair : ce qui ne marche pas, la cause probable, l'impact, ce que l'utilisateur peut faire — jamais un
  code brut. Codes : `bad_audio_format`, `unsupported_schema`, `session_expired`, `server_busy`, `internal`.

**Reprise.** Le serveur garde l'état d'une session (instantané du tracker, anneau des derniers
messages, derniers échantillons) pendant `resume_ttl_s`. Après une coupure, le client rouvre avec
`START{resume:{session_id,last_seq}}` ; `READY` donne `audio_received_s` ; le serveur rejoue les
messages manquants (`seq` > `last_seq`) et le client renvoie l'audio à partir de ce temps. Passé le délai,
la session est close avec `ERROR{session_expired}` et un `FINAL` partiel si des données existent.

**Sécurité et vie privée du transport.** Le serveur réutilise la validation d'hôte/origine de l'atelier
(précédent #68, DNS rebinding) et une authentification par jeton de courte durée émis par l'atelier
(comptes, PR #70) ; taille maximale de message et durée maximale de flux en configuration. L'audio du
flux n'est **pas conservé** au-delà de la session sauf option explicite (données de personnes).

### 7. Mode dégradé et budget (conditionnel au temps disponible)
Le budget n'est pas codé ici : il est conçu. `LiveBudget` mesure le **retard** (audio reçu mais pas
encore traité) et fixe, par palier, ce qui est exécuté :

| Palier | Condition | Exécuté |
|---|---|---|
| 1 (toujours) | — | ASR streaming + suivi d'hypothèses (peu coûteux, CPU) |
| 2 | retard < `lag_acoustic_s` | vérification acoustique du verset verrouillé à sa clôture (ADR-0008) |
| 3 | retard < `lag_relisten_s`, ou flux en pause | réécoute des fenêtres douteuses par les moteurs secondaires (ADR-0009), résultats en `REVISION` |

Règle de sécurité : **quand un palier est sauté, la règle de verrou se durcit** (`min_words_lock` et
`tau_lock` montent) et `degraded` le dit au client ; elle ne s'assouplit jamais. Après `END`, les paliers
2 et 3 peuvent finir leur travail sur l'audio mis en tampon avant d'émettre `FINAL`.

## Options écartées
- **Plage déclarée** (l'utilisateur annonce sourate et versets à l'avance) : contredit la direction
  produit ; l'a priori de plage rendrait le problème facile mais c'est précisément ce qu'on ne veut pas
  demander à l'utilisateur.
- **Diffuser les jetons de l'ASR comme résultat** (« ce que le modèle entend ») : texte non contraint,
  contraire à I1 et à I3. Seule exception : `PARTIAL`, étiqueté provisoire.
- **Attendre la fin de chaque verset avant d'afficher** : la médiane des versets est de 7,8 s (p90
  19,6 s) ; le gain du direct serait perdu.
- **Verrouiller dès qu'un a priori fort le permet** (un mot suffit à `prior` = 0,9) : fragile, une seule
  erreur d'ASR suffit à nommer un faux verset.
- **Un LLM ou une base vectorielle pour « deviner » le verset** : ADR-0001 et ADR-0003.
- **Quitter le suivi par posterior pour un arbre de décision de règles écrites à la main** : non
  calibrable, non testable en rejeu.

## Conséquences
- Un nouveau contrat public (`aqr.live/1`) à versionner et à documenter (`docs/`), compatible champ à
  champ avec `aqr.recognition/1` pour les intervalles.
- Le statut `INFERRED` change légèrement de sens (référence déduite, texte éventuellement entendu) :
  mise à jour de `docs/RECOGNIZE-OUTPUT.md` et de l'interface, après accord.
- L'atelier gagne un écran « En direct » : brief de Sofia **avant** toute interface (hors périmètre de
  cet ADR). Les niveaux 1 à 4 ci-dessus sont des états d'interface à concevoir, pas un dessin.
- Le service temps réel est du Python (modèles et domaine y vivent) ; l'atelier Next.js reste le client
  et l'émetteur du jeton. À confirmer à l'étape 3.

## Risques
1. **Faux verrou précoce** (I3) : un verrou sur un début ambigu qu'un mot ultérieur contredit. Parade :
   `min_words_lock`, `REVISION`, mesure « 0 faux verset nommé » comme critère de sortie de l'étape 1.
2. **A priori non calibré** : `prior`, `jump_floor`, `tau_lock` n'ont aucune mesure humaine derrière
   (étape A du plan non terminée). Ils restent en configuration et se règlent sur le split `dev`.
3. **Latence réelle inconnue** : le plancher du modèle streaming (≈ 1,12 s par bloc) et le coût de la
   vérification acoustique en direct ne sont pas mesurés.
4. **Pause dans le verset** : un silence au milieu d'un verset ne doit pas être pris pour une clôture ;
   le suivi se fonde sur les mots, pas sur les silences, mais le segmenteur du lot n'existe pas encore en
   flux.
5. **Réutilisation d'un verset connu en bloc** (récitation répétée mot à mot) : la suite attendue peut
   confirmer à tort un autre passage identique ; pris en charge par SAUT LOCAL et `repetition`.
6. **Vie privée** : un flux en direct est de la voix d'une personne ; pas de conservation par défaut.

## Résultats de l'étape 1
Rapport complet : `docs/evaluation/live-etape1-2026-10-23.md`. Sur 82 scénarios à vérité calculée
(492 versets, EveryAyah et mixages, **jeu optimiste**, aucune vérité terrain humaine) :
- premier `CANDIDATES` médiane 2,0 s / p90 3,8 s ; `LOCKED` médiane 4,8 s / p90 8,7 s (max 20,8 s) ;
  322 versets nommés sur 492 (65 %) ;
- **0 faux verrou**, 0 `REVISION` ; **0 verrou sur 3 600 s de parole réelle** ;
- décision du coordinateur du 2026-10-23 (I3 avant le rappel) : `min_lock_density` = **0,9** par défaut. Sans
  elle, la même mesure donnait 376 verrous, 1 faux (67:16 pour 67:17, mot fondu par l'ASR) et 8 verrous non
  confirmés sur la parole ; la densité coûte **54 verrous (14 %)** et allonge la queue (p90 +0,6 s).

**Critère « 0 faux verset nommé » : atteint en vérité calculée et sur la parole ; non démontré sur la
récitation réelle** : trois verrous hors de la sortie par lots sur 5 x 600 s (56:57 et 56:58 sans doute de
vrais versets, 42:14 suspect), faute de vérité terrain humaine. Ce qui reste est écrit dans le rapport.

Écarts avec ce qui est décidé plus haut : garde-fous du verrou ajoutés (milieu de verset, rival non
sosie, densité des mots, confiance, mots exacts) ; un début qui est la suite attendue entendue sans son
premier mot n'est plus un saut. `prior` 0,9 et `min_words_lock` 3 sont inchangés.

## Résultats de l'étape 2
Rapport complet : `docs/evaluation/live-etape2-2026-10-24.md`. Le port `StreamingAsr`, l'adaptateur Muno
incrémental (caches gardés d'un bloc de 1,12 s à l'autre, mêmes mots que l'adaptateur hors ligne), le
pipeline `LivePipeline` et le budget (`LiveBudget`) sont en place. Sur les 91 entrées du banc de l'étape 1,
avec le vrai modèle, CPU, 4 fils ONNX, blocs de 100 ms :
- **facteur temps réel 0,060** (ASR 0,052, suivi 0,009), retard maximal d'un bloc 0,36 s, aucune
  dégradation ; 0,21 sur une machine saturée par un autre processus ; **GPU sans intérêt** (ONNX CUDA sur le
  modèle int8 : 1,0) ;
- latence de bout en bout (calcul compris) : premier `CANDIDATES` **2,53 / 4,12 s**, `LOCKED` **5,30 / 9,07 s**
  (médiane / p90) ; premier texte provisoire 1,05 s, premier mot stable 1,92 s ; **0 faux verrou** sur 308
  verrous (322 à l'étape 1), 0 verrou sur la parole ; mémoire 780 à 870 Mio, stable ;
- les cibles de l'étape 1 (2,5 / 4,5 s et 6 / 10 s) sont **atteintes sur une récitation propre, non sur la
  voix réelle difficile** (p90 du verrou jusqu'à 21 s) ; le calcul n'y est pour rien (0,06 s), le délai
  vient des morceaux de 1,12 s et de la stabilité des mots (`settle_s`).

Écarts avec ce qui est décidé plus haut : `LiveSession` s'appelle `LivePipeline` ; `settle_s` (0,8 s)
est ajouté (80 ms coupait un mot sur trois, le CTC espaçant parfois les pièces d'un mot de plus d'une demi-
seconde) ; le §7 gagne un état de **surcharge** (palier 1 en retard) avec sa règle de verrou durcie ; les
contrôles des paliers 2 et 3 passent par le contrat `VerseCheck`, **sans adaptateur réel encore** (la
vérification acoustique et la réécoute ne sont pas appelables en direct). Découverte annexe : le suivi
comparait chaque mot nouveau à tout le vocabulaire (0,6 s par mot sur de la parole étrangère) ; corrigé
sans changer un résultat.

## Plan par étapes
Chaque étape a son playbook (`.artist/acceptance-playbooks/`) et ne démarre qu'avec l'étape précédente
verte. TDD strict.
1. **Simulation hors ligne — livrée (PR de l'issue #84), critère atteint en vérité calculée et sur la parole, non démontré sur la voix réelle.** Rejouer des fichiers comme un flux (sorties par fenêtre et mots de l'ASR,
   audio EveryAyah, dev réel, mixages avec parole non coranique). Construire `PrefixIndex`,
   `HypothesisTracker`, `LiveConfig` et les mesures : temps jusqu'au premier `CANDIDATES`, au `LOCKED`,
   nombre de faux verrous (**doit être 0**, I3), `JUMP`/`LOST` sur les mixages. Poser les cibles de
   latence. Aucun réseau, aucun modèle ajouté.
2. **Moteur incrémental — livré (PR de l'issue #84), cibles de latence tenues sur récitation propre, non
   sur la voix réelle difficile.** Adapter `StreamingAsr` (caches Muno conservés d'un bloc à l'autre) ;
   tests de contrat `tests/contract/` ; budget et mode dégradé (paliers, règle de verrou durcie ; les
   contrôles des paliers 2 et 3 restent à brancher).
3. **Service WebSocket.** `aqr.live/1`, sessions, reprise, authentification par jeton, cas négatifs
   (format audio faux, flux trop long, coupure, jeton expiré), documentation du contrat.
4. **Interface.** Brief de Sofia, puis écran « En direct » dans l'atelier ; parcours validé au
   navigateur, puis par Cherif QA.

## Questions ouvertes pour le mainteneur
Les quatre questions de la première version sont **tranchées le 2026-10-23** (section « Décisions du
mainteneur »). Tranchée aussi : la densité des mots du verrou (`min_lock_density`) vaut 0,9 au départ
(coordinateur, 2026-10-23). Reste ouvert : sa valeur sur de la voix réelle, à juger avec une vérité terrain
humaine.
