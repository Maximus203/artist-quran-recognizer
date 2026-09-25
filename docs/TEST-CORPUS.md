# Corpus de test audio — protocole

Les audios ne sont **pas** versionnés (poids, droits). Seul le manifeste
`tests/fixtures/audio/manifest.yaml` l'est : il porte la vérité terrain.
Les fichiers vivent dans `tests/fixtures/audio/files/` (gitignoré) ou sur un
stockage partagé (chemin via `AQR_AUDIO_DIR`).

## Catégories (chaque catégorie = un risque ciblé)

| Code | Catégorie | Risque testé | Exemple de contenu |
|---|---|---|---|
| C01 | Murattal propre, continu | base : rappel + frontières | Al-Mulk 1–10, récitateur studio |
| C02 | Début ≠ verset 1, fin en milieu de sourate | pas d'hypothèse « commence au début » | Al-Baqara 255–260 |
| C03 | Saut de sourate en cours de récitation | transition arbitraire | Al-Fatiha → Al-Ikhlas |
| C04 | Verset non reconnu au milieu | `INFERRED` | 4 net, 5 bruité/coupé, 6 net |
| C05 | Répétitions / reprises (i'ada) | pas de doublons fantômes | reprise de la 2ᵉ moitié d'un verset |
| C06 | Arrêt en milieu de verset (waqf) | plages de mots partielles | — |
| C07 | Versets répétés dans le Mushaf | désambiguïsation par contexte | Ar-Rahman 13–25 |
| C08 | **Prière** : takbir, isti'adha, amin, Fatiha + sourate | étiquettes non-verset | enregistrement de salat |
| C09 | **Assise en français** avec récitations intercalées | `NON_QURAN` français, **0 faux positif** | cours avec citations |
| C10 | **Arabe non coranique** : hadiths, dou'a, khutba | piège n°1 : 0 faux positif | lecture d'Al-Arba'un An-Nawawiyya |
| C11 | Hadith contenant une citation coranique | seule la citation est détectée | — |
| C12 | Conditions dégradées | robustesse | mosquée (réverbération), téléphone, foule, vidéo compressée |
| C13 | Voix non professionnelles | robustesse | enfant, récitation lente d'apprenant |
| C14 | Mujawwad (très lent, très orné) | robustesse du style | — |
| C15 | Warsh (V1.1) | riwaya | — |

## Format de vérité terrain

```yaml
- id: C04-mulk-gap-01
  file: C04/mulk_4-6_gap.wav
  riwaya: hafs
  source: "enregistrement personnel"
  license: "usage interne test"
  expected:
    - {t: [0.00, 6.10], ref: "67:4", words: all, status: RECOGNIZED}
    - {t: [6.10, 11.40], ref: "67:5", words: all, status: INFERRED}   # volontairement brouillé
    - {t: [11.40, 17.80], ref: "67:6", words: all, status: RECOGNIZED}
  non_quran: []
  tolerance_ms: 300
```

## Fabrication des audios « mélangés »

Pour C09–C11, deux sources :
1. **Enregistrements réels** (assises, cours, prières) — les plus précieux, annotés à la main.
2. **Montages synthétiques** reproductibles, via `scripts/make_mix.py` (à écrire en TDD) :
   concaténation de segments EveryAyah (versets connus) + segments de parole
   française/arabe non coranique, avec la vérité terrain **générée automatiquement**
   à partir des durées. Permet d'en produire des centaines.

Règle : chaque nouveau bug trouvé sur un vrai audio → un nouveau cas dans le manifeste
**avant** la correction (test rouge, puis vert).
