/* ============================================================================
 *  Trozo de service worker que atiende las notificaciones push.
 *
 *  El service worker principal lo genera el plugin de PWA automáticamente, así
 *  que no lo podemos tocar. Pero sí podemos pedirle que cargue este archivo
 *  (opción workbox.importScripts en vite.config.js). Así conviven: el suyo se
 *  encarga de la caché y este de los avisos.
 * ========================================================================== */

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* aviso sin datos */ }

  const title = d.title || 'Enruta Logistic';
  const options = {
    body: d.body || 'Tienes un pedido nuevo',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // El tag hace que dos avisos del MISMO pedido no se apilen, pero dos
    // pedidos distintos sí se vean por separado.
    tag: d.tag || 'enruta',
    data: { url: d.url || '/' },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  // Si la app ya está abierta, la traemos al frente en vez de abrir otra.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
