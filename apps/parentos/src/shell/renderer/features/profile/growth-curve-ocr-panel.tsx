import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { AppSelect } from '../../app-shell/app-select.js';
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
    <Surface tone="card" material="solid" elevation="raised" padding="md" className="w-full space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm text-[var(--nimi-text-primary)]">Import from health sheet (OCR)</h3>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            Extracts structured growth measurements only. Nothing is saved until you confirm the candidates.
          </p>
        </div>
        <Button onClick={onClose} tone="ghost" size="sm">
          Close OCR
        </Button>
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
          <p className="text-xs text-[var(--nimi-text-muted)]" data-testid="ocr-image-name">
            已选择：{ocrImageName}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            onClick={onAnalyze}
            disabled={!hasOCRImage || ocrRuntimeAvailable === false || ocrStatus === 'analyzing'}
            tone="primary"
            size="sm"
          >
            {ocrStatus === 'analyzing' ? 'Analyzing...' : 'Analyze sheet'}
          </Button>
          <Button onClick={onReset} tone="secondary" size="sm">
            Reset
          </Button>
        </div>
      </div>

      {ocrError ? (
        <p className="text-xs text-red-500" data-testid="ocr-error">{ocrError}</p>
      ) : null}

      {ocrStatus === 'review' ? (
        <div className="space-y-3">
          {ocrCandidates.length === 0 ? (
            <p className="text-sm text-[var(--nimi-text-muted)]">未识别到可导入的受支持测量值。</p>
          ) : (
            <>
              <div className="space-y-3">
                {ocrCandidates.map((candidate, index) => (
                  <div
                    key={`${candidate.typeId}-${index}`}
                    className="space-y-2 rounded-2xl border border-[var(--nimi-border-subtle)] p-3"
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
                        className={"rounded-xl px-3 py-1.5 text-[14px] cursor-pointer appearance-none bg-[var(--nimi-field-bg)] text-[var(--nimi-text-primary)] border border-[var(--nimi-field-border)] transition-colors"}
                      />
                      <ProfileDatePicker
                        value={candidate.measuredAt}
                        onChange={(nextDate) => onChangeCandidateDate(index, nextDate)}
                        className={"rounded-xl px-3 py-1.5 text-[14px] cursor-pointer appearance-none bg-[var(--nimi-field-bg)] text-[var(--nimi-text-primary)] border border-[var(--nimi-field-border)] transition-colors"}
                        size="small"
                      />
                    </div>
                    {candidate.notes ? (
                      <p className="text-xs text-[var(--nimi-text-muted)]">{candidate.notes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <Button
                onClick={onImport}
                tone="primary"
                size="md"
              >
                Import selected OCR measurements
              </Button>
            </>
          )}
        </div>
      ) : null}
    </Surface>
  );
}
