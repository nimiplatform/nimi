import { Button, InlineAlert, LoadingSkeleton, ScrollArea } from '@nimiplatform/kit/ui';
import {
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
  type DesktopAIExecution,
  type DesktopAIExecutionModel,
  type DesktopAICostEstimate,
  type DesktopAISourceCoverage,
} from '@nimiplatform/sdk/runtime/generated';
import { Activity, ArrowLeft, ChevronRight, Coins, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHELL_PAGE_WIDTH_CLASS } from '../../app-shell/layouts/shell-chrome-classes.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { projectSystemEntryUsage, type SystemEntryAIState } from './system-entry-ai-model.js';
import { useSystemEntry, useSystemEntryAI } from './system-entry-context.js';
import { systemEntryTimestampIso } from './system-entry-time.js';

export type SystemEntryReadingSection = 'work' | 'usage';
const PREFIX = 'runtimeConfig.systemEntry';
const SOURCE_KEYS: Readonly<Record<string, string>> = {
  home: 'home', app: 'app', 'direct-runtime': 'directRuntime',
  'local-agent': 'localAgent', 'agent-background': 'agentBackground', realtime: 'realtime',
};

function count(value: string | undefined, locale: string): string | null {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value)
    ? new Intl.NumberFormat(locale).format(BigInt(value)) : null;
}

function groupWork(executions: readonly DesktopAIExecution[]) {
  const groups = new Map<string, DesktopAIExecution[]>();
  for (const execution of executions) {
    const key = execution.parentWorkId && execution.parentWorkKind
      ? `work:${execution.parentWorkKind}:${execution.parentWorkId}` : `attempt:${execution.attemptId}`;
    const group = groups.get(key) ?? [];
    group.push(execution); groups.set(key, group);
  }
  return [...groups.entries()];
}

function RouteLabel({ route }: { route: DesktopAIExecutionRoute }) {
  const { t } = useTranslation();
  const key = route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL ? 'local'
    : route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD ? 'cloud' : 'routeUnknown';
  return <span className="text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${key}`)}</span>;
}

function ModelList({ models }: { models: readonly DesktopAIExecutionModel[] }) {
  const { t } = useTranslation();
  if (!models.length) return <span className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.modelPending`)}</span>;
  return <ul className="space-y-1 text-sm">
    {models.map((model, index) => <li key={`${model.providerId}:${model.modelId}:${model.role}:${index}`} className="break-words">
      <span className="font-medium text-[var(--nimi-text-primary)]">{model.displayName || model.modelId || t(`${PREFIX}.modelUnknown`)}</span>
      {model.providerId ? <span className="ml-2 text-[var(--nimi-text-secondary)]">{model.providerId}</span> : null}
    </li>)}
  </ul>;
}

function RecordedTime({ value, timeZone }: { value: Parameters<typeof systemEntryTimestampIso>[0]; timeZone?: string }) {
  const { t, i18n } = useTranslation();
  const iso = systemEntryTimestampIso(value);
  if (!iso) return <span>{t(`${PREFIX}.unknown`)}</span>;
  return <time dateTime={iso}>{new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))}</time>;
}

function SourceCoverage({ sources, mode }: { sources: readonly DesktopAISourceCoverage[]; mode: 'activity' | 'usage' }) {
  const { t } = useTranslation();
  return <details className="rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-sm">
    <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">{t(`${PREFIX}.sourceCoverage`)}</summary>
    {!sources.length ? <p className="mt-3 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.coverageUnknown`)}</p> : <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {sources.map(source => <li key={source.source} className="flex items-baseline justify-between gap-3">
        <span>{SOURCE_KEYS[source.source] ? t(`${PREFIX}.sources.${SOURCE_KEYS[source.source]}`) : source.source}</span>
        <span className="text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${(mode === 'activity' ? source.activityComplete : source.usageComplete) ? 'covered' : 'notCovered'}`)}</span>
      </li>)}
    </ul>}
  </details>;
}

function Estimates({ estimates }: { estimates: readonly DesktopAICostEstimate[] }) {
  const { t } = useTranslation();
  const valid = estimates.filter(value => /^[A-Z]{3,8}$/u.test(value.currency)
    && /^\d+(\.\d+)?$/u.test(value.estimatedAmount) && value.estimatedAmount.length <= 40);
  if (!valid.length) return <span className="text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.costUnknown`)}</span>;
  return <ul className="space-y-1">
    {valid.map((estimate, index) => <li key={`${estimate.currency}:${index}`} className="tabular-nums">
      <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{estimate.currency}</span><span className="break-all">{t(`${PREFIX}.estimatedAmount`, { amount: estimate.estimatedAmount })}</span></div>
      <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">{estimate.pricingBasis === 'captured_catalog_estimate'
        ? t(`${PREFIX}.capturedPricing`) : t(`${PREFIX}.pricingBasis`, { value: estimate.pricingBasis || t(`${PREFIX}.unknown`) })}</p>
    </li>)}
    {valid.length !== estimates.length ? <li className="text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.costUnknown`)}</li> : null}
  </ul>;
}

function CurrentWorkReading({ ai }: { ai: SystemEntryAIState | null }) {
  const { t, i18n } = useTranslation();
  const read = ai?.activity;
  if (!read || read.status === 'loading') return <LoadingSkeleton lines={4} label={t(`${PREFIX}.workLoading`)} />;
  if (read.status !== 'ready' || !read.value) return <InlineAlert tone="warning">{t(`${PREFIX}.workUnavailable`)}</InlineAlert>;
  const snapshot = read.value;
  const groups = groupWork(snapshot.executions);
  const sourceComplete = snapshot.sourceCoverage.length > 0 && snapshot.sourceCoverage.every(source => source.activityComplete);
  const workCount = snapshot.workCountKnown && sourceComplete
    ? count(snapshot.knownWorkCount, i18n.resolvedLanguage ?? 'en') : null;
  const complete = sourceComplete && snapshot.recordsComplete && workCount !== null && snapshot.partialReasons.length === 0;
  return <div className="space-y-5" data-testid="home-current-work-reading">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-medium">{workCount === null ? t(`${PREFIX}.workCountUnknown`) : t(`${PREFIX}.workCount`, { value: workCount })}</p>
      <p className="text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.lastObserved`)} <RecordedTime value={snapshot.observedAt} timeZone={ai?.range.timeZone} /></p>
    </div>
    {!complete ? <InlineAlert tone="info">{t(`${PREFIX}.workPartial`, { count: groups.length })}</InlineAlert> : null}
    {!groups.length ? <p className="py-5 text-sm text-[var(--nimi-text-secondary)]" role="status">{t(`${PREFIX}.${complete ? 'workEmpty' : 'workEmptyPartial'}`)}</p> : <div className="divide-y divide-[var(--nimi-border-subtle)]">
      {groups.map(([key, executions]) => {
        const first = executions[0]!;
        const unknown = executions.some(execution => execution.state !== DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING);
        return <article key={key} className="py-5 first:pt-0" data-testid="home-current-work-row">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold">{first.sourceLabel || t(`${PREFIX}.executionSource`)}</h2>
              {!first.parentWorkId || !first.parentWorkKind ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.unassociated`)}</p> : null}
            </div>
            <span className={`text-sm font-medium ${unknown ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}>{t(`${PREFIX}.${unknown ? 'stateUnknown' : 'running'}`)}</span>
          </div>
          {unknown ? <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.observationUnknown`)}</p> : null}
          <ul className="mt-3 space-y-4">
            {executions.map(execution => <li key={execution.attemptId} className="grid gap-2 sm:grid-cols-[minmax(8rem,0.6fr)_minmax(0,1fr)]">
              <div><p className="text-sm">{displayRuntimeConfigCapabilityLabel(execution.capability, t)}</p><RouteLabel route={execution.route} /></div>
              <div className="min-w-0"><ModelList models={execution.models} />
                <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.startedAt`)} <RecordedTime value={execution.startedAt} timeZone={ai?.range.timeZone} /></p>
                {execution.state !== DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.lastObserved`)} <RecordedTime value={execution.observedAt} timeZone={ai?.range.timeZone} /></p> : null}
              </div>
            </li>)}
          </ul>
        </article>;
      })}
    </div>}
    <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.workReadOnly`)}</p>
    <SourceCoverage sources={snapshot.sourceCoverage} mode="activity" />
  </div>;
}

function UsageReading({ ai }: { ai: SystemEntryAIState | null }) {
  const { t, i18n } = useTranslation();
  const read = ai?.usage;
  if (!ai || !read || read.status === 'loading') return <LoadingSkeleton lines={4} label={t(`${PREFIX}.usageLoading`)} />;
  if (read.status !== 'ready' || !read.value?.totals) return <InlineAlert tone="warning">{t(`${PREFIX}.usageUnavailable`)}</InlineAlert>;
  const summary = read.value;
  const locale = i18n.resolvedLanguage ?? 'en';
  const projection = projectSystemEntryUsage(read, ai.range, locale.startsWith('zh') ? 'zh' : 'en');
  if (projection.status === 'unavailable') return <InlineAlert tone="warning">{t(`${PREFIX}.usageUnavailable`)}</InlineAlert>;
  const display = (value: string | undefined | null) => count(value ?? undefined, locale) ?? t(`${PREFIX}.unknown`);
  const coverage = [
    ['executionSources', summary.sourceComplete && summary.sourceCoverage.length > 0],
    ['recordedTime', summary.timeComplete],
    ['usageQuantities', summary.quantityComplete],
    ['groupDetail', summary.groupsComplete],
  ] as const;
  return <div className="space-y-6" data-testid="home-ai-usage-reading">
    <p className="text-sm text-[var(--nimi-text-secondary)]">{ai.range.date} · {ai.range.timeZone} · {t(`${PREFIX}.readAt`)} <RecordedTime value={summary.readAt} timeZone={ai.range.timeZone} /></p>
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 border-y border-[var(--nimi-border-subtle)] py-5 sm:grid-cols-3">
      {[
        ['recordedAttempts', projection.attempts], ['local', projection.localAttempts], ['cloud', projection.cloudAttempts],
        ['pendingUsage', summary.totals?.pendingUsageCount], ['unpricedUsage', summary.totals?.unpricedAttemptCount],
      ].map(([key, value]) => <div key={key}><dt className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${key}`)}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{display(value)}</dd></div>)}
      <div><dt className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimatedCosts`)}</dt><dd className="mt-1 text-sm"><Estimates estimates={summary.estimates} /></dd></div>
    </dl>
    <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.attemptDefinition`)}</p>
    <section aria-labelledby="home-usage-coverage-title" className="space-y-3">
      <h2 id="home-usage-coverage-title" className="text-base font-semibold">{t(`${PREFIX}.coverageTitle`)}</h2>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{coverage.map(([key, complete]) => <div key={key} className="flex items-baseline justify-between gap-3 text-sm">
        <dt>{t(`${PREFIX}.${key}`)}</dt><dd className={complete ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-status-warning)]'}>{t(`${PREFIX}.${complete ? 'complete' : 'partial'}`)}</dd>
      </div>)}</dl>
      {projection.partial ? <InlineAlert tone="info">{t(`${PREFIX}.usagePartial`)}</InlineAlert> : null}
      <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.recordedBounds`)} <RecordedTime value={summary.coverageFrom} timeZone={ai.range.timeZone} /> — <RecordedTime value={summary.coverageTo} timeZone={ai.range.timeZone} /></p>
      <SourceCoverage sources={summary.sourceCoverage} mode="usage" />
    </section>
    <section aria-labelledby="home-usage-detail-title" className="space-y-3">
      <h2 id="home-usage-detail-title" className="text-base font-semibold">{t(`${PREFIX}.modelBreakdown`)}</h2>
      {!summary.groups.length ? <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${summary.groupsComplete && projection.attempts === '0' ? 'usageEmpty' : 'groupsUnavailable'}`)}</p> : <ul className="divide-y divide-[var(--nimi-border-subtle)]">
        {summary.groups.map((group, index) => <li key={`${group.sourceKind}:${group.capability}:${index}`} className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,0.35fr)_minmax(8rem,0.5fr)]">
          <div className="min-w-0"><ModelList models={group.models} /><p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{SOURCE_KEYS[group.sourceKind] ? t(`${PREFIX}.sources.${SOURCE_KEYS[group.sourceKind]}`) : group.sourceKind} · {displayRuntimeConfigCapabilityLabel(group.capability, t)} · <RouteLabel route={group.route} /></p></div>
          <div className="text-sm tabular-nums"><p className="text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.recordedAttempts`)}</p>{display(group.totals?.attemptCount)}</div>
          <div className="text-sm"><p className="mb-1 text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimatedCosts`)}</p><Estimates estimates={group.estimates} /></div>
        </li>)}
      </ul>}
    </section>
    <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimateDisclaimer`)}</p>
  </div>;
}

export function SystemEntryDetailsView({ section, ai, onBack, onSectionChange, onRefresh, refreshing = false, refreshError = false }: {
  section: SystemEntryReadingSection;
  ai: SystemEntryAIState | null;
  onBack(): void;
  onSectionChange(section: SystemEntryReadingSection): void;
  onRefresh(): void;
  refreshing?: boolean;
  refreshError?: boolean;
}) {
  const { t } = useTranslation();
  return <div className="flex min-h-0 flex-1 flex-col p-3"><ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent [&>div]:!block" contentClassName={`${SHELL_PAGE_WIDTH_CLASS} space-y-6 pb-8 pt-5`}>
    <header className="space-y-4">
      <Button tone="ghost" size="sm" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t('runtimeConfig.overview.back')}</Button>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">{t(`${PREFIX}.${section === 'work' ? 'workTitle' : 'usageTitle'}`)}</h1><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.scope`)}</p></div>
        <Button tone="ghost" size="sm" disabled={refreshing} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" />{t(refreshing ? 'Common.loading' : 'runtimeConfig.overview.refresh')}</Button>
      </div>
      <nav className="flex gap-2 border-b border-[var(--nimi-border-subtle)] pb-3" aria-label={t(`${PREFIX}.readingNavigation`)}>
        {(['work', 'usage'] as const).map(value => <Button key={value} tone="ghost" size="sm" aria-current={value === section ? 'page' : undefined} className={value === section ? 'font-semibold text-[var(--nimi-action-primary-bg)]' : ''} onClick={() => onSectionChange(value)}>{t(`${PREFIX}.${value === 'work' ? 'workTitle' : 'usageTitle'}`)}</Button>)}
      </nav>
    </header>
    {refreshError ? <InlineAlert tone="warning">{t(`${PREFIX}.refreshFailed`)}</InlineAlert> : null}
    {section === 'work' ? <CurrentWorkReading ai={ai} /> : <UsageReading ai={ai} />}
  </ScrollArea></div>;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
export function SystemEntryDetails(props: { section: SystemEntryReadingSection; onBack(): void; onSectionChange(section: SystemEntryReadingSection): void }) {
  const ai = useSystemEntryAI();
  const { refresh } = useSystemEntry();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const onRefresh = () => {
    if (refreshing) return;
    setRefreshing(true); setRefreshError(false);
    void refresh().catch(() => setRefreshError(true)).finally(() => setRefreshing(false));
  };
  return <SystemEntryDetailsView {...props} ai={ai} onRefresh={onRefresh} refreshing={refreshing} refreshError={refreshError} />;
}

export function HomeAIReadingEntries({ onOpenWork, onOpenUsage }: { onOpenWork(): void; onOpenUsage(): void }) {
  const { t } = useTranslation();
  return <nav className="mt-3 flex flex-wrap gap-2" aria-label={t(`${PREFIX}.readingNavigation`)}>
    <Button tone="ghost" size="sm" onClick={onOpenWork} data-testid="home-work-entry"><Activity size={16} aria-hidden="true" />{t(`${PREFIX}.workTitle`)}<ChevronRight size={15} aria-hidden="true" /></Button>
    <Button tone="ghost" size="sm" onClick={onOpenUsage} data-testid="home-usage-entry"><Coins size={16} aria-hidden="true" />{t(`${PREFIX}.usageTitle`)}<ChevronRight size={15} aria-hidden="true" /></Button>
  </nav>;
}
