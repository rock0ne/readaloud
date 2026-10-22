// The licence texts go inside every download, the Windows zip, the Pages site and the APK, not
// only into the repository (ADR-38). The build lists the packages from its own bundle, so the list
// always matches what is shipped, and it fails when a package in it has no licence text.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const APP = dirname(fileURLToPath(import.meta.url));
/** Texts that are not in node_modules, with where each comes from: app/licences/index.json. */
const OWN = join(APP, 'licences');
const LICENCE_FILE = /^(licen[cs]e|copying|notice)/i;

interface Manifest {
  web: Record<string, { files: string[] }>;
  android: Array<{ name: string; version: string; in: string; licence: string; files: string[]; libraries?: string[] }>;
}

interface Package {
  root: string;
  name: string;
  version: string;
  licence: string;
}

/** The folder of the npm package a bundled module comes from, or null for ReadAloud's own code. */
export function packageRoot(id: string): string | null {
  const path = id.replace(/^\0/, '').split('?')[0]!.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);
  if (at < 0) return null;
  const parts = path.slice(at + marker.length).split('/');
  const n = parts[0]?.startsWith('@') ? 2 : 1;
  if (parts.length <= n) return null;
  return path.slice(0, at + marker.length) + parts.slice(0, n).join('/');
}

function readPackage(root: string): Package {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: string | { type?: string } };
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'not stated in package.json');
  return { root, name: pkg.name, version: pkg.version, licence };
}

/** The folder of package `name` as seen from the file `from`. */
function resolveRoot(from: string, name: string): string {
  const require = createRequire(from);
  let entry: string;
  try {
    entry = require.resolve(`${name}/package.json`);
  } catch {
    entry = require.resolve(name);
  }
  let dir = dirname(entry);
  while (!existsSync(join(dir, 'package.json')) || readPackage(dir).name !== name) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`licences: cannot find the folder of ${name}`);
    dir = up;
  }
  return dir;
}

function text(path: string): string {
  return readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd();
}

function section(title: string, lines: string[], files: Array<[string, string]>): string {
  const rule = '='.repeat(78);
  return [rule, title, ...lines, rule, '', ...files.flatMap(([name, body]) => [`--- ${name} ---`, '', body, ''])].join('\n');
}

/** The package's own licence files, else the texts kept for it in app/licences/web/; null if neither. */
function packageTexts(p: Package, manifest: Manifest): Array<[string, string]> | null {
  const files = readdirSync(p.root).filter((f) => LICENCE_FILE.test(f) && statSync(join(p.root, f)).isFile());
  if (files.length) return files.sort().map((f) => [f, text(join(p.root, f))]);
  const own = manifest.web[p.name];
  return own ? own.files.map((f) => [basename(f), text(join(OWN, 'web', f))]) : null;
}

/**
 * JSZip's ready-built file carries its own copy of pako (1.0.x, exact version not known), which the
 * bundle cannot see as a package: its texts come from the pako package JSZip depends on, the MIT
 * licence and the zlib notice at the top of pako's zlib files.
 */
function pakoInJszip(jszip: Package): string {
  const pako = readPackage(resolveRoot(join(jszip.root, 'package.json'), 'pako'));
  const header = text(join(pako.root, 'lib', 'zlib', 'deflate.js'))
    .split('\n')
    .filter((l) => l.startsWith('//'))
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n');
  return section(
    "pako (inside JSZip's ready-built file)",
    [`Version: JSZip ${jszip.version}'s own copy of pako 1.0.x; the texts are from pako ${pako.version}, which JSZip depends on.`, 'Licence: MIT, with zlib code under the zlib licence'],
    [['LICENSE', text(join(pako.root, 'LICENSE'))], ['lib/zlib/deflate.js (header)', header]],
  );
}

/** The bundle's packages: each chunk lists the modules it holds. */
function collect(roots: Set<string>, bundle: object): void {
  for (const out of Object.values(bundle) as Array<{ type: string; moduleIds?: readonly string[] }>) {
    for (const id of out.moduleIds ?? []) {
      const root = packageRoot(id);
      if (root) roots.add(root);
    }
  }
}

/**
 * `plugin` goes in plugins, `worker` in worker.plugins: the workers are built first, while the
 * main build reads its modules, so their packages are known when the main bundle is written.
 */
export function licences(mode: string): { plugin: Plugin; worker: () => Plugin } {
  const roots = new Set<string>();
  const version = (JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { version: string }).version;
  const worker = (): Plugin => ({
    name: 'readaloud-licences-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      collect(roots, bundle);
    },
  });
  const plugin: Plugin = {
    name: 'readaloud-licences',
    apply: 'build',
    generateBundle(_options, bundle) {
      collect(roots, bundle);
      const manifest = JSON.parse(readFileSync(join(OWN, 'index.json'), 'utf8')) as Manifest;
      if (mode !== 'android') {
        // Not modules of the bundle, but shipped: onnxruntime-web's runtime in ort/, and Workbox
        // inside the service worker that vite-plugin-pwa writes after this bundle.
        const transformers = resolveRoot(createRequire(import.meta.url).resolve('kokoro-js'), '@huggingface/transformers');
        roots.add(resolveRoot(join(transformers, 'package.json'), 'onnxruntime-web'));
        const build = resolveRoot(resolveRoot(fileURLToPath(import.meta.url), 'vite-plugin-pwa') + '/package.json', 'workbox-build');
        for (const name of ['workbox-core', 'workbox-precaching', 'workbox-routing']) roots.add(resolveRoot(build + '/package.json', name));
      }
      const seen = new Map<string, Package>();
      for (const root of roots) {
        const p = readPackage(root);
        seen.set(`${p.name}@${p.version}`, p);
      }
      const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
      const missing = packages.filter((p) => !packageTexts(p, manifest)).map((p) => `${p.name}@${p.version}`);
      if (missing.length) throw new Error(`licences: no licence text for ${missing.join(', ')}. Add it to app/licences/web/ and index.json.`);
      const web = [
        `Licences of the packages whose code is in ReadAloud ${version}${mode === 'android' ? ' for Android' : ''}: ${packages.length} packages.`,
        'The build lists them from its own bundle, so this list matches this download.',
        'ReadAloud itself: LICENSE.txt (GNU GPL version 3 or later). Sources and notes: NOTICES.md.',
        '',
        ...packages.map((p) => section(`${p.name} ${p.version}`, [`Licence: ${p.licence}`], packageTexts(p, manifest)!)),
        ...packages.filter((p) => p.name === 'jszip').map(pakoInJszip),
      ];
      this.emitFile({ type: 'asset', fileName: 'licences/web.txt', source: web.join('\n') });
      this.emitFile({ type: 'asset', fileName: 'licences/LICENSE.txt', source: text(join(APP, '..', 'LICENSE')) + '\n' });
      this.emitFile({ type: 'asset', fileName: 'licences/NOTICES.md', source: text(join(APP, '..', 'THIRD-PARTY-NOTICES.md')) + '\n' });
      if (mode === 'android') {
        const capacitor = readPackage(resolveRoot(fileURLToPath(import.meta.url), '@capacitor/android'));
        const android = [
          `Licences of the native code and Android libraries in ReadAloud ${version} for Android.`,
          'Where each text comes from, with its SHA-256: app/licences/index.json in the source.',
          '',
          ...manifest.android.map((e) =>
            section(
              `${e.name} ${e.version}`,
              [`In: ${e.in}`, `Licence: ${e.licence}`, ...(e.libraries ? ['Libraries:', ...e.libraries.map((l) => `  ${l}`)] : [])],
              e.files.map((f) => [f, text(join(OWN, 'android', f))]),
            ),
          ),
          section(`${capacitor.name} ${capacitor.version}`, ["In: the app's Java code (the Capacitor bridge)", `Licence: ${capacitor.licence}`], packageTexts(capacitor, manifest) ?? []),
        ];
        this.emitFile({ type: 'asset', fileName: 'licences/android.txt', source: android.join('\n') });
      }
    },
  };
  return { plugin, worker };
}
