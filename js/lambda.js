/*
  lambda.js — Appels à la fonction Lambda GymCoach
  ---------------------------------------------------------------------------
  Remplace cognito.js : plus de fédération d'identité côté navigateur, plus
  d'accès AWS temporaires à gérer ici. Le jeton d'accès Google (le même
  que celui utilisé pour Drive/Sheets — voir auth.js) part simplement en
  Bearer token à chaque appel ; c'est la Lambda qui le revérifie auprès
  de Google et qui assume, elle, un rôle IAM pour parler à Bedrock/Polly/
  Transcribe. Aucun secret AWS ne transite jamais par le navigateur.
*/

import { LAMBDA_FUNCTION_URL } from "./config.js";

/**
 * Appelle la Lambda avec le jeton d'accès Google en Bearer token.
 *
 * @param {string} accessToken — voir auth.js → getAccessToken().
 * @param {object} corps — payload envoyé tel quel (JSON) à la Lambda.
 * @returns {Promise<object>} la réponse JSON de la Lambda.
 * @throws {Error} si la requête échoue ou si la Lambda renvoie une erreur.
 */
export async function appelerLambda(accessToken, corps = {}) {
  const reponse = await fetch(LAMBDA_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(corps),
  });

  const donnees = await reponse.json().catch(() => ({}));

  if (!reponse.ok) {
    throw new Error(donnees.erreur ?? `Lambda a répondu ${reponse.status}`);
  }

  return donnees;
}

/**
 * Simple vérification de connectivité : confirme que la Lambda accepte
 * le jeton, sans déclencher d'appel Bedrock/Polly/Transcribe. Utilisée
 * par app.js pour piloter l'indicateur "AWS" de la barre de statut.
 */
export async function verifierConnexionLambda(accessToken) {
  return appelerLambda(accessToken, { action: "ping" });
}
