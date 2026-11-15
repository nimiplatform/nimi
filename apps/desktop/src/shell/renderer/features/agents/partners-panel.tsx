import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { resolveDesktopOpenAgentCenterTarget } from '../../infra/desktop-open/desktop-open-intent-navigation.js';
import { resolvePartnerForHandle } from './partner-directory-model.js';
import { PartnerDirectory } from './partner-directory.js';
// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function PartnersPanel() {
  const { t } = useTranslation();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const sdk = useDesktopRendererSdk();
  const auth = useAppStore(state => state.auth);
  const anchor = destination.partnerManagerAnchorId;
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!anchor || auth.status !== 'authenticated') return;
    let current = true;
    const scope = captureHomeNavigationScope(navigation);
    const isCurrent = () => current && scope.isCurrent();
    setFailed(false);
    void (async () => {
      const target = await resolveDesktopOpenAgentCenterTarget(sdk.appProduct(), anchor, isCurrent);
      const resolved = await resolvePartnerForHandle(sdk, String(auth.user?.id ?? ''), target.agentHandle);
      if (isCurrent()) await navigation.replace({ id: 'partners', partner: { localAgentRef: resolved.partner.localAgentRef, settingsSection: destination.partnerManagerSection ?? 'overview' } });
    })().catch(() => { if (isCurrent()) setFailed(true); });
    return () => { current = false; scope.dispose(); };
  }, [anchor, destination.partnerManagerSection, auth.status, auth.user?.id, auth.authorizationRevision, sdk, navigation, retry]);
  return <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
    {anchor ? failed ? <InlineAlert tone="warning" action={<Button onClick={() => setRetry(value => value + 1)}>{t('Common.retry')}</Button>}>{t('runtimeConfig.partners.managerUnavailable')}</InlineAlert> : <LoadingSkeleton lines={4} /> : <PartnerDirectory />}
  </div>;
}
