/* ============================================================================
 *  NOTIFICACIONES PUSH — lado del navegador
 *
 *  Avisos:
 *   · En iPhone SOLO funciona con la app instalada en la pantalla de inicio
 *     (iOS 16.4+). Desde Safari normal el navegador ni siquiera ofrece la
 *     opción. Por eso detectamos ese caso y lo explicamos en vez de fallar.
 *   · El permiso hay que pedirlo desde un clic del usuario. Si se pide solo al
 *     cargar, los navegadores lo deniegan de oficio.
 * ========================================================================== */

import { supabase } from './db.js';

const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();

/* La clave VAPID viaja en base64url y el navegador la quiere en bytes. */
function claveABytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const enIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const push = {
  configurado: () => Boolean(VAPID_PUBLIC),

  /* Devuelve por qué NO se puede, o null si se puede. */
  motivoNoDisponible() {
    if (!VAPID_PUBLIC) return 'Falta la clave VITE_VAPID_PUBLIC_KEY en el hosting.';
    if (!('serviceWorker' in navigator)) return 'Este navegador no admite notificaciones.';
    if (!('PushManager' in window)) {
      if (enIOS() && !instalada()) {
        return 'En iPhone hay que instalar la app primero: Compartir → Añadir a pantalla de inicio, y abrirla desde el icono.';
      }
      return 'Este navegador no admite notificaciones push.';
    }
    if (enIOS() && !instalada()) {
      return 'Abre la app desde su icono en la pantalla de inicio, no desde Safari.';
    }
    if (Notification.permission === 'denied') {
      return 'Bloqueaste las notificaciones. Hay que permitirlas en los ajustes del navegador.';
    }
    return null;
  },

  async estado() {
    if (this.motivoNoDisponible()) return 'no-disponible';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return sub ? 'activadas' : 'desactivadas';
    } catch {
      return 'no-disponible';
    }
  },

  /* Pide permiso, se suscribe y guarda la suscripción. Devuelve error o null. */
  async activar() {
    const motivo = this.motivoNoDisponible();
    if (motivo) return motivo;

    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') return 'No has dado permiso para las notificaciones.';

      const reg = await navigator.serviceWorker.ready;

      // Si ya había una suscripción vieja, fuera: la clave VAPID puede haber
      // cambiado y entonces los envíos fallarían en silencio.
      const previa = await reg.pushManager.getSubscription();
      if (previa) await previa.unsubscribe();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveABytes(VAPID_PUBLIC),
      });

      const j = sub.toJSON();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 'Tu sesión ha caducado. Sal y vuelve a entrar.';

      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: j.endpoint,
        p256dh: j.keys.p256dh,
        auth: j.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      }, { onConflict: 'endpoint' });

      if (error) return `No se pudo guardar: ${error.message}`;
      return null;
    } catch (e) {
      return `No se pudieron activar: ${e?.message || e}`;
    }
  },

  async desactivar() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      return null;
    } catch (e) {
      return `No se pudieron desactivar: ${e?.message || e}`;
    }
  },
};
