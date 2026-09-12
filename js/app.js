/*
  app.js — Point d'entrée de l'application
  -------------------------------------------
  Fondations transversales (service worker, erreurs globales) + câblage
  de l'authentification Google et de la connectivité Lambda. Les modules
  IndexedDB, Sheets, etc. viendront s'y brancher aux étapes suivantes.
*/

import { initAuth, login, logout, getAccessToken } from "./auth.js";
import { verifierConnexionLambda } from "./lambda.js";

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
  // Le même jeton sert pour Lambda — dès que Google est connecté, on
  // vérifie que la Lambda l'accepte aussi (voir plus bas).
  if (evenement.detail.etat === "connecte") {
    verifierAws();
  } else {
    indicateurAws.dataset.state = "warn";
  }
});

// --- Connectivité Lambda (AWS) -------------------------------------------
// Beaucoup plus simple qu'avec Cognito : un seul jeton (celui de Drive),
// aucun échange côté navigateur, aucun accès AWS à stocker ici. On se
// contente de vérifier que la Lambda accepte ce jeton, pour piloter
// l'indicateur "AWS" de la barre de statut.

const indicateurAws = document.getElementById("indicateur-aws");

async function verifierAws() {
  indicateurAws.dataset.state = "warn";

  const jeton = getAccessToken();
  if (!jeton) {
    indicateurAws.dataset.state = "error";
    return;
  }

  try {
    await verifierConnexionLambda(jeton);
    indicateurAws.dataset.state = "ok";
  } catch (erreur) {
    console.error("[GymCoach] Échec de connexion à la Lambda :", erreur);
    indicateurAws.dataset.state = "error";
    afficherToast("Échec de la connexion au serveur GymCoach — réessaie dans un instant.");
  }
}

btnLogin.addEventListener("click", login);

btnLogout.addEventListener("click", () => {
  logout();
  indicateurAws.dataset.state = "warn";
});

// initAuth() dépend de la variable globale `google`, chargée par le
// script Google Identity Services référencé dans index.html avant ce
// module (voir le commentaire à cet endroit pour la garantie d'ordre).
initAuth();
appliquerEtatAuth("deconnecte");
