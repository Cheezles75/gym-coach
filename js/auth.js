/*
  auth.js — Authentification Google (Identity Services)
  ---------------------------------------------------------------------------
  Deux jetons Google bien distincts, pour deux usages différents :

  - Le JETON D'ACCÈS (OAuth2, modèle "token client", scope drive.file) :
    sert à appeler directement les API Google Sheets/Drive.
  - Le JETON D'IDENTITÉ (ID token, "Sign in with Google") : un JWT qui
    prouve qui est l'utilisateur. C'est CELUI-LÀ que Cognito Identity
    Pool exige pour fédérer l'identité Google vers des accès AWS.

  Les deux vivent en mémoire uniquement, jamais persistés. Le jeton
  d'accès est renouvelé proactivement en tâche de fond ; le jeton
  d'identité est redemandé à la volée quand cognito.js en a besoin.

  DEUX PROBLÈMES CONSTATÉS À L'USAGE, CORRIGÉS ICI :

  1. Compte différent entre Drive et AWS : le sélecteur de compte du
     "One Tap" est indépendant de celui du jeton d'accès. On mémorise
     l'email du compte Drive (via l'endpoint userinfo), on le passe en
     `login_hint` pour orienter le One Tap, ET on vérifie après coup que
     l'email du jeton d'identité reçu correspond — sinon on le rejette
     plutôt que de fédérer AWS sur le mauvais compte.

  2. "One Tap" qui ne réapparaît plus après un premier échec : Google
     applique un temps de repos anti-spam après une tentative fermée/non
     affichée (FedCM), sans le dire clairement — d'où le blocage observé
     nécessitant une déconnexion complète. La fonction prompt() accepte
     un callback de "notification de moment" qui permet justement de
     détecter ce cas (isNotDisplayed / isSkippedMoment) : on l'utilise
     pour prévenir app.js, qui affiche alors un vrai bouton Google
     ("Sign in with Google" rendu, pas le One Tap automatique) — un clic
     explicite sur ce bouton n'est pas soumis au même temps de repos.
*/

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from "./config.js";

const MARGE_RENOUVELLEMENT_MS = 5 * 60 * 1000;

let clientJeton = null;      // instance Google Identity Services (OAuth2)
let jetonAccesActuel = null; // { accessToken, expiresAt, email } | null
let minuteurRenouvellement = null;

let jetonIdActuel = null;    // { idToken, expiresAt } | null
let resolveProchainJetonId = null;
let rejectProchainJetonId = null;

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
 * vérifie pas la signature — ce n'est pas notre rôle, Cognito/AWS la
 * vérifie à réception — on lit juste des claims publics (exp, email...).
 */
function decoderPayloadJwt(jwt) {
  const partieCentrale = jwt.split(".")[1];
  return JSON.parse(atob(partieCentrale.replace(/-/g, "+").replace(/_/g, "/")));
}

/**
 * Récupère l'email associé au jeton d'accès, pour orienter le One Tap
 * vers le même compte (voir en-tête du fichier, point 1).
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
    if (rejectProchainJetonId) {
      rejectProchainJetonId(new Error("non_confirme"));
      resolveProchainJetonId = null;
      rejectProchainJetonId = null;
    }
    return;
  }

  const payload = decoderPayloadJwt(reponse.credential);

  // Garde-fou : compte différent de celui utilisé pour Drive malgré le
  // login_hint (l'utilisateur a cliqué "utiliser un autre compte").
  if (jetonAccesActuel?.email && payload.email !== jetonAccesActuel.email) {
    jetonIdActuel = null;
    if (rejectProchainJetonId) {
      rejectProchainJetonId(
        new Error(`compte_different:${payload.email}:${jetonAccesActuel.email}`)
      );
      resolveProchainJetonId = null;
      rejectProchainJetonId = null;
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
    rejectProchainJetonId = null;
  }
}

/**
 * Initialise le client OAuth2 (jeton d'accès). L'initialisation du One
 * Tap se fait juste avant chaque prompt() — voir getIdToken() — pour
 * pouvoir y injecter le login_hint à jour.
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
 * Jeton d'identité valide (pour Cognito), redemandé à Google si besoin.
 * PEUT déclencher une interaction visible (One Tap) — à n'appeler que
 * suite à une action explicite de l'utilisateur.
 *
 * @returns {Promise<string>} le jeton d'identité.
 * @throws {Error} avec pour message :
 *   - "non_confirme" : One Tap affiché mais fermé sans choix
 *   - "compte_different:<reçu>:<attendu>" : mauvais compte choisi
 *   - "onetap_indisponible" : One Tap non affichable (repos anti-spam,
 *     cookies tiers bloqués...) — app.js doit alors proposer le bouton
 *     Google explicite via renderBoutonSecours()
 */
export function getIdToken() {
  const margeMs = 60 * 1000;
  if (jetonIdActuel && Date.now() < jetonIdActuel.expiresAt - margeMs) {
    return Promise.resolve(jetonIdActuel.idToken);
  }

  return new Promise((resolve, reject) => {
    resolveProchainJetonId = resolve;
    rejectProchainJetonId = reject;

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: surReponseJetonId,
      login_hint: jetonAccesActuel?.email ?? undefined,
    });

    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        if (rejectProchainJetonId) {
          rejectProchainJetonId(new Error("onetap_indisponible"));
          resolveProchainJetonId = null;
          rejectProchainJetonId = null;
        }
      }
    });
  });
}

/**
 * Affiche le bouton Google natif ("Sign in with Google") dans le
 * conteneur fourni — repli fiable quand le One Tap automatique ne peut
 * pas s'afficher. Réutilise le login_hint/callback déjà configurés par
 * le dernier getIdToken(). Un clic dessus déclenche le même callback
 * surReponseJetonId, donc la Promise en attente se résout normalement.
 */
export function renderBoutonSecours(conteneur) {
  google.accounts.id.renderButton(conteneur, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
    logo_alignment: "left",
  });
}
