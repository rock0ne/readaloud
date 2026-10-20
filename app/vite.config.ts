import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Content Security Policy (spec 15). Added to production builds only, because the
// dev server injects inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self' https://*.tts.speech.microsoft.com https://huggingface.co https://*.hf.co",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'readaloud-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [
    preact(),
    cspMeta(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ReadAloud',
        short_name: 'ReadAloud',
        description: 'Listen to documents with natural voices and flag mistakes while you listen.',
        lang: 'en-GB',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#f7f5f0',
        theme_color: '#1f5f8b',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: '.',
            accept: {
              'text/plain': ['.txt'],
              'text/markdown': ['.md', '.markdown'],
              'application/pdf': ['.pdf'],
              'application/epub+zip': ['.epub'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
});
