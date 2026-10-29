/* NEW LIFE — Service Worker (PWA / modo offline)
   Missão: o sistema tem que ABRIR e NAVEGAR sem sinal (regra do Fabio,
   22/10/2026) — o técnico chega em hospital/subsolo sem internet e a página
   não pode abrir em branco. Para isso o aparelho guarda o pacote COMPLETO
   do sistema no primeiro acesso com internet.
   Desde a v6 o pacote é 100% same-origin: as bibliotecas das quais a
   página depende (Tailwind, Chart.js, Leaflet + imagens) foram VENDORADAS
   para dentro do repositório (pasta js/) — nenhum script vem mais de CDN.
   Sem elo externo, não há o que ficar de fora do pacote.
   O que ele NUNCA intercepta:
   - qualquer método != GET (REST POST/PATCH/DELETE, uploads) e HEAD
     (a trava anti-cache __checkVersion usa HEAD no-store e segue intacta);
   - o Supabase (REST, auth e storage) — dado é sempre da rede; offline,
     quem responde é o snapshot + a fila do próprio app (IndexedDB).
   Estratégia:
   - Documento (navegação): network-first — online o app é SEMPRE o mais
     novo (preserva a trava anti-cache); offline, cai para a cópia do
     cache e o app abre.
   - Demais arquivos do pacote: stale-while-revalidate (abre instantâneo
     do cache e atualiza em segundo plano). */
const NL_CACHE = 'nl-shell-v7';
const NL_SHELL = [
  './',
  './index.html',
  './logo.png',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './js/tailwind-3.4.17.js',
  './js/chart.umd.min.js',
  './js/leaflet/leaflet.js',
  './js/leaflet/leaflet.css',
  './js/leaflet/images/marker-icon.png',
  './js/leaflet/images/marker-icon-2x.png',
  './js/leaflet/images/marker-shadow.png',
  './js/leaflet/images/layers.png',
  './js/leaflet/images/layers-2x.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(NL_CACHE);
    // um a um, com catch individual: UMA URL quebrada nunca derruba o
    // pacote inteiro (o addAll antigo era tudo-ou-nada).
    for (const u of NL_SHELL) { try { await c.add(u); } catch (_) {} }
    await self.skipWaiting();
  })());
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
  if (url.hostname.endsWith('supabase.co')) return; // dados: sempre rede
  if (url.origin !== self.location.origin) return; // cross-origin: direto

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

  // Demais GET same-origin (pacote: js, logo, ícones, manifest):
  // stale-while-revalidate
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

/* ---------- 🔔 NOTIFICAÇÕES PUSH (29/10/2026) ----------
   Quem entrega com o sistema FECHADO é o serviço de notificações da
   Apple/Google: o servidor (Edge Function enviar-push) manda o aviso
   cifrado pra eles, eles entregam no aparelho e quem acorda é ESTE
   service worker — a página nunca precisa abrir. O payload é montado
   pela função: { titulo, corpo, tag, os_id, url }. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { try { d = { corpo: e.data.text() }; } catch (__) {} }
  const titulo = d.titulo || '🔔 NEW LIFE';
  const opcoes = {
    body: d.corpo || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'nl-push',
    data: { url: d.url || '/', os_id: d.os_id || '' }
  };
  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        try { await w.navigate(url); } catch (_) {}
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
