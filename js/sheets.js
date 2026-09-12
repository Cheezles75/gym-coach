/*
  sheets.js — Couche de stockage Google Sheets
  ---------------------------------------------------------------------------
  Toutes les données personnelles (routines, séances, historique, lieux...)
  vivent dans UN classeur Google Sheets créé automatiquement par l'app dans
  le Drive de l'utilisateur (voir schema-donnees.md). Le classeur est créé
  une seule fois ; son identifiant est ensuite retrouvé soit via un cache
  local (localStorage), soit en le recherchant par nom dans Drive — le
  scope OAuth "drive.file" permet cette recherche/cet accès car c'est l'app
  elle-même qui a créé ce fichier (voir specifications.md §4 et §7).

  Stratégie de lecture/écriture volontairement simple, adaptée à un usage
  strictement personnel (quelques dizaines de lignes par onglet, jamais des
  milliers) : chaque sauvegarde réécrit l'onglet concerné dans son
  intégralité (en-têtes + lignes), plutôt que de suivre l'index de chaque
  ligne pour des mises à jour ciblées. Beaucoup plus simple à maintenir,
  sans compromis réel à cette échelle.
*/

const TITRE_CLASSEUR = "GymCoach — Données";
const CLE_CACHE_ID_CLASSEUR = "gymcoach_id_classeur";

// Schéma des onglets : nom → colonnes, dans l'ordre exact de
// schema-donnees.md. À faire évoluer uniquement en AJOUTANT des colonnes en
// fin de liste (jamais en réordonnant/renommant/supprimant), pour ne jamais
// invalider les classeurs déjà créés chez l'utilisateur.
export const ONGLETS = {
  "Routines": [
    "id_routine", "nom", "objectif", "methode_progression", "statut",
    "date_creation", "notes",
  ],
  "Séances-types": [
    "id_seance_type", "id_routine", "nom", "ordre", "notes",
    "mode_recurrence", "jours_semaine", "intervalle_jours",
  ],
  "Prescription": [
    "id_prescription", "id_seance_type", "id_exercice", "variante", "ordre",
    "id_groupe_enchainement", "type_groupe", "nb_series_echauffement",
    "nb_series_travail", "reps_min", "reps_max", "reps_cible",
    "charge_cible", "unite_charge", "rir_cible", "rpe_cible",
    "temps_repos_sec", "tempo", "cote", "notes_techniques",
  ],
  "Séances réalisées": [
    "id_seance_realisee", "id_routine", "id_seance_type", "id_lieu", "date",
    "heure_debut", "heure_fin", "energie_du_jour", "notes_globales",
  ],
  "Séries réalisées": [
    "id_serie_realisee", "id_seance_realisee", "id_exercice",
    "id_prescription", "numero_serie", "type_serie", "cote",
    "charge_reelle", "reps_realisees", "rir_reel", "rpe_reel",
    "tempo_reel", "temps_repos_reel_sec", "notes",
  ],
  "Mesures corporelles": [
    "id_mesure", "date", "poids_corps", "tour_taille", "tour_bras",
    "tour_cuisse", "tour_poitrine", "taux_masse_grasse", "notes",
  ],
  "Lieux": ["id_lieu", "nom", "type", "notes", "latitude", "longitude"],
  "Matériel par lieu": [
    "id_materiel", "id_lieu", "equipement", "precision", "notes",
  ],
  "Mes exercices perso": [
    "id_exercice", "nom_fr", "nom_fr_origine", "nom_fr_a_verifier", "nom_en",
    "muscle_principal", "muscles_secondaires", "equipement", "categorie",
    "mouvement", "type", "unilateral_possible", "niveau", "instructions_fr",
    "instructions_en", "images", "source", "licence",
  ],
};

let idClasseurEnCache = null;

/** Génère un identifiant local unique (horodatage + suffixe aléatoire). */
export function genererId(prefixe) {
  return `${prefixe}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Appel générique à une API Google (Sheets ou Drive), avec gestion d'erreur
 * uniforme — voir specifications.md §11 (try/catch systématique).
 */
async function appelApi(url, accessToken, options = {}) {
  const reponse = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!reponse.ok) {
    const details = await reponse.json().catch(() => ({}));
    throw new Error(
      details.error?.message ?? `Requête Google API échouée (HTTP ${reponse.status})`
    );
  }

  return reponse.status === 204 ? null : reponse.json();
}

/** Encode le nom d'un onglet pour l'utiliser dans une "range" A1 d'URL. */
function encoderPlage(nomOnglet, suffixe = "") {
  return encodeURIComponent(`'${nomOnglet}'${suffixe}`);
}

/** Crée le classeur avec tous les onglets et leurs en-têtes (une seule fois). */
async function creerClasseur(accessToken) {
  const nomsOnglets = Object.keys(ONGLETS);

  const classeur = await appelApi(
    "https://sheets.googleapis.com/v4/spreadsheets",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        properties: { title: TITRE_CLASSEUR },
        sheets: nomsOnglets.map((nom) => ({ properties: { title: nom } })),
      }),
    }
  );

  // Écrit la ligne d'en-tête de chaque onglet en un seul appel groupé.
  await appelApi(
    `https://sheets.googleapis.com/v4/spreadsheets/${classeur.spreadsheetId}/values:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: nomsOnglets.map((nom) => ({
          range: `'${nom}'!A1`,
          values: [ONGLETS[nom]],
        })),
      }),
    }
  );

  return classeur.spreadsheetId;
}

/** Cherche le classeur existant dans le Drive de l'utilisateur (créé par l'app). */
async function rechercherClasseur(accessToken) {
  const requete = encodeURIComponent(
    `name = '${TITRE_CLASSEUR}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  );
  const resultat = await appelApi(
    `https://www.googleapis.com/drive/v3/files?q=${requete}&fields=files(id)`,
    accessToken
  );
  return resultat.files?.[0]?.id ?? null;
}

/**
 * Retourne l'identifiant du classeur GymCoach, en le créant si besoin
 * (toute première utilisation). Résultat mis en cache localement pour
 * éviter une recherche Drive à chaque appel — mais reste retrouvable sur un
 * nouvel appareil grâce à `rechercherClasseur`, sans jamais rien dupliquer.
 */
export async function obtenirIdClasseur(accessToken) {
  if (idClasseurEnCache) return idClasseurEnCache;

  const idDepuisCache = localStorage.getItem(CLE_CACHE_ID_CLASSEUR);
  if (idDepuisCache) {
    idClasseurEnCache = idDepuisCache;
    return idDepuisCache;
  }

  let id = await rechercherClasseur(accessToken);
  if (!id) {
    id = await creerClasseur(accessToken);
  }

  idClasseurEnCache = id;
  localStorage.setItem(CLE_CACHE_ID_CLASSEUR, id);
  return id;
}

/** Charge l'intégralité d'un onglet et le convertit en tableau d'objets. */
export async function chargerOnglet(accessToken, nomOnglet) {
  const colonnes = ONGLETS[nomOnglet];
  if (!colonnes) throw new Error(`Onglet inconnu : ${nomOnglet}`);

  const idClasseur = await obtenirIdClasseur(accessToken);
  const resultat = await appelApi(
    `https://sheets.googleapis.com/v4/spreadsheets/${idClasseur}/values/${encoderPlage(nomOnglet)}`,
    accessToken
  );

  const lignes = (resultat.values ?? []).slice(1); // on ignore la ligne d'en-tête
  return lignes
    .filter((ligne) => ligne.some((valeur) => valeur !== ""))
    .map((ligne) => Object.fromEntries(colonnes.map((cle, index) => [cle, ligne[index] ?? ""])));
}

/** Réécrit l'intégralité d'un onglet (en-têtes + lignes) à partir d'objets JS. */
export async function enregistrerOnglet(accessToken, nomOnglet, objets) {
  const colonnes = ONGLETS[nomOnglet];
  if (!colonnes) throw new Error(`Onglet inconnu : ${nomOnglet}`);

  const idClasseur = await obtenirIdClasseur(accessToken);
  const valeurs = [
    colonnes,
    ...objets.map((objet) => colonnes.map((cle) => objet[cle] ?? "")),
  ];

  // On efface d'abord une plage large (au cas où l'onglet contenait plus de
  // lignes qu'on n'en réécrit), puis on écrit les nouvelles valeurs.
  await appelApi(
    `https://sheets.googleapis.com/v4/spreadsheets/${idClasseur}/values/${encoderPlage(nomOnglet, "!A1:Z5000")}:clear`,
    accessToken,
    { method: "POST", body: JSON.stringify({}) }
  );

  await appelApi(
    `https://sheets.googleapis.com/v4/spreadsheets/${idClasseur}/values/${encoderPlage(nomOnglet, "!A1")}?valueInputOption=RAW`,
    accessToken,
    { method: "PUT", body: JSON.stringify({ values: valeurs }) }
  );
}
