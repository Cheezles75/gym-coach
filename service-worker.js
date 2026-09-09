/*
  service-worker.js — Mise en cache de l'app shell
  ---------------------------------------------------
  Stratégie volontairement simple à ce stade :
  - "App shell" (HTML/CSS/JS/manifest) : cache-first, pour un chargement
    instantané et un fonctionnement minimal hors-ligne.
  - Tout le reste (futurs appels Google Sheets / AWS) : jamais mis en
    cache ici, ces appels géreront leur propre résilience (IndexedDB).

  CACHE_VERSION doit être incrémenté à chaque changement de l'app shell
  pour forcer la mise à jour du cache chez l'utilisateur.
*/

const CACHE_VERSION = "gymcoach-shell-v3";

const FICHIERS_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/reset.css",
  "./css/variables.css",
  "./css/layout.css",
  "./css/components.css",
  "./js/app.js",
  "./js/config.js",
  "./js/auth.js",
  "./js/cognito.js",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(FICHIERS_APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(
          noms
            .filter((nom) => nom !== CACHE_VERSION)
            .map((nom) => caches.delete(nom))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evenement) => {
  // On ne gère que les requêtes GET du même domaine (l'app shell).
  // Les appels vers Google/AWS partent directement au réseau, sans
  // passer par ce cache.
  if (evenement.request.method !== "GET") return;

  const url = new URL(evenement.request.url);
  if (url.origin !== self.location.origin) return;

  evenement.respondWith(
    caches.match(evenement.request).then((reponseCache) => {
      if (reponseCache) return reponseCache;

      return fetch(evenement.request).catch(() => {
        // Hors-ligne et pas en cache : on retombe sur la page d'accueil
        // plutôt que de laisser une erreur réseau brute (§11).
        return caches.match("./index.html");
      });
    })
  );
});
