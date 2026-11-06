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

## Addendum du 2026-11-06 — où se trouve la parole libre dans le résultat

Mesure sur les 85 sessions locales : le moteur n'émet **aucune** zone `arabic_speech` (seulement basmala, isti'adha, takbir,
âmîn) ; tout le reste est une abstention (`no_candidate` 7 905, `below_threshold` 6 386, `empty_transcript` 473). La parole arabe
hors Coran est donc une abstention `no_candidate` (aucun verset ne ressemble au passage). Règle d'éligibilité :
`arabic_speech` **ou** abstention `no_candidate`, jamais `below_threshold` (un verset ressemble, le moteur doute : c'est le cas
« coranique mais douteux » à laisser tel quel) ni `empty_transcript`. Les garde-fous de la décision 3 s'appliquent à ces
abstentions comme aux autres : une récitation que le moteur a ratée est retenue par la ressemblance au Coran.

## Mesure du 2026-11-06 sur un enregistrement local (session a732dea0, 1 130 s, 9 versets, 73 abstentions `no_candidate`)

- **Garde-fou** : 8 versets reconnus présentés comme parole libre, 8 retenus (`quran_like`), **0 fuite**.
- **Passages éligibles** : 66 traduits, 7 retenus (langue 3, trop court 3, traduction implausible 1).
- **Qualité** : la transcription (Whisper large-v3) est correcte ; la **traduction `opus-mt-ar-fr` est mauvaise sur l'arabe religieux
  ou littéraire**, avec une confiance de transcription élevée qui ne la reflète pas (« رواه البخاري » → « Le roman de la
  vapeur », « علو الهمة » → « Allonge le boulot »). Décision : le module reste **désactivé à l'export** et chaque passage `pending` ;
  **aucune mise en production avant un meilleur traducteur** (NLLB-200 3,3 B ou équivalent, à mesurer sur ces mêmes passages)
  et un contrôle de la traduction elle-même (aller-retour français → arabe, par exemple).

## Comparaison Marian / NLLB-200 (distilled 1.3B), mêmes 66 passages, 2026-11-06

NLLB-200 (option `--translator nllb`, poids CC-BY-NC-4.0) est meilleur par endroits (« فحمل أعباء الدعوة » : « Il a porté le fardeau de
l'invitation » contre « J'ai pris le fardeau de l'appel ») mais reste **faux avec aplomb** sur le vocabulaire religieux : « رواه البخاري »
donne « Je ne sais pas », « علو الهمة » donne « C'est tout à fait normal ». Une traduction fluette et fausse est plus trompeuse qu'une
traduction maladroite. **Aucun des deux n'est publiable.** Le module reste désactivé à l'export ; Marian reste le défaut (léger).
Pistes à mesurer avant toute production : glossaire des formules religieuses fixes (« رواه البخاري » → « Rapporté par Al-Boukhari »),
contrôle de la traduction par aller-retour, traducteur plus gros ou modèle de conversation cadré (à décider : cela touche l'ADR-0001),
relecture humaine obligatoire (déjà : `pending`).

## Glossaire et aller-retour, mesure du 2026-11-06 (mêmes 66 passages)

- **Glossaire** (`freespeech/glossary.py`) : formules religieuses fixes (références de hadith, bénédictions, « فقال عز من قائل »…),
  traduites à la main, sur le passage entier seulement, sans modèle ni contrôle. Il rattrape les cas les pires (« رواه البخاري » →
  « Rapporté par Al-Boukhari. ») mais couvre **2 passages sur 66** : une garantie sur le vocabulaire fixe, pas une réponse générale.
- **Aller-retour** (français → arabe par NLLB, ressemblance de l'arabe normalisé, `min_roundtrip` = 0,35) : **faible filtre**. Les
  traductions fausses (« C'est tout à fait normal », « خير زاد للسالكين » → « C'est encore mieux pour ceux qui partent ») tombent à
  0,17-0,34 et sont retenues (8 passages sur 64 hors glossaire), mais d'autres fausses (« des crêpes pour les sommets », « Qu'ils soient
  pleins d'espoir ») restent à 0,41-0,44, à côté de traductions correctes (« Il se lève avec détermination », 0,40). Pire : le Marian
  « Le roman de la vapeur » revient à 0,91 de « رواه البخاري », car NLLB retraduit le contresens vers le bon arabe. Le contrôle ne se
  substitue donc pas à la relecture humaine.
- **Conséquence** : aucun changement de décision. Module désactivé à l'export, passages `pending`, rien en production. Le contrôle n'est
  disponible qu'avec `--translator nllb` (le Marian ne traduit pas vers l'arabe).
