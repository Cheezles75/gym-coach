/*
  auth.js — Authentification Google (Identity Services)
  ---------------------------------------------------------------------------
  Deux jetons Google bien distincts, pour deux usages différents :

  - Le JETON D'ACCÈS (OAuth2, modèle "token client", scope drive.file) :
    sert à appeler directement les API Google Sheets/Drive. C'est celui
    qu'on avait déjà mis en place.
  - Le JETON D'IDENTITÉ (ID token, "Sign in with Google") : un JWT qui
    prouve qui est l'utilisateur. C'est CELUI-LÀ que Cognito Identity
    Pool exige pour fédérer l'identité Google vers des accès AWS — le
    jeton d'accès ne fonctionne pas pour ça, AWS le refuse.

  Les deux vivent en mémoire uniquement, jamais persistés. Le jeton
  d'accès est renouvelé proactivement en tâche de fond (voir plus bas) ;
  le jeton d'identité est redemandé à la volée quand un module (cognito.js)
  en a besoin, plutôt que renouvelé silencieusement en arrière-plan —
  plus simple et tout aussi fiable, puisque son seul usage est ponctuel
  (obtenir des accès AWS), pas un flux continu comme Sheets/Drive.
*/

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from "./config.js";

// Renouvelle le jeton d'accès 5 minutes avant son expiration réelle,
// pour ne jamais risquer qu'un appel Sheets/Drive parte avec un jeton expiré.
const MARGE_RENOUVELLEMENT_MS = 5 * 60 * 1000;

let clientJeton = null;      // instance Google Identity Services (OAuth2)
let jetonAccesActuel = null; // { accessToken, expiresAt } | null
let minuteurRenouvellement = null;

let jetonIdActuel = null;    // { idToken, expiresAt } | null
let resolveProchainJetonId = null; // callback en attente d'un jeton d'identité frais

/**
 * Diffuse un changement d'état de connexion Google (jeton d'accès) au
 * reste de l'app — piloté par app.js pour l'indicateur "Google".
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

function surReponseJetonAcces(reponse) {
  if (reponse.error) {
    console.warn("[GymCoach] Échec d'obtention du jeton d'accès Google :", reponse.error);
    jetonAccesActuel = null;
    notifierChangementEtat("erreur");
    return;
  }

  jetonAccesActuel = {
    accessToken: reponse.access_token,
    expiresAt: Date.now() + reponse.expires_in * 1000,
  };

  planifierRenouvellement(reponse.expires_in);
  notifierChangementEtat("connecte");
}

/**
 * Lit la date d'expiration (claim "exp") d'un JWT sans dépendance externe.
 * On ne vérifie pas la signature ici : ce n'est pas notre rôle (c'est
 * Cognito/AWS qui la vérifiera à réception), on lit juste une info
 * publique du jeton pour savoir quand le rafraîchir.
 */
function expirationDuJwt(jwt) {
  const partieCentrale = jwt.split(".")[1];
  const donnees = JSON.parse(atob(partieCentrale.replace(/-/g, "+").replace(/_/g, "/")));
  return donnees.exp * 1000;
}

function surReponseJetonId(reponse) {
  if (!reponse || !reponse.credential) {
    console.warn("[GymCoach] Aucun jeton d'identité Google reçu (One Tap non confirmé).");
    if (resolveProchainJetonId) {
      resolveProchainJetonId(null);
      resolveProchainJetonId = null;
    }
    return;
  }

  jetonIdActuel = {
    idToken: reponse.credential,
    expiresAt: expirationDuJwt(reponse.credential),
  };

  if (resolveProchainJetonId) {
    resolveProchainJetonId(jetonIdActuel.idToken);
    resolveProchainJetonId = null;
  }
}

/**
 * Initialise les deux clients d'authentification Google. À appeler une
 * seule fois, au démarrage de l'app, avant tout appel à login().
 */
export function initAuth() {
  clientJeton = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: surReponseJetonAcces,
  });

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: surReponseJetonId,
  });
}

/**
 * Déclenche la connexion Google pour Drive/Sheets (jeton d'accès).
 * Le jeton d'identité (pour Cognito) se demande séparément via
 * getIdToken() — voir app.js, qui orchestre les deux depuis le même clic.
 */
export function login() {
  clientJeton.requestAccessToken();
}

/**
 * Révoque le jeton d'accès auprès de Google et efface tout l'état local.
 */
export function logout() {
  if (jetonAccesActuel) {
    google.accounts.oauth2.revoke(jetonAccesActuel.accessToken);
  }
  clearTimeout(minuteurRenouvellement);
  jetonAccesActuel = null;
  jetonIdActuel = null;
  notifierChangementEtat("deconnecte");
}

/**
 * Jeton d'accès valide actuel, ou null si non connecté / expiré.
 * Ne déclenche jamais de popup — c'est le rôle exclusif de login().
 */
export function getAccessToken() {
  if (!jetonAccesActuel) return null;
  if (Date.now() >= jetonAccesActuel.expiresAt) return null;
  return jetonAccesActuel.accessToken;
}

export function estConnecte() {
  return getAccessToken() !== null;
}

/**
 * Jeton d'identité valide (pour Cognito), en le redemandant à Google si
 * besoin. Contrairement à getAccessToken(), cette fonction PEUT déclencher
 * une interaction visible (One Tap) si aucun jeton frais n'est disponible
 * — à n'appeler que suite à une action explicite de l'utilisateur
 * (ex. juste après login(), ou avant un appel AWS ponctuel).
 *
 * @returns {Promise<string|null>} le jeton d'identité, ou null si Google
 *   n'a pas pu le confirmer (One Tap fermé, session expirée...).
 */
export function getIdToken() {
  const margeMs = 60 * 1000;
  if (jetonIdActuel && Date.now() < jetonIdActuel.expiresAt - margeMs) {
    return Promise.resolve(jetonIdActuel.idToken);
  }

  return new Promise((resolve) => {
    resolveProchainJetonId = resolve;
    google.accounts.id.prompt();
  });
}
