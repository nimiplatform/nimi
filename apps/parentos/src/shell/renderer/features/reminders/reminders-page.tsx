import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Surface } from '@nimiplatform/nimi-kit/ui';
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
import {
  applyReminderAction,
  canMarkNotApplicable,
  defaultSnoozeUntil,
  persistAgendaPlan,
} from '../../engine/reminder-actions.js';
import type { ReminderActionType } from '../../engine/reminder-actions.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';

const textMain = '#1e293b';
const textMuted = '#475569';
const glassInner = { background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 16 };

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

function primaryAction(reminder: ActiveReminder) {
  if (reminder.kind === 'guidance') return { label: '打开笔记', to: `/journal?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}` };
  if (reminder.rule.domain === 'vaccine') return { label: '记录疫苗', to: `/profile/vaccines?ruleId=${encodeURIComponent(reminder.rule.ruleId)}` };
  if (reminder.rule.domain === 'growth' || reminder.rule.actionType === 'record_data') return { label: '记录数据', to: '/profile/growth' };
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

function SummaryTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: { bg: string; fg: string } }) {
  return (
    <div className="rounded-[18px] p-5" style={{ ...glassInner, background: tone.bg }}>
      <p className="text-[11px] font-semibold tracking-[0.06em]" style={{ color: tone.fg }}>{label}</p>
      <p className="text-[26px] font-semibold mt-2 leading-none tracking-tight" style={{ color: textMain }}>{value}</p>
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: textMuted }}>{hint}</p>
    </div>
  );
}

/* ── Glass section card ── */

function SectionCard({ title, hint, count, children, collapsible = false, defaultCollapsed = false }: {
  title: string; hint: string; count?: number; children: ReactNode; collapsible?: boolean; defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <Surface as="section" material="glass-regular" padding="none" tone="card" className="p-7 transition-transform hover:-translate-y-0.5 rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
      <div className="flex items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.3px' }}>{title}</h2>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: textMuted }}>{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof count === 'number' && (
            <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(78,204,163,0.06)', color: textMuted }}>{count} 项</span>
          )}
          {collapsible && (
            <button type="button" onClick={() => setCollapsed((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-white/40"
              style={{ color: textMuted }}>
              <span>{collapsed ? '展开' : '收起'}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 180ms ease' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {!collapsible || !collapsed ? children : null}
    </Surface>
  );
}

/* ── Today hero ── */

function TodayHero({ reminder, onComplete }: { reminder: ActiveReminder | null; onComplete: (r: ActiveReminder) => void }) {
  if (!reminder) {
    return (
      <div className="rounded-[20px] p-6" style={glassInner}>
        <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: '#22c55e' }}>今日</p>
        <h2 className="text-[22px] font-semibold mt-2 tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>今天没有待办</h2>
        <p className="text-[12px] mt-2 leading-relaxed" style={{ color: textMuted }}>当前没有需要立即处理的事项。</p>
      </div>
    );
  }
  const primary = primaryAction(reminder);
  return (
    <div className="rounded-[20px] p-6" style={glassInner}>
      <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: '#22c55e' }}>今日</p>
      <h2 className="text-[22px] font-semibold mt-2 tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{reminder.rule.title}</h2>
      <p className="text-[12px] mt-2 leading-relaxed" style={{ color: textMuted }}>{statusLabel(reminder)}</p>
      <div className="flex flex-wrap items-center gap-2 mt-5">
        <Link to={primary.to} className="px-4 py-2 rounded-full text-[11px] font-medium text-white transition-all hover:-translate-y-0.5"
          style={{ background: textMain, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>{primary.label}</Link>
        <button type="button" onClick={() => onComplete(reminder)}
          className="px-4 py-2 rounded-full text-[11px] font-medium transition-colors hover:bg-white/60"
          style={{ background: 'rgba(78,204,163,0.06)', color: textMain }}>标记完成</button>
      </div>
    </div>
  );
}

/* ── Reminder row ── */

function ReminderRow({ reminder, onComplete, onSnooze, onSchedule, onNotApplicable, onAdjustFrequency }: {
  reminder: ActiveReminder; onComplete: (r: ActiveReminder) => void; onSnooze: (r: ActiveReminder) => void;
  onSchedule: (r: ActiveReminder) => void; onNotApplicable: (r: ActiveReminder) => void; onAdjustFrequency: (r: ActiveReminder) => void;
}) {
  const primary = primaryAction(reminder);
  const domain = DOMAIN_LABELS[reminder.rule.domain] ?? reminder.rule.domain;
  const isOverdue = reminder.lifecycle === 'overdue';

  return (
    <div className="rounded-[16px] p-5 transition-colors hover:bg-white" style={glassInner}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] px-2.5 py-1 rounded-full font-medium"
              style={{ background: isOverdue ? 'rgba(239,68,68,0.08)' : 'rgba(100,150,255,0.08)', color: isOverdue ? '#ef4444' : textMuted }}>{domain}</span>
            <span className="text-[10px]" style={{ color: textMuted }}>{statusLabel(reminder)}</span>
          </div>
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>{reminder.rule.title}</p>
          <p className="text-[12px] mt-2 leading-relaxed" style={{ color: textMuted }}>{reminder.rule.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <Link to={primary.to} className="px-3.5 py-1.5 rounded-full text-[11px] font-medium text-white hover:-translate-y-0.5"
          style={{ background: textMain, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>{primary.label}</Link>
        <button type="button" onClick={() => onComplete(reminder)} className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors hover:bg-white/60"
          style={{ background: 'rgba(78,204,163,0.06)', color: textMain }}>完成</button>
        <button type="button" onClick={() => onSnooze(reminder)} className="px-3 py-1.5 rounded-full text-[11px] transition-colors hover:bg-white/60"
          style={{ color: textMuted }}>推迟</button>
        {reminder.kind === 'task' && (
          <button type="button" onClick={() => onSchedule(reminder)} className="px-3 py-1.5 rounded-full text-[11px] transition-colors hover:bg-white/60"
            style={{ color: textMuted }}>安排</button>
        )}
        {canMarkNotApplicable(reminder) && (
          <button type="button" onClick={() => onNotApplicable(reminder)} className="px-3 py-1.5 rounded-full text-[11px] transition-colors hover:bg-white/60"
            style={{ color: '#ef4444' }}>不适用</button>
        )}
        {reminder.rule.repeatRule && (
          <button type="button" onClick={() => onAdjustFrequency(reminder)} className="px-3 py-1.5 rounded-full text-[11px] transition-colors hover:bg-white/60"
            style={{ color: textMuted }}>调整</button>
        )}
      </div>
    </div>
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
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: textMuted }}>
        <p className="text-lg font-medium">尚未选择孩子</p>
        <Link to="/timeline" className="text-sm hover:underline" style={{ color: textMain }}>返回首页</Link>
      </div>
    );
  }

  if (agendaResult.kind === 'unknown-rule') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center" style={{ color: '#b91c1c' }}>
        <p className="text-base font-medium">提醒目录不完整</p>
        <p className="text-[12px]" style={{ color: textMuted }}>
          发现数据库中存在未登记的 ruleId：{agendaResult.ruleIds.join('、')}
        </p>
        <p className="text-[12px]" style={{ color: textMuted }}>
          为保护数据不被误读，提醒页面已按 PO-TIME-007 fail-close。请联系开发修复规则目录或清理脏数据。
        </p>
      </div>
    );
  }

  if (loading || customTodosLoading || !agenda) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'transparent' }}>
        <p className="text-sm" style={{ color: textMuted }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto hide-scrollbar" style={{ background: 'transparent' }}>
      <div className="max-w-[920px] mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/timeline" className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/40" style={{ color: textMain }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>提醒中心</h1>
            <p className="text-[12px] mt-1" style={{ color: textMuted }}>
              今天 {agenda.todayFocus.length} 项，近期 {agenda.upcoming.length} 项，历史 {agenda.history.length} 项
            </p>
          </div>
        </div>

        {/* Hero section — glass card */}
        <Surface as="section" material="glass-thick" padding="none" tone="card" className="p-7 rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-5 items-stretch">
            <TodayHero
              reminder={agenda.todayFocus[0] ?? null}
              onComplete={(item) => void handleAction(item, item.kind === 'guidance' ? 'acknowledge' : 'complete')}
            />
            <div className="grid grid-cols-1 gap-4">
              {agenda.p0Overflow.count > 0 && <SummaryTile label="更多重要" value={String(agenda.p0Overflow.count)} hint="超出首屏的高优先级提醒。" tone={{ bg: 'rgba(251,191,36,0.08)', fg: '#b7791f' }} />}
              {agenda.onboardingCatchup.count > 0 && <SummaryTile label="历史补录" value={String(agenda.onboardingCatchup.count)} hint="在档案创建前已过期的事项。" tone={{ bg: 'rgba(139,92,246,0.06)', fg: '#7b61a8' }} />}
              <SummaryTile label="今天" value={String(agenda.todayFocus.length)} hint="今天值得处理的事项。" tone={{ bg: 'rgba(34,197,94,0.06)', fg: '#16a34a' }} />
              <SummaryTile label="近期" value={String(agenda.upcoming.length)} hint="近期重要，但不急于今天。" tone={{ bg: 'rgba(59,130,246,0.06)', fg: '#3b82f6' }} />
              <SummaryTile label="逾期汇总" value={String(agenda.overdueSummary.count)} hint="较早的逾期事项折叠在这里。" tone={{ bg: 'rgba(239,68,68,0.05)', fg: '#ef4444' }} />
            </div>
          </div>
        </Surface>

        {/* Today */}
        <SectionCard count={agenda.todayFocus.length} title="今日事项" hint="默认折叠，需要时再展开查看今天的完整事项和操作。" collapsible defaultCollapsed>
          <div className="space-y-4">
            {agenda.todayFocus.length === 0 ? <p className="text-[12px]" style={{ color: textMuted }}>今天没有需要立即处理的事项。</p>
            : agenda.todayFocus.map((r) => (
              <ReminderRow key={`${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                onComplete={(i) => void handleAction(i, i.kind === 'guidance' ? 'acknowledge' : 'complete')}
                onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} />
            ))}
          </div>
        </SectionCard>

        {agenda.p0Overflow.count > 0 && (
          <SectionCard count={agenda.p0Overflow.count} title="更多重要事项" hint="高优先级事项始终可见，超出首屏容量后折叠到这里。">
            <div className="space-y-4">
              {agenda.p0Overflow.items.map((r) => (
                <ReminderRow key={`p0-${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                  onComplete={(i) => void handleAction(i, i.kind === 'guidance' ? 'acknowledge' : 'complete')}
                  onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                  onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} />
              ))}
            </div>
          </SectionCard>
        )}

        {agenda.onboardingCatchup.count > 0 && (
          <SectionCard count={agenda.onboardingCatchup.count} title="历史补录" hint="这些提醒在档案创建前已过期，不会进入主待办列表。">
            <div className="space-y-4">
              {agenda.onboardingCatchup.items.map((r) => (
                <ReminderRow key={`cold-${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                  onComplete={(i) => void handleAction(i, i.kind === 'guidance' ? 'acknowledge' : 'complete')}
                  onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                  onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} />
              ))}
            </div>
          </SectionCard>
        )}

        {/* Upcoming */}
        <SectionCard count={agenda.upcoming.length} title="近期" hint="近期值得关注的事项和阶段指导。">
          <div className="space-y-4">
            {agenda.upcoming.length === 0 ? <p className="text-[12px]" style={{ color: textMuted }}>近期没有新的事项需要安排。</p>
            : agenda.upcoming.map((r) => (
              <ReminderRow key={`${r.rule.ruleId}-${r.repeatIndex}`} reminder={r}
                onComplete={(i) => void handleAction(i, i.kind === 'guidance' ? 'acknowledge' : 'complete')}
                onSnooze={(i) => void handleAction(i, 'snooze', defaultSnoozeUntil(i.kind, localToday))}
                onSchedule={handleSchedule} onNotApplicable={(i) => void handleAction(i, 'mark_not_applicable')} onAdjustFrequency={(i) => setFreqModalReminder(i)} />
            ))}
          </div>
        </SectionCard>

        {/* History */}
        <SectionCard count={agenda.history.length} title="历史记录" hint="已完成、已安排、已推迟和不适用的提醒都在这里。">
          <div className="space-y-3">
            {agenda.history.length === 0 ? <p className="text-[12px]" style={{ color: textMuted }}>暂无提醒历史。</p>
            : agenda.history.map((item) => (
              <div key={`${item.rule.ruleId}-${item.repeatIndex}`} className="flex items-center justify-between gap-3 rounded-[14px] px-5 py-3.5 transition-colors hover:bg-white" style={glassInner}>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: textMain }}>{item.rule.title}</p>
                  <p className="text-[11px] mt-1" style={{ color: textMuted }}>{historyLabel(item)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.historyType === 'completed' && (
                    <button type="button" onClick={() => void handleAction(item, 'restore')}
                      className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-white/60"
                      style={{ color: '#818CF8', background: 'rgba(129,140,248,0.10)' }}>恢复待办</button>
                  )}
                  <span className="text-[10px] px-2 py-1 rounded-full" style={{ color: textMuted, background: 'rgba(78,204,163,0.06)' }}>
                    {DOMAIN_LABELS[item.rule.domain] ?? item.rule.domain}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Custom todos history */}
        {completedCustomTodos.length > 0 && (
          <SectionCard count={completedCustomTodos.length} title="日常待办记录" hint="这里收纳你手动添加并已完成的日常待办。">
            <div className="space-y-3">
              {completedCustomTodos.map((todo) => (
                <div key={todo.todoId} className="flex items-center justify-between gap-3 rounded-[14px] px-5 py-3.5 transition-colors hover:bg-white" style={glassInner}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium [overflow-wrap:anywhere]" style={{ color: textMain }}>{todo.title}</p>
                    <p className="mt-1 text-[11px]" style={{ color: textMuted }}>
                      {formatDateLabel(todo.completedAt) ? `已完成 ${formatDateLabel(todo.completedAt)}` : '已完成'}
                      {todo.dueDate ? ` · 截止 ${todo.dueDate}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => void handleRestoreCustomTodo(todo.todoId)}
                      className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-white/60"
                      style={{ color: '#818CF8', background: 'rgba(129,140,248,0.10)' }}>恢复待办</button>
                    <button type="button" onClick={() => void handleDeleteCustomTodo(todo.todoId)}
                      className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-white/60"
                      style={{ color: textMuted }}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {freqModalReminder && child && freqModalReminder.rule.repeatRule && (
        <FrequencyModal
          childId={child.childId} ruleId={freqModalReminder.rule.ruleId} ruleTitle={freqModalReminder.rule.title}
          currentIntervalMonths={freqModalReminder.rule.repeatRule.intervalMonths} existingOverride={null}
          onSaved={() => { void reload(); void reloadFreqOverrides(); }} onClose={() => setFreqModalReminder(null)} />
      )}
    </div>
  );
}
