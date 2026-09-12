/*
  vues/routines.js — Écran "Gestion des routines/programmes"
  ---------------------------------------------------------------------------
  Première vue fonctionnelle de l'app (voir specifications.md §3.1 et
  schema-donnees.md, onglets "Routines" et "Séances-types"). Permet de
  créer/éditer des programmes et, pour chacun, ses séances-types avec leur
  règle de récurrence. La prescription détaillée par exercice (onglet
  "Prescription") viendra dans une étape suivante — elle a besoin du
  référentiel `exercices_complet.json`, pas encore présent dans ce dépôt.

  Pas de framework : on regénère le HTML du conteneur à chaque changement
  d'état (données modestes en usage personnel, donc sans souci de
  performance), avec une délégation d'événements unique sur le conteneur.
*/

import { getAccessToken } from "../auth.js";
import { chargerOnglet, enregistrerOnglet, genererId } from "../sheets.js";
import { afficherToast, definirEtatSync, echapperHtml } from "../ui.js";

const OBJECTIFS = ["Force", "Hypertrophie", "Endurance", "Perte de poids", "Général"];
const METHODES_PROGRESSION = ["Linéaire", "Double progression", "Ondulante", "Autre"];
const STATUTS = ["Brouillon", "Actif", "Archivé"];
const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MODES_RECURRENCE = [
  { code: "rotation", libelle: "Rotation (dans l'ordre, dès la prochaine séance)" },
  { code: "jours_fixes", libelle: "Jours fixes" },
  { code: "intervalle", libelle: "Tous les N jours" },
];

// --- État en mémoire ------------------------------------------------------
// Rechargé depuis Sheets une seule fois par session ; ensuite on travaille
// sur ce cache et on réécrit l'onglet concerné à chaque sauvegarde.

let jeton = null;
let routines = [];
let seancesTypes = [];
let donneesChargees = false;
let idRoutineSelectionnee = null;
let idSeanceTypeEnEdition = null; // null = aucune édition ; "nouvelle" = formulaire de création
let ecouteursPoses = false;

const conteneur = document.getElementById("conteneur-routines");

/** Point d'entrée, appelé par le routeur à chaque arrivée sur cette vue. */
export async function initVueRoutines() {
  jeton = getAccessToken();

  if (!jeton) {
    conteneur.innerHTML = `<p class="texte-discret">Connecte-toi à Google (depuis l'accueil) pour gérer tes routines — elles sont stockées dans ton Google Sheet personnel.</p>`;
    return;
  }

  if (!donneesChargees) {
    conteneur.innerHTML = `<p class="texte-discret">Chargement de tes routines…</p>`;
    try {
      [routines, seancesTypes] = await Promise.all([
        chargerOnglet(jeton, "Routines"),
        chargerOnglet(jeton, "Séances-types"),
      ]);
      donneesChargees = true;
    } catch (erreur) {
      console.error("[GymCoach] Échec du chargement des routines :", erreur);
      conteneur.innerHTML = `<p class="banner--error">Impossible de charger tes routines pour l'instant (connexion ou droits Google Sheets). Reviens sur cet écran pour réessayer.</p>`;
      return;
    }
  }

  poserEcouteurs();
  rendre();
}

function poserEcouteurs() {
  if (ecouteursPoses) return;
  ecouteursPoses = true;

  conteneur.addEventListener("click", surClic);
  conteneur.addEventListener("submit", surSoumission);
  conteneur.addEventListener("change", surChangement);
}

// --- Rendu -----------------------------------------------------------------

function rendre() {
  const routinesTriees = [...routines].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  conteneur.innerHTML = `
    <div class="vue-routines">
      <section class="panneau-liste" aria-label="Liste des programmes">
        <div class="panneau-liste__entete">
          <h2 class="panneau-liste__titre">Programmes</h2>
          <button type="button" class="btn btn--primary btn--sm" data-action="nouvelle-routine">+ Nouveau</button>
        </div>
        ${routinesTriees.length === 0
          ? `<p class="texte-discret">Aucun programme pour l'instant.</p>`
          : `<ul class="liste-cartes">${routinesTriees.map((r) => carteRoutine(r)).join("")}</ul>`
        }
      </section>

      <section class="panneau-detail" aria-label="Détail du programme">
        ${idRoutineSelectionnee === "nouvelle"
          ? formulaireRoutine(null)
          : idRoutineSelectionnee
            ? detailRoutine(routines.find((r) => r.id_routine === idRoutineSelectionnee))
            : `<p class="texte-discret">Sélectionne un programme dans la liste, ou crée-en un nouveau.</p>`
        }
      </section>
    </div>
  `;
}

function carteRoutine(routine) {
  const estActive = routine.id_routine === idRoutineSelectionnee;
  return `
    <li>
      <button type="button" class="carte-selectionnable${estActive ? " carte-selectionnable--active" : ""}"
              data-action="selectionner-routine" data-id="${routine.id_routine}">
        <span class="carte-selectionnable__titre">${echapperHtml(routine.nom || "(sans nom)")}</span>
        <span class="badges">
          ${routine.objectif ? `<span class="badge">${echapperHtml(routine.objectif)}</span>` : ""}
          <span class="badge badge--${classeStatut(routine.statut)}">${echapperHtml(routine.statut || "Brouillon")}</span>
        </span>
      </button>
    </li>
  `;
}

function classeStatut(statut) {
  if (statut === "Actif") return "ok";
  if (statut === "Archivé") return "neutre";
  return "warn";
}

function formulaireRoutine(routine) {
  const estNouvelle = routine === null;
  const valeurs = routine ?? { id_routine: "", nom: "", objectif: "", methode_progression: "", statut: "Brouillon", notes: "" };

  return `
    <form data-form="routine" data-id="${valeurs.id_routine}">
      <h2 class="panneau-detail__titre">${estNouvelle ? "Nouveau programme" : "Modifier le programme"}</h2>

      <label class="champ">
        <span>Nom</span>
        <input type="text" name="nom" required value="${echapperHtml(valeurs.nom)}" placeholder="Ex. Force — cycle 1" />
      </label>

      <label class="champ">
        <span>Objectif</span>
        <select name="objectif">
          <option value="">—</option>
          ${optionsSelect(OBJECTIFS, valeurs.objectif)}
        </select>
      </label>

      <label class="champ">
        <span>Méthode de progression</span>
        <select name="methode_progression">
          <option value="">—</option>
          ${optionsSelect(METHODES_PROGRESSION, valeurs.methode_progression)}
        </select>
      </label>

      <label class="champ">
        <span>Statut</span>
        <select name="statut">
          ${optionsSelect(STATUTS, valeurs.statut)}
        </select>
      </label>

      <label class="champ">
        <span>Notes</span>
        <textarea name="notes" rows="3">${echapperHtml(valeurs.notes)}</textarea>
      </label>

      <div class="actions-formulaire">
        <button type="submit" class="btn btn--primary">Enregistrer</button>
        ${estNouvelle
          ? `<button type="button" class="btn btn--ghost" data-action="annuler-routine">Annuler</button>`
          : `<button type="button" class="btn btn--ghost" data-action="supprimer-routine" data-id="${valeurs.id_routine}">Supprimer</button>`
        }
      </div>
    </form>
  `;
}

function detailRoutine(routine) {
  if (!routine) {
    idRoutineSelectionnee = null;
    return `<p class="texte-discret">Ce programme n'existe plus. Sélectionne-en un autre.</p>`;
  }

  const seancesDuProgramme = seancesTypes
    .filter((s) => s.id_routine === routine.id_routine)
    .sort((a, b) => Number(a.ordre || 0) - Number(b.ordre || 0));

  return `
    ${formulaireRoutine(routine)}

    <hr class="separateur" />

    <div class="panneau-liste__entete">
      <h3 class="panneau-detail__titre">Séances de ce programme</h3>
      <button type="button" class="btn btn--primary btn--sm" data-action="nouvelle-seance-type" data-id-routine="${routine.id_routine}">+ Séance</button>
    </div>

    ${idSeanceTypeEnEdition === "nouvelle"
      ? formulaireSeanceType(routine.id_routine, null)
      : ""
    }

    ${seancesDuProgramme.length === 0
      ? `<p class="texte-discret">Aucune séance définie pour ce programme.</p>`
      : `<ul class="liste-cartes">${seancesDuProgramme.map((s) => carteSeanceType(s)).join("")}</ul>`
    }
  `;
}

function carteSeanceType(seanceType) {
  if (idSeanceTypeEnEdition === seanceType.id_seance_type) {
    return `<li>${formulaireSeanceType(seanceType.id_routine, seanceType)}</li>`;
  }

  return `
    <li>
      <div class="carte">
        <div class="carte__entete">
          <span class="carte-selectionnable__titre">${echapperHtml(seanceType.nom || "(sans nom)")}</span>
          <span class="texte-discret">Ordre ${echapperHtml(seanceType.ordre || "—")}</span>
        </div>
        <p class="texte-discret">${resumeRecurrence(seanceType)}</p>
        <div class="actions-formulaire">
          <button type="button" class="btn btn--ghost btn--sm" data-action="modifier-seance-type" data-id="${seanceType.id_seance_type}">Modifier</button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="supprimer-seance-type" data-id="${seanceType.id_seance_type}">Supprimer</button>
        </div>
      </div>
    </li>
  `;
}

function resumeRecurrence(seanceType) {
  if (seanceType.mode_recurrence === "jours_fixes") {
    return `Jours fixes : ${echapperHtml(seanceType.jours_semaine || "—")}`;
  }
  if (seanceType.mode_recurrence === "intervalle") {
    return `Tous les ${echapperHtml(seanceType.intervalle_jours || "?")} jours`;
  }
  return "Rotation (dans l'ordre)";
}

function formulaireSeanceType(idRoutine, seanceType) {
  const estNouvelle = seanceType === null;
  const nbSeancesExistantes = seancesTypes.filter((s) => s.id_routine === idRoutine).length;
  const valeurs = seanceType ?? {
    id_seance_type: "", nom: "", ordre: String(nbSeancesExistantes + 1),
    notes: "", mode_recurrence: "rotation", jours_semaine: "", intervalle_jours: "",
  };
  const joursActifs = (valeurs.jours_semaine || "").split(",").map((j) => j.trim());

  return `
    <form data-form="seance-type" data-id-routine="${idRoutine}" data-id="${valeurs.id_seance_type}" class="carte">
      <label class="champ">
        <span>Nom</span>
        <input type="text" name="nom" required value="${echapperHtml(valeurs.nom)}" placeholder="Ex. Jour A — Push" />
      </label>

      <label class="champ">
        <span>Ordre</span>
        <input type="number" name="ordre" min="1" value="${echapperHtml(valeurs.ordre)}" />
      </label>

      <label class="champ">
        <span>Récurrence</span>
        <select name="mode_recurrence">
          ${MODES_RECURRENCE.map((m) => `<option value="${m.code}"${m.code === valeurs.mode_recurrence ? " selected" : ""}>${m.libelle}</option>`).join("")}
        </select>
      </label>

      <div class="champ" data-champ-conditionnel="jours_fixes" ${valeurs.mode_recurrence === "jours_fixes" ? "" : "hidden"}>
        <span>Jours de la semaine</span>
        <div class="grille-jours">
          ${JOURS_SEMAINE.map((jour) => `
            <label class="case-jour">
              <input type="checkbox" name="jour" value="${jour}" ${joursActifs.includes(jour) ? "checked" : ""} />
              ${jour.slice(0, 3)}
            </label>
          `).join("")}
        </div>
      </div>

      <label class="champ" data-champ-conditionnel="intervalle" ${valeurs.mode_recurrence === "intervalle" ? "" : "hidden"}>
        <span>Intervalle (jours)</span>
        <input type="number" name="intervalle_jours" min="1" value="${echapperHtml(valeurs.intervalle_jours)}" />
      </label>

      <label class="champ">
        <span>Notes</span>
        <textarea name="notes" rows="2">${echapperHtml(valeurs.notes)}</textarea>
      </label>

      <div class="actions-formulaire">
        <button type="submit" class="btn btn--primary btn--sm">Enregistrer</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="annuler-seance-type">Annuler</button>
      </div>
    </form>
  `;
}

function optionsSelect(valeurs, valeurActuelle) {
  return valeurs.map((v) => `<option value="${v}"${v === valeurActuelle ? " selected" : ""}>${v}</option>`).join("");
}

// --- Interactions ------------------------------------------------------

function surChangement(evenement) {
  // Affiche/masque les champs "jours fixes" / "intervalle" selon le mode
  // de récurrence choisi, sans perdre la saisie déjà faite dans le formulaire.
  if (evenement.target.name !== "mode_recurrence") return;

  const formulaire = evenement.target.closest("form");
  const mode = evenement.target.value;
  formulaire.querySelector('[data-champ-conditionnel="jours_fixes"]').hidden = mode !== "jours_fixes";
  formulaire.querySelector('[data-champ-conditionnel="intervalle"]').hidden = mode !== "intervalle";
}

function surClic(evenement) {
  const bouton = evenement.target.closest("[data-action]");
  if (!bouton) return;
  const action = bouton.dataset.action;

  if (action === "nouvelle-routine") {
    idRoutineSelectionnee = "nouvelle";
    idSeanceTypeEnEdition = null;
  } else if (action === "annuler-routine") {
    idRoutineSelectionnee = null;
  } else if (action === "selectionner-routine") {
    idRoutineSelectionnee = bouton.dataset.id;
    idSeanceTypeEnEdition = null;
  } else if (action === "supprimer-routine") {
    supprimerRoutine(bouton.dataset.id);
    return; // rendre() est appelé depuis la fonction async
  } else if (action === "nouvelle-seance-type") {
    idSeanceTypeEnEdition = "nouvelle";
  } else if (action === "modifier-seance-type") {
    idSeanceTypeEnEdition = bouton.dataset.id;
  } else if (action === "annuler-seance-type") {
    idSeanceTypeEnEdition = null;
  } else if (action === "supprimer-seance-type") {
    supprimerSeanceType(bouton.dataset.id);
    return;
  }

  rendre();
}

async function surSoumission(evenement) {
  evenement.preventDefault();
  const formulaire = evenement.target;
  const donnees = new FormData(formulaire);

  if (formulaire.dataset.form === "routine") {
    await enregistrerRoutine(formulaire.dataset.id, donnees);
  } else if (formulaire.dataset.form === "seance-type") {
    await enregistrerSeanceType(formulaire.dataset.idRoutine, formulaire.dataset.id, donnees, formulaire);
  }
}

// --- Mutations + synchronisation Google Sheets ---------------------------

async function enregistrerRoutine(idExistant, donnees) {
  const estNouvelle = !idExistant;
  const routine = estNouvelle
    ? { id_routine: genererId("r"), date_creation: new Date().toISOString().slice(0, 10) }
    : routines.find((r) => r.id_routine === idExistant);

  routine.nom = donnees.get("nom").trim();
  routine.objectif = donnees.get("objectif");
  routine.methode_progression = donnees.get("methode_progression");
  routine.statut = donnees.get("statut");
  routine.notes = donnees.get("notes").trim();

  if (estNouvelle) routines.push(routine);
  idRoutineSelectionnee = routine.id_routine;

  try {
    await enregistrerOnglet(jeton, "Routines", routines);
    definirEtatSync("ok");
  } catch (erreur) {
    console.error("[GymCoach] Échec de sauvegarde de la routine :", erreur);
    definirEtatSync("error");
    afficherToast("Échec de la sauvegarde du programme — la modification reste affichée, réessaie dans un instant (elle sera renvoyée à ta prochaine sauvegarde).");
  }

  rendre();
}

async function supprimerRoutine(id) {
  if (!confirm("Supprimer ce programme et toutes ses séances ? Cette action ne peut pas être annulée.")) return;

  routines = routines.filter((r) => r.id_routine !== id);
  const seancesLiees = seancesTypes.filter((s) => s.id_routine === id);
  seancesTypes = seancesTypes.filter((s) => s.id_routine !== id);
  if (idRoutineSelectionnee === id) idRoutineSelectionnee = null;

  try {
    await enregistrerOnglet(jeton, "Routines", routines);
    if (seancesLiees.length > 0) {
      await enregistrerOnglet(jeton, "Séances-types", seancesTypes);
    }
    definirEtatSync("ok");
  } catch (erreur) {
    console.error("[GymCoach] Échec de suppression du programme :", erreur);
    definirEtatSync("error");
    afficherToast("Échec de la synchronisation de la suppression — réessaie dans un instant.");
  }

  rendre();
}

async function enregistrerSeanceType(idRoutine, idExistant, donnees, formulaire) {
  const estNouvelle = !idExistant;
  const seanceType = estNouvelle
    ? { id_seance_type: genererId("st"), id_routine: idRoutine }
    : seancesTypes.find((s) => s.id_seance_type === idExistant);

  seanceType.nom = donnees.get("nom").trim();
  seanceType.ordre = donnees.get("ordre") || "1";
  seanceType.notes = donnees.get("notes").trim();
  seanceType.mode_recurrence = donnees.get("mode_recurrence");
  seanceType.jours_semaine = Array.from(formulaire.querySelectorAll('input[name="jour"]:checked'))
    .map((c) => c.value)
    .join(",");
  seanceType.intervalle_jours = donnees.get("intervalle_jours") || "";

  if (estNouvelle) seancesTypes.push(seanceType);
  idSeanceTypeEnEdition = null;

  try {
    await enregistrerOnglet(jeton, "Séances-types", seancesTypes);
    definirEtatSync("ok");
  } catch (erreur) {
    console.error("[GymCoach] Échec de sauvegarde de la séance-type :", erreur);
    definirEtatSync("error");
    afficherToast("Échec de la sauvegarde de la séance — la modification reste affichée, réessaie dans un instant.");
  }

  rendre();
}

async function supprimerSeanceType(id) {
  if (!confirm("Supprimer cette séance ?")) return;

  seancesTypes = seancesTypes.filter((s) => s.id_seance_type !== id);

  try {
    await enregistrerOnglet(jeton, "Séances-types", seancesTypes);
    definirEtatSync("ok");
  } catch (erreur) {
    console.error("[GymCoach] Échec de suppression de la séance-type :", erreur);
    definirEtatSync("error");
    afficherToast("Échec de la synchronisation de la suppression — réessaie dans un instant.");
  }

  rendre();
}
