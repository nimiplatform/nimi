import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { REMINDER_RULES, SENSITIVE_PERIODS, MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import { computeActiveReminders, partitionReminders } from '../../engine/reminder-engine.js';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import { buildAllergyProfile, interceptAllergyCollisions, getActiveSeasonalAlerts, type EnhancedReminder, type DynamicTask } from '../../engine/smart-alerts.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { upsertReminderState } from '../../bridge/sqlite-bridge.js';
import {
  useDash, pctComplete, latestByType, wkActivity, fmtRel,
  C, QLINKS, DOMAIN_ROUTES,
} from './timeline-data.js';
import {
  Cd, Bar, Hdr,
  ChildProfileCard, ChildOverviewCard,
} from './timeline-cards.js';

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
          <ChildOverviewCard latest={latest} vacPct={vacPct} vaccineCount={d.vaccineCount} vacTotal={vacTotal} msPct={msPct} sleepDays={d.sleepRecords.length} measurements={d.measurements} />

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
   REMINDER PANEL (right sidebar)
   ================================================================ */

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
