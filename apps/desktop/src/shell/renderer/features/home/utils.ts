import type { RealmModel } from '@nimiplatform/sdk/realm';

type PostDto = RealmModel<'PostDto'>;
export type MediaDisplayKind = 'IMAGE' | 'VIDEO';

export type VideoPlaybackSource = { mode: 'iframe' | 'native'; src: string };

export function prepareHomeFeedItems(items: PostDto[]): PostDto[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(String(left.createdAt ?? ''));
    const rightTime = Date.parse(String(right.createdAt ?? ''));
    return rightTime - leftTime;
  });
}

export function normalizeMediaType(type: unknown): MediaDisplayKind | null {
  const normalized = String(type || '').toUpperCase();
  if (normalized === 'IMAGE' || normalized === 'VIDEO') {
    return normalized as MediaDisplayKind;
  }
  return null;
}

export function resolveRenderableMediaAttachment(
  media: PostDto['attachments'][number] | null | undefined,
): PostDto['attachments'][number] | null {
  if (!media) {
    return null;
  }
  if (normalizeMediaType(media.displayKind)) {
    return media;
  }
  const preview = media.preview;
  return normalizeMediaType(preview?.displayKind)
    ? (preview as PostDto['attachments'][number])
    : null;
}

function resolveRealmMediaPath(realmBaseUrl: string, path: string): string | undefined {
  const normalizedBase = String(realmBaseUrl || '').trim().replace(/\/$/, '');
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return undefined;
  }
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }
  if (normalizedPath.startsWith('/')) {
    return normalizedBase ? `${normalizedBase}${normalizedPath}` : undefined;
  }
  return normalizedPath;
}

export function resolveMediaUrl(
  media: PostDto['attachments'][number] | null | undefined,
  realmBaseUrl: string,
): string | undefined {
  const renderable = resolveRenderableMediaAttachment(media);
  if (!renderable) {
    return undefined;
  }
  const directUrl = resolveRealmMediaPath(realmBaseUrl, renderable.url || '');
  if (directUrl) {
    return directUrl;
  }
  return undefined;
}

export function resolveMediaThumbnailUrl(
  media: PostDto['attachments'][number] | null | undefined,
  realmBaseUrl: string,
): string | undefined {
  const renderable = resolveRenderableMediaAttachment(media);
  if (!renderable) {
    return undefined;
  }
  return resolveRealmMediaPath(realmBaseUrl, renderable.thumbnail || '');
}

export function resolveVideoPlaybackSource(rawUrl?: string): VideoPlaybackSource | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  let token: string | null = null;
  let uid: string | null = null;

  try {
    const parsed = new URL(rawUrl);
    token = parsed.searchParams.get('token');
    const uidMatch = parsed.pathname.match(/^\/([a-zA-Z0-9]+)\/manifest\/video\.m3u8$/);
    if (uidMatch?.[1]) {
      uid = uidMatch[1];
    }
  } catch {
    const tokenMatch = rawUrl.match(/[?&]token=([^&]+)/);
    if (tokenMatch?.[1]) {
      token = decodeURIComponent(tokenMatch[1]);
    }
    const uidMatch = rawUrl.match(/videodelivery\.net\/([a-zA-Z0-9]+)\/manifest\/video\.m3u8/);
    if (uidMatch?.[1]) {
      uid = uidMatch[1];
    }
  }

  if (token) {
    return { mode: 'iframe', src: `https://iframe.videodelivery.net/${token}` };
  }
  if (uid) {
    return { mode: 'iframe', src: `https://iframe.videodelivery.net/${uid}` };
  }
  if (/^[a-zA-Z0-9]{8,}$/.test(rawUrl.trim())) {
    return { mode: 'iframe', src: `https://iframe.videodelivery.net/${rawUrl.trim()}` };
  }
  return { mode: 'native', src: rawUrl };
}
