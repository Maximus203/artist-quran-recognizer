# L'écran « En direct » — conception

Complète `atelier-direction.md` (tokens, composants, codes visuels, « Encre & lapis »), `phase2.md`, `revue-humaine.md` et `export-sous-titres.md`.
C'est l'**étape 4** du plan de l'[ADR-0011](../adr/0011-detection-en-direct-sans-plage.md) (issue #84) : le brief de l'écran, avant toute interface.
**État (2026-10-24).** Conçu ici, **non codé**. Le moteur incrémental existe (étape 2) ; le service WebSocket `aqr.live/1` (étape 3) et l'écran
(ce document) restent à construire. **Aucun code dans `web/` ni `src/`.**

Prototypes statiques, données **factices** (ouvrir par un petit serveur statique ou en `file://`) : `prototype/live.html` (parcours animé, huit
scénarios), `prototype/live-etats.html` (tous les états côte à côte), avec `live.css`, `live-core.js` (le réducteur d'événements et le rendu),
`live.js`, `live-data.js`, `live-verses.js`, `live-etats.js`. Captures : `captures/live-*.png` (voir §13).

**Une phrase.** Le **calque** du correcteur : une seule carte « passage en cours » où l'on voit ce que le moteur sait, pas plus ; elle se précise au
rythme des mots, se tait quand elle n'est pas sûre, et montre toujours que l'écoute continue.

## 0. Décisions clés

1. **Une page à part, `/direct`, pas un mode de la revue.** Une session de l'atelier est un fichier dont l'audio est conservé ; le direct est
   éphémère. Deux modèles mentaux, deux pages. Entrées : onglet « En direct » dans la barre du haut (bureau), bouton-icône dans la même barre
   (mobile : on récite avec le téléphone), carte « Écouter en direct » dans « Nouvel essai ».
2. **Un seul passage actif (« le calque »), pas un fil de sous-titres.** Un verset sur trois environ n'est jamais nommé en direct (65 % nommés,
   `docs/evaluation/live-etape1-2026-10-23.md`) : un fil qui s'allonge mot après mot ferait croire à une transcription complète, ce qu'elle n'est
   pas. La carte montre l'état courant ; l'historique est une liste de **passages**, où un passage non nommé a sa place.
3. **Rien de coranique n'apparaît avant d'être sûr (I1, I3).** Candidats : le **nombre**, les **mots communs** entendus (texte du corpus), une
   place vide pour le mot suivant ; les pistes sont des **références sans texte**, dans un volet fermé. Le texte et la traduction d'un verset
   n'arrivent qu'au verrou. Une traduction avant verrou n'existe que si tous les candidats ont la même (cas des sosies exacts).
4. **L'attente est un état à part entière, pas un trou.** Le premier nom vient en médiane à 5,3 s (p90 9,1 s, jusqu'à 21 s sur voix difficile,
   `live-etape2-2026-10-24.md`) : l'écran montre en continu ce que le système sait (niveau sonore, durée, mots entendus, entonnoir de candidats,
   dernier verset terminé), puis dit sa patience à 6, 12 et 21 s. « Pas de verset nommé pour l'instant » est un **état normal**, rédigé pour
   rassurer sans mentir.
5. **Dégradation, correction, coupure : toujours visibles, toujours en clair, jamais effacées.** Un verset corrigé reste dans la liste, marqué
   « Corrigé » (son texte n'est plus affiché) ; le mode allégé est un bandeau permanent qui dit ce que ça change ; une coupure dit combien de
   son est gardé. **Rien n'est conservé par défaut** : le seul geste qui crée quelque chose est « Garder cet enregistrement » (→ import classique).

## 1. Concept et benchmark

**Concept** (avant le style). Message : *« je t'écoute, je te dis ce que je sais, et seulement ce que je sais »*. Contresens à éviter : un
sous-titrage qui devine (un faux nom est pire que pas de nom), un écran qui paraît planté pendant 5 à 20 s, ou une alerte rouge dès qu'un verset
n'est pas nommé. Métaphore : la **lecture d'épreuves sur calque**. Le calque est transparent tant que rien n'est sûr ; ce qui sèche (le verset
nommé) passe de l'encre fraîche (mots à venir en gris) à l'encre pleine (mots entendus). Procédé : **contraste** (le neutre est calme ; seul ce qui
change d'état attire l'œil) et **révélation** progressive.

### Références réellement ouvertes (pages lues pour ce travail)

| Référence | Geste retenu (adaptation) | Ce qu'on refuse |
|---|---|---|
| [Tarteel · « Introducing Mistake Detection »](https://tarteel.ai/blog/introducing-mistake-detection/) | Le suivi mot à mot en direct dans le texte du Mushaf ; l'annonce d'un retour **en moins de 200 ms** et d'une vibration à l'erreur donne la mesure de ce que les gens attendent d'un retour « en direct » | Un verdict binaire ; notre latence est de 5 s et la plage est libre : on ne promet pas la même chose, on la dit |
| [Tarteel · « Que signifient les couleurs ? »](https://support.tarteel.ai/en/articles/12414414-what-do-the-different-text-colours-mean) | Quatre couleurs (rouge, vert, jaune, brun) sans **aucun état neutre ou incertain** : c'est le trou que notre écran comble (candidats, déduit, non nommé). Leur propre aide note que le vert et le rouge des « passages semblables » ne veulent rien dire : on en retient qu'une couleur ne porte jamais deux sens | Le vert/rouge juste/faux ; chez nous le vert reste réservé à « Validé à l'oreille » et chaque état a un motif et un libellé |
| [Aide Google · Sous-titres instantanés (Live Caption)](https://support.google.com/accessibility/android/answer/9350862) | Dire d'avance **dans quelles conditions ça marche** (parole claire, peu de bruit, pas de musique) et que la fonction s'éteint toute seule en économie d'énergie : chez nous, la promesse d'attente avant de démarrer et la règle « une coupure se dit » | La boîte flottante déplaçable : ici la carte est fixe, on récite, on ne manipule pas |
| [Aide Google · Live Transcribe](https://support.google.com/accessibility/android/answer/9158064) | Un **indicateur de niveau sonore** comme seul signe minimal que le micro entend ; la connexion est nécessaire sauf hors ligne : on dit ce dont l'écoute dépend | L'absence de tout état « en cours d'affinage » : ici les mots stables et provisoires sont distingués |
| [MDN · `getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Les erreurs réelles (`NotAllowedError`, `NotFoundError`, `NotReadableError`, contexte non sécurisé) deviennent des écrans qui s'expliquent ; **la promesse peut ne jamais se résoudre** si l'on ignore la demande : l'état « Autorise le micro » n'a pas de minuterie | — |
| [MDN · Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) | Garder l'écran allumé pendant l'écoute ; le verrou est **relâché quand l'onglet passe en arrière-plan** et doit être repris : on le dit à la reprise (§6.7) | — |

**Non ouvertes ou sans contenu exploitable** (dit sans détour) : les recherches Dribbble (`voice-recording-app`, `live-transcription`) n'ont
renvoyé aucun contenu lisible ; l'aide Apple des sous-titres en direct (extrait tronqué), l'aide Otter (403), la page d'accueil de Shazam (aucun
état « écoute » ni « pas de correspondance » décrit), l'aide YouTube (sous-titres en direct non couverts) et le centre d'aide de Tarteel (liste
sans texte) n'ont rien apporté. La fonction « recherche vocale » de Tarteel n'est connue que par un extrait de résultat de recherche : non
comptée. Aucune page Awwwards n'a été ouverte (aucune catégorie pertinente). Le benchmark porte donc sur le **geste** (états, attente, erreurs de
micro), pas sur le style visuel, qui reste celui, déjà validé, de `atelier-direction.md`.

Inspiration ≠ copie : rien n'est repris tel quel. **Registre des directions artistiques** : non consulté ni alimenté (`ARTIST_SKILLS_ROOT` vide
dans cet environnement, serveur Obsidian refusant la connexion). Aucune nouvelle direction : l'écran reste dans « Encre & lapis » ; la note du
registre est à compléter par le mainteneur (§12, arbitrage 12).

### Deux partis pris

- **A — Le calque (recommandé).** Une carte « Passage en cours » qui change d'état sur place, à côté (bureau) ou au-dessus (mobile) d'une liste de
  passages. L'écran répond à « qu'est-ce que je sais maintenant ? ». Lisible à bout de bras, honnête sur le non-nommé, une seule chose à lire.
- **B — Le fil.** Un défilement continu de sous-titres, chaque passage s'ajoutant en bas. Familier (sous-titrage, Live Caption), mais : les
  passages arrivent 5 à 20 s en retard et par morceaux (le texte « saute » en bas pendant qu'on lit), un verset non nommé laisse un trou qu'on ne sait
  pas écrire, et le fil suggère une transcription intégrale. **Écarté** : le fil servirait un autre produit.

## 2. Parcours

```
 barre du haut ──▶ [En direct] ──▶ /direct · Prêt
                                       │ Démarrer l'écoute
                                       ▼
                         Autorise le micro (fenêtre du navigateur)
              refus / pas de micro / occupé / http ─▶ écran d'erreur qui s'explique (réessayer)
                                       │ accordé
                                       ▼
                         Connexion (READY) ── service complet ─▶ erreur + essai auto
                                       │ aucun son n'est parti avant
                                       ▼
        ┌────────────────────── Écoute ◀─── Pause ⇄ Reprendre
        │  niveau 0 → 1 → 3/4 → « verset terminé » → …   (+ saut, parole, non nommé, correction)
        │  mode allégé ─ bandeau permanent        connexion perdue ─▶ son gardé ─▶ rattrapage
        ▼                                                    └ trop longtemps ─▶ session expirée
   Arrêter ─▶ Fin en cours (paliers 2 et 3 sur le tampon) ─▶ Écoute terminée
                                                              ├─ Garder cet enregistrement ─▶ import classique, analyse complète
                                                              ├─ Copier la liste
                                                              ├─ Recommencer
                                                              └─ Ne rien garder (annulable 6 s)
```

### 2.1 Où est le bouton
| Surface | Rendu |
|---|---|
| Barre du haut, bureau | onglet « **En direct** » entre « Performance » et « Documentation », précédé d'un petit disque lapis (rempli = page courante) |
| Barre du haut, mobile | bouton-icône secondaire (disque lapis, `aria-label="En direct"`) à gauche de « + » ; le bouton « Nouvel essai » reste le primaire |
| « Nouvel essai » | carte au-dessus de l'enregistreur : « **Écouter en direct** — le moteur nomme les versets pendant que tu récites. Le son n'est pas conservé. » + bouton secondaire large. L'enregistreur actuel (« Enregistrer une récitation ») garde son rôle : enregistrer, réécouter, analyser ensuite. *(Carte décrite, non prototypée.)* |
| Liste des sessions | une session gardée depuis le direct porte la même icône micro que les enregistrements actuels ; son nom par défaut est « Récitation en direct » + heure |

Pas d'entrée dans une session ouverte : le direct n'est pas une vue d'un fichier.

### 2.2 Demande d'accès au micro
Le micro ne s'ouvre **qu'au clic** sur « Démarrer l'écoute » (jamais au chargement). Avant la fenêtre du navigateur, l'écran dit ce qui va se passer
et que rien n'est envoyé (« Étape 1 sur 2 · Autorise le micro »). **Pas de minuterie** : si la fenêtre est ignorée, l'écran reste là.
Sept erreurs, chacune dite en **cause · impact · quoi faire** (règle « une erreur s'explique ») : micro bloqué, page non sécurisée (http : le cas du
téléphone sur le réseau local), aucun micro, micro occupé, service complet (`server_busy`, message du service repris tel quel, essai automatique),
navigateur incompatible, problème interne du service (`internal`). Le texte exact est dans `prototype/live-data.js` (`LIVE_ERRORS`).

### 2.3 Démarrage, niveau sonore, durée
Démarrage en deux temps (« Étape 2 sur 2 · Connexion… ») : le micro est ouvert, **aucun son ne part avant `READY`**. Ensuite la console montre : point
rouge qui respire (« micro actif », convention de l'enregistreur actuel), **durée** (mono, `00:21`, horloge des échantillons), **ruban de niveau**
(40 barres, 5 s d'historique, calculé côté client, `aria-hidden`), **Pause** et **Arrêter**. Sur mobile la console est ancrée en bas (zone du pouce,
`safe-area`), libellé « Arrêter » toujours visible, « Pause » en icône.

### 2.4 État de connexion
Pastilles sous la console : « Micro actif » · « Connecté » (anneau, jamais le vert) · « Mode allégé » (ambre) · « Écran maintenu allumé » (bureau).
Une coupure ou un mode allégé ajoute en plus un **bandeau** qui s'explique (§6). Rien ne disparaît sans trace : la fin d'écoute rappelle les périodes
de mode allégé.

### 2.5 Pause, arrêt
**Pause** : micro coupé, durée figée, rien n'est envoyé, bouton « Reprendre » (primaire). **Arrêter** : un clic, sans boîte de dialogue ni annulation
(la reprise est une nouvelle écoute) ; l'état « Je termine l'analyse… » dure le temps que les paliers 2 et 3 finissent sur le tampon avant `FINAL`.

### 2.6 Ce qui reste
Le serveur ne conserve rien (ADR-0011, décision 4). Le **navigateur** garde l'enregistrement **en mémoire seulement**, le temps de la page, pour
rendre possible un seul geste : « **Garder cet enregistrement** ».

| Geste | Effet | Où ça vit |
|---|---|---|
| **Garder cet enregistrement** (primaire) | envoie l'audio comme un import classique (`POST /api/sessions?autorun=1`, `x-aqr-source-kind: microphone`), l'analyse complète démarre, la session apparaît dans la liste | session de l'atelier, avec audio |
| Copier la liste | texte des passages (références et temps), sans le son | presse-papiers |
| Recommencer | nouvelle écoute, efface la précédente de la mémoire | — |
| Ne rien garder | efface le son et la liste de ce navigateur ; **annulable 6 s** (même geste que la suppression d'un signalement) | — |

Quitter la page avec une écoute non gardée déclenche l'avertissement standard du navigateur. **Les résultats du direct ne sont pas réutilisés
pour la session gardée** : le lot reste la référence (ADR-0011 §6, exigence 6) et l'empreinte du fichier enregistré n'est pas celle du flux PCM envoyé,
donc l'import « résultat existant » ne pourrait pas la vérifier. À valider (§12, arbitrages 1 et 2).

## 3. Machine d'états du client

Le prototype le prouve : `LiveCore.stateAt(scénario, instant)` rejoue les messages et rend **le même état** à chaque appel (pur, déterministe) ;
c'est la forme à donner au magasin du client (réducteur, rejeu en test).

```
phases : idle → permission → connecting → listening ⇄ paused → ending → ended → (kept | discarded)
                  └ error ┘ (réessayer → idle)
parallèles : net ∈ {ok, lost, catchup} · degraded ∈ [] | [2] | [3] | [overload]
passage    : listen → cands → named | inferred → between → listen …   (+ unres, jump, nonquran)
```

| Message `aqr.live/1` | Effet sur l'état | Vue (carte « Passage en cours ») |
|---|---|---|
| `READY` | `conn = ok`, `degraded` initial | niveau 0 : « Je t'écoute » |
| `CANDIDATES` (`count` ≥ 2) | entonnoir (`trail`), mots communs, piste (`expected`) | niveau 1 : candidats |
| `LOCKED` `status: recognized`, `identity_basis: words` | verrou | niveau 3 : nommé |
| `LOCKED` `status: inferred`, `identity_basis: context` | verrou déduit | niveau 4 : déduit de la position |
| *`PROGRESS`* (proposé, §9) | `words_heard` du verset en cours | surlignage mot à mot |
| `CONTINUE` (`closed`, `expected`) | le verset passe dans la liste | « Verset terminé, j'écoute la suite » |
| *`CONTINUE` avec `closed.status: uncertain`* (proposé) | un passage resté ambigu passe dans la liste | « Pas de verset nommé pour l'instant » |
| `JUMP` | efface candidats et attente | « Le passage change » (ou `GAP`, §6.5) |
| `LOST` `reason: non_quran` | efface candidats | « Ce n'est pas une récitation » (aucun verset) |
| `LOST` `reason: silence` | rien dans la liste | aide « Je n'entends rien » |
| `LOST` `reason: no_candidate \| below_threshold` | = passage non nommé | état normal, pas une erreur |
| `REVISION` | le verset de la liste change de statut | bandeau « Correction » 14 s + étiquette « Corrigé » |
| *`DEGRADED`* (proposé, §9) | `degraded`, retard | bandeau permanent « Mode allégé » |
| `END` → *fin en cours* → `FINAL` | `phase = ended` | « Écoute terminée » |
| `ERROR` | `phase = error` ou fin avec erreur | écran d'erreur qui s'explique |

Le client ne dérive **jamais** un nom de verset : il affiche `ref` quand un message le porte. `PARTIAL` alimente seulement le mode technique (§8).

## 4. Les niveaux d'affichage (ADR-0011 §3)

Légende commune, **identique sur l'écran et dans l'aide de l'écran « Prêt »** : une pastille à motif + un libellé (jamais la couleur seule).

| Niveau | Pastille | Condition | Ce qu'on voit | Ce qu'on ne montre **jamais** | Statut (I5) |
|---|---|---|---|---|---|
| **0 · Écoute** | — (anneau qui respire) | rien d'exploitable | « Je t'écoute. » ; compteurs « — » ; niveau sonore | tout texte coranique | — |
| **1 · Candidats** | **nouveau** : rayures verticales + trait pointillé fin, lapis (`s-pending`) | ≥ 2 hypothèses plausibles | le **nombre** (« 52 versets possibles »), l'entonnoir (« 52 → 7 »), les **mots communs** entendus en arabe suivis d'une place vide, « Pas encore nommé » ; piste (« la suite attendue serait 1:3, pas encore confirmée ») ; volet fermé « Voir les pistes (5 sur 52) » = références seules | le texte ou la traduction d'**un** candidat non nommé ; un nom de verset comme réponse | transitoire (ni `RECOGNIZED` ni `UNCERTAIN`) |
| **3 · Nommé** | aplat plein + trait plein, lapis | verrou par les mots | « Reconnu », `Sourate n:v`, arabe du corpus (entendus en encre pleine, **dernier mot entendu souligné**, à venir en gris), « 3 / 4 mots entendus », traduction QuranEnc **entière** + attribution | une traduction coupée (I2) | `RECOGNIZED` |
| **4 · Déduit de la position** | hachures 45° + trait en tirets (déjà dans la direction) | verrou par le contexte seul (sosies exacts) | « Déduit de la position », référence en italique pointillé, encart « Entendu, mais pas reconnu à la voix. Ce texte existe à l'identique en 56:96 et 69:52. Le numéro 56:74 vient de la suite de ce que tu venais de réciter. » | le badge « Reconnu » ; une formulation « reconnu » | `INFERRED` (`identity_basis: context`) |
| **Pas de verset nommé** | points + trait pointillé, ambre (code `uncertain` de la direction) | passage clos ambigu, ou `LOST no_candidate` | « Pas de verset nommé pour l'instant » ; les mots communs ; « Ce n'est pas une erreur… » | une confidence, un candidat | `UNCERTAIN` à la clôture |
| **Clos** | « Terminé » (contour) | `CONTINUE` | le verset reste affiché, atténué, avec sa traduction, jusqu'aux premiers candidats suivants | — | statut final |

Texte de l'état **« Pas de verset nommé »** (il rassure sans mentir) : *« J'ai entendu ce passage, mais plusieurs versets conviennent : je ne le nomme
pas plutôt que de risquer un faux nom. **Ce n'est pas une erreur.** En direct, un verset sur trois environ n'est jamais nommé (65 % nommés sur le
banc de test) ; les versets très courts en font partie. Si tu gardes l'enregistrement, l'analyse complète peut en nommer davantage. Je continue
d'écouter. »* Le chiffre est celui du banc, jeu optimiste (studio), cité avec sa réserve dans §13 ; sur voix réelle il est probablement moins bon.

**Traduction avant verrou.** Seulement si tous les candidats restants ont une traduction strictement identique (le cas des sosies : 56:74, 56:96 et
69:52 partagent texte et traduction). Elle est alors montrée **entière**, étiquetée « Traduction — la même pour les 3 versets possibles ». Sans cela,
aucune traduction. Le protocole actuel ne la porte pas (§9, écart 4).

**Mots communs absents.** Si les graphies diffèrent d'un candidat à l'autre, `heard.text` est absent : la carte montre le nombre et la mention « rien
de commun à montrer encore », pas de texte de substitution.

## 5. La latence de 5 à 20 s ne doit pas ressembler à un bug

Chiffres (`live-etape2-2026-10-24.md`, vérité calculée, calcul compris) : premier `CANDIDATES` **2,5 s** en médiane (p90 4,1 s) ; `LOCKED` **5,3 s**
(p90 9,1 s) ; premier texte provisoire 1,05 s ; sur voix réelle difficile le p90 du verrou monte à **21 s**. Le calcul n'y est pour rien (facteur
0,06) ; le délai vient des morceaux de 1,12 s et de la stabilité d'un mot. L'écran n'invente **ni pourcentage, ni barre de progression, ni « il reste
n s »** (comme la liste des sessions : « le temps affiché est réel »). Il fait trois choses :

1. **Il montre qu'il écoute.** Durée, ruban de niveau, anneau qui respire (statique sous `prefers-reduced-motion`) dès la première seconde.
2. **Il montre ce qu'il sait déjà.** Bande « Écoute · Mots entendus · Candidats · Dernier nommé » ; entonnoir des candidats (« 214 → 61 → 24 → 9 ») qui
   se resserre : c'est la progression réelle ; le dernier verset reste affiché (atténué) entre deux versets, pendant les ≈ 2,5 s avant les premiers candidats.
3. **Il dit sa patience, sans compte à rebours**, selon le temps écoulé depuis les premiers candidats du passage :

| Écoulé | Phrase (carte « Candidats ») |
|---|---|
| < 6 s | rien (c'est la médiane : 5,3 s) |
| 6 à 12 s | « Je continue d'écouter : il faut en général quelques mots de plus pour être sûr. » |
| 12 à 21 s | « C'est plus long que d'habitude : récitation lente, ou mots mal entendus. Je continue, rien n'est perdu. » |
| ≥ 21 s | « Toujours pas départagé. Ce passage est difficile à identifier en direct ; il restera peut-être non nommé, et ce n'est pas une erreur. » |

Les seuils 6 / 12 / 21 s sont des **valeurs de départ** (médiane, p90 propre, maximum observé), une configuration de l'interface, pas une mesure.
L'écran « Prêt » annonce la même chose **avant** de démarrer (« Compte environ 5 secondes avant un premier nom, parfois plus de 20 s… »).

## 6. Cas

1. **Récitation lente.** Aucun cas particulier de l'interface : un silence au milieu d'un verset n'est jamais une clôture (ADR-0011, risque 4), la carte
   garde son verset. L'entonnoir et les phrases de patience couvrent l'attente. Au-delà de 8 s sans son : « Je n'entends rien pour l'instant… rapproche le
   micro » (une aide, pas une erreur ; le dernier verset reste affiché).
2. **Répétitions.** `repetition: true` : étiquette « Reprise » sur la carte et dans la liste ; la carte repart du premier mot (fondu 160 ms).
3. **Parole non coranique** (`LOST non_quran`). Aucun candidat, aucun verset (I4). La carte dit « Ce n'est pas une récitation » ; la liste garde **une ligne
   neutre** (« Parole non coranique · Rien n'est affiché », pastille ardoise), jamais dans le compteur de versets.
4. **Saut vers un autre passage** (`JUMP`). La carte dit « Le passage change » + le genre de saut (« Tu reprends le verset précédent », « Tu reviens en
   arrière », « Des versets ont été sautés », « Autre passage ») ; **aucun nom** avant d'avoir entendu assez de mots (candidats ensuite). Le verset
   précédent n'est pas invalidé (ADR §4).
5. **`GAP`** (un trou : 43 `JUMP` sur 58 suivent un verset non nommé, `live-etape2` §« Sauts et pertes »). **Dérivé côté client, sans nouveau message** :
   un `JUMP` de genre `skip` qui suit un passage clos non nommé n'ajoute pas de ligne « saut » ; le passage non nommé **devient** le trou et se dit
   « entre 1:2 et 1:4 ». Un `JUMP` d'un autre genre reste une ligne de séparation. À trancher avec Ibrahima : message explicite ou dérivation (§12, arbitrage 13).
6. **`REVISION`.** Transition douce et honnête : le bandeau « **Correction.** 1:5 n'est plus nommé : la vérification acoustique n'a pas confirmé ces
   mots. Le passage reste dans la liste, marqué « corrigé », et son texte n'est plus affiché. » (14 s, `role="status"`). Dans la liste : étiquette ambre
   « Corrigé », statut « Nommé puis retiré · incertain après vérification », corps replié sans texte. **On n'efface jamais** et on ne barre pas le texte
   arabe : on cesse de l'afficher, parce qu'un passage plus sûr ne doit plus se lire comme tel (I3).
7. **Mode allégé** (paliers 2 et 3, surcharge, ADR §7). Bandeau permanent, jamais refermable :
   palier 2 « je saute la vérification acoustique en fin de verset » ; palier 3 « je ne réécoute pas les passages douteux : une correction peut arriver
   plus tard, ou ne pas arriver » ; surcharge « l'analyse a 5,3 s de retard : les mots arrivent plus tard ». Toujours : *« Pour rester sûr, je demande plus de
   mots avant de nommer un verset. Ce que ça change : les noms arrivent plus tard, et un verset très court peut ne pas être nommé. Ce n'est jamais moins
   sûr : la règle ne s'assouplit pas. »* Un verset de 3 mots (1:6) n'atteint plus le minimum : c'est montré (« Passage non nommé à cause du durcissement »).
   Retour à la normale : annonce « Retour au mode normal » et trace dans la fin d'écoute.
   *Aujourd'hui aucun contrôle des paliers 2 et 3 n'est branché (`live-etape2` §« Mode dégradé ») : tant qu'ils ne le sont pas, rien n'est « sauté », donc
   rien à afficher ; la surcharge, elle, existe.* Ce que ce serveur sait faire en direct (vérification, réécoute) va dans le volet « À propos de cette écoute » (arbitrage 14).
8. **Connexion coupée et reprise.** Détectée par le client (fermeture du socket). Le micro **continue**, le client garde le son (32 Ko par seconde en
   PCM 16 kHz : 5 minutes ≈ 9,6 Mo). Bandeau : « Connexion perdue. Je continue de capter ta voix et je garde le son (12 s) pour le renvoyer dès que la
   connexion revient. » + nouvel essai automatique toutes les 5 s (« Nouvel essai dans 3 s ») + « Réessayer maintenant ». À la reprise
   (`START{resume:{session_id,last_seq}}`, `READY.audio_received_s`) : « Connexion rétablie. J'envoie le son gardé ; les résultats vont rattraper leur
   retard », pastille « Rattrapage en cours ». Trop longtemps : `ERROR session_expired` + `FINAL` partiel, l'écran « Écoute terminée » reprend ce qui
   avait été entendu et propose de **garder l'enregistrement local**, qui contient tout.
9. **Onglet en arrière-plan / écran verrouillé.** Le verrou d'écran est pris à l'écoute et relâché si l'onglet passe en arrière-plan ; au retour, bandeau :
   « L'onglet était en arrière-plan. Le navigateur a peut-être coupé le micro entre 00:10 et 00:18 : ce passage n'a pas été écouté. » (non mesuré :
   risque 6 de §11).

## 7. Fin d'écoute

Résumé honnête : durée, **versets nommés**, **passages non nommés**, périodes de mode allégé. La liste des passages reste affichée (du plus récent au plus ancien).
Premier élément du focus : le titre. Parcours « Garder » : envoi (barre réelle de transfert) → « dans la file d'analyse (n° 1) » → lien « Ouvrir mes sessions ».
Texte du bloc : *« Garder cet enregistrement ? Le son n'a pas été conservé : il est resté dans la mémoire de ton navigateur, et rien n'est enregistré sur le
serveur. Si tu le gardes, il est envoyé comme un import classique, analysé en entier (l'analyse complète peut nommer des versets que le direct n'a pas
nommés), puis rangé dans tes sessions. »*

## 8. Mode technique (interrupteur, désactivé par défaut)

Décision du mainteneur : `PARTIAL` n'est visible qu'en mode technique, jamais comme « passage entendu » (I1). Interrupteur `role="switch"` dans la
colonne latérale (touche `T`, désactivable), mémorisé dans `aqr.ui.v1`. Contenu : **transcription provisoire** (cadre pointillé, étiquette « sortie du
modèle, non vérifiée, jamais le texte du Mushaf », police sans-serif, jamais la police du Coran), derniers messages (`seq`, `t`, type, champs), retard de
traitement, son gardé côté client, paliers sautés, mot discriminant attendu (`next_word`), posterior. Rien de cela n'entre dans la région `aria-live`.

## 9. Ce que le protocole `aqr.live/1` doit ajouter (additif)

Constaté en construisant l'écran : le §6 de l'ADR ne suffit pas à tenir la promesse. Tous les ajouts sont additifs.

| # | Manque | Pourquoi l'écran en a besoin | Proposition |
|---|---|---|---|
| 1 | **Progression après `LOCKED`** | sans elle, pas de mot à mot : `LOCKED` ne donne `words_heard` qu'une fois | message `PROGRESS{ref, words_heard, t}` (≤ 4 Hz), avec les `word_times` des mots devenus stables |
| 2 | **Clôture d'un passage non nommé** | la liste honnête (un verset sur trois) a besoin de savoir qu'un passage est clos ambigu | `CONTINUE.closed.status ∈ {recognized, inferred, uncertain}`, `expected` peut être `null` |
| 3 | **Changement de dégradation en cours de flux** | `READY.degraded` ne parle que du départ ; « jamais caché » exige l'événement | message `DEGRADED{tiers, lag_s, t}` (le moteur émet déjà `DegradationChanged`) |
| 4 | Traduction commune des candidats | la règle de l'ADR (§3, « traduction partielle ») n'a pas de champ | `CANDIDATES.heard.translation` (QuranEnc intacte, id, version, attribution), présent seulement si identique pour tous |
| 5 | Délai de reprise | dire combien de temps une coupure est tolérée | `resume_ttl_s` dans `READY` |
| 6 | Durée de la fin | « Je termine l'analyse… » sans fin visible | `FINALIZING{pending_s?}` facultatif ; sinon état indéterminé sans minuterie |

## 10. Mise en page et composants

Mobile d'abord (375), puis 768, puis 1440. Tout vient de `tokens.css` ; les composants de `base.css` (boutons, badges, pastilles de statut) sont réutilisés.

| Zone | ≥ 1100 px | 768–1099 | < 768 |
|---|---|---|---|
| Titre, phrase d'accroche | haut de page | idem | l'accroche disparaît dès que l'écoute commence |
| Console (durée, ruban, Pause, Arrêter) | carte en tête de la colonne principale | idem | **barre ancrée en bas** (`position: fixed`, `safe-area`), 76 px |
| Pastilles d'état, bandeaux | sous la console | idem | sous le titre |
| Carte « Passage en cours » | colonne principale | colonne unique | colonne unique, **avant** la liste |
| « Ce que je sais déjà » | sous la carte, 4 colonnes | 4 colonnes | 2 × 2 |
| Liste « Passages », mode technique | colonne latérale 400 px (collante) | sous la carte | sous la carte |

- **Carte** : `surface-2`, rayon 18, filet clair intérieur. Arabe centré, `lang="ar" dir="rtl"`, `font-family: var(--font-quran)`, taille `--quran-size` (32 px mobile,
  40 px bureau, A− / A+ de 28 à 72, mémorisés), interligne `--quran-lh`. Mot entendu = `--text` ; mot à venir = `--text-3` ; **dernier mot entendu = fond
  `--live-fill` + trait 3 px `--live-edge`** (jamais la couleur seule). Signes de pause attachés au mot précédent (comme `lib/live-highlight.ts`). Aucun
  défilement automatique.
- **Mouvement** (`transform` et `opacity` seulement) : changement d'état de la carte en fondu 160–320 ms ; nouveau mot qui entre en fondu 200 ms ; point
  « micro actif » et anneau « j'écoute » qui respirent. `prefers-reduced-motion` : tout passe à l'état statique ; le ruban de niveau continue de se mettre à
  jour (c'est une information, pas une animation).
- **Police arabe.** La même préférence que partout (`data-quran-font`, `--quran-size`), donc **Hafs V30 quand elle est installée**. Elle n'est servie qu'à la
  **boucle locale** : sur un téléphone qui passe par le tunnel de test, l'écran retombe sur **Amiri Quran**. Le sélecteur doit le dire (« disponible sur l'ordinateur qui héberge
  l'atelier »). Le prototype n'embarque pas Hafs (licence) : il montre Amiri, Scheherazade et Noto.
- **Décalage audio.** La préférence `audioOffsetMs` compense la latence de **sortie** de l'appareil (écouteurs) quand l'atelier **joue** un son. En direct, il n'y a **aucune lecture** : la
  voix vient de la salle. **Le décalage n'est donc pas appliqué en direct**, et le surlignage suit « le dernier mot entendu » (qui traîne ≈ 1,25 s derrière la voix : c'est un indicateur de progression,
  pas un curseur de karaoké ; le libellé dit « entendus », jamais « en cours »). Il reprend son effet dans la session gardée.
- **Tokens ajoutés** (déclarés dans `prototype/live.css`, à reporter dans `tokens.css` **et** `web/app/tokens.css` dans la même PR : un test exige qu'ils soient identiques) : `--pend-fill`
  (`color-mix` accent 9 %), `--bars` (rayures verticales 1,5 px / 5 px) et `--rec` (= `--danger`, point « micro actif »), plus la pastille `s-pending`.
  Aucune autre valeur nouvelle. **Règle de pastilles étendue** : rayures verticales = « en cours d'écoute » ; hachures = déduit ; points = incertain.
- **Icônes** : SVG dessinées pour le projet, trait 1,6 px, bouts ronds : micro, micro barré, pause, lecture, direct, lien coupé, alerte, info, coche, cadenas, horloge,
  jauge, disquette, copie, rafraîchir, saut, œil barré. Aucun paquet interdit. **Polices** : celles de la direction (Instrument Serif, Atkinson Hyperlegible Next et Mono ; Amiri Quran).
  **Images** : aucune photo ; une illustration vectorielle (le fil, l'onde et le losange) en tête de l'écran « Prêt ».

## 11. Accessibilité et critères vérifiables (pour Ibrahima et Cherif QA)

| Critère | Valeur / test |
|---|---|
| **Région vivante unique** | `role="status"` poli, `aria-atomic`, hors écran. Annonces **sobres**, une seule à la fois, ≥ 2,5 s d'écart : « Écoute démarrée. » · « Verset nommé : Al-Fatiha 1:2. » · « Verset déduit de la position : … Non reconnu à la voix. » · « Correction : 1:5 n'est plus nommé. » · « Connexion perdue. L'écoute continue. » · « Connexion rétablie. » · « Mode allégé : les noms arriveront plus tard. » · « Retour au mode normal. » · « Passage entendu, non nommé. Ce n'est pas une erreur. » · « Écoute terminée. » |
| **Jamais annoncé** | nombre de candidats, mots, niveau sonore, durée, texte arabe, `PARTIAL`. `role="alert"` seulement pour un écran d'erreur bloquant |
| Focus | jamais déplacé sans geste ; au démarrage il reste dans la console ; à la fin il va au titre « Écoute terminée » (`tabindex="-1"`) ; ordre : console → pastilles → bandeaux → carte → bande de compteurs → liste → mode technique |
| Clavier | tout est atteignable ; `Espace` = pause / reprendre (hors champs), `T` = mode technique, **aucun raccourci pour Arrêter** ; raccourcis désactivables (WCAG 2.1.4) |
| Contraste (mesuré, deux thèmes) | texte entendu 13,9:1 / 16,5:1 ; mot à venir (`--text-3`) 5,6:1 / 5,9:1 ; texte sur le mot surligné 9,8:1 / 11,9:1 ; trait du mot 6,6:1 / 7,6:1 ; texte ambre sur bandeau 7,4:1 / 5,3:1 ; pastille ambre 8,4:1 / 5,7:1 ; point d'enregistrement 6,6:1 / 5,7:1 (non-texte) ; ligne vide « mot suivant » 4,3:1. L'anneau « j'écoute » (≈ 2,5 à 2,7:1) est **décoratif**, doublé du titre « Je t'écoute » |
| Couleur seule interdite | chaque état = motif + libellé ; à vérifier par capture en niveaux de gris ; mode contraste forcé : contours système (`forced-colors`) |
| Mobile 375 px | aucun défilement horizontal (mesuré sur chaque capture du prototype : 0) ; cibles ≥ 44 px au tactile ; console ancrée en bas avec `safe-area` |
| Texte | `lang="ar" dir="rtl"` sur tout texte arabe ; A− / A+ de 28 à 72 px ; zoom 200 % sans perte ; les marqueurs `[n]` des traductions en exposant **à l'affichage seulement** (I2) |
| Mouvement | `prefers-reduced-motion` : anneau et point statiques, aucun fondu, ruban encore à jour |
| **Hooks e2e proposés** | `data-testid` : `live-start`, `live-pause`, `live-resume`, `live-stop`, `live-stage` (+ `data-view="idle|perm|conn|err|listen|cands|named|inferred|unres|jump|nonquran|between|end"`), `live-hist`, `live-notice`, `live-tech-switch`, `live-keep`, `live-discard` |

## 12. Arbitrages pour le mainteneur (défaut proposé)

| # | Question | Défaut proposé | Alternative |
|---|---|---|---|
| 1 | Que reste-t-il d'une écoute ? | **Rien** par défaut ; « Garder cet enregistrement » = audio + analyse complète, session ordinaire | une « session sans audio » avec les résultats seuls (inutilisable en revue : on ne peut pas réécouter) |
| 2 | Le navigateur garde-t-il le son en mémoire pendant l'écoute, pour rendre « Garder » possible ? | **Oui**, en mémoire seulement, jamais envoyé sans geste, dit avant de démarrer | case à cocher avant de démarrer (une étape de plus) ; sans mémoire, « Garder » disparaît |
| 3 | Montrer des **références** de candidats non nommés (sans texte) ? | oui, dans un volet fermé « Voir les pistes » | jamais de référence avant le verrou (plus strict, moins informatif) |
| 4 | Traduction commune avant verrou (sosies) ? | oui, entière, étiquetée | aucune traduction avant le verrou |
| 5 | Mode technique : pour tous ? | oui, interrupteur local, éteint par défaut | administrateurs seulement |
| 6 | Ajouter `PROGRESS`, `DEGRADED`, la clôture non nommée à `aqr.live/1` (§9) | oui, avant l'étape 3 | sans `PROGRESS` : verset entier sans surlignage mot à mot |
| 7 | Harmoniser la légende « Déduit » dans la revue | oui, dans la même PR : « Déduit de la position » (l'actuelle « Déduit · non entendu » devient fausse avec `identity_basis: context`) | garder deux sens |
| 8 | Décalage audio en direct | **non appliqué** (aucune lecture) | l'appliquer au surlignage seulement si on ajoute un retour audio |
| 9 | Pause | incluse (le micro se coupe, rien n'est envoyé) | non |
| 10 | `settle_s` 0,8 ou 1,5 s (laissé ouvert par l'étape 2) | **1,5 s** : p90 du verrou un peu meilleur (8,94 contre 9,07 s), 7 versets nommés de plus (315 contre 308), médiane +0,16 s sur 5,3 s, imperceptible | 0,8 s |
| 11 | Seuils de patience 6 / 12 / 21 s | valeurs de départ, en configuration | à recaler avec une vraie mesure |
| 12 | Registre des directions artistiques | à compléter par le mainteneur (note « Quran TR — En direct », *Proposée*) | — |
| 13 | `GAP` | dérivé côté client (§6.5) | message explicite |
| 14 | Dire ce que ce serveur fait ou non en direct (vérification acoustique, réécoute non branchées) | volet « À propos de cette écoute », pas dans la barre d'état | rien tant que ce n'est pas branché |
| 15 | Arrêt sans annulation | oui : la reprise est une nouvelle écoute | confirmation avant d'arrêter |

## 13. Données factices, limites, captures

- **Tout ce qui est chiffré dans les prototypes est inventé** : temps, nombres de candidats (« 52 », « 214 → 61 → 24 »), pistes, niveaux sonores, coupures, ordre des versets.
  Les huit scénarios sont **écrits à la main** d'après les règles de l'ADR-0011, ce ne sont **pas** des sorties du moteur. Seuls sont réels : le texte arabe (Tanzil, CC BY 3.0,
  non modifié), la traduction (QuranEnc `french_hameedullah`, non modifiée, avec attribution), lus dans des sorties réelles du moteur (`prototype/live-verses.js`), et les **ordres de
  grandeur** de latence (étape 2). Le bandeau « Démo · données factices » figure sur chaque page et sur chaque capture.
- Les 65 % de versets nommés et le p90 de 21 s viennent du banc de l'étape 1 et 2 (**jeu optimiste**, studio, aucune vérité terrain humaine) ; sur voix réelle, attendre moins. L'écran ne
  doit jamais les présenter comme des garanties.
- Non prototypé : la carte « Écouter en direct » de « Nouvel essai », l'avertissement de fermeture de page, le sélecteur de police arabe (repris tel quel de l'atelier).
- **Captures** (`docs/design/captures/`) : `live-<état>-d` bureau sombre 1440×900, `-clair-d` bureau clair, `-m` mobile sombre 375×812, `-clair-m` mobile clair. États à quatre
  variantes : `pret`, `candidats`, `nomme`, `deduit`, `non-nomme`, `fin`. États à deux variantes (bureau clair + mobile sombre) : `ecoute`, `latence`, `coupure`, `allege`, `correction`,
  `erreur-micro`, `technique`. Galerie : `live-etats-{a,b,c,d}-d` (bureau sombre) et `live-etats-{a,b,c,d}-clair-m` (mobile clair), sections « Avant l'écoute », « Pendant »,
  « Corrections, dégradations, coupures », « Après l'écoute ».
- États par l'adresse de `live.html` : `#sc=fatiha|lente|refrain|sauts|correction|coupure|expiree|surcharge` · `t=12.4` (fige l'instant) · `theme=light|dark` · `font=…` · `tech=1` ·
  `bench=0` · `err=denied|insecure|nomic|busy|server_busy|unsupported|internal`.

## 14. Correspondance avec le code et risques d'implémentation (pour Ibrahima)

| Fichier (proposé) | Travail |
|---|---|
| `web/app/(app)/direct/page.tsx` + `web/app/atelier/live/*` | page, console, carte, liste, bandeaux, mode technique ; **un réducteur pur** `live-store.ts` (le `live-core.js` du prototype en est la maquette), testé par rejeu de scénarios |
| `web/lib/live-protocol.ts` | types des messages `aqr.live/1` (avec les ajouts du §9), validation à la réception ; aucune donnée de texte fabriquée |
| `web/lib/live-audio.ts` | `getUserMedia` + `AudioWorklet` → PCM 16 kHz mono 16 bits, trames de 20 à 100 ms, tampon de coupure, `MediaRecorder` parallèle (mémoire) pour « Garder » |
| `web/app/atelier/header.tsx` | onglet « En direct » (+ bouton-icône mobile) ; `new-trial.tsx` : carte « Écouter en direct » |
| `web/app/atelier/live-text.tsx`, `lib/live-highlight.ts` | à réutiliser pour l'arabe : même alignement texte / `words`, signes de pause attachés ; remplacer « mot en cours selon le temps de lecture » par « mots entendus » |
| `web/app/tokens.css` et `docs/design/tokens.css` | trois jetons (§10), les deux fichiers ensemble |
| `web/lib/audio-upload.ts` | « Garder » réutilise l'import en flux avec `x-aqr-source-kind: microphone` |

**Risques.**
1. **Le micro exige un contexte sécurisé.** Le téléphone qui ouvre l'atelier en `http://192.168.x.x` n'aura **pas** de micro (état « page non sécurisée »). Les testeurs passent par le tunnel Cloudflare
   (https) ; vérifier que les WebSocket y passent et le **délai d'inactivité** du tunnel (non mesuré) : envoyer des trames même pendant un silence.
2. **Reprise audio.** Rééchantillonnage vers 16 kHz côté client (la fréquence du contexte n'est pas garantie, notamment sur Safari) ; tampon de coupure borné (5 min ≈ 9,6 Mo) ; aucun son perdu entre
   `audio_received_s` et le tampon. Cas à tester : coupure pendant un `LOCKED`, pendant la pause, pendant `END`.
3. **Téléphone verrouillé / onglet caché.** Le navigateur peut couper le micro ; le verrou d'écran est relâché au passage en arrière-plan. À mesurer sur de vrais appareils avant de promettre quoi que ce soit.
4. **Hafs V30 absente sur téléphone** (servie à la boucle locale seulement) : repli Amiri Quran, à expliquer dans le sélecteur.
5. **Capacité.** Environ 16 flux avec moins d'une seconde de retard sur la machine de développement (`live-etape2`, indicatif) : le chemin `server_busy` doit exister dès la première version.
6. **Rendu.** Réafficher l'arabe à chaque mot sans remplacer le DOM (clés stables par mot) pour ne pas perdre une sélection de texte ; mises à jour de l'interface à ≤ 4 Hz (le ruban de niveau à ≤ 8 Hz, `requestAnimationFrame`).
7. **Honnêteté du statut.** `INFERRED` ne doit jamais partager le libellé « Reconnu » ; `REVISION` ne doit jamais supprimer une ligne ; le texte d'un verset retiré n'est plus affiché.
8. **Libellés de la revue** : « Déduit · non entendu » doit devenir « Déduit de la position » (liste, légende, onde, export), sinon deux sens du même mot cohabitent.
9. **Vie privée.** Rien n'est écrit sur le disque du serveur ; l'enregistrement local n'existe qu'en mémoire ; le jeton du flux est de courte durée ; la voix d'une personne est une donnée : pas de journal du flux.
10. **Aucun seuil en dur** : 6 / 12 / 21 s, silence 8 s, nouvel essai 5 s, bandeau de correction 14 s vont dans une configuration unique de l'interface (`LIVE_UI`), comme `LiveConfig` côté moteur.

## 15. Registre

Note « Quran TR — En direct » à créer dans le coffre (`50-Creation/Directions-artistiques/`), statut *Proposée* : **non créée** (registre inaccessible depuis cet
environnement, voir §1). Direction : « Encre & lapis », inchangée ; ajouts : la pastille « en cours d'écoute » (rayures verticales) et le parti pris du calque.
