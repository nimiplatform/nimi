export type RealmMediaUrlProjectionInput = {
  realmBaseUrl?: unknown;
  mediaUrl?: unknown;
};

export function resolveRealmMediaUrl(input: RealmMediaUrlProjectionInput | null | undefined): string | undefined {
  const mediaUrl = String(input?.mediaUrl || '').trim();
  if (!mediaUrl) {
    return undefined;
  }
  if (/^https?:\/\//i.test(mediaUrl)) {
    return mediaUrl;
  }
  if (mediaUrl.startsWith('/')) {
    const realmBaseUrl = String(input?.realmBaseUrl || '').trim().replace(/\/+$/, '');
    return realmBaseUrl ? `${realmBaseUrl}${mediaUrl}` : undefined;
  }
  return mediaUrl;
}
