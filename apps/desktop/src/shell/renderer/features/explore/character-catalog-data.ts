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
  voiceSampleUrl: string | null;
  worldName: string;
}>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r005
export async function readCharacterCatalog(
  sdk: DesktopRendererSdkPort,
  query: string,
  cursor?: string,
  worldId?: string,
) {
  const page = await sdk.realm().worldPublic.worldPublicControllerListCharacterCatalog({
    path: {},
    query: {
      ...(query ? { q: query } : {}),
      ...(worldId ? { worldId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 20,
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
        avatarMedia: raw.avatarMedia,
        avatarUrl: raw.avatarUrl,
        voiceSampleUrl: typeof raw.voiceSampleUrl === 'string' && /^https?:\/\//i.test(raw.voiceSampleUrl.trim())
          ? raw.voiceSampleUrl.trim()
          : null,
        worldName: raw.worldName,
      } satisfies CharacterCatalogItem;
    }),
  };
}
