/*
  app.js — Point d'entrée de l'application
  -------------------------------------------
  Fondations transversales (service worker, erreurs globales) + câblage
  de l'authentification Google. Les modules IndexedDB, Sheets, etc.
  viendront s'y brancher aux étapes suivantes.
*/

import { initAuth, login, logout } from "./auth.js";

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

btnLogin.addEventListener("click", login);
btnLogout.addEventListener("click", logout);

// initAuth() dépend de la variable globale `google`, chargée par le
// script Google Identity Services référencé dans index.html avant ce
// module (voir le commentaire à cet endroit pour la garantie d'ordre).
initAuth();
appliquerEtatAuth("deconnecte");
