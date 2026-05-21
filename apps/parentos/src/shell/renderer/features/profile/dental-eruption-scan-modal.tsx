import { Button, cn, DatePicker, OverlayShell, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { useMemo, useState } from 'react';
import {
  PERM_LOWER_L,
  PERM_LOWER_R,
  PERM_UPPER_L,
  PERM_UPPER_R,
  PRIMARY_LOWER_L,
  PRIMARY_LOWER_R,
  PRIMARY_UPPER_L,
  PRIMARY_UPPER_R,
  TOOTH_NAMES,
} from './dental-page-domain.js';
import {
  type DentalEruptionCandidate,
  flipCandidatesHorizontally,
} from './dental-eruption-scan.js';

type Stage = 'upload' | 'analyzing' | 'review' | 'saving';

export interface DentalEruptionScanModalProps {
  show: boolean;
  onClose: () => void;
  onPickImage: () => Promise<void>;
  onAnalyze: () => Promise<void>;
  onConfirm: (input: {
    eventDate: string;
    selectedToothIds: string[];
    candidates: DentalEruptionCandidate[];
  }) => Promise<void>;
  onFlipCandidates: (next: DentalEruptionCandidate[]) => void;
  onRetake: () => void;
  previewUrl: string | null;
  candidates: DentalEruptionCandidate[];
  warnings: string[];
  stage: Stage;
  errorMessage: string | null;
  alreadyRecordedErupted: Set<string>;
  eventDate: string;
  onEventDateChange: (value: string) => void;
}

function renderToothRow(
  teeth: string[],
  label: string,
  candidateMap: Map<string, DentalEruptionCandidate>,
  selected: Set<string>,
  already: Set<string>,
  onToggle: (toothId: string) => void,
) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="mr-1 w-8 text-right text-[12px] text-[var(--nimi-text-muted)]">{label}</span>
      {teeth.map((id) => {
        const candidate = candidateMap.get(id);
        const isSelected = selected.has(id);
        const wasAlready = already.has(id);
        const className = pickToothClassName({ candidate, isSelected, wasAlready });
        const confidenceHint = candidate ? ` · AI 置信度 ${(candidate.confidence * 100).toFixed(0)}%` : '';
        return (
          <button
            key={id}
            type="button"
            onClick={() => candidate && onToggle(id)}
            disabled={!candidate}
            title={`${id} ${TOOTH_NAMES[id] ?? ''}${confidenceHint}${wasAlready ? ' · 已在历史中' : ''}`}
            className={className}
          >
            {id}
          </button>
        );
      })}
    </div>
  );
}

function pickToothClassName(input: {
  candidate: DentalEruptionCandidate | undefined;
  isSelected: boolean;
  wasAlready: boolean;
}): string {
  const { candidate, isSelected, wasAlready } = input;
  const base = 'h-7 w-7 rounded-lg border text-[12px] font-bold transition-all hover:scale-105 disabled:cursor-default disabled:hover:scale-100';
  if (!candidate) {
    if (wasAlready) {
      return cn(base, 'border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)] opacity-80');
    }
    return cn(base, 'border-transparent bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)] opacity-60');
  }
  if (isSelected) {
    return cn(base, 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]');
  }
  return cn(
    base,
    'border-dashed border-[color-mix(in_srgb,var(--nimi-status-warning)_45%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]',
  );
}

export function DentalEruptionScanModal(props: DentalEruptionScanModalProps) {
  const [toothSet, setToothSet] = useState<'primary' | 'permanent'>('primary');
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const candidateMap = useMemo(() => {
    const map = new Map<string, DentalEruptionCandidate>();
    for (const candidate of props.candidates) map.set(candidate.toothId, candidate);
    return map;
  }, [props.candidates]);

  const selected = useMemo(() => {
    const next = new Set<string>();
    for (const candidate of props.candidates) {
      if (!deselected.has(candidate.toothId)) next.add(candidate.toothId);
    }
    return next;
  }, [props.candidates, deselected]);

  const isPrimary = toothSet === 'primary';
  const upperRight = isPrimary ? PRIMARY_UPPER_R : PERM_UPPER_R;
  const upperLeft = isPrimary ? PRIMARY_UPPER_L : PERM_UPPER_L;
  const lowerLeft = isPrimary ? PRIMARY_LOWER_L : PERM_LOWER_L;
  const lowerRight = isPrimary ? PRIMARY_LOWER_R : PERM_LOWER_R;

  const toggleTooth = (toothId: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(toothId)) next.delete(toothId);
      else next.add(toothId);
      return next;
    });
  };

  const selectAllVisible = (select: boolean) => {
    const pool = new Set([...upperRight, ...upperLeft, ...lowerLeft, ...lowerRight]);
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const candidate of props.candidates) {
        if (!pool.has(candidate.toothId)) continue;
        if (select) next.delete(candidate.toothId);
        else next.add(candidate.toothId);
      }
      return next;
    });
  };

  const handleFlip = () => {
    const flipped = flipCandidatesHorizontally(props.candidates);
    const remap = new Set<string>();
    for (const id of deselected) {
      const mirrored = findFlippedId(id);
      if (mirrored) remap.add(mirrored);
    }
    setDeselected(remap);
    props.onFlipCandidates(flipped);
  };

  const handleReset = () => {
    setDeselected(new Set());
  };

  const handleConfirm = async () => {
    await props.onConfirm({
      eventDate: props.eventDate,
      selectedToothIds: [...selected],
      candidates: props.candidates,
    });
  };

  const primaryCount = props.candidates.filter((c) => c.type === 'primary' && selected.has(c.toothId)).length;
  const permanentCount = props.candidates.filter((c) => c.type === 'permanent' && selected.has(c.toothId)).length;

  if (!props.show) return null;

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={props.onClose}
      closeOnBackdrop={false}
      panelClassName="max-h-[90vh] w-full max-w-[640px] overflow-auto rounded-3xl"
      contentClassName="!p-0"
    >
        <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">AI 识别牙齿萌出情况</h2>
            <p className="mt-0.5 text-[13px] text-[var(--nimi-text-muted)]">
              支持口腔全景片、口内照、咬合照。AI 识别仅供参考，请以医生诊断为准。
            </p>
          </div>
          <Button
            onClick={props.onClose}
            tone="ghost"
            size="sm"
            className="h-7 min-h-7 w-7 rounded-full px-0 text-[18px] leading-none"
            aria-label="关闭"
          >
            ×
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {props.errorMessage ? (
            <div
              className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-3 py-2 text-[14px] text-[var(--nimi-status-danger)]"
            >
              {props.errorMessage}
            </div>
          ) : null}

          {props.stage === 'upload' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">选择一张口腔全景片或口腔照片</p>
              <p className="max-w-[420px] text-[13px] text-[var(--nimi-text-muted)]">
                建议：咬合面照或正面微笑照最适合识别已萌出的牙齿；全景 X 光片还可以帮助识别颌骨内未萌出的恒牙胚。
              </p>
              <Button
                onClick={() => void props.onPickImage()}
                tone="primary"
                size="md"
                className="mt-2"
              >
                选择照片
              </Button>
            </div>
          ) : null}

          {props.previewUrl ? (
            <div className="flex items-start gap-3">
              <img
                src={props.previewUrl}
                alt="dental preview"
                className="h-28 w-28 rounded-2xl border border-[var(--nimi-border-subtle)] object-cover"
              />
              <div className="flex-1 text-[13px] text-[var(--nimi-text-muted)]">
                {props.stage === 'analyzing' ? (
                  <p>AI 正在分析中，请稍候…</p>
                ) : props.stage === 'saving' ? (
                  <p>正在保存记录…</p>
                ) : props.stage === 'review' ? (
                  <>
                    <p>
                      AI 识别出 <span className="text-[var(--nimi-action-primary-bg)]">{permanentCount}</span> 颗恒牙、
                      <span className="text-[var(--nimi-action-primary-bg)]"> {primaryCount}</span> 颗乳牙已萌出。
                    </p>
                    <p className="mt-1">请确认或取消选择后点击下方"确认并写入"。</p>
                  </>
                ) : (
                  <p>准备分析…</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    onClick={props.onRetake}
                    tone="secondary"
                    size="sm"
                  >
                    换一张照片
                  </Button>
                  {props.stage === 'review' ? (
                    <Button
                      onClick={() => void props.onAnalyze()}
                      tone="secondary"
                      size="sm"
                    >
                      重新分析
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {props.warnings.length > 0 && props.stage === 'review' ? (
            <div
              className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-2 text-[13px] text-[var(--nimi-status-warning)]"
            >
              {props.warnings.map((warning, idx) => (
                <p key={idx}>· {warning}</p>
              ))}
            </div>
          ) : null}

          {props.stage === 'review' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)]">
                  {(['primary', 'permanent'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setToothSet(value)}
                      className={cn(
                        'px-3 py-1.5 text-[13px] transition-colors',
                        toothSet === value
                          ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                          : 'bg-transparent text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)]',
                      )}
                    >
                      {value === 'primary' ? '乳牙' : '恒牙'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => selectAllVisible(true)}
                    tone="secondary"
                    size="sm"
                  >
                    全选当前视图
                  </Button>
                  <Button
                    onClick={() => selectAllVisible(false)}
                    tone="secondary"
                    size="sm"
                  >
                    全不选当前视图
                  </Button>
                  <Button
                    onClick={handleFlip}
                    title="如果 AI 把左右搞反了，点此镜像翻转"
                    tone="secondary"
                    size="sm"
                  >
                    左右镜像
                  </Button>
                  <Button
                    onClick={handleReset}
                    tone="secondary"
                    size="sm"
                  >
                    恢复 AI 默认选择
                  </Button>
                </div>
              </div>

              <Surface tone="panel" material="solid" elevation="base" padding="sm" className="rounded-2xl">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-[12px] text-[var(--nimi-text-muted)]">上颌</p>
                  <div className="flex gap-1">
                    {renderToothRow(upperRight, '右', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="w-3" />
                    {renderToothRow(upperLeft, '', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="ml-1 w-8 text-[12px] text-[var(--nimi-text-muted)]">左</span>
                  </div>
                  <div className="my-1 h-px w-full bg-[var(--nimi-border-subtle)]" />
                  <div className="flex gap-1">
                    {renderToothRow(lowerRight, '右', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="w-3" />
                    {renderToothRow(lowerLeft, '', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="ml-1 w-8 text-[12px] text-[var(--nimi-text-muted)]">左</span>
                  </div>
                  <p className="text-[12px] text-[var(--nimi-text-muted)]">下颌</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-[var(--nimi-text-muted)]">
                  <StatusBadge tone="info">已确认写入</StatusBadge>
                  <StatusBadge tone="warning">AI 建议已取消</StatusBadge>
                  <StatusBadge tone="neutral">已在历史记录中</StatusBadge>
                  <StatusBadge tone="neutral" className="opacity-70">AI 未识别到</StatusBadge>
                </div>
              </Surface>

              <div>
                <p className="mb-1 text-[13px] text-[var(--nimi-text-muted)]">观察日期</p>
                <DatePicker value={props.eventDate} onChange={props.onEventDateChange} />
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] px-5 py-3">
          <p className="text-[12px] text-[var(--nimi-text-muted)]">
            已选 {selected.size} 颗（{permanentCount} 恒 / {primaryCount} 乳）
          </p>
          <div className="flex gap-2">
            <Button
              onClick={props.onClose}
              disabled={props.stage === 'analyzing' || props.stage === 'saving'}
              tone="secondary"
              size="md"
            >
              取消
            </Button>
            <Button
              onClick={() => void handleConfirm()}
              disabled={props.stage !== 'review' || selected.size === 0}
              tone="primary"
              size="md"
            >
              {props.stage === 'saving' ? '保存中…' : '确认并写入'}
            </Button>
          </div>
        </div>
    </OverlayShell>
  );
}

function findFlippedId(toothId: string): string | null {
  if (toothId.length !== 2) return null;
  const unit = toothId[1];
  const quadrant = toothId[0];
  const map: Record<string, string> = { '1': '2', '2': '1', '3': '4', '4': '3', '5': '6', '6': '5', '7': '8', '8': '7' };
  const flipped = map[quadrant ?? ''];
  if (!flipped) return null;
  return `${flipped}${unit}`;
}
