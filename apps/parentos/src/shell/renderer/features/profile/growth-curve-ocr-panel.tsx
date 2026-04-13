import { AppSelect } from '../../app-shell/app-select.js';
import { S, selectStyle } from '../../app-shell/page-style.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import type { OCRImportTypeId, OCRMeasurementCandidate } from './checkup-ocr.js';

export type GrowthCurveOCRCandidate = OCRMeasurementCandidate & { selected: boolean };

type GrowthCurveOCRPanelProps = {
  ocrRuntimeAvailable: boolean | null;
  ocrImageName: string | null;
  hasOCRImage: boolean;
  ocrStatus: 'idle' | 'analyzing' | 'review';
  ocrError: string | null;
  ocrCandidates: GrowthCurveOCRCandidate[];
  onClose: () => void;
  onFileChange: (file: File | null) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onToggleCandidate: (index: number, selected: boolean) => void;
  onChangeCandidateType: (index: number, typeId: OCRImportTypeId) => void;
  onChangeCandidateValue: (index: number, value: number) => void;
  onChangeCandidateDate: (index: number, measuredAt: string) => void;
  onImport: () => void;
};

export function GrowthCurveOCRPanel({
  ocrRuntimeAvailable,
  ocrImageName,
  hasOCRImage,
  ocrStatus,
  ocrError,
  ocrCandidates,
  onClose,
  onFileChange,
  onAnalyze,
  onReset,
  onToggleCandidate,
  onChangeCandidateType,
  onChangeCandidateValue,
  onChangeCandidateDate,
  onImport,
}: GrowthCurveOCRPanelProps) {
  return (
    <div className={`w-full ${S.radius} p-4 space-y-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm" style={{ color: S.text }}>Import from health sheet (OCR)</h3>
          <p className="text-xs" style={{ color: S.sub }}>
            Extracts structured growth measurements only. Nothing is saved until you confirm the candidates.
          </p>
        </div>
        <button onClick={onClose} className={`px-3 py-1.5 text-sm ${S.radiusSm}`} style={{ background: S.bg, color: S.sub }}>
          Close OCR
        </button>
      </div>

      {ocrRuntimeAvailable === false ? (
        <p className="text-xs text-amber-600">当前无法使用本地 OCR 运行时，暂时不能解析体检单图片。</p>
      ) : null}

      <div className="space-y-2">
        <input
          type="file"
          accept="image/*"
          aria-label="checkup-sheet-file"
          onChange={(event) => void onFileChange(event.target.files?.[0] ?? null)}
          className="block text-sm"
        />
        {ocrImageName ? (
          <p className="text-xs" style={{ color: S.sub }} data-testid="ocr-image-name">
            已选择：{ocrImageName}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            onClick={onAnalyze}
            disabled={!hasOCRImage || ocrRuntimeAvailable === false || ocrStatus === 'analyzing'}
            className={`px-4 py-1.5 text-sm text-white ${S.radiusSm} disabled:opacity-50`}
            style={{ background: S.accent }}
          >
            {ocrStatus === 'analyzing' ? 'Analyzing...' : 'Analyze sheet'}
          </button>
          <button onClick={onReset} className={`px-4 py-1.5 text-sm ${S.radiusSm}`} style={{ background: S.bg, color: S.sub }}>
            Reset
          </button>
        </div>
      </div>

      {ocrError ? (
        <p className="text-xs text-red-500" data-testid="ocr-error">{ocrError}</p>
      ) : null}

      {ocrStatus === 'review' ? (
        <div className="space-y-3">
          {ocrCandidates.length === 0 ? (
            <p className="text-sm" style={{ color: S.sub }}>未识别到可导入的受支持测量值。</p>
          ) : (
            <>
              <div className="space-y-3">
                {ocrCandidates.map((candidate, index) => (
                  <div
                    key={`${candidate.typeId}-${index}`}
                    className={`${S.radiusSm} p-3 space-y-2`}
                    style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }}
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={candidate.selected}
                        onChange={(event) => onToggleCandidate(index, event.target.checked)}
                      />
                      Import this measurement
                    </label>
                    <div className="grid gap-2 md:grid-cols-3">
                      <AppSelect
                        value={candidate.typeId}
                        onChange={(value) => onChangeCandidateType(index, value as OCRImportTypeId)}
                        options={GROWTH_STANDARDS
                          .filter((standard) => ['height', 'weight', 'head-circumference', 'bmi'].includes(standard.typeId))
                          .map((standard) => ({
                            value: standard.typeId,
                            label: standard.displayName,
                          }))}
                      />
                      <input
                        type="number"
                        value={candidate.value}
                        onChange={(event) => onChangeCandidateValue(index, Number(event.target.value))}
                        className={S.select}
                        style={selectStyle}
                      />
                      <ProfileDatePicker
                        value={candidate.measuredAt}
                        onChange={(nextDate) => onChangeCandidateDate(index, nextDate)}
                        className={S.select}
                        style={selectStyle}
                        size="small"
                      />
                    </div>
                    {candidate.notes ? (
                      <p className="text-xs" style={{ color: S.sub }}>{candidate.notes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                onClick={onImport}
                className={`px-4 py-2 text-sm text-white ${S.radiusSm}`}
                style={{ background: S.accent }}
              >
                Import selected OCR measurements
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
