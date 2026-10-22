import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import preact from '@preact/preset-vite';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { licences } from './licences.ts';

// Content Security Policy (spec 15). Added to production builds only, because the
// dev server injects inline scripts for hot reload. 'wasm-unsafe-eval' lets the Kokoro voice
// and pdf.js compile WebAssembly; it does not allow eval of JavaScript (ADR-22). The three AI
// hosts are reached only when the reader adds their own key and asks for something (ADR-30).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self' https://huggingface.co https://*.hf.co https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

// Cross-origin isolation lets onnxruntime use several threads for the Kokoro voice (ADR-22).
// 'credentialless' still allows the model download from Hugging Face, which is fetched with CORS.
// Firefox on Android ignores it and runs Kokoro on one thread, which is verified to read (S21+).
// 'require-corp' would give it 4 threads, but in the app the voice then stalled while loading,
// cause not yet known (ADR-22).
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// onnxruntime-web's WebAssembly runtime for Kokoro, served from this origin at /ort/ instead of
// the jsDelivr CDN transformers.js would use, so the voice also starts offline (ADR-22).
const ORT_FILES: Record<string, string> = {
  'ort-wasm-simd-threaded.jsep.mjs': 'text/javascript',
  'ort-wasm-simd-threaded.jsep.wasm': 'application/wasm',
};

function ortDir(): string {
  const kokoro = createRequire(import.meta.url).resolve('kokoro-js');
  return dirname(createRequire(kokoro).resolve('@huggingface/transformers'));
}

function ortWasm(): Plugin {
  const dir = ortDir();
  return {
    name: 'readaloud-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = /\/ort\/([^/?]+)/.exec(req.url ?? '')?.[1];
        const type = name ? ORT_FILES[name] : undefined;
        if (!name || !type) return next();
        res.setHeader('Content-Type', type);
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(ORT_FILES)) {
        this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

function cspMeta(): Plugin {
  return {
    name: 'readaloud-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// `vite build --mode android` makes the web files for the Android app (ADR-27): they come from the
// APK, so there is no service worker to install or update.
export default defineConfig(({ mode }) => {
  const notices = licences(mode);
  return {
    define: {
      __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version),
    },
    plugins: [
      preact(),
      cspMeta(),
      // Every package's licence text goes into the download, in licences/ (ADR-38).
      notices.plugin,
      // The app does not use the browser Kokoro, so it does not need onnxruntime's 22 MB runtime.
      mode !== 'android' && ortWasm(),
      VitePWA({
        disable: mode === 'android',
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
          // The onnxruntime .wasm (about 22 MB) is precached so Kokoro starts offline.
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm}'],
          maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
          // eSpeak for the Android app's phonemes (ADR-27); browsers never load it.
          globIgnores: ['**/phonemes-*.js'],
          navigateFallback: 'index.html',
        },
      }),
    ],
    build: {
      outDir: mode === 'android' ? 'dist-android' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
    },
    resolve: {
      // onnxruntime-web's build that loads its runtime from wasmPaths (/ort/) rather than a second,
      // hashed copy of the 22 MB .wasm in assets/.
      conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
    },
    server: { headers: ISOLATION_HEADERS },
    preview: { headers: ISOLATION_HEADERS },
    worker: {
      format: 'es',
      plugins: () => [notices.worker()],
    },
  };
});
