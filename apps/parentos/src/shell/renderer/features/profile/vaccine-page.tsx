import { Button, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import type { ReminderRule } from '../../knowledge-base/gen/reminder-rules.gen.js';
import { getVaccineRecords, insertVaccineRecord } from '../../bridge/sqlite-bridge.js';
import type { VaccineRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { completeReminderByRule } from '../../engine/reminder-actions.js';
import { ProfileDatePicker } from './profile-date-picker.js';

/* ── helpers ──────────────────────────────────────────────── */

function fmtDate(d: string) { return d.split('T')[0]; }

/* ================================================================
   RECORD MODAL
   ================================================================ */

function VaccineRecordModal({ rule, childId, birthDate, onSave, onClose }: {
  rule: ReminderRule; childId: string; birthDate: string;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nimi-scrim-modal)]" onClick={onClose}>
      <Surface
        tone="overlay"
        material="glass-thick"
        elevation="modal"
        padding="none"
        className="flex w-[420px] flex-col rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">💉</span>
            <h2 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">{rule.title}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-muted)]">✕</button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1">
          <p className="text-[14px] text-[var(--nimi-text-muted)]">{rule.description}</p>
          <div>
            <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">接种日期</label>
            <ProfileDatePicker value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">疫苗批号</label>
              <TextField value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="选填" className="w-full" />
            </div>
            <div>
              <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">接种机构</label>
              <TextField value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="选填" className="w-full" />
            </div>
          </div>
          <div>
            <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">不良反应记录</label>
            <TextareaField value={reaction} onChange={(e) => setReaction(e.target.value)}
              placeholder="如有不良反应请记录..."
              className="w-full" rows={2} />
          </div>
        </div>

        <div className="px-6 pt-3 pb-5 mt-1">
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose} tone="ghost" size="md">取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving} tone="primary" size="md">
              {saving ? '保存中...' : '✅ 记录接种'}
            </Button>
          </div>
        </div>
      </Surface>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nimi-scrim-modal)]" onClick={onClose}>
      <Surface
        tone="overlay"
        material="glass-thick"
        elevation="modal"
        padding="none"
        className="flex w-[440px] flex-col rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">💉</span>
            <h2 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">自定义疫苗</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-muted)]">✕</button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1">
          <p className="text-[13px] text-[var(--nimi-text-muted)]">
            添加非计划内疫苗（如流感疫苗、自费疫苗等），可设置定期提醒。
          </p>
          <div>
            <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">疫苗名称 *</label>
            <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="如：流感疫苗、水痘疫苗" className="w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">接种日期 *</label>
              <ProfileDatePicker value={date} onChange={setDate} />
            </div>
            <div>
              <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">接种机构</label>
              <TextField value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="选填" className="w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">疫苗批号</label>
              <TextField value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="选填" className="w-full" />
            </div>
            <div>
              <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">不良反应</label>
              <TextField value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="如有请记录" className="w-full" />
            </div>
          </div>

          {/* Reminder setting */}
          <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
            <label className="text-[13px] mb-2 block font-medium text-[var(--nimi-text-primary)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline mr-1 -mt-0.5">
                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
              </svg>
              下次接种提醒
            </label>
            <div className="flex flex-wrap gap-1.5">
              {REMIND_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => setRemindOption(opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-all ${remindOption === opt.value ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] font-medium text-[var(--nimi-action-primary-text)]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {remindOption === 'custom' && (
              <div className="flex items-center gap-2 mt-2">
                <TextField type="number" min="1" max="120" value={customMonths} onChange={(e) => setCustomMonths(e.target.value)}
                  placeholder="月数" className="w-20" />
                <span className="text-[13px] text-[var(--nimi-text-muted)]">个月后提醒</span>
              </div>
            )}
            {remindMonths > 0 && (
              <p className="text-[12px] mt-2 text-[var(--nimi-action-primary-bg)]">
                将在 {new Date(new Date(date).setMonth(new Date(date).getMonth() + remindMonths)).toLocaleDateString('zh-CN')} 前后提醒下次接种
              </p>
            )}
          </div>
        </div>

        <div className="px-6 pt-3 pb-5 mt-1">
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose} tone="ghost" size="md">取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !name.trim()} tone="primary" size="md">
              {saving ? '保存中...' : '记录接种'}
            </Button>
          </div>
        </div>
      </Surface>
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
    <Surface tone="card" material="glass-regular" elevation="base" padding="none" className="mb-5 overflow-hidden rounded-3xl">
      {/* Collapsed header */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">📋</span>
          <span className="text-[14px] font-medium text-[var(--nimi-text-muted)]">
            有 {remaining.length} 项历史疫苗待补录
            {marked.length > 0 && <span className="ml-1 text-[12px] text-[var(--nimi-action-primary-bg)]">（已标记 {marked.length} 项）</span>}
          </span>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={'var(--nimi-text-muted)'} strokeWidth="2" strokeLinecap="round"
          className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-4">
          <p className="text-[12px] mb-3 text-[var(--nimi-text-muted)]">
            点击左侧圆圈快速标记已接种，点击"补录"可填写详细接种信息（批号、机构等）。
          </p>
          {/* Mark all button */}
          {remaining.length > 0 && (
            <Button
              onClick={() => { remaining.forEach((r) => handleQuickMark(r.ruleId)); onMarkAll(); }}
              tone="primary"
              size="md"
              fullWidth
              className="mb-3"
            >
              全部标记为已接种（{remaining.length} 项）
            </Button>
          )}
          {/* Remaining items */}
          <div className="space-y-1.5">
            {remaining.map((r) => (
              <div key={r.ruleId} className="group flex items-center gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-2.5">
                {/* Quick-mark circle */}
                <button onClick={() => handleQuickMark(r.ruleId)}
                  className="w-[20px] h-[20px] rounded-full border-[1.5px] border-[var(--nimi-border-strong)] flex items-center justify-center shrink-0 transition-all hover:border-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)]"
                  title="点击标记为已接种" />
                <span className="flex-1 text-[13px] text-[var(--nimi-text-primary)]">{r.title}</span>
                <Button onClick={() => onRecord(r.ruleId)} tone="ghost" size="sm">
                  补录
                </Button>
              </div>
            ))}
          </div>
          {/* Already marked items */}
          {marked.length > 0 && (
            <>
              <p className="text-[12px] mt-4 mb-2 font-medium text-[var(--nimi-action-primary-bg)]">已标记为接种 ✓</p>
              <div className="space-y-1">
                {marked.map((r) => (
                  <div key={r.ruleId} className="flex items-center gap-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_34%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] p-2">
                    <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                    </div>
                    <span className="flex-1 text-[13px] line-through text-[var(--nimi-text-muted)]">{r.title}</span>
                    <Button onClick={() => onRecord(r.ruleId)} tone="ghost" size="sm">
                      补录详情
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Surface>
  );
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function VaccinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<VaccineRecordRow[]>([]);
  const [recordingRuleId, setRecordingRuleId] = useState<string | null>(() => searchParams.get('ruleId'));
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'list'>('timeline');

  useEffect(() => {
    if (activeChildId) getVaccineRecords(activeChildId).then(setRecords).catch(catchLog('vaccine', 'action:load-vaccine-records-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-[var(--nimi-text-muted)]">请先添加孩子</div>;

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
    <div className="max-w-3xl mx-auto min-h-full px-6 pb-6 pt-[72px]">
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[14px] hover:underline text-[var(--nimi-text-muted)]">← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-[var(--nimi-text-primary)]">疫苗接种</h1>
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-muted)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[360px] rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-4 text-[13px] leading-relaxed text-[var(--nimi-text-secondary)] opacity-0 shadow-[var(--nimi-elevation-floating)] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
              <p className="text-[14px] font-semibold text-[var(--nimi-text-primary)] mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[var(--nimi-action-primary-bg)] font-medium">国家免疫规划疫苗（免费）</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)] mt-0.5">国家卫生健康委员会. 国家免疫规划疫苗儿童免疫程序及说明（2021年版）.</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)]">国卫办疾控函〔2021〕196号</span>
                </li>
                <li>
                  <span className="text-[var(--nimi-action-primary-bg)] font-medium">非免疫规划疫苗（自费推荐）</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)] mt-0.5">中华预防医学会. 非免疫规划疫苗使用指南（2023版）.</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)]">中华流行病学杂志 2023;44(10):1521-1570 · 含流感、HPV、水痘、轮状病毒等推荐接种方案</span>
                </li>
                <li>
                  <span className="text-[var(--nimi-action-primary-bg)] font-medium">WHO 全球免疫立场文件</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)] mt-0.5">WHO Position Papers on Vaccines. Weekly Epidemiological Record (WER).</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)]">覆盖: BCG · 乙肝 · 百白破 · 脊灰 · 麻腮风 · 流脑 · 乙脑 · 甲肝等</span>
                </li>
              </ul>
              <p className="text-[12px] mt-2.5 pt-2 border-t border-[var(--nimi-border-subtle)] text-[var(--nimi-text-muted)]">接种窗口和时间表以国家免疫规划为准 · 自费疫苗仅供参考 · 具体请遵医嘱</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCustomModal(true)} tone="primary" size="sm">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            自定义疫苗
          </Button>
          <span className="text-[14px] px-3 py-1 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]">
            {completedCount}/{vaccineRules.length} · {pct}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="mb-5 rounded-3xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">接种进度</span>
          <span className="text-[14px] font-bold text-[var(--nimi-action-primary-bg)]">{pct}%</span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden bg-[var(--nimi-border-subtle)]">
          <div className="h-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </Surface>

      {/* AI Summary */}
      <AISummaryCard domain="vaccine" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={completedCount > 0 ? `已接种 ${completedCount}/${vaccineRules.length} 项疫苗 (${pct}%)。${upcoming.length > 0 ? `待接种: ${upcoming.map((r) => r.title).join('、')}` : '所有疫苗已完成'}` : ''} />

      {/* ── Upcoming vaccines (主动推送) ──────────────────── */}
      {upcoming.length > 0 && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mb-5 rounded-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[16px]">🔔</span>
            <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">待接种疫苗</h3>
          </div>
          <div className="space-y-2">
            {upcoming.map((r) => {
              const isOverdue = ageMonths > r.triggerAge.endMonths && r.triggerAge.endMonths !== -1;
              return (
                <div key={r.ruleId} className={`flex items-center gap-3 rounded-2xl border p-3 ${isOverdue ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]'}`}>
                  <div className={`w-[32px] h-[32px] rounded-lg flex items-center justify-center text-[16px] shrink-0 ${isOverdue ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)]' : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]'}`}>
                    {isOverdue ? '⚠️' : '💉'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{r.title}</p>
                    <p className={`text-[12px] ${isOverdue ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
                      {isOverdue ? `已过建议接种窗口 (${formatAge(r.triggerAge.startMonths)}-${formatAge(r.triggerAge.endMonths)})` : `建议 ${formatAge(r.triggerAge.startMonths)}-${r.triggerAge.endMonths === -1 ? '无上限' : formatAge(r.triggerAge.endMonths)}接种`}
                    </p>
                  </div>
                  <Button onClick={() => setRecordingRuleId(r.ruleId)} tone="primary" size="sm">记录</Button>
                </div>
              );
            })}
          </div>
        </Surface>
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
      <div className="flex gap-1 rounded-full bg-[var(--nimi-action-ghost-hover)] p-1 mb-5 w-fit">
        {([['timeline', '📋 时间轴'], ['list', '📊 列表']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-all ${activeTab === k ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'text-[var(--nimi-text-muted)]'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Timeline view ────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="relative">
          <div className="absolute left-[18px] top-0 bottom-0 w-[2px] bg-[var(--nimi-border-subtle)]" />

          {ageBuckets.map((bucket) => {
            const isCurrent = ageMonths >= bucket.startMonth && ageMonths <= bucket.endMonth;
            const isFuture = ageMonths < bucket.startMonth;
            const bucketComplete = bucket.rules.every((r) => recordedRuleIds.has(r.ruleId));

            return (
              <div key={bucket.label} className={`relative pl-10 pb-6 ${isFuture ? 'opacity-40' : ''}`}>
                <div className={`absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center ${bucketComplete ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : isCurrent ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-card)]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-action-ghost-hover)]'}`}>
                  {bucketComplete && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                  {isCurrent && !bucketComplete && <div className="w-[6px] h-[6px] rounded-full bg-[var(--nimi-action-primary-bg)]" />}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[14px] font-bold ${isCurrent ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>{bucket.label}</span>
                  {isCurrent && <span className="text-[12px] px-2 py-0.5 rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">当前阶段</span>}
                  {bucketComplete && <span className="text-[12px] px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]">全部完成</span>}
                </div>

                <div className="space-y-1.5">
                  {bucket.rules.map((r) => {
                    const done = recordedRuleIds.has(r.ruleId);
                    const rec = records.find((x) => x.ruleId === r.ruleId);

                    return (
                      <div key={r.ruleId}
                        className={`flex items-center gap-2.5 rounded-2xl border p-2.5 transition-all duration-150 ${done ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_34%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'}`}>
                        {done ? (
                          <div className="w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0 bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                          </div>
                        ) : (
                          <div className="w-[28px] h-[28px] rounded-lg flex items-center justify-center text-[16px] shrink-0 bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]">💉</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[14px] font-medium ${done ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>{r.title}</p>
                          <p className="text-[12px] truncate text-[var(--nimi-text-muted)]">
                            {done && rec ? `${fmtDate(rec.vaccinatedAt)} 接种${rec.hospital ? ` · ${rec.hospital}` : ''}` : r.description}
                          </p>
                        </div>
                        {done ? (
                          <Button onClick={() => setRecordingRuleId(r.ruleId)} tone="ghost" size="sm" className="shrink-0">修改</Button>
                        ) : (
                          <Button onClick={() => setRecordingRuleId(r.ruleId)} tone="ghost" size="sm" className="shrink-0">记录</Button>
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
              <div key={r.ruleId} className={`flex items-center gap-3 rounded-2xl border p-3 ${done ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_34%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]' : isOverdue ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'}`}>
                {done ? (
                  <div className="w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0 bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                    <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                  </div>
                ) : (
                  <div className={`w-[24px] h-[24px] rounded-full border-[1.5px] shrink-0 ${isOverdue ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_42%,var(--nimi-border-subtle))]' : 'border-[var(--nimi-border-subtle)]'}`} />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-medium ${done ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>{r.title}</p>
                  <p className="text-[12px] text-[var(--nimi-text-muted)]">
                    {done && rec ? fmtDate(rec.vaccinatedAt) : `${formatAge(r.triggerAge.startMonths)}-${r.triggerAge.endMonths === -1 ? '∞' : formatAge(r.triggerAge.endMonths)}`}
                    {isOverdue && ' · 已过期'}
                  </p>
                </div>
                {done ? (
                  <Button onClick={() => setRecordingRuleId(r.ruleId)} tone="ghost" size="sm">修改</Button>
                ) : (
                  <Button onClick={() => setRecordingRuleId(r.ruleId)} tone="primary" size="sm">记录</Button>
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
