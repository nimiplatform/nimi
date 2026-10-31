import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { UserRound } from 'lucide-react';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';
import type { PartnerDirectoryItem } from './partner-directory-model.js';

const P = 'runtimeConfig.partners';
type PartnerSource = Awaited<ReturnType<typeof resolveCurrentPartnerSource>>;

/** Sidebar and gallery read the same account-scoped source cache, only near the viewport. */
export function usePartnerMediaVisibility<T extends HTMLElement>(enabled: boolean) {
  const element = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = element.current;
    if (!node || !enabled) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  return { element, visible: enabled && visible };
}

export function usePartnerSource(partner: PartnerDirectoryItem, accountId: string, scopeKey: string, enabled: boolean) {
  const { sdk } = useDesktopRendererBindings();
  const source = useQuery({
    queryKey: ['partner-current-source', accountId, scopeKey, partner.localAgentRef, partner.sourceRef],
    queryFn: () => resolveCurrentPartnerSource(sdk.realm(), partner.sourceRef!),
    enabled: enabled && Boolean(partner.sourceRef), staleTime: 60_000, retry: false,
  });
  const media = source.data?.media;
  const hasImage = media && (media.assets.portrait || media.assets.avatar || media.assets.referenceImage || media.assets.profileCover
    || media.external.portraitUrl || media.external.avatarUrl || media.external.referenceImageUrl || media.external.profileCoverUrl);
  const reference = useQuery({
    queryKey: ['home-partner-reference', accountId, scopeKey, partner.localAgentRef],
    queryFn: () => sdk.resolveDesktopAgentReference({ localAgentRef: partner.localAgentRef }),
    enabled: enabled && partner.lifecycle === AgentLifecycleStatus.ACTIVE && !hasImage
      && (!partner.sourceRef || source.isError || source.isSuccess),
    staleTime: 15_000, gcTime: 0, retry: false, networkMode: 'always',
  });
  return { ...source, avatarUrl: reference.data?.reference?.avatarUrl };
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function PartnerArtwork({ source, avatarUrl, name, variant = 'card' }: { source?: PartnerSource; avatarUrl?: string; name: string; variant?: 'avatar' | 'card' | 'hero' }) {
  const { t } = useTranslation();
  const media = source?.media;
  const hero = variant === 'hero';
  const avatar = variant === 'avatar';
  const asset = (avatar ? media?.assets.avatar : null) ?? media?.assets.portrait ?? media?.assets.referenceImage ?? media?.assets.profileCover ?? media?.assets.avatar;
  const external = asset?.externalUrl ?? (avatar ? media?.external.avatarUrl : null) ?? media?.external.portraitUrl ?? media?.external.avatarUrl ?? media?.external.referenceImageUrl ?? media?.external.profileCoverUrl ?? avatarUrl;
  // World card renditions are cropped to a wide banner. Keep character artwork
  // uncropped so this surface can frame it at its own aspect ratio.
  const preferredPurpose = avatar ? 'avatar' : hero ? 'hero' : 'detail';
  const purposes = asset?.delivery?.images.map(set => set.purpose) ?? [];
  const purpose = ([preferredPurpose, 'detail', 'card', 'hero', 'avatar'] as const).find(value => purposes.includes(value)) ?? preferredPurpose;
  return <MediaImage delivery={asset?.delivery} externalUrl={external} purpose={purpose}
    sizes={avatar ? '48px' : hero ? 'auto, 700px' : 'auto, 260px'} alt={name} className="partner-artwork" loading={hero ? 'eager' : 'lazy'}
    fallback={avatar ? <span className="partner-avatar-fallback">{name.slice(0, 1) || '?'}</span> : <span className="partner-artwork-empty"><UserRound aria-hidden="true" size={40} strokeWidth={1.2} /><span>{t(`${P}.gallery.noPortrait`)}</span></span>} />;
}
