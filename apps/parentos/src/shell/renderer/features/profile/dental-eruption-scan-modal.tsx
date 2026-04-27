import { useMemo, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { ProfileDatePicker } from './profile-date-picker.js';
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
      <span className="mr-1 w-8 text-right text-[12px]" style={{ color: S.sub }}>{label}</span>
      {teeth.map((id) => {
        const candidate = candidateMap.get(id);
        const isSelected = selected.has(id);
        const wasAlready = already.has(id);
        const style = pickToothStyle({ candidate, isSelected, wasAlready });
        const confidenceHint = candidate ? ` · AI 置信度 ${(candidate.confidence * 100).toFixed(0)}%` : '';
        return (
          <button
            key={id}
            type="button"
            onClick={() => candidate && onToggle(id)}
            disabled={!candidate}
            title={`${id} ${TOOTH_NAMES[id] ?? ''}${confidenceHint}${wasAlready ? ' · 已在历史中' : ''}`}
            className="h-7 w-7 rounded-lg text-[12px] font-bold transition-all hover:scale-105 disabled:cursor-default disabled:hover:scale-100"
            style={style}
          >
            {id}
          </button>
        );
      })}
    </div>
  );
}

function pickToothStyle(input: {
  candidate: DentalEruptionCandidate | undefined;
  isSelected: boolean;
  wasAlready: boolean;
}): { background: string; color: string; border?: string; opacity?: number } {
  const { candidate, isSelected, wasAlready } = input;
  if (!candidate) {
    if (wasAlready) return { background: '#f1f5f9', color: '#64748b', opacity: 0.8 };
    return { background: '#faf9f6', color: '#c7c3ba', opacity: 0.65 };
  }
  if (isSelected) {
    return { background: S.accent, color: '#ffffff' };
  }
  return { background: '#fff7ed', color: '#9a3412', border: '1px dashed #fdba74' };
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`max-h-[90vh] w-full max-w-[640px] overflow-auto ${S.radius}`}
        style={{ background: S.card, boxShadow: S.shadow }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: S.border }}>
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: S.text }}>AI 识别牙齿萌出情况</h2>
            <p className="mt-0.5 text-[13px]" style={{ color: S.sub }}>
              支持口腔全景片、口内照、咬合照。AI 识别仅供参考，请以医生诊断为准。
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="text-[20px] leading-none"
            style={{ color: S.sub }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {props.errorMessage ? (
            <div
              className={`px-3 py-2 text-[14px] ${S.radiusSm}`}
              style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
            >
              {props.errorMessage}
            </div>
          ) : null}

          {props.stage === 'upload' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-[14px] font-medium" style={{ color: S.text }}>选择一张口腔全景片或口腔照片</p>
              <p className="max-w-[420px] text-[13px]" style={{ color: S.sub }}>
                建议：咬合面照或正面微笑照最适合识别已萌出的牙齿；全景 X 光片还可以帮助识别颌骨内未萌出的恒牙胚。
              </p>
              <button
                type="button"
                onClick={() => void props.onPickImage()}
                className={`mt-2 px-5 py-2.5 text-[14px] font-medium text-white ${S.radiusSm}`}
                style={{ background: S.accent }}
              >
                选择照片
              </button>
            </div>
          ) : null}

          {props.previewUrl ? (
            <div className="flex items-start gap-3">
              <img
                src={props.previewUrl}
                alt="dental preview"
                className={`h-28 w-28 object-cover ${S.radiusSm}`}
                style={{ border: `1px solid ${S.border}` }}
              />
              <div className="flex-1 text-[13px]" style={{ color: S.sub }}>
                {props.stage === 'analyzing' ? (
                  <p>AI 正在分析中，请稍候…</p>
                ) : props.stage === 'saving' ? (
                  <p>正在保存记录…</p>
                ) : props.stage === 'review' ? (
                  <>
                    <p>
                      AI 识别出 <span style={{ color: S.accent }}>{permanentCount}</span> 颗恒牙、
                      <span style={{ color: S.accent }}> {primaryCount}</span> 颗乳牙已萌出。
                    </p>
                    <p className="mt-1">请确认或取消选择后点击下方"确认并写入"。</p>
                  </>
                ) : (
                  <p>准备分析…</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={props.onRetake}
                    className={`px-2.5 py-1 text-[13px] ${S.radiusSm}`}
                    style={{ background: '#f0f0ec', color: S.sub }}
                  >
                    换一张照片
                  </button>
                  {props.stage === 'review' ? (
                    <button
                      type="button"
                      onClick={() => void props.onAnalyze()}
                      className={`px-2.5 py-1 text-[13px] ${S.radiusSm}`}
                      style={{ background: '#f0f0ec', color: S.sub }}
                    >
                      重新分析
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {props.warnings.length > 0 && props.stage === 'review' ? (
            <div
              className={`px-3 py-2 text-[13px] ${S.radiusSm}`}
              style={{ background: '#fffbeb', color: '#a16207', border: '1px solid #fef3c7' }}
            >
              {props.warnings.map((warning, idx) => (
                <p key={idx}>· {warning}</p>
              ))}
            </div>
          ) : null}

          {props.stage === 'review' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex overflow-hidden" style={{ border: `1px solid ${S.border}`, borderRadius: 8 }}>
                  {(['primary', 'permanent'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setToothSet(value)}
                      className="px-3 py-1.5 text-[13px]"
                      style={{
                        background: toothSet === value ? S.accent : 'transparent',
                        color: toothSet === value ? '#ffffff' : S.sub,
                      }}
                    >
                      {value === 'primary' ? '乳牙' : '恒牙'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => selectAllVisible(true)}
                    className={`px-2.5 py-1 text-[13px] ${S.radiusSm}`}
                    style={{ background: '#f0f0ec', color: S.sub }}
                  >
                    全选当前视图
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAllVisible(false)}
                    className={`px-2.5 py-1 text-[13px] ${S.radiusSm}`}
                    style={{ background: '#f0f0ec', color: S.sub }}
                  >
                    全不选当前视图
                  </button>
                  <button
                    type="button"
                    onClick={handleFlip}
                    title="如果 AI 把左右搞反了，点此镜像翻转"
                    className={`px-2.5 py-1 text-[13px] ${S.radiusSm}`}
                    style={{ background: '#f0f0ec', color: S.sub }}
                  >
                    左右镜像
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className={`px-2.5 py-1 text-[13px] ${S.radiusSm}`}
                    style={{ background: '#f0f0ec', color: S.sub }}
                  >
                    恢复 AI 默认选择
                  </button>
                </div>
              </div>

              <div className={`${S.radiusSm} p-3`} style={{ background: '#fafaf8' }}>
                <div className="flex flex-col items-center gap-1">
                  <p className="text-[12px]" style={{ color: S.sub }}>上颌</p>
                  <div className="flex gap-1">
                    {renderToothRow(upperRight, '右', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="w-3" />
                    {renderToothRow(upperLeft, '', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="ml-1 w-8 text-[12px]" style={{ color: S.sub }}>左</span>
                  </div>
                  <div className="my-1 h-px w-full" style={{ background: S.border }} />
                  <div className="flex gap-1">
                    {renderToothRow(lowerRight, '右', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="w-3" />
                    {renderToothRow(lowerLeft, '', candidateMap, selected, props.alreadyRecordedErupted, toggleTooth)}
                    <span className="ml-1 w-8 text-[12px]" style={{ color: S.sub }}>左</span>
                  </div>
                  <p className="text-[12px]" style={{ color: S.sub }}>下颌</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[12px]" style={{ color: S.sub }}>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded" style={{ background: S.accent }} />已确认写入
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded" style={{ background: '#fff7ed', border: '1px dashed #fdba74' }} />AI 建议已取消
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded" style={{ background: '#f1f5f9' }} />已在历史记录中
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded" style={{ background: '#faf9f6' }} />AI 未识别到
                  </span>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[13px]" style={{ color: S.sub }}>观察日期</p>
                <ProfileDatePicker value={props.eventDate} onChange={props.onEventDateChange} />
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: S.border }}>
          <p className="text-[12px]" style={{ color: S.sub }}>
            已选 {selected.size} 颗（{permanentCount} 恒 / {primaryCount} 乳）
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={props.onClose}
              disabled={props.stage === 'analyzing' || props.stage === 'saving'}
              className={`px-4 py-2 text-[14px] ${S.radiusSm}`}
              style={{ background: '#f0f0ec', color: S.sub }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={props.stage !== 'review' || selected.size === 0}
              className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} disabled:opacity-50`}
              style={{ background: S.accent }}
            >
              {props.stage === 'saving' ? '保存中…' : '确认并写入'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
