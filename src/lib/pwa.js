/* ============================================================================
 *  ACTUALIZACIÓN INSTANTÁNEA
 *
 *  Cuando publicas un cambio, tus clientes no tienen que hacer nada: la app
 *  comprueba si hay versión nueva cada minuto y al volver a primer plano, y
 *  se recarga sola. Sin App Store, sin "actualiza la app".
 * ========================================================================== */

import { registerSW } from 'virtual:pwa-register';

export function setupAutoUpdate() {
  if (!('serviceWorker' in navigator)) return;

  // ¿Ya había una versión instalada? Si no la había, el primer "controllerchange"
  // es la instalación inicial y NO debe provocar recarga.
  const hadController = !!navigator.serviceWorker.controller;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { updateSW(true); },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => reg.update().catch(() => {});
      setInterval(check, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    },
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}
