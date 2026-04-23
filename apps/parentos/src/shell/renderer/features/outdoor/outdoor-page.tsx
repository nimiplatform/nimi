import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { VisionSummaryCard } from './vision-summary-card.js';
import {
  getWeekStart,
  shiftWeek,
  formatWeekRange,
  computeWeekSummary,
  computeHeatmap,
  buildOutdoorMessage,
  fmtDate,
  parseDate,
  formatShortDate,
  weekdayLabel,
  DEFAULT_OUTDOOR_GOAL_MINUTES,
  DURATION_PRESETS,
  type HeatmapCell,
  type HeatmapLevel,
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

  const heatmap = useMemo(
    () => computeHeatmap(records, effectiveGoal, 20, todayStr),
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

  const backLink = (
    <div className="flex items-center gap-2 mb-5">
      <Link to="/profile" className="text-[13px] hover:underline" style={{ color: textMuted }}>← 返回档案</Link>
    </div>
  );

  if (!child) {
    return <div className={S.container} style={{ paddingTop: S.topPad }}>{backLink}<p style={{ color: textMuted }}>请先选择一个孩子</p></div>;
  }

  if (loading) {
    return <div className={S.container} style={{ paddingTop: S.topPad }}>{backLink}<p style={{ color: textMuted }}>加载中…</p></div>;
  }

  // ── Goal not set: onboarding ──

  if (goalMinutes === null && !showGoalSetup) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        {backLink}
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
        {backLink}
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
      {backLink}
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

      {/* Vision-archive cross-link — close the myopia-prevention loop */}
      <VisionSummaryCard childId={child.childId} />

      {/* Heatmap (daily intensity over recent weeks) */}
      <div className="mb-6 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]" style={{ padding: 24 }}>
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-[14px] font-semibold" style={{ color: textMain }}>户外活动热力图</h3>
          <span className="text-[11px]" style={{ color: textMuted }}>
            近 {heatmap.weeksBack} 周 · 日均目标 {heatmap.dailyTargetMinutes} 分钟
          </span>
        </div>
        <HeatmapGrid heatmap={heatmap} />
        <div className="mt-4 flex items-center justify-end gap-1 text-[10px]" style={{ color: textMuted }}>
          <span>少</span>
          <LegendSwatch level={0} />
          <LegendSwatch level={1} />
          <LegendSwatch level={2} />
          <LegendSwatch level={3} />
          <LegendSwatch level={4} />
          <span>多</span>
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

// ── Heatmap ───────────────────────────────────────────────

const HEATMAP_LEVELS = [
  'rgba(226,232,240,0.35)', // 0 — empty
  'rgba(129,140,248,0.25)', // 1 — <50% of daily target
  'rgba(129,140,248,0.55)', // 2 — 50–100%
  'rgba(78,204,163,0.65)',  // 3 — 100–150%
  'rgba(78,204,163,0.95)',  // 4 — ≥150%
] as const;

const HEATMAP_CELL_PX = 16;
const HEATMAP_GAP_PX = 3;
const WEEKDAY_LABELS_SPARSE = ['一', '', '三', '', '五', '', '日'] as const;

function LegendSwatch({ level }: { level: HeatmapLevel }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: HEATMAP_LEVELS[level] }}
    />
  );
}

function HeatmapCellView({ cell }: { cell: HeatmapCell }) {
  const bg = HEATMAP_LEVELS[cell.level];
  const opacity = cell.isFuture ? 0.3 : 1;
  const title = cell.isFuture
    ? `${cell.date} · 未来`
    : cell.minutes > 0
      ? `${cell.date} · ${cell.minutes} 分钟`
      : `${cell.date} · 无记录`;

  return (
    <div
      title={title}
      className="rounded-[3px] transition-colors"
      style={{
        background: bg,
        opacity,
        width: HEATMAP_CELL_PX,
        height: HEATMAP_CELL_PX,
        outline: cell.isToday ? `1.5px solid ${accentBlue}` : undefined,
        outlineOffset: -1,
      }}
    />
  );
}

function HeatmapGrid({ heatmap }: { heatmap: import('./outdoor-helpers.js').Heatmap }) {
  const gridWidth =
    heatmap.weeksBack * HEATMAP_CELL_PX + Math.max(0, heatmap.weeksBack - 1) * HEATMAP_GAP_PX;
  const colStride = HEATMAP_CELL_PX + HEATMAP_GAP_PX;

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-2">
        {/* Weekday labels */}
        <div
          className="flex flex-col"
          style={{ gap: HEATMAP_GAP_PX, paddingTop: 16 }}
        >
          {WEEKDAY_LABELS_SPARSE.map((label, i) => (
            <div
              key={i}
              className="flex items-center text-[9px]"
              style={{ height: HEATMAP_CELL_PX, color: textMuted }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Grid + month labels */}
        <div style={{ width: gridWidth }}>
          <div className="relative" style={{ height: 14 }}>
            {heatmap.monthLabels.map((ml) => (
              <span
                key={`${ml.weekIndex}-${ml.label}`}
                className="absolute top-0 text-[10px]"
                style={{ left: ml.weekIndex * colStride, color: textMuted }}
              >
                {ml.label}
              </span>
            ))}
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${heatmap.weeksBack}, ${HEATMAP_CELL_PX}px)`,
              gridTemplateRows: `repeat(7, ${HEATMAP_CELL_PX}px)`,
              gridAutoFlow: 'column',
              gap: HEATMAP_GAP_PX,
            }}
          >
            {heatmap.weeks.map((week) =>
              week.map((cell) => <HeatmapCellView key={cell.date} cell={cell} />),
            )}
          </div>
        </div>
      </div>
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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--nimi-scrim-modal)' }}
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
