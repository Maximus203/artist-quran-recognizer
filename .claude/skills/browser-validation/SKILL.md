---
name: browser-validation
description: >
  Boucle de validation navigateur. À invoquer dès qu'une fonctionnalité ayant une
  surface visible (page, écran, composant, formulaire, flux) a été codée ou modifiée.
  L'agent teste lui-même le rendu et le fonctionnement dans le navigateur via
  l'extension Claude in Chrome, corrige en boucle jusqu'à zéro barrière humaine,
  puis vérifie la console AVANT de passer la main. Déclencher sur : "teste la
  fonctionnalité", "valide l'interface", "vérifie dans le navigateur", après toute
  implémentation front, avant de demander une validation humaine.
---

# Browser Validation — la boucle avant l'humain

## Principe
Je ne demande jamais à Cherif de tester une fonctionnalité tant que je ne l'ai pas
moi-même rendue utilisable par un humain sans aucune barrière. Son test est un filet
de sécurité, pas une session de debug. Je boucle jusqu'au vert.

## Pré-requis
- L'application tourne (serveur de dev). Sinon, je la lance.
- J'identifie la ou les pages / écrans concernés par ce que je viens de coder.

## La boucle

### Phase 1 — Parcours humain
1. Ouvrir la page concernée dans le navigateur (Claude in Chrome).
2. Exécuter le **parcours réel** de l'utilisateur : cliquer, saisir, naviguer, soumettre — pas seulement regarder.
3. Chasser les barrières, dans cet ordre :
   - **Fonctionnel** — l'action fait-elle ce qu'elle doit ? états de chargement, erreurs et cas vides gérés ?
   - **Chemins négatifs** — saisie invalide, champ requis manquant, action refusée (droits), double soumission, hors-ligne / requête lente. Pars du principe que la fonctionnalité finira par être malmenée : ces chemins doivent échouer proprement, pas planter.
   - **UX** — le parcours est-il évident ? feedback après chaque action ? pas de cul-de-sac ?
   - **UI** — alignements, espacements, états hover / focus / disabled, responsive mobile + desktop.
   - **Cohérence** — même tokens, mêmes composants, aucune valeur en dur (cf. loi 2).
4. Toute barrière trouvée → corriger le code → revenir à l'étape 1. Ne jamais avancer avec une barrière connue.

### Phase 2 — Console propre (seulement quand la Phase 1 est verte)
5. Lire la console : **erreurs ET warnings**.
6. Vérifier les requêtes réseau : aucune en échec (4xx / 5xx non gérés).
7. La moindre alerte cachée → corriger → **retour Phase 1** (une correction peut casser le parcours).

### Phase 3 — Passer la main
8. Parcours fluide ET console propre → court récap (ce qui a été testé, parcours couvert, chemins négatifs vérifiés, captures si utile) et inviter Cherif à valider par sécurité.

## Règle d'arrêt
Tant qu'une seule condition n'est pas remplie — barrière humaine, chemin négatif qui plante, alerte console, ou requête échouée — la boucle continue. Je ne sors **pas** de la boucle en demandant de « jeter un œil ».
