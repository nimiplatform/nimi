import { useEffect, useRef, useState } from 'react';
import { Button, DashedAddButton, DialogTitle, OverlayShell, StatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import type { JournalTagInsertRow } from '../../bridge/sqlite-bridge.js';
import { ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import type { ObservationDimension } from '../../knowledge-base/index.js';
import { suggestJournalTags } from './ai-journal-tagging.js';
import type { JournalTagSuggestion } from './ai-journal-tagging.js';
import type { PhotoDraft, TagSuggestionStatus } from './journal-page-helpers.js';

/* ── AutoTagBar ── */

export interface AutoTagBarProps {
  status: TagSuggestionStatus;
  suggestion: JournalTagSuggestion | null;
  selectedTags: string[];
  selectedDimension: string | null;
  dimensions: Array<{ dimensionId: string; displayName: string; quickTags: string[] }>;
  onToggleTag: (tag: string) => void;
  onRetry: () => void;
}

export function AutoTagBar({ status, suggestion, selectedTags, selectedDimension, dimensions, onToggleTag, onRetry }: AutoTagBarProps) {
  if (status === 'idle') return null;

  if (status === 'suggesting') {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <div className="h-3 w-3 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
        <span className="text-[13px] text-[var(--nimi-text-muted)]">AI 正在分析...</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[12px] text-[var(--nimi-text-muted)]">AI 成长关键词暂不可用</span>
        <button onClick={onRetry} className="text-[12px] text-[var(--nimi-action-primary-bg)] underline">重试</button>
      </div>
    );
  }

  // status === 'ready'
  if (!suggestion?.dimensionId) return null;

  const dim = dimensions.find((d) => d.dimensionId === suggestion.dimensionId);
  const suggestedTags = suggestion.tags;

  if (!dim || suggestedTags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 parentos-radius-sm border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_22%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-2 py-1.5">
      <span className="shrink-0 text-[12px] text-[var(--nimi-action-primary-bg)]">✨</span>
      {selectedDimension !== suggestion.dimensionId && (
        <span className="parentos-radius-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--nimi-action-primary-bg)]">
          成长方向 · {dim.displayName}
        </span>
      )}
      {suggestedTags.map((tag) => (
        <button key={tag} onClick={() => onToggleTag(tag)}
          className={cn(
            'parentos-radius-full px-2 py-0.5 text-[12px] transition-colors',
            selectedTags.includes(tag)
              ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
              : 'border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)] bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]',
          )}>
          {tag}
        </button>
      ))}
    </div>
  );
}

/* ── PhotoBar ── */

export interface PhotoBarProps {
  drafts: PhotoDraft[];
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function PhotoBar({ drafts, onRemove, inputRef }: PhotoBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Photo previews */}
      {drafts.map((d, i) => (
        <div key={i} className="relative w-14 h-14 shrink-0">
          <img src={d.previewUrl} alt="" className="h-14 w-14 parentos-radius-sm object-cover" />
          <button onClick={() => onRemove(i)}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--nimi-status-danger)] text-[12px] leading-none text-[var(--nimi-action-primary-text)]">
            ✕
          </button>
        </div>
      ))}

      {drafts.length < 9 && (
        <DashedAddButton shape="thumb" onClick={() => inputRef.current?.click()} label="添加" />
      )}
    </div>
  );
}

/* ── SaveConfirmationModal ── */

export interface SaveConfirmationModalProps {
  textPreview: string;
  selectedDimension: string | null;
  selectedTags: string[];
  dimensions: readonly ObservationDimension[];
  draftTextForTagging: string;
  onConfirm: (aiTags: JournalTagInsertRow[]) => void;
  onCancel: () => void;
}

export function SaveConfirmationModal({
  textPreview, selectedDimension, selectedTags, dimensions,
  draftTextForTagging, onConfirm, onCancel,
}: SaveConfirmationModalProps) {
  const [aiStatus, setAiStatus] = useState<TagSuggestionStatus>('idle');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<JournalTagSuggestion | null>(null);
  const [selectedAiTags, setSelectedAiTags] = useState<Set<string>>(new Set());
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (draftTextForTagging.trim().length < 10) return;

    const candidateDimensions = selectedDimension
      ? dimensions.filter((d) => d.dimensionId === selectedDimension)
      : dimensions;
    if (candidateDimensions.length === 0) return;

    setAiStatus('suggesting');
    suggestJournalTags({ draftText: draftTextForTagging, candidateDimensions })
      .then((suggestion) => {
        if (suggestion.dimensionId) {
          const dim = candidateDimensions.find((d) => d.dimensionId === suggestion.dimensionId);
          const validTags = suggestion.tags.filter((tag) => dim?.quickTags.includes(tag) ?? false);
          setAiSuggestion({ dimensionId: suggestion.dimensionId, tags: validTags });
          setSelectedAiTags(new Set(validTags));
        } else {
          setAiSuggestion({ dimensionId: null, tags: [] });
        }
        setAiStatus('ready');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        catchLog('journal', 'ai-tag-analysis-failed', 'warn')(err);
        setAiError(msg);
        setAiSuggestion(null);
        setAiStatus('failed');
      });
  }, [draftTextForTagging, selectedDimension, dimensions]);

  const handleToggleAiTag = (tag: string) => {
    setSelectedAiTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const handleRetry = () => {
    ranRef.current = false;
    setAiStatus('idle');
    setAiError(null);
    setAiSuggestion(null);
    setSelectedAiTags(new Set());
    // Re-trigger via effect dependency — force by toggling ref
    setTimeout(() => { ranRef.current = false; }, 0);
    // Inline retry instead
    const candidateDimensions = selectedDimension
      ? dimensions.filter((d) => d.dimensionId === selectedDimension)
      : dimensions;
    if (candidateDimensions.length === 0) return;
    setAiStatus('suggesting');
    suggestJournalTags({ draftText: draftTextForTagging, candidateDimensions })
      .then((suggestion) => {
        if (suggestion.dimensionId) {
          const dim = candidateDimensions.find((d) => d.dimensionId === suggestion.dimensionId);
          const validTags = suggestion.tags.filter((tag) => dim?.quickTags.includes(tag) ?? false);
          setAiSuggestion({ dimensionId: suggestion.dimensionId, tags: validTags });
          setSelectedAiTags(new Set(validTags));
        } else {
          setAiSuggestion({ dimensionId: null, tags: [] });
        }
        setAiStatus('ready');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        catchLog('journal', 'ai-tag-analysis-retry-failed', 'warn')(err);
        setAiError(msg);
        setAiSuggestion(null);
        setAiStatus('failed');
      });
  };

  const handleConfirm = () => {
    const aiTags: JournalTagInsertRow[] = [];
    if (aiSuggestion?.dimensionId) {
      for (const tag of selectedAiTags) {
        if (aiSuggestion.tags.includes(tag)) {
          aiTags.push({ tagId: ulid(), domain: 'observation', tag, source: 'ai', confidence: null });
        }
      }
    }
    onConfirm(aiTags);
  };

  const manualDim = selectedDimension ? dimensions.find((d) => d.dimensionId === selectedDimension) : null;
  const aiDim = aiSuggestion?.dimensionId ? dimensions.find((d) => d.dimensionId === aiSuggestion.dimensionId) : null;
  const aiReady = aiStatus === 'ready' && aiSuggestion?.dimensionId && aiDim && aiSuggestion.tags.length > 0;

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onCancel}
      panelClassName="w-full max-w-[480px] parentos-radius-xl"
      contentClassName="!p-5"
    >
      <DialogTitle className="sr-only">保存随手记</DialogTitle>
      <h3 aria-hidden="true" className="mb-4 text-[16px] font-semibold text-[var(--nimi-text-primary)]">保存随手记</h3>

      {/* Text preview */}
      <Surface tone="card" elevation="base" padding="sm" className="mb-4 max-h-[160px] overflow-y-auto parentos-radius-sm p-3">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--nimi-text-muted)]">
          {textPreview || '（无文字内容）'}
        </p>
      </Surface>

      {/* Manual dimension + tags (display-only) */}
      {(manualDim || selectedTags.length > 0) && (
        <div className="mb-4">
          <p className="mb-1.5 text-[13px] font-medium text-[var(--nimi-text-muted)]">已选分类</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {manualDim && (
              <span className="parentos-radius-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] px-2 py-0.5 text-[12px] font-medium text-[var(--nimi-action-primary-bg)]">
                {manualDim.displayName}
              </span>
            )}
            {selectedTags.map((tag) => (
              <StatusBadge key={tag} tone="neutral" className="parentos-radius-full px-2 py-0.5 text-[12px] text-[var(--nimi-text-primary)]">
                {tag}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}

      {/* AI tag analysis section */}
      <div className="mb-5">
        <p className="mb-1.5 text-[13px] font-medium text-[var(--nimi-text-muted)]">AI 成长关键词</p>

        {aiStatus === 'suggesting' && (
          <div className="flex items-center gap-2 py-2">
            <div className="h-3 w-3 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
            <span className="text-[13px] text-[var(--nimi-text-muted)]">AI 正在分析成长关键词...</span>
          </div>
        )}

        {aiStatus === 'failed' && (
          <div className="py-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[var(--nimi-text-muted)]">AI 分析暂不可用</span>
              <button onClick={handleRetry} className="text-[12px] text-[var(--nimi-action-primary-bg)] underline">重试</button>
            </div>
            {aiError && (
              <p className="mt-1 break-all text-[12px] text-[var(--nimi-status-warning)]">{aiError}</p>
            )}
          </div>
        )}

        {aiStatus === 'ready' && !aiReady && (
          <p className="py-2 text-[12px] text-[var(--nimi-text-muted)]">AI 未识别到成长关键词</p>
        )}

        {aiReady && (
          <div className="flex flex-wrap items-center gap-2 parentos-radius-sm border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_22%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-2 py-2">
            <span className="shrink-0 text-[12px] text-[var(--nimi-action-primary-bg)]">✨</span>
            {aiDim && selectedDimension !== aiSuggestion!.dimensionId && (
              <span className="parentos-radius-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--nimi-action-primary-bg)]">
                成长方向 · {aiDim.displayName}
              </span>
            )}
            {aiSuggestion!.tags.map((tag) => (
              <button key={tag} onClick={() => handleToggleAiTag(tag)}
                className={cn(
                  'parentos-radius-full px-2 py-0.5 text-[12px] transition-colors',
                  selectedAiTags.has(tag)
                    ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                    : 'border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)] bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]',
                )}>
                {tag}
              </button>
            ))}
          </div>
        )}

        {aiStatus === 'idle' && draftTextForTagging.trim().length < 10 && (
          <p className="py-2 text-[12px] text-[var(--nimi-text-muted)]">文字内容较短，跳过 AI 分析</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" onClick={onCancel} tone="ghost" size="sm" className="parentos-radius-sm px-4 py-2 text-[14px]">
          取消
        </Button>
        <Button type="button" onClick={handleConfirm} tone="primary" size="sm" className="parentos-radius-sm px-4 py-2 text-[14px] font-medium">
          {aiStatus === 'suggesting' ? '保存（跳过 AI 分析）' : '保存'}
        </Button>
      </div>
    </OverlayShell>
  );
}
