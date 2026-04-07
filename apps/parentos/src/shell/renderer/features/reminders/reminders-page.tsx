import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { computeActiveReminders, partitionReminders } from '../../engine/reminder-engine.js';
import type { ActiveReminder, ReminderState } from '../../engine/reminder-engine.js';
import { getReminderStates, upsertReminderState } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { useEffect } from 'react';

/* ── design tokens (shared with timeline) ──────────────── */

const C = {
  bg: '#E5ECEC', card: '#ffffff', accent: '#c8e64a',
  text: '#1a2b4a', sub: '#8a8f9a', grad1: '#3a6fb0',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
} as const;

/* ── data hook ─────────────────────────────────────────── */

function useReminderData(childId: string | null) {
  const [states, setStates] = useState<ReminderState[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await getReminderStates(childId);
      setStates(rows.map((s) => ({
        stateId: s.stateId, childId: s.childId, ruleId: s.ruleId,
        status: s.status as ReminderState['status'],
        repeatIndex: s.repeatIndex, completedAt: s.completedAt, dismissedAt: s.dismissedAt,
      })));
    } catch { /* bridge unavailable */ }
    setLoading(false);
  }, [childId]);

  useEffect(() => { load(); }, [load]);
  return { states, loading, reload: load };
}

/* ── domain labels ─────────────────────────────────────── */

const DOMAIN_LABELS: Record<string, string> = {
  vaccine: '疫苗', growth: '生长', vision: '视力', dental: '口腔',
  sleep: '睡眠', 'bone-age': '骨龄', checkup: '体检', nutrition: '营养',
  sensitivity: '敏感期', interest: '兴趣',
};

/* ── main page ─────────────────────────────────────────── */

export default function RemindersPage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((c) => c.childId === activeChildId);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const { states, loading, reload } = useReminderData(activeChildId);
  const reminderKey = useCallback((ruleId: string, repeatIndex: number) => `${ruleId}:${repeatIndex}`, []);

  const allReminders = useMemo(
    () => child ? computeActiveReminders(REMINDER_RULES, ageMonths, child.nurtureMode, child.nurtureModeOverrides, []) : [],
    [child, ageMonths],
  );
  const { today, upcoming } = useMemo(() => partitionReminders(allReminders), [allReminders]);
  const dismissedKeys = useMemo(
    () => new Set(states.filter((s) => s.status === 'dismissed').map((s) => reminderKey(s.ruleId, s.repeatIndex))),
    [states, reminderKey],
  );
  const allRem = useMemo(
    () => [...today, ...upcoming].filter((r) => !dismissedKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex))),
    [today, upcoming, dismissedKeys, reminderKey],
  );

  const doneKeys = useMemo(
    () => new Set(states.filter((s) => s.status === 'completed').map((s) => reminderKey(s.ruleId, s.repeatIndex))),
    [states, reminderKey],
  );

  const handleToggle = useCallback(async (rem: ActiveReminder, currentlyDone: boolean) => {
    if (!child) return;
    const now = isoNow();
    const action = currentlyDone ? 'active' : 'completed';
    try {
      await upsertReminderState({
        stateId: ulid(), childId: child.childId, ruleId: rem.rule.ruleId, status: action, activatedAt: null,
        completedAt: action === 'completed' ? now : null, dismissedAt: null,
        dismissReason: null, repeatIndex: rem.repeatIndex, nextTriggerAt: null, notes: null, now,
      });
      reload();
    } catch { /* bridge unavailable */ }
  }, [child, reload]);

  // Sort: pending first, completed last; within each group sort by effectiveAgeMonths
  const sorted = useMemo(() => {
    const copy = [...allRem];
    copy.sort((a, b) => {
      const aDone = doneKeys.has(reminderKey(a.rule.ruleId, a.repeatIndex)) ? 1 : 0;
      const bDone = doneKeys.has(reminderKey(b.rule.ruleId, b.repeatIndex)) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return a.effectiveAgeMonths - b.effectiveAgeMonths;
    });
    return copy;
  }, [allRem, doneKeys, reminderKey]);

  if (!child) return (
    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: C.bg, color: C.sub }}>
      <p className="text-lg font-medium">还没有添加孩子</p>
      <Link to="/timeline" className="text-sm hover:underline" style={{ color: C.text }}>返回首页 →</Link>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-full" style={{ background: C.bg }}>
      <p className="text-sm" style={{ color: C.sub }}>加载中...</p>
    </div>
  );

  const doneCount = sorted.filter((r) => doneKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex))).length;

  return (
    <div className="h-full overflow-y-auto" style={{ background: C.bg }}>
      <div className="max-w-[720px] mx-auto px-5 py-6">

        {/* Header with back button */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/timeline" className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/[0.04] transition-colors" style={{ color: C.text }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-[18px] font-bold" style={{ color: C.text }}>提醒事项</h1>
            <p className="text-[12px] mt-0.5" style={{ color: C.sub }}>
              共 {sorted.length} 项 · 已完成 {doneCount} 项
            </p>
          </div>
        </div>

        {/* Reminder list */}
        <div className="bg-white rounded-[18px] overflow-hidden" style={{ boxShadow: C.shadow }}>
          {sorted.length === 0 ? (
            <p className="text-[13px] text-center py-12" style={{ color: '#d4d1cc' }}>暂无提醒</p>
          ) : sorted.map((r, i) => {
            const done = doneKeys.has(reminderKey(r.rule.ruleId, r.repeatIndex));
            const domainLabel = DOMAIN_LABELS[r.rule.domain] ?? r.rule.domain;
            return (
              <div key={`${r.rule.ruleId}-${r.repeatIndex}`}
                className="flex items-start gap-3 px-5 py-4 group"
                style={{ borderBottom: i < sorted.length - 1 ? '1px solid #f0f0ec' : undefined }}>

                {/* Toggle checkbox */}
                <button onClick={() => handleToggle(r, done)}
                  className="mt-0.5 w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all"
                  style={done ? { background: '#4caf50', borderColor: '#4caf50', color: '#fff' } : { borderColor: '#c5cad0' }}>
                  {done && <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] leading-snug ${done ? 'line-through' : ''}`}
                    style={{ color: done ? '#c5cad0' : C.text }}>
                    {r.rule.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#f0f0ec', color: C.sub }}>{domainLabel}</span>
                    <span className="text-[10px]" style={{ color: '#b0b5bc' }}>
                      {done ? '已完成' : r.status === 'overdue' ? '已过期' : r.status === 'active' ? '今天' : formatAge(r.effectiveAgeMonths)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
