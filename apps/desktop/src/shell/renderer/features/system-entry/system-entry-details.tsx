import { Button, InlineAlert, LoadingSkeleton, ScrollArea, SearchField } from '@nimiplatform/kit/ui';
import {
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
  type DesktopAIExecution,
  type DesktopAIExecutionModel,
  type DesktopAICostEstimate,
  type DesktopAISourceCoverage,
  type DesktopAIUsageGroup,
  type DesktopAIUsageSummary,
} from '@nimiplatform/sdk/runtime/generated';
import { Activity, ArrowLeft, CalendarDays, Check, ChevronDown, Cloud, Coins, Cpu, Info, Layers3, RefreshCw } from 'lucide-react';
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

function SourceCoverage({ sources, mode, inline = false }: { sources: readonly DesktopAISourceCoverage[]; mode: 'activity' | 'usage'; inline?: boolean }) {
  const { t } = useTranslation();
  const content = !sources.length ? <p className="text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.coverageUnknown`)}</p> : <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
    {sources.map(source => <li key={source.source} className="flex items-baseline justify-between gap-3">
      <span>{SOURCE_KEYS[source.source] ? t(`${PREFIX}.sources.${SOURCE_KEYS[source.source]}`) : source.source}</span>
      <span className="text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${(mode === 'activity' ? source.activityComplete : source.usageComplete) ? 'covered' : 'notCovered'}`)}</span>
    </li>)}
  </ul>;
  if (inline) return <section aria-label={t(`${PREFIX}.sourceCoverage`)} className="text-sm">
    <h3 className="font-medium">{t(`${PREFIX}.sourceCoverage`)}</h3><div className="mt-3">{content}</div>
  </section>;
  return <details className="rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-sm">
    <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">{t(`${PREFIX}.sourceCoverage`)}</summary>
    <div className="mt-3">{content}</div>
  </details>;
}

function Estimates({ estimates, emphasis = false, showPricingBasis = true }: {
  estimates: readonly DesktopAICostEstimate[];
  emphasis?: boolean;
  showPricingBasis?: boolean;
}) {
  const { t } = useTranslation();
  const valid = estimates.filter(value => /^[A-Z]{3,8}$/u.test(value.currency)
    && /^\d+(\.\d+)?$/u.test(value.estimatedAmount) && value.estimatedAmount.length <= 40);
  if (!valid.length) return <span className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.costUnknown`)}</span>;
  return <ul className={emphasis ? 'space-y-4' : 'space-y-1 text-right'}>
    {valid.map((estimate, index) => <li key={`${estimate.currency}:${index}`} className="min-w-0 tabular-nums">
      <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2.5 ${emphasis ? '' : 'justify-end'}`}>
        <span className={`${emphasis ? 'text-xs uppercase tracking-[0.08em]' : 'text-xs'} font-medium text-[var(--nimi-text-secondary)]`}>{estimate.currency}</span>
        <span className={`${emphasis ? 'text-3xl font-semibold tracking-[-0.035em]' : 'text-lg font-semibold'} break-all`}>{estimate.estimatedAmount}</span>
      </div>
      {showPricingBasis ? <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{estimate.pricingBasis === 'captured_catalog_estimate'
        ? t(`${PREFIX}.capturedPricing`) : t(`${PREFIX}.pricingBasis`, { value: estimate.pricingBasis || t(`${PREFIX}.unknown`) })}</p> : null}
    </li>)}
    {valid.length !== estimates.length ? <li className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.costUnknown`)}</li> : null}
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

function hasPositiveCount(value: string | undefined): boolean {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value) && BigInt(value) > 0n;
}

function UsageRouteSummary({ attempts, localAttempts, cloudAttempts }: { attempts: string | null; localAttempts: string | null; cloudAttempts: string | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const display = (value: string | null) => count(value ?? undefined, locale) ?? t(`${PREFIX}.unknown`);
  const valid = [attempts, localAttempts, cloudAttempts].every(value => typeof value === 'string' && /^\d{1,30}$/u.test(value));
  const total = valid ? BigInt(attempts!) : 0n;
  const local = valid ? BigInt(localAttempts!) : 0n;
  const cloud = valid ? BigInt(cloudAttempts!) : 0n;
  const unknown = valid ? total - local - cloud : 0n;
  const showUnknown = unknown > 0n;
  const showBar = valid && total > 0n && unknown >= 0n;
  const localPoints = showBar ? Number(local * 10000n / total) : 0;
  const unknownPoints = showBar ? Number(unknown * 10000n / total) : 0;
  const cloudPoints = showBar ? 10000 - localPoints - unknownPoints : 0;
  return <div className="mt-6" data-testid="home-usage-route-summary">
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)] px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]"><Cpu size={15} aria-hidden="true" /></span>
        <span className="min-w-0"><span className="block text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.local`)}</span><span className="mt-0.5 block text-lg font-semibold tabular-nums">{display(localAttempts)}</span></span>
      </div>
      <div className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)] px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Cloud size={15} aria-hidden="true" /></span>
        <span className="min-w-0"><span className="block text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.cloud`)}</span><span className="mt-0.5 block text-lg font-semibold tabular-nums">{display(cloudAttempts)}</span></span>
      </div>
    </div>
    {showUnknown ? <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.routeUnknown`)} <span className="font-medium text-[var(--nimi-text-primary)] tabular-nums">{display(String(unknown))}</span></p> : null}
    {showBar ? <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-[var(--nimi-border-subtle)]" aria-hidden="true">
      <span className="bg-[var(--nimi-text-muted)]" style={{ width: `${localPoints / 100}%` }} />
      <span className="bg-[var(--nimi-action-primary-bg)]" style={{ width: `${cloudPoints / 100}%` }} />
      <span className="bg-[var(--nimi-status-warning)]" style={{ width: `${unknownPoints / 100}%` }} />
    </div> : null}
  </div>;
}

type UsageRouteFilter = 'all' | 'local' | 'cloud';

function UsageGroups({ groups, attempts, groupsComplete }: { groups: readonly DesktopAIUsageGroup[]; attempts: string | null; groupsComplete: boolean }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState<UsageRouteFilter>('all');
  const locale = i18n.resolvedLanguage ?? 'en';
  const display = (value: string | undefined) => count(value, locale) ?? t(`${PREFIX}.unknown`);
  if (!groups.length) return <section aria-labelledby="home-usage-detail-title" className="rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)] sm:p-6">
    <h2 id="home-usage-detail-title" className="text-lg font-semibold tracking-[-0.02em]">{t(`${PREFIX}.modelBreakdown`)}</h2>
    <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.breakdownDescription`)}</p>
    <p className="mt-5 rounded-2xl bg-[var(--nimi-surface-panel)] px-4 py-8 text-center text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${groupsComplete && attempts === '0' ? 'usageEmpty' : 'groupsUnavailable'}`)}</p>
  </section>;
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filtered = normalizedQuery.length > 0 || route !== 'all';
  const visible = groups.flatMap((group, index) => {
    const routeMatches = route === 'all'
      || (route === 'local' && group.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL)
      || (route === 'cloud' && group.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD);
    if (!routeMatches) return [];
    const source = SOURCE_KEYS[group.sourceKind] ? t(`${PREFIX}.sources.${SOURCE_KEYS[group.sourceKind]}`) : group.sourceKind;
    const capability = displayRuntimeConfigCapabilityLabel(group.capability, t);
    const searchText = [source, capability, group.sourceKind, group.capability,
      ...group.models.flatMap(model => [model.displayName, model.modelId, model.providerId])].join(' ').toLocaleLowerCase(locale);
    return !normalizedQuery || searchText.includes(normalizedQuery) ? [{ group, index }] : [];
  });
  const clearFilters = () => { setQuery(''); setRoute('all'); };
  return <section aria-labelledby="home-usage-detail-title" className="rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)] sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="home-usage-detail-title" className="text-lg font-semibold tracking-[-0.02em]">{t(`${PREFIX}.modelBreakdown`)}</h2>
        <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.breakdownDescription`)}</p></div>
      {groups.length > 5 || filtered ? <p className="rounded-full bg-[var(--nimi-surface-panel)] px-2.5 py-1 text-xs text-[var(--nimi-text-secondary)] tabular-nums" role="status">
        {t(filtered ? `${PREFIX}.filteredResults` : `${PREFIX}.groupCount`, filtered ? { shown: visible.length, total: groups.length } : { count: groups.length })}
      </p> : null}
    </div>
    {groups.length > 5 || filtered ? <div className="mt-5 flex flex-wrap items-center gap-2">
      <SearchField value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }}
        placeholder={t(`${PREFIX}.searchGroups`)} aria-label={t(`${PREFIX}.searchGroups`)} aria-controls="home-usage-group-list" className="min-w-0 flex-1 text-sm sm:max-w-sm" />
      <label className="sr-only" htmlFor="home-usage-route-filter">{t(`${PREFIX}.routeFilter`)}</label>
      <select id="home-usage-route-filter" aria-label={t(`${PREFIX}.routeFilter`)} value={route} onChange={event => setRoute(event.target.value as UsageRouteFilter)}
        className="min-h-[var(--nimi-sizing-field-md-height)] rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
        <option value="all">{t(`${PREFIX}.allRoutes`)}</option><option value="local">{t(`${PREFIX}.local`)}</option><option value="cloud">{t(`${PREFIX}.cloud`)}</option>
      </select>
      {filtered ? <Button tone="ghost" size="sm" onClick={clearFilters}>{t(`${PREFIX}.clearFilters`)}</Button> : null}
    </div> : null}
    {visible.length ? <ul id="home-usage-group-list" className="mt-5 space-y-3">
      {visible.map(({ group, index }) => <li key={`${group.sourceKind}:${group.capability}:${index}`} data-testid="home-usage-group"
        className="grid gap-5 rounded-[20px] bg-[var(--nimi-surface-panel)] p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.38fr)] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Layers3 size={18} aria-hidden="true" /></span>
          <div className="min-w-0"><ModelList models={group.models} /><p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
            <span className="rounded-full bg-[var(--nimi-surface-card)] px-2.5 py-1">{SOURCE_KEYS[group.sourceKind] ? t(`${PREFIX}.sources.${SOURCE_KEYS[group.sourceKind]}`) : group.sourceKind}</span>
            <span className="rounded-full bg-[var(--nimi-surface-card)] px-2.5 py-1">{displayRuntimeConfigCapabilityLabel(group.capability, t)}</span>
            <span className="rounded-full bg-[var(--nimi-surface-card)] px-2.5 py-1"><RouteLabel route={group.route} /></span></p></div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-[var(--nimi-border-subtle)] pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="tabular-nums"><span className="block text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.recordedAttemptsShort`)}</span>
            <span className="mt-1 block text-xl font-semibold">{display(group.totals?.attemptCount)}</span></div>
          <div className="min-w-0 text-right"><span className="block text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimatedCosts`)}</span>
            <div className="mt-1"><Estimates estimates={group.estimates} showPricingBasis={false} /></div></div>
        </div>
      </li>)}
    </ul> : <div className="mt-5 rounded-2xl bg-[var(--nimi-surface-panel)] py-10 text-center" role="status">
      <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.noMatchingGroups`)}</p>
      <Button tone="ghost" size="sm" className="mt-2" onClick={clearFilters}>{t(`${PREFIX}.clearFilters`)}</Button>
    </div>}
  </section>;
}

function UsageDataDetails({ summary, timeZone, partial }: { summary: DesktopAIUsageSummary; timeZone: string; partial: boolean }) {
  const { t, i18n } = useTranslation();
  const display = (value: string | undefined) => count(value, i18n.resolvedLanguage ?? 'en') ?? t(`${PREFIX}.unknown`);
  const coverage = [
    ['executionSources', summary.sourceComplete && summary.sourceCoverage.length > 0],
    ['recordedTime', summary.timeComplete], ['usageQuantities', summary.quantityComplete], ['groupDetail', summary.groupsComplete],
  ] as const;
  return <details className="group rounded-[20px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-1 sm:px-5" data-testid="home-usage-data-details">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 flex-wrap items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]"><Info size={15} aria-hidden="true" /></span>
        <span>{t(`${PREFIX}.coverageTitle`)}</span><span data-testid="home-usage-coverage-status" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${partial ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' : 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]'}`}>
          {partial ? null : <Check size={12} aria-hidden="true" />}{t(`${PREFIX}.${partial ? 'partial' : 'complete'}`)}</span></span>
      <ChevronDown size={16} className="shrink-0 text-[var(--nimi-text-secondary)] transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="space-y-5 border-t border-[var(--nimi-border-subtle)] py-5">
      {partial ? <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.usagePartial`)}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl bg-[var(--nimi-surface-panel)] p-4"><h3 className="text-sm font-medium">{t(`${PREFIX}.recordedAttempts`)}</h3><p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.attemptDefinition`)}</p></section>
        <section className="rounded-2xl bg-[var(--nimi-surface-panel)] p-4"><h3 className="text-sm font-medium">{t(`${PREFIX}.estimatedCosts`)}</h3><p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimateDisclaimer`)}</p></section>
      </div>
      <dl className="grid gap-x-8 gap-y-3 rounded-2xl bg-[var(--nimi-surface-panel)] p-4 sm:grid-cols-2">
        {coverage.map(([key, complete]) => <div key={key} className="flex items-baseline justify-between gap-3 text-sm">
          <dt>{t(`${PREFIX}.${key}`)}</dt><dd className={complete ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-status-warning)]'}>{t(`${PREFIX}.${complete ? 'complete' : 'partial'}`)}</dd>
        </div>)}
        {(['pendingUsage', 'unpricedUsage'] as const).map(key => <div key={key} className="flex items-baseline justify-between gap-3 text-sm">
          <dt>{t(`${PREFIX}.${key}`)}</dt><dd className="text-[var(--nimi-text-secondary)] tabular-nums">{display(summary.totals?.[key === 'pendingUsage' ? 'pendingUsageCount' : 'unpricedAttemptCount'])}</dd>
        </div>)}
      </dl>
      <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.recordedBounds`)} <RecordedTime value={summary.coverageFrom} timeZone={timeZone} /> — <RecordedTime value={summary.coverageTo} timeZone={timeZone} /></p>
      <SourceCoverage sources={summary.sourceCoverage} mode="usage" inline />
    </div>
  </details>;
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
  const pending = hasPositiveCount(summary.totals?.pendingUsageCount);
  const unpriced = hasPositiveCount(summary.totals?.unpricedAttemptCount);
  const attention = projection.partial || pending || unpriced;
  return <div className="space-y-6" data-testid="home-ai-usage-reading">
    <section aria-label={t(`${PREFIX}.usageSummary`)} className="space-y-4" data-testid="home-usage-summary">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">
        <p className="flex items-center gap-2"><CalendarDays size={14} aria-hidden="true" /><span>{ai.range.date} · {ai.range.timeZone}</span></p>
        <p>{t(`${PREFIX}.readAt`)} <RecordedTime value={summary.readAt} timeZone={ai.range.timeZone} /></p>
      </div>
      <dl className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="relative min-w-0 overflow-hidden rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)] sm:p-6" data-testid="home-usage-attempts-card">
          <span className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_7%,transparent)] blur-2xl" aria-hidden="true" />
          <dt className="relative flex items-center gap-2.5 text-sm font-medium text-[var(--nimi-text-secondary)]"><span className="flex size-9 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Activity size={17} aria-hidden="true" /></span>{t(`${PREFIX}.recordedAttempts`)}</dt>
          <dd className="relative mt-5 text-5xl font-semibold leading-none tracking-[-0.045em] tabular-nums">{display(projection.attempts)}</dd>
          <dd className="relative"><UsageRouteSummary attempts={projection.attempts} localAttempts={projection.localAttempts} cloudAttempts={projection.cloudAttempts} /></dd>
        </div>
        <div className="relative min-w-0 overflow-hidden rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)] sm:p-6" data-testid="home-usage-cost-card">
          <span className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,transparent)] blur-2xl" aria-hidden="true" />
          <dt className="relative flex items-center gap-2.5 text-sm font-medium text-[var(--nimi-text-secondary)]"><span className="flex size-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]"><Coins size={17} aria-hidden="true" /></span>{t(`${PREFIX}.estimatedCosts`)}</dt>
          <dd className="relative mt-5"><Estimates estimates={summary.estimates} emphasis /></dd>
          {summary.estimates.length ? <dd className="relative mt-5 flex items-start gap-2 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)] p-3 text-xs leading-5 text-[var(--nimi-text-secondary)]"><Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{t(`${PREFIX}.estimateShortDisclaimer`)}</dd> : null}
        </div>
      </dl>
    </section>
    {attention ? <div className="flex items-start gap-3 rounded-2xl border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] px-4 py-3.5 text-sm" data-testid="home-usage-attention">
      <Info size={17} className="mt-0.5 shrink-0 text-[var(--nimi-status-warning)]" aria-hidden="true" />
      <div><p className="leading-6 text-[var(--nimi-status-warning-soft-text)]">{t(`${PREFIX}.usagePartialShort`)}</p>
        {pending || unpriced ? <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--nimi-status-warning-soft-text)]">
          {pending ? <li>{t(`${PREFIX}.pendingUsage`)} <span className="font-medium text-[var(--nimi-text-primary)] tabular-nums">{display(summary.totals?.pendingUsageCount)}</span></li> : null}
          {unpriced ? <li>{t(`${PREFIX}.unpricedUsage`)} <span className="font-medium text-[var(--nimi-text-primary)] tabular-nums">{display(summary.totals?.unpricedAttemptCount)}</span></li> : null}
        </ul> : null}
      </div>
    </div> : null}
    <UsageGroups groups={summary.groups} attempts={projection.attempts} groupsComplete={summary.groupsComplete} />
    <UsageDataDetails summary={summary} timeZone={ai.range.timeZone} partial={attention} />
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
  return <div className="flex min-h-0 flex-1 flex-col p-3"><ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent [&>div]:!block" contentClassName={`${SHELL_PAGE_WIDTH_CLASS} pb-8 pt-5`}>
    <div className="mx-auto w-full max-w-[1120px] space-y-6">
      <header className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button tone="ghost" size="sm" className="-ml-2" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t('runtimeConfig.overview.back')}</Button>
          <nav className="flex rounded-full bg-[var(--nimi-surface-panel)] p-1" aria-label={t(`${PREFIX}.readingNavigation`)}>
            {(['work', 'usage'] as const).map(value => <Button key={value} tone="ghost" size="sm" aria-current={value === section ? 'page' : undefined}
              className={`rounded-full px-4 ${value === section ? 'bg-[var(--nimi-surface-card)] font-semibold text-[var(--nimi-action-primary-bg)] shadow-sm' : 'text-[var(--nimi-text-secondary)]'}`}
              onClick={() => onSectionChange(value)}>{t(`${PREFIX}.${value === 'work' ? 'workTitle' : 'usageTitle'}`)}</Button>)}
          </nav>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-[28px] font-semibold tracking-[-0.035em]">{t(`${PREFIX}.${section === 'work' ? 'workTitle' : 'usageTitle'}`)}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-[var(--nimi-text-secondary)]"><span>{t(`${PREFIX}.scope`)}</span>{section === 'usage' ? <><span aria-hidden="true">·</span><span>{t(`${PREFIX}.usageSubtitle`)}</span></> : null}</p></div>
          <Button tone="secondary" size="sm" className="rounded-full px-4" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" />{t(refreshing ? 'Common.loading' : 'runtimeConfig.overview.refresh')}</Button>
        </div>
      </header>
      {refreshError ? <InlineAlert tone="warning">{t(`${PREFIX}.refreshFailed`)}</InlineAlert> : null}
      {section === 'work' ? <CurrentWorkReading ai={ai} /> : <UsageReading ai={ai} />}
    </div>
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
