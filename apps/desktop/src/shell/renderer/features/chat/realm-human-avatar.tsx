import { MediaAvatar } from '@nimiplatform/kit/features/media';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function RealmHumanAvatar({ accountId, name, imageUrl, media, resourceId, className, refreshMedia }: {
  accountId: string;
  name: string;
  imageUrl?: string | null;
  media?: RealmModel<'MediaDeliveryDto'> | null;
  resourceId?: string | null;
  className?: string;
  refreshMedia?: () => Promise<RealmModel<'MediaDeliveryDto'> | null>;
}) {
  const { sdk } = useDesktopRendererBindings();
  const { t } = useTranslation();
  const hasResource = Boolean(resourceId || media);
  return <MediaAvatar alt={name} seed={accountId || name} externalUrl={hasResource ? null : imageUrl} delivery={media}
    className={className} shape="circle" tone="neutral"
    fallback={hasResource ? <span role="img" aria-label={t('Chat.avatarUnavailable')} title={t('Chat.avatarUnavailable')}>!</span> : undefined}
    refresh={refreshMedia ?? (async () => (await sdk.realm().social.getUser({ path: { id: accountId } })).avatarMedia ?? null)} />;
}
