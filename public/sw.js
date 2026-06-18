// Service worker del Cuarenta — patrón estándar del ecosistema Dotrino:
// navegación network-first SIN HTTP-cache (cache:'reload'), para que un deploy
// nuevo se vea en la siguiente recarga y no quede atrapado por el max-age del CDN;
// offline cae a caché. Resto cache-first con refresco en segundo plano (los
// assets llevan hash de contenido). Subir CACHE en cada cambio.
const CACHE = 'cuarenta-v6'
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // no cachear proxy/goat/jsdelivr

  // Navegación (HTML): network-first SIN HTTP-cache (cache:'reload'), para no
  // quedar pegado al max-age del CDN y ver el deploy nuevo en la próxima recarga.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'reload', credentials: 'same-origin' }).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put('./index.html', copy))
        return res
      }).catch(() => caches.match('./index.html').then((r) => r || caches.match(req)))
    )
    return
  }

  // Resto: cache-first con refresco en segundo plano.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})
