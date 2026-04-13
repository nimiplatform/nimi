import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import type { ReminderRule } from '../../knowledge-base/gen/reminder-rules.gen.js';
import { getVaccineRecords, insertVaccineRecord } from '../../bridge/sqlite-bridge.js';
import type { VaccineRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { completeReminderByRule } from '../../engine/reminder-actions.js';
import { ProfileDatePicker } from './profile-date-picker.js';

/* ── helpers ──────────────────────────────────────────────── */

function fmtDate(d: string) { return d.split('T')[0]; }

/* ================================================================
   RECORD MODAL
   ================================================================ */

function VaccineRecordModal({ rule, childId, birthDate, ageMonths, onSave, onClose }: {
  rule: ReminderRule; childId: string; birthDate: string; ageMonths: number;
  onSave: (ruleId: string) => void; onClose: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [batch, setBatch] = useState('');
  const [hospital, setHospital] = useState('');
  const [reaction, setReaction] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await insertVaccineRecord({
        recordId: ulid(), childId, ruleId: rule.ruleId,
        vaccineName: rule.title, vaccinatedAt: date,
        ageMonths: computeAgeMonthsAt(birthDate, date),
        batchNumber: batch || null, hospital: hospital || null,
        adverseReaction: reaction || null, photoPath: null, now: isoNow(),
      });
      onSave(rule.ruleId);
      onClose();
    } catch { /* bridge unavailable */ }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className={`w-[420px] ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">💉</span>
            <h2 className="text-[15px] font-bold" style={{ color: S.text }}>{rule.title}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1">
          <p className="text-[12px]" style={{ color: S.sub }}>{rule.description}</p>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>接种日期</label>
            <ProfileDatePicker value={date} onChange={setDate} style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>疫苗批号</label>
              <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="选填"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>接种机构</label>
              <input value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="选填"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8' }} />
            </div>
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>不良反应记录</label>
            <textarea value={reaction} onChange={(e) => setReaction(e.target.value)}
              placeholder="如有不良反应请记录..."
              className={`w-full ${S.radiusSm} px-3 py-2 text-[12px] resize-none outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`} rows={2}
              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8' }} />
          </div>
        </div>

        <div className="px-6 pt-3 pb-5 mt-1">
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
            <button onClick={() => void handleSave()} disabled={saving}
              className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-50`}
              style={{ background: S.accent }}>
              {saving ? '保存中...' : '✅ 记录接种'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   CUSTOM VACCINE MODAL
   ================================================================ */

const REMIND_OPTIONS = [
  { value: '', label: '不提醒' },
  { value: '6', label: '6 个月后提醒' },
  { value: '12', label: '每年提醒' },
  { value: '24', label: '每 2 年提醒' },
  { value: 'custom', label: '自定义...' },
] as const;

function CustomVaccineModal({ childId, birthDate, onSave, onClose }: {
  childId: string; birthDate: string; onSave: () => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [batch, setBatch] = useState('');
  const [hospital, setHospital] = useState('');
  const [reaction, setReaction] = useState('');
  const [remindOption, setRemindOption] = useState('');
  const [customMonths, setCustomMonths] = useState('');
  const [saving, setSaving] = useState(false);

  const remindMonths = remindOption === 'custom' ? parseInt(customMonths, 10) || 0 : parseInt(remindOption, 10) || 0;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const ruleId = `custom-vac-${ulid()}`;
      const notes = remindMonths > 0 ? `[remind:${remindMonths}m]` : null;
      await insertVaccineRecord({
        recordId: ulid(), childId, ruleId,
        vaccineName: name.trim(), vaccinatedAt: date,
        ageMonths: computeAgeMonthsAt(birthDate, date),
        batchNumber: batch || null, hospital: hospital || null,
        adverseReaction: reaction || null, photoPath: null,
        now: isoNow(),
      });
      // If reminder is set, schedule next dose reminder in notes
      if (remindMonths > 0) {
        const nextDate = new Date(date);
        nextDate.setMonth(nextDate.getMonth() + remindMonths);
        const nextRuleId = `custom-vac-next-${ulid()}`;
        // Store a placeholder record with future date as a simple reminder mechanism
        // The notes field carries the reminder metadata
        await insertVaccineRecord({
          recordId: ulid(), childId, ruleId: nextRuleId,
          vaccineName: `${name.trim()} (下次)`, vaccinatedAt: nextDate.toISOString().slice(0, 10),
          ageMonths: computeAgeMonthsAt(birthDate, nextDate.toISOString()),
          batchNumber: null, hospital: null,
          adverseReaction: null, photoPath: null,
          now: isoNow(),
        });
      }
      onSave();
      onClose();
    } catch { /* bridge unavailable */ }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className={`w-[440px] ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">💉</span>
            <h2 className="text-[15px] font-bold" style={{ color: S.text }}>自定义疫苗</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1">
          <p className="text-[11px]" style={{ color: S.sub }}>
            添加非计划内疫苗（如流感疫苗、自费疫苗等），可设置定期提醒。
          </p>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>疫苗名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：流感疫苗、水痘疫苗"
              className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
              style={{ background: '#fafaf8', color: S.text, borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>接种日期 *</label>
              <ProfileDatePicker value={date} onChange={setDate} style={{ background: '#fafaf8', color: S.text, borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>接种机构</label>
              <input value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="选填"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ background: '#fafaf8', color: S.text, borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>疫苗批号</label>
              <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="选填"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ background: '#fafaf8', color: S.text, borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>不良反应</label>
              <input value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="如有请记录"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ background: '#fafaf8', color: S.text, borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
          </div>

          {/* Reminder setting */}
          <div className={`${S.radiusSm} p-3`} style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
            <label className="text-[11px] mb-2 block font-medium" style={{ color: S.text }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline mr-1 -mt-0.5">
                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
              </svg>
              下次接种提醒
            </label>
            <div className="flex flex-wrap gap-1.5">
              {REMIND_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => setRemindOption(opt.value)}
                  className={`px-3 py-1.5 text-[11px] rounded-full transition-all ${remindOption === opt.value ? 'text-white font-medium' : ''}`}
                  style={remindOption === opt.value
                    ? { background: S.accent, color: '#fff' }
                    : { background: S.card, border: `1px solid ${S.border}`, color: S.sub }
                  }>
                  {opt.label}
                </button>
              ))}
            </div>
            {remindOption === 'custom' && (
              <div className="flex items-center gap-2 mt-2">
                <input type="number" min="1" max="120" value={customMonths} onChange={(e) => setCustomMonths(e.target.value)}
                  placeholder="月数" className={`w-20 ${S.radiusSm} px-2 py-1.5 text-[12px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                  style={{ background: '#fafaf8', border: `1px solid ${S.border}`, color: S.text }} />
                <span className="text-[11px]" style={{ color: S.sub }}>个月后提醒</span>
              </div>
            )}
            {remindMonths > 0 && (
              <p className="text-[10px] mt-2" style={{ color: S.accent }}>
                将在 {new Date(new Date(date).setMonth(new Date(date).getMonth() + remindMonths)).toLocaleDateString('zh-CN')} 前后提醒下次接种
              </p>
            )}
          </div>
        </div>

        <div className="px-6 pt-3 pb-5 mt-1">
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
            <button onClick={() => void handleSave()} disabled={saving || !name.trim()}
              className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-40`}
              style={{ background: S.accent }}>
              {saving ? '保存中...' : '记录接种'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   HISTORICAL COLLAPSIBLE SECTION
   ================================================================ */

function HistoricalSection({ rules, onRecord, onMarkAll, onQuickMark }: {
  rules: ReminderRule[]; onRecord: (ruleId: string) => void; onMarkAll: () => void; onQuickMark: (ruleId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());

  const handleQuickMark = (ruleId: string) => {
    setMarkedIds((prev) => new Set([...prev, ruleId]));
    onQuickMark(ruleId);
  };

  const remaining = rules.filter((r) => !markedIds.has(r.ruleId));
  const marked = rules.filter((r) => markedIds.has(r.ruleId));

  return (
    <div className={`${S.radius} mb-5 overflow-hidden`} style={{ background: '#fafafa', border: `1px solid ${S.border}` }}>
      {/* Collapsed header */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-[#f5f5f3]">
        <div className="flex items-center gap-2">
          <span className="text-[14px]">📋</span>
          <span className="text-[12px] font-medium" style={{ color: S.sub }}>
            有 {remaining.length} 项历史疫苗待补录
            {marked.length > 0 && <span className="ml-1 text-[10px]" style={{ color: S.accent }}>（已标记 {marked.length} 项）</span>}
          </span>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={S.sub} strokeWidth="2" strokeLinecap="round"
          className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-4">
          <p className="text-[10px] mb-3" style={{ color: S.sub }}>
            点击左侧圆圈快速标记已接种，点击"补录"可填写详细接种信息（批号、机构等）。
          </p>
          {/* Mark all button */}
          {remaining.length > 0 && (
            <button onClick={() => { remaining.forEach((r) => handleQuickMark(r.ruleId)); onMarkAll(); }}
              className={`w-full mb-3 py-2 text-[11px] font-medium ${S.radiusSm} transition-colors hover:opacity-90`}
              style={{ background: S.accent, color: '#fff' }}>
              全部标记为已接种（{remaining.length} 项）
            </button>
          )}
          {/* Remaining items */}
          <div className="space-y-1.5">
            {remaining.map((r) => (
              <div key={r.ruleId} className={`flex items-center gap-2.5 p-2.5 ${S.radiusSm} group`}
                style={{ background: S.card, border: `1px solid ${S.border}` }}>
                {/* Quick-mark circle */}
                <button onClick={() => handleQuickMark(r.ruleId)}
                  className="w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all hover:border-[#94A533] hover:bg-[#94A533]/10"
                  style={{ borderColor: '#c5cad0' }}
                  title="点击标记为已接种" />
                <span className="flex-1 text-[11px]" style={{ color: S.text }}>{r.title}</span>
                <button onClick={() => onRecord(r.ruleId)}
                  className={`px-2.5 py-1 text-[10px] font-medium ${S.radiusSm} transition-colors hover:bg-[#e8e5e0]`}
                  style={{ background: '#f0f0ec', color: S.sub }}>
                  补录
                </button>
              </div>
            ))}
          </div>
          {/* Already marked items */}
          {marked.length > 0 && (
            <>
              <p className="text-[10px] mt-4 mb-2 font-medium" style={{ color: S.accent }}>已标记为接种 ✓</p>
              <div className="space-y-1">
                {marked.map((r) => (
                  <div key={r.ruleId} className={`flex items-center gap-2.5 p-2 ${S.radiusSm}`}
                    style={{ background: '#f4f7ea', border: `1px solid ${S.accent}40` }}>
                    <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0"
                      style={{ background: S.accent, color: '#fff' }}>
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                    </div>
                    <span className="flex-1 text-[11px] line-through" style={{ color: '#b0b5a0' }}>{r.title}</span>
                    <button onClick={() => onRecord(r.ruleId)}
                      className={`px-2.5 py-1 text-[10px] ${S.radiusSm} transition-colors hover:bg-[#e8e5e0]`}
                      style={{ color: S.sub }}>
                      补录详情
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function VaccinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<VaccineRecordRow[]>([]);
  const [recordingRuleId, setRecordingRuleId] = useState<string | null>(() => searchParams.get('ruleId'));
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'list'>('timeline');

  useEffect(() => {
    if (activeChildId) getVaccineRecords(activeChildId).then(setRecords).catch(catchLog('vaccine', 'action:load-vaccine-records-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const vaccineRules = REMINDER_RULES.filter((r) => r.domain === 'vaccine');
  const recordedRuleIds = new Set(records.map((r) => r.ruleId));
  const completedCount = vaccineRules.filter((r) => recordedRuleIds.has(r.ruleId)).length;
  const pct = vaccineRules.length > 0 ? Math.round((completedCount / vaccineRules.length) * 100) : 0;

  const reload = () => { getVaccineRecords(child.childId).then(setRecords).catch(catchLog('vaccine', 'action:reload-vaccine-records-failed')); };

  const clearRuleSearch = () => {
    if (!searchParams.has('ruleId')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('ruleId');
    setSearchParams(next, { replace: true });
  };

  /* ── Upcoming vaccines: only current window or recently overdue (≤12月) ── */
  const upcoming = useMemo(() =>
    vaccineRules.filter((r) => {
      if (recordedRuleIds.has(r.ruleId)) return false;
      const end = r.triggerAge.endMonths === -1 ? 999 : r.triggerAge.endMonths;
      // In current window or up to 12 months past the end
      return ageMonths >= r.triggerAge.startMonths - 1 && ageMonths <= end + 12;
    }).slice(0, 5),
  [ageMonths, recordedRuleIds, vaccineRules]);

  /* ── Historical unrecorded: overdue by >12 months, likely just not entered ── */
  const historicalUnrecorded = useMemo(() =>
    vaccineRules.filter((r) => {
      if (recordedRuleIds.has(r.ruleId)) return false;
      const end = r.triggerAge.endMonths === -1 ? 999 : r.triggerAge.endMonths;
      return ageMonths > end + 12;
    }),
  [ageMonths, recordedRuleIds, vaccineRules]);

  /* ── Timeline: group by age buckets ────────────────────── */
  const ageBuckets = useMemo(() => {
    const buckets: Array<{ startMonth: number; endMonth: number; label: string; rules: ReminderRule[] }> = [];
    const ranges: Array<[number, number, string]> = [
      [0, 1, '出生时'], [2, 3, '2-3 个月'], [4, 6, '4-6 个月'],
      [7, 9, '7-9 个月'], [10, 12, '10-12 个月'], [13, 18, '13-18 个月'],
      [19, 24, '19-24 个月'], [25, 36, '2-3 岁'], [37, 48, '3-4 岁'],
      [49, 72, '4-6 岁'], [73, 144, '6-12 岁'], [145, 216, '12-18 岁'],
    ];
    for (const [s, e, lbl] of ranges) {
      const rs = vaccineRules.filter((r) => r.triggerAge.startMonths >= s && r.triggerAge.startMonths <= e);
      if (rs.length > 0) buckets.push({ startMonth: s, endMonth: e, label: lbl, rules: rs });
    }
    return buckets.reverse(); // newest first
  }, [vaccineRules]);

  const recordingRule = recordingRuleId ? vaccineRules.find((r) => r.ruleId === recordingRuleId) : null;

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: S.text }}>疫苗接种</h1>
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[360px] rounded-xl p-4 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
              style={{ background: '#1a2b4a', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <p className="text-[12px] font-semibold text-white mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[#c8e64a] font-medium">国家免疫规划疫苗（免费）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">国家卫生健康委员会. 国家免疫规划疫苗儿童免疫程序及说明（2021年版）.</span>
                  <span className="block text-[10px] text-[#7a8090]">国卫办疾控函〔2021〕196号</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">非免疫规划疫苗（自费推荐）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">中华预防医学会. 非免疫规划疫苗使用指南（2023版）.</span>
                  <span className="block text-[10px] text-[#7a8090]">中华流行病学杂志 2023;44(10):1521-1570 · 含流感、HPV、水痘、轮状病毒等推荐接种方案</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">WHO 全球免疫立场文件</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">WHO Position Papers on Vaccines. Weekly Epidemiological Record (WER).</span>
                  <span className="block text-[10px] text-[#7a8090]">覆盖: BCG · 乙肝 · 百白破 · 脊灰 · 麻腮风 · 流脑 · 乙脑 · 甲肝等</span>
                </li>
              </ul>
              <p className="text-[9px] mt-2.5 pt-2 border-t border-white/10 text-[#808890]">接种窗口和时间表以国家免疫规划为准 · 自费疫苗仅供参考 · 具体请遵医嘱</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCustomModal(true)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
            style={{ background: S.accent, boxShadow: '0 2px 6px rgba(148,165,51,0.25)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            自定义疫苗
          </button>
          <span className="text-[12px] px-3 py-1 rounded-full" style={{ background: '#f4f7ea', color: S.accent }}>
            {completedCount}/{vaccineRules.length} · {pct}%
          </span>
        </div>
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>

      {/* Progress bar */}
      <div className={`${S.radius} p-4 mb-5`} style={{ background: S.card, boxShadow: S.shadow }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium" style={{ color: S.text }}>接种进度</span>
          <span className="text-[12px] font-bold" style={{ color: S.accent }}>{pct}%</span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: S.border }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ background: S.accentBar, width: `${pct}%` }} />
        </div>
      </div>

      {/* AI Summary */}
      <AISummaryCard domain="vaccine" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={completedCount > 0 ? `已接种 ${completedCount}/${vaccineRules.length} 项疫苗 (${pct}%)。${upcoming.length > 0 ? `待接种: ${upcoming.map((r) => r.title).join('、')}` : '所有疫苗已完成'}` : ''} />

      {/* ── Upcoming vaccines (主动推送) ──────────────────── */}
      {upcoming.length > 0 && (
        <div className={`${S.radius} p-5 mb-5`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[16px]">🔔</span>
            <h3 className="text-[13px] font-semibold" style={{ color: S.text }}>待接种疫苗</h3>
          </div>
          <div className="space-y-2">
            {upcoming.map((r) => {
              const isOverdue = ageMonths > r.triggerAge.endMonths && r.triggerAge.endMonths !== -1;
              return (
                <div key={r.ruleId} className={`flex items-center gap-3 p-3 ${S.radiusSm}`}
                  style={{ background: isOverdue ? '#fef8f8' : '#f9faf7', border: `1px solid ${isOverdue ? '#fecaca' : S.border}` }}>
                  <div className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[14px] shrink-0"
                    style={{ background: isOverdue ? '#fee2e2' : '#e8f5e9' }}>
                    {isOverdue ? '⚠️' : '💉'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: S.text }}>{r.title}</p>
                    <p className="text-[10px]" style={{ color: isOverdue ? '#dc2626' : S.sub }}>
                      {isOverdue ? `已过建议接种窗口 (${formatAge(r.triggerAge.startMonths)}-${formatAge(r.triggerAge.endMonths)})` : `建议 ${formatAge(r.triggerAge.startMonths)}-${r.triggerAge.endMonths === -1 ? '无上限' : formatAge(r.triggerAge.endMonths)}接种`}
                    </p>
                  </div>
                  <button onClick={() => setRecordingRuleId(r.ruleId)}
                    className={`px-3 py-1 text-[11px] font-medium text-white ${S.radiusSm} transition-colors hover:opacity-90`}
                    style={{ background: S.accent }}>记录</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Historical unrecorded — collapsible ──────────── */}
      {historicalUnrecorded.length > 0 && (
        <HistoricalSection rules={historicalUnrecorded}
          onRecord={(id) => setRecordingRuleId(id)}
          onQuickMark={(ruleId) => {
            const rule = historicalUnrecorded.find((r) => r.ruleId === ruleId);
            if (!rule) return;
            const now = isoNow();
            insertVaccineRecord({
              recordId: ulid(), childId: child.childId, ruleId,
              vaccineName: rule.title, vaccinatedAt: now.split('T')[0] ?? now,
              ageMonths: computeAgeMonthsAt(child.birthDate, now),
              batchNumber: null, hospital: null, adverseReaction: null, photoPath: null, now,
            }).then(async () => {
              await completeReminderByRule({ childId: child.childId, ruleId });
              reload();
            }).catch(catchLog('vaccine', 'action:quick-record-vaccine-failed'));
          }}
          onMarkAll={() => {
            (async () => {
              const now = isoNow();
              for (const r of historicalUnrecorded) {
                try {
                  await insertVaccineRecord({
                    recordId: ulid(), childId: child.childId, ruleId: r.ruleId,
                    vaccineName: r.title, vaccinatedAt: now.split('T')[0] ?? now,
                    ageMonths: computeAgeMonthsAt(child.birthDate, now),
                    batchNumber: null, hospital: null, adverseReaction: null, photoPath: null, now,
                  });
                  await completeReminderByRule({ childId: child.childId, ruleId: r.ruleId });
                } catch { /* skip duplicates */ }
              }
              reload();
            })();
          }} />
      )}

      {/* ── View toggle ──────────────────────────────────────── */}
      <div className="flex gap-1 rounded-full p-1 mb-5 w-fit" style={{ background: '#eceeed' }}>
        {([['timeline', '📋 时间轴'], ['list', '📊 列表']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            className="px-4 py-1.5 text-[11px] font-medium rounded-full transition-all"
            style={activeTab === k
              ? { background: S.card, color: S.text, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
              : { color: S.sub }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Timeline view ────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="relative">
          <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

          {ageBuckets.map((bucket) => {
            const isCurrent = ageMonths >= bucket.startMonth && ageMonths <= bucket.endMonth;
            const isPast = ageMonths > bucket.endMonth;
            const isFuture = ageMonths < bucket.startMonth;
            const bucketComplete = bucket.rules.every((r) => recordedRuleIds.has(r.ruleId));

            return (
              <div key={bucket.label} className={`relative pl-10 pb-6 ${isFuture ? 'opacity-40' : ''}`}>
                <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center"
                  style={{
                    background: bucketComplete ? S.accent : isCurrent ? '#fff' : '#eceeed',
                    borderColor: bucketComplete ? S.accent : isCurrent ? S.accent : S.border,
                  }}>
                  {bucketComplete && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" fill="none" /></svg>}
                  {isCurrent && !bucketComplete && <div className="w-[6px] h-[6px] rounded-full" style={{ background: S.accent }} />}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: isCurrent ? S.accent : S.text }}>{bucket.label}</span>
                  {isCurrent && <span className="text-[9px] px-2 py-0.5 rounded-full text-white" style={{ background: S.accent }}>当前阶段</span>}
                  {bucketComplete && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: '#f4f7ea', color: S.accent }}>全部完成</span>}
                </div>

                <div className="space-y-1.5">
                  {bucket.rules.map((r) => {
                    const done = recordedRuleIds.has(r.ruleId);
                    const rec = records.find((x) => x.ruleId === r.ruleId);

                    return (
                      <div key={r.ruleId}
                        className={`flex items-center gap-2.5 p-2.5 ${S.radiusSm} transition-all duration-150`}
                        style={{ background: done ? '#f4f7ea' : S.card, border: `1px solid ${done ? S.accent + '40' : S.border}` }}>
                        {done ? (
                          <div className="w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0"
                            style={{ background: S.accent, color: '#fff' }}>
                            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                          </div>
                        ) : (
                          <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[14px] shrink-0"
                            style={{ background: '#e8f5e9' }}>💉</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium" style={{ color: done ? S.accent : S.text }}>{r.title}</p>
                          <p className="text-[10px] truncate" style={{ color: S.sub }}>
                            {done && rec ? `${fmtDate(rec.vaccinatedAt)} 接种${rec.hospital ? ` · ${rec.hospital}` : ''}` : r.description}
                          </p>
                        </div>
                        {done ? (
                          <button onClick={() => setRecordingRuleId(r.ruleId)}
                            className="text-[10px] shrink-0 px-2 py-1 rounded-full hover:bg-[#e8e5e0] transition-colors"
                            style={{ color: S.sub }}>修改</button>
                        ) : (
                          <button onClick={() => setRecordingRuleId(r.ruleId)}
                            className="text-[10px] shrink-0 px-2 py-1 rounded-full hover:bg-[#f0f0ec]"
                            style={{ color: S.sub }}>记录</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── List view (simple) ───────────────────────────────── */}
      {activeTab === 'list' && (
        <div className="space-y-2">
          {vaccineRules.map((r) => {
            const done = recordedRuleIds.has(r.ruleId);
            const rec = records.find((x) => x.ruleId === r.ruleId);
            const isOverdue = !done && ageMonths > r.triggerAge.endMonths && r.triggerAge.endMonths !== -1;

            return (
              <div key={r.ruleId} className={`flex items-center gap-3 p-3 ${S.radiusSm}`}
                style={{ background: done ? '#f4f7ea' : isOverdue ? '#fef8f8' : S.card, border: `1px solid ${done ? S.accent + '40' : isOverdue ? '#fecaca' : S.border}` }}>
                {done ? (
                  <div className="w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0" style={{ background: S.accent, color: '#fff' }}>
                    <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                  </div>
                ) : (
                  <div className="w-[24px] h-[24px] rounded-full border-[1.5px] shrink-0" style={{ borderColor: isOverdue ? '#fca5a5' : S.border }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium" style={{ color: done ? S.accent : S.text }}>{r.title}</p>
                  <p className="text-[10px]" style={{ color: S.sub }}>
                    {done && rec ? fmtDate(rec.vaccinatedAt) : `${formatAge(r.triggerAge.startMonths)}-${r.triggerAge.endMonths === -1 ? '∞' : formatAge(r.triggerAge.endMonths)}`}
                    {isOverdue && ' · 已过期'}
                  </p>
                </div>
                {done ? (
                  <button onClick={() => setRecordingRuleId(r.ruleId)}
                    className={`px-3 py-1 text-[11px] font-medium ${S.radiusSm} transition-colors hover:bg-[#e8e5e0]`}
                    style={{ color: S.sub }}>修改</button>
                ) : (
                  <button onClick={() => setRecordingRuleId(r.ruleId)}
                    className={`px-3 py-1 text-[11px] font-medium text-white ${S.radiusSm}`}
                    style={{ background: S.accent }}>记录</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Record modal ─────────────────────────────────────── */}
      {recordingRule && (
        <VaccineRecordModal
          rule={recordingRule}
          childId={child.childId}
          birthDate={child.birthDate}
          ageMonths={ageMonths}
          onSave={(ruleId) => {
            void completeReminderByRule({ childId: child.childId, ruleId }).then(() => {
              reload();
              clearRuleSearch();
            });
          }}
          onClose={() => {
            setRecordingRuleId(null);
            clearRuleSearch();
          }}
        />
      )}

      {/* ── Custom vaccine modal ─────────────────────────────── */}
      {showCustomModal && (
        <CustomVaccineModal
          childId={child.childId}
          birthDate={child.birthDate}
          onSave={reload}
          onClose={() => setShowCustomModal(false)}
        />
      )}
    </div>
  );
}
