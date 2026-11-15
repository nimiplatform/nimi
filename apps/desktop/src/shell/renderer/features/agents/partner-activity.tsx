import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PillTabs } from '@nimiplatform/kit/ui';
import { useAgentActivityReferences } from '@nimiplatform/kit/features/chat/runtime';
import { AgentActivityReferences } from '@nimiplatform/kit/features/chat/ui';
import type { NimiLocalAppActivityClient } from '@nimiplatform/sdk/app';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

const P = 'runtimeConfig.partners.activity';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partner-activity-and-use
export function PartnerActivity({ agentHandle }: { agentHandle: string }) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const filter = destination.partner?.activity ?? {};
  const activity = useMemo(() => ({ list: (input: Parameters<NimiLocalAppActivityClient['list']>[0]) => sdk.appProduct().activity.list(input),
    subscribe: (input: { afterChangeSeq: string }) => sdk.appProduct().activity.subscribe(input),
    open: (input: { activityId: string }) => sdk.appProduct().activity.open(input) }), [sdk]);
  const listReferences = useCallback(() => sdk.appProduct().agents.listReferences(), [sdk]);
  const state = useAgentActivityReferences({ agentHandle, activity, listReferences, ...filter });
  // Choices are names from this partner's loaded published records, not a usage registry.
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    setSources(previous => {
      const next = new Map(previous);
      for (const record of state.records) next.set(record.source.sourceRef, record.source.displayName || record.source.appId || t(`${P}.sourceUnavailable`));
      return next.size === previous.size && [...next].every(([key, label]) => previous.get(key) === label) ? previous : next;
    });
  }, [state.records, t]);
  const change = (next: typeof filter) => {
    if (destination.partner) void navigation.replace({ ...destination, partner: { localAgentRef: destination.partner.localAgentRef, activity: next } });
  };
  return <div data-testid="partner-activity" className="space-y-4">
    <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.description`)}</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PillTabs ariaLabel={t(`${P}.filter`)} size="sm" value={filter.pendingOnly ? 'pending' : 'all'}
        items={[{ value: 'all', label: t(`${P}.all`) }, { value: 'pending', label: t(`${P}.pending`) }]}
        onValueChange={value => change({ ...filter, pendingOnly: value === 'pending' })} />
      <select aria-label={t(`${P}.source`)} value={filter.sourceRef ?? ''} onChange={event => change({ ...filter, sourceRef: event.target.value || undefined })}
        className="max-w-full rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 py-2 text-sm text-[var(--nimi-field-text)]">
        <option value="">{t(`${P}.allSources`)}</option>
        {filter.sourceRef && !sources.has(filter.sourceRef) ? <option value={filter.sourceRef}>{t(`${P}.selectedSource`)}</option> : null}
        {[...sources].map(([ref, label]) => <option key={ref} value={ref}>{label}</option>)}
      </select>
    </div>
    <AgentActivityReferences {...state} presentation="panel" copy={{ title: t(`${P}.title`), loading: t(`${P}.loading`), unavailable: t(`${P}.unavailable`),
      incomplete: t(`${P}.incomplete`), empty: t(filter.pendingOnly ? `${P}.pendingEmpty` : `${P}.empty`),
      open: t(`${P}.open`), opening: t(`${P}.opening`), openFailed: t(`${P}.openFailed`), retry: t('Common.retry'),
      more: t(`${P}.loadMore`), loadMore: t(`${P}.loadMore`), moreFailed: t(`${P}.moreFailed`), sourceUnavailable: t(`${P}.sourceUnavailable`),
      todoStates: { open: t(`${P}.pending`), completed: t(`${P}.completed`), cancelled: t(`${P}.cancelled`) } }} />
  </div>;
}
