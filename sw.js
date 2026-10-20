/* NEW LIFE — Service Worker (PWA / modo offline)
   Escopo MÍNIMO e proposital:
   - Só intercepta GET same-origin (o "shell" do app: documento, logo, ícones, manifest).
   - TODO o resto passa direto, sem tocar: cross-origin (Supabase, CDNs), qualquer
     método != GET (REST POST/PATCH/DELETE, uploads de foto/assinatura) e HEAD
     (a trava anti-cache __checkVersion usa HEAD no-store e continua intacta).
   Estratégia:
   - Documento (navegação): network-first — online o app é SEMPRE o mais novo
     (preserva a trava anti-cache); offline, cai para a cópia do cache e o app abre.
   - Demais arquivos do shell: stale-while-revalidate (abre instantâneo do cache
     e atualiza em segundo plano). */
const NL_CACHE = 'nl-shell-v1';
const NL_SHELL = [
  './',
  './index.html',
  './logo.png',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(NL_CACHE)
      .then((c) => c.addAll(NL_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== NL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST/PATCH/DELETE/HEAD: não intercepta
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // Supabase/CDNs: não intercepta

  // Documento: network-first (online = versão nova; offline = cache)
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then((r) => {
        if (r && r.ok) {
          const copia = r.clone();
          const copia2 = r.clone();
          caches.open(NL_CACHE).then((c) => { c.put(req, copia); c.put('./index.html', copia2); });
        }
        return r;
      }).catch(() => caches.match('./index.html', { ignoreSearch: true })
        .then((m) => m || caches.match('./', { ignoreSearch: true })))
    );
    return;
  }

  // Demais GET same-origin (logo, ícones, manifest, sw assets): stale-while-revalidate
  e.respondWith(
    caches.open(NL_CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const rede = fetch(req).then((r) => {
        if (r && r.ok) cache.put(req, r.clone());
        return r;
      }).catch(() => cached);
      return cached || rede;
    })
  );
});
