import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
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
import { useDash, buildTimelineHomeViewModel, C, DOMAIN_ROUTES } from './timeline-data.js';
import {
  ChildContextCard,
  GrowthSnapshotCard,
  MonthlyReportCard,
  QuickLinksStrip,
  RecentChangesHeroCard,
  RecentLinesCard,
  StageFocusCard,
} from './timeline-cards.js';
import { autoGenerateMonthlyReport } from '../reports/auto-report.js';
import { FrequencyModal } from '../reminders/frequency-modal.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';

const ACTION_PILL_CLASS = 'inline-flex h-7 min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border-0 px-3 no-underline [appearance:none]';
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
                <Link to={primary.to} className={ACTION_PILL_CLASS} style={{ background: '#94A533', color: '#fff' }}>
                  <span className={ACTION_LABEL_CLASS}>{primary.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                  className={ACTION_PILL_CLASS}
                  style={{ background: '#fafbfa', color: '#8a8f9a' }}
                >
                  <span className={ACTION_LABEL_CLASS}>推迟</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {open && totalCount > items.length && (
        <Link to="/reminders" className="block py-1 text-center text-[10px]" style={{ color: '#b0b8c4' }}>
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
                <Link to={primary.to} className={ACTION_PILL_CLASS} style={{ background: '#94A533', color: '#fff' }}>
                  <span className={ACTION_LABEL_CLASS}>{primary.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                  className={ACTION_PILL_CLASS}
                  style={{ background: '#fafbfa', color: '#8a8f9a' }}
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

function ReminderPanel({
  todayFocus,
  thisWeek,
  p0OverflowCount,
  p0OverflowItems,
  onboardingCatchupCount,
  onboardingCatchupItems,
  overdueCount,
  overdueItems,
  seasonalTasks,
  onAction,
}: {
  todayFocus: EnhancedReminder[];
  thisWeek: EnhancedReminder[];
  p0OverflowCount: number;
  p0OverflowItems: ActiveReminder[];
  onboardingCatchupCount: number;
  onboardingCatchupItems: ActiveReminder[];
  overdueCount: number;
  overdueItems: ActiveReminder[];
  seasonalTasks: DynamicTask[];
  onAction: (
    reminder: EnhancedReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today',
    extra?: string | null,
  ) => void;
}) {
  const [tab, setTab] = useState<'today' | 'week'>('today');
  const items = tab === 'today' ? todayFocus : thisWeek;

  return (
    <div className="hidden w-[300px] shrink-0 flex-col lg:flex" style={{ background: '#fafbfa' }}>
      <div className="px-5 pb-2 pt-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: C.text }}>待办事项</h3>
          <Link to="/reminders" className="text-[11px]" style={{ color: '#b0b8c4' }}>查看全部</Link>
        </div>
        <div className="flex gap-0.5 rounded-full p-0.5" style={{ background: '#eef1ef' }}>
          {([['today', '今天'], ['week', '本周']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="flex-1 rounded-full py-1 text-[11px] font-medium transition-all"
              style={tab === key ? { background: '#fff', color: C.text, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: '#9ca3af' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {items.length === 0 ? (
          <p className="py-10 text-center text-[12px]" style={{ color: '#ccd0d4' }}>暂无事项</p>
        ) : items.map((reminder) => {
          const primary = reminderPrimaryLink(reminder);
          return (
            <div
              key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
              className="group flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-[#f0f2f0]"
            >
              <button
                type="button"
                title="标记完成"
                onClick={() => onAction(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:bg-[#94A533]/15"
                style={{ borderColor: '#94A533' }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#94A533" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium leading-snug" style={{ color: C.text }}>{reminder.rule.title}</p>
                <p className="mt-0.5 text-[10px]" style={{ color: '#9ca3af' }}>{reminderStatus(reminder)}</p>
                <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Link to={primary.to} className={ACTION_PILL_CLASS} style={{ background: '#94A533', color: '#fff' }}>
                    <span className={ACTION_LABEL_CLASS}>{primary.label}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                    className={ACTION_PILL_CLASS}
                    style={{ background: '#fafbfa', color: '#8a8f9a' }}
                  >
                    <span className={ACTION_LABEL_CLASS}>推迟</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

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
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid #ebeeed' }}>
            <p className="mb-1.5 px-2 text-[10px] font-medium" style={{ color: '#d97706' }}>季节关注</p>
            {seasonalTasks.map((task) => (
              <div key={task.id} className="px-2 py-2">
                <p className="text-[11px] font-medium" style={{ color: C.text }}>{task.title}</p>
                <p className="mt-0.5 text-[9px] leading-relaxed" style={{ color: '#b0b8c4' }}>{task.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
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

  const thisWeek: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.thisWeek, allergyProfile) : agenda.thisWeek) : [],
    [agenda, allergyProfile],
  );

  const stageFocus: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.stageFocus, allergyProfile) : agenda.stageFocus) : [],
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ color: C.sub }}>
        <p className="text-lg font-medium">尚未选择孩子</p>
        <Link to="/settings/children" className="text-sm hover:underline" style={{ color: C.text }}>
          管理孩子
        </Link>
      </div>
    );
  }

  if (loading || !agenda || !homeVm) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'transparent' }}>
        <p className="text-sm" style={{ color: C.sub }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ background: 'transparent' }}>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-5" style={{ paddingTop: 86 }}>
        <div className="grid auto-rows-min grid-cols-8 gap-4">
          <ChildContextCard child={child} childList={childList} ageMonths={ageMonths} />
          <RecentChangesHeroCard items={homeVm.recentChanges} />
          <QuickLinksStrip ageMonths={ageMonths} />
          <StageFocusCard periods={periods} reminders={stageFocus} />
          <GrowthSnapshotCard snapshot={homeVm.growthSnapshot} />
          {d.latestMonthlyReport ? (
            <MonthlyReportCard report={d.latestMonthlyReport} />
          ) : (
            <RecentLinesCard lines={homeVm.recentLines.slice(0, 4)} />
          )}
          {d.latestMonthlyReport ? <RecentLinesCard lines={homeVm.recentLines} /> : null}
        </div>
      </div>

      <ReminderPanel
        todayFocus={todayFocus}
        thisWeek={thisWeek}
        p0OverflowCount={agenda.p0Overflow.count}
        p0OverflowItems={agenda.p0Overflow.items}
        onboardingCatchupCount={agenda.onboardingCatchup.count}
        onboardingCatchupItems={agenda.onboardingCatchup.items}
        overdueCount={agenda.overdueSummary.count}
        overdueItems={agenda.overdueSummary.items}
        seasonalTasks={seasonalTasks}
        onAction={handleAction}
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
