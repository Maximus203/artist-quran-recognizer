# Scans de sécurité avant la mise en production

Ce document dit quels scans lancer, avec quelle commande, ce qui compte comme réussi, et où ranger le
rapport. Les scans ne visent que l'**environnement de test** (jamais la production, jamais un tiers).
Le lanceur unique est `scripts/run_security_scans.sh <adresse de test> [dossier]` ; chaque scan est
indépendant et le rapport va dans `docs/evaluation/scans/AAAA-MM-JJ/`.

## État au 2026-10-29

| Scan | Outil | État | Preuve ou raison |
|---|---|---|---|
| En-têtes de sécurité | `web/scripts/check-headers.mjs` | fait en local (HTTP) | 3 pages conformes sur un vrai serveur de production, code 0. À refaire sur l'adresse HTTPS de test (HSTS). |
| Dépendances Node | `npm audit` | fait | 0 faille (production et développement). |
| Dépendances Python | `pip-audit` | fait, 9 paquets avec avis | qualifiés dans `docs/SECURITE-DEPENDANCES.md` ; aucune mise à jour faite sur le poste (pile CUDA partagée). |
| Secrets, historique | `scripts/scan_secrets.py --history` | fait | 718 commits, aucun secret ni fichier sensible. |
| Secrets, historique | gitleaks | **non lancé** | non installé ; image Docker à télécharger. |
| Application | OWASP ZAP (base, puis actif) | **non lancé** | image Docker à télécharger ; pas d'environnement de test exposé. |
| TLS | testssl.sh | **non lancé** | aucun TLS tant que rien n'est exposé (section 15). |
| Image | Trivy | **non lancé** | aucune image avant la section 15. |

## Lancer

```bash
scripts/run_security_scans.sh https://test.exemple.org
ZAP_ACTIVE=1 scripts/run_security_scans.sh https://test.exemple.org   # ajoute le scan actif
APP_IMAGE=atelier:test scripts/run_security_scans.sh https://test.exemple.org   # ajoute Trivy
```

Épingler les versions des images (`ZAP_IMAGE`, `TESTSSL_IMAGE`, `TRIVY_IMAGE`, `GITLEAKS_IMAGE`) à la
première exécution et les noter dans le rapport : un scan qu'on ne peut pas rejouer ne prouve rien.

## Critères de réussite

- **En-têtes** : aucun écart signalé sur `/login`, `/api/auth/config` et `/api/sessions`, HSTS compris en HTTPS.
- **npm audit** : aucune faille `high` ou `critical`.
- **pip-audit** : chaque avis est qualifié (utilisé ou non par le code servi) ; aucun avis exploitable non traité.
- **Secrets** : zéro résultat, sur le filet interne comme sur gitleaks.
- **ZAP** : aucune alerte `High` ; chaque `Medium` est corrigée ou justifiée par écrit dans le rapport.
- **TLS** : TLS 1.2 au minimum, aucune suite faible, certificat valide et chaîne complète.
- **Trivy** : aucune vulnérabilité `HIGH` ou `CRITICAL` corrigeable dans l'image.

## Ce qui est déjà couvert par des tests qui tournent à chaque suite

Injection sur chaque route (`web/app/api/injection.test.ts`), plafonds de débit de chaque famille
(`web/proxy-families.test.ts`), accès aux ressources d'autrui (`web/app/api/idor.test.ts`), en-têtes et
cookies, pièges à robots, envois hostiles, clés dans Git (`tests/unit/test_scan_secrets.py`). Les scans
ci-dessus ne remplacent pas ces tests : ils cherchent ce que personne n'a pensé à écrire.
