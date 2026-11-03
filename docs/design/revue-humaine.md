# Revue humaine — spécification du panneau de droite

Complète `atelier-direction.md` (tokens, composants, codes visuels). Prototype interactif :
`prototype/index.html` (ouvrir par un petit serveur statique pour tester les gestes ; états de démonstration
par l'adresse, voir §14). Captures : `captures/revue-*.png`.

**Constat.** Le panneau actuel mélange trois métiers : signaler une erreur, lister les signalements, et valider une
vérité terrain. Il demande de lire un type d'erreur dans une liste de 5 valeurs, de saisir des secondes à la main,
et n'identifie pas qui a signalé. Pour un testeur inconnu, sur téléphone, c'est trop.

**Principes.**
1. **Un testeur = un geste.** Délimiter sur l'onde ou avec un seul bouton, choisir des puces, valider.
2. **Trois métiers, trois onglets** : *Signaler* · *Signalements* · *Vérité terrain* (celui-ci séparé, réservé au relecteur).
3. **Rien n'est perdu** : tout est enregistré dès la pose (brouillon), la suppression s'annule.
4. **Les libellés sont de la configuration** : une seule liste (§5), jamais de texte épars.

## 1. Anatomie du panneau

```
┌ Revue humaine ───────────────────────────┐
│ Testeur  [A] Awa                 Changer │  ← pseudonyme, mémorisé, joint à chaque signalement
├──────────────────────────────────────────┤
│ Signaler │ Signalements ③ │ Vérité terrain│  ← onglets (le 3e discret, à droite)
├──────────────────────────────────────────┤
│ ✓ Délimiter   ✓ Écouter   3 · Décrire    │  ← 3 étapes, cochées au fur et à mesure
│ ┌ 1 · Plage à signaler ───────────────┐  │
│ ┌ 2 · Écouter et affiner ─────────────┐  │
│ ┌ 3 · Décrire le souci ───────────────┐  │  puces par famille, verset attendu, commentaire, Confirmer
│ Raccourcis clavier ▾                      │
└──────────────────────────────────────────┘
```

Les commandes de pose vivent **aussi** sous le lecteur (barre de marquage : « Marquer le début », « Tracer sur
l'onde ») et, sur mobile, dans le lecteur ancré en bas (bouton drapeau) : le testeur n'a pas à ouvrir le
tiroir pour délimiter. Même état partout.

## 2. Parcours en étapes

| # | Étape | Ce que fait le testeur | Ce que l'interface fait |
|---|---|---|---|
| 0 | **Qui teste ?** (une fois) | Tape un pseudonyme ou touche un testeur récent | Mémorise (`localStorage`), débloque les boutons |
| 1 | **Délimiter** | A) trace sur l'onde (glisser = plage, toucher = point) ; ou B) « Marquer le début », puis « Marquer la fin » ; ou C) « Signaler un point ici » | Crée un **brouillon** enregistré, affiche la plage sur l'onde et la piste Revue, ouvre l'étape 2 et 3 (tiroir sur mobile) |
| 2 | **Écouter et affiner** | Écoute la plage (boucle possible), ajuste début/fin par − / + (0,1 s), « caler sur la lecture », ou déplace les poignées | La lecture reste dans la plage ; l'étape se coche après une écoute |
| 3 | **Décrire** | Choisit une ou plusieurs puces et/ou écrit un commentaire, indique le verset attendu (facultatif) | Autosauvegarde ; « Confirmer » devient actif dès qu'il y a une puce ou un commentaire |
| 4 | **Confirmer** | Appuie sur « Confirmer le signalement » (ou Ctrl+Entrée) | Passe le signalement en *Confirmé*, affiche « Signalement enregistré » avec « Signaler autre chose » |

Annuler à tout moment : *Échap* ou « Annuler » pendant la pose ; « Garder en brouillon » ; « Supprimer » (annulable 6 s) ;
« Tout recommencer ». Un brouillon **vide** (ni puce, ni commentaire, ni verset attendu) disparaît quand on passe à autre chose.

### États du signalement

| État | Déclencheur | Visible sur l'onde / la piste | Dans la liste |
|---|---|---|---|
| *Pose en cours* (début posé) | 1er appui sur M / bouton | région pointillée qui grandit avec la lecture, étiquette « Début 01:41.2 » | — |
| **Brouillon** | plage ou point créé | losange **creux**, trait **pointillé**, fond 6 % | badge « Brouillon » |
| **Confirmé** | « Confirmer » | losange **plein**, trait **plein**, fond 11 % | badge « Confirmé » |
| *Sélectionné* | clic liste / onde / piste | contour 2 px couleur de la tête de lecture + nom du testeur | ligne surlignée, filet gauche encre |
| *Supprimé (annulable)* | « Supprimer » | disparaît | toast « Signalement supprimé · Annuler » 6 s |

## 3. Tracer directement sur la forme d'onde

- **Mode « Tracer sur l'onde »** (bouton à bascule sous le lecteur, `aria-pressed`) : curseur en croix, une bulle
  « Glisse pour une plage · touche pour un point · Échap pour sortir ». Hors de ce mode, un clic sur l'onde **déplace
  la lecture** comme aujourd'hui (aucun risque de signalement accidentel).
- **Glisser** : plage entre le point d'appui et le point de relâchement (dans les deux sens). Seuil : 6 px de
  déplacement et ≥ 0,2 s, sinon c'est un **point**. **Toucher/cliquer** sans glisser : point.
- **Raccourci souris** sans mode : `Maj` + glisser (bureau).
- **Poignées** (début et fin) sur le brouillon : 28 px de zone de saisie à la souris, **44 px au tactile**, `role="slider"`,
  flèches ← → = 0,1 s, `Maj` + flèche = 1 s ; la valeur est annoncée (« Début 01:41.2 »).
- **Tactile** : en mode tracé, `touch-action: none` sur l'onde (pas de défilement par erreur) ; hors mode, le geste
  garde son sens habituel.
- **Fenêtre visible** : à la création d'un brouillon, la fenêtre se resserre sur la plage ±15 s (si elle est
  « Fichier entier ») pour que les poignées soient saisissables ; un bouton « Tout voir » la rétablit. *(Non prototypé.)*
- Pendant un tracé : région en pointillés avec « 01:41.2 → 01:46.4 » ; au relâchement, la lecture se place au début.
- **Alternative sans pointeur** : « Marquer le début / la fin » et les champs − / + (WCAG 2.5.1, 2.1.1).

## 4. Le bouton unique « début → fin »

Un seul bouton, **trois états**, même emplacement (barre de marquage, panneau, lecteur mobile) :

| État | Libellé du bouton | Texte d'état (rôle `status`) | Autres commandes |
|---|---|---|---|
| Repos | « Marquer le début » `M` | « Appuie à la position de lecture, ou trace directement sur l'onde. » | « Signaler un point ici » `P`, « Tracer sur l'onde » |
| Début posé | « Marquer la fin » `M` | « **Début posé à 01:41.2 — appuie pour poser la fin.** » + « Longueur provisoire : 3,4 s » | « Annuler » `Échap` |
| Trop court | idem | toast « Avance un peu l'écoute avant de poser la fin. » (fin − début < 0,2 s) | — |
| Plage posée | → étape 2 | « Plage de 01:41.2 à 01:46.4 » (annoncé) | — |

- **Position** = position de lecture au moment de l'appui, arrondie à 0,1 s (stockée en millisecondes).
- Pas de pose possible tant que le testeur est inconnu : bouton `aria-disabled`, message « Indique d'abord qui teste. »
- Sur téléphone : le même bouton, icône drapeau, dans le lecteur fixé en bas (44 px) ; le texte d'état reste visible
  sous le lecteur. Au 2e appui, le tiroir s'ouvre sur l'étape 2.

## 5. Présélections — la liste de configuration

**Source unique** : `web/lib/review-presets.ts` (à créer). Le prototype en contient la copie fidèle (`REVIEW_PRESETS`).
Les `id` sont stables (stockés dans les exports) ; les libellés sont modifiables sans migration.

| Famille (`id`) | Aide | Puces (`id` → libellé) |
|---|---|---|
| **Verset** (`verse`) | Ce que le moteur affiche est faux ou incomplet | `wrong_verse` Verset faux · `missing_verse` Verset manquant · `extra_verse` Verset en trop · `repetition_missed` Répétition non détectée |
| **Limites et synchronisation** (`bounds`) | Le verset est bon, mais pas ses bornes | `start_early` Début trop tôt · `start_late` Début trop tard · `end_early` Fin trop tôt · `end_late` Fin trop tard · `display_offset` Affichage décalé de la voix |
| **Coran ou pas Coran** (`detection`) | Le moteur se trompe sur la nature de la parole | `non_quran_as_quran` Parole non coranique prise pour du Coran · `quran_undetected` Coran non détecté · `abstention_wrong` Abstention à tort (le verset était audible) |
| **Formules** (`formula`) | Basmala, isti'adha, takbir, âmîn | `basmala_missing` Basmala manquante · `basmala_extra` Basmala en trop · `istiadha_missing` Isti'adha manquante · `istiadha_extra` Isti'adha en trop · `takbir_amin` Takbir ou âmîn manquant / en trop |
| **Récitation** (`recitation`) | Ce qui tient au lecteur plutôt qu'au moteur | `riwaya` Mauvaise récitation / lecture (riwaya) · `reciter_error` Le lecteur se trompe (le moteur a raison) |
| **Qualité de l'audio** (`audio`) | — | `inaudible` Audio inaudible · `noise` Bruit ou parasites · `overlap` Plusieurs voix en même temps |
| **Autre** (`other`) | — | `other` Autre (précise en commentaire) |

23 puces. Ajouts proposés par rapport à ta liste : `extra_verse`, `abstention_wrong`, `takbir_amin`, `reciter_error`,
`overlap` (cas fréquents en test, à garder ou retirer). Forme de la configuration :

```ts
export const REVIEW_PRESETS = [
  { id: "verse", label: "Verset", hint: "Ce que le moteur affiche est faux ou incomplet.",
    items: [{ id: "wrong_verse", label: "Verset faux", legacy: "wrong_verse" }, /* … */] },
  /* … */
] as const;
export type PresetId = (typeof REVIEW_PRESETS)[number]["items"][number]["id"];
```

**Comportement des puces** : multi-sélection, `button` avec `aria-pressed`, coche « ✓ » devant le libellé **et** inversion
du fond (jamais la couleur seule), regroupées en `<details>` ; **Verset** et **Limites** ouverts par défaut, les autres
fermés sauf s'ils contiennent une puce choisie ; compteur de puces par famille dans l'en-tête de la famille. Cible 32 px
au pointeur fin, 44 px au tactile.

**Règle de validité** : un signalement se **confirme** s'il a **au moins une puce ou un commentaire non vide**. Un brouillon
peut être vide. `Verset attendu` : `sourate:verset` (ex. `2:256`), facultatif, vérifié (`^\d{1,3}:\d{1,3}$`).
`Commentaire` : libre, 3 000 caractères au plus (limite existante).

## 6. Le testeur

- Champ « **Qui teste ?** » (pseudonyme) au-dessus des onglets. Règle : 2 à 24 caractères, lettres, chiffres, espace,
  `-` `_` `.` ; **pas d'adresse e-mail** (rejet du `@`). Message : « 2 à 24 caractères : lettres, chiffres, espace, - _ .
  (pas d'adresse e-mail). »
- Aide : « Un pseudonyme suffit : ni nom complet, ni e-mail. Il est joint à chacun de tes signalements et gardé dans ce
  navigateur. »
- **Mémorisé** dans `localStorage` (`aqr.ui.v1.tester`) avec les 8 derniers pseudonymes (`…testers`) : sur une machine
  prêtée, le testeur suivant touche son nom en un geste (« Testeurs récents sur cet appareil »). « Changer » rouvre le formulaire.
- Le pseudonyme est **copié dans chaque signalement** (`tester`) : le changer ensuite ne réécrit pas l'historique.
- Modifier le signalement d'un autre : autorisé, avec l'encart « Signalement de Moussa : tu le modifies en tant que Awa.
  Son nom reste sur le signalement. » (`updated_by` enregistré). Pas d'authentification : c'est un outil de test de confiance.

## 7. Écoute de la plage, modification, suppression, enregistrement

- **Écouter la plage** (une fois) et **En boucle** (`L`). Point : ± 2 s autour. Indicateur « Écoutée » / « Pas encore
  écoutée » ; la confirmation n'est **pas** bloquée (on ne bride pas un testeur pressé), l'étape 2 se coche à la première écoute.
- **Affiner** : champs Début / Fin en lecture seule + boutons − / + (0,1 s) + « Caler sur la lecture » (icône cible) ;
  les poignées de l'onde font la même chose.
- **Modifier** : depuis la liste (icône crayon) ou un clic sur la plage ; un signalement confirmé reste confirmé,
  les changements s'enregistrent seuls, le bouton devient « Enregistrer les modifications ».
- **Supprimer** : sans boîte de dialogue ; toast « Signalement supprimé · **Annuler** » pendant 6 s (suppression réelle
  ensuite).
- **État d'enregistrement** (ligne unique sous le formulaire, `aria-live`) : « Enregistrement… » → « ✓ Enregistré sur cet
  ordinateur » ; en cas d'échec « ⚠ Échec de l'enregistrement. [Réessayer] » (danger). Autosauvegarde 500 ms après la dernière frappe.

## 8. Liste des signalements (onglet 2)

- Filtres : **Testeur** (liste déroulante : Tous / chaque pseudonyme) et **État** (Tous · Brouillons · Confirmés). Le filtre
  s'applique **aussi à l'onde et à la piste Revue** (« Le filtre s'applique aussi… »), utile pour comparer deux testeurs.
- Ligne (≥ 64 px) : losange d'état · plage en mono · badge d'état ; première puce (+ n) ou « Commentaire seul » ;
  testeur · « il y a 12 min » · début du commentaire. Deux actions à droite : ▶ **écouter** et ✎ **modifier** (44 px).
- **Clic sur la ligne** : saute la lecture à l'instant de début, **surligne la plage sur l'onde** et la piste Revue
  (contour 2 px + nom du testeur). Un clic sur la plage ou le losange de l'onde fait l'inverse (sélectionne et ouvre la liste).
- Tri par instant de début. État vide : « Aucun signalement pour l'instant. Ils apparaîtront ici, sur la forme d'onde et sur la
  piste Revue. » ; filtre sans résultat : « Aucun signalement ne correspond à ce filtre. »
- Pied : exports (ZIP, JSON) — le ZIP contient les signalements avec le pseudonyme de chaque testeur.

## 9. Affichage sur l'onde et la piste « Revue » (mêmes codes que la direction)

| Élément | Brouillon | Confirmé |
|---|---|---|
| Plage sur l'onde | fond 6 %, contour pointillé, losange **creux**, bande basse en **tirets** (5 px) | fond 11 %, losange **plein**, bande basse **pleine** (5 px) |
| Point sur l'onde | trait vertical **en tirets** + losange creux | trait vertical **plein** + losange plein |
| Piste « Revue » | mêmes formes à l'échelle de la piste (24 px) | idem |
| Sélection | contour 2 px (couleur de la tête de lecture), étiquette du testeur | idem |
| Légende | « Signalement confirmé » (losange plein) et « Brouillon » (losange creux) | — |

Teinte = ivoire/encre (`--ink-human`), jamais le lapis (réservé au moteur). Nouveaux tokens : `--review-fill`,
`--review-draft-fill`. La différence brouillon/confirmé se lit sans couleur (creux/plein, pointillé/plein).

## 10. Vérité terrain : séparée, pas supprimée

Onglet **Vérité terrain** (le dernier, en gris, à droite), avec un encart en tête : « **Réservé au relecteur.** Cette section
sert à valider des passages complets pour la vérité terrain. Pour signaler une erreur, reste dans l'onglet « Signaler ». »
Contenu inchangé (`validation-panel.tsx` : proposer, aligner, valider/exclure, manifeste), habillage selon la direction. Aucun
lien d'état avec les signalements. Option d'accès : n'afficher l'onglet qu'avec `?relecteur=1` ou un réglage — **à arbitrer**.

## 11. Micro-textes (français, tutoiement)

| Où | Texte |
|---|---|
| Titre du panneau | Revue humaine |
| Testeur (vide) | Qui teste ? · placeholder « Ton pseudonyme, ex. awa-tel » · bouton « Commencer » |
| Étapes | Délimiter · Écouter · Décrire |
| Étape 1 (repos) | « Où est le problème ? » — « Marquer le début » · « Signaler un point ici » — aide : « Écoute, appuie quand le problème commence, puis une seconde fois quand il finit. Ou trace-le directement sur la forme d'onde : « Tracer sur l'onde », puis glisse pour une plage, touche pour un point. » |
| Début posé | « Début posé à 01:41.2 » · « Avance l'écoute jusqu'à la fin du problème, puis appuie pour poser la fin. » · « Longueur provisoire : 3,4 s » · « Marquer la fin » · « Annuler » |
| Plage | « Plage à signaler » · « Sur cette plage, le moteur affiche 2:255 · Reconnu. » · « Tout recommencer » |
| Étape 2 | « Écouter et affiner » · « Écouter la plage » / « Écouter autour du point » · « En boucle » · « Écoutée » / « Pas encore écoutée » · « Tu peux aussi déplacer les poignées sur la forme d'onde (flèches du clavier : 0,1 s, avec Maj : 1 s). » |
| Étape 3 | « Décrire le souci » · « Choisis une ou plusieurs puces, ou écris un commentaire. » · « Verset attendu · facultatif » (« Sourate:verset, par exemple 2:255. ») · « Commentaire · facultatif » / « · obligatoire sans puce » · « Qu'as-tu entendu ? Que faut-il corriger ? » |
| Actions | « Confirmer le signalement » · « Enregistrer les modifications » · « Garder en brouillon » · « Supprimer » |
| Retours | « Signalement enregistré » · « Signaler autre chose » · « Voir la liste » · « Brouillon gardé : retrouve-le dans Signalements. » · « Choisis au moins une puce ou écris un commentaire. » · « Indique d'abord qui teste. » · « Avance un peu l'écoute avant de poser la fin. » · « Signalement supprimé » / « Annuler » |
| Barre de marquage | « Tracer sur l'onde » · « Glisse sur l'onde pour tracer une plage, touche pour un point. » |
| Annonces vocales | « Début posé à 01:41.2 » · « Plage de 01:41.2 à 01:46.4 » · « Point posé à 00:31.2 » · « Pose annulée » · « Mode tracé activé / désactivé » · « Testeur : Awa » |

## 12. Accessibilité et tactile (critères vérifiables)

- **Cibles** : tous les boutons ≥ 44×44 px au tactile (`pointer: coarse` et < 768 px) : puces, −/+, poignées, actions de ligne,
  onglets, bouton de marquage du lecteur.
- **Clavier complet** : tout le parcours se fait sans souris (M/P/L, Échap, Ctrl+Entrée, onglets en flèches ← →, poignées en
  flèches). Les raccourcis à une touche sont **désactivables** (interrupteur « Raccourcis à une touche », WCAG 2.1.4) et
  inactifs dans les champs de saisie.
- **Rôles** : `tablist/tab/tabpanel` (flèches, `aria-selected`), puces `aria-pressed`, interrupteurs `role="switch"`, poignées
  `role="slider"` (valeur en texte), région d'annonces `aria-live="polite"`, barre d'état `role="status"`.
- **Sans couleur** : brouillon/confirmé = creux/plein + pointillé/plein ; puce choisie = coche + inversion ; étape faite = « ✓ ».
- **Contraste** : texte ≥ 4,5:1 (ivoire/encre sur surfaces), contours de champ et de puce ≥ 3:1 (`--border-strong`).
- **Mouvement** : aucune animation requise ; région « début posé » grandit par `transform`/largeur sans transition si
  `prefers-reduced-motion`.
- **375 px** : aucun défilement horizontal ; panneau = tiroir 92 vw (≤ 380 px), fermeture par croix, voile ou Échap ;
  lecteur ancré au pouce ; la plage reste visible dans l'onde quand le tiroir est fermé.
- **Focus** : après création d'un brouillon, le focus reste sur l'onde/bouton d'origine (pas de vol de focus) ; l'annonce
  vocale informe ; le tiroir ouvert piège le focus et le rend à son bouton.

## 13. Modèle de données proposé (pour Ibrahima)

`aqr.review/1` → **`aqr.review/2`** (lecture rétro-compatible : les annotations /1 reçoivent `tags` dérivés de `type` et
`tester: "inconnu"`).

```ts
annotation: {
  id: uuid, mode: "point" | "range", start_s: number, end_s: number | null,
  tags: PresetId[],                // ≥ 1 ou description non vide pour status "confirmed"
  type: LegacyType,                // dérivé du 1er tag via `legacy` (exports existants inchangés)
  description: string (≤ 3000),    // le commentaire libre
  expected_ref: "S:V" | null,
  target_index: number | null,
  status: "draft" | "confirmed",
  tester: string (2–24),           // copié à la création
  updated_by?: string,
  created_at: iso, updated_at: iso,
}
```

Correspondance `legacy` : `wrong_verse`→wrong_verse · `missing_verse`→missing_verse · `repetition_missed`→repetition ·
`start_*`, `end_*`, `display_offset`→timing · tout le reste→other. Un `tags` inconnu (liste modifiée depuis) s'affiche tel quel.
Les écritures restent par `PUT /api/sessions/:id/review` ; en multi-testeurs, **fusionner par `id`** côté serveur au lieu de
remplacer la liste (deux testeurs sur la même session ne doivent pas s'écraser).

## 14. Prototype : ce qui est implémenté, comment l'ouvrir

Implémenté : testeur (validation, mémorisation, récents), onglets, parcours 3 étapes, bouton M début→fin (+ P, L, Échap,
Ctrl+Entrée, Espace), tracé sur l'onde (glisser/toucher, Maj), poignées (souris, clavier), −/+, caler, écoute simulée
avec boucle, 23 puces par famille, verset attendu, commentaire, autosauvegarde simulée, liste filtrée (testeur, état), saut
et surlignage, suppression annulable, exports, vérité terrain en onglet, affichage onde + piste Revue, thème clair.
Non prototypé : fenêtre auto-resserrée, piège de focus du tiroir, persistance du filtre, audio réel.

États par l'adresse : `#rev=start` (début posé) · `#rev=draft` (plage tracée) · `#rev=tags` (puces) · `#rev=done` · `#tab=list`
(+ `&listsel=a2`) · `#tab=truth` · `#tester=none` · `#trace=1` · `#theme=light` · en mobile `#drawer=right`, `#scroll=markbar`.

## 15. Correspondance avec le code et risques

| Fichier | Travail |
|---|---|
| `web/lib/review-presets.ts` (nouveau) | La liste du §5 + types + `legacy` ; utilisée par le formulaire, la liste et le schéma zod |
| `web/lib/review.ts` | Schéma `aqr.review/2`, migration à la lecture, validité « puce ou commentaire » |
| `web/app/review-app.tsx` | Extraire `ReviewPanel` (Tester, Tabs, SignalTab, ListTab) et un hook `useReviewDraft` ; la pose début/fin et le tracé vivent dans la console |
| `web/app/validation-panel.tsx` | Inchangé fonctionnellement, monté dans l'onglet Vérité terrain |
| `web/app/style.css` | Composants de `tokens.css` + classes du prototype (`.pchip`, `.rcard`, `.rv-region`, `.rv-h`…) |

**Risques.**
1. **wavesurfer Regions / pointeur** : le tracé doit intercepter les événements avant wavesurfer (`interaction`) : le mode tracé
   désactive le seek, pose `touch-action: none` et pilote ses propres régions (calque au-dessus, comme `#rv-layer`) plutôt que
   le plugin `drag`/`resize` natif, moins précis au tactile.
2. **Fusion multi-testeurs** : le `PUT` actuel remplace toute la liste ; avec plusieurs testeurs simultanés il faut fusionner par `id`.
3. **Raccourcis** : `M`, `P`, `L`, Espace entrent en conflit avec la saisie et les lecteurs d'écran → désactivables, jamais dans un champ.
4. **Fenêtre auto-resserrée** : touche `span`/`centerOn` existants (`timeline.ts`) ; tester les bords (début/fin du fichier).
5. **Hooks e2e** : `browser-smoke.mjs` ne touche pas le panneau de revue, mais les tests de signalement futurs doivent viser des
   `data-testid` (`mark-button`, `preset-<id>`, `confirm-report`), pas des libellés.
6. **Compatibilité exports** : conserver `type` (dérivé) tant que les consommateurs du ZIP lisent l'ancien champ.

## 16. Arbitrages pour Cherif

1. **Liste des puces** : garder les 5 ajouts (`extra_verse`, `abstention_wrong`, `takbir_amin`, `reciter_error`, `overlap`) ?
2. **Onglet Vérité terrain** : toujours visible, ou seulement pour le relecteur (`?relecteur=1`) ?
3. **Écoute avant confirmation** : indicatif (proposé) ou **obligatoire** ?
4. **Modifier le signalement d'un autre testeur** : autorisé avec encart (proposé) ou refusé ?
5. **Pseudonyme** : libre (proposé) ou liste de testeurs prédéfinie par Cherif ?
6. **Raccourcis** : `M` / `P` / `L` conviennent-ils, ou autres touches ?
