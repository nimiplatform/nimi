import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell, ScrollShell, SegmentedControl } from '@nimiplatform/kit/ui';
import { DesktopAICloudAttemptOutcome, type DesktopConnectorReference } from '@nimiplatform/sdk/runtime/wire-types';
import { normalizeNimiRuntimeReasonCode } from '@nimiplatform/sdk/runtime';
import { useAppStore, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { homeRuntimeDestination } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { DESKTOP_NIMI_APP_ID } from '../chat/chat-nimi-app-ai-config.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

function useCloudAccount() {
  const status = useAppStore(state => state.auth.status);
  const key = useAppStore(state => JSON.stringify([state.auth.status, state.auth.user?.id, state.auth.authorizationRevision]));
  return { key, enabled: status === 'authenticated' };
}

function timestampLabel(value: { seconds: string; nanos: number } | undefined): string {
  return value ? new Date(Number(value.seconds) * 1000 + value.nanos / 1e6).toLocaleString() : '—';
}

function useCloudWindow() {
  const [days, setDays] = useState('1');
  const [revision, setRevision] = useState(0);
  const window = useMemo(() => {
    const to = Math.floor(Date.now() / 1000);
    return { fromTime: { seconds: String(to - Number(days) * 86400), nanos: 0 }, toTime: { seconds: String(to), nanos: 0 } };
  }, [days, revision]);
  return { window, days, setDays, refreshRevision: revision, refresh: () => setRevision(value => value + 1) };
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.cloud-connection-observation
export function CloudConnectorReferences({ connectorId, compact = false, onOpenOwner }: {
  connectorId: string;
  compact?: boolean;
  onOpenOwner?: (reference: DesktopConnectorReference) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const account = useCloudAccount();
  const overview = useAppsOverview({ enabled: !compact && account.enabled });
  const query = useInfiniteQuery({
    queryKey: ['cloud-configuration-references', account.key, connectorId],
    initialPageParam: '',
    enabled: account.enabled,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async ({ pageParam }) => {
      const response = await sdk.accountProduct().configurationReferences.listDesktopConnectorReferences({ connectorRef: connectorId, pageSize: 50, pageToken: pageParam });
      if (!response.snapshotRevision || !response.observedAt) throw new Error('Reference observation missing');
      return response;
    },
    getNextPageParam: page => page.nextPageToken || undefined,
  });
  const pages = query.data?.pages ?? [];
  const consistent = pages.every(page => page.snapshotRevision === pages[0]?.snapshotRevision);
  const unavailable = query.isError || !consistent;
  const rows = unavailable ? [] : pages.flatMap(page => page.references);
  const entries = overview.data?.status === 'loaded' ? overview.data.entries : [];
  return <section data-testid="cloud-configuration-references" className={compact ? 'mt-4 text-sm' : 'border-t border-[var(--nimi-border-subtle)] p-6 lg:p-7'}>
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloudWorkspace.referencesTitle')}</h3>
      {!compact && account.enabled ? <Button size="sm" tone="ghost" onClick={() => void query.refetch()} disabled={query.isFetching}>{t('runtimeConfig.runtime.refresh')}</Button> : null}
    </div>
    <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.referencesScope')}</p>
    {!account.enabled ? <p className="mt-3">{t('runtimeConfig.cloudWorkspace.signInRequired')}</p> : query.isPending ? <p className="mt-3">{t('Common.loading')}</p> : unavailable ? <div className="mt-3" role="alert"><p>{t('runtimeConfig.cloudWorkspace.referencesFailed')}</p><Button size="sm" tone="ghost" onClick={() => { void query.refetch(); }}>{t('runtimeConfig.runtime.refresh')}</Button></div> : <>
      {!rows.length ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.cloudWorkspace.noReferences')}</p> : <ul className="mt-3 divide-y divide-[var(--nimi-border-subtle)]">
        {rows.map((row, index) => {
          const owner = row.owner?.owner;
          const appId = owner?.oneofKind === 'app' ? owner.app.appId : '';
          const app = entries.find(entry => entry.identity.appId === appId && (entry.committedRelease || entry.localDevelopment));
          const localAgent = owner?.oneofKind === 'runtimeLocalAgentSubsystem';
          const canOpen = localAgent || appId === DESKTOP_NIMI_APP_ID || Boolean(app);
          const label = localAgent ? t('runtimeConfig.cloudWorkspace.sharedAgents') : appId === DESKTOP_NIMI_APP_ID ? t('runtimeConfig.cloudWorkspace.nimiChat') : app?.identity.displayName || appId;
          return <li key={`${appId || 'shared'}:${row.capabilityContract}:${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div><p className="break-all text-sm text-[var(--nimi-text-primary)]">{label}</p><p className="text-xs text-[var(--nimi-text-secondary)]">{displayRuntimeConfigCapabilityLabel(row.capabilityContract, t)}</p></div>
            {!compact && onOpenOwner && canOpen ? <Button size="sm" tone="ghost" onClick={() => onOpenOwner(row)}>{t('runtimeConfig.cloudWorkspace.openConfiguration')}</Button> : null}
            {!compact && !canOpen ? <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.ownerUnavailable')}</span> : null}
          </li>;
        })}
      </ul>}
      {query.hasNextPage ? <div className="mt-2"><p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.moreReferences')}</p><Button size="sm" tone="ghost" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('runtimeConfig.cloudWorkspace.loadMore')}</Button></div> : null}
      {pages[0]?.observedAt ? <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.observedAt', { time: timestampLabel(pages[0].observedAt) })}</p> : null}
    </>}
  </section>;
}

export function CloudConnectorUsage({ connectorId, onOpenHistory }: { connectorId: string; onOpenHistory: () => void }) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const account = useCloudAccount();
  const { window, days, setDays, refreshRevision, refresh } = useCloudWindow();
  const query = useQuery({ queryKey: ['cloud-usage', account.key, connectorId, window, refreshRevision], enabled: account.enabled, retry: false,
    queryFn: async () => {
      const response = await sdk.accountProduct().audit.getDesktopAIUsageSummary({ ...window, connectorRef: connectorId });
      if (!response.summary?.totals) throw new Error('Usage projection missing');
      return response.summary;
    },
  });
  const summary = query.data;
  const complete = summary?.timeComplete && summary.sourceComplete && summary.quantityComplete && summary.attributionComplete;
  return <section className="border-t border-[var(--nimi-border-subtle)] p-6 lg:p-7" data-testid="cloud-usage-summary">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloudWorkspace.usageTitle')}</h3><Button size="sm" tone="ghost" onClick={onOpenHistory}>{t('runtimeConfig.cloudWorkspace.historyTitle')}</Button></div>
    <div className="mt-3 flex items-center justify-between gap-3"><SegmentedControl size="sm" value={days} onValueChange={setDays} ariaLabel={t('runtimeConfig.cloudWorkspace.usageWindow')} items={['1','7'].map(value => ({ value, label: t(`runtimeConfig.cloudWorkspace.days${value}`) }))} /><Button size="sm" tone="ghost" disabled={query.isFetching} onClick={refresh}>{t('runtimeConfig.runtime.refresh')}</Button></div>
    {!account.enabled ? <p className="mt-3 text-sm">{t('runtimeConfig.cloudWorkspace.signInRequired')}</p> : query.isPending ? <p className="mt-3 text-sm">{t('Common.loading')}</p> : query.isError ? <p className="mt-3 text-sm" role="alert">{t('runtimeConfig.cloudWorkspace.usageFailed')}</p> : summary?.totals ? <>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div><p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.attempts')}</p><p className="mt-1 text-lg font-semibold">{summary.totals.attemptCount === '0' && !complete ? '—' : summary.totals.attemptCount}</p></div>
        <div><p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.measuredTokens')}</p><p className="mt-1 text-sm">{summary.totals.measuredAttemptCount === '0' ? t('runtimeConfig.cloudWorkspace.unmeasured') : t('runtimeConfig.cloudWorkspace.tokens', { input: summary.totals.inputTokens, output: summary.totals.outputTokens })}</p></div>
        <div className="col-span-2"><p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.estimate')}</p>{summary.estimates.length ? summary.estimates.map(estimate => <p key={estimate.currency} className="mt-1 text-sm">{estimate.currency} {estimate.estimatedAmount}</p>) : <p className="mt-1 text-sm">{t('runtimeConfig.cloudWorkspace.noEstimate')}</p>}</div>
      </div>
      {!complete || summary.totals.unpricedAttemptCount !== '0' ? <p className="mt-3 text-xs text-[var(--nimi-status-warning)]">{t('runtimeConfig.cloudWorkspace.partialUsage')}</p> : null}
      <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.usageScope')}</p>
      {summary.partialReasons.length ? <details className="mt-2 text-xs text-[var(--nimi-text-muted)]"><summary>{t('runtimeConfig.profiles.technicalDetails')}</summary>{summary.partialReasons.map(reason => <p key={reason}>{reason}</p>)}</details> : null}
    </> : null}
  </section>;
}

export function CloudHistoryDialog({ connectorId, onClose }: { connectorId?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const navigation = useHomeNavigation();
  const account = useCloudAccount();
  const [filter, setFilter] = useState(connectorId ?? '');
  const { window, days, setDays, refreshRevision, refresh } = useCloudWindow();
  const query = useInfiniteQuery({ queryKey: ['cloud-history', account.key, filter, window, refreshRevision], enabled: account.enabled, retry: false, initialPageParam: '',
    queryFn: ({ pageParam }) => sdk.accountProduct().audit.listDesktopAICloudHistory({ ...window, connectorRef: filter, pageSize: 20, pageToken: pageParam }),
    getNextPageParam: page => page.nextPageToken || undefined,
  });
  const pages = query.data?.pages ?? [];
  const attempts = pages.flatMap(page => page.attempts);
  const outcomeLabel = (value: DesktopAICloudAttemptOutcome) => t(`runtimeConfig.cloudWorkspace.outcome.${value === DesktopAICloudAttemptOutcome.DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED ? 'succeeded' : value === DesktopAICloudAttemptOutcome.DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED ? 'failed' : value === DesktopAICloudAttemptOutcome.DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_CANCELLED ? 'cancelled' : value === DesktopAICloudAttemptOutcome.DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_RUNNING ? 'running' : 'unknown'}`);
  return <OverlayShell open kind="drawer" size="lg" title={t('runtimeConfig.cloudWorkspace.historyTitle')} onClose={onClose} dataTestId="cloud-history-dialog" panelClassName="flex max-h-screen flex-col" contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-0 py-0">
    <ScrollShell className="min-h-0 flex-1 px-6 py-4">
    <div className="space-y-4">
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.historyScope')}</p>
      <div className="flex flex-wrap items-center justify-between gap-2"><SegmentedControl size="sm" value={days} onValueChange={setDays} ariaLabel={t('runtimeConfig.cloudWorkspace.usageWindow')} items={['1','7'].map(value => ({ value, label: t(`runtimeConfig.cloudWorkspace.days${value}`) }))} /><Button size="sm" tone="ghost" onClick={refresh} disabled={query.isFetching}>{t('runtimeConfig.runtime.refresh')}</Button></div>
      {filter ? <div className="flex items-center gap-2 text-xs"><span className="break-all">{t('runtimeConfig.cloudWorkspace.connectionIdentity', { id: filter })}</span><Button size="sm" tone="ghost" onClick={() => setFilter('')}>{t('runtimeConfig.cloudWorkspace.allHistory')}</Button></div> : null}
      {!account.enabled ? <p>{t('runtimeConfig.cloudWorkspace.signInRequired')}</p> : query.isPending ? <p>{t('Common.loading')}</p> : query.isError ? <p role="alert">{t('runtimeConfig.cloudWorkspace.historyFailed')}</p> : <>
        {pages.some(page => !page.recordsComplete || !page.attributionComplete) ? <p className="text-xs text-[var(--nimi-status-warning)]">{t('runtimeConfig.cloudWorkspace.partialHistory')}</p> : null}
        {!attempts.length ? <p>{t(pages.every(page => page.recordsComplete && page.attributionComplete) ? 'runtimeConfig.cloudWorkspace.historyEmpty' : 'runtimeConfig.cloudWorkspace.historyNotObserved')}</p> : <ul className="divide-y divide-[var(--nimi-border-subtle)]">
          {attempts.map(attempt => {
            const reason = normalizeNimiRuntimeReasonCode(attempt.reasonCode);
            const failed = attempt.outcome === DesktopAICloudAttemptOutcome.DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED;
            const failureKey = reason === 'AI_PROVIDER_RATE_LIMITED' ? 'callRateLimited' : reason === 'AI_PROVIDER_AUTH_FAILED' || reason === 'AI_CONNECTOR_CREDENTIAL_MISSING' ? 'callCredentialRejected' : reason === 'AI_MODEL_NOT_FOUND' ? 'callModelUnavailable' : 'callFailed';
            return <li key={attempt.attemptId} className="py-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{attempt.sourceLabel || attempt.sourceId || t('runtimeConfig.cloudWorkspace.unknownSource')}</span><span>{outcomeLabel(attempt.outcome)}</span></div>
            <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{displayRuntimeConfigCapabilityLabel(attempt.capability, t)} · {attempt.models.map(model => model.displayName || model.modelId).join(' · ')}</p>
            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{timestampLabel(attempt.startedAt)}</p>
            {attempt.connectorRef ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>{t('runtimeConfig.cloudWorkspace.connectionIdentity', { id: attempt.connectorRef })}</span>{!filter ? <Button size="sm" tone="ghost" onClick={() => setFilter(attempt.connectorRef)}>{t('runtimeConfig.cloudWorkspace.onlyConnection')}</Button> : null}</div> : <p className="mt-2 text-xs">{t('runtimeConfig.cloudWorkspace.attributionMissing')}</p>}
            {!attempt.usageMeasured ? <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.unmeasured')}</p> : null}
            {failed ? <div className="mt-2"><p className="text-xs text-[var(--nimi-status-danger)]">{t(`runtimeConfig.cloudWorkspace.${failureKey}`)}</p><Button size="sm" tone="ghost" onClick={() => { onClose(); void navigation.push(homeRuntimeDestination('advancedDiagnostics', { pane: 'activity' })); }}>{t('runtimeConfig.cloudWorkspace.openDiagnostics')}</Button></div> : null}
            {failed && reason ? <details className="mt-1 text-xs text-[var(--nimi-text-muted)]"><summary>{t('runtimeConfig.profiles.technicalDetails')}</summary><p>{reason}</p></details> : null}
          </li>; })}
        </ul>}
        {query.hasNextPage ? <Button size="sm" tone="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('runtimeConfig.cloudWorkspace.loadMore')}</Button> : null}
      </>}
    </div>
    </ScrollShell>
  </OverlayShell>;
}
