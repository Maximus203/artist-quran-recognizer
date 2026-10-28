# Export vidéo animé d'une session

Socle serveur : `POST /api/sessions/<id>/export/video` en segments (`content-type: video/h264`,
en-têtes `x-aqr-job`, `x-aqr-part`, `x-aqr-last: 1` ; le dernier déclenche le mux et répond
le MP4). Mêmes droits que l'export : qui voit la session peut exporter ; privée = propriétaire.
Interface : onglet « 3 · Vidéo » de la page Exporter (`/s/<id>/exporter`), visible sur tous
les écrans. Vidéo originale : `GET /api/sessions/<id>/video` (404 si le source n'est pas un
conteneur vidéo).

## Must-pass (serveur)

- Segments écrits dans l'ordre strict (`part-0`, `part-1`…), refus d'un trou ou d'un doublon,
  refus d'un segment vide ou > 256 Mio, refus d'un job mal formé.
- Dernier segment → MP4 `video/mp4` en pièce jointe : H.264 (copie, sans ré-encodage) + AAC sur
  la copie d'écoute, flux brut horodaté à 25 im/s (`setts`), **jamais `-shortest`** (il supprimait
  toute la bande son) : les deux pistes durent ≈ la durée audio.
- Le mux nettoie toujours le dossier du job (succès comme échec) ; rien ne reste dans `exports/`.
- Session non terminée : `409 not_ready` ; identifiant invalide ou sans droit : `404`.
- La ligne de commande est une fonction pure testée (`lib/export-video-args.ts`).

## Must-pass (rendu, vérifié image par image sur une vraie session)

- Le verset affiché porte le texte exact du résultat (corpus) ; le mot courant est surligné
  à l'instant t (comparer avec `word_times` du résultat) ; hors passage, écran neutre.
- L'onde occupe le quart bas ; la partie jouée est claire, la partie à venir sombre ; la
  frontière avance avec le temps.
- La traduction suit l'option « Afficher la traduction » ; l'attribution QuranEnc n'apparaît
  nulle part dans la vidéo.
- 25 im/s, dimensions paires, durée = durée de l'audio.

## Scénarios d'écran (atelier)

- Onglets « 1 · Vérifier » / « 2 · Réglages » / « 3 · Vidéo » visibles sur desktop ET mobile ;
  chaque onglet montre son panneau seul ; retour au premier onglet sans perte d'état.
- Format : paysage / portrait / carré mis à jour dans l'aperçu ; « Format de la vidéo »
  n'apparaît que pour une session importée en vidéo, et la vidéo produite reprend alors ses
  dimensions.
- Tailles arabe et traduction (Petit, Moyen, Grand, Très grand + « Réglage précis ») : le choix
  se voit tout de suite dans l'aperçu, se mémorise et est repris après rechargement de la page ;
  la case traduction aussi.
- Fond : défaut lisible (jamais noir) ; image téléversée visible dans l'aperçu et dans la vidéo ;
  retrait de l'image possible ; sans choix sur une session vidéo, la vidéo d'origine sert de fond
  avec un support lisible derrière le texte.
- Export : progression lisible (préparation → rendu des images n/N → envoi des segments) →
  téléchargement d'un MP4 nommé d'après la session.
- Erreurs en français clair (toast + ligne d'état) : ffmpeg absent, navigateur sans WebCodecs,
  session sans passage affichable.

## Rendu et ergonomie (vérifiés sur de vrais exports décodés)

- Verset très long (ex. 2:282) : retour à la ligne automatique, tailles réduites ensemble, aucun
  chevauchement, rien sous l'onde, aucun mot coupé — en horizontal, vertical et carré.
- Aperçu réel au-dessus des réglages (collant sur téléphone) ; mêmes dimensions et même mise en page
  que l'export.
- Galerie de fonds : dégradés, photos libres, « Ma propre image », « Vidéo d'origine », couleur unie ;
  choisir un fond proposé retire l'image téléversée ; défaut jamais noir ; liens Unsplash, Pexels,
  Pixabay et Freepik ouverts dans un nouvel onglet.
- Session vidéo importée (MP4) : « Comme la vidéo importée » apparaît avec ses dimensions, la vidéo
  sert de fond, la traduction se pose dessus sur un support aux bords doux. MP4/WebM sans image :
  message clair.
- MP4 produit : durée = audio, piste son présente, dimensions du format choisi.

## Réglages avancés, aperçu animé et nom du fichier

- « Remplir tout l'espace » : les écritures occupent la zone libre sans jamais déborder ; verset long = réduction.
- Hauteur du texte (Haut, Centre, Bas, curseur) et case « Afficher l'onde » : le texte se déplace / prend toute la hauteur.
- Couleur d'accent : automatique par défaut ; fenêtre avec huit couleurs douces et curseurs teinte, intensité,
  luminosité, opacité ; l'aperçu change en direct ; le choix est mémorisé.
- « Lire l'aperçu animé » : dix secondes avec le son, le mot récité se surligne, retour au bouton à la fin ou à l'arrêt.
- Nom du fichier : proposé = nom de l'audio ; modifiable ; le fichier téléchargé porte exactement ce nom en `.mp4`.
- Onglet « 2 · Réglages » sur grand écran : pas de colonne vide, réglages et aperçu côte à côte.

## À couvrir à la main (non automatisé)

- Fond vidéo de bout en bout sur une vraie session importée en vidéo (aucune en base de test) :
  le texte reste lisible (dégradé) et le format d'origine est respecté.
- Une session longue (≥ 10 min) : plusieurs segments envoyés, temps de rendu total acceptable.
