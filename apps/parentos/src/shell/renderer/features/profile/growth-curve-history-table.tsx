import { ConfirmDialog, IconButton, Surface, TextField } from '@nimiplatform/nimi-kit/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import type { WHOLMSDataset } from './who-lms-loader.js';
import {
  computeApproxPercentile,
  getMeasurementSourceLabel,
  type GrowthMetricDefinition,
} from './growth-curve-page-shared.js';

type GrowthCurveHistoryTableProps = {
  typeMeasurements: MeasurementRow[];
  typeInfo: GrowthMetricDefinition | undefined;
  whoDataset: WHOLMSDataset | null;
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
type SourceKey = 'all' | 'manual' | 'ocr' | 'computed' | 'imported' | 'reminder';

const DATE_RANGE_OPTIONS: ReadonlyArray<{ value: DateRangeKey; label: string }> = [
  { value: 'all', label: '全部' },
  { value: '1y', label: '近 1 年' },
  { value: '6m', label: '近 6 月' },
  { value: '3m', label: '近 3 月' },
];

const SOURCE_OPTIONS: ReadonlyArray<{ value: SourceKey; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'manual', label: '手动' },
  { value: 'ocr', label: 'OCR' },
  { value: 'imported', label: '导入' },
  { value: 'reminder', label: '提醒' },
];

function withinDateRange(measuredAtIso: string, range: DateRangeKey): boolean {
  if (range === 'all') return true;
  const days = range === '1y' ? 365 : range === '6m' ? 183 : 92;
  const cutoffMs = Date.now() - days * 86400000;
  return new Date(measuredAtIso).getTime() >= cutoffMs;
}

function matchesSource(measurementSource: string | null, key: SourceKey): boolean {
  if (key === 'all') return true;
  return measurementSource === key;
}

function ageLabel(ageMonths: number): string {
  if (ageMonths < 24) return `${ageMonths}月`;
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  return months > 0 ? `${years}岁${months}月` : `${years}岁`;
}

function percentileToneClass(percentile: number | null): string {
  if (percentile == null) return 'text-[var(--nimi-text-muted)]';
  if (percentile < 3 || percentile > 97) return 'text-[var(--nimi-status-warning)]';
  if (percentile < 10 || percentile > 90) return 'text-[var(--nimi-status-info)]';
  return 'text-[var(--nimi-status-success)]';
}

function escapeCsvCell(cell: string | number | null | undefined): string {
  if (cell == null) return '';
  const text = String(cell);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvBlob(rows: ReadonlyArray<ReadonlyArray<string | number | null>>): Blob {
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  return new Blob([body], { type: 'text/csv;charset=utf-8' });
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function GrowthCurveHistoryTable({
  typeMeasurements,
  typeInfo,
  whoDataset,
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
  const [sourceKey, setSourceKey] = useState<SourceKey>('all');
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    const sorted = typeMeasurements.slice().sort((left, right) => right.ageMonths - left.ageMonths);
    return sorted.filter(
      (measurement) =>
        withinDateRange(measurement.measuredAt, dateRangeKey) &&
        matchesSource(measurement.source, sourceKey),
    );
  }, [typeMeasurements, dateRangeKey, sourceKey]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * ROWS_PER_PAGE;
  const pageRows = filteredRows.slice(pageStart, pageStart + ROWS_PER_PAGE);

  if (typeMeasurements.length === 0) {
    return null;
  }

  const handleExportCsv = () => {
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
    const blob = buildCsvBlob([header, ...body]);
    const metricSlug = typeInfo?.typeId ?? 'metric';
    const dateSlug = new Date().toISOString().slice(0, 10);
    triggerDownload(blob, `growth_history_${metricSlug}_${dateSlug}.csv`);
  };

  return (
    <>
      <Surface tone="card" elevation="raised" padding="md" className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">
            {t('Profile.rich.common.history')}
          </h3>
          <span className="text-[12px] text-[var(--nimi-text-muted)]">
            ({filteredRows.length}/{typeMeasurements.length})
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="time-range filter"
              value={dateRangeKey}
              onChange={(event) => {
                setDateRangeKey(event.target.value as DateRangeKey);
                setPage(1);
              }}
              className="h-7 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 text-[12px] text-[var(--nimi-text-primary)]"
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="source filter"
              value={sourceKey}
              onChange={(event) => {
                setSourceKey(event.target.value as SourceKey);
                setPage(1);
              }}
              className="h-7 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 text-[12px] text-[var(--nimi-text-primary)]"
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredRows.length === 0}
              className="h-7 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-[12px] text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-surface-panel)] disabled:opacity-50"
              aria-label="export csv"
            >
              导出 CSV
            </button>
          </div>
        </div>
        {pageRows.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-[var(--nimi-text-muted)]">
            没有匹配的记录
          </div>
        ) : (
          <table className="w-full text-[14px] text-[var(--nimi-text-primary)]">
            <thead>
              <tr className="border-b border-[var(--nimi-border-subtle)] text-left text-[var(--nimi-text-muted)]">
                <th className="pb-2">{t('Profile.rich.common.date')}</th>
                <th className="pb-2">{t('Profile.rich.common.age')}</th>
                <th className="pb-2">{t('Profile.rich.common.value')}</th>
                <th className="pb-2">{t('Profile.rich.common.source')}</th>
                <th className="pb-2">{t('Profile.rich.growth.percentile')}</th>
                <th className="pb-2 w-24 text-right">{t('Profile.rich.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((measurement) => {
                const isEditing = editingId === measurement.measurementId;
                const stored = measurement.percentile;
                const approx = computeApproxPercentile(measurement.value, measurement.ageMonths, whoDataset);
                const effectivePercentile = stored ?? approx ?? null;
                return (
                  <tr key={measurement.measurementId} className="border-b border-[var(--nimi-border-subtle)]">
                    <td className="py-2">
                      {isEditing ? (
                        <TextField
                          type="date"
                          value={editDate}
                          onChange={(event) => onEditDateChange(event.target.value)}
                          className="min-h-0 w-[120px] px-1.5 py-0.5 text-[14px]"
                        />
                      ) : measurement.measuredAt.split('T')[0]}
                    </td>
                    <td>{ageLabel(measurement.ageMonths)}</td>
                    <td>
                      {isEditing ? (
                        <TextField
                          type="number"
                          step="0.1"
                          value={editValue}
                          onChange={(event) => onEditValueChange(event.target.value)}
                          className="min-h-0 w-[80px] px-1.5 py-0.5 text-[14px]"
                        />
                      ) : <>{measurement.value} {typeInfo?.unit}</>}
                    </td>
                    <td>{getMeasurementSourceLabel(measurement.source)}</td>
                    <td>
                      {effectivePercentile != null ? (
                        <span className={`font-medium ${percentileToneClass(effectivePercentile)}`}>
                          P{Math.round(effectivePercentile)}
                        </span>
                      ) : (
                        <span className="text-[var(--nimi-text-muted)]">-</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <IconButton
                              onClick={() => onSaveEdit(measurement)}
                              tone="primary"
                              size="sm"
                              className="h-6 min-h-0 w-6"
                              title={t('Profile.rich.common.save')}
                              icon="✓"
                            />
                            <IconButton
                              onClick={onCancelEdit}
                              tone="ghost"
                              size="sm"
                              className="h-6 min-h-0 w-6 text-[var(--nimi-text-muted)]"
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
                              className="h-6 min-h-0 w-6 text-[16px]"
                              title={t('Profile.rich.common.aiAnalyze')}
                              icon="💬"
                            />
                            <IconButton
                              onClick={() => onStartEdit(measurement)}
                              tone="secondary"
                              size="sm"
                              className="h-6 min-h-0 w-6"
                              title={t('Profile.rich.common.edit')}
                              icon="✎"
                            />
                            <IconButton
                              onClick={() => onRequestDelete(measurement.measurementId)}
                              tone="danger"
                              size="sm"
                              className="h-6 min-h-0 w-6"
                              title={t('Profile.rich.common.delete')}
                              icon="✕"
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
        {totalPages > 1 ? (
          <div className="mt-3 flex items-center justify-end gap-2 text-[12px]">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="h-7 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-[var(--nimi-text-primary)] disabled:opacity-40"
              aria-label="previous page"
            >
              ←
            </button>
            <span className="text-[var(--nimi-text-muted)]">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="h-7 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-[var(--nimi-text-primary)] disabled:opacity-40"
              aria-label="next page"
            >
              →
            </button>
          </div>
        ) : null}
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
