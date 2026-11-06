# ADR-0027 — Parole libre : un modèle de transcription et de traduction pour l'arabe hors Coran

- Statut : **accepté** — demande du mainteneur du 2026-11-06. Précise l'ADR-0001 (pas de LLM génératif) sans l'abroger ;
  respecte I1, I2, I3, I4.

## Contexte

Le moteur localise les versets et rend leur texte et leur traduction depuis le corpus. Le reste (hadith, dou'a, cours,
arabe courant) est étiqueté `NON_QURAN` / `arabic_speech` et n'apparaissait nulle part. Le mainteneur veut le transcrire et le
traduire en français, **sans jamais** appliquer un modèle de traduction à du Coran : un passage coranique dont le moteur doute
reste tel quel, ni nommé ni traduit.

## Décision

1. **Périmètre.** Seule une zone `non_quran` d'étiquette `arabic_speech` est éligible. Basmala, isti'adha, takbir, âmîn
   gardent leur texte fixe (ADR de la vidéo, PR #221) ; français, autres langues, silence, bruit n'ont rien à traduire ;
   abstentions et versets `uncertain` ne sont ni transcrits ni traduits.
2. **Deux modèles, jamais ailleurs.** Un transcripteur arabe (Whisper large-v3 via faster-whisper, langue détectée) puis un
   traducteur dédié arabe → français (Marian `opus-mt-ar-fr`, recherche par faisceau déterministe, ni consigne ni contexte).
   Ce ne sont pas des modèles de conversation : l'ADR-0001 reste vrai pour tout le texte coranique.
3. **Garde-fous successifs, le plus sévère l'emporte.** Durée minimale, silence numérique, langue arabe annoncée avec
   probabilité suffisante, part de lettres arabes, nombre de mots, confiance, boucle d'hallucination, **ressemblance au Coran**
   (reconnaisseur de versets du moteur + suites de mots exactes du corpus), formule connue, longueur plausible de la traduction.
   Dans le doute le passage est **retenu**.
4. **Un passage retenu ne porte aucun texte**, seulement sa raison : il pourrait être coranique (I3). Le fichier est refusé
   à la lecture sinon.
5. **Fichier séparé** `aqr.free-speech/1` (`<nom>.free-speech.json`), jamais mêlé à `aqr.recognition/1`, qui reste du texte relu contre
   le corpus. Chaque passage traduit est `review: pending`, avec la notice « automatique, hors Coran, à vérifier ».
6. **Désactivé par défaut à l'export** (vidéo, sous-titres) tant que l'option n'est pas cochée ; l'écran de lecture l'affiche
   toujours étiqueté, jamais dans la police du Mushaf.
7. **Seuils** : configuration (`FreeSpeechConfig`), calibrée par `scripts/bench_free_speech.py`. Critère n°1 : zéro verset
   reconnu qui ressorte traduit quand on le présente au module comme de la parole libre.

## Limites assumées

- Pas de corpus de hadiths ni de dou'a connus : leur traduction reste celle du modèle, à relire.
- Le garde-fou ne détecte pas un verset très altéré par l'ASR au point de ne plus ressembler au corpus.
- Dialectes (hassaniya, égyptien…) : la transcription peut être faible ; la confiance retient alors le passage.
- Aucune mesure de qualité de traduction avant le banc réel sur audios locaux.
