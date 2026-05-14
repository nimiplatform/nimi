import { ConfirmDialog, IconButton, Surface, TextField } from '@nimiplatform/nimi-kit/ui';
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
  if (typeMeasurements.length === 0) {
    return null;
  }

  return (
    <>
      <Surface tone="card" elevation="raised" padding="md" className="mt-6">
        <h3 className="text-[14px] font-semibold mb-3 text-[var(--nimi-text-primary)]">{t('Profile.rich.common.history')}</h3>
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
            {typeMeasurements
              .slice()
              .reverse()
              .map((measurement) => {
                const isEditing = editingId === measurement.measurementId;
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
                    <td>
                      {measurement.ageMonths < 24
                        ? `${measurement.ageMonths}月`
                        : `${Math.floor(measurement.ageMonths / 12)}岁${measurement.ageMonths % 12 > 0 ? `${measurement.ageMonths % 12}月` : ''}`}
                    </td>
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
                      {(() => {
                        const stored = measurement.percentile;
                        if (stored != null) return `P${Math.round(stored)}`;
                        const approx = computeApproxPercentile(measurement.value, measurement.ageMonths, whoDataset);
                        return approx != null ? `P${approx}` : '-';
                      })()}
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
