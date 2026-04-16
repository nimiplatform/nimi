import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useAppStore } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import {
  getOutdoorRecords,
  getOutdoorGoal,
  setOutdoorGoal,
  insertOutdoorRecord,
  updateOutdoorRecord,
  deleteOutdoorRecord,
  type OutdoorRecordRow,
} from '../../bridge/sqlite-bridge.js';
import {
  getWeekStart,
  shiftWeek,
  formatWeekRange,
  computeWeekSummary,
  computeRecentWeeks,
  buildOutdoorMessage,
  fmtDate,
  parseDate,
  formatShortDate,
  weekdayLabel,
  DEFAULT_OUTDOOR_GOAL_MINUTES,
  DURATION_PRESETS,
} from './outdoor-helpers.js';

const textMain = '#1e293b';
const textMuted = '#475569';
const accentGreen = '#4ECCA3';
const accentBlue = '#818CF8';

// ── Outdoor Page ──────────────────────────────────────────

export function OutdoorPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId) ?? null;
  const childId = child?.childId ?? null;

  const [records, setRecords] = useState<OutdoorRecordRow[]>([]);
  const [goalMinutes, setGoalMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Week navigation state
  const todayStr = fmtDate(new Date());
  const currentWeekStart = getWeekStart(new Date());
  const [selectedWeekStart, setSelectedWeekStart] = useState(currentWeekStart);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<OutdoorRecordRow | null>(null);

  // Goal setup state
  const [showGoalSetup, setShowGoalSetup] = useState(false);
  const [goalDraft, setGoalDraft] = useState(String(DEFAULT_OUTDOOR_GOAL_MINUTES));

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); return; }
    setLoading(true);
    const [recs, goal] = await Promise.allSettled([
      getOutdoorRecords(childId),
      getOutdoorGoal(childId),
    ]);
    setRecords(recs.status === 'fulfilled' ? recs.value : []);
    const g = goal.status === 'fulfilled' ? goal.value : null;
    setGoalMinutes(g);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void load(); }, [load]);

  // Derived state
  const effectiveGoal = goalMinutes ?? DEFAULT_OUTDOOR_GOAL_MINUTES;
  const isPastWeek = selectedWeekStart < currentWeekStart;
  const isFutureWeek = selectedWeekStart > currentWeekStart;

  const weekSummary = useMemo(
    () => computeWeekSummary(records, effectiveGoal, selectedWeekStart, todayStr),
    [records, effectiveGoal, selectedWeekStart, todayStr],
  );

  const recentWeeks = useMemo(
    () => computeRecentWeeks(records, effectiveGoal, 4, todayStr),
    [records, effectiveGoal, todayStr],
  );

  const message = useMemo(
    () => buildOutdoorMessage(weekSummary, isPastWeek),
    [weekSummary, isPastWeek],
  );

  // Week records for the selected week
  const weekRecords = useMemo(
    () => records.filter((r) => r.activityDate >= weekSummary.weekStart && r.activityDate <= weekSummary.weekEnd)
      .sort((a, b) => a.activityDate.localeCompare(b.activityDate) || a.createdAt.localeCompare(b.createdAt)),
    [records, weekSummary],
  );

  // ── Handlers ──

  const handleSaveGoal = useCallback(async () => {
    if (!childId) return;
    const minutes = parseInt(goalDraft, 10);
    if (Number.isNaN(minutes) || minutes <= 0) return;
    await setOutdoorGoal(childId, minutes, isoNow());
    setGoalMinutes(minutes);
    setShowGoalSetup(false);
  }, [childId, goalDraft]);

  const handleSaveRecord = useCallback(async (activityDate: string, durationMinutes: number, note: string) => {
    if (!childId) return;
    if (editingRecord) {
      await updateOutdoorRecord({
        recordId: editingRecord.recordId,
        activityDate,
        durationMinutes,
        note: note || null,
        now: isoNow(),
      });
    } else {
      await insertOutdoorRecord({
        recordId: ulid(),
        childId,
        activityDate,
        durationMinutes,
        note: note || null,
        now: isoNow(),
      });
    }
    setModalOpen(false);
    setEditingRecord(null);
    await load();
  }, [childId, editingRecord, load]);

  const handleDeleteRecord = useCallback(async (recordId: string) => {
    await deleteOutdoorRecord(recordId);
    setModalOpen(false);
    setEditingRecord(null);
    await load();
  }, [load]);

  const openNewRecord = useCallback(() => {
    setEditingRecord(null);
    setModalOpen(true);
  }, []);

  const openEditRecord = useCallback((record: OutdoorRecordRow) => {
    setEditingRecord(record);
    setModalOpen(true);
  }, []);

  if (!child) {
    return <div className={S.container} style={{ paddingTop: S.topPad }}><p style={{ color: textMuted }}>请先选择一个孩子</p></div>;
  }

  if (loading) {
    return <div className={S.container} style={{ paddingTop: S.topPad }}><p style={{ color: textMuted }}>加载中…</p></div>;
  }

  // ── Goal not set: onboarding ──

  if (goalMinutes === null && !showGoalSetup) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="mx-auto max-w-lg nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 32 }}>
          <h2 className="mb-4 text-[18px] font-semibold" style={{ color: textMain }}>每周户外目标</h2>
          <p className="mb-3 text-[13px] leading-relaxed" style={{ color: textMuted }}>
            充足的户外活动时间是保护视力的重要方式。研究表明，每天累计 2 小时以上的户外活动有助于降低近视风险。
          </p>
          <p className="mb-6 text-[13px] leading-relaxed" style={{ color: textMuted }}>
            记录每天的户外时长，帮助你了解孩子每周是否有足够的户外活动。
          </p>
          <button
            onClick={() => { setGoalDraft(String(DEFAULT_OUTDOOR_GOAL_MINUTES)); setShowGoalSetup(true); }}
            className="rounded-full px-5 py-2 text-[13px] font-medium text-white transition-colors"
            style={{ background: accentGreen }}
          >
            设定每周目标
          </button>
        </div>
      </div>
    );
  }

  // ── Goal setup form ──

  if (showGoalSetup) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="mx-auto max-w-lg nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 32 }}>
          <h2 className="mb-4 text-[18px] font-semibold" style={{ color: textMain }}>设定每周户外目标</h2>
          <p className="mb-4 text-[13px]" style={{ color: textMuted }}>建议每周 630 分钟（约每天 90 分钟）</p>
          <div className="mb-4 flex items-center gap-3">
            <input
              type="number"
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-center text-[14px]"
              style={{ color: textMain }}
              min={1}
            />
            <span className="text-[13px]" style={{ color: textMuted }}>分钟 / 周</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSaveGoal}
              className="rounded-full px-5 py-2 text-[13px] font-medium text-white transition-colors"
              style={{ background: accentGreen }}
            >
              确定
            </button>
            {goalMinutes !== null && (
              <button
                onClick={() => setShowGoalSetup(false)}
                className="rounded-full px-5 py-2 text-[13px] font-medium transition-colors"
                style={{ color: textMuted }}
              >
                取消
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main page ──

  const progressPercent = Math.min(100, Math.round((weekSummary.totalMinutes / effectiveGoal) * 100));
  const progressColor = weekSummary.isComplete ? accentGreen : accentBlue;

  return (
    <div className={S.container} style={{ paddingTop: S.topPad }}>
      {/* Week navigator */}
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, -1))}
          className="rounded-lg px-3 py-1 text-[13px] transition-colors hover:bg-white/60"
          style={{ color: textMuted }}
        >
          ← 上周
        </button>
        <div className="text-center">
          <h2 className="text-[15px] font-semibold" style={{ color: textMain }}>
            {formatWeekRange(selectedWeekStart)}
          </h2>
          {selectedWeekStart === currentWeekStart && (
            <span className="text-[11px]" style={{ color: accentGreen }}>本周</span>
          )}
        </div>
        <button
          onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, 1))}
          className="rounded-lg px-3 py-1 text-[13px] transition-colors hover:bg-white/60"
          style={{ color: textMuted }}
          disabled={isFutureWeek}
        >
          下周 →
        </button>
      </div>

      {/* Progress card */}
      <div className="mb-6 nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 24 }}>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[22px] font-bold tabular-nums" style={{ color: textMain }}>
              {weekSummary.totalMinutes} <span className="text-[14px] font-normal" style={{ color: textMuted }}>/ {effectiveGoal} 分钟</span>
            </p>
          </div>
          <span className="text-[13px] font-medium tabular-nums" style={{ color: progressColor }}>
            {progressPercent}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-3 overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.5)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%`, background: progressColor }}
          />
        </div>

        {/* Message */}
        <p className="text-[13px] font-medium" style={{ color: textMain }}>{message.primary}</p>
        <p className="mt-1 text-[12px]" style={{ color: textMuted }}>{message.secondary}</p>

        {/* Add record button */}
        {!isPastWeek && !isFutureWeek && (
          <button
            onClick={openNewRecord}
            className="mt-4 rounded-full px-5 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90"
            style={{ background: accentGreen }}
          >
            ＋ 记录户外活动
          </button>
        )}
      </div>

      {/* 7-day bar chart */}
      <div className="mb-6 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 24 }}>
        <h3 className="mb-4 text-[14px] font-semibold" style={{ color: textMain }}>每日户外时长</h3>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekSummary.dailyBreakdown} barCategoryGap="20%">
              <XAxis dataKey="weekday" tick={{ fontSize: 11, fill: textMuted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: textMuted }} axisLine={false} tickLine={false} width={36} />
              <ReferenceLine y={effectiveGoal / 7} stroke={accentGreen} strokeDasharray="4 4" strokeOpacity={0.5} />
              <Bar dataKey="minutes" radius={[6, 6, 0, 0]} maxBarSize={32}>
                {weekSummary.dailyBreakdown.map((entry) => (
                  <Cell key={entry.date} fill={entry.minutes > 0 ? accentBlue : 'rgba(226,232,240,0.4)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-right text-[10px]" style={{ color: textMuted }}>
          虚线为日均目标 {Math.round(effectiveGoal / 7)} 分钟
        </p>
      </div>

      {/* 4-week trend */}
      <div className="mb-6 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 24 }}>
        <h3 className="mb-4 text-[14px] font-semibold" style={{ color: textMain }}>最近 4 周</h3>
        <div className="space-y-3">
          {recentWeeks.map((week) => {
            const pct = Math.min(100, Math.round((week.totalMinutes / effectiveGoal) * 100));
            const barColor = week.isComplete ? accentGreen : 'rgba(129,140,248,0.6)';
            return (
              <button
                key={week.weekStart}
                onClick={() => setSelectedWeekStart(week.weekStart)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-1 text-left transition-colors hover:bg-white/40"
              >
                <span className="w-24 shrink-0 text-[11px]" style={{ color: textMuted }}>
                  {formatShortDate(week.weekStart)}–{formatShortDate(week.weekEnd)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.4)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums" style={{ color: week.isComplete ? accentGreen : textMuted }}>
                  {week.totalMinutes} 分钟
                </span>
                {week.isComplete && <span className="text-[11px]" style={{ color: accentGreen }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Week records list */}
      <div className="mb-6 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 24 }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold" style={{ color: textMain }}>
            {selectedWeekStart === currentWeekStart ? '本周记录' : '当周记录'}
          </h3>
          {isPastWeek && (
            <button
              onClick={() => { setEditingRecord(null); setModalOpen(true); }}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: accentBlue }}
            >
              补录
            </button>
          )}
        </div>
        {weekRecords.length === 0 ? (
          <p className="text-[12px]" style={{ color: textMuted }}>暂无记录</p>
        ) : (
          <div className="space-y-2">
            {weekRecords.map((r) => (
              <div
                key={r.recordId}
                className="flex items-center justify-between rounded-xl px-3 py-2 transition-colors hover:bg-white/40"
              >
                <div>
                  <span className="text-[12px] font-medium" style={{ color: textMain }}>
                    {formatShortDate(r.activityDate)} {weekdayLabel(parseDate(r.activityDate))}
                  </span>
                  <span className="ml-3 text-[12px] tabular-nums" style={{ color: accentBlue }}>
                    {r.durationMinutes} 分钟
                  </span>
                  {r.note && (
                    <span className="ml-2 text-[11px]" style={{ color: textMuted }}>
                      {r.note}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => openEditRecord(r)}
                  className="text-[11px] transition-colors hover:opacity-80"
                  style={{ color: textMuted }}
                >
                  编辑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Goal setting footer */}
      <div className="mb-8 flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.3)' }}>
        <span className="text-[12px]" style={{ color: textMuted }}>
          本周目标: {effectiveGoal} 分钟
        </span>
        <button
          onClick={() => { setGoalDraft(String(effectiveGoal)); setShowGoalSetup(true); }}
          className="text-[12px] font-medium transition-colors hover:opacity-80"
          style={{ color: accentBlue }}
        >
          修改
        </button>
      </div>

      {/* Record modal */}
      {modalOpen && (
        <RecordModal
          defaultDate={editingRecord?.activityDate ?? (isPastWeek ? selectedWeekStart : todayStr)}
          defaultMinutes={editingRecord?.durationMinutes ?? null}
          defaultNote={editingRecord?.note ?? ''}
          isEditing={editingRecord !== null}
          onSave={handleSaveRecord}
          onDelete={editingRecord ? () => handleDeleteRecord(editingRecord.recordId) : undefined}
          onClose={() => { setModalOpen(false); setEditingRecord(null); }}
        />
      )}
    </div>
  );
}

// ── Record Modal ──────────────────────────────────────────

function RecordModal({
  defaultDate,
  defaultMinutes,
  defaultNote,
  isEditing,
  onSave,
  onDelete,
  onClose,
}: {
  defaultDate: string;
  defaultMinutes: number | null;
  defaultNote: string;
  isEditing: boolean;
  onSave: (date: string, minutes: number, note: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [minutes, setMinutes] = useState(defaultMinutes ? String(defaultMinutes) : '');
  const [note, setNote] = useState(defaultNote);
  const [saving, setSaving] = useState(false);

  const canSave = date && minutes && parseInt(minutes, 10) > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    await onSave(date, parseInt(minutes, 10), note);
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-[4px]"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onClick={onClose}
    >
      <div
        className="w-80 nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]"
        style={{ padding: 24, borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-[15px] font-semibold" style={{ color: textMain }}>
          {isEditing ? '编辑记录' : '记录户外活动'}
        </h3>

        {/* Date */}
        <label className="mb-1 block text-[11px]" style={{ color: textMuted }}>日期</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px]"
          style={{ color: textMain }}
          max={fmtDate(new Date())}
        />

        {/* Duration */}
        <label className="mb-1 block text-[11px]" style={{ color: textMuted }}>时长（分钟）</label>
        <div className="mb-2 flex gap-2">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setMinutes(String(preset))}
              className="rounded-lg px-3 py-1 text-[12px] transition-colors"
              style={{
                background: minutes === String(preset) ? accentBlue : 'rgba(226,232,240,0.4)',
                color: minutes === String(preset) ? '#fff' : textMuted,
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="自定义分钟数"
          className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px]"
          style={{ color: textMain }}
          min={1}
        />

        {/* Note */}
        <label className="mb-1 block text-[11px]" style={{ color: textMuted }}>备注（可选）</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例：小区公园散步"
          className="mb-5 w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px]"
          style={{ color: textMain }}
        />

        {/* Actions */}
        <div className="flex items-center justify-between">
          {isEditing && onDelete ? (
            <button
              onClick={onDelete}
              className="text-[12px] font-medium transition-colors hover:opacity-80"
              style={{ color: '#ef4444' }}
            >
              删除
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-[12px] transition-colors"
              style={{ color: textMuted }}
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="rounded-full px-5 py-1.5 text-[12px] font-medium text-white transition-colors disabled:opacity-50"
              style={{ background: accentGreen }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
