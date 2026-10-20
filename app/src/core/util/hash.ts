export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer-backed view (crypto.subtle rejects SharedArrayBuffer views).
  const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
