function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function createSecureIdSuffix(byteLength: number = 8): string {
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto) {
    throw new Error('SECURE_CRYPTO_UNAVAILABLE');
  }
  if (typeof secureCrypto.randomUUID === 'function') {
    return secureCrypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(byteLength);
  secureCrypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
