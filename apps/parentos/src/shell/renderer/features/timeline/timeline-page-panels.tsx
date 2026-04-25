import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { canMarkNotApplicable, defaultSnoozeUntil, type ReminderActionType } from '../../engine/reminder-actions.js';
import { getLocalToday, type ActiveReminder } from '../../engine/reminder-engine.js';
import { ReminderExplainDrawer } from '../reminders/reminder-explain-drawer.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import type { DynamicTask, EnhancedReminder } from '../../engine/smart-alerts.js';
import { C, DOMAIN_ROUTES } from './timeline-data.js';
import { CustomTodoComposer, CustomTodoInlineList } from './timeline-custom-todos.js';
import { TimelineReminderRow } from './timeline-reminder-row.js';
import type { ObservationNudge } from './timeline-observation-nudges.js';

export { CustomTodoComposer, CustomTodoInlineList } from './timeline-custom-todos.js';

const ACTION_PILL_CLASS = 'inline-flex h-7 min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border-0 px-3 no-underline [appearance:none] transition-colors';
const ACTION_LABEL_CLASS = 'block text-[11px] leading-none font-medium tracking-[0.01em]';

function reminderPrimaryLink(reminder: ActiveReminder) {
  // W5b will replace this Link-based primary with the ReminderExplainDrawer trigger.
  // For W4a we only normalize the kind dispatch to the 4-kind taxonomy.
  if (reminder.kind === 'consult') {
    return {
      label: '问问 AI 顾问',
      to: `/advisor?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}`,
    };
  }

  if (reminder.kind === 'practice') {
    return {
      label: '打开笔记',
      to: `/journal?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}`,
    };
  }

  if (reminder.kind === 'guide') {
    return {
      label: '查看指南',
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
    action: ReminderActionType,
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
              onClick={() => onAction(reminder, reminder.kind === 'task' ? 'complete' : 'acknowledge')}
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
    action: ReminderActionType,
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
              onClick={() => onAction(reminder, reminder.kind === 'task' ? 'complete' : 'acknowledge')}
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

// `ReminderRow` extracted to `timeline-reminder-row.tsx` for AI-context file-
// size hygiene. It handles kind-scoped row rendering including the task-only
// check circle quick-complete, kind glyphs for non-task kinds, and progression
// notes (已了解 / 实践中 · 已 N 次 / 已咨询).

export function ReminderPanel({
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
    action: ReminderActionType,
    extra?: string | null,
  ) => void;
  onCustomTodoChanged: () => void;
  observationNudges: ObservationNudge[];
}) {
  const defaultTab = todayFocus.length > 0 ? 'today' : 'upcoming';
  const [tab, setTab] = useState<'today' | 'upcoming'>(defaultTab);
  const [optimisticTodo, setOptimisticTodo] = useState<CustomTodoRow | null>(null);
  const [animatedTodoId, setAnimatedTodoId] = useState<string | null>(null);
  const [activeReminder, setActiveReminder] = useState<ActiveReminder | null>(null);

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
      <div className="mb-5 flex items-center justify-between px-3">
        <h3 className="text-[18px] font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>待办事项</h3>
        <Link to="/reminders" className="text-[11px] font-medium" style={{ color: '#475569' }}>查看全部</Link>
      </div>

      {showTabs && (
        <div className="mx-3 mb-5 flex gap-0.5 rounded-full p-[3px]" style={{ background: 'rgba(0,0,0,0.04)' }}>
          {([
            ['today', '今天', todayFocus.length],
            ['upcoming', '近期 7 天', upcoming.length],
          ] as const).map(([key, label, count]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-[6px] text-[11px] font-bold transition-all"
                style={active ? { background: '#fff', color: '#1e293b', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' } : { color: '#9CA0A6' }}
              >
                <span>{label}</span>
                {count > 0 && (
                  <span
                    className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                    style={active
                      ? { background: 'rgba(78, 204, 163, 0.15)', color: '#3BB88A' }
                      : { background: 'rgba(0,0,0,0.06)', color: '#9CA0A6' }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-2 px-1">
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

      <div className="flex-1 overflow-y-auto px-1">
        {items.length === 0 ? (
          <p className="py-10 text-center text-[12px]" style={{ color: '#64748b' }}>暂无事项</p>
        ) : (
          <>
            {items.map((reminder) => (
              <TimelineReminderRow
                key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
                reminder={reminder}
                onOpen={() => setActiveReminder(reminder)}
                onAction={onAction}
                statusLabel={reminderStatus(reminder)}
              />
            ))}
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

      <ReminderExplainDrawer
        reminder={activeReminder}
        onClose={() => setActiveReminder(null)}
        onAction={(reminder, action, extra) => {
          onAction(reminder, action, extra);
        }}
      />
    </div>
  );
}
