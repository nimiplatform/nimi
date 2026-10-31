import type { RealmMediaDeliveryDto } from './data/world-public-projection.js';
import type { WorldPublicAssetsData } from './world-detail-types.js';

export type WorldIllustration = { id: string; delivery?: RealmMediaDeliveryDto | null; url?: string | null; ratio: number | null };

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function worldIllustrations(assets: WorldPublicAssetsData): WorldIllustration[] {
  const managed = (assets.mediaAssets ?? []).filter((asset) => asset.kind === 'highlight' && (asset.delivery || asset.externalUrl));
  const seenUrls = new Set(managed.map((asset) => asset.externalUrl).filter(Boolean));
  const seenIds = new Set<string>();
  return [
    ...managed.map((asset) => ({ id: asset.id, delivery: asset.delivery, url: asset.externalUrl, ratio: asset.width && asset.height ? asset.width / asset.height : null })),
    ...assets.externalRefs.filter((ref) => (ref.kind === 'highlight' || ref.kind.startsWith('highlight-')) && !seenUrls.has(ref.uri))
      .map((ref) => ({ id: ref.refId, url: ref.uri, ratio: null })),
  ].filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
}
