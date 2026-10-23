# Décalage audio et calage à l'oreille (interface `web/`)

Surface : Compte > Préférences > Affichage, et carte « Passage actif » de l'atelier. Préférence `audioOffsetMs`
(−500 à +500 ms, pas de 10, défaut 0). Fonctions pures : `web/lib/audio-offset.ts`, `liveAt` (`web/lib/passage.ts`).
Mobile d'abord (375 px), puis 1280 px, clair et sombre.

## Must-pass

- Mesure de référence, décalage 0 (script de mesure : lecture réelle en Chrome, build de production) : le mot surligné
  suit `audio.currentTime` avec un retard de quelques dizaines de ms au plus, jamais une avance ; le lecteur lit la
  copie d'écoute (`X-AQR-Listening: engine-pcm`, durée = durée du moteur).
- Décalage +200 ms : le retard mesuré passe à ≈ 200 ms de plus ; −150 ms : le surlignage avance de ≈ 150 ms.
- Le décalage retarde le mot arabe, le fragment de traduction suivi et le changement de passage, en lecture ; à
  l'arrêt, un clic sur un mot garde ce mot, même avec un grand décalage.
- Curseur des préférences : flèches = ±10 ms, Début = −500, Fin = +500, valeur lisible (« +50 ms », « −40 ms »),
  « Remettre à 0 » ; retrouvé après rechargement et par `GET /api/me/preferences`.
- « Caler à l'oreille » : visible seulement quand un verset est affiché et que le surlignage est actif ; l'ouverture
  lance la boucle du début du passage (8 s au plus) ; le verset reste affiché même avant l'arrivée du son ; curseur,
  − et + déplacent le surlignage en direct ; « Arrêter la boucle » met en pause, « Écouter en boucle » relance ;
  « Terminé » ou Échap referme et arrête la lecture. Le réglage est enregistré au compte.
- 375 px : aucune barre de défilement horizontale, cibles tactiles ≥ 44 px, thèmes clair et sombre lisibles.

## Must-fail

- Valeur hors bornes, hors pas ou non entière (−510, 510, 15, 0,5, « 100 », null) : refusée par l'API des préférences.
- Sans temps de mots valides, aucun mot n'est surligné, quel que soit le décalage (jamais un mot deviné).
- Le décalage ne change ni l'audio, ni l'onde, ni la tête de lecture, ni les temps du moteur, ni l'export.
- Surlignage coupé : le bouton « Caler à l'oreille » disparaît et un calage ouvert se referme.
- Changer de session ferme le calage ouvert.

## Vérification du 23 octobre 2026

Build de production, Chrome, copie jetable des sessions au micro (df717b38, 4b40adf2, f23b8388) et compte de test
local : mesures et parcours consignés dans la PR #101 et dans `docs/RELEASE-NOTES.md`.
