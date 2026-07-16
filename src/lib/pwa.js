/* ============================================================================
 *  ACTUALIZACIÓN INSTANTÁNEA
 *
 *  Cuando publicas un cambio, tus clientes no tienen que hacer nada: la app
 *  comprueba si hay versión nueva cada minuto, al volver a primer plano y al
 *  recuperar conexión, y se recarga sola.
 *
 *  Nota: el registro del service worker lo hace el propio plugin (opción
 *  `injectRegister: 'script'` en vite.config.js, que mete un <script> en el
 *  index.html). Aquí NO importamos 'virtual:pwa-register' a propósito: es un
 *  módulo fantasma que solo existe durante el build y hacía fallar el
 *  despliegue. Este archivo usa únicamente APIs estándar del navegador, así
 *  que no puede romper la construcción.
 * ========================================================================== */

export function setupAutoUpdate() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // ¿Ya había una versión controlando la página? Si no la había, el primer
  // "controllerchange" es la instalación inicial y NO debe recargar nada.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.ready
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      setInterval(check, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    })
    .catch(() => { /* sin service worker: la app funciona igual, sin recarga sola */ });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}
