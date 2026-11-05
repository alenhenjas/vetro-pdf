import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** In produzione una CSP impedisce qualsiasi connessione verso l'esterno: tutto resta locale. */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
  ].join('; ');
  return {
    name: 'vetro-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig({
  // La demo su GitHub Pages vive in una sottocartella; in locale resta la radice.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*'],
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ttf,png,svg,wasm,bcmap,pfb,icc,json}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Vetro PDF',
        short_name: 'Vetro PDF',
        description: 'Scrivi, disegna e incolla immagini sui tuoi PDF. Tutto in locale.',
        lang: 'it',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#f2f3f7',
        background_color: '#f2f3f7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Campi non ancora tipizzati da vite-plugin-pwa: "Apri con" dal menu di Windows.
        ...({
          file_handlers: [{ action: '.', accept: { 'application/pdf': ['.pdf'] } }],
          launch_handler: { client_mode: 'navigate-new' },
        } as object),
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
  preview: { port: 4173 },
});
