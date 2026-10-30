import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { NimiText } from '@nimiplatform/kit/ui';
import type { RealmMediaDeliveryDto } from './data/world-public-projection.js';
import type { WorldPublicAssetsData } from './world-detail-types.js';

type Illustration = { id: string; delivery?: RealmMediaDeliveryDto | null; url?: string | null; ratio: number };

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function worldIllustrations(assets: WorldPublicAssetsData): Illustration[] {
  const managed = (assets.mediaAssets ?? []).filter((asset) => asset.kind === 'highlight' && (asset.delivery || asset.externalUrl));
  const seenUrls = new Set(managed.map((asset) => asset.externalUrl).filter(Boolean));
  const seenIds = new Set<string>();
  return [
    ...managed.map((asset) => ({ id: asset.id, delivery: asset.delivery, url: asset.externalUrl, ratio: asset.width && asset.height ? asset.width / asset.height : 1 })),
    ...assets.externalRefs.filter((ref) => (ref.kind === 'highlight' || ref.kind.startsWith('highlight-')) && !seenUrls.has(ref.uri))
      .map((ref) => ({ id: ref.refId, url: ref.uri, ratio: 1 })),
  ].filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
}

export function WorldDetailIllustrations({ illustrations, worldName }: { illustrations: Illustration[]; worldName: string }) {
  const { t } = useTranslation();
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const visible = illustrations.filter((item) => !unavailable.has(item.id));
  if (!visible.length) return null;
  return (
    <section className="min-w-0 space-y-5" data-testid="world-detail-illustrations">
      <NimiText as="h2" role="section-title">{t('WorldDetail.discovery.illustrations')}</NimiText>
      <div className="flex flex-wrap items-start gap-4">
        {visible.map((item, index) => <div key={item.id} className="min-w-0 basis-0" style={{ flexGrow: item.ratio }}>
          <MediaImage delivery={item.delivery} externalUrl={item.url} purpose="detail" sizes="auto, 640px"
            alt={t('WorldDetail.discovery.illustrationAlt', { name: worldName, index: index + 1 })}
            className="h-auto w-full rounded-xl" onUnavailable={() => setUnavailable((previous) => new Set(previous).add(item.id))} />
        </div>)}
      </div>
    </section>
  );
}
