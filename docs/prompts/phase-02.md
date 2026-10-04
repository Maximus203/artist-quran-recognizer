# Phase 2 — Robustesse de la recherche (à coller dans Claude Code)

Lis `docs/PLAN.md`, `docs/adr/0003-recherche-lexicale-contrainte-pas-de-base-vectorielle.md`,
`docs/DATA-COLLECTION.md` et `.artist/decision-log.md`.

0. **Hygiène** : commite sur une branche `chore/docs-plan` les fichiers ajoutés dans
   `docs/` hors session (PLAN, DATA-COLLECTION, ADR-0003, prompts/). Ajoute un
   `.gitattributes` (`* text=auto eol=lf`) et renormalise (`git add --renormalize .`) :
   aujourd'hui 22 fichiers apparaissent modifiés uniquement à cause des fins de ligne CRLF.
1. **Constat à corriger** : `NgramVerseMatcher` indexe des trigrammes de mots exacts sur
   la tokenisation Uthmani normalisée. Or un ASR produit de l'orthographe imla'i
   (ex. Uthmani « ٱلْكِتَٰبُ » → normalisé « الكتب » ≠ ASR « الكتاب » ; « ٱلصَّلَوٰةَ » vs
   « الصلاة » ; « يَـٰٓأَيُّهَا » vs « يا أيها ») et des erreurs d'une lettre : un seul écart
   détruit trois trigrammes. Les tests actuels passent parce que les requêtes viennent
   du corpus lui-même. Mesure faite le 2026-09-25 sur le corpus épinglé : **3985 versets
   sur 6236 (64 %) contiennent au moins un mot dont la forme imla'i normalisée est absente
   de l'index Uthmani (≈ 10 % des mots)**. C'est la priorité n°1 avant tout audio.
2. **Écris d'abord les tests rouges** : requêtes construites depuis `quran-simple-clean.txt`
   (orthographe imla'i) et variantes bruitées (substitution/suppression d'une lettre,
   mot manquant, mot en trop) → le bon verset doit rester top-1. Ajoute un petit banc
   de robustesse (`scripts/bench_matcher.py`) qui mesure le top-1 sur ~2000 requêtes
   générées aléatoirement (graine fixe).
3. **Implémente ADR-0003** : squelette orthographique (règles de normalisation étendues,
   p. ex. alef suscrit → alef, gestion du waw/ya de support), index de n-grammes de
   **caractères** sur ce squelette (premier niveau, tolérant), trigrammes de mots en
   second niveau, réalignement fin conservé. Mappe les positions vers les `WordSpan`
   Uthmani (I1 intact). Si l'alignement Uthmani ↔ simple-clean mot à mot est utile
   (363 versets à tokenisation différente), construis-le une fois, testé.
4. **Basmala** : le verset 1 de chaque sourate (sauf 9) inclut la basmala dans Tanzil ;
   traite-la explicitement (étiquette `BASMALA` hors 1:1) et teste-le.
5. Cibles : top-1 ≥ 99 % sur requêtes exactes imla'i, ≥ 95 % avec 1 erreur / 5 mots,
   < 50 ms par requête. Rapporte les chiffres réels.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.

**Signature** : aucune mention de Claude/IA dans les commits et PR (ni `Co-Authored-By`, ni `Claude-Session`, ni « Generated with »), cf. AGENTS.md § Signature.
