/* Offline snapshots are complete, versioned, and scoped to this installation. */
importScripts('./precache-manifest.js');
const { version, files } = self.UNIVERSE_PRECACHE;
const base = new URL(self.registration.scope);
const prefix = `universe-explorer:${encodeURIComponent(base.pathname)}:`;
const cacheName = prefix + version;
const indexUrl = new URL('index.html', base).href;
const urls = new Map(files.map(file => {
  const url = new URL(file.path, base);
  return [url.pathname, url.href];
}));

async function populate(cache) {
  await cache.addAll(files.map(file => new Request(new URL(file.path, base), {
    cache: 'reload', credentials: 'same-origin', redirect: 'error', integrity: file.integrity
  })));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existed = (await caches.keys()).includes(cacheName);
    const cache = await caches.open(cacheName);
    try {
      // Integrity prevents a partially uploaded release from replacing a good one.
      await populate(cache);
    } catch (error) {
      // A partial upload may pair a new worker with the active manifest version.
      // addAll commits atomically; never delete a pre-existing working snapshot.
      if (!existed) await caches.delete(cacheName);
      throw error;
    }
    // No skipWaiting: open pages retain their matching scripts and textures.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== base.origin) return;
  const canonical = url.pathname === base.pathname ? indexUrl : urls.get(url.pathname);
  if (!canonical) return; // Do not intercept other applications, APIs, or unknown paths.
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(canonical) || fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (!['OFFLINE_STATUS', 'REPAIR_OFFLINE'].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    if (event.data.type === 'REPAIR_OFFLINE') {
      try { await populate(cache); }
      catch { event.ports[0].postMessage({ ready: false, version }); return; }
    }
    const matches = await Promise.all(files.map(file => cache.match(new URL(file.path, base).href)));
    event.ports[0].postMessage({ ready: matches.every(Boolean), version, files: files.length });
  })());
});
