import { ConfirmDialog, IconButton, Surface, TextField } from '@nimiplatform/kit/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveTextFileViaDialog } from '../reports/report-export.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import type { WHOLMSDataset } from './who-lms-loader.js';
import type { GrowthMilestone } from './growth-milestone-rules.js';
import {
  computeApproxPercentile,
  getMeasurementSourceLabel,
  type GrowthMetricDefinition,
} from './growth-curve-page-shared.js';

type GrowthCurveHistoryTableProps = {
  typeMeasurements: MeasurementRow[];
  typeInfo: GrowthMetricDefinition | undefined;
  whoDataset: WHOLMSDataset | null;
  /** Hero-area growth milestones, surfaced inline on the rows they occurred on. */
  milestones: GrowthMilestone[];
  editingId: string | null;
  editValue: string;
  editDate: string;
  deletingId: string | null;
  onAnalyze: (measurement: MeasurementRow) => void;
  onStartEdit: (measurement: MeasurementRow) => void;
  onEditValueChange: (value: string) => void;
  onEditDateChange: (value: string) => void;
  onSaveEdit: (measurement: MeasurementRow) => void;
  onCancelEdit: () => void;
  onRequestDelete: (measurementId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (measurementId: string) => void;
};

const ROWS_PER_PAGE = 10;

type DateRangeKey = 'all' | '1y' | '6m' | '3m';

const DATE_RANGE_OPTIONS: ReadonlyArray<{ value: DateRangeKey; label: string }> = [
  { value: 'all', label: '全部时间' },
  { value: '1y', label: '近 1 年' },
  { value: '6m', label: '近 6 月' },
  { value: '3m', label: '近 3 月' },
];

const FILTER_SELECT_CLASS =
  'h-8 cursor-pointer rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 text-[12px] font-medium text-[var(--nimi-text-secondary)]';

function withinDateRange(measuredAtIso: string, range: DateRangeKey): boolean {
  if (range === 'all') return true;
  const days = range === '1y' ? 365 : range === '6m' ? 183 : 92;
  const cutoffMs = Date.now() - days * 86400000;
  return new Date(measuredAtIso).getTime() >= cutoffMs;
}

function ageLabel(ageMonths: number): string {
  if (ageMonths < 24) return `${ageMonths}月`;
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  return months > 0 ? `${years}岁${months}月` : `${years}岁`;
}

// Percentile pill tone — clinical band: P10–P90 reads as the common range in
// life-energy green, the near-extreme bands carry the blue-violet analysis
// accent, the outer extremes warn in orange.
function percentilePillClass(percentile: number | null): string {
  if (percentile == null) {
    return 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]';
  }
  if (percentile < 3 || percentile > 97) {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]';
  }
  if (percentile < 10 || percentile > 90) {
    return 'bg-[color-mix(in_srgb,var(--nimi-color-indigo)_18%,var(--nimi-surface-card))] text-[var(--nimi-color-indigo)]';
  }
  return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]';
}

// Key-node pill tone — keyed by polarity, not kind: a rapid_change rule can
// be a positive rise or a negative drop, and only the drop should flag in
// caution orange. Positive nodes read as success green, matching the hero
// timeline.
const MILESTONE_CELL_TONE: Record<GrowthMilestone['polarity'], string> = {
  positive:
    'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]',
  negative:
    'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]',
};

function escapeCsvCell(cell: string | number | null | undefined): string {
  if (cell == null) return '';
  const text = String(cell);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvText(rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  // Prepend a UTF-8 BOM so spreadsheet apps render the Chinese source labels
  // ("手动" / "导入" etc.) correctly instead of mojibake.
  return `${String.fromCharCode(0xfeff)}${body}`;
}

const ICON_STROKE = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const AnalyzeIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" {...ICON_STROKE}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10z" />
  </svg>
);
const EditIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" {...ICON_STROKE}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const DeleteIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" {...ICON_STROKE}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);

export function GrowthCurveHistoryTable({
  typeMeasurements,
  typeInfo,
  whoDataset,
  milestones,
  editingId,
  editValue,
  editDate,
  deletingId,
  onAnalyze,
  onStartEdit,
  onEditValueChange,
  onEditDateChange,
  onSaveEdit,
  onCancelEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: GrowthCurveHistoryTableProps) {
  const { t } = useTranslation();
  const [dateRangeKey, setDateRangeKey] = useState<DateRangeKey>('all');
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    const sorted = typeMeasurements.slice().sort((left, right) => right.ageMonths - left.ageMonths);
    return sorted.filter((measurement) => withinDateRange(measurement.measuredAt, dateRangeKey));
  }, [typeMeasurements, dateRangeKey]);

  // A row "has" a milestone when it is the measurement the milestone occurred
  // on — matched by shared measurement id (eventId) plus the occurred date, so
  // only one row per milestone carries the badge and other metrics' milestones
  // never bleed in.
  const milestoneByMeasurementId = useMemo(() => {
    const map = new Map<string, GrowthMilestone>();
    for (const measurement of typeMeasurements) {
      const match = milestones.find(
        (milestone) =>
          milestone.occurredAt === measurement.measuredAt &&
          milestone.evidenceEventIds.includes(measurement.measurementId),
      );
      if (match) map.set(measurement.measurementId, match);
    }
    return map;
  }, [typeMeasurements, milestones]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * ROWS_PER_PAGE;
  const pageRows = filteredRows.slice(pageStart, pageStart + ROWS_PER_PAGE);

  if (typeMeasurements.length === 0) {
    return null;
  }

  const handleExportCsv = async () => {
    const header: ReadonlyArray<string> = [
      'effective_date',
      'age_label',
      'value',
      'unit',
      'source',
      'percentile',
    ];
    const body: ReadonlyArray<ReadonlyArray<string | number | null>> = filteredRows.map((measurement) => {
      const stored = measurement.percentile;
      const approx = computeApproxPercentile(measurement.value, measurement.ageMonths, whoDataset);
      const percentile = stored ?? approx ?? null;
      return [
        measurement.measuredAt.split('T')[0] ?? '',
        ageLabel(measurement.ageMonths),
        measurement.value,
        typeInfo?.unit ?? '',
        getMeasurementSourceLabel(measurement.source),
        percentile != null ? `P${Math.round(percentile)}` : '',
      ];
    });
    const metricSlug = typeInfo?.typeId ?? 'metric';
    const dateSlug = new Date().toISOString().slice(0, 10);
    // `<a download>` is inert inside the Tauri WebView — round-trip the CSV
    // through the native save-dialog pipeline instead.
    await saveTextFileViaDialog({
      text: buildCsvText([header, ...body]),
      defaultFilename: `growth_history_${metricSlug}_${dateSlug}.csv`,
      kind: 'csv',
      title: '导出历史记录',
    });
  };

  const rangeStart = filteredRows.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + ROWS_PER_PAGE, filteredRows.length);
  const valueColumnLabel = typeInfo?.displayName ?? t('Profile.rich.common.value');

  return (
    <>
      <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mt-6 rounded-3xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
            {t('Profile.rich.common.history')}
          </h3>
          <span className="text-[13px] text-[var(--nimi-text-muted)]">
            {filteredRows.length} 条
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="time-range filter"
              value={dateRangeKey}
              onChange={(event) => {
                setDateRangeKey(event.target.value as DateRangeKey);
                setPage(1);
              }}
              className={FILTER_SELECT_CLASS}
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleExportCsv().catch(catchLog('growth-history', 'action:export-csv-failed'))}
              disabled={filteredRows.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 text-[12px] font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)] disabled:opacity-50"
              aria-label="export csv"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
                <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
              </svg>
              导出
            </button>
          </div>
        </div>
        {pageRows.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[var(--nimi-text-muted)]">
            没有匹配的记录
          </div>
        ) : (
          <table className="w-full border-collapse text-[14px] text-[var(--nimi-text-primary)]">
            <thead>
              <tr className="text-left text-[12px] font-medium text-[var(--nimi-text-muted)]">
                <th className="pb-3 font-medium">{t('Profile.rich.common.date')}</th>
                <th className="pb-3 font-medium">{t('Profile.rich.common.age')}</th>
                <th className="pb-3 font-medium">{valueColumnLabel}</th>
                <th className="pb-3 font-medium">{t('Profile.rich.growth.percentile')}</th>
                <th className="pb-3 font-medium">生长重要节点</th>
                <th className="pb-3 w-24 text-right font-medium">{t('Profile.rich.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((measurement) => {
                const isEditing = editingId === measurement.measurementId;
                const stored = measurement.percentile;
                const approx = computeApproxPercentile(measurement.value, measurement.ageMonths, whoDataset);
                const effectivePercentile = stored ?? approx ?? null;
                const milestone = milestoneByMeasurementId.get(measurement.measurementId);
                return (
                  <tr
                    key={measurement.measurementId}
                    className="group border-t border-[var(--nimi-border-subtle)]"
                  >
                    <td className="py-4 text-[var(--nimi-text-primary)]">
                      {isEditing ? (
                        <TextField
                          type="date"
                          value={editDate}
                          onChange={(event) => onEditDateChange(event.target.value)}
                          className="min-h-0 w-[130px] px-1.5 py-0.5 text-[14px]"
                        />
                      ) : measurement.measuredAt.split('T')[0]}
                    </td>
                    <td className="py-4 text-[var(--nimi-text-secondary)]">
                      {ageLabel(measurement.ageMonths)}
                    </td>
                    <td className="py-4">
                      {isEditing ? (
                        <TextField
                          type="number"
                          step="0.1"
                          value={editValue}
                          onChange={(event) => onEditValueChange(event.target.value)}
                          className="min-h-0 w-[90px] px-1.5 py-0.5 text-[14px]"
                        />
                      ) : (
                        <span>
                          <span className="text-[15px] font-bold text-[var(--nimi-text-primary)]">
                            {measurement.value}
                          </span>
                          {typeInfo?.unit ? (
                            <span className="ml-1 text-[12px] text-[var(--nimi-text-muted)]">
                              {typeInfo.unit}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="py-4">
                      {effectivePercentile != null ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${percentilePillClass(effectivePercentile)}`}
                        >
                          P{Math.round(effectivePercentile)}
                        </span>
                      ) : (
                        <span className="text-[var(--nimi-text-muted)]">-</span>
                      )}
                    </td>
                    <td className="py-4">
                      {milestone ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${MILESTONE_CELL_TONE[milestone.polarity]}`}
                        >
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                          {milestone.title}
                        </span>
                      ) : (
                        <span className="text-[var(--nimi-text-muted)]">-</span>
                      )}
                    </td>
                    <td className="py-4 text-right">
                      <div
                        className={`flex items-center justify-end gap-1 transition-opacity ${
                          isEditing
                            ? ''
                            : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
                        }`}
                      >
                        {isEditing ? (
                          <>
                            <IconButton
                              onClick={() => onSaveEdit(measurement)}
                              tone="primary"
                              size="sm"
                              className="h-7 min-h-0 w-7"
                              title={t('Profile.rich.common.save')}
                              icon="✓"
                            />
                            <IconButton
                              onClick={onCancelEdit}
                              tone="ghost"
                              size="sm"
                              className="h-7 min-h-0 w-7 text-[var(--nimi-text-muted)]"
                              title={t('Profile.rich.common.cancel')}
                              icon="✕"
                            />
                          </>
                        ) : (
                          <>
                            <IconButton
                              onClick={() => onAnalyze(measurement)}
                              tone="ghost"
                              size="sm"
                              className="h-7 min-h-0 w-7 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]"
                              title={t('Profile.rich.common.aiAnalyze')}
                              icon={AnalyzeIcon}
                            />
                            <IconButton
                              onClick={() => onStartEdit(measurement)}
                              tone="ghost"
                              size="sm"
                              className="h-7 min-h-0 w-7 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]"
                              title={t('Profile.rich.common.edit')}
                              icon={EditIcon}
                            />
                            <IconButton
                              onClick={() => onRequestDelete(measurement.measurementId)}
                              tone="ghost"
                              size="sm"
                              className="h-7 min-h-0 w-7 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)]"
                              title={t('Profile.rich.common.delete')}
                              icon={DeleteIcon}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12px]">
          <span className="text-[var(--nimi-text-muted)]">
            显示 {rangeStart}–{rangeEnd} 条，共 {filteredRows.length} 条
          </span>
          {totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1}
                className="grid h-8 w-8 place-items-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] disabled:opacity-40"
                aria-label="previous page"
              >
                ←
              </button>
              <span className="min-w-[68px] text-center font-medium text-[var(--nimi-text-secondary)]">
                第 {safePage} / {totalPages} 页
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage >= totalPages}
                className="grid h-8 w-8 place-items-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] disabled:opacity-40"
                aria-label="next page"
              >
                →
              </button>
            </div>
          ) : null}
        </div>
      </Surface>

      {deletingId ? (
        <ConfirmDialog
          open
          title={t('Profile.rich.common.confirmDelete')}
          message={t('Profile.rich.common.deleteCannotUndo')}
          cancelLabel={t('Profile.rich.common.cancel')}
          confirmLabel={t('Profile.rich.common.confirmDeleteAction')}
          confirmTone="danger"
          onClose={onCancelDelete}
          onConfirm={() => onConfirmDelete(deletingId)}
        />
      ) : null}
    </>
  );
}
