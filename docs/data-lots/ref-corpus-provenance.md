# Corpus de référence : provenance et conditions d'usage des sources

Date de relevé : 2026-10-09. Méthode : lecture des pages publiques (outil de lecture web) et de
l'API Hugging Face (`private`, `gated`, tags). Ce sont les termes **littéraux** trouvés ; la
lecture a pu être tronquée (voir « Limites »). **Règle : ce qui n'est pas clairement autorisé est
traité comme non autorisé.** Cela ne tranche pas le droit ; la décision d'usage appartient au
mainteneur (voir `docs/data-lots/RIGHTS.md` pour le précédent du lot 1).

## Constats par source

### everyayah.com
- Page d'accueil lue : **aucune licence, aucun terme d'usage, aucune mention de droits** sur les
  enregistrements. Pas de page « conditions » ; seuls liens : « Contact Us »
  (`https://quran.zendesk.com/hc/en-us`, centre d'aide), `recitations.js`, listes d'ayat et de
  pages.
- `recitations_ayat.html` (HTTP 200) : aucune occurrence de licence, copyright, permission, terms
  ou « free ».
- Conclusion : **droits non établis**. Le téléchargement par script
  (`scripts/fetch_everyayah.py`) est un accès technique, pas une autorisation.

### Hugging Face `Buraaq/quran-md-ayahs`
- API : `private: false`, `gated: false`, révision `669e9c4b78716d4558cebab98e1072564801fbb0`
  (modifiée le 2026-01-27), aucun tag `license:`.
- Front matter du README : pas de champ `license` (clés `configs`, `dataset_info`).
- Texte : citation du papier « Quran-MD: A Fine-Grained Multilingual Multimodal Dataset of the
  Quran » (arXiv 2601.17880). La page dit inclure « verse-level audio from 30 distinct reciters »
  mais **ne nomme pas l'origine des enregistrements**. Les noms de récitants (ex.
  `Saood_ash-Shuraym_64kbps`) ressemblent à des dossiers EveryAyah : c'est une observation, pas une
  déclaration de la source.
- Conclusion : **aucune licence déclarée, origine non documentée**.

### Hugging Face `tarteel-ai/everyayah`
- API : `private: false`, `gated: false`, révision `6ea510862d64f59e555a4a8363eebc0f415621df`
  (modifiée le 2026-09-17), aucun tag `license:`.
- Front matter : pas de champ `license`.
- Texte littéral : « Licensing of the individual recordings is not documented. Use at your own
  risk. » Le reste du jeu de données est déclaré sous CC BY 4.0. « This dataset was created by
  Tarteel. » Sections « Source Data » vides. Splits annoncés : train 187 785, validation 23 474,
  test 23 473 ; 234 732 lignes, 117 Go.
- Conclusion : **droits des enregistrements explicitement non documentés** ; la mention CC BY 4.0
  ne couvre pas les enregistrements eux-mêmes.

### Hugging Face `MohamedRashad/Quran-Recitations`
- API : `private: false`, `gated: false`, révision `65ee6114d526c02f7f96d696bb254a2dd666270c`
  (modifiée le 2025-03-30), aucun tag `license:`.
- Front matter : pas de champ `license`.
- Texte : « The dataset was collected using the AlQuran Cloud API » ; « The Quran is the sacred
  word of Allah, and this dataset should be used with the utmost respect. » Aucune licence ni
  terme. 124 689 lignes, 33,1 Go. Dix-sept récitants listés (noms arabes).
- Conclusion : **aucune licence déclarée**. L'API AlQuran Cloud a ses propres conditions, non
  lues ici.

### Hugging Face `RetaSy/quranic_audio_dataset`
- API : `private: false`, `gated: false`, révision `b1fcc39cbc045f367bb07e39025a0e3aaeabf34f`
  (modifiée le 2024-05-14), aucun tag `license:`.
- Front matter : pas de champ `license` (clés `dataset_info`, `configs`, `task_categories`,
  `language`, `tags`, `pretty_name`). Aucune section licence, consentement ou conditions.
- Texte : citation « Quranic Audio Dataset: Crowdsourced and Labeled Recitation from Non-Arabic
  Speakers » (arXiv 2405.02675). Environ 6 830 lignes. Voix de **personnes privées** (contributeurs
  de la foule, avec pays, âge, genre dans les métadonnées).
- Conclusion : **aucune licence déclarée, consentement non documenté**. Données de personnes :
  ne pas les copier, ne pas les rendre publiques.

## Limites de ce relevé
- Les pages des jeux Hugging Face ont été lues via un extracteur qui a parfois tronqué la fiche ;
  le README brut a été relu pour les quatre jeux. Un fichier `LICENSE` séparé dans un dépôt n'a pas
  été vérifié.
- Les conditions des projets amont (AlQuran Cloud, Tarteel, droits des récitants) n'ont pas été
  lues.
- Absence de licence ne veut pas dire domaine public.

## Conséquences pour le dépôt
1. **Rien n'est présumé autorisé.** Aucun audio de ces sources n'est versionné ni republié
   (AGENTS.md). Le manifeste du corpus de référence (`tests/fixtures/ref-corpus/manifest.yaml`)
   ne contient que des empreintes, des métadonnées et la mention de licence `non établie`.
2. Les audios construits localement vivent hors dépôt (`~/aqr-ref`, `AQR_AUDIO_DIR`) pour un usage
   interne d'évaluation uniquement ; ni dataset public, ni partage.
3. `RetaSy/quranic_audio_dataset` n'est pas utilisé pour constituer le corpus de référence tant que
   le consentement et la licence ne sont pas établis.
4. Toute utilisation au-delà de l'évaluation interne (publication, redistribution, entraînement)
   demande une décision explicite du mainteneur après clarification auprès des ayants droit.

## Biais d'évaluation : EveryAyah est probablement dans l'entraînement des modèles
Les modèles de reconnaissance de récitation courants (dont les dérivés Whisper « tarteel ») ont
vraisemblablement été entraînés ou affinés sur EveryAyah ou son équivalent Hugging Face
(`tarteel-ai/everyayah`, avec splits train/validation/test). C'est une déduction de contexte, non
vérifiée ici modèle par modèle ; elle suffit à imposer la prudence :

- Les scores obtenus sur des clips EveryAyah (verset par verset, mêmes récitants) sont un
  **plafond optimiste**, non une performance attendue en conditions réelles.
- Le jeu `test` du corpus de référence est disjoint par **récitant** de `dev`, mais n'est pas
  disjoint de l'entraînement des modèles : la disjonction protège le réglage de notre système, pas
  l'évaluation d'un modèle déjà vu.
- Pour une estimation de généralisation, il faut des enregistrements hors EveryAyah (lot 1, annoté
  à la main).
