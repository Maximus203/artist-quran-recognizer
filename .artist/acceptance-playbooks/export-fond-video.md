# Export vidéo — vidéo de fond envoyée au serveur (phase 2b)
> Surfaces : [WEB] (mobile 390 px d'abord, puis 1280 px) · [API] · [BE] (magasin, rendu) · [CALC] (modèle de vue)
> Statut : voir « Preuves » · Build : `feat/export-fond-video` @ 2520321 puis correctifs · ADR-0019
> Périmètre : transport, contrôle, préparation, propriété, nettoyage, lecture par le rendu, API `background.video`, composant
> `BackgroundVideoSection`. Le composant est monté dans une page de vérification du banc (non versionnée) : il n'est pas encore
> branché dans l'écran d'export (phase éditeur).
> Environnement : atelier construit dans un worktree jetable (`harness/h.mjs build --overlay`), base jetable, Chrome de Playwright ;
> vidéos de test générées par ffmpeg (`harness/make-clips.mjs` : motifs synthétiques et sinus, aucune image ni voix de personne).
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués proprement, cibles ≥ 44 px, aucun défilement horizontal à
> 390 px, rien ne reste sur le serveur après retrait ou erreur.

## Must-pass

### F.1 — [WEB] Choisir sa vidéo, la boucle est dite en clair
**Priorité** : critique · **Action** : « Ma vidéo… » → vidéo de 3 s sous une récitation de 8 s.
**Attendu** : progression visible, puis « Vidéo plus courte que la récitation : elle recommence toute seule, environ 2,5 fois. » ; deux
raccords ⟲ sur la bande ; quatre comportements, « Recommencer » choisi ; la valeur du parent porte l'identifiant du serveur.

### F.2 — [WEB] Les quatre comportements, chacun dit
**Action** : choisir Aller-retour, S'arrêter sur la dernière image, Ralentir, Recommencer (souris, puis flèches au clavier).
**Attendu** : la phrase change à chaque choix (« elle va et vient », « s'arrête sur sa dernière image après 3 s », « ralentie … à 38 % »),
un seul choix coché, schéma propre à chacun.

### F.3 — [WEB] Vidéo plus longue : l'éditeur de portion
**Action** : vidéo de 20 s sous 8 s : boutons ± 0,1 s et ± 1 s, flèches (Maj = 1 s), Page, Début, Fin, « début · milieu · fin », glisser la
fenêtre, toucher la piste.
**Attendu** : « on garde la portion de X s à Y s » ; début et fin écrits ; curseur accessible (valeur, texte, bornes) ; le départ est dans le
JSON de l'API ; annonce vocale des changements par boutons.

### F.4 — [WEB] Même durée
**Attendu** : « rien à régler », aucun réglage proposé.

### F.5 — [WEB] Formats que le navigateur ne lit pas, ou autres
**Action** : HEVC (téléphone), WebM VP9, vertical.
**Attendu** : prête, durée juste, aperçu lisible (copie du serveur quand l'original n'est pas lu).

### F.6 — [BE] VRAI export : une seule piste son = la récitation
**Action** : export complet par le serveur avec une vidéo de fond qui porte un sinus à 880 Hz.
**Attendu** : ffprobe : une piste image, une piste son ; niveau à 880 Hz identique à celui d'un export sans son de fond (−38,7 dB, contre
−18,1 dB pour un vrai 880 Hz) ; niveau à 440 Hz = la récitation.

### F.7 — [BE] VRAI export : la vidéo est bien lue, aux bons instants
**Attendu** : boucle de 3 s : l'image de sortie à 3,3 s et 6,3 s est celle de la source à 0,3 s (distance 1 contre 67) ; portion : la
sortie à 0,3 s est la source à 4,3 s ; figé : après 3 s l'image ne bouge plus.

### F.8 — [WEB] Très longue vidéo (5 min, 1080p, 224 Mo)
**Attendu** : lecture des faits en moins d'une seconde, 12 vignettes sans bloquer l'écran, tas JavaScript < 15 Mo, préparation
annoncée en pourcentage ; mesures dans `decision-log.md`.

### F.9 — [WEB] Coupure de réseau puis reprise
**Attendu** : après les essais, message en clair avec « Reprendre l'envoi » ; l'envoi reste sur le serveur ; la reprise n'envoie que
les morceaux manquants (54 distincts, aucun doublon).

### F.10 — [WEB] Annuler, retirer
**Attendu** : annuler pendant l'envoi → retour au choix, rien sur le serveur ; « Retirer » → valeur vide, vidéo supprimée du serveur (404).

## Must-fail (doivent être bloqués proprement, en français clair)

| # | Cas | Attendu |
|---|---|---|
| X.1 | son seul dans un MP4 | « ne contient pas d'image » |
| X.2 | MP4 tronqué (sans index) | « illisible ou abîmée », rien ne reste sur le serveur |
| X.3 | page web nommée `.mp4` ; PNG nommé `.mp4` | « format … pas accepté » (contenu réel, pas l'extension) |
| X.4 | 520 Mo | « trop lourd (520 Mo) : le maximum est 500 Mo », aucun octet envoyé |
| X.5 | 11 min | « trop longue (11 min) : le maximum est 10 min », aucun octet envoyé |
| X.6 | autre compte : état et fichier d'une vidéo d'autrui | 404 / 404 (même administrateur) |
| X.7 | autre session du même compte | 404 |
| X.8 | image de fond ET vidéo de fond dans un export | 400 expliqué |
| X.9 | identifiant piégé (`../..`) | 404, aucun accès disque |
| X.10 | images de 20 000 px | refusées avant préparation |

## Preuves
- Tests : `web/lib/background-video-*.test.ts`, `chunk-staging.test.ts`, `export-video-job-clip.test.ts`, routes
  `background-videos.test.ts` et `jobs/background-video.test.ts`, vue `background-video-view.test.tsx`, balayage IDOR
  (`app/api/idor.test.ts`, routes découvertes sur le disque).
- Banc navigateur : `harness/proof-fv-ui.mjs` (98 vérifications, 390 px tactile et 1280 px), `proof-fv-export.mjs` (16, vrais
  exports), `proof-fv-long.mjs` (5 min ; coupure et reprise). Captures et rapports : `harness/shots-fond-video/`.
