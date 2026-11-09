// Build-time download only. Windows users receive these files inside the app ZIP.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const target = resolve(process.argv[2] ?? 'voice-pack');
const model = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const response = await fetch(`https://huggingface.co/api/models/${model}`);
if (!response.ok) throw new Error(`Model metadata: ${response.status}`);
const info = await response.json();
if (!/^[a-f0-9]{40}$/.test(info.sha)) throw new Error('No immutable model revision returned.');
if (info.cardData?.license !== 'apache-2.0') throw new Error('Unexpected model licence; review required.');
const voices = ['bf_emma','bf_isabella','bm_george','bm_fable','bm_lewis','af_heart','af_bella','af_nicole','am_michael','am_fenrir','am_puck'];
const files = ['config.json','tokenizer.json','tokenizer_config.json','onnx/model.onnx',...voices.map((v) => `voices/${v}.bin`)];
await mkdir(target, { recursive: true });
const manifest = { model, revision: info.sha, files: [] };
for (const file of files) {
  const path = join(target, file); await mkdir(resolve(path, '..'), { recursive: true });
  const url = `https://huggingface.co/${model}/resolve/${info.sha}/${file}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${file}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  const hash = createHash('sha256'); let size = 0;
  for await (const b of createReadStream(path)) { hash.update(b); size += b.length; }
  manifest.files.push({ file, sha256: hash.digest('hex'), bytes: size });
  process.stdout.write(`${file}: ${size} bytes\n`);
}
// Keep upstream provenance/license files in the offline distribution too.
const license = await fetch('https://www.apache.org/licenses/LICENSE-2.0.txt');
if (!license.ok) throw new Error('Could not retrieve the upstream Kokoro licence.');
await writeFile(join(target, 'LICENSE'), await license.text());
const card = await fetch(`https://huggingface.co/${model}/raw/${info.sha}/README.md`);
if (!card.ok) throw new Error('Could not retrieve the pinned upstream model card.');
await writeFile(join(target, 'UPSTREAM-MODEL-CARD.md'), await card.text());
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
// Read back so a failed write never masquerades as successful staging.
JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
process.stdout.write(`Staged immutable model ${info.sha} and ${voices.length} shared-model voices.\n`);
