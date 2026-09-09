/*
  config.js — Configuration publique de l'app
  ----------------------------------------------
  Aucune valeur ici n'est un secret : le Client ID OAuth et l'Identity
  Pool ID sont des identifiants publics, leur sécurité vient des
  restrictions configurées côté Google Cloud / AWS (origines autorisées,
  scope des rôles IAM), pas de leur confidentialité. Tout peut rester en
  clair dans un fichier versionné sur un dépôt public.
*/

export const GOOGLE_CLIENT_ID =
  "445560845748-hrtgv126t22f0cmefpr2l5ksci70pohu.apps.googleusercontent.com";

// Scope volontairement minimal : accès uniquement aux fichiers que l'app
// crée ou que l'utilisateur lui ouvre explicitement — jamais à l'ensemble
// du Drive de l'utilisateur.
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";

// À remplir une fois l'Identity Pool créé — voir aws-cognito-setup.md.
export const COGNITO_IDENTITY_POOL_ID = "us-east-1:ff3c14ce-8f42-4541-bab8-ca51fa3f62b0"; // ex. "us-east-1:xxxxxxxx-xxxx-..."
export const AWS_REGION = "us-east-1";
