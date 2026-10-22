# Phase 2 « multi-testeurs » — design des nouveaux écrans

Spécification des écrans ajoutés quand l'atelier s'ouvre à plusieurs testeurs : comptes, audios globaux ou
privés, préférences enregistrées côté serveur, liste de sessions qui passe à l'échelle, documentation
embarquée, statistiques et stockage. Même direction que `atelier-direction.md` (« Encre & lapis »), mêmes
tokens (`tokens.css`), mêmes composants. Aucun code applicatif ici : un prototype statique, des captures, ce brief.

- **Prototype** : `docs/design/prototype/` — `login.html`, `register.html`, `index.html` (écran principal mis à jour,
  y compris Nouvel essai et Performance), `sessions.html`, `docs.html`, `compte.html`, `icones.html`. Données
  factices, aucune requête. États de démonstration par paramètre d'URL (voir §16).
- **Captures** : `docs/design/captures/phase2-*.png` (bureau 1440×900 et mobile 375×812, thème sombre ; thème clair pour l'atelier ; états
  vide, chargement, erreur, sélection, quota).
- **Source de vérité visuelle** : `tokens.css` + `prototype/base.css` (les styles de l'ancien `index.html`, extraits sans changement) +
  `prototype/phase2.css` (nouveau). Les écrans de la phase 1 (revue, Nouvel essai, Performance) sont conservés ; leurs deltas sont décrits plus bas.

## 0. Les cinq décisions clés

1. **Un seul langage visuel, zéro nouvelle couleur.** Les écrans de la phase 2 réutilisent l'encre pour les actions,
   le lapis pour la donnée, la couleur seulement pour les statuts. Trois tokens de **mise en page** s'ajoutent
   (`--w-page`, `--w-docs-nav`, `--w-docs-toc`), aucun token de couleur.
2. **La barre de gauche ne liste plus : elle raccourcit.** File d'analyse, favoris épinglés, huit récentes, un bouton
   « Voir toutes les sessions ». La liste complète vit sur sa page `/sessions` (recherche, filtres, tri, groupes par
   date, « Charger plus », sélection multiple). Aucune liste ne peut plus s'allonger sans fin.
3. **Global par défaut, privé par exception, et l'exception se voit.** « Privé » = cadenas + contour encre (le cas qui
   mérite l'attention), « Global » = globe + contour neutre. Le choix se fait à l'import, se modifie par le propriétaire,
   et le passage de privé à global demande une confirmation.
4. **Les réglages suivent la personne, pas le navigateur.** Onze préférences enregistrées sur le compte, appliquées
   avant le premier rendu, sauvegardées automatiquement avec une confirmation discrète annoncée aux lecteurs d'écran.
   Ouvrir ou fermer un panneau pendant la séance met aussi la préférence à jour (le dernier état est la préférence).
5. **Le nom d'une session n'est jamais un horodatage.** Règle de nom par défaut (fichier nettoyé, « Enregistrement du
   22 oct. à 17:51 »), renommage au double-clic ou au crayon, et une ligne séparée « Contenu détecté : Yusuf
   12:11–31 » calculée par le système, jamais confondue avec le nom.

### Arbitrages pour Cherif (défauts proposés, à confirmer)

| # | Question | Défaut proposé | Si on change |
|---|---|---|---|
| A | **Quota de stockage** par compte et taille maximale d'un fichier | 5 Go par compte, 500 Mo par fichier, alerte à 80 %, import bloqué à 100 % (configuration, pas du code) | Les chiffres vivent dans une seule variable ; l'écran n'en dépend pas |
| B | L'administrateur peut-il ouvrir une session **privée** d'un autre testeur ? | **Non** : il voit l'espace utilisé et peut réinitialiser un mot de passe, jamais le contenu privé | Il faudrait le dire à l'inscription |
| C | **Inscription ouverte à tous** ou fermée ? | Ouverte, limitée en débit, avec un interrupteur « fermer les inscriptions » côté serveur | Sinon : lien d'invitation ou code partagé (un champ de plus) |

Tout le reste de ce document est décidé avec un défaut.

## 1. Benchmark (pages réellement ouvertes le 2026-10-22)

| Référence | Geste retenu (adaptation) | Ce qu'on refuse |
|---|---|---|
| [GitHub · Issues de vercel/next.js](https://github.com/vercel/next.js/issues) | Une barre d'outils de liste : recherche large, menus de filtres (auteur, étiquette), tri, compteur ; cases à cocher dont la sélection remplace l'en-tête par des actions groupées → chez nous, **barre d'actions collante** et filtres en pastilles retirables | La densité d'étiquettes colorées, tout en bleu et vert |
| [Linear · Changelog](https://linear.app/changelog) | Date en **marge gauche**, titre et récit à droite, filtre par catégorie en pastilles → notes de version en **chronologie verticale**, date en mono dans la marge | Les vidéos plein cadre en tête de chaque entrée |
| [Stripe · documentation (quickstart)](https://docs.stripe.com/payments/quickstart) | Navigation à gauche, **sommaire de la page à droite**, blocs de code avec nom de fichier et bouton Copier → même trois colonnes, code **sans coloration syntaxique** (poids et italique seulement) | Le panneau de code collant qui mange la moitié de l'écran ; la coloration multicolore |

Inspiration ≠ copie : aucun composant n'est repris tel quel. Registre : la direction « Encre & lapis » a été lue ; les
polices et le lapis restent ceux de la direction validée, aucune nouvelle police, aucune icône d'un paquet interdit.

## 2. Plan du site et navigation

| Route | Écran | Accès |
|---|---|---|
| `/login` | Connexion | public |
| `/register` | Inscription | public (interrupteur serveur) |
| `/` | Atelier. Sans `?s=` : **Nouvel essai**. Avec `?s=<id>` : revue de la session | connecté |
| `/sessions` | Liste complète. L'état des filtres vit dans l'URL : `q`, `portee`, `etat`, `moteur`, `du`, `au`, `tri` | connecté |
| `/performance` | Tableau de bord. `?vue=global` (défaut) ou `?vue=moi` | connecté |
| `/docs`, `/docs/<slug>` | Documentation ; `/docs/notes-de-version` | connecté |
| `/compte`, `/compte/statistiques`, `/compte/securite` | Préférences, statistiques, sécurité | connecté |

Un visiteur non connecté est redirigé vers `/login?next=<chemin interne>` (jamais d'URL externe, jamais de donnée
personnelle dans l'adresse). La page « Accès à l'atelier » par jeton disparaît (ou reste derrière un indicateur pour
le mode test distant protégé).

**Barre du haut (56 px).** Bureau : bouton panneau gauche (Atelier seulement), marque, onglets **Revue · Sessions ·
Performance · Documentation**, « Nouvel essai » (primaire), bascule de thème, **menu du compte**, bouton panneau droit
(Atelier seulement). Un point lapis sur « Documentation » signale des notes de version non lues (`notes_seen_at`).
Mobile (375) : bouton Sessions (Atelier), marque « Atelier », « + », avatar ; la **navigation entre pages vit dans le
menu du compte** (feuille basse, groupe « Aller à »). Le tiroir Sessions garde aussi un pied de navigation.

**Menu du compte** (bouton avatar + pseudo, `aria-haspopup="menu"`) : en-tête (avatar, pseudo, rôle, date d'inscription) →
*Préférences* → *Mes statistiques* → thème (Clair · Sombre · Système, trois boutons) → mini-jauge d'espace utilisé avec
lien « détails » → *Se déconnecter* (danger, séparé). Flèches haut/bas, Échap ferme et rend le focus au bouton. Sous
768 px : feuille basse avec voile ; le groupe « Aller à » apparaît en tête.

## 3. Connexion et inscription

**Mise en page.** Bureau : deux colonnes. À gauche, le visuel (« l'image réelle » de la page, dessinée pour le
projet) : une forme d'onde avec ses trois codes d'intervalle (reconnu, déduit, incertain) et la basmala du corpus,
avec sa légende. À droite, la carte du formulaire (440 px). Mobile : bandeau compact (titre + onde), puis le
formulaire ; la carte du verset disparaît pour que le formulaire reste dans le premier écran. Aucune photo.

**Connexion.** Champs : *Pseudonyme*, *Mot de passe* (bouton œil, `aria-pressed`), case « Rester connecté sur cet appareil
(30 jours) » (cochée), bouton primaire « Se connecter », lien « Créer un compte ». Note : « Mot de passe perdu ? Il n'y a pas
d'e-mail de récupération : demande à l'administrateur de le réinitialiser. »

**Inscription.** *Pseudonyme* (3 à 24 caractères, lettres, chiffres, point, tiret, souligné ; unique sans tenir compte de la
casse ; **visible des autres testeurs**), *Mot de passe* (10 caractères minimum), bouton « Créer mon compte ». Pas de champ de
confirmation (l'œil le remplace). Deux notes sous le bouton : audios visibles de tous par défaut ; « note ton mot de passe ».
Tant qu'aucun compte n'existe : bandeau « Tu es la première personne inscrite : ton compte sera administrateur » (création
atomique côté serveur pour éviter deux administrateurs). Après succès : session ouverte, redirection vers `/` (Nouvel essai).

**Règles du mot de passe.** 10 caractères minimum, 128 au plus, aucune règle de composition. Refusés : identique au pseudonyme,
présent dans une liste de mots de passe courants (message « Ce mot de passe est trop courant. »). Jauge **sobre** : trois
crans d'encre et un libellé (*Trop court (7/10)*, *Acceptable*, *Solide*), jamais de rouge-vert ; *Solide* à 16 caractères,
ou 12 avec trois classes, ou une phrase de trois mots. `aria-live="polite"` sur le libellé.

**Erreurs sans énumération d'utilisateurs.**

| Situation | Texte | Remarque |
|---|---|---|
| Identifiants faux, **pseudonyme inconnu ou mot de passe faux** | « Pseudonyme ou mot de passe incorrect. » + « Vérifie les deux champs et réessaie. » | Même message, même durée de réponse (vérification factice), le champ mot de passe est vidé |
| Trop d'essais (5 échecs en 15 min pour un couple pseudonyme + adresse) | « Trop d'essais. » + « Par sécurité, la connexion est suspendue 2 minutes. Réessaie ensuite. » | Ne révèle pas si le compte existe |
| Serveur injoignable | « Le serveur ne répond pas. » + « Rien n'est perdu : réessaie dans un instant. » | |
| Champ vide | « Indique ton pseudonyme. » / « Indique ton mot de passe. » | Sous le champ, `aria-invalid`, focus sur le premier champ en erreur |
| Inscription : pseudonyme pris | « Ce pseudonyme est déjà pris. Essaie-en un autre. » | **Seul endroit** où l'existence d'un pseudonyme est révélée : inévitable pour un compte sans e-mail, et le pseudonyme est public ; atténué par la limitation de débit |
| Inscription : pseudonyme invalide | « Utilise 3 à 24 caractères : lettres, chiffres, point, tiret, souligné. » | Pseudonymes réservés refusés avec le même message d'indisponibilité (`admin`, `root`, `support`, …) |
| Mot de passe trop court | « Il manque 3 caractères : 10 au minimum. » | |

États du bouton : repos, `disabled` + `aria-busy` + « Envoi… », jamais de double envoi. Session : cookie `httpOnly`,
`SameSite=Lax`, `Secure` ; 30 jours glissants si la case est cochée, sinon session de navigateur ; « Se déconnecter »
invalide la session côté serveur ; « Déconnecter les autres appareils » dans Sécurité.

## 4. Préférences enregistrées sur le compte

Page `/compte` (onglets **Préférences · Statistiques · Sécurité**, barre latérale à gauche sur bureau, trois onglets égaux
sur mobile). Quatre groupes, onze réglages — **liste exacte** :

| Clé | Libellé | Valeurs | Défaut | Appliqué à |
|---|---|---|---|---|
| `theme` | Thème | `system` · `light` · `dark` | `system` | Attribut `data-theme` de `<html>`, avant le premier rendu |
| `quran_font` | Police du texte arabe | `amiri-quran` · `scheherazade` · `noto-naskh` · (`kfgqpc-hafs`, indisponible) | `amiri-quran` | `data-quran-font` ; une seule police chargée |
| `quran_size` | Taille du texte arabe | `null` (automatique) ou 28 à 72 px, pas de 4 | `null` : 40 px bureau, 32 px téléphone | `--quran-size` |
| `show_translation` | Afficher la traduction | oui / non | oui | Carte du passage |
| `follow_playback` | Suivre la lecture | oui / non | oui | Onde, liste des intervalles |
| `visible_window_s` | Fenêtre visible par défaut | 30 · 60 · **120** · 300 · 600 · 0 (tout le fichier) | 120 | Zoom de l'onde à l'ouverture d'une session |
| `speed` | Vitesse de lecture | 0,5× · 0,75× · 1× · 1,25× · 1,5× · 2× | 1× | Lecteur ; mise à jour quand on la change dans le lecteur |
| `volume` | Volume | 0 à 100 %, pas de 5 | 80 % | Lecteur ; idem |
| `panel_left_open` | Panneau Sessions ouvert | ouvert / fermé | ouvert (bureau) | Au chargement ; sur téléphone c'est un tiroir fermé |
| `panel_right_open` | Panneau Revue ouvert | ouvert / fermé | ouvert (bureau) | Au chargement |
| `default_scope` | Portée des nouveaux essais | `global` · `private` | `global` | Sélecteur de Nouvel essai |

`default_scope` est un ajout (non demandé) : un testeur soucieux de confidentialité le règle une fois. Le pas de saut
du lecteur reste **5 s**, valeur centrale unique, non réglable.

**Comportement.**

- **Application partout, avant le premier rendu.** Le serveur lit les préférences dans `layout.tsx` et pose
  `data-theme`, `data-quran-font` et `--quran-size` sur `<html>` : pas de flash, y compris après déconnexion puis reconnexion
  sur un autre appareil. `localStorage` (`aqr.ui.v1`) ne sert plus que de cache pour les pages publiques (thème de `/login`).
  À la connexion, les préférences du serveur l'emportent et réécrivent le cache.
- **Sauvegarde automatique, sans bouton « Enregistrer ».** Chaque changement part en `PATCH` partiel, anti-rebond 400 ms ;
  les curseurs enregistrent au relâchement (`change`), pas à chaque pixel. Réglage appliqué tout de suite (optimiste).
- **Confirmation discrète.** Une pastille collante en haut de la page : « Enregistrement… » (seulement si > 600 ms), puis
  « ✓ Enregistré » pendant 2,4 s, puis rien. **Annoncée en `aria-live="polite"`** (région `role="status"` toujours présente,
  texte remplacé). Hors de la page Préférences (changer la vitesse ou fermer un panneau dans l'atelier) : **aucune pastille**,
  enregistrement silencieux.
- **Échec.** La pastille reste : « Non enregistré » + bouton « Réessayer » ; le réglage reste appliqué localement ; nouvelle
  tentative automatique après 5 s (trois fois) ; hors de la page, un toast « Réglages non enregistrés · Réessayer ».
- **Conflits.** Dernier écrit gagne, clé par clé.
- **Police Hafs (KFGQPC).** Carte grisée « Indisponible ici : sa licence interdit de la servir sans accord écrit du Complexe
  du Roi Fahd » pour tout testeur distant ; jamais sélectionnable (cf. `atelier-direction.md` §3.2).
- **Rétablir les réglages par défaut** (bouton discret en bas), annoncé « Réglages par défaut rétablis ».
- **Aperçu en direct** (basmala du corpus + traduction) sous le groupe Affichage : police, taille et traduction se voient
  avant de sortir de la page.

## 5. Barre Sessions allégée (panneau gauche)

Ordre et plafonds, de haut en bas :

1. En-tête « Sessions » + Actualiser ; **ligne de file** (« 1 en cours · 1 en attente · fin estimée dans ≈ 12 min ») seulement
   s'il y a une file ;
2. **File d'analyse** — mes sessions `running`/`queued` (3 au plus, puis « + N ») ;
3. **Favoris** — épinglés, compteur à droite ; 5 au plus, puis « Voir les N favoris » (`/sessions?portee=fav`) ;
4. **Récentes** — **8** sessions que j'ai créées ou ouvertes (`last_opened_at`), hors favoris et hors archivées, compteur
   « 8 sur 52 » ;
5. **« Voir toutes les sessions »** (secondaire, compteur) ;
6. Mobile seulement : pied de navigation (Performance, Documentation, Préférences).

**Ligne compacte (52 px)**, deux lignes : nom (15 px, 500 ; 700 si non lue) avec un cadenas 14 px devant si la session est
privée ; état court (12 px) — « En cours · ≈ 2 min restantes », « En attente · n° 1 · ≈ 10 min », « Résultat prêt · ×7,3 »,
« Terminé · ×7,1 », « Échec · moteur indisponible », « Annulé après 2 min 10 s ». Une session d'un autre testeur ajoute
« par yacine · » devant l'état. À droite : heure (mono) et point non lu. La troisième ligne (durée, moteur) de la phase 1
disparaît ici ; elle vit sur la page Sessions. Glyphes d'état, barre de progression et règles « non lu » : inchangés
(`atelier-direction.md` §7). **Non lu** concerne uniquement mes sessions (sinon chaque audio global créerait un point chez tout
le monde).

## 6. Page Sessions (`/sessions`)

**Structure (bureau).** Titre « Sessions » + synthèse (« 52 sessions · 26 à toi · 2,5 Go utilisés ») → **recherche** pleine
largeur → **portée** en contrôle segmenté → **filtres** en pastilles à menu (*État*, *Moteur*, *Date*) → filtres actifs
retirables → ligne « 52 sessions » + **tri** → liste en carte → « Charger plus ».

**Portée (segmenté, compteurs).** *Toutes* (mes sessions + partagées non archivées, défaut) · *Mes sessions* · *Partagées*
(globales d'autres testeurs) · *Favoris* · *Archivées* (celles que j'ai archivées). Archiver et favoriser sont **par
utilisateur** : archiver une session globale ne la retire qu'à moi.

**Filtres.** *État* (cases, multi) : En file (en cours ou en attente), Terminées, Non lues, En échec, Annulées. *Moteur*
(cases, multi) : la liste vient des données. *Date* : raccourcis **Aujourd'hui · 7 jours · 30 jours · Personnalisée** ;
« Personnalisée » ouvre deux champs *Du* / *Au* (bornes incluses, jours calendaires du fuseau du navigateur, envoyés en ISO avec
décalage). Un filtre actif colore sa pastille (fond lapis léger, valeur en lapis) et ajoute une puce retirable
(« Date : 7 derniers jours ✕ ») ; « Tout effacer » dès deux puces. Sous 768 px, les fenêtres de filtre sont des
**feuilles basses**, la rangée de pastilles défile à l'horizontale.

**Recherche.** Par nom **et** contenu détecté (« yusuf » trouve « Yusuf 12:11–31 »), insensible à la casse et aux accents,
anti-rebond 180 ms, `type="search"` avec bouton d'effacement ; le nombre de résultats est annoncé.

**Tri.** Plus récentes (défaut) · Plus anciennes · Nom (A → Z) · Durée (la plus longue) · Taille (la plus lourde). En-têtes
de colonne cliquables (Nom, Durée, Taille, Date ; `aria-current="true"` sur la colonne triée, jamais `aria-sort` sur un
bouton). **Groupes par date** uniquement pour les tris par date : *Aujourd'hui · Hier · Cette semaine* (lundi → avant-hier) *·
Ce mois · Plus ancien* (sous-titres par mois au-delà de 50 éléments). Calculés dans le fuseau du navigateur ; titres en
Instrument Serif, collants sous la barre du haut.

**Ligne (bureau, ≥ 1024 px)** — colonnes : case · glyphe d'état · **Nom** (+ état + « Contenu détecté ») · Propriétaire
(« Moi » ou pseudo) · **Portée** · Durée · Taille · Moteur · Date · étoile · ⋯. Mobile et tablette : **carte** (nom sur deux
lignes, état, contenu détecté, puis une ligne de méta : durée, taille, moteur, propriétaire, portée, heure ; étoile et ⋯ à
droite). La session en cours porte sa barre de progression. Un point lapis marque le non lu.

**Pagination « Charger plus ».** 20 éléments par lot, curseur serveur ; sous la liste : barre fine, « 20 sessions affichées sur
52 », bouton « Charger 20 de plus ». Après chargement : le **focus passe au premier élément nouveau** et la région `aria-live`
annonce « 40 sessions affichées ». Pas de défilement infini (le pied de page et le compteur restent atteignables).

**Sélection multiple.** Cases toujours visibles sur bureau ; sur mobile, bouton « Sélectionner » (qui devient « Terminer ») fait
apparaître les cases et « Tout sélectionner ». La sélection porte sur les lignes chargées (200 au plus). Une **barre
d'actions collante** apparaît au bas de l'écran : « 3 sélectionnées · Favoris · Archiver (ou Restaurer) · Portée ▾ ·
Annuler » ; sur mobile, icônes seules avec `aria-label`. Règles : *Portée* ne s'applique qu'aux sessions dont je suis
propriétaire — note « 2 sessions appartiennent à d'autres testeurs : leur portée ne sera pas modifiée » ; passer à global
demande une confirmation en ligne ; *Supprimer…* n'existe que dans « Archivées », pour mes sessions, avec confirmation en ligne
(« L'audio, l'analyse et les signalements seront effacés (≈ 120 Mo libérés). Cette action est irréversible. ») ; **annuler**
(toast de 6 s) pour archiver, restaurer et changer la portée, pas pour supprimer. Échap vide la sélection.

**Menu ⋯ d'une ligne** : Ouvrir · Renommer (propriétaire) · Ajouter aux favoris · Rendre global / privé (propriétaire) ·
Archiver / Restaurer. Feuille basse sur mobile.

**États.**

| État | Rendu |
|---|---|
| Chargement | 7 lignes squelettes (`aria-busy="true"` sur la liste, pulsation coupée si `prefers-reduced-motion`) |
| Aucune session du tout | Illustration onde + losange, « Aucune session pour l'instant », une phrase, **Nouvel essai** (primaire) |
| Aucun résultat | Loupe, « Aucune session ne correspond », « Essaie un autre mot, élargis la période ou retire un filtre. », bouton « Effacer les filtres » ; si l'archive contient une correspondance : « Une session correspondante est peut-être dans les archives. » |
| Erreur de chargement | Bandeau d'alerte « Impossible de charger les sessions. Le serveur ne répond pas pour l'instant. Tes sessions n'ont pas disparu. » + Réessayer ; la liste affiche le même message avec un bouton |
| Erreur sur « Charger plus » | Texte sous le bouton « Impossible de charger la suite. » + Réessayer ; les éléments déjà affichés restent |

## 7. Favoris, archivage

- **Favori** : étoile 44×44 sur chaque ligne et dans l'en-tête de session, `aria-pressed`, libellé « Ajouter aux favoris » /
  « Retirer des favoris ». Étoile pleine = ink (`--text`) ; ni lapis (réservé à la donnée) ni ambre (réservé aux statuts).
  Petite animation d'échelle 240 ms (coupée en mouvement réduit), annonce « Ajouté aux favoris ». Les favoris alimentent le
  groupe Favoris de la barre de gauche.
- **Archivage** : « Archiver » (en-tête de session, ⋯, sélection) retire la session des listes par défaut et du groupe
  Récentes ; elle reste dans le filtre **Archivées** où « Restaurer » est offert. Réversible, toast « Annuler ». Une session
  archivée **compte toujours dans le quota** : seule la suppression définitive libère de l'espace.
- Un testeur peut favoriser et archiver une session globale qui n'est pas la sienne ; seul le **propriétaire** renomme,
  change la portée, supprime et relance l'analyse.

## 8. Portée : global ou privé

| | Global (défaut) | Privé |
|---|---|---|
| Qui voit | Tous les testeurs connectés : liste, écoute, résultats, performances, signalements | Le propriétaire seul (l'administrateur n'a pas accès au contenu, cf. arbitrage B) |
| Dans Performance globale | Nommée dans « Dernières analyses » | **Comptée dans les moyennes**, jamais nommée, sans propriétaire |
| Badge | Globe + « Global », contour neutre, texte 500 | Cadenas + « Privé », contour encre, texte 600 |

- **À l'import** (Nouvel essai) : carte « Qui peut voir cet essai ? » avec deux cartes radio (*Global · par défaut*, *Privé*),
  une phrase chacune, valable pour le micro **et** pour l'import ; valeur initiale = `default_scope`. Sous la carte : espace utilisé
  et taille maximale d'un fichier.
- **Dans la liste** : colonne/puce Portée (bureau et page Sessions) ; dans la barre de gauche **seul le privé est marqué**
  (cadenas devant le nom), le global est le cas normal.
- **En-tête de session** : le badge est un bouton pour le propriétaire (menu « Qui peut voir cette session ? », deux cartes
  radio) ; pour les autres, badge statique + « Propriétaire : amina ». Privé → global : confirmation (« Tout le monde pourra
  écouter cet audio et voir ses résultats. Tu pourras le repasser en privé à tout moment. ») ; global → privé : immédiat.
- Un lien vers une session privée ouvert par un autre testeur répond comme une session inexistante (pas de fuite).

## 9. Renommer, nom par défaut, contenu détecté

**Renommer (propriétaire).** Double-clic sur le titre **ou** bouton crayon (focusable, visible au survol et au focus ; toujours
visible sur écran tactile, 44 px). Le titre devient un champ de même typographie, texte sélectionné, avec un bouton « Valider » et
l'aide « Entrée valider · Échap annuler » (masquée sur mobile). **Entrée valide, Échap annule, la perte de focus valide** si le
texte a changé. 1 à 80 caractères, espaces superflus retirés ; champ vide → retour au **nom par défaut** (« Nom par défaut
rétabli »). Pas d'unicité. Annonces `aria-live` : « Nom enregistré : … », « Modification annulée ». Titre d'onglet et listes se mettent à jour.
Non propriétaire : le titre n'est pas modifiable (ni crayon, ni double-clic).

**Règle du nom par défaut** (calculée à la création, stockée avec `name_source = auto`) :

1. **Enregistrement micro** → « Enregistrement du 22 oct. à 17:51 ».
2. **Import** → nom du fichier **sans extension**, séparateurs `-` `_` `.` remplacés par des espaces, espaces fusionnés, première lettre en
   majuscule, 60 caractères au plus ; l'orthographe n'est jamais corrigée.
3. Si le fichier contient un **horodatage** (`2026-10-20T17-58-52-469`, `20261020_175852`), il est retiré et remplacé par la date : « <reste> du 20 oct.
   à 17:58 ».
4. Si le reste est vide, un **identifiant aléatoire** (lettres et chiffres mêlés de 8 caractères ou plus), un motif d'appareil (`IMG_2041`,
   `VID_…`, `PTT-…`, `Recording 12`) ou des chiffres seuls → « Audio importé le 20 oct. à 11:02 » (ou « Vidéo importée le … »).

| Fichier ou source | Nom proposé |
|---|---|
| (micro, 22 oct. 17:51) | Enregistrement du 22 oct. à 17:51 |
| `khutba-vendredi.mp4` | Khutba vendredi |
| `sourate_baqara_warsh.webm` | Sourate baqara warsh |
| `recitation-2026-10-20T17-58-52-469.webm` | Recitation du 20 oct. à 17:58 |
| `wn52Srssjyk.mp3` | Audio importé le 20 oct. à 11:02 |
| `IMG_2041.MOV` | Vidéo importée le 20 oct. à 09:12 |

**Contenu détecté** (ligne secondaire, **distincte du nom**, jamais modifiable, visible à partir de la fin de l'analyse) : fabriqué par le
système à partir des seuls passages **reconnus** (RECOGNIZED) — jamais des versets déduits (I3, I5) — fusionnés en plages contiguës :
« Contenu détecté : **Yusuf 12:11–31** » ; plusieurs plages : « Al-Fatiha 1:1–7 · Al-Baqara 2:1–5 », au plus deux puis « + N autres »
(liste complète en info-bulle) ; aucun verset : « Aucun verset reconnu (parole non coranique) ». Les noms de sourates viennent des
métadonnées du corpus, jamais d'un modèle (I1). Un bouton discret « **Utiliser comme nom** » (propriétaire) copie cette ligne dans le nom.
Le contenu détecté est aussi cherchable (§6) et affiché sous le nom dans les listes.

## 10. Lecteur : reculer et avancer de 5 s

Les boutons texte « −5 s / +5 s » deviennent deux **icônes** de même gabarit que lecture/pause (zone 44×44, glyphe 26 px, trait
1,6 px, bouts ronds, `currentColor`). Dessin (grille 24) : un **arc ouvert d'environ 315°** — centre (12, 13), rayon 7,5 — dont
l'extrémité du côté du saut porte une **pointe de flèche en chevron** au sommet ; au centre, un **« 5 » tracé** de 6 px de haut.
*Reculer* : flèche à gauche, arc qui s'ouvre vers le haut-gauche (sens antihoraire). *Avancer* : image miroir de l'arc et de la
pointe ; le « 5 » n'est **pas** inversé. Cohérent avec le jeu de l'atelier (même trait, mêmes angles arrondis) et lisible à 20 px (voir
`captures/phase2-icones.png`).

- **Libellés** : `aria-label` « Reculer de 5 secondes » / « Avancer de 5 secondes » ; **info-bulle** `data-tip` « Reculer de 5 s ← » /
  « Avancer de 5 s → » après 350 ms au survol et au focus clavier (pas d'info-bulle sur écran tactile).
- **Clavier** : flèches ← et → hors d'un champ de saisie. Annonce « Reculé de 5 secondes ».
- Sur mobile : dans la barre du lecteur ancrée en bas, entre lecture et position / entre position et marqueur.

## 11. Documentation (`/docs`)

**Onglet** « Documentation » à côté de Performance. **Trois colonnes** sur grand écran : navigation (280 px, collante, recherche
« Filtrer les documents… » sur les titres), contenu (≤ 740 px de texte), sommaire « Sur cette page » (224 px, `h2` et `h3`, suivi de
lecture par `IntersectionObserver`, `aria-current="true"` sur la rubrique visible). En dessous de 1280 px, le sommaire passe en
`<details>` au-dessus du texte ; sous 1024 px, la navigation devient un **tiroir** (bouton « Documents »).

**Groupes de navigation** (exemple, depuis `docs/`) : *Démarrer* (Vue d'ensemble, Guide du testeur) · *Comprendre* (Architecture,
Décisions ADR, Évaluation et métriques) · *Suivre* (État d'avancement, Problèmes connus, **Notes de version**) · *Référence*
(Sortie de recognize, Sortie de align, Reproductibilité). La date de mise à jour s'affiche à droite de chaque lien.

**Rendu Markdown** (GFM, HTML brut désactivé) :

| Élément | Rendu |
|---|---|
| `h1` | Instrument Serif 44 px ; `h2` Instrument Serif 30 px avec filet au-dessus ; `h3` Atkinson 17 px 700. Ancre « # » au survol et au focus (toujours visible au tactile) |
| Paragraphe, liste | 17 px, interligne 1,65, 68 caractères environ ; puces = petit losange |
| Lien interne | Texte encre souligné d'un filet **lapis** de 1,5 px ; les liens `.md` relatifs sont réécrits en `/docs/<slug>` |
| Lien externe | Idem + « ↗ », `rel="noopener"` |
| Code en ligne | Mono 0,86 em, fond `--surface-3` |
| Bloc de code | Carte : bandeau (nom de fichier, langage, bouton **Copier**), code mono 13 px, défilement horizontal focusable ; **pas de couleur syntaxique** : mots-clés en gras, commentaires en italique `--text-3`, chaînes `--text-2` |
| Schéma ASCII (` ```text ` / ` ```diagram `) | Même carte sur fond `surface-1`, **police à signes de tracé garantis** (`ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono"`, pas Atkinson Mono), `white-space: pre`, défilement horizontal |
| Tableau | Carte à défilement horizontal, `role="region"` + `tabindex="0"` + `aria-label` **unique** ; première colonne en mono ; en-têtes en capitales 12 px |
| Citation / encart | Barre d'encre à gauche, fond `surface-3` ; un `**Note**` ou `**Invariant**` initial devient une étiquette |
| Texte arabe en ligne | `lang="ar" dir="rtl"`, police du Coran, 1,25 em |

En pied de page : « Précédent / Suivant » (ordre du manifeste). En tête : fil d'Ariane, source (`docs/ARCHITECTURE.md`),
date de mise à jour, durée de lecture.

**Notes de version** (`/docs/notes-de-version`). **Chronologie verticale** : sous-titre de mois (Instrument Serif), puis une
entrée par ligne — date en mono dans la marge gauche (au-dessus du titre sur mobile), nœud rond sur un filet de 1,5 px
(plein pour une entrée « majeure »), carte : titre (17 px 700), **étiquettes**, récit, pied (« Demande de fusion n° 66 ↗ », « Décision : ADR-0009 »).
Étiquettes **par la forme et le libellé, pas la couleur** : *Utilisateur* (contour plein, icône personne), *Technique* (contour en tirets,
icône `</>`), *Décision* (fond `surface-3`, icône losange coché). Filtre en pastilles : Tout · Utilisateur · Technique · Décision,
avec compteurs ; l'annonce dit « 5 entrées affichées ».

**Contrat avec la documentation (à tenir par l'agent qui écrit `docs/`)**

- Une entrée = un fichier `docs/notes-de-version/AAAA-MM-JJ-slug.md` :

  ```yaml
  ---
  date: 2026-10-22
  titre: La basmala s'affiche comme un verset
  tags: [utilisateur]          # utilisateur · technique · decision
  pr: 65                       # numéro de la demande de fusion
  adr: 0009                    # facultatif : lien vers une décision
  majeur: false                # facultatif : nœud plein
  ---
  Un paragraphe, deux au plus, en français, à la deuxième personne ou à l'impersonnel.
  ```
- La navigation vient d'un manifeste `docs/_nav.json` (groupes, slug, titre, fichier) ; le slug est le nom de fichier en minuscules
  sans accent, `adr/0009-…` devient `adr/0009`. Seuls les fichiers listés au manifeste sont servis (pas `.artist/`, pas `docs/prompts/`).
- L'application sert `docs/` **tel quel, à la compilation** ; aucune édition en ligne.
- Le lien « Demande de fusion » est construit à partir de `pr` et de l'URL du dépôt (configuration).

## 12. Mes statistiques et stockage

**Mes statistiques** : dans `/compte/statistiques` **et** dans `/performance?vue=moi` (même composant, bascule segmentée
« Tous les testeurs · Moi »). Quatre tuiles (Instrument Serif 40 px) :

| Tuile | Définition |
|---|---|
| **Tests** | Sessions que j'ai lancées et dont l'analyse est terminée ou en échec ; sous-texte « dont 3 en échec » |
| **Audio analysé** | Somme des durées sources de mes sessions terminées (« 12 h 40 min ») |
| **Vitesse moyenne** | Somme des durées sources ÷ somme des durées d'analyse (moyenne pondérée, pas moyenne des rapports) : « ×6,8 » ; « — » sans donnée |
| **Espace utilisé** | Octets conservés pour mes sessions, archivées comprises, face au quota (« 2,3 Go sur 5 Go ») |

Puis la **carte de stockage**, « Ce qui prend le plus de place » (4 plus gros fichiers, lien Voir) et « Vitesse par moteur » (mes
analyses, barres d'une seule teinte, valeur et nombre d'analyses en libellé direct).

**Barre de stockage** (`role="meter"`, `aria-valuemin/max/now` et `aria-valuetext`) : un seul axe, un **repère à 80 %**. Audio = aplat
lapis, **vidéo = hachures** (le motif distingue, pas la couleur). Trois états, toujours **couleur + motif + libellé** :

| État | Seuil | Rendu |
|---|---|---|
| Normal | < 80 % | Lapis, « Les sessions archivées comptent aussi. Seule la suppression définitive libère de l'espace. » |
| **Alerte** | ≥ 80 % | Aplat ambre + points, icône d'alerte, bandeau « Espace presque plein : 4,2 Go sur 5 Go. À partir de 5 Go, tu ne pourras plus importer. Archive puis supprime les gros fichiers dont tu n'as plus besoin. » + « Trier par taille », « Voir les archives » |
| **Plein** | 100 % | Aplat danger, bandeau « Quota atteint : les nouveaux imports sont bloqués. Supprime des sessions archivées pour libérer de la place, ou demande à l'administrateur d'augmenter ton quota. » |

Ailleurs : **menu du compte** (mini-jauge + « 2,3 Go sur 5 Go · détails »), **Nouvel essai** (« Espace utilisé : 2,3 Go sur 5 Go » +
« Taille maximale d'un fichier : 500 Mo »), et l'import est refusé **avant l'envoi** si le fichier dépasse l'espace libre (« Ce fichier
(320 Mo) dépasse ton espace libre (180 Mo). Archive puis supprime des sessions pour libérer de la place. »). Une analyse déjà en cours
n'est jamais interrompue par le quota.

**Performance globale** gagne une carte « Stockage du serveur » (même barre, « 38,4 Go sur 120 Go · 142 fichiers · 12 testeurs ») visible
de tous, sans détail par compte (le détail par testeur est réservé à l'administrateur, hors de ce lot). Le tableau « Dernières
analyses » gagne une colonne **Testeur** et rappelle : « Seules les sessions globales sont nommées ici. Les sessions privées comptent
dans les moyennes, sans nom ni propriétaire. »

## 13. Micro-textes (français, tutoiement, sans jargon)

| Où | Texte |
|---|---|
| Connexion, titre / aide | « Se connecter » / « Entre ton pseudonyme et ton mot de passe. » |
| Inscription, titre / aide | « Créer un compte testeur » / « Un pseudonyme et un mot de passe suffisent. Pas d'e-mail. » |
| Note de visibilité | « Tes audios sont visibles de tous les testeurs avec leurs résultats, sauf ceux que tu marques comme privés. » |
| Menu du compte | « Préférences · Mes statistiques · Se déconnecter » |
| Pastille d'enregistrement | « Enregistrement… » · « Enregistré » · « Non enregistré » + « Réessayer » |
| Barre de gauche | « File d'analyse · Favoris · Récentes · Voir toutes les sessions » |
| Page Sessions | « Rechercher… » (nom accessible : « Rechercher une session par nom ») · « Trier par » · « Charger 20 de plus » |
| Sélection | « 3 sélectionnées » · « Favoris » · « Archiver » · « Restaurer » · « Portée » · « Supprimer… » · « Annuler » |
| Toasts | « 3 sessions archivées » + « Annuler » · « Session restaurée » · « 2 sessions rendues globales » |
| Portée | « Qui peut voir cet essai ? » · « Global · par défaut » · « Privé » · « Toi seul. » |
| Renommer | « Renommer » · « Entrée valider · Échap annuler » · « Utiliser comme nom » · « Nom par défaut rétabli » |
| Lecteur | « Reculer de 5 secondes » · « Avancer de 5 secondes » |
| Documentation | « Filtrer les documents… » · « Sur cette page » · « Demande de fusion n° 66 » |
| Stockage | « Espace utilisé » · « Espace presque plein » · « Quota atteint » · « Libre » |

Dates : « 14:02 » (aujourd'hui), « hier 14:02 », « 20 oct. », année seulement si ce n'est pas l'année en cours ; date complète en
info-bulle. Tailles : « 4,2 Mo », « 2,3 Go » (virgule décimale, jamais « MB »). Durées : « 3:04 », « 1:12:08 ».

## 14. Tokens, composants et icônes ajoutés

- **Tokens** : `--w-page: 1240px`, `--w-docs-nav: 280px`, `--w-docs-toc: 224px` (déclarés en tête de `phase2.css` ; à coller dans
  `tokens.css`). Aucune couleur, aucun rayon, aucune ombre nouveaux.
- **Composants** (classes de `phase2.css`) : navigation à liens (`.nav a`), avatar (`.av`, `--sm`, `--lg`), bouton de compte et menu
  (`.acct-btn`, `.menu`, `.menu-item`, feuille basse sur mobile), badge de portée (`.badge--global`, `--private`), favori
  (`.fav`), titre renommable (`.title-row`, `.title-input`, `.rename-btn`), ligne de session compacte (`.sess.is-compact`), carte
  radio (`.radio-card`), formulaires d'authentification (`.auth`, `.pw`, `.strength`, `.form-alert`), case à cocher (`.check`),
  contrôle segmenté (`.seg-ctl`), pastille de filtre à menu (`.fbtn`, `.fpop`), ligne et carte de session (`.srow`), barre de
  sélection (`.selbar`), états vides (`.state-box`, `.skel`), documentation (`.docs`, `.prose`, `.codebox`, `.rn`), préférences
  (`.setgroup`, `.srow2`, `.fontpick`, `.autosave`), stockage (`.meter`, `.meter-card`), infobulle d'icône (`[data-tip]`).
- **Icônes** (37 nouvelles, dessinées pour le projet, grille 24, trait 1,6) : voir `prototype/icones.html` et
  `captures/phase2-icones.png`. Reculer/avancer de 5 s décrits au §10. Aucun paquet interdit (`interdits.json`).
- **Images** : aucune photo (outil de travail, cf. `atelier-direction.md` §15) ; chaque page porte une illustration vectorielle
  dessinée (onde + losange, forme d'onde à intervalles, basmala du corpus). Aucune ressource externe à créditer. Texte arabe de démonstration :
  Tanzil (CC BY 3.0), traductions QuranEnc, non modifiés.

## 15. Accessibilité et critères vérifiables (pour Ibrahima et Cherif QA)

- **Contrastes** : ceux des tokens (texte ≥ 4,5:1, non-texte ≥ 3:1) dans les deux thèmes ; l'état actif d'une pastille (`.chip .n`)
  garde une opacité pleine pour tenir 4,5:1 en clair.
- **Focus** : anneau 2 px partout ; ordre logique ; menus (`role="menu"`, flèches, Échap, retour du focus), tiroirs avec focus piégé,
  contrôles segmentés et cartes radio en `role="radiogroup"`/`radio` avec flèches.
- **Annonces `aria-live="polite"`** : pastille d'enregistrement, résultats de recherche, « Charger plus », favori, portée, renommage,
  saut de 5 s, filtre des notes de version. Région `role="status"` **toujours présente** dans le DOM.
- **Listes** : la page Sessions est une liste de liens (pas un `table` ARIA) ; chaque cellule porte son libellé masqué (« Durée : ») ;
  les titres de groupe sont des `h2` (un seul `h1`) ; colonne triée = `aria-current="true"` sur un bouton.
- **Cibles** : ≥ 44×44 au tactile (étoile, ⋯, cases, œil du mot de passe, crayon, ±5 s) ; aucune barre de défilement horizontale à
  375 px (seuls les tableaux et blocs de code défilent, et sont focusables avec un nom unique).
- **Couleur seule interdite** : portée (icône + libellé), états de stockage (motif + icône + libellé), étiquettes de version
  (contour + icône + libellé), vidéo (hachures).
- **Mouvement** : `transform` et `opacity` seulement ; `prefers-reduced-motion` coupe pulsations, échelle de l'étoile, pastille.
- **Vérifié sur le prototype** (axe-core, WCAG 2.2 AA + bonnes pratiques, 21 états de page × 4 configurations : 1440 et 375, sombre
  et clair) : 0 violation sur les composants de la phase 2. Reste la taille de cible des segments de l'onde (13 px de large),
  **héritée de la phase 1** et déjà doublée par la liste des intervalles.
- **Pas de scroll horizontal** à 375 px sur toutes les pages (mesuré). Console : aucune erreur JavaScript ; le chargement des
  polices Google du prototype est le seul accès réseau, absent en production (`next/font`).

## 16. Maquettes textuelles (mobile d'abord) et états de démonstration

```
CONNEXION 375                     SESSIONS 375                        BARRE GAUCHE (tiroir)
[Atelier]              [thème]        [Atelier]            [+] [C]        Sessions                ⟳ ✕
ATELIER DE REVUE                  Sessions                            ┌ 1 en cours · 1 en attente ┐
Écoute, compare, corrige.         52 sessions · 26 à toi · 2,5 Go     FILE D'ANALYSE
[≈≈ onde + 3 intervalles ≈≈]      [ Rechercher…       ] [Sélect.]    ◌ Lot1 12                62 %
────────────────────────          (Toutes 52)(Mes 26)(Partag…→        ③ Conf ramadan nuit 3    14:31
Se connecter                      (État ▾)(Moteur ▾)(Date ▾)→         FAVORIS                     3
Pseudonyme [____________]         52 sessions        Trier par [▾]    ✓ Recitation fatiha…    12:20
Mot de passe [______ oeil]         ─ Aujourd'hui · 8 ─                 RÉCENTES              8 sur 52
[x] Rester connecté 30 jours      ◌ Lot1 12            ☆  ⋯           (cadenas) Enregistrement… •    17:55
[ Se connecter ]                    Analyse en cours · ≈ 2 min        ✓ Khutba vendredi •     14:02
Pas de compte ? Créer un compte     ▮▮ 18:42 · 19 Mo · Cascade        [ Voir toutes les sessions 52 ]
```

États de démonstration du prototype (paramètres d'URL) : `sessions.html?etat=chargement|vide|aucun|erreur`,
`?portee=arch`, `?ouvert=date` (fenêtre de filtre ouverte), `?sel=3,4,6`, `?select=1&sel=3,4` (mode sélection mobile) ;
`login.html?etat=creds|limit|sending|down` ; `register.html?etat=first|taken|short|sending|down` ; `compte.html?stockage=warn|full#statistiques` ;
`index.html#view=perf&mine=1&stockage=warn`, `#view=new`, `#menu=1`, `#scope=1`, `#rename=1`, `#owner=amina` (session d'un autre testeur,
lecture seule), `#drawer=left`, `#theme=light`. Un sélecteur « Prototype » en pied de page change aussi l'état sans URL.

## 17. Correspondance avec le code et données attendues par l'interface

| Écran | Fichiers à créer ou modifier (`web/app`) |
|---|---|
| Connexion, inscription | `login/page.tsx`, `register/page.tsx` (remplacent `access/`), composants `password-field.tsx`, `strength-meter.tsx` ; `auth.css` |
| En-tête, menu compte | `atelier/header.tsx` (onglets Sessions / Documentation, menu), `account-menu.tsx` ; `menus.css` |
| Barre allégée | `atelier/sessions-panel.tsx` (groupes File / Favoris / Récentes, ligne compacte) |
| En-tête de session | `atelier/session-head.tsx` (titre renommable, étoile, portée, « Contenu détecté », archiver) |
| Lecteur | `atelier/console.tsx`, `atelier/icons.tsx` (`SeekBack`, `SeekForward`) |
| Nouvel essai | `atelier/new-trial.tsx` (portée, quota) |
| Page Sessions | `sessions/page.tsx`, `sessions/session-row.tsx`, `sessions/filters.tsx`, `sessions/selection-bar.tsx` ; `sessions-page.css` |
| Documentation | `docs/[...slug]/page.tsx`, `docs/markdown.tsx`, `docs/notes-de-version/page.tsx` ; `docs.css` |
| Compte | `compte/page.tsx`, `compte/statistiques`, `compte/securite`, `lib/preferences.ts` (store + autosave) ; `account.css` |
| Performance | `atelier/perf-view.tsx` (bascule Global / Moi, carte stockage, colonne Testeur) |
| Revue humaine | `atelier/tester-bar.tsx` : le relecteur **est** le compte connecté (plus de saisie libre) |

Champs dont l'interface a besoin (nommage libre, à caler avec Ibrahima) : par session — `owner`, `scope` (`global`/`private`), `name`,
`name_source` (`auto`/`user`), `detected` (plages), `size_bytes`, `media_kind`, `engine`, `created_at` ; **par utilisateur et par
session** — `favorite`, `archived`, `seen_at` (non lu), `last_opened_at` ; par utilisateur — `username`, `role`, `created_at`,
`preferences` (JSON des onze clés), `notes_seen_at`, `quota_bytes`. Points d'API : liste paginée à curseur avec filtres (§6), `PATCH` de
session (nom, portée), `PATCH` de l'état utilisateur de session, `PATCH`/`GET` des préférences, comptage par portée.

## 18. Risques et points ouverts

1. **Dérive des données** : les signalements existants portent un pseudonyme libre (`tester`). Les conserver tels quels ; les nouveaux
   portent le pseudonyme du compte.
2. **Hafs (KFGQPC)** : jamais servi à un testeur distant ; la carte reste grisée tant qu'aucun accord écrit n'existe.
3. **Fuseau et « Aujourd'hui »** : calculés dans le navigateur ; le serveur reçoit des bornes ISO, jamais des mots.
4. **État dans l'URL** : filtres, tri et portée de `/sessions` sont partageables et survivent au bouton Précédent.
5. **Base du quota** : décider si les fichiers dérivés (WAV extrait, traces) comptent ; l'écran affiche ce que le serveur décompte, pas plus.
6. **Suppression de compte** : bouton présenté dans Sécurité, mais l'effet sur les sessions globales (supprimées ?) reste à décider avant de l'activer.
7. **Réinitialisation de mot de passe** par l'administrateur : pas d'écran dans ce lot ; prévoir une page « Comptes » (pseudo, date, espace, réinitialiser).
8. **Inscription publique** : limitation de débit par adresse, champ piège invisible, interrupteur de fermeture (arbitrage C).
9. **Notification de nouveautés** : le point sur « Documentation » demande `notes_seen_at` ; sans lui, retirer le point plutôt que de le laisser fixe.
10. **Performance de la page Sessions** : le curseur serveur évite de tout charger ; ne pas virtualiser tant que la liste reste à 20 par lot.

## 19. Registre des directions artistiques

La direction « Atelier de revue — Encre & lapis » est **validée et implémentée** : passer sa note du coffre de *Proposée* à *Adoptée*.
Ajouter l'extension « Phase 2 multi-testeurs » : références ouvertes (GitHub Issues, Linear Changelog, Stripe Docs), 37 icônes
dessinées, aucun nouveau token de couleur, aucune police nouvelle. **Non fait ici** : `vault_cli.py` introuvable
(`ARTIST_SKILLS_ROOT` non défini dans cette session) et le serveur Obsidian ne répondait pas (ECONNREFUSED) ; à reprendre dès que le
coffre est joignable, sans bloquer la livraison.
