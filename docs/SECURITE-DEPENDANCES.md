# Dépendances, runtime et CVE : état au 2026-10-29

Registre de la section 3 de `docs/SECURITE-PRE-DEPLOIEMENT.md`. Chaque ligne cite sa commande et sa
sortie. Ce document se met à jour à chaque audit ; la date de révision des exceptions est
**2026-11-12**.

## Node.js : CVE-2026-111497 (« Node2Shell »)

- Source officielle : [avis de sécurité Node.js du 21 octobre 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
  Faille de gravité haute dans le décodeur Brotli (`node:zlib`) : une entrée Brotli malveillante peut
  corrompre la mémoire du processus (arrêt, lecture mémoire, exécution de code selon l'avis).
- Lignes touchées : 22.x, 24.x, 26.x. Versions livrées avec le correctif : **22.23.4, 24.22.1, 26.12.1**
  (la page officielle liste ces versions dans « Downloads and release details » sans mapper chaque CVE ;
  les sources tierces consultées concordent). Les lignes en fin de vie (18, 20, 23, 25) n'ont aucun
  correctif officiel.
- Version retenue pour la production : **Node 24.22.2** (LTS, publiée le 2026-10-28, aucune correction de
  sécurité annoncée en plus), fichier `.nvmrc`. Un poste ou un serveur en dessous de 24.22.1 est touché.
- **Poste de développement : Node 24.19.0, donc touché** (`node -v`). Je n'ai pas mis le poste à jour : à
  faire par Cherif (`nvm install 24.22.2`).
- Garde-fou ajouté : `web/lib/runtime-guard.ts`, appelé par `instrumentation.ts`.
  - production sur une version touchée : le serveur journalise « démarrage refusé » et **s'arrête (code 1)** ;
  - développement : simple avertissement dans le journal.
  - Preuve : `npm run build` puis `next start` sur ce poste (Node 24.19.0) →
    `ERROR runtime: démarrage refusé (Node 24.19.0 contient la faille CVE-2026-111497 … passer à Node 24.22.1 ou plus.)`, `exit=1`.
- `engines.node` (`web/package.json`) : `^22.23.4 || ^24.22.1 || >=26.12.1`. Sans `engine-strict` : npm
  prévient sans bloquer le poste de développement.

## Next.js, React, zod

- Next.js **16.4.2 → 16.4.3** (dernière version du registre npm au 2026-10-29). Les notes de version listent des corrections de
  bogues, **aucun avis de sécurité** ; mise à jour faite pour suivre la version corrigée la plus récente.
  Preuve : `npm run build` réussi, suite `vitest` verte.
- React 19.3.0 : aucun avis dans `npm audit`.
- `npm audit --omit=dev` avant : **1 haute** (zod < 4.6.6, épuisement de mémoire sur de grandes collections
  validées : GHSA-mrhx-c7xc-m3w5, pertinent car chaque corps d'API est validé par zod).
  Corrigée : zod **4.6.7**. Après : `found 0 vulnerabilities`.

## Python : `pip-audit` (version 2.10.1) sur l'environnement du projet

Commande : `pip-audit --path .venv/Lib/site-packages`. Environnement : Python 3.11.9, pile ML complète
(`asr`, `muno`). **L'environnement de production n'existe pas encore** (pas d'image, pas de verrou) :
ces résultats décrivent le poste de développement et devront être rejoués sur l'image.

| Paquet (version) | Avis | Corrigé en | Tiré par | Atteignable depuis nos entrées ? |
|---|---|---|---|---|
| pillow 12.3.0 | 39 | 13.0.0 | `tensorboard` | Non : aucune importation de PIL dans `src/` ni `scripts/` ; nous ne décodons aucune image en Python (les avatars passent par ffmpeg côté Node). |
| filelock 4.0.10 | 13 | 4.2.1 | `torch`, `datasets`, `huggingface_hub` | Non : verrous de fichiers locaux du cache de modèles, pas d'entrée d'utilisateur. |
| aiohttp 3.14.3 | 8 | 3.14.4 | rien (installé seul) | Non : aucun serveur ni client HTTP aiohttp dans notre code. |
| lightning 2.4.0 | 3 | 2.6.6 | intégration `nv-one-logger` | Non : pas d'entraînement lancé par le service. |
| hydra-core 1.3.2 | 2 | 1.3.4+ | rien | Non : configuration NeMo locale. |
| setuptools 81.0.0 | 3 | 83.0.0 / 84.1.0 | `torch`, `nemo` | Non : outil de construction, pas chargé à l'exécution. |
| certifi 2026.7.22 | 2 | 2026.10.18+ | `requests`, `httpx` | Indirect : lots de certificats pour les téléchargements de modèles et QuranEnc (réseau sortant). **À mettre à jour**, sans risque. |
| opentelemetry-api 1.45.0 | 1 | 1.45.1 | exporteurs OTLP | Non : aucun export de télémétrie configuré. |
| fsspec 2025.12.0 | 1 | 2026.6.0 | `datasets`, `torch`, `nemo` | Non : accès aux fichiers locaux du cache. |

`pip-audit` n'a pas pu auditer `torch 2.11.0+cu128` et `torchaudio` (variantes CUDA absentes de PyPI) ni le
projet lui-même.

**Limites de ce tableau.** `pip-audit` ne donne pas la gravité : je n'ai pas qualifié chaque avis (72 entrées
au total, quelques-unes en double) et je ne prétends pas qu'aucun ne soit haut ou critique. La colonne « atteignable » est un
raisonnement sur nos entrées (fichiers audio passés à ffmpeg, trames WebSocket, JSON), vérifié par
recherche des importations ; il ne remplace pas un scan de l'image finale.

**Exceptions acceptées jusqu'au 2026-11-12** : tous les paquets ci-dessus sauf `certifi`, pour la raison
« non atteignable » de la ligne. Condition de sortie : à l'image de production, mise à jour de ce qui
peut l'être (`certifi`, `aiohttp`, `opentelemetry-api` en correctif sans risque ; `pillow` 13 et
`setuptools` seulement si la pile `torch`/`nemo` les accepte), puis nouveau `pip-audit` avec qualification
de la gravité.

Je n'ai **pas** modifié l'environnement Python du poste (pile CUDA partagée, non reproductible) : les mises
à jour se feront dans l'image.

## Suivi automatique et épinglage

- `.github/dependabot.yml` : npm (`web/`) et pip (racine), hebdomadaire. Chaque mise à jour arrive sous forme de PR, relue et testée avant fusion.
- `.nvmrc` : 24.22.2. `.python-version` : 3.11.9 (version du poste ; `requires-python = ">=3.11"`).
- `models/LOCK.json` : verrou des modèles (existant, vérifié par le moteur).
- **Pas encore fait** : verrou complet des paquets Python (nécessite l'image : variantes CUDA de `torch`
  hors PyPI) et scan Trivy de l'image (aucun `Dockerfile` dans le dépôt, section 15). Docker est installé
  sur le poste ; `trivy` ne l'est pas.
