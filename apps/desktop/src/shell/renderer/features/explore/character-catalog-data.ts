import { readMediaDelivery } from '@nimiplatform/kit/features/media/headless';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { RealmMediaDeliveryDto } from '../world/data/world-public-projection.js';
import { readCharacterSourceRefV3, type CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export type CharacterCatalogItem = Readonly<{
  sourceRef: CharacterSourceRefV3;
  name: string;
  summary: string;
  role: string | null;
  avatarUrl: string | null;
  avatarMedia: RealmMediaDeliveryDto | null;
  portraitUrl: string | null;
  portraitMedia: RealmMediaDeliveryDto | null;
  voiceSampleUrl: string | null;
  worldName: string;
}>;

export type ReadCharacterCatalogOptions = {
  topicId?: string;
  limit?: number;
};

export function interleaveCharactersByWorld(items: readonly CharacterCatalogItem[]): CharacterCatalogItem[] {
  const buckets = new Map<string, CharacterCatalogItem[]>();
  for (const item of items) {
    const key = item.sourceRef.worldId;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const queues = [...buckets.values()];
  const result: CharacterCatalogItem[] = [];
  let index = 0;
  let remaining = items.length;
  while (remaining > 0) {
    for (const queue of queues) {
      if (index < queue.length) {
        result.push(queue[index]!);
        remaining -= 1;
      }
    }
    index += 1;
  }
  return result;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r005
export async function readCharacterCatalog(
  sdk: DesktopRendererSdkPort,
  query: string,
  cursor?: string,
  worldId?: string,
  options?: ReadCharacterCatalogOptions,
) {
  const topicId = options?.topicId?.trim() || undefined;
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const page = await sdk.realm().worldPublic.worldPublicControllerListCharacterCatalog({
    path: {},
    query: {
      ...(query ? { q: query } : {}),
      ...(worldId ? { worldId } : {}),
      ...(topicId ? { topicId } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    },
  });
  if (!Array.isArray(page.items) || typeof page.totalCount !== 'number' || page.hasMore !== (page.nextCursor !== null)) {
    throw new Error('Character catalog page is invalid.');
  }
  return {
    ...page,
    items: page.items.map(raw => {
      const sourceRef = readCharacterSourceRefV3(raw.sourceRef);
      if (!sourceRef || sourceRef.id !== raw.id) throw new Error('Character catalog source identity mismatch');
      return {
        sourceRef,
        name: raw.displayName,
        summary: raw.summary,
        role: typeof raw.role === 'string' && raw.role.trim() ? raw.role.trim() : null,
        avatarMedia: readMediaDelivery(raw.avatarMedia),
        avatarUrl: raw.avatarUrl,
        portraitMedia: readMediaDelivery(raw.portraitMedia),
        portraitUrl: typeof raw.portraitUrl === 'string' && /^https?:\/\//i.test(raw.portraitUrl.trim())
          ? raw.portraitUrl.trim()
          : null,
        voiceSampleUrl: typeof raw.voiceSampleUrl === 'string' && /^https?:\/\//i.test(raw.voiceSampleUrl.trim())
          ? raw.voiceSampleUrl.trim()
          : null,
        worldName: raw.worldName,
      } satisfies CharacterCatalogItem;
    }),
  };
}
