const LOCAL_ID_PREFIX = 'local/';
const LOCAL_ID_ALIASES = ['local/', 'localai/', 'nexa/', 'sidecar/'] as const;

function trimText(value: unknown): string {
  return String(value || '').trim();
}

function stripLocalAlias(value: string): string {
  const normalized = trimText(value);
  if (!normalized) {
    return '';
  }
  const lower = normalized.toLowerCase();
  for (const prefix of LOCAL_ID_ALIASES) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }
  return normalized;
}

export function toCanonicalLocalId(value: unknown): string {
  const stripped = stripLocalAlias(trimText(value));
  return stripped ? `${LOCAL_ID_PREFIX}${stripped}` : '';
}

export function toCanonicalLocalLookupKey(value: unknown): string {
  return toCanonicalLocalId(value).toLowerCase();
}

export function localIdsMatch(left: unknown, right: unknown): boolean {
  const leftKey = toCanonicalLocalLookupKey(left);
  const rightKey = toCanonicalLocalLookupKey(right);
  return Boolean(leftKey) && leftKey === rightKey;
}
