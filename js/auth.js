/*
  auth.js — Authentification Google (Identity Services, modèle "token client")
  ---------------------------------------------------------------------------
  Principe central, décidé ensemble : le jeton d'accès vit en mémoire
  uniquement, jamais persisté sur disque. Il est renouvelé de manière
  proactive, en tâche de fond, sans jamais recharger la page — ce module
  ne fait donc courir aucun risque aux données déjà écrites en IndexedDB
  par le reste de l'app (voir les échanges sur la durée de vie du jeton).

  Ce module ne sait rien de ce que l'app fait du jeton : il expose juste
  getAccessToken() aux futurs modules Sheets/Drive, et diffuse l'état de
  connexion via un évènement DOM pour que l'UI (et d'autres modules)
  puissent réagir sans dépendance directe entre fichiers.
*/

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from "./config.js";

// Renouvelle le jeton 5 minutes avant son expiration réelle, pour ne
// jamais risquer qu'un appel Sheets/Drive parte avec un jeton expiré.
const MARGE_RENOUVELLEMENT_MS = 5 * 60 * 1000;

let clientJeton = null;   // instance Google Identity Services
let jetonActuel = null;   // { accessToken, expiresAt } | null
let minuteurRenouvellement = null;

/**
 * Diffuse un changement d'état de connexion au reste de l'app.
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
    // Tentative silencieuse : Google Identity Services n'affiche une
    // interface que si la session Google ne peut pas être confirmée
    // sans interaction (cookies tiers bloqués, session expirée...).
    clientJeton.requestAccessToken();
  }, delai);
}

function surReponseJeton(reponse) {
  if (reponse.error) {
    console.warn("[GymCoach] Échec d'obtention du jeton Google :", reponse.error);
    jetonActuel = null;
    notifierChangementEtat("erreur");
    return;
  }

  jetonActuel = {
    accessToken: reponse.access_token,
    expiresAt: Date.now() + reponse.expires_in * 1000,
  };

  planifierRenouvellement(reponse.expires_in);
  notifierChangementEtat("connecte");
}

/**
 * Initialise le client d'authentification. À appeler une seule fois,
 * au démarrage de l'app, avant tout appel à login().
 */
export function initAuth() {
  clientJeton = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: surReponseJeton,
  });
}

/**
 * Déclenche la connexion. Doit être appelée depuis un clic utilisateur :
 * les navigateurs bloquent les popups qui ne partent pas d'un geste.
 */
export function login() {
  clientJeton.requestAccessToken();
}

/**
 * Révoque le jeton auprès de Google et efface l'état local.
 */
export function logout() {
  if (jetonActuel) {
    google.accounts.oauth2.revoke(jetonActuel.accessToken);
  }
  clearTimeout(minuteurRenouvellement);
  jetonActuel = null;
  notifierChangementEtat("deconnecte");
}

/**
 * Jeton valide actuel, ou null si non connecté / expiré.
 * Ne déclenche jamais de popup — c'est le rôle exclusif de login().
 */
export function getAccessToken() {
  if (!jetonActuel) return null;
  if (Date.now() >= jetonActuel.expiresAt) return null;
  return jetonActuel.accessToken;
}

export function estConnecte() {
  return getAccessToken() !== null;
}
