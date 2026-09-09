/*
  config.js — Configuration publique de l'app
  ----------------------------------------------
  Le Client ID OAuth n'est PAS un secret : sa sécurité vient des origines
  JavaScript autorisées configurées côté Google Cloud (voir
  google-oauth-setup.md), pas de sa confidentialité ici. Il peut rester
  en clair dans un fichier versionné sur un dépôt public.
*/

export const GOOGLE_CLIENT_ID =
  "445560845748-hrtgv126t22f0cmefpr2l5ksci70pohu.apps.googleusercontent.com";

// Scope volontairement minimal : accès uniquement aux fichiers que l'app
// crée ou que l'utilisateur lui ouvre explicitement — jamais à l'ensemble
// du Drive de l'utilisateur.
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";
