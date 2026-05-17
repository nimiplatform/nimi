import { Button, OverlayShell, Surface, TextField } from '@nimiplatform/nimi-kit/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../app-shell/app-store.js';
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
      <Link to="/profile" className="text-[14px] hover:underline text-[var(--nimi-text-muted)]">← 返回档案</Link>
    </div>
  );

  if (!child) {
    return <div className="max-w-3xl mx-auto px-6 pb-6 pt-[72px]">{backLink}<p className="text-[var(--nimi-text-muted)]">请先选择一个孩子</p></div>;
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-6 pb-6 pt-[72px]">{backLink}<p className="text-[var(--nimi-text-muted)]">加载中…</p></div>;
  }

  // ── Goal not set: onboarding ──

  if (goalMinutes === null && !showGoalSetup) {
    return (
      <div className="max-w-3xl mx-auto px-6 pb-6 pt-[72px]">
        {backLink}
        <Surface tone="card" material="glass-thick" elevation="raised" padding="lg" className="mx-auto max-w-lg">
          <h2 className="mb-4 text-[18px] font-semibold text-[var(--nimi-text-primary)]">每周户外目标</h2>
          <p className="mb-3 text-[14px] leading-relaxed text-[var(--nimi-text-muted)]">
            充足的户外活动时间是保护视力的重要方式。研究表明，每天累计 2 小时以上的户外活动有助于降低近视风险。
          </p>
          <p className="mb-6 text-[14px] leading-relaxed text-[var(--nimi-text-muted)]">
            记录每天的户外时长，帮助你了解孩子每周是否有足够的户外活动。
          </p>
          <Button
            onClick={() => { setGoalDraft(String(DEFAULT_OUTDOOR_GOAL_MINUTES)); setShowGoalSetup(true); }}
            tone="primary"
            size="md"
          >
            设定每周目标
          </Button>
        </Surface>
      </div>
    );
  }

  // ── Goal setup form ──

  if (showGoalSetup) {
    return (
      <div className="max-w-3xl mx-auto px-6 pb-6 pt-[72px]">
        {backLink}
        <Surface tone="card" material="glass-thick" elevation="raised" padding="lg" className="mx-auto max-w-lg">
          <h2 className="mb-4 text-[18px] font-semibold text-[var(--nimi-text-primary)]">设定每周户外目标</h2>
          <p className="mb-4 text-[14px] text-[var(--nimi-text-muted)]">建议每周 630 分钟（约每天 90 分钟）</p>
          <div className="mb-4 flex items-center gap-3">
            <input
              type="number"
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              className="w-28 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 py-2 text-center text-[16px] text-[var(--nimi-text-primary)]"
              min={1}
            />
            <span className="text-[14px] text-[var(--nimi-text-muted)]">分钟 / 周</span>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleSaveGoal}
              tone="primary"
              size="md"
            >
              确定
            </Button>
            {goalMinutes !== null && (
              <Button
                onClick={() => setShowGoalSetup(false)}
                tone="ghost"
                size="md"
              >
                取消
              </Button>
            )}
          </div>
        </Surface>
      </div>
    );
  }

  // ── Main page ──

  const progressPercent = Math.min(100, Math.round((weekSummary.totalMinutes / effectiveGoal) * 100));
  return (
    <div className="max-w-3xl mx-auto px-6 pb-6 pt-[72px]">
      {backLink}
      {/* Week navigator */}
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, -1))}
          className="rounded-lg px-3 py-1 text-[14px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
        >
          ← 上周
        </button>
        <div className="text-center">
          <h2 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
            {formatWeekRange(selectedWeekStart)}
          </h2>
          {selectedWeekStart === currentWeekStart && (
            <span className="text-[13px] text-[var(--nimi-action-primary-bg)]">本周</span>
          )}
        </div>
        <button
          onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, 1))}
          className="rounded-lg px-3 py-1 text-[14px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] disabled:opacity-50"
          disabled={isFutureWeek}
        >
          下周 →
        </button>
      </div>

      {/* Progress card */}
      <Surface tone="card" material="glass-thick" elevation="raised" padding="lg" className="mb-6">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[24px] font-bold tabular-nums text-[var(--nimi-text-primary)]">
              {weekSummary.totalMinutes} <span className="text-[16px] font-normal text-[var(--nimi-text-muted)]">/ {effectiveGoal} 分钟</span>
            </p>
          </div>
          <span className={`text-[14px] font-medium tabular-nums ${weekSummary.isComplete ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-status-info)]'}`}>
            {progressPercent}%
          </span>
        </div>

        {/* Progress bar */}
        <progress value={progressPercent} max={100} aria-label="本周户外目标完成度" className="mb-4 h-3 w-full overflow-hidden rounded-full accent-[var(--nimi-action-primary-bg)]" />

        {/* Message */}
        <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{message.primary}</p>
        <p className="mt-1 text-[14px] text-[var(--nimi-text-muted)]">{message.secondary}</p>

        {/* Add record button */}
        {!isPastWeek && !isFutureWeek && (
          <Button
            onClick={openNewRecord}
            tone="primary"
            size="md"
            className="mt-4"
          >
            ＋ 记录户外活动
          </Button>
        )}
      </Surface>

      {/* Vision-archive cross-link — close the myopia-prevention loop */}
      <VisionSummaryCard childId={child.childId} />

      {/* Heatmap (daily intensity over recent weeks) */}
      <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mb-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">户外活动热力图</h3>
          <span className="text-[13px] text-[var(--nimi-text-muted)]">
            近 {heatmap.weeksBack} 周 · 日均目标 {heatmap.dailyTargetMinutes} 分钟
          </span>
        </div>
        <HeatmapGrid heatmap={heatmap} />
        <div className="mt-4 flex items-center justify-end gap-1 text-[12px] text-[var(--nimi-text-muted)]">
          <span>少</span>
          <LegendSwatch level={0} />
          <LegendSwatch level={1} />
          <LegendSwatch level={2} />
          <LegendSwatch level={3} />
          <LegendSwatch level={4} />
          <span>多</span>
        </div>
      </Surface>

      {/* Week records list */}
      <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
            {selectedWeekStart === currentWeekStart ? '本周记录' : '当周记录'}
          </h3>
          {isPastWeek && (
            <button
              onClick={() => { setEditingRecord(null); setModalOpen(true); }}
              className="text-[13px] font-medium text-[var(--nimi-status-info)] transition-colors hover:opacity-80"
            >
              补录
            </button>
          )}
        </div>
        {weekRecords.length === 0 ? (
          <p className="text-[14px] text-[var(--nimi-text-muted)]">暂无记录</p>
        ) : (
          <div className="space-y-2">
            {weekRecords.map((r) => (
              <div
                key={r.recordId}
                className="flex items-center justify-between rounded-xl px-3 py-2 transition-colors hover:bg-white/40"
              >
                <div>
                  <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">
                    {formatShortDate(r.activityDate)} {weekdayLabel(parseDate(r.activityDate))}
                  </span>
                  <span className="ml-3 text-[14px] tabular-nums text-[var(--nimi-status-info)]">
                    {r.durationMinutes} 分钟
                  </span>
                  {r.note && (
                    <span className="ml-2 text-[13px] text-[var(--nimi-text-muted)]">
                      {r.note}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => openEditRecord(r)}
                  className="text-[13px] text-[var(--nimi-text-muted)] transition-colors hover:opacity-80"
                >
                  编辑
                </button>
              </div>
            ))}
          </div>
        )}
      </Surface>

      {/* Goal setting footer */}
      <div className="mb-8 flex items-center justify-between rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-3">
        <span className="text-[14px] text-[var(--nimi-text-muted)]">
          本周目标: {effectiveGoal} 分钟
        </span>
        <button
          onClick={() => { setGoalDraft(String(effectiveGoal)); setShowGoalSetup(true); }}
          className="text-[14px] font-medium text-[var(--nimi-status-info)] transition-colors hover:opacity-80"
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

const HEATMAP_LEVEL_CLASSES = [
  'bg-[color-mix(in_srgb,var(--nimi-surface-muted)_62%,transparent)]',
  'bg-[color-mix(in_srgb,var(--nimi-status-info)_22%,transparent)]',
  'bg-[color-mix(in_srgb,var(--nimi-status-info)_48%,transparent)]',
  'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_58%,transparent)]',
  'bg-[var(--nimi-action-primary-bg)]',
] as const;

const HEATMAP_CELL_PX = 16;
const HEATMAP_GAP_PX = 3;
const WEEKDAY_LABELS_SPARSE = ['一', '', '三', '', '五', '', '日'] as const;

function LegendSwatch({ level }: { level: HeatmapLevel }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-sm ${HEATMAP_LEVEL_CLASSES[level]}`}
    />
  );
}

function HeatmapCellView({ cell }: { cell: HeatmapCell }) {
  const title = cell.isFuture
    ? `${cell.date} · 未来`
    : cell.minutes > 0
      ? `${cell.date} · ${cell.minutes} 分钟`
      : `${cell.date} · 无记录`;

  return (
    <div
      title={title}
      className={`rounded-sm transition-colors ${HEATMAP_LEVEL_CLASSES[cell.level]} ${cell.isFuture ? 'opacity-30' : ''} ${cell.isToday ? 'ring-2 ring-[var(--nimi-status-info)] ring-offset-[-1px]' : ''}`}
      style={{
        width: HEATMAP_CELL_PX,
        height: HEATMAP_CELL_PX,
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
              className="flex items-center text-[12px] text-[var(--nimi-text-muted)]"
              style={{ height: HEATMAP_CELL_PX }}
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
                className="absolute top-0 text-[12px] text-[var(--nimi-text-muted)]"
                style={{ left: ml.weekIndex * colStride }}
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
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      panelClassName="w-80 rounded-2xl"
      title={
        <h3 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
          {isEditing ? '编辑记录' : '记录户外活动'}
        </h3>
      }
      footer={
        <div className="flex items-center justify-between">
          {isEditing && onDelete ? (
            <Button
              onClick={onDelete}
              tone="danger"
              size="sm"
            >
              删除
            </Button>
          ) : <span />}
          <div className="flex gap-3">
            <Button
              onClick={onClose}
              tone="ghost"
              size="sm"
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || saving}
              tone="primary"
              size="sm"
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      {/* Date */}
      <label className="mb-1 block text-[13px] text-[var(--nimi-text-muted)]">日期</label>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="mb-4 w-full rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 py-2 text-[14px] text-[var(--nimi-field-text)]"
        max={fmtDate(new Date())}
      />

      {/* Duration */}
      <label className="mb-1 block text-[13px] text-[var(--nimi-text-muted)]">时长（分钟）</label>
      <div className="mb-2 flex gap-2">
        {DURATION_PRESETS.map((preset) => (
          <Button
            key={preset}
            onClick={() => setMinutes(String(preset))}
            tone={minutes === String(preset) ? 'primary' : 'secondary'}
            size="sm"
          >
            {preset}
          </Button>
        ))}
      </div>
      <TextField
        type="number"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        placeholder="自定义分钟数"
        className="mb-4 w-full"
        min={1}
      />

      {/* Note */}
      <label className="mb-1 block text-[13px] text-[var(--nimi-text-muted)]">备注（可选）</label>
      <TextField
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="例：小区公园散步"
        className="mb-1 w-full"
      />
    </OverlayShell>
  );
}
