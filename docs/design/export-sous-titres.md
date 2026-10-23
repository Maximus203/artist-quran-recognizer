# Exporter les sous-titres — conception et flux de correction

Complète `atelier-direction.md` (tokens, composants, codes visuels, « Encre & lapis »), `phase2.md` et `revue-humaine.md`.
**Conception seulement** : aucun code dans `web/` ni `src/`. Prototypes statiques (données factices, ouvrir par un
petit serveur statique ou en `file://`) : `prototype/export.html`, `prototype/corriger.html`, `prototype/export-etats.html`
(+ `export.css`, `export.js`, `export-data.js`). Captures : `captures/export-*.png`.

**Une phrase.** Le « bon à tirer » du sous-titre : avant d'envoyer le fichier à l'imprimeur, on relit en marge **uniquement ce qui
est ambigu dans l'arabe**, on corrige à l'oreille sans jamais réécrire la prédiction du moteur, et on peut passer outre — en
sachant exactement ce que ça coûte.

## 0. Décisions clés

1. **Une seule page « Exporter », deux colonnes.** À gauche le **contrôle de préparation** (« Prêt à exporter ? »), à droite les
   **réglages** avec l'aperçu en direct et, tout en bas, l'action. Sur mobile, deux onglets (« 1 · Vérifier », « 2 · Réglages »)
   et une barre d'actions fixée en bas. L'action primaire n'est jamais « Exporter » tant qu'il reste des ambiguïtés : c'est
   « Corriger le premier passage » ; « Forcer l'export… » est secondaire et passe par une confirmation.
2. **Ambigu = ambigu dans l'arabe imprimé.** Ce qui bloque dépend de ce qu'on exporte : une incertitude qui ne change ni les
   lettres ni la traduction (ex. 55:13 / 55:16, même texte) ne bloque rien tant que la référence n'est pas affichée. C'est la
   lecture littérale de « corrige ce qui est ambigu dans la partie arabe ».
3. **Le non coranique n'est jamais obligatoire.** Abstentions (tafsir, wolof, français) et formules : une seule ligne neutre,
   « 9 passages non coraniques ignorés », jamais dans la liste, jamais dans le compteur.
4. **Calque « décisions humaines ».** La prédiction (`prediction.recognition.json`) est immuable. Une décision est un document
   à part (`decisions.json`, `aqr.decisions/1`), accroché à l'intervalle par son **empreinte**. L'écran montre toujours
   « Moteur : … (figé) » et « Ta décision : … » côte à côte, et la décision s'annule d'un geste.
5. **Double valeur, sans tromperie.** Chaque décision écoutée devient une **proposition de vérité terrain** (validée ensuite par
   le relecteur, jamais automatiquement). Un encart « Ta correction aide à entraîner le moteur » et un interrupteur sobre
   l'expliquent, sur l'écran de correction seulement. « Ignorer » n'est **jamais** de la vérité terrain.
6. **Forcer l'export a une règle explicite pour chaque sorte de passage ambigu** : par défaut *omettre* (I3, la précision prime) ;
   *marqueur* (`[incertain : …]`, comportement actuel de `aqr recognize`) en option ; *premier candidat* déconseillé (rouge
   discret), car le moteur ne classe pas ses candidats.

## 1. Concept et benchmark

**Concept** (avant le style). Message : *« tu sais exactement ce qui part dans la vidéo, et ce qui ne part pas »*. Contresens à
éviter : un assistant qui « corrige » tout seul à la place de l'utilisateur, ou une liste d'erreurs alarmiste qui donne l'impression
que le moteur est cassé. Métaphore : le **bon à tirer** — dernière relecture d'épreuves avant impression, annotations d'encre en
marge (le losange de la correction humaine existe déjà dans la direction), signature explicite si l'on passe outre.
Procédé : contraste (le calme du « Prêt » vs le seul écart qui attire l'œil).

### Références réellement ouvertes (pages lues pour ce travail)

| Référence | Geste retenu (adaptation) | Ce qu'on refuse |
|---|---|---|
| [linear.app/docs/inbox](https://linear.app/docs/inbox) | Traiter une liste un élément à la fois au clavier (J / K pour suivant / précédent), basculer lu / non lu, reporter un élément | Le vocabulaire « supprimer » ; ici rien ne disparaît, tout s'annule |
| [subtitleedit.github.io/subtitleedit](https://subtitleedit.github.io/subtitleedit/) (aide de Subtitle Edit) | Le contrôle « corriger les erreurs courantes » avant l'enregistrement ; les réglages de durée minimale/maximale, d'écart minimal entre deux sous-titres et de coupe des lignes longues, qui deviennent nos « Mise en forme et synchronisation » | Sa densité d'outil d'expert : ici cinq réglages visibles, le reste replié |
| [support.google.com/youtube/answer/2734796](https://support.google.com/youtube/answer/2734796) (aide YouTube, sous-titres) | Les sous-titres automatiques sont publiés tels quels, l'édition est une option avant « Terminer » ; un fichier de sous-titres porte texte et horodatage, parfois la mise en forme (→ ASS) | Publier sans rien dire : ici l'export forcé le consigne dans le fichier |
| [descript.com](https://www.descript.com/) | **Non exploitable** : les pages d'aide sur l'export de sous-titres n'ont pas répondu (404 / contenu vide) lors de cette recherche. Seul le geste du lot précédent (le texte est la surface principale) est conservé | — |

Inspiration ≠ copie : rien n'est repris tel quel. **Limite assumée** : aucune planche Dribbble/Awwwards n'a été ouverte pour ce
lot (la direction visuelle est celle déjà validée, `atelier-direction.md` §1) ; le benchmark ci-dessus porte sur le *geste* (triage,
contrôle avant export), pas sur le style. **Registre des directions artistiques** : le registre du coffre n'a pas pu être
consulté ni alimenté (l'outil `vault_cli.py` est introuvable dans cet environnement, la variable `ARTIST_SKILLS_ROOT` est vide
et le serveur Obsidian refuse la connexion). Aucune nouvelle direction n'est créée : ce lot reste dans « Encre & lapis » ; la note
du registre est à compléter par un geste du mainteneur (§15).

## 2. Parcours

```
 Session terminée ──▶ [Exporter · 5 à vérifier] (en-tête de session)
                              │
                              ▼
                 Page « Exporter les sous-titres »
        ┌─ rien à vérifier ──▶ réglages ──▶ Exporter ───────────────┐
        │                                                          ▼
        ├─ à vérifier ─▶ Corriger le 1er passage ─▶ (écouter, décider, valider) ─▶ suivant …  ──▶ Résultat
        │                          └─ Ignorer cet élément (exporté selon la règle par défaut)
        └─ Forcer l'export… ─▶ dialogue : que faire des passages ambigus ? ─▶ Exporter quand même ─┘
```

1. **Entrée.** Bouton « Exporter » dans l'en-tête de session, juste avant « Archiver » (`session-head.tsx`). Secondaire, icône de
   téléchargement, avec une pastille d'état : **« 5 à vérifier »** (texte ambre, jamais seul : le nombre est écrit) ou **« ✓ Prêt »** (encre,
   pas de vert : le vert reste réservé à « Validé à l'oreille »). Désactivé tant que la session n'est pas `done` (info-bulle
   « L'analyse n'est pas terminée »). Raccourcis : `E` (touche seule, désactivable comme `M`/`P`/`L`, WCAG 2.1.4) et
   `Ctrl/Cmd + Maj + E` (toujours actif).
2. **Contrôle de préparation.** Carte verdict (nombre, progression « 1 sur 6 résolus », une action) + ligne neutre non coranique
   + liste. Si 0 ambiguïté : le verdict devient « Tout est vérifié : prêt à exporter » et l'action primaire passe à droite
   (« Exporter en SRT »).
3. **Correction** d'un passage (§5) : écran dédié, navigation précédent/suivant, retour à la liste.
4. **Forcer l'export** (§6).
5. **Résultat** (§8) ; « Refaire l'export » revient aux réglages avec les mêmes choix.

## 3. Ce qui est « ambigu » (règles, vérifiables)

Périmètre : uniquement les intervalles `kind == "verse"` et les signalements humains **confirmés** de `aqr.review/2`.
`non_quran` (formules, `french`, `silence`…) et `abstention` **ne comptent jamais** (I4). Les seuils sont de la **configuration** lue
dans `decoder` du JSON (`merge_max_gap_s`, `infer_max_gap_s`), jamais des valeurs en dur.

| Code | Sorte | Condition | Pourquoi ça compte | Résolutions possibles |
|---|---|---|---|---|
| `uncertain` | Incertain | `status == "uncertain"` (≥ 2 `candidates`, ni texte ni traduction) | Le moteur ne nomme pas le verset (I3) | Choisir un candidat · saisir une référence · exclure · ajuster les temps |
| `inferred` | Supposé, non entendu | `status == "inferred"` | Jamais entendu (I5) ; son temps est interpolé | Confirmer à l'oreille · exclure |
| `cut_end` / `cut_start` | Coupure | Verset `partial` dont les mots manquent **et** le moteur n'a pas de raison de croire que le lecteur s'est arrêté : fin manquante si `words[1] < dernier mot` et que l'intervalle suivant, à moins de `merge_max_gap_s`, est une abstention hors `silence`, un `uncertain`, ou le verset suivant ; début manquant si `words[0] > 1` et le précédent est dans les mêmes conditions | Un verset à moitié sous-titré dans une suite | Étendre à une plage de mots validée · confirmer « le lecteur s'arrête là » · exclure |
| `report` | Signalement | Annotation confirmée dont un tag est dans `{missing_verse, wrong_verse, extra_verse, repetition_missed, start_early, start_late, end_early, end_late, display_offset, non_quran_as_quran, quran_undetected, abstention_wrong}` | Un humain a déjà dit que le moteur se trompe | Résolu quand une décision recouvre sa plage, ou par « Ignorer » |
| `approx` | Traduction approximative | Verset partiel dont `translation.scope == "fragment"` et `fragment.approximate == true` | La traduction affichée ne colle qu'à peu près | Traduction du verset entier · garder le fragment · sans traduction |

**Ne comptent pas** : tags `basmala_*`, `istiadha_*`, `takbir_amin` (formules), `riwaya`, `reciter_error`, `inaudible`, `noise`,
`overlap`, `other` (ce ne sont pas des ambiguïtés de la partie arabe : ils restent visibles dans la revue). Un verset
`recognized` est **toujours** considéré sûr (y compris `promoted_by` neighbor/chain/gap : la preuve acoustique l'a accepté).
Un verset partiel « légitime » (le lecteur commence ou finit au milieu d'un verset, en bord de fichier ou avant un silence)
n'est **pas** une coupure.

### 3.1 L'ambiguïté dépend de ce qu'on exporte

Le serveur calcule, pour chaque `uncertain`, l'**impact** de chaque réponse possible en comparant les candidats mot à mot :

| Les candidats diffèrent par… | Étiquette | Compte dans le contrôle si le contenu est… |
|---|---|---|
| des **lettres** arabes | `Arabe` | Arabe seul, Arabe + traduction |
| un **signe de pause** seulement (ex. 11:61 / 7:73, mots 1–10 : ۚ ou ۗ au mot 5) | `Arabe · 1 signe` (mineur) | Arabe seul, Arabe + traduction |
| la **traduction** seulement | `Traduction` | Arabe + traduction, Traduction seule |
| rien d'imprimé (même arabe, même traduction : 55:13 / 55:16) | `Référence` | Seulement si « Afficher la référence » est activé |

Conséquences visibles : changer « Contenu » ou activer « Afficher la référence » **recompte en direct** (dans le prototype :
5 à vérifier → 4 en « Arabe seul ») ; les éléments devenus sans effet passent dans un groupe replié « Sans effet avec ces réglages ».
`approx` ne concerne que la traduction. *À valider par le mainteneur : arbitrage n° 2, car la lecture stricte de I1 peut vouloir
que le signe de pause aussi soit exact.*

## 4. L'écran « Prêt à exporter ? » (export.html)

### 4.1 Carte verdict
- Grand nombre (Instrument Serif 44) + « passages à vérifier avant d'exporter » + une phrase : « 4 touchent l'arabe ; 1 concerne
  seulement la traduction ou la référence. » ; barre de progression 6 px (encre, pas de couleur) ; `role="progressbar"`.
- Action primaire : **« Corriger le premier passage (5 restants) »** ; lien discret « ou **forcer l'export** sans corriger ».
- Ligne neutre (cadre pointillé, icône info, pas d'ambre) : « **9 passages non coraniques ignorés** (6 abstentions : tafsir, wolof,
  français · 3 formules). Ils ne demandent rien et ne bloquent jamais l'export. [Voir la liste] ».
- Prêt : cercle à coche encre, « Tout est vérifié : prêt à exporter », « 6 sur 6 résolus » ; l'action primaire est dans la colonne de droite.

### 4.2 Liste « À vérifier dans la partie coranique »
- Filtres en pastilles par type avec compteurs (Tous · Supposés · Incertains · Coupures · Signalements · Traduction), état `aria-pressed`.
- **Ligne** (carte de 64 px mini) : glyphe de statut (mêmes motifs que l'onde), référence (Instrument Serif 22), temps en mono
  (« 00:48.2 → 01:02.6 · mots 11–17 »), **une phrase qui dit pourquoi** (« 2 candidats : 11:61 ou 7:73. L'arabe diffère aux mots 16–17 »),
  puis étiquettes (sorte + impact « Arabe / Traduction / Référence »). Actions à droite : `▶ Écouter` (44 px), **`Corriger`** (secondaire, lien vers
  l'écran de correction), `Ignorer`. Clic sur le texte de la ligne = saute la lecture à l'instant de début (comme la liste de revue).
- **Ligne résolue** : fond plus calme, deux lignes d'encre : « ◆ Décision : **11:61 · mots 1–10** · écouté · Annuler » et « ◇ Moteur : incertain · 2 candidats (inchangé) ».
  « Ignoré — exporté selon la règle par défaut » pour un élément ignoré. La ligne reste dans la liste (rien ne disparaît) mais sort du compteur.
- Ordre : par temps. Pied : « 6 sur 6 affichés » ou pagination (§9).
- Éléments sans effet avec les réglages actuels : `<details>` replié « Sans effet avec ces réglages · 1 ».

### 4.3 Colonne de droite (réglages) : voir §7. Son pied est fixé en bas de la colonne (bureau) ou de l'écran (mobile).

## 5. Corriger un passage (corriger.html)

### 5.1 Anatomie (bureau 1440)
- **Navigation** : « ‹ Précédent · Passage 2 sur 5 restants · Suivant › » + progression « 1 sur 6 » ; clavier `J`/`K`.
- **Carte du passage** : référence(s) en grand, badge de statut, étiquette d'impact, une phrase qui dit quoi écouter (« Écoute la fin : … ou … ? »).
- **Onde à trois lignes** (même gouttière de noms que la console) : *Onde* (fenêtre ±15 s autour du passage), *Moteur* (segment du
  moteur avec son motif : points ambre pour l'incertain, aplat lapis pour le reconnu voisin), *Décision* (losanges d'encre aux deux
  bouts + soulignement épais : le codage « correction humaine » existant). La tête de lecture traverse les trois lignes au même x.
- **Contrôles** : `Écouter le passage` (primaire de la zone d'écoute : non, secondaire — le primaire de l'écran est « Valider »), `En boucle`,
  réglage du **début** et de la **fin** de la décision par − / + de 0,1 s (valeur affichée en mono, `aria-label` explicite). Les poignées de l'onde font la même chose.
- **Côte à côte** : à gauche la carte **« Moteur » (cadenas, « Figé »)** : statut, candidats, confiance, début d'empreinte ;
  à droite la carte **« Ta décision »** (contour d'encre 1,5 px, badge « Brouillon » puis « Enregistrée ») qui reflète le choix en direct
  (référence, texte arabe **du corpus** — jamais une chaîne saisie —, temps).
- **« Qu'entends-tu ? »** (colonne de droite) : boutons radio à grandes cartes.
  1. **C'est 11:61** — le texte arabe des mots concernés, **les mots qui diffèrent surlignés** (fond ambre + trait, pas la couleur seule), un aperçu de traduction (« Traduction du verset entier : … »).
  2. **C'est 7:73** — idem.
  3. **Un autre verset** — champs `sourate:verset`, mot de début, mot de fin ; validation immédiate (« ✓ Verset trouvé dans le corpus · 22 mots ») contre `^\d{1,3}:\d{1,3}$` puis le corpus ; sinon « Ce verset n'existe pas » (`aria-invalid`).
  4. **Ce n'est pas du Coran** — exclu de l'export (et vérité terrain « non coranique » si écouté).
  `Annuler ma décision` (ghost) apparaît dès qu'un choix existe.
- **Pied** (fixé) : primaire **« Valider et passer au suivant »** (`Entrée`), « Ignorer cet élément », ligne d'état « **Pas encore écouté** · une décision écoutée vaut vérité terrain » → « **Écouté** · cette décision vaut vérité terrain ».

### 5.2 Par sorte d'élément (ce que l'écran propose)

| Sorte | Choix proposés | Ce que fait « Valider » |
|---|---|---|
| `uncertain` | un radio par candidat · autre verset · pas du Coran | `choose` / `set_ref` / `exclude(not_quran)` |
| `inferred` | « Je l'entends : confirmer » · « Je ne l'entends pas : exclure » · (ajuster début/fin) | `confirm_inferred` (+ temps) / `exclude(not_heard)` |
| `cut_*` | « Étendre à la plage de mots… » (sélecteur de mots, voir 5.3) · « Le lecteur s'arrête ici : confirmer » · exclure | `set_ref` (mêmes `ref`, nouveaux `words`) / `confirm_partial` |
| `report` | revient à l'intervalle concerné ou, si le moteur n'a rien reconnu, « Il y a un verset ici » → `set_ref` à saisir ; « Le signalement est faux » | `set_ref` / `dismiss_report` |
| `approx` | « Traduction du verset entier » · « Garder le fragment » · « Sans traduction pour ce passage » | `translation_scope` |

### 5.3 Sélecteur de plage de mots
Les mots du verset s'affichent comme des **jetons** (arabe, du corpus) dans une rangée RTL ; toucher le premier puis le dernier trace la plage
(surlignage du jeton + trait), `aria-pressed`, flèches ← → pour étendre. Le nombre de mots (« mots 11–17 sur 30 ») est annoncé.

### 5.4 Valeur « vérité terrain »
Condition : la décision est de nature **factuelle** (`choose`, `set_ref`, `confirm_inferred`, `confirm_partial`, `exclude(not_quran)`,
`exclude(not_heard)`, `adjust_time`), le passage a été **écouté** (≥ 1 lecture ≥ 70 % de la plage, mesuré côté client, à défaut le
bouton « Écouter » compte), et l'interrupteur « Utiliser ma correction pour améliorer le moteur » est actif.
Alors la décision est exposée dans l'onglet *Vérité terrain* (administrateurs) comme **proposition**, statut `proposed`,
source `export-review`, relecteur = auteur de la décision ; elle n'entre jamais seule dans le manifeste (règle du mainteneur :
rien n'est validé sans lui). `ignore`, `dismiss_report`, `translation_scope`, et le choix « forcer » ne sont **jamais** de la vérité terrain.

**Encart « Ta correction aide à entraîner le moteur »** (carte, icône info, sous les cartes Moteur/Décision) :
> Quand tu as écouté le passage, ta décision devient une proposition de vérité terrain (référence, mots, temps), relue ensuite par le relecteur. Elle reste sur ce serveur ; ton audio n'est envoyé nulle part.
> [interrupteur] Utiliser ma correction pour améliorer le moteur — Modifiable à tout moment, décision par décision.

Valeur par défaut proposée : **activé pour ma propre session**, **désactivé et verrouillé** si je ne suis pas propriétaire (je ne
consens pas pour l'enregistrement d'un autre ; il n'a pas non plus à subir mon choix). Voir l'arbitrage n° 3 (droits des personnes
enregistrées : `docs/DATA-COLLECTION.md` §4). Rappel dans le résultat (« Voir ou retirer mon accord »).

## 6. Forcer l'export

- Point d'entrée : bouton « Forcer l'export… » (secondaire, grand, pied de la colonne de droite) ou lien « forcer l'export » dans le verdict. **Aucun double-clic accidentel** : il ouvre toujours un dialogue.
- **Dialogue** (`role="alertdialog"`, focus sur le premier choix, Échap = annuler, feuille basse en mobile) :
  Titre « Forcer l'export ? » · « **5 passages ambigus** n'ont pas été corrigés. Nommer un faux verset est pire que n'en nommer aucun : choisis ce qu'on en fait. »
  Trois radios : **Les omettre** (recommandé, défaut) · **Les garder avec un marqueur** (« [incertain : 11:61 | 7:73] » à la place du texte, « [déduit] ») · **Prendre le premier candidat** (texte rouge discret : « Risque de nommer un faux verset. Le moteur ne classe pas ses candidats aujourd'hui. »).
  Puis le **tableau de ce qui sera exporté tel quel** (temps · passage · « Omis » / « Exporté tel quel : mot 1 seulement » / « Rien »).
  Pied : « Revenir et corriger » (secondaire) · **« Exporter quand même »** (primaire).
- Traçabilité : le JSON exporté porte `review.forced: true`, `unresolved: n`, la politique choisie ; le nom du fichier n'est pas modifié (pas de « -brouillon »).
- **Export automatique en un clic** quand tout est vert : « Exporter en SRT » est alors le seul bouton primaire (aucun dialogue).
- Règles par sorte quand on force (politique « omettre ») : `uncertain` omis · `inferred` omis · `cut_*` exporté tel quel (le verset partiel est un fait du moteur, pas une erreur de nommage) · `report` sans effet (le moteur n'a rien reconnu) · `approx` exporté avec le fragment approximatif.

## 7. Options d'export (valeurs par défaut)

| Réglage | Choix | Défaut | Notes |
|---|---|---|---|
| Format | SRT · WebVTT · ASS · JSON | **SRT** | JSON = `aqr.recognition/1` + `review` (§11.3), jamais modifié sur place |
| Contenu | Arabe + traduction · Arabe seul · Traduction seule | **Arabe + traduction** | Détermine le recompte (§3.1). Arabe = mots exacts du corpus (I1) ; traduction = QuranEnc non modifiée (I2) |
| Formules | Isti'adha · Basmala · Takbîr · Âmîn (pastilles à cocher) | **Basmala seule** | La basmala est le verset 1:1 du corpus (texte + traduction). Les autres formules ne sont que des **libellés** (`label_ar`), exportés comme `[الاستعاذة]`, jamais comme du texte du Coran |
| Répétitions | Garder toutes · Fusionner | **Garder toutes** | Fusionner = un sous-titre de la première à la dernière |
| Durée min. / max. d'un sous-titre | secondes | **1,0 s / 7,0 s** | Un verset plus long est coupé aux frontières de mots mesurés (`word_times_source == "ctc-alignment"`) ; si les temps sont `interpolated`, coupe proportionnelle et avertissement dans l'aperçu |
| Signes par ligne (traduction) | entier | **42** | Arabe : une ligne, retour automatique par le lecteur |
| Décalage global | − / + par 100 ms, −5000…+5000 | **0 ms** | Négatif = les sous-titres arrivent plus tôt |
| Balises RTL | oui / non | **oui** | Encadre l'arabe de U+202B…U+202C (SRT/VTT) ; ASS : `{\an2}` + styles dédiés |
| Retirer les renvois de note `[1]` | oui / non | **non** | Les retirer modifie la traduction QuranEnc : écart assumé à I2, décoché par défaut |
| Afficher la référence (`2:255`) | oui / non | **non** | Activer rend les `uncertain` « Référence » bloquants |
| Encodage | UTF-8, avec/sans BOM | **sans BOM** | BOM = pour de vieux lecteurs Windows ; sans objet en JSON |
| ASS : karaoké mot à mot | oui / non | **oui si ASS** | Uniquement avec temps mesurés ; sinon désactivé avec la raison |
| ASS : police arabe | Amiri Quran · Scheherazade New · Noto Naskh | **Amiri Quran** | Les trois sont OFL ; KFGQPC (Hafs) n'est **pas** proposée (pas de redistribution, cf. mémoire projet) |
| Nom du fichier | texte libre | `<nom de la session>.<ar|fr|ar-fr>.<format>` | Assaini côté serveur (pas de `/`, `..`, 120 caractères max) |

**Aperçu en direct** (colonne de droite, 3 premiers sous-titres) : deux onglets *Rendu* (cadre sombre type vidéo, arabe en police du Coran
choisie, traduction dessous) et *Fichier* (le texte brut réel, monospace). Un passage ambigu qui serait omis **apparaît dans l'aperçu**
sous forme d'une carte à contour ambre pointillé : « **Omis dans cet export** · 112:3 est un verset supposé, jamais entendu. [Le corriger] ».
On voit donc l'effet du choix avant de l'exporter. Réglages avancés repliés dans « Mise en forme et synchronisation ».

## 8. Résultat

Carte « Ton fichier est prêt » (coche encre dans un cercle) ; si forcé : « **Export forcé.** Les passages non corrigés ont été omis ; le fichier
JSON le mentionne. » (ambre). Fichier (nom en mono, nombre de sous-titres, taille, encodage), trois chiffres (sous-titres écrits ·
passages omis · décisions humaines appliquées), `Télécharger` (primaire) et `Refaire l'export` (secondaire, retour aux réglages
conservés). **Bloc « Attribution à inclure avec la vidéo »** : texte exact « Texte coranique : Tanzil Project (CC-BY-3.0, tanzil.net), non modifié.
Traduction : QuranEnc.com — … » avec `Copier le texte` ; précisions : le JSON, l'ASS (commentaire `;`) et le WebVTT (bloc `NOTE`) la portent, **SRT n'a pas de
champ**, donc rappel de la mettre dans la description. Rappel de l'accord d'entraînement avec lien « Voir ou retirer mon accord ».

## 9. États

Planche : `export-etats.html` (captures `export-etats-*`).

| État | Comportement |
|---|---|
| Chargement | Squelette après 400 ms (pas avant), `aria-busy="true"` sur la liste ; le décompte arrive en premier |
| Rien à exporter (0 verset reconnu) | Message « Aucun verset reconnu dans cet audio » + « Voir la session » (primaire) / « Relancer l'analyse » ; le bouton de l'en-tête reste actif mais l'écran explique |
| Analyse en cours / en file | Le bouton de l'en-tête est désactivé ; l'adresse directe affiche « L'analyse n'est pas terminée » + progression + « Me prévenir à la fin » |
| Session privée d'un autre | **404 identique à « introuvable »** (jamais « privée ») : on ne révèle pas l'existence |
| Lecture seule (pas propriétaire, session partagée) | Contrôle et export visibles ; boutons « Corriger » absents, mention « Seul le propriétaire corrige » ; forcer l'export reste possible |
| Erreur de génération | Texte clair : ce qui s'est passé, ce qui est intact (décisions), ce qu'on fait (Réessayer) ; détail technique copiable, jamais lu à l'écran tel quel |
| Long fichier (2 h, 3 012 intervalles) | Le serveur renvoie le **décompte** et **10 éléments par page** triés par temps ; filtres par type, « aller au prochain non résolu », « tout exclure » par groupe pour les `inferred` (seule action de masse, car sûre : omettre). Aucune liste de 3 000 éléments n'arrive jamais au navigateur |
| Hors ligne | Les décisions s'enregistrent en brouillon local et se resynchronisent ; l'export est désactivé avec la raison |

## 10. Accessibilité, mobile, thèmes, textes

- **Clavier** : tout se fait sans souris. Liste : `J`/`K` (désactivables), `Entrée` ouvre la correction, `E` exporter. Correction : `Espace` écoute, `1`–`9` choisit un candidat, `X` exclut, `Entrée` valide, `Échap` retour.
- **`aria-live="polite"`** : une seule région (`#live`) annonce « 2 sur 6 résolus. 4 restants. » après chaque résolution et « Export terminé : … ». Le dialogue est un `alertdialog` (focus piégé, retour du focus au bouton d'origine).
- **Focus** : après « Valider et passer au suivant », le focus va sur la carte du passage suivant (titre), jamais perdu. À la fin de la liste : sur le verdict (« Tout est vérifié »).
- **Sans couleur** : sorte = motif + libellé + impact écrit ; décision = losange plein ; moteur = losange creux ; ambre jamais seul (le compteur est écrit).
- **Contraste** : tous les tokens de `tokens.css` (≥ 4,5:1 texte, ≥ 3:1 non-texte). Le cadre vidéo de l'aperçu est un noir fixe (`#0b0c0e`) avec texte `#f2efe6` / `#d9d5ca` (≥ 12:1) pour imiter une vidéo, dans les deux thèmes.
- **Cibles** : ≥ 44 px au tactile (puces de formules, − / +, onglets, lignes d'action, interrupteurs 38×22 avec zone de 44).
- **Mobile 375** : deux onglets ; verdict compact ; chaque ligne passe sur deux rangées (texte puis actions pleine largeur 44 px) ; barre fixée en bas (« Forcer l'export » · « Corriger (5) » / « Exporter ») avec `safe-area` ; dialogue = feuille basse (boutons pleine largeur, « Exporter quand même » en dernier). Correction : lecteur ancré en bas (▶, Ignorer, Valider et suivant).
- **Thèmes** : `light-dark()` des tokens ; l'aperçu vidéo ne change pas. Captures claires : `export-verifier-clair-*`, `export-corriger-clair-*`.
- **Mouvement** : seulement `transform`/`opacity` ; la barre de progression est un `width` de 320 ms (sauf `prefers-reduced-motion`).
- **Micro-textes (français, tutoiement)** : « Prêt à exporter ? » · « passages à vérifier avant d'exporter » · « Corriger le premier passage » · « Forcer l'export… » · « Exporter quand même » · « Ignorer cet élément » · « Annuler ma décision » · « Moteur : … (figé) » · « Ta décision » · « Pas encore écouté » · « Ta correction aide à entraîner le moteur » · « Omis dans cet export » · « Sans effet avec ces réglages » · « 9 passages non coraniques ignorés ». Aucun jargon (pas de « interval », « status », « INFERRED » à l'écran).

## 11. Modèle de données : le calque de décisions

### 11.1 Pourquoi un fichier à part, pas `aqr.review/2`
`aqr.review/2` existe déjà (`web/lib/review.ts`) : ce sont les **signalements de testeurs** (plage + puces + commentaire, plusieurs auteurs, fusion
par `id`). Une décision humaine est une autre sorte de fait (« voici la vérité pour cet intervalle »), avec un cycle de vie et une
portée de consentement distincts ; la mélanger casserait la fusion multi-testeurs et le schéma. **Recommandation : `decisions.json`,
schéma `aqr.decisions/1`**, à côté de `session.json` et de `prediction.recognition.json`, lu/écrit par les mêmes primitives atomiques (`store.ts`, verrou).

### 11.2 Schéma `aqr.decisions/1` (proposition, additive)

```jsonc
{
  "schema": "aqr.decisions/1",
  "session_id": "5014015f…",
  "prediction_sha256": "9c41…e7",       // empreinte de prediction.recognition.json au moment des décisions
  "consent": { "training": true, "by": "cherif", "at": "2026-10-23T14:02:11Z" },  // défaut du compte, modifiable ; `false` verrouillé si non propriétaire
  "decisions": [{
    "id": "uuid",
    "kind": "choose" | "set_ref" | "confirm_inferred" | "confirm_partial" | "exclude" | "adjust_time"
          | "translation_scope" | "dismiss_report" | "ignore",
    "target": {                          // ce que le moteur a dit, figé au moment de la décision
      "fingerprint": "sha256 hex",      // sha256 de la forme canonique de l'intervalle (kind, ref, words, status, candidates, t arrondi à la ms)
      "index": 17,                       // position dans intervals[] (indice seulement : l'empreinte fait foi)
      "snapshot": { "kind": "verse", "status": "uncertain", "ref": "11:61", "words": [11,17], "t": [48.2, 62.6], "candidates": ["11:61","7:73"] },
      "review_ids": ["…"]                // annotations de revue que cette décision résout (facultatif)
    },
    "value": {                           // selon kind
      "ref": "11:61", "words": [11,17],  // choose / set_ref / confirm_*
      "t": [48.2, 62.6],                 // adjust_time ou choose avec temps ajustés
      "reason": "not_quran" | "not_heard" | "unwanted",   // exclude
      "scope": "verse" | "fragment" | "none"             // translation_scope
    },
    "evidence": { "listened": true, "listened_s": 14.4, "device": "desktop" },
    "use_for_training": true,            // copie de consent.training au moment de la décision (n'écrase pas l'historique)
    "decided_by": "cherif",              // pseudonyme / nom d'utilisateur
    "decided_at": "iso", "revision": 3,
    "superseded_by": null | "uuid",      // l'annulation = nouvelle entrée `ignore`/`withdrawn`, jamais une suppression
    "withdrawn_at": null | "iso"
  }]
}
```
- **Empreinte** : `sha256(JSON canonique de {kind, ref, words, status, candidates, t[ms]})` de l'intervalle du moteur. Si l'analyse est relancée,
  `prediction_sha256` change : les décisions dont l'empreinte retrouve un intervalle identique sont **réappliquées** ; les autres passent en
  état `orphan` (« Cette décision portait sur un passage que le moteur ne produit plus ») et ne s'appliquent **pas** silencieusement (écran de réconciliation, liste courte).
- **Fusion** : par `id`, comme la revue (pas d'écrasement de la liste). Annuler = ajouter `withdrawn_at`.
- **Jamais** de modification de `prediction.recognition.json`, ni de la liste `intervals` en mémoire : le client calcule la **vue fusionnée**.

### 11.3 JSON exporté : `aqr.recognition/1` corrigé (additif)
La prédiction est recopiée **telle quelle**. Pour chaque intervalle décidé, on ajoute un champ `resolved` (les lecteurs qui l'ignorent
lisent la sortie du moteur comme avant) ; un bloc `review` en tête :
```jsonc
{ "schema": "aqr.recognition/1", "…": "…champs du moteur inchangés…",
  "review": { "schema": "aqr.decisions/1", "decisions_sha256": "…", "applied": 1, "unresolved": 5, "forced": true, "policy": "omit" },
  "intervals": [ { "kind": "verse", "status": "uncertain", "candidates": ["11:61","7:73"], "…": "…inchangé…",
                   "resolved": { "by": "human", "decision_id": "…", "ref": "11:61", "words": [11,17], "t": [48.2,62.6],
                                 "text": "…lu dans le corpus (I1)…", "translation": { "…": "QuranEnc non modifiée (I2)" } } } ] }
```
Le `status` du moteur n'est **pas** réécrit (I5) ; une décision est une preuve d'une autre nature (`resolved.by = "human"`), pas un `RECOGNIZED`.
**Un ADR est à écrire** (« décisions humaines sur une prédiction immuable ») avant l'implémentation : il fixe ce point (arbitrage n° 1).

### 11.4 API (proposition)
| Route | Rôle |
|---|---|
| `GET /api/sessions/:id/export/readiness?content=&ref=&type=&page=` | Décompte, verdict et **une page** d'éléments (10 par défaut) ; calcule §3 côté serveur, avec les décisions appliquées |
| `GET` / `PUT /api/sessions/:id/decisions` | Lire / ajouter des décisions (fusion par `id`, verrou comme la revue) ; refus si non propriétaire |
| `POST /api/sessions/:id/export/subtitles` | Corps = options §7 + politique de forçage ; renvoie le fichier (`Content-Disposition`) et un résumé (compte, omis, appliqués) ; 404 identique pour une session d'un autre |
| `GET /api/corpus/verse?ref=11:61&words=11-17` | Texte arabe du corpus d'un candidat (pour l'écran de correction) : lecture, jamais depuis un modèle |
La route `GET /api/sessions/:id/export` (bilan JSON) **existe déjà** : on ne la détourne pas.

## 12. Correspondance avec le code (`web/app/atelier/*`)

| Fichier / composant | Travail |
|---|---|
| `session-head.tsx` | Bouton « Exporter » + pastille d'état avant « Archiver » ; calcule le décompte via `readiness?page=0&size=0` (léger) |
| `shell.tsx` / `header.tsx` | Raccourci `E` / `Ctrl+Maj+E` (désactivable comme `M`/`P`/`L`) |
| `export-page.tsx` (nouveau, route `(app)/s/[id]/exporter`) | Page deux colonnes + onglets mobile ; reçoit les options depuis `localStorage` (`aqr.ui.v1.export`) |
| `readiness-card.tsx`, `readiness-list.tsx` (nouveau) | Verdict, filtres, lignes, pagination ; la ligne réutilise `session-bits.tsx` pour les glyphes de statut |
| `export-settings.tsx`, `export-preview.tsx` (nouveau) | Réglages et aperçu ; l'aperçu appelle le même module d'export que le serveur (pas de seconde implémentation) |
| `force-dialog.tsx` (nouveau) | Dialogue ; réutilise le piège de focus des tiroirs (`shell.tsx`) |
| `correct-item.tsx` (nouveau) | Écran de correction : réutilise `timeline.tsx` (3 lignes), `use-player.ts`, `passage-card.tsx` (texte arabe) |
| `use-decisions.ts` (nouveau) | Comme `use-review.ts` : brouillon local, enregistrement atomique, annulation |
| `web/lib/export-readiness.ts`, `decisions.ts` (nouveaux) | Fonctions pures et testées : règles §3, schéma zod, empreintes, fusion |
| `web/lib/review-presets.ts` | Réutilisé : les tags qui comptent (§3) sont ajoutés comme **propriété** `blocksExport` des puces, pas comme liste séparée |
| `web/app/tokens.css` / `style.css` | Aucun token nouveau ; ajouter `--cue-bg: #0b0c0e` (cadre vidéo de l'aperçu) |
| `src/aqr/rendering/` (Python) | **Un seul moteur de rendu de sous-titres** : voir risque n° 1 |

## 13. Critères vérifiables (Ibrahima, Cherif QA)

1. **Aucune ambiguïté ne se perd en silence** : pour une session de test avec n éléments `uncertain`/`inferred`/coupure/signalement, le
   décompte vaut n ; passer en « Arabe seul » réduit exactement aux éléments portant l'étiquette « Arabe ».
2. **Les formules et abstentions ne comptent jamais** : un fichier avec 3 formules et 6 abstentions et 0 verset ambigu → « Prêt », le
   décompte non coranique est affiché (9) et n'est dans aucune liste.
3. **La prédiction ne change pas** : après 5 décisions, `sha256(prediction.recognition.json)` est identique ; annuler les 5 décisions
   redonne un export octet pour octet identique à l'export sans décision.
4. **I1 / I2 / I3** : tout texte arabe de l'export est identique au corpus (test par comparaison mot à mot) ; la traduction est identique à
   QuranEnc (sauf option « retirer les renvois », testée à part) ; avec la politique « omettre », aucun verset `uncertain` n'a de texte dans le fichier.
5. **Forcer** : le dialogue liste exactement les éléments non résolus ; le JSON porte `forced: true` et `unresolved: n` ; sans forcer, impossible
   d'exporter avec n > 0 (le primaire n'existe pas ; l'API renvoie 409 `unresolved_items` sans `force`).
6. **Pagination** : sur une session de 3 000 intervalles et 47 éléments, la liste charge 10 éléments, la réponse < 100 Ko, le décompte est exact, le focus et `aria-live` fonctionnent.
7. **Mobile 375** : aucun défilement horizontal (mesuré sur toutes les captures : 0 px) ; toutes les cibles ≥ 44 px ; la barre fixée ne masque pas la dernière ligne (marge de 72 px).
8. **Contraste / focus / reduced-motion** comme `atelier-direction.md` §13 ; aperçu de cadre vidéo : texte ≥ 12:1.
9. **Droits** : un non-propriétaire ne peut ni créer de décision ni modifier le consentement ; une session d'un autre renvoie 404 identique.

## 14. Prototype : ce qui est implémenté

`export.html` : liste dynamique avec filtres, ignorer / annuler, recompte en direct selon contenu et référence, formules, aperçu (rendu /
fichier, SRT / VTT / ASS / JSON), décalage, RTL, retrait des notes, nom du fichier, dialogue de forçage (3 politiques, tableau mis à jour), résultat
(propre ou forcé), thème. États par l'adresse : `#tab=reglages` · `#forcer` · `#v=resultat[&forced=1]` · `#s=pret|long` · `#content=ar|fr` · `#fmt=vtt|ass|json` ·
`#pv=fichier` · `#adv=1` · `#theme=light`. `corriger.html` : choix d'un candidat (texte arabe du corpus, différences surlignées), autre verset,
exclure, annuler, − / + du début et de la fin avec onde à trois lignes, consentement, `#pick=a|b|other|exclude` · `#valid=1` · `#listened=1` · `#train=off`.
**Non prototypé** : audio réel, sélecteur de mots en jetons, saut au prochain non résolu, écran de réconciliation des décisions orphelines, hors ligne, vrai tri par temps de la liste longue.
Données : extraits Tanzil (CC BY 3.0, non modifiés) et traductions QuranEnc (`french_hameedullah`, non modifiées) dans `export-data.js` seulement ;
si la politique « corpus non redistribué dans le dépôt » doit couvrir ces extraits, supprimer ce fichier (les écrans retombent sur les références).

## 15. Arbitrages pour le propriétaire (avec défauts proposés)

1. **Statut d'un passage corrigé à la main (I5).** Défaut : le `status` du moteur reste intact ; la décision s'ajoute dans `resolved` (`by: "human"`), et un ADR le fixe. Alternative : un 4e statut `HUMAN`. Je recommande le défaut (la prédiction reste mesurable).
2. **Un signe de pause seul qui diffère** (ex. 11:61 / 7:73, mots 1–10 : ۚ / ۗ) : bloquant ou non ? Défaut : **compté à part, « Arabe · 1 signe »**, mineur mais présent (I1 strict). Alternative : ne pas le compter.
3. **Consentement d'entraînement** : défaut proposé : activé pour ses propres sessions, désactivé et verrouillé sinon. Alternative : désactivé par défaut partout (demande un clic de plus, moins de données). À confirmer à la lumière des droits des personnes enregistrées.
4. **Politique par défaut en forçant** : défaut « omettre ». « Premier candidat » n'existe que si le moteur classe ses candidats : il ne le fait pas aujourd'hui (`candidates` = liste de références sans score). Faut-il ajouter un score aux candidats (changement additif du contrat) ? Défaut : non, pas pour l'instant.
5. **Passages `inferred`** : omis par défaut (un verset jamais entendu n'a pas de temps mesuré). Alternative : les garder avec `[déduit]`, comme `aqr recognize --format srt` le fait aujourd'hui. À aligner : le SRT du CLI et celui de l'atelier ne doivent pas diverger (risque n° 1).
6. **Attribution dans les fichiers** : défaut : portée par JSON / ASS / VTT (commentaire), rappel dans le résultat pour SRT. Alternative : ajouter un dernier sous-titre d'attribution de 4 s (case à cocher, décochée par défaut).
7. **Renvois de note `[1]`** : défaut : gardés (I2 strict) ; case « Retirer » proposée. Même arbitrage que la phase 2 (§16 n° 6).
8. **Qui peut forcer** : défaut : tout lecteur de la session. Alternative : propriétaire seulement.
9. **Registre des directions artistiques** : la note du coffre est à créer (« Exporter les sous-titres — bon à tirer », statut *Proposée*) quand l'outil sera joignable.

## 16. Risques d'implémentation (pour Ibrahima)

1. **Deux moteurs de rendu de sous-titres.** `src/aqr/rendering/home_renderer.py` écrit déjà un SRT/VTT (une ligne par verset, `[incertain : …]`, `[déduit] …`,
   formules en libellés) ; l'atelier a besoin de bien plus (options, coupe, décisions, karaoké ASS). Écrire un second rendu en TypeScript
   dupliquerait la logique **et** le web n'a pas le corpus. Recommandation : une commande Python `aqr export-subtitles` (entrées : prédiction,
   décisions, options ; sortie : fichier + résumé), lancée par le serveur comme `recognize`, et le CLI actuel en devient un cas particulier.
2. **Tests avec corpus** : les tests qui exigent le corpus sont sautés sans lui ; ajouter un cas de manifeste par règle de §3 (11:61/7:73, 17:74 coupé, 112:3 supposé) avant de coder.
3. **Empreinte et relance de l'analyse** : une relance régénère la prédiction ; sans écran de réconciliation les décisions orphelines seraient perdues. Ne pas livrer le calque sans la gestion des orphelines.
4. **Coût du contrôle** : le calcul de §3 (candidats, comparaison mot à mot) lit le corpus ; le mettre en cache par `prediction_sha256`, ne jamais le refaire par page.
5. **Texte des candidats** : l'écran de correction affiche l'arabe de candidats que le moteur **refuse de nommer**. C'est un affichage d'aide à la décision (lookup du corpus, étiqueté « candidat »), pas une assertion : le valider avec le mainteneur (I3).
6. **Coupures** : l'heuristique de §3 peut être fausse quand un lecteur s'arrête volontairement ; d'où `confirm_partial` (« le lecteur s'arrête ici ») et un seuil lu dans `decoder`. Mesurer le taux de faux positifs sur le lot 1 avant de s'y fier.
7. **Sélecteur de mots** : la saisie de plage de mots est la partie la moins évidente au tactile ; prévoir un repli par deux champs numériques.
8. **Accessibilité du dialogue** : `alertdialog` avec feuille basse mobile : tester VoiceOver / TalkBack, retour du focus, pas de défilement de l'arrière-plan.
9. **Fonts** : l'aperçu et l'ASS embarquent la police arabe choisie : OFL seulement ; KFGQPC jamais.
10. **Chiffres du prototype** : les nombres affichés (44 sous-titres, 6,2 Ko, ×7,4, 2 h / 3 012 intervalles / 47 éléments) sont **factices** ; aucune mesure n'est revendiquée.
