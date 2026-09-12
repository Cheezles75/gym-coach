# GymCoach

App personnelle de suivi de musculation (routines, séances, progression).
Voir le cahier des charges complet (`specifications.md`) et le schéma de
données (`schema-donnees.md`) dans le Drive du projet pour le contexte.

## Choix techniques de ce scaffolding

- **Vanilla JS (modules ES), pas de framework, pas d'étape de build.**
  Cohérent avec l'hébergement gratuit sur GitHub Pages : on pousse le
  code tel quel, aucun pipeline de compilation à maintenir. On pourra
  introduire un bundler plus tard si le projet le justifie, mais rien
  ne l'impose à ce stade.
- **PWA installable** : `manifest.webmanifest` + `service-worker.js`
  mettent en cache l'app shell (HTML/CSS/JS) pour un chargement rapide
  et un minimum de résilience hors-ligne. Les données (Sheets, AWS) ne
  sont jamais mises en cache par le service worker — c'est le rôle
  d'IndexedDB (étape suivante).
- **`.nojekyll`** : indispensable sur GitHub Pages pour que les fichiers
  et dossiers ne soient pas filtrés par le traitement Jekyll par défaut
  (important dès qu'on ajoutera `data/exercices_complet.json`, etc.).

## Arborescence

```
gymcoach/
├── index.html              # Page d'accueil (tableau de bord)
├── manifest.webmanifest    # Manifeste PWA
├── service-worker.js       # Cache de l'app shell
├── .nojekyll                # Désactive le traitement Jekyll de GitHub Pages
├── css/
│   ├── variables.css       # Jetons de design (couleurs, typo, espacements)
│   ├── reset.css           # Remise à zéro minimale + accessibilité de base
│   ├── layout.css          # Structure responsive (sidebar / tabbar)
│   └── components.css      # Composants : barre de statut, cartes, boutons...
├── js/
│   └── app.js               # Point d'entrée : service worker + erreurs globales
├── icons/                   # Icônes PWA (à ajouter — voir ci-dessous)
└── data/                    # Référentiel embarqué (à ajouter — voir ci-dessous)
```

## À faire avant le premier déploiement

1. ~~Icônes~~ — ✅ fait. Motif "Équilibre" (deux arcs + point central,
   corps/esprit), fond encre, accent mousse. `icon-192.png`,
   `icon-512.png` et `icon-maskable-512.png` (marge de sécurité 82%,
   vérifiée par simulation de découpage circulaire) sont dans `icons/`.
2. **Référentiel d'exercices** : copier `exercices_complet.json` et
   `i18n_complet.json` dans `data/`. Fichiers volumineux, à récupérer
   depuis le Drive du projet ou l'upload direct au moment de l'étape
   "recherche d'exercices".

## Déployer sur GitHub Pages

Pas besoin de workflow GitHub Actions pour un site statique aussi simple —
GitHub Pages sait servir un dossier directement :

1. Créer un dépôt GitHub (peut rester privé — GitHub Pages fonctionne
   aussi sur les dépôts privés avec un compte gratuit, mais le site
   publié reste alors accessible à quiconque a l'URL, comme tout site
   Pages : à garder en tête vu que c'est un usage strictement personnel).
2. Pousser le contenu de ce dossier `gymcoach/` à la racine du dépôt
   (branche `main`).
3. Dans **Settings → Pages** du dépôt, choisir la source
   *Deploy from a branch*, branche `main`, dossier `/ (root)`.
4. L'app sera servie sur `https://<ton-utilisateur>.github.io/<nom-du-depot>/`.

Pas de secret, pas de clé, rien à configurer côté build : c'est un
dossier statique servi tel quel.

## Authentification Google

✅ Fait — `js/auth.js` + `js/config.js`. Un seul jeton (OAuth2, scope
`drive.file` + `email`), utilisé à la fois pour Sheets/Drive côté
navigateur et, en Bearer token, pour la fonction Lambda. Géré en mémoire,
renouvelé proactivement en tâche de fond. Version simplifiée par rapport
à une itération précédente qui utilisait aussi un jeton d'identité
séparé (One Tap) pour Cognito — abandonné, voir plus bas.

Client ID et détails de configuration : voir `google-oauth-setup.md`
(dossier racine du projet, hors dépôt de code).

## Backend AWS (Lambda — remplace Cognito)

✅ Fait — `js/lambda.js`. Le jeton d'accès Google part en Bearer token
vers une fonction Lambda, qui le revérifie côté serveur (endpoint
`tokeninfo` de Google) avant d'assumer son propre rôle IAM d'exécution
pour parler à Bedrock/Polly/Transcribe. Aucun secret AWS, aucun échange
de jeton, ne transite plus par le navigateur.

**Changement d'architecture (11/09/2026)** : l'approche précédente
(Cognito Identity Pool + fédération Google) est abandonnée — le "One
Tap" Google nécessaire pour obtenir un jeton d'identité s'est montré
peu fiable en usage réel (temps de repos anti-spam après un échec,
demandant une déconnexion complète pour réessayer). La Lambda est plus
simple, moins chère à l'usage (4×2h/semaine tient largement dans le
free tier permanent de Lambda), et n'a même plus besoin d'un second
jeton Google.

Configuration complète : voir `aws-lambda-setup.md` et
`lambda-gymcoach-index.mjs` (dossier racine du projet).

## Prochaine étape

Une fois `LAMBDA_FUNCTION_URL` renseigné dans `js/config.js` et testé :
écrire les vrais appels Bedrock/Polly/Transcribe dans la Lambda (le
squelette actuel ne fait qu'une vérification de connectivité).
