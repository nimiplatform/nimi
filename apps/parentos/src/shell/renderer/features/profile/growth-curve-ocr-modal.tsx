import { Button, DatePicker, OverlayShell, Surface } from '@nimiplatform/nimi-kit/ui';
import { useRef } from 'react';
import { AppSelect } from '../../app-shell/app-select.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { OCRImportTypeId, OCRMeasurementCandidate } from './checkup-ocr.js';

export type GrowthCurveOCRCandidate = OCRMeasurementCandidate & { selected: boolean };

type GrowthCurveOCRModalProps = {
  ocrRuntimeAvailable: boolean | null;
  ocrImageName: string | null;
  ocrImageDataUrl: string | null;
  ocrStatus: 'idle' | 'analyzing' | 'review';
  ocrError: string | null;
  ocrCandidates: GrowthCurveOCRCandidate[];
  onClose: () => void;
  onFileChange: (file: File | null) => void;
  onAnalyze: () => void;
  onRetake: () => void;
  onToggleCandidate: (index: number, selected: boolean) => void;
  onChangeCandidateType: (index: number, typeId: OCRImportTypeId) => void;
  onChangeCandidateValue: (index: number, value: number) => void;
  onChangeCandidateDate: (index: number, measuredAt: string) => void;
  onImport: () => void;
};

const GROWTH_OCR_TYPE_OPTIONS = GROWTH_STANDARDS
  .filter((standard) => ['height', 'weight', 'head-circumference', 'bmi'].includes(standard.typeId))
  .map((standard) => ({ value: standard.typeId, label: standard.displayName }));

const FIELD_CLASS =
  'rounded-xl px-3 py-1.5 text-[14px] cursor-pointer appearance-none bg-[var(--nimi-field-bg)] text-[var(--nimi-text-primary)] border border-[var(--nimi-field-border)] transition-colors';

/**
 * Growth-sheet OCR intake, presented as a modal dialog. Mirrors the dental
 * eruption scan modal's upload -> analyze -> review staging. The page owns the
 * OCR state machine; this component is presentational.
 */
export function GrowthCurveOCRModal({
  ocrRuntimeAvailable,
  ocrImageName,
  ocrImageDataUrl,
  ocrStatus,
  ocrError,
  ocrCandidates,
  onClose,
  onFileChange,
  onAnalyze,
  onRetake,
  onToggleCandidate,
  onChangeCandidateType,
  onChangeCandidateValue,
  onChangeCandidateDate,
  onImport,
}: GrowthCurveOCRModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runtimeUnavailable = ocrRuntimeAvailable === false;
  const hasImage = Boolean(ocrImageDataUrl);
  const selectedCount = ocrCandidates.filter((candidate) => candidate.selected).length;

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      closeOnBackdrop={false}
      panelClassName="max-h-[90vh] w-full max-w-[560px] overflow-auto rounded-3xl"
      contentClassName="!p-0"
    >
      <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">智能识别体检单</h2>
          <p className="mt-0.5 text-[13px] text-[var(--nimi-text-muted)]">
            上传体检单照片，AI 自动提取身高 / 体重 / BMI 等数据，确认后才会写入。
          </p>
        </div>
        <Button
          onClick={onClose}
          tone="ghost"
          size="sm"
          className="h-7 min-h-7 w-7 rounded-full px-0 text-[18px] leading-none"
          aria-label="关闭"
        >
          ×
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="checkup-sheet-file"
        className="hidden"
        onChange={(event) => {
          onFileChange(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />

      <div className="space-y-4 px-5 py-4">
        {ocrError ? (
          <div
            data-testid="ocr-error"
            className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-3 py-2 text-[14px] text-[var(--nimi-status-danger)]"
          >
            {ocrError}
          </div>
        ) : null}

        {!hasImage ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">选择一张体检单或生长记录照片</p>
            <p className="max-w-[420px] text-[13px] text-[var(--nimi-text-muted)]">
              建议照片清晰、数值区域完整。AI 仅提取身高、体重、头围、BMI 等结构化数据。
            </p>
            {runtimeUnavailable ? (
              <p className="text-[13px] text-[var(--nimi-status-warning)]">
                当前无法使用本地 OCR 运行时，暂时不能解析体检单图片。
              </p>
            ) : null}
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={runtimeUnavailable}
              tone="primary"
              size="md"
              className="mt-2"
            >
              选择照片
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <img
              src={ocrImageDataUrl ?? ''}
              alt="体检单预览"
              className="h-28 w-28 rounded-2xl border border-[var(--nimi-border-subtle)] object-cover"
            />
            <div className="min-w-0 flex-1 text-[13px] text-[var(--nimi-text-muted)]">
              {ocrImageName ? (
                <p data-testid="ocr-image-name" className="truncate font-medium text-[var(--nimi-text-primary)]">
                  {ocrImageName}
                </p>
              ) : null}
              {ocrStatus === 'analyzing' ? (
                <p className="mt-1">AI 正在识别中，请稍候…</p>
              ) : ocrStatus === 'review' ? (
                <p className="mt-1">已识别到 {ocrCandidates.length} 项数据，请确认后导入。</p>
              ) : (
                <p className="mt-1">照片已就绪，点击「开始识别」提取数据。</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={onRetake} tone="secondary" size="sm" disabled={ocrStatus === 'analyzing'}>
                  换一张
                </Button>
                {ocrStatus === 'review' ? (
                  <Button onClick={onAnalyze} tone="secondary" size="sm">
                    重新识别
                  </Button>
                ) : (
                  <Button
                    onClick={onAnalyze}
                    disabled={ocrStatus === 'analyzing' || runtimeUnavailable}
                    tone="primary"
                    size="sm"
                  >
                    {ocrStatus === 'analyzing' ? '识别中…' : '开始识别'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {ocrStatus === 'review' ? (
          ocrCandidates.length === 0 ? (
            <p className="text-[14px] text-[var(--nimi-text-muted)]">未识别到可导入的受支持测量值。</p>
          ) : (
            <div className="space-y-3">
              {ocrCandidates.map((candidate, index) => (
                <Surface
                  key={`${candidate.typeId}-${index}`}
                  tone="panel"
                  material="solid"
                  elevation="base"
                  padding="sm"
                  className="space-y-2 rounded-2xl"
                >
                  <label className="flex items-center gap-2 text-[14px] text-[var(--nimi-text-primary)]">
                    <input
                      type="checkbox"
                      checked={candidate.selected}
                      onChange={(event) => onToggleCandidate(index, event.target.checked)}
                    />
                    导入此项
                  </label>
                  <div className="grid gap-2 md:grid-cols-3">
                    <AppSelect
                      value={candidate.typeId}
                      onChange={(value) => onChangeCandidateType(index, value as OCRImportTypeId)}
                      options={GROWTH_OCR_TYPE_OPTIONS}
                    />
                    <input
                      type="number"
                      value={candidate.value}
                      onChange={(event) => onChangeCandidateValue(index, Number(event.target.value))}
                      className={FIELD_CLASS}
                    />
                    <DatePicker
                      value={candidate.measuredAt}
                      onChange={(nextDate) => onChangeCandidateDate(index, nextDate)}
                      className={FIELD_CLASS}
                      size="small"
                    />
                  </div>
                  {candidate.notes ? (
                    <p className="text-[12px] text-[var(--nimi-text-muted)]">{candidate.notes}</p>
                  ) : null}
                </Surface>
              ))}
            </div>
          )
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] px-5 py-3">
        <p className="text-[12px] text-[var(--nimi-text-muted)]">
          {ocrStatus === 'review' ? `已选 ${selectedCount} 项` : '尚未识别'}
        </p>
        <div className="flex gap-2">
          <Button onClick={onClose} tone="secondary" size="md">
            取消
          </Button>
          <Button
            onClick={onImport}
            disabled={ocrStatus !== 'review' || selectedCount === 0}
            tone="primary"
            size="md"
          >
            导入选中数据
          </Button>
        </div>
      </div>
    </OverlayShell>
  );
}
