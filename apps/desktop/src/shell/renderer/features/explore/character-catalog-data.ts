import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { projectWorldPublicSourceCard, requireWorldPublicSourceCardDto } from '../world/data/world-public-projection.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export type CharacterCatalogItem = Readonly<{
  sourceRef: CharacterSourceRefV3;
  name: string;
  summary: string;
  avatarUrl: string | null;
  worldName: string;
}>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r005
export async function readCharacterCatalog(sdk: DesktopRendererSdkPort, query: string, cursor?: string) {
  const page = await sdk.realm().worldPublic.worldPublicControllerListCharacterCatalog({
    path: {}, query: { ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}), limit: 20 },
  });
  if (!Array.isArray(page.items) || typeof page.totalCount !== 'number' || page.hasMore !== (page.nextCursor !== null)) throw new Error('Character catalog page is invalid.');
  return { ...page, items: page.items.map(raw => {
    const card = requireWorldPublicSourceCardDto(raw, raw.worldId);
    const projection = projectWorldPublicSourceCard(card);
    return { sourceRef: projection.sourceRef, name: card.displayName, summary: card.summary,
      avatarUrl: projection.avatarUrl ?? null, worldName: card.worldName } satisfies CharacterCatalogItem;
  }) };
}
