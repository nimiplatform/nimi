import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, InlineAlert, StatusBadge, Surface, cn } from '@nimiplatform/nimi-kit/ui';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import {
  deleteCustomTodo,
  getCustomTodos,
  getReminderStates,
  uncompleteCustomTodo,
  type CustomTodoRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import {
  buildReminderAgenda,
  getLocalToday,
  mapReminderStateRow,
  UnknownReminderRuleError,
  type ActiveReminder,
  type ReminderHistoryItem,
  type ReminderState,
} from '../../engine/reminder-engine.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { FrequencyModal } from './frequency-modal.js';
import { ReminderExplainDrawer } from './reminder-explain-drawer.js';
import {
  applyReminderAction,
  canMarkNotApplicable,
  defaultSnoozeUntil,
  persistAgendaPlan,
} from '../../engine/reminder-actions.js';
import type { ReminderActionType } from '../../engine/reminder-actions.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import { HealthCaptureModal } from '../profile/health-capture-modal.js';
import type { HealthCaptureIntent } from '../profile/health-capture-orchestrator.js';
import {
  buildRecordDataCaptureIntent,
  canDirectlyCompleteReminder,
  isRecordDataReminder,
} from './record-data-capture.js';

const textPrimaryClass = 'text-[var(--nimi-text-primary)]';
const textMutedClass = 'text-[var(--nimi-text-muted)]';

const DOMAIN_LABELS: Record<string, string> = {
  vaccine: '疫苗', growth: '生长', vision: '视力', dental: '口腔', sleep: '睡眠',
  'bone-age': '骨龄', checkup: '体检', nutrition: '营养', safety: '安全', language: '语言', motor: '运动',
};

function useReminderStates(childId: string | null) {
  const [states, setStates] = useState<ReminderState[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!childId) { setStates([]); setLoading(false); return; }
    setLoading(true);
    try { const rows = await getReminderStates(childId); setStates(rows.map(mapReminderStateRow)); } catch { setStates([]); }
    setLoading(false);
  }, [childId]);
  useEffect(() => { void load(); }, [load]);
  return { states, loading, reload: load };
}

function useCustomTodos(childId: string | null) {
  const [todos, setTodos] = useState<CustomTodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!childId) { setTodos([]); setLoading(false); return; }
    setLoading(true);
    try { const rows = await getCustomTodos(childId); setTodos(rows); } catch { setTodos([]); }
    setLoading(false);
  }, [childId]);
  useEffect(() => { void load(); }, [load]);
  return { todos, loading, reload: load };
}

type ReminderPrimaryAction =
  | { label: string; to: string; kind?: 'link' }
  | { label: string; kind: 'capture' };

function primaryAction(reminder: ActiveReminder): ReminderPrimaryAction {
  // W5 will replace these Link primaries with drawer-driven actions per PO-REMI-011.
  // For W4a we only normalize the kind dispatch to the new 4-kind taxonomy.
  if (reminder.kind === 'guide' || reminder.kind === 'practice') {
    return { label: '打开笔记', to: `/journal?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}` };
  }
  if (reminder.kind === 'consult') {
    return { label: '问问 AI 顾问', to: `/advisor?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}` };
  }
  if (reminder.rule.domain === 'vaccine') return { label: '记录疫苗', to: '/profile' };
  if (isRecordDataReminder(reminder)) return { label: '记录数据', kind: 'capture' };
  if (reminder.rule.domain === 'growth') return { label: '记录数据', to: '/profile' };
  return { label: reminder.rule.actionType === 'go_hospital' ? '查看详情' : '查看档案', to: '/profile' };
}

function statusLabel(reminder: ActiveReminder) {
  switch (reminder.lifecycle) {
    case 'completed': return '已完成';
    case 'scheduled': return reminder.state?.scheduledDate ? `已安排 ${reminder.state.scheduledDate}` : '已安排';
    case 'snoozed': return reminder.state?.snoozedUntil ? `已推迟至 ${reminder.state.snoozedUntil}` : '已推迟';
    case 'overdue': return reminder.overdueDays > 0 ? `逾期${reminder.overdueDays}天` : '已逾期';
    case 'due': return '今天到期';
    default: return reminder.daysUntilStart > 0 ? `${reminder.daysUntilStart}天后开始` : '本周';
  }
}

function historyLabel(item: ReminderHistoryItem) {
  switch (item.historyType) {
    case 'completed': return '已完成';
    case 'scheduled': return item.state?.scheduledDate ? `已安排 ${item.state.scheduledDate}` : '已安排';
    case 'snoozed': return item.state?.snoozedUntil ? `已推迟至 ${item.state.snoozedUntil}` : '已推迟';
    case 'not_applicable': return '不适用';
  }
}

function formatDateLabel(value: string | null) {
  if (!value) return null;
  return value.slice(0, 10);
}

/* ── Glass summary tile ── */

type SummaryTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

function SummaryTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: SummaryTone }) {
  return (
    <Surface material="glass-thin" tone="card" padding="none" className="rounded-2xl p-5">
      <StatusBadge tone={tone} shape="dot">{label}</StatusBadge>
      <p className={cn('mt-3 text-[24px] font-semibold leading-none tracking-tight', textPrimaryClass)}>{value}</p>
      <p className={cn('mt-2 text-[13px] leading-relaxed', textMutedClass)}>{hint}</p>
    </Surface>
  );
}

/* ── Glass section card ── */

function SectionCard({ title, hint, count, children, collapsible = false, defaultCollapsed = false }: {
  title: string; hint: string; count?: number; children: ReactNode; collapsible?: boolean; defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <Surface as="section" material="glass-regular" padding="none" tone="card" className="rounded-3xl p-7 transition-transform hover:-translate-y-0.5">
      <div className="flex items-end justify-between gap-3 mb-5">
        <div>
          <h2 className={cn('text-[16px] font-semibold tracking-tight', textPrimaryClass)}>{title}</h2>
          <p className={cn('mt-1 text-[13px] leading-relaxed', textMutedClass)}>{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof count === 'number' && (
            <StatusBadge tone="neutral" className="shrink-0">{count} 项</StatusBadge>
          )}
          {collapsible && (
            <Button type="button" tone="ghost" size="sm" onClick={() => setCollapsed((v) => !v)} className="gap-1 px-2.5 py-1 text-[12px]">
              <span>{collapsed ? '展开' : '收起'}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={cn('transition-transform duration-200', collapsed ? 'rotate-0' : 'rotate-180')}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </Button>
          )}
        </div>
      </div>
      {!collapsible || !collapsed ? children : null}
    </Surface>
  );
}

/* ── Today hero ── */

function TodayHero({
  reminder,
  onComplete,
  onOpenCapture,
}: {
  reminder: ActiveReminder | null;
  onComplete: (r: ActiveReminder) => void;
  onOpenCapture: (r: ActiveReminder) => void;
}) {
  if (!reminder) {
    return (
      <Surface material="glass-thin" tone="card" padding="none" className="rounded-2xl p-6">
        <StatusBadge tone="success" shape="dot">今日</StatusBadge>
        <h2 className={cn('mt-3 text-[24px] font-semibold tracking-tight', textPrimaryClass)}>今天没有待办</h2>
        <p className={cn('mt-2 text-[14px] leading-relaxed', textMutedClass)}>当前没有需要立即处理的事项。</p>
      </Surface>
    );
  }
  const primary = primaryAction(reminder);
  const canComplete = canDirectlyCompleteReminder(reminder);
  return (
    <Surface material="glass-thin" tone="card" padding="none" className="rounded-2xl p-6">
      <StatusBadge tone="success" shape="dot">今日</StatusBadge>
      <h2 className={cn('mt-3 text-[24px] font-semibold tracking-tight', textPrimaryClass)}>{reminder.rule.title}</h2>
      <p className={cn('mt-2 text-[14px] leading-relaxed', textMutedClass)}>{statusLabel(reminder)}</p>
      <div className="flex flex-wrap items-center gap-2 mt-5">
        {primary.kind === 'capture' ? (
          <Button type="button" tone="primary" size="md" onClick={() => onOpenCapture(reminder)}>
            {primary.label}
          </Button>
        ) : (
          <Button asChild tone="primary" size="md">
            <Link to={primary.to}>{primary.label}</Link>
          </Button>
        )}
        {canComplete && (
          <Button type="button" tone="secondary" size="md" onClick={() => onComplete(reminder)}>标记完成</Button>
        )}
      </div>
    </Surface>
  );
}

/* ── Reminder row ── */

function ReminderRow({ reminder, onOpenDetail, onComplete, onSnooze, onSchedule, onNotApplicable, onAdjustFrequency, onOpenCapture }: {
  reminder: ActiveReminder;
  onOpenDetail: (r: ActiveReminder) => void;
  onComplete: (r: ActiveReminder) => void;
  onSnooze: (r: ActiveReminder) => void;
  onSchedule: (r: ActiveReminder) => void;
  onNotApplicable: (r: ActiveReminder) => void;
  onAdjustFrequency: (r: ActiveReminder) => void;
  onOpenCapture: (r: ActiveReminder) => void;
}) {
  const primary = primaryAction(reminder);
  const domain = DOMAIN_LABELS[reminder.rule.domain] ?? reminder.rule.domain;
  const isOverdue = reminder.lifecycle === 'overdue';
  // For non-task kinds, trim the inline description; the drawer owns the full
  // explain rendering (whyNow / howTo / doneWhen / sources) per PO-REMI-011.
  const shortDescription = reminder.kind === 'task'
    ? reminder.rule.description
    : reminder.rule.explain?.whyNow ?? reminder.rule.description;
  const completeLabel = reminder.kind === 'task' ? '完成' : '我已了解';
  const canComplete = canDirectlyCompleteReminder(reminder);

  return (
    <Surface material="glass-thin" tone="card" padding="none" className="rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge tone={isOverdue ? 'danger' : 'info'}>{domain}</StatusBadge>
            <span className={cn('text-[12px]', textMutedClass)}>{statusLabel(reminder)}</span>
          </div>
          <p className={cn('text-[16px] font-semibold', textPrimaryClass)}>{reminder.rule.title}</p>
          <p className={cn('mt-2 text-[14px] leading-relaxed', textMutedClass)}>{shortDescription}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <Button type="button" tone="primary" size="sm" onClick={() => onOpenDetail(reminder)}>
          查看详情
        </Button>
        {primary.kind === 'capture' ? (
          <Button type="button" tone="secondary" size="sm" onClick={() => onOpenCapture(reminder)}>
            {primary.label}
          </Button>
        ) : (
          <Button asChild tone="secondary" size="sm">
            <Link to={primary.to}>{primary.label}</Link>
          </Button>
        )}
        {canComplete && (
          <Button type="button" tone="secondary" size="sm" onClick={() => onComplete(reminder)}>{completeLabel}</Button>
        )}
        <Button type="button" tone="ghost" size="sm" onClick={() => onSnooze(reminder)}>推迟</Button>
        {reminder.kind === 'task' && (
          <Button type="button" tone="ghost" size="sm" onClick={() => onSchedule(reminder)}>安排</Button>
        )}
        {canMarkNotApplicable(reminder) && (
          <Button type="button" tone="danger" size="sm" onClick={() => onNotApplicable(reminder)}>不适用</Button>
        )}
        {reminder.rule.repeatRule && (
          <Button type="button" tone="ghost" size="sm" onClick={() => onAdjustFrequency(reminder)}>调整</Button>
        )}
      </div>
    </Surface>
  );
}

/* ── Main page ── */

export default function RemindersPage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((item) => item.childId === activeChildId);
  const { states, loading, reload } = useReminderStates(activeChildId);
  const { todos: customTodos, loading: customTodosLoading, reload: reloadCustomTodos } = useCustomTodos(activeChildId);
  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
  const [activeReminder, setActiveReminder] = useState<ActiveReminder | null>(null);
  const [captureIntent, setCaptureIntent] = useState<HealthCaptureIntent | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();
  const repeatableRuleIds = useMemo(() => REMINDER_RULES.filter((r) => r.repeatRule).map((r) => r.ruleId), []);

  const reloadFreqOverrides = useCallback(async () => {
    if (!child) { setFreqOverrides(new Map()); return; }
    const overrides = await loadAllFreqOverrides(child.childId, repeatableRuleIds);
    setFreqOverrides(overrides);
  }, [child, repeatableRuleIds]);

  useEffect(() => { void reloadFreqOverrides().catch(catchLogThen('reminders', 'action:load-freq-overrides-failed', () => setFreqOverrides(new Map()))); }, [reloadFreqOverrides]);

  const agendaResult = useMemo(() => {
    if (!child) return { kind: 'idle' as const };
    try {
      const agenda = buildReminderAgenda(REMINDER_RULES, { birthDate: child.birthDate, gender: child.gender, ageMonths, profileCreatedAt: child.createdAt, localToday, nurtureMode: child.nurtureMode, domainOverrides: child.nurtureModeOverrides }, states, freqOverrides);
      return { kind: 'ok' as const, agenda };
    } catch (error) {
      if (error instanceof UnknownReminderRuleError) {
        return { kind: 'unknown-rule' as const, ruleIds: error.ruleIds };
      }
      throw error;
    }
  }, [child, ageMonths, localToday, states, freqOverrides]);

  const agenda = agendaResult.kind === 'ok' ? agendaResult.agenda : null;

  useEffect(() => {
    if (!child || !agenda) return;
    persistAgendaPlan(child.childId, agenda, states).then((didPersist) => { if (didPersist) void reload(); }).catch(catchLog('reminders', 'action:persist-agenda-plan-failed'));
  }, [child, agenda, states, reload]);

  const handleAction = useCallback(async (reminder: ActiveReminder, action: ReminderActionType, extra?: string | null) => {
    if (!child) return;
    await applyReminderAction({ childId: child.childId, reminder, state: reminder.state, action, scheduledDate: action === 'schedule' ? extra ?? null : undefined, snoozedUntil: action === 'snooze' ? extra ?? null : undefined }).catch(catchLog('reminders', 'action:apply-reminder-action-failed'));
    await reload();
  }, [child, reload]);

  const openRecordDataCapture = useCallback((reminder: ActiveReminder) => {
    try {
      setCaptureError(null);
      setCaptureIntent(buildRecordDataCaptureIntent(reminder, localToday));
    } catch (nextError) {
      setCaptureIntent(null);
      setCaptureError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [localToday]);

  const handleSchedule = useCallback((reminder: ActiveReminder) => {
    const suggestion = reminder.state?.scheduledDate ?? localToday;
    const scheduledDate = window.prompt('安排日期 (YYYY-MM-DD)', suggestion);
    if (!scheduledDate) return;
    void handleAction(reminder, 'schedule', scheduledDate);
  }, [handleAction, localToday]);

  const handleRestoreCustomTodo = useCallback(async (todoId: string) => {
    await uncompleteCustomTodo(todoId, isoNow()).catch(catchLog('reminders', 'action:restore-custom-todo-failed'));
    await reloadCustomTodos();
  }, [reloadCustomTodos]);

  const handleDeleteCustomTodo = useCallback(async (todoId: string) => {
    await deleteCustomTodo(todoId).catch(catchLog('reminders', 'action:delete-custom-todo-failed'));
    await reloadCustomTodos();
  }, [reloadCustomTodos]);

  const completedCustomTodos = useMemo(
    () => customTodos.filter((t) => Boolean(t.completedAt)).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [customTodos],
  );

  if (!child) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          title="尚未选择孩子"
          description="选择孩子后即可查看对应的提醒中心。"
          action={(
            <Button asChild tone="secondary" size="sm">
              <Link to="/timeline">返回首页</Link>
            </Button>
          )}
        />
      </div>
    );
  }

  if (agendaResult.kind === 'unknown-rule') {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <InlineAlert tone="danger" className="max-w-2xl">
          <p className="font-semibold">提醒目录不完整</p>
          <p className="mt-1 text-[14px]">
          发现数据库中存在未登记的 ruleId：{agendaResult.ruleIds.join('、')}
          </p>
          <p className="mt-1 text-[14px]">
          为保护数据不被误读，提醒页面已按 PO-TIME-007 fail-close。重启 ParentOS 即可触发 schema v17 自动清理这些游离记录；如果重启后仍有未登记的 ruleId，请联系开发修复规则目录。
          </p>
        </InlineAlert>
      </div>
    );
  }

  if (loading || customTodosLoading || !agenda) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className={cn('text-sm', textMutedClass)}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto hide-scrollbar">
      <div className="max-w-[920px] mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button asChild tone="ghost" size="sm" className="aspect-square px-0">
            <Link to="/timeline" aria-label="返回首页">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </Link>
          </Button>
          <div>
            <h1 className={cn('text-[24px] font-semibold tracking-tight', textPrimaryClass)}>提醒中心</h1>
            <p className={cn('mt-1 text-[14px]', textMutedClass)}>
              今天 {agenda.todayFocus.length} 项，近期 {agenda.upcoming.length} 项，历史 {agenda.history.length} 项
            </p>
          </div>
        </div>

        {/* Hero section — glass card */}
        <Surface as="section" material="glass-thick" padding="none" tone="card" className="rounded-3xl p-7">
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-5 items-stretch">
            <TodayHero
              reminder={agenda.todayFocus[0] ?? null}
              onComplete={(item) => void handleAction(item, item.kind === 'task' ? 'complete' : 'acknowledge')}
              onOpenCapture={openRecordDataCapture}
            />
            <div className="grid grid-cols-1 gap-4">
              {agenda.p0Overflow.count > 0 && <SummaryTile label="更多重要" value={String(agenda.p0Overflow.count)} hint="超出首屏的高优先级提醒。" tone="warning" />}
              {agenda.onboardingCatchup.count > 0 && <SummaryTile label="历史补录" value={String(agenda.onboardingCatchup.count)} hint="在档案创建前已过期的事项。" tone="info" />}
              <SummaryTile label="今天" value={String(agenda.todayFocus.length)} hint="今天值得处理的事项。" tone="success" />
              <SummaryTile label="近期" value={String(agenda.upcoming.length)} hint="近期重要，但不急于今天。" tone="info" />
              <SummaryTile label="逾期汇总" value={String(agenda.overdueSummary.count)} hint="较早的逾期事项折叠在这里。" tone="danger" />
            </div>
          </div>
        </Surface>

        {/* Today */}
        <SectionCard count={agenda.todayFocus.length} title="今日事项" hint="默认折叠，需要时再展开查看今天的完整事项和操作。" collapsible defaultCollapsed>
          <div className="space-y-4">
            {agenda.todayFocus.length === 0 ? <p className={cn('text-[14px]', textMutedClass)}>今天没有需要立即处理的事项。</p>
            : agenda.todayFocus.map((r) => (
              <ReminderRow key={`${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                onOpenDetail={setActiveReminder}
                onComplete={(i) => void handleAction(i, i.kind === 'task' ? 'complete' : 'acknowledge')}
                onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} onOpenCapture={openRecordDataCapture} />
            ))}
          </div>
        </SectionCard>

        {agenda.p0Overflow.count > 0 && (
          <SectionCard count={agenda.p0Overflow.count} title="更多重要事项" hint="高优先级事项始终可见，超出首屏容量后折叠到这里。">
            <div className="space-y-4">
              {agenda.p0Overflow.items.map((r) => (
                <ReminderRow key={`p0-${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                  onOpenDetail={setActiveReminder}
                  onComplete={(i) => void handleAction(i, i.kind === 'task' ? 'complete' : 'acknowledge')}
                  onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                  onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} onOpenCapture={openRecordDataCapture} />
              ))}
            </div>
          </SectionCard>
        )}

        {agenda.onboardingCatchup.count > 0 && (
          <SectionCard count={agenda.onboardingCatchup.count} title="历史补录" hint="这些提醒在档案创建前已过期，不会进入主待办列表。">
            <div className="space-y-4">
              {agenda.onboardingCatchup.items.map((r) => (
                <ReminderRow key={`cold-${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                  onOpenDetail={setActiveReminder}
                  onComplete={(i) => void handleAction(i, i.kind === 'task' ? 'complete' : 'acknowledge')}
                  onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                  onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} onOpenCapture={openRecordDataCapture} />
              ))}
            </div>
          </SectionCard>
        )}

        {/* Upcoming */}
        <SectionCard count={agenda.upcoming.length} title="近期" hint="近期值得关注的事项和阶段指导。">
          <div className="space-y-4">
            {agenda.upcoming.length === 0 ? <p className={cn('text-[14px]', textMutedClass)}>近期没有新的事项需要安排。</p>
            : agenda.upcoming.map((r) => (
              <ReminderRow key={`${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                onOpenDetail={setActiveReminder}
                onComplete={(i) => void handleAction(i, i.kind === 'task' ? 'complete' : 'acknowledge')}
                onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} onOpenCapture={openRecordDataCapture} />
            ))}
          </div>
        </SectionCard>

        {/* History */}
        <SectionCard count={agenda.history.length} title="历史记录" hint="已完成、已安排、已推迟和不适用的提醒都在这里。">
          <div className="space-y-3">
            {agenda.history.length === 0 ? <p className={cn('text-[14px]', textMutedClass)}>暂无提醒历史。</p>
            : agenda.history.map((item) => (
              <Surface key={`${item.rule.ruleId}-${item.repeatIndex}`} material="glass-thin" tone="card" padding="none" className="flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
                <div className="min-w-0">
                  <p className={cn('truncate text-[14px] font-medium', textPrimaryClass)}>{item.rule.title}</p>
                  <p className={cn('mt-1 text-[13px]', textMutedClass)}>{historyLabel(item)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.historyType === 'completed' && (
                    <Button type="button" tone="secondary" size="sm" onClick={() => void handleAction(item, 'restore')}>恢复待办</Button>
                  )}
                  <StatusBadge tone="neutral">{DOMAIN_LABELS[item.rule.domain] ?? item.rule.domain}</StatusBadge>
                </div>
              </Surface>
            ))}
          </div>
        </SectionCard>

        {/* Custom todos history */}
        {completedCustomTodos.length > 0 && (
          <SectionCard count={completedCustomTodos.length} title="日常待办记录" hint="这里收纳你手动添加并已完成的日常待办。">
            <div className="space-y-3">
              {completedCustomTodos.map((todo) => (
                <Surface key={todo.todoId} material="glass-thin" tone="card" padding="none" className="flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
                  <div className="min-w-0">
                    <p className={cn('text-[14px] font-medium [overflow-wrap:anywhere]', textPrimaryClass)}>{todo.title}</p>
                    <p className={cn('mt-1 text-[13px]', textMutedClass)}>
                      {formatDateLabel(todo.completedAt) ? `已完成 ${formatDateLabel(todo.completedAt)}` : '已完成'}
                      {todo.dueDate ? ` · 截止 ${todo.dueDate}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" tone="secondary" size="sm" onClick={() => void handleRestoreCustomTodo(todo.todoId)}>恢复待办</Button>
                    <Button type="button" tone="ghost" size="sm" onClick={() => void handleDeleteCustomTodo(todo.todoId)}>删除</Button>
                  </div>
                </Surface>
              ))}
            </div>
          </SectionCard>
        )}

        {captureError ? (
          <InlineAlert tone="danger">
            {captureError}
          </InlineAlert>
        ) : null}
      </div>

      {child && captureIntent ? (
        <HealthCaptureModal
          open
          childId={child.childId}
          childBirthDate={child.birthDate}
          initialIntent={captureIntent}
          onClose={() => {
            setCaptureIntent(null);
          }}
          onSaved={() => {
            setCaptureIntent(null);
            void reload();
          }}
        />
      ) : null}

      {freqModalReminder && child && freqModalReminder.rule.repeatRule && (
        <FrequencyModal
          childId={child.childId} ruleId={freqModalReminder.rule.ruleId} ruleTitle={freqModalReminder.rule.title}
          currentIntervalMonths={freqModalReminder.rule.repeatRule.intervalMonths} existingOverride={null}
          canDisable={freqModalReminder.rule.priority !== 'P0'}
          onSaved={() => { void reload(); void reloadFreqOverrides(); }} onClose={() => setFreqModalReminder(null)} />
      )}

      <ReminderExplainDrawer
        reminder={activeReminder}
        onClose={() => setActiveReminder(null)}
        onOpenCapture={openRecordDataCapture}
        onAction={(reminder, action, extra) => {
          void handleAction(reminder, action, extra);
        }}
      />
    </div>
  );
}
