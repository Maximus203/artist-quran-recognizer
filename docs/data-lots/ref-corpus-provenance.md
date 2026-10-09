# Corpus de référence : provenance et conditions d'usage des sources

Date de relevé : 2026-10-09. Méthode : lecture des pages publiques (outil de lecture web) et de
l'API Hugging Face (`private`, `gated`, tags). Ce sont les termes **littéraux** trouvés ; la
lecture a pu être tronquée (voir « Limites »).

**Règle : ce qui n'est pas clairement autorisé est traité comme non autorisé**, à la seule exception
de la « Décision d'usage » ci-dessous (mainteneur, provisoire). Ce relevé ne tranche pas le droit, et
cette exception ne crée aucun droit. Le lot 1 n'est **pas un précédent** : ses décisions sont
ouvertes (voir `docs/data-lots/RIGHTS.md`).

## Constats par source

### everyayah.com
- Page d'accueil lue : **aucune licence, aucun terme d'usage, aucune mention de droits** sur les
  enregistrements. Pas de page « conditions » ; seuls liens : « Contact Us »
  (`https://quran.zendesk.com/hc/en-us`, centre d'aide), `recitations.js`, listes d'ayat et de
  pages.
- `recitations_ayat.html` (HTTP 200) : aucune occurrence de licence, copyright, permission, terms
  ou « free ».
- Conclusion : **droits non établis**. Le téléchargement par script
  (`scripts/fetch_everyayah.py`) est un accès technique, pas une autorisation ; ce que le script
  fait par défaut est décrit dans « Décision d'usage », section « Le téléchargement n'est pas une
  autorisation ».

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
2. Les audios construits localement vivent hors dépôt (`~/aqr-ref`, `AQR_AUDIO_DIR`), dans les
   seules limites de la « Décision d'usage » ci-dessous ; ni dataset public, ni partage.
3. `RetaSy/quranic_audio_dataset` n'est pas utilisé pour constituer le corpus de référence tant que
   le consentement et la licence ne sont pas établis.
4. Toute utilisation au-delà de la « Décision d'usage » (publication, redistribution,
   entraînement) demande une nouvelle décision écrite du mainteneur, après clarification auprès des
   ayants droit.

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
- Pour une estimation de généralisation, il faut des enregistrements hors EveryAyah, annotés à la
  main. Le lot 1 en est le candidat, sous réserve de ses décisions de droits ouvertes
  (`docs/data-lots/RIGHTS.md`) : ce n'est pas une référence acquise.

## Décision d'usage

**Statut : provisoire — en attente de confirmation écrite du mainteneur.** Rédigée le 2026-10-09
(entrée correspondante dans `.artist/decision-log.md`). Elle fixe une règle de travail pour les
audios dont les droits ne sont pas établis, **y compris pour l'évaluation interne** ; elle
n'établit aucun droit et ne remplace pas l'accord des ayants droit. Elle lève la contradiction entre
la règle du début du document (« traité comme non autorisé ») et l'évaluation interne : celle-ci
n'est pas présumée permise, elle n'est permise **que par cette décision**, tant qu'elle tient.

### Qui décide
Le mainteneur (Cherif), seul. Ni un agent ni un contributeur ne la confirme, ne l'élargit ni ne la
présume confirmée. Tant que la confirmation écrite manque (réponse sur la PR, ou ligne du mainteneur
dans `.artist/decision-log.md`), tout rapport chiffré obtenu sur ces audios le mentionne.

### Permis provisoirement
- **Évaluation interne locale** : lancer le moteur sur ces audios et en calculer des métriques à
  usage interne (jeux `dev` et `test` du protocole `docs/evaluation/protocole-reglage-evaluation.md`).
- **Audio hors dépôt** : `AQR_AUDIO_DIR` (par exemple `~/aqr-ref`), jamais dans git. Le dépôt ne porte
  que des empreintes sha256, des métadonnées et le libellé de licence canonique (voir plus bas).
- **Aucune redistribution** : pas de publication, de partage, de dataset public ni de transfert
  automatique vers un service tiers.
- **Réglage de la configuration** (seuils du gate, paramètres du décodeur) sur le jeu `dev`, comme le
  prévoit le protocole. Hypothèse tranchée faute de précision : « régler » vise ici la
  configuration de notre système, non les poids d'un modèle (voir « Interdit »). À confirmer
  explicitement par le mainteneur.

### Interdit
Sans nouvelle décision écrite du mainteneur :
- **Versionner** ces audios ou leurs dérivés (extraits, mixages, dégradations) : git, LFS, artefacts
  de CI.
- **Republier ou redistribuer** sous quelque forme que ce soit : dataset (en particulier public),
  archive, pièce jointe. `scripts/audio_lot.py upload` est la seule commande qui sorte des audios de
  la machine ; elle n'est permise que vers un dataset **privé** (elle s'arrête sinon).
- **Entraîner, affiner ou adapter un modèle** (fine-tuning, LoRA, distillation) sur ces audios, ou
  s'en servir comme données d'apprentissage ou d'augmentation.
- **Utiliser `RetaSy/quranic_audio_dataset`** pour quoi que ce soit, évaluation interne comprise :
  voix de personnes privées, consentement non documenté.
- Les présenter comme libres de droits ou sous licence.

### Portée
| Source | Constat | Usage couvert par cette décision |
|---|---|---|
| EveryAyah (`everyayah.com`, `scripts/fetch_everyayah.py`) | droits non établis | oui : évaluation interne locale |
| Lots Hugging Face lus pour le corpus de référence (`Buraaq/quran-md-ayahs`, `tarteel-ai/everyayah`, `MohamedRashad/Quran-Recitations`) | aucune licence déclarée ou droits explicitement non documentés | oui : évaluation interne locale |
| `RetaSy/quranic_audio_dataset` | aucune licence, consentement non documenté | **non** : exclu |
| Lot 1 (`docs/data-lots/lot-1.yaml`, enregistrements de tiers sur YouTube) | **décisions ouvertes** (`docs/data-lots/RIGHTS.md`) | partiellement, voir ci-dessous |

Le lot 1 n'est **pas un précédent**. Son dataset Hugging Face est public : c'est une redistribution
déjà constatée, que cette décision ne légitime ni ne condamne. Les trois décisions de `RIGHTS.md`
(visibilité du dataset, retrait des voix de tiers, mention de droits) restent au mainteneur et
priment. En attendant, la présente décision couvre pour le lot 1 la seule évaluation interne locale
d'une copie hors dépôt, sans nouvelle publication. Le téléchargement de la copie publique par
`scripts/fetch_public_lot.py` vers un autre environnement que la machine du mainteneur relève de ces
décisions ouvertes et n'est pas couvert ici. Réciproquement, rien de ce qui est décidé pour les
sources ci-dessus ne vaut autorisation pour le lot 1.

### Le téléchargement n'est pas une autorisation
`scripts/fetch_everyayah.py` **télécharge par défaut** (sans confirmation) 3 récitants × 10 sourates
(`DEFAULT_SUBSET`, `src/aqr/data/everyayah.py`) vers `$AQR_AUDIO_DIR/everyayah`, hors dépôt. Ce
comportement est conservé tel quel : ce qui rend l'usage acceptable n'est pas le script, c'est la
décision ci-dessus, provisoire. Lancer ce script (ou `scripts/fetch_public_lot.py`) revient donc à
exercer la permission provisoire : sur la machine du mainteneur, vers un dossier hors dépôt, jamais
automatisé en CI ni vers un dossier suivi par git. `--dry-run` liste le plan sans rien télécharger.

## Libellé de licence canonique
Champ `license` d'un manifeste (corpus de référence et tout nouveau cas dont les droits ne sont pas
établis) :

`droits non établis : usage interne d'évaluation uniquement, jamais redistribué (docs/data-lots/ref-corpus-provenance.md)`

Il dit deux choses : le statut des droits (**non établis**) et la limite d'usage (la « Décision
d'usage » ci-dessus, par le chemin qu'il cite).

Libellé hérité du lot 1 (`license` de `tests/fixtures/audio/manifest.yaml`, 12 cas ; champ `droits`
des fiches écrites par `scripts/audio_lot.py`) :

`usage interne d'évaluation uniquement, jamais redistribué`

C'est une consigne d'usage, pas une preuve de droits : il se lit comme le libellé canonique privé de
son préfixe « droits non établis ». Il n'est pas réécrit ici, car les décisions du lot 1 sont
ouvertes (`docs/data-lots/RIGHTS.md`, décision 3) et le changer toucherait les 12 cas du manifeste et
`scripts/audio_lot.py` ; on l'alignera quand le mainteneur aura tranché. Aucun autre libellé n'est
admis : `tests/unit/test_docs_links.py` vérifie que chaque libellé du manifeste du lot 1 figure dans
ce document.
