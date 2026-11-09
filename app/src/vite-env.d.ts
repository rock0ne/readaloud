/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

/** ReadAloud's version from package.json, set by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Hosted edition excludes compressed encoders while redistribution is held. */
declare const __COMPRESSED_EXPORTS__: boolean;
