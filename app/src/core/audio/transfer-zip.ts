// Stored ZIP32 only. Read file slices rather than materialising a complete audiobook.
const MAX = 0xfffffffe;
const CLIP_MAX = 64 * 1024 * 1024;
export const MANIFEST_MAX = 8 * 1024 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (c >>> 8) ^ table[(c ^ b) & 255]!;
  return (c ^ 0xffffffff) >>> 0;
}
interface Entry { name: string; size: number; crc: number; offset: number; start: number; flags: number; }
const allowed = (n: string) => n === 'manifest.json' || n === 'audio/' || /^audio\/\d+\.wav$/.test(n);
const bound = (n: string) => n === 'manifest.json' ? MANIFEST_MAX : CLIP_MAX;
export class TransferZipWriter {
  private parts: BlobPart[] = [];
  private entries: Entry[] = [];
  private size = 0;
  async add(name: string, blob: Blob): Promise<void> {
    if (!allowed(name) || blob.size > bound(name)) throw new Error('Transfer entry is too large or invalid.');
    if (this.entries.length >= 49999 || this.size + blob.size + 65536 > MAX) throw new Error('ZIP32 transfer capacity reached. Save separate chapter transfers.');
    const bytes = new Uint8Array(await blob.arrayBuffer()), sum = crc(bytes), title = enc.encode(name);
    const header = new Uint8Array(30 + title.length), v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
    // Valid DOS date: 1980-01-01. Zero encodes an invalid month/day and some
    // phone archive viewers reject it even when all file bytes/CRCs are correct.
    v.setUint16(12, 0x21, true);
    v.setUint32(14, sum, true); v.setUint32(18, blob.size, true); v.setUint32(22, blob.size, true);
    v.setUint16(26, title.length, true); header.set(title, 30);
    this.entries.push({ name, size: blob.size, crc: sum, offset: this.size, start: this.size + header.length, flags: 0x800 });
    this.parts.push(header, blob); this.size += header.length + blob.size;
  }
  finish(): Blob {
    let centralSize = 0;
    for (const e of this.entries) {
      const title = enc.encode(e.name), header = new Uint8Array(46 + title.length), v = new DataView(header.buffer);
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, e.flags, true);
      v.setUint16(14, 0x21, true);
      v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true); v.setUint32(24, e.size, true);
      v.setUint16(28, title.length, true); v.setUint32(42, e.offset, true); header.set(title, 46);
      this.parts.push(header); centralSize += header.length;
    }
    if (this.size + centralSize + 22 > MAX) throw new Error('ZIP32 transfer capacity reached. Save separate chapter transfers.');
    const end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, this.entries.length, true); v.setUint16(10, this.entries.length, true);
    v.setUint32(12, centralSize, true); v.setUint32(16, this.size, true); this.parts.push(end);
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

export async function openTransferZip(file: Blob): Promise<Map<string, { blob: Blob; read(): Promise<ArrayBuffer> }>> {
  if (file.size > MAX || file.size < 22) throw new Error('Unsupported transfer size: ZIP32 files must be smaller than 4 GiB.');
  const entries: Entry[] = [], names = new Set<string>(); let at = 0;
  const read = async (start: number, size: number) => {
    if (start + size > file.size) throw new Error('Truncated transfer.');
    return new DataView(await file.slice(start, start + size).arrayBuffer());
  };
  while (at + 4 <= file.size && (await read(at, 4)).getUint32(0, true) === 0x04034b50) {
    const v = await read(at, 30), flags = v.getUint16(6, true), size = v.getUint32(18, true);
    const len = v.getUint16(26, true), extra = v.getUint16(28, true);
    const name = dec.decode(await file.slice(at + 30, at + 30 + len).arrayBuffer());
    const start = at + 30 + len + extra;
    if (!allowed(name) || names.has(name) || (flags & ~0x800) !== 0 || v.getUint16(8, true) !== 0
      || size !== v.getUint32(22, true) || size > bound(name) || start + size > file.size || entries.length >= 50000)
      throw new Error('Unsupported or damaged transfer ZIP.');
    names.add(name); entries.push({ name, size, crc: v.getUint32(14, true), offset: at, start, flags }); at = start + size;
  }
  if (!names.has('manifest.json')) throw new Error('Not a ReadAloud transfer.');
  const centralStart = at;
  for (const e of entries) {
    const v = await read(at, 46), len = v.getUint16(28, true), extra = v.getUint16(30, true), comment = v.getUint16(32, true);
    const name = dec.decode(await file.slice(at + 46, at + 46 + len).arrayBuffer());
    if (v.getUint32(0, true) !== 0x02014b50 || name !== e.name || v.getUint16(8, true) !== e.flags
      || v.getUint16(10, true) !== 0 || v.getUint32(16, true) !== e.crc || v.getUint32(20, true) !== e.size
      || v.getUint32(24, true) !== e.size || v.getUint32(42, true) !== e.offset || v.getUint16(34, true) !== 0)
      throw new Error('Transfer directory mismatch.');
    at += 46 + len + extra + comment;
  }
  const end = await read(at, 22);
  if (end.getUint32(0, true) !== 0x06054b50 || end.getUint16(4, true) !== 0 || end.getUint16(6, true) !== 0
    || end.getUint16(8, true) !== entries.length || end.getUint16(10, true) !== entries.length
    || end.getUint32(12, true) !== at - centralStart || end.getUint32(16, true) !== centralStart
    || at + 22 + end.getUint16(20, true) !== file.size) throw new Error('Invalid transfer directory.');
  return new Map(entries.filter((e) => e.name !== 'audio/').map((e) => {
    const blob = file.slice(e.start, e.start + e.size, e.name.endsWith('.wav') ? 'audio/wav' : 'application/json');
    return [e.name, { blob, read: async () => {
      const bytes = await blob.arrayBuffer();
      if (crc(new Uint8Array(bytes)) !== e.crc) throw new Error('Transfer checksum mismatch.');
      return bytes;
    } }];
  }));
}
