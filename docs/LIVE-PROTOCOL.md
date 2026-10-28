# Protocole `aqr.live/1` — détection en direct par WebSocket

Contrat entre le navigateur (ou tout client) et le service `aqr live-serve` ([ADR-0011](adr/0011-detection-en-direct-sans-plage.md),
étape 3). Le texte arabe vient toujours du corpus (I1), la traduction est celle de QuranEnc sans modification (I2), un
passage non nommé n'a jamais de texte (I3). Code : `src/aqr/live/protocol.py` (messages du client, erreurs),
`presenter.py` (messages du serveur), `src/aqr/adapters/ws/server.py` (transport), `client.py` (client de référence).
Les exemples ci-dessous sont des sorties réelles du service (traduction factice, temps arrondis).

## 1. Transport et sécurité
- **WebSocket** (`ws://127.0.0.1:8765/live` par défaut), pas WebRTC. Messages **JSON en texte** (serveur -> client et
  `START`/`END`), **audio en trames binaires** (client -> serveur). Pas de compression.
- Le service écoute sur `127.0.0.1` par défaut (`AQR_LIVE_HOST` pour changer, à vos risques). `GET /health` répond
  `{"status":"ok","streams":n,"capacity":m}` (même contrôle d'hôte, aucun flux).
- **Hôte et origine** (avant la poignée de main, réponse `403`) : l'en-tête `Host` (et `X-Forwarded-Host`) doit être un hôte
  autorisé (DNS rebinding), et l'`Origin` d'un navigateur aussi (le port n'est pas comparé : l'atelier et le service n'écoutent
  pas sur le même). Hôtes autorisés = la boucle locale ; `AQR_ALLOWED_HOSTS` et l'hôte de `AQR_PUBLIC_ORIGIN` s'y ajoutent
  seulement si `AQR_ACCESS_TOKEN` est défini, comme l'atelier. Un client sans `Origin` (outil, test) est accepté : il doit
  présenter un jeton valide. Autre chemin que `/live` : `404`.
- **Jeton de session**, jamais dans l'adresse : le client le demande à l'atelier (`POST /api/live/token`, cookie de session
  de l'atelier, corps `{"technical"?:bool}`) et le présente **une seule fois** dans `START.token`. Réponse de l'atelier :
  `{"schema":"aqr.live/1","token","expires_at","ttl_s":60,"url","technical"}`. Format `v1.<charge>.<signature>`
  (base64url), HMAC-SHA256 d'une clé partagée (`AQR_LIVE_KEY`, sinon fichier local `live-signing.key` créé au premier
  démarrage, jamais dans Git). Charge : `{aud:"aqr.live/1", sub:<compte>, jti, iat, exp, tech}` ; ni nom, ni audio, ni texte.
  Durée de vie courte (60 s, `AQR_LIVE_TOKEN_TTL_S`), **usage unique** (`jti` retenu jusqu'à l'expiration), lié au compte.
- **Quotas** : `max_streams` flux simultanés pour tout le service (défaut 16, mesuré à l'étape 2), `max_streams_per_account`
  par compte (défaut 2), `max_unauthenticated` connexions qui n'ont pas encore présenté de jeton valide (défaut 32). Une session
  coupée qui attend une reprise garde sa place. Refus : `too_many_streams` ou `server_busy` (avec `retry_after_s`).
- **Vie privée** : l'audio n'est **jamais** conservé (ni disque, ni journal, ni mémoire au-delà du bloc en cours). Le journal du
  service ne contient que des événements et des nombres (jamais jeton, audio, texte coranique ni traduction ; un compte y
  est un pseudonyme de 8 caractères). `FINAL.document.source.sha256` est l'empreinte du flux PCM reçu, calculée au fil de
  l'eau : ce n'est pas de l'audio.
- Les jetons déjà utilisés sont retenus **en mémoire** : un redémarrage du service les oublie (un jeton déjà consommé reste
  rejouable jusqu'à son expiration, 60 s au plus). Une connexion qui n'a pas encore présenté de jeton occupe une place
  limitée (`max_unauthenticated`) pendant `start_timeout_s` au plus ; au-delà, elle reçoit `server_busy` puis la fermeture 1013.

## 2. Déroulé d'un flux
```
client                                         service
  |-- GET /live (Upgrade) ------------------->  contrôle Host / Origin / chemin
  |-- START {token, audio, options} --------->  jeton, quotas
  |<-- READY {session_id, limits, ...} -------
  |-- trames binaires PCM (20 à 100 ms) ----->  CANDIDATES, LOCKED, PROGRESS, CONTINUE, JUMP, LOST, ...
  |-- END -------------------------------->     
  |<-- FINALIZING, [derniers événements], FINAL ; fermeture 1000
```
Le temps `t` de chaque message est l'**horloge des échantillons reçus** (secondes depuis le début du flux), pas l'horloge
murale. Toute connexion qui n'envoie pas `START` dans `start_timeout_s` (10 s) reçoit `start_timeout`.

## 3. Client -> serveur
**`START`** (premier message, texte, ≤ 4 096 octets) :
```json
{"type":"START","schema":"aqr.live/1","token":"v1.…",
 "audio":{"encoding":"pcm_s16le","sample_rate":16000,"channels":1},
 "options":{"translation":"french_hameedullah","technical":false},
 "resume":{"session_id":"…","last_seq":17}}
```
- `options.surah` (facultatif, entier 1 à 114) : **récitation guidée** (ADR-0015). Le service ne cherche que dans
  cette sourate et enchaîne ses versets ; absent = écoute classique, tout le Coran. Hors bornes : `bad_message`.
- `audio` est exigé tel quel ; `options.translation` : un identifiant QuranEnc connu ou `"none"` (défaut
  `french_hameedullah`) ; `options.technical` : demande `PARTIAL` (mode technique, éteint par défaut, ouvert à tous les
  comptes : l'atelier l'inscrit dans le jeton quand l'utilisateur le demande) ; `resume` : voir §6.
- **Trames binaires** : PCM 16 kHz, mono, 16 bits little-endian, **multiple de 2 octets**, de 2 à `max_block_bytes` (32 000,
  soit 1 s) ; 20 à 100 ms conseillés. Envoyer des trames même pendant un silence (délai d'inactivité des tunnels).
- **`END`** : `{"type":"END"}` ; le service vide ses tampons et répond `FINALIZING` puis `FINAL`. Une fermeture propre (code
  1000) sans `END` termine aussi le flux ; une coupure brutale le laisse reprenable (§6).

## 4. Serveur -> client
Enveloppe de tout message : `{"schema":"aqr.live/1","type":…,"seq":n,"t":secondes,…}`. `seq` est **strictement croissant** à
partir de 1 pour les événements ; `READY` et `ERROR` portent `seq` 0 (hors flux d'événements : jamais rejoués). Les champs
`span:[a,b]` sont des intervalles du flux. Dans un `interval`/`closed`, `t:[début,fin]` suit `aqr.recognition/1`.

**`READY`** — accepte `START`.
```json
{"schema":"aqr.live/1","type":"READY","seq":0,"session_id":"c0ZxUo2m3VnJ8pQ0yH4d1A","resumed":false,"last_seq":0,
 "replay_from":null,"audio_received_s":0.0,"audio_received_samples":0,"degraded":[],"technical":false,"resume_ttl_s":30.0,
 "limits":{"max_block_bytes":32000,"max_stream_s":3600.0,"max_silence_s":120.0,"idle_timeout_s":30.0,
 "resume_ttl_s":30.0,"recommended_block_ms":[20,100]}}
```
`degraded` : ce qui ne tourne pas en ce moment (`"overload"`, paliers sautés), utile à une reprise ; `technical` : le mode
technique est réellement actif (il faut le droit dans le jeton **et** la demande dans `START`, sinon `false`).

**`PARTIAL`** — transcription **provisoire** de l'ASR, **mode technique seulement**, jamais le « passage entendu » (I1) :
`{"type":"PARTIAL","seq":1,"t":0.4,"span":[0.2,0.4],"text":"ق","stable":false}` (seul texte non issu du corpus).

**`CANDIDATES`** — plusieurs versets restent plausibles (état transitoire, ni `RECOGNIZED` ni `UNCERTAIN`).
```json
{"type":"CANDIDATES","seq":5,"t":1.0,"state":"ambiguous","span":[0.2,0.65],"words_heard":1,"count":274,
 "heard":{"words":[1,1]},
 "items":[{"ref":"13:16","posterior":0.0061,"class":"start","matched":1,"next_word":{"index":2,"text":"مَن"}}],
 "leader":{"ref":"13:16","posterior":0.0061,"basis":"words"}}
```
- `heard` : les `L` premiers mots entendus que **tous** les candidats expliquent. `heard.text` (texte du corpus) n'est présent que
  si la graphie est identique dans chaque candidat comparé ; `heard.translation` (`text`, `translation_id`, `version`,
  `attribution`, `scope:"verse"`, QuranEnc intacte) seulement si la traduction du verset est identique pour tous (au plus 40
  versets comparés), et **seulement s'il y a au moins deux candidats** : un candidat seul qui n'a pas passé le verrou n'est pas
  nommé (I3), ni par son texte ni par la traduction de son verset entier. `heard` vaut `null` si aucun mot n'est commun. Un
  candidat non nommé n'a jamais de texte.
- `items` : au plus 5 candidats ; `count` est le total ; `class` ∈ `start|continue|repeat|local|far` ; `next_word` est le mot
  qui départagera (graphie du corpus), `null` si le verset est entièrement dit. Les rangs de mots (`index`) sont ceux du
  **corpus** (basmala du verset 1 comprise), comme dans `aqr.recognition/1`.
- `leader.basis` : `context` si le favori l'est par la suite attendue, `words` sinon.

**`LOCKED`** — un verset est nommé. `interval` a les champs d'un verset de `aqr.recognition/1` plus `identity_basis` et
`words_heard`.
```json
{"type":"LOCKED","seq":12,"t":2.0,"interval":{"kind":"verse","ref":"112:1","words":[5,8],"partial":true,
 "status":"recognized","t":[0.2,null],"time_interpolated":false,"confidence":0.9989,"candidates":[],
 "repetition":false,"text":"قُلْ هُوَ ٱللَّهُ أَحَدٌ","translation":{"text":"…","translation_id":"french_hameedullah",
 "version":"quranenc.com","attribution":"QuranEnc.com — …","scope":"verse"},"identity_basis":"words","words_heard":3}}
```
`t` se termine par `null` tant que le verset n'est pas clos. `status` : `recognized` (`identity_basis:"words"`, les mots
départagent) ou `inferred` (`identity_basis:"context"`, le texte a été entendu, la référence est déduite de la position :
**ne jamais l'afficher comme « reconnu »**). `words` : de l'entrée dans le verset jusqu'à son dernier mot ; `partial` est
est vrai si le passage ne commence pas au mot 1 (ou si le verset n'est pas couvert), exactement comme le lot. La
`translation` porte `segments` (et `fragment` si `partial`) quand le découpage de QuranEnc est fiable, comme dans
`docs/RECOGNIZE-OUTPUT.md`. Si la traduction
est indisponible, `translation` vaut `null` et `translation_unavailable` vaut `true` : un verrou n'attend jamais le réseau.

**`PROGRESS`** — un mot de plus du verset verrouillé a été entendu (surlignage mot à mot), un par mot stable
(environ 2 à 4 par seconde) :
`{"type":"PROGRESS","seq":14,"t":2.4,"ref":"112:1","words_heard":4,"words":[5,8],"word":{"index":8,"t":[1.7,2.15]}}`

**`CONTINUE`** — le passage est clos. `closed` est l'intervalle final ; `complete` dit si le verset a été dit jusqu'au bout ;
`expected` annonce la suite (`null` après 114:6 **ou quand le passage n'est pas nommé**).
```json
{"type":"CONTINUE","seq":15,"t":2.4,"closed":{"kind":"verse","ref":"112:1","words":[5,8],"partial":true,
 "status":"recognized","t":[0.2,2.15],"confidence":0.9989,"word_times":[[0.2,0.555],…],"word_times_source":"interpolated",
 "identity_basis":"words",…},"complete":true,"expected":{"ref":"112:2"}}
```
**Passage clos sans nom** (état normal, environ un verset sur trois) : `CONTINUE` avec
`closed.status:"uncertain"`, `closed.candidates` (références seulement), `text:null`, `translation:null`, `complete:false`,
`expected:null`, et `closed.candidate_count`. Il n'est jamais nommé (I3) : comme dans `aqr.recognition/1`, le `ref` d'un
intervalle `uncertain` n'est **pas un nom** (c'est le premier candidat), il ne doit jamais être affiché comme tel ; l'écran
lit `candidates` (au plus 20, le total est `candidate_count`).

**`REVISION`** — un verrou déjà émis est retiré (jamais caché) :
`{"type":"REVISION","seq":20,"t":9.1,"ref":"112:1","status":"retracted","reason":"contradicted"}`.

**`JUMP`** — le début casse l'attente de la suite : `{"type":"JUMP","t":12.0,"from":"112:1","reason":"mismatch_with_expected",
"kind":"repeat|back|skip|other_surah"}` ; des `CANDIDATES` suivent. **`GAP` n'existe pas sur le fil** : le client le
dérive quand un `JUMP` suit un passage clos `uncertain` ou un `LOST` (on ne sait pas d'où l'on saute).

**`LOST`** — le fil est perdu : `{"type":"LOST","t":15.0,"reason":"silence|non_quran|no_candidate"}` ; l'état revient à
« début de passage ». Aucune parole non coranique ne produit de verrou (I4).

**`BASMALA`** — une basmala en tête de passage (début de sourate, pas un verset reconnu : son `ref` 1:1 est celui du texte du
corpus, comme la zone `non_quran` de la sortie par lots) :
`{"type":"BASMALA","t":2.0,"basmala":true,"ref":"1:1","text":"…","translation":{…}}` (texte et traduction du corpus).

**`DEGRADED`** — le calcul ne suit plus (ou suit de nouveau) ; jamais un retard en silence :
```json
{"type":"DEGRADED","seq":30,"t":30.0,"tier":1,"overloaded":true,"lag_s":6.5,"skipped":["acoustic"],"reason":"overload",
 "lock_rule":{"min_words_lock":5,"tau_lock":0.995}}
```
`tier` : 1 suivi seul, 2 + vérification acoustique, 3 + réécoute (les paliers 2 et 3 n'ont pas d'adaptateur réel : seule la
surcharge existe aujourd'hui) ; `lock_rule` : la règle de verrou en vigueur, **durcie** (plus de mots, posterior plus haut),
jamais assouplie ; `reason` ∈ `tier|overload|recovered|lag_growing`.

**`FINALIZING`** — `END` reçu, le service termine : `{"type":"FINALIZING","seq":16,"t":8.0,"pending_s":null}` (durée inconnue :
`null`, pas de minuterie à afficher).

**`FINAL`** — le document **`aqr.recognition/1`** du flux : `{"type":"FINAL","seq":17,"t":8.0,"document":{…}}`.
`source.file` vaut `live:<session_id>` ; `intervals` contient les versets clos et les passages ambigus (`uncertain`, jamais de
texte), pas de zones non coraniques ni de vérification acoustique ; `warnings` le dit. Le lot reste la référence.

**`ERROR`** — `{"type":"ERROR","seq":0,"code":"token_expired","message":"…","recoverable":true,"retry_after_s"?:5}`. Le
`message` est une phrase de français clair (ce qui ne marche pas, cause probable, ce qu'on peut faire), jamais un code brut.

| `code` | Quand | Récupérable |
|---|---|---|
| `bad_message` | JSON illisible, message inconnu, trop gros, second `START`, audio hors flux | non |
| `unsupported_schema` | `schema` autre que `aqr.live/1` | non |
| `bad_audio_format` | `audio` différent de `pcm_s16le`/16000/1 | non |
| `bad_audio_block` | bloc vide, de taille impaire ou plus grand que `max_block_bytes` | oui |
| `stream_too_long` | durée au-delà de `max_stream_s` | oui |
| `silence_too_long` | plus de `max_silence_s` sans son (micro coupé) | oui |
| `idle_timeout` | aucune trame depuis `idle_timeout_s` (la session reste reprenable) | oui |
| `start_timeout` | pas de `START` dans `start_timeout_s` | oui |
| `token_invalid` / `token_expired` / `token_replayed` | jeton falsifié, expiré, déjà utilisé | oui (nouveau jeton) |
| `too_many_streams` | limite par compte | oui |
| `server_busy` | toutes les places prises, ou calcul dépassé plus de `stall_timeout_s` (`retry_after_s`) | oui |
| `session_expired` | reprise d'une session inconnue, terminée, expirée **ou d'un autre compte** (même réponse) | oui |
| `replay_unavailable` | l'anneau borné ne remonte plus assez loin | oui |
| `service_stopping` | le service s'arrête (envoyé avant la fermeture 1001) ; la session ne survit pas au redémarrage | oui |
| `internal` | erreur inattendue, consignée dans le journal | oui |

Après une erreur de flux (`bad_audio_block`, `stream_too_long`, `silence_too_long`, `server_busy`) le service envoie quand même
`FINALIZING` et `FINAL` (ce qui a été décidé n'est pas perdu), puis ferme en continuant de lire ce que le client envoie encore
(sinon la réinitialisation TCP détruirait l'erreur et le résultat). Codes de fermeture WebSocket : `1000` normal,
`1001` arrêt du service, `1008` refus, `1009` message trop gros (bibliothèque), `1011` interne, `1013` réessayer plus tard.

## 5. Contre-pression, gigue, budget
Chaque bloc est horodaté à sa réception (horloge du service) ; le retard — attente dans la file + calcul — alimente le budget
(ADR-0011 §7). Au-delà de `max_backlog_s` (20 s) d'audio en attente le service **cesse de lire** la connexion (TCP freine
l'émetteur, le tampon d'envoi du navigateur grossit) ; resté dépassé plus de `stall_timeout_s` (15 s) il refuse le flux
(`server_busy`) plutôt que de prendre un retard sans fin. Un retard qui grandit est dit (`DEGRADED`), jamais caché.

## 6. Reprise après coupure
**Seule une coupure SANS trame de fermeture (réseau perdu, processus tué) est reprenable.** Une trame de fermeture envoyée par
le client (page quittée, `ws.close()`, quel que soit le code) termine le flux et rend sa place : relancer est alors une
nouvelle écoute. Le service garde l'état d'une session `resume_ttl_s` (30 s) après la coupure et continue de traiter l'audio déjà reçu. Les
messages sont gardés dans un **anneau borné** (`ring_messages`, 500), **jamais de l'audio**. Pour reprendre, le client ouvre une
nouvelle connexion avec un **nouveau** jeton et `START.resume = {session_id, last_seq}` (le dernier `seq` reçu). Le service :
vérifie que la session est au même compte ; répond `READY{resumed:true, last_seq, replay_from, audio_received_samples}` ; rejoue
les messages de `seq` > `last_seq` dans l'ordre, sans doublon ; la connexion précédente éventuelle est fermée (1008). Le client
**renvoie l'audio à partir de `audio_received_samples`** (garder un tampon de coupure côté client). Si l'anneau ne remonte pas
jusqu'à `last_seq` : `replay_unavailable`. Passé le délai, la session est close ; une reprise tardive reçoit `session_expired`
suivi de son `FINAL` (une seule fois, `final_keep_s` = 120 s en mémoire du service). Il en va de même pour un flux terminé par
`END` dont le client n'a pas pu lire le `FINAL` : la reprise rend le `FINAL` seul, sans `ERROR`. **Les sessions ne survivent pas à
un redémarrage du service** (la reprise reçoit `session_expired`) ; un `last_seq` que le service n'a jamais émis est
`bad_message` (le client se trompe), pas `replay_unavailable`.

## 7. Réglages (`AQR_LIVE_*`, un seul endroit : `LiveServiceConfig`)
`HOST`, `PORT`, `MAX_STREAMS` (16), `MAX_STREAMS_PER_ACCOUNT` (2), `MAX_UNAUTHENTICATED` (32), `START_TIMEOUT_S` (10),
`IDLE_TIMEOUT_S` (30), `RESUME_TTL_S` (30), `FINAL_KEEP_S` (120), `MAX_BLOCK_BYTES` (32 000), `MAX_STREAM_S` (3 600),
`MAX_SILENCE_S` (120), `SILENCE_RMS` (0,002), `RING_MESSAGES` (500), `MAX_BACKLOG_S` (20), `STALL_TIMEOUT_S` (15). Clé :
`AQR_LIVE_KEY` ou `AQR_LIVE_KEY_FILE`. Atelier : `AQR_LIVE_URL` (adresse donnée au navigateur), `AQR_LIVE_TOKEN_TTL_S`.
Lancer : `pip install -e ".[live,muno]"` puis `aqr live-serve` (`--asr-threads`, `--warm-translations`).

## 8. Écarts avec l'ADR-0011 §6
- `t` des messages est un nombre (heure du flux) ; les intervalles s'appellent `span` (`PARTIAL`, `CANDIDATES`, `PROGRESS`).
- `START.token` (le jeton ne passe pas par l'adresse). `READY` : `seq` 0, `last_seq`, `replay_from`, `resume_ttl_s`, `limits`.
- Messages ajoutés : `PROGRESS`, `FINALIZING`, `DEGRADED`, `BASMALA` ; `LOST` n'a pas d'intervalle ; `REVISION` porte
  `status:"retracted"` ; le passage clos sans nom est un `CONTINUE uncertain` (pas de message `UNCERTAIN`) ; `GAP` est dérivé
  par le client.
- Codes d'erreur ajoutés : `bad_message`, `bad_audio_block`, `stream_too_long`, `silence_too_long`, `idle_timeout`,
  `start_timeout`, `token_*`, `too_many_streams`, `replay_unavailable`.
