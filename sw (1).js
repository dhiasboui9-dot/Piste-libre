const CACHE = 'piste-libre-v5';
const TILES = 'piste-libre-tuiles';
const MAX_TILES = 400;
const FILES = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './course.js', './carte.js', './historique.js', './historique.html', './partage-story.html'
];

self.addEventListener('install', e => {
  // chaque fichier est ajouté séparément : un fichier manquant ne bloque pas l'installation
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k)))));
  self.clients.claim();
});

// garde au plus MAX_TILES tuiles de carte (les plus anciennes sont supprimées)
function trim(cache) {
  return cache.keys().then(keys =>
    keys.length > MAX_TILES
      ? Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)))
      : null);
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Tuiles de la carte : cache d'abord (économise les données, marche hors ligne sur les zones déjà vues)
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    e.respondWith(caches.open(TILES).then(c =>
      c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        if (r.ok) c.put(e.request, r.clone()).then(() => trim(c)).catch(() => {});
        return r;
      }))));
    return;
  }

  // Le reste : réseau d'abord (toujours à jour), cache si hors-ligne
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && url.protocol.startsWith('http')) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
