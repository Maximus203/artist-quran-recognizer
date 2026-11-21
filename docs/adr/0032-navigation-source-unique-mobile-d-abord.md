# ADR-0032 — Une seule source pour la navigation de l'atelier, pensée d'abord pour le téléphone

- Statut : **accepté** — signalement du mainteneur en test réel (2026-11-21) : sur téléphone, des entrées de navigation
  n'apparaissaient pas. Aucun effet sur les invariants I1 à I5 ni sur l'identité visuelle (aucun token touché).

## Contexte

Trois listes de pages coexistaient dans `web/app/atelier/` : la barre du haut (`header.tsx`), la section « Aller à » du menu du compte
(`account-menu.tsx`) et le bas du tiroir de gauche (`sessions-panel.tsx`), plus les onglets de l'administration
(`admin-frame.tsx`). Elles avaient divergé : « Téléchargements » (PR #233) n'était que dans la barre, donc absent du téléphone ;
l'administrateur n'avait sur téléphone que « Moteur » (ni « Comptes » ni « Invitations ») ; le tiroir montrait « Performance » au
récitateur. Autre écart, mesuré dans un vrai navigateur : de 768 à 1023 px la barre complète d'un administrateur débordait
(jusqu'à 204 px de défilement horizontal, logo et premier onglet coupés).

## Décision

1. **Source unique** : `web/app/atelier/nav-entries.ts` (`navTree(role)`) décrit les pages, leurs groupes (Récitations,
   Administration), leur ordre, leur icône et leur visibilité par rôle (`role-view.ts`). La barre du haut, la feuille du menu
   (`SheetNav`), le tiroir (`DrawerNav`) et les onglets d'administration en dérivent : ajouter une page à un seul endroit la fait
   apparaître partout, pour le bon rôle. Le test `nav-entries.test.tsx` garantit, pour chaque rôle, que toute entrée de la barre
   existe dans la feuille et le tiroir (et qu'aucune n'y est ajoutée), et qu'aucun composant ne redéclare une liste.
2. **Seuil unique de la barre : 1024 px.** En dessous, la barre est masquée et les mêmes pages sont dans le menu du compte
   (feuille ancrée en bas sur téléphone, fenêtre déroulante sur tablette). Mobile d'abord : le style de base est celui du
   téléphone, la barre est une amélioration `min-width: 1024px` (le choix 1024 vient de la mesure : 1024 px tient, 768 px non).
3. **Cibles tactiles de 44 px** (`--hit`) pour toute commande de l'en-tête et du menu, y compris les boutons « petits » ; zones
   sûres (`safe-area-inset-*`) dans l'en-tête.
4. **Garde dans un vrai navigateur** : `web/e2e/nav-parity.mjs` (`npm run check:nav`, une fois par rôle) vérifie à 360, 375, 390, 768 et
   1024 px que les destinations atteignables ⊇ celles de 1440 px, les cibles ≥ 44 px, l'absence de défilement horizontal, et
   l'ouverture / fermeture (Échap, retour du focus) du menu.

## Conséquences

- Le menu du compte porte désormais la navigation sur téléphone : il garde le bouton de l'avatar comme porte d'entrée (aucun
  bouton de plus dans un en-tête déjà serré à 360 px).
- Le raccourci « Administration » du menu du compte disparaît (redondant : le groupe complet y est).
- Limite : une page ajoutée hors de `nav-entries.ts` (lien en dur ailleurs) échappe au test de parité ; le test de source
  (`aucun composant n'a sa propre liste`) ne couvre que l'en-tête, le menu et les onglets d'administration.
