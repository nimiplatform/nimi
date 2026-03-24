const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizeRelayExternalUrl(input: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) {
    throw new Error('External URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('External URL must be a valid absolute URL');
  }
  if (!ALLOWED_EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('External URL must use http or https');
  }
  return parsed.toString();
}

export function normalizeRelayRealtimeUrl(
  realmUrl: string,
  options?: { allowInsecureHttp?: boolean },
): string {
  const normalized = String(realmUrl || '').trim();
  if (!normalized) {
    throw new Error('Relay realtime URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Relay realtime URL must be a valid absolute URL');
  }
  if (!ALLOWED_EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Relay realtime URL must use http or https');
  }
  if (parsed.protocol === 'http:' && !options?.allowInsecureHttp) {
    throw new Error('Relay realtime requires HTTPS outside development');
  }
  return parsed.toString();
}
