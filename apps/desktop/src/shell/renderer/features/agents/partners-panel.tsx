import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, InlineAlert, LoadingSkeleton, ScrollArea } from '@nimiplatform/kit/ui';
import { ArrowLeft, UsersRound } from 'lucide-react';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { resolveDesktopOpenAgentCenterTarget } from '../../infra/desktop-open/desktop-open-intent-navigation.js';
import { resolvePartnerForHandle } from './partner-directory-model.js';
import { PartnerDetails } from './partner-details.js';

const P = 'runtimeConfig.partners';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function PartnersPanel({ onBackToContacts }: { onBackToContacts?: () => void }) {
  const { t } = useTranslation();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const sdk = useDesktopRendererSdk();
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const accountId = String(auth.user?.id ?? '');
  const scopeKey = `${realm}:${auth.authorizationRevision}`;
  const anchor = destination.partnerManagerAnchorId;
  const selectedRef = destination.partner?.localAgentRef;
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
      const resolved = await resolvePartnerForHandle(sdk, accountId, target.agentHandle);
      if (isCurrent()) await navigation.replace({ id: 'contacts', contactView: 'partners', partner: { localAgentRef: resolved.partner.localAgentRef, settingsSection: destination.partnerManagerSection ?? 'overview' } });
    })().catch(() => { if (isCurrent()) setFailed(true); });
    return () => { current = false; scope.dispose(); };
  }, [anchor, destination.partnerManagerSection, auth.status, accountId, auth.authorizationRevision, sdk, navigation, retry]);

  if (anchor) {
    return <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-8">
      {failed ? <InlineAlert tone="warning" action={<Button size="sm" onClick={() => setRetry(value => value + 1)}>{t('Common.retry')}</Button>}>{t(`${P}.managerUnavailable`)}</InlineAlert> : <LoadingSkeleton lines={4} />}
    </div>;
  }
  if (!selectedRef) {
    return <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <EmptyState className="max-w-xs" icon={<UsersRound size={20} aria-hidden="true" />}
        title={t('Chat.contactsChoosePartner')} description={t('Chat.contactsChoosePartnerHint')} />
    </div>;
  }
  return <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="px-5 pb-6 pt-6" contentClassName="mx-auto w-full max-w-[960px]">
    <div role="region" aria-label={t(`${P}.details`)}>
      {onBackToContacts ? <div className="mb-3 min-[960px]:hidden">
        <Button tone="ghost" size="sm" onClick={onBackToContacts}><ArrowLeft size={16} />{t('Relationship.contacts.title')}</Button>
      </div> : null}
      <PartnerDetails key={`${accountId}:${scopeKey}:${selectedRef}`} scopeKey={scopeKey} localAgentRef={selectedRef} accountId={accountId} />
    </div>
  </ScrollArea>;
}
