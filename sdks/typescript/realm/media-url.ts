export interface NimiRealmMediaUrlProjectionInput {
  readonly realmBaseUrl?: unknown;
  readonly mediaUrl?: unknown;
}

export function resolveNimiRealmMediaUrl(input: NimiRealmMediaUrlProjectionInput | null | undefined): string | undefined {
  const mediaUrl = String(input?.mediaUrl || '').trim();
  if (!mediaUrl) {
    return undefined;
  }
  if (/^https?:\/\//iu.test(mediaUrl)) {
    return mediaUrl;
  }
  if (mediaUrl.startsWith('/')) {
    const realmBaseUrl = String(input?.realmBaseUrl || '').trim().replace(/\/+$/u, '');
    return realmBaseUrl ? `${realmBaseUrl}${mediaUrl}` : undefined;
  }
  return mediaUrl;
}
