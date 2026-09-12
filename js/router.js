/*
  router.js — Navigation entre les vues (sans framework)
  ---------------------------------------------------------------------------
  Une seule page (index.html) contenant plusieurs <section data-vue="...">,
  affichées/masquées selon le hash de l'URL (#dashboard, #routines...). Un
  clic sur un lien de nav déclenche simplement un changement de hash — pas
  de rechargement de page, cohérent avec l'usage en PWA plein écran.
*/

const vues = new Map(); // nom de vue → fonction d'initialisation (ou null)
const VUE_PAR_DEFAUT = "dashboard";

/** Déclare une vue et sa fonction d'initialisation, appelée à chaque arrivée. */
export function enregistrerVue(nom, initialiser = null) {
  vues.set(nom, initialiser);
}

function nomVueActuelle() {
  const nom = location.hash.replace("#", "");
  return vues.has(nom) ? nom : VUE_PAR_DEFAUT;
}

async function afficherVueActuelle() {
  const nom = nomVueActuelle();

  document.querySelectorAll("[data-vue]").forEach((section) => {
    section.hidden = section.dataset.vue !== nom;
  });

  document.querySelectorAll(".nav-link[data-cible]").forEach((lien) => {
    if (lien.dataset.cible === nom) {
      lien.setAttribute("aria-current", "page");
    } else {
      lien.removeAttribute("aria-current");
    }
  });

  const initialiser = vues.get(nom);
  if (initialiser) {
    try {
      await initialiser();
    } catch (erreur) {
      // Une vue qui échoue à s'initialiser ne doit jamais bloquer le reste
      // de l'app (voir specifications.md §11) — elle affiche elle-même un
      // message adapté ; ici on se contente de journaliser.
      console.error(`[GymCoach] Échec d'initialisation de la vue "${nom}" :`, erreur);
    }
  }
}

/** À appeler une seule fois au démarrage, une fois le DOM prêt. */
export function demarrerRouteur() {
  window.addEventListener("hashchange", afficherVueActuelle);
  afficherVueActuelle();
}
