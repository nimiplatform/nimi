import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';

export type VideoPlaybackSource = { mode: 'iframe' | 'native'; src: string };

export function prepareHomeFeedItems(items: PostDto[]): PostDto[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(String(left.createdAt ?? ''));
    const rightTime = Date.parse(String(right.createdAt ?? ''));
    return rightTime - leftTime;
  });
}

export function normalizeMediaType(type: unknown): PostMediaType | null {
  const normalized = String(type || '').toUpperCase();
  if (normalized === PostMediaType.IMAGE || normalized === PostMediaType.VIDEO) {
    return normalized as PostMediaType;
  }
  return null;
}

export function resolveMediaUrl(media: PostDto['media'][number] | null | undefined): string | undefined {
  if (!media) {
    return undefined;
  }
  if (typeof media.url === 'string' && media.url.trim()) {
    return media.url.trim();
  }
  const maybeUid = (media as Record<string, unknown>).uid;
  if (typeof maybeUid === 'string' && maybeUid.trim()) {
    return maybeUid.trim();
  }
  return undefined;
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
