const LOCAL_RUNTIME_ASSET_ID_PREFIX = 'local/';
const LOCAL_RUNTIME_ASSET_ID_ALIASES = ['local/', 'llama/', 'media/', 'speech/', 'sidecar/'] as const;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function stripLocalRuntimeAssetAlias(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  const lower = normalized.toLowerCase();
  for (const prefix of LOCAL_RUNTIME_ASSET_ID_ALIASES) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }
  return normalized;
}

export function toCanonicalLocalRuntimeAssetId(value: unknown): string {
  const stripped = stripLocalRuntimeAssetAlias(value);
  return stripped ? `${LOCAL_RUNTIME_ASSET_ID_PREFIX}${stripped}` : '';
}

export function toCanonicalLocalRuntimeAssetLookupKey(value: unknown): string {
  return toCanonicalLocalRuntimeAssetId(value).toLowerCase();
}
