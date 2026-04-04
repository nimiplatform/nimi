import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { REMINDER_RULES, SENSITIVE_PERIODS, MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import { computeActiveReminders, partitionReminders } from '../../engine/reminder-engine.js';
import type { ActiveReminder, ReminderState } from '../../engine/reminder-engine.js';
import {
  getReminderStates, upsertReminderState,
  getMeasurements, getVaccineRecords, getMilestoneRecords,
  getJournalEntries, getSleepRecords,
} from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow, SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

// ── Types ──────────────────────────────────────────────────

interface DashboardData {
  reminderStates: ReminderState[];
  measurements: MeasurementRow[];
  vaccineCount: number;
  milestoneRecords: Array<{ milestoneId: string; achievedAt: string | null }>;
  journalEntries: Array<{ entryId: string; contentType: string; textContent: string | null; recordedAt: string; observationMode: string | null }>;
  sleepRecords: SleepRecordRow[];
}

const EMPTY_DATA: DashboardData = {
  reminderStates: [],
  measurements: [],
  vaccineCount: 0,
  milestoneRecords: [],
  journalEntries: [],
  sleepRecords: [],
};

// ── Data Hook ──────────────────────────────────────────────

function useDashboardData(childId: string | null) {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); return; }
    setLoading(true);
    const [remStates, measurements, vaccines, milestones, journal, sleep] = await Promise.allSettled([
      getReminderStates(childId),
      getMeasurements(childId),
      getVaccineRecords(childId),
      getMilestoneRecords(childId),
      getJournalEntries(childId, 5),
      getSleepRecords(childId, 7),
    ]);
    setData({
      reminderStates: remStates.status === 'fulfilled' ? remStates.value.map((s) => ({
        stateId: s.stateId, childId: s.childId, ruleId: s.ruleId,
        status: s.status as ReminderState['status'],
        repeatIndex: s.repeatIndex,
        completedAt: s.completedAt, dismissedAt: s.dismissedAt,
      })) : [],
      measurements: measurements.status === 'fulfilled' ? measurements.value : [],
      vaccineCount: vaccines.status === 'fulfilled' ? vaccines.value.length : 0,
      milestoneRecords: milestones.status === 'fulfilled' ? milestones.value.map((m) => ({
        milestoneId: m.milestoneId, achievedAt: m.achievedAt,
      })) : [],
      journalEntries: journal.status === 'fulfilled' ? journal.value.map((e) => ({
        entryId: e.entryId, contentType: e.contentType,
        textContent: e.textContent, recordedAt: e.recordedAt,
        observationMode: e.observationMode,
      })) : [],
      sleepRecords: sleep.status === 'fulfilled' ? sleep.value : [],
    });
    setLoading(false);
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

// ── Helpers ────────────────────────────────────────────────

function computeProfileCompleteness(child: ChildProfile): number {
  const fields = [
    child.birthWeightKg, child.birthHeightCm, child.birthHeadCircCm,
    child.avatarPath, child.allergies, child.medicalNotes, child.recorderProfiles,
  ];
  const filled = fields.filter((v) => v !== null && v !== undefined).length;
  return Math.round((filled / fields.length) * 100);
}

function getLatestByType(measurements: MeasurementRow[]): Map<string, MeasurementRow> {
  const latest = new Map<string, MeasurementRow>();
  for (const m of measurements) {
    const existing = latest.get(m.typeId);
    if (!existing || m.measuredAt > existing.measuredAt) latest.set(m.typeId, m);
  }
  return latest;
}

function computeWeeklyActivity(
  journalEntries: DashboardData['journalEntries'],
  measurements: MeasurementRow[],
  sleepRecords: SleepRecordRow[],
): number[] {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const counts = [0, 0, 0, 0, 0, 0, 0];
  const addDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (d >= monday) {
      const idx = (d.getDay() + 6) % 7;
      if (idx >= 0 && idx < 7) counts[idx] = (counts[idx] ?? 0) + 1;
    }
  };
  journalEntries.forEach((e) => addDate(e.recordedAt));
  measurements.forEach((m) => addDate(m.measuredAt));
  sleepRecords.forEach((s) => addDate(s.sleepDate));
  return counts;
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function formatDate(): string {
  return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DOMAIN_LABELS: Record<string, string> = {
  'gross-motor': '大运动',
  'fine-motor': '精细动作',
  language: '语言',
  cognitive: '认知',
  'social-emotional': '社交情感',
  'self-care': '自理',
};

// ── Shared Components ──────────────────────────────────────

function DashCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl shadow-sm p-5 ${className}`}>{children}</div>;
}

function ProgressBar({ percent, className = '' }: { percent: number; className?: string }) {
  return (
    <div className={`h-2 rounded-full bg-gray-100 overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-[#c5e84d] transition-all duration-500" style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function ProgressRing({ percent, size = 72, strokeWidth = 6 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#c5e84d" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700">{percent}%</span>
    </div>
  );
}

function SectionHeader({ title, to, linkText = '查看全部' }: { title: string; to?: string; linkText?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {to && <Link to={to} className="text-xs text-slate-400 hover:text-slate-600">{linkText}</Link>}
    </div>
  );
}

// ── Dashboard Modules ──────────────────────────────────────

function ChildProfileCard({ child, ageMonths }: { child: ChildProfile; ageMonths: number }) {
  const completeness = computeProfileCompleteness(child);
  const ageYears = Math.floor(ageMonths / 12);
  const ageRem = ageMonths % 12;
  const initial = child.displayName.charAt(0);

  return (
    <DashCard className="flex flex-col items-center text-center relative bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Avatar */}
      <div className="relative mb-3">
        {child.avatarPath ? (
          <img src={child.avatarPath} alt={child.displayName} className="w-20 h-20 rounded-full object-cover border-4 border-white shadow" />
        ) : (
          <div className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center border-4 border-white shadow">
            <span className="text-2xl font-bold text-slate-500">{initial}</span>
          </div>
        )}
        <div className="absolute -bottom-1 -right-1">
          <ProgressRing percent={completeness} size={36} strokeWidth={3} />
        </div>
      </div>
      <h2 className="text-lg font-bold text-[#1e3a5f]">{child.displayName}</h2>
      <p className="text-xs text-slate-500 mt-0.5">
        {ageYears > 0 ? `${ageYears}岁` : ''}{ageRem > 0 ? `${ageRem}个月` : ''}
      </p>
      <span className="mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
        {child.gender === 'female' ? '女孩' : '男孩'}
      </span>
      <Link to="/profile" className="mt-4 text-xs text-slate-400 hover:text-slate-600">
        + 完善档案信息
      </Link>
    </DashCard>
  );
}

function TodayStatsCard({ todayReminders, totalReminders, vaccinesDone, vaccinesTotal }: {
  todayReminders: number; totalReminders: number; vaccinesDone: number; vaccinesTotal: number;
}) {
  const rPct = totalReminders > 0 ? Math.round(((totalReminders - todayReminders) / totalReminders) * 100) : 0;
  const vPct = vaccinesTotal > 0 ? Math.round((vaccinesDone / vaccinesTotal) * 100) : 0;

  return (
    <DashCard>
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-500">今日提醒</span>
            <span className="text-xs text-slate-400">{rPct}%</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-[#1e3a5f]">{totalReminders - todayReminders}</span>
            <span className="text-sm text-slate-400">/{totalReminders}</span>
          </div>
          <ProgressBar percent={rPct} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-500">疫苗进度</span>
            <span className="text-xs text-slate-400">{vPct}%</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-[#1e3a5f]">{vaccinesDone}</span>
            <span className="text-sm text-slate-400">/{vaccinesTotal}</span>
          </div>
          <ProgressBar percent={vPct} />
        </div>
      </div>
    </DashCard>
  );
}

function WeeklyActivityCard({ counts }: { counts: number[] }) {
  const maxCount = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <DashCard className="flex flex-col">
      <SectionHeader title="本周记录" linkText={`共 ${total} 条`} />
      <div className="flex-1 flex items-end justify-between gap-2 mt-4 min-h-[120px]">
        {counts.map((count, i) => {
          const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
          const isToday = i === todayIdx;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              {count > 0 && <span className="text-[10px] text-slate-400">{count}</span>}
              <div className="w-full relative" style={{ height: 100 }}>
                <div
                  className={`absolute bottom-0 w-full rounded-t-md transition-all duration-500 ${isToday ? 'bg-[#c5e84d]' : 'bg-[#c5e84d]/40'}`}
                  style={{ height: `${height}%`, minHeight: count > 0 ? 8 : 0 }}
                />
              </div>
              <span className={`text-[10px] ${isToday ? 'text-slate-700 font-semibold' : 'text-slate-400'}`}>{DAY_LABELS[i]}</span>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

function LatestMeasurementsCard({ measurements }: { measurements: MeasurementRow[] }) {
  const latest = getLatestByType(measurements);
  const keys = ['height', 'weight', 'head-circumference', 'bmi'] as const;
  const labels: Record<string, string> = { height: '身高', weight: '体重', 'head-circumference': '头围', bmi: 'BMI' };
  const units: Record<string, string> = { height: 'cm', weight: 'kg', 'head-circumference': 'cm', bmi: 'kg/m²' };
  const icons: Record<string, string> = { height: '📏', weight: '⚖️', 'head-circumference': '🧠', bmi: '📊' };

  return (
    <DashCard>
      <SectionHeader title="最近测量" to="/profile/growth" />
      <div className="grid grid-cols-2 gap-3">
        {keys.map((key) => {
          const m = latest.get(key);
          return (
            <div key={key} className="bg-gray-50 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">{icons[key]}</span>
                <span className="text-xs text-slate-500">{labels[key]}</span>
              </div>
              {m ? (
                <>
                  <span className="text-lg font-bold text-[#1e3a5f]">{m.value}</span>
                  <span className="text-xs text-slate-400 ml-1">{units[key]}</span>
                  <p className="text-[10px] text-slate-400 mt-0.5">{formatRelativeDate(m.measuredAt)}</p>
                </>
              ) : (
                <span className="text-xs text-slate-300">暂无数据</span>
              )}
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

function SensitivePeriodsCard({ ageMonths }: { ageMonths: number }) {
  const active = SENSITIVE_PERIODS.filter(
    (p) => ageMonths >= p.ageRange.startMonths && ageMonths <= p.ageRange.endMonths,
  );

  return (
    <DashCard>
      <SectionHeader title="当前敏感期" to="/journal" linkText="去记录" />
      {active.length === 0 ? (
        <p className="text-xs text-slate-300">当前年龄段暂无活跃敏感期</p>
      ) : (
        <div className="space-y-3">
          {active.slice(0, 3).map((p) => {
            const isPeak = ageMonths >= p.ageRange.peakMonths - 3 && ageMonths <= p.ageRange.peakMonths + 3;
            return (
              <div key={p.periodId} className="border-b border-gray-50 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">{p.title}</span>
                  {isPeak && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">高峰</span>}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {p.ageRange.startMonths}-{p.ageRange.endMonths}个月
                </p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.observableSigns[0]}</p>
              </div>
            );
          })}
        </div>
      )}
    </DashCard>
  );
}

function RecentJournalCard({ entries }: { entries: DashboardData['journalEntries'] }) {
  const typeIcons: Record<string, string> = { text: '📝', voice: '🎤', photo: '📷', mixed: '📋' };

  return (
    <DashCard>
      <SectionHeader title="最近日记" to="/journal" />
      {entries.length === 0 ? (
        <p className="text-xs text-slate-300">还没有日记记录</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto">
          {entries.slice(0, 3).map((e) => (
            <div key={e.entryId} className="flex-shrink-0 w-40 bg-gray-50 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-sm">{typeIcons[e.contentType] ?? '📋'}</span>
                <span className="text-[10px] text-slate-400">{formatRelativeDate(e.recordedAt)}</span>
              </div>
              <p className="text-xs text-slate-600 line-clamp-3">
                {e.textContent ? e.textContent.slice(0, 60) : e.contentType === 'voice' ? '语音记录' : '照片记录'}
              </p>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  );
}

function TodayRemindersPanel({ child, reminderStates, onComplete, onDismiss }: {
  child: ChildProfile;
  reminderStates: ReminderState[];
  onComplete: (r: ActiveReminder) => void;
  onDismiss: (r: ActiveReminder) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const ageMonths = computeAgeMonths(child.birthDate);

  const active = computeActiveReminders(
    REMINDER_RULES, ageMonths, child.nurtureMode, child.nurtureModeOverrides, reminderStates,
  );
  const { today, upcoming } = partitionReminders(active);
  const allItems = [...today, ...upcoming.slice(0, 5)];
  const completedIds = new Set(reminderStates.filter((s) => s.status === 'completed').map((s) => s.ruleId));

  const filtered = filter === 'all'
    ? allItems
    : filter === 'pending'
      ? allItems.filter((r) => !completedIds.has(r.rule.ruleId))
      : allItems.filter((r) => completedIds.has(r.rule.ruleId));

  const tabs: Array<{ key: typeof filter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '待办' },
    { key: 'completed', label: '已完成' },
  ];

  return (
    <DashCard className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">今日提醒</h3>
        <Link to="/timeline" className="text-xs text-slate-400 hover:text-slate-600">全部</Link>
      </div>
      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-full p-0.5 mb-3">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`flex-1 text-xs py-1.5 rounded-full transition-colors ${filter === t.key ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Reminder list */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-300 text-center py-4">暂无提醒</p>
        ) : filtered.map((r) => {
          const isDone = completedIds.has(r.rule.ruleId);
          return (
            <div key={`${r.rule.ruleId}-${r.repeatIndex}`} className="flex items-start gap-2.5 py-2.5 border-b border-gray-50 last:border-0">
              <button onClick={() => !isDone && onComplete(r)}
                className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-green-400'}`}>
                {isDone && <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${isDone ? 'line-through text-slate-400' : 'text-slate-700'}`}>{r.rule.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-slate-400">
                    {r.status === 'overdue' ? '已过期' : r.status === 'active' ? '今天' : '即将到来'}
                  </span>
                  {r.rule.priority === 'P0' && <span className="text-[10px] text-red-500 font-medium">紧急</span>}
                </div>
              </div>
              {!isDone && (
                <button onClick={() => onDismiss(r)} className="text-[10px] text-slate-300 hover:text-slate-500 shrink-0">跳过</button>
              )}
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

function GrowthGoalsCard({ milestoneRecords, ageMonths, profileCompleteness, sleepRecords, vaccinesDone, vaccinesTotal }: {
  milestoneRecords: DashboardData['milestoneRecords']; ageMonths: number;
  profileCompleteness: number; sleepRecords: SleepRecordRow[];
  vaccinesDone: number; vaccinesTotal: number;
}) {
  const achievedIds = new Set(milestoneRecords.filter((r) => r.achievedAt).map((r) => r.milestoneId));
  const relevantMilestones = MILESTONE_CATALOG.filter((m) => m.typicalAge.rangeStart <= ageMonths);
  const milestoneAchieved = relevantMilestones.filter((m) => achievedIds.has(m.milestoneId)).length;
  const milestonePct = relevantMilestones.length > 0 ? Math.round((milestoneAchieved / relevantMilestones.length) * 100) : 0;
  const sleepPct = Math.round((Math.min(sleepRecords.length, 7) / 7) * 100);
  const vaccinePct = vaccinesTotal > 0 ? Math.round((vaccinesDone / vaccinesTotal) * 100) : 0;

  const goals = [
    { label: '发育里程碑', pct: milestonePct, icon: '🎯' },
    { label: '健康档案', pct: profileCompleteness, icon: '📋' },
    { label: '睡眠习惯', pct: sleepPct, icon: '😴' },
    { label: '疫苗进度', pct: vaccinePct, icon: '💉' },
  ];

  return (
    <DashCard>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">成长目标</h3>
      <p className="text-[10px] text-slate-400 mb-4">追踪各个维度的完成进度</p>
      <div className="space-y-4">
        {goals.map((g) => (
          <div key={g.label}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{g.icon}</span>
                <span className="text-xs text-slate-600">{g.label}</span>
              </div>
              <span className="text-xs font-semibold text-slate-600">{g.pct}%</span>
            </div>
            <ProgressBar percent={g.pct} />
          </div>
        ))}
      </div>
    </DashCard>
  );
}

// ── Main Dashboard ─────────────────────────────────────────

export default function TimelinePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const { data, loading, reload } = useDashboardData(activeChildId);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const vaccineRuleCount = useMemo(() => REMINDER_RULES.filter((r) => r.domain === 'vaccine').length, []);
  const profileCompleteness = child ? computeProfileCompleteness(child) : 0;

  const weeklyActivity = useMemo(
    () => computeWeeklyActivity(data.journalEntries, data.measurements, data.sleepRecords),
    [data.journalEntries, data.measurements, data.sleepRecords],
  );

  const handleComplete = useCallback(async (reminder: ActiveReminder) => {
    if (!child) return;
    const now = isoNow();
    try {
      await upsertReminderState({
        stateId: ulid(), childId: child.childId, ruleId: reminder.rule.ruleId,
        status: 'completed', activatedAt: null, completedAt: now, dismissedAt: null,
        dismissReason: null, repeatIndex: reminder.repeatIndex, nextTriggerAt: null,
        notes: null, now,
      });
      reload();
    } catch { /* bridge unavailable */ }
  }, [child, reload]);

  const handleDismiss = useCallback(async (reminder: ActiveReminder) => {
    if (!child) return;
    const now = isoNow();
    try {
      await upsertReminderState({
        stateId: ulid(), childId: child.childId, ruleId: reminder.rule.ruleId,
        status: 'dismissed', activatedAt: null, completedAt: null, dismissedAt: now,
        dismissReason: null, repeatIndex: reminder.repeatIndex, nextTriggerAt: null,
        notes: null, now,
      });
      reload();
    } catch { /* bridge unavailable */ }
  }, [child, reload]);

  if (!child) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 bg-[var(--color-bg-dashboard)]">
        <p className="text-lg">还没有添加孩子</p>
        <p className="text-sm">请在 设置 → 孩子管理 中添加第一个孩子</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--color-bg-dashboard)]">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    );
  }

  const active = computeActiveReminders(
    REMINDER_RULES, ageMonths, child.nurtureMode, child.nurtureModeOverrides, data.reminderStates,
  );
  const { today } = partitionReminders(active);

  return (
    <div className="min-h-full bg-[var(--color-bg-dashboard)] p-6">
      <div className="max-w-[1400px] mx-auto">
        {/* Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.5fr_280px] gap-5">

          {/* Row 1: Welcome header (spans 3 left columns) */}
          <div className="lg:col-span-3">
            <h1 className="text-2xl font-bold text-[#1e3a5f]">你好，欢迎回来!</h1>
            <p className="text-sm text-slate-500 mt-1">{child.displayName} · {formatDate()}</p>
          </div>

          {/* Row 1 col 4: Reminders panel (spans 2 rows) */}
          <div className="lg:row-span-3 order-last lg:order-none">
            <TodayRemindersPanel child={child} reminderStates={data.reminderStates} onComplete={handleComplete} onDismiss={handleDismiss} />
          </div>

          {/* Row 2: Child card */}
          <ChildProfileCard child={child} ageMonths={ageMonths} />

          {/* Row 2: Stats */}
          <TodayStatsCard todayReminders={today.length} totalReminders={today.length + data.reminderStates.filter((s) => s.status === 'completed').length} vaccinesDone={data.vaccineCount} vaccinesTotal={vaccineRuleCount} />

          {/* Row 2-3: Weekly activity (spans 2 rows) */}
          <div className="lg:row-span-2">
            <WeeklyActivityCard counts={weeklyActivity} />
          </div>

          {/* Row 3: Latest measurements */}
          <LatestMeasurementsCard measurements={data.measurements} />

          {/* Row 3: Sensitive periods */}
          <SensitivePeriodsCard ageMonths={ageMonths} />

          {/* Row 4: Recent journal (spans 2 cols) */}
          <div className="lg:col-span-2">
            <RecentJournalCard entries={data.journalEntries} />
          </div>

          {/* Spacer for activity card area */}
          <div className="hidden lg:block" />

          {/* Right column: Growth goals */}
          <div className="order-last">
            <GrowthGoalsCard milestoneRecords={data.milestoneRecords} ageMonths={ageMonths}
              profileCompleteness={profileCompleteness} sleepRecords={data.sleepRecords}
              vaccinesDone={data.vaccineCount} vaccinesTotal={vaccineRuleCount} />
          </div>
        </div>
      </div>
    </div>
  );
}
