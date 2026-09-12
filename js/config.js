/*
  config.js — Configuration publique de l'app
  ----------------------------------------------
  Aucune valeur ici n'est un secret : le Client ID OAuth et l'URL de la
  fonction Lambda sont des identifiants publics, leur sécurité vient des
  restrictions configurées côté Google Cloud / AWS (origines autorisées,
  vérification du jeton dans la Lambda), pas de leur confidentialité.
  Tout peut rester en clair dans un fichier versionné sur un dépôt public.
*/

export const GOOGLE_CLIENT_ID =
  "445560845748-hrtgv126t22f0cmefpr2l5ksci70pohu.apps.googleusercontent.com";

// Scope minimal : "drive.file" limite l'app aux fichiers qu'elle crée ou
// que l'utilisateur lui ouvre explicitement. "email" identifie le compte
// (nécessaire pour que la Lambda vérifie que c'est bien toi) — voir
// aws-lambda-setup.md.
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file openid email";

// À remplir une fois la fonction Lambda créée — voir aws-lambda-setup.md.
// Format : https://xxxxxxxxxxxxxxxxxxxxxxxxxx.lambda-url.us-east-1.on.aws/
export const LAMBDA_FUNCTION_URL = "https://r7lladok5qept7hd7apvfermly0iztrx.lambda-url.us-east-1.on.aws/";

// Numéro de version affiché discrètement dans la barre de statut (voir
// index.html/app.js). Schéma 0.x tant qu'on est en développement ; on
// passera à 1.y le jour où une version couvrant le périmètre complet de
// la V1 tourne en usage réel. À incrémenter à chaque déploiement, EN
// MÊME TEMPS que CACHE_VERSION dans service-worker.js — les deux doivent
// toujours avancer ensemble.
export const APP_VERSION = "0.8";
