import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { REMINDER_RULES, SENSITIVE_PERIODS, MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import { buildAllergyProfile, interceptAllergyCollisions, getActiveSeasonalAlerts, type DynamicTask, type EnhancedReminder } from '../../engine/smart-alerts.js';
import { applyReminderAction, canMarkNotApplicable, defaultSnoozeUntil, persistAgendaPlan } from '../../engine/reminder-actions.js';
import { buildReminderAgenda, getLocalToday, type ActiveReminder } from '../../engine/reminder-engine.js';
import {
  useDash, pctComplete, latestByType, wkActivity, fmtRel,
  C, QLINKS, DOMAIN_ROUTES,
} from './timeline-data.js';
import {
  Cd, Bar, Hdr,
  ChildProfileCard, ChildOverviewCard,
} from './timeline-cards.js';
import { autoGenerateMonthlyReport } from '../reports/auto-report.js';
import { parseReportContent } from '../reports/structured-report.js';
import { FrequencyModal } from '../reminders/frequency-modal.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';

const AGENDA_ACTION_PILL_CLASS = 'inline-flex h-7 min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border-0 px-3 no-underline [appearance:none]';
const AGENDA_ACTION_LABEL_CLASS = 'block text-[11px] leading-none font-medium tracking-[0.01em]';

function reminderPrimaryLink(reminder: ActiveReminder) {
  if (reminder.kind === 'guidance') {
    return {
      label: reminder.rule.actionType === 'observe' ? '去记录' : '开始关注',
      to: `/journal?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}`,
    };
  }

  if (reminder.rule.domain === 'vaccine') {
    return {
      label: reminder.rule.actionType === 'go_hospital' ? '去记录' : '去记录',
      to: `/profile/vaccines?ruleId=${encodeURIComponent(reminder.rule.ruleId)}`,
    };
  }

  if (reminder.rule.actionType === 'record_data' || reminder.rule.domain === 'growth') {
    return { label: '去记录', to: '/profile/growth' };
  }

  return { label: reminder.rule.actionType === 'go_hospital' ? '去记录' : '查看详情', to: DOMAIN_ROUTES[reminder.rule.domain] ?? '/profile' };
}

function reminderStatus(reminder: ActiveReminder) {
  switch (reminder.lifecycle) {
    case 'completed':
      return '已完成';
    case 'scheduled':
      return reminder.state?.scheduledDate ? `已安排 ${reminder.state.scheduledDate}` : '已安排';
    case 'snoozed':
      return reminder.state?.snoozedUntil ? `稍后提醒 ${reminder.state.snoozedUntil}` : '已暂缓';
    case 'overdue':
      return reminder.overdueDays > 0 ? `逾期 ${reminder.overdueDays} 天` : '已逾期';
    case 'due':
      return '今天处理';
    default:
      return reminder.daysUntilStart > 0 ? `${reminder.daysUntilStart} 天后` : '本周关注';
  }
}

function reminderAccent(reminder: ActiveReminder) {
  if (reminder.lifecycle === 'overdue') {
    return { bg: '#fff2ee', fg: '#c56f59' };
  }
  if (reminder.kind === 'guidance') {
    return { bg: '#edf5fc', fg: '#4f7ca9' };
  }
  return { bg: '#eef5d8', fg: C.accent };
}

function reminderGlyph(reminder: ActiveReminder) {
  if (reminder.rule.domain === 'vaccine') return '💉';
  if (reminder.lifecycle === 'overdue') return '⏰';
  if (reminder.kind === 'guidance') return '🌱';
  if (reminder.rule.actionType === 'go_hospital') return '🗓️';
  return '📝';
}

function AgendaPreviewCard({
  title,
  hint,
  items,
  empty,
  action,
  onAdjustFreq,
}: {
  title: string;
  hint?: string;
  items: EnhancedReminder[];
  empty: string;
  action: (reminder: EnhancedReminder, action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today', extra?: string | null) => void;
  onAdjustFreq?: (reminder: EnhancedReminder) => void;
}) {
  return (
    <Cd cls="col-span-4">
      <Hdr title={title} to="/reminders" link="查看全部" />
      {items.length === 0 ? (
        <p className="text-[12px]" style={{ color: C.sub }}>{empty}</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 3).map((reminder) => {
            const primary = reminderPrimaryLink(reminder);
            return (
              <div key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`} className="group relative rounded-[14px] p-3" style={{ background: '#f6f8f5' }}>
                {/* Dismiss button — visible on hover */}
                <button type="button" title="今日不再显示"
                  onClick={() => action(reminder, 'dismiss_today')}
                  className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#e8e5e0]"
                  style={{ color: C.sub }}>✕</button>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: C.text }}>{reminder.rule.title}</p>
                    <p className="text-[10px] mt-1" style={{ color: C.sub }}>{reminderStatus(reminder)}</p>
                    {'allergyWarning' in reminder && reminder.allergyWarning && (
                      <p className="text-[9px] mt-1" style={{ color: '#d97706' }}>
                        {reminder.allergyWarning.message}
                      </p>
                    )}
                  </div>
                  <button type="button" title="标记完成"
                    onClick={() => action(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
                    className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center border-2 transition-colors hover:bg-[#f0f5e6]"
                    style={{ borderColor: C.accent, color: C.accent }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link to={primary.to} className={AGENDA_ACTION_PILL_CLASS} style={{ background: C.accent, color: '#fff' }}>
                    <span className={AGENDA_ACTION_LABEL_CLASS}>{primary.label}</span>
                  </Link>
                  {reminder.kind === 'task' && (
                    <button
                      type="button"
                      onClick={() => {
                        const scheduledDate = window.prompt('请输入已安排日期（YYYY-MM-DD）', getLocalToday());
                        if (scheduledDate) action(reminder, 'schedule', scheduledDate);
                      }}
                      className={AGENDA_ACTION_PILL_CLASS}
                      style={{ background: '#fff', color: C.sub }}
                    >
                      <span className={AGENDA_ACTION_LABEL_CLASS}>已安排</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => action(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                    className={AGENDA_ACTION_PILL_CLASS}
                    style={{ background: '#fff', color: C.sub }}
                  >
                    <span className={AGENDA_ACTION_LABEL_CLASS}>稍后</span>
                  </button>
                  {reminder.rule.repeatRule && onAdjustFreq && (
                    <button type="button" onClick={() => onAdjustFreq(reminder)}
                      className={AGENDA_ACTION_PILL_CLASS}
                      style={{ background: '#fff', color: C.sub }}>
                      <span className={AGENDA_ACTION_LABEL_CLASS}>调整</span>
                    </button>
                  )}
                  {canMarkNotApplicable(reminder) && (
                    <button
                      type="button"
                      onClick={() => action(reminder, 'mark_not_applicable')}
                      className="px-2.5 py-1 rounded-full text-[10px]"
                      style={{ background: '#fff', color: '#a16b5d' }}
                    >
                      {reminder.kind === 'task' ? '不打算做' : '不适用'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Cd>
  );
}

function OverdueGroup({ items, totalCount, onAction }: {
  items: ActiveReminder[];
  totalCount: number;
  onAction: (reminder: ActiveReminder, action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today', extra?: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mx-2 mt-4">
      {/* Header — clickable toggle */}
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left mb-1 group">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
        <span className="text-[10px] font-semibold" style={{ color: '#d97706' }}>逾期</span>
        <span className="text-[9px] px-1.5 py-[1px] rounded-full font-medium" style={{ background: '#fef3c7', color: '#b45309' }}>{totalCount}</span>
      </button>
      {/* Items */}
      {open && items.map((reminder) => {
        const primary = reminderPrimaryLink(reminder);
        return (
          <div key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
            className="group flex items-start gap-2.5 px-2 py-2.5 rounded-lg transition-colors hover:bg-[#fefbf5] cursor-default">
            {/* Orange circle */}
            <button type="button" title="标记完成"
              onClick={() => onAction(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
              className="w-[18px] h-[18px] mt-[1px] shrink-0 rounded-full border-[1.5px] flex items-center justify-center transition-all hover:bg-[#f59e0b]/15"
              style={{ borderColor: '#f59e0b' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                className="opacity-0 group-hover:opacity-100 transition-opacity"><path d="M20 6L9 17l-5-5" /></svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium leading-snug" style={{ color: C.text }}>{reminder.rule.title}</p>
              <p className="text-[10px] mt-0.5" style={{ color: '#f59e0b' }}>{reminderStatus(reminder)}</p>
              {/* Actions */}
              <div className="flex items-center gap-2 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link to={primary.to}
                  className={`${AGENDA_ACTION_PILL_CLASS} transition-all hover:opacity-90`}
                  style={{ background: '#94A533', color: '#fff' }}>
                  <span className={AGENDA_ACTION_LABEL_CLASS}>{primary.label}</span>
                </Link>
                <button type="button"
                  onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                  className={`${AGENDA_ACTION_PILL_CLASS} transition-all hover:opacity-80`}
                  style={{ background: '#fafbfa', color: '#8a8f9a' }}>
                  <span className={AGENDA_ACTION_LABEL_CLASS}>稍后</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {open && totalCount > items.length && (
        <Link to="/reminders" className="block text-[10px] text-center py-1 transition-colors hover:text-[#6b7280]" style={{ color: '#b0b8c4' }}>
          查看全部 {totalCount} 项 →
        </Link>
      )}
    </div>
  );
}

function ReminderPanel({
  todayFocus,
  thisWeek,
  overdueCount,
  overdueItems,
  seasonalTasks,
  onAction,
  onAdjustFreq,
}: {
  todayFocus: EnhancedReminder[];
  thisWeek: EnhancedReminder[];
  overdueCount: number;
  overdueItems: ActiveReminder[];
  seasonalTasks: DynamicTask[];
  onAction: (reminder: EnhancedReminder, action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today', extra?: string | null) => void;
  onAdjustFreq?: (reminder: EnhancedReminder) => void;
}) {
  const [tab, setTab] = useState<'today' | 'week'>('today');
  const items = tab === 'today' ? todayFocus : thisWeek;

  return (
    <div className="hidden lg:flex w-[280px] shrink-0 flex-col" style={{ background: '#fafbfa' }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-2">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: C.text }}>议程</h3>
          <Link to="/reminders" className="text-[11px] transition-colors hover:text-[#1a2b4a]" style={{ color: '#b0b8c4' }}>全部</Link>
        </div>
        {/* Tabs */}
        <div className="flex gap-0.5 rounded-full p-0.5" style={{ background: '#eef1ef' }}>
          {([['today', '今日'], ['week', '本周']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="flex-1 text-[11px] py-1 rounded-full font-medium transition-all"
              style={tab === key ? { background: '#fff', color: C.text, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: '#9ca3af' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {items.length === 0 ? (
          <p className="text-[12px] text-center py-10" style={{ color: '#ccd0d4' }}>暂无事项</p>
        ) : items.map((reminder) => {
          const primary = reminderPrimaryLink(reminder);
          return (
            <div key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
              className="group flex items-start gap-2.5 px-2 py-2.5 rounded-lg transition-colors hover:bg-[#f0f2f0] cursor-default">
              {/* Checkbox */}
              <button type="button" title="标记完成"
                onClick={() => onAction(reminder, reminder.kind === 'guidance' ? 'acknowledge' : 'complete')}
                className="w-[18px] h-[18px] mt-[1px] shrink-0 rounded-full border-[1.5px] flex items-center justify-center transition-all hover:bg-[#94A533]/15"
                style={{ borderColor: '#94A533' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#94A533" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"><path d="M20 6L9 17l-5-5" /></svg>
              </button>
              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium leading-snug" style={{ color: C.text }}>{reminder.rule.title}</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#9ca3af' }}>{reminderStatus(reminder)}</p>
                {/* Actions — visible on hover */}
                <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={primary.to}
                    className={`${AGENDA_ACTION_PILL_CLASS} transition-all hover:opacity-90`}
                    style={{ background: '#94A533', color: '#fff' }}>
                    <span className={AGENDA_ACTION_LABEL_CLASS}>{primary.label}</span>
                  </Link>
                  <button type="button"
                    onClick={() => onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()))}
                    className={`${AGENDA_ACTION_PILL_CLASS} transition-all hover:opacity-80`}
                    style={{ background: '#fafbfa', color: '#8a8f9a' }}>
                    <span className={AGENDA_ACTION_LABEL_CLASS}>稍后</span>
                  </button>
                  {reminder.rule.repeatRule && onAdjustFreq && (
                    <button type="button" onClick={() => onAdjustFreq(reminder)}
                      className={`${AGENDA_ACTION_PILL_CLASS} transition-all hover:opacity-80`}
                      style={{ background: '#fafbfa', color: '#8a8f9a' }}>
                      <span className={AGENDA_ACTION_LABEL_CLASS}>调整</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Overdue group — collapsible */}
        {overdueCount > 0 && <OverdueGroup items={overdueItems} totalCount={overdueCount} onAction={onAction} />}

        {/* Seasonal */}
        {seasonalTasks.length > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid #ebeeed' }}>
            <p className="text-[10px] font-medium mb-1.5 px-2" style={{ color: '#d97706' }}>季节性</p>
            {seasonalTasks.map((task) => (
              <div key={task.id} className="px-2 py-2">
                <p className="text-[11px] font-medium" style={{ color: C.text }}>{task.title}</p>
                <p className="text-[9px] mt-0.5 leading-relaxed" style={{ color: '#b0b8c4' }}>{task.description}</p>
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
  const child = childList.find((c) => c.childId === activeChildId);
  const { d, loading, reload } = useDash(activeChildId);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();

  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
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

  useEffect(() => {
    if (!child || !agenda) return;
    persistAgendaPlan(child.childId, agenda, d.reminderStates).then((didPersist) => {
      if (didPersist) {
        void reload();
      }
    }).catch(catchLog('timeline', 'action:persist-agenda-plan-failed'));
  }, [child, agenda, d.reminderStates, reload]);

  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (!child || loading || d.latestMonthlyReport || autoGenTriggered.current) return;
    autoGenTriggered.current = true;
    autoGenerateMonthlyReport(child).then((id) => { if (id) reload(); }).catch(catchLog('timeline', 'action:auto-generate-monthly-report-failed'));
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
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: C.sub }}>
        <p className="text-lg font-medium">请先添加孩子</p>
        <Link to="/settings/children" className="text-sm hover:underline" style={{ color: C.text }}>前往添加</Link>
      </div>
    );
  }

  if (loading || !agenda) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'transparent' }}>
        <p className="text-sm" style={{ color: C.sub }}>加载中...</p>
      </div>
    );
  }

  const pct = pctComplete(child);
  const ageY = Math.floor(ageMonths / 12);
  const ageR = ageMonths % 12;
  const vacTotal = REMINDER_RULES.filter((r) => r.domain === 'vaccine').length;
  const latest = latestByType(d.measurements);
  const wk = wkActivity(d.journalEntries, d.measurements, d.sleepRecords);
  const periods = SENSITIVE_PERIODS.filter((p) => ageMonths >= p.ageRange.startMonths && ageMonths <= p.ageRange.endMonths);
  const achIds = new Set(d.milestoneRecords.filter((r) => r.achievedAt).map((r) => r.milestoneId));
  const relMs = MILESTONE_CATALOG.filter((m) => m.typicalAge.rangeStart <= ageMonths);
  const msPct = relMs.length > 0 ? Math.round((relMs.filter((m) => achIds.has(m.milestoneId)).length / relMs.length) * 100) : 0;
  const slPct = Math.round((Math.min(d.sleepRecords.length, 7) / 7) * 100);
  const vacPct = vacTotal > 0 ? Math.round((d.vaccineCount / vacTotal) * 100) : 0;

  const MEAS: Record<string, { label: string; unit: string }> = {
    height: { label: '身高', unit: 'cm' },
    weight: { label: '体重', unit: 'kg' },
    'head-circumference': { label: '头围', unit: 'cm' },
    bmi: { label: 'BMI', unit: '' },
  };

  return (
    <div className="flex h-full" style={{ background: 'transparent' }}>
      <div className="flex-1 overflow-y-auto px-5 pb-5 min-w-0" style={{ paddingTop: 86 }}>
        <div className="grid grid-cols-8 gap-4 auto-rows-min">
          <ChildProfileCard child={child} childList={childList} ageY={ageY} ageR={ageR} pct={pct} />
          <ChildOverviewCard latest={latest} vacPct={vacPct} vaccineCount={d.vaccineCount} vacTotal={vacTotal} msPct={msPct} sleepDays={d.sleepRecords.length} measurements={d.measurements} />

          <Cd cls="col-span-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>快捷入口</h3>
              <Link to="/journal" className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-medium transition-all hover:opacity-80" style={{ background: C.cardProfile, color: '#fff', boxShadow: '0 2px 8px rgba(134,175,218,0.4)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                记录观察笔记
              </Link>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {QLINKS.map((item) => (
                <Link key={item.to} to={item.to} className="group flex flex-col items-center gap-1.5 py-2 transition-transform duration-200 hover:-translate-y-1">
                  <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[24px] bg-[#f5f6f4] transition-all duration-200 group-hover:bg-[#e6e8e4] group-hover:shadow-md">
                    {item.emoji}
                  </div>
                  <span className="text-[10px]" style={{ color: C.sub }}>{item.l}</span>
                </Link>
              ))}
            </div>
          </Cd>

          {d.latestMonthlyReport && (() => {
            try {
              const content = parseReportContent(d.latestMonthlyReport.content);
              const teaser = content.version === 2 ? content.teaser : (content.overview?.slice(0, 2).join(' ') ?? '');
              const monthLabel = new Date().toLocaleDateString('zh-CN', { month: 'long' });
              return (
                <Cd cls="col-span-4">
                  <Hdr title={`${monthLabel}成长摘要`} to="/reports" link="查看完整报告 →" />
                  <p className="text-[12px] leading-[1.7]" style={{ color: C.text }}>{teaser}</p>
                  {content.version === 2 && content.actionItems.length > 0 && (
                    <div className="mt-2.5 pt-2" style={{ borderTop: '1px solid #eef3f1' }}>
                      <p className="text-[11px] font-medium" style={{ color: C.sub }}>
                        待办：{content.actionItems[0]!.text}
                      </p>
                    </div>
                  )}
                </Cd>
              );
            } catch {
              return null;
            }
          })()}

          {(() => {
            const hasGrowth = (['height', 'weight', 'head-circumference', 'bmi'] as const).some((key) => latest.has(key));
            return (
              <Cd cls="col-span-3">
                <Hdr title="生长曲线" to="/profile/growth" link={hasGrowth ? '详情 →' : '+'} />
                {hasGrowth ? (
                  <div className="space-y-2">
                    {(['height', 'weight', 'head-circumference', 'bmi'] as const).map((key) => {
                      const measurement = latest.get(key);
                      const meta = MEAS[key] ?? { label: key, unit: '' };
                      return (
                        <div key={key} className="flex items-center justify-between">
                          <span className="text-[11px]" style={{ color: C.sub }}>{meta.label}</span>
                          {measurement ? (
                            <span className="text-[13px] font-bold" style={{ color: C.text }}>
                              {measurement.value}
                              <span className="text-[10px] font-normal ml-0.5" style={{ color: C.sub }}>{meta.unit}</span>
                            </span>
                          ) : (
                            <Link to="/profile/growth" className="text-[10px] hover:underline" style={{ color: C.text }}>+</Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-4">
                    <span className="text-[28px]">🌱</span>
                    <p className="text-[11px] mt-2" style={{ color: C.sub }}>等待记录成长的足迹...</p>
                  </div>
                )}
              </Cd>
            );
          })()}

          <Cd cls="col-span-4">
            {periods.length > 0 ? (
              <>
                <Hdr title="当前敏感期" to="/journal" link="去观察 →" />
                <div className="space-y-2.5">
                  {periods.slice(0, 4).map((period) => {
                    const peak = ageMonths >= period.ageRange.peakMonths - 3 && ageMonths <= period.ageRange.peakMonths + 3;
                    return (
                      <div key={period.periodId} className="flex items-start gap-2">
                        <div className="mt-[7px] w-[6px] h-[6px] rounded-full shrink-0" style={{ background: peak ? '#e6a23c' : '#d4d1cc' }} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium" style={{ color: C.text }}>
                            {period.title}
                            {peak && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">高峰</span>}
                          </p>
                          <p className="text-[10px] mt-0.5 truncate" style={{ color: C.sub }}>{period.observableSigns[0]}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <Hdr title="最近日记" to="/journal" link="查看全部 →" />
                {d.journalEntries.length === 0 ? (
                  <div className="flex flex-col items-center py-4">
                    <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[24px]" style={{ background: '#f5f6f4' }}>📝</div>
                    <p className="text-[11px] mt-2" style={{ color: C.sub }}>还没有日记</p>
                    <Link to="/journal" className="text-[11px] mt-1 hover:underline" style={{ color: C.text }}>写一篇 →</Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {d.journalEntries.slice(0, 4).map((entry) => (
                      <div key={entry.entryId} className="flex items-start gap-2">
                        <div className="mt-[7px] w-[5px] h-[5px] rounded-full shrink-0" style={{ background: C.accent }} />
                        <div className="min-w-0">
                          <p className="text-[12px] truncate" style={{ color: C.text }}>{entry.textContent?.slice(0, 50) ?? (entry.contentType === 'voice' ? '语音记录' : '照片记录')}</p>
                          <p className="text-[10px]" style={{ color: '#c0bdb8' }}>{fmtRel(entry.recordedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Cd>

          <Cd cls="col-span-4">
            <Hdr title="成长目标" />
            <div className="space-y-3">
              {[
                { label: '发育里程碑', value: msPct },
                { label: '健康档案', value: pct },
                { label: '睡眠习惯', value: slPct },
                { label: '疫苗进度', value: vacPct },
              ].map((goal) => (
                <div key={goal.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px]" style={{ color: C.sub }}>{goal.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: C.text }}>{goal.value}%</span>
                  </div>
                  <Bar pct={goal.value} h={6} />
                </div>
              ))}
            </div>
          </Cd>

          {d.journalEntries.length > 0 && (
            <Cd cls="col-span-8">
              <Hdr title="最近记录" to="/journal" />
              <div className="flex gap-3 overflow-x-auto">
                {d.journalEntries.slice(0, 5).map((entry) => (
                  <div key={entry.entryId} className="shrink-0 w-[160px] rounded-[14px] p-3" style={{ background: '#f5f3ef' }}>
                    <p className="text-[11px] mb-1" style={{ color: '#c0bdb8' }}>{fmtRel(entry.recordedAt)}</p>
                    <p className="text-[12px] line-clamp-2" style={{ color: C.text }}>{entry.textContent?.slice(0, 60) ?? (entry.contentType === 'voice' ? '语音记录' : '照片记录')}</p>
                  </div>
                ))}
              </div>
            </Cd>
          )}
        </div>
      </div>

      <ReminderPanel
        todayFocus={todayFocus}
        thisWeek={thisWeek}
        overdueCount={agenda.overdueSummary.count}
        overdueItems={agenda.overdueSummary.items}
        seasonalTasks={seasonalTasks}
        onAction={handleAction}
        onAdjustFreq={setFreqModalReminder}
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
