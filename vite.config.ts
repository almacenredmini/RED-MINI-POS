/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages sirve el sitio bajo /<repo>/. Se puede sobreescribir con BASE_PATH.
const base = process.env.BASE_PATH ?? '/RED-MINI-POS/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'RED MINI pos',
        short_name: 'RED MINI',
        description: 'Punto de venta offline-first para RED MINI',
        lang: 'es-AR',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Sólo latin/latin-ext de Inter: el resto de los alfabetos no se usa y no vale la pena precachearlo.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}', '**/*latin*.woff2'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    // Cada test de sincronización levanta un PostgreSQL entero: en GitHub Actions tarda más que en la PC.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
