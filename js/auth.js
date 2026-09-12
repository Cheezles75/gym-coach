/*
  auth.js — Authentification Google (OAuth2, jeton d'accès uniquement)
  ---------------------------------------------------------------------------
  Un seul jeton, un seul flux : le jeton d'accès OAuth2 (scope drive.file
  + email), qui sert à la fois pour Sheets/Drive côté navigateur ET,
  envoyé en Bearer token, pour prouver ton identité à la fonction Lambda
  (qui le revérifie de son côté auprès de Google avant tout appel AWS —
  voir aws-lambda-setup.md).

  Ancienne version : ce fichier gérait aussi un second jeton ("jeton
  d'identité" via le One Tap Google) pour fédérer l'authentification vers
  un Cognito Identity Pool. Abandonné : le One Tap s'est montré peu
  fiable en usage réel (temps de repos anti-spam après un échec,
  nécessitant une déconnexion complète pour réessayer), et l'architecture
  a basculé vers une Lambda qui revérifie simplement ce même jeton
  d'accès côté serveur — plus besoin d'un second flux Google du tout.

  Le jeton vit en mémoire uniquement, jamais persisté. Renouvellement
  proactif ~5 min avant expiration, en tâche de fond, sans jamais
  recharger la page.
*/

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from "./config.js";

const MARGE_RENOUVELLEMENT_MS = 5 * 60 * 1000;

let clientJeton = null;      // instance Google Identity Services (OAuth2)
let jetonAccesActuel = null; // { accessToken, expiresAt, email } | null
let minuteurRenouvellement = null;

/**
 * Diffuse un changement d'état de connexion Google au reste de l'app —
 * piloté par app.js pour l'indicateur "Google".
 * @param {"connecte" | "deconnecte" | "erreur"} etat
 */
function notifierChangementEtat(etat) {
  document.dispatchEvent(
    new CustomEvent("gymcoach:auth-changed", { detail: { etat } })
  );
}

function planifierRenouvellement(expiresInSecondes) {
  clearTimeout(minuteurRenouvellement);
  const delai = Math.max(expiresInSecondes * 1000 - MARGE_RENOUVELLEMENT_MS, 10_000);

  minuteurRenouvellement = setTimeout(() => {
    clientJeton.requestAccessToken();
  }, delai);
}

/**
 * Récupère l'email associé au jeton d'accès (affichage local uniquement
 * — la Lambda revérifie de toute façon ce jeton de son côté, ceci ne
 * sert qu'à afficher "Connecté en tant que..." si besoin plus tard).
 */
async function recupererEmailCompte(accessToken) {
  try {
    const reponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!reponse.ok) return null;
    const donnees = await reponse.json();
    return donnees.email ?? null;
  } catch (erreur) {
    console.warn("[GymCoach] Impossible de récupérer l'email du compte :", erreur);
    return null;
  }
}

async function surReponseJetonAcces(reponse) {
  if (reponse.error) {
    console.warn("[GymCoach] Échec d'obtention du jeton d'accès Google :", reponse.error);
    jetonAccesActuel = null;
    notifierChangementEtat("erreur");
    return;
  }

  const email = await recupererEmailCompte(reponse.access_token);

  jetonAccesActuel = {
    accessToken: reponse.access_token,
    expiresAt: Date.now() + reponse.expires_in * 1000,
    email,
  };

  planifierRenouvellement(reponse.expires_in);
  notifierChangementEtat("connecte");
}

/**
 * Initialise le client OAuth2. À appeler une seule fois, au démarrage.
 */
export function initAuth() {
  clientJeton = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: surReponseJetonAcces,
  });
}

/**
 * Déclenche la connexion Google. Doit être appelée depuis un clic
 * utilisateur (les navigateurs bloquent les popups hors geste utilisateur).
 */
export function login() {
  clientJeton.requestAccessToken();
}

/**
 * Révoque le jeton auprès de Google et efface l'état local.
 */
export function logout() {
  if (jetonAccesActuel) {
    google.accounts.oauth2.revoke(jetonAccesActuel.accessToken);
  }
  clearTimeout(minuteurRenouvellement);
  jetonAccesActuel = null;
  notifierChangementEtat("deconnecte");
}

/**
 * Jeton d'accès valide actuel, ou null si non connecté / expiré. C'est
 * ce même jeton qui sert pour Drive/Sheets ET, en Bearer token, pour
 * les appels à la Lambda (voir lambda.js).
 */
export function getAccessToken() {
  if (!jetonAccesActuel) return null;
  if (Date.now() >= jetonAccesActuel.expiresAt) return null;
  return jetonAccesActuel.accessToken;
}

export function estConnecte() {
  return getAccessToken() !== null;
}
