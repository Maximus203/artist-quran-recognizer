# Export vidéo — noyau de la mise en page par blocs (phase 1)
> Surfaces : [WEB] (mobile 390 px d'abord, puis 1280 px) · [BE] (préférences, API) · [CALC] (fonctions pures)
> Statut : ✅ (voir « Preuves ») · Build : develop + `feat/export-noyau-mise-en-page` @ fd793d1 · ADR-0018
> Périmètre : modèle `ExportLayout` / `TextStyle` / fond vidéo, `layoutCard`, `drawFrame`, fond flouté, préférences et migration,
> API (`layouts`, `styles`, `show_ref`), écran d'export actuel adapté au minimum. Aucun éditeur à l'écran (phases 2 à 4).
> Environnement : atelier construit dans un worktree jetable, base de test jetable (`harness/h.mjs`), comptes `admin_test` et `recitant_test`.
> Données : sessions de test (sinus de 8 s + résultat minimal, sourate 112), jamais d'audio de personne.
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués, console propre, aucun défilement horizontal à 390 px.

## Must-pass

### N.1 — [CALC] Chaque bloc est dans SA boîte, jamais coupé
**Priorité** : critique · **Technique** : partition-équivalence (3 formats × verset court / long)
**Action** : `layoutCard` sur les trois formats avec un verset court, un long et une traduction longue.
**Attendu** : le texte de chaque bloc reste dans sa boîte ; référence, arabe, traduction dans l'ordre ; rien sur l'onde ; les mots de l'arabe et de la traduction sont intacts (I1, I2) ; un bloc trop long est réduit seul et le dit (« réduit à 87 % »).
**Preuve** : `export-video-layout.test.ts`.

### N.2 — [WEB] Le défaut garde la capacité de l'ancien rendu
**Priorité** : critique · **Technique** : nominal (comparaison avant/après)
**Action** : rendre Al-Baqara 2:255 et Al-Fatiha 1:1 en paysage, portrait, carré avec les anciens réglages par défaut convertis.
**Attendu** : mêmes nombres de lignes (1 / 7 / 4 / 1 d'arabe), tailles à 100 %, aucune réduction annoncée.
**Preuve** : `decision-log.md` 2026-11-03 ; images de contrôle du banc.

### N.3 — [BE] Les anciens réglages sont convertis à l'identique
**Priorité** : critique · **Technique** : table-décision (champs × valeurs)
**Action** : écrire par l'API des réglages à plat (tailles 120/52, place 88, remplir, onde masquée, accent, marges, photo) puis les relire.
**Attendu** : au nouveau format, tailles 1,667 / 1,733, pile à 88 % de la zone élargie (onde masquée), remplir pour l'arabe et la traduction, voile transparent (photo), tout le reste gardé.
**Preuve** : `export-video-prefs.test.ts`, `preferences.test.ts`, `prefs-sync.test.ts` ; `proof-noyau.mjs` (vrai serveur).

### N.4 — [WEB] Tailles par − / +, place du texte, remplir (écran actuel)
**Priorité** : critique · **Technique** : transition-état
**Action** : sur `/s/<id>/exporter`, onglet Vidéo, « À quoi elle ressemble » : « + » ×2, « − », pourcentage, « Bas », « Remplir ».
**Attendu** : 100 % → 112 % → 106 % → 100 % ; l'aperçu change à chaque geste ; cibles ≥ 44 px au tactile ; plus de « Petit / Moyen / Grand ».
**Preuve** : `proof-noyau.mjs`.

### N.5 — [CALC] Fonds de texte
**Priorité** : critique · **Technique** : partition-équivalence (aucun, transparent, flou, plein)
**Attendu** : « aucun » ne dessine aucun fond (ombre ou contour avant le texte) ; « transparent » cumule l'opacité demandée ; « plein » est opaque quelle que soit l'opacité ; « flou » lit le décor (jamais le canevas en cours), mémorise sur décor fixe, refait sur vidéo, retombe sur une teinte sans décor.
**Preuve** : `export-video-panels.test.ts`, `export-video-frames.test.ts` ; images `out-blur`, `out-solid`, `out-outline`.

### N.6 — [CALC] Fond vidéo
**Priorité** : critique · **Technique** : valeurs-limites (durée 0, inconnue, audio < 1 s)
**Attendu** : `vtime` borné à la vidéo, boucle / aller-retour / figé / ralenti / portion, départ unique borné par plage, durées 0 ou inconnues sans plantage ; le MP4 ne reprend que le son de la récitation.
**Preuve** : `export-video-vtime.test.ts`, `export-video-args.test.ts`, `export-video-assets.test.ts`.

### N.7 — [WEB][BE] Un export lancé par l'écran est rendu avec le nouveau moteur
**Priorité** : critique · **Technique** : nominal
**Action** : « Exporter » (qualité légère) ; attendre la fin ; télécharger le MP4.
**Attendu** : MP4 H.264 + AAC non vide ; image extraite lisible.
**Preuve** : `proof-noyau.mjs` (export réel, image à 3 s).

## Must-fail (doivent être refusés ou retomber proprement)

- **F.1** Réglages corrompus (taille « énorme », orientation 4:3, booléens en texte, `null`, tableau) : jamais d'échec, défauts (`export-video-prefs.test.ts`).
- **F.2** Objet au nouveau format avec une boîte hors cadre, un fond « verre », une taille 9, un ancien champ mêlé : refusé à l'écriture ; à la lecture seule la valeur abîmée revient à son défaut (`preferences.test.ts`).
- **F.3** API : `layouts` incomplet ou hors cadre, `styles` avec taille 99, `show_ref` en texte : refusés (`export-video-request.test.ts`).
- **F.4** Boîte hors cadre, minuscule ou de valeurs NaN : ramenée dans le cadre, taille minimale respectée (`export-video-edit.test.ts`, `export-video-layout.test.ts`).
- **F.5** Vidéo de fond illisible, sans image, sans durée finie ou qui ne répond pas : refusée, fichier libéré, message clair (`export-video-assets.test.ts`).
- **F.6** Fond flou sans canevas de travail : teinte, pas de plantage (`export-video-panels.test.ts`).

## Limites connues (dites, pas cachées)
- Le fichier d'une vidéo de fond n'est pas envoyé au serveur : `apiDifferences` le signale ; une phase d'interface qui propose « Ma vidéo » doit d'abord régler cet envoi.
- Non mesurés : encodage H.264, téléphone réel, vidéo réellement décodée, GPU matériel.
- Pas de test avec un lecteur d'écran (aucune interface nouvelle ici).
