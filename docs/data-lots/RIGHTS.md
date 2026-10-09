# Droits du lot 1 — contradiction à clarifier par le mainteneur

**Le lot 1 n'est pas un précédent.** Ses trois décisions ci-dessous sont ouvertes : rien de ce qui
est fait pour lui ne vaut autorisation pour d'autres sources, ni l'inverse. La règle d'usage
provisoire des audios aux droits non établis (évaluation interne locale, hors dépôt, sans
redistribution) est la section « Décision d'usage » de
`docs/data-lots/ref-corpus-provenance.md` ; elle ne tranche aucun des points qui suivent. Libellés
de licence : section « Libellé de licence canonique » du même document.

## Constat (vérifié le 2026-10-06)
- Le dataset `https://huggingface.co/datasets/printf0cherif/aqr-audio-private` est **public**
  (API Hugging Face : `private: false`, `gated: false`), révision `f00ebced79755213c0d2050566126602454f5517`,
  12 fichiers MP3 (714 058 382 octets). Il s'appelle encore « private ».
- Les fiches du lot et le manifeste (`tests/fixtures/audio/manifest.yaml`, sidecars créés par
  `scripts/audio_lot.py`) portent la mention :
  « usage interne d'évaluation uniquement, jamais redistribué ».
- Les sources sont des enregistrements de tiers diffusés sur YouTube (URL dans
  `docs/data-lots/lot-1.yaml`), dont certains contiennent des voix identifiables (assises, prêches).
- `AGENTS.md` : « Aucun fichier audio/vidéo ni enregistrement de personne n'est versionné (droits,
  vie privée) ».

Rendre le dataset public **est** une redistribution : elle contredit la mention. Je ne peux pas
trancher le droit par inspection.

## Ce que fait le dépôt en attendant
- Les audios restent hors git ; ils ne sont republiés nulle part ailleurs ; aucun jeton n'est utilisé
  (`scripts/fetch_public_lot.py` lit la révision épinglée) ; la visibilité du dataset n'est pas modifiée.
- Les rapports versionnés sont expurgés : pas de transcription brute, pas de noms de personnes.

## Décisions qui n'appartiennent qu'à Cherif
1. Le dataset doit-il rester public (et sous quelle licence/droit) ou repasser en privé ? S'il repasse en
   privé, le cloud aura besoin d'un jeton de lecture (`scripts/audio_lot.py fetch`, qui attend aussi la
   disposition `lot-1/<id>.mp3`, différente de la racine actuelle).
2. Faut-il retirer du dataset les enregistrements dont les droits ne sont pas établis (voix de tiers) ?
3. Quelle mention de droits remplace « jamais redistribué » dans les fiches si la publication est voulue ?
