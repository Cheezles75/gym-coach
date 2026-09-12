/*
  ui.js — Petits utilitaires d'interface partagés
  ---------------------------------------------------------------------------
  Le toast (message non intrusif — voir specifications.md §11) et
  l'indicateur "Sync" de la barre de statut sont utilisés par plusieurs
  modules (app.js, les vues) : centralisés ici pour éviter les doublons.
*/

const elementToast = document.getElementById("toast");
let minuteurToast = null;

/**
 * Affiche un message temporaire, non bloquant (§11 — erreur qui bloque
 * l'action en cours mais sans décision à prendre de la part de l'utilisateur).
 */
export function afficherToast(message, dureeMs = 6000) {
  clearTimeout(minuteurToast);
  elementToast.textContent = message;
  elementToast.hidden = false;
  minuteurToast = setTimeout(() => {
    elementToast.hidden = true;
  }, dureeMs);
}

const elementIndicateurSync = document.getElementById("indicateur-sync");

/**
 * Pilote le point de couleur "Sync" de la barre de statut.
 * @param {"ok" | "warn" | "error"} etat
 */
export function definirEtatSync(etat) {
  if (elementIndicateurSync) {
    elementIndicateurSync.dataset.state = etat;
  }
}

/** Échappe le texte inséré dans un gabarit HTML (évite toute injection). */
export function echapperHtml(texte) {
  const div = document.createElement("div");
  div.textContent = texte ?? "";
  return div.innerHTML;
}
