const CACHE = 'trust-tally-shell-v13';
const SHELL = ['/', '/index.html', '/styles.css', '/pages.css', '/ui.css', '/app.js', '/pages.js', '/units.js', '/item-display.js', '/khata.js', '/offline.js', '/page-catalog.json', '/manifest.webmanifest', '/assets/icon.svg', '/assets/icon-192.png', '/assets/icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async()=>{
  const catalog=await fetch('/page-catalog.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('Page catalog unavailable');return response.json();});
  const cache=await caches.open(CACHE);
  await cache.addAll([...SHELL,...catalog.map(page=>page.path)]);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('trust-tally-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache API responses, customer records, payment proofs, or authentication.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async() => (await caches.match(url.pathname)) || caches.match('/index.html')));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(fetch(event.request).then(response => {
      if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
      return response;
    }).catch(()=>caches.match(event.request)));
  }
});
