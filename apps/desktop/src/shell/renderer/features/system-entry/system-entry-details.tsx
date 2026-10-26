import { Button, IconButton, InlineAlert, LoadingSkeleton, ScrollArea, SearchField, Tooltip } from '@nimiplatform/kit/ui';
import {
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
  type DesktopAIExecution,
  type DesktopAIExecutionModel,
  type DesktopAICostEstimate,
  type DesktopAIUsageGroup,
} from '@nimiplatform/sdk/runtime/generated';
import { Activity, ArrowLeft, CalendarDays, ChevronDown, Coins, Info, Layers3, Play, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SHELL_PAGE_WIDTH_CLASS } from '../../app-shell/layouts/shell-chrome-classes.js';
import { isSystemEntryLocalOnlyUsage } from '../../../shared/system-entry-types.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { projectSystemEntryUsage, type SystemEntryAIState } from './system-entry-ai-model.js';
import { useSystemEntry, useSystemEntryAI } from './system-entry-context.js';
import { systemEntryTimestampIso } from './system-entry-time.js';

const PREFIX = 'runtimeConfig.systemEntry';
const PANEL_CLASS = 'min-w-0 rounded-[20px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)]';
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

function Estimates({ estimates, emphasis = false, local = false }: {
  estimates: readonly DesktopAICostEstimate[];
  emphasis?: boolean;
  local?: boolean;
}) {
  const { t } = useTranslation();
  if (local && !estimates.length) return <div className={`${emphasis ? 'text-[40px] font-semibold leading-tight tracking-[-0.035em]' : 'text-right text-sm font-medium'} tabular-nums`}>0</div>;
  const valid = estimates.filter(value => /^[A-Z]{3,8}$/u.test(value.currency)
    && /^\d+(\.\d+)?$/u.test(value.estimatedAmount) && value.estimatedAmount.length <= 40);
  if (!valid.length) return <span className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.costUnknown`)}</span>;
  return <ul className={emphasis ? 'space-y-2' : 'space-y-1 text-right'}>
    {valid.map((estimate, index) => <li key={`${estimate.currency}:${index}`} className="min-w-0 tabular-nums">
      <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2.5 ${emphasis ? '' : 'justify-end'}`}>
        <span className={`${emphasis ? 'text-xs uppercase tracking-[0.08em]' : 'text-xs'} font-medium text-[var(--nimi-text-secondary)]`}>{estimate.currency}</span>
        <span className={`${emphasis ? 'text-[40px] font-semibold leading-tight tracking-[-0.035em]' : 'text-sm font-medium'} break-all`}>{estimate.estimatedAmount}</span>
      </div>
    </li>)}
    {valid.length !== estimates.length ? <li className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.costUnknown`)}</li> : null}
  </ul>;
}

function currentWork(ai: SystemEntryAIState | null, locale: string) {
  const read = ai?.activity;
  if (read?.status !== 'ready' || !read.value) return null;
  const snapshot = read.value;
  const groups = groupWork(snapshot.executions);
  const sourceComplete = snapshot.sourceCoverage.length > 0 && snapshot.sourceCoverage.every(source => source.activityComplete);
  const reportedCount = count(snapshot.knownWorkCount, locale);
  const workCount = snapshot.workCountKnown && sourceComplete && reportedCount !== null
    && BigInt(snapshot.knownWorkCount) >= BigInt(groups.length) ? reportedCount : null;
  const complete = sourceComplete && snapshot.recordsComplete && workCount !== null && snapshot.partialReasons.length === 0;
  return { snapshot, groups, workCount, complete };
}

function CurrentWorkSummary({ ai }: { ai: SystemEntryAIState | null }) {
  const { t, i18n } = useTranslation();
  const work = currentWork(ai, i18n.resolvedLanguage ?? 'en');
  return <div className={PANEL_CLASS} data-testid="home-current-work-summary">
    <dt className="flex items-center gap-2 text-sm font-medium text-[var(--nimi-text-secondary)]"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Activity size={17} aria-hidden="true" /></span>{t(`${PREFIX}.workTitle`)}</dt>
    <dd className="mt-4 break-words text-[40px] font-semibold leading-tight tracking-[-0.035em] tabular-nums" aria-label={work?.workCount == null ? undefined : t(`${PREFIX}.workCount`, { value: work.workCount })}>
      {work?.workCount ?? t(`${PREFIX}.unknown`)}{work?.workCount != null ? <span className="ml-2 text-sm font-normal tracking-normal text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.workUnit`)}</span> : null}
    </dd>
    <dd className="mt-2 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${!ai || ai.activity.status === 'loading' ? 'workLoading' : work?.workCount == null ? 'workCountUnknown' : 'currentActivity'}`)}</dd>
  </div>;
}

function CurrentWorkReading({ ai }: { ai: SystemEntryAIState | null }) {
  const { t, i18n } = useTranslation();
  const work = currentWork(ai, i18n.resolvedLanguage ?? 'en');
  return <section aria-labelledby="home-activity-title" className={PANEL_CLASS} data-testid="home-current-work-reading">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="home-activity-title" className="text-base font-semibold">{t(`${PREFIX}.currentActivity`)}</h2>
      {work ? <p className="text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.lastObserved`)} <RecordedTime value={work.snapshot.observedAt} timeZone={ai?.range.timeZone} /></p> : null}
    </div>
    {!ai || ai.activity.status === 'loading' ? <div className="mt-4"><LoadingSkeleton lines={2} label={t(`${PREFIX}.workLoading`)} /></div>
      : !work ? <div className="mt-4"><InlineAlert tone="warning">{t(`${PREFIX}.workUnavailable`)}</InlineAlert></div>
      : <>
        {!work.complete ? <UsageNotice testId="home-work-warning"><p>{t(`${PREFIX}.workPartial`, { count: work.groups.length })}</p></UsageNotice> : null}
        {!work.groups.length ? <p className="py-5 text-sm text-[var(--nimi-text-secondary)]" role="status">{t(`${PREFIX}.${work.complete ? 'workEmpty' : 'workEmptyPartial'}`)}</p>
          : <div className="mt-2 divide-y divide-[var(--nimi-border-subtle)]">
            {work.groups.map(([key, executions]) => {
              const first = executions[0]!;
              const unknown = executions.some(execution => execution.state !== DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING);
              return <article key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-4 md:grid-cols-[minmax(10rem,0.65fr)_minmax(0,2fr)_auto]" data-testid="home-current-work-row">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Layers3 size={17} aria-hidden="true" /></span>
                  <div className="min-w-0 pt-2"><h3 className="break-words text-sm font-semibold">{first.sourceLabel || t(`${PREFIX}.executionSource`)}</h3>
                    {!first.parentWorkId || !first.parentWorkKind ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.unassociated`)}</p> : null}</div>
                </div>
                <span className={`justify-self-end rounded-full px-2.5 py-1 text-xs font-medium md:col-start-3 ${unknown ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' : 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]'}`}>{t(`${PREFIX}.${unknown ? 'stateUnknown' : 'running'}`)}</span>
                <ul className="col-span-2 min-w-0 space-y-3 md:col-span-1 md:col-start-2 md:row-start-1">
                  {executions.map(execution => <li key={execution.attemptId} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
                    <div className="min-w-0"><ModelList models={execution.models} /><p className="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--nimi-text-secondary)]"><span>{displayRuntimeConfigCapabilityLabel(execution.capability, t)}</span><span aria-hidden="true">·</span><RouteLabel route={execution.route} /></p></div>
                    <div className="text-xs leading-5 text-[var(--nimi-text-secondary)]"><p>{t(`${PREFIX}.startedAt`)} <RecordedTime value={execution.startedAt} timeZone={ai?.range.timeZone} /></p>
                      {execution.state !== DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING ? <p>{t(`${PREFIX}.lastObserved`)} <RecordedTime value={execution.observedAt} timeZone={ai?.range.timeZone} /></p> : null}</div>
                  </li>)}
                </ul>
                {unknown ? <p className="col-span-2 text-sm leading-6 text-[var(--nimi-text-secondary)] md:col-span-3">{t(`${PREFIX}.observationUnknown`)}</p> : null}
              </article>;
            })}
          </div>}
        {work.groups.length ? <p className="border-t border-[var(--nimi-border-subtle)] pt-3 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.workReadOnly`)}</p> : null}
      </>}
  </section>;
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
  return <p className="mt-2 flex flex-wrap gap-x-2 text-xs leading-5 text-[var(--nimi-text-secondary)]" data-testid="home-usage-route-summary">
    <span>{t(`${PREFIX}.local`)} {display(localAttempts)}</span><span aria-hidden="true">·</span><span>{t(`${PREFIX}.cloud`)} {display(cloudAttempts)}</span>
    {showUnknown ? <><span aria-hidden="true">·</span><span>{t(`${PREFIX}.routeUnknown`)} {display(String(unknown))}</span></> : null}
  </p>;
}

type UsageRouteFilter = 'all' | 'local' | 'cloud';

function UsageNotice({ children, testId }: { children: ReactNode; testId: string }) {
  return <div role="status" data-testid={testId} className="mt-4 flex items-start gap-2 rounded-2xl border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] p-3 text-sm leading-6 text-[var(--nimi-status-warning-soft-text)]">
    <Info size={15} className="mt-1 shrink-0" aria-hidden="true" /><div className="min-w-0 space-y-1">{children}</div>
  </div>;
}

function UsageInfo({ children, label, testId }: { children: ReactNode; label: string; testId: string }) {
  return <Tooltip content={<div className="space-y-2">{children}</div>} contentClassName="max-w-xs text-left font-normal">
    <IconButton size="sm" className="size-6 shrink-0 text-[var(--nimi-text-secondary)]" aria-label={label} data-testid={testId}
      icon={<Info size={15} aria-hidden="true" />} />
  </Tooltip>;
}

function UsageGroups({ groups, attempts, groupsComplete }: { groups: readonly DesktopAIUsageGroup[]; attempts: string | null; groupsComplete: boolean }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState<UsageRouteFilter>('all');
  const locale = i18n.resolvedLanguage ?? 'en';
  const display = (value: string | undefined) => count(value, locale) ?? t(`${PREFIX}.unknown`);
  if (!groups.length) return <>
    {!groupsComplete ? <UsageNotice testId="home-usage-details-warning"><p>{t(`${PREFIX}.detailsIncomplete`)}</p></UsageNotice> : null}
    <p className="py-6 text-center text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${groupsComplete && attempts === '0' ? 'usageEmpty' : 'groupsUnavailable'}`)}</p>
  </>;
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
  return <>
      {groups.length > 5 || filtered ? <p className="mt-3 inline-block rounded-full bg-[var(--nimi-surface-panel)] px-2.5 py-1 text-xs text-[var(--nimi-text-secondary)] tabular-nums" role="status">
        {t(filtered ? `${PREFIX}.filteredResults` : `${PREFIX}.groupCount`, filtered ? { shown: visible.length, total: groups.length } : { count: groups.length })}
      </p> : null}
    {!groupsComplete ? <UsageNotice testId="home-usage-details-warning"><p>{t(`${PREFIX}.detailsIncomplete`)}</p></UsageNotice> : null}
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
    {visible.length ? <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--nimi-border-subtle)]" tabIndex={0} role="region" aria-labelledby="home-usage-detail-title">
      <table id="home-usage-group-list" className="w-full min-w-[620px] table-fixed text-left text-sm">
        <thead className="bg-[var(--nimi-surface-panel)] text-xs text-[var(--nimi-text-secondary)]"><tr>
          <th scope="col" className="w-[34%] px-4 py-3 font-medium">{t(`${PREFIX}.modelColumn`)}</th>
          <th scope="col" className="w-[17%] px-3 py-3 font-medium">{t(`${PREFIX}.sourceColumn`)}</th>
          <th scope="col" className="w-[12%] px-3 py-3 font-medium">{t(`${PREFIX}.routeColumn`)}</th>
          <th scope="col" className="w-[15%] px-3 py-3 text-right font-medium">{t(`${PREFIX}.recordedAttemptsShort`)}</th>
          <th scope="col" className="w-[22%] px-4 py-3 text-right font-medium">{t(`${PREFIX}.estimatedCosts`)}</th>
        </tr></thead>
        <tbody className="divide-y divide-[var(--nimi-border-subtle)]">{visible.map(({ group, index }) => <tr key={`${group.sourceKind}:${group.capability}:${index}`} data-testid="home-usage-group">
          <td className="px-4 py-3"><ModelList models={group.models} /><p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{displayRuntimeConfigCapabilityLabel(group.capability, t)}</p></td>
          <td className="break-words px-3 py-3 text-xs text-[var(--nimi-text-secondary)]">{SOURCE_KEYS[group.sourceKind] ? t(`${PREFIX}.sources.${SOURCE_KEYS[group.sourceKind]}`) : group.sourceKind}</td>
          <td className="px-3 py-3"><RouteLabel route={group.route} /></td>
          <td className="break-words px-3 py-3 text-right font-medium tabular-nums">{display(group.totals?.attemptCount)}</td>
          <td className="px-4 py-3"><Estimates estimates={group.estimates} local={group.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL} /></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="mt-5 rounded-2xl bg-[var(--nimi-surface-panel)] py-10 text-center" role="status">
      <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.noMatchingGroups`)}</p>
      <Button tone="ghost" size="sm" className="mt-2" onClick={clearFilters}>{t(`${PREFIX}.clearFilters`)}</Button>
    </div>}
  </>;
}

function UsageDataDetails({ ai }: { ai: SystemEntryAIState | null }) {
  const { t } = useTranslation();
  const pricingBases = ai?.usage.status === 'ready' ? [...new Set(ai.usage.value?.estimates.map(estimate => estimate.pricingBasis).filter(Boolean))] : [];
  return <details className="group rounded-[20px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-1 sm:px-5" data-testid="home-usage-data-details">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 flex-wrap items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]"><Info size={15} aria-hidden="true" /></span>
        <span>{t(`${PREFIX}.usageExplanation`)}</span></span>
      <ChevronDown size={16} className="shrink-0 text-[var(--nimi-text-secondary)] transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="space-y-5 border-t border-[var(--nimi-border-subtle)] py-5">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl bg-[var(--nimi-surface-panel)] p-4"><h3 className="text-sm font-medium">{t(`${PREFIX}.recordedAttempts`)}</h3><p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.workDefinition`)} {t(`${PREFIX}.attemptDefinition`)}</p></section>
        <section className="rounded-2xl bg-[var(--nimi-surface-panel)] p-4"><h3 className="text-sm font-medium">{t(`${PREFIX}.estimatedCosts`)}</h3><p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimateDisclaimer`)}</p>
          {pricingBases.map(basis => <p key={basis} className="mt-2 text-xs leading-5 text-[var(--nimi-text-secondary)]">{basis === 'captured_catalog_estimate' ? t(`${PREFIX}.capturedPricing`) : t(`${PREFIX}.pricingBasis`, { value: basis })}</p>)}
        </section>
      </div>
    </div>
  </details>;
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-coverage
// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-usage-summary
function UsageSummary({ ai }: { ai: SystemEntryAIState | null }) {
  const { t, i18n } = useTranslation();
  const read = ai?.usage;
  if (!ai || !read || read.status === 'loading') return <UnavailableUsageSummary loading />;
  if (read.status !== 'ready' || !read.value?.totals) return <UnavailableUsageSummary />;
  const summary = read.value;
  const locale = i18n.resolvedLanguage ?? 'en';
  const projection = projectSystemEntryUsage(read, ai.range, locale.startsWith('zh') ? 'zh' : 'en');
  if (projection.status === 'unavailable') return <UnavailableUsageSummary />;
  const localOnly = isSystemEntryLocalOnlyUsage(projection);
  const display = (value: string | undefined | null) => count(value ?? undefined, locale) ?? t(`${PREFIX}.unknown`);
  const pending = hasPositiveCount(summary.totals?.pendingUsageCount);
  const unpriced = hasPositiveCount(summary.totals?.unpricedAttemptCount);
  const uncoveredSources = summary.sourceCoverage.filter(source => !source.usageComplete);
  const sourceIncomplete = !summary.sourceComplete || !summary.sourceCoverage.length || uncoveredSources.length > 0;
  const recordsIncomplete = sourceIncomplete || !summary.timeComplete;
  const quantitiesIncomplete = !localOnly && (!summary.quantityComplete || pending);
  const pricingIncomplete = projection.costs.length !== summary.estimates.length;
  const unexplainedCoverage = summary.partialReasons.some(reason => !localOnly || reason !== 'usage_pending') && !recordsIncomplete && !quantitiesIncomplete && !unpriced;
  const costIncomplete = recordsIncomplete || quantitiesIncomplete || unpriced || pricingIncomplete || unexplainedCoverage;
  return <>
        <div className={PANEL_CLASS} data-testid="home-usage-attempts-card">
          <dt className="flex items-center gap-2.5 text-sm font-medium text-[var(--nimi-text-secondary)]"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Play size={17} aria-hidden="true" /></span>{t(`${PREFIX}.todayExecutions`)}
          {recordsIncomplete || unexplainedCoverage ? <UsageInfo testId="home-usage-count-warning" label={t(`${PREFIX}.${recordsIncomplete ? 'attemptsIncomplete' : 'attemptsUnconfirmed'}`)}>
            <p>{t(`${PREFIX}.${recordsIncomplete ? 'attemptsIncomplete' : 'attemptsUnconfirmed'}`)}</p>
            {uncoveredSources.length ? <p className="text-xs">{t(`${PREFIX}.uncoveredUsageSources`, { sources: uncoveredSources.map(source => SOURCE_KEYS[source.source] ? t(`${PREFIX}.sources.${SOURCE_KEYS[source.source]}`) : source.source).join(' · ') })}</p> : null}
            {!summary.timeComplete && systemEntryTimestampIso(summary.coverageFrom) && systemEntryTimestampIso(summary.coverageTo) ? <p className="text-xs">{t(`${PREFIX}.recordedBounds`)} <RecordedTime value={summary.coverageFrom} timeZone={ai.range.timeZone} /> — <RecordedTime value={summary.coverageTo} timeZone={ai.range.timeZone} /></p> : null}
          </UsageInfo> : null}</dt>
          <dd className="mt-4 break-words text-[40px] font-semibold leading-tight tracking-[-0.035em] tabular-nums">{display(projection.attempts)}<span className="ml-2 text-sm font-normal tracking-normal text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.executionUnit`)}</span></dd>
          <dd><UsageRouteSummary attempts={projection.attempts} localAttempts={projection.localAttempts} cloudAttempts={projection.cloudAttempts} /></dd>
        </div>
        <div className={PANEL_CLASS} data-testid="home-usage-cost-card">
          <dt className="flex items-center gap-2.5 text-sm font-medium text-[var(--nimi-text-secondary)]"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]"><Coins size={17} aria-hidden="true" /></span>{t(`${PREFIX}.estimatedCosts`)}
          {costIncomplete ? <UsageInfo testId="home-usage-cost-warning" label={t(`${PREFIX}.costsIncomplete`)}>
            <p className="font-medium">{t(`${PREFIX}.costsIncomplete`)}</p>
            {recordsIncomplete ? <p>{t(`${PREFIX}.costsMissingRecords`)}</p> : null}
            {pending && quantitiesIncomplete ? <p>{t(`${PREFIX}.costsPendingUsage`, { value: display(summary.totals?.pendingUsageCount) })}</p> : null}
            {!pending && quantitiesIncomplete ? <p>{t(`${PREFIX}.costsMissingQuantities`)}</p> : null}
            {unpriced ? <p>{t(`${PREFIX}.costsUnpriced`, { value: display(summary.totals?.unpricedAttemptCount) })}</p> : null}
            {pricingIncomplete || unexplainedCoverage ? <p>{t(`${PREFIX}.costsUnconfirmed`)}</p> : null}
            <p className="text-xs">{t(`${PREFIX}.missingCostsNotZero`)}</p>
          </UsageInfo> : null}</dt>
          <dd className="mt-4"><Estimates estimates={summary.estimates} local={localOnly} emphasis /></dd>
          {summary.estimates.length ? <dd className="mt-2 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.estimateShortDisclaimer`)}</dd> : null}
          {projection.costs.length > 1 ? <dd className="mt-2 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.separateCurrencies`)}</dd> : null}
        </div>
  </>;
}

function UnavailableUsageSummary({ loading = false }: { loading?: boolean }) {
  const { t } = useTranslation();
  return <>{(['todayExecutions', 'estimatedCosts'] as const).map(key => <div key={key} className={PANEL_CLASS}>
    <dt className="text-sm font-medium text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${key}`)}</dt>
    <dd className="mt-4 text-sm leading-6 text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.${loading ? 'usageLoading' : 'unknown'}`)}</dd>
  </div>)}</>;
}

function UsageBreakdown({ ai }: { ai: SystemEntryAIState | null }) {
  const { t, i18n } = useTranslation();
  const read = ai?.usage;
  const projection = ai && read?.status === 'ready' ? projectSystemEntryUsage(read, ai.range, (i18n.resolvedLanguage ?? 'en').startsWith('zh') ? 'zh' : 'en') : null;
  const summary = projection && projection.status !== 'unavailable' ? read?.value : null;
  return <section aria-labelledby="home-usage-detail-title" className={PANEL_CLASS} data-testid="home-ai-usage-reading">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 id="home-usage-detail-title" className="text-base font-semibold">{t(`${PREFIX}.usageDetails`)}</h2>
        {ai ? <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]"><CalendarDays size={13} aria-hidden="true" />{ai.range.date} · {ai.range.timeZone}</p> : null}</div>
      {summary ? <p className="text-xs text-[var(--nimi-text-secondary)]">{t(`${PREFIX}.readAt`)} <RecordedTime value={summary.readAt} timeZone={ai?.range.timeZone} /></p> : null}
    </div>
    {!read || read.status === 'loading' ? <div className="mt-4"><LoadingSkeleton lines={2} label={t(`${PREFIX}.usageLoading`)} /></div>
      : !summary || !projection ? <div className="mt-4"><InlineAlert tone="warning">{t(`${PREFIX}.usageUnavailable`)}</InlineAlert></div>
      : <UsageGroups groups={summary.groups} attempts={projection.attempts} groupsComplete={summary.groupsComplete && projection.localAttempts !== null && projection.cloudAttempts !== null} />}
  </section>;
}

export function SystemEntryDetailsView({ ai, onBack, onRefresh, refreshing = false, refreshError = false }: {
  ai: SystemEntryAIState | null;
  onBack(): void;
  onRefresh(): void;
  refreshing?: boolean;
  refreshError?: boolean;
}) {
  const { t } = useTranslation();
  return <div className="flex min-h-0 flex-1 flex-col p-3"><ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent [&>div]:!block" contentClassName={`${SHELL_PAGE_WIDTH_CLASS} pb-8 pt-5`}>
    <div className="mx-auto w-full max-w-[1120px] space-y-5">
      <header className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button tone="ghost" size="sm" className="-ml-2" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t('runtimeConfig.overview.back')}</Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-[28px] font-semibold tracking-[-0.035em]">{t(`${PREFIX}.activityUsageTitle`)}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-[var(--nimi-text-secondary)]"><span>{t(`${PREFIX}.scope`)}</span></p></div>
          <Button tone="secondary" size="sm" className="rounded-full px-4" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" />{t(refreshing ? 'Common.loading' : 'runtimeConfig.overview.refresh')}</Button>
        </div>
      </header>
      {refreshError ? <InlineAlert tone="warning">{t(`${PREFIX}.refreshFailed`)}</InlineAlert> : null}
      <dl className="grid gap-4 md:grid-cols-3" data-testid="home-usage-summary"><CurrentWorkSummary ai={ai} /><UsageSummary ai={ai} /></dl>
      <CurrentWorkReading ai={ai} />
      <UsageBreakdown ai={ai} />
      <UsageDataDetails ai={ai} />
    </div>
  </ScrollArea></div>;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
export function SystemEntryDetails(props: { onBack(): void }) {
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
