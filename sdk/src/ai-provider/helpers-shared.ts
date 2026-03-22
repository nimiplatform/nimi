import { createNimiError, type RuntimeCallOptions } from '../runtime/index.js';
import { ReasonCode, type AiRoutePolicy } from '../types/index.js';
import { normalizeText } from '../internal/utils.js';
import { ROUTE_POLICY_CLOUD, type RuntimeDefaults } from './types.js';

export function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

export function fromRouteDecision(value: unknown): AiRoutePolicy {
  return Number(value) === ROUTE_POLICY_CLOUD ? 'cloud' : 'local';
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function toCallOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
  },
): RuntimeCallOptions {
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : defaults.timeoutMs;
  const metadata = {
    ...(defaults.metadata || {}),
    ...(input.metadata || {}),
  };

  return {
    timeoutMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function createUnsafeExternalUrlError(fieldName: string, reason: string) {
  return createNimiError({
    message: `${fieldName} must be a public https URL (${reason})`,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: `set_safe_${fieldName}`,
    source: 'sdk',
  });
}

function isIPv4(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split('.').map((segment) => Number(segment));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const a = octets[0];
  const b = octets[1];
  if (a === undefined || b === undefined) {
    return false;
  }
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isLocalIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
  ) {
    return true;
  }
  const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const mappedHost = mappedV4?.[1];
  return mappedHost ? isPrivateIPv4(mappedHost) : false;
}

function isPublicHttpsUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https is required' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials are not allowed' };
  }
  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) {
    return { ok: false, reason: 'host is required' };
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'loopback hosts are not allowed' };
  }
  if (isIPv4(hostname) && isPrivateIPv4(hostname)) {
    return { ok: false, reason: 'private IPv4 ranges are not allowed' };
  }
  if (hostname.includes(':') && isLocalIPv6(hostname)) {
    return { ok: false, reason: 'local IPv6 ranges are not allowed' };
  }
  return { ok: true, url: parsed.toString() };
}

export function ensureSafeExternalMediaUrl(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createUnsafeExternalUrlError(fieldName, 'value is missing');
  }
  const result = isPublicHttpsUrl(normalized);
  if (!result.ok) {
    throw createUnsafeExternalUrlError(fieldName, result.reason);
  }
  return result.url;
}
