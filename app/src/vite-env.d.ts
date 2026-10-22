/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

/** ReadAloud's version from package.json, set by vite.config.ts. */
declare const __APP_VERSION__: string;
