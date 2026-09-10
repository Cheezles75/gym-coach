/*
  app.js — Point d'entrée de l'application
  -------------------------------------------
  Fondations transversales (service worker, erreurs globales) + câblage
  de l'authentification Google. Les modules IndexedDB, Sheets, etc.
  viendront s'y brancher aux étapes suivantes.
*/

import { initAuth, login, logout, getIdToken, renderBoutonSecours } from "./auth.js";
import { obtenirAccesAws, effacerAccesAws } from "./cognito.js";

// --- Enregistrement du service worker ---------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((erreur) => {
        // Non bloquant : l'app doit continuer à fonctionner sans PWA
        // offline si l'enregistrement échoue (voir §11 — erreur récupérée
        // automatiquement = traitement silencieux, journalisé seulement).
        console.warn("Échec de l'enregistrement du service worker :", erreur);
      });
  });
}

// --- Gestionnaire d'erreurs global -------------------------------------
// Toute erreur JS ou promesse rejetée non interceptée ailleurs finit ici.
// Pour l'instant : journalisation console. La version suivante branchera
// ceci sur le journal d'erreurs IndexedDB (§11) et, selon la gravité,
// sur un toast ou une bannière visible.

window.addEventListener("error", (evenement) => {
  console.error("[GymCoach] Erreur non interceptée :", evenement.error ?? evenement.message);
});

window.addEventListener("unhandledrejection", (evenement) => {
  console.error("[GymCoach] Promesse rejetée non interceptée :", evenement.reason);
});

console.info("[GymCoach] Scaffolding chargé.");

// --- Toast (messages non intrusifs, §11 des specs) ----------------------

const elementToast = document.getElementById("toast");
let minuteurToast = null;

function afficherToast(message, dureeMs = 6000) {
  clearTimeout(minuteurToast);
  elementToast.textContent = message;
  elementToast.hidden = false;
  minuteurToast = setTimeout(() => {
    elementToast.hidden = true;
  }, dureeMs);
}

// --- Authentification Google --------------------------------------------

const indicateurGoogle = document.getElementById("indicateur-google");
const libelleGoogle = document.getElementById("libelle-google");
const statutConnexionGoogle = document.getElementById("statut-connexion-google");
const btnLogin = document.getElementById("btn-google-login");
const btnLogout = document.getElementById("btn-google-logout");

function appliquerEtatAuth(etat) {
  const affichages = {
    connecte: { dot: "ok", libelle: "Google", statut: "Connecté", login: false, logout: true },
    deconnecte: { dot: "warn", libelle: "Google", statut: "Non connecté", login: true, logout: false },
    erreur: { dot: "error", libelle: "Google", statut: "Erreur de connexion — réessaie", login: true, logout: false },
  };

  const affichage = affichages[etat] ?? affichages.deconnecte;

  indicateurGoogle.dataset.state = affichage.dot;
  libelleGoogle.textContent = affichage.libelle;
  statutConnexionGoogle.textContent = affichage.statut;
  btnLogin.style.display = affichage.login ? "" : "none";
  btnLogout.style.display = affichage.logout ? "" : "none";
}

document.addEventListener("gymcoach:auth-changed", (evenement) => {
  appliquerEtatAuth(evenement.detail.etat);
});

// --- Fédération AWS via Cognito -----------------------------------------
// Déclenchée depuis le même clic que la connexion Google : on demande le
// jeton d'identité (voir auth.js) et on l'échange contre des accès AWS.
// Peut rester en échec sans bloquer Drive/Sheets, qui ne dépendent pas
// d'AWS — mais contrairement à avant, l'échec est maintenant explicite
// (toast) et, dans le cas le plus courant (One Tap indisponible), un
// vrai bouton Google apparaît pour débloquer la situation sans avoir à
// se déconnecter/reconnecter complètement.

const indicateurAws = document.getElementById("indicateur-aws");
const secoursGoogleId = document.getElementById("secours-google-id");
const conteneurBoutonGoogle = document.getElementById("conteneur-bouton-google");

function cacherSecoursGoogle() {
  secoursGoogleId.style.display = "none";
  conteneurBoutonGoogle.innerHTML = "";
}

function afficherSecoursGoogle() {
  secoursGoogleId.style.display = "";
  conteneurBoutonGoogle.innerHTML = "";
  renderBoutonSecours(conteneurBoutonGoogle);
}

const MESSAGES_ERREUR_AWS = {
  non_confirme: "Connexion AWS annulée — confirme avec le bouton Google ci-dessous.",
  onetap_indisponible: "Confirme ta connexion AWS avec le bouton Google ci-dessous.",
};

function messageErreurAws(erreur) {
  if (erreur.message.startsWith("compte_different:")) {
    const [, recu] = erreur.message.split(":");
    return `AWS connecté avec ${recu}, différent de ton compte Drive — reconnecte-toi avec le même compte.`;
  }
  return MESSAGES_ERREUR_AWS[erreur.message]
    ?? "Échec de la connexion AWS — réessaie dans un instant.";
}

async function connecterAws() {
  indicateurAws.dataset.state = "warn";
  cacherSecoursGoogle();

  let jetonId;
  try {
    jetonId = await getIdToken();
  } catch (erreur) {
    console.warn("[GymCoach] Échec d'obtention du jeton d'identité Google :", erreur.message);
    indicateurAws.dataset.state = "error";
    afficherToast(messageErreurAws(erreur));
    afficherSecoursGoogle();
    return;
  }

  try {
    await obtenirAccesAws(jetonId);
    indicateurAws.dataset.state = "ok";
    cacherSecoursGoogle();
  } catch (erreur) {
    console.error("[GymCoach] Échec de la fédération Cognito :", erreur);
    indicateurAws.dataset.state = "error";
    afficherToast("Échec de la connexion AWS (Cognito) — réessaie dans un instant.");
  }
}

btnLogin.addEventListener("click", () => {
  login();
  connecterAws();
});

btnLogout.addEventListener("click", () => {
  logout();
  effacerAccesAws();
  indicateurAws.dataset.state = "warn";
  cacherSecoursGoogle();
});

// initAuth() dépend de la variable globale `google`, chargée par le
// script Google Identity Services référencé dans index.html avant ce
// module (voir le commentaire à cet endroit pour la garantie d'ordre).
initAuth();
appliquerEtatAuth("deconnecte");
