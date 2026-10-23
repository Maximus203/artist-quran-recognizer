# Fluidité de l'atelier sur les longs audios (interface `web/`)

Surface : console (onde, pistes, lecteur), liste des intervalles, carte « Passage actif ». Données : une session de
2 h (≈ 3 000 intervalles dont ≈ 3 000 abstentions ; sessions réelles `lot1-04`) et un témoin de 15 min. Build de
**production** (`next build` puis `next start`) sur une COPIE des sessions, jamais le serveur du mainteneur.
Mobile d'abord (375 px), puis 1440 px. Mesure : `web/e2e/perf-measure.mjs` (voir `web/README.md`).

## Must-pass

- Ouverture : le squelette (« Chargement de la session… ») apparaît tout de suite ; contrôles, liste et onde sont
  utilisables en moins de 2 s, crêtes comprises (mesuré : 0,3 à 0,5 s ; avant : 2,5 à 4 s).
- Nœuds DOM bornés à l'écran (≈ 1 000 pour 3 000 intervalles, au lieu de 22 400) quel que soit le zoom ; après 3 × 50
  sauts, nœuds, écouteurs et mémoire JS stables (pas de fuite).
- Saut entre versets (clic sur une ligne, flèches, clic sur un segment) : aucune tâche longue > 50 ms en
  régime normal ; la latence geste → image peinte reste de l'ordre de 30 ms (avant : 1,7 s).
- Lecture : la tête de lecture avance sans à-coup, le surlignage des mots suit, la carte change de passage sans
  retard ; la position affichée change 20 fois par seconde au plus, la tête de lecture 60 fois.
- Liste virtualisée : `aria-setsize` = nombre total de lignes (3 128), `aria-posinset` correct sur chaque ligne ;
  Tab arrive sur UNE ligne (celle focalisée, sinon la choisie, sinon celle qui joue) ; flèches haut/bas, Début, Fin,
  Page précédente/suivante déplacent le focus ligne à ligne, y compris vers des lignes pas encore dans le DOM ;
  Entrée ou Espace choisit la ligne et place le lecteur ; le filtre repart du haut et annonce sa nouvelle taille.
- « Suivre la lecture » : la ligne qui joue reste visible dans la liste sans faire défiler la page.
- Timeline « Fichier entier » : les abstentions contiguës forment des blocs lisibles (151 blocs au lieu de 3 128
  segments), l'onde reste visible entre eux ; chaque bloc se clique et choisit l'intervalle le plus proche du temps
  cliqué, jamais « rien ».
- Zoom 2 min / 30 s / 10 s : les segments individuels reviennent, chacun clique et choisit son intervalle ; les
  graduations ne couvrent que la zone proche (≈ 10) ; le changement de fenêtre ne bloque pas (21 à 64 ms mesurés).
- Glisser la timeline (souris) fluide ; la fenêtre de rendu se renouvelle quand la vue en sort, sans trou d'affichage,
  jusqu'au bout du fichier.
- L'intervalle choisi garde son contour sur l'onde et les pistes, même minuscule à l'échelle du fichier entier.
- Signalements : pose début/fin, tracé sur l'onde, poignées au clavier (flèches), régions et piste Revue inchangés.
- 375 px : lignes de 72 px (deux lignes de texte), aucun scroll horizontal, zones tactiles inchangées.

## Must-fail

- Un clic sur la timeline ne doit jamais choisir un intervalle éloigné de plus d'un pixel du clic (à l'échelle
  affichée) ni laisser la sélection inchangée quand il tombe dans le vide d'un bloc.
- Aucune ligne de la liste ne peut devenir inatteignable au clavier (pas de focus perdu, pas de tabulation sur 3 000
  lignes), ni silencieuse pour un lecteur d'écran (taille et rang annoncés).
- Aucun segment ne reste affiché à l'ancienne échelle après un changement de zoom ; aucune pointe de milliers de nœuds
  pendant la transition « Fichier entier » → « 2 min ».
- Le texte arabe, la traduction et les temps affichés restent exactement ceux du résultat (I1, I2) : le fenêtrage et la
  fusion de segments ne changent que le dessin des pistes.
- Rien ne bouge sur le serveur du mainteneur : le banc ne s'exécute que sur une copie.
