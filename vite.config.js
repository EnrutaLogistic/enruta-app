import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Sello de versión: se incrusta al construir y se ve en la pantalla de acceso.
// Sirve para comprobar de un vistazo si un cambio ya ha llegado al móvil de un
// cliente, sin tener que preguntárselo.
const VERSION = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(VERSION)
  },
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' + skipWaiting/clientsClaim: la versión nueva toma el
      // control en cuanto existe, sin esperar a que el usuario cierre la app.
      registerType: 'autoUpdate',
      // El plugin inyecta él mismo el <script> que registra el service worker.
      // Así no dependemos del módulo virtual 'virtual:pwa-register', que hacía
      // fallar el build en Netlify.
      injectRegister: 'script',
      includeAssets: ['apple-touch-icon.png', 'push-sw.js'],
      manifest: {
        name: 'Enruta Logistic App',
        short_name: 'Enruta',
        description: 'Gestión de almacén y pedidos',
        theme_color: '#1C2418',
        background_color: '#F2F3EF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        lang: 'es',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Carga nuestro trozo de service worker para las notificaciones push.
        // El resto del sw lo genera el plugin; así no hay que mantenerlo a mano.
        importScripts: ['/push-sw.js'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // La app necesita datos frescos: el stock NUNCA se sirve de caché.
        runtimeCaching: [{
          urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
          handler: 'NetworkOnly'
        }]
      }
    })
  ]
});
