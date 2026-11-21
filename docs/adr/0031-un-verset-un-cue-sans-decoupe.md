# ADR-0031 — Un verset = une carte, entière : plus aucune coupe dans l'export

- Statut : **accepté** — décision du mainteneur, 2026-11-21, après mesure sur des exports réels. **Remplace l'ADR-0029** et **amende
  l'ADR-0025** (la coupe d'un verset aux pauses et au plafond de durée). Respecte I1 (l'arabe vient du corpus), I2 (la traduction est
  restituée sans modification) et I3 (une coupe fausse est pire que pas de coupe).

## Contexte

L'ADR-0025 coupait un long verset en plusieurs cartes (vidéo) ou sous-titres (SRT, WebVTT, ASS) aux pauses du récitant et au plafond
`max_s`. L'ADR-0029 l'a rendue plus prudente : pause d'au moins 0,9 s, carte d'au moins 2 s, coupe seulement à la fin d'une tranche
exacte de QuranEnc. Mesuré en réel par le mainteneur le 2026-11-21 : le découpage des versets reste défaillant. La précision prime sur le rappel (I3) : on revient au système le plus sûr.

## Décision

1. **Aucun découpage d'un verset par défaut.** Un verset en cours est affiché **entier** (arabe complet) avec sa traduction **entière**
   pendant tout son intervalle. Vidéo (TypeScript) : une carte par verset. Sous-titres (Python) : un cue par verset.
2. **Le surlignage mot à mot est conservé** : la carte entière montre les mots récités un à un (karaoké, temps mesurés), comme avant.
3. **Réglages.**
   - Vidéo : `DEFAULT_SPLIT.enabled` vaut `false` (`web/lib/export-video-split.ts`). `splitVerse` rend une seule carte sans passer par
     la coupe.
   - Sous-titres : `ExportOptions.pause_split` vaut `False` par défaut ; **le plafond `max_s` ne coupe plus un verset** tant que
     `pause_split` est faux (avant, le plafond coupait même sans pauses). `max_s` reste utilisé pour les autres entrées (formules).
   - Le code de coupe (`pause_after`, `_chunks` / `chunkRanges`, `align_to_segments`, etc.) est **gardé, derrière cette option désactivée par
     défaut**, avec ses tests : il ne s'exécute que sur demande explicite (`pause_split: true` côté API/CLI, `enabled: true` côté vidéo).
     Il n'est pas supprimé : les cas partagés (`tests/fixtures/export-pauses/cases.json`) continuent de décrire la règle si on la
     rallume un jour, après calibration sur des récitations annotées.
4. **Compatibilité avec les réglages mémorisés (ADR-0028 et réglages d'export du compte).** Aucun réglage enregistré ne peut rallumer
   la coupe : `pause_split` et `pause_s` n'étaient déjà pas mémorisés sur le compte, et une ancienne ligne qui les porterait encore est
   lue **sans ces deux clés** (`storedExportOptionsSchema` les écarte avant validation, `fromStoredExportOptions` aussi) ; les autres
   réglages de la ligne survivent. Cas couvert par un test (`web/lib/export-options-stored.test.ts`).
5. **Mise en page d'un verset long (2:282 : 24 mots arabes, longue traduction).** Pas de nouvelle mécanique : la mise en page par
   blocs de l'ADR-0018 réduit chaque bloc jusqu'à tenir dans sa boîte (plancher 40 %), sans cacher la vidéo (la boîte du bloc est
   inchangée). Vérifié sur un rendu réel en 16:9 et 9:16 (voir les notes de version).

## Conséquences

- Un verset long reste affiché longtemps ; sa lisibilité repose sur la réduction du texte dans le plancher de l'ADR-0018 et sur le
  surlignage mot à mot.
- `approximate` et `part` restent dans les types, toujours absents par défaut.
- Retour arrière : activer l'option (aucune migration de données).
- Remplace l'ADR-0029 ; l'ADR-0025 reste valable pour ce qu'elle décrit de la détection des pauses, mais n'est plus appliquée par défaut.
