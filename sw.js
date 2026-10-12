/**
 * sw.js — service worker de Learnida (PWA, fonctionne hors ligne)
 *
 * Deux caches :
 *  - SHELL   : code de l'application (HTML/CSS/JS/manifest/icônes), listé
 *              explicitement ci-dessous, servi "cache d'abord" (démarrage instantané).
 *  - RUNTIME : données (data/) et assets (assets/), servis "réseau d'abord avec
 *              délai maximum" puis repli sur le cache.
 *
 * Ce qui rend l'app VRAIMENT utilisable hors ligne dès l'installation :
 *  - À l'installation, on précharge (en tâche de fond, sans jamais bloquer
 *    l'installation) subjects.json, TOUS les fichiers de questions, les images
 *    de questions et les sons. Ajouter une matière/séquence dans subjects.json
 *    ne demande donc aucune modification de ce fichier.
 *  - Toute navigation (ouverture de l'app, rechargement) retombe sur index.html.
 *  - Réseau lent ou instable : après NETWORK_TIMEOUT_MS on sert la copie en cache
 *    au lieu de faire attendre l'utilisateur (la copie se met à jour en arrière-plan).
 *  - Les sons (<audio>) envoient des requêtes partielles "Range" : elles sont
 *    gérées correctement (réponse 206 reconstruite depuis le cache).
 *
 * ⚠️ À CHAQUE modification du code (js/css/html), incrémente VERSION : c'est ce
 * qui force les appareils déjà installés à récupérer la nouvelle version.
 */

const VERSION = 'v5'; // v5 : PWA complète (installation, hors ligne robuste)
const CACHE_SHELL = `learnida-shell-${VERSION}`;
const CACHE_RUNTIME = `learnida-runtime-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3500;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/themes.css',
  './css/style.css',
  './css/responsive.css',
  './css/splash.css',
  './js/splash.js',
  './js/pwa.js',
  './js/storage.js',
  './js/settings.js',
  './js/audio.js',
  './js/questions.js',
  './js/progression.js',
  './js/notes.js',
  './js/quiz.js',
  './js/stats.js',
  './js/milestones.js',
  './js/ui.js',
  './js/router.js',
  './js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/apple-touch-icon.png'
];

const SOUND_FILES = [
  './assets/sounds/click.mp3',
  './assets/sounds/correct.mp3',
  './assets/sounds/incorrect.mp3',
  './assets/sounds/badge.mp3',
  './assets/sounds/bgm.mp3'
];

// ---------------------------------------------------------------------
// Installation : app shell (obligatoire) + précharge du contenu (facultative)
// ---------------------------------------------------------------------

async function precacheContent() {
  const cache = await caches.open(CACHE_RUNTIME);
  const urls = new Set(SOUND_FILES);

  try {
    const res = await fetch('./data/config/subjects.json', { cache: 'no-store' });
    if (res.ok) {
      await cache.put('./data/config/subjects.json', res.clone());
      const config = await res.json();
      const files = [];
      for (const ue of config.ues || []) {
        for (const subject of ue.subjects || []) {
          for (const seq of subject.sequences || []) {
            files.push(`./data/questions/${subject.id}/${seq.file}`);
          }
        }
      }

      // Questions (+ images référencées par les questions)
      await Promise.allSettled(files.map(async (url) => {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return;
        await cache.put(url, r.clone());
        try {
          const data = await r.json();
          const list = Array.isArray(data) ? data : (data.quiz || data.questions || data.items || data.data || []);
          for (const q of list) if (q && q.image) urls.add(`./assets/${q.image}`);
        } catch (err) { /* JSON illisible : l'app l'ignorera aussi */ }
      }));
    }
  } catch (err) {
    // Hors ligne pendant l'installation : le contenu sera mis en cache au premier usage.
  }

  await Promise.allSettled([...urls].map(async (url) => {
    const r = await fetch(url);
    if (r.status === 200) await cache.put(url, r);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => precacheContent().catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_SHELL && key !== CACHE_RUNTIME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Permet à la page de demander l'activation immédiate d'une nouvelle version.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---------------------------------------------------------------------
// Stratégies
// ---------------------------------------------------------------------

/** Reconstruit une réponse 206 (requête "Range") à partir d'une réponse complète en cache. */
async function rangeFromCache(request, cached) {
  const match = /bytes=(\d+)-(\d*)/.exec(request.headers.get('range') || '');
  if (!match) return cached;
  const buffer = await cached.arrayBuffer();
  const total = buffer.byteLength;
  const start = Math.min(parseInt(match[1], 10), total - 1);
  const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

/** App shell : cache d'abord. Les navigations retombent sur index.html (SPA). */
async function shellFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

/** Données/assets : réseau d'abord (avec délai maximum), repli sur le cache. */
async function networkFirst(event, request) {
  const cache = await caches.open(CACHE_RUNTIME);
  const isRange = request.headers.has('range');
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });

  // Sons & médias : les requêtes partielles se servent depuis le cache si possible.
  if (isRange) {
    if (cached) return rangeFromCache(request, cached);
    return fetch(request);
  }

  const fromNetwork = fetch(request).then((response) => {
    // Seules les réponses complètes (200) peuvent être mises en cache (pas les 206).
    if (response && response.status === 200) {
      const copy = response.clone();
      event.waitUntil(cache.put(request, copy).catch(() => {}));
    }
    return response;
  });

  if (!cached) return fromNetwork;

  // Un cache existe : on ne fait jamais attendre plus de NETWORK_TIMEOUT_MS.
  event.waitUntil(fromNetwork.catch(() => {}));
  return Promise.race([
    fromNetwork,
    new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS))
  ]).catch(() => cached);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDataOrAsset = url.pathname.includes('/data/') || url.pathname.includes('/assets/sounds/')
    || (url.pathname.includes('/assets/') && !url.pathname.includes('/assets/icons/'));

  if (isDataOrAsset) {
    event.respondWith(networkFirst(event, request));
  } else {
    event.respondWith(shellFirst(request));
  }
});
