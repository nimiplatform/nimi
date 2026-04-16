import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { WelcomePage } from './welcome-page.js';
import { REMINDER_RULES, SENSITIVE_PERIODS } from '../../knowledge-base/index.js';
import {
  buildAllergyProfile,
  interceptAllergyCollisions,
  getActiveSeasonalAlerts,
  type DynamicTask,
  type EnhancedReminder,
} from '../../engine/smart-alerts.js';
import {
  applyReminderAction,
  canMarkNotApplicable,
  defaultSnoozeUntil,
  persistAgendaPlan,
} from '../../engine/reminder-actions.js';
import { buildReminderAgenda, getLocalToday, type ActiveReminder } from '../../engine/reminder-engine.js';
import {
  completeCustomTodo,
  deleteCustomTodo,
  insertCustomTodo,
  uncompleteCustomTodo,
} from '../../bridge/sqlite-bridge.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { useDash, buildTimelineHomeViewModel, C, DOMAIN_ROUTES } from './timeline-data.js';
import {
  ChildContextCard,
  GrowthSnapshotCard,
  MilestoneTimelineCard,
  MonthlyReportCard,
  ObservationDistributionCard,
  OutdoorGoalCard,
  QuickLinksStrip,
  RecentChangesHeroCard,
  RecentLinesCard,
  SleepTrendCard,
  StageFocusCard,
  VisionCard,
} from './timeline-cards.js';
import { autoGenerateMonthlyReport } from '../reports/auto-report.js';
import { FrequencyModal } from '../reminders/frequency-modal.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import { computeObservationNudges, type ObservationNudge } from './timeline-observation-nudges.js';
import { ProfileDatePicker } from '../profile/profile-date-picker.js';

const ACTION_PILL_CLASS = 'inline-flex h-7 min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border-0 px-3 no-underline [appearance:none] transition-colors';
const ACTION_LABEL_CLASS = 'block text-[11px] leading-none font-medium tracking-[0.01em]';

function reminderPrimaryLink(reminder: ActiveReminder) {
  if (reminder.kind === 'guidance') {
    return {
      label: reminder.rule.actionType === 'observe' ? '打开笔记' : '开始',
      to: `/journal?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}`,
    };
  }

  if (reminder.rule.domain === 'vaccine') {
    return {
      label: '记录疫苗',
      to: `/profile/vaccines?ruleId=${encodeURIComponent(reminder.rule.ruleId)}`,
    };
  }

  if (reminder.rule.actionType === 'record_data' || reminder.rule.domain === 'growth') {
    return { label: '记录数据', to: '/profile/growth' };
  }

  return {
    label: '查看详情',
    to: DOMAIN_ROUTES[reminder.rule.domain] ?? '/profile',
  };
}

function reminderStatus(reminder: ActiveReminder) {
  switch (reminder.lifecycle) {
    case 'completed':
      return '已完成';
    case 'scheduled':
      return reminder.state?.scheduledDate ? `已安排 ${reminder.state.scheduledDate}` : '已安排';
    case 'snoozed':
      return reminder.state?.snoozedUntil ? `已推迟至 ${reminder.state.snoozedUntil}` : '已推迟';
    case 'overdue':
      return reminder.overdueDays > 0 ? `逾期${reminder.overdueDays}天` : '已逾期';
    case 'due':
      return '今天到期';
    default:
      return reminder.daysUntilStart > 0 ? `${reminder.daysUntilStart}天后开始` : '本周';
  }
}

function OverdueGroup({
  items,
  totalCount,
  onAction,
}: {
  items: ActiveReminder[];
  totalCount: number;
  onAction: (
    reminder: ActiveReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today',
    extra?: string | null,
  ) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mx-2 mt-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-1.5 text-left">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d97706"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="text-[10px] font-semibold" style={{ color: '#d97706' }}>逾期汇总</span>
        <span className="rounded-full px-1.5 py-[1px] text-[9px] font-medium" style={{ background: '#fef3c7', color: '#b45309' }}>
          {totalCount}
        </span>
      </button>
      {open && items.map((reminder) => {
        const primary = reminderPrimaryLink(reminder);
        return (
          <div
            key={`overdue-${reminder.rule.ruleId}-${reminder.repeatIndex}`}
            className="group flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-[#fefbf5]"
          >
            <button
              type="button"
              title="标记完成"
              onClick={() => onAction(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
              className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:bg-[#f59e0b]/15"
              style={{ borderColor: '#f59e0b' }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium leading-snug" style={{ color: C.text }}>{reminder.rule.title}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: '#f59e0b' }}>{reminderStatus(reminder)}</p>
              <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <Link to={primary.to} className={ACTION_PILL_CLASS} style={{ background: '#1e293b', color: '#fff' }}>
                  <span className={ACTION_LABEL_CLASS}>{primary.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                  className={ACTION_PILL_CLASS}
                  style={{ background: '#f1f5f9', color: '#475569' }}
                >
                  <span className={ACTION_LABEL_CLASS}>推迟</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {open && totalCount > items.length && (
        <Link to="/reminders" className="block py-1 text-center text-[10px]" style={{ color: '#475569' }}>
          查看全部 {totalCount}
        </Link>
      )}
    </div>
  );
}

function AgendaOverflowGroup({
  label,
  totalCount,
  items,
  tone,
  onAction,
}: {
  label: string;
  totalCount: number;
  items: ActiveReminder[];
  tone: { bg: string; fg: string; text: string };
  onAction: (
    reminder: ActiveReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today',
    extra?: string | null,
  ) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-2 mt-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-1.5 text-left">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke={tone.fg}
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="text-[10px] font-semibold" style={{ color: tone.fg }}>{label}</span>
        <span className="rounded-full px-1.5 py-[1px] text-[9px] font-medium" style={{ background: tone.bg, color: tone.text }}>
          {totalCount}
        </span>
      </button>
      {open && items.map((reminder) => {
        const primary = reminderPrimaryLink(reminder);
        return (
          <div
            key={`${label}-${reminder.rule.ruleId}-${reminder.repeatIndex}`}
            className="group flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-[#f6f6f3]"
          >
            <button
              type="button"
              title="标记完成"
              onClick={() => onAction(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
              className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:bg-white"
              style={{ borderColor: tone.text }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={tone.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium leading-snug" style={{ color: C.text }}>{reminder.rule.title}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: tone.text }}>{reminderStatus(reminder)}</p>
              <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <Link to={primary.to} className={ACTION_PILL_CLASS} style={{ background: '#1e293b', color: '#fff' }}>
                  <span className={ACTION_LABEL_CLASS}>{primary.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                  className={ACTION_PILL_CLASS}
                  style={{ background: '#f1f5f9', color: '#475569' }}
                >
                  <span className={ACTION_LABEL_CLASS}>推迟</span>
                </button>
                {canMarkNotApplicable(reminder) && (
                  <button
                    type="button"
                    onClick={() => onAction(reminder, 'mark_not_applicable')}
                    className="rounded-full px-2.5 py-1 text-[10px]"
                    style={{ background: '#fff', color: '#a16b5d' }}
                  >
                    不适用
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDueDate(dueDate: string): string {
  const today = getLocalToday();
  if (dueDate === today) return '今天';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dueDate === tomorrowStr) return '明天';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (dueDate === yesterdayStr) return '昨天（已逾期）';
  if (dueDate < today) {
    const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / (24 * 60 * 60 * 1000));
    return `逾期${days}天`;
  }
  const days = Math.floor((new Date(dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 7) return `${days}天后`;
  return new Date(dueDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function CustomTodoComposer({
  childId,
  onChanged,
  onAdded,
}: {
  childId: string;
  onChanged: () => void;
  onAdded: (todo: CustomTodoRow) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerOpenNonce, setDatePickerOpenNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [newTitle]);

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const now = isoNow();
    const todoId = ulid();
    const optimisticTodo: CustomTodoRow = {
      todoId,
      childId,
      title,
      dueDate: newDueDate || null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    setAdding(true);
    try {
      await insertCustomTodo({ todoId, childId, title, dueDate: newDueDate || null, now });
      setNewTitle('');
      setNewDueDate('');
      setShowDatePicker(false);
      inputRef.current?.focus();
      onAdded(optimisticTodo);
      onChanged();
    } catch (error) {
      catchLog('timeline', 'action:add-custom-todo-failed')(error);
    } finally {
      setAdding(false);
    }
  }, [newTitle, newDueDate, childId, onAdded, onChanged]);

  const isActive = isFocused || showDatePicker || newDueDate.length > 0 || newTitle.trim().length > 0;
  const dateFieldClassName = `w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#C2E8F7]/50`;
  const dateFieldStyle = {
    borderColor: S.border,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    background: '#fafaf8',
  };

  return (
    <div className="px-5 pb-3 pt-3">
      <div
        className="rounded-2xl px-3 py-2 transition-all"
        style={{
          background: isActive ? 'rgba(78, 204, 163, 0.10)' : 'transparent',
          boxShadow: isActive ? '0 10px 22px rgba(78, 204, 163, 0.08)' : 'none',
        }}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[13px] font-medium transition-colors"
            style={{ color: isActive ? '#3BB88A' : '#64748b' }}
          >
            +
          </span>
          <textarea
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || isComposingRef.current || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void handleAdd();
            }}
            placeholder="添加日常待办..."
            disabled={adding}
            rows={1}
            className="min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-1 text-[12px] leading-5 outline-none placeholder:text-[12px]"
            style={{ color: isActive ? '#3BB88A' : C.text }}
          />
          <button
            type="button"
            title={showDatePicker ? '收起日期' : '设置日期'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (showDatePicker) {
                setShowDatePicker(false);
                return;
              }
              setShowDatePicker(true);
              setDatePickerOpenNonce((value) => value + 1);
            }}
            className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] transition-all"
            style={{
              color: showDatePicker || newDueDate ? '#3BB88A' : '#64748b',
              background: showDatePicker || newDueDate ? 'rgba(78, 204, 163, 0.12)' : 'transparent',
              opacity: isActive || newDueDate ? 1 : 0.7,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {newDueDate ? <span>{formatDueDate(newDueDate)}</span> : null}
          </button>
        </div>
        {showDatePicker && (
          <div className="mt-2 pl-7">
            <ProfileDatePicker
              value={newDueDate}
              onChange={setNewDueDate}
              allowClear
              maxDate="2100-12-31"
              autoOpenNonce={datePickerOpenNonce}
              className={dateFieldClassName}
              style={dateFieldStyle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function sortCustomTodos(todos: CustomTodoRow[]) {
  const pending = todos
    .filter((todo) => !todo.completedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const completed = todos
    .filter((todo) => todo.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));
  return { pending, completed };
}

function CustomTodoInlineList({
  todos,
  onChanged,
  animatedTodoId,
}: {
  todos: CustomTodoRow[];
  onChanged: () => void;
  animatedTodoId: string | null;
}) {
  const handleToggle = useCallback(async (todo: CustomTodoRow) => {
    if (todo.completedAt) {
      await uncompleteCustomTodo(todo.todoId, isoNow());
    } else {
      await completeCustomTodo(todo.todoId, isoNow());
    }
    onChanged();
  }, [onChanged]);

  const handleDelete = useCallback(async (todoId: string) => {
    await deleteCustomTodo(todoId);
    onChanged();
  }, [onChanged]);

  const { pending, completed } = useMemo(() => sortCustomTodos(todos), [todos]);
  if (pending.length === 0 && completed.length === 0) return null;

  return (
    <div className="px-3 pb-1">
      <div className="space-y-1.5">
        {pending.map((todo) => {
          const isAnimated = animatedTodoId === todo.todoId;
          return (
            <div
              key={todo.todoId}
              className={`group flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-all hover:bg-[#edf4ff] ${isAnimated ? 'custom-todo-slide-down' : ''}`}
              style={{ background: '#f6f9ff' }}
            >
              <button
                type="button"
                title="标记完成"
                onClick={() => void handleToggle(todo)}
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:bg-[#7ba7ff]/15"
                style={{ borderColor: '#7ba7ff' }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#7ba7ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium leading-snug [overflow-wrap:anywhere]" style={{ color: '#38506f' }}>{todo.title}</p>
                {todo.dueDate && (
                  <p className="mt-0.5 text-[10px]" style={{ color: todo.dueDate < getLocalToday() ? '#ef4444' : '#8aa1bc' }}>
                    {formatDueDate(todo.dueDate)}
                  </p>
                )}
              </div>
              <button
                type="button"
                title="删除"
                onClick={() => void handleDelete(todo.todoId)}
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: '#8aa1bc' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}

        {completed.length > 0 && (
          <div className="pt-1">
            {completed.slice(0, 5).map((todo) => (
              <div
                key={todo.todoId}
                className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#f2f6ff]"
              >
                <button
                  type="button"
                  title="取消完成"
                  onClick={() => void handleToggle(todo)}
                  className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]"
                  style={{ borderColor: '#7ba7ff', background: '#7ba7ff' }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-snug line-through [overflow-wrap:anywhere]" style={{ color: '#9fb0c8' }}>{todo.title}</p>
                </div>
                <button
                  type="button"
                  title="删除"
                  onClick={() => void handleDelete(todo.todoId)}
                  className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: '#9fb0c8' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReminderPanel({
  todayFocus,
  upcoming,
  p0OverflowCount,
  p0OverflowItems,
  onboardingCatchupCount,
  onboardingCatchupItems,
  overdueCount,
  overdueItems,
  seasonalTasks,
  customTodos,
  childId,
  onAction,
  onCustomTodoChanged,
  observationNudges,
}: {
  todayFocus: EnhancedReminder[];
  upcoming: EnhancedReminder[];
  p0OverflowCount: number;
  p0OverflowItems: ActiveReminder[];
  onboardingCatchupCount: number;
  onboardingCatchupItems: ActiveReminder[];
  overdueCount: number;
  overdueItems: ActiveReminder[];
  seasonalTasks: DynamicTask[];
  customTodos: CustomTodoRow[];
  childId: string;
  onAction: (
    reminder: EnhancedReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today',
    extra?: string | null,
  ) => void;
  onCustomTodoChanged: () => void;
  observationNudges: ObservationNudge[];
}) {
  const defaultTab = todayFocus.length > 0 ? 'today' : 'upcoming';
  const [tab, setTab] = useState<'today' | 'upcoming'>(defaultTab);
  const [optimisticTodo, setOptimisticTodo] = useState<CustomTodoRow | null>(null);
  const [animatedTodoId, setAnimatedTodoId] = useState<string | null>(null);
  // Sync default when data changes (e.g. today empties after an action)
  useEffect(() => { setTab(todayFocus.length > 0 ? 'today' : 'upcoming'); }, [todayFocus.length]);
  const showTabs = todayFocus.length > 0 || upcoming.length > 0;
  const items = tab === 'today' ? todayFocus : upcoming;
  const customTodoList = useMemo(() => {
    if (!optimisticTodo) return customTodos;
    if (customTodos.some((todo) => todo.todoId === optimisticTodo.todoId)) return customTodos;
    return [optimisticTodo, ...customTodos];
  }, [customTodos, optimisticTodo]);

  useEffect(() => {
    if (!optimisticTodo) return;
    if (!customTodos.some((todo) => todo.todoId === optimisticTodo.todoId)) return;
    setOptimisticTodo(null);
  }, [customTodos, optimisticTodo]);

  useEffect(() => {
    if (!animatedTodoId) return;
    const timer = window.setTimeout(() => setAnimatedTodoId(null), 420);
    return () => window.clearTimeout(timer);
  }, [animatedTodoId]);

  return (
    <div className="relative hidden w-[320px] shrink-0 flex-col pt-7 pb-6 pr-4 lg:flex" style={{ background: 'transparent' }}>
      {/* ── Header row ── */}
      <div className="mb-5 flex items-center justify-between px-3">
        <h3 className="text-[18px] font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>待办事项</h3>
        <Link to="/reminders" className="text-[11px] font-medium" style={{ color: '#475569' }}>查看全部</Link>
      </div>

      {/* ── Tabs ── */}
      {showTabs && (
        <div className="mx-3 mb-5 flex gap-0.5 rounded-full p-[3px]" style={{ background: 'rgba(0,0,0,0.04)' }}>
          {([['today', '今天'], ['upcoming', '近期']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="flex-1 rounded-full py-[6px] text-[11px] font-bold transition-all"
              style={tab === key ? { background: '#fff', color: '#1e293b', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' } : { color: '#9CA0A6' }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Custom todo composer ── */}
      <div className="px-1 mb-2">
        <CustomTodoComposer
          childId={childId}
          onChanged={onCustomTodoChanged}
          onAdded={(todo) => {
            setOptimisticTodo(todo);
            setAnimatedTodoId(todo.todoId);
          }}
        />
        <CustomTodoInlineList todos={customTodoList} onChanged={onCustomTodoChanged} animatedTodoId={animatedTodoId} />
      </div>

      {/* ── Scrollable reminder list ── */}
      <div className="flex-1 overflow-y-auto px-1">
        {items.length === 0 ? (
          <p className="py-10 text-center text-[12px]" style={{ color: '#64748b' }}>暂无事项</p>
        ) : (
          <>
            {/* ━━ All reminder items — uniform style, white hover ━━ */}
            {items.map((reminder) => {
              const primary = reminderPrimaryLink(reminder);
              return (
                <div
                  key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
                  className="group flex items-start gap-3 rounded-[12px] px-3 py-3.5 transition-colors hover:bg-white"
                >
                  {/* Minimal thin-line checkbox */}
                  <button
                    type="button"
                    title="标记完成"
                    onClick={() => onAction(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
                    className="mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-all hover:border-[#4ECCA3]"
                    style={{ borderColor: '#D0D3D8' }}
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[12px] font-medium leading-snug" style={{ color: '#1e293b' }}>{reminder.rule.title}</p>
                      <span className="shrink-0 text-[10px]" style={{ color: '#64748b' }}>{reminderStatus(reminder)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <Link to={primary.to} className={ACTION_PILL_CLASS} style={{ background: '#1e293b', color: '#fff' }}>
                        <span className={ACTION_LABEL_CLASS}>{primary.label}</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                        className={ACTION_PILL_CLASS}
                        style={{ background: 'transparent', color: '#475569' }}
                      >
                        <span className={ACTION_LABEL_CLASS}>推迟</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {p0OverflowCount > 0 && (
          <AgendaOverflowGroup
            label="更多重要事项"
            totalCount={p0OverflowCount}
            items={p0OverflowItems}
            tone={{ bg: '#fff6df', fg: '#c9891a', text: '#b7791f' }}
            onAction={onAction}
          />
        )}

        {onboardingCatchupCount > 0 && (
          <AgendaOverflowGroup
            label="历史补录"
            totalCount={onboardingCatchupCount}
            items={onboardingCatchupItems}
            tone={{ bg: '#f3eefc', fg: '#8a63b8', text: '#7b61a8' }}
            onAction={onAction}
          />
        )}

        {overdueCount > 0 && (
          <OverdueGroup items={overdueItems} totalCount={overdueCount} onAction={onAction} />
        )}

        {seasonalTasks.length > 0 && (
          <div className="mt-3 pt-3">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: '#d97706' }}>季节关注</p>
            {seasonalTasks.map((task) => (
              <div key={task.id} className="px-1 py-2">
                <p className="text-[11px] font-semibold" style={{ color: '#1e293b' }}>{task.title}</p>
                <p className="mt-0.5 text-[9px] leading-relaxed" style={{ color: '#475569' }}>{task.description}</p>
              </div>
            ))}
          </div>
        )}

        {observationNudges.length > 0 && (
          <ObservationNudgeSection nudges={observationNudges} />
        )}
      </div>
    </div>
  );
}

/* ── Observation Nudges — quiet list, not card-per-item ── */

function ObservationNudgeSection({ nudges }: { nudges: ObservationNudge[] }) {
  if (nudges.length === 0) return null;

  return (
    <div className="mt-8 pt-2">
      <p className="mb-5 text-[18px] font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>观察建议</p>
      {nudges.map((nudge) => (
        <div
          key={nudge.dimensionId}
          className="group flex items-start gap-2.5 rounded-[12px] px-3 py-3 transition-colors hover:bg-white"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium leading-snug" style={{ color: '#1e293b' }}>{nudge.nudgeText}</p>
            <p className="mt-0.5 text-[10px]" style={{ color: '#475569' }}>{nudge.parentQuestion}</p>
          </div>
          <Link
            to={`/observe?dimensionId=${encodeURIComponent(nudge.dimensionId)}`}
            className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-medium text-white opacity-0 transition-all group-hover:opacity-100 hover:-translate-y-0.5"
            style={{ background: '#1e293b', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          >
            去观察
          </Link>
        </div>
      ))}
    </div>
  );
}

export default function TimelinePage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((item) => item.childId === activeChildId);
  const { d, loading, reload } = useDash(activeChildId);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();
  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
  const autoGenTriggered = useRef(false);

  const repeatableRuleIds = useMemo(
    () => REMINDER_RULES.filter((rule) => rule.repeatRule).map((rule) => rule.ruleId),
    [],
  );

  const reloadFreqOverrides = useCallback(async () => {
    if (!child) {
      setFreqOverrides(new Map());
      return;
    }
    const overrides = await loadAllFreqOverrides(child.childId, repeatableRuleIds);
    setFreqOverrides(overrides);
  }, [child, repeatableRuleIds]);

  useEffect(() => {
    void reloadFreqOverrides().catch(catchLogThen('timeline', 'action:load-freq-overrides-failed', () => setFreqOverrides(new Map())));
  }, [reloadFreqOverrides]);

  const agenda = useMemo(
    () => child ? buildReminderAgenda(REMINDER_RULES, {
      birthDate: child.birthDate,
      gender: child.gender,
      ageMonths,
      profileCreatedAt: child.createdAt,
      localToday,
      nurtureMode: child.nurtureMode,
      domainOverrides: child.nurtureModeOverrides,
    }, d.reminderStates, freqOverrides) : null,
    [child, ageMonths, localToday, d.reminderStates, freqOverrides],
  );

  const allergyProfile = useMemo(
    () => child ? buildAllergyProfile(child.allergies, d.allergyRecords) : null,
    [child, d.allergyRecords],
  );

  const todayFocus: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.todayFocus, allergyProfile) : agenda.todayFocus) : [],
    [agenda, allergyProfile],
  );

  const upcoming: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.upcoming, allergyProfile) : agenda.upcoming) : [],
    [agenda, allergyProfile],
  );

  const seasonalTasks = useMemo(() => {
    if (!allergyProfile || !child) return [];
    return getActiveSeasonalAlerts(allergyProfile).map((task) => ({ ...task, childId: child.childId }));
  }, [allergyProfile, child]);

  const periods = useMemo(
    () => SENSITIVE_PERIODS.filter((period) => ageMonths >= period.ageRange.startMonths && ageMonths <= period.ageRange.endMonths),
    [ageMonths],
  );

  const homeVm = useMemo(
    () => child && agenda ? buildTimelineHomeViewModel({ child, d, ageMonths, agenda }) : null,
    [child, d, ageMonths, agenda],
  );

  const observationNudges = useMemo(() => {
    if (!child) return [];
    const activeDims = getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths);
    return computeObservationNudges(activeDims, d.journalEntries);
  }, [child, ageMonths, d.journalEntries]);

  useEffect(() => {
    if (!child || !agenda) return;
    persistAgendaPlan(child.childId, agenda, d.reminderStates)
      .then((didPersist) => {
        if (didPersist) void reload();
      })
      .catch(catchLog('timeline', 'action:persist-agenda-plan-failed'));
  }, [child, agenda, d.reminderStates, reload]);

  useEffect(() => {
    if (!child || loading || d.latestMonthlyReport || autoGenTriggered.current) return;
    autoGenTriggered.current = true;
    autoGenerateMonthlyReport(child)
      .then((id) => {
        if (id) void reload();
      })
      .catch(catchLog('timeline', 'action:auto-generate-monthly-report-failed'));
  }, [child, loading, d.latestMonthlyReport, reload]);

  const handleAction = useCallback(async (
    reminder: EnhancedReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today',
    extra?: string | null,
  ) => {
    if (!child) return;
    await applyReminderAction({
      childId: child.childId,
      reminder,
      state: reminder.state,
      action,
      scheduledDate: action === 'schedule' ? extra ?? null : undefined,
      snoozedUntil: action === 'snooze' ? extra ?? null : undefined,
    }).catch(catchLog('timeline', 'action:apply-reminder-action-failed'));
    await reload();
  }, [child, reload]);

  if (!child) {
    return <WelcomePage />;
  }

  if (loading || !agenda || !homeVm) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'transparent' }}>
        <p className="text-sm" style={{ color: C.sub }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full" style={{ background: 'transparent' }}>
      <div className="hide-scrollbar relative min-w-0 flex-1 overflow-y-auto px-6 pb-8" style={{ paddingTop: 28 }}>
        <div className="grid auto-rows-min grid-cols-8 gap-6">
          <ChildContextCard child={child} childList={childList} ageMonths={ageMonths} />
          <RecentChangesHeroCard items={homeVm.recentChanges} />
          <QuickLinksStrip ageMonths={ageMonths} />
          {/* Growth snapshot (left) + Sleep trend & Vision (right, stacked) */}
          <div className="col-span-8 flex gap-6">
            <div className="min-w-0 flex-1 [&>div]:h-full">
              <GrowthSnapshotCard snapshot={homeVm.growthSnapshot} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <div className="flex-1 [&>div]:h-full">
                <SleepTrendCard summary={homeVm.sleepTrend} />
              </div>
              <div className="flex-1 [&>div]:h-full">
                <VisionCard snapshot={homeVm.visionSnapshot} />
              </div>
            </div>
          </div>
          <OutdoorGoalCard records={d.outdoorRecords} goalMinutes={d.outdoorGoalMinutes} />
          {periods.length > 0 ? <StageFocusCard periods={periods} /> : null}
          <MilestoneTimelineCard summary={homeVm.milestoneTimeline} />
          <RecentLinesCard lines={homeVm.recentLines} />
          <ObservationDistributionCard summary={homeVm.observationDistribution} />
          {d.latestMonthlyReport ? <MonthlyReportCard report={d.latestMonthlyReport} /> : null}
        </div>
      </div>

      <ReminderPanel
        todayFocus={todayFocus}
        upcoming={upcoming}
        p0OverflowCount={agenda.p0Overflow.count}
        p0OverflowItems={agenda.p0Overflow.items}
        onboardingCatchupCount={agenda.onboardingCatchup.count}
        onboardingCatchupItems={agenda.onboardingCatchup.items}
        overdueCount={agenda.overdueSummary.count}
        overdueItems={agenda.overdueSummary.items}
        seasonalTasks={seasonalTasks}
        customTodos={d.customTodos}
        childId={child.childId}
        onAction={handleAction}
        onCustomTodoChanged={reload}
        observationNudges={observationNudges}
      />

      {freqModalReminder && child && freqModalReminder.rule.repeatRule && (
        <FrequencyModal
          childId={child.childId}
          ruleId={freqModalReminder.rule.ruleId}
          ruleTitle={freqModalReminder.rule.title}
          currentIntervalMonths={freqModalReminder.rule.repeatRule.intervalMonths}
          existingOverride={null}
          onSaved={() => {
            void reload();
            void reloadFreqOverrides();
          }}
          onClose={() => setFreqModalReminder(null)}
        />
      )}
    </div>
  );
}
