const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(count: number): string {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Sortable, storage-path-safe identifier: `<prefix>_<time><random>`. */
export function newId(prefix: string, now: Date = new Date()): string {
  return `${prefix}_${now.getTime().toString(36)}${randomChars(8)}`;
}
