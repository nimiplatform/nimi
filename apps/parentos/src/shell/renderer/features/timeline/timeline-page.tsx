import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { REMINDER_RULES, SENSITIVE_PERIODS, MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import { computeActiveReminders, partitionReminders } from '../../engine/reminder-engine.js';
import type { ActiveReminder, ReminderState } from '../../engine/reminder-engine.js';
import {
  getReminderStates, upsertReminderState,
  getMeasurements, getVaccineRecords, getMilestoneRecords,
  getJournalEntries, getSleepRecords, getAllergyRecords,
  getAppSetting, setAppSetting,
} from '../../bridge/sqlite-bridge.js';
import { buildAllergyProfile, interceptAllergyCollisions, getActiveSeasonalAlerts, type EnhancedReminder, type DynamicTask } from '../../engine/smart-alerts.js';
import type { MeasurementRow, SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { Settings } from 'lucide-react';

/* ================================================================
   DATA LAYER
   ================================================================ */

interface AllergyRec { allergen: string; category: string; severity: string; status: string; notes: string | null }
interface DashData {
  reminderStates: ReminderState[];
  measurements: MeasurementRow[];
  vaccineCount: number;
  milestoneRecords: Array<{ milestoneId: string; achievedAt: string | null }>;
  journalEntries: Array<{ entryId: string; contentType: string; textContent: string | null; recordedAt: string; observationMode: string | null }>;
  sleepRecords: SleepRecordRow[];
  allergyRecords: AllergyRec[];
}
const EMPTY: DashData = { reminderStates: [], measurements: [], vaccineCount: 0, milestoneRecords: [], journalEntries: [], sleepRecords: [], allergyRecords: [] };

function useDash(childId: string | null) {
  const [d, setD] = useState<DashData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!childId) { setLoading(false); return; }
    setLoading(true);
    const [rs, ms, vs, mi, jo, sl, al] = await Promise.allSettled([
      getReminderStates(childId), getMeasurements(childId), getVaccineRecords(childId),
      getMilestoneRecords(childId), getJournalEntries(childId, 5), getSleepRecords(childId, 7),
      getAllergyRecords(childId),
    ]);
    setD({
      reminderStates: rs.status === 'fulfilled' ? rs.value.map((s) => ({ stateId: s.stateId, childId: s.childId, ruleId: s.ruleId, status: s.status as ReminderState['status'], repeatIndex: s.repeatIndex, completedAt: s.completedAt, dismissedAt: s.dismissedAt })) : [],
      measurements: ms.status === 'fulfilled' ? ms.value : [],
      vaccineCount: vs.status === 'fulfilled' ? vs.value.length : 0,
      milestoneRecords: mi.status === 'fulfilled' ? mi.value.map((m) => ({ milestoneId: m.milestoneId, achievedAt: m.achievedAt })) : [],
      journalEntries: jo.status === 'fulfilled' ? jo.value.map((e) => ({ entryId: e.entryId, contentType: e.contentType, textContent: e.textContent, recordedAt: e.recordedAt, observationMode: e.observationMode })) : [],
      sleepRecords: sl.status === 'fulfilled' ? sl.value : [],
      allergyRecords: al.status === 'fulfilled' ? al.value.map((a) => ({ allergen: a.allergen, category: a.category, severity: a.severity, status: a.status, notes: a.notes })) : [],
    });
    setLoading(false);
  }, [childId]);
  useEffect(() => { load(); }, [load]);
  return { d, loading, reload: load };
}

/* ── helpers ──────────────────────────────────────────────── */

function pctComplete(c: ChildProfile): number {
  const f = [c.birthWeightKg, c.birthHeightCm, c.birthHeadCircCm, c.avatarPath, c.allergies, c.medicalNotes, c.recorderProfiles];
  return Math.round((f.filter((v) => v != null).length / f.length) * 100);
}
function latestByType(ms: MeasurementRow[]) {
  const m = new Map<string, MeasurementRow>();
  for (const r of ms) { const e = m.get(r.typeId); if (!e || r.measuredAt > e.measuredAt) m.set(r.typeId, r); }
  return m;
}
function wkActivity(j: DashData['journalEntries'], ms: MeasurementRow[], sl: SleepRecordRow[]): number[] {
  const now = new Date(), dow = (now.getDay() + 6) % 7, mon = new Date(now);
  mon.setDate(now.getDate() - dow); mon.setHours(0, 0, 0, 0);
  const c = [0, 0, 0, 0, 0, 0, 0];
  const add = (s: string) => { const dt = new Date(s); if (dt >= mon) { const i = (dt.getDay() + 6) % 7; if (i >= 0 && i < 7) c[i] = (c[i] ?? 0) + 1; } };
  j.forEach((e) => add(e.recordedAt)); ms.forEach((m) => add(m.measuredAt)); sl.forEach((s) => add(s.sleepDate));
  return c;
}
const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
function fmtDate() { return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); }
function fmtRel(s: string) {
  const n = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  return n === 0 ? '今天' : n === 1 ? '昨天' : n < 7 ? `${n}天前` : new Date(s).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/* ── design tokens ───────────────────────────────────────── */

const C = {
  bg: '#E5ECEA', card: '#ffffff', accent: '#c8e64a', accentDim: '#c8e64a66',
  text: '#1a2b4a', sub: '#8a8f9a', brand: '#EEF3F1', cardProfile: '#86AFDA',
  shadow: '0 2px 12px rgba(0,0,0,0.06)', radius: 'rounded-[18px]',
} as const;

/* ── quick links ─────────────────────────────────────────── */

/* Emoji quick links — iOS-style grid, uniform light gray bg, darken on hover */
const QLINKS = [
  { to: '/profile/growth', l: '生长曲线', emoji: '📈' },
  { to: '/profile/vaccines', l: '疫苗', emoji: '💉' },
  { to: '/profile/sleep', l: '睡眠', emoji: '😴' },
  { to: '/profile/dental', l: '口腔', emoji: '🦷' },
  { to: '/journal', l: '日记', emoji: '📋' },
  { to: '/profile/fitness', l: '体能', emoji: '🏃' },
  { to: '/profile/allergies', l: '过敏', emoji: '🤧' },
  { to: '/profile/medical-events', l: '就医', emoji: '🏥' },
] as const;

/* ================================================================
   SHARED UI
   ================================================================ */

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-[${C.card}] ${C.radius} p-5`} style={{ boxShadow: C.shadow }}>{children}</div>;
}
// Wrapper that also accepts extra classes easily
function Cd({ children, cls = '', style }: { children: ReactNode; cls?: string; style?: React.CSSProperties }) {
  return <div className={`bg-white ${C.radius} p-5 ${cls}`} style={{ boxShadow: C.shadow, ...style }}>{children}</div>;
}

function Bar({ pct, h = 6 }: { pct: number; h?: number }) {
  return (
    <div className="w-full rounded-full bg-[#e8e5e0] overflow-hidden" style={{ height: h }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, background: C.accent }} />
    </div>
  );
}

function Ring({ pct, size = 56, sw = 5, dark = false }: { pct: number; size?: number; sw?: number; dark?: boolean }) {
  const r = (size - sw) / 2, ci = 2 * Math.PI * r, off = ci - (Math.min(100, pct) / 100) * ci;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgba(255,255,255,0.2)' : '#e8e5e0'} strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.accent} strokeWidth={sw}
          strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${dark ? 'text-white' : ''}`} style={{ color: dark ? '#fff' : C.text }}>{pct}%</span>
    </div>
  );
}

function Hdr({ title, to, link = '查看全部' }: { title: string; to?: string; link?: string }) {
  const isPlus = link === '+';
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>{title}</h3>
      {to && (
        isPlus ? (
          <Link to={to} className="flex items-center justify-center w-[24px] h-[24px] rounded-full transition-colors hover:bg-[#e0e2de]" style={{ background: '#eceeed' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </Link>
        ) : (
          <Link to={to} className="text-[11px] hover:underline" style={{ color: C.sub }}>{link}</Link>
        )
      )}
    </div>
  );
}

/* ================================================================
   MAIN DASHBOARD
   ================================================================ */

export default function TimelinePage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((c) => c.childId === activeChildId);
  const { d, loading, reload } = useDash(activeChildId);
  const reminderKey = useCallback((ruleId: string, repeatIndex: number) => `${ruleId}:${repeatIndex}`, []);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;

  const handleAction = useCallback(async (rem: ActiveReminder, action: 'completed' | 'dismissed' | 'active') => {
    if (!child) return;
    const now = isoNow();
    try {
      await upsertReminderState({
        stateId: ulid(), childId: child.childId, ruleId: rem.rule.ruleId, status: action, activatedAt: null,
        completedAt: action === 'completed' ? now : null, dismissedAt: action === 'dismissed' ? now : null,
        dismissReason: null, repeatIndex: rem.repeatIndex, nextTriggerAt: null, notes: null, now,
      });
      reload();
    } catch { /* bridge unavailable */ }
  }, [child, reload]);

  // ALL age-eligible reminders (ignore completion state) — for the right panel
  // Hooks must be called before any early return to satisfy Rules of Hooks.
  const allEligible = useMemo(
    () => child ? computeActiveReminders(REMINDER_RULES, ageMonths, child.nurtureMode, child.nurtureModeOverrides, []) : [],
    [child, ageMonths],
  );
  const { today: allToday, upcoming: allUpcoming } = useMemo(() => partitionReminders(allEligible), [allEligible]);
  const dismissedKeys = useMemo(
    () => new Set(d.reminderStates.filter((s) => s.status === 'dismissed').map((s) => reminderKey(s.ruleId, s.repeatIndex))),
    [d.reminderStates, reminderKey],
  );

  // Build allergy profile and apply interceptor
  const allergyProfile = useMemo(
    () => child ? buildAllergyProfile(child.allergies, d.allergyRecords) : null,
    [child, d.allergyRecords],
  );
  const enhancedRem: EnhancedReminder[] = useMemo(() => {
    const base = [...allToday, ...allUpcoming.slice(0, 15)]
      .filter((r) => !dismissedKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex)));
    return allergyProfile ? interceptAllergyCollisions(base, allergyProfile) : base;
  }, [allToday, allUpcoming, allergyProfile, dismissedKeys, reminderKey]);

  // Seasonal alerts
  const seasonalTasks: DynamicTask[] = useMemo(() => {
    if (!allergyProfile || !child) return [];
    return getActiveSeasonalAlerts(allergyProfile).map((t) => ({ ...t, childId: child.childId }));
  }, [allergyProfile, child]);

  const allRem = enhancedRem;

  if (!child) return (
    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: C.bg, color: C.sub }}>
      <p className="text-lg font-medium">还没有添加孩子</p>
      <Link to="/settings/children" className="text-sm hover:underline" style={{ color: C.text }}>前往添加 →</Link>
    </div>
  );
  if (loading) return <div className="flex items-center justify-center h-full" style={{ background: C.bg }}><p className="text-sm" style={{ color: C.sub }}>加载中...</p></div>;

  const pct = pctComplete(child);
  const ageY = Math.floor(ageMonths / 12), ageR = ageMonths % 12;
  const vacTotal = REMINDER_RULES.filter((r) => r.domain === 'vaccine').length;
  // Active (pending) reminders — used for "今日提醒" count
  const active = computeActiveReminders(REMINDER_RULES, ageMonths, child.nurtureMode, child.nurtureModeOverrides, d.reminderStates);
  const { today, upcoming } = partitionReminders(active);
  const doneKeys = new Set(d.reminderStates.filter((s) => s.status === 'completed').map((s) => reminderKey(s.ruleId, s.repeatIndex)));

  const latest = latestByType(d.measurements);
  const wk = wkActivity(d.journalEntries, d.measurements, d.sleepRecords);
  const wkTotal = wk.reduce((a, b) => a + b, 0);
  const wkMax = Math.max(1, ...wk);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const periods = SENSITIVE_PERIODS.filter((p) => ageMonths >= p.ageRange.startMonths && ageMonths <= p.ageRange.endMonths);
  const achIds = new Set(d.milestoneRecords.filter((r) => r.achievedAt).map((r) => r.milestoneId));
  const relMs = MILESTONE_CATALOG.filter((m) => m.typicalAge.rangeStart <= ageMonths);
  const msPct = relMs.length > 0 ? Math.round((relMs.filter((m) => achIds.has(m.milestoneId)).length / relMs.length) * 100) : 0;
  const slPct = Math.round((Math.min(d.sleepRecords.length, 7) / 7) * 100);
  const vacPct = vacTotal > 0 ? Math.round((d.vaccineCount / vacTotal) * 100) : 0;

  const MEAS: Record<string, { label: string; unit: string }> = {
    height: { label: '身高', unit: 'cm' }, weight: { label: '体重', unit: 'kg' },
    'head-circumference': { label: '头围', unit: 'cm' }, bmi: { label: 'BMI', unit: '' },
  };

  return (
    <div className="flex h-full" style={{ background: C.bg }}>

      {/* ═══════════════════════════════════════════════════════
         CENTER — MAIN CONTENT
         ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto px-5 pb-5 min-w-0" style={{ paddingTop: 86 }}>

        {/* ── Bento grid ────────────────────────────────────── */}
        <div className="grid grid-cols-8 gap-4 auto-rows-min">

          {/* ▓▓ Row 1: Child profile (2col) + Growth data (6col) ▓▓ */}
          <ChildProfileCard child={child} childList={childList} ageY={ageY} ageR={ageR} pct={pct} />

          {/* ▓▓ Child overview — wider card (6col, 2 rows) ▓▓ */}
          <ChildOverviewCard ageMonths={ageMonths} latest={latest} vacPct={vacPct} vaccineCount={d.vaccineCount} vacTotal={vacTotal} msPct={msPct} todayCount={today.length} sleepDays={d.sleepRecords.length} measurements={d.measurements} />

          {/* ▓▓ Quick links + Observation note button — full width ▓▓ */}
          <Cd cls="col-span-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>快捷入口</h3>
              {/* Floating observation note button */}
              <Link to="/journal" className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-medium transition-all hover:opacity-80"
                style={{ background: C.cardProfile, color: '#fff', boxShadow: '0 2px 8px rgba(134,175,218,0.4)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                记录观察笔记
              </Link>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {QLINKS.map((q) => (
                <Link key={q.to} to={q.to} className="group flex flex-col items-center gap-1.5 py-2 transition-transform duration-200 hover:-translate-y-1">
                  <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[24px] bg-[#f5f6f4] transition-all duration-200 group-hover:bg-[#e6e8e4] group-hover:shadow-md">
                    {q.emoji}
                  </div>
                  <span className="text-[10px]" style={{ color: C.sub }}>{q.l}</span>
                </Link>
              ))}
            </div>
          </Cd>

          {/* ▓▓ Growth curve ▓▓ */}
          {(() => { const hasGrowth = (['height', 'weight', 'head-circumference', 'bmi'] as const).some((k) => latest.has(k)); return (
          <Cd cls="col-span-3">
            <Hdr title="生长曲线" to="/profile/growth" link={hasGrowth ? '详情 →' : '+'} />
            {hasGrowth ? (
              <div className="space-y-2">
                {(['height', 'weight', 'head-circumference', 'bmi'] as const).map((k) => {
                  const m = latest.get(k), meta = MEAS[k] ?? { label: k, unit: '' };
                  return (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: C.sub }}>{meta.label}</span>
                      {m ? (
                        <span className="text-[13px] font-bold" style={{ color: C.text }}>{m.value}<span className="text-[10px] font-normal ml-0.5" style={{ color: C.sub }}>{meta.unit}</span></span>
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
          ); })()}

          {/* ▓▓ Vision ▓▓ */}
          {(() => { const hasVision = (['vision-left', 'vision-right', 'axial-length-left', 'axial-length-right'] as const).some((k) => latest.has(k)); return (
          <Cd cls="col-span-3">
            <Hdr title="视力数据" to="/profile/vision" link={hasVision ? '详情 →' : '+'} />
            {hasVision ? (
              <div className="space-y-2">
                {([
                  { k: 'vision-left', l: '左眼视力' }, { k: 'vision-right', l: '右眼视力' },
                  { k: 'axial-length-left', l: '左眼眼轴' }, { k: 'axial-length-right', l: '右眼眼轴' },
                ] as const).map(({ k, l }) => {
                  const m = latest.get(k);
                  return (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: C.sub }}>{l}</span>
                      {m ? (
                        <span className="text-[13px] font-bold" style={{ color: C.text }}>{m.value}</span>
                      ) : (
                        <Link to="/profile/vision" className="text-[10px] hover:underline" style={{ color: C.text }}>+</Link>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center py-4">
                <span className="text-[28px]">👀</span>
                <p className="text-[11px] mt-2" style={{ color: C.sub }}>暂无数据</p>
              </div>
            )}
          </Cd>
          ); })()}

          {/* ▓▓ Fitness ▓▓ */}
          {(() => { const hasFit = d.measurements.filter((m) => m.typeId === 'body-fat-percentage').length > 0 || d.sleepRecords.length > 0; return (
          <Cd cls="col-span-2">
            <Hdr title="体能测评" to="/profile/fitness" link={hasFit ? '详情 →' : '+'} />
            {hasFit ? (
              <div className="space-y-2">
                {latest.get('body-fat-percentage') && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: C.sub }}>体脂率</span>
                    <span className="text-[13px] font-bold" style={{ color: C.text }}>{latest.get('body-fat-percentage')?.value}%</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: C.sub }}>睡眠记录</span>
                  <span className="text-[13px] font-bold" style={{ color: C.text }}>{d.sleepRecords.length}<span className="text-[10px] font-normal ml-0.5" style={{ color: C.sub }}>天/7天</span></span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: C.sub }}>成长目标</span>
                  <span className="text-[13px] font-bold" style={{ color: C.text }}>{msPct}%</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center py-4">
                <span className="text-[28px]">🏃</span>
                <p className="text-[11px] mt-2" style={{ color: C.sub }}>暂无体测数据</p>
              </div>
            )}
          </Cd>
          ); })()}

          {/* ▓▓ Sensitive periods / Journal ▓▓ */}
          <Cd cls="col-span-4">
            {periods.length > 0 ? (
              <>
                <Hdr title="当前敏感期" to="/journal" link="去观察 →" />
                <div className="space-y-2.5">
                  {periods.slice(0, 4).map((p) => {
                    const peak = ageMonths >= p.ageRange.peakMonths - 3 && ageMonths <= p.ageRange.peakMonths + 3;
                    return (
                      <div key={p.periodId} className="flex items-start gap-2">
                        <div className="mt-[7px] w-[6px] h-[6px] rounded-full shrink-0" style={{ background: peak ? '#e6a23c' : '#d4d1cc' }} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium" style={{ color: C.text }}>
                            {p.title}
                            {peak && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">高峰</span>}
                          </p>
                          <p className="text-[10px] mt-0.5 truncate" style={{ color: C.sub }}>{p.observableSigns[0]}</p>
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
                    <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[24px]" style={{ background: '#f5f6f4' }}>📋</div>
                    <p className="text-[11px] mt-2" style={{ color: C.sub }}>还没有日记</p>
                    <Link to="/journal" className="text-[11px] mt-1 hover:underline" style={{ color: C.text }}>写一篇 →</Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {d.journalEntries.slice(0, 4).map((e) => (
                      <div key={e.entryId} className="flex items-start gap-2">
                        <div className="mt-[7px] w-[5px] h-[5px] rounded-full shrink-0" style={{ background: C.accent }} />
                        <div className="min-w-0">
                          <p className="text-[12px] truncate" style={{ color: C.text }}>{e.textContent?.slice(0, 50) ?? (e.contentType === 'voice' ? '语音记录' : '照片记录')}</p>
                          <p className="text-[10px]" style={{ color: '#c0bdb8' }}>{fmtRel(e.recordedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Cd>

          {/* ▓▓ Growth goals ▓▓ */}
          <Cd cls="col-span-4">
            <Hdr title="成长目标" />
            <div className="space-y-3">
              {[
                { label: '发育里程碑', v: msPct },
                { label: '健康档案', v: pct },
                { label: '睡眠习惯', v: slPct },
                { label: '疫苗进度', v: vacPct },
              ].map((g) => (
                <div key={g.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px]" style={{ color: C.sub }}>{g.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: C.text }}>{g.v}%</span>
                  </div>
                  <Bar pct={g.v} h={6} />
                </div>
              ))}
            </div>
          </Cd>

          {/* ▓▓ Journal (when sensitive periods took the left slot) ▓▓ */}
          {periods.length > 0 && d.journalEntries.length > 0 && (
            <Cd cls="col-span-8">
              <Hdr title="最近日记" to="/journal" />
              <div className="flex gap-3 overflow-x-auto">
                {d.journalEntries.slice(0, 5).map((e) => (
                  <div key={e.entryId} className={`shrink-0 w-[160px] ${C.radius} p-3`} style={{ background: '#f5f3ef' }}>
                    <p className="text-[11px] mb-1" style={{ color: '#c0bdb8' }}>{fmtRel(e.recordedAt)}</p>
                    <p className="text-[12px] line-clamp-2" style={{ color: C.text }}>{e.textContent?.slice(0, 60) ?? (e.contentType === 'voice' ? '语音记录' : '照片记录')}</p>
                  </div>
                ))}
              </div>
            </Cd>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
         RIGHT — REMINDER PANEL
         ═══════════════════════════════════════════════════════ */}
      <ReminderPanel reminders={allRem} doneKeys={doneKeys}
        onToggle={(r, done) => handleAction(r, done ? 'active' : 'completed')}
        onDismiss={(r) => handleAction(r, 'dismissed')}
        seasonalTasks={seasonalTasks} />
    </div>
  );
}

/* ================================================================
   CHILD PROFILE CARD (with flip-to-switch animation)
   ================================================================ */

/* ================================================================
   CHILD OVERVIEW CARD — age-adaptive summary
   ================================================================ */


/* ── All available metric definitions ─────────────────────── */

interface MetricDef {
  id: string;
  emoji: string;
  label: string;
  getValue: (latest: Map<string, MeasurementRow>, extra: { sleepDays: number; vaccineCount: number; vacTotal: number; vacPct: number; msPct: number }) => { value: string; sub: string };
}

const ALL_METRICS: MetricDef[] = [
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

const METRIC_MAP = new Map(ALL_METRICS.map((m) => [m.id, m]));
const DEFAULT_METRICS = ['height', 'weight', 'vision', 'sleep', 'bone-age', 'bmi'];
const SETTING_KEY = 'dashboard_overview_metrics';

/* ── Settings modal ──────────────────────────────────────── */

function MetricSettingsModal({ selected, onSave, onClose }: {
  selected: string[]; onSave: (ids: string[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 3) next.delete(id); } // min 3
      else { if (next.size < 6) next.add(id); } // max 6
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
      <div className="w-[400px] rounded-[18px] p-6 shadow-xl" style={{ background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[16px] font-bold" style={{ color: C.text }}>自定义监测指标</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: C.sub }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: C.sub }}>选择 3-6 个指标展示在成长数据监测中</p>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {ALL_METRICS.map((m) => {
            const on = draft.has(m.id);
            return (
              <button key={m.id} onClick={() => toggle(m.id)}
                className="flex flex-col items-center gap-1 py-3 rounded-[12px] border-[1.5px] transition-all duration-150"
                style={{
                  borderColor: on ? '#94A533' : '#e8eae6',
                  background: on ? '#f4f7ea' : '#fff',
                }}>
                <span className="text-[20px]">{m.emoji}</span>
                <span className="text-[10px] font-medium" style={{ color: on ? '#94A533' : C.sub }}>{m.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button onClick={() => { onSave(Array.from(draft)); onClose(); }}
            className="flex-1 py-2 rounded-[10px] text-[13px] font-medium text-white transition-colors hover:opacity-90"
            style={{ background: '#94A533' }}>
            保存
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded-[10px] text-[13px] font-medium transition-colors hover:bg-[#e8eae6]"
            style={{ color: C.sub, background: '#f0f0ec' }}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Overview Card ───────────────────────────────────────── */

function ChildOverviewCard({ latest, vaccineCount, vacTotal, vacPct, msPct, sleepDays, measurements }: {
  ageMonths: number; latest: Map<string, MeasurementRow>;
  vacPct: number; vaccineCount: number; vacTotal: number; msPct: number;
  todayCount: number; sleepDays: number; measurements: MeasurementRow[];
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_METRICS);

  // Load persisted preference
  useEffect(() => {
    getAppSetting(SETTING_KEY).then((v) => {
      if (v) { try { const arr = JSON.parse(v); if (Array.isArray(arr) && arr.length >= 3) setSelectedIds(arr); } catch { /* ignore */ } }
    }).catch(() => {});
  }, []);

  const handleSave = (ids: string[]) => {
    setSelectedIds(ids);
    setAppSetting(SETTING_KEY, JSON.stringify(ids), isoNow()).catch(() => {});
  };

  const extra = { sleepDays, vaccineCount, vacTotal, vacPct, msPct };
  const visibleMetrics = selectedIds.map((id) => METRIC_MAP.get(id)).filter(Boolean) as MetricDef[];

  // Split into rows of 3
  const row1 = visibleMetrics.slice(0, 3);
  const row2 = visibleMetrics.slice(3, 6);

  const renderGrid = (items: MetricDef[]) => (
    <div className="grid grid-cols-3 gap-3">
      {items.map((m) => {
        const { value, sub } = m.getValue(latest, extra);
        return (
          <div key={m.id} className="rounded-[14px] p-3 transition-colors hover:bg-[#f0f2ee]" style={{ background: '#f7f8f6' }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-[18px]" style={{ background: '#fff' }}>{m.emoji}</div>
              <span className="text-[11px] font-medium" style={{ color: C.sub }}>{m.label}</span>
            </div>
            <p className="text-[20px] font-bold leading-none" style={{ color: C.text }}>{value}</p>
            <p className="text-[10px] mt-1" style={{ color: C.sub }}>{sub}</p>
          </div>
        );
      })}
    </div>
  );

  return (
    <Cd cls="col-span-6 row-span-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-bold" style={{ color: C.text }}>成长数据</h3>
          <span className="text-[10px]" style={{ color: C.sub }}>
            {(() => {
              if (measurements.length === 0) return '暂无记录';
              const latest_ = measurements.reduce((a, b) => a.measuredAt > b.measuredAt ? a : b);
              const d = new Date(latest_.measuredAt);
              const now = new Date();
              const diffD = Math.floor((now.getTime() - d.getTime()) / 86400000);
              if (diffD === 0) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`;
              if (diffD === 1) return '昨天更新';
              if (diffD < 7) return `${diffD}天前更新`;
              return `${d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} 更新`;
            })()}
          </span>
        </div>
        <button onClick={() => setShowSettings(true)}
          className="w-[28px] h-[28px] rounded-full flex items-center justify-center transition-colors hover:bg-[#e8eae6]"
          style={{ color: C.sub }} title="自定义指标">
          <Settings size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {renderGrid(row1)}
        {row2.length > 0 && renderGrid(row2)}
      </div>

      {showSettings && (
        <MetricSettingsModal selected={selectedIds} onSave={handleSave} onClose={() => setShowSettings(false)} />
      )}
    </Cd>
  );
}

function ChildProfileCard({ child, childList, ageY, ageR, pct }: {
  child: ChildProfile; childList: ChildProfile[]; ageY: number; ageR: number; pct: number;
}) {
  const { setActiveChildId } = useAppStore();
  const [flipping, setFlipping] = useState(false);
  const pendingChildRef = useRef<string | null>(null);

  const switchToNext = () => {
    if (childList.length < 2) return;
    const idx = childList.findIndex((c) => c.childId === child.childId);
    const next = childList[(idx + 1) % childList.length]!;
    pendingChildRef.current = next.childId;
    setFlipping(true);
  };

  const handleAnimEnd = () => {
    if (pendingChildRef.current) {
      setActiveChildId(pendingChildRef.current);
      pendingChildRef.current = null;
    }
    setFlipping(false);
  };

  return (
    <div className={`col-span-2 row-span-2 ${C.radius} relative overflow-hidden`}
      style={{ perspective: 800, boxShadow: C.shadow }}>
      <div
        onAnimationEnd={handleAnimEnd}
        className={`w-full h-full ${C.radius} p-6 relative`}
        style={{
          background: C.cardProfile,
          transformStyle: 'preserve-3d',
          animation: flipping ? 'cardFlip 0.5s ease-in-out' : undefined,
        }}
      >
        {/* Switch-child icon (top-right) */}
        {childList.length > 1 && (
          <button onClick={switchToNext}
            className="absolute top-4 right-4 z-10 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
            style={{ color: 'rgba(255,255,255,0.7)' }} title="切换孩子">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        )}

        <div className="relative flex flex-col items-center text-center h-full justify-center">
          {child.avatarPath ? (
            <img src={child.avatarPath} alt="" className="w-[80px] h-[80px] rounded-full object-cover border-[3px] shadow-sm mb-3" style={{ borderColor: 'rgba(255,255,255,0.5)' }} />
          ) : (
            <div className="w-[80px] h-[80px] rounded-full flex items-center justify-center border-[3px] mb-3" style={{ background: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.5)' }}>
              <span className="text-3xl font-bold text-white">{child.displayName.charAt(0)}</span>
            </div>
          )}
          <h2 className="text-lg font-bold text-white">{child.displayName}</h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {ageY > 0 ? `${ageY}岁` : ''}{ageR > 0 ? `${ageR}个月` : ''} · {child.gender === 'female' ? '女孩' : '男孩'}
          </p>
          {/* Record button */}
          <Link to="/profile/growth" className="flex items-center gap-1.5 mt-4 px-5 py-2 rounded-full text-[12px] font-semibold transition-all hover:shadow-lg hover:scale-105"
            style={{ background: '#fff', color: C.cardProfile, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            记录数据
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   REMINDER PANEL (right sidebar)
   ================================================================ */

// Map reminder domain → data recording sub-page route
const DOMAIN_ROUTES: Record<string, string> = {
  vaccine: '/profile/vaccines', growth: '/profile/growth', vision: '/profile/growth',
  dental: '/profile/dental', sleep: '/profile/sleep', 'bone-age': '/profile/growth',
  checkup: '/profile/medical-events', nutrition: '/profile/growth',
};
function advisorRoute(r: ActiveReminder): string {
  const record = DOMAIN_ROUTES[r.rule.domain] ?? '/profile';
  return `/advisor?topic=${encodeURIComponent(r.rule.title)}&desc=${encodeURIComponent(r.rule.description)}&domain=${encodeURIComponent(r.rule.domain)}&record=${encodeURIComponent(record)}`;
}

function ReminderPanel({ reminders, doneKeys, onToggle, onDismiss, seasonalTasks }: {
  reminders: EnhancedReminder[]; doneKeys: Set<string>;
  onToggle: (r: ActiveReminder, currentlyDone: boolean) => void; onDismiss: (r: ActiveReminder) => void;
  seasonalTasks?: DynamicTask[];
}) {
  const reminderKey = useCallback((ruleId: string, repeatIndex: number) => `${ruleId}:${repeatIndex}`, []);
  const [tab, setTab] = useState<'all' | 'todo' | 'done'>('all');

  // Sort: pending first, completed last
  const sorted = useMemo(() => {
    const copy = [...reminders];
    copy.sort((a, b) => {
      const aDone = doneKeys.has(reminderKey(a.rule.ruleId, a.repeatIndex)) ? 1 : 0;
      const bDone = doneKeys.has(reminderKey(b.rule.ruleId, b.repeatIndex)) ? 1 : 0;
      return aDone - bDone;
    });
    return copy;
  }, [reminders, doneKeys, reminderKey]);

  const list = tab === 'all' ? sorted
    : tab === 'todo' ? sorted.filter((r) => !doneKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex)))
    : sorted.filter((r) => doneKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex)));

  return (
    <div className="hidden lg:flex w-[280px] shrink-0 flex-col" style={{ background: '#F8FDFC' }}>
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-bold" style={{ color: C.text }}>提醒事项</h3>
          <Link to="/reminders" className="text-[11px] cursor-pointer hover:underline" style={{ color: C.sub }}>查看全部</Link>
        </div>
        {/* Capsule tabs */}
        <div className="flex gap-1 rounded-full p-1" style={{ background: '#EEF3F1' }}>
          {([['all', '全部'], ['todo', '待办'], ['done', '完成']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className="flex-1 text-[11px] py-1.5 rounded-full font-medium transition-all"
              style={tab === k
                ? { background: '#ffffff', color: '#1a2b4a', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                : { background: 'transparent', color: '#8a94a6' }
              }>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {list.length === 0 ? (
          <p className="text-[12px] text-center py-8" style={{ color: '#d4d1cc' }}>暂无</p>
        ) : list.map((r) => {
          const done = doneKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex));
          return (
            <div key={`${r.rule.ruleId}-${r.repeatIndex}`} className="flex items-start gap-2.5 py-3 border-b group" style={{ borderColor: '#eef3f1' }}>
              {/* Check circle — clicking toggles complete/uncomplete */}
              <button onClick={(e) => { e.stopPropagation(); onToggle(r, done); }}
                className="mt-0.5 w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all"
                style={done ? { background: '#94A533', borderColor: '#94A533', color: '#fff' } : { borderColor: '#c5cad0' }}>
                {done && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
              </button>
              {/* Title area — clicking navigates to advisor with context */}
              <Link to={advisorRoute(r)} className="flex-1 min-w-0 cursor-pointer">
                <p className={`text-[12px] leading-snug ${done ? 'line-through' : 'hover:underline'}`} style={{ color: done ? '#c5cad0' : C.text }}>{r.rule.title}</p>
                {/* Allergy collision warning */}
                {'allergyWarning' in r && r.allergyWarning && (
                  <p className="text-[9px] mt-0.5 px-1.5 py-0.5 rounded inline-block"
                    style={{ background: r.allergyWarning.level === 'danger' ? '#fef2f2' : '#fffbeb', color: r.allergyWarning.level === 'danger' ? '#dc2626' : '#d97706' }}>
                    ⚠ {r.allergyWarning.message}
                  </p>
                )}
                <p className="text-[10px] mt-0.5" style={{ color: '#b0b5bc' }}>
                  {done ? '已完成' : r.status === 'overdue' ? '已过期' : r.status === 'active' ? '今天' : '即将'}
                </p>
              </Link>
              {!done && (
                <button onClick={() => onDismiss(r)} className="text-[10px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#c0bdb8' }}>跳过</button>
              )}
            </div>
          );
        })}
        {/* Seasonal alerts */}
        {seasonalTasks && seasonalTasks.length > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid #eef3f1` }}>
            <p className="text-[10px] font-medium mb-2" style={{ color: '#d97706' }}>季节性提醒</p>
            {seasonalTasks.map((t) => (
              <div key={t.id} className="py-2.5 border-b last:border-0" style={{ borderColor: '#eef3f1' }}>
                <p className="text-[11px] font-medium" style={{ color: C.text }}>{t.title}</p>
                <p className="text-[9px] mt-0.5 leading-relaxed" style={{ color: '#b0b5bc' }}>{t.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
