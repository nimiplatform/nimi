type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

export function extractChatMediaAssetId(session: { assetId?: unknown } | null | undefined): string {
  const assetId = String(session?.assetId || '').trim();
  if (!assetId) {
    throw new Error('chat-media-asset-id-required');
  }
  return assetId;
}

export function createCanonicalChatMediaPayload(assetId: string): { assetId: string } {
  const normalizedAssetId = String(assetId || '').trim();
  if (!normalizedAssetId) {
    throw new Error('chat-media-asset-id-required');
  }
  return { assetId: normalizedAssetId };
}

export function resolveCanonicalChatMediaUrl(payload: unknown, realmBaseUrl: string): string {
  const record = toRecord(payload);
  const url = String(record?.url || '').trim();
  if (!url) {
    return '';
  }
  if (url.startsWith('/')) {
    const normalizedBaseUrl = String(realmBaseUrl || '').trim().replace(/\/$/, '');
    return normalizedBaseUrl ? `${normalizedBaseUrl}${url}` : url;
  }
  return url;
}
