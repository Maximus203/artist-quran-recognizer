# Export — un verset = une carte / un sous-titre, entier (ADR-0031)
> Surfaces : [WEB] (1280 px ; aperçu 16:9 et 9:16) · [API] · [BE] (moteur Python)
> Build : prod, worktree jetable, base jetable, Chrome de Playwright · Testé : 2026-11-21
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués proprement.

## Must-pass

### V.1 — [BE] Sous-titres : un cue par verset
**Action** : exporter un résultat avec 2:282 (128 mots, temps mesurés, pauses) et 2:283, options par défaut.
**Attendu** : 2 cues, arabe entier, traduction entière ; `max_s` (7 s) ne coupe pas.
**Verdict** : ✅ (pytest `test_par_defaut_*` ; écran : « SRT · 2 sous-titres »).

### V.2 — [WEB] Vidéo : verset entier avec traduction entière
**Action** : ouvrir l'éditeur vidéo (16:9 puis 9:16) sur 2:282 et lancer l'export MP4.
**Attendu** : à plusieurs instants, arabe complet + traduction complète + mot courant surligné ; rien ne déborde du cadre.
**Verdict** : voir le rapport de la PR (images ffmpeg du MP4).

### V.3 — [WEB] Cas partagé Python / TypeScript
**Action** : `pytest tests/unit/test_export_pauses.py` et `vitest lib/export-video-split.test.ts`.
**Attendu** : le cas « verset de 24 mots, par défaut un seul morceau » passe des deux côtés.
**Verdict** : ✅.

## Must-fail

### F.1 — Ancien réglage « coupe activée » mémorisé
**Action** : lire `{...défauts, pause_split: true, pause_s: 1.5}` avec `storedExportOptionsSchema` / `fromStoredExportOptions`.
**Attendu** : ligne acceptée, sans `pause_split` ni `pause_s` ; la coupe ne ressuscite pas.
**Verdict** : ✅ (`export-options-stored.test.ts`).

### F.2 — Coupe sans option explicite
**Action** : `splitVerse` et `build_cues` avec les défauts sur un verset long à pauses et tranches de traduction.
**Attendu** : jamais plus d'une carte / d'un cue.
**Verdict** : ✅.
