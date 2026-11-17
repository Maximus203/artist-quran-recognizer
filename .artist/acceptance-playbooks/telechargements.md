# Page Téléchargements et file d'attente des exports

> Surfaces : [WEB] mobile 375 px d'abord, puis 1280 px · [API] · Statut : ✅ · Build : feat/telechargements, build de production, port 3217
> Périmètre : `/telechargements` (ancienne `/fichiers`), `GET /api/downloads`, annulation `DELETE …/export/video/jobs/<id>`, menu Récitations.
> Environnement : `next start` sur un dossier de données jetable ; trois comptes créés par l'écran d'inscription (administrateur, deux testeurs).
> Données : deux récitations terminées (une publique, une privée), audio et prédiction réels copiés depuis une session locale.
> Critère d'arrêt : tous les must-pass ✅, tous les must-fail bloqués, 0 ❌.

## Must-pass

- Lancer deux exports de deux récitations à la suite : le premier passe « en cours » avec son pourcentage, le second « en attente », en même temps, sur la page.
- Quitter la page puis revenir : les exports ont continué sur le serveur ; les deux finissent « prêts », chacun dans le groupe de sa récitation.
- Plusieurs vidéos d'une même récitation sont regroupées dans un seul bloc repliable.
- Une vidéo prête se télécharge (200, `video/mp4`, non vide) ; la supprimer libère l'espace.
- Un export échoué ou annulé reste listé avec un message en français (« Export annulé. »), sans bouton d'annulation.
- Un export en attente ou en cours se coupe depuis la page (lanceur ou administrateur).
- L'administrateur voit toutes les récitations et tous les exports, avec le propriétaire et le lanceur.
- Un testeur voit ses récitations, les récitations publiques et ses propres exports.
- 375 px : aucun défilement horizontal.
- `/fichiers` redirige vers `/telechargements` ; l'entrée « Téléchargements » est dans le menu Récitations.

## Must-fail

- Sans connexion, `GET /api/downloads` répond 401.
- Un testeur ne voit jamais une récitation privée d'un autre compte (ni son titre, ni ses fichiers), même en listant l'API.
- Un testeur ne voit jamais les exports en file d'un autre compte, même sur une récitation publique.
- Un testeur ne peut pas supprimer la vidéo d'un autre compte (bouton absent côté écran ; 403 côté serveur).
- Un testeur ne peut pas annuler l'export d'un autre compte (404, il ignore qu'il existe).
- Une récitation repassée en privée disparaît de la liste d'un autre compte.
- Un compte qui dépasse le plafond d'attente reçoit un refus en français (429), sans export fantôme ni dossier laissé.

## Vérification du 17 novembre 2026

- Tests : `lib/downloads.test.ts` (15, visibilité et statuts), `app/api/downloads/route.test.ts` (9, dont négatifs d'autorisation), `app/atelier/downloads-view.test.tsx` (14), `lib/downloads-poll.test.ts`, file (`lib/video-jobs.test.ts` : plafond, exports d'affilée un à un, aucune fiche fantôme). Suite web : 3491 réussis.
- Navigateur (build de production, vrai rendu Chrome sans interface) : 2 exports de 2 récitations, en cours puis prêts (≈ 22 s chacun), groupes, annulation, comptes administrateur et testeur : 19 contrôles réussis.
- Non vérifié : récitant (rôle) au navigateur (couvert par les tests de `role-view`) ; un redémarrage du serveur en plein export (la liste de la file est en mémoire, limite documentée dans l'ADR-0030).
