import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { getReminderStates } from '../../bridge/sqlite-bridge.js';
import {
  buildReminderAgenda,
  getLocalToday,
  mapReminderStateRow,
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
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';

const C = {
  bg: '#E5ECEA',
  card: '#ffffff',
  text: '#1a2b4a',
  sub: '#8a8f9a',
  accent: '#9aac2f',
  accentSoft: '#eef5d8',
  sky: '#86AFDA',
  skySoft: '#edf5fc',
  warm: '#c56f59',
  warmSoft: '#fff2ee',
  border: '#e8ebe7',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
} as const;

const DOMAIN_LABELS: Record<string, string> = {
  vaccine: '疫苗',
  growth: '生长',
  vision: '视力',
  dental: '口腔',
  sleep: '睡眠',
  'bone-age': '骨龄',
  checkup: '体检',
  nutrition: '营养',
  safety: '安全',
  language: '语言',
  motor: '运动',
};

function useReminderStates(childId: string | null) {
  const [states, setStates] = useState<ReminderState[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!childId) {
      setStates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await getReminderStates(childId);
      setStates(rows.map(mapReminderStateRow));
    } catch {
      setStates([]);
    }
    setLoading(false);
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { states, loading, reload: load };
}

function primaryAction(reminder: ActiveReminder) {
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

  if (reminder.rule.domain === 'growth' || reminder.rule.actionType === 'record_data') {
    return { label: '去记录', to: '/profile/growth' };
  }

  return {
    label: reminder.rule.actionType === 'go_hospital' ? '去记录' : '查看详情',
    to: '/profile',
  };
}

function reminderTone(reminder: ActiveReminder) {
  if (reminder.lifecycle === 'overdue') {
    return { bg: C.warmSoft, fg: C.warm, edge: '#efc4b8' };
  }
  if (reminder.kind === 'guidance') {
    return { bg: C.skySoft, fg: '#4f7ca9', edge: '#cadeee' };
  }
  return { bg: C.accentSoft, fg: C.accent, edge: '#dbe8b4' };
}

function reminderIcon(reminder: ActiveReminder) {
  if (reminder.rule.domain === 'vaccine') return '💉';
  if (reminder.lifecycle === 'overdue') return '⏰';
  if (reminder.kind === 'guidance') return '🌱';
  if (reminder.rule.actionType === 'go_hospital') return '🗓️';
  return '📝';
}

function statusLabel(reminder: ActiveReminder) {
  switch (reminder.lifecycle) {
    case 'completed':
      return '已完成';
    case 'scheduled':
      return reminder.state?.scheduledDate ? `已安排 ${reminder.state.scheduledDate}` : '已安排';
    case 'snoozed':
      return reminder.state?.snoozedUntil ? `稍后提醒 ${reminder.state.snoozedUntil}` : '已暂缓';
    case 'overdue':
      return reminder.overdueDays > 0 ? `已逾期 ${reminder.overdueDays} 天` : '已逾期';
    case 'due':
      return '今天处理';
    default:
      return reminder.daysUntilStart > 0 ? `${reminder.daysUntilStart} 天后` : '本周关注';
  }
}

function historyLabel(item: ReminderHistoryItem) {
  switch (item.historyType) {
    case 'completed':
      return '已完成';
    case 'scheduled':
      return item.state?.scheduledDate ? `已安排 ${item.state.scheduledDate}` : '已安排';
    case 'snoozed':
      return item.state?.snoozedUntil ? `暂缓到 ${item.state.snoozedUntil}` : '已暂缓';
    case 'not_applicable':
      return '不适用';
  }
}

function reasonLine(reminder: ActiveReminder) {
  if (reminder.lifecycle === 'overdue') {
    return '已经过了建议窗口，优先把这件事补上，避免继续被旧事项反复打扰。';
  }
  if (reminder.kind === 'task') {
    return reminder.rule.description;
  }
  return '这是当前阶段值得观察或记录的主题，不需要今天完成，但本周最好留意一次。';
}

function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: { bg: string; fg: string };
}) {
  return (
    <div className="rounded-[18px] p-4 border" style={{ background: tone.bg, borderColor: `${tone.fg}20` }}>
      <p className="text-[11px] font-semibold tracking-[0.06em]" style={{ color: tone.fg }}>{label}</p>
      <p className="text-[26px] font-bold mt-2 leading-none" style={{ color: C.text }}>{value}</p>
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: C.sub }}>{hint}</p>
    </div>
  );
}

function SectionCard({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[20px] p-5" style={{ background: C.card, boxShadow: C.shadow }}>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: C.text }}>{title}</h2>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: C.sub }}>{hint}</p>
        </div>
        {typeof count === 'number' && (
          <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: '#f3f5f1', color: C.sub }}>
            {count} 项
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function TodayHero({
  reminder,
  onComplete,
}: {
  reminder: ActiveReminder | null;
  onComplete: (reminder: ActiveReminder) => void;
}) {
  if (!reminder) {
    return (
      <div className="rounded-[20px] p-5 border" style={{ background: '#fff', borderColor: C.border }}>
        <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: C.accent }}>TODAY'S AGENDA</p>
        <h2 className="text-[22px] font-bold mt-2" style={{ color: C.text }}>今天节奏比较轻</h2>
        <p className="text-[12px] mt-2 leading-relaxed" style={{ color: C.sub }}>
          没有新的硬性任务压着你，可以把时间留给陪伴、观察和补记录。
        </p>
      </div>
    );
  }

  const tone = reminderTone(reminder);
  const primary = primaryAction(reminder);
  return (
    <div className="rounded-[20px] p-5 border" style={{ background: '#fff', borderColor: C.border }}>
      <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: tone.fg }}>TODAY'S AGENDA</p>
      <h2 className="text-[22px] font-bold mt-2" style={{ color: C.text }}>今天最值得先处理的事</h2>
      <p className="text-[12px] mt-2 leading-relaxed" style={{ color: C.sub }}>
        先把这一项推进就够了。P0 事项不会被隐藏，其他任务已经按优先级帮你做过降噪。
      </p>

      <div className="mt-4 rounded-[18px] p-4" style={{ background: tone.bg }}>
        <div className="flex items-center gap-2 text-[11px] font-medium" style={{ color: tone.fg }}>
          <span>{reminderIcon(reminder)}</span>
          <span>{statusLabel(reminder)}</span>
        </div>
        <p className="text-[16px] font-semibold mt-2" style={{ color: C.text }}>{reminder.rule.title}</p>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: C.sub }}>{reasonLine(reminder)}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Link to={primary.to} className="px-3.5 py-2 rounded-full text-[11px] font-medium text-white" style={{ background: C.accent }}>
            {primary.label}
          </Link>
          <button type="button" title="标记完成" onClick={() => onComplete(reminder)}
            className="w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors hover:bg-[#f0f5e6]"
            style={{ borderColor: '#c0bdb8', color: '#c0bdb8' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ReminderRow({
  reminder,
  onComplete,
  onSnooze,
  onSchedule,
  onNotApplicable,
  onAdjustFrequency,
}: {
  reminder: ActiveReminder;
  onComplete: (reminder: ActiveReminder) => void;
  onSnooze: (reminder: ActiveReminder) => void;
  onSchedule: (reminder: ActiveReminder) => void;
  onNotApplicable: (reminder: ActiveReminder) => void;
  onAdjustFrequency?: (reminder: ActiveReminder) => void;
}) {
  const primary = primaryAction(reminder);
  const domain = DOMAIN_LABELS[reminder.rule.domain] ?? reminder.rule.domain;
  const tone = reminderTone(reminder);

  return (
    <div className="rounded-[18px] border p-4 relative overflow-hidden" style={{ borderColor: tone.edge, background: '#fbfcfa' }}>
      <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: tone.fg }} />
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>
              <span>{reminderIcon(reminder)}</span>
              {domain}
            </span>
            <span className="text-[10px]" style={{ color: C.sub }}>{statusLabel(reminder)}</span>
            <span className="text-[10px] font-semibold" style={{ color: tone.fg }}>{reminder.rule.priority}</span>
          </div>
          <h3 className="text-[14px] font-semibold leading-snug" style={{ color: C.text }}>{reminder.rule.title}</h3>
          <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: C.sub }}>{reasonLine(reminder)}</p>
        </div>
        <button type="button" title="标记完成" onClick={() => onComplete(reminder)}
          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center border-2 transition-colors hover:bg-[#f0f5e6]"
          style={{ borderColor: '#c0bdb8', color: '#c0bdb8' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 pl-1">
        <Link to={primary.to} className="px-3 py-1.5 rounded-full text-[11px] font-medium text-white" style={{ background: C.accent }}>
          {primary.label}
        </Link>
        {reminder.kind === 'task' && (
          <button
            type="button"
            onClick={() => onSchedule(reminder)}
            className="px-3 py-1.5 rounded-full text-[11px]"
            style={{ background: '#f7f7f5', color: C.sub }}
          >
            已安排
          </button>
        )}
        <button
          type="button"
          onClick={() => onSnooze(reminder)}
          className="px-3 py-1.5 rounded-full text-[11px]"
          style={{ background: '#f7f7f5', color: C.sub }}
        >
          稍后提醒
        </button>
        {reminder.rule.repeatRule && onAdjustFrequency && (
          <button
            type="button"
            onClick={() => onAdjustFrequency(reminder)}
            className="px-3 py-1.5 rounded-full text-[11px]"
            style={{ background: '#f7f7f5', color: C.sub }}
          >
            调整频率
          </button>
        )}
        {canMarkNotApplicable(reminder) && (
          <button
            type="button"
            onClick={() => onNotApplicable(reminder)}
            className="px-3 py-1.5 rounded-full text-[11px]"
            style={{ background: '#f7f7f5', color: '#a16b5d' }}
          >
            {reminder.kind === 'task' ? '不打算做' : '不适用'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RemindersPage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((item) => item.childId === activeChildId);
  const { states, loading, reload } = useReminderStates(activeChildId);
  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();
  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
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
    void reloadFreqOverrides().catch(catchLogThen('reminders', 'action:load-freq-overrides-failed', () => setFreqOverrides(new Map())));
  }, [reloadFreqOverrides]);

  const agenda = useMemo(() => {
    if (!child) return null;
    return buildReminderAgenda(REMINDER_RULES, {
      birthDate: child.birthDate,
      gender: child.gender,
      ageMonths,
      localToday,
      nurtureMode: child.nurtureMode,
      domainOverrides: child.nurtureModeOverrides,
    }, states, freqOverrides);
  }, [child, ageMonths, localToday, states, freqOverrides]);

  useEffect(() => {
    if (!child || !agenda) return;
    persistAgendaPlan(child.childId, agenda, states).then((didPersist) => {
      if (didPersist) {
        void reload();
      }
    }).catch(catchLog('reminders', 'action:persist-agenda-plan-failed'));
  }, [child, agenda, states, reload]);

  const handleAction = useCallback(async (
    reminder: ActiveReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable',
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
    }).catch(catchLog('reminders', 'action:apply-reminder-action-failed'));
    await reload();
  }, [child, reload]);

  const handleSchedule = useCallback((reminder: ActiveReminder) => {
    const suggestion = reminder.state?.scheduledDate ?? localToday;
    const scheduledDate = window.prompt('请输入已安排日期（YYYY-MM-DD）', suggestion);
    if (!scheduledDate) return;
    void handleAction(reminder, 'schedule', scheduledDate);
  }, [handleAction, localToday]);

  if (!child) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: C.sub }}>
        <p className="text-lg font-medium">请先添加孩子</p>
        <Link to="/timeline" className="text-sm hover:underline" style={{ color: C.text }}>返回首页</Link>
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

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
      <div className="max-w-[920px] mx-auto px-5 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <Link to="/timeline" className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/[0.04]" style={{ color: C.text }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-[20px] font-bold" style={{ color: C.text }}>提醒事项</h1>
            <p className="text-[12px] mt-1" style={{ color: C.sub }}>
              今天重点 {agenda.todayFocus.length} 项，本周安排 {agenda.thisWeek.length} 项，历史 {agenda.history.length} 项
            </p>
          </div>
        </div>

        <section className="rounded-[24px] p-5 md:p-6" style={{ background: 'linear-gradient(135deg, #f7fbef 0%, #ffffff 52%, #f5fafc 100%)', boxShadow: C.shadow }}>
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-4 items-stretch">
            <TodayHero
              reminder={agenda.todayFocus[0] ?? null}
              onComplete={(item) => void handleAction(item, item.kind === 'guidance' ? 'acknowledge' : 'complete')}
            />
            <div className="grid grid-cols-1 gap-3">
              <SummaryTile label="今日重点" value={String(agenda.todayFocus.length)} hint="需要今天决定或推进的事项" tone={{ bg: C.accentSoft, fg: C.accent }} />
              <SummaryTile label="本周安排" value={String(agenda.thisWeek.length)} hint="先安排起来，别等到临门一脚" tone={{ bg: C.skySoft, fg: '#4f7ca9' }} />
              <SummaryTile label="逾期摘要" value={String(agenda.overdueSummary.count)} hint="旧事项已收折，不再压满主视图" tone={{ bg: C.warmSoft, fg: C.warm }} />
            </div>
          </div>
        </section>

        <SectionCard count={agenda.todayFocus.length} title="今日重点" hint="真正值得今天处理的事项。P0 会全部出现，其他事项按模式做过限流。">
          <div className="space-y-3">
            {agenda.todayFocus.length === 0 ? (
              <p className="text-[12px]" style={{ color: C.sub }}>今天没有新的重点事项。</p>
            ) : agenda.todayFocus.map((reminder) => (
              <ReminderRow
                key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
                reminder={reminder}
                onComplete={(item) => void handleAction(item, item.kind === 'guidance' ? 'acknowledge' : 'complete')}
                onSnooze={(item) => void handleAction(item, 'snooze', defaultSnoozeUntil(item.kind, localToday))}
                onSchedule={handleSchedule}
                onNotApplicable={(item) => void handleAction(item, 'mark_not_applicable')}
                onAdjustFrequency={(item) => setFreqModalReminder(item)}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard count={agenda.thisWeek.length} title="本周安排" hint="快到窗口、但不需要今天立刻处理的任务。先安排起来会更轻松。">
          <div className="space-y-3">
            {agenda.thisWeek.length === 0 ? (
              <p className="text-[12px]" style={{ color: C.sub }}>本周没有待安排的新任务。</p>
            ) : agenda.thisWeek.map((reminder) => (
              <ReminderRow
                key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`}
                reminder={reminder}
                onComplete={(item) => void handleAction(item, item.kind === 'guidance' ? 'acknowledge' : 'complete')}
                onSnooze={(item) => void handleAction(item, 'snooze', defaultSnoozeUntil(item.kind, localToday))}
                onSchedule={handleSchedule}
                onNotApplicable={(item) => void handleAction(item, 'mark_not_applicable')}
                onAdjustFrequency={(item) => setFreqModalReminder(item)}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard count={agenda.stageFocus.length} title="阶段关注" hint="这些是本阶段值得观察或记录的主题，不是必须今天完成的待办。">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agenda.stageFocus.length === 0 ? (
              <p className="text-[12px]" style={{ color: C.sub }}>当前阶段没有额外的关注主题。</p>
            ) : agenda.stageFocus.map((reminder) => {
              const primary = primaryAction(reminder);
              const domain = DOMAIN_LABELS[reminder.rule.domain] ?? reminder.rule.domain;
              const tone = reminderTone(reminder);
              return (
                <div key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`} className="rounded-[18px] p-4 border" style={{ borderColor: tone.edge, background: '#fbfcfa' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] px-2.5 py-1 rounded-full inline-flex items-center gap-1" style={{ background: tone.bg, color: tone.fg }}>
                      <span>{reminderIcon(reminder)}</span>
                      {domain}
                    </span>
                    <span className="text-[10px]" style={{ color: C.sub }}>{statusLabel(reminder)}</span>
                  </div>
                  <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>{reminder.rule.title}</h3>
                  <p className="text-[12px] mt-2 leading-relaxed" style={{ color: C.sub }}>{reasonLine(reminder)}</p>
                  <div className="mt-3 rounded-[14px] px-3 py-2" style={{ background: '#fff' }}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: tone.fg }}>Why This Week</p>
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: C.sub }}>{reminder.rule.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Link to={primary.to} className="px-3 py-1.5 rounded-full text-[11px] font-medium" style={{ background: tone.bg, color: tone.fg }}>
                      {primary.label}
                    </Link>
                    <button type="button" onClick={() => void handleAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, localToday))} className="px-3 py-1.5 rounded-full text-[11px]" style={{ background: '#f7f7f5', color: C.sub }}>
                      稍后提醒
                    </button>
                    <button type="button" onClick={() => void handleAction(reminder, 'mark_not_applicable')} className="px-3 py-1.5 rounded-full text-[11px]" style={{ background: '#f7f7f5', color: '#a16b5d' }}>
                      不适用
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard count={agenda.history.length} title="历史" hint="已完成、已安排、暂缓或不适用的事项会归档到这里。">
          <div className="space-y-2">
            {agenda.history.length === 0 ? (
              <p className="text-[12px]" style={{ color: C.sub }}>还没有历史记录。</p>
            ) : agenda.history.map((item) => (
              <div key={`${item.rule.ruleId}-${item.repeatIndex}`} className="flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 border" style={{ borderColor: C.border, background: '#fcfdfb' }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: C.text }}>{item.rule.title}</p>
                  <p className="text-[11px] mt-1" style={{ color: C.sub }}>{historyLabel(item)}</p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-full" style={{ color: C.sub, background: '#f3f5f1' }}>{DOMAIN_LABELS[item.rule.domain] ?? item.rule.domain}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Frequency adjustment modal */}
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
