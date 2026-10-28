# Refonte de l'écran « Exporter » — direction artistique et spécification

Pour : le développeur de l'atelier. Statut : **proposition de design, rien n'est implémenté**.
Maquette interactive : `docs/design/export-refonte/index.html` (servir le dépôt en HTTP, par exemple
`python -m http.server 3912` à la racine, puis ouvrir `/docs/design/export-refonte/index.html`).
Paramètres d'URL utiles : `theme=dark|light`, `tab=verifier|soustitres|video`, `source=audio|video`,
`state=idle|loading|render|done|error|empty`, `q=2160@60`, `ranges=verses`, `sel=2`, `sheet=1`, `fine=1`, `pop=1`.

Tout texte arabe et toute traduction de la maquette sont **factices** et marqués comme tels (cadre pointillé
ambre, `aria-label` « texte arabe factice ») : aucun verset n'y est recopié. Dans le produit, le texte vient
toujours du corpus (I1) et la traduction de QuranEnc sans modification (I2).

---

## 1. Constat (état observé le 2026-10-28 sur la session de test 87b80f10…, 41,5 s, MP4)

- L'onglet Vidéo empile 6 fieldsets numérotés (Format, Écritures, Position et couleur, Fond, Qualité, Parties)
  sous un aperçu collant ; en défilant, **l'aperçu recouvre les légendes** (« Hauteur du texte », la note de
  qualité passent dessous). Le bouton d'export est tout en bas, après la saisie du nom de fichier.
- « Parties à exporter » arrive en **dernier** alors que c'est la décision qui conditionne tout le reste (nombre
  de fichiers, durée, poids). Et elle se fait avec deux champs texte « Début / Fin », sans voir l'audio.
- `rangesFromCards` (`web/lib/export-video-ranges.ts`) découpe **exactement** sur le début et la fin de la carte :
  le moindre décalage coupe l'attaque ou la fin d'une voix.
- Le poids estimé est une phrase en bas d'un bloc ; le 4K à 60 im/s (≈ 200 Mo pour 41 s, formule
  `h264Bitrate` × durée) ne déclenche aucun avertissement.
- « Réglages » est ambigu : la vidéo a aussi des réglages. Les trois onglets sont en réalité **une porte**
  (Vérifier) et **deux livrables** (sous-titres, vidéo).

## 2. Registre et benchmark

**Registre consulté** (coffre, store `directions-artistiques`) : 12 notes. Celle du projet, « Atelier de revue —
Encre & lapis » (2026-10-22), définit l'identité à **prolonger, pas remplacer** : Instrument Serif + Atkinson
Hyperlegible Next/Mono, arabe Amiri Quran / Scheherazade New / Noto Naskh (+ KFGQPC Hafs locale), encre
`#0e1013`/ivoire `#eeeae0`, un seul accent lapis, statuts codés par motif. Interdits de reprise respectés (Geist,
Cabinet Grotesk, Switzer, Sora, Plus Jakarta, Poppins, Newsreader, IBM Plex, Fraunces ; teal+lime, cuivre).
**Aucune police ni couleur nouvelle** : la nouveauté est la composition et les composants.

**Références réellement consultées (2026-10-28)**

| Référence | Geste retenu | Ce qu'on n'en prend pas |
|---|---|---|
| [Dorot — Jewish Culture on the Timeline](https://dorot.tali.org.il/en/from:1550/to:1750) (via [Awwwards](https://www.awwwards.com/sites/dorot-the-jewish-timeline)) | **Vue d'ensemble + fenêtre de zoom** : une barre fine montre toute la frise, une fenêtre glissable choisit la portion affichée en grand ; les bornes de la fenêtre sont écrites en clair aux extrémités. C'est la réponse à « 51 min d'audio sur 343 px ». | Les rubans colorés décoratifs. |
| [Trim Audio — Matthew Daniels, Dribbble](https://dribbble.com/shots/725635-Trim-Audio) | La sélection est un **cadre à deux crochets** posé sur l'onde ; l'extérieur est éteint. | Le skeuomorphisme orange. |
| [Apple — modifier une vidéo sur iPhone](https://support.apple.com/en-mt/104968) | Poignées aux deux bouts de la bande, **lecture de l'extrait avant d'enregistrer**, l'original n'est jamais détruit. On y ajoute l'appui long pour la précision (geste connu des éditeurs iOS). | — |
| [Video Editing Mobile App — Gm Shamim, Dribbble](https://dribbble.com/shots/27317581-Video-Editing-Mobile-App-Design) | **Feuille d'export** séparée de l'édition : résolution, cadence, un seul gros bouton. | Des curseurs continus pour des choix discrets, sans poids affiché : on fait l'inverse (paliers + poids). |
| [Riverside — Magic Clips](https://riverside.com/magic-clips) | Un long enregistrement devient **plusieurs clips**, chacun réglable ; **préréglages** de format mémorisés. | Le choix des extraits par l'IA : ici l'humain choisit, le moteur ne propose que ses repères (I3). |

Distinction : **inspiration** (le geste vue d'ensemble/loupe, le crochet, la feuille d'export), **adaptation**
(souffle hachuré, aimant au silence, rangée des passages codée par motif), **copie interdite** (aucune mise en
page, illustration ou palette reprise).

## 3. Direction — deux propositions, une retenue

### A. « Le rouleau et les signets » — **retenue**
L'audio est un rouleau qu'on déroule ; chaque plage est un **signet** qu'on y pose. Toute la page s'organise
autour d'une seule frise horizontale (vue d'ensemble + loupe), la même dans les trois onglets (lecture seule
dans Vérifier, éditable dans Vidéo). La sélection est un **geste humain** : elle est tracée à l'**encre**
(`--action-bg`), jamais au lapis (réservé à la voix du moteur). La marge gardée autour de la voix est
montrée par des **hachures d'encre** : on voit le souffle qu'on protège. Mise en page : contenu à gauche,
**aperçu + bordereau collants à droite** (bureau) ; sur téléphone, aperçu en tête qui se réduit en bandeau,
bordereau en **dock** bas qui s'ouvre en feuille.

### B. « Le bordereau » — écartée
Tout l'écran est un récapitulatif façon caisse : une ligne par décision (Parties, Format, Fond, Qualité…),
chaque ligne s'ouvre en tiroir. Très compact, excellent pour un agent, mais **la frise devient un sous-écran**
et on perd le lien visuel entre l'audio, la plage et l'aperçu — or c'est précisément ce qui manque aujourd'hui.
On garde de B **le bordereau** comme carte récapitulative et barre d'action.

**Pourquoi A** : la décision principale (quoi exporter) est spatiale ; elle doit se prendre en voyant l'onde,
les passages et les marges. A respecte l'identité Encre & lapis (encre = action, lapis = moteur, motif =
statut) et s'étend sans rupture à la frise de l'atelier de revue.

## 4. Architecture d'information

```
Exporter ─┬─ Rail d'étapes (tablist) : [Vérifier ● n à valider] [Sous-titres] [Vidéo]
          │    Vérifier est une PORTE, pas une étape obligatoire : badge « Prêt » ou nombre ambre.
          │    Sous-titres / Vidéo sont deux LIVRABLES, issus du même résultat vérifié.
          │    Ouverture : dernier livrable utilisé si tout est vérifié, sinon Vérifier.
          ├─ Vérifier : verdict → frise d'ensemble (où sont les ambigus) → cartes à trancher
          ├─ Sous-titres : 1 Format (tuiles) → 2 Ce qui s'affiche → Réglages fins (replié)
          │                 côté : aperçu d'un sous-titre + bordereau « 42 sous-titres · SRT »
          └─ Vidéo :       1 Ce que tu exportes (frise + plages + souffle)
                           2 À quoi elle ressemble (format, fond, taille, place ; fin replié)
                           3 Qualité et poids (paliers + jauge ; sur mesure replié)
                           côté : aperçu (image à la position de la poignée) + bordereau
```

- **L'essentiel d'abord** : l'ordre suit la décision (quoi → comment ça se voit → combien ça pèse → exporter).
  Chaque chapitre affiche **en titre sa valeur courante** (« 3 plages · 2 min 06 s », « Horizontal · Mosquée
  au crépuscule · arabe moyen », « 1080p · 30 im/s · ≈ 81 Mo ») : replié, il reste lisible.
- **Le fin est replié** : tailles exactes au pixel, remplissage, couleur d'accent, résolution/cadence libres,
  durées et décalage des sous-titres.
- **Toujours visibles** : l'aperçu et l'action. Bureau : colonne droite collante (`--x-side-w` 400 px).
  Téléphone : l'aperçu est en tête ; quand il sort de l'écran, un **bandeau d'aperçu** (vignette 72×40 +
  passage + temps) se fixe en haut ; le **dock** bas porte le résumé et « Exporter ».
- Nom du titre selon l'onglet : « Vérifier *avant* d'exporter », « Exporter les *sous-titres* », « Exporter la *vidéo* ».

## 5. Le sélecteur de plage (composant `RangeTimeline`)

### 5.1 Anatomie (de haut en bas)
1. **Vue d'ensemble** (`--x-mini-h` 36 px) : onde de tout l'audio, plages en traits d'encre sous l'onde
   (la sélectionnée plus foncée), losanges ambre/lapis pour les passages ambigus/déduits, **fenêtre** lapis
   (`role="slider"`, `aria-valuetext` « De 1 min 22 s à 2 min 18 s ») = portion affichée dans la loupe.
2. **Loupe** : règle des temps (pas adaptatif 0,5 s → 10 min, ≈ 90 px entre repères) ; **imagettes** (si vidéo
   importée, 48 px, une toutes les 64 px) ; **rangée des passages** (22 px, codage existant : reconnu = aplat +
   trait plein, déduit = hachures + tirets longs, ambigu = points + tirets, non coranique = gris + double trait ;
   numéro du passage si la case fait > 22 px) ; **onde** (112 px bureau, 92 px téléphone), plus foncée dans une
   plage ; petites marques vertes = silences candidats de l'aimant (au zoom < 2 min).
3. **Plages** posées en DOM au-dessus : cadre d'encre, étiquette numérotée, **souffle hachuré** entre le bord et
   la première/dernière voix, deux **poignées**.
4. Barre d'outils : « Écouter la plage » (primaire), lecture du temps (« Plage 2 · 13:00,8 → 13:16,5 · 15,7 s »),
   zoom −, cadrer la plage, zoom +. Légende des motifs dessous.

### 5.2 Poignées
- Trait visible de 4 px + **oreille** 14×36 px ; **cible de 44 × hauteur** tournée **vers l'extérieur** de la
  plage (début : à gauche du bord, fin : à droite). Deux cibles ne se recouvrent donc jamais, même pour une
  plage de 0,5 s.
- `role="slider"`, `aria-label` « Début de la plage 2 », `aria-valuemin` 0, `aria-valuemax` durée,
  `aria-valuetext` « 13 min 0,8 s ». Bulle de temps au-dessus pendant le glisser et au focus clavier.

### 5.3 Interactions

| Geste | Souris | Doigt | Clavier |
|---|---|---|---|
| Ajuster un bord | glisser la poignée | glisser la poignée | focus poignée : ←/→ ±0,1 s · Maj ±1 s · Alt ±0,02 s (une crête) · PgPréc/PgSuiv ±10 s · `[` `]` bord de passage voisin (souffle compris) |
| Précision | — | **appui long 450 ms** sur la poignée sans bouger → mode précision : geste démultiplié ×5, pastille « Précision ×5 », vibration courte | Alt + flèche |
| Déplacer une plage | glisser son corps | glisser son corps | — (bords un par un) |
| Choisir une plage | clic | toucher | Tab vers ses poignées ; liste dessous |
| Se déplacer dans l'audio | glisser hors plage ; molette horizontale / Maj+molette ; vue d'ensemble | glisser à un doigt ; vue d'ensemble | fenêtre d'ensemble : ←/→ (10 %), Maj+←/→ (50 %) |
| Zoomer | Ctrl/⌘ + molette (autour du pointeur), boutons | **pincer**, boutons | `+` / `-` sur la fenêtre d'ensemble |
| Proposer un verset | clic sur un passage → bulle « Passage 5 · 1:38,3 → 1:57,2 · **Ajouter ce verset** » ; double-clic = ajout direct | toucher un passage (même dans une plage, tant qu'on ne la déplace pas) | — (raccourcis ci-dessous) |
| Écouter | bouton | bouton | Espace sur une poignée |
| Retirer | corbeille | corbeille | Suppr sur une poignée |

- La **molette verticale n'est jamais capturée** : la page continue de défiler.
- **Aimant** (activé par défaut) : à moins de 10 px, un bord se colle à « début de passage − souffle avant » ou
  « fin de passage + souffle après » ; désactivé en mode précision et au clavier (le clavier reste exact).
- Contraintes : durée ≥ `MIN_RANGE_SECONDS` (0,5 s), bornes dans [0, durée], ≤ `MAX_RANGES` (50) plages.
- Chaque fin de geste est **annoncée** dans la région `aria-live` (« Fin : 13 min 19,2 s. »).

### 5.4 Souffle (« ne jamais couper une voix »)
- Défaut : **0,6 s avant, 0,4 s après** (réglables de 0 à 3 s par pas de 0,1 s) ; **aimanter au silence**
  activé : chaque bord automatique est déplacé vers le silence le plus proche dans ±0,8 s, **sans jamais entrer
  dans la voix** (garde de 0,15 s).
- Montré par des hachures d'encre dans la plage, expliqué en une phrase dans l'encart « Ne jamais couper une voix ».
- Les plages **automatiques** (raccourcis, ajout d'un verset) suivent un changement de souffle ; une plage
  **retouchée à la main** ne bouge plus (champ `auto` → `false`).
- Si une plage coupe quand même une voix (bord retouché dans un passage), sa ligne affiche « coupe une voix »
  en `--danger`. Si deux plages se chevauchent : « chevauche la plage 2 » en `--warn` (autorisé, deux vidéos).

### 5.5 Raccourcis et liste des plages
- Puces au-dessus de la frise : **Tout l'audio** (une plage 0 → durée), **Un verset = une vidéo** (une plage par
  passage reconnu, souffle compris), **Ajouter une plage** (le passage le plus proche du centre de la loupe).
- Liste ordonnée (`<ol>`, « Plages à exporter, une vidéo chacune ») : numéro serif, **nom éditable** (sert au
  nom du fichier ; défaut « Passage 12 » / « Passages 4 à 6 », remplacé par la référence du corpus dans le
  produit), temps, durée, nombre de passages, nombre « à vérifier ». Actions : saisie précise (crayon,
  `aria-expanded`), monter, retirer. **Saisie précise** : deux champs `min:s,dixièmes` avec −/+ de 44 px,
  erreurs en clair (« Écris le temps comme 3:12,4 », « La fin doit venir au moins 0,5 s après le début »,
  « L'audio s'arrête à 51:20,0 »). Au-delà de 6 plages : « Voir les 32 autres plages ».

## 6. Apparence, qualité, bordereau

- **Format** : tuiles avec silhouette (Horizontal « YouTube, écran », Vertical « Reels, Shorts », Carré
  « Publications », Comme la vidéo « 1920 × 1080 » seulement si la source est une vidéo lisible).
- **Fond** : bande défilante horizontale (tuiles 96×64, accroche au défilement) : Ma propre image, Vidéo
  d'origine (si vidéo), les 9 photos Pexels de `web/public/backgrounds`, les 5 dégradés, Couleur unie.
- **Écriture** : taille de l'arabe (Petit/Moyen/Grand/Très grand) et place du texte (Haut/Centre/Bas) en
  contrôles segmentés ; interrupteurs traduction et onde. Repliés : curseur arabe 40–240, taille de la
  traduction, hauteur 0–100 %, remplir, couleur d'accent (`AccentDialog` existant).
- **Qualité** : 5 **paliers** qui affichent chacun le **poids total estimé pour les plages choisies** :
  Léger 720p·30, **Standard 1080p·30 (défaut)**, Fluide 1080p·60, Grand écran 1440p·30, Maximum 2160p·60 ;
  « Sur mesure » replié = les 6 résolutions × 30/60 actuels. Jauge 0 → 1 Go avec repères 250 Mo et 800 Mo.
- **Seuils** (`LIMITS`, à mettre en **configuration**, pas en dur — valeurs de départ à calibrer sur de vrais
  rendus, aucune mesure ne les fonde encore) : `warnMb 250`, `dangerMb 800`, `fileDangerMb 500`, et toujours
  « lourd » en 2160p·60. Lourd = motif hachuré + libellé, très lourd = points + libellé (jamais la couleur seule).
  Message : « Lourd : ≈ 2,9 Go. La vidéo se fabrique dans ce navigateur, qui garde tout en mémoire pendant le
  rendu : sur téléphone, il peut s'arrêter en route. 1080p reste net sur presque tous les écrans. » + action
  « Passer en 1080p · 30 im/s » dans le bordereau.
- **Bordereau** (carte droite / feuille mobile) : grand nombre serif « 3 vidéos · une par plage », durée totale,
  format + dimensions, fluidité, poids estimé, temps de rendu (« ≈ moitié de la durée à 30 im/s », d'après la
  description de l'outil MCP `export_video` ; « plus de … » en 60 im/s ou ≥ 1440p), bouton **Exporter 3 vidéos**,
  modèle du nom de fichier, et repli « Même export par l'API (export_video) » qui montre le JSON équivalent.

### États (tous dessinés dans la maquette, sélecteur « État »)
| État | Frise | Bordereau / dock |
|---|---|---|
| Chargement | squelette + « Lecture de la forme d'onde (51:20)… » (`role=status`) | squelette, bouton désactivé |
| Rien à exporter | illustration (cases pointillées), « Aucun passage coranique avec du texte… », bouton « Aller à Vérifier » | « Rien à exporter » désactivé |
| Rendu en cours | inchangée | « 2 vidéo en cours sur 3 », liste par fichier (fait ✓ + poids / barre 64 % / en attente), « Garde cet onglet ouvert… », **Arrêter après cette vidéo** |
| Terminé | inchangée | « 3 vidéos prêtes », liste, aide sur les téléchargements multiples, **Retélécharger tout**, Nouvel export |
| Erreur | inchangée | ce qui a échoué, pourquoi, ce qui est intact (« La vidéo 1 est bien téléchargée, rien n'est perdu »), **Reprendre en 1080p** / Reprendre tel quel |

## 7. Design system de l'écran

Tokens produit : **`web/app/tokens.css` tel quel** (la maquette le charge directement). Ajouts, préfixe `--x-`,
dans `docs/design/export-refonte/maquette.css` :

| Token | Valeur | Rôle |
|---|---|---|
| `--x-mini-h` / `--x-lane-h` / `--x-wave-h` / `--x-thumb-h` / `--x-ruler-h` | 36 / 22 / 112 (92 mobile) / 48 / 18 px | hauteurs de la frise |
| `--x-handle-hit` | `var(--hit)` 44 px | cible des poignées |
| `--x-handle-bar` | 4 px | trait de poignée |
| `--x-sel-edge` / `--x-sel-fill` | `--action-bg` / 9 % | sélection = encre |
| `--x-breath` | `--action-bg` à 45 % en hachures `--hatch` | souffle |
| `--x-view` / `--x-view-edge` | lapis 16 % / `--accent` | fenêtre de la vue d'ensemble |
| `--x-out-dim` | `--bg` 58 % | hors plage (réservé) |
| `--x-side-w` | 400 px | colonne aperçu + bordereau |
| `--x-dock-h` | 72 px | dock mobile |
| `--x-stage-max-h` | 46vh | l'aperçu ne prend jamais plus de la moitié de l'écran |
| `--x-gauge-ok/-warn/-danger` | `--ok` / `--warn-edge` / `--danger` | jauge de poids |

Espacements, rayons, ombres, mouvement : ceux de `tokens.css` (`--sp-*`, `--r-*`, `--shadow-pop`,
`--dur-*`, `--ease`). Mouvement sur `transform`/`opacity` seulement ; `prefers-reduced-motion` déjà global.
`cursor: pointer` : règle globale de `tokens.css`.

**Polices** : inchangées (Instrument Serif pour titres et grands nombres, Atkinson Hyperlegible Next pour
l'interface, Atkinson Hyperlegible Mono pour les temps — toutes SIL OFL 1.1, `web/public/fonts`). Arabe : police
choisie par l'utilisateur (Amiri Quran par défaut ; KFGQPC Hafs servie localement, jamais embarquée).
**Icônes** : jeu SVG du projet (trait 1,6, bouts ronds), complété de : crochets, passages, aimant, zoom ±,
cadrer, accolades (API), film, sous-titre, porte (Vérifier). Aucun paquet d'icônes tiers.

**Composants** : `StepRail`, `Chapter` (numéro, titre, résumé, repli), `RangeTimeline` (§5), `RangeList` /
`RangeItem` / `TimeStepper`, `BreathSettings`, `FormatTiles`, `BackgroundStrip`, `Segmented` (radiogroup,
flèches), `Switch`, `QualityTiers`, `WeightGauge`, `StagePreview` (+ `MiniStage`), `Bordereau` (+ `ExportDock`,
`ExportSheet`), `FileProgressList`, `EmptyState`.

## 8. Correspondance avec le code existant

| Écran | Existant | Changement |
|---|---|---|
| Format | `VideoPrefs.orientation` | aucun |
| Taille arabe / traduction | `arabicSize`, `translationSize`, `ARABIC/TRANSLATION_SIZE_PRESETS` | aucun |
| Place du texte | `textPosition` (12/50/88 + fin) | aucun |
| Traduction, onde, remplir, accent | `showTranslation`, `showWave`, `fill`, `accent` | aucun |
| Fond | `background`, `bg`, `chooseBackground` | aucun (bande au lieu de grille) |
| Paliers qualité | `resolution`, `fps`, `VIDEO_RESOLUTIONS`, `VIDEO_FPS_CHOICES` | nouveau tableau `VIDEO_QUALITY_TIERS` (libellé, usage, résolution, fps) dans `export-video-format.ts` |
| Poids | `estimateVideoMegabytes(h264Bitrate(w,h,fps), s)` | calculé **par plage** et sommé ; seuils `LIMITS` en configuration |
| Plages | `RangeRow` texte, `parseRangeRows`, `rangesFromCards`, mode `all/ranges/verses` | modèle unique `ExportRange & { id, name, auto }` ; les trois modes deviennent des **raccourcis** qui remplissent la liste |
| Souffle | — | `rangesFromCards(cards, duration, { before: 0.6, after: 0.4, snap })` ; nouvelles préférences `paddingBefore`, `paddingAfter`, `snapToSilence` dans `videoPrefsSchema` (mémorisées comme le reste) |
| Nom des fichiers | `videoFileName`, `rangeLabel` | suffixe = nom de la plage assaini (repli : `rangeLabel`) |
| API / MCP `export_video` | `ranges[{start,end}]`, `per_verse` | ajouter `ranges[].name` (optionnel) et `padding {before_s, after_s, snap_to_silence}` ; `per_verse` applique le même souffle. Le bloc « Même export par l'API » affiche exactement ce JSON : l'humain et l'agent manipulent les mêmes notions |
| Sous-titres | `ExportOptions` (`format`, `content`, `formulas`, `repetitions`, `min_s`, `max_s`, `line_chars`, `offset_ms`, `rtl`, `strip_notes`, `show_ref`, `bom`, `karaoke`, `font`) | aucun champ ; regroupement : Format (tuiles) · Ce qui s'affiche (`content`, `formulas`, `repetitions`) · Réglages fins (le reste). `karaoke` et `font` n'apparaissent qu'en ASS |
| Vérifier | `VerdictCard`, `ReadinessList`, `Filters` | + frise d'ensemble en lecture seule (losanges sur les ambigus, clic = aller à la carte) |

## 9. Ce que le développeur doit ajouter côté données

1. **Silences** : calcul client depuis `GET /api/sessions/{id}/peaks` (50 crêtes/s) — suites de crêtes sous un
   seuil pendant ≥ 0,15 s. Seuil = configuration calibrée (le moteur a peut-être déjà une notion de silence côté
   Python : à réutiliser si elle existe plutôt que d'en inventer une seconde).
2. **Imagettes vidéo** : nouvel endpoint `GET /api/sessions/{id}/thumbs?every=<s>&h=48` qui renvoie une planche
   JPEG (ffmpeg `fps=1/<s>,scale=-2:48,tile`) + un JSON d'index, en cache dans `listening/` (fichiers dérivés,
   régénérables, jamais exportés). Côté client, seulement en repli si l'endpoint manque.
3. **Rangée des passages** : déjà dans `result.intervals` (kind, status, t, ref) — afficher la **référence du
   corpus** dans la bulle et les noms par défaut.
4. **Progression par fichier** : `renderSessionVideo` doit exposer `onProgress({ file, files, ratio })` structuré
   au lieu d'un texte, et télécharger chaque fichier dès qu'il est prêt ; arrêt propre « après cette vidéo ».
5. **Lecture d'une plage** : `usePlayer().playRange(start, end)` existe déjà — la brancher sur « Écouter la plage ».
6. **Échec mémoire** : attraper l'erreur d'encodeur/allocation, garder les fichiers déjà produits, proposer
   « Reprendre en 1080p » à partir du fichier en échec.

## 10. Accessibilité — critères vérifiables

- Contraste : uniquement des paires de `tokens.css` déjà mesurées (texte ≥ 4,5:1, contours ≥ 3:1, focus ≥ 7:1).
  Seul ajout coloré non textuel : hachures du souffle (décoratives, doublées par la légende et le texte).
- Aucun état porté par la couleur seule : motifs (aplat, hachures, points, double trait), libellés « lourd »,
  « très lourd », « coupe une voix », « chevauche ».
- Clavier complet : rail (←/→), radiogroups (flèches), poignées (§5.3), fenêtre d'ensemble, Échap ferme bulle et
  feuille. Focus visible partout (`--focus`).
- Lecteur d'écran : région `aria-live` unique pour les annonces ; `role=slider` + `aria-valuetext` parlé ;
  `role=img` + description pour la frise d'ensemble de Vérifier.
- Cibles ≥ 44 px (poignées, steppers, puces, tuiles), zéro défilement horizontal de page à 375 px (vérifié :
  `scrollWidth = 375` sur les trois onglets).
- `prefers-reduced-motion` : défilement « auto », pas d'animation de squelette.

## 11. Preuves de rendu (Chrome 375 px via `cadre-mobile.html`, et 1280 px)

`docs/design/export-refonte/captures/` :
- Vidéo : `video-1280-sombre.png`, `video-1280-clair.png`, `video-375-sombre.png`, `video-375-clair.png`
- Vidéo importée (imagettes + « Comme la vidéo ») : `video-source-1280-sombre.png`
- 38 plages en 4K 60 im/s (avertissement) : `video-lourd-4k-1280-sombre.png`
- Bulle « Ajouter ce verset » + saisie précise : `saisie-precise-375-clair.png`
- Feuille récapitulative mobile : `recap-feuille-375-sombre.png`
- États : `etat-rendu-1280-sombre.png`, `etat-termine-375-clair.png`, `etat-erreur-1280-clair.png`, `etat-vide-375-sombre.png`
- Autres onglets : `verifier-375-sombre.png`, `verifier-1280-clair.png`, `soustitres-1280-sombre.png`, `soustitres-375-clair.png`

Interactions éprouvées dans le navigateur (évènements pointeur et clavier) : glisser la fin +80 px (15,7 s →
18,3 s), Maj+← sur le début (−1 s), `[` (saut au bord de passage voisin), « Un verset = une vidéo » (38 plages),
« Tout l'audio » (≈ 2,0 Go à 1080p·30 signalé lourd), toucher un passage dans une plage → bulle bornée à la
frise. Console sans erreur.

## 12. Ouvert

- **Calibrer les seuils de poids et de mémoire** sur de vrais rendus (téléphone Android milieu de gamme, iPhone,
  bureau) ; les valeurs 250/800/500 Mo sont des points de départ, pas des mesures.
- **Temps de rendu** : la règle « moitié de la durée à 30 im/s » vient de la description MCP ; à mesurer pour
  60 im/s et ≥ 1440p avant d'afficher un chiffre au lieu de « plus de ».
- Plages par **sous-titres** (exporter un SRT par plage) : la frise le permettrait ; non demandé, non dessiné.
- Ordre des plages par **glisser-déposer** au bureau (la maquette n'a que « monter ») : à décider.
- Faut-il ouvrir directement sur « Vidéo » quand tout est vérifié ? Proposé, à valider par le mainteneur.
- Aperçu plein écran au toucher sur téléphone (l'arabe à taille réelle est petit dans une vignette de 343 px).
