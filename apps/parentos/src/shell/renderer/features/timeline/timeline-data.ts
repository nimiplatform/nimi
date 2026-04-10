import { useState, useEffect, useCallback } from 'react';
import type { ChildProfile } from '../../app-shell/app-store.js';
import {
  getReminderStates, getMeasurements, getVaccineRecords, getMilestoneRecords,
  getJournalEntries, getSleepRecords, getAllergyRecords, getGrowthReports,
} from '../../bridge/sqlite-bridge.js';
import { mapReminderStateRow, type ReminderState } from '../../engine/reminder-engine.js';
import type { MeasurementRow, SleepRecordRow } from '../../bridge/sqlite-bridge.js';

/* ================================================================
   DATA LAYER
   ================================================================ */

export interface AllergyRec { allergen: string; category: string; severity: string; status: string; notes: string | null }
export interface MonthlyReportSummary { reportId: string; content: string; periodStart: string; generatedAt: string }
export interface DashData {
  reminderStates: ReminderState[];
  measurements: MeasurementRow[];
  vaccineCount: number;
  milestoneRecords: Array<{ milestoneId: string; achievedAt: string | null }>;
  journalEntries: Array<{ entryId: string; contentType: string; textContent: string | null; recordedAt: string; observationMode: string | null }>;
  sleepRecords: SleepRecordRow[];
  allergyRecords: AllergyRec[];
  latestMonthlyReport: MonthlyReportSummary | null;
}
const EMPTY: DashData = { reminderStates: [], measurements: [], vaccineCount: 0, milestoneRecords: [], journalEntries: [], sleepRecords: [], allergyRecords: [], latestMonthlyReport: null };

export function useDash(childId: string | null) {
  const [d, setD] = useState<DashData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!childId) { setLoading(false); return; }
    setLoading(true);
    const [rs, ms, vs, mi, jo, sl, al, rp] = await Promise.allSettled([
      getReminderStates(childId), getMeasurements(childId), getVaccineRecords(childId),
      getMilestoneRecords(childId), getJournalEntries(childId, 5), getSleepRecords(childId, 7),
      getAllergyRecords(childId), getGrowthReports(childId),
    ]);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const allReports = rp.status === 'fulfilled' ? rp.value : [];
    const thisMonthReport = allReports.find((r) => r.periodStart >= monthStart) ?? null;

    setD({
      reminderStates: rs.status === 'fulfilled' ? rs.value.map(mapReminderStateRow) : [],
      measurements: ms.status === 'fulfilled' ? ms.value : [],
      vaccineCount: vs.status === 'fulfilled' ? vs.value.length : 0,
      milestoneRecords: mi.status === 'fulfilled' ? mi.value.map((m) => ({ milestoneId: m.milestoneId, achievedAt: m.achievedAt })) : [],
      journalEntries: jo.status === 'fulfilled' ? jo.value.map((e) => ({ entryId: e.entryId, contentType: e.contentType, textContent: e.textContent, recordedAt: e.recordedAt, observationMode: e.observationMode })) : [],
      sleepRecords: sl.status === 'fulfilled' ? sl.value : [],
      allergyRecords: al.status === 'fulfilled' ? al.value.map((a) => ({ allergen: a.allergen, category: a.category, severity: a.severity, status: a.status, notes: a.notes })) : [],
      latestMonthlyReport: thisMonthReport ? { reportId: thisMonthReport.reportId, content: thisMonthReport.content, periodStart: thisMonthReport.periodStart, generatedAt: thisMonthReport.generatedAt } : null,
    });
    setLoading(false);
  }, [childId]);
  useEffect(() => { load(); }, [load]);
  return { d, loading, reload: load };
}

/* ── helpers ──────────────────────────────────────────────── */

export function pctComplete(c: ChildProfile): number {
  const f = [c.birthWeightKg, c.birthHeightCm, c.birthHeadCircCm, c.avatarPath, c.allergies, c.medicalNotes, c.recorderProfiles];
  return Math.round((f.filter((v) => v != null).length / f.length) * 100);
}
export function latestByType(ms: MeasurementRow[]) {
  const m = new Map<string, MeasurementRow>();
  for (const r of ms) { const e = m.get(r.typeId); if (!e || r.measuredAt > e.measuredAt) m.set(r.typeId, r); }
  return m;
}
export function wkActivity(j: DashData['journalEntries'], ms: MeasurementRow[], sl: SleepRecordRow[]): number[] {
  const now = new Date(), dow = (now.getDay() + 6) % 7, mon = new Date(now);
  mon.setDate(now.getDate() - dow); mon.setHours(0, 0, 0, 0);
  const c = [0, 0, 0, 0, 0, 0, 0];
  const add = (s: string) => { const dt = new Date(s); if (dt >= mon) { const i = (dt.getDay() + 6) % 7; if (i >= 0 && i < 7) c[i] = (c[i] ?? 0) + 1; } };
  j.forEach((e) => add(e.recordedAt)); ms.forEach((m) => add(m.measuredAt)); sl.forEach((s) => add(s.sleepDate));
  return c;
}
export const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
export function fmtDate() { return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); }
export function fmtRel(s: string) {
  const n = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  return n === 0 ? '今天' : n === 1 ? '昨天' : n < 7 ? `${n}天前` : new Date(s).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/* ── design tokens ───────────────────────────────────────── */

export const C = {
  bg: '#E5ECEA', card: '#ffffff', accent: '#c8e64a', accentDim: '#c8e64a66',
  text: '#1a2b4a', sub: '#8a8f9a', brand: '#EEF3F1', cardProfile: '#86AFDA',
  shadow: '0 2px 12px rgba(0,0,0,0.06)', radius: 'rounded-[18px]',
} as const;

/* ── quick links ─────────────────────────────────────────── */

export const QLINKS = [
  { to: '/profile/growth', l: '生长曲线', emoji: '📈' },
  { to: '/profile/vaccines', l: '疫苗', emoji: '💉' },
  { to: '/profile/sleep', l: '睡眠', emoji: '😴' },
  { to: '/profile/dental', l: '口腔', emoji: '🦷' },
  { to: '/journal', l: '日记', emoji: '📋' },
  { to: '/profile/fitness', l: '体能', emoji: '🏃' },
  { to: '/profile/allergies', l: '过敏', emoji: '🤧' },
  { to: '/profile/medical-events', l: '就医', emoji: '🏥' },
] as const;

/* ── metric definitions ──────────────────────────────────── */

export interface MetricDef {
  id: string;
  emoji: string;
  label: string;
  getValue: (latest: Map<string, MeasurementRow>, extra: { sleepDays: number; vaccineCount: number; vacTotal: number; vacPct: number; msPct: number }) => { value: string; sub: string };
}

export const ALL_METRICS: MetricDef[] = [
  { id: 'height', emoji: '📏', label: '身高', getValue: (l) => { const m = l.get('height'); return m ? { value: `${m.value}`, sub: `${m.value} cm` } : { value: '- -', sub: '未记录数据' }; } },
  { id: 'weight', emoji: '⚖️', label: '体重', getValue: (l) => { const m = l.get('weight'); return m ? { value: `${m.value}`, sub: `${m.value} kg` } : { value: '- -', sub: '未记录数据' }; } },
  { id: 'vision', emoji: '👁️', label: '视力', getValue: (l) => { const vl = l.get('vision-left'), vr = l.get('vision-right'); return vl || vr ? { value: `${vl?.value ?? '-'}/${vr?.value ?? '-'}`, sub: '左/右眼' } : { value: '- -', sub: '未记录数据' }; } },
  { id: 'sleep', emoji: '😴', label: '近7天睡眠', getValue: (_l, e) => e.sleepDays > 0 ? { value: `${e.sleepDays}/7`, sub: '天有记录' } : { value: '- -', sub: '未记录' } },
  { id: 'bmi', emoji: '🏃', label: 'BMI', getValue: (l) => { const m = l.get('bmi'); return m ? { value: `${m.value}`, sub: '' } : { value: '- -', sub: '待记录' }; } },
  { id: 'bone-age', emoji: '🦴', label: '骨龄', getValue: (l) => { const m = l.get('bone-age'); return m ? { value: `${m.value}`, sub: '岁' } : { value: '- -', sub: '待评估' }; } },
  { id: 'head-circ', emoji: '📐', label: '头围', getValue: (l) => { const m = l.get('head-circumference'); return m ? { value: `${m.value}`, sub: `${m.value} cm` } : { value: '- -', sub: '未记录数据' }; } },
  { id: 'vaccine', emoji: '💉', label: '疫苗进度', getValue: (_l, e) => ({ value: `${e.vaccineCount}/${e.vacTotal}`, sub: `${e.vacPct}% 已完成` }) },
  { id: 'milestone', emoji: '🎯', label: '里程碑', getValue: (_l, e) => ({ value: `${e.msPct}%`, sub: '达成率' }) },
  { id: 'axial', emoji: '🔬', label: '眼轴', getValue: (l) => { const al = l.get('axial-length-left'), ar = l.get('axial-length-right'); return al || ar ? { value: `${al?.value ?? '-'}/${ar?.value ?? '-'}`, sub: 'mm 左/右' } : { value: '- -', sub: '未记录数据' }; } },
  { id: 'body-fat', emoji: '💪', label: '体脂率', getValue: (l) => { const m = l.get('body-fat-percentage'); return m ? { value: `${m.value}%`, sub: '' } : { value: '- -', sub: '待记录' }; } },
  { id: 'scoliosis', emoji: '🦿', label: '脊柱侧弯', getValue: (l) => { const m = l.get('scoliosis-cobb-angle'); return m ? { value: `${m.value}°`, sub: '' } : { value: '- -', sub: '待评估' }; } },
];

export const METRIC_MAP = new Map(ALL_METRICS.map((m) => [m.id, m]));
export const DEFAULT_METRICS = ['height', 'weight', 'vision', 'sleep', 'bone-age', 'bmi'];
export const SETTING_KEY = 'dashboard_overview_metrics';

/* ── domain routes ───────────────────────────────────────── */

export const DOMAIN_ROUTES: Record<string, string> = {
  vaccine: '/profile/vaccines', growth: '/profile/growth', vision: '/profile/vision',
  dental: '/profile/dental', sleep: '/profile/sleep', 'bone-age': '/profile/tanner',
  checkup: '/profile/medical-events', nutrition: '/profile/growth',
  posture: '/profile/posture', fitness: '/profile/fitness', tanner: '/profile/tanner',
};
