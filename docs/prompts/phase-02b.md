# Phase 2b — Recherche sur le flux continu (à coller dans Claude Code)

Revue externe de la phase 2 (2026-09-25), faite sur `develop` @ 2b624ba avec le corpus réel.
Le travail de la phase 2 est bon (dictionnaire imla'i appris, index de caractères, 123 tests
verts), mais **le banc ne teste que des versets entiers**. Or un segment audio réel, découpé
aux pauses, est souvent **une partie de verset** (waqf), **plusieurs versets d'un souffle**
(ex. 112:1-2), ou **un verset 1 sans la basmala** que Tanzil y concatène.

## Constats mesurés (fenêtres tirées du texte simple-clean, graine 7)

| Requête | Top-1 parmi les versets réellement récités | Score ≥ 0,75 (seuil du décodeur) | **Faux verset avec score ≥ 0,75** |
|---|---|---|---|
| Fenêtre de 3–6 mots | 65,8 % | 6,8 % | **10 / 600** |
| Fenêtre de 7–12 mots | 87,0 % | 21,0 % | **5 / 600** |
| Fenêtre de 13–25 mots (traverse des versets) | 98,0 % | 29,3 % | 0 / 600 |
| Verset 1 récité sans basmala | 71,7 % | 27,4 % | **4 / 113** |

Exemples concrets :
- « الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم » (début de 2:255) → top-1 **3:2**
  à 0,74 ; 2:255 absent du top-3. Faux verset à un cheveu du seuil : viole I3.
- « تبارك الذي بيده الملك وهو على كل شي قدير » (67:1) → 0,73 : pénalisé par les 4 mots de
  basmala concaténés au verset 1 dans Tanzil.
- « قل هو الله أحد الله الصمد » (112:1-2 d'un souffle) → deux candidats séparés à 0,57 / 0,50.

Cause : le score est `difflib.ratio` entre la requête et **le verset entier**. Une requête
partielle ou à cheval sur deux versets est structurellement mal notée.

Bon point à conserver : l'arabe non coranique reste bas (hadiths, adhkar, tashahhud,
khutba : ≤ 0,41), à deux exceptions attendues : l'isti'adha (16:98 à 0,62 → étiquette
`ISTIADHA`) et « ربنا اغفر لنا ذنوبنا », réellement coranique (3:147).

## À faire, en TDD

0. Commite `docs/prompts/phase-02b.md` et la mise à jour de `docs/prompts/phase-03.md`.
1. **Tests rouges d'abord**, avec les exemples ci-dessus et un banc
   `scripts/bench_segments.py` (graine fixe) : fenêtres de 3–6, 7–12 et 13–25 mots tirées
   du **flux continu** imla'i (basmala retirée des versets 1 sauf 1:1), plus « verset 1 sans
   basmala ». Métrique principale : **nombre de faux versets au-dessus du seuil du
   décodeur** (doit être 0 pour les fenêtres ≥ 7 mots). Métriques secondaires : top-1 et
   couverture des mots.
2. **Recherche sur le flux continu** : indexer le Coran comme **un seul flux de mots**
   (position globale → (verset, mot)), basmala des versets 1 traitée comme une unité à part
   (sauf 1:1). La requête est alignée **localement** sur une fenêtre du flux, pas sur un
   verset entier. Le résultat devient une **séquence de `WordSpan`** qui peut traverser
   plusieurs versets. Adapte `Candidate` (ou ajoute un type dédié) et `ports.py` en
   conséquence, sans casser I1.
3. **Nouveau score** : combiner la couverture de la requête (part des mots de la requête
   expliqués) et la qualité d'alignement local. Ne pas pénaliser les parties du verset non
   récitées. Aucun seuil en dur.
4. **Ambiguïté** : quand plusieurs positions du flux expliquent la requête aussi bien
   (formules répétées, fenêtres courtes), renvoyer toutes ces positions avec des scores
   proches, pour que le décodeur B7 tranche par le contexte ou produise `UNCERTAIN`.
   Ajoute un test : « الله لا إله إلا هو الحي القيوم » seul → 2:255 et 3:2 tous deux candidats.
5. Adapter B7 à des candidats multi-versets, et rejouer tous ses tests (P5–P9, F5).
6. Cibles : 0 faux verset ≥ seuil sur les fenêtres ≥ 7 mots ; top-1 ≥ 97 % sur 7–12 mots ;
   ≥ 95 % sur « verset 1 sans basmala » ; bancs de la phase 2 non dégradés ; < 50 ms.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (ajoute la ligne « 2b » et son statut). Termine par un compte rendu : SHA,
sorties réelles des commandes, métriques, décisions, ce qui reste à trancher par Cherif.
