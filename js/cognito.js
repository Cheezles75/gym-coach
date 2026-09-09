/*
  cognito.js — Fédération d'identité Google → AWS (Cognito Identity Pool)
  ---------------------------------------------------------------------------
  Appelle directement l'API HTTP de Cognito Identity (GetId, puis
  GetCredentialsForIdentity). Ces deux actions sont volontairement NON
  authentifiées côté AWS — c'est le principe même d'un Identity Pool :
  échanger le jeton d'un fournisseur externe (ici Google) contre des
  accès AWS temporaires, sans qu'on ait besoin d'accès AWS au préalable
  pour faire cet échange. Un simple fetch() suffit donc : pas de SDK AWS,
  pas de dépendance externe à charger, pas de question de fiabilité de
  CDN pour cette étape précise.

  Ce que ce module NE fait PAS : signer les appels Bedrock/Polly/Transcribe
  eux-mêmes avec les accès obtenus (SigV4). Ce sera le rôle des modules
  qui consommeront getAwsCredentials(), à l'étape suivante.
*/

import { COGNITO_IDENTITY_POOL_ID, AWS_REGION } from "./config.js";

const ENDPOINT = `https://cognito-identity.${AWS_REGION}.amazonaws.com/`;

// Les accès délivrés par GetCredentialsForIdentity durent 1h, durée fixe
// non paramétrable côté Cognito. On les considère expirés un peu avant
// leur échéance réelle pour ne jamais partir avec des accès à la limite.
const MARGE_EXPIRATION_MS = 5 * 60 * 1000;

let accesActuels = null; // { accessKeyId, secretAccessKey, sessionToken, expiresAt } | null

async function appelerCognito(action, corps) {
  const reponse = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityService.${action}`,
    },
    body: JSON.stringify(corps),
  });

  if (!reponse.ok) {
    const erreur = await reponse.json().catch(() => ({}));
    throw new Error(
      `Cognito ${action} a échoué (${reponse.status}) : ${erreur.message ?? reponse.statusText}`
    );
  }

  return reponse.json();
}

/**
 * Échange un jeton d'identité Google (voir auth.js → getIdToken()) contre
 * des accès AWS temporaires, et les met en cache mémoire.
 *
 * @param {string} jetonIdGoogle — le JETON D'IDENTITÉ Google (pas le jeton
 *   d'accès utilisé pour Drive/Sheets — voir la distinction dans auth.js).
 * @returns {Promise<object>} les accès obtenus.
 */
export async function obtenirAccesAws(jetonIdGoogle) {
  const logins = { "accounts.google.com": jetonIdGoogle };

  const { IdentityId } = await appelerCognito("GetId", {
    IdentityPoolId: COGNITO_IDENTITY_POOL_ID,
    Logins: logins,
  });

  const { Credentials } = await appelerCognito("GetCredentialsForIdentity", {
    IdentityId,
    Logins: logins,
  });

  accesActuels = {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretKey,
    sessionToken: Credentials.SessionToken,
    // Expiration renvoyée en secondes epoch (avec décimales) par l'API.
    expiresAt: Credentials.Expiration * 1000,
  };

  return accesActuels;
}

/**
 * Accès AWS valides actuellement en mémoire, ou null si absents/expirés.
 * Ne fait aucun appel réseau — c'est le rôle exclusif de obtenirAccesAws().
 */
export function getAwsCredentials() {
  if (!accesActuels) return null;
  if (Date.now() >= accesActuels.expiresAt - MARGE_EXPIRATION_MS) return null;
  return accesActuels;
}

export function effacerAccesAws() {
  accesActuels = null;
}
