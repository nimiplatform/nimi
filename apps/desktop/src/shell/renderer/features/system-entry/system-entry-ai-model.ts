import { DesktopAIExecutionRoute, DesktopAIExecutionState, type DesktopAIActivitySnapshot, type DesktopAIExecution, type DesktopAIUsageSummary } from '@nimiplatform/sdk/runtime/generated';
import type { SystemEntryLocale, SystemEntrySection, SystemEntryUsage } from '../../../shared/system-entry-types.js';
import { systemEntryTimestampIso, type SystemEntryDayRange } from './system-entry-time.js';

export type SystemEntryRead<T> = Readonly<{ status: 'loading' | 'ready' | 'unavailable'; value: T | null; error: string | null }>;
export type SystemEntryAIState = Readonly<{
  activity: SystemEntryRead<DesktopAIActivitySnapshot>;
  usage: SystemEntryRead<DesktopAIUsageSummary>;
  range: SystemEntryDayRange;
}>;

export function projectSystemEntryWork(read: SystemEntryRead<DesktopAIActivitySnapshot>, locale: SystemEntryLocale): SystemEntrySection {
  const value = read.value;
  if (read.status !== 'ready' || !value) return { status: read.status === 'loading' ? 'loading' : 'unavailable', observedAt: null, total: null, items: [] };
  const groups = new Map<string, DesktopAIExecution[]>();
  for (const execution of value.executions) {
    const key = execution.parentWorkId && execution.parentWorkKind
      ? `work:${execution.parentWorkKind}:${execution.parentWorkId}` : `attempt:${execution.attemptId}`;
    const group = groups.get(key) ?? [];
    group.push(execution);
    groups.set(key, group);
  }
  const partial = !value.recordsComplete || !value.workCountKnown || value.partialReasons.length > 0
    || !value.sourceCoverage.length || value.sourceCoverage.some((source) => !source.activityComplete);
  const known = decimalCount(value.knownWorkCount);
  const total = value.workCountKnown && known !== null && BigInt(known) <= BigInt(Number.MAX_SAFE_INTEGER)
    && Number(known) >= groups.size ? Number(known) : null;
  return {
    status: partial ? 'partial' : 'available', observedAt: systemEntryTimestampIso(value.observedAt), total,
    items: [...groups.entries()].slice(0, 20).map(([id, executions]) => {
      const first = executions[0]!;
      const models = new Map<string, string>();
      for (const execution of executions) for (const model of execution.models) {
        models.set(`${model.providerId}\u0000${model.modelId}\u0000${model.role}`, model.displayName || model.modelId);
      }
      const routes = new Set(executions.map((execution) => execution.route));
      const route = routes.size !== 1 ? (locale === 'zh' ? '多个执行来源' : 'Multiple execution routes')
        : routes.has(DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL) ? (locale === 'zh' ? '本地' : 'Local')
          : routes.has(DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD) ? (locale === 'zh' ? '云端' : 'Cloud')
            : (locale === 'zh' ? '执行来源未知' : 'Route unknown');
      const state = executions.some((execution) => execution.state !== DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING)
        ? (locale === 'zh' ? '状态待确认' : 'Awaiting current status')
        : (locale === 'zh' ? '执行中' : 'Running');
      const modelText = [...models.values()].join(' · ') || (locale === 'zh' ? '等待采用模型' : 'Waiting for model adoption');
      const title = first.sourceLabel || (locale === 'zh' ? 'AI 执行' : 'AI execution');
      const unassociated = !first.parentWorkId || !first.parentWorkKind;
      return { id: id.slice(0, 512), title: title.slice(0, 256),
        detail: `${state} · ${route} · ${modelText}${unassociated ? (locale === 'zh' ? ' · 未关联工作' : ' · Unassociated work') : ''}`.slice(0, 512),
        action: { kind: 'activity' as const } };
    }),
  };
}

export function projectSystemEntryUsage(read: SystemEntryRead<DesktopAIUsageSummary>, range: SystemEntryDayRange, locale: SystemEntryLocale): SystemEntryUsage {
  const periodLabel = `${range.date} · ${range.timeZone}`;
  const empty: SystemEntryUsage = { status: read.status === 'loading' ? 'loading' : 'unavailable', observedAt: null,
    periodLabel, attempts: null, localAttempts: null, cloudAttempts: null, costs: [], partial: true,
    note: locale === 'zh' ? '当前账户 · 此设备；用量暂时无法确认' : 'Current account · this device; usage unavailable' };
  const summary = read.value;
  if (read.status !== 'ready' || !summary?.totals) return empty;
  const attempts = decimalCount(summary.totals.attemptCount);
  if (attempts === null) return empty;
  let local = 0n, cloud = 0n, unknown = 0n;
  let groupsValid = summary.groupsComplete;
  for (const group of summary.groups) {
    const count = decimalCount(group.totals?.attemptCount);
    if (count === null) { groupsValid = false; continue; }
    if (group.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL) local += BigInt(count);
    else if (group.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD) cloud += BigInt(count);
    else unknown += BigInt(count);
  }
  if (local + cloud + unknown !== BigInt(attempts)) groupsValid = false;
  const costs: Array<{ currency: string; estimate: string }> = [];
  const currencies = new Set<string>();
  let invalidCost = false;
  for (const estimate of summary.estimates) {
    if (!/^[A-Z]{3,8}$/u.test(estimate.currency) || !/^\d+(\.\d+)?$/u.test(estimate.estimatedAmount)
      || estimate.estimatedAmount.length > 40 || currencies.has(estimate.currency)) { invalidCost = true; continue; }
    currencies.add(estimate.currency);
    costs.push({ currency: estimate.currency, estimate: estimate.estimatedAmount });
  }
  const partial = !summary.sourceComplete || !summary.timeComplete || !summary.quantityComplete
    || !groupsValid || summary.partialReasons.length > 0 || invalidCost;
  const notes = [locale === 'zh' ? '当前账户 · 此设备' : 'Current account · this device'];
  if (!summary.sourceComplete) notes.push(locale === 'zh' ? '部分执行来源尚未覆盖' : 'Some execution sources are not covered');
  if (!summary.timeComplete) {
    const began = systemEntryTimestampIso(summary.coverageFrom);
    notes.push(locale === 'zh' ? '当天记录不完整' : 'Day coverage is incomplete');
    if (began) notes.push((locale === 'zh' ? '记录始于 ' : 'Recorded since ') + new Intl.DateTimeFormat(locale, { timeZone: range.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(began)));
  }
  if (BigInt(decimalCount(summary.totals.pendingUsageCount) ?? '0') > 0n) notes.push(locale === 'zh' ? '部分用量待返回' : 'Some usage is pending');
  else if (!summary.quantityComplete) notes.push(locale === 'zh' ? '部分计费用量缺失' : 'Some billing quantities are missing');
  if (BigInt(decimalCount(summary.totals.unpricedAttemptCount) ?? '0') > 0n || invalidCost) notes.push(locale === 'zh' ? '部分费用无法估算' : 'Some costs cannot be estimated');
  if (unknown > 0n) notes.push(locale === 'zh' ? '含来源未确认的执行' : 'Includes executions with an unknown route');
  if (costs.length) notes.push(locale === 'zh' ? '费用为估算值' : 'Costs are estimates');
  return { status: partial ? 'partial' : 'available', observedAt: systemEntryTimestampIso(summary.readAt), periodLabel,
    attempts, localAttempts: groupsValid ? String(local) : null, cloudAttempts: groupsValid ? String(cloud) : null,
    costs: costs.slice(0, 8), partial: partial || costs.length > 8, note: notes.join(' · ').slice(0, 512) };
}

function decimalCount(value: string | undefined): string | null {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value) ? value : null;
}
