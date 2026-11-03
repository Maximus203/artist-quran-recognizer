# Sécurité

## Signaler une vulnérabilité

**Ne l'ouvrez pas dans une issue publique.** Utilisez le signalement privé de GitHub : onglet *Security* du dépôt, puis *Report a vulnerability* ([lien direct](https://github.com/Maximus203/artist-quran-recognizer/security/advisories/new)). Décrivez le problème, comment le reproduire et son impact. Nous répondons dès que possible et vous tenons informé de la correction.

## Périmètre

Le projet est conçu pour un **usage local** : l'atelier web écoute sur `127.0.0.1` et valide l'en-tête `Host`. Sont dans le périmètre : l'authentification et les sessions, les contrôles d'accès (audios privés ou globaux, administrateur), l'envoi de fichiers (type, taille, chemins), l'exécution de `ffmpeg` et du moteur Python, la lecture de fichiers locaux, l'origine des requêtes, la fuite de données personnelles ou d'audios.

Exposer l'atelier sur un réseau ou sur Internet n'est pas un usage supporté sans les réglages décrits dans [web/README.md](web/README.md) (hôtes autorisés, inscription, quotas, proxy de confiance).

## À ne jamais committer

Secrets, jetons (dont `HF_TOKEN`), fichiers `.env`, audios ou enregistrements de personnes, poids de modèles, bases de données (`aqr.sqlite`). Si vous en avez publié par erreur, signalez-le en privé : une simple suppression ne retire pas l'historique Git.
