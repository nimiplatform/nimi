import { S } from '../../app-shell/page-style.js';
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
  if (typeMeasurements.length === 0) {
    return null;
  }

  return (
    <>
      <div className={`mt-6 ${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
        <h3 className="text-[13px] font-semibold mb-3" style={{ color: S.text }}>历史记录</h3>
        <table className="w-full text-[12px]" style={{ color: S.text }}>
          <thead>
            <tr className="text-left" style={{ color: S.sub, borderBottom: `1px solid ${S.border}` }}>
              <th className="pb-2">日期</th>
              <th className="pb-2">年龄</th>
              <th className="pb-2">数值</th>
              <th className="pb-2">来源</th>
              <th className="pb-2">百分位</th>
              <th className="pb-2 w-24 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {typeMeasurements
              .slice()
              .reverse()
              .map((measurement) => {
                const isEditing = editingId === measurement.measurementId;
                return (
                  <tr key={measurement.measurementId} style={{ borderBottom: `1px solid ${S.border}` }}>
                    <td className="py-2">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editDate}
                          onChange={(event) => onEditDateChange(event.target.value)}
                          className="text-[12px] px-1.5 py-0.5 rounded border w-[120px]"
                          style={{ borderColor: S.border }}
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
                        <input
                          type="number"
                          step="0.1"
                          value={editValue}
                          onChange={(event) => onEditValueChange(event.target.value)}
                          className="text-[12px] px-1.5 py-0.5 rounded border w-[80px]"
                          style={{ borderColor: S.border }}
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
                            <button
                              onClick={() => onSaveEdit(measurement)}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-green-50"
                              title="保存"
                              style={{ color: '#16a34a' }}
                            >
                              ✓
                            </button>
                            <button
                              onClick={onCancelEdit}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-gray-100"
                              title="取消"
                              style={{ color: S.sub }}
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onAnalyze(measurement)}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[14px] transition-colors hover:bg-[#f0f0ec]"
                              title="AI 分析此数据"
                            >
                              💬
                            </button>
                            <button
                              onClick={() => onStartEdit(measurement)}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-blue-50"
                              title="编辑"
                              style={{ color: '#2563eb' }}
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => onRequestDelete(measurement.measurementId)}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-red-50"
                              title="删除"
                              style={{ color: '#dc2626' }}
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {deletingId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={onCancelDelete}
        >
          <div
            className={`${S.radius} p-6 w-[340px]`}
            style={{ background: S.card, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold mb-2" style={{ color: S.text }}>确认删除</h3>
            <p className="text-[12px] leading-[1.6] mb-5" style={{ color: S.sub }}>
              删除后数据无法恢复，确定要删除这条记录吗？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancelDelete}
                className="text-[12px] px-4 py-1.5 rounded-full font-medium transition-colors hover:opacity-80"
                style={{ background: '#f5f3ef', color: S.text }}
              >
                取消
              </button>
              <button
                onClick={() => onConfirmDelete(deletingId)}
                className="text-[12px] px-4 py-1.5 rounded-full text-white font-medium transition-colors hover:opacity-90"
                style={{ background: '#dc2626' }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
