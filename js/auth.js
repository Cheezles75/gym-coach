/*
  auth.js — Authentification Google (Identity Services)
  ---------------------------------------------------------------------------
  Deux jetons Google bien distincts, pour deux usages différents :

  - Le JETON D'ACCÈS (OAuth2, modèle "token client", scope drive.file) :
    sert à appeler directement les API Google Sheets/Drive.
  - Le JETON D'IDENTITÉ (ID token, "Sign in with Google") : un JWT qui
    prouve qui est l'utilisateur. C'est CELUI-LÀ que Cognito Identity
    Pool exige pour fédérer l'identité Google vers des accès AWS — le
    jeton d'accès ne fonctionne pas pour ça, AWS le refuse.

  Les deux vivent en mémoire uniquement, jamais persistés. Le jeton
  d'accès est renouvelé proactivement en tâche de fond ; le jeton
  d'identité est redemandé à la volée quand cognito.js en a besoin.

  PROBLÈME CONSTATÉ À L'USAGE ET CORRIGÉ ICI : le sélecteur de compte du
  "One Tap" Google (jeton d'identité) est indépendant de celui utilisé
  pour le jeton d'accès — si plusieurs comptes Google sont connectés dans
  le navigateur, rien ne garantit qu'il choisisse le même compte que
  Drive/Sheets. Deux mesures pour empêcher ça :
  1. On mémorise l'email du compte ayant autorisé Drive (via l'endpoint
     userinfo), et on le passe en `login_hint` au One Tap pour orienter
     son choix par défaut vers ce compte.
  2. Après coup, on vérifie que l'email du jeton d'identité reçu
     correspond bien à celui du jeton d'accès — sinon, on rejette le
     jeton d'identité plutôt que de fédérer AWS sur le mauvais compte.
*/

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from "./config.js";

const MARGE_RENOUVELLEMENT_MS = 5 * 60 * 1000;

let clientJeton = null;      // instance Google Identity Services (OAuth2)
let jetonAccesActuel = null; // { accessToken, expiresAt, email } | null
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
    clientJeton.requestAccessToken();
  }, delai);
}

/**
 * Décode le corps (payload) d'un JWT sans dépendance externe. On ne
 * vérifie pas la signature ici — ce n'est pas notre rôle, c'est
 * Cognito/AWS qui la vérifie à réception — on lit juste des claims
 * publics du jeton (exp, email...).
 */
function decoderPayloadJwt(jwt) {
  const partieCentrale = jwt.split(".")[1];
  return JSON.parse(atob(partieCentrale.replace(/-/g, "+").replace(/_/g, "/")));
}

/**
 * Récupère l'email associé au jeton d'accès, pour pouvoir orienter le
 * One Tap vers le même compte (voir en-tête du fichier).
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

function surReponseJetonId(reponse) {
  if (!reponse || !reponse.credential) {
    console.warn("[GymCoach] Aucun jeton d'identité Google reçu (One Tap non confirmé).");
    if (resolveProchainJetonId) {
      resolveProchainJetonId(null);
      resolveProchainJetonId = null;
    }
    return;
  }

  const payload = decoderPayloadJwt(reponse.credential);

  // Garde-fou : si l'utilisateur a choisi un autre compte que celui
  // utilisé pour Drive (malgré le login_hint), on refuse ce jeton
  // plutôt que de fédérer AWS sur la mauvaise identité.
  if (jetonAccesActuel?.email && payload.email !== jetonAccesActuel.email) {
    console.warn(
      `[GymCoach] Compte du jeton d'identité (${payload.email}) différent du compte Drive (${jetonAccesActuel.email}) — jeton rejeté.`
    );
    jetonIdActuel = null;
    if (resolveProchainJetonId) {
      resolveProchainJetonId(null);
      resolveProchainJetonId = null;
    }
    return;
  }

  jetonIdActuel = {
    idToken: reponse.credential,
    expiresAt: payload.exp * 1000,
  };

  if (resolveProchainJetonId) {
    resolveProchainJetonId(jetonIdActuel.idToken);
    resolveProchainJetonId = null;
  }
}

/**
 * Initialise le client OAuth2 (jeton d'accès). L'initialisation du One
 * Tap (jeton d'identité) se fait juste avant chaque prompt() — voir
 * getIdToken() — pour pouvoir y injecter le login_hint à jour.
 */
export function initAuth() {
  clientJeton = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: surReponseJetonAcces,
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
 * Jeton d'identité valide (pour Cognito), redemandé à Google si besoin,
 * orienté vers le même compte que celui utilisé pour Drive (login_hint)
 * et vérifié après coup (voir en-tête du fichier). PEUT déclencher une
 * interaction visible (One Tap) — à n'appeler que suite à une action
 * explicite de l'utilisateur.
 *
 * @returns {Promise<string|null>} le jeton d'identité, ou null si Google
 *   n'a pas pu le confirmer, ou si le compte choisi ne correspond pas
 *   à celui de Drive.
 */
export function getIdToken() {
  const margeMs = 60 * 1000;
  if (jetonIdActuel && Date.now() < jetonIdActuel.expiresAt - margeMs) {
    return Promise.resolve(jetonIdActuel.idToken);
  }

  return new Promise((resolve) => {
    resolveProchainJetonId = resolve;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: surReponseJetonId,
      login_hint: jetonAccesActuel?.email ?? undefined,
    });
    google.accounts.id.prompt();
  });
}
