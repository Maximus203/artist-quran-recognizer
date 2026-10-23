# Export des sous-titres, écrans : contrôle, correction à l'oreille, forcer, téléchargement
> Surfaces : [mobile 375 px] · [desktop 1280 px] · Statut : ✅ (10 scénarios) · Build : feat/export-atelier-ui · Testé : 2026-10-23
> Périmètre : `/s/<id>/exporter`, `/s/<id>/exporter/corriger?item=<clé>`, bouton « Exporter » et touche E de l'en-tête de session.
> Environnement : `next build` puis `next start` sur 127.0.0.1:3590 (jamais `next dev`), dossier de données de TEST (copie en lecture seule de sessions réelles, jamais les données du mainteneur), compte local « Amina Test » (propriétaire). Navigateur du volet intégré de l'outil, taille émulée 375×812 puis 1280×860.
> Données : session « incertains » (23 min 26 s ; 2 passages incertains, 2 coupures, 7 traductions approximatives ; 6 passages non coraniques).
> Critère d'arrêt : tous les scénarios critiques ✅, les deux refus (must-fail) bloqués, aucune erreur dans la console du navigateur ni dans le journal du serveur (observé : 0 ligne d'erreur au serveur ; la console ne montre que les 6 réponses 404 voulues du scénario U.10, session inconnue).
> Limite connue du volet de test : il ne dessine que quelques images par seconde et ses captures arrivent parfois en retard ; l'état a donc été relu dans la page (DOM, API `decisions`, fichier téléchargé), pas seulement sur capture.

## Préconditions
- [mobile 375 px] Build de production présent, serveur lancé avec `AQR_REVIEW_DIR` de test et `AQR_PYTHON`.
- [desktop 1280 px] Compte connecté propriétaire de la session ; aucune décision enregistrée au départ.

## Scénarios

### U.1 — [mobile 375 px] La page d'export tient dans l'écran et se pilote au pouce
**Priorité** : critique
**Technique** : valeurs-limites (375 px)
**Action** : Ouvrir `/s/<id>/exporter` à 375×812 ; lire largeur de page et taille des cibles ; ouvrir « 2 · Réglages » puis revenir à « 1 · Vérifier ».
**Attendu** : Pas de défilement horizontal ; deux onglets ; barre fixe « Forcer l'export » + « Corriger (n) » ; cibles ≥ 44 px (hors liens dans une phrase) ; le verdict dit combien de passages restent et combien touchent l'arabe.
**Observé** : largeur de page 375 = fenêtre ; barre fixe visible ; « 10 passages à vérifier, 3 touchent l'arabe, 7 concernent la traduction » (une décision déjà prise) ; seules cibles < 44 px : le logo de l'en-tête (existant) et des liens « Voir la liste » / « Annuler » insérés dans une phrase
**Verdict** : ✅
**Issue** : —

### U.2 — [desktop 1280 px] Deux colonnes, thème clair et sombre, aperçu en direct
**Priorité** : important
**Technique** : parcours nominal
**Action** : Ouvrir la page à 1280 px ; basculer le thème ; lire l'aperçu.
**Attendu** : Contrôle à gauche, réglages et aperçu à droite (colonne qui reste visible) ; couleurs lisibles dans les deux thèmes ; l'aperçu montre l'arabe du corpus, la traduction, et « Omis dans cet export · … Le corriger » pour un passage incertain.
**Observé** : deux colonnes ; thème clair (fond `rgb(244,240,230)`) lisible ; aperçu avec les trois premiers sous-titres et la ligne « Omis dans cet export » + lien « Le corriger »
**Verdict** : ✅
**Issue** : —

### U.3 — [mobile 375 px] « Écouté » n'apparaît qu'après avoir réellement écouté la plage
**Priorité** : critique
**Technique** : transition d'état
**Action** : Ouvrir un passage incertain (2,2 s → 9,5 s) ; lire la mention ; lancer « Écouter le passage » ; relire chaque seconde pendant 9 s.
**Attendu** : « Pas encore écouté » au départ et pendant la première moitié ; « Écouté · cette décision vaut vérité terrain » une fois environ 70 % de la plage entendus (≈ 5 s sur 7,3 s) ; pas avant.
**Observé** : « Pas encore écouté » à 3,2 s, 4,2 s, 5,2 s, 6,2 s, 7,2 s ; « Écouté » à 8,2 s (mesure faite par échantillon de 100 ms de la position de l'`<audio>`)
**Verdict** : ✅
**Issue** : — (le premier essai échouait : la mesure suivait les images dessinées, que le volet masqué ne produit pas ; corrigé avant ce test)

### U.4 — [mobile 375 px] Choisir un candidat, valider, passer au suivant ; la décision est enregistrée
**Priorité** : critique
**Technique** : parcours nominal
**Action** : Écouter, choisir « C'est 1:2 », « Valider et suivant » ; relire `GET …/decisions`.
**Attendu** : « Passage 1 sur 10 restants » (au lieu de 11) ; la décision porte la référence 1:2 mots 2–4, `evidence.listened: true`, `device: mobile`, `use_for_training: true`, auteur « Amina Test ».
**Observé** : écran suivant « 1 sur 10 restants » ; décision `choose` 1:2 [2,4], listened true, listened_s 7.3, device mobile, use_for_training true
**Verdict** : ✅
**Issue** : —

### U.5 — [desktop 1280 px] Tout se fait au clavier : Espace, 2, Entrée, J, K, Échap
**Priorité** : important
**Technique** : table-décision
**Action** : Sur l'écran de correction : Espace (lecture), Espace (pause), 2 (candidat 2), Entrée (valider), J, K, Échap.
**Attendu** : La lecture démarre et s'arrête ; le candidat 2 est coché ; Entrée enregistre et passe au suivant ; J avance, K recule ; Échap revient à la liste.
**Observé** : lecture 5,98 s puis pause ; radio 2 cochée ; décision `choose` appliquée, « 1 sur 9 restants » ; J → 2:87 (2 sur 9), K → 1:5 (1 sur 9) ; Échap → `/exporter`
**Verdict** : ✅
**Issue** : —

### U.6 — [desktop 1280 px] Ignorer et annuler : rien de définitif
**Priorité** : critique
**Technique** : idempotence
**Action** : « Ignorer » sur un passage ; puis « Annuler » sur la décision d'un autre ; relire `decisions` et la progression.
**Attendu** : « ignore » appliquée, progression +1 ; « Annuler » → décision `withdrawn`, progression −1, rien d'effacé du fichier.
**Observé** : `choose:applied, ignore:applied` puis `choose:withdrawn, ignore:applied` ; « 2 sur 11 » → « 1 sur 11 »
**Verdict** : ✅
**Issue** : —

### U.7 — [mobile 375 px] Forcer l'export : règle explicite, fichier téléchargé fidèle, attribution à copier
**Priorité** : critique
**Technique** : parcours nominal + comparaison à la source
**Action** : « Forcer l'export », choisir « Les garder avec un marqueur », « Exporter quand même » ; intercepter le fichier de « Télécharger ».
**Attendu** : Boîte modale (focus piégé) avec les 3 règles, le tableau « ce que devient chaque passage », « Recommandé » sur *omettre* ; résultat « 0 passage omis, 1 décision humaine appliquée » ; le SRT contient les mots 2–4 de 1:2 pour la décision et `[incertain : 1:1 | 1:2 | 6:1 | 18:1]` pour le passage resté ambigu ; attribution Tanzil + QuranEnc affichée.
**Observé** : `alertdialog` aria-modal ; fichier `incertains.ar-fr.srt`, 204 sous-titres, 18 939 caractères, type `application/x-subrip; charset=utf-8` ; premier sous-titre « لِلَّهِ رَبِّ » + « Louange à Allah, Seigneur de l'Univers. » ; marqueur présent ; attribution affichée avec « Copier le texte »
**Verdict** : ✅
**Issue** : —

### U.8 — [desktop 1280 px] Une coupure se corrige en choisissant la plage de mots
**Priorité** : important
**Technique** : partition d'équivalence
**Action** : Ouvrir la coupure 12:21 (mots 13–23, début manquant) ; « Étendre à la plage de mots… ».
**Attendu** : Une grille des mots du verset (corpus), la plage actuelle surlignée, début et fin réglables, la décision « 12:21 · mots 13–23 » avec le texte du corpus.
**Observé** : grille de 32 mots, 13–23 surlignés ; carte « Ta décision : brouillon, 12:21 mots 13–23 » avec le texte arabe du corpus
**Verdict** : ✅
**Issue** : —

### U.9 — [desktop 1280 px] Raccourci E et entrée par l'en-tête de session
**Priorité** : normal
**Technique** : parcours nominal
**Action** : Ouvrir la session ; lire le bouton « Exporter » ; appuyer sur E.
**Attendu** : Le bouton affiche le nombre de passages à vérifier (« 9 à vérifier ») ; E ouvre la page d'export ; la touche est listée dans « Raccourcis clavier ».
**Observé** : bouton « Exporter · 9 à vérifier » ; E → `/s/<id>/exporter`
**Verdict** : ✅
**Issue** : —

### U.10 — [desktop 1280 px] Refus : session inconnue et clé de passage invalide
**Priorité** : important
**Technique** : erreur
**Action** : Ouvrir `/s/00000000-0000-4000-8000-000000000000/exporter` ; ouvrir `/exporter/corriger?item=zzz`.
**Attendu** : « Session introuvable » (aucun réglage, aucun bouton « Forcer », aucune barre fixe, même texte qu'un audio privé) ; une clé invalide ramène à la liste sans erreur.
**Observé** : carte « Session introuvable » seule, avec « Voir mes sessions » ; clé `zzz` → redirigé vers `/exporter` avec la liste
**Verdict** : ✅
**Issue** : — (le premier essai montrait les réglages et un bouton « Forcer l'export… » sous le message d'erreur ; corrigé avant ce test)

## Non testé (à ne pas déduire de ce playbook)
- L'écran vu par un testeur qui n'est pas propriétaire (message « Seul le propriétaire corrige », bouton « Corriger » absent) : le refus d'écriture est couvert par `export-sous-titres-api.md` (E.8), pas l'affichage.
- Les formats WebVTT, ASS et JSON depuis l'interface (testés côté moteur et API).
- Le mode hors connexion de l'écran de correction (message prévu, jamais déclenché).
- L'écran sur un vrai téléphone : l'émulation du volet de test n'est pas un appareil.
