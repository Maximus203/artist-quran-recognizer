# Atelier de revue — direction « Encre & lapis »

Brief de direction artistique pour le redesign complet de l'atelier (`web/app`). Livré avec
`tokens.css` (variables prêtes à coller) et `prototype/index.html` (écran statique, données factices,
ouvrable tel quel dans un navigateur). Les captures de contrôle sont dans `captures/`.

**Une phrase.** Un pupitre de relecteur : l'encre pour les actions, un seul bleu lapis pour la voix
du moteur, et la couleur réservée aux statuts. Le verset est la star, l'outil s'efface.

## 0. Décisions clés

1. **Sortir du tout-vert.** Fond encre de nuit (neutre, légèrement bleuté), texte ivoire, **un seul
   accent : le lapis**. Le vert n'existe plus que dans une pastille « Validé à l'oreille ».
2. **L'action principale est l'encre, pas la couleur.** Bouton primaire = aplat ivoire (sombre) ou
   noir (clair). Le lapis est réservé à la *donnée* (segments reconnus, progression, point non lu).
3. **Les états des intervalles se lisent sans la couleur** : aplat plein, hachures, points,
   contour pointillé, double trait, losange — mêmes codes sur l'onde, les pistes, la liste, la légende.
4. **Trois zones, deux panneaux repliables** (bouton dans la barre du haut, état mémorisé, avec pastille
   « non lu / en cours » qui reste visible panneau fermé). Sous 1280 px ce sont des tiroirs.
5. **La liste des sessions devient une file d'attente lisible** : anneau de progression + ETA,
   rang dans la file, point « non lu » qui disparaît à l'ouverture, durée réelle et facteur temps réel.
6. **Le verset s'affiche toujours comme un verset** : la basmala devient une carte complète avec un
   badge « Basmala ». Police arabe réglable (4 candidates), taille réglable, mémorisées.

## 1. Concept et benchmark

**Concept** (étape « concept avant style »). Le message à faire passer : *« tu peux faire confiance à ce
que tu écoutes, et tu vois exactement où le moteur doute »*. Contresens à éviter : une appli
« religieuse » à coupoles dorées sur fond vert, ou un dashboard SaaS générique. Métaphore retenue : la
**relecture d'épreuves** — papier/encre, filets fins, annotations en marge. Procédé : contraste
(le neutre est calme, seul l'écart — doute, hypothèse, correction humaine — attire l'œil).

### Références réellement ouvertes

| Référence | Geste retenu (adaptation) | Ce qu'on refuse |
|---|---|---|
| [quran.com/2/255](https://quran.com/2/255) | Une carte unique par verset : arabe centré et grand, actions du verset au-dessus, traduction plus petite dessous, colonne latérale pour le reste | Gris sur gris sans hiérarchie, trop d'encarts éditoriaux |
| [Dribbble · Audio Transcription Dashboard — List View (richard.ux)](https://dribbble.com/shots/6854340-Audio-Transcription-Dashboard-List-View-WIP) | Liste de fichiers avec colonne de statut et durée par ligne ; la ligne en cours porte sa propre progression | Fond cyan saturé, boutons bleus partout |
| [Dribbble · recherche « audio transcription dashboard »](https://dribbble.com/search/audio-transcription-dashboard) | **Anti-référence** : la catégorie est dominée par les dégradés lilas et l'onde vert néon (« Voxal ») — exactement le tout-vert que Cherif rejette | Dégradés, néon, cartes pastel |
| [linear.app](https://linear.app/) | Barre latérale repliable, icônes de statut **par la forme** (anneau vide, demi-plein, coche), filets 1 px, couleur réservée au statut | La densité extrême (notre public est plus large) |
| [awwwards.com · Typography](https://www.awwwards.com/websites/typography/) | Filtres en une rangée de pastilles ; bouton primaire noir sur papier clair → le primaire est l'encre | Les animations d'agence |
| [descript.com](https://www.descript.com/) | Le texte est la surface principale, la timeline est secondaire → sur mobile le passage passe avant l'onde | Le montage (hors sujet) |

Inspiration ≠ copie : rien n'est repris tel quel ; chaque geste est adapté à une relecture à l'oreille.

### Deux directions

- **A — Encre & lapis (recommandée).** Papier/encre, filets fins, un bleu lapis (pigment des
  manuscrits enluminés, sans l'or). Le verset en grand, l'interface en retrait. Lisible par un inconnu,
  très bon en mobile pour la consultation, thème clair naturel (papier).
- **B — Cabine.** Console de mixage : graphite neutre, mono dominant, accent orange « LED », lanes
  serrées, nombres en tabulaire partout. Excellent pour la revue experte, mais froid pour un nouvel
  utilisateur, l'arabe y devient secondaire, et l'orange cuivré a déjà servi (Ribat, Murabbi Admin).
- **Recommandation : A.** L'objectif proche est le déploiement vers des inconnus : l'accueil et la
  lecture priment ; la densité experte s'obtient avec les panneaux fermés/ouverts, pas avec une autre identité.

Registre : « Ribat », « Upgradetech », « Leçon sous la main » et « Preuve discrète » ont été lus.
Interdits de reprise respectés : Fraunces, IBM Plex, Cabinet Grotesk, Switzer, Geist, Newsreader, Sora,
Plus Jakarta Sans, Poppins, cuivre `#BA5B27`, bleu `#356E9A`, teal `#00688F` + lime.

## 2. Palette (tokens dans `tokens.css`)

Sombre à gauche, clair à droite ; `light-dark()` + `color-scheme` (suit le système, forçable par
`data-theme`). Ratios WCAG mesurés (script de calcul, pas à l'œil).

| Rôle | Sombre | Clair | Usage / contraste |
|---|---|---|---|
| `--bg` | `#0e1013` | `#f4f0e6` | Fond de page |
| `--surface-1` | `#14171b` | `#faf7f0` | Barre du haut, panneaux |
| `--surface-2` | `#1a1e23` | `#fdfbf7` | Cartes, console, champs |
| `--surface-3` | `#232830` | `#ece6d9` | Survol, éléments enfoncés |
| `--border` / `--border-strong` | `#2f3640` / `#68717e` | `#d2cab8` / `#8a8575` | Strong = contour de champ ≥ 3:1 (3,4 / 3,6) |
| `--text` | `#eeeae0` | `#1b1c20` | 13,9:1 sur surface-2 / 16,5:1 |
| `--text-2` | `#bdbab1` | `#4b4e57` | 8,6:1 / 8,0:1 |
| `--text-3` | `#9096a0` | `#5f626b` | ≥ 5,0:1 sur toutes surfaces / ≥ 4,9:1 |
| **`--accent` (lapis)** | `#78a0ff` | `#2447b8` | 6,6:1 / 7,6:1 sur surface-2 |
| `--action-bg` / `-fg` | `#eeeae0` / `#0e1013` | `#1b1c20` / `#f4f0e6` | Bouton primaire (15,9:1 / 15,0:1) |
| `--focus` | `#a9c2ff` | `#1a37a0` | Anneau de focus 2 px, ≥ 9:1 |
| `--ok` · `--warn` · `--danger` · `--slate` | `#7cc49c` · `#e6ae45` · `#f2837a` · `#9aa6b8` | `#2f7552` · `#8a5a00` · `#b3392f` · `#566377` | Statuts uniquement, ≥ 5,4:1 sur surface-2 |

**Règles d'usage.** (1) Aucune couleur sémantique en décoration. (2) Aucun dégradé. (3) Le lapis ne
colore jamais un bouton d'action. (4) Le vert (`--ok`) n'apparaît que sur « Validé à l'oreille ».
(5) Un statut = couleur **+** motif **+** libellé, jamais la couleur seule.

### Avatars de personnes (photo de profil)

Une personne n'est ni un statut ni l'accent : ses initiales ont leurs propres jetons, `--av-0` … `--av-7` (lapis, encre, terre cuite, cyprès, ocre, ardoise, grenat, sarcelle), avec le texte `--av-fg` posé dessus. Contraste mesuré ≥ 5,9:1 (clair, texte `#fdfbf7`) et ≥ 7,5:1 (sombre, texte `#0e1013`) sur les huit. Sans photo, l'indice est une empreinte stable du pseudo normalisé (`web/lib/avatar-tone.ts`) : la même personne garde la même couleur partout. Avec photo : cercle, JPEG carré 256 px, `object-fit: cover`, l'initiale reste dessous si l'image ne charge pas. Tailles 24 px (listes), 32 px (en-tête), 56 px (préférences). Le pseudo est toujours écrit à côté : l'avatar est décoratif (`alt=""`).

### Codage des intervalles (onde, pistes, liste, légende — identique partout)

| État | Motif (aplat + trait supérieur 3 px) | Couleur | Libellé |
|---|---|---|---|
| Reconnu | aplat plein, trait plein | lapis | Reconnu |
| Déduit / hypothèse | hachures 45°, trait en tirets longs | lapis | Déduit de la position |
| Incertain | points, trait pointillé | ambre | Incertain |
| Formule | aplat gris, **double** trait | ardoise | Formule |
| Abstention | **aucun** aplat, contour pointillé | gris | Abstention |
| Correction humaine | losange + soulignement épais (piste « Revue ») | ivoire/encre | Correction humaine |

Séparation par les formes mesurée avec le validateur de palette : écarts CVD 15–17 ΔE sur les paires
adjacentes, contraste ≥ 3:1 ; il signale « hors bande de luminosité » pour l'ivoire et l'ardoise, voulu
(ce sont des neutres) → c'est pourquoi le motif et le libellé sont obligatoires.

## 3. Typographie

### 3.1 Latin (hors liste d'interdits, licences vérifiées dans le dépôt `google/fonts`)

| Rôle | Police | Licence | Pourquoi |
|---|---|---|---|
| Titres de panneau, wordmark, grands nombres | **Instrument Serif** (400, italique) | SIL OFL 1.1 | Serif condensée de caractère ; l'italique sert « de revue » |
| Interface, corps, boutons | **Atkinson Hyperlegible Next** (variable 200–800) | SIL OFL 1.1 | Dessinée par le Braille Institute pour la lisibilité : un argument d'accessibilité réel pour un outil public |
| Temps, SHA, durées, ETA | **Atkinson Hyperlegible Mono** (variable) | SIL OFL 1.1 | Chiffres tabulaires, même famille |

Charge : `next/font/google` (auto-hébergée au build, aucune requête Google côté visiteur — important
pour la vie privée). Repli défini dans `tokens.css`. Échelle : 12 · 13 · 15 · 17 · 22 · 30 · 44 px ;
**12 px est un plancher**. Étiquettes en capitales : 12 px / 600 / interlettrage 0,08 em.

### 3.2 Police du Coran — candidates

Le texte vient du corpus (I1), seule la **police** change. Interligne ≥ 2 (signes voyelles empilés).

| Police | Licence | Poids | Notes |
|---|---|---|---|
| **Amiri Quran** (K. Hosny, S. Kosch) | SIL OFL 1.1 | 400 · 137 Ko (TTF) | Naskh classique, dessinée pour le Coran, tous les signes ; **défaut proposé** |
| **Scheherazade New** (SIL) | SIL OFL 1.1 | 400–700 · 332 Ko (400) | Formes ouvertes, très lisible en petit et sur mobile |
| **Noto Naskh Arabic** (Google) | SIL OFL 1.1 | 400–700 variable · 308 Ko | Police actuelle ; déjà dans `public/fonts` |
| **KFGQPC Uthmanic Script HAFS** (Complexe du Roi Fahd) | « gratuite propriétaire » : modification et redistribution sans accord écrit **interdites** (source : ScanCode LicenseDB ; la page officielle ne publie pas de termes) | à télécharger | Écriture du Mushaf de Médine, la plus fidèle pour Hafs. **Ne pas embarquer ni servir** sans autorisation écrite du Complexe |

Sélecteur (prototype : bouton « Police arabe » dans la carte du passage) : popover (feuille basse sur
mobile) avec 4 options en radio, aperçu en direct de la basmala dans chaque police, curseur de taille
28–72 px (pas de 4, défaut 40 bureau / 32 mobile), bouton « Réinitialiser ». Mémorisé dans
`localStorage` (`aqr.ui.v1`). Option indisponible : grisée + « à télécharger », jamais sélectionnable.
Une seule police arabe chargée à la fois (les autres à la demande).

**Le nom exact de la police préférée de Cherif manque** : il suffit d'ajouter une ligne
`[data-quran-font="…"]` dans `tokens.css` et une carte dans le popover.

## 4. Espacements, rayons, ombres, mouvement

- **Espacements** : échelle de 4 px (`--sp-1` … `--sp-12`), gouttière 16 px mobile / 24 px bureau.
- **Rayons** : 4 (segments) · 8 (champs, boutons) · 12 (cartes) · 18 (console, tiroirs) · pilule.
- **Ombres** : presque aucune. La hiérarchie vient des surfaces et des filets 1 px ; ombre uniquement
  pour les menus (`--shadow-pop`) et tiroirs (`--shadow-drawer`).
- **Mouvement** : 120 / 200 / 320 ms, courbe `cubic-bezier(.2,0,0,1)` ; `transform` et `opacity` seulement
  (sauf le repli des panneaux, en `grid-template-columns`). `prefers-reduced-motion` : tout passe à 0.

## 5. Composants

**Boutons** (hauteur 40 bureau, 44 au tactile — `@media (pointer: coarse)` — variantes `--sm` 32/44, `--lg` 48/52) :

| Variante | Rendu | Quand |
|---|---|---|
| Primaire | aplat encre/ivoire | **Une seule par zone** : Importer, Confirmer après écoute, Valider, Écrire dans le manifeste |
| Secondaire | contour `--border-strong` | Signaler ici, Choisir une plage, Écouter ce passage, Pack ZIP |
| Discret | sans contour, texte `--text-2` | Actualiser, Exclure, Relancer en liste dense, A− A+ |
| Danger | contour et texte `--danger` | Annuler ce signalement, Arrêter le traitement (jamais un aplat rouge) |

Quand un brouillon de signalement est ouvert, « Signaler ici » repasse en secondaire : un seul
primaire visible (« Confirmer après écoute »). États : hover, `:active` (−1 px), `:focus-visible`
(anneau 2 px `--focus`, décalage 2 px), `:disabled` (opacité .45 + `cursor: not-allowed`).

**Champs** : 40/44 px, fond `surface-2`, contour `--border-strong` (≥ 3:1), étiquette au-dessus
(13 px / 600), aide en `--text-3`. **Interrupteur** (Suivre la lecture, Afficher la traduction) :
`role="switch"`, 38×22, zone tactile 44 px. **Pastilles de filtre** : 32 px (44 tactile), sélection =
fond lapis léger + contour lapis. **Badges de statut** : rectangle à coins 4 px (même géométrie que les
segments), pastille-échantillon du motif + libellé. **Point non lu** : disque 10 px `--accent`,
`aria-hidden`, doublé d'un texte masqué « Non lue » et d'un titre en gras. **Barre de progression** :
3 px, fond `--border-subtle`, remplissage `--accent`. **Cartes** : `surface-2`, contour 1 px, rayon
12–18, liseré clair intérieur (`--hairline-top`).

## 6. Layout

Mobile d'abord (375), puis 768, puis 1440.

| Zone | ≥ 1280 | 768–1279 | < 768 |
|---|---|---|---|
| Barre du haut (56 px) | bouton panneau gauche, wordmark, onglets *Revue · Performance*, « Nouvel essai » (primaire), thème, bouton panneau droit | idem | bouton gauche, « Atelier », « + », thème, bouton droit |
| Panneau gauche (sessions) | colonne 300 px, repliable | tiroir gauche (92 vw, max 380) | idem, + lien « Performance » en pied |
| Centre | colonne ≤ 1080 px | colonne unique | colonne unique, **lecteur ancré en bas** |
| Panneau droit (revue) | colonne 360 px, repliable | tiroir droit | idem |

- **Repli** : transition de colonne 320 ms, `visibility` retardée, `aria-expanded` sur le bouton, mémorisation
  par panneau (`aqr.ui.v1.left/right`). Fermé, le panneau est `inert`. Le bouton de gauche garde une pastille
  accent s'il y a du non lu ou une analyse en cours. Raccourcis suggérés : `[` et `]`.
- **Tiroir** : voile `--scrim`, fermeture par voile, Échap ou bouton ; focus piégé, retour du focus au bouton.
- **Ordre du centre** : bureau = titre → console (lecteur, onde, 3 pistes, légende) → carte du passage →
  intervalles → détails du moteur. **Mobile = titre → carte du passage → console → intervalles** (la lecture
  d'abord, l'expertise ensuite). Le lecteur (lecture, ±5 s, position) se fixe en bas (`position: fixed`,
  safe-area) ; vitesse et volume restent dans la console.
- **Pistes** : une gouttière de noms (92 px, 64 sur mobile avec noms courts) commune à l'onde, aux 3 pistes
  et à la règle, pour que **la tête de lecture traverse tout au même x**.
- **Avis riwaya** : puce discrète « Riwaya Hafs supposée · non vérifiée », soulignée en pointillé, texte
  complet en infobulle/focus. Jamais rouge, jamais masquée.
- **Pas de session ouverte** : le panneau droit est fermé et son bouton désactivé ; le centre affiche
  « Nouvel essai » (voir §11).

## 7. L'élément « session » de la liste

Rangée de 64 px minimum, 3 lignes : nom (15 px, 500 ; **700 si non lue**), statut (13 px, couleur selon
l'état), méta (12 px : icône audio/vidéo · durée de la source · moteur). À droite : heure (mono) et,
au-dessus, le point non lu. Une session courante a un filet gauche encre et fond `surface-2`.

| État | Glyphe 24 px (forme ≠ couleur) | Ligne de statut | Plus |
|---|---|---|---|
| Prêt | anneau vide | « Prêt à analyser » | — |
| **En attente** | anneau **pointillé** + rang (« 1 ») | « En attente · n° 1 dans la file » | méta : « ≈ 10 min d'analyse » |
| **En cours** | anneau + **arc de progression** lapis | « Analyse en cours · ≈ 2 min restantes » (lapis, 600) | barre 3 px sous la rangée, pourcentage à droite |
| **Terminé, non lu** | anneau + coche | « Résultat prêt · 5 min 40 s · ×7,3 » | **point lapis 10 px**, nom en gras |
| Terminé, lu | anneau + coche | « Terminé en 26 s · ×7,1 » | pas de point |
| Échec | triangle `!` danger | « Échec · moteur indisponible » (danger) | bouton « Relancer » ; point non lu aussi |
| Annulé | anneau barré | « Annulé après 2 min 10 s » | texte atténué, jamais de point |

**Règles.** *Non lu* = session `done` ou `failed` dont `seen_at` est nul ; le point disparaît (anim. 150 ms)
à l'ouverture de la session et `seen_at` est écrit côté serveur (partagé entre appareils). *Facteur temps réel*
= durée de la source ÷ durée d'analyse (« ×7,1 » : 7 fois plus vite que l'audio). *ETA en cours* =
`max(0, durée_source ÷ vitesse médiane du moteur (20 dernières analyses) − écoulé)`, arrondie à la minute
supérieure ; « moins d'une minute » sous 60 s ; si l'écoulé dépasse 1,5× l'estimation : « plus long que
prévu » (ambre), sans ETA. *Progression* = écoulé ÷ estimation, plafonnée à 95 % jusqu'à la fin réelle ;
sans historique : barre indéterminée (statique à 30 % si `prefers-reduced-motion`). *ETA en attente* =
somme des ETA devant + estimation propre.

**Regroupement et filtres** : « File d'analyse » (en cours + en attente) puis « Terminées ». Ligne de synthèse
(« 1 en cours · 1 en attente · fin estimée dans ≈ 12 min »), pastilles *Toutes · En cours · Non lues* avec compteurs.
Le titre de l'onglet porte le total non lu (« (2) Atelier de revue »).

## 8. Carte du passage actif

Carte unique, centrée, bureau 40 px d'arabe (réglable), mobile 32 px. Structure : étiquette « Passage actif » +
Police arabe + A−/A+ → méta (badge de statut, référence en Instrument Serif 22, plage en mono) → **arabe RTL**
(`lang="ar" dir="rtl"`, centré, `text-wrap: pretty`) + médaillon de fin de verset (numéro en chiffres arabes,
décor CSS, `aria-hidden`, **ajouté par l'interface, jamais dans le texte**) → filet → traduction (17 px, 68 ch
max) + attribution QuranEnc (12 px) → actions.

| Intervalle | Rendu |
|---|---|
| Verset reconnu | badge « Reconnu » (échantillon plein) |
| **Basmala** | **même carte qu'un verset** : badge encre « Basmala », libellé arabe « البسملة », petit ornement losange, texte arabe du corpus (1:1) un peu plus grand (×1,15), traduction française et attribution. Pas de médaillon de numéro |
| Verset déduit | badge « Déduit de la position » (hachures) ; pas de texte, message « jamais entendu, pas une preuve » |
| Incertain | badge ambre « Incertain », « Identification ambiguë », références candidates |
| Formule (isti'adha, takbir, amin) | **reste une étiquette**, mais avec libellé arabe lisible : « الاستعاذة », « التكبير », « آمين » (en `--font-quran`, 2,2 rem) + translittération en puce. Aucun texte du Mushaf |
| Abstention | badge « Abstention » (contour pointillé) + motif (« Score insuffisant ») et rappel de la règle « précision d'abord » |

Les marqueurs de note `[1]` que renvoie QuranEnc sont rendus en exposant discret **à l'affichage seulement**
(cf. risques). Traduction masquable par l'interrupteur « Afficher la traduction ».

## 9. Tableau de bord Performance

Vue accessible par l'onglet « Performance » (et le pied du tiroir sur mobile). Contenu :
4 tuiles (**durée moyenne**, **vitesse médiane** × temps réel, **audio traité**, **file d'attente**) en Instrument
Serif 40 px ; « Vitesse par moteur » (barres horizontales, **une seule teinte**, valeur et nombre d'analyses en
libellé direct, pas de légende ni de couleur porteuse de sens, repli « Voir en tableau ») ; « File en cours » (mêmes
glyphes que la liste, ETA) ; « Dernières analyses » (tableau tabulaire, défilement horizontal en mobile).
Filtre de période (7 j · 30 j · Tout). Méthode dataviz : forme = magnitude → barres ; axe unique ;
aucune palette catégorielle ; contraste ≥ 3:1 des barres sur la surface ; vide : « Aucune analyse terminée ».

## 10. Revue humaine et vérité terrain (panneau droit)

En-tête « Revue humaine » (Instrument Serif). Phrase d'aide, puis deux actions : **Signaler ici** (primaire tant
qu'aucun brouillon n'est ouvert) et *Choisir une plage*. Brouillon = carte à contour fort : type d'erreur,
Début/Fin (mono), description, référence attendue (facultative), « Écouter en boucle », **Confirmer après écoute**,
statut d'enregistrement, « Annuler ce signalement » (danger discret). Puis trois accordéons (`<details>`) :
*Signalements*, *Vérité terrain* (passages avec statut en badge, preuve acoustique, spans cliquables ▶,
Valider/Exclure/Rouvrir, relecteur anonyme, **Écrire N passage(s)** en primaire), *Exports* (ZIP secondaire, JSON discret).

## 11. Enregistrement et import

L'enregistreur est **conservé** (icône micro, point rouge, carré d'arrêt, minuteur) et **centré** dans la vue
« Nouvel essai » ; seule l'habillage change (carte, bouton secondaire large, minuteur mono rouge, micro qui
pulse en enregistrement). Dessous : séparateur « ou », zone de dépôt en pointillé (**audio et vidéo**, formats
listés), « Résultat existant » en accordéon facultatif, bandeau « Reconnaissance automatique ». Une vue vide
porte une illustration vectorielle dessinée pour le projet (onde + losange) — pas de photo.

## 12. Micro-interactions (GSAP, sobres)

| Moment | Effet |
|---|---|
| Changement de passage | `opacity .65→1`, `y 7→0`, 220 ms (existant), le texte arabe en fondu 160 ms |
| Nouvelle session dans la liste | hauteur 0→auto + opacité, 240 ms (Flip pour réordonner la file) |
| En cours → terminé | l'anneau devient coche (échelle .8→1), le point non lu « pop » (`back.out(2)`, 280 ms) |
| Ouverture d'une session non lue | le point se réduit à 0 en 150 ms |
| Progression | tween de largeur 600 ms `power1.out` à chaque sondage |
| Panneaux / tiroirs | CSS uniquement (320 ms) |

Tout est `gsap.matchMedia()` : sous `prefers-reduced-motion` les valeurs sont posées sans animation.

## 13. Critères vérifiables (pour Ibrahima et Cherif QA)

- **Contraste** : texte ≥ 4,5:1, texte large et non-texte ≥ 3:1, dans les deux thèmes (ratios du §2).
- **Cibles** : ≥ 44×44 px au tactile (`pointer: coarse`) ; aucun scroll horizontal à 375 px (sauf tableaux dans
  `.scroll-x`).
- **Couleur seule interdite** : chaque statut a un motif et un libellé ; vérifier par capture en niveaux de gris.
- **Focus** visible partout (anneau 2 px), ordre logique, tiroirs avec focus piégé, Échap ferme.
- **Sémantique** : `lang="ar" dir="rtl"` sur tout texte arabe ; `role="switch"`, `aria-expanded`, `aria-current`,
  `aria-pressed` ; point non lu doublé d'un texte masqué ; `aria-live="polite"` sur la carte du passage.
- **Mouvement** : `prefers-reduced-motion` coupe toute animation ; seules `transform`/`opacity` sont animées.
- **Hooks e2e à conserver ou migrer** (`web/e2e/browser-smoke.mjs`) : bouton « Importer dans l'atelier », bouton
  de lancement, `button.segment[data-index]`, `.verse-card`, `.ref`, `.badges`, `.arabic`, `a.export` → préférer
  des `data-testid` et mettre le smoke à jour dans la même PR.
- **Provenance** : aucune image externe ; icônes SVG dessinées pour le projet (trait 1,6 px, bouts ronds) ;
  polices OFL (sauf KFGQPC, non embarquée).

## 14. Correspondance avec le code et risques d'implémentation

| Fichier | Travail |
|---|---|
| `web/app/layout.tsx` | Charger les polices avec `next/font/google` ; script d'amorçage dans `<head>` qui lit `aqr.ui.v1` et pose `data-theme`, `data-quran-font`, `--quran-size` **avant** le premier rendu (sinon flash) |
| `web/app/style.css` | Remplacer `:root` par `tokens.css` ; supprimer `--mint/--gold/--red`, le dégradé de `body`, les `font-family: Manrope/DM Sans` |
| `web/app/review-app.tsx` | Scinder en composants (Header, SessionsPanel, Console, PassageCard, Intervals, ReviewPanel, FontPicker, PerfView) ; l'état des panneaux et de la police dans un petit store + `localStorage` |
| `web/app/recorder.tsx` | Même logique, nouvel habillage ; ajouter l'entrée de formats vidéo côté import |
| `web/app/validation-panel.tsx` | Habillage seulement : accordéons et boutons selon §5 |

**Risques.**
1. **Interdits actuels** : `style.css` déclare `Manrope` et `"DM Sans"` (interdits) et `layout.tsx` ne les charge
   même pas : le rendu actuel retombe sur Arial. À corriger en passant.
2. **La file d'attente n'existe pas côté serveur** : `launch()` lance Python tout de suite. « En attente » exige une
   vraie file (concurrence 1 ou 2) et de nouveaux champs : état `queued`, `enqueued_at`, `finished_at`,
   `processing_s`, `rtf`, `seen_at`, `media_kind`. Ce n'est pas qu'un habillage.
3. **Sondage** : aujourd'hui seul le détail d'une session `running` est sondé. Il faut sonder **la liste** tant
   qu'il y a du `queued`/`running` (3 s visible, 15 s caché) et au retour de l'onglet (`visibilitychange`).
4. **wavesurfer Regions** vit dans un DOM fantôme : les hachures/points ne passent pas par une feuille de style
   externe. Poser `background-image` en style inline à partir des tokens lus avec `getComputedStyle`
   (voir `--hatch`, `--dots`, `--seg-*`), comme le code le fait déjà pour l'outline.
5. **Repli des panneaux** : la largeur du centre change → rappeler `zoom()`/le calcul de pistes à la fin de la
   transition (`transitionend`), sinon l'onde se décale.
6. **`light-dark()`** : Chrome 123+, Safari 17.5+, Firefox 120+. Pour des navigateurs plus anciens, dupliquer le
   bloc clair dans `@media (prefers-color-scheme: light)` (génération PostCSS recommandée).
7. **Vidéo** : les sessions vidéo écoutent l'audio extrait ; prévoir (à arbitrer) une vignette 16:9 repliable
   dans la console — absente du prototype. L'étiquette « ÉCOUTE = AUDIO DU MOTEUR » reste exacte.
8. **Marqueurs de note `[1]`** dans les traductions : les styler en exposant par regex à l'affichage uniquement ;
   la chaîne stockée et exportée reste intacte (I2). Si le mainteneur lit I2 plus strictement, les laisser tels quels.
9. **Format Tanzil** : dans `data/corpus/quran-uthmani.txt`, le premier verset de la plupart des sourates
   commence par la basmala (constaté sur 2:1 et 112:1 : 111 sourates sur 114). Vérifier ce que renvoie l'adaptateur
   pour `N:1` avant de dessiner la carte, et ne pas afficher la basmala deux fois (badge + texte du verset).
10. **Police arabe lourde** : charger uniquement la police choisie ; `font-display: swap` ; vérifier le rendu des
    signes de pause (ۚ ۖ ۗ) et des petits alifs sur 2:255 dans chaque police (fait dans le prototype pour Amiri
    Quran, Scheherazade New, Noto Naskh).
11. **Prototype** : texte arabe de démonstration = extraits Tanzil (CC BY 3.0), non modifiés, attribution
    présente ; traduction = `french_hameedullah`. Si la politique « non redistribué dans le dépôt » doit
    s'appliquer aussi aux extraits, retirer `KURSI` et `BAS` du script du prototype.

## 15. Images, icônes, crédits

- **Images** : aucune photo (outil de travail) ; l'« image réelle » de la page est une illustration vectorielle
  dessinée (onde + losange) en tête de « Nouvel essai » et à reprendre pour l'état vide. Aucune ressource externe
  à créditer.
- **Icônes** : jeu SVG dessiné pour le projet (panneaux, lecture/pause, micro, audio, vidéo, coche, alerte,
  info, import, export, drapeau, soleil/lune, jauge), trait 1,6 px, bouts ronds — aucun paquet interdit.
- **Polices** : voir §3 ; licences OFL ; textes de licence à copier dans `public/fonts/` avec chaque fichier
  si une police est auto-hébergée à la main.

## 16. Arbitrages pour Cherif

1. **La police arabe** : donner le nom exact de la police préférée. En attendant : défaut Amiri Quran.
2. **KFGQPC (Mushaf de Médine)** : la proposer exige l'accord écrit du Complexe du Roi Fahd pour un site public.
3. **Une vraie file d'attente** (concurrence 1 ou 2 ?) : sinon on ne peut pas afficher « en attente ».
4. **Vidéo** : vignette dans le lecteur, oui ou non ?
5. **Thème** : suit le système par défaut (clair ou sombre) ; ou sombre imposé ?
6. **Marqueurs `[1]`** de la traduction : exposant discret, ou texte brut ?
7. **Échec = non lu** : proposé oui (une analyse en échec mérite d'être vue).

## 17. Registre

Note « Atelier de revue — Encre & lapis » dans le coffre (`50-Creation/Directions-artistiques/`), statut
*Proposée*, passer à *Adoptée* une fois implémentée.
